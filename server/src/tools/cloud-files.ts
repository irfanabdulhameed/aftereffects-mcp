/*
 * Files kept online-only by a sync client (OneDrive, iCloud Drive, Dropbox,
 * Google Drive on macOS). Such a file has its full size but no blocks on disk
 * until something reads it. After Effects reading one blocks its main thread
 * while the file downloads, so the server reads it first.
 */

import * as fs from 'fs';
import * as path from 'path';

const CHUNK = 1 << 20;
const RETRY_MS = 2000;

/** Sync clients sometimes answer a read of an online-only file with ETIMEDOUT at once instead of waiting; those reads are retried. */
function isTransient(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'ETIMEDOUT' || code === 'EAGAIN' || code === 'EINTR' || code === 'EDEADLK';
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** false for an online-only placeholder, true for a file on disk, null when the platform cannot tell (Windows) or the file is missing. */
export function isLocalFile(file: string): boolean | null {
  try {
    const st = fs.statSync(file);
    if (process.platform === 'win32' || typeof st.blocks !== 'number') return null;
    return !(st.isFile() && st.size > 0 && st.blocks === 0);
  } catch {
    return null;
  }
}

/** Every file under a folder, skipping dot files. */
export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile()) out.push(p);
    }
  };
  walk(dir, 0);
  return out.sort((a, b) => a.localeCompare(b, 'en'));
}

/** The files After Effects reads for a library component: its .aep and everything in the footage folder beside it. */
export function componentFiles(aep: string): string[] {
  return [aep, ...filesUnder(path.join(path.dirname(aep), 'footage'))];
}

export interface DownloadReport {
  downloaded: string[];
  bytes: number;
  seconds: number;
}

function readThroughSync(file: string): number {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(CHUNK);
  let total = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      total += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return total;
}

async function readThrough(file: string, deadline: number): Promise<number> {
  const handle = await fs.promises.open(file, 'r');
  const buf = Buffer.allocUnsafe(CHUNK);
  let total = 0;
  try {
    for (;;) {
      if (Date.now() > deadline) throw new Error(`Downloading ${file} from the cloud took too long. Open the folder in Finder and choose "Always Keep on This Device", or try again.`);
      const { bytesRead } = await handle.read(buf, 0, CHUNK, null);
      if (bytesRead <= 0) break;
      total += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return total;
}

/** Reads every online-only file through so it is on disk before After Effects opens it. Transient sync errors are retried until the deadline. */
export async function ensureLocal(files: string[], timeoutMs = 300000): Promise<DownloadReport> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  const report: DownloadReport = { downloaded: [], bytes: 0, seconds: 0 };
  for (const f of files) {
    if (isLocalFile(f) !== false) continue;
    for (;;) {
      try {
        report.bytes += await readThrough(f, deadline);
        break;
      } catch (err) {
        if (!isTransient(err) || Date.now() + RETRY_MS > deadline) throw err;
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
    report.downloaded.push(f);
  }
  report.seconds = Math.round((Date.now() - started) / 10) / 100;
  return report;
}

/** ensureLocal for synchronous callers (batch argument preparation). Blocks until the files are on disk. */
export function ensureLocalSync(files: string[], timeoutMs = 300000): DownloadReport {
  const started = Date.now();
  const deadline = started + timeoutMs;
  const report: DownloadReport = { downloaded: [], bytes: 0, seconds: 0 };
  for (const f of files) {
    if (isLocalFile(f) !== false) continue;
    for (;;) {
      try {
        report.bytes += readThroughSync(f);
        break;
      } catch (err) {
        if (!isTransient(err) || Date.now() + RETRY_MS > deadline) throw err;
        sleepSync(RETRY_MS);
      }
    }
    report.downloaded.push(f);
  }
  report.seconds = Math.round((Date.now() - started) / 10) / 100;
  return report;
}

/** Writes a file in place (same file, not a replacement), so a sync client keeps settings such as "Always Keep on This Device". Transient sync errors are retried for up to a minute. */
export function writeInPlace(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      fs.writeFileSync(file, text, { flag: 'w' });
      return;
    } catch (err) {
      if (!isTransient(err) || Date.now() + RETRY_MS > deadline) throw err;
      sleepSync(RETRY_MS);
    }
  }
}

/** Replaces a file with new content as a new file, so an online-only old copy is never downloaded first. */
export function replaceFile(file: string, data: Buffer | string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, data);
}

/** Reads a text file, waiting at most waitMs when it is online-only. Resolves null when the download takes longer. */
export async function readTextWithin(file: string, waitMs: number): Promise<string | null> {
  if (isLocalFile(file) !== false) return fs.readFileSync(file, 'utf8');
  let timer: NodeJS.Timeout | undefined;
  const read = fs.promises.readFile(file, 'utf8');
  read.catch(() => undefined);
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([read, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
