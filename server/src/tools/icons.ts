/*
 * Icons from open icon sets, drawn as shape layers: Lucide (ISC), Material
 * Symbols (Apache 2.0) and Phosphor (MIT). The SVG is fetched once from the
 * jsDelivr CDN at a pinned package version and kept in <bridge>/icons/, every
 * element (path, circle, rect, line, polyline, polygon, ellipse) becomes path
 * data, and shape-from-svg-path draws it, so the icon stays a real vector.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getBridge } from '../bridge/client.js';
import { Color } from '../schemas/color.js';
import { CompRef, LayerRef } from '../schemas/common.js';
import { defineTool, jsonResult } from './registry.js';
import { aeShapesBounds, parseSvgPath, pathBounds, placementFor, toAeShapes } from './svg-path.js';

export type IconSet = 'lucide' | 'material' | 'phosphor';

const PACKAGES: Record<IconSet, { pkg: string; license: string }> = {
  lucide: { pkg: 'lucide-static@1.56.0', license: 'Lucide, ISC licence' },
  material: { pkg: '@material-symbols/svg-400@0.48.0', license: 'Material Symbols, Apache 2.0 licence' },
  phosphor: { pkg: '@phosphor-icons/core@2.1.1', license: 'Phosphor Icons, MIT licence' },
};

export const MATERIAL_STYLES = ['outlined', 'rounded', 'sharp'] as const;
export const PHOSPHOR_WEIGHTS = ['regular', 'thin', 'light', 'bold', 'fill', 'duotone'] as const;

/** Path of the icon's SVG inside its package. */
export function iconFile(set: IconSet, name: string, style?: string, filled?: boolean): string {
  if (set === 'lucide') return `icons/${name}.svg`;
  if (set === 'material') return `${style ?? 'outlined'}/${name}${filled ? '-fill' : ''}.svg`;
  const weight = style ?? 'regular';
  return weight === 'regular' ? `assets/regular/${name}.svg` : `assets/${weight}/${name}-${weight}.svg`;
}

function cacheRoot(): string {
  return path.join(getBridge().config.bridgeDir, 'icons');
}

