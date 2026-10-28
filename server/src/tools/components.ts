/*
 * Component tools: turning layers into reusable compositions with Essential
 * Properties, reading and setting each instance's values, placing many
 * instances, protecting intro and outro time (Responsive Design - Time),
 * exporting Motion Graphics templates, and a folder-based component library.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { toRgba } from '../schemas/color.js';
import { CompRef, Easing, LayerRef, PropertyPath, TimeArgs, Vec2or3 } from '../schemas/common.js';
import { getBridge } from '../bridge/client.js';
import { componentFiles, ensureLocal, ensureLocalSync, isLocalFile, readTextWithin, type DownloadReport } from './cloud-files.js';
import { defineTool } from './registry.js';

/* ------------------------------------------------------------------ schemas */

export const EssentialValue = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.number()).min(1).max(4),
    z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }),
  ])
  .describe(
    'Value for one Essential Property: text for Source Text; a number for sliders, opacity, angles or a menu item (1-based); true or false for checkboxes; ' +
      '[x, y] or [x, y, z] for points; a colour as "#RRGGBB", a basic name such as "white", [r, g, b] or {r, g, b}; or the text of a Dropdown Menu item (After Effects 26 and later).'
  );

export const EssentialValues = z
  .record(z.string().min(1), EssentialValue)
  .describe('Values by Essential Property label, for example {"Label": "Buy now", "Fill": "#2F6BFF", "Width": 320}. A label inside an Essential Graphics group can be written "Group/Label".');

export const OverrideKeyframe = z
  .object({
    label: z.string().min(1).describe('Essential Property label.'),
    ...TimeArgs,
    value: EssentialValue,
    easing: Easing.optional().describe('Motion arriving at this key. Default: speed 0 with influence 100 arriving and 25 leaving. Text, true or false and menu items always hold.'),
  })
  .refine((k) => k.time !== undefined || k.frame !== undefined, { message: 'Each keyframe needs time (seconds) or frame.' })
  .describe('One keyframe on an instance\'s Essential Property, in the time of the composition that holds the instance.');

const ComponentLayerRef = z
  .union([
    z.string().min(1).describe('Layer name.'),
    z.number().int().positive().describe('1-based index inside the new component (1 is the top layer that was precomposed).'),
    LayerRef,
  ])
  .describe('Layer inside the component, by name, by its 1-based index inside the new component, or as a LayerRef.');

export const EssentialPropertySpec = z.object({
  layer: ComponentLayerRef,
  path: PropertyPath,
  label: z.string().min(1).max(200).optional().describe('Name shown in the Essential Graphics panel and used to set values. Default: the property name.'),
});

export const InstanceSpec = z.object({
  name: z.string().min(1).optional().describe('Layer name. Default: the component name, numbered when that name is taken.'),
  position: Vec2or3.optional().describe('Position in the target comp, pixels. Default: comp centre.'),
  startTime: z.number().optional().describe('Layer start time in seconds. Default 0.'),
  startFrame: z.number().int().optional().describe('Layer start frame; wins over startTime.'),
  duration: z.number().positive().optional().describe('Seconds from the in point to the out point. Default: the component length.'),
  durationFrames: z.number().int().positive().optional().describe('Duration in frames; wins over duration.'),
  values: EssentialValues.optional(),
  keyframes: z.array(OverrideKeyframe).max(100).optional().describe('Keyframes on this instance\'s Essential Properties.'),
});

const ProtectedRegion = z
  .object({
    start: z.number().min(0).optional().describe('Seconds from the composition start.'),
    startFrame: z.number().int().min(0).optional().describe('Frames; wins over start.'),
    duration: z.number().positive().optional().describe('Seconds.'),
    durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
    comment: z.string().optional().describe('Marker comment. Default "Protected".'),
  })
  .refine((r) => (r.start !== undefined || r.startFrame !== undefined) && (r.duration !== undefined || r.durationFrames !== undefined), {
    message: 'Each region needs start or startFrame, and duration or durationFrames.',
  });

/* ------------------------------------------------------------ colour hints */

/**
 * The bridge does not know colour names, and the server does not know which
 * labels are colours. So every value that parses as a colour travels with its
 * [r,g,b,a] form, and the bridge uses it only for colour properties.
 */
export function colorHint(value: unknown): number[] | null {
  const parseable = typeof value === 'string' || (!!value && typeof value === 'object' && !Array.isArray(value));
  if (!parseable) return null;
  try {
    return toRgba(value);
  } catch {
    return null;
  }
}

