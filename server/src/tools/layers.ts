/*
 * Layer tools: listing, creating simple layer types, duplicating, centring, timing.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BLEND_MODES, Color, CompRef, LABEL_COLORS, LayerRef, Vec2, Vec2or3 } from '../schemas/common.js';
import { defineTool } from './registry.js';

/** Placement fields shared by every create-* tool. */
export const PlacementArgs = {
  name: z.string().optional().describe('Layer name.'),
  position: Vec2or3.optional().describe('Position in comp pixels. Default: comp centre.'),
  startTime: z.number().optional().describe('Layer start time in seconds.'),
  startFrame: z.number().int().optional().describe('Layer start frame; wins over startTime.'),
  inPoint: z.number().optional().describe('In point in seconds.'),
  outPoint: z.number().optional().describe('Out point in seconds.'),
  duration: z.number().positive().optional().describe('Duration in seconds from the in point.'),
  durationFrames: z.number().int().positive().optional().describe('Duration in frames; wins over duration.'),
  label: z.union([z.enum(LABEL_COLORS), z.number().int().min(0).max(16)]).optional().describe('Label colour name or index 0-16.'),
  parent: LayerRef.optional().describe('Parent layer.'),
  blendMode: z.enum(BLEND_MODES).optional().describe('Blend mode.'),
  threeD: z.boolean().optional().describe('Make it a 3D layer.'),
  above: LayerRef.optional().describe('Place the new layer directly above this layer.'),
  below: LayerRef.optional().describe('Place the new layer directly below this layer.'),
  toBottom: z.boolean().optional().describe('Place the new layer at the bottom of the stack.'),
};

