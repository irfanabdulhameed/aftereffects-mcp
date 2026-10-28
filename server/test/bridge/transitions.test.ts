import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
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

function lastCommand(): string {
  return tb.mock.state.log[tb.mock.state.log.length - 1].command;
}

function bridgeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const entry = catalog.find((c) => c.name === name);
  if (!entry) throw new Error(`no tool ${name}`);
  return prepareBridgeArgs(entry, args, tb.client);
}

type Key = { frame: number; value: unknown; easeIn: Array<{ speed: number; influence: number }>; easeOut: Array<{ speed: number; influence: number }> };
type KeyGroup = { layer: { name: string }; property: string; keys: Key[] };

const TRANSITION_TOOLS = ['add-transition', 'carry-element', 'list-transitions', 'remove-transition'];
const PAIR = { comp: { name: 'Launch Film' }, outgoing: { name: '01 Intro' }, incoming: { name: '02 Feature' } };

describe('transitions tools: registration', () => {
  it('registers every tool in the transitions group with a template description of 60 to 200 words', () => {
    for (const name of TRANSITION_TOOLS) {
      const entry = catalog.find((c) => c.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.group).toBe('transitions');
      const words = entry!.description.split(/\s+/).length;
      expect(words, name).toBeGreaterThanOrEqual(60);
      expect(words, name).toBeLessThanOrEqual(200);
      const labels = ['Use when:', 'Do not use for:', 'Inputs:', 'Returns:', 'Notes:', 'Example:'].map((l) => entry!.description.indexOf(l));
      expect(labels.every((i) => i > 0), name).toBe(true);
      expect([...labels].sort((a, b) => a - b), name).toEqual(labels);
      expect(entry!.description, name).not.toContain(String.fromCharCode(0x2014));
    }
    expect(catalog.find((c) => c.name === 'list-transitions')!.mutating).toBe(false);
  });
});

describe('add-transition', () => {
  it('defaults to a match cut: outgoing accelerates into the cut, incoming opens oversized and lands', async () => {
    const r = await callTool(client, 'add-transition', PAIR);
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('addTransition');
    expect(r.json.transition).toMatchObject({ kind: 'match-cut', cutFrame: 90, startFrame: 80, endFrame: 100, framesOut: 10, framesIn: 10 });
    const keys = r.json.keys as KeyGroup[];
    const out = keys.find((k) => k.layer.name === '01 Intro' && k.property === 'Transform/Scale')!;
    const inn = keys.find((k) => k.layer.name === '02 Feature' && k.property === 'Transform/Scale')!;
    expect(out.keys.map((k) => k.frame)).toEqual([80, 90]);
    expect(out.keys[0].easeOut[0].influence).toBe(85);
    expect(out.keys[1].easeIn[0].influence).toBe(14);
    expect(inn.keys.map((k) => k.frame)).toEqual([90, 100]);
    expect(inn.keys[0].value).toEqual([250, 250, 100]);
    expect(inn.keys[0].easeOut[0].influence).toBe(16.7);
    expect(inn.keys[1].easeIn[0].influence).toBe(90);
    // Two keys per property only, never a key per frame.
    expect(keys.every((k) => k.keys.length <= 3)).toBe(true);
    expect(r.json.outgoing).toMatchObject({ outFrame: 90, motionBlur: true });
    expect(r.json.incoming).toMatchObject({ inFrame: 90, motionBlur: true });
    expect(r.json.motionBlur).toMatchObject({ composition: true });
  });

  it('pivots on an origin point and scales the push with intensity', async () => {
    const r = await callTool(client, 'add-transition', { ...PAIR, origin: [1500, 900], intensity: 2, frame: 120 });
    expect(r.json.transition).toMatchObject({ cutFrame: 120, intensity: 2 });
    const keys = r.json.keys as KeyGroup[];
    expect(keys.map((k) => k.property)).toContain('Transform/Position');
    expect(keys.find((k) => k.property === 'Transform/Scale')!.keys[1].value).toEqual([400, 400, 100]);
  });

  it('builds each kind with its own mechanism', async () => {
    const zoom = await callTool(client, 'add-transition', { ...PAIR, kind: 'zoom-through' });
    expect(zoom.json.effects).toContain('Transition tmock1 Blur');
    expect((zoom.json.transition as { details: { blurPeak: number } }).details.blurPeak).toBe(40);

    const push = await callTool(client, 'add-transition', { ...PAIR, kind: 'push', direction: 'left' });
    const pk = (push.json.keys as KeyGroup[])[0];
    expect(pk.keys).toHaveLength(3);
    expect(pk.keys[1].easeIn[0].speed).toBeGreaterThan(0);
    expect(push.json.outgoing).toMatchObject({ outFrame: 108 });
    expect(push.json.incoming).toMatchObject({ inFrame: 90 });

    const reveal = await callTool(client, 'add-transition', { ...PAIR, kind: 'shape-reveal', shape: 'rounded-rectangle', roundness: 24 });
    expect(reveal.json.helpers).toEqual([{ layer: { index: 1, id: 310, name: 'Transition tmock1 Matte' }, role: 'matte' }]);
    expect(reveal.json.incoming).toMatchObject({ trackMatte: 'alpha' });
    expect(reveal.json.transition).toMatchObject({ framesOut: 0, framesIn: 15, startFrame: 90 });

    const blur = await callTool(client, 'add-transition', { ...PAIR, kind: 'blur-swap' });
    expect((blur.json.keys as KeyGroup[]).filter((k) => k.property.endsWith('Blurriness'))).toHaveLength(2);

    const whip = await callTool(client, 'add-transition', { ...PAIR, kind: 'whip', direction: 'right' });
    expect(whip.json.effects).toContain('Transition tmock1 Edges');
    expect((whip.json.notes as string[])[0]).toContain('motionBlurSamplesPerFrame');
  });

  it('carries an element across the cut and lines the scenes up on it', async () => {
    const r = await callTool(client, 'add-transition', { ...PAIR, carry: { outgoing: { name: 'Send' }, incoming: { name: 'Chip' } } });
    expect(r.isError).toBe(false);
    expect(r.json.carry).toMatchObject({ created: true, alignedAtCut: true, layer: { name: 'Send Carry' } });
    expect(r.json.helpers).toEqual([{ layer: { index: 1, id: 300, name: 'Send Carry' }, role: 'carry' }]);
    const noLayer = await callTool(client, 'add-transition', { ...PAIR, carry: { outgoing: { name: 'Send' }, incoming: { name: 'Chip' }, layer: false } });
    expect(noLayer.json.carry).toBeNull();
  });

  it('rejects bad input before anything is sent', async () => {
    await rejectedBeforeSend('add-transition', { outgoing: { name: 'A' } });
    await rejectedBeforeSend('add-transition', { ...PAIR, kind: 'crossfade' });
    await rejectedBeforeSend('add-transition', { ...PAIR, kind: 'push', move: 'position' });
    await rejectedBeforeSend('add-transition', { ...PAIR, kind: 'whip', shape: 'circle' });
    await rejectedBeforeSend('add-transition', { ...PAIR, intensity: 9 });
    await rejectedBeforeSend('add-transition', { ...PAIR, framesOut: 0 });
    await rejectedBeforeSend('add-transition', { ...PAIR, direction: 'diagonal' });
    await rejectedBeforeSend('add-transition', { ...PAIR, carry: { outgoing: { name: 'Send' } } });
    await rejectedBeforeSend('add-transition', { ...PAIR, origin: [1, 2, 3] });
  });

  it('passes move, shape and roundness through when the kind comes from the plan', () => {
    expect(bridgeArgs('add-transition', { ...PAIR, shape: 'circle' })).toMatchObject({ shape: 'circle' });
    expect(bridgeArgs('add-transition', { ...PAIR, move: 'position' })).toMatchObject({ move: 'position' });
  });

  it('reports a bridge refusal as an error result', async () => {
    const r = await callTool(client, 'add-transition', { outgoing: { name: '01 Intro' }, incoming: { name: '01 Intro' } });
    expect(r.isError).toBe(true);
    expect((r.json.bridgeError as { code: string }).code).toBe('invalid-argument');
  });
});

