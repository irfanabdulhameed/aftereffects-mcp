/*
 * Transform and property tools: read and write any property value, set
 * transform values or keyframes, anchor point, fit to comp, bounds,
 * separated dimensions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef, Easing, LayerRef, PropertyPath, TimeArgs, Vec2, Vec2or3, Vec3 } from '../schemas/common.js';
import { defineTool } from './registry.js';

export const ANCHOR_NAMES = ['center', 'top-left', 'top-center', 'top-right', 'center-left', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const;
export const FIT_MODES = ['width', 'height', 'both', 'cover'] as const;

const ScaleValue = z
  .union([z.number(), Vec2, Vec3])
  .describe('Scale in percent: a single number applies to every axis, or [x, y] or [x, y, z].');

export function registerTransformTools(server: McpServer): void {
  defineTool(server, {
    name: 'get-property-value',
    group: 'transform',
    mutating: false,
    description:
      'Reads one property of a layer: its current value, its value at a given time, the number of dimensions, whether it has keyframes, and its expression state. Works for transform, effect, mask, text and shape properties. ' +
      'Use when: checking a value before changing it, reading a reference layer, or confirming what an expression produces at a time. Do not use for: listing keyframes (get-keyframes) or the whole property tree (get-layer-details). ' +
      'Inputs: comp (optional); layer; property path such as "Transform/Position" or "Effects/Gaussian Blur/Blurriness"; time in seconds or frame (default: the current time). ' +
      'Returns: composition, layer, property (name, path, matchPath, value, valueType, numKeys, min and max where defined), valueAtTime, time, frame, dimensions, hasKeyframes and expression {hasExpression, expression, enabled, error}. ' +
      'Notes: read-only. valueAtTime includes the result of expressions; value does not. ' +
      'Example: property "Transform/Scale", frame 30.',
    input: { comp: CompRef.optional(), layer: LayerRef, property: PropertyPath, ...TimeArgs },
  });

  defineTool(server, {
    name: 'set-property-value',
    group: 'transform',
    description:
      'Sets one property of a layer to a value. If the property already has keyframes, a keyframe is written at the given time (or the current time) instead of overwriting the animation. ' +
      'Use when: changing any single value, static or animated, by path. Do not use for: several transform values at once (set-transform), a series of keyframes (set-keyframes-bulk) or effect settings by effect name (set-effect-property). ' +
      'Inputs: comp (optional); layer; property path; value in the property\'s own units (number, [x, y], [x, y, z], colour, or text for Source Text); time or frame for the keyframe; forceKeyframe true writes a keyframe even when the property has none; easing for the segment arriving at the new key. ' +
      'Returns: the property state, mode ("value" or "keyframe"), previousValue, and the keyframe written with its index when one was. ' +
      'Notes: a property with an expression keeps the expression; the value you set is its input. Colour properties accept hex, [r, g, b] or [r, g, b, a] in 0 to 1 or 0 to 255. Undoable in one step. ' +
      'Example: property "Effects/Gaussian Blur/Blurriness", value 25.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      value: z.unknown().refine((v) => v !== undefined, { message: 'value is required' }).describe('Value in the property\'s units.'),
      ...TimeArgs,
      forceKeyframe: z.boolean().optional().describe('Write a keyframe even when the property has none. Default false.'),
      easing: Easing.optional(),
    },
  });

  defineTool(server, {
    name: 'set-transform',
    group: 'transform',
    description:
      'Sets any subset of a layer\'s transform values in one call: position, anchorPoint, scale, rotation, xRotation, yRotation, zRotation, orientation and opacity. Values are written directly, or as keyframes when a time is given or the property is already animated. ' +
      'Use when: placing, sizing or fading a layer, or writing one pose at a time. Do not use for: a series of keys on one property (set-keyframes-bulk) or moving the anchor without the layer jumping (set-anchor-point). ' +
      'Inputs: comp (optional); layer; position [x, y] or [x, y, z] in comp pixels; anchorPoint in layer pixels; scale as a number (uniform) or [x, y] or [x, y, z] in percent; rotation in degrees (the Z rotation, also zRotation); xRotation and yRotation for 3D layers; orientation [x, y, z]; opacity 0 to 100; time or frame; easing for the keys. ' +
      'Returns: composition, the layer summary with transform, changed[], keyframed (true when keys were written) and time. ' +
      'Notes: a 2D value on a 3D layer keeps the current z. xRotation, yRotation and orientation are skipped on 2D layers and listed in skipped[]. Undoable in one step. ' +
      'Example: layer {name: "Card"}, position [960, 540], scale 80, opacity 100, frame 12, easing "ease-out".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      position: Vec2or3.optional().describe('Position in comp pixels.'),
      anchorPoint: Vec2or3.optional().describe('Anchor point in layer pixels.'),
      scale: ScaleValue.optional(),
      rotation: z.number().optional().describe('Rotation in degrees (Z rotation).'),
      xRotation: z.number().optional().describe('X rotation in degrees (3D layers).'),
      yRotation: z.number().optional().describe('Y rotation in degrees (3D layers).'),
      zRotation: z.number().optional().describe('Z rotation in degrees. Same as rotation.'),
      orientation: Vec3.optional().describe('Orientation [x, y, z] in degrees (3D layers).'),
      opacity: z.number().min(0).max(100).optional().describe('Opacity in percent.'),
      ...TimeArgs,
      easing: Easing.optional(),
    },
  });

  defineTool(server, {
    name: 'set-anchor-point',
    group: 'transform',
    description:
      'Moves a layer\'s anchor point, the pivot that scale and rotation happen around, to a numeric point or a named spot on the visible content, and by default adjusts Position so the layer stays where it is on screen. ' +
      'Use when: a scale-up should grow from the centre or a bar should grow from its left edge, before animating Scale or Rotation. Do not use for: moving the layer (set-transform position). ' +
      'Inputs: comp (optional); layer; anchor as [x, y] in layer pixels or a name: "center", "top-left", "top-center", "top-right", "center-left", "center-right", "bottom-left", "bottom-center", "bottom-right", measured on sourceRectAtTime; keepVisualPosition (default true); time or frame for measuring text and shape bounds (default current time). ' +
      'Returns: composition, layer, anchorPoint, position, previousAnchorPoint, previousPosition and sourceRect. ' +
      'Notes: the position correction uses the layer\'s Scale and Z rotation in 2D, so 3D rotations and parenting are not compensated. If Anchor Point or Position has keyframes, keyframes are set at the current time. Undoable in one step. ' +
      'Example: layer {name: "Bar"}, anchor "center-left".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      anchor: z.union([z.enum(ANCHOR_NAMES), Vec2, Vec3]).describe('Named spot on the content or [x, y] in layer pixels.'),
      keepVisualPosition: z.boolean().optional().describe('Adjust Position so the layer does not move on screen. Default true.'),
      ...TimeArgs,
    },
  });

  defineTool(server, {
    name: 'fit-layer-to-composition',
    group: 'transform',
    description:
      'Scales a layer so its visible content fits the composition: by width, by height, "both" (contain, the whole layer visible, aspect kept) or "cover" (fills the frame, aspect kept, edges may crop), and centres it. ' +
      'Use when: a photo or video has a different size from the comp, or a logo should fill the frame. Do not use for: exact pixel sizes (set-transform scale) or precomp sizes (set-composition-settings). ' +
      'Inputs: comp (optional); layer; mode "both" (default), "width", "height" or "cover"; center (default true) moves the content centre to the comp centre; margin in pixels kept free on every side (default 0). ' +
      'Returns: composition, layer, mode, scale, position, sourceRect and the fitted size in pixels. ' +
      'Notes: uses sourceRectAtTime at the current time, so text and shape layers fit their drawn bounds. Rotation and parenting are ignored. If Scale or Position has keyframes, keyframes are set at the current time. Undoable in one step. ' +
      'Example: layer {name: "photo.jpg"}, mode "cover".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      mode: z.enum(FIT_MODES).optional().describe('"both" (contain, default), "width", "height" or "cover".'),
      center: z.boolean().optional().describe('Centre the content in the comp. Default true.'),
      margin: z.number().min(0).optional().describe('Pixels kept free on every side. Default 0.'),
    },
  });

  defineTool(server, {
    name: 'get-layer-bounds',
    group: 'transform',
    mutating: false,
    description:
      'Returns where a layer\'s visible content sits: the source rectangle in layer pixels and its four corners and bounding box in composition pixels after anchor, position, scale and rotation. ' +
      'Use when: placing something next to a text layer, checking whether a layer is inside the frame, or measuring a title before animating it. Do not use for: changing anything; use align-layers, set-transform or set-anchor-point. ' +
      'Inputs: comp (optional); layer; time in seconds or frame (default: the current time; text and shapes change size over time). ' +
      'Returns: composition, layer, time, frame, sourceRect {left, top, width, height}, anchorPoint, position, scale, rotation, corners {topLeft, topRight, bottomRight, bottomLeft} in comp pixels, and bounds {left, top, right, bottom, width, height}. ' +
      'Notes: read-only. The transform is 2D: parenting, 3D rotation and cameras are ignored, and a note is returned for parented or 3D layers. Cameras and lights have no bounds and return an error. ' +
      'Example: layer {name: "Title"}, frame 0.',
    input: { comp: CompRef.optional(), layer: LayerRef, ...TimeArgs },
  });

  defineTool(server, {
    name: 'separate-dimensions',
    group: 'transform',
    description:
      'Splits a layer\'s Position into separate X Position and Y Position (and Z Position on 3D layers) properties that can be keyframed independently, or joins them back into one Position. ' +
      'Use when: animating a bounce on Y while X moves linearly, or when an expression should drive only one axis. Do not use for: reading position (get-property-value). ' +
      'Inputs: comp (optional); layer; separate true (default) to split, false to join. ' +
      'Returns: composition, layer, dimensionsSeparated and properties[], the property paths now available such as "Transform/X Position" and "Transform/Y Position", or "Transform/Position" when joined. ' +
      'Notes: existing keyframes are converted in both directions by After Effects. After separating, set-keyframes-bulk on "Transform/Position" fails; use the per-axis paths. Undoable in one step. ' +
      'Example: layer {name: "Ball"}, separate true, then set-keyframes-bulk on "Transform/Y Position".',
    input: { comp: CompRef.optional(), layer: LayerRef, separate: z.boolean().optional().describe('true (default) splits, false joins.') },
  });
}
