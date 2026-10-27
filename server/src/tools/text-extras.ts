/*
 * More text tools (group 'text'): text on a mask path, per-character 3D with
 * flip and tumble reveals, a box or pill that always fits the text, and
 * fitting a text layer's font size to a box.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, Easing, LayerRef, TimeArgs, Vec2 } from '../schemas/common.js';
import { MaskRef } from './masks.js';
import { defineTool } from './registry.js';
import { ShapeGroupRef } from './shapes.js';
import { checkStyleSettings, StyleSettings } from './styles.js';

export const PER_CHARACTER_3D_PRESETS = ['flip-x', 'flip-y', 'tumble', 'push-z'] as const;

const TimingArgs = {
  startTime: z.number().optional().describe('Seconds. Default: the layer in point.'),
  startFrame: z.number().int().optional().describe('Frames; wins over startTime.'),
  duration: z.number().positive().optional().describe('Seconds.'),
  durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
};

const Travel = z
  .object({
    from: z.number().optional().describe('First Margin at the start, pixels along the path. Default 0 (text starts at the path start).'),
    to: z.number().optional().describe('First Margin at the end. Default: path length minus text width, so the text ends at the path end.'),
    ...TimingArgs,
    easing: Easing.optional().describe('Default: leaves gently and lands softly (speed 0, influence 40 leaving, 75 arriving).'),
  })
  .describe('Keys First Margin twice so the text travels along the path. Duration default 2 s.');

const Reveal3d = z
  .object({
    preset: z.enum(PER_CHARACTER_3D_PRESETS).optional().describe('flip-x (X Rotation -90), flip-y (Y Rotation 90), tumble (X -70, Y 30, Z -25, Position Z -120), push-z (Position Z 400). All start at Opacity 0. Default flip-x when no pose field is given.'),
    rotationX: z.number().optional().describe('Starting X Rotation per character, degrees.'),
    rotationY: z.number().optional().describe('Starting Y Rotation per character, degrees.'),
    rotationZ: z.number().optional().describe('Starting Z Rotation per character, degrees.'),
    positionZ: z.number().optional().describe('Starting Z offset per character, pixels; negative is toward the camera.'),
    opacity: z.number().min(0).max(100).optional().describe('Starting opacity in percent. Presets use 0.'),
    pivot: z.enum(['center', 'baseline']).optional().describe('center sets More Options > Grouping Alignment to [0, -50] so characters turn around their middle (layer-wide); baseline leaves it. Default center.'),
    basedOn: z.enum(['characters', 'characters-excluding-spaces', 'words', 'lines']).optional().describe('Default characters.'),
    direction: z.enum(['forward', 'backward']).optional().describe('forward reveals from the first character, backward from the last. Default forward.'),
    ...TimingArgs,
    easing: Easing.optional().describe('Easing on the two selector keys. Default: speed 0, influence 30 leaving and 80 arriving.'),
    name: z.string().min(1).optional().describe('Animator name. Default "3D <preset>".'),
  })
  .describe('A text animator holding the starting pose, with a Ramp Up range selector whose Offset is keyed -100 to 100 so characters settle one after another.');

const Padding = z.union([z.number().min(0), Vec2]).describe('Pixels around the text: one number, or [horizontal, vertical]. Default [24, 12].');

export function registerTextExtraTools(server: McpServer): void {
  defineTool(server, {
    name: 'set-text-on-path',
    group: 'text',
    description:
      'Puts a text layer on a mask path (Text > Path Options) and sets Perpendicular To Path, Force Alignment, Reverse Path and the First and Last Margins; optionally keys First Margin twice so the text travels along the path. ' +
      'Use when: a title should follow a curve, a circle or a drawn line. Do not use for: moving a whole layer along a path (move-along-path) or drawing a mask from scratch (create-mask). ' +
      'Inputs: layer (text); mask by name or index, or fromShapeLayer {layer, group, hide} to copy a shape layer path onto the text layer as a new mask; maskName; perpendicular; forceAlignment; reversePath; firstMargin and lastMargin in pixels; justification; travel {from, to, startTime or startFrame, duration or durationFrames, easing}; keepMaskMode. ' +
      'Returns: the mask, path length and text width in pixels, the options read back, and the travel keys. ' +
      'Notes: with no mask given, the path already set or the only mask is used. A closed mask is set to mode None so it does not cut the text. Travel sets left justification unless given, because centred text is centred on the path middle. Undoable in one step. ' +
      'Example: layer {name: "Title"}, mask "Mask 1", travel {durationFrames: 60}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      mask: MaskRef.optional(),
      fromShapeLayer: z
        .object({
          layer: LayerRef.describe('The shape layer whose path is copied.'),
          group: ShapeGroupRef.optional(),
          hide: z.boolean().optional().describe('Switch the shape layer off afterwards. Default false.'),
        })
        .optional()
        .describe('Create the path mask from a shape layer group instead of using an existing mask.'),
      maskName: z.string().min(1).optional().describe('Name for a mask created from fromShapeLayer.'),
      perpendicular: z.boolean().optional().describe('Perpendicular To Path. After Effects default on.'),
      forceAlignment: z.boolean().optional().describe('Spread the text over the whole path between the margins.'),
      reversePath: z.boolean().optional().describe('Run the text the other way (on a circle: outside versus inside).'),
      firstMargin: z.number().optional().describe('Pixels from the path start.'),
      lastMargin: z.number().optional().describe('Pixels from the path end.'),
      justification: z.enum(['left', 'center', 'right']).optional().describe('Paragraph justification. Default: unchanged, or left when travel is given.'),
      travel: Travel.optional(),
      keepMaskMode: z.boolean().optional().describe('Keep the mask mode instead of setting None. Default false.'),
    },
    toBridgeArgs: (args) => {
      if (args.mask !== undefined && args.fromShapeLayer) throw new Error('Pass mask or fromShapeLayer, not both.');
      if (args.travel && args.firstMargin !== undefined) throw new Error('travel keys First Margin; pass either firstMargin or travel.');
      return args;
    },
  });

  defineTool(server, {
    name: 'set-per-character-3d',
    group: 'text',
    description:
      'Turns on per-character 3D for a text layer (each character gets its own Z, X and Y rotation) and optionally adds a 3D reveal: an animator holding the starting pose with a Ramp Up range selector whose Offset is keyed twice, so characters flip, swing, tumble or push in one after another and land softly. ' +
      'Use when: a title should flip up letter by letter, swing in like doors or tumble into place. Do not use for: flat reveals (add-text-animator) or making the whole layer 3D (set-layer-3d). ' +
      'Inputs: layer (text); enabled (default true; false turns per-character 3D off); reveal {preset flip-x, flip-y, tumble or push-z; rotationX, rotationY, rotationZ, positionZ, opacity as the starting pose; pivot center or baseline; basedOn; direction; startTime or startFrame; duration (default 1 s) or durationFrames; easing; name}. ' +
      'Returns: the layer flags (threeD, threeDPerChar), the animator with its properties and selector, the keys written, the pose used, and notes. ' +
      'Notes: the layer becomes 3D. Per-character 3D renders in Classic 3D; Cinema 4D turns motion blur off. pivot center changes Grouping Alignment for the whole layer. Undoable in one step. ' +
      'Example: layer {name: "Title"}, reveal {preset: "flip-x", durationFrames: 36}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      enabled: z.boolean().optional().describe('Per-character 3D on (default) or off.'),
      reveal: Reveal3d.optional(),
    },
    toBridgeArgs: (args) => {
      if (args.enabled === false && args.reveal) throw new Error('A reveal needs per-character 3D on; drop enabled false or the reveal.');
      return args;
    },
  });

  defineTool(server, {
    name: 'add-text-box',
    group: 'text',
    description:
      'Adds a background box or pill behind a text layer that always fits the text: a shape layer rectangle whose Size, Position and Roundness are expressions on the text layer\'s sourceRectAtTime, placed directly below the text and parented to it. ' +
      'Use when: making a button, tag, chip or caption plate whose words change, including per-instance text in a component. Do not use for: a fixed rectangle (create-shape-layer) or a paragraph box that wraps text (set-text-box). ' +
      'Inputs: layer (text); padding (default [24, 12]); cornerRadius in pixels (default 12) or "pill"; fillColor (default #111827 under light text, #FFFFFF under dark text); fillOpacity; stroke {color, width, opacity}; shadow true or drop-shadow settings; heightFrom text (glyph bounds) or font (cap height, equal height for any words; point text); minWidth; link parent or expression; linkOpacity (default true); name. ' +
      'Returns: the box layer, its group path, the expressions and any expression errors, the shadow result, and notes. ' +
      'Notes: the box follows the text\'s position, rotation and scale through parenting; linkOpacity copies the text\'s opacity. A shadow may use the Layer Styles menu command (viewer). Undoable in one step. ' +
      'Example: layer {name: "CTA"}, padding [32, 16], cornerRadius "pill", fillColor "#2F6BFF", heightFrom "font", shadow true.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      padding: Padding.optional(),
      cornerRadius: z.union([z.number().min(0), z.literal('pill')]).optional().describe('Corner radius in pixels, or "pill" for half the box height. Default 12.'),
      fillColor: Color.optional().describe('Box colour. Default: #111827 under light text, #FFFFFF under dark text.'),
      fillOpacity: z.number().min(0).max(100).optional().describe('Percent. Default 100.'),
      stroke: z
        .object({
          color: Color.describe('Stroke colour.'),
          width: z.number().positive().optional().describe('Pixels. Default 1.'),
          opacity: z.number().min(0).max(100).optional().describe('Percent. Default 100.'),
        })
        .optional()
        .describe('Optional outline on the box.'),
      shadow: z.union([z.boolean(), StyleSettings]).optional().describe('true adds a soft drop-shadow layer style (black 14 %, angle 90, distance 4, size 16); an object gives drop-shadow settings.'),
      heightFrom: z.enum(['text', 'font']).optional().describe('text: the glyph bounds. font: cap height (fontSize x capHeight) plus one leading per extra line, so labels with or without descenders get the same box. Default text.'),
      capHeight: z.number().min(0.3).max(1.2).optional().describe('Cap height as a fraction of the font size for heightFrom font. Default 0.7.'),
      minWidth: z.number().min(0).optional().describe('Smallest box width in pixels, padding included. Default 0.'),
      link: z.enum(['parent', 'expression']).optional().describe('parent (default): the box is parented to the text and follows position, rotation and scale. expression: no parenting; Position follows the text through toComp, rotation and scale do not.'),
      linkOpacity: z.boolean().optional().describe('Drive the box opacity from the text layer\'s opacity. Default true.'),
      name: z.string().min(1).optional().describe('Box layer name. Default "<text layer> Box".'),
    },
    toBridgeArgs: (args) => {
      if (args.shadow && typeof args.shadow === 'object') checkStyleSettings('drop-shadow', args.shadow as Record<string, unknown>, 'shadow');
      return args;
    },
  });

  defineTool(server, {
    name: 'fit-text-to-box',
    group: 'text',
    description:
      'Sets a text layer\'s font size so the text fits a width and height: for paragraph (box) text the largest size at which every line still composes inside the box, for point text the largest size whose bounds fit. ' +
      'Use when: a caption, label or name must fit a fixed area. Do not use for: resizing the box (set-text-box) or a plate behind text (add-text-box). ' +
      'Inputs: layer (text); width and height in pixels (default the paragraph box; point text needs one); mode once (default) or expression; minFontSize and maxFontSize (1 to 1296); shrinkOnly (default false, true for expression); scaleLeading (default true); time or frame. ' +
      'Returns: font size before and after, measured bounds, box size, method, iterations, and the expression in expression mode. ' +
      'Notes: mode once is the reliable way: After Effects lays the text out at each trial size and bisection finds the size, using boxOverflow on 24.6 or later and a tall-box comparison before. Mode expression puts a Scale expression on point text so changing words keep fitting; it scales the layer, not the font. Keyed Source Text gets a key at the time. Undoable in one step. ' +
      'Example: layer {name: "Caption"}, width 900, height 240.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      width: z.number().positive().optional().describe('Pixels. Default: the paragraph box width.'),
      height: z.number().positive().optional().describe('Pixels. Default: the paragraph box height.'),
      mode: z.enum(['once', 'expression']).optional().describe('once (default): compute and set the font size now. expression: a Scale expression on point text that fits it at every frame.'),
      minFontSize: z.number().min(0.1).max(1296).optional().describe('Default 1.'),
      maxFontSize: z.number().min(0.1).max(1296).optional().describe('Default 1296.'),
      shrinkOnly: z.boolean().optional().describe('Never make the text bigger than it is. Default false for once, true for expression.'),
      scaleLeading: z.boolean().optional().describe('Scale a fixed leading with the font size. Default true.'),
      ...TimeArgs,
    },
    toBridgeArgs: (args) => {
      if (args.minFontSize !== undefined && args.maxFontSize !== undefined && args.minFontSize > args.maxFontSize) throw new Error('minFontSize must not be greater than maxFontSize.');
      if (args.mode === 'expression' && args.width === undefined && args.height === undefined) throw new Error('mode expression needs width, height or both.');
      return args;
    },
  });
}
