/*
 * Tool packs. A client sees a small core of everyday tools; every other tool
 * group is a pack the agent switches on when a job needs it (tool-packs), so
 * the tool list stays small. AE_MCP_TOOLS picks what is on at start:
 * "core" (default), "all", or core plus a comma list of packs.
 * call-tool runs any tool by name, on or off, for clients that do not reload
 * their tool list when it changes.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { z } from 'zod';
import { catalog, defineTool, findTool, invokeTool, isToolEnabled, jsonResult, setToolsEnabled, type ToolGroup } from './registry.js';

/** Always on: build, inspect, animate, verify. The general tool of each family (delete-layers, set-keyframes-bulk, set-effect-properties). */
export const CORE_TOOLS = [
  'get-help', 'list-tools', 'tool-packs', 'call-tool',
  'batch', 'undo', 'get-bridge-status', 'get-ae-status',
  'get-project-info', 'list-project-items', 'save-project', 'open-project', 'import-file',
  'create-composition', 'list-compositions', 'get-composition-info', 'set-composition-settings', 'precompose',
  'list-layers', 'get-layer-details', 'create-solid-layer', 'create-null-layer', 'add-footage-to-composition', 'add-composition-as-layer',
  'duplicate-layer', 'delete-layers', 'move-layer', 'set-layer-parent', 'set-layer-timing', 'set-layer-flags',
  'get-property-value', 'set-property-value', 'set-transform',
  'set-keyframes-bulk', 'get-keyframes', 'set-keyframe-easing', 'clear-keyframes',
  'set-expression', 'get-expression-errors', 'add-expression-control', 'apply-expression-preset',
  'create-text-layer', 'set-text', 'set-text-style', 'add-text-animator',
  'create-shape-layer', 'set-shape-fill', 'set-shape-stroke',
  'apply-effect', 'set-effect-properties', 'list-layer-effects', 'apply-effect-template',
  'animate-property', 'add-entrance', 'add-exit', 'typewriter-text',
  'see-frame', 'see-frames', 'see-live',
  'audit-composition', 'save-version', 'purge-caches',
] as const;

/** One line per pack (a tool group), shown by tool-packs. */
export const PACK_SUMMARIES: Record<ToolGroup, string> = {
  project: 'new, save as, import many, folders, replace footage, reduce and collect',
  composition: 'duplicate, rename, delete, work area, current time, crop',
  layers: 'adjustment, camera and light layers, rename, order, blend modes, mattes, labels, quality, split, align, distribute, sequence, select',
  transform: 'anchor point, fit to the comp, layer bounds, separate dimensions',
  keyframes: 'single and multi keys, delete, move, copy, reverse, interpolation, bake expressions, stagger across layers',
  expressions: 'read, remove, switch expressions on and off, list presets',
  text: 'read text, fonts, animator presets, selectors, text to shapes, box text, text on a path, 3D letters, boxes behind text, fit to a box',
  shapes: 'add shapes, paths, modifiers, trim paths, repeaters, SVG and Illustrator import, gradients, SVG path data',
  masks: 'masks, mask paths, masks from shapes, mask reveals',
  effects: 'bulk effects, effect lists, keyframes, remove, reorder, switch, copy, templates',
  presets: '.ffx animation presets: list, search, apply, save',
  'camera-3d': 'cameras, camera moves, lights, 3D layers, materials, look at, Advanced 3D, extrusion, environment light',
  time: 'time remap, freeze, speed, reverse, frame blending, loops',
  'markers-audio': 'markers, audio levels, waveform analysis, audio to keyframes, beat markers',
  render: 'PNG frames and still sequences, render queue, aerender, templates',
  batch: 'snapshots, find layers, find and replace text and colours, relink fonts, redo, results, raw ExtendScript',
  rigs: 'the four studio rigs: edge glow, power warp transition, depth map blur reveal, blur colour reveal',
  guard: 'panel reload and re-arm, closing After Effects dialogs',
  components: 'components with Essential Properties, instances, responsive time, .mogrt export, component library',
  animate: 'word-by-word reveal, button press, move along a path, replay at markers, camera push',
  styles: 'layer styles: shadows, glows, bevel, satin, overlays, stroke',
  check: 'sort the project into folders',
  scenes: 'scene plans with a master comp, retime, insert and remove scenes, reference overlays',
  transitions: 'match cut, push, whip, zoom-through, mask reveal, carry an element across a cut',
  'ui-demo': 'cursor journeys with clicks, scroll in a window, focus on a region, device frames, highlights, toasts',
  'motion-rigs': 'number counter, grid and bento layout, proximity effector, follow chain, clone array, shape morph, wiggle, sway, fit to a box',
  charts: 'bar, line and pie charts, stat with sparkline, progress bar and ring, animated data changes',
  looks: 'named finishes (glow, bloom, grain, vignette, light sweep, frosted glass, soft shadow, motion blur) and looping backgrounds (mesh gradient, aurora, grid, dots, noise)',
  help: 'guide, tool list, packs',
};

const CORE = new Set<string>(CORE_TOOLS);
let enabledPacks = new Set<ToolGroup>();

