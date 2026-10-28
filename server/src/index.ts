/*
 * After Effects MCP server entry point.
 * Creates the server, registers every tool group, seeds bridge options from
 * the environment, cleans up old results, and starts the stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getBridge } from './bridge/client.js';
import { registerAllTools } from './tools/all.js';
import { applyPacks, parseToolSelection } from './tools/packs.js';
import { SERVER_VERSION } from './version.js';

const INSTRUCTIONS =
  'Builds and edits inside a running Adobe After Effects. The core tools are always listed; more come in packs ' +
  '(charts, ui-demo, scenes, transitions, motion-rigs, components, camera-3d, masks, styles, markers-audio and others): ' +
  'call tool-packs to see and switch them on, and call-tool if new tools do not appear. Start with get-help for the workflow; ' +
  'check your work with see-frame before reporting.';

/** tools: "core" (default), "all", or a comma list of packs; defaults to AE_MCP_TOOLS. */
export function createServer(options: { tools?: string } = {}): McpServer {
  const server = new McpServer({ name: 'AfterEffectsMCP', version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  registerAllTools(server);
  const selection = parseToolSelection(options.tools ?? process.env.AE_MCP_TOOLS);
  if (selection.unknown.length) console.error(`AE_MCP_TOOLS: unknown pack ${selection.unknown.join(', ')} (ignored).`);
  applyPacks(server, selection.packs);
  return server;
}

async function main(): Promise<void> {
  const bridge = getBridge();
  bridge.applyEnvironmentOptions();
  const removed = bridge.cleanupOldResults();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`After Effects MCP server ${SERVER_VERSION} running. Bridge folder: ${bridge.paths.root}${removed ? ` (removed ${removed} old result files)` : ''}`);
}

const isDirectRun = process.argv[1] !== undefined && /index\.js$/.test(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
