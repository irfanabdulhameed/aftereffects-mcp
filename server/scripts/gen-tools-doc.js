#!/usr/bin/env node
/*
 * Generates docs/TOOLS.md from the registered tools: name, description, the
 * input schema as a table, the output shape summary, and an example call.
 * Run after `npm run build`. Never hand-edit docs/TOOLS.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');
const outFile = path.join(repoRoot, 'docs', 'TOOLS.md');

const GROUP_TITLES = {
  project: 'Project',
  composition: 'Composition',
  layers: 'Layers',
  transform: 'Transform and properties',
  keyframes: 'Keyframes',
  expressions: 'Expressions',
  text: 'Text',
  shapes: 'Shapes',
  masks: 'Masks',
  effects: 'Effects',
  presets: 'Animation presets',
  'camera-3d': 'Camera, lights and 3D',
  time: 'Time',
  'markers-audio': 'Markers and audio',
  render: 'Render and preview',
  rigs: 'Rigs',
  batch: 'Batch, workflow and utilities',
  help: 'Help',
};

function unwrap(schema) {
  let s = schema;
  let optional = false;
  let defaultValue;
  for (let i = 0; i < 10; i++) {
    const t = s?._def?.typeName;
    if (t === 'ZodOptional' || t === 'ZodNullable') {
      optional = true;
      s = s._def.innerType;
    } else if (t === 'ZodDefault') {
      optional = true;
      defaultValue = s._def.defaultValue();
      s = s._def.innerType;
    } else if (t === 'ZodEffects') {
      s = s._def.schema;
    } else if (t === 'ZodBranded' || t === 'ZodReadonly') {
      s = s._def.type;
    } else break;
  }
  return { schema: s, optional, defaultValue };
}

function describe(schema) {
  let s = schema;
  for (let i = 0; i < 10; i++) {
    if (s?._def?.description) return s._def.description;
    const t = s?._def?.typeName;
    if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault') s = s._def.innerType;
    else if (t === 'ZodEffects') s = s._def.schema;
    else break;
  }
  return '';
}

function typeName(schema, depth = 0) {
  const { schema: s } = unwrap(schema);
  const t = s?._def?.typeName;
  switch (t) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return s._def.checks?.some((c) => c.kind === 'int') ? 'integer' : 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodLiteral':
      return JSON.stringify(s._def.value);
    case 'ZodEnum':
      return s._def.values.map((v) => `"${v}"`).join(' | ');
    case 'ZodNativeEnum':
      return 'enum';
    case 'ZodArray':
      return `${typeName(s._def.type, depth + 1)}[]`;
    case 'ZodTuple':
      return `[${s._def.items.map((i) => typeName(i, depth + 1)).join(', ')}]`;
    case 'ZodUnion':
      return s._def.options.map((o) => typeName(o, depth + 1)).join(' | ');
    case 'ZodDiscriminatedUnion':
      return [...s._def.options.values()].map((o) => typeName(o, depth + 1)).join(' | ');
    case 'ZodRecord':
      return `object of ${typeName(s._def.valueType, depth + 1)}`;
    case 'ZodObject': {
      if (depth > 1) return 'object';
      const entries = Object.entries(s._def.shape());
      return `{${entries.map(([k, v]) => `${k}${unwrap(v).optional ? '?' : ''}: ${typeName(v, depth + 1)}`).join(', ')}}`;
    }
    case 'ZodUnknown':
    case 'ZodAny':
      return 'any';
    case 'ZodNull':
      return 'null';
    default:
      return t ? t.replace(/^Zod/, '').toLowerCase() : 'unknown';
  }
}

function exampleValue(schema, key, depth = 0) {
  const { schema: s, defaultValue } = unwrap(schema);
  if (defaultValue !== undefined) return defaultValue;
  const t = s?._def?.typeName;
  const k = (key || '').toLowerCase();
  switch (t) {
    case 'ZodString':
      if (k.includes('color')) return '#1E90FF';
      if (k.includes('path') && !k.includes('property')) return '/absolute/path/file';
      if (k === 'property') return 'Transform/Opacity';
      if (k.includes('name')) return 'My Layer';
      if (k.includes('text')) return 'Hello';
      if (k.includes('expression') || k.includes('script')) return 'wiggle(2, 10)';
      return 'value';
    case 'ZodNumber':
      if (k.includes('time')) return 1;
      if (k.includes('frame')) return 12;
      if (k.includes('opacity')) return 100;
      if (k.includes('width')) return 1920;
      if (k.includes('height')) return 1080;
      return s._def.checks?.some((c) => c.kind === 'int') ? 1 : 0.5;
    case 'ZodBoolean':
      return true;
    case 'ZodLiteral':
      return s._def.value;
    case 'ZodEnum':
      return s._def.values[0];
    case 'ZodArray': {
      const inner = exampleValue(s._def.type, key, depth + 1);
      return [inner];
    }
    case 'ZodTuple':
      return s._def.items.map((i, idx) => exampleValue(i, ['x', 'y', 'z'][idx], depth + 1));
    case 'ZodUnion':
      return exampleValue(s._def.options[0], key, depth + 1);
    case 'ZodRecord':
      return {};
    case 'ZodObject': {
      if (depth > 2) return {};
      const out = {};
      const shape = s._def.shape();
      const keys = Object.keys(shape);
      if (keys.includes('index') && keys.includes('name') && keys.includes('id')) return { name: 'My Layer' };
      if (keys.includes('id') && keys.includes('name') && keys.includes('active')) return { name: 'Main Comp' };
      for (const [kk, v] of Object.entries(shape)) {
        if (!unwrap(v).optional) out[kk] = exampleValue(v, kk, depth + 1);
      }
      return out;
    }
    case 'ZodUnknown':
    case 'ZodAny':
      if (k === 'value') return 100;
      return 'value';
    default:
      return null;
  }
}

function md(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderTool(entry) {
  const lines = [];
  lines.push(`### ${entry.name}`);
  lines.push('');
  lines.push(entry.description);
  lines.push('');
  lines.push(`Group: ${entry.group}. ${entry.mutating ? 'Changes the project (one undo step).' : 'Read-only.'} ${entry.bridge ? `Bridge command: \`${entry.bridge}\`.` : 'Runs on the server; not available inside batch.'}${entry.timeout === 'render' ? ' Uses the render timeout.' : ''}`);
  lines.push('');
  const keys = Object.keys(entry.input);
  if (keys.length === 0) {
    lines.push('Inputs: none.');
  } else {
    lines.push('| Input | Type | Required | Description |');
    lines.push('|---|---|---|---|');
    for (const key of keys) {
      const schema = entry.input[key];
      const { optional } = unwrap(schema);
      lines.push(`| \`${key}\` | ${md(typeName(schema))} | ${optional ? 'no' : 'yes'} | ${md(describe(schema))} |`);
    }
  }
  lines.push('');
  const example = {};
  for (const key of keys) {
    const schema = entry.input[key];
    const { optional } = unwrap(schema);
    if (!optional) example[key] = exampleValue(schema, key);
  }
  if (keys.includes('layer') && example.layer === undefined) example.layer = { name: 'My Layer' };
  lines.push('Example call:');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({ tool: entry.name, arguments: example }, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

export async function generateToolsDoc() {
  const indexUrl = new URL('../build/index.js', import.meta.url);
  const registryUrl = new URL('../build/tools/registry.js', import.meta.url);
  if (!fs.existsSync(fileURLToPath(indexUrl))) throw new Error('Run npm run build first; build/index.js is missing.');
  const { createServer } = await import(indexUrl.href);
  const { catalog } = await import(registryUrl.href);
  if (catalog.length === 0) createServer();
  const groups = new Map();
  for (const entry of catalog) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  const order = Object.keys(GROUP_TITLES).filter((g) => groups.has(g)).concat([...groups.keys()].filter((g) => !GROUP_TITLES[g]));
  const out = [];
  out.push('# Tools reference');
  out.push('');
  out.push('Generated by `npm run gen-docs` from the tool definitions. Do not edit by hand.');
  out.push('');
  out.push(`${catalog.length} tools in ${order.length} groups. Every mutating tool runs inside one undo group named \`MCP: <command>\` in After Effects.`);
  out.push('');
  out.push('Shared argument shapes:');
  out.push('');
  out.push('- `comp`: `{id}` or `{name}`; omit for the active composition.');
  out.push('- `layer`: `{index}` (1 is the top layer), `{id}` or `{name}`.');
  out.push('- `property`: a path such as `Transform/Position`, `Effects/Gaussian Blur/Blurriness`, `Text/Source Text`, or a matchName path.');
  out.push('- `time` (seconds) or `frame` (integer, wins when both are given).');
  out.push('- Colours: `#RRGGBB`, `#RRGGBBAA`, `[r,g,b]`, `[r,g,b,a]` (0 to 1, or 0 to 255 when any value is above 1), `{r,g,b,a}`, or a basic colour name.');
  out.push('- `easing`: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `smooth`, `snappy`, `overshoot`, `hold`, `{type:"custom", inSpeed, inInfluence, outSpeed, outInfluence}`, `{type:"bezier", x1, y1, x2, y2}`, or `"@style.<name>"`.');
  out.push('');
  out.push('## Contents');
  out.push('');
  for (const g of order) {
    out.push(`- ${GROUP_TITLES[g] ?? g} (${groups.get(g).length}): ${groups.get(g).map((e) => `\`${e.name}\``).join(', ')}`);
  }
  out.push('');
  for (const g of order) {
    out.push(`## ${GROUP_TITLES[g] ?? g}`);
    out.push('');
    for (const entry of groups.get(g).sort((a, b) => a.name.localeCompare(b.name))) out.push(renderTool(entry));
  }
  const text = out.join('\n').replace(new RegExp(String.fromCharCode(0x2014), 'g'), ',');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text, 'utf8');
  return { outFile, tools: catalog.length, groups: order.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateToolsDoc()
    .then((r) => console.log(`Wrote ${path.relative(repoRoot, r.outFile)}: ${r.tools} tools in ${r.groups} groups`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
