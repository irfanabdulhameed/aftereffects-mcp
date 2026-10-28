/*
 * Charts and data commands (group 'charts'): bar, line and pie charts, KPI
 * stats and progress bars or rings for product and explainer films.
 *
 * A chart is a set of ordinary layers parented to one control null named
 * "<chart> / Controls". The null holds the data: one Slider Control per value,
 * named by its label (shortened to 31 characters when needed), plus the axis
 * range ("Axis Max", "Axis Min"). Bars, lines, slices, labels and counters
 * read those sliders by expression, so typing or keying a slider updates the
 * chart. The intro is keyed on a "Grow" slider per bar or slice (two eased
 * keys each, staggered), on Trim Paths End for lines, and on Opacity or group
 * Scale for labels and dots. Nothing writes a key on every frame and nothing
 * overshoots.
 *
 * Bars are one shape layer each: a bar can be selected, recoloured and
 * retimed on its own, and its two Grow keys sit on its own layer, so the
 * stagger is visible in the timeline. A rounded rectangle unioned with a
 * square one under one Fill gives rounded data ends on a square baseline.
 *
 * Sliders hold values between -1,000,000 and 1,000,000. Larger data is stored
 * divided by a power of ten (the chart's scale) and multiplied back in every
 * expression. The chart description (type, labels, scale, axis) is kept as
 * JSON in the control null's comment so update-chart-data and get-chart-data
 * can find and change the chart later.
 *
 * Expressions read effect parameters by index (effect("Q1")(1)), so they also
 * work in localized versions of After Effects. Geometry and number formatting
 * are written once as expression source (MCP.charts.SRC_GEOM, fmtSrc, tickSrc)
 * and compiled with eval for the build-time maths, so the bridge and the
 * expressions always agree.
 */

MCP.charts = {};

MCP.charts.TAG = "MCP chart ";
MCP.charts.META_VERSION = 1;
MCP.charts.SLIDER_LIMIT = 1000000;
MCP.charts.NAME_MAX = 31;
MCP.charts.LABEL_COLOR = "sea-foam";
MCP.charts.SAMPLES = 16;

/* Eases: speed 0 at both keys, the curve shaped by influence. */
MCP.charts.EASE_LAND = { type: "custom", outSpeed: 0, outInfluence: 25, inSpeed: 0, inInfluence: 100 };
MCP.charts.EASE_DRAW = { type: "custom", outSpeed: 0, outInfluence: 40, inSpeed: 0, inInfluence: 75 };
MCP.charts.LAND_TEXT = "landing (speed 0, influence 25 leaving, 100 arriving)";
MCP.charts.DRAW_TEXT = "draw (speed 0, influence 40 leaving, 75 arriving)";

/* Neutrals and series colours per theme. Text never wears the series colour. */
MCP.charts.THEMES = {
    light: {
        ink: "#111110", ink2: "#52514E", muted: "#898781", grid: "#E1E0D9", axis: "#C3C2B7", surface: "#FCFCFB",
        accent: "#2A78D6", up: "#16A34A", down: "#DC2626",
        palette: ["#2A78D6", "#EB6834", "#1BAF7A", "#EDA100", "#E87BA4", "#008300", "#6250D6", "#E34948"]
    },
    dark: {
        ink: "#F0EFEC", ink2: "#C3C2B7", muted: "#898781", grid: "#2C2C2A", axis: "#45453F", surface: "#1A1A19",
        accent: "#3987E5", up: "#4ADE80", down: "#F87171",
        palette: ["#3987E5", "#D95926", "#199E70", "#C98500", "#D55181", "#008300", "#9085E9", "#E66767"]
    }
};

/* ------------------------------------------------- expression source (shared) */

/*
 * cs_tan: monotone cubic tangents (Fritsch-Carlson) for points ordered by x, so
 *   a smooth line never swings past its data; zero tangents when smooth is false.
 * cs_pt: a point on one cubic segment. cs_len: arc lengths sampled S times per
 *   segment. cs_cut: the path up to a fraction of its arc length, split exactly
 *   with de Casteljau, so an area can follow Trim Paths on the line.
 */
MCP.charts.SRC_GEOM = [
    "function cs_mix(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; }",
    "function cs_tan(P, smooth) {",
    "  var n = P.length, ins = [], outs = [], d = [], m = [], i, a, b, s, t, hl, hr, dx;",
    "  for (i = 0; i < n; i++) { ins.push([0, 0]); outs.push([0, 0]); }",
    "  if (!smooth || n < 2) { return { i: ins, o: outs }; }",
    "  for (i = 0; i < n - 1; i++) { dx = P[i + 1][0] - P[i][0]; d.push(dx !== 0 ? (P[i + 1][1] - P[i][1]) / dx : 0); }",
    "  for (i = 0; i < n; i++) {",
    "    if (i === 0) { m.push(d[0]); }",
    "    else if (i === n - 1) { m.push(d[n - 2]); }",
    "    else if (d[i - 1] * d[i] <= 0) { m.push(0); }",
    "    else { m.push((d[i - 1] + d[i]) / 2); }",
    "  }",
    "  for (i = 0; i < n - 1; i++) {",
    "    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; }",
    "    else { a = m[i] / d[i]; b = m[i + 1] / d[i]; s = a * a + b * b; if (s > 9) { t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }",
    "  }",
    "  for (i = 0; i < n; i++) {",
    "    hl = i > 0 ? (P[i][0] - P[i - 1][0]) / 3 : 0;",
    "    hr = i < n - 1 ? (P[i + 1][0] - P[i][0]) / 3 : 0;",
    "    ins[i] = [-hl, -hl * m[i]];",
    "    outs[i] = [hr, hr * m[i]];",
    "  }",
    "  return { i: ins, o: outs };",
    "}",
    "function cs_pt(a, oa, ib, b, u) {",
    "  var v = 1 - u, c1x = a[0] + oa[0], c1y = a[1] + oa[1], c2x = b[0] + ib[0], c2y = b[1] + ib[1];",
    "  return [v * v * v * a[0] + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * b[0], v * v * v * a[1] + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * b[1]];",
    "}",
    "function cs_len(P, I, O, S) {",
    "  var segs = [], cum = [0], tot = 0, k, j, L, prev, q, dx, dy;",
    "  for (k = 0; k < P.length - 1; k++) {",
    "    L = [0]; prev = P[k];",
    "    for (j = 1; j <= S; j++) { q = cs_pt(P[k], O[k], I[k + 1], P[k + 1], j / S); dx = q[0] - prev[0]; dy = q[1] - prev[1]; L.push(L[j - 1] + Math.sqrt(dx * dx + dy * dy)); prev = q; }",
    "    segs.push(L); tot += L[S]; cum.push(tot);",
    "  }",
    "  return { segs: segs, cum: cum, total: tot };",
    "}",
    "function cs_cut(P, I, O, f, S) {",
    "  var n = P.length, A, target, k, L, rem, j, u, p0, p1, p2, p3, q0, q1, q2, r0, r1, s;",
    "  if (n < 2 || f >= 1) { return { p: P.slice(0), i: I.slice(0), o: O.slice(0) }; }",
    "  A = cs_len(P, I, O, S); target = Math.max(0, f) * A.total; k = 0;",
    "  while (k < n - 2 && A.cum[k + 1] < target) { k++; }",
    "  L = A.segs[k]; rem = target - A.cum[k]; j = 1;",
    "  while (j < S && L[j] < rem) { j++; }",
    "  u = (j - 1 + (L[j] > L[j - 1] ? (rem - L[j - 1]) / (L[j] - L[j - 1]) : 0)) / S;",
    "  u = Math.max(0, Math.min(1, u));",
    "  p0 = P[k]; p1 = [P[k][0] + O[k][0], P[k][1] + O[k][1]]; p2 = [P[k + 1][0] + I[k + 1][0], P[k + 1][1] + I[k + 1][1]]; p3 = P[k + 1];",
    "  q0 = cs_mix(p0, p1, u); q1 = cs_mix(p1, p2, u); q2 = cs_mix(p2, p3, u); r0 = cs_mix(q0, q1, u); r1 = cs_mix(q1, q2, u); s = cs_mix(r0, r1, u);",
    "  return { p: P.slice(0, k + 1).concat([s]), i: I.slice(0, k + 1).concat([[r0[0] - s[0], r0[1] - s[1]]]), o: O.slice(0, k).concat([[q0[0] - p0[0], q0[1] - p0[1]], [0, 0]]) };",
    "}"
].join("\n") + "\n";

/** Compiles expression source in the bridge and returns the named function. */
MCP.charts.compile = function (src, name) {
    return eval("(function () {\n" + src + "\nreturn " + name + ";\n})()");
};

/** The geometry functions compiled for build-time maths: {tan, len, cut}. */
MCP.charts.geom = function () {
    if (!MCP.charts.geomCache) {
        var src = MCP.charts.SRC_GEOM;
        MCP.charts.geomCache = {
            tan: MCP.charts.compile(src, "cs_tan"),
            len: MCP.charts.compile(src, "cs_len"),
            cut: MCP.charts.compile(src, "cs_cut")
        };
    }
    return MCP.charts.geomCache;
};

/** JSON string literal for expression source. */
MCP.charts.q = function (s) {
    return JSON.stringify(String(s));
};

/** A number as expression source, rounded to 4 decimals. */
MCP.charts.n = function (v) {
    var x = Number(v);
    if (!isFinite(x)) { return "0"; }
    var r = Math.round(x * 10000) / 10000;
    return String(r === 0 ? 0 : r);
};

MCP.charts.colorSrc = function (c) {
    return "[" + MCP.charts.n(c[0]) + ", " + MCP.charts.n(c[1]) + ", " + MCP.charts.n(c[2]) + ", 1]";
};

/**
 * Number formatter source: function <name>(n) returns text with decimals,
 * prefix, suffix, a thousands separator, a decimal mark and optional compact
 * units (K, M, B; trailing zeros dropped).
 */
MCP.charts.fmtSrc = function (f, name) {
    var q = MCP.charts.q;
    return "function " + name + "(n) {\n" +
        "  var D = " + f.decimals + ", P = " + q(f.prefix) + ", S = " + q(f.suffix) + ", T = " + q(f.sep) + ", M = " + q(f.mark) + ", K = " + (f.compact ? "true" : "false") + ";\n" +
        "  var x = Number(n), neg = x < 0, u = \"\", s, p;\n" +
        "  if (!isFinite(x)) { x = 0; neg = false; }\n" +
        "  x = Math.abs(x);\n" +
        "  if (K) { if (x >= 1e9) { x = x / 1e9; u = \"B\"; } else if (x >= 1e6) { x = x / 1e6; u = \"M\"; } else if (x >= 1e3) { x = x / 1e3; u = \"K\"; } }\n" +
        "  s = x.toFixed(D);\n" +
        "  if (K && Number(s) >= 1000 && (u === \"K\" || u === \"M\")) { x = x / 1000; u = u === \"K\" ? \"M\" : \"B\"; s = x.toFixed(D); }\n" +
        "  if (K && s.indexOf(\".\") >= 0) { s = s.replace(/0+$/, \"\").replace(/\\.$/, \"\"); }\n" +
        "  if (Number(s) === 0) { neg = false; }\n" +
        "  p = s.split(\".\");\n" +
        "  if (T !== \"\") { p[0] = p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, T); }\n" +
        "  return (neg ? \"-\" : \"\") + P + p[0] + (p.length > 1 ? M + p[1] : \"\") + u + S;\n" +
        "}\n";
};

/**
 * Axis tick formatter source: cs_tick(n, step, magnitude). Decimals follow the
 * step rounded up to a round step (0, 2.5, 5 shows one decimal), so ticks keep
 * whole numbers while an axis change animates; compact units follow the
 * magnitude of the axis (from 10,000), so every tick on an axis uses the same unit.
 */
MCP.charts.tickSrc = function (f) {
    var q = MCP.charts.q;
    return "function cs_tick(n, st, mx) {\n" +
        "  var P = " + q(f.prefix) + ", S = " + q(f.suffix) + ", T = " + q(f.sep) + ", M = " + q(f.mark) + ", K = " + (f.compact ? "true" : "false") + ";\n" +
        "  var div = 1, u = \"\", a = Math.abs(mx), x, s, d = 0, str, p, w, b, N = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10], j = 0;\n" +
        "  if (K) { if (a >= 1e9) { div = 1e9; u = \"B\"; } else if (a >= 1e6) { div = 1e6; u = \"M\"; } else if (a >= 1e4) { div = 1e3; u = \"K\"; } }\n" +
        "  x = n / div; s = Math.abs(st / div);\n" +
        "  if (s > 0 && isFinite(s)) { b = Math.pow(10, Math.floor(Math.log(s) / Math.LN10)); while (j < N.length - 1 && s / b > N[j] * (1 + 1e-6)) { j++; } s = N[j] * b; }\n" +
        "  while (d < 4) { w = s * Math.pow(10, d); if (Math.abs(Math.round(w) - w) <= 1e-6 * Math.max(1, w)) { break; } d++; }\n" +
        "  str = Math.abs(x).toFixed(d);\n" +
        "  if (Number(str) === 0) { return P + \"0\" + S; }\n" +
        "  p = str.split(\".\");\n" +
        "  if (T !== \"\") { p[0] = p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, T); }\n" +
        "  return (x < 0 ? \"-\" : \"\") + P + p[0] + (p.length > 1 ? M + p[1] : \"\") + u + S;\n" +
        "}\n";
};

/* ------------------------------------------------------------ small maths */

MCP.charts.clean = function (x) {
    return Number(Number(x).toPrecision(12));
};

/**
 * The smallest round step that is at least raw: 1, 2, 2.5 or 5 times a power
 * of ten, or with extended also 1.5, 3, 4, 6 and 8 (for an axis whose step
 * count is fixed, so it can still fit the data closely).
 */
MCP.charts.niceStep = function (raw, extended) {
    var r = Number(raw);
    if (!(r > 0) || !isFinite(r)) { return 1; }
    var e = Math.floor(Math.log(r) / Math.LN10);
    var b = Math.pow(10, e);
    var f = r / b;
    var steps = extended ? [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] : [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) {
        if (f <= steps[i] * (1 + 1e-9)) { return MCP.charts.clean(steps[i] * b); }
    }
    return MCP.charts.clean(10 * b);
};

/**
 * A round axis from lo to hi: {min, max, step, steps}. With steps given the
 * count is kept and the richer step set is used; otherwise 4, 5, 6 and 3
 * steps are tried and the tightest range wins (ties go to the earlier count,
 * and 3 steps must be clearly tighter, since sparse gridlines read poorly).
 */
MCP.charts.niceScale = function (lo, hi, steps) {
    var a0 = Number(lo), b0 = Number(hi);
    if (!isFinite(a0)) { a0 = 0; }
    if (!isFinite(b0)) { b0 = a0 + 1; }
    if (!(b0 > a0)) { b0 = a0 + (a0 === 0 ? 1 : Math.abs(a0)); }
    var fixed = MCP.isDefined(steps) && Number(steps) > 0;
    var cands = fixed ? [Math.round(Number(steps))] : [4, 5, 6, 3];
    var best = null, bestScore = 0;
    for (var c = 0; c < cands.length; c++) {
        var count = cands[c];
        var st = MCP.charts.niceStep((b0 - a0) / count, fixed);
        var a = 0, b = 0, guard = 0;
        while (guard++ < 40) {
            a = MCP.charts.clean(Math.floor(a0 / st + 1e-9) * st);
            b = MCP.charts.clean(a + st * count);
            if (b >= b0 - 1e-9 * Math.max(1, Math.abs(b0))) { break; }
            st = MCP.charts.niceStep(st * 1.0001, fixed);
        }
        var score = (b - a) * (count === 3 && !fixed ? 1.1 : 1);
        if (!best || score < bestScore - 1e-9 * Math.max(1, bestScore)) { best = { min: a, max: b, step: st, steps: count }; bestScore = score; }
    }
    return best;
};

/** Steps for a fixed axis: the first of 4, 5, 6, 3, 2 whose step is a round number. */
MCP.charts.stepsFor = function (lo, hi) {
    var cands = [4, 5, 6, 3, 2];
    for (var i = 0; i < cands.length; i++) {
        var st = (hi - lo) / cands[i];
        if (Math.abs(MCP.charts.niceStep(st) - st) <= 1e-9 * Math.max(1, Math.abs(st))) { return cands[i]; }
    }
    return 4;
};

/** The power of ten that keeps every value inside the slider range. */
MCP.charts.scaleFor = function (values) {
    var m = 0, i;
    for (i = 0; i < values.length; i++) { m = Math.max(m, Math.abs(Number(values[i]) || 0)); }
    var s = 1;
    while (m / s >= MCP.charts.SLIDER_LIMIT && s < 1e15) { s *= 10; }
    return s;
};

/** Decimals the data itself shows, at most 2. */
MCP.charts.dataDecimals = function (values) {
    var d = 0;
    for (var i = 0; i < values.length; i++) {
        var s = String(MCP.charts.clean(Math.abs(Number(values[i]) || 0)));
        var dot = s.indexOf(".");
        if (s.indexOf("e") < 0 && dot >= 0) { d = Math.max(d, s.length - dot - 1); }
    }
    return Math.min(2, d);
};

MCP.charts.mix = function (a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
};

