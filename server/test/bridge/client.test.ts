import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/bridge/types.js';
import { makeTestBridge, TestBridge } from '../helpers.js';

let tb: TestBridge | undefined;
afterEach(() => {
  tb?.cleanup();
  tb = undefined;
});

describe('BridgeClient', () => {
  it('generates unique ids and writes command files atomically', () => {
    tb = makeTestBridge({ startMock: false });
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(tb.client.newId());
    expect(ids.size).toBe(50);
    const { id, file } = tb.client.enqueue('ping', { message: 'x' });
    expect(fs.existsSync(file)).toBe(true);
    expect(path.basename(file).startsWith('cmd-')).toBe(true);
    expect(path.basename(file).endsWith(`-${id}.json`)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed).toMatchObject({ id, command: 'ping', args: { message: 'x' }, status: 'pending', protocol: 2 });
    expect(fs.readdirSync(tb.client.paths.queue).filter((n) => n.startsWith('.tmp-'))).toHaveLength(0);
  });

  it('round-trips a command through the mock bridge and matches on id', async () => {
    tb = makeTestBridge();
    const a = tb.client.run('ping', { message: 'a' });
    const b = tb.client.run('ping', { message: 'b' });
    const [ra, rb] = (await Promise.all([a, b])) as Array<{ echo: string }>;
    expect(ra.echo).toBe('a');
    expect(rb.echo).toBe('b');
    expect(fs.readdirSync(tb.client.paths.queue)).toHaveLength(0);
  });

  it('preserves queue order for many commands', async () => {
    tb = makeTestBridge();
    const promises = [];
    for (let i = 0; i < 20; i++) promises.push(tb.client.run('ping', { message: String(i) }));
    const results = (await Promise.all(promises)) as Array<{ echo: string }>;
    results.forEach((r, i) => expect(r.echo).toBe(String(i)));
    expect(tb.mock.state.log.map((l) => l.command)).toHaveLength(20);
  });

  it('propagates bridge errors with code, line and file name', async () => {
    tb = makeTestBridge({ failCommands: ['createComposition'] });
    await expect(tb.client.run('createComposition', { name: 'x' })).rejects.toBeInstanceOf(BridgeError);
    try {
      await tb.client.run('createComposition', { name: 'x' });
    } catch (err) {
      const e = err as BridgeError;
      expect(e.code).toBe('command-failed');
      expect(e.inner?.code).toBe('mock-failure');
      expect(e.inner?.line).toBe(42);
      expect(e.inner?.fileName).toBe('mock-ae.js');
      expect(e.toJSON().bridgeError).toBeDefined();
    }
  });

  it('reports bridge-not-running and removes the pending command when nothing picks it up', async () => {
    tb = makeTestBridge({ startMock: false, timeoutMs: 200 });
    await expect(tb.client.run('ping')).rejects.toMatchObject({ code: 'bridge-not-running' });
    expect(fs.readdirSync(tb.client.paths.queue)).toHaveLength(0);
  });

  it('reports timeout while a command is still running and get-results finds it later', async () => {
    tb = makeTestBridge({ delays: { slowTestCommand: 600 }, timeoutMs: 150 });
    let caught: BridgeError | undefined;
    try {
      await tb.client.run('slowTestCommand', {});
    } catch (err) {
      caught = err as BridgeError;
    }
    expect(caught?.code).toBe('timeout');
    const id = caught?.id as string;
    expect(tb.client.commandState(id)).toBe('running');
    await new Promise((r) => setTimeout(r, 800));
    const res = tb.client.readResult(id);
    expect(res?.status).toBe('ok');
    expect(tb.client.listRecentResults(5)[0]?.id).toBe(id);
  });

  it('uses the render timeout class', async () => {
    tb = makeTestBridge({ delays: { slowTestCommand: 300 }, timeoutMs: 100 });
    const res = await tb.client.run('slowTestCommand', {}, { timeout: 'render' });
    expect(res).toMatchObject({ mock: true, command: 'slowTestCommand' });
  });

  it('reads the heartbeat and options, and cleans old results', async () => {
    tb = makeTestBridge();
    await tb.client.run('ping');
    const hb = tb.client.readHeartbeat();
    expect(hb?.protocol).toBe(2);
    tb.client.writeOptions({ pollMs: 250 });
    expect(tb.client.readOptions()).toMatchObject({ pollMs: 250 });
    const res = tb.client.listRecentResults(10);
    expect(res.length).toBeGreaterThan(0);
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    fs.utimesSync(res[0].file, old, old);
    expect(tb.client.cleanupOldResults(3600 * 1000)).toBeGreaterThanOrEqual(1);
  });
});
