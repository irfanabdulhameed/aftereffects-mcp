/*
 * Guarded DoScript: runs ExtendScript in the running After Effects through
 * AppleScript (no bridge panel needed), plus the guard:
 *   - refuses when After Effects is not running (a "tell" would launch it)
 *   - refuses when a dialog is already open (nothing could run behind it), unless it
 *     may close it itself (autoDismiss: plain message boxes only, After Effects not in front)
 *   - wraps the script in app.beginSuppressDialogs() / try / catch /
 *     endSuppressDialogs(false), so a script error comes back as text instead
 *     of a modal alert
 *   - writes the result to a file unique to this run (parallel-safe)
 *   - watches a long run: if After Effects' main thread sits in a modal loop,
 *     it stops waiting and says so (or, when allowed, closes a plain message box)
 *   - records the run in <bridge>/external/ so the panel can show it
 * After Effects is never activated and the mouse is never touched.
 */

import { ChildProcess, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sampleMainThread } from './sample.js';
import { AeProcess, autoDismiss, findAfterEffects, scanWindows } from './system.js';

export interface DoScriptOptions {
  /** Bridge folder, for the external-run markers the panel reads. */
  bridgeDir?: string;
  /** Short label shown in the panel, e.g. "08 · part 5 build". */
  label?: string;
  /** Give up waiting after this long. Default 3600 s. */
  timeoutMs?: number;
  /** Check the main thread for a modal loop after this long without a result, then every interval. Default 20 s. */
  watchMs?: number;
  /**
   * Close a plain message box that blocks the run or was open before it (only when After Effects
   * is not the front app, and only when dismissAllowed() for bridgeDir; see autoDismiss).
   */
  allowDismiss?: boolean;
  /** Run even if a dialog was seen before starting. */
  force?: boolean;
}

export interface DoScriptResult {
  ok: boolean;
  /** The script's last value as text, or the error text. */
  returned: string | null;
  /** ae-not-running | dialog-open | blocked-by-dialog | script-error | no-result | timeout */
  code?: string;
  message?: string;
  durationMs: number;
  dialog?: { texts: string[]; buttons: string[] } | null;
  dismissed?: boolean;
}

const WRAP = (bodyPath: string, outPath: string) => `(function () {
  var __out = new File(${JSON.stringify(outPath)}); __out.encoding = "UTF-8";
  var __f = new File(${JSON.stringify(bodyPath)}); __f.encoding = "UTF-8"; __f.open("r"); var __s = __f.read(); __f.close();
  var __r;
  try { app.beginSuppressDialogs(); } catch (e0) {}
  try { __r = eval(__s); }
  catch (e) { var __m = "error"; try { __m = String(e.message || e); } catch (e1) {} var __l = null; try { __l = e.line; } catch (e2) {} __r = "ERR " + __m + (__l ? " line " + __l : ""); }
  finally { try { app.endSuppressDialogs(false); } catch (e3) {} }
  var __t; try { __t = String(__r); } catch (e4) { __t = "(unprintable result)"; }
  __out.open("w"); __out.write(__t); __out.close();
})();
`;

function externalDir(bridgeDir: string): string {
  const d = path.join(bridgeDir, 'external');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function appendHistory(bridgeDir: string, entry: Record<string, unknown>): void {
  try {
    const file = path.join(externalDir(bridgeDir), 'history.jsonl');
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    } catch {
      lines = [];
    }
    lines.push(JSON.stringify(entry));
    if (lines.length > 200) lines = lines.slice(-200);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, lines.join('\n') + '\n');
    fs.renameSync(tmp, file);
  } catch {
    // the record is a convenience; never fail the run for it
  }
}

