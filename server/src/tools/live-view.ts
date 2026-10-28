/*
 * Live view tools, backed by the AE MCP Live View plug-in (native/live-view).
 *
 * The plug-in runs inside After Effects and keeps the active composition's current frame in
 * <bridge>/live/latest.jpg, with latest.json describing it and status.json as its heartbeat.
 * These tools only read and write files: no bridge command, no undo entry, and they work while
 * the panel is busy or another script is running.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { defineTool, jsonResult, lastChangeAt } from './registry.js';

/** status.json is rewritten every 2 s while AE is idle; older than this means AE is busy, closed or the plug-in missing. */
const STATUS_STALE_MS = 10000;

export interface LiveOptions {
  enabled: boolean;
  scale: 1 | 2 | 4;
  maxFps: number;
  budgetMs: number;
  settleMs: number;
  quality: number;
}

export const LIVE_DEFAULTS: LiveOptions = { enabled: true, scale: 2, maxFps: 4, budgetMs: 400, settleMs: 250, quality: 80 };

export function livePaths(bridgeDir: string) {
  const dir = path.join(bridgeDir, 'live');
  return {
    dir,
    image: path.join(dir, 'latest.jpg'),
    meta: path.join(dir, 'latest.json'),
    status: path.join(dir, 'status.json'),
    options: path.join(dir, 'options.json'),
  };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readLiveOptions(bridgeDir: string): LiveOptions {
  const raw = readJson(livePaths(bridgeDir).options) ?? {};
  return { ...LIVE_DEFAULTS, ...raw } as LiveOptions;
}

/** Plug-in state from status.json: 'missing', 'stale' (AE busy or closed), 'off' or 'on'. */
export function liveState(bridgeDir: string, now = Date.now()): { state: 'missing' | 'stale' | 'off' | 'on'; status: Record<string, unknown> | null; ageMs: number | null } {
  const p = livePaths(bridgeDir);
  if (!fs.existsSync(p.status)) return { state: 'missing', status: null, ageMs: null };
  const status = readJson(p.status);
  const ageMs = Math.max(0, now - fs.statSync(p.status).mtimeMs);
  if (ageMs > STATUS_STALE_MS) return { state: 'stale', status, ageMs };
  return { state: status?.enabled === false ? 'off' : 'on', status, ageMs };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOT_RUNNING_HELP =
  'The AE MCP Live View plug-in is not running. Install "AE MCP Live View.plugin" (macOS) or "AE MCP Live View.aex" (Windows) into the After Effects Plug-ins folder or the shared MediaCore folder and restart After Effects. Until then use see-frame.';

export function registerLiveViewTools(server: McpServer): void {
  defineTool(server, {
    name: 'see-live',
    group: 'render',
    bridge: null,
    mutating: false,
    description:
      'Returns the current picture of the active composition as kept by the AE MCP Live View plug-in, the same frame the human sees at the playhead. It costs After Effects nothing: the plug-in draws the picture whenever the comp settles after a change, and this tool only reads the file. ' +
      'Use when: glancing at what the human is working on, checking the result of a change without moving the playhead, or watching the comp while another script runs. Do not use for: a specific time other than the playhead, or exact full-resolution checks (see-frame). ' +
      'Inputs: waitMs (default 1500) waits up to this long for a picture drawn after the last change made through this server, and for the full-size picture when only the quick small one is ready; includeInfo (default true). ' +
      'Returns: a JPEG image content block plus text with comp, time, frame, size, scale, final (false = only the quick picture), renderMs, ageSeconds and afterLastChange (false, with a note, when no newer picture came in time). ' +
      'Notes: needs the plug-in installed and enabled (live-view-settings). Pictures are half size by default. A frame whose full-size render would take longer than budgetMs stays at the quick size. ' +
      'Example: after a batch that restyles a title, see-live to confirm the look at the current time.',
    input: {
      waitMs: z.number().int().min(0).max(10000).optional().describe('Wait up to this long for the full-size picture. Default 1500.'),
      includeInfo: z.boolean().optional().describe('Add a JSON text block describing the picture. Default true.'),
    },
    handler: async (args, ctx) => {
      const root = ctx.bridge.paths.root;
      const p = livePaths(root);
      const st = liveState(root);
      if (st.state === 'missing') return jsonResult({ error: NOT_RUNNING_HELP, code: 'live-view-missing' }, true);
      if (st.state === 'off') return jsonResult({ error: 'Live view is switched off. Turn it on with live-view-settings { enabled: true }.', code: 'live-view-off' }, true);

      const deadline = Date.now() + (args.waitMs ?? 1500);
      const changedAt = lastChangeAt();
      const drawnAt = () => {
        try {
          return fs.statSync(p.image).mtimeMs;
        } catch {
          return 0;
        }
      };
      let meta = readJson(p.meta);
      while (meta && (meta.final === false || drawnAt() < changedAt) && Date.now() < deadline) {
        await sleep(100);
        meta = readJson(p.meta) ?? meta;
      }
      if (!meta || !fs.existsSync(p.image)) {
        return jsonResult({ error: 'No live picture yet. Make a composition active in After Effects; the first picture appears a moment after it settles.', code: 'live-view-empty' }, true);
      }
      const image = fs.readFileSync(p.image);
      const ageSeconds = Math.round((Date.now() - fs.statSync(p.image).mtimeMs) / 100) / 10;
      const info = {
        comp: meta.comp,
        time: meta.time,
        frame: meta.frame,
        width: meta.width,
        height: meta.height,
        scale: meta.scale,
        final: meta.final !== false,
        renderMs: meta.renderMs,
        ageSeconds,
        afterLastChange: drawnAt() >= changedAt,
        ...(drawnAt() < changedAt
          ? { note: 'This picture is older than the last change made through this server: After Effects draws a new one once the comp settles, or the change did not touch the active comp at the playhead. Call see-live again in a moment, or use see-frame.' }
          : {}),
        plugin: st.state === 'stale'
          ? `status ${Math.round((st.ageMs ?? 0) / 1000)} s old: After Effects is busy or closed, so this picture may be out of date`
          : 'running',
      };
      const content: CallToolResult['content'] = [{ type: 'image', data: image.toString('base64'), mimeType: 'image/jpeg' }];
      if (args.includeInfo !== false) content.push({ type: 'text', text: JSON.stringify(info, null, 2) });
      return { content } as CallToolResult;
    },
  });

  defineTool(server, {
    name: 'live-view-settings',
    group: 'render',
    bridge: null,
    mutating: false,
    description:
      'Reads or changes the AE MCP Live View plug-in settings and reports whether it is running. ' +
      'Use when: see-live says live view is off, a picture is too small or too slow, or the human wants live view paused while they work. ' +
      'Inputs (all optional; none = read only): enabled; scale 1, 2 or 4 (full, half, quarter size of the full-size picture); maxFps (0.2 to 30, new pictures per second); budgetMs (50 to 1500: a full-size frame expected to take longer stays at the quick size, which keeps After Effects responsive); settleMs (0 to 5000: wait this long after the last change, so nothing is drawn during playback); quality (JPEG, 30 to 95). ' +
      'Returns: the settings now in effect, the plug-in state (on, off, stale = After Effects busy or closed, missing = not installed) and its last status. ' +
      'Notes: the plug-in re-reads the file every 2 seconds. Example: { scale: 1 } for full-size pictures of a small comp.',
    input: {
      enabled: z.boolean().optional().describe('Turn live view on or off.'),
      scale: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional().describe('Size of the full picture: 1 full, 2 half, 4 quarter. Default 2.'),
      maxFps: z.number().min(0.2).max(30).optional().describe('At most this many new pictures per second. Default 4.'),
      budgetMs: z.number().min(50).max(1500).optional().describe('A full-size frame expected to take longer stays at the quick size. Default 400.'),
      settleMs: z.number().min(0).max(5000).optional().describe('Wait this long after the last change before drawing. Default 250.'),
      quality: z.number().int().min(30).max(95).optional().describe('JPEG quality. Default 80.'),
    },
    handler: async (args, ctx) => {
      const root = ctx.bridge.paths.root;
      const p = livePaths(root);
      const changes = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      const options = { ...readLiveOptions(root), ...changes };
      if (Object.keys(changes).length > 0) {
        fs.mkdirSync(p.dir, { recursive: true });
        const tmp = `${p.options}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(options, null, 2));
        fs.renameSync(tmp, p.options);
      }
      const st = liveState(root);
      return {
        options,
        changed: Object.keys(changes),
        plugin: st.state,
        help: st.state === 'missing' ? NOT_RUNNING_HELP : undefined,
        status: st.status,
      };
    },
  });
}
