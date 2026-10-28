// Figma to After Effects: the plan made from a Figma frame (positions, kinds, text metrics, effects, notes).
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseFigmaUrl, pickNode, planFigma } from '../../src/tools/figma.js';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'figma', 'pricing-card.json'), 'utf8'));

describe('Figma links', () => {
  it('reads the file key and node id', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/AbC123/Site?node-id=12-34&t=x')).toEqual({ fileKey: 'AbC123', nodeId: '12:34' });
    expect(parseFigmaUrl('https://figma.com/file/Zz9/Old')).toEqual({ fileKey: 'Zz9', nodeId: null });
    expect(() => parseFigmaUrl('https://example.com')).toThrow(/Not a Figma/);
  });
});

describe('naming', () => {
  it('names auto-named layers by role and cards by their title', () => {
    const frame = { id: '1', name: 'Frame 12', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 900 }, children: [
      { id: '2', name: 'Frame 13', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 380, height: 300 }, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }], children: [
        { id: '3', name: 'Vector', type: 'VECTOR', absoluteBoundingBox: { x: 20, y: 20, width: 24, height: 24 }, size: { x: 24, y: 24 }, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }], fillGeometry: [{ path: 'M0 0L24 0L24 24Z' }] },
        { id: '4', name: 'Live Online', type: 'TEXT', characters: 'Live Online', absoluteBoundingBox: { x: 20, y: 60, width: 200, height: 30 }, style: { fontSize: 24 } },
        { id: '5', name: 'Deliver live classes.', type: 'TEXT', characters: 'Deliver live classes.', absoluteBoundingBox: { x: 20, y: 100, width: 300, height: 40 }, style: { fontSize: 14 } } ] },
      { id: '6', name: 'Rectangle 9', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 300 }, size: { x: 100, y: 300 },
        fills: [{ type: 'GRADIENT_LINEAR', gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }], gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 0 } }] }] } ] };
    const p = planFigma(frame, 1);
    expect(p.layers.map((l) => `${l.parent ?? 'root'}:${l.name}`)).toEqual(['root:Card · Live Online', '2:Background', '2:Icon', '2:Title', '2:Description', 'root:Edge fade left']);
    expect(p.rootName).toBe('Figma · Card · Live Online');
  });
});

describe('planFigma', () => {
  const plan = planFigma(pickNode(fixture, '1:2'), 1);
  const by = (name: string) => plan.layers.find((l) => l.path.endsWith(name) && l.kind !== 'group' && l.name !== 'Background') ?? plan.layers.find((l) => l.path.endsWith(name))!;

  it('flattens the frame bottom to top, relative to the frame, skipping hidden nodes', () => {
    expect(plan.frame).toMatchObject({ name: 'Pricing card', width: 1440, height: 900 });
    expect(plan.frame.background?.[0]).toBeCloseTo(0.961, 2);
    expect(plan.layers.map((l) => l.name)).toEqual(['Glow', 'Card', 'Header band', 'Plan', 'Badge dot', 'Price', 'Description', 'Check', 'Label', 'Check 2', 'Label 2', 'Check 3', 'Label 3', 'Button', 'Background', 'Label', 'Blur panel', 'Background']);
    expect(plan.layers.filter((l) => l.kind === 'group').map((l) => l.name)).toEqual(['Button', 'Blur panel']);
    expect(plan.layers.find((l) => l.path === 'Button / Label')?.parent).toBe('2:9');
    expect(by('Card')).toMatchObject({ kind: 'rect', x: 420, y: 150, w: 600, h: 600, radius: 24, stroke: { width: 1, align: 'inside' } });
    expect(plan.layers.some((l) => l.name === 'Old badge')).toBe(false);
  });

  it('keeps per-corner radii as path geometry and rebuilds the gradient', () => {
    const band = by('Header band');
    expect(band.kind).toBe('path');
    expect(band.paths?.[0].vertices[0]).toEqual([-276, -60]);
    expect(band.gradient).toMatchObject({ type: 'linear', fade: false });
    expect(band.gradient?.stops.map((st) => st.position)).toEqual([0, 1]);
  });

  it('converts text metrics and alignment', () => {
    expect(by('Price').text).toMatchObject({ size: 64, tracking: -20, box: false, align: 'left', font: 'SFProDisplay-Bold' });
    expect(by('Description').text).toMatchObject({ leading: 24, box: true });
    expect(by('Button / Label').text).toMatchObject({ align: 'center' });
  });

  it('keeps effects for the builder', () => {
    expect(by('Glow').blur).toBe(60);
    expect(by('Card').shadows?.[0]).toMatchObject({ dx: 0, dy: 8, radius: 24 });
    expect(plan.layers.find((l) => l.kind === 'group' && l.name === 'Blur panel')?.backgroundBlur).toBe(30);
  });

  it('scales every size and position', () => {
    const s = planFigma(pickNode(fixture, null), 4 / 3);
    const card = s.layers.find((l) => l.name === 'Card')!;
    expect(s.frame.width).toBe(1920);
    expect(card).toMatchObject({ x: 560, y: 200, w: 800, radius: 32 });
    expect(s.layers.find((l) => l.name === 'Price')!.text!.size).toBeCloseTo(85.333, 2);
  });
});