describe('carry-element', () => {
  it('moves one layer across the cut with three keys and trims the originals', async () => {
    const r = await callTool(client, 'carry-element', {
      comp: { name: 'Launch Film' },
      outgoing: { scene: { name: '01 Intro' }, layer: { name: 'Logo' } },
      incoming: { scene: { name: '02 Feature' }, layer: { name: 'Logo' } },
      framesOut: 8,
      framesIn: 12,
    });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('carryElement');
    expect(r.json).toMatchObject({ cutFrame: 90, startFrame: 82, endFrame: 102 });
    const keys = (r.json.keys as KeyGroup[])[0].keys;
    expect(keys.map((k) => k.frame)).toEqual([82, 90, 102]);
    expect(keys[1].easeIn[0].speed).toBeGreaterThan(0);
    expect((r.json.carry as { hidden: unknown[] }).hidden).toHaveLength(2);
  });

  it('accepts a target pose or an existing layer', async () => {
    const pose = await callTool(client, 'carry-element', { outgoing: { scene: { index: 2 }, layer: { name: 'Logo' } }, incoming: { pose: { position: [960, 540], scale: 250 } }, frame: 60 });
    expect(pose.json.carry).toMatchObject({ poses: { end: { center: [960, 540], size: 200 } } });
    const own = await callTool(client, 'carry-element', { outgoing: { scene: { index: 2 }, layer: { name: 'Logo' } }, incoming: { scene: { index: 1 }, layer: { name: 'Logo' } }, layer: { name: 'Logo Master' } });
    expect(own.json.carry).toMatchObject({ created: false, layer: { name: 'Logo Master' } });
  });

  it('checks the two sides before sending', async () => {
    await rejectedBeforeSend('carry-element', { outgoing: { scene: { index: 2 } }, incoming: { layer: { name: 'Logo' } } });
    await rejectedBeforeSend('carry-element', { outgoing: { layer: { name: 'Logo' } }, incoming: { scene: { index: 1 } } });
    await rejectedBeforeSend('carry-element', { outgoing: { layer: { name: 'Logo' } }, incoming: { layer: { name: 'Logo' }, pose: { position: [0, 0] } } });
    await rejectedBeforeSend('carry-element', { outgoing: { layer: { name: 'Logo' } }, incoming: { pose: { position: [0, 0] } }, source: 'incoming' });
    await rejectedBeforeSend('carry-element', { outgoing: { layer: { name: 'Logo' } }, incoming: { layer: { name: 'Logo' } }, layer: { name: 'X' }, source: 'outgoing' });
    await rejectedBeforeSend('carry-element', { outgoing: { layer: { name: 'Logo' } }, incoming: { layer: { name: 'Logo' } }, cutProgress: 1.5 });
  });
});

describe('list-transitions and remove-transition', () => {
  it('lists the records with their helpers and arguments', async () => {
    const r = await callTool(client, 'list-transitions', { comp: { name: 'Launch Film' } });
    expect(r.isError).toBe(false);
    expect(r.json.count).toBe(2);
    const list = r.json.transitions as Array<{ id: string; kind: string; cutFrame: number; helpers: Array<{ role: string }>; args: Record<string, unknown> }>;
    expect(list.map((t) => [t.id, t.kind, t.cutFrame])).toEqual([['tmock1', 'match-cut', 90], ['tmock2', 'shape-reveal', 210]]);
    expect(list[1].helpers[0].role).toBe('matte');
    expect(list[0].args).toMatchObject({ kind: 'match-cut', framesOut: 10 });
    expect(r.json.orphanHelpers).toEqual([]);
  });

  it('removes one transition by id, or all of them', async () => {
    const one = await callTool(client, 'remove-transition', { comp: { name: 'Launch Film' }, id: 'tmock1' });
    expect(one.isError).toBe(false);
    expect(lastCommand()).toBe('removeTransition');
    expect(one.json).toMatchObject({ removedCount: 1, remaining: 1 });
    expect((one.json.removed as Array<{ layersDeleted: string[] }>)[0].layersDeleted).toEqual(['Send Carry']);
    const all = await callTool(client, 'remove-transition', { all: true });
    expect(all.json).toMatchObject({ removedCount: 2, remaining: 0, compositionMotionBlur: false });
    const missing = await callTool(client, 'remove-transition', { id: 'nope' });
    expect(missing.isError).toBe(true);
    expect((missing.json.bridgeError as { code: string }).code).toBe('not-found');
  });

  it('needs id or all, not both', async () => {
    await rejectedBeforeSend('remove-transition', {});
    await rejectedBeforeSend('remove-transition', { id: 'tmock1', all: true });
    await rejectedBeforeSend('remove-transition', { id: '' });
  });
});

