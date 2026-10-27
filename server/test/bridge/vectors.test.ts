import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RiffChunk, writeRifx } from '../../src/tools/gradient-preset.js';
import { catalog } from '../../src/tools/registry.js';
import { svgPathToAe } from '../../src/tools/svg-path.js';
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

function fakeTemplate(): Buffer {
  const xml = "<?xml version='1.0'?>\n<prop.map version='4'><prop.list><prop.pair><key>Gradient Color Data</key></prop.pair><prop.pair><key>Gradient Colors</key><string>1.0</string></prop.pair></prop.list></prop.map>\n";
  const utf: RiffChunk = { id: 'Utf8', data: Buffer.concat([Buffer.from(xml, 'utf8'), Buffer.from([0])]) };
  return writeRifx({ id: 'RIFX', listType: 'FaFX', children: [{ id: 'head', data: Buffer.alloc(8) }, { id: 'LIST', listType: 'GCst', children: [utf] }] });
}

describe('vector tools: registration', () => {
  it('registers three tools in group shapes with template descriptions of 60 to 200 words', () => {
    const tools = catalog.filter((c) => ['import-vector-as-shapes', 'set-shape-gradient', 'shape-from-svg-path'].includes(c.name));
    expect(tools.length).toBe(3);
    for (const t of tools) {
      expect(t.group).toBe('shapes');
      const words = t.description.split(/\s+/).length;
      expect(words, t.name).toBeGreaterThanOrEqual(60);
      expect(words, t.name).toBeLessThanOrEqual(200);
      const labels = ['Use when:', 'Do not use for:', 'Inputs:', 'Returns:', 'Notes:', 'Example:'].map((l) => t.description.indexOf(l));
      expect(labels.every((v, i) => v > 0 && (i === 0 || v > labels[i - 1])), t.name).toBe(true);
    }
  });
});

describe('import-vector-as-shapes', () => {
  // POSIX paths in the expectations.
  it.skipIf(process.platform === 'win32')('converts an .ai file and returns the shape layer with its groups', async () => {
    const r = await callTool(client, 'import-vector-as-shapes', { path: '/art/logo.ai', removeSource: true, position: [400, 300] });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ route: 'create-shapes', file: '/art/logo.ai', sourceRemoved: true });
    const layers = r.json.shapeLayers as Array<{ layer: { name: string; position: number[] }; groups: string[]; groupCount: number }>;
    expect(layers[0].layer.name).toBe('logo.ai Outlines');
    expect(layers[0].layer.position).toEqual([400, 300]);
    expect(layers[0].groupCount).toBe(layers[0].groups.length);
  });

  it('SVG in composition mode copies the layers of the SVG composition', async () => {
    const r = await callTool(client, 'import-vector-as-shapes', { path: '/art/icon.SVG', mode: 'composition' });
    expect(r.json).toMatchObject({ route: 'svg-composition', sourceLayer: null });
    expect((r.json.shapeLayers as unknown[]).length).toBe(2);
  });

  it('rejects raster files and unknown modes before sending', async () => {
    await rejected('import-vector-as-shapes', { path: '/art/logo.png' });
    await rejected('import-vector-as-shapes', { path: '/art/logo' });
    await rejected('import-vector-as-shapes', { path: '/art/logo.svg', mode: 'raster' });
  });
});

