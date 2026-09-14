/*
 * Animation presets (.ffx): listing and searching on disk, applying and saving through the bridge.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { CompRef, LayerRef } from '../schemas/common.js';
import { EffectRef } from './effects.js';
import { defineTool } from './registry.js';

export interface PresetFile {
  path: string;
  name: string;
  directory: string;
  size: number;
  modifiedAt: string;
}

export function uniqueExistingDirs(candidates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of candidates) {
    if (!p) continue;
    const n = path.normalize(p);
    if (seen.has(n)) continue;
    try {
      if (fs.statSync(n).isDirectory()) {
        seen.add(n);
        out.push(n);
      }
    } catch {
      // missing
    }
  }
  return out;
}

export function defaultPresetRoots(): string[] {
  const home = os.homedir();
  const roots: string[] = [
    path.join(home, 'Documents', 'Adobe', 'After Effects User Presets'),
    path.join(home, 'Documents', 'Adobe'),
  ];
  if (process.platform === 'darwin') {
    try {
      for (const entry of fs.readdirSync('/Applications')) {
        if (/^Adobe After Effects/.test(entry)) roots.push(path.join('/Applications', entry, 'Presets'));
      }
    } catch {
      // no /Applications
    }
  } else if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const adobe = path.join(programFiles, 'Adobe');
    try {
      for (const entry of fs.readdirSync(adobe)) {
        if (/^Adobe After Effects/.test(entry)) roots.push(path.join(adobe, entry, 'Support Files', 'Presets'));
      }
    } catch {
      // none
    }
    if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'Adobe', 'After Effects'));
  }
  return uniqueExistingDirs(roots);
}

export function collectPresetFiles(roots: string[], recursive: boolean, query: string | undefined, maxResults: number, maxDepth: number): PresetFile[] {
  const out: PresetFile[] = [];
  const q = query ? query.toLowerCase() : '';
  const walk = (dir: string, depth: number) => {
    if (out.length >= maxResults || depth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxResults) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.ffx')) continue;
      if (q && !entry.name.toLowerCase().includes(q) && !full.toLowerCase().includes(q)) continue;
      try {
        const st = fs.statSync(full);
        out.push({ path: full, name: entry.name, directory: dir, size: st.size, modifiedAt: st.mtime.toISOString() });
      } catch {
        // skip
      }
    }
  };
  for (const root of roots) {
    if (out.length >= maxResults) break;
    walk(root, 0);
  }
  return out;
}

const PresetSearchArgs = {
  presetRoots: z.array(z.string()).optional().describe('Folders to search. Default: the After Effects Presets folder and the user presets folder.'),
  recursive: z.boolean().optional().describe('Search subfolders. Default true.'),
  maxResults: z.number().int().positive().max(5000).optional(),
  maxDepth: z.number().int().positive().max(25).optional(),
};

export function registerPresetTools(server: McpServer): void {
  defineTool(server, {
    name: 'list-presets',
    group: 'presets',
    mutating: false,
    bridge: null,
    description:
      'Lists animation preset files (.ffx) found in the After Effects Presets folder, the user presets folder, or folders you name, with full paths for apply-preset. Runs on the server, so After Effects need not respond. ' +
      'Use when: browsing what ships with After Effects (Text > Animate In, Backgrounds, Transitions) or the user\'s own presets. Do not use for: searching by name (search-presets) or built-in effect looks (list-effect-templates). ' +
      'Inputs: presetRoots[] (optional), recursive (default true), maxResults (default 500), maxDepth (default 10). ' +
      'Returns: searchedRoots, resultCount, presets[] with path, name, directory, size, modifiedAt. ' +
      'Notes: read-only. Mac and Windows install folders are both searched. ' +
      'Example: list-presets with presetRoots ["/Applications/Adobe After Effects 2025/Presets/Text"].',
    input: { ...PresetSearchArgs },
    handler: async (args) => {
      const roots = uniqueExistingDirs(args.presetRoots && args.presetRoots.length ? args.presetRoots : defaultPresetRoots());
      const presets = collectPresetFiles(roots, args.recursive ?? true, undefined, args.maxResults ?? 500, args.maxDepth ?? 10);
      return { searchedRoots: roots, resultCount: presets.length, presets };
    },
  });

  defineTool(server, {
    name: 'search-presets',
    group: 'presets',
    mutating: false,
    bridge: null,
    description:
      'Searches animation preset files (.ffx) by a word in the file name or folder path and returns full paths for apply-preset. Runs on the server. ' +
      'Use when: the human asks for a named preset ("Typewriter", "Fade Up Characters", "Rain"). Do not use for: listing everything (list-presets). ' +
      'Inputs: query; presetRoots[] (optional); recursive (default true); maxResults (default 200); maxDepth (default 10). ' +
      'Returns: query, searchedRoots, resultCount, presets[]. ' +
      'Notes: read-only, case-insensitive. ' +
      'Example: query "typewriter" then apply-preset with the returned path.',
    input: { query: z.string().min(1), ...PresetSearchArgs },
    handler: async (args) => {
      const roots = uniqueExistingDirs(args.presetRoots && args.presetRoots.length ? args.presetRoots : defaultPresetRoots());
      const presets = collectPresetFiles(roots, args.recursive ?? true, args.query, args.maxResults ?? 200, args.maxDepth ?? 10);
      return { query: args.query, searchedRoots: roots, resultCount: presets.length, presets };
    },
  });

  defineTool(server, {
    name: 'apply-preset',
    group: 'presets',
    description:
      'Applies an animation preset file (.ffx) to a layer, the same as Animation > Apply Animation Preset. Presets can add effects, keyframes, expressions and text animators. ' +
      'Use when: using After Effects\' shipped presets or the studio\'s own. Do not use for: built-in looks (apply-effect-template) or single effects (apply-effect). ' +
      'Inputs: layer; presetPath, an absolute path from list-presets or search-presets. ' +
      'Returns: the layer summary and the effects that were added by the preset. ' +
      'Notes: text presets need a text layer. Keyframes inside the preset land at the current time indicator; call set-current-time first if it matters. Undoable in one step. ' +
      'Example: presetPath "/Applications/Adobe After Effects 2025/Presets/Text/Animate In/Typewriter.ffx".',
    input: { comp: CompRef.optional(), layer: LayerRef, presetPath: z.string().min(1).describe('Absolute path to the .ffx file.') },
  });

  defineTool(server, {
    name: 'save-preset',
    group: 'presets',
    mutating: false,
    description:
      'Saves the effects on a layer (all, or the ones named) as an animation preset file (.ffx) so they can be reused with apply-preset. ' +
      'Use when: a look is finished and the human wants it in their preset library. Do not use for: copying to other layers in the same project (copy-effects). ' +
      'Inputs: layer; outputPath (an .ffx path, folders are created); effects[] to save a subset. ' +
      'Returns: the preset path and how many effects it holds. ' +
      'Notes: saving presets by script is only available in some After Effects versions; when unsupported the error says to use Animation > Save Animation Preset. Does not change the project. ' +
      'Example: layer {name: "Title"}, outputPath "~/Documents/Adobe/After Effects User Presets/Title Glow.ffx".',
    input: { comp: CompRef.optional(), layer: LayerRef, outputPath: z.string().min(1), effects: z.array(EffectRef).optional() },
    toBridgeArgs: (args) => ({ ...args, outputPath: args.outputPath.replace(/^~(?=$|\/|\\)/, os.homedir()) }),
  });
}
