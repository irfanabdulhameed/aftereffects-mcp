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

// Shared shapes keep one short description: they repeat in most tools, so every word costs the client hundreds of times.
export const CompRef = z
  .object({ id: z.number().int().optional(), name: z.string().optional(), active: z.boolean().optional() })
  .describe('Composition: {id}, {name} (exact, then any case) or {active: true}. Default: the active composition.');
export type CompRefInput = z.input<typeof CompRef>;

export const LayerRef = z
  .object({ index: z.number().int().positive().optional(), name: z.string().optional(), id: z.number().int().optional() })
  .describe('Layer: {index} (1 = top), {id} (stable) or {name} (must be unique).');
export type LayerRefInput = z.input<typeof LayerRef>;

export const PropertyPath = z
  .union([z.string(), z.array(z.union([z.string(), z.number().int().positive()])).min(1)])
  .describe('Property path: "Transform/Position", "Effects/Gaussian Blur/Blurriness", "Text/Source Text", display or match names, or an array of names and 1-based indices.');

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
  inSpeed: z.number().optional(),
  inInfluence: z.number().min(0.1).max(100).optional(),
  outSpeed: z.number().optional(),
  outInfluence: z.number().min(0.1).max(100).optional(),
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
    z.string().regex(/^@style\.[A-Za-z0-9_.-]+$/),
    CustomEase,
    BezierEase,
  ])
  .describe(
    'Easing into this key: a preset (ease = Easy Ease, ease-out for entrances, snappy 75/25, overshoot adds a key, smooth continues through), ' +
      '{type:"custom", inSpeed, inInfluence, outSpeed, outInfluence} (influence 0.1-100, default 33.33, speeds 0), {type:"bezier", x1, y1, x2, y2} as CSS, or "@style.<name>".'
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
