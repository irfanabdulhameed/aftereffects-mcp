// import-figma end to end against the mock: the plan is sent in one call, shadows and background blur follow as styles and looks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'path';
import { callTool, makeTestBridge, makeTestServer, type TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: any;
const fixture = path.join(__dirname, '..', 'fixtures', 'figma', 'pricing-card.json');

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

describe('import-figma', () => {
  it('builds a saved frame JSON and adds the shadow and the frost after it', async () => {
    const before = tb.mock.state.commandsRun;
    const r = await callTool(client, 'import-figma', { json: fixture, scale: 4 / 3 });
    expect(r.isError, r.text).toBe(false);
    expect(r.json).toMatchObject({ width: 1920, height: 1200, shadowsAdded: 1, layerCount: 16 });
    expect(tb.mock.state.log.slice(before).map((l: { command: string }) => l.command)).toEqual(['buildFigma', 'addLayerStyle', 'applyLook']);
  });

  it('explains what a link needs', async () => {
    const saved = process.env.FIGMA_TOKEN;
    delete process.env.FIGMA_TOKEN;
    const r = await callTool(client, 'import-figma', { url: 'https://www.figma.com/design/AbC/x?node-id=1-2' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/personal access token/);
    if (saved !== undefined) process.env.FIGMA_TOKEN = saved;
  });
});
