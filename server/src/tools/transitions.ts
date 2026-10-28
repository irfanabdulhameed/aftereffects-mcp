/*
 * Transitions tools (group 'transitions'): cuts between two layers, usually
 * two scene layers in a master composition, built the way a motion designer
 * builds them by hand. The outgoing layer accelerates into the cut and the
 * incoming layer opens from an offset and decelerates, so the fastest frame
 * sits on the cut; each property gets two eased keys (three for a push or a
 * carried element, whose speed passes through the cut). Motion blur is
 * switched on. Every transition stores a record in a layer marker at the cut
 * so it can be listed and removed exactly.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef, LayerRef, TimeArgs, Vec2 } from '../schemas/common.js';
import { defineTool } from './registry.js';

export const TRANSITION_KINDS = ['match-cut', 'zoom-through', 'push', 'shape-reveal', 'blur-swap', 'whip'] as const;

const Direction = z
  .enum(['left', 'right', 'up', 'down'])
  .describe('Direction the picture travels. Default left (the outgoing leaves to the left, the incoming comes in from the right).');

const Frames = (what: string) => z.number().int().min(1).max(600).optional().describe(what);

const Origin = z
  .union([
    Vec2.describe('A point in composition pixels.'),
    z.object({
      layer: LayerRef.describe('The layer whose content centre is the origin.'),
      from: z
        .enum(['comp', 'outgoing', 'incoming'])
        .optional()
        .describe("Where that layer lives: comp (this composition, default), outgoing or incoming (inside that precomp layer's composition)."),
    }),
  ])
  .describe('Point the scale pivots on or the reveal grows from: [x, y], or {layer, from}. Default the composition centre.');

const CarrySpec = z
  .object({
    outgoing: LayerRef.describe('The element at the end of the outgoing scene: a layer inside the outgoing precomp (or of this composition when the outgoing layer is not a precomp).'),
    incoming: LayerRef.describe('Its counterpart at the start of the incoming scene, inside the incoming precomp.'),
    layer: z.boolean().optional().describe('Also build one carry layer above both that moves from the first pose to the second (as carry-element does). Default true.'),
    source: z.enum(['outgoing', 'incoming']).optional().describe('Which element the carry layer copies. Default outgoing.'),
    name: z.string().min(1).optional().describe('Carry layer name. Default "<element> Carry".'),
  })
  .describe('An element kept continuous across the cut. For match-cut it also sets the pivots and the incoming scale so the two elements line up at the cut.');

const Pose = z.object({
  position: Vec2.describe("Where the element's centre ends, composition pixels."),
  scale: z.number().positive().max(10000).optional().describe("End size in percent of the element's size at the start. Default 100."),
  rotation: z.number().min(-36000).max(36000).optional().describe('End rotation in degrees. Default the start rotation.'),
});

const ElementSide = (role: string) =>
  z.object({
    scene: LayerRef.optional().describe(`The ${role} scene layer (a precomp layer in this composition) that holds the element. Omit when the element is a layer of this composition.`),
    layer: LayerRef.optional().describe(`The ${role} element: a layer inside the scene's composition, or of this composition when scene is omitted.`),
  });

export function registerTransitionTools(server: McpServer): void {
  defineTool(server, {
    name: 'add-transition',
    group: 'transitions',
    timeout: 60000,
    description:
      'Joins an outgoing and an incoming layer at a cut with eased keys on their own transforms: match-cut (outgoing pushes in accelerating, incoming opens oversized and decelerates, cut on the fastest frame), zoom-through (fast scale-up with a blur peak), push (both slide edge to edge at matched speed), shape-reveal (a growing circle or rounded rectangle track matte), blur-swap or whip (fast pan, mirrored edges). ' +
      'Use when: going from one scene layer to the next in a master. Do not use for: element entrances (add-entrance) or keeping one element across a cut alone (carry-element). ' +
      'Inputs: outgoing, incoming; kind (default the planned kind, else match-cut); time or frame of the cut (default the incoming in point; push defaults to the middle of the overlap); framesOut, framesIn; direction; intensity (default 1); origin; move scale or position (match-cut); shape and roundness (shape-reveal); carry; replace. ' +
      'Returns: the transition record (id, kind, cut, window), keys per layer, effects, helper layers and notes. ' +
      'Notes: trims at the cut, turns motion blur on, keeps scenes covering the frame. Push and shape-reveal need an overlap. Undoable; remove-transition undoes it. ' +
      'Example: outgoing {name: "01 Intro"}, incoming {name: "02 Feature"}, kind "match-cut", carry {outgoing: {name: "Send"}, incoming: {name: "Chip"}}.',
    input: {
      comp: CompRef.optional(),
      outgoing: LayerRef.describe('The layer that leaves (usually the earlier scene layer).'),
      incoming: LayerRef.describe('The layer that arrives (usually the next scene layer).'),
      kind: z.enum(TRANSITION_KINDS).optional().describe('Default: the kind planned for the outgoing scene in create-scene-plan, else match-cut.'),
      ...TimeArgs,
      framesOut: Frames('Frames of the outgoing move before the cut. Default about 0.33 s (match-cut, zoom-through), 0.3 s (push), 0.25 s (blur-swap), 0.2 s (whip). Not used by shape-reveal.'),
      framesIn: Frames('Frames of the incoming move after the cut. Default about 0.33 s, 0.5 s for shape-reveal, 0.27 s for whip.'),
      direction: Direction.optional(),
      intensity: z
        .number()
        .min(0.1)
        .max(4)
        .optional()
        .describe('Scales the amount: match-cut push-in to 250 % at 1, zoom-through 400 %, blur peaks 40 px, whip travel 0.75 of the frame. Default 1. Not used by push or shape-reveal.'),
      origin: Origin.optional(),
      move: z.enum(['scale', 'position']).optional().describe('match-cut only: push in with Scale (default) or slide with Position.'),
      shape: z.enum(['circle', 'rounded-rectangle']).optional().describe('shape-reveal only. Default circle.'),
      roundness: z.number().min(0).max(2000).optional().describe('shape-reveal rounded rectangle corner radius in pixels. Default 32 at 1080 lines.'),
      carry: CarrySpec.optional(),
      replace: z.boolean().optional().describe('Remove an existing transition between the same two layers first. Default false (an existing one is an error).'),
    },
    toBridgeArgs: (args) => {
      if (args.kind && args.move !== undefined && args.kind !== 'match-cut') throw new Error('move only applies to kind match-cut.');
      if (args.kind && (args.shape !== undefined || args.roundness !== undefined) && args.kind !== 'shape-reveal') throw new Error('shape and roundness only apply to kind shape-reveal.');
      return args;
    },
  });

  defineTool(server, {
    name: 'carry-element',
    group: 'transitions',
    timeout: 60000,
    description:
      "Keeps one element continuous across a cut: copies the element (or uses a layer you name) into this composition above both scene layers, keys it from its pose in the outgoing scene to its counterpart's pose in the incoming scene (or a target pose), and trims the two originals in their scene comps so they hide during the handover. " +
      "Use when: a button, logo or card must stay one object while the scenes around it cut. Do not use for: the scene layers' own moves (add-transition, whose carry option calls this). " +
      'Inputs: outgoing {scene, layer}; incoming {scene, layer} or {pose: {position, scale, rotation}}; time or frame of the cut (default the incoming scene in point); framesOut, framesIn (default 0.33 s); source; layer (an existing carry layer); name; cutProgress. ' +
      'Returns: the record id, the carry layer, poses at start, cut and end, whether the scenes line up, keys and trims. ' +
      'Notes: three keys per property, accelerating into the cut and landing after it, the speed passing through the cut frame; poses are read with toComp through both comps. Undoable; remove-transition removes it. ' +
      'Example: outgoing {scene: {name: "01 Intro"}, layer: {name: "Logo"}}, incoming {scene: {name: "02 Feature"}, layer: {name: "Logo"}}.',
    input: {
      comp: CompRef.optional(),
      outgoing: ElementSide('outgoing'),
      incoming: ElementSide('incoming').extend({ pose: Pose.optional().describe('Target pose instead of an incoming element.') }),
      ...TimeArgs,
      framesOut: Frames('Frames before the cut. Default about 0.33 s.'),
      framesIn: Frames('Frames after the cut. Default about 0.33 s.'),
      source: z.enum(['outgoing', 'incoming']).optional().describe('Which element the carry layer copies. Default outgoing.'),
      layer: LayerRef.optional().describe('Use this existing layer of the composition as the carry instead of a copy.'),
      name: z.string().min(1).optional().describe('Carry layer name. Default "<element> Carry".'),
      cutProgress: z
        .number()
        .min(0.05)
        .max(0.95)
        .optional()
        .describe('Share of the move done at the cut when the two scenes do not line up. Default framesOut / (framesOut + framesIn).'),
    },
    toBridgeArgs: (args) => {
      if (!args.outgoing.layer) throw new Error('outgoing.layer is required: the element in the outgoing scene.');
      if (!args.incoming.layer && !args.incoming.pose) throw new Error('incoming needs layer (its counterpart in the incoming scene) or pose (a target pose).');
      if (args.incoming.layer && args.incoming.pose) throw new Error('Give incoming.layer or incoming.pose, not both.');
      if (args.source === 'incoming' && !args.incoming.layer) throw new Error('source "incoming" needs incoming.layer.');
      if (args.layer && (args.source !== undefined || args.name !== undefined)) throw new Error('layer uses an existing layer as the carry; source and name only apply to a copied element.');
      return args;
    },
  });

  defineTool(server, {
    name: 'list-transitions',
    group: 'transitions',
    mutating: false,
    description:
      'Lists the transitions and carried elements that add-transition and carry-element built in a composition, read from the records they store in layer markers at each cut, and checks that their layers still exist. ' +
      'Use when: before remove-transition (to get the id), after a scene sequence changed, or to see which cuts already have a transition. Do not use for: the scene sequence (list-scenes) or markers in general (list-markers). ' +
      'Inputs: comp (default the active composition). ' +
      'Returns: count and transitions [{id, kind, cutTime, cutFrame, startFrame, endFrame, framesOut, framesIn, outgoing, incoming (each with exists), helpers (matte and carry layers), effects, keyCount, anchor, args}], and orphanHelpers: layers tagged as transition helpers whose record is gone. ' +
      'Notes: read-only. Records move with their layers, so a rippled sequence still lists the right cuts. Transitions made by hand are not listed. ' +
      'Example: comp {name: "Launch Film"}.',
    input: { comp: CompRef.optional() },
  });

  defineTool(server, {
    name: 'remove-transition',
    group: 'transitions',
    description:
      'Undoes one transition (or every one) built by add-transition or carry-element, using its record: removes exactly the keys it added (keys another transition shares stay), the effects it named, the matte and carry layers it created, restores the in and out points it trimmed (on the scene layers and on carried elements inside their scene comps), the static values and motion blur switches it changed, and deletes the record marker. ' +
      'Use when: trying another kind at a cut, or before re-timing by hand. Do not use for: deleting scene layers (remove-scene) or keys in general (delete-keyframes-in-range). ' +
      'Inputs: id from list-transitions, or all true. ' +
      'Returns: removed [{id, kind, keysRemoved, effectsRemoved, layersDeleted, trimsRestored}], the remaining count and notes about anything already missing. ' +
      'Notes: a layer the user deleted is skipped with a note. Composition motion blur is switched back off only when no transition remains and it was off before. Undoable in one step. ' +
      'Example: id "t4k2a1b".',
    input: {
      comp: CompRef.optional(),
      id: z.string().min(1).optional().describe('Transition id from list-transitions or add-transition.'),
      all: z.boolean().optional().describe('Remove every transition and carry in the composition.'),
    },
    toBridgeArgs: (args) => {
      if (!args.id && !args.all) throw new Error('Give id (from list-transitions) or all: true.');
      if (args.id && args.all) throw new Error('Give id or all, not both.');
      return args;
    },
  });
}
