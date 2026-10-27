/*
 * ae-do: runs .jsx files in After Effects by DoScript, through the guard.
 *
 *   node build/cli/ae-do.js [--label "08 · P5 build"] [--timeout 3600] [--owner NAME] [--force] file1.jsx [file2.jsx …]
 *
 * It concatenates the files, runs them in After Effects by
 * DoScript, and prints  "returned": "<value>",  (script errors come back as
 * "ERR <message> line <n>" inside returned). On top of a plain DoScript it:
 *   - takes the driver lock (one driver of After Effects at a time; waits up to 2 min)
 *   - refuses when After Effects is not running or a dialog is already open
 *   - suppresses script-error alerts, so an error never leaves a modal behind
 *   - notices a modal dialog during a long run and says so instead of waiting an hour
 *   - closes a plain message box by itself when dismissing is allowed and AE is not in front
 *   - uses a result file per run, so parallel calls never mix their answers
 *   - shows the run in the bridge panel (bridge folder external/)
 * Guard refusals print "ERR: <reason>" and exit 2.
 */

import * as fs from 'fs';
import { loadConfig } from '../bridge/paths.js';
import { runDoScript } from '../guard/doscript.js';
import { acquireLock, LockBusyError, releaseLock } from '../guard/lock.js';
import { dismissAllowed } from '../guard/system.js';

function parseArgs(argv: string[]) {
  const files: string[] = [];
  const opts: { label?: string; timeoutSec?: number; owner?: string; force: boolean } = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') opts.label = argv[++i];
    else if (a === '--timeout') opts.timeoutSec = Number(argv[++i]);
    else if (a === '--owner') opts.owner = argv[++i];
    else if (a === '--force') opts.force = true;
    else files.push(a);
  }
  return { files, opts };
}

async function main(): Promise<number> {
  const { files, opts } = parseArgs(process.argv.slice(2));
  if (!files.length) {
    console.log('usage: ae-do [--label L] [--timeout SEC] [--owner NAME] [--force] file1.jsx [file2.jsx …]');
    return 2;
  }
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    console.log(`ERR: file not found: ${missing.join(', ')}`);
    return 2;
  }
  const source = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const config = loadConfig();
  const label = opts.label ?? files.map((f) => f.split('/').pop()).join(' + ');
  const owner = opts.owner ?? process.env.AE_DO_OWNER ?? `ae-do: ${label}`;
  try {
    await acquireLock(config.bridgeDir, { owner, purpose: label, waitMs: 120000 });
  } catch (err) {
    if (err instanceof LockBusyError) {
      console.log(`ERR: ${err.message}`);
      return 2;
    }
    throw err;
  }
  try {
    const res = await runDoScript(source, {
      bridgeDir: config.bridgeDir,
      label,
      timeoutMs: (opts.timeoutSec && opts.timeoutSec > 0 ? opts.timeoutSec : 3600) * 1000,
      allowDismiss: dismissAllowed(config.bridgeDir),
      force: opts.force,
    });
    if (res.returned !== null) {
      process.stdout.write(` "returned": "${res.returned}",\n`);
      return 0;
    }
    console.log(`ERR: ${res.message ?? res.code ?? 'no result'}`);
    return 2;
  } finally {
    releaseLock(config.bridgeDir);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.log(`ERR: ae-do failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
);
