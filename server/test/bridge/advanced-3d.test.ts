import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RENDERER_MATCH_NAMES } from '../../src/tools/advanced-3d.js';
import { catalog } from '../../src/tools/registry.js';
import { resetAdvanced3dMock } from '../bridge-mock/responses/advanced-3d.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());
beforeEach(() => resetAdvanced3dMock());

async function rejected(name: string, args: Record<string, unknown>): Promise<void> {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

describe('advanced 3D tools: registration', () => {
  it('registers three tools in group camera-3d with template descriptions of 60 to 200 words', () => {
    const tools = catalog.filter((c) => ['set-composition-renderer', 'set-extrusion', 'add-environment-light'].includes(c.name));
    expect(tools.length).toBe(3);
    for (const t of tools) {
      expect(t.group).toBe('camera-3d');
      const words = t.description.split(/\s+/).length;
      expect(words, t.name).toBeGreaterThanOrEqual(60);
      expect(words, t.name).toBeLessThanOrEqual(200);
      const labels = ['Use when:', 'Do not use for:', 'Inputs:', 'Returns:', 'Notes:', 'Example:'].map((l) => t.description.indexOf(l));
      expect(labels.every((v, i) => v > 0 && (i === 0 || v > labels[i - 1])), t.name).toBe(true);
    }
  });

  it('maps renderer names to the exact match names (Classic 3D is ADBE Advanced 3d)', () => {
    expect(RENDERER_MATCH_NAMES).toEqual({ 'classic-3d': 'ADBE Advanced 3d', 'advanced-3d': 'ADBE Calder', 'cinema-4d': 'ADBE Ernst' });
  });
});

describe('set-composition-renderer', () => {
  it('without a renderer only lists what is available', async () => {
    const r = await callTool(client, 'set-composition-renderer', {});
    expect(r.json).toMatchObject({ listOnly: true, changed: false, renderer: { key: 'classic-3d' } });
    expect((r.json.available as Array<{ matchName: string }>).map((a) => a.matchName)).toEqual(['ADBE Advanced 3d', 'ADBE Calder', 'ADBE Ernst']);
  });

  it('switches to Advanced 3D and warns about layer styles', async () => {
    const r = await callTool(client, 'set-composition-renderer', { renderer: 'advanced-3d' });
    expect(r.json).toMatchObject({ changed: true, previous: { name: 'Classic 3D' }, renderer: { matchName: 'ADBE Calder', name: 'Advanced 3D' } });
    expect((r.json.warnings as string[])[0]).toMatch(/layer styles/);
  });

  it('an unknown match name fails with unsupported; a bad enum is rejected before sending', async () => {
    const r = await callTool(client, 'set-composition-renderer', { matchName: 'ADBE Raytrace' });
    expect(r.json).toMatchObject({ bridgeError: { code: 'unsupported' } });
    await rejected('set-composition-renderer', { renderer: 'ray-traced' });
  });
});

describe('set-extrusion', () => {
  it('refuses while the comp is Classic 3D', async () => {
    const r = await callTool(client, 'set-extrusion', { layer: { name: 'LOGO' }, extrusionDepth: 60 });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ bridgeError: { code: 'unsupported' } });
    expect(String(r.json.message)).toContain('set-composition-renderer');
  });

  it('sets geometry options and keys after the renderer is Advanced 3D', async () => {
    await callTool(client, 'set-composition-renderer', { renderer: 'advanced-3d' });
    const r = await callTool(client, 'set-extrusion', {
      layer: { name: 'LOGO' },
      bevelStyle: 'convex',
      bevelDepth: 4,
      keyframes: [{ frame: 30, extrusionDepth: 60 }, { frame: 0, extrusionDepth: 0, easing: 'linear' }],
    });
    expect(r.isError).toBe(false);
    expect(r.json.geometryOptions).toMatchObject({ bevelStyle: 'convex', bevelDepth: 4 });
    const keys = r.json.keyframes as Array<{ arg: string; keys: Array<{ frame: number; value: number }> }>;
    expect(keys[0].arg).toBe('extrusionDepth');
    expect(keys[0].keys.map((k) => k.frame)).toEqual([0, 30]);
  });

  it('rejects empty calls, bad bevel styles, hole bevel over 100 and keys without time before sending', async () => {
    await rejected('set-extrusion', { layer: { index: 1 } });
    await rejected('set-extrusion', { layer: { index: 1 }, bevelStyle: 'round' });
    await rejected('set-extrusion', { layer: { index: 1 }, holeBevelDepth: 120 });
    await rejected('set-extrusion', { layer: { index: 1 }, keyframes: [{ extrusionDepth: 10 }] });
    await rejected('set-extrusion', { layer: { index: 1 }, keyframes: [{ frame: 0 }] });
    await rejected('set-extrusion', { layer: { index: 1 }, extrusionDepth: -5 });
  });
});

