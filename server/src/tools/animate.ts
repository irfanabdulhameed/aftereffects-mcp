/*
 * Animation shortcuts (group 'animate'): directed motion in one call, built
 * the way an animator builds it by hand. A move is two eased keys (three for
 * a press), typing and word reveals are text animators, and repeated or
 * derived motion is an expression driven by a slider or by markers. Nothing
 * here writes a key on every frame, and nothing overshoots unless asked.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, Easing, LayerRef, PropertyPath, Spatial, TimeArgs, Vec2 } from '../schemas/common.js';
import { MaskRef } from './masks.js';
import { defineTool } from './registry.js';
import { ShapeGroupRef } from './shapes.js';

const LayersSpec = z
  .union([
    z.array(LayerRef).min(1).max(500),
    z.object({
      selected: z.boolean().optional(),
      all: z.boolean().optional(),
      indices: z.array(z.number().int().positive()).optional(),
      names: z.array(z.string()).optional(),
    }),
  ])
  .describe('Layers to animate: an array of layer refs, {selected: true}, {all: true}, {indices: [...]} or {names: [...]}.');

export const MOTION_KINDS = ['fade', 'rise', 'slide', 'scale', 'blur', 'pop'] as const;
const MotionKind = z.enum(MOTION_KINDS);

/** One kind or an array of kinds; rise and slide (both Position) or scale and pop (both Scale) cannot be combined. */
const KindArg = z
  .union([MotionKind, z.array(MotionKind).min(1).max(6)])
  .refine(
    (k) => {
      const list: string[] = Array.isArray(k) ? k : [k];
      return !(list.includes('rise') && list.includes('slide')) && !(list.includes('scale') && list.includes('pop'));
    },
    { message: 'rise and slide both move Position, and scale and pop both animate Scale: use one of each pair.' }
  )
  .describe('fade (Opacity), rise (a short move up), slide (a move in a direction), scale, blur (Gaussian Blur) or pop (Scale from a small value), or an array of them to combine.');

const ORDERS = ['top-down', 'bottom-up', 'random', 'as-given'] as const;

function startArgs(defaultText: string) {
  return {
    startTime: z.number().optional().describe(`Seconds from the composition start. Default: ${defaultText}.`),
    startFrame: z.number().int().optional().describe('Frames; wins over startTime.'),
  };
}

function durationArgs(defaultText: string) {
  return {
    duration: z.number().positive().optional().describe(`Seconds. Default ${defaultText}. Key times snap to whole frames.`),
    durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
  };
}

const MotionArgs = {
  comp: CompRef.optional(),
  layers: LayersSpec,
  kind: KindArg,
  direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Direction of travel for slide. Default left. rise always travels up.'),
  distance: z.number().min(0).max(20000).optional().describe('Pixels travelled by rise or slide. Default 40 for rise, 200 for slide.'),
  scale: z.number().min(0).max(1000).optional().describe('For kind scale: the offset scale in percent of the layer\'s own scale. Default 90.'),
  popScale: z.number().min(0).max(1000).optional().describe('For kind pop: the offset scale in percent. Default 0.'),
  blur: z.number().min(0).max(500).optional().describe('For kind blur: the offset blur in pixels. Default 24.'),
  staggerFrames: z.number().int().min(0).max(600).optional().describe('Frames between one layer and the next. Default about 0.07 s (4 frames at 60 fps, 2 at 30).'),
  order: z.enum(ORDERS).optional().describe('Which layer goes first: top-down (timeline order, default), bottom-up, random (seeded) or as-given (the order of the layers array).'),
  seed: z.number().int().min(0).optional().describe('Seed for the random order. Default 1.'),
  easing: Easing.optional(),
  overshoot: z.boolean().optional().describe('Adds one small overshoot key (an anticipation key on exits) to pop and scale. Default false.'),
  overshootAmount: z.number().min(0).max(1).optional().describe('Fraction of the move for the overshoot. Default 0.08.'),
};

const PropertyMove = z
  .object({
    property: PropertyPath,
    to: z.unknown().optional().describe('End value in the property\'s units: number, [x, y], [x, y, z], or any colour form for colours.'),
    by: z.unknown().optional().describe('Change added to from instead of an absolute to: a number (added to every dimension) or an array.'),
    from: z.unknown().optional().describe('Start value. Default the keyed value at the start time.'),
  })
  .refine((m) => m.to !== undefined || m.by !== undefined, { message: 'Each property needs to or by.' });

