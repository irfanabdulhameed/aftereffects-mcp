/*
 * Effect tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef, Easing, LayerRef, TimeArgs } from '../schemas/common.js';
import { defineTool } from './registry.js';

export const EffectRef = z
  .union([
    z.string().describe('Effect display name or matchName as it appears on the layer.'),
    z.number().int().positive().describe('1-based index in the layer\'s Effects group.'),
    z.object({ index: z.number().int().positive().optional(), name: z.string().optional(), matchName: z.string().optional() }),
  ])
  .describe('Which effect on the layer: name, matchName, index, or an object with one of those.');

export const EFFECT_TEMPLATES = [
  'gaussian-blur', 'directional-blur', 'color-balance', 'brightness-contrast', 'curves', 'glow', 'neon-glow', 'deep-glow-with-fallback',
  'drop-shadow', 'soft-shadow', 'long-shadow', 'outline', 'chromatic-aberration', 'film-grain', 'vignette', 'letterbox', 'posterize-time',
  'pixelate', 'motion-tile', 'linear-wipe-transition', 'radial-wipe-transition', 'venetian-blinds', 'desaturate', 'tint', 'lumetri-basic',
  'gradient-ramp', '4-color-gradient', 'fractal-noise-texture', 'turbulent-displace', 'wave-warp', 'cc-light-sweep', 'cinematic-look', 'text-pop',
] as const;

const EffectPropertyPath = z
  .union([z.string(), z.array(z.union([z.string(), z.number().int().positive()])).min(1)])
  .describe('Property under the effect: a display name such as "Blurriness", a nested path "Compositing Options/Effect Opacity", or an index.');

export function registerEffectsTools(server: McpServer): void {
  defineTool(server, {
    name: 'apply-effect',
    group: 'effects',
    description:
      'Adds an effect to a layer by display name or matchName and sets any of its properties in the same call. Idempotent by default: if the layer already carries that effect, the existing one is returned and updated instead of a duplicate being stacked; pass allowDuplicate true to stack. ' +
      'Use when: adding any single effect. Do not use for: the built-in looks (apply-effect-template), several layers (apply-effects-bulk), or .ffx files (apply-preset). ' +
      'Inputs: layer; effect, a display name ("Gaussian Blur") or matchName ("ADBE Gaussian Blur 2", more reliable); settings, an object of property name to value ("Blurriness": 25, colours in any form, layer references as {name} for layer-type properties); effectName to rename it; enabled; moveToIndex; includeProperties (default true) to return the property tree. ' +
      'Returns: created (true) or alreadyPresent (true), the effect with its index, matchName and top-level properties, which settings were applied, and notes for any that were not. ' +
      'Notes: unknown effect names fail with a hint to use list-available-effects. Undoable in one step. ' +
      'Example: layer {name: "Title"}, effect "ADBE Drop Shadow", settings {"Distance": 8, "Softness": 20}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      effect: z.string().describe('Display name or matchName of the effect to add.'),
      settings: z.record(z.unknown()).optional().describe('Property values to set right after adding, keyed by display name.'),
      effectName: z.string().optional().describe('Rename the effect instance.'),
      enabled: z.boolean().optional(),
      allowDuplicate: z.boolean().optional().describe('Stack a second copy even if the effect is already present. Default false.'),
      moveToIndex: z.number().int().positive().optional().describe('Position in the effect stack after adding.'),
      includeProperties: z.boolean().optional().describe('Return the effect property tree. Default true.'),
    },
  });

  defineTool(server, {
    name: 'apply-effects-bulk',
    group: 'effects',
    description:
      'Applies many effects to many layers in one round-trip. Each item has the same shape as apply-effect (layer, effect, settings, allowDuplicate). ' +
      'Use when: giving every layer in a group the same blur or shadow, or building a stack of effects on one layer. Do not use for: a single effect (apply-effect). ' +
      'Inputs: items[]; comp as the default for every item; stopOnError (default false). ' +
      'Returns: per-item status with the effect created or found, and a failed count. ' +
      'Notes: idempotent per item like apply-effect. One undo step. ' +
      'Example: items = five layers each with effect "ADBE Gaussian Blur 2" and settings {"Blurriness": 12}.',
    input: {
      comp: CompRef.optional(),
      items: z
        .array(
          z.object({
            comp: CompRef.optional(),
            layer: LayerRef,
            effect: z.string(),
            settings: z.record(z.unknown()).optional(),
            effectName: z.string().optional(),
            allowDuplicate: z.boolean().optional(),
            enabled: z.boolean().optional(),
          })
        )
        .min(1)
        .max(500),
      stopOnError: z.boolean().optional(),
    },
  });

  defineTool(server, {
    name: 'list-layer-effects',
    group: 'effects',
    mutating: false,
    description:
      'Lists the effects on a layer in stack order with index, name, matchName and enabled state, optionally with each effect\'s property tree and current values. ' +
      'Use when: before set-effect-property or remove-effect, to get the exact effect name and property names. Do not use for: effects available to install (list-available-effects). ' +
      'Inputs: layer; includeProperties (default false); depth (default 2). ' +
      'Returns: count and effects[]. ' +
      'Notes: read-only. ' +
      'Example: layer {index: 2}, includeProperties true.',
    input: { comp: CompRef.optional(), layer: LayerRef, includeProperties: z.boolean().optional(), depth: z.number().int().min(0).max(6).optional().describe('Property tree depth when includeProperties is true. Default 2.') },
  });

  defineTool(server, {
    name: 'list-available-effects',
    group: 'effects',
    mutating: false,
    description:
      'Lists the effects installed in this After Effects, including third-party plugins, with display name, matchName and category, filtered by a search word or a category. ' +
      'Use when: you are not sure of an effect\'s exact name or matchName, or want to know whether a plugin such as Deep Glow is installed. Do not use for: effects on a layer (list-layer-effects). ' +
      'Inputs: query, a case-insensitive substring of the name, matchName or category; category, for example "Blur & Sharpen"; maxResults (default 500). ' +
      'Returns: totalInstalled, returned, a categories count map, and effects[] with displayName, matchName, category. ' +
      'Notes: read-only. The result is cached inside the panel for the session. Prefer matchNames in later calls. ' +
      'Example: query "glow".',
    input: {
      query: z.string().optional().describe('Case-insensitive substring of the name, matchName or category.'),
      category: z.string().optional().describe('Category name such as "Blur & Sharpen".'),
      maxResults: z.number().int().positive().max(5000).optional().describe('Maximum effects to return. Default 500.'),
    },
  });

  defineTool(server, {
    name: 'get-effect-properties',
    group: 'effects',
    mutating: false,
    description:
      'Returns the full property tree of one effect with names, matchNames, paths, value types, current values, keyframe counts, expressions, and min and max where After Effects reports them. ' +
      'Use when: you need exact property names for set-effect-property or want to see a plugin\'s controls. Do not use for: the whole layer (get-layer-details). ' +
      'Inputs: layer; effect by name, matchName or index; depth (default 3). ' +
      'Returns: composition, layer, effect with properties[]. ' +
      'Notes: read-only. ' +
      'Example: effect "CC Light Sweep".',
    input: { comp: CompRef.optional(), layer: LayerRef, effect: EffectRef, depth: z.number().int().min(0).max(6).optional().describe('Property tree depth. Default 3.') },
  });

  defineTool(server, {
    name: 'set-effect-property',
    group: 'effects',
    description:
      'Sets one property on an effect: a static value, a keyframe at a time (with easing), or an expression. Layer-type properties (blur layer, displacement map layer) accept a layer reference. ' +
      'Use when: tuning an effect after apply-effect, or keying one control. Do not use for: several properties at once (set-effect-properties) or several keys (set-keyframes-bulk with the path "Effects/<name>/<property>"). ' +
      'Inputs: layer; effect; property name or nested path; value; time or frame to key instead of set; easing for that key; expression. ' +
      'Returns: the property state, the previous value, and the keyframe if one was written. ' +
      'Notes: if the property already has keys and no time is given, a key is set at the current time. Colours accept any colour form. Undoable in one step. ' +
      'Example: effect "Gaussian Blur", property "Blurriness", value 0, frame 20, easing "ease-out".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      effect: EffectRef,
      property: EffectPropertyPath,
      value: z.unknown().optional().describe('Value in the property\'s units. Colours in any form; layer properties accept a layer reference.'),
      ...TimeArgs,
      easing: Easing.optional(),
      expression: z.string().optional().describe('Expression source to set on the property.'),
    },
  });

  defineTool(server, {
    name: 'set-effect-properties',
    group: 'effects',
    description:
      'Sets many properties on one effect from a name to value object, and optionally toggles the effect. ' +
      'Use when: configuring an effect with several controls (Drop Shadow distance, softness, direction and colour). Do not use for: keyframes (set-effect-property with time, or set-keyframes-bulk). ' +
      'Inputs: layer; effect; settings object keyed by property display name; enabled. ' +
      'Returns: the effect with its top-level properties, the list applied, and notes for names that were not found. ' +
      'Notes: names are matched exactly first, then case-insensitively, then by depth-first search, so nested controls can be named directly. Undoable in one step. ' +
      'Example: effect "Drop Shadow", settings {"Distance": 12, "Softness": 30, "Shadow Color": "#000000"}.',
    input: { comp: CompRef.optional(), layer: LayerRef, effect: EffectRef, settings: z.record(z.unknown()), enabled: z.boolean().optional() },
  });

  defineTool(server, {
    name: 'set-effect-keyframe',
    group: 'effects',
    description:
      'Sets a keyframe on an effect property at a time or frame with easing, using the same easing model as layer keyframes. ' +
      'Use when: animating one effect control with a single key. Do not use for: two or more keys (set-keyframes-bulk with property "Effects/<effect>/<property>" writes them in one call). ' +
      'Inputs: layer; effect; property; value; time or frame; easing. ' +
      'Returns: the property state and the keyframe written. ' +
      'Notes: undoable in one step. ' +
      'Example: effect "Glow", property "Glow Intensity", value 2.5, frame 0, then again with value 0 at frame 24 and easing "ease-out".',
    input: { comp: CompRef.optional(), layer: LayerRef, effect: EffectRef, property: EffectPropertyPath, value: z.unknown().describe("Value in the property's units."), ...TimeArgs, easing: Easing.optional() },
  });

  defineTool(server, {
    name: 'remove-effect',
    group: 'effects',
    description:
      'Removes one effect from a layer, identified by its display name, matchName or position in the effect stack. ' +
      'Use when: undoing an experiment, replacing an effect with a different one, or cleaning up a layer before copying its look elsewhere. Do not use for: clearing everything (remove-all-effects) or disabling temporarily so it can be compared (toggle-effect). ' +
      'Inputs: layer; effect by name, matchName or 1-based index. ' +
      'Returns: the removed effect (index, name, matchName) and the names of the effects that remain, in order. ' +
      'Notes: keyframes and expressions on the effect go with it. Undoable in one step. ' +
      'Example: layer {name: "Title"}, effect "Gaussian Blur".',
    input: { comp: CompRef.optional(), layer: LayerRef, effect: EffectRef },
  });

  defineTool(server, {
    name: 'remove-all-effects',
    group: 'effects',
    description:
      'Removes every effect from a layer in one call, leaving transform, masks, text and layer styles untouched. ' +
      'Use when: resetting a layer before rebuilding its look, or stripping effects a preset added that you do not want. Do not use for: one effect (remove-effect) or switching effects off while keeping them (toggle-effect). ' +
      'Inputs: layer. ' +
      'Returns: how many effects were removed and their names and matchNames, in stack order. ' +
      'Notes: layer styles are not effects and stay. Keyframes and expressions on the removed effects are lost; undo brings everything back in one step. ' +
      'Example: layer {name: "Card"}.',
    input: { comp: CompRef.optional(), layer: LayerRef },
  });

  defineTool(server, {
    name: 'reorder-effect',
    group: 'effects',
    description:
      'Moves an effect to a new position in the layer\'s effect stack. Order matters: a blur before a glow looks different from a glow before a blur. ' +
      'Use when: fixing render order after adding effects. Do not use for: ordering layers (move-layer). ' +
      'Inputs: layer; effect; toIndex, or toTop, or toBottom. ' +
      'Returns: the effect\'s new index and the whole stack order. ' +
      'Notes: undoable in one step. ' +
      'Example: effect "Drop Shadow", toBottom true.',
    input: { comp: CompRef.optional(), layer: LayerRef, effect: EffectRef, toIndex: z.number().int().positive().optional().describe('1-based position in the effect stack.'), toTop: z.boolean().optional(), toBottom: z.boolean().optional() },
  });

  defineTool(server, {
    name: 'toggle-effect',
    group: 'effects',
    description:
      'Enables or disables an effect without removing it, the same as the fx switch next to the effect name. ' +
      'Use when: comparing a frame with and without an effect (see-frame twice), or disabling a heavy effect such as a large glow while previewing other work. Do not use for: removal (remove-effect) or effect opacity (set-effect-property on "Compositing Options/Effect Opacity"). ' +
      'Inputs: layer; effect by name, matchName or index; enabled true or false, or omit it to flip the current state. ' +
      'Returns: the effect summary with its index, matchName and enabled state. ' +
      'Notes: undoable in one step. ' +
      'Example: effect "Deep Glow", enabled false.',
    input: { comp: CompRef.optional(), layer: LayerRef, effect: EffectRef, enabled: z.boolean().optional() },
  });

  defineTool(server, {
    name: 'copy-effects',
    group: 'effects',
    description:
      'Copies all or selected effects, with their values, keyframes and expressions, from one layer to one or more other layers, in the same or another composition. ' +
      'Use when: applying a finished look to sibling layers. Do not use for: presets on disk (apply-preset). ' +
      'Inputs: fromLayer; toLayer or toLayers[] (or {selected: true}); toComp (optional); effects[] to copy only some, by name, matchName or index. ' +
      'Returns: per target and effect, ok or unavailable (when a plugin is missing). ' +
      'Notes: layer-reference properties are copied by index, which may point at a different layer in another comp. Undoable in one step. ' +
      'Example: fromLayer {name: "Title"}, toLayers [{name: "Subtitle"}, {name: "Tag"}].',
    input: {
      comp: CompRef.optional(),
      fromLayer: LayerRef,
      toLayer: LayerRef.optional(),
      toLayers: z.union([z.array(LayerRef), z.object({ selected: z.boolean().optional(), all: z.boolean().optional() })]).optional(),
      toComp: CompRef.optional(),
      effects: z.array(EffectRef).optional(),
    },
  });

  defineTool(server, {
    name: 'apply-effect-template',
    group: 'effects',
    description:
      'Applies one of the built-in looks, each a tested stack of stock effects with sensible values: blurs, shadows (drop, soft, long), outline, glows (glow, neon-glow, deep-glow-with-fallback), grain, vignette, letterbox, posterize-time, pixelate, motion-tile, wipe transitions (linear, radial, venetian-blinds, keyframed over start and duration), desaturate, tint, lumetri-basic, gradient-ramp, 4-color-gradient, fractal-noise-texture, turbulent-displace, wave-warp, cc-light-sweep, cinematic-look, text-pop. ' +
      'Use when: you want the look, not the parameter hunt. Do not use for: an effect not covered (apply-effect) or your own .ffx (apply-preset). ' +
      'Inputs: layer; template name; params, an object of the template\'s parameters (list-effect-templates shows names, defaults and meanings). Unknown params fail before anything changes. ' +
      'Returns: the effects added and notes, including which glow was used by deep-glow-with-fallback. ' +
      'Notes: a zero value is respected. Templates are not idempotent; applying twice stacks. Undoable in one step. ' +
      'Example: template "soft-shadow", params {opacity: 40, softness: 80}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      template: z.enum(EFFECT_TEMPLATES),
      params: z.record(z.unknown()).optional().describe('Template parameters. See list-effect-templates.'),
    },
  });

  defineTool(server, {
    name: 'list-effect-templates',
    group: 'effects',
    mutating: false,
    description:
      'Lists the built-in effect templates with a description of each look and every parameter\'s name, default value and meaning, so you can call apply-effect-template without guessing. ' +
      'Use when: choosing a look for apply-effect-template, checking a parameter name, or telling the human what looks are available. Do not use for: effects installed in After Effects (list-available-effects) or presets on disk (list-presets). ' +
      'Inputs: none. ' +
      'Returns: count and templates[] with name, description and params[] of {name, defaultValue, description}. ' +
      'Notes: read-only. Template names are stable and also appear as the template enum of apply-effect-template. ' +
      'Example: call it once, then apply-effect-template "vignette" with params {amount: 45}.',
    input: {},
  });
}
