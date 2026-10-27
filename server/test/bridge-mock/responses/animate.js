/*
 * Mock result shapes for the animate commands. See core.js for helpers and shapes to mirror.
 */

const FPS = 30;
const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });
const refOf = (ref, index = 1, name = 'Layer 1') => layerRef(ref?.index ?? index, ref?.name ?? name);
const round = (n) => Math.round(n * 10000) / 10000;
const snap = (t) => Math.round(t * FPS) / FPS;
const frame = (t) => Math.round(t * FPS);

const keyframe = (index, time, value, ease = {}) => ({
  index,
  time: round(time),
  frame: frame(time),
  value,
  inInterpolation: ease.inInterpolation ?? 'bezier',
  outInterpolation: ease.outInterpolation ?? 'bezier',
  easeIn: [{ speed: 0, influence: ease.inInfluence ?? 100 }],
  easeOut: [{ speed: 0, influence: ease.outInfluence ?? 25 }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});

const startOf = (args, fallback = 0) => snap(args.startFrame !== undefined ? args.startFrame / FPS : (args.startTime ?? fallback));
const durOf = (args, fallback) => snap(args.durationFrames !== undefined ? args.durationFrames / FPS : (args.duration ?? fallback));
const range = (t0, t1) => ({ startTime: round(t0), endTime: round(t1), startFrame: frame(t0), endFrame: frame(t1) });
const twoKeys = (t0, v0, t1, v1) => [keyframe(1, t0, v0), keyframe(2, t1, v1)];
const exprState = (property, expression, error = '') => ({ property, hasExpression: true, enabled: true, error, expression });

const kindList = (kind) => (Array.isArray(kind) ? [...new Set(kind)] : [kind]);
const kindProps = (kind, args, mode, t0, t1) => {
  const rest = { fade: 100, scale: [100, 100, 100], pop: [100, 100, 100], blur: 0, rise: [960, 540], slide: [960, 540] }[kind];
  let offset;
  let property = 'Transform/Position';
  if (kind === 'fade') { offset = 0; property = 'Transform/Opacity'; }
  else if (kind === 'blur') { offset = args.blur ?? 24; property = 'Effects/Transition Blur/Blurriness'; }
  else if (kind === 'scale' || kind === 'pop') {
    const pct = kind === 'pop' ? (args.popScale ?? 0) : (args.scale ?? 90);
    offset = [pct, pct, 100];
    property = 'Transform/Scale';
  } else {
    const dir = kind === 'rise' ? [0, -1] : ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[args.direction ?? 'left']);
    const dist = args.distance ?? (kind === 'rise' ? 40 : 200);
    const sign = mode === 'in' ? -1 : 1;
    offset = [960 + dir[0] * dist * sign, 540 + dir[1] * dist * sign];
  }
  const from = mode === 'in' ? offset : rest;
  const to = mode === 'in' ? rest : offset;
  return { kind, property, from, to, keys: twoKeys(t0, from, t1, to) };
};

const layersOf = (spec) => {
  if (Array.isArray(spec)) return spec.map((r, i) => refOf(r, i + 1, `Layer ${i + 1}`));
  if (spec?.names) return spec.names.map((n, i) => layerRef(i + 1, n));
  if (spec?.indices) return spec.indices.map((n) => layerRef(n, `Layer ${n}`));
  return [layerRef(1, 'Layer 1'), layerRef(2, 'Layer 2'), layerRef(3, 'Layer 3')];
};

const motion = (args, mode) => {
  const layers = layersOf(args.layers);
  if (args.order === 'bottom-up') layers.reverse();
  const kinds = kindList(args.kind);
  const dur = durOf(args, 1 / 3);
  const stagger = args.staggerFrames ?? 2;
  const n = layers.length;
  const starts = layers.map((_, i) => {
    if (mode === 'in' || args.startTime !== undefined || args.startFrame !== undefined) return startOf(args, 0) + (i * stagger) / FPS;
    const end = args.endFrame !== undefined ? args.endFrame / FPS : (args.endTime ?? 10);
    return snap(end - dur - ((n - 1 - i) * stagger) / FPS);
  });
  return {
    composition: comp(),
    kinds,
    duration: round(dur),
    durationFrames: frame(dur),
    staggerFrames: stagger,
    order: args.order ?? 'top-down',
    easing: args.easing ?? (mode === 'in' ? 'landing (speed 0, influence 25 leaving, 100 arriving)' : 'exit (speed 0, influence 85 leaving, 15 arriving)'),
    count: n,
    failed: 0,
    results: layers.map((layer, i) => ({
      status: 'ok',
      order: i,
      layer,
      ...range(starts[i], starts[i] + dur),
      properties: kinds.map((k) => kindProps(k, args, mode, starts[i], starts[i] + dur)),
      notes: [],
    })),
  };
};