describe('add-environment-light', () => {
  it('refuses outside Advanced 3D unless switchRenderer is true', async () => {
    const no = await callTool(client, 'add-environment-light', { sourceFile: '/hdri/studio.hdr' });
    expect(no.json).toMatchObject({ bridgeError: { code: 'unsupported' } });
    const yes = await callTool(client, 'add-environment-light', { sourceFile: '/hdri/studio.hdr', switchRenderer: true, intensity: 120, rotation: 45, useAsBackground: true });
    expect(yes.isError).toBe(false);
    expect(yes.json).toMatchObject({ lightType: 'environment', intensity: 120, rotation: { y: 45 }, sourceApplied: true, background: { route: 'menu' } });
    expect((yes.json.notes as string[])[0]).toMatch(/switched/);
  });

  // POSIX paths in the expectations.
  it.skipIf(process.platform === 'win32')('expands ~ in sourceFile and accepts [x, y, z] rotation', async () => {
    await callTool(client, 'set-composition-renderer', { renderer: 'advanced-3d' });
    const r = await callTool(client, 'add-environment-light', { sourceFile: '~/hdri/sky.exr', rotation: [10, 20, 30] });
    expect(r.json).toMatchObject({ rotation: { x: 10, y: 20, z: 30 }, source: { layer: { name: 'sky.exr' }, hdr: true } });
  });

  it('rejects two sources, an empty sourceItem and a bad rotation before sending', async () => {
    await rejected('add-environment-light', { source: { index: 1 }, sourceFile: '/a.hdr' });
    await rejected('add-environment-light', { sourceItem: {} });
    await rejected('add-environment-light', { rotation: [1, 2] });
    await rejected('add-environment-light', { shadowDarkness: 150 });
  });
});

/* ------------------------------------------------------------------------
 * advanced-3d.jsx in a Node vm against fake comps, layers and properties.
 * ---------------------------------------------------------------------- */

const SCRIPTS = path.resolve(__dirname, '..', '..', 'src', 'scripts');
const PT = { PROPERTY: 6212, NAMED_GROUP: 6213, INDEXED_GROUP: 6214 };
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function keyedProp(name: string, matchName: string, value: unknown, comp: Any): Any {
  const keys: Any[] = [];
  return {
    name,
    matchName,
    propertyType: PT.PROPERTY,
    value,
    hidden: false,
    canVaryOverTime: true,
    isSpatial: false,
    get numKeys() {
      return keys.length;
    },
    setValue(v: unknown) {
      if (this.hidden) throw new Error('property or a parent property is hidden');
      this.value = v;
    },
    setValueAtTime(t: number, v: unknown) {
      const at = keys.findIndex((k) => Math.abs(k.time - t) < 1e-6);
      const k = { time: t, value: v, inType: KIT.LINEAR, outType: KIT.LINEAR, inEase: [{ speed: 0, influence: 16.67 }], outEase: [{ speed: 0, influence: 16.67 }] };
      if (at >= 0) keys[at] = k;
      else keys.push(k);
      keys.sort((a, b) => a.time - b.time);
    },
    keyTime: (i: number) => keys[i - 1].time,
    keyValue: (i: number) => keys[i - 1].value,
    nearestKeyIndex(t: number) {
      let best = 1;
      keys.forEach((k, i) => {
        if (Math.abs(k.time - t) < Math.abs(keys[best - 1].time - t)) best = i + 1;
      });
      return best;
    },
    keyInInterpolationType: (i: number) => keys[i - 1].inType,
    keyOutInterpolationType: (i: number) => keys[i - 1].outType,
    setInterpolationTypeAtKey(i: number, a: number, b: number) {
      keys[i - 1].inType = a;
      keys[i - 1].outType = b;
    },
    keyInTemporalEase: (i: number) => keys[i - 1].inEase,
    keyOutTemporalEase: (i: number) => keys[i - 1].outEase,
    setTemporalEaseAtKey(i: number, a: unknown[], b: unknown[]) {
      keys[i - 1].inEase = a;
      keys[i - 1].outEase = b;
    },
    setTemporalAutoBezierAtKey() {},
    setTemporalContinuousAtKey() {},
    propertyGroup: () => ({ containingComp: comp }),
    keys,
  };
}

