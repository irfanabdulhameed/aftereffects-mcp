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

describe('project tools', () => {
  it('get-project-info and list-project-items still work', async () => {
    const info = await callTool(client, 'get-project-info', {});
    expect(info.isError).toBe(false);
    expect(info.json).toMatchObject({ projectName: 'mock.aep', itemCounts: { compositions: 1 } });
    const items = await callTool(client, 'list-project-items', { type: 'footage' });
    expect(items.json).toMatchObject({ type: 'footage', count: 1 });
  });

  it('save-project saves to the current file', async () => {
    const r = await callTool(client, 'save-project', {});
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ path: '/mock/mock.aep', saved: true, existed: true });
    expect(lastCommand().command).toBe('saveProject');
  });

  it('save-project-as appends .aep and refuses to overwrite without the flag', async () => {
    const ok = await callTool(client, 'save-project-as', { path: '/mock/out/promo_v02' });
    expect(ok.isError).toBe(false);
    expect(ok.json).toMatchObject({ path: '/mock/out/promo_v02.aep', projectName: 'promo_v02.aep', saved: true, existed: false });

    const clash = await callTool(client, 'save-project-as', { path: '/mock/existing.aep' });
    expect(clash.isError).toBe(true);
    expect(clash.text).toContain('overwrite');

    const forced = await callTool(client, 'save-project-as', { path: '/mock/existing.aep', overwrite: true });
    expect(forced.isError).toBe(false);
    expect(forced.json).toMatchObject({ existed: true });
  });

  it('save-project-as rejects an empty path before sending', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'save-project-as', { path: '' });
    expect(r.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('new-project needs confirm on the Node side and discardChanges for a dirty project', async () => {
    const before = tb.mock.state.commandsRun;
    const noConfirm = await callTool(client, 'new-project', { confirm: false });
    expect(noConfirm.isError).toBe(true);
    expect(noConfirm.json).toMatchObject({ error: 'confirmation-required' });
    expect(tb.mock.state.commandsRun).toBe(before);

    const dirty = await callTool(client, 'new-project', { confirm: true });
    expect(dirty.isError).toBe(true);
    expect(dirty.text).toContain('discardChanges');

    const ok = await callTool(client, 'new-project', { confirm: true, discardChanges: true });
    expect(ok.isError).toBe(false);
    expect(ok.json).toMatchObject({ projectName: 'Untitled Project', path: null, numItems: 0, discarded: true });
  });

  it('open-project fails on a missing file and returns a summary otherwise', async () => {
    const missing = await callTool(client, 'open-project', { path: 'relative/nope.aep', discardChanges: true });
    expect(missing.isError).toBe(true);
    expect(missing.json).toMatchObject({ bridgeError: { code: 'not-found' } });

    const ok = await callTool(client, 'open-project', { path: '/mock/other.aep', discardChanges: true });
    expect(ok.isError).toBe(false);
    expect(ok.json).toMatchObject({ projectName: 'other.aep', path: '/mock/other.aep', numItems: 4 });
    expect(Array.isArray(ok.json.compositions)).toBe(true);
    expect(ok.json.activeComp).toMatchObject({ id: 1 });
  });

  it('create-folder returns the folder item, inside a parent when given', async () => {
    const root = await callTool(client, 'create-folder', { name: 'Assets' });
    expect(root.isError).toBe(false);
    expect(root.json.item).toMatchObject({ name: 'Assets', type: 'folder', parentFolder: null, numItems: 0 });
    const nested = await callTool(client, 'create-folder', { name: 'Stills', parent: { name: 'Footage' } });
    expect(nested.json.item).toMatchObject({ name: 'Stills', parentFolder: 'Footage', parentFolderId: 3 });
  });

  it('move-item-to-folder moves into a folder or to the root and needs one of them', async () => {
    const into = await callTool(client, 'move-item-to-folder', { item: { id: 5 }, folder: { name: 'Footage' } });
    expect(into.isError).toBe(false);
    expect(into.json.item).toMatchObject({ id: 5, parentFolder: 'Footage', parentFolderId: 3 });
    const toRoot = await callTool(client, 'move-item-to-folder', { item: { name: 'clip.mov' }, root: true });
    expect(toRoot.json.item).toMatchObject({ parentFolder: null, parentFolderId: null });
    expect(toRoot.json.previousFolder).toMatchObject({ id: 3, name: 'Footage' });
    const neither = await callTool(client, 'move-item-to-folder', { item: { id: 5 } });
    expect(neither.isError).toBe(true);
  });

  it('rename-item returns the new and previous names', async () => {
    const r = await callTool(client, 'rename-item', { item: { id: 2 }, newName: 'Hero Clip' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ item: { id: 2, name: 'Hero Clip' }, previousName: 'clip.mov' });
    const before = tb.mock.state.commandsRun;
    const bad = await callTool(client, 'rename-item', { item: { id: 2 }, newName: '' });
    expect(bad.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('delete-item refuses used items without force and lists the usage', async () => {
    const refused = await callTool(client, 'delete-item', { item: { name: 'clip.mov' } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('force');
    expect(refused.json).toMatchObject({ bridgeError: { code: 'invalid-argument' } });
    expect(refused.text).toContain('Main Comp');

    const forced = await callTool(client, 'delete-item', { item: { name: 'clip.mov' }, force: true });
    expect(forced.isError).toBe(false);
    expect(forced.json).toMatchObject({ removed: { id: 2, name: 'clip.mov', type: 'footage' }, usedInCount: 1, forced: true });

    const unused = await callTool(client, 'delete-item', { item: { id: 5 } });
    expect(unused.isError).toBe(false);
    expect(unused.json).toMatchObject({ removed: { id: 5 }, usedInCount: 0, forced: false });

    const comp = await callTool(client, 'delete-item', { item: { id: 1 } });
    expect(comp.isError).toBe(true);
    expect(comp.text).toContain('layer');
  });

  it('import-file returns the item summary and honours options', async () => {
    const clip = await callTool(client, 'import-file', { path: '/mock/media/new.mov', folder: { name: 'Footage' } });
    expect(clip.isError).toBe(false);
    expect(clip.json).toMatchObject({ importedAs: 'footage', isSequence: false, path: '/mock/media/new.mov' });
    expect(clip.json.item).toMatchObject({ type: 'footage', name: 'new.mov', file: '/mock/media/new.mov', parentFolder: 'Footage', hasVideo: true });

    const psd = await callTool(client, 'import-file', { path: '/mock/media/logo.psd', importAs: 'comp-retain-layer-sizes' });
    expect(psd.json).toMatchObject({ importedAs: 'comp-retain-layer-sizes' });
    expect(psd.json.item).toMatchObject({ type: 'comp', name: 'logo.psd' });

    const aep = await callTool(client, 'import-file', { path: '/mock/other.aep' });
    expect(aep.json.item).toMatchObject({ type: 'folder', name: 'other.aep' });

    const audio = await callTool(client, 'import-file', { path: '/mock/media/music.wav', name: 'Music' });
    expect(audio.json.item).toMatchObject({ name: 'Music', hasAudio: true, hasVideo: false });

    const seq = await callTool(client, 'import-file', { path: '/mock/media/frame_0001.png', sequence: true, forceAlphabetical: true });
    expect(seq.json).toMatchObject({ isSequence: true });

    const missing = await callTool(client, 'import-file', { path: 'nope.mov' });
    expect(missing.isError).toBe(true);
    expect(missing.json).toMatchObject({ bridgeError: { code: 'not-found' } });

    const wrongType = await callTool(client, 'import-file', { path: '/mock/media/new.mov', importAs: 'comp' });
    expect(wrongType.isError).toBe(true);
    expect(wrongType.json).toMatchObject({ bridgeError: { code: 'unsupported' } });
  });

  it('import-file rejects an unknown importAs before sending', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'import-file', { path: '/mock/media/logo.psd', importAs: 'layers' });
    expect(r.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('import-files-bulk reports per-file results and continueOnError', async () => {
    const r = await callTool(client, 'import-files-bulk', { paths: ['/mock/media/a.mov', 'bad.mov', '/mock/media/c.png'], folder: { id: 3 } });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ count: 3, imported: 2, failed: 1, skipped: 0 });
    const rows = r.json.results as Array<Record<string, unknown>>;
    expect(rows.map((x) => x.status)).toEqual(['ok', 'error', 'ok']);
    expect(rows[0].item).toMatchObject({ name: 'a.mov', parentFolderId: 3 });
    expect(rows[1].error).toMatchObject({ code: 'not-found' });

    const stop = await callTool(client, 'import-files-bulk', { paths: ['bad.mov', '/mock/media/c.png'], continueOnError: false });
    expect(stop.json).toMatchObject({ count: 2, imported: 0, failed: 1, skipped: 1 });
    const stopRows = stop.json.results as Array<Record<string, unknown>>;
    expect(stopRows[1].status).toBe('skipped');

    const before = tb.mock.state.commandsRun;
    const empty = await callTool(client, 'import-files-bulk', { paths: [] });
    expect(empty.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('replace-footage returns the item with the new file and previousFile', async () => {
    const r = await callTool(client, 'replace-footage', { item: { id: 2 }, path: '/mock/media/final.mov' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ item: { id: 2, file: '/mock/media/final.mov' }, previousFile: '/mock/media/clip.mov', isSequence: false });
    const notFootage = await callTool(client, 'replace-footage', { item: { id: 1 }, path: '/mock/media/final.mov' });
    expect(notFootage.isError).toBe(true);
    const seq = await callTool(client, 'replace-footage', { item: { id: 2 }, path: '/mock/media/f_0001.png', sequence: true });
    expect(seq.json).toMatchObject({ isSequence: true });
  });

  it('reduce-project needs confirm on the Node side and returns the count removed', async () => {
    const before = tb.mock.state.commandsRun;
    const no = await callTool(client, 'reduce-project', { comps: [{ name: 'Main Comp' }], confirm: false });
    expect(no.isError).toBe(true);
    expect(no.json).toMatchObject({ error: 'confirmation-required' });
    expect(tb.mock.state.commandsRun).toBe(before);

    const emptyList = await callTool(client, 'reduce-project', { comps: [], confirm: true });
    expect(emptyList.isError).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);

    const ok = await callTool(client, 'reduce-project', { comps: [{ name: 'Main Comp' }], confirm: true });
    expect(ok.isError).toBe(false);
    expect(ok.json).toMatchObject({ removed: 2, kept: [{ name: 'Main Comp' }], numItems: 2 });
    expect(lastCommand().command).toBe('reduceProject');
  });

  it('remove-unused-footage returns the count', async () => {
    const r = await callTool(client, 'remove-unused-footage', {});
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ removed: 1, numItems: 3 });
  });

  it('collect-files is unsupported unless dryRun, which lists referenced files', async () => {
    const no = await callTool(client, 'collect-files', {});
    expect(no.isError).toBe(true);
    expect(no.json).toMatchObject({ bridgeError: { code: 'unsupported' } });
    expect(no.text).toContain('dryRun');

    const dry = await callTool(client, 'collect-files', { dryRun: true });
    expect(dry.isError).toBe(false);
    expect(dry.json).toMatchObject({ supported: false, count: 2, missing: ['/mock/media/unused.png'] });
    const files = dry.json.files as Array<Record<string, unknown>>;
    expect(files[0]).toMatchObject({ id: 2, path: '/mock/media/clip.mov', exists: true, usedIn: 1 });
    expect(files[1]).toMatchObject({ exists: false, isSequence: false });
  });
});
