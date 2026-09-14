/*
 * Text tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, LayerRef, TimeArgs, Vec2 } from '../schemas/common.js';
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
  baselineShift: z.number().optional(),
  allCaps: z.boolean().optional(),
  smallCaps: z.boolean().optional(),
  fauxBold: z.boolean().optional(),
  fauxItalic: z.boolean().optional(),
  verticalScale: z.number().optional().describe('Percent.'),
  horizontalScale: z.number().optional().describe('Percent.'),
  tsume: z.number().optional(),
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
    input: { comp: CompRef.optional(), layer: LayerRef, text: z.string(), ...TimeArgs, renameLayer: z.boolean().optional() },
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
}
