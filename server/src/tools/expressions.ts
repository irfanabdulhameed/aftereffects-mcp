/*
 * Expression tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef, LayerRef, PropertyPath } from '../schemas/common.js';
import { defineTool } from './registry.js';

/** Built-in expression presets. Each name is a key of MCP.expr.presets in commands/expressions.jsx. */
export const EXPRESSION_PRESETS = [
  'wiggle', 'loop-out-cycle', 'loop-out-pingpong', 'loop-in', 'loop-out-offset', 'inertia-bounce', 'overshoot', 'elastic',
  'time-offset-by-index', 'follow-layer-with-delay', 'bounce-on-landing', 'auto-fade-in-out', 'scale-to-fit-text-box',
  'counter-number', 'typewriter-driver', 'sine-wave', 'random-hold', 'clamp-value', 'link-to-slider', 'link-to-checkbox', 'posterize-time',
] as const;
export type ExpressionPreset = (typeof EXPRESSION_PRESETS)[number];

export const EXPRESSION_CONTROL_TYPES = ['slider', 'checkbox', 'color', 'point', 'angle', 'dropdown', 'layer'] as const;

export function registerExpressionTools(server: McpServer): void {
  defineTool(server, {
    name: 'set-expression',
    group: 'expressions',
    description:
      'Sets an expression on any property and immediately reads back After Effects\' expression error, so a typo is reported in the same call rather than silently disabling the expression. ' +
      'Use when: adding loops, wiggle, inertia, links to sliders, or any procedural motion. Do not use for: the built-in library (use apply-expression-preset, which writes tested code) or removing (remove-expression). ' +
      'Inputs: layer; property path; expression source; enabled (default true). ' +
      'Returns: the property state with expressionState {hasExpression, expression, enabled, error} and a warning field when After Effects reports an error. ' +
      'Notes: the expression language depends on the project engine (JavaScript or legacy ExtendScript); get-ae-version reports it. Undoable in one step. ' +
      'Example: property "Transform/Position", expression "wiggle(2, 15)".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      expression: z.string().describe('Expression source code.'),
      enabled: z.boolean().optional().describe('Enable the expression. Default true.'),
    },
  });

  defineTool(server, {
    name: 'get-expression',
    group: 'expressions',
    mutating: false,
    description:
      'Reads the expression on a property, whether it is enabled, and any error After Effects reports for it. ' +
      'Use when: checking a reference comp, or confirming an expression after editing it. Do not use for: scanning a whole comp for broken expressions (use get-expression-errors). ' +
      'Inputs: layer, property path. ' +
      'Returns: property state with expressionState {hasExpression, expression, enabled, error}. ' +
      'Notes: read-only. ' +
      'Example: property "Effects/Slider Control/Slider".',
    input: { comp: CompRef.optional(), layer: LayerRef, property: PropertyPath },
  });

  defineTool(server, {
    name: 'remove-expression',
    group: 'expressions',
    description:
      'Removes the expression from a property, leaving its keyframes and static value as they are. ' +
      'Use when: replacing procedural motion with keyframes, or cleaning up a failed expression. Do not use for: temporarily switching it off (use set-expression-enabled). ' +
      'Inputs: layer, property path. ' +
      'Returns: the property state showing hasExpression false. ' +
      'Notes: undoable in one step. If you want the motion kept as keys, call bake-expression-to-keyframes instead. ' +
      'Example: property "Transform/Rotation".',
    input: { comp: CompRef.optional(), layer: LayerRef, property: PropertyPath },
  });

  defineTool(server, {
    name: 'set-expression-enabled',
    group: 'expressions',
    description:
      'Enables or disables an existing expression without deleting it (the same as the enable switch next to the stopwatch). ' +
      'Use when: comparing a property with and without its expression, or pausing wiggle while adjusting keys. Do not use for: properties with no expression (it errors so you notice). ' +
      'Inputs: layer, property path, enabled true or false. ' +
      'Returns: the property state with expressionState.enabled. ' +
      'Notes: undoable in one step. ' +
      'Example: property "Transform/Position", enabled false.',
    input: { comp: CompRef.optional(), layer: LayerRef, property: PropertyPath, enabled: z.boolean() },
  });

  defineTool(server, {
    name: 'get-expression-errors',
    group: 'expressions',
    mutating: false,
    description:
      'Scans a layer, a composition or the whole project for expressions that After Effects reports as broken and lists each one with its error text. ' +
      'Use when: a render shows a warning badge, after renaming layers or effects that expressions refer to, or as a check before rendering. Do not use for: reading one expression (get-expression). ' +
      'Inputs: scope "comp" (default, the given or active composition), "layer" (needs layer) or "project"; limit on the number of errors returned (default 500). ' +
      'Returns: the compositions scanned, layersScanned, propertiesWithExpressions, errorCount and errors[] of {comp, layer, path, expression (first 200 characters), error, enabled}. ' +
      'Notes: read-only. Property trees are walked to a depth of 8, which covers effects, masks, text animators and shape groups. Disabled expressions still report their last error. ' +
      'Example: scope "project".',
    input: {
      scope: z.enum(['layer', 'comp', 'project']).optional().describe('What to scan. Default comp.'),
      comp: CompRef.optional(),
      layer: LayerRef.optional().describe('Required when scope is layer.'),
      limit: z.number().int().positive().max(5000).optional().describe('Maximum errors to return. Default 500.'),
    },
  });

  defineTool(server, {
    name: 'list-expression-presets',
    group: 'expressions',
    mutating: false,
    description:
      'Lists the built-in expression presets that apply-expression-preset can write: name, what each does, its parameters with defaults, and the properties it suits. ' +
      'Use when: choosing between wiggle, loops, inertia, counters, typewriters and control links before applying one, or when a user asks what procedural motion is available. Do not use for: applying a preset (apply-expression-preset) or writing custom code (set-expression). ' +
      'Inputs: none. ' +
      'Returns: count and presets[] of {name, description, suits[], params[] of {name, defaultValue, description}}. ' +
      'Notes: read-only. The list comes from the bridge so it always matches what the panel can generate. ' +
      'Example: call with no arguments, then apply-expression-preset with preset "inertia-bounce".',
    input: {},
  });

  defineTool(server, {
    name: 'apply-expression-preset',
    group: 'expressions',
    description:
      'Writes a tested expression from the built-in library onto a property, filling in parameters, and reads back any error After Effects reports. ' +
      'Use when: adding wiggle, a loop, inertia or overshoot after the last key, a counter or typewriter on Source Text, an auto fade on Opacity, or a link to a slider or checkbox. Do not use for: expressions not in the library (set-expression). ' +
      'Inputs: layer; property path; preset name from list-expression-presets; params object with any of that preset\'s parameters (unset ones take defaults); enabled (default true). ' +
      'Returns: the property state with expressionState {hasExpression, expression, enabled, error}, the preset and resolved params, the generated code, and a warning when After Effects reports an error. ' +
      'Notes: the code adapts to the property\'s dimensions (1D, 2D or 3D) and starts with a comment naming the preset. follow-layer-with-delay needs params.layerName. Replaces any existing expression. Undoable in one step. ' +
      'Example: property "Transform/Scale", preset "overshoot", params {amplitude: 0.1}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      preset: z.enum(EXPRESSION_PRESETS).describe('Preset name. See list-expression-presets.'),
      params: z.record(z.unknown()).optional().describe('Preset parameters by name. Missing ones use the defaults.'),
      enabled: z.boolean().optional().describe('Enable the expression. Default true.'),
    },
  });

  defineTool(server, {
    name: 'add-expression-control',
    group: 'expressions',
    description:
      'Adds an expression control effect (slider, checkbox, colour, point, angle, dropdown or layer) to a layer, names it, sets its starting value, and returns the property path and expression snippet other expressions can use to read it. ' +
      'Use when: exposing a parameter that several expressions share, building a rig, or before apply-expression-preset with link-to-slider or link-to-checkbox. Do not use for: ordinary effects (apply-effect). ' +
      'Inputs: layer; type; name for the effect (default the control\'s standard name); value as a number, boolean, colour, [x, y] point or layer reference depending on type; items[] for a dropdown\'s menu entries. ' +
      'Returns: the effect with its property, control {type, name, matchName}, propertyPath such as "Effects/Speed/Slider", matchPath, the expression snippet effect("Speed")("Slider"), the value set, and notes. ' +
      'Notes: dropdown items need After Effects 2023 or later; on older versions the menu keeps its default items and a note says so. Adding the same control twice stacks a second copy. Undoable in one step. ' +
      'Example: type "slider", name "Speed", value 50.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      type: z.enum(EXPRESSION_CONTROL_TYPES).describe('Which control effect to add.'),
      name: z.string().optional().describe('Effect name shown in the timeline and used in expressions. Default the control\'s standard name.'),
      value: z.unknown().optional().describe('Starting value: number for slider and angle, boolean for checkbox, any colour form for color, [x, y] for point, layer ref or index for layer, 1-based item index for dropdown.'),
      items: z.array(z.string()).min(1).optional().describe('Dropdown menu entries in order. Dropdown only.'),
    },
  });
}