describe('set-shape-gradient', () => {
  const stops = [
    { offset: 0, color: '#6A5CFF' },
    { offset: 1, color: '#00C2FF', opacity: 80 },
  ];

  it('without a template: type and points are set, stops fail with unsupported and say how to make the template', async () => {
    const r = await callTool(client, 'set-shape-gradient', { layer: { name: 'Card' }, type: 'linear', start: [-200, 0], end: [200, 0], stops, allowClipboard: true });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ bridgeError: { code: 'unsupported' } });
    expect(String(r.json.message)).toContain('gradient-fill.ffx');
    expect(String(r.json.message)).toContain('stopsOptional');
  });

  it('never uses the clipboard route unless allowClipboard is true', async () => {
    const r = await callTool(client, 'set-shape-gradient', { layer: { name: 'Card' }, stops, stopsOptional: true });
    expect(r.json.stops).toMatchObject({ requested: 2, applied: false });
    expect(String((r.json.stops as { reason: string }).reason)).toContain('allowClipboard');
  });

  it('stopsOptional turns the missing stops into a reported reason', async () => {
    const r = await callTool(client, 'set-shape-gradient', { layer: { name: 'Card' }, stops, stopsOptional: true, target: 'stroke', width: 6, allowClipboard: true });
    expect(r.isError).toBe(false);
    expect(r.json.stops).toMatchObject({ requested: 2, applied: false, route: null });
    expect(String((r.json.stops as { reason: string }).reason)).toContain('gradient-stroke.ffx');
    expect(r.json.values).toMatchObject({ width: 6 });
  });

  it('with a template in <bridge>/templates the server writes a preset holding the stops', async () => {
    fs.mkdirSync(path.join(tb.dir, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(tb.dir, 'templates', 'gradient-fill.ffx'), fakeTemplate());
    const r = await callTool(client, 'set-shape-gradient', { layer: { name: 'Card' }, group: 'Card', type: 'radial', stops, allowClipboard: true });
    expect(r.isError).toBe(false);
    expect(r.json.stops).toMatchObject({ requested: 2, applied: true, route: 'preset' });
    const presets = fs.readdirSync(path.join(tb.dir, 'tmp')).filter((n) => n.startsWith('gradient-fill-'));
    expect(presets.length).toBe(1);
    const text = fs.readFileSync(path.join(tb.dir, 'tmp', presets[0])).toString('utf8');
    expect(text).toContain('<float>0.41568628</float>');
    expect(text).toContain('<float>0.80000001</float>');
  });

  it('templateFolder points at another folder', async () => {
    const folder = path.join(tb.dir, 'other-templates');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'gradient-stroke.ffx'), fakeTemplate());
    const r = await callTool(client, 'set-shape-gradient', { layer: { index: 1 }, target: 'stroke', stops, templateFolder: folder, allowClipboard: true });
    expect(r.json.stops).toMatchObject({ applied: true });
  });

  it('without stops it only sets the gradient', async () => {
    const r = await callTool(client, 'set-shape-gradient', { layer: { index: 1 }, type: 'linear', start: [0, 0], end: [100, 0] });
    expect(r.json.stops).toMatchObject({ requested: 0, applied: false });
    expect(r.json.values).toMatchObject({ type: 'linear', start: [0, 0], end: [100, 0] });
  });

  it('rejects one stop, offsets outside 0 to 1, bad colours and bad types before sending', async () => {
    await rejected('set-shape-gradient', { layer: { index: 1 }, stops: [{ offset: 0, color: '#fff' }] });
    await rejected('set-shape-gradient', { layer: { index: 1 }, stops: [{ offset: 0, color: '#fff' }, { offset: 1.5, color: '#000' }] });
    await rejected('set-shape-gradient', { layer: { index: 1 }, stops: [{ offset: 0, color: 'not-a-colour' }, { offset: 1, color: '#000' }] });
    await rejected('set-shape-gradient', { layer: { index: 1 }, type: 'conic' });
    await rejected('set-shape-gradient', { layer: { index: 1 }, target: 'both' });
  });
});

describe('shape-from-svg-path', () => {
  it('parses on the server and sends AE paths, bounds and placement', async () => {
    const d = 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z';
    const r = await callTool(client, 'shape-from-svg-path', { d, viewBox: [0, 0, 24, 24], size: [240, 240], fillColor: '#FFFFFF', name: 'Plus' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ mode: 'new-layer', pathCount: 1, vertexCount: 12, bounds: { left: -70, top: -70, width: 140, height: 140 } });
    expect(r.json.placement).toMatchObject({ scale: [10, 10], origin: [12, 12] });
    expect(r.json.fillPath).toBe('Contents/SVG Path/Contents/Fill 1');
    expect(r.json.strokePath).toBeNull();
    expect(r.json.vertexCount).toBe(svgPathToAe(d).vertexCount);
  });

  it('multiple subpaths become multiple paths; replace mode needs a layer', async () => {
    const r = await callTool(client, 'shape-from-svg-path', { d: 'M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16', layer: { name: 'Icon' }, group: 'Ring', strokeColor: '#fff', strokeWidth: 2, noFill: true });
    expect(r.json).toMatchObject({ mode: 'replace', pathCount: 2, fillPath: null, strokePath: 'Contents/Ring/Contents/Stroke 1' });
    expect((r.json.pathPaths as string[]).length).toBe(2);
    await rejected('shape-from-svg-path', { d: 'M0 0 L10 10', group: 'Ring' });
  });

  it('rejects invalid path data before sending', async () => {
    await rejected('shape-from-svg-path', { d: 'L10 10' });
    await rejected('shape-from-svg-path', { d: 'M0 0 Q 5' });
    await rejected('shape-from-svg-path', { d: 'M0 0 M5 5' });
    await rejected('shape-from-svg-path', { d: 'M0 0 L1 1', viewBox: [0, 0, 0, 24] });
  });
});

