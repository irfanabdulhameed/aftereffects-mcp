/*
 * Mock result shapes for the render command group. See core.js for helpers and shapes to mirror.
 *
 * The frame commands write a real PNG (128 x 72, solid colour with a diagonal
 * line) to the path the Node side asks for, so the server's pngjs scaling and
 * tiling code runs in tests. The mock composition is "Main Comp" (id 1),
 * 1920 x 1080 at 30 fps, 10 s long, work area 1 s to 5 s.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';

const COMP = { id: 1, name: 'Main Comp' };
const FPS = 30;
const DURATION = 10;
const WORK = { start: 1, duration: 4 };
export const MOCK_FRAME = { width: 128, height: 72 };

const round4 = (n) => Math.round(n * 10000) / 10000;
const snap = (t) => Math.max(0, Math.min(DURATION - 1 / FPS, Math.round(t * FPS) / FPS));

export function writeMockPng(file, width = MOCK_FRAME.width, height = MOCK_FRAME.height, seed = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const onLine = Math.abs(Math.round((x * height) / width) - y) <= 1;
      png.data[i] = onLine ? 255 : (40 + seed * 20) % 256;
      png.data[i + 1] = onLine ? 255 : 90;
      png.data[i + 2] = onLine ? 255 : 160;
      png.data[i + 3] = 255;
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png));
  return file;
}

function timeOf(args) {
  if (args.frame !== undefined) return snap(args.frame / FPS);
  if (args.time !== undefined) return snap(args.time);
  return snap(2);
}

function frameInfo(t, file, index) {
  const out = { file, width: 1920, height: 1080, time: round4(t), frame: Math.round(t * FPS), composition: COMP, method: 'saveFrameToPng' };
  if (index !== undefined) out.index = index;
  return out;
}

function timesFrom(args, defaultCount) {
  if (Array.isArray(args.frames) && args.frames.length) return args.frames.map((f) => snap(f / FPS));
  if (Array.isArray(args.times) && args.times.length) return args.times.map(snap);
  let start = 0;
  let end = DURATION - 1 / FPS;
  if (args.useWorkArea) {
    start = WORK.start;
    end = WORK.start + WORK.duration - 1 / FPS;
  }
  if (args.start !== undefined) start = snap(args.start);
  if (args.end !== undefined) end = snap(args.end);
  const count = args.count !== undefined ? Math.max(1, Math.round(args.count)) : defaultCount !== undefined ? defaultCount : Math.round((end - start) * FPS) + 1;
  if (count === 1) return [snap(start)];
  const out = [];
  for (let i = 0; i < count; i++) out.push(snap(start + ((end - start) * i) / (count - 1)));
  return out;
}

function framesDir(args) {
  return args.outputDir ? String(args.outputDir) : path.join(os.tmpdir(), 'ae-mcp-mock-frames');
}

const rqItem = (index, outputPath, status = 'QUEUED', extra = {}) => ({
  index,
  comp: COMP,
  status,
  render: status === 'QUEUED',
  timeSpanStart: WORK.start,
  timeSpanDuration: WORK.duration,
  elapsedSeconds: status === 'DONE' ? 3.2 : null,
  outputModules: [{ index: 1, file: outputPath, template: 'Lossless' }],
  outputPaths: [outputPath],
  ...extra,
});

export const responses = {
  seeFrame: (args) => {
    const t = timeOf(args);
    const frame = Math.round(t * FPS);
    const file = path.join(framesDir(args), `frame-${COMP.id}-${frame}-${Date.now()}.png`);
    writeMockPng(file);
    return frameInfo(t, file);
  },

  seeFrames: (args) => {
    const times = timesFrom(args, 4);
    if (times.length > 25) throw Object.assign(new Error(`${times.length} frames requested, above the cap of 25.`), { mcpCode: 'invalid-argument' });
    const stamp = Date.now();
    const frames = times.map((t, i) => {
      const frame = Math.round(t * FPS);
      const file = path.join(framesDir(args), `frame-${COMP.id}-${frame}-${stamp}-${i}.png`);
      writeMockPng(file, MOCK_FRAME.width, MOCK_FRAME.height, i);
      return frameInfo(t, file, i);
    });
    return { composition: COMP, count: frames.length, width: 1920, height: 1080, frames };
  },

  exportFramePng: (args) => {
    const t = timeOf(args);
    let file = String(args.outputPath);
    if (!/\.png$/i.test(file)) file += '.png';
    writeMockPng(file);
    return frameInfo(t, file);
  },

  exportStillSequence: (args) => {
    if (args.format && args.format !== 'png') throw Object.assign(new Error('Only png is supported.'), { mcpCode: 'invalid-argument' });
    const cap = args.allowLarge ? 100000 : args.maxFrames ?? 300;
    const times = timesFrom(args);
    if (times.length > cap) throw Object.assign(new Error(`${times.length} frames requested, above the cap of ${cap}. Pass allowLarge true.`), { mcpCode: 'invalid-argument' });
    const prefix = String(args.filePrefix ?? COMP.name).replace(/[^A-Za-z0-9_.-]+/g, '_');
    const dir = String(args.outputDir);
    const files = times.map((t, i) => {
      const frame = Math.round(t * FPS);
      const file = path.join(dir, `${prefix}_${String(frame).padStart(5, '0')}.png`);
      writeMockPng(file, MOCK_FRAME.width, MOCK_FRAME.height, i);
      return { index: i, frame, time: round4(t), file };
    });
    return { composition: COMP, outputDir: dir, count: files.length, width: 1920, height: 1080, method: 'saveFrameToPng', files };
  },

  addToRenderQueue: (args) => ({
    ...rqItem(1, String(args.outputPath), args.outputPath ? 'QUEUED' : 'NEEDS_OUTPUT', {
      timeSpanStart: args.start !== undefined ? args.start : args.useWorkArea === false ? 0 : WORK.start,
      timeSpanDuration: args.end !== undefined ? args.end - (args.start ?? 0) : args.useWorkArea === false ? DURATION : WORK.duration,
    }),
    itemIndex: 1,
    outputPath: String(args.outputPath),
    notes: [],
  }),

  listRenderQueue: () => ({ count: 2, rendering: false, items: [rqItem(1, '/mock/out/main.mov'), rqItem(2, '/mock/out/old.mov', 'DONE')] }),

  clearRenderQueue: (args) => ({ removed: args.onlyFinished ? 1 : 2, remaining: args.onlyFinished ? 1 : 0 }),

  render: (args) => {
    const items = [rqItem(1, '/mock/out/main.mov', 'DONE')];
    if (Array.isArray(args.itemIndices) && args.itemIndices.length && !args.itemIndices.includes(1)) items[0] = rqItem(1, '/mock/out/main.mov', 'UNQUEUED');
    const done = items.filter((i) => i.status === 'DONE');
    return { count: items.length, rendering: false, items, elapsedSeconds: 3.2, done: done.length, failed: 0, outputFiles: done.flatMap((i) => i.outputPaths), queuedBefore: 1 };
  },

  listOutputModuleTemplates: () => ({
    composition: COMP,
    outputModuleTemplates: ['Lossless', 'Lossless with Alpha', 'PNG Sequence', 'H.264 - Match Render Settings - 15 Mbps', 'AIFF 48kHz'],
    renderSettingsTemplates: ['Best Settings', 'Current Settings', 'Draft Settings', 'DV Settings', 'Multi-Machine Settings'],
    currentOutputModule: 'Lossless',
  }),

  listRenderSettingsTemplates: () => ({ composition: COMP, renderSettingsTemplates: ['Best Settings', 'Current Settings', 'Draft Settings', 'DV Settings', 'Multi-Machine Settings'] }),
};
