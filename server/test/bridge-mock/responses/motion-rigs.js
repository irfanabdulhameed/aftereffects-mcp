/*
 * Mock result shapes for the motion-rigs commands. See core.js for helpers and shapes to mirror.
 * Every rig returns the control layer, its controls and the expressions it set, as the real
 * commands in commands/motion-rigs.jsx do (MCP.mrig.finish).
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });
const FPS = 30;
const frame = (t) => Math.round(t * FPS);
const key = (i, time, value, ease) => ({
  index: i,
  time,
  frame: frame(time),
  value,
  inInterpolation: 'bezier',
  outInterpolation: 'bezier',
  easeIn: [{ speed: 0, influence: i === 1 ? 16.67 : ease.inInfluence }],
  easeOut: [{ speed: 0, influence: i === 1 ? ease.outInfluence : 16.67 }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});
const LAND = { outInfluence: 25, inInfluence: 100 };
const twoKeys = (t0, v0, t1, v1) => [key(1, t0, v0, LAND), key(2, t1, v1, LAND)];
const span = (args, defStart, defDur) => {
  const t0 = args.startFrame !== undefined ? args.startFrame / FPS : args.startTime ?? defStart;
  const d = args.durationFrames !== undefined ? args.durationFrames / FPS : args.duration ?? defDur;
  return [t0, t0 + d];
};
const listOf = (spec, fallback = ['Layer 1', 'Layer 2', 'Layer 3']) => {
  if (Array.isArray(spec)) return spec.map((r, i) => r.name ?? `Layer ${r.index ?? i + 1}`);
  if (spec && Array.isArray(spec.names)) return spec.names;
  if (spec && Array.isArray(spec.indices)) return spec.indices.map((i) => `Layer ${i}`);
  return fallback;
};
const host = (name, index = 1) => ({ index, id: 100 + index, name });
const control = (hostName, name, type, value, keys = []) => ({
  name,
  type,
  created: true,
  propertyPath: `Effects/${name}/${{ slider: 'Slider', checkbox: 'Checkbox', point: 'Point', angle: 'Angle' }[type]}`,
  expression: `thisComp.layer(${JSON.stringify(hostName)}).effect(${JSON.stringify(name)})(1)`,
  value,
  keys,
});
const exprState = (property) => ({ property, enabled: true, error: '' });
const finish = (hostName, created, controls, extra, code) => {
  const out = { composition: comp(), controlLayer: host(hostName), controlLayerCreated: created, controls, ...extra };
  let count = 0;
  if (Array.isArray(out.layers)) {
    out.count = out.layers.length;
    out.failed = out.layers.filter((l) => l.status !== 'ok').length;
    for (const l of out.layers) count += l.expressions.length;
  } else if (Array.isArray(out.expressions)) {
    count = out.expressions.length;
  }
  out.expressionCount = count;
  out.expressionErrors = 0;
  out.expressionCode = code;
  out.expressionCodeLayer = Object.keys(code).length ? 'Layer' : null;
  out.notes = [];
  return out;
};

/** The counter formatting, the same steps as MCP.mrig.formatNumber. */
const format = (x, args) => {
  const decimals = args.decimals ?? 0;
  const minDigits = args.minDigits ?? 0;
  const sep = args.thousandsSeparator ?? ',';
  const f = 10 ** decimals;
  const r = Math.round(Math.abs(x) * f) / f;
  let [ip, fp = ''] = r.toFixed(decimals).split('.');
  while (ip.length < minDigits) ip = '0' + ip;
  if (sep !== '') ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const sign = x < 0 && r > 0 ? '-' : args.showPlus && r > 0 ? '+' : '';
  return sign + (args.prefix ?? '') + ip + (decimals > 0 ? (args.decimalSeparator ?? '.') + fp : '') + (args.suffix ?? '');
};

