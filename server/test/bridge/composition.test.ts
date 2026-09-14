import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

const lastCommand = () => tb.mock.state.log[tb.mock.state.log.length - 1];

describe('composition tools', () => {
  it('create-composition, list-compositions and get-composition-info still work', async () => {
    const created = await callTool(client, 'create-composition', { name: 'Intro', preset: '1080p25', folder: { name: 'Comps' } });
    expect(created.isError).toBe(false);
    expect(created.json).toMatchObject({ composition: { name: 'Intro' }, preset: '1080p25' });
    const list = await callTool(client, 'list-compositions', {});
    expect(list.json).toMatchObject({ count: 1, activeComp: { id: 1 } });
    const info = await callTool(client, 'get-composition-info', { comp: { id: 1 } });
    expect(info.json).toMatchObject({ id: 1, frameRate: 30 });
    expect(Array.isArray(info.json.layers)).toBe(true);
  });

  it('create-composition rejects an unknown preset before sending', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'create-composition', { name: 'x', preset: '8k' });
    expect(r.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('set-composition-settings applies a subset and reports what changed', async () => {
    const r = await callTool(client, 'set-composition-settings', { comp: { name: 'Main Comp' }, frameRate: 25, durationFrames: 250, motionBlur: true, bgColor: '#ff0000', resolutionFactor: [2, 2], displayStartFrame: 100, name: 'Main 25' });
    expect(r.isError).toBe(false);
    expect(r.json.changed).toEqual(['name', 'frameRate', 'durationFrames', 'bgColor', 'motionBlur', 'resolutionFactor', 'displayStartFrame']);
    expect(r.json.composition).toMatchObject({ name: 'Main 25', frameRate: 25, duration: 10, durationFrames: 250, motionBlur: true, bgColor: '#ff0000', resolutionFactor: [2, 2], displayStartFrame: 100, displayStartTime: 4 });
    // the colour reached the bridge as [r,g,b,a] in 0..1
    expect(lastCommand().command).toBe('setCompositionSettings');
  });

  it('set-composition-settings with nothing to change returns an empty changed list', async () => {
    const r = await callTool(client, 'set-composition-settings', {});
    expect(r.isError).toBe(false);
    expect(r.json.changed).toEqual([]);
  });

  it('set-composition-settings rejects out-of-range values before sending', async () => {
    const before = tb.mock.state.commandsRun;
    for (const bad of [{ width: 2 }, { shutterAngle: 800 }, { motionBlurSamplesPerFrame: 1 }, { resolutionFactor: [1] }, { frameRate: 0 }]) {
      const r = await callTool(client, 'set-composition-settings', bad as Record<string, unknown>);
      expect(r.isError, JSON.stringify(bad)).toBe(true);
    }
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('duplicate-composition returns the source ref and the new comp with a new id', async () => {
    const r = await callTool(client, 'duplicate-composition', { comp: { id: 1 }, newName: 'Main FR', openInViewer: true });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ source: { id: 1, name: 'Main Comp' }, composition: { id: 8, name: 'Main FR', width: 1920 } });
    const auto = await callTool(client, 'duplicate-composition', {});
    expect(auto.json.composition).toMatchObject({ name: 'Main Comp 2' });
  });

  it('rename-composition returns the new and previous names', async () => {
    const r = await callTool(client, 'rename-composition', { comp: { id: 1 }, newName: 'Hero' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ composition: { id: 1, name: 'Hero' }, previousName: 'Main Comp' });
    const before = tb.mock.state.commandsRun;
    const empty = await callTool(client, 'rename-composition', { newName: '' });
    expect(empty.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('delete-composition refuses nested comps without force', async () => {
    const refused = await callTool(client, 'delete-composition', { comp: { id: 7 } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('force');
    expect(refused.json).toMatchObject({ bridgeError: { code: 'invalid-argument' } });
    expect(refused.text).toContain('Main Comp');
    const forced = await callTool(client, 'delete-composition', { comp: { id: 7 }, force: true });
    expect(forced.isError).toBe(false);
    expect(forced.json).toMatchObject({ removed: { id: 7 }, usedInCount: 1, forced: true });
    const plain = await callTool(client, 'delete-composition', { comp: { id: 1 } });
    expect(plain.json).toMatchObject({ removed: { id: 1, name: 'Main Comp' }, usedInCount: 0, numLayers: 3, forced: false });
    const missing = await callTool(client, 'delete-composition', { comp: { name: 'missing' } });
    expect(missing.isError).toBe(true);
    expect(missing.json).toMatchObject({ bridgeError: { code: 'not-found' } });
  });

  it('set-work-area accepts frames, seconds or a duration and clamps to the comp', async () => {
    const frames = await callTool(client, 'set-work-area', { startFrame: 30, endFrame: 120 });
    expect(frames.isError).toBe(false);
    expect(frames.json).toMatchObject({ composition: { id: 1 }, workAreaStart: 1, workAreaEnd: 4, workAreaDuration: 3, workAreaStartFrame: 30, workAreaEndFrame: 120, workAreaDurationFrames: 90 });
    const dur = await callTool(client, 'set-work-area', { start: 2, duration: 2 });
    expect(dur.json).toMatchObject({ workAreaStart: 2, workAreaEnd: 4, workAreaDurationFrames: 60 });
    const clamped = await callTool(client, 'set-work-area', { start: 0, end: 99 });
    expect(clamped.json).toMatchObject({ workAreaEnd: 10, workAreaEndFrame: 300 });
    const before = tb.mock.state.commandsRun;
    const bad = await callTool(client, 'set-work-area', { startFrame: -1 });
    expect(bad.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('set-current-time takes a frame (wins) or seconds and returns both', async () => {
    const byFrame = await callTool(client, 'set-current-time', { frame: 48, time: 9 });
    expect(byFrame.isError).toBe(false);
    expect(byFrame.json).toMatchObject({ composition: { id: 1 }, time: 1.6, frame: 48 });
    const bySeconds = await callTool(client, 'set-current-time', { comp: { id: 1 }, time: 2.5 });
    expect(bySeconds.json).toMatchObject({ time: 2.5, frame: 75 });
    const neither = await callTool(client, 'set-current-time', {});
    expect(neither.isError).toBe(true);
  });

  it('precompose returns the precomp and the new layer, trimming when asked', async () => {
    const r = await callTool(client, 'precompose', { layers: [{ name: 'Title' }, { name: 'Underline' }], name: 'Title Group' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ composition: { id: 1 }, precomp: { id: 30, name: 'Title Group', numLayers: 2 }, layer: { name: 'Title Group', type: 'precomp', source: { id: 30 } }, moveAllAttributes: true, trimmed: false });
    expect((r.json.sourceLayers as unknown[]).length).toBe(2);

    const trimmed = await callTool(client, 'precompose', { layers: { selected: true }, name: 'Sel', trimToLayers: true });
    expect(trimmed.json).toMatchObject({ trimmed: true, layer: { inPoint: 1, outPoint: 4, inFrame: 30, outFrame: 120 }, precomp: { duration: 4 } });

    const leave = await callTool(client, 'precompose', { layers: [{ index: 1 }, { index: 2 }], name: 'x', moveAllAttributes: false });
    expect(leave.isError).toBe(true);
    expect(leave.text).toContain('single layer');

    const before = tb.mock.state.commandsRun;
    const noLayers = await callTool(client, 'precompose', { layers: [], name: 'x' });
    expect(noLayers.isError).toBe(true);
    const noName = await callTool(client, 'precompose', { layers: [{ index: 1 }] });
    expect(noName.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('open-composition-in-viewer returns the comp ref and active flag', async () => {
    const r = await callTool(client, 'open-composition-in-viewer', { comp: { name: 'Main Comp' } });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ composition: { id: 1, name: 'Main Comp' }, active: true });
    expect(lastCommand().command).toBe('openCompositionInViewer');
  });

  it('crop-composition-to-region resizes and reports moved and skipped layers', async () => {
    const r = await callTool(client, 'crop-composition-to-region', { region: { x: 100.4, y: 50, width: 800, height: 600 } });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ composition: { width: 800, height: 600 }, region: { x: 100, y: 50, width: 800, height: 600 }, movedLayers: 2 });
    expect((r.json.skippedLayers as Array<{ reason: string }>)[0].reason).toContain('parented');

    const fromLayer = await callTool(client, 'crop-composition-to-region', { fromLayer: { name: 'Logo' }, padding: 40 });
    expect(fromLayer.json).toMatchObject({ region: { x: 660, y: 360, width: 600, height: 360 } });

    const neither = await callTool(client, 'crop-composition-to-region', {});
    expect(neither.isError).toBe(true);

    const before = tb.mock.state.commandsRun;
    const bad = await callTool(client, 'crop-composition-to-region', { region: { x: 0, y: 0, width: 0, height: 10 } });
    expect(bad.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });
});
