import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

const TEXT_JSX = path.resolve(__dirname, '..', '..', 'src', 'scripts', 'commands', 'text.jsx');

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

async function rejected(name: string, args: Record<string, unknown>): Promise<void> {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

function lastCommand(): string {
  return tb.mock.state.log[tb.mock.state.log.length - 1].command;
}

describe('text animator presets', () => {
  it('TypeScript enum and ExtendScript preset table list the same names', async () => {
    const { TEXT_ANIMATOR_PRESETS } = await import('../../src/tools/text.js');
    const text = fs.readFileSync(TEXT_JSX, 'utf8');
    const inJsx = new Set([...text.matchAll(/MCP\.textAnimatorPresets\["([a-z0-9-]+)"\]\s*=/g)].map((m) => m[1]));
    expect([...inJsx].sort()).toEqual([...TEXT_ANIMATOR_PRESETS].sort());
    expect(TEXT_ANIMATOR_PRESETS.length).toBeGreaterThanOrEqual(12);
  });
});

describe('text tools through the MCP server and the mock bridge', () => {
  it('list-fonts returns the font list shape and filters', async () => {
    const r = await callTool(client, 'list-fonts', { query: 'helvetica' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ supported: true, count: 2 });
    const fonts = r.json.fonts as Array<{ postScriptName: string; family: string; style: string }>;
    expect(fonts[0]).toMatchObject({ postScriptName: 'Helvetica-Bold', family: 'Helvetica', style: 'Bold' });
    expect(lastCommand()).toBe('listFonts');
  });

  it('list-fonts rejects a non-positive maxResults before sending', async () => {
    await rejected('list-fonts', { maxResults: 0 });
  });

  it('list-text-animator-presets returns presets with params and the scheme text', async () => {
    const r = await callTool(client, 'list-text-animator-presets', {});
    expect(r.isError).toBe(false);
    const presets = r.json.presets as Array<{ name: string; params: unknown[] }>;
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.map((p) => p.name)).toContain('typewriter');
    expect(typeof r.json.scheme).toBe('string');
  });

  it('add-text-animator with a preset returns the animator, selector path and keyframes', async () => {
    const r = await callTool(client, 'add-text-animator', { layer: { name: 'Title' }, preset: 'fade-in-by-word', duration: 0.8, delay: 0.25 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ preset: 'fade-in-by-word', direction: 'forward', animatorPath: 'Text/Animators/Fade In By Word', selectorPath: 'Text/Animators/Fade In By Word/Range Selector 1' });
    const anim = r.json.animator as { name: string; properties: unknown[]; selectors: Array<{ type: string }> };
    expect(anim.name).toBe('Fade In By Word');
    expect(anim.selectors[0].type).toBe('range');
    const keys = r.json.keyframes as Array<{ property: string; keys: Array<{ value: number }> }>;
    expect(keys[0].property).toContain('Start');
    expect(keys[0].keys.map((k) => k.value)).toEqual([0, 100]);
    expect(lastCommand()).toBe('addTextAnimator');
  });

  it('add-text-animator backward keys End 100 to 0 and center uses subtract mode', async () => {
    const back = await callTool(client, 'add-text-animator', { layer: { index: 1 }, preset: 'slide-up-by-character', direction: 'backward' });
    const backKeys = back.json.keyframes as Array<{ property: string; keys: Array<{ value: number }> }>;
    expect(backKeys[0].property).toContain('End');
    expect(backKeys[0].keys.map((k) => k.value)).toEqual([100, 0]);

    const center = await callTool(client, 'add-text-animator', { layer: { index: 1 }, preset: 'blur-in-by-character', direction: 'center', amount: 40 });
    const sel = (center.json.animator as { selectors: Array<{ values: { mode: string } }> }).selectors[0];
    expect(sel.values.mode).toBe('subtract');
    expect((center.json.keyframes as unknown[]).length).toBe(2);
  });

  it('add-text-animator wave preset returns a wiggly selector and no keyframes', async () => {
    const r = await callTool(client, 'add-text-animator', { layer: { index: 1 }, preset: 'wave-y-position' });
    expect(r.isError).toBe(false);
    const sels = (r.json.animator as { selectors: Array<{ type: string }> }).selectors;
    expect(sels.some((s) => s.type === 'wiggly')).toBe(true);
    expect(r.json.keyframes).toEqual([]);
  });

  it('add-text-animator rejects unknown presets and directions before sending', async () => {
    await rejected('add-text-animator', { layer: { index: 1 }, preset: 'explode' });
    await rejected('add-text-animator', { layer: { index: 1 }, preset: 'typewriter', direction: 'sideways' });
    await rejected('add-text-animator', { layer: { index: 1 }, preset: 'typewriter', duration: -1 });
  });

  it('add-text-range-selector returns the selector with values', async () => {
    const r = await callTool(client, 'add-text-range-selector', { layer: { index: 1 }, animator: 'Animator 1', start: 0, end: 50, basedOn: 'words', shape: 'ramp-up' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ selectorPath: 'Text/Animators/Animator 1/Range Selector 2' });
    const sel = r.json.selector as { type: string; values: { start: number; end: number; basedOn: string; shape: string } };
    expect(sel.type).toBe('range');
    expect(sel.values).toMatchObject({ start: 0, end: 50, basedOn: 'words', shape: 'ramp-up' });
    expect(r.json.changed).toEqual(['start', 'end', 'basedOn', 'shape']);
  });

  it('add-text-range-selector rejects an unknown basedOn or an out of range amount', async () => {
    await rejected('add-text-range-selector', { layer: { index: 1 }, basedOn: 'glyphs' });
    await rejected('add-text-range-selector', { layer: { index: 1 }, amount: 150 });
  });

  it('set-range-selector with a frame writes keyframes on the given fields', async () => {
    const r = await callTool(client, 'set-range-selector', { layer: { index: 1 }, animator: 1, selector: 1, offset: 100, frame: 24, easing: 'ease-out' });
    expect(r.isError).toBe(false);
    const keys = r.json.keyframes as Array<{ property: string; keyframe: { frame: number; value: number } }>;
    expect(keys.length).toBe(1);
    expect(keys[0].property).toContain('Offset');
    expect(keys[0].keyframe).toMatchObject({ frame: 24, value: 100 });
    expect(r.json.changed).toEqual(['offset']);
  });

  it('set-range-selector rejects a zero selector index and bad easing', async () => {
    await rejected('set-range-selector', { layer: { index: 1 }, selector: 0, start: 10 });
    await rejected('set-range-selector', { layer: { index: 1 }, start: 10, easing: 'bouncy' });
  });

  it('add-text-wiggly-selector returns a wiggly selector with its values', async () => {
    const r = await callTool(client, 'add-text-wiggly-selector', { layer: { index: 1 }, animator: 'Wave', wigglesPerSecond: 1.5, correlation: 80 });
    expect(r.isError).toBe(false);
    const sel = r.json.selector as { type: string; values: { wigglesPerSecond: number; correlation: number } };
    expect(sel.type).toBe('wiggly');
    expect(sel.values).toMatchObject({ wigglesPerSecond: 1.5, correlation: 80 });
    expect(r.json.selectorPath).toContain('Wiggly Selector');
  });

  it('add-text-wiggly-selector rejects correlation above 100', async () => {
    await rejected('add-text-wiggly-selector', { layer: { index: 1 }, correlation: 120 });
  });

  it('add-text-expression-selector returns the expression state', async () => {
    const r = await callTool(client, 'add-text-expression-selector', { layer: { index: 1 }, animator: 1, expression: '(textIndex % 2 == 0) ? 100 : 0' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ amountPath: 'Text/Animators/Animator 1/Expression Selector 1/Amount' });
    expect(r.json.expressionState).toMatchObject({ hasExpression: true, expression: '(textIndex % 2 == 0) ? 100 : 0', error: '' });
    expect((r.json.selector as { type: string }).type).toBe('expression');
  });

  it('add-text-expression-selector requires an expression', async () => {
    await rejected('add-text-expression-selector', { layer: { index: 1 } });
  });

  it('convert-text-to-shapes returns the source and the new shape layer', async () => {
    const r = await callTool(client, 'convert-text-to-shapes', { layer: { name: 'Title' } });
    expect(r.isError).toBe(false);
    expect(r.json.sourceLayer).toMatchObject({ name: 'Title', enabled: false });
    expect(r.json.shapeLayer).toMatchObject({ name: 'Title Outlines', type: 'shape' });
    expect(r.json.groupCount).toBe(5);
    const keep = await callTool(client, 'convert-text-to-shapes', { layer: { name: 'Title' }, keepSource: true });
    expect(keep.json.sourceLayer).toMatchObject({ enabled: true });
  });

  it('set-text-box converts to box text and back', async () => {
    const box = await callTool(client, 'set-text-box', { layer: { index: 1 }, boxSize: [900, 300] });
    expect(box.isError).toBe(false);
    expect(box.json.changed).toEqual(['boxText', 'boxTextSize']);
    expect(box.json.textDocument).toMatchObject({ boxText: true, boxTextSize: [900, 300] });
    const point = await callTool(client, 'set-text-box', { layer: { index: 1 }, pointText: true });
    expect(point.json.textDocument).toMatchObject({ boxText: false });
  });

  it('set-text-box rejects a malformed boxSize before sending', async () => {
    await rejected('set-text-box', { layer: { index: 1 }, boxSize: [900] });
  });

  it('existing text tools still work: create-text-layer, set-text, get-text, set-text-style', async () => {
    const created = await callTool(client, 'create-text-layer', { text: 'Hello', fillColor: 'white' });
    expect(created.isError).toBe(false);
    const set = await callTool(client, 'set-text', { layer: { name: 'Hello' }, text: 'World' });
    expect(set.json.textDocument).toMatchObject({ text: 'World' });
    const got = await callTool(client, 'get-text', { layer: { name: 'Hello' } });
    expect(got.json.text).toBe('Hello');
    const styled = await callTool(client, 'set-text-style', { layer: { name: 'Hello' }, fontSize: 36 });
    expect(styled.json.changed).toContain('fontSize');
  });
});