async function fetchCached(set: IconSet, file: string): Promise<string> {
  const { pkg } = PACKAGES[set];
  const local = path.join(cacheRoot(), pkg.replace('/', '__'), file);
  if (fs.existsSync(local)) return fs.readFileSync(local, 'utf8');
  const url = file === '.files.json' ? `https://data.jsdelivr.com/v1/packages/npm/${pkg}?structure=flat` : `https://cdn.jsdelivr.net/npm/${pkg}/${file}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  } catch (err) {
    throw new Error(`Could not download ${url}: ${(err as Error).message}. Icons need the internet the first time; later they come from ${cacheRoot()}.`);
  }
  if (res.status === 404) throw Object.assign(new Error(`not found: ${url}`), { notFound: true });
  if (!res.ok) throw new Error(`Downloading ${url} failed with HTTP ${res.status}.`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, text);
  return text;
}

/* -------------------------------------------------------------- SVG parsing */

export interface IconPart {
  /** One path string per SVG element: each is parsed on its own, so a leading relative moveto stays relative to its own element. */
  d: string[];
  kind: 'fill' | 'stroke';
  opacity: number;
}

export interface ParsedIcon {
  viewBox: [number, number, number, number];
  strokeWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  parts: IconPart[];
}

function attrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1]] = m[3] ?? m[4] ?? '';
  return out;
}

const n = (v: string | undefined, d = 0) => (v === undefined || v === '' ? d : Number(v));

function points(list: string): number[][] {
  const nums = (list.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  const out: number[][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** Path data for one SVG element, or null for elements that draw nothing. */
export function elementToPath(tag: string, a: Record<string, string>): string | null {
  switch (tag) {
    case 'path':
      return a.d || null;
    case 'circle':
    case 'ellipse': {
      const cx = n(a.cx), cy = n(a.cy);
      const rx = tag === 'circle' ? n(a.r) : n(a.rx), ry = tag === 'circle' ? n(a.r) : n(a.ry);
      if (!(rx > 0 && ry > 0)) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'rect': {
      const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
      if (!(w > 0 && h > 0)) return null;
      let rx = a.rx !== undefined ? n(a.rx) : a.ry !== undefined ? n(a.ry) : 0;
      let ry = a.ry !== undefined ? n(a.ry) : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'line':
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const pts = points(a.points ?? '');
      if (pts.length < 2) return null;
      return `M${pts.map((p) => `${p[0]} ${p[1]}`).join('L')}${tag === 'polygon' ? 'Z' : ''}`;
    }
    default:
      return null;
  }
}

/** Reads an icon SVG: its viewBox, stroke settings and the drawn elements grouped by fill or stroke and opacity. */
export function parseIconSvg(svg: string): ParsedIcon {
  const root = svg.match(/<svg\b([^>]*)>/i);
  if (!root) throw new Error('Not an SVG file.');
  const ra = attrs(root[1]);
  const vb = (ra.viewBox ?? `0 0 ${n(ra.width, 24)} ${n(ra.height, 24)}`).trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !isFinite(v))) throw new Error(`Unreadable viewBox "${ra.viewBox}".`);
  const rootStroke = ra.stroke && ra.stroke !== 'none';
  const rootFill = ra.fill !== 'none';
  const parts: IconPart[] = [];
  const re = /<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const a = attrs(m[2]);
    if (a.transform) throw new Error('Icons with transform attributes are not supported.');
    const d = elementToPath(m[1].toLowerCase(), a);
    if (!d) continue;
    const stroke = a.stroke ? a.stroke !== 'none' : rootStroke;
    const fill = a.fill ? a.fill !== 'none' : rootFill && !rootStroke;
    const opacity = Math.round(n(a.opacity, 1) * n(a['fill-opacity'], 1) * 100);
    const kind: 'fill' | 'stroke' = stroke && !fill ? 'stroke' : 'fill';
    const same = parts.find((p) => p.kind === kind && p.opacity === opacity);
    if (same) same.d.push(d);
    else parts.push({ d: [d], kind, opacity });
  }
  if (!parts.length) throw new Error('The SVG draws nothing.');
  return {
    viewBox: vb as [number, number, number, number],
    strokeWidth: n(ra['stroke-width'], 2),
    lineCap: (ra['stroke-linecap'] as ParsedIcon['lineCap']) || 'butt',
    lineJoin: (ra['stroke-linejoin'] as ParsedIcon['lineJoin']) || 'miter',
    parts: parts.sort((a, b) => a.opacity - b.opacity),
  };
}

/* ------------------------------------------------------------------ names */

async function iconNames(set: IconSet): Promise<{ names: string[]; tags: Record<string, string[]> }> {
  if (set === 'lucide') {
    const tags = JSON.parse(await fetchCached('lucide', 'tags.json')) as Record<string, string[]>;
    return { names: Object.keys(tags).sort(), tags };
  }
  const listing = JSON.parse(await fetchCached(set, '.files.json')) as { files: Array<{ name: string }> };
  const re = set === 'material' ? /^\/outlined\/([a-z0-9_]+)\.svg$/ : /^\/assets\/regular\/([a-z0-9-]+)\.svg$/;
  const names = listing.files.map((f) => f.name.match(re)?.[1]).filter((x): x is string => !!x && !x.endsWith('-fill'));
  return { names: [...new Set(names)].sort(), tags: {} };
}

/** Icon names whose name or tags contain every query word, best matches (name hits, shorter names) first. */
export function rankIcons(names: string[], tags: Record<string, string[]>, query: string): string[] {
  const words = query.toLowerCase().split(/[\s_-]+/).filter(Boolean);
  const scored: Array<{ name: string; score: number }> = [];
  for (const name of names) {
    const hay = name.replace(/[-_]/g, ' ');
    const tagText = (tags[name] ?? []).join(' ').toLowerCase();
    let score = 0;
    let ok = true;
    for (const w of words) {
      if (hay === w) score += 10;
      else if (hay.split(' ').includes(w)) score += 6;
      else if (hay.includes(w)) score += 3;
      else if (tagText.includes(w)) score += 1;
      else ok = false;
    }
    if (ok) scored.push({ name, score: score - name.length / 100 });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.name);
}

/* ------------------------------------------------------------------- tools */

export function registerIconTools(server: McpServer): void {
  const SetArg = z.enum(['lucide', 'material', 'phosphor']).optional().describe('Icon set: "lucide" (default, outline icons), "material" (Material Symbols) or "phosphor".');

  defineTool(server, {
    name: 'search-icons',
    group: 'shapes',
    mutating: false,
    bridge: null,
    description:
      'Finds icon names in Lucide, Material Symbols or Phosphor by words, for add-icon. ' +
      'Use when: you need an icon and do not know its exact name in a set. Do not use for: placing it (add-icon). ' +
      'Inputs: query, words such as "check circle" or "arrow right"; set (default lucide); limit (default 40). ' +
      'Returns: the set, the matching names best first (Lucide also matches its tags), and how many the set has. ' +
      'Notes: the name list is downloaded once and kept in the bridge folder. Lucide names use dashes (circle-check), Material underscores (check_circle), Phosphor dashes (check-circle). ' +
      'Example: query "send", set "lucide".',
    input: {
      query: z.string().min(1).describe('Words to look for.'),
      set: SetArg,
      limit: z.number().int().min(1).max(500).optional().describe('Most names to return. Default 40.'),
    },
    handler: async (args) => {
      const set = (args.set ?? 'lucide') as IconSet;
      const { names, tags } = await iconNames(set);
      const hits = rankIcons(names, tags, args.query);
      return { set, query: args.query, total: names.length, matched: hits.length, names: hits.slice(0, args.limit ?? 40), license: PACKAGES[set].license };
    },
  });

  defineTool(server, {
    name: 'add-icon',
    group: 'shapes',
    bridge: null,
    description:
      'Draws an icon from Lucide, Material Symbols or Phosphor as a real vector shape layer (or as a group on an existing shape layer), at a size and colour, keeping the set\'s stroke widths and round caps. ' +
      'Use when: a UI scene, button, list or card needs an icon. Do not use for: a logo or your own SVG (import-vector-as-shapes, shape-from-svg-path). ' +
      'Inputs: name (search-icons finds it); set (default lucide); style, Material "outlined", "rounded" or "sharp", Phosphor "regular", "thin", "light", "bold", "fill" or "duotone"; filled (Material); size in pixels (default 96); color (default white); strokeWidth in icon units for Lucide (default 2, as the set draws it); comp; position; layer to add the icon to as a group; name for the new layer. ' +
      'Returns: the layer, each group drawn with its path count, the icon file and its licence. ' +
      'Notes: the SVG is downloaded once from the jsDelivr CDN (pinned package versions) and kept in the bridge folder. Lucide is ISC, Material Symbols Apache 2.0, Phosphor MIT. Undoable per group. ' +
      'Example: name "send-horizontal", size 64, color "#FFFFFF", position [960, 540].',
    input: {
      name: z.string().min(1).max(80).describe('Icon name in the set, for example "circle-check" (Lucide), "check_circle" (Material), "check-circle" (Phosphor).'),
      set: SetArg,
      style: z.string().optional().describe('Material: outlined, rounded or sharp. Phosphor: regular, thin, light, bold, fill or duotone.'),
      filled: z.boolean().optional().describe('Material Symbols filled variant. Default false.'),
      size: z.number().positive().max(4000).optional().describe('Icon size in pixels (the viewBox fits this square). Default 96.'),
      color: Color.optional().describe('Icon colour. Default white.'),
      strokeWidth: z.number().positive().max(10).optional().describe('Lucide stroke width in icon units (24-unit grid). Default 2.'),
      comp: CompRef.optional(),
      position: z.tuple([z.number(), z.number()]).optional().describe('Position of a new layer in comp pixels. Default: comp centre.'),
      layer: LayerRef.optional().describe('Existing shape layer to add the icon to as a group.'),
      layerName: z.string().min(1).optional().describe('Name of a new layer. Default "Icon <name>".'),
    },
    handler: async (args, ctx) => {
      const set = (args.set ?? 'lucide') as IconSet;
      const name = args.name.trim().toLowerCase();
      if (set === 'material' && args.style && !(MATERIAL_STYLES as readonly string[]).includes(args.style)) throw new Error(`Material style must be one of ${MATERIAL_STYLES.join(', ')}.`);
      if (set === 'phosphor' && args.style && !(PHOSPHOR_WEIGHTS as readonly string[]).includes(args.style)) throw new Error(`Phosphor weight must be one of ${PHOSPHOR_WEIGHTS.join(', ')}.`);
      if (set === 'lucide' && args.style) throw new Error('Lucide has one style; leave style out (strokeWidth changes the weight).');
      const file = iconFile(set, name, args.style, args.filled);
      let svg: string;
      try {
        svg = await fetchCached(set, file);
      } catch (err) {
        if ((err as { notFound?: boolean }).notFound) {
          const { names, tags } = await iconNames(set);
          const close = rankIcons(names, tags, name).slice(0, 8);
          return jsonResult({ tool: 'add-icon', error: 'not-found', message: `No ${set} icon "${name}"${args.style ? ` in ${args.style}` : ''}.${close.length ? ` Close names: ${close.join(', ')}.` : ' Try search-icons.'}` }, true);
        }
        throw err;
      }
      const icon = parseIconSvg(svg);
      const size = args.size ?? 96;
      const color = args.color ?? '#FFFFFF';
      let layerRef: Record<string, unknown> | undefined = args.layer as Record<string, unknown> | undefined;
      const groups: unknown[] = [];
      let layerInfo: unknown = null;
      for (const part of icon.parts) {
        const subpaths = part.d.flatMap((d) => parseSvgPath(d));
        const placement = placementFor({ viewBox: icon.viewBox, size: [size, size], center: true }, pathBounds(subpaths));
        const aePaths = toAeShapes(subpaths, placement);
        const parsed = { paths: aePaths, bounds: aeShapesBounds(aePaths), sourceBounds: pathBounds(subpaths), placement, vertexCount: aePaths.reduce((k, p) => k + p.vertices.length, 0) };
        const stroke = part.kind === 'stroke';
        const widthUnits = set === 'lucide' ? args.strokeWidth ?? icon.strokeWidth : icon.strokeWidth;
        const bridgeArgs: Record<string, unknown> = {
          comp: args.comp,
          paths: parsed.paths,
          bounds: parsed.bounds,
          sourceBounds: parsed.sourceBounds,
          placement: parsed.placement,
          vertexCount: parsed.vertexCount,
          groupName: icon.parts.length > 1 ? `${name}${part.opacity < 100 ? ' (tint)' : ''}` : name,
          ...(layerRef ? { layer: layerRef } : { name: args.layerName ?? `Icon ${name}`, position: args.position }),
          ...(stroke
            ? { noFill: true, strokeColor: color, strokeWidth: Math.round(widthUnits * parsed.placement.scale[0] * 1000) / 1000, lineCap: icon.lineCap, lineJoin: icon.lineJoin }
            : { fillColor: color }),
          ...(part.opacity < 100 ? { groupOpacity: part.opacity } : {}),
        };
        const r = (await ctx.run('shapeFromSvgPath', bridgeArgs)) as Record<string, unknown>;
        groups.push({ group: r.group, pathCount: r.pathCount, kind: part.kind, opacity: part.opacity });
        layerInfo = r.layer;
        const id = (r.layer as { id?: number } | undefined)?.id;
        if (!layerRef && typeof id === 'number') layerRef = { id };
      }
      return { layer: layerInfo, icon: { set, name, style: args.style ?? null, filled: !!args.filled, file, size }, groups, license: PACKAGES[set].license };
    },
  });
}
