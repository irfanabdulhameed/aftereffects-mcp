import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog, prepareBridgeArgs } from '../../src/tools/registry.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

async function rejectedBeforeSend(name: string, args: Record<string, unknown>): Promise<void> {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

function lastCommand(): { command: string } {
  return tb.mock.state.log[tb.mock.state.log.length - 1];
}

function bridgeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const entry = catalog.find((c) => c.name === name);
  if (!entry) throw new Error(`no tool ${name}`);
  return prepareBridgeArgs(entry, args, tb.client);
}

type Scene = { position: number; name: string; compId: number; inFrame: number; outFrame: number; durationFrames: number; gapBeforeFrames: number; notes: string; transition: string | null };

const SCENE_TOOLS = ['create-scene-plan', 'list-scenes', 'set-scene-duration', 'insert-scene', 'remove-scene', 'add-reference-overlay'];

describe('scenes tools: registration', () => {
  it('registers every tool in the scenes group with a template description of 60 to 200 words', () => {
    for (const name of SCENE_TOOLS) {
      const entry = catalog.find((c) => c.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.group).toBe('scenes');
      const words = entry!.description.split(/\s+/).length;
      expect(words, name).toBeGreaterThanOrEqual(60);
      expect(words, name).toBeLessThanOrEqual(200);
      const labels = ['Use when:', 'Do not use for:', 'Inputs:', 'Returns:', 'Notes:', 'Example:'].map((l) => entry!.description.indexOf(l));
      expect(labels.every((i) => i > 0), name).toBe(true);
      expect([...labels].sort((a, b) => a - b), name).toEqual(labels);
      expect(entry!.description, name).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it('marks list-scenes read-only and gives the sequence tools a long timeout', () => {
    expect(catalog.find((c) => c.name === 'list-scenes')!.mutating).toBe(false);
    for (const name of ['create-scene-plan', 'set-scene-duration', 'insert-scene', 'remove-scene']) {
      expect(catalog.find((c) => c.name === name)!.timeout, name).toBe(60000);
    }
  });
});

describe('create-scene-plan', () => {
  it('lays out numbered scene comps in order and returns the structure', async () => {
    const r = await callTool(client, 'create-scene-plan', {
      filmName: 'Promo',
      fps: 60,
      scenes: [
        { name: 'Intro', duration: 2, notes: 'Logo builds from the dot' },
        { name: 'Feature', durationFrames: 150, transition: 'match-cut' },
        { name: 'Outro', duration: 1.5 },
      ],
    });
    expect(r.isError).toBe(false);
    expect(lastCommand().command).toBe('createScenePlan');
    expect(r.json).toMatchObject({ created: true, mode: 'created', count: 3, composition: { name: 'Promo', frameRate: 60, durationFrames: 360 } });
    expect(r.json.scenesFolder).toMatchObject({ name: 'Scenes', type: 'folder' });
    const scenes = r.json.scenes as Scene[];
    expect(scenes.map((s) => s.name)).toEqual(['01 Intro', '02 Feature', '03 Outro']);
    expect(scenes.map((s) => [s.inFrame, s.outFrame])).toEqual([[0, 120], [120, 270], [270, 360]]);
    expect(scenes[0].notes).toBe('Logo builds from the dot');
    expect(scenes[1].transition).toBe('match-cut');
  });

  it('resolves overlaps on the server: explicit, plan-wide, and 0.5 s for push and shape-reveal cuts', () => {
    const a = bridgeArgs('create-scene-plan', {
      filmName: 'F',
      fps: 30,
      scenes: [
        { name: 'A', duration: 2, transition: 'push' },
        { name: 'B', duration: 2, overlapFrames: 4 },
        { name: 'C', duration: 2, transition: 'shape-reveal' },
        { name: 'D', duration: 2 },
      ],
    }) as { scenes: Array<{ overlapFrames: number }> };
    expect(a.scenes.map((s) => s.overlapFrames)).toEqual([15, 4, 15, 0]);
    const b = bridgeArgs('create-scene-plan', { filmName: 'F', overlapFrames: 6, scenes: [{ name: 'A', duration: 1, transition: 'push' }, { name: 'B', duration: 1 }] }) as { scenes: Array<{ overlapFrames: number }> };
    expect(b.scenes.map((s) => s.overlapFrames)).toEqual([6, 0]);
    // A short scene caps the automatic overlap below its length.
    const c = bridgeArgs('create-scene-plan', { filmName: 'F', scenes: [{ name: 'A', durationFrames: 10, transition: 'push' }, { name: 'B', durationFrames: 8 }] }) as { scenes: Array<{ overlapFrames: number }> };
    expect(c.scenes[0].overlapFrames).toBe(7);
  });

  it('rejects bad plans before anything is sent', async () => {
    await rejectedBeforeSend('create-scene-plan', { filmName: 'F', scenes: [] });
    await rejectedBeforeSend('create-scene-plan', { filmName: 'F', scenes: [{ name: 'A' }] });
    await rejectedBeforeSend('create-scene-plan', { filmName: 'F', scenes: [{ name: 'Intro', duration: 1 }, { name: '02 intro', duration: 1 }] });
    await rejectedBeforeSend('create-scene-plan', { filmName: 'F', scenes: [{ name: '01', duration: 1 }] });
    await rejectedBeforeSend('create-scene-plan', { filmName: 'F', scenes: [{ name: 'A', durationFrames: 10, overlapFrames: 10 }, { name: 'B', durationFrames: 30 }] });
    await rejectedBeforeSend('create-scene-plan', { filmName: 'F', scenes: [{ name: 'A', duration: 1, transition: 'crossfade' }] });
    await rejectedBeforeSend('create-scene-plan', { filmName: 'F', fps: 0, scenes: [{ name: 'A', duration: 1 }] });
    await rejectedBeforeSend('create-scene-plan', { filmName: '', scenes: [{ name: 'A', duration: 1 }] });
  });

  it('re-running with the same film name updates instead of duplicating', async () => {
    const r = await callTool(client, 'create-scene-plan', { filmName: 'Launch Film', scenes: [{ name: 'Intro', duration: 4 }, { name: 'Pricing', duration: 2 }] });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ created: false, existed: true, mode: 'update' });
    const changes = r.json.changes as Array<{ scene: string; change: string }>;
    expect(changes.map((c) => c.change)).toEqual(['duration', 'inserted']);
    expect(r.json.kept).toEqual(['Feature', 'Outro']);
    const report = await callTool(client, 'create-scene-plan', { filmName: 'Launch Film', ifExists: 'report', scenes: [{ name: 'Intro', duration: 4 }] });
    expect(report.json).toMatchObject({ mode: 'report', changes: [] });
  });
});

describe('list-scenes', () => {
  it('returns the sequence with gaps, overlaps, unplaced comps and transitions', async () => {
    const r = await callTool(client, 'list-scenes', { comp: { name: 'Launch Film' } });
    expect(r.isError).toBe(false);
    expect(lastCommand().command).toBe('listScenes');
    const scenes = r.json.scenes as Scene[];
    expect(scenes.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(scenes[2].gapBeforeFrames).toBe(-15);
    expect(r.json.overlaps).toEqual([{ outgoing: '02 Feature', incoming: '03 Outro', startFrame: 210, frames: 15 }]);
    expect(r.json.unplaced).toEqual([{ id: 65, name: '04 Spare' }]);
    expect(r.json).toMatchObject({ isPlan: true, count: 3, totalFrames: 270 });
  });
});

describe('set-scene-duration', () => {
  it('changes one scene and ripples the later ones', async () => {
    const r = await callTool(client, 'set-scene-duration', { comp: { name: 'Launch Film' }, scene: 'Feature', duration: 5 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ changed: true, deltaFrames: 15 });
    const scene = r.json.scene as { before: Scene; after: Scene };
    expect(scene.before.durationFrames).toBe(135);
    expect(scene.after.durationFrames).toBe(150);
    expect((r.json.moved as { scenes: string[] }).scenes).toEqual(['03 Outro']);
    const scenes = r.json.scenes as Scene[];
    expect(scenes[2].inFrame).toBe(225);
    expect(scenes[2].gapBeforeFrames).toBe(-15);
  });

  it('accepts a position, a numbered name or a compId, and rebuilds transitions on the changed cut', async () => {
    const byPos = await callTool(client, 'set-scene-duration', { scene: 1, durationFrames: 100 });
    expect(byPos.json.transitionsRebuilt).toEqual([{ previousId: 'tmock1', id: 'tmock2', kind: 'match-cut', cutFrame: 100 }]);
    const byId = await callTool(client, 'set-scene-duration', { scene: { compId: 63 }, durationFrames: 30 });
    expect(byId.json.deltaFrames).toBe(-30);
    expect(byId.json.transitionsRebuilt).toEqual([]);
    const missing = await callTool(client, 'set-scene-duration', { scene: 'Credits', duration: 2 });
    expect(missing.isError).toBe(true);
    expect(missing.json.error).toBe('command-failed');
    expect((missing.json.bridgeError as { code: string }).code).toBe('not-found');
  });

  it('needs a duration and a valid scene reference', async () => {
    await rejectedBeforeSend('set-scene-duration', { scene: 'Feature' });
    await rejectedBeforeSend('set-scene-duration', { scene: {}, duration: 2 });
    await rejectedBeforeSend('set-scene-duration', { scene: 0, duration: 2 });
    await rejectedBeforeSend('set-scene-duration', { scene: 'Feature', duration: -1 });
  });
});

describe('insert-scene and remove-scene', () => {
  it('insert-scene places the scene after another, renumbers and reports the removed transition', async () => {
    const r = await callTool(client, 'insert-scene', { comp: { name: 'Launch Film' }, name: 'Pricing', duration: 3, after: 'Intro', notes: 'Three plans' });
    expect(r.isError).toBe(false);
    expect(lastCommand().command).toBe('insertScene');
    expect(r.json.scene).toMatchObject({ position: 2, name: '02 Pricing', inFrame: 90, durationFrames: 90 });
    expect(r.json.renames).toEqual([{ from: '02 Feature', to: '03 Feature' }, { from: '03 Outro', to: '04 Outro' }]);
    const removed = r.json.transitionsRemoved as Array<{ id: string; args: Record<string, unknown> }>;
    expect(removed[0]).toMatchObject({ id: 'tmock1', args: { kind: 'match-cut' } });
  });

  it('insert-scene takes only one of after, before and position', async () => {
    await rejectedBeforeSend('insert-scene', { name: 'X', duration: 1, after: 1, before: 2 });
    await rejectedBeforeSend('insert-scene', { name: 'X', duration: 1, after: 'Intro', position: 3 });
    await rejectedBeforeSend('insert-scene', { name: 'X' });
    const atEnd = await callTool(client, 'insert-scene', { name: 'Credits', durationFrames: 45 });
    expect(atEnd.json.scene).toMatchObject({ position: 4, name: '04 Credits' });
    expect(atEnd.json.deltaFrames).toBe(0);
  });

  it('remove-scene closes the gap and reports what it removed', async () => {
    const r = await callTool(client, 'remove-scene', { comp: { name: 'Launch Film' }, scene: 1, deleteComp: true });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ compDeleted: true, deltaFrames: -90, count: 2 });
    expect(r.json.removed).toMatchObject({ name: '01 Intro', compId: 61 });
    expect((r.json.scenes as Scene[]).map((s) => s.name)).toEqual(['01 Feature', '02 Outro']);
    expect(r.json.renames).toEqual([{ from: '02 Feature', to: '01 Feature' }, { from: '03 Outro', to: '02 Outro' }]);
    await rejectedBeforeSend('remove-scene', { comp: { name: 'Launch Film' } });
  });
});

