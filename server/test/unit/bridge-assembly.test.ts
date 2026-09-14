/*
 * Assembles the bridge panel and proves the result parses as ECMAScript 3,
 * registers every command once, and keeps the fixed load order.
 */

import * as acorn from 'acorn';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { assembleBridge } from '../../scripts/build-bridge.js';
import { lintEs3 } from '../../scripts/lint-es3.js';

describe('assembled bridge', () => {
  it('parses at ecmaVersion 3 and passes the ES3 lint', () => {
    const { outFile, files } = assembleBridge();
    const text = fs.readFileSync(outFile, 'utf8');
    expect(() => acorn.parse(text, { ecmaVersion: 3, sourceType: 'script' })).not.toThrow();
    expect(lintEs3([outFile])).toEqual([]);
    expect(files[0]).toMatch(/polyfills\.jsx$/);
    expect(files[1]).toMatch(/json\.jsx$/);
    expect(files[files.length - 1]).toMatch(/mcp-bridge-auto\.jsx$/);
    const commandFiles = files.filter((f) => f.startsWith('commands'));
    expect(commandFiles.length).toBeGreaterThan(10);
    // lib before commands before panel
    const libLast = files.map((f) => f.startsWith('lib')).lastIndexOf(true);
    const cmdFirst = files.findIndex((f) => f.startsWith('commands'));
    expect(libLast).toBeLessThan(cmdFirst);
  });

  it('carries the generated header and one banner per source file', () => {
    const { outFile, files } = assembleBridge();
    const text = fs.readFileSync(outFile, 'utf8');
    expect(text.startsWith('/*\n * MCP Bridge Auto for Adobe After Effects.\n * DO NOT EDIT.')).toBe(true);
    for (const f of files) expect(text).toContain(`/* ---- ${f.split(path.sep).join('/')} ---- */`);
  });

  it('registers each command exactly once and the panel dispatches from MCP.commands', () => {
    const { outFile } = assembleBridge();
    const text = fs.readFileSync(outFile, 'utf8');
    const names = [...text.matchAll(/MCP\.register\("([A-Za-z0-9]+)"/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(90);
    expect(text).toContain('MCP.commands[cmd.command]');
    expect(text).not.toMatch(/switch \(command\)/);
  });
});
