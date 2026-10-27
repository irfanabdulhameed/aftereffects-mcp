import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog } from '../../src/tools/registry.js';
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

function lastCommand(): { command: string; status: string } {
  return tb.mock.state.log[tb.mock.state.log.length - 1];
}

describe('check tools: registration', () => {
  it('registers four tools in group check with template descriptions of 60 to 200 words', () => {
    const tools = catalog.filter((c) => ['audit-composition', 'purge-caches', 'save-version', 'organize-project'].includes(c.name));
    expect(tools.length).toBe(4);
    for (const t of tools) {
      expect(t.group).toBe('check');
      const words = t.description.split(/\s+/).length;
      expect(words, t.name).toBeGreaterThanOrEqual(60);
      expect(words, t.name).toBeLessThanOrEqual(200);
      const labels = ['Use when:', 'Do not use for:', 'Inputs:', 'Returns:', 'Notes:', 'Example:'].map((l) => t.description.indexOf(l));
      expect(labels.every((v, i) => v > 0 && (i === 0 || v > labels[i - 1])), t.name).toBe(true);
    }
    expect(tools.find((t) => t.name === 'audit-composition')?.mutating).toBe(false);
    expect(tools.find((t) => t.name === 'purge-caches')?.mutating).toBe(true);
  });
});

describe('audit-composition through the server', () => {
  it('returns summary counts, findings sorted errors first, and key statistics', async () => {
    const r = await callTool(client, 'audit-composition', { comp: { name: 'Main Comp' } });
    expect(r.isError).toBe(false);
    expect(lastCommand().command).toBe('auditComposition');
    const summary = r.json.summary as Record<string, number>;
    expect(summary.total).toBe(summary.error + summary.warning + summary.info);
    const findings = r.json.findings as Array<{ severity: string; check: string; fix: string; comp: { name: string } }>;
    const ranks = findings.map((f) => ({ error: 0, warning: 1, info: 2 })[f.severity] as number);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(findings[0]).toMatchObject({ check: 'frame-by-frame', severity: 'error' });
    expect(findings.every((f) => f.fix.length > 0)).toBe(true);
    expect(r.json.keyStats).toMatchObject({ totalKeys: 96 });
  });

  it('recurse adds nested comps; checks, minSeverity and maxFindings narrow the result', async () => {
    const deep = await callTool(client, 'audit-composition', { recurse: true });
    expect((deep.json.compsChecked as unknown[]).length).toBe(2);
    const only = await callTool(client, 'audit-composition', { checks: ['frame-by-frame', 'short-layers'], minSeverity: 'error', limits: { maxFindings: 5 } });
    const f = only.json.findings as Array<{ check: string; severity: string }>;
    expect(f.every((x) => x.check === 'frame-by-frame' && x.severity === 'error')).toBe(true);
    expect(only.json.checks).toEqual(['frame-by-frame', 'short-layers']);
    expect((only.json.summary as Record<string, number>).warning).toBe(1);
  });

  it('rejects unknown checks, bad limits and severities before sending', async () => {
    await rejected('audit-composition', { checks: ['spelling'] });
    await rejected('audit-composition', { checks: [] });
    await rejected('audit-composition', { limits: { consecutiveKeys: 1 } });
    await rejected('audit-composition', { limits: { maxFindings: 0 } });
    await rejected('audit-composition', { minSeverity: 'fatal' });
  });
});

