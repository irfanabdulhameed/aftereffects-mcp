/*
 * Chart and data tools (group 'charts'): bar, line and pie charts, KPI stats
 * and progress bars or rings built as editable layers, plus reading and
 * changing a chart's data later.
 *
 * Every chart keeps its data in Slider Controls on one control null, one per
 * value and named by its label, and every bar, point, slice, label and counter
 * follows those sliders by expression. The intro is a few eased keys per
 * element (a Grow slider per bar or slice, Trim Paths on lines), staggered,
 * landing without overshoot. Data comes from the call or from a CSV or JSON
 * file read here on the server.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { toRgba } from '../schemas/color.js';
import { Color, CompRef, Easing, LayerRef, TimeArgs, Vec2 } from '../schemas/common.js';
import { defineTool } from './registry.js';

/* ------------------------------------------------------------- data files */

export interface ChartDatum {
  label: string;
  value: number;
  color?: number[];
}

export interface DataColumnsSpec {
  label?: string;
  value?: string;
  color?: string;
}

export interface DataSource {
  file: string;
  format: 'csv' | 'json';
  rows: number;
  columns: { label: string | null; value: string | null; color: string | null };
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const LABEL_HEADERS = /^(label|labels|name|category|categories|x|date|month|day|week|year|quarter|period|key|item|segment|plan|stage|group)$/i;
const VALUE_HEADERS = /^(value|values|y|amount|count|total|revenue|users|sales|percent|percentage|share|score|number)$/i;
const COLOR_HEADERS = /^(colou?r|fill|hex)$/i;
const MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Reads a number the way spreadsheets print them: "1,234.5", "1.234,5", "$12K",
 * "45 %", "(120)" for -120, "2.5M". Returns null when the text is not a number.
 */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[\s '’$€£¥%]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /^[+-]?\d{1,3}(,\d{3})+([kmb])?$/i.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([kmb])?$/i.exec(s);
  if (!m) return null;
  let v = Number(m[1]);
  if (m[2]) v *= MULTIPLIERS[m[2].toLowerCase()];
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

/** Splits delimited text into rows of cells: quotes, doubled quotes and line breaks inside quotes are handled. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) ?? '';
  let delim = delimiter;
  if (!delim) {
    const counts = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
    counts.sort((a, b) => b.n - a.n);
    delim = counts[0].n > 0 ? counts[0].d : ',';
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row.map((x) => x.trim()));
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row.map((x) => x.trim()));
  return rows;
}

function findColumn(header: string[], wanted: string | undefined, pattern: RegExp, what: string, exclude: number[]): number {
  if (wanted !== undefined) {
    const idx = header.findIndex((h) => h.toLowerCase() === wanted.toLowerCase());
    if (idx < 0) throw new Error(`dataColumns.${what} "${wanted}" is not a column. Columns: ${header.join(', ')}.`);
    return idx;
  }
  return header.findIndex((h, i) => !exclude.includes(i) && pattern.test(h.trim()));
}

/** Items from a table whose first row is the header. */
export function itemsFromTable(rows: string[][], cols: DataColumnsSpec = {}): { items: Array<{ label: string; value: number; color?: string }>; columns: DataSource['columns'] } {
  if (rows.length < 2) throw new Error('The file needs a header row and at least one data row.');
  const header = rows[0];
  const body = rows.slice(1);
  const numericCol = (i: number) => body.every((r) => (r[i] ?? '').trim() === '' || parseNumber(r[i]) !== null) && body.some((r) => parseNumber(r[i]) !== null);
  let li = findColumn(header, cols.label, LABEL_HEADERS, 'label', []);
  if (li < 0) li = header.findIndex((_, i) => !numericCol(i));
  if (li < 0) li = 0;
  let vi = findColumn(header, cols.value, VALUE_HEADERS, 'value', [li]);
  if (vi < 0) vi = header.findIndex((_, i) => i !== li && numericCol(i));
  if (vi < 0) throw new Error(`No column of numbers found. Columns: ${header.join(', ')}. Name one with dataColumns.value.`);
  const ci = findColumn(header, cols.color, COLOR_HEADERS, 'color', [li, vi]);
  const items: Array<{ label: string; value: number; color?: string }> = [];
  body.forEach((r, n) => {
    const label = (r[li] ?? '').trim();
    const rawValue = (r[vi] ?? '').trim();
    if (!label && !rawValue) return;
    const value = parseNumber(rawValue);
    if (!label) throw new Error(`Row ${n + 2} has a value but no label.`);
    if (value === null) throw new Error(`Row ${n + 2} ("${label}"): "${rawValue}" in column "${header[vi]}" is not a number.`);
    const color = ci >= 0 && (r[ci] ?? '').trim() ? r[ci].trim() : undefined;
    items.push(color ? { label, value, color } : { label, value });
  });
  return { items, columns: { label: header[li] ?? null, value: header[vi] ?? null, color: ci >= 0 ? header[ci] : null } };
}

/** Items from parsed JSON: [{label, value, color}], [[label, value]], [numbers], {label: value} or {data: [...]}. */
export function itemsFromJson(json: unknown, cols: DataColumnsSpec = {}): { items: Array<{ label: string; value: number; color?: unknown }>; columns: DataSource['columns'] } {
  const pickKey = (o: Record<string, unknown>, wanted: string | undefined, pattern: RegExp, exclude: string[] = []) => {
    if (wanted !== undefined) return Object.keys(o).find((k) => k.toLowerCase() === wanted.toLowerCase()) ?? null;
    return Object.keys(o).find((k) => !exclude.includes(k) && pattern.test(k)) ?? null;
  };
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    for (const key of ['data', 'values', 'items', 'rows', 'series']) {
      if (Array.isArray(o[key])) return itemsFromJson(o[key], cols);
    }
    const entries = Object.entries(o);
    if (entries.length && entries.every(([, v]) => parseNumber(v) !== null)) {
      return { items: entries.map(([label, v]) => ({ label, value: parseNumber(v) as number })), columns: { label: 'key', value: 'value', color: null } };
    }
    throw new Error('The JSON must be an array of {label, value} objects, an array of [label, value] pairs or numbers, an object of label: value, or an object with a data array.');
  }
  if (!Array.isArray(json)) throw new Error('The JSON holds no data array.');
  let columns: DataSource['columns'] = { label: null, value: null, color: null };
  const items = json.map((entry, i) => {
    if (typeof entry === 'number' || typeof entry === 'string') {
      const value = parseNumber(entry);
      if (value === null) throw new Error(`Item ${i + 1}: "${entry}" is not a number.`);
      columns = { label: '(position)', value: '(item)', color: null };
      return { label: String(i + 1), value };
    }
    if (Array.isArray(entry)) {
      const value = parseNumber(entry[1]);
      if (entry.length < 2 || value === null) throw new Error(`Item ${i + 1} must be [label, value] with a number value.`);
      columns = { label: '[0]', value: '[1]', color: entry.length > 2 ? '[2]' : null };
      return entry.length > 2 && entry[2] !== undefined && entry[2] !== null ? { label: String(entry[0]), value, color: entry[2] } : { label: String(entry[0]), value };
    }
    if (entry && typeof entry === 'object') {
      const o = entry as Record<string, unknown>;
      const lk = pickKey(o, cols.label, LABEL_HEADERS);
      const vk = pickKey(o, cols.value, VALUE_HEADERS, lk ? [lk] : []);
      const ck = pickKey(o, cols.color, COLOR_HEADERS, [lk ?? '', vk ?? '']);
      if (!lk || !vk) throw new Error(`Item ${i + 1} needs a label and a value field (for example {"label": "Q1", "value": 42}); name them with dataColumns.`);
      const value = parseNumber(o[vk]);
      if (value === null) throw new Error(`Item ${i + 1} ("${String(o[lk])}"): ${JSON.stringify(o[vk])} is not a number.`);
      columns = { label: lk, value: vk, color: ck };
      return ck && o[ck] !== undefined && o[ck] !== null && o[ck] !== '' ? { label: String(o[lk]), value, color: o[ck] } : { label: String(o[lk]), value };
    }
    throw new Error(`Item ${i + 1} is not a number, a [label, value] pair or an object.`);
  });
  return { items, columns };
}

/** Reads a .csv, .tsv, .txt or .json data file into items. */
export function loadDataFile(raw: string, cols: DataColumnsSpec = {}): { items: Array<{ label: string; value: number; color?: unknown }>; source: DataSource } {
  const file = path.resolve(expandHome(raw.trim()));
  if (!path.isAbsolute(expandHome(raw.trim()))) throw new Error(`dataFile must be an absolute path (or start with ~/): "${raw}".`);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error(`dataFile not found: ${file}`);
  }
  if (!stat.isFile()) throw new Error(`dataFile is not a file: ${file}`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`dataFile is ${Math.round(stat.size / 1024)} KB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const ext = path.extname(file).toLowerCase();
  const text = fs.readFileSync(file, 'utf8');
  if (ext === '.json') {
    let json: unknown;
    try {
      json = JSON.parse(text.replace(/^﻿/, ''));
    } catch (err) {
      throw new Error(`dataFile is not valid JSON: ${(err as Error).message}`);
    }
    const res = itemsFromJson(json, cols);
    return { items: res.items, source: { file, format: 'json', rows: res.items.length, columns: res.columns } };
  }
  if (!['.csv', '.tsv', '.txt'].includes(ext)) throw new Error(`dataFile must be .csv, .tsv, .txt or .json, not "${ext || '(no extension)'}".`);
  const res = itemsFromTable(parseDelimited(text, ext === '.tsv' ? '\t' : undefined), cols);
  return { items: res.items, source: { file, format: 'csv', rows: res.items.length, columns: res.columns } };
}

export interface DataRules {
  min?: number;
  max?: number;
  nonNegative?: boolean;
  what?: string;
}

/**
 * The data a chart is built from: data or dataFile, exactly one. Labels are
 * trimmed and must be unique (they name the sliders); colours become [r, g, b, a].
 */
export function resolveData(args: { data?: Array<{ label: string; value: number; color?: unknown }>; dataFile?: string; dataColumns?: DataColumnsSpec }, rules: DataRules = {}): { data: ChartDatum[]; source: DataSource | null } {
  const what = rules.what ?? 'This chart';
  if (args.data && args.dataFile) throw new Error('Give data or dataFile, not both.');
  if (!args.data && !args.dataFile) throw new Error('Give data [{label, value}] or dataFile (a .csv or .json file).');
  let raw: Array<{ label: string; value: number; color?: unknown }>;
  let source: DataSource | null = null;
  if (args.dataFile) {
    const loaded = loadDataFile(args.dataFile, args.dataColumns ?? {});
    raw = loaded.items;
    source = loaded.source;
  } else raw = args.data ?? [];
  const seen = new Set<string>();
  const data = raw.map((d, i) => {
    const label = String(d.label).trim();
    if (!label) throw new Error(`Item ${i + 1} has an empty label.`);
    if (label.length > 64) throw new Error(`Label "${label.slice(0, 20)}..." is longer than 64 characters.`);
    const key = label.toLowerCase();
    if (seen.has(key)) throw new Error(`Label "${label}" appears twice. Labels name the sliders, so each must be unique.`);
    seen.add(key);
    if (!Number.isFinite(d.value)) throw new Error(`"${label}" needs a finite number value.`);
    if (rules.nonNegative && d.value < 0) throw new Error(`"${label}" is ${d.value}. ${what} shows amounts, so values must be 0 or more.`);
    const out: ChartDatum = { label, value: d.value };
    if (d.color !== undefined && d.color !== null) {
      try {
        out.color = Array.isArray(d.color) && d.color.length === 4 && d.color.every((c) => typeof c === 'number' && c >= 0 && c <= 1) ? (d.color as number[]) : toRgba(d.color);
      } catch (err) {
        throw new Error(`"${label}": ${(err as Error).message}`);
      }
    }
    return out;
  });
  if (rules.min !== undefined && data.length < rules.min) throw new Error(`${what} needs at least ${rules.min} values; the data has ${data.length}.`);
  if (rules.max !== undefined && data.length > rules.max) throw new Error(`${what} takes at most ${rules.max} values; the data has ${data.length}.`);
  return { data, source };
}

/* ---------------------------------------------------------------- schemas */

export const ChartDataPoint = z.object({
  label: z.string().min(1).max(64).describe('Category name. It names the value\'s slider, so labels must be unique.'),
  value: z.number().finite().describe('The number.'),
  color: Color.optional().describe('This item\'s colour, winning over colorMode.'),
});

const DataColumns = z
  .object({
    label: z.string().min(1).optional().describe('Header (CSV) or key (JSON) of the label column.'),
    value: z.string().min(1).optional().describe('Header or key of the value column.'),
    color: z.string().min(1).optional().describe('Header or key of an optional colour column.'),
  })
  .describe('Which columns of dataFile to read. Default: a column named label, name, category, date or month (else the first text column), one named value, amount, count or total (else the first number column), and color.');

const DataArgs = {
  data: z.array(ChartDataPoint).min(1).max(200).optional().describe('Items in order: [{label, value, color?}].'),
  dataFile: z
    .string()
    .min(1)
    .optional()
    .describe('Absolute path (or ~/) to a .csv, .tsv or .json file, read by the server. CSV: a header row, then one row per item. JSON: [{label, value}], [[label, value]], {label: value} or {data: [...]}. Numbers like "1,234", "$12K" and "45%" are read.'),
  dataColumns: DataColumns.optional(),
};

export const ChartFormat = z
  .object({
    decimals: z.number().int().min(0).max(6).optional().describe('Digits after the decimal mark. Default: as many as the data shows, at most 2.'),
    prefix: z.string().max(12).optional().describe('Text before the number, such as "$".'),
    suffix: z.string().max(12).optional().describe('Text after the number, such as "%" or "K".'),
    thousands: z.union([z.boolean(), z.string().max(3)]).optional().describe('Thousands separator: true (default, ","), false for none, or the text to use such as " " or ".".'),
    decimalMark: z.string().min(1).max(2).optional().describe('Default ".".'),
    compact: z.boolean().optional().describe('Write 1.2K, 3.4M, 5.6B. Default false for values; axis labels go compact from 10,000.'),
  })
  .describe('How numbers are written. Counters use the same format while they count.');

const StyleArgs = {
  theme: z.enum(['auto', 'light', 'dark']).optional().describe('auto (default) reads a full-frame solid at the bottom of the comp, else the comp background colour, and uses dark text on light backgrounds and light text on dark ones.'),
  accent: Color.optional().describe('The data colour. Default a calm blue (#2A78D6 on light, #3987E5 on dark).'),
  textColor: Color.optional().describe('Numbers. Default near-black or near-white from the theme.'),
  labelColor: Color.optional().describe('Category and axis labels, legends, captions. Default a grey from the theme.'),
  gridColor: Color.optional().describe('Gridlines. Default a soft grey from the theme.'),
  axisColor: Color.optional().describe('Axis line. Default a slightly stronger grey.'),
  font: z.string().min(1).optional().describe('PostScript font name for labels. Default: the After Effects default font.'),
  numberFont: z.string().min(1).optional().describe('PostScript font for numbers and counters. Default: font.'),
};

const SeriesColorArgs = {
  colorMode: z.enum(['accent', 'palette', 'shades']).optional().describe('accent: every item in the accent colour. palette: a colour-blind-safe palette in fixed order. shades: the accent stepped toward the background.'),
  palette: z.array(Color).min(1).max(12).optional().describe('Your own palette for colorMode palette, in order.'),
  highlight: z.array(z.string().min(1)).min(1).max(60).optional().describe('Labels to show in the accent colour; every other item becomes a neutral grey (mutedColor).'),
  mutedColor: Color.optional().describe('The neutral for items not highlighted.'),
};

const FontSizeArgs = {
  fontSize: z.number().positive().max(1000).optional().describe('Value labels and counters in pixels. Default scales with the comp height (28 at 1080).'),
  labelFontSize: z.number().positive().max(1000).optional().describe('Category labels and legends in pixels. Default scales with the comp height (22 to 24 at 1080).'),
};

function timingArgs(durationText: string, easingText = 'Default: speed 0 at both keys, influence 25 leaving and 100 arriving (a fast start and a long landing, no overshoot).') {
  return {
    startTime: z.number().min(0).optional().describe('Seconds when the intro starts. Default 0.'),
    startFrame: z.number().int().min(0).optional().describe('Frames; wins over startTime.'),
    duration: z.number().positive().max(600).optional().describe(durationText),
    durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
    easing: Easing.optional().describe('Easing of the intro keys. ' + easingText),
    animate: z.boolean().optional().describe('false builds the finished chart with no keys. Default true.'),
  };
}

function staggerArg(text: string) {
  return { staggerFrames: z.number().int().min(0).max(600).optional().describe(text) };
}

const ComponentArg = z
  .union([z.boolean(), z.object({ name: z.string().min(1).max(255).optional(), templateName: z.string().min(1).max(255).optional() })])
  .optional()
  .describe('Also make the chart a component (create-component): its layers move into a comp of that name, cropped to the chart, and each data slider becomes an Essential Property labelled with the slider name, so every instance can show its own numbers.');

const Placement = {
  name: z.string().min(1).max(120).optional().describe('Chart name, the start of every layer name ("<name> / Controls"). Default by type, numbered when taken.'),
  position: Vec2.optional(),
};

/** Shared reshaping: data files are read here, component false is dropped. */
function prepare(args: Record<string, unknown>, rules: DataRules): Record<string, unknown> {
  const { dataFile, dataColumns, data, component, ...rest } = args as Record<string, unknown> & { dataFile?: string; dataColumns?: DataColumnsSpec; data?: ChartDatum[]; component?: unknown };
  const res = resolveData({ data, dataFile, dataColumns }, rules);
  const out: Record<string, unknown> = { ...rest, data: res.data };
  if (res.source) out.dataSource = res.source;
  if (component !== undefined && component !== false) out.component = component;
  return out;
}

function checkHighlight(highlight: string[] | undefined, data: unknown): void {
  if (!highlight) return;
  const labels = (data as ChartDatum[]).map((d) => d.label);
  for (const h of highlight) {
    if (!labels.includes(h)) throw new Error(`highlight "${h}" is not one of the labels: ${labels.join(', ')}.`);
  }
}

function dropFalseComponent<T extends { component?: unknown }>(args: T): Record<string, unknown> {
  const { component, ...rest } = args;
  return component === undefined || component === false ? rest : { ...rest, component };
}

const ChartTarget = {
  comp: CompRef.optional().describe('The composition holding the chart (or the component instance). Default: the active composition.'),
  chart: z.string().min(1).optional().describe('Chart name (the part before " / Controls"). Optional when the comp holds one chart.'),
  controls: LayerRef.optional().describe('The chart\'s control null, instead of chart.'),
  instance: LayerRef.optional().describe('A component instance of a chart made with component: its Essential Properties are changed instead of the chart inside.'),
};

function checkTarget(args: { controls?: unknown; instance?: unknown }): void {
  if (args.controls !== undefined && args.instance !== undefined) throw new Error('Give controls or instance, not both.');
}

/* ------------------------------------------------------------------ tools */

export function registerChartTools(server: McpServer): void {
  defineTool(server, {
    name: 'create-bar-chart',
    group: 'charts',
    timeout: 120000,
    description:
      'Builds a bar chart as editable layers: one shape layer per bar (rounded data end, square base), value labels that count with the bars, category labels, soft gridlines on round steps with axis labels, and an axis line. Each value is a Slider Control named by its label on the null "<name> / Controls"; bars, labels and counters follow the sliders by expression. ' +
      'Use when: a film shows amounts by category, such as revenue per quarter. Do not use for: change over time (create-line-chart) or parts of a whole (create-pie-chart). ' +
      'Inputs: data [{label, value, color}] or dataFile (CSV or JSON); orientation; position (plot centre) and size (plot area); barWidth, gap, cornerRadius; colorMode, highlight; valueLabels end, inside or none; format; max, steps; gridlines, axis, axisLabels; startTime, duration per bar (default 0.8 s), staggerFrames, easing; animate; component. ' +
      'Returns: layers by role, controls with slider paths and expressions, the axis, layout, timing and expression errors. ' +
      'Notes: each bar grows on its own Grow slider (two keys). Values must be 0 or more. Undoable in one step. ' +
      'Example: data [{label: "Q1", value: 42}, {label: "Q2", value: 58}], format {prefix: "$", suffix: "K"}, highlight ["Q2"].',
    input: {
      comp: CompRef.optional(),
      ...DataArgs,
      ...Placement,
      orientation: z.enum(['vertical', 'horizontal']).optional().describe('vertical (default): columns grow up. horizontal: bars grow right, labels on the left.'),
      size: Vec2.optional().describe('[width, height] of the plot area (bars and gridlines) in pixels; labels sit outside it. Default half the comp width and 42 % of its height.'),
      barWidth: z.number().positive().max(20000).optional().describe('Bar thickness in pixels. Default about 64 % of each category\'s space, capped so few bars stay slim.'),
      gap: z.number().min(0).max(20000).optional().describe('Pixels between bars. With barWidth too, the bars are packed and centred.'),
      cornerRadius: z.number().min(0).max(5000).optional().describe('Radius of the data end in pixels. Default 16 % of the bar width, at most 16 at 1080.'),
      roundBase: z.boolean().optional().describe('Round the baseline end too. Default false (square on the axis).'),
      max: z.number().positive().optional().describe('Fixed top of the axis. Default: a round number above the largest value.'),
      steps: z.number().int().min(1).max(12).optional().describe('Gridline steps. Default 4 to 6, whichever fits the data tightest.'),
      gridlines: z.boolean().optional().describe('Default true.'),
      axis: z.boolean().optional().describe('Baseline axis line. Default true.'),
      axisLabels: z.boolean().optional().describe('Numbers on the gridlines. Default: on with gridlines.'),
      categoryLabels: z.boolean().optional().describe('Default true.'),
      valueLabels: z.enum(['end', 'inside', 'none']).optional().describe('end (default) past the bar end, inside the bar (shown once it fits), or none.'),
      format: ChartFormat.optional(),
      ...SeriesColorArgs,
      ...StyleArgs,
      ...FontSizeArgs,
      ...timingArgs('Seconds each bar takes to grow. Default 0.8.'),
      ...staggerArg('Frames between one bar and the next. Default about 0.07 s.'),
      component: ComponentArg,
    },
    toBridgeArgs: (args) => {
      const out = prepare(args, { min: 1, max: 60, nonNegative: true, what: 'A bar chart' });
      checkHighlight(args.highlight, out.data);
      return out;
    },
  });

  defineTool(server, {
    name: 'create-line-chart',
    group: 'charts',
    timeout: 120000,
    description:
      'Builds a line chart as editable layers: a smooth or straight line that draws on with Trim Paths (two eased keys), dots that pop on as the line reaches them, an optional area under the line (a soft gradient or a solid wash) that follows the line as it draws, value labels on the last or every point, category labels, and gridlines on round steps. The path is built by expression (createPath) from one Slider Control per point. ' +
      'Use when: a metric changes over time. Do not use for: comparing categories (create-bar-chart). ' +
      'Inputs: data or dataFile (at least 2 points); position, size; min (number or "auto"), max, steps; smooth; lineWidth; dots, dotSize; area gradient, solid or none; areaOpacity; pointLabels last, all or none; labelEvery; format; startTime, duration of the draw (default 1.2 s), easing; animate; component. ' +
      'Returns: layers by role, controls, the axis, when each point is reached, and expression errors. ' +
      'Notes: the smooth line never swings past its data (monotone curve). The gradient area uses a luma track matte (After Effects 23 or later). Undoable in one step. ' +
      'Example: dataFile "~/data/mrr.csv", format {prefix: "$", compact: true}, area "gradient".',
    input: {
      comp: CompRef.optional(),
      ...DataArgs,
      ...Placement,
      size: Vec2.optional().describe('[width, height] of the plot area in pixels; the first and last points sit on its edges. Default 60 % of the comp width and 42 % of its height.'),
      min: z.union([z.number(), z.literal('auto')]).optional().describe('Bottom of the axis: a number, or "auto" to fit the data. Default 0 (lower when data goes below 0).'),
      max: z.number().optional().describe('Top of the axis. Default: a round number above the largest value.'),
      steps: z.number().int().min(1).max(12).optional().describe('Gridline steps. Default 4 to 6.'),
      smooth: z.boolean().optional().describe('Curved through the points (default) or straight segments.'),
      lineWidth: z.number().positive().max(200).optional().describe('Pixels. Default 4 at 1080.'),
      dots: z.boolean().optional().describe('A dot on every point, popping on as the line passes. Default true up to 24 points, false for denser lines.'),
      dotSize: z.number().positive().max(500).optional().describe('Dot diameter in pixels. Default 3 times the line width.'),
      area: z.enum(['gradient', 'solid', 'none']).optional().describe('Fill under the line. Default gradient (fading toward the bottom).'),
      areaOpacity: z.number().min(0).max(100).optional().describe('Area opacity in percent at its strongest. Default 32 for gradient, 14 for solid.'),
      pointLabels: z.enum(['last', 'all', 'none']).optional().describe('Value labels: on the last point (default, to its right), above every point, or none.'),
      labelEvery: z.number().int().min(1).max(200).optional().describe('Show every Nth category label. Default: enough for about 12 labels.'),
      gridlines: z.boolean().optional().describe('Default true.'),
      axis: z.boolean().optional().describe('Axis line at 0 (or the bottom). Default true.'),
      axisLabels: z.boolean().optional().describe('Default: on with gridlines.'),
      categoryLabels: z.boolean().optional().describe('Default true.'),
      format: ChartFormat.optional(),
      ...StyleArgs,
      ...FontSizeArgs,
      ...timingArgs('Seconds the line takes to draw. Default 1.2.', 'Default: speed 0 at both keys, influence 40 leaving and 75 arriving, an even draw that settles.'),
      ...staggerArg('Frames between category labels fading in. Default about 0.07 s.'),
      component: ComponentArg,
    },
    toBridgeArgs: (args) => {
      if (typeof args.min === 'number' && args.max !== undefined && args.max <= args.min) throw new Error('max must be greater than min.');
      return prepare(args, { min: 2, max: 200, what: 'A line chart' });
    },
  });

  defineTool(server, {
    name: 'create-pie-chart',
    group: 'charts',
    timeout: 120000,
    description:
      'Builds a donut or pie chart as editable layers: one stroked circle per slice trimmed to its share (Trim Paths Start and End by expression), a gap between slices, percentage or value labels at the slice centres that count as the slices fill, a legend, and an optional total in the donut hole. Slices fill clockwise one after another from the start angle. ' +
      'Use when: parts of a whole, such as plan mix or traffic sources. Do not use for: more than about 6 parts or comparing sizes closely (create-bar-chart). ' +
      'Inputs: data or dataFile; position (centre); radius; innerRadius (default 62 % of radius, 0 for a pie); startAngle (degrees clockwise from 12 o\'clock); gap in pixels; colorMode (default shades), palette, highlight; labels percent, value, label, label-percent or none; labelPosition auto, inside or outside; minLabelShare; legend; center {total, label}; format; startTime, duration per slice (default 0.8 s), staggerFrames; animate; component. ' +
      'Returns: layers by role, controls, each share in percent with its colour, layout, timing and expression errors. ' +
      'Notes: labels on slices under minLabelShare (default 4 %) are hidden. Undoable in one step. ' +
      'Example: data [{label: "Pro", value: 62}, {label: "Team", value: 28}, {label: "Free", value: 10}], center {label: "Customers"}.',
    input: {
      comp: CompRef.optional(),
      ...DataArgs,
      ...Placement,
      radius: z.number().positive().max(10000).optional().describe('Outer radius in pixels. Default 30 % of the smaller comp side.'),
      innerRadius: z.number().min(0).max(10000).optional().describe('Hole radius in pixels. Default 62 % of radius; 0 draws a pie.'),
      startAngle: z.number().min(-360).max(360).optional().describe('Where the first slice starts, degrees clockwise from 12 o\'clock. Default 0.'),
      gap: z.number().min(0).max(200).optional().describe('Space between slices in pixels. Default 4 for a donut, 3 for a pie at 1080.'),
      labels: z.enum(['percent', 'value', 'label', 'label-percent', 'none']).optional().describe('What each slice shows. Default percent.'),
      labelPosition: z.enum(['auto', 'inside', 'outside']).optional().describe('auto (default): inside when the ring is thick enough, else outside.'),
      minLabelShare: z.number().min(0).max(100).optional().describe('Slices smaller than this percent get no label. Default 4.'),
      legend: z.boolean().optional().describe('Swatch and label rows to the right. Default true.'),
      center: z
        .union([z.boolean(), z.object({ total: z.boolean().optional().describe('The total, counting up. Default true.'), label: z.string().max(80).optional().describe('A caption under it.'), format: ChartFormat.optional() })])
        .optional()
        .describe('Donut only: the total (and a caption) in the hole.'),
      format: ChartFormat.optional().describe('Number format. Percent labels default to whole numbers with "%".'),
      ...SeriesColorArgs,
      ...StyleArgs,
      ...FontSizeArgs,
      ...timingArgs('Seconds each slice takes to fill. Default 0.8.'),
      ...staggerArg('Frames between one slice and the next. Default about 0.12 s.'),
      component: ComponentArg,
    },
    toBridgeArgs: (args) => {
      if (args.innerRadius !== undefined && args.radius !== undefined && args.innerRadius >= args.radius) throw new Error('innerRadius must be smaller than radius.');
      const out = prepare(args, { min: 1, max: 24, nonNegative: true, what: 'A pie chart' });
      if (!(out.data as ChartDatum[]).some((d) => d.value > 0)) throw new Error('The values add up to 0, so there is nothing to divide.');
      checkHighlight(args.highlight, out.data);
      if (args.center === false) delete out.center;
      return out;
    },
  });

  defineTool(server, {
    name: 'create-stat',
    group: 'charts',
    timeout: 120000,
    description:
      'Builds a KPI block: a big number counting up to a value in a number format, a label above it, an optional change row (an up or down arrow and the change, green when good and red when bad, with a caption such as "vs last month") and an optional sparkline that draws while the number counts. Value, From, Delta and the sparkline points are Slider Controls on the control null; a Count slider (two eased keys) drives the count. ' +
      'Use when: a film calls out one metric, such as revenue. Do not use for: several values (create-bar-chart) or a percentage bar or ring (create-progress). ' +
      'Inputs: value; label; from (default 0); format; align left or center; position (top-left, or top-centre); fontSize, labelFontSize; delta {value, format (default "%"), goodWhen up or down, caption}; sparkline {data, width, height, color, dot, smooth}; upColor, downColor; startTime, duration (default 1.2 s), easing; animate; component. ' +
      'Returns: the layers by role, the controls, the final text, layout and timing. ' +
      'Notes: arrow, colour and text follow the Delta slider, so a later change can flip them. Undoable in one step. ' +
      'Example: value 48250, label "Monthly revenue", format {prefix: "$"}, delta {value: 12.4, caption: "vs last month"}.',
    input: {
      comp: CompRef.optional(),
      value: z.number().finite().describe('The number the counter lands on.'),
      label: z.string().max(120).optional().describe('Caption above the number.'),
      from: z.number().finite().optional().describe('Where the count starts. Default 0.'),
      format: ChartFormat.optional(),
      align: z.enum(['left', 'center']).optional().describe('Default left.'),
      ...Placement,
      fontSize: z.number().positive().max(2000).optional().describe('The number in pixels. Default 112 at 1080.'),
      labelFontSize: z.number().positive().max(1000).optional().describe('Label, change and caption in pixels. Default 28 at 1080.'),
      delta: z
        .object({
          value: z.number().finite().describe('The change, such as 12.4 or -3. Its sign picks the arrow.'),
          format: ChartFormat.optional().describe('Default one decimal at most and "%".'),
          goodWhen: z.enum(['up', 'down']).optional().describe('Which direction is good (green). Default up; down suits churn or costs.'),
          caption: z.string().max(80).optional().describe('Muted text after the change, such as "vs last month".'),
        })
        .optional(),
      sparkline: z
        .object({
          data: z.array(z.number().finite()).min(2).max(120).describe('Points in order.'),
          width: z.number().positive().max(10000).optional().describe('Pixels. Default 3.6 times the number size.'),
          height: z.number().positive().max(5000).optional().describe('Pixels. Default 0.62 times the number size.'),
          color: Color.optional().describe('Default the accent.'),
          dot: z.boolean().optional().describe('A dot on the last point. Default true.'),
          smooth: z.boolean().optional().describe('Default true.'),
        })
        .optional(),
      upColor: Color.optional().describe('Colour of a good change. Default green.'),
      downColor: Color.optional().describe('Colour of a bad change. Default red.'),
      ...StyleArgs,
      ...timingArgs('Seconds the number counts. Default 1.2.'),
      component: ComponentArg,
    },
    toBridgeArgs: (args) => dropFalseComponent(args),
  });

  defineTool(server, {
    name: 'create-progress',
    group: 'charts',
    timeout: 120000,
    description:
      'Builds a progress bar or ring that fills to a value: a pill-shaped track with a fill that grows from the left, or a ring whose fill draws clockwise from 12 o\'clock with round caps, plus a percentage (or value) that counts with the fill and an optional caption. Value and Max are Slider Controls on the control null and a Grow slider (two eased keys) drives the fill. ' +
      'Use when: completion, usage against a limit, a goal or a score, such as "Onboarding 72 %". Do not use for: several categories (create-bar-chart) or a headline number with a change (create-stat). ' +
      'Inputs: value; max (default 100); style bar or ring; position (centre); size [width, height] for a bar; radius and thickness for a ring; roundCaps; display percent, value or none; format; caption; accent, trackColor (default a light step of the accent); startTime, duration (default 1 s), easing; animate; component. ' +
      'Returns: the layers by role, the controls, the percent shown, layout and timing. ' +
      'Notes: the fill stops at 0 and 100 %. Undoable in one step. ' +
      'Example: value 72, style "ring", caption "Profile complete".',
    input: {
      comp: CompRef.optional(),
      value: z.number().finite().describe('How far along, in the units of max.'),
      max: z.number().positive().optional().describe('The full amount. Default 100.'),
      style: z.enum(['bar', 'ring']).optional().describe('Default bar.'),
      ...Placement,
      size: Vec2.optional().describe('Bar only: [width, height] in pixels. Default 40 % of the comp width by 16.'),
      radius: z.number().positive().max(10000).optional().describe('Ring only: radius to the middle of the stroke in pixels. Default 16 % of the smaller comp side.'),
      thickness: z.number().positive().max(2000).optional().describe('Ring only: stroke width in pixels. Default 14 % of the radius.'),
      roundCaps: z.boolean().optional().describe('Ring only: round ends on the fill. Default true.'),
      display: z.enum(['percent', 'value', 'none']).optional().describe('The counter: a percentage (default), the value itself, or nothing.'),
      format: ChartFormat.optional(),
      caption: z.string().max(120).optional().describe('Text beside the bar (left above it) or under the ring\'s number.'),
      trackColor: Color.optional().describe('The unfilled track. Default a light step of the accent.'),
      fontSize: z.number().positive().max(2000).optional().describe('The counter in pixels.'),
      labelFontSize: z.number().positive().max(1000).optional().describe('The caption in pixels.'),
      ...StyleArgs,
      ...timingArgs('Seconds the fill takes. Default 1.'),
      component: ComponentArg,
    },
    toBridgeArgs: (args) => {
      if (args.style !== 'ring' && (args.radius !== undefined || args.thickness !== undefined || args.roundCaps !== undefined)) throw new Error('radius, thickness and roundCaps apply to style "ring".');
      if (args.style === 'ring' && args.size !== undefined) throw new Error('size applies to style "bar"; a ring takes radius and thickness.');
      return dropFalseComponent(args);
    },
  });

  defineTool(server, {
    name: 'update-chart-data',
    group: 'charts',
    timeout: 60000,
    description:
      'Changes a chart\'s values by label, made by the chart tools, and can animate the change: each changed slider gets two eased keys from the value it shows at the start to the new one, so bars, lines, slices, labels and counters move together. An automatic axis is rescaled to round numbers for the new data in the same move. ' +
      'Use when: a scene compares two periods or a number updates on screen. Do not use for: adding or removing categories (build the chart again) or styling. ' +
      'Inputs: chart (name), controls (the control null) or instance (a component instance, whose Essential Properties change); values {label: number}, data or dataFile; startTime or startFrame (default the current time), duration (default 0.8 s), easing; animate (default true when a time or duration is given); rescale (default true). Stats take Value, From, Delta and Spark N; progress takes Value and Max. ' +
      'Returns: each change with from, to and keys, the axis before and after, and notes. ' +
      'Notes: unknown labels fail before anything changes. Without animation a keyed slider gets the value on its last key. Undoable in one step. ' +
      'Example: chart "Revenue", values {"Q3": 71, "Q4": 88}, startTime 4, duration 0.8.',
    input: {
      ...ChartTarget,
      values: z.record(z.string().min(1), z.number().finite()).optional().describe('New values by label, for example {"Q3": 71}.'),
      data: z.array(z.object({ label: z.string().min(1), value: z.number().finite() })).min(1).max(200).optional().describe('New values as [{label, value}].'),
      dataFile: DataArgs.dataFile,
      dataColumns: DataColumns.optional(),
      animate: z.boolean().optional().describe('Animate the change. Default true when startTime, startFrame, duration, durationFrames or easing is given, else false.'),
      startTime: z.number().min(0).optional().describe('Seconds when the change starts. Default the current time.'),
      startFrame: z.number().int().min(0).optional().describe('Frames; wins over startTime.'),
      duration: z.number().positive().max(600).optional().describe('Seconds. Default 0.8.'),
      durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
      easing: Easing.optional().describe('Default: speed 0, influence 25 leaving and 100 arriving.'),
      rescale: z.boolean().optional().describe('Move an automatic axis to fit the new data. Default true.'),
    },
    toBridgeArgs: (args) => {
      checkTarget(args);
      const { dataFile, dataColumns, data, ...rest } = args;
      const out: Record<string, unknown> = { ...rest };
      if (dataFile || data) {
        const res = resolveData({ data, dataFile, dataColumns }, { what: 'The update' });
        out.data = res.data.map((d) => ({ label: d.label, value: d.value }));
        if (res.source) out.dataSource = res.source;
      }
      if (!out.data && !out.values) throw new Error('Give values {label: number}, data [{label, value}] or dataFile.');
      if (out.values && out.data) {
        const dup = (out.data as ChartDatum[]).find((d) => Object.keys(out.values as Record<string, number>).some((k) => k.toLowerCase() === d.label.toLowerCase()));
        if (dup) throw new Error(`"${dup.label}" is given in both values and data.`);
      }
      return out;
    },
  });

  defineTool(server, {
    name: 'get-chart-data',
    group: 'charts',
    mutating: false,
    description:
      'Reads the charts made by the chart tools in a composition: for each, its name and type, the control null, every value by label as it stands at a time (with the number of keys on its slider), the axis range and steps, the number format, and the chart\'s layers. With instance it reads a component instance\'s own values. ' +
      'Use when: before update-chart-data, to see the labels and current numbers; or to check what a chart shows at a moment. Do not use for: reading any other layer (get-layer-details). ' +
      'Inputs: comp; chart (name), controls or instance to read one chart (default every chart in the comp); time or frame (default the current time). ' +
      'Returns: composition, time, count and charts[] with values [{label, effect, value, keys, source}], axis {min, max, steps, auto} and layers. ' +
      'Notes: read-only. Values are the sliders\' own (keyed) values times the chart\'s scale; a slider that was deleted reads null. ' +
      'Example: chart "Revenue", time 3.',
    input: { ...ChartTarget, ...TimeArgs },
    toBridgeArgs: (args) => {
      checkTarget(args);
      return args;
    },
  });
}