/* ------------------------------------------------------------------------
 * vectors.jsx in a Node vm against a small fake model of shape layers.
 * The fake Paste puts the copied item above the selected one in its group,
 * which is the After Effects behaviour the gradient route relies on.
 * ---------------------------------------------------------------------- */

const SCRIPTS = path.resolve(__dirname, '..', '..', 'src', 'scripts');
const PT = { PROPERTY: 6212, NAMED_GROUP: 6213, INDEXED_GROUP: 6214 };
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BASE_NAMES: Record<string, string> = {
  'ADBE Vector Group': 'Group',
  'ADBE Vector Shape - Group': 'Path',
  'ADBE Vector Shape - Rect': 'Rectangle Path',
  'ADBE Vector Graphic - Fill': 'Fill',
  'ADBE Vector Graphic - G-Fill': 'Gradient Fill',
  'ADBE Vector Graphic - Stroke': 'Stroke',
  'ADBE Vector Graphic - G-Stroke': 'Gradient Stroke',
};

interface World {
  ctx: vm.Context & Any;
  colorsTouched: boolean;
  selected: Set<Any>;
  clipboard: string | null;
}

function leaf(name: string, matchName: string, value: unknown): Any {
  return { name, matchName, propertyType: PT.PROPERTY, value, numKeys: 0, setValue(v: unknown) { this.value = v; }, valueAtTime() { return this.value; } };
}

function attach(world: World, item: Any, parent: Any): Any {
  item.parentProperty = parent;
  Object.defineProperty(item, 'propertyDepth', { configurable: true, get: () => (parent.propertyDepth ?? 0) + 1 });
  Object.defineProperty(item, 'selected', {
    configurable: true,
    get: () => world.selected.has(item),
    set: (v: boolean) => (v ? world.selected.add(item) : world.selected.delete(item)),
  });
  return item;
}

function namedGroup(world: World, name: string, matchName: string, children: Any[]): Any {
  const g: Any = { name, matchName, propertyType: PT.NAMED_GROUP, enabled: true };
  g.property = (x: number | string) => (typeof x === 'number' ? children[x - 1] : children.find((c) => c.matchName === x || c.name === x)) ?? null;
  Object.defineProperty(g, 'numProperties', { get: () => children.length });
  children.forEach((c) => attach(world, c, g));
  return g;
}

/** An indexed group (Contents) whose children support addProperty, remove and moveTo. */
function indexedGroup(world: World, name: string, matchName: string): Any {
  const children: Any[] = [];
  const g: Any = { name, matchName, propertyType: PT.INDEXED_GROUP, children };
  Object.defineProperty(g, 'numProperties', { get: () => children.length });
  g.property = (x: number | string) => (typeof x === 'number' ? children[x - 1] : children.find((c) => c.matchName === x || c.name === x)) ?? null;
  g.canAddProperty = () => true;
  g.addProperty = (mn: string) => {
    const item = makeItem(world, mn);
    const base = BASE_NAMES[mn] ?? mn;
    let n = 1;
    while (children.some((c) => c.name === `${base} ${n}`)) n++;
    item.name = `${base} ${n}`;
    g.insert(item, children.length);
    return item;
  };
  g.insert = (item: Any, at: number) => {
    children.splice(at, 0, item);
    attach(world, item, g);
    Object.defineProperty(item, 'propertyIndex', { configurable: true, get: () => children.indexOf(item) + 1 });
    item.remove = () => {
      children.splice(children.indexOf(item), 1);
      world.selected.delete(item);
    };
    item.moveTo = (n: number) => {
      children.splice(children.indexOf(item), 1);
      children.splice(n - 1, 0, item);
    };
  };
  return g;
}

