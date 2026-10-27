/*
 * Layer style tools (group 'styles'): Drop Shadow, Inner Shadow, Outer Glow,
 * Inner Glow, Bevel and Emboss, Satin, Color Overlay, Gradient Overlay and
 * Stroke. Adding, changing (static or keyed), turning off and listing.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toRgba } from '../schemas/color.js';
import { Color, CompRef, Easing, LayerRef, TimeArgs, Vec2 } from '../schemas/common.js';
import { defineTool } from './registry.js';

/* ------------------------------------------------------------------ schemas */

export const LAYER_STYLE_KINDS = ['drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'bevel-emboss', 'satin', 'color-overlay', 'gradient-overlay', 'stroke'] as const;
export type LayerStyleKind = (typeof LAYER_STYLE_KINDS)[number];

/** Blend modes offered by the layer style Blend Mode menus. */
export const STYLE_BLEND_MODES = [
  'normal', 'dissolve', 'darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color', 'lighten', 'screen', 'color-dodge', 'linear-dodge', 'lighter-color',
  'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
] as const;

const StyleBlendMode = z.enum(STYLE_BLEND_MODES);

export const GradientStop = z
  .union([Color, z.object({ color: Color, location: z.number().min(0).max(100).optional().describe('Percent along the gradient. Default: evenly spaced.') })])
  .describe('A colour, or {color, location} with location in percent.');

/** Every setting a style can take. Which ones apply depends on the kind (see STYLE_SETTINGS_BY_KIND). */
export const StyleSettingFields = {
  color: Color.optional().describe('Style colour.'),
  opacity: z.number().min(0).max(100).optional().describe('Percent.'),
  blendMode: StyleBlendMode.optional().describe('Blend mode of the style.'),
  angle: z.number().optional().describe('Light angle in degrees; 90 casts a shadow straight down, 120 down and to the right. Gradient Overlay: the direction the gradient runs, 90 = first colour at the bottom, last at the top.'),
  useGlobalLight: z.boolean().optional().describe('Use the layer\'s Global Light angle. Default false whenever angle is given.'),
  distance: z.number().min(0).optional().describe('Offset in pixels.'),
  spread: z.number().min(0).max(100).optional().describe('Spread in percent (Choke for Inner Shadow and Inner Glow).'),
  size: z.number().min(0).optional().describe('Blur size in pixels (stroke width for Stroke).'),
  noise: z.number().min(0).max(100).optional().describe('Percent.'),
  layerKnocksOut: z.boolean().optional().describe('Drop Shadow: hide the shadow behind a semi-transparent layer. After Effects default on.'),
  technique: z.enum(['softer', 'precise', 'smooth', 'chisel-hard', 'chisel-soft']).optional().describe('Glows: softer or precise. Bevel and Emboss: smooth, chisel-hard or chisel-soft.'),
  range: z.number().min(1).max(100).optional().describe('Glow Range in percent.'),
  jitter: z.number().min(0).max(100).optional().describe('Glow Jitter in percent.'),
  source: z.enum(['center', 'edge']).optional().describe('Inner Glow source.'),
  bevelStyle: z.enum(['outer-bevel', 'inner-bevel', 'emboss', 'pillow-emboss', 'stroke-emboss']).optional(),
  depth: z.number().min(1).max(1000).optional().describe('Bevel depth in percent.'),
  direction: z.enum(['up', 'down']).optional().describe('Bevel direction.'),
  soften: z.number().min(0).optional().describe('Bevel soften in pixels.'),
  altitude: z.number().min(0).max(90).optional().describe('Bevel light altitude in degrees.'),
  highlightMode: StyleBlendMode.optional(),
  highlightColor: Color.optional(),
  highlightOpacity: z.number().min(0).max(100).optional().describe('Percent.'),
  shadowMode: StyleBlendMode.optional(),
  shadowColor: Color.optional(),
  shadowOpacity: z.number().min(0).max(100).optional().describe('Percent.'),
  invert: z.boolean().optional().describe('Satin: invert the sheen.'),
  colors: z
    .array(GradientStop)
    .min(2)
    .max(16)
    .optional()
    .describe('Gradient Overlay stops, first to last. Scripts cannot set layer-style gradient colours, so these are drawn by a Gradient Ramp effect named "Gradient Overlay Colors" (first and last stop).'),
  gradientStyle: z.enum(['linear', 'radial', 'angle', 'reflected', 'diamond']).optional(),
  reverse: z.boolean().optional().describe('Gradient Overlay: swap the ends.'),
  alignWithLayer: z.boolean().optional().describe('Gradient Overlay: fit the gradient to the layer bounds.'),
  scale: z.number().min(10).max(150).optional().describe('Gradient Overlay scale in percent.'),
  offset: Vec2.optional().describe('Gradient Overlay offset [x, y] in pixels.'),
  smoothness: z.number().min(0).max(100).optional().describe('Gradient smoothness in percent.'),
  position: z.enum(['outside', 'inside', 'center']).optional().describe('Stroke position.'),
};

export const StyleSettings = z
  .object(StyleSettingFields)
  .strict()
  .describe('Style settings. Only the fields that belong to the kind are accepted.');
export type StyleSettingsInput = z.input<typeof StyleSettings>;

export type StyleSettingName = keyof typeof StyleSettingFields;

const SHADOW: StyleSettingName[] = ['color', 'opacity', 'blendMode', 'angle', 'useGlobalLight', 'distance', 'spread', 'size', 'noise'];
const GLOW: StyleSettingName[] = ['color', 'opacity', 'blendMode', 'noise', 'spread', 'size', 'technique', 'range', 'jitter'];

export const STYLE_SETTINGS_BY_KIND: Record<LayerStyleKind, StyleSettingName[]> = {
  'drop-shadow': [...SHADOW, 'layerKnocksOut'],
  'inner-shadow': [...SHADOW],
  'outer-glow': [...GLOW],
  'inner-glow': [...GLOW, 'source'],
  'bevel-emboss': ['bevelStyle', 'technique', 'depth', 'direction', 'size', 'soften', 'angle', 'useGlobalLight', 'altitude', 'highlightMode', 'highlightColor', 'highlightOpacity', 'shadowMode', 'shadowColor', 'shadowOpacity'],
  satin: ['color', 'opacity', 'blendMode', 'angle', 'distance', 'size', 'invert'],
  'color-overlay': ['color', 'opacity', 'blendMode'],
  'gradient-overlay': ['colors', 'opacity', 'blendMode', 'angle', 'gradientStyle', 'reverse', 'alignWithLayer', 'scale', 'offset', 'smoothness'],
  stroke: ['color', 'size', 'opacity', 'blendMode', 'position'],
};

const GLOW_TECHNIQUES = ['softer', 'precise'];
const BEVEL_TECHNIQUES = ['smooth', 'chisel-hard', 'chisel-soft'];
const COLOR_SETTINGS = new Set<string>(['color', 'highlightColor', 'shadowColor']);

/** Settings that can be keyframed with set-layer-style (all except the gradient colours). */
export const KEYABLE_STYLE_SETTINGS = (Object.keys(StyleSettingFields) as StyleSettingName[]).filter((k) => k !== 'colors') as [StyleSettingName, ...StyleSettingName[]];

/** Throws when a setting does not belong to the kind, or a technique does not match it. */
export function checkStyleSettings(kind: LayerStyleKind, settings: Record<string, unknown> | undefined, label = 'settings'): void {
  if (!settings) return;
  const allowed = STYLE_SETTINGS_BY_KIND[kind];
  const wrong = Object.keys(settings).filter((k) => settings[k] !== undefined && !allowed.includes(k as StyleSettingName));
  if (wrong.length) throw new Error(`${label}: ${wrong.join(', ')} ${wrong.length > 1 ? 'do' : 'does'} not apply to ${kind}. ${kind} takes: ${allowed.join(', ')}.`);
  const tech = settings.technique;
  if (typeof tech === 'string') {
    const ok = kind === 'bevel-emboss' ? BEVEL_TECHNIQUES : GLOW_TECHNIQUES;
    if (!ok.includes(tech)) throw new Error(`${label}: technique "${tech}" does not apply to ${kind}. Use ${ok.join(' or ')}.`);
  }
}

export const LayerSet = z
  .union([z.array(LayerRef).min(1).max(200), z.object({ selected: z.literal(true) }), z.object({ all: z.literal(true) })])
  .describe('Several layers: an array of layer references, {selected: true} or {all: true}.');

/** Exactly one of layer or layers. */
function requireLayerTarget(args: { layer?: unknown; layers?: unknown }): void {
  if (args.layer !== undefined && args.layers !== undefined) throw new Error('Pass layer or layers, not both.');
  if (args.layer === undefined && args.layers === undefined) throw new Error('Pass layer (one layer) or layers (an array, {selected: true} or {all: true}).');
}

export const StyleKeyframe = z
  .object({
    setting: z.enum(KEYABLE_STYLE_SETTINGS).describe('Which setting to key, for example "opacity", "distance", "size" or "color".'),
    ...TimeArgs,
    value: z.unknown().describe('Value in the setting\'s units: a number, true or false, a menu name such as "multiply", [x, y] for offset, or a colour for the colour settings.'),
    easing: Easing.optional().describe('Motion arriving at this key. Default: speed 0, influence 80 arriving and 30 leaving. Menus and checkboxes hold.'),
  })
  .refine((k) => k.time !== undefined || k.frame !== undefined, { message: 'Each keyframe needs time (seconds) or frame.' });

/** Validates each keyframe value against its setting and normalises colours to [r, g, b, a]. */
export function prepareStyleKeyframes<K extends { setting: string; value?: unknown }>(kind: LayerStyleKind, keys: K[]): Array<K & { value: unknown }> {
  return keys.map((k, i) => {
    if (k.value === undefined || k.value === null) throw new Error(`keyframes[${i}]: value is required.`);
    checkStyleSettings(kind, { [k.setting]: k.value }, `keyframes[${i}]`);
    const field = (StyleSettingFields as Record<string, z.ZodTypeAny>)[k.setting];
    const inner = field instanceof z.ZodOptional ? field.unwrap() : field;
    const parsed = inner.safeParse(k.value);
    if (!parsed.success) throw new Error(`keyframes[${i}]: bad value for ${k.setting}: ${parsed.error.issues.map((x: z.ZodIssue) => x.message).join('; ')}`);
    const value: unknown = COLOR_SETTINGS.has(k.setting) ? toRgba(k.value) : parsed.data;
    return { ...k, value };
  });
}

/* -------------------------------------------------------------------- tools */

export function registerStyleTools(server: McpServer): void {
  defineTool(server, {
    name: 'add-layer-style',
    group: 'styles',
    description:
      'Turns on a layer style (drop-shadow, inner-shadow, outer-glow, inner-glow, bevel-emboss, satin, color-overlay, gradient-overlay or stroke) on one or many layers and sets it. ' +
      'Use when: a card, button or title needs a shadow, glow, bevel, overlay or outline. Do not use for: the Drop Shadow or Glow effects (apply-effect-template) or changing a style that is on (set-layer-style). ' +
      'Inputs: layer or layers; kind; settings (color, opacity, blendMode, angle, distance, spread, size, noise and kind-specific fields); fillOpacity; useDefaults; allowMenuCommand (default true). ' +
      'Returns: count, failed, and per layer the settings read back, whether it was added now, and the method. ' +
      'Notes: idempotent; a style already on only gets the given settings. New styles start from designed defaults: drop-shadow black 12 %, angle 90, distance 6, size 24; inner-shadow 10 %, distance 2, size 6; outer-glow white 35 %, size 30; stroke 1 px black 10 % inside. A style new to a layer may need the Layer Styles menu command, which opens the comp in the viewer and selects the layer briefly; both are restored. Gradient colours are drawn by a Gradient Ramp effect. Undoable in one step. ' +
      'Example: layer {name: "Card"}, kind "drop-shadow", settings {opacity: 14, size: 30}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.optional(),
      layers: LayerSet.optional(),
      kind: z.enum(LAYER_STYLE_KINDS),
      settings: StyleSettings.optional(),
      fillOpacity: z.number().min(0).max(100).optional().describe('Blending Options > Fill Opacity in percent. 0 hides the layer\'s own pixels and keeps its styles (outline-only text with a Stroke).'),
      useDefaults: z.boolean().optional().describe('Apply the designed defaults under the given settings. Default true when the style is added now, false when it was already on.'),
      allowMenuCommand: z.boolean().optional().describe('Allow the Layer Styles menu command (viewer and selection) when the style cannot be turned on through its property. Default true; false fails instead.'),
    },
    toBridgeArgs: (args) => {
      requireLayerTarget(args);
      checkStyleSettings(args.kind, args.settings as Record<string, unknown> | undefined);
      return args;
    },
  });

  defineTool(server, {
    name: 'set-layer-style',
    group: 'styles',
    description:
      'Changes the settings of a layer style that is already on a layer, as static values or as keyframes with easing, for example a shadow that grows as a card lifts or a glow that pulses once. ' +
      'Use when: adjusting or animating an existing shadow, glow, bevel, overlay or stroke. Do not use for: turning a style on (add-layer-style) or off (remove-layer-style). ' +
      'Inputs: layer; kind; settings, the static values (same fields as add-layer-style); keyframes [{setting, time or frame, value, easing}]; replaceKeys (default false) clears the keyed settings first; fillOpacity. ' +
      'Returns: the settings read back, the fields changed, the keyframes written per setting with property paths, and notes. ' +
      'Notes: fails with not-found when the style was never added. A setting that already has keys gets a key at the current time instead of a static value. Number keys land softly (speed 0, influence 80 arriving, 30 leaving) unless easing is given; menus and checkboxes hold. Gradient colours go to the Gradient Ramp effect and cannot be keyed here. Undoable in one step. ' +
      'Example: layer {name: "Card"}, kind "drop-shadow", keyframes [{setting: "distance", frame: 0, value: 4}, {setting: "distance", frame: 12, value: 16}].',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      kind: z.enum(LAYER_STYLE_KINDS),
      settings: StyleSettings.optional(),
      keyframes: z.array(StyleKeyframe).max(200).optional(),
      replaceKeys: z.boolean().optional().describe('Remove the existing keys of each keyed setting first. Default false.'),
      fillOpacity: z.number().min(0).max(100).optional().describe('Blending Options > Fill Opacity in percent.'),
    },
    toBridgeArgs: (args) => {
      checkStyleSettings(args.kind, args.settings as Record<string, unknown> | undefined);
      const hasSettings = !!args.settings && Object.keys(args.settings).length > 0;
      const hasKeys = !!args.keyframes && args.keyframes.length > 0;
      if (!hasSettings && !hasKeys && args.fillOpacity === undefined) throw new Error('Pass settings, keyframes, fillOpacity or a combination.');
      const keyframes = args.keyframes ? prepareStyleKeyframes(args.kind, args.keyframes) : undefined;
      return { ...args, keyframes };
    },
  });

  defineTool(server, {
    name: 'remove-layer-style',
    group: 'styles',
    description:
      'Turns a layer style off, or every layer style on the layer off, on one or many layers. The style stays in the Layer Styles group with its settings, switched off, so add-layer-style can turn it back on unchanged. ' +
      'Use when: a shadow or glow is no longer wanted, or to compare a layer with and without its styles. Do not use for: hiding the layer (set-layer-flags) or changing a style (set-layer-style). ' +
      'Inputs: layer or layers; kind, or all true for every style. ' +
      'Returns: count, failed, and per layer the styles turned off and the ones that were already off or never added. ' +
      'Notes: After Effects has no script call that deletes a layer style, so styles are switched off (the eye in the timeline). For gradient-overlay, the Gradient Ramp effect that add-layer-style made for the colours is switched off too. Idempotent. Undoable in one step. ' +
      'Example: layer {name: "Card"}, kind "drop-shadow".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.optional(),
      layers: LayerSet.optional(),
      kind: z.enum(LAYER_STYLE_KINDS).optional(),
      all: z.boolean().optional().describe('true turns every style on the layer off.'),
    },
    toBridgeArgs: (args) => {
      requireLayerTarget(args);
      if (!args.kind && args.all !== true) throw new Error('Pass kind, or all: true.');
      if (args.kind && args.all === true) throw new Error('Pass kind or all: true, not both.');
      return args;
    },
  });

  defineTool(server, {
    name: 'list-layer-styles',
    group: 'styles',
    mutating: false,
    description:
      'Lists the layer styles on one or many layers: which of the nine kinds are on, off or never added, every setting read back by its friendly name (colours as hex, menus by name), keyframe counts, and the Blending Options values (global light angle and altitude, fill opacity). ' +
      'Use when: before set-layer-style, to see the current values; or to check what add-layer-style produced. Do not use for: effects (list-layer-effects) or text styling (get-text). ' +
      'Inputs: layer, or layers (an array, {selected: true} or {all: true}); includeOff (default true) also lists styles that are switched off. ' +
      'Returns: per layer the styles [{kind, label, on, path, settings, keyed}], blendingOptions, and colorsEffect when a Gradient Ramp draws the gradient colours. ' +
      'Notes: read-only. Layer-style gradient colours cannot be read by script and show as null. Cameras and lights have no layer styles and report an error entry. ' +
      'Example: layer {name: "Card"}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.optional(),
      layers: LayerSet.optional(),
      includeOff: z.boolean().optional().describe('List styles that are added but switched off. Default true.'),
    },
    toBridgeArgs: (args) => {
      requireLayerTarget(args);
      return args;
    },
  });
}
