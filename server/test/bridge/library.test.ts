// The component library on disk: save-to-library writes a part, library.json and the README table; online-only parts download before an insert.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { callTool, makeTestBridge, makeTestServer, type TestBridge } from '../helpers.js';
import { ensureLocal, ensureLocalSync, isLocalFile } from '../../src/tools/cloud-files.js';
import { readLibraryIndex, readLibraryIndexSync, scanLibrary } from '../../src/tools/components.js';
import { partsTable, safeName } from '../../src/tools/library.js';

let tb: TestBridge;
let client: any;
let root: string;
const g = globalThis as { __mockProjectFile?: string | null; __mockProjectDirty?: boolean };

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
  root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-library-')), 'Library');
});

afterAll(() => {
  tb.cleanup();
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
  delete g.__mockProjectFile;
  delete g.__mockProjectDirty;
});

const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

describe('save-to-library', () => {
  it('saves a part with its poster, library.json entry and README row', async () => {
    const r = await callTool(client, 'save-to-library', { folder: root, comp: { name: 'Send Button' }, category: 'Buttons', description: 'Round send button with a press state', tags: ['chat'], source: 'Launch film' });
    expect(r.isError, r.text).toBe(false);
    const dir = path.join(root, 'Buttons', 'Send Button');
    expect(fs.existsSync(path.join(dir, 'Send Button.aep'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'poster.png'))).toBe(true);
    expect(tb.mock.state.lastCommand).toBe('saveLibraryComponent');
    const index = readJson(path.join(root, 'library.json'));
    expect(index.components).toHaveLength(1);
    expect(index.components[0]).toMatchObject({ name: 'Send Button', category: 'Buttons', folder: 'Buttons/Send Button', aep: 'Send Button.aep', poster: 'poster.png', fonts: ['Inter-Medium'], footage: ['footage/avatar.png'], source: { project: 'components-test.aep', comp: 'Send Button', note: 'Launch film' } });
    expect(index.components[0].controls.length).toBeGreaterThan(0);
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(readme).toContain('Keep `README.md` and `library.json` always on this device');
    expect(readme).toContain('| [Send Button](Buttons/Send%20Button/) | Buttons | Round send button with a press state |');
    expect((r.json as any).reopened).toBe(true);
  });

  it('refuses to replace a part without overwrite, and keeps the added date and text outside the markers when it does', async () => {
    const indexFile = path.join(root, 'library.json');
    const added = readJson(indexFile).components[0].added;
    const exists = await callTool(client, 'save-to-library', { folder: root, comp: { name: 'Send Button' }, category: 'Buttons', description: 'Again' });
    expect(exists.isError).toBe(true);
    expect(exists.text).toMatch(/already has Buttons\/Send Button/);
    const readmeFile = path.join(root, 'README.md');
    fs.writeFileSync(readmeFile, fs.readFileSync(readmeFile, 'utf8').replace('# Component library', '# Component library\n\nNotes by hand.'));
    const inode = fs.statSync(indexFile).ino;
    await new Promise((res) => setTimeout(res, 5));
    const again = await callTool(client, 'save-to-library', { folder: root, comp: { name: 'Send Button' }, category: 'Buttons', description: 'Send button, second take', overwrite: true });
    expect(again.isError, again.text).toBe(false);
    const entry = readJson(indexFile).components[0];
    expect(entry.description).toBe('Send button, second take');
    expect(entry.added).toBe(added);
    expect(fs.statSync(indexFile).ino).toBe(inode);
    expect(fs.readFileSync(readmeFile, 'utf8')).toContain('Notes by hand.');
  });

  it('refuses an untitled or unsaved project before touching the library', async () => {
    g.__mockProjectFile = null;
    const untitled = await callTool(client, 'save-to-library', { folder: root, comp: { name: 'Card' }, category: 'Cards', description: 'A card' });
    expect(untitled.isError).toBe(true);
    expect(untitled.text).toMatch(/Save the project first/);
    g.__mockProjectFile = '/tmp/components-test.aep';
    g.__mockProjectDirty = true;
    const dirty = await callTool(client, 'save-to-library', { folder: root, comp: { name: 'Card' }, category: 'Cards', description: 'A card' });
    expect(dirty.isError).toBe(true);
    expect(dirty.text).toMatch(/unsaved changes/);
    expect(fs.existsSync(path.join(root, 'Cards'))).toBe(false);
    const saved = await callTool(client, 'save-to-library', { folder: root, comp: { name: 'Card' }, category: 'Cards', description: 'A card', saveFirst: true });
    expect(saved.isError, saved.text).toBe(false);
    g.__mockProjectDirty = false;
    const list = await callTool(client, 'list-library-components', { folder: root });
    expect((list.json as any).components.map((c: { name: string }) => c.name)).toEqual(['Send Button', 'Card']);
  });

  it('insert-library-component reports what it downloaded', async () => {
    const r = await callTool(client, 'insert-library-component', { folder: root, component: 'Send Button' });
    expect(r.isError, r.text).toBe(false);
    expect((r.json as any).download).toMatchObject({ downloaded: [] });
  });
});

