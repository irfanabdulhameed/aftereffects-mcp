/*
 * Gradient colour stops through an animation preset, on the Node side.
 *
 * After Effects scripting cannot write the colour stops of a shape layer's
 * Gradient Fill or Gradient Stroke: the "ADBE Vector Grad Colors" property is
 * a custom value, and touching it from a script raises a modal error that a
 * try/catch does not catch. An animation preset (.ffx) can carry the stops,
 * so set-shape-gradient copies a template preset saved once from After
 * Effects (a shape group with a Gradient Fill, or one with a Gradient
 * Stroke), replaces the gradient XML inside it with the requested stops, and
 * the bridge applies the copy.
 *
 * An .ffx is a RIFX file: big-endian, each chunk a 4-byte id, a 4-byte size
 * and a body padded to an even length; LIST and RIFX chunks start their body
 * with a 4-byte type followed by child chunks. The stops live in Utf8 chunks
 * as the same XML a project file uses ("Gradient Color Data").
 */

import * as fs from 'fs';
import * as path from 'path';

export const GRADIENT_TEMPLATE_FILES = { fill: 'gradient-fill.ffx', stroke: 'gradient-stroke.ffx' } as const;
export type GradientKind = keyof typeof GRADIENT_TEMPLATE_FILES;

export interface GradientStop {
  /** Position along the gradient, 0 to 1. */
  offset: number;
  /** [r, g, b, a] in 0 to 1. */
  rgba: number[];
  /** Stop opacity in percent. Default: the colour's alpha times 100. */
  opacity?: number;
}

/* ------------------------------------------------------------------- RIFX */

export interface RiffChunk {
  id: string;
  /** Set for LIST and RIFX chunks. */
  listType?: string;
  children?: RiffChunk[];
  data?: Buffer;
}

function parseChunks(buf: Buffer, start: number, end: number): RiffChunk[] {
  const out: RiffChunk[] = [];
  let i = start;
  while (i + 8 <= end) {
    const id = buf.toString('latin1', i, i + 4);
    const size = buf.readUInt32BE(i + 4);
    const body = i + 8;
    if (body + size > end) throw new Error(`Chunk "${id}" at byte ${i} runs past the end of its parent (${size} bytes).`);
    if (id === 'LIST' || id === 'RIFX') {
      out.push({ id, listType: buf.toString('latin1', body, body + 4), children: parseChunks(buf, body + 4, body + size) });
    } else {
      out.push({ id, data: Buffer.from(buf.subarray(body, body + size)) });
    }
    i = body + size + (size & 1);
  }
  return out;
}

export function parseRifx(buf: Buffer): RiffChunk {
  const root = parseChunks(buf, 0, buf.length);
  if (!root.length || root[0].id !== 'RIFX') throw new Error('Not a RIFX file (an After Effects .ffx starts with "RIFX").');
  return root[0];
}

