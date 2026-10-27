/*
 * AE guard tools: status from outside After Effects, re-arming or hot-reloading
 * the bridge panel, and (when enabled) closing a blocking dialog without
 * stealing focus. See src/guard/guard.ts for the states.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { BridgeError } from '../bridge/types.js';
import { runDoScript } from '../guard/doscript.js';
import { acquireLock, LockBusyError, releaseLock } from '../guard/lock.js';
import { dismissAllowed, dismissDialog, findAfterEffects } from '../guard/system.js';
import { defineTool } from './registry.js';
import type { ToolContext } from './registry.js';

function needGuard(ctx: ToolContext, command: string) {
  const guard = ctx.bridge.guard;
  if (!guard) throw new BridgeError('disabled', 'The AE guard is off (it runs on macOS only, and AE_MCP_GUARD=0 turns it off).', { command });
  return guard;
}

async function withLock<T>(ctx: ToolContext, command: string, fn: () => Promise<T>): Promise<T> {
  try {
    await acquireLock(ctx.bridge.paths.root, { owner: process.env.AE_MCP_OWNER ?? `MCP server ${process.pid}`, purpose: command, waitMs: 30000 });
  } catch (err) {
    if (err instanceof LockBusyError) throw new BridgeError('ae-busy', err.message, { command });
    throw err;
  }
  try {
    return await fn();
  } finally {
    releaseLock(ctx.bridge.paths.root);
  }
}

/** The installed panel file of the running After Effects. */
export function installedPanelPath(appPath: string | null): string | null {
  if (!appPath) return null;
  const file = path.join(path.dirname(appPath), 'Scripts', 'ScriptUI Panels', 'mcp-bridge-auto.jsx');
  return fs.existsSync(file) ? file : null;
}

/**
 * ExtendScript that swaps the running panel's code for the file's, inside the same docked panel.
 * The file is evaluated by a one-shot app.scheduleTask, because scheduled tasks run at global
 * scope: $.evalFile called inside a function (as every DoScript wrapper is) would define MCP as
 * a local variable, and the panel's timer ("MCP.tick()") would keep calling the old code.
 */
export function hotReloadSource(panelFile: string): string {
  return `(function () {
  var f = new File(${JSON.stringify(panelFile)});
  if (!f.exists) { return "ERR panel file not found"; }
  var host = null;
  try { if (typeof MCP !== "undefined" && MCP.ui && MCP.ui.win) { host = MCP.ui.win; } } catch (e0) {}
  try { if (typeof MCP !== "undefined" && MCP.state && MCP.state.taskId !== null) { app.cancelTask(MCP.state.taskId); } } catch (e1) {}
  if (host) { while (host.children.length) { host.remove(host.children[0]); } }
  MCP_RELOAD_HOST = host;
  MCP_RELOAD_FILE = f;
  app.scheduleTask("$.evalFile(MCP_RELOAD_FILE, 60000); MCP_RELOAD_FILE = null;", 50, false);
  return "SCHEDULED" + (host ? " (same panel)" : " (new window)");
})();`;
}