describe('remove-from-library', () => {
  it('deletes the part folder, its entry and its README row', async () => {
    const r = await callTool(client, 'remove-from-library', { folder: root, component: 'card' });
    expect(r.isError, r.text).toBe(false);
    expect(fs.existsSync(path.join(root, 'Cards'))).toBe(false);
    const index = readJson(path.join(root, 'library.json'));
    expect(index.components.map((c: { name: string }) => c.name)).toEqual(['Send Button']);
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).not.toContain('[Card]');
    const missing = await callTool(client, 'remove-from-library', { folder: root, component: 'Card' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/No part \\?"Card\\?".*Send Button/);
  });
});

describe('online-only files', () => {
  it.skipIf(process.platform === 'win32')('treats a file with no blocks on disk as online-only and reads it through', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-cloud-'));
    const sparse = path.join(dir, 'part.aep');
    const fd = fs.openSync(sparse, 'w');
    fs.ftruncateSync(fd, 3 << 20);
    fs.closeSync(fd);
    const solid = path.join(dir, 'solid.aep');
    fs.writeFileSync(solid, Buffer.alloc(4096, 1));
    expect(isLocalFile(solid)).toBe(true);
    expect(isLocalFile(path.join(dir, 'missing.aep'))).toBeNull();
    if (isLocalFile(sparse) === false) {
      const report = await ensureLocal([sparse, solid]);
      expect(report.downloaded).toEqual([sparse]);
      expect(report.bytes).toBe(3 << 20);
      expect(ensureLocalSync([sparse]).bytes).toBe(3 << 20);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('lists an online-only library.json from the server copy, and says so when there is none', async () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-cloud-lib-'));
    fs.mkdirSync(path.join(lib, 'Cards', 'Card'), { recursive: true });
    fs.writeFileSync(path.join(lib, 'Cards', 'Card', 'Card.aep'), 'aep');
    const text = JSON.stringify({ components: [{ name: 'Card', folder: 'Cards/Card', category: 'Cards', description: 'A card' }] });
    fs.writeFileSync(path.join(lib, 'library.json'), text);
    expect((await readLibraryIndex(lib)).source).toBe('file');
    fs.rmSync(path.join(lib, 'library.json'));
    const fd = fs.openSync(path.join(lib, 'library.json'), 'w');
    fs.ftruncateSync(fd, text.length);
    fs.closeSync(fd);
    if (isLocalFile(path.join(lib, 'library.json')) === false) {
      const read = readLibraryIndexSync(lib);
      expect(read).toMatchObject({ source: 'cache', text });
      expect(read.note).toMatch(/online-only.*Always Keep on This Device/);
      const scan = scanLibrary(lib);
      expect(scan.indexSource).toBe('cache');
      expect(scan.components.map((c) => c.description)).toEqual(['A card']);
      fs.rmSync(path.join(tb.dir, 'library-cache'), { recursive: true, force: true });
      const none = scanLibrary(lib);
      expect(none.indexSource).toBe('none');
      expect(none.skipped[0].reason).toMatch(/no earlier copy/);
      expect(none.components.map((c) => c.name)).toEqual(['Card']);
    }
    fs.rmSync(lib, { recursive: true, force: true });
  });

  it('safe names and the parts table', () => {
    expect(safeName(' Card / Feature: "Big" ')).toBe('Card - Feature- -Big-');
    expect(safeName('...')).toBe('Part');
    expect(partsTable([])).toBe('_No parts yet._');
    const table = partsTable([{ name: 'Toggle', category: 'Controls', description: 'On | off', folder: 'Controls/Toggle', controls: [{ label: 'On' }], width: 120, height: 64, duration: 2, frameRate: 60 }]);
    expect(table).toContain('| [Toggle](Controls/Toggle/) | Controls | On \\| off | On | 120×64 · 2 s · 60 fps |');
  });
});
