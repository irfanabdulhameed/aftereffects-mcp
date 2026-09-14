/*
 * Shape tools: creating shape layers and groups, fills, strokes, paths,
 * modifiers (trim paths, repeater and the rest), and reading the Contents tree.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, Easing, LayerRef, PropertyPath, TimeArgs, Vec2 } from '../schemas/common.js';
import { PlacementArgs } from './layers.js';
import { defineTool } from './registry.js';

export const ShapeGeometryArgs = {
  shapeType: z.enum(['rectangle', 'rounded-rectangle', 'ellipse', 'circle', 'polygon', 'star', 'line', 'arrow', 'path']).optional().describe('Default rectangle.'),
  size: Vec2.optional().describe('[width, height] in pixels. Default [200, 200]. For circle only width is used.'),
  roundness: z.number().min(0).optional().describe('Corner radius for rectangles.'),
  cornerRadii: z.array(z.number()).length(4).optional().describe('Per-corner radii; After Effects rectangles are uniform, so the largest is used.'),
  points: z.union([z.number().int().min(3), z.array(Vec2).min(2)]).optional().describe('Point count for polygon/star, or an array of [x,y] vertices for path.'),
  outerRadius: z.number().optional().describe('Outer radius for polygon and star, pixels.'),
  innerRadius: z.number().optional().describe('Inner radius for star, pixels.'),
  outerRoundness: z.number().optional().describe('Outer roundness for polygon and star, percent.'),
  from: Vec2.optional().describe('Line start, relative to the layer position.'),
  to: Vec2.optional().describe('Line end.'),
  headSize: z.number().optional().describe('Arrow head size.'),
  shaftWidth: z.number().optional().describe('Arrow shaft width.'),
  closed: z.boolean().optional().describe('Close a custom path. Default true.'),
  inTangents: z.array(Vec2).optional(),
  outTangents: z.array(Vec2).optional(),
  fillColor: Color.optional().describe('Default white.'),
  fillOpacity: z.number().min(0).max(100).optional().describe('Fill opacity, percent. Default 100.'),
  noFill: z.boolean().optional().describe('Create no fill.'),
  strokeColor: Color.optional(),
  strokeWidth: z.number().min(0).optional().describe('0 (default) means no stroke.'),
  strokeOpacity: z.number().min(0).max(100).optional().describe('Stroke opacity, percent. Default 100.'),
  lineCap: z.enum(['butt', 'round', 'square']).optional(),
  lineJoin: z.enum(['miter', 'round', 'bevel']).optional(),
  dashes: z.array(z.number()).optional().describe('[dash, gap] in pixels.'),
  groupName: z.string().optional().describe('Name for the shape group.'),
};

export const ShapeGroupRef = z
  .union([z.string().describe('Group name as shown under Contents, for example "Group 1", or a matchName.'), z.number().int().positive().describe('1-based position of the item in Contents.')])
  .describe('Which group under the shape layer\'s Contents: name or 1-based index. Default: the first group.');

export const SHAPE_MODIFIERS = ['trim-paths', 'offset-paths', 'round-corners', 'pucker-bloat', 'wiggle-paths', 'wiggle-transform', 'twist', 'zig-zag', 'repeater', 'merge-paths'] as const;

const FromTo = z.object({ from: z.number(), to: z.number() }).describe('{from, to} values for the start and end of the animation.');

export function registerShapeTools(server: McpServer): void {
  defineTool(server, {
    name: 'create-shape-layer',
    group: 'shapes',
    description:
      'Creates a shape layer with one group containing a rectangle, rounded rectangle, ellipse, circle, polygon, star, line, arrow or custom path, with an optional fill and stroke (colour, width, caps, joins, dashes). The path is centred on the layer anchor, and the layer is positioned at the comp centre unless told otherwise. ' +
      'Use when: building cards, buttons, lines, connectors, icons, backgrounds and masks-as-shapes. Do not use for: adding a second shape to an existing shape layer (add-shape-to-layer) or modifiers like trim paths (add-shape-modifier). ' +
      'Inputs: shapeType and its geometry (size, roundness, points, from/to, headSize); fillColor, noFill, strokeColor, strokeWidth, lineCap, lineJoin, dashes; the shared placement fields (name, position, timing, parent, above, below). ' +
      'Returns: the layer summary plus the property paths of the group, path, fill and stroke, ready for set-keyframes-bulk or set-shape-fill. ' +
      'Notes: coordinates for path vertices are relative to the layer position. Undoable in one step. ' +
      'Example: shapeType "rounded-rectangle", size [720, 140], roundness 28, fillColor "#111111", strokeColor "#ffffff", strokeWidth 3.',
    input: { comp: CompRef.optional(), ...ShapeGeometryArgs, ...PlacementArgs },
  });

  defineTool(server, {
    name: 'add-shape-to-layer',
    group: 'shapes',
    description:
      'Adds another group with one shape (rectangle, ellipse, polygon, star, line, arrow or custom path) plus optional fill and stroke to an existing shape layer, offset from the layer origin by the group\'s own Position. ' +
      'Use when: building an icon or diagram from several shapes on one layer, or adding a stroke-only outline next to a filled shape. Do not use for: a new layer (create-shape-layer) or changing an existing group\'s fill or stroke (set-shape-fill, set-shape-stroke). ' +
      'Inputs: layer (must be a shape layer); the same geometry and fill/stroke fields as create-shape-layer; offset [x, y] in pixels applied to the new group\'s transform Position; groupName. ' +
      'Returns: composition, layer reference, the new group (name, index, path), the path, fill and stroke property paths, the shape info and the total group count. ' +
      'Notes: vertices for shapeType "path" are relative to the group origin before offset. Undoable in one step. ' +
      'Example: layer {name: "Icon"}, shapeType "circle", size [40, 40], offset [120, 0], fillColor "#ff5a36".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      ...ShapeGeometryArgs,
      offset: Vec2.optional().describe('[x, y] pixels for the group transform Position. Default [0, 0].'),
    },
  });

  defineTool(server, {
    name: 'set-shape-fill',
    group: 'shapes',
    description:
      'Sets the fill of a group on a shape layer: solid colour, opacity and fill rule, or switches the group to a gradient fill with type, start and end points. Adds a fill if the group has none. ' +
      'Use when: recolouring a card or icon, fading a shape\'s fill, or turning a flat fill into a gradient. Do not use for: strokes (set-shape-stroke) or text colour (set-text-style). ' +
      'Inputs: layer; group by name or index (default the first group); color; opacity in percent; fillRule "non-zero" or "even-odd"; gradient {type "linear" or "radial", start [x, y], end [x, y], stops[] of {position 0 to 1, color}}. ' +
      'Returns: the fill property path, its current values, the fields changed and warnings. ' +
      'Notes: After Effects scripting cannot write gradient colour stops, so stops are accepted but reported in warnings and left at the default; set them in the Gradient Editor. Requesting a gradient replaces a solid fill and vice versa. Undoable in one step. ' +
      'Example: layer {name: "Card"}, color "#1e90ff", opacity 85.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      group: ShapeGroupRef.optional(),
      color: Color.optional(),
      opacity: z.number().min(0).max(100).optional().describe('Percent.'),
      fillRule: z.enum(['non-zero', 'even-odd']).optional(),
      gradient: z
        .object({
          type: z.enum(['linear', 'radial']).optional().describe('Default linear.'),
          start: Vec2.optional().describe('Start point in group pixels.'),
          end: Vec2.optional().describe('End point in group pixels.'),
          stops: z.array(z.object({ position: z.number().min(0).max(1), color: Color })).optional().describe('Colour stops. Not writable by scripting; reported in warnings.'),
        })
        .optional(),
    },
  });

  defineTool(server, {
    name: 'set-shape-stroke',
    group: 'shapes',
    description:
      'Sets the stroke of a group on a shape layer: colour, width, opacity, line cap, line join, miter limit and dash pattern. Adds a stroke if the group has none. ' +
      'Use when: outlining a shape, preparing a line for a trim-paths draw-on, or making a dashed border. Do not use for: fills (set-shape-fill) or text strokes (set-text-style). ' +
      'Inputs: layer; group by name or index (default first); color; width in pixels; opacity in percent; lineCap butt, round or square; lineJoin miter, round or bevel; miterLimit; dashes as [dash, gap, dash, gap, ...] up to three pairs, in pixels; dashOffset. ' +
      'Returns: the stroke property path, its values, the fields changed and notes. ' +
      'Notes: a new stroke defaults to white, 2 px. Dash entries are added to the Dashes group only when given; existing entries are updated in place. Undoable in one step. ' +
      'Example: layer {name: "Line"}, color "#ffffff", width 6, lineCap "round", dashes [20, 12].',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      group: ShapeGroupRef.optional(),
      color: Color.optional(),
      width: z.number().min(0).optional().describe('Pixels.'),
      opacity: z.number().min(0).max(100).optional().describe('Percent.'),
      lineCap: z.enum(['butt', 'round', 'square']).optional(),
      lineJoin: z.enum(['miter', 'round', 'bevel']).optional(),
      miterLimit: z.number().min(1).optional().describe('Miter limit for miter joins. Default 4.'),
      dashes: z.array(z.number().min(0)).max(6).optional().describe('[dash, gap, ...] in pixels.'),
      dashOffset: z.number().optional().describe('Pixels.'),
    },
  });

  defineTool(server, {
    name: 'set-shape-path',
    group: 'shapes',
    description:
      'Replaces the vertices of a bezier Path on a shape layer, as a static value or as a keyframe at a time for path morphing. ' +
      'Use when: drawing a custom outline, or morphing one shape into another by keying two vertex sets with the same point count. Do not use for: parametric Rectangle or Ellipse paths (their size lives on Size; this tool reports them) or masks (set-mask-path-keyframe). ' +
      'Inputs: layer; group by name or index, or pathProperty as a full property path such as "Contents/Group 1/Path 1/Path"; points[] of [x, y] in group pixels; inTangents[] and outTangents[] (same length, relative to each vertex, default straight); closed (default true); time or frame plus easing to write a keyframe instead. ' +
      'Returns: the path property state, vertexCount, closed, and the keyframe when one was written. ' +
      'Notes: for a morph, both keys must have the same vertex count and order. If the property already has keys and no time is given, a key is set at the current time. Undoable in one step. ' +
      'Example: group "Group 1", points [[-100, -100], [100, -100], [0, 100]], frame 24, easing "ease-in-out".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      group: ShapeGroupRef.optional(),
      pathProperty: PropertyPath.optional().describe('Explicit path to a Path property. Wins over group.'),
      points: z.array(Vec2).min(2),
      inTangents: z.array(Vec2).optional(),
      outTangents: z.array(Vec2).optional(),
      closed: z.boolean().optional().describe('Default true.'),
      ...TimeArgs,
      easing: Easing.optional(),
    },
  });

  defineTool(server, {
    name: 'add-shape-modifier',
    group: 'shapes',
    description:
      'Adds a shape modifier to a shape layer, either inside one group or at the root of Contents so it applies to every group, and sets its properties by display name. Types: trim-paths, offset-paths, round-corners, pucker-bloat, wiggle-paths, wiggle-transform, twist, zig-zag, repeater, merge-paths. ' +
      'Use when: rounding corners, offsetting an outline, adding jitter, or any modifier not covered by animate-trim-paths and add-repeater. Do not use for: keyframed draw-ons (animate-trim-paths) or copies with a transform (add-repeater). ' +
      'Inputs: layer; type; group by name or index, or omit it (or pass root true) for the layer root; params keyed by display name, for example {"Radius": 20} for round-corners, {"Amount": 12} for offset-paths, {"Size": 10, "Detail": 5} for wiggle-paths, {"Angle": 45} for twist, {"Mode": 2} for merge-paths; name. ' +
      'Returns: the modifier (name, matchName, path, index), its top-level properties with values, params applied and notes for names not found. ' +
      'Notes: a modifier inside a group affects the paths above it in that group. Numeric enum values are used for menu properties. Undoable in one step. ' +
      'Example: type "round-corners", group "Group 1", params {"Radius": 24}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      type: z.enum(SHAPE_MODIFIERS),
      group: ShapeGroupRef.optional(),
      root: z.boolean().optional().describe('Add at the Contents root so the modifier applies to every group. Default when group is omitted.'),
      params: z.record(z.unknown()).optional().describe('Property values keyed by display name.'),
      name: z.string().optional().describe('Rename the modifier.'),
    },
  });

  defineTool(server, {
    name: 'animate-trim-paths',
    group: 'shapes',
    description:
      'Adds Trim Paths to a shape layer (if missing) and keyframes its Start, End and Offset between from and to values over a time range, producing the classic draw-on or wipe of a stroked path. ' +
      'Use when: drawing a line, underline, circle or outline on screen, or erasing it. Do not use for: masks (mask-reveal-animation) or text (add-text-animator). ' +
      'Inputs: layer; group by name or index, or the layer root by default; start, end and offset each as {from, to}; start and end are percent (0 to 100), offset is degrees (360 is one full lap round the path); startTime or startFrame (default the layer in point); duration in seconds (default 1) or durationFrames; easing (default ease-out); trimMultipleShapes "simultaneously" or "individually". ' +
      'Returns: the modifier path, the keyframes written per property, and the time range in seconds and frames. ' +
      'Notes: the typical draw-on is end {from: 0, to: 100}, which is the default when nothing is given. The path needs a stroke to be visible. Undoable in one step. ' +
      'Example: layer {name: "Underline"}, end {from: 0, to: 100}, durationFrames 18.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      group: ShapeGroupRef.optional(),
      start: FromTo.optional(),
      end: FromTo.optional(),
      offset: FromTo.optional(),
      startTime: z.number().optional().describe('Seconds. Default: the layer in point.'),
      startFrame: z.number().int().optional().describe('Frames; wins over startTime.'),
      duration: z.number().positive().optional().describe('Seconds. Default 1.'),
      durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
      easing: Easing.optional().describe('Default ease-out.'),
      trimMultipleShapes: z.enum(['simultaneously', 'individually']).optional(),
    },
  });

  defineTool(server, {
    name: 'add-repeater',
    group: 'shapes',
    description:
      'Adds a Repeater to a shape layer (inside a group or at the root) that draws the shape several times, each copy offset by the repeater transform: position, scale, rotation, anchor point and start/end opacity. ' +
      'Use when: building rows of dots, radial arrays (rotation 360 / copies), grids, or fading trails from one shape. Do not use for: copies as separate layers (duplicate-layer). ' +
      'Inputs: layer; group by name or index (default root); copies (default 3); offset; transform {position [x, y] (default [100, 0]), scale [x, y] percent, rotation degrees, anchorPoint [x, y], startOpacity, endOpacity}; compositeOrder "below" or "above"; name. ' +
      'Returns: the repeater (name, matchName, path, index), its property values and notes. ' +
      'Notes: the transform is applied cumulatively per copy, so rotation 30 with 12 copies makes a full circle around the anchor point. Undoable in one step. ' +
      'Example: layer {name: "Dot"}, copies 8, transform {position [0, 0], rotation 45, anchorPoint [0, 150]}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      group: ShapeGroupRef.optional(),
      copies: z.number().min(0).optional().describe('Default 3.'),
      offset: z.number().optional().describe('Repeater Offset (shifts which copy is the original).'),
      transform: z
        .object({
          position: Vec2.optional().describe('Pixels per copy. Default [100, 0].'),
          scale: Vec2.optional().describe('Percent per copy.'),
          rotation: z.number().optional().describe('Degrees per copy.'),
          anchorPoint: Vec2.optional(),
          startOpacity: z.number().min(0).max(100).optional(),
          endOpacity: z.number().min(0).max(100).optional(),
        })
        .optional(),
      compositeOrder: z.enum(['below', 'above']).optional(),
      name: z.string().optional().describe('Name for the repeater.'),
    },
  });

  defineTool(server, {
    name: 'list-shape-groups',
    group: 'shapes',
    mutating: false,
    description:
      'Returns the Contents tree of a shape layer: every group with its paths, fills, strokes, gradient fills, transform and modifiers, and the modifiers at the root, each with name, matchName, kind, index and full property path. ' +
      'Use when: before set-shape-fill, set-shape-stroke, set-shape-path or add-shape-modifier, to get the group name or the exact path of a Path property; or after convert-text-to-shapes to see the per-glyph groups. Do not use for: layers that are not shape layers (it errors) or property values (get-layer-details). ' +
      'Inputs: layer; depth (default 3; 1 lists only the root items). ' +
      'Returns: composition, layer, groupCount, and contents[] of nodes {name, matchName, kind, index, path, enabled, children[]}. ' +
      'Notes: read-only. kind is one of group, path, rect, ellipse, star, fill, gradient-fill, stroke, gradient-stroke, transform, modifier, other. ' +
      'Example: layer {name: "LOGO Outlines"}, depth 2.',
    input: { comp: CompRef.optional(), layer: LayerRef, depth: z.number().int().min(1).max(8).optional().describe('Default 3.') },
  });
}
