/*
 * After Effects MCP server entry point.
 * Creates the server, registers every tool group, seeds bridge options from
 * the environment, cleans up old results, and starts the stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getBridge } from './bridge/client.js';
import { registerAllTools } from './tools/all.js';
import { SERVER_VERSION } from './version.js';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'AfterEffectsMCP', version: SERVER_VERSION });
  registerAllTools(server);
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