/* ------------------------------------------------------------------------
 * The ExtendScript side, run in a Node vm against a fake After Effects model
 * that behaves like After Effects 26.5 where it matters here: shape and text
 * layers are not AVLayer instances, and copyToComp does not put the copy at
 * index 1 (the fake puts it at the bottom). Values interpolate linearly;
 * expressions run as JavaScript with a toComp built from the transforms.
 * ---------------------------------------------------------------------- */

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SCRIPTS = path.resolve(__dirname, '..', '..', 'src', 'scripts');
const PVT = { NO_VALUE: 6012, ThreeD_SPATIAL: 6013, ThreeD: 6014, TwoD_SPATIAL: 6015, TwoD: 6016, OneD: 6017, COLOR: 6018, CUSTOM_VALUE: 6019, MARKER: 6020, LAYER_INDEX: 6021, MASK_INDEX: 6022, SHAPE: 6023, TEXT_DOCUMENT: 6024 };
const PT = { PROPERTY: 6212, INDEXED_GROUP: 6213, NAMED_GROUP: 6214 };
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
const TMT = { NO_TRACK_MATTE: 0, ALPHA: 1, ALPHA_INVERTED: 2, LUMA: 3, LUMA_INVERTED: 4 };
const isNum = (v: unknown): v is number => typeof v === 'number';
const cloneV = (v: Any): Any => (Array.isArray(v) ? v.slice() : v && typeof v.copy === 'function' ? v.copy() : v);

