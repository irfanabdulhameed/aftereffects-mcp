/*
 * Reads what After Effects' main thread is doing from a macOS `sample` call
 * graph, without sending anything to After Effects:
 *   modal   a modal loop is running (an alert or dialog is waiting for a click)
 *   script  ExtendScript is executing (a DoScript call or a panel command)
 *   idle    the event loop is waiting for events
 *   busy    anything else (rendering, loading, a long operation)
 * A timer firing a panel tick also runs ExtendScript briefly, so "script"
 * needs most of the samples, not a few.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type MainThreadState = 'modal' | 'script' | 'idle' | 'busy' | 'unknown';

export interface MainThreadReport {
  state: MainThreadState;
  samples: number;
  modalShare: number;
  scriptShare: number;
  idleShare: number;
  /** A few call-graph lines that decided the state. */
  evidence: string[];
  /** Why no call graph was read, when state is unknown. */
  error?: string;
}

const MODAL = /runModalForWindow|runModalSession|RunAppModalLoop|_NSModal|ModalDialog|RunModal|NSAlert|beginModalSession|DoModalDialog|ModalLoop/i;
const SCRIPT = /ScScript::RealEngine::exec|jsRunner::run|DoScript|ExecuteScript/;
const IDLE = /mach_msg2_trap|__CFRunLoopServiceMachPort/;

interface Line {
  count: number;
  text: string;
}

function lineCount(line: string): Line | undefined {
  const m = /^[\s+!:|]*(\d+)\s+(.*)$/.exec(line);
  if (!m) return undefined;
  return { count: Number(m[1]), text: m[2] };
}

/** Extracts the main thread's call graph lines from `sample` output. */
export function mainThreadLines(text: string): Line[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /Thread_\d+.*Main Thread/.test(l) || /\bMain Thread\b/.test(l) && /^\s+\d+ /.test(l));
  if (start < 0) return [];
  const indent = (lines[start].match(/^\s*/) ?? [''])[0].length;
  const out: Line[] = [];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (i > start) {
      if (l.trim() === '') break;
      const ind = (l.match(/^\s*/) ?? [''])[0].length;
      if (ind <= indent && /^\s*\d+ Thread_/.test(l)) break;
    }
    const parsed = lineCount(l);
    if (parsed) out.push(parsed);
  }
  return out;
}

function maxShare(lines: Line[], re: RegExp, total: number): { share: number; line?: string } {
  let best = 0;
  let bestLine: string | undefined;
  for (const l of lines) {
    if (re.test(l.text) && l.count > best) {
      best = l.count;
      bestLine = l.text;
    }
  }
  return { share: total > 0 ? best / total : 0, line: bestLine };
}

export function classifyMainThread(text: string): MainThreadReport {
  const lines = mainThreadLines(text);
  if (!lines.length) return { state: 'unknown', samples: 0, modalShare: 0, scriptShare: 0, idleShare: 0, evidence: [] };
  const total = lines[0].count;
  const modal = maxShare(lines, MODAL, total);
  const script = maxShare(lines, SCRIPT, total);
  // Idle is the biggest wait under the event loop; sum is not needed, the top frame holds it.
  const idle = maxShare(lines, IDLE, total);
  const evidence: string[] = [];
  let state: MainThreadState;
  if (modal.share >= 0.5) {
    state = 'modal';
    if (modal.line) evidence.push(modal.line);
  } else if (script.share >= 0.5) {
    state = 'script';
    if (script.line) evidence.push(script.line);
  } else if (idle.share >= 0.5) {
    state = 'idle';
    if (idle.line) evidence.push(idle.line);
  } else {
    state = 'busy';
    const deepest = lines.filter((l) => l.count >= total * 0.5).pop();
    if (deepest) evidence.push(deepest.text);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { state, samples: total, modalShare: round(modal.share), scriptShare: round(script.share), idleShare: round(idle.share), evidence: evidence.map((e) => e.slice(0, 200)) };
}

function sampleOnce(pid: number, seconds: number, timeoutMs: number): Promise<{ text: string; error?: string }> {
  const file = path.join(os.tmpdir(), `ae-guard-sample-${pid}-${Date.now()}-${Math.round(Math.random() * 1e6)}.txt`);
  return new Promise((resolve) => {
    execFile('/usr/bin/sample', [String(pid), String(seconds), '1', '-file', file], { timeout: timeoutMs }, (err, _out, stderr) => {
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        text = '';
      }
      try {
        fs.unlinkSync(file);
      } catch {
        // already gone
      }
      const why = err ? `${err.message}`.slice(0, 200) : text ? undefined : String(stderr ?? '').trim().split('\n').pop()?.slice(0, 200);
      resolve({ text, error: why });
    });
  });
}

/**
 * Samples a process for `seconds` (1 by default, about 1.5-4 s wall time) and classifies its
 * main thread. `sample` occasionally returns no call graph; it is retried once.
 */
export async function sampleMainThread(pid: number, seconds = 1, timeoutMs = 20000): Promise<MainThreadReport> {
  let last: MainThreadReport | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, error } = await sampleOnce(pid, seconds, timeoutMs);
    last = classifyMainThread(text);
    if (last.state !== 'unknown') return last;
    last.error = error ?? (text ? 'no main thread in the call graph' : 'empty sample');
    await new Promise((r) => setTimeout(r, 500));
  }
  return last as MainThreadReport;
}
