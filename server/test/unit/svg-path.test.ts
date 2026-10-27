import { describe, expect, it } from 'vitest';
import { AeShapePath, arcToCubics, parseSvgPath, pathBounds, placementFor, svgPathToAe, SvgPathError, toAeShapes } from '../../src/tools/svg-path.js';

type P = [number, number];

/** Point on segment i of an AE path at parameter t. */
function pointOn(path: AeShapePath, i: number, t: number): P {
  const n = path.vertices.length;
  const a = path.vertices[i];
  const b = path.vertices[(i + 1) % n];
  const p1: P = [a[0] + path.outTangents[i][0], a[1] + path.outTangents[i][1]];
  const p2: P = [b[0] + path.inTangents[(i + 1) % n][0], b[1] + path.inTangents[(i + 1) % n][1]];
  const u = 1 - t;
  return [
    u * u * u * a[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * b[0],
    u * u * u * a[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * b[1],
  ];
}

function segmentCount(path: AeShapePath): number {
  return path.closed ? path.vertices.length : path.vertices.length - 1;
}

/** Largest distance from centre minus radius over sampled points of every segment. */
function circleError(path: AeShapePath, c: P, r: number): number {
  let worst = 0;
  for (let i = 0; i < segmentCount(path); i++) {
    for (let k = 0; k <= 10; k++) {
      const p = pointOn(path, i, k / 10);
      worst = Math.max(worst, Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - r));
    }
  }
  return worst;
}

describe('parseSvgPath and toAeShapes: real icon paths', () => {
  it('Material "add": a closed polygon with straight edges and zero tangents', () => {
    const [path] = toAeShapes(parseSvgPath('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'));
    expect(path.closed).toBe(true);
    expect(path.vertices.length).toBe(12);
    expect(path.vertices[0]).toEqual([19, 13]);
    expect(path.vertices).toContainEqual([11, 19]);
    expect(path.inTangents.every((t) => t[0] === 0 && t[1] === 0)).toBe(true);
    expect(path.outTangents.every((t) => t[0] === 0 && t[1] === 0)).toBe(true);
  });

  it('Material "favorite" (heart): implicit repeated curves, relative c, folded closing vertex', () => {
    const d = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
    const sub = parseSvgPath(d);
    expect(sub.length).toBe(1);
    const [path] = toAeShapes(sub);
    expect(path.closed).toBe(true);
    // The final L lands on the start point, so that vertex is folded into the first.
    expect(path.vertices[0]).toEqual([12, 21.35]);
    expect(path.vertices.length).toBe(8);
    const b = pathBounds(sub)!;
    expect(b.left).toBeCloseTo(2, 3);
    expect(b.left + b.width).toBeCloseTo(22, 3);
    expect(b.top).toBeCloseTo(3, 3);
    expect(b.top + b.height).toBeCloseTo(21.35, 3);
    // Curve handles are relative to their vertex: the segment from (2, 8.5) to (7.5, 3) keeps its first control point.
    const i = path.vertices.findIndex((v) => v[0] === 2 && v[1] === 8.5);
    expect(path.outTangents[i]).toEqual([0, -3.08]);
  });

  it('Bootstrap "circle": arcs become circle-accurate cubics, two subpaths', () => {
    const d = 'M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16';
    const paths = toAeShapes(parseSvgPath(d));
    expect(paths.length).toBe(2);
    expect(paths[0].vertices[0]).toEqual([8, 15]);
    expect(paths[1].vertices[0]).toEqual([8, 16]);
    expect(circleError(paths[0], [8, 8], 7)).toBeLessThan(0.01);
    expect(circleError(paths[1], [8, 8], 8)).toBeLessThan(0.01);
    // Each half circle is split into two 90 degree pieces.
    expect(paths[0].vertices.length).toBe(5);
  });

  it('Lucide "check": implicit lineto after moveto, open path', () => {
    const [path] = toAeShapes(parseSvgPath('M20 6 9 17l-5-5'));
    expect(path.closed).toBe(false);
    expect(path.vertices).toEqual([[20, 6], [9, 17], [4, 12]]);
  });

  it('Quadratic Q and smooth T: control points raised to cubic, T reflects the last control point', () => {
    const sub = parseSvgPath('M10 80 Q 52.5 10, 95 80 T 180 80');
    expect(sub[0].segments.length).toBe(2);
    const s1 = sub[0].segments[0];
    expect(s1.c1[0]).toBeCloseTo(10 + (2 / 3) * (52.5 - 10), 6);
    expect(s1.c1[1]).toBeCloseTo(80 + (2 / 3) * (10 - 80), 6);
    // Reflection of (52.5, 10) about (95, 80) is (137.5, 150).
    const s2 = sub[0].segments[1];
    expect(s2.c1[0]).toBeCloseTo(95 + (2 / 3) * (137.5 - 95), 6);
    expect(s2.c2[1]).toBeCloseTo(80 + (2 / 3) * (150 - 80), 6);
  });

  it('Smooth cubic S reflects the previous second control point', () => {
    const sub = parseSvgPath('M 10,90 C 30,90 25,10 50,10 S 70,90 90,90');
    expect(sub[0].segments[1].c1).toEqual([75, 10]);
    expect(sub[0].segments[1].c2).toEqual([70, 90]);
  });

  it('S after a line starts its first control point at the current point', () => {
    const sub = parseSvgPath('M0 0 L10 0 S20 10 30 0');
    expect(sub[0].segments[1].c1).toEqual([10, 0]);
  });

  it('compact number formats: ".5.5", exponents, signs as separators', () => {
    const [path] = toAeShapes(parseSvgPath('M.5.5L-1e1-2e0h3v-.5z'));
    expect(path.vertices).toEqual([[0.5, 0.5], [-10, -2], [-7, -2], [-7, -2.5]]);
    expect(path.closed).toBe(true);
  });

  it('packed arc flags ("0 105 5") are read one character at a time', () => {
    const a = parseSvgPath('M0 0a5 5 0 105 5');
    const b = parseSvgPath('M0 0a5 5 0 1 0 5 5');
    expect(a).toEqual(b);
  });

  it('arc direction: sweep 1 from (0,0) to (20,0) passes through (10,-10)', () => {
    const [path] = toAeShapes(parseSvgPath('M0 0 A10 10 0 0 1 20 0'));
    expect(path.vertices.length).toBe(3);
    expect(path.vertices[1][0]).toBeCloseTo(10, 6);
    expect(path.vertices[1][1]).toBeCloseTo(-10, 6);
    expect(circleError(path, [10, 0], 10)).toBeLessThan(0.01);
  });

  it('radii too small to reach are scaled up; zero radius is a straight line', () => {
    const [scaled] = toAeShapes(parseSvgPath('M0 0 A1 1 0 0 1 20 0'));
    expect(circleError(scaled, [10, 0], 10)).toBeLessThan(0.01);
    const [flat] = toAeShapes(parseSvgPath('M0 0 A0 5 0 0 1 20 0'));
    expect(flat.vertices).toEqual([[0, 0], [20, 0]]);
    expect(flat.outTangents[0]).toEqual([0, 0]);
  });

  it('rotated elliptical arc ends exactly on its endpoint', () => {
    const segs = arcToCubics([0, 0], 30, 10, 45, true, false, [20, 20]);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs[segs.length - 1].end).toEqual([20, 20]);
  });

  it('a command after Z starts a new subpath at the previous start', () => {
    const sub = parseSvgPath('M0 0 L10 0 L10 10 Z L0 10 L-5 5');
    expect(sub.length).toBe(2);
    expect(sub[0].closed).toBe(true);
    expect(sub[1].start).toEqual([0, 0]);
  });

  it('rejects bad data with a position', () => {
    expect(() => parseSvgPath('L10 10')).toThrow(SvgPathError);
    expect(() => parseSvgPath('M10')).toThrow(/needs 2 numbers/);
    expect(() => parseSvgPath('M10 10 X')).toThrow(/position 7/);
    expect(() => parseSvgPath('M0 0 a5 5 0 2 0 5 5')).toThrow(/flag/);
    expect(() => parseSvgPath('   ')).toThrow(/empty/);
  });
});

