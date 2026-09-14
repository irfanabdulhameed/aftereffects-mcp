import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

/** Calls a tool with invalid input and asserts nothing reached the bridge. */
async function expectRejected(name: string, args: Record<string, unknown>) {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true, `${name} should reject ${JSON.stringify(args)}`).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

function lastCommand(): string {
  return tb.mock.state.log[tb.mock.state.log.length - 1].command;
}

describe('layers tools through the MCP server and the mock bridge', () => {
  it('list-layers accepts a type filter', async () => {
    const r = await callTool(client, 'list-layers', { type: 'text' });
    expect(r.isError).toBe(false);
    expect(r.json.count).toBe(1);
    expect((r.json.layers as Array<{ type: string }>)[0].type).toBe('text');
    await expectRejected('list-layers', { type: 'hologram' });
  });

  it('create-camera-layer returns the layer and camera options', async () => {
    const r = await callTool(client, 'create-camera-layer', { name: 'Cam', preset: '35mm', depthOfField: true });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('createCameraLayer');
    expect(r.json.layer).toMatchObject({ name: 'Cam', type: 'camera' });
    const cam = r.json.camera as { type: string; zoom: number; depthOfField: boolean; preset: string };
    expect(cam.type).toBe('two-node');
    expect(cam.preset).toBe('35mm');
    expect(cam.zoom).toBeCloseTo((1920 * 35) / 36, 2);
    expect(cam.depthOfField).toBe(true);
    await expectRejected('create-camera-layer', { preset: '85mm' });
    await expectRejected('create-camera-layer', { type: 'three-node' });
    await expectRejected('create-camera-layer', { position: [1, 2] });
  });

  it('create-light-layer normalises the colour before it reaches the bridge', async () => {
    const r = await callTool(client, 'create-light-layer', { lightType: 'spot', color: [255, 0, 0], intensity: 120, coneAngle: 60 });
    expect(r.isError).toBe(false);
    expect(r.json.layer).toMatchObject({ type: 'light' });
    expect(r.json.light).toMatchObject({ lightType: 'spot', color: '#ff0000', intensity: 120, coneAngle: 60 });
    const hex = await callTool(client, 'create-light-layer', { color: '#00ff00' });
    expect((hex.json.light as { color: string }).color).toBe('#00ff00');
    await expectRejected('create-light-layer', { lightType: 'laser' });
    await expectRejected('create-light-layer', { coneAngle: 400 });
  });

  it('add-footage-to-composition and add-composition-as-layer', async () => {
    const r = await callTool(client, 'add-footage-to-composition', { item: { name: 'clip.mov' }, frame: 24, name: 'Clip A' });
    expect(r.isError).toBe(false);
    expect(r.json.item).toMatchObject({ name: 'clip.mov', type: 'footage' });
    expect(r.json.layer).toMatchObject({ name: 'Clip A', type: 'footage' });
    await expectRejected('add-footage-to-composition', {});

    const c = await callTool(client, 'add-composition-as-layer', { sourceComp: { name: 'Scene 02' }, comp: { name: 'Master' } });
    expect(c.isError).toBe(false);
    expect(c.json.sourceComp).toMatchObject({ name: 'Scene 02' });
    expect(c.json.layer).toMatchObject({ type: 'precomp' });
    // sourceComp needs an id or a name; {active: true} alone is refused before anything is sent.
    await expectRejected('add-composition-as-layer', { sourceComp: { active: true } });
    await expectRejected('add-composition-as-layer', {});
  });

  it('delete-layer and delete-layers', async () => {
    const one = await callTool(client, 'delete-layer', { layer: { name: 'Temp' } });
    expect(one.isError).toBe(false);
    expect(one.json.removed).toMatchObject({ name: 'Temp' });
    expect(typeof one.json.remainingCount).toBe('number');
    await expectRejected('delete-layer', {});

    const many = await callTool(client, 'delete-layers', { layers: [{ index: 1 }, { index: 3 }] });
    expect(many.isError).toBe(false);
    expect(many.json.removedCount).toBe(2);
    const removed = many.json.removed as Array<{ index: number }>;
    expect(removed[0].index).toBeGreaterThan(removed[1].index);
    const sel = await callTool(client, 'delete-layers', { layers: { selected: true } });
    expect(sel.isError).toBe(false);
    await expectRejected('delete-layers', { layers: [] });
    await expectRejected('delete-layers', {});
  });

  it('rename-layer', async () => {
    const r = await callTool(client, 'rename-layer', { layer: { index: 2 }, newName: 'Card Shadow' });
    expect(r.isError).toBe(false);
    expect(r.json.layer).toMatchObject({ index: 2, name: 'Card Shadow' });
    await expectRejected('rename-layer', { layer: { index: 2 }, newName: '' });
    await expectRejected('rename-layer', { layer: { index: 2 } });
  });

  it('move-layer returns the new index and the order', async () => {
    const r = await callTool(client, 'move-layer', { layer: { index: 1 }, toBottom: true });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ previousIndex: 1, newIndex: 3 });
    expect(r.json.order).toEqual(['Card', 'BG', 'Title']);
    const idx = await callTool(client, 'move-layer', { layer: { index: 3 }, toIndex: 1 });
    expect(idx.json.newIndex).toBe(1);
    await expectRejected('move-layer', { layer: { index: 1 }, toIndex: 0 });
  });

  it('set-layer-parent and clear-layer-parent', async () => {
    const r = await callTool(client, 'set-layer-parent', { layer: { name: 'Title' }, parent: { name: 'CTRL' } });
    expect(r.isError).toBe(false);
    expect((r.json.layer as { parent: { name: string } }).parent.name).toBe('CTRL');
    expect(r.json.method).toBe('parent');
    const jump = await callTool(client, 'set-layer-parent', { layer: { name: 'Title' }, parent: { name: 'CTRL' }, keepPosition: false });
    expect(jump.json.method).toBe('setParentWithJump');
    await expectRejected('set-layer-parent', { layer: { name: 'Title' } });

    const c = await callTool(client, 'clear-layer-parent', { layer: { name: 'Title' } });
    expect(c.isError).toBe(false);
    expect((c.json.layer as { parent: unknown }).parent).toBeNull();
    expect(c.json.previousParent).toMatchObject({ name: 'CTRL' });
  });

  it('set-layer-flags reports changed and skipped', async () => {
    const r = await callTool(client, 'set-layer-flags', { layer: { index: 1 }, motionBlur: true, threeD: true, frameBlending: 'pixel-motion' });
    expect(r.isError).toBe(false);
    expect(r.json.changed).toEqual(expect.arrayContaining(['motionBlur', 'threeD', 'frameBlending']));
    expect(Array.isArray(r.json.skipped)).toBe(true);
    expect((r.json.flags as { frameBlending: string }).frameBlending).toBe('pixel-motion');
    await expectRejected('set-layer-flags', { layer: { index: 1 }, frameBlending: 'smear' });
    await expectRejected('set-layer-flags', { layer: { index: 1 }, solo: 'yes' });
  });

  it('set-layer-blend-mode validates the mode name', async () => {
    const r = await callTool(client, 'set-layer-blend-mode', { layer: { name: 'Glow' }, blendMode: 'add' });
    expect(r.isError).toBe(false);
    expect(r.json.blendMode).toBe('add');
    expect((r.json.layer as { blendMode: string }).blendMode).toBe('add');
    await expectRejected('set-layer-blend-mode', { layer: { name: 'Glow' }, blendMode: 'plus' });
  });

  it('set-layer-label-color takes a name or an index for one or many layers', async () => {
    const r = await callTool(client, 'set-layer-label-color', { layers: { selected: true }, label: 'aqua' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ label: 'aqua', labelIndex: 3 });
    const one = await callTool(client, 'set-layer-label-color', { layer: { index: 2 }, label: 9 });
    expect(one.json).toMatchObject({ label: 'green', labelIndex: 9, count: 1 });
    await expectRejected('set-layer-label-color', { layer: { index: 2 }, label: 17 });
    await expectRejected('set-layer-label-color', { layer: { index: 2 }, label: 'magenta' });
  });

  it('set-layer-track-matte', async () => {
    const r = await callTool(client, 'set-layer-track-matte', { layer: { name: 'Video' }, matteLayer: { name: 'Title' }, type: 'alpha' });
    expect(r.isError).toBe(false);
    expect(r.json.matte).toMatchObject({ name: 'Title' });
    expect(r.json.method).toBe('setTrackMatte');
    expect((r.json.layer as { trackMatte: string }).trackMatte).toBe('alpha');
    const none = await callTool(client, 'set-layer-track-matte', { layer: { name: 'Video' }, type: 'none' });
    expect(none.json.matte).toBeNull();
    await expectRejected('set-layer-track-matte', { layer: { name: 'Video' }, type: 'chroma' });
    await expectRejected('set-layer-track-matte', { layer: { name: 'Video' } });
  });

  it('set-layer-quality', async () => {
    const r = await callTool(client, 'set-layer-quality', { layer: { index: 1 }, quality: 'draft' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ previousQuality: 'best', quality: 'draft' });
    await expectRejected('set-layer-quality', { layer: { index: 1 }, quality: 'ultra' });
  });

  it('split-layer-at-time returns both halves', async () => {
    const r = await callTool(client, 'split-layer-at-time', { layer: { name: 'Clip' }, frame: 48 });
    expect(r.isError).toBe(false);
    expect(r.json.splitFrame).toBe(48);
    const before = r.json.before as { name: string; outPoint: number };
    const after = r.json.after as { name: string; inPoint: number };
    expect(before.name).toBe('Clip 1');
    expect(after.name).toBe('Clip 2');
    expect(before.outPoint).toBeCloseTo(after.inPoint, 6);
    const keep = await callTool(client, 'split-layer-at-time', { layer: { name: 'Clip' }, time: 2, keepNames: true });
    expect((keep.json.before as { name: string }).name).toBe('Clip');
    await expectRejected('split-layer-at-time', { layer: { name: 'Clip' }, suffixes: ['only-one'] });
  });

  it('align-layers and distribute-layers', async () => {
    const a = await callTool(client, 'align-layers', { layers: [{ name: 'Icon 1' }, { name: 'Icon 2' }], vertical: 'center', relativeTo: 'selection' });
    expect(a.isError).toBe(false);
    expect(a.json.relativeTo).toBe('selection');
    expect(a.json.count).toBe(2);
    const rows = a.json.layers as Array<{ name: string; position: number[]; bounds: { left: number } }>;
    expect(rows[0].name).toBe('Icon 1');
    expect(rows[0].position.length).toBe(2);
    expect(typeof rows[0].bounds.left).toBe('number');
    await expectRejected('align-layers', { layers: [{ name: 'Icon 1' }], horizontal: 'middle' });
    await expectRejected('align-layers', { layers: [{ name: 'Icon 1' }], relativeTo: 'layer' });

    const d = await callTool(client, 'distribute-layers', { layers: { selected: true }, axis: 'horizontal', mode: 'spacing', gap: 40 });
    expect(d.isError).toBe(false);
    expect(d.json).toMatchObject({ axis: 'horizontal', mode: 'spacing', gap: 40 });
    expect((d.json.layers as unknown[]).length).toBeGreaterThan(0);
    await expectRejected('distribute-layers', { layers: { selected: true } });
    await expectRejected('distribute-layers', { layers: { selected: true }, axis: 'diagonal' });
  });

  it('sequence-layers with overlap and crossfade', async () => {
    const r = await callTool(client, 'sequence-layers', { layers: [{ name: 'S1' }, { name: 'S2' }, { name: 'S3' }], intervalFrames: 90, overlapFrames: 15, crossfade: true, frame: 0 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ count: 3, crossfade: true });
    expect(r.json.overlap).toBeCloseTo(0.5, 6);
    const rows = r.json.layers as Array<{ name: string; inPoint: number; crossfadeKeys: number }>;
    expect(rows[1].inPoint).toBeCloseTo(rows[0].inPoint + 3 - 0.5, 6);
    expect(rows[0].crossfadeKeys).toBe(2);
    expect(rows[1].crossfadeKeys).toBe(4);
    expect(rows[2].crossfadeKeys).toBe(2);
    await expectRejected('sequence-layers', { layers: [{ name: 'S1' }], interval: -1 });
    await expectRejected('sequence-layers', { layers: [{ name: 'S1' }], easing: 'bouncy' });
  });

  it('select-layers and get-selected-layers', async () => {
    const all = await callTool(client, 'select-layers', { layers: { all: true } });
    expect(all.isError).toBe(false);
    expect(all.json.selectedCount).toBe(3);
    const none = await callTool(client, 'select-layers', { layers: { none: true } });
    expect(none.json.selectedCount).toBe(0);
    const some = await callTool(client, 'select-layers', { layers: [{ name: 'Title' }] });
    expect((some.json.selected as Array<{ name: string }>)[0].name).toBe('Title');
    await expectRejected('select-layers', {});
    await expectRejected('select-layers', { layers: [] });

    const sel = await callTool(client, 'get-selected-layers', {});
    expect(sel.isError).toBe(false);
    expect(sel.json.count).toBe(2);
    expect((sel.json.layers as Array<{ index: number }>)[0].index).toBe(1);
  });

  it('every layers tool goes through batch', async () => {
    const r = await callTool(client, 'batch', {
      steps: [
        { tool: 'create-camera-layer', args: { name: 'Cam' } },
        { tool: 'set-layer-flags', args: { layer: { name: 'Card' }, threeD: true } },
        { tool: 'move-layer', args: { layer: { name: 'BG' }, toBottom: true } },
      ],
    });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ steps: 3, ok: 3, failed: 0 });
  });
});