MCP.charts.luma = function (c) {
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

/** Text colour on top of a fill: near-black on light fills, white otherwise. */
MCP.charts.onColor = function (fill) {
    return MCP.charts.luma(fill) > 0.6 ? MCP.color.rgba("#111110") : [1, 1, 1, 1];
};

MCP.charts.rgba = function (value, fallback) {
    return MCP.color.rgba(MCP.isDefined(value) ? value : fallback);
};

/** Baseline offset that centres a line of text on a point, and the cap height. */
MCP.charts.capOff = function (fs) { return Math.round(fs * 0.36 * 100) / 100; };
MCP.charts.capH = function (fs) { return Math.round(fs * 0.72 * 100) / 100; };

/* ---------------------------------------------------------- formats, data */

/** Normalises a format spec: {decimals, prefix, suffix, sep, mark, compact}. */
MCP.charts.fmt = function (spec, defaults) {
    var s = spec || {}, d = defaults || {};
    var sep = MCP.isDefined(s.thousands) ? s.thousands : (MCP.isDefined(d.thousands) ? d.thousands : true);
    if (sep === true) { sep = ","; }
    if (sep === false || sep === null) { sep = ""; }
    var compact = MCP.bool(s.compact, MCP.bool(d.compact, false));
    var dec = MCP.isDefined(s.decimals) ? s.decimals : (compact ? 1 : (MCP.isDefined(d.decimals) ? d.decimals : 0));
    return {
        decimals: Math.max(0, Math.min(6, Math.round(Number(dec) || 0))),
        prefix: String(MCP.isDefined(s.prefix) ? s.prefix : (MCP.isDefined(d.prefix) ? d.prefix : "")),
        suffix: String(MCP.isDefined(s.suffix) ? s.suffix : (MCP.isDefined(d.suffix) ? d.suffix : "")),
        sep: String(sep),
        mark: String(MCP.isDefined(s.decimalMark) ? s.decimalMark : (MCP.isDefined(d.decimalMark) ? d.decimalMark : ".")),
        compact: compact
    };
};

MCP.charts.fmtOut = function (f) {
    return { decimals: f.decimals, prefix: f.prefix, suffix: f.suffix, thousands: f.sep, decimalMark: f.mark, compact: f.compact };
};

/** Tick format: the value format's prefix, suffix and marks; compact from 10,000 unless the caller chose. */
MCP.charts.tickFmt = function (args, fmt, magnitude) {
    var chosen = args.format && MCP.isDefined(args.format.compact);
    return MCP.charts.fmt({ prefix: fmt.prefix, suffix: fmt.suffix, thousands: fmt.sep, decimalMark: fmt.mark, compact: chosen ? !!args.format.compact : magnitude >= 10000 }, {});
};

/** Formats a number in the bridge exactly as the expressions do. */
MCP.charts.format = function (f, value) {
    return MCP.charts.compile(MCP.charts.fmtSrc(f, "cs_fmt"), "cs_fmt")(value);
};

/** A slider name for a label: at most 31 characters, unique among taken (lower-case keys). */
MCP.charts.effectName = function (label, taken) {
    var max = MCP.charts.NAME_MAX;
    var base = label.length > max ? label.substring(0, max - 3) + "..." : label;
    var name = base, k = 2;
    while (taken[name.toLowerCase()]) {
        var tail = " " + k;
        name = (base.length + tail.length > max ? base.substring(0, max - tail.length) : base) + tail;
        k++;
    }
    taken[name.toLowerCase()] = true;
    return name;
};

/**
 * Checks data and names a slider for each item:
 * [{label, value, color (rgba or null), effect}]. opts: {min, max, nonNegative, reserved[]}.
 */
MCP.charts.dataItems = function (data, opts) {
    var o = opts || {};
    if (!MCP.isArray(data) || !data.length) { MCP.fail("data needs at least one {label, value}. Give data or dataFile.", "invalid-argument"); }
    if (data.length < (o.min || 1)) { MCP.fail("This chart needs at least " + o.min + " values; data has " + data.length + ".", "invalid-argument"); }
    if (o.max && data.length > o.max) { MCP.fail("data has " + data.length + " values; this chart takes at most " + o.max + ".", "invalid-argument"); }
    var taken = {}, labels = {}, out = [], i;
    var reserved = o.reserved || [];
    for (i = 0; i < reserved.length; i++) { taken[reserved[i].toLowerCase()] = true; }
    for (i = 0; i < data.length; i++) {
        var d = data[i] || {};
        var label = MCP.isDefined(d.label) ? String(d.label) : "";
        if (!label.replace(/\s+/g, "")) { MCP.fail("data[" + i + "] needs a label.", "invalid-argument"); }
        if (labels[label.toLowerCase()]) { MCP.fail("Label '" + label + "' appears twice. Labels name the sliders, so each must be unique.", "invalid-argument"); }
        labels[label.toLowerCase()] = true;
        var v = Number(d.value);
        if (!MCP.isDefined(d.value) || !isFinite(v)) { MCP.fail("data[" + i + "] ('" + label + "') needs a finite number value.", "invalid-argument"); }
        if (o.nonNegative && v < 0) { MCP.fail("'" + label + "' is " + v + ". This chart shows amounts, so values must be 0 or more.", "invalid-argument"); }
        out.push({ label: label, value: v, color: MCP.isDefined(d.color) ? MCP.color.rgba(d.color) : null, effect: MCP.charts.effectName(label, taken) });
    }
    return out;
};

MCP.charts.values = function (items) {
    var out = [];
    for (var i = 0; i < items.length; i++) { out.push(items[i].value); }
    return out;
};

MCP.charts.labelList = function (items) {
    var out = [];
    for (var i = 0; i < items.length && i < 40; i++) { out.push(items[i].label); }
    return out.join(", ");
};

/* -------------------------------------------------------------- theme */

/** The colour behind the chart: a full-frame solid without effects at the bottom of the stack, or null. */
MCP.charts.backdrop = function (comp) {
    for (var i = comp.numLayers; i >= 1; i--) {
        var L = comp.layer(i);
        if (!_mcpTry(function () { return L.enabled; }, false)) { continue; }
        if (L instanceof CameraLayer || L instanceof LightLayer) { continue; }
        if (_mcpTry(function () { return L.nullLayer || L.adjustmentLayer || L.guideLayer; }, false)) { continue; }
        if (!(L instanceof AVLayer)) { return null; }
        if (_mcpTry(function () { return L.hasVideo === false; }, false)) { continue; }
        var src = _mcpTry(function () { return L.source; }, null);
        var main = src ? _mcpTry(function () { return src.mainSource; }, null) : null;
        if (!main || !(main instanceof SolidSource)) { return null; }
        if (_mcpTry(function () { return L.property("ADBE Effect Parade").numProperties; }, 0) > 0) { return null; }
        if (src.width < comp.width * 0.9 || src.height < comp.height * 0.9) { return null; }
        return { color: main.color, source: "solid '" + L.name + "'" };
    }
    return null;
};

/** Colours for the chart: {name, source, ink, ink2, muted, grid, axis, surface, accent, up, down, palette[]}. */
MCP.charts.theme = function (comp, args) {
    var want = String(MCP.arg(args, "theme", "auto")).toLowerCase();
    var bg = null, source = "theme " + want;
    if (want === "auto") {
        var b = MCP.charts.backdrop(comp);
        if (b) { bg = MCP.color.rgba(b.color); source = b.source; }
        else { bg = MCP.color.rgba(_mcpTry(function () { return comp.bgColor; }, [0, 0, 0])); source = "the composition background colour"; }
        want = MCP.charts.luma(bg) < 0.5 ? "dark" : "light";
    }
    var base = MCP.charts.THEMES[want];
    if (!base) { MCP.fail("theme must be auto, light or dark.", "invalid-argument"); }
    var R = MCP.charts.rgba;
    var palette = [], i;
    var src = MCP.isArray(args.palette) && args.palette.length ? args.palette : base.palette;
    for (i = 0; i < src.length; i++) { palette.push(MCP.color.rgba(src[i])); }
    return {
        name: want, source: source,
        ink: R(args.textColor, base.ink), ink2: R(args.labelColor, base.ink2), muted: R(args.labelColor, base.muted),
        grid: R(args.gridColor, base.grid), axis: R(args.axisColor, base.axis),
        surface: bg || R(null, base.surface),
        accent: R(args.accent, base.accent), up: R(args.upColor, base.up), down: R(args.downColor, base.down),
        palette: palette
    };
};

/**
 * One colour per item. mode accent (every item the accent), palette (the
 * palette in fixed order), shades (the accent stepped toward the background).
 * highlight [labels] paints those in the accent and the rest in a neutral.
 * An item's own color always wins.
 */
MCP.charts.colorsFor = function (ctx, items, args, defMode) {
    var mode = String(MCP.arg(args, "colorMode", defMode));
    if (mode !== "accent" && mode !== "palette" && mode !== "shades") { MCP.fail("colorMode must be accent, palette or shades.", "invalid-argument"); }
    var th = ctx.th, n = items.length, out = [], i, j;
    var hl = null;
    if (MCP.isArray(args.highlight) && args.highlight.length) {
        hl = {};
        for (i = 0; i < args.highlight.length; i++) {
            var want = String(args.highlight[i]), found = false;
            for (j = 0; j < n; j++) { if (items[j].label === want) { found = true; hl[want] = true; } }
            if (!found) { MCP.fail("highlight '" + want + "' is not one of the labels: " + MCP.charts.labelList(items) + ".", "invalid-argument"); }
        }
    }
    var neutral = MCP.isDefined(args.mutedColor) ? MCP.color.rgba(args.mutedColor) : MCP.charts.mix(th.muted, th.surface, 0.45);
    if (mode === "palette" && n > th.palette.length && !hl) {
        ctx.notes.push("There are " + n + " items and " + th.palette.length + " palette colours, so colours repeat. Group small items into an \"Other\" item, or use highlight.");
    }
    for (i = 0; i < n; i++) {
        var c;
        if (items[i].color) { c = items[i].color; }
        else if (hl) { c = hl[items[i].label] ? th.accent : neutral; }
        else if (mode === "palette") { c = th.palette[i % th.palette.length]; }
        else if (mode === "shades") { c = n > 1 ? MCP.charts.mix(th.accent, th.surface, 0.72 * i / (n - 1)) : th.accent; }
        else { c = th.accent; }
        out.push(c);
    }
    return { colors: out, mode: hl ? "highlight" : mode };
};

MCP.charts.hexList = function (colors) {
    var out = [];
    for (var i = 0; i < colors.length; i++) { out.push(MCP.color.toHex(colors[i])); }
    return out;
};

/* ------------------------------------------------------- build context */

MCP.charts.nameTaken = function (comp, base) {
    var pre = base + " / ";
    for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name.indexOf(pre) === 0) { return true; }
    }
    return false;
};

MCP.charts.compNamed = function (name) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof CompItem && it.name === name) { return it; }
    }
    return null;
};

/**
 * Checks the shared arguments and returns the build context. Nothing is
 * changed yet: every check that can fail runs before the first layer is made.
 */
MCP.charts.begin = function (comp, args, type, defName) {
    var explicit = MCP.isDefined(args.name);
    var base = explicit ? String(args.name) : defName;
    if (!base.replace(/\s+/g, "")) { MCP.fail("name must not be empty.", "invalid-argument"); }
    if (MCP.charts.nameTaken(comp, base)) {
        if (explicit) {
            MCP.fail("A chart named '" + base + "' already exists in '" + comp.name + "' (its layers start with '" + base + " / '). Pick another name, or change its values with update-chart-data.", "invalid-argument");
        }
        var k = 2;
        while (MCP.charts.nameTaken(comp, defName + " " + k)) { k++; }
        base = defName + " " + k;
    }
    var componentName = null;
    if (args.component) {
        MCP.requireVersion(16.1, "Essential Properties by script");
        var spec = typeof args.component === "object" ? args.component : {};
        componentName = MCP.isDefined(spec.name) ? String(spec.name) : base;
        if (MCP.charts.compNamed(componentName)) {
            if (MCP.isDefined(spec.name)) { MCP.fail("A composition named '" + componentName + "' already exists. Pick another component name.", "invalid-argument"); }
            var c = 2;
            while (MCP.charts.compNamed(componentName + " " + c)) { c++; }
            componentName = componentName + " " + c;
        }
    }
    if (MCP.isDefined(args.easing)) { MCP.easing.resolve(args.easing); }
    var th = MCP.charts.theme(comp, args);
    return {
        comp: comp, type: type, base: base, ctrlName: base + " / Controls",
        th: th, k: MCP.clamp(comp.height / 1080, 0.4, 4), fd: MCP.frameDuration(comp),
        font: MCP.isDefined(args.font) ? String(args.font) : null,
        numberFont: MCP.isDefined(args.numberFont) ? String(args.numberFont) : (MCP.isDefined(args.font) ? String(args.font) : null),
        componentName: componentName,
        dataSource: MCP.isDefined(args.dataSource) ? args.dataSource : null,
        nul: null, layers: [], errors: [], exprCount: 0, keyCount: 0, notes: [], fontNote: false,
        evalTime: 0, end: 0
    };
};

/** Start, duration, stagger and easing from the shared timing arguments. */
MCP.charts.timing = function (ctx, args, d) {
    var comp = ctx.comp, fd = ctx.fd;
    var t0 = MCP.snapToFrame(comp, MCP.durationArg(comp, args, "startTime", "startFrame", 0));
    var dur = MCP.durationArg(comp, args, "duration", "durationFrames", d.duration);
    if (!(Number(dur) > 0)) { MCP.fail("duration must be greater than 0.", "invalid-argument"); }
    dur = Math.max(fd, MCP.snapToFrame(comp, Number(dur)));
    var sf = MCP.isDefined(args.staggerFrames) ? Math.max(0, Math.round(Number(args.staggerFrames))) : Math.max(1, Math.round(MCP.num(d.stagger, 0.07) / fd));
    var custom = MCP.isDefined(args.easing);
    ctx.end = t0;
    return {
        t0: t0, dur: dur, staggerFrames: sf, stagger: sf * fd,
        easing: custom ? args.easing : (d.easing || MCP.charts.EASE_LAND),
        easingText: custom ? args.easing : (d.easingText || MCP.charts.LAND_TEXT),
        animate: MCP.bool(args.animate, true)
    };
};

MCP.charts.position = function (comp, args) {
    return MCP.isArray(args.position) ? [Number(args.position[0]), Number(args.position[1])] : [comp.width / 2, comp.height / 2];
};

MCP.charts.size = function (args, fallback) {
    if (!MCP.isArray(args.size)) { return fallback; }
    var w = Number(args.size[0]), h = Number(args.size[1]);
    if (!(w > 0) || !(h > 0)) { MCP.fail("size must be [width, height] in pixels, both greater than 0.", "invalid-argument"); }
    return [w, h];
};

MCP.charts.evalAt = function (ctx, t) {
    ctx.evalTime = Math.max(0, Math.min(ctx.comp.duration - ctx.fd, t));
};

/* ------------------------------------------------------------ layer makers */

MCP.charts.tagLayer = function (ctx, L, role, label) {
    try { L.label = MCP.enums.labelIndex(MCP.charts.LABEL_COLOR); } catch (e) {}
    ctx.layers.push({ role: role, label: MCP.isDefined(label) ? label : null, layer: L });
};

/** The control null at pos, anchor at its origin, named "<chart> / Controls". */
MCP.charts.newNull = function (ctx, pos) {
    var comp = ctx.comp;
    var nul = comp.layers.addNull(comp.duration);
    nul.name = ctx.ctrlName;
    try { nul.startTime = 0; } catch (e0) {}
    var tg = nul.property("ADBE Transform Group");
    tg.property("ADBE Anchor Point").setValue([0, 0]);
    tg.property("ADBE Position").setValue([pos[0], pos[1]]);
    ctx.nul = nul;
    MCP.charts.tagLayer(ctx, nul, "controls", null);
    return nul;
};

/** A shape layer parented to the control null whose contents use the null's space. */
MCP.charts.newShape = function (ctx, part, role, label) {
    var L = ctx.comp.layers.addShape();
    L.name = ctx.base + " / " + part;
    L.parent = ctx.nul;
    var tg = L.property("ADBE Transform Group");
    tg.property("ADBE Anchor Point").setValue([0, 0]);
    tg.property("ADBE Position").setValue([0, 0]);
    MCP.charts.tagLayer(ctx, L, role, label);
    return L;
};

/**
 * A point text layer parented to the control null at pos (null space).
 * st: {size, color, justify, font, leading}.
 */
MCP.charts.newText = function (ctx, part, role, label, text, st, pos) {
    var L = ctx.comp.layers.addText(String(text));
    L.name = ctx.base + " / " + part;
    var prop = L.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = prop.value;
    doc.fontSize = st.size;
    doc.applyFill = true;
    doc.fillColor = [st.color[0], st.color[1], st.color[2]];
    doc.applyStroke = false;
    doc.justification = MCP.justificationValue(st.justify || "center");
    if (st.font) { doc.font = st.font; }
    if (MCP.isDefined(st.leading)) { doc.autoLeading = false; doc.leading = st.leading; }
    prop.setValue(doc);
    if (st.font && !ctx.fontNote) {
        var got = _mcpTry(function () { return String(L.property("ADBE Text Properties").property("ADBE Text Document").value.font); }, "");
        if (got && got !== st.font) {
            ctx.fontNote = true;
            ctx.notes.push("Font '" + st.font + "' is not installed or not a PostScript name; After Effects used '" + got + "'.");
        }
    }
    L.parent = ctx.nul;
    var tg = L.property("ADBE Transform Group");
    tg.property("ADBE Anchor Point").setValue([0, 0]);
    tg.property("ADBE Position").setValue([pos[0], pos[1]]);
    MCP.charts.tagLayer(ctx, L, role, label);
    return L;
};

MCP.charts.opacity = function (L) {
    return L.property("ADBE Transform Group").property("ADBE Opacity");
};

MCP.charts.sourceText = function (L) {
    return L.property("ADBE Text Properties").property("ADBE Text Document");
};

/** Adds Slider Controls named in specs [{name, value}], then sets every value (references go stale after each add). */
MCP.charts.addSliders = function (L, specs) {
    var i;
    for (i = 0; i < specs.length; i++) {
        var fx = MCP.effectsGroup(L).addProperty("ADBE Slider Control");
        fx.name = specs[i].name;
    }
    for (i = 0; i < specs.length; i++) { MCP.charts.slider(L, specs[i].name).setValue(specs[i].value); }
};

/** An effect parameter by effect name (exact first) and parameter match name. */
MCP.charts.effectProp = function (L, name, paramMatch) {
    var g = MCP.effectsGroup(L), fx = null, i;
    for (i = 1; i <= g.numProperties; i++) { if (g.property(i).name === name) { fx = g.property(i); break; } }
    if (!fx) { fx = MCP.childProp(g, name); }
    if (!fx) { MCP.fail("Effect '" + name + "' not found on '" + L.name + "'.", "not-found", { effects: MCP.childNames(g) }); }
    var p = _mcpTry(function () { return fx.property(paramMatch); }, null);
    if (!p) { p = _mcpTry(function () { return fx.property(1); }, null); }
    if (!p) { MCP.fail("Effect '" + name + "' on '" + L.name + "' has no parameter " + paramMatch + ".", "script-error"); }
    return p;
};

MCP.charts.slider = function (L, name) {
    return MCP.charts.effectProp(L, name, "ADBE Slider Control-0001");
};

/* Shape contents. Groups live at the root; every reference is fetched fresh. gname null means the root. */

MCP.charts.root = function (L) {
    return L.property("ADBE Root Vectors Group");
};

MCP.charts.addGroup = function (L, name) {
    var g = MCP.charts.root(L).addProperty("ADBE Vector Group");
    g.name = name;
    return name;
};

MCP.charts.groupItems = function (L, gname) {
    return gname === null ? MCP.charts.root(L) : MCP.charts.root(L).property(gname).property("ADBE Vectors Group");
};

MCP.charts.addItem = function (L, gname, matchName, itemName) {
    var it = MCP.charts.groupItems(L, gname).addProperty(matchName);
    it.name = itemName;
    return itemName;
};

