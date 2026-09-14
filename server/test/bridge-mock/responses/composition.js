/*
 * Mock result shapes for the composition command group. See core.js for helpers and shapes to mirror.
 * Shapes mirror src/scripts/commands/composition.jsx.
 */

const fail = (message, code) => Object.assign(new Error(message), { mcpCode: code });

const compRef = (over = {}) => ({ id: 1, name: 'Main Comp', ...over });

/** serialize.comp plus the extras MCP.composition.summary adds. */
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
  motionBlurAdaptiveSampleLimit: 128,
  preserveNestedFrameRate: false,
  preserveNestedResolution: false,
  displayStartFrame: 0,
  workAreaEnd: 10,
  usedInCount: 0,
  ...over,
});

const layerSummary = (index = 1, name = 'Layer 1', type = 'precomp', over = {}) => ({
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
  isNull: false,
  isGuide: false,
  threeD: false,
  adjustment: false,
  blendMode: 'normal',
  trackMatte: 'none',
  trackMatteLayer: null,
  motionBlur: false,
  collapseTransformation: false,
  source: type === 'precomp' ? { id: 30, name, type: 'comp' } : null,
  effects: [],
  hasEffects: false,
  hasExpressions: false,
  transform: { position: [960, 540], anchorPoint: [0, 0], scale: [100, 100], rotation: 0, opacity: 100 },
  ...over,
});

function resolveComp(ref) {
  if (ref && ref.id !== undefined && ref.id !== 1 && ref.id !== 7) throw fail(`No composition with id ${ref.id}. Available: Main Comp (1)`, 'not-found');
  if (ref && ref.name !== undefined && ref.name.toLowerCase() === 'missing') throw fail(`No composition named '${ref.name}'. Available: Main Comp (1)`, 'not-found');
  return compRef({ id: ref?.id ?? 1, name: ref?.name ?? (ref?.id === 7 ? 'Nested' : 'Main Comp') });
}

const FRAME = 1 / 30;
const snap = (t) => Math.round(t / FRAME) * FRAME;
const round = (n) => Math.round(n * 10000) / 10000;

