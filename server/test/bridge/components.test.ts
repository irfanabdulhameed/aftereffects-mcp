import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { colorHintsFor, findLibraryComponent, keyColorHintsFor, scanLibrary, searchLibrary, splitTemplatePath } from '../../src/tools/components.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];
let lib: string;
let indexedLib: string;
const savedLibraryEnv = process.env.AE_MCP_LIBRARY_DIR;

function write(file: string, text = ''): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A small library: two loose components, one category folder, one broken folder. */
function makeLibrary(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-lib-'));
  write(path.join(root, 'Primary Button', 'Primary Button.aep'), 'aep');
  write(path.join(root, 'Primary Button', 'preview.mp4'), 'mp4');
  write(path.join(root, 'Primary Button', 'poster.png'), 'png');
  write(
    path.join(root, 'Primary Button', 'component.json'),
    JSON.stringify({ name: 'Primary Button', category: 'Buttons', description: 'Rounded call to action', comp: 'Button', controls: [{ label: 'Label', type: 'text' }, { label: 'Fill', type: 'color' }, 'Width'], tags: ['cta', 'primary'] })
  );
  write(path.join(root, 'Lower Thirds', 'Name Strap', 'Name Strap.aep'), 'aep');
  write(path.join(root, 'Lower Thirds', 'Name Strap', 'component.json'), JSON.stringify({ description: 'Name and role', controls: [{ label: 'Name', type: 'text' }, { label: 'Role', type: 'text' }] }));
  write(path.join(root, 'Badge', 'Badge.aep'), 'aep');
  write(path.join(root, 'Broken', 'component.json'), '{ not json');
  write(path.join(root, '_drafts', 'Draft', 'Draft.aep'), 'aep');
  return root;
}

function makeIndexedLibrary(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-lib-index-'));
  write(path.join(root, 'cards', 'card-a', 'card.aep'), 'aep');
  write(path.join(root, 'cards', 'card-a', 'component.json'), JSON.stringify({ description: 'From component.json' }));
  write(
    path.join(root, 'library.json'),
    JSON.stringify({ components: [{ name: 'Feature Card', folder: 'cards/card-a', aep: 'card.aep', category: 'Cards', description: 'From the index', comp: 'Card Main', tags: ['grid'] }] })
  );
  return root;
}

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
  lib = makeLibrary();
  indexedLib = makeIndexedLibrary();
});

afterAll(() => {
  tb.cleanup();
  fs.rmSync(lib, { recursive: true, force: true });
  fs.rmSync(indexedLib, { recursive: true, force: true });
  if (savedLibraryEnv === undefined) delete process.env.AE_MCP_LIBRARY_DIR;
  else process.env.AE_MCP_LIBRARY_DIR = savedLibraryEnv;
});

async function rejected(name: string, args: Record<string, unknown>): Promise<string> {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean; content?: Array<{ text?: string }> };
  expect(res.error !== undefined || res.isError === true).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
  return res.error ?? res.content?.[0]?.text ?? '';
}

function lastCommand(): string {
  return tb.mock.state.log[tb.mock.state.log.length - 1].command;
}