function makeItem(world: World, mn: string): Any {
  if (mn === 'ADBE Vector Group') {
    const contents = indexedGroup(world, 'Contents', 'ADBE Vectors Group');
    const g = namedGroup(world, 'Group', mn, [contents, namedGroup(world, 'Transform', 'ADBE Vector Transform Group', [])]);
    g.contents = contents;
    return g;
  }
  if (mn === 'ADBE Vector Shape - Group') return namedGroup(world, 'Path', mn, [leaf('Path', 'ADBE Vector Shape', null)]);
  if (mn === 'ADBE Vector Shape - Rect') return namedGroup(world, 'Rectangle Path', mn, [leaf('Size', 'ADBE Vector Rect Size', [200, 100]), leaf('Position', 'ADBE Vector Rect Position', [0, 0]), leaf('Roundness', 'ADBE Vector Rect Roundness', 0)]);
  if (mn === 'ADBE Vector Graphic - Fill') return namedGroup(world, 'Fill', mn, [leaf('Color', 'ADBE Vector Fill Color', [1, 0, 0, 1]), leaf('Opacity', 'ADBE Vector Fill Opacity', 70), leaf('Fill Rule', 'ADBE Vector Fill Rule', 2)]);
  if (mn === 'ADBE Vector Graphic - Stroke') return namedGroup(world, 'Stroke', mn, [leaf('Color', 'ADBE Vector Stroke Color', [1, 1, 1, 1]), leaf('Opacity', 'ADBE Vector Stroke Opacity', 100), leaf('Stroke Width', 'ADBE Vector Stroke Width', 8), leaf('Line Cap', 'ADBE Vector Stroke Line Cap', 2), leaf('Line Join', 'ADBE Vector Stroke Line Join', 2)]);
  if (mn === 'ADBE Vector Graphic - G-Fill' || mn === 'ADBE Vector Graphic - G-Stroke') {
    const colors: Any = { name: 'Colors', matchName: 'ADBE Vector Grad Colors' };
    for (const key of ['propertyType', 'value', 'numKeys', 'setValue', 'expression', 'canSetExpression']) {
      Object.defineProperty(colors, key, { get() { world.colorsTouched = true; throw new Error('modal dialog'); } });
    }
    const kids = [leaf('Type', 'ADBE Vector Grad Type', 1), leaf('Start Point', 'ADBE Vector Grad Start Pt', [0, 0]), leaf('End Point', 'ADBE Vector Grad End Pt', [100, 0]), leaf('Highlight Length', 'ADBE Vector Grad HiLite Length', 0), leaf('Highlight Angle', 'ADBE Vector Grad HiLite Angle', 0), colors];
    if (mn.endsWith('G-Fill')) kids.push(leaf('Opacity', 'ADBE Vector Fill Opacity', 100), leaf('Fill Rule', 'ADBE Vector Fill Rule', 1));
    else kids.push(leaf('Opacity', 'ADBE Vector Stroke Opacity', 100), leaf('Stroke Width', 'ADBE Vector Stroke Width', 2), leaf('Line Cap', 'ADBE Vector Stroke Line Cap', 1), leaf('Line Join', 'ADBE Vector Stroke Line Join', 1));
    const g = namedGroup(world, BASE_NAMES[mn], mn, kids);
    g.tag = 'from-' + (world.clipboard ? 'paste' : 'add');
    return g;
  }
  throw new Error('fake has no item ' + mn);
}

