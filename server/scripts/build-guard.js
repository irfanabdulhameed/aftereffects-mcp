/*
 * Compiles the macOS guard helper (src/guard/native/ae-guard.swift) into
 * build/bin/ae-guard. Skipped with a note on other platforms or when swiftc is
 * missing: the server then works without dialog scanning and dismissal.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const source = path.join(serverRoot, 'src', 'guard', 'native', 'ae-guard.swift');
const outDir = path.join(serverRoot, 'build', 'bin');
const outFile = path.join(outDir, 'ae-guard');

export function buildGuard() {
  if (process.platform !== 'darwin') return { built: false, reason: 'not macOS' };
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'ignore' });
  } catch {
    return { built: false, reason: 'swiftc not found (install the Xcode command line tools)' };
  }
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync('swiftc', ['-O', source, '-o', outFile], { stdio: 'inherit' });
  return { built: true, outFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildGuard();
  console.log(result.built ? `Built ${path.relative(serverRoot, result.outFile)}` : `Guard helper skipped: ${result.reason}`);
}
