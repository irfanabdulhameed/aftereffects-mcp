/*
 * Mock result shapes for the styles commands. See core.js for helpers and shapes to mirror.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 2, name = 'Card') => ({ index, id: 100 + index, name });

const LABELS = {
  'drop-shadow': 'Drop Shadow',
  'inner-shadow': 'Inner Shadow',
  'outer-glow': 'Outer Glow',
  'inner-glow': 'Inner Glow',
  'bevel-emboss': 'Bevel and Emboss',
  satin: 'Satin',
  'color-overlay': 'Color Overlay',
  'gradient-overlay': 'Gradient Overlay',
  stroke: 'Stroke',
};
const ORDER = Object.keys(LABELS);

const DEFAULTS = {
  'drop-shadow': { color: '#000000', opacity: 12, blendMode: 'multiply', angle: 90, useGlobalLight: false, distance: 6, spread: 0, size: 24, noise: 0, layerKnocksOut: true },
  'inner-shadow': { color: '#000000', opacity: 10, blendMode: 'multiply', angle: 90, useGlobalLight: false, distance: 2, spread: 0, size: 6, noise: 0 },
  'outer-glow': { color: '#ffffff', opacity: 35, blendMode: 'screen', noise: 0, spread: 0, size: 30, technique: 'softer', range: 50, jitter: 0 },
  'inner-glow': { color: '#ffffff', opacity: 25, blendMode: 'screen', noise: 0, spread: 0, size: 12, technique: 'softer', range: 50, jitter: 0, source: 'edge' },
  'bevel-emboss': { useGlobalLight: false, bevelStyle: 'inner-bevel', technique: 'smooth', depth: 100, direction: 'up', size: 6, soften: 4, angle: 90, altitude: 30, highlightMode: 'screen', highlightColor: '#ffffff', highlightOpacity: 40, shadowMode: 'multiply', shadowColor: '#000000', shadowOpacity: 25 },
  satin: { color: '#000000', opacity: 15, blendMode: 'multiply', angle: 45, distance: 10, size: 20, invert: true },
  'color-overlay': { color: '#ffffff', opacity: 100, blendMode: 'normal' },
  'gradient-overlay': { colors: null, opacity: 100, blendMode: 'normal', angle: 90, gradientStyle: 'linear', reverse: false, alignWithLayer: true, scale: 100, offset: [0, 0], smoothness: 100 },
  stroke: { color: '#000000', size: 1, opacity: 10, blendMode: 'normal', position: 'inside' },
};

const COLOR_KEYS = ['color', 'highlightColor', 'shadowColor'];

const hex = (c) => {
  if (typeof c === 'string') return c.toLowerCase();
  if (!Array.isArray(c)) return c;
  return '#' + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
};

/** Settings as list-layer-styles reads them back: colours as hex, gradient colours unreadable. */
const readBack = (kind, settings = {}) => {
  const out = { ...DEFAULTS[kind] };
  for (const [k, v] of Object.entries(settings)) {
    if (k === 'colors') continue;
    out[k] = COLOR_KEYS.includes(k) ? hex(v) : v;
  }
  return out;
};

const styleSummary = (kind, settings, over = {}) => ({
  kind,
  label: LABELS[kind],
  present: true,
  on: true,
  path: `Layer Styles/${LABELS[kind]}`,
  settings: readBack(kind, settings),
  keyed: {},
  ...over,
});

const layerList = (args) => {
  if (args.layer) return [layerRef(args.layer.index ?? 2, args.layer.name ?? 'Card')];
  if (Array.isArray(args.layers)) return args.layers.map((l, i) => layerRef(l.index ?? i + 2, l.name ?? `Layer ${i + 2}`));
  return [layerRef(2, 'Card'), layerRef(3, 'Button')];
};