function makeFakeAE() {
  let nextId = 1000;

  class TextDocument {
    [k: string]: Any;
    constructor(text: string) { this.text = text; this.fontSize = 32; this.font = 'Inter'; this.fillColor = [1, 1, 1]; this.applyFill = true; }
    copy() { const t = new TextDocument(this.text); Object.assign(t, this); return t; }
  }
  class MarkerValue {
    [k: string]: Any;
    constructor(comment: string) { this.comment = comment; this.duration = 0; this.label = 0; this._params = {}; }
    setParameters(o: Any) { this._params = {}; for (const k of Object.keys(o)) this._params[k] = String(o[k]); }
    getParameters() { return { ...this._params }; }
    copy() { const m = new MarkerValue(this.comment); Object.assign(m, this); m._params = { ...this._params }; return m; }
  }
  function KeyframeEase(this: Any, speed: number, influence: number) { this.speed = speed; this.influence = influence; }
  function Shape(this: Any) { this.vertices = []; this.closed = true; }
  function SolidSource() { /* marker class */ }

  const layerOf = (p: Any): Any => { let c = p; while (c && !(c instanceof Layer)) c = c.parentProperty; return c; };

  class Prop {
    [k: string]: Any;
    constructor(name: string, matchName: string, type: number, value: Any) {
      this.name = name; this.matchName = matchName; this.propertyType = PT.PROPERTY; this.propertyValueType = type;
      this._value = value; this.keys = []; this.parentProperty = null; this.propertyIndex = 1; this._expr = ''; this.expressionEnabled = false;
      this.expressionError = ''; this.canSetExpression = type !== PVT.MARKER; this.canVaryOverTime = true;
      this.isSpatial = type === PVT.TwoD_SPATIAL || type === PVT.ThreeD_SPATIAL; this.dimensionsSeparated = false;
    }
    clone() { const p = new Prop(this.name, this.matchName, this.propertyValueType, cloneV(this._value)); p.keys = this.keys.map((k: Any) => ({ ...k, value: cloneV(k.value) })); return p; }
    get expression() { return this._expr; }
    set expression(c: string) { this._lock(); this._expr = c; this.expressionEnabled = !!c; this.expressionError = ''; }
    get propertyDepth() { let d = 0; let c: Any = this; while (c && !(c instanceof Layer)) { d++; c = c.parentProperty; } return d; }
    get numKeys() { return this.keys.length; }
    _lock() { const L = layerOf(this); if (L && L.locked) throw new Error(`Layer '${L.name}' is locked`); }
    get value() { return this.valueAtTime(0, true); }
    valueAtTime(t: number, pre?: boolean): Any {
      if (!pre && this._expr) {
        try { return vm.runInNewContext(this._expr, { thisComp: wrapComp(layerOf(this).containingComp), time: t, Math }); } catch (e) { this.expressionError = String((e as Error).message); return cloneV(this._value); }
      }
      const ks = this.keys;
      if (!ks.length) return cloneV(this._value);
      if (t <= ks[0].time) return cloneV(ks[0].value);
      if (t >= ks[ks.length - 1].time) return cloneV(ks[ks.length - 1].value);
      for (let i = 0; i < ks.length - 1; i++) {
        const a = ks[i], b = ks[i + 1];
        if (t >= a.time && t <= b.time) {
          if (!(isNum(a.value) || Array.isArray(a.value))) return cloneV(a.value);
          const u = (t - a.time) / (b.time - a.time);
          return isNum(a.value) ? a.value + (b.value - a.value) * u : a.value.map((v: number, j: number) => v + (b.value[j] - v) * u);
        }
      }
      return cloneV(ks[0].value);
    }
    setValue(v: Any) { this._lock(); if (this.keys.length) throw new Error('Can not set value of property with keyframes'); this._check(v); this._value = cloneV(v); }
    _check(v: Any) {
      const t = this.propertyValueType;
      if (t === PVT.OneD && !isNum(v)) throw new Error(`${this.name}: expected a number, got ${JSON.stringify(v)}`);
      if (t === PVT.COLOR && !(Array.isArray(v) && v.length === 4)) throw new Error('expected a colour of 4 values');
      if ([PVT.TwoD, PVT.TwoD_SPATIAL, PVT.ThreeD, PVT.ThreeD_SPATIAL].includes(t) && !(Array.isArray(v) && v.length >= 2 && v.every(isNum))) throw new Error(`${this.name}: expected an array, got ${JSON.stringify(v)}`);
      if (t === PVT.MARKER && !(v instanceof MarkerValue)) throw new Error('expected a MarkerValue');
    }
    setValueAtTime(t: number, v: Any) {
      this._lock(); this._check(v);
      const i = this.keys.findIndex((k: Any) => Math.abs(k.time - t) < 1e-6);
      const key: Any = { time: t, value: cloneV(v), inType: KIT.LINEAR, outType: KIT.LINEAR, inEase: null, outEase: null };
      if (i >= 0) { Object.assign(key, { inType: this.keys[i].inType, outType: this.keys[i].outType, inEase: this.keys[i].inEase, outEase: this.keys[i].outEase }); this.keys[i] = key; }
      else { this.keys.push(key); this.keys.sort((a: Any, b: Any) => a.time - b.time); }
    }
    _dims() { return this.isSpatial ? 1 : Array.isArray(this._value) && this.propertyValueType !== PVT.COLOR ? this._value.length : 1; }
    _ease(k: Any, side: string) { return k[side] ?? Array.from({ length: this._dims() }, () => new (KeyframeEase as Any)(0, 16.666)); }
    _ki(i: number) { if (i < 1 || i > this.keys.length) throw new Error(`key index ${i} out of range on ${this.name}`); }
    keyTime(i: number) { this._ki(i); return this.keys[i - 1].time; }
    keyValue(i: number) { this._ki(i); return cloneV(this.keys[i - 1].value); }
    removeKey(i: number) { this._lock(); this._ki(i); this.keys.splice(i - 1, 1); }
    nearestKeyIndex(t: number) { let best = 1, bd = Infinity; this.keys.forEach((k: Any, i: number) => { const d = Math.abs(k.time - t); if (d < bd) { bd = d; best = i + 1; } }); return best; }
    keyInInterpolationType(i: number) { this._ki(i); return this.keys[i - 1].inType; }
    keyOutInterpolationType(i: number) { this._ki(i); return this.keys[i - 1].outType; }
    setInterpolationTypeAtKey(i: number, a: number, b?: number) { this._ki(i); this.keys[i - 1].inType = a; this.keys[i - 1].outType = b ?? a; }
    keyInTemporalEase(i: number) { this._ki(i); return this._ease(this.keys[i - 1], 'inEase'); }
    keyOutTemporalEase(i: number) { this._ki(i); return this._ease(this.keys[i - 1], 'outEase'); }
    setTemporalEaseAtKey(i: number, a: Any[], b?: Any[]) {
      this._ki(i);
      const n = this._dims();
      if (a.length !== n || (b ?? a).length !== n) throw new Error(`${this.name}: ease arrays need ${n} entries`);
      for (const e of [...a, ...(b ?? a)]) { if (!(e.influence >= 0.1 && e.influence <= 100)) throw new Error('influence out of range'); if (this.isSpatial && e.speed < 0) throw new Error('spatial speed negative'); }
      this.keys[i - 1].inEase = a; this.keys[i - 1].outEase = b ?? a;
    }
    setTemporalAutoBezierAtKey() {} setTemporalContinuousAtKey() {} setSpatialAutoBezierAtKey() {} setSpatialContinuousAtKey() {} setSpatialTangentsAtKey() {}
    keyTemporalContinuous() { return false; } keyTemporalAutoBezier() { return false; } keySelected() { return false; } keyRoving() { return false; }
    keyInSpatialTangent() { return [0, 0]; } keyOutSpatialTangent() { return [0, 0]; } keySpatialContinuous() { return false; } keySpatialAutoBezier() { return false; }
  }

  const EFFECTS: Any = {
    'ADBE Gaussian Blur 2': ['Gaussian Blur', [['Blurriness', '-0001', PVT.OneD, 0], ['Blur Dimensions', '-0002', PVT.OneD, 1], ['Repeat Edge Pixels', '-0003', PVT.OneD, 0]]],
    'ADBE Tile': ['Motion Tile', [['Tile Center', '-0001', PVT.TwoD_SPATIAL, [960, 540]], ['Output Width', '-0004', PVT.OneD, 100], ['Output Height', '-0005', PVT.OneD, 100], ['Mirror Edges', '-0006', PVT.OneD, 0]]],
  };
  const VECTORS: Any = {
    'ADBE Vector Group': () => { const g = new Group('Group 1', 'ADBE Vector Group'); g.add(new Group('Contents', 'ADBE Vectors Group', PT.INDEXED_GROUP)); g.add(new Group('Transform', 'ADBE Vector Transform Group')); return g; },
    'ADBE Vector Shape - Ellipse': () => { const g = new Group('Ellipse Path 1', 'ADBE Vector Shape - Ellipse'); g.add(new Prop('Size', 'ADBE Vector Ellipse Size', PVT.TwoD, [100, 100])); g.add(new Prop('Position', 'ADBE Vector Ellipse Position', PVT.TwoD_SPATIAL, [0, 0])); return g; },
    'ADBE Vector Shape - Rect': () => { const g = new Group('Rectangle Path 1', 'ADBE Vector Shape - Rect'); g.add(new Prop('Size', 'ADBE Vector Rect Size', PVT.TwoD, [100, 100])); g.add(new Prop('Position', 'ADBE Vector Rect Position', PVT.TwoD_SPATIAL, [0, 0])); g.add(new Prop('Roundness', 'ADBE Vector Rect Roundness', PVT.OneD, 0)); return g; },
    'ADBE Vector Graphic - Fill': () => { const g = new Group('Fill 1', 'ADBE Vector Graphic - Fill'); g.add(new Prop('Color', 'ADBE Vector Fill Color', PVT.COLOR, [1, 0, 0, 1])); return g; },
  };

  class Group {
    [k: string]: Any;
    constructor(name: string, matchName: string, kind = PT.NAMED_GROUP) { this.name = name; this.matchName = matchName; this.propertyType = kind; this.children = []; this.parentProperty = null; this.propertyIndex = 1; }
    clone(): Any { const g = new Group(this.name, this.matchName, this.propertyType); for (const c of this.children) g.add(c.clone()); return g; }
    get numProperties() { return this.children.length; }
    get propertyDepth() { let d = 0; let c: Any = this; while (c && !(c instanceof Layer)) { d++; c = c.parentProperty; } return d; }
    add(child: Any) { child.parentProperty = this; this.children.push(child); child.propertyIndex = this.children.length; return child; }
    property(k: string | number): Any { return typeof k === 'number' ? this.children[k - 1] ?? null : this.children.find((c: Any) => c.name === k || c.matchName === k) ?? null; }
    canAddProperty(m: string) { return (this.matchName === 'ADBE Effect Parade' && !!EFFECTS[m]) || !!VECTORS[m]; }
    addProperty(m: string) {
      const L = layerOf(this); if (L && L.locked) throw new Error('layer locked');
      if (this.matchName === 'ADBE Effect Parade') {
        const [name, params] = EFFECTS[m];
        const g = new Group(name, m);
        for (const [pn, suf, t, v] of params) g.add(new Prop(pn, m + suf, t, cloneV(v)));
        return this.add(g);
      }
      return this.add(VECTORS[m]());
    }
    remove() { const p = this.parentProperty; p.children.splice(p.children.indexOf(this), 1); p.children.forEach((c: Any, i: number) => { c.propertyIndex = i + 1; }); }
  }

  class Layer extends Group {
    constructor(comp: Any, name?: string) {
      super(name ?? '', 'ADBE AV Layer');
      if (name === undefined) this._customName = undefined; // a precomp layer shows its comp's name until renamed
      Object.assign(this, { containingComp: comp, id: nextId++, enabled: true, _locked: false, _start: 0, _in: 0, _out: comp.duration, stretch: 100, parent: null, label: 1, comment: '',
        hasVideo: true, hasAudio: false, nullLayer: false, adjustmentLayer: false, guideLayer: false, threeDLayer: false, blendingMode: 1,
        trackMatteType: TMT.NO_TRACK_MATTE, trackMatteLayer: null, motionBlur: false, source: null, timeRemapEnabled: false, rect: { left: 0, top: 0, width: 100, height: 100 } });
      const tg = this.add(new Group('Transform', 'ADBE Transform Group'));
      tg.add(new Prop('Anchor Point', 'ADBE Anchor Point', PVT.TwoD_SPATIAL, [0, 0]));
      tg.add(new Prop('Position', 'ADBE Position', PVT.TwoD_SPATIAL, [comp.width / 2, comp.height / 2]));
      tg.add(new Prop('Scale', 'ADBE Scale', PVT.ThreeD, [100, 100, 100]));
      tg.add(new Prop('Rotation', 'ADBE Rotate Z', PVT.OneD, 0));
      tg.add(new Prop('Opacity', 'ADBE Opacity', PVT.OneD, 100));
      this.add(new Group('Effects', 'ADBE Effect Parade', PT.INDEXED_GROUP));
      this.add(new Group('Masks', 'ADBE Mask Parade', PT.INDEXED_GROUP));
      this.add(new Prop('Marker', 'ADBE Marker', PVT.MARKER, null));
    }
    get name(): string { return this._customName ?? (this.source ? this.source.name : ''); }
    set name(v: string) { this._customName = v; }
    get locked() { return this._locked; } set locked(v: boolean) { this._locked = !!v; }
    _chk() { if (this._locked) throw new Error(`Layer '${this.name}' is locked`); if (this._removed) throw new Error('Object is invalid'); }
    get index() { return this.containingComp._layers.indexOf(this) + 1; }
    _timeBased() { return this.source instanceof CompItem; }
    get inPoint() { return this._in; } set inPoint(v: number) { this._chk(); this._in = Math.max(v, this._timeBased() ? this.startTime : -1e9); }
    get outPoint() { return this._out; } set outPoint(v: number) { this._chk(); this._out = this._timeBased() ? Math.min(v, this.startTime + this.source.duration) : v; }
    get startTime() { return this._start; }
    set startTime(v: number) { this._chk(); const d = v - this._start; this._start = v; this._in += d; this._out += d; for (const p of leaves(this)) for (const k of p.keys) k.time += d; }
    get propertyDepth() { return 0; }
    sourceRectAtTime() { return { ...this.rect }; }
    remove() { this._chk(); const c = this.containingComp; c._layers.splice(c._layers.indexOf(this), 1); this._removed = true; for (const L of c._layers) if (L.trackMatteLayer === this) L.trackMatteLayer = null; }
    moveAfter(o: Any) { const a = this.containingComp._layers; a.splice(a.indexOf(this), 1); a.splice(a.indexOf(o) + 1, 0, this); }
    moveToEnd() { const a = this.containingComp._layers; a.splice(a.indexOf(this), 1); a.push(this); }
    moveToBeginning() { const a = this.containingComp._layers; a.splice(a.indexOf(this), 1); a.unshift(this); }
    setTrackMatte(L: Any, type: number) { this._chk(); this.trackMatteLayer = L; this.trackMatteType = type; }
    removeTrackMatte() { this._chk(); this.trackMatteLayer = null; }
    _copyInto(comp: Any) {
      const C = this.constructor as Any;
      const n = new C(comp, this.name);
      n.children = []; for (const c of this.children) n.add(c.clone());
      for (const k of ['_start', '_in', '_out', 'stretch', 'comment', 'threeDLayer', 'motionBlur', 'source', 'rect', '_customName']) n[k] = cloneV(this[k]);
      return n;
    }
    duplicate() { const n = this._copyInto(this.containingComp); n.name = this.name + ' 2'; const a = this.containingComp._layers; a.splice(a.indexOf(this), 0, n); return n; }
    copyToComp(comp: Any) { if (this.name === 'Broken') throw new Error('copy failed'); comp._layers.push(this._copyInto(comp)); }
    _toComp(pt: number[], t: number): number[] {
      const tg = this.property('ADBE Transform Group');
      const a = tg.property('ADBE Anchor Point').valueAtTime(t, true), p = tg.property('ADBE Position').valueAtTime(t, true);
      const s = tg.property('ADBE Scale').valueAtTime(t, true), r = tg.property('ADBE Rotate Z').valueAtTime(t, true) * Math.PI / 180;
      const x = (pt[0] - a[0]) * s[0] / 100, y = (pt[1] - a[1]) * s[1] / 100;
      const out = [p[0] + x * Math.cos(r) - y * Math.sin(r), p[1] + x * Math.sin(r) + y * Math.cos(r)];
      return this.parent ? this.parent._toComp(out, t) : out;
    }
  }
  class AVLayer extends Layer {}
  // As in After Effects: shape and text layers are not AVLayer instances.
  class TextLayer extends Layer {
    constructor(comp: Any, name?: string, text?: string) { super(comp, name); const t = this.add(new Group('Text', 'ADBE Text Properties')); t.add(new Prop('Source Text', 'ADBE Text Document', PVT.TEXT_DOCUMENT, new TextDocument(text ?? name ?? ''))); }
  }
  class ShapeLayer extends Layer {
    constructor(comp: Any, name?: string) { super(comp, name); this.add(new Group('Contents', 'ADBE Root Vectors Group', PT.INDEXED_GROUP)); }
  }
  class CameraLayer extends Layer {}
  class LightLayer extends Layer {}
  function leaves(g: Any): Any[] { const out: Any[] = []; const walk = (x: Any) => { for (const c of x.children ?? []) { if (c instanceof Prop) out.push(c); else walk(c); } }; walk(g); return out; }
  function wrapLayer(L: Any): Any {
    return {
      source: L.source instanceof CompItem ? { layer: (i: number) => wrapLayer(L.source.layer(i)) } : null,
      transform: { anchorPoint: { valueAtTime: (t: number) => L.property('ADBE Transform Group').property('ADBE Anchor Point').valueAtTime(t, true) } },
      toComp: (p: number[], t?: number) => L._toComp(p, t ?? 0),
    };
  }
  function wrapComp(c: Any) { return { layer: (i: number) => wrapLayer(c.layer(i)) }; }

  class Item {
    [k: string]: Any;
    constructor(name: string) { this.id = nextId++; this.name = name; this.comment = ''; this._parent = null; }
    get parentFolder() { return this._parent; }
    set parentFolder(f: Any) { if (this._parent) this._parent.items.splice(this._parent.items.indexOf(this), 1); this._parent = f; f.items.push(this); }
    remove() { project._items.splice(project._items.indexOf(this), 1); if (this._parent) this._parent.items.splice(this._parent.items.indexOf(this), 1); }
  }
  class FolderItem extends Item {
    constructor(name: string) { super(name); this.items = []; }
    get numItems() { return this.items.length; }
    item(i: number) { return this.items[i - 1]; }
  }
  class FootageItem extends Item {
    constructor(name: string, w: number, h: number) { super(name); Object.assign(this, { width: w, height: h, duration: 0, pixelAspect: 1, mainSource: new (SolidSource as Any)() }); this.mainSource.isStill = true; }
    get usedIn() { return project._items.filter((c: Any) => c instanceof CompItem && c._layers.some((L: Any) => L.source === this)); }
  }
  class CompItem extends Item {
    constructor(name: string, w: number, h: number, pa: number, duration: number, fps: number) {
      super(name);
      Object.assign(this, { width: w, height: h, _duration: duration, frameRate: fps, frameDuration: 1 / fps, pixelAspect: pa, _layers: [], time: 0, workAreaStart: 0, workAreaDuration: duration, motionBlur: false, motionBlurSamplesPerFrame: 16, bgColor: [0, 0, 0] });
      this.markerProperty = new Prop('Marker', 'ADBE Marker', PVT.MARKER, null);
      const self = this as Any;
      this.layers = {
        add(item: Any, dur?: number) {
          const L: Any = new AVLayer(self); L.source = item;
          L._out = item instanceof CompItem ? item.duration : (dur ?? self.duration);
          L.property('ADBE Transform Group').property('ADBE Anchor Point')._value = [item.width / 2, item.height / 2];
          self._layers.unshift(L); return L;
        },
        addText(text: string) { const L = new TextLayer(self, String(text).split('\r')[0], text); L.rect = { left: 0, top: -30, width: 300, height: 40 }; self._layers.unshift(L); return L; },
        addShape() { const L = new ShapeLayer(self, 'Shape Layer 1'); self._layers.unshift(L); return L; },
        addSolid(color: number[], name: string, w: number, h: number) { const it = new FootageItem(name, w, h); project._items.push(it); it.parentFolder = project.rootFolder; return this.add(it); },
      };
    }
    get duration() { return this._duration; }
    set duration(v: number) { this._duration = v; }
    get numLayers() { return this._layers.length; }
    layer(i: number) { return this._layers[i - 1]; }
    get usedIn() { return project._items.filter((c: Any) => c instanceof CompItem && c._layers.some((L: Any) => L.source === this)); }
  }

  const project: Any = {
    _items: [] as Any[],
    get numItems() { return this._items.length; },
    item(i: number) { return this._items[i - 1]; },
    itemByID(id: number) { return this._items.find((x: Any) => x.id === id) ?? null; },
    items: {
      addComp(name: string, w: number, h: number, pa: number, d: number, fps: number) { const c = new CompItem(name, w, h, pa, d, fps); project._items.push(c); c.parentFolder = project.rootFolder; return c; },
      addFolder(name: string) { const f = new FolderItem(name); project._items.push(f); f.parentFolder = project.rootFolder; return f; },
    },
    activeItem: null,
  };
  project.rootFolder = new FolderItem('Root');
  const app = { version: '26.5.0x12', project };
  const ctx: Any = {
    app, CompItem, FolderItem, FootageItem, AVLayer, TextLayer, ShapeLayer, CameraLayer, LightLayer, MarkerValue, TextDocument, KeyframeEase, Shape, SolidSource,
    PlaceholderSource: function () { /* marker class */ }, PropertyValueType: PVT, PropertyType: PT, KeyframeInterpolationType: KIT, TrackMatteType: TMT,
    BlendingMode: { NORMAL: 1, DIFFERENCE: 2 }, ParagraphJustification: { LEFT_JUSTIFY: 1, CENTER_JUSTIFY: 2 }, MaskMode: {},
    Folder: { myDocuments: { fsName: '/tmp' } }, MCP_BRIDGE_VERSION: 'test', console,
  };
  vm.createContext(ctx);
  for (const f of ['polyfills.jsx', 'json.jsx', 'core.jsx', 'color.jsx', 'undo.jsx', 'resolve.jsx', 'serialize.jsx', 'easing.jsx']) {
    vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'lib', f), 'utf8'), ctx, { filename: f });
  }
  for (const f of fs.readdirSync(path.join(SCRIPTS, 'commands')).filter((n) => n.endsWith('.jsx')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(SCRIPTS, 'commands', f), 'utf8'), ctx, { filename: f });
  }
  const run = (cmd: string, args: Any): Any => JSON.parse(JSON.stringify(ctx.MCP.commands[cmd](JSON.parse(JSON.stringify(args)), {})));
  const comp = (name: string): Any => project._items.find((i: Any) => i instanceof CompItem && i.name === name);
  const shape = (c: Any, name: string, pos: number[], w: number, h: number) => { const L: Any = new ShapeLayer(c, name); L.rect = { left: -w / 2, top: -h / 2, width: w, height: h }; L.property('ADBE Transform Group').property('ADBE Position').setValue(pos); c._layers.unshift(L); return L; };
  const text = (c: Any, name: string, pos: number[]) => { const L: Any = new TextLayer(c, name, name); L.rect = { left: 0, top: -40, width: 160, height: 50 }; L.property('ADBE Transform Group').property('ADBE Position').setValue(pos); c._layers.unshift(L); return L; };
  /** Everything a transition may touch, without record ids, to compare before and after. */
  const snapshot = () => JSON.stringify(project._items.filter((i: Any) => i instanceof CompItem).map((c: Any) => ({
    comp: c.name, motionBlur: c.motionBlur,
    layers: c._layers.map((L: Any) => ({
      name: L.name, comment: L.comment.replace(/ t[a-z0-9]+\]/, ']'), in: L.inPoint.toFixed(4), out: L.outPoint.toFixed(4), start: L.startTime.toFixed(4), mb: L.motionBlur, matte: L.trackMatteLayer ? L.trackMatteLayer.name : null,
      effects: L.property('ADBE Effect Parade').children.map((e: Any) => e.matchName),
      keys: leaves(L).filter((p: Any) => p.matchName !== 'ADBE Marker').map((p: Any) => [p.matchName, p.keys.map((k: Any) => [k.time.toFixed(4), JSON.stringify(k.value)]), JSON.stringify(p._value)]),
      markers: L.property('ADBE Marker').keys.length,
    })),
  })));
  return { run, comp, shape, text, snapshot, ctx };
}