export const REARM_SOURCE = `(function () {
  if (typeof MCP === "undefined" || !MCP.reschedule) { return "ERR the bridge panel is not loaded"; }
  MCP.reschedule();
  try { MCP.writeHeartbeat(true); } catch (e) {}
  return "OK";
})();`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function registerGuardTools(server: McpServer): void {
  defineTool(server, {
    name: 'get-ae-status',
    group: 'guard',
    mutating: false,
    bridge: null,
    description:
      'Reports what After Effects is doing, read from outside it, so it works even when After Effects is stuck: not-running, dialog (with its text and buttons), running-command, running-script, busy, idle, paused, panel-stalled or panel-closed; plus its memory footprint, swap, free disk, the driver lock holder, recent DoScript runs and advice. ' +
      'Use when: a tool timed out or failed with dialog-open, panel-not-running or ae-busy; before a long unattended build; or to see whether another chat is driving After Effects. ' +
      'Do not use for: project contents (use get-project-info). ' +
      'Inputs: deep (default false) also samples After Effects\' main thread for about 3 seconds, which tells a modal dialog from a running script even when the dialog is on another desktop. ' +
      'Returns: state, summary, ae {pid, app, uptimeMin}, memory {aeFootprintGB, swapUsedGB, swapTotalGB, diskFreeGB}, panel {heartbeatAgeMs, fresh, version, state, running, autoRun, pollMs, project}, lock, external {running, recent}, dialogs, windowScan, mainThread, advice. ' +
      'Notes: never sends anything to After Effects and never takes focus. macOS only. ' +
      'Example: a build call failed with dialog-open; call get-ae-status with deep true to read the dialog text.',
    input: { deep: z.boolean().optional().describe('Also sample the main thread (about 3 s). Default false.') },
    handler: async (args, ctx) => {
      const guard = ctx.bridge.guard;
      if (!guard) {
        const hb = ctx.bridge.readHeartbeat();
        return { state: 'unknown', summary: 'The AE guard is off (macOS only; AE_MCP_GUARD=0 disables it). Heartbeat only.', heartbeat: hb ?? null };
      }
      return guard.status(ctx.bridge, { deep: args.deep ?? false });
    },
  });

  defineTool(server, {
    name: 'rearm-bridge-panel',
    group: 'guard',
    mutating: false,
    bridge: null,
    description:
      'Restarts the bridge panel\'s polling timer inside After Effects when it has stopped (state panel-stalled: After Effects is idle, the panel is open, but its heartbeat is old; this happens after a project is opened). ' +
      'Use when: get-ae-status says panel-stalled, or a tool failed with panel-not-running and the panel is open. ' +
      'Do not use for: a closed panel (open Window > mcp-bridge-auto.jsx) or a dialog (close it first). ' +
      'Inputs: force (default false) re-arms even when the state is not panel-stalled. ' +
      'Returns: before and after states and the new heartbeat age. ' +
      'Notes: sends one tiny script to After Effects through AppleScript, without activating it, under the driver lock, and only after checking that no dialog or script is running. ' +
      'Example: after opening a project by script, call rearm-bridge-panel, then ping.',
    input: { force: z.boolean().optional().describe('Re-arm even if the panel does not look stalled.') },
    handler: async (args, ctx) => {
      const guard = needGuard(ctx, 'rearmBridgePanel');
      const before = await guard.status(ctx.bridge, { deep: true });
      if (!args.force && before.state !== 'panel-stalled') {
        return { rearmed: false, state: before.state, summary: before.summary, message: 'Not re-armed: the panel is not stalled. Pass force to do it anyway.' };
      }
      if (['dialog', 'running-script', 'running-command', 'not-running'].includes(before.state)) {
        throw new BridgeError('panel-not-running', `Cannot re-arm now: ${before.summary}`, { command: 'rearmBridgePanel' });
      }
      const res = await withLock(ctx, 'rearm-bridge-panel', () => runDoScript(REARM_SOURCE, { bridgeDir: ctx.bridge.paths.root, label: 'rearm bridge panel', timeoutMs: 30000 }));
      await sleep(1500);
      const after = await guard.status(ctx.bridge);
      return { rearmed: res.ok && res.returned === 'OK', returned: res.returned, message: res.message ?? null, before: before.state, after: after.state, heartbeatAgeMs: after.panel.heartbeatAgeMs };
    },
  });

  defineTool(server, {
    name: 'reload-bridge-panel',
    group: 'guard',
    mutating: false,
    bridge: null,
    description:
      'Loads the newly installed bridge panel code into the open panel without closing it, restarting After Effects or touching the mouse: it stops the old timer, clears the old controls and evaluates the installed mcp-bridge-auto.jsx into the same docked panel. ' +
      'Use when: after npm run build and installing the panel (install-bridge), so After Effects runs the new version; get-bridge-status shows versionsMatch false. ' +
      'Do not use for: opening a panel that is not open (use Window > mcp-bridge-auto.jsx). ' +
      'Inputs: file (optional) panel file to load; default the installed one of the running After Effects. force (default false) reloads even when After Effects is not idle. ' +
      'Returns: what the script returned (OK <version>), and the new heartbeat version. ' +
      'Notes: under the driver lock, refused while a command, script or dialog is active. ' +
      'Example: after installing 2.1.0, call reload-bridge-panel and check that bridgeVersion is 2.1.0.',
    input: {
      file: z.string().optional().describe('Absolute path of the panel .jsx to load.'),
      force: z.boolean().optional().describe('Reload even if After Effects is not idle.'),
    },
    handler: async (args, ctx) => {
      const guard = needGuard(ctx, 'reloadBridgePanel');
      const ae = await findAfterEffects();
      if (!ae) throw new BridgeError('ae-not-running', 'After Effects is not running.', { command: 'reloadBridgePanel' });
      const file = args.file ?? installedPanelPath(ae.appPath);
      if (!file || !fs.existsSync(file)) throw new BridgeError('invalid-result', `Panel file not found${file ? `: ${file}` : ''}. Install it first.`, { command: 'reloadBridgePanel' });
      const before = await guard.status(ctx.bridge, { deep: true });
      if (!args.force && !['idle', 'paused', 'panel-stalled'].includes(before.state)) {
        throw new BridgeError('ae-busy', `Not reloading now: ${before.summary}`, { command: 'reloadBridgePanel' });
      }
      const startedAt = Date.now();
      const res = await withLock(ctx, 'reload-bridge-panel', () => runDoScript(hotReloadSource(file), { bridgeDir: ctx.bridge.paths.root, label: 'reload bridge panel', timeoutMs: 90000 }));
      // The new code loads from a scheduled task once the script returns; wait for its first heartbeat.
      let hb = ctx.bridge.readHeartbeat();
      for (let i = 0; i < 40 && res.ok; i++) {
        hb = ctx.bridge.readHeartbeat();
        if (hb && hb.panelStartedAt && Date.parse(hb.panelStartedAt) >= startedAt - 1000) break;
        await sleep(250);
      }
      const fresh = !!(hb && hb.panelStartedAt && Date.parse(hb.panelStartedAt) >= startedAt - 1000);
      return { reloaded: res.ok && fresh, returned: res.returned, message: res.message ?? null, file, bridgeVersion: hb?.bridgeVersion ?? null, panelStartedAt: hb?.panelStartedAt ?? null, heartbeatAgeMs: hb ? Date.now() - Date.parse(hb.at) : null };
    },
  });

  defineTool(server, {
    name: 'dismiss-ae-dialog',
    group: 'guard',
    mutating: true,
    bridge: null,
    description:
      'Closes a modal dialog that blocks After Effects, without activating it or moving the mouse: presses a named button through Accessibility, or posts Escape to the After Effects process only. Refuses when After Effects is the front app (the dialog may be the human\'s), and never presses Reset, Safe Mode, Disable, Don\'t Save, Delete, Quit, Remove, Replace, Revert or Discard. ' +
      'Use when: get-ae-status says dialog and the dialog is one a script caused (script error, warning, Crash Repair "Continue"). ' +
      'Do not use for: anything when unsure what the dialog is; read it with get-ae-status first. ' +
      'Inputs: button (optional) exact button title to press, otherwise Escape (cancel); evenIfFront (default false). ' +
      'Returns: what was done, the front app before and after (they must match), and the state afterwards. ' +
      'Notes: off unless AE_MCP_ALLOW_DIALOG_DISMISS=1 or guard-options.json in the bridge folder has {"allowDialogDismiss": true}. When on, the guard also closes plain message boxes by itself before and during commands. Needs Accessibility permission for the app that runs the server. ' +
      'Example: a script error alert blocks the queue; call dismiss-ae-dialog with no button.',
    input: {
      button: z.string().optional().describe('Exact title of the button to press, e.g. "OK" or "Continue".'),
      evenIfFront: z.boolean().optional().describe('Act even when After Effects is the front app. Default false.'),
    },
    handler: async (args, ctx) => {
      const guard = needGuard(ctx, 'dismissAeDialog');
      if (!dismissAllowed(ctx.bridge.paths.root)) {
        throw new BridgeError('disabled', 'dismiss-ae-dialog is off. Enable it with AE_MCP_ALLOW_DIALOG_DISMISS=1 or {"allowDialogDismiss": true} in guard-options.json in the bridge folder.', { command: 'dismissAeDialog' });
      }
      const before = await guard.status(ctx.bridge, { deep: true });
      if (before.state !== 'dialog' || !before.ae) {
        return { dismissed: false, state: before.state, summary: before.summary, message: 'No dialog to dismiss.' };
      }
      const res = await dismissDialog(before.ae.pid, { button: args.button, allowFront: args.evenIfFront ?? false });
      await sleep(1000);
      const after = await guard.status(ctx.bridge, { deep: true });
      return { dismissed: res.ok && after.state !== 'dialog', action: res, before: before.summary, after: after.state, afterSummary: after.summary };
    },
  });
}
