/*
 * driver.lock in the bridge folder: one driver of After Effects at a time.
 *
 * After Effects runs one script at a time, and several chats (MCP servers and
 * ae-do runs) may want it. The lock is a JSON file created atomically ('wx').
 * Its holder refreshes it every 15 s while it works. It is stale, and may be
 * taken over, only when its process is gone or it has not been refreshed for
 * staleMs (default 120 s). The same process may take it again (re-entrant).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface LockInfo {
  owner: string;
  pid: number;
  host: string;
  purpose: string | null;
  acquiredAt: string;
  refreshedAt: string;
}

export class LockBusyError extends Error {
  readonly holder: LockInfo;
  constructor(holder: LockInfo, waitedMs: number) {
    const since = Math.round((Date.now() - Date.parse(holder.acquiredAt)) / 1000);
    super(
      `After Effects is being driven by "${holder.owner}"${holder.purpose ? ` (${holder.purpose})` : ''} for ${since} s (pid ${holder.pid}). ` +
        `Waited ${Math.round(waitedMs / 1000)} s. Try again when it is done, or ask that chat to pause.`
    );
    this.name = 'LockBusyError';
    this.holder = holder;
  }
}

export interface LockOptions {
  owner: string;
  purpose?: string;
  /** How long to wait for another holder before giving up. Default 30 s. */
  waitMs?: number;
  /** A lock not refreshed for this long is stale. Default 120 s. */
  staleMs?: number;
  /** Refresh interval while held. Default 15 s. */
  refreshMs?: number;
}

export interface LockHandle {
  info: LockInfo;
  release(): void;
}

export function lockPath(bridgeDir: string): string {
  return path.join(bridgeDir, 'driver.lock');
}

export function readLock(bridgeDir: string): LockInfo | null {
  try {
    return JSON.parse(fs.readFileSync(lockPath(bridgeDir), 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

export function processAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function isStale(info: LockInfo, staleMs = 120000, now = Date.now()): boolean {
  if (info.host !== os.hostname()) return now - Date.parse(info.refreshedAt) > staleMs;
  if (!processAlive(info.pid)) return true;
  return now - Date.parse(info.refreshedAt) > staleMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Per-process holds, so one process can take the lock again without deadlock. */
const held = new Map<string, { info: LockInfo; count: number; timer: NodeJS.Timeout | null }>();

function tryCreate(file: string, info: LockInfo): boolean {
  try {
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, JSON.stringify(info, null, 2));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export async function acquireLock(bridgeDir: string, opts: LockOptions): Promise<LockHandle> {
  const file = lockPath(bridgeDir);
  const staleMs = opts.staleMs ?? 120000;
  const waitMs = opts.waitMs ?? 30000;
  const refreshMs = opts.refreshMs ?? 15000;
  const mine = held.get(file);
  if (mine) {
    mine.count++;
    return { info: mine.info, release: () => releaseLock(bridgeDir) };
  }
  const start = Date.now();
  for (;;) {
    const now = new Date().toISOString();
    const info: LockInfo = { owner: opts.owner, pid: process.pid, host: os.hostname(), purpose: opts.purpose ?? null, acquiredAt: now, refreshedAt: now };
    if (tryCreate(file, info)) {
      const timer = setInterval(() => {
        const cur = readLock(bridgeDir);
        if (!cur || cur.pid !== process.pid) return;
        cur.refreshedAt = new Date().toISOString();
        try {
          fs.writeFileSync(file, JSON.stringify(cur, null, 2));
        } catch {
          // folder gone; nothing to refresh
        }
      }, refreshMs);
      timer.unref();
      held.set(file, { info, count: 1, timer });
      return { info, release: () => releaseLock(bridgeDir) };
    }
    const holder = readLock(bridgeDir);
    if (holder && holder.pid === process.pid && holder.host === os.hostname()) {
      // A lock left by this process from an earlier hold that was not tracked: adopt it.
      held.set(file, { info: holder, count: 1, timer: null });
      return { info: holder, release: () => releaseLock(bridgeDir) };
    }
    if (!holder || isStale(holder, staleMs)) {
      try {
        fs.renameSync(file, `${file}.stale-${Date.now()}`);
      } catch {
        // someone else took it over first; loop and look again
      }
      continue;
    }
    if (Date.now() - start >= waitMs) throw new LockBusyError(holder, Date.now() - start);
    await sleep(250);
  }
}

export function releaseLock(bridgeDir: string): void {
  const file = lockPath(bridgeDir);
  const mine = held.get(file);
  if (!mine) return;
  mine.count--;
  if (mine.count > 0) return;
  if (mine.timer) clearInterval(mine.timer);
  held.delete(file);
  const cur = readLock(bridgeDir);
  if (cur && cur.pid === process.pid) {
    try {
      fs.unlinkSync(file);
    } catch {
      // already gone
    }
  }
  // Old takeover files are clutter; remove those older than a day.
  try {
    for (const name of fs.readdirSync(bridgeDir)) {
      if (!name.startsWith('driver.lock.stale-')) continue;
      const ts = Number(name.slice('driver.lock.stale-'.length));
      if (ts && Date.now() - ts > 86400000) fs.unlinkSync(path.join(bridgeDir, name));
    }
  } catch {
    // ignore
  }
}
