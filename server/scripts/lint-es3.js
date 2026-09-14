#!/usr/bin/env node
/*
 * Fails the build when any .jsx file under server/src/scripts (or the assembled
 * build/scripts/mcp-bridge-auto.jsx) uses syntax newer than ECMAScript 3.
 * After Effects runs ExtendScript, which is ES3. Parsing with acorn at
 * ecmaVersion 3 rejects let, const, arrow functions, template literals,
 * default parameters, destructuring, getters and setters, trailing commas in
 * object literals, reserved words used as property names, and so on.
 *
 * Usage: node scripts/lint-es3.js [files...]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as acorn from 'acorn';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile() && entry.name.endsWith('.jsx')) out.push(full);
  }
  return out.sort();
}

// Method names that only exist in ES5 or later. Calling them on a value in
// ExtendScript throws at runtime unless lib/polyfills.jsx supplies them.
// The polyfill file is allowed to mention them; everything else is flagged
// unless the name is in POLYFILLED.
const POLYFILLED = new Set([
  'indexOf', 'lastIndexOf', 'forEach', 'map', 'filter', 'some', 'every', 'reduce',
  'isArray', 'keys', 'trim', 'bind', 'toISOString', 'now',
]);
const ES5_PLUS_ONLY = ['create', 'defineProperty', 'freeze', 'getPrototypeOf', 'assign', 'entries', 'values', 'find', 'findIndex', 'includes', 'startsWith', 'endsWith', 'padStart', 'padEnd', 'repeat', 'fill', 'from', 'of'];

export function lintEs3File(file) {
  const problems = [];
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    acorn.parse(text, { ecmaVersion: 3, allowReserved: false, sourceType: 'script', locations: true });
  } catch (err) {
    problems.push(`${file}:${err.loc ? err.loc.line + ':' + err.loc.column : '?'} ${err.message}`);
    return problems;
  }
  // Cheap textual checks for ES5+ APIs that parse fine but fail at runtime.
  const lines = text.split('\n');
  const isPolyfillFile = path.basename(file) === 'polyfills.jsx';
  lines.forEach((line, i) => {
    if (isPolyfillFile) return;
    const stripped = line.replace(/\/\/.*$/, '');
    for (const name of ES5_PLUS_ONLY) {
      const re = new RegExp(`\\b(Object|Array|String)\\.${name}\\s*\\(`);
      if (re.test(stripped)) problems.push(`${file}:${i + 1} uses ${RegExp.$1}.${name}(), which does not exist in ExtendScript`);
    }
    if (/\bJSON\s*\.\s*(stringify|parse)\s*\(/.test(stripped) && !/\btypeof\s+JSON\b/.test(stripped)) {
      // fine: lib/json.jsx supplies JSON. Nothing to report.
    }
    if (line.indexOf(String.fromCharCode(0x2014)) !== -1) problems.push(`${file}:${i + 1} contains an em dash`);
  });
  return problems;
}

export function lintEs3(files) {
  const all = [];
  for (const f of files) all.push(...lintEs3File(f));
  return all;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = args.length
    ? args.map((f) => path.resolve(f))
    : [...listFilesRecursive(path.join(serverRoot, 'src', 'scripts')), ...listFilesRecursive(path.join(serverRoot, 'build', 'scripts'))];
  const problems = lintEs3(files);
  if (problems.length) {
    console.error(`ES3 lint failed with ${problems.length} problem(s):`);
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log(`ES3 lint passed for ${files.length} file(s).`);
}
