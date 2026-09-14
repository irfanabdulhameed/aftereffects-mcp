/*
 * Keyframe tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef, Easing, KeyframeSpec, LayerRef, PropertyPath, Spatial, TimeArgs } from '../schemas/common.js';
import { defineTool } from './registry.js';

export function registerKeyframeTools(server: McpServer): void {
  defineTool(server, {
    name: 'set-keyframe',
    group: 'keyframes',
    description:
      'Sets one keyframe on any property of a layer (transform, effect, mask, text, shape) at a time or frame, with optional easing, straight or auto-bezier motion paths for spatial properties, and roving. ' +
      'Use when: adding or changing a single key. Do not use for: two or more keys on the same property (use set-keyframes-bulk, which is one round-trip and handles easing per segment) or effect keys by effect name (set-effect-keyframe also works but this tool covers it via the path). ' +
      'Inputs: layer; property path such as "Transform/Position" or "Effects/Gaussian Blur/Blurriness"; time in seconds or frame; value in the property\'s units; easing describing the motion arriving at this key; spatial "linear" (default) or "auto"; roving. ' +
      'Returns: the property state (path, value, keyframe count, expression) and the keyframe written with its index, time, frame, interpolation and ease. ' +
      'Notes: if the property has no keys yet, this creates the first one. Undoable in one step. ' +
      'Example: property "Transform/Opacity", frame 12, value 100, easing "ease-out".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      ...TimeArgs,
      value: z.unknown().describe('Value in the property\'s units.'),
      easing: Easing.optional(),
      spatial: Spatial.optional(),
      roving: z.boolean().optional().describe('Make the key rove across time (spatial properties only).'),
    },
  });

  defineTool(server, {
    name: 'set-keyframes-bulk',
    group: 'keyframes',
    description:
      'Writes many keyframes on one property in one round-trip, each with its own easing. This is the workhorse for animation: an entrance is two keys, a bounce is three or four. ' +
      'Use when: animating any property over time. Do not use for: many properties or many layers at once (use set-keyframes-multi or batch). ' +
      'Inputs: layer; property path; keys[] of {time or frame, value, easing?}; easing as the default for keys without their own; spatial "linear" (default straight motion paths) or "auto"; replace true to remove existing keys first; overshootAmount (default 0.12) and overshootPosition (default 0.75) tune the "overshoot" preset. ' +
      'Returns: the property state and every keyframe written with time, frame, value, interpolation and ease values. ' +
      'Notes: keys are sorted by time before writing. Easing on a key describes the segment arriving at it; "overshoot" inserts an extra key before it. Text values on Source Text keep the current style. Undoable in one step. ' +
      'Example: property "Transform/Position", keys [{frame: 0, value: [960, 700]}, {frame: 14, value: [960, 540], easing: "ease-out"}].',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      keys: z.array(KeyframeSpec).min(1).max(2000),
      easing: Easing.optional().describe('Default easing for keys that do not set their own.'),
      spatial: Spatial.optional(),
      replace: z.boolean().optional().describe('Remove all existing keys on the property first.'),
      overshootAmount: z.number().min(0).max(1).optional().describe('Fraction of the segment delta to overshoot by. Default 0.12.'),
      overshootPosition: z.number().min(0.1).max(0.95).optional().describe('Where in the segment the overshoot key sits. Default 0.75.'),
    },
  });

  defineTool(server, {
    name: 'set-keyframes-multi',
    group: 'keyframes',
    description:
      'Writes keyframes on many properties across many layers in one round-trip: an array of targets, each the same shape as set-keyframes-bulk. ' +
      'Use when: animating position and opacity on five layers, or applying the same motion to a list of layers with different values. Do not use for: one property (set-keyframes-bulk) or mixing in non-keyframe steps (batch). ' +
      'Inputs: targets[] of {comp?, layer, property, keys[], easing?, spatial?, replace?}; comp as a default for every target; stopOnError (default false, so independent targets still get written). ' +
      'Returns: per-target status with the layer, property path and keyframes written, and a failed count. ' +
      'Notes: all targets share one undo step. ' +
      'Example: targets for "Transform/Opacity" on layers 1 to 5 with the same two keys and staggered frames.',
    input: {
      comp: CompRef.optional(),
      targets: z
        .array(
          z.object({
            comp: CompRef.optional(),
            layer: LayerRef,
            property: PropertyPath,
            keys: z.array(KeyframeSpec).min(1),
            easing: Easing.optional(),
            spatial: Spatial.optional(),
            replace: z.boolean().optional(),
          })
        )
        .min(1)
        .max(500),
      stopOnError: z.boolean().optional(),
    },
  });

  defineTool(server, {
    name: 'get-keyframes',
    group: 'keyframes',
    mutating: false,
    description:
      'Lists the keyframes on one property: for each key the index, time, frame, value, in and out interpolation, ease speed and influence per dimension, roving, and spatial tangents where they apply, plus the property\'s expression state. ' +
      'Use when: reading the timing of a reference animation to reproduce it, or verifying what set-keyframes-bulk wrote. Do not use for: finding which properties are animated (use list-layers with includeKeyframes). ' +
      'Inputs: layer, property path. ' +
      'Returns: composition, layer, property with keyframes[]. ' +
      'Notes: read-only. ' +
      'Example: property "Transform/Position" on the reference comp\'s title layer.',
    input: { comp: CompRef.optional(), layer: LayerRef, property: PropertyPath },
  });
}