describe('purge-caches, save-version and organize-project through the server', () => {
  it('purge-caches defaults to all and reports memory and the undo note', async () => {
    const r = await callTool(client, 'purge-caches', {});
    expect(r.json).toMatchObject({ target: 'all', purgeTarget: 'ALL_CACHES', freedBytes: 4294967296 });
    expect((r.json.notes as string[])[0]).toMatch(/undo history/);
    const img = await callTool(client, 'purge-caches', { target: 'image' });
    expect(img.json).toMatchObject({ purgeTarget: 'IMAGE_CACHES', notes: [] });
    await rejected('purge-caches', { target: 'disk' });
  });

  it('save-version returns the new path and rejects notes with path characters', async () => {
    const r = await callTool(client, 'save-version', { note: 'before color pass' });
    expect(r.json).toMatchObject({ fileName: 'promo_v04_before-color-pass.aep', version: 4, saved: true });
    await rejected('save-version', { note: '../escape' });
    await rejected('save-version', { note: 'x'.repeat(61) });
  });

  it('organize-project returns the plan; includeFoldered and folderNames change it', async () => {
    const plan = await callTool(client, 'organize-project', { dryRun: true });
    expect(plan.json).toMatchObject({ dryRun: true, keptCount: 1 });
    const moved = await callTool(client, 'organize-project', { includeFoldered: true, removeEmptyFolders: true, folderNames: { precomps: '02 Precomps' } });
    const moves = moved.json.moves as Array<{ to: string; from: string }>;
    expect(moves.some((m) => m.to === '02 Precomps')).toBe(true);
    expect(moves.some((m) => m.from === 'References')).toBe(true);
    expect(moved.json.removedFolders).toEqual(['References']);
    await rejected('organize-project', { folderNames: { comps: '' } });
  });
});

/* ------------------------------------------------------------------------
 * The ExtendScript side, run in a Node vm against fake After Effects objects.
 * ---------------------------------------------------------------------- */

const SCRIPTS = path.resolve(__dirname, '..', '..', 'src', 'scripts');
const LIBS = ['polyfills.jsx', 'json.jsx', 'core.jsx', 'color.jsx', 'undo.jsx', 'resolve.jsx', 'serialize.jsx', 'easing.jsx'];

const PT = { PROPERTY: 6212, NAMED_GROUP: 6213, INDEXED_GROUP: 6214 };
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Ctx extends vm.Context {
  MCP: Any;
  app: Any;
  [k: string]: unknown;
}

function makeContext(): Ctx {
  const ctx = {
    MCP_BRIDGE_VERSION: 'test',
    PropertyType: PT,
    KeyframeInterpolationType: KIT,
    PurgeTarget: { ALL_CACHES: 1, ALL_MEMORY_CACHES: 2, UNDO_CACHES: 3, IMAGE_CACHES: 4, SNAPSHOT_CACHES: 5 },
    app: { version: '24.6.0', project: { numItems: 0, activeItem: null }, fonts: null, memoryInUse: 1000, purged: [] as number[], purge(v: number) { this.purged.push(v); this.memoryInUse = 400; } },
    Folder: { myDocuments: { fsName: '/tmp' } },
    console,
  } as unknown as Ctx;
  vm.createContext(ctx);
  vm.runInContext(
    [
      'function CompItem() {}',
      'function FolderItem() {}',
      'function FootageItem() {}',
      'function SolidSource() {}',
      'function PlaceholderSource() {}',
      'function FileSource() {}',
      'function AVLayer() {}',
      'function TextLayer() {}',
      'TextLayer.prototype = new AVLayer();',
      'function ShapeLayer() {}',
      'ShapeLayer.prototype = new AVLayer();',
      'function CameraLayer() {}',
      'function LightLayer() {}',
    ].join('\n'),
    ctx
  );
  for (const f of LIBS) vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'lib', f), 'utf8'), ctx, { filename: f });
  vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'commands', 'check.jsx'), 'utf8'), ctx, { filename: 'check.jsx' });
  return ctx;
}

/** Builds fake objects with the vm's constructors so instanceof works inside the scripts. */
function make(ctx: Ctx, ctor: string, fields: Any): Any {
  const obj = vm.runInContext(`new ${ctor}()`, ctx) as Any;
  return Object.assign(obj, fields);
}

interface KeySpec {
  frame: number;
  value?: unknown;
  hold?: boolean;
}

