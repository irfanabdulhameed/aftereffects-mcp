/*
 * Mock result shapes for the text-extras commands. See core.js for helpers and shapes to mirror.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Title') => ({ index, id: 100 + index, name });
const refOf = (ref, fallbackIndex = 1, fallbackName = 'Title') => layerRef(ref?.index ?? fallbackIndex, ref?.name ?? fallbackName);

const layerSummary = (index, name, type, over = {}) => ({
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

const keyframe = (index, time, value, easeIn = 75, easeOut = 40) => ({
  index,
  time,
  frame: Math.round(time * 30),
  value,
  inInterpolation: 'bezier',
  outInterpolation: 'bezier',
  easeIn: [{ speed: 0, influence: easeIn }],
  easeOut: [{ speed: 0, influence: easeOut }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});

const timeOf = (o, startKey, frameKey, fallback) => (o?.[frameKey] !== undefined ? o[frameKey] / 30 : o?.[startKey] ?? fallback);

const hex = (c) => (Array.isArray(c) ? '#' + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : c);

export const responses = {
  setTextOnPath: (args) => {
    const created = !!args.fromShapeLayer;
    const maskName = created ? args.maskName ?? 'Group 1 Mask' : typeof args.mask === 'string' ? args.mask : 'Mask 1';
    const pathLength = 1884.9;
    const textWidth = 640.2;
    const changed = ['path'];
    for (const k of ['perpendicular', 'forceAlignment', 'reversePath']) if (args[k] !== undefined) changed.push(k);
    if (args.justification !== undefined || args.travel) changed.push('justification');
    for (const k of ['firstMargin', 'lastMargin']) if (args[k] !== undefined) changed.push(k);
    let travel = null;
    if (args.travel) {
      const t0 = timeOf(args.travel, 'startTime', 'startFrame', 0);
      const dur = args.travel.durationFrames !== undefined ? args.travel.durationFrames / 30 : args.travel.duration ?? 2;
      const from = args.travel.from ?? 0;
      const to = args.travel.to ?? Math.round((pathLength - textWidth) * 10) / 10;
      travel = {
        from,
        to,
        property: 'Text/Path Options/First Margin',
        startTime: t0,
        endTime: t0 + dur,
        startFrame: Math.round(t0 * 30),
        endFrame: Math.round((t0 + dur) * 30),
        keys: [keyframe(1, t0, from), keyframe(2, t0 + dur, to)],
      };
      changed.push('travel');
    }
    return {
      composition: comp(),
      layer: refOf(args.layer),
      mask: { index: 1, name: maskName, path: `Masks/${maskName}`, matchName: 'ADBE Mask Atom', mode: 'none', inverted: false, locked: false, color: '#ff0000', motionBlur: 'SAME_AS_LAYER', feather: [0, 0], opacity: 100, expansion: 0, vertexCount: 4, closed: true, keyframes: { path: 0, feather: 0, opacity: 0, expansion: 0 } },
      createdMask: created,
      shapeLayer: created ? refOf(args.fromShapeLayer.layer, 2, 'Curve') : null,
      pathIndex: 1,
      pathClosed: true,
      pathLength,
      textWidth,
      options: {
        perpendicular: args.perpendicular ?? true,
        forceAlignment: args.forceAlignment ?? false,
        reversePath: args.reversePath ?? false,
        firstMargin: args.travel ? travel.from : args.firstMargin ?? 0,
        lastMargin: args.lastMargin ?? 0,
      },
      changed,
      travel,
      notes: ["Mask 'Mask 1' was set to mode None so it guides the text without cutting it."],
    };
  },

  setPerCharacter3d: (args) => {
    const layer = refOf(args.layer);
    if (args.enabled === false) {
      return { composition: comp(), layer: layerSummary(layer.index, layer.name, 'text', { threeD: true }), threeDPerChar: false, changed: true, animator: null, notes: [] };
    }
    const rv = args.reveal;
    const out = {
      composition: comp(),
      layer: layerSummary(layer.index, layer.name, 'text', { threeD: true }),
      threeDPerChar: true,
      changed: true,
      animator: null,
      animatorPath: null,
      selectorPath: null,
      keyframes: [],
      pose: null,
      preset: null,
      pivot: null,
      notes: [],
    };
    if (!rv) return out;
    const POSES = {
      'flip-x': { rotationX: -90, opacity: 0 },
      'flip-y': { rotationY: 90, opacity: 0 },
      tumble: { rotationX: -70, rotationY: 30, rotationZ: -25, positionZ: -120, opacity: 0 },
      'push-z': { positionZ: 400, opacity: 0 },
    };
    const explicit = Object.fromEntries(['rotationX', 'rotationY', 'rotationZ', 'positionZ', 'opacity'].filter((k) => rv[k] !== undefined).map((k) => [k, rv[k]]));
    const preset = rv.preset ?? (Object.keys(explicit).length ? null : 'flip-x');
    const pose = { ...(preset ? POSES[preset] : {}), ...explicit };
    const dir = rv.direction ?? 'forward';
    const t0 = timeOf(rv, 'startTime', 'startFrame', 0);
    const dur = rv.durationFrames !== undefined ? rv.durationFrames / 30 : rv.duration ?? 1;
    const name = rv.name ?? `3D ${preset ?? 'Reveal'}`;
    const MN = { positionZ: ['ADBE Text Position 3D', 'Position'], rotationX: ['ADBE Text Rotation X', 'X Rotation'], rotationY: ['ADBE Text Rotation Y', 'Y Rotation'], rotationZ: ['ADBE Text Rotation', 'Z Rotation'], opacity: ['ADBE Text Opacity', 'Opacity'] };
    const v0 = dir === 'backward' ? 100 : -100;
    return {
      ...out,
      animator: {
        index: 1,
        name,
        path: `Text/Animators/${name}`,
        enabled: true,
        properties: Object.entries(pose).map(([k, v]) => ({ name: MN[k][1], matchName: MN[k][0], path: `Text/Animators/${name}/Properties/${MN[k][1]}`, value: k === 'positionZ' ? [0, 0, v] : v, numKeys: 0 })),
        selectors: [{ index: 1, name: 'Range Selector 1', matchName: 'ADBE Text Selector', type: 'range', path: `Text/Animators/${name}/Selectors/Range Selector 1`, values: { units: 'percent', start: 0, end: 100, offset: v0, basedOn: rv.basedOn ?? 'characters', mode: 'add', amount: 100, shape: dir === 'backward' ? 'ramp-down' : 'ramp-up', smoothness: 100, easeHigh: 50, easeLow: 50, randomizeOrder: false }, keyframes: { start: 0, end: 0, offset: 2 } }],
      },
      animatorPath: `Text/Animators/${name}`,
      selectorPath: `Text/Animators/${name}/Selectors/Range Selector 1`,
      keyframes: [{ property: `Text/Animators/${name}/Selectors/Range Selector 1/Offset`, keys: [keyframe(1, t0, v0, 80, 30), keyframe(2, t0 + dur, -v0, 80, 30)] }],
      pose,
      preset,
      pivot: rv.pivot ?? 'center',
      direction: dir,
      basedOn: rv.basedOn ?? 'characters',
      startTime: t0,
      endTime: t0 + dur,
      startFrame: Math.round(t0 * 30),
      endFrame: Math.round((t0 + dur) * 30),
      scheme: dir === 'backward' ? 'Ramp Down, Offset 100 to -100' : 'Ramp Up, Offset -100 to 100',
    };
  },

  addTextBox: (args) => {
    const text = refOf(args.layer, 2, 'CTA');
    const pad = Array.isArray(args.padding) ? args.padding : args.padding !== undefined ? [args.padding, args.padding] : [24, 12];
    const pill = args.cornerRadius === 'pill';
    const link = args.link ?? 'parent';
    const head = `var t = thisComp.layer("${text.name}");\nvar r = t.sourceRectAtTime(time, false);\nvar px = ${pad[0]}, py = ${pad[1]};\nvar x = r.left, w = r.width, y = r.top, h = r.height;\nvar W = Math.max(w + 2 * px, ${args.minWidth ?? 0}), H = h + 2 * py;\n`;
    const name = args.name ?? `${text.name} Box`;
    return {
      composition: comp(),
      textLayer: text,
      layer: layerSummary(text.index + 1, name, 'shape', { parent: link === 'parent' ? { index: text.index, name: text.name } : null, hasExpressions: true, transform: { position: [0, 0], anchorPoint: [0, 0], scale: [100, 100], rotation: 0, opacity: 100 } }),
      groupPath: 'Contents/Box',
      padding: pad,
      cornerRadius: pill ? 'pill' : args.cornerRadius ?? 12,
      heightFrom: args.heightFrom ?? 'text',
      link,
      fillColor: args.fillColor ? hex(args.fillColor) : '#111827',
      size: [320 + 2 * pad[0], 48 + 2 * pad[1]],
      expressions: {
        size: head + '[W, H]',
        position: head + (link === 'expression' ? 'var p = t.toComp([x + w / 2, y + h / 2]);\n[p[0], p[1]]' : '[x + w / 2, y + h / 2]'),
        roundness: head + (pill ? 'Math.min(W, H) / 2' : `Math.min(${args.cornerRadius ?? 12}, Math.min(W, H) / 2)`),
        opacity: args.linkOpacity === false ? null : `thisComp.layer("${text.name}").transform.opacity`,
      },
      expressionErrors: [],
      shadow: args.shadow
        ? { status: 'ok', layer: layerRef(text.index + 1, name), kind: 'drop-shadow', added: true, method: 'menu', defaultsApplied: true, changed: ['useGlobalLight', 'color', 'opacity', 'angle', 'distance', 'size'], style: { kind: 'drop-shadow', label: 'Drop Shadow', present: true, on: true, path: 'Layer Styles/Drop Shadow', settings: { opacity: 14, angle: 90, distance: 4, size: 16 }, keyed: {} }, colorsEffect: null, notes: [] }
        : null,
      notes: [],
    };
  },

  fitTextToBox: (args) => {
    const layer = refOf(args.layer, 1, 'Caption');
    const mode = args.mode ?? 'once';
    if (mode === 'expression') {
      const terms = [];
      if (args.width !== undefined) terms.push(`${args.width} / Math.max(r.width, 0.001)`);
      if (args.height !== undefined) terms.push(`${args.height} / Math.max(r.height, 0.001)`);
      const shrinkOnly = args.shrinkOnly ?? true;
      const expression = `var r = sourceRectAtTime(time, false);\nvar k = 100 * ${terms.length > 1 ? `Math.min(${terms.join(', ')})` : terms[0]};\n${shrinkOnly ? 'k = Math.min(k, 100);\n' : ''}value.length > 2 ? [k, k, k] : [k, k]`;
      return { composition: comp(), layer, mode, method: 'scale-expression', fontSizeBefore: 72, fontSize: 72, width: args.width ?? null, height: args.height ?? null, shrinkOnly, expression, expressionError: '', scale: [80, 80], notes: [] };
    }
    const W = args.width ?? 900;
    const H = args.height ?? 240;
    return {
      composition: comp(),
      layer,
      mode,
      method: 'box-overflow',
      fontSizeBefore: 72,
      fontSize: args.shrinkOnly ? 64.3 : 88.4,
      leading: 'auto',
      boxText: true,
      boxSize: [W, H],
      width: W,
      height: H,
      bounds: { left: 2, top: -66, width: W - 14, height: H - 20 },
      overflow: false,
      fits: true,
      iterations: 15,
      shrinkOnly: args.shrinkOnly ?? false,
      textDocument: { text: 'Fit me', font: 'Inter-Bold', fontSize: 88.4, boxText: true, boxTextSize: [W, H] },
      notes: [],
    };
  },
};
