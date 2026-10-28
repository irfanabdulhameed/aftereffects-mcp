/*
 * Chart tools: registration, data files, the server and mock bridge round trip,
 * and the ExtendScript itself run against a small fake After Effects object
 * model in a Node vm, with every generated expression evaluated so the bars,
 * lines, slices, counters and labels can be checked by value.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { catalog, prepareBridgeArgs } from '../../src/tools/registry.js';
import { itemsFromJson, itemsFromTable, loadDataFile, parseDelimited, parseNumber, resolveData } from '../../src/tools/charts.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];
let tmpDir: string;

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-charts-'));
});
afterAll(() => {
  tb.cleanup();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const TOOLS = ['create-bar-chart', 'create-line-chart', 'create-pie-chart', 'create-stat', 'create-progress', 'update-chart-data', 'get-chart-data'];

async function rejectedBeforeSend(name: string, args: Record<string, unknown>): Promise<string> {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean; content?: Array<{ text?: string }> };
  expect(res.error !== undefined || res.isError === true, `${name} ${JSON.stringify(args)}`).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
  return res.error ?? res.content?.[0]?.text ?? '';
}

function lastCommand(): string {
  return tb.mock.state.log[tb.mock.state.log.length - 1].command;
}

function bridgeArgs(name: string, args: Record<string, unknown>): Record<string, any> {
  const entry = catalog.find((c) => c.name === name);
  if (!entry) throw new Error(`no tool ${name}`);
  return prepareBridgeArgs(entry, args, tb.client) as Record<string, any>;
}

function writeTmp(name: string, text: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

const QUARTERS = [
  { label: 'Q1', value: 42 },
  { label: 'Q2', value: 58 },
  { label: 'Q3', value: 51 },
  { label: 'Q4', value: 73 },
];

/* ------------------------------------------------------------ registration */