function prop(name: string, matchName: string, opts: { keys?: KeySpec[]; expression?: string; error?: string; holdOnly?: boolean; fps?: number } = {}): Any {
  const fps = opts.fps ?? 30;
  const keys = opts.keys ?? [];
  return {
    name,
    matchName,
    propertyType: PT.PROPERTY,
    numKeys: keys.length,
    keyTime: (i: number) => keys[i - 1].frame / fps,
    keyValue: (i: number) => keys[i - 1].value ?? i,
    keyOutInterpolationType: (i: number) => (keys[i - 1].hold ? KIT.HOLD : KIT.BEZIER),
    isInterpolationTypeValid: (t: number) => !(opts.holdOnly && t === KIT.LINEAR),
    canSetExpression: true,
    expression: opts.expression ?? '',
    expressionError: opts.error ?? '',
    expressionEnabled: !opts.error,
    value: 0,
  };
}

function group(name: string, matchName: string, children: Any[], extra: Any = {}): Any {
  const g: Any = {
    name,
    matchName,
    propertyType: PT.NAMED_GROUP,
    numProperties: children.length,
    property(x: number | string) {
      if (typeof x === 'number') return children[x - 1] ?? null;
      return children.find((c) => c.matchName === x || c.name === x) ?? null;
    },
    ...extra,
  };
  children.forEach((c) => (c.parentProperty = g));
  return g;
}

/** Wires propertyDepth and parentProperty so MCP.pathOf works. */
function finishLayer(layer: Any, children: Any[]): Any {
  layer.numProperties = children.length;
  layer.propertyDepth = 0;
  layer.property = (x: number | string) => {
    if (typeof x === 'number') return children[x - 1] ?? null;
    return children.find((c) => c.matchName === x || c.name === x) ?? null;
  };
  const setDepth = (p: Any, depth: number, parent: Any) => {
    p.propertyDepth = depth;
    p.parentProperty = parent;
    if (p.matchName === 'ADBE Vector Grad Colors') return;
    if (p.numProperties) for (let i = 1; i <= p.numProperties; i++) setDepth(p.property(i), depth + 1, p);
  };
  children.forEach((c) => setDepth(c, 1, layer));
  return layer;
}

function layerBase(ctx: Ctx, ctor: string, index: number, name: string, over: Any = {}): Any {
  return make(ctx, ctor, { index, id: 500 + index, name, inPoint: 0, outPoint: 10, startTime: 0, stretch: 100, enabled: true, selected: false, ...over });
}

function compOf(ctx: Ctx, id: number, name: string, layers: Any[], over: Any = {}): Any {
  const c = make(ctx, 'CompItem', { id, name, numLayers: layers.length, layer: (i: number) => layers[i - 1], frameDuration: 1 / 30, duration: 10, time: 0, width: 1920, height: 1080, usedIn: [], ...over });
  layers.forEach((l) => (l.containingComp = c));
  return c;
}

describe('check.jsx helpers in a vm', () => {
  let ctx: Ctx;
  beforeAll(() => {
    ctx = makeContext();
  });

  it('nameStem strips numbers, copies and separators', () => {
    const stem = ctx.MCP.check.nameStem;
    expect(stem('Frame 01')).toBe('frame');
    expect(stem('dot_3')).toBe('dot');
    expect(stem('Shape Layer 12')).toBe('shape layer');
    expect(stem('Title copy 2')).toBe('title');
    expect(stem('42')).toBe('#');
  });

  it('consecutiveRuns and holdRuns find runs from key frames and hold flags', () => {
    const runs = ctx.MCP.check.consecutiveRuns([0, 1, 2, 3, 10, 20, 21, 22, 40], 3);
    expect(JSON.parse(JSON.stringify(runs))).toEqual([{ start: 0, length: 4 }, { start: 5, length: 3 }]);
    expect(ctx.MCP.check.consecutiveRuns([0, 0, 1], 3).length).toBe(1);
    expect(ctx.MCP.check.consecutiveRuns([0, 2, 4], 3).length).toBe(0);
    const holds = ctx.MCP.check.holdRuns([true, true, true, false, true, true, true, true], 3);
    expect(JSON.parse(JSON.stringify(holds))).toEqual([{ start: 0, length: 3 }, { start: 4, length: 3 }]);
    expect(ctx.MCP.check.holdRuns([true, true, false, true], 3).length).toBe(0);
  });

  it('nextVersionName increments the last version, keeps padding, drops an old note, adds _v02 otherwise', () => {
    const next = (b: string, note?: string, step?: number) => ctx.MCP.check.nextVersionName(b, note, step).name;
    expect(next('promo_v01')).toBe('promo_v02');
    expect(next('promo_v009')).toBe('promo_v010');
    expect(next('promo_v03_colour')).toBe('promo_v04');
    expect(next('shot.V7')).toBe('shot.V8');
    expect(next('v1')).toBe('v2');
    expect(next('review cut')).toBe('review cut_v02');
    expect(next('TV2 spot')).toBe('TV2 spot_v02');
    expect(next('promo_v03', 'before color pass!')).toBe('promo_v04_before-color-pass');
    expect(next('promo_v03', undefined, 3)).toBe('promo_v06');
  });
});

