/*
 * Scene planning tools (group 'scenes'): a film laid out scene by scene. A
 * folder named after the film holds the master composition and a Scenes
 * folder with one composition per scene; the master plays them in order with
 * a comp marker at every scene start. The sequence can be read back, and a
 * scene lengthened, inserted or removed with the later scenes rippling so the
 * sequence stays gapless. Reference videos and stills can be laid over a comp
 * as guide layers, or next to it in a review comp.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, LABEL_COLORS, LayerRef } from '../schemas/common.js';
import { ItemRef } from './project.js';
import { defineTool } from './registry.js';
import { TRANSITION_KINDS } from './transitions.js';

/** Kinds that show both scenes at once and so need an overlap between them. */
const OVERLAP_KINDS: ReadonlyArray<string> = ['push', 'shape-reveal'];

export const SceneRef = z
  .union([
    z.number().int().positive().describe('1-based position in the scene sequence.'),
    z.string().min(1).describe('Scene comp name, with or without its number, for example "02 Feature" or "Feature".'),
    z
      .object({
        compId: z.number().int().optional().describe('Scene composition item id.'),
        layer: LayerRef.optional().describe('The scene layer in the master composition.'),
      })
      .refine((o) => o.compId !== undefined || o.layer !== undefined, { message: 'Give compId or layer.' }),
  ])
  .describe('Which scene: its position, its name, {compId} or {layer}.');

const durationFields = {
  duration: z.number().positive().max(36000).optional().describe('Seconds. Snapped to whole frames.'),
  durationFrames: z.number().int().positive().max(2000000).optional().describe('Frames; wins over duration.'),
};

const hasDuration = (o: { duration?: number; durationFrames?: number }) => o.duration !== undefined || o.durationFrames !== undefined;

const SceneSpec = z
  .object({
    name: z.string().min(1).max(200).describe('Scene name without a number, for example "Intro". The comp is named "01 Intro".'),
    ...durationFields,
    notes: z.string().max(4000).optional().describe('What happens in the scene. Stored as the comp comment, in the guide layer and in the marker.'),
    transition: z.enum(TRANSITION_KINDS).optional().describe('The transition planned from this scene into the next one; add-transition uses it as its default kind.'),
    overlapFrames: z.number().int().min(0).max(100000).optional().describe('Frames this scene overlaps the next one. Default overlapFrames of the plan; push and shape-reveal default to 0.5 s.'),
  })
  .refine(hasDuration, { message: 'Each scene needs duration (seconds) or durationFrames.' });

const bareName = (n: string) => n.replace(/^\s*\d+[\s._-]+/, '').trim().toLowerCase();

