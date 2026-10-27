import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { gradientChunks, gradientXml, parseRifx, prepareGradientPreset, rewriteGradientPreset, RiffChunk, templateFolder, writeRifx } from '../../src/tools/gradient-preset.js';

const TEMPLATE_XML =
  "<?xml version='1.0'?>\n<prop.map version='4'><prop.list><prop.pair><key>Gradient Color Data</key><prop.list></prop.list></prop.pair>" +
  "<prop.pair><key>Gradient Colors</key><string>1.0</string></prop.pair></prop.list></prop.map>\n";

const chunk = (id: string, data: Buffer): RiffChunk => ({ id, data });
const list = (listType: string, children: RiffChunk[]): RiffChunk => ({ id: 'LIST', listType, children });

/** A small RIFX shaped like an animation preset: a header, a property tree, and the gradient XML with a trailing NUL. */
function fakeTemplate(): Buffer {
  const head = chunk('head', Buffer.from([0, 0, 0, 3, 0, 0, 0, 0x5f]));
  const name = chunk('tdsn', Buffer.from('Grp', 'latin1')); // odd length: padded
  const xml = chunk('Utf8', Buffer.concat([Buffer.from(TEMPLATE_XML, 'utf8'), Buffer.from([0])]));
  const tree = list('tdgp', [chunk('tdmn', Buffer.from('ADBE Vector Graphic - G-Fill\0', 'latin1')), list('GCst', [xml]), name]);
  return writeRifx({ id: 'RIFX', listType: 'FaFX', children: [head, list('besc', [tree])] });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-grad-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('RIFX reader and writer', () => {
  it('round-trips a preset byte for byte, including odd-length padding', () => {
    const buf = fakeTemplate();
    expect(buf.toString('latin1', 0, 4)).toBe('RIFX');
    expect(buf.readUInt32BE(4)).toBe(buf.length - 8);
    const again = writeRifx(parseRifx(buf));
    expect(again.equals(buf)).toBe(true);
  });

  it('refuses files that are not RIFX and chunks that run past their parent', () => {
    expect(() => parseRifx(Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 4]), Buffer.from('WAVE', 'latin1')]))).toThrow(/Not a RIFX/);
    const bad = Buffer.from(fakeTemplate());
    bad.writeUInt32BE(0xffff, 12 + 4 + 8 + 8);
    expect(() => parseRifx(bad)).toThrow();
  });
});

describe('gradient XML', () => {
  it('writes one colour and one opacity stop per input stop, midpoints 0.5, AE string key order', () => {
    const stops = Array.from({ length: 12 }, (_, i) => ({ offset: i / 11, rgba: [i / 11, 0, 1, 1] }));
    const xml = gradientXml(stops);
    expect(xml.startsWith("<?xml version='1.0'?>")).toBe(true);
    expect(xml.match(/<key>Stops Color<\/key>/g)?.length).toBe(12);
    expect(xml.match(/<key>Stops Alpha<\/key>/g)?.length).toBe(12);
    expect(xml).toContain("<int type='unsigned' size='32'>12</int>");
    const order = [...xml.matchAll(/<key>(Stop-\d+)<\/key>/g)].slice(0, 12).map((m) => m[1]);
    expect(order.slice(0, 4)).toEqual(['Stop-0', 'Stop-1', 'Stop-10', 'Stop-11']);
    expect(xml).toContain('<key>Gradient Colors</key>\n<string>1.0</string>');
  });

  it('sorts stops by offset, clamps, uses opacity or the colour alpha, and stores floats like After Effects', () => {
    const xml = gradientXml([
      { offset: 1, rgba: [0, 0.76, 1, 1], opacity: 50 },
      { offset: 0, rgba: [0.41568627, 0.36078431, 1, 0.25] },
    ]);
    const colorBlock = xml.slice(xml.indexOf('<key>Color Stops</key>'));
    const firstColor = [...colorBlock.matchAll(/<float>([^<]+)<\/float>/g)].slice(0, 6).map((m) => m[1]);
    expect(firstColor).toEqual(['0', '0.5', '0.41568628', '0.36078432', '1', '1']);
    const alphaBlock = xml.slice(xml.indexOf('<key>Alpha Stops</key>'), xml.indexOf('<key>Color Stops</key>'));
    const alphas = [...alphaBlock.matchAll(/<float>([^<]+)<\/float>/g)].map((m) => m[1]);
    expect(alphas).toEqual(['0', '0.5', '0.25', '1', '0.5', '0.5']);
  });

  it('a single stop becomes a flat two-stop gradient', () => {
    const xml = gradientXml([{ offset: 0.3, rgba: [1, 0, 0, 1] }]);
    expect(xml).toContain("<int type='unsigned' size='32'>2</int>");
  });
});