const countChars = (s) => s.replace(/[\r\n]/g, '').length;
const MOCK_TEXT = 'Ask anything';

export const responses = {
  animateProperty: (args) => {
    const t0 = startOf(args, 0);
    const t1 = t0 + durOf(args, 0.5);
    return {
      composition: comp(),
      layer: refOf(args.layer),
      ...range(t0, t1),
      easing: args.easing ?? 'landing (speed 0, influence 25 leaving, 100 arriving)',
      properties: args.properties.map((p) => {
        const from = p.from ?? [960, 540];
        const to = p.to ?? (Array.isArray(p.by) ? from.map((v, i) => v + (p.by[i] ?? 0)) : from);
        return { property: typeof p.property === 'string' ? p.property : p.property.join('/'), from, to, keys: twoKeys(t0, from, t1, to) };
      }),
    };
  },

  addEntrance: (args) => motion(args, 'in'),
  addExit: (args) => motion(args, 'out'),

  typewriterText: (args) => {
    const t0 = startOf(args, 0);
    const n = countChars(MOCK_TEXT);
    const dur = args.durationFrames !== undefined || args.duration !== undefined ? durOf(args, 1) : Math.max(1 / FPS, snap(n / (args.charactersPerSecond ?? 20)));
    const rate = n / dur;
    const linear = args.easing === undefined || args.easing === 'linear';
    const name = args.name ?? 'Typewriter';
    const cursor = args.cursor
      ? {
          layer: layerRef(1, `${args.layer?.name ?? 'Layer 2'} Cursor`),
          char: args.cursor.char ?? '|',
          blinkRate: args.cursor.blinkRate ?? 2,
          keepAfterTyping: args.cursor.keepAfterTyping ?? true,
          leadIn: args.cursor.leadIn ?? 0,
          alignShift: 0,
          expressions: [
            exprState('Text/Animators/Cursor Hide/Selectors/Cursor Slot/Amount', '// Typing cursor: hide every character except the slot after the last typed one'),
            exprState('Text/Animators/Cursor Glyph/Selectors/Cursor Slot/Amount', '// Typing cursor: draw the cursor glyph in the slot after the last typed character'),
            exprState('Transform/Opacity', '// Typing cursor: solid while typing, blinking while idle'),
          ],
        }
      : null;
    return {
      composition: comp(),
      layer: refOf(args.layer, 2),
      animator: name,
      animatorPath: `Text/Animators/${name}`,
      selectorPath: `Text/Animators/${name}/Selectors/Typing`,
      characters: n,
      charactersPerSecond: round(rate),
      ...range(t0, t0 + dur),
      firstCharacterTime: linear ? round(t0 + 0.5 / rate) : null,
      lastCharacterTime: linear ? round(t0 + (n - 0.5) / rate) : null,
      keyframes: [keyframe(1, t0, 0, { outInterpolation: 'linear' }), keyframe(2, t0 + dur, 100, { inInterpolation: 'linear' })],
      cursor,
      notes: [],
    };
  },

  wordByWordReveal: (args) => {
    const t0 = startOf(args, 0);
    const units = args.basedOn === 'lines' ? 3 : 14;
    let dur;
    if (args.durationFrames !== undefined || args.duration !== undefined) dur = durOf(args, 0.8);
    else if (args.secondsPerWord !== undefined) dur = snap(units * args.secondsPerWord);
    else dur = snap(Math.min(3, Math.max(0.7, units * 0.12)));
    const name = args.name ?? 'Word Reveal';
    const drive = args.drive ?? 'start';
    const offset = Array.isArray(args.offset) ? args.offset : [0, args.offset ?? 20];
    return {
      composition: comp(),
      layer: refOf(args.layer, 3),
      animator: name,
      animatorPath: `Text/Animators/${name}`,
      selectorPath: `Text/Animators/${name}/Selectors/Reveal`,
      keyedProperty: `Text/Animators/${name}/Selectors/Reveal/${drive === 'offset' ? 'Offset' : 'Start'}`,
      basedOn: args.basedOn ?? 'words',
      units,
      drive,
      fromState: { opacity: args.opacity ?? 0, blur: args.blur ?? 25, offset, scale: args.scale ?? null },
      ...range(t0, t0 + dur),
      keyframes: drive === 'offset' ? twoKeys(t0, -100, t0 + dur, 100) : twoKeys(t0, 0, t0 + dur, 100),
      notes: [],
    };
  },

  press: (args) => {
    const variant = args.variant ?? 'dip';
    const t0 = snap(args.frame !== undefined ? args.frame / FPS : (args.time ?? 0));
    const down = args.downFrames !== undefined ? args.downFrames / FPS : (args.downDuration ?? (variant === 'pop' ? 1 / FPS : 0.1));
    const up = args.upFrames !== undefined ? args.upFrames / FPS : (args.upDuration ?? (variant === 'pop' ? 0.25 : 0.15));
    const t1 = snap(t0 + down);
    const t2 = snap(t1 + up);
    const pct = args.scale ?? (variant === 'pop' ? 108 : 96);
    const scaleKeys = [keyframe(1, t0, [100, 100, 100]), keyframe(2, t1, [pct, pct, 100]), keyframe(3, t2, [100, 100, 100])];
    const cursorPct = args.cursor ? (args.cursor.scale ?? (variant === 'pop' ? 92 : Math.max(50, 100 - 2 * (100 - pct)))) : null;
    const rippleDur = args.ripple ? (args.ripple.durationFrames !== undefined ? args.ripple.durationFrames / FPS : (args.ripple.duration ?? 0.6)) : 0;
    return {
      composition: comp(),
      layer: refOf(args.layer, 4, 'Button'),
      variant,
      scale: pct,
      startTime: round(t0),
      clickTime: round(t1),
      endTime: round(t2),
      startFrame: frame(t0),
      clickFrame: frame(t1),
      endFrame: frame(t2),
      property: 'Transform/Scale',
      keys: scaleKeys,
      cursor: args.cursor
        ? { layer: refOf(args.cursor.layer, 1, 'Cursor'), scale: cursorPct, property: 'Transform/Scale', keys: [keyframe(1, t0, [100, 100, 100]), keyframe(2, t1, [cursorPct, cursorPct, 100]), keyframe(3, t2, [100, 100, 100])] }
        : null,
      flips: (args.flip ?? []).map((f) => ({
        property: typeof f.property === 'string' ? f.property : f.property.join('/'),
        from: [1, 1, 1, 1],
        to: f.to,
        keys: [keyframe(1, t1 - 1 / FPS, [1, 1, 1, 1], { outInterpolation: 'hold' }), keyframe(2, t1, f.to, { outInterpolation: 'hold' })],
      })),
      ripple: args.ripple
        ? {
            layer: { ...layerRef(4, args.ripple.name ?? 'Button Ripple'), type: 'shape', inPoint: round(t1), outPoint: round(t1 + rippleDur) },
            style: args.ripple.style ?? 'ring',
            radius: args.ripple.radius ?? 60,
            center: args.ripple.position ?? [960, 540],
            startTime: round(t1),
            endTime: round(t1 + rippleDur),
            keyframes: [
              { property: 'Transform/Scale', keys: [keyframe(1, t1, [0, 0, 100], { outInfluence: 12 }), keyframe(2, t1 + rippleDur, [100, 100, 100])] },
              { property: 'Transform/Opacity', keys: [keyframe(1, t1, args.ripple.opacity ?? 60, { outInterpolation: 'linear' }), keyframe(2, t1 + rippleDur, 0, { inInterpolation: 'linear' })] },
            ],
          }
        : null,
      notes: [],
    };
  },

  moveAlongPath: (args) => {
    const t0 = startOf(args, 0);
    const t1 = t0 + durOf(args, 1);
    const slider = args.sliderName ?? 'Progress';
    const usesMask = args.path.mask !== undefined;
    const pathName = args.path.layer?.name ?? 'Route';
    const ref = usesMask ? `L.mask("${typeof args.path.mask === 'string' ? args.path.mask : 'Mask 1'}").maskPath` : 'L.content("Group 1").content("Path 1").path';
    const header = `// Move along path\nvar L = thisComp.layer("${pathName}");\nvar P = ${ref};\n`;
    const expressions = [exprState('Transform/Position', `${header}var p = place(P.pointOnPath(u));\n[p[0], p[1]];`)];
    if (args.orient) expressions.push(exprState('Transform/Rotation', `${header}var q = P.pointOnPath(u), tn = P.tangentOnPath(u);`));
    return {
      composition: comp(),
      layer: refOf(args.layer, 5, 'Dot'),
      path: { layer: refOf(args.path.layer, 6, 'Route'), kind: usesMask ? 'mask' : 'shape', property: usesMask ? 'Masks/Mask 1/Mask Path' : 'Contents/Group 1/Contents/Path 1', closed: false, expressionRef: ref },
      slider: { effect: slider, propertyPath: `Effects/${slider}/Slider`, expression: `effect("${slider}")("Slider")`, from: args.from ?? 0, to: args.to ?? 100, keys: twoKeys(t0, args.from ?? 0, t1, args.to ?? 100) },
      orient: !!args.orient,
      ...range(t0, t1),
      expressions,
      notes: args.orient ? ['Rotation follows the path direction and keeps the layer\'s own Rotation as an offset: at 0 the layer should face along +X.'] : [],
    };
  },

  playAtMarkers: (args) => {
    const source = args.markerLayer ? 'layer' : (args.markerSource ?? 'layer');
    const added = (args.addMarkers ?? []).map((m) => {
      const t = snap(m.frame !== undefined ? m.frame / FPS : m.time);
      return { time: round(t), frame: frame(t), comment: m.comment ?? args.comment ?? '' };
    });
    const markerExpr = source === 'comp' ? 'thisComp.marker' : args.markerLayer ? `thisComp.layer("${args.markerLayer.name ?? 'Controls'}").marker` : 'thisLayer.marker';
    return {
      composition: comp(),
      layer: refOf(args.layer, 7, 'Badge'),
      markerSource: source,
      markerLayer: args.markerLayer ? refOf(args.markerLayer, 8, 'Controls') : null,
      comment: args.comment ?? null,
      markersAdded: added,
      markers: added,
      properties: args.properties.map((p) => ({
        property: typeof p === 'string' ? p : p.join('/'),
        keySpan: { from: 0, to: 0.3, seconds: 0.3 },
        replacedExpression: null,
        expressionState: exprState(typeof p === 'string' ? p : p.join('/'), `// Play at markers: replays this property's keys from each marker\nvar M = ${markerExpr};`),
      })),
      notes: added.length ? [] : ['No matching markers yet: each property holds its first key value until one is added.'],
    };
  },

  addCameraPush: (args) => {
    const t0 = startOf(args, 0);
    const t1 = t0 + durOf(args, 10 - t0);
    const pivot = args.pivot ?? [960, 540];
    const from = args.from ?? 100;
    const to = args.to ?? 105;
    const parented = args.layers ? layersOf(args.layers) : [layerRef(2, 'Title'), layerRef(3, 'Card'), layerRef(4, 'Background')];
    return {
      composition: comp(),
      layer: { ...layerRef(1, args.name ?? 'Camera Push'), type: 'null', isNull: true, transform: { position: pivot, anchorPoint: pivot, scale: [from, from, 100], rotation: 0, opacity: 100 } },
      pivot,
      from,
      to,
      ...range(t0, t1),
      scaleKeys: [keyframe(1, t0, [from, from, 100], { outInterpolation: 'linear' }), keyframe(2, t1, [to, to, 100], { inInterpolation: 'linear' })],
      driftKeys: args.drift ? twoKeys(t0, pivot, t1, [pivot[0] + args.drift[0], pivot[1] + args.drift[1]]) : null,
      parented,
      skipped: args.layers ? [] : [{ layer: layerRef(5, 'Camera 1'), reason: 'cameras and lights are not pushed (scaling a camera\'s parent moves the camera)' }],
    };
  },
};

