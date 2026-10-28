/*
 * Saving parts into the component library. A part is a composition and
 * everything it uses, saved as its own project at <Category>/<Name>/<Name>.aep
 * with a poster frame and a footage folder. library.json lists every part and
 * README.md holds a table of them, so an agent can read those two files to
 * choose a part without downloading the rest of an online-only library.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { scalePngBuffer } from '../render/png.js';
import { CompRef } from '../schemas/common.js';
import { readTextWithin, writeInPlace } from './cloud-files.js';
import { expandHome, libraryWaitMs, readLibraryIndex, rememberIndex } from './components.js';
import { defineTool, jsonResult } from './registry.js';
import { waitForFrameFile } from './render.js';

export const LIBRARY_INDEX = 'library.json';
export const LIBRARY_README = 'README.md';
const PARTS_START = '<!-- parts:start -->';
const PARTS_END = '<!-- parts:end -->';
const POSTER_WIDTH = 480;
const README_LATE = 'README.md is online-only and did not download in time, so its parts table was not updated; the next save or remove updates it. Keep README.md on this device (in Finder: right-click, Always Keep on This Device).';

export interface LibraryEntry {
  name: string;
  category: string;
  description: string;
  tags: string[];
  comp: string;
  folder: string;
  aep: string;
  poster: string | null;
  controls: Array<{ label: string; type: string | null }>;
  width: number | null;
  height: number | null;
  duration: number | null;
  frameRate: number | null;
  fonts: string[];
  footage: string[];
  source: { project: string | null; comp: string; note?: string };
  bytes: number | null;
  added: string;
  updated: string;
  [key: string]: unknown;
}

export interface LibraryIndex {
  about: string;
  version: number;
  updated: string;
  components: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

const ABOUT =
  'Component library for the After Effects MCP. Each part is a composition saved as its own project with Essential Properties as its controls. ' +
  'list-library-components reads this file, insert-library-component places a part, save-to-library adds one. Keep this file and README.md on the device; the parts can stay online-only.';

/** A name that is safe as a file or folder name on macOS and Windows. */
export function safeName(s: string): string {
  const clean = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  return clean || 'Part';
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The library folder for writing: created when its parent exists. */
export function libraryRootForSave(folder?: string): string {
  const raw = folder ?? process.env.AE_MCP_LIBRARY_DIR;
  if (!raw || !raw.trim()) throw new Error('No component library folder. Pass folder, or set AE_MCP_LIBRARY_DIR.');
  const p = path.resolve(expandHome(raw.trim()));
  if (!isDir(p)) {
    if (!isDir(path.dirname(p))) throw new Error(`Neither the library folder nor its parent folder exists: ${p}`);
    fs.mkdirSync(p);
  }
  return p;
}

/** Reads library.json for writing. Fails rather than work from an old copy when the file is online-only and slow to download. */
export async function readIndex(root: string): Promise<LibraryIndex> {
  const file = path.join(root, LIBRARY_INDEX);
  const empty: LibraryIndex = { about: ABOUT, version: 1, updated: new Date().toISOString(), components: [] };
  const read = await readLibraryIndex(root);
  if (!read.exists) return empty;
  if (read.source !== 'file' || read.text === null) throw new Error(`${read.note?.replace(/, so the copy.*? was used\./, '.') ?? 'library.json could not be read.'} Nothing was changed.`);
  let value: unknown;
  try {
    value = JSON.parse(read.text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${(err as Error).message}). Fix it by hand before saving more parts.`);
  }
  if (Array.isArray(value)) return { ...empty, components: value as Array<Record<string, unknown>> };
  if (value && typeof value === 'object' && Array.isArray((value as LibraryIndex).components)) return { ...empty, ...(value as LibraryIndex) };
  throw new Error(`${file} must be an array or {"components": [...]}.`);
}

function writeIndex(root: string, index: LibraryIndex): void {
  const text = JSON.stringify(index, null, 2) + '\n';
  writeInPlace(path.join(root, LIBRARY_INDEX), text);
  rememberIndex(root, text);
}

/** Adds or replaces the entry with the same folder, keeps the list sorted and writes library.json in place. */
export async function upsertEntry(root: string, entry: LibraryEntry): Promise<LibraryIndex> {
  const index = await readIndex(root);
  const key = entry.folder.toLowerCase();
  const old = index.components.find((c) => String(c.folder ?? '').toLowerCase() === key);
  const merged: LibraryEntry = old ? { ...entry, added: String(old.added ?? entry.added) } : entry;
  index.components = [...index.components.filter((c) => c !== old), merged].sort(
    (a, b) => String(a.category ?? '').localeCompare(String(b.category ?? ''), 'en') || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'en')
  );
  index.updated = entry.updated;
  index.about = index.about || ABOUT;
  writeIndex(root, index);
  return index;
}

/** Removes the entry with this name or folder from library.json and deletes its folder. Returns the removed entry and the index. */
export async function removeEntry(root: string, wanted: string): Promise<{ entry: Record<string, unknown>; folder: string; index: LibraryIndex }> {
  const index = await readIndex(root);
  const w = wanted.trim().toLowerCase();
  const hits = index.components.filter((c) => String(c.name ?? '').toLowerCase() === w || String(c.folder ?? '').toLowerCase() === w);
  if (!hits.length) throw new Error(`No part "${wanted}" in ${path.join(root, LIBRARY_INDEX)}. Parts: ${index.components.map((c) => c.name).join(', ') || '(none)'}.`);
  if (hits.length > 1) throw new Error(`"${wanted}" matches ${hits.length} parts (${hits.map((c) => c.folder).join(', ')}). Pass the folder, for example "${hits[0].folder}".`);
  const entry = hits[0];
  const folder = path.resolve(root, String(entry.folder ?? ''));
  if (!folder.startsWith(root + path.sep) || folder === root) throw new Error(`The part's folder "${entry.folder}" is not inside the library; nothing was deleted.`);
  fs.rmSync(folder, { recursive: true, force: true });
  const parent = path.dirname(folder);
  if (parent !== root && isDir(parent) && fs.readdirSync(parent).filter((n) => !n.startsWith('.')).length === 0) fs.rmSync(parent, { recursive: true, force: true });
  index.components = index.components.filter((c) => c !== entry);
  index.updated = new Date().toISOString();
  writeIndex(root, index);
  return { entry, folder, index };
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function shape(c: Record<string, unknown>): string {
  const parts: string[] = [];
  if (c.width && c.height) parts.push(`${c.width}×${c.height}`);
  if (typeof c.duration === 'number') parts.push(`${Math.round(c.duration * 100) / 100} s`);
  if (typeof c.frameRate === 'number') parts.push(`${Math.round(c.frameRate * 100) / 100} fps`);
  return parts.join(' · ');
}

/** The parts table that README.md shows between its markers. */
export function partsTable(components: Array<Record<string, unknown>>): string {
  if (!components.length) return '_No parts yet._';
  const rows = components.map((c) => {
    const labels = Array.isArray(c.controls) ? (c.controls as Array<{ label?: string }>).map((k) => String(k.label ?? '')).filter(Boolean) : [];
    const shown = labels.length > 8 ? `${labels.slice(0, 8).join(', ')} and ${labels.length - 8} more` : labels.join(', ');
    const link = encodeURI(`${String(c.folder ?? '')}/`);
    return `| [${cell(String(c.name ?? ''))}](${link}) | ${cell(String(c.category ?? ''))} | ${cell(String(c.description ?? ''))} | ${cell(shown || 'none')} | ${shape(c)} |`;
  });
  return [`${components.length} parts.`, '', '| Part | Category | What it is | Controls | Size and length |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

export const README_TEMPLATE = `# Component library

Ready-made After Effects parts. Each part is a small project whose controls (Essential Properties) change its text, colours, sizes and timing, so it can be dropped into any film and adjusted instead of being built again.

## How it is used

- \`list-library-components\` reads \`library.json\` to find a part and its controls.
- \`insert-library-component\` puts a part into a composition and sets its controls. A part that is online-only is downloaded first.
- \`save-to-library\` adds a part: it saves a composition and everything it uses as its own project, copies its footage beside it, takes a poster frame and updates this file and \`library.json\`.

## Keep on this device

Keep \`README.md\` and \`library.json\` always on this device. Everything else can stay online-only: a part downloads when it is used.

## Folder layout

Each part lives in \`<Category>/<Part>/\`: \`<Part>.aep\`, \`poster.png\`, and \`footage/\` when it uses footage.

## Parts

${PARTS_START}
${PARTS_END}
`;

/** Writes the parts table into README.md (created from the template when missing), in place. Text outside the markers is left alone. Returns null when README.md is online-only and did not download in time. */
export async function updateReadme(root: string, components: Array<Record<string, unknown>>): Promise<string | null> {
  const file = path.join(root, LIBRARY_README);
  let text = fs.existsSync(file) ? await readTextWithin(file, libraryWaitMs()) : README_TEMPLATE;
  if (text === null) return null;
  const block = `${PARTS_START}\n${partsTable(components)}\n${PARTS_END}`;
  const a = text.indexOf(PARTS_START);
  const b = text.indexOf(PARTS_END);
  if (a >= 0 && b > a) text = text.slice(0, a) + block + text.slice(b + PARTS_END.length);
  else text = `${text.replace(/\s*$/, '')}\n\n## Parts\n\n${block}\n`;
  writeInPlace(file, text);
  return file;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

export function registerLibraryTools(server: McpServer): void {
  defineTool(server, {
    name: 'remove-from-library',
    group: 'components',
    bridge: null,
    description:
      'Removes a part from the component library: deletes its folder (the .aep, poster and footage), drops its library.json entry and updates the README table. ' +
      'Use when: a part is wrong, replaced by a better one or no longer wanted. Do not use for: replacing a part with a new version (save-to-library with overwrite true keeps its added date). ' +
      'Inputs: component, the part name or its folder ("Buttons/Send Button"); folder (default AE_MCP_LIBRARY_DIR). ' +
      'Returns: the removed entry, the folder deleted and how many parts are left. ' +
      'Notes: does not touch After Effects or projects that already use the part. In a synced folder (OneDrive, iCloud, Dropbox) the files go to that service\'s recycle bin.',
    input: {
      component: z.string().min(1).describe('Part name or folder, for example "Send Button" or "Buttons/Send Button".'),
      folder: z.string().min(1).optional().describe('Library folder. Default: AE_MCP_LIBRARY_DIR.'),
    },
    handler: async (args) => {
      const raw = args.folder ?? process.env.AE_MCP_LIBRARY_DIR;
      if (!raw || !raw.trim()) throw new Error('No component library folder. Pass folder, or set AE_MCP_LIBRARY_DIR.');
      const root = path.resolve(expandHome(raw.trim()));
      if (!isDir(root)) throw new Error(`Component library folder not found: ${root}`);
      const { entry, folder, index } = await removeEntry(root, args.component);
      const readme = await updateReadme(root, index.components);
      return { removed: entry, deleted: folder, parts: index.components.length, readme, notes: readme ? [] : [README_LATE] };
    },
  });

  defineTool(server, {
    name: 'save-to-library',
    group: 'components',
    bridge: null,
    timeout: 'render',
    description:
      'Saves a composition into the component library as its own part: the composition and everything it uses (nested comps, footage, solids) become <Category>/<Name>/<Name>.aep, footage files are copied into the part\'s footage folder, a poster frame is saved, and library.json and the README table are updated. ' +
      'Use when: a component is finished and worth reusing in other films (a cursor, a button, a card, a rig). Do not use for: a .mogrt for Premiere Pro (export-component-template) or saving the whole project (save-project-as). ' +
      'Inputs: comp (default the active composition); name (default the comp name); category; description, one sentence on what it is and when to use it; tags; source, a short note on where it came from; folder (default AE_MCP_LIBRARY_DIR, created if its parent exists); posterTime or posterFrame (default the middle); overwrite (default false); saveFirst (default false) saves unsaved changes first; reopen (default true). ' +
      'Returns: the library entry (controls with their types, fonts, footage, size, length), the files written, item counts and whether the project was reopened. ' +
      'Notes: the open project must be saved. After Effects holds one project at a time, so the project is closed, imported into a new project, reduced to the composition and saved as the part, then reopened from disk; the original file is never written, but its undo history and open panels reset. Image sequences stay at their original paths. Text keeps its fonts by name, so the fonts must be installed where the part is used. ' +
      'Example: comp {name: "Send Button"}, category "Buttons", description "Round send button with a press state", tags ["chat", "cta"].',
    input: {
      comp: CompRef.optional(),
      name: z.string().min(1).max(80).optional().describe('Part name. Default: the composition name.'),
      category: z.string().min(1).max(60).describe('Category folder, for example "Buttons", "Cursors", "Cards", "Rigs".'),
      description: z.string().min(3).max(400).describe('One sentence: what the part is and when to use it.'),
      tags: z.array(z.string().min(1).max(40)).max(20).optional().describe('Search words.'),
      source: z.string().max(200).optional().describe('Where the part came from, for example the film it was built for.'),
      folder: z.string().min(1).optional().describe('Library folder. Default: AE_MCP_LIBRARY_DIR.'),
      posterTime: z.number().min(0).optional().describe('Poster frame time in seconds. Default: the middle of the composition.'),
      posterFrame: z.number().int().min(0).optional().describe('Poster frame number; wins over posterTime.'),
      overwrite: z.boolean().optional().describe('Replace a part with the same category and name. Default false.'),
      saveFirst: z.boolean().optional().describe('Save unsaved changes to the open project first. Default false (unsaved changes stop the call).'),
      reopen: z.boolean().optional().describe('Reopen the original project afterwards. Default true.'),
    },
    handler: async (args, ctx) => {
      const root = libraryRootForSave(args.folder);
      await readIndex(root);
      const tmp = path.join(os.tmpdir(), `ae-mcp-poster-${process.pid}-${Date.now()}.png`);
      const probe = rec(await ctx.run('libraryPoster', { comp: args.comp, time: args.posterTime, frame: args.posterFrame, outputPath: tmp }, 'render'));
      const component = rec(probe.component);
      const compName = String(component.name ?? '');
      const name = safeName(args.name ?? compName);
      const category = safeName(args.category);
      const folderRel = `${category}/${name}`;
      const partDir = path.join(root, category, name);
      const aepPath = path.join(partDir, `${name}.aep`);
      const fail = (error: string, message: string) => {
        fs.rmSync(tmp, { force: true });
        return jsonResult({ tool: 'save-to-library', error, message }, true);
      };
      if (!probe.projectFile) return fail('invalid-argument', 'Save the project first: save-to-library reads the saved project file, so an untitled project cannot be used.');
      if (probe.dirty !== false && !args.saveFirst) return fail('invalid-argument', 'The open project has unsaved changes. Call save-project first, or pass saveFirst: true. save-to-library closes and reopens the project, so unsaved changes would be lost.');
      if (fs.existsSync(aepPath) && !args.overwrite) return fail('exists', `The library already has ${folderRel}. Pass overwrite: true to replace it, or choose another name.`);

      const notes: string[] = [];
      const createdDir = !isDir(partDir);
      fs.mkdirSync(partDir, { recursive: true });
      let poster: string | null = null;
      const frame = await waitForFrameFile(tmp);
      if (frame) {
        try {
          const background = Array.isArray(probe.background) ? (probe.background as number[]) : undefined;
          poster = path.join(partDir, 'poster.png');
          fs.writeFileSync(poster, scalePngBuffer(frame, undefined, POSTER_WIDTH, background).png);
        } catch (err) {
          poster = null;
          notes.push(`The poster frame could not be read: ${(err as Error).message}`);
        }
      } else notes.push('After Effects did not write the poster frame in time; the part has no poster.');
      fs.rmSync(tmp, { force: true });

      let saved: Record<string, unknown>;
      try {
        saved = rec(
          await ctx.run(
            'saveLibraryComponent',
            { comp: args.comp ?? (typeof component.id === 'number' ? { id: component.id } : undefined), aepPath, footageDir: path.join(partDir, 'footage'), saveFirst: args.saveFirst ?? false, reopen: args.reopen ?? true },
            'render'
          )
        );
      } catch (err) {
        if (createdDir) fs.rmSync(partDir, { recursive: true, force: true });
        throw err;
      }

      const info = rec(saved.component);
      const footage = rec(saved.footage);
      const now = new Date().toISOString();
      const entry: LibraryEntry = {
        name,
        category,
        description: args.description.trim(),
        tags: (args.tags ?? []).map((t) => t.trim()).filter(Boolean),
        comp: String(info.name ?? compName),
        folder: folderRel,
        aep: `${name}.aep`,
        poster: poster ? 'poster.png' : null,
        controls: Array.isArray(saved.controls) ? (saved.controls as Array<Record<string, unknown>>).map((c) => ({ label: String(c.label ?? ''), type: c.type == null ? null : String(c.type) })) : [],
        width: num(info.width),
        height: num(info.height),
        duration: num(info.duration),
        frameRate: num(info.frameRate),
        fonts: Array.isArray(saved.fonts) ? (saved.fonts as Array<Record<string, unknown>>).map((f) => String(f.font ?? '')).filter(Boolean) : [],
        footage: Array.isArray(footage.copied) ? (footage.copied as string[]) : [],
        source: { project: typeof saved.sourceProject === 'string' ? path.basename(saved.sourceProject) : null, comp: compName, ...(args.source ? { note: args.source } : {}) },
        bytes: num(saved.bytes),
        added: now,
        updated: now,
      };
      const index = await upsertEntry(root, entry);
      const readme = await updateReadme(root, index.components);
      if (!readme) notes.push(README_LATE);
      if (Array.isArray(footage.missing) && footage.missing.length) notes.push(`Missing footage stays missing in the part: ${(footage.missing as string[]).join(', ')}.`);
      if (Array.isArray(footage.kept) && footage.kept.length) notes.push('Some footage stays at its original path (image sequences are not copied).');
      if (saved.reopened === false && args.reopen !== false) notes.push('The original project was not reopened; open it with open-project.');
      return {
        entry,
        files: { folder: partDir, aep: aepPath, poster, index: path.join(root, LIBRARY_INDEX), readme },
        counts: saved.counts ?? null,
        footage,
        fonts: saved.fonts ?? [],
        reopened: saved.reopened ?? false,
        parts: index.components.length,
        notes,
      };
    },
  });
}
