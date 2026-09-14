/*
 * Mask tools: creating masks from rectangles, ellipses, points, text bounds
 * and shape layer paths; reading and changing mask properties; keyframing
 * mask paths; reveal animations.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, Easing, LayerRef, TimeArgs, Vec2 } from '../schemas/common.js';
import { defineTool } from './registry.js';
import { ShapeGroupRef } from './shapes.js';

export const MaskRef = z
  .union([z.string().describe('Mask name as shown under the layer\'s Masks group, for example "Mask 1".'), z.number().int().positive().describe('1-based position in the Masks group.')])
  .describe('Which mask: name or 1-based index.');

export const MASK_MODES = ['none', 'add', 'subtract', 'intersect', 'lighten', 'darken', 'difference'] as const;

const MaskGeometryArgs = {
  shape: z.enum(['rectangle', 'ellipse', 'points', 'text-bounds']).optional().describe('Geometry kind. Inferred from points, rect or size when omitted; default rectangle over the layer bounds.'),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional().describe('Top-left corner and size in layer pixels (origin at the layer\'s top-left).'),
  size: Vec2.optional().describe('[width, height] in layer pixels, used with center.'),
  center: Vec2.optional().describe('[x, y] centre in layer pixels. Default: the layer centre.'),
  points: z.array(Vec2).min(2).optional().describe('Vertices in layer pixels for shape "points".'),
  inTangents: z.array(Vec2).optional().describe('Per-vertex incoming tangents, relative to the vertex.'),
  outTangents: z.array(Vec2).optional().describe('Per-vertex outgoing tangents.'),
  closed: z.boolean().optional().describe('Close the path. Default true.'),
  padding: z.number().optional().describe('Pixels added around the layer or text bounds. Default 0.'),
};

const MaskPropertyArgs = {
  mode: z.enum(MASK_MODES).optional().describe('How the mask combines with the layer and other masks. Default add.'),
  inverted: z.boolean().optional(),
  feather: z.union([z.number().min(0), Vec2]).optional().describe('Feather in pixels, one number for both axes or [x, y].'),
  opacity: z.number().min(0).max(100).optional().describe('Mask opacity in percent.'),
  expansion: z.number().optional().describe('Mask expansion in pixels; negative shrinks.'),
  name: z.string().optional().describe('Mask name. Default "Mask N".'),
};

export function registerMasksTools(server: McpServer): void {
  defineTool(server, {
    name: 'create-mask',
    group: 'masks',
    description:
      'Adds a mask to a layer as a rectangle, ellipse, custom point path, or a rectangle around the visible text or source bounds, with mode, inversion, feather, opacity and expansion set in the same call. A mask hides everything on the layer outside its path. ' +
      'Use when: cropping a layer, making a soft vignette on a solid, or preparing a reveal. Do not use for: shape layer geometry (create-shape-layer) or copying a shape path onto a layer (create-mask-from-shape-layer). ' +
      'Inputs: layer; shape rectangle, ellipse, points or text-bounds; rect {x, y, width, height} or size plus center in layer pixels (origin top-left of the layer); points[] with optional tangents and closed; padding around the bounds; mode add, subtract, intersect, lighten, darken, difference or none; inverted; feather as a number or [x, y]; opacity; expansion; name; time or frame for measuring text bounds. ' +
      'Returns: the mask (index, name, path "Masks/<name>", mode, feather, opacity, expansion, vertexCount) and the composition and layer references. ' +
      'Notes: with no geometry the mask covers the layer bounds. Ellipses are four bezier vertices. Cameras and lights cannot hold masks. Undoable in one step. ' +
      'Example: layer {name: "Photo"}, shape "ellipse", size [600, 600], feather 80.',
    input: { comp: CompRef.optional(), layer: LayerRef, ...MaskGeometryArgs, ...MaskPropertyArgs, ...TimeArgs },
  });

  defineTool(server, {
    name: 'list-masks',
    group: 'masks',
    mutating: false,
    description:
      'Lists the masks on a layer with index, name, path, mode, inverted, locked, colour, feather, opacity, expansion, vertex count, whether the path is closed, and keyframe counts for path, feather, opacity and expansion. ' +
      'Use when: before set-mask-properties, delete-mask or set-mask-path-keyframe, to get the mask name or index; or to check what a reveal animation wrote. Do not use for: shape layer contents (list-shape-groups). ' +
      'Inputs: layer. ' +
      'Returns: composition, layer, count and masks[]. ' +
      'Notes: read-only. Index 1 is the top mask in the Masks group. Vertex counts are read at the current time. ' +
      'Example: layer {name: "Photo"}.',
    input: { comp: CompRef.optional(), layer: LayerRef },
  });

  defineTool(server, {
    name: 'set-mask-properties',
    group: 'masks',
    description:
      'Changes a mask\'s mode, inverted flag, feather, opacity, expansion, name, lock and colour. With a time or frame the feather, opacity and expansion values are written as keyframes with easing. ' +
      'Use when: softening a mask edge, fading a mask, switching add to subtract, or keying a feather change. Do not use for: the path itself (set-mask-path-keyframe) or full reveals (mask-reveal-animation). ' +
      'Inputs: layer; mask by name or index; mode; inverted; feather (number or [x, y]); opacity in percent; expansion in pixels; name; locked; color in any colour form; time or frame plus easing for keyframes. ' +
      'Returns: the mask summary, the fields changed, and keyframes written. ' +
      'Notes: if a property already has keys and no time is given, a key is set at the current time. Undoable in one step. ' +
      'Example: mask "Mask 1", feather [40, 40], frame 12, easing "ease-out".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      mask: MaskRef,
      ...MaskPropertyArgs,
      locked: z.boolean().optional(),
      color: Color.optional().describe('Mask outline colour in the timeline.'),
      ...TimeArgs,
      easing: Easing.optional(),
    },
  });

  defineTool(server, {
    name: 'set-mask-path-keyframe',
    group: 'masks',
    description:
      'Writes the Mask Path of an existing mask as a keyframe at a time (or as the static value when no time is given), from a rectangle, ellipse or vertex list, with easing. Two calls with different geometry make the mask animate between them. ' +
      'Use when: hand-building a wipe or a morphing cut-out. Do not use for: the standard reveals (mask-reveal-animation) or shape layers (set-shape-path). ' +
      'Inputs: layer; mask by name or index; shape rectangle, ellipse or points (inferred from rect, size or points); rect or size plus center in layer pixels; points[] with optional tangents and closed; padding; time or frame; easing describing the motion arriving at this key. ' +
      'Returns: the mask summary, the keyframe written (index, time, frame) and vertexCount. ' +
      'Notes: mask path keys interpolate vertex by vertex, so keep the same vertex count and order across keys (rectangle and ellipse both use four vertices). Undoable in one step. ' +
      'Example: mask 1, rect {x: 0, y: 0, width: 0, height: 1080}, frame 0; then rect {x: 0, y: 0, width: 1920, height: 1080}, frame 20, easing "ease-out".',
    input: { comp: CompRef.optional(), layer: LayerRef, mask: MaskRef, ...MaskGeometryArgs, ...TimeArgs, easing: Easing.optional() },
  });

  defineTool(server, {
    name: 'delete-mask',
    group: 'masks',
    description:
      'Removes one mask from a layer by name or index, with its path, feather, opacity and expansion keyframes. ' +
      'Use when: cleaning up an experiment or replacing a mask with a different one. Do not use for: hiding a mask temporarily (set-mask-properties with mode "none" keeps it) or shape groups on a shape layer. ' +
      'Inputs: layer; mask by name or index. ' +
      'Returns: the removed mask (index, name) and the remaining masks with their indices and names. ' +
      'Notes: indices of the masks below it shift up by one. Undoable in one step. ' +
      'Example: layer {name: "Photo"}, mask "Mask 2".',
    input: { comp: CompRef.optional(), layer: LayerRef, mask: MaskRef },
  });

  defineTool(server, {
    name: 'create-mask-from-shape-layer',
    group: 'masks',
    description:
      'Copies the path of a group on a shape layer onto another layer as a mask, translating the vertices from the shape layer\'s space into the target layer\'s space using both layers\' position and anchor point. Parametric rectangles, ellipses, polygons and stars are converted to bezier vertices. ' +
      'Use when: a shape layer was drawn (or text was outlined with convert-text-to-shapes) and the same outline should crop footage, a solid or a precomp. Do not use for: masks from scratch (create-mask). ' +
      'Inputs: layer (the target); shapeLayer; group by name or index on the shape layer (default first); mode, inverted, feather, opacity, expansion, name; time or frame at which the path is read. ' +
      'Returns: the new mask summary, the source group path, and the offset applied. ' +
      'Notes: best effort: rotation and scale on either layer, the group transform\'s rotation and scale, and rectangle roundness are ignored. Undoable in one step. ' +
      'Example: layer {name: "Footage"}, shapeLayer {name: "LOGO Outlines"}, group 1, feather 4.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      shapeLayer: LayerRef.describe('The shape layer to read the path from.'),
      group: ShapeGroupRef.optional(),
      ...MaskPropertyArgs,
      ...TimeArgs,
    },
  });

  defineTool(server, {
    name: 'mask-reveal-animation',
    group: 'masks',
    description:
      'Adds a rectangular mask covering the layer\'s bounds and keyframes it so the layer wipes on: from an edge (the mask grows in the chosen direction), from the centre outward, by feather (a soft resolve from blurred edges to sharp) or by expansion (the mask grows from nothing). ' +
      'Use when: revealing footage, a card, a photo or a precomp with a wipe. Do not use for: text (add-text-animator) or stroked paths (animate-trim-paths). ' +
      'Inputs: layer; direction right (grows from the left edge toward the right), left, down (grows from the top edge), up, center-out, feather or expansion; startTime or startFrame (default the layer in point); duration in seconds (default 1) or durationFrames; easing (default ease-out); padding in pixels around the bounds; featherAmount, the starting feather for direction "feather" (default 200); name; mode. ' +
      'Returns: the mask summary, the direction, the keyframes written per property, and the time range in seconds and frames. ' +
      'Notes: bounds come from sourceRectAtTime at the start time, so a layer whose content moves may need padding. The mask is new each call; delete-mask removes it. Undoable in one step. ' +
      'Example: layer {name: "Photo"}, direction "right", durationFrames 20.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      direction: z.enum(['left', 'right', 'up', 'down', 'center-out', 'feather', 'expansion']),
      startTime: z.number().optional().describe('Seconds. Default: the layer in point.'),
      startFrame: z.number().int().optional().describe('Frames; wins over startTime.'),
      duration: z.number().positive().optional().describe('Seconds. Default 1.'),
      durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
      easing: Easing.optional().describe('Default ease-out.'),
      padding: z.number().optional().describe('Pixels added around the bounds. Default 0.'),
      featherAmount: z.number().min(0).optional().describe('Starting feather for direction "feather". Default 200.'),
      name: z.string().optional().describe('Name for the mask that is created.'),
      mode: z.enum(MASK_MODES).optional(),
    },
  });
}
