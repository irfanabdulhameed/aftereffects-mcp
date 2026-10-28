/*
 * Mock result shapes for the transitions commands. See core.js for helpers and shapes to mirror.
 *
 * The mock master runs at 30 fps; the incoming layer starts at frame 90.
 */

const FPS = 30;
const round = (n) => Math.round(n * 10000) / 10000;
const fail = (message, code) => {
  throw Object.assign(new Error(message), { mcpCode: code });
};

/** Default [frames out, frames in] at 30 fps. */
const DEFAULTS = { 'match-cut': [10, 10], 'zoom-through': [10, 10], push: [9, 9], 'shape-reveal': [0, 15], 'blur-swap': [8, 10], whip: [6, 8], carry: [10, 10] };
const OUT = { outInfluence: 85, inInfluence: 14 };
const IN = { outInfluence: 16.7, inInfluence: 90 };

const sameRef = (a, b) => !!a && !!b && ((a.index !== undefined && a.index === b.index) || (a.id !== undefined && a.id === b.id) || (a.name !== undefined && a.name === b.name));
const refOf = (ref, index, name) => ({ index: ref?.index ?? index, id: ref?.id ?? 200 + index, name: ref?.name ?? name });

const key = (index, frame, value, ease, speeds = null) => ({
  index,
  time: round(frame / FPS),
  frame,
  value,
  inInterpolation: 'bezier',
  outInterpolation: 'bezier',
  easeIn: [{ speed: speeds ? speeds[0] : 0, influence: ease.inInfluence }],
  easeOut: [{ speed: speeds ? speeds[1] : 0, influence: ease.outInfluence }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});

const move = (layer, property, f0, v0, f1, v1, ease) => ({
  layer,
  property,
  keys: [key(1, f0, v0, { inInfluence: 33.33, outInfluence: ease.outInfluence }), key(2, f1, v1, { inInfluence: ease.inInfluence, outInfluence: 33.33 })],
});

const layerSummary = (ref, inFrame, outFrame) => ({
  ...ref,
  type: 'precomp',
  enabled: true,
  locked: false,
  inPoint: round(inFrame / FPS),
  outPoint: round(outFrame / FPS),
  startTime: round(inFrame / FPS),
  inFrame,
  outFrame,
  durationFrames: outFrame - inFrame,
  motionBlur: true,
  trackMatte: 'none',
  transform: { position: [960, 540], anchorPoint: [960, 540], scale: [100, 100, 100], rotation: 0, opacity: 100 },
});

function carryResult(name, f0, fc, f2, aligned) {
  return {
    layer: { index: 1, id: 300, name: `${name} Carry` },
    created: true,
    alignedAtCut: aligned,
    cutProgress: aligned ? null : 0.5,
    poses: {
      start: { position: [1500, 900], center: [1500, 900], scale: [100, 100], rotation: 0, size: 80 },
      cut: { center: aligned ? [1500, 900] : [1230, 720], size: aligned ? 200 : 140, rotation: 0 },
      end: { center: [960, 540], size: 200, rotation: 0 },
    },
    hidden: [
      { comp: 61, layer: name, edge: 'out', changed: true },
      { comp: 62, layer: name, edge: 'in', changed: true },
    ],
    frames: [f0, fc, f2],
  };
}

export const responses = {
  addTransition: (args) => {
    if (sameRef(args.outgoing, args.incoming)) fail('outgoing and incoming must be two different layers.', 'invalid-argument');
    const kind = args.kind ?? 'match-cut';
    const [dOut, dIn] = DEFAULTS[kind];
    let fo = kind === 'shape-reveal' ? 0 : (args.framesOut ?? dOut);
    let fi = args.framesIn ?? dIn;
    let T = args.frame ?? (args.time !== undefined ? Math.round(args.time * FPS) : 90);
    if (kind === 'push' && args.frame === undefined && args.time === undefined) T = 90 + fo;
    const t0 = T - fo;
    const t2 = T + fi;
    const A = refOf(args.outgoing, 2, '01 Intro');
    const B = refOf(args.incoming, 1, '02 Feature');
    const i = args.intensity ?? 1;
    const id = 'tmock1';
    const keys = [];
    const effects = [];
    const helpers = [];
    let details = {};
    const origin = Array.isArray(args.origin) ? args.origin : [960, 540];
    const pivoted = Array.isArray(args.origin) && (args.origin[0] !== 960 || args.origin[1] !== 540);
    if (kind === 'match-cut' && args.move !== 'position') {
      const s = round(100 + 150 * i);
      keys.push(move(A, 'Transform/Scale', t0, [100, 100, 100], T, [s, s, 100], OUT));
      keys.push(move(B, 'Transform/Scale', T, [s, s, 100], t2, [100, 100, 100], IN));
      if (pivoted || args.carry) {
        keys.push(move(A, 'Transform/Position', t0, [960, 540], T, [round(origin[0] + (960 - origin[0]) * s / 100), round(origin[1] + (540 - origin[1]) * s / 100)], OUT));
        keys.push(move(B, 'Transform/Position', T, [round(origin[0] + (960 - origin[0]) * s / 100), round(origin[1] + (540 - origin[1]) * s / 100)], t2, [960, 540], IN));
      }
      details = { move: 'scale', outgoingScale: s, incomingScale: s, pivots: { outgoing: origin, incoming: origin } };
    } else if (kind === 'match-cut') {
      keys.push(move(A, 'Transform/Position', t0, [960, 540], T, [960 - 480 * i, 540], OUT));
      keys.push(move(B, 'Transform/Position', T, [960 + 600 * i, 540], t2, [960, 540], IN));
      effects.push(`Transition ${id} Edges`, `Transition ${id} Edges`);
      details = { move: 'position', travel: { outgoing: 480 * i, incoming: 600 * i } };
    } else if (kind === 'zoom-through') {
      const s = round(100 + 300 * i);
      keys.push(move(A, 'Transform/Scale', t0, [100, 100, 100], T, [s, s, 100], OUT));
      keys.push(move(B, 'Transform/Scale', T, [100 + 20 * i, 100 + 20 * i, 100], t2, [100, 100, 100], IN));
      keys.push(move(A, `Effects/Transition ${id} Blur/Blurriness`, t0, 0, T, 40 * i, OUT));
      keys.push(move(B, `Effects/Transition ${id} Blur/Blurriness`, T, 40 * i, t2, 0, IN));
      effects.push(`Transition ${id} Blur`, `Transition ${id} Blur`);
      details = { outgoingScale: s, incomingScale: 100 + 20 * i, blurPeak: 40 * i };
    } else if (kind === 'push') {
      const e = { a: { inInfluence: 25, outInfluence: 60 }, b: { inInfluence: 85, outInfluence: 25 } };
      const v = round((2 * 1920 * FPS) / (fo + fi));
      keys.push({ layer: A, property: 'Transform/Position', keys: [key(1, t0, [960, 540], { inInfluence: 33.33, outInfluence: 60 }), key(2, T, [0, 540], { inInfluence: 25, outInfluence: 25 }, [v, v]), key(3, t2, [-960, 540], { inInfluence: 85, outInfluence: 33.33 })] });
      keys.push({ layer: B, property: 'Transform/Position', keys: [key(1, t0, [2880, 540], { inInfluence: 33.33, outInfluence: 60 }), key(2, T, [1920, 540], { inInfluence: e.a.inInfluence, outInfluence: e.b.outInfluence }, [v, v]), key(3, t2, [960, 540], { inInfluence: 85, outInfluence: 33.33 })] });
      details = { travel: 1920, direction: args.direction ?? 'left' };
    } else if (kind === 'shape-reveal') {
      const M = { index: 1, id: 310, name: `Transition ${id} Matte` };
      keys.push(move(M, 'Contents/Reveal/Ellipse Path 1/Size', T, [0, 0], t2, [2246.5, 2246.5], IN));
      helpers.push({ layer: M, role: 'matte' });
      details = { shape: args.shape ?? 'circle', origin, startSize: [0, 0], endSize: [2246.5, 2246.5], roundness: args.shape === 'rounded-rectangle' ? (args.roundness ?? 32) : null };
    } else if (kind === 'blur-swap') {
      keys.push(move(A, 'Transform/Scale', t0, [100, 100, 100], T, [104, 104, 100], OUT));
      keys.push(move(B, 'Transform/Scale', T, [108, 108, 100], t2, [100, 100, 100], IN));
      keys.push(move(A, `Effects/Transition ${id} Blur/Blurriness`, t0, 0, T, 40 * i, OUT));
      keys.push(move(B, `Effects/Transition ${id} Blur/Blurriness`, T, 40 * i, t2, 0, IN));
      effects.push(`Transition ${id} Blur`, `Transition ${id} Blur`);
      details = { blurPeak: 40 * i, outgoingScale: 104, incomingScale: 108 };
    } else if (kind === 'whip') {
      keys.push(move(A, 'Transform/Position', t0, [960, 540], T, [960 - 1440 * i, 540], OUT));
      keys.push(move(B, 'Transform/Position', T, [960 + 1700 * i, 540], t2, [960, 540], IN));
      effects.push(`Transition ${id} Edges`, `Transition ${id} Edges`);
      details = { travel: { outgoing: 1440 * i, incoming: 1700 * i }, direction: args.direction ?? 'left' };
    }
    let carry = null;
    if (args.carry && args.carry.layer !== false) {
      carry = carryResult(args.carry.outgoing.name ?? 'Element', kind === 'shape-reveal' ? T - Math.round(fi / 2) : t0, T, t2, kind === 'match-cut');
      helpers.push({ layer: carry.layer, role: 'carry' });
    }
    const notes = [];
    if (kind === 'whip') notes.push('A whip streaks best with more motion blur samples: set-composition-settings motionBlurSamplesPerFrame 32.');
    const aOut = kind === 'push' || kind === 'shape-reveal' ? t2 : T;
    const bIn = kind === 'push' ? t0 : T;
    return {
      composition: { id: 1, name: 'Main Comp' },
      transition: {
        id, kind, cutTime: round(T / FPS), cutFrame: T,
        startTime: round(Math.min(t0, T) / FPS), endTime: round(t2 / FPS), startFrame: Math.min(t0, T), endFrame: t2,
        framesOut: fo, framesIn: fi, intensity: i, origin, details,
      },
      outgoing: layerSummary(A, 0, aOut),
      incoming: { ...layerSummary(B, bIn, 225), trackMatte: kind === 'shape-reveal' ? 'alpha' : 'none' },
      keys,
      effects,
      helpers,
      carry,
      motionBlur: { composition: true, layers: [A.name, B.name] },
      notes,
    };
  },

  carryElement: (args) => {
    const T = args.frame ?? (args.time !== undefined ? Math.round(args.time * FPS) : 90);
    const fo = args.framesOut ?? 10;
    const fi = args.framesIn ?? 10;
    const name = args.layer ? (args.layer.name ?? 'Carry') : (args.outgoing.layer.name ?? 'Element');
    const c = carryResult(name, T - fo, T, T + fi, false);
    if (args.layer) {
      c.layer = { index: args.layer.index ?? 3, id: args.layer.id ?? 330, name };
      c.created = false;
    }
    if (args.cutProgress !== undefined) c.cutProgress = args.cutProgress;
    if (args.incoming.pose) {
      c.poses.end = { center: args.incoming.pose.position, size: 80 * ((args.incoming.pose.scale ?? 100) / 100), rotation: args.incoming.pose.rotation ?? 0 };
      c.hidden = c.hidden.slice(0, 1);
    }
    const ease = { a1: 85, b1: 14, a2: 16.7, b2: 90 };
    return {
      composition: { id: 1, name: 'Main Comp' },
      id: 'tmock3',
      cutTime: round(T / FPS),
      cutFrame: T,
      startFrame: T - fo,
      endFrame: T + fi,
      framesOut: fo,
      framesIn: fi,
      carry: c,
      keys: [
        {
          layer: c.layer,
          property: 'Transform/Position',
          keys: [
            key(1, T - fo, [1500, 900], { inInfluence: 33.33, outInfluence: ease.a1 }),
            key(2, T, c.poses.cut.center, { inInfluence: ease.b1, outInfluence: ease.a2 }, [1500, 1500]),
            key(3, T + fi, c.poses.end.center, { inInfluence: ease.b2, outInfluence: 33.33 }),
          ],
        },
      ],
      notes: [],
    };
  },

  listTransitions: () => ({
    composition: { id: 50, name: 'Launch Film' },
    count: 2,
    transitions: [
      {
        id: 'tmock1', kind: 'match-cut', cutTime: 3, cutFrame: 90, startFrame: 80, endFrame: 100, framesOut: 10, framesIn: 10,
        outgoing: { id: 202, name: '01 Intro', index: 3, exists: true }, incoming: { id: 201, name: '02 Feature', index: 2, exists: true },
        helpers: [{ id: 300, name: 'Send Carry', role: 'carry', exists: true }], effects: [], keyCount: 7, innerTrims: 2,
        anchor: { index: 2, id: 201, name: '02 Feature' }, missingLayers: [],
        args: { kind: 'match-cut', framesOut: 10, framesIn: 10, carry: { outgoing: { id: 501 }, incoming: { id: 502 } } },
      },
      {
        id: 'tmock2', kind: 'shape-reveal', cutTime: 7, cutFrame: 210, startFrame: 210, endFrame: 225, framesOut: 0, framesIn: 15,
        outgoing: { id: 201, name: '02 Feature', index: 2, exists: true }, incoming: { id: 200, name: '03 Outro', index: 1, exists: true },
        helpers: [{ id: 310, name: 'Transition tmock2 Matte', role: 'matte', exists: true }], effects: [], keyCount: 0, innerTrims: 0,
        anchor: { index: 1, id: 200, name: '03 Outro' }, missingLayers: [],
        args: { kind: 'shape-reveal', framesIn: 15 },
      },
    ],
    orphanHelpers: [],
  }),

  removeTransition: (args) => {
    const one = (id, kind, cutFrame, extra = {}) => ({ id, kind, cutFrame, keysRemoved: 4, effectsRemoved: 0, layersDeleted: [], trimsRestored: 2, ...extra });
    if (args.all) {
      return {
        composition: { id: 50, name: 'Launch Film' }, removedCount: 2,
        removed: [one('tmock2', 'shape-reveal', 210, { keysRemoved: 0, layersDeleted: ['Transition tmock2 Matte'] }), one('tmock1', 'match-cut', 90, { layersDeleted: ['Send Carry'], trimsRestored: 4 })],
        remaining: 0, compositionMotionBlur: false, notes: [],
      };
    }
    if (args.id !== 'tmock1' && args.id !== 'tmock2') fail(`No transition with id '${args.id}' in 'Launch Film'. Transitions: tmock1 (match-cut), tmock2 (shape-reveal).`, 'not-found');
    return {
      composition: { id: 50, name: 'Launch Film' }, removedCount: 1,
      removed: [args.id === 'tmock1' ? one('tmock1', 'match-cut', 90, { layersDeleted: ['Send Carry'], trimsRestored: 4 }) : one('tmock2', 'shape-reveal', 210, { keysRemoved: 0, layersDeleted: ['Transition tmock2 Matte'] })],
      remaining: 1, compositionMotionBlur: true, notes: [],
    };
  },
};