MCP.charts.item = function (L, gname, itemName) {
    return MCP.charts.groupItems(L, gname).property(itemName);
};

MCP.charts.groupXf = function (L, gname, matchName) {
    return MCP.charts.root(L).property(gname).property("ADBE Vector Transform Group").property(matchName);
};

MCP.charts.addPath = function (L, gname, itemName, shape) {
    MCP.charts.addItem(L, gname, "ADBE Vector Shape - Group", itemName);
    MCP.charts.item(L, gname, itemName).property("ADBE Vector Shape").setValue(shape);
};

MCP.charts.addFill = function (L, gname, color, opacity) {
    MCP.charts.addItem(L, gname, "ADBE Vector Graphic - Fill", "Fill");
    MCP.charts.item(L, gname, "Fill").property("ADBE Vector Fill Color").setValue(color);
    if (MCP.isDefined(opacity)) { MCP.charts.item(L, gname, "Fill").property("ADBE Vector Fill Opacity").setValue(opacity); }
};

/** cap: 1 butt, 2 round, 3 projecting. join: 1 miter, 2 round, 3 bevel. */
MCP.charts.addStroke = function (L, gname, color, width, cap, join, itemName) {
    var nm = itemName || "Stroke";
    MCP.charts.addItem(L, gname, "ADBE Vector Graphic - Stroke", nm);
    var s = function () { return MCP.charts.item(L, gname, nm); };
    s().property("ADBE Vector Stroke Color").setValue(color);
    s().property("ADBE Vector Stroke Width").setValue(width);
    try { s().property("ADBE Vector Stroke Line Cap").setValue(cap || 1); } catch (e1) {}
    try { s().property("ADBE Vector Stroke Line Join").setValue(join || 2); } catch (e2) {}
};

MCP.charts.addTrim = function (L, gname, itemName) {
    MCP.charts.addItem(L, gname, "ADBE Vector Filter - Trim", itemName);
    try { MCP.charts.item(L, gname, itemName).property("ADBE Vector Trim Type").setValue(1); } catch (e) {}
};

MCP.charts.trimProp = function (L, gname, itemName, which) {
    var mn = which === "start" ? "ADBE Vector Trim Start" : (which === "offset" ? "ADBE Vector Trim Offset" : "ADBE Vector Trim End");
    return MCP.charts.item(L, gname, itemName).property(mn);
};

/** A circle Shape centred on 0,0 that starts at 12 o'clock and runs clockwise. */
MCP.charts.circle = function (r) {
    return MCP.masks.ellipseShape(0, 0, r, r);
};

MCP.charts.line = function (a, b) {
    return MCP.shape.pathFromPoints([a, b], false);
};

/** A small triangle pointing up, centred on 0,0 (rotate 180 for down). */
MCP.charts.triangle = function (s) {
    return MCP.shape.pathFromPoints([[0, -s * 0.5], [s * 0.56, s * 0.42], [-s * 0.56, s * 0.42]], true);
};

/* ------------------------------------------------------- expressions, keys */

/** Sets an expression, evaluates it once and records any After Effects error. */
MCP.charts.expr = function (ctx, L, prop, code, label) {
    try {
        prop.expression = code;
        try { prop.expressionEnabled = true; } catch (e0) {}
        try { prop.valueAtTime(ctx.evalTime, false); } catch (e1) {}
        var err = _mcpTry(function () { return prop.expressionError || ""; }, "");
        if (err) { ctx.errors.push({ layer: L.name, property: label, error: String(err) }); }
    } catch (e) {
        ctx.errors.push({ layer: L.name, property: label, error: e.toString() });
    }
    ctx.exprCount++;
};

/** Two eased keys: v0 at t0, v1 at t1, easing on the arrival. */
MCP.charts.keyPair = function (ctx, prop, t0, v0, t1, v1, easing) {
    MCP.easing.setKey(prop, t0, v0);
    var i1 = MCP.easing.setKey(prop, t1, v1);
    MCP.easing.applySegment(prop, i1, easing || MCP.charts.EASE_LAND);
    ctx.keyCount += 2;
};

/** Keys an intro (2 keys), or sets the end value when the chart is not animated. */
MCP.charts.intro = function (ctx, tm, prop, t0, v0, dur, v1, easing) {
    if (!tm.animate) { prop.setValue(v1); return; }
    var t1 = MCP.snapToFrame(ctx.comp, t0 + dur);
    if (t1 <= t0) { t1 = t0 + ctx.fd; }
    MCP.charts.keyPair(ctx, prop, t0, v0, t1, v1, easing || tm.easing);
    if (t1 > ctx.end) { ctx.end = t1; }
};

MCP.charts.ctrlRef = function (ctx) {
    return "var C = thisComp.layer(" + MCP.charts.q(ctx.ctrlName) + ");\n";
};

MCP.charts.sliderRef = function (name) {
    return "C.effect(" + MCP.charts.q(name) + ")(1).value";
};

MCP.charts.growRef = function (L) {
    return "thisComp.layer(" + MCP.charts.q(L.name) + ").effect(\"Grow\")(1).value";
};

/* ------------------------------------------------------- meta, results */

MCP.charts.saveMeta = function (ctx, meta) {
    meta.v = MCP.charts.META_VERSION;
    meta.type = ctx.type;
    meta.name = ctx.base;
    ctx.nul.comment = MCP.charts.TAG + JSON.stringify(meta);
};

MCP.charts.readMeta = function (L) {
    var c = _mcpTry(function () { return String(L.comment); }, "");
    if (c.indexOf(MCP.charts.TAG) !== 0) { return null; }
    try {
        var m = JSON.parse(c.substring(MCP.charts.TAG.length));
        return (m && typeof m === "object" && MCP.isArray(m.items)) ? m : null;
    } catch (e) {
        return null;
    }
};

MCP.charts.itemsMeta = function (items) {
    var out = [];
    for (var i = 0; i < items.length; i++) { out.push({ label: items[i].label, effect: items[i].effect }); }
    return out;
};

/** The controls a caller can edit: [{label, effect, value, sliderValue, property, expression}]. */
MCP.charts.controlsOut = function (ctx, list, scale) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
        out.push({
            label: list[i].label, effect: list[i].effect,
            value: MCP.round(list[i].value), sliderValue: MCP.round(list[i].value / scale),
            property: "Effects/" + list[i].effect + "/Slider",
            expression: "thisComp.layer(" + MCP.charts.q(ctx.ctrlName) + ").effect(" + MCP.charts.q(list[i].effect) + ")(1)"
        });
    }
    return out;
};

MCP.charts.layerRefOf = function (L) {
    var id = _mcpTry(function () { return L.id; }, null);
    return MCP.isDefined(id) ? { id: id } : { index: L.index };
};

/** Precomposes the chart into a component with the data sliders as Essential Properties (labelled by slider name). */
MCP.charts.wrap = function (ctx, args, controls) {
    if (!ctx.componentName) { return null; }
    var refs = [], i;
    for (i = 0; i < ctx.layers.length; i++) { refs.push(MCP.charts.layerRefOf(ctx.layers[i].layer)); }
    var props = [];
    for (i = 0; i < controls.length; i++) {
        props.push({ layer: ctx.ctrlName, path: ["ADBE Effect Parade", controls[i].effect, "ADBE Slider Control-0001"], label: controls[i].effect });
    }
    var cargs = { comp: { id: ctx.comp.id }, layers: refs, name: ctx.componentName, properties: props, cropToContent: true, padding: Math.round(32 * ctx.k) };
    var spec = typeof args.component === "object" ? args.component : {};
    if (MCP.isDefined(spec.templateName)) { cargs.templateName = spec.templateName; }
    return MCP.invoke("createComponent", cargs);
};

/** The shared part of every create result. Layer references are taken before any precompose. */
MCP.charts.result = function (ctx, extra) {
    var layers = [], i;
    for (i = 0; i < ctx.layers.length; i++) {
        var e = ctx.layers[i];
        layers.push({ role: e.role, label: e.label, layer: MCP.serialize.layerRef(e.layer) });
    }
    var out = {
        composition: MCP.serialize.compRef(ctx.comp),
        chart: { name: ctx.base, type: ctx.type, controls: ctx.ctrlName, layerCount: layers.length, theme: { name: ctx.th.name, from: ctx.th.source } },
        layers: layers,
        dataSource: ctx.dataSource,
        expressions: { count: ctx.exprCount, errors: ctx.errors },
        keyframes: ctx.keyCount,
        notes: ctx.notes
    };
    return MCP.extend(out, extra || {});
};

MCP.charts.animOut = function (ctx, tm, extra) {
    if (!tm.animate) { return null; }
    var out = {
        startTime: MCP.round(tm.t0), endTime: MCP.round(ctx.end),
        startFrame: MCP.frameOf(ctx.comp, tm.t0), endFrame: MCP.frameOf(ctx.comp, ctx.end),
        duration: MCP.round(tm.dur), staggerFrames: tm.staggerFrames, easing: tm.easingText
    };
    if (ctx.end > ctx.comp.duration + 1e-6) {
        ctx.notes.push("The animation ends at " + MCP.round(ctx.end) + " s, after the composition ends (" + MCP.round(ctx.comp.duration) + " s).");
    }
    return MCP.extend(out, extra || {});
};

/* ---------------------------------------------------------------- axis */

/**
 * The value axis: {min, max, step, steps, autoMax, minMode}. lo and hi are the
 * data range. minMode zero (default: 0, or lower when the data goes below 0),
 * auto (fitted to the data; line charts) or fixed (args.min).
 */
MCP.charts.axisFor = function (args, lo, hi, allowMin) {
    var maxArg = MCP.isDefined(args.max) ? Number(args.max) : null;
    var minArg = allowMin && MCP.isDefined(args.min) ? args.min : null;
    var mode = minArg === null ? "zero" : (minArg === "auto" ? "auto" : "fixed");
    var a = mode === "fixed" ? Number(minArg) : (mode === "auto" ? lo : Math.min(0, lo));
    var steps = MCP.isDefined(args.steps) ? Math.max(1, Math.round(Number(args.steps))) : null;
    var s, st;
    if (maxArg !== null) {
        if (!(maxArg > a)) { MCP.fail("max (" + maxArg + ") must be greater than the axis minimum (" + a + ").", "invalid-argument"); }
        if (mode !== "fixed" && !(mode === "zero" && a === 0)) {
            var count0 = steps || 4;
            var st0 = MCP.charts.niceStep((maxArg - a) / count0, true);
            a = MCP.charts.clean(Math.floor(a / st0 + 1e-9) * st0);
        }
        var count = steps || MCP.charts.stepsFor(a, maxArg);
        s = { min: a, max: maxArg, step: MCP.charts.clean((maxArg - a) / count), steps: count };
    } else if (mode === "fixed") {
        var ns0 = MCP.charts.niceScale(a, hi, steps);
        st = MCP.charts.niceStep((Math.max(hi, a + 1e-9) - a) / ns0.steps, true);
        s = { min: a, max: MCP.charts.clean(a + st * ns0.steps), step: st, steps: ns0.steps };
    } else {
        s = MCP.charts.niceScale(a, hi, steps);
    }
    s.autoMax = maxArg === null;
    s.minMode = mode;
    return s;
};

/** The axis after the data changed: the same step count and min rule. Returns {min, max}. */
MCP.charts.rescale = function (axisMeta, lo, hi, cur) {
    var mode = axisMeta.minMode || "zero";
    var steps = axisMeta.steps || 4;
    var a = mode === "fixed" ? cur.min : (mode === "auto" ? lo : Math.min(0, lo));
    if (!axisMeta.autoMax) {
        if (mode === "fixed" || !(cur.max > a)) { return { min: cur.min, max: cur.max }; }
        if (mode === "zero" && a === 0) { return { min: 0, max: cur.max }; }
        var st0 = MCP.charts.niceStep((cur.max - a) / steps, true);
        return { min: MCP.charts.clean(Math.floor(a / st0 + 1e-9) * st0), max: cur.max };
    }
    if (mode === "fixed") {
        var st = MCP.charts.niceStep((Math.max(hi, a + 1e-9) - a) / steps, true);
        return { min: a, max: MCP.charts.clean(a + st * steps) };
    }
    var ns = MCP.charts.niceScale(a, hi, steps);
    return { min: ns.min, max: ns.max };
};

/** Grid line k of steps, in the null's space. */
MCP.charts.gridLine = function (g, k, steps) {
    if (g.valueAxis === "y") {
        var y = g.base - k * g.H / steps;
        return MCP.charts.line([g.left, y], [g.right, y]);
    }
    var x = g.left + k * g.W / steps;
    return MCP.charts.line([x, g.base], [x, g.top]);
};

/** Gridlines and the axis line on one shape layer, drawn on by one Trim Paths. Returns the layer or null. */
MCP.charts.buildGrid = function (ctx, g, axis, showGrid, showAxis, zeroK) {
    if (!showGrid && !showAxis) { return null; }
    var L = MCP.charts.newShape(ctx, "Grid", "grid", null);
    var w = Math.max(1, Math.round(2 * ctx.k)), k, any = false;
    if (showGrid) {
        for (k = 0; k <= axis.steps; k++) { if (!(showAxis && k === zeroK)) { any = true; } }
    }
    if (any) {
        MCP.charts.addGroup(L, "Gridlines");
        for (k = 0; k <= axis.steps; k++) {
            if (showAxis && k === zeroK) { continue; }
            MCP.charts.addPath(L, "Gridlines", "Line " + k, MCP.charts.gridLine(g, k, axis.steps));
        }
        MCP.charts.addStroke(L, "Gridlines", ctx.th.grid, w, 1, 1);
    }
    if (showAxis) {
        MCP.charts.addGroup(L, "Axis");
        MCP.charts.addPath(L, "Axis", "Line", MCP.charts.gridLine(g, zeroK, axis.steps));
        MCP.charts.addStroke(L, "Axis", ctx.th.axis, w, 1, 1);
    }
    MCP.charts.addTrim(L, null, "Draw On");
    return L;
};

/** One text layer per tick: [{layer, k}]. Their text follows the live axis range by expression. */
MCP.charts.buildTicks = function (ctx, g, axis, tickFmt, size) {
    var out = [], k;
    var gap = Math.round(14 * ctx.k);
    var tickFn = MCP.charts.compile(MCP.charts.tickSrc(tickFmt), "cs_tick");
    var mag = Math.max(Math.abs(axis.max), Math.abs(axis.min));
    for (k = 0; k <= axis.steps; k++) {
        var pos, just;
        if (g.valueAxis === "y") {
            pos = [g.left - gap, g.base - k * g.H / axis.steps + MCP.charts.capOff(size)];
            just = "right";
        } else {
            pos = [g.left + k * g.W / axis.steps, g.base + gap + MCP.charts.capH(size)];
            just = "center";
        }
        var v = axis.min + (axis.max - axis.min) * k / axis.steps;
        var L = MCP.charts.newText(ctx, "Tick " + k, "tick", null, tickFn(v, axis.step, mag), { size: size, color: ctx.th.muted, justify: just, font: ctx.font }, pos);
        out.push({ layer: L, k: k });
    }
    return out;
};

MCP.charts.tickExpr = function (ctx, tickFmt, k, steps, scale, hasMin) {
    var S = MCP.charts.n(scale);
    return "// " + ctx.base + ": axis label " + k + " of " + steps + ", follows Axis Max" + (hasMin ? " and Axis Min" : "") + "\n" +
        MCP.charts.ctrlRef(ctx) +
        "var mx = " + MCP.charts.sliderRef("Axis Max") + " * " + S + ";\n" +
        "var mn = " + (hasMin ? MCP.charts.sliderRef("Axis Min") + " * " + S : "0") + ";\n" +
        MCP.charts.tickSrc(tickFmt) +
        "cs_tick(mn + (mx - mn) * " + k + " / " + steps + ", (mx - mn) / " + steps + ", Math.max(Math.abs(mx), Math.abs(mn)));";
};

MCP.charts.tickIntro = function (ctx, tm, ticks, t0) {
    var dur = Math.max(ctx.fd, MCP.snapToFrame(ctx.comp, 0.35));
    for (var i = 0; i < ticks.length; i++) {
        MCP.charts.intro(ctx, tm, MCP.charts.opacity(ticks[i].layer), MCP.snapToFrame(ctx.comp, t0 + i * ctx.fd), 0, dur, 100, MCP.charts.EASE_LAND);
    }
};

/* ---------------------------------------------------------------- bar chart */

/** Band layout along the category axis: {band, bw, gap, centers[], span}. */
MCP.charts.bandLayout = function (len, n, barWidth, gap, k, notes) {
    var band, bw, g, centers = [], i;
    if (MCP.isDefined(barWidth) && MCP.isDefined(gap)) {
        bw = Number(barWidth);
        g = Number(gap);
        band = bw + g;
        var span = n * bw + (n - 1) * g;
        for (i = 0; i < n; i++) { centers.push(-span / 2 + i * band + bw / 2); }
        if (span > len + 0.5) { notes.push("barWidth and gap make the bars " + MCP.round(span, 1) + " px across, wider than the plot (" + MCP.round(len, 1) + " px)."); }
        return { band: band, bw: bw, gap: g, centers: centers, span: span };
    }
    band = len / n;
    if (MCP.isDefined(barWidth)) {
        bw = Number(barWidth);
        if (bw > band) { notes.push("barWidth " + bw + " is wider than each category's space (" + MCP.round(band, 1) + " px), so it was reduced."); bw = band; }
    } else if (MCP.isDefined(gap)) {
        bw = Math.max(1, band - Number(gap));
    } else {
        bw = Math.min(band * 0.64, Math.max(24 * k, len * 0.18));
    }
    g = band - bw;
    for (i = 0; i < n; i++) { centers.push(-len / 2 + band * (i + 0.5)); }
    return { band: band, bw: bw, gap: g, centers: centers, span: len };
};

/** Shared expression header for one bar: C, v, m, g and h (the bar length in pixels). */
MCP.charts.barHead = function (ctx, item, growRef, len) {
    return MCP.charts.ctrlRef(ctx) +
        "var v = Math.max(0, " + MCP.charts.sliderRef(item.effect) + ");\n" +
        "var m = " + MCP.charts.sliderRef("Axis Max") + ";\n" +
        "var g = Math.max(0, " + growRef + " / 100);\n" +
        "var h = m > 0 ? v / m * " + MCP.charts.n(len) + " * g : 0;\n";
};

