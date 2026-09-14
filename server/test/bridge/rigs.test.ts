import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';
import { sameLayerRef } from '../../src/tools/rigs.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

function lastCommand(): string {
  return tb.mock.state.log[tb.mock.state.log.length - 1].command;
}

describe('rig-edge-glow', () => {
  it('round-trips with defaults and returns the three layers and the glow used', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'rig-edge-glow', {});
    expect(r.isError).toBe(false);
    expect(tb.mock.state.commandsRun).toBe(before + 1);
    expect(lastCommand()).toBe('rigEdgeGlow');
    expect(r.json).toMatchObject({ composition: { id: 1 }, glowUsed: 'built-in Glow', background: null });
    const stroke = r.json.stroke as Record<string, unknown>;
    expect(stroke.name).toBe('EG Stroke');
    expect((r.json.fill as Record<string, unknown>).name).toBe('EG Fill');
    expect((r.json.glow as Record<string, unknown>).name).toBe('EG Glow');
    expect(Array.isArray(r.json.notes)).toBe(true);
    expect((r.json.rect as Record<string, unknown>).width).toBe(718);
  });

  it('accepts hex colours and the background flag', async () => {
    const r = await callTool(client, 'rig-edge-glow', { gradientA: '#ec00c8', gradientB: [120, 40, 255], fillColor: 'black', addBackground: true, width: 900 });
    expect(r.isError).toBe(false);
    expect((r.json.background as Record<string, unknown>).name).toBe('EG Background');
    expect((r.json.rect as Record<string, unknown>).width).toBe(900);
  });

  it('rejects an invalid colour before sending anything', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'rig-edge-glow', { gradientA: 'not-a-colour' });
    expect(r.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('rejects a zero width before sending anything', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'rig-edge-glow', { width: 0 });
    expect(r.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });
});

