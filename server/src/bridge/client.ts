/*
 * File-based bridge client.
 *
 * run(command, args) writes queue/cmd-<createdAt>-<seq>-<id>.json atomically
 * (write a temp file, then rename), then polls results/res-<id>.json until it
 * appears or the timeout passes. Matching is on the id only. Nothing is
 * inferred from file modification times.
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BridgeConfig, BridgePaths, bridgePaths, ensureBridgeDirs, loadConfig } from './paths.js';
import {
  BRIDGE_PROTOCOL,
  BridgeCommandFile,
  BridgeError,
  BridgeHeartbeat,
  BridgeOptionsFile,
  BridgeResultFile,
  JsonValue,
} from './types.js';

export type TimeoutClass = 'normal' | 'render' | number;

export interface RunOptions {
  timeout?: TimeoutClass;
}

export interface RecentResult {
  id: string;
  command: string;
  status: 'ok' | 'error';
  finishedAt: string;
  durationMs: number;
  file: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(n: number, width: number): string {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

export class BridgeClient {
  readonly config: BridgeConfig;
  readonly paths: BridgePaths;
  private seq = 0;

  constructor(config: BridgeConfig = loadConfig()) {
    this.config = config;
    this.paths = bridgePaths(config.bridgeDir);
    ensureBridgeDirs(this.paths);
  }

  /** Generates a short id that is unique for the life of the bridge folder. */
  newId(): string {
    this.seq = (this.seq + 1) % 10000;
    return Date.now().toString(36) + randomBytes(3).toString('hex');
  }

  private commandFileName(id: string, createdAtMs: number): string {
    return `cmd-${pad(createdAtMs, 13)}-${pad(this.seq, 4)}-${id}.json`;
  }

  resultPath(id: string): string {
    return path.join(this.paths.results, `res-${id}.json`);
  }

  /** Writes a command file and returns its id without waiting. */
  enqueue(command: string, args: Record<string, unknown> = {}): { id: string; file: string } {
    ensureBridgeDirs(this.paths);
    const id = this.newId();
    const createdAtMs = Date.now();
    const payload: BridgeCommandFile = {
      id,
      command,
      args,
      createdAt: new Date(createdAtMs).toISOString(),
      status: 'pending',
      protocol: BRIDGE_PROTOCOL,
    };
    const finalName = this.commandFileName(id, createdAtMs);
    const tmpPath = path.join(this.paths.queue, `.tmp-${id}.json`);
    const finalPath = path.join(this.paths.queue, finalName);
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpPath, finalPath);
    return { id, file: finalPath };
  }

  private timeoutMsFor(timeout: TimeoutClass | undefined): number {
    if (typeof timeout === 'number') return timeout;
    if (timeout === 'render') return this.config.renderTimeoutMs;
    return this.config.timeoutMs;
  }

  /** Reads and parses a result file, or returns undefined if it is not there yet. */
  readResult(id: string): BridgeResultFile | undefined {
    const file = this.resultPath(id);
    if (!fs.existsSync(file)) return undefined;
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text) as BridgeResultFile;
    } catch {
      // The panel renames a temp file into place, so a partial read should not
      // happen. If it does, the next poll reads the complete file.
      return undefined;
    }
  }

  /** Where a command file currently sits: waiting, running, or gone. */
  commandState(id: string): 'pending' | 'running' | 'done' {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(this.paths.queue);
    } catch {
      return 'done';
    }
    for (const name of entries) {
      if (!name.endsWith(`-${id}.json`)) continue;
      if (name.startsWith('cmd-')) return 'pending';
      if (name.startsWith('running-')) return 'running';
    }
    return 'done';
  }

  private removePendingCommand(id: string): boolean {
    try {
      for (const name of fs.readdirSync(this.paths.queue)) {
        if (name.startsWith('cmd-') && name.endsWith(`-${id}.json`)) {
          fs.unlinkSync(path.join(this.paths.queue, name));
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  }

  /** Waits for results/res-<id>.json. Throws BridgeError on timeout or command failure. */
  async waitForResult(id: string, command: string, timeoutMs: number): Promise<JsonValue> {
    const start = Date.now();
    for (;;) {
      const result = this.readResult(id);
      if (result) {
        if (result.status === 'ok') return result.result === undefined ? null : result.result;
        const info = result.error ?? { message: 'Unknown bridge error', code: 'unknown', command, id };
        throw new BridgeError('command-failed', info.message, { command, id, details: info.details, inner: info });
      }
      if (Date.now() - start >= timeoutMs) break;
      await sleep(this.config.serverPollMs);
    }

    const state = this.commandState(id);
    const heartbeat = this.readHeartbeat();
    const heartbeatAge = heartbeat ? Date.now() - Date.parse(heartbeat.at) : undefined;
    const panelLooksAlive = heartbeatAge !== undefined && heartbeatAge < 10000;

    if (state === 'pending') {
      // Never picked up. Remove it so it does not run later when the panel opens.
      this.removePendingCommand(id);
      throw new BridgeError(
        'bridge-not-running',
        `The MCP Bridge Auto panel did not pick up '${command}' within ${timeoutMs} ms. ` +
          (panelLooksAlive
            ? 'The panel is alive but busy or paused (check the Auto-run box in the panel).'
            : 'Open Window > mcp-bridge-auto.jsx in After Effects and make sure "Allow Scripts to Write Files and Access Network" is enabled.') +
          ' The command was removed from the queue and did not run.',
        { command, id, details: { heartbeatAgeMs: heartbeatAge ?? null, bridgeDir: this.paths.root } }
      );
    }
    throw new BridgeError(
      'timeout',
      `'${command}' is still running in After Effects after ${timeoutMs} ms. It has not been cancelled. ` +
        `Call get-results with id "${id}" to fetch the result when it finishes.`,
      { command, id, details: { state, heartbeatAgeMs: heartbeatAge ?? null } }
    );
  }

  /** Enqueue and wait. The normal path for every tool. */
  async run(command: string, args: Record<string, unknown> = {}, opts: RunOptions = {}): Promise<JsonValue> {
    const { id } = this.enqueue(command, args);
    return this.waitForResult(id, command, this.timeoutMsFor(opts.timeout));
  }

  readHeartbeat(): BridgeHeartbeat | undefined {
    try {
      if (!fs.existsSync(this.paths.heartbeat)) return undefined;
      return JSON.parse(fs.readFileSync(this.paths.heartbeat, 'utf8')) as BridgeHeartbeat;
    } catch {
      return undefined;
    }
  }

  queueLength(): number {
    try {
      return fs.readdirSync(this.paths.queue).filter((n) => n.startsWith('cmd-') || n.startsWith('running-')).length;
    } catch {
      return 0;
    }
  }

  readOptions(): BridgeOptionsFile {
    try {
      if (!fs.existsSync(this.paths.options)) return {};
      return JSON.parse(fs.readFileSync(this.paths.options, 'utf8')) as BridgeOptionsFile;
    } catch {
      return {};
    }
  }

  writeOptions(options: BridgeOptionsFile): BridgeOptionsFile {
    const merged: BridgeOptionsFile = { ...this.readOptions(), ...options };
    const tmp = this.paths.options + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
    fs.renameSync(tmp, this.paths.options);
    return merged;
  }

  /** Called once on server start: seed bridge-options.json from the environment when set. */
  applyEnvironmentOptions(): void {
    const opts: BridgeOptionsFile = {};
    if (this.config.bridgePollMs !== undefined) opts.pollMs = this.config.bridgePollMs;
    if (this.config.bridgeVerbosity !== undefined) opts.verbosity = this.config.bridgeVerbosity;
    if (Object.keys(opts).length > 0 || !fs.existsSync(this.paths.options)) {
      this.writeOptions({ pollMs: 500, verbosity: 1, ...opts });
    }
  }

  /** Lists the newest results, newest first. */
  listRecentResults(limit = 10): RecentResult[] {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(this.paths.results).filter((n) => n.startsWith('res-') && n.endsWith('.json'));
    } catch {
      return [];
    }
    const withTime = entries
      .map((name) => {
        const file = path.join(this.paths.results, name);
        try {
          return { name, file, mtime: fs.statSync(file).mtimeMs };
        } catch {
          return undefined;
        }
      })
      .filter((e): e is { name: string; file: string; mtime: number } => e !== undefined)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
    const out: RecentResult[] = [];
    for (const e of withTime) {
      try {
        const parsed = JSON.parse(fs.readFileSync(e.file, 'utf8')) as BridgeResultFile;
        out.push({ id: parsed.id, command: parsed.command, status: parsed.status, finishedAt: parsed.finishedAt, durationMs: parsed.durationMs, file: e.file });
      } catch {
        // skip unreadable
      }
    }
    return out;
  }

  /** Removes result files and stale temp files older than maxAgeMs. Returns how many were removed. */
  cleanupOldResults(maxAgeMs = this.config.resultMaxAgeMs): number {
    let removed = 0;
    const cutoff = Date.now() - maxAgeMs;
    const sweep = (dir: string, predicate: (name: string) => boolean) => {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (!predicate(name)) continue;
        const file = path.join(dir, name);
        try {
          if (fs.statSync(file).mtimeMs < cutoff) {
            fs.unlinkSync(file);
            removed++;
          }
        } catch {
          // ignore
        }
      }
    };
    sweep(this.paths.results, (n) => n.endsWith('.json'));
    sweep(this.paths.queue, (n) => n.startsWith('.tmp-'));
    sweep(this.paths.frames, (n) => n.endsWith('.png'));
    return removed;
  }
}

let defaultClient: BridgeClient | undefined;

/** The process-wide client. Tests construct their own with a temporary directory. */
export function getBridge(): BridgeClient {
  if (!defaultClient) defaultClient = new BridgeClient();
  return defaultClient;
}

export function setBridge(client: BridgeClient): void {
  defaultClient = client;
}
