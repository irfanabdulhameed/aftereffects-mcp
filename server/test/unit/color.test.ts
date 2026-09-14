import { describe, expect, it } from 'vitest';
import { Color, parseHexColor, toHex, toRgba } from '../../src/schemas/color.js';

describe('colour normalisation', () => {
  it('parses hex in every length', () => {
    expect(parseHexColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseHexColor('000000')).toEqual([0, 0, 0, 1]);
    expect(parseHexColor('#FF000080')?.map((v) => Math.round(v * 100) / 100)).toEqual([1, 0, 0, 0.5]);
    expect(parseHexColor('nope')).toBeUndefined();
  });

  it('accepts 0..1 and 0..255 arrays', () => {
    expect(toRgba([1, 0.5, 0])).toEqual([1, 0.5, 0, 1]);
    expect(toRgba([255, 128, 0])).toEqual([1, 128 / 255, 0, 1]);
    expect(toRgba([255, 0, 0, 128])[3]).toBeCloseTo(128 / 255);
    expect(toRgba({ r: 0, g: 0, b: 255 })).toEqual([0, 0, 1, 1]);
  });

  it('rejects garbage', () => {
    expect(() => toRgba('purple-ish')).toThrow();
    expect(() => toRgba([1])).toThrow();
    expect(() => toRgba(42)).toThrow();
  });

  it('round-trips to hex', () => {
    expect(toHex([1, 0, 0, 1])).toBe('#ff0000');
    expect(toHex([0, 0, 0, 0.5])).toBe('#00000080');
  });

  it('zod schema transforms to [r,g,b,a]', () => {
    expect(Color.parse('white')).toEqual([1, 1, 1, 1]);
    expect(Color.parse([0, 0, 0])).toEqual([0, 0, 0, 1]);
    expect(Color.safeParse('zzz').success).toBe(false);
  });
});