export function registerSceneTools(server: McpServer): void {
  defineTool(server, {
    name: 'create-scene-plan',
    group: 'scenes',
    timeout: 60000,
    description:
      'Lays out a film scene by scene: a folder named after the film holding the master composition and a Scenes folder with one numbered comp per scene (01 Intro, 02 Feature) placed in order in the master, a comp marker at each scene start with its name and notes, and in each scene a guide text layer with the notes that never renders. ' +
      'Use when: starting a film from a scene list or storyboard, or updating that plan. Do not use for: adding one scene later (insert-scene) or retiming one (set-scene-duration). ' +
      'Inputs: filmName (the master comp name); scenes [{name, duration or durationFrames, notes, transition planned into the next scene, overlapFrames}]; fps (default 30); width, height (default 1920 x 1080); backgroundColor (default black); backgroundLayer (default true, an opaque solid per scene); overlapFrames (default 0); guides; folderName; ifExists update (default) or report. ' +
      'Returns: the folders, the master, and per scene its comp id, layer, in, out, duration, notes and planned transition, plus the changes. ' +
      'Notes: re-running with the same filmName updates notes and durations and adds missing scenes, never duplicating. Undoable in one step. ' +
      'Example: filmName "Launch Film", fps 60, scenes [{name: "Intro", duration: 3, notes: "Logo builds"}, {name: "Feature", duration: 4.5}].',
    input: {
      filmName: z.string().min(1).max(200).describe('Name of the film: the master composition and its folder.'),
      scenes: z.array(SceneSpec).min(1).max(200),
      fps: z.number().min(1).max(120).optional().describe('Frame rate of every comp. Default 30.'),
      width: z.number().int().min(4).max(30000).optional().describe('Pixels. Default 1920.'),
      height: z.number().int().min(4).max(30000).optional().describe('Pixels. Default 1080.'),
      pixelAspect: z.number().min(0.1).max(10).optional().describe('Default 1.'),
      backgroundColor: Color.optional().describe('Background of every comp. Default black.'),
      backgroundLayer: z.boolean().optional().describe('Add a locked solid named Background at the bottom of each scene so scenes stay opaque inside the master (push and reveals need that). Default true.'),
      overlapFrames: z.number().int().min(0).max(100000).optional().describe('Frames each scene overlaps the next. Default 0.'),
      guides: z.boolean().optional().describe('Add the "Scene Notes" guide text layer to each scene. Default true.'),
      folderName: z.string().min(1).max(200).optional().describe('Name of the folder holding the scene comps. Default "Scenes".'),
      ifExists: z.enum(['update', 'report']).optional().describe('When a plan with this filmName exists: update it (default) or only report it.'),
    },
    toBridgeArgs: (args) => {
      const fps = args.fps ?? 30;
      const seen = new Set<string>();
      for (const s of args.scenes) {
        const key = bareName(s.name);
        if (!key || /^\d+$/.test(key)) throw new Error(`Scene name "${s.name}" is only a number; give it a word.`);
        if (seen.has(key)) throw new Error(`Two scenes are named "${s.name}". Scene names must be unique (numbers are added automatically).`);
        seen.add(key);
      }
      const frames = args.scenes.map((s) => s.durationFrames ?? Math.max(1, Math.round((s.duration ?? 0) * fps)));
      const scenes = args.scenes.map((s, i) => {
        if (i === args.scenes.length - 1) return { ...s, overlapFrames: 0 };
        const room = Math.min(frames[i], frames[i + 1]) - 1;
        let overlap: number;
        if (s.overlapFrames !== undefined) overlap = s.overlapFrames;
        else if (args.overlapFrames !== undefined) overlap = args.overlapFrames;
        else if (s.transition && OVERLAP_KINDS.includes(s.transition)) overlap = Math.max(0, Math.min(Math.round(0.5 * fps), room));
        else overlap = 0;
        if (overlap > room) {
          throw new Error(`Scene "${s.name}" overlaps the next scene by ${overlap} frames, but an overlap must be shorter than both scenes (at most ${Math.max(0, room)} frames here).`);
        }
        return { ...s, overlapFrames: overlap };
      });
      return { ...args, scenes };
    },
  });

  defineTool(server, {
    name: 'list-scenes',
    group: 'scenes',
    mutating: false,
    description:
      "Reads a master composition's scene sequence in time order: each scene's comp name and id, its layer, start, in and out points, duration, the comp's own duration, notes (the comp comment) and planned transition, plus the gaps and overlaps between neighbours and problems such as trimmed or time-stretched scene layers. " +
      'Use when: checking a plan before or after changes, finding a scene\'s position or comp id for set-scene-duration, insert-scene or add-transition. Do not use for: every layer of a comp (list-layers) or transitions (list-transitions). ' +
      'Inputs: comp, the master (default the active composition). ' +
      'Returns: the composition, the scenes folder, count, scenes [{position, name, compId, layer, inPoint, outPoint, duration, frames, gapBeforeFrames, notes, transition}], gaps, overlaps, issues, unplaced scene comps, transitions at the cuts and the total length. ' +
      'Notes: read-only. Scenes are the precomp layers whose comps sit in the plan\'s scenes folder; in a master built by hand, every full-frame precomp layer that is not a guide. ' +
      'Example: comp {name: "Launch Film"}.',
    input: { comp: CompRef.optional() },
  });

  defineTool(server, {
    name: 'set-scene-duration',
    group: 'scenes',
    timeout: 60000,
    description:
      "Changes one scene's length: its composition's duration and its layer in the master, then shifts every later scene by the difference so the sequence stays gapless with its overlaps kept. Layers inside the scene that ran to its old end are extended, later layers and comp markers of the master move too, and transitions built by add-transition or carry-element on this scene's cuts are removed and built again at the new cuts. " +
      'Use when: a scene needs more or less time, or the plan changed. Do not use for: speeding footage up (set-speed) or moving one layer (set-layer-timing). ' +
      'Inputs: comp (the master); scene by position, name, {compId} or {layer}; duration in seconds or durationFrames; extendLayers (default true); rippleOtherLayers (default true: non-scene layers that start at or after the old end move with the scenes). ' +
      'Returns: the scene before and after, the change in frames, the layers and markers moved, the transitions rebuilt and the new sequence. ' +
      'Notes: assumes scene layers play at 100 % speed. A hand-trimmed scene layer gets its full new length. Undoable in one step. ' +
      'Example: comp {name: "Launch Film"}, scene "Feature", duration 5.',
    input: {
      comp: CompRef.optional(),
      scene: SceneRef,
      ...durationFields,
      extendLayers: z.boolean().optional().describe('Extend layers inside the scene comp that reached its old end. Default true.'),
      rippleOtherLayers: z.boolean().optional().describe('Also move non-scene layers that start at or after the old end of the scene. Default true.'),
    },
    toBridgeArgs: (args) => {
      if (!hasDuration(args)) throw new Error('Give duration (seconds) or durationFrames.');
      return args;
    },
  });

  defineTool(server, {
    name: 'insert-scene',
    group: 'scenes',
    timeout: 60000,
    description:
      'Adds a new scene composition to a scene plan: creates it in the scenes folder with the master\'s size, frame rate and background (plus the Background solid and Scene Notes guide when the plan uses them), places it in the master after or before a scene or at a position, shifts the later scenes by its length, and renumbers the scene comps. ' +
      'Use when: the film needs another beat between or around existing scenes. Do not use for: starting a plan (create-scene-plan) or a different length (set-scene-duration). ' +
      'Inputs: comp (the master); name; duration or durationFrames; notes; transition planned into the next scene; after, before (a scene) or position (1-based; default the end); overlapFrames with the previous scene; guides, backgroundLayer, renumber (default true); rippleOtherLayers. ' +
      'Returns: the new scene (comp id, layer, in and out), the renames, the layers moved, transitions removed at the split cut (with their arguments to rebuild) and the new sequence. ' +
      'Notes: a transition across the cut where the scene goes in is removed, because its two scenes are no longer neighbours. Undoable in one step. ' +
      'Example: comp {name: "Launch Film"}, name "Pricing", duration 3, after "Feature".',
    input: {
      comp: CompRef.optional(),
      name: z.string().min(1).max(200).describe('Scene name without a number.'),
      ...durationFields,
      notes: z.string().max(4000).optional().describe('Notes for the new scene: shown on its guide layer, its comp comment and its marker.'),
      transition: z.enum(TRANSITION_KINDS).optional().describe('Transition planned from this scene into the next one.'),
      after: SceneRef.optional().describe('Insert after this scene.'),
      before: SceneRef.optional().describe('Insert before this scene.'),
      position: z.number().int().positive().optional().describe('1-based position the new scene takes. Default after the last scene.'),
      overlapFrames: z.number().int().min(0).max(100000).optional().describe('Frames the new scene overlaps the previous one (or the next when it goes first). Default 0.'),
      guides: z.boolean().optional().describe('Add the Scene Notes guide layer. Default true.'),
      backgroundLayer: z.boolean().optional().describe('Add a Background solid. Default: when the other scenes have one.'),
      renumber: z.boolean().optional().describe('Renumber the scene comps in sequence order. Default true when they are numbered.'),
      rippleOtherLayers: z.boolean().optional().describe('Also move non-scene layers that start at or after the insertion point. Default true.'),
    },
    toBridgeArgs: (args) => {
      if (!hasDuration(args)) throw new Error('Give duration (seconds) or durationFrames.');
      const where = [args.after, args.before, args.position].filter((v) => v !== undefined).length;
      if (where > 1) throw new Error('Give only one of after, before or position.');
      return args;
    },
  });

  defineTool(server, {
    name: 'remove-scene',
    group: 'scenes',
    timeout: 60000,
    description:
      "Takes a scene out of the master: removes the transitions built on its cuts, deletes its layer, shifts the later scenes back so the next scene starts where it started (overlaps kept), renumbers the scene comps, and can delete the scene composition when nothing else uses it. " +
      'Use when: a beat is cut from the film. Do not use for: hiding a scene for a preview (set-layer-flags enabled false) or shortening it (set-scene-duration). ' +
      'Inputs: comp (the master); scene by position, name, {compId} or {layer}; deleteComp (default false: the comp stays in the scenes folder and list-scenes reports it as unplaced); renumber (default true when numbered); rippleOtherLayers (default true). ' +
      'Returns: the removed scene, whether its comp was deleted, the transitions removed with their arguments, layers that started inside the removed span (left in place), the layers moved and the new sequence. ' +
      'Notes: layers that started inside the removed scene are not moved or deleted; check them. Undoable in one step. ' +
      'Example: comp {name: "Launch Film"}, scene 3, deleteComp true.',
    input: {
      comp: CompRef.optional(),
      scene: SceneRef,
      deleteComp: z.boolean().optional().describe('Also delete the scene composition when no other comp uses it. Default false.'),
      renumber: z.boolean().optional().describe('Renumber the remaining scene comps. Default true when they are numbered.'),
      rippleOtherLayers: z.boolean().optional().describe('Also move non-scene layers that start at or after the next scene. Default true.'),
    },
  });

  defineTool(server, {
    name: 'add-reference-overlay',
    group: 'scenes',
    timeout: 60000,
    description:
      'Puts a reference video or still over a composition as a guide layer that never renders: imported once into a References folder (or an existing item), fitted to the comp, starting at a time offset, at an opacity, in Normal or Difference mode for frame matching, labelled and locked. With sideBySide it instead builds a review comp twice as wide showing the reference and the comp next to each other at the same size, with rendered labels. ' +
      'Use when: building against a reference film, a storyboard frame or a client cut. Do not use for: footage that belongs in the film (add-footage-to-composition). ' +
      'Inputs: comp; path to import or item; startTime or startFrame of the reference\'s first frame (default 0); opacity (default 50, 100 in difference); blendMode normal or difference; fit contain (default), cover, stretch or none; name; label (default red); locked (default true); audio (default true); sideBySide; referenceSide left (default) or right; labels; gap. ' +
      'Returns: the item (imported or reused), the layer, the fit scale and, with sideBySide, the review comp and its layers. ' +
      'Notes: the same file is imported once per project. Undoable in one step. ' +
      'Example: comp {name: "02 Feature"}, path "/refs/feature.mp4", startFrame 0, blendMode "difference".',
    input: {
      comp: CompRef.optional(),
      path: z.string().min(1).optional().describe('Absolute path of the video or image to import. Reused when the project already has it.'),
      item: ItemRef.optional().describe('An item already in the project instead of a path.'),
      startTime: z.number().optional().describe('Seconds in the comp where the reference\'s first frame sits. Default 0.'),
      startFrame: z.number().int().optional().describe('Frames; wins over startTime.'),
      opacity: z.number().min(0).max(100).optional().describe('Percent. Default 50, or 100 for difference.'),
      blendMode: z.enum(['normal', 'difference']).optional().describe('normal (default) to trace over it, difference to see where frames differ (black means a match).'),
      fit: z.enum(['contain', 'cover', 'stretch', 'none']).optional().describe('contain (default) fits inside the comp, cover fills it, stretch distorts to fill, none keeps 100 %.'),
      name: z.string().min(1).max(200).optional().describe('Layer name. Default "Reference: <item name>".'),
      label: z.enum(LABEL_COLORS).optional().describe('Layer label colour. Default red.'),
      locked: z.boolean().optional().describe('Lock the layer. Default true.'),
      audio: z.boolean().optional().describe('Keep the reference audio switched on. Default true.'),
      sideBySide: z.boolean().optional().describe('Build a review comp with the reference next to the comp instead of an overlay.'),
      referenceSide: z.enum(['left', 'right']).optional().describe('Side of the reference in the review comp. Default left.'),
      labels: z.boolean().optional().describe('Rendered name labels in the review comp. Default true.'),
      gap: z.number().int().min(0).max(2000).optional().describe('Pixels between the two halves of the review comp. Default 0.'),
    },
    toBridgeArgs: (args) => {
      if (!args.path === !args.item) throw new Error('Give path (a file to import) or item (a project item), exactly one.');
      if (!args.sideBySide && (args.referenceSide !== undefined || args.labels !== undefined || args.gap !== undefined)) {
        throw new Error('referenceSide, labels and gap only apply with sideBySide true.');
      }
      const opacity = args.opacity ?? (args.sideBySide ? 100 : args.blendMode === 'difference' ? 100 : 50);
      return { ...args, opacity };
    },
  });
}