const keyframe = (index, time, value, hold) => ({
  index,
  time,
  frame: Math.round(time * 30),
  value,
  inInterpolation: hold ? 'hold' : 'bezier',
  outInterpolation: hold ? 'hold' : 'bezier',
  easeIn: [{ speed: 0, influence: hold ? 16.67 : 80 }],
  easeOut: [{ speed: 0, influence: hold ? 16.67 : 30 }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});

const rampEffect = (settings = {}) => {
  const stops = settings.colors ?? [];
  const first = stops[0], last = stops[stops.length - 1];
  const colorOf = (s) => hex(Array.isArray(s) ? s : s?.color);
  return {
    effect: 'Gradient Overlay Colors',
    path: 'Effects/Gradient Overlay Colors',
    created: true,
    startPoint: [960, 640],
    endPoint: [960, 440],
    startColor: colorOf(first),
    endColor: colorOf(last),
    shape: settings.gradientStyle === 'radial' ? 'radial' : 'linear',
  };
};

export const responses = {
  addLayerStyle: (args) => {
    const kind = args.kind;
    const settings = args.settings ?? {};
    const ramp = kind === 'gradient-overlay' && Array.isArray(settings.colors);
    const results = layerList(args).map((layer) => ({
      status: 'ok',
      layer,
      kind,
      added: true,
      method: ramp ? 'gradient-ramp-effect' : 'menu',
      defaultsApplied: args.useDefaults ?? true,
      changed: Object.keys(settings).concat(args.fillOpacity !== undefined ? ['fillOpacity'] : []),
      style: ramp ? styleSummary(kind, {}, { present: false, on: false, settings: null }) : styleSummary(kind, settings),
      colorsEffect: ramp ? rampEffect(settings) : null,
      notes: ramp ? ["After Effects does not let scripts set layer-style gradient colours, so the colours are drawn by the Gradient Ramp effect 'Gradient Overlay Colors' (effects render before layer styles)."] : [],
    }));
    return {
      composition: comp(),
      count: results.length,
      failed: 0,
      results,
      kind,
      menuCommand: ramp ? null : { menuId: 9000 + ORDER.indexOf(kind), menuItem: `Layer > Layer Styles > ${LABELS[kind]}`, error: null, restoredViewer: false, restoredSelection: 0, relocked: 0 },
    };
  },

  setLayerStyle: (args) => {
    const kind = args.kind;
    const settings = args.settings ?? {};
    const byKey = new Map();
    for (const k of args.keyframes ?? []) {
      if (!byKey.has(k.setting)) byKey.set(k.setting, []);
      byKey.get(k.setting).push(k);
    }
    const keyframes = [...byKey.entries()].map(([setting, list]) => {
      const hold = ['blendMode', 'technique', 'source', 'bevelStyle', 'direction', 'gradientStyle', 'position', 'useGlobalLight', 'layerKnocksOut', 'invert', 'reverse', 'alignWithLayer'].includes(setting);
      const keys = list
        .map((k) => ({ t: k.time ?? (k.frame ?? 0) / 30, v: COLOR_KEYS.includes(setting) ? hex(k.value) : k.value }))
        .sort((a, b) => a.t - b.t)
        .map((k, i) => keyframe(i + 1, k.t, k.v, hold));
      return { setting, property: `Layer Styles/${LABELS[kind]}/${setting[0].toUpperCase()}${setting.slice(1)}`, matchName: `${kind}/${setting}`, numKeys: keys.length, keys };
    });
    const ramp = kind === 'gradient-overlay' && Array.isArray(settings.colors);
    const keyed = Object.fromEntries(keyframes.map((k) => [k.setting, k.numKeys]));
    return {
      composition: comp(),
      layer: layerRef(args.layer?.index ?? 2, args.layer?.name ?? 'Card'),
      kind,
      style: styleSummary(kind, settings, { keyed }),
      changed: Object.keys(settings).concat(args.fillOpacity !== undefined ? ['fillOpacity'] : []),
      keyframes,
      colorsEffect: ramp ? rampEffect(settings) : null,
      notes: [],
    };
  },

  removeLayerStyle: (args) => {
    const kinds = args.all ? ['drop-shadow', 'stroke'] : [args.kind];
    const results = layerList(args).map((layer) => ({
      status: 'ok',
      layer,
      turnedOff: kinds,
      alreadyOff: [],
      notAdded: args.all ? ORDER.filter((k) => !kinds.includes(k)) : [],
      colorsEffectOff: false,
    }));
    return { composition: comp(), count: results.length, failed: 0, results, kind: args.all ? 'all' : args.kind };
  },

  listLayerStyles: (args) => {
    const includeOff = args.includeOff ?? true;
    const layers = layerList(args).map((layer) => {
      const styles = [styleSummary('drop-shadow', {})];
      if (includeOff) styles.push(styleSummary('stroke', {}, { on: false }));
      return {
        status: 'ok',
        layer,
        count: styles.length,
        styles,
        notAdded: ORDER.filter((k) => k !== 'drop-shadow' && k !== 'stroke'),
        blendingOptions: { visible: true, on: true, globalLightAngle: 120, globalLightAltitude: 30, fillOpacity: 100 },
        colorsEffect: null,
      };
    });
    return { composition: comp(), count: layers.length, failed: 0, layers };
  },
};