describe('chart tools: registration', () => {
  it('registers every tool in the charts group with a template description of 60 to 200 words', () => {
    for (const name of TOOLS) {
      const entry = catalog.find((c) => c.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.group).toBe('charts');
      expect(entry!.mutating, name).toBe(name !== 'get-chart-data');
      const words = entry!.description.split(/\s+/).length;
      expect(words, `${name}: ${words} words`).toBeGreaterThanOrEqual(60);
      expect(words, `${name}: ${words} words`).toBeLessThanOrEqual(200);
      const labels = ['Use when:', 'Do not use for:', 'Inputs:', 'Returns:', 'Notes:', 'Example:'].map((l) => entry!.description.indexOf(l));
      expect(labels.every((i) => i > 0), name).toBe(true);
      expect([...labels].sort((a, b) => a - b), name).toEqual(labels);
      expect(entry!.description, name).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it('describes every input field and rejects wrong-typed references and unknown easing', () => {
    const described = (schema: z.ZodTypeAny): boolean => {
      let s: z.ZodTypeAny | undefined = schema;
      for (let i = 0; i < 8 && s; i++) {
        if (s.description) return true;
        const def = (s as unknown as { _def: Record<string, unknown> })._def;
        const t = def.typeName as string;
        if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault') s = def.innerType as z.ZodTypeAny;
        else if (t === 'ZodEffects') s = def.schema as z.ZodTypeAny;
        else if (t === 'ZodUnion') return (def.options as z.ZodTypeAny[]).some(described);
        else return ['ZodEnum', 'ZodLiteral', 'ZodBoolean', 'ZodObject', 'ZodArray', 'ZodRecord', 'ZodTuple'].includes(t);
      }
      return false;
    };
    for (const name of TOOLS) {
      const entry = catalog.find((c) => c.name === name)!;
      const schema = z.object(entry.input);
      for (const key of Object.keys(entry.input)) expect(described(entry.input[key] as z.ZodTypeAny), `${name}.${key} needs a .describe()`).toBe(true);
      expect(schema.safeParse({ comp: 42 }).success, name).toBe(false);
      if ('easing' in entry.input) expect(schema.safeParse({ easing: 'bouncy' }).success, name).toBe(false);
      if ('controls' in entry.input) expect(schema.safeParse({ controls: 'Controls' }).success, name).toBe(false);
    }
  });
});

/* -------------------------------------------------------------- data files */

describe('chart data on the server', () => {
  it('parseNumber reads spreadsheet numbers', () => {
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('12,345,678')).toBe(12345678);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('$12K')).toBe(12000);
    expect(parseNumber('2.5M')).toBe(2500000);
    expect(parseNumber('45 %')).toBe(45);
    expect(parseNumber('(120)')).toBe(-120);
    expect(parseNumber('-3.2e3')).toBe(-3200);
    expect(parseNumber(7)).toBe(7);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('12 apples')).toBeNull();
  });

  it('parseDelimited handles quotes, doubled quotes, CRLF and the delimiter in the header', () => {
    expect(parseDelimited('label,value\r\n"Plan, Pro",12\r\n"Say ""hi""",3\n')).toEqual([
      ['label', 'value'],
      ['Plan, Pro', '12'],
      ['Say "hi"', '3'],
    ]);
    expect(parseDelimited('month;users\nJan;1.200\n')).toEqual([['month', 'users'], ['Jan', '1.200']]);
    expect(parseDelimited('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('itemsFromTable finds the label, value and colour columns by name or by content', () => {
    const named = itemsFromTable([['Month', 'Notes', 'Revenue', 'Colour'], ['Jan', 'x', '$1,200', '#ff0000'], ['Feb', 'y', '1,450', '']]);
    expect(named.items).toEqual([{ label: 'Jan', value: 1200, color: '#ff0000' }, { label: 'Feb', value: 1450 }]);
    expect(named.columns).toEqual({ label: 'Month', value: 'Revenue', color: 'Colour' });
    const guessed = itemsFromTable([['Thing', 'Amount2'], ['A', '1'], ['B', '2']]);
    expect(guessed.items.map((i) => i.value)).toEqual([1, 2]);
    const chosen = itemsFromTable([['region', 'q1', 'q2'], ['EU', '1', '5'], ['US', '2', '6']], { value: 'q2' });
    expect(chosen.items).toEqual([{ label: 'EU', value: 5 }, { label: 'US', value: 6 }]);
    expect(() => itemsFromTable([['a', 'b'], ['x', 'nope']], { value: 'b' })).toThrow(/not a number/);
    expect(() => itemsFromTable([['a', 'b']])).toThrow(/header row and at least one/);
    expect(() => itemsFromTable([['a'], ['x']], { value: 'zz' })).toThrow(/not a column/);
  });

  it('itemsFromJson reads objects, pairs, numbers, maps and wrapped arrays', () => {
    expect(itemsFromJson([{ name: 'A', count: 3, color: 'red' }]).items).toEqual([{ label: 'A', value: 3, color: 'red' }]);
    expect(itemsFromJson([['A', '1,000'], ['B', 2]]).items).toEqual([{ label: 'A', value: 1000 }, { label: 'B', value: 2 }]);
    expect(itemsFromJson([5, 6]).items).toEqual([{ label: '1', value: 5 }, { label: '2', value: 6 }]);
    expect(itemsFromJson({ Pro: 62, Team: '28' }).items).toEqual([{ label: 'Pro', value: 62 }, { label: 'Team', value: 28 }]);
    expect(itemsFromJson({ data: [{ label: 'x', value: 1 }] }).items).toEqual([{ label: 'x', value: 1 }]);
    expect(itemsFromJson([{ k: 'a', v: 9 }], { label: 'k', value: 'v' }).items).toEqual([{ label: 'a', value: 9 }]);
    expect(() => itemsFromJson([{ foo: 1 }])).toThrow(/label and a value/);
    expect(() => itemsFromJson('x')).toThrow();
  });

  it('loadDataFile reads CSV, TSV and JSON files and refuses relative paths and other types', () => {
    const csv = writeTmp('rev.csv', '﻿quarter,revenue\nQ1,"42,000"\nQ2,58000\n');
    const res = loadDataFile(csv);
    expect(res.items).toEqual([{ label: 'Q1', value: 42000 }, { label: 'Q2', value: 58000 }]);
    expect(res.source).toMatchObject({ format: 'csv', rows: 2, columns: { label: 'quarter', value: 'revenue', color: null } });
    const tsv = writeTmp('t.tsv', 'name\tvalue\nA\t1\n');
    expect(loadDataFile(tsv).items).toEqual([{ label: 'A', value: 1 }]);
    const json = writeTmp('d.json', JSON.stringify([{ label: 'A', value: 1 }]));
    expect(loadDataFile(json).source.format).toBe('json');
    expect(() => loadDataFile('relative/file.csv')).toThrow(/absolute/);
    expect(() => loadDataFile(path.join(tmpDir, 'missing.csv'))).toThrow(/not found/);
    expect(() => loadDataFile(writeTmp('x.xlsx', 'binary'))).toThrow(/\.csv, \.tsv, \.txt or \.json/);
    expect(() => loadDataFile(writeTmp('bad.json', '{nope'))).toThrow(/not valid JSON/);
  });

  it('resolveData requires one source, unique labels, the value rules and readable colours', () => {
    expect(() => resolveData({})).toThrow(/Give data/);
    expect(() => resolveData({ data: [{ label: 'a', value: 1 }], dataFile: '/x.csv' })).toThrow(/not both/);
    expect(() => resolveData({ data: [{ label: 'a', value: 1 }, { label: 'A', value: 2 }] })).toThrow(/appears twice/);
    expect(() => resolveData({ data: [{ label: 'a', value: -1 }] }, { nonNegative: true })).toThrow(/0 or more/);
    expect(() => resolveData({ data: [{ label: 'a', value: 1 }] }, { min: 2, what: 'A line chart' })).toThrow(/A line chart needs at least 2/);
    expect(() => resolveData({ data: [{ label: 'a', value: 1, color: 'not-a-colour' }] })).toThrow(/"a"/);
    const ok = resolveData({ data: [{ label: ' a ', value: 1, color: '#ff0000' }] });
    expect(ok.data).toEqual([{ label: 'a', value: 1, color: [1, 0, 0, 1] }]);
  });
});

/* ------------------------------------------------------ server + mock bridge */

describe('chart tools through the MCP server and the mock bridge', () => {
  it('create-bar-chart returns layers, controls, axis, layout and timing', async () => {
    const r = await callTool(client, 'create-bar-chart', { data: QUARTERS, name: 'Revenue', format: { prefix: '$', suffix: 'K' }, highlight: ['Q4'] });
    expect(r.isError, r.text).toBe(false);
    expect(lastCommand()).toBe('createBarChart');
    expect(r.json.chart).toMatchObject({ name: 'Revenue', type: 'bar', controls: 'Revenue / Controls' });
    const controls = r.json.controls as Array<{ label: string; property: string; expression: string }>;
    expect(controls.map((c) => c.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Axis Max']);
    expect(controls[0].property).toBe('Effects/Q1/Slider');
    expect(controls[0].expression).toBe('thisComp.layer("Revenue / Controls").effect("Q1")(1)');
    expect(r.json.axis).toMatchObject({ min: 0, max: 80, steps: 4, auto: true });
    expect((r.json.layout as { colorMode: string }).colorMode).toBe('highlight');
    expect(r.json.animation).toMatchObject({ startTime: 0, easing: 'landing (speed 0, influence 25 leaving, 100 arriving)' });
  });

  it('create-bar-chart reads a CSV file on the server and sends the rows as data', async () => {
    const csv = writeTmp('quarters.csv', 'Quarter,Revenue,Color\nQ1,42,\nQ2,58,#ff8800\n');
    const args = bridgeArgs('create-bar-chart', { dataFile: csv });
    expect(args.data).toEqual([{ label: 'Q1', value: 42 }, { label: 'Q2', value: 58, color: [1, 136 / 255, 0, 1] }]);
    expect(args.dataSource).toMatchObject({ file: csv, format: 'csv', rows: 2 });
    expect(args.dataFile).toBeUndefined();
    const r = await callTool(client, 'create-bar-chart', { dataFile: csv });
    expect(r.isError, r.text).toBe(false);
    expect(r.json.dataSource).toMatchObject({ rows: 2 });
  });

  it('create-bar-chart rejects bad data before anything is sent', async () => {
    await rejectedBeforeSend('create-bar-chart', {});
    await rejectedBeforeSend('create-bar-chart', { data: [{ label: 'a', value: -2 }] });
    await rejectedBeforeSend('create-bar-chart', { data: [{ label: 'a', value: 1 }, { label: 'a', value: 2 }] });
    await rejectedBeforeSend('create-bar-chart', { data: QUARTERS, highlight: ['Q9'] });
    await rejectedBeforeSend('create-bar-chart', { data: QUARTERS, valueLabels: 'top' });
    await rejectedBeforeSend('create-bar-chart', { data: QUARTERS, max: -1 });
    await rejectedBeforeSend('create-bar-chart', { dataFile: path.join(tmpDir, 'nope.csv') });
    await rejectedBeforeSend('create-bar-chart', { data: QUARTERS, format: { decimals: 9 } });
    await rejectedBeforeSend('create-bar-chart', { data: Array.from({ length: 61 }, (_, i) => ({ label: `c${i}`, value: i })) });
  });

  it('create-bar-chart drops component false and keeps component settings', () => {
    expect(bridgeArgs('create-bar-chart', { data: QUARTERS, component: false }).component).toBeUndefined();
    expect(bridgeArgs('create-bar-chart', { data: QUARTERS, component: { name: 'KPI Bars' } }).component).toEqual({ name: 'KPI Bars' });
  });

  it('create-line-chart returns the arrivals of each point and the area mode', async () => {
    const r = await callTool(client, 'create-line-chart', { data: QUARTERS, min: 'auto', pointLabels: 'all', startFrame: 30 });
    expect(r.isError, r.text).toBe(false);
    expect(lastCommand()).toBe('createLineChart');
    const anim = r.json.animation as { arrivals: Array<{ label: string; frame: number }>; easing: string };
    expect(anim.arrivals.map((a) => a.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(anim.easing).toContain('draw');
    expect(r.json.layout).toMatchObject({ area: 'gradient', pointLabels: 'all', smooth: true });
    expect((r.json.layers as Array<{ role: string }>).map((l) => l.role)).toContain('area-matte');
  });

  it('create-line-chart needs two points and a max above a fixed min', async () => {
    await rejectedBeforeSend('create-line-chart', { data: [{ label: 'a', value: 1 }] });
    await rejectedBeforeSend('create-line-chart', { data: QUARTERS, min: 50, max: 40 });
    await rejectedBeforeSend('create-line-chart', { data: QUARTERS, area: 'hatched' });
  });

  it('create-pie-chart returns shares and refuses impossible radii and empty totals', async () => {
    const r = await callTool(client, 'create-pie-chart', { data: [{ label: 'Pro', value: 62 }, { label: 'Team', value: 28 }, { label: 'Free', value: 10 }], center: { label: 'Customers' } });
    expect(r.isError, r.text).toBe(false);
    expect(lastCommand()).toBe('createPieChart');
    expect((r.json.shares as Array<{ percent: number }>).map((s) => s.percent)).toEqual([62, 28, 10]);
    expect(r.json.layout).toMatchObject({ style: 'donut', colorMode: 'shades', center: { total: true, label: 'Customers' } });
    await rejectedBeforeSend('create-pie-chart', { data: QUARTERS, radius: 100, innerRadius: 100 });
    await rejectedBeforeSend('create-pie-chart', { data: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] });
    await rejectedBeforeSend('create-pie-chart', { data: QUARTERS, labels: 'everything' });
  });

  it('create-stat returns the final text and whether the change is good', async () => {
    const r = await callTool(client, 'create-stat', { value: 48250, label: 'Monthly revenue', format: { prefix: '$' }, delta: { value: -3.5, goodWhen: 'down', caption: 'vs last month' }, sparkline: { data: [3, 5, 4, 8] } });
    expect(r.isError, r.text).toBe(false);
    expect(lastCommand()).toBe('createStat');
    expect(r.json.text).toEqual({ value: '$48,250', delta: '3.5%', direction: 'down', good: true });
    expect((r.json.controls as Array<{ label: string }>).map((c) => c.label)).toEqual(['Value', 'From', 'Delta', 'Spark 1', 'Spark 2', 'Spark 3', 'Spark 4']);
    await rejectedBeforeSend('create-stat', { label: 'no value' });
    await rejectedBeforeSend('create-stat', { value: 1, sparkline: { data: [1] } });
    await rejectedBeforeSend('create-stat', { value: 1, delta: { value: 2, goodWhen: 'sideways' } });
  });

  it('create-progress returns the percent and checks the style options', async () => {
    const r = await callTool(client, 'create-progress', { value: 72, style: 'ring', caption: 'Profile complete' });
    expect(r.isError, r.text).toBe(false);
    expect(lastCommand()).toBe('createProgress');
    expect(r.json.percent).toBe(72);
    expect(r.json.layout).toMatchObject({ style: 'ring', display: 'percent' });
    await rejectedBeforeSend('create-progress', { value: 5, radius: 100 });
    await rejectedBeforeSend('create-progress', { value: 5, style: 'ring', size: [100, 10] });
    await rejectedBeforeSend('create-progress', { value: 5, max: 0 });
  });

  it('update-chart-data animates changes and needs values and one target', async () => {
    const r = await callTool(client, 'update-chart-data', { chart: 'Revenue', values: { Q3: 71, Q4: 88 }, startTime: 4, duration: 0.8 });
    expect(r.isError, r.text).toBe(false);
    expect(lastCommand()).toBe('updateChartData');
    expect(r.json.animated).toBe(true);
    const changed = r.json.changed as Array<{ label: string; to: number; keys: unknown[] }>;
    expect(changed.map((c) => [c.label, c.to, c.keys.length])).toEqual([['Q3', 71, 2], ['Q4', 88, 2]]);
    expect(bridgeArgs('update-chart-data', { chart: 'x', values: { a: 1 } }).animate).toBeUndefined();
    await rejectedBeforeSend('update-chart-data', { chart: 'Revenue' });
    await rejectedBeforeSend('update-chart-data', { chart: 'Revenue', controls: { index: 1 }, instance: { index: 2 }, values: { a: 1 } });
    await rejectedBeforeSend('update-chart-data', { chart: 'Revenue', values: { a: 1 }, data: [{ label: 'A', value: 2 }] });
  });

  it('update-chart-data reads new values from a file', () => {
    const json = writeTmp('next.json', JSON.stringify({ Q1: 50, Q2: 61 }));
    const args = bridgeArgs('update-chart-data', { chart: 'Revenue', dataFile: json });
    expect(args.data).toEqual([{ label: 'Q1', value: 50 }, { label: 'Q2', value: 61 }]);
    expect(args.dataSource).toMatchObject({ format: 'json', rows: 2 });
  });

  it('get-chart-data lists charts read-only', async () => {
    const r = await callTool(client, 'get-chart-data', {});
    expect(r.isError, r.text).toBe(false);
    expect(lastCommand()).toBe('getChartData');
    expect(r.json.count).toBe(2);
    const one = await callTool(client, 'get-chart-data', { chart: 'Revenue', frame: 45 });
    expect(one.json).toMatchObject({ count: 1, time: 1.5 });
    const entry = catalog.find((c) => c.name === 'get-chart-data');
    expect(entry!.mutating).toBe(false);
  });
});

/* ===================================================== fake After Effects */

const SCRIPTS = path.resolve(__dirname, '..', '..', 'src', 'scripts');
const PT = { PROPERTY: 6812, INDEXED_GROUP: 6813, NAMED_GROUP: 6814 };
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
const JUST = { LEFT_JUSTIFY: 7413, RIGHT_JUSTIFY: 7414, CENTER_JUSTIFY: 7415, FULL_JUSTIFY_LASTLINE_LEFT: 7416, FULL_JUSTIFY_LASTLINE_RIGHT: 7417, FULL_JUSTIFY_LASTLINE_CENTER: 7418, FULL_JUSTIFY_LASTLINE_FULL: 7419 };
const TMT = { NO_TRACK_MATTE: 5012, ALPHA: 5013, ALPHA_INVERTED: 5014, LUMA: 5015, LUMA_INVERTED: 5016 };

class KeyframeEase {
  constructor(public speed: number, public influence: number) {}
}
class Shape {
  vertices: number[][] = [];
  inTangents: number[][] = [];
  outTangents: number[][] = [];
  closed = true;
}
class TextDocument {
  text: string;
  fontSize = 72;
  font = 'ArialMT';
  fillColor = [1, 1, 1];
  applyFill = true;
  applyStroke = false;
  justification = JUST.LEFT_JUSTIFY;
  leading = 0;
  autoLeading = true;
  tracking = 0;
  constructor(text = '') {
    this.text = text;
  }
}
class MarkerValue {
  constructor(public comment = '') {}
}
class SolidSource {
  constructor(public color: number[]) {}
}
class FootageItem {
  constructor(public mainSource: unknown, public width: number, public height: number, public name = 'Solid') {}
}
class FolderItem {}
class PlaceholderSource {}

function clone(v: any): any {
  if (Array.isArray(v)) return v.map(clone);
  if (v instanceof Shape) {
    const s = new Shape();
    s.vertices = clone(v.vertices);
    s.inTangents = clone(v.inTangents);
    s.outTangents = clone(v.outTangents);
    s.closed = v.closed;
    return s;
  }
  if (v instanceof TextDocument) return Object.assign(new TextDocument(v.text), v);
  return v;
}

interface Key {
  time: number;
  value: any;
  inType: number;
  outType: number;
  inEase: KeyframeEase[];
  outEase: KeyframeEase[];
}

let evaluator: (prop: FakeProp, t: number) => any = () => {
  throw new Error('no evaluator');
};

class FakeNode {
  parentProperty: any = null;
  constructor(public matchName: string, public name: string) {}
  get propertyIndex(): number {
    return this.parentProperty ? this.parentProperty.children.indexOf(this) + 1 : 0;
  }
  get propertyDepth(): number {
    let d = 0;
    let p: any = this;
    while (p && !(p instanceof LayerCore)) {
      d++;
      p = p.parentProperty;
    }
    return d;
  }
  propertyGroup(n = 1): any {
    let p: any = this;
    for (let i = 0; i < n && p; i++) p = p.parentProperty;
    return p;
  }
  get layer(): LayerCore {
    let p: any = this;
    while (p && !(p instanceof LayerCore)) p = p.parentProperty;
    return p;
  }
}

function interpolate(a: Key, b: Key, t: number): any {
  if (a.outType === KIT.HOLD) return clone(a.value);
  if (a.value instanceof Shape || a.value instanceof TextDocument) return clone(t < b.time ? a.value : b.value);
  const dt = b.time - a.time;
  const s = (t - a.time) / dt;
  const arr = Array.isArray(a.value);
  const va: number[] = arr ? a.value : [a.value];
  const vb: number[] = arr ? b.value : [b.value];
  const out = va.map((v0, d) => {
    const v1 = vb[d];
    if (a.outType === KIT.LINEAR && b.inType === KIT.LINEAR) return v0 + (v1 - v0) * s;
    const eo = a.outEase[Math.min(d, a.outEase.length - 1)];
    const ei = b.inEase[Math.min(d, b.inEase.length - 1)];
    const io = a.outType === KIT.LINEAR ? 100 / 3 : eo.influence;
    const so = a.outType === KIT.LINEAR ? (v1 - v0) / dt : eo.speed;
    const ii = b.inType === KIT.LINEAR ? 100 / 3 : ei.influence;
    const si = b.inType === KIT.LINEAR ? (v1 - v0) / dt : ei.speed;
    const x1 = io / 100;
    const x2 = 1 - ii / 100;
    const y1 = v0 + (so * io * dt) / 100;
    const y2 = v1 - (si * ii * dt) / 100;
    const X = (u: number) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (X(mid) < s) lo = mid;
      else hi = mid;
    }
    const u = (lo + hi) / 2;
    return (1 - u) ** 3 * v0 + 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u * u * y2 + u ** 3 * v1;
  });
  return arr ? out : out[0];
}

class FakeProp extends FakeNode {
  propertyType = PT.PROPERTY;
  keys: Key[] = [];
  expression = '';
  expressionEnabled = true;
  expressionError = '';
  canSetExpression = true;
  canVaryOverTime = true;
  isSpatial = false;
  enabled = true;
  private v: any;
  constructor(matchName: string, name: string, value: any, opts: { spatial?: boolean } = {}) {
    super(matchName, name);
    this.v = clone(value);
    this.isSpatial = !!opts.spatial;
  }
  get value(): any {
    return this.keys.length ? this.valueAtTime(this.layer?.comp?.time ?? 0, true) : clone(this.v);
  }
  get numKeys(): number {
    return this.keys.length;
  }
  setValue(v: any): void {
    if (this.keys.length) throw new Error(`Can not set value: '${this.name}' has keyframes`);
    this.v = clone(v);
  }
  setValueAtTime(t: number, v: any): void {
    const i = this.keys.findIndex((k) => Math.abs(k.time - t) < 1e-6);
    const n = Array.isArray(v) && !this.isSpatial ? v.length : 1;
    const ease = () => Array.from({ length: n }, () => new KeyframeEase(0, 16.666667));
    const key: Key = { time: t, value: clone(v), inType: KIT.LINEAR, outType: KIT.LINEAR, inEase: ease(), outEase: ease() };
    if (i >= 0) this.keys[i].value = clone(v);
    else {
      this.keys.push(key);
      this.keys.sort((a, b) => a.time - b.time);
    }
  }
  setValueAtKey(i: number, v: any): void {
    this.keys[i - 1].value = clone(v);
  }
  removeKey(i: number): void {
    this.keys.splice(i - 1, 1);
  }
  keyTime(i: number): number {
    return this.keys[i - 1].time;
  }
  keyValue(i: number): any {
    return clone(this.keys[i - 1].value);
  }
  nearestKeyIndex(t: number): number {
    let best = 1;
    let bd = Infinity;
    this.keys.forEach((k, i) => {
      const d = Math.abs(k.time - t);
      if (d < bd) {
        bd = d;
        best = i + 1;
      }
    });
    return best;
  }
  keyInInterpolationType(i: number): number {
    return this.keys[i - 1].inType;
  }
  keyOutInterpolationType(i: number): number {
    return this.keys[i - 1].outType;
  }
  setInterpolationTypeAtKey(i: number, a: number, b?: number): void {
    this.keys[i - 1].inType = a;
    this.keys[i - 1].outType = b ?? a;
  }
  keyInTemporalEase(i: number): KeyframeEase[] {
    return this.keys[i - 1].inEase;
  }
  keyOutTemporalEase(i: number): KeyframeEase[] {
    return this.keys[i - 1].outEase;
  }
  setTemporalEaseAtKey(i: number, a: KeyframeEase[], b?: KeyframeEase[]): void {
    const n = this.keys[i - 1].inEase.length;
    if (a.length !== n || (b && b.length !== n)) throw new Error('wrong number of eases');
    this.keys[i - 1].inEase = a;
    this.keys[i - 1].outEase = b ?? a;
  }
  setTemporalAutoBezierAtKey(): void {}
  setTemporalContinuousAtKey(): void {}
  keyTemporalContinuous(): boolean {
    return false;
  }
  keyTemporalAutoBezier(): boolean {
    return false;
  }
  keySelected(): boolean {
    return false;
  }
  setSpatialAutoBezierAtKey(): void {}
  setSpatialContinuousAtKey(): void {}
  setSpatialTangentsAtKey(): void {}
  keyed(t: number): any {
    if (!this.keys.length) return clone(this.v);
    if (t <= this.keys[0].time) return clone(this.keys[0].value);
    const last = this.keys[this.keys.length - 1];
    if (t >= last.time) return clone(last.value);
    for (let i = 0; i < this.keys.length - 1; i++) {
      if (t >= this.keys[i].time && t <= this.keys[i + 1].time) return interpolate(this.keys[i], this.keys[i + 1], t);
    }
    return clone(last.value);
  }
  valueAtTime(t: number, preExpression: boolean): any {
    if (!preExpression && this.expression && this.expressionEnabled) return evaluator(this, t);
    return this.keyed(t);
  }
}

const SUBS: Record<string, () => FakeNode> = {};

class FakeGroup extends FakeNode {
  children: FakeNode[] = [];
  enabled = true;
  propertyType: number;
  constructor(matchName: string, name: string, indexed = false, kids: FakeNode[] = []) {
    super(matchName, name);
    this.propertyType = indexed ? PT.INDEXED_GROUP : PT.NAMED_GROUP;
    kids.forEach((k) => this.adopt(k));
  }
  adopt(k: FakeNode): FakeNode {
    k.parentProperty = this;
    this.children.push(k);
    return k;
  }
  get numProperties(): number {
    return this.children.length;
  }
  property(x: string | number): any {
    if (typeof x === 'number') return this.children[x - 1] ?? null;
    return this.children.find((c) => c.name === x) ?? this.children.find((c) => c.matchName === x) ?? null;
  }
  canAddProperty(mn: string): boolean {
    return !!SUBS[mn];
  }
  addProperty(mn: string): any {
    const make = SUBS[mn];
    if (!make) throw new Error(`fake: cannot add ${mn} to ${this.matchName}`);
    const node = make();
    const base = node.name;
    let k = 2;
    while (this.children.some((c) => c.name === node.name)) node.name = `${base} ${k++}`;
    return this.adopt(node);
  }
  remove(): void {
    const p = this.parentProperty as FakeGroup;
    p.children.splice(p.children.indexOf(this), 1);
  }
}

const P = (mn: string, name: string, v: any, spatial = false) => new FakeProp(mn, name, v, { spatial });
const G = (mn: string, name: string, kids: FakeNode[] = [], indexed = false) => new FakeGroup(mn, name, indexed, kids);
Object.assign(SUBS, {
  'ADBE Slider Control': () => G('ADBE Slider Control', 'Slider Control', [P('ADBE Slider Control-0001', 'Slider', 0)]),
  'ADBE Color Control': () => G('ADBE Color Control', 'Color Control', [P('ADBE Color Control-0001', 'Color', [1, 0, 0, 1])]),
  'ADBE Vector Group': () =>
    G('ADBE Vector Group', 'Group 1', [
      G('ADBE Vectors Group', 'Contents', [], true),
      G('ADBE Vector Transform Group', 'Transform', [P('ADBE Vector Anchor', 'Anchor Point', [0, 0]), P('ADBE Vector Position', 'Position', [0, 0]), P('ADBE Vector Scale', 'Scale', [100, 100]), P('ADBE Vector Rotation', 'Rotation', 0), P('ADBE Vector Group Opacity', 'Opacity', 100)]),
    ]),
  'ADBE Vector Shape - Group': () => G('ADBE Vector Shape - Group', 'Path 1', [P('ADBE Vector Shape', 'Path', new Shape())]),
  'ADBE Vector Shape - Rect': () => G('ADBE Vector Shape - Rect', 'Rectangle Path 1', [P('ADBE Vector Rect Size', 'Size', [100, 100]), P('ADBE Vector Rect Position', 'Position', [0, 0]), P('ADBE Vector Rect Roundness', 'Roundness', 0)]),
  'ADBE Vector Shape - Ellipse': () => G('ADBE Vector Shape - Ellipse', 'Ellipse Path 1', [P('ADBE Vector Ellipse Size', 'Size', [100, 100]), P('ADBE Vector Ellipse Position', 'Position', [0, 0])]),
  'ADBE Vector Graphic - Fill': () => G('ADBE Vector Graphic - Fill', 'Fill 1', [P('ADBE Vector Fill Color', 'Color', [1, 0, 0, 1]), P('ADBE Vector Fill Opacity', 'Opacity', 100)]),
  'ADBE Vector Graphic - Stroke': () =>
    G('ADBE Vector Graphic - Stroke', 'Stroke 1', [P('ADBE Vector Stroke Color', 'Color', [1, 1, 1, 1]), P('ADBE Vector Stroke Opacity', 'Opacity', 100), P('ADBE Vector Stroke Width', 'Stroke Width', 2), P('ADBE Vector Stroke Line Cap', 'Line Cap', 1), P('ADBE Vector Stroke Line Join', 'Line Join', 1)]),
  'ADBE Vector Filter - Trim': () => G('ADBE Vector Filter - Trim', 'Trim Paths 1', [P('ADBE Vector Trim Start', 'Start', 0), P('ADBE Vector Trim End', 'End', 100), P('ADBE Vector Trim Offset', 'Offset', 0), P('ADBE Vector Trim Type', 'Trim Multiple Shapes', 1)]),
  'ADBE Vector Graphic - G-Fill': () => G('ADBE Vector Graphic - G-Fill', 'Gradient Fill 1', [P('ADBE Vector Grad Type', 'Type', 1), P('ADBE Vector Grad Start Pt', 'Start Point', [0, 0]), P('ADBE Vector Grad End Pt', 'End Point', [100, 0])]),
  'ADBE Text Animator': () => G('ADBE Text Animator', 'Animator 1', [G('ADBE Text Selectors', 'Selectors', [], true), G('ADBE Text Animator Properties', 'Properties')]),
  'ADBE Text Fill Color': () => P('ADBE Text Fill Color', 'Fill Color', [1, 0, 0, 1]),
  'ADBE Text Selector': () => G('ADBE Text Selector', 'Range Selector 1', [P('ADBE Text Percent Start', 'Start', 0), P('ADBE Text Percent End', 'End', 100), P('ADBE Text Percent Offset', 'Offset', 0)]),
});

let nextId = 1;

class LayerCore {
  id = nextId++;
  name = 'Layer';
  comment = '';
  label = 0;
  enabled = true;
  parentLayer: LayerCore | null = null;
  startTime = 0;
  inPoint = 0;
  outPoint: number;
  threeDLayer = false;
  nullLayer = false;
  adjustmentLayer = false;
  guideLayer = false;
  source: any = null;
  trackMatteType = TMT.NO_TRACK_MATTE;
  matte: LayerCore | null = null;
  children: FakeNode[] = [];
  propertyDepth = 0;
  parentProperty = null;
  constructor(public comp: FakeComp) {
    this.outPoint = comp.duration;
    const g = new FakeGroup('ADBE Transform Group', 'Transform', false, [
      P('ADBE Anchor Point', 'Anchor Point', [0, 0]),
      P('ADBE Position', 'Position', [comp.width / 2, comp.height / 2], true),
      P('ADBE Scale', 'Scale', [100, 100]),
      P('ADBE Rotate Z', 'Rotation', 0),
      P('ADBE Opacity', 'Opacity', 100),
    ]);
    this.adoptRoot(g);
    this.adoptRoot(new FakeGroup('ADBE Effect Parade', 'Effects', true));
    this.adoptRoot(P('ADBE Marker', 'Marker', null));
  }
  adoptRoot(n: FakeNode): void {
    (n as any).parentProperty = this;
    this.children.push(n);
  }
  get containingComp(): FakeComp {
    return this.comp;
  }
  get index(): number {
    return this.comp.list.indexOf(this) + 1;
  }
  get parent(): LayerCore | null {
    return this.parentLayer;
  }
  set parent(p: LayerCore | null) {
    this.parentLayer = p;
  }
  property(x: string | number): any {
    if (typeof x === 'number') return this.children[x - 1] ?? null;
    return this.children.find((c) => c.matchName === x || c.name === x) ?? null;
  }
  get numProperties(): number {
    return this.children.length;
  }
  moveToBeginning(): void {
    this.comp.list.splice(this.comp.list.indexOf(this), 1);
    this.comp.list.unshift(this);
  }
  moveToEnd(): void {
    this.comp.list.splice(this.comp.list.indexOf(this), 1);
    this.comp.list.push(this);
  }
  moveAfter(other: LayerCore): void {
    this.comp.list.splice(this.comp.list.indexOf(this), 1);
    this.comp.list.splice(this.comp.list.indexOf(other) + 1, 0, this);
  }
  setTrackMatte(m: LayerCore, type: number): void {
    this.matte = m;
    this.trackMatteType = type;
  }
}
class AVLayer extends LayerCore {}
class ShapeLayer extends LayerCore {
  constructor(comp: FakeComp) {
    super(comp);
    this.adoptRoot(new FakeGroup('ADBE Root Vectors Group', 'Contents', true));
  }
}
class TextLayer extends LayerCore {
  constructor(comp: FakeComp, text: string) {
    super(comp);
    this.adoptRoot(new FakeGroup('ADBE Text Properties', 'Text', false, [P('ADBE Text Document', 'Source Text', new TextDocument(text)), new FakeGroup('ADBE Text Animators', 'Animators', true)]));
  }
}
class CameraLayer extends LayerCore {}
class LightLayer extends LayerCore {}

class FakeComp {
  id = nextId++;
  list: LayerCore[] = [];
  time = 0;
  bgColor = [0, 0, 0];
  frameDuration: number;
  layers: any;
  constructor(public name: string, public width = 1920, public height = 1080, public duration = 10, public frameRate = 30) {
    this.frameDuration = 1 / frameRate;
    const add = <T extends LayerCore>(L: T): T => {
      this.list.unshift(L);
      return L;
    };
    this.layers = {
      addNull: () => {
        const L = add(new AVLayer(this));
        L.nullLayer = true;
        L.name = 'Null 1';
        L.property('ADBE Transform Group').property('ADBE Anchor Point').setValue([50, 50]);
        return L;
      },
      addShape: () => add(new ShapeLayer(this)),
      addText: (text: string) => {
        const L = add(new TextLayer(this, text));
        L.name = text;
        return L;
      },
      addSolid: (color: number[], name: string, w: number, h: number) => {
        const L = add(new AVLayer(this));
        L.name = name;
        L.source = new FootageItem(new SolidSource(color), w, h, name);
        return L;
      },
    };
  }
  get numLayers(): number {
    return this.list.length;
  }
  layer(i: number): LayerCore {
    return this.list[i - 1];
  }
}
const CompItem = FakeComp;

/* ------------------------------------------------- expression evaluation */

let exprCtx: vm.Context;
let depth = 0;

function findLayer(comp: FakeComp, name: string): LayerCore {
  const L = comp.list.find((l) => l.name === name);
  if (!L) throw new Error(`Layer named "${name}" is missing`);
  return L;
}

function propApi(p: FakeNode | null, t: number, what: string): any {
  if (!p) throw new Error(`property ${what} is missing`);
  return {
    __prop: true,
    get value() {
      return (p as FakeProp).valueAtTime(t, false);
    },
    valueAtTime: (tt: number) => (p as FakeProp).valueAtTime(tt, false),
    get numKeys() {
      return (p as FakeProp).numKeys;
    },
  };
}

function contentApi(g: FakeGroup | null, t: number, what: string): any {
  if (!g) throw new Error(`content ${what} is missing`);
  const items = g.matchName === 'ADBE Vector Group' ? (g.property('ADBE Vectors Group') as FakeGroup) : g;
  return {
    content: (name: string) => contentApi(items.property(name), t, name),
    get end() {
      return propApi(g.property('ADBE Vector Trim End'), t, 'end');
    },
    get start() {
      return propApi(g.property('ADBE Vector Trim Start'), t, 'start');
    },
    get size() {
      return propApi(g.property('ADBE Vector Rect Size'), t, 'size');
    },
    get path() {
      return propApi(g.property('ADBE Vector Shape'), t, 'path');
    },
  };
}

function textRect(L: LayerCore, t: number): { left: number; top: number; width: number; height: number } {
  const prop = L.property('ADBE Text Properties').property('ADBE Text Document') as FakeProp;
  const doc = prop.valueAtTime(t, false) as TextDocument;
  const lines = String(doc.text).split('\r');
  const w = Math.max(...lines.map((l) => l.length)) * doc.fontSize * 0.55;
  const left = doc.justification === JUST.CENTER_JUSTIFY ? -w / 2 : doc.justification === JUST.RIGHT_JUSTIFY ? -w : 0;
  return { left, top: -doc.fontSize * 0.72, width: w, height: doc.fontSize * 0.72 + (lines.length - 1) * (doc.leading || doc.fontSize * 1.2) };
}

function layerApi(L: LayerCore, t: number): any {
  return {
    name: L.name,
    effect: (name: string) => {
      const fx = (L.property('ADBE Effect Parade') as FakeGroup).children.find((c) => c.name === name) as FakeGroup | undefined;
      if (!fx) throw new Error(`effect named "${name}" is missing on ${L.name}`);
      return (i: number) => propApi(fx.children[i - 1], t, `${name}(${i})`);
    },
    content: (name: string) => contentApi(L.property('ADBE Root Vectors Group').property(name), t, name),
    transform: {
      get opacity() {
        return propApi(L.property('ADBE Transform Group').property('ADBE Opacity'), t, 'opacity');
      },
    },
    sourceRectAtTime: (tt?: number) => textRect(L, tt ?? t),
  };
}

function setupEvaluator(): void {
  exprCtx = vm.createContext({});
  vm.runInContext(
    [
      'function linear(t, a, b, c, d) { if (arguments.length === 3) { d = b; c = a; a = 0; b = 1; } if (b === a) { return t < a ? c : d; } var r = Math.max(0, Math.min(1, (t - a) / (b - a))); return c + (d - c) * r; }',
      'function clamp(v, a, b) { return Math.max(Math.min(a, b), Math.min(Math.max(a, b), v)); }',
      'function degreesToRadians(d) { return d * Math.PI / 180; }',
      'function __run(thisComp, thisLayer, effect, content, transform, time, sourceRectAtTime, createPath, __code) { return eval(__code); }',
    ].join('\n'),
    exprCtx
  );
  evaluator = (prop: FakeProp, t: number) => {
    if (depth > 40) throw new Error('expression recursion');
    depth++;
    const L = prop.layer;
    const api = layerApi(L, t);
    const createPath = (pts: number[][], ins: number[][] = [], outs: number[][] = [], closed = true) => {
      if ((ins.length && ins.length !== pts.length) || (outs.length && outs.length !== pts.length)) throw new Error('createPath: tangents and points differ in length');
      const s = new Shape();
      s.vertices = pts.map((p) => [p[0], p[1]]);
      s.inTangents = ins.length ? ins.map((p) => [p[0], p[1]]) : pts.map(() => [0, 0]);
      s.outTangents = outs.length ? outs.map((p) => [p[0], p[1]]) : pts.map(() => [0, 0]);
      s.closed = closed;
      return s;
    };
    try {
      const thisComp = { layer: (name: string) => layerApi(findLayer(L.comp, name), t), width: L.comp.width, height: L.comp.height };
      let out = exprCtx.__run(thisComp, api, api.effect, api.content, api.transform, t, api.sourceRectAtTime, createPath, prop.expression);
      if (out && typeof out === 'object' && out.__prop) out = out.value;
      if (out === undefined || (typeof out === 'number' && !Number.isFinite(out))) throw new Error(`expression result is ${out}`);
      if (Array.isArray(out) && out.some((x: unknown) => typeof x !== 'number' || !Number.isFinite(x))) throw new Error(`expression result has a bad number: ${JSON.stringify(out)}`);
      prop.expressionError = '';
      const base = prop.keyed(t);
      if (base instanceof TextDocument) {
        const d = clone(base);
        d.text = String(out);
        return d;
      }
      return out;
    } catch (err) {
      prop.expressionError = (err as Error).message;
      return prop.keyed(t);
    } finally {
      depth--;
    }
  };
}

/* ------------------------------------------------------------ the bridge */

let MCP: any;
let project: { items: FakeComp[]; activeItem: FakeComp | null };
let componentCalls: any[] = [];

function loadBridge(): void {
  project = { items: [], activeItem: null };
  const app = {
    version: '26.5.0',
    project: {
      get numItems() {
        return project.items.length;
      },
      item: (i: number) => project.items[i - 1],
      itemByID: (id: number) => project.items.find((c) => c.id === id) ?? null,
      get activeItem() {
        return project.activeItem;
      },
    },
  };
  const ctx = vm.createContext({
    MCP_BRIDGE_VERSION: 'test',
    app,
    KeyframeEase,
    KeyframeInterpolationType: KIT,
    PropertyType: PT,
    PropertyValueType: { CUSTOM_VALUE: 6420, NO_VALUE: 6412, TEXT_DOCUMENT: 6417, SHAPE: 6418, COLOR: 6424 },
    ParagraphJustification: JUST,
    TrackMatteType: TMT,
    Shape,
    TextDocument,
    MarkerValue,
    CompItem,
    AVLayer,
    ShapeLayer,
    TextLayer,
    CameraLayer,
    LightLayer,
    SolidSource,
    FootageItem,
    FolderItem,
    PlaceholderSource,
    Folder: { myDocuments: { fsName: tmpDir } },
    File: function () {
      return { exists: false };
    },
  });
  const files = [
    'lib/polyfills.jsx', 'lib/json.jsx', 'lib/core.jsx', 'lib/color.jsx', 'lib/undo.jsx', 'lib/resolve.jsx', 'lib/serialize.jsx', 'lib/easing.jsx',
    'commands/animate.jsx', 'commands/charts.jsx', 'commands/components.jsx', 'commands/masks.jsx', 'commands/shapes.jsx', 'commands/text.jsx',
  ];
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(SCRIPTS, f), 'utf8'), ctx, { filename: f });
  MCP = (ctx as any).MCP;
  componentCalls = [];
  MCP.commands.createComponent = (a: any) => {
    componentCalls.push(a);
    return { component: { name: a.name }, added: a.properties.map((p: any) => ({ label: p.label })), failed: [] };
  };
  setupEvaluator();
}

function newComp(name = 'Main', opts: { bg?: number[]; solid?: number[]; fps?: number } = {}): FakeComp {
  const c = new FakeComp(name, 1920, 1080, 10, opts.fps ?? 30);
  if (opts.bg) c.bgColor = opts.bg;
  if (opts.solid) c.layers.addSolid(opts.solid, 'Background', 1920, 1080);
  project.items.push(c);
  project.activeItem = c;
  return c;
}

function run(command: string, tool: string, args: Record<string, unknown>): any {
  const bridge = bridgeArgs(tool, args);
  // The bridge receives JSON, so send it the way the panel would.
  return JSON.parse(JSON.stringify(MCP.commands[command](JSON.parse(JSON.stringify(bridge)), {})));
}

function layer(comp: FakeComp, name: string): LayerCore {
  return findLayer(comp, name);
}

function at(comp: FakeComp, layerName: string, pathParts: Array<string | number>, t: number): any {
  let p: any = layer(comp, layerName);
  for (const part of pathParts) {
    p = p.property(part);
    if (!p) throw new Error(`${layerName}: ${pathParts.join(' > ')} not found at ${part}`);
  }
  return (p as FakeProp).valueAtTime(t, false);
}

function textAt(comp: FakeComp, layerName: string, t: number): string {
  return (at(comp, layerName, ['ADBE Text Properties', 'ADBE Text Document'], t) as TextDocument).text;
}

function slider(comp: FakeComp, layerName: string, effect: string): FakeProp {
  const fx = (layer(comp, layerName).property('ADBE Effect Parade') as FakeGroup).children.find((c) => c.name === effect) as FakeGroup;
  if (!fx) throw new Error(`no effect ${effect} on ${layerName}`);
  return fx.children[0] as FakeProp;
}

function shapeItem(comp: FakeComp, layerName: string, group: string | null, item: string): FakeGroup {
  const root = layer(comp, layerName).property('ADBE Root Vectors Group') as FakeGroup;
  const g = group === null ? root : (root.property(group).property('ADBE Vectors Group') as FakeGroup);
  return g.property(item) as FakeGroup;
}

function expressionsOf(comp: FakeComp): Array<{ layer: string; prop: string; code: string }> {
  const out: Array<{ layer: string; prop: string; code: string }> = [];
  const walk = (n: FakeNode, L: LayerCore) => {
    if (n instanceof FakeProp && n.expression) out.push({ layer: L.name, prop: n.matchName, code: n.expression });
    if (n instanceof FakeGroup) n.children.forEach((c) => walk(c, L));
  };
  comp.list.forEach((L) => L.children.forEach((c) => walk(c, L)));
  return out;
}

function evaluateAll(comp: FakeComp, times: number[]): string[] {
  const errors: string[] = [];
  const walk = (n: FakeNode, L: LayerCore) => {
    if (n instanceof FakeProp && n.expression) {
      for (const t of times) {
        n.valueAtTime(t, false);
        if (n.expressionError) errors.push(`${L.name} ${n.matchName} @${t}: ${n.expressionError}`);
      }
    }
    if (n instanceof FakeGroup) n.children.forEach((c) => walk(c, L));
  };
  comp.list.forEach((L) => L.children.forEach((c) => walk(c, L)));
  return errors;
}

const close = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

/* ========================================================= ExtendScript */

describe('charts.jsx helpers in a vm', () => {
  beforeAll(() => loadBridge());

  it('niceScale picks round steps and the tightest range', () => {
    expect(MCP.charts.niceScale(0, 73)).toMatchObject({ min: 0, max: 80, step: 20, steps: 4 });
    expect(MCP.charts.niceScale(0, 101)).toMatchObject({ min: 0, max: 120, step: 20, steps: 6 });
    expect(MCP.charts.niceScale(0, 48250)).toMatchObject({ min: 0, max: 50000, step: 10000, steps: 5 });
    expect(MCP.charts.niceScale(0, 100)).toMatchObject({ max: 100, step: 25, steps: 4 });
    expect(MCP.charts.niceScale(-12, 30)).toMatchObject({ min: -20, max: 30, step: 10, steps: 5 });
    expect(MCP.charts.niceScale(0, 75)).toMatchObject({ max: 80, steps: 4 });
    expect(MCP.charts.niceScale(0, 0.37)).toMatchObject({ max: 0.4, step: 0.1, steps: 4 });
    // A fixed step count uses the richer set (1.5, 3, 4, 6, 8 too) to stay close to the data.
    expect(MCP.charts.niceScale(0, 140, 4)).toMatchObject({ max: 160, step: 40, steps: 4 });
    expect(MCP.charts.niceScale(0, 95, 4)).toMatchObject({ max: 100, step: 25 });
    expect(MCP.charts.niceScale(5, 5)).toMatchObject({ min: 5 });
  });

  it('the number formatter matches the format options', () => {
    const f = (spec: any, n: number, d: any = {}) => MCP.charts.format(MCP.charts.fmt(spec, d), n);
    expect(f({}, 1234567)).toBe('1,234,567');
    expect(f({ decimals: 2, prefix: '$' }, 1234.5)).toBe('$1,234.50');
    expect(f({ suffix: '%' }, 12.6)).toBe('13%');
    expect(f({ thousands: false }, 12000)).toBe('12000');
    expect(f({ thousands: ' ', decimalMark: ',', decimals: 1 }, 12345.67)).toBe('12 345,7');
    expect(f({ compact: true }, 1250)).toBe('1.3K');
    expect(f({ compact: true }, 3000000)).toBe('3M');
    expect(f({ compact: true, prefix: '$' }, 999950)).toBe('$1M');
    expect(f({ compact: true }, 950)).toBe('950');
    expect(f({}, -0.2)).toBe('0');
    expect(f({ prefix: '$' }, -42)).toBe('-$42');
  });

  it('axis labels follow the step and use one compact unit per axis', () => {
    const tick = (spec: any, n: number, st: number, mx: number) => MCP.charts.compile(MCP.charts.tickSrc(MCP.charts.fmt(spec, {})), 'cs_tick')(n, st, mx);
    expect(tick({}, 7.5, 2.5, 10)).toBe('7.5');
    expect(tick({}, 20000, 10000, 50000)).toBe('20,000');
    expect(tick({ compact: true }, 20000, 10000, 50000)).toBe('20K');
    expect(tick({ compact: true }, 2500, 2500, 10000)).toBe('2.5K');
    expect(tick({ compact: true, prefix: '$' }, 0, 2500, 10000)).toBe('$0');
    expect(tick({ suffix: '%' }, 0.3, 0.1, 0.4)).toBe('0.3%');
    // While an axis change animates the step is not round: ticks stay whole numbers.
    expect(tick({ compact: true, prefix: '$' }, 125866.6, 31466.65, 125866.6)).toBe('$126K');
    expect(tick({}, -17.484, 10.37, 50)).toBe('-17');
    expect(tick({}, 7.4, 2.47, 10)).toBe('7.4');
  });

  it('the smooth line never passes its data and the cut path ends on the line', () => {
    const G = MCP.charts.geom();
    const P = [[0, 100], [100, 20], [200, 20], [300, 80]];
    const T = G.tan(P, true);
    // Flat stretch: zero slope at both of its ends, so the curve does not dip below y 20.
    expect(T.o[1][1]).toBeCloseTo(0, 9);
    expect(T.i[2][1]).toBeCloseTo(0, 9);
    const straight = G.tan(P, false);
    expect(straight.i.every((v: number[]) => v[0] === 0 && v[1] === 0)).toBe(true);
    const A = G.len(P, T.i, T.o, 16);
    expect(A.cum.length).toBe(4);
    expect(A.total).toBeGreaterThan(300);
    const half = G.cut(P, T.i, T.o, 0.5, 16);
    expect(half.p.length).toBe(half.i.length);
    expect(half.p.length).toBe(half.o.length);
    const tip = half.p[half.p.length - 1];
    expect(tip[0]).toBeGreaterThan(100);
    expect(tip[0]).toBeLessThan(250);
    const whole = G.cut(P, T.i, T.o, 1, 16);
    expect(whole.p).toEqual(P);
    const none = G.cut(P, T.i, T.o, 0, 16);
    expect(none.p).toEqual([[0, 100], [0, 100]]);
  });

  it('slider names stay within 31 characters and unique', () => {
    const items = MCP.charts.dataItems(
      [
        { label: 'A very long category label that keeps going', value: 1 },
        { label: 'A very long category label that keeps going on', value: 2 },
        { label: 'Axis Max', value: 3 },
      ],
      { reserved: ['Axis Max'] }
    );
    expect(items.map((i: any) => i.effect.length <= 31)).toEqual([true, true, true]);
    expect(new Set(items.map((i: any) => i.effect.toLowerCase())).size).toBe(3);
    expect(items[2].effect).not.toBe('Axis Max');
  });
});

describe('create-bar-chart in a fake After Effects', () => {
  let comp: FakeComp;
  let res: any;
  beforeAll(() => {
    loadBridge();
    comp = newComp('Main', { solid: [0.98, 0.98, 0.97] });
    res = run('createBarChart', 'create-bar-chart', { data: QUARTERS, name: 'Revenue', format: { prefix: '$', suffix: 'K' }, size: [800, 400], position: [960, 600] });
  });

  it('builds the control null, bars, labels, ticks and grid with no expression errors', () => {
    expect(res.expressions.errors).toEqual([]);
    expect(res.chart.theme).toEqual({ name: 'light', from: "solid 'Background'" });
    expect(comp.layer(1).name).toBe('Revenue / Controls');
    const names = comp.list.map((l) => l.name);
    for (const part of ['Grid', 'Bar Q1', 'Bar Q4', 'Label Q1', 'Value Q4', 'Tick 0', 'Tick 4']) expect(names).toContain(`Revenue / ${part}`);
    const ctrl = layer(comp, 'Revenue / Controls');
    for (const L of comp.list) if (L !== ctrl && L.name.startsWith('Revenue /')) expect(L.parent, L.name).toBe(ctrl);
    expect(res.axis).toMatchObject({ min: 0, max: 80, steps: 4, auto: true, scale: 1 });
    expect(slider(comp, 'Revenue / Controls', 'Q4').value).toBe(73);
    expect(slider(comp, 'Revenue / Controls', 'Axis Max').value).toBe(80);
    expect(JSON.parse(ctrl.comment.replace('MCP chart ', ''))).toMatchObject({ type: 'bar', name: 'Revenue', scale: 1, axis: { autoMax: true, steps: 4 } });
    expect(evaluateAll(comp, [0, 0.5, 1, 3])).toEqual([]);
  });

  it('staggers two Grow keys per bar after the grid lead and lands them with the house ease', () => {
    const keys = QUARTERS.map((q) => slider(comp, `Revenue / Bar ${q.label}`, 'Grow').keys);
    keys.forEach((k, i) => {
      expect(k.length).toBe(2);
      expect(k[0].time).toBeCloseTo(0.2 + i * (2 / 30), 6);
      expect(k[1].time - k[0].time).toBeCloseTo(0.8, 6);
      expect(k[1].inEase[0].influence).toBeCloseTo(100, 3);
      expect(k[0].outEase[0].influence).toBeCloseTo(25, 3);
      expect([k[0].value, k[1].value]).toEqual([0, 100]);
    });
    expect(res.animation).toMatchObject({ startTime: 0, barsStart: 0.2, staggerFrames: 2 });
  });

  it('bars grow from the baseline to value / max of the plot height, with a square base', () => {
    const end = 3;
    const top = at(comp, 'Revenue / Bar Q4', ['ADBE Root Vectors Group', 'Bar', 'ADBE Vectors Group', 'Top', 'ADBE Vector Rect Size'], end);
    expect(top[1]).toBeCloseTo((73 / 80) * 400, 3);
    expect(top[0]).toBeCloseTo(res.layout.barWidth, 3);
    const pos = at(comp, 'Revenue / Bar Q4', ['ADBE Root Vectors Group', 'Bar', 'ADBE Vectors Group', 'Top', 'ADBE Vector Rect Position'], end);
    expect(pos[1]).toBeCloseTo(200 - top[1] / 2, 3);
    const base = at(comp, 'Revenue / Bar Q4', ['ADBE Root Vectors Group', 'Bar', 'ADBE Vectors Group', 'Base', 'ADBE Vector Rect Size'], end);
    expect(base[1]).toBeCloseTo(res.layout.cornerRadius, 3);
    expect(at(comp, 'Revenue / Bar Q1', ['ADBE Root Vectors Group', 'Bar', 'ADBE Vectors Group', 'Top', 'ADBE Vector Rect Size'], 0)[1]).toBe(0);
    const mid = at(comp, 'Revenue / Bar Q1', ['ADBE Root Vectors Group', 'Bar', 'ADBE Vectors Group', 'Top', 'ADBE Vector Rect Size'], 0.6)[1];
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan((42 / 80) * 400);
  });

  it('value labels count with their bar and ride its end; ticks read the axis', () => {
    expect(textAt(comp, 'Revenue / Value Q4', 3)).toBe('$73K');
    const counting = textAt(comp, 'Revenue / Value Q4', 0.55);
    expect(Number(counting.replace(/[$K]/g, ''))).toBeGreaterThan(0);
    expect(Number(counting.replace(/[$K]/g, ''))).toBeLessThan(73);
    expect(at(comp, 'Revenue / Value Q4', ['ADBE Transform Group', 'ADBE Opacity'], 0)).toBe(0);
    expect(at(comp, 'Revenue / Value Q4', ['ADBE Transform Group', 'ADBE Opacity'], 3)).toBe(100);
    const vp = at(comp, 'Revenue / Value Q4', ['ADBE Transform Group', 'ADBE Position'], 3);
    expect(vp[1]).toBeCloseTo(200 - (73 / 80) * 400 - 12, 3);
    expect(['Tick 0', 'Tick 1', 'Tick 4'].map((t) => textAt(comp, `Revenue / ${t}`, 3))).toEqual(['$0K', '$20K', '$80K']);
  });

  it('update-chart-data keys the change, rescales the axis in the same move and leaves earlier keys alone', () => {
    const up = run('updateChartData', 'update-chart-data', { chart: 'Revenue', values: { Q4: 130 }, startTime: 4, duration: 0.8 });
    expect(up.changed).toEqual([expect.objectContaining({ label: 'Q4', from: 73, to: 130 })]);
    expect(up.axis).toMatchObject({ before: { max: 80 }, after: { max: 160 } });
    const q4 = slider(comp, 'Revenue / Controls', 'Q4');
    expect(q4.keys.map((k) => [k.time, k.value])).toEqual([[4, 73], [4.8, 130]]);
    expect(slider(comp, 'Revenue / Controls', 'Axis Max').keys.map((k) => k.value)).toEqual([80, 160]);
    expect(textAt(comp, 'Revenue / Value Q4', 6)).toBe('$130K');
    expect(textAt(comp, 'Revenue / Tick 4', 6)).toBe('$160K');
    expect(textAt(comp, 'Revenue / Tick 1', 6)).toBe('$40K');
    const h = at(comp, 'Revenue / Bar Q4', ['ADBE Root Vectors Group', 'Bar', 'ADBE Vectors Group', 'Top', 'ADBE Vector Rect Size'], 6)[1];
    expect(h).toBeCloseTo((130 / 160) * 400, 3);
    expect(textAt(comp, 'Revenue / Value Q4', 3)).toBe('$73K');
  });

  it('update-chart-data without a time writes static values, and refuses unknown or negative values before writing', () => {
    run('updateChartData', 'update-chart-data', { chart: 'Revenue', values: { Q1: 10 } });
    expect(slider(comp, 'Revenue / Controls', 'Q1').value).toBe(10);
    expect(() => run('updateChartData', 'update-chart-data', { chart: 'Revenue', values: { Q5: 1, Q2: 3 } })).toThrow(/keeps the categories it was built with/);
    expect(slider(comp, 'Revenue / Controls', 'Q2').value).toBe(58);
    expect(() => run('updateChartData', 'update-chart-data', { chart: 'Revenue', values: { Q2: -1 } })).toThrow(/0 or more/);
  });

  it('get-chart-data reads values, the axis and the layers', () => {
    const g = run('getChartData', 'get-chart-data', { time: 6 });
    expect(g.count).toBe(1);
    const c = g.charts[0];
    expect(c).toMatchObject({ name: 'Revenue', type: 'bar' });
    expect(c.values.map((v: any) => [v.label, v.value])).toEqual([['Q1', 10], ['Q2', 58], ['Q3', 51], ['Q4', 130]]);
    expect(c.axis).toMatchObject({ min: 0, max: 160, steps: 4 });
    expect(c.layers.length).toBe(res.layers.length);
  });

  it('a second chart gets a numbered name and a taken explicit name fails before any layer is made', () => {
    const before = comp.numLayers;
    expect(() => run('createBarChart', 'create-bar-chart', { data: QUARTERS, name: 'Revenue' })).toThrow(/already exists/);
    expect(comp.numLayers).toBe(before);
    const second = run('createBarChart', 'create-bar-chart', { data: QUARTERS });
    const third = run('createBarChart', 'create-bar-chart', { data: QUARTERS });
    expect([second.chart.name, third.chart.name]).toEqual(['Bar Chart', 'Bar Chart 2']);
    expect(() => run('getChartData', 'get-chart-data', { chart: 'Nope' })).toThrow(/No chart named 'Nope'/);
    expect(() => run('updateChartData', 'update-chart-data', { values: { Q1: 1 } })).toThrow(/3 charts are in/);
  });
});

describe('bar chart variants in a fake After Effects', () => {
  beforeAll(() => loadBridge());

  it('horizontal bars grow right, labels sit left and ticks below, inside labels hide until they fit', () => {
    const comp = newComp('H', { bg: [0.05, 0.05, 0.06] });
    const res = run('createBarChart', 'create-bar-chart', { data: QUARTERS, orientation: 'horizontal', valueLabels: 'inside', size: [600, 400], theme: 'auto' });
    expect(res.expressions.errors).toEqual([]);
    expect(res.chart.theme.name).toBe('dark');
    const size = at(comp, 'Bar Chart / Bar Q2', ['ADBE Root Vectors Group', 'Bar', 'ADBE Vectors Group', 'Top', 'ADBE Vector Rect Size'], 3);
    expect(size[0]).toBeCloseTo((58 / 80) * 600, 3);
    const pos = at(comp, 'Bar Chart / Bar Q2', ['ADBE Root Vectors Group', 'Bar', 'ADBE Vectors Group', 'Top', 'ADBE Vector Rect Position'], 3);
    expect(pos[0]).toBeCloseTo(-300 + size[0] / 2, 3);
    const label = at(comp, 'Bar Chart / Label Q2', ['ADBE Transform Group', 'ADBE Position'], 3);
    expect(label[0]).toBeLessThan(-300);
    const tick = at(comp, 'Bar Chart / Tick 2', ['ADBE Transform Group', 'ADBE Position'], 3);
    expect(tick[1]).toBeGreaterThan(200);
    expect(at(comp, 'Bar Chart / Value Q2', ['ADBE Transform Group', 'ADBE Opacity'], 3)).toBe(100);
    expect(at(comp, 'Bar Chart / Value Q2', ['ADBE Transform Group', 'ADBE Opacity'], 0.25)).toBe(0);
    expect(evaluateAll(comp, [0, 0.4, 2])).toEqual([]);
  });

  it('round bases skip the square rectangle, palettes and item colours apply, and animate false sets end values', () => {
    const comp = newComp('V2');
    const res = run('createBarChart', 'create-bar-chart', { data: [{ label: 'a', value: 1, color: '#ff0000' }, { label: 'b', value: 2 }], roundBase: true, colorMode: 'palette', theme: 'light', animate: false, gridlines: false, axis: false });
    expect(res.expressions.errors).toEqual([]);
    expect(res.animation).toBeNull();
    expect(res.keyframes).toBe(0);
    expect(res.layout.colors).toEqual(['#ff0000', '#eb6834']);
    expect(shapeItem(comp, 'Bar Chart / Bar a', 'Bar', 'Base')).toBeNull();
    expect(slider(comp, 'Bar Chart / Bar a', 'Grow').value).toBe(100);
    expect(comp.list.some((l) => l.name === 'Bar Chart / Grid')).toBe(false);
    expect(comp.list.some((l) => l.name.startsWith('Bar Chart / Tick'))).toBe(false);
  });

  it('values beyond the slider range are stored with a scale and shown in full', () => {
    const comp = newComp('Big');
    const res = run('createBarChart', 'create-bar-chart', { data: [{ label: 'ARR', value: 12500000 }, { label: 'Pipeline', value: 4200000 }], format: { prefix: '$', compact: true } });
    expect(res.expressions.errors).toEqual([]);
    expect(res.axis.scale).toBe(100);
    expect(slider(comp, 'Bar Chart / Controls', 'ARR').value).toBeCloseTo(125000, 6);
    expect(textAt(comp, 'Bar Chart / Value ARR', 5)).toBe('$12.5M');
    expect(textAt(comp, 'Bar Chart / Tick 1', 5)).toMatch(/^\$\d+(\.\d)?M$/);
    const up = run('updateChartData', 'update-chart-data', { values: { Pipeline: 6000000 } });
    expect(up.changed[0]).toMatchObject({ from: 4200000, to: 6000000 });
    expect(slider(comp, 'Bar Chart / Controls', 'Pipeline').value).toBeCloseTo(60000, 6);
  });

  it('component true precomposes every chart layer with each slider as an Essential Property', () => {
    newComp('Comp');
    const res = run('createBarChart', 'create-bar-chart', { data: QUARTERS, name: 'KPI', component: { name: 'KPI Bars', templateName: 'KPI' } });
    expect(componentCalls.length).toBe(1);
    const call = componentCalls[0];
    expect(call.name).toBe('KPI Bars');
    expect(call.templateName).toBe('KPI');
    expect(call.layers.length).toBe(res.layers.length);
    expect(call.properties.map((p: any) => p.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Axis Max']);
    expect(call.properties[0]).toEqual({ layer: 'KPI / Controls', path: ['ADBE Effect Parade', 'Q1', 'ADBE Slider Control-0001'], label: 'Q1' });
    expect(res.component.component.name).toBe('KPI Bars');
  });
});

describe('create-line-chart in a fake After Effects', () => {
  let comp: FakeComp;
  let res: any;
  const DATA = [
    { label: 'Jan', value: 12 },
    { label: 'Feb', value: 18 },
    { label: 'Mar', value: 15 },
    { label: 'Apr', value: 27 },
    { label: 'May', value: 31 },
  ];
  beforeAll(() => {
    loadBridge();
    comp = newComp('Lines', { solid: [1, 1, 1] });
    res = run('createLineChart', 'create-line-chart', { data: DATA, size: [800, 400], format: { suffix: 'K' } });
  });

  it('builds the line, area, fade matte, dots and labels with no expression errors', () => {
    expect(res.expressions.errors).toEqual([]);
    expect(evaluateAll(comp, [0, 0.4, 0.9, 1.4, 3])).toEqual([]);
    expect(res.axis).toMatchObject({ min: 0, max: 40, steps: 4, minMode: 'zero' });
    const area = layer(comp, 'Line Chart / Area');
    const fade = layer(comp, 'Line Chart / Area Fade');
    expect(area.matte).toBe(fade);
    expect(area.trackMatteType).toBe(TMT.LUMA);
    expect(fade.enabled).toBe(false);
    expect(comp.list.indexOf(fade)).toBe(comp.list.indexOf(area) - 1);
  });

  it('the line passes through every point from the sliders and draws on in two keys', () => {
    const shape = at(comp, 'Line Chart / Line', ['ADBE Root Vectors Group', 'Line', 'ADBE Vectors Group', 'Path', 'ADBE Vector Shape'], 3) as Shape;
    expect(shape.closed).toBe(false);
    expect(shape.vertices.map((v) => v.map((x) => Math.round(x * 100) / 100))).toEqual(DATA.map((d, i) => [-400 + i * 200, 200 - (d.value / 40) * 400]));
    const trim = shapeItem(comp, 'Line Chart / Line', 'Line', 'Draw On').property('ADBE Vector Trim End') as FakeProp;
    expect(trim.keys.map((k) => [k.time, k.value])).toEqual([[0.2, 0], [1.4, 100]]);
  });

  it('the area follows the drawn line, ends on the baseline and is the full shape at the end', () => {
    const mid = at(comp, 'Line Chart / Area', ['ADBE Root Vectors Group', 'Area', 'ADBE Vectors Group', 'Path', 'ADBE Vector Shape'], 0.8) as Shape;
    const n = mid.vertices.length;
    expect(mid.closed).toBe(true);
    expect(mid.vertices[n - 1]).toEqual([-400, 200]);
    expect(mid.vertices[n - 2][1]).toBe(200);
    const tipX = mid.vertices[n - 3][0];
    expect(tipX).toBeGreaterThan(-400);
    expect(tipX).toBeLessThan(400);
    const full = at(comp, 'Line Chart / Area', ['ADBE Root Vectors Group', 'Area', 'ADBE Vectors Group', 'Path', 'ADBE Vector Shape'], 3) as Shape;
    expect(full.vertices.length).toBe(DATA.length + 2);
    expect(full.vertices[DATA.length]).toEqual([400, 200]);
    const start = at(comp, 'Line Chart / Area Fade', ['ADBE Root Vectors Group', 'Fade', 'ADBE Vectors Group', 'Gradient', 'ADBE Vector Grad Start Pt'], 3);
    expect(start[1]).toBeCloseTo(200 - (31 / 40) * 400, 3);
  });

  it('dots pop as the line reaches them, in order, and ride their points', () => {
    const arrivals = res.animation.arrivals as Array<{ frame: number; fraction: number }>;
    expect(arrivals[0].frame).toBe(6);
    for (let i = 1; i < arrivals.length; i++) expect(arrivals[i].frame).toBeGreaterThanOrEqual(arrivals[i - 1].frame);
    expect(arrivals[arrivals.length - 1].fraction).toBe(1);
    const trim = shapeItem(comp, 'Line Chart / Line', 'Line', 'Draw On').property('ADBE Vector Trim End') as FakeProp;
    for (const a of arrivals) expect(trim.valueAtTime(a.frame / 30, true)).toBeGreaterThanOrEqual(a.fraction * 100 - 1e-6);
    const dotPos = at(comp, 'Line Chart / Dots', ['ADBE Root Vectors Group', 'Dot 4', 'ADBE Vector Transform Group', 'ADBE Vector Position'], 3);
    expect(dotPos).toEqual([200, 200 - (27 / 40) * 400]);
    const scale = layer(comp, 'Line Chart / Dots').property('ADBE Root Vectors Group').property('Dot 4').property('ADBE Vector Transform Group').property('ADBE Vector Scale') as FakeProp;
    expect(scale.keys.map((k) => k.value)).toEqual([[0, 0], [100, 100]]);
  });

  it('the last value label sits right of the last point and shows its value', () => {
    expect(textAt(comp, 'Line Chart / Value May', 3)).toBe('31K');
    const p = at(comp, 'Line Chart / Value May', ['ADBE Transform Group', 'ADBE Position'], 3);
    expect(p[0]).toBeGreaterThan(400);
    expect(['Tick 0', 'Tick 2', 'Tick 4'].map((t) => textAt(comp, `Line Chart / ${t}`, 3))).toEqual(['0K', '20K', '40K']);
  });

  it('negative data moves the axis line to zero and update rescales Axis Min too', () => {
    const c2 = newComp('Neg');
    const r2 = run('createLineChart', 'create-line-chart', { data: [{ label: 'a', value: -12 }, { label: 'b', value: 30 }, { label: 'c', value: 8 }], smooth: false, area: 'solid', dots: false, pointLabels: 'all' });
    expect(r2.expressions.errors).toEqual([]);
    expect(r2.axis).toMatchObject({ min: -20, max: 30, steps: 5 });
    const axisLine = shapeItem(c2, 'Line Chart / Grid', 'Axis', 'Line').property('ADBE Vector Shape').value as Shape;
    expect(axisLine.vertices[0][1]).toBeCloseTo(H(r2) / 2 - (2 * H(r2)) / 5, 3);
    const up = run('updateChartData', 'update-chart-data', { values: { a: -50 }, startFrame: 90, durationFrames: 24 });
    expect(up.axis.after).toMatchObject({ min: -60, max: 40 });
    expect(slider(c2, 'Line Chart / Controls', 'Axis Min').keys.map((k) => k.value)).toEqual([-20, -60]);
    expect(evaluateAll(c2, [0, 1, 5])).toEqual([]);
  });

  function H(r: any): number {
    return r.layout.size[1];
  }
});

describe('create-pie-chart in a fake After Effects', () => {
  let comp: FakeComp;
  let res: any;
  const PLANS = [
    { label: 'Pro', value: 62 },
    { label: 'Team', value: 28 },
    { label: 'Free', value: 10 },
  ];
  beforeAll(() => {
    loadBridge();
    comp = newComp('Pie', { solid: [1, 1, 1] });
    res = run('createPieChart', 'create-pie-chart', { data: PLANS, radius: 300, center: { label: 'Customers' } });
  });

  it('builds slices, labels, legend and centre with no expression errors', () => {
    expect(res.expressions.errors).toEqual([]);
    expect(evaluateAll(comp, [0, 0.3, 0.9, 2])).toEqual([]);
    expect(res.layout).toMatchObject({ style: 'donut', innerRadius: 186, labelPosition: 'inside', colorMode: 'shades' });
    expect(res.shares.map((s: any) => s.percent)).toEqual([62, 28, 10]);
  });

  it('each slice trims to its share minus the gap, clockwise from the start angle', () => {
    const trim = (label: string, which: string, t: number) => at(comp, `Pie Chart / Slice ${label}`, ['ADBE Root Vectors Group', 'Slice', 'ADBE Vectors Group', 'Trim', which], t);
    const gapPct = (res.layout.gap / (2 * Math.PI * ((300 + 186) / 2))) * 100;
    expect(trim('Team', 'ADBE Vector Trim Start', 3)).toBeCloseTo(62 + gapPct / 2, 3);
    expect(trim('Team', 'ADBE Vector Trim End', 3)).toBeCloseTo(62 + gapPct / 2 + 28 - gapPct, 3);
    expect(trim('Free', 'ADBE Vector Trim End', 0)).toBeCloseTo(trim('Free', 'ADBE Vector Trim Start', 0), 9);
    const circle = shapeItem(comp, 'Pie Chart / Slice Pro', 'Slice', 'Circle').property('ADBE Vector Shape').value as Shape;
    expect(circle.vertices[0]).toEqual([0, -243]);
    expect(circle.vertices[1]).toEqual([243, 0]);
    const keys = ['Pro', 'Team', 'Free'].map((l) => slider(comp, `Pie Chart / Slice ${l}`, 'Grow').keys[0].time);
    expect(keys).toEqual([0, 0.1333, 0.2667].map((x) => expect.closeTo(x, 3)));
  });

  it('labels count to the share at the slice middle; the centre total counts as slices fill', () => {
    expect(textAt(comp, 'Pie Chart / Label Pro', 3)).toBe('62%');
    const p = at(comp, 'Pie Chart / Label Pro', ['ADBE Transform Group', 'ADBE Position'], 3);
    const a = (31 * 3.6 * Math.PI) / 180;
    expect(p[0]).toBeCloseTo(Math.sin(a) * 243, 3);
    expect(textAt(comp, 'Pie Chart / Center Total', 3)).toBe('100');
    expect(Number(textAt(comp, 'Pie Chart / Center Total', 0.4))).toBeLessThan(100);
    expect(textAt(comp, 'Pie Chart / Center Label', 3)).toBe('Customers');
  });

  it('update-chart-data moves the shares; small slices lose their label', () => {
    run('updateChartData', 'update-chart-data', { values: { Free: 2 } });
    expect(at(comp, 'Pie Chart / Label Free', ['ADBE Transform Group', 'ADBE Opacity'], 3)).toBe(0);
    expect(textAt(comp, 'Pie Chart / Label Pro', 3)).toBe(`${Math.round((62 / 92) * 100)}%`);
    expect(() => run('updateChartData', 'update-chart-data', { values: { Pro: -1 } })).toThrow(/0 or more/);
  });

  it('a pie with outside label-percent labels and a palette builds cleanly', () => {
    const c2 = newComp('Pie2');
    const r2 = run('createPieChart', 'create-pie-chart', { data: PLANS, innerRadius: 0, labels: 'label-percent', labelPosition: 'outside', colorMode: 'palette', legend: false, startAngle: -90 });
    expect(r2.expressions.errors).toEqual([]);
    expect(r2.layout.style).toBe('pie');
    expect(textAt(c2, 'Pie Chart / Label Team', 3)).toBe('Team\r28%');
    const stroke = shapeItem(c2, 'Pie Chart / Slice Pro', 'Slice', 'Stroke').property('ADBE Vector Stroke Width').value;
    expect(stroke).toBe(r2.layout.radius);
    expect(shapeItem(c2, 'Pie Chart / Slice Pro', 'Slice', 'Trim').property('ADBE Vector Trim Offset').value).toBe(-90);
    expect(() => run('createPieChart', 'create-pie-chart', { data: PLANS, innerRadius: 0, center: true })).toThrow(/donut/);
  });
});

describe('create-stat and create-progress in a fake After Effects', () => {
  beforeAll(() => loadBridge());

  it('the stat counts to its value, colours the change by goodWhen and lays out the row from text widths', () => {
    const comp = newComp('Stat', { solid: [1, 1, 1] });
    const res = run('createStat', 'create-stat', { value: 48250, label: 'Monthly revenue', format: { prefix: '$' }, delta: { value: 12.4, caption: 'vs last month' }, sparkline: { data: [3, 5, 4, 8, 7, 9] } });
    expect(res.expressions.errors).toEqual([]);
    expect(evaluateAll(comp, [0, 0.5, 1.3, 3])).toEqual([]);
    expect(textAt(comp, 'Stat / Value', 3)).toBe('$48,250');
    const mid = Number(textAt(comp, 'Stat / Value', 0.6).replace(/[$,]/g, ''));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(48250);
    expect(textAt(comp, 'Stat / Delta', 3)).toBe('12.4%');
    const fill = layer(comp, 'Stat / Delta').property('ADBE Text Properties').property('ADBE Text Animators').property('Delta Colour').property('ADBE Text Animator Properties').property('ADBE Text Fill Color') as FakeProp;
    expect(fill.valueAtTime(3, false).slice(0, 3).map((x: number) => Math.round(x * 255))).toEqual([0x16, 0xa3, 0x4a]);
    const caption = at(comp, 'Stat / Delta Caption', ['ADBE Transform Group', 'ADBE Position'], 3);
    const deltaPos = at(comp, 'Stat / Delta', ['ADBE Transform Group', 'ADBE Position'], 3);
    expect(caption[0]).toBeGreaterThan(deltaPos[0]);
    run('updateChartData', 'update-chart-data', { chart: 'Stat', values: { Delta: -2 } });
    expect(fill.valueAtTime(3, false).slice(0, 3).map((x: number) => Math.round(x * 255))).toEqual([0xdc, 0x26, 0x26]);
    expect(at(comp, 'Stat / Delta Arrow', ['ADBE Root Vectors Group', 'Arrow', 'ADBE Vector Transform Group', 'ADBE Vector Rotation'], 3)).toBe(180);
    const spark = at(comp, 'Stat / Sparkline', ['ADBE Root Vectors Group', 'Line', 'ADBE Vectors Group', 'Path', 'ADBE Vector Shape'], 3) as Shape;
    expect(spark.vertices.length).toBe(6);
    expect(Math.min(...spark.vertices.map((v) => v[1]))).toBeCloseTo(res.layout.height - res.layout.sparkline.height, 3);
  });

  it('a centred stat without extras and goodWhen down works', () => {
    const comp = newComp('Stat2');
    const res = run('createStat', 'create-stat', { value: 3.2, align: 'center', delta: { value: -0.4, goodWhen: 'down', format: { suffix: ' pts' } } });
    expect(res.expressions.errors).toEqual([]);
    expect(res.text).toEqual({ value: '3.2', delta: '0.4 pts', direction: 'down', good: true });
    const arrow = at(comp, 'Stat / Delta Arrow', ['ADBE Transform Group', 'ADBE Position'], 3);
    expect(arrow[0]).toBeLessThan(0);
  });

  it('the progress bar fills to Value / Max and the ring trims with round caps', () => {
    const comp = newComp('Progress');
    const bar = run('createProgress', 'create-progress', { value: 72, size: [600, 16], caption: 'Onboarding' });
    expect(bar.expressions.errors).toEqual([]);
    const size = at(comp, 'Progress Bar / Bar', ['ADBE Root Vectors Group', 'Fill', 'ADBE Vectors Group', 'Rect', 'ADBE Vector Rect Size'], 3);
    expect(size[0]).toBeCloseTo(600 * 0.72, 3);
    expect(textAt(comp, 'Progress Bar / Value', 3)).toBe('72%');
    expect(at(comp, 'Progress Bar / Bar', ['ADBE Root Vectors Group', 'Fill', 'ADBE Vector Transform Group', 'ADBE Vector Group Opacity'], 0)).toBe(0);
    const ring = run('createProgress', 'create-progress', { value: 3, max: 4, style: 'ring', display: 'value', format: { suffix: ' of 4' } });
    expect(ring.expressions.errors).toEqual([]);
    expect(at(comp, 'Progress Ring / Ring', ['ADBE Root Vectors Group', 'Fill', 'ADBE Vectors Group', 'Trim', 'ADBE Vector Trim End'], 3)).toBeCloseTo(75, 6);
    expect(textAt(comp, 'Progress Ring / Value', 3)).toBe('3 of 4');
    expect(shapeItem(comp, 'Progress Ring / Ring', 'Fill', 'Stroke').property('ADBE Vector Stroke Line Cap').value).toBe(2);
    const ringTrack = ['ADBE Root Vectors Group', 'Track', 'ADBE Vector Transform Group', 'ADBE Vector Group Opacity'];
    expect(at(comp, 'Progress Ring / Ring', ringTrack, 0)).toBe(0);
    expect(at(comp, 'Progress Ring / Ring', ringTrack, 3)).toBe(100);
    run('updateChartData', 'update-chart-data', { chart: 'Progress Bar', values: { Value: 90 }, startTime: 4 });
    expect(textAt(comp, 'Progress Bar / Value', 6)).toBe('90%');
    expect(evaluateAll(comp, [0, 0.5, 2, 6])).toEqual([]);
  });
});

describe('update-chart-data on a component instance', () => {
  beforeAll(() => loadBridge());

  it('keys the instance\'s Essential Properties and rescales its own axis', () => {
    const inner = newComp('KPI Bars');
    run('createBarChart', 'create-bar-chart', { data: QUARTERS, name: 'KPI' });
    const host = newComp('Scene');
    const inst = new AVLayer(host);
    inst.name = 'KPI Bars';
    inst.source = inner;
    const overrides = new FakeGroup('ADBE Layer Overrides', 'Essential Properties', false, [...QUARTERS.map((q) => P('ADBE Layer Override', q.label, q.value)), P('ADBE Layer Override', 'Axis Max', 80)]);
    inst.adoptRoot(overrides);
    host.list.push(inst);
    const res = run('updateChartData', 'update-chart-data', { comp: { name: 'Scene' }, instance: { name: 'KPI Bars' }, values: { Q1: 95 }, startTime: 2, duration: 1 });
    expect(res.target).toBe('instance');
    expect(res.chart.component).toBe('KPI Bars');
    const q1 = overrides.property('Q1') as FakeProp;
    expect(q1.keys.map((k) => [k.time, k.value])).toEqual([[2, 42], [3, 95]]);
    expect((overrides.property('Axis Max') as FakeProp).keys.map((k) => k.value)).toEqual([80, 100]);
    expect(slider(inner, 'KPI / Controls', 'Q1').value).toBe(42);
    const read = run('getChartData', 'get-chart-data', { comp: { name: 'Scene' }, instance: { name: 'KPI Bars' }, time: 3 });
    expect(read.charts[0].values[0]).toMatchObject({ label: 'Q1', value: 95, source: 'instance' });
  });
});

describe('generated expressions', () => {
  beforeAll(() => loadBridge());

  it('read effect parameters by index and never by the localized name "Slider"', () => {
    const comp = newComp('Exprs');
    run('createBarChart', 'create-bar-chart', { data: QUARTERS });
    run('createLineChart', 'create-line-chart', { data: QUARTERS });
    run('createPieChart', 'create-pie-chart', { data: QUARTERS });
    run('createStat', 'create-stat', { value: 1, delta: { value: 1 }, sparkline: { data: [1, 2] } });
    run('createProgress', 'create-progress', { value: 1 });
    const all = expressionsOf(comp);
    expect(all.length).toBeGreaterThan(80);
    for (const e of all) {
      expect(e.code, `${e.layer} ${e.prop}`).not.toMatch(/\("Slider"\)/);
      expect(() => new vm.Script(e.code), `${e.layer} ${e.prop}`).not.toThrow();
    }
  });

  it('every variant builds and evaluates without an expression error at any point of its intro', () => {
    const comp = newComp('Variants', { solid: [1, 1, 1] });
    const results = [
      run('createBarChart', 'create-bar-chart', { name: 'H End', data: QUARTERS, orientation: 'horizontal', valueLabels: 'end', staggerFrames: 0, format: { decimals: 1, thousands: ' ', decimalMark: ',' } }),
      run('createBarChart', 'create-bar-chart', { name: 'V Inside', data: QUARTERS, valueLabels: 'inside', barWidth: 90, gap: 30, cornerRadius: 0, max: 100, steps: 5 }),
      run('createLineChart', 'create-line-chart', { name: 'Dense', data: Array.from({ length: 40 }, (_, i) => ({ label: `d${i}`, value: Math.sin(i / 4) * 50 + 60 })), min: 'auto', area: 'gradient', pointLabels: 'none', startTime: 1 }),
      run('createPieChart', 'create-pie-chart', { name: 'Values', data: QUARTERS, labels: 'value', format: { prefix: '$' }, center: { total: true } }),
      run('createPieChart', 'create-pie-chart', { name: 'Names', data: QUARTERS, labels: 'label', gap: 0 }),
      run('createStat', 'create-stat', { name: 'Centered', value: 0.734, from: 0.5, align: 'center', format: { decimals: 1, suffix: '%' }, sparkline: { data: [1, 1, 1], smooth: false, dot: false } }),
      run('createProgress', 'create-progress', { name: 'Ring', value: 140, style: 'ring', display: 'none', roundCaps: false }),
    ];
    for (const r of results) expect(r.expressions.errors, r.chart.name).toEqual([]);
    expect(evaluateAll(comp, [0, 0.1, 0.35, 0.7, 1.1, 1.6, 2.4, 9.9])).toEqual([]);
    expect(results[2].layout.dots).toBe(false);
    expect(results[1].layout).toMatchObject({ barWidth: 90, gap: 30, cornerRadius: 0 });
    expect(textAt(comp, 'H End / Value Q4', 3)).toBe('73,0');
    expect(textAt(comp, 'Values / Label Q2', 3)).toBe('$58');
    expect(textAt(comp, 'Values / Center Total', 3)).toBe('$224');
    expect(textAt(comp, 'Names / Label Q3', 3)).toBe('Q3');
    expect(textAt(comp, 'Centered / Value', 3)).toBe('0.7%');
    expect(results[6].notes.join(' ')).toMatch(/outside 0 to 100/);
    expect(at(comp, 'Ring / Ring', ['ADBE Root Vectors Group', 'Fill', 'ADBE Vectors Group', 'Trim', 'ADBE Vector Trim End'], 5)).toBe(100);
  });
});
