import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPRESSION_PRESETS } from '../../src/tools/expressions.js';
import { callTool, makeTestBridge, makeTestServer, TestBridge } from '../helpers.js';

let tb: TestBridge;
let client: Awaited<ReturnType<typeof makeTestServer>>['client'];

beforeAll(async () => {
  tb = makeTestBridge();
  ({ client } = await makeTestServer());
});
afterAll(() => tb.cleanup());

const layer = { name: 'Title' };
const lastCommand = () => tb.mock.state.log[tb.mock.state.log.length - 1].command;

async function expectRejectedBeforeSend(name: string, args: Record<string, unknown>) {
  const before = tb.mock.state.commandsRun;
  const res = (await client.callTool({ name, arguments: args }).catch((e: Error) => ({ error: e.message }))) as { error?: string; isError?: boolean };
  expect(res.error !== undefined || res.isError === true).toBe(true);
  expect(tb.mock.state.commandsRun).toBe(before);
}

describe('expression tools', () => {
  it('get-expression-errors defaults to the comp scope and lists errors', async () => {
    const r = await callTool(client, 'get-expression-errors', {});
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('getExpressionErrors');
    expect(r.json).toMatchObject({ scope: 'comp', errorCount: 1, layersScanned: 3 });
    const errors = r.json.errors as Array<Record<string, unknown>>;
    expect(errors[0]).toMatchObject({ comp: { id: 1 }, layer: { name: 'Card' }, path: 'Transform/Position' });
    expect(typeof errors[0].error).toBe('string');
    expect(typeof errors[0].expression).toBe('string');
    const project = await callTool(client, 'get-expression-errors', { scope: 'project' });
    expect(project.json.scope).toBe('project');
    const one = await callTool(client, 'get-expression-errors', { scope: 'layer', layer });
    expect(one.json.layersScanned).toBe(1);
    await expectRejectedBeforeSend('get-expression-errors', { scope: 'everything' });
  });

  it('list-expression-presets returns the library with params', async () => {
    const r = await callTool(client, 'list-expression-presets', {});
    expect(r.isError).toBe(false);
    const presets = r.json.presets as Array<{ name: string; description: string; params: Array<{ name: string; defaultValue: unknown }>; suits: string[] }>;
    expect(r.json.count).toBe(presets.length);
    const names = presets.map((p) => p.name).sort();
    expect(names).toEqual([...EXPRESSION_PRESETS].sort());
    const wiggle = presets.find((p) => p.name === 'wiggle');
    expect(wiggle?.params.find((p) => p.name === 'frequency')?.defaultValue).toBe(2);
  });

  it('apply-expression-preset returns the expression state and generated code', async () => {
    const r = await callTool(client, 'apply-expression-preset', { layer, property: 'Transform/Scale', preset: 'overshoot', params: { amplitude: 0.1 } });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('applyExpressionPreset');
    expect(r.json).toMatchObject({ preset: 'overshoot', params: { amplitude: 0.1 }, property: { path: 'Transform/Scale' } });
    expect(r.json.expressionState).toMatchObject({ hasExpression: true, enabled: true, error: '' });
    expect(String(r.json.code)).toContain('// MCP preset: overshoot');
  });

  it('apply-expression-preset accepts every preset name in the schema', async () => {
    for (const preset of EXPRESSION_PRESETS) {
      const params = preset === 'follow-layer-with-delay' ? { layerName: 'Leader' } : {};
      const r = await callTool(client, 'apply-expression-preset', { layer, property: 'Transform/Position', preset, params });
      expect(r.isError, preset).toBe(false);
      expect(r.json.preset).toBe(preset);
    }
  });

  it('apply-expression-preset rejects unknown preset names before sending', async () => {
    await expectRejectedBeforeSend('apply-expression-preset', { layer, property: 'Transform/Position', preset: 'jiggle' });
  });

  it('apply-expression-preset surfaces bridge validation of required params', async () => {
    const r = await callTool(client, 'apply-expression-preset', { layer, property: 'Transform/Position', preset: 'follow-layer-with-delay' });
    expect(r.isError).toBe(true);
    expect(r.json.message).toContain('layerName');
  });

  it('add-expression-control returns the path and expression snippet', async () => {
    const r = await callTool(client, 'add-expression-control', { layer, type: 'slider', name: 'Speed', value: 50 });
    expect(r.isError).toBe(false);
    expect(lastCommand()).toBe('addExpressionControl');
    expect(r.json).toMatchObject({
      control: { type: 'slider', name: 'Speed', matchName: 'ADBE Slider Control' },
      propertyPath: 'Effects/Speed/Slider',
      expression: 'effect("Speed")("Slider")',
      value: 50,
    });
    expect(r.json.effect).toMatchObject({ name: 'Speed', matchName: 'ADBE Slider Control' });
    const dd = await callTool(client, 'add-expression-control', { layer, type: 'dropdown', name: 'Mode', items: ['Fast', 'Slow'] });
    expect(dd.isError).toBe(false);
    expect(dd.json.propertyPath).toBe('Effects/Mode/Menu');
    const noName = await callTool(client, 'add-expression-control', { layer, type: 'checkbox' });
    expect(noName.json.propertyPath).toBe('Effects/Checkbox Control/Checkbox');
  });

  it('add-expression-control rejects unknown types and empty item lists before sending', async () => {
    await expectRejectedBeforeSend('add-expression-control', { layer, type: 'knob' });
    await expectRejectedBeforeSend('add-expression-control', { layer, type: 'dropdown', items: [] });
  });

  it('the existing expression tools still answer', async () => {
    const r = await callTool(client, 'set-expression', { layer, property: 'Transform/Position', expression: 'wiggle(2, 10)' });
    expect(r.isError).toBe(false);
    expect(r.json.expressionState).toMatchObject({ hasExpression: true, expression: 'wiggle(2, 10)' });
  });
});

describe('expression preset library', () => {
  it('every preset in the TypeScript enum is defined in expressions.jsx', () => {
    const file = path.resolve(__dirname, '..', '..', 'src', 'scripts', 'commands', 'expressions.jsx');
    const text = fs.readFileSync(file, 'utf8');
    const inJsx = new Set([...text.matchAll(/MCP\.expr\.presets\["([a-z0-9-]+)"\]\s*=/g)].map((m) => m[1]));
    expect([...inJsx].sort()).toEqual([...EXPRESSION_PRESETS].sort());
    for (const name of EXPRESSION_PRESETS) {
      expect(text, name).toMatch(new RegExp(`MCP\\.expr\\.presets\\["${name}"\\]\\s*=\\s*\\{[\\s\\S]*?build:\\s*function`));
    }
  });

  it('the mock preset list matches the enum', async () => {
    const { responses } = await import('../bridge-mock/responses/expressions.js');
    const list = (responses.listExpressionPresets as () => { presets: Array<{ name: string }> })().presets.map((p) => p.name).sort();
    expect(list).toEqual([...EXPRESSION_PRESETS].sort());
  });
});
