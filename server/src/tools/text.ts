/*
 * Text tools: layers, content, style, fonts, text animators and selectors,
 * outlines and paragraph boxes.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, Easing, LayerRef, TimeArgs, Vec2 } from '../schemas/common.js';
import { PlacementArgs } from './layers.js';
import { defineTool } from './registry.js';

export const TextStyleArgs = {
  font: z.string().optional().describe('PostScript font name, for example "Helvetica-Bold". Use list-fonts to find it.'),
  fontSize: z.number().positive().optional().describe('Pixels.'),
  fillColor: Color.optional(),
  strokeColor: Color.optional(),
  strokeWidth: z.number().min(0).optional().describe('Pixels. 0 removes the stroke.'),
  strokeOverFill: z.boolean().optional(),
  tracking: z.number().optional().describe('Tracking in thousandths of an em.'),
  leading: z.number().optional().describe('Line spacing in pixels. Turns auto leading off.'),
  autoLeading: z.boolean().optional(),
  justification: z.enum(['left', 'center', 'right', 'justify-left', 'justify-right', 'justify-center', 'justify-full']).optional(),
  baselineShift: z.number().optional().describe('Baseline shift in pixels.'),
  allCaps: z.boolean().optional(),
  smallCaps: z.boolean().optional(),
  fauxBold: z.boolean().optional(),
  fauxItalic: z.boolean().optional(),
  verticalScale: z.number().optional().describe('Percent.'),
  horizontalScale: z.number().optional().describe('Percent.'),
  tsume: z.number().optional().describe('Tsume (Japanese proportional spacing), 0 to 100.'),
};

const StyleRef = z
  .union([z.string().regex(/^@style\./), z.object(TextStyleArgs)])
  .optional()
  .describe('A named text style from the style file ("@style.h1") or an inline style object. Explicit fields override it.');

function mergeStyle(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  const style = out.style;
  delete out.style;
  if (style && typeof style === 'object') {
    for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
      if (out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

/** Built-in text animator presets. Every name here is a key of MCP.textAnimatorPresets in commands/text.jsx. */
export const TEXT_ANIMATOR_PRESETS = [
  'fade-in-by-character',
  'fade-in-by-word',
  'fade-in-by-line',
  'slide-up-by-character',
  'slide-up-by-word',
  'scale-in-by-character',
  'blur-in-by-character',
  'tracking-in',
  'typewriter',
  'random-fade-in',
  'rotate-in-by-character',
  'wave-y-position',
] as const;

export const AnimatorRef = z
  .union([z.string().describe('Animator name as shown under the layer\'s Text group, for example "Animator 1".'), z.number().int().positive().describe('1-based position in the Animators list.')])
  .describe('Which text animator: its name or 1-based index. Omit it when the layer has exactly one animator.');

const BasedOn = z
  .enum(['characters', 'characters-excluding-spaces', 'words', 'lines'])
  .describe('Unit the selector counts in. Default characters.');

const RangeShape = z
  .enum(['square', 'ramp-up', 'ramp-down', 'triangle', 'round', 'smooth'])
  .describe('Falloff of the selection across the range. square is hard-edged; triangle, round and smooth fade in and out.');

const SelectorMode = z.enum(['add', 'subtract', 'intersect', 'min', 'max', 'difference']).describe('How this selector combines with the ones above it. Default add.');

const RangeSelectorArgs = {
  start: z.number().optional().describe('Range start in percent (0 to 100) or in characters when units is "index".'),
  end: z.number().optional().describe('Range end in percent or index.'),
  offset: z.number().optional().describe('Shifts start and end together. Percent or index.'),
  units: z.enum(['percent', 'index']).optional().describe('percent (default) or index (character counts).'),
  basedOn: BasedOn.optional(),
  mode: SelectorMode.optional(),
  amount: z.number().min(0).max(100).optional().describe('How strongly the animator applies inside the range, percent. Default 100.'),
  shape: RangeShape.optional(),
  smoothness: z.number().min(0).max(100).optional().describe('Edge smoothing for the square shape, percent.'),
  easeHigh: z.number().min(-100).max(100).optional().describe('Ease High, percent.'),
  easeLow: z.number().min(-100).max(100).optional().describe('Ease Low, percent.'),
  randomizeOrder: z.boolean().optional().describe('Apply the range in a random character order.'),
  randomSeed: z.number().int().min(0).optional().describe('Seed for randomizeOrder.'),
};