MCP.register("createBarChart", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var items = MCP.charts.dataItems(args.data, { min: 1, max: 60, nonNegative: true, reserved: ["Axis Max"] });
    var ctx = MCP.charts.begin(comp, args, "bar", "Bar Chart");
    var vertical = String(MCP.arg(args, "orientation", "vertical")) !== "horizontal";
    var size = MCP.charts.size(args, vertical ? [Math.round(comp.width * 0.5), Math.round(comp.height * 0.42)] : [Math.round(comp.width * 0.42), Math.round(comp.height * 0.5)]);
    var W = size[0], H = size[1], n = items.length, i;
    var pos = MCP.charts.position(comp, args);
    var vals = MCP.charts.values(items);
    var dataMax = Math.max.apply(null, vals);
    var axis = MCP.charts.axisFor({ max: args.max, steps: args.steps }, 0, dataMax, false);
    if (dataMax > axis.max) { ctx.notes.push("Some values are above max (" + axis.max + "), so their bars reach past the top of the plot."); }
    var scale = MCP.charts.scaleFor(vals.concat([axis.max]));
    var catLen = vertical ? W : H, valLen = vertical ? H : W;
    var lay = MCP.charts.bandLayout(catLen, n, args.barWidth, args.gap, ctx.k, ctx.notes);
    var radius = MCP.isDefined(args.cornerRadius) ? Math.max(0, Number(args.cornerRadius)) : Math.max(2, Math.min(Math.round(lay.bw * 0.16), Math.round(16 * ctx.k)));
    radius = Math.min(radius, lay.bw / 2);
    var roundBase = MCP.bool(args.roundBase, false);
    var colorRes = MCP.charts.colorsFor(ctx, items, args, "accent");
    var colors = colorRes.colors;
    var fmt = MCP.charts.fmt(args.format, { decimals: MCP.charts.dataDecimals(vals) });
    var tickFmt = MCP.charts.tickFmt(args, fmt, axis.max);
    var valuePos = String(MCP.arg(args, "valueLabels", "end"));
    if (valuePos !== "end" && valuePos !== "inside" && valuePos !== "none") { MCP.fail("valueLabels must be end, inside or none.", "invalid-argument"); }
    var showCats = MCP.bool(args.categoryLabels, true);
    var showGrid = MCP.bool(args.gridlines, true);
    var showAxis = MCP.bool(args.axis, true);
    var showTicks = MCP.bool(args.axisLabels, showGrid);
    var vSize = Math.round(MCP.num(args.fontSize, 28 * ctx.k));
    var lSize = Math.round(MCP.num(args.labelFontSize, 24 * ctx.k));
    var tSize = Math.round(lSize * 0.84);
    var tm = MCP.charts.timing(ctx, args, { duration: 0.8, stagger: 0.07 });
    if (showCats && vertical) {
        var longest = 0;
        for (i = 0; i < n; i++) { longest = Math.max(longest, items[i].label.length); }
        if (longest * lSize * 0.55 > lay.band * 0.95) { ctx.notes.push("Category labels may overlap: use a smaller labelFontSize, shorter labels or orientation horizontal."); }
    }
    if (valuePos === "inside" && lay.bw < vSize * 1.3 && !vertical) { ctx.notes.push("The bars are thinner than the value text, so inside labels stay hidden; use valueLabels end."); }

    var g = { valueAxis: vertical ? "y" : "x", W: W, H: H, left: -W / 2, right: W / 2, top: -H / 2, base: H / 2 };
    var gridLead = (showGrid || showAxis) ? MCP.snapToFrame(comp, 0.2) : 0;
    var barStart = tm.t0 + gridLead;
    MCP.charts.evalAt(ctx, barStart + tm.dur + (n - 1) * tm.stagger);

    // Build: control null, grid, bars, labels, ticks.
    var nul = MCP.charts.newNull(ctx, pos);
    var specs = [];
    for (i = 0; i < n; i++) { specs.push({ name: items[i].effect, value: items[i].value / scale }); }
    specs.push({ name: "Axis Max", value: axis.max / scale });
    MCP.charts.addSliders(nul, specs);
    var grid = MCP.charts.buildGrid(ctx, g, axis, showGrid, showAxis, 0);

    var bars = [], B;
    for (i = 0; i < n; i++) {
        B = MCP.charts.newShape(ctx, "Bar " + items[i].label, "bar", items[i].label);
        MCP.charts.addSliders(B, [{ name: "Grow", value: 0 }]);
        MCP.charts.addGroup(B, "Bar");
        MCP.charts.addItem(B, "Bar", "ADBE Vector Shape - Rect", "Top");
        MCP.charts.item(B, "Bar", "Top").property("ADBE Vector Rect Roundness").setValue(radius);
        if (!roundBase) { MCP.charts.addItem(B, "Bar", "ADBE Vector Shape - Rect", "Base"); }
        MCP.charts.addFill(B, "Bar", colors[i]);
        bars.push(B);
    }
    var cats = [], valuesL = [];
    var cGap = Math.round(16 * ctx.k), vGap = Math.round(12 * ctx.k);
    for (i = 0; i < n && showCats; i++) {
        var cp = vertical ? [lay.centers[i], g.base + cGap + MCP.charts.capH(lSize)] : [g.left - cGap, lay.centers[i] + MCP.charts.capOff(lSize)];
        cats.push(MCP.charts.newText(ctx, "Label " + items[i].label, "category-label", items[i].label, items[i].label, { size: lSize, color: ctx.th.ink2, justify: vertical ? "center" : "right", font: ctx.font }, cp));
    }
    for (i = 0; i < n && valuePos !== "none"; i++) {
        var inside = valuePos === "inside";
        var vjust = vertical ? "center" : (inside ? "right" : "left");
        valuesL.push(MCP.charts.newText(ctx, "Value " + items[i].label, "value-label", items[i].label, MCP.charts.format(fmt, items[i].value), { size: vSize, color: inside ? MCP.charts.onColor(colors[i]) : ctx.th.ink, justify: vjust, font: ctx.numberFont }, [0, 0]));
    }
    var ticks = showTicks ? MCP.charts.buildTicks(ctx, g, axis, tickFmt, tSize) : [];
    nul.moveToBeginning();

    // Expressions.
    var S = MCP.charts.n(scale), bw = MCP.charts.n(lay.bw), R = MCP.charts.n(radius), base = MCP.charts.n(g.base), left = MCP.charts.n(g.left);
    for (i = 0; i < n; i++) {
        B = bars[i];
        var head = "// " + ctx.base + ": bar \"" + items[i].label + "\" follows its slider, Axis Max and Grow\n" + MCP.charts.barHead(ctx, items[i], "effect(\"Grow\")(1).value", valLen);
        var c = MCP.charts.n(lay.centers[i]);
        var top = function () { return MCP.charts.item(B, "Bar", "Top"); };
        var bot = function () { return MCP.charts.item(B, "Bar", "Base"); };
        var bh = "var b = Math.min(h, " + R + ");\n";
        MCP.charts.expr(ctx, B, top().property("ADBE Vector Rect Size"), head + (vertical ? "[" + bw + ", h];" : "[h, " + bw + "];"), "Top/Size");
        MCP.charts.expr(ctx, B, top().property("ADBE Vector Rect Position"), head + (vertical ? "[" + c + ", " + base + " - h / 2];" : "[" + left + " + h / 2, " + c + "];"), "Top/Position");
        if (!roundBase) {
            MCP.charts.expr(ctx, B, bot().property("ADBE Vector Rect Size"), head + bh + (vertical ? "[" + bw + ", b];" : "[b, " + bw + "];"), "Base/Size");
            MCP.charts.expr(ctx, B, bot().property("ADBE Vector Rect Position"), head + bh + (vertical ? "[" + c + ", " + base + " - b / 2];" : "[" + left + " + b / 2, " + c + "];"), "Base/Position");
        }
    }
    for (i = 0; i < valuesL.length; i++) {
        var VL = valuesL[i];
        var gref = MCP.charts.growRef(bars[i]);
        var title = "// " + ctx.base + ": value of \"" + items[i].label + "\", counts with its bar\n";
        var vh = title + MCP.charts.barHead(ctx, items[i], gref, valLen);
        var cc = MCP.charts.n(lay.centers[i]);
        var posCode, opCode;
        if (valuePos === "end") {
            posCode = vertical ? "[" + cc + ", " + base + " - h - " + vGap + "];" : "[" + left + " + h + " + vGap + ", " + cc + " + " + MCP.charts.n(MCP.charts.capOff(vSize)) + "];";
            opCode = vh + "linear(g, 0, 0.12, 0, 100);";
        } else if (vertical) {
            posCode = "[" + cc + ", " + base + " - h + " + vGap + " + " + MCP.charts.n(MCP.charts.capH(vSize)) + "];";
            opCode = vh + "var r = sourceRectAtTime(time, false);\n" +
                "var need = " + MCP.charts.n(MCP.charts.capH(vSize) + 2 * vGap) + ";\n" +
                "(r.width + " + (2 * vGap) + " <= " + bw + ") ? linear(h, need, need + 8, 0, 100) : 0;";
        } else {
            posCode = "[" + left + " + h - " + vGap + ", " + cc + " + " + MCP.charts.n(MCP.charts.capOff(vSize)) + "];";
            opCode = vh + "var r = sourceRectAtTime(time, false);\n" +
                "(" + MCP.charts.n(vSize * 1.2) + " <= " + bw + ") ? linear(h - r.width - " + (2 * vGap) + ", 0, 8, 0, 100) : 0;";
        }
        MCP.charts.expr(ctx, VL, VL.property("ADBE Transform Group").property("ADBE Position"), vh + posCode, "Position");
        MCP.charts.expr(ctx, VL, MCP.charts.opacity(VL), opCode, "Opacity");
        MCP.charts.expr(ctx, VL, MCP.charts.sourceText(VL),
            title + MCP.charts.ctrlRef(ctx) +
            "var v = " + MCP.charts.sliderRef(items[i].effect) + " * " + S + ";\n" +
            "var g = Math.max(0, " + gref + " / 100);\n" + MCP.charts.fmtSrc(fmt, "cs_fmt") + "cs_fmt(v * g);", "Source Text");
    }
    for (i = 0; i < ticks.length; i++) {
        MCP.charts.expr(ctx, ticks[i].layer, MCP.charts.sourceText(ticks[i].layer), MCP.charts.tickExpr(ctx, tickFmt, ticks[i].k, axis.steps, scale, false), "Source Text");
    }

    // Keys: the grid draws on, labels fade in, bars grow one after another.
    if (grid) { MCP.charts.intro(ctx, tm, MCP.charts.trimProp(grid, null, "Draw On", "end"), tm.t0, 0, 0.6, 100, MCP.charts.EASE_LAND); }
    MCP.charts.tickIntro(ctx, tm, ticks, tm.t0 + MCP.snapToFrame(comp, 0.1));
    for (i = 0; i < cats.length; i++) {
        MCP.charts.intro(ctx, tm, MCP.charts.opacity(cats[i]), tm.t0 + i * tm.stagger, 0, 0.35, 100, MCP.charts.EASE_LAND);
    }
    for (i = 0; i < n; i++) {
        MCP.charts.intro(ctx, tm, MCP.charts.slider(bars[i], "Grow"), barStart + i * tm.stagger, 0, tm.dur, 100);
    }

    MCP.charts.saveMeta(ctx, {
        scale: scale, items: MCP.charts.itemsMeta(items), nonNegative: true,
        axis: { autoMax: axis.autoMax, minMode: "zero", steps: axis.steps, hasMin: false },
        orientation: vertical ? "vertical" : "horizontal", format: MCP.charts.fmtOut(fmt)
    });
    var controls = [];
    for (i = 0; i < n; i++) { controls.push({ label: items[i].label, effect: items[i].effect, value: items[i].value }); }
    controls.push({ label: "Axis Max", effect: "Axis Max", value: axis.max });
    var out = MCP.charts.result(ctx, {
        controls: MCP.charts.controlsOut(ctx, controls, scale),
        axis: { min: 0, max: axis.max, step: axis.step, steps: axis.steps, auto: axis.autoMax, scale: scale },
        layout: {
            orientation: vertical ? "vertical" : "horizontal", position: MCP.roundValue(pos, 2), size: [MCP.round(W, 2), MCP.round(H, 2)],
            barWidth: MCP.round(lay.bw, 2), gap: MCP.round(lay.gap, 2), cornerRadius: MCP.round(radius, 2), roundBase: roundBase,
            colorMode: colorRes.mode, colors: MCP.charts.hexList(colors),
            valueLabels: valuePos, fontSize: vSize, labelFontSize: lSize, format: MCP.charts.fmtOut(fmt)
        },
        animation: MCP.charts.animOut(ctx, tm, { barsStart: MCP.round(barStart) })
    });
    out.component = MCP.charts.wrap(ctx, args, controls);
    return out;
}, { mutating: true });

/* --------------------------------------------------------------- line chart */

/** Expression source for the points P of a line chart (C must exist). */
MCP.charts.pointsSrc = function (items, x0, dx, base, H) {
    var reads = [];
    for (var i = 0; i < items.length; i++) { reads.push(MCP.charts.sliderRef(items[i].effect)); }
    return "var lo = " + MCP.charts.sliderRef("Axis Min") + ", hi = " + MCP.charts.sliderRef("Axis Max") + ";\n" +
        "var V = [" + reads.join(", ") + "];\n" +
        "var P = [], i;\n" +
        "for (i = 0; i < V.length; i++) { P.push([" + MCP.charts.n(x0) + " + i * " + MCP.charts.n(dx) + ", " + MCP.charts.n(base) + " - (hi > lo ? (V[i] - lo) / (hi - lo) : 0) * " + MCP.charts.n(H) + "]); }\n";
};

/** Expression source for one point j of a line chart: var p = [x, y] (C must exist). */
MCP.charts.pointSrc = function (item, j, x0, dx, base, H) {
    return "var lo = " + MCP.charts.sliderRef("Axis Min") + ", hi = " + MCP.charts.sliderRef("Axis Max") + ";\n" +
        "var v = " + MCP.charts.sliderRef(item.effect) + ";\n" +
        "var p = [" + MCP.charts.n(x0 + j * dx) + ", " + MCP.charts.n(base) + " - (hi > lo ? (v - lo) / (hi - lo) : 0) * " + MCP.charts.n(H) + "];\n";
};

/** The first frame time at which prop reaches target, searching t0..t1 (prop rises over that span). */
MCP.charts.crossTime = function (comp, prop, t0, t1, target) {
    var fd = MCP.frameDuration(comp);
    var lo = Math.round(t0 / fd), hi = Math.round(t1 / fd);
    var at = function (f) { return Number(_mcpTry(function () { return prop.valueAtTime(f * fd, false); }, 0)); };
    if (at(lo) >= target - 1e-6) { return lo * fd; }
    while (hi - lo > 1) {
        var mid = Math.floor((lo + hi) / 2);
        if (at(mid) >= target - 1e-6) { hi = mid; } else { lo = mid; }
    }
    return hi * fd;
};