describe('component tools through the MCP server and the mock bridge', () => {
  it('create-component returns the component, the instance, the crop and the Essential Properties', async () => {
    const r = await callTool(client, 'create-component', {
      layers: [{ name: 'BG' }, { name: 'Label' }],
      name: 'Button',
      padding: 0,
      properties: [
        { layer: 'Label', path: 'Text/Source Text', label: 'Label' },
        { layer: 'BG', path: 'Contents/Button/Contents/Fill 1/Color', label: 'Fill' },
        { layer: 2, path: 'Effects/Width/Slider', label: 'Width' },
        { layer: { name: 'BG' }, path: 'Contents/Button/Contents/Path 1/Path', label: 'Outline' },
      ],
    });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('createComponent');
    expect(r.json.component).toMatchObject({ name: 'Button', width: 320, height: 80 });
    expect(r.json.instance).toMatchObject({ name: 'Button', type: 'precomp', transform: { anchorPoint: [160, 40] } });
    expect(r.json.crop).toMatchObject({ applied: true, region: { width: 320, height: 80 } });
    const added = r.json.added as Array<{ label: string; valueType: string }>;
    expect(added.map((a) => a.label)).toEqual(['Label', 'Fill', 'Width']);
    expect(added[0].valueType).toBe('text-document');
    const failed = r.json.failed as Array<{ label: string; reason: string }>;
    expect(failed[0].label).toBe('Outline');
    expect(failed[0].reason).toContain('cannot be an Essential Property');
    expect(r.json.essentialProperties).toEqual(['Label', 'Fill', 'Width']);
  });

  it('create-component defaults to the selection and can skip the crop', async () => {
    const r = await callTool(client, 'create-component', { name: 'Card', cropToContent: false, startAtZero: false, templateName: 'Feature Card' });
    expect(r.isError).toBe(false);
    expect(r.json.crop).toMatchObject({ applied: false });
    expect(r.json.component).toMatchObject({ width: 1920, height: 1080, templateName: 'Feature Card' });
  });

  it('create-component rejects duplicate labels, empty names and bad layer lists before sending', async () => {
    const msg = await rejected('create-component', {
      name: 'Button',
      properties: [
        { layer: 'A', path: 'Opacity', label: 'Fade' },
        { layer: 'B', path: 'Opacity', label: 'fade' },
      ],
    });
    expect(msg).toContain('used twice');
    await rejected('create-component', { name: '' });
    await rejected('create-component', { name: 'X', layers: [] });
    await rejected('create-component', { name: 'X', layers: { selected: false } });
    await rejected('create-component', { name: 'X', properties: [{ layer: 'A' }] });
    await rejected('create-component', { name: 'X', padding: -1 });
  });

  it('add-essential-property returns the label, its position and the full list', async () => {
    const r = await callTool(client, 'add-essential-property', { comp: { name: 'Button' }, layer: { name: 'BG' }, path: 'Effects/Corner/Slider', label: 'Corner' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ label: 'Corner', index: 4 });
    expect(r.json.essentialProperties).toEqual(['Label', 'Fill', 'Width', 'Corner']);
    expect(lastCommand()).toBe('addEssentialProperty');
  });

  it('add-essential-property passes bridge errors through for taken labels and unsupported kinds', async () => {
    const taken = await callTool(client, 'add-essential-property', { comp: { name: 'Button' }, layer: { name: 'BG' }, path: 'Opacity', label: 'Fill' });
    expect(taken.isError).toBe(true);
    expect(taken.text).toContain('already has an Essential Property');
    const shape = await callTool(client, 'add-essential-property', { comp: { name: 'Button' }, layer: { name: 'BG' }, path: 'Contents/Button/Contents/Path 1/Path' });
    expect(shape.isError).toBe(true);
    expect(shape.text).toContain('Supported');
    await rejected('add-essential-property', { comp: { name: 'Button' }, layer: { name: 'BG' } });
    await rejected('add-essential-property', { comp: { name: 'Button' }, layer: { name: 'BG' }, path: 'Opacity', label: '' });
  });

  it('list-essential-properties lists controllers, types and sources for a component or an instance', async () => {
    const forComp = await callTool(client, 'list-essential-properties', { comp: { name: 'Button' } });
    expect(forComp.isError).toBe(false);
    expect(forComp.json.count).toBe(3);
    expect(forComp.json.controllers).toEqual([{ index: 1, name: 'Label' }, { index: 2, name: 'Fill' }, { index: 3, name: 'Width' }]);
    expect((forComp.json.instances as unknown[]).length).toBe(1);
    const forInstance = await callTool(client, 'list-essential-properties', { comp: { name: 'Main Comp' }, layer: { name: 'Button 2' } });
    const props = forInstance.json.properties as Array<{ label: string; valueType: string; source: { path: string } }>;
    expect(forInstance.json.instance).toMatchObject({ name: 'Button 2' });
    expect(props.map((p) => p.valueType)).toEqual(['text-document', 'color', '1d']);
    expect(props[2].source.path).toBe('Effects/Width/Slider');
    expect(lastCommand()).toBe('listEssentialProperties');
  });

  it('set-component-values sends colour hints so colour names work, and returns values read back', async () => {
    const r = await callTool(client, 'set-component-values', { layer: { name: 'Button 2' }, values: { Label: 'Sign up', Fill: 'white', Width: 280 } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('setComponentValues');
    const results = r.json.results as Array<{ label: string; status: string; value: unknown }>;
    expect(results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok']);
    expect(results[0].value).toMatchObject({ text: 'Sign up' });
    expect(results[1].value).toEqual([1, 1, 1, 1]);
    expect(results[2].value).toBe(280);
    expect(r.json.failed).toBe(0);
  });

  it('set-component-values writes keyframes sorted by time, with holds for booleans and text', async () => {
    const r = await callTool(client, 'set-component-values', {
      layer: { name: 'Button 2' },
      keyframes: [
        { label: 'Width', frame: 30, value: 360, easing: 'ease-out' },
        { label: 'Width', frame: 0, value: 280 },
        { label: 'Fill', time: 1, value: '#2F6BFF' },
        { label: 'Label', frame: 15, value: 'Done' },
      ],
    });
    expect(r.isError).toBe(false);
    const keys = r.json.keyframes as Array<{ label: string; numKeys: number; keys: Array<{ frame: number; value: unknown; outInterpolation: string }> }>;
    const width = keys.find((k) => k.label === 'Width');
    expect(width?.keys.map((k) => k.frame)).toEqual([0, 30]);
    const fill = keys.find((k) => k.label === 'Fill');
    const fillValue = fill?.keys[0].value as number[];
    expect(fillValue[0]).toBeCloseTo(47 / 255, 3);
    expect(fillValue[1]).toBeCloseTo(107 / 255, 3);
    expect(fillValue[2]).toBe(1);
    expect(fillValue[3]).toBe(1);
    const label = keys.find((k) => k.label === 'Label');
    expect(label?.keys[0].outInterpolation).toBe('hold');
  });

  it('set-component-values fails on unknown labels with the label list, and rejects empty calls before sending', async () => {
    const r = await callTool(client, 'set-component-values', { layer: { name: 'Button 2' }, values: { Colour: '#ff0000' } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Unknown Essential Property label');
    expect(r.text).toContain('Label, Fill, Width');
    const msg = await rejected('set-component-values', { layer: { name: 'Button 2' } });
    expect(msg).toContain('Pass values, keyframes or both');
    await rejected('set-component-values', { layer: { name: 'Button 2' }, values: {} });
    await rejected('set-component-values', { layer: { name: 'Button 2' }, keyframes: [{ label: 'Width', value: 10 }] });
    await rejected('set-component-values', { layer: { name: 'Button 2' }, values: { Width: [1, 2, 3, 4, 5] } });
    await rejected('set-component-values', { values: { Width: 10 } });
  });

  it('add-component-instances places three buttons with different labels in one call', async () => {
    const r = await callTool(client, 'add-component-instances', {
      comp: { name: 'Main Comp' },
      component: { name: 'Button' },
      instances: [
        { position: [560, 540], values: { Label: 'Back' } },
        { position: [960, 540], values: { Label: 'Skip' }, startFrame: 6 },
        { position: [1360, 540], values: { Label: 'Next', Fill: 'blue' }, name: 'Next Button', durationFrames: 90 },
      ],
    });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('addComponentInstances');
    expect(r.json).toMatchObject({ count: 3, failed: 0 });
    const results = r.json.results as Array<{ layer: { name: string; inFrame: number; outFrame: number; transform: { position: number[] } }; values: Array<{ label: string; value: unknown }> }>;
    expect(results.map((x) => x.layer.transform.position[0])).toEqual([560, 960, 1360]);
    expect(results[1].layer.inFrame).toBe(6);
    expect(results[2].layer.name).toBe('Next Button');
    expect(results[2].layer.outFrame).toBe(90);
    expect(results[2].values.find((v) => v.label === 'Fill')?.value).toEqual([0, 0, 1, 1]);
  });

  it('add-component-instances supports count, and rejects bad input before sending', async () => {
    const r = await callTool(client, 'add-component-instances', { component: { id: 20 }, count: 2 });
    expect(r.json.count).toBe(2);
    await rejected('add-component-instances', { component: {} });
    await rejected('add-component-instances', { component: { name: 'Button' }, count: 3, instances: [{}] });
    await rejected('add-component-instances', { component: { name: 'Button' }, count: 0 });
    await rejected('add-component-instances', { component: { name: 'Button' }, instances: [] });
    await rejected('add-component-instances', { component: { name: 'Button' }, instances: [{ position: [1] }] });
    const unknown = await callTool(client, 'add-component-instances', { component: { name: 'Button' }, instances: [{ values: { Title: 'x' } }] });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('Nothing was added');
  });

  it('set-responsive-time writes protected intro and outro markers', async () => {
    const r = await callTool(client, 'set-responsive-time', { comp: { name: 'Lower Third' }, introFrames: 18, outroFrames: 12 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('setResponsiveTime');
    expect(r.json).toMatchObject({ introFrames: 18, outroFrames: 12, stretchable: { startFrame: 18, endFrame: 288 } });
    const markers = r.json.markers as Array<{ comment: string; protectedRegion: boolean; frame: number; duration: number }>;
    expect(markers.map((m) => m.comment)).toEqual(['Intro', 'Outro']);
    expect(markers.every((m) => m.protectedRegion)).toBe(true);
    expect(markers[1].frame).toBe(288);
    const regions = await callTool(client, 'set-responsive-time', { comp: { name: 'Lower Third' }, intro: 0.5, regions: [{ start: 4, duration: 1, comment: 'Hold' }] });
    expect((regions.json.markers as Array<{ comment: string }>).map((m) => m.comment)).toEqual(['Intro', 'Hold']);
  });

  it('set-responsive-time rejects calls without any region before sending', async () => {
    const msg = await rejected('set-responsive-time', { comp: { name: 'Lower Third' } });
    expect(msg).toContain('Give intro, outro');
    await rejected('set-responsive-time', { introFrames: -2 });
    await rejected('set-responsive-time', { regions: [{ start: 1 }] });
  });

  it('export-component-template splits a .mogrt path into folder and template name', async () => {
    const r = await callTool(client, 'export-component-template', { comp: { name: 'Button' }, path: '/tmp/components/Primary.mogrt', overwrite: true });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('exportComponentTemplate');
    expect(r.json).toMatchObject({ templateName: 'Primary', file: '/tmp/components/Primary.mogrt', exists: true, overwrite: true, projectSaved: true });
    const folder = await callTool(client, 'export-component-template', { comp: { name: 'Button' }, path: '/tmp/components', templateName: 'Ghost' });
    expect(folder.json).toMatchObject({ file: '/tmp/components/Ghost.mogrt' });
    const msg = await rejected('export-component-template', { comp: { name: 'Button' }, path: 'relative/folder' });
    expect(msg).toContain('absolute');
  });

  it('list-library-components reads folders, category folders and component.json', async () => {
    const r = await callTool(client, 'list-library-components', { folder: lib });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ folder: lib, index: null, total: 3, matched: 3 });
    const comps = r.json.components as Array<{ name: string; category: string | null; comp: string; preview: string | null; poster: string | null; controls: Array<{ label: string; type: string | null }> }>;
    expect(comps.map((c) => c.name)).toEqual(['Badge', 'Primary Button', 'Name Strap']);
    const button = comps.find((c) => c.name === 'Primary Button');
    expect(button).toMatchObject({ category: 'Buttons', comp: 'Button' });
    expect(button?.preview).toBe(path.join(lib, 'Primary Button', 'preview.mp4'));
    expect(button?.poster).toBe(path.join(lib, 'Primary Button', 'poster.png'));
    expect(button?.controls).toEqual([{ label: 'Label', type: 'text' }, { label: 'Fill', type: 'color' }, { label: 'Width', type: null }]);
    expect(comps.find((c) => c.name === 'Name Strap')?.category).toBe('Lower Thirds');
    const skipped = r.json.skipped as Array<{ path: string; reason: string }>;
    expect(skipped.some((s) => s.path.endsWith('Broken') && s.reason.includes('not valid JSON'))).toBe(true);
  });

  it('list-library-components filters by category and search words and uses AE_MCP_LIBRARY_DIR', async () => {
    process.env.AE_MCP_LIBRARY_DIR = lib;
    const before = tb.mock.state.commandsRun;
    const byCat = await callTool(client, 'list-library-components', { category: 'buttons' });
    expect((byCat.json.components as Array<{ name: string }>).map((c) => c.name)).toEqual(['Primary Button']);
    const byQuery = await callTool(client, 'list-library-components', { query: 'role name' });
    expect((byQuery.json.components as Array<{ name: string }>).map((c) => c.name)).toEqual(['Name Strap']);
    const none = await callTool(client, 'list-library-components', { query: 'spinner' });
    expect(none.json.matched).toBe(0);
    const limited = await callTool(client, 'list-library-components', { limit: 1 });
    expect(limited.json).toMatchObject({ truncated: true });
    expect(byCat.json.categories).toEqual([
      { name: null, count: 1 },
      { name: 'Buttons', count: 1 },
      { name: 'Lower Thirds', count: 1 },
    ]);
    expect(tb.mock.state.commandsRun).toBe(before);
  });

  it('list-library-components reads a library.json index, with component.json winning', async () => {
    const r = await callTool(client, 'list-library-components', { folder: indexedLib });
    expect(r.json.index).toBe(path.join(indexedLib, 'library.json'));
    const comps = r.json.components as Array<{ name: string; description: string; category: string; comp: string; aep: string; source: string; tags: string[] }>;
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ name: 'Feature Card', description: 'From component.json', category: 'Cards', comp: 'Card Main', source: 'index', tags: ['grid'] });
    expect(comps[0].aep).toBe(path.join(indexedLib, 'cards', 'card-a', 'card.aep'));
  });

  it('list-library-components explains a missing library folder', async () => {
    delete process.env.AE_MCP_LIBRARY_DIR;
    const r = await callTool(client, 'list-library-components', {});
    expect(r.isError).toBe(true);
    expect(r.text).toContain('AE_MCP_LIBRARY_DIR');
    const missing = await callTool(client, 'list-library-components', { folder: path.join(lib, 'nope') });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('not found');
  });

  it('insert-library-component resolves the .aep and main comp on the server and returns the instance', async () => {
    const r = await callTool(client, 'insert-library-component', { folder: lib, component: 'primary button', position: [960, 800], values: { Label: 'Start free trial', Fill: 'black' } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('insertLibraryComponent');
    expect(r.json.library).toMatchObject({ aep: path.join(lib, 'Primary Button', 'Primary Button.aep'), componentName: 'Primary Button', reused: true });
    expect(r.json.component).toMatchObject({ name: 'Button' });
    expect(r.json.instance).toMatchObject({ name: 'Button', transform: { position: [960, 800] } });
    const values = r.json.values as Array<{ label: string; value: unknown }>;
    expect(values.find((v) => v.label === 'Fill')?.value).toEqual([0, 0, 0, 1]);
    expect(r.json.libraryEntry).toMatchObject({ name: 'Primary Button', category: 'Buttons' });
  });

  it('insert-library-component accepts a direct .aep and lists names for an unknown component', async () => {
    const direct = await callTool(client, 'insert-library-component', { component: 'Badge', aep: path.join(lib, 'Badge', 'Badge.aep'), reuseImported: false });
    expect(direct.isError).toBe(false);
    expect(direct.json.library).toMatchObject({ imported: true });
    expect(direct.json.libraryEntry).toBeNull();
    const msg = await rejected('insert-library-component', { folder: lib, component: 'Spinner' });
    expect(msg).toContain('Components: Badge, Primary Button, Name Strap');
    await rejected('insert-library-component', { component: 'Badge', aep: path.join(lib, 'missing.aep') });
  });

  it('insert-library-component works inside batch with the library resolved before sending', async () => {
    const r = await callTool(client, 'batch', {
      steps: [{ tool: 'insert-library-component', args: { folder: lib, component: 'Badge', values: { Label: 'New' } } }],
    });
    expect(r.isError).toBe(false);
    const rows = r.json.results as Array<{ status: string; result: { library: { aep: string } } }>;
    expect(rows[0].status).toBe('ok');
    expect(rows[0].result.library.aep).toBe(path.join(lib, 'Badge', 'Badge.aep'));
  });
});

describe('component helpers', () => {
  it('splitTemplatePath handles .mogrt files, folders and relative paths', () => {
    expect(splitTemplatePath('/tmp/out/Lower Third.mogrt')).toEqual({ folder: '/tmp/out', templateName: 'Lower Third', file: '/tmp/out/Lower Third.mogrt' });
    expect(splitTemplatePath('/tmp/out/x.mogrt', 'Named')).toMatchObject({ folder: '/tmp/out', templateName: 'Named', file: '/tmp/out/Named.mogrt' });
    expect(splitTemplatePath('/tmp/out')).toEqual({ folder: '/tmp/out', templateName: undefined, file: null });
    expect(splitTemplatePath('~/mogrt').folder).toBe(path.join(os.homedir(), 'mogrt'));
    expect(() => splitTemplatePath('out/x.mogrt')).toThrow(/absolute/);
  });

  it('colour hints cover hex, names and objects but not numbers, booleans or arrays', () => {
    expect(colorHintsFor({ Fill: '#ff0000', Label: 'Hello', Stroke: 'white', Glow: { r: 0, g: 128, b: 255 }, Width: 10, On: true, Pos: [1, 2] })).toEqual({
      Fill: [1, 0, 0, 1],
      Stroke: [1, 1, 1, 1],
      Glow: [0, 128 / 255, 1, 1],
    });
    expect(colorHintsFor({ Width: 3 })).toBeUndefined();
    expect(keyColorHintsFor([{ value: 3 }, { value: 'black' }])).toEqual([null, [0, 0, 0, 1]]);
    expect(keyColorHintsFor([{ value: 3 }])).toBeUndefined();
  });

  it('library search matches every word across name, tags and control labels', () => {
    const scan = scanLibrary(lib);
    expect(searchLibrary(scan.components, { query: 'cta width' }).map((c) => c.name)).toEqual(['Primary Button']);
    expect(searchLibrary(scan.components, { category: 'LOWER THIRDS' }).map((c) => c.name)).toEqual(['Name Strap']);
    expect(findLibraryComponent(scan, 'Name Strap').aep).toBe(path.join(lib, 'Lower Thirds', 'Name Strap', 'Name Strap.aep'));
    expect(() => findLibraryComponent(scan, 'Draft')).toThrow(/No component "Draft"/);
  });
});
