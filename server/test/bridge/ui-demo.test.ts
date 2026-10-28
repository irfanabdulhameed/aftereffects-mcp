import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog, prepareBridgeArgs } from '../../src/tools/registry.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

async function rejectedBeforeSend(name: string, args: Record<string, unknown>): Promise<void> {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true, `${name} ${JSON.stringify(args)}`).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

function lastCommand(): string {
  return tb.mock.state.log[tb.mock.state.log.length - 1].command;
}

function bridgeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const entry = catalog.find((c) => c.name === name);
  if (!entry) throw new Error(`no tool ${name}`);
  return prepareBridgeArgs(entry, args, tb.client);
}

type Key = { time: number; frame: number; value: unknown; easeIn: Array<{ influence: number }>; easeOut: Array<{ influence: number }>; inInterpolation: string; outInterpolation: string };

const UI_TOOLS = ['cursor-journey', 'scroll-in-window', 'focus-on-region', 'device-frame', 'highlight-region', 'add-toast'];

describe('ui-demo tools: registration', () => {
  it('registers every tool in the ui-demo group with a template description of 60 to 200 words', () => {
    for (const name of UI_TOOLS) {
      const entry = catalog.find((c) => c.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.group).toBe('ui-demo');
      expect(entry!.mutating).toBe(true);
      const words = entry!.description.split(/\s+/).length;
      expect(words, name).toBeGreaterThanOrEqual(60);
      expect(words, name).toBeLessThanOrEqual(200);
      const labels = ['Use when:', 'Do not use for:', 'Inputs:', 'Returns:', 'Notes:', 'Example:'].map((l) => entry!.description.indexOf(l));
      expect(labels.every((i) => i > 0), name).toBe(true);
      expect([...labels].sort((a, b) => a - b), name).toEqual(labels);
      expect(entry!.description, name).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe('cursor-journey', () => {
  it('writes one key per waypoint plus a departure key where the cursor holds, and reports the clicks', async () => {
    const r = await callTool(client, 'cursor-journey', {
      waypoints: [
        { to: [240, 980], at: 0.5 },
        { to: { layer: { name: 'Send' }, anchor: 'center' }, at: 1.4, click: true },
        { to: { layer: { name: 'Email' }, anchor: [24, 18], offset: [0, 4] }, frame: 150, click: true, pressTarget: false },
        { to: [1500, 300], at: 3.4 },
      ],
      arc: 0.1,
      clickRing: true,
    });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('cursorJourney');
    expect(r.json.created).toBe(true);
    const keys = r.json.keys as Key[];
    expect(keys.length).toBe(6);
    expect(keys.filter((k) => k.outInterpolation === 'hold').length).toBe(2);
    expect(keys[1].easeIn[0].influence).toBe(100);
    const clicks = r.json.clicks as Array<{ pressed: unknown; clickFrame: number; targetKeys: Key[] | null; cursorKeys: Key[]; ring: unknown }>;
    expect(clicks.length).toBe(2);
    expect(clicks[0].pressed).toMatchObject({ name: 'Send' });
    expect(clicks[0].targetKeys!.length).toBe(3);
    expect(clicks[0].clickFrame).toBe(90);
    expect(clicks[1].pressed).toBeNull();
    expect(clicks[1].cursorKeys.length).toBe(3);
    expect(clicks[0].ring).not.toBeNull();
    expect(r.json.arcsSet).toBe(3);
  });

  it('turns clickRing true into default ring settings and normalises colours', () => {
    const a = bridgeArgs('cursor-journey', { waypoints: [{ to: [0, 0], at: 0 }], clickRing: true, cursorStyle: { fillColor: '#ffffff', outlineColor: 'black' } });
    expect(a.clickRing).toEqual({});
    expect((a.cursorStyle as { outlineColor: number[] }).outlineColor).toEqual([0, 0, 0, 1]);
    const b = bridgeArgs('cursor-journey', { waypoints: [{ to: [0, 0], at: 0 }], clickRing: false });
    expect(b.clickRing).toBeUndefined();
    const c = bridgeArgs('cursor-journey', { waypoints: [{ to: [0, 0], at: 0 }], clickRing: { radius: 48, color: '#2F6BFF' } });
    expect((c.clickRing as { color: number[] }).color.length).toBe(4);
  });

  it('passes a pop with state flips through to the press', async () => {
    const r = await callTool(client, 'cursor-journey', {
      cursor: { name: 'Cursor' },
      waypoints: [{ to: [400, 400], at: 5 }, { to: { layer: { name: 'Toggle' } }, at: 6, click: true, variant: 'pop', flip: [{ property: 'Contents/Track/Fill 1/Color', to: '#2F6BFF' }] }],
    });
    expect(r.isError).toBe(false);
    expect(r.json.created).toBe(false);
    const clicks = r.json.clicks as Array<{ variant: string; targetKeys: Key[]; clickFrame: number; startFrame: number }>;
    expect(clicks[0].variant).toBe('pop');
    expect(clicks[0].clickFrame - clicks[0].startFrame).toBe(1);
  });

  it('rejects waypoints without a time, times that go back, bad anchors and wrong shadow settings before sending', async () => {
    await rejectedBeforeSend('cursor-journey', { waypoints: [{ to: [0, 0] }] });
    await rejectedBeforeSend('cursor-journey', { waypoints: [] });
    await rejectedBeforeSend('cursor-journey', { waypoints: [{ to: [0, 0], at: 2 }, { to: [10, 10], at: 1 }] });
    await rejectedBeforeSend('cursor-journey', { waypoints: [{ to: [0, 0], at: 1, hold: 1 }, { to: [10, 10], at: 1.5 }] });
    await rejectedBeforeSend('cursor-journey', { waypoints: [{ to: { layer: { name: 'Send' }, anchor: 'middle' }, at: 1 }] });
    await rejectedBeforeSend('cursor-journey', { waypoints: [{ to: [0, 0], at: 1 }], arc: 0.9 });
    await rejectedBeforeSend('cursor-journey', { waypoints: [{ to: [0, 0], at: 1 }], cursorStyle: { shadow: { technique: 'precise' } } });
    await rejectedBeforeSend('cursor-journey', { waypoints: [{ to: [0, 0], at: 1, variant: 'bounce' }] });
  });
});

describe('scroll-in-window', () => {
  it('precomposes the screen into a window and keys the Scroll slider once per stop', async () => {
    const r = await callTool(client, 'scroll-in-window', {
      layer: { name: 'Page' },
      window: { x: 360, y: 140, width: 1200, height: 800 },
      cornerRadius: 16,
      stops: [{ to: 'top', at: 0.5 }, { to: 1200, at: 1.5, hold: 0.5 }, { fraction: 1, at: 3 }],
    });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('scrollInWindow');
    expect(r.json.method).toBe('precomp');
    expect(r.json.window).toMatchObject({ width: 1200, height: 800 });
    const slider = r.json.slider as { propertyPath: string; keys: Key[] };
    expect(slider.propertyPath).toBe('Effects/Scroll/Slider');
    expect(slider.keys.map((k) => k.value)).toEqual([0, 1200, 1200, 3040]);
    expect(String((r.json.positionExpression as { expression: string }).expression)).toContain('Scroll in window');
  });

  it('uses the glide ease with momentum', async () => {
    const r = await callTool(client, 'scroll-in-window', { layer: { name: 'Page' }, window: { x: 0, y: 0, width: 1200, height: 800 }, momentum: true, stops: [{ to: 0, at: 0 }, { to: 'bottom', at: 2 }] });
    expect(String(r.json.easing)).toContain('glide');
    expect((r.json.slider as { keys: Key[] }).keys[1].easeIn[0].influence).toBe(70);
  });

  it('rejects stops with both to and fraction, a fraction past 1, two windows and stops out of order before sending', async () => {
    await rejectedBeforeSend('scroll-in-window', { layer: { index: 1 }, window: { x: 0, y: 0, width: 100, height: 100 }, stops: [{ to: 10, fraction: 0.5, at: 1 }] });
    await rejectedBeforeSend('scroll-in-window', { layer: { index: 1 }, window: { x: 0, y: 0, width: 100, height: 100 }, stops: [{ fraction: 1.5, at: 1 }] });
    await rejectedBeforeSend('scroll-in-window', { layer: { index: 1 }, window: { x: 0, y: 0, width: 100, height: 100 }, windowLayer: { index: 2 }, stops: [{ to: 0, at: 1 }] });
    await rejectedBeforeSend('scroll-in-window', { layer: { index: 1 }, window: { x: 0, y: 0, width: 100, height: 100 }, stops: [{ to: 0, at: 2 }, { to: 'bottom', at: 1 }] });
    await rejectedBeforeSend('scroll-in-window', { layer: { index: 1 }, window: { x: 0, y: 0, width: 100, height: 100 }, stops: [{ to: 'middle', at: 1 }] });
    await rejectedBeforeSend('scroll-in-window', { layer: { index: 1 }, stops: [] });
  });
});

describe('focus-on-region', () => {
  it('keys the camera null in and back and reports the scale', async () => {
    const r = await callTool(client, 'focus-on-region', { layer: { name: 'Button' }, frame: 60, durationFrames: 48, return: true });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('focusOnRegion');
    expect(r.json.scale).toBeCloseTo(466.6667, 3);
    expect(r.json).toMatchObject({ startFrame: 60, endFrame: 108 });
    const keys = r.json.keys as { scale: Key[] };
    expect(keys.scale.length).toBe(4);
    expect(keys.scale[1].easeIn[0].influence).toBe(100);
    expect((r.json.camera as { created: boolean }).created).toBe(true);
  });

  it('turns return true into default settings and drops return false', () => {
    expect(bridgeArgs('focus-on-region', { layer: { index: 1 }, time: 1, return: true }).return).toEqual({});
    expect('return' in bridgeArgs('focus-on-region', { layer: { index: 1 }, time: 1, return: false })).toBe(false);
    expect(bridgeArgs('focus-on-region', { layer: { index: 1 }, time: 1, return: { hold: 2 } }).return).toEqual({ hold: 2 });
  });

  it('rejects a missing start time and out-of-range fill before sending', async () => {
    await rejectedBeforeSend('focus-on-region', { layer: { index: 1 } });
    await rejectedBeforeSend('focus-on-region', { layer: { index: 1 }, time: 1, fill: 1.5 });
    await rejectedBeforeSend('focus-on-region', { layer: { index: 1 }, time: 1, rect: { x: 0, y: 0, width: 0, height: 10 } });
  });
});

describe('device-frame', () => {
  it('frames a screen as a browser with a URL and reports the parts', async () => {
    const r = await callTool(client, 'device-frame', { layer: { name: 'Screen' }, device: 'browser', url: 'app.example.com' });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('deviceFrame');
    expect(r.json.device).toBe('browser');
    expect(r.json.urlLayer).not.toBeNull();
    expect(r.json.mask).toMatchObject({ name: 'Device Screen' });
    expect((r.json.sizes as { barHeight: number }).barHeight).toBe(50);
  });

  it('makes a component when asked and keeps a theme colour', async () => {
    const r = await callTool(client, 'device-frame', { layer: { name: 'App' }, device: 'phone', theme: 'dark', color: '#202124', component: { name: 'Phone' } });
    expect(r.isError).toBe(false);
    expect((r.json.component as { added: Array<{ label: string }> }).added.map((a) => a.label)).toEqual(['Theme Colour']);
    const a = bridgeArgs('device-frame', { layer: { index: 1 }, device: 'phone', color: '#202124', component: false });
    expect(a.component).toBeUndefined();
    expect((a.color as number[]).length).toBe(4);
  });

  it('rejects options that do not fit the device and unknown devices before sending', async () => {
    await rejectedBeforeSend('device-frame', { layer: { index: 1 }, device: 'phone', url: 'example.com' });
    await rejectedBeforeSend('device-frame', { layer: { index: 1 }, device: 'laptop', dots: 'color' });
    await rejectedBeforeSend('device-frame', { layer: { index: 1 }, device: 'browser', notch: false });
    await rejectedBeforeSend('device-frame', { layer: { index: 1 }, device: 'watch' });
    await rejectedBeforeSend('device-frame', { layer: { index: 1 }, device: 'browser', shadow: { technique: 'softer' } });
  });
});

describe('highlight-region', () => {
  it('builds the dim, outline, line and label with staggered reveals and a hide', async () => {
    const r = await callTool(client, 'highlight-region', { layer: { name: 'Button' }, frame: 60, label: 'Send it', hideFrame: 200 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('highlightRegion');
    const layers = r.json.layers as Record<string, { name: string }>;
    expect(Object.keys(layers).sort()).toEqual(['dim', 'label', 'labelPill', 'line', 'outline']);
    const keys = r.json.keys as Array<{ property: string; keys: Key[] }>;
    const dim = keys.find((k) => k.property === 'Transform/Opacity')!;
    expect(dim.keys.length).toBe(4);
    expect(dim.keys[0].frame).toBe(60);
    expect(r.json.follow).toBe(true);
    expect((r.json.label as { side: string }).side).toBe('top');
  });

  it('passes dim and outline settings with normalised colours', () => {
    const a = bridgeArgs('highlight-region', { layer: { index: 1 }, time: 1, dim: { opacity: 40 }, outline: { color: '#ff0000', width: 2 }, label: { text: 'New', side: 'right' } });
    expect((a.outline as { color: number[] }).color).toEqual([1, 0, 0, 1]);
    expect(a.dim).toEqual({ opacity: 40 });
  });

  it('rejects a missing reveal time, nothing to draw and a bad label side before sending', async () => {
    await rejectedBeforeSend('highlight-region', { layer: { index: 1 } });
    await rejectedBeforeSend('highlight-region', { layer: { index: 1 }, time: 1, dim: false, outline: false });
    await rejectedBeforeSend('highlight-region', { layer: { index: 1 }, time: 1, label: { text: 'x', side: 'middle' } });
    await rejectedBeforeSend('highlight-region', { layer: { index: 1 }, time: 1, label: { text: 'x', shadow: { technique: 'precise' } } });
  });
});

describe('add-toast', () => {
  it('slides a toast in and out with two keys each way', async () => {
    const r = await callTool(client, 'add-toast', { title: 'Export finished', body: 'Your video is ready.', frame: 120 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('addToast');
    const pos = (r.json.keys as Array<{ keys: Key[] }>)[0].keys;
    expect(pos.length).toBe(4);
    expect(pos[1].easeIn[0].influence).toBe(100);
    expect((r.json.from as number[])[0]).toBeGreaterThan(1920);
  });

  it('stays on screen with exit false', async () => {
    const r = await callTool(client, 'add-toast', { title: 'Saved', time: 1, exit: false, position: 'bottom' });
    expect((r.json.keys as Array<{ keys: Key[] }>)[0].keys.length).toBe(2);
    expect(r.json.endTime).toBeNull();
  });

  it('rejects a missing start time and an empty title before sending', async () => {
    await rejectedBeforeSend('add-toast', { title: 'Saved' });
    await rejectedBeforeSend('add-toast', { title: '', time: 1 });
    await rejectedBeforeSend('add-toast', { title: 'Saved', time: 1, position: 'middle' });
  });
});
