import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTool, prepareBridgeArgs } from '../../src/tools/registry.js';
import { checkStyleSettings, LAYER_STYLE_KINDS, prepareStyleKeyframes, STYLE_SETTINGS_BY_KIND } from '../../src/tools/styles.js';
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

function bridgeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const entry = findTool(name);
  if (!entry) throw new Error(`no tool ${name}`);
  return prepareBridgeArgs(entry, args, tb.client);
}

describe('layer style helpers', () => {
  it('every kind lists its settings and checkStyleSettings enforces them', () => {
    expect(Object.keys(STYLE_SETTINGS_BY_KIND).sort()).toEqual([...LAYER_STYLE_KINDS].sort());
    expect(() => checkStyleSettings('drop-shadow', { opacity: 10, distance: 4, layerKnocksOut: false })).not.toThrow();
    expect(() => checkStyleSettings('stroke', { distance: 4 })).toThrow(/distance does not apply to stroke/);
    expect(() => checkStyleSettings('bevel-emboss', { technique: 'precise' })).toThrow(/smooth or chisel-hard or chisel-soft/);
    expect(() => checkStyleSettings('outer-glow', { technique: 'chisel-hard' })).toThrow(/softer or precise/);
    expect(() => checkStyleSettings('gradient-overlay', { colors: ['#000', '#fff'], gradientStyle: 'radial' })).not.toThrow();
  });

  it('prepareStyleKeyframes normalises colours and rejects wrong value types', () => {
    const keys = prepareStyleKeyframes('drop-shadow', [
      { setting: 'color', frame: 0, value: 'red' },
      { setting: 'distance', frame: 12, value: 16 },
    ]);
    expect(keys[0].value).toEqual([1, 0, 0, 1]);
    expect(keys[1].value).toBe(16);
    expect(() => prepareStyleKeyframes('drop-shadow', [{ setting: 'distance', frame: 0, value: 'far' }])).toThrow(/bad value for distance/);
    expect(() => prepareStyleKeyframes('drop-shadow', [{ setting: 'blendMode', frame: 0, value: 'glow' }])).toThrow(/bad value for blendMode/);
    expect(() => prepareStyleKeyframes('stroke', [{ setting: 'angle', frame: 0, value: 90 }])).toThrow(/angle does not apply to stroke/);
    expect(() => prepareStyleKeyframes('stroke', [{ setting: 'size', frame: 0 }])).toThrow(/value is required/);
  });

  it('colours in settings reach the bridge as [r, g, b, a]', () => {
    const args = bridgeArgs('add-layer-style', { layer: { name: 'Card' }, kind: 'bevel-emboss', settings: { highlightColor: '#ffffff', shadowColor: [0, 0, 0] } });
    expect(args.settings).toEqual({ highlightColor: [1, 1, 1, 1], shadowColor: [0, 0, 0, 1] });
    const grad = bridgeArgs('add-layer-style', { layer: { index: 1 }, kind: 'gradient-overlay', settings: { colors: ['#ff0000', { color: '#0000ff', location: 80 }] } });
    expect((grad.settings as { colors: unknown[] }).colors).toEqual([[1, 0, 0, 1], { color: [0, 0, 1, 1], location: 80 }]);
    const keyed = bridgeArgs('set-layer-style', { layer: { index: 1 }, kind: 'outer-glow', keyframes: [{ setting: 'color', time: 0, value: { r: 255, g: 128, b: 0 } }] });
    expect((keyed.keyframes as Array<{ value: number[] }>)[0].value[0]).toBe(1);
    expect((keyed.keyframes as Array<{ value: number[] }>)[0].value[2]).toBe(0);
  });
});