export function colorHintsFor(values: Record<string, unknown> | undefined): Record<string, number[]> | undefined {
  if (!values) return undefined;
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(values)) {
    const c = colorHint(v);
    if (c) out[k] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

export function keyColorHintsFor(keys: Array<{ value: unknown }> | undefined): Array<number[] | null> | undefined {
  if (!keys || !keys.length) return undefined;
  const out = keys.map((k) => colorHint(k.value));
  return out.some((c) => c) ? out : undefined;
}

type HintedArgs = { colorHints?: Record<string, number[]>; keyColorHints?: Array<number[] | null> };

function withHints<T extends { values?: Record<string, unknown>; keyframes?: Array<{ value: unknown }> }>(spec: T): T & HintedArgs {
  const out: T & HintedArgs = { ...spec };
  const hints = colorHintsFor(spec.values);
  const keyHints = keyColorHintsFor(spec.keyframes);
  if (hints) out.colorHints = hints;
  if (keyHints) out.keyColorHints = keyHints;
  return out;
}

/* ------------------------------------------------------------------ helpers */

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Splits an export destination into the folder and the template name. */
export function splitTemplatePath(raw: string, templateName?: string): { folder: string; templateName?: string; file: string | null } {
  const p = expandHome(raw.trim());
  if (!path.isAbsolute(p)) throw new Error(`path must be absolute (or start with ~/): "${raw}".`);
  if (/\.mogrt$/i.test(p)) {
    const base = path.basename(p).replace(/\.mogrt$/i, '');
    if (!base) throw new Error(`"${raw}" has no file name before .mogrt.`);
    const name = templateName ?? base;
    return { folder: path.dirname(p), templateName: name, file: path.join(path.dirname(p), `${name}.mogrt`) };
  }
  return { folder: p, templateName, file: templateName ? path.join(p, `${templateName}.mogrt`) : null };
}

/* ---------------------------------------------------------------- library */

export interface LibraryControl {
  label: string;
  type: string | null;
  [key: string]: unknown;
}

export interface LibraryComponent {
  name: string;
  category: string | null;
  description: string;
  tags: string[];
  controls: LibraryControl[];
  comp: string;
  folder: string;
  aep: string;
  preview: string | null;
  poster: string | null;
  source: 'index' | 'folder';
  /** false while the .aep is online-only (it downloads on insert), null when the platform cannot tell. */
  local: boolean | null;
}

export interface LibraryScan {
  root: string;
  index: string | null;
  /** Where the index came from: the file, the server's last copy of it (the file was online-only and slow to download), or none. */
  indexSource: 'file' | 'cache' | 'none';
  components: LibraryComponent[];
  skipped: Array<{ path: string; reason: string }>;
  notes: string[];
}

export interface IndexRead {
  path: string;
  exists: boolean;
  text: string | null;
  source: 'file' | 'cache' | 'none';
  note: string | null;
}

/** How long a list or insert waits for an online-only library.json before using the server's last copy. */
export function libraryWaitMs(): number {
  const n = Number(process.env.AE_MCP_LIBRARY_WAIT_MS);
  return Number.isFinite(n) && n >= 0 ? n : 20000;
}

function indexCachePath(root: string): string {
  let dir: string;
  try {
    dir = getBridge().config.bridgeDir;
  } catch {
    dir = os.tmpdir();
  }
  const key = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 16);
  return path.join(dir, 'library-cache', `${key}.json`);
}

/** Keeps the server's copy of a library index, used when the real file is online-only and slow. */
export function rememberIndex(root: string, text: string): void {
  try {
    const file = indexCachePath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  } catch {
    // the copy is only a fallback
  }
}

function indexFallback(root: string, file: string, waitMs: number): IndexRead {
  const why = waitMs > 0 ? `library.json is online-only and did not download within ${Math.round(waitMs / 1000)} s` : 'library.json is online-only';
  const keep = 'Keep it on this device (in Finder: right-click library.json, Always Keep on This Device).';
  const cache = indexCachePath(root);
  try {
    const text = fs.readFileSync(cache, 'utf8');
    const when = fs.statSync(cache).mtime.toISOString();
    return { path: file, exists: true, text, source: 'cache', note: `${why}, so the copy the server read at ${when} was used. ${keep}` };
  } catch {
    return { path: file, exists: true, text: null, source: 'none', note: `${why} and the server has no earlier copy. ${keep}` };
  }
}

/** Reads library.json without hanging on an online-only copy: waits up to waitMs for the download, then falls back to the server's last copy. */
export async function readLibraryIndex(root: string, waitMs = libraryWaitMs()): Promise<IndexRead> {
  const file = path.join(root, 'library.json');
  if (!isFile(file)) return { path: file, exists: false, text: null, source: 'none', note: null };
  const text = await readTextWithin(file, waitMs);
  if (text === null) return indexFallback(root, file, waitMs);
  rememberIndex(root, text);
  return { path: file, exists: true, text, source: 'file', note: null };
}

/** readLibraryIndex for synchronous callers: never waits for a download. */
export function readLibraryIndexSync(root: string): IndexRead {
  const file = path.join(root, 'library.json');
  if (!isFile(file)) return { path: file, exists: false, text: null, source: 'none', note: null };
  if (isLocalFile(file) === false) return indexFallback(root, file, 0);
  const text = fs.readFileSync(file, 'utf8');
  rememberIndex(root, text);
  return { path: file, exists: true, text, source: 'file', note: null };
}