describe('rewriteGradientPreset', () => {
  it('replaces every gradient chunk, keeps the NUL, and fixes all sizes', () => {
    const { buffer, chunksReplaced } = rewriteGradientPreset(fakeTemplate(), [
      { offset: 0, rgba: [1, 0, 0, 1] },
      { offset: 1, rgba: [0, 0, 1, 1] },
    ]);
    expect(chunksReplaced).toBe(1);
    const root = parseRifx(buffer);
    expect(buffer.readUInt32BE(4)).toBe(buffer.length - 8);
    const [g] = gradientChunks(root);
    const data = g.data as Buffer;
    expect(data[data.length - 1]).toBe(0);
    expect(data.toString('utf8')).toContain('<key>Stops Size</key>');
    // Everything else is untouched.
    expect(writeRifx(root).equals(buffer)).toBe(true);
    const names: string[] = [];
    const walk = (c: RiffChunk) => {
      names.push(c.id + (c.listType ? ':' + c.listType : ''));
      (c.children ?? []).forEach(walk);
    };
    walk(root);
    expect(names).toEqual(['RIFX:FaFX', 'head', 'LIST:besc', 'LIST:tdgp', 'tdmn', 'LIST:GCst', 'Utf8', 'tdsn']);
  });

  it('fails clearly when the template has no gradient', () => {
    const plain = writeRifx({ id: 'RIFX', listType: 'FaFX', children: [chunk('head', Buffer.alloc(4))] });
    expect(() => rewriteGradientPreset(plain, [{ offset: 0, rgba: [0, 0, 0, 1] }])).toThrow(/no gradient colours/);
  });
});

describe('prepareGradientPreset', () => {
  it('reports how to make the template when it is missing', () => {
    const r = prepareGradientPreset('stroke', [{ offset: 0, rgba: [1, 1, 1, 1] }], path.join(tmp, 'none'), tmp);
    expect(r.presetPath).toBeNull();
    expect(r.reason).toContain('gradient-stroke.ffx');
    expect(r.reason).toContain('Save Animation Preset');
  });

  it('writes a preset into <bridge>/tmp from the template folder', () => {
    const folder = path.join(tmp, 'templates');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'gradient-fill.ffx'), fakeTemplate());
    const r = prepareGradientPreset('fill', [{ offset: 0, rgba: [1, 0, 0, 1] }, { offset: 1, rgba: [0, 1, 0, 1] }], folder, tmp);
    expect(r.reason).toBeNull();
    expect(r.presetPath && r.presetPath.startsWith(path.join(tmp, 'tmp'))).toBe(true);
    expect(fs.readFileSync(r.presetPath as string).toString('utf8')).toContain('Gradient Color Data');
  });

  it('turns an unreadable template into a reason instead of throwing', () => {
    const folder = path.join(tmp, 'broken');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'gradient-fill.ffx'), 'not a preset');
    const r = prepareGradientPreset('fill', [{ offset: 0, rgba: [1, 0, 0, 1] }], folder, tmp);
    expect(r.presetPath).toBeNull();
    expect(r.reason).toMatch(/could not be used/);
  });

  it('template folder: explicit, then AE_MCP_GRADIENT_TEMPLATES, then <bridge>/templates', () => {
    const before = process.env.AE_MCP_GRADIENT_TEMPLATES;
    try {
      delete process.env.AE_MCP_GRADIENT_TEMPLATES;
      expect(templateFolder(undefined, '/b')).toBe(path.join('/b', 'templates'));
      process.env.AE_MCP_GRADIENT_TEMPLATES = '/env/templates';
      expect(templateFolder(undefined, '/b')).toBe(path.resolve('/env/templates'));
      expect(templateFolder('/x', '/b')).toBe(path.resolve('/x'));
    } finally {
      if (before === undefined) delete process.env.AE_MCP_GRADIENT_TEMPLATES;
      else process.env.AE_MCP_GRADIENT_TEMPLATES = before;
    }
  });
});
