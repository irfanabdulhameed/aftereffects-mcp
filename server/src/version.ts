import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const SERVER_VERSION = readVersion();
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
