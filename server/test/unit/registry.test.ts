import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { catalog, kebabToCamel } from '../../src/tools/registry.js';

const SCRIPTS = path.resolve(__dirname, '..', '..', 'src', 'scripts');

function registeredBridgeCommands(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsx')) {
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(/MCP\.register\("([A-Za-z0-9]+)"/g)) names.add(m[1]);
      }
    }
  };
  walk(path.join(SCRIPTS, 'commands'));
  return names;
}

describe('tool registry', () => {
  it('kebab to camel', () => {
    expect(kebabToCamel('set-keyframes-bulk')).toBe('setKeyframesBulk');
    expect(kebabToCamel('rig-edge-glow')).toBe('rigEdgeGlow');
    expect(kebabToCamel('4-color')).toBe('4Color');
  });

  it('every bridge-backed tool has a registered ExtendScript command, and names are kebab-case', async () => {
    await import('../../src/index.js');
    const { createServer } = await import('../../src/index.js');
    if (catalog.length === 0) createServer();
    const commands = registeredBridgeCommands();
    const missing: string[] = [];
    for (const entry of catalog) {
      expect(entry.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(entry.description.split(/\s+/).length).toBeGreaterThanOrEqual(60);
      if (entry.bridge && !commands.has(entry.bridge)) missing.push(`${entry.name} -> ${entry.bridge}`);
    }
    expect(missing).toEqual([]);
  });

  it('descriptions follow the template and contain no em dashes', async () => {
    const { createServer } = await import('../../src/index.js');
    if (catalog.length === 0) createServer();
    for (const entry of catalog) {
      expect(entry.description, entry.name).toContain('Use when:');
      expect(entry.description, entry.name).toContain('Returns:');
      expect(entry.description, entry.name).not.toContain('—');
    }
  });
});

describe('effect templates', () => {
  it('TypeScript enum and ExtendScript table list the same templates', async () => {
    const { EFFECT_TEMPLATES } = await import('../../src/tools/effects.js');
    const text = fs.readFileSync(path.join(SCRIPTS, 'commands', 'effects.jsx'), 'utf8');
    const inJsx = new Set([...text.matchAll(/MCP\.effectTemplates\["([a-z0-9-]+)"\]\s*=/g)].map((m) => m[1]));
    expect([...inJsx].sort()).toEqual([...EFFECT_TEMPLATES].sort());
  });

  it('no bridge command is registered twice', () => {
    const seen = new Map<string, number>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.jsx')) {
          for (const m of fs.readFileSync(full, 'utf8').matchAll(/MCP\.register\("([A-Za-z0-9]+)"/g)) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
        }
      }
    };
    walk(path.join(SCRIPTS, 'commands'));
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });
});