function makeWorld(): World {
  const world = { colorsTouched: false, selected: new Set<Any>(), clipboard: null } as unknown as World;
  const ctx = {
    MCP_BRIDGE_VERSION: 'test',
    PropertyType: PT,
    KeyframeInterpolationType: { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 },
    Folder: { myDocuments: { fsName: '/tmp' } },
    console,
  } as unknown as vm.Context & Any;
  vm.createContext(ctx);
  vm.runInContext(
    [
      'function CompItem() {}', 'function FolderItem() {}', 'function FootageItem() {}', 'function SolidSource() {}', 'function PlaceholderSource() {}',
      'function AVLayer() {}', 'function TextLayer() {}', 'function ShapeLayer() {}', 'ShapeLayer.prototype = new AVLayer();', 'function CameraLayer() {}', 'function LightLayer() {}',
      'function Shape() { this.vertices = []; this.inTangents = []; this.outTangents = []; this.closed = true; }',
      'function File(p) { this.fsName = p; this.exists = __exists(p); this.removed = false; }',
      'File.prototype.remove = function () { this.removed = true; __removed(this.fsName); return true; };',
    ].join('\n'),
    ctx
  );
  ctx.__exists = (p: string) => fs.existsSync(p);
  ctx.__removed = () => undefined;
  world.ctx = ctx;
  for (const f of ['polyfills.jsx', 'json.jsx', 'core.jsx', 'color.jsx', 'undo.jsx', 'resolve.jsx', 'serialize.jsx', 'easing.jsx']) {
    vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'lib', f), 'utf8'), ctx, { filename: f });
  }
  for (const f of ['masks.jsx', 'shapes.jsx', 'vectors.jsx']) vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'commands', f), 'utf8'), ctx, { filename: f });

  const layers: Any[] = [];
  const comp = vm.runInContext('new CompItem()', ctx) as Any;
  Object.assign(comp, { id: 1, name: 'Main', width: 1920, height: 1080, frameDuration: 1 / 30, duration: 10, time: 0, openInViewer: () => null });
  Object.defineProperty(comp, 'numLayers', { get: () => layers.length });
  comp.layer = (i: number) => layers[i - 1];
  const newShapeLayer = (name: string): Any => {
    const L = vm.runInContext('new ShapeLayer()', ctx) as Any;
    const contents = indexedGroup(world, 'Contents', 'ADBE Root Vectors Group');
    const transform = namedGroup(world, 'Transform', 'ADBE Transform Group', [leaf('Anchor Point', 'ADBE Anchor Point', [0, 0]), leaf('Position', 'ADBE Position', [960, 540])]);
    Object.assign(L, { name, propertyDepth: 0, containingComp: comp, inPoint: 0, outPoint: 10, enabled: true });
    L.property = (x: string | number) => (x === 'ADBE Root Vectors Group' || x === 1 ? contents : x === 'ADBE Transform Group' || x === 2 ? transform : null);
    L.numProperties = 2;
    attach(world, contents, L);
    attach(world, transform, L);
    Object.defineProperty(L, 'index', { get: () => layers.indexOf(L) + 1 });
    L.id = 900 + layers.length;
    L.contents = contents;
    L.remove = () => layers.splice(layers.indexOf(L), 1);
    L.applyPreset = () => {
      // The template: a group holding one rectangle and one gradient fill or stroke.
      const g = contents.addProperty('ADBE Vector Group');
      g.contents.addProperty('ADBE Vector Shape - Rect');
      g.contents.addProperty(world.ctx.__presetKind === 'stroke' ? 'ADBE Vector Graphic - G-Stroke' : 'ADBE Vector Graphic - G-Fill');
    };
    Object.defineProperty(L, 'selected', { configurable: true, get: () => world.selected.has(L), set: (v: boolean) => (v ? world.selected.add(L) : world.selected.delete(L)) });
    layers.unshift(L);
    return L;
  };
  comp.layers = { addShape: () => newShapeLayer('Shape Layer') };
  comp.newShapeLayer = newShapeLayer;
  ctx.app = {
    version: '26.5.0',
    project: { activeItem: comp, numItems: 1, item: () => comp },
    findMenuCommandId: (n: string) => ({ Copy: 19, Paste: 20 })[n] ?? 0,
    executeCommand: (id: number) => {
      const props = [...world.selected].filter((p) => p.matchName && p.propertyType !== undefined && p.parentProperty);
      if (id === 19) {
        const src = props.find((p) => /G-(Fill|Stroke)$/.test(p.matchName));
        world.clipboard = src ? src.matchName : null;
      } else if (id === 20 && world.clipboard) {
        const anchor = props.find((p) => p.parentProperty && p.parentProperty.insert);
        if (!anchor) return;
        const item = makeItem(world, world.clipboard);
        item.name = BASE_NAMES[world.clipboard] + ' 1';
        anchor.parentProperty.insert(item, anchor.propertyIndex - 1);
      }
    },
  };
  return world;
}

function names(group: Any): string[] {
  return group.contents.children.map((c: Any) => c.name);
}

