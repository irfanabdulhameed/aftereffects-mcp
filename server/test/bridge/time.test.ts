import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge({ failCommands: ['reverseLayer'] });
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

async function rejectedBeforeSend(name: string, args: Record<string, unknown>) {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

describe('time tools', () => {
  it('enable-time-remap returns the Time Remap property with its seed keys', async () => {
    const r = await callTool(client, 'enable-time-remap', { layer: { name: 'Clip' } });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ enabled: true, changed: true, sourceDuration: 5 });
    const remap = r.json.timeRemap as { matchName: string; numKeys: number; keyframes: unknown[] };
    expect(remap.matchName).toBe('ADBE Time Remapping');
    expect(remap.numKeys).toBe(2);
    const off = await callTool(client, 'enable-time-remap', { layer: { name: 'Clip' }, enabled: false });
    expect(off.json.enabled).toBe(false);
    expect(off.json.timeRemap).toBeNull();
    await rejectedBeforeSend('enable-time-remap', { layer: { index: 1 }, enabled: 'yes' });
  });

  it('set-time-remap-keyframes writes keys from time/value and frame/valueFrame', async () => {
    const r = await callTool(client, 'set-time-remap-keyframes', {
      layer: { index: 1 },
      keys: [{ frame: 0, valueFrame: 0 }, { time: 1, value: 0.5 }, { frame: 90, value: 2, easing: 'ease-in-out' }],
      replace: true,
    });
    expect(r.isError).toBe(false);
    expect(r.json.keyframesWritten).toBe(3);
    const keys = r.json.keyframes as Array<{ time: number; value: number; inInterpolation: string }>;
    expect(keys[1]).toMatchObject({ time: 1, value: 0.5 });
    expect(keys[2].inInterpolation).toBe('bezier');
    expect(r.json.replaced).toBe(true);
    await rejectedBeforeSend('set-time-remap-keyframes', { layer: { index: 1 }, keys: [] });
    await rejectedBeforeSend('set-time-remap-keyframes', { layer: { index: 1 }, keys: [{ time: 0, value: -1 }] });
  });

  it('freeze-frame-at returns a hold key and the source time', async () => {
    const r = await callTool(client, 'freeze-frame-at', { layer: { name: 'Clip' }, frame: 48, extendToCompEnd: true });
    expect(r.isError).toBe(false);
    expect(r.json.frozenAt).toEqual({ time: 1.6, frame: 48 });
    expect(r.json.sourceFrame).toBe(48);
    expect((r.json.keyframe as { inInterpolation: string }).inInterpolation).toBe('hold');
    expect((r.json.timing as { outPoint: number }).outPoint).toBe(10);
    await rejectedBeforeSend('freeze-frame-at', { layer: { index: 1 }, frame: 1.5 });
  });

  it('set-speed accepts percent, speedFactor or a fit duration', async () => {
    const half = await callTool(client, 'set-speed', { layer: { index: 1 }, speedFactor: 0.5 });
    expect(half.isError).toBe(false);
    expect(half.json).toMatchObject({ mode: 'speedFactor', stretch: 200, speedFactor: 0.5, reversed: false, anchoredTo: 'in' });
    const fit = await callTool(client, 'set-speed', { layer: { index: 1 }, fitToDurationFrames: 300, keepInPoint: false });
    expect(fit.json).toMatchObject({ mode: 'fitToDuration', stretch: 200, anchoredTo: 'start' });
    expect((fit.json.timing as { outPoint: number }).outPoint).toBe(10);
    const pct = await callTool(client, 'set-speed', { layer: { index: 1 }, percent: 50 });
    expect(pct.json).toMatchObject({ mode: 'percent', stretch: 50, speedFactor: 2 });
    await rejectedBeforeSend('set-speed', { layer: { index: 1 }, speedFactor: 0 });
    await rejectedBeforeSend('set-speed', { layer: { index: 1 }, fitToDuration: -2 });
  });

  it('reverse-layer surfaces bridge failures with the error shape', async () => {
    const r = await callTool(client, 'reverse-layer', { layer: { name: 'Clip' } });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ tool: 'reverse-layer', error: 'command-failed' });
    await rejectedBeforeSend('reverse-layer', {});
  });

  it('set-frame-blending sets the layer mode and the comp switch', async () => {
    const r = await callTool(client, 'set-frame-blending', { layer: { index: 1 }, mode: 'pixel-motion' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ frameBlending: 'pixel-motion', layerSwitch: true, compFrameBlending: true });
    const none = await callTool(client, 'set-frame-blending', { layer: { index: 1 }, mode: 'none', compSwitch: false });
    expect(none.json).toMatchObject({ frameBlending: 'none', compFrameBlending: false });
    await rejectedBeforeSend('set-frame-blending', { layer: { index: 1 }, mode: 'blend' });
  });

  it('loop-layer writes the loop expression and extends the layer', async () => {
    const r = await callTool(client, 'loop-layer', { layer: { name: 'Loop clip' }, mode: 'pingpong' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ mode: 'pingpong', expression: 'loopOut("pingpong")', lastKeyFixed: true });
    const remap = r.json.timeRemap as { hasExpression: boolean; expression: string; keyframes: Array<{ value: number }> };
    expect(remap.hasExpression).toBe(true);
    expect(remap.keyframes[1].value).toBeLessThan(5);
    expect((r.json.timing as { outPoint: number }).outPoint).toBe(10);
    const cut = await callTool(client, 'loop-layer', { layer: { index: 1 }, durationFrames: 90, loopBefore: true });
    expect((cut.json.timing as { outPoint: number }).outPoint).toBe(3);
    expect(cut.json.expression).toContain('loopIn(');
    await rejectedBeforeSend('loop-layer', { layer: { index: 1 }, mode: 'bounce' });
  });
});
