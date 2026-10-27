/*
 * Read-only facts about After Effects and the Mac, gathered without talking to
 * After Effects: its process, its real memory footprint (top's MEM column, which
 * counts compressed memory; ps RSS does not), swap, free disk, and the guard
 * helper's window scan.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface AeProcess {
  pid: number;
  /** Path of the .app bundle, e.g. /Applications/Adobe After Effects 2026/Adobe After Effects 2026.app */
  appPath: string | null;
  /** Application name usable in AppleScript, e.g. "Adobe After Effects 2026". */
  appName: string | null;
  uptimeSec: number | null;
}

export interface MemoryFacts {
  aeFootprintGB: number | null;
  swapUsedGB: number | null;
  swapTotalGB: number | null;
  diskFreeGB: number | null;
}

export interface DialogInfo {
  title: string;
  subrole: string;
  modal: boolean;
  buttons: string[];
  texts: string[];
  /** Text fields, popups, sliders and radio buttons in the dialog (a form, not a message). */
  inputs?: number;
}

export interface WindowScan {
  available: boolean;
  trusted: boolean;
  aeIsFront: boolean;
  front: { pid?: number; name?: string; bundle?: string };
  dialogs: DialogInfo[];
  windowCount: number;
  error?: string;
}

function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => resolve(String(stdout ?? '')));
  });
}

/** "21G" / "512M" / "1024K" / "123" (bytes) to gigabytes. */
export function parseSize(text: string): number | null {
  const m = /^([\d.]+)\s*([KMGTB]?)\+?-?$/i.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toUpperCase();
  const factor = unit === 'T' ? 1024 : unit === 'G' ? 1 : unit === 'M' ? 1 / 1024 : unit === 'K' ? 1 / (1024 * 1024) : 1 / (1024 * 1024 * 1024);
  return Math.round(n * factor * 100) / 100;
}

/** Parses `sysctl -n vm.swapusage`: "total = 16384.00M  used = 15249.12M  free = ...". */
export function parseSwap(text: string): { usedGB: number | null; totalGB: number | null } {
  const total = /total\s*=\s*([\d.]+[KMG])/i.exec(text);
  const used = /used\s*=\s*([\d.]+[KMG])/i.exec(text);
  return { totalGB: total ? parseSize(total[1]) : null, usedGB: used ? parseSize(used[1]) : null };
}