export const responses = {
  numberCounter: (args) => {
    const from = args.from ?? 0;
    const to = args.to;
    const [t0, t1] = span(args, 0, 2);
    const big = Math.max(Math.abs(from), Math.abs(to));
    let mult = 1;
    while (big / mult > 1000000) mult *= 10;
    const name = args.layer?.name ?? args.name ?? 'Counter';
    const onNull = args.controls === 'null' || args.controlLayer !== undefined;
    const hostName = args.controlLayer?.name ?? (onNull ? `${name} Controls` : name);
    const controls = [
      control(hostName, 'Value', 'slider', to / mult, from === to ? [] : twoKeys(t0, from / mult, t1, to / mult)),
      control(hostName, 'Decimals', 'slider', args.decimals ?? 0),
      control(hostName, 'Min Digits', 'slider', args.minDigits ?? 0),
      control(hostName, 'Separator', 'checkbox', (args.thousandsSeparator ?? ',') === '' ? 0 : 1),
    ];
    return finish(hostName, onNull && !args.controlLayer, controls, {
      layer: layerRef(1, name),
      layerCreated: args.layer === undefined,
      from,
      to,
      multiplier: mult,
      startTime: t0,
      endTime: t1,
      startFrame: frame(t0),
      endFrame: frame(t1),
      format: {
        decimals: args.decimals ?? 0,
        minDigits: args.minDigits ?? 0,
        thousandsSeparator: args.thousandsSeparator ?? ',',
        decimalSeparator: args.decimalSeparator ?? '.',
        prefix: args.prefix ?? '',
        suffix: args.suffix ?? '',
        showPlus: !!args.showPlus,
        tabular: !!args.tabular,
      },
      fromText: format(from, args),
      toText: format(to, args),
      status: 'ok',
      expressions: [exprState('Text/Source Text')],
    }, { 'Text/Source Text': '// Number counter: the Value slider drives this text.\nvar C = thisLayer;\n...\nout;' });
  },

  gridLayout: (args) => {
    const bento = Array.isArray(args.bento) && args.bento.length ? args.bento : null;
    const names = bento && bento[0].layer ? bento.map((b, i) => b.layer.name ?? `Layer ${i + 1}`) : listOf(args.layers);
    const n = names.length;
    const cols = bento ? Math.max(...bento.map((b) => b.col + (b.colSpan ?? 1) - 1), args.columns ?? 0) : args.columns ?? Math.ceil(Math.sqrt(n));
    const rows = bento ? Math.max(...bento.map((b) => b.row + (b.rowSpan ?? 1) - 1)) : Math.ceil(n / cols);
    const gap = Array.isArray(args.gap) ? args.gap : args.gap !== undefined ? [args.gap, args.gap] : [24, 24];
    const cellSize = args.cellSize ?? [300, 200];
    const fit = args.fit ?? (bento ? 'contain' : 'none');
    const hostName = args.controlLayer?.name ?? args.controlName ?? 'Grid Controls';
    const colFirst = args.fill === 'columns';
    const controls = [
      control(hostName, 'Columns', 'slider', cols),
      ...(bento ? [control(hostName, 'Rows', 'slider', rows)] : []),
      control(hostName, 'Cell Width', 'slider', cellSize[0]),
      control(hostName, 'Cell Height', 'slider', cellSize[1]),
      control(hostName, 'Gap X', 'slider', gap[0]),
      control(hostName, 'Gap Y', 'slider', gap[1]),
      control(hostName, 'Origin', 'point', [50, 50]),
      control(hostName, 'Center On Origin', 'checkbox', args.align === 'top-left' ? 0 : 1),
      ...(bento ? [] : [control(hostName, 'Column First', 'checkbox', colFirst ? 1 : 0), control(hostName, 'Reverse Order', 'checkbox', args.reverse ? 1 : 0)]),
      ...(fit !== 'none' ? [control(hostName, 'Fit Cells', 'checkbox', 1)] : []),
    ];
    const layers = names.map((name, i) => {
      const j = args.reverse ? n - 1 - i : i;
      const cell = bento
        ? { col: bento[i].col, row: bento[i].row, colSpan: bento[i].colSpan ?? 1, rowSpan: bento[i].rowSpan ?? 1 }
        : colFirst
          ? { col: Math.floor(j / rows) + 1, row: (j % rows) + 1, colSpan: 1, rowSpan: 1 }
          : { col: (j % cols) + 1, row: Math.floor(j / cols) + 1, colSpan: 1, rowSpan: 1 };
      const exprs = [exprState('Transform/Position')];
      if (fit !== 'none') exprs.unshift(exprState('Transform/Scale'));
      return { status: 'ok', layer: layerRef(i + 2, name), expressions: exprs, slot: i + 1, ...cell, fill: fit === 'none' ? 'none' : `scale (${fit})` };
    });
    let animation = null;
    if (args.animate) {
      const [a0, a1] = span(args.animate, 0, 0.6);
      const map = { columns: ['Columns'], rows: ['Rows'], 'cell-size': ['Cell Width', 'Cell Height'], gap: ['Gap X', 'Gap Y'], origin: ['Origin'] };
      const keys = {};
      map[args.animate.control].forEach((c, i) => {
        const to = Array.isArray(args.animate.to) ? args.animate.to[i] : args.animate.to;
        keys[c] = twoKeys(a0, c === 'Columns' ? cols : 0, a1, to);
      });
      animation = { control: args.animate.control, controls: map[args.animate.control], startTime: a0, endTime: a1, startFrame: frame(a0), endFrame: frame(a1), keys };
    }
    const w = (bento ? cols : Math.min(cols, n)) * cellSize[0] + ((bento ? cols : Math.min(cols, n)) - 1) * gap[0];
    const h = rows * cellSize[1] + (rows - 1) * gap[1];
    return finish(hostName, !args.controlLayer, controls, {
      mode: bento ? 'bento' : 'grid',
      layout: { columns: cols, rows, cellSize, gap, origin: args.origin ?? [960, 540], align: args.align ?? 'center', fill: colFirst ? 'columns' : 'rows', reverse: !!args.reverse, fit, width: w, height: h },
      animation,
      layers,
    }, { 'Transform/Position': '// Grid layout: slot 1 of ' + n + '\nvar C = thisComp.layer("' + hostName + '");\n...\np;' });
  },

  proximityEffector: (args) => {
    const names = listOf(args.layers);
    const hostName = args.effector?.name ?? args.name ?? 'Effector';
    const want = { scale: args.scale !== undefined, opacity: args.opacity !== undefined, blur: args.blur !== undefined, rotation: args.rotation !== undefined, offset: Array.isArray(args.offset) };
    const controls = [
      control(hostName, 'Radius', 'slider', args.radius ?? 300),
      control(hostName, 'Falloff', 'slider', args.falloff ?? 100),
      control(hostName, 'Smooth Falloff', 'checkbox', args.smooth === false ? 0 : 1),
      control(hostName, 'Invert', 'checkbox', args.invert ? 1 : 0),
      control(hostName, 'Strength', 'slider', args.strength ?? 100),
    ];
    if (want.scale) controls.push(control(hostName, 'Scale Amount', 'slider', args.scale));
    if (want.opacity) controls.push(control(hostName, 'Opacity Amount', 'slider', args.opacity));
    if (want.blur) controls.push(control(hostName, 'Blur Amount', 'slider', args.blur));
    if (want.rotation) controls.push(control(hostName, 'Rotation Amount', 'slider', args.rotation));
    if (want.offset) {
      controls.push(control(hostName, 'Offset X', 'slider', args.offset[0]), control(hostName, 'Offset Y', 'slider', args.offset[1]));
      if (args.offset.length > 2) controls.push(control(hostName, 'Offset Z', 'slider', args.offset[2]));
    }
    const props = [
      ...(want.blur ? ['Effects/Effector Blur/Blurriness'] : []),
      ...(want.scale ? ['Transform/Scale'] : []),
      ...(want.opacity ? ['Transform/Opacity'] : []),
      ...(want.rotation ? ['Transform/Rotation'] : []),
      ...(want.offset ? ['Transform/Position'] : []),
    ];
    const layers = names.filter((n) => n !== hostName).map((name, i) => ({ status: 'ok', layer: layerRef(i + 2, name), expressions: props.map(exprState) }));
    let effectorKeys = null;
    if (args.animate) {
      const [t0, t1] = span(args.animate, 0, 2);
      effectorKeys = twoKeys(t0, args.animate.from ?? args.position ?? [960, 540], t1, args.animate.to);
    }
    return finish(hostName, !args.effector, controls, {
      effector: host(hostName),
      effectorCreated: !args.effector,
      threeD: !!args.threeD || (Array.isArray(args.offset) && args.offset.length > 2),
      reactions: want,
      effectorKeys,
      radiusGuide: args.radiusGuide ? layerRef(1, `${hostName} Radius`) : null,
      layers,
      skipped: names.filter((n) => n === hostName).map((n) => ({ layer: layerRef(1, n), reason: 'it is the effector' })),
    }, Object.fromEntries(props.map((p) => [p, `// Proximity effector: weight from the distance to "${hostName}"\n...`])));
  },

  followChain: (args) => {
    const leader = args.leader?.name ?? `Layer ${args.leader?.index ?? 1}`;
    const names = listOf(args.followers).filter((n) => n !== leader);
    const props = args.properties ?? ['position'];
    const onNull = args.controls === 'null' || args.controlLayer !== undefined;
    const hostName = args.controlLayer?.name ?? (onNull ? args.controlName ?? `${leader} Chain` : leader);
    const paths = { position: 'Transform/Position', rotation: 'Transform/Rotation', scale: 'Transform/Scale', opacity: 'Transform/Opacity' };
    const controls = [control(hostName, 'Delay', 'slider', args.delayFrames ?? 3), control(hostName, 'Decay', 'slider', args.decay ?? 0)];
    const layers = names.map((name, i) => ({ status: 'ok', layer: layerRef(i + 2, name), expressions: props.map((p) => exprState(paths[p])), step: i + 1, space: 'parent' }));
    return finish(hostName, onNull && !args.controlLayer, controls, {
      leader: layerRef(1, leader),
      properties: props,
      mode: args.mode ?? 'offset',
      steps: layers.length,
      layers,
      skipped: listOf(args.followers).filter((n) => n === leader).map((n) => ({ layer: layerRef(1, n), reason: 'it is the leader' })),
    }, Object.fromEntries(props.map((p) => [paths[p], `// Follow chain: step 1 of ${names.length} behind "${leader}" (${args.mode ?? 'offset'})\n...`])));
  },

  cloneArray: (args) => {
    const src = args.layer?.name ?? `Layer ${args.layer?.index ?? 1}`;
    const given = args.copies !== undefined;
    const copyNames = given ? listOf(args.copies).filter((n) => n !== src) : Array.from({ length: args.count }, (_, i) => `${src} ${i + 2}`);
    const total = copyNames.length;
    const hostName = args.controlLayer?.name ?? args.controlName ?? `${src} Array`;
    const r = args.radial;
    const step = args.positionStep ?? (r ? null : [124, 0]);
    const controls = r
      ? [
          control(hostName, 'Center', 'point', [50, 50]),
          control(hostName, 'Radius', 'slider', r.radius ?? 300),
          control(hostName, 'Radius Step', 'slider', r.radiusStep ?? 0),
          control(hostName, 'Start Angle', 'angle', r.startAngle ?? -90),
          control(hostName, 'Angle Step', 'angle', r.angleStep ?? 360 / (total + 1)),
          control(hostName, 'Orient', 'checkbox', r.orient ? 1 : 0),
        ]
      : [control(hostName, 'Step X', 'slider', step[0]), control(hostName, 'Step Y', 'slider', step[1]), ...(step.length > 2 ? [control(hostName, 'Step Z', 'slider', step[2])] : [])];
    controls.push(
      control(hostName, 'Rotation Step', 'slider', args.rotationStep ?? 0),
      control(hostName, 'Scale Step', 'slider', args.scaleStep ?? 0),
      control(hostName, 'Opacity Step', 'slider', args.opacityStep ?? 0),
      control(hostName, 'Time Offset', 'slider', args.timeOffsetFrames ?? 0)
    );
    const tr = ['Transform/Position', 'Transform/Scale', 'Transform/Rotation', 'Transform/Opacity'];
    const layers = copyNames.map((name, i) => ({
      status: 'ok',
      layer: layerRef(i + 2, name),
      expressions: [...tr, ...(args.delayContent ? ['Time Remap'] : [])].map(exprState),
      copy: i + 1,
      ...(args.delayContent ? { contentDelayed: true } : {}),
    }));
    if (r) layers.unshift({ status: 'ok', layer: layerRef(1, src), expressions: ['Transform/Position', 'Transform/Rotation'].map(exprState), copy: 0 });
    return finish(hostName, !args.controlLayer, controls, {
      source: layerRef(1, src),
      mode: r ? 'radial' : 'linear',
      copiesCreated: !given,
      layers,
      skipped: [],
    }, { 'Transform/Position': `// Clone array: position, copy 1 of ${total} from "${src}"\n...` });
  },

  shapeMorph: (args) => {
    const [t0, t1] = span(args, 0, 0.5);
    const fromName = args.from.layer.name ?? `Layer ${args.from.layer.index}`;
    const toName = args.to.layer.name ?? `Layer ${args.to.layer.index}`;
    const sameLayer = fromName === toName;
    const square8 = { vertices: [[0, -50], [50, -50], [50, 0], [50, 50], [0, 50], [-50, 50], [-50, 0], [-50, -50]], inTangents: Array(8).fill([0, 0]), outTangents: Array(8).fill([0, 0]), closed: true };
    const star = { vertices: Array.from({ length: 8 }, (_, k) => [Math.round(Math.cos(-Math.PI / 2 + (k * Math.PI) / 4) * (k % 2 ? 25 : 60)), Math.round(Math.sin(-Math.PI / 2 + (k * Math.PI) / 4) * (k % 2 ? 25 : 60))]), inTangents: Array(8).fill([0, 0]), outTangents: Array(8).fill([0, 0]), closed: true };
    return {
      composition: comp(),
      layer: layerRef(1, fromName),
      from: { layer: layerRef(1, fromName), path: args.from.path ?? 'Group 1/Path 1', propertyPath: 'Contents/Group 1/Contents/Path 1/Path', vertexCount: 4 },
      to: { layer: layerRef(2, toName), path: args.to.path ?? 'Group 1/Path 1', kind: 'path', vertexCount: 8, hidden: args.hideTo === false ? null : sameLayer ? 'path' : 'layer' },
      vertexCount: 8,
      closed: true,
      subdivided: { path: 'from', added: 4 },
      match: args.matchStart === 'keep' ? { shift: 0, reversed: false, cost: null } : { shift: 2, reversed: false, cost: 11.5 },
      space: args.space ?? 'comp',
      startTime: t0,
      endTime: t1,
      startFrame: frame(t0),
      endFrame: frame(t1),
      keys: [key(1, t0, square8, LAND), key(2, t1, star, LAND)],
      notes: ['The from path got 4 vertices on its longest segments; its shape and corners are unchanged.'],
    };
  },

  wiggleRig: (args) => {
    const names = listOf(args.layers);
    const props = args.properties ?? ['position'];
    const hostName = args.controlLayer?.name ?? args.controlName ?? 'Wiggle Controls';
    const amounts = { position: ['Position Amount', args.positionAmount ?? 10], rotation: ['Rotation Amount', args.rotationAmount ?? 2], scale: ['Scale Amount', args.scaleAmount ?? 2], opacity: ['Opacity Amount', args.opacityAmount ?? 10] };
    const paths = { position: 'Transform/Position', rotation: 'Transform/Rotation', scale: 'Transform/Scale', opacity: 'Transform/Opacity' };
    let rampIn = null;
    const strength = args.strength ?? 100;
    if (args.rampIn) {
      const [r0, r1] = span(args.rampIn, 0, 1);
      rampIn = { startTime: r0, endTime: r1, startFrame: frame(r0), endFrame: frame(r1), keys: twoKeys(r0, 0, r1, strength) };
    }
    const controls = [
      control(hostName, 'Frequency', 'slider', args.frequency ?? 0.8),
      ...props.map((p) => control(hostName, amounts[p][0], 'slider', amounts[p][1])),
      control(hostName, 'Loop Seconds', 'slider', args.loop ?? 0),
      control(hostName, 'Seed', 'slider', args.seed ?? 1),
      control(hostName, 'Strength', 'slider', strength, rampIn ? rampIn.keys : []),
    ];
    const layers = names.map((name, i) => ({ status: 'ok', layer: layerRef(i + 2, name), expressions: props.map((p) => exprState(paths[p])) }));
    return finish(hostName, !args.controlLayer, controls, { properties: props, axes: args.axes ?? 'xy', rampIn, layers, skipped: [] }, Object.fromEntries(props.map((p) => [paths[p], `// Wiggle rig: ${p}\n...`])));
  },

  swayLoop: (args) => {
    const names = listOf(args.layers);
    const hostName = args.controlLayer?.name ?? args.controlName ?? 'Sway Controls';
    const sway = args.sway ?? [0, 12];
    const usePos = sway[0] !== 0 || sway[1] !== 0;
    const controls = [
      control(hostName, 'Period', 'slider', args.period ?? 4),
      control(hostName, 'Phase Step', 'slider', args.phaseStep ?? 60),
      ...(usePos ? [control(hostName, 'Sway X', 'slider', sway[0]), control(hostName, 'Sway Y', 'slider', sway[1])] : []),
      ...(args.rotation ? [control(hostName, 'Sway Rotation', 'slider', args.rotation)] : []),
      ...(args.scale ? [control(hostName, 'Sway Scale', 'slider', args.scale)] : []),
      control(hostName, 'Strength', 'slider', args.strength ?? 100),
    ];
    const props = [...(usePos ? ['Transform/Position'] : []), ...(args.rotation ? ['Transform/Rotation'] : []), ...(args.scale ? ['Transform/Scale'] : [])];
    const layers = names.map((name, i) => ({ status: 'ok', layer: layerRef(i + 2, name), expressions: props.map(exprState), phase: i }));
    return finish(hostName, !args.controlLayer, controls, {
      period: args.period ?? 4,
      phaseStep: args.phaseStep ?? 60,
      sway: usePos ? sway : null,
      rotation: args.rotation ?? null,
      scale: args.scale ?? null,
      layers,
      skipped: [],
    }, Object.fromEntries(props.map((p) => [p, '// Sway loop: layer 1\n...'])));
  },

  fitToBox: (args) => {
    const names = listOf(args.layers);
    const onLayer = (args.controls ?? (names.length === 1 ? 'layer' : 'null')) === 'layer';
    const hostName = args.controlLayer?.name ?? (onLayer ? names[0] : args.controlName ?? 'Fit Controls');
    const controls = [
      control(hostName, 'Box Width', 'slider', args.size[0]),
      control(hostName, 'Box Height', 'slider', args.size[1]),
      control(hostName, 'Upscale', 'checkbox', args.upscale ? 1 : 0),
      control(hostName, 'Scale Offset', 'slider', args.offset ?? 0),
    ];
    const bounds = [640, 160];
    const mode = args.mode ?? 'contain';
    const fx = args.size[0] / bounds[0];
    const fy = args.size[1] / bounds[1];
    let f = mode === 'contain' ? Math.min(fx, fy) : mode === 'cover' ? Math.max(fx, fy) : mode === 'width' ? fx : fy;
    if (!args.upscale) f = Math.min(f, 1);
    const layers = names.map((name, i) => ({ status: 'ok', layer: layerRef(i + 2, name), expressions: [exprState('Transform/Scale')], bounds, scaleNow: Math.round((f * 100 + (args.offset ?? 0)) * 100) / 100 }));
    return finish(hostName, !onLayer && !args.controlLayer, controls, { mode, size: args.size, layers, skipped: [] }, { 'Transform/Scale': `// Fit to box (${mode})\n...` });
  },
};