const CursorSpec = z.object({
  char: z.string().length(1).optional().describe('Cursor glyph. Default "|"; "_" gives an underscore cursor.'),
  blinkRate: z.number().min(0).max(20).optional().describe('Blinks per second while idle. Default 2. 0 keeps the cursor on.'),
  color: Color.optional().describe('Cursor colour. Default the text colour.'),
  keepAfterTyping: z.boolean().optional().describe('Keep blinking after the last character. Default true; false hides it when typing ends.'),
  leadIn: z.number().min(0).max(60).optional().describe('Seconds the cursor blinks before typing starts. Default 0.'),
});

const RippleSpec = z.object({
  position: Vec2.optional().describe('Centre in composition pixels. Default the cursor\'s anchor point at the click, or the pressed layer\'s centre.'),
  radius: z.number().positive().max(5000).optional().describe('Final radius in pixels. Default 60.'),
  style: z.enum(['ring', 'fill']).optional().describe('ring (a stroked circle, default) or fill.'),
  strokeWidth: z.number().positive().max(200).optional().describe('Ring stroke in pixels. Default 3.'),
  color: Color.optional().describe('Default white.'),
  opacity: z.number().min(0).max(100).optional().describe('Opacity at the click, fading to 0. Default 60.'),
  duration: z.number().positive().optional().describe('Seconds the ripple grows and fades. Default 0.6.'),
  durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
  name: z.string().min(1).optional().describe('Layer name. Default "<layer> Ripple".'),
});

const MarkerSpec = z
  .object({ ...TimeArgs, comment: z.string().optional().describe('Marker comment. Default the comment filter, if any.') })
  .refine((m) => m.time !== undefined || m.frame !== undefined, { message: 'Each marker needs time (seconds) or frame.' });

