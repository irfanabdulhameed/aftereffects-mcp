/*
 * Mock result shapes for the layers command group. Shapes mirror what
 * server/src/scripts/commands/layers.jsx returns. Where a command echoes its
 * input (names, colours, positions) the mock does the same so tests can check
 * Node-side transforms reached the bridge.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });
const layerSummary = (index = 1, name = 'Layer 1', type = 'solid', over = {}) => ({
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
  threeD: type === 'camera' || type === 'light',
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
  ...over,
});
const toHex = (arr) => {
  if (!Array.isArray(arr)) return '#ffffff';
  const h = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255).toString(16).padStart(2, '0');
  return '#' + h(arr[0]) + h(arr[1]) + h(arr[2]);
};
const LABELS = ['none', 'red', 'yellow', 'aqua', 'pink', 'lavender', 'peach', 'sea-foam', 'blue', 'green', 'purple', 'orange', 'brown', 'fuchsia', 'cyan', 'sandstone', 'dark-green'];
const stack = () => [layerSummary(1, 'Title', 'text'), layerSummary(2, 'Card', 'shape'), layerSummary(3, 'BG', 'solid')];
const refsFrom = (spec) => {
  if (Array.isArray(spec)) return spec.map((r, i) => layerRef(r.index ?? i + 1, r.name ?? `Layer ${r.index ?? i + 1}`));
  return [layerRef(1, 'Title'), layerRef(2, 'Card')];
};
const bounds = (i) => ({ left: 100 * i, top: 100, right: 100 * i + 200, bottom: 300, width: 200, height: 200 });

export const responses = {
  listLayers: (args) => {
    const all = stack();
    const layers = args.type ? all.filter((l) => l.type === args.type) : all;
    return { composition: comp(), count: layers.length, layers };
  },

  createCameraLayer: (args) => {
    const zoom = args.zoom ?? (1920 * Number(String(args.preset ?? '50mm').replace('mm', ''))) / 36;
    const oneNode = args.type === 'one-node';
    return {
      composition: comp(),
      layer: layerSummary(1, args.name ?? 'Camera 1', 'camera', { transform: { position: args.position ?? [960, 540, -zoom], anchorPoint: [960, 540, 0], scale: null, rotation: 0, opacity: null } }),
      camera: {
        type: oneNode ? 'one-node' : 'two-node',
        zoom: Math.round(zoom * 10000) / 10000,
        focalLengthMm: Math.round((zoom * 36 / 1920) * 100) / 100,
        preset: args.zoom !== undefined ? null : (args.preset ?? '50mm'),
        position: args.position ?? [960, 540, -zoom],
        pointOfInterest: oneNode ? null : (args.pointOfInterest ?? [960, 540, 0]),
        depthOfField: !!args.depthOfField,
        focusDistance: args.focusDistance ?? zoom,
        aperture: args.aperture ?? 50.4,
      },
    };
  },
  createLightLayer: (args) => {
    const lightType = args.lightType ?? 'point';
    return {
      composition: comp(),
      layer: layerSummary(1, args.name ?? 'Light 1', 'light'),
      light: {
        lightType,
        position: lightType === 'ambient' ? null : (args.position ?? [960, 540, -500]),
        pointOfInterest: lightType === 'spot' || lightType === 'parallel' ? (args.pointOfInterest ?? [960, 540, 0]) : null,
        color: toHex(args.color),
        intensity: args.intensity ?? 100,
        coneAngle: lightType === 'spot' ? (args.coneAngle ?? 90) : null,
        coneFeather: lightType === 'spot' ? (args.coneFeather ?? 50) : null,
        castsShadows: !!args.castsShadows,
        shadowDarkness: args.shadowDarkness ?? 100,
      },
      skipped: [],
    };
  },

  addFootageToComposition: (args) => ({
    composition: comp(),
    item: { id: args.item?.id ?? 2, name: args.item?.name ?? 'clip.mov', type: 'footage', parentFolder: null, parentFolderId: null, width: 1920, height: 1080, duration: 5, hasVideo: true, hasAudio: true, file: '/mock/clip.mov', usedIn: 1 },
    layer: layerSummary(1, args.name ?? args.item?.name ?? 'clip.mov', 'footage', { startTime: args.startTime ?? args.time ?? 0 }),
  }),
  addCompositionAsLayer: (args) => ({
    composition: comp(),
    item: { id: args.sourceComp?.id ?? 5, name: args.sourceComp?.name ?? 'Scene', type: 'comp', parentFolder: null, parentFolderId: null, width: 1920, height: 1080, duration: 5, frameRate: 30, numLayers: 2 },
    layer: layerSummary(1, args.name ?? args.sourceComp?.name ?? 'Scene', 'precomp', { startTime: args.startTime ?? args.time ?? 0 }),
    sourceComp: { id: args.sourceComp?.id ?? 5, name: args.sourceComp?.name ?? 'Scene' },
  }),

  deleteLayer: (args) => ({ composition: comp(), removed: layerRef(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1'), remainingCount: 2 }),
  deleteLayers: (args) => {
    const removed = refsFrom(args.layers).sort((a, b) => b.index - a.index);
    return { composition: comp(), removedCount: removed.length, removed, remainingCount: Math.max(0, 3 - removed.length) };
  },
  renameLayer: (args) => ({ composition: comp(), previousName: args.layer?.name ?? 'Layer 1', layer: layerSummary(args.layer?.index ?? 1, args.newName) }),

  moveLayer: (args) => {
    const names = ['Title', 'Card', 'BG'];
    const from = args.layer?.index ?? 1;
    let to = from;
    if (args.toIndex !== undefined) to = Math.max(1, Math.min(3, args.toIndex));
    else if (args.toTop) to = 1;
    else if (args.toBottom) to = 3;
    else if (args.above) to = Math.max(1, (args.above.index ?? 2) - 1);
    else if (args.below) to = Math.min(3, args.below.index ?? 2);
    const order = names.slice();
    const [moved] = order.splice(from - 1, 1);
    order.splice(to - 1, 0, moved);
    return { composition: comp(), previousIndex: from, newIndex: to, layer: layerSummary(to, moved), order };
  },
  setLayerParent: (args) => ({
    composition: comp(),
    layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1', 'solid', { parent: { index: args.parent?.index ?? 2, name: args.parent?.name ?? 'CTRL' } }),
    parent: layerRef(args.parent?.index ?? 2, args.parent?.name ?? 'CTRL'),
    method: args.keepPosition === false ? 'setParentWithJump' : 'parent',
    keepPosition: args.keepPosition !== false,
    notes: [],
  }),
  clearLayerParent: (args) => ({ composition: comp(), previousParent: { index: 2, name: 'CTRL' }, layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1') }),

  setLayerFlags: (args) => {
    const keys = Object.keys(args).filter((k) => !['comp', 'layer'].includes(k));
    const flags = { enabled: true, solo: false, shy: false, locked: false, guide: false, motionBlur: false, collapseTransformations: false, adjustmentLayer: false, threeD: false, audioEnabled: true, effectsActive: true, timeRemapEnabled: false, preserveTransparency: false, environmentLayer: false, frameBlending: 'none' };
    for (const k of keys) flags[k] = args[k];
    return { composition: comp(), layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1', 'solid', { enabled: flags.enabled, threeD: flags.threeD, motionBlur: flags.motionBlur }), changed: keys, skipped: [], flags };
  },
  setLayerBlendMode: (args) => ({ composition: comp(), previousBlendMode: 'normal', blendMode: args.blendMode, layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1', 'solid', { blendMode: args.blendMode }) }),
  setLayerLabelColor: (args) => {
    const idx = typeof args.label === 'number' ? args.label : LABELS.indexOf(args.label);
    const refs = args.layers ? refsFrom(args.layers) : [layerRef(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1')];
    return { composition: comp(), label: LABELS[idx], labelIndex: idx, count: refs.length, layers: refs.map((r) => ({ index: r.index, name: r.name, label: LABELS[idx] })) };
  },
  setLayerTrackMatte: (args) => {
    const none = args.type === 'none';
    const matte = none ? null : layerRef(args.matteLayer?.index ?? 1, args.matteLayer?.name ?? 'Matte');
    return {
      composition: comp(),
      layer: layerSummary(args.layer?.index ?? 2, args.layer?.name ?? 'Layer 2', 'footage', { trackMatte: args.type, trackMatteLayer: matte ? { index: matte.index, name: matte.name } : null }),
      matte,
      type: args.type,
      method: none ? 'removeTrackMatte' : 'setTrackMatte',
      movedMatte: false,
      aeVersion: 24.6,
    };
  },
  setLayerQuality: (args) => ({ composition: comp(), previousQuality: 'best', quality: args.quality, layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1') }),

  splitLayerAtTime: (args) => {
    const t = args.frame !== undefined ? args.frame / 30 : (args.time ?? 5);
    const base = args.layer?.name ?? 'Clip';
    const suffixes = args.suffixes ?? [' 1', ' 2'];
    const keep = !!args.keepNames;
    return {
      composition: comp(),
      splitTime: t,
      splitFrame: Math.round(t * 30),
      before: layerSummary(2, keep ? base : base + suffixes[0], 'footage', { outPoint: t, outFrame: Math.round(t * 30), durationFrames: Math.round(t * 30) }),
      after: layerSummary(1, keep ? base : base + suffixes[1], 'footage', { inPoint: t, inFrame: Math.round(t * 30), durationFrames: 300 - Math.round(t * 30) }),
    };
  },
  alignLayers: (args) => {
    const refs = refsFrom(args.layers);
    const target = args.relativeTo === 'selection' ? { left: 100, top: 100, right: 100 * refs.length + 200, bottom: 300 } : { left: 0, top: 0, right: 1920, bottom: 1080 };
    return {
      composition: comp(),
      relativeTo: args.relativeTo ?? 'comp',
      horizontal: args.horizontal ?? null,
      vertical: args.vertical ?? null,
      target,
      count: refs.length,
      layers: refs.map((r, i) => ({ index: r.index, name: r.name, bounds: bounds(i + 1), delta: [args.horizontal ? 10 : 0, args.vertical ? 10 : 0], position: [960 + (args.horizontal ? 10 : 0), 540 + (args.vertical ? 10 : 0)] })),
      notes: [],
    };
  },
  distributeLayers: (args) => {
    const refs = refsFrom(args.layers);
    return {
      composition: comp(),
      axis: args.axis,
      mode: args.mode ?? 'centers',
      gap: args.gap ?? 0,
      count: refs.length,
      layers: refs.map((r, i) => ({ index: r.index, name: r.name, delta: i * 10, position: args.axis === 'horizontal' ? [200 + i * 300, 540] : [960, 200 + i * 300] })),
      notes: [],
    };
  },
  sequenceLayers: (args) => {
    const refs = refsFrom(args.layers);
    const interval = args.intervalFrames !== undefined ? args.intervalFrames / 30 : (args.interval ?? 10);
    const overlap = args.overlapFrames !== undefined ? args.overlapFrames / 30 : (args.overlap ?? 0);
    const start = args.frame !== undefined ? args.frame / 30 : (args.time ?? 0);
    const layers = refs.map((r, i) => {
      const inPoint = start + i * (interval - overlap);
      const outPoint = inPoint + 10;
      const keys = args.crossfade && overlap > 0 ? (i > 0 ? 2 : 0) + (i < refs.length - 1 ? 2 : 0) : 0;
      return { index: r.index, name: r.name, startTime: inPoint, inPoint, outPoint, inFrame: Math.round(inPoint * 30), outFrame: Math.round(outPoint * 30), crossfadeKeys: keys };
    });
    return { composition: comp(), count: layers.length, start, interval: args.interval === undefined && args.intervalFrames === undefined ? null : interval, overlap, crossfade: !!args.crossfade, layers };
  },

  selectLayers: (args) => {
    let selected = [];
    if (Array.isArray(args.layers)) selected = refsFrom(args.layers);
    else if (args.layers?.all) selected = stack().map((l) => layerRef(l.index, l.name));
    return { composition: comp(), selectedCount: selected.length, selected };
  },
  getSelectedLayers: () => ({ composition: comp(), count: 2, layers: [layerSummary(1, 'Title', 'text'), layerSummary(2, 'Card', 'shape')] }),
};
