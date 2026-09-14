/*
 * Plausible result shapes for every bridge command, keyed by command name.
 * Shapes mirror what the real ExtendScript commands return so the client and
 * tool tests exercise the same JSON the agent will see. Unknown commands get
 * a generic echo so new commands still round-trip before their mock is added.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });
const layerSummary = (index = 1, name = 'Layer 1', type = 'solid') => ({
  index,
  id: 100 + index,
  name,
  type,
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
  label: 'red',
  comment: '',
  hasVideo: true,
  hasAudio: false,
  isNull: type === 'null',
  isGuide: false,
  threeD: false,
  adjustment: type === 'adjustment',
  blendMode: 'normal',
  trackMatte: 'none',
  trackMatteLayer: null,
  motionBlur: false,
  collapseTransformation: false,
  source: null,
  effects: [],
  hasEffects: false,
  hasExpressions: false,
  transform: { position: [960, 540], anchorPoint: [0, 0], scale: [100, 100], rotation: 0, opacity: 100 },
});
const compSummary = (over = {}) => ({
  id: 1,
  name: 'Main Comp',
  width: 1920,
  height: 1080,
  pixelAspect: 1,
  duration: 10,
  frameRate: 30,
  frameDuration: 1 / 30,
  durationFrames: 300,
  numLayers: 3,
  bgColor: '#000000',
  time: 0,
  frame: 0,
  workAreaStart: 0,
  workAreaDuration: 10,
  motionBlur: false,
  shutterAngle: 180,
  shutterPhase: -90,
  motionBlurSamplesPerFrame: 16,
  resolutionFactor: [1, 1],
  displayStartTime: 0,
  hideShyLayers: false,
  parentFolder: null,
  ...over,
});
const property = (path = 'Transform/Opacity', value = 100, keys = []) => ({
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
  numKeys: keys.length,
  hasExpression: false,
  keyframes: keys,
});
const keyframe = (i, time, value) => ({
  index: i,
  time,
  frame: Math.round(time * 30),
  value,
  inInterpolation: 'bezier',
  outInterpolation: 'bezier',
  easeIn: [{ speed: 0, influence: 33.33 }],
  easeOut: [{ speed: 0, influence: 33.33 }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});
const effect = (name = 'Gaussian Blur', matchName = 'ADBE Gaussian Blur 2', index = 1) => ({ index, name, matchName, enabled: true, numProperties: 3 });
const propertyResult = (path, value, extra = {}) => ({ composition: comp(), layer: layerRef(), property: property(path, value), ...extra });

export const responses = {
  ping: (args) => ({ pong: true, echo: args.message ?? null, aeVersion: '24.6.0 (mock)', bridgeVersion: '2.0.0', protocol: 2, time: new Date().toISOString() }),
  getAeVersion: () => ({ version: '24.6.0', versionNumber: 24.6, yearGuess: 2024, buildName: 'mock', buildNumber: '1', language: 'en_US', os: 'mock', bridgeVersion: '2.0.0', protocol: 2, expressionEngine: 'javascript-1.0' }),
  getBridgeStatus: () => ({ panelAlive: true, aeVersion: '24.6.0', bridgeVersion: '2.0.0', protocol: 2, options: { pollMs: 500, verbosity: 1 }, autoRun: true, commandsRun: 1, errors: 0, lastCommand: null, lastCommandAt: null, queueLength: 0, registeredCommands: 50, bridgeDir: '/mock', projectName: 'mock.aep', activeComp: comp() }),
  setBridgeOptions: (args) => ({ options: { pollMs: args.pollMs ?? 500, verbosity: args.verbosity ?? 1 } }),
  undo: (args) => ({ undone: args.count ?? 1 }),
  redo: (args) => ({ redone: args.count ?? 1 }),
  listCommands: () => ({ count: Object.keys(responses).length, commands: Object.keys(responses).map((c) => ({ command: c, mutating: true })) }),
  runExtendscript: (args) => ({ returned: `evaluated: ${args.script}`, type: 'string' }),
  batch: (args, ctx) => {
    const results = [];
    let ok = 0, failed = 0, skipped = 0, stopped = false;
    (args.steps ?? []).forEach((step, i) => {
      const entry = { step: i, command: step.command, label: step.label ?? null, status: 'skipped', durationMs: 0 };
      if (stopped) {
        skipped++;
        results.push(entry);
        return;
      }
      try {
        entry.result = ctx.invoke(step.command, step.args ?? {});
        entry.status = 'ok';
        ok++;
      } catch (err) {
        entry.status = 'error';
        entry.error = { message: err.message, code: err.mcpCode ?? 'script-error', command: step.command, id: null };
        failed++;
        if (args.stopOnError !== false) stopped = true;
      }
      results.push(entry);
    });
    return { steps: results.length, ok, failed, skipped, stoppedEarly: stopped, results };
  },

  getProjectInfo: (args) => ({ projectName: 'mock.aep', path: '/mock/mock.aep', saved: true, dirty: false, numItems: 3, itemCounts: { compositions: 1, footage: 1, folders: 1, solids: 0, placeholders: 0 }, bitsPerChannel: 8, linearBlending: false, workingSpace: 'None', workingGamma: 2.2, expressionEngine: 'javascript-1.0', timeDisplayType: 'timecode', framesCountType: '1', aeVersion: '24.6.0', activeComp: compSummary(), items: [{ id: 1, name: 'Main Comp', type: 'comp', parentFolder: null, parentFolderId: null, index: 1 }, { id: 2, name: 'clip.mov', type: 'footage', parentFolder: 'Footage', parentFolderId: 3, index: 2 }, { id: 3, name: 'Footage', type: 'folder', parentFolder: null, parentFolderId: null, index: 3 }].slice(0, args.maxItems || 3), itemsTruncated: false }),
  listProjectItems: (args) => ({ count: 1, folder: null, type: args.type ?? 'all', items: [{ id: 2, name: 'clip.mov', type: 'footage', index: 2 }] }),

  createComposition: (args) => ({ composition: compSummary({ id: 7, name: args.name ?? 'New Composition', width: args.width ?? 1920, height: args.height ?? 1080, frameRate: args.frameRate ?? 30, duration: args.duration ?? 10, numLayers: 0 }), preset: args.preset ?? null }),
  listCompositions: () => ({ count: 1, activeComp: comp(), compositions: [{ ...compSummary(), itemIndex: 1, usedInCount: 0 }] }),
  getCompositionInfo: () => ({ ...compSummary(), layers: [{ index: 1, id: 101, name: 'Layer 1', type: 'solid', enabled: true, inPoint: 0, outPoint: 10 }], nestedCompositions: [], usedInCount: 0, markers: [] }),

  listLayers: () => ({ composition: comp(), count: 3, layers: [layerSummary(1, 'Title', 'text'), layerSummary(2, 'Card', 'shape'), layerSummary(3, 'BG', 'solid')] }),
  getLayerDetails: (args) => ({ ...layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1'), keyframedProperties: [], properties: [], timing: { startTime: 0, inPoint: 0, outPoint: 10, startFrame: 0, inFrame: 0, outFrame: 300, durationSeconds: 10, durationFrames: 300, sourceInPoint: 0, sourceOutPoint: 10, frameRate: 30 }, markers: [], composition: comp() }),
  createSolidLayer: (args) => ({ composition: comp(), layer: layerSummary(1, args.name ?? 'Solid', 'solid') }),
  createAdjustmentLayer: (args) => ({ composition: comp(), layer: layerSummary(1, args.name ?? 'Adjustment Layer', 'adjustment') }),
  createNullLayer: (args) => ({ composition: comp(), layer: layerSummary(1, args.name ?? 'Null', 'null') }),
  createTextLayer: (args) => ({ composition: comp(), layer: { ...layerSummary(1, args.name ?? args.text ?? 'Text', 'text'), text: args.text ?? 'Text', textDocument: { text: args.text ?? 'Text', font: args.font ?? 'ArialMT', fontSize: args.fontSize ?? 72, fillColor: '#ffffff', justification: 'center' } } }),
  createShapeLayer: (args) => ({ composition: comp(), layer: { ...layerSummary(1, args.name ?? 'Shape Layer', 'shape'), shape: { type: args.shapeType ?? 'rectangle' }, groupPath: 'Contents/Group 1', pathPropertyPath: 'Contents/Group 1/Rectangle Path 1', fillPath: 'Contents/Group 1/Fill 1', strokePath: null } }),
  duplicateLayer: (args) => ({ composition: comp(), source: layerRef(), createdCount: args.count ?? (args.times?.length ?? 1), layers: Array.from({ length: args.count ?? (args.times?.length ?? 1) }, (_, i) => layerSummary(i + 1, `Copy ${i + 1}`)) }),
  centerLayers: () => ({ composition: comp(), center: [960, 540], centeredCount: 1, layers: [{ index: 1, name: 'Layer 1', position: [960, 540] }] }),
  setLayerTiming: (args) => ({ composition: comp(), layer: layerSummary(), changed: Object.keys(args).filter((k) => !['comp', 'layer'].includes(k)) }),

  setKeyframe: (args) => propertyResult(args.property ?? 'Transform/Opacity', args.value, { keyframe: keyframe(1, args.time ?? 0, args.value), keyIndex: 1 }),
  setKeyframesBulk: (args) => {
    const keys = (args.keys ?? []).map((k, i) => keyframe(i + 1, k.time ?? (k.frame ?? 0) / 30, k.value));
    return propertyResult(args.property ?? 'Transform/Opacity', keys.length ? keys[keys.length - 1].value : null, { keyframesWritten: keys.length, keyframes: keys });
  },
  setKeyframesMulti: (args) => ({ targets: (args.targets ?? []).length, failed: 0, results: (args.targets ?? []).map((t, i) => ({ target: i, status: 'ok', layer: layerRef(), property: t.property, keyframesWritten: (t.keys ?? []).length })) }),
  getKeyframes: (args) => ({ composition: comp(), layer: layerRef(), property: property(args.property ?? 'Transform/Opacity', 100, [keyframe(1, 0, 0), keyframe(2, 1, 100)]) }),

  setExpression: (args) => propertyResult(args.property, 0, { expressionState: { hasExpression: true, expression: args.expression, enabled: true, error: '' } }),
  getExpression: (args) => propertyResult(args.property, 0, { expressionState: { hasExpression: false, expression: '', enabled: null, error: '' } }),
  removeExpression: (args) => propertyResult(args.property, 0, { expressionState: { hasExpression: false, expression: '', enabled: null, error: '' } }),
  setExpressionEnabled: (args) => propertyResult(args.property, 0, { expressionState: { hasExpression: true, expression: 'wiggle(2,10)', enabled: args.enabled ?? true, error: '' } }),

  setText: (args) => ({ composition: comp(), layer: layerRef(), textDocument: { text: args.text }, numKeys: 0 }),
  getText: () => ({ composition: comp(), layer: layerRef(), text: 'Hello', textDocument: { text: 'Hello' }, numKeys: 0, hasExpression: false }),
  setTextStyle: (args) => ({ composition: comp(), layer: layerRef(), changed: Object.keys(args).filter((k) => !['comp', 'layer'].includes(k)), textDocument: { text: 'Hello', font: args.font ?? 'ArialMT', fontSize: args.fontSize ?? 72 }, warnings: [] }),

  applyEffect: (args) => ({ composition: comp(), layer: layerRef(), created: true, alreadyPresent: false, effect: { ...effect(args.effect, args.effect), properties: [] }, settingsApplied: Object.keys(args.settings ?? {}), notes: [] }),
  applyEffectsBulk: (args) => ({ items: (args.items ?? []).length, failed: 0, results: (args.items ?? []).map((it, i) => ({ item: i, status: 'ok', layer: layerRef(), effect: effect(it.effect, it.effect), created: true, notes: [] })) }),
  listLayerEffects: () => ({ composition: comp(), layer: layerRef(), count: 1, effects: [effect()] }),
  listAvailableEffects: (args) => ({ totalInstalled: 3, returned: 3, query: args.query ?? null, category: args.category ?? null, categories: { 'Blur & Sharpen': 1, Stylize: 1, 'Color Correction': 1 }, effects: [{ displayName: 'Gaussian Blur', matchName: 'ADBE Gaussian Blur 2', category: 'Blur & Sharpen', version: 2 }, { displayName: 'Glow', matchName: 'ADBE Glo2', category: 'Stylize', version: 2 }, { displayName: 'Tint', matchName: 'ADBE Tint', category: 'Color Correction', version: 1 }] }),
  getEffectProperties: () => ({ composition: comp(), layer: layerRef(), effect: { ...effect(), properties: [property('Effects/Gaussian Blur/Blurriness', 0)] } }),
  setEffectProperty: (args) => ({ ...propertyResult(`Effects/${args.effect?.name ?? args.effect}/${args.property}`, args.value), effect: effect(), previousValue: 0, keyIndex: args.time !== undefined ? 1 : null, keyframe: null }),
  setEffectProperties: (args) => ({ composition: comp(), layer: layerRef(), effect: { ...effect(), properties: [] }, applied: Object.keys(args.settings ?? {}), notes: [] }),
  setEffectKeyframe: (args) => ({ ...propertyResult(`Effects/${args.effect?.name ?? args.effect}/${args.property}`, args.value), effect: effect(), keyIndex: 1, keyframe: keyframe(1, args.time ?? 0, args.value) }),
  removeEffect: () => ({ composition: comp(), layer: layerRef(), removed: { index: 1, name: 'Gaussian Blur', matchName: 'ADBE Gaussian Blur 2' }, remainingEffects: [] }),
  removeAllEffects: () => ({ composition: comp(), layer: layerRef(), removedCount: 1, removed: [{ index: 1, name: 'Gaussian Blur', matchName: 'ADBE Gaussian Blur 2' }] }),
  reorderEffect: (args) => ({ composition: comp(), layer: layerRef(), effect: { name: 'Gaussian Blur', index: args.toIndex ?? 1 }, order: ['Gaussian Blur (ADBE Gaussian Blur 2)'] }),
  toggleEffect: (args) => ({ composition: comp(), layer: layerRef(), effect: { ...effect(), enabled: args.enabled ?? false } }),
  copyEffects: () => ({ from: layerRef(), targets: 1, copied: [{ layer: 'Layer 2', effect: 'Gaussian Blur', status: 'ok' }] }),
  listEffectTemplates: () => ({ count: 2, templates: [{ name: 'gaussian-blur', description: 'Gaussian Blur', params: [{ name: 'blurriness', defaultValue: 20, description: 'Pixels' }] }, { name: 'drop-shadow', description: 'Drop Shadow', params: [] }] }),
  applyEffectTemplate: (args) => ({ composition: comp(), layer: layerRef(), template: args.template, effects: [effect()], notes: [] }),
  applyPreset: (args) => ({ composition: comp(), layer: layerSummary(), presetPath: args.presetPath, effectsAdded: [effect()] }),
  savePreset: (args) => ({ composition: comp(), layer: layerRef(), presetPath: args.outputPath, effectCount: 1 }),

  addMarker: (args) => ({ composition: comp(), layer: args.layer ? layerRef() : null, marker: { time: args.time ?? 0, frame: Math.round((args.time ?? 0) * 30), comment: args.comment ?? '', duration: args.duration ?? 0 }, markerCount: 1 }),
  addMarkersBulk: (args) => ({ composition: comp(), layer: args.layer ? layerRef() : null, addedCount: (args.markers ?? []).length, errorCount: 0, added: (args.markers ?? []).map((m) => ({ time: m.time ?? 0, frame: Math.round((m.time ?? 0) * 30), comment: m.comment ?? '' })), errors: [], markerCount: (args.markers ?? []).length }),
  listMarkers: () => ({ composition: comp(), compMarkers: [{ index: 1, time: 1, frame: 30, comment: 'beat', duration: 0 }], layers: [] }),
  deleteMarker: () => ({ composition: comp(), layer: null, removed: 1, markerCount: 0 }),
  clearMarkers: () => ({ composition: comp(), layer: null, removed: 2 }),
  getAudioInfo: () => ({ composition: comp(), layer: layerRef(), hasAudio: true, audioEnabled: true, inPoint: 0, outPoint: 10, startTime: 0, source: { name: 'track.wav', hasAudio: true, audioChannels: 2, audioSampleRate: 48000, audioDuration: 10, duration: 10 }, sourceFilePath: '/mock/track.wav', audioLevels: property('Audio/Audio Levels', [0, 0]), markers: [] }),
  setAudioLevels: (args) => propertyResult('Audio/Audio Levels', [args.level ?? 0, args.level ?? 0], { audioLevels: { left: args.leftLevel ?? args.level ?? 0, right: args.rightLevel ?? args.level ?? 0 }, keyIndex: args.time !== undefined ? 1 : null }),
};

export function respond(command, args, ctx) {
  const fn = responses[command];
  if (!fn) return { mock: true, command, args };
  return fn(args, ctx);
}
