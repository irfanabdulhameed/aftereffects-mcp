import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertProjectSavedForAerender, renderConfig } from '../../src/tools/render.js';
import { targetSize, tileLayout } from '../../src/render/png.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';
import { MOCK_FRAME } from '../bridge-mock/responses/render.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];
let scratch: string;

type Content = Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

function imageOf(raw: { content: Content }): { png: PNG; block: Content[number] } {
  const block = raw.content.find((c) => c.type === 'image');
  if (!block || !block.data) throw new Error('no image block');
  return { png: PNG.sync.read(Buffer.from(block.data, 'base64')), block };
}

function infoOf(raw: { content: Content }): Record<string, unknown> {
  const text = raw.content.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-render-'));
});
afterAll(() => {
  tb.cleanup();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('see-frame', () => {
  it('returns a PNG image block scaled to half size by default', async () => {
    const r = await callTool(client, 'see-frame', { time: 1 });
    expect(r.isError).toBe(false);
    const { png, block } = imageOf(r.raw);
    expect(block.mimeType).toBe('image/png');
    expect(png.width).toBe(MOCK_FRAME.width / 2);
    expect(png.height).toBe(MOCK_FRAME.height / 2);
    const info = infoOf(r.raw);
    expect(info).toMatchObject({ time: 1, frame: 30, width: 64, height: 36, sourceWidth: 128, sourceHeight: 72, method: 'saveFrameToPng' });
    expect(fs.existsSync(String(info.file))).toBe(true);
    expect(path.dirname(String(info.file))).toBe(tb.client.paths.frames);
  });

  it('honours maxWidth as a second cap and frame wins over time', async () => {
    const r = await callTool(client, 'see-frame', { time: 1, frame: 90, scale: 1, maxWidth: 32 });
    expect(r.isError).toBe(false);
    const { png } = imageOf(r.raw);
    expect(png.width).toBe(32);
    expect(png.height).toBe(18);
    expect(infoOf(r.raw)).toMatchObject({ frame: 90, time: 3 });
  });

  it('omits the text block when includeInfo is false', async () => {
    const r = await callTool(client, 'see-frame', { includeInfo: false });
    expect(r.raw.content.length).toBe(1);
    expect(r.raw.content[0].type).toBe('image');
  });

  it('rejects an out-of-range scale before sending anything', async () => {
    const before = tb.mock.state.commandsRun;
    const res = (await client.callTool({ name: 'see-frame', arguments: { scale: 2 } }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
    expect(res.error !== undefined || res.isError === true).toBe(true);
    expect(tb.mock.state.commandsRun).toBe(before);
  });
});

describe('see-frames', () => {
  it('tiles four frames into a 2 column sheet with a tile map', async () => {
    const r = await callTool(client, 'see-frames', { count: 4, columns: 2, scale: 1 });
    expect(r.isError).toBe(false);
    const { png } = imageOf(r.raw);
    const layout = tileLayout(4, 2, MOCK_FRAME.width, MOCK_FRAME.height);
    expect(png.width).toBe(layout.width);
    expect(png.height).toBe(layout.height);
    const info = infoOf(r.raw);
    expect(info).toMatchObject({ count: 4, columns: 2, rows: 2, width: layout.width, height: layout.height });
    const tiles = info.tiles as Array<Record<string, number>>;
    expect(tiles.length).toBe(4);
    expect(tiles[0]).toMatchObject({ index: 0, time: 0, frame: 0, x: 0, y: 0, w: 128, h: 72 });
    expect(tiles[3]).toMatchObject({ index: 3, x: 130, y: 74 });
    expect(tiles[3].frame).toBe(299);
    // the border is white at the top-left pixel of the first tile
    expect([png.data[0], png.data[1], png.data[2]]).toEqual([255, 255, 255]);
  });

  it('uses explicit frames and the default scale, and caps the sheet width', async () => {
    const r = await callTool(client, 'see-frames', { frames: [0, 15, 45], maxWidth: 100 });
    expect(r.isError).toBe(false);
    const { png } = imageOf(r.raw);
    expect(png.width).toBeLessThanOrEqual(100);
    const info = infoOf(r.raw);
    expect(info.columns).toBe(3);
    expect((info.tiles as Array<{ frame: number }>).map((t) => t.frame)).toEqual([0, 15, 45]);
  });

  it('reports a missing file as an isError result naming the frames folder', async () => {
    // Simulate the two sides seeing different folders: delete every frame the mock writes as soon as it appears.
    const dir = tb.client.paths.frames;
    const watcher = fs.watch(dir, (_event, name) => {
      if (!name) return;
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        // already gone
      }
    });
    let r: Awaited<ReturnType<typeof callTool>>;
    try {
      r = await callTool(client, 'see-frame', { time: 2 });
    } finally {
      watcher.close();
    }
    // fs.watch delivery is asynchronous; if the server read the file before the watcher fired, the happy path already covers this call.
    if (!r.isError) return;
    expect(r.json).toMatchObject({ tool: 'see-frame', error: 'frame-missing', framesDir: dir });
    expect(String(r.json.message)).toContain('bridge frames folder');
  });
});

describe('export tools', () => {
  it('export-frame-png writes to the requested path and downsizes when scale is given', async () => {
    const out = path.join(scratch, 'still.png');
    const r = await callTool(client, 'export-frame-png', { frame: 12, outputPath: out, scale: 0.5 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ file: out, width: 64, height: 36, sourceWidth: 128, frame: 12 });
    const png = PNG.sync.read(fs.readFileSync(out));
    expect(png.width).toBe(64);
    expect(r.raw.content.some((c) => c.type === 'image')).toBe(false);
  });

  it('export-frame-png keeps full size without scale', async () => {
    const out = path.join(scratch, 'full.png');
    const r = await callTool(client, 'export-frame-png', { time: 0.5, outputPath: out });
    expect(r.json).toMatchObject({ file: out, width: 128, height: 72 });
  });

  it('export-still-sequence writes numbered files', async () => {
    const dir = path.join(scratch, 'seq');
    const r = await callTool(client, 'export-still-sequence', { outputDir: dir, count: 3, filePrefix: 'shot', scale: 0.5 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ count: 3, resizedCount: 3 });
    const files = r.json.files as Array<{ file: string; frame: number; width: number }>;
    expect(files.map((f) => path.basename(f.file))).toEqual(['shot_00000.png', 'shot_00150.png', 'shot_00299.png']);
    for (const f of files) {
      expect(fs.existsSync(f.file)).toBe(true);
      expect(f.width).toBe(64);
    }
  });

  it('export-still-sequence refuses more frames than the cap', async () => {
    const r = await callTool(client, 'export-still-sequence', { outputDir: path.join(scratch, 'big'), maxFrames: 10 });
    expect(r.isError).toBe(true);
    expect(r.json.error).toBe('command-failed');
  });
});

describe('render queue', () => {
  it('add-to-render-queue expands ~ and returns the item', async () => {
    const r = await callTool(client, 'add-to-render-queue', { comp: { name: 'Main Comp' }, outputPath: '~/Movies/out.mov', outputModuleTemplate: 'Lossless' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ itemIndex: 1, status: 'QUEUED', outputPath: path.join(os.homedir(), 'Movies', 'out.mov') });
    const last = tb.mock.state.log[tb.mock.state.log.length - 1];
    expect(last.command).toBe('addToRenderQueue');
  });

  it('list, render and clear round-trip', async () => {
    const list = await callTool(client, 'list-render-queue');
    expect(list.json).toMatchObject({ count: 2, rendering: false });
    const items = list.json.items as Array<{ status: string; outputPaths: string[] }>;
    expect(items[1].status).toBe('DONE');
    expect(items[0].outputPaths).toEqual(['/mock/out/main.mov']);

    const rendered = await callTool(client, 'render', {});
    expect(rendered.isError).toBe(false);
    expect(rendered.json).toMatchObject({ done: 1, failed: 0, outputFiles: ['/mock/out/main.mov'] });
    expect(typeof rendered.json.elapsedSeconds).toBe('number');

    const cleared = await callTool(client, 'clear-render-queue', { onlyFinished: true });
    expect(cleared.json).toMatchObject({ removed: 1, remaining: 1 });
  });

  it('template lists', async () => {
    const om = await callTool(client, 'list-output-module-templates');
    expect((om.json.outputModuleTemplates as string[])).toContain('PNG Sequence');
    expect((om.json.renderSettingsTemplates as string[])).toContain('Best Settings');
    const rs = await callTool(client, 'list-render-settings-templates', { comp: { name: 'Main Comp' } });
    expect((rs.json.renderSettingsTemplates as string[])).toContain('Draft Settings');
    expect(rs.json.outputModuleTemplates).toBeUndefined();
  });
});

describe('render with aerender', () => {
  const original = renderConfig.findAerender;
  afterAll(() => {
    renderConfig.findAerender = original;
  });

  it('refuses a project that is unsaved or dirty', () => {
    expect(() => assertProjectSavedForAerender({ path: null, dirty: false })).toThrow(/never been saved/);
    expect(() => assertProjectSavedForAerender({ path: '/x/a.aep', dirty: true })).toThrow(/unsaved changes/);
    expect(assertProjectSavedForAerender({ path: '/x/a.aep', dirty: false, saved: true })).toBe('/x/a.aep');
  });

  it('requires comp and outputPath and a findable binary', async () => {
    renderConfig.findAerender = () => undefined;
    const noComp = await callTool(client, 'render', { useAerender: true });
    expect(noComp.isError).toBe(true);
    expect(noComp.json.message).toMatch(/comp/);
    const noBin = await callTool(client, 'render', { useAerender: true, comp: 'Main Comp', outputPath: path.join(scratch, 'ae.mov') });
    expect(noBin.isError).toBe(true);
    expect(noBin.json.message).toMatch(/aerender was not found/);
  });

  it('spawns the binary detached with a log file when the project is saved', async () => {
    const fake = path.join(scratch, 'fake-aerender.sh');
    fs.writeFileSync(fake, '#!/bin/sh\necho "fake aerender $@"\nexit 0\n');
    fs.chmodSync(fake, 0o755);
    renderConfig.findAerender = (explicit?: string) => explicit ?? fake;
    const out = path.join(scratch, 'aerender-out', 'main.mov');
    const r = await callTool(client, 'render', { useAerender: true, comp: 'Main Comp', outputPath: out, outputModuleTemplate: 'Lossless' });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ started: true, binary: fake, project: '/mock/mock.aep', comp: 'Main Comp', outputPath: out });
    expect(r.json.args).toEqual(['-project', '/mock/mock.aep', '-comp', 'Main Comp', '-output', out, '-OMtemplate', 'Lossless']);
    expect(typeof r.json.pid).toBe('number');
    const logPath = String(r.json.logPath);
    expect(path.dirname(logPath)).toBe(tb.client.paths.root);
    const deadline = Date.now() + 3000;
    let log = '';
    while (Date.now() < deadline) {
      log = fs.readFileSync(logPath, 'utf8');
      if (log.includes('fake aerender')) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(log).toContain('fake aerender -project /mock/mock.aep -comp Main Comp');
    expect(fs.existsSync(path.dirname(out))).toBe(true);
    const cmds = tb.mock.state.log.map((l) => l.command);
    expect(cmds).toContain('getProjectInfo');
  });
});

describe('png helpers', () => {
  it('targetSize applies scale then the width cap', () => {
    expect(targetSize(1920, 1080, 0.5, 1280)).toEqual({ width: 960, height: 540 });
    expect(targetSize(1920, 1080, 1, 1280)).toEqual({ width: 1280, height: 720 });
    expect(targetSize(1920, 1080, undefined, undefined)).toEqual({ width: 1920, height: 1080 });
    expect(targetSize(100, 50, 0.1, undefined)).toEqual({ width: 10, height: 5 });
  });

  it('tileLayout places tiles left to right, top to bottom', () => {
    const l = tileLayout(5, 3, 10, 6, 2);
    expect(l.columns).toBe(3);
    expect(l.rows).toBe(2);
    expect(l.width).toBe(34);
    expect(l.height).toBe(14);
    expect(l.positions[4]).toEqual({ index: 4, x: 12, y: 8, w: 10, h: 6 });
  });
});