export function writeRifx(chunk: RiffChunk): Buffer {
  const body = chunk.children
    ? Buffer.concat([Buffer.from(chunk.listType ?? '    ', 'latin1'), ...chunk.children.map(writeRifx)])
    : chunk.data ?? Buffer.alloc(0);
  const head = Buffer.alloc(8);
  head.write(chunk.id, 0, 4, 'latin1');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

export function walkChunks(chunk: RiffChunk, visit: (c: RiffChunk) => void): void {
  visit(chunk);
  for (const c of chunk.children ?? []) walkChunks(c, visit);
}

/** The Utf8 chunks that hold gradient colour XML. */
export function gradientChunks(root: RiffChunk): RiffChunk[] {
  const out: RiffChunk[] = [];
  walkChunks(root, (c) => {
    if (c.id === 'Utf8' && c.data && c.data.includes('Gradient Color Data')) out.push(c);
  });
  return out;
}

/* -------------------------------------------------------------------- XML */

/** Formats a number the way After Effects stores gradient values (32-bit float, up to 8 significant digits). */
function f32(v: number): string {
  const f = Math.fround(v);
  const s = Number(f.toPrecision(8)).toString();
  return s === '-0' ? '0' : s;
}

function stopsBlock(kind: 'Alpha' | 'Color', rows: number[][]): string[] {
  const out = ['<prop.pair>', `<key>${kind} Stops</key>`, '<prop.list>', '<prop.pair>', '<key>Stops List</key>', '<prop.list>'];
  // After Effects keys the stops by string, so Stop-10 sorts before Stop-2.
  const order = rows.map((_, i) => i).sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  for (const i of order) {
    out.push('<prop.pair>', `<key>Stop-${i}</key>`, '<prop.list>', '<prop.pair>', `<key>Stops ${kind}</key>`, '<array>', '<array.type><float/></array.type>');
    for (const v of rows[i]) out.push(`<float>${f32(v)}</float>`);
    out.push('</array>', '</prop.pair>', '</prop.list>', '</prop.pair>');
  }
  out.push('</prop.list>', '</prop.pair>', '<prop.pair>', '<key>Stops Size</key>', `<int type='unsigned' size='32'>${rows.length}</int>`, '</prop.pair>', '</prop.list>', '</prop.pair>');
  return out;
}

/**
 * Gradient XML with one colour stop and one opacity stop per input stop and
 * every midpoint at 0.5 (a straight blend between neighbours).
 */
export function gradientXml(stopsIn: GradientStop[], version = '1.0'): string {
  let stops = [...stopsIn].sort((a, b) => a.offset - b.offset);
  if (stops.length === 1) stops = [{ ...stops[0], offset: 0 }, { ...stops[0], offset: 1 }];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const alpha = stops.map((s) => [clamp(s.offset), 0.5, clamp(s.opacity !== undefined ? s.opacity / 100 : (s.rgba[3] ?? 1))]);
  const color = stops.map((s) => [clamp(s.offset), 0.5, s.rgba[0], s.rgba[1], s.rgba[2], 1]);
  const lines = ["<?xml version='1.0'?>", "<prop.map version='4'>", '<prop.list>', '<prop.pair>', '<key>Gradient Color Data</key>', '<prop.list>'];
  lines.push(...stopsBlock('Alpha', alpha), ...stopsBlock('Color', color));
  lines.push('</prop.list>', '</prop.pair>', '<prop.pair>', '<key>Gradient Colors</key>', `<string>${version}</string>`, '</prop.pair>', '</prop.list>', '</prop.map>');
  return lines.join('\n') + '\n';
}

function versionOf(data: Buffer): string {
  const s = data.toString('utf8');
  const a = s.indexOf('<key>Gradient Colors</key>');
  if (a >= 0) {
    const b = s.indexOf('<string>', a);
    const e = s.indexOf('</string>', a);
    if (b >= 0 && e > b) return s.slice(b + 8, e);
  }
  return '1.0';
}

/** Returns a copy of the template preset with every gradient XML chunk replaced by the stops. */
export function rewriteGradientPreset(template: Buffer, stops: GradientStop[]): { buffer: Buffer; chunksReplaced: number } {
  const root = parseRifx(template);
  const chunks = gradientChunks(root);
  if (!chunks.length) throw new Error('The template preset holds no gradient colours. Save it from a shape group that contains a Gradient Fill or Gradient Stroke.');
  for (const c of chunks) {
    const data = c.data as Buffer;
    const nul = data.length > 0 && data[data.length - 1] === 0;
    const xml = Buffer.from(gradientXml(stops, versionOf(data)), 'utf8');
    c.data = nul ? Buffer.concat([xml, Buffer.from([0])]) : xml;
  }
  return { buffer: writeRifx(root), chunksReplaced: chunks.length };
}

/* --------------------------------------------------------------- templates */

export function templateFolder(explicit: string | undefined, bridgeDir: string): string {
  if (explicit && explicit.trim()) return path.resolve(explicit);
  const env = process.env.AE_MCP_GRADIENT_TEMPLATES;
  if (env && env.trim()) return path.resolve(env);
  return path.join(bridgeDir, 'templates');
}

export interface PreparedPreset {
  presetPath: string | null;
  templatePath: string;
  reason: string | null;
  chunksReplaced: number;
}

/**
 * Writes a gradient preset for the stops into <bridgeDir>/tmp. Never throws for
 * a missing or unreadable template: it returns the reason so the bridge can
 * still set type and points and report the stops as unsupported.
 */
export function prepareGradientPreset(kind: GradientKind, stops: GradientStop[], folder: string, bridgeDir: string): PreparedPreset {
  const templatePath = path.join(folder, GRADIENT_TEMPLATE_FILES[kind]);
  if (!fs.existsSync(templatePath)) {
    return {
      presetPath: null,
      templatePath,
      chunksReplaced: 0,
      reason:
        `No gradient template at ${templatePath}. Colour stops travel in an animation preset made from a template saved once by hand: ` +
        `in After Effects make a shape group with one path and a Gradient ${kind === 'fill' ? 'Fill' : 'Stroke'}, select the group, ` +
        `choose Animation > Save Animation Preset and save it as ${GRADIENT_TEMPLATE_FILES[kind]} in that folder (or set AE_MCP_GRADIENT_TEMPLATES).`,
    };
  }
  try {
    const { buffer, chunksReplaced } = rewriteGradientPreset(fs.readFileSync(templatePath), stops);
    const outDir = path.join(bridgeDir, 'tmp');
    fs.mkdirSync(outDir, { recursive: true });
    const presetPath = path.join(outDir, `gradient-${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}.ffx`);
    fs.writeFileSync(presetPath, buffer);
    return { presetPath, templatePath, chunksReplaced, reason: null };
  } catch (err) {
    return { presetPath: null, templatePath, chunksReplaced: 0, reason: `The gradient template ${templatePath} could not be used: ${(err as Error).message}` };
  }
}