MCP.register("createLineChart", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var items = MCP.charts.dataItems(args.data, { min: 2, max: 200, reserved: ["Axis Max", "Axis Min"] });
    var ctx = MCP.charts.begin(comp, args, "line", "Line Chart");
    var size = MCP.charts.size(args, [Math.round(comp.width * 0.6), Math.round(comp.height * 0.42)]);
    var W = size[0], H = size[1], n = items.length, i;
    var pos = MCP.charts.position(comp, args);
    var vals = MCP.charts.values(items);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var axis = MCP.charts.axisFor(args, lo, hi, true);
    if (lo < axis.min || hi > axis.max) { ctx.notes.push("Some values are outside the axis (" + axis.min + " to " + axis.max + "), so the line leaves the plot there."); }
    var scale = MCP.charts.scaleFor(vals.concat([axis.max, axis.min]));
    var smooth = MCP.bool(args.smooth, true);
    var lw = MCP.num(args.lineWidth, Math.max(1, Math.round(4 * ctx.k)));
    var showDots = MCP.bool(args.dots, n <= 24);
    var dotSize = MCP.num(args.dotSize, Math.max(4, Math.round(lw * 3)));
    var area = String(MCP.arg(args, "area", "gradient"));
    if (area !== "none" && area !== "solid" && area !== "gradient") { MCP.fail("area must be none, solid or gradient.", "invalid-argument"); }
    var areaOpacity = MCP.num(args.areaOpacity, area === "gradient" ? 32 : 14);
    var lineColor = ctx.th.accent;
    var pointLabels = String(MCP.arg(args, "pointLabels", "last"));
    if (pointLabels !== "last" && pointLabels !== "all" && pointLabels !== "none") { MCP.fail("pointLabels must be last, all or none.", "invalid-argument"); }
    var showCats = MCP.bool(args.categoryLabels, true);
    var every = MCP.isDefined(args.labelEvery) ? Math.max(1, Math.round(Number(args.labelEvery))) : Math.max(1, Math.ceil(n / 12));
    var showGrid = MCP.bool(args.gridlines, true);
    var showAxis = MCP.bool(args.axis, true);
    var showTicks = MCP.bool(args.axisLabels, showGrid);
    var fmt = MCP.charts.fmt(args.format, { decimals: MCP.charts.dataDecimals(vals) });
    var tickFmt = MCP.charts.tickFmt(args, fmt, Math.max(Math.abs(axis.max), Math.abs(axis.min)));
    var vSize = Math.round(MCP.num(args.fontSize, 28 * ctx.k));
    var lSize = Math.round(MCP.num(args.labelFontSize, 22 * ctx.k));
    var tSize = Math.round(lSize * 0.9);
    var tm = MCP.charts.timing(ctx, args, { duration: 1.2, stagger: 0.07, easing: MCP.charts.EASE_DRAW, easingText: MCP.charts.DRAW_TEXT });
    var ring = Math.max(1, Math.round(3 * ctx.k));

    var g = { valueAxis: "y", W: W, H: H, left: -W / 2, right: W / 2, top: -H / 2, base: H / 2 };
    var x0 = g.left, dx = W / (n - 1);
    var zeroK = 0;
    if (axis.min < 0 && axis.max > 0) {
        var kz = Math.round(-axis.min / axis.step);
        if (Math.abs(axis.min + kz * axis.step) < 1e-9 * Math.max(1, axis.step)) { zeroK = kz; }
    }
    var gridLead = (showGrid || showAxis) ? MCP.snapToFrame(comp, 0.2) : 0;
    var lt0 = tm.t0 + gridLead, lt1 = lt0 + tm.dur;
    MCP.charts.evalAt(ctx, lt1);

    // Build: null, grid, area (with its fade matte), line, dots, labels, ticks.
    var nul = MCP.charts.newNull(ctx, pos);
    var specs = [];
    for (i = 0; i < n; i++) { specs.push({ name: items[i].effect, value: items[i].value / scale }); }
    specs.push({ name: "Axis Max", value: axis.max / scale });
    specs.push({ name: "Axis Min", value: axis.min / scale });
    MCP.charts.addSliders(nul, specs);
    var grid = MCP.charts.buildGrid(ctx, g, axis, showGrid, showAxis, zeroK);

    var areaL = null, fade = null;
    if (area !== "none") {
        areaL = MCP.charts.newShape(ctx, "Area", "area", null);
        MCP.charts.addGroup(areaL, "Area");
        MCP.charts.addPath(areaL, "Area", "Path", MCP.shape.pathFromPoints([[x0, g.base], [x0 + W, g.base], [x0, g.base]], true));
        MCP.charts.addFill(areaL, "Area", lineColor, areaOpacity);
        if (area === "gradient") {
            fade = MCP.charts.newShape(ctx, "Area Fade", "area-matte", null);
            MCP.charts.addGroup(fade, "Fade");
            MCP.charts.addItem(fade, "Fade", "ADBE Vector Shape - Rect", "Box");
            MCP.charts.item(fade, "Fade", "Box").property("ADBE Vector Rect Size").setValue([W + 4 * lw, H + 4 * lw]);
            MCP.charts.addItem(fade, "Fade", "ADBE Vector Graphic - G-Fill", "Gradient");
            try { MCP.charts.item(fade, "Fade", "Gradient").property("ADBE Vector Grad Type").setValue(1); } catch (eg0) {}
            MCP.charts.item(fade, "Fade", "Gradient").property("ADBE Vector Grad Start Pt").setValue([0, g.top]);
            MCP.charts.item(fade, "Fade", "Gradient").property("ADBE Vector Grad End Pt").setValue([0, g.base]);
            MCP.animate.placeAbove(fade, areaL);
            try {
                if (typeof areaL.setTrackMatte === "function") { areaL.setTrackMatte(fade, TrackMatteType.LUMA); }
                else { areaL.trackMatteType = TrackMatteType.LUMA; }
            } catch (eg1) {
                ctx.notes.push("The area fade could not be set as a luma track matte (" + eg1.toString() + "); the area is a flat wash.");
            }
            try { fade.enabled = false; } catch (eg2) {}
        }
    }
    var lineL = MCP.charts.newShape(ctx, "Line", "line", null);
    MCP.charts.addGroup(lineL, "Line");
    MCP.charts.addPath(lineL, "Line", "Path", MCP.shape.pathFromPoints([[x0, g.base], [x0 + W, g.base]], false));
    MCP.charts.addStroke(lineL, "Line", lineColor, lw, 2, 2);
    MCP.charts.addTrim(lineL, "Line", "Draw On");

    var dotsL = null;
    if (showDots) {
        dotsL = MCP.charts.newShape(ctx, "Dots", "dots", null);
        for (i = 0; i < n; i++) {
            var gn = "Dot " + (i + 1);
            MCP.charts.addGroup(dotsL, gn);
            MCP.charts.addItem(dotsL, gn, "ADBE Vector Shape - Ellipse", "Circle");
            MCP.charts.item(dotsL, gn, "Circle").property("ADBE Vector Ellipse Size").setValue([dotSize, dotSize]);
            MCP.charts.addFill(dotsL, gn, lineColor);
            MCP.charts.addStroke(dotsL, gn, ctx.th.surface, ring * 2, 1, 1, "Ring");
        }
    }
    var pls = [];
    var plGap = Math.round(14 * ctx.k);
    for (i = 0; i < n && pointLabels !== "none"; i++) {
        if (pointLabels === "last" && i !== n - 1) { continue; }
        pls.push({ j: i, layer: MCP.charts.newText(ctx, "Value " + items[i].label, "value-label", items[i].label, MCP.charts.format(fmt, items[i].value), { size: vSize, color: ctx.th.ink, justify: pointLabels === "last" ? "left" : "center", font: ctx.numberFont }, [0, 0]) });
    }
    var cats = [];
    var cGap = Math.round(16 * ctx.k);
    for (i = 0; i < n && showCats; i++) {
        if (i % every !== 0) { continue; }
        cats.push(MCP.charts.newText(ctx, "Label " + items[i].label, "category-label", items[i].label, items[i].label, { size: lSize, color: ctx.th.ink2, justify: "center", font: ctx.font }, [x0 + i * dx, g.base + cGap + MCP.charts.capH(lSize)]));
    }
    var ticks = showTicks ? MCP.charts.buildTicks(ctx, g, axis, tickFmt, tSize) : [];
    nul.moveToBeginning();

    // Expressions.
    var S = MCP.charts.n(scale), base = MCP.charts.n(g.base), sm = smooth ? "true" : "false";
    var head = "// " + ctx.base + ": points from the value sliders and Axis Min / Max\n" + MCP.charts.ctrlRef(ctx) + MCP.charts.pointsSrc(items, x0, dx, g.base, H) + MCP.charts.SRC_GEOM;
    MCP.charts.expr(ctx, lineL, MCP.charts.item(lineL, "Line", "Path").property("ADBE Vector Shape"),
        head + "var TG = cs_tan(P, " + sm + ");\ncreatePath(P, TG.i, TG.o, false);", "Line/Path");
    if (areaL) {
        MCP.charts.expr(ctx, areaL, MCP.charts.item(areaL, "Area", "Path").property("ADBE Vector Shape"),
            head + "var TG = cs_tan(P, " + sm + ");\n" +
            "// the area follows the line's Trim Paths End\n" +
            "var f = thisComp.layer(" + MCP.charts.q(lineL.name) + ").content(\"Line\").content(\"Draw On\").end.value / 100;\n" +
            "var R = cs_cut(P, TG.i, TG.o, f, " + MCP.charts.SAMPLES + ");\n" +
            "var last = R.p[R.p.length - 1];\n" +
            "var pts = R.p.concat([[last[0], " + base + "], [P[0][0], " + base + "]]);\n" +
            "var ins = R.i.concat([[0, 0], [0, 0]]), outs = R.o.concat([[0, 0], [0, 0]]);\n" +
            "ins[0] = [0, 0];\n" +
            "createPath(pts, ins, outs, true);", "Area/Path");
    }
    if (fade) {
        MCP.charts.expr(ctx, fade, MCP.charts.item(fade, "Fade", "Gradient").property("ADBE Vector Grad Start Pt"),
            "// " + ctx.base + ": the fade starts at the highest point of the line\n" + MCP.charts.ctrlRef(ctx) + MCP.charts.pointsSrc(items, x0, dx, g.base, H) +
            "var top = " + base + ";\nfor (i = 0; i < P.length; i++) { top = Math.min(top, P[i][1]); }\n[0, Math.min(top, " + MCP.charts.n(g.base - 1) + ")];", "Fade/Start Point");
    }
    if (dotsL) {
        for (i = 0; i < n; i++) {
            MCP.charts.expr(ctx, dotsL, MCP.charts.groupXf(dotsL, "Dot " + (i + 1), "ADBE Vector Position"),
                "// " + ctx.base + ": dot on \"" + items[i].label + "\"\n" + MCP.charts.ctrlRef(ctx) + MCP.charts.pointSrc(items[i], i, x0, dx, g.base, H) + "p;", "Dot " + (i + 1) + "/Position");
        }
    }
    for (i = 0; i < pls.length; i++) {
        var j = pls[i].j, PL = pls[i].layer;
        var off = pointLabels === "last" ? "[p[0] + " + MCP.charts.n(dotSize / 2 + plGap) + ", p[1] + " + MCP.charts.n(MCP.charts.capOff(vSize)) + "]" : "[p[0], p[1] - " + MCP.charts.n(dotSize / 2 + plGap) + "]";
        MCP.charts.expr(ctx, PL, PL.property("ADBE Transform Group").property("ADBE Position"),
            "// " + ctx.base + ": label of \"" + items[j].label + "\" rides its point\n" + MCP.charts.ctrlRef(ctx) + MCP.charts.pointSrc(items[j], j, x0, dx, g.base, H) + off + ";", "Position");
        MCP.charts.expr(ctx, PL, MCP.charts.sourceText(PL),
            "// " + ctx.base + ": value of \"" + items[j].label + "\"\n" + MCP.charts.ctrlRef(ctx) + "var v = " + MCP.charts.sliderRef(items[j].effect) + " * " + S + ";\n" + MCP.charts.fmtSrc(fmt, "cs_fmt") + "cs_fmt(v);", "Source Text");
    }
    for (i = 0; i < ticks.length; i++) {
        MCP.charts.expr(ctx, ticks[i].layer, MCP.charts.sourceText(ticks[i].layer), MCP.charts.tickExpr(ctx, tickFmt, ticks[i].k, axis.steps, scale, true), "Source Text");
    }

    // Keys: grid, ticks and labels first; the line draws; each dot and label arrives as the line reaches it.
    if (grid) { MCP.charts.intro(ctx, tm, MCP.charts.trimProp(grid, null, "Draw On", "end"), tm.t0, 0, 0.6, 100, MCP.charts.EASE_LAND); }
    MCP.charts.tickIntro(ctx, tm, ticks, tm.t0 + MCP.snapToFrame(comp, 0.1));
    for (i = 0; i < cats.length; i++) {
        MCP.charts.intro(ctx, tm, MCP.charts.opacity(cats[i]), tm.t0 + i * tm.stagger, 0, 0.35, 100, MCP.charts.EASE_LAND);
    }
    var trimEnd = MCP.charts.trimProp(lineL, "Line", "Draw On", "end");
    MCP.charts.intro(ctx, tm, trimEnd, lt0, 0, tm.dur, 100);
    // Where each point sits along the line (arc length), from the same geometry the expressions use.
    var G = MCP.charts.geom();
    var P = [];
    for (i = 0; i < n; i++) { P.push([x0 + i * dx, g.base - (axis.max > axis.min ? (items[i].value - axis.min) / (axis.max - axis.min) : 0) * H]); }
    var TG = G.tan(P, smooth);
    var A = G.len(P, TG.i, TG.o, MCP.charts.SAMPLES);
    var arrivals = [];
    for (i = 0; i < n; i++) {
        var frac = A.total > 0 ? A.cum[i] / A.total : i / (n - 1);
        var tc = tm.animate ? MCP.charts.crossTime(comp, trimEnd, lt0, lt1, frac * 100) : lt0;
        arrivals.push({ label: items[i].label, fraction: MCP.round(frac), time: MCP.round(tc), frame: MCP.frameOf(comp, tc) });
        if (dotsL) {
            MCP.charts.intro(ctx, tm, MCP.charts.groupXf(dotsL, "Dot " + (i + 1), "ADBE Vector Scale"), Math.max(lt0, MCP.snapToFrame(comp, tc - 2 * ctx.fd)), [0, 0], 0.25, [100, 100], MCP.charts.EASE_LAND);
        }
    }
    for (i = 0; i < pls.length; i++) {
        MCP.charts.intro(ctx, tm, MCP.charts.opacity(pls[i].layer), Math.max(lt0, MCP.snapToFrame(comp, arrivals[pls[i].j].time - ctx.fd)), 0, 0.3, 100, MCP.charts.EASE_LAND);
    }

    MCP.charts.saveMeta(ctx, {
        scale: scale, items: MCP.charts.itemsMeta(items), nonNegative: false,
        axis: { autoMax: axis.autoMax, minMode: axis.minMode, steps: axis.steps, hasMin: true },
        format: MCP.charts.fmtOut(fmt)
    });
    var controls = [];
    for (i = 0; i < n; i++) { controls.push({ label: items[i].label, effect: items[i].effect, value: items[i].value }); }
    controls.push({ label: "Axis Max", effect: "Axis Max", value: axis.max });
    controls.push({ label: "Axis Min", effect: "Axis Min", value: axis.min });
    var out = MCP.charts.result(ctx, {
        controls: MCP.charts.controlsOut(ctx, controls, scale),
        axis: { min: axis.min, max: axis.max, step: axis.step, steps: axis.steps, auto: axis.autoMax, minMode: axis.minMode, scale: scale },
        layout: {
            position: MCP.roundValue(pos, 2), size: [MCP.round(W, 2), MCP.round(H, 2)], smooth: smooth, lineWidth: lw,
            dots: showDots, dotSize: dotSize, area: area, areaOpacity: areaOpacity, pointLabels: pointLabels, labelEvery: every,
            color: MCP.color.toHex(lineColor), fontSize: vSize, labelFontSize: lSize, format: MCP.charts.fmtOut(fmt)
        },
        animation: MCP.charts.animOut(ctx, tm, { lineStart: MCP.round(lt0), lineEnd: MCP.round(lt1), arrivals: tm.animate ? arrivals : null })
    });
    out.component = MCP.charts.wrap(ctx, args, controls);
    return out;
}, { mutating: true });

/* ---------------------------------------------------------------- pie chart */

/** Shared expression header for slice idx: V, tot, pre, sh (share in percent), g (Grow 0..1). */
MCP.charts.sliceHead = function (ctx, items, idx, growRef) {
    var reads = [];
    for (var i = 0; i < items.length; i++) { reads.push(MCP.charts.sliderRef(items[i].effect)); }
    return MCP.charts.ctrlRef(ctx) +
        "var V = [" + reads.join(", ") + "];\n" +
        "var tot = 0, pre = 0, i, x;\n" +
        "for (i = 0; i < V.length; i++) { x = Math.max(0, V[i]); tot += x; if (i < " + idx + ") { pre += x; } }\n" +
        "var sh = tot > 0 ? Math.max(0, V[" + idx + "]) / tot * 100 : 0;\n" +
        "var g = Math.max(0, Math.min(1, " + growRef + " / 100));\n";
};

/**
 * Rounded share source: cs_share(V, tot, idx) gives slice idx's percent at the label's decimals, rounded so the
 * labels add up to exactly 100 (largest remainder; ties go to the earlier slice).
 */
MCP.charts.shareSrc = function (decimals) {
    return "function cs_share(V, tot, idx) {\n" +
        "  var m = Math.pow(10, " + decimals + "), fl = [], rem = [], ord = [], sum = 0, i, x, f;\n" +
        "  if (!(tot > 0)) { return 0; }\n" +
        "  for (i = 0; i < V.length; i++) { x = Math.round(Math.max(0, V[i]) / tot * 100 * m * 1e6) / 1e6; f = Math.floor(x); fl.push(f); rem.push(x - f); ord.push(i); sum += f; }\n" +
        "  ord.sort(function (a, b) { return rem[b] - rem[a] || a - b; });\n" +
        "  for (i = 0; i < Math.round(100 * m - sum) && i < ord.length; i++) { fl[ord[i]] += 1; }\n" +
        "  return fl[idx] / m;\n" +
        "}\n";
};

