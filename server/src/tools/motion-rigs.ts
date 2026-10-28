/*
 * Motion rigs (group 'motion-rigs'): general motion-design rigs built from
 * expressions and Expression Controls (sliders, points, checkboxes, angles)
 * on a control layer, so a person can retune or retime them in the timeline.
 * Animation comes from two eased keys on one control, never from a key on
 * every frame. Each tool returns the control layer, the controls and the
 * expressions it set.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, Easing, LayerRef, Vec2, Vec2or3 } from '../schemas/common.js';
import { defineTool } from './registry.js';

const LayerList = z
  .union([
    z.array(LayerRef).min(1).max(500),
    z.object({
      selected: z.boolean().optional(),
      all: z.boolean().optional(),
      indices: z.array(z.number().int().positive()).optional(),
      names: z.array(z.string()).optional(),
    }),
  ])
  .describe('Layers: an array of layer refs, {selected: true}, {all: true}, {indices: [...]} or {names: [...]}.');

const Order = z.enum(['top-down', 'bottom-up', 'random', 'as-given']);

const ControlArgs = {
  controlLayer: LayerRef.optional().describe('Put the controls on this existing layer (for example a null shared with another rig) instead of a new null. Controls with the same names are reused and keep their values unless given.'),
  controlName: z.string().min(1).max(200).optional().describe('Name of the new control null.'),
};

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

const LAND = 'Default a landing (speed 0, influence 25 leaving and 100 arriving, no overshoot).';

const MotionProperty = z.enum(['position', 'rotation', 'scale', 'opacity']);

const BentoCell = z.object({
  layer: LayerRef.optional().describe('The layer for this cell. Give it on every entry, or on none and list the layers in layers (one entry per layer, same order).'),
  col: z.number().int().min(1).max(200).describe('First column, 1-based.'),
  row: z.number().int().min(1).max(200).describe('First row, 1-based.'),
  colSpan: z.number().int().min(1).max(200).optional().describe('Columns the cell covers. Default 1.'),
  rowSpan: z.number().int().min(1).max(200).optional().describe('Rows the cell covers. Default 1.'),
});

const GRID_CONTROLS = ['columns', 'rows', 'cell-size', 'gap', 'origin'] as const;

const GridAnimate = z.object({
  control: z.enum(GRID_CONTROLS).describe('The control to animate: columns, rows (bento), cell-size, gap or origin.'),
  to: z.union([z.number(), Vec2]).describe('End value: a number for columns and rows, [w, h] for cell-size, a number or [x, y] for gap, [x, y] composition pixels for origin.'),
  ...startArgs('the current composition time'),
  ...durationArgs('0.6'),
  easing: Easing.optional().describe(LAND),
});

const MoveSpec = z.object({
  from: Vec2or3.optional().describe('Start position in composition pixels. Default where the effector is.'),
  to: Vec2or3.describe('End position in composition pixels.'),
  ...startArgs("the effector's in point"),
  ...durationArgs('2'),
  easing: Easing.optional().describe(LAND),
});

const RampSpec = z.object({
  ...startArgs('0'),
  ...durationArgs('1'),
  easing: Easing.optional().describe(LAND),
});

const Radial = z.object({
  radius: z.number().min(0).max(100000).optional().describe('Ring radius in pixels. Default 300.'),
  startAngle: z.number().optional().describe('Angle of the source in degrees, 0 = right, -90 = top (default), clockwise.'),
  angleStep: z.number().optional().describe('Degrees between copies. Default 360 / (copies + 1), a full ring.'),
  center: Vec2.optional().describe("Ring centre in composition pixels. Default the source's position."),
  radiusStep: z.number().optional().describe('Pixels added to the radius per copy (a spiral). Default 0.'),
  orient: z.boolean().optional().describe("Turn each copy so its top faces away from the centre. Default false."),
});

const PathSpec = z.object({
  layer: LayerRef.describe('A shape layer.'),
  path: z.string().min(1).max(500).optional().describe('Which path: the item name ("Path 1"), "Group 1/Path 1", or a group holding one path. Needed when the layer has several paths.'),
});

export function registerMotionRigTools(server: McpServer): void {
  defineTool(server, {
    name: 'number-counter',
    group: 'motion-rigs',
    description:
      'Makes a text layer count from one number to another: a Value slider keyed with two eased keys drives Source Text by expression, formatted with decimals, a thousands separator, prefix, suffix, leading zeros and an optional plus sign. ' +
      'Use when: a statistic, price, percentage or score ticks up or down. Do not use for: swapping words (set-text) or typing text on (typewriter-text). ' +
      'Inputs: layer (an existing text layer, style kept) or font, fontSize, fillColor, justification, position and name for a new one; from (default 0) and to; startTime or startFrame (default the in point); duration (default 2 s) or durationFrames; easing (default a landing); decimals; thousandsSeparator ("" for none); decimalSeparator; prefix and suffix such as "$", "%" or "k"; minDigits (leading zeros); showPlus; tabular (figure-space padding holds the width); controls on the layer (default) or a null, or controlLayer. ' +
      'Returns: the text layer, the control layer, the controls (Value with its keys, Decimals, Min Digits, Separator), the expression state and the first and last strings. ' +
      'Notes: prefix, suffix and separators sit in the expression\'s first lines; past one million a multiplier is used. Undoable in one step. ' +
      'Example: layer {name: "Revenue"}, to 12500, prefix "$", durationFrames 90.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.optional().describe('Existing text layer to drive; its font and style are kept. Omit to create a text layer.'),
      from: z.number().optional().describe('Start value. Default 0.'),
      to: z.number().describe('End value.'),
      ...startArgs('the layer in point'),
      ...durationArgs('2'),
      easing: Easing.optional().describe(`Arrival of the Value keys. ${LAND}`),
      decimals: z.number().int().min(0).max(10).optional().describe('Digits after the decimal point. Default 0.'),
      thousandsSeparator: z.string().max(3).optional().describe('Between groups of three digits. Default ","; "" for none.'),
      decimalSeparator: z.string().max(3).optional().describe('Default ".".'),
      prefix: z.string().max(40).optional().describe('Text before the number, for example "$".'),
      suffix: z.string().max(40).optional().describe('Text after the number, for example "%", "k" or " users".'),
      minDigits: z.number().int().min(0).max(30).optional().describe('Pad the whole part with leading zeros to this many digits (3 gives 007). Default 0.'),
      showPlus: z.boolean().optional().describe('Put + before positive values. Default false.'),
      tabular: z.boolean().optional().describe('Pad the left with figure spaces to the widest end value so the width holds while counting. Best with a font whose figures are tabular. Default false.'),
      controls: z.enum(['layer', 'null']).optional().describe('Where the controls go: on the text layer (default) or on a new null.'),
      ...ControlArgs,
      font: z.string().optional().describe('New layer only: PostScript font name.'),
      fontSize: z.number().positive().optional().describe('New layer only: pixels. Default 72.'),
      fillColor: Color.optional().describe('New layer only. Default white.'),
      justification: z.enum(['left', 'center', 'right']).optional().describe('New layer only. Default center.'),
      position: Vec2.optional().describe('New layer only: composition pixels. Default the centre.'),
      name: z.string().min(1).max(200).optional().describe('New layer only: layer name. Default "Counter".'),
    },
  });

  defineTool(server, {
    name: 'grid-layout',
    group: 'motion-rigs',
    timeout: 'render',
    description:
      'Arranges layers in a grid or bento layout driven by controls on a null (Columns, Cell Width, Cell Height, Gap X, Gap Y, Origin, Center On Origin, Column First, Reverse Order, Rows for bento). Each Position expression puts the centre of the layer\'s bounds on its cell, so changing a control reflows the grid; a fractional Columns glides cells between layouts. ' +
      'Use when: cards, tiles, icons or photos form a grid or bento board. Do not use for: copies of one layer in a row (clone-array) or spacing layers once (distribute-layers). ' +
      'Inputs: layers (top-down, or order); columns (default the square root); cellSize [w, h] (default the largest layer); gap number or [x, y] (default 24); origin [x, y] with align center or top-left; fill rows or columns; reverse; fit none, contain, cover or stretch; bento [{layer, col, row, colSpan, rowSpan}] 1-based; animate {control, to, start, duration, easing}; controlLayer, controlName. ' +
      'Returns: controls, layout, each layer\'s slot, column, row and fill, expression states and animation keys. ' +
      'Notes: a shape layer holding one Rectangle fills its cell through the rectangle\'s Size. One undo step. ' +
      'Example: layers {all: true}, columns 3, gap 24, animate {control: "columns", to: 2, startFrame: 60}.',
    input: {
      comp: CompRef.optional(),
      layers: LayerList.optional().describe('The cells. Required unless every bento entry names its layer.'),
      order: Order.optional().describe('Which layer takes slot 1: top-down (timeline order, default), bottom-up, random or as-given.'),
      columns: z.number().int().min(1).max(200).optional().describe('Number of columns. Default the square root of the count, rounded up; for bento the widest span.'),
      cellSize: Vec2.optional().describe('[width, height] of one cell in pixels. Default the largest layer (fit none) or a size that fills 80 % of the composition.'),
      gap: z.union([z.number().min(0), Vec2]).optional().describe('Space between cells in pixels: one number or [x, y]. Default 24.'),
      origin: Vec2.optional().describe('Composition pixels: the grid centre (align center) or top-left corner (align top-left). Default the composition centre, or a centred grid.'),
      align: z.enum(['center', 'top-left']).optional().describe('What origin marks. Default center.'),
      fill: z.enum(['rows', 'columns']).optional().describe('Fill left to right row by row (default) or top to bottom column by column.'),
      reverse: z.boolean().optional().describe('Fill from the last slot. Default false.'),
      fit: z.enum(['none', 'contain', 'cover', 'stretch']).optional().describe('Scale each layer into its cell: none (grid default), contain (bento default), cover or stretch.'),
      bento: z.array(BentoCell).min(1).max(200).optional().describe('Explicit cells per layer for a bento layout.'),
      animate: GridAnimate.optional().describe('A reflow: two eased keys on one control.'),
      ...ControlArgs,
    },
    toBridgeArgs: (args) => {
      const bento = args.bento;
      if (bento && bento.length) {
        const withLayer = bento.filter((b) => b.layer !== undefined).length;
        if (withLayer !== 0 && withLayer !== bento.length) throw new Error('Give a layer on every bento entry, or on none and list the layers in layers.');
        if (withLayer === 0 && !args.layers) throw new Error('bento entries without layers need layers (one per entry, in order).');
      } else if (!args.layers) {
        throw new Error('grid-layout needs layers (or bento entries that name their layers).');
      }
      const a = args.animate;
      if (a) {
        if ((a.control === 'columns' || a.control === 'rows') && Array.isArray(a.to)) throw new Error(`animate.to must be a number for ${a.control}.`);
        if ((a.control === 'cell-size' || a.control === 'origin') && !Array.isArray(a.to)) throw new Error(`animate.to must be [x, y] for ${a.control}.`);
        if (a.control === 'rows' && !(bento && bento.length)) throw new Error('rows is a bento control; animate columns, cell-size, gap or origin for a grid.');
      }
      return args;
    },
  });

  defineTool(server, {
    name: 'proximity-effector',
    group: 'motion-rigs',
    timeout: 'render',
    description:
      'Makes layers react to their distance from an effector layer: inside a Radius with a linear or smooth Falloff they scale, fade, blur, turn or move by amounts set on controls on the effector (Radius, Falloff, Smooth Falloff, Invert, Strength, one Amount per reaction). Animate the effector; the field responds. ' +
      'Use when: a cursor or orb passes over tiles, icons or letters. Do not use for: trailing a leader (follow-chain) or aiming at a target (look-at-layer). ' +
      'Inputs: layers; effector (an existing layer) or name and position for a new null (3D when a layer is 3D); radius px (default 300); falloff, percent of the radius that fades (default 100); smooth; invert; strength percent; scale percent added; opacity points added; blur px (Gaussian Blur "Effector Blur"); rotation degrees; offset [x, y] or [x, y, z] px; animate {from, to, start, duration, easing} keys the effector; radiusGuide draws the radius (guide layer). ' +
      'Returns: effector, controls, per-layer expression states, skipped layers, effector keys. ' +
      'Notes: stacks on grid-layout and other rig expressions; a re-run replaces only its own part. 3D layers measure in world space. ' +
      'Example: layers {all: true}, scale 40, blur 12, radius 250, animate {to: [1720, 540], duration: 3}.',
    input: {
      comp: CompRef.optional(),
      layers: LayerList,
      effector: LayerRef.optional().describe('Existing layer to use as the effector; its controls go on it. Default a new null.'),
      name: z.string().min(1).max(200).optional().describe('Name of a new effector null. Default "Effector".'),
      position: Vec2or3.optional().describe('Position of a new effector in composition pixels. Default the centre.'),
      threeD: z.boolean().optional().describe('Make a new effector 3D even when every layer is 2D. Default false.'),
      radius: z.number().min(0).max(100000).optional().describe('Reach in pixels. Default 300.'),
      falloff: z.number().min(0).max(100).optional().describe('Percent of the radius over which the reaction fades out: 100 fades from the centre, 0 is a hard edge. Default 100.'),
      smooth: z.boolean().optional().describe('Smooth (S-shaped) falloff instead of linear. Default true.'),
      invert: z.boolean().optional().describe('React outside the radius instead of inside. Default false.'),
      strength: z.number().min(0).max(1000).optional().describe('Percent applied to every reaction. Default 100; key it to fade the field in.'),
      scale: z.number().min(-100).max(10000).optional().describe('Percent added to the layer\'s scale at full weight, for example 40 (140 %) or -50.'),
      opacity: z.number().min(-100).max(100).optional().describe('Opacity points added at full weight, for example -100 to vanish or 100 to appear.'),
      blur: z.number().min(0).max(1000).optional().describe('Blur in pixels at full weight.'),
      rotation: z.number().min(-36000).max(36000).optional().describe('Degrees added to Rotation at full weight.'),
      offset: Vec2or3.optional().describe('Position offset in pixels at full weight, [x, y] or [x, y, z].'),
      animate: MoveSpec.optional().describe('Two eased keys on the effector\'s Position.'),
      radiusGuide: z.boolean().optional().describe('Add a guide shape layer (does not render) that draws the radius. Default false.'),
    },
    toBridgeArgs: (args) => {
      if (args.scale === undefined && args.opacity === undefined && args.blur === undefined && args.rotation === undefined && args.offset === undefined) {
        throw new Error('Give at least one reaction: scale, opacity, blur, rotation or offset.');
      }
      if (args.effector && (args.name !== undefined || args.position !== undefined || args.threeD !== undefined)) {
        throw new Error('name, position and threeD describe a new effector; leave them out when effector is given.');
      }
      return args;
    },
  });

  defineTool(server, {
    name: 'follow-chain',
    group: 'motion-rigs',
    timeout: 'render',
    description:
      'Makes a list of layers repeat a leader\'s motion a few frames later, each step later than the one before (valueAtTime(time - delay x step)), on position, rotation, scale and/or opacity, with an optional decay that shrinks the motion per step. Delay (frames) and Decay (percent) are slider controls on the leader or a null. ' +
      'Use when: a trail of dots, cards or letters follows a lead element, or one keyed move should echo down a stack. Do not use for: copies made from one layer (clone-array) or separate staggered entrances (add-entrance). ' +
      'Inputs: leader; followers in order (as-given by default, or order); properties (default position); delayFrames (default 3); decay 0 to 100 (default 0); mode offset (each keeps its layout and adds the leader\'s motion, default) or absolute (each moves onto the leader\'s delayed value); controls leader or null, or controlLayer. ' +
      'Returns: the control layer and controls, per follower its step, space and expression states, and skipped layers. ' +
      'Notes: key the leader once; changing its keys updates the chain. A follower with another parent follows in composition or world space. Undoable in one step. ' +
      'Example: leader {name: "Dot"}, followers [{name: "Dot 2"}, {name: "Dot 3"}], delayFrames 4, decay 15.',
    input: {
      comp: CompRef.optional(),
      leader: LayerRef.describe('The layer the others follow. Its name must be unique.'),
      followers: LayerList.describe('The followers, step 1 first.'),
      order: Order.optional().describe('Step order: as-given (default), top-down, bottom-up or random.'),
      properties: z.array(MotionProperty).min(1).max(4).optional().describe('What follows. Default ["position"].'),
      delayFrames: z.number().min(0).max(600).optional().describe('Frames between one step and the next. Default 3.'),
      decay: z.number().min(0).max(100).optional().describe('Percent of the motion lost per step. Default 0.'),
      mode: z.enum(['offset', 'absolute']).optional().describe('offset (default): own value plus the leader\'s delayed change. absolute: the leader\'s delayed value itself.'),
      controls: z.enum(['leader', 'null']).optional().describe('Where Delay and Decay go: on the leader (default) or a new null.'),
      ...ControlArgs,
    },
  });

  defineTool(server, {
    name: 'clone-array',
    group: 'motion-rigs',
    timeout: 'render',
    description:
      'Duplicates a layer N times (or takes given copies) and offsets each copy by its number from controls on a null: Step X, Step Y (Step Z), Rotation Step, Scale Step, Opacity Step and Time Offset in frames, or in ring mode Center, Radius, Radius Step, Start Angle, Angle Step and Orient. Copies read the source live, so editing the source\'s keys updates every copy. ' +
      'Use when: a row, fan, spiral or ring of one element, or a staggered echo of one animated layer. Do not use for: shapes repeated inside one shape layer (add-repeater) or different layers in a grid (grid-layout). ' +
      'Inputs: layer (the source); count 1 to 200, or copies; positionStep [x, y] or [x, y, z] (default the source\'s width plus 24 in x); rotationStep degrees; scaleStep percent; opacityStep points; timeOffsetFrames; radial {radius, startAngle, angleStep, center, radiusStep, orient}; delayContent time-remaps precomp and footage copies; stack below or above; controlLayer, controlName. ' +
      'Returns: the control layer and controls, per copy its number and expression states, cleared keys and skipped layers. ' +
      'Notes: in ring mode the source sits on the ring too. Undoable in one step. ' +
      'Example: layer {name: "Dot"}, count 11, radial {radius: 240, orient: true}, timeOffsetFrames 2.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.describe('The source layer. Its name must be unique.'),
      count: z.number().int().min(1).max(200).optional().describe('Copies to make with duplicate.'),
      copies: LayerList.optional().describe('Use these layers as copies 1, 2, 3 instead of duplicating.'),
      order: Order.optional().describe('Order of given copies: as-given (default), top-down, bottom-up or random.'),
      positionStep: Vec2or3.optional().describe('Pixels added per copy, [x, y] or [x, y, z].'),
      rotationStep: z.number().optional().describe('Degrees added per copy.'),
      scaleStep: z.number().optional().describe('Scale percent added per copy (toward 0 for mirrored layers).'),
      opacityStep: z.number().min(-100).max(100).optional().describe('Opacity points added per copy, for example -10.'),
      timeOffsetFrames: z.number().min(-600).max(600).optional().describe('Frames each copy runs behind the one before. Default 0.'),
      radial: Radial.optional().describe('Place the source and copies on a ring.'),
      delayContent: z.boolean().optional().describe('Also delay what plays inside precomp and footage copies (Time Remap by expression). Default false.'),
      stack: z.enum(['below', 'above']).optional().describe('New copies go below the source in order (default) or above it.'),
      ...ControlArgs,
    },
    toBridgeArgs: (args) => {
      const hasCount = args.count !== undefined;
      const hasCopies = args.copies !== undefined;
      if (hasCount === hasCopies) throw new Error('Give count (copies to make) or copies (layers to use), one of them.');
      if (args.radial && args.positionStep) throw new Error('positionStep is for a row; ring mode places copies with radial.');
      return args;
    },
  });

  defineTool(server, {
    name: 'shape-morph',
    group: 'motion-rigs',
    description:
      'Morphs one shape layer path into another between two times: reads both paths, gives the one with fewer vertices extra vertices on its longest segments (shape and corners stay exact), turns the other so each vertex travels the least, and writes two eased Path keys on the from path. Resampling and matching run inside After Effects in the same command (one round trip, one undo step); the result is two ordinary path keys to edit. ' +
      'Use when: an icon becomes another, a card outline becomes a pill, a blob reshapes. Do not use for: masks (set-mask-path-keyframe) or moving along a path (move-along-path). ' +
      'Inputs: from {layer, path}, the path that gets the keys; to {layer, path}, the target (rectangles, ellipses, stars and polygons are converted); path, like "Path 1" or "Group 1/Path 1", is needed when a layer has several paths; startTime or startFrame (default the in point); duration (default 0.5 s) or durationFrames; easing; space comp (default) or local; matchStart auto or keep; hideTo (default true); replaceKeys. ' +
      'Returns: both paths, vertex counts, what was subdivided, the match, the keys. ' +
      'Notes: both paths must be closed or both open. ' +
      'Example: from {layer: {name: "Play"}}, to {layer: {name: "Pause"}}, durationFrames 18.',
    input: {
      comp: CompRef.optional(),
      from: PathSpec.describe('The path that animates and gets the two keys. It must be a Bezier path.'),
      to: PathSpec.describe('The shape to morph into. The same layer with another path is allowed.'),
      ...startArgs('the from layer in point'),
      ...durationArgs('0.5'),
      easing: Easing.optional().describe(`${LAND} overshoot is refused for paths.`),
      space: z.enum(['comp', 'local']).optional().describe('comp (default): the to shape lands where it appears on screen, through both layers\' and groups\' transforms. local: its raw path coordinates.'),
      matchStart: z.enum(['auto', 'keep']).optional().describe('auto (default): pick the start vertex and direction that move the least. keep: use the paths as drawn.'),
      hideTo: z.boolean().optional().describe('Hide the to layer (or switch off the to path on the same layer) after keying. Default true.'),
      replaceKeys: z.boolean().optional().describe('Replace keys already on the from path. Default false (refused when it has keys).'),
    },
    toBridgeArgs: (args) => {
      if (args.easing === 'overshoot') throw new Error('A path cannot overshoot; use another easing.');
      return args;
    },
  });

  defineTool(server, {
    name: 'wiggle-rig',
    group: 'motion-rigs',
    timeout: 'render',
    description:
      'Adds wiggle to the position, rotation, scale and/or opacity of one or many layers with every setting on controls: Frequency, an Amount per property, Seed, Loop Seconds and Strength. Each layer gets its own seed so no two move in step; Loop Seconds above 0 makes the wiggle repeat seamlessly; Strength keyed 0 to 100 ramps it in. ' +
      'Use when: floating UI, drifting particles, handheld life on a camera null, restless icons. Do not use for: a smooth periodic float (sway-loop) or a single fixed wiggle (apply-expression-preset). ' +
      'Inputs: layers; properties (default position); frequency per second (default 0.8); positionAmount px (default 10), rotationAmount degrees (2), scaleAmount percent (2), opacityAmount points (10); axes xy, x, y or xyz; loop seconds (default 0, off); seed; strength percent; rampIn {start, duration, easing} keys Strength up from 0; order; controlLayer, controlName. ' +
      'Returns: the control layer and controls, the ramp keys and per layer the expression states. ' +
      'Notes: adds to the layer\'s keys and stacks on another rig\'s expression, so grid cells wiggle around their slots. Undoable in one step. ' +
      'Example: layers {names: ["Card 1", "Card 2"]}, properties ["position", "rotation"], frequency 0.5, positionAmount 8, loop 4.',
    input: {
      comp: CompRef.optional(),
      layers: LayerList,
      order: Order.optional().describe('Which layer gets seed offset 0: top-down (default), bottom-up, random or as-given.'),
      properties: z.array(MotionProperty).min(1).max(4).optional().describe('What wiggles. Default ["position"].'),
      frequency: z.number().min(0).max(100).optional().describe('Wiggles per second. Default 0.8, a calm drift.'),
      positionAmount: z.number().min(0).max(10000).optional().describe('Pixels. Default 10.'),
      rotationAmount: z.number().min(0).max(3600).optional().describe('Degrees. Default 2.'),
      scaleAmount: z.number().min(0).max(1000).optional().describe('Percent, the same on every axis. Default 2.'),
      opacityAmount: z.number().min(0).max(100).optional().describe('Opacity points. Default 10.'),
      axes: z.enum(['xy', 'x', 'y', 'xyz']).optional().describe('Position axes that wiggle. Default xy; xyz only moves Z on 3D layers.'),
      loop: z.number().min(0).max(600).optional().describe('Seconds after which the wiggle repeats exactly. Default 0 (no loop).'),
      seed: z.number().int().min(0).max(100000).optional().describe('Seed; change it for another pattern. Default 1.'),
      strength: z.number().min(0).max(1000).optional().describe('Percent of the amounts applied. Default 100.'),
      rampIn: RampSpec.optional().describe('Key Strength from 0 to strength in two eased keys.'),
      ...ControlArgs,
    },
  });

  defineTool(server, {
    name: 'sway-loop',
    group: 'motion-rigs',
    timeout: 'render',
    description:
      'Makes layers float in a seamless loop: Position moves on a sine (Sway X on the cosine, Sway Y on the sine, so both together trace an ellipse), with optional rotation and scale sway, repeating exactly every Period seconds, each layer shifted by a Phase Step so they never move in unison. Controls on a null: Period, Phase Step, Sway X, Sway Y, Sway Rotation, Sway Scale and Strength. ' +
      'Use when: hero cards, badges or icons hover gently, or a looping background needs calm motion. Do not use for: random motion (wiggle-rig) or a slow push on a whole scene (add-camera-push). ' +
      'Inputs: layers; period seconds (default 4); sway [x, y] px (default [0, 12]); rotation degrees; scale percent; phaseStep degrees per layer (default 60); strength percent; order; controlLayer, controlName. ' +
      'Returns: the control layer and controls, per layer its phase and expression states, and a note when the composition is not a whole number of periods. ' +
      'Notes: adds to the layers\' keys and stacks on another rig\'s expression, such as a grid. Undoable in one step. ' +
      'Example: layers {names: ["Card A", "Card B", "Card C"]}, sway [0, 10], rotation 1.5, period 5, phaseStep 90.',
    input: {
      comp: CompRef.optional(),
      layers: LayerList,
      order: Order.optional().describe('Which layer gets phase 0: top-down (default), bottom-up, random or as-given.'),
      period: z.number().positive().max(600).optional().describe('Seconds per cycle. Default 4.'),
      sway: Vec2.optional().describe('[x, y] amplitude in pixels. Default [0, 12]; [0, 0] leaves Position alone.'),
      rotation: z.number().min(-360).max(360).optional().describe('Rotation amplitude in degrees. Default none.'),
      scale: z.number().min(-100).max(1000).optional().describe('Scale amplitude in percent points. Default none.'),
      phaseStep: z.number().min(-3600).max(3600).optional().describe('Degrees of phase between one layer and the next. Default 60.'),
      strength: z.number().min(0).max(1000).optional().describe('Percent of the amplitudes applied. Default 100; key it to fade the sway.'),
      ...ControlArgs,
    },
  });

  defineTool(server, {
    name: 'fit-to-box',
    group: 'motion-rigs',
    timeout: 'render',
    description:
      'Scales layers so their content fits a box, by expression: Scale comes from the layer\'s bounds (sourceRectAtTime) and the controls Box Width, Box Height, Upscale and Scale Offset, so text that changes keeps fitting and the box can be animated. ' +
      'Use when: a logo, label or icon must fit a button, a card slot or a frame whatever its size. Do not use for: font size (fit-text-to-box), grid cells (grid-layout with fit) or filling the composition (fit-layer-to-composition). ' +
      'Inputs: layers; size [width, height] px; mode contain (default, the smaller ratio), cover, width or height; upscale (default false, only shrink); offset in percent points added; controls on the layer (default for one layer) or a null (default for several), or controlLayer. ' +
      'Returns: the control layer and controls, per layer its bounds now, the scale it gets now and the expression state. ' +
      'Notes: the layer scales about its anchor point, so the anchor decides which edge stays put. Undoable in one step. ' +
      'Example: layers [{name: "Logo"}], size [320, 120].',
    input: {
      comp: CompRef.optional(),
      layers: LayerList,
      order: Order.optional(),
      size: Vec2.describe('[width, height] of the box in pixels.'),
      mode: z.enum(['contain', 'cover', 'width', 'height']).optional().describe('contain (default): fit inside. cover: fill the box. width or height: match one side.'),
      upscale: z.boolean().optional().describe('Also scale small content up. Default false.'),
      offset: z.number().min(-1000).max(1000).optional().describe('Percent points added to the fitted scale. Default 0.'),
      controls: z.enum(['layer', 'null']).optional().describe('On the layer (default for one layer) or on a new null shared by all (default for several).'),
      ...ControlArgs,
    },
    toBridgeArgs: (args) => {
      if (!(args.size[0] > 0) || !(args.size[1] > 0)) throw new Error('size must be [width, height] above 0.');
      return args;
    },
  });
}