export function registerLayerTools(server: McpServer): void {
  defineTool(server, {
    name: 'list-layers',
    group: 'layers',
    mutating: false,
    description:
      'Lists the layers of a composition, top to bottom, with index, id, name, type (text, shape, solid, footage, precomp, null, adjustment, camera, light, audio), in and out points in seconds and frames, parent, blend mode, 3D, shy, solo, locked, label colour, track matte, effect names, whether expressions are present, and current transform values. ' +
      'Use when: before any layer-targeting call, to get indices, ids and names; after creating or deleting layers, because indices shift. ' +
      'Do not use for: property trees or keyframes on one layer (use get-layer-details or get-keyframes). ' +
      'Inputs: comp (optional, active comp by default); selectedOnly; includeKeyframes to list which properties carry keyframes. ' +
      'Returns: composition {id, name}, count, layers[]. ' +
      'Notes: read-only. Index 1 is the top layer. Layer ids are stable across reordering, so prefer {id} when you plan to reorder. ' +
      'Example: list-layers, then set-keyframes-bulk with layer {id: 123}.',
    input: {
      comp: CompRef.optional(),
      selectedOnly: z.boolean().optional().describe('Only layers selected in the timeline.'),
      includeKeyframes: z.boolean().optional().describe('Add keyframedProperties[] to each layer. Default false.'),
    },
  });

  defineTool(server, {
    name: 'get-layer-details',
    group: 'layers',
    mutating: false,
    description:
      'Returns everything about one layer: the summary from list-layers plus timing in seconds and frames (start, in, out, source in and out), markers, keyframed properties, and the property tree of Transform, Effects, Masks, Text, Contents, Audio, Material, Camera and Light options to a chosen depth with current values, expressions and keyframe counts. ' +
      'Use when: you need exact property paths, current values, or want to copy a look from a reference layer. ' +
      'Do not use for: several layers at once (use list-layers) or reading keyframe curves (use get-keyframes). ' +
      'Inputs: comp (optional), layer, depth (default 2; 3 or 4 for shape layers and effects with nested groups). ' +
      'Returns: the layer summary, timing, markers, properties[]. ' +
      'Notes: read-only. Deep trees on shape layers can be long; start with depth 2. ' +
      'Example: get-layer-details with depth 3 to find "Contents/Group 1/Fill 1/Color".',
    input: { comp: CompRef.optional(), layer: LayerRef, depth: z.number().int().min(0).max(6).optional().describe('Property tree depth. Default 2.') },
  });

  defineTool(server, {
    name: 'create-solid-layer',
    group: 'layers',
    description:
      'Creates a solid colour layer, sized to the composition unless a size is given, centred, and places it in the stack. ' +
      'Use when: you need a background, a colour card, or a plain rectangle that does not need to be a shape. Do not use for: adjustment layers (create-adjustment-layer) or shapes with strokes and rounded corners (create-shape-layer). ' +
      'Inputs: color in any colour form (default white); size [w, h] in pixels; the shared placement fields: name, position, startTime or startFrame, inPoint, outPoint, duration or durationFrames, label, parent, blendMode, threeD, above, below, toBottom. ' +
      'Returns: composition and the new layer summary with index, id and transform. ' +
      'Notes: the solid footage item is also added to the project (Solids folder). Undoable in one step. ' +
      'Example: name "BG", color "#101014", toBottom true.',
    input: {
      comp: CompRef.optional(),
      color: Color.optional().describe('Solid colour. Default white.'),
      size: Vec2.optional().describe('[width, height] in pixels. Default: comp size.'),
      pixelAspect: z.number().positive().optional(),
      ...PlacementArgs,
    },
  });

  defineTool(server, {
    name: 'create-adjustment-layer',
    group: 'layers',
    description:
      'Creates an adjustment layer (a comp-sized solid with the adjustment switch on) so effects applied to it affect every layer below. ' +
      'Use when: adding a grade, blur, glow or any effect to a group of layers at once. Do not use for: effects on one layer (apply-effect on that layer). ' +
      'Inputs: size (optional, default comp size) and the shared placement fields: name, position, timing, label, parent, blendMode, threeD, above, below, toBottom. ' +
      'Returns: composition and the new layer summary. ' +
      'Notes: placed at the top of the stack unless above, below or toBottom is given. Undoable in one step. ' +
      'Example: create-adjustment-layer name "Grade", then apply-effect-template "lumetri-basic" on layer {name: "Grade"}.',
    input: { comp: CompRef.optional(), size: Vec2.optional().describe('[width, height]. Default: comp size.'), ...PlacementArgs },
  });

  defineTool(server, {
    name: 'create-null-layer',
    group: 'layers',
    description:
      'Creates a null object, centred by default, and optionally parents a list of layers to it. Nulls are the standard controller for moving, scaling or rotating several layers together, and the usual home for expression controls. ' +
      'Use when: you want one handle for a group, or a place for sliders from add-expression-control. Do not use for: visible geometry (use a shape or solid). ' +
      'Inputs: name; position (default comp centre); centered (default true); children, an array of layer references to parent to the null; the shared placement fields. ' +
      'Returns: composition and the null layer summary. ' +
      'Notes: parenting keeps children where they are visually. Undoable in one step. ' +
      'Example: name "CTRL Title", children [{name: "Title"}, {name: "Subtitle"}].',
    input: {
      comp: CompRef.optional(),
      centered: z.boolean().optional().describe('Place at the comp centre when no position is given. Default true.'),
      children: z.array(LayerRef).optional().describe('Layers to parent to the new null.'),
      ...PlacementArgs,
    },
  });

  defineTool(server, {
    name: 'duplicate-layer',
    group: 'layers',
    description:
      'Duplicates a layer one or more times, keeping its effects, keyframes, trims and expressions. Copies can be placed at a list of times, or spaced by an offset, and named with a pattern. ' +
      'Use when: repeating a sound effect at several beats, stamping a shape into a grid, or making copies to stagger. Do not use for: copying only effects (use copy-effects). ' +
      'Inputs: layer; count (default 1); times[] in seconds or frames[] to place each copy\'s in point; offsetTime or offsetFrames added per copy; offsetPosition [x, y] added per copy; namePattern with {n} for the copy number and {name} for the source name; below to stack copies under the source instead of above. ' +
      'Returns: source, createdCount and the new layer summaries with indices. ' +
      'Notes: copies keep the source head trim, so the in point lands exactly on the requested time. Undoable in one step. ' +
      'Example: layer {name: "Click"}, times [0.5, 1.2, 2.0], namePattern "Click {n}".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      count: z.number().int().min(1).max(500).optional().describe('Number of copies when times/frames are not given. Default 1.'),
      times: z.array(z.number()).optional().describe('In point in seconds for each copy.'),
      frames: z.array(z.number().int()).optional().describe('In point in frames for each copy; wins over times.'),
      offsetTime: z.number().optional().describe('Seconds added per copy (or to every time in times[]).'),
      offsetFrames: z.number().int().optional().describe('Frames added per copy; wins over offsetTime.'),
      offsetPosition: Vec2or3.optional().describe('Position offset added per copy.'),
      namePattern: z.string().optional().describe('Name template, for example "Dot {n}".'),
      name: z.string().optional().describe('Plain name for the copies (numbered when more than one).'),
      below: z.boolean().optional().describe('Stack copies below the source. Default above.'),
    },
  });

  defineTool(server, {
    name: 'center-layers',
    group: 'layers',
    description:
      'Moves one layer, a list of layers, the selected layers, or all layers to the composition centre by setting Position. ' +
      'Use when: a layer landed off-centre after creation or import. Do not use for: aligning to edges or to each other (use align-layers) or changing the anchor point (use set-anchor-point). ' +
      'Inputs: layer, or layers (array of refs, {selected: true} or {all: true}), or all; axis "both" (default), "x" or "y". ' +
      'Returns: the comp centre and each moved layer with its new position. ' +
      'Notes: if Position has keyframes a keyframe is set at the current time instead. Undoable in one step. ' +
      'Example: layers {selected: true}, axis "x".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.optional(),
      layers: z.union([z.array(LayerRef), z.object({ selected: z.boolean().optional(), all: z.boolean().optional() })]).optional(),
      all: z.boolean().optional().describe('Centre every layer.'),
      axis: z.enum(['both', 'x', 'y']).optional(),
    },
  });

  defineTool(server, {
    name: 'set-layer-timing',
    group: 'layers',
    description:
      'Changes when a layer starts, its in and out points, its duration, or its time stretch, in seconds or frames, any subset in one call. ' +
      'Use when: placing a clip at a beat, trimming a layer to a section, or slowing footage (stretch 200 is half speed). Do not use for: time remapping (enable-time-remap) or splitting (split-layer-at-time). ' +
      'Inputs: layer; startTime or startFrame moves the whole layer; inPoint or inFrame and outPoint or outFrame trim it; duration or durationFrames sets the out point from the in point; stretch is a percentage. ' +
      'Returns: the layer summary with in, out, start in seconds and frames, and which fields changed. ' +
      'Notes: setting inPoint before startTime is applied in the order given here: start, in, out, duration, stretch. Undoable in one step. ' +
      'Example: layer {name: "Clip"}, startFrame 24, durationFrames 60.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      startTime: z.number().optional(),
      startFrame: z.number().int().optional(),
      inPoint: z.number().optional(),
      inFrame: z.number().int().optional(),
      outPoint: z.number().optional(),
      outFrame: z.number().int().optional(),
      duration: z.number().positive().optional(),
      durationFrames: z.number().int().positive().optional(),
      stretch: z.number().optional().describe('Time stretch percent. 100 is normal, 200 half speed, -100 reversed.'),
    },
  });
}
