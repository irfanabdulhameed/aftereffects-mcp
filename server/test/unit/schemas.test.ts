import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CompRef, Easing, KeyframeSpec, LayerRef, PropertyPath, TimeArgs, Vec2, Vec2or3 } from '../../src/schemas/common.js';
import { catalog } from '../../src/tools/registry.js';

describe('common schemas', () => {
  it('CompRef and LayerRef accept the documented forms and reject others', () => {
    expect(CompRef.safeParse({}).success).toBe(true);
    expect(CompRef.safeParse({ id: 12 }).success).toBe(true);
    expect(CompRef.safeParse({ name: 'Main' }).success).toBe(true);
    expect(CompRef.safeParse({ id: 'x' }).success).toBe(false);
    expect(CompRef.safeParse('Main').success).toBe(false);
    expect(LayerRef.safeParse({ index: 1 }).success).toBe(true);
    expect(LayerRef.safeParse({ index: 0 }).success).toBe(false);
    expect(LayerRef.safeParse({ id: 5 }).success).toBe(true);
    expect(LayerRef.safeParse({ name: 'Title' }).success).toBe(true);
    expect(LayerRef.safeParse(3).success).toBe(false);
  });

  it('PropertyPath accepts strings and arrays', () => {
    expect(PropertyPath.safeParse('Transform/Position').success).toBe(true);
    expect(PropertyPath.safeParse(['Effects', 1, 'Blurriness']).success).toBe(true);
    expect(PropertyPath.safeParse([]).success).toBe(false);
    expect(PropertyPath.safeParse(12).success).toBe(false);
  });

  it('Easing accepts presets, style refs, custom and bezier', () => {
    for (const p of ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'smooth', 'snappy', 'overshoot', 'hold']) {
      expect(Easing.safeParse(p).success, p).toBe(true);
    }
    expect(Easing.safeParse('@style.entrance').success).toBe(true);
    expect(Easing.safeParse('bouncy').success).toBe(false);
    expect(Easing.safeParse({ type: 'custom', inInfluence: 50 }).success).toBe(true);
    expect(Easing.safeParse({ type: 'custom', inInfluence: 500 }).success).toBe(false);
    expect(Easing.safeParse({ type: 'bezier', x1: 0.2, y1: 0, x2: 0.8, y2: 1 }).success).toBe(true);
    expect(Easing.safeParse({ type: 'bezier', x1: 2, y1: 0, x2: 0.8, y2: 1 }).success).toBe(false);
  });

  it('KeyframeSpec, TimeArgs and vectors', () => {
    expect(KeyframeSpec.safeParse({ frame: 3, value: [1, 2], easing: 'ease' }).success).toBe(true);
    expect(KeyframeSpec.safeParse({ time: 'now', value: 1 }).success).toBe(false);
    expect(z.object(TimeArgs).safeParse({ frame: 1.5 }).success).toBe(false);
    expect(Vec2.safeParse([1, 2]).success).toBe(true);
    expect(Vec2.safeParse([1]).success).toBe(false);
    expect(Vec2or3.safeParse([1, 2, 3]).success).toBe(true);
    expect(Vec2or3.safeParse([1, 2, 3, 4]).success).toBe(false);
  });
});

describe('every tool schema', () => {
  it('rejects wrong-typed layer and comp references and unknown easing', async () => {
    const { createServer } = await import('../../src/index.js');
    if (catalog.length === 0) createServer();
    expect(catalog.length).toBeGreaterThanOrEqual(90);
    for (const entry of catalog) {
      const schema = z.object(entry.input);
      const keys = Object.keys(entry.input);
      if (keys.includes('layer')) {
        expect(schema.safeParse({ layer: 'Title' }).success, `${entry.name} should reject a string layer`).toBe(false);
      }
      if (keys.includes('comp')) {
        expect(schema.safeParse({ comp: 42 }).success, `${entry.name} should reject a number comp`).toBe(false);
      }
      if (keys.includes('easing')) {
        expect(schema.safeParse({ easing: 'bouncy' }).success, `${entry.name} should reject an unknown easing`).toBe(false);
      }
      // Every input field must carry a description or be a shared schema with one.
      for (const key of keys) {
        const s = entry.input[key];
        const described = hasDescription(s);
        expect(described, `${entry.name}.${key} needs a .describe()`).toBe(true);
      }
    }
  });
});

function hasDescription(schema: z.ZodTypeAny): boolean {
  let s: z.ZodTypeAny | undefined = schema;
  for (let i = 0; i < 8 && s; i++) {
    if (s.description) return true;
    const def = (s as unknown as { _def: Record<string, unknown> })._def;
    const t = def.typeName as string;
    if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault') s = def.innerType as z.ZodTypeAny;
    else if (t === 'ZodEffects') s = def.schema as z.ZodTypeAny;
    else if (t === 'ZodUnion') return (def.options as z.ZodTypeAny[]).some(hasDescription) || false;
    else if (t === 'ZodEnum' || t === 'ZodLiteral' || t === 'ZodBoolean') return true; // self-describing
    else if (t === 'ZodObject' || t === 'ZodArray' || t === 'ZodRecord' || t === 'ZodTuple') return true; // shared shapes describe their fields
    else break;
  }
  return false;
}
