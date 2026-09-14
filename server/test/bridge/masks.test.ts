import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('mask tools through the MCP server and the mock bridge', () => {
  it('create-mask with an ellipse returns the mask summary and geometry', async () => {
    const r = await callTool(client, 'create-mask', { layer: { name: 'Photo' }, shape: 'ellipse', size: [600, 600], feather: 80, name: 'Vignette' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ maskPath: 'Masks/Vignette', maskCount: 1 });
    expect(r.json.mask).toMatchObject({ name: 'Vignette', path: 'Masks/Vignette', mode: 'add', feather: [80, 80], vertexCount: 4 });
    expect(r.json.geometry).toMatchObject({ kind: 'ellipse', size: [600, 600] });
    expect(r.json.changed).toEqual(['feather']);
    expect(lastCommand()).toBe('createMask');
  });

  it('create-mask infers points and rectangle geometry', async () => {
    const pts = await callTool(client, 'create-mask', { layer: { index: 1 }, points: [[0, 0], [100, 0], [50, 80]], mode: 'subtract' });
    expect(pts.json.geometry).toMatchObject({ kind: 'points', vertexCount: 3 });
    expect(pts.json.mask).toMatchObject({ mode: 'subtract' });
    const rect = await callTool(client, 'create-mask', { layer: { index: 1 }, rect: { x: 10, y: 20, width: 300, height: 200 }, inverted: true });
    expect(rect.json.geometry).toMatchObject({ kind: 'rectangle', rect: { x: 10, y: 20, width: 300, height: 200 } });
    expect(rect.json.mask).toMatchObject({ inverted: true });
  });

  it('create-mask rejects bad modes, feather, opacity and rect shapes before sending', async () => {
    await rejected('create-mask', { layer: { index: 1 }, mode: 'multiply' });
    await rejected('create-mask', { layer: { index: 1 }, feather: -5 });
    await rejected('create-mask', { layer: { index: 1 }, opacity: 101 });
    await rejected('create-mask', { layer: { index: 1 }, rect: { x: 0, y: 0, width: 10 } });
    await rejected('create-mask', { layer: { index: 1 }, points: [[0, 0]] });
  });

  it('list-masks returns masks with keyframe counts', async () => {
    const r = await callTool(client, 'list-masks', { layer: { name: 'Photo' } });
    expect(r.isError).toBe(false);
    expect(r.json.count).toBe(2);
    const masks = r.json.masks as Array<{ index: number; name: string; mode: string; keyframes: Record<string, number> }>;
    expect(masks[1]).toMatchObject({ index: 2, name: 'Mask 2', mode: 'subtract' });
    expect(masks[0].keyframes).toEqual({ path: 0, feather: 0, opacity: 0, expansion: 0 });
  });

  it('set-mask-properties with a frame keys feather and returns the changes', async () => {
    const r = await callTool(client, 'set-mask-properties', { layer: { index: 1 }, mask: 'Mask 1', feather: [40, 40], frame: 12, easing: 'ease-out' });
    expect(r.isError).toBe(false);
    expect(r.json.changed).toEqual(['feather']);
    const keys = r.json.keyframes as Array<{ property: string; keyframe: { frame: number; value: number[] } }>;
    expect(keys.length).toBe(1);
    expect(keys[0].property).toBe('Masks/Mask 1/Mask Feather');
    expect(keys[0].keyframe).toMatchObject({ frame: 12, value: [40, 40] });
    const stat = await callTool(client, 'set-mask-properties', { layer: { index: 1 }, mask: 2, mode: 'intersect', color: 'red', locked: true });
    expect(stat.json.changed).toEqual(['mode', 'locked', 'color']);
    expect(stat.json.keyframes).toEqual([]);
  });

  it('set-mask-properties requires a mask and rejects a zero index', async () => {
    await rejected('set-mask-properties', { layer: { index: 1 }, feather: 10 });
    await rejected('set-mask-properties', { layer: { index: 1 }, mask: 0, feather: 10 });
    await rejected('set-mask-properties', { layer: { index: 1 }, mask: 1, color: 'not-a-colour' });
  });

  it('set-mask-path-keyframe writes a key at a frame and a static value without one', async () => {
    const keyed = await callTool(client, 'set-mask-path-keyframe', { layer: { index: 1 }, mask: 1, rect: { x: 0, y: 0, width: 1920, height: 1080 }, frame: 20, easing: 'ease-out' });
    expect(keyed.isError).toBe(false);
    expect(keyed.json).toMatchObject({ vertexCount: 4, keyIndex: 1 });
    expect(keyed.json.keyframe).toMatchObject({ frame: 20 });
    const stat = await callTool(client, 'set-mask-path-keyframe', { layer: { index: 1 }, mask: 1, points: [[0, 0], [10, 0], [10, 10]] });
    expect(stat.json).toMatchObject({ vertexCount: 3, keyIndex: null, keyframe: null });
  });

  it('set-mask-path-keyframe rejects a missing mask reference before sending', async () => {
    await rejected('set-mask-path-keyframe', { layer: { index: 1 }, rect: { x: 0, y: 0, width: 1, height: 1 } });
  });

  it('delete-mask returns the removed mask and the remaining list', async () => {
    const r = await callTool(client, 'delete-mask', { layer: { name: 'Photo' }, mask: 'Mask 2' });
    expect(r.isError).toBe(false);
    expect(r.json.removed).toMatchObject({ name: 'Mask 2' });
    expect(r.json.remainingCount).toBe(1);
    expect(lastCommand()).toBe('deleteMask');
  });

  it('delete-mask requires a mask reference', async () => {
    await rejected('delete-mask', { layer: { index: 1 } });
  });

  it('create-mask-from-shape-layer returns the mask, source group and offset', async () => {
    const r = await callTool(client, 'create-mask-from-shape-layer', { layer: { name: 'Footage' }, shapeLayer: { name: 'LOGO Outlines' }, group: 1, feather: 4 });
    expect(r.isError).toBe(false);
    expect(r.json.shapeLayer).toMatchObject({ name: 'LOGO Outlines' });
    expect(r.json.sourceGroup).toMatchObject({ kind: 'group', path: 'Contents/Group 1' });
    expect(r.json.mask).toMatchObject({ name: 'Group 1 Mask', feather: [4, 4] });
    expect(r.json.offset).toEqual([0, 0]);
  });

  it('create-mask-from-shape-layer requires a shapeLayer', async () => {
    await rejected('create-mask-from-shape-layer', { layer: { index: 1 } });
  });

  it('mask-reveal-animation keys the mask path for edge wipes', async () => {
    const r = await callTool(client, 'mask-reveal-animation', { layer: { name: 'Photo' }, direction: 'right', durationFrames: 20 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ direction: 'right', maskPath: 'Masks/Reveal right', startFrame: 0, endFrame: 20 });
    const keys = r.json.keyframes as Array<{ property: string; keys: Array<{ value: { vertices: number[][] } }> }>;
    expect(keys[0].property).toBe('Masks/Reveal right/Mask Path');
    expect(keys[0].keys.length).toBe(2);
    expect(keys[0].keys[1].value.vertices.length).toBe(4);
    expect(r.json.mask).toMatchObject({ keyframes: { path: 2 } });
  });

  it('mask-reveal-animation keys feather or expansion for the soft variants', async () => {
    const feather = await callTool(client, 'mask-reveal-animation', { layer: { index: 1 }, direction: 'feather', featherAmount: 120, startTime: 0.5, duration: 0.5 });
    const fk = feather.json.keyframes as Array<{ property: string; keys: Array<{ value: number[] }> }>;
    expect(fk[0].property).toContain('Mask Feather');
    expect(fk[0].keys.map((k) => k.value)).toEqual([[120, 120], [0, 0]]);
    expect(feather.json).toMatchObject({ startTime: 0.5, endTime: 1 });
    const exp = await callTool(client, 'mask-reveal-animation', { layer: { index: 1 }, direction: 'expansion' });
    const ek = exp.json.keyframes as Array<{ property: string; keys: Array<{ value: number }> }>;
    expect(ek[0].property).toContain('Mask Expansion');
    expect(ek[0].keys[1].value).toBe(0);
  });

  it('mask-reveal-animation rejects unknown directions and bad durations before sending', async () => {
    await rejected('mask-reveal-animation', { layer: { index: 1 }, direction: 'diagonal' });
    await rejected('mask-reveal-animation', { layer: { index: 1 }, direction: 'left', duration: 0 });
    await rejected('mask-reveal-animation', { layer: { index: 1 } });
  });
});
