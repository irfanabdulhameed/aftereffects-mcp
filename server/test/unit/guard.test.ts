import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { adviceFor, classify, freshLimitMs } from '../../src/guard/guard.js';
import { acquireLock, LockBusyError, lockPath, readLock, releaseLock } from '../../src/guard/lock.js';
import { classifyMainThread } from '../../src/guard/sample.js';
import { autoDismissButton, dismissAllowed, isPlainMessage, parseEtime, parseSize, parseSwap } from '../../src/guard/system.js';
import { hotReloadSource, REARM_SOURCE } from '../../src/tools/guard.js';
import type { BridgeHeartbeat } from '../../src/bridge/types.js';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');

function graph(main: string[], other: string[] = []): string {
  return ['Call graph:', ...main, ...other, '', 'Total number in stack: 1'].join('\n');
}

describe('main thread classification from sample', () => {
  it('reads a real idle After Effects sample as idle', () => {
    const r = classifyMainThread(fs.readFileSync(path.join(FIXTURES, 'sample-idle.txt'), 'utf8'));
    expect(r.state).toBe('idle');
    expect(r.samples).toBe(404);
    expect(r.idleShare).toBeGreaterThan(0.8);
  });

  it('sees a modal loop', () => {
    const r = classifyMainThread(
      graph([
        '    400 Thread_1: Main Thread   DispatchQueue_1',
        '    + 400 start  (in dyld) + 1',
        '    +   400 -[NSApplication runModalForWindow:]  (in AppKit) + 10',
        '    +     390 mach_msg2_trap  (in libsystem_kernel.dylib) + 8',
      ])
    );
    expect(r.state).toBe('modal');
    expect(r.modalShare).toBe(1);
  });

  it('sees a running script', () => {
    const r = classifyMainThread(
      graph([
        '    300 Thread_1: Main Thread',
        '    + 300 start  (in dyld) + 1',
        '    +   280 ScScript::RealEngine::exec(int)  (in extendscript) + 3',
        '    +   20 mach_msg2_trap  (in libsystem_kernel.dylib) + 8',
      ])
    );
    expect(r.state).toBe('script');
  });

  it('calls other main-thread work busy and stops at the next thread', () => {
    const r = classifyMainThread(
      graph(
        ['    200 Thread_1: Main Thread', '    + 200 start', '    +   190 RenderFrame  (in AfterFXLib) + 4'],
        ['    200 Thread_2', '    + 200 mach_msg2_trap  (in libsystem_kernel.dylib)']
      )
    );
    expect(r.state).toBe('busy');
  });

  it('returns unknown for empty output', () => {
    expect(classifyMainThread('').state).toBe('unknown');
  });
});

describe('system parsers', () => {
  it('parses top sizes, swap and elapsed time', () => {
    expect(parseSize('21G')).toBe(21);
    expect(parseSize('512M')).toBe(0.5);
    expect(parseSize('1536M+')).toBe(1.5);
    expect(parseSize('n/a')).toBeNull();
    expect(parseSwap('total = 16384.00M  used = 15249.12M  free = 1134.88M  (encrypted)')).toEqual({ totalGB: 16, usedGB: 14.89 });
    expect(parseEtime('05:31:32')).toBe(5 * 3600 + 31 * 60 + 32);
    expect(parseEtime('02-02:44:27')).toBe(2 * 86400 + 2 * 3600 + 44 * 60 + 27);
    expect(parseEtime('00:09')).toBe(9);
  });
});

describe('state classification', () => {
  const ae = { pid: 42, appPath: '/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app', appName: 'Adobe After Effects 2026', uptimeSec: 60 };
  const hb = (over: Partial<BridgeHeartbeat> = {}): BridgeHeartbeat => ({
    at: new Date().toISOString(), aeVersion: '26.5', bridgeVersion: '2.1.0', protocol: 2, pollMs: 500, queueLength: 0, busy: false,
    commandsRun: 0, errors: 0, lastCommand: null, lastCommandAt: null, projectName: 'x.aep', autoRun: true, state: 'idle', ...over,
  });
  const base = { ae, hb: hb(), hbAgeMs: 1000, dialogs: [], mainThread: null, externalRunning: null };

  it('orders the states', () => {
    expect(classify({ ...base, ae: null }).state).toBe('not-running');
    expect(classify({ ...base, dialogs: [{ title: '', subrole: 'AXDialog', modal: true, buttons: ['OK'], texts: ['Unable to execute script'] }] }).state).toBe('dialog');
    expect(classify({ ...base, mainThread: { state: 'modal', samples: 1, modalShare: 1, scriptShare: 0, idleShare: 0, evidence: [] } }).state).toBe('dialog');
    expect(classify({ ...base, hb: hb({ state: 'running', running: { id: 'a', command: 'renderFrames', startedAt: new Date().toISOString() } }), hbAgeMs: 60000 }).state).toBe('running-command');
    expect(classify({ ...base, externalRunning: { id: 'x', label: '08 build', startedAt: new Date().toISOString() } }).state).toBe('running-script');
    expect(classify(base).state).toBe('idle');
    expect(classify({ ...base, hb: hb({ autoRun: false }) }).state).toBe('paused');
    expect(classify({ ...base, hbAgeMs: 60000, mainThread: { state: 'idle', samples: 1, modalShare: 0, scriptShare: 0, idleShare: 1, evidence: [] } }).state).toBe('panel-stalled');
    expect(classify({ ...base, hb: undefined, hbAgeMs: null }).state).toBe('panel-closed');
    expect(classify({ ...base, hbAgeMs: 60000, mainThread: { state: 'busy', samples: 1, modalShare: 0, scriptShare: 0, idleShare: 0, evidence: [] } }).state).toBe('busy');
  });

  it('treats a slow poll as fresh for longer, and advises on memory', () => {
    expect(freshLimitMs(hb({ pollMs: 5000 }))).toBe(22000);
    expect(freshLimitMs(undefined)).toBe(10000);
    const advice = adviceFor('idle', { aeFootprintGB: 21, swapUsedGB: 15, swapTotalGB: 16, diskFreeGB: 11 });
    expect(advice.join(' ')).toMatch(/21 GB/);
    expect(advice.join(' ')).toMatch(/Swap/);
    expect(advice.join(' ')).toMatch(/11 GB free/);
  });
});