export function packNames(): ToolGroup[] {
  return (Object.keys(PACK_SUMMARIES) as ToolGroup[]).filter((g) => g !== 'help');
}

/** Parses AE_MCP_TOOLS: "core" or empty, "all", or a comma list of pack names. Unknown names are returned, not thrown. */
export function parseToolSelection(spec: string | undefined): { packs: ToolGroup[]; unknown: string[] } {
  const words = (spec ?? '').split(/[\s,]+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (words.includes('all')) return { packs: packNames(), unknown: [] };
  const known = new Set<string>(packNames());
  return {
    packs: words.filter((w) => known.has(w)) as ToolGroup[],
    unknown: words.filter((w) => w !== 'core' && !known.has(w)),
  };
}

/** Switches every tool on or off from the core list and the enabled packs. Sends one list-changed notice when connected. */
export function applyPacks(server: McpServer, packs: Iterable<ToolGroup>): void {
  enabledPacks = new Set(packs);
  const on: string[] = [];
  const off: string[] = [];
  for (const entry of catalog) (CORE.has(entry.name) || enabledPacks.has(entry.group) ? on : off).push(entry.name);
  setToolsEnabled(server, on, true);
  setToolsEnabled(server, off, false);
}

function packList() {
  return packNames().map((name) => {
    const tools = catalog.filter((c) => c.group === name && !CORE.has(c.name)).map((c) => c.name);
    return { name, enabled: enabledPacks.has(name), tools: tools.length, summary: PACK_SUMMARIES[name], names: tools };
  });
}

function activeCount(): number {
  return catalog.filter((c) => isToolEnabled(c.name)).length;
}

export function registerPackTools(server: McpServer): void {
  const packEnum = z.string().describe('A pack name from tool-packs, or "all".');

  defineTool(server, {
    name: 'tool-packs',
    group: 'help',
    mutating: false,
    bridge: null,
    description:
      'Lists the tool packs and switches them on or off. The core tools are always on; the rest come in packs (charts, ui-demo, scenes, transitions, motion-rigs, components, camera-3d, masks, styles and more). ' +
      'Use when: a job needs tools outside the core, for example charts or a cursor journey. Call it with no arguments to see the packs. ' +
      'Returns: the packs with their tools and whether each is on, and how many tools are active. ' +
      'Notes: switching sends a tool-list change to the client. If the new tools do not show up, run them with call-tool (list-tools with schema true shows their inputs).',
    input: {
      enable: z.array(packEnum).max(30).optional().describe('Packs to switch on, or ["all"].'),
      disable: z.array(packEnum).max(30).optional().describe('Packs to switch off, or ["all"]. Core tools stay on.'),
    },
    handler: async (args) => {
      const next = new Set(enabledPacks);
      const unknown: string[] = [];
      const take = (list: string[] | undefined, add: boolean) => {
        const parsed = parseToolSelection((list ?? []).join(','));
        unknown.push(...parsed.unknown.filter((u) => u !== 'core'));
        for (const p of parsed.packs) (add ? next.add(p) : next.delete(p));
      };
      take(args.disable, false);
      take(args.enable, true);
      if (unknown.length) {
        return jsonResult({ tool: 'tool-packs', error: 'unknown-pack', message: `Unknown pack: ${unknown.join(', ')}. Packs: ${packNames().join(', ')}.` }, true);
      }
      const changed = (args.enable?.length ?? 0) + (args.disable?.length ?? 0) > 0;
      if (changed) applyPacks(server, next);
      return {
        active: activeCount(),
        total: catalog.length,
        core: CORE_TOOLS.length,
        enabled: [...enabledPacks],
        packs: packList(),
        note: changed ? 'The tool list changed. If the new tools are not listed by your client, call them with call-tool.' : undefined,
      };
    },
  });

  defineTool(server, {
    name: 'call-tool',
    group: 'help',
    bridge: null,
    timeout: 'render',
    description:
      'Runs any tool of this server by name with its arguments, whether its pack is on or off, and returns exactly what that tool returns. ' +
      'Use when: a tool from a pack is not in your tool list (the client did not reload after tool-packs). Do not use for: tools you can call directly. ' +
      'Returns: that tool\'s own result. Notes: list-tools with schema true shows a tool\'s inputs. Example: tool "create-bar-chart", args {data: [{label: "Q1", value: 42}]}.',
    input: {
      tool: z.string().describe('Tool name, for example "create-bar-chart".'),
      args: z.record(z.unknown()).optional().describe('Arguments for that tool.'),
    },
    handler: async (args) => {
      if (args.tool === 'call-tool') return jsonResult({ tool: 'call-tool', error: 'invalid-argument', message: 'call-tool cannot call itself.' }, true);
      if (!findTool(args.tool)) return jsonResult({ tool: 'call-tool', error: 'not-found', message: `No tool named "${args.tool}". Use list-tools to see the names.` }, true);
      return invokeTool(args.tool, args.args ?? {});
    },
  });
}

/** JSON Schema of a tool's input, as clients see it. */
export function inputJsonSchema(name: string): unknown {
  const entry = findTool(name);
  return entry ? toJsonSchemaCompat(z.object(entry.input), { strictUnions: true, pipeStrategy: 'input' }) : undefined;
}
