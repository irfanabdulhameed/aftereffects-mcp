/*
 * Mock result shapes for the masks command group. See core.js for helpers and shapes to mirror.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 3, name = 'Photo') => ({ index, id: 100 + index, name });
const keyframe = (i, time, value) => ({
  index: i,
  time,
  frame: Math.round(time * 30),
  value,
  inInterpolation: 'bezier',
  outInterpolation: 'bezier',
  easeIn: [{ speed: 0, influence: 66 }],
  easeOut: [{ speed: 0, influence: 33.33 }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});
const mask = (over = {}) => {
  const name = over.name ?? 'Mask 1';
  return {
    index: 1,
    name,
    path: `Masks/${name}`,
    matchName: 'ADBE Mask Atom',
    mode: 'add',
    inverted: false,
    locked: false,
    color: '#ff0000',
    motionBlur: 'SAME_AS_LAYER',
    feather: [0, 0],
    opacity: 100,
    expansion: 0,
    vertexCount: 4,
    closed: true,
    keyframes: { path: 0, feather: 0, opacity: 0, expansion: 0 },
    paths: { maskPath: `Masks/${name}/Mask Path`, feather: `Masks/${name}/Mask Feather`, opacity: `Masks/${name}/Mask Opacity`, expansion: `Masks/${name}/Mask Expansion` },
    ...over,
  };
};
const rectShape = (x, y, w, h) => ({ vertices: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], inTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], closed: true });
const featherOf = (f) => (f === undefined ? [0, 0] : Array.isArray(f) ? f : [f, f]);
const geometryOf = (args) => {
  if (args.shape === 'points' || (args.shape === undefined && args.points)) return { kind: 'points', vertexCount: args.points?.length ?? 0 };
  if (args.shape === 'ellipse') return { kind: 'ellipse', center: args.center ?? [960, 540], size: args.size ?? [1920, 1080], vertexCount: 4 };
  const rect = args.rect ?? (args.size ? { x: (args.center?.[0] ?? 960) - args.size[0] / 2, y: (args.center?.[1] ?? 540) - args.size[1] / 2, width: args.size[0], height: args.size[1] } : { x: 0, y: 0, width: 1920, height: 1080 });
  return { kind: args.shape === 'text-bounds' ? 'text-bounds' : 'rectangle', rect, vertexCount: 4 };
};

export const responses = {
  createMask: (args) => {
    const g = geometryOf(args);
    return {
      composition: comp(),
      layer: layerRef(),
      mask: mask({ name: args.name ?? 'Mask 1', mode: args.mode ?? 'add', inverted: args.inverted ?? false, feather: featherOf(args.feather), opacity: args.opacity ?? 100, expansion: args.expansion ?? 0, vertexCount: g.vertexCount }),
      maskPath: `Masks/${args.name ?? 'Mask 1'}`,
      geometry: g,
      changed: Object.keys(args).filter((k) => ['mode', 'inverted', 'feather', 'opacity', 'expansion'].includes(k)),
      notes: [],
      maskCount: 1,
    };
  },
  listMasks: () => ({ composition: comp(), layer: layerRef(), count: 2, masks: [mask(), mask({ index: 2, name: 'Mask 2', mode: 'subtract', feather: [20, 20] })] }),
  setMaskProperties: (args) => {
    const keyed = args.time !== undefined || args.frame !== undefined;
    const t = args.time ?? (args.frame ?? 0) / 30;
    const changed = Object.keys(args).filter((k) => ['mode', 'inverted', 'feather', 'opacity', 'expansion', 'name', 'locked', 'color'].includes(k));
    const keyframes = keyed
      ? ['feather', 'opacity', 'expansion'].filter((k) => args[k] !== undefined).map((k) => ({ property: `Masks/Mask 1/Mask ${k === 'expansion' ? 'Expansion' : k[0].toUpperCase() + k.slice(1)}`, keyIndex: 1, keyframe: keyframe(1, t, k === 'feather' ? featherOf(args.feather) : args[k]) }))
      : [];
    return { composition: comp(), layer: layerRef(), mask: mask({ name: args.name ?? 'Mask 1', mode: args.mode ?? 'add', inverted: args.inverted ?? false, feather: featherOf(args.feather), opacity: args.opacity ?? 100, expansion: args.expansion ?? 0 }), changed, keyframes, notes: [] };
  },
  setMaskPathKeyframe: (args) => {
    const keyed = args.time !== undefined || args.frame !== undefined;
    const t = args.time ?? (args.frame ?? 0) / 30;
    const g = geometryOf(args);
    const value = g.kind === 'points' ? { vertices: args.points, closed: args.closed ?? true } : rectShape(g.rect?.x ?? 0, g.rect?.y ?? 0, g.rect?.width ?? 100, g.rect?.height ?? 100);
    return { composition: comp(), layer: layerRef(), mask: mask({ keyframes: { path: keyed ? 1 : 0, feather: 0, opacity: 0, expansion: 0 } }), geometry: g, vertexCount: g.vertexCount, keyIndex: keyed ? 1 : null, keyframe: keyed ? keyframe(1, t, value) : null };
  },
  deleteMask: (args) => ({ composition: comp(), layer: layerRef(), removed: { index: typeof args.mask === 'number' ? args.mask : 1, name: typeof args.mask === 'string' ? args.mask : 'Mask 1' }, remainingCount: 1, masks: [{ index: 1, name: 'Mask 2' }] }),
  createMaskFromShapeLayer: (args) => ({
    composition: comp(),
    layer: layerRef(),
    shapeLayer: { index: 2, id: 102, name: typeof args.shapeLayer?.name === 'string' ? args.shapeLayer.name : 'LOGO Outlines' },
    sourceGroup: { name: 'Group 1', matchName: 'ADBE Vector Group', kind: 'group', index: 1, path: 'Contents/Group 1', enabled: true },
    sourceItem: { name: 'Path 1', matchName: 'ADBE Vector Shape - Group', kind: 'path', index: 1, path: 'Contents/Group 1/Path 1', enabled: true },
    offset: [0, 0],
    mask: mask({ name: args.name ?? 'Group 1 Mask', feather: featherOf(args.feather), vertexCount: 12 }),
    maskPath: `Masks/${args.name ?? 'Group 1 Mask'}`,
    changed: Object.keys(args).filter((k) => ['mode', 'inverted', 'feather', 'opacity', 'expansion'].includes(k)),
    notes: [],
  }),
  maskRevealAnimation: (args) => {
    const t0 = args.startTime ?? (args.startFrame ?? 0) / 30;
    const t1 = t0 + (args.durationFrames !== undefined ? args.durationFrames / 30 : (args.duration ?? 1));
    const name = args.name ?? `Reveal ${args.direction}`;
    const full = rectShape(0, 0, 1920, 1080);
    let keyframes;
    if (args.direction === 'feather') keyframes = [{ property: `Masks/${name}/Mask Feather`, keys: [keyframe(1, t0, [args.featherAmount ?? 200, args.featherAmount ?? 200]), keyframe(2, t1, [0, 0])] }];
    else if (args.direction === 'expansion') keyframes = [{ property: `Masks/${name}/Mask Expansion`, keys: [keyframe(1, t0, -961), keyframe(2, t1, 0)] }];
    else keyframes = [{ property: `Masks/${name}/Mask Path`, keys: [keyframe(1, t0, rectShape(0, 0, 0, 1080)), keyframe(2, t1, full)] }];
    return {
      composition: comp(),
      layer: layerRef(),
      direction: args.direction,
      bounds: { left: 0, top: 0, width: 1920, height: 1080 },
      mask: mask({ name, mode: args.mode ?? 'add', keyframes: { path: args.direction === 'feather' || args.direction === 'expansion' ? 0 : 2, feather: args.direction === 'feather' ? 2 : 0, opacity: 0, expansion: args.direction === 'expansion' ? 2 : 0 } }),
      maskPath: `Masks/${name}`,
      startTime: t0,
      endTime: t1,
      startFrame: Math.round(t0 * 30),
      endFrame: Math.round(t1 * 30),
      keyframes,
    };
  },
};
