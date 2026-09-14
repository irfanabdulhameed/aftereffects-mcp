/*
 * Utilities: ping, versions, bridge status and options, undo and redo, batch,
 * raw ExtendScript (gated), and result retrieval.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import { z } from 'zod';
import { BridgeError } from '../bridge/types.js';
import { catalog, defineTool, findTool, jsonResult, prepareBridgeArgs } from './registry.js';

export function registerBatchTools(server: McpServer): void {
  defineTool(server, {
    name: 'ping',
    group: 'batch',
    mutating: false,
    description:
      'Checks that After Effects and the MCP Bridge Auto panel are running and answering. ' +
      'Use when: at the start of a session, or when another tool timed out and you want to know whether the bridge is alive before retrying. ' +
      'Do not use for: reading project state (use get-project-info). ' +
      'Inputs: an optional message that is echoed back. ' +
      'Returns: pong, the After Effects version, the bridge panel version and protocol, and the time inside After Effects. ' +
      'Notes: read-only, opens no undo entry of consequence. A timeout here means the panel is closed or scripting file access is off; the error text says which. ' +
      'Example: call ping with no arguments before building anything, and tell the human to open Window > mcp-bridge-auto.jsx if it fails.',
    input: { message: z.string().optional().describe('Text to echo back.') },
    timeout: 5000,
  });

  defineTool(server, {
    name: 'get-ae-version',
    group: 'batch',
    mutating: false,
    description:
      'Returns the After Effects version, build, language, operating system, expression engine and the bridge panel version. ' +
      'Use when: a tool reports "not supported in After Effects <version>" and you want to confirm the version, or before using a feature that only exists in newer releases (per-layer track mattes, the font API, saveFrameToPng). ' +
      'Do not use for: checking whether the bridge is alive (use ping). ' +
      'Inputs: none. ' +
      'Returns: version string such as "24.3", a numeric version, a guessed release year, buildName, buildNumber, language, os, bridgeVersion, protocol, expressionEngine. ' +
      'Notes: read-only. ' +
      'Example: call it once, then avoid list-fonts on versions below 24.',
    input: {},
  });

  defineTool(server, {
    name: 'get-bridge-status',
    group: 'batch',
    mutating: false,
    bridge: null,
    description:
      'Reports the health of the file bridge without waiting on After Effects: whether the panel heartbeat is recent, queue length, bridge folder, server and panel versions and whether they match, poll interval, counters and the last command. ' +
      'Use when: diagnosing timeouts, or after reinstalling the panel to confirm the versions agree. ' +
      'Do not use for: a round-trip liveness check (use ping, which actually executes inside After Effects). ' +
      'Inputs: none. ' +
      'Returns: panelAlive (heartbeat younger than 10 s), heartbeatAgeMs, queueLength, bridgeDir, serverVersion, bridgeVersion, versionsMatch, options, and the raw heartbeat. ' +
      'Notes: reads files only; never blocks. If versionsMatch is false, run npm run build and npm run install-bridge, then reopen the panel. ' +
      'Example: a tool timed out; call get-bridge-status and, if panelAlive is false, ask the human to open the panel.',
    input: {},
    handler: async (_args, ctx) => {
      const hb = ctx.bridge.readHeartbeat();
      const ageMs = hb ? Date.now() - Date.parse(hb.at) : null;
      const { SERVER_VERSION } = await import('../version.js');
      return {
        panelAlive: ageMs !== null && ageMs < 10000,
        heartbeatAgeMs: ageMs,
        queueLength: ctx.bridge.queueLength(),
        bridgeDir: ctx.bridge.paths.root,
        serverVersion: SERVER_VERSION,
        bridgeVersion: hb ? hb.bridgeVersion : null,
        versionsMatch: hb ? hb.bridgeVersion === SERVER_VERSION : null,
        protocol: hb ? hb.protocol : null,
        options: ctx.bridge.readOptions(),
        config: {
          timeoutMs: ctx.bridge.config.timeoutMs,
          renderTimeoutMs: ctx.bridge.config.renderTimeoutMs,
          serverPollMs: ctx.bridge.config.serverPollMs,
          allowRawScript: ctx.bridge.config.allowRawScript,
          styleFile: ctx.bridge.config.styleFile ?? null,
        },
        heartbeat: hb ?? null,
      };
    },
  });

  defineTool(server, {
    name: 'set-bridge-options',
    group: 'batch',
    mutating: false,
    description:
      'Changes how often the panel inside After Effects checks the queue and how much it logs. ' +
      'Use when: a long batch of small commands feels slow (lower pollMs to 200) or the panel log is too noisy (verbosity 0). ' +
      'Do not use for: server-side timeouts, which come from environment variables (AE_MCP_TIMEOUT_MS). ' +
      'Inputs: pollMs between 100 and 10000 (default 500); verbosity 0 (errors only), 1 (normal) or 2 (debug). ' +
      'Returns: the options now in effect, as confirmed by the panel. ' +
      'Notes: the change is written to bridge-options.json in the bridge folder and survives panel restarts. Very low poll intervals cost After Effects UI responsiveness. ' +
      'Example: before a 200-step build, set pollMs to 200, then restore 500 afterwards.',
    input: {
      pollMs: z.number().int().min(100).max(10000).optional().describe('Panel poll interval in milliseconds.'),
      verbosity: z.number().int().min(0).max(2).optional().describe('0 quiet, 1 normal, 2 debug.'),
    },
    handler: async (args, ctx) => {
      ctx.bridge.writeOptions({ pollMs: args.pollMs, verbosity: args.verbosity });
      return ctx.run('setBridgeOptions', args);
    },
  });

  defineTool(server, {
    name: 'undo',
    group: 'batch',
    description:
      'Undoes the last change in After Effects, the same as Edit > Undo. Every tool in this server runs inside one undo group named "MCP: <tool>", so one undo reverts one tool call in full, and one undo reverts a whole batch. ' +
      'Use when: a build step produced the wrong result and you want to revert it cleanly before trying again, instead of deleting layers by hand. ' +
      'Do not use for: reverting the human\'s own edits (ask first). ' +
      'Inputs: count, how many undo steps (default 1). ' +
      'Returns: how many steps were undone. ' +
      'Notes: undo history is shared with the human; check list-layers after undoing so your picture of the comp stays right. ' +
      'Example: rig-edge-glow built with the wrong colours, call undo once, then rebuild.',
    input: { count: z.number().int().min(1).max(50).optional().describe('Number of undo steps. Default 1.') },
  });

  defineTool(server, {
    name: 'redo',
    group: 'batch',
    description:
      'Redoes the last undone change in After Effects, the same as Edit > Redo. ' +
      'Use when: you undid one step too many. ' +
      'Do not use for: replaying a tool call; just call the tool again. ' +
      'Inputs: count, how many redo steps (default 1). ' +
      'Returns: how many steps were redone. ' +
      'Notes: redo history is cleared by any new change, so redo right after undo or not at all. ' +
      'Example: undo twice, look at the frame, redo once to keep the first change.',
    input: { count: z.number().int().min(1).max(50).optional().describe('Number of redo steps. Default 1.') },
  });

  defineTool(server, {
    name: 'batch',
    group: 'batch',
    bridge: null,
    description:
      'Runs several tool calls in one round-trip to After Effects, inside one undo group. This is the fastest way to build anything with more than two or three steps: one queue file, one result file, one undo entry. ' +
      'Use when: building a title card, a lower third, a rig, or applying the same change to many layers. ' +
      'Do not use for: tools that return images (see-frame) or Node-only tools (list-presets, analyze-audio-waveform, get-help); those must be called on their own. ' +
      'Inputs: steps, an array of {tool, args, label?} using the same tool names and argument shapes as the individual tools; stopOnError (default true) stops at the first failing step and marks the rest skipped. ' +
      'Returns: per-step status (ok, error, skipped), each step\'s normal result, timing, and counts. ' +
      'Notes: arguments are validated on the server before anything is sent, so a typo in step 7 fails fast with nothing changed. Layer indices shift as layers are created; prefer names or ids for steps that follow a create step. ' +
      'Example: steps = [create-composition, create-text-layer, set-keyframes-bulk on Opacity, set-keyframes-bulk on Position].',
    input: {
      steps: z
        .array(
          z.object({
            tool: z.string().describe('Tool name, kebab-case, for example "create-text-layer".'),
            args: z.record(z.unknown()).optional().describe('Arguments for that tool.'),
            label: z.string().optional().describe('Free text echoed back in the result, useful for matching steps.'),
          })
        )
        .min(1)
        .max(200),
      stopOnError: z.boolean().optional().describe('Stop at the first failing step. Default true.'),
    },
    timeout: 'render',
    handler: async (args, ctx) => {
      const prepared: Array<{ command: string; args: Record<string, unknown>; label: string | null }> = [];
      const problems: Array<{ step: number; tool: string; message: string }> = [];
      args.steps.forEach((step, i) => {
        const entry = findTool(step.tool);
        if (!entry) {
          problems.push({ step: i, tool: step.tool, message: `Unknown tool. Use list-tools to see the names.` });
          return;
        }
        if (!entry.bridge) {
          problems.push({ step: i, tool: step.tool, message: `${step.tool} runs on the server and cannot be part of a batch. Call it on its own.` });
          return;
        }
        try {
          prepared.push({ command: entry.bridge, args: prepareBridgeArgs(entry, step.args ?? {}), label: step.label ?? null });
        } catch (err) {
          const e = err as Error;
          problems.push({ step: i, tool: step.tool, message: e.message });
        }
      });
      if (problems.length) {
        return jsonResult({ error: 'invalid-batch', message: 'Some steps have invalid arguments; nothing was sent to After Effects.', problems }, true);
      }
      const result = await ctx.run('batch', { steps: prepared, stopOnError: args.stopOnError ?? true }, 'render');
      // Put the tool names back so the agent can read the result without translating.
      if (result && typeof result === 'object' && !Array.isArray(result) && Array.isArray((result as { results?: unknown[] }).results)) {
        const rows = (result as { results: Array<Record<string, unknown>> }).results;
        rows.forEach((row, i) => {
          row.tool = args.steps[i]?.tool;
        });
      }
      return result;
    },
  });

  defineTool(server, {
    name: 'run-extendscript',
    group: 'batch',
    description:
      'Evaluates an arbitrary ExtendScript string inside After Effects, wrapped in one undo group, and returns whatever the script evaluates to. This can do anything the scripting API can, including deleting the project. It is disabled unless the server was started with AE_MCP_ALLOW_RAW_SCRIPT=1. ' +
      'Use when: no dedicated tool covers what you need and the human has enabled it. ' +
      'Do not use for: anything a listed tool already does; prefer the tool because it validates input, returns structured state and is tested. ' +
      'Inputs: script, ECMAScript 3 only (no let, const, arrow functions, template strings). The last expression is the return value; return plain objects, arrays, numbers or strings. ' +
      'Returns: the value, or a string form of it, plus its type. ' +
      'Notes: errors include the line number inside your script. Undo reverts the whole script. ' +
      'Example: script = "app.project.activeItem.numLayers".',
    input: { script: z.string().min(1).describe('ExtendScript (ES3) source. The last evaluated expression is returned.') },
    handler: async (args, ctx) => {
      if (!ctx.bridge.config.allowRawScript) {
        throw new BridgeError('disabled', 'run-extendscript is disabled. Start the server with AE_MCP_ALLOW_RAW_SCRIPT=1 to enable it.', { command: 'runExtendscript' });
      }
      return ctx.run('runExtendscript', { script: args.script });
    },
  });

  defineTool(server, {
    name: 'get-results',
    group: 'batch',
    mutating: false,
    bridge: null,
    description:
      'Fetches the stored result of an earlier command by its id, or lists the most recent results. Every command the panel executes writes results/res-<id>.json in the bridge folder; a timeout error tells you the id to look up. ' +
      'Use when: a render or long batch timed out and you want its outcome once it finishes, or to review what ran recently. ' +
      'Do not use for: normal calls, which already wait for and return their result. ' +
      'Inputs: id (optional). Without it, limit (default 10) most recent results are listed newest first. ' +
      'Returns: with id, the full result envelope (status, result or error, timing, versions). Without id, a list of {id, command, status, finishedAt, durationMs}. ' +
      'Notes: results older than an hour are removed when the server starts (AE_MCP_RESULT_MAX_AGE_MS). ' +
      'Example: after "render is still running" with id "lq3k9x1a2b", call get-results with that id a minute later.',
    input: {
      id: z.string().optional().describe('Command id from a previous tool result or timeout message.'),
      limit: z.number().int().min(1).max(100).optional().describe('How many recent results to list when id is omitted. Default 10.'),
    },
    handler: async (args, ctx) => {
      if (args.id) {
        const res = ctx.bridge.readResult(args.id);
        if (!res) {
          const state = ctx.bridge.commandState(args.id);
          return jsonResult({ id: args.id, found: false, state, message: state === 'done' ? 'No result file with that id. It may have been cleaned up, or the id is wrong.' : `The command is still ${state}.` }, state === 'done');
        }
        return res;
      }
      const recent = ctx.bridge.listRecentResults(args.limit ?? 10);
      return { count: recent.length, results: recent.map((r) => ({ id: r.id, command: r.command, status: r.status, finishedAt: r.finishedAt, durationMs: r.durationMs })) };
    },
  });

  defineTool(server, {
    name: 'list-tools',
    group: 'help',
    mutating: false,
    bridge: null,
    description:
      'Lists every tool this server offers, grouped by category, with a one-line summary of each. ' +
      'Use when: you are unsure which tool does something, or before writing a batch and you want the exact names. ' +
      'Do not use for: full argument details; the tool\'s own schema has them, and docs/TOOLS.md has examples. ' +
      'Inputs: group (optional) to list one category; search (optional) to filter by a word in the name or description. ' +
      'Returns: count and a list of {name, group, mutating, summary}. ' +
      'Notes: read-only, does not touch After Effects. ' +
      'Example: search "keyframe" to find set-keyframes-bulk and stagger-keyframes-across-layers.',
    input: {
      group: z.string().optional().describe('Category name such as "layers" or "keyframes".'),
      search: z.string().optional().describe('Case-insensitive text to match in the name or description.'),
    },
    handler: async (args) => {
      const q = args.search ? args.search.toLowerCase() : undefined;
      const tools = catalog
        .filter((c) => (args.group ? c.group === args.group : true))
        .filter((c) => (q ? c.name.includes(q) || c.description.toLowerCase().includes(q) : true))
        .map((c) => ({ name: c.name, group: c.group, mutating: c.mutating, summary: c.description.split('. ')[0] + '.' }));
      const groups: Record<string, number> = {};
      for (const c of catalog) groups[c.group] = (groups[c.group] ?? 0) + 1;
      return { count: tools.length, total: catalog.length, groups, tools };
    },
  });

  // Keep fs referenced for platforms where tree-shaking removes unused imports.
  void fs;
}
