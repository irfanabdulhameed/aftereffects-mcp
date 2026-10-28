/*
 * Mock result shapes for the charts commands. They mirror charts.jsx: the
 * same keys, a round axis, one Slider Control per label, layers named
 * "<chart> / <part>", and two keys per animated property.
 */

const FPS = 30;
const comp = () => ({ id: 1, name: 'Main Comp' });
const round = (n) => Math.round(n * 10000) / 10000;
const snap = (t) => Math.round(t * FPS) / FPS;
const frame = (t) => Math.round(t * FPS);
const LAND = 'landing (speed 0, influence 25 leaving, 100 arriving)';
const DRAW = 'draw (speed 0, influence 40 leaving, 75 arriving)';
const LIGHT_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const clean = (x) => Number(Number(x).toPrecision(12));

function niceStep(raw, extended = false) {
  if (!(raw > 0)) return 1;
  const e = Math.floor(Math.log10(raw));
  const b = 10 ** e;
  const set = extended ? [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] : [1, 2, 2.5, 5, 10];
  for (const s of set) if (raw / b <= s * (1 + 1e-9)) return clean(s * b);
  return clean(10 * b);
}

function niceScale(lo, hi, steps) {
  const a0 = lo;
  let b0 = hi;
  if (!(b0 > a0)) b0 = a0 + (a0 === 0 ? 1 : Math.abs(a0));
  const fixed = !!steps;
  let best = null;
  let bestScore = 0;
  for (const count of fixed ? [steps] : [4, 5, 6, 3]) {
    let st = niceStep((b0 - a0) / count, fixed);
    let a = 0;
    let b = 0;
    for (let guard = 0; guard < 40; guard++) {
      a = clean(Math.floor(a0 / st + 1e-9) * st);
      b = clean(a + st * count);
      if (b >= b0 - 1e-9) break;
      st = niceStep(st * 1.0001, fixed);
    }
    const score = (b - a) * (count === 3 && !fixed ? 1.1 : 1);
    if (!best || score < bestScore - 1e-9) {
      best = { min: a, max: b, step: st, steps: count };
      bestScore = score;
    }
  }
  return best;
}

function fmt(spec = {}, dflt = {}) {
  const sep = spec.thousands ?? dflt.thousands ?? true;
  const compact = spec.compact ?? dflt.compact ?? false;
  return {
    decimals: spec.decimals ?? dflt.decimals ?? (compact ? 1 : 0),
    prefix: spec.prefix ?? dflt.prefix ?? '',
    suffix: spec.suffix ?? dflt.suffix ?? '',
    thousands: sep === true ? ',' : sep === false ? '' : sep,
    decimalMark: spec.decimalMark ?? '.',
    compact,
  };
}

function formatNumber(f, n) {
  let x = Math.abs(n);
  let u = '';
  if (f.compact) {
    if (x >= 1e9) [x, u] = [x / 1e9, 'B'];
    else if (x >= 1e6) [x, u] = [x / 1e6, 'M'];
    else if (x >= 1e3) [x, u] = [x / 1e3, 'K'];
  }
  let s = x.toFixed(f.decimals);
  if (f.compact && u && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  const p = s.split('.');
  if (f.thousands) p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, f.thousands);
  return (n < 0 && Number(s) !== 0 ? '-' : '') + f.prefix + p[0] + (p.length > 1 ? f.decimalMark + p[1] : '') + u + f.suffix;
}

function decimalsOf(values) {
  let d = 0;
  for (const v of values) {
    const s = String(clean(Math.abs(v)));
    if (!s.includes('e') && s.includes('.')) d = Math.max(d, s.length - s.indexOf('.') - 1);
  }
  return Math.min(2, d);
}

function scaleFor(values) {
  const m = Math.max(0, ...values.map((v) => Math.abs(v)));
  let s = 1;
  while (m / s >= 1e6) s *= 10;
  return s;
}

/** Builds the layer list and the shared result fields. */
function chart(args, type, defName) {
  const base = args.name ?? defName;
  const layers = [];
  let index = 1;
  const add = (role, part, label = null) => layers.push({ role, label, layer: { index: index++, id: 200 + index, name: `${base} / ${part}` } });
  add('controls', 'Controls');
  return { base, layers, add };
}

