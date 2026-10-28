// Tool packs: the core list at start, switching packs with a list-changed notice, call-tool for tools that are off.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { callTool, makeTestBridge, type TestBridge } from '../helpers.js';
import { catalog, clientDescription } from '../../src/tools/registry.js';
import { CORE_TOOLS, PACK_SUMMARIES, parseToolSelection } from '../../src/tools/packs.js';

let tb: TestBridge;
let client: any;
let listChanged = 0;

beforeAll(async () => {
  tb = makeTestBridge();
  const { createServer } = await import('../../src/index.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = createServer({ tools: 'core' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'packs-test', version: '0.0.0' });
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listChanged++;
  });
  await client.connect(clientTransport);
});
afterAll(() => tb.cleanup());

const listed = async (): Promise<string[]> => (await client.listTools()).tools.map((t: { name: string }) => t.name);

describe('tool packs', () => {
  it('starts with the core tools only, and every core name is a real tool', async () => {
    const names = await listed();
    expect(names.sort()).toEqual([...CORE_TOOLS].sort());
    for (const name of CORE_TOOLS) expect(catalog.some((c) => c.name === name), name).toBe(true);
    for (const c of catalog) expect(PACK_SUMMARIES[c.group], c.group).toBeTruthy();
  });

  it('switches a pack on with one list-changed notice and off again', async () => {
    const before = listChanged;
    const r = await callTool(client, 'tool-packs', { enable: ['charts'] });
    expect(r.isError).toBe(false);
    await new Promise((res) => setTimeout(res, 20));
    expect(listChanged).toBe(before + 1);
    const names = await listed();
    expect(names).toContain('create-bar-chart');
    expect(names.length).toBe(CORE_TOOLS.length + 7);
    expect((r.json as any).enabled).toEqual(['charts']);
    await callTool(client, 'tool-packs', { disable: ['all'] });
    expect((await listed()).length).toBe(CORE_TOOLS.length);
  });

  it('lists the packs without changing anything, and refuses an unknown pack', async () => {
    const before = listChanged;
    const r = await callTool(client, 'tool-packs', {});
    const packs = (r.json as any).packs as Array<{ name: string; tools: number; enabled: boolean }>;
    expect(packs.find((p) => p.name === 'ui-demo')).toMatchObject({ tools: 6, enabled: false });
    expect(packs.some((p) => p.name === 'help')).toBe(false);
    const bad = await callTool(client, 'tool-packs', { enable: ['sparkles'] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Unknown pack: sparkles/);
    expect(listChanged).toBe(before);
  });

  it('call-tool runs a tool whose pack is off, and validates its arguments', async () => {
    expect(await listed()).not.toContain('rename-layer');
    const ok = await callTool(client, 'call-tool', { tool: 'rename-layer', args: { layer: { index: 1 }, newName: 'Title' } });
    expect(ok.isError, ok.text).toBe(false);
    expect(tb.mock.state.lastCommand).toBe('renameLayer');
    const bad = await callTool(client, 'call-tool', { tool: 'create-bar-chart', args: { data: 'Q1' } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/invalid-argument/);
    const missing = await callTool(client, 'call-tool', { tool: 'make-magic' });
    expect(missing.isError).toBe(true);
  });

  it('list-tools marks what is active and gives schemas on request', async () => {
    const r = await callTool(client, 'list-tools', { names: ['create-bar-chart', 'see-frame'], schema: true });
    const tools = (r.json as any).tools as Array<{ name: string; active: boolean; inputSchema: any }>;
    expect(tools.find((t) => t.name === 'see-frame')?.active).toBe(true);
    const chart = tools.find((t) => t.name === 'create-bar-chart');
    expect(chart?.active).toBe(false);
    expect(chart?.inputSchema.properties.data).toBeTruthy();
    expect((await callTool(client, 'list-tools', { schema: true })).isError).toBe(true);
  });
});

describe('selection and descriptions', () => {
  it('parses AE_MCP_TOOLS', () => {
    expect(parseToolSelection(undefined)).toEqual({ packs: [], unknown: [] });
    expect(parseToolSelection('core')).toEqual({ packs: [], unknown: [] });
    expect(parseToolSelection('charts, ui-demo').packs).toEqual(['charts', 'ui-demo']);
    expect(parseToolSelection('ALL').packs.length).toBe(Object.keys(PACK_SUMMARIES).length - 1);
    expect(parseToolSelection('charts,bogus').unknown).toEqual(['bogus']);
  });

  it('client descriptions drop Inputs and Example and keep the rest', () => {
    const full = 'Does X. Use when: Y. Inputs: a, b (default 1). Returns: Z. Notes: N. Example: a 1.';
    expect(clientDescription(full)).toBe('Does X. Use when: Y. Returns: Z. Notes: N.');
    for (const c of catalog) expect(clientDescription(c.description), c.name).not.toMatch(/\b(Inputs|Example):/);
  });
});