describe('auditComposition in a vm against a fake comp', () => {
  let ctx: Ctx;
  let result: Any;
  let gradientTouched = false;

  beforeAll(() => {
    ctx = makeContext();
    const fontsAsked: string[] = [];
    ctx.app.fonts = {
      getFontsByPostScriptName(ps: string) {
        fontsAsked.push(ps);
        return ps === 'MissingSans-Bold' ? [] : [{}];
      },
    };
    // A gradient Colors property that must never be read beyond its match name.
    const trap: Any = { name: 'Colors', matchName: 'ADBE Vector Grad Colors' };
    for (const key of ['propertyType', 'numKeys', 'canSetExpression', 'expression', 'value', 'numProperties']) {
      Object.defineProperty(trap, key, { get() { gradientTouched = true; throw new Error('modal dialog'); } });
    }

    // 1: frame-by-frame position, hold-ladder rotation, an expression error, markers on consecutive frames.
    const dot = finishLayer(layerBase(ctx, 'AVLayer', 1, 'Dot'), [
      group('Marker', 'ADBE Marker', []),
      { ...prop('Marker', 'ADBE Marker', { keys: Array.from({ length: 6 }, (_, i) => ({ frame: i })) }) },
      group('Transform', 'ADBE Transform Group', [
        prop('Position', 'ADBE Position', { keys: Array.from({ length: 11 }, (_, i) => ({ frame: 10 + i, value: [i, 0] })) }),
        prop('Rotation', 'ADBE Rotate Z', { keys: [0, 10, 20, 30, 40].map((f, i) => ({ frame: f, value: i * 10, hold: true })) }),
        prop('Scale', 'ADBE Scale', { keys: [0, 10, 20, 30].map((f) => ({ frame: f, value: [100, 100], hold: true })) }),
        prop('Opacity', 'ADBE Opacity', { expression: 'slider', error: 'ReferenceError: slider is not defined' }),
      ]),
    ]);
    // 2: text with many Source Text keys and a missing font.
    const doc = (font: string) => ({ font, fontObject: { isSubstitute: font === 'MissingSans-Bold' } });
    const title = finishLayer(layerBase(ctx, 'TextLayer', 2, 'Typing'), [
      group('Text', 'ADBE Text Properties', [prop('Source Text', 'ADBE Text Document', { holdOnly: true, keys: [0, 3, 6, 9].map((f) => ({ frame: f, value: doc('MissingSans-Bold'), hold: true })) })]),
    ]);
    // 3-5: three one-frame copies sharing a stem.
    const copies = [3, 4, 5].map((i) => finishLayer(layerBase(ctx, 'AVLayer', i, `Frame 0${i - 2}`, { inPoint: (i - 3) / 30, outPoint: (i - 2) / 30 }), []));
    // 6: missing footage and a switched-off effect and a missing plug-in.
    const parade = group('Effects', 'ADBE Effect Parade', [
      { ...group('Glow', 'ADBE Glo2', []), enabled: false },
      { ...group('Fancy', 'VENDOR FancyFX', []), enabled: true },
    ], { canAddProperty: (mn: string) => mn !== 'VENDOR FancyFX' });
    const clipSrc = make(ctx, 'FootageItem', { id: 12, name: 'clip.mov', footageMissing: true, mainSource: { missingFootagePath: '/media/clip.mov' } });
    const clip = finishLayer(layerBase(ctx, 'AVLayer', 6, 'Clip', { source: clipSrc }), [parade]);
    // 7: precomp used past its end; the precomp has its own frame-by-frame layer.
    const shine = finishLayer(layerBase(ctx, 'AVLayer', 1, 'Shine'), [
      group('Transform', 'ADBE Transform Group', [prop('Position', 'ADBE Position', { keys: Array.from({ length: 4 }, (_, i) => ({ frame: i, value: [i, i] })) })]),
    ]);
    const card = compOf(ctx, 7, 'Card', [shine], { duration: 4, usedIn: [1] });
    const cardLayer = finishLayer(layerBase(ctx, 'AVLayer', 7, 'Card', { source: card, outPoint: 6 }), []);
    // 8: outside the comp. 9: a shape layer with a gradient fill.
    const old = finishLayer(layerBase(ctx, 'AVLayer', 8, 'Old intro', { inPoint: 12, outPoint: 13 }), []);
    const gfill = group('Gradient Fill 1', 'ADBE Vector Graphic - G-Fill', [prop('Type', 'ADBE Vector Grad Type'), trap]);
    const shape = finishLayer(layerBase(ctx, 'ShapeLayer', 9, 'Blob'), [group('Contents', 'ADBE Root Vectors Group', [group('Group 1', 'ADBE Vector Group', [group('Contents', 'ADBE Vectors Group', [gfill])])])]);

    const main = compOf(ctx, 1, 'Main', [dot, title, ...copies, clip, cardLayer, old, shape]);
    ctx.app.project.activeItem = main;
    result = JSON.parse(JSON.stringify(ctx.MCP.commands.auditComposition({ recurse: true })));
  });

  const find = (check: string, layer?: string): Any[] => (result.findings as Any[]).filter((f) => f.check === check && (!layer || f.layer?.name === layer));

  it('flags keys on consecutive frames as an error, but not markers', () => {
    const fbf = find('frame-by-frame', 'Dot');
    expect(fbf.length).toBe(1);
    expect(fbf[0]).toMatchObject({ severity: 'error', property: 'Transform/Position', frame: 10, endFrame: 20, count: 11, longestRun: 11 });
    expect((result.findings as Any[]).some((f) => String(f.property).startsWith('Marker'))).toBe(false);
  });

  it('flags a moving hold ladder, not a hold run that stays put', () => {
    const ladders = find('hold-ladders');
    expect(ladders.length).toBe(1);
    expect(ladders[0]).toMatchObject({ severity: 'warning', property: 'Transform/Rotation', count: 4 });
  });

  it('flags Source Text keys and the missing font, and no hold ladder on text', () => {
    expect(find('source-text-keys', 'Typing')[0]).toMatchObject({ severity: 'warning', count: 4, property: 'Text/Source Text' });
    expect(find('missing-fonts', 'Typing')[0]).toMatchObject({ severity: 'error', font: 'MissingSans-Bold' });
    expect(find('hold-ladders', 'Typing').length).toBe(0);
    expect(result.fontCheck).toBe('layer');
  });

  it('flags expression errors, missing footage, effects off and plug-ins not installed', () => {
    expect(find('expression-errors', 'Dot')[0]).toMatchObject({ severity: 'error', property: 'Transform/Opacity', enabled: false });
    expect(find('missing-footage', 'Clip')[0]).toMatchObject({ severity: 'error', path: '/media/clip.mov' });
    const fx = find('effects', 'Clip');
    expect(fx.map((f) => f.matchName).sort()).toEqual(['ADBE Glo2', 'VENDOR FancyFX']);
    expect(fx.find((f) => f.matchName === 'VENDOR FancyFX').message).toMatch(/not installed/);
  });

  it('flags short layers and the shared name stem, and layers outside the comp as info', () => {
    expect(find('short-layers').map((f) => f.layer.name)).toEqual(['Frame 01', 'Frame 02', 'Frame 03']);
    expect(find('name-stems')[0]).toMatchObject({ severity: 'warning', count: 3, stem: 'frame' });
    expect(find('outside-comp', 'Old intro')[0]).toMatchObject({ severity: 'info', frame: 360 });
    expect(find('short-layers', 'Old intro').length).toBe(0);
  });

  it('flags a precomp used past its end and recurses into it once', () => {
    expect(find('precomp-duration', 'Card')[0]).toMatchObject({ severity: 'warning', item: { name: 'Card', duration: 4 } });
    expect(result.compsChecked.map((c: Any) => c.name)).toEqual(['Main', 'Card']);
    expect(find('frame-by-frame', 'Shine')[0]).toMatchObject({ comp: { id: 7, name: 'Card' } });
  });

  it('never reads the gradient Colors property', () => {
    expect(gradientTouched).toBe(false);
  });

  it('sorts errors first, counts everything, and lists the most keyed properties', () => {
    const ranks = (result.findings as Any[]).map((f) => ({ error: 0, warning: 1, info: 2 })[f.severity as 'error']);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(result.summary.total).toBe(result.summary.error + result.summary.warning + result.summary.info);
    expect(result.summary.error).toBe(5);
    expect(result.keyStats.top[0]).toMatchObject({ property: 'Transform/Position', numKeys: 11 });
    expect(result.keyStats.expressions).toBe(1);
  });

  it('checks, minSeverity and maxFindings narrow the list but not the summary', () => {
    const r = JSON.parse(JSON.stringify(ctx.MCP.commands.auditComposition({ checks: ['short-layers', 'frame-by-frame'], minSeverity: 'error', limits: { maxFindings: 1 } })));
    expect(r.findings.length).toBe(1);
    expect(r.findings[0].check).toBe('frame-by-frame');
    expect(r.summary.warning).toBe(3);
    expect(r.truncated).toBe(false);
    expect(() => ctx.MCP.commands.auditComposition({ checks: ['nope'] })).toThrow(/Unknown check/);
  });
});

