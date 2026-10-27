/*
 * SVG path data to After Effects shape paths, on the Node side.
 *
 * parseSvgPath(d) reads a path "d" string (M, L, H, V, C, S, Q, T, A, Z and
 * their relative forms) into subpaths made only of cubic bezier segments:
 * lines become cubics with handles on the line, quadratics are raised to
 * cubics, and elliptical arcs are split into pieces of at most 90 degrees and
 * approximated with one cubic each.
 *
 * toAeShapes(subpaths, transform) turns those into the After Effects Shape
 * layout: vertices, inTangents and outTangents (relative to each vertex) and
 * closed. Straight segments get zero tangents, so a polygon stays a polygon.
 */

export type Pt = [number, number];

export interface CubicSegment {
  c1: Pt;
  c2: Pt;
  end: Pt;
  /** true when the segment came from L, H, V or a straight Z close. */
  line: boolean;
}

export interface SvgSubpath {
  start: Pt;
  segments: CubicSegment[];
  closed: boolean;
}

export interface AeShapePath {
  vertices: Pt[];
  inTangents: Pt[];
  outTangents: Pt[];
  closed: boolean;
}

export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class SvgPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgPathError';
  }
}

/* ---------------------------------------------------------------- tokenizer */

const COMMAND_RE = /[MmLlHhVvCcSsQqTtAaZz]/;
const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

type Token = { kind: 'cmd'; value: string; at: number } | { kind: 'num'; value: number; at: number };

/** Reads one number at i. Returns [value, nextIndex] or null. Handles "1.5.5", "-.5", "1e-3". */
function readNumber(d: string, i: number): [number, number] | null {
  const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i, i + 64));
  if (!m || m[0] === '' || m[0] === '+' || m[0] === '-') return null;
  return [Number(m[0]), i + m[0].length];
}

function isSeparator(c: string): boolean {
  return c === ' ' || c === ',' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

/**
 * Tokenizes path data. Arc flags are read as single 0/1 characters, because
 * "a1 1 0 00 1 1" packs the two flags without separators.
 */
function tokenize(d: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let cmd = '';
  let argIndex = 0;
  while (i < d.length) {
    const c = d[i];
    if (isSeparator(c)) {
      i++;
      continue;
    }
    if (COMMAND_RE.test(c)) {
      out.push({ kind: 'cmd', value: c, at: i });
      cmd = c.toUpperCase();
      argIndex = 0;
      i++;
      continue;
    }
    if (cmd === 'A' && (argIndex % 7 === 3 || argIndex % 7 === 4)) {
      if (c !== '0' && c !== '1') throw new SvgPathError(`Arc flag at position ${i} must be 0 or 1, found "${c}".`);
      out.push({ kind: 'num', value: c === '1' ? 1 : 0, at: i });
      argIndex++;
      i++;
      continue;
    }
    const n = readNumber(d, i);
    if (!n) throw new SvgPathError(`Unexpected "${c}" at position ${i} in the path data.`);
    out.push({ kind: 'num', value: n[0], at: i });
    argIndex++;
    i = n[1];
  }
  return out;
}

/* ---------------------------------------------------------------- geometry */

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const near = (a: Pt, b: Pt, eps = 1e-6): boolean => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;

function lineSeg(from: Pt, to: Pt): CubicSegment {
  return { c1: lerp(from, to, 1 / 3), c2: lerp(from, to, 2 / 3), end: to, line: true };
}

function quadSeg(from: Pt, q: Pt, to: Pt): CubicSegment {
  return { c1: add(from, mul(sub(q, from), 2 / 3)), c2: add(to, mul(sub(q, to), 2 / 3)), end: to, line: false };
}

/** SVG elliptical arc (endpoint form) to cubic segments of at most 90 degrees each. */
export function arcToCubics(from: Pt, rxIn: number, ryIn: number, xAxisRotationDeg: number, largeArc: boolean, sweep: boolean, to: Pt): CubicSegment[] {
  if (near(from, to, 1e-9)) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [lineSeg(from, to)];
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  // Step 1: transform to the ellipse's own axes, midpoint form.
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  // Step 2: scale radii up when they cannot reach.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  // Step 3: centre in the ellipse's axes.
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;
  // Step 4: centre in user space.
  const cx = cosPhi * cxp - sinPhi * cyp + (from[0] + to[0]) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from[1] + to[1]) / 2;
  // Step 5: start angle and sweep.
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  // Step 6: split into pieces of at most 90 degrees.
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): Pt => {
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return [cosPhi * x - sinPhi * y + cx, sinPhi * x + cosPhi * y + cy];
  };
  const deriv = (t: number): Pt => {
    const x = -rx * Math.sin(t);
    const y = ry * Math.cos(t);
    return [cosPhi * x - sinPhi * y, sinPhi * x + cosPhi * y];
  };
  const out: CubicSegment[] = [];
  let t0 = theta1;
  let p0 = from;
  for (let i = 0; i < pieces; i++) {
    const t1 = t0 + step;
    const p1 = i === pieces - 1 ? to : point(t1);
    out.push({ c1: add(p0, mul(deriv(t0), k)), c2: sub(p1, mul(deriv(t1), k)), end: p1, line: false });
    t0 = t1;
    p0 = p1;
  }
  return out;
}