export function registerTextTools(server: McpServer): void {
  defineTool(server, {
    name: 'create-text-layer',
    group: 'text',
    description:
      'Creates a point text layer (or a paragraph box when boxSize is given) with the text, font, size, colour, stroke, tracking, leading and justification set in one call, centred in the composition unless a position is given. ' +
      'Use when: adding any title, label or caption. Do not use for: changing text on an existing layer (set-text) or restyling it (set-text-style). ' +
      'Inputs: text (use "\\n" for new lines); the style fields (font as a PostScript name, fontSize, fillColor, strokeColor, strokeWidth, tracking, leading, justification, allCaps and so on); style "@style.h1" to pull a named style from the style file; boxSize [w, h] for paragraph text; the shared placement fields (name, position, timing, parent, above, below). ' +
      'Returns: composition and the layer summary with textDocument showing the font actually applied. ' +
      'Notes: if a font is not installed, After Effects keeps the default and the result shows it; check list-fonts. Defaults: white, 72 px, centred. Undoable in one step. ' +
      'Example: text "HELLO", font "Helvetica-Bold", fontSize 120, fillColor "#ffffff", position [960, 540].',
    input: {
      comp: CompRef.optional(),
      text: z.string().describe('The text. "\\n" starts a new line.'),
      boxSize: Vec2.optional().describe('[width, height] to create paragraph (box) text.'),
      style: StyleRef,
      ...TextStyleArgs,
      ...PlacementArgs,
    },
    toBridgeArgs: (args) => mergeStyle(args as Record<string, unknown>),
  });

  defineTool(server, {
    name: 'set-text',
    group: 'text',
    description:
      'Replaces the text of a text layer, keeping its styling. Optionally keys the Source Text at a time, which is how text changes over time in After Effects (hold keyframes). ' +
      'Use when: correcting a title, or building a counter or word-change sequence. Do not use for: per-character animation (add-text-animator) or styling (set-text-style). ' +
      'Inputs: layer; text; time or frame to set a Source Text keyframe at that time instead of the static value; renameLayer to rename the layer to the text. ' +
      'Returns: composition, layer, the resulting textDocument and the number of Source Text keys. ' +
      'Notes: Source Text keys are always hold keys. Undoable in one step. ' +
      'Example: layer {name: "Counter"}, text "42", frame 30.',
    input: { comp: CompRef.optional(), layer: LayerRef, text: z.string().describe('The new text. A backslash-n sequence starts a new line.'), ...TimeArgs, renameLayer: z.boolean().optional() },
  });

  defineTool(server, {
    name: 'get-text',
    group: 'text',
    mutating: false,
    description:
      'Reads the text and full style (font, size, colours, tracking, leading, justification, box settings) of a text layer, optionally at a time. ' +
      'Use when: copying a style from a reference, or confirming the font After Effects actually used. Do not use for: non-text layers (it errors). ' +
      'Inputs: layer; time or frame (optional). ' +
      'Returns: text, textDocument, the number of Source Text keys and whether an expression is present. ' +
      'Notes: read-only. ' +
      'Example: layer {name: "Title"}.',
    input: { comp: CompRef.optional(), layer: LayerRef, ...TimeArgs },
  });

  defineTool(server, {
    name: 'set-text-style',
    group: 'text',
    description:
      'Changes any subset of a text layer\'s style: font (PostScript name), size, fill, stroke colour and width, tracking, leading, justification, baseline shift, all caps, small caps, faux bold and italic, vertical and horizontal scale, tsume. ' +
      'Use when: restyling a layer, or applying a named style from the style file with style "@style.body". Do not use for: changing the words (set-text) or animating style (text animators). ' +
      'Inputs: layer plus any style fields; style "@style.<name>" merges the named style under explicit fields. ' +
      'Returns: the fields changed, the resulting textDocument, and warnings when a requested font could not be applied. ' +
      'Notes: the style applies to the whole layer. If Source Text has keyframes, the change is keyed at the current time. Undoable in one step. ' +
      'Example: layer {name: "Subtitle"}, fontSize 36, tracking 50, fillColor "#9aa0b4".',
    input: { comp: CompRef.optional(), layer: LayerRef, style: StyleRef, ...TextStyleArgs },
    toBridgeArgs: (args) => mergeStyle(args as Record<string, unknown>),
  });

  defineTool(server, {
    name: 'list-fonts',
    group: 'text',
    mutating: false,
    description:
      'Lists the fonts installed in After Effects with the PostScript name that set-text-style and create-text-layer expect, plus family and style names, filtered by a search word. ' +
      'Use when: you need the exact PostScript name of a font, or want to know whether a font is installed before styling a layer. Do not use for: reading the font already on a layer (get-text). ' +
      'Inputs: query, a case-insensitive substring matched against the PostScript, family and style names; maxResults (default 200). ' +
      'Returns: supported (true when the font list is available), totalInstalled, count, truncated, and fonts[] of {postScriptName, family, style, fontType, technology, isSubstitute}. ' +
      'Notes: read-only. The font list needs After Effects 24.0 or later (app.fonts). On older versions supported is false with a message; any installed PostScript name can still be passed to set-text-style, and the result of that call shows whether it was applied. ' +
      'Example: query "helvetica".',
    input: {
      query: z.string().optional().describe('Case-insensitive substring of the PostScript, family or style name.'),
      maxResults: z.number().int().positive().max(5000).optional().describe('Default 200.'),
    },
  });

  defineTool(server, {
    name: 'list-text-animator-presets',
    group: 'text',
    mutating: false,
    description:
      'Lists the built-in text animator presets for add-text-animator with a description of each motion and every parameter\'s name, default value and meaning. ' +
      'Use when: choosing how a title should animate on, or checking what amount means for a given preset. Do not use for: effect looks (list-effect-templates) or .ffx files on disk (list-presets). ' +
      'Inputs: none. ' +
      'Returns: count, presets[] of {name, description, params[] of {name, defaultValue, description}}, and scheme, a short explanation of how the direction option drives the range selector. ' +
      'Notes: read-only. Preset names are stable and match the preset enum of add-text-animator. ' +
      'Example: call it once, then add-text-animator with preset "slide-up-by-word" and duration 0.8.',
    input: {},
  });

  defineTool(server, {
    name: 'add-text-animator',
    group: 'text',
    description:
      'Adds a text animator from a preset and keyframes its range selector so characters, words or lines animate on one after another: fades, slide up, scale in, blur in, rotate in, typewriter, random fade, tracking in, or a continuous wave. ' +
      'Use when: animating a title, caption or list on screen. Do not use for: moving the whole layer (set-keyframes-bulk) or changing the words (set-text). ' +
      'Inputs: layer; preset (see list-text-animator-presets); duration in seconds (default 1) or durationFrames; delay after the layer in point (default 0) or delayFrames; easing (default ease-out); direction forward, backward or center; basedOn; amount to scale the motion; name. ' +
      'Returns: the animator (name, path, properties, selectors), animatorPath, selectorPath, keyframes per property, and scheme. ' +
      'Notes: the animator values apply inside the selector range. forward keys Start 0 to 100 so the first unit finishes first; backward keys End 100 to 0 so the last finishes first; center keys Start 50 to 0 and End 50 to 100 in subtract mode so the middle finishes first. tracking-in keys Tracking Amount directly; wave-y-position adds a wiggly selector with no keys. Untested against a real After Effects. Undoable in one step. ' +
      'Example: layer {name: "Title"}, preset "fade-in-by-word", duration 0.8, delay 0.25.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      preset: z.enum(TEXT_ANIMATOR_PRESETS),
      name: z.string().optional().describe('Animator name. Default: the preset name in title case.'),
      duration: z.number().positive().optional().describe('Seconds the reveal takes. Default 1.'),
      durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
      delay: z.number().min(0).optional().describe('Seconds after the layer in point before the reveal starts. Default 0.'),
      delayFrames: z.number().int().min(0).optional().describe('Frames; wins over delay.'),
      easing: Easing.optional().describe('Easing on the selector keyframes. Default ease-out. typewriter forces linear.'),
      direction: z.enum(['forward', 'backward', 'center']).optional().describe('Which end of the text finishes first. Default forward.'),
      basedOn: BasedOn.optional(),
      amount: z.number().optional().describe('Preset-specific magnitude override. See list-text-animator-presets.'),
      randomSeed: z.number().int().min(0).optional().describe('Random seed for random-fade-in and wave-y-position.'),
    },
  });

  defineTool(server, {
    name: 'add-text-range-selector',
    group: 'text',
    description:
      'Adds a range selector to an existing text animator and sets its start, end, offset, units, based on, mode, amount, shape, smoothness, ease and randomize order in one call. A range selector chooses which characters, words or lines an animator affects. ' +
      'Use when: an animator needs a second selector (for example to restrict a wiggle to one word) or was created without one. Do not use for: changing an existing selector (set-range-selector) or a wiggle or expression driven selection (add-text-wiggly-selector, add-text-expression-selector). ' +
      'Inputs: layer; animator by name or index; start, end, offset (percent, or character counts when units is "index"); basedOn; mode; amount; shape; smoothness; easeHigh; easeLow; randomizeOrder; randomSeed; name. ' +
      'Returns: the animator summary, the selector with its path and current values, and the fields changed. ' +
      'Notes: a new selector defaults to start 0, end 100, offset 0, add mode. Untested against a real After Effects. Undoable in one step. ' +
      'Example: animator "Animator 1", start 0, end 50, basedOn "words", shape "ramp-up".',
    input: { comp: CompRef.optional(), layer: LayerRef, animator: AnimatorRef.optional(), name: z.string().optional().describe('Name for the new selector.'), ...RangeSelectorArgs },
  });

  defineTool(server, {
    name: 'set-range-selector',
    group: 'text',
    description:
      'Changes an existing range selector on a text animator: start, end, offset, units, based on, mode, amount, shape, smoothness, ease high and low, randomize order. With a time or frame the start, end and offset values are written as keyframes with easing instead of static values. ' +
      'Use when: retiming or reshaping a reveal that add-text-animator built, or hand-keying a selector. Do not use for: adding a selector (add-text-range-selector) or wiggly and expression selectors. ' +
      'Inputs: layer; animator by name or index; selector index within the animator (default 1); the range fields; time or frame plus easing to keyframe start, end and offset at that time. ' +
      'Returns: the selector with its path and values, the fields changed, and keyframes written. ' +
      'Notes: keys go on whichever of start, end and offset are given. Units switches which properties exist (percent or index), so set units first when changing it. Untested against a real After Effects. Undoable in one step. ' +
      'Example: animator 1, selector 1, offset 100, frame 24, easing "ease-out".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      animator: AnimatorRef.optional(),
      selector: z.number().int().positive().optional().describe('1-based selector index inside the animator. Default 1.'),
      ...RangeSelectorArgs,
      ...TimeArgs,
      easing: Easing.optional(),
    },
  });

  defineTool(server, {
    name: 'add-text-wiggly-selector',
    group: 'text',
    description:
      'Adds a wiggly selector to a text animator so the animator\'s values vary randomly over time per character, word or line, with no keyframes needed. Combined with a Position or Rotation animator property this gives jitter, waves and handwriting-like motion. ' +
      'Use when: you want continuous random motion on text. Do not use for: a one-time reveal (add-text-animator with a preset) or expression-driven selection (add-text-expression-selector). ' +
      'Inputs: layer; animator by name or index; maxAmount and minAmount in percent (defaults 100 and -100); basedOn; wigglesPerSecond (default 2); correlation in percent (default 50, how alike neighbours move); temporalPhase and spatialPhase in degrees; lockDimensions; randomSeed; mode. ' +
      'Returns: the animator summary and the new selector with its path and values. ' +
      'Notes: the wiggly selector intersects with any range selector above it by default. Property lookups fall back to display names, so untested version differences degrade gracefully into notes. Undoable in one step. ' +
      'Example: animator "Wave", wigglesPerSecond 1.5, correlation 80.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      animator: AnimatorRef.optional(),
      name: z.string().optional().describe('Name for the new selector.'),
      maxAmount: z.number().min(-100).max(100).optional().describe('Percent. Default 100.'),
      minAmount: z.number().min(-100).max(100).optional().describe('Percent. Default -100.'),
      basedOn: BasedOn.optional(),
      mode: SelectorMode.optional(),
      wigglesPerSecond: z.number().min(0).optional().describe('Default 2.'),
      correlation: z.number().min(0).max(100).optional().describe('Percent. Default 50.'),
      temporalPhase: z.number().optional().describe('Degrees.'),
      spatialPhase: z.number().optional().describe('Degrees.'),
      lockDimensions: z.boolean().optional(),
      randomSeed: z.number().int().min(0).optional().describe('Seed for the wiggle randomness.'),
    },
  });

  defineTool(server, {
    name: 'add-text-expression-selector',
    group: 'text',
    description:
      'Adds an expression selector to a text animator and sets the expression on its Amount property. The expression runs once per character (or word or line) with textIndex and textTotal available, and returns the selection amount for that unit, so any formula can drive which parts of the text the animator affects. ' +
      'Use when: a reveal needs custom logic, for example every other character, or a selection driven by a slider. Do not use for: simple ranges (add-text-range-selector) or random motion (add-text-wiggly-selector). ' +
      'Inputs: layer; animator by name or index; expression, the JavaScript expression body; basedOn; name. ' +
      'Returns: the animator summary, the selector with its path, and the expression state with any error After Effects reports. ' +
      'Notes: the Amount value is a percentage per axis; return a number or an array. A typical body is "selectorValue * textIndex / textTotal". Untested against a real After Effects. Undoable in one step. ' +
      'Example: animator 1, expression "(textIndex % 2 == 0) ? 100 : 0".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      animator: AnimatorRef.optional(),
      name: z.string().optional().describe('Name for the new selector.'),
      expression: z.string().describe('Expression body for the selector Amount.'),
      basedOn: BasedOn.optional(),
    },
  });

  defineTool(server, {
    name: 'convert-text-to-shapes',
    group: 'text',
    description:
      'Runs the Create Shapes from Text menu command on a text layer, producing a new shape layer named "<name> Outlines" above it with one group per character, and turns the original text layer off. ' +
      'Use when: you need editable vector outlines of text for trim paths, per-glyph fills, morphing, or masks from glyphs (create-mask-from-shape-layer). Do not use for: animating text as text (add-text-animator), because the outlines no longer respond to font or text changes. ' +
      'Inputs: layer; keepSource true to leave the original text layer enabled. ' +
      'Returns: the source layer reference with its enabled state, the new shape layer summary, and the number of groups it contains. ' +
      'Notes: this uses a menu command, so the composition is opened in the viewer and every other layer is deselected first. If the menu id is not found it fails with unsupported. Fonts with no outline data produce empty groups. Untested against a real After Effects. Undoable in one step. ' +
      'Example: layer {name: "LOGO"}.',
    input: { comp: CompRef.optional(), layer: LayerRef, keepSource: z.boolean().optional().describe('Leave the text layer switched on. Default false.') },
  });

  defineTool(server, {
    name: 'set-text-box',
    group: 'text',
    description:
      'Converts a point text layer to paragraph (box) text with a given box size, resizes an existing box, or converts box text back to point text. Box text wraps lines inside the box; point text grows freely. ' +
      'Use when: a caption should wrap inside a fixed width, or a box needs a new size. Do not use for: creating a new box text layer (create-text-layer with boxSize) or changing the words (set-text). ' +
      'Inputs: layer; boxSize [width, height] in pixels to set box text and its size; pointText true to convert back to point text. ' +
      'Returns: the resulting textDocument (boxText, boxTextSize) and which fields changed. ' +
      'Notes: converting between point and box text through scripting needs a recent After Effects (the boxText flag became writable in 2023 era releases). If the conversion does not take, the call fails with unsupported and suggests create-text-layer with boxSize. Resizing an existing box works in older versions. Undoable in one step. ' +
      'Example: layer {name: "Body"}, boxSize [900, 300].',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      boxSize: Vec2.optional().describe('[width, height] in pixels. Sets box text.'),
      pointText: z.boolean().optional().describe('true converts back to point text.'),
    },
  });
}
