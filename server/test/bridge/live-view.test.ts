import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { liveState, livePaths } from '../../src/tools/live-view.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

/* Smallest valid JPEG header bytes are enough: the tool passes the file through untouched. */
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

function writeLive(opts: { status?: Record<string, unknown>; meta?: Record<string, unknown>; image?: boolean; statusAgeMs?: number }) {
  const p = livePaths(tb.dir);
  fs.mkdirSync(p.dir, { recursive: true });
  if (opts.status) {
    fs.writeFileSync(p.status, JSON.stringify(opts.status));
    if (opts.statusAgeMs) {
      const t = (Date.now() - opts.statusAgeMs) / 1000;
      fs.utimesSync(p.status, t, t);
    }
  }
  if (opts.meta) fs.writeFileSync(p.meta, JSON.stringify(opts.meta));
  if (opts.image) fs.writeFileSync(p.image, FAKE_JPEG);
}

const META = { comp: 'Main', itemId: 3, time: 1.5, frame: 45, fps: 30, width: 960, height: 540, scale: 2, final: true, renderMs: 12, seq: 4 };

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());
beforeEach(() => fs.rmSync(path.join(tb.dir, 'live'), { recursive: true, force: true }));

describe('liveState', () => {
  it('reports missing, off, on and stale from status.json', () => {
    expect(liveState(tb.dir).state).toBe('missing');
    writeLive({ status: { enabled: false } });
    expect(liveState(tb.dir).state).toBe('off');
    writeLive({ status: { enabled: true } });
    expect(liveState(tb.dir).state).toBe('on');
    writeLive({ status: { enabled: true }, statusAgeMs: 60000 });
    expect(liveState(tb.dir).state).toBe('stale');
  });
});

describe('see-live', () => {
  it('explains how to install the plug-in when it is missing', async () => {
    const r = await callTool(client, 'see-live', {});
    expect(r.isError).toBe(true);
    expect(r.json.code).toBe('live-view-missing');
  });

  it('says how to switch it on when it is off', async () => {
    writeLive({ status: { enabled: false } });
    const r = await callTool(client, 'see-live', {});
    expect(r.isError).toBe(true);
    expect(r.json.code).toBe('live-view-off');
  });

  it('returns the JPEG and its description', async () => {
    writeLive({ status: { enabled: true }, meta: META, image: true });
    const r = await callTool(client, 'see-live', {});
    expect(r.isError).toBe(false);
    const img = r.raw.content.find((c) => c.type === 'image');
    expect(img?.mimeType).toBe('image/jpeg');
    expect(Buffer.from(img!.data!, 'base64').equals(FAKE_JPEG)).toBe(true);
    expect(r.json).toMatchObject({ comp: 'Main', frame: 45, final: true, plugin: 'running' });
  });

  it('waits for the full-size picture, then gives up and returns the quick one', async () => {
    writeLive({ status: { enabled: true }, meta: { ...META, scale: 4, final: false }, image: true });
    setTimeout(() => writeLive({ meta: META }), 150);
    const upgraded = await callTool(client, 'see-live', { waitMs: 2000 });
    expect(upgraded.json).toMatchObject({ final: true, scale: 2 });

    writeLive({ meta: { ...META, scale: 4, final: false } });
    const started = Date.now();
    const quick = await callTool(client, 'see-live', { waitMs: 200 });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(quick.json).toMatchObject({ final: false, scale: 4 });
  });

  it('warns when After Effects has not updated the status for a while', async () => {
    writeLive({ status: { enabled: true }, meta: META, image: true, statusAgeMs: 60000 });
    const r = await callTool(client, 'see-live', {});
    expect(String(r.json.plugin)).toMatch(/busy or closed/);
  });
});

describe('live-view-settings', () => {
  it('reads defaults without writing a file', async () => {
    const r = await callTool(client, 'live-view-settings', {});
    expect(r.json.options).toMatchObject({ enabled: true, scale: 2, budgetMs: 400 });
    expect(r.json.plugin).toBe('missing');
    expect(fs.existsSync(livePaths(tb.dir).options)).toBe(false);
  });

  it('writes only the changed keys on top of the current options', async () => {
    await callTool(client, 'live-view-settings', { enabled: false });
    const r = await callTool(client, 'live-view-settings', { scale: 1 });
    expect(r.json.changed).toEqual(['scale']);
    const saved = JSON.parse(fs.readFileSync(livePaths(tb.dir).options, 'utf8'));
    expect(saved).toMatchObject({ enabled: false, scale: 1, maxFps: 4 });
  });

  it('rejects sizes the plug-in cannot draw', async () => {
    const r = await callTool(client, 'live-view-settings', { scale: 3 });
    expect(r.isError).toBe(true);
  });
});
