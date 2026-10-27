/*
 * The AE guard: one picture of After Effects' state, built from outside it,
 * and the checks the bridge client runs around every command.
 *
 * States (AeState):
 *   not-running      no After Effects process
 *   dialog           a modal dialog is open (seen by Accessibility, or a modal loop in the main thread)
 *   running-command  the panel is executing a bridge command
 *   running-script   a DoScript run (ae-do) or other script is executing
 *   busy             the main thread is working (render, load) and the panel cannot tick
 *   idle             the panel is alive and the queue is free
 *   paused           the panel is alive with Auto-run off
 *   panel-stalled    After Effects is idle but the panel's timer stopped (re-arm it)
 *   panel-closed     no heartbeat at all: the panel is not open
 *
 * Nothing here sends anything to After Effects. Re-arm and reload are separate,
 * explicit tools.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BridgeClient } from '../bridge/client.js';
import { BridgeError, BridgeHeartbeat, JsonValue } from '../bridge/types.js';
import { acquireLock, isStale, LockBusyError, LockInfo, readLock, releaseLock } from './lock.js';
import { MainThreadReport, sampleMainThread } from './sample.js';
import { AeProcess, autoDismiss, DialogInfo, findAfterEffects, memoryFacts, MemoryFacts, scanWindows, WindowScan } from './system.js';

export type AeState =
  | 'not-running'
  | 'dialog'
  | 'running-command'
  | 'running-script'
  | 'busy'
  | 'idle'
  | 'paused'
  | 'panel-stalled'
  | 'panel-closed';

export interface ExternalRun {
  id: string;
  label: string;
  startedAt: string;
  durationMs?: number;
  status?: string;
  code?: string | null;
  message?: string | null;
}

export interface AeStatus {
  state: AeState;
  summary: string;
  checkedAt: string;
  ae: { pid: number; app: string | null; uptimeMin: number | null } | null;
  memory: MemoryFacts | null;
  panel: {
    heartbeatAgeMs: number | null;
    fresh: boolean;
    version: string | null;
    state: string | null;
    running: JsonValue | null;
    autoRun: boolean | null;
    pollMs: number | null;
    project: string | null;
  };
  lock: (LockInfo & { stale: boolean }) | null;
  external: { running: ExternalRun | null; recent: ExternalRun[] };
  dialogs: DialogInfo[];
  windowScan: Pick<WindowScan, 'available' | 'trusted' | 'aeIsFront' | 'front' | 'error'> | null;
  mainThread: MainThreadReport | null;
  advice: string[];
}

/** Heartbeat younger than this counts as a live panel. */
export function freshLimitMs(hb: BridgeHeartbeat | undefined): number {
  return Math.max(10000, (hb?.pollMs ?? 500) * 4 + 2000);
}

