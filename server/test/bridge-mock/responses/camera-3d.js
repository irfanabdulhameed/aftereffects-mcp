/*
 * Mock result shapes for the camera-3d command group. Shapes mirror
 * src/scripts/commands/camera-3d.jsx.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Camera 1') => ({ index, id: 100 + index, name });
const layerSummary = (index = 1, name = 'Camera 1', type = 'camera') => ({
  index, id: 100 + index, name, type, enabled: true, locked: false, shy: false, solo: false,
  inPoint: 0, outPoint: 10, startTime: 0, inFrame: 0, outFrame: 300, durationFrames: 300, stretch: 100,
  parent: null, label: 'none', comment: '', hasVideo: type !== 'camera' && type !== 'light', hasAudio: false,
  isNull: false, isGuide: false, threeD: true, adjustment: false, blendMode: 'normal', trackMatte: 'none', trackMatteLayer: null,
  motionBlur: false, collapseTransformation: false, source: null, effects: [], hasEffects: false, hasExpressions: false,
  transform: { position: [960, 540, -2666.67], anchorPoint: [0, 0, 0], scale: [100, 100, 100], rotation: 0, opacity: 100 },
});
const keyframe = (i, time, value) => ({
  index: i, time, frame: Math.round(time * 30), value, inInterpolation: 'bezier', outInterpolation: 'bezier',
  easeIn: [{ speed: 0, influence: 66 }], easeOut: [{ speed: 0, influence: 66 }], temporalContinuous: false, temporalAutoBezier: false, selected: false,
});
const property = (path, value, extra = {}) => ({
  name: path.split('/').pop(), matchName: 'ADBE ' + path.split('/').pop(), path, matchPath: path, index: 1, isGroup: false,
  value, valueType: Array.isArray(value) ? '3d-spatial' : '1d', dimensions: Array.isArray(value) ? value.length : 1,
  canVaryOverTime: true, isSpatial: Array.isArray(value), numKeys: 0, hasExpression: false, ...extra,
});
const cameraOptions = (over = {}) => ({
  zoom: 2666.67, depthOfField: false, focusDistance: 2666.67, aperture: 17.7, blurLevel: 100, irisShape: 'fast-rectangle',
  irisRotation: 0, irisRoundness: 0, irisAspectRatio: 1, irisDiffractionFringe: 0, highlightGain: 0, highlightThreshold: 255, highlightSaturation: 0, ...over,
});
const cameraSummary = (args, over = {}) => ({
  composition: comp(),
  layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Camera 1', 'camera'),
  twoNode: true,
  position: [960, 540, -2666.67],
  pointOfInterest: [960, 540, 0],
  cameraOptions: cameraOptions(over),
  focalLengthMm: 50,
  keyframedProperties: [],
});
const applied = (args, table, skip = ['comp', 'layer', 'time', 'frame', 'easing', 'enable3d']) =>
  Object.keys(args)
    .filter((k) => !skip.includes(k))
    .map((k) => ({ arg: k, property: `${table}/${k}`, matchName: 'ADBE ' + k, value: args[k], keyIndex: args.time !== undefined || args.frame !== undefined ? 1 : null }));

export const responses = {
  setCameraSettings: (args) => {
    const over = {};
    if (args.zoom !== undefined) over.zoom = args.zoom;
    else if (args.focalLength !== undefined) over.zoom = (1920 * args.focalLength) / 36;
    if (args.depthOfField !== undefined) over.depthOfField = args.depthOfField;
    if (args.focusDistance !== undefined) over.focusDistance = args.focusDistance;
    if (args.aperture !== undefined) over.aperture = args.aperture;
    const notes = [];
    if (args.focalLength !== undefined && args.zoom === undefined) notes.push(`focalLength ${args.focalLength} mm converted to zoom ${over.zoom} px using a 36 mm film width.`);
    return { ...cameraSummary(args, over), applied: applied({ ...args, focalLength: undefined }, 'Camera Options').filter((a) => a.value !== undefined), notes };
  },
  animateCamera: (args) => {
    const t0 = args.startTime ?? (args.startFrame ?? 0) / 30;
    const dur = args.duration ?? (args.durationFrames ?? 60) / 30;
    const t1 = t0 + dur;
    const prop = args.move === 'rack-focus' ? 'Camera Options/Focus Distance' : args.move === 'push-in' || args.move === 'pull-out' ? 'Camera Options/Zoom' : 'Transform/Position';
    const isScalar = prop !== 'Transform/Position';
    const keys = args.move === 'orbit'
      ? Array.from({ length: 4 }, (_, i) => ({ ...keyframe(i + 1, t0 + (dur * i) / 3, [960 + i * 100, 540, -2666]), inInterpolation: 'linear', outInterpolation: 'linear' }))
      : [keyframe(1, t0, isScalar ? 2666.67 : [960, 540, -2666.67]), keyframe(2, t1, isScalar ? 3466.67 : [960, 540, -2166.67])];
    return {
      composition: comp(), layer: layerRef(), move: args.move,
      startTime: t0, endTime: t1, startFrame: Math.round(t0 * 30), endFrame: Math.round(t1 * 30),
      easing: args.easing ?? 'ease-in-out', twoNode: true,
      propertyPaths: [prop], keyframes: [{ property: prop, keyframes: keys }],
      notes: args.move === 'orbit' ? ['Orbit sampled every 2 frame(s) with linear keys.'] : [],
    };
  },
  setLightSettings: (args) => ({
    composition: comp(),
    layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Light 1', 'light'),
    lightType: args.lightType ?? 'spot',
    twoNode: true,
    position: [960, 540, -1000],
    pointOfInterest: [960, 540, 0],
    lightOptions: { intensity: args.intensity ?? 100, color: '#ffffff', coneAngle: args.coneAngle ?? 90, coneFeather: args.coneFeather ?? 50, falloff: 'none', radius: 500, falloffDistance: 500, castsShadows: args.castsShadows ?? false, shadowDarkness: 100, shadowDiffusion: 0 },
    keyframedProperties: [],
    applied: applied(args, 'Light Options', ['comp', 'layer', 'time', 'frame', 'easing', 'lightType']),
    notes: [],
  }),
  setLayer3d: (args) => {
    const refs = Array.isArray(args.layers) ? args.layers : args.layer ? [args.layer] : [{ index: 1 }];
    return {
      composition: comp(), count: refs.length,
      layers: refs.map((r, i) => ({ layer: { ...layerSummary(r.index ?? i + 1, r.name ?? `Layer ${i + 1}`, 'solid'), threeD: args.threeD ?? true }, changed: ['threeD'].concat(args.autoOrient ? ['autoOrient'] : []), autoOrient: args.autoOrient ?? 'none' })),
      notes: [],
    };
  },
  setMaterialOptions: (args) => ({
    composition: comp(),
    layer: { ...layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Card', 'solid'), threeD: true },
    materialOptions: { castsShadows: typeof args.castsShadows === 'boolean' ? (args.castsShadows ? 'on' : 'off') : args.castsShadows ?? 'off', lightTransmission: 0, acceptsShadows: 'on', acceptsLights: true, appearsInReflections: 'on', ambient: 100, diffuse: args.diffuse ?? 50, specularIntensity: 50, specularShininess: 5, metal: 100 },
    applied: applied(args, 'Material Options'),
    notes: [],
  }),
  lookAtLayer: (args) => {
    const mode = args.useExpression ? 'expression' : 'point-of-interest';
    const targetName = args.target?.name ?? 'Target';
    const base = { composition: comp(), layer: layerRef(), mode, target: { index: 2, id: 102, name: targetName }, notes: [] };
    if (mode === 'expression') {
      const expression = `lookAt(transform.position, thisComp.layer("${targetName}").transform.position)`;
      return { ...base, property: property('Transform/Orientation', [0, 0, 0], { hasExpression: true, expression, expressionEnabled: true, expressionError: '' }), expression };
    }
    return { ...base, property: property('Transform/Point of Interest', [960, 540, 0]), value: [960, 540, 0], keyIndex: args.time !== undefined || args.frame !== undefined ? 1 : null };
  },
};