describe('rig-power-warp-transition', () => {
  it('round-trips and returns every created layer plus the window', async () => {
    const r = await callTool(client, 'rig-power-warp-transition', { outgoing: { index: 1 }, depth: { index: 2 }, incoming: { index: 3 }, start: 1, duration: 1.5, scanColor: '#005aff' });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('rigPowerWarpTransition');
    expect(r.json.window).toMatchObject({ start: 1, end: 2.5, mid: 1.75 });
    const created = r.json.created as Record<string, Record<string, unknown> | null>;
    for (const key of ['fineDistortions', 'shake', 'aberrations', 'warp', 'scanLine', 'warpMap', 'shakeMap', 'fineDistortionsMap']) {
      expect(created[key], key).not.toBeNull();
    }
    expect((r.json.outgoing as Record<string, unknown>).effects).toContain('Gradient Wipe');
    expect((r.json.depth as Record<string, unknown>).enabled).toBe(false);
    expect(r.json.incoming).not.toBeNull();
    expect(Array.isArray(r.json.stack)).toBe(true);
  });

  it('honours module switches', async () => {
    const r = await callTool(client, 'rig-power-warp-transition', { outgoing: { name: 'A' }, depth: { name: 'A depth' }, modules: { shake: false, fine: false } });
    expect(r.isError).toBe(false);
    const created = r.json.created as Record<string, unknown>;
    expect(created.shake).toBeNull();
    expect(created.fineDistortionsMap).toBeNull();
    expect(created.warp).not.toBeNull();
    expect(r.json.incoming).toBeNull();
  });

  it('rejects outgoing === depth before sending anything', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'rig-power-warp-transition', { outgoing: { index: 1 }, depth: { index: 1 } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('different');
    expect(tb.mock.state.commandsRun).toBe(before);
    const byName = await callTool(client, 'rig-power-warp-transition', { outgoing: { name: 'Clip' }, depth: { name: 'clip' } });
    expect(byName.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('rejects an incoming that collides with outgoing or depth', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'rig-power-warp-transition', { outgoing: { index: 1 }, depth: { index: 2 }, incoming: { index: 2 } });
    expect(r.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('the bridge mirrors the distinct-layer check when refs differ in form', async () => {
    // {index:2} and {id:102} name the same mock layer; Node cannot tell, the bridge can.
    const r = await callTool(client, 'rig-power-warp-transition', { outgoing: { index: 2 }, depth: { id: 102 } });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: 'command-failed' });
  });

  it('rejects a missing depth layer and an invalid colour before sending', async () => {
    const before = tb.mock.state.commandsRun;
    const missing = await callTool(client, 'rig-power-warp-transition', { outgoing: { index: 1 } });
    expect(missing.isError).toBe(true);
    const badColour = await callTool(client, 'rig-power-warp-transition', { outgoing: { index: 1 }, depth: { index: 2 }, scanColor: [1, 2] });
    expect(badColour.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('sameLayerRef compares by index, id, then name', () => {
    expect(sameLayerRef({ index: 1 }, { index: 1 })).toBe(true);
    expect(sameLayerRef({ index: 1 }, { index: 2 })).toBe(false);
    expect(sameLayerRef({ id: 5 }, { id: 5 })).toBe(true);
    expect(sameLayerRef({ name: 'Depth' }, { name: 'depth' })).toBe(true);
    expect(sameLayerRef({ index: 1 }, { name: 'x' })).toBe(false);
    expect(sameLayerRef(undefined, { index: 1 })).toBe(false);
  });
});

describe('rig-depth-map-blur-reveal', () => {
  it('round-trips in auto mode and returns the guide solid as the depth source', async () => {
    const r = await callTool(client, 'rig-depth-map-blur-reveal', { layer: { index: 2 } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('rigDepthMapBlurReveal');
    expect(r.json.blurEffect).toBe('Compound Blur');
    const src = r.json.depthSource as { mode: string; layer: Record<string, unknown> };
    expect(src.mode).toBe('auto');
    expect(src.layer.name).toBe('DBR Depth (auto)');
    expect((r.json.layer as Record<string, unknown>).effects).toEqual(['Compound Blur', 'Exposure', 'Glow']);
    expect(r.json.window).toMatchObject({ start: 0, end: 0.8 });
  });

  it('uses the depth layer when one is given', async () => {
    const r = await callTool(client, 'rig-depth-map-blur-reveal', { layer: { index: 2 }, depthLayer: { index: 3 }, useGlow: false, start: 1, duration: 0.5 });
    expect(r.isError).toBe(false);
    expect((r.json.depthSource as { mode: string }).mode).toBe('layer');
    expect((r.json.layer as Record<string, unknown>).effects).toEqual(['Compound Blur', 'Exposure']);
    expect(r.json.window).toMatchObject({ start: 1, end: 1.5 });
  });

  it('blurSource "layer" without depthLayer is rejected by the bridge', async () => {
    const r = await callTool(client, 'rig-depth-map-blur-reveal', { layer: { index: 2 }, blurSource: 'layer' });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: 'command-failed' });
  });

  it('rejects a bad autoDir, ease and duration before sending anything', async () => {
    const before = tb.mock.state.commandsRun;
    expect((await callTool(client, 'rig-depth-map-blur-reveal', { layer: { index: 1 }, autoDir: 'diagonal' })).isError).toBe(true);
    expect((await callTool(client, 'rig-depth-map-blur-reveal', { layer: { index: 1 }, ease: 150 })).isError).toBe(true);
    expect((await callTool(client, 'rig-depth-map-blur-reveal', { layer: { index: 1 }, duration: 0 })).isError).toBe(true);
    expect((await callTool(client, 'rig-depth-map-blur-reveal', {})).isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });
});

describe('rig-blur-color-reveal', () => {
  it('round-trips with a layer array and returns the matte, colour and content layers', async () => {
    const r = await callTool(client, 'rig-blur-color-reveal', { layers: [{ index: 1 }, { index: 2 }], core: '#fbf895', ring: [173, 215, 255] });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('rigBlurColorReveal');
    expect((r.json.matteLayer as Record<string, unknown>).name).toBe('BR Reveal Matte');
    const color = r.json.colorLayer as Record<string, unknown>;
    expect(color.name).toBe('BR Reveal Color');
    expect(color.trackMatte).toBe('alpha');
    expect((r.json.content as Record<string, unknown>).name).toBe('BR Content');
    expect(r.json.precomposed).toMatchObject({ name: 'BR Content' });
    expect(r.json.controlNull).toBeNull();
    expect(r.json.window).toMatchObject({ start: 0, end: 1.3 });
  });

  it('accepts a single layer ref, no precompose, a custom origin and the control null', async () => {
    const r = await callTool(client, 'rig-blur-color-reveal', { layers: { name: 'Card' }, precompose: false, origin: [100, 200], addControlNull: true, nullPush: true });
    expect(r.isError).toBe(false);
    expect(r.json.precomposed).toBeNull();
    expect(r.json.origin).toEqual([100, 200]);
    expect((r.json.controlNull as Record<string, unknown>).name).toBe('BR Control');
  });

  it('rejects invalid colours and out-of-range numbers before sending anything', async () => {
    const before = tb.mock.state.commandsRun;
    expect((await callTool(client, 'rig-blur-color-reveal', { core: 'nope' })).isError).toBe(true);
    expect((await callTool(client, 'rig-blur-color-reveal', { ringWidth: -1 })).isError).toBe(true);
    expect((await callTool(client, 'rig-blur-color-reveal', { origin: [1] })).isError).toBe(true);
    expect((await callTool(client, 'rig-blur-color-reveal', { layers: [] })).isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });
});

describe('list-rigs', () => {
  it('returns four rigs with their tool names', async () => {
    const r = await callTool(client, 'list-rigs', {});
    expect(r.isError).toBe(false);
    expect(r.json.count).toBe(4);
    const rigs = r.json.rigs as Array<{ tool: string; name: string; parameters: unknown[] }>;
    expect(rigs.map((x) => x.tool).sort()).toEqual(['rig-blur-color-reveal', 'rig-depth-map-blur-reveal', 'rig-edge-glow', 'rig-power-warp-transition']);
    for (const rig of rigs) expect(Array.isArray(rig.parameters)).toBe(true);
  });

  it('filters to one rig and errors on an unknown name', async () => {
    const one = await callTool(client, 'list-rigs', { rig: 'edge-glow' });
    expect(one.json.count).toBe(1);
    const missing = await callTool(client, 'list-rigs', { rig: 'no-such-rig' });
    expect(missing.isError).toBe(true);
  });
});