describe('driver lock', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) {
      releaseLock(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dir = undefined;
  });

  it('is exclusive, re-entrant for its own process, and removed on release', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-lock-'));
    const a = await acquireLock(dir, { owner: 'test', purpose: 'one', waitMs: 100 });
    expect(readLock(dir)?.owner).toBe('test');
    const b = await acquireLock(dir, { owner: 'test', purpose: 'two', waitMs: 100 });
    b.release();
    expect(fs.existsSync(lockPath(dir))).toBe(true);
    a.release();
    expect(fs.existsSync(lockPath(dir))).toBe(false);
  });

  it('waits for a live foreign holder, then reports who it is', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-lock-'));
    const now = new Date().toISOString();
    // The test runner's parent process is alive on every platform and never ours.
    fs.writeFileSync(lockPath(dir), JSON.stringify({ owner: 'Render chat', pid: process.ppid, host: os.hostname(), purpose: 'part 5', acquiredAt: now, refreshedAt: now }));
    await expect(acquireLock(dir, { owner: 'test', waitMs: 300 })).rejects.toBeInstanceOf(LockBusyError);
    try {
      await acquireLock(dir, { owner: 'test', waitMs: 100 });
    } catch (err) {
      expect((err as Error).message).toMatch(/Render chat/);
    }
  });

  it('takes over a lock whose process is gone', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-lock-'));
    const now = new Date().toISOString();
    fs.writeFileSync(lockPath(dir), JSON.stringify({ owner: 'crashed chat', pid: 999999, host: os.hostname(), purpose: null, acquiredAt: now, refreshedAt: now }));
    const h = await acquireLock(dir, { owner: 'test', waitMs: 300 });
    expect(readLock(dir)?.owner).toBe('test');
    h.release();
  });
});

describe('panel scripts sent by the guard tools', () => {
  it('hot reload reuses the open panel and escapes the path', () => {
    const src = hotReloadSource('/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/mcp-bridge-auto.jsx');
    expect(src).toContain('MCP_RELOAD_HOST = host');
    expect(src).toContain('app.cancelTask(MCP.state.taskId)');
    expect(src).toContain('app.scheduleTask("$.evalFile(MCP_RELOAD_FILE, 60000)');
    expect(src).toContain('MCP_RELOAD_FILE = f');
    expect(src).toContain('"/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/mcp-bridge-auto.jsx"');
    expect(hotReloadSource('/tmp/a"b.jsx')).toContain('"/tmp/a\\"b.jsx"');
  });

  it('re-arm calls the panel timer and is plain ES3', () => {
    expect(REARM_SOURCE).toContain('MCP.reschedule()');
    expect(REARM_SOURCE).not.toMatch(/\b(let|const)\b|=>/);
  });
});

describe('automatic dialog closing', () => {
  const msg = (buttons: string[], inputs?: number) => ({ title: '', subrole: 'AXDialog', modal: true, buttons, texts: ['x'], inputs });

  it('is off unless the environment or guard-options.json allows it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-opt-'));
    try {
      expect(dismissAllowed(dir, {})).toBe(false);
      expect(dismissAllowed(dir, { AE_MCP_ALLOW_DIALOG_DISMISS: '1' })).toBe(true);
      fs.writeFileSync(path.join(dir, 'guard-options.json'), JSON.stringify({ allowDialogDismiss: true }));
      expect(dismissAllowed(dir, {})).toBe(true);
      expect(dismissAllowed(dir, { AE_MCP_ALLOW_DIALOG_DISMISS: '0' })).toBe(false);
      fs.writeFileSync(path.join(dir, 'guard-options.json'), '{"allowDialogDismiss": "yes"}');
      expect(dismissAllowed(dir, {})).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('closes only plain messages, never forms', () => {
    expect(isPlainMessage(msg(['OK'], 0))).toBe(true);
    expect(isPlainMessage(msg(['OK', 'Cancel'], 3))).toBe(false);
    expect(isPlainMessage(msg(['OK']))).toBe(false); // an old helper that does not count inputs
  });

  it('presses OK, else a lone safe button, else Escape', () => {
    expect(autoDismissButton(msg(['Cancel', 'OK'], 0))).toBe('OK');
    expect(autoDismissButton(msg(['Continue'], 0))).toBe('Continue');
    expect(autoDismissButton(msg(['Reset'], 0))).toBeUndefined();
    expect(autoDismissButton(msg(["Don't Save", 'Cancel', 'Save'], 0))).toBeUndefined();
  });
});