/** The live replay: a three-scene plan with elements inside the scenes. */
function livePlan() {
  const ae = makeFakeAE();
  ae.run('createScenePlan', {
    filmName: 'Launch Film', fps: 30,
    scenes: [{ name: 'Intro', duration: 3, transition: 'match-cut' }, { name: 'Feature', duration: 4, transition: 'shape-reveal', overlapFrames: 15 }, { name: 'Outro', duration: 2 }],
  });
  ae.shape(ae.comp('01 Intro'), 'Send', [1500, 900], 160, 64);
  ae.shape(ae.comp('02 Feature'), 'Chip', [960, 540], 320, 96);
  ae.text(ae.comp('01 Intro'), 'Logo', [400, 200]);
  ae.text(ae.comp('02 Feature'), 'Logo', [1700, 120]);
  return ae;
}
const PAIR_IN_PLAN = { comp: { name: 'Launch Film' }, outgoing: { name: '01 Intro' }, incoming: { name: '02 Feature' } };
const masterNames = (ae: ReturnType<typeof makeFakeAE>) => ae.comp('Launch Film')._layers.map((L: Any) => L.name);

describe('transitions in After Effects (vm, fake model)', () => {
  it('a carried element never takes over a scene layer, wherever copyToComp puts the copy', () => {
    const ae = livePlan();
    ae.run('addTransition', PAIR_IN_PLAN);
    expect(masterNames(ae)).toEqual(['03 Outro', '02 Feature', '01 Intro']);
    const carryArgs = { ...PAIR_IN_PLAN, carry: { outgoing: { name: 'Send' }, incoming: { name: 'Chip' } }, replace: true };
    const r = ae.run('addTransition', carryArgs);
    expect(r.carry).toMatchObject({ created: true, layer: { index: 1, name: 'Send Carry' } });
    expect(masterNames(ae)).toEqual(['Send Carry', '03 Outro', '02 Feature', '01 Intro']);
    // Running it again replaces the carry instead of piling up copies or renaming scenes.
    ae.run('addTransition', carryArgs);
    expect(masterNames(ae)).toEqual(['Send Carry', '03 Outro', '02 Feature', '01 Intro']);
    const master = ae.comp('Launch Film');
    expect(master._layers[1].startTime).toBeCloseTo(195 / 30, 4);
    const removed = ae.run('removeTransition', { comp: { name: 'Launch Film' }, all: true });
    expect(removed.removed[0].layersDeleted).toEqual(['Send Carry']);
    expect(masterNames(ae)).toEqual(['03 Outro', '02 Feature', '01 Intro']);
    expect(ae.comp('01 Intro')._layers.find((L: Any) => L.name === 'Send').outPoint).toBeCloseTo(3, 4);
  });

  it('measures through shape and text layers (they are not AVLayer in After Effects)', () => {
    const ae = livePlan();
    const r = ae.run('carryElement', { comp: { name: 'Launch Film' }, outgoing: { scene: { name: '01 Intro' }, layer: { name: 'Logo' } }, incoming: { scene: { name: '02 Feature' }, layer: { name: 'Logo' } }, framesOut: 8, framesIn: 12 });
    expect(r).toMatchObject({ cutFrame: 90, startFrame: 82, endFrame: 102 });
    expect(r.carry.poses.start.center.map(Math.round)).toEqual([480, 185]);
    expect(masterNames(ae)).toEqual(['Logo Carry', '03 Outro', '02 Feature', '01 Intro']);
  });

  it('a call that fails part way leaves the project as it was', () => {
    const ae = livePlan();
    ae.run('addTransition', PAIR_IN_PLAN);
    ae.shape(ae.comp('01 Intro'), 'Broken', [300, 300], 50, 50);
    const before = ae.snapshot();
    // Fails inside the copy, after the replaced transition was removed and the scene keys were written.
    expect(() => ae.run('addTransition', { ...PAIR_IN_PLAN, carry: { outgoing: { name: 'Broken' }, incoming: { name: 'Chip' } }, replace: true })).toThrow(/copy failed.*built again/);
    expect(ae.snapshot()).toEqual(before);
    // Fails on the window check after the replaced transition was removed.
    expect(() => ae.run('addTransition', { ...PAIR_IN_PLAN, kind: 'push', replace: true })).toThrow(/overlap of at least/);
    expect(ae.snapshot()).toEqual(before);
    // Fails before any change.
    expect(() => ae.run('addTransition', { ...PAIR_IN_PLAN, carry: { outgoing: { name: 'Nope' }, incoming: { name: 'Chip' } }, replace: true })).toThrow(/No layer named 'Nope'/);
    expect(() => ae.run('carryElement', { comp: { name: 'Launch Film' }, outgoing: { scene: { name: '01 Intro' }, layer: { name: 'Broken' } }, incoming: { pose: { position: [960, 540] } } })).toThrow(/copy failed/);
    expect(() => ae.run('removeTransition', { comp: { name: 'Launch Film' }, id: 'zzz' })).toThrow(/No transition/);
    expect(ae.snapshot()).toEqual(before);
    expect(masterNames(ae).some((n: string) => /probe/i.test(n))).toBe(false);
  });

  it('removal deletes only layers that carry the record tag', () => {
    const ae = livePlan();
    const r = ae.run('addTransition', { ...PAIR_IN_PLAN, carry: { outgoing: { name: 'Send' }, incoming: { name: 'Chip' } } });
    const carry = ae.comp('Launch Film')._layers.find((L: Any) => L.name === 'Send Carry');
    carry.comment = 'kept by hand';
    const res = ae.run('removeTransition', { comp: { name: 'Launch Film' }, id: r.transition.id });
    expect(res.removed[0].layersDeleted).toEqual([]);
    expect(res.notes.join(' ')).toMatch(/does not carry its tag/);
    expect(masterNames(ae)).toEqual(['Send Carry', '03 Outro', '02 Feature', '01 Intro']);
  });

  it('a ripple rebuilds the carry at the new cut and keeps the scene layers', () => {
    const ae = livePlan();
    ae.run('addTransition', { ...PAIR_IN_PLAN, carry: { outgoing: { name: 'Send' }, incoming: { name: 'Chip' } } });
    const r = ae.run('setSceneDuration', { comp: { name: 'Launch Film' }, scene: 'Intro', duration: 4 });
    expect(r.transitionsRebuilt).toHaveLength(1);
    expect(r.transitionsRebuilt[0].cutFrame).toBe(120);
    expect(masterNames(ae)).toEqual(['Send Carry', '03 Outro', '02 Feature', '01 Intro']);
    expect(r.scenes.map((s: Any) => [s.inFrame, s.outFrame])).toEqual([[0, 120], [120, 240], [225, 285]]);
  });
});

