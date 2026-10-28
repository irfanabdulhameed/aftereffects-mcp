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

describe('planFigma', () => {
  const plan = planFigma(pickNode(fixture, '1:2'), 1);
  const by = (name: string) => plan.layers.find((l) => l.path.endsWith(name))!;

  it('flattens the frame bottom to top, relative to the frame, skipping hidden nodes', () => {
    expect(plan.frame).toMatchObject({ name: 'Pricing card', width: 1440, height: 900 });
    expect(plan.frame.background?.[0]).toBeCloseTo(0.961, 2);
    expect(plan.layers.map((l) => l.name)).toEqual(['Glow', 'Card', 'Header band', 'Plan', 'Badge dot', 'Price', 'Description', 'Check', 'Label', 'Check', 'Label', 'Check', 'Label', 'Button', 'Label', 'Blur panel']);
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
    expect(by('Blur panel').backgroundBlur).toBe(30);
  });

  it('scales every size and position', () => {
    const s = planFigma(pickNode(fixture, null), 4 / 3);
    const card = s.layers.find((l) => l.name === 'Card')!;
    expect(s.frame.width).toBe(1920);
    expect(card).toMatchObject({ x: 560, y: 200, w: 800, radius: 32 });
    expect(s.layers.find((l) => l.name === 'Price')!.text!.size).toBeCloseTo(85.333, 2);
  });
});