const PREVIEW_NAMES = ['preview.mp4', 'preview.mov', 'preview.webm', 'preview.gif'];
const POSTER_NAMES = ['poster.png', 'poster.jpg', 'poster.jpeg', 'poster.webp'];

/** The library folder from the argument or AE_MCP_LIBRARY_DIR. */
export function libraryRoot(folder?: string): string {
  const raw = folder ?? process.env.AE_MCP_LIBRARY_DIR;
  if (!raw || !raw.trim()) {
    throw new Error('No component library folder. Pass folder, or set AE_MCP_LIBRARY_DIR to a folder with one subfolder per component (each holding <name>.aep).');
  }
  const p = path.resolve(expandHome(raw.trim()));
  if (!isDir(p)) throw new Error(`Component library folder not found: ${p}`);
  return p;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function parseJsonText(text: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function readJsonFile(file: string): { value?: unknown; error?: string } {
  try {
    return parseJsonText(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map((e) => path.join(dir, e.name))
      .sort((a, b) => a.localeCompare(b, 'en'));
  } catch {
    return [];
  }
}

function aepFilesIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /\.aep$/i.test(n) && !n.startsWith('.'))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

function looksLikeComponent(dir: string): boolean {
  return isFile(path.join(dir, 'component.json')) || aepFilesIn(dir).length > 0;
}

function firstExisting(dir: string, names: string[]): string | null {
  for (const n of names) {
    const p = path.join(dir, n);
    if (isFile(p)) return p;
  }
  return null;
}

function normaliseControls(raw: unknown): LibraryControl[] {
  if (!Array.isArray(raw)) return [];
  const out: LibraryControl[] = [];
  for (const c of raw) {
    if (typeof c === 'string' && c.trim()) out.push({ label: c.trim(), type: null });
    else if (c && typeof c === 'object' && str((c as Record<string, unknown>).label)) {
      const o = c as Record<string, unknown>;
      out.push({ ...o, label: str(o.label) as string, type: str(o.type) ?? null });
    }
  }
  return out;
}

/** Reads one component folder. A library.json entry is used as it is; component.json is read only for folders library.json does not list, so online-only parts are not downloaded by a scan. */
function readComponentFolder(dir: string, categoryHint: string | null, indexEntry: Record<string, unknown> | null): LibraryComponent | { reason: string } {
  if (!isDir(dir)) return { reason: 'folder not found' };
  let json: Record<string, unknown> = {};
  const jsonPath = path.join(dir, 'component.json');
  if (!indexEntry && isFile(jsonPath) && isLocalFile(jsonPath) !== false) {
    const parsed = readJsonFile(jsonPath);
    if (parsed.error) return { reason: `component.json is not valid JSON: ${parsed.error}` };
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return { reason: 'component.json must hold an object' };
    json = parsed.value as Record<string, unknown>;
  }
  const meta: Record<string, unknown> = { ...(indexEntry ?? {}), ...json };
  const base = path.basename(dir);
  const name = str(meta.name) ?? base;
  let aep: string | null = null;
  const declared = str(meta.aep);
  if (declared) aep = path.resolve(dir, expandHome(declared));
  else {
    aep = [path.join(dir, `${base}.aep`), path.join(dir, `${name}.aep`)].find(isFile) ?? null;
    if (!aep) {
      const all = aepFilesIn(dir);
      if (all.length === 1) aep = all[0];
      else if (all.length > 1) return { reason: `${all.length} .aep files and none named ${base}.aep; set "aep" in component.json` };
    }
  }
  if (!aep) return { reason: `no .aep file (expected ${base}.aep)` };
  if (!isFile(aep)) return { reason: `.aep file not found: ${aep}` };
  const previewDeclared = str(meta.preview);
  const posterDeclared = str(meta.poster);
  const preview = previewDeclared ? path.resolve(dir, previewDeclared) : firstExisting(dir, PREVIEW_NAMES);
  const poster = posterDeclared ? path.resolve(dir, posterDeclared) : firstExisting(dir, POSTER_NAMES);
  const tags = Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim()) : [];
  return {
    name,
    category: str(meta.category) ?? categoryHint,
    description: str(meta.description) ?? '',
    tags,
    controls: normaliseControls(meta.controls),
    comp: str(meta.comp) ?? name,
    folder: dir,
    aep,
    preview: preview && isFile(preview) ? preview : null,
    poster: poster && isFile(poster) ? poster : null,
    source: indexEntry ? 'index' : 'folder',
    local: isLocalFile(aep),
  };
}

/** Scans a library: library.json entries first, then every component subfolder (one level of category folders allowed). */
export function scanLibrary(root: string, read: IndexRead = readLibraryIndexSync(root)): LibraryScan {
  const notes: string[] = read.note ? [read.note] : [];
  const components: LibraryComponent[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const seen = new Set<string>();
  const add = (dir: string, categoryHint: string | null, entry: Record<string, unknown> | null) => {
    const key = path.resolve(dir);
    if (seen.has(key)) return;
    seen.add(key);
    const res = readComponentFolder(key, categoryHint, entry);
    if ('reason' in res) skipped.push({ path: key, reason: res.reason });
    else components.push(res);
  };
  const indexPath = read.path;
  const index: string | null = read.exists ? indexPath : null;
  if (read.exists && read.text === null) skipped.push({ path: indexPath, reason: read.note ?? 'library.json could not be read' });
  if (read.text !== null) {
    const parsed = parseJsonText(read.text);
    const value = parsed.value;
    let entries: unknown[] | null = null;
    if (Array.isArray(value)) entries = value;
    else if (value && typeof value === 'object' && Array.isArray((value as { components?: unknown }).components)) entries = (value as { components: unknown[] }).components;
    if (parsed.error) skipped.push({ path: indexPath, reason: `library.json is not valid JSON: ${parsed.error}` });
    else if (!entries) skipped.push({ path: indexPath, reason: 'library.json must be an array or {"components": [...]}' });
    else {
      for (const e of entries) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) {
          skipped.push({ path: indexPath, reason: 'an entry in library.json is not an object' });
          continue;
        }
        const entry = e as Record<string, unknown>;
        const rel = str(entry.folder) ?? str(entry.path) ?? str(entry.dir) ?? str(entry.name);
        if (!rel) {
          skipped.push({ path: indexPath, reason: 'an entry in library.json has no folder or name' });
          continue;
        }
        add(path.resolve(root, expandHome(rel)), null, entry);
      }
    }
  }
  for (const dir of listDirs(root)) {
    if (seen.has(path.resolve(dir))) continue;
    if (looksLikeComponent(dir)) {
      add(dir, null, null);
      continue;
    }
    for (const sub of listDirs(dir).filter(looksLikeComponent)) add(sub, path.basename(dir), null);
  }
  components.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '', 'en') || a.name.localeCompare(b.name, 'en'));
  return { root, index, indexSource: read.source, components, skipped, notes };
}

