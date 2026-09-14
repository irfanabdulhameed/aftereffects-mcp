#!/usr/bin/env node
/*
 * Assembles the ExtendScript bridge panel from server/src/scripts into one file,
 * because After Effects loads a ScriptUI panel as a single .jsx.
 *
 * Order: lib/polyfills.jsx, lib/json.jsx, the rest of lib/ in the fixed order
 * below, then every file under commands/ (recursively, sorted by path), then
 * panel/mcp-bridge-auto.jsx.
 *
 * Output: server/build/scripts/mcp-bridge-auto.jsx
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(serverRoot, 'src', 'scripts');
const outDir = path.join(serverRoot, 'build', 'scripts');
const outFile = path.join(outDir, 'mcp-bridge-auto.jsx');

const LIB_ORDER = [
  'polyfills.jsx',
  'json.jsx',
  'core.jsx',
  'color.jsx',
  'undo.jsx',
  'resolve.jsx',
  'serialize.jsx',
  'easing.jsx',
];

function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile() && entry.name.endsWith('.jsx')) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b, 'en'));
}

function readSource(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
}

export function assembleBridge() {
  const libDir = path.join(srcRoot, 'lib');
  const libFiles = [];
  for (const name of LIB_ORDER) {
    const full = path.join(libDir, name);
    if (fs.existsSync(full)) libFiles.push(full);
  }
  for (const full of listFilesRecursive(libDir)) {
    if (!libFiles.includes(full)) libFiles.push(full);
  }
  const commandFiles = listFilesRecursive(path.join(srcRoot, 'commands'));
  const panelFile = path.join(srcRoot, 'panel', 'mcp-bridge-auto.jsx');
  if (!fs.existsSync(panelFile)) throw new Error(`Panel source not found: ${panelFile}`);

  const pkg = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
  const files = [...libFiles, ...commandFiles, panelFile];

  const parts = [];
  parts.push(
    '/*\n' +
      ' * MCP Bridge Auto for Adobe After Effects.\n' +
      ' * DO NOT EDIT. This file is generated from server/src/scripts by\n' +
      ' * server/scripts/build-bridge.js. Edit the source files and run npm run build.\n' +
      ` * Bridge version: ${pkg.version}\n` +
      ' */\n' +
      `var MCP_BRIDGE_VERSION = ${JSON.stringify(pkg.version)};\n`
  );
  for (const file of files) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/');
    parts.push(`\n/* ---- ${rel} ---- */\n`);
    parts.push(readSource(file));
  }
  const output = parts.join('');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, output, 'utf8');
  return { outFile, files: files.map((f) => path.relative(srcRoot, f)), bytes: Buffer.byteLength(output) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = assembleBridge();
  console.log(`Assembled ${result.files.length} files into ${path.relative(serverRoot, result.outFile)} (${result.bytes} bytes)`);
}