MCP.register("createPieChart", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var items = MCP.charts.dataItems(args.data, { min: 1, max: 24, nonNegative: true });
    var ctx = MCP.charts.begin(comp, args, "pie", "Pie Chart");
    var n = items.length, i;
    var vals = MCP.charts.values(items);
    var total = 0;
    for (i = 0; i < n; i++) { total += vals[i]; }
    if (!(total > 0)) { MCP.fail("The values add up to 0, so there is nothing to divide. Give at least one value above 0.", "invalid-argument"); }
    var pos = MCP.charts.position(comp, args);
    var R = MCP.num(args.radius, Math.round(Math.min(comp.width, comp.height) * 0.3));
    if (!(R > 0)) { MCP.fail("radius must be greater than 0.", "invalid-argument"); }
    var inner = MCP.num(args.innerRadius, Math.round(R * 0.62));
    if (inner < 0 || inner >= R) { MCP.fail("innerRadius must be at least 0 and smaller than radius (" + R + "). 0 draws a pie.", "invalid-argument"); }
    var donut = inner > 0;
    var ringW = R - inner, rMid = donut ? (R + inner) / 2 : R / 2;
    var startAngle = MCP.num(args.startAngle, 0);
    var gapPx = n > 1 ? MCP.num(args.gap, donut ? Math.round(4 * ctx.k) : Math.round(3 * ctx.k)) : 0;
    var gapPct = gapPx / (2 * Math.PI * (donut ? rMid : R)) * 100;
    var colorRes = MCP.charts.colorsFor(ctx, items, args, "shades");
    var colors = colorRes.colors;
    if (colorRes.mode === "shades" && n > 6) { ctx.notes.push("Shades of one colour are hard to tell apart past 6 slices; colorMode palette, or highlight, reads better."); }
    var labels = String(MCP.arg(args, "labels", "percent"));
    var LABEL_KINDS = { "percent": 1, "value": 1, "label": 1, "label-percent": 1, "none": 1 };
    if (!LABEL_KINDS[labels]) { MCP.fail("labels must be percent, value, label, label-percent or none.", "invalid-argument"); }
    var lSize = Math.round(MCP.num(args.fontSize, 26 * ctx.k));
    var where = String(MCP.arg(args, "labelPosition", "auto"));
    if (where !== "auto" && where !== "inside" && where !== "outside") { MCP.fail("labelPosition must be auto, inside or outside.", "invalid-argument"); }
    var lines = labels === "label-percent" ? 2 : 1;
    if (where === "auto") { where = (!donut || ringW >= lSize * (lines + 1.2)) ? "inside" : "outside"; }
    var minShare = MCP.num(args.minLabelShare, 4);
    var pctFmt = MCP.charts.fmt(args.format, { decimals: 0, suffix: "%" });
    var valFmt = MCP.charts.fmt(args.format, { decimals: MCP.charts.dataDecimals(vals) });
    var showLegend = MCP.bool(args.legend, true);
    var gSize = Math.round(MCP.num(args.labelFontSize, 24 * ctx.k));
    var center = null;
    if (MCP.isDefined(args.center) && args.center !== false) {
        if (!donut) { MCP.fail("center is drawn in the hole of a donut. Give innerRadius above 0, or leave center out.", "invalid-argument"); }
        var cspec = typeof args.center === "object" ? args.center : {};
        center = { total: MCP.bool(cspec.total, true), label: MCP.isDefined(cspec.label) ? String(cspec.label) : null, format: MCP.charts.fmt(MCP.isDefined(cspec.format) ? cspec.format : (labels === "value" ? args.format : undefined), { decimals: MCP.charts.dataDecimals(vals) }) };
        if (!center.total && !center.label) { center = null; }
    }
    var tm = MCP.charts.timing(ctx, args, { duration: 0.8, stagger: 0.12 });
    var scale = MCP.charts.scaleFor(vals.concat([total]));
    MCP.charts.evalAt(ctx, tm.t0 + tm.dur + (n - 1) * tm.stagger);

    // Build.
    var nul = MCP.charts.newNull(ctx, pos);
    var specs = [];
    for (i = 0; i < n; i++) { specs.push({ name: items[i].effect, value: items[i].value / scale }); }
    MCP.charts.addSliders(nul, specs);
    var slices = [], SL;
    for (i = 0; i < n; i++) {
        SL = MCP.charts.newShape(ctx, "Slice " + items[i].label, "slice", items[i].label);
        MCP.charts.addSliders(SL, [{ name: "Grow", value: 0 }]);
        MCP.charts.addGroup(SL, "Slice");
        MCP.charts.addPath(SL, "Slice", "Circle", MCP.charts.circle(rMid));
        MCP.charts.addStroke(SL, "Slice", colors[i], donut ? ringW : R, 1, 1);
        MCP.charts.addTrim(SL, "Slice", "Trim");
        MCP.charts.trimProp(SL, "Slice", "Trim", "offset").setValue(startAngle);
        slices.push(SL);
    }
    var sliceLabels = [];
    var lr = where === "inside" ? (donut ? rMid : R * 0.62) : R + Math.round(18 * ctx.k) + lSize * 0.9;
    var leading = Math.round(lSize * 1.15);
    for (i = 0; i < n && labels !== "none"; i++) {
        var pct = MCP.charts.format(pctFmt, MCP.charts.compile(MCP.charts.shareSrc(pctFmt.decimals), "cs_share")(vals, total, i));
        var init = labels === "label" ? items[i].label : (labels === "value" ? MCP.charts.format(valFmt, items[i].value) : pct);
        if (labels === "label-percent") { init = items[i].label + "\r" + pct; }
        sliceLabels.push(MCP.charts.newText(ctx, "Label " + items[i].label, "slice-label", items[i].label, init, {
            size: lSize, color: where === "inside" ? MCP.charts.onColor(colors[i]) : ctx.th.ink, justify: "center",
            font: labels === "label" ? ctx.font : ctx.numberFont, leading: lines > 1 ? leading : undefined
        }, [0, 0]));
    }
    var swatches = null, legendTexts = [];
    var legendX = R + Math.round(R * 0.22 + 40 * ctx.k);
    var rowH = Math.round(gSize * 1.75);
    var sw = Math.max(6, Math.round(gSize * 0.62));
    if (showLegend) {
        swatches = MCP.charts.newShape(ctx, "Swatches", "legend-swatches", null);
        for (i = 0; i < n; i++) {
            var yRow = (i - (n - 1) / 2) * rowH;
            var sg = "Swatch " + (i + 1);
            MCP.charts.addGroup(swatches, sg);
            MCP.charts.addItem(swatches, sg, "ADBE Vector Shape - Ellipse", "Circle");
            MCP.charts.item(swatches, sg, "Circle").property("ADBE Vector Ellipse Size").setValue([sw, sw]);
            MCP.charts.addFill(swatches, sg, colors[i]);
            MCP.charts.groupXf(swatches, sg, "ADBE Vector Position").setValue([legendX + sw / 2, yRow]);
            legendTexts.push(MCP.charts.newText(ctx, "Legend " + items[i].label, "legend-label", items[i].label, items[i].label, { size: gSize, color: ctx.th.ink2, justify: "left", font: ctx.font }, [legendX + sw + Math.round(14 * ctx.k), yRow + MCP.charts.capOff(gSize)]));
        }
    }
    var centerTotal = null, centerLabel = null;
    if (center) {
        var cSize = Math.max(Math.round(28 * ctx.k), Math.round(inner * 0.4));
        var capSize = Math.max(Math.round(18 * ctx.k), Math.round(cSize * 0.38));
        var both = center.total && center.label;
        var blockH = (center.total ? MCP.charts.capH(cSize) : 0) + (both ? Math.round(capSize * 0.9) : 0) + (center.label ? MCP.charts.capH(capSize) : 0);
        var yTop = -blockH / 2;
        if (center.total) {
            centerTotal = MCP.charts.newText(ctx, "Center Total", "center-total", null, MCP.charts.format(center.format, total), { size: cSize, color: ctx.th.ink, justify: "center", font: ctx.numberFont }, [0, yTop + MCP.charts.capH(cSize)]);
            yTop += MCP.charts.capH(cSize) + (both ? Math.round(capSize * 0.9) : 0);
        }
        if (center.label) {
            centerLabel = MCP.charts.newText(ctx, "Center Label", "center-label", null, center.label, { size: capSize, color: ctx.th.ink2, justify: "center", font: ctx.font }, [0, yTop + MCP.charts.capH(capSize)]);
        }
    }
    nul.moveToBeginning();

    // Expressions.
    var Sc = MCP.charts.n(scale), GP = MCP.charts.n(gapPct);
    for (i = 0; i < n; i++) {
        SL = slices[i];
        var head = "// " + ctx.base + ": slice \"" + items[i].label + "\" from the shares of all sliders and its Grow\n" + MCP.charts.sliceHead(ctx, items, i, "effect(\"Grow\")(1).value") +
            "var st = (tot > 0 ? pre / tot * 100 : 0) + " + GP + " / 2;\n" +
            "var len = Math.max(0, sh - " + GP + ") * g;\n";
        MCP.charts.expr(ctx, SL, MCP.charts.trimProp(SL, "Slice", "Trim", "start"), head + "Math.min(100, st);", "Trim/Start");
        MCP.charts.expr(ctx, SL, MCP.charts.trimProp(SL, "Slice", "Trim", "end"), head + "Math.min(100, st + len);", "Trim/End");
    }
    var yOff = lines > 1 ? MCP.charts.capOff(lSize) - leading / 2 : MCP.charts.capOff(lSize);
    for (i = 0; i < sliceLabels.length; i++) {
        var LL = sliceLabels[i];
        var lh = "// " + ctx.base + ": label of slice \"" + items[i].label + "\"\n" + MCP.charts.sliceHead(ctx, items, i, MCP.charts.growRef(slices[i]));
        MCP.charts.expr(ctx, LL, LL.property("ADBE Transform Group").property("ADBE Position"),
            lh + "var a = (" + MCP.charts.n(startAngle) + " + ((tot > 0 ? pre / tot * 100 : 0) + sh / 2) * 3.6) * Math.PI / 180;\n" +
            "[Math.sin(a) * " + MCP.charts.n(lr) + ", -Math.cos(a) * " + MCP.charts.n(lr) + " + " + MCP.charts.n(yOff) + "];", "Position");
        MCP.charts.expr(ctx, LL, MCP.charts.opacity(LL), lh + "sh < " + MCP.charts.n(minShare) + " ? 0 : linear(g, 0.25, 0.7, 0, 100);", "Opacity");
        var textCode = null;
        if (labels === "value") { textCode = MCP.charts.fmtSrc(valFmt, "cs_fmt") + "cs_fmt(V[" + i + "] * " + Sc + " * g);"; }
        else if (labels === "percent") { textCode = MCP.charts.fmtSrc(pctFmt, "cs_fmt") + MCP.charts.shareSrc(pctFmt.decimals) + "cs_fmt(cs_share(V, tot, " + i + ") * g);"; }
        else if (labels === "label-percent") { textCode = MCP.charts.fmtSrc(pctFmt, "cs_fmt") + MCP.charts.shareSrc(pctFmt.decimals) + MCP.charts.q(items[i].label) + " + \"\\r\" + cs_fmt(cs_share(V, tot, " + i + ") * g);"; }
        if (textCode) { MCP.charts.expr(ctx, LL, MCP.charts.sourceText(LL), lh + textCode, "Source Text"); }
    }
    if (centerTotal) {
        var reads = [], grows = [];
        for (i = 0; i < n; i++) {
            reads.push(MCP.charts.sliderRef(items[i].effect));
            grows.push(MCP.charts.growRef(slices[i]));
        }
        MCP.charts.expr(ctx, centerTotal, MCP.charts.sourceText(centerTotal),
            "// " + ctx.base + ": total, counts up as the slices fill\n" + MCP.charts.ctrlRef(ctx) +
            "var V = [" + reads.join(", ") + "];\nvar G = [" + grows.join(", ") + "];\n" +
            "var s = 0, i;\nfor (i = 0; i < V.length; i++) { s += Math.max(0, V[i]) * Math.max(0, Math.min(1, G[i] / 100)); }\n" +
            MCP.charts.fmtSrc(center.format, "cs_fmt") + "cs_fmt(s * " + Sc + ");", "Source Text");
    }

    // Keys: slices fill clockwise one after another; legend rows arrive with their slice.
    for (i = 0; i < n; i++) {
        var ts = tm.t0 + i * tm.stagger;
        MCP.charts.intro(ctx, tm, MCP.charts.slider(slices[i], "Grow"), ts, 0, tm.dur, 100);
        if (swatches) {
            MCP.charts.intro(ctx, tm, MCP.charts.groupXf(swatches, "Swatch " + (i + 1), "ADBE Vector Group Opacity"), ts, 0, 0.35, 100, MCP.charts.EASE_LAND);
            MCP.charts.intro(ctx, tm, MCP.charts.opacity(legendTexts[i]), ts, 0, 0.35, 100, MCP.charts.EASE_LAND);
        }
    }
    if (centerLabel) { MCP.charts.intro(ctx, tm, MCP.charts.opacity(centerLabel), tm.t0, 0, 0.35, 100, MCP.charts.EASE_LAND); }
    if (centerTotal) { MCP.charts.intro(ctx, tm, MCP.charts.opacity(centerTotal), tm.t0, 0, 0.35, 100, MCP.charts.EASE_LAND); }

    MCP.charts.saveMeta(ctx, { scale: scale, items: MCP.charts.itemsMeta(items), nonNegative: true, axis: null, labels: labels, format: MCP.charts.fmtOut(labels === "value" ? valFmt : pctFmt) });
    var controls = [], shares = [];
    for (i = 0; i < n; i++) {
        controls.push({ label: items[i].label, effect: items[i].effect, value: items[i].value });
        shares.push({ label: items[i].label, value: items[i].value, percent: MCP.round(items[i].value / total * 100, 2), color: MCP.color.toHex(colors[i]) });
    }
    var out = MCP.charts.result(ctx, {
        controls: MCP.charts.controlsOut(ctx, controls, scale),
        total: MCP.round(total), shares: shares,
        layout: {
            position: MCP.roundValue(pos, 2), radius: R, innerRadius: inner, style: donut ? "donut" : "pie", startAngle: startAngle,
            gap: gapPx, colorMode: colorRes.mode, labels: labels, labelPosition: where, legend: showLegend,
            center: center ? { total: center.total, label: center.label } : null, fontSize: lSize
        },
        animation: MCP.charts.animOut(ctx, tm, null)
    });
    out.component = MCP.charts.wrap(ctx, args, controls);
    return out;
}, { mutating: true });

/* --------------------------------------------------------------------- stat */

/** Adds a text animator whose Fill Color follows code, with a Range Selector covering every character (0 to 100 %). */
MCP.charts.fillAnimator = function (ctx, L, name, code, label) {
    var anims = function () { return L.property("ADBE Text Properties").property("ADBE Text Animators"); };
    var idx = anims().addProperty("ADBE Text Animator").propertyIndex;
    anims().property(idx).name = name;
    var sels = function () { return anims().property(idx).property("ADBE Text Selectors"); };
    if (sels().numProperties === 0) { sels().addProperty("ADBE Text Selector"); }
    var props = function () { return anims().property(idx).property("ADBE Text Animator Properties"); };
    props().addProperty("ADBE Text Fill Color");
    MCP.charts.expr(ctx, L, props().property("ADBE Text Fill Color"), code, label);
};