function haystack(c: LibraryComponent): string {
  return [c.name, c.category ?? '', c.description, c.tags.join(' '), c.controls.map((k) => k.label).join(' '), path.basename(c.folder)].join(' ').toLowerCase();
}

export function searchLibrary(components: LibraryComponent[], opts: { category?: string; query?: string }): LibraryComponent[] {
  const cat = opts.category?.trim().toLowerCase();
  const words = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return components.filter((c) => (!cat || (c.category ?? '').toLowerCase() === cat) && words.every((w) => haystack(c).includes(w)));
}

export function libraryCategories(components: LibraryComponent[]): Array<{ name: string | null; count: number }> {
  const counts = new Map<string | null, number>();
  for (const c of components) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'en'));
}

/** Finds one component by name or folder name, exact first, then case-insensitive. */
export function findLibraryComponent(scan: LibraryScan, wanted: string): LibraryComponent {
  const w = wanted.trim();
  const exact = scan.components.filter((c) => c.name === w || path.basename(c.folder) === w);
  const lower = w.toLowerCase();
  const matches = exact.length ? exact : scan.components.filter((c) => c.name.toLowerCase() === lower || path.basename(c.folder).toLowerCase() === lower);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`"${wanted}" matches ${matches.length} library components (${matches.map((m) => m.folder).join(', ')}). Rename one, or pass aep and compName.`);
  }
  const names = scan.components.map((c) => c.name);
  const more = names.length > 40 ? ` and ${names.length - 40} more` : '';
  throw new Error(`No component "${wanted}" in the library at ${scan.root}. Components: ${names.slice(0, 40).join(', ') || '(none)'}${more}.`);
}

/** Resolves the library entry and builds the bridge arguments for insert-library-component. */
export function prepareInsert(args: {
  component: string;
  folder?: string;
  aep?: string;
  compName?: string;
  values?: Record<string, unknown>;
  keyframes?: Array<{ value: unknown }>;
  [key: string]: unknown;
}, download: 'sync' | 'none' = 'none', scan?: LibraryScan): { bridgeArgs: Record<string, unknown>; entry: LibraryComponent | null; files: string[]; download: DownloadReport | null } {
  const { folder, aep, ...rest } = args;
  let entry: LibraryComponent | null = null;
  let aepPath: string;
  let compName: string;
  if (aep) {
    aepPath = path.resolve(expandHome(aep));
    if (!isFile(aepPath)) throw new Error(`.aep file not found: ${aepPath}`);
    compName = args.compName ?? args.component;
  } else {
    entry = findLibraryComponent(scan ?? scanLibrary(libraryRoot(folder)), args.component);
    aepPath = entry.aep;
    compName = args.compName ?? entry.comp;
  }
  const bridgeArgs = withHints({ ...rest, aepPath, compName, componentName: entry ? entry.name : args.component });
  delete (bridgeArgs as Record<string, unknown>).component;
  const files = entry ? componentFiles(aepPath) : [aepPath];
  return { bridgeArgs, entry, files, download: download === 'sync' ? ensureLocalSync(files) : null };
}

