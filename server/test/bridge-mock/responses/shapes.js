/*
 * Mock result shapes for the shapes command group. See core.js for helpers and shapes to mirror.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 2, name = 'Card') => ({ index, id: 100 + index, name });
const node = (name, matchName, kind, index = 1, path = `Contents/${name}`) => ({ name, matchName, kind, index, path, enabled: true });
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
const property = (path, value) => ({
  name: path.split('/').pop(),
  matchName: 'ADBE Vector Shape',
  path,
  matchPath: path,
  index: 1,
  isGroup: false,
  value,
  valueType: 'shape',
  dimensions: 1,
  canVaryOverTime: true,
  isSpatial: false,
  numKeys: 0,
  hasExpression: false,
});
const MODIFIER_MATCH = {
  'trim-paths': ['Trim Paths 1', 'ADBE Vector Filter - Trim'],
  'offset-paths': ['Offset Paths 1', 'ADBE Vector Filter - Offset'],
  'round-corners': ['Round Corners 1', 'ADBE Vector Filter - RC'],
  'pucker-bloat': ['Pucker & Bloat 1', 'ADBE Vector Filter - PB'],
  'wiggle-paths': ['Wiggle Paths 1', 'ADBE Vector Filter - Roughen'],
  'wiggle-transform': ['Wiggle Transform 1', 'ADBE Vector Filter - Wiggler'],
  twist: ['Twist 1', 'ADBE Vector Filter - Twist'],
  'zig-zag': ['Zig Zag 1', 'ADBE Vector Filter - Zigzag'],
  repeater: ['Repeater 1', 'ADBE Vector Filter - Repeater'],
  'merge-paths': ['Merge Paths 1', 'ADBE Vector Filter - Merge'],
};
const modifier = (type, scope = 'root', params = {}) => {
  const [name, matchName] = MODIFIER_MATCH[type];
  const base = scope === 'root' ? `Contents/${name}` : `Contents/Group 1/${name}`;
  return { ...node(name, matchName, 'modifier', 3, base), properties: Object.entries(params).map(([k, v]) => ({ name: k, matchName: k, path: `${base}/${k}`, value: v, numKeys: 0, isGroup: false })) };
};

export const responses = {
  addShapeToLayer: (args) => ({
    composition: comp(),
    layer: layerRef(),
    group: node(args.groupName ?? 'Group 2', 'ADBE Vector Group', 'group', 2),
    groupPath: `Contents/${args.groupName ?? 'Group 2'}`,
    pathPropertyPath: `Contents/${args.groupName ?? 'Group 2'}/${args.shapeType === 'ellipse' || args.shapeType === 'circle' ? 'Ellipse Path 1' : 'Rectangle Path 1'}`,
    fillPath: args.noFill ? null : `Contents/${args.groupName ?? 'Group 2'}/Fill 1`,
    strokePath: args.strokeWidth ? `Contents/${args.groupName ?? 'Group 2'}/Stroke 1` : null,
    shape: { type: args.shapeType ?? 'rectangle', size: args.size ?? [200, 200] },
    offset: args.offset ?? [0, 0],
    groupCount: 2,
  }),
  setShapeFill: (args) => {
    const gradient = args.gradient !== undefined;
    const warnings = [];
    if (gradient && args.gradient?.stops?.length) warnings.push(`Gradient colour stops cannot be written by After Effects scripting; the ${args.gradient.stops.length} stops were not applied.`);
    return {
      composition: comp(),
      layer: layerRef(),
      group: node('Group 1', 'ADBE Vector Group', 'group'),
      fill: gradient ? node('Gradient Fill 1', 'ADBE Vector Graphic - G-Fill', 'gradient-fill', 2, 'Contents/Group 1/Gradient Fill 1') : node('Fill 1', 'ADBE Vector Graphic - Fill', 'fill', 2, 'Contents/Group 1/Fill 1'),
      fillPath: gradient ? 'Contents/Group 1/Gradient Fill 1' : 'Contents/Group 1/Fill 1',
      values: gradient
        ? { kind: 'gradient-fill', color: null, opacity: args.opacity ?? 100, gradientType: args.gradient?.type ?? 'linear', start: args.gradient?.start ?? [0, 0], end: args.gradient?.end ?? [100, 0] }
        : { kind: 'fill', color: '#1e90ff', opacity: args.opacity ?? 100 },
      received: { color: args.color ?? null },
      changed: Object.keys(args).filter((k) => !['comp', 'layer', 'group'].includes(k)),
      warnings,
    };
  },
  setShapeStroke: (args) => ({
    composition: comp(),
    layer: layerRef(),
    group: node('Group 1', 'ADBE Vector Group', 'group'),
    stroke: node('Stroke 1', 'ADBE Vector Graphic - Stroke', 'stroke', 3, 'Contents/Group 1/Stroke 1'),
    strokePath: 'Contents/Group 1/Stroke 1',
    values: { color: '#ffffff', width: args.width ?? 2, opacity: args.opacity ?? 100, lineCap: args.lineCap ?? 'butt', lineJoin: args.lineJoin ?? 'miter' },
    changed: Object.keys(args).filter((k) => !['comp', 'layer', 'group'].includes(k)),
    notes: [],
  }),
  setShapePath: (args) => {
    const keyed = args.time !== undefined || args.frame !== undefined;
    const t = args.time ?? (args.frame ?? 0) / 30;
    const value = { vertices: args.points, inTangents: args.inTangents ?? args.points.map(() => [0, 0]), outTangents: args.outTangents ?? args.points.map(() => [0, 0]), closed: args.closed ?? true };
    return {
      composition: comp(),
      layer: layerRef(),
      property: { ...property(typeof args.pathProperty === 'string' ? args.pathProperty : 'Contents/Group 1/Path 1/Path', value), numKeys: keyed ? 1 : 0 },
      vertexCount: args.points.length,
      closed: args.closed ?? true,
      keyIndex: keyed ? 1 : null,
      keyframe: keyed ? keyframe(1, t, value) : null,
    };
  },
  addShapeModifier: (args) => {
    const scope = args.group !== undefined && !args.root ? 'group' : 'root';
    const mod = modifier(args.type, scope, args.params ?? {});
    return { composition: comp(), layer: layerRef(), type: args.type, scope, modifier: mod, modifierPath: mod.path, applied: Object.keys(args.params ?? {}), notes: [] };
  },
  animateTrimPaths: (args) => {
    const scope = args.group !== undefined ? 'group' : 'root';
    const t0 = args.startTime ?? (args.startFrame ?? 0) / 30;
    const t1 = t0 + (args.durationFrames !== undefined ? args.durationFrames / 30 : (args.duration ?? 1));
    const mod = modifier('trim-paths', scope, { Start: 0, End: 100, Offset: 0 });
    const plan = args.start || args.end || args.offset ? args : { end: { from: 0, to: 100 } };
    const keyframes = ['start', 'end', 'offset'].filter((k) => plan[k]).map((k) => ({ property: `${mod.path}/${k[0].toUpperCase()}${k.slice(1)}`, keys: [keyframe(1, t0, plan[k].from), keyframe(2, t1, plan[k].to)] }));
    return { composition: comp(), layer: layerRef(), scope, created: true, modifier: mod, modifierPath: mod.path, startTime: t0, endTime: t1, startFrame: Math.round(t0 * 30), endFrame: Math.round(t1 * 30), keyframes, notes: [] };
  },
  addRepeater: (args) => {
    const scope = args.group !== undefined ? 'group' : 'root';
    const mod = modifier('repeater', scope, { Copies: args.copies ?? 3, Offset: args.offset ?? 0 });
    if (args.name) mod.name = args.name;
    return { composition: comp(), layer: layerRef(), scope, repeater: mod, repeaterPath: mod.path, changed: ['copies', ...Object.keys(args.transform ?? {}).map((k) => `transform.${k}`)], notes: [] };
  },
  listShapeGroups: (args) => ({
    composition: comp(),
    layer: layerRef(),
    groupCount: 1,
    count: 2,
    contents: [
      {
        ...node('Group 1', 'ADBE Vector Group', 'group', 1),
        children: (args.depth ?? 3) > 1 ? [
          { ...node('Rectangle Path 1', 'ADBE Vector Shape - Rect', 'rect', 1, 'Contents/Group 1/Rectangle Path 1'), size: [200, 200] },
          { ...node('Fill 1', 'ADBE Vector Graphic - Fill', 'fill', 2, 'Contents/Group 1/Fill 1'), color: '#ffffff' },
          { ...node('Stroke 1', 'ADBE Vector Graphic - Stroke', 'stroke', 3, 'Contents/Group 1/Stroke 1'), color: '#000000', width: 2 },
          node('Transform', 'ADBE Vector Transform Group', 'transform', 4, 'Contents/Group 1/Transform'),
        ] : [],
      },
      modifier('trim-paths', 'root', { Start: 0, End: 100, Offset: 0 }),
    ],
  }),
};
