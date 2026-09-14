/*
 * Mock result shapes for the transform command group. Shapes mirror what
 * server/src/scripts/commands/transform.jsx returns.
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
  isNull: false,
  isGuide: false,
  threeD: false,
  adjustment: false,
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
const pathOf = (p) => (Array.isArray(p) ? p.join('/') : String(p));
const property = (path = 'Transform/Opacity', value = 100, numKeys = 0) => ({
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
const layerFrom = (args) => layerRef(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1');
const sourceRect = () => ({ left: 0, top: 0, width: 400, height: 200 });

export const responses = {
  getPropertyValue: (args) => {
    const path = pathOf(args.property ?? 'Transform/Opacity');
    const t = args.frame !== undefined ? args.frame / 30 : (args.time ?? 0);
    const value = path.endsWith('Position') ? [960, 540] : 100;
    return {
      composition: comp(),
      layer: layerFrom(args),
      property: property(path, value),
      time: t,
      frame: Math.round(t * 30),
      valueAtTime: value,
      dimensions: Array.isArray(value) ? value.length : 1,
      hasKeyframes: false,
      expression: { hasExpression: false, expression: '', enabled: null, error: '' },
    };
  },
  setPropertyValue: (args) => {
    const path = pathOf(args.property ?? 'Transform/Opacity');
    const keyed = !!args.forceKeyframe;
    const t = args.frame !== undefined ? args.frame / 30 : (args.time ?? 0);
    return {
      composition: comp(),
      layer: layerFrom(args),
      property: property(path, args.value, keyed ? 1 : 0),
      mode: keyed ? 'keyframe' : 'value',
      previousValue: 100,
      keyIndex: keyed ? 1 : null,
      keyframe: keyed ? keyframe(1, t, args.value) : null,
      ...(keyed ? { time: t, frame: Math.round(t * 30) } : {}),
    };
  },
  setTransform: (args) => {
    const fields = ['position', 'anchorPoint', 'scale', 'rotation', 'xRotation', 'yRotation', 'zRotation', 'orientation', 'opacity'];
    const changed = fields.filter((f) => args[f] !== undefined).map((f) => (f === 'zRotation' ? 'rotation' : f));
    const hasTime = args.time !== undefined || args.frame !== undefined;
    const t = args.frame !== undefined ? args.frame / 30 : (args.time ?? 0);
    const scale = typeof args.scale === 'number' ? [args.scale, args.scale] : (args.scale ?? [100, 100]);
    return {
      composition: comp(),
      layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Layer 1', 'solid', {
        transform: { position: args.position ?? [960, 540], anchorPoint: args.anchorPoint ?? [0, 0], scale, rotation: args.zRotation ?? args.rotation ?? 0, opacity: args.opacity ?? 100 },
      }),
      changed: [...new Set(changed)],
      skipped: [],
      keyframed: hasTime,
      time: t,
      frame: Math.round(t * 30),
    };
  },
  setAnchorPoint: (args) => {
    const rect = sourceRect();
    const fractions = { center: [0.5, 0.5], 'top-left': [0, 0], 'top-center': [0.5, 0], 'top-right': [1, 0], 'center-left': [0, 0.5], 'center-right': [1, 0.5], 'bottom-left': [0, 1], 'bottom-center': [0.5, 1], 'bottom-right': [1, 1] };
    const f = typeof args.anchor === 'string' ? fractions[args.anchor] : null;
    const anchor = f ? [rect.left + rect.width * f[0], rect.top + rect.height * f[1]] : args.anchor;
    const keep = args.keepVisualPosition !== false;
    return {
      composition: comp(),
      layer: layerFrom(args),
      anchorPoint: anchor,
      position: keep ? [960 + anchor[0], 540 + anchor[1]] : [960, 540],
      previousAnchorPoint: [0, 0],
      previousPosition: [960, 540],
      sourceRect: rect,
      keepVisualPosition: keep,
      notes: [],
    };
  },
  fitLayerToComposition: (args) => {
    const rect = sourceRect();
    const margin = args.margin ?? 0;
    const sx = ((1920 - 2 * margin) / rect.width) * 100;
    const sy = ((1080 - 2 * margin) / rect.height) * 100;
    const mode = args.mode ?? 'both';
    const s = mode === 'width' ? sx : mode === 'height' ? sy : mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    return {
      composition: comp(),
      layer: layerFrom(args),
      mode,
      margin,
      scale: [s, s],
      position: args.center === false ? [960, 540] : [960 - (rect.width / 2) * s / 100, 540 - (rect.height / 2) * s / 100],
      sourceRect: rect,
      fitted: { width: rect.width * s / 100, height: rect.height * s / 100 },
      notes: [],
    };
  },
  getLayerBounds: (args) => {
    const t = args.frame !== undefined ? args.frame / 30 : (args.time ?? 0);
    const rect = sourceRect();
    return {
      sourceRect: rect,
      anchorPoint: [0, 0],
      position: [960, 540],
      scale: [100, 100],
      rotation: 0,
      corners: { topLeft: [960, 540], topRight: [1360, 540], bottomRight: [1360, 740], bottomLeft: [960, 740] },
      bounds: { left: 960, top: 540, right: 1360, bottom: 740, width: 400, height: 200 },
      notes: [],
      composition: comp(),
      layer: layerFrom(args),
      time: t,
      frame: Math.round(t * 30),
    };
  },
  separateDimensions: (args) => {
    const now = args.separate !== false;
    return {
      composition: comp(),
      layer: layerFrom(args),
      dimensionsSeparated: now,
      properties: now ? ['Transform/X Position', 'Transform/Y Position'] : ['Transform/Position'],
      matchPaths: now ? ['ADBE Transform Group/ADBE Position_0', 'ADBE Transform Group/ADBE Position_1'] : ['ADBE Transform Group/ADBE Position'],
      position: [960, 540],
    };
  },
};
