/*
 * Bridge directory layout and environment configuration.
 *
 * ~/Documents/ae-mcp-bridge/          AE_MCP_BRIDGE_DIR overrides the root
 *   queue/cmd-<createdAt>-<seq>-<id>.json   commands waiting for the panel
 *   queue/running-<createdAt>-<seq>-<id>.json   a command the panel is executing
 *   results/res-<id>.json             one result per command
 *   frames/                           PNG frames written by see-frame and friends
 *   heartbeat.json                    written by the panel every couple of seconds
 *   bridge-options.json               poll interval and verbosity for the panel
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function envNumber(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface BridgeConfig {
  /** Root folder shared between the server and the panel. */
  bridgeDir: string;
  /** Milliseconds a normal command waits for a result. */
  timeoutMs: number;
  /** Milliseconds a render or export command waits for a result. */
  renderTimeoutMs: number;
  /** Milliseconds between result-file checks on the server side. */
  serverPollMs: number;
  /** Milliseconds between queue checks inside After Effects. Written to bridge-options.json. */
  bridgePollMs: number | undefined;
  /** Results older than this are removed on server start. */
  resultMaxAgeMs: number;
  /** Whether run-extendscript is enabled. */
  allowRawScript: boolean;
  /** Optional style file path. */
  styleFile: string | undefined;
  /** Log verbosity for the panel: 0 quiet, 1 normal, 2 debug. */
  bridgeVerbosity: number | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const bridgeDir = env.AE_MCP_BRIDGE_DIR && env.AE_MCP_BRIDGE_DIR.trim() !== ''
    ? path.resolve(env.AE_MCP_BRIDGE_DIR)
    : path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
  const pollRaw = env.AE_MCP_BRIDGE_POLL_MS;
  const verbosityRaw = env.AE_MCP_BRIDGE_VERBOSITY;
  return {
    bridgeDir,
    timeoutMs: envNumber('AE_MCP_TIMEOUT_MS', 15000, env),
    renderTimeoutMs: envNumber('AE_MCP_RENDER_TIMEOUT_MS', 600000, env),
    serverPollMs: envNumber('AE_MCP_SERVER_POLL_MS', 100, env),
    bridgePollMs: pollRaw !== undefined && pollRaw !== '' ? envNumber('AE_MCP_BRIDGE_POLL_MS', 500, env) : undefined,
    resultMaxAgeMs: envNumber('AE_MCP_RESULT_MAX_AGE_MS', 60 * 60 * 1000, env),
    allowRawScript: env.AE_MCP_ALLOW_RAW_SCRIPT === '1' || env.AE_MCP_ALLOW_RAW_SCRIPT === 'true',
    styleFile: env.AE_MCP_STYLE_FILE && env.AE_MCP_STYLE_FILE.trim() !== '' ? path.resolve(env.AE_MCP_STYLE_FILE) : undefined,
    bridgeVerbosity: verbosityRaw !== undefined && verbosityRaw !== '' ? Number(verbosityRaw) : undefined,
  };
}

export interface BridgePaths {
  root: string;
  queue: string;
  results: string;
  frames: string;
  heartbeat: string;
  options: string;
}

export function bridgePaths(bridgeDir: string): BridgePaths {
  return {
    root: bridgeDir,
    queue: path.join(bridgeDir, 'queue'),
    results: path.join(bridgeDir, 'results'),
    frames: path.join(bridgeDir, 'frames'),
    heartbeat: path.join(bridgeDir, 'heartbeat.json'),
    options: path.join(bridgeDir, 'bridge-options.json'),
  };
}

export function ensureBridgeDirs(paths: BridgePaths): void {
  for (const dir of [paths.root, paths.queue, paths.results, paths.frames]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
