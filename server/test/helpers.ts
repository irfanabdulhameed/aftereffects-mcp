import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BridgeClient, setBridge } from '../src/bridge/client.js';
import { loadConfig } from '../src/bridge/paths.js';
import { startMockBridge } from './bridge-mock/mock-ae.js';

export interface TestBridge {
  dir: string;
  client: BridgeClient;
  mock: ReturnType<typeof startMockBridge>;
  cleanup: () => void;
}

/** A temporary bridge folder with the mock panel answering commands. */
export function makeTestBridge(opts: { failCommands?: string[]; delays?: Record<string, number>; timeoutMs?: number; startMock?: boolean } = {}): TestBridge {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-test-'));
  const config = loadConfig({ AE_MCP_BRIDGE_DIR: dir, AE_MCP_TIMEOUT_MS: String(opts.timeoutMs ?? 3000), AE_MCP_SERVER_POLL_MS: '10', AE_MCP_RENDER_TIMEOUT_MS: '5000' });
  const client = new BridgeClient(config);
  setBridge(client);
  const mock = startMockBridge({ bridgeDir: dir, pollMs: 15, failCommands: opts.failCommands ?? [], delays: opts.delays ?? {} });
  if (opts.startMock === false) mock.stop();
  return {
    dir,
    client,
    mock,
    cleanup() {
      mock.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Builds an in-process MCP server plus client connected over a memory transport. */
export async function makeTestServer() {
  const { createServer } = await import('../src/index.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { server, client };
}

export async function callTool(client: { callTool: (a: { name: string; arguments: Record<string, unknown> }) => Promise<unknown> }, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
  const text = res.content.find((c) => c.type === 'text')?.text ?? '';
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { raw: res, text, json: json as Record<string, unknown>, isError: !!res.isError };
}
