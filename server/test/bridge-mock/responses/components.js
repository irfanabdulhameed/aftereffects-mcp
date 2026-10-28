/*
 * Mock result shapes for the components commands. See core.js for helpers and shapes to mirror.
 */

import * as fs from 'fs';
import * as path from 'path';
import { writeMockPng } from './render.js';

const comp = (name = 'Main Comp', id = 1) => ({ id, name });
const layerRef = (index = 1, name = 'Button') => ({ index, id: 100 + index, name });

const layerSummary = (index = 1, name = 'Button', over = {}) => ({
  index,
  id: 100 + index,
  name,
  type: 'precomp',
  enabled: true,
  locked: false,
  shy: false,
  solo: false,
  inPoint: 0,
  outPoint: 10,
  startTime: 0,
  inFrame: 0,
  outFrame: 300,
  durationFrames: 300,
  stretch: 100,
  parent: null,
  label: 'sea-foam',
  comment: '',
  hasVideo: true,
  hasAudio: false,
  isNull: false,
  isGuide: false,
  threeD: false,
  adjustment: false,
  blendMode: 'normal',
  trackMatte: 'none',
  trackMatteLayer: null,
  motionBlur: false,
  collapseTransformation: false,
  source: { id: 20, name: 'Button', type: 'comp' },
  effects: [],
  hasEffects: false,
  hasExpressions: false,
  transform: { position: [960, 540], anchorPoint: [160, 40], scale: [100, 100], rotation: 0, opacity: 100 },
  ...over,
});

const compInfo = (name = 'Button', over = {}) => ({
  id: 20,
  name,
  width: 320,
  height: 80,
  duration: 10,
  durationFrames: 300,
  frameRate: 30,
  numLayers: 2,
  templateName: name,
  essentialPropertyCount: 3,
  parentFolder: 'Root',
  ...over,
});

const DEFAULT_PROPS = [
  { label: 'Label', valueType: 'text-document', value: { text: 'Button', font: 'Inter-SemiBold', fontSize: 32, fillColor: '#ffffff' }, source: { kind: 'property', layer: { index: 1, id: 201, name: 'Label' }, path: 'Text/Source Text', matchName: 'ADBE Text Document' } },
  { label: 'Fill', valueType: 'color', value: [0.1843, 0.4196, 1, 1], source: { kind: 'property', layer: { index: 2, id: 202, name: 'BG' }, path: 'Contents/Button/Contents/Fill 1/Color', matchName: 'ADBE Vector Fill Color' } },
  { label: 'Width', valueType: '1d', value: 320, source: { kind: 'property', layer: { index: 2, id: 202, name: 'BG' }, path: 'Effects/Width/Slider', matchName: 'ADBE Slider Control-0001' } },
];

const KNOWN = DEFAULT_PROPS.map((p) => p.label);

const hexToRgba = (hex) => {
  const s = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).concat([1]);
};

/** Mirrors MCP.components.valueFor closely enough for tests: colours become [r,g,b,a], text a document summary. */
const valueOf = (label, raw, hint) => {
  const base = DEFAULT_PROPS.find((p) => p.label.toLowerCase() === label.toLowerCase());
  if (!base) return raw;
  if (base.valueType === 'color') {
    if (hint) return hint;
    if (Array.isArray(raw)) return raw.length === 3 ? [...raw, 1] : raw;
    if (typeof raw === 'string' && raw.startsWith('#')) return hexToRgba(raw);
    return raw;
  }
  if (base.valueType === 'text-document') return { ...base.value, text: String(raw) };
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  return raw;
};

const describeProps = (values = {}, hints = {}) =>
  DEFAULT_PROPS.map((p) => ({
    label: p.label,
    path: p.label,
    valueType: p.valueType,
    value: values[p.label] !== undefined ? valueOf(p.label, values[p.label], hints[p.label]) : p.value,
    numKeys: 0,
    hasExpression: false,
    source: p.source,
  }));

const unknownLabels = (values = {}, keyframes = []) => {
  const labels = [...Object.keys(values ?? {}), ...(keyframes ?? []).map((k) => k.label)];
  return [...new Set(labels.filter((l) => !KNOWN.some((k) => k.toLowerCase() === String(l).toLowerCase())))];
};

const failUnknown = (who, unknown) => {
  throw Object.assign(new Error(`Unknown Essential Property label${unknown.length > 1 ? 's' : ''} on '${who}': ${unknown.join(', ')}. Labels on this instance: ${KNOWN.join(', ')}.`), { mcpCode: 'not-found' });
};