/** The frame area a scene layer fills at time t: its transformed source rectangle, widened by a Motion Tile. */
function filledRect(L: Any, t: number) {
  const w = L.source.width, h = L.source.height;
  const tile = L.property('ADBE Effect Parade').children.find((e: Any) => e.matchName === 'ADBE Tile');
  const ow = tile ? tile.property('ADBE Tile-0004')._value : 100, oh = tile ? tile.property('ADBE Tile-0005')._value : 100;
  const ex = ((ow - 100) / 200) * w, ey = ((oh - 100) / 200) * h;
  const a = L._toComp([-ex, -ey], t), b = L._toComp([w + ex, h + ey], t);
  return { l: Math.min(a[0], b[0]), r: Math.max(a[0], b[0]), t: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]) };
}
const coversFrame = (R: Any) => R.l <= 0.5 && R.t <= 0.5 && R.r >= 1919.5 && R.b >= 1079.5;
const keyTimes = (L: Any) => {
  const tg = L.property('ADBE Transform Group');
  return [...new Set([...tg.property('ADBE Position').keys, ...tg.property('ADBE Scale').keys].map((k: Any) => k.time))].sort((x, y) => x - y);
};
/** Every keyed frame of the layer and four frames between each pair, inside its in and out points. */
function sampleTimes(L: Any): number[] {
  const ks = keyTimes(L), out: number[] = [];
  for (let i = 0; i < ks.length; i++) {
    out.push(ks[i]);
    if (i + 1 < ks.length) for (let j = 1; j < 5; j++) out.push(ks[i] + ((ks[i + 1] - ks[i]) * j) / 5);
  }
  return out.filter((t) => t >= L.inPoint - 1e-6 && t <= L.outPoint + 1e-6);
}
function expectSceneCovers(ae: ReturnType<typeof makeFakeAE>, name: string) {
  const L = ae.comp('Launch Film')._layers.find((x: Any) => x.name === name);
  const times = sampleTimes(L);
  expect(times.length, name).toBeGreaterThan(0);
  for (const t of times) {
    const R = filledRect(L, t);
    expect(coversFrame(R), `${name} at frame ${Math.round(t * 30)}: ${JSON.stringify(R)}`).toBe(true);
  }
}