describe('layer style tools through the MCP server and the mock bridge', () => {
  it('add-layer-style turns a drop shadow on with designed defaults under the given settings', async () => {
    const r = await callTool(client, 'add-layer-style', { layer: { name: 'Card' }, kind: 'drop-shadow', settings: { opacity: 14, size: 30 } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('addLayerStyle');
    expect(r.json).toMatchObject({ kind: 'drop-shadow', count: 1, failed: 0 });
    const res = (r.json.results as Array<Record<string, unknown>>)[0];
    expect(res).toMatchObject({ status: 'ok', added: true, method: 'menu', defaultsApplied: true, layer: { name: 'Card' } });
    expect(res.style).toMatchObject({ kind: 'drop-shadow', label: 'Drop Shadow', on: true, path: 'Layer Styles/Drop Shadow', settings: { opacity: 14, size: 30, distance: 6, angle: 90, color: '#000000', blendMode: 'multiply' } });
    expect(r.json.menuCommand).toMatchObject({ menuId: 9000, menuItem: 'Layer > Layer Styles > Drop Shadow' });
  });

  it('add-layer-style styles many layers and reports each', async () => {
    const r = await callTool(client, 'add-layer-style', { layers: [{ name: 'Card' }, { name: 'Button' }], kind: 'stroke', settings: { color: 'red', size: 2, position: 'outside' }, fillOpacity: 0 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ count: 2, failed: 0 });
    const results = r.json.results as Array<{ layer: { name: string }; style: { settings: Record<string, unknown> }; changed: string[] }>;
    expect(results.map((x) => x.layer.name)).toEqual(['Card', 'Button']);
    expect(results[0].style.settings).toMatchObject({ color: '#ff0000', size: 2, position: 'outside' });
    expect(results[0].changed).toContain('fillOpacity');
    expect(r.json.menuCommand).toMatchObject({ menuId: 9008 });
    const sel = await callTool(client, 'add-layer-style', { layers: { selected: true }, kind: 'outer-glow' });
    expect(sel.json.count).toBe(2);
  });

  it('add-layer-style draws gradient colours with a Gradient Ramp effect', async () => {
    const r = await callTool(client, 'add-layer-style', { layer: { index: 2 }, kind: 'gradient-overlay', settings: { colors: ['#ff0000', '#0000ff'], angle: 90 } });
    expect(r.isError).toBe(false);
    const res = (r.json.results as Array<Record<string, unknown>>)[0];
    expect(res.method).toBe('gradient-ramp-effect');
    expect(res.colorsEffect).toMatchObject({ effect: 'Gradient Overlay Colors', startColor: '#ff0000', endColor: '#0000ff', shape: 'linear' });
    expect(r.json.menuCommand).toBeNull();
  });

  it('add-layer-style rejects bad input before sending', async () => {
    await rejected('add-layer-style', { layer: { index: 1 }, kind: 'pattern-overlay' });
    await rejected('add-layer-style', { layer: { index: 1 }, kind: 'stroke', settings: { distance: 4 } });
    await rejected('add-layer-style', { layer: { index: 1 }, kind: 'bevel-emboss', settings: { technique: 'softer' } });
    await rejected('add-layer-style', { layer: { index: 1 }, kind: 'drop-shadow', settings: { opacty: 10 } });
    await rejected('add-layer-style', { layer: { index: 1 }, kind: 'drop-shadow', settings: { opacity: 120 } });
    await rejected('add-layer-style', { layer: { index: 1 }, kind: 'drop-shadow', settings: { color: 'not-a-colour' } });
    await rejected('add-layer-style', { layer: { index: 1 }, kind: 'gradient-overlay', settings: { colors: ['#fff'] } });
    await rejected('add-layer-style', { kind: 'drop-shadow' });
    await rejected('add-layer-style', { layer: { index: 1 }, layers: [{ index: 2 }], kind: 'drop-shadow' });
  });

  it('set-layer-style writes static settings and eased keyframes grouped per setting', async () => {
    const r = await callTool(client, 'set-layer-style', {
      layer: { name: 'Card' },
      kind: 'drop-shadow',
      settings: { opacity: 18 },
      keyframes: [
        { setting: 'distance', frame: 12, value: 16 },
        { setting: 'distance', frame: 0, value: 4 },
        { setting: 'color', frame: 0, value: 'red' },
        { setting: 'blendMode', frame: 6, value: 'normal' },
      ],
    });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('setLayerStyle');
    expect(r.json.changed).toEqual(['opacity']);
    const keys = r.json.keyframes as Array<{ setting: string; numKeys: number; keys: Array<{ frame: number; value: unknown; inInterpolation: string }> }>;
    const dist = keys.find((k) => k.setting === 'distance');
    expect(dist?.keys.map((k) => [k.frame, k.value])).toEqual([[0, 4], [12, 16]]);
    expect(keys.find((k) => k.setting === 'color')?.keys[0].value).toBe('#ff0000');
    expect(keys.find((k) => k.setting === 'blendMode')?.keys[0].inInterpolation).toBe('hold');
    expect(r.json.style).toMatchObject({ keyed: { distance: 2, color: 1, blendMode: 1 } });
  });

  it('set-layer-style rejects empty calls and bad keyframes before sending', async () => {
    await rejected('set-layer-style', { layer: { index: 1 }, kind: 'drop-shadow' });
    await rejected('set-layer-style', { layer: { index: 1 }, kind: 'drop-shadow', keyframes: [{ setting: 'distance', value: 4 }] });
    await rejected('set-layer-style', { layer: { index: 1 }, kind: 'drop-shadow', keyframes: [{ setting: 'distance', frame: 0, value: 'far' }] });
    await rejected('set-layer-style', { layer: { index: 1 }, kind: 'stroke', keyframes: [{ setting: 'angle', frame: 0, value: 90 }] });
    await rejected('set-layer-style', { layer: { index: 1 }, kind: 'gradient-overlay', keyframes: [{ setting: 'colors', frame: 0, value: ['#000', '#fff'] }] });
    await rejected('set-layer-style', { kind: 'drop-shadow', settings: { opacity: 10 } });
  });

  it('remove-layer-style switches one kind or every style off', async () => {
    const one = await callTool(client, 'remove-layer-style', { layer: { name: 'Card' }, kind: 'drop-shadow' });
    expect(one.isError).toBe(false);
    expect(lastCommand()).toBe('removeLayerStyle');
    expect((one.json.results as Array<{ turnedOff: string[] }>)[0].turnedOff).toEqual(['drop-shadow']);
    const all = await callTool(client, 'remove-layer-style', { layers: [{ index: 2 }, { index: 3 }], all: true });
    expect(all.json).toMatchObject({ count: 2, kind: 'all' });
    expect((all.json.results as Array<{ notAdded: string[] }>)[0].notAdded).toContain('satin');
  });

  it('remove-layer-style needs kind or all, not both', async () => {
    await rejected('remove-layer-style', { layer: { index: 1 } });
    await rejected('remove-layer-style', { layer: { index: 1 }, kind: 'stroke', all: true });
    await rejected('remove-layer-style', { kind: 'stroke' });
  });

  it('list-layer-styles reads styles, settings and blending options', async () => {
    const r = await callTool(client, 'list-layer-styles', { layer: { name: 'Card' } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('listLayerStyles');
    const layers = r.json.layers as Array<{ styles: Array<{ kind: string; on: boolean }>; blendingOptions: Record<string, unknown>; notAdded: string[] }>;
    expect(layers[0].styles.map((s) => [s.kind, s.on])).toEqual([['drop-shadow', true], ['stroke', false]]);
    expect(layers[0].blendingOptions).toMatchObject({ globalLightAngle: 120, fillOpacity: 100 });
    const onOnly = await callTool(client, 'list-layer-styles', { layers: { all: true }, includeOff: false });
    expect((onOnly.json.layers as Array<{ styles: unknown[] }>)[0].styles.length).toBe(1);
    await rejected('list-layer-styles', {});
  });
});
