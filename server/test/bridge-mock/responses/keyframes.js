/*
 * Mock result shapes for the keyframes command group. See core.js for helpers and shapes to mirror.
 * The four original keyframe commands live in core.js; this file covers the editing commands.
 */

const FPS = 30;
const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });
const propertyState = (path = 'Transform/Opacity', value = 100, numKeys = 0) => ({
  name: path.split('/').pop(),
  matchName: 'ADBE ' + path.split('/').pop(),
  path,
  matchPath: path,
  index: 1,
  isGroup: false,
  value,
  valueType: Array.isArray(value) ? (value.length === 2 ? '2d-spatial' : '3d') : '1d',
  dimensions: Array.isArray(value) ? value.length : 1,
  canVaryOverTime: true,
  isSpatial: path.endsWith('Position'),
  numKeys,
  hasExpression: false,
});
const keyframe = (i, time, value, over = {}) => ({
  index: i,
  time,
  frame: Math.round(time * FPS),
  value,
  inInterpolation: 'bezier',
  outInterpolation: 'bezier',
  easeIn: [{ speed: 0, influence: 33.33 }],
  easeOut: [{ speed: 0, influence: 33.33 }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
  ...over,
});
const propertyResult = (path, value, numKeys, extra = {}) => ({ composition: comp(), layer: layerRef(), property: propertyState(path, value, numKeys), ...extra });
const seconds = (args, secondsName, framesName, fallback) => (args[framesName] !== undefined ? args[framesName] / FPS : args[secondsName] !== undefined ? args[secondsName] : fallback);
/* The mock property always carries three keys at 0, 0.5 and 1 second. */
const baseKeys = () => [keyframe(1, 0, 0), keyframe(2, 0.5, 50), keyframe(3, 1, 100)];
const select = (keys, sel) => {
  if (sel === undefined || sel === 'all') return keys.map((k) => k.index);
  if (Array.isArray(sel)) return sel;
  const from = sel.fromFrame !== undefined ? sel.fromFrame / FPS : sel.from ?? 0;
  const to = sel.toFrame !== undefined ? sel.toFrame / FPS : sel.to ?? 1;
  return keys.filter((k) => k.time >= from - 1 / 60 && k.time <= to + 1 / 60).map((k) => k.index);
};

export const responses = {
  deleteKeyframe: (args) => {
    const keys = baseKeys();
    const t = seconds(args, 'time', 'frame', 0);
    const idx = args.index ?? (keys.find((k) => Math.abs(k.time - t) < 1 / 60)?.index ?? 1);
    const removed = keys[idx - 1] ?? keys[0];
    const remaining = keys.filter((k) => k.index !== removed.index).map((k, i) => ({ ...k, index: i + 1 }));
    return propertyResult(args.property, 100, remaining.length, { removed, keyframes: remaining });
  },
  deleteKeyframesInRange: (args) => {
    const start = seconds(args, 'start', 'startFrame', 0);
    const end = seconds(args, 'end', 'endFrame', 10);
    const keys = baseKeys();
    const gone = keys.filter((k) => k.time >= start - 1 / 60 && k.time <= end + 1 / 60);
    const remaining = keys.filter((k) => !gone.includes(k)).map((k, i) => ({ ...k, index: i + 1 }));
    return propertyResult(args.property, 100, remaining.length, {
      removedCount: gone.length,
      removedTimes: gone.map((k) => k.time),
      range: { start, end, startFrame: Math.round(start * FPS), endFrame: Math.round(end * FPS) },
      keyframes: remaining,
    });
  },
  clearKeyframes: (args) => {
    const keep = args.keepValue !== false;
    const at = seconds(args, 'keepValueAtTime', 'keepValueAtFrame', 0);
    return propertyResult(args.property, 50, 0, { removedCount: 3, keptValue: keep ? 50 : null, keptValueAt: keep ? at : null });
  },
  moveKeyframes: (args) => {
    const keys = baseKeys();
    const sel = select(keys, args.keys);
    const offset = seconds(args, 'offset', 'offsetFrames', 0);
    const scale = args.scale ?? 1;
    const pivot = seconds(args, 'pivot', 'pivotFrame', keys[sel[0] - 1].time);
    const moved = [];
    const out = keys.map((k) => {
      if (!sel.includes(k.index)) return k;
      const to = pivot + (k.time - pivot) * scale + offset;
      moved.push({ from: k.time, to, index: k.index });
      return { ...k, time: to, frame: Math.round(to * FPS) };
    });
    return propertyResult(args.property, 100, out.length, { movedCount: moved.length, offset, scale, pivot, overwritten: 0, moved, keyframes: out });
  },
  setKeyframeEasing: (args) => {
    const keys = baseKeys();
    const sel = select(keys, args.keys);
    const inf = args.easing === 'linear' ? 16.67 : 66;
    const out = keys.map((k) => (sel.includes(k.index) ? { ...k, easeIn: [{ speed: 0, influence: inf }], inInterpolation: args.easing === 'linear' ? 'linear' : 'bezier' } : k));
    return propertyResult(args.property, 100, out.length, { easing: args.easing, appliedTo: sel, keyframes: out });
  },
  copyKeyframes: (args) => {
    if (args.fromProperty === 'Transform/Position' && args.toProperty === 'Transform/Opacity') {
      throw Object.assign(new Error("Cannot copy keyframes from 'Transform/Position' (2 dimension(s)) to 'Transform/Opacity' (1 dimension(s)). Pick a target with the same value type."), { mcpCode: 'invalid-argument' });
    }
    const offset = seconds(args, 'timeOffset', 'frameOffset', 0);
    const mult = Array.isArray(args.valueMultiplier) ? args.valueMultiplier[0] : args.valueMultiplier ?? 1;
    const keys = baseKeys().map((k) => ({ ...k, time: k.time + offset, frame: Math.round((k.time + offset) * FPS), value: k.value * mult }));
    return propertyResult(args.toProperty ?? args.fromProperty, 100, keys.length, {
      from: { composition: comp(), layer: layerRef(1, 'Source'), property: args.fromProperty },
      copiedCount: keys.length,
      timeOffset: offset,
      keyframes: keys,
    });
  },
  reverseKeyframes: (args) => {
    const keys = baseKeys();
    const sel = select(keys, args.keys);
    const first = keys[sel[0] - 1].time, last = keys[sel[sel.length - 1] - 1].time;
    const mid = (first + last) / 2;
    const out = keys.map((k) => (sel.includes(k.index) ? { ...k, time: mid + (mid - k.time), frame: Math.round((mid + (mid - k.time)) * FPS) } : k)).sort((a, b) => a.time - b.time).map((k, i) => ({ ...k, index: i + 1 }));
    return propertyResult(args.property, 100, out.length, { reversedCount: sel.length, range: { start: first, end: last, midpoint: mid }, keyframes: out });
  },
  setKeyframeInterpolation: (args) => {
    const keys = baseKeys();
    const sel = select(keys, args.keys);
    const out = keys.map((k) => (sel.includes(k.index) ? { ...k, inInterpolation: args.type === 'hold' ? k.inInterpolation : args.type, outInterpolation: args.type } : k));
    return propertyResult(args.property, 100, out.length, { interpolation: args.type, appliedTo: sel, keyframes: out });
  },
  bakeExpressionToKeyframes: (args) => {
    const start = seconds(args, 'start', 'startFrame', 0);
    const end = seconds(args, 'end', 'endFrame', 10);
    const step = args.step ?? 1;
    const count = Math.floor((end - start) * FPS / step + 1e-6) + 1;
    if (count > 5000 && !args.allowLarge) {
      throw Object.assign(new Error(`Baking would write ${count} keyframes (limit 5000). Narrow start/end, raise step, or pass allowLarge true.`), { mcpCode: 'invalid-argument' });
    }
    const linear = { inInterpolation: 'linear', outInterpolation: 'linear' };
    return propertyResult(args.property, 100, count, {
      bakedExpression: 'wiggle(2, 10)',
      sampleCount: count,
      stepFrames: step,
      range: { start, end, startFrame: Math.round(start * FPS), endFrame: Math.round(end * FPS) },
      first: keyframe(1, start, 0, linear),
      last: keyframe(count, end, 100, linear),
    });
  },
  staggerKeyframesAcrossLayers: (args) => {
    const layers = Array.isArray(args.layers) ? args.layers.map((l, i) => layerRef(l.index ?? i + 1, l.name ?? `Layer ${l.index ?? i + 1}`)) : [layerRef(1, 'Layer 1'), layerRef(2, 'Layer 2'), layerRef(3, 'Layer 3')];
    const interval = seconds(args, 'interval', 'intervalFrames', 0.1);
    const startAt = seconds(args, 'startTime', 'startFrame', 0);
    const ordered = args.order === 'bottom-up' ? [...layers].reverse() : layers;
    const results = ordered.map((L, i) => {
      const offset = startAt + i * interval;
      const keys = (args.keys ?? []).map((k, j) => keyframe(j + 1, (k.frame !== undefined ? k.frame / FPS : k.time ?? 0) + offset, k.value));
      return { order: i, status: 'ok', layer: L, property: args.property, offset, offsetFrame: Math.round(offset * FPS), keyframesWritten: keys.length, keyframes: keys };
    });
    return { composition: comp(), layers: results.length, failed: 0, interval, order: args.order ?? 'top-down', results };
  },
};
