/*
 * Time tools: time remapping, freeze frames, speed, reverse, frame blending, loops.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef, Easing, LayerRef, TimeArgs } from '../schemas/common.js';
import { defineTool } from './registry.js';

export const FRAME_BLENDING_MODES = ['none', 'frame-mix', 'pixel-motion'] as const;
export const LOOP_MODES = ['cycle', 'pingpong', 'offset', 'continue'] as const;

const TimeRemapKey = z.object({
  time: z.number().optional().describe('Composition time in seconds where the key sits.'),
  frame: z.number().int().optional().describe('Composition frame; wins over time.'),
  value: z.number().min(0).optional().describe('Source time in seconds to show at this key.'),
  valueFrame: z.number().int().min(0).optional().describe('Source frame (at the composition frame rate); wins over value.'),
  easing: Easing.optional(),
});

export function registerTimeTools(server: McpServer): void {
  defineTool(server, {
    name: 'enable-time-remap',
    group: 'time',
    description:
      'Turns time remapping on or off for a layer. Time remapping adds a Time Remap property whose value is the source time shown at each composition time; After Effects seeds it with two keys (0 at the layer start, source duration at the layer end). ' +
      'Use when: before speed ramps, freeze frames or loops that need Time Remap keys, or to remove a remap. Do not use for: writing the keys (set-time-remap-keyframes), a simple constant speed change (set-speed) or a hold (freeze-frame-at). ' +
      'Inputs: layer; enabled (default true). ' +
      'Returns: enabled, whether anything changed, the layer summary, timing, the source duration and the Time Remap property with its keyframes. ' +
      'Notes: only layers with a time-based source (footage, precomps, audio) can be remapped; solids, shapes, text, nulls, cameras and lights fail with code unsupported. Disabling deletes the keys. Undoable in one step. ' +
      'Example: layer {name: "Clip"}, enabled true.',
    input: { comp: CompRef.optional(), layer: LayerRef, enabled: z.boolean().optional().describe('Default true.') },
  });

  defineTool(server, {
    name: 'set-time-remap-keyframes',
    group: 'time',
    description:
      'Writes Time Remap keyframes on a layer: each key pairs a composition time with the source time to show there, so a speed ramp, slow motion, a rewind or a jump cut is a short list of keys. Enables time remapping first when needed. ' +
      'Use when: variable speed, playing a clip backwards over a range, or holding then resuming. Do not use for: a constant speed (set-speed), a single hold frame (freeze-frame-at) or seamless loops (loop-layer). ' +
      'Inputs: layer; keys[] of {time or frame, value in source seconds or valueFrame, easing}; easing default for keys without their own; replace (default: true when remap was just enabled, otherwise false) removes existing keys first. ' +
      'Returns: keyframesWritten, the keys written with time, frame and value, the layer timing and the Time Remap property state. ' +
      'Notes: the layer out point is not extended; use set-layer-timing to lengthen a slowed clip. valueFrame uses the composition frame rate. Undoable in one step. ' +
      'Example: keys [{frame: 0, value: 0}, {frame: 30, value: 1}, {frame: 90, value: 1.5, easing: "ease-in-out"}] for a slow-down.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      keys: z.array(TimeRemapKey).min(1).max(2000),
      easing: Easing.optional().describe('Default easing for keys without their own.'),
      replace: z.boolean().optional().describe('Remove existing Time Remap keys first. Default true right after enabling, otherwise false.'),
    },
  });

  defineTool(server, {
    name: 'freeze-frame-at',
    group: 'time',
    description:
      'Holds one source frame for the whole layer: enables time remapping, removes every Time Remap key and writes a single hold key whose value is the source time visible at the given composition time. ' +
      'Use when: a still from a clip, a frozen last frame, or a reference frame to build on. Do not use for: a hold in the middle of a moving clip (use set-time-remap-keyframes with two keys of the same value) or splitting (split-layer-at-time). ' +
      'Inputs: layer; time or frame (default: current time), the moment whose frame is frozen; keyAtTime true places the key at that time instead of the layer in point; outPoint or outFrame, or extendToCompEnd, to lengthen the layer. ' +
      'Returns: frozenAt, sourceTime and sourceFrame, the hold keyframe, the layer timing and the Time Remap property state. ' +
      'Notes: the source time takes the layer start, trims and stretch into account. Layers without a time-based source fail with code unsupported. Undoable in one step. ' +
      'Example: layer {name: "Clip"}, frame 48, extendToCompEnd true.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      ...TimeArgs,
      keyAtTime: z.boolean().optional().describe('Place the hold key at the given time rather than the layer in point. Default false.'),
      outPoint: z.number().optional().describe('New out point in seconds.'),
      outFrame: z.number().int().optional().describe('New out point in frames; wins over outPoint.'),
      extendToCompEnd: z.boolean().optional().describe('Set the out point to the composition end. Default false.'),
    },
  });

  defineTool(server, {
    name: 'set-speed',
    group: 'time',
    description:
      'Changes a layer\'s playback speed through time stretch: give a stretch percent (100 normal, 200 half speed, 50 double), a speedFactor (2 doubles the speed), or fitToDuration or fitToDurationFrames to make the visible part last exactly that long. ' +
      'Use when: slowing or speeding a clip uniformly, or fitting a clip to a slot. Do not use for: speed ramps (set-time-remap-keyframes) or reversing (reverse-layer, which keeps the time range). ' +
      'Inputs: layer; one of percent, speedFactor, fitToDuration or fitToDurationFrames; keepInPoint (default true) keeps the in point where it is, so only the out point moves. ' +
      'Returns: mode, the new stretch and speedFactor, before and after timing (start, in, out, duration, stretch) and notes when After Effects clamped a value. ' +
      'Notes: a negative current stretch stays negative. Keyframes on the layer are stretched with it. Undoable in one step. ' +
      'Example: layer {name: "Clip"}, speedFactor 0.5, keepInPoint true.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      percent: z.number().optional().describe('Time stretch percent. 100 normal, 200 half speed, 50 double speed.'),
      speedFactor: z.number().positive().optional().describe('Speed multiplier. 2 is double speed (stretch 50).'),
      fitToDuration: z.number().positive().optional().describe('Make the visible part last this many seconds.'),
      fitToDurationFrames: z.number().int().positive().optional().describe('Make the visible part last this many frames; wins over fitToDuration.'),
      keepInPoint: z.boolean().optional().describe('Keep the in point fixed. Default true.'),
    },
  });

  defineTool(server, {
    name: 'reverse-layer',
    group: 'time',
    description:
      'Plays a layer backwards by negating its time stretch, then puts the layer back on the same time range (After Effects shifts a layer when stretch turns negative). Calling it twice restores forward playback. ' +
      'Use when: a reveal should play as a hide, or footage should run backwards. Do not use for: reversing only some keyframes (reverse-keyframes) or partial rewinds (set-time-remap-keyframes). ' +
      'Inputs: layer. ' +
      'Returns: the new stretch, reversed true or false, before and after timing, and notes when the out point could not be kept exactly. ' +
      'Notes: keyframes on the layer are reversed too. Undoable in one step. ' +
      'Example: layer {name: "Wipe"}.',
    input: { comp: CompRef.optional(), layer: LayerRef },
  });

  defineTool(server, {
    name: 'set-frame-blending',
    group: 'time',
    description:
      'Sets frame blending on a footage or precomp layer: none, frame-mix (cross-dissolves between frames, fast) or pixel-motion (interpolates motion, slow but smooth), and turns the composition\'s frame blending switch on so it renders. ' +
      'Use when: slowed footage stutters, or footage at a different frame rate looks steppy. Do not use for: motion blur on animation (set-layer-flags with motionBlur). ' +
      'Inputs: layer; mode (default frame-mix); compSwitch to force the composition switch on or off (default: on when mode is not none, untouched otherwise). ' +
      'Returns: the layer summary, the layer frame blending mode, the layer and composition switches. ' +
      'Notes: pixel-motion slows previews and renders considerably. Layers without a footage or precomp source fail with code unsupported. Undoable in one step. ' +
      'Example: layer {name: "Clip"}, mode "pixel-motion".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      mode: z.enum(FRAME_BLENDING_MODES).optional().describe('Default "frame-mix".'),
      compSwitch: z.boolean().optional().describe('Composition frame blending switch. Default: true when mode is not none.'),
    },
  });

  defineTool(server, {
    name: 'loop-layer',
    group: 'time',
    description:
      'Makes a layer repeat its source: enables time remapping, pulls the last Time Remap key one frame earlier so the final frame is not shown twice at the seam, sets a loopOut expression (cycle, pingpong, offset or continue), and extends the layer out point to the composition end or a given length. ' +
      'Use when: a short clip or precomp must fill a longer composition. Do not use for: repeating keyframed animation on a property (set-expression with loopOut on that property) or looping footage in the project item settings. ' +
      'Inputs: layer; mode (default cycle); fixLastFrame (default true); loopBefore true also loops before the first key; outPoint or outFrame, or duration or durationFrames, instead of the composition end. ' +
      'Returns: mode, the expression and any expression error, lastKeyFixed, the layer timing and the Time Remap property with its keyframes. ' +
      'Notes: pingpong plays forward then backward. The layer must have a time-based source. Not verified against a live After Effects. Undoable in one step. ' +
      'Example: layer {name: "Loop clip"}, mode "cycle".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      mode: z.enum(LOOP_MODES).optional().describe('Default "cycle".'),
      fixLastFrame: z.boolean().optional().describe('Move the last key one frame earlier to avoid a duplicated frame. Default true.'),
      loopBefore: z.boolean().optional().describe('Also loop before the first key with loopIn. Default false.'),
      outPoint: z.number().optional().describe('Out point in seconds. Default: composition end.'),
      outFrame: z.number().int().optional().describe('Out point in frames; wins over outPoint.'),
      duration: z.number().positive().optional().describe('Length from the in point in seconds.'),
      durationFrames: z.number().int().positive().optional().describe('Length in frames; wins over duration.'),
    },
  });
}