MCP.register("createStat", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var value = Number(MCP.requireArg(args, "value"));
    if (!isFinite(value)) { MCP.fail("value must be a finite number.", "invalid-argument"); }
    var from = MCP.num(args.from, 0);
    var ctx = MCP.charts.begin(comp, args, "stat", "Stat");
    var align = String(MCP.arg(args, "align", "left"));
    if (align !== "left" && align !== "center") { MCP.fail("align must be left or center.", "invalid-argument"); }
    var center = align === "center";
    var pos = MCP.isArray(args.position) ? [Number(args.position[0]), Number(args.position[1])] : (center ? [comp.width / 2, Math.round(comp.height * 0.36)] : [Math.round(comp.width * 0.18), Math.round(comp.height * 0.32)]);
    var fmt = MCP.charts.fmt(args.format, { decimals: MCP.charts.dataDecimals([value, from]) });
    var ns = Math.round(MCP.num(args.fontSize, 112 * ctx.k));
    var ls = Math.round(MCP.num(args.labelFontSize, 28 * ctx.k));
    var label = MCP.isDefined(args.label) ? String(args.label) : null;
    var delta = null;
    if (MCP.isDefined(args.delta)) {
        var ds = args.delta;
        var dv = Number(ds.value);
        if (!MCP.isDefined(ds.value) || !isFinite(dv)) { MCP.fail("delta needs a finite number value.", "invalid-argument"); }
        var good = String(MCP.arg(ds, "goodWhen", "up"));
        if (good !== "up" && good !== "down") { MCP.fail("delta.goodWhen must be up or down.", "invalid-argument"); }
        delta = { value: dv, goodWhen: good, caption: MCP.isDefined(ds.caption) ? String(ds.caption) : null, format: MCP.charts.fmt(ds.format, { decimals: MCP.charts.dataDecimals([dv]), suffix: "%" }) };
    }
    var spark = null;
    if (MCP.isDefined(args.sparkline)) {
        var sp = args.sparkline;
        if (!MCP.isArray(sp.data) || sp.data.length < 2) { MCP.fail("sparkline.data needs at least 2 numbers.", "invalid-argument"); }
        if (sp.data.length > 120) { MCP.fail("sparkline.data takes at most 120 numbers.", "invalid-argument"); }
        var sd = [];
        for (var si = 0; si < sp.data.length; si++) {
            var sv = Number(sp.data[si]);
            if (!isFinite(sv)) { MCP.fail("sparkline.data[" + si + "] is not a number.", "invalid-argument"); }
            sd.push(sv);
        }
        spark = {
            data: sd, width: MCP.num(sp.width, Math.round(ns * 3.6)), height: MCP.num(sp.height, Math.round(ns * 0.62)),
            color: MCP.isDefined(sp.color) ? MCP.color.rgba(sp.color) : ctx.th.accent, dot: MCP.bool(sp.dot, true), smooth: MCP.bool(sp.smooth, true)
        };
        if (!(spark.width > 0) || !(spark.height > 0)) { MCP.fail("sparkline width and height must be greater than 0.", "invalid-argument"); }
    }
    var tm = MCP.charts.timing(ctx, args, { duration: 1.2, stagger: 0.07 });
    var scale = MCP.charts.scaleFor([value, from].concat(spark ? spark.data : []).concat(delta ? [delta.value] : []));
    var countStart = tm.t0 + (label ? MCP.snapToFrame(comp, 0.1) : 0);
    var countEnd = countStart + tm.dur;
    MCP.charts.evalAt(ctx, countEnd);

    // Layout, top down in the null's space: label, number, delta row, sparkline.
    var y = 0, labelPos = null, deltaBase = null, sparkTop = null;
    if (label) { labelPos = [0, MCP.charts.capH(ls)]; y = MCP.charts.capH(ls) + Math.round(ls * 0.75); }
    var numberPos = [0, y + MCP.charts.capH(ns)];
    y += MCP.charts.capH(ns);
    var dsz = ls;
    if (delta) { y += Math.round(ns * 0.3); deltaBase = y + MCP.charts.capH(dsz); y = deltaBase; }
    if (spark) { y += Math.round(ns * 0.36); sparkTop = y; y += spark.height; }

    // Build.
    var nul = MCP.charts.newNull(ctx, pos);
    var specs = [{ name: "Value", value: value / scale }, { name: "From", value: from / scale }, { name: "Count", value: 0 }];
    if (delta) { specs.push({ name: "Delta", value: delta.value / scale }); }
    var sparkItems = [], k2;
    if (spark) {
        for (k2 = 0; k2 < spark.data.length; k2++) {
            sparkItems.push({ label: "Spark " + (k2 + 1), effect: "Spark " + (k2 + 1), value: spark.data[k2] });
            specs.push({ name: "Spark " + (k2 + 1), value: spark.data[k2] / scale });
        }
    }
    MCP.charts.addSliders(nul, specs);
    var just = center ? "center" : "left";
    var labelL = label ? MCP.charts.newText(ctx, "Label", "label", null, label, { size: ls, color: ctx.th.ink2, justify: just, font: ctx.font }, labelPos) : null;
    var numL = MCP.charts.newText(ctx, "Value", "value", null, MCP.charts.format(fmt, value), { size: ns, color: ctx.th.ink, justify: just, font: ctx.numberFont }, numberPos);
    var dText = null, dArrow = null, dCap = null;
    var aSize = Math.round(dsz * 0.62), aGap = Math.round(dsz * 0.32), cGap = Math.round(dsz * 0.4);
    if (delta) {
        dArrow = MCP.charts.newShape(ctx, "Delta Arrow", "delta-arrow", null);
        MCP.charts.addGroup(dArrow, "Arrow");
        MCP.charts.addPath(dArrow, "Arrow", "Path", MCP.charts.triangle(aSize));
        MCP.charts.addFill(dArrow, "Arrow", ctx.th.up);
        dText = MCP.charts.newText(ctx, "Delta", "delta", null, MCP.charts.format(delta.format, Math.abs(delta.value)), { size: dsz, color: ctx.th.up, justify: "left", font: ctx.numberFont }, [0, deltaBase]);
        if (delta.caption) { dCap = MCP.charts.newText(ctx, "Delta Caption", "delta-caption", null, delta.caption, { size: dsz, color: ctx.th.muted, justify: "left", font: ctx.font }, [0, deltaBase]); }
    }
    var sparkL = null;
    if (spark) {
        sparkL = MCP.charts.newShape(ctx, "Sparkline", "sparkline", null);
        MCP.charts.addGroup(sparkL, "Line");
        MCP.charts.addPath(sparkL, "Line", "Path", MCP.shape.pathFromPoints([[0, sparkTop + spark.height], [spark.width, sparkTop + spark.height]], false));
        MCP.charts.addStroke(sparkL, "Line", spark.color, Math.max(1, Math.round(3 * ctx.k)), 2, 2);
        MCP.charts.addTrim(sparkL, "Line", "Draw On");
        if (spark.dot) {
            var dd = Math.max(6, Math.round(10 * ctx.k));
            MCP.charts.addGroup(sparkL, "End Dot");
            MCP.charts.addItem(sparkL, "End Dot", "ADBE Vector Shape - Ellipse", "Circle");
            MCP.charts.item(sparkL, "End Dot", "Circle").property("ADBE Vector Ellipse Size").setValue([dd, dd]);
            MCP.charts.addFill(sparkL, "End Dot", spark.color);
            MCP.charts.addStroke(sparkL, "End Dot", ctx.th.surface, Math.max(2, Math.round(6 * ctx.k)), 1, 1, "Ring");
        }
    }
    nul.moveToBeginning();

    // Expressions.
    var S = MCP.charts.n(scale);
    MCP.charts.expr(ctx, numL, MCP.charts.sourceText(numL),
        "// " + ctx.base + ": counts from From to Value as Count goes 0 to 100\n" + MCP.charts.ctrlRef(ctx) +
        "var v = " + MCP.charts.sliderRef("Value") + " * " + S + ", f = " + MCP.charts.sliderRef("From") + " * " + S + ";\n" +
        "var c = " + MCP.charts.sliderRef("Count") + " / 100;\n" + MCP.charts.fmtSrc(fmt, "cs_fmt") + "cs_fmt(f + (v - f) * c);", "Source Text");
    MCP.charts.expr(ctx, numL, MCP.charts.opacity(numL),
        "// " + ctx.base + ": the number appears as the count starts\n" + MCP.charts.ctrlRef(ctx) + "linear(" + MCP.charts.sliderRef("Count") + ", 0, 6, 0, 100);", "Opacity");
    if (delta) {
        var dRef = "var d = " + MCP.charts.sliderRef("Delta") + ";\n";
        var colorCode = "// " + ctx.base + ": green when the change is good, red when it is bad\n" + MCP.charts.ctrlRef(ctx) + dRef +
            "var good = " + (delta.goodWhen === "up" ? "d >= 0" : "d <= 0") + ";\n" +
            "d === 0 ? " + MCP.charts.colorSrc(ctx.th.muted) + " : (good ? " + MCP.charts.colorSrc(ctx.th.up) + " : " + MCP.charts.colorSrc(ctx.th.down) + ");";
        MCP.charts.expr(ctx, dText, MCP.charts.sourceText(dText),
            "// " + ctx.base + ": size of the change\n" + MCP.charts.ctrlRef(ctx) + dRef + MCP.charts.fmtSrc(delta.format, "cs_fmt") + "cs_fmt(Math.abs(d) * " + S + ");", "Source Text");
        MCP.charts.fillAnimator(ctx, dText, "Delta Colour", colorCode, "Animator/Fill Color");
        MCP.charts.expr(ctx, dArrow, MCP.charts.item(dArrow, "Arrow", "Fill").property("ADBE Vector Fill Color"), colorCode, "Arrow/Fill Color");
        MCP.charts.expr(ctx, dArrow, MCP.charts.groupXf(dArrow, "Arrow", "ADBE Vector Rotation"),
            "// " + ctx.base + ": the arrow points up for a rise and down for a fall\n" + MCP.charts.ctrlRef(ctx) + dRef + "d < 0 ? 180 : 0;", "Arrow/Rotation");
        MCP.charts.expr(ctx, dArrow, MCP.charts.groupXf(dArrow, "Arrow", "ADBE Vector Group Opacity"),
            "// " + ctx.base + ": no arrow when nothing changed\n" + MCP.charts.ctrlRef(ctx) + dRef + "d === 0 ? 0 : 100;", "Arrow/Opacity");
        // The row: arrow, change, caption. Widths come from the rendered text, so the row stays together when the values change.
        var rowHead = "// " + ctx.base + ": delta row, laid out from the text widths\n" +
            "var tw = thisComp.layer(" + MCP.charts.q(dText.name) + ").sourceRectAtTime(time, false).width;\n" +
            "var cw = " + (dCap ? "thisComp.layer(" + MCP.charts.q(dCap.name) + ").sourceRectAtTime(time, false).width" : "0") + ";\n" +
            "var rw = " + aSize + " + " + aGap + " + tw" + (dCap ? " + " + cGap + " + cw" : "") + ";\n" +
            "var x0 = " + (center ? "-rw / 2" : "0") + ";\n";
        MCP.charts.expr(ctx, dArrow, dArrow.property("ADBE Transform Group").property("ADBE Position"),
            rowHead + "[x0 + " + MCP.charts.n(aSize / 2) + ", " + MCP.charts.n(deltaBase - MCP.charts.capH(dsz) / 2) + "];", "Position");
        MCP.charts.expr(ctx, dText, dText.property("ADBE Transform Group").property("ADBE Position"),
            rowHead + "[x0 + " + (aSize + aGap) + ", " + MCP.charts.n(deltaBase) + "];", "Position");
        if (dCap) {
            MCP.charts.expr(ctx, dCap, dCap.property("ADBE Transform Group").property("ADBE Position"),
                rowHead + "[x0 + " + (aSize + aGap) + " + tw + " + cGap + ", " + MCP.charts.n(deltaBase) + "];", "Position");
        }
    }
    if (sparkL) {
        var reads = [];
        for (k2 = 0; k2 < sparkItems.length; k2++) { reads.push(MCP.charts.sliderRef(sparkItems[k2].effect)); }
        var sx0 = center ? -spark.width / 2 : 0;
        var sdx = spark.width / (spark.data.length - 1);
        var sHead = "// " + ctx.base + ": sparkline from the Spark sliders, fitted to their own range\n" + MCP.charts.ctrlRef(ctx) +
            "var V = [" + reads.join(", ") + "];\n" +
            "var lo = Math.min.apply(null, V), hi = Math.max.apply(null, V), P = [], i;\n" +
            "if (hi - lo < 1e-9) { lo = lo - 1; hi = hi + 1; }\n" +
            "for (i = 0; i < V.length; i++) { P.push([" + MCP.charts.n(sx0) + " + i * " + MCP.charts.n(sdx) + ", " + MCP.charts.n(sparkTop + spark.height) + " - (V[i] - lo) / (hi - lo) * " + MCP.charts.n(spark.height) + "]); }\n";
        MCP.charts.expr(ctx, sparkL, MCP.charts.item(sparkL, "Line", "Path").property("ADBE Vector Shape"),
            sHead + MCP.charts.SRC_GEOM + "var TG = cs_tan(P, " + (spark.smooth ? "true" : "false") + ");\ncreatePath(P, TG.i, TG.o, false);", "Line/Path");
        if (spark.dot) {
            MCP.charts.expr(ctx, sparkL, MCP.charts.groupXf(sparkL, "End Dot", "ADBE Vector Position"), sHead + "P[P.length - 1];", "End Dot/Position");
        }
    }

    // Keys: the label fades in, the number counts, the sparkline draws with it, the delta lands with the count.
    if (labelL) { MCP.charts.intro(ctx, tm, MCP.charts.opacity(labelL), tm.t0, 0, 0.35, 100, MCP.charts.EASE_LAND); }
    MCP.charts.intro(ctx, tm, MCP.charts.slider(nul, "Count"), countStart, 0, tm.dur, 100);
    if (sparkL) {
        MCP.charts.intro(ctx, tm, MCP.charts.trimProp(sparkL, "Line", "Draw On", "end"), countStart, 0, tm.dur, 100);
        if (spark.dot) {
            MCP.charts.intro(ctx, tm, MCP.charts.groupXf(sparkL, "End Dot", "ADBE Vector Scale"), MCP.snapToFrame(comp, countEnd - 0.2), [0, 0], 0.25, [100, 100], MCP.charts.EASE_LAND);
        }
    }
    if (delta) {
        var dStart = MCP.snapToFrame(comp, Math.max(countStart, countEnd - 0.35));
        var opRef = "// " + ctx.base + ": follows the delta's opacity\nthisComp.layer(" + MCP.charts.q(dText.name) + ").transform.opacity;";
        MCP.charts.intro(ctx, tm, MCP.charts.opacity(dText), dStart, 0, 0.3, 100, MCP.charts.EASE_LAND);
        MCP.charts.expr(ctx, dArrow, MCP.charts.opacity(dArrow), opRef, "Opacity");
        if (dCap) { MCP.charts.expr(ctx, dCap, MCP.charts.opacity(dCap), opRef, "Opacity"); }
        MCP.charts.intro(ctx, tm, MCP.charts.groupXf(dArrow, "Arrow", "ADBE Vector Scale"), dStart, [60, 60], 0.3, [100, 100], MCP.charts.EASE_LAND);
    }

    var controls = [{ label: "Value", effect: "Value", value: value }, { label: "From", effect: "From", value: from }];
    if (delta) { controls.push({ label: "Delta", effect: "Delta", value: delta.value }); }
    controls = controls.concat(sparkItems);
    MCP.charts.saveMeta(ctx, { scale: scale, items: MCP.charts.itemsMeta(controls), nonNegative: false, axis: null, format: MCP.charts.fmtOut(fmt) });
    var out = MCP.charts.result(ctx, {
        controls: MCP.charts.controlsOut(ctx, controls, scale),
        progress: { effect: "Count", property: "Effects/Count/Slider", note: "0 shows From, 100 shows Value." },
        text: {
            value: MCP.charts.format(fmt, value),
            delta: delta ? MCP.charts.format(delta.format, Math.abs(delta.value)) : null,
            direction: delta ? (delta.value > 0 ? "up" : (delta.value < 0 ? "down" : "none")) : null,
            good: delta && delta.value !== 0 ? (delta.goodWhen === "up" ? delta.value > 0 : delta.value < 0) : null
        },
        layout: { position: MCP.roundValue(pos, 2), align: align, fontSize: ns, labelFontSize: ls, height: MCP.round(y, 2), sparkline: spark ? { width: spark.width, height: spark.height, points: spark.data.length } : null, format: MCP.charts.fmtOut(fmt) },
        animation: MCP.charts.animOut(ctx, tm, { countStart: MCP.round(countStart), countEnd: MCP.round(countEnd) })
    });
    out.component = MCP.charts.wrap(ctx, args, controls);
    return out;
}, { mutating: true });

/* ----------------------------------------------------------------- progress */

MCP.register("createProgress", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var value = Number(MCP.requireArg(args, "value"));
    var max = MCP.num(args.max, 100);
    if (!isFinite(value)) { MCP.fail("value must be a finite number.", "invalid-argument"); }
    if (!(max > 0)) { MCP.fail("max must be greater than 0.", "invalid-argument"); }
    var style = String(MCP.arg(args, "style", "bar"));
    if (style !== "bar" && style !== "ring") { MCP.fail("style must be bar or ring.", "invalid-argument"); }
    var ctx = MCP.charts.begin(comp, args, "progress", style === "ring" ? "Progress Ring" : "Progress Bar");
    var pos = MCP.charts.position(comp, args);
    var display = String(MCP.arg(args, "display", "percent"));
    if (display !== "percent" && display !== "value" && display !== "none") { MCP.fail("display must be percent, value or none.", "invalid-argument"); }
    var fmt = display === "value" ? MCP.charts.fmt(args.format, { decimals: MCP.charts.dataDecimals([value]) }) : MCP.charts.fmt(args.format, { decimals: 0, suffix: "%" });
    var fill = ctx.th.accent;
    var track = MCP.isDefined(args.trackColor) ? MCP.color.rgba(args.trackColor) : MCP.charts.mix(fill, ctx.th.surface, 0.82);
    var caption = MCP.isDefined(args.caption) ? String(args.caption) : null;
    var tm = MCP.charts.timing(ctx, args, { duration: 1.0, stagger: 0.07 });
    var scale = MCP.charts.scaleFor([value, max]);
    var W = 0, Hh = 0, radius = 0, thick = 0;
    if (style === "bar") {
        var sz = MCP.charts.size(args, [Math.round(comp.width * 0.4), Math.round(16 * ctx.k)]);
        W = sz[0];
        Hh = sz[1];
    } else {
        radius = MCP.num(args.radius, Math.round(Math.min(comp.width, comp.height) * 0.16));
        thick = MCP.num(args.thickness, Math.max(4, Math.round(radius * 0.14)));
        if (!(radius > 0) || !(thick > 0) || thick >= radius * 2) { MCP.fail("radius and thickness must be greater than 0, and thickness smaller than the ring's diameter.", "invalid-argument"); }
    }
    var vs = Math.round(MCP.num(args.fontSize, style === "ring" ? Math.max(24 * ctx.k, radius * 0.46) : 28 * ctx.k));
    var cs = Math.round(MCP.num(args.labelFontSize, style === "ring" ? Math.max(18 * ctx.k, radius * 0.17) : 24 * ctx.k));
    if (value < 0 || value > max) { ctx.notes.push("value " + value + " is outside 0 to " + max + "; the fill stops at that range."); }
    MCP.charts.evalAt(ctx, tm.t0 + MCP.snapToFrame(comp, 0.1) + tm.dur);

    var nul = MCP.charts.newNull(ctx, pos);
    MCP.charts.addSliders(nul, [{ name: "Value", value: value / scale }, { name: "Max", value: max / scale }, { name: "Grow", value: 0 }]);
    var shapeL = MCP.charts.newShape(ctx, style === "ring" ? "Ring" : "Bar", style, null);
    var valueL = null, capL = null;
    if (style === "bar") {
        MCP.charts.addGroup(shapeL, "Fill");
        MCP.charts.addItem(shapeL, "Fill", "ADBE Vector Shape - Rect", "Rect");
        MCP.charts.item(shapeL, "Fill", "Rect").property("ADBE Vector Rect Roundness").setValue(Hh / 2);
        MCP.charts.addFill(shapeL, "Fill", fill);
        MCP.charts.addGroup(shapeL, "Track");
        MCP.charts.addItem(shapeL, "Track", "ADBE Vector Shape - Rect", "Rect");
        MCP.charts.item(shapeL, "Track", "Rect").property("ADBE Vector Rect Size").setValue([W, Hh]);
        MCP.charts.item(shapeL, "Track", "Rect").property("ADBE Vector Rect Roundness").setValue(Hh / 2);
        MCP.charts.addFill(shapeL, "Track", track);
        var ly = -Hh / 2 - Math.round(14 * ctx.k);
        if (display !== "none") { valueL = MCP.charts.newText(ctx, "Value", "value", null, MCP.charts.format(fmt, display === "value" ? value : value / max * 100), { size: vs, color: ctx.th.ink, justify: "right", font: ctx.numberFont }, [W / 2, ly]); }
        if (caption) { capL = MCP.charts.newText(ctx, "Caption", "caption", null, caption, { size: cs, color: ctx.th.ink2, justify: "left", font: ctx.font }, [-W / 2, ly]); }
    } else {
        MCP.charts.addGroup(shapeL, "Fill");
        MCP.charts.addPath(shapeL, "Fill", "Circle", MCP.charts.circle(radius));
        MCP.charts.addStroke(shapeL, "Fill", fill, thick, MCP.bool(args.roundCaps, true) ? 2 : 1, 2);
        MCP.charts.addTrim(shapeL, "Fill", "Trim");
        MCP.charts.addGroup(shapeL, "Track");
        MCP.charts.addPath(shapeL, "Track", "Circle", MCP.charts.circle(radius));
        MCP.charts.addStroke(shapeL, "Track", track, thick, 1, 2);
        var both = display !== "none" && caption;
        var blockH = (display !== "none" ? MCP.charts.capH(vs) : 0) + (both ? Math.round(cs * 0.8) : 0) + (caption ? MCP.charts.capH(cs) : 0);
        var yTop = -blockH / 2;
        if (display !== "none") {
            valueL = MCP.charts.newText(ctx, "Value", "value", null, MCP.charts.format(fmt, display === "value" ? value : value / max * 100), { size: vs, color: ctx.th.ink, justify: "center", font: ctx.numberFont }, [0, yTop + MCP.charts.capH(vs)]);
            yTop += MCP.charts.capH(vs) + (both ? Math.round(cs * 0.8) : 0);
        }
        if (caption) { capL = MCP.charts.newText(ctx, "Caption", "caption", null, caption, { size: cs, color: ctx.th.ink2, justify: "center", font: ctx.font }, [0, yTop + MCP.charts.capH(cs)]); }
    }
    nul.moveToBeginning();

    var title = "// " + ctx.base + ": filled to Value / Max as Grow goes 0 to 100\n";
    var head = title + MCP.charts.ctrlRef(ctx) +
        "var mx = " + MCP.charts.sliderRef("Max") + ";\n" +
        "var p = Math.max(0, Math.min(1, mx > 0 ? " + MCP.charts.sliderRef("Value") + " / mx : 0));\n" +
        "var g = Math.max(0, " + MCP.charts.sliderRef("Grow") + " / 100);\n";
    if (style === "bar") {
        var fw = "var w = " + MCP.charts.n(W) + " * p * g;\n";
        MCP.charts.expr(ctx, shapeL, MCP.charts.item(shapeL, "Fill", "Rect").property("ADBE Vector Rect Size"), head + fw + "[w, " + MCP.charts.n(Hh) + "];", "Fill/Size");
        MCP.charts.expr(ctx, shapeL, MCP.charts.item(shapeL, "Fill", "Rect").property("ADBE Vector Rect Position"), head + fw + "[" + MCP.charts.n(-W / 2) + " + w / 2, 0];", "Fill/Position");
    } else {
        MCP.charts.expr(ctx, shapeL, MCP.charts.trimProp(shapeL, "Fill", "Trim", "end"), head + "Math.min(100, p * g * 100);", "Fill/Trim End");
    }
    MCP.charts.expr(ctx, shapeL, MCP.charts.groupXf(shapeL, "Fill", "ADBE Vector Group Opacity"), head + "p * g > 0 ? 100 : 0;", "Fill/Opacity");
    if (valueL) {
        var shown = display === "value" ? "cs_fmt(" + MCP.charts.sliderRef("Value") + " * " + MCP.charts.n(scale) + " * Math.min(1, g));" : "cs_fmt(p * Math.min(1, g) * 100);";
        MCP.charts.expr(ctx, valueL, MCP.charts.sourceText(valueL), head + MCP.charts.fmtSrc(fmt, "cs_fmt") + shown, "Source Text");
    }

    MCP.charts.intro(ctx, tm, MCP.charts.groupXf(shapeL, "Track", "ADBE Vector Group Opacity"), tm.t0, 0, 0.35, 100, MCP.charts.EASE_LAND);
    if (capL) { MCP.charts.intro(ctx, tm, MCP.charts.opacity(capL), tm.t0, 0, 0.35, 100, MCP.charts.EASE_LAND); }
    if (valueL) { MCP.charts.intro(ctx, tm, MCP.charts.opacity(valueL), tm.t0, 0, 0.35, 100, MCP.charts.EASE_LAND); }
    MCP.charts.intro(ctx, tm, MCP.charts.slider(nul, "Grow"), tm.t0 + MCP.snapToFrame(comp, 0.1), 0, tm.dur, 100);

    var controls = [{ label: "Value", effect: "Value", value: value }, { label: "Max", effect: "Max", value: max }];
    MCP.charts.saveMeta(ctx, { scale: scale, items: MCP.charts.itemsMeta(controls), nonNegative: false, axis: null, style: style, format: MCP.charts.fmtOut(fmt) });
    var out = MCP.charts.result(ctx, {
        controls: MCP.charts.controlsOut(ctx, controls, scale),
        progress: { effect: "Grow", property: "Effects/Grow/Slider", note: "0 shows an empty track, 100 fills to Value / Max." },
        percent: MCP.round(Math.max(0, Math.min(1, value / max)) * 100, 2),
        layout: {
            style: style, position: MCP.roundValue(pos, 2), size: style === "bar" ? [W, Hh] : null, radius: style === "ring" ? radius : null, thickness: style === "ring" ? thick : null,
            color: MCP.color.toHex(fill), trackColor: MCP.color.toHex(track), display: display, fontSize: vs, labelFontSize: cs, format: MCP.charts.fmtOut(fmt)
        },
        animation: MCP.charts.animOut(ctx, tm, null)
    });
    out.component = MCP.charts.wrap(ctx, args, controls);
    return out;
}, { mutating: true });