function controlsOut(base, list, scale = 1) {
  return list.map((c) => ({
    label: c.label,
    effect: c.effect ?? c.label,
    value: round(c.value),
    sliderValue: round(c.value / scale),
    property: `Effects/${c.effect ?? c.label}/Slider`,
    expression: `thisComp.layer(${JSON.stringify(`${base} / Controls`)}).effect(${JSON.stringify(c.effect ?? c.label)})(1)`,
  }));
}

function timing(args, d) {
  const t0 = snap(args.startFrame !== undefined ? args.startFrame / FPS : args.startTime ?? 0);
  const dur = snap(args.durationFrames !== undefined ? args.durationFrames / FPS : args.duration ?? d.duration);
  const staggerFrames = args.staggerFrames ?? Math.max(1, Math.round((d.stagger ?? 0.07) * FPS));
  return { t0, dur, staggerFrames, stagger: staggerFrames / FPS, animate: args.animate !== false, easing: args.easing ?? d.easing ?? LAND };
}

function animation(tm, end, extra = {}) {
  if (!tm.animate) return null;
  return { startTime: round(tm.t0), endTime: round(end), startFrame: frame(tm.t0), endFrame: frame(end), duration: round(tm.dur), staggerFrames: tm.staggerFrames, easing: tm.easing, ...extra };
}

function result(ctx, args, extra) {
  return {
    composition: comp(),
    chart: { name: ctx.base, type: extra.type, controls: `${ctx.base} / Controls`, layerCount: ctx.layers.length, theme: { name: args.theme && args.theme !== 'auto' ? args.theme : 'light', from: args.theme && args.theme !== 'auto' ? `theme ${args.theme}` : "solid 'Background'" } },
    layers: ctx.layers,
    dataSource: args.dataSource ?? null,
    expressions: { count: extra.expressions, errors: [] },
    keyframes: extra.keyframes,
    notes: extra.notes ?? [],
    ...extra.fields,
    component: args.component ? { component: { id: 50, name: typeof args.component === 'object' && args.component.name ? args.component.name : ctx.base }, instance: { index: 1, id: 300, name: ctx.base }, added: [], failed: [] } : null,
  };
}

