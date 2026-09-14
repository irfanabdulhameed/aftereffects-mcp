/*
 * Keyframe tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef, Easing, KeyframeSpec, LayerRef, PropertyPath, Spatial, TimeArgs } from '../schemas/common.js';
import { defineTool } from './registry.js';

/** Which keyframes on a property a tool acts on: every key, a list of 1-based indices, or a time range. */
export const KeySelection = z
  .union([
    z.literal('all'),
    z.array(z.number().int().positive()).min(1).max(5000).describe('1-based key indices as returned by get-keyframes.'),
    z.object({
      from: z.number().optional().describe('Range start in seconds. Default the first key.'),
      to: z.number().optional().describe('Range end in seconds, inclusive. Default the last key.'),
      fromFrame: z.number().int().optional().describe('Range start in frames. Wins over from.'),
      toFrame: z.number().int().optional().describe('Range end in frames, inclusive. Wins over to.'),
    }),
  ])
  .describe('"all" (default), an array of 1-based key indices, or {from, to} in seconds ({fromFrame, toFrame} in frames), inclusive with half a frame of tolerance.');

const LayersSpec = z
  .union([z.array(LayerRef).min(1), z.object({ selected: z.boolean().optional(), all: z.boolean().optional(), indices: z.array(z.number().int().positive()).optional(), names: z.array(z.string()).optional() })])
  .describe('Layers to act on: an array of layer refs, {selected: true}, {all: true}, {indices: [...]} or {names: [...]}.');

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

  defineTool(server, {
    name: 'delete-keyframe',
    group: 'keyframes',
    description:
      'Deletes one keyframe on a property, chosen by its 1-based index or by the time or frame it sits on. ' +
      'Use when: removing a stray key or an overshoot key that no longer fits. Do not use for: several keys in a time span (delete-keyframes-in-range) or every key (clear-keyframes). ' +
      'Inputs: layer; property path such as "Transform/Position"; index (1-based, from get-keyframes) or time in seconds or frame (frame wins). A key matches a time when it is within half a frame of it. ' +
      'Returns: the property state, the removed keyframe (time, frame, value) and the keyframes that remain with their new indices. ' +
      'Notes: indices shift down after a deletion, so re-read them before deleting again by index. Errors with the list of key times when nothing sits at the given time. Undoable in one step. ' +
      'Example: property "Transform/Opacity", frame 12.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      index: z.number().int().positive().optional().describe('1-based key index. Wins over time and frame.'),
      ...TimeArgs,
    },
  });

  defineTool(server, {
    name: 'delete-keyframes-in-range',
    group: 'keyframes',
    description:
      'Deletes every keyframe on a property whose time falls inside a range, inclusive at both ends. ' +
      'Use when: clearing the second half of an animation before rebuilding it, or trimming keys that fall after a layer was shortened. Do not use for: one key (delete-keyframe) or all keys (clear-keyframes, which also keeps a value). ' +
      'Inputs: layer; property path; start and end in seconds, or startFrame and endFrame in frames (frames win). Default start is 0 and default end is the composition duration. Keys within half a frame of either end count as inside. ' +
      'Returns: the property state, removedCount, the removed key times, the range used, and the keyframes that remain. ' +
      'Notes: removing zero keys is not an error; check removedCount. Undoable in one step. ' +
      'Example: property "Transform/Position", startFrame 30, endFrame 60.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      start: z.number().optional().describe('Range start in seconds. Default 0.'),
      end: z.number().optional().describe('Range end in seconds, inclusive. Default the composition duration.'),
      startFrame: z.number().int().optional().describe('Range start in frames. Wins over start.'),
      endFrame: z.number().int().optional().describe('Range end in frames, inclusive. Wins over end.'),
    },
  });

  defineTool(server, {
    name: 'clear-keyframes',
    group: 'keyframes',
    description:
      'Removes every keyframe from a property and leaves it holding the value it had at a chosen time, so the layer does not jump when the animation is stripped. ' +
      'Use when: converting an animated property back to a static one, or resetting before writing a new animation with set-keyframes-bulk (which can also do this with replace true). Do not use for: removing a subset of keys (delete-keyframes-in-range). ' +
      'Inputs: layer; property path; keepValueAtTime in seconds or keepValueAtFrame (frame wins), default the current composition time; keepValue false to skip the value read and let After Effects keep whatever it has. ' +
      'Returns: the property state with the final static value, removedCount, keptValue and keptValueAt. ' +
      'Notes: the kept value is the keyframed value before any expression. A property with no keys returns removedCount 0. Undoable in one step. ' +
      'Example: property "Transform/Scale", keepValueAtFrame 24.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      keepValueAtTime: z.number().optional().describe('Seconds; the value at this time becomes the static value. Default the current composition time.'),
      keepValueAtFrame: z.number().int().optional().describe('Frame; wins over keepValueAtTime.'),
      keepValue: z.boolean().optional().describe('Default true. false removes the keys without setting a value afterwards.'),
    },
  });

  defineTool(server, {
    name: 'move-keyframes',
    group: 'keyframes',
    description:
      'Shifts keyframes in time by an offset, or stretches their spacing by a scale factor about a pivot time, keeping every key\'s value, interpolation, ease, spatial tangents and roving. ' +
      'Use when: an animation starts too early, needs to line up with a marker, or should play faster or slower. Do not use for: changing the layer\'s in and out points (set-layer-timing) or retiming footage (set-speed). ' +
      'Inputs: layer; property path; keys "all" (default), indices or a {from, to} range; offset in seconds or offsetFrames (frames win); scale factor (2 doubles the spacing, 0.5 halves it) with pivot in seconds or pivotFrame (default the first selected key); snapToFrame true to round the new times to whole frames. ' +
      'Returns: the property state, movedCount, the from and to time of each key, how many unselected keys were overwritten by a landing key, and the full keyframe list. ' +
      'Notes: implemented by reading, removing and re-adding the keys, so a moved key that lands on an unselected key replaces it. Keys may move before time 0. Undoable in one step. ' +
      'Example: property "Transform/Position", offsetFrames 10.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      keys: KeySelection.optional(),
      offset: z.number().optional().describe('Seconds to shift the keys by; negative moves earlier.'),
      offsetFrames: z.number().int().optional().describe('Frames to shift the keys by. Wins over offset.'),
      scale: z.number().positive().optional().describe('Multiply each key\'s distance from the pivot by this. 2 makes the animation twice as long.'),
      pivot: z.number().optional().describe('Pivot time in seconds for scale. Default the first selected key.'),
      pivotFrame: z.number().int().optional().describe('Pivot frame for scale. Wins over pivot.'),
      snapToFrame: z.boolean().optional().describe('Round new key times to whole frames. Default false.'),
    },
  });

  defineTool(server, {
    name: 'set-keyframe-easing',
    group: 'keyframes',
    description:
      'Applies one easing to existing keyframes without changing their times or values. The easing describes the segment arriving at each selected key, and the first selected key also gets it on its outgoing side. ' +
      'Use when: smoothing an animation that was written linear, or trying a different feel on keys that already exist. Do not use for: writing new keys (set-keyframes-bulk takes easing per key) or switching to hold (set-keyframe-interpolation). ' +
      'Inputs: layer; property path; easing as a preset name ("ease-out", "snappy"), {type: "custom", inSpeed, inInfluence, outSpeed, outInfluence} or {type: "bezier", x1, y1, x2, y2}; keys "all" (default), indices or a {from, to} range. ' +
      'Returns: the property state, which indices were changed, and the keyframes with their ease values. ' +
      'Notes: "overshoot" here behaves like a strong ease-out and does not insert a key. Undoable in one step. ' +
      'Example: property "Transform/Position", easing "ease-in-out".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      easing: Easing,
      keys: KeySelection.optional(),
    },
  });

  defineTool(server, {
    name: 'copy-keyframes',
    group: 'keyframes',
    description:
      'Copies every keyframe from one property to another property, layer or composition, keeping times (plus an optional offset), values (optionally multiplied), interpolation, ease and spatial tangents. ' +
      'Use when: giving a second layer the same motion as a reference, or moving an animation from Position to Anchor Point. Do not use for: many layers with a time stagger (stagger-keyframes-across-layers) or copying effects (copy-effects). ' +
      'Inputs: fromLayer and fromProperty; toLayer (default the same layer), toProperty (default the same property path), toComp (default the same composition); timeOffset in seconds or frameOffset (frames win, measured in the target composition); valueMultiplier as a number or a per-dimension array; replace true to clear the target keys first. ' +
      'Returns: the target property state, the source reference, copiedCount and the target keyframes. ' +
      'Notes: the source and target must have the same number of dimensions (Position to Position, Opacity to a slider); otherwise the call fails with both dimension counts. Without replace, copied keys merge with existing ones and overwrite keys at the same time. Undoable in one step. ' +
      'Example: fromLayer {name: "Title"}, fromProperty "Transform/Position", toLayer {name: "Subtitle"}, frameOffset 6.',
    input: {
      comp: CompRef.optional().describe('Composition holding the source layer. Default the active composition.'),
      fromLayer: LayerRef,
      fromProperty: PropertyPath,
      toLayer: LayerRef.optional().describe('Target layer. Default the source layer (or the layer with the same name in toComp).'),
      toProperty: PropertyPath.optional().describe('Target property path. Default the same path as fromProperty.'),
      toComp: CompRef.optional().describe('Target composition. Default the source composition.'),
      timeOffset: z.number().optional().describe('Seconds added to every copied key time.'),
      frameOffset: z.number().int().optional().describe('Frames added to every copied key time. Wins over timeOffset.'),
      valueMultiplier: z.union([z.number(), z.array(z.number()).min(1).max(4)]).optional().describe('Multiply copied values: one number for all dimensions or one per dimension.'),
      replace: z.boolean().optional().describe('Remove existing keys on the target first. Default false.'),
    },
  });

  defineTool(server, {
    name: 'reverse-keyframes',
    group: 'keyframes',
    description:
      'Reverses keyframes in time so the animation plays backwards: key times are mirrored about the midpoint of the selected span and in and out ease, interpolation and spatial tangents are swapped. ' +
      'Use when: turning an entrance into an exit, or an open into a close. Do not use for: reversing footage playback (reverse-layer). ' +
      'Inputs: layer; property path; keys "all" (default), indices or a {from, to} range. At least two keys are needed. ' +
      'Returns: the property state, reversedCount, the span that was mirrored, and the resulting keyframes. ' +
      'Notes: the first and last selected keys keep their times and swap values. Held segments stay held. Selecting non-adjacent indices can drop a mirrored key onto an unselected one. Undoable in one step. ' +
      'Example: property "Transform/Scale", keys "all".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      keys: KeySelection.optional(),
    },
  });

  defineTool(server, {
    name: 'set-keyframe-interpolation',
    group: 'keyframes',
    description:
      'Sets the interpolation type of existing keyframes to hold, linear or bezier. ' +
      'Use when: making a value snap instead of blend (hold), removing easing (linear), or re-enabling bezier handles before set-keyframe-easing. Do not use for: adjusting ease amounts (set-keyframe-easing). ' +
      'Inputs: layer; property path; type "hold", "linear" or "bezier"; keys "all" (default), indices or a {from, to} range. ' +
      'Returns: the property state, the indices changed and the keyframes with their inInterpolation and outInterpolation. ' +
      'Notes: hold sets only the outgoing side, so the segment after each selected key holds its value; the incoming side is left as it was. linear and bezier set both sides. Undoable in one step. ' +
      'Example: property "Text/Source Text", type "hold".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      type: z.enum(['hold', 'linear', 'bezier']).describe('Interpolation to apply.'),
      keys: KeySelection.optional(),
    },
  });

  defineTool(server, {
    name: 'bake-expression-to-keyframes',
    group: 'keyframes',
    description:
      'Converts an expression into keyframes by sampling the property every few frames, then removes the expression and writes the samples as linear keys. ' +
      'Use when: an expression must be edited by hand in the timeline, sent to a renderer that cannot evaluate it, or frozen so later edits do not change it. Do not use for: keeping the expression (set-expression-enabled false pauses it instead). ' +
      'Inputs: layer; property path with an expression; start and end in seconds or startFrame and endFrame (frames win), default the layer in and out points; step in frames between samples (default 1); allowLarge true to write more than 5000 keys. ' +
      'Returns: the property state, the removed expression source, sampleCount, the range and step used, and the first and last keyframe. ' +
      'Notes: existing keyframes on the property are replaced by the samples, since the samples already include them. Fails when the property has no expression. Undoable in one step. ' +
      'Example: property "Transform/Position", step 2.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      property: PropertyPath,
      start: z.number().optional().describe('First sample time in seconds. Default the layer in point.'),
      end: z.number().optional().describe('Last sample time in seconds. Default the layer out point.'),
      startFrame: z.number().int().optional().describe('First sample frame. Wins over start.'),
      endFrame: z.number().int().optional().describe('Last sample frame. Wins over end.'),
      step: z.number().int().positive().optional().describe('Frames between samples. Default 1.'),
      allowLarge: z.boolean().optional().describe('Allow more than 5000 samples. Default false.'),
    },
  });

  defineTool(server, {
    name: 'stagger-keyframes-across-layers',
    group: 'keyframes',
    description:
      'Writes the same keyframes on many layers, delaying each layer by an interval so they animate one after another. ' +
      'Use when: cascading a list of lines, cards or icons in or out. Do not use for: one layer (set-keyframes-bulk) or different keys per layer (set-keyframes-multi). ' +
      'Inputs: layers as an array of refs, {selected: true} or {all: true}; property path; keys[] of {time or frame, value, easing?} written to every layer, with times relative to the layer\'s own start offset; interval in seconds or intervalFrames (frames win, default 0.1 s); startTime or startFrame, the absolute composition time of the first layer (default 0); order "top-down" (default, timeline order), "bottom-up" or "random" with a seed; easing as the default for keys; spatial; replace to clear existing keys first. ' +
      'Returns: per-layer status with the offset applied and the keyframes written, plus a failed count. ' +
      'Notes: each layer is written with set-keyframes-bulk, so the same easing rules apply. Layers that fail are reported and the rest are still written. One undo step. ' +
      'Example: layers {selected: true}, property "Transform/Opacity", keys [{frame: 0, value: 0}, {frame: 10, value: 100, easing: "ease-out"}], intervalFrames 3.',
    input: {
      comp: CompRef.optional(),
      layers: LayersSpec,
      property: PropertyPath,
      keys: z.array(KeyframeSpec).min(1).max(500),
      interval: z.number().optional().describe('Seconds between one layer and the next. Default 0.1.'),
      intervalFrames: z.number().int().optional().describe('Frames between layers. Wins over interval.'),
      startTime: z.number().optional().describe('Composition time in seconds where the first layer\'s keys start. Default 0.'),
      startFrame: z.number().int().optional().describe('Composition frame for the first layer. Wins over startTime.'),
      order: z.enum(['top-down', 'bottom-up', 'random']).optional().describe('Which layer goes first. Default top-down.'),
      seed: z.number().int().optional().describe('Seed for the random order so it can be repeated. Default 1.'),
      easing: Easing.optional().describe('Default easing for keys that do not set their own.'),
      spatial: Spatial.optional(),
      replace: z.boolean().optional().describe('Remove existing keys on each layer first. Default false.'),
    },
  });
}