function group(name: string, matchName: string, children: Any[]): Any {
  const g: Any = { name, matchName, propertyType: PT.NAMED_GROUP, enabled: true, numProperties: children.length };
  g.property = (x: number | string) => (typeof x === 'number' ? children[x - 1] : children.find((c) => c.matchName === x || c.name === x)) ?? null;
  children.forEach((c) => (c.parentProperty = g));
  return g;
}

function makeCtx(version = '26.5.0'): vm.Context & Any {
  const ctx = {
    MCP_BRIDGE_VERSION: 'test',
    PropertyType: PT,
    KeyframeInterpolationType: KIT,
    KeyframeEase: function (this: Any, speed: number, influence: number) {
      this.speed = speed;
      this.influence = influence;
    },
    LightType: { PARALLEL: 1, SPOT: 2, POINT: 3, AMBIENT: 4, ENVIRONMENT: 5 },
    Folder: { myDocuments: { fsName: '/tmp' } },
    console,
  } as unknown as vm.Context & Any;
  vm.createContext(ctx);
  vm.runInContext(
    ['CompItem', 'FolderItem', 'FootageItem', 'SolidSource', 'PlaceholderSource', 'AVLayer', 'CameraLayer', 'LightLayer'].map((c) => `function ${c}() {}`).join('\n') +
      '\nfunction TextLayer() {}\nTextLayer.prototype = new AVLayer();\nfunction ShapeLayer() {}\nShapeLayer.prototype = new AVLayer();\n' +
      'function File(p) { this.fsName = p; this.name = p.split("/").pop(); this.exists = __exists(p); }\nfunction ImportOptions(f) { this.file = f; }',
    ctx
  );
  ctx.__exists = (p: string) => fs.existsSync(p);
  ctx.app = { version, project: { activeItem: null, numItems: 0 }, findMenuCommandId: () => 0, executeCommand: () => undefined };
  for (const f of ['polyfills.jsx', 'json.jsx', 'core.jsx', 'color.jsx', 'undo.jsx', 'resolve.jsx', 'serialize.jsx', 'easing.jsx']) {
    vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'lib', f), 'utf8'), ctx, { filename: f });
  }
  for (const f of ['advanced-3d.jsx', 'camera-3d.jsx']) vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'commands', f), 'utf8'), ctx, { filename: f });
  return ctx;
}

function setup(ctx: Any, renderer: string) {
  const layers: Any[] = [];
  const comp = vm.runInContext('new CompItem()', ctx) as Any;
  Object.assign(comp, { id: 1, name: 'Logo 3D', renderer, renderers: ['ADBE Advanced 3d', 'ADBE Calder'], width: 1920, height: 1080, pixelAspect: 1, frameDuration: 1 / 30, duration: 10, time: 0, openInViewer: () => null });
  Object.defineProperty(comp, 'numLayers', { get: () => layers.length });
  comp.layer = (i: number) => layers[i - 1];
  ctx.app.project.activeItem = comp;
  const add = (L: Any) => {
    Object.assign(L, { containingComp: comp, propertyDepth: 0, inPoint: 0, outPoint: 10, startTime: 0, enabled: true, selected: false });
    Object.defineProperty(L, 'index', { configurable: true, get: () => layers.indexOf(L) + 1 });
    L.id = 700 + layers.length;
    L.remove = () => layers.splice(layers.indexOf(L), 1);
    L.moveToEnd = () => {
      layers.splice(layers.indexOf(L), 1);
      layers.push(L);
    };
    layers.unshift(L);
    return L;
  };
  return { comp, layers, add };
}

