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

describe('workflow tools', () => {
  it('snapshot-composition returns layers with transform trees, keyframes, effects and text', async () => {
    const r = await callTool(client, 'snapshot-composition', { comp: { name: 'Main Comp' }, depth: 3 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ snapshotVersion: 1, layerCount: 2, truncated: false });
    expect(r.json.options).toMatchObject({ depth: 3, keyframes: true, effects: true, shapes: false });
    const layers = r.json.layers as Array<{ layer: { name: string }; transform: { isGroup: boolean; children: Array<{ name: string; keyframes?: unknown[]; expression?: string }> }; effects: Array<{ matchName: string }>; text?: { sourceText: { value: { text: string } } } }>;
    expect(layers[0].layer.name).toBe('Title');
    expect(layers[0].transform.isGroup).toBe(true);
    expect(layers[0].transform.children[0].keyframes?.length).toBe(2);
    expect(layers[0].transform.children[1].expression).toBe('wiggle(2, 10)');
    expect(layers[0].effects[0].matchName).toBe('ADBE Gaussian Blur 2');
    expect(layers[0].text?.sourceText.value.text).toBe('Hello');
    const capped = await callTool(client, 'snapshot-composition', { maxLayers: 1 });
    expect(capped.json.truncated).toBe(true);
    expect((capped.json.layers as unknown[]).length).toBe(1);
    await rejectedBeforeSend('snapshot-composition', { depth: 20 });
  });

  it('apply-snapshot round-trips a snapshot and reports skipped layers', async () => {
    const snap = await callTool(client, 'snapshot-composition', {});
    const snapshot = snap.json as Record<string, unknown>;
    (snapshot.layers as unknown[]).push({ layer: { index: 9, name: 'Missing' }, transform: null, effects: [] });
    const r = await callTool(client, 'apply-snapshot', { snapshot, matchBy: 'name', what: { text: true } });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ matchBy: 'name', layersApplied: 2, layersSkipped: 1 });
    expect(r.json.what).toMatchObject({ transform: true, effects: true, keyframes: true, expressions: true, text: true });
    const results = r.json.results as Array<{ status: string; layer: { name: string }; effectsAdded: string[] }>;
    expect(results[0]).toMatchObject({ status: 'ok', layer: { name: 'Title' } });
    expect(results[0].effectsAdded).toEqual(['Gaussian Blur']);
    const skipped = r.json.skipped as Array<{ name: string; reason: string }>;
    expect(skipped[0].name).toBe('Missing');
    expect(skipped[0].reason).toContain('name');
    expect(r.json.notRestored).toContain('masks');
    const noFx = await callTool(client, 'apply-snapshot', { snapshot, what: { effects: false } });
    expect((noFx.json.results as Array<{ effectsAdded: string[] }>)[0].effectsAdded).toEqual([]);
    await rejectedBeforeSend('apply-snapshot', { snapshot: 'not an object' });
    await rejectedBeforeSend('apply-snapshot', { snapshot, matchBy: 'id' });
  });

  it('find-layers combines filters and caps results', async () => {
    const all = await callTool(client, 'find-layers', {});
    expect(all.isError).toBe(false);
    expect(all.json.count).toBe(3);
    const byName = await callTool(client, 'find-layers', { namePattern: '/^ti/i', type: 'text' });
    expect(byName.json.count).toBe(1);
    expect((byName.json.layers as Array<{ layer: { name: string } }>)[0].layer.name).toBe('Title');
    const fx = await callTool(client, 'find-layers', { scope: 'project', hasEffect: 'ADBE Gaussian Blur 2', enabled: true });
    expect(fx.json).toMatchObject({ scope: 'project', compositionsScanned: 2, count: 1 });
    const expr = await callTool(client, 'find-layers', { expressionContains: 'wiggle' });
    expect(expr.json.count).toBe(1);
    expect((expr.json.layers as Array<{ matchedExpressions: Array<{ expression: string }> }>)[0].matchedExpressions[0].expression).toContain('wiggle');
    const limited = await callTool(client, 'find-layers', { limit: 2 });
    expect(limited.json).toMatchObject({ count: 2, truncated: true });
    await rejectedBeforeSend('find-layers', { scope: 'folder' });
    await rejectedBeforeSend('find-layers', { limit: 5000 });
  });

  it('find-and-replace-text reports before/after and honours dryRun, wholeWord and case', async () => {
    const dry = await callTool(client, 'find-and-replace-text', { find: 'acme', replace: 'Acme Corp', dryRun: true });
    expect(dry.isError).toBe(false);
    expect(dry.json).toMatchObject({ dryRun: true, matchedLayers: 1, changedLayers: 0, totalMatches: 2 });
    const change = (dry.json.layers as Array<{ changes: Array<{ before: string; after: string }> }>)[0].changes[0];
    expect(change.before).toBe('Hello Acme, hello acme');
    expect(change.after).toBe('Hello Acme Corp, hello Acme Corp');
    const cs = await callTool(client, 'find-and-replace-text', { find: 'acme', replace: 'X', caseSensitive: true });
    expect(cs.json).toMatchObject({ changedLayers: 1, totalMatches: 1 });
    const whole = await callTool(client, 'find-and-replace-text', { find: 'acm', replace: 'X', wholeWord: true });
    expect(whole.json).toMatchObject({ matchedLayers: 0, totalMatches: 0 });
    await rejectedBeforeSend('find-and-replace-text', { find: '' });
    await rejectedBeforeSend('find-and-replace-text', { replace: 'x' });
  });

  it('replace-color normalises colours and lists per-property changes', async () => {
    const r = await callTool(client, 'replace-color', { from: 'red', to: [30, 144, 255], tolerance: 0.05, dryRun: true });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ from: '#ff0000', to: '#1e90ff', tolerance: 0.05, dryRun: true, changedCount: 2 });
    const changes = r.json.changes as Array<{ target: string; before: string; after: string }>;
    expect(changes.map((c) => c.target)).toEqual(['shape-fill', 'text-fill']);
    expect(changes[0]).toMatchObject({ before: '#ff0000', after: '#1e90ff' });
    const withFx = await callTool(client, 'replace-color', { from: '#ff0000', to: '#1e90ff', includeEffects: true });
    expect(withFx.json.changedCount).toBe(3);
    await rejectedBeforeSend('replace-color', { from: '#ff0000' });
    await rejectedBeforeSend('replace-color', { from: 'notacolour', to: '#000000' });
    await rejectedBeforeSend('replace-color', { from: '#ff0000', to: '#000000', tolerance: 2 });
  });

  it('relink-fonts changes fonts, supports dryRun and surfaces unsupported "missing"', async () => {
    const r = await callTool(client, 'relink-fonts', { scope: 'project', fromFont: 'ArialMT', toFont: 'Inter-Regular' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ scope: 'project', fromFont: 'ArialMT', toFont: 'Inter-Regular', matchedLayers: 1, changedCount: 1, warnings: [] });
    expect((r.json.changes as Array<{ before: string; after: string }>)[0]).toMatchObject({ before: 'ArialMT', after: 'Inter-Regular' });
    const dry = await callTool(client, 'relink-fonts', { fromFont: '*', toFont: 'Inter-Regular', dryRun: true });
    expect(dry.json).toMatchObject({ dryRun: true, changedCount: 0, matchedLayers: 1 });
    const missing = await callTool(client, 'relink-fonts', { fromFont: 'missing', toFont: 'Inter-Regular' });
    expect(missing.isError).toBe(true);
    expect(missing.json).toMatchObject({ tool: 'relink-fonts', error: 'command-failed' });
    expect((missing.json.bridgeError as { code: string }).code).toBe('unsupported');
    await rejectedBeforeSend('relink-fonts', { fromFont: 'ArialMT' });
    await rejectedBeforeSend('relink-fonts', { fromFont: '', toFont: 'X' });
  });
});
