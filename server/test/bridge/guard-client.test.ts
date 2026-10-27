import * as fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeClient } from '../../src/bridge/client.js';
import { loadConfig } from '../../src/bridge/paths.js';
import { BridgeError } from '../../src/bridge/types.js';
import type { BridgeGuard } from '../../src/guard/guard.js';
import { makeTestBridge, TestBridge } from '../helpers.js';

let tb: TestBridge | undefined;
afterEach(() => {
  tb?.cleanup();
  tb = undefined;
});

function fakeGuard(over: Partial<BridgeGuard> = {}) {
  const calls = { before: 0, released: 0, held: 0, explained: 0 };
  const guard: BridgeGuard = {
    async beforeCommand() {
      calls.before++;
      return () => {
        calls.released++;
      };
    },
    holdUntilDone(_c, _id, release) {
      calls.held++;
      release();
    },
    async explain() {
      calls.explained++;
      return { state: 'dialog', summary: 'A dialog is open in After Effects: "Unable to execute script".', advice: ['Close the dialog.'] };
    },
    async status() {
      throw new Error('not used');
    },
    ...over,
  };
  return { guard, calls };
}

describe('BridgeClient with the AE guard', () => {
  it('asks the guard first and releases the lock after the result', async () => {
    tb = makeTestBridge();
    const { guard, calls } = fakeGuard();
    const client = new BridgeClient(tb.client.config, { guard });
    const res = (await client.run('ping', { message: 'hi' })) as { echo: string };
    expect(res.echo).toBe('hi');
    expect(calls).toMatchObject({ before: 1, released: 1, held: 0, explained: 0 });
  });

  it('sends nothing when the guard refuses', async () => {
    tb = makeTestBridge({ startMock: false });
    const { guard } = fakeGuard({
      async beforeCommand() {
        throw new BridgeError('dialog-open', 'A dialog is open in After Effects.', { command: 'ping' });
      },
    });
    const client = new BridgeClient(tb.client.config, { guard });
    await expect(client.run('ping', {})).rejects.toMatchObject({ code: 'dialog-open' });
    expect(fs.readdirSync(client.paths.queue)).toHaveLength(0);
  });

  it('explains a command that was never picked up and releases the lock', async () => {
    tb = makeTestBridge({ startMock: false });
    const { guard, calls } = fakeGuard();
    const config = loadConfig({ AE_MCP_BRIDGE_DIR: tb.dir, AE_MCP_TIMEOUT_MS: '200', AE_MCP_SERVER_POLL_MS: '10' });
    const client = new BridgeClient(config, { guard });
    try {
      await client.run('ping', {});
      expect.unreachable();
    } catch (err) {
      const e = err as BridgeError;
      expect(e.code).toBe('bridge-not-running');
      expect(e.message).toMatch(/Guard: A dialog is open/);
      expect((e.details as Record<string, unknown>).guardState).toBe('dialog');
    }
    expect(calls).toMatchObject({ before: 1, released: 1, explained: 1, held: 0 });
  });

  it('holds the lock while a timed-out command is still running', async () => {
    tb = makeTestBridge({ delays: { ping: 600 } });
    const { guard, calls } = fakeGuard();
    const config = loadConfig({ AE_MCP_BRIDGE_DIR: tb.dir, AE_MCP_TIMEOUT_MS: '200', AE_MCP_SERVER_POLL_MS: '10' });
    const client = new BridgeClient(config, { guard });
    await expect(client.run('ping', {})).rejects.toMatchObject({ code: 'timeout' });
    expect(calls).toMatchObject({ before: 1, held: 1, explained: 1 });
  });
});
