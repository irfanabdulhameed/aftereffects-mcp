// Looks and backgrounds: arguments reach After Effects, soft-shadow goes through add-layer-style, bad inputs are refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, makeTestBridge, makeTestServer, type TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: any;

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

describe('apply-look', () => {
  it('applies glow on a new adjustment layer', async () => {
    const r = await callTool(client, 'apply-look', { look: 'glow' });
    expect(r.isError, r.text).toBe(false);
    expect(tb.mock.state.lastCommand).toBe('applyLook');
    expect((r.json as any).effects).toEqual(['Glow Tight', 'Glow Wide']);
  });

  it('turns soft-shadow into a 6 % drop shadow layer style and needs a layer', async () => {
    const r = await callTool(client, 'apply-look', { look: 'soft-shadow', layer: { name: 'Card' } });
    expect(r.isError, r.text).toBe(false);
    expect(tb.mock.state.lastCommand).toBe('addLayerStyle');
    expect(tb.mock.state.lastArgs).toMatchObject({ kind: 'drop-shadow', settings: { opacity: 6, distance: 12, size: 40, angle: 90 } });
    const bad = await callTool(client, 'apply-look', { look: 'soft-shadow' });
    expect(bad.isError).toBe(true);
  });

  it('refuses an unknown look', async () => {
    const bad = await callTool(client, 'apply-look', { look: 'sparkle' });
    expect(bad.isError).toBe(true);
  });
});

describe('create-background', () => {
  it('passes style, colours and loop through', async () => {
    const r = await callTool(client, 'create-background', { style: 'aurora', colors: ['#08090F', '#3358F2'], loop: 8 });
    expect(r.isError, r.text).toBe(false);
    expect(tb.mock.state.lastArgs).toMatchObject({ style: 'aurora', loop: 8 });
    expect((r.json as any).background.name).toBe('Background · aurora');
  });
});