const keyframe = (i, time, value, stepped) => ({
  index: i,
  time,
  frame: Math.round(time * 30),
  value,
  inInterpolation: stepped && i > 1 ? 'hold' : 'bezier',
  outInterpolation: stepped ? 'hold' : 'bezier',
  easeIn: [{ speed: 0, influence: 100 }],
  easeOut: [{ speed: 0, influence: 25 }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});

/** Mirrors MCP.components.applyValues: results per label plus keys grouped by label. */
const applyValues = (values = {}, keyframes = [], hints = {}, keyHints = []) => {
  const results = Object.entries(values ?? {}).map(([label, raw]) => {
    const p = DEFAULT_PROPS.find((d) => d.label.toLowerCase() === label.toLowerCase());
    return { status: 'ok', label, path: p.label, valueType: p.valueType, value: valueOf(label, raw, hints?.[label]) };
  });
  const groups = new Map();
  (keyframes ?? []).forEach((k, i) => {
    const p = DEFAULT_PROPS.find((d) => d.label.toLowerCase() === k.label.toLowerCase());
    if (!groups.has(p.label)) groups.set(p.label, []);
    groups.get(p.label).push({ ...k, hint: keyHints?.[i] ?? null, p });
  });
  const written = [...groups.entries()].map(([label, list]) => {
    const sorted = list.map((k) => ({ ...k, t: k.time ?? k.frame / 30 })).sort((a, b) => a.t - b.t);
    return {
      status: 'ok',
      label,
      path: label,
      numKeys: sorted.length,
      keys: sorted.map((k, i) => keyframe(i + 1, k.t, valueOf(label, k.value, k.hint), k.p.valueType === 'text-document' || typeof k.value === 'boolean')),
    };
  });
  return { results, keyframes: written };
};

export const responses = {
  createComponent: (args) => {
    const props = args.properties ?? [];
    const added = [];
    const failed = [];
    props.forEach((p) => {
      const label = p.label ?? String(p.path).split('/').pop();
      const layer = typeof p.layer === 'string' ? p.layer : (p.layer?.name ?? `Layer ${p.layer?.index ?? p.layer}`);
      if (/Path$/i.test(String(p.path))) failed.push({ label, layer, path: p.path, reason: `'${p.path}' cannot be an Essential Property: its value type is shape.` });
      else added.push({ label, layer, path: p.path, valueType: /Text/.test(String(p.path)) ? 'text-document' : /Color/.test(String(p.path)) ? 'color' : '1d', index: added.length + 1 });
    });
    const crop = args.cropToContent === false ? { applied: false, reason: 'cropToContent is false' } : { applied: true, region: { x: 800, y: 500, width: 320 + 2 * (args.padding ?? 0), height: 80 + 2 * (args.padding ?? 0) }, padding: args.padding ?? 0, movedLayers: 2, skipped: [], notes: [] };
    const width = crop.applied ? crop.region.width : 1920;
    const height = crop.applied ? crop.region.height : 1080;
    return {
      composition: comp(),
      component: compInfo(args.name, { width, height, templateName: args.templateName ?? args.name, essentialPropertyCount: added.length, duration: args.duration ?? 10 }),
      instance: layerSummary(1, args.name, { source: { id: 20, name: args.name, type: 'comp' }, transform: { position: [960, 540], anchorPoint: [width / 2, height / 2], scale: [100, 100], rotation: 0, opacity: 100 } }),
      sourceLayers: (Array.isArray(args.layers) ? args.layers : [{ name: 'BG' }, { name: 'Label' }]).map((l, i) => ({ index: l.index ?? i + 1, id: 200 + i, name: l.name ?? `Layer ${i + 1}` })),
      timeShift: 0,
      timeShiftFrames: 0,
      crop,
      added,
      failed,
      essentialProperties: added.map((a) => a.label),
      values: describeProps().filter((d) => added.some((a) => a.label === d.label)),
      notes: [],
    };
  },

  addEssentialProperty: (args) => {
    const label = args.label ?? String(Array.isArray(args.path) ? args.path[args.path.length - 1] : args.path).split('/').pop();
    if (KNOWN.some((k) => k.toLowerCase() === label.toLowerCase())) {
      throw Object.assign(new Error(`'Button' already has an Essential Property named '${label}'. Pick another label. Existing: ${KNOWN.join(', ')}`), { mcpCode: 'invalid-argument' });
    }
    if (/Path$/i.test(String(args.path))) {
      throw Object.assign(new Error(`'${args.path}' cannot be an Essential Property: its value type is shape. Supported: checkboxes, colours, Source Text, single numbers, 2D and 3D points and Dropdown Menu Control menus.`), { mcpCode: 'unsupported' });
    }
    return {
      composition: comp('Button', 20),
      layer: layerRef(2, args.layer?.name ?? 'BG'),
      property: { name: label, matchName: 'ADBE Slider Control-0001', path: String(args.path), matchPath: String(args.path), index: 1, isGroup: false, value: 0, valueType: '1d', dimensions: 1, canVaryOverTime: true, isSpatial: false, numKeys: 0, hasExpression: false },
      label,
      index: KNOWN.length + 1,
      essentialProperties: [...KNOWN, label],
      instances: [{ composition: comp(), layer: layerRef(1, 'Button') }],
    };
  },

  listEssentialProperties: (args) => {
    const base = {
      composition: args.layer ? comp() : comp('Button', 20),
      component: compInfo(),
      count: KNOWN.length,
      controllers: KNOWN.map((name, i) => ({ index: i + 1, name })),
      notes: [],
    };
    if (args.layer) return { ...base, instance: layerRef(args.layer.index ?? 1, args.layer.name ?? 'Button'), properties: describeProps() };
    return { ...base, instances: [{ composition: comp(), layer: layerRef(1, 'Button') }], properties: describeProps(), notes: ["Types and sources read through instance 'Button' in 'Main Comp'; values are the component's own."] };
  },

  setComponentValues: (args) => {
    const unknown = unknownLabels(args.values, args.keyframes);
    if (unknown.length) failUnknown(args.layer?.name ?? 'Button', unknown);
    const res = applyValues(args.values, args.keyframes, args.colorHints, args.keyColorHints);
    return {
      composition: comp(),
      layer: layerRef(args.layer?.index ?? 2, args.layer?.name ?? 'Button 2'),
      component: comp('Button', 20),
      count: res.results.length + res.keyframes.length,
      failed: 0,
      results: res.results,
      keyframes: res.keyframes,
      essentialProperties: describeProps(args.values, args.colorHints),
    };
  },

  addComponentInstances: (args) => {
    const specs = args.instances ?? Array.from({ length: args.count ?? 1 }, () => ({}));
    const unknown = [...new Set(specs.flatMap((s) => unknownLabels(s.values, s.keyframes)))];
    if (unknown.length) {
      throw Object.assign(new Error(`Unknown Essential Property label${unknown.length > 1 ? 's' : ''} for 'Button': ${unknown.join(', ')}. Labels: ${KNOWN.join(', ')}. Nothing was added.`), { mcpCode: 'not-found' });
    }
    const compName = args.component?.name ?? 'Button';
    const results = specs.map((s, i) => {
      const start = s.startFrame !== undefined ? s.startFrame / 30 : (s.startTime ?? 0);
      const length = s.durationFrames !== undefined ? s.durationFrames / 30 : (s.duration ?? 10);
      const res = applyValues(s.values, s.keyframes, s.colorHints, s.keyColorHints);
      return {
        status: 'ok',
        index: i,
        layer: layerSummary(i + 1, s.name ?? `${compName} ${i + 2}`, {
          inPoint: start,
          outPoint: start + length,
          startTime: start,
          inFrame: Math.round(start * 30),
          outFrame: Math.round((start + length) * 30),
          source: { id: 20, name: compName, type: 'comp' },
          transform: { position: s.position ?? [960, 540], anchorPoint: [160, 40], scale: [100, 100], rotation: 0, opacity: 100 },
        }),
        values: res.results,
        keyframes: res.keyframes,
      };
    });
    return { composition: comp(), component: compInfo(compName), count: results.length, failed: 0, results };
  },

  setResponsiveTime: (args) => {
    const fps = 30;
    const duration = 10;
    const intro = args.introFrames !== undefined ? args.introFrames / fps : (args.intro ?? 0);
    const outro = args.outroFrames !== undefined ? args.outroFrames / fps : (args.outro ?? 0);
    if (intro + outro > duration) {
      throw Object.assign(new Error(`intro (${intro} s) plus outro (${outro} s) is longer than 'Button' (${duration} s).`), { mcpCode: 'invalid-argument' });
    }
    const marker = (time, length, comment) => ({ comment, duration: length, chapter: '', url: '', label: 0, cuePointName: '', protectedRegion: true, time, frame: Math.round(time * fps) });
    const markers = [];
    if (intro > 0) markers.push(marker(0, intro, args.introComment ?? 'Intro'));
    (args.regions ?? []).forEach((r) => {
      const start = r.startFrame !== undefined ? r.startFrame / fps : r.start;
      const length = r.durationFrames !== undefined ? r.durationFrames / fps : r.duration;
      markers.push(marker(start, length, r.comment ?? 'Protected'));
    });
    if (outro > 0) markers.push(marker(duration - outro, outro, args.outroComment ?? 'Outro'));
    markers.sort((a, b) => a.time - b.time).forEach((m, i) => (m.index = i + 1));
    return {
      composition: comp(args.comp?.name ?? 'Button', 20),
      duration,
      intro,
      introFrames: Math.round(intro * fps),
      outro,
      outroFrames: Math.round(outro * fps),
      stretchable: { start: intro, end: duration - outro, startFrame: Math.round(intro * fps), endFrame: Math.round((duration - outro) * fps) },
      removedProtected: args.replace === false ? 0 : 1,
      markers,
      instances: [{ composition: comp(), layer: layerRef(1, 'Button') }],
      notes: ['Instances placed before this keep the old regions until Layer > Markers > Update Markers from Source is run on them.'],
    };
  },

  exportComponentTemplate: (args) => {
    const name = args.templateName ?? 'Button';
    return {
      composition: comp(args.comp?.name ?? 'Button', 20),
      templateName: name,
      file: `${args.folder}/${name}.mogrt`,
      exists: true,
      size: 48213,
      overwrite: args.overwrite ?? false,
      projectSaved: args.saveProject !== false,
      projectFile: '/tmp/components-test.aep',
      essentialPropertyCount: KNOWN.length,
      notes: [],
    };
  },

  libraryPoster: (args) => {
    writeMockPng(String(args.outputPath));
    return {
      file: String(args.outputPath),
      width: 1920,
      height: 1080,
      time: args.time ?? 5,
      frame: 150,
      composition: comp(args.comp?.name ?? 'Button', 20),
      method: 'saveFrameToPng',
      background: [0.05, 0.05, 0.06],
      component: compInfo(args.comp?.name ?? 'Button'),
      folderPath: ['Components'],
      projectFile: globalThis.__mockProjectFile === undefined ? '/tmp/components-test.aep' : globalThis.__mockProjectFile,
      dirty: globalThis.__mockProjectDirty ?? false,
    };
  },

  saveLibraryComponent: (args) => {
    fs.mkdirSync(path.dirname(String(args.aepPath)), { recursive: true });
    fs.writeFileSync(String(args.aepPath), 'aep');
    return {
      aep: String(args.aepPath),
      bytes: 3,
      component: compInfo(args.comp?.name ?? 'Button'),
      controls: KNOWN.map((label) => ({ label, type: label === 'Fill' ? 'color' : 'text', value: null })),
      fonts: [{ font: 'Inter-Medium', family: 'Inter', style: 'Medium' }],
      footage: { copied: ['footage/avatar.png'], kept: [], missing: [] },
      counts: { items: 4, itemsRemoved: 12, compositions: 2, layers: 9 },
      settings: { bitsPerChannel: 8 },
      sourceProject: '/tmp/components-test.aep',
      sourceFolders: ['Components'],
      reopened: args.reopen !== false,
    };
  },

  insertLibraryComponent: (args) => {
    const unknown = unknownLabels(args.values, args.keyframes);
    if (unknown.length) failUnknown(args.compName ?? 'Button', unknown);
    const res = applyValues(args.values, args.keyframes, args.colorHints, args.keyColorHints);
    const name = args.compName ?? 'Button';
    const fileName = String(args.aepPath).split(/[\\/]/).pop();
    return {
      composition: comp(),
      component: compInfo(name),
      library: { aep: args.aepPath, componentName: args.componentName ?? null, imported: args.reuseImported === false, reused: args.reuseImported !== false, folder: { id: 30, name: fileName, type: 'folder' } },
      instance: layerSummary(1, args.name ?? name, { source: { id: 20, name, type: 'comp' }, transform: { position: args.position ?? [960, 540], anchorPoint: [160, 40], scale: [100, 100], rotation: 0, opacity: 100 } }),
      failed: 0,
      values: res.results,
      keyframes: res.keyframes,
      essentialProperties: describeProps(args.values, args.colorHints),
      notes: [],
    };
  },
};