describe('scenes keep covering the frame through a transition (vm, fake model)', () => {
  it('match cut with a carried element: both scales rise together so the incoming covers and the elements still line up', () => {
    const ae = livePlan();
    const r = ae.run('addTransition', { ...PAIR_IN_PLAN, carry: { outgoing: { name: 'Send' }, incoming: { name: 'Chip' } } });
    // Exact alignment needs the incoming at 144 % shifted by (540, 360): its top left would show the frame edge.
    // The smallest covering incoming scale is 1 + 360 / 540 = 166.7 %, the outgoing rises by the same factor.
    expect(r.transition.details.incomingScale).toBeCloseTo(166.67, 1);
    expect(r.transition.details.outgoingScale).toBeCloseTo(288.68, 1);
    expect(r.carry.alignedAtCut).toBe(true);
    expect(r.notes.join(' ')).toMatch(/covers the frame while the elements line up/);
    expectSceneCovers(ae, '01 Intro');
    expectSceneCovers(ae, '02 Feature');
  });

  it('falls back to the closest covering pose when lining up would need more than 300 %', () => {
    const ae = livePlan();
    ae.shape(ae.comp('01 Intro'), 'Dot', [1800, 1000], 80, 80);
    ae.shape(ae.comp('02 Feature'), 'Pill', [100, 80], 160, 160);
    const r = ae.run('addTransition', { ...PAIR_IN_PLAN, carry: { outgoing: { name: 'Dot' }, incoming: { name: 'Pill' } } });
    expect(r.transition.details.outgoingScale).toBeCloseTo(300, 1);
    expect(r.transition.details.incomingScale).toBeLessThanOrEqual(300.01);
    expect(r.notes.join(' ')).toMatch(/opens shifted by/);
    expect(r.carry.alignedAtCut).toBe(false);
    expectSceneCovers(ae, '01 Intro');
    expectSceneCovers(ae, '02 Feature');
  });

  it('every kind that moves or scales a scene keeps it covering the frame', () => {
    const cases: Array<[string, Any]> = [
      ['match-cut', {}],
      ['match-cut at a corner pivot', { kind: 'match-cut', origin: [40, 30], intensity: 2 }],
      ['match-cut pivot outside the frame', { kind: 'match-cut', origin: [2400, -300] }],
      ['match-cut slide with carry', { kind: 'match-cut', move: 'position', direction: 'right', carry: { outgoing: { name: 'Send' }, incoming: { name: 'Chip' } } }],
      ['zoom-through', { kind: 'zoom-through', origin: [1900, 1060] }],
      ['blur-swap', { kind: 'blur-swap', origin: [0, 0] }],
      ['whip left', { kind: 'whip', direction: 'left', intensity: 2 }],
      ['whip up', { kind: 'whip', direction: 'up' }],
    ];
    for (const [label, extra] of cases) {
      const ae = livePlan();
      ae.run('addTransition', { ...PAIR_IN_PLAN, ...extra });
      for (const n of ['01 Intro', '02 Feature']) {
        try { expectSceneCovers(ae, n); } catch (e) { throw new Error(`${label}: ${(e as Error).message}`); }
      }
    }
  });

  it('push keeps the two scenes edge to edge, so together they cover the frame', () => {
    const ae = livePlan();
    ae.run('addTransition', { comp: { name: 'Launch Film' }, outgoing: { name: '02 Feature' }, incoming: { name: '03 Outro' }, kind: 'push', direction: 'up' });
    const A = ae.comp('Launch Film')._layers.find((x: Any) => x.name === '02 Feature');
    const B = ae.comp('Launch Film')._layers.find((x: Any) => x.name === '03 Outro');
    const times = [...new Set([...sampleTimes(A), ...sampleTimes(B)])].filter((t) => t >= B.inPoint - 1e-6 && t <= A.outPoint + 1e-6);
    expect(times.length).toBeGreaterThan(2);
    for (const t of times) {
      const a = filledRect(A, t), b = filledRect(B, t);
      expect(a.l <= 0.5 && b.l <= 0.5 && a.r >= 1919.5 && b.r >= 1919.5, `frame ${t * 30}`).toBe(true);
      expect(Math.min(a.t, b.t) <= 0.5 && Math.max(a.b, b.b) >= 1079.5, `frame ${t * 30}`).toBe(true);
      expect(Math.abs(a.t - b.b) < 0.5 || Math.abs(b.t - a.b) < 0.5, `edges meet at frame ${t * 30}`).toBe(true);
    }
  });
});

