/*
 * Mock result shapes for the rigs command group. See core.js for helpers and shapes to mirror.
 * Shapes mirror src/scripts/commands/rigs/*.jsx. The mock also mirrors the
 * bridge-side validation for Power Warp (distinct layers) and Depth Map Blur
 * Reveal (blurSource "layer" needs depthLayer).
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layer = (index, name, type = 'shape', over = {}) => ({
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
  isNull: type === 'null',
  isGuide: false,
  threeD: false,
  adjustment: type === 'adjustment',
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
const withEffects = (l, effects) => ({ ...l, effects, hasEffects: effects.length > 0 });

function fail(message, code) {
  const err = new Error(message);
  err.mcpCode = code;
  return err;
}

function refIndex(ref, fallback) {
  if (!ref) return fallback;
  if (ref.index !== undefined) return ref.index;
  if (ref.id !== undefined) return ref.id - 100;
  return fallback;
}

const RIGS = [
  { tool: 'rig-edge-glow', name: 'Edge Glow', panel: 'panels/edge-glow/Edge Glow.jsx' },
  { tool: 'rig-power-warp-transition', name: 'Power Warp Transition', panel: 'panels/power-warp-transition/Power Warp Transition.jsx' },
  { tool: 'rig-depth-map-blur-reveal', name: 'Depth Map Blur Reveal', panel: 'panels/depth-map-blur-reveal/Depth Map Blur Reveal.jsx' },
  { tool: 'rig-blur-color-reveal', name: 'Blur Color Reveal', panel: 'panels/blur-color-reveal/Blur Color Reveal.jsx' },
].map((r) => ({
  ...r,
  summary: `Mock summary for ${r.name}.`,
  builds: ['mock layer'],
  layerOrder: ['mock layer'],
  requires: ['An open composition.'],
  optional: [],
  parameters: [{ name: 'openInViewer', default: true, description: 'Open the composition in the viewer after building.' }],
  fixedValues: {},
  returns: 'layer summaries and notes.',
}));

export const responses = {
  rigEdgeGlow: (args) => {
    const width = args.width ?? 718;
    const height = args.height ?? 142;
    const notes = ['Glow layer: 3 Drop Shadows applied.', `CC Light Sweep applied${args.animate === false ? '.' : ' (animated).'}`, '4-Color Gradient applied.', 'Deep Glow not installed -> used built-in Glow instead.'];
    const bg = args.addBackground ? layer(4, 'EG Background', 'solid') : null;
    return {
      composition: comp(),
      stroke: withEffects(layer(1, 'EG Stroke'), ['CC Light Sweep', '4-Color Gradient', 'Glow']),
      fill: layer(2, 'EG Fill'),
      glow: withEffects(layer(3, 'EG Glow'), ['Drop Shadow', 'Drop Shadow 2', 'Drop Shadow 3']),
      background: bg,
      glowUsed: 'built-in Glow',
      glowMatchName: 'ADBE Glo2',
      rect: { width, height, roundness: args.roundness ?? 28, strokeWidth: args.strokeWidth ?? 3, center: [960, 540] },
      notes,
    };
  },

  rigPowerWarpTransition: (args) => {
    if (!args.outgoing) throw fail("Missing required argument 'outgoing'.", 'invalid-argument');
    if (!args.depth) throw fail("Missing required argument 'depth'.", 'invalid-argument');
    const a = refIndex(args.outgoing, 1);
    const d = refIndex(args.depth, 2);
    const b = args.incoming ? refIndex(args.incoming, 3) : null;
    if (a === d) throw fail('Outgoing and depth map must be different layers.', 'invalid-argument');
    if (b !== null && (b === a || b === d)) throw fail('Incoming must differ from outgoing and depth.', 'invalid-argument');
    const mods = { scanLine: true, warp: true, aberration: true, shake: true, fine: true, ...(args.modules ?? {}) };
    const start = Math.round((args.start ?? 0.5) * 30) / 30;
    const end = Math.round(((args.start ?? 0.5) + (args.duration ?? 1.5)) * 30) / 30;
    const mid = start + (end - start) / 2;
    const adj = (i, name) => layer(i, name, 'adjustment', { inPoint: start, outPoint: end, adjustment: true });
    const map = (i, name) => layer(i, name, 'footage', { enabled: false });
    const created = {
      fineDistortions: mods.fine ? withEffects(adj(1, 'Fine Distortions'), ['CC Glass']) : null,
      shake: mods.shake ? withEffects(adj(2, 'Shake'), ['Slider Control', 'Displacement Map']) : null,
      aberrations: mods.aberration ? withEffects(adj(3, 'Aberrations'), ['CC Glass', 'Set Channels', 'CC Glass 2', 'Set Channels 2']) : null,
      warp: mods.warp ? withEffects(adj(4, 'Warp'), ['CC Glass', 'CC Vector Blur']) : null,
      scanLine: mods.scanLine ? withEffects(layer(5, 'Scan Line', 'footage', { blendMode: 'add', inPoint: start, outPoint: end }), ['Extract', 'Fill', 'Solid Composite', 'Tint', 'Glow']) : null,
      warpMap: mods.warp || mods.aberration ? withEffects(map(8, 'Warp Map'), ['Extract', 'Solid Composite', 'Fast Box Blur', 'Compound Blur']) : null,
      shakeMap: mods.shake ? withEffects(map(9, 'Shake Map'), ['Extract', 'Solid Composite', 'Fast Box Blur']) : null,
      fineDistortionsMap: mods.fine ? withEffects(map(10, 'Fine Distortions Map'), ['Extract', 'Solid Composite', 'Turbulent Noise', 'Fast Box Blur', 'Turbulent Noise 2']) : null,
    };
    const stack = Object.values(created).filter(Boolean).map((l) => l.name);
    stack.splice(stack.indexOf('Warp Map') === -1 ? stack.length : stack.indexOf('Warp Map'), 0, 'Outgoing', 'Depth');
    if (b !== null) stack.push('Incoming');
    return {
      composition: comp(),
      window: { start, end, mid, startFrame: Math.round(start * 30), endFrame: Math.round(end * 30), duration: end - start },
      intensity: args.intensity ?? 1,
      modules: mods,
      outgoing: withEffects(layer(6, 'Outgoing', 'footage'), ['Gradient Wipe']),
      depth: layer(7, 'Depth', 'footage', { enabled: false }),
      incoming: b !== null ? layer(11, 'Incoming', 'footage') : null,
      created,
      stack,
      notes: ["Gradient Wipe applied to 'Outgoing'.", ...(mods.scanLine ? ['Scan Line built.'] : []), ...(mods.warp ? ['Warp built.'] : []), ...(mods.aberration ? ['Chromatic Aberration built.'] : []), ...(mods.shake ? ['Shake built.'] : []), ...(mods.fine ? ['Fine Distortions built.'] : [])],
    };
  },

  rigDepthMapBlurReveal: (args) => {
    if (!args.layer) throw fail("Missing required argument 'layer'.", 'invalid-argument');
    const mode = args.blurSource ?? (args.depthLayer ? 'layer' : 'auto');
    if (mode === 'layer' && !args.depthLayer) throw fail("blurSource 'layer' needs depthLayer.", 'invalid-argument');
    const start = args.startAtPlayhead ? 0 : (args.start ?? 0);
    const dur = args.duration ?? 0.8;
    const effects = ['Compound Blur'];
    if (args.useExposure !== false) effects.push('Exposure');
    if (args.useGlow !== false) effects.push('Glow');
    const depthLayer = mode === 'auto' ? layer(1, 'DBR Depth (auto)', 'solid', { enabled: false, isGuide: true, effects: ['Gradient Ramp'], hasEffects: true }) : layer(refIndex(args.depthLayer, 3), 'Depth', 'footage');
    return {
      composition: comp(),
      layer: withEffects(layer(refIndex(args.layer, 2), 'Image', 'footage'), effects),
      depthSource: { mode, layer: depthLayer },
      blurEffect: 'Compound Blur',
      window: { start, end: start + dur, startFrame: Math.round(start * 30), endFrame: Math.round((start + dur) * 30), duration: dur },
      settings: { maxBlur: args.maxBlur ?? 120, invert: !!args.invert, autoDir: args.autoDir ?? 'bottom', useExposure: args.useExposure !== false, expStart: args.expStart ?? -2, useGlow: args.useGlow !== false, glowStart: args.glowStart ?? 2.5, glowEnd: args.glowEnd ?? 0, glowRadius: args.glowRadius ?? 90, glowThreshold: args.glowThreshold ?? 50, useScale: !!args.useScale, scaleStart: args.scaleStart ?? 104, ease: args.ease ?? 33 },
      notes: [mode === 'auto' ? "Depth source: auto gradient ('bottom' edge stays soft longest)." : "Depth source: selected layer 'Depth'.", 'Compound Blur: Maximum Blur 120 -> 0.', "Built on 'Image':  0.00s -> 0.80s."],
    };
  },

  rigBlurColorReveal: (args) => {
    const start = args.start ?? 0;
    const dur = args.duration ?? 1.3;
    const precompose = args.precompose !== false;
    const nul = args.addControlNull ? layer(1, 'BR Control', 'null') : null;
    const matte = withEffects(layer(nul ? 2 : 1, 'BR Reveal Matte'), ['Fast Box Blur']);
    const color = withEffects(layer(nul ? 3 : 2, 'BR Reveal Color', 'shape', { trackMatte: 'alpha', trackMatteLayer: { index: matte.index, name: matte.name } }), ['Fast Box Blur']);
    const content = layer(nul ? 4 : 3, precompose ? 'BR Content' : 'Content', precompose ? 'precomp' : 'footage');
    return {
      composition: comp(),
      content,
      precomposed: precompose ? { id: 42, name: 'BR Content' } : null,
      colorLayer: color,
      matteLayer: matte,
      controlNull: nul,
      origin: args.origin ?? [960, 540],
      window: { start, end: start + dur, startFrame: Math.round(start * 30), endFrame: Math.round((start + dur) * 30), duration: dur },
      settings: { ringWidth: args.ringWidth ?? 200, blur: args.blur ?? 80, sizeMultiplier: args.sizeMultiplier ?? 1.5, endScale: args.endScale ?? 120, ease: args.ease ?? 33, ellipseSize: [2880, 1620] },
      notes: [precompose ? "Precomposed 1 layer(s) into 'BR Content'." : "Content layer: 'Content'.", 'Reveal built: ellipse bloom 0% -> 120% , blur 80 , 0.00s -> 1.30s.', ...(nul ? ['Control null added (both ellipses parented).'] : [])],
    };
  },

  listRigs: (args) => {
    let rigs = RIGS;
    if (args.rig) {
      rigs = RIGS.filter((r) => r.tool === args.rig || r.name === args.rig || r.tool === 'rig-' + args.rig);
      if (!rigs.length) throw fail(`No rig named '${args.rig}'.`, 'not-found');
    }
    return { count: rigs.length, notes: ['Every rig builds inside one undo step.'], rigs };
  },
};