describe('purgeCaches, saveVersion and organizeProject in a vm', () => {
  it('purgeCaches maps targets and reports memory freed', () => {
    const ctx = makeContext();
    const r = ctx.MCP.commands.purgeCaches({ target: 'snapshot' });
    expect(JSON.parse(JSON.stringify(r))).toMatchObject({ purgeTarget: 'SNAPSHOT_CACHES', memoryInUseBefore: 1000, memoryInUseAfter: 400, freedBytes: 600 });
    expect(ctx.app.purged).toEqual([5]);
  });

  it('saveVersion skips names that exist and refuses a never-saved project', () => {
    const ctx = makeContext();
    const existing = new Set(['/p/promo_v04.aep']);
    vm.runInContext('function File(p) { this.fsName = p; this.name = p.split("/").pop(); this.displayName = this.name; this.exists = __exists(p); this.parent = { fsName: p.substr(0, p.lastIndexOf("/")) }; }', ctx);
    ctx.__exists = (p: string) => existing.has(p);
    ctx.app.project.file = null;
    expect(() => ctx.MCP.commands.saveVersion({})).toThrow(/never been saved/);
    ctx.app.project.file = vm.runInContext('new File("/p/promo_v03.aep")', ctx);
    ctx.app.project.save = (f: Any) => {
      existing.add(f.fsName);
      ctx.app.project.file = vm.runInContext(`new File(${JSON.stringify(f.fsName)})`, ctx);
    };
    const r = JSON.parse(JSON.stringify(ctx.MCP.commands.saveVersion({ note: 'grade' })));
    expect(r).toMatchObject({ previousPath: '/p/promo_v03.aep', path: '/p/promo_v04_grade.aep', version: 4, saved: true });
    const r2 = JSON.parse(JSON.stringify(ctx.MCP.commands.saveVersion({})));
    expect(r2.path).toBe('/p/promo_v05.aep');
    expect(r2.skipped).toEqual([]);
    existing.add('/p/promo_v06.aep');
    const r3 = JSON.parse(JSON.stringify(ctx.MCP.commands.saveVersion({})));
    expect(r3).toMatchObject({ path: '/p/promo_v07.aep', skipped: ['/p/promo_v06.aep'] });
  });

  it('organizeProject sorts by type, reuses folders, keeps user folders, and dry-runs without changes', () => {
    const ctx = makeContext();
    const root = make(ctx, 'FolderItem', { id: 0, name: 'Root' });
    const items: Any[] = [];
    const add = (ctor: string, fields: Any) => {
      const it = make(ctx, ctor, { parentFolder: root, ...fields });
      items.push(it);
      return it;
    };
    const solids = add('FolderItem', { id: 1, name: 'Solids', numItems: 1 });
    const refs = add('FolderItem', { id: 2, name: 'References', numItems: 1 });
    add('CompItem', { id: 3, name: 'Main', usedIn: [] });
    add('CompItem', { id: 4, name: 'Card', usedIn: [{}] });
    add('FootageItem', { id: 5, name: 'Black Solid 1', mainSource: make(ctx, 'SolidSource', {}), parentFolder: solids });
    add('FootageItem', { id: 6, name: 'logo.ai', file: { name: 'logo.ai' }, mainSource: make(ctx, 'FileSource', { isStill: true }), hasVideo: true });
    add('FootageItem', { id: 7, name: 'music.wav', file: { name: 'music.wav' }, mainSource: make(ctx, 'FileSource', { isStill: false }), hasVideo: false, hasAudio: true });
    add('FootageItem', { id: 8, name: 'photo.jpg', file: { name: 'photo.jpg' }, mainSource: make(ctx, 'FileSource', { isStill: true }), hasVideo: true });
    add('FootageItem', { id: 9, name: 'clip.mov', file: { name: 'clip.mov' }, mainSource: make(ctx, 'FileSource', { isStill: false }), hasVideo: true, hasAudio: true });
    add('FootageItem', { id: 10, name: 'ref.png', file: { name: 'ref.png' }, mainSource: make(ctx, 'FileSource', { isStill: true }), hasVideo: true, parentFolder: refs });
    let nextId = 100;
    ctx.app.project = {
      rootFolder: root,
      get numItems() {
        return items.length;
      },
      item: (i: number) => items[i - 1],
      items: { addFolder: (name: string) => add('FolderItem', { id: nextId++, name, numItems: 0 }) },
    };
    const plan = JSON.parse(JSON.stringify(ctx.MCP.commands.organizeProject({ dryRun: true })));
    expect(plan.dryRun).toBe(true);
    expect(items.length).toBe(10);
    const to = Object.fromEntries((plan.moves as Any[]).map((m) => [m.item.name, m.to]));
    expect(to).toEqual({ Main: 'Comps', Card: 'Precomps', 'logo.ai': 'Vectors', 'music.wav': 'Audio', 'photo.jpg': 'Images', 'clip.mov': 'Footage' });
    expect(plan.created).toEqual(['Comps', 'Precomps', 'Vectors', 'Audio', 'Images', 'Footage']);
    expect(plan.counts.Solids).toBe(1);
    expect(plan.kept).toEqual([{ item: { id: 10, name: 'ref.png', type: 'footage' }, folder: 'References' }]);

    const done = JSON.parse(JSON.stringify(ctx.MCP.commands.organizeProject({ includeFoldered: true, folderNames: { comps: '01 Comps' } })));
    expect(done.movedCount).toBe(7);
    expect(items.find((i) => i.name === 'Main').parentFolder.name).toBe('01 Comps');
    expect(items.find((i) => i.name === 'ref.png').parentFolder.name).toBe('Images');
    expect(items.filter((i) => i.name === 'Solids').length).toBe(1);
    // A second run has nothing left to move.
    const again = JSON.parse(JSON.stringify(ctx.MCP.commands.organizeProject({ includeFoldered: true, folderNames: { comps: '01 Comps' } })));
    expect(again.movedCount).toBe(0);
    expect(again.created).toEqual([]);
  });
});
