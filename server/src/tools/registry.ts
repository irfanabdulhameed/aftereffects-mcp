/*
 * defineTool wraps server.tool so every tool in this project:
 *   - validates input with zod and passes the transformed values on
 *   - sends its arguments to one bridge command (the tool name in camelCase)
 *     unless it declares a Node-only handler
 *   - returns JSON text, or whatever content the handler returns
 *   - reports BridgeError and other failures as isError results with a stable shape
 *   - is recorded in the catalog used by list-tools and the docs generator
 */

import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BridgeClient, getBridge, TimeoutClass } from '../bridge/client.js';
import { BridgeError, JsonValue } from '../bridge/types.js';
import { applyStyleRefs, loadStyle } from '../schemas/style.js';

export type ToolGroup =
  | 'project'
  | 'composition'
  | 'layers'
  | 'transform'
  | 'keyframes'
  | 'expressions'
  | 'text'
  | 'shapes'
  | 'masks'
  | 'effects'
  | 'presets'
  | 'camera-3d'
  | 'time'
  | 'markers-audio'
  | 'render'
  | 'batch'
  | 'rigs'
  | 'help';

export interface ToolContext {
  bridge: BridgeClient;
  /** Bridge command name for this tool, or null for Node-only tools. */
  command: string | null;
  /** Sends a command through the bridge with the tool's timeout class. */
  run: (command: string, args: Record<string, unknown>, timeout?: TimeoutClass) => Promise<JsonValue>;
}

export interface ToolDefinition<S extends z.ZodRawShape> {
  name: string;
  group: ToolGroup;
  description: string;
  input: S;
  /** true when the tool changes the project. Used by docs and list-tools. Default true. */
  mutating?: boolean;
  /** 'normal' (default), 'render', or a number of milliseconds. */
  timeout?: TimeoutClass;
  /** Bridge command. Default: the tool name in camelCase. null for Node-only tools. */
  bridge?: string | null;
  /** Reshape validated args before they are sent to the bridge. */
  toBridgeArgs?: (args: z.objectOutputType<S, z.ZodTypeAny>) => Record<string, unknown>;
  /** Custom handler. May return a CallToolResult or any JSON-serialisable value. */
  handler?: (args: z.objectOutputType<S, z.ZodTypeAny>, ctx: ToolContext) => Promise<CallToolResult | JsonValue | unknown>;
}

export interface CatalogEntry {
  name: string;
  group: ToolGroup;
  description: string;
  input: z.ZodRawShape;
  bridge: string | null;
  mutating: boolean;
  timeout: TimeoutClass;
  /** Reshapes validated args for the bridge (used by batch). */
  toBridgeArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
}

/** Replaces "@style.*" references using the configured style file, if any. */
export function resolveStyleInArgs<T>(args: T, bridge: BridgeClient): T {
  const style = loadStyle(bridge.config.styleFile);
  return applyStyleRefs(style, args);
}

/** Validates args against a catalog entry and returns what the bridge should receive. */
export function prepareBridgeArgs(entry: CatalogEntry, rawArgs: unknown, bridge: BridgeClient = getBridge()): Record<string, unknown> {
  const parsed = z.object(entry.input).parse(resolveStyleInArgs(rawArgs ?? {}, bridge));
  return entry.toBridgeArgs ? entry.toBridgeArgs(parsed) : (parsed as Record<string, unknown>);
}

export function findTool(name: string): CatalogEntry | undefined {
  return catalog.find((c) => c.name === name);
}

export const catalog: CatalogEntry[] = [];

export function kebabToCamel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function jsonResult(value: unknown, isError = false): CallToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], isError: isError || undefined };
}

function isCallToolResult(value: unknown): value is CallToolResult {
  return !!value && typeof value === 'object' && Array.isArray((value as CallToolResult).content);
}

export function errorResult(err: unknown, toolName: string): CallToolResult {
  if (err instanceof BridgeError) {
    return jsonResult({ tool: toolName, ...err.toJSON() }, true);
  }
  const e = err as Error;
  return jsonResult({ tool: toolName, error: 'tool-failed', message: e && e.message ? e.message : String(err) }, true);
}

export function defineTool<S extends z.ZodRawShape>(server: McpServer, def: ToolDefinition<S>): void {
  const command = def.bridge === undefined ? kebabToCamel(def.name) : def.bridge;
  if (command === null && !def.handler) {
    throw new Error(`Tool ${def.name} is Node-only but has no handler`);
  }
  if (catalog.some((c) => c.name === def.name)) {
    throw new Error(`Tool ${def.name} is registered twice`);
  }
  catalog.push({
    name: def.name,
    group: def.group,
    description: def.description,
    input: def.input,
    bridge: command,
    mutating: def.mutating !== false,
    timeout: def.timeout ?? 'normal',
    toBridgeArgs: def.toBridgeArgs as ((args: Record<string, unknown>) => Record<string, unknown>) | undefined,
  });

  const callback = async (rawArgs: z.objectOutputType<S, z.ZodTypeAny>): Promise<CallToolResult> => {
    const bridge = getBridge();
    const ctx: ToolContext = {
      bridge,
      command,
      run: (cmd, a, timeout) => bridge.run(cmd, a, { timeout: timeout ?? def.timeout ?? 'normal' }),
    };
    let typedArgs = rawArgs as z.objectOutputType<S, z.ZodTypeAny>;
    try {
      // Style references are resolved after zod validation, so re-validate if any were present.
      const withStyle = resolveStyleInArgs(rawArgs, bridge);
      if (withStyle !== rawArgs && JSON.stringify(withStyle) !== JSON.stringify(rawArgs)) {
        typedArgs = z.object(def.input).parse(withStyle) as z.objectOutputType<S, z.ZodTypeAny>;
      }
      if (def.handler) {
        const value = await def.handler(typedArgs, ctx);
        return isCallToolResult(value) ? value : jsonResult(value);
      }
      const bridgeArgs = def.toBridgeArgs ? def.toBridgeArgs(typedArgs) : (typedArgs as Record<string, unknown>);
      const value = await ctx.run(command as string, bridgeArgs);
      return jsonResult(value);
    } catch (err) {
      return errorResult(err, def.name);
    }
  };
  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.input,
      annotations: { readOnlyHint: def.mutating === false, destructiveHint: def.mutating !== false, openWorldHint: false },
    },
    callback as unknown as ToolCallback<S>
  );
}

/** Names of every tool that goes through the bridge, mapped to their command. */
export function bridgeCommandMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of catalog) if (entry.bridge) out[entry.name] = entry.bridge;
  return out;
}
