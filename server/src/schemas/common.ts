/*
 * Schemas shared by every tool. Import these instead of redefining them.
 *
 * CompRef      which composition. Omit for the active composition.
 * LayerRef     which layer inside that composition.
 * PropertyPath a display-name or matchName path such as "Transform/Position".
 * Easing       a named preset, a custom speed/influence pair, or a cubic-bezier.
 * Color        see ./color.ts
 * TimeArgs     time in seconds, or frame (integer, wins when both are given).
 */

import { z } from 'zod';
export { Color, toRgba, toHex } from './color.js';

export const CompRef = z
  .object({
    id: z.number().int().optional().describe('Composition item id from list-compositions. Highest precedence.'),
    name: z.string().optional().describe('Composition name, exact match first, then case-insensitive.'),
    active: z.boolean().optional().describe('true selects the composition open in the viewer. Also the default when nothing else is given.'),
  })
  .describe('Which composition. Precedence: id, then name, then the active composition.');
export type CompRefInput = z.input<typeof CompRef>;

export const LayerRef = z
  .object({
    index: z.number().int().positive().optional().describe('1-based layer index as shown in the timeline (1 is the top layer). Highest precedence.'),
    name: z.string().optional().describe('Layer name. Exact match first, then case-insensitive. Errors if more than one layer has that name.'),
    id: z.number().int().optional().describe('Layer id from list-layers. Stable across reordering.'),
  })
  .describe('Which layer. Precedence: index, then id, then name. Get indices from list-layers first.');
export type LayerRefInput = z.input<typeof LayerRef>;

export const PropertyPath = z
  .union([z.string(), z.array(z.union([z.string(), z.number().int().positive()])).min(1)])
  .describe(
    'Property path from the layer root, using "/" between levels. Display names or matchNames both work, ' +
      'for example "Transform/Position", "Effects/Gaussian Blur/Blurriness", "Text/Source Text", "Masks/Mask 1/Mask Path", ' +
      'or "ADBE Transform Group/ADBE Position". A bare transform name such as "Opacity" is also accepted. ' +
      'An array of names or 1-based indices is accepted too.'
  );

export const EASING_PRESETS = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'smooth',
  'snappy',
  'overshoot',
  'hold',
] as const;
export type EasingPreset = (typeof EASING_PRESETS)[number];

export const CustomEase = z.object({
  type: z.literal('custom'),
  inSpeed: z.number().optional().describe('Speed of the incoming handle at the arriving key. Default 0.'),
  inInfluence: z.number().min(0.1).max(100).optional().describe('Influence of the incoming handle, 0.1 to 100. Default 33.33.'),
  outSpeed: z.number().optional().describe('Speed of the outgoing handle at the previous key. Default 0.'),
  outInfluence: z.number().min(0.1).max(100).optional().describe('Influence of the outgoing handle, 0.1 to 100. Default 33.33.'),
});

export const BezierEase = z.object({
  type: z.literal('bezier'),
  x1: z.number().min(0).max(1),
  y1: z.number(),
  x2: z.number().min(0).max(1),
  y2: z.number(),
});

export const Easing = z
  .union([
    z.enum(EASING_PRESETS),
    z.string().regex(/^@style\.[A-Za-z0-9_.-]+$/).describe('A reference into the style file, for example "@style.entrance".'),
    CustomEase,
    BezierEase,
  ])
  .describe(
    'How the motion arrives at this keyframe (the segment from the previous key to this one). ' +
      'Presets: linear, ease (Easy Ease 33/33), ease-in (slow start), ease-out (slow end, use for entrances), ease-in-out, ' +
      'smooth (continuous through the key), snappy (75 out, 25 in), overshoot (adds a small overshoot key before this one), hold. ' +
      'Or {type:"custom", inSpeed, inInfluence, outSpeed, outInfluence}, or {type:"bezier", x1,y1,x2,y2} like CSS cubic-bezier. ' +
      'Or "@style.<name>" to use an easing from the style file.'
  );
export type EasingInput = z.input<typeof Easing>;

export const Vec2 = z.tuple([z.number(), z.number()]).describe('[x, y]');
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]).describe('[x, y, z]');
export const Vec2or3 = z.union([Vec2, Vec3]).describe('[x, y] or [x, y, z]');

export const TimeArgs = {
  time: z.number().optional().describe('Time in seconds from the composition start.'),
  frame: z.number().int().optional().describe('Frame number from the composition start. Wins over time when both are given.'),
};

export const KeyframeSpec = z.object({
  time: z.number().optional().describe('Seconds.'),
  frame: z.number().int().optional().describe('Frame number, wins over time.'),
  value: z.unknown().describe('Value in the property\'s own units: number, [x,y], [x,y,z], [r,g,b,a], or text.'),
  easing: Easing.optional(),
});

export const Spatial = z
  .enum(['linear', 'auto'])
  .describe('For Position and Anchor Point: "linear" (default) gives straight motion paths, "auto" lets After Effects auto-bezier the path.');

export const LayerTarget = {
  comp: CompRef.optional(),
  layer: LayerRef,
};

export const CompTarget = {
  comp: CompRef.optional(),
};

/** Blend modes accepted by set-layer-blend-mode. */
export const BLEND_MODES = [
  'normal', 'dissolve', 'dancing-dissolve', 'darken', 'multiply', 'color-burn', 'classic-color-burn', 'linear-burn', 'darker-color',
  'add', 'lighten', 'screen', 'color-dodge', 'classic-color-dodge', 'linear-dodge', 'lighter-color',
  'overlay', 'soft-light', 'hard-light', 'linear-light', 'vivid-light', 'pin-light', 'hard-mix',
  'difference', 'classic-difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
  'stencil-alpha', 'stencil-luma', 'silhouette-alpha', 'silhouette-luma', 'alpha-add', 'luminescent-premul',
] as const;

export const TRACK_MATTES = ['none', 'alpha', 'alpha-inverted', 'luma', 'luma-inverted'] as const;

export const LABEL_COLORS = [
  'none', 'red', 'yellow', 'aqua', 'pink', 'lavender', 'peach', 'sea-foam', 'blue', 'green', 'purple', 'orange', 'brown', 'fuchsia', 'cyan', 'sandstone', 'dark-green',
] as const;