/** Sends a short AppleScript to the running After Effects by its own app name (never launches it). */
export function osascriptDoScript(ae: AeProcess, wrapperPath: string, timeoutSec: number): ChildProcess {
  const name = ae.appName ?? 'Adobe After Effects 2026';
  return spawn('/usr/bin/osascript', [
    '-e', `with timeout of ${Math.max(10, Math.round(timeoutSec))} seconds`,
    '-e', `tell application ${JSON.stringify(name)} to DoScript (read (POSIX file ${JSON.stringify(wrapperPath)}) as «class utf8»)`,
    '-e', 'end timeout',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

export async function runDoScript(source: string, opts: DoScriptOptions = {}): Promise<DoScriptResult> {
  const started = Date.now();
  const done = (r: Omit<DoScriptResult, 'durationMs'>): DoScriptResult => ({ ...r, durationMs: Date.now() - started });
  const ae = await findAfterEffects();
  if (!ae) return done({ ok: false, returned: null, code: 'ae-not-running', message: 'After Effects is not running. Nothing was sent (a DoScript would launch it).' });

  if (!opts.force) {
    let scan = await scanWindows(ae.pid);
    if (scan.dialogs.length && opts.allowDismiss && opts.bridgeDir && (await autoDismiss(ae.pid, opts.bridgeDir, scan))) {
      await new Promise((r) => setTimeout(r, 800));
      scan = await scanWindows(ae.pid);
    }
    if (scan.dialogs.length) {
      const d = scan.dialogs[0];
      return done({
        ok: false, returned: null, code: 'dialog-open',
        message: `After Effects shows a dialog${d.texts.length ? `: "${d.texts.join(' / ')}"` : ''}. Nothing was sent; deal with the dialog first.`,
        dialog: { texts: d.texts, buttons: d.buttons },
      });
    }
  }

  const id = Date.now().toString(36) + randomBytes(3).toString('hex');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-do-'));
  const bodyPath = path.join(work, 'body.jsx');
  const outPath = path.join(work, 'out.txt');
  const wrapPath = path.join(work, 'wrap.jsx');
  fs.writeFileSync(bodyPath, source, 'utf8');
  fs.writeFileSync(wrapPath, WRAP(bodyPath, outPath), 'utf8');

  const label = opts.label ?? 'ae-do';
  const marker = opts.bridgeDir ? path.join(externalDir(opts.bridgeDir), 'running.json') : null;
  if (marker) fs.writeFileSync(marker, JSON.stringify({ id, label, pid: process.pid, startedAt: new Date(started).toISOString() }));

  const timeoutMs = opts.timeoutMs ?? 3600000;
  const watchMs = opts.watchMs ?? 20000;
  const watch: { blocked: DoScriptResult | null; dismissed: boolean } = { blocked: null, dismissed: false };

  const exitCode = await new Promise<number | null>((resolve) => {
    const child = osascriptDoScript(ae, wrapPath, timeoutMs / 1000 + 30);
    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(hardStop);
      clearInterval(watcher);
      resolve(code);
    };
    child.on('exit', (code) => finish(code));
    child.on('error', () => finish(-1));
    const hardStop = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      finish(null);
    }, timeoutMs);
    let watching = false;
    const watcher = setInterval(async () => {
      if (watching || finished || Date.now() - started < watchMs) return;
      watching = true;
      try {
        const report = await sampleMainThread(ae.pid, 1);
        if (finished) return;
        if (report.state === 'modal') {
          const scan = await scanWindows(ae.pid);
          const d = scan.dialogs[0];
          if (opts.allowDismiss && opts.bridgeDir && d && (await autoDismiss(ae.pid, opts.bridgeDir, scan))) {
            watch.dismissed = true;
            return; // keep waiting: the script continues once the dialog is gone
          }
          watch.blocked = {
            ok: false, returned: null, code: 'blocked-by-dialog', durationMs: 0,
            message: `After Effects is showing a modal dialog${d && d.texts.length ? `: "${d.texts.join(' / ')}"` : ''} and the script is waiting behind it. ` +
              'Stopped waiting. The script may still finish once the dialog is closed.',
            dialog: d ? { texts: d.texts, buttons: d.buttons } : null,
          };
          try { child.kill(); } catch { /* gone */ }
          finish(null);
        }
      } finally {
        watching = false;
      }
    }, Math.max(1000, Math.min(watchMs, 30000)));
  });

  let result: DoScriptResult;
  const dismissed = watch.dismissed;
  if (watch.blocked) {
    result = { ...watch.blocked, durationMs: Date.now() - started };
  } else if (fs.existsSync(outPath)) {
    const text = fs.readFileSync(outPath, 'utf8');
    const isErr = text.startsWith('ERR ');
    result = done({ ok: !isErr, returned: text, code: isErr ? 'script-error' : undefined, dismissed });
  } else if (exitCode === null) {
    result = done({ ok: false, returned: null, code: 'timeout', message: `No result after ${Math.round(timeoutMs / 1000)} s. The script may still be running in After Effects.`, dismissed });
  } else {
    const report = await sampleMainThread(ae.pid, 1);
    const why = report.state === 'modal'
      ? 'After Effects is showing a modal dialog.'
      : report.state === 'script'
        ? 'Another script is still running in After Effects.'
        : 'The script did not finish (AppleScript returned without a result).';
    result = done({ ok: false, returned: null, code: report.state === 'modal' ? 'blocked-by-dialog' : 'no-result', message: why, dismissed });
  }

  if (opts.bridgeDir) {
    appendHistory(opts.bridgeDir, {
      id, label, startedAt: new Date(started).toISOString(), durationMs: result.durationMs,
      status: result.ok ? 'ok' : 'error', code: result.code ?? null,
      message: result.ok ? null : (result.message ?? result.returned ?? '').slice(0, 300),
    });
    try { if (marker) fs.unlinkSync(marker); } catch { /* gone */ }
  }
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* temp */ }
  return result;
}
