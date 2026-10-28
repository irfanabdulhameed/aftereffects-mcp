import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog, prepareBridgeArgs } from '../../src/tools/registry.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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
  expect(res.error !== undefined || res.isError === true, `${name} ${JSON.stringify(args)}`).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

function lastCommand(): string {
  return tb.mock.state.log[tb.mock.state.log.length - 1].command;
}

function bridgeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const entry = catalog.find((c) => c.name === name);
  if (!entry) throw new Error(`no tool ${name}`);
  return prepareBridgeArgs(entry, args, tb.client);
}

const TOOLS = ['number-counter', 'grid-layout', 'proximity-effector', 'follow-chain', 'clone-array', 'shape-morph', 'wiggle-rig', 'sway-loop', 'fit-to-box'];

describe('motion-rigs: registration', () => {
  it('registers every tool with a template description of 60 to 200 words', () => {
    for (const name of TOOLS) {
      const entry = catalog.find((c) => c.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.group).toBe('motion-rigs');
      const words = entry!.description.split(/\s+/).length;
      expect(words, name).toBeGreaterThanOrEqual(60);
      expect(words, name).toBeLessThanOrEqual(200);
      const labels = ['Use when:', 'Do not use for:', 'Inputs:', 'Returns:', 'Notes:', 'Example:'].map((l) => entry!.description.indexOf(l));
      expect(labels.every((i) => i > 0), name).toBe(true);
      expect([...labels].sort((a, b) => a - b), name).toEqual(labels);
      expect(entry!.description, name).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it('describes every input field (the rule test/unit/schemas.test.ts applies to all tools)', () => {
    const described = (schema: unknown): boolean => {
      let s = schema as { description?: string; _def: Record<string, unknown> } | undefined;
      for (let i = 0; i < 8 && s; i++) {
        if (s.description) return true;
        const t = s._def.typeName as string;
        if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault') s = s._def.innerType as typeof s;
        else if (t === 'ZodEffects') s = s._def.schema as typeof s;
        else if (t === 'ZodUnion') return (s._def.options as unknown[]).some(described);
        else return ['ZodEnum', 'ZodLiteral', 'ZodBoolean', 'ZodObject', 'ZodArray', 'ZodRecord', 'ZodTuple'].includes(t);
      }
      return false;
    };
    for (const name of TOOLS) {
      const entry = catalog.find((c) => c.name === name)!;
      for (const [key, schema] of Object.entries(entry.input)) expect(described(schema), `${name}.${key}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------------
 * Round trips through the MCP server and the mock bridge.
 * ---------------------------------------------------------------------- */

describe('number-counter', () => {
  it('drives a text layer from a keyed Value slider and returns controls, keys and strings', async () => {
    const r = await callTool(client, 'number-counter', { layer: { name: 'Revenue' }, to: 12500, prefix: '$', durationFrames: 90 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('numberCounter');
    expect(r.json).toMatchObject({ from: 0, to: 12500, multiplier: 1, toText: '$12,500', fromText: '$0', startFrame: 0, endFrame: 90 });
    const controls = r.json.controls as Array<{ name: string; keys: Array<{ frame: number }> }>;
    expect(controls.map((c) => c.name)).toEqual(['Value', 'Decimals', 'Min Digits', 'Separator']);
    expect(controls[0].keys.map((k) => k.frame)).toEqual([0, 90]);
    expect(r.json.expressions).toEqual([{ property: 'Text/Source Text', enabled: true, error: '' }]);
  });

  it('passes format options through and rejects bad ones before sending', async () => {
    const a = bridgeArgs('number-counter', { to: 99.5, decimals: 1, suffix: '%', minDigits: 3, showPlus: true, tabular: true, controls: 'null', fillColor: '#3358F2' });
    expect(a).toMatchObject({ to: 99.5, decimals: 1, suffix: '%', minDigits: 3, showPlus: true, tabular: true, controls: 'null' });
    await rejectedBeforeSend('number-counter', { from: 0 });
    await rejectedBeforeSend('number-counter', { to: 10, decimals: 11 });
    await rejectedBeforeSend('number-counter', { to: 10, controls: 'effect' });
    await rejectedBeforeSend('number-counter', { to: 10, duration: 0 });
    await rejectedBeforeSend('number-counter', { to: 10, easing: 'bounce' });
  });
});

describe('grid-layout', () => {
  it('builds a grid with controls on a null and reports slots', async () => {
    const r = await callTool(client, 'grid-layout', { layers: { names: ['A', 'B', 'C', 'D', 'E', 'F'] }, columns: 3, gap: 24, animate: { control: 'columns', to: 2, startFrame: 60 } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('gridLayout');
    expect(r.json).toMatchObject({ mode: 'grid', controlLayer: { name: 'Grid Controls' }, layout: { columns: 3, rows: 2, gap: [24, 24] } });
    const layers = r.json.layers as Array<{ slot: number; col: number; row: number }>;
    expect(layers.map((l) => [l.col, l.row])).toEqual([[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2]]);
    expect((r.json.animation as Any).keys.Columns.map((k: Any) => k.frame)).toEqual([60, 78]);
  });

  it('accepts bento cells that name their layers', async () => {
    const r = await callTool(client, 'grid-layout', {
      bento: [
        { layer: { name: 'Hero' }, col: 1, row: 1, colSpan: 2, rowSpan: 2 },
        { layer: { name: 'Stat' }, col: 3, row: 1 },
        { layer: { name: 'Chart' }, col: 3, row: 2 },
      ],
      gap: [16, 16],
    });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ mode: 'bento', layout: { columns: 3, rows: 2, fit: 'contain' } });
    expect((r.json.controls as Array<{ name: string }>).map((c) => c.name)).toContain('Rows');
  });

  it('refuses incomplete or contradictory input before sending', async () => {
    await rejectedBeforeSend('grid-layout', { columns: 3 });
    await rejectedBeforeSend('grid-layout', { bento: [{ layer: { name: 'A' }, col: 1, row: 1 }, { col: 2, row: 1 }] });
    await rejectedBeforeSend('grid-layout', { bento: [{ col: 1, row: 1 }] });
    await rejectedBeforeSend('grid-layout', { layers: { all: true }, animate: { control: 'columns', to: [2, 3] } });
    await rejectedBeforeSend('grid-layout', { layers: { all: true }, animate: { control: 'cell-size', to: 200 } });
    await rejectedBeforeSend('grid-layout', { layers: { all: true }, animate: { control: 'rows', to: 2 } });
    await rejectedBeforeSend('grid-layout', { layers: { all: true }, bento: [{ col: 0, row: 1 }] });
    await rejectedBeforeSend('grid-layout', { layers: { all: true }, fit: 'fill' });
  });
});

describe('proximity-effector', () => {
  it('rigs layers to a new effector with the requested reactions and a move', async () => {
    const r = await callTool(client, 'proximity-effector', { layers: { names: ['T1', 'T2', 'T3'] }, scale: 40, blur: 12, radius: 250, animate: { from: [200, 540], to: [1720, 540], duration: 3 } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('proximityEffector');
    expect(r.json).toMatchObject({ effector: { name: 'Effector' }, effectorCreated: true, reactions: { scale: true, blur: true, opacity: false } });
    const names = (r.json.controls as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(['Radius', 'Falloff', 'Smooth Falloff', 'Invert', 'Strength', 'Scale Amount', 'Blur Amount']);
    expect((r.json.effectorKeys as Array<{ frame: number }>).map((k) => k.frame)).toEqual([0, 90]);
    expect((r.json.layers as Array<{ expressions: unknown[] }>)[0].expressions.length).toBe(2);
  });

  it('needs a reaction and keeps new-effector fields away from an existing effector', async () => {
    await rejectedBeforeSend('proximity-effector', { layers: { all: true } });
    await rejectedBeforeSend('proximity-effector', { layers: { all: true }, scale: 20, effector: { name: 'Orb' }, position: [0, 0] });
    await rejectedBeforeSend('proximity-effector', { layers: { all: true }, opacity: 150 });
    await rejectedBeforeSend('proximity-effector', { layers: { all: true }, scale: 20, falloff: 120 });
    await rejectedBeforeSend('proximity-effector', { layers: { all: true }, scale: 20, animate: { from: [0, 0] } });
  });
});

describe('follow-chain', () => {
  it('chains followers behind a leader with Delay and Decay on the leader', async () => {
    const r = await callTool(client, 'follow-chain', { leader: { name: 'Dot' }, followers: [{ name: 'Dot 2' }, { name: 'Dot 3' }], delayFrames: 4, decay: 15, properties: ['position', 'opacity'] });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('followChain');
    expect(r.json).toMatchObject({ controlLayer: { name: 'Dot' }, mode: 'offset', steps: 2 });
    expect((r.json.layers as Array<{ step: number }>).map((l) => l.step)).toEqual([1, 2]);
    expect((r.json.controls as Array<{ name: string; value: number }>).map((c) => [c.name, c.value])).toEqual([['Delay', 4], ['Decay', 15]]);
  });

  it('rejects unknown properties, decay over 100 and a missing leader before sending', async () => {
    await rejectedBeforeSend('follow-chain', { leader: { name: 'Dot' }, followers: { all: true }, properties: ['color'] });
    await rejectedBeforeSend('follow-chain', { leader: { name: 'Dot' }, followers: { all: true }, decay: 101 });
    await rejectedBeforeSend('follow-chain', { followers: { all: true } });
    await rejectedBeforeSend('follow-chain', { leader: { name: 'Dot' }, followers: { all: true }, mode: 'copy' });
  });
});

describe('clone-array', () => {
  it('makes copies in a ring and reports each copy', async () => {
    const r = await callTool(client, 'clone-array', { layer: { name: 'Dot' }, count: 11, radial: { radius: 240, orient: true }, timeOffsetFrames: 2 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('cloneArray');
    expect(r.json).toMatchObject({ mode: 'radial', copiesCreated: true, controlLayer: { name: 'Dot Array' } });
    const layers = r.json.layers as Array<{ copy: number }>;
    expect(layers.length).toBe(12);
    expect(layers[0].copy).toBe(0);
    expect((r.json.controls as Array<{ name: string }>).map((c) => c.name)).toContain('Angle Step');
  });

  it('needs exactly one of count and copies, and no row step in ring mode', async () => {
    await rejectedBeforeSend('clone-array', { layer: { name: 'Dot' } });
    await rejectedBeforeSend('clone-array', { layer: { name: 'Dot' }, count: 3, copies: [{ name: 'Dot 2' }] });
    await rejectedBeforeSend('clone-array', { layer: { name: 'Dot' }, count: 201 });
    await rejectedBeforeSend('clone-array', { layer: { name: 'Dot' }, count: 3, radial: { radius: 100 }, positionStep: [50, 0] });
  });
});

describe('shape-morph', () => {
  it('keys the from path into the to shape and reports the match', async () => {
    const r = await callTool(client, 'shape-morph', { from: { layer: { name: 'Play' } }, to: { layer: { name: 'Pause' } }, durationFrames: 18 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('shapeMorph');
    expect(r.json).toMatchObject({ vertexCount: 8, subdivided: { path: 'from', added: 4 }, space: 'comp', endFrame: 18, to: { hidden: 'layer' } });
    expect((r.json.keys as unknown[]).length).toBe(2);
  });

  it('refuses overshoot and bad modes before sending', async () => {
    await rejectedBeforeSend('shape-morph', { from: { layer: { name: 'A' } }, to: { layer: { name: 'B' } }, easing: 'overshoot' });
    await rejectedBeforeSend('shape-morph', { from: { layer: { name: 'A' } }, to: { layer: { name: 'B' } }, space: 'world' });
    await rejectedBeforeSend('shape-morph', { from: { layer: { name: 'A' } } });
  });
});

describe('wiggle-rig, sway-loop and fit-to-box', () => {
  it('wiggle-rig returns amounts per property and a Strength ramp', async () => {
    const r = await callTool(client, 'wiggle-rig', { layers: { names: ['Card 1', 'Card 2'] }, properties: ['position', 'rotation'], frequency: 0.5, positionAmount: 8, loop: 4, rampIn: { startFrame: 0, durationFrames: 30 } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('wiggleRig');
    expect((r.json.controls as Array<{ name: string }>).map((c) => c.name)).toEqual(['Frequency', 'Position Amount', 'Rotation Amount', 'Loop Seconds', 'Seed', 'Strength']);
    expect((r.json.rampIn as Any).keys.map((k: Any) => k.value)).toEqual([0, 100]);
    await rejectedBeforeSend('wiggle-rig', { layers: { all: true }, axes: 'z' });
    await rejectedBeforeSend('wiggle-rig', { layers: { all: true }, properties: ['color'] });
  });

  it('sway-loop returns a phase per layer', async () => {
    const r = await callTool(client, 'sway-loop', { layers: { names: ['Card A', 'Card B', 'Card C'] }, sway: [0, 10], rotation: 1.5, period: 5, phaseStep: 90 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('swayLoop');
    expect((r.json.layers as Array<{ phase: number }>).map((l) => l.phase)).toEqual([0, 1, 2]);
    expect((r.json.controls as Array<{ name: string }>).map((c) => c.name)).toContain('Sway Rotation');
    await rejectedBeforeSend('sway-loop', { layers: { all: true }, period: 0 });
  });

  it('fit-to-box returns the scale each layer gets now', async () => {
    const r = await callTool(client, 'fit-to-box', { layers: [{ name: 'Logo' }], size: [320, 120] });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('fitToBox');
    expect(r.json).toMatchObject({ controlLayer: { name: 'Logo' }, mode: 'contain' });
    expect((r.json.layers as Array<{ scaleNow: number }>)[0].scaleNow).toBe(50);
    await rejectedBeforeSend('fit-to-box', { layers: { all: true }, size: [0, 100] });
    await rejectedBeforeSend('fit-to-box', { layers: { all: true } });
  });
});

/* ------------------------------------------------------------------------
 * motion-rigs.jsx in a Node vm against fake compositions, layers and
 * properties. These check what the commands write and that refused calls
 * change nothing.
 * ---------------------------------------------------------------------- */

const SCRIPTS = path.resolve(__dirname, '..', '..', 'src', 'scripts');
const PT = { PROPERTY: 6212, NAMED_GROUP: 6213, INDEXED_GROUP: 6214 };
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
const PVT = { NO_VALUE: 6412, ThreeD_SPATIAL: 6413, ThreeD: 6414, TwoD_SPATIAL: 6415, TwoD: 6416, OneD: 6417, COLOR: 6418, CUSTOM_VALUE: 6419, MARKER: 6420, LAYER_INDEX: 6421, MASK_INDEX: 6422, SHAPE: 6423, TEXT_DOCUMENT: 6424 };

const clone = <T>(v: T): T => (Array.isArray(v) ? (v.map((x) => clone(x)) as unknown as T) : v);

function interp(keys: Any[], t: number): unknown {
  if (t <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (t >= last.time) return last.value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.time && t <= b.time) {
      const u = (t - a.time) / (b.time - a.time);
      if (typeof a.value === 'number') return a.value + (b.value - a.value) * u;
      if (Array.isArray(a.value)) return a.value.map((x: number, j: number) => x + (b.value[j] - x) * u);
      return a.value;
    }
  }
  return last.value;
}

function vtOf(v: unknown): number {
  if (Array.isArray(v)) return v.length === 4 ? PVT.COLOR : v.length === 3 ? PVT.ThreeD : PVT.TwoD;
  if (typeof v === 'number') return PVT.OneD;
  return PVT.CUSTOM_VALUE;
}

function link(parent: Any, child: Any) {
  child.parentProperty = parent;
  Object.defineProperty(child, 'propertyIndex', { configurable: true, get: () => parent.children.indexOf(child) + 1 });
  Object.defineProperty(child, 'propertyDepth', { configurable: true, get: () => parent.propertyDepth + 1 });
}

function leaf(ctx: Any, name: string, matchName: string, value: unknown, opts: Any = {}): Any {
  const keys: Any[] = [];
  const p: Any = {
    name,
    matchName,
    propertyType: PT.PROPERTY,
    propertyValueType: opts.vt ?? vtOf(value),
    isSpatial: !!opts.spatial,
    canSetExpression: opts.canSetExpression !== false,
    canVaryOverTime: true,
    expression: '',
    expressionEnabled: true,
    expressionError: '',
    dimensionsSeparated: false,
    enabled: true,
    _value: value,
    keys,
    setValue(v: unknown) {
      if (keys.length) throw new Error(`setValue on keyed '${name}'`);
      p._value = v;
    },
    setValueAtTime(t: number, v: unknown) {
      const at = keys.findIndex((k) => Math.abs(k.time - t) < 1e-6);
      const k = { time: t, value: v, inType: KIT.LINEAR, outType: KIT.LINEAR, inEase: [new ctx.KeyframeEase(0, 16.67)], outEase: [new ctx.KeyframeEase(0, 16.67)] };
      if (at >= 0) keys[at] = k;
      else keys.push(k);
      keys.sort((a, b) => a.time - b.time);
    },
    valueAtTime: (t: number) => (keys.length ? interp(keys, t) : p._value),
    keyTime: (i: number) => keys[i - 1].time,
    keyValue: (i: number) => keys[i - 1].value,
    nearestKeyIndex(t: number) {
      let best = 1;
      keys.forEach((k, i) => {
        if (Math.abs(k.time - t) < Math.abs(keys[best - 1].time - t)) best = i + 1;
      });
      return best;
    },
    removeKey: (i: number) => keys.splice(i - 1, 1),
    keyInInterpolationType: (i: number) => keys[i - 1].inType,
    keyOutInterpolationType: (i: number) => keys[i - 1].outType,
    setInterpolationTypeAtKey(i: number, a: number, b: number) {
      keys[i - 1].inType = a;
      keys[i - 1].outType = b ?? a;
    },
    keyInTemporalEase: (i: number) => keys[i - 1].inEase,
    keyOutTemporalEase: (i: number) => keys[i - 1].outEase,
    setTemporalEaseAtKey(i: number, a: unknown[], b: unknown[]) {
      keys[i - 1].inEase = a;
      keys[i - 1].outEase = b ?? a;
    },
    setTemporalAutoBezierAtKey() {},
    setTemporalContinuousAtKey() {},
    keyTemporalContinuous: () => false,
    keyTemporalAutoBezier: () => false,
    keySelected: () => false,
    setSpatialAutoBezierAtKey() {},
    setSpatialContinuousAtKey() {},
    setSpatialTangentsAtKey() {},
    keyInSpatialTangent: () => [0, 0],
    keyOutSpatialTangent: () => [0, 0],
    keySpatialContinuous: () => false,
    keySpatialAutoBezier: () => false,
    keyRoving: () => false,
    propertyGroup(n: number) {
      let q: Any = p;
      for (let i = 0; i < n; i++) q = q.parentProperty;
      return q;
    },
  };
  Object.defineProperty(p, 'numKeys', { get: () => keys.length });
  Object.defineProperty(p, 'value', { get: () => (keys.length ? interp(keys, 0) : p._value) });
  return p;
}

function grp(name: string, matchName: string, children: Any[] = [], factory?: (mn: string) => Any | null, indexed = false): Any {
  const g: Any = { name, matchName, propertyType: indexed ? PT.INDEXED_GROUP : PT.NAMED_GROUP, enabled: true, children };
  Object.defineProperty(g, 'numProperties', { get: () => children.length });
  g.property = (x: number | string) => (typeof x === 'number' ? children[x - 1] ?? null : children.find((c) => c.matchName === x) ?? children.find((c) => c.name === x) ?? null);
  g.canAddProperty = (mn: string) => !!factory && factory(mn) !== null;
  g.addProperty = (mn: string) => {
    const c = factory ? factory(mn) : null;
    if (!c) throw new Error(`cannot add ${mn}`);
    children.push(c);
    link(g, c);
    return c;
  };
  children.forEach((c) => link(g, c));
  return g;
}

const CONTROL_PARAMS: Record<string, [string, string, unknown]> = {
  'ADBE Slider Control': ['Slider Control', 'Slider', 0],
  'ADBE Checkbox Control': ['Checkbox Control', 'Checkbox', 0],
  'ADBE Point Control': ['Point Control', 'Point', [640, 360]],
  'ADBE Angle Control': ['Angle Control', 'Angle', 0],
};

function makeAE(version = '26.5.0') {
  const ctx = {
    MCP_BRIDGE_VERSION: 'test',
    PropertyType: PT,
    KeyframeInterpolationType: KIT,
    PropertyValueType: PVT,
    ParagraphJustification: { LEFT_JUSTIFY: 7413, RIGHT_JUSTIFY: 7414, CENTER_JUSTIFY: 7415 },
    KeyframeEase: function (this: Any, speed: number, influence: number) {
      this.speed = speed;
      this.influence = influence;
    },
    console,
  } as unknown as vm.Context & Any;
  vm.createContext(ctx);
  vm.runInContext(
    ['CompItem', 'AVLayer', 'TextLayer', 'ShapeLayer', 'CameraLayer', 'LightLayer', 'MarkerValue', 'FolderItem', 'FootageItem'].map((c) => `function ${c}() {}`).join('\n') +
      '\nfunction Shape() { this.vertices = []; this.inTangents = []; this.outTangents = []; this.closed = true; }' +
      '\nfunction TextDocument(t) { this.text = t; this.fontSize = 72; }',
    ctx
  );
  ctx.app = { version, project: { activeItem: null, numItems: 0, item: () => null } };
  for (const f of ['polyfills.jsx', 'json.jsx', 'core.jsx', 'color.jsx', 'undo.jsx', 'resolve.jsx', 'serialize.jsx', 'easing.jsx']) {
    vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'lib', f), 'utf8'), ctx, { filename: f });
  }
  for (const f of ['effects.jsx', 'expressions.jsx', 'keyframes.jsx', 'shapes.jsx', 'masks.jsx', 'text.jsx', 'layers.jsx', 'animate.jsx', 'motion-rigs.jsx']) {
    vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'commands', f), 'utf8'), ctx, { filename: f });
  }

  const effectFactory = (mn: string): Any | null => {
    const c = CONTROL_PARAMS[mn];
    if (c) return grp(c[0], mn, [leaf(ctx, c[1], `${mn}-0001`, clone(c[2]), { spatial: c[1] === 'Point' })], undefined, true);
    if (mn === 'ADBE Gaussian Blur 2') {
      return grp('Gaussian Blur', mn, [leaf(ctx, 'Blurriness', `${mn}-0001`, 25), leaf(ctx, 'Blur Dimensions', `${mn}-0002`, 1), leaf(ctx, 'Repeat Edge Pixels', `${mn}-0003`, 1)], undefined, true);
    }
    return null;
  };
  const newShape = (v: number[][], closed = true, ins?: number[][], outs?: number[][]) => {
    const s = vm.runInContext('new Shape()', ctx) as Any;
    s.vertices = v;
    s.inTangents = ins ?? v.map(() => [0, 0]);
    s.outTangents = outs ?? v.map(() => [0, 0]);
    s.closed = closed;
    return s;
  };
  const vectorFactory = (mn: string): Any | null => {
    if (mn === 'ADBE Vector Group') {
      return grp('Group 1', mn, [
        grp('Contents', 'ADBE Vectors Group', [], vectorFactory, true),
        grp('Transform', 'ADBE Vector Transform Group', [
          leaf(ctx, 'Anchor Point', 'ADBE Vector Anchor', [0, 0]),
          leaf(ctx, 'Position', 'ADBE Vector Position', [0, 0]),
          leaf(ctx, 'Scale', 'ADBE Vector Scale', [100, 100]),
          leaf(ctx, 'Skew', 'ADBE Vector Skew', 0),
          leaf(ctx, 'Rotation', 'ADBE Vector Rotation', 0),
        ]),
      ]);
    }
    if (mn === 'ADBE Vector Shape - Rect') return grp('Rectangle Path 1', mn, [leaf(ctx, 'Size', 'ADBE Vector Rect Size', [100, 100]), leaf(ctx, 'Position', 'ADBE Vector Rect Position', [0, 0]), leaf(ctx, 'Roundness', 'ADBE Vector Rect Roundness', 0)]);
    if (mn === 'ADBE Vector Shape - Ellipse') return grp('Ellipse Path 1', mn, [leaf(ctx, 'Size', 'ADBE Vector Ellipse Size', [100, 100]), leaf(ctx, 'Position', 'ADBE Vector Ellipse Position', [0, 0])]);
    if (mn === 'ADBE Vector Shape - Star') {
      return grp('Polystar Path 1', mn, [
        leaf(ctx, 'Type', 'ADBE Vector Star Type', 1),
        leaf(ctx, 'Points', 'ADBE Vector Star Points', 5),
        leaf(ctx, 'Position', 'ADBE Vector Star Position', [0, 0]),
        leaf(ctx, 'Rotation', 'ADBE Vector Star Rotation', 0),
        leaf(ctx, 'Inner Radius', 'ADBE Vector Star Inner Radius', 25),
        leaf(ctx, 'Outer Radius', 'ADBE Vector Star Outer Radius', 50),
      ]);
    }
    if (mn === 'ADBE Vector Shape - Group') return grp('Path 1', mn, [leaf(ctx, 'Path', 'ADBE Vector Shape', newShape([[0, 0], [10, 0]]), { vt: PVT.SHAPE })]);
    if (mn === 'ADBE Vector Graphic - Stroke') return grp('Stroke 1', mn, [leaf(ctx, 'Color', 'ADBE Vector Stroke Color', [1, 1, 1, 1]), leaf(ctx, 'Stroke Width', 'ADBE Vector Stroke Width', 2)]);
    if (mn === 'ADBE Vector Graphic - Fill') return grp('Fill 1', mn, [leaf(ctx, 'Color', 'ADBE Vector Fill Color', [1, 1, 1, 1])]);
    return null;
  };

  const comp = vm.runInContext('new CompItem()', ctx) as Any;
  Object.assign(comp, { id: 1, name: 'Main Comp', width: 1920, height: 1080, pixelAspect: 1, frameDuration: 1 / 30, frameRate: 30, duration: 10, time: 0, selectedLayers: [] });
  const layers: Any[] = [];
  Object.defineProperty(comp, 'numLayers', { get: () => layers.length });
  comp.layer = (i: number) => layers[i - 1];
  ctx.app.project.activeItem = comp;
  let nextId = 500;

  const transformGroup = (threeD: boolean) =>
    grp('Transform', 'ADBE Transform Group', [
      leaf(ctx, 'Anchor Point', 'ADBE Anchor Point', threeD ? [0, 0, 0] : [0, 0], { spatial: true }),
      leaf(ctx, 'Position', 'ADBE Position', threeD ? [960, 540, 0] : [960, 540], { spatial: true }),
      leaf(ctx, 'X Position', 'ADBE Position_0', 960),
      leaf(ctx, 'Y Position', 'ADBE Position_1', 540),
      leaf(ctx, 'Z Position', 'ADBE Position_2', 0),
      leaf(ctx, 'Scale', 'ADBE Scale', threeD ? [100, 100, 100] : [100, 100]),
      leaf(ctx, 'X Rotation', 'ADBE Rotate X', 0),
      leaf(ctx, 'Y Rotation', 'ADBE Rotate Y', 0),
      leaf(ctx, 'Rotation', 'ADBE Rotate Z', 0),
      leaf(ctx, 'Opacity', 'ADBE Opacity', 100),
    ]);

  function makeLayer(cls: string, name: string, opts: Any = {}): Any {
    const L = vm.runInContext(`new ${cls}()`, ctx) as Any;
    let threeD = !!opts.threeD;
    Object.assign(L, { name, locked: false, enabled: true, parent: null, nullLayer: !!opts.isNull, inPoint: 0, outPoint: comp.duration, startTime: 0, guideLayer: false, containingComp: comp, propertyDepth: 0, id: nextId++ });
    L.rect = opts.rect ?? { left: -50, top: -50, width: 100, height: 100 };
    L.sourceRectAtTime = () => ({ ...L.rect });
    const groups: Any[] = [transformGroup(threeD)];
    if (cls !== 'CameraLayer' && cls !== 'LightLayer') groups.push(grp('Effects', 'ADBE Effect Parade', [], effectFactory, true));
    if (cls === 'TextLayer') groups.push(grp('Text', 'ADBE Text Properties', [leaf(ctx, 'Source Text', 'ADBE Text Document', vm.runInContext(`new TextDocument(${JSON.stringify(opts.text ?? name)})`, ctx), { vt: PVT.TEXT_DOCUMENT })]));
    if (cls === 'ShapeLayer') groups.push(grp('Contents', 'ADBE Root Vectors Group', [], vectorFactory, true));
    L.children = groups;
    groups.forEach((g) => link(L, g));
    L.property = (x: number | string) => (typeof x === 'number' ? groups[x - 1] ?? null : groups.find((g) => g.matchName === x || g.name === x) ?? null);
    Object.defineProperty(L, 'index', { configurable: true, get: () => layers.indexOf(L) + 1 });
    Object.defineProperty(L, 'threeDLayer', {
      configurable: true,
      get: () => threeD,
      set: (v: boolean) => {
        threeD = !!v;
        const tg = groups[0];
        for (const mn of ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale']) {
          const p = tg.property(mn);
          const val = p._value as number[];
          p._value = threeD ? [val[0], val[1], val[2] ?? (mn === 'ADBE Scale' ? 100 : 0)] : [val[0], val[1]];
        }
      },
    });
    L.canSetTimeRemapEnabled = !!opts.hasSource;
    let remap = false;
    Object.defineProperty(L, 'timeRemapEnabled', {
      get: () => remap,
      set: (v: boolean) => {
        remap = v;
        if (v && !groups.find((g) => g.matchName === 'ADBE Time Remapping')) {
          const tr = leaf(ctx, 'Time Remap', 'ADBE Time Remapping', 0);
          groups.push(tr);
          link(L, tr);
        }
      },
    });
    L.moveAfter = (other: Any) => {
      layers.splice(layers.indexOf(L), 1);
      layers.splice(layers.indexOf(other) + 1, 0, L);
    };
    L.moveToBeginning = () => {
      layers.splice(layers.indexOf(L), 1);
      layers.unshift(L);
    };
    L.duplicate = () => {
      const D = makeLayer(cls, `${L.name} 2`, { ...opts, threeD });
      layers.splice(layers.indexOf(D), 1);
      layers.splice(layers.indexOf(L), 0, D);
      D.rect = { ...L.rect };
      const src = groups[0];
      const dst = D.property('ADBE Transform Group');
      src.children.forEach((p: Any, i: number) => {
        dst.children[i]._value = clone(p._value);
        p.keys.forEach((k: Any) => dst.children[i].keys.push({ ...k, value: clone(k.value) }));
      });
      D.parent = L.parent;
      return D;
    };
    layers.unshift(L);
    return L;
  }

  comp.layers = {
    addNull: () => {
      const L = makeLayer('AVLayer', 'Null 1', { isNull: true, rect: { left: 0, top: 0, width: 100, height: 100 } });
      L.property('ADBE Transform Group').property('ADBE Anchor Point')._value = [50, 50];
      return L;
    },
    addShape: () => makeLayer('ShapeLayer', 'Shape Layer 1'),
    addText: (t: string) => makeLayer('TextLayer', t, { text: t }),
  };

  return { ctx, comp, layers, makeLayer, newShape };
}

const tr = (L: Any, mn: string) => L.property('ADBE Transform Group').property(mn);
const fxNames = (L: Any) => L.property('ADBE Effect Parade').children.map((e: Any) => e.name);
const control = (L: Any, name: string) => L.property('ADBE Effect Parade').children.find((e: Any) => e.name === name)?.property(1);

/** A shape layer with one group holding one Bezier path (or a rectangle). */
function shapeLayer(ae: ReturnType<typeof makeAE>, name: string, content: { path?: Any; rect?: number[]; groupName?: string; pathName?: string }[]): Any {
  const L = ae.makeLayer('ShapeLayer', name);
  for (const c of content) {
    const g = L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    g.name = c.groupName ?? 'Group 1';
    const items = g.property('ADBE Vectors Group');
    if (c.rect) {
      const r = items.addProperty('ADBE Vector Shape - Rect');
      r.property('ADBE Vector Rect Size')._value = c.rect;
    } else {
      const p = items.addProperty('ADBE Vector Shape - Group');
      if (c.pathName) p.name = c.pathName;
      p.property('ADBE Vector Shape')._value = c.path;
    }
    items.addProperty('ADBE Vector Graphic - Fill');
  }
  return L;
}

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('motion-rigs.jsx: pure helpers in a vm', () => {
  const { ctx } = makeAE();
  const R = ctx.MCP.mrig;

  it('formatNumber groups, pads, signs and rounds', () => {
    const o = (over: Any = {}) => ({ decimals: 0, minDigits: 0, group: true, sep: ',', point: '.', prefix: '', suffix: '', plus: false, ...over });
    expect(R.formatNumber(1234567, o())).toBe('1,234,567');
    expect(R.formatNumber(1234.56, o({ decimals: 1, prefix: '$' }))).toBe('$1,234.6');
    expect(R.formatNumber(7, o({ minDigits: 3 }))).toBe('007');
    expect(R.formatNumber(-0.0004, o({ decimals: 2 }))).toBe('0.00');
    expect(R.formatNumber(-12.5, o({ decimals: 1, suffix: '%' }))).toBe('-12.5%');
    expect(R.formatNumber(42, o({ plus: true, suffix: 'k' }))).toBe('+42k');
    expect(R.formatNumber(1234567.891, o({ decimals: 2, sep: '.', point: ',' }))).toBe('1.234.567,89');
    expect(R.formatNumber(1234567, o({ group: false }))).toBe('1234567');
  });

  it('affine helpers invert and compose', () => {
    const M = R.trs([100, 50], 30, [200, 50], [10, 20]);
    const inv = R.inv(M);
    const p = R.apply(M, [3, 4]);
    const back = R.apply(inv, p);
    expect(back[0]).toBeCloseTo(3, 9);
    expect(back[1]).toBeCloseTo(4, 9);
    expect(R.apply(M, [10, 20])).toEqual([100, 50]);
    expect(R.inv([0, 0, 0, 1, 0, 0])).toBeNull();
  });

  it('subdivide keeps the shape and every original vertex', () => {
    const square = { v: [[0, 0], [100, 0], [100, 100], [0, 100]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], closed: true };
    const s = R.subdivide(square, 5);
    expect(s.v.length).toBe(9);
    for (const corner of square.v) expect(s.v.some((v: number[]) => Math.abs(v[0] - corner[0]) < 1e-9 && Math.abs(v[1] - corner[1]) < 1e-9)).toBe(true);
    for (const v of s.v) expect(v[0] === 0 || v[0] === 100 || v[1] === 0 || v[1] === 100).toBe(true);
    // a curved path: points sampled on the subdivided curve lie on the original curve
    const circle = R.ellipsePath([0, 0], 50, 50);
    const c2 = R.subdivide(circle, 6);
    expect(c2.v.length).toBe(10);
    for (let j = 0; j < c2.v.length; j++) {
      const seg = R.segment(c2, j);
      for (const t of [0.25, 0.5, 0.75]) {
        const q = R.cubicPoint(seg, t);
        expect(Math.abs(Math.hypot(q[0], q[1]) - 50)).toBeLessThan(0.2);
      }
    }
    const open = { v: [[0, 0], [100, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]], closed: false };
    // a straight edge with no handles: new vertices spread by length, not by curve parameter
    const o2 = R.subdivide(open, 3);
    expect(o2.v.length).toBe(5);
    [0, 25, 50, 75, 100].forEach((x, k) => {
      expect(o2.v[k][0]).toBeCloseTo(x, 0);
      expect(o2.v[k][1]).toBe(0);
    });
  });

  it('matchPaths finds the start vertex and the direction', () => {
    const a = { v: [[0, -50], [50, 0], [0, 50], [-50, 0]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], closed: true };
    const shifted = R.shiftPath(a, 2);
    const m = R.matchPaths(a, shifted);
    expect(m.cost).toBeCloseTo(0, 6);
    expect(plain(m.path.v)).toEqual(a.v);
    const rev = R.reversePath(a);
    const m2 = R.matchPaths(a, rev);
    expect(m2.cost).toBeCloseTo(0, 6);
    expect(plain(m2.path.v)).toEqual(a.v);
  });

  it('rectPath, ellipsePath and star or polygon types', () => {
    const r = R.rectPath([0, 0], [200, 100], 0);
    expect(plain(r.v)).toEqual([[100, -50], [100, 50], [-100, 50], [-100, -50]]);
    const rr = R.rectPath([0, 0], [200, 100], 20);
    expect(rr.v.length).toBe(8);
    expect(plain(rr.v[0])).toEqual([80, -50]);
    const ae = makeAE();
    const star = ae.ctx.MCP.mrig;
    const L = ae.makeLayer('ShapeLayer', 'S');
    const g = L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    const item = g.property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Star');
    expect(star.itemPath(item, 0, []).v.length).toBe(10); // Type 1 = Star: 5 outer + 5 inner points
    item.property('ADBE Vector Star Type')._value = 2; // Type 2 = Polygon
    expect(star.itemPath(item, 0, []).v.length).toBe(5);
  });

  it('gridCell fills rows or columns and reverses', () => {
    expect(plain(R.gridCell(4, 6, 3, false, false))).toEqual({ col: 2, row: 2 });
    expect(plain(R.gridCell(4, 6, 3, true, false))).toEqual({ col: 3, row: 1 });
    expect(plain(R.gridCell(0, 6, 3, false, true))).toEqual({ col: 3, row: 2 });
  });
});

describe('motion-rigs.jsx commands in a vm', () => {
  it('numberCounter puts the controls on the text layer, keys Value and sets the expression', () => {
    const ae = makeAE();
    const T = ae.makeLayer('TextLayer', 'Revenue', { text: '0' });
    const r = plain(ae.ctx.MCP.commands.numberCounter({ layer: { name: 'Revenue' }, to: 12500, prefix: '$', durationFrames: 60 }, {}));
    expect(r.controlLayer.name).toBe('Revenue');
    expect(fxNames(T)).toEqual(['Value', 'Decimals', 'Min Digits', 'Separator']);
    const v = control(T, 'Value');
    expect(v.keys.map((k: Any) => [k.time, k.value])).toEqual([[0, 0], [2, 12500]]);
    expect(v.keys[1].inEase[0].influence).toBe(100);
    expect(v.keys[0].outEase[0].influence).toBe(25);
    const src = T.property('ADBE Text Properties').property('ADBE Text Document');
    expect(src.expression).toContain('var C = thisLayer;');
    expect(r.toText).toBe('$12,500');
    expect(r.expressionCode['Text/Source Text']).toBe(src.expression);
  });

  it('numberCounter creates a text layer and a control null, and uses a multiplier past one million', () => {
    const ae = makeAE();
    const r = plain(ae.ctx.MCP.commands.numberCounter({ to: 25000000, controls: 'null', suffix: ' users' }, {}));
    expect(r.layerCreated).toBe(true);
    expect(r.multiplier).toBe(100);
    expect(r.controlLayerCreated).toBe(true);
    expect(r.controlLayer.name).toBe('Counter Controls');
    const host = ae.layers.find((L) => L.name === 'Counter Controls');
    expect(control(host, 'Value').keys[1].value).toBe(250000);
    const text = ae.layers.find((L) => L.name === 'Counter');
    expect(text.property('ADBE Text Properties').property('ADBE Text Document').expression).toContain('thisComp.layer("Counter Controls")');
  });

  it('numberCounter refuses a non-text layer and a conflicting effect name before changing anything', () => {
    const ae = makeAE();
    const S = ae.makeLayer('ShapeLayer', 'Box');
    expect(() => ae.ctx.MCP.commands.numberCounter({ layer: { name: 'Box' }, to: 5 }, {})).toThrow(/not a text layer/);
    const T = ae.makeLayer('TextLayer', 'Score');
    const blur = T.property('ADBE Effect Parade').addProperty('ADBE Gaussian Blur 2');
    blur.name = 'Decimals';
    expect(() => ae.ctx.MCP.commands.numberCounter({ layer: { name: 'Score' }, to: 5 }, {})).toThrow(/already has an effect named 'Decimals'/);
    expect(fxNames(T)).toEqual(['Decimals']);
    expect(ae.layers.length).toBe(2);
    expect(fxNames(S)).toEqual([]);
  });

  it('gridLayout makes Grid Controls, sets Position on every cell and keys a reflow', () => {
    const ae = makeAE();
    for (const n of ['A', 'B', 'C', 'D', 'E']) ae.makeLayer('AVLayer', n);
    const r = plain(ae.ctx.MCP.commands.gridLayout({ layers: { names: ['A', 'B', 'C', 'D', 'E'] }, order: 'as-given', columns: 3, cellSize: [200, 120], gap: 20, animate: { control: 'columns', to: 2, startFrame: 30, durationFrames: 18 } }));
    const host = ae.layers.find((L) => L.name === 'Grid Controls');
    expect(host).toBeDefined();
    expect(fxNames(host)).toEqual(['Columns', 'Cell Width', 'Cell Height', 'Gap X', 'Gap Y', 'Origin', 'Center On Origin', 'Column First', 'Reverse Order']);
    // The Origin point sits on the null's anchor, so C.toComp(Origin) is the composition centre.
    expect(plain(control(host, 'Origin').value)).toEqual([50, 50]);
    expect(r.layers.map((l: Any) => [l.col, l.row])).toEqual([[1, 1], [2, 1], [3, 1], [1, 2], [2, 2]]);
    for (const n of ['A', 'B', 'C', 'D', 'E']) {
      const L = ae.layers.find((x) => x.name === n);
      expect(tr(L, 'ADBE Position').expression).toContain('var n = 5, slot = ');
    }
    expect(control(host, 'Columns').keys.map((k: Any) => [Math.round(k.time * 30), k.value])).toEqual([[30, 3], [48, 2]]);
    expect(r.expressionErrors).toBe(0);
    expect(r.count).toBe(5);
  });

  it('gridLayout fills a lone rectangle through its Size and other layers through Scale', () => {
    const ae = makeAE();
    const box = shapeLayer(ae, 'Box', [{ rect: [100, 100] }]);
    const photo = ae.makeLayer('AVLayer', 'Photo');
    const r = plain(ae.ctx.MCP.commands.gridLayout({ bento: [{ layer: { name: 'Box' }, col: 1, row: 1, colSpan: 2 }, { layer: { name: 'Photo' }, col: 3, row: 1 }] }));
    expect(r.mode).toBe('bento');
    const size = box.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(1).property('ADBE Vector Rect Size');
    expect(size.expression).toContain('var sw = 2 * cw + 1 * gx');
    expect(tr(photo, 'ADBE Scale').expression).toContain('var mode = "contain";');
    expect(r.layers.map((l: Any) => l.fill)).toEqual(['rectangle size', 'scale (contain)']);
  });

  it('gridLayout refuses a bad reflow before adding the control null', () => {
    const ae = makeAE();
    ae.makeLayer('AVLayer', 'A');
    ae.makeLayer('AVLayer', 'B');
    expect(() => ae.ctx.MCP.commands.gridLayout({ layers: { all: true }, animate: { control: 'rows', to: 2 } })).toThrow(/bento control/);
    expect(() => ae.ctx.MCP.commands.gridLayout({ layers: { all: true }, animate: { control: 'cell-size', to: 5 } })).toThrow(/\[x, y\]/);
    expect(ae.layers.length).toBe(2);
    expect(tr(ae.layers[0], 'ADBE Position').expression).toBe('');
  });

  it('proximityEffector adds the effector, a sharp Effector Blur and the reaction expressions', () => {
    const ae = makeAE();
    const a = ae.makeLayer('AVLayer', 'Tile 1');
    ae.makeLayer('AVLayer', 'Tile 2');
    const r = plain(ae.ctx.MCP.commands.proximityEffector({ layers: { names: ['Tile 1', 'Tile 2'] }, scale: 40, blur: 12, offset: [0, -20], animate: { to: [1700, 540], durationFrames: 60 } }));
    const eff = ae.layers.find((L) => L.name === 'Effector');
    expect(eff.threeDLayer).toBe(false);
    expect(fxNames(eff)).toEqual(['Radius', 'Falloff', 'Smooth Falloff', 'Invert', 'Strength', 'Scale Amount', 'Blur Amount', 'Offset X', 'Offset Y']);
    expect(control(eff, 'Radius').value).toBe(300);
    expect(control(eff, 'Smooth Falloff').value).toBe(1);
    const blur = a.property('ADBE Effect Parade').property('Effector Blur');
    expect(blur.property(1).value).toBe(0); // a new Gaussian Blur starts at 25 on recent versions
    expect(blur.property(1).expression).toContain('base + w * C.effect("Blur Amount")(1).value;');
    expect(tr(a, 'ADBE Position').expression).toContain('var P = base;');
    expect(tr(a, 'ADBE Scale').expression).toContain('var P = transform.position.value;');
    expect(r.layers[0].expressions.map((e: Any) => e.property)).toEqual(['Effects/Effector Blur/Blurriness', 'Transform/Scale', 'Transform/Position']);
    expect(tr(eff, 'ADBE Position').keys.length).toBe(2);
  });

  it('proximityEffector makes a 3D effector for 3D layers, skips itself and leaves separated positions alone', () => {
    const ae = makeAE();
    const t3 = ae.makeLayer('AVLayer', 'Card', { threeD: true });
    const sep = ae.makeLayer('AVLayer', 'Sep');
    tr(sep, 'ADBE Position').dimensionsSeparated = true;
    const orb = ae.makeLayer('AVLayer', 'Orb', { isNull: true });
    const r = plain(ae.ctx.MCP.commands.proximityEffector({ layers: { all: true }, effector: { name: 'Orb' }, offset: [0, 0, -200] }));
    expect(r.effectorCreated).toBe(false);
    expect(r.skipped.map((s: Any) => s.reason)).toEqual(['it is the effector']);
    expect(tr(t3, 'ADBE Position').expression).toContain('parent.toWorld(P)');
    expect(r.layers.find((l: Any) => l.layer.name === 'Sep').notes[0]).toMatch(/separated/);
    expect(fxNames(orb)).toContain('Offset Z');
  });

  it('followChain keeps controls on the leader and writes one expression per property and follower', () => {
    const ae = makeAE();
    const lead = ae.makeLayer('ShapeLayer', 'Dot');
    const f1 = ae.makeLayer('ShapeLayer', 'Dot 2');
    const f2 = ae.makeLayer('ShapeLayer', 'Dot 3');
    const r = plain(ae.ctx.MCP.commands.followChain({ leader: { name: 'Dot' }, followers: [{ name: 'Dot 2' }, { name: 'Dot 3' }, { name: 'Dot' }], properties: ['position', 'scale'], delayFrames: 4 }));
    expect(fxNames(lead)).toEqual(['Delay', 'Decay']);
    expect(control(lead, 'Delay').value).toBe(4);
    expect(r.skipped.length).toBe(1);
    expect(tr(f1, 'ADBE Position').expression).toContain('var k = 1;');
    expect(tr(f2, 'ADBE Position').expression).toContain('var k = 2;');
    expect(tr(f2, 'ADBE Scale').expression).toContain('follow(me, lead, rest)');
  });

  it('followChain follows in composition space when the follower has another parent', () => {
    const ae = makeAE();
    ae.makeLayer('AVLayer', 'Lead');
    const holder = ae.makeLayer('AVLayer', 'Holder', { isNull: true });
    const f = ae.makeLayer('AVLayer', 'Tail');
    f.parent = holder;
    const r = plain(ae.ctx.MCP.commands.followChain({ leader: { name: 'Lead' }, followers: [{ name: 'Tail' }], mode: 'absolute' }));
    expect(r.layers[0].space).toBe('composition');
    expect(tr(f, 'ADBE Position').expression).toContain('Ld.toComp(');
    expect(tr(f, 'ADBE Position').expression).toContain('parent.fromComp(out)');
  });

  it('cloneArray duplicates below the source, clears copied keys and links each copy', () => {
    const ae = makeAE();
    const src = ae.makeLayer('ShapeLayer', 'Dot');
    tr(src, 'ADBE Position').setValueAtTime(0, [100, 540]);
    tr(src, 'ADBE Position').setValueAtTime(1, [300, 540]);
    const r = plain(ae.ctx.MCP.commands.cloneArray({ layer: { name: 'Dot' }, count: 3, positionStep: [0, 80], timeOffsetFrames: 2 }));
    expect(ae.layers.map((L) => L.name).slice(0, 5)).toEqual(['Dot Array', 'Dot', 'Dot 2', 'Dot 3', 'Dot 4']);
    const c3 = ae.layers.find((L) => L.name === 'Dot 4');
    expect(tr(c3, 'ADBE Position').numKeys).toBe(0);
    expect(tr(c3, 'ADBE Position').expression).toContain('var k = 3;');
    expect(tr(c3, 'ADBE Opacity').expression).toContain('clamp(S.transform.opacity.valueAtTime(t)');
    expect(tr(src, 'ADBE Position').expression).toBe('');
    expect(r.layers.map((l: Any) => [l.copy, l.clearedKeys])).toEqual([[1, 1], [2, 1], [3, 1]]);
  });

  it('cloneArray in ring mode rigs the source too and refuses cameras before duplicating', () => {
    const ae = makeAE();
    const src = ae.makeLayer('AVLayer', 'Petal', { hasSource: true });
    const r = plain(ae.ctx.MCP.commands.cloneArray({ layer: { name: 'Petal' }, count: 5, radial: { radius: 200, orient: true }, delayContent: true }));
    expect(r.mode).toBe('radial');
    expect(tr(src, 'ADBE Position').expression).toContain('var k = 0;');
    expect(tr(src, 'ADBE Rotate Z').expression).toContain('+ 90');
    const host = ae.layers.find((L) => L.name === 'Petal Array');
    expect(control(host, 'Angle Step').value).toBe(60);
    const copy = ae.layers.find((L) => L.name === 'Petal 2');
    expect(copy.property('ADBE Time Remapping').expression).toContain('valueAtTime(t);');
    const cam = makeAE();
    cam.makeLayer('CameraLayer', 'Camera 1');
    expect(() => cam.ctx.MCP.commands.cloneArray({ layer: { name: 'Camera 1' }, count: 2 })).toThrow(/Cameras and lights/);
    expect(cam.layers.length).toBe(1);
  });

  it('shapeMorph subdivides the simpler path, matches the start and keys the from path', () => {
    const ae = makeAE();
    const sq = ae.newShape([[-50, -50], [50, -50], [50, 50], [-50, 50]]);
    const oct = ae.newShape(Array.from({ length: 8 }, (_, k) => [Math.round(60 * Math.cos((k * Math.PI) / 4)), Math.round(60 * Math.sin((k * Math.PI) / 4))]));
    const A = shapeLayer(ae, 'Square', [{ path: sq }]);
    const B = shapeLayer(ae, 'Octagon', [{ path: oct }]);
    tr(B, 'ADBE Position')._value = [1160, 540];
    const r = plain(ae.ctx.MCP.commands.shapeMorph({ from: { layer: { name: 'Square' } }, to: { layer: { name: 'Octagon' } }, durationFrames: 15 }));
    expect(r.subdivided).toEqual({ path: 'from', added: 4 });
    expect(r.vertexCount).toBe(8);
    expect(r.to.hidden).toBe('layer');
    expect(B.enabled).toBe(false);
    const pathProp = A.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(1).property('ADBE Vector Shape');
    expect(pathProp.keys.length).toBe(2);
    const end = pathProp.keys[1].value;
    expect(end.vertices.length).toBe(8);
    // space comp: the octagon sits 200 px to the right of the square's layer
    const xs = end.vertices.map((v: number[]) => v[0]);
    expect(Math.max(...xs)).toBeCloseTo(260, 6);
    expect(pathProp.keys[0].value.vertices.length).toBe(8);
  });

  it('shapeMorph names ambiguous paths and refuses parametric from paths and existing keys', () => {
    const ae = makeAE();
    const tri = ae.newShape([[0, -50], [50, 50], [-50, 50]]);
    shapeLayer(ae, 'Two', [{ path: tri, groupName: 'A' }, { path: tri, groupName: 'B' }]);
    shapeLayer(ae, 'Rect', [{ rect: [100, 60] }]);
    const keyed = shapeLayer(ae, 'Keyed', [{ path: tri }]);
    expect(() => ae.ctx.MCP.commands.shapeMorph({ from: { layer: { name: 'Two' } }, to: { layer: { name: 'Rect' } } })).toThrow(/has 2 paths: A\/Path 1 \(path\), B\/Path 1 \(path\)/);
    expect(() => ae.ctx.MCP.commands.shapeMorph({ from: { layer: { name: 'Rect' } }, to: { layer: { name: 'Keyed' } } })).toThrow(/parametric rect/);
    const kp = keyed.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').property(1).property('ADBE Vector Shape');
    kp.setValueAtTime(0, tri);
    expect(() => ae.ctx.MCP.commands.shapeMorph({ from: { layer: { name: 'Keyed' } }, to: { layer: { name: 'Rect' } } })).toThrow(/replaceKeys/);
    const r = plain(ae.ctx.MCP.commands.shapeMorph({ from: { layer: { name: 'Two' }, path: 'B' }, to: { layer: { name: 'Two' }, path: 'A/Path 1' }, space: 'local' }));
    expect(r.to.hidden).toBe('path');
    expect(r.subdivided).toBeNull();
  });

  it('wiggleRig, swayLoop and fitToBox write their controls and expressions', () => {
    const ae = makeAE();
    const a = ae.makeLayer('AVLayer', 'Card 1');
    const b = ae.makeLayer('AVLayer', 'Card 2');
    tr(b, 'ADBE Position').dimensionsSeparated = true;
    const w = plain(ae.ctx.MCP.commands.wiggleRig({ layers: { names: ['Card 1', 'Card 2'] }, properties: ['position', 'scale'], axes: 'y', loop: 4, rampIn: { durationFrames: 30 } }));
    const wc = ae.layers.find((L) => L.name === 'Wiggle Controls');
    expect(fxNames(wc)).toEqual(['Frequency', 'Position Amount', 'Scale Amount', 'Loop Seconds', 'Seed', 'Strength']);
    expect(control(wc, 'Strength').keys.map((k: Any) => k.value)).toEqual([0, 100]);
    expect(tr(a, 'ADBE Position').expression).toContain('var m = [0, 1, 0]');
    expect(tr(b, 'ADBE Position_1').expression).toContain('base + n * s;');
    expect(tr(b, 'ADBE Position_0').expression).toBe('');
    expect(w.count).toBe(2);
    const s = plain(ae.ctx.MCP.commands.swayLoop({ layers: { names: ['Card 1'] }, rotation: 2, period: 3 }));
    expect(s.notes.some((n: string) => /whole number of periods/.test(n))).toBe(true);
    expect(tr(a, 'ADBE Rotate Z').expression).toContain('Sway Rotation');
    const logo = ae.makeLayer('AVLayer', 'Logo');
    logo.rect = { left: 0, top: 0, width: 640, height: 160 };
    const f = plain(ae.ctx.MCP.commands.fitToBox({ layers: [{ name: 'Logo' }], size: [320, 120] }));
    expect(f.controlLayer.name).toBe('Logo');
    expect(f.layers[0].scaleNow).toBe(50);
    expect(tr(logo, 'ADBE Scale').expression).toContain('Math.min(fx, fy)');
  });
});

/* ------------------------------------------------------------------------
 * The generated expressions, evaluated in a sandbox with the After Effects
 * expression globals they use (thisComp, thisLayer, effect, transform,
 * toComp, clamp, length, wiggle...). Checks the numbers they produce.
 * ---------------------------------------------------------------------- */

interface ExprLayerSpec {
  name: string;
  effects?: Record<string, unknown>;
  effectKeys?: Record<string, Array<[number, unknown]>>;
  position?: number[];
  positionKeys?: Array<[number, number[]]>;
  scale?: number[];
  rotation?: number;
  opacity?: number;
  anchor?: number[];
  rect?: { left: number; top: number; width: number; height: number };
  parent?: Any;
}

function exprProp(value: unknown, keys?: Array<[number, unknown]>): Any {
  const ks = keys?.map(([time, v]) => ({ time, value: v }));
  return {
    value: ks && ks.length ? interp(ks, 0) : value,
    valueAtTime: (t: number) => (ks && ks.length ? interp(ks, t) : value),
    numKeys: ks?.length ?? 0,
    key: (i: number) => ks![i - 1],
  };
}

function exprLayer(s: ExprLayerSpec, at = 0): Any {
  const anchor = s.anchor ?? [0, 0];
  const pos = s.positionKeys ? (interp(s.positionKeys.map(([time, value]) => ({ time, value })), at) as number[]) : s.position ?? [960, 540];
  const L: Any = {
    name: s.name,
    transform: {
      position: exprProp(pos, s.positionKeys),
      scale: exprProp(s.scale ?? [100, 100]),
      rotation: exprProp(s.rotation ?? 0),
      opacity: exprProp(s.opacity ?? 100),
      anchorPoint: exprProp(anchor),
    },
    effect: (n: string) => (i: number) => {
      expect(i).toBe(1);
      if (!(n in (s.effects ?? {})) && !(n in (s.effectKeys ?? {}))) throw new Error(`no control ${n} on ${s.name}`);
      return exprProp(s.effects?.[n], s.effectKeys?.[n]);
    },
    sourceRectAtTime: () => s.rect ?? { left: -50, top: -50, width: 100, height: 100 },
    // an unrotated, unscaled 2D layer: layer space is composition space shifted by position - anchor
    toComp: (p: number[]) => [p[0] - anchor[0] + pos[0], p[1] - anchor[1] + pos[1]],
    toWorld: (p: number[]) => [p[0] - anchor[0] + pos[0], p[1] - anchor[1] + pos[1], (p[2] ?? 0) + (pos[2] ?? 0)],
    hasParent: !!s.parent,
    parent: s.parent,
  };
  return L;
}

function runExpr(code: string, self: ExprLayerSpec, others: ExprLayerSpec[], opts: { value: unknown; time?: number; valueAtTime?: (t: number) => unknown; wiggle?: Any } = { value: 0 }): unknown {
  const time = opts.time ?? 0;
  const me = exprLayer(self, time);
  const byName: Record<string, Any> = { [self.name]: me };
  for (const o of others) byName[o.name] = exprLayer(o, time);
  const env = {
    Math,
    time,
    value: opts.value,
    thisLayer: me,
    thisComp: { layer: (n: string) => byName[n] ?? (() => { throw new Error(`no layer ${n}`); })(), frameDuration: 1 / 30 },
    transform: me.transform,
    hasParent: me.hasParent,
    parent: me.parent,
    sourceRectAtTime: me.sourceRectAtTime,
    effect: me.effect,
    clamp: (v: number, a: number, b: number) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b)),
    length: (a: number[], b?: number[]) => Math.hypot(...a.map((x, i) => x - (b ? b[i] : 0))),
    degreesToRadians: (d: number) => (d * Math.PI) / 180,
    valueAtTime: opts.valueAtTime ?? (() => opts.value),
    wiggle: opts.wiggle ?? (() => opts.value),
    seedRandom: () => undefined,
  };
  return vm.runInNewContext(code, env);
}

describe('motion-rigs expressions evaluated', () => {
  const { ctx } = makeAE();
  const R = ctx.MCP.mrig;
  const rc = (name: string, index = 99) => ({ comp: {}, host: { index, name }, controls: [], byName: {}, notes: [], code: {}, count: 0, errors: 0 });
  const twoD = (name = 'Cell', index = 1) => ({ name, index, threeDLayer: false });

  it('the counter expression formats like formatNumber, with tabular padding', () => {
    const opts = [
      { decimals: 0, minDigits: 0, group: true, sep: ',', point: '.', prefix: '$', suffix: '', plus: false },
      { decimals: 2, minDigits: 0, group: true, sep: '.', point: ',', prefix: '', suffix: ' €', plus: false },
      { decimals: 1, minDigits: 3, group: false, sep: ',', point: '.', prefix: '', suffix: '%', plus: true },
    ];
    for (const o of opts) {
      const code = R.counterCode(rc('Score', 1), twoD('Score', 1), o, 1, false);
      for (const v of [0, 7, 12.345, 999.96, 1234567.5, -42.25]) {
        const out = runExpr(code, { name: 'Score', effects: { Value: v, Decimals: o.decimals, 'Min Digits': o.minDigits, Separator: o.group ? 1 : 0 } }, []);
        expect(out).toBe(R.formatNumber(v, o));
      }
    }
    const code = R.counterCode(rc('Score', 1), twoD('Score', 1), opts[0], 1, true);
    const out = runExpr(code, { name: 'Score', effects: { Decimals: 0, 'Min Digits': 0, Separator: 1 }, effectKeys: { Value: [[0, 0], [2, 12500]] } }, []);
    expect(out).toBe('     $0');
    const big = R.counterCode(rc('Score', 1), twoD('Score', 1), opts[0], 100, false);
    expect(runExpr(big, { name: 'Score', effects: { Value: 250000, Decimals: 0, 'Min Digits': 0, Separator: 1 } }, [])).toBe('$25,000,000');
  });

  const grid = (over: Record<string, unknown> = {}) => ({ name: 'Grid Controls', position: [960, 540], anchor: [50, 50], effects: { Columns: 3, 'Cell Width': 100, 'Cell Height': 80, 'Gap X': 20, 'Gap Y': 10, Origin: [50, 50], 'Center On Origin': 1, 'Column First': 0, 'Reverse Order': 0, Rows: 2, 'Fit Cells': 1, ...over } });
  const cellAt = (slot: number, ctl: Record<string, unknown> = {}, self: Partial<ExprLayerSpec> = {}) =>
    runExpr(R.gridPositionCode(rc('Grid Controls'), twoD(), { slot, colSpan: 1, rowSpan: 1 }, 6, false, -1), { name: 'Cell', rect: { left: -50, top: -40, width: 100, height: 80 }, ...self }, [grid(ctl)], { value: [0, 0] }) as number[];

  it('grid positions centre each layer on its cell, follow the controls and glide on fractional Columns', () => {
    // 3 x 2 grid of 100 x 80 cells, gaps 20 x 10, centred on (960, 540): width 340, height 170
    expect(cellAt(0)).toEqual([840, 495]);
    expect(cellAt(4)).toEqual([960, 585]);
    expect(cellAt(0, { 'Center On Origin': 0 })).toEqual([1010, 580]);
    // filling columns first, slot 2 sits under slot 1 and slot 3 starts column 2
    expect(cellAt(1, { 'Column First': 1 })).toEqual([840, 585]);
    expect(cellAt(2, { 'Column First': 1 })).toEqual([960, 495]);
    // reversed, slot 1 takes the last cell (column 3, row 2)
    expect(cellAt(0, { 'Reverse Order': 1 })).toEqual([1080, 585]);
    const two = cellAt(2, { Columns: 2 });
    const three = cellAt(2, { Columns: 3 });
    const mid = cellAt(2, { Columns: 2.5 });
    expect(mid[0]).toBeCloseTo((two[0] + three[0]) / 2, 9);
    expect(mid[1]).toBeCloseTo((two[1] + three[1]) / 2, 9);
    // a layer whose bounds are off its anchor still lands centred
    expect(cellAt(0, {}, { rect: { left: 0, top: 0, width: 100, height: 80 } })).toEqual([790, 455]);
    // a parented layer goes through parent.fromComp
    const parent = { fromComp: (p: number[]) => [p[0] - 100, p[1] - 100] };
    expect(cellAt(0, {}, { parent })).toEqual([740, 395]);
  });

  it('bento positions and the fit expressions use the span', () => {
    const cell = { slot: 0, col: 2, row: 1, colSpan: 2, rowSpan: 2 };
    const p = runExpr(R.gridPositionCode(rc('Grid Controls'), twoD(), cell, 3, true, -1), { name: 'Cell', rect: { left: -50, top: -50, width: 100, height: 100 } }, [grid()], { value: [0, 0] }) as number[];
    // columns 3 x rows 2 centred: x0 = 790, y0 = 455; span 220 x 170
    expect(p).toEqual([790 + 120 + 110, 455 + 85]);
    const s = runExpr(R.gridScaleCode(rc('Grid Controls'), twoD(), cell, 'contain'), { name: 'Cell', rect: { left: 0, top: 0, width: 440, height: 100 } }, [grid()], { value: [100, 100] }) as number[];
    expect(s).toEqual([50, 50]);
    const st = runExpr(R.gridScaleCode(rc('Grid Controls'), twoD(), cell, 'stretch'), { name: 'Cell', rect: { left: 0, top: 0, width: 440, height: 100 } }, [grid()], { value: [100, 100, 100] }) as number[];
    expect(st).toEqual([50, 170, 100]);
    const off = runExpr(R.gridScaleCode(rc('Grid Controls'), twoD(), cell, 'cover'), { name: 'Cell' }, [grid({ 'Fit Cells': 0 })], { value: [80, 80] });
    expect(off).toEqual([80, 80]);
    const size = runExpr(R.gridSizeCode(rc('Grid Controls'), twoD(), cell), { name: 'Cell', scale: [50, 50] }, [grid()], { value: [10, 10] });
    expect(size).toEqual([440, 340]);
  });

  it('effector weights fall off linearly or smoothly, invert, and drive each reaction', () => {
    const eff = (over: Record<string, unknown> = {}) => ({ name: 'Effector', position: [960, 540], anchor: [0, 0], effects: { Radius: 200, Falloff: 100, 'Smooth Falloff': 0, Invert: 0, Strength: 100, 'Scale Amount': 40, 'Opacity Amount': -100, 'Rotation Amount': 90, 'Blur Amount': 20, 'Offset X': 0, 'Offset Y': -50, ...over } });
    const code = (reaction: string) => R.effectorCode(rc('Effector'), twoD('Tile'), { name: 'Effector', threeDLayer: false }, reaction, false);
    const tile = (x: number) => ({ name: 'Tile', position: [x, 540] });
    const scale = code('scale');
    expect(runExpr(scale, tile(1060), [eff()], { value: [100, 100] })).toEqual([120, 120]);
    expect(runExpr(scale, tile(1260), [eff()], { value: [100, 100] })).toEqual([100, 100]);
    expect(runExpr(scale, tile(960), [eff()], { value: [100, 100] })).toEqual([140, 140]);
    const smooth = runExpr(scale, tile(1010), [eff({ 'Smooth Falloff': 1 })], { value: [100, 100] }) as number[];
    expect(smooth[0]).toBeCloseTo(100 + 40 * 0.84375, 9);
    expect(runExpr(scale, tile(960), [eff({ Invert: 1 })], { value: [100, 100] })).toEqual([100, 100]);
    expect(runExpr(scale, tile(960), [eff({ Strength: 50 })], { value: [100, 100] })).toEqual([120, 120]);
    // a hard edge: Falloff 0 gives full weight right up to the radius
    expect(runExpr(scale, tile(1150), [eff({ Falloff: 0 })], { value: [100, 100] })).toEqual([140, 140]);
    expect(runExpr(code('opacity'), tile(1060), [eff()], { value: 100 })).toBe(50);
    expect(runExpr(code('rotation'), tile(1060), [eff()], { value: 10 })).toBe(55);
    expect(runExpr(code('blur'), tile(1060), [eff()], { value: 0 })).toBe(10);
    // the Position expression measures from its own start value
    expect(runExpr(code('offset'), tile(0), [eff()], { value: [1060, 540] })).toEqual([1060, 515]);
    // 3D layer, 3D effector: distance in world space
    const h3 = R.weightLines(rc('Effector'), { name: 'Tile', index: 1, threeDLayer: true }, { name: 'Effector', threeDLayer: true }, false).join('\n') + '\nw;';
    expect(runExpr(h3, { name: 'Tile', position: [960, 540, 100] }, [{ ...eff(), position: [960, 540, 0] }], { value: 0 })).toBeCloseTo(0.5, 9);
  });

  it('the follow chain repeats the leader with a delay, decay and both modes', () => {
    const lead = { name: 'Dot', positionKeys: [[0, [0, 0]], [1, [100, 0]]] as Array<[number, number[]]>, effects: { Delay: 3, Decay: 0 } };
    const code = (mode: string, k = 2) => R.chainCode(rc('Dot', 5), twoD('Dot 3', 3), { name: 'Dot', index: 5 }, k, 3, 'position', mode, true, -1);
    // step 2, 3 frames per step: 0.2 s behind
    const at = (mode: string, time: number, decay = 0, value = [500, 500]) => runExpr(code(mode), { name: 'Dot 3' }, [{ ...lead, effects: { Delay: 3, Decay: decay } }], { value, time }) as number[];
    const p = at('offset', 0.5);
    expect(p[0]).toBeCloseTo(530, 9);
    expect(p[1]).toBe(500);
    expect(at('offset', 0.5, 50)[0]).toBeCloseTo(507.5, 9);
    expect(at('absolute', 0.5)[0]).toBeCloseTo(30, 9);
    expect(at('absolute', 0.5, 50)[0]).toBeCloseTo(500 + (30 - 500) * 0.25, 9);
    const opac = R.chainCode(rc('Dot', 5), twoD('Dot 3', 3), { name: 'Dot', index: 5 }, 1, 3, 'opacity', 'offset', true, -1);
    expect(runExpr(opac, { name: 'Dot 3' }, [{ ...lead, opacity: 40 }], { value: 100 })).toBe(100);
    // the rest value comes from the followed property's own first key
    const fade = { ...lead, effects: { Delay: 3, Decay: 0 } };
    const L = exprLayer(fade);
    L.transform.opacity = exprProp(100, [[1, 100], [2, 0]]);
    const byName = { Dot: L };
    const env = { Math, time: 2.1, value: 80, thisLayer: {}, thisComp: { layer: (n: string) => byName[n as 'Dot'], frameDuration: 1 / 30 }, clamp: (v: number, a: number, b: number) => Math.min(Math.max(v, a), b) };
    // 0.1 s behind at 2.1 s: the leader sits at 0, 100 below its rest at 1 s
    expect(vm.runInNewContext(opac, env)).toBe(0);
    const axis = R.chainCode(rc('Dot', 5), twoD('Dot 3', 3), { name: 'Dot', index: 5 }, 2, 3, 'position', 'offset', true, 0);
    expect(runExpr(axis, { name: 'Dot 3' }, [lead], { value: 500, time: 0.5 })).toBeCloseTo(530, 9);
  });

  it('clone copies step from the source and sit on a ring', () => {
    const src = { name: 'Dot', positionKeys: [[0, [100, 540]], [1, [400, 540]]] as Array<[number, number[]]>, scale: [100, 100], rotation: 10, opacity: 100 };
    const arr = (over: Record<string, unknown> = {}) => ({ name: 'Array', position: [960, 540], anchor: [50, 50], effects: { 'Step X': 0, 'Step Y': 80, 'Step Z': 0, 'Rotation Step': 15, 'Scale Step': -10, 'Opacity Step': -20, 'Time Offset': 3, Center: [50, 50], Radius: 200, 'Radius Step': 0, 'Start Angle': -90, 'Angle Step': 90, Orient: 1, ...over } });
    const pos = R.clonePositionCode(rc('Array'), twoD('Dot 3', 3), { name: 'Dot', index: 1 }, 2, 3, false, -1, false);
    // copy 2, 3 frames per copy: 0.2 s behind; source at 0.5 - 0.2 = 0.3 s is x 190
    const p = runExpr(pos, { name: 'Dot 3' }, [src, arr()], { value: [0, 0], time: 0.5 }) as number[];
    expect(p[0]).toBeCloseTo(190, 9);
    expect(p[1]).toBeCloseTo(700, 9);
    const top = R.cloneTop(rc('Array'), twoD('Dot 3', 3), { name: 'Dot', index: 1 }, 2, 3, 'x').join('\n') + '\n';
    const scale = top + 'var s = S.transform.scale.valueAtTime(t), d = k * C.effect("Scale Step")(1).value, q = [];\nfor (var i = 0; i < value.length; i++) { var b = i < s.length ? s[i] : value[i]; q.push(b >= 0 ? Math.max(0, b + d) : Math.min(0, b - d)); }\nq;';
    expect(runExpr(scale, { name: 'Dot 3' }, [src, arr()], { value: [100, 100] })).toEqual([80, 80]);
    expect(runExpr(scale, { name: 'Dot 3' }, [{ ...src, scale: [-100, 100] }, arr()], { value: [100, 100] })).toEqual([-80, 80]);
    const ring = R.clonePositionCode(rc('Array'), twoD('Dot 3', 3), { name: 'Dot', index: 1 }, 1, 3, true, -1, false);
    const q = runExpr(ring, { name: 'Dot 3' }, [src, arr()], { value: [0, 0] }) as number[];
    // Center (50, 50) on a null at (960, 540) with anchor (50, 50) is (960, 540); copy 1 at -90 + 90 = 0 degrees
    expect(q[0]).toBeCloseTo(1160, 9);
    expect(q[1]).toBeCloseTo(540, 9);
    const first = R.clonePositionCode(rc('Array'), twoD('Dot', 1), { name: 'Dot', index: 1 }, 0, 3, true, -1, false);
    const q0 = runExpr(first, { name: 'Dot' }, [arr()], { value: [0, 0] }) as number[];
    expect(q0[0]).toBeCloseTo(960, 9);
    expect(q0[1]).toBeCloseTo(340, 9);
  });

  it('the wiggle loops seamlessly and scales with Strength', () => {
    const top = R.wiggleCode(rc('Wiggle Controls'), twoD('Card'), 'position', 0, [1, 1, 0], -1);
    const ctl = (over: Record<string, unknown> = {}) => ({ name: 'Wiggle Controls', effects: { Frequency: 1, 'Position Amount': 20, 'Loop Seconds': 4, Seed: 1, Strength: 100, ...over } });
    // a smooth deterministic stand-in for wiggle: base value plus a noise that depends on t
    const wiggle = (f: number, amp: number, _o: number, _m: number, t: number) => [100 + amp * Math.sin(1.3 * t + 0.4), 200 + amp * Math.cos(0.7 * t)];
    const run = (time: number, over: Record<string, unknown> = {}) => runExpr(top, { name: 'Card' }, [ctl(over)], { value: [100, 200], time, wiggle, valueAtTime: () => [100, 200] }) as number[];
    const a = run(0);
    const b = run(4 - 1e-6);
    expect(a[0]).toBeCloseTo(b[0], 4);
    expect(a[1]).toBeCloseTo(b[1], 4);
    expect(run(8)).toEqual(run(4));
    const half = run(1.3, { Strength: 50 });
    const full = run(1.3);
    expect(half[0] - 100).toBeCloseTo((full[0] - 100) / 2, 9);
    expect(run(1.3, { 'Loop Seconds': 0 })[0]).toBeCloseTo(100 + 20 * Math.sin(1.3 * 1.3 + 0.4), 9);
  });

  it('the sway repeats every Period and shifts by Phase Step per layer', () => {
    const ctl = { name: 'Sway Controls', effects: { Period: 4, 'Phase Step': 90, 'Sway X': 10, 'Sway Y': 12, Strength: 100, 'Sway Rotation': 3 } };
    const code = (k: number, what = 'position', axis = -1) => R.swayCode(rc('Sway Controls'), twoD('Card', 1), k, what, axis);
    // the command writes the same code
    const ae = makeAE();
    const L = ae.makeLayer('AVLayer', 'Card');
    ae.ctx.MCP.commands.swayLoop({ layers: [{ name: 'Card' }], sway: [10, 12], period: 4, phaseStep: 90 });
    expect(tr(L, 'ADBE Position').expression).toBe(code(0));
    expect(runExpr(code(0, 'rotation'), { name: 'Card' }, [ctl], { value: 5, time: 0 })).toBeCloseTo(8, 9);
    expect(runExpr(code(0, 'position', 1), { name: 'Card' }, [ctl], { value: 100, time: 1 })).toBeCloseTo(112, 9);
    const p0 = runExpr(code(0), { name: 'Card' }, [ctl], { value: [100, 100], time: 0 }) as number[];
    expect(p0[0]).toBeCloseTo(110, 9);
    expect(p0[1]).toBeCloseTo(100, 9);
    const p4 = runExpr(code(0), { name: 'Card' }, [ctl], { value: [100, 100], time: 4 }) as number[];
    expect(p4[0]).toBeCloseTo(p0[0], 9);
    const k1 = runExpr(code(1), { name: 'Card' }, [ctl], { value: [100, 100], time: 0 }) as number[];
    expect(k1[1]).toBeCloseTo(112, 9);
  });

  it('the fit expression agrees with fitScale', () => {
    const ae = makeAE();
    const L = ae.makeLayer('AVLayer', 'Logo');
    for (const [mode, up, rect] of [['contain', 0, [640, 160]], ['cover', 1, [200, 400]], ['width', 0, [100, 50]], ['height', 1, [100, 50]]] as Array<[string, number, number[]]>) {
      ae.ctx.MCP.commands.fitToBox({ layers: [{ name: 'Logo' }], size: [320, 120], mode, upscale: !!up, offset: 2 });
      const out = runExpr(tr(L, 'ADBE Scale').expression, { name: 'Logo', rect: { left: 0, top: 0, width: rect[0], height: rect[1] }, effects: { 'Box Width': 320, 'Box Height': 120, Upscale: up, 'Scale Offset': 2 } }, [], { value: [100, 100] }) as number[];
      expect(out[0]).toBeCloseTo(R.fitScale(rect[0], rect[1], 320, 120, mode, !!up, 2), 9);
    }
  });
});

describe('stacking rigs on one property', () => {
  const count = (s: string, sub: string) => s.split(sub).length - 1;

  it('an effector offset stacks on a grid; re-runs replace only their own part', () => {
    const ae = makeAE();
    const R = ae.ctx.MCP.mrig;
    for (const n of ['A', 'B', 'C', 'D']) ae.makeLayer('AVLayer', n);
    const names = { names: ['A', 'B', 'C', 'D'] };
    ae.ctx.MCP.commands.gridLayout({ layers: names, order: 'as-given', columns: 2, cellSize: [100, 80], gap: 20 });
    const A = ae.layers.find((L) => L.name === 'A');
    const r = plain(ae.ctx.MCP.commands.proximityEffector({ layers: names, offset: [0, -40], radius: 200 }));
    let pos = tr(A, 'ADBE Position').expression as string;
    expect(R.rigOf(pos)).toBe('Proximity effector');
    expect(count(pos, R.OPEN)).toBe(1);
    expect(pos).toContain('// Grid layout: slot 1 of 4');
    expect(r.layers[0].expressions.find((e: Any) => e.property === 'Transform/Position').stacked).toBe('on Grid layout');

    // the stack evaluates to the grid cell plus the weighted offset
    const gridCtl = { name: 'Grid Controls', position: [960, 540], anchor: [50, 50], effects: { Columns: 2, 'Cell Width': 100, 'Cell Height': 80, 'Gap X': 20, 'Gap Y': 20, Origin: [50, 50], 'Center On Origin': 1, 'Column First': 0, 'Reverse Order': 0 } };
    const effCtl = { name: 'Effector', position: [960, 540], anchor: [50, 50], effects: { Radius: 200, Falloff: 100, 'Smooth Falloff': 1, Invert: 0, Strength: 100, 'Offset X': 0, 'Offset Y': -40 } };
    const out = runExpr(pos, { name: 'A' }, [gridCtl, effCtl], { value: [960, 540] }) as number[];
    // 2 x 2 cells of 100 x 80 with 20 px gaps centred on (960, 540): slot 1 at (900, 490)
    const u = 1 - Math.hypot(60, 50) / 200;
    expect(out[0]).toBeCloseTo(900, 9);
    expect(out[1]).toBeCloseTo(490 - 40 * u * u * (3 - 2 * u), 9);

    // the effector again (now with scale too): its part is replaced, the grid kept
    ae.ctx.MCP.commands.proximityEffector({ layers: names, effector: { name: 'Effector' }, offset: [0, -60], scale: 20 });
    pos = tr(A, 'ADBE Position').expression;
    expect(count(pos, R.OPEN)).toBe(1);
    expect(count(pos, '// Proximity effector')).toBe(1);
    expect(pos).toContain('// Grid layout: slot 1 of 4');

    // the grid again with another column count: it goes under the effector
    const g = plain(ae.ctx.MCP.commands.gridLayout({ layers: names, order: 'as-given', columns: 4, controlLayer: { name: 'Grid Controls' } }));
    pos = tr(A, 'ADBE Position').expression;
    expect(R.rigOf(pos)).toBe('Proximity effector');
    expect(count(pos, '// Grid layout')).toBe(1);
    expect(g.layers[0].expressions[0].stacked).toBe('under Proximity effector');

    // a wiggle on top nests the whole stack
    ae.ctx.MCP.commands.wiggleRig({ layers: names });
    pos = tr(A, 'ADBE Position').expression;
    expect(R.rigOf(pos)).toBe('Wiggle rig');
    expect(count(pos, R.OPEN)).toBe(2);
    // and the stack still evaluates (wiggle stand-in returns the start value, so the result is unchanged)
    const wiggleCtl = { name: 'Wiggle Controls', effects: { Frequency: 0.8, 'Position Amount': 10, 'Loop Seconds': 0, Seed: 1, Strength: 100 } };
    const out2 = runExpr(pos, { name: 'A' }, [{ ...gridCtl, effects: { ...gridCtl.effects, Columns: 4 } }, { ...effCtl, effects: { ...effCtl.effects, 'Offset Y': -60, 'Scale Amount': 20 } }, wiggleCtl], { value: [960, 540], wiggle: (_f: number, _a: number, _o: number, _m: number, _t: number) => [960, 540] }) as number[];
    expect(out2[0]).toBeCloseTo(960 - 1.5 * 120, 9);
  });

  it('a rig replaces an expression it did not write and says so', () => {
    const ae = makeAE();
    const L = ae.makeLayer('AVLayer', 'Card');
    tr(L, 'ADBE Position').expression = 'value + [10, 0]';
    const r = plain(ae.ctx.MCP.commands.wiggleRig({ layers: [{ name: 'Card' }] }));
    expect(r.layers[0].expressions[0].replaced).toBe('value + [10, 0]');
    expect(tr(L, 'ADBE Position').expression.split('\n')[1]).toBe('var base = value;');
    const s = ae.ctx.MCP.mrig.stack('', 'x;');
    expect(s.code).toBe('x;');
  });
});
