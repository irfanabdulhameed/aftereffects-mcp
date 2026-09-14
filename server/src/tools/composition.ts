/*
 * Composition tools: creating, listing, reading, changing settings,
 * duplicating, renaming, deleting, work area, current time, precompose,
 * viewer, and cropping.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, LayerRef, TimeArgs } from '../schemas/common.js';
import { ItemRef } from './project.js';
import { defineTool } from './registry.js';

export const COMP_PRESETS = ['1080p30', '1080p25', '1080p24', '1080p60', '4k30', '4k25', '4k24', '4k60', '720p30', 'square1080', 'vertical1080', 'motion-graphics-template'] as const;

const LayersSpec = z
  .union([z.array(LayerRef).min(1), z.object({ selected: z.boolean().optional().describe('true uses the layers selected in the timeline.'), all: z.boolean().optional().describe('true uses every layer.') })])
  .describe('Which layers: an array of layer refs, {selected: true} or {all: true}.');

export function registerCompositionTools(server: McpServer): void {
  defineTool(server, {
    name: 'create-composition',
    group: 'composition',
    description:
      'Creates a new composition and, by default, opens it in the viewer so it becomes the active composition for the tools that follow. ' +
      'Use when: starting a new piece or a precomp from scratch. Do not use for: nesting an existing comp (use add-composition-as-layer) or changing an existing comp (use set-composition-settings). ' +
      'Inputs: name; a preset such as "1080p30", "4k24", "square1080" or "vertical1080" that fills width, height and frameRate; any explicit width, height, frameRate override the preset; duration in seconds or durationFrames; pixelAspect (default 1); backgroundColor in any colour form; motionBlur; folder to file it in. ' +
      'Returns: the composition summary with id, size, frame rate, duration in seconds and frames, background colour. ' +
      'Notes: undoable in one step. Names need not be unique in After Effects, so keep the returned id. ' +
      'Example: name "Intro", preset "1080p30", duration 6, backgroundColor "#101014".',
    input: {
      name: z.string().describe('Composition name.'),
      preset: z.enum(COMP_PRESETS).optional().describe('Size and frame rate preset. Explicit values override it.'),
      width: z.number().int().min(4).max(30000).optional().describe('Pixels. Default 1920 or the preset.'),
      height: z.number().int().min(4).max(30000).optional().describe('Pixels. Default 1080 or the preset.'),
      frameRate: z.number().positive().max(240).optional().describe('Frames per second. Default 30 or the preset.'),
      duration: z.number().positive().optional().describe('Seconds. Default 10.'),
      durationFrames: z.number().int().positive().optional().describe('Duration in frames; wins over duration.'),
      pixelAspect: z.number().positive().optional().describe('Pixel aspect ratio. Default 1.'),
      backgroundColor: Color.optional().describe('Composition background colour.'),
      motionBlur: z.boolean().optional().describe('Enable the comp motion blur switch.'),
      folder: ItemRef.optional().describe('Project folder to place the comp in.'),
      openInViewer: z.boolean().optional().describe('Open the comp in the viewer so it becomes active. Default true.'),
    },
  });

  defineTool(server, {
    name: 'list-compositions',
    group: 'composition',
    mutating: false,
    description:
      'Lists every composition in the project with id, name, size, frame rate, duration, layer count, background colour, parent folder, and how many other comps use it. Also reports which composition is active. ' +
      'Use when: you need a composition id or name for comp references, or to see the structure of a project. ' +
      'Do not use for: layers inside a comp (use list-layers). ' +
      'Inputs: includeUsage (default true) adds the used-in count, which costs a little time on big projects. ' +
      'Returns: count, activeComp, compositions[]. ' +
      'Notes: read-only. ' +
      'Example: list-compositions, then pass {name: "Lower Third"} as comp to other tools.',
    input: { includeUsage: z.boolean().optional().describe('Include how many comps use each comp. Default true.') },
  });

  defineTool(server, {
    name: 'get-composition-info',
    group: 'composition',
    mutating: false,
    description:
      'Returns everything about one composition: dimensions, duration, frame rate and frame duration, work area, background colour, motion blur settings (shutter angle, phase, samples), resolution factor, display start time, a short layer list, nested compositions, comp markers, and the used-in count. ' +
      'Use when: before animating in a comp, to know its frame rate and size, or to check the work area before rendering. ' +
      'Do not use for: full layer property trees (use get-layer-details). ' +
      'Inputs: comp (optional, defaults to the active composition). ' +
      'Returns: the composition summary plus layers[], nestedCompositions[], markers[]. ' +
      'Notes: read-only. ' +
      'Example: get-composition-info to learn frameRate 25 before converting frames to seconds.',
    input: { comp: CompRef.optional() },
  });

  defineTool(server, {
    name: 'set-composition-settings',
    group: 'composition',
    description:
      'Changes any subset of a composition\'s settings in one call: size, frame rate, duration, pixel aspect, background colour, motion blur switch and its shutter settings, preview resolution, display start time, shy layer hiding, nested comp options, and name. Unlisted settings stay as they are. ' +
      'Use when: fixing a comp created at the wrong size or frame rate, extending its duration to fit new layers, or switching motion blur on for a render. ' +
      'Do not use for: making a new comp (use create-composition) or the work area (use set-work-area). ' +
      'Inputs: comp; width, height in pixels; frameRate in fps; duration in seconds or durationFrames (wins); pixelAspect; bgColor in any colour form; motionBlur; shutterAngle 0 to 720 degrees; shutterPhase -360 to 360; motionBlurSamplesPerFrame 2 to 256; motionBlurAdaptiveSampleLimit 16 to 256; resolutionFactor [x, y] such as [2, 2] for half; displayStartTime seconds or displayStartFrame; hideShyLayers; preserveNestedFrameRate; preserveNestedResolution; name. ' +
      'Returns: the composition summary and changed[] listing which settings were applied. ' +
      'Notes: changing size does not move layers; use crop-composition-to-region for that. Shortening duration keeps layers past the end, hidden. Undoable in one step. ' +
      'Example: comp {name: "Intro"}, frameRate 25, durationFrames 250, motionBlur true.',
    input: {
      comp: CompRef.optional(),
      name: z.string().optional().describe('New composition name.'),
      width: z.number().int().min(4).max(30000).optional().describe('Pixels.'),
      height: z.number().int().min(4).max(30000).optional().describe('Pixels.'),
      frameRate: z.number().positive().max(240).optional().describe('Frames per second.'),
      duration: z.number().positive().optional().describe('Seconds.'),
      durationFrames: z.number().int().positive().optional().describe('Duration in frames; wins over duration.'),
      pixelAspect: z.number().positive().optional().describe('Pixel aspect ratio, 1 for square pixels.'),
      bgColor: Color.optional().describe('Background colour.'),
      motionBlur: z.boolean().optional().describe('Comp motion blur switch.'),
      shutterAngle: z.number().min(0).max(720).optional().describe('Degrees, 0 to 720. Default in After Effects 180.'),
      shutterPhase: z.number().min(-360).max(360).optional().describe('Degrees, -360 to 360. Default -90.'),
      motionBlurSamplesPerFrame: z.number().int().min(2).max(256).optional().describe('2 to 256. Default 16.'),
      motionBlurAdaptiveSampleLimit: z.number().int().min(16).max(256).optional().describe('16 to 256. Default 128.'),
      resolutionFactor: z.tuple([z.number().int().min(1).max(99), z.number().int().min(1).max(99)]).optional().describe('[x, y] downsample factors: [1,1] full, [2,2] half, [4,4] quarter.'),
      displayStartTime: z.number().optional().describe('Seconds shown for the first frame of the comp.'),
      displayStartFrame: z.number().int().optional().describe('Frame number shown for the first frame; wins over displayStartTime.'),
      hideShyLayers: z.boolean().optional().describe('Hide layers marked shy in the timeline.'),
      preserveNestedFrameRate: z.boolean().optional().describe('Keep this comp\'s frame rate when nested.'),
      preserveNestedResolution: z.boolean().optional().describe('Keep this comp\'s resolution when nested.'),
    },
  });

  defineTool(server, {
    name: 'duplicate-composition',
    group: 'composition',
    description:
      'Copies a composition with all its layers, keyframes and effects into a new independent composition in the same folder. Layers that were precomps still point at the same nested comps. ' +
      'Use when: making a variant (another language, size or colourway) without touching the original, or a safe copy before a risky edit. ' +
      'Do not use for: placing a comp inside another (use add-composition-as-layer) or copying only layers (use duplicate-layer). ' +
      'Inputs: comp; newName (default: the source name with a number appended by After Effects); openInViewer (default false) makes the copy the active comp. ' +
      'Returns: source {id, name} and composition, the summary of the copy with its new id. ' +
      'Notes: the copy has a new id; pass it as comp {id} to later tools. Nested comps are shared, not copied; duplicate them separately if the variant must not affect the original. Undoable in one step. ' +
      'Example: comp {name: "Intro"}, newName "Intro FR", openInViewer true.',
    input: {
      comp: CompRef.optional(),
      newName: z.string().optional().describe('Name for the copy.'),
      openInViewer: z.boolean().optional().describe('Open the copy in the viewer. Default false.'),
    },
  });

  defineTool(server, {
    name: 'rename-composition',
    group: 'composition',
    description:
      'Renames a composition. The name shows in the Project panel, on the timeline tab, and on any layer that nests the comp and still carries the old name. ' +
      'Use when: a generated comp such as "Comp 1" needs a meaningful name, or after duplicate-composition. ' +
      'Do not use for: renaming layers (use rename-layer) or footage items (use rename-item). ' +
      'Inputs: comp (optional, active comp by default); newName. ' +
      'Returns: composition summary with the new name and previousName. ' +
      'Notes: names need not be unique in After Effects; the id in the summary is the reliable handle. Undoable in one step. ' +
      'Example: comp {id: 7}, newName "Lower Third v2".',
    input: { comp: CompRef.optional(), newName: z.string().min(1).describe('New composition name.') },
  });

  defineTool(server, {
    name: 'delete-composition',
    group: 'composition',
    description:
      'Deletes a composition from the project, including all its layers. When other compositions nest it, those layers disappear too, so the call refuses unless force is true. ' +
      'Use when: removing a scratch or superseded comp. ' +
      'Do not use for: emptying a comp (use delete-layers) or removing many unused items (use reduce-project). ' +
      'Inputs: comp; force (default false) must be true when usedInCount is greater than 0. ' +
      'Returns: removed {id, name}, usedInCount, numLayers. ' +
      'Notes: the active comp can be deleted; afterwards no comp is active until you open another with open-composition-in-viewer. Undoable with the undo tool. ' +
      'Example: comp {name: "Test comp"}, force false.',
    input: { comp: CompRef.optional(), force: z.boolean().optional().describe('Required when other comps use this one. Default false.') },
  });

  defineTool(server, {
    name: 'set-work-area',
    group: 'composition',
    description:
      'Sets the work area of a composition: the time span that previews and renders by default, shown as a bar above the timeline. ' +
      'Use when: rendering or previewing only a section, or before add-to-render-queue so only the finished part renders. ' +
      'Do not use for: trimming layers (use set-layer-timing) or the comp length (use set-composition-settings duration). ' +
      'Inputs: comp; start in seconds or startFrame (wins); end in seconds or endFrame (wins); or duration in seconds or durationFrames measured from start. Omitted start keeps the current start; omitted end keeps the current end. Values are clamped to the comp. ' +
      'Returns: composition {id, name}, workAreaStart, workAreaEnd, workAreaDuration in seconds and the same in frames. ' +
      'Notes: the work area must be at least one frame long. Undoable in one step. ' +
      'Example: comp {name: "Intro"}, startFrame 0, endFrame 120.',
    input: {
      comp: CompRef.optional(),
      start: z.number().min(0).optional().describe('Work area start in seconds.'),
      startFrame: z.number().int().min(0).optional().describe('Work area start frame; wins over start.'),
      end: z.number().optional().describe('Work area end in seconds.'),
      endFrame: z.number().int().optional().describe('Work area end frame; wins over end.'),
      duration: z.number().positive().optional().describe('Length in seconds from start; used when end is omitted.'),
      durationFrames: z.number().int().positive().optional().describe('Length in frames from start; wins over duration.'),
    },
  });

  defineTool(server, {
    name: 'set-current-time',
    group: 'composition',
    description:
      'Moves the current time indicator (the playhead) of a composition to a time or frame. The playhead decides which frame the viewer shows and where tools that default to the current time place keyframes. ' +
      'Use when: before see-frame or export-frame-png to look at a specific frame, or before a tool that reads the current time. ' +
      'Do not use for: changing layer timing (use set-layer-timing) or the comp start (use set-composition-settings displayStartTime). ' +
      'Inputs: comp (optional, active by default); time in seconds or frame (wins). ' +
      'Returns: composition {id, name}, time in seconds and frame after clamping to the comp duration. ' +
      'Notes: the time is snapped to a frame boundary. Not recorded as an undoable edit. ' +
      'Example: frame 48, then see-frame.',
    input: { comp: CompRef.optional(), ...TimeArgs },
  });

  defineTool(server, {
    name: 'precompose',
    group: 'composition',
    description:
      'Moves a set of layers into a new nested composition (a precomp) and replaces them in the current comp with one layer that shows the precomp. This groups layers so they can be transformed, masked or effected together. ' +
      'Use when: applying one effect or mask to several layers, tidying a busy timeline, or preparing a group for time remapping. ' +
      'Do not use for: copying a comp (use duplicate-composition) or nesting an existing comp (use add-composition-as-layer). ' +
      'Inputs: comp; layers as an array of refs or {selected: true}; name for the precomp; moveAllAttributes (default true) moves keyframes, effects and masks into the precomp, false keeps them on the new layer and is allowed for a single layer only; trimToLayers (default false) trims the new layer to the span the source layers covered and shortens the precomp to that end time. ' +
      'Returns: precomp (composition summary) and layer (the new layer in the current comp). ' +
      'Notes: layer indices change after precomposing; call list-layers again. Undoable in one step. ' +
      'Example: layers [{name: "Title"}, {name: "Underline"}], name "Title Group", trimToLayers true.',
    input: {
      comp: CompRef.optional(),
      layers: LayersSpec,
      name: z.string().min(1).describe('Name of the new precomp.'),
      moveAllAttributes: z.boolean().optional().describe('Move keyframes, effects and masks into the precomp. Default true.'),
      trimToLayers: z.boolean().optional().describe('Trim the new layer to the union of the source layers\' in and out points. Default false.'),
    },
  });

  defineTool(server, {
    name: 'open-composition-in-viewer',
    group: 'composition',
    description:
      'Opens a composition in the viewer and timeline so it becomes the active composition, the one used by every tool when comp is omitted and the one shown by see-frame. ' +
      'Use when: switching which comp the following calls work on, or after delete-composition removed the active one. ' +
      'Do not use for: nesting a comp in another (use add-composition-as-layer). ' +
      'Inputs: comp, by id or name. ' +
      'Returns: composition {id, name} and active true when it is now the active comp. ' +
      'Notes: has no effect on the project file and is not an undoable edit. When After Effects is minimised the comp still becomes active. ' +
      'Example: comp {name: "Lower Third"}, then list-layers with no comp.',
    input: { comp: CompRef.optional() },
    mutating: false,
  });

  defineTool(server, {
    name: 'crop-composition-to-region',
    group: 'composition',
    description:
      'Resizes a composition to a rectangle of its current picture and shifts every layer so the rectangle\'s content stays in place, like cropping a picture. The region is given in comp pixels or taken from one layer\'s visible bounds. ' +
      'Use when: cutting a full-frame comp down to one element, for example a logo animation to be nested elsewhere. ' +
      'Do not use for: only changing the size without moving layers (use set-composition-settings). ' +
      'Inputs: comp; region {x, y, width, height} with x and y the top-left corner in pixels, or fromLayer (a LayerRef, bounds measured at the current time, ignoring rotation); padding pixels added around a fromLayer region (default 0). ' +
      'Returns: composition summary, region used, movedLayers, skippedLayers[] with a reason. ' +
      'Notes: Position keyframes are all offset; parented layers, cameras and lights are skipped because they follow their parent or the camera. Layers with a Position expression keep the expression, which may override the shift. Undoable in one step. Unverified against a real After Effects for 3D layers. ' +
      'Example: fromLayer {name: "Logo"}, padding 40.',
    input: {
      comp: CompRef.optional(),
      region: z
        .object({
          x: z.number().describe('Left edge in comp pixels.'),
          y: z.number().describe('Top edge in comp pixels.'),
          width: z.number().positive().describe('Pixels.'),
          height: z.number().positive().describe('Pixels.'),
        })
        .optional()
        .describe('Rectangle to keep, in comp pixels with origin top-left.'),
      fromLayer: LayerRef.optional().describe('Use this layer\'s visible bounds at the current time as the region.'),
      padding: z.number().min(0).optional().describe('Pixels added around a fromLayer region. Default 0.'),
    },
  });
}