/* ------------------------------------------------------------------ parser */

/** Parses SVG path data into subpaths of cubic segments. Throws SvgPathError with a position on bad input. */
export function parseSvgPath(d: string): SvgSubpath[] {
  if (typeof d !== 'string' || !d.trim()) throw new SvgPathError('Path data is empty.');
  const tokens = tokenize(d);
  const subpaths: SvgSubpath[] = [];
  let current: SvgSubpath | null = null;
  let pos: Pt = [0, 0];
  let lastCubicC2: Pt | null = null;
  let lastQuadCtrl: Pt | null = null;
  let i = 0;
  let cmd = '';

  const take = (n: number, at: number): number[] => {
    const vals: number[] = [];
    for (let k = 0; k < n; k++) {
      const t = tokens[i + k];
      if (!t || t.kind !== 'num') throw new SvgPathError(`Command "${cmd}" at position ${at} needs ${n} numbers.`);
      vals.push(t.value);
    }
    i += n;
    return vals;
  };
  const ensure = (): SvgSubpath => {
    if (!current) {
      current = { start: [pos[0], pos[1]], segments: [], closed: false };
      subpaths.push(current);
    }
    return current;
  };

  if (tokens.length && tokens[0].kind !== 'cmd') throw new SvgPathError('Path data must start with a moveto command (M or m).');
  while (i < tokens.length) {
    const tok = tokens[i];
    let at = tok.at;
    if (tok.kind === 'cmd') {
      cmd = tok.value;
      i++;
      at = tok.at;
      if (!subpaths.length && cmd !== 'M' && cmd !== 'm') throw new SvgPathError('Path data must start with a moveto command (M or m).');
      if (cmd === 'Z' || cmd === 'z') {
        if (current) {
          const sp: SvgSubpath = current;
          sp.closed = true;
          pos = [sp.start[0], sp.start[1]];
        }
        current = null;
        lastCubicC2 = null;
        lastQuadCtrl = null;
        continue;
      }
      if (i >= tokens.length || tokens[i].kind !== 'num') throw new SvgPathError(`Command "${cmd}" at position ${at} has no numbers.`);
    } else if (!cmd || cmd === 'Z' || cmd === 'z') {
      throw new SvgPathError(`Number at position ${at} does not follow a command.`);
    }
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const vals = take(ARG_COUNT[upper], at);
    const base: Pt = rel ? pos : [0, 0];
    const P = (x: number, y: number): Pt => [base[0] + x, base[1] + y];
    let cubicC2: Pt | null = null;
    let quadCtrl: Pt | null = null;
    switch (upper) {
      case 'M': {
        pos = P(vals[0], vals[1]);
        current = { start: [pos[0], pos[1]], segments: [], closed: false };
        subpaths.push(current);
        // Extra coordinate pairs after a moveto are implicit linetos.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        const to = P(vals[0], vals[1]);
        ensure().segments.push(lineSeg(pos, to));
        pos = to;
        break;
      }
      case 'H': {
        const to: Pt = [rel ? pos[0] + vals[0] : vals[0], pos[1]];
        ensure().segments.push(lineSeg(pos, to));
        pos = to;
        break;
      }
      case 'V': {
        const to: Pt = [pos[0], rel ? pos[1] + vals[0] : vals[0]];
        ensure().segments.push(lineSeg(pos, to));
        pos = to;
        break;
      }
      case 'C': {
        const c1 = P(vals[0], vals[1]);
        const c2 = P(vals[2], vals[3]);
        const to = P(vals[4], vals[5]);
        ensure().segments.push({ c1, c2, end: to, line: false });
        cubicC2 = c2;
        pos = to;
        break;
      }
      case 'S': {
        const c1: Pt = lastCubicC2 ? sub(mul(pos, 2), lastCubicC2) : [pos[0], pos[1]];
        const c2 = P(vals[0], vals[1]);
        const to = P(vals[2], vals[3]);
        ensure().segments.push({ c1, c2, end: to, line: false });
        cubicC2 = c2;
        pos = to;
        break;
      }
      case 'Q': {
        const q = P(vals[0], vals[1]);
        const to = P(vals[2], vals[3]);
        ensure().segments.push(quadSeg(pos, q, to));
        quadCtrl = q;
        pos = to;
        break;
      }
      case 'T': {
        const q: Pt = lastQuadCtrl ? sub(mul(pos, 2), lastQuadCtrl) : [pos[0], pos[1]];
        const to = P(vals[0], vals[1]);
        ensure().segments.push(quadSeg(pos, q, to));
        quadCtrl = q;
        pos = to;
        break;
      }
      case 'A': {
        const to = P(vals[5], vals[6]);
        const segs = arcToCubics(pos, vals[0], vals[1], vals[2], vals[3] !== 0, vals[4] !== 0, to);
        const sp = ensure();
        for (const s of segs) sp.segments.push(s);
        pos = to;
        break;
      }
      default:
        throw new SvgPathError(`Unsupported command "${cmd}" at position ${at}.`);
    }
    lastCubicC2 = cubicC2;
    lastQuadCtrl = quadCtrl;
  }
  return subpaths.filter((s) => s.segments.length > 0);
}

