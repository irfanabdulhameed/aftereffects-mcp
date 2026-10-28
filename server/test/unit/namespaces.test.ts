import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const SCRIPTS = path.resolve(__dirname, '..', '..', 'src', 'scripts');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.jsx') ? [path.join(dir, e.name)] : []));
}

function topLevelNames(file: string): string[] {
  return [...fs.readFileSync(file, 'utf8').matchAll(/^MCP\.([A-Za-z0-9_]+)\s*=/gm)].map((m) => m[1]);
}

describe('ExtendScript namespaces', () => {
  it('no command or lib file assigns a top-level MCP name the panel also assigns (the panel loads last and would replace it)', () => {
    const panel = new Set(topLevelNames(path.join(SCRIPTS, 'panel', 'mcp-bridge-auto.jsx')));
    const clashes: string[] = [];
    for (const f of [...files(path.join(SCRIPTS, 'commands')), ...files(path.join(SCRIPTS, 'lib'))]) {
      for (const n of topLevelNames(f)) if (panel.has(n)) clashes.push(`${path.relative(SCRIPTS, f)}: MCP.${n}`);
    }
    expect(clashes).toEqual([]);
  });
});