/* ----------------------------------------------------- finding a chart again */

MCP.charts.findAll = function (comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        var m = MCP.charts.readMeta(L);
        if (m) { out.push({ layer: L, meta: m }); }
    }
    return out;
};

MCP.charts.chartNames = function (list) {
    var out = [];
    for (var i = 0; i < list.length; i++) { out.push(list[i].meta.name + " (" + list[i].meta.type + ")"); }
    return out.join(", ") || "(none)";
};

/** Picks one chart from list by name (meta name, control layer name, or "<name> / Controls"). */
MCP.charts.pick = function (list, name, where) {
    var hits = [], i;
    if (!MCP.isDefined(name)) {
        if (list.length === 1) { return list[0]; }
        if (!list.length) { MCP.fail("No chart made by the chart tools was found in " + where + ".", "not-found"); }
        MCP.fail(list.length + " charts are in " + where + ": " + MCP.charts.chartNames(list) + ". Give chart with one of those names.", "ambiguous", { charts: MCP.charts.chartNames(list) });
    }
    var s = String(name);
    for (i = 0; i < list.length; i++) {
        var nm = list[i].layer.name;
        if (list[i].meta.name === s || nm === s || nm === s + " / Controls") { hits.push(list[i]); }
    }
    if (!hits.length) {
        for (i = 0; i < list.length; i++) {
            if (String(list[i].meta.name).toLowerCase() === s.toLowerCase()) { hits.push(list[i]); }
        }
    }
    if (hits.length === 1) { return hits[0]; }
    if (hits.length > 1) { MCP.fail("More than one chart is named '" + s + "' in " + where + ". Give controls (the control null layer) instead.", "ambiguous"); }
    MCP.fail("No chart named '" + s + "' in " + where + ". Charts there: " + MCP.charts.chartNames(list) + ".", "not-found", { charts: MCP.charts.chartNames(list) });
    return null;
};

/**
 * Finds the chart a call targets: {comp (holding the control null), ctrl, meta,
 * instance (a component instance layer or null), host (the comp key times use)}.
 */
MCP.charts.locate = function (args) {
    var host = MCP.resolveComp(args.comp);
    if (MCP.isDefined(args.instance)) {
        var inst = MCP.resolveLayer(host, args.instance);
        var src = _mcpTry(function () { return inst.source; }, null);
        if (!(src instanceof CompItem)) { MCP.fail("Layer '" + inst.name + "' is not a component instance (its source is not a composition).", "invalid-argument"); }
        var inner = MCP.charts.pick(MCP.charts.findAll(src), args.chart, "component '" + src.name + "'");
        return { comp: src, ctrl: inner.layer, meta: inner.meta, instance: inst, host: host };
    }
    if (MCP.isDefined(args.controls)) {
        var ctrl = MCP.resolveLayer(host, args.controls);
        var meta = MCP.charts.readMeta(ctrl);
        if (!meta) { MCP.fail("Layer '" + ctrl.name + "' is not the control null of a chart made by the chart tools (its comment holds no chart description).", "invalid-argument"); }
        return { comp: host, ctrl: ctrl, meta: meta, instance: null, host: host };
    }
    var hit = MCP.charts.pick(MCP.charts.findAll(host), args.chart, "'" + host.name + "'");
    return { comp: host, ctrl: hit.layer, meta: hit.meta, instance: null, host: host };
};

/** The property that holds one control: the slider, or the instance's Essential Property for it (null when absent). */
MCP.charts.controlProp = function (loc, effect, required) {
    if (loc.instance) {
        var group = MCP.components.overridesGroup(loc.instance, false);
        var leaves = MCP.components.overrideLeaves(group);
        var leaf = MCP.components.findLeaf(leaves, effect);
        if (!leaf) {
            if (required) {
                MCP.fail("The instance '" + loc.instance.name + "' has no Essential Property '" + effect + "', so it cannot change that value on its own. Its Essential Properties: " + (MCP.components.labelsOf(leaves).join(", ") || "(none)") + ". Leave instance out and give comp the component to change it for every instance.", "not-found");
            }
            return null;
        }
        return leaf.prop;
    }
    var p = _mcpTry(function () { return MCP.charts.slider(loc.ctrl, effect); }, null);
    if (!p && required) { MCP.fail("The slider '" + effect + "' is missing from '" + loc.ctrl.name + "'.", "not-found", { effects: MCP.childNames(MCP.effectsGroup(loc.ctrl)) }); }
    return p;
};

/** A control's own (keyed, pre-expression) value at t. */
MCP.charts.readAt = function (prop, t) {
    var v = _mcpTry(function () { return prop.valueAtTime(t, true); }, null);
    if (v === null || v === undefined) { v = _mcpTry(function () { return prop.value; }, 0); }
    return Number(MCP.isArray(v) ? v[0] : v);
};

MCP.charts.layersOf = function (comp, name) {
    var pre = name + " / ", out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name.indexOf(pre) === 0) { out.push(MCP.serialize.layerRef(comp.layer(i))); }
    }
    return out;
};

/** A control for describe(): the instance's Essential Property when there is one, else the slider. */
MCP.charts.readControl = function (loc, effect) {
    var p = loc.instance ? MCP.charts.controlProp(loc, effect, false) : null;
    var where = loc.instance ? "instance" : "controls";
    if (!p) {
        p = _mcpTry(function () { return MCP.charts.slider(loc.ctrl, effect); }, null);
        if (loc.instance) { where = "component"; }
    }
    return { prop: p, source: where };
};

MCP.charts.describe = function (loc, t) {
    var meta = loc.meta, scale = Number(meta.scale) || 1, items = [], i;
    for (i = 0; i < meta.items.length; i++) {
        var it = meta.items[i];
        var rc = MCP.charts.readControl(loc, it.effect);
        var p = rc.prop;
        items.push({
            label: it.label, effect: it.effect,
            value: p ? MCP.round(MCP.charts.readAt(p, t) * scale) : null,
            keys: p ? _mcpTry(function () { return p.numKeys; }, 0) : 0,
            source: p ? rc.source : "missing"
        });
    }
    var axis = null;
    if (meta.axis) {
        var mx = MCP.charts.readControl(loc, "Axis Max").prop;
        var mn = meta.axis.hasMin ? MCP.charts.readControl(loc, "Axis Min").prop : null;
        axis = {
            min: mn ? MCP.round(MCP.charts.readAt(mn, t) * scale) : 0,
            max: mx ? MCP.round(MCP.charts.readAt(mx, t) * scale) : null,
            steps: meta.axis.steps, auto: !!meta.axis.autoMax, minMode: meta.axis.minMode || "zero"
        };
    }
    return {
        name: meta.name, type: meta.type, controls: MCP.serialize.layerRef(loc.ctrl),
        component: loc.instance ? { comp: MCP.serialize.compRef(loc.comp), instance: MCP.serialize.layerRef(loc.instance) } : null,
        scale: scale, format: meta.format || null, values: items, axis: axis, layers: MCP.charts.layersOf(loc.comp, meta.name)
    };
};

MCP.register("getChartData", function (args) {
    var host = MCP.resolveComp(args.comp);
    var t = MCP.timeArg(host, args, host.time);
    if (MCP.isDefined(args.chart) || MCP.isDefined(args.controls) || MCP.isDefined(args.instance)) {
        var loc = MCP.charts.locate(args);
        return { composition: MCP.serialize.compRef(host), time: MCP.round(t), count: 1, charts: [MCP.charts.describe(loc, t)] };
    }
    var list = MCP.charts.findAll(host), out = [];
    for (var i = 0; i < list.length; i++) {
        out.push(MCP.charts.describe({ comp: host, ctrl: list[i].layer, meta: list[i].meta, instance: null, host: host }, t));
    }
    return { composition: MCP.serialize.compRef(host), time: MCP.round(t), count: out.length, charts: out };
}, { mutating: false });

/* ---------------------------------------------------------- update-chart-data */

/**
 * Writes one control. With anim {t0, t1, easing} the value moves from what it
 * holds at t0 to the new value in two eased keys (keys between them are
 * removed); without, a control with no keys takes the value and a keyed one
 * gets it on its last key. Returns {from, keys}.
 */
MCP.charts.writeControl = function (prop, newRaw, anim, notes, label) {
    var eps = 1e-4, k;
    if (anim) {
        var v0 = MCP.charts.readAt(prop, anim.t0);
        for (k = prop.numKeys; k >= 1; k--) {
            var kt = prop.keyTime(k);
            if (kt > anim.t0 + eps && kt <= anim.t1 + eps) { prop.removeKey(k); }
        }
        MCP.easing.setKey(prop, anim.t0, v0);
        var i1 = MCP.easing.setKey(prop, anim.t1, newRaw);
        MCP.easing.applySegment(prop, i1, anim.easing);
        var later = 0;
        for (k = 1; k <= prop.numKeys; k++) { if (prop.keyTime(k) > anim.t1 + eps) { later++; } }
        if (later) { notes.push("'" + label + "' has " + later + " later key(s) that still change it after " + MCP.round(anim.t1) + " s."); }
        var ka = MCP.easing.keyIndexAtTime(prop, anim.t0, 1e-3), kb = MCP.easing.keyIndexAtTime(prop, anim.t1, 1e-3);
        return { from: v0, keys: [ka > 0 ? MCP.serialize.keyframe(prop, ka) : null, kb > 0 ? MCP.serialize.keyframe(prop, kb) : null] };
    }
    if (prop.numKeys > 0) {
        var before = Number(prop.keyValue(prop.numKeys));
        prop.setValueAtKey(prop.numKeys, newRaw);
        notes.push("'" + label + "' is keyed, so its last key (" + MCP.round(prop.keyTime(prop.numKeys)) + " s) took the new value.");
        return { from: before, keys: null };
    }
    var cur = Number(prop.value);
    prop.setValue(newRaw);
    return { from: cur, keys: null };
};

MCP.charts.createToolFor = function (type) {
    if (type === "stat") { return "create-stat"; }
    if (type === "progress") { return "create-progress"; }
    return "create-" + type + "-chart";
};

MCP.register("updateChartData", function (args) {
    var loc = MCP.charts.locate(args);
    var meta = loc.meta, scale = Number(meta.scale) || 1, host = loc.host, i, j;
    var updates = [];
    if (MCP.isArray(args.data)) {
        for (i = 0; i < args.data.length; i++) { updates.push({ label: String(args.data[i].label), value: Number(args.data[i].value) }); }
    }
    if (args.values && typeof args.values === "object") {
        for (var key in args.values) {
            if (Object.prototype.hasOwnProperty.call(args.values, key)) { updates.push({ label: String(key), value: Number(args.values[key]) }); }
        }
    }
    if (!updates.length) { MCP.fail("Give values {label: number} or data [{label, value}] to change.", "invalid-argument"); }

    // Check everything before writing anything.
    var byLabel = {}, labels = [];
    for (i = 0; i < meta.items.length; i++) {
        var mItem = meta.items[i];
        byLabel["=" + mItem.label] = mItem;
        if (!byLabel["~" + mItem.label.toLowerCase()]) { byLabel["~" + mItem.label.toLowerCase()] = mItem; }
        labels.push(mItem.label);
    }
    var plan = [], seen = {};
    for (i = 0; i < updates.length; i++) {
        var u = updates[i];
        var it = byLabel["=" + u.label] || byLabel["~" + u.label.toLowerCase()];
        if (!it) {
            MCP.fail("'" + u.label + "' is not in " + meta.type + " chart '" + meta.name + "' (" + labels.join(", ") + "). A chart keeps the categories it was built with: to add or remove one, build it again with the full data (" + MCP.charts.createToolFor(meta.type) + "). A value of 0 empties a bar or slice.", "unsupported", { labels: labels });
        }
        if (seen[it.effect]) { MCP.fail("'" + u.label + "' is given twice.", "invalid-argument"); }
        seen[it.effect] = true;
        if (!isFinite(u.value)) { MCP.fail("The value for '" + u.label + "' is not a finite number.", "invalid-argument"); }
        if (meta.nonNegative && u.value < 0) { MCP.fail("'" + u.label + "' would be " + u.value + "; this chart shows amounts, so values must be 0 or more.", "invalid-argument"); }
        if (Math.abs(u.value / scale) >= MCP.charts.SLIDER_LIMIT) {
            MCP.fail("'" + u.label + "' (" + u.value + ") is beyond what the chart's sliders can hold (" + (MCP.charts.SLIDER_LIMIT * scale) + " at scale " + scale + "). Build the chart again with this data.", "invalid-argument");
        }
        plan.push({ item: it, value: u.value, prop: MCP.charts.controlProp(loc, it.effect, true) });
    }
    var timed = MCP.isDefined(args.startTime) || MCP.isDefined(args.startFrame) || MCP.isDefined(args.duration) || MCP.isDefined(args.durationFrames) || MCP.isDefined(args.easing);
    var animate = MCP.isDefined(args.animate) ? MCP.bool(args.animate, false) : timed;
    var anim = null;
    if (animate) {
        var t0 = MCP.snapToFrame(host, MCP.durationArg(host, args, "startTime", "startFrame", host.time));
        var dur = MCP.durationArg(host, args, "duration", "durationFrames", 0.8);
        if (!(dur > 0)) { MCP.fail("duration must be greater than 0.", "invalid-argument"); }
        if (MCP.isDefined(args.easing)) { MCP.easing.resolve(args.easing); }
        anim = { t0: t0, t1: t0 + Math.max(MCP.frameDuration(host), MCP.snapToFrame(host, dur)), easing: MCP.isDefined(args.easing) ? args.easing : MCP.charts.EASE_LAND };
    }

    // The axis after the change, from every value the chart will show.
    var axisPlan = null, notes = [];
    if (meta.axis && MCP.bool(args.rescale, true)) {
        var tRead = anim ? anim.t1 : host.time;
        var all = [];
        for (i = 0; i < meta.items.length; i++) {
            var mi = meta.items[i], newV = null;
            for (j = 0; j < plan.length; j++) { if (plan[j].item.effect === mi.effect) { newV = plan[j].value; } }
            if (newV === null) {
                var cp = MCP.charts.readControl(loc, mi.effect).prop;
                newV = cp ? MCP.charts.readAt(cp, tRead) * scale : 0;
            }
            all.push(newV);
        }
        var mxProp = MCP.charts.controlProp(loc, "Axis Max", false);
        var mnProp = meta.axis.hasMin ? MCP.charts.controlProp(loc, "Axis Min", false) : null;
        if (loc.instance && (!mxProp || (meta.axis.hasMin && !mnProp))) {
            notes.push("The instance does not have Axis Max" + (meta.axis.hasMin ? " and Axis Min" : "") + " as Essential Properties, so the axis was not rescaled.");
        } else if (mxProp) {
            var cur = { max: MCP.charts.readAt(mxProp, tRead) * scale, min: mnProp ? MCP.charts.readAt(mnProp, tRead) * scale : 0 };
            var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
            var next = MCP.charts.rescale(meta.axis, lo, hi, cur);
            if (Math.abs(next.max - cur.max) > 1e-9 * Math.max(1, Math.abs(cur.max)) || Math.abs(next.min - cur.min) > 1e-9 * Math.max(1, Math.abs(cur.min))) {
                if (Math.abs(next.max / scale) >= MCP.charts.SLIDER_LIMIT || Math.abs(next.min / scale) >= MCP.charts.SLIDER_LIMIT) {
                    MCP.fail("The new axis (" + next.min + " to " + next.max + ") is beyond what the chart's sliders can hold at scale " + scale + ". Build the chart again with this data.", "invalid-argument");
                }
                axisPlan = { before: cur, after: next, maxProp: mxProp, minProp: mnProp };
            }
            if (!meta.axis.autoMax && hi > cur.max) { notes.push("The axis max is fixed at " + MCP.round(cur.max) + "; values above it reach past the top of the plot."); }
        }
    }

    // Write.
    var changed = [];
    for (i = 0; i < plan.length; i++) {
        var p = plan[i];
        var res = MCP.charts.writeControl(p.prop, p.value / scale, anim, notes, p.item.label);
        changed.push({ label: p.item.label, effect: p.item.effect, from: MCP.round(res.from * scale), to: MCP.round(p.value), keys: res.keys });
    }
    var axisOut = null;
    if (axisPlan) {
        axisOut = { before: { min: MCP.round(axisPlan.before.min), max: MCP.round(axisPlan.before.max) }, after: { min: MCP.round(axisPlan.after.min), max: MCP.round(axisPlan.after.max) }, keys: [] };
        if (Math.abs(axisPlan.after.max - axisPlan.before.max) > 1e-9 * Math.max(1, Math.abs(axisPlan.before.max))) {
            var rm = MCP.charts.writeControl(axisPlan.maxProp, axisPlan.after.max / scale, anim, notes, "Axis Max");
            if (rm.keys) { axisOut.keys = axisOut.keys.concat(rm.keys); }
        }
        if (axisPlan.minProp && Math.abs(axisPlan.after.min - axisPlan.before.min) > 1e-9 * Math.max(1, Math.abs(axisPlan.before.min))) {
            var rn = MCP.charts.writeControl(axisPlan.minProp, axisPlan.after.min / scale, anim, notes, "Axis Min");
            if (rn.keys) { axisOut.keys = axisOut.keys.concat(rn.keys); }
        }
    }
    return {
        composition: MCP.serialize.compRef(host),
        chart: { name: meta.name, type: meta.type, controls: MCP.serialize.layerRef(loc.ctrl), component: loc.instance ? loc.comp.name : null },
        target: loc.instance ? "instance" : "controls",
        instance: loc.instance ? MCP.serialize.layerRef(loc.instance) : null,
        animated: !!anim,
        startTime: anim ? MCP.round(anim.t0) : null, endTime: anim ? MCP.round(anim.t1) : null,
        startFrame: anim ? MCP.frameOf(host, anim.t0) : null, endFrame: anim ? MCP.frameOf(host, anim.t1) : null,
        easing: anim ? (MCP.isDefined(args.easing) ? args.easing : MCP.charts.LAND_TEXT) : null,
        changed: changed, axis: axisOut,
        dataSource: MCP.isDefined(args.dataSource) ? args.dataSource : null,
        notes: notes
    };
}, { mutating: true });
