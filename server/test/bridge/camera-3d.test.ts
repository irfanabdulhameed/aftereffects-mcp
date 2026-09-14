import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

async function rejectedBeforeSend(name: string, args: Record<string, unknown>) {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

describe('camera-3d tools', () => {
  it('set-camera-settings converts focal length and returns the camera summary', async () => {
    const r = await callTool(client, 'set-camera-settings', { layer: { name: 'Camera 1' }, focalLength: 50, depthOfField: true, focusDistance: 1800 });
    expect(r.isError).toBe(false);
    expect(r.json.cameraOptions).toMatchObject({ depthOfField: true, focusDistance: 1800 });
    expect((r.json.cameraOptions as { zoom: number }).zoom).toBeCloseTo((1920 * 50) / 36, 3);
    expect(Array.isArray(r.json.applied)).toBe(true);
    expect((r.json.notes as string[]).join(' ')).toContain('36 mm');
    expect(tb.mock.state.log[tb.mock.state.log.length - 1].command).toBe('setCameraSettings');
  });

  it('set-camera-settings rejects an unknown iris shape and a negative zoom before sending', async () => {
    await rejectedBeforeSend('set-camera-settings', { layer: { index: 1 }, irisShape: 'star' });
    await rejectedBeforeSend('set-camera-settings', { layer: { index: 1 }, zoom: -10 });
  });

  it('animate-camera writes an orbit with linear sampled keys', async () => {
    const r = await callTool(client, 'animate-camera', { layer: { index: 1 }, move: 'orbit', amount: 90, startFrame: 0, durationFrames: 60 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ move: 'orbit', startFrame: 0, endFrame: 60, easing: 'ease-in-out', propertyPaths: ['Transform/Position'] });
    const written = r.json.keyframes as Array<{ property: string; keyframes: Array<{ inInterpolation: string }> }>;
    expect(written[0].keyframes.length).toBeGreaterThan(2);
    expect(written[0].keyframes[0].inInterpolation).toBe('linear');
  });

  it('animate-camera push-in keyframes Zoom and rack-focus keyframes Focus Distance', async () => {
    const push = await callTool(client, 'animate-camera', { layer: { index: 1 }, move: 'push-in', amount: 1.3, duration: 1 });
    expect(push.isError).toBe(false);
    expect(push.json.propertyPaths).toEqual(['Camera Options/Zoom']);
    const rack = await callTool(client, 'animate-camera', { layer: { index: 1 }, move: 'rack-focus', fromLayer: { name: 'A' }, toLayer: { name: 'B' }, easing: 'ease' });
    expect(rack.isError).toBe(false);
    expect(rack.json.propertyPaths).toEqual(['Camera Options/Focus Distance']);
    expect(rack.json.easing).toBe('ease');
  });

  it('animate-camera rejects an unknown move and a zero duration before sending', async () => {
    await rejectedBeforeSend('animate-camera', { layer: { index: 1 }, move: 'spin' });
    await rejectedBeforeSend('animate-camera', { layer: { index: 1 }, move: 'dolly', amount: 100, duration: 0 });
  });

  it('set-light-settings normalises the colour and returns light options', async () => {
    const r = await callTool(client, 'set-light-settings', { layer: { name: 'Key' }, lightType: 'spot', intensity: 120, color: '#ff8800', coneAngle: 60, castsShadows: true });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ lightType: 'spot' });
    expect(r.json.lightOptions).toMatchObject({ intensity: 120, coneAngle: 60, castsShadows: true });
    const applied = r.json.applied as Array<{ arg: string; value: unknown }>;
    const colour = applied.find((a) => a.arg === 'color');
    expect(colour?.value).toEqual([1, 0x88 / 255, 0, 1]);
  });

  it('set-light-settings rejects a bad light type and cone angle before sending', async () => {
    await rejectedBeforeSend('set-light-settings', { layer: { index: 1 }, lightType: 'laser' });
    await rejectedBeforeSend('set-light-settings', { layer: { index: 1 }, coneAngle: 400 });
  });

  it('set-layer-3d handles one layer or several and auto-orient', async () => {
    const one = await callTool(client, 'set-layer-3d', { layer: { name: 'Card' }, threeD: true });
    expect(one.isError).toBe(false);
    expect(one.json.count).toBe(1);
    const many = await callTool(client, 'set-layer-3d', { layers: [{ name: 'A' }, { name: 'B' }], threeD: true, autoOrient: 'camera-or-poi' });
    expect(many.isError).toBe(false);
    expect(many.json.count).toBe(2);
    const rows = many.json.layers as Array<{ autoOrient: string; layer: { threeD: boolean } }>;
    expect(rows[1].autoOrient).toBe('camera-or-poi');
    expect(rows[0].layer.threeD).toBe(true);
    await rejectedBeforeSend('set-layer-3d', { layer: { index: 1 }, autoOrient: 'sideways' });
  });

  it('set-material-options accepts tri-state strings and booleans', async () => {
    const r = await callTool(client, 'set-material-options', { layer: { name: 'Card' }, castsShadows: 'only', acceptsLights: true, diffuse: 60 });
    expect(r.isError).toBe(false);
    expect(r.json.materialOptions).toMatchObject({ castsShadows: 'only', diffuse: 60 });
    await rejectedBeforeSend('set-material-options', { layer: { index: 1 }, castsShadows: 'maybe' });
    await rejectedBeforeSend('set-material-options', { layer: { index: 1 }, diffuse: 150 });
  });

  it('look-at-layer sets a point of interest or an expression', async () => {
    const poi = await callTool(client, 'look-at-layer', { layer: { name: 'Camera 1' }, target: { name: 'Hero' } });
    expect(poi.isError).toBe(false);
    expect(poi.json.mode).toBe('point-of-interest');
    expect(poi.json.value).toEqual([960, 540, 0]);
    const expr = await callTool(client, 'look-at-layer', { layer: { name: 'Card' }, target: { name: 'Hero' }, useExpression: true });
    expect(expr.json.mode).toBe('expression');
    expect(expr.json.expression).toContain('lookAt(');
    expect(expr.json.expression).toContain('"Hero"');
    await rejectedBeforeSend('look-at-layer', { layer: { index: 1 } });
  });
});
