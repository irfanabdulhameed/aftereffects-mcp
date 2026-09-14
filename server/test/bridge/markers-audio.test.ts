import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

async function rejectedBeforeSend(name: string, args: Record<string, unknown>) {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

describe('markers-audio: audio-to-keyframes and markers-from-beats', () => {
  it('audio-to-keyframes returns the amplitude null, slider paths and expression snippets', async () => {
    const r = await callTool(client, 'audio-to-keyframes', { layer: { name: 'Music' } });
    expect(r.isError).toBe(false);
    expect(r.json.sourceLayer).toMatchObject({ name: 'Music' });
    expect((r.json.layer as { name: string; type: string }).name).toBe('Audio Amplitude');
    const sliders = r.json.sliders as Array<{ channel: string; path: string; numKeys: number }>;
    expect(sliders.map((s) => s.channel)).toEqual(['Left Channel', 'Right Channel', 'Both Channels']);
    expect(sliders[2].path).toBe('Effects/Both Channels/Slider');
    expect(r.json.keyCounts).toMatchObject({ 'Both Channels': 300 });
    expect((r.json.expressions as { both: string }).both).toBe('thisComp.layer("Audio Amplitude").effect("Both Channels")("Slider")');
    expect(tb.mock.state.log[tb.mock.state.log.length - 1].command).toBe('audioToKeyframes');
  });

  it('audio-to-keyframes renames the null and rejects bad input before sending', async () => {
    const r = await callTool(client, 'audio-to-keyframes', { layer: { index: 2 }, name: 'AMP', useLayerRange: true });
    expect((r.json.expressions as { both: string }).both).toContain('thisComp.layer("AMP")');
    await rejectedBeforeSend('audio-to-keyframes', { layer: { index: 0 } });
    await rejectedBeforeSend('audio-to-keyframes', { name: 5 });
  });

  it('markers-from-beats builds a bpm grid on the comp', async () => {
    const r = await callTool(client, 'markers-from-beats', { bpm: 120, offset: 0.5, beatsPerBar: 4, end: 4, clearExisting: true });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ mode: 'bpm', bpm: 120, beatInterval: 0.5, offset: 0.5, layer: null, cleared: true, errorCount: 0 });
    expect(r.json.count).toBe(8);
    expect(r.json.firstTime).toBeCloseTo(0.5, 3);
    expect(r.json.lastTime).toBeCloseTo(4, 3);
    expect(r.json.firstFrame).toBe(15);
  });

  it('markers-from-beats places peak markers on a layer and applies the offset', async () => {
    const r = await callTool(client, 'markers-from-beats', { target: 'layer', layer: { name: 'Music' }, peakTimes: [0.2, 1.1, 2.4], offset: 0.1 });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ mode: 'peaks', bpm: null, count: 3, layer: { name: 'Music' } });
    expect(r.json.firstTime).toBeCloseTo(0.3, 3);
    expect(r.json.lastTime).toBeCloseTo(2.5, 3);
  });

  it('markers-from-beats rejects invalid input before sending and errors without bpm or peaks', async () => {
    await rejectedBeforeSend('markers-from-beats', { bpm: -10 });
    await rejectedBeforeSend('markers-from-beats', { bpm: 120, beatsPerBar: 0 });
    await rejectedBeforeSend('markers-from-beats', { peakTimes: 'nope' });
    const neither = await callTool(client, 'markers-from-beats', { offset: 1 });
    expect(neither.isError).toBe(true);
    expect(neither.json).toMatchObject({ tool: 'markers-from-beats', error: 'command-failed' });
  });
});