/* -------------------------------------------------------------------- tools */

export function registerComponentTools(server: McpServer): void {
  defineTool(server, {
    name: 'create-component',
    group: 'components',
    description:
      'Turns layers into a reusable component: precomposes them into a new composition, leaves an instance in place with the same position and timing, and exposes the listed properties as Essential Properties that each instance can override. ' +
      'Use when: a button, card, badge or lower third repeats with different text, colours or sizes. Do not use for: a plain precomp without controls (precompose) or one more control on an existing component (add-essential-property). ' +
      'Inputs: layers (default the selected layers); name; properties [{layer, path, label}], layer being a name or 1-based index inside the new comp; startAtZero (default true) starts the content at 0 s; cropToContent (default true) fits the comp to the visible layers plus padding px (default 0); duration in seconds; templateName. ' +
      'Returns: the component comp, the instance layer, the time shift, the crop region, and the Essential Properties added or failed (with reasons). ' +
      'Notes: controls can be checkboxes, colours, Source Text, numbers, points and Dropdown Menu Controls; drive a width through a Slider Control expression. Content outside a cropped comp is clipped, so pad for controls that grow it. Undoable in one step. ' +
      'Example: layers [{name: "BG"}, {name: "Label"}], name "Button", properties [{layer: "Label", path: "Text/Source Text", label: "Label"}].',
    input: {
      comp: CompRef.optional(),
      layers: z
        .union([z.array(LayerRef).min(1).max(200), z.object({ selected: z.literal(true) })])
        .optional()
        .describe('Layers to turn into the component. Default {selected: true}.'),
      name: z.string().min(1).max(255).describe('Name of the new component composition. Must not already be used by a composition.'),
      properties: z
        .array(EssentialPropertySpec)
        .max(60)
        .superRefine((list, ctx) => {
          const seen = new Set<string>();
          list.forEach((p, i) => {
            if (!p.label) return;
            const key = p.label.toLowerCase();
            if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'label'], message: `Label "${p.label}" is used twice. Labels must be unique.` });
            seen.add(key);
          });
        })
        .optional()
        .describe('Properties to expose as Essential Properties, in panel order.'),
      startAtZero: z.boolean().optional().describe('Shift the content so the component starts at 0 s; the instance is offset so nothing moves in time. Default true.'),
      cropToContent: z.boolean().optional().describe('Size the component to the bounds of its visible layers so new instances are positioned by their centre. Default true.'),
      padding: z.number().min(0).max(2000).optional().describe('Pixels added around the content when cropping. Leave room for controls that make the content bigger (a Width slider), or the extra is clipped. Default 0.'),
      duration: z.number().positive().optional().describe('Component length in seconds. Default: the parent comp length minus the time shift.'),
      templateName: z.string().min(1).max(255).optional().describe('Name in the Essential Graphics panel, used as the .mogrt file name on export.'),
    },
  });

  defineTool(server, {
    name: 'add-essential-property',
    group: 'components',
    description:
      'Adds one property of a layer to its composition\'s Essential Properties under a label, so every instance of that composition can override it. Checks first that After Effects accepts the property and fails with the list of supported kinds when it does not. ' +
      'Use when: a component needs one more control after create-component, or a comp built by hand should become a component. Do not use for: building the component from layers (create-component) or setting an instance\'s value (set-component-values). ' +
      'Inputs: comp, the component composition; layer inside it; path to the property, for example "Text/Source Text", "Effects/Width/Slider" or "Contents/Button/Contents/Fill 1/Color"; label (default the property name). ' +
      'Returns: the property summary, the label, its 1-based position and the full list of Essential Property names. ' +
      'Notes: supported kinds are checkboxes, colours, Source Text, single numbers (opacity, rotation, sliders, angles), 2D and 3D points (position, scale, Point Control) and Dropdown Menu Controls. Shape paths, masks and groups cannot be added. Labels must be unique. There is no scripting call to remove an Essential Property. Undoable in one step. ' +
      'Example: comp {name: "Button"}, layer {name: "BG"}, path "Effects/Width/Slider", label "Width".',
    input: {
      comp: CompRef.optional().describe('The component composition (the one whose Essential Graphics panel gets the control).'),
      layer: LayerRef,
      path: PropertyPath,
      label: z.string().min(1).max(200).optional().describe('Name in the Essential Graphics panel. Default: the property name.'),
    },
  });

  defineTool(server, {
    name: 'list-essential-properties',
    group: 'components',
    mutating: false,
    description:
      'Lists a component\'s Essential Properties: the control names in panel order and, through an instance layer, each control\'s type, current value, keyframe count, expression state and the source property it comes from. ' +
      'Use when: before set-component-values or add-component-instances, to learn the exact labels and value types; or to check what an instance overrides. Do not use for: ordinary property values on a layer (get-property-value). ' +
      'Inputs: comp; layer (optional). Without layer, comp is the component itself and the result also lists where it is used. With layer, comp is the composition that holds the instance and the values are that instance\'s. ' +
      'Returns: component (id, name, size, duration, templateName), count, controllers [{index, name}], properties [{label, path, valueType, value, numKeys, hasExpression, source}], and instances or instance. ' +
      'Notes: read-only. Without an instance anywhere in the project only the names are known; place one with add-component-instances to see types. Sources need After Effects 2022 or later. ' +
      'Example: comp {name: "Main"}, layer {name: "Button 2"}.',
    input: {
      comp: CompRef.optional().describe('The component comp, or with layer the comp that holds the instance.'),
      layer: LayerRef.optional().describe('An instance layer of the component. Optional.'),
    },
  });

  defineTool(server, {
    name: 'set-component-values',
    group: 'components',
    description:
      'Sets the Essential Property values of one component instance by label: text, numbers, colours, checkboxes, points and menu items. Optional keyframes animate an override over time on that instance only. ' +
      'Use when: giving each copy of a button its own label and colour, or making one instance change state at a time. Do not use for: the component\'s default values (change the property inside the component) or new instances (add-component-instances). ' +
      'Inputs: layer, the instance; comp that holds it; values {label: value}; keyframes [{label, time or frame, value, easing}] in the holding comp\'s time; replaceKeys (default false) clears a label\'s keys before writing. ' +
      'Returns: count, failed, results per label with the value read back, the keyframes written, and the instance\'s Essential Properties. ' +
      'Notes: unknown labels fail before anything changes and the error lists the labels. A label that already has keys must be changed through keyframes. Numeric keys land softly (speed 0, influence 100 arriving, 25 leaving) unless easing is given; text, true or false and menu items hold. Undoable in one step. ' +
      'Example: layer {name: "Button 2"}, values {"Label": "Sign up", "Fill": "#1E1E1E", "Width": 280}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.describe('The component instance (a layer whose source is the component comp).'),
      values: EssentialValues.optional(),
      keyframes: z.array(OverrideKeyframe).max(100).optional(),
      replaceKeys: z.boolean().optional().describe('Remove the existing keys of each keyed label first. Default false.'),
    },
    toBridgeArgs: (args) => {
      const hasValues = !!args.values && Object.keys(args.values).length > 0;
      const hasKeys = !!args.keyframes && args.keyframes.length > 0;
      if (!hasValues && !hasKeys) throw new Error('Pass values, keyframes or both.');
      return withHints(args);
    },
  });

  defineTool(server, {
    name: 'add-component-instances',
    group: 'components',
    description:
      'Places one or many instances of a component composition into a target composition in one call, each with its own name, position, start time, duration and Essential Property values. ' +
      'Use when: putting three buttons with different labels on screen, filling a list of cards, or repeating a badge. Do not use for: a single precomp layer without values (add-composition-as-layer) or library components from disk (insert-library-component). ' +
      'Inputs: comp, the target; component, the component comp by id or name; instances [{name, position, startTime or startFrame, duration or durationFrames, values, keyframes}]; or count for identical copies. ' +
      'Returns: count, failed, and results per instance with the layer summary and the values written. ' +
      'Notes: labels are checked on the first instance; an unknown label removes it and fails with the label list. Instances keep list order (the first is on top), and repeated names are numbered. An instance cannot run past the component\'s length. Undoable in one step. ' +
      'Example: component {name: "Button"}, instances [{position: [560, 540], values: {"Label": "Back"}}, {position: [960, 540], values: {"Label": "Skip"}}, {position: [1360, 540], values: {"Label": "Next", "Fill": "#2F6BFF"}}].',
    input: {
      comp: CompRef.optional().describe('Target composition. Default: the active composition.'),
      component: CompRef.describe('The component composition to place, by id or name.'),
      instances: z.array(InstanceSpec).min(1).max(100).optional().describe('One entry per instance.'),
      count: z.number().int().min(1).max(100).optional().describe('Number of identical instances when instances is not given. Default 1.'),
    },
    toBridgeArgs: (args) => {
      if (args.component.id === undefined && !args.component.name) throw new Error('component needs {id} or {name}.');
      if (args.instances && args.count !== undefined && args.count !== args.instances.length) {
        throw new Error(`count (${args.count}) does not match the ${args.instances.length} instances given. Pass one or the other.`);
      }
      const instances = args.instances ? args.instances.map((s) => withHints(s)) : undefined;
      return { ...args, instances };
    },
  });

  defineTool(server, {
    name: 'set-responsive-time',
    group: 'components',
    description:
      'Sets Responsive Design - Time on a component composition: protected regions for the intro and outro as composition markers with Protected Region on, so an instance stretched to a longer or shorter duration keeps its in and out animations at their original speed and only the middle stretches. ' +
      'Use when: a lower third, button or title component must hold for different lengths in different places, or before exporting a .mogrt for editors. Do not use for: ordinary comp markers (add-marker) or slowing a whole layer (set-speed). ' +
      'Inputs: comp, the component; intro and outro in seconds, or introFrames and outroFrames; regions [{start or startFrame, duration or durationFrames, comment}] for more protected spans; replace (default true) removes existing protected-region markers first; introComment and outroComment. ' +
      'Returns: the intro, outro and stretchable span in seconds and frames, the composition markers, and the instances that already use the component. ' +
      'Notes: needs After Effects 2019 or later. A non-protected marker at the same time fails rather than being replaced. Existing instances need Layer > Markers > Update Markers from Source. Undoable in one step. ' +
      'Example: comp {name: "Lower Third"}, introFrames 18, outroFrames 12.',
    input: {
      comp: CompRef.optional().describe('The component composition.'),
      intro: z.number().min(0).optional().describe('Protected intro length in seconds from the comp start.'),
      introFrames: z.number().int().min(0).optional().describe('Intro length in frames; wins over intro.'),
      outro: z.number().min(0).optional().describe('Protected outro length in seconds before the comp end.'),
      outroFrames: z.number().int().min(0).optional().describe('Outro length in frames; wins over outro.'),
      regions: z.array(ProtectedRegion).max(20).optional().describe('Extra protected spans.'),
      replace: z.boolean().optional().describe('Remove existing protected-region markers first. Default true.'),
      introComment: z.string().optional().describe('Comment on the intro marker. Default "Intro".'),
      outroComment: z.string().optional().describe('Comment on the outro marker. Default "Outro".'),
    },
    toBridgeArgs: (args) => {
      const any = args.intro !== undefined || args.introFrames !== undefined || args.outro !== undefined || args.outroFrames !== undefined || (args.regions?.length ?? 0) > 0;
      if (!any) throw new Error('Give intro, outro (seconds or frames) or regions.');
      return args;
    },
  });

  defineTool(server, {
    name: 'export-component-template',
    group: 'components',
    timeout: 'render',
    description:
      'Exports a component composition as a Motion Graphics template (.mogrt) with its Essential Properties, for reuse in other projects or in Premiere Pro. ' +
      'Use when: a finished component should be shared or kept as a template file. Do not use for: saving the component inside a library folder as an .aep (save-project-as) or rendering video (render). ' +
      'Inputs: comp, the component; path, an absolute output folder or a full path ending in .mogrt (its file name becomes the template name); templateName (default the comp\'s Essential Graphics name); overwrite (default false); saveProject (default true). ' +
      'Returns: the template name, the .mogrt path, whether it exists and its size in bytes, and whether the project was saved first. ' +
      'Notes: After Effects asks to save a changed project before exporting, which would block the bridge, so the project is saved first; a project that was never saved fails with a hint to use save-project-as. Setting templateName changes the comp\'s Essential Graphics name. Can take several seconds. ' +
      'Example: comp {name: "Button"}, path "/tmp/components/Button.mogrt", overwrite true.',
    input: {
      comp: CompRef.optional().describe('The component composition.'),
      path: z.string().min(1).describe('Absolute output folder, or a full file path ending in .mogrt. "~/" is expanded.'),
      templateName: z.string().min(1).max(255).optional().describe('Template name and file name. Default: the comp\'s Essential Graphics name.'),
      overwrite: z.boolean().optional().describe('Replace an existing .mogrt with the same name. Default false.'),
      saveProject: z.boolean().optional().describe('Save the project first when it has unsaved changes. Default true; false fails instead.'),
    },
    toBridgeArgs: (args) => {
      const dest = splitTemplatePath(args.path, args.templateName);
      return { comp: args.comp, folder: dest.folder, templateName: dest.templateName, overwrite: args.overwrite, saveProject: args.saveProject };
    },
  });

  defineTool(server, {
    name: 'list-library-components',
    group: 'components',
    mutating: false,
    bridge: null,
    description:
      'Lists the components in a component library folder without touching After Effects. A library is a folder with one subfolder per component holding <name>.aep and optionally component.json ({name, category, description, controls: [{label, type}], tags, comp}), preview.mp4 and poster.png; category subfolders one level deep and a top-level library.json index (written by save-to-library) are also read. ' +
      'Use when: before insert-library-component, to find a component and its control labels. Do not use for: compositions already in the open project (list-compositions). ' +
      'Inputs: folder (default the AE_MCP_LIBRARY_DIR environment variable); category to filter by; query, words that must all appear in the name, category, description, tags or control labels; limit (default 100). ' +
      'Returns: the library folder, the index file if any, total and matched counts, categories with counts, components [{name, category, description, tags, controls, comp, folder, aep, preview, poster, local}] and skipped folders with the reason. ' +
      'Notes: read-only and runs on the server. A library.json entry is used as written, and component.json is read only for folders library.json does not list, so a library kept online-only in OneDrive or iCloud is listed without downloading its parts. local false means the part is online-only; insert-library-component downloads it first. ' +
      'Example: category "Buttons", query "primary".',
    input: {
      folder: z.string().min(1).optional().describe('Library folder. Default: AE_MCP_LIBRARY_DIR.'),
      category: z.string().min(1).optional().describe('Only this category (case-insensitive).'),
      query: z.string().optional().describe('Search words; all must match.'),
      limit: z.number().int().min(1).max(1000).optional().describe('Most components to return. Default 100.'),
    },
    handler: async (args) => {
      const root = libraryRoot(args.folder);
      const scan = scanLibrary(root, await readLibraryIndex(root));
      const matched = searchLibrary(scan.components, { category: args.category, query: args.query });
      const limit = args.limit ?? 100;
      return {
        folder: scan.root,
        index: scan.index,
        indexSource: scan.indexSource,
        total: scan.components.length,
        matched: matched.length,
        truncated: matched.length > limit,
        categories: libraryCategories(scan.components),
        components: matched.slice(0, limit),
        skipped: scan.skipped,
        notes: scan.notes,
      };
    },
  });

  defineTool(server, {
    name: 'insert-library-component',
    group: 'components',
    description:
      'Inserts a component from a library folder into a composition: imports its .aep once per project (later calls reuse the imported folder), finds its main comp, and adds an instance with optional position, start time, duration and Essential Property values. ' +
      'Use when: building a scene from saved components, such as a button or lower third kept in the library. Do not use for: components already in the project (add-component-instances) or footage files (import-file). ' +
      'Inputs: component, the library name or folder name; folder (default AE_MCP_LIBRARY_DIR); aep and compName to bypass the library; comp, the target; name; position; startTime or startFrame; duration or durationFrames; values {label: value}; keyframes; reuseImported (default true). ' +
      'Returns: the instance layer, the component comp, whether the .aep was imported now or reused, the project folder that holds it, the values written, the instance\'s Essential Properties and the library entry. ' +
      'Notes: the main comp is the library entry\'s "comp" or the comp named like the component. A part kept online-only by OneDrive, iCloud or Dropbox (with its footage folder) is downloaded on the server before After Effects opens it; the result says what was downloaded. An unknown label removes the new instance and fails; the import stays for reuse. Missing fonts or footage inside the .aep can show warnings. Undoable in one step. ' +
      'Example: component "Primary Button", position [960, 800], values {"Label": "Start free trial"}.',
    input: {
      comp: CompRef.optional().describe('Target composition. Default: the active composition.'),
      component: z.string().min(1).describe('Component name (component.json name or folder name). With aep, the comp name to look for.'),
      folder: z.string().min(1).optional().describe('Library folder. Default: AE_MCP_LIBRARY_DIR.'),
      aep: z.string().min(1).optional().describe('Path to an .aep to use directly instead of a library entry.'),
      compName: z.string().min(1).optional().describe('Main comp inside the .aep. Default: component.json "comp", else the component name.'),
      name: z.string().min(1).optional().describe('Layer name for the instance.'),
      position: Vec2or3.optional().describe('Position in the target comp, pixels. Default: comp centre.'),
      startTime: z.number().optional().describe('Layer start time in seconds. Default 0.'),
      startFrame: z.number().int().optional().describe('Layer start frame; wins over startTime.'),
      duration: z.number().positive().optional().describe('Seconds from the in point to the out point.'),
      durationFrames: z.number().int().positive().optional().describe('Duration in frames; wins over duration.'),
      values: EssentialValues.optional(),
      keyframes: z.array(OverrideKeyframe).max(100).optional(),
      reuseImported: z.boolean().optional().describe('Reuse a copy of the same .aep already imported into this project. Default true.'),
    },
    toBridgeArgs: (args) => prepareInsert(args, 'sync').bridgeArgs,
    handler: async (args, ctx) => {
      const root = args.aep ? null : libraryRoot(args.folder);
      const scan = root ? scanLibrary(root, await readLibraryIndex(root)) : undefined;
      const { bridgeArgs, entry, files } = prepareInsert(args, 'none', scan);
      const download = await ensureLocal(files);
      const result = await ctx.run('insertLibraryComponent', bridgeArgs);
      if (result && typeof result === 'object' && !Array.isArray(result)) return { ...result, libraryEntry: entry, download };
      return result;
    },
  });
}
