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
  expect(res.error !== undefined || res.isError === true).toBe(true);
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

const ANIMATE_TOOLS = ['animate-property', 'add-entrance', 'add-exit', 'typewriter-text', 'word-by-word-reveal', 'press', 'move-along-path', 'play-at-markers', 'add-camera-push'];

describe('animate tools: registration', () => {
  it('registers every tool in the animate group with a template description of 60 to 200 words', () => {
    for (const name of ANIMATE_TOOLS) {
      const entry = catalog.find((c) => c.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.group).toBe('animate');
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

describe('animate-property', () => {
  it('writes two keys per property on the same frames', async () => {
    const r = await callTool(client, 'animate-property', { layer: { name: 'Card' }, properties: [{ property: 'Transform/Position', by: [200, 0] }], startFrame: 30, durationFrames: 20 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ startFrame: 30, endFrame: 50 });
    const props = r.json.properties as Array<{ property: string; from: number[]; to: number[]; keys: Key[] }>;
    expect(props[0].property).toBe('Transform/Position');
    expect(props[0].to).toEqual([1160, 540]);
    expect(props[0].keys.map((k) => k.frame)).toEqual([30, 50]);
    expect(String(r.json.easing)).toContain('landing');
    expect(lastCommand()).toBe('animateProperty');
  });

  it('passes several properties and a custom easing through unchanged', () => {
    const a = bridgeArgs('animate-property', {
      layer: { index: 2 },
      properties: [{ property: 'Transform/Scale', to: [110, 110] }, { property: 'Effects/Fill/Color', to: '#3358F2' }],
      easing: { type: 'bezier', x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
    });
    expect((a.properties as unknown[]).length).toBe(2);
    expect(a.easing).toEqual({ type: 'bezier', x1: 0.16, y1: 1, x2: 0.3, y2: 1 });
  });

  it('rejects entries without to or by, an empty list and a zero duration before sending', async () => {
    await rejectedBeforeSend('animate-property', { layer: { index: 1 }, properties: [{ property: 'Transform/Opacity' }] });
    await rejectedBeforeSend('animate-property', { layer: { index: 1 }, properties: [] });
    await rejectedBeforeSend('animate-property', { layer: { index: 1 }, properties: [{ property: 'Transform/Opacity', to: 0 }], duration: 0 });
    await rejectedBeforeSend('animate-property', { layer: { index: 1 }, properties: [{ property: 'Transform/Opacity', to: 0 }], easing: 'bounce' });
  });
});

describe('add-entrance and add-exit', () => {
  it('add-entrance staggers layers and animates from offsets to the current values', async () => {
    const r = await callTool(client, 'add-entrance', { layers: { names: ['Card 1', 'Card 2', 'Card 3'] }, kind: ['fade', 'rise', 'blur'], startFrame: 12, staggerFrames: 4 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ count: 3, failed: 0, staggerFrames: 4, kinds: ['fade', 'rise', 'blur'] });
    const results = r.json.results as Array<{ status: string; startFrame: number; properties: Array<{ kind: string; property: string; from: unknown; to: unknown; keys: Key[] }> }>;
    expect(results.map((x) => x.startFrame)).toEqual([12, 16, 20]);
    const rise = results[0].properties.find((p) => p.kind === 'rise')!;
    expect(rise.from).toEqual([960, 580]);
    expect(rise.to).toEqual([960, 540]);
    const fade = results[0].properties.find((p) => p.kind === 'fade')!;
    expect([fade.from, fade.to]).toEqual([0, 100]);
    expect(results[0].properties.find((p) => p.kind === 'blur')!.property).toBe('Effects/Transition Blur/Blurriness');
    expect(lastCommand()).toBe('addEntrance');
  });

  it('add-entrance accepts a single kind, a slide direction and the as-given order', async () => {
    const r = await callTool(client, 'add-entrance', { layers: [{ name: 'Panel' }], kind: 'slide', direction: 'up', distance: 120, order: 'as-given' });
    expect(r.isError).toBe(false);
    const props = (r.json.results as Array<{ properties: Array<{ from: number[] }> }>)[0].properties;
    expect(props[0].from).toEqual([960, 660]);
  });

  it('add-exit ends the last layer at the end time and travels away from the layout', async () => {
    const r = await callTool(client, 'add-exit', { layers: { all: true }, kind: ['fade', 'scale'], scale: 95, endFrame: 240, staggerFrames: 2, order: 'bottom-up' });
    expect(r.isError).toBe(false);
    expect(String(r.json.easing)).toContain('exit');
    const results = r.json.results as Array<{ endFrame: number; properties: Array<{ kind: string; from: unknown; to: unknown }> }>;
    expect(results[results.length - 1].endFrame).toBe(240);
    const scale = results[0].properties.find((p) => p.kind === 'scale')!;
    expect(scale.to).toEqual([95, 95, 100]);
    expect(lastCommand()).toBe('addExit');
  });

  it('refuses conflicting kinds, unknown kinds, a bad direction and a negative stagger before sending', async () => {
    await rejectedBeforeSend('add-entrance', { layers: { all: true }, kind: ['rise', 'slide'] });
    await rejectedBeforeSend('add-entrance', { layers: { all: true }, kind: ['scale', 'pop'] });
    await rejectedBeforeSend('add-entrance', { layers: { all: true }, kind: 'bounce' });
    await rejectedBeforeSend('add-entrance', { layers: { all: true }, kind: 'slide', direction: 'diagonal' });
    await rejectedBeforeSend('add-exit', { layers: { all: true }, kind: 'fade', staggerFrames: -1 });
    await rejectedBeforeSend('add-exit', { layers: [], kind: 'fade' });
    await rejectedBeforeSend('add-exit', { layers: { all: true }, kind: 'fade', startFrame: 10, endFrame: 40 });
  });
});

describe('typewriter-text', () => {
  it('keys the Typing selector 0 to 100 linearly and reports the character timing', async () => {
    const r = await callTool(client, 'typewriter-text', { layer: { name: 'Prompt' }, startFrame: 30, charactersPerSecond: 24 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ animator: 'Typewriter', selectorPath: 'Text/Animators/Typewriter/Selectors/Typing', characters: 12, startFrame: 30, endFrame: 45, cursor: null });
    const keys = r.json.keyframes as Key[];
    expect(keys.map((k) => k.value)).toEqual([0, 100]);
    expect(keys[0].outInterpolation).toBe('linear');
    expect(r.json.firstCharacterTime as number).toBeGreaterThan(1);
    expect(r.json.lastCharacterTime as number).toBeLessThan(1.5);
    expect(lastCommand()).toBe('typewriterText');
  });

  it('turns cursor true into default cursor settings and passes cursor objects through', () => {
    expect(bridgeArgs('typewriter-text', { layer: { index: 1 }, cursor: true }).cursor).toEqual({});
    expect('cursor' in bridgeArgs('typewriter-text', { layer: { index: 1 }, cursor: false })).toBe(false);
    const a = bridgeArgs('typewriter-text', { layer: { index: 1 }, cursor: { char: '_', color: '#ff0000', blinkRate: 1.5 } });
    expect(a.cursor).toEqual({ char: '_', color: [1, 0, 0, 1], blinkRate: 1.5 });
  });

  it('returns the cursor layer and its expressions', async () => {
    const r = await callTool(client, 'typewriter-text', { layer: { name: 'Prompt' }, duration: 1.2, cursor: { char: '|', leadIn: 0.5 } });
    expect(r.isError).toBe(false);
    const cursor = r.json.cursor as { layer: { name: string }; char: string; leadIn: number; expressions: Array<{ property: string; error: string }> };
    expect(cursor.layer.name).toBe('Prompt Cursor');
    expect(cursor).toMatchObject({ char: '|', leadIn: 0.5, keepAfterTyping: true });
    expect(cursor.expressions.map((e) => e.property)).toContain('Transform/Opacity');
    expect(cursor.expressions.every((e) => e.error === '')).toBe(true);
    expect(r.json.endFrame).toBe(36);
  });

  it('rejects a two-character cursor, a zero rate and a bad colour before sending', async () => {
    await rejectedBeforeSend('typewriter-text', { layer: { index: 1 }, cursor: { char: '||' } });
    await rejectedBeforeSend('typewriter-text', { layer: { index: 1 }, charactersPerSecond: 0 });
    await rejectedBeforeSend('typewriter-text', { layer: { index: 1 }, cursor: { color: 'not-a-colour' } });
  });
});

describe('word-by-word-reveal', () => {
  it('keys Start 0 to 100 by default and reports the start state', async () => {
    const r = await callTool(client, 'word-by-word-reveal', { layer: { name: 'Paragraph' }, startFrame: 30, secondsPerWord: 0.1, blur: 20, offset: 24 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ basedOn: 'words', drive: 'start', units: 14, startFrame: 30, endFrame: 72 });
    expect(r.json.fromState).toEqual({ opacity: 0, blur: 20, offset: [0, 24], scale: null });
    expect((r.json.keyframes as Key[]).map((k) => k.value)).toEqual([0, 100]);
    expect(String(r.json.keyedProperty)).toMatch(/Start$/);
  });

  it('drive offset keys Offset -100 to 100', async () => {
    const r = await callTool(client, 'word-by-word-reveal', { layer: { index: 3 }, drive: 'offset', basedOn: 'lines', duration: 1, randomize: true, seed: 4, easeLow: 100 });
    expect(r.isError).toBe(false);
    expect((r.json.keyframes as Key[]).map((k) => k.value)).toEqual([-100, 100]);
    expect(String(r.json.keyedProperty)).toMatch(/Offset$/);
  });

  it('rejects an unknown basedOn, out-of-range ease and negative blur before sending', async () => {
    await rejectedBeforeSend('word-by-word-reveal', { layer: { index: 1 }, basedOn: 'characters' });
    await rejectedBeforeSend('word-by-word-reveal', { layer: { index: 1 }, easeHigh: 150 });
    await rejectedBeforeSend('word-by-word-reveal', { layer: { index: 1 }, blur: -2 });
    await rejectedBeforeSend('word-by-word-reveal', { layer: { index: 1 }, drive: 'end' });
  });
});

describe('press', () => {
  it('dips Scale in three keys and returns the click frame', async () => {
    const r = await callTool(client, 'press', { layer: { name: 'Send' }, frame: 90 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ variant: 'dip', scale: 96, startFrame: 90, clickFrame: 93, cursor: null, ripple: null });
    const keys = r.json.keys as Key[];
    expect(keys.length).toBe(3);
    expect(keys[1].value).toEqual([96, 96, 100]);
  });

  it('pop flips in one frame, moves the cursor, flips a colour and adds a ripple', async () => {
    const r = await callTool(client, 'press', {
      layer: { name: 'Chip' },
      frame: 60,
      variant: 'pop',
      cursor: { layer: { name: 'Cursor' } },
      flip: [{ property: 'Contents/Chip/Contents/Fill 1/Color', to: [0.2, 0.345, 0.949, 1] }],
      ripple: { radius: 80, style: 'ring' },
    });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ variant: 'pop', scale: 108, startFrame: 60, clickFrame: 61 });
    expect((r.json.cursor as { scale: number }).scale).toBe(92);
    const flips = r.json.flips as Array<{ keys: Key[] }>;
    expect(flips[0].keys.map((k) => k.outInterpolation)).toEqual(['hold', 'hold']);
    const ripple = r.json.ripple as { radius: number; style: string; keyframes: Array<{ property: string; keys: Key[] }> };
    expect(ripple).toMatchObject({ radius: 80, style: 'ring' });
    expect(ripple.keyframes.map((k) => k.property)).toEqual(['Transform/Scale', 'Transform/Opacity']);
  });

  it('turns ripple true into default ripple settings', () => {
    expect(bridgeArgs('press', { layer: { index: 1 }, time: 1, ripple: true }).ripple).toEqual({});
    expect('ripple' in bridgeArgs('press', { layer: { index: 1 }, time: 1, ripple: false })).toBe(false);
    expect((bridgeArgs('press', { layer: { index: 1 }, time: 1, ripple: { color: 'white' } }).ripple as { color: number[] }).color).toEqual([1, 1, 1, 1]);
  });

  it('rejects an unknown variant, a zero scale, a bad ripple style and a flip without to before sending', async () => {
    await rejectedBeforeSend('press', { layer: { index: 1 }, frame: 10, variant: 'bounce' });
    await rejectedBeforeSend('press', { layer: { index: 1 }, frame: 10, scale: 0 });
    await rejectedBeforeSend('press', { layer: { index: 1 }, frame: 10, ripple: { style: 'square' } });
    await rejectedBeforeSend('press', { layer: { index: 1 }, frame: 10, flip: [{ property: 'Transform/Opacity' }] });
    await rejectedBeforeSend('press', { layer: { index: 1 }, variant: 'dip' });
  });
});

describe('move-along-path', () => {
  it('keys a Progress slider and sets a pointOnPath Position expression', async () => {
    const r = await callTool(client, 'move-along-path', { layer: { name: 'Dot' }, path: { layer: { name: 'Route' } }, durationFrames: 45, orient: true });
    expect(r.isError).toBe(false);
    const slider = r.json.slider as { effect: string; keys: Key[]; expression: string };
    expect(slider.effect).toBe('Progress');
    expect(slider.keys.map((k) => k.value)).toEqual([0, 100]);
    expect(slider.keys.map((k) => k.frame)).toEqual([0, 45]);
    const expressions = r.json.expressions as Array<{ property: string; expression: string }>;
    expect(expressions.map((e) => e.property)).toEqual(['Transform/Position', 'Transform/Rotation']);
    expect(expressions[0].expression).toContain('pointOnPath');
    expect(expressions[1].expression).toContain('tangentOnPath');
    expect(r.json.path).toMatchObject({ kind: 'shape' });
  });

  it('can travel along a mask with a custom range', async () => {
    const r = await callTool(client, 'move-along-path', { layer: { index: 5 }, path: { layer: { name: 'Frame' }, mask: 'Mask 1' }, from: 100, to: 0 });
    expect(r.isError).toBe(false);
    expect(r.json.path).toMatchObject({ kind: 'mask' });
    expect((r.json.slider as { keys: Key[] }).keys.map((k) => k.value)).toEqual([100, 0]);
  });

  it('rejects a missing path layer and a zero duration before sending', async () => {
    await rejectedBeforeSend('move-along-path', { layer: { index: 1 }, path: {} });
    await rejectedBeforeSend('move-along-path', { layer: { index: 1 } });
    await rejectedBeforeSend('move-along-path', { layer: { index: 1 }, path: { layer: { index: 2 } }, durationFrames: 0 });
  });
});

describe('play-at-markers', () => {
  it('adds markers and sets one replay expression per property', async () => {
    const r = await callTool(client, 'play-at-markers', { layer: { name: 'Badge' }, properties: ['Transform/Scale', 'Transform/Rotation'], addMarkers: [{ frame: 30 }, { frame: 75 }, { time: 4 }] });
    expect(r.isError).toBe(false);
    expect(r.json.markerSource).toBe('layer');
    expect((r.json.markersAdded as Array<{ frame: number }>).map((m) => m.frame)).toEqual([30, 75, 120]);
    const props = r.json.properties as Array<{ property: string; expressionState: { expression: string } }>;
    expect(props.length).toBe(2);
    expect(props[0].expressionState.expression).toContain('thisLayer.marker');
    expect(lastCommand()).toBe('playAtMarkers');
  });

  it('reads comp markers or another layer\'s markers', async () => {
    const comp = await callTool(client, 'play-at-markers', { layer: { index: 2 }, properties: ['Transform/Opacity'], markerSource: 'comp', comment: 'hit' });
    expect(comp.json).toMatchObject({ markerSource: 'comp', comment: 'hit' });
    const other = await callTool(client, 'play-at-markers', { layer: { index: 2 }, properties: ['Transform/Opacity'], markerLayer: { name: 'Controls' } });
    expect(other.json.markerLayer).toMatchObject({ name: 'Controls' });
  });

  it('rejects an empty property list, a bad source and markers without a time before sending', async () => {
    await rejectedBeforeSend('play-at-markers', { layer: { index: 1 }, properties: [] });
    await rejectedBeforeSend('play-at-markers', { layer: { index: 1 }, properties: ['Transform/Scale'], markerSource: 'project' });
    await rejectedBeforeSend('play-at-markers', { layer: { index: 1 }, properties: ['Transform/Scale'], addMarkers: [{ comment: 'x' }] });
  });
});

describe('add-camera-push', () => {
  it('parents layers to a null on the pivot and keys a slow linear push', async () => {
    const r = await callTool(client, 'add-camera-push', { pivot: [960, 540], to: 104, duration: 6 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ from: 100, to: 104, startFrame: 0, endFrame: 180, driftKeys: null });
    const keys = r.json.scaleKeys as Key[];
    expect(keys.map((k) => k.value)).toEqual([[100, 100, 100], [104, 104, 100]]);
    expect(keys[0].outInterpolation).toBe('linear');
    expect((r.json.parented as unknown[]).length).toBeGreaterThan(0);
    expect((r.json.skipped as Array<{ reason: string }>)[0].reason).toContain('camera');
  });

  it('adds drift keys when drift is given', async () => {
    const r = await callTool(client, 'add-camera-push', { layers: { names: ['Card'] }, drift: [-12, 0], easing: 'ease-in-out' });
    expect(r.isError).toBe(false);
    expect((r.json.driftKeys as Key[]).map((k) => k.value)).toEqual([[960, 540], [948, 540]]);
  });

  it('rejects a zero scale and a bad pivot before sending', async () => {
    await rejectedBeforeSend('add-camera-push', { to: 0 });
    await rejectedBeforeSend('add-camera-push', { pivot: [960] });
  });
});

describe('smart-animate', () => {
  it('sends both states with the house landing by default and reports what it keyed', async () => {
    const c = client;
    const r = await callTool(c, 'smart-animate', { from: { name: 'Card closed' }, to: { name: 'Card open' }, startTime: 1, duration: 0.6 });
    expect(r.isError, r.text).toBe(false);
    expect(r.json).toMatchObject({ composition: { name: 'Card closed to Card open' }, duplicated: true, propertiesAnimated: 2 });
    const same = await callTool(c, 'smart-animate', { from: { name: 'A' }, to: { name: 'A' } });
    expect(same.isError).toBe(true);
  });
});
