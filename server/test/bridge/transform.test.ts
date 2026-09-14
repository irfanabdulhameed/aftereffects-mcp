import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

async function expectRejected(name: string, args: Record<string, unknown>) {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true, `${name} should reject ${JSON.stringify(args)}`).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

function lastCommand(): string {
  return tb.mock.state.log[tb.mock.state.log.length - 1].command;
}

describe('transform tools through the MCP server and the mock bridge', () => {
  it('get-property-value returns the property, the value at time and expression state', async () => {
    const r = await callTool(client, 'get-property-value', { layer: { name: 'Title' }, property: 'Transform/Position', frame: 30 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('getPropertyValue');
    expect(r.json).toMatchObject({ frame: 30, dimensions: 2, hasKeyframes: false });
    expect(r.json.time).toBeCloseTo(1, 6);
    expect(r.json.property).toMatchObject({ path: 'Transform/Position' });
    expect(r.json.valueAtTime).toEqual([960, 540]);
    expect(r.json.expression).toMatchObject({ hasExpression: false });
    const arr = await callTool(client, 'get-property-value', { layer: { index: 1 }, property: ['Effects', 1, 'Blurriness'] });
    expect(arr.isError).toBe(false);
    await expectRejected('get-property-value', { layer: { index: 1 } });
    await expectRejected('get-property-value', { layer: { index: 1 }, property: 'Transform/Opacity', frame: 1.5 });
  });

  it('set-property-value writes a value, or a keyframe when forced', async () => {
    const v = await callTool(client, 'set-property-value', { layer: { index: 1 }, property: 'Transform/Opacity', value: 50 });
    expect(v.isError).toBe(false);
    expect(v.json).toMatchObject({ mode: 'value', keyIndex: null, keyframe: null });
    expect((v.json.property as { value: number }).value).toBe(50);

    const k = await callTool(client, 'set-property-value', { layer: { index: 1 }, property: 'Transform/Opacity', value: 0, frame: 12, forceKeyframe: true, easing: 'ease-out' });
    expect(k.isError).toBe(false);
    expect(k.json).toMatchObject({ mode: 'keyframe', keyIndex: 1, frame: 12 });
    expect((k.json.keyframe as { value: number; frame: number }).frame).toBe(12);
    await expectRejected('set-property-value', { layer: { index: 1 }, property: 'Transform/Opacity' });
    await expectRejected('set-property-value', { layer: { index: 1 }, property: 'Transform/Opacity', value: 1, easing: 'wobbly' });
  });

  it('set-transform accepts a uniform scale and reports changed and keyframed', async () => {
    const r = await callTool(client, 'set-transform', { layer: { name: 'Card' }, position: [960, 540], scale: 80, opacity: 100, rotation: 15 });
    expect(r.isError).toBe(false);
    expect(r.json.changed).toEqual(expect.arrayContaining(['position', 'scale', 'opacity', 'rotation']));
    expect(r.json.keyframed).toBe(false);
    const tf = (r.json.layer as { transform: { scale: number[]; rotation: number } }).transform;
    expect(tf.scale).toEqual([80, 80]);
    expect(tf.rotation).toBe(15);

    const k = await callTool(client, 'set-transform', { layer: { name: 'Card' }, scale: [50, 50, 50], frame: 12, easing: 'ease-out' });
    expect(k.json.keyframed).toBe(true);
    expect(k.json.frame).toBe(12);
    await expectRejected('set-transform', { layer: { name: 'Card' }, opacity: 150 });
    await expectRejected('set-transform', { layer: { name: 'Card' }, scale: [1] });
    await expectRejected('set-transform', { layer: { name: 'Card' }, orientation: [0, 0] });
  });

  it('set-anchor-point by name or by point', async () => {
    const r = await callTool(client, 'set-anchor-point', { layer: { name: 'Bar' }, anchor: 'center-left' });
    expect(r.isError).toBe(false);
    expect(r.json.anchorPoint).toEqual([0, 100]);
    expect(r.json.keepVisualPosition).toBe(true);
    expect(r.json.sourceRect).toMatchObject({ width: 400, height: 200 });
    expect(Array.isArray(r.json.position)).toBe(true);
    const pt = await callTool(client, 'set-anchor-point', { layer: { name: 'Bar' }, anchor: [10, 20], keepVisualPosition: false });
    expect(pt.json.anchorPoint).toEqual([10, 20]);
    expect(pt.json.position).toEqual([960, 540]);
    await expectRejected('set-anchor-point', { layer: { name: 'Bar' }, anchor: 'middle' });
    await expectRejected('set-anchor-point', { layer: { name: 'Bar' } });
  });

  it('fit-layer-to-composition modes', async () => {
    const contain = await callTool(client, 'fit-layer-to-composition', { layer: { name: 'photo.jpg' } });
    expect(contain.isError).toBe(false);
    expect(contain.json.mode).toBe('both');
    const sc = contain.json.scale as number[];
    expect(sc[0]).toBeCloseTo(480, 3);
    expect(sc[1]).toBeCloseTo(480, 3);
    const cover = await callTool(client, 'fit-layer-to-composition', { layer: { name: 'photo.jpg' }, mode: 'cover' });
    expect((cover.json.scale as number[])[0]).toBeCloseTo(540, 3);
    expect(cover.json.fitted).toMatchObject({ width: 2160, height: 1080 });
    await expectRejected('fit-layer-to-composition', { layer: { name: 'photo.jpg' }, mode: 'fill' });
    await expectRejected('fit-layer-to-composition', { layer: { name: 'photo.jpg' }, margin: -5 });
  });

  it('get-layer-bounds returns the source rect and comp-space corners', async () => {
    const r = await callTool(client, 'get-layer-bounds', { layer: { name: 'Title' }, frame: 0 });
    expect(r.isError).toBe(false);
    expect(r.json.sourceRect).toMatchObject({ left: 0, top: 0, width: 400, height: 200 });
    const corners = r.json.corners as Record<string, number[]>;
    expect(Object.keys(corners).sort()).toEqual(['bottomLeft', 'bottomRight', 'topLeft', 'topRight']);
    expect(r.json.bounds).toMatchObject({ width: 400, height: 200 });
    expect(Array.isArray(r.json.notes)).toBe(true);
    await expectRejected('get-layer-bounds', {});
  });

  it('separate-dimensions reports the property paths now available', async () => {
    const on = await callTool(client, 'separate-dimensions', { layer: { name: 'Ball' } });
    expect(on.isError).toBe(false);
    expect(on.json.dimensionsSeparated).toBe(true);
    expect(on.json.properties).toEqual(['Transform/X Position', 'Transform/Y Position']);
    const off = await callTool(client, 'separate-dimensions', { layer: { name: 'Ball' }, separate: false });
    expect(off.json.dimensionsSeparated).toBe(false);
    expect(off.json.properties).toEqual(['Transform/Position']);
    await expectRejected('separate-dimensions', { layer: { name: 'Ball' }, separate: 'yes' });
  });

  it('transform tools run inside batch', async () => {
    const r = await callTool(client, 'batch', {
      steps: [
        { tool: 'set-anchor-point', args: { layer: { name: 'Bar' }, anchor: 'center' } },
        { tool: 'set-transform', args: { layer: { name: 'Bar' }, scale: 120 } },
        { tool: 'get-layer-bounds', args: { layer: { name: 'Bar' } } },
      ],
    });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ steps: 3, ok: 3, failed: 0 });
  });
});
