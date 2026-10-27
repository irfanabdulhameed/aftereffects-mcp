/*
 * Mock result shapes for the advanced-3d commands. See core.js for helpers and shapes to mirror.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });

const NAMES = { 'ADBE Advanced 3d': 'Classic 3D', 'ADBE Calder': 'Advanced 3D', 'ADBE Ernst': 'Cinema 4D' };
const KEYS = { 'ADBE Advanced 3d': 'classic-3d', 'ADBE Calder': 'advanced-3d', 'ADBE Ernst': 'cinema-4d' };
const info = (mn) => ({ matchName: mn, name: NAMES[mn] ?? mn, key: KEYS[mn] ?? null });
const AVAILABLE = ['ADBE Advanced 3d', 'ADBE Calder', 'ADBE Ernst'].map(info);

const fail = (message, code = 'unsupported') => Object.assign(new Error(message), { mcpCode: code });

/** Renderer of the mock comp, changed by setCompositionRenderer so the other tools can refuse or accept. */
const state = { renderer: 'ADBE Advanced 3d' };

const keyframe = (i, time, value) => ({
  index: i,
  time,
  frame: Math.round(time * 30),
  value,
  inInterpolation: 'bezier',
  outInterpolation: 'bezier',
  easeIn: [{ speed: 0, influence: 100 }],
  easeOut: [{ speed: 0, influence: 25 }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});

const GEO = [
  ['extrusionDepth', 'Geometry Options/Extrusion Depth'],
  ['bevelDepth', 'Geometry Options/Bevel Depth'],
  ['holeBevelDepth', 'Geometry Options/Hole Bevel Depth'],
];

export const responses = {
  setCompositionRenderer: (args) => {
    const previous = info(state.renderer);
    const want = args.rendererMatchName;
    if (!want) return { composition: comp(), previous, renderer: previous, changed: false, listOnly: true, available: AVAILABLE, warnings: [] };
    if (!NAMES[want]) throw fail(`Renderer '${want}' (${want}) is not available in After Effects 24.6.0 (mock). Available: Classic 3D (ADBE Advanced 3d), Advanced 3D (ADBE Calder), Cinema 4D (ADBE Ernst).`);
    const changed = state.renderer !== want;
    state.renderer = want;
    const warnings = want !== 'ADBE Advanced 3d' ? ["1 layers have layer styles, which do not render in " + NAMES[want] + ": 'Button'. Precompose them, or keep this comp in Classic 3D."] : [];
    return { composition: comp(), previous, renderer: info(want), changed, listOnly: false, available: AVAILABLE, warnings };
  },

  setExtrusion: (args) => {
    if (state.renderer !== 'ADBE Calder' && state.renderer !== 'ADBE Ernst') {
      throw fail(`Composition 'Main Comp' uses the ${NAMES[state.renderer]} renderer, which cannot extrude. Run set-composition-renderer with advanced-3d (or cinema-4d) first.`);
    }
    const applied = [];
    for (const [arg, path] of GEO) if (args[arg] !== undefined) applied.push({ arg, property: path, value: args[arg], keyIndex: null });
    if (args.bevelStyle !== undefined) applied.unshift({ arg: 'bevelStyle', property: 'Geometry Options/Bevel Style', value: args.bevelStyle });
    const keyframes = [];
    const keys = [...(args.keyframes ?? [])].sort((a, b) => (a.time ?? a.frame / 30) - (b.time ?? b.frame / 30));
    for (const [arg, path] of GEO) {
      const list = keys.filter((k) => k[arg] !== undefined).map((k, i) => keyframe(i + 1, k.time ?? k.frame / 30, k[arg]));
      if (list.length) keyframes.push({ arg, property: path, keys: list });
    }
    const last = (arg) => {
      const k = keys.filter((x) => x[arg] !== undefined);
      return args[arg] ?? (k.length ? k[0][arg] : 0);
    };
    return {
      composition: comp(),
      layer: layerRef(1, 'LOGO'),
      threeD: true,
      renderer: info(state.renderer),
      geometryOptions: { extrusionDepth: last('extrusionDepth'), bevelDepth: last('bevelDepth'), holeBevelDepth: args.holeBevelDepth ?? 100, bevelStyle: args.bevelStyle ?? 'none' },
      paths: { extrusionDepth: GEO[0][1], bevelDepth: GEO[1][1], holeBevelDepth: GEO[2][1], bevelStyle: 'Geometry Options/Bevel Style' },
      applied,
      keyframes,
      notes: [],
    };
  },

  addEnvironmentLight: (args) => {
    const notes = [];
    if (state.renderer !== 'ADBE Calder') {
      if (!args.switchRenderer) throw fail(`Composition 'Main Comp' uses the ${NAMES[state.renderer]} renderer; environment lights need Advanced 3D. Run set-composition-renderer with advanced-3d, or pass switchRenderer true.`);
      notes.push(`Renderer switched from ${NAMES[state.renderer]} to Advanced 3D.`);
      state.renderer = 'ADBE Calder';
    }
    const hasSource = args.source !== undefined || args.sourceItem !== undefined || args.sourceFile !== undefined;
    if (!hasSource) notes.push('No source given: the environment light has no image and lights the scene like an even sky.');
    const sourceName = args.sourceFile ? String(args.sourceFile).split('/').pop() : args.sourceItem?.name ?? args.source?.name ?? 'studio.hdr';
    const rot = Array.isArray(args.rotation) ? { x: args.rotation[0], y: args.rotation[1], z: args.rotation[2] } : { x: 0, y: args.rotation ?? 0, z: 0 };
    return {
      composition: comp(),
      renderer: info(state.renderer),
      light: layerRef(1, args.name ?? 'Environment Light'),
      lightType: 'environment',
      intensity: args.intensity ?? 100,
      rotation: rot,
      lightOptions: { intensity: args.intensity ?? 100, castsShadows: !!args.castsShadows, shadowDarkness: args.shadowDarkness ?? 100 },
      source: hasSource ? { layer: layerRef(5, sourceName), created: args.source === undefined, enabled: args.hideSource === false, type: 'footage', hdr: /\.(hdr|exr)$/i.test(sourceName) } : null,
      sourceApplied: hasSource,
      background: args.useAsBackground && hasSource ? { layer: layerRef(6, `${args.name ?? 'Environment Light'} Background`), route: 'menu' } : null,
      notes,
    };
  },
};

/** Lets tests put the mock comp back to Classic 3D. */
export function resetAdvanced3dMock() {
  state.renderer = 'ADBE Advanced 3d';
}
