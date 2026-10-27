import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTool, prepareBridgeArgs } from '../../src/tools/registry.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

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

describe('text on a path', () => {
  it('set-text-on-path uses a mask and keys First Margin so the text travels', async () => {
    const r = await callTool(client, 'set-text-on-path', { layer: { name: 'Title' }, mask: 'Mask 1', perpendicular: true, travel: { durationFrames: 60 } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('setTextOnPath');
    expect(r.json).toMatchObject({ createdMask: false, pathIndex: 1, pathLength: 1884.9, textWidth: 640.2 });
    expect(r.json.mask).toMatchObject({ name: 'Mask 1', mode: 'none' });
    expect(r.json.changed).toEqual(['path', 'perpendicular', 'justification', 'travel']);
    const travel = r.json.travel as { from: number; to: number; startFrame: number; endFrame: number; property: string; keys: Array<{ value: number }> };
    expect(travel).toMatchObject({ from: 0, to: 1244.7, startFrame: 0, endFrame: 60, property: 'Text/Path Options/First Margin' });
    expect(travel.keys.map((k) => k.value)).toEqual([0, 1244.7]);
  });

  it('set-text-on-path can copy a shape layer path onto the text layer', async () => {
    const r = await callTool(client, 'set-text-on-path', { layer: { index: 1 }, fromShapeLayer: { layer: { name: 'Curve' }, group: 1, hide: true }, maskName: 'Text Path', reversePath: true, firstMargin: 40 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ createdMask: true, shapeLayer: { name: 'Curve' }, travel: null });
    expect(r.json.mask).toMatchObject({ name: 'Text Path' });
    expect(r.json.options).toMatchObject({ reversePath: true, firstMargin: 40 });
  });

  it('set-text-on-path rejects conflicting or bad input before sending', async () => {
    await rejected('set-text-on-path', { layer: { index: 1 }, mask: 1, fromShapeLayer: { layer: { index: 2 } } });
    await rejected('set-text-on-path', { layer: { index: 1 }, mask: 1, firstMargin: 10, travel: { duration: 1 } });
    await rejected('set-text-on-path', { layer: { index: 1 }, mask: 0 });
    await rejected('set-text-on-path', { layer: { index: 1 }, mask: 1, travel: { duration: -1 } });
    await rejected('set-text-on-path', { mask: 1 });
  });

  it('travel easing accepts the shared easing forms', () => {
    const entry = findTool('set-text-on-path');
    if (!entry) throw new Error('missing tool');
    const args = prepareBridgeArgs(entry, { layer: { index: 1 }, travel: { from: 100, to: 0, startTime: 1, duration: 1.5, easing: { type: 'bezier', x1: 0.3, y1: 0, x2: 0.1, y2: 1 } } }, tb.client);
    expect(args.travel).toMatchObject({ from: 100, to: 0, startTime: 1, duration: 1.5, easing: { type: 'bezier' } });
  });
});

describe('per-character 3D', () => {
  it('set-per-character-3d adds a flip reveal with an eased Offset sweep', async () => {
    const r = await callTool(client, 'set-per-character-3d', { layer: { name: 'Title' }, reveal: { preset: 'flip-x', durationFrames: 36 } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('setPerCharacter3d');
    expect(r.json).toMatchObject({ threeDPerChar: true, preset: 'flip-x', pivot: 'center', direction: 'forward', startFrame: 0, endFrame: 36 });
    expect(r.json.pose).toEqual({ rotationX: -90, opacity: 0 });
    const keys = (r.json.keyframes as Array<{ property: string; keys: Array<{ value: number }> }>)[0];
    expect(keys.property).toContain('Offset');
    expect(keys.keys.map((k) => k.value)).toEqual([-100, 100]);
    const anim = r.json.animator as { name: string; properties: Array<{ matchName: string }>; selectors: Array<{ values: { shape: string } }> };
    expect(anim.name).toBe('3D flip-x');
    expect(anim.properties.map((p) => p.matchName)).toEqual(['ADBE Text Rotation X', 'ADBE Text Opacity']);
    expect(anim.selectors[0].values.shape).toBe('ramp-up');
  });

  it('explicit pose fields replace the preset and backward runs the sweep the other way', async () => {
    const r = await callTool(client, 'set-per-character-3d', { layer: { index: 1 }, reveal: { rotationY: 70, positionZ: -200, direction: 'backward', basedOn: 'words', pivot: 'baseline' } });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ preset: null, pivot: 'baseline', basedOn: 'words', direction: 'backward' });
    expect(r.json.pose).toEqual({ rotationY: 70, positionZ: -200 });
    const keys = (r.json.keyframes as Array<{ keys: Array<{ value: number }> }>)[0];
    expect(keys.keys.map((k) => k.value)).toEqual([100, -100]);
  });

  it('enabled false switches it off; a reveal with enabled false is rejected', async () => {
    const r = await callTool(client, 'set-per-character-3d', { layer: { index: 1 }, enabled: false });
    expect(r.json).toMatchObject({ threeDPerChar: false, animator: null });
    await rejected('set-per-character-3d', { layer: { index: 1 }, enabled: false, reveal: { preset: 'tumble' } });
    await rejected('set-per-character-3d', { layer: { index: 1 }, reveal: { preset: 'spin' } });
    await rejected('set-per-character-3d', { layer: { index: 1 }, reveal: { opacity: 150 } });
    await rejected('set-per-character-3d', { layer: { index: 1 }, reveal: { durationFrames: 0 } });
  });
});

describe('text box and fitting', () => {
  it('add-text-box builds a pill that follows the text with a shadow', async () => {
    const r = await callTool(client, 'add-text-box', { layer: { name: 'CTA' }, padding: [32, 16], cornerRadius: 'pill', fillColor: '#2F6BFF', heightFrom: 'font', shadow: true });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('addTextBox');
    expect(r.json).toMatchObject({ padding: [32, 16], cornerRadius: 'pill', heightFrom: 'font', link: 'parent', fillColor: '#2f6bff', groupPath: 'Contents/Box' });
    expect(r.json.layer).toMatchObject({ name: 'CTA Box', type: 'shape', parent: { name: 'CTA' } });
    const ex = r.json.expressions as Record<string, string>;
    expect(ex.size).toContain('sourceRectAtTime');
    expect(ex.roundness).toContain('Math.min(W, H) / 2');
    expect(ex.opacity).toContain('transform.opacity');
    expect(r.json.expressionErrors).toEqual([]);
    expect(r.json.shadow).toMatchObject({ status: 'ok', kind: 'drop-shadow' });
  });

  it('add-text-box with link expression places the box through toComp', async () => {
    const r = await callTool(client, 'add-text-box', { layer: { index: 2 }, padding: 10, link: 'expression', linkOpacity: false, stroke: { color: 'white', width: 2 } });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ padding: [10, 10], link: 'expression', cornerRadius: 12 });
    const ex = r.json.expressions as Record<string, string | null>;
    expect(ex.position).toContain('toComp');
    expect(ex.opacity).toBeNull();
  });

  it('add-text-box rejects bad input before sending', async () => {
    await rejected('add-text-box', { layer: { index: 1 }, cornerRadius: 'round' });
    await rejected('add-text-box', { layer: { index: 1 }, padding: -4 });
    await rejected('add-text-box', { layer: { index: 1 }, shadow: { position: 'inside' } });
    await rejected('add-text-box', { layer: { index: 1 }, stroke: { width: 2 } });
    await rejected('add-text-box', { layer: { index: 1 }, heightFrom: 'glyphs' });
  });

  it('fit-text-to-box computes a font size once', async () => {
    const r = await callTool(client, 'fit-text-to-box', { layer: { name: 'Caption' }, width: 900, height: 240 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('fitTextToBox');
    expect(r.json).toMatchObject({ mode: 'once', method: 'box-overflow', fontSizeBefore: 72, fontSize: 88.4, boxSize: [900, 240], fits: true, overflow: false });
  });

  it('fit-text-to-box expression mode returns a shrink-only Scale expression', async () => {
    const r = await callTool(client, 'fit-text-to-box', { layer: { index: 1 }, mode: 'expression', width: 600 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ mode: 'expression', method: 'scale-expression', shrinkOnly: true });
    expect(r.json.expression).toContain('600 / Math.max(r.width, 0.001)');
    expect(r.json.expression).toContain('Math.min(k, 100)');
  });

  it('fit-text-to-box rejects impossible ranges before sending', async () => {
    await rejected('fit-text-to-box', { layer: { index: 1 }, minFontSize: 40, maxFontSize: 20 });
    await rejected('fit-text-to-box', { layer: { index: 1 }, mode: 'expression' });
    await rejected('fit-text-to-box', { layer: { index: 1 }, width: -10 });
    await rejected('fit-text-to-box', { layer: { index: 1 }, maxFontSize: 5000 });
  });
});
