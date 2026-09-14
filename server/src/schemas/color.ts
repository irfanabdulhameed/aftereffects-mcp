/*
 * Colour normalisation. Every tool input accepts any of:
 *   "#RGB", "#RRGGBB", "#RRGGBBAA" (hash optional)
 *   [r, g, b] or [r, g, b, a] with every component in 0..1, or any component > 1 meaning 0..255
 *   { r, g, b, a? } with the same range rule
 *   a CSS colour name from a small built-in list
 * The bridge always receives [r, g, b, a] in 0..1.
 */

import { z } from 'zod';

export type Rgba = [number, number, number, number];

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#00ff00', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', orange: '#ffa500', purple: '#800080',
  pink: '#ffc0cb', gray: '#808080', grey: '#808080', transparent: '#00000000',
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function parseHexColor(input: string): Rgba | undefined {
  let s = input.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  if (s.startsWith('#')) s = s.slice(1);
  if (!/^[0-9a-f]+$/.test(s)) return undefined;
  if (s.length === 3 || s.length === 4) {
    s = s.split('').map((c) => c + c).join('');
  }
  if (s.length !== 6 && s.length !== 8) return undefined;
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

function fromComponents(parts: number[]): Rgba {
  const scale = parts.some((v) => v > 1) ? 255 : 1;
  const [r, g, b] = parts;
  const a = parts.length > 3 ? parts[3] : scale;
  return [clamp01(r / scale), clamp01(g / scale), clamp01(b / scale), clamp01(a / scale)];
}

export function toRgba(input: unknown): Rgba {
  if (typeof input === 'string') {
    const parsed = parseHexColor(input);
    if (!parsed) throw new Error(`Unrecognised colour "${input}". Use #RRGGBB, #RRGGBBAA, [r,g,b], [r,g,b,a] or {r,g,b}.`);
    return parsed;
  }
  if (Array.isArray(input)) {
    if (input.length < 3 || input.length > 4 || !input.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error('Colour arrays need 3 or 4 finite numbers.');
    }
    return fromComponents(input as number[]);
  }
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const parts = [o.r, o.g, o.b];
    if (o.a !== undefined) parts.push(o.a);
    if (!parts.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error('Colour objects need numeric r, g, b and optional a.');
    }
    return fromComponents(parts as number[]);
  }
  throw new Error('Colour must be a hex string, an array, or an object.');
}

export function toHex(rgba: readonly number[]): string {
  const h = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  const base = `#${h(rgba[0] ?? 0)}${h(rgba[1] ?? 0)}${h(rgba[2] ?? 0)}`;
  return rgba.length > 3 && rgba[3] !== undefined && rgba[3] < 1 ? base + h(rgba[3]) : base;
}

/** zod schema that accepts every supported colour form and outputs [r,g,b,a] in 0..1. */
export const Color = z
  .union([
    z.string().describe('Hex colour such as "#1E90FF" or "#1E90FF80", or a basic name like "white".'),
    z.array(z.number()).min(3).max(4).describe('[r,g,b] or [r,g,b,a]. Values in 0..1, or 0..255 if any value is above 1.'),
    z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }),
  ])
  .transform((v, ctx) => {
    try {
      return toRgba(v);
    } catch (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
      return z.NEVER;
    }
  })
  .describe('Colour. Accepts "#RRGGBB", "#RRGGBBAA", [r,g,b], [r,g,b,a] (0..1 or 0..255), or {r,g,b,a}.');

export type ColorInput = z.input<typeof Color>;
