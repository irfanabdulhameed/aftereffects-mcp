/*
 * Expression tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef, LayerRef, PropertyPath } from '../schemas/common.js';
import { defineTool } from './registry.js';

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
}
