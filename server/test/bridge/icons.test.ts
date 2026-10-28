// Icons from open sets: SVG elements become path data, styles map to fills and strokes, names are searched offline from the cache.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { callTool, makeTestBridge, makeTestServer, type TestBridge } from '../helpers.js';
import { elementToPath, iconFile, parseIconSvg, rankIcons } from '../../src/tools/icons.js';
import { parseSvgPath } from '../../src/tools/svg-path.js';

let tb: TestBridge;
let client: any;

const LUCIDE = `<!-- @license lucide-static - ISC -->
<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10" />
  <path d="m16 9-5.5 5.5L8 12" />
</svg>`;
const MATERIAL = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 -960 960 960"><path d="M220-180h150v-250h220v250h150v-390L480-765 220-570v390Z"/></svg>';
const DUOTONE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,120v96H40V120Z" opacity="0.2"/><path d="M219,108l-80-80L37,108Z"/></svg>';

function cache(pkg: string, file: string, text: string) {
  const f = path.join(tb.dir, 'icons', pkg.replace('/', '__'), file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
  cache('lucide-static@1.56.0', 'icons/circle-check.svg', LUCIDE);
  cache('lucide-static@1.56.0', 'tags.json', JSON.stringify({ 'circle-check': ['done', 'tick'], 'check': ['done'], 'send': ['message', 'paper plane'], 'send-horizontal': ['message'] }));
  cache('@material-symbols/svg-400@0.48.0', 'rounded/home-fill.svg', MATERIAL);
  cache('@phosphor-icons/core@2.1.1', 'assets/duotone/house-duotone.svg', DUOTONE);
  cache('@phosphor-icons/core@2.1.1', '.files.json', JSON.stringify({ files: [{ name: '/assets/regular/house.svg' }, { name: '/assets/regular/house-line.svg' }, { name: '/assets/bold/house-bold.svg' }] }));
});
afterAll(() => tb.cleanup());

describe('icon SVG parsing', () => {
  it('turns circles, rects, lines and polygons into path data that parses', () => {
    for (const [tag, a] of [
      ['circle', { cx: '12', cy: '12', r: '10' }],
      ['ellipse', { cx: '12', cy: '12', rx: '10', ry: '4' }],
      ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
      ['rect', { x: '3', y: '3', width: '18', height: '18' }],
      ['line', { x1: '2', y1: '2', x2: '22', y2: '22' }],
      ['polyline', { points: '2 2 12 12 22 2' }],
      ['polygon', { points: '12,2 22,22 2,22' }],
    ] as Array<[string, Record<string, string>]>) {
      const d = elementToPath(tag, a);
      expect(d, tag).toBeTruthy();
      expect(parseSvgPath(d as string).length, tag).toBeGreaterThan(0);
    }
    expect(elementToPath('circle', { cx: '1', cy: '1', r: '0' })).toBeNull();
  });

  it('reads stroke settings and groups parts by fill, stroke and opacity', () => {
    const lucide = parseIconSvg(LUCIDE);
    expect(lucide).toMatchObject({ viewBox: [0, 0, 24, 24], strokeWidth: 2, lineCap: 'round', lineJoin: 'round' });
    expect(lucide.parts).toHaveLength(1);
    expect(lucide.parts[0].kind).toBe('stroke');
    expect(lucide.parts[0].d).toEqual(['M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z', 'm16 9-5.5 5.5L8 12']);
    expect(parseIconSvg(MATERIAL)).toMatchObject({ viewBox: [0, -960, 960, 960], parts: [{ kind: 'fill', opacity: 100 }] });
    expect(parseIconSvg(DUOTONE).parts.map((p) => p.opacity)).toEqual([20, 100]);
    expect(() => parseIconSvg('<svg viewBox="0 0 24 24"><g transform="x"></g></svg>')).toThrow(/draws nothing/);
  });

  it('keeps a leading relative moveto relative to its own element', () => {
    const subpaths = parseIconSvg(LUCIDE).parts[0].d.flatMap((d) => parseSvgPath(d));
    const check = subpaths[subpaths.length - 1];
    expect(check.start).toEqual([16, 9]);
  });

  it('builds package paths and ranks names', () => {
    expect(iconFile('lucide', 'send')).toBe('icons/send.svg');
    expect(iconFile('material', 'home', 'rounded', true)).toBe('rounded/home-fill.svg');
    expect(iconFile('phosphor', 'house')).toBe('assets/regular/house.svg');
    expect(iconFile('phosphor', 'house', 'bold')).toBe('assets/bold/house-bold.svg');
    expect(rankIcons(['send-horizontal', 'send', 'circle-check'], { 'circle-check': ['tick'] }, 'send')).toEqual(['send', 'send-horizontal']);
    expect(rankIcons(['circle-check', 'check'], { 'circle-check': ['tick'] }, 'tick')).toEqual(['circle-check']);
  });
});

describe('add-icon and search-icons', () => {
  it('draws a Lucide icon as a stroked group with round caps scaled to the size', async () => {
    const r = await callTool(client, 'add-icon', { name: 'circle-check', size: 240, color: '#FF0000' });
    expect(r.isError, r.text).toBe(false);
    const args = tb.mock.state.lastArgs as Record<string, unknown>;
    expect(tb.mock.state.lastCommand).toBe('shapeFromSvgPath');
    expect(args).toMatchObject({ noFill: true, strokeColor: [1, 0, 0, 1], strokeWidth: 20, lineCap: 'round', lineJoin: 'round', name: 'Icon circle-check' });
    expect((r.json as any).license).toMatch(/ISC/);
  });

  it('draws a Phosphor duotone icon as a tinted group plus a solid group on one layer', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'add-icon', { name: 'house', set: 'phosphor', style: 'duotone', size: 128 });
    expect(r.isError, r.text).toBe(false);
    expect(tb.mock.state.commandsRun - before).toBe(2);
    expect((r.json as any).groups.map((g: { opacity: number }) => g.opacity)).toEqual([20, 100]);
    expect((tb.mock.state.lastArgs as any).layer).toBeTruthy();
  });

  it('draws a filled Material symbol and refuses a wrong style', async () => {
    const ok = await callTool(client, 'add-icon', { name: 'home', set: 'material', style: 'rounded', filled: true });
    expect(ok.isError, ok.text).toBe(false);
    expect(tb.mock.state.lastArgs).toMatchObject({ fillColor: '#FFFFFF' });
    const bad = await callTool(client, 'add-icon', { name: 'home', set: 'material', style: 'bold' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/outlined, rounded, sharp/);
  });

  it('searches names offline from the cache', async () => {
    const r = await callTool(client, 'search-icons', { query: 'house', set: 'phosphor' });
    expect((r.json as any).names).toEqual(['house', 'house-line']);
    const l = await callTool(client, 'search-icons', { query: 'paper plane' });
    expect((l.json as any).names).toEqual(['send']);
  });
});