describe('placement', () => {
  it('fits a viewBox into a size and centres it on the group origin', () => {
    const r = svgPathToAe('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z', { viewBox: [0, 0, 24, 24], size: [240, 240] });
    expect(r.placement.scale).toEqual([10, 10]);
    expect(r.placement.origin).toEqual([12, 12]);
    expect(r.paths[0].vertices[0]).toEqual([70, 10]);
    expect(r.bounds).toEqual({ left: -70, top: -70, width: 140, height: 140 });
    expect(r.sourceBounds).toEqual({ left: 5, top: 5, width: 14, height: 14 });
    expect(r.vertexCount).toBe(12);
  });

  it('scale wins over size; offset moves the result; center false keeps path units', () => {
    const p = placementFor({ viewBox: [0, 0, 24, 24], size: [240, 240], scale: 2, offset: [100, 50], center: false }, null);
    expect(p).toEqual({ scale: [2, 2], origin: [0, 0], offset: [100, 50] });
    const r = svgPathToAe('M20 6 9 17l-5-5', { scale: 2, offset: [100, 50], center: false });
    expect(r.paths[0].vertices[0]).toEqual([140, 62]);
  });

  it('without a viewBox, size fits the path bounds and centres them', () => {
    const r = svgPathToAe('M0 0 H100 V50 H0 Z', { size: [200, 200] });
    expect(r.placement.scale).toEqual([2, 2]);
    expect(r.bounds).toEqual({ left: -100, top: -50, width: 200, height: 100 });
  });

  it('tangents scale with the placement', () => {
    const r = svgPathToAe('M0 0 C0 10 10 10 10 0', { scale: 3, center: false });
    expect(r.paths[0].outTangents[0]).toEqual([0, 30]);
    expect(r.paths[0].inTangents[1]).toEqual([0, 30]);
  });

  it('only movetos draw nothing', () => {
    expect(() => svgPathToAe('M0 0 M10 10')).toThrow(/draws nothing/);
  });
});
