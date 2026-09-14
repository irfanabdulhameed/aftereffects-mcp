import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

const layer = { name: 'Title' };
const lastCommand = () => tb.mock.state.log[tb.mock.state.log.length - 1].command;

async function expectRejectedBeforeSend(name: string, args: Record<string, unknown>) {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

describe('keyframe editing tools', () => {
  it('delete-keyframe by index returns the removed key and the remaining list', async () => {
    const r = await callTool(client, 'delete-keyframe', { layer, property: 'Transform/Opacity', index: 2 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('deleteKeyframe');
    expect(r.json).toMatchObject({ composition: { id: 1 }, layer: { index: 1 }, property: { path: 'Transform/Opacity', numKeys: 2 } });
    expect(r.json.removed).toMatchObject({ index: 2, time: 0.5, value: 50 });
    const remaining = r.json.keyframes as Array<{ index: number; time: number }>;
    expect(remaining.map((k) => k.index)).toEqual([1, 2]);
    expect(remaining.map((k) => k.time)).toEqual([0, 1]);
  });

  it('delete-keyframe by frame', async () => {
    const r = await callTool(client, 'delete-keyframe', { layer, property: 'Transform/Opacity', frame: 30 });
    expect(r.isError).toBe(false);
    expect(r.json.removed).toMatchObject({ time: 1, frame: 30 });
  });

  it('delete-keyframe rejects a zero index before sending', async () => {
    await expectRejectedBeforeSend('delete-keyframe', { layer, property: 'Transform/Opacity', index: 0 });
  });

  it('delete-keyframes-in-range reports the removed count', async () => {
    const r = await callTool(client, 'delete-keyframes-in-range', { layer, property: 'Transform/Opacity', startFrame: 10, endFrame: 30 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ removedCount: 2, removedTimes: [0.5, 1], range: { startFrame: 10, endFrame: 30 } });
    expect((r.json.keyframes as unknown[]).length).toBe(1);
  });

  it('delete-keyframes-in-range rejects a non-integer frame', async () => {
    await expectRejectedBeforeSend('delete-keyframes-in-range', { layer, property: 'Transform/Opacity', startFrame: 1.5 });
  });

  it('clear-keyframes keeps the value at a time by default', async () => {
    const r = await callTool(client, 'clear-keyframes', { layer, property: 'Transform/Scale', keepValueAtFrame: 15 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ removedCount: 3, keptValue: 50, keptValueAt: 0.5, property: { numKeys: 0 } });
    const skip = await callTool(client, 'clear-keyframes', { layer, property: 'Transform/Scale', keepValue: false });
    expect(skip.json.keptValue).toBeNull();
  });

  it('move-keyframes by frame offset shifts every key', async () => {
    const r = await callTool(client, 'move-keyframes', { layer, property: 'Transform/Position', offsetFrames: 15 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('moveKeyframes');
    expect(r.json).toMatchObject({ movedCount: 3, offset: 0.5, scale: 1 });
    const times = (r.json.keyframes as Array<{ time: number }>).map((k) => k.time);
    expect(times).toEqual([0.5, 1, 1.5]);
  });

  it('move-keyframes scales a range about a pivot', async () => {
    const r = await callTool(client, 'move-keyframes', { layer, property: 'Transform/Position', keys: { from: 0.5, to: 1 }, scale: 2, pivot: 0.5 });
    expect(r.isError).toBe(false);
    expect(r.json.movedCount).toBe(2);
    const times = (r.json.keyframes as Array<{ time: number }>).map((k) => k.time);
    expect(times).toEqual([0, 0.5, 1.5]);
  });

  it('move-keyframes rejects a negative scale and a bad key selection', async () => {
    await expectRejectedBeforeSend('move-keyframes', { layer, property: 'Transform/Position', scale: -1 });
    await expectRejectedBeforeSend('move-keyframes', { layer, property: 'Transform/Position', offset: 1, keys: 'some' });
  });

  it('set-keyframe-easing accepts presets, custom and bezier specs', async () => {
    const preset = await callTool(client, 'set-keyframe-easing', { layer, property: 'Transform/Position', easing: 'ease-out', keys: [2, 3] });
    expect(preset.isError).toBe(false);
    expect(preset.json).toMatchObject({ easing: 'ease-out', appliedTo: [2, 3] });
    const custom = await callTool(client, 'set-keyframe-easing', { layer, property: 'Transform/Position', easing: { type: 'custom', inInfluence: 80, outInfluence: 20 } });
    expect(custom.isError).toBe(false);
    const bezier = await callTool(client, 'set-keyframe-easing', { layer, property: 'Transform/Position', easing: { type: 'bezier', x1: 0.2, y1: 0, x2: 0.4, y2: 1 } });
    expect(bezier.isError).toBe(false);
    await expectRejectedBeforeSend('set-keyframe-easing', { layer, property: 'Transform/Position', easing: 'bouncy' });
  });

  it('copy-keyframes copies with a frame offset and a multiplier', async () => {
    const r = await callTool(client, 'copy-keyframes', { fromLayer: { name: 'Source' }, fromProperty: 'Transform/Opacity', toLayer: layer, frameOffset: 6, valueMultiplier: 0.5, replace: true });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('copyKeyframes');
    expect(r.json).toMatchObject({ copiedCount: 3, timeOffset: 0.2, from: { property: 'Transform/Opacity' } });
    const keys = r.json.keyframes as Array<{ time: number; value: number }>;
    expect(keys[2]).toMatchObject({ time: 1.2, value: 50 });
  });

  it('copy-keyframes fails clearly on a dimension mismatch', async () => {
    const r = await callTool(client, 'copy-keyframes', { fromLayer: layer, fromProperty: 'Transform/Position', toProperty: 'Transform/Opacity' });
    expect(r.isError).toBe(true);
    expect(r.json.message).toContain('2 dimension');
    await expectRejectedBeforeSend('copy-keyframes', { fromLayer: layer, fromProperty: 'Transform/Position', valueMultiplier: [1, 2, 3, 4, 5] });
  });

  it('reverse-keyframes mirrors times about the midpoint', async () => {
    const r = await callTool(client, 'reverse-keyframes', { layer, property: 'Transform/Scale' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ reversedCount: 3, range: { start: 0, end: 1, midpoint: 0.5 } });
    const keys = r.json.keyframes as Array<{ time: number; value: number }>;
    expect(keys.map((k) => k.time)).toEqual([0, 0.5, 1]);
    expect(keys.map((k) => k.value)).toEqual([100, 50, 0]);
  });

  it('set-keyframe-interpolation hold changes only the out side', async () => {
    const r = await callTool(client, 'set-keyframe-interpolation', { layer, property: 'Text/Source Text', type: 'hold', keys: 'all' });
    expect(r.isError).toBe(false);
    const keys = r.json.keyframes as Array<{ inInterpolation: string; outInterpolation: string }>;
    expect(keys.every((k) => k.outInterpolation === 'hold' && k.inInterpolation === 'bezier')).toBe(true);
    const lin = await callTool(client, 'set-keyframe-interpolation', { layer, property: 'Transform/Opacity', type: 'linear', keys: [1] });
    expect((lin.json.keyframes as Array<{ inInterpolation: string }>)[0].inInterpolation).toBe('linear');
    await expectRejectedBeforeSend('set-keyframe-interpolation', { layer, property: 'Transform/Opacity', type: 'smooth' });
  });

  it('bake-expression-to-keyframes returns the count and first and last keys', async () => {
    const r = await callTool(client, 'bake-expression-to-keyframes', { layer, property: 'Transform/Position', startFrame: 0, endFrame: 60, step: 2 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ sampleCount: 31, stepFrames: 2, bakedExpression: 'wiggle(2, 10)', first: { index: 1, inInterpolation: 'linear' }, last: { index: 31, frame: 60 } });
  });

  it('bake-expression-to-keyframes refuses more than 5000 samples unless allowLarge', async () => {
    const big = await callTool(client, 'bake-expression-to-keyframes', { layer, property: 'Transform/Position', start: 0, end: 400 });
    expect(big.isError).toBe(true);
    expect(big.json.message).toContain('allowLarge');
    const ok = await callTool(client, 'bake-expression-to-keyframes', { layer, property: 'Transform/Position', start: 0, end: 400, allowLarge: true });
    expect(ok.isError).toBe(false);
    await expectRejectedBeforeSend('bake-expression-to-keyframes', { layer, property: 'Transform/Position', step: 0 });
  });

  it('stagger-keyframes-across-layers offsets each layer by the interval', async () => {
    const r = await callTool(client, 'stagger-keyframes-across-layers', {
      layers: [{ index: 1 }, { index: 2 }, { index: 3 }],
      property: 'Transform/Opacity',
      keys: [{ frame: 0, value: 0 }, { frame: 10, value: 100, easing: 'ease-out' }],
      intervalFrames: 3,
      startFrame: 30,
      order: 'bottom-up',
    });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('staggerKeyframesAcrossLayers');
    expect(r.json).toMatchObject({ layers: 3, failed: 0, order: 'bottom-up' });
    const rows = r.json.results as Array<{ order: number; layer: { index: number }; offset: number; keyframes: Array<{ time: number }> }>;
    expect(rows.map((x) => x.layer.index)).toEqual([3, 2, 1]);
    expect(rows.map((x) => x.offset)).toEqual([1, 1.1, 1.2]);
    expect(rows[1].keyframes.map((k) => k.time)).toEqual([1.1, 1.1 + 1 / 3]);
  });

  it('stagger-keyframes-across-layers accepts {selected: true} and rejects an empty key list', async () => {
    const r = await callTool(client, 'stagger-keyframes-across-layers', { layers: { selected: true }, property: 'Transform/Opacity', keys: [{ time: 0, value: 0 }], interval: 0.25 });
    expect(r.isError).toBe(false);
    expect(r.json.layers).toBe(3);
    await expectRejectedBeforeSend('stagger-keyframes-across-layers', { layers: { selected: true }, property: 'Transform/Opacity', keys: [] });
    await expectRejectedBeforeSend('stagger-keyframes-across-layers', { layers: [{ index: 1 }], property: 'Transform/Opacity', keys: [{ time: 0, value: 0 }], order: 'sideways' });
  });

  it('the existing keyframe tools still answer', async () => {
    const r = await callTool(client, 'get-keyframes', { layer, property: 'Transform/Opacity' });
    expect(r.isError).toBe(false);
    expect((r.json.property as { keyframes: unknown[] }).keyframes.length).toBe(2);
  });
});