describe('add-reference-overlay', () => {
  it('overlays a reference as a locked guide layer at 50 % by default', async () => {
    const args = { comp: { name: 'Main Comp' }, path: '/refs/feature.mp4', startFrame: 12 };
    expect(bridgeArgs('add-reference-overlay', args).opacity).toBe(50);
    const r = await callTool(client, 'add-reference-overlay', args);
    expect(r.isError).toBe(false);
    expect(lastCommand().command).toBe('addReferenceOverlay');
    expect(r.json).toMatchObject({ mode: 'overlay', imported: true, startFrame: 12 });
    expect(r.json.layer).toMatchObject({ isGuide: true, locked: true, blendMode: 'normal', label: 'red', name: 'Reference: feature.mp4' });
  });

  it('defaults opacity to 100 for difference and side by side, and keeps an explicit one', () => {
    expect(bridgeArgs('add-reference-overlay', { path: '/a.mp4', blendMode: 'difference' }).opacity).toBe(100);
    expect(bridgeArgs('add-reference-overlay', { path: '/a.mp4', sideBySide: true }).opacity).toBe(100);
    expect(bridgeArgs('add-reference-overlay', { item: { name: 'ref' }, opacity: 30, blendMode: 'difference' }).opacity).toBe(30);
  });

  it('builds a review comp with sideBySide', async () => {
    const r = await callTool(client, 'add-reference-overlay', { item: { name: 'ref.mov' }, sideBySide: true, referenceSide: 'right', gap: 40 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ mode: 'side-by-side', imported: false, referenceSide: 'right' });
    expect(r.json.reviewComp).toMatchObject({ width: 3880, height: 1080 });
    expect((r.json.layers as { labels: unknown[] }).labels).toHaveLength(2);
  });

  it('needs exactly one of path and item, and side-by-side options only with sideBySide', async () => {
    await rejectedBeforeSend('add-reference-overlay', {});
    await rejectedBeforeSend('add-reference-overlay', { path: '/a.mp4', item: { id: 3 } });
    await rejectedBeforeSend('add-reference-overlay', { path: '/a.mp4', referenceSide: 'right' });
    await rejectedBeforeSend('add-reference-overlay', { path: '/a.mp4', blendMode: 'multiply' });
    await rejectedBeforeSend('add-reference-overlay', { path: '/a.mp4', opacity: 120 });
    await rejectedBeforeSend('add-reference-overlay', { path: '/a.mp4', fit: 'fill' });
  });
});