/** Parses `ps -o etime=`: [[dd-]hh:]mm:ss to seconds. */
export function parseEtime(text: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

export async function findAfterEffects(): Promise<AeProcess | null> {
  if (process.platform !== 'darwin') return null;
  const pids = (await run('/usr/bin/pgrep', ['-x', 'After Effects'])).split('\n').map((s) => Number(s.trim())).filter((n) => n > 0);
  if (!pids.length) return null;
  const pid = pids[0];
  const comm = (await run('/bin/ps', ['-o', 'comm=', '-p', String(pid)])).trim();
  const etime = (await run('/bin/ps', ['-o', 'etime=', '-p', String(pid)])).trim();
  const appMatch = /^(.*?\.app)\//.exec(comm);
  const appPath = appMatch ? appMatch[1] : null;
  return { pid, appPath, appName: appPath ? path.basename(appPath, '.app') : null, uptimeSec: parseEtime(etime) };
}

export async function memoryFacts(pid: number | null): Promise<MemoryFacts> {
  let aeFootprintGB: number | null = null;
  if (pid) {
    const top = await run('/usr/bin/top', ['-l', '1', '-pid', String(pid), '-stats', 'pid,mem']);
    const row = top.split('\n').map((l) => l.trim()).find((l) => l.startsWith(String(pid) + ' '));
    if (row) aeFootprintGB = parseSize(row.split(/\s+/)[1] ?? '');
  }
  const swap = parseSwap(await run('/usr/sbin/sysctl', ['-n', 'vm.swapusage']));
  let diskFreeGB: number | null = null;
  try {
    const st = fs.statfsSync(os.homedir());
    diskFreeGB = Math.round(((st.bavail * st.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    diskFreeGB = null;
  }
  return { aeFootprintGB, swapUsedGB: swap.usedGB, swapTotalGB: swap.totalGB, diskFreeGB };
}

/** Where the compiled guard helper lives: build/bin/ae-guard next to this file's build folder. */
export function guardHelperPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'bin', 'ae-guard');
}

export async function scanWindows(pid: number): Promise<WindowScan> {
  const helper = guardHelperPath();
  const empty: WindowScan = { available: false, trusted: false, aeIsFront: false, front: {}, dialogs: [], windowCount: 0 };
  if (!fs.existsSync(helper)) return { ...empty, error: 'guard helper not built (npm run build on macOS with swiftc)' };
  const out = await run(helper, ['scan', '--pid', String(pid)], 5000);
  try {
    const d = JSON.parse(out) as {
      trusted: boolean;
      aeIsFront: boolean;
      front: WindowScan['front'];
      dialogs: DialogInfo[];
      windows: unknown[];
    };
    return { available: true, trusted: d.trusted, aeIsFront: d.aeIsFront, front: d.front ?? {}, dialogs: d.dialogs ?? [], windowCount: (d.windows ?? []).length };
  } catch {
    return { ...empty, error: 'guard helper gave no answer' };
  }
}

export interface DismissResult {
  ok: boolean;
  action?: string;
  reason?: string;
  message?: string;
  frontBefore?: unknown;
  frontAfter?: unknown;
}

/**
 * Whether the guard may close dialogs by itself: AE_MCP_ALLOW_DIALOG_DISMISS=1, or
 * {"allowDialogDismiss": true} in <bridge folder>/guard-options.json (a machine setting
 * that survives restarts and is never rewritten by the server or the panel). Off by default.
 */
export function dismissAllowed(bridgeDir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.AE_MCP_ALLOW_DIALOG_DISMISS === '1') return true;
  if (env.AE_MCP_ALLOW_DIALOG_DISMISS === '0') return false;
  try {
    const o = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'guard-options.json'), 'utf8')) as { allowDialogDismiss?: unknown };
    return o.allowDialogDismiss === true;
  } catch {
    return false;
  }
}

const NEVER_PRESS = /reset|safe mode|disable|don.?t save|delete|quit|remove|replace|revert|discard|trash/i;

/**
 * A dialog the guard may close on its own: a message with buttons only. Anything with text
 * fields, popups, sliders or radio buttons is a form the human may be filling in.
 */
export function isPlainMessage(d: DialogInfo): boolean {
  return d.inputs === 0;
}

/** The button an automatic close presses: OK, else the only safe button; undefined means Escape. */
export function autoDismissButton(d: DialogInfo): string | undefined {
  const safe = d.buttons.filter((b) => !NEVER_PRESS.test(b));
  const ok = safe.find((b) => /^ok$/i.test(b.trim()));
  if (ok) return ok;
  return d.buttons.length === 1 && safe.length === 1 ? safe[0] : undefined;
}

/**
 * Closes a blocking message box when that is safe: dismissing is allowed, After Effects is not
 * the front app (a dialog in front may be the human's), and the dialog is a plain message.
 * Returns the dialog it closed, or null when it left everything alone.
 */
export async function autoDismiss(pid: number, bridgeDir: string, scan?: WindowScan): Promise<DialogInfo | null> {
  if (!dismissAllowed(bridgeDir)) return null;
  const s = scan ?? (await scanWindows(pid));
  const d = s.dialogs[0];
  if (!d || s.aeIsFront || !isPlainMessage(d)) return null;
  const res = await dismissDialog(pid, { button: autoDismissButton(d) });
  return res.ok ? d : null;
}

export async function dismissDialog(pid: number, opts: { button?: string; allowFront?: boolean } = {}): Promise<DismissResult> {
  const helper = guardHelperPath();
  if (!fs.existsSync(helper)) return { ok: false, reason: 'no-helper', message: 'guard helper not built' };
  const args = ['dismiss', '--pid', String(pid)];
  if (opts.button) args.push('--button', opts.button);
  if (opts.allowFront) args.push('--allow-front');
  const out = await run(helper, args, 5000);
  try {
    return JSON.parse(out) as DismissResult;
  } catch {
    return { ok: false, reason: 'no-answer' };
  }
}
