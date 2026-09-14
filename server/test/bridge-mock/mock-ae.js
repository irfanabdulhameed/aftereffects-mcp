#!/usr/bin/env node
/*
 * Mock After Effects bridge.
 *
 * Watches <bridgeDir>/queue for cmd-*.json files exactly like the real panel
 * does, renames them to running-*, answers with a plausible result shape from
 * responses.js, writes results/res-<id>.json atomically, deletes the command
 * file, and writes heartbeat.json. It needs no After Effects.
 *
 * Usage:
 *   node test/bridge-mock/mock-ae.js [bridgeDir] [--poll 50] [--fail-command name] [--delay-command name=ms]
 * or from tests:
 *   const mock = startMockBridge({ bridgeDir }); ... mock.stop();
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { respond } from './responses.js';

export function startMockBridge(options = {}) {
  const bridgeDir = options.bridgeDir ?? path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
  const pollMs = options.pollMs ?? 25;
  const failCommands = new Set(options.failCommands ?? []);
  const delays = options.delays ?? {};
  const bridgeVersion = options.bridgeVersion ?? readServerVersion();
  const queue = path.join(bridgeDir, 'queue');
  const results = path.join(bridgeDir, 'results');
  const frames = path.join(bridgeDir, 'frames');
  for (const d of [bridgeDir, queue, results, frames]) fs.mkdirSync(d, { recursive: true });

  const state = { commandsRun: 0, errors: 0, lastCommand: null, lastCommandAt: null, busy: false, log: [], stopped: false, pending: [] };

  function writeAtomic(file, text) {
    const tmp = path.join(path.dirname(file), `.tmp-${path.basename(file)}-${process.pid}`);
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  }

  function heartbeat() {
    writeAtomic(
      path.join(bridgeDir, 'heartbeat.json'),
      JSON.stringify({
        at: new Date().toISOString(),
        aeVersion: '24.6.0 (mock)',
        bridgeVersion,
        protocol: 2,
        pollMs,
        queueLength: fs.readdirSync(queue).filter((n) => n.startsWith('cmd-')).length,
        busy: state.busy,
        autoRun: true,
        commandsRun: state.commandsRun,
        errors: state.errors,
        lastCommand: state.lastCommand,
        lastCommandAt: state.lastCommandAt,
        projectName: 'mock.aep',
      })
    );
  }

  function execute(cmd) {
    const started = new Date();
    const envelope = { id: cmd.id, command: cmd.command, status: 'ok', startedAt: started.toISOString(), finishedAt: null, durationMs: 0, aeVersion: '24.6.0 (mock)', bridgeVersion };
    try {
      if (failCommands.has(cmd.command)) throw Object.assign(new Error(`Mock failure for ${cmd.command}`), { mcpCode: 'mock-failure', line: 42, fileName: 'mock-ae.js' });
      envelope.result = respond(cmd.command, cmd.args ?? {}, { invoke: (c, a) => respond(c, a, {}) });
    } catch (err) {
      envelope.status = 'error';
      envelope.error = { message: err.message, code: err.mcpCode ?? 'script-error', command: cmd.command, id: cmd.id, line: err.line, fileName: err.fileName };
      state.errors++;
    }
    const finished = new Date();
    envelope.finishedAt = finished.toISOString();
    envelope.durationMs = finished.getTime() - started.getTime();
    return envelope;
  }

  function finish(cmd, runningPath) {
    const envelope = execute(cmd);
    writeAtomic(path.join(results, `res-${cmd.id}.json`), JSON.stringify(envelope, null, 2));
    try {
      fs.unlinkSync(runningPath);
    } catch {
      // ignore
    }
    state.commandsRun++;
    state.log.push({ command: cmd.command, status: envelope.status });
  }

  function tick() {
    if (state.stopped || state.busy) return;
    state.busy = true;
    try {
      const names = fs.readdirSync(queue).filter((n) => n.startsWith('cmd-') && n.endsWith('.json')).sort();
      for (const name of names) {
        const runningName = 'running-' + name.slice(4);
        const from = path.join(queue, name);
        const to = path.join(queue, runningName);
        try {
          fs.renameSync(from, to);
        } catch {
          continue;
        }
        let cmd;
        try {
          cmd = JSON.parse(fs.readFileSync(to, 'utf8'));
        } catch {
          fs.unlinkSync(to);
          continue;
        }
        state.lastCommand = cmd.command;
        state.lastCommandAt = new Date().toISOString();
        const delay = delays[cmd.command];
        if (delay) {
          const t = setTimeout(() => finish(cmd, to), delay);
          state.pending.push(t);
        } else {
          finish(cmd, to);
        }
      }
      heartbeat();
    } finally {
      state.busy = false;
    }
  }

  heartbeat();
  const timer = setInterval(tick, pollMs);
  return {
    bridgeDir,
    state,
    tick,
    stop() {
      state.stopped = true;
      clearInterval(timer);
      for (const t of state.pending) clearTimeout(t);
    },
  };
}

function readServerVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.resolve(here, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dirArg = args.find((a) => !a.startsWith('--'));
  const pollIdx = args.indexOf('--poll');
  const failCommands = args.filter((a, i) => args[i - 1] === '--fail-command');
  const delays = {};
  args.forEach((a, i) => {
    if (args[i - 1] === '--delay-command') {
      const [name, ms] = a.split('=');
      delays[name] = Number(ms);
    }
  });
  const mock = startMockBridge({ bridgeDir: dirArg ? path.resolve(dirArg) : undefined, pollMs: pollIdx >= 0 ? Number(args[pollIdx + 1]) : 50, failCommands, delays });
  console.log(`Mock After Effects bridge watching ${mock.bridgeDir} (Ctrl+C to stop)`);
  process.on('SIGINT', () => {
    mock.stop();
    process.exit(0);
  });
}