export function readExternal(bridgeDir: string, recent = 5): { running: ExternalRun | null; recent: ExternalRun[] } {
  const dir = path.join(bridgeDir, 'external');
  let running: ExternalRun | null = null;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, 'running.json'), 'utf8')) as ExternalRun & { pid?: number };
    running = r;
  } catch {
    running = null;
  }
  let list: ExternalRun[] = [];
  try {
    list = fs
      .readFileSync(path.join(dir, 'history.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ExternalRun)
      .slice(-recent)
      .reverse();
  } catch {
    list = [];
  }
  return { running, recent: list };
}

export interface ClassifyInput {
  ae: AeProcess | null;
  hb: BridgeHeartbeat | undefined;
  hbAgeMs: number | null;
  dialogs: DialogInfo[];
  mainThread: MainThreadReport | null;
  externalRunning: ExternalRun | null;
}

/** Pure state decision, unit-tested on its own. */
export function classify(input: ClassifyInput): { state: AeState; summary: string } {
  const { ae, hb, hbAgeMs, dialogs, mainThread, externalRunning } = input;
  if (!ae) return { state: 'not-running', summary: 'After Effects is not running.' };
  if (dialogs.length) {
    const d = dialogs[0];
    return { state: 'dialog', summary: `A dialog is open in After Effects${d.texts.length ? `: "${d.texts.join(' / ').slice(0, 160)}"` : d.title ? `: ${d.title}` : ''}.` };
  }
  if (mainThread?.state === 'modal') return { state: 'dialog', summary: 'After Effects is waiting in a modal dialog (seen in its main thread).' };
  const fresh = hbAgeMs !== null && hbAgeMs < freshLimitMs(hb);
  const hbState = hb?.state ?? null;
  if (hbState === 'running' && hb?.running) {
    const r = hb.running as { command?: string; startedAt?: string };
    const secs = r.startedAt ? Math.round((Date.now() - Date.parse(r.startedAt)) / 1000) : null;
    return { state: 'running-command', summary: `The panel is running ${r.command ?? 'a command'}${secs !== null ? ` (${secs} s)` : ''}.` };
  }
  if (externalRunning) {
    const secs = Math.round((Date.now() - Date.parse(externalRunning.startedAt)) / 1000);
    return { state: 'running-script', summary: `A script is running: ${externalRunning.label} (${secs} s).` };
  }
  if (fresh) {
    if (hb && hb.autoRun === false) return { state: 'paused', summary: 'The panel is open with Auto-run off: commands wait.' };
    return { state: 'idle', summary: 'After Effects and the bridge panel are ready.' };
  }
  if (mainThread?.state === 'script') return { state: 'running-script', summary: 'A script is executing in After Effects (DoScript or a long panel command).' };
  if (mainThread?.state === 'busy') return { state: 'busy', summary: 'After Effects is busy (rendering or loading); the panel cannot tick until it finishes.' };
  if (!hb) return { state: 'panel-closed', summary: 'No heartbeat: the MCP Bridge panel is not open (Window > mcp-bridge-auto.jsx).' };
  return {
    state: 'panel-stalled',
    summary: `After Effects looks idle but the panel's heartbeat is ${Math.round((hbAgeMs ?? 0) / 1000)} s old: its timer stopped (this happens after a project opens). Re-arm it.`,
  };
}

export function adviceFor(state: AeState, memory: MemoryFacts | null): string[] {
  const out: string[] = [];
  if (state === 'dialog') out.push('Close the dialog (dismiss-ae-dialog when enabled, or the human). Commands cannot run behind it.');
  if (state === 'panel-stalled') out.push('Call rearm-bridge-panel.');
  if (state === 'panel-closed') out.push('Open Window > mcp-bridge-auto.jsx in After Effects.');
  if (state === 'not-running') out.push('Start After Effects, open the project, then open the panel.');
  if (memory?.aeFootprintGB != null && memory.aeFootprintGB > 12) out.push(`After Effects holds ${memory.aeFootprintGB} GB: save and restart it at the next part boundary.`);
  if (memory?.swapUsedGB != null && memory.swapTotalGB && memory.swapUsedGB / memory.swapTotalGB > 0.85) out.push(`Swap is ${memory.swapUsedGB} of ${memory.swapTotalGB} GB: purge caches or restart After Effects before heavy work.`);
  if (memory?.diskFreeGB != null && memory.diskFreeGB < 12) out.push(`Only ${memory.diskFreeGB} GB free on disk: After Effects stops caching below 10 GB.`);
  return out;
}

export interface BridgeGuard {
  /** Takes the driver lock and fails fast with a clear reason when a command could not run. Returns the release function. */
  beforeCommand(client: BridgeClient, command: string): Promise<() => void>;
  /** Keeps the lock until a timed-out command has finished, then releases. */
  holdUntilDone(client: BridgeClient, id: string, release: () => void): void;
  /** Explains a timeout. */
  explain(client: BridgeClient): Promise<{ state: AeState; summary: string; advice: string[] }>;
  status(client: BridgeClient, opts?: { deep?: boolean }): Promise<AeStatus>;
}

export class SystemGuard implements BridgeGuard {
  readonly owner: string;
  readonly lockWaitMs: number;

  constructor(opts: { owner?: string; lockWaitMs?: number } = {}) {
    this.owner = opts.owner ?? process.env.AE_MCP_OWNER ?? `MCP server ${process.pid}`;
    this.lockWaitMs = opts.lockWaitMs ?? 30000;
  }

  async status(client: BridgeClient, opts: { deep?: boolean } = {}): Promise<AeStatus> {
    const ae = await findAfterEffects();
    const hb = client.readHeartbeat();
    const hbAgeMs = hb ? Date.now() - Date.parse(hb.at) : null;
    const [memory, scan] = await Promise.all([memoryFacts(ae?.pid ?? null), ae ? scanWindows(ae.pid) : Promise.resolve(null)]);
    const external = readExternal(client.paths.root);
    const fresh = hbAgeMs !== null && hbAgeMs < freshLimitMs(hb);
    const wantSample = !!ae && (opts.deep || (!fresh && hb?.state !== 'running' && !external.running));
    const mainThread = wantSample && ae ? await sampleMainThread(ae.pid, 1) : null;
    const dialogs = scan?.dialogs ?? [];
    const { state, summary } = classify({ ae, hb, hbAgeMs, dialogs, mainThread, externalRunning: external.running });
    const lock = readLock(client.paths.root);
    return {
      state,
      summary,
      checkedAt: new Date().toISOString(),
      ae: ae ? { pid: ae.pid, app: ae.appName, uptimeMin: ae.uptimeSec !== null ? Math.round(ae.uptimeSec / 60) : null } : null,
      memory,
      panel: {
        heartbeatAgeMs: hbAgeMs,
        fresh,
        version: hb?.bridgeVersion ?? null,
        state: hb?.state ?? null,
        running: (hb?.running as JsonValue) ?? null,
        autoRun: hb?.autoRun ?? null,
        pollMs: hb?.pollMs ?? null,
        project: hb?.projectName ?? null,
      },
      lock: lock ? { ...lock, stale: isStale(lock) } : null,
      external,
      dialogs,
      windowScan: scan ? { available: scan.available, trusted: scan.trusted, aeIsFront: scan.aeIsFront, front: scan.front, error: scan.error } : null,
      mainThread,
      advice: adviceFor(state, memory),
    };
  }

  async beforeCommand(client: BridgeClient, command: string): Promise<() => void> {
    try {
      await acquireLock(client.paths.root, { owner: this.owner, purpose: command, waitMs: this.lockWaitMs });
    } catch (err) {
      if (err instanceof LockBusyError) {
        throw new BridgeError('ae-busy', err.message, { command, details: { holder: err.holder as unknown as JsonValue } });
      }
      throw err;
    }
    const release = () => releaseLock(client.paths.root);
    const hb = client.readHeartbeat();
    const hbAgeMs = hb ? Date.now() - Date.parse(hb.at) : null;
    if (hbAgeMs !== null && hbAgeMs < freshLimitMs(hb)) return release;
    if (hb?.state === 'running') return release; // a long command is running; ours waits in the queue
    // The panel has not ticked recently: find out why before queueing anything.
    let st = await this.status(client);
    if (st.state === 'dialog' && st.ae && (await autoDismiss(st.ae.pid, client.paths.root))) {
      await new Promise((r) => setTimeout(r, 1500));
      st = await this.status(client);
    }
    const fail = (code: 'ae-not-running' | 'dialog-open' | 'panel-not-running'): never => {
      release();
      throw new BridgeError(code, `${st.summary} '${command}' was not sent.${st.advice.length ? ' ' + st.advice[0] : ''}`, {
        command,
        details: { state: st.state, heartbeatAgeMs: hbAgeMs, dialogs: st.dialogs as unknown as JsonValue },
      });
    };
    if (st.state === 'not-running') fail('ae-not-running');
    if (st.state === 'dialog') fail('dialog-open');
    if (st.state === 'panel-closed' || st.state === 'panel-stalled') fail('panel-not-running');
    return release; // busy / running-script: queue it; the panel picks it up when After Effects is free
  }

  holdUntilDone(client: BridgeClient, id: string, release: () => void): void {
    const limit = Date.now() + client.config.renderTimeoutMs;
    const timer = setInterval(() => {
      if (client.commandState(id) === 'done' || Date.now() > limit) {
        clearInterval(timer);
        release();
      }
    }, 2000);
    timer.unref();
  }

  async explain(client: BridgeClient): Promise<{ state: AeState; summary: string; advice: string[] }> {
    const st = await this.status(client, { deep: true });
    return { state: st.state, summary: st.summary, advice: st.advice };
  }
}

export type { DialogInfo };
export { releaseLock };