export function registerAnimateTools(server: McpServer): void {
  defineTool(server, {
    name: 'smart-animate',
    group: 'animate',
    timeout: 'render',
    description:
      'Animates from one composition to another like Smart Animate in Figma: every layer whose name is in both gets keys on each property that differs (position, scale, rotation, opacity, size, colours, shape paths, effect values, Essential Properties), layers only in the end state fade in and layers only in the start state fade out. ' +
      'Use when: two states of a screen or card are built as two comps (before and after a click, collapsed and open) and the change between them should animate. Do not use for: moving one property (animate-property) or a cut between scenes (add-transition). ' +
      'Inputs: from, the start-state comp; to, the end-state comp; duplicate (default true) animates a copy of from named name (default "<from> to <to>") and leaves from as it was; startTime or startFrame (default 0); duration (default 0.5 s) or durationFrames; toTime, the time in to whose values are the end state (default 0); easing (default a landing: speed 0, influence 25 leaving and 100 arriving); fadeIn and fadeOut (default true). ' +
      'Returns: the animated comp, each matched layer with the properties keyed (from and to values), the layers faded in and out, skipped layers with the reason, and notes. ' +
      'Notes: layers pair by exact name, so name them the same in both comps; effects, masks and shape groups pair by name inside a layer. Properties with expressions are left alone. Text that changes swaps halfway. Undoable in one step. ' +
      'Example: from {name: "Card closed"}, to {name: "Card open"}, startTime 1, duration 0.6.',
    input: {
      from: CompRef.describe('The start-state composition.'),
      to: CompRef.describe('The end-state composition.'),
      duplicate: z.boolean().optional().describe('Animate a copy of from instead of from itself. Default true.'),
      name: z.string().min(1).optional().describe('Name of the copy. Default "<from> to <to>".'),
      ...startArgs('0'),
      ...durationArgs('0.5'),
      toTime: z.number().min(0).optional().describe('Time in the to comp whose values are the end state. Default 0.'),
      easing: Easing.optional(),
      fadeIn: z.boolean().optional().describe('Copy in and fade in layers that only the end state has. Default true.'),
      fadeOut: z.boolean().optional().describe('Fade out layers that only the start state has. Default true.'),
    },
  });

  defineTool(server, {
    name: 'animate-property',
    group: 'animate',
    description:
      'Animates one or more properties of a layer from a start value to an end value with two eased keys per property on the same frames. ' +
      'Use when: one directed move, such as a card sliding 200 px right, a scale-up, a colour change or an effect sweep. Do not use for: entrances and exits from offsets of the current layout (add-entrance, add-exit), more than two keys (set-keyframes-bulk) or many layers (set-keyframes-multi). ' +
      'Inputs: layer; properties[] of {property path, to or by (a change added to from), from (default the keyed value at the start)}; startTime or startFrame (default the layer in point); duration in seconds (default 0.5) or durationFrames; easing for the arrival (default a landing: speed 0, influence 25 leaving and 100 arriving, no overshoot); spatial; overshootAmount for easing "overshoot". ' +
      'Returns: the time range in seconds and frames and, per property, its path, from, to and the keys written with their ease. ' +
      'Notes: key times snap to whole frames. Source Text is refused (use set-text with a time). Entries are checked before anything is written. Undoable in one step. ' +
      'Example: layer {name: "Card"}, properties [{property: "Transform/Position", by: [200, 0]}], startFrame 30, durationFrames 20.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      properties: z.array(PropertyMove).min(1).max(20),
      ...startArgs('the layer in point'),
      ...durationArgs('0.5'),
      easing: Easing.optional(),
      spatial: Spatial.optional(),
      overshootAmount: z.number().min(0).max(1).optional().describe('Fraction of the move for easing "overshoot". Default 0.08.'),
    },
  });

  defineTool(server, {
    name: 'add-entrance',
    group: 'animate',
    description:
      'Brings one or many layers in from offset values to the values they already have, so the layout stays as built: fade, rise, slide, scale, blur, pop, or several at once, two keys per property, each layer a few frames after the last. ' +
      'Use when: a card, title, icon or list enters. Do not use for: words or characters inside one text layer (word-by-word-reveal, add-text-animator) or leaving (add-exit). ' +
      'Inputs: layers; kind as a name or an array; direction of travel for slide (default left) and distance in px (rise 40, slide 200); scale % (default 90) or popScale % (default 0) at the start; blur px (default 24, on a Gaussian Blur named Transition Blur); startTime or startFrame (default the earliest in point); duration (default 0.33 s); staggerFrames; order top-down, bottom-up, random (seed) or as-given; easing (default fast attack, long landing); overshoot for pop and scale. ' +
      'Returns: count, failed and per layer the status, time range and keys per property. ' +
      'Notes: rise with slide, or scale with pop, is refused. Offsets are in each layer\'s parent space. Undoable in one step. ' +
      'Example: layers {names: ["Card 1", "Card 2", "Card 3"]}, kind ["fade", "rise", "blur"], startFrame 12, staggerFrames 4.',
    input: { ...MotionArgs, ...startArgs('the earliest in point of the layers'), ...durationArgs('0.33') },
  });

  defineTool(server, {
    name: 'add-exit',
    group: 'animate',
    description:
      'Takes one or many layers out from the values they have to offset values with an accelerating ease: the mirror of add-entrance, with the same kinds (fade, rise, slide, scale, blur, pop or an array), two keys per property, staggered. ' +
      'Use when: elements leave before a cut or make room for the next beat. Do not use for: entrances (add-entrance) or trimming layers (set-layer-timing). ' +
      'Inputs: layers; kind; direction of travel for slide (default left; rise travels up) and distance px; scale % or popScale % reached at the end; blur px; endTime or endFrame, when the last layer finishes (default the earliest out point), or startTime or startFrame instead, not both; duration (default 0.33 s); staggerFrames; order; easing (default speed 0, influence 85 leaving and 15 arriving); overshoot adds a small anticipation to pop and scale. ' +
      'Returns: count, failed and per layer the status, time range and keys per property. ' +
      'Notes: values are read where each exit starts, so an exit can follow an entrance on the same layer. A cut on the end key leaves at speed. Undoable in one step. ' +
      'Example: layers {all: true}, kind ["fade", "scale"], scale 95, endFrame 240, staggerFrames 2, order "bottom-up".',
    input: {
      ...MotionArgs,
      endTime: z.number().optional().describe('Seconds when the last layer\'s exit ends. Default the earliest out point of the layers.'),
      endFrame: z.number().int().optional().describe('Frames; wins over endTime.'),
      ...startArgs('derived from the end time'),
      ...durationArgs('0.33'),
    },
    toBridgeArgs: (args) => {
      const hasEnd = args.endTime !== undefined || args.endFrame !== undefined;
      const hasStart = args.startTime !== undefined || args.startFrame !== undefined;
      if (hasEnd && hasStart) throw new Error('Give the exit an end time or a start time, not both.');
      return args;
    },
  });

  defineTool(server, {
    name: 'typewriter-text',
    group: 'animate',
    description:
      'Types a text layer on one character at a time with the mechanism of After Effects\' own Typewriter preset: a text animator with Opacity 0 and a Range Selector by characters (Shape Square, Smoothness 0) whose Start is keyed 0 to 100 in two keys, plus an optional typing cursor that follows the last typed character. ' +
      'Use when: a prompt, field, console line or caption types itself. Do not use for: blurred word or line reveals (word-by-word-reveal) or changing the words (set-text). ' +
      'Inputs: layer; startTime or startFrame (default the in point); charactersPerSecond (default 20), or duration or durationFrames (these win); easing (default linear; an ease makes typing slow into the end); name; cursor true or {char, blinkRate, color, keepAfterTyping, leadIn}. ' +
      'Returns: characters, rate, time range, first and last character times, the keys, and the cursor layer with its expression states. ' +
      'Notes: the cursor is a copy of the text layer parented to it; expression selectors show only the slot after the last typed character and a Character Value animator draws the glyph there; its Opacity blinks while idle. Exact on left-aligned text. Undoable in one step. ' +
      'Example: layer {name: "Prompt"}, startFrame 20, charactersPerSecond 24, cursor {char: "|", leadIn: 0.5}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      ...startArgs('the layer in point'),
      charactersPerSecond: z.number().positive().max(1000).optional().describe('Typing rate. Default 20. Ignored when duration or durationFrames is given.'),
      ...durationArgs('characters / charactersPerSecond'),
      easing: Easing.optional().describe('Easing on the Start keys. Default linear (an even rhythm).'),
      name: z.string().min(1).optional().describe('Animator name. Default "Typewriter".'),
      cursor: z.union([z.boolean(), CursorSpec]).optional().describe('true for a default "|" cursor, or its settings.'),
    },
    toBridgeArgs: (args) => {
      const { cursor, ...rest } = args;
      if (cursor === true) return { ...rest, cursor: {} };
      if (cursor === false || cursor === undefined) return rest;
      return { ...rest, cursor };
    },
  });

  defineTool(server, {
    name: 'word-by-word-reveal',
    group: 'animate',
    description:
      'Reveals a text layer word by word, or line by line, with one text animator: each word starts transparent, blurred and offset and lands sharp in place as a Range Selector based on words sweeps across, keyed in two eased keys. ' +
      'Use when: a headline or paragraph should read on calmly. Do not use for: typing (typewriter-text) or the other preset looks (add-text-animator). ' +
      'Inputs: layer; startTime or startFrame (default the in point); duration or durationFrames, or secondsPerWord (default 0.12 s per word, kept within 0.7 to 3 s); blur px (default 25); offset y px or [x, y] (default 20); opacity at the start (default 0); scale % at the start (optional); basedOn words or lines; drive start (Square shape, Start 0 to 100, default) or offset (Ramp Up, Offset -100 to 100, words overlap); easeHigh, easeLow; randomize with seed; easing (default influence 33.3 leaving, 80 arriving); name. ' +
      'Returns: the animator and selector paths, the keyed property, units counted, the start state, time range and keys. ' +
      'Notes: animator values are the start state, so the layout stays as built. Undoable in one step. ' +
      'Example: layer {name: "Paragraph"}, startFrame 30, secondsPerWord 0.1, blur 20, offset 24.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      ...startArgs('the layer in point'),
      ...durationArgs('from secondsPerWord'),
      secondsPerWord: z.number().positive().max(10).optional().describe('Seconds per word (or line). Ignored when duration is given.'),
      blur: z.number().min(0).max(500).optional().describe('Blur in pixels at the start. Default 25. 0 adds no Blur property.'),
      offset: z.union([z.number(), Vec2]).optional().describe('Position offset at the start: a number is y pixels (positive starts lower), or [x, y]. Default 20.'),
      opacity: z.number().min(0).max(100).optional().describe('Opacity at the start, percent. Default 0.'),
      scale: z.number().min(0).max(1000).optional().describe('Scale at the start, percent. Default none (no Scale property).'),
      basedOn: z.enum(['words', 'lines']).optional().describe('Unit the selector counts. Default words.'),
      drive: z.enum(['start', 'offset']).optional().describe('start: Square shape, Start 0 to 100 (one word after another, default). offset: Ramp Up, Offset -100 to 100 (overlapping words).'),
      easeHigh: z.number().min(-100).max(100).optional().describe('Range Selector Ease High, percent.'),
      easeLow: z.number().min(-100).max(100).optional().describe('Range Selector Ease Low, percent.'),
      randomize: z.boolean().optional().describe('Reveal the words in a random order. Default false.'),
      seed: z.number().int().min(0).optional().describe('Random Seed for randomize. Default 1.'),
      easing: Easing.optional(),
      name: z.string().min(1).optional().describe('Animator name. Default "Word Reveal".'),
    },
  });

  defineTool(server, {
    name: 'press',
    group: 'animate',
    description:
      'Presses a layer like a button: Scale dips to 96 % and returns in three eased keys, or with variant pop jumps to 108 % in one frame and settles. Optionally a cursor dips with it, properties flip state on the click frame with hold keys, and a ring ripples out. ' +
      'Use when: a cursor clicks a button, a chip is selected or a card is tapped. Do not use for: entrances (add-entrance) or the same click repeated (key it once, then play-at-markers). ' +
      'Inputs: layer; time or frame where the press starts (required); variant dip or pop; scale %; downDuration or downFrames (dip 0.1 s, pop one frame); upDuration or upFrames (dip 0.15 s, pop 0.25 s); easing; cursor {layer, scale %}; flip [{property, to}]; ripple true or {position, radius, style, strokeWidth, color, opacity, duration, name}. ' +
      'Returns: start, click and end times and frames, the Scale keys, cursor keys, flips and the ripple layer with its keys. ' +
      'Notes: layers scale about their anchor points. A cursor dips twice as deep by default. The ripple is trimmed to its animation. Undoable in one step. ' +
      'Example: layer {name: "Send"}, frame 90, cursor {layer: {name: "Cursor"}}, ripple true.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      ...TimeArgs,
      variant: z.enum(['dip', 'pop']).optional().describe('dip (default): Scale down and back. pop: a one-frame jump up, then a settle.'),
      scale: z.number().min(1).max(400).optional().describe('Scale at the bottom (dip, default 96) or peak (pop, default 108), percent of the layer\'s own scale.'),
      downDuration: z.number().positive().optional().describe('Seconds to the bottom or peak. Default 0.1 for dip, one frame for pop.'),
      downFrames: z.number().int().positive().optional().describe('Frames; wins over downDuration.'),
      upDuration: z.number().positive().optional().describe('Seconds back to rest. Default 0.15 for dip, 0.25 for pop.'),
      upFrames: z.number().int().positive().optional().describe('Frames; wins over upDuration.'),
      easing: Easing.optional().describe('Ease of each segment. Default speed 0 with influence 25 leaving and 100 arriving.'),
      cursor: z
        .object({
          layer: LayerRef.describe('The cursor layer, scaled about its anchor (put the anchor on the tip).'),
          scale: z.number().min(1).max(200).optional().describe('Cursor scale at the click, percent. Default twice the button\'s dip (92 with a 96 dip), 92 for pop.'),
        })
        .optional(),
      flip: z
        .array(z.object({ property: PropertyPath, to: z.unknown().refine((v) => v !== undefined, { message: 'to is required' }).describe('New value on the click frame.') }))
        .min(1)
        .max(20)
        .optional()
        .describe('State changes on the click frame: hold keys from the old value to the new one, such as a fill colour.'),
      ripple: z.union([z.boolean(), RippleSpec]).optional().describe('true for a default ring, or its settings.'),
    },
    toBridgeArgs: (args) => {
      if (args.time === undefined && args.frame === undefined) throw new Error('press needs time (seconds) or frame: when the press starts.');
      const { ripple, ...rest } = args;
      if (ripple === true) return { ...rest, ripple: {} };
      if (ripple === false || ripple === undefined) return rest;
      return { ...rest, ripple };
    },
  });

  defineTool(server, {
    name: 'move-along-path',
    group: 'animate',
    description:
      'Makes a layer travel along a path drawn on a shape layer or a mask: adds a Progress slider (0 to 100) keyed in two eased keys and a Position expression that reads pointOnPath at that progress through the path\'s group and layer transforms, with an optional Rotation expression that turns the layer along the path. ' +
      'Use when: a dot, icon, plane or cursor follows a curve. Do not use for: straight moves (animate-property) or changing the path shape (set-shape-path). ' +
      'Inputs: layer (the one that moves); path {layer, group (default the first) or mask}; startTime or startFrame (default the in point); duration (default 1 s) or durationFrames; from and to progress in percent of the path length (default 0 to 100; past 100 loops a closed path); easing (default landing); orient; sliderName (default Progress). ' +
      'Returns: the path reference, whether it is closed, the slider keys, and each expression with any After Effects error. ' +
      'Notes: the path must be a Bezier path, not a parametric rectangle or ellipse, and the path layer needs a unique name. Existing Position keys are overridden. Undoable in one step. ' +
      'Example: layer {name: "Dot"}, path {layer: {name: "Route"}}, durationFrames 45, orient true.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      path: z
        .object({
          layer: LayerRef.describe('The shape layer (or masked layer) holding the path.'),
          group: ShapeGroupRef.optional(),
          mask: MaskRef.optional().describe('Travel along this mask instead of a shape path.'),
        })
        .describe('Where the path lives.'),
      ...startArgs('the layer in point'),
      ...durationArgs('1'),
      from: z.number().min(-10000).max(10000).optional().describe('Progress at the start, percent of the path length. Default 0.'),
      to: z.number().min(-10000).max(10000).optional().describe('Progress at the end. Default 100.'),
      easing: Easing.optional(),
      orient: z.boolean().optional().describe('Turn the layer along the path direction. Default false.'),
      sliderName: z.string().min(1).optional().describe('Name of the Slider Control. Default "Progress".'),
    },
  });

  defineTool(server, {
    name: 'play-at-markers',
    group: 'animate',
    description:
      'Replays a property\'s existing keyframed animation at every marker: one expression maps the time since the latest marker into the keyed range, so one curve plays as often as there are markers, with no copied keys. Can add the markers in the same call. ' +
      'Use when: a pulse, press, pop or nudge repeats on beats, clicks or cues. Do not use for: playing once (the keys already do) or endless loops (apply-expression-preset with a loop preset). ' +
      'Inputs: layer; properties[] (each with at least two keys); markerSource layer (default, the layer\'s own markers) or comp; markerLayer to read another layer\'s markers; comment to react only to markers with that exact comment; addMarkers[] of {time or frame, comment}. ' +
      'Returns: the triggering markers, the markers added, and per property its key span and expression state. ' +
      'Notes: before the first marker the property holds its first key value and after each play it holds the last; a new marker restarts the play. The keys can sit anywhere in the timeline; retime the animation by moving them. Replaces any existing expression on those properties. Undoable in one step. ' +
      'Example: layer {name: "Badge"}, properties ["Transform/Scale"], addMarkers [{frame: 30}, {frame: 75}, {frame: 120}].',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      properties: z.array(PropertyPath).min(1).max(50),
      markerSource: z.enum(['layer', 'comp']).optional().describe('Whose markers trigger the play. Default layer.'),
      markerLayer: LayerRef.optional().describe('Read the markers of this layer instead (for example a control null). Implies markerSource layer.'),
      comment: z.string().min(1).optional().describe('Only markers whose comment equals this trigger.'),
      addMarkers: z.array(MarkerSpec).max(500).optional().describe('Markers to add to the marker source first.'),
    },
  });

  defineTool(server, {
    name: 'add-camera-push',
    group: 'animate',
    description:
      'Adds a 2D null at a pivot, parents layers to it without moving them, and keys its Scale from 100 to 105 % (or any values) in two keys: the slow push that keeps a held frame alive, scaled about the point the shot centres on, with an optional drift of a few pixels. ' +
      'Use when: a scene or end card should breathe instead of sitting still. Do not use for: 3D camera moves (animate-camera) or one element\'s own move (animate-property). ' +
      'Inputs: layers (default every layer without a parent; cameras and lights are skipped); pivot [x, y] in composition pixels (default the centre); from and to percent (default 100 and 105); startTime or startFrame (default 0); duration or durationFrames (default to the end of the composition); easing (default linear); drift [dx, dy] pixels; name (default Camera Push). ' +
      'Returns: the null layer, the layers parented and those skipped with the reason, and the scale and drift keys. ' +
      'Notes: the null\'s anchor and position both sit on the pivot, so parenting changes no layer\'s values. Layers that already have a parent ride with it. Undoable in one step. ' +
      'Example: pivot [960, 540], to 104, duration 6.',
    input: {
      comp: CompRef.optional(),
      layers: LayersSpec.optional(),
      pivot: Vec2.optional().describe('Point the push scales about, composition pixels. Default the composition centre.'),
      from: z.number().positive().max(1000).optional().describe('Scale at the start, percent. Default 100.'),
      to: z.number().positive().max(1000).optional().describe('Scale at the end, percent. Default 105.'),
      ...startArgs('0'),
      ...durationArgs('to the end of the composition'),
      easing: Easing.optional().describe('Default linear, an even push.'),
      drift: Vec2.optional().describe('Pixels the null moves over the same span, for example [-12, 0].'),
      name: z.string().min(1).optional().describe('Null name. Default "Camera Push".'),
    },
  });
}
