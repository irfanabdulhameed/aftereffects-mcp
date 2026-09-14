import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyStyleRefs, loadStyle, parseSimpleYaml, resolveStyleRef, summarizeStyle } from '../../src/schemas/style.js';

const tmp: string[] = [];
afterEach(() => {
  for (const f of tmp.splice(0)) fs.rmSync(f, { force: true });
});

function write(name: string, text: string): string {
  const p = path.join(os.tmpdir(), `ae-mcp-style-${process.pid}-${Math.random().toString(36).slice(2)}${name}`);
  fs.writeFileSync(p, text);
  tmp.push(p);
  return p;
}

describe('style file', () => {
  it('loads the shipped example and resolves references', () => {
    const example = path.resolve(__dirname, '..', '..', '..', 'docs', 'style-file.example.json');
    const style = loadStyle(example);
    expect(style?.name).toBe('Example house style');
    expect(resolveStyleRef(style, '@style.entrance')).toBe('ease-out');
    expect(resolveStyleRef(style, '@style.easings.snap')).toMatchObject({ type: 'custom' });
    expect(resolveStyleRef(style, '@style.h1')).toMatchObject({ fontSize: 120 });
    expect(resolveStyleRef(style, '@style.brand')).toBe('#7C86FF');
    expect(resolveStyleRef(style, '@style.durations.small')).toBe(0.3);
    expect(() => resolveStyleRef(style, '@style.nope')).toThrow(/not defined/);
    expect(() => resolveStyleRef(undefined, '@style.entrance')).toThrow(/AE_MCP_STYLE_FILE/);
    expect(summarizeStyle(style!)).toContain('Rules:');
  });

  it('replaces references anywhere in an argument object', () => {
    const style = loadStyle(path.resolve(__dirname, '..', '..', '..', 'docs', 'style-file.example.json'));
    const args = applyStyleRefs(style, { keys: [{ time: 0, value: 0, easing: '@style.entrance' }], fillColor: '@style.brand', plain: 'text' });
    expect(args).toEqual({ keys: [{ time: 0, value: 0, easing: 'ease-out' }], fillColor: '#7C86FF', plain: 'text' });
  });

  it('parses a small YAML subset', () => {
    const yaml = write('.yaml', 'name: Test\ndurations:\n  small: 0.3\n  medium: 0.5\neasings:\n  entrance: ease-out\nrules:\n  - one\n  - two\ncolors:\n  brand: "#123456"\n');
    const parsed = parseSimpleYaml(fs.readFileSync(yaml, 'utf8')) as Record<string, unknown>;
    expect(parsed.name).toBe('Test');
    expect(parsed.durations).toEqual({ small: 0.3, medium: 0.5 });
    expect(parsed.rules).toEqual(['one', 'two']);
    expect(parsed.colors).toEqual({ brand: '#123456' });
    const style = loadStyle(yaml);
    expect(style?.easings?.entrance).toBe('ease-out');
  });

  it('rejects invalid files', () => {
    const bad = write('.json', '{"easings": {"entrance": "bouncy"}}');
    expect(() => loadStyle(bad)).toThrow();
    expect(loadStyle('/nonexistent/style.json')).toBeUndefined();
  });
});