/* ------------------------------------------------------------------ bounds */

/** Extrema parameters of one coordinate of a cubic in (0, 1). */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      ts.push((-b + r) / (2 * a), (-b - r) / (2 * a));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Exact bounds of the drawn curves (not the control points). */
export function pathBounds(subpaths: SvgSubpath[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const addPt = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const sp of subpaths) {
    let p0 = sp.start;
    addPt(p0[0], p0[1]);
    for (const s of sp.segments) {
      addPt(s.end[0], s.end[1]);
      for (const t of cubicExtrema(p0[0], s.c1[0], s.c2[0], s.end[0])) addPt(cubicAt(p0[0], s.c1[0], s.c2[0], s.end[0], t), cubicAt(p0[1], s.c1[1], s.c2[1], s.end[1], t));
      for (const t of cubicExtrema(p0[1], s.c1[1], s.c2[1], s.end[1])) addPt(cubicAt(p0[0], s.c1[0], s.c2[0], s.end[0], t), cubicAt(p0[1], s.c1[1], s.c2[1], s.end[1], t));
      p0 = s.end;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/* --------------------------------------------------------------- transform */

export interface PlacementInput {
  viewBox?: [number, number, number, number];
  size?: [number, number];
  scale?: number | [number, number];
  offset?: [number, number];
  /** Move the viewBox centre (or the path's own bounds centre) to [0, 0]. Default true. */
  center?: boolean;
}

export interface Placement {
  scale: [number, number];
  /** Point in path units that lands on the group origin before offset. */
  origin: [number, number];
  offset: [number, number];
}

/**
 * Decides how path units map to layer pixels: p' = (p - origin) * scale + offset.
 * scale wins over size; size fits the viewBox (or the path bounds) inside the
 * box keeping the aspect ratio.
 */
export function placementFor(input: PlacementInput, bounds: Bounds | null): Placement {
  const ref: Bounds | null = input.viewBox
    ? { left: input.viewBox[0], top: input.viewBox[1], width: input.viewBox[2], height: input.viewBox[3] }
    : bounds;
  let scale: [number, number] = [1, 1];
  if (input.scale !== undefined) {
    scale = typeof input.scale === 'number' ? [input.scale, input.scale] : [input.scale[0], input.scale[1]];
  } else if (input.size && ref && ref.width > 0 && ref.height > 0) {
    const s = Math.min(input.size[0] / ref.width, input.size[1] / ref.height);
    scale = [s, s];
  } else if (input.size && ref && (ref.width > 0 || ref.height > 0)) {
    const s = ref.width > 0 ? input.size[0] / ref.width : input.size[1] / ref.height;
    scale = [s, s];
  }
  const center = input.center !== false;
  const origin: [number, number] = center && ref ? [ref.left + ref.width / 2, ref.top + ref.height / 2] : [0, 0];
  return { scale, origin, offset: input.offset ? [input.offset[0], input.offset[1]] : [0, 0] };
}

const round4 = (v: number): number => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
};

/** Converts parsed subpaths to After Effects Shape data under a placement. */
export function toAeShapes(subpaths: SvgSubpath[], placement: Placement = { scale: [1, 1], origin: [0, 0], offset: [0, 0] }): AeShapePath[] {
  const map = (p: Pt): Pt => [round4((p[0] - placement.origin[0]) * placement.scale[0] + placement.offset[0]), round4((p[1] - placement.origin[1]) * placement.scale[1] + placement.offset[1])];
  const vec = (v: Pt): Pt => [round4(v[0] * placement.scale[0]), round4(v[1] * placement.scale[1])];
  const out: AeShapePath[] = [];
  for (const sp of subpaths) {
    const verts: Pt[] = [sp.start];
    const ins: Pt[] = [[0, 0]];
    const outs: Pt[] = [];
    let prev = sp.start;
    for (const s of sp.segments) {
      outs.push(s.line ? [0, 0] : sub(s.c1, prev));
      verts.push(s.end);
      ins.push(s.line ? [0, 0] : sub(s.c2, s.end));
      prev = s.end;
    }
    outs.push([0, 0]);
    // A closed subpath whose last segment lands back on the start: fold the last vertex into the first.
    if (sp.closed && verts.length > 2 && near(verts[verts.length - 1], verts[0], 1e-6)) {
      ins[0] = ins[ins.length - 1];
      verts.pop();
      ins.pop();
      outs.pop();
    }
    out.push({ vertices: verts.map(map), inTangents: ins.map(vec), outTangents: outs.map(vec), closed: sp.closed });
  }
  return out;
}

/** Bounds of AE shape paths in their own (already placed) coordinates, from vertices and handles. */
export function aeShapesBounds(paths: AeShapePath[]): Bounds | null {
  const subpaths: SvgSubpath[] = paths.map((p) => {
    const n = p.vertices.length;
    const segs: CubicSegment[] = [];
    const count = p.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = p.vertices[i];
      const b = p.vertices[(i + 1) % n];
      segs.push({ c1: add(a, p.outTangents[i]), c2: add(b, p.inTangents[(i + 1) % n]), end: b, line: false });
    }
    return { start: p.vertices[0], segments: segs, closed: p.closed };
  });
  const b = pathBounds(subpaths);
  return b ? { left: round4(b.left), top: round4(b.top), width: round4(b.width), height: round4(b.height) } : null;
}

/** One call: parse, place and convert. */
export function svgPathToAe(d: string, placementInput: PlacementInput = {}): { paths: AeShapePath[]; sourceBounds: Bounds | null; bounds: Bounds | null; placement: Placement; vertexCount: number } {
  const subpaths = parseSvgPath(d);
  if (!subpaths.length) throw new SvgPathError('Path data draws nothing (only movetos).');
  const sourceBounds = pathBounds(subpaths);
  const placement = placementFor(placementInput, sourceBounds);
  const paths = toAeShapes(subpaths, placement);
  return {
    paths,
    sourceBounds: sourceBounds ? { left: round4(sourceBounds.left), top: round4(sourceBounds.top), width: round4(sourceBounds.width), height: round4(sourceBounds.height) } : null,
    bounds: aeShapesBounds(paths),
    placement,
    vertexCount: paths.reduce((n, p) => n + p.vertices.length, 0),
  };
}
