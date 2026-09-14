/*
 * Mock result shapes for the text command group. See core.js for helpers and shapes to mirror.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Title') => ({ index, id: 100 + index, name });
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
const rangeSelector = (over = {}) => ({
  index: 1,
  name: 'Range Selector 1',
  matchName: 'ADBE Text Selector',
  type: 'range',
  path: 'Text/Animators/Animator 1/Range Selector 1',
  values: { units: 'percent', start: 0, end: 100, offset: 0, basedOn: 'characters', mode: 'add', amount: 100, shape: 'square', smoothness: 100, easeHigh: 0, easeLow: 0, randomizeOrder: false, ...over },
  keyframes: { start: 0, end: 0, offset: 0 },
});
const animator = (name = 'Animator 1', properties = [], selectors = [rangeSelector()]) => ({
  index: 1,
  name,
  path: `Text/Animators/${name}`,
  enabled: true,
  properties,
  selectors,
});
const animRef = (args) => ({ index: 1, name: typeof args.animator === 'string' ? args.animator : 'Animator 1', path: 'Text/Animators/Animator 1' });
const textDocument = (over = {}) => ({ text: 'Hello', font: 'ArialMT', fontSize: 72, fillColor: '#ffffff', justification: 'center', boxText: false, boxTextSize: null, ...over });

const PRESETS = [
  { name: 'blur-in-by-character', description: 'Characters sharpen from a blur while fading in.', defaultBasedOn: 'characters', params: [{ name: 'amount', defaultValue: 30, description: 'Starting blur in pixels.' }] },
  { name: 'fade-in-by-character', description: 'Each character fades in.', defaultBasedOn: 'characters', params: [] },
  { name: 'fade-in-by-line', description: 'Each line fades in.', defaultBasedOn: 'lines', params: [] },
  { name: 'fade-in-by-word', description: 'Each word fades in.', defaultBasedOn: 'words', params: [] },
  { name: 'random-fade-in', description: 'Characters fade in in a random order.', defaultBasedOn: 'characters', params: [] },
  { name: 'rotate-in-by-character', description: 'Characters spin into place.', defaultBasedOn: 'characters', params: [{ name: 'amount', defaultValue: 90, description: 'Degrees.' }] },
  { name: 'scale-in-by-character', description: 'Characters grow from nothing.', defaultBasedOn: 'characters', params: [{ name: 'amount', defaultValue: 0, description: 'Starting scale.' }] },
  { name: 'slide-up-by-character', description: 'Characters rise into place.', defaultBasedOn: 'characters', params: [{ name: 'amount', defaultValue: 60, description: 'Pixels.' }] },
  { name: 'slide-up-by-word', description: 'Words rise into place.', defaultBasedOn: 'words', params: [{ name: 'amount', defaultValue: 60, description: 'Pixels.' }] },
  { name: 'tracking-in', description: 'Tracking tightens to normal.', defaultBasedOn: 'characters', params: [{ name: 'amount', defaultValue: 60, description: 'Starting tracking.' }] },
  { name: 'typewriter', description: 'Characters appear one at a time.', defaultBasedOn: 'characters', params: [] },
  { name: 'wave-y-position', description: 'Characters bob continuously.', defaultBasedOn: 'characters', params: [{ name: 'amount', defaultValue: 30, description: 'Wave height.' }] },
];

export const responses = {
  listFonts: (args) => {
    const fonts = [
      { postScriptName: 'Helvetica-Bold', family: 'Helvetica', style: 'Bold', fontType: 'OpenType', technology: 'CoreText', isSubstitute: false },
      { postScriptName: 'Helvetica', family: 'Helvetica', style: 'Regular', fontType: 'OpenType', technology: 'CoreText', isSubstitute: false },
      { postScriptName: 'ArialMT', family: 'Arial', style: 'Regular', fontType: 'TrueType', technology: 'CoreText', isSubstitute: false },
    ];
    const q = (args.query ?? '').toLowerCase();
    const filtered = q ? fonts.filter((f) => `${f.postScriptName} ${f.family} ${f.style}`.toLowerCase().includes(q)) : fonts;
    const max = args.maxResults ?? 200;
    return { supported: true, aeVersion: '24.6.0', query: q || null, totalInstalled: fonts.length, count: Math.min(filtered.length, max), truncated: filtered.length > max, fonts: filtered.slice(0, max) };
  },
  listTextAnimatorPresets: () => ({ count: PRESETS.length, presets: PRESETS, scheme: 'forward keys Start 0 to 100; backward keys End 100 to 0; center keys Start 50 to 0 and End 50 to 100 in subtract mode.' }),
  addTextAnimator: (args) => {
    const name = args.name ?? args.preset.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');
    const direction = args.direction ?? 'forward';
    const t0 = args.delay ?? 0;
    const t1 = t0 + (args.duration ?? 1);
    const isWave = args.preset === 'wave-y-position';
    const isTracking = args.preset === 'tracking-in';
    const startPath = `Text/Animators/${name}/Range Selector 1/Start`;
    const endPath = `Text/Animators/${name}/Range Selector 1/End`;
    let keyframes = [];
    if (isTracking) keyframes = [{ property: `Text/Animators/${name}/Tracking Amount`, keys: [keyframe(1, t0, args.amount ?? 60), keyframe(2, t1, 0)] }];
    else if (!isWave && direction === 'backward') keyframes = [{ property: endPath, keys: [keyframe(1, t0, 100), keyframe(2, t1, 0)] }];
    else if (!isWave && direction === 'center') keyframes = [{ property: startPath, keys: [keyframe(1, t0, 50), keyframe(2, t1, 0)] }, { property: endPath, keys: [keyframe(1, t0, 50), keyframe(2, t1, 100)] }];
    else if (!isWave) keyframes = [{ property: startPath, keys: [keyframe(1, t0, 0), keyframe(2, t1, 100)] }];
    const selectors = isWave ? [rangeSelector(), { index: 2, name: 'Wave', matchName: 'ADBE Text Wiggly Selector', type: 'wiggly', path: `Text/Animators/${name}/Wave`, values: { mode: 'intersect', maxAmount: 100, minAmount: -100, basedOn: 'characters', wigglesPerSecond: 1, correlation: 75 } }] : [rangeSelector({ mode: direction === 'center' ? 'subtract' : 'add', basedOn: args.basedOn ?? 'characters' })];
    return {
      composition: comp(),
      layer: layerRef(),
      preset: args.preset,
      animator: animator(name, [{ name: 'Opacity', matchName: 'ADBE Text Opacity', path: `Text/Animators/${name}/Opacity`, value: 0, numKeys: 0 }], selectors),
      animatorPath: `Text/Animators/${name}`,
      selectorPath: isWave ? `Text/Animators/${name}/Wave` : `Text/Animators/${name}/Range Selector 1`,
      startTime: t0,
      endTime: t1,
      startFrame: Math.round(t0 * 30),
      endFrame: Math.round(t1 * 30),
      direction,
      basedOn: args.basedOn ?? 'characters',
      scheme: isWave ? 'continuous wiggly selector, no keyframes' : isTracking ? 'tracking keyframed directly' : direction,
      keyframes,
      notes: [],
    };
  },
  addTextRangeSelector: (args) => ({
    composition: comp(),
    layer: layerRef(),
    animator: animRef(args),
    selector: rangeSelector({ start: args.start ?? 0, end: args.end ?? 100, offset: args.offset ?? 0, basedOn: args.basedOn ?? 'characters', shape: args.shape ?? 'square' }),
    selectorPath: 'Text/Animators/Animator 1/Range Selector 2',
    changed: Object.keys(args).filter((k) => !['comp', 'layer', 'animator', 'name'].includes(k)),
    notes: [],
  }),
  setRangeSelector: (args) => {
    const keyed = args.time !== undefined || args.frame !== undefined;
    const t = args.time ?? (args.frame ?? 0) / 30;
    const keyframes = keyed ? ['start', 'end', 'offset'].filter((k) => args[k] !== undefined).map((k) => ({ property: `Text/Animators/Animator 1/Range Selector 1/${k[0].toUpperCase()}${k.slice(1)}`, keyIndex: 1, keyframe: keyframe(1, t, args[k]) })) : [];
    return {
      composition: comp(),
      layer: layerRef(),
      animator: animRef(args),
      selector: rangeSelector({ start: args.start ?? 0, end: args.end ?? 100, offset: args.offset ?? 0 }),
      selectorPath: 'Text/Animators/Animator 1/Range Selector 1',
      changed: Object.keys(args).filter((k) => !['comp', 'layer', 'animator', 'selector', 'time', 'frame', 'easing'].includes(k)),
      keyframes,
      notes: [],
    };
  },
  addTextWigglySelector: (args) => ({
    composition: comp(),
    layer: layerRef(),
    animator: animRef(args),
    selector: { index: 2, name: args.name ?? 'Wiggly Selector 1', matchName: 'ADBE Text Wiggly Selector', type: 'wiggly', path: 'Text/Animators/Animator 1/Wiggly Selector 1', values: { mode: args.mode ?? 'intersect', maxAmount: args.maxAmount ?? 100, minAmount: args.minAmount ?? -100, basedOn: args.basedOn ?? 'characters', wigglesPerSecond: args.wigglesPerSecond ?? 2, correlation: args.correlation ?? 50, temporalPhase: args.temporalPhase ?? 0, spatialPhase: args.spatialPhase ?? 0, lockDimensions: args.lockDimensions ?? false, randomSeed: args.randomSeed ?? 0 } },
    selectorPath: 'Text/Animators/Animator 1/Wiggly Selector 1',
    changed: Object.keys(args).filter((k) => !['comp', 'layer', 'animator', 'name'].includes(k)),
    notes: [],
  }),
  addTextExpressionSelector: (args) => ({
    composition: comp(),
    layer: layerRef(),
    animator: animRef(args),
    selector: { index: 2, name: args.name ?? 'Expression Selector 1', matchName: 'ADBE Text Expressible Selector', type: 'expression', path: 'Text/Animators/Animator 1/Expression Selector 1', values: { basedOn: args.basedOn ?? 'characters', amount: [100, 100, 100] }, expression: args.expression, expressionError: '' },
    selectorPath: 'Text/Animators/Animator 1/Expression Selector 1',
    amountPath: 'Text/Animators/Animator 1/Expression Selector 1/Amount',
    expressionState: { hasExpression: true, expression: args.expression, enabled: true, error: '' },
    notes: [],
  }),
  convertTextToShapes: (args) => ({
    composition: comp(),
    sourceLayer: { ...layerRef(2, 'Title'), enabled: args.keepSource ?? false },
    shapeLayer: { index: 1, id: 150, name: 'Title Outlines', type: 'shape', enabled: true, inPoint: 0, outPoint: 10, effects: [], transform: { position: [960, 540] } },
    groupCount: 5,
  }),
  setTextBox: (args) => ({
    composition: comp(),
    layer: layerRef(),
    changed: args.pointText ? ['boxText'] : ['boxText', 'boxTextSize'],
    textDocument: textDocument({ boxText: !args.pointText, boxTextSize: args.pointText ? null : args.boxSize }),
  }),
};
