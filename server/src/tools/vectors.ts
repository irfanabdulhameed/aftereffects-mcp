/*
 * Vector tools (group 'shapes'): importing .ai and .svg files as editable
 * shape layers, gradient fills and strokes with colour stops, and shape
 * groups drawn from SVG path data.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { getBridge } from '../bridge/client.js';
import { toRgba } from '../schemas/color.js';
import { Color, CompRef, LayerRef, Vec2 } from '../schemas/common.js';
import { prepareGradientPreset, templateFolder } from './gradient-preset.js';
import { defineTool } from './registry.js';
import { ShapeGroupRef } from './shapes.js';
import { SvgPathError, svgPathToAe } from './svg-path.js';

export const VECTOR_EXTENSIONS = ['.ai', '.eps', '.pdf', '.svg'] as const;

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export const GradientStopSpec = z.object({
  offset: z.number().min(0).max(1).describe('Position along the gradient, 0 (start point) to 1 (end point).'),
  color: Color,
  opacity: z.number().min(0).max(100).optional().describe('Stop opacity in percent. Default 100 (or the colour\'s own alpha).'),
});

const ViewBox = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]).describe('[minX, minY, width, height] of the SVG viewBox.');

export function registerVectorTools(server: McpServer): void {
  defineTool(server, {
    name: 'import-vector-as-shapes',
    group: 'shapes',
    timeout: 120000,
    description:
      'Imports an Illustrator (.ai, .eps, .pdf) or .svg file, adds it to a composition and converts it to an editable shape layer with Create Shapes from Vector Layer, so every path, fill and stroke can be animated. ' +
      'Use when: a logo, icon or illustration from a vector editor must become shape layers. Do not use for: raw SVG path data (shape-from-svg-path) or placing footage unchanged (import-file). ' +
      'Inputs: path, absolute; comp; name for the shape layer; position; removeSource (default false) deletes the vector footage layer; removeFootageItem also deletes the imported item when nothing else uses it; mode auto, footage or composition for SVG. ' +
      'Returns: the route used, the shape layers with their group names, the source item, the source layer or what was removed, and notes. ' +
      'Notes: SVG needs After Effects 26.0 or later; an SVG that arrives as a composition of shape layers has those layers copied into the comp. The menu command opens the comp in the viewer and brings After Effects to the front; the selection is restored. Undoable in one step. ' +
      'Example: path "~/Design/logo.ai", comp {name: "Main"}, removeSource true.',
    input: {
      path: z.string().min(1).describe('Absolute path to the .ai, .eps, .pdf or .svg file. "~/" is expanded.'),
      comp: CompRef.optional(),
      name: z.string().min(1).optional().describe('Name for the shape layer. Default: After Effects names it "<file> Outlines".'),
      position: Vec2.optional().describe('Position of the new layers in comp pixels. Default: where After Effects places them (comp centre).'),
      removeSource: z.boolean().optional().describe('Delete the vector footage layer after the conversion. Default false (After Effects hides it).'),
      removeFootageItem: z.boolean().optional().describe('Also delete the imported footage or SVG composition from the project when nothing else uses it. Default false.'),
      mode: z.enum(['auto', 'footage', 'composition']).optional().describe('SVG only: auto (default) tries footage then composition; footage forces Create Shapes from Vector Layer; composition copies the shape layers of an SVG composition.'),
    },
    toBridgeArgs: (args) => {
      const p = path.resolve(expandHome(args.path.trim()));
      const ext = path.extname(p).toLowerCase();
      if (!(VECTOR_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new Error(`"${args.path}" is not a vector file. Use .ai, .eps, .pdf or .svg.`);
      }
      return { ...args, path: p, extension: ext.slice(1) };
    },
  });

  defineTool(server, {
    name: 'set-shape-gradient',
    group: 'shapes',
    timeout: 60000,
    description:
      'Gives a group on a shape layer a Gradient Fill or Gradient Stroke: linear or radial type, start and end points, highlight length and angle, opacity, width and colour stops. ' +
      'Use when: a card, button or logo shape needs a gradient with chosen colours. Do not use for: solid colours (set-shape-fill, set-shape-stroke). ' +
      'Inputs: layer; group; target fill or stroke; type; start and end in group pixels; stops [{offset 0 to 1, color, opacity}]; highlightLength, highlightAngle; opacity; width; replaceSolid (default true); allowClipboard (default false); stopsOptional; templateFolder. ' +
      'Returns: the gradient item, type, points, opacity, width, fields changed, and stops {requested, applied, route, reason}. ' +
      'Notes: scripts cannot write colour stops, so stops travel in a preset made from a template saved once by hand (gradient-fill.ffx or gradient-stroke.ffx in templateFolder or <bridge folder>/templates) and are pasted into the group. That replaces the clipboard and brings After Effects to the front, so it runs only with allowClipboard true. Otherwise type and points are set and the call fails with unsupported unless stopsOptional. ' +
      'Example: layer {name: "Card"}, type "linear", start [-200, 0], end [200, 0], stops [{offset: 0, color: "#6A5CFF"}, {offset: 1, color: "#00C2FF"}].',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      group: ShapeGroupRef.optional(),
      target: z.enum(['fill', 'stroke']).optional().describe('Gradient Fill (default) or Gradient Stroke.'),
      type: z.enum(['linear', 'radial']).optional().describe('Gradient type. Default linear for a new gradient; unchanged on an existing one.'),
      start: Vec2.optional().describe('Start point in group pixels.'),
      end: Vec2.optional().describe('End point in group pixels.'),
      stops: z.array(GradientStopSpec).min(2).max(32).optional().describe('Colour stops. At least two.'),
      highlightLength: z.number().min(-100).max(100).optional().describe('Radial only: Highlight Length in percent.'),
      highlightAngle: z.number().optional().describe('Radial only: Highlight Angle in degrees.'),
      opacity: z.number().min(0).max(100).optional().describe('Opacity of the gradient fill or stroke in percent.'),
      width: z.number().min(0).optional().describe('Stroke width in pixels (target stroke). Default: the width of the solid stroke it replaces, else 2.'),
      replaceSolid: z.boolean().optional().describe('Remove the solid Fill (or Stroke) of the group so only the gradient draws. Default true.'),
      allowClipboard: z.boolean().optional().describe('Allow the copy and paste route that writes colour stops: it replaces the clipboard and brings After Effects to the front. Default false, so unattended runs never take over the screen.'),
      stopsOptional: z.boolean().optional().describe('Report stops that could not be set as a warning instead of failing. Default false.'),
      templateFolder: z.string().min(1).optional().describe('Folder holding gradient-fill.ffx and gradient-stroke.ffx. Default: AE_MCP_GRADIENT_TEMPLATES, else <bridge folder>/templates.'),
    },
    toBridgeArgs: (args) => {
      const kind = args.target ?? 'fill';
      const out: Record<string, unknown> = { ...args, target: kind };
      delete out.templateFolder;
      delete out.allowClipboard;
      if (args.stops && !args.allowClipboard) {
        out.stopsUnavailable = 'Writing colour stops replaces the clipboard and brings After Effects to the front; pass allowClipboard true to allow it.';
      } else if (args.stops) {
        const stops = args.stops.map((s) => {
          const rgba = toRgba(s.color);
          return { offset: s.offset, rgba, opacity: s.opacity ?? Math.round(rgba[3] * 1000) / 10 };
        });
        out.stops = stops.map((s) => ({ offset: s.offset, color: s.rgba, opacity: s.opacity }));
        const bridgeDir = getBridge().config.bridgeDir;
        const folder = templateFolder(args.templateFolder ? expandHome(args.templateFolder) : undefined, bridgeDir);
        const prepared = prepareGradientPreset(kind, stops, folder, bridgeDir);
        out.presetPath = prepared.presetPath;
        out.templatePath = prepared.templatePath;
        out.stopsUnavailable = prepared.reason;
      }
      return out;
    },
  });

  defineTool(server, {
    name: 'shape-from-svg-path',
    group: 'shapes',
    description:
      'Draws SVG path data as After Effects bezier paths. The "d" string is parsed on the server (M, L, H, V, C, S, Q, T, A, Z, relative forms too; arcs become cubics; each subpath becomes a Path in one group) and written as a new shape layer, a new group, or the paths of an existing group. ' +
      'Use when: an icon or logo is available as SVG path data. Do not use for: whole .svg or .ai files (import-vector-as-shapes) or plain rectangles and ellipses (create-shape-layer). ' +
      'Inputs: d; viewBox; size to fit into, or scale (wins) and offset; center (default true) centres it on the group origin; layer and group to add to or replace; name, groupName, position; fillColor, noFill, strokeColor, strokeWidth, fillRule, lineCap, lineJoin, groupOpacity (icons: add-icon). ' +
      'Returns: the layer, the group with its path count and property paths, vertexCount, the placement and the bounds in group pixels. ' +
      'Notes: holes need the right fill rule (most icon sets use non-zero). Replacing a group\'s paths keeps its fill, stroke and transform. Undoable in one step. ' +
      'Example: d "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z", viewBox [0, 0, 24, 24], size [240, 240], fillColor "#FFFFFF".',
    input: {
      comp: CompRef.optional(),
      d: z.string().min(1).max(200000).describe('SVG path data, the "d" attribute.'),
      viewBox: ViewBox.optional(),
      size: Vec2.optional().describe('[width, height] in pixels to fit the viewBox (or the path bounds) into, keeping the aspect ratio. Default: 1 path unit = 1 pixel.'),
      scale: z.union([z.number().positive(), Vec2]).optional().describe('Pixels per path unit, one number or [x, y]. Wins over size.'),
      offset: Vec2.optional().describe('[x, y] pixels added after scaling, relative to the group origin. Default [0, 0].'),
      center: z.boolean().optional().describe('Centre the viewBox (or the path bounds when there is no viewBox) on the group origin. Default true.'),
      layer: LayerRef.optional().describe('Existing shape layer to draw on. Default: a new shape layer.'),
      group: ShapeGroupRef.optional().describe('With layer: an existing group whose paths are replaced. Default: a new group.'),
      name: z.string().min(1).optional().describe('Name of a new shape layer. Default "SVG Path".'),
      groupName: z.string().min(1).optional().describe('Name of a new group. Default "SVG Path".'),
      position: Vec2.optional().describe('Position of a new shape layer in comp pixels. Default: comp centre.'),
      fillColor: Color.optional().describe('Fill colour. Default white when no stroke is given.'),
      noFill: z.boolean().optional().describe('No fill.'),
      strokeColor: Color.optional(),
      strokeWidth: z.number().min(0).optional().describe('Stroke width in pixels. 0 or omitted means no stroke unless strokeColor is given (then 2).'),
      fillRule: z.enum(['non-zero', 'even-odd']).optional().describe('Fill rule for overlapping subpaths. Default non-zero, like SVG.'),
      lineCap: z.enum(['butt', 'round', 'square']).optional().describe('Stroke line cap. Default After Effects\' butt.'),
      lineJoin: z.enum(['miter', 'round', 'bevel']).optional().describe('Stroke line join. Default After Effects\' miter.'),
      groupOpacity: z.number().min(0).max(100).optional().describe('Opacity of the group, 0 to 100. Default 100.'),
    },
    toBridgeArgs: (args) => {
      if (args.group !== undefined && !args.layer) throw new Error('group needs layer: pass the shape layer that holds the group.');
      let parsed;
      try {
        parsed = svgPathToAe(args.d, { viewBox: args.viewBox, size: args.size, scale: args.scale, offset: args.offset, center: args.center });
      } catch (err) {
        if (err instanceof SvgPathError) throw new Error(`Invalid SVG path data: ${err.message}`);
        throw err;
      }
      const out: Record<string, unknown> = { ...args, paths: parsed.paths, bounds: parsed.bounds, sourceBounds: parsed.sourceBounds, placement: parsed.placement, vertexCount: parsed.vertexCount };
      delete out.d;
      return out;
    },
  });
}