export const responses = {
  setCompositionSettings: (args) => {
    const c = resolveComp(args.comp);
    const changed = [];
    const over = { id: c.id, name: c.name };
    const fps = args.frameRate ?? 30;
    const toHex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    const order = ['name', 'width', 'height', 'pixelAspect', 'frameRate', 'duration', 'bgColor', 'motionBlur', 'shutterAngle', 'shutterPhase', 'motionBlurSamplesPerFrame', 'motionBlurAdaptiveSampleLimit', 'resolutionFactor', 'displayStart', 'hideShyLayers', 'preserveNestedFrameRate', 'preserveNestedResolution'];
    for (const k of order) {
      if (k === 'duration') {
        if (args.durationFrames !== undefined) {
          changed.push('durationFrames');
          over.duration = args.durationFrames / fps;
        } else if (args.duration !== undefined) {
          changed.push('duration');
          over.duration = args.duration;
        }
        if (over.duration !== undefined) over.durationFrames = Math.round(over.duration * fps);
        continue;
      }
      if (k === 'displayStart') {
        if (args.displayStartFrame !== undefined) {
          changed.push('displayStartFrame');
          over.displayStartTime = args.displayStartFrame / fps;
          over.displayStartFrame = args.displayStartFrame;
        } else if (args.displayStartTime !== undefined) {
          changed.push('displayStartTime');
          over.displayStartTime = args.displayStartTime;
          over.displayStartFrame = Math.round(args.displayStartTime * fps);
        }
        continue;
      }
      if (args[k] === undefined) continue;
      changed.push(k);
      over[k] = k === 'bgColor' ? toHex(args[k]) : args[k];
    }
    return { composition: compSummary(over), changed };
  },
  duplicateComposition: (args) => {
    const c = resolveComp(args.comp);
    return { source: c, composition: compSummary({ id: 8, name: args.newName ?? c.name + ' 2' }) };
  },
  renameComposition: (args) => {
    const c = resolveComp(args.comp);
    return { composition: compSummary({ id: c.id, name: args.newName }), previousName: c.name };
  },
  deleteComposition: (args) => {
    const c = resolveComp(args.comp);
    const usage = c.id === 7 ? [compRef()] : [];
    if (usage.length && !args.force) throw Object.assign(fail(`Refusing to delete '${c.name}' because ${usage.length} composition(s) nest it: Main Comp. Their layers would disappear. Pass force: true to delete it anyway.`, 'invalid-argument'), { mcpDetails: { usedIn: usage } });
    return { removed: c, usedInCount: usage.length, usedIn: usage, numLayers: 3, forced: !!args.force && usage.length > 0 };
  },
  setWorkArea: (args) => {
    const c = resolveComp(args.comp);
    const duration = 10;
    let start = args.startFrame !== undefined ? args.startFrame * FRAME : args.start ?? 0;
    let end;
    if (args.endFrame !== undefined) end = args.endFrame * FRAME;
    else if (args.end !== undefined) end = args.end;
    else if (args.durationFrames !== undefined) end = start + args.durationFrames * FRAME;
    else if (args.duration !== undefined) end = start + args.duration;
    else end = duration;
    start = Math.max(0, Math.min(duration - FRAME, snap(start)));
    end = Math.max(start + FRAME, Math.min(duration, snap(end)));
    return {
      composition: c,
      workAreaStart: round(start),
      workAreaEnd: round(end),
      workAreaDuration: round(end - start),
      workAreaStartFrame: Math.round(start / FRAME),
      workAreaEndFrame: Math.round(end / FRAME),
      workAreaDurationFrames: Math.round((end - start) / FRAME),
      compDuration: duration,
    };
  },
  setCurrentTime: (args) => {
    const c = resolveComp(args.comp);
    if (args.time === undefined && args.frame === undefined) throw fail('Pass time (seconds) or frame.', 'invalid-argument');
    let t = args.frame !== undefined ? args.frame * FRAME : args.time;
    t = Math.max(0, Math.min(10 - FRAME, snap(t)));
    return { composition: c, time: round(t), frame: Math.round(t / FRAME), duration: 10 };
  },
  precompose: (args) => {
    const c = resolveComp(args.comp);
    const layers = Array.isArray(args.layers) ? args.layers : args.layers?.selected ? [{ index: 1 }, { index: 2 }] : [{ index: 1 }, { index: 2 }, { index: 3 }];
    const moveAll = args.moveAllAttributes !== false;
    if (!moveAll && layers.length > 1) throw fail('moveAllAttributes: false is only allowed for a single layer in After Effects. Precompose one layer, or set moveAllAttributes true.', 'invalid-argument');
    const trimmed = !!args.trimToLayers;
    const inPoint = trimmed ? 1 : 0, outPoint = trimmed ? 4 : 10;
    return {
      composition: c,
      precomp: compSummary({ id: 30, name: args.name, numLayers: layers.length, duration: trimmed ? 4 : 10, durationFrames: trimmed ? 120 : 300 }),
      layer: layerSummary(1, args.name, 'precomp', { inPoint, outPoint, inFrame: inPoint * 30, outFrame: outPoint * 30, durationFrames: (outPoint - inPoint) * 30 }),
      sourceLayers: layers.map((l, i) => ({ index: l.index ?? i + 1, id: 100 + (l.index ?? i + 1), name: l.name ?? `Layer ${l.index ?? i + 1}` })),
      moveAllAttributes: moveAll,
      trimmed,
    };
  },
  openCompositionInViewer: (args) => ({ composition: resolveComp(args.comp), active: true }),
  cropCompositionToRegion: (args) => {
    const c = resolveComp(args.comp);
    let region;
    if (args.region) region = args.region;
    else if (args.fromLayer) {
      const pad = args.padding ?? 0;
      region = { x: 700 - pad, y: 400 - pad, width: 520 + pad * 2, height: 280 + pad * 2 };
    } else throw fail('Pass region {x, y, width, height} or fromLayer.', 'invalid-argument');
    const out = { x: Math.round(region.x), y: Math.round(region.y), width: Math.max(4, Math.round(region.width)), height: Math.max(4, Math.round(region.height)) };
    return {
      composition: compSummary({ id: c.id, name: c.name, width: out.width, height: out.height }),
      region: out,
      movedLayers: 2,
      moved: [
        { index: 1, id: 101, name: 'Title', keyframesOffset: 2, hasPositionExpression: false },
        { index: 2, id: 102, name: 'Card', keyframesOffset: 0, hasPositionExpression: false },
      ],
      skippedLayers: [{ index: 3, id: 103, name: 'Child', reason: 'parented; it follows its parent' }],
    };
  },
};