describe('advanced-3d.jsx in a vm', () => {
  it('setCompositionRenderer compares match names exactly and warns about layer styles', () => {
    const ctx = makeCtx();
    const { add } = setup(ctx, 'ADBE Advanced 3d');
    const styled = add(vm.runInContext('new AVLayer()', ctx));
    styled.name = 'Button';
    const styles = group('Layer Styles', 'ADBE Layer Styles', [{ matchName: 'ADBE Blend Options Group', enabled: true }, { matchName: 'dropShadow/enabled', enabled: true }]);
    styled.property = (x: string) => (x === 'ADBE Layer Styles' ? styles : null);
    const r = JSON.parse(JSON.stringify(ctx.MCP.commands.setCompositionRenderer({ rendererMatchName: 'ADBE Calder' })));
    expect(r).toMatchObject({ changed: true, previous: { name: 'Classic 3D' }, renderer: { name: 'Advanced 3D' } });
    expect(r.warnings[0]).toContain("'Button'");
    expect(() => ctx.MCP.commands.setCompositionRenderer({ rendererMatchName: 'ADBE Ernst' })).toThrow(/not available/);
    const list = JSON.parse(JSON.stringify(ctx.MCP.commands.setCompositionRenderer({})));
    expect(list.listOnly).toBe(true);
  });

  it('setExtrusion refuses Classic 3D and footage layers, turns 3D on, sets values and keys in time order', () => {
    const ctx = makeCtx();
    const { comp, add } = setup(ctx, 'ADBE Advanced 3d');
    const logo = add(vm.runInContext('new ShapeLayer()', ctx));
    logo.name = 'LOGO';
    logo.threeDLayer = false;
    const depth = keyedProp('Extrusion Depth', 'ADBE Extrsn Depth', 0, comp);
    const bevel = keyedProp('Bevel Depth', 'ADBE Bevel Depth', 0, comp);
    const hole = keyedProp('Hole Bevel Depth', 'ADBE Hole Bevel Depth', 100, comp);
    const style = keyedProp('Bevel Style', 'ADBE Bevel Styles', 1, comp);
    const geo = group('Geometry Options', 'ADBE Extrsn Options Group', [style, bevel, hole, depth]);
    geo.propertyDepth = 1;
    geo.parentProperty = logo;
    [style, bevel, hole, depth].forEach((p) => (p.propertyDepth = 2));
    logo.property = (x: string) => (x === 'ADBE Extrsn Options Group' ? geo : null);
    expect(() => ctx.MCP.commands.setExtrusion({ layer: { name: 'LOGO' }, extrusionDepth: 10 })).toThrow(/cannot extrude/);
    comp.renderer = 'ADBE Calder';
    hole.hidden = true;
    const r = JSON.parse(JSON.stringify(ctx.MCP.commands.setExtrusion({ layer: { name: 'LOGO' }, bevelStyle: 'convex', bevelDepth: 4, holeBevelDepth: 50, keyframes: [{ frame: 30, extrusionDepth: 60 }, { frame: 0, extrusionDepth: 0 }] })));
    expect(logo.threeDLayer).toBe(true);
    expect(style.value).toBe(4);
    expect(bevel.value).toBe(4);
    expect(r.geometryOptions).toMatchObject({ bevelStyle: 'convex', bevelDepth: 4 });
    expect(r.notes.join(' ')).toMatch(/Hole Bevel Depth/);
    expect(depth.keys.map((k: Any) => [k.time * 30, k.value])).toEqual([[0, 0], [30, 60]]);
    // The second key lands softly: speed 0, influence 100 arriving; the first leaves with 25.
    expect(depth.keys[1].inEase[0]).toMatchObject({ speed: 0, influence: 100 });
    expect(depth.keys[0].outEase[0]).toMatchObject({ speed: 0, influence: 25 });
    expect(r.keyframes[0].keys.length).toBe(2);
    const footage = add(vm.runInContext('new AVLayer()', ctx));
    footage.name = 'Photo';
    expect(() => ctx.MCP.commands.setExtrusion({ layer: { name: 'Photo' }, extrusionDepth: 10 })).toThrow(/Only text and shape layers/);
  });

  it('addEnvironmentLight sets rotation and shadows while spot, then switches type, source and background', () => {
    const ctx = makeCtx();
    const { comp, layers, add } = setup(ctx, 'ADBE Calder');
    const hdrPath = path.join(tb.dir, 'studio.hdr');
    fs.writeFileSync(hdrPath, 'hdr');
    const footage = vm.runInContext('new FootageItem()', ctx) as Any;
    Object.assign(footage, { id: 50, name: 'studio.hdr', file: { name: 'studio.hdr' } });
    ctx.app.project.importFile = () => footage;
    const typeLog: Any[] = [];
    const makeLight = (name: string) => {
      const L = vm.runInContext('new LightLayer()', ctx) as Any;
      L.name = name;
      let type = 3;
      const rx = keyedProp('X Rotation', 'ADBE Rotate X', 0, comp);
      const ry = keyedProp('Y Rotation', 'ADBE Rotate Y', 0, comp);
      const rz = keyedProp('Z Rotation', 'ADBE Rotate Z', 0, comp);
      const casts = keyedProp('Casts Shadows', 'ADBE Casts Shadows', 0, comp);
      const intensity = keyedProp('Intensity', 'ADBE Light Intensity', 100, comp);
      Object.defineProperty(L, 'lightType', {
        get: () => type,
        set: (v: number) => {
          type = v;
          typeLog.push(v);
          // Environment lights hide rotation and shadows.
          [rx, ry, casts].forEach((p) => (p.hidden = v === 5));
        },
      });
      const tg = group('Transform', 'ADBE Transform Group', [rx, ry, rz]);
      const lo = group('Light Options', 'ADBE Light Options Group', [intensity, casts]);
      L.property = (x: string) => (x === 'ADBE Transform Group' ? tg : x === 'ADBE Light Options Group' ? lo : null);
      L.parts = { ry, casts, intensity };
      return add(L);
    };
    comp.layers = {
      addLight: (name: string) => makeLight(name),
      add: (item: Any) => {
        const L = vm.runInContext('new AVLayer()', ctx) as Any;
        L.name = item.name;
        L.source = item;
        L.threeDLayer = false;
        return add(L);
      },
      addSolid: (_c: unknown, name: string) => {
        const S = vm.runInContext('new AVLayer()', ctx) as Any;
        S.name = name;
        const fxParams = [keyedProp('Environment', 'CC Environment-0001', 0, comp), keyedProp('Mapping', 'CC Environment-0004', 1, comp)];
        const fx = group('CC Environment', 'CC Environment', fxParams);
        const parade = { property: (i: number) => (i === 1 ? fx : null), addProperty: () => fx };
        S.property = (x: string) => (x === 'ADBE Effect Parade' ? parade : null);
        S.fx = fx;
        return add(S);
      },
    };
    const r = JSON.parse(JSON.stringify(ctx.MCP.commands.addEnvironmentLight({ sourceFile: hdrPath, intensity: 140, rotation: 45, castsShadows: true, useAsBackground: true })));
    const light = layers.find((l) => l.name === 'Environment Light');
    expect(typeLog).toEqual([2, 5]);
    expect(light.parts.ry.value).toBe(45);
    expect(light.parts.casts.value).toBe(1);
    expect(light.parts.intensity.value).toBe(140);
    expect(light.lightSource.name).toBe('studio.hdr');
    expect(r).toMatchObject({ lightType: 'environment', sourceApplied: true, source: { created: true, enabled: false, hdr: true }, background: { route: 'cc-environment' } });
    const bg = layers.find((l) => l.name === 'Environment Light Background');
    expect(layers[layers.length - 1]).toBe(bg);
    expect(bg.fx.property('CC Environment-0001').value).toBe(layers.find((l) => l.name === 'studio.hdr').index);
  });

  it('addEnvironmentLight refuses old versions, other renderers and 3D sources', () => {
    const old = makeCtx('24.1.0');
    setup(old, 'ADBE Calder');
    expect(() => old.MCP.commands.addEnvironmentLight({})).toThrow(/24.3/);
    const ctx = makeCtx();
    const { add } = setup(ctx, 'ADBE Advanced 3d');
    expect(() => ctx.MCP.commands.addEnvironmentLight({})).toThrow(/need Advanced 3D/);
    ctx.app.project.activeItem.renderer = 'ADBE Calder';
    const plate = add(vm.runInContext('new AVLayer()', ctx));
    plate.name = 'Plate';
    plate.threeDLayer = true;
    expect(() => ctx.MCP.commands.addEnvironmentLight({ source: { name: 'Plate' } })).toThrow(/must be 2D/);
  });
});