describe('vectors.jsx in a vm', () => {
  it('shapeFromSvgPath builds a new layer: paths first, then fill, then stroke', () => {
    const w = makeWorld();
    const parsed = svgPathToAe('M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16', { viewBox: [0, 0, 16, 16], size: [160, 160] });
    const r = JSON.parse(JSON.stringify(w.ctx.MCP.commands.shapeFromSvgPath({ paths: parsed.paths, bounds: parsed.bounds, fillColor: '#ffffff', strokeColor: '#000000', strokeWidth: 3, fillRule: 'even-odd', position: [100, 200], name: 'Ring' })));
    expect(r).toMatchObject({ mode: 'new-layer', pathCount: 2, vertexCount: parsed.vertexCount, groupPath: 'Contents/SVG Path' });
    const layer = w.ctx.app.project.activeItem.layer(1);
    const group = layer.contents.children[0];
    expect(names(group)).toEqual(['Path 1', 'Path 2', 'Fill 1', 'Stroke 1']);
    expect(group.contents.children[2].property('ADBE Vector Fill Rule').value).toBe(2);
    expect(group.contents.children[3].property('ADBE Vector Stroke Width').value).toBe(3);
    expect(layer.property('ADBE Transform Group').property('ADBE Position').value).toEqual([100, 200]);
    expect(group.contents.children[0].property('ADBE Vector Shape').value.vertices.length).toBe(5);
  });

  it('shapeFromSvgPath replace mode swaps only the paths and keeps them above the fill', () => {
    const w = makeWorld();
    const layer = w.ctx.app.project.activeItem.newShapeLayer('Icon');
    const g = layer.contents.addProperty('ADBE Vector Group');
    g.name = 'Ring';
    g.contents.addProperty('ADBE Vector Shape - Rect');
    g.contents.addProperty('ADBE Vector Graphic - Fill');
    const parsed = svgPathToAe('M0 0 H10 V10 Z M20 0 H30 V10 Z');
    const r = JSON.parse(JSON.stringify(w.ctx.MCP.commands.shapeFromSvgPath({ layer: { name: 'Icon' }, group: 'Ring', paths: parsed.paths })));
    expect(r).toMatchObject({ mode: 'replace', removedPaths: 1, pathCount: 2, fillPath: 'Contents/Ring/Contents/Fill 1' });
    expect(names(g)).toEqual(['Path 1', 'Path 2', 'Fill 1']);
  });

  it('setShapeGradient without stops adds a gradient fill below the paths, replaces the solid, carries opacity and fill rule, and spans the bounds', () => {
    const w = makeWorld();
    const layer = w.ctx.app.project.activeItem.newShapeLayer('Card');
    const g = layer.contents.addProperty('ADBE Vector Group');
    g.contents.addProperty('ADBE Vector Shape - Rect');
    g.contents.addProperty('ADBE Vector Graphic - Fill');
    const r = JSON.parse(JSON.stringify(w.ctx.MCP.commands.setShapeGradient({ layer: { name: 'Card' } })));
    expect(names(g)).toEqual(['Rectangle Path 1', 'Gradient Fill 1']);
    expect(r).toMatchObject({ target: 'fill', created: true, gradientPath: 'Contents/Group 1/Contents/Gradient Fill 1', values: { type: 'linear', start: [-100, 0], end: [100, 0], opacity: 70 } });
    expect(r.changed).toContain('removedSolidFill');
    expect(g.contents.children[1].property('ADBE Vector Fill Rule').value).toBe(2);
    expect(w.colorsTouched).toBe(false);
  });

  it('setShapeGradient fails with unsupported after setting type and points when stops have no preset', () => {
    const w = makeWorld();
    const layer = w.ctx.app.project.activeItem.newShapeLayer('Card');
    const g = layer.contents.addProperty('ADBE Vector Group');
    g.contents.addProperty('ADBE Vector Shape - Rect');
    let err: Any = null;
    try {
      w.ctx.MCP.commands.setShapeGradient({ layer: { name: 'Card' }, type: 'radial', stops: [{}, {}], stopsUnavailable: 'No template.' });
    } catch (e) {
      err = e;
    }
    expect(err?.mcpCode).toBe('unsupported');
    expect(String(err.message)).toContain('No template.');
    expect(g.contents.children[1].property('ADBE Vector Grad Type').value).toBe(2);
    expect(err.mcpDetails.values.start).toEqual([0, 0]);
    const ok = JSON.parse(JSON.stringify(w.ctx.MCP.commands.setShapeGradient({ layer: { name: 'Card' }, stops: [{}, {}], stopsOptional: true })));
    expect(ok.stops).toMatchObject({ requested: 2, applied: false });
    expect(w.colorsTouched).toBe(false);
  });

  it('setShapeGradient with a preset pastes the gradient into the group, replaces the old one and keeps its points', () => {
    const w = makeWorld();
    const presetPath = path.join(tb.dir, 'vm-preset.ffx');
    fs.writeFileSync(presetPath, 'preset');
    const comp = w.ctx.app.project.activeItem;
    const layer = comp.newShapeLayer('Card');
    const g = layer.contents.addProperty('ADBE Vector Group');
    g.contents.addProperty('ADBE Vector Shape - Rect');
    const old = g.contents.addProperty('ADBE Vector Graphic - G-Fill');
    old.property('ADBE Vector Grad Start Pt').value = [-50, 5];
    old.property('ADBE Vector Grad End Pt').value = [50, 5];
    old.property('ADBE Vector Grad Type').value = 2;
    g.contents.addProperty('ADBE Vector Graphic - Stroke');
    const other = comp.newShapeLayer('Other');
    other.selected = true;
    const r = JSON.parse(JSON.stringify(w.ctx.MCP.commands.setShapeGradient({ layer: { name: 'Card' }, stops: [{}, {}], presetPath })));
    expect(r.stops).toMatchObject({ applied: true, route: 'preset' });
    expect(r.changed).toEqual(expect.arrayContaining(['stops', 'replacedGradient']));
    expect(names(g)).toEqual(['Rectangle Path 1', 'Gradient Fill 1', 'Stroke 1']);
    const pasted = g.contents.children[1];
    expect(pasted).not.toBe(old);
    expect(pasted.tag).toBe('from-paste');
    expect(pasted.property('ADBE Vector Grad Start Pt').value).toEqual([-50, 5]);
    expect(pasted.property('ADBE Vector Grad Type').value).toBe(2);
    // The scratch layer is gone, the selection is back, the temporary preset was removed.
    expect(comp.numLayers).toBe(2);
    expect(other.selected).toBe(true);
    expect(layer.selected).toBe(false);
    expect(w.colorsTouched).toBe(false);
  });

  it('a failed paste leaves the old gradient with its name and removes the scratch layer', () => {
    const w = makeWorld();
    const presetPath = path.join(tb.dir, 'vm-preset-2.ffx');
    fs.writeFileSync(presetPath, 'preset');
    const comp = w.ctx.app.project.activeItem;
    const layer = comp.newShapeLayer('Card');
    const g = layer.contents.addProperty('ADBE Vector Group');
    g.contents.addProperty('ADBE Vector Shape - Rect');
    const old = g.contents.addProperty('ADBE Vector Graphic - G-Fill');
    old.name = 'Brand Gradient';
    w.ctx.app.executeCommand = () => undefined;
    const r = JSON.parse(JSON.stringify(w.ctx.MCP.commands.setShapeGradient({ layer: { name: 'Card' }, stops: [{}, {}], presetPath, stopsOptional: true })));
    expect(r.stops).toMatchObject({ applied: false });
    expect(String(r.stops.reason)).toMatch(/Paste did not add/);
    expect(names(g)).toEqual(['Rectangle Path 1', 'Brand Gradient']);
    expect(comp.numLayers).toBe(1);
  });

  it('a paste that lands at the top of Contents is removed again', () => {
    const w = makeWorld();
    const presetPath = path.join(tb.dir, 'vm-preset-3.ffx');
    fs.writeFileSync(presetPath, 'preset');
    const comp = w.ctx.app.project.activeItem;
    const layer = comp.newShapeLayer('Card');
    const g = layer.contents.addProperty('ADBE Vector Group');
    g.contents.addProperty('ADBE Vector Shape - Rect');
    g.contents.addProperty('ADBE Vector Graphic - Fill');
    const original = w.ctx.app.executeCommand;
    w.ctx.app.executeCommand = (id: number) => {
      if (id !== 20) return original(id);
      const item = makeItem(w, 'ADBE Vector Graphic - G-Fill');
      item.name = 'Gradient Fill 1';
      layer.contents.insert(item, 0);
    };
    const r = JSON.parse(JSON.stringify(w.ctx.MCP.commands.setShapeGradient({ layer: { name: 'Card' }, stops: [{}, {}], presetPath, stopsOptional: true, replaceSolid: false })));
    expect(String(r.stops.reason)).toMatch(/Paste did not add/);
    expect(layer.contents.children.map((c: Any) => c.name)).toEqual(['Group 1']);
    expect(names(g)).toEqual(['Rectangle Path 1', 'Fill 1', 'Gradient Fill 1']);
    expect(w.colorsTouched).toBe(false);
  });
});
