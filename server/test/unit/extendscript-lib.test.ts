/*
 * Runs the pure parts of the ExtendScript library inside a Node vm with the
 * After Effects globals stubbed, so easing, colour, JSON, path parsing and the
 * polyfills are unit-tested without After Effects.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { beforeAll, describe, expect, it } from 'vitest';

const LIB = path.resolve(__dirname, '..', '..', 'src', 'scripts', 'lib');

interface FakeProp {
  isSpatial: boolean;
  value: unknown;
  numKeys: number;
  keys: Array<{ time: number; value: unknown; inType: number; outType: number; inEase: unknown[]; outEase: unknown[] }>;
  canVaryOverTime: boolean;
  keyTime(i: number): number;
  keyValue(i: number): unknown;
  keyInInterpolationType(i: number): number;
  keyOutInterpolationType(i: number): number;
  setInterpolationTypeAtKey(i: number, a: number, b: number): void;
  keyInTemporalEase(i: number): unknown[];
  keyOutTemporalEase(i: number): unknown[];
  setTemporalEaseAtKey(i: number, a: unknown[], b: unknown[]): void;
  setTemporalAutoBezierAtKey(): void;
  setTemporalContinuousAtKey(): void;
  setValueAtTime(t: number, v: unknown): void;
  nearestKeyIndex(t: number): number;
  setSpatialAutoBezierAtKey(): void;
  setSpatialContinuousAtKey(): void;
  setSpatialTangentsAtKey(): void;
  propertyDepth: number;
}

function makeContext(): vm.Context {
  const ctx: Record<string, unknown> = {
    MCP_BRIDGE_VERSION: 'test',
    KeyframeInterpolationType: { LINEAR: 6412, BEZIER: 6414, HOLD: 6413 },
    KeyframeEase: function (this: { speed: number; influence: number }, speed: number, influence: number) {
      this.speed = speed;
      this.influence = influence;
    },
    PropertyType: { NAMED_GROUP: 6414, INDEXED_GROUP: 6415, PROPERTY: 6416 },
    app: { version: '24.6.0', project: { numItems: 0, activeItem: null } },
    Folder: { myDocuments: { fsName: '/tmp' } },
    File: function () {
      return { exists: false };
    },
    console,
  };
  vm.createContext(ctx);
  return ctx;
}

function load(ctx: vm.Context, ...files: string[]): void {
  for (const f of files) {
    const code = fs.readFileSync(path.join(LIB, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
}

function fakeProp(over: Partial<FakeProp> = {}): FakeProp {
  const prop: FakeProp = {
    isSpatial: false,
    value: 0,
    numKeys: 0,
    keys: [],
    canVaryOverTime: true,
    propertyDepth: 2,
    keyTime(i) {
      return this.keys[i - 1].time;
    },
    keyValue(i) {
      return this.keys[i - 1].value;
    },
    keyInInterpolationType(i) {
      return this.keys[i - 1].inType;
    },
    keyOutInterpolationType(i) {
      return this.keys[i - 1].outType;
    },
    setInterpolationTypeAtKey(i, a, b) {
      this.keys[i - 1].inType = a;
      this.keys[i - 1].outType = b;
    },
    keyInTemporalEase(i) {
      return this.keys[i - 1].inEase;
    },
    keyOutTemporalEase(i) {
      return this.keys[i - 1].outEase;
    },
    setTemporalEaseAtKey(i, a, b) {
      this.keys[i - 1].inEase = a;
      this.keys[i - 1].outEase = b;
    },
    setTemporalAutoBezierAtKey() {},
    setTemporalContinuousAtKey() {},
    setValueAtTime(t, v) {
      const existing = this.keys.findIndex((k) => Math.abs(k.time - t) < 1e-6);
      const key = { time: t, value: v, inType: 6412, outType: 6412, inEase: [{ speed: 0, influence: 0.1 }], outEase: [{ speed: 0, influence: 0.1 }] };
      if (existing >= 0) this.keys[existing] = key;
      else {
        this.keys.push(key);
        this.keys.sort((a, b) => a.time - b.time);
      }
      this.numKeys = this.keys.length;
    },
    nearestKeyIndex(t) {
      let best = 1;
      let bestD = Infinity;
      this.keys.forEach((k, i) => {
        const d = Math.abs(k.time - t);
        if (d < bestD) {
          bestD = d;
          best = i + 1;
        }
      });
      return best;
    },
    setSpatialAutoBezierAtKey() {},
    setSpatialContinuousAtKey() {},
    setSpatialTangentsAtKey() {},
    ...over,
  };
  return prop;
}

let ctx: vm.Context;
let MCP: Record<string, any>;

beforeAll(() => {
  ctx = makeContext();
  // Simulate an ES3 engine: remove the methods the polyfills provide, then load them.
  vm.runInContext(
    'delete Array.prototype.indexOf; delete Array.prototype.forEach; delete Array.prototype.map; delete Array.prototype.filter; delete Object.keys; delete String.prototype.trim; delete Array.isArray; JSON = undefined;',
    ctx
  );
  load(ctx, 'polyfills.jsx', 'json.jsx', 'core.jsx', 'color.jsx', 'undo.jsx', 'resolve.jsx', 'serialize.jsx', 'easing.jsx');
  MCP = vm.runInContext('MCP', ctx) as Record<string, any>;
});

describe('polyfills', () => {
  it('restore the ES5 array and object methods', () => {
    expect(vm.runInContext('[1,2,3].indexOf(2)', ctx)).toBe(1);
    expect(vm.runInContext('[1,2,3].map(function(x){return x*2})', ctx)).toEqual([2, 4, 6]);
    expect(vm.runInContext('[1,2,3].filter(function(x){return x>1}).length', ctx)).toBe(2);
    expect(vm.runInContext('Object.keys({a:1,b:2})', ctx)).toEqual(['a', 'b']);
    expect(vm.runInContext('"  x ".trim()', ctx)).toBe('x');
    expect(vm.runInContext('Array.isArray([])', ctx)).toBe(true);
  });
});

describe('JSON shim', () => {
  it('stringifies nested values with indentation and escapes', () => {
    const text = vm.runInContext('JSON.stringify({a:[1,"x\\ny",null,true], b:{c:"q\\"uote"}, d: undefined, e: NaN}, null, 2)', ctx) as string;
    expect(JSON.parse(text)).toEqual({ a: [1, 'x\ny', null, true], b: { c: 'q"uote' }, e: null });
    expect(text).toContain('\n  ');
  });
  it('parses JSON and rejects code', () => {
    expect(vm.runInContext('JSON.parse(\'{"a":[1,2,{"b":"c"}],"d":-1.5e2}\')', ctx)).toEqual({ a: [1, 2, { b: 'c' }], d: -150 });
    expect(() => vm.runInContext('JSON.parse("(function(){return 1})()")', ctx)).toThrow();
  });
});

describe('core helpers', () => {
  it('time arguments: frame wins, time next, default last', () => {
    const comp = { frameDuration: 1 / 25, time: 3 };
    expect(MCP.timeArg(comp, { time: 2, frame: 50 })).toBeCloseTo(2);
    expect(MCP.timeArg(comp, { time: 2 })).toBe(2);
    expect(MCP.timeArg(comp, {})).toBe(3);
    expect(MCP.timeArg(comp, {}, 0)).toBe(0);
    expect(MCP.frameOf(comp, 1)).toBe(25);
    expect(MCP.durationArg(comp, { durationFrames: 10 }, 'duration', 'durationFrames', 1)).toBeCloseTo(0.4);
  });
  it('normalises property paths', () => {
    expect(MCP.normalizePath('Transform/Position')).toEqual(['Transform', 'Position']);
    expect(MCP.normalizePath('/Effects/Gaussian Blur/Blurriness/')).toEqual(['Effects', 'Gaussian Blur', 'Blurriness']);
    expect(MCP.normalizePath(['Effects', 1])).toEqual(['Effects', 1]);
    expect(MCP.normalizePath('')).toEqual([]);
  });
  it('errors carry codes and details', () => {
    expect(() => MCP.fail('nope', 'not-found', { x: 1 })).toThrow('nope');
    try {
      MCP.fail('nope', 'not-found', { x: 1 });
    } catch (err) {
      const info = MCP.errorInfo(err, 'cmd', 'id1');
      expect(info).toMatchObject({ message: 'nope', code: 'not-found', command: 'cmd', id: 'id1', details: { x: 1 } });
    }
  });
});

describe('colour', () => {
  it('accepts hex, 0..1, 0..255 and objects', () => {
    expect(MCP.color.rgba('#ff0000')).toEqual([1, 0, 0, 1]);
    expect(MCP.color.rgba('#0f0')).toEqual([0, 1, 0, 1]);
    expect(MCP.color.rgba([255, 0, 0])).toEqual([1, 0, 0, 1]);
    expect(MCP.color.rgba([0, 0.5, 1, 0.5])).toEqual([0, 0.5, 1, 0.5]);
    expect(MCP.color.rgba({ r: 0, g: 0, b: 255 })).toEqual([0, 0, 1, 1]);
    expect(MCP.color.rgb([1, 1, 1, 0.2])).toEqual([1, 1, 1]);
    expect(MCP.color.toHex([1, 0, 0, 1])).toBe('#ff0000');
    expect(MCP.color.from255([255, 128, 0])).toEqual([1, 128 / 255, 0, 1]);
    expect(() => MCP.color.rgba('zzz')).toThrow();
  });
});

describe('easing', () => {
  it('resolves presets and custom specs', () => {
    expect(MCP.easing.resolve('linear').kind).toBe('linear');
    expect(MCP.easing.resolve('ease')).toMatchObject({ kind: 'bezier', out: { influence: 33.33 }, inn: { influence: 33.33 } });
    expect(MCP.easing.resolve('ease-out').out).toBeNull();
    expect(MCP.easing.resolve('ease-in').inn).toBeNull();
    expect(MCP.easing.resolve('snappy')).toMatchObject({ out: { influence: 75 }, inn: { influence: 25 } });
    expect(MCP.easing.resolve('hold').kind).toBe('hold');
    expect(MCP.easing.resolve({ type: 'custom', inInfluence: 200, outSpeed: 5 })).toMatchObject({ inn: { influence: 100 }, out: { speed: 5 } });
    expect(MCP.easing.resolve({ type: 'bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }).bezier).toEqual({ x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 });
    expect(() => MCP.easing.resolve('bogus')).toThrow(/Unknown easing preset/);
    expect(() => MCP.easing.resolve('@style.entrance')).toThrow(/resolved by the server/);
  });

  it('applies a segment: out handle of the previous key, in handle of the arriving key', () => {
    const prop = fakeProp();
    const i1 = MCP.easing.setKey(prop, 0, 0);
    const i2 = MCP.easing.setKey(prop, 1, 100);
    expect([i1, i2]).toEqual([1, 2]);
    MCP.easing.applySegment(prop, 2, 'ease-out');
    expect(prop.keys[0].outType).toBe(6412); // linear out of the first key
    expect(prop.keys[1].inType).toBe(6414); // bezier into the second
    expect((prop.keys[1].inEase[0] as { influence: number }).influence).toBe(66);
    MCP.easing.applySegment(prop, 2, 'hold');
    expect(prop.keys[0].outType).toBe(6413);
  });

  it('approximates cubic-bezier from the segment delta', () => {
    const prop = fakeProp();
    MCP.easing.setKey(prop, 0, 0);
    MCP.easing.setKey(prop, 2, 100);
    const handles = MCP.easing.bezierHandles(prop, 1, 2, { x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
    expect(handles.outInfluence).toBe(50);
    expect(handles.inInfluence).toBe(50);
    expect(handles.outSpeeds[0]).toBe(0);
    expect(handles.inSpeeds[0]).toBe(0);
    const fast = MCP.easing.bezierHandles(prop, 1, 2, { x1: 0.25, y1: 0.5, x2: 1, y2: 1 });
    expect(fast.outSpeeds[0]).toBeCloseTo(2 * 50); // slope 2 times 50 units per second
    expect(fast.outInfluence).toBe(25);
  });

  it('computes overshoot keys', () => {
    expect(MCP.easing.overshootKey(0, 0, 1, 100)).toEqual({ time: 0.75, value: 112 });
    expect(MCP.easing.overshootKey(0, [0, 0], 2, [10, 20], 0.5, 0.5)).toEqual({ time: 1, value: [15, 30] });
  });

  it('uses one ease per dimension for non-spatial arrays and one for spatial', () => {
    expect(MCP.easing.dims(fakeProp({ value: [100, 100] }))).toBe(2);
    expect(MCP.easing.dims(fakeProp({ value: [1, 2], isSpatial: true }))).toBe(1);
  });
});

describe('serialize helpers', () => {
  it('rounds values', () => {
    expect(MCP.roundValue(1.23456789)).toBe(1.2346);
    expect(MCP.roundValue([1.00001, 2])).toEqual([1, 2]);
  });
  it('maps label names and indices', () => {
    expect(MCP.enums.labelIndex('red')).toBe(1);
    expect(MCP.enums.labelIndex(3)).toBe(3);
    expect(() => MCP.enums.labelIndex('plaid')).toThrow();
  });
});
