/*
 * Mock result shapes for the workflow command group (snapshot, find, replace,
 * relink). Shapes mirror src/scripts/commands/workflow.jsx.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const compSummary = () => ({
  id: 1, name: 'Main Comp', width: 1920, height: 1080, pixelAspect: 1, duration: 10, frameRate: 30, frameDuration: 1 / 30, durationFrames: 300,
  numLayers: 2, bgColor: '#000000', time: 0, frame: 0, workAreaStart: 0, workAreaDuration: 10, motionBlur: false, shutterAngle: 180, shutterPhase: -90,
  motionBlurSamplesPerFrame: 16, resolutionFactor: [1, 1], displayStartTime: 0, hideShyLayers: false, parentFolder: null,
});
const layerRef = (index = 1, name = 'Title') => ({ index, id: 100 + index, name });
const layerSummary = (index = 1, name = 'Title', type = 'text', over = {}) => ({
  index, id: 100 + index, name, type, enabled: true, locked: false, shy: false, solo: false,
  inPoint: 0, outPoint: 10, startTime: 0, inFrame: 0, outFrame: 300, durationFrames: 300, stretch: 100,
  parent: null, label: 'none', comment: '', hasVideo: true, hasAudio: false, isNull: false, isGuide: false, threeD: false, adjustment: false,
  blendMode: 'normal', trackMatte: 'none', trackMatteLayer: null, motionBlur: false, collapseTransformation: false, source: null,
  effects: [], hasEffects: false, hasExpressions: false,
  transform: { position: [960, 540], anchorPoint: [0, 0], scale: [100, 100], rotation: 0, opacity: 100 },
  ...over,
});
const keyframe = (i, time, value) => ({
  index: i, time, frame: Math.round(time * 30), value, inInterpolation: 'bezier', outInterpolation: 'bezier',
  easeIn: [{ speed: 0, influence: 33.33 }], easeOut: [{ speed: 0, influence: 33.33 }], temporalContinuous: false, temporalAutoBezier: false, selected: false,
});
const leaf = (name, matchName, path, value, keys = [], extra = {}) => ({
  name, matchName, path, matchPath: path.replace(/^Transform/, 'ADBE Transform Group'), index: 1, isGroup: false, value,
  valueType: Array.isArray(value) ? '2d-spatial' : '1d', dimensions: Array.isArray(value) ? value.length : 1, canVaryOverTime: true,
  isSpatial: name === 'Position', numKeys: keys.length, hasExpression: false, ...(keys.length ? { keyframes: keys } : {}), ...extra,
});
const transformTree = () => ({
  name: 'Transform', matchName: 'ADBE Transform Group', path: 'Transform', matchPath: 'ADBE Transform Group', index: 1, isGroup: true, numProperties: 2,
  children: [
    leaf('Position', 'ADBE Position', 'Transform/Position', [960, 540], [keyframe(1, 0, [960, 700]), keyframe(2, 0.5, [960, 540])]),
    leaf('Opacity', 'ADBE Opacity', 'Transform/Opacity', 100, [], { hasExpression: true, expression: 'wiggle(2, 10)', expressionEnabled: true, expressionError: '' }),
  ],
});
const snapshotLayer = (index, name, type) => ({
  layer: layerSummary(index, name, type),
  parent: null,
  transform: transformTree(),
  effects: [{ index: 1, name: 'Gaussian Blur', matchName: 'ADBE Gaussian Blur 2', enabled: true, properties: { name: 'Gaussian Blur', matchName: 'ADBE Gaussian Blur 2', path: 'Effects/Gaussian Blur', matchPath: 'ADBE Effect Parade/ADBE Gaussian Blur 2', index: 1, isGroup: true, numProperties: 1, children: [leaf('Blurriness', 'ADBE Gaussian Blur 2-0001', 'Effects/Gaussian Blur/Blurriness', 12)] } }],
  text: type === 'text' ? { sourceText: leaf('Source Text', 'ADBE Text Document', 'Text/Source Text', { text: 'Hello', font: 'ArialMT', fontSize: 72, fillColor: '#ffffff' }) } : undefined,
  masks: [],
  timeRemap: null,
});

export const responses = {
  snapshotComposition: (args) => ({
    snapshotVersion: 1,
    takenAt: new Date().toISOString(),
    composition: compSummary(),
    options: { depth: args.depth ?? 3, keyframes: args.includeKeyframes ?? true, effects: args.includeEffects ?? true, text: args.includeText ?? true, shapes: args.includeShapes ?? false },
    layerCount: 2,
    truncated: (args.maxLayers ?? 100) < 2,
    markers: [],
    layers: [snapshotLayer(1, 'Title', 'text'), snapshotLayer(2, 'BG', 'solid')].slice(0, args.maxLayers ?? 100),
  }),
  applySnapshot: (args) => {
    const layers = (args.snapshot?.layers ?? []);
    const what = { values: args.what?.transform ?? true, transform: args.what?.transform ?? true, effects: args.what?.effects ?? true, keyframes: args.what?.keyframes ?? true, expressions: args.what?.expressions ?? true, text: args.what?.text ?? false };
    const results = layers.filter((l) => l.layer?.name !== 'Missing').map((l, i) => ({ status: 'ok', snapshotLayer: { name: l.layer?.name, index: l.layer?.index }, layer: layerRef(l.layer?.index ?? i + 1, l.layer?.name ?? `Layer ${i + 1}`), applied: 2, unchanged: 0, effectsAdded: what.effects ? ['Gaussian Blur'] : [], effectsUpdated: 0, skipped: [] }));
    const skipped = layers.filter((l) => l.layer?.name === 'Missing').map((l) => ({ name: l.layer?.name, index: l.layer?.index, reason: `no layer matched by ${args.matchBy ?? 'name'}` }));
    return {
      composition: comp(), matchBy: args.matchBy ?? 'name', what,
      layersApplied: results.length, layersSkipped: skipped.length, results, skipped,
      notRestored: ['masks', 'shape contents', 'layer order and parenting', 'layer styles', 'layer timing and switches', 'markers'],
    };
  },
  findLayers: (args) => {
    const all = [
      { composition: comp(), layer: layerSummary(1, 'Title', 'text', { effects: ['Gaussian Blur'], hasEffects: true, hasExpressions: true }) },
      { composition: comp(), layer: layerSummary(2, 'Card', 'shape') },
      { composition: comp(), layer: layerSummary(3, 'BG', 'solid', { enabled: false }) },
    ];
    let out = all;
    if (args.namePattern) {
      const m = String(args.namePattern).match(/^\/(.*)\/([gimy]*)$/);
      const test = m ? (s) => new RegExp(m[1], m[2].replace('g', '')).test(s) : (s) => s.toLowerCase().includes(String(args.namePattern).toLowerCase());
      out = out.filter((e) => test(e.layer.name));
    }
    if (args.type) out = out.filter((e) => e.layer.type === args.type);
    if (args.hasEffect) out = out.filter((e) => e.layer.effects.some((n) => n === args.hasEffect || args.hasEffect === 'ADBE Gaussian Blur 2'));
    if (args.hasExpressions !== undefined) out = out.filter((e) => e.layer.hasExpressions === args.hasExpressions);
    if (args.enabled !== undefined) out = out.filter((e) => e.layer.enabled === args.enabled);
    if (args.expressionContains) out = out.filter((e) => e.layer.hasExpressions).map((e) => ({ ...e, matchedExpressions: [{ path: 'Transform/Opacity', expression: 'wiggle(2, 10)' }] }));
    const limit = args.limit ?? 500;
    return { scope: args.scope ?? 'comp', compositionsScanned: args.scope === 'project' ? 2 : 1, layersScanned: all.length, count: Math.min(out.length, limit), truncated: out.length > limit, layers: out.slice(0, limit) };
  },
  findAndReplaceText: (args) => {
    const before = 'Hello Acme, hello acme';
    const body = args.useRegex ? args.find : String(args.find).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const re = new RegExp(args.wholeWord ? `\\b(?:${body})\\b` : body, 'g' + (args.caseSensitive ? '' : 'i'));
    const matches = (before.match(re) || []).length;
    const after = before.replace(re, args.replace ?? '');
    const layers = matches ? [{ composition: comp(), layer: layerRef(1, 'Title'), changes: [{ keyIndex: null, matches, before, after }] }] : [];
    return { scope: args.scope ?? 'comp', find: args.find, replace: args.replace ?? '', dryRun: !!args.dryRun, matchedLayers: layers.length, changedLayers: args.dryRun ? 0 : layers.length, totalMatches: matches, layers };
  },
  replaceColor: (args) => {
    const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    const changes = [
      { layer: layerRef(2, 'Card'), target: 'shape-fill', path: 'Contents/Group 1/Fill 1/Color', keyIndex: null, before: hex(args.from), after: hex(args.to) },
      { layer: layerRef(1, 'Title'), target: 'text-fill', path: 'Text/Source Text', keyIndex: null, before: hex(args.from), after: hex(args.to) },
    ];
    if (args.includeEffects) changes.push({ layer: layerRef(1, 'Title'), target: 'effect', path: 'Effects/Tint/Map White To', keyIndex: null, before: hex(args.from), after: hex(args.to) });
    return { composition: comp(), from: hex(args.from), to: hex(args.to), tolerance: args.tolerance ?? 0.02, dryRun: !!args.dryRun, changedCount: changes.length, changes };
  },
  relinkFonts: (args) => {
    if (args.fromFont === 'missing') {
      const err = new Error('app.fonts.missingOrSubstitutedFonts is not available in this After Effects version (mock).');
      err.mcpCode = 'unsupported';
      throw err;
    }
    const changes = [{ composition: comp(), layer: layerRef(1, 'Title'), keyIndex: null, before: args.fromFont === '*' ? 'ArialMT' : args.fromFont, after: args.toFont }];
    return { scope: args.scope ?? 'comp', fromFont: args.fromFont, toFont: args.toFont, dryRun: !!args.dryRun, matchedLayers: 1, changedCount: args.dryRun ? 0 : 1, changes, warnings: [] };
  },
};
