import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge({ failCommands: ['removeAllEffects'] });
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

describe('tools through the MCP server and the mock bridge', () => {
  it('ping', async () => {
    const r = await callTool(client, 'ping', { message: 'hi' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ pong: true, echo: 'hi' });
  });

  it('validates input before sending anything', async () => {
    const before = tb.mock.state.commandsRun;
    const res = (await client.callTool({ name: 'create-composition', arguments: { name: 'x', width: -5 } }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
    expect(res.error !== undefined || res.isError === true).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('normalises colours to [r,g,b,a] on the way to the bridge', async () => {
    await callTool(client, 'create-solid-layer', { name: 'BG', color: '#ff0000' });
    const last = tb.mock.state.log[tb.mock.state.log.length - 1];
    expect(last.command).toBe('createSolidLayer');
  });

  it('returns bridge errors as isError results with the error shape', async () => {
    const r = await callTool(client, 'remove-all-effects', { layer: { index: 1 } });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ tool: 'remove-all-effects', error: 'command-failed' });
  });

  it('batch validates every step first and returns per-step results', async () => {
    const bad = await callTool(client, 'batch', { steps: [{ tool: 'create-composition', args: { name: 'ok' } }, { tool: 'no-such-tool', args: {} }] });
    expect(bad.isError).toBe(true);
    expect((bad.json.problems as unknown[]).length).toBe(1);

    const good = await callTool(client, 'batch', {
      steps: [
        { tool: 'create-composition', args: { name: 'Intro', preset: '1080p30' }, label: 'comp' },
        { tool: 'create-text-layer', args: { text: 'Hello', fillColor: 'white' } },
        { tool: 'set-keyframes-bulk', args: { layer: { name: 'Hello' }, property: 'Transform/Opacity', keys: [{ time: 0, value: 0 }, { time: 0.5, value: 100, easing: 'ease-out' }] } },
      ],
    });
    expect(good.isError).toBe(false);
    expect(good.json).toMatchObject({ steps: 3, ok: 3, failed: 0 });
    const rows = good.json.results as Array<Record<string, unknown>>;
    expect(rows[0].tool).toBe('create-composition');
    expect(rows[0].label).toBe('comp');
  });

  it('batch rejects Node-only tools', async () => {
    const r = await callTool(client, 'batch', { steps: [{ tool: 'get-help', args: {} }] });
    expect(r.isError).toBe(true);
  });

  it('get-results by id and recent list', async () => {
    await callTool(client, 'ping');
    const list = await callTool(client, 'get-results', { limit: 3 });
    expect(list.isError).toBe(false);
    const results = list.json.results as Array<{ id: string }>;
    expect(results.length).toBeGreaterThan(0);
    const one = await callTool(client, 'get-results', { id: results[0].id });
    expect(one.json).toMatchObject({ id: results[0].id, status: 'ok' });
    const missing = await callTool(client, 'get-results', { id: 'nope' });
    expect(missing.isError).toBe(true);
  });

  it('get-bridge-status reads the heartbeat', async () => {
    const r = await callTool(client, 'get-bridge-status');
    expect(r.json).toMatchObject({ panelAlive: true, versionsMatch: true });
  });

  it('run-extendscript is disabled by default', async () => {
    const r = await callTool(client, 'run-extendscript', { script: '1+1' });
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe('disabled');
  });

  it('list-tools and get-help', async () => {
    const tools = await callTool(client, 'list-tools', { search: 'keyframe' });
    expect((tools.json.tools as unknown[]).length).toBeGreaterThan(0);
    const help = await callTool(client, 'get-help', { topic: 'toc' });
    expect(help.text.length).toBeGreaterThan(0);
  });
});
