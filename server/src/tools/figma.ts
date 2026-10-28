/*
 * Figma to After Effects: a Figma frame rebuilt as real layers. The node tree
 * comes from the Figma REST API (a link plus a personal access token in
 * FIGMA_TOKEN) or from a saved JSON in the same format (a plugin can write it
 * with exportAsync JSON_REST_V1). It is flattened here into a list of layer
 * specs in paint order, coordinates relative to the frame, and built in one
 * bridge call: shapes for rectangles and ellipses, Figma's own path geometry
 * for vectors, box text for text, footage for image fills. Shadows become
 * layer styles, layer blur a Gaussian Blur, background blur frosted glass.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { expandHome } from './components.js';
import { defineTool, invokeTool } from './registry.js';
import { parseSvgPath, toAeShapes, type AeShapePath } from './svg-path.js';

type Rgba = [number, number, number, number];
type FNode = Record<string, any>;

export interface LayerSpec {
  kind: 'rect' | 'ellipse' | 'path' | 'text' | 'image';
  id: string;
  name: string;
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  fill: Rgba | null;
  stroke: { color: Rgba; width: number; align: 'center' | 'inside' | 'outside' } | null;
  radius?: number;
  paths?: AeShapePath[];
  strokePaths?: AeShapePath[];
  fillRule?: 'non-zero' | 'even-odd';
  text?: { characters: string; font: string | null; family: string | null; style: string | null; size: number; tracking: number; leading: number | null; align: 'left' | 'center' | 'right'; box: boolean; color: Rgba };
  image?: { ref: string; file?: string };
  blur?: number;
  shadows?: Array<{ color: Rgba; dx: number; dy: number; radius: number; spread: number }>;
  backgroundBlur?: number;
  /** Linear or radial gradient fill: stops 0..1, handles in the node's own unit box (0..1). */
  gradient?: { type: 'linear' | 'radial'; stops: Array<{ position: number; color: Rgba }>; handles: Array<[number, number]>; fade: boolean };
}

export interface FigmaPlan {
  frame: { id: string; name: string; width: number; height: number; background: Rgba | null };
  layers: LayerSpec[];
  notes: string[];
  imageRefs: string[];
}

