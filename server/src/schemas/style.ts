/*
 * Optional style file (AE_MCP_STYLE_FILE). JSON, or YAML if the file ends in
 * .yaml/.yml and a parser is available. Provides named durations, easings,
 * stagger values, text styles, colours and free-text rules that get-help
 * surfaces and that tools can reference with "@style.<name>".
 */

import * as fs from 'fs';
import { z } from 'zod';
import { CustomEase, BezierEase, EASING_PRESETS } from './common.js';

export const StyleFile = z.object({
  name: z.string().optional(),
  durations: z.record(z.number()).optional().describe('Seconds, for example {micro: 0.15, small: 0.3, medium: 0.5, scene: 0.8, hold: 1.5}'),
  easings: z.record(z.union([z.enum(EASING_PRESETS), CustomEase, BezierEase])).optional(),
  stagger: z.record(z.number()).optional().describe('Seconds or frames per item, for example {default: 0.08}'),
  type: z
    .record(
      z.object({
        font: z.string().optional(),
        fontSize: z.number().optional(),
        fillColor: z.unknown().optional(),
        strokeColor: z.unknown().optional(),
        strokeWidth: z.number().optional(),
        tracking: z.number().optional(),
        leading: z.number().optional(),
        justification: z.string().optional(),
        allCaps: z.boolean().optional(),
      })
    )
    .optional(),
  colors: z.record(z.unknown()).optional(),
  rules: z.array(z.string()).optional(),
});
export type Style = z.infer<typeof StyleFile>;

let cache: { path: string; mtime: number; style: Style } | undefined;

export function loadStyle(filePath: string | undefined): Style | undefined {
  if (!filePath) return undefined;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return undefined;
  }
  if (cache && cache.path === filePath && cache.mtime === stat.mtimeMs) return cache.style;
  const text = fs.readFileSync(filePath, 'utf8');
  let raw: unknown;
  if (/\.ya?ml$/i.test(filePath)) {
    raw = parseSimpleYaml(text);
  } else {
    raw = JSON.parse(text);
  }
  const style = StyleFile.parse(raw);
  cache = { path: filePath, mtime: stat.mtimeMs, style };
  return style;
}

/** Resolves "@style.easings.entrance" or "@style.entrance" to a value in the style file. */
export function resolveStyleRef(style: Style | undefined, ref: string): unknown {
  if (!ref.startsWith('@style.')) return ref;
  if (!style) throw new Error(`"${ref}" needs a style file, but AE_MCP_STYLE_FILE is not set.`);
  const parts = ref.slice('@style.'.length).split('.');
  // Try the full path first, then search each top-level section for the key.
  let cur: unknown = style;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else {
      cur = undefined;
      break;
    }
  }
  if (cur !== undefined) return cur;
  const key = parts[parts.length - 1];
  for (const section of ['easings', 'durations', 'stagger', 'type', 'colors'] as const) {
    const table = style[section] as Record<string, unknown> | undefined;
    if (table && key in table) return table[key];
  }
  throw new Error(`"${ref}" is not defined in the style file. Known easings: ${Object.keys(style.easings ?? {}).join(', ') || 'none'}; type styles: ${Object.keys(style.type ?? {}).join(', ') || 'none'}.`);
}

/** Recursively replaces "@style.*" strings in an argument object. */
export function applyStyleRefs<T>(style: Style | undefined, value: T): T {
  if (typeof value === 'string') return (value.startsWith('@style.') ? resolveStyleRef(style, value) : value) as T;
  if (Array.isArray(value)) return value.map((v) => applyStyleRefs(style, v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = applyStyleRefs(style, v);
    return out as T;
  }
  return value;
}

export function summarizeStyle(style: Style): string {
  const lines: string[] = [];
  if (style.name) lines.push(`Style: ${style.name}`);
  if (style.durations) lines.push('Durations (s): ' + Object.entries(style.durations).map(([k, v]) => `${k}=${v}`).join(', '));
  if (style.easings) lines.push('Easings: ' + Object.entries(style.easings).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', '));
  if (style.stagger) lines.push('Stagger: ' + Object.entries(style.stagger).map(([k, v]) => `${k}=${v}`).join(', '));
  if (style.type) lines.push('Text styles: ' + Object.keys(style.type).map((k) => `@style.${k}`).join(', '));
  if (style.colors) lines.push('Colours: ' + Object.entries(style.colors).map(([k, v]) => `${k}=${String(v)}`).join(', '));
  if (style.rules && style.rules.length) lines.push('Rules:\n' + style.rules.map((r) => `- ${r}`).join('\n'));
  return lines.join('\n');
}

/** Minimal YAML subset: nested maps with 2-space indent, scalars, inline arrays and flow lists of strings. */
export function parseSimpleYaml(text: string): unknown {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> | unknown[] }> = [{ indent: -1, obj: root }];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const item = line.trim();
    if (item.startsWith('- ')) {
      if (Array.isArray(parent)) parent.push(parseScalar(item.slice(2)));
      continue;
    }
    const m = /^([^:]+):\s*(.*)$/.exec(item);
    if (!m) continue;
    const key = m[1].trim();
    const rest = m[2].trim();
    if (rest === '') {
      const child: Record<string, unknown> | unknown[] = {};
      (parent as Record<string, unknown>)[key] = child;
      stack.push({ indent, obj: child });
    } else if (rest === '[]') {
      (parent as Record<string, unknown>)[key] = [];
    } else if (rest.startsWith('[')) {
      (parent as Record<string, unknown>)[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => parseScalar(s.trim()))
        .filter((s) => s !== '');
    } else {
      (parent as Record<string, unknown>)[key] = parseScalar(rest);
    }
    // A following "- item" list under this key: convert lazily.
    const next = (parent as Record<string, unknown>)[key];
    if (next && typeof next === 'object' && !Array.isArray(next) && Object.keys(next).length === 0) {
      // peek is not possible in a single pass; lists are converted when the first "- " arrives
      stack[stack.length - 1].obj = next as Record<string, unknown>;
    }
  }
  return convertEmptyMapsToLists(root, text);
}

function parseScalar(s: string): unknown {
  const t = s.trim().replace(/^["']|["']$/g, '');
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

function convertEmptyMapsToLists(obj: Record<string, unknown>, text: string): unknown {
  // Second pass for "key:\n  - a\n  - b" lists: rebuild them from the raw text.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)([^:\s][^:]*):\s*$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const items: unknown[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (!l.trim()) {
        j++;
        continue;
      }
      const ind = l.length - l.trimStart().length;
      if (ind <= indent) break;
      if (l.trim().startsWith('- ')) items.push(parseScalar(l.trim().slice(2)));
      else break;
      j++;
    }
    if (items.length) setPathByIndent(obj, lines, i, items);
  }
  return obj;
}

function setPathByIndent(obj: Record<string, unknown>, lines: string[], lineIndex: number, value: unknown): void {
  const path: string[] = [];
  let indent = Infinity;
  for (let i = lineIndex; i >= 0; i--) {
    const m = /^(\s*)([^:\s][^:]*):/.exec(lines[i]);
    if (!m) continue;
    if (m[1].length < indent) {
      path.unshift(m[2].trim());
      indent = m[1].length;
      if (indent === 0) break;
    }
  }
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]];
    if (!next || typeof next !== 'object') return;
    cur = next as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}