export const responses = {
  createBarChart: (args) => {
    const items = args.data ?? [];
    const n = items.length;
    const values = items.map((d) => d.value);
    const max = Math.max(0, ...values);
    const axis = args.max !== undefined ? { min: 0, max: args.max, step: args.max / (args.steps ?? 4), steps: args.steps ?? 4 } : niceScale(0, max, args.steps);
    const scale = scaleFor([...values, axis.max]);
    const vertical = args.orientation !== 'horizontal';
    const size = args.size ?? (vertical ? [960, 454] : [806, 540]);
    const catLen = vertical ? size[0] : size[1];
    const band = catLen / Math.max(1, n);
    const bw = args.barWidth ?? Math.min(band * 0.64, Math.max(24, catLen * 0.18));
    const ctx = chart(args, 'bar', 'Bar Chart');
    const grid = args.gridlines !== false || args.axis !== false;
    if (grid) ctx.add('grid', 'Grid');
    items.forEach((d) => ctx.add('bar', `Bar ${d.label}`, d.label));
    if (args.categoryLabels !== false) items.forEach((d) => ctx.add('category-label', `Label ${d.label}`, d.label));
    if ((args.valueLabels ?? 'end') !== 'none') items.forEach((d) => ctx.add('value-label', `Value ${d.label}`, d.label));
    const ticks = (args.axisLabels ?? args.gridlines !== false) ? axis.steps + 1 : 0;
    for (let k = 0; k < ticks; k++) ctx.add('tick', `Tick ${k}`);
    const tm = timing(args, { duration: 0.8, stagger: 0.07 });
    const barStart = tm.t0 + (grid ? snap(0.2) : 0);
    const end = barStart + (n - 1) * tm.stagger + tm.dur;
    const f = fmt(args.format, { decimals: decimalsOf(values) });
    const hl = new Set(args.highlight ?? []);
    const colors = items.map((d, i) => (hl.size ? (hl.has(d.label) ? '#2a78d6' : '#c4c3be') : args.colorMode === 'palette' ? LIGHT_PALETTE[i % 8] : '#2a78d6'));
    const keys = tm.animate ? 2 * (n + (grid ? 1 : 0) + ticks + (args.categoryLabels !== false ? n : 0)) : 0;
    return result(ctx, args, {
      type: 'bar',
      expressions: n * (args.roundBase ? 2 : 4) + ((args.valueLabels ?? 'end') !== 'none' ? 3 * n : 0) + ticks,
      keyframes: keys,
      fields: {
        controls: controlsOut(ctx.base, [...items, { label: 'Axis Max', value: axis.max }], scale),
        axis: { min: 0, max: axis.max, step: axis.step, steps: axis.steps, auto: args.max === undefined, scale },
        layout: {
          orientation: vertical ? 'vertical' : 'horizontal',
          position: args.position ?? [960, 540],
          size,
          barWidth: round(bw),
          gap: round(band - bw),
          cornerRadius: args.cornerRadius ?? Math.max(2, Math.min(Math.round(bw * 0.16), 16)),
          roundBase: !!args.roundBase,
          colorMode: hl.size ? 'highlight' : args.colorMode ?? 'accent',
          colors,
          valueLabels: args.valueLabels ?? 'end',
          fontSize: args.fontSize ?? 28,
          labelFontSize: args.labelFontSize ?? 24,
          format: f,
        },
        animation: animation(tm, end, { barsStart: round(barStart) }),
      },
    });
  },

  createLineChart: (args) => {
    const items = args.data ?? [];
    const n = items.length;
    const values = items.map((d) => d.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const minMode = args.min === undefined ? 'zero' : args.min === 'auto' ? 'auto' : 'fixed';
    const a = minMode === 'fixed' ? args.min : minMode === 'auto' ? lo : Math.min(0, lo);
    const axis = args.max !== undefined ? { min: a, max: args.max, step: (args.max - a) / (args.steps ?? 4), steps: args.steps ?? 4 } : niceScale(a, hi, args.steps);
    const scale = scaleFor([...values, axis.max, axis.min]);
    const ctx = chart(args, 'line', 'Line Chart');
    const grid = args.gridlines !== false || args.axis !== false;
    if (grid) ctx.add('grid', 'Grid');
    const area = args.area ?? 'gradient';
    if (area !== 'none') ctx.add('area', 'Area');
    if (area === 'gradient') ctx.add('area-matte', 'Area Fade');
    ctx.add('line', 'Line');
    const dots = args.dots ?? n <= 24;
    if (dots) ctx.add('dots', 'Dots');
    const pl = args.pointLabels ?? 'last';
    items.forEach((d, i) => {
      if (pl === 'all' || (pl === 'last' && i === n - 1)) ctx.add('value-label', `Value ${d.label}`, d.label);
    });
    const every = args.labelEvery ?? Math.max(1, Math.ceil(n / 12));
    if (args.categoryLabels !== false) items.forEach((d, i) => i % every === 0 && ctx.add('category-label', `Label ${d.label}`, d.label));
    const ticks = (args.axisLabels ?? args.gridlines !== false) ? axis.steps + 1 : 0;
    for (let k = 0; k < ticks; k++) ctx.add('tick', `Tick ${k}`);
    const tm = timing(args, { duration: 1.2, stagger: 0.07, easing: DRAW });
    const lt0 = tm.t0 + (grid ? snap(0.2) : 0);
    const lt1 = lt0 + tm.dur;
    const arrivals = items.map((d, i) => {
      const t = snap(lt0 + (tm.dur * i) / (n - 1));
      return { label: d.label, fraction: round(i / (n - 1)), time: round(t), frame: frame(t) };
    });
    return result(ctx, args, {
      type: 'line',
      expressions: 1 + (area !== 'none' ? 1 : 0) + (area === 'gradient' ? 1 : 0) + (dots ? n : 0) + 2 * (pl === 'all' ? n : pl === 'last' ? 1 : 0) + ticks,
      keyframes: tm.animate ? 2 * (1 + (grid ? 1 : 0) + ticks + (dots ? n : 0)) : 0,
      fields: {
        controls: controlsOut(ctx.base, [...items, { label: 'Axis Max', value: axis.max }, { label: 'Axis Min', value: axis.min }], scale),
        axis: { min: axis.min, max: axis.max, step: axis.step, steps: axis.steps, auto: args.max === undefined, minMode, scale },
        layout: {
          position: args.position ?? [960, 540],
          size: args.size ?? [1152, 454],
          smooth: args.smooth !== false,
          lineWidth: args.lineWidth ?? 4,
          dots,
          dotSize: args.dotSize ?? 12,
          area,
          areaOpacity: args.areaOpacity ?? (area === 'gradient' ? 32 : 14),
          pointLabels: pl,
          labelEvery: every,
          color: '#2a78d6',
          fontSize: args.fontSize ?? 28,
          labelFontSize: args.labelFontSize ?? 22,
          format: fmt(args.format, { decimals: decimalsOf(values) }),
        },
        animation: animation(tm, lt1, { lineStart: round(lt0), lineEnd: round(lt1), arrivals: tm.animate ? arrivals : null }),
      },
    });
  },

  createPieChart: (args) => {
    const items = args.data ?? [];
    const n = items.length;
    const total = items.reduce((s, d) => s + d.value, 0);
    const radius = args.radius ?? 324;
    const inner = args.innerRadius ?? Math.round(radius * 0.62);
    const ctx = chart(args, 'pie', 'Pie Chart');
    items.forEach((d) => ctx.add('slice', `Slice ${d.label}`, d.label));
    const labels = args.labels ?? 'percent';
    if (labels !== 'none') items.forEach((d) => ctx.add('slice-label', `Label ${d.label}`, d.label));
    if (args.legend !== false) {
      ctx.add('legend-swatches', 'Swatches');
      items.forEach((d) => ctx.add('legend-label', `Legend ${d.label}`, d.label));
    }
    const center = args.center && inner > 0 ? { total: args.center === true || args.center.total !== false, label: args.center === true ? null : args.center.label ?? null } : null;
    if (center?.total) ctx.add('center-total', 'Center Total');
    if (center?.label) ctx.add('center-label', 'Center Label');
    const tm = timing(args, { duration: 0.8, stagger: 0.12 });
    const mode = args.highlight ? 'highlight' : args.colorMode ?? 'shades';
    return result(ctx, args, {
      type: 'pie',
      expressions: 2 * n + (labels !== 'none' ? (labels === 'label' ? 2 : 3) * n : 0) + (center?.total ? 1 : 0),
      keyframes: tm.animate ? 2 * (n + (args.legend !== false ? 2 * n : 0) + (center?.total ? 1 : 0) + (center?.label ? 1 : 0)) : 0,
      fields: {
        controls: controlsOut(ctx.base, items, scaleFor([...items.map((d) => d.value), total])),
        total: round(total),
        shares: items.map((d, i) => ({ label: d.label, value: d.value, percent: Math.round((d.value / total) * 10000) / 100, color: mode === 'palette' ? LIGHT_PALETTE[i % 8] : '#2a78d6' })),
        layout: { position: args.position ?? [960, 540], radius, innerRadius: inner, style: inner > 0 ? 'donut' : 'pie', startAngle: args.startAngle ?? 0, gap: n > 1 ? args.gap ?? (inner > 0 ? 4 : 3) : 0, colorMode: mode, labels, labelPosition: args.labelPosition && args.labelPosition !== 'auto' ? args.labelPosition : 'inside', legend: args.legend !== false, center, fontSize: args.fontSize ?? 26 },
        animation: animation(tm, tm.t0 + (n - 1) * tm.stagger + tm.dur),
      },
    });
  },

  createStat: (args) => {
    const ctx = chart(args, 'stat', 'Stat');
    if (args.label) ctx.add('label', 'Label');
    ctx.add('value', 'Value');
    if (args.delta) {
      ctx.add('delta-arrow', 'Delta Arrow');
      ctx.add('delta', 'Delta');
      if (args.delta.caption) ctx.add('delta-caption', 'Delta Caption');
    }
    if (args.sparkline) ctx.add('sparkline', 'Sparkline');
    const f = fmt(args.format, { decimals: decimalsOf([args.value, args.from ?? 0]) });
    const df = args.delta ? fmt(args.delta.format, { decimals: decimalsOf([args.delta.value]), suffix: '%' }) : null;
    const tm = timing(args, { duration: 1.2 });
    const countStart = tm.t0 + (args.label ? snap(0.1) : 0);
    const controls = [{ label: 'Value', value: args.value }, { label: 'From', value: args.from ?? 0 }];
    if (args.delta) controls.push({ label: 'Delta', value: args.delta.value });
    (args.sparkline?.data ?? []).forEach((v, i) => controls.push({ label: `Spark ${i + 1}`, value: v }));
    const d = args.delta?.value;
    return result(ctx, args, {
      type: 'stat',
      expressions: 2 + (args.delta ? 7 + (args.delta.caption ? 2 : 0) : 0) + (args.sparkline ? 1 + (args.sparkline.dot !== false ? 1 : 0) : 0),
      keyframes: tm.animate ? 2 * (1 + (args.label ? 1 : 0) + (args.delta ? 2 : 0) + (args.sparkline ? 1 + (args.sparkline.dot !== false ? 1 : 0) : 0)) : 0,
      fields: {
        controls: controlsOut(ctx.base, controls),
        progress: { effect: 'Count', property: 'Effects/Count/Slider', note: '0 shows From, 100 shows Value.' },
        text: { value: formatNumber(f, args.value), delta: df ? formatNumber(df, Math.abs(d)) : null, direction: args.delta ? (d > 0 ? 'up' : d < 0 ? 'down' : 'none') : null, good: args.delta && d !== 0 ? ((args.delta.goodWhen ?? 'up') === 'up' ? d > 0 : d < 0) : null },
        layout: { position: args.position ?? [346, 346], align: args.align ?? 'left', fontSize: args.fontSize ?? 112, labelFontSize: args.labelFontSize ?? 28, height: 240, sparkline: args.sparkline ? { width: args.sparkline.width ?? 403, height: args.sparkline.height ?? 69, points: args.sparkline.data.length } : null, format: f },
        animation: animation(tm, countStart + tm.dur, { countStart: round(countStart), countEnd: round(countStart + tm.dur) }),
      },
    });
  },

  createProgress: (args) => {
    const style = args.style ?? 'bar';
    const ctx = chart(args, 'progress', style === 'ring' ? 'Progress Ring' : 'Progress Bar');
    ctx.add(style, style === 'ring' ? 'Ring' : 'Bar');
    if ((args.display ?? 'percent') !== 'none') ctx.add('value', 'Value');
    if (args.caption) ctx.add('caption', 'Caption');
    const max = args.max ?? 100;
    const tm = timing(args, { duration: 1 });
    return result(ctx, args, {
      type: 'progress',
      expressions: (style === 'bar' ? 3 : 2) + ((args.display ?? 'percent') !== 'none' ? 1 : 0),
      keyframes: tm.animate ? 2 * (1 + (style === 'bar' ? 1 : 0) + (args.caption ? 1 : 0) + ((args.display ?? 'percent') !== 'none' ? 1 : 0)) : 0,
      fields: {
        controls: controlsOut(ctx.base, [{ label: 'Value', value: args.value }, { label: 'Max', value: max }]),
        progress: { effect: 'Grow', property: 'Effects/Grow/Slider', note: '0 shows an empty track, 100 fills to Value / Max.' },
        percent: Math.round(Math.max(0, Math.min(1, args.value / max)) * 10000) / 100,
        layout: { style, position: args.position ?? [960, 540], size: style === 'bar' ? args.size ?? [768, 16] : null, radius: style === 'ring' ? args.radius ?? 173 : null, thickness: style === 'ring' ? args.thickness ?? 24 : null, color: '#2a78d6', trackColor: '#dce8f6', display: args.display ?? 'percent', fontSize: args.fontSize ?? 28, labelFontSize: args.labelFontSize ?? 24, format: fmt(args.format, { decimals: 0, suffix: '%' }) },
        animation: animation(tm, tm.t0 + snap(0.1) + tm.dur),
      },
    });
  },

  updateChartData: (args) => {
    const updates = [...(args.data ?? []), ...Object.entries(args.values ?? {}).map(([label, value]) => ({ label, value }))];
    const animate = args.animate ?? (args.startTime !== undefined || args.startFrame !== undefined || args.duration !== undefined || args.durationFrames !== undefined || args.easing !== undefined);
    const t0 = snap(args.startFrame !== undefined ? args.startFrame / FPS : args.startTime ?? 0);
    const t1 = t0 + snap(args.durationFrames !== undefined ? args.durationFrames / FPS : args.duration ?? 0.8);
    const key = (i, t, v, last) => ({ index: i, time: round(t), frame: frame(t), value: v, inInterpolation: 'bezier', outInterpolation: 'bezier', easeIn: [{ speed: 0, influence: last ? 100 : 16.67 }], easeOut: [{ speed: 0, influence: 25 }], temporalContinuous: false, temporalAutoBezier: false, selected: false });
    const name = args.chart ?? 'Bar Chart';
    const changed = updates.map((u) => {
      const from = round(u.value * 0.75);
      return { label: u.label, effect: u.label, from, to: u.value, keys: animate ? [key(1, t0, from, false), key(2, t1, u.value, true)] : null };
    });
    const top = Math.max(0, ...updates.map((u) => u.value));
    const next = niceScale(0, top, 4);
    const rescale = args.rescale !== false && next.max !== 100;
    return {
      composition: comp(),
      chart: { name, type: 'bar', controls: { index: 1, id: 201, name: `${name} / Controls` }, component: args.instance ? name : null },
      target: args.instance ? 'instance' : 'controls',
      instance: args.instance ? { index: args.instance.index ?? 1, id: 300, name: args.instance.name ?? name } : null,
      animated: animate,
      startTime: animate ? round(t0) : null,
      endTime: animate ? round(t1) : null,
      startFrame: animate ? frame(t0) : null,
      endFrame: animate ? frame(t1) : null,
      easing: animate ? args.easing ?? LAND : null,
      changed,
      axis: rescale ? { before: { min: 0, max: 100 }, after: { min: 0, max: next.max }, keys: animate ? [key(1, t0, 100, false), key(2, t1, next.max, true)] : [] } : null,
      dataSource: args.dataSource ?? null,
      notes: [],
    };
  },

  getChartData: (args) => {
    const one = (name, type) => ({
      name,
      type,
      controls: { index: 1, id: 201, name: `${name} / Controls` },
      component: args.instance ? { comp: { id: 50, name }, instance: { index: 1, id: 300, name } } : null,
      scale: 1,
      format: { decimals: 0, prefix: '', suffix: '', thousands: ',', decimalMark: '.', compact: false },
      values: [
        { label: 'Q1', effect: 'Q1', value: 42, keys: 0, source: args.instance ? 'instance' : 'controls' },
        { label: 'Q2', effect: 'Q2', value: 58, keys: 2, source: args.instance ? 'instance' : 'controls' },
      ],
      axis: type === 'pie' ? null : { min: 0, max: 60, steps: 6, auto: true, minMode: 'zero' },
      layers: [
        { index: 1, id: 201, name: `${name} / Controls` },
        { index: 2, id: 202, name: `${name} / Bar Q1` },
        { index: 3, id: 203, name: `${name} / Bar Q2` },
      ],
    });
    const charts = args.chart || args.controls || args.instance ? [one(args.chart ?? 'Bar Chart', 'bar')] : [one('Bar Chart', 'bar'), one('Pie Chart', 'pie')];
    const t = args.frame !== undefined ? args.frame / FPS : args.time ?? 0;
    return { composition: comp(), time: round(t), count: charts.length, charts };
  },
};