/** File key and node id from a Figma link (design, file or proto links; node-id 12-34 or 12:34). */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string | null } {
  const m = url.match(/figma\.com\/(?:design|file|proto|board)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error(`Not a Figma file link: ${url}`);
  const node = url.match(/[?&]node-id=([^&#]+)/);
  return { fileKey: m[1], nodeId: node ? decodeURIComponent(node[1]).replace(/-/g, ':') : null };
}

function rgba(c: { r: number; g: number; b: number; a?: number }, opacity = 1): Rgba {
  return [c.r, c.g, c.b, (c.a ?? 1) * opacity];
}

type Gradient = NonNullable<LayerSpec['gradient']>;

/** The first visible linear or radial gradient fill, rebuilt by the builder with Gradient Ramp. */
export function gradientOf(fills: any[] | undefined, notes: string[], name: string): Gradient | null {
  for (const f of fills ?? []) {
    if (f.visible === false) continue;
    if (f.type === 'SOLID') return null;
    if ((f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') && f.gradientStops?.length >= 2 && f.gradientHandlePositions?.length >= 2) {
      const op = f.opacity ?? 1;
      const stops = (f.gradientStops as any[]).map((st) => ({ position: Number(st.position), color: rgba(st.color, op) }));
      if (stops.length > 2) notes.push(`${name}: a ${stops.length}-stop gradient; the first and last stops were used.`);
      const a = stops[0].color;
      const b = stops[stops.length - 1].color;
      const fade = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 0.004 && Math.abs(a[3] - b[3]) > 0.001;
      if (!fade && Math.abs(a[3] - b[3]) > 0.001) notes.push(`${name}: a gradient that changes both colour and transparency; its colour was kept, its transparency taken from the first stop.`);
      return { type: f.type === 'GRADIENT_RADIAL' ? 'radial' : 'linear', stops: [stops[0], stops[stops.length - 1]], handles: (f.gradientHandlePositions as any[]).map((h) => [Number(h.x), Number(h.y)] as [number, number]), fade };
    }
    return null;
  }
  return null;
}

/** The first visible solid fill (gradients give their first stop; linear and radial ones are rebuilt from gradientOf). */
function firstFill(fills: any[] | undefined, notes: string[], name: string): Rgba | null {
  for (const f of fills ?? []) {
    if (f.visible === false) continue;
    const op = f.opacity ?? 1;
    if (f.type === 'SOLID') return rgba(f.color, op);
    if ((f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') && !/stroke$/.test(name) && f.gradientStops?.length) return rgba(f.gradientStops[0].color, op);
    if (/^GRADIENT_/.test(f.type) && f.gradientStops?.length) {
      notes.push(`${name}: ${f.type.toLowerCase().replace('_', ' ')} fill drawn in its first colour; add the gradient with set-shape-gradient.`);
      return rgba(f.gradientStops[0].color, op);
    }
  }
  return null;
}

function hasImageFill(fills: any[] | undefined): string | null {
  for (const f of fills ?? []) if (f.visible !== false && f.type === 'IMAGE' && f.imageRef) return f.imageRef;
  return null;
}

function bounds(n: FNode): { x: number; y: number; w: number; h: number; rotation: number } {
  const b = n.absoluteBoundingBox ?? { x: 0, y: 0, width: n.size?.x ?? 0, height: n.size?.y ?? 0 };
  const t = n.relativeTransform as number[][] | undefined;
  const rot = t ? (Math.atan2(t[1][0], t[0][0]) * 180) / Math.PI : typeof n.rotation === 'number' ? -n.rotation : 0;
  if (Math.abs(rot) > 0.01 && n.size) {
    // absoluteBoundingBox is the rotated box: keep its centre, take the true size.
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    return { x: cx - n.size.x / 2, y: cy - n.size.y / 2, w: n.size.x, h: n.size.y, rotation: rot };
  }
  return { x: b.x, y: b.y, w: b.width, h: b.height, rotation: 0 };
}

function geometry(list: any[] | undefined, w: number, h: number, scale: number): { paths: AeShapePath[]; evenOdd: boolean } | null {
  if (!list?.length) return null;
  const subs = list.flatMap((g: any) => parseSvgPath(String(g.path)));
  if (!subs.length) return null;
  // Figma geometry is in the node's own space (0,0 = its top-left); centre it on the layer.
  const paths = toAeShapes(subs, { scale: [scale, scale], origin: [w / 2, h / 2], offset: [0, 0] });
  return { paths, evenOdd: list.some((g: any) => g.windingRule === 'EVENODD') };
}

const CONTAINERS = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION', 'BOOLEAN_OPERATION_GROUP']);

/** Flattens a Figma node tree into layer specs, bottom to top, relative to the frame and scaled. */
export function planFigma(root: FNode, scale = 1): FigmaPlan {
  const notes: string[] = [];
  const layers: LayerSpec[] = [];
  const imageRefs = new Set<string>();
  const fb = root.absoluteBoundingBox ?? { x: 0, y: 0, width: root.size?.x ?? 1920, height: root.size?.y ?? 1080 };
  const ox = fb.x;
  const oy = fb.y;
  const S = (v: number) => Math.round(v * scale * 1000) / 1000;
  const base = (n: FNode, kind: LayerSpec['kind'], trail: string, inherited: number): LayerSpec => {
    const b = bounds(n);
    const op = Math.round((n.opacity ?? 1) * inherited * 1000) / 10;
    const spec: LayerSpec = { kind, id: String(n.id), name: String(n.name ?? kind), path: trail, x: S(b.x - ox), y: S(b.y - oy), w: S(b.w), h: S(b.h), rotation: Math.round(b.rotation * 100) / 100, opacity: op, fill: null, stroke: null };
    const fx = (n.effects ?? []).filter((e: any) => e.visible !== false);
    const shadows = fx.filter((e: any) => e.type === 'DROP_SHADOW').map((e: any) => ({ color: rgba(e.color), dx: S(e.offset?.x ?? 0), dy: S(e.offset?.y ?? 0), radius: S(e.radius ?? 0), spread: S(e.spread ?? 0) }));
    if (shadows.length) spec.shadows = shadows;
    const lb = fx.find((e: any) => e.type === 'LAYER_BLUR');
    if (lb) spec.blur = S(lb.radius ?? 0);
    const bb = fx.find((e: any) => e.type === 'BACKGROUND_BLUR');
    if (bb) spec.backgroundBlur = S(bb.radius ?? 0);
    if (fx.some((e: any) => e.type === 'INNER_SHADOW')) notes.push(`${spec.name}: inner shadow skipped; add-layer-style inner-shadow adds it.`);
    return spec;
  };
  const strokeOf = (n: FNode, name: string) => {
    const c = firstFill(n.strokes, notes, `${name} stroke`);
    if (!c || !(n.strokeWeight > 0)) return null;
    const align = String(n.strokeAlign ?? 'CENTER').toLowerCase() as 'center' | 'inside' | 'outside';
    return { color: c, width: S(n.strokeWeight), align };
  };
  const visit = (n: FNode, trail: string, inherited: number, isRoot: boolean) => {
    if (n.visible === false) return;
    const name = String(n.name ?? n.type);
    const here = trail ? `${trail} / ${name}` : name;
    if (n.isMask) {
      notes.push(`${here}: a mask node; it was skipped and what it clips is shown whole.`);
      return;
    }
    const type = String(n.type);
    if (CONTAINERS.has(type)) {
      const fill = isRoot ? null : firstFill(n.fills, notes, here);
      const img = isRoot ? null : hasImageFill(n.fills);
      const stroke = isRoot ? null : strokeOf(n, here);
      if (fill || stroke || img) {
        const spec = base(n, img ? 'image' : 'rect', here, inherited);
        spec.fill = fill;
        const grad = gradientOf(n.fills, notes, here);
        if (grad) spec.gradient = grad;
        spec.stroke = stroke;
        spec.radius = S(n.cornerRadius ?? 0);
        if (img) {
          spec.image = { ref: img };
          imageRefs.add(String(n.id));
        }
        layers.push(spec);
      }
      if (n.clipsContent && !isRoot && (n.children ?? []).length) notes.push(`${here}: clips its content in Figma; the children are not clipped (precompose and mask them if they overflow).`);
      const op = isRoot ? inherited : inherited * (n.opacity ?? 1);
      for (const child of n.children ?? []) visit(child, isRoot ? '' : here, op, false);
      return;
    }
    if (type === 'TEXT') {
      const spec = base(n, 'text', here, inherited);
      const st = n.style ?? {};
      const size = Number(st.fontSize ?? 16);
      const color = firstFill(n.fills, notes, here) ?? [0, 0, 0, 1];
      spec.text = {
        characters: String(n.characters ?? ''),
        font: st.fontPostScriptName ?? null,
        family: st.fontFamily ?? null,
        style: st.fontStyle ?? null,
        size: S(size),
        tracking: Math.round(((Number(st.letterSpacing ?? 0) / size) * 1000) * 10) / 10,
        leading: st.lineHeightPx ? S(Number(st.lineHeightPx)) : null,
        align: st.textAlignHorizontal === 'CENTER' ? 'center' : st.textAlignHorizontal === 'RIGHT' ? 'right' : 'left',
        box: st.textAutoResize !== 'WIDTH_AND_HEIGHT',
        color,
      };
      if (n.characterStyleOverrides?.some((o: number) => o !== 0)) notes.push(`${here}: mixed text styles in one layer; only the main style was kept.`);
      layers.push(spec);
      return;
    }
    if (type === 'RECTANGLE' || type === 'ELLIPSE') {
      const img = hasImageFill(n.fills);
      const spec = base(n, img ? 'image' : type === 'ELLIPSE' ? 'ellipse' : 'rect', here, inherited);
      spec.fill = firstFill(n.fills, notes, here);
      const grad = gradientOf(n.fills, notes, here);
      if (grad) spec.gradient = grad;
      spec.stroke = strokeOf(n, here);
      const radii = n.rectangleCornerRadii as number[] | undefined;
      if (type === 'RECTANGLE' && radii && new Set(radii).size > 1) {
        const g = geometry(n.fillGeometry, n.size?.x ?? spec.w / scale, n.size?.y ?? spec.h / scale, scale);
        if (g) {
          spec.kind = img ? 'image' : 'path';
          spec.paths = g.paths;
        } else notes.push(`${here}: corners differ; drawn with the largest radius (export with geometry=paths for the exact shape).`);
      }
      spec.radius = S(radii ? Math.max(...radii) : n.cornerRadius ?? 0);
      if (img) {
        spec.image = { ref: img };
        imageRefs.add(String(n.id));
      }
      if (type === 'ELLIPSE' && n.arcData && (n.arcData.endingAngle - n.arcData.startingAngle < 6.28 || n.arcData.innerRadius > 0)) {
        const g = geometry(n.fillGeometry, n.size?.x ?? spec.w / scale, n.size?.y ?? spec.h / scale, scale);
        if (g) {
          spec.kind = 'path';
          spec.paths = g.paths;
        }
      }
      layers.push(spec);
      return;
    }
    // Vectors, stars, polygons, lines and boolean operations: Figma's own geometry.
    const w = n.size?.x ?? (n.absoluteBoundingBox?.width ?? 0);
    const h = n.size?.y ?? (n.absoluteBoundingBox?.height ?? 0);
    const fillGeo = geometry(n.fillGeometry, w, h, scale);
    const strokeGeo = geometry(n.strokeGeometry, w, h, scale);
    if (!fillGeo && !strokeGeo) {
      notes.push(`${here}: ${type.toLowerCase()} has no path geometry (fetch with geometry=paths); skipped.`);
      return;
    }
    const spec = base(n, 'path', here, inherited);
    if (fillGeo) {
      spec.paths = fillGeo.paths;
      spec.fillRule = fillGeo.evenOdd ? 'even-odd' : 'non-zero';
      spec.fill = firstFill(n.fills, notes, here);
      const grad = gradientOf(n.fills, notes, here);
      if (grad) spec.gradient = grad;
    }
    if (strokeGeo) {
      spec.strokePaths = strokeGeo.paths;
      const s = strokeOf(n, here);
      if (s) spec.stroke = s;
    }
    layers.push(spec);
  };
  visit(root, '', 1, true);
  return {
    frame: { id: String(root.id), name: String(root.name ?? 'Figma frame'), width: S(fb.width), height: S(fb.height), background: firstFill(root.fills, notes, String(root.name ?? 'frame')) },
    layers,
    notes: [...new Set(notes)],
    imageRefs: [...imageRefs],
  };
}

/** The node to build from a REST response, a {document} wrapper or a bare node. */
export function pickNode(json: any, nodeId: string | null): FNode {
  if (json?.nodes && typeof json.nodes === 'object') {
    const keys = Object.keys(json.nodes);
    const key = nodeId && json.nodes[nodeId] ? nodeId : keys[0];
    const doc = json.nodes[key]?.document;
    if (!doc) throw new Error(`Node ${nodeId ?? key} is not in the Figma response.`);
    return doc;
  }
  if (json?.document) {
    if (json.document.type === 'DOCUMENT') throw new Error('This is a whole Figma file. Pass a frame link with ?node-id=, or a JSON of one frame.');
    return json.document;
  }
  if (json?.type) return json;
  throw new Error('Not a Figma node JSON (expected the REST nodes response, {document: …} or a node).');
}

async function figmaGet(url: string, token: string): Promise<any> {
  const res = await fetch(url, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(60000) });
  if (res.status === 403) throw new Error('Figma refused the token (403). Make a personal access token with file read access in Figma > Settings > Security and set FIGMA_TOKEN.');
  if (res.status === 404) throw new Error('Figma could not find that file or node (404). Check the link and that the token\'s account can open the file.');
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export function registerFigmaTools(server: McpServer): void {
  defineTool(server, {
    name: 'import-figma',
    group: 'figma',
    timeout: 'render',
    bridge: null,
    description:
      'Rebuilds a Figma frame in After Effects as real, editable layers: a comp the frame\'s size, rectangles and ellipses as shape layers (fill, stroke with its alignment, corner radius), vectors and boolean shapes from Figma\'s own path geometry, text as box text (font, size, letter spacing, line height, alignment), image fills as footage, drop shadows as layer styles, layer blur as Gaussian Blur and background blur as frosted glass. Layers keep their Figma names in paint order. ' +
      'Use when: a design made in Figma should be animated in After Effects without screenshots. Do not use for: an .svg or .ai file (import-vector-as-shapes) or icons (add-icon). ' +
      'Inputs: url, a Figma link with ?node-id= of one frame, with token (default FIGMA_TOKEN); or json, a file with the Figma REST JSON of a frame (a plugin can write it with exportAsync JSON_REST_V1); scale (default 1, for example 1.333 to take a 1440 frame to 1920); comp to build into (default a new comp named after the frame); frameRate (default 30); duration (default 10); imagesDir for downloaded images (default <bridge>/figma). ' +
      'Returns: the comp, counts per layer kind, layers that failed, fonts that are missing on this Mac and notes on anything approximated. ' +
      'Notes: the comp is flat (one layer per Figma node, named by its path); group them into components afterwards. Linear and radial gradients are rebuilt with Gradient Ramp (first and last stop); angular and diamond gradients take their first colour, mixed text styles their main style, and clipping is not rebuilt. Undoable in steps. ' +
      'Example: url "https://www.figma.com/design/AbC123/Site?node-id=12-34", scale 1.333.',
    input: {
      url: z.string().optional().describe('Figma link to one frame, with ?node-id=.'),
      token: z.string().optional().describe('Figma personal access token. Default FIGMA_TOKEN.'),
      json: z.string().optional().describe('Path to a saved Figma REST JSON of a frame.'),
      nodeId: z.string().optional().describe('Node id when the JSON or link holds several nodes.'),
      scale: z.number().positive().max(10).optional().describe('Scale for every size and position. Default 1.'),
      comp: z.object({ id: z.number().int().optional(), name: z.string().optional() }).optional().describe('Existing comp to build into. Default a new comp.'),
      frameRate: z.number().positive().max(120).optional().describe('New comp frame rate. Default 30.'),
      duration: z.number().positive().optional().describe('New comp duration in seconds. Default 10.'),
      imagesDir: z.string().optional().describe('Folder for image fills downloaded from Figma.'),
    },
    handler: async (args, ctx) => {
      let json: any;
      let nodeId = args.nodeId ? args.nodeId.replace(/-/g, ':') : null;
      let fileKey: string | null = null;
      const token = args.token ?? process.env.FIGMA_TOKEN;
      if (args.json) {
        json = JSON.parse(fs.readFileSync(path.resolve(expandHome(args.json)), 'utf8'));
      } else if (args.url) {
        const p = parseFigmaUrl(args.url);
        fileKey = p.fileKey;
        nodeId = nodeId ?? p.nodeId;
        if (!nodeId) throw new Error('The link has no node-id. In Figma, right-click the frame > Copy link to selection.');
        if (!token) throw new Error('Figma needs a personal access token: Figma > Settings > Security > Personal access tokens (file content read). Set FIGMA_TOKEN in the MCP settings or pass token. Without one, export the frame as JSON and pass json.');
        json = await figmaGet(`https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&geometry=paths`, token);
      } else throw new Error('Pass url (a Figma frame link) or json (a saved Figma node JSON).');
      const root = pickNode(json, nodeId);
      const plan = planFigma(root, args.scale ?? 1);
      if (plan.imageRefs.length) {
        if (fileKey && token) {
          const dir = path.resolve(expandHome(args.imagesDir ?? path.join(ctx.bridge.paths.root, 'figma', fileKey)));
          fs.mkdirSync(dir, { recursive: true });
          const urls = await figmaGet(`https://api.figma.com/v1/images/${fileKey}?ids=${plan.imageRefs.map(encodeURIComponent).join(',')}&format=png&scale=2`, token);
          for (const spec of plan.layers) {
            const u = spec.image && urls.images?.[spec.id];
            if (!u) continue;
            const file = path.join(dir, `${spec.id.replace(/[^A-Za-z0-9_-]/g, '-')}.png`);
            const res = await fetch(u, { signal: AbortSignal.timeout(60000) });
            if (res.ok) {
              fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
              spec.image!.file = file;
            }
          }
        } else plan.notes.push(`${plan.imageRefs.length} image fill(s) need a Figma link and token to download; they were drawn as grey placeholders.`);
      }
      const built = (await ctx.run(
        'buildFigma',
        { comp: args.comp, frame: plan.frame, layers: plan.layers, frameRate: args.frameRate ?? 30, duration: args.duration ?? 10 },
        'render'
      )) as Record<string, any>;
      const notes = [...plan.notes, ...(built.notes ?? [])];
      const compRef = built.composition;
      let shadowsAdded = 0;
      for (const item of built.made ?? []) {
        const spec = plan.layers.find((l) => l.id === item.figmaId);
        if (!spec || !item.layer) continue;
        if (spec.shadows?.length) {
          const s = spec.shadows[0];
          const distance = Math.round(Math.hypot(s.dx, s.dy) * 10) / 10;
          const angle = distance ? Math.round(((Math.atan2(s.dy, -s.dx) * 180) / Math.PI) * 10) / 10 : 90;
          const r = await invokeTool('add-layer-style', { comp: { id: compRef.id }, layer: { id: item.layer.id }, kind: 'drop-shadow', settings: { color: [s.color[0], s.color[1], s.color[2]], opacity: Math.round(s.color[3] * 1000) / 10, distance, angle, size: Math.round(s.radius), useGlobalLight: false } });
          if (r.isError) notes.push(`${spec.path}: drop shadow not added: ${String((r.content[0] as any)?.text ?? '').slice(0, 160)}`);
          else shadowsAdded++;
          if (spec.shadows.length > 1) notes.push(`${spec.path}: ${spec.shadows.length} shadows in Figma; the first one was added.`);
        }
        if (spec.backgroundBlur) {
          const r = await invokeTool('apply-look', { comp: { id: compRef.id }, look: 'frosted-glass', layer: { id: item.layer.id }, intensity: Math.max(0.1, spec.backgroundBlur / 30) });
          if (r.isError) notes.push(`${spec.path}: background blur not added.`);
        }
      }
      return { ...built, frame: plan.frame, shadowsAdded, notes };
    },
  });
}
