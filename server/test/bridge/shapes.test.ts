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

describe('shape tools through the MCP server and the mock bridge', () => {
  it('create-shape-layer still works and returns the group and path property paths', async () => {
    const r = await callTool(client, 'create-shape-layer', { shapeType: 'rounded-rectangle', size: [720, 140], roundness: 28, fillColor: '#111111' });
    expect(r.isError).toBe(false);
    expect(r.json.layer).toMatchObject({ type: 'shape', groupPath: 'Contents/Group 1' });
  });

  it('add-shape-to-layer returns the new group, paths and group count', async () => {
    const r = await callTool(client, 'add-shape-to-layer', { layer: { name: 'Icon' }, shapeType: 'circle', size: [40, 40], offset: [120, 0], fillColor: '#ff5a36', groupName: 'Dot' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ groupPath: 'Contents/Dot', pathPropertyPath: 'Contents/Dot/Ellipse Path 1', fillPath: 'Contents/Dot/Fill 1', strokePath: null, offset: [120, 0], groupCount: 2 });
    expect(r.json.group).toMatchObject({ kind: 'group', name: 'Dot' });
    expect(lastCommand()).toBe('addShapeToLayer');
  });

  it('add-shape-to-layer rejects an unknown shapeType and a bad offset before sending', async () => {
    await rejected('add-shape-to-layer', { layer: { index: 1 }, shapeType: 'hexagon' });
    await rejected('add-shape-to-layer', { layer: { index: 1 }, offset: [1] });
  });

  it('set-shape-fill normalises the colour to [r,g,b,a] and returns the fill path', async () => {
    const r = await callTool(client, 'set-shape-fill', { layer: { name: 'Card' }, color: '#1e90ff', opacity: 85 });
    expect(r.isError).toBe(false);
    expect(r.json.fillPath).toBe('Contents/Group 1/Fill 1');
    expect(r.json.values).toMatchObject({ kind: 'fill', opacity: 85 });
    const received = (r.json.received as { color: number[] }).color;
    expect(received.length).toBe(4);
    expect(received[0]).toBeCloseTo(30 / 255, 5);
    expect(received[3]).toBe(1);
  });

  it('set-shape-fill with a gradient reports the stops warning', async () => {
    const r = await callTool(client, 'set-shape-fill', { layer: { index: 1 }, group: 'Group 1', gradient: { type: 'radial', start: [0, 0], end: [200, 0], stops: [{ position: 0, color: 'white' }, { position: 1, color: 'black' }] } });
    expect(r.isError).toBe(false);
    expect(r.json.values).toMatchObject({ kind: 'gradient-fill', gradientType: 'radial', start: [0, 0], end: [200, 0] });
    expect((r.json.warnings as string[]).length).toBe(1);
    expect((r.json.warnings as string[])[0]).toContain('stops');
  });

  it('set-shape-fill rejects a bad colour, opacity or fill rule before sending', async () => {
    await rejected('set-shape-fill', { layer: { index: 1 }, color: 'not-a-colour' });
    await rejected('set-shape-fill', { layer: { index: 1 }, opacity: 120 });
    await rejected('set-shape-fill', { layer: { index: 1 }, fillRule: 'winding' });
  });

  it('set-shape-stroke returns the stroke values and changed fields', async () => {
    const r = await callTool(client, 'set-shape-stroke', { layer: { name: 'Line' }, color: '#ffffff', width: 6, lineCap: 'round', dashes: [20, 12] });
    expect(r.isError).toBe(false);
    expect(r.json.strokePath).toBe('Contents/Group 1/Stroke 1');
    expect(r.json.values).toMatchObject({ width: 6, lineCap: 'round' });
    expect(r.json.changed).toEqual(['color', 'width', 'lineCap', 'dashes']);
  });

  it('set-shape-stroke rejects too many dash entries and a negative width', async () => {
    await rejected('set-shape-stroke', { layer: { index: 1 }, dashes: [1, 2, 3, 4, 5, 6, 7] });
    await rejected('set-shape-stroke', { layer: { index: 1 }, width: -2 });
  });

  it('set-shape-path writes a keyframe when a frame is given', async () => {
    const r = await callTool(client, 'set-shape-path', { layer: { index: 1 }, group: 'Group 1', points: [[-100, -100], [100, -100], [0, 100]], frame: 24, easing: 'ease-in-out' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ vertexCount: 3, closed: true, keyIndex: 1 });
    expect(r.json.keyframe).toMatchObject({ frame: 24 });
    expect((r.json.property as { path: string }).path).toBe('Contents/Group 1/Path 1/Path');
    const stat = await callTool(client, 'set-shape-path', { layer: { index: 1 }, pathProperty: 'Contents/Group 2/Path 1/Path', points: [[0, 0], [10, 10]], closed: false });
    expect(stat.json).toMatchObject({ keyIndex: null, closed: false });
    expect((stat.json.property as { path: string }).path).toBe('Contents/Group 2/Path 1/Path');
  });

  it('set-shape-path rejects fewer than two points before sending', async () => {
    await rejected('set-shape-path', { layer: { index: 1 }, points: [[0, 0]] });
    await rejected('set-shape-path', { layer: { index: 1 } });
  });

  it('add-shape-modifier returns the modifier path at the root or in a group', async () => {
    const root = await callTool(client, 'add-shape-modifier', { layer: { index: 1 }, type: 'round-corners', params: { Radius: 24 } });
    expect(root.isError).toBe(false);
    expect(root.json).toMatchObject({ scope: 'root', type: 'round-corners', modifierPath: 'Contents/Round Corners 1', applied: ['Radius'] });
    expect(root.json.modifier).toMatchObject({ matchName: 'ADBE Vector Filter - RC', kind: 'modifier' });
    const grouped = await callTool(client, 'add-shape-modifier', { layer: { index: 1 }, type: 'zig-zag', group: 'Group 1', params: { Size: 10 } });
    expect(grouped.json).toMatchObject({ scope: 'group', modifierPath: 'Contents/Group 1/Zig Zag 1' });
  });

  it('add-shape-modifier rejects an unknown type before sending', async () => {
    await rejected('add-shape-modifier', { layer: { index: 1 }, type: 'bevel' });
  });

  it('animate-trim-paths defaults to end 0 to 100 and honours durationFrames', async () => {
    const r = await callTool(client, 'animate-trim-paths', { layer: { name: 'Underline' }, durationFrames: 18 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ scope: 'root', created: true, modifierPath: 'Contents/Trim Paths 1', startFrame: 0, endFrame: 18 });
    const keys = r.json.keyframes as Array<{ property: string; keys: Array<{ value: number }> }>;
    expect(keys.length).toBe(1);
    expect(keys[0].property).toBe('Contents/Trim Paths 1/End');
    expect(keys[0].keys.map((k) => k.value)).toEqual([0, 100]);
    const both = await callTool(client, 'animate-trim-paths', { layer: { index: 1 }, group: 'Group 1', start: { from: 0, to: 50 }, end: { from: 0, to: 100 }, startTime: 1, duration: 0.5 });
    expect((both.json.keyframes as unknown[]).length).toBe(2);
    expect(both.json).toMatchObject({ scope: 'group', startTime: 1, endTime: 1.5 });
  });

  it('animate-trim-paths rejects a from/to object missing a field', async () => {
    await rejected('animate-trim-paths', { layer: { index: 1 }, end: { from: 0 } });
    await rejected('animate-trim-paths', { layer: { index: 1 }, duration: 0 });
  });

  it('add-repeater returns the repeater path and changed transform fields', async () => {
    const r = await callTool(client, 'add-repeater', { layer: { name: 'Dot' }, copies: 8, transform: { position: [0, 0], rotation: 45, anchorPoint: [0, 150] }, name: 'Ring' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ scope: 'root', repeaterPath: 'Contents/Repeater 1' });
    expect(r.json.repeater).toMatchObject({ name: 'Ring', matchName: 'ADBE Vector Filter - Repeater' });
    expect(r.json.changed).toEqual(['copies', 'transform.position', 'transform.rotation', 'transform.anchorPoint']);
  });

  it('add-repeater rejects negative copies and a bad composite order', async () => {
    await rejected('add-repeater', { layer: { index: 1 }, copies: -1 });
    await rejected('add-repeater', { layer: { index: 1 }, compositeOrder: 'middle' });
  });

  it('list-shape-groups returns the Contents tree and respects depth', async () => {
    const deep = await callTool(client, 'list-shape-groups', { layer: { name: 'LOGO Outlines' } });
    expect(deep.isError).toBe(false);
    expect(deep.json).toMatchObject({ groupCount: 1, count: 2 });
    const contents = deep.json.contents as Array<{ kind: string; children?: Array<{ kind: string; path: string }> }>;
    expect(contents[0].kind).toBe('group');
    expect(contents[0].children?.map((c) => c.kind)).toEqual(['rect', 'fill', 'stroke', 'transform']);
    expect(contents[1].kind).toBe('modifier');
    const shallow = await callTool(client, 'list-shape-groups', { layer: { index: 1 }, depth: 1 });
    expect((shallow.json.contents as Array<{ children?: unknown[] }>)[0].children).toEqual([]);
    expect(lastCommand()).toBe('listShapeGroups');
  });

  it('list-shape-groups rejects depth 0', async () => {
    await rejected('list-shape-groups', { layer: { index: 1 }, depth: 0 });
  });
});
