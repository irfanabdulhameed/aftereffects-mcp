/*
 * Mock result shapes for the time command group. Shapes mirror
 * src/scripts/commands/time.jsx.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerSummary = (index = 1, name = 'Clip', over = {}) => ({
  index, id: 100 + index, name, type: 'footage', enabled: true, locked: false, shy: false, solo: false,
  inPoint: 0, outPoint: 5, startTime: 0, inFrame: 0, outFrame: 150, durationFrames: 150, stretch: 100,
  parent: null, label: 'none', comment: '', hasVideo: true, hasAudio: true, isNull: false, isGuide: false, threeD: false, adjustment: false,
  blendMode: 'normal', trackMatte: 'none', trackMatteLayer: null, motionBlur: false, collapseTransformation: false,
  source: { id: 2, name: 'clip.mov', type: 'footage' }, effects: [], hasEffects: false, hasExpressions: false,
  transform: { position: [960, 540], anchorPoint: [960, 540], scale: [100, 100], rotation: 0, opacity: 100 },
  ...over,
});
const timing = (over = {}) => ({
  startTime: 0, inPoint: 0, outPoint: 5, startFrame: 0, inFrame: 0, outFrame: 150, durationSeconds: 5, durationFrames: 150,
  stretch: 100, timeRemapEnabled: true, frameRate: 30, ...over,
});
const keyframe = (i, time, value, interp = 'linear') => ({
  index: i, time, frame: Math.round(time * 30), value, inInterpolation: interp, outInterpolation: interp,
  easeIn: [{ speed: 0, influence: 16.67 }], easeOut: [{ speed: 0, influence: 16.67 }], temporalContinuous: false, temporalAutoBezier: false, selected: false,
});
const remapProperty = (keys, extra = {}) => ({
  name: 'Time Remap', matchName: 'ADBE Time Remapping', path: 'Time Remap', matchPath: 'ADBE Time Remapping', index: 1, isGroup: false,
  value: keys.length ? keys[0].value : 0, valueType: '1d', dimensions: 1, canVaryOverTime: true, isSpatial: false, numKeys: keys.length,
  hasExpression: false, keyframes: keys, ...extra,
});
const remapState = (args, keys, over = {}) => ({
  composition: comp(),
  layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Clip'),
  timing: timing(over.timing ?? {}),
  sourceDuration: 5,
  timeRemap: over.enabled === false ? null : remapProperty(keys, over.remapExtra ?? {}),
});

export const responses = {
  enableTimeRemap: (args) => {
    const enabled = args.enabled !== false;
    return { ...remapState(args, [keyframe(1, 0, 0), keyframe(2, 5, 5)], { enabled, timing: { timeRemapEnabled: enabled } }), enabled, changed: true };
  },
  setTimeRemapKeyframes: (args) => {
    const keys = (args.keys ?? []).map((k, i) => keyframe(i + 1, k.time ?? (k.frame ?? 0) / 30, k.value ?? (k.valueFrame ?? 0) / 30, k.easing || args.easing ? 'bezier' : 'linear'));
    return { ...remapState(args, keys), keyframesWritten: keys.length, keyframes: keys, replaced: args.replace ?? true };
  },
  freezeFrameAt: (args) => {
    const t = args.time ?? (args.frame ?? 0) / 30;
    const key = keyframe(1, 0, t, 'hold');
    const outPoint = args.extendToCompEnd ? 10 : args.outPoint ?? (args.outFrame !== undefined ? args.outFrame / 30 : 5);
    return { ...remapState(args, [key], { timing: { outPoint, outFrame: Math.round(outPoint * 30), durationSeconds: outPoint, durationFrames: Math.round(outPoint * 30) } }), frozenAt: { time: t, frame: Math.round(t * 30) }, sourceTime: t, sourceFrame: Math.round(t * 30), keyframe: key };
  },
  setSpeed: (args) => {
    let stretch = 100, mode = 'percent';
    if (args.percent !== undefined) stretch = args.percent;
    else if (args.speedFactor !== undefined) { stretch = 100 / args.speedFactor; mode = 'speedFactor'; }
    else if (args.fitToDuration !== undefined || args.fitToDurationFrames !== undefined) { const wanted = args.fitToDurationFrames !== undefined ? args.fitToDurationFrames / 30 : args.fitToDuration; stretch = (wanted / 5) * 100; mode = 'fitToDuration'; }
    const outPoint = 5 * (Math.abs(stretch) / 100);
    return {
      composition: comp(), layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Clip', { stretch, outPoint }),
      mode, stretch, speedFactor: 100 / Math.abs(stretch), reversed: stretch < 0, anchoredTo: args.keepInPoint === false ? 'start' : 'in',
      before: timing({ timeRemapEnabled: false }), timing: timing({ stretch, outPoint, outFrame: Math.round(outPoint * 30), durationSeconds: outPoint, durationFrames: Math.round(outPoint * 30), timeRemapEnabled: false }), notes: [],
    };
  },
  reverseLayer: (args) => ({
    composition: comp(), layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Clip', { stretch: -100 }),
    stretch: -100, reversed: true, before: timing({ timeRemapEnabled: false }), timing: timing({ stretch: -100, timeRemapEnabled: false }), notes: [],
  }),
  setFrameBlending: (args) => {
    const mode = args.mode ?? 'frame-mix';
    const compSwitch = args.compSwitch ?? mode !== 'none';
    return { composition: comp(), layer: layerSummary(args.layer?.index ?? 1, args.layer?.name ?? 'Clip'), frameBlending: mode, layerSwitch: mode !== 'none', compFrameBlending: compSwitch, compSwitchChanged: compSwitch };
  },
  loopLayer: (args) => {
    const mode = args.mode ?? 'cycle';
    const expression = args.loopBefore ? `loopOut("${mode}") + loopIn("${mode}") - value` : `loopOut("${mode}")`;
    const outPoint = args.outPoint ?? (args.outFrame !== undefined ? args.outFrame / 30 : args.duration ?? (args.durationFrames !== undefined ? args.durationFrames / 30 : 10));
    const keys = [keyframe(1, 0, 0), keyframe(2, 5 - 1 / 30, 5 - 1 / 30)];
    return {
      ...remapState(args, keys, { timing: { outPoint, outFrame: Math.round(outPoint * 30), durationSeconds: outPoint, durationFrames: Math.round(outPoint * 30) }, remapExtra: { hasExpression: true, expression, expressionEnabled: true, expressionError: '' } }),
      mode, expression, expressionError: '', lastKeyFixed: args.fixLastFrame !== false, notes: args.fixLastFrame === false ? [] : ['Last Time Remap key moved one frame earlier.'],
    };
  },
};
