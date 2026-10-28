// cropToContent keeps the instance's pixels in place. After Effects re-centres the anchor point of every layer whose
// source comp changes size, so the instance must be read before the resize; the fake comp below does the same.
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SCRIPTS = path.resolve(__dirname, '..', '..', 'src', 'scripts');

class ShapeLayer {}
class CameraLayer {}
class LightLayer {}

function prop(value: number[]) {
  let v = value.slice();
  return {
    numKeys: 0,
    expression: '',
    get value() {
      return v.slice();
    },
    valueAtTime: () => v.slice(),
    setValue: (n: number[]) => {
      v = n.slice();
    },
  };
}

function transform(anchor: number[], position: number[]) {
  const props: Record<string, ReturnType<typeof prop>> = {
    'ADBE Anchor Point': prop(anchor),
    'ADBE Position': prop(position),
    'ADBE Scale': prop([100, 100]),
    'ADBE Rotate Z': prop([0]),
  };
  const group = { property: (mn: string) => (mn === 'ADBE Rotate Z' ? { ...props[mn], valueAtTime: () => 0 } : props[mn]) };
  return { group, props };
}

function load() {
  const ctx = vm.createContext({ ShapeLayer, CameraLayer, LightLayer, MCP_BRIDGE_VERSION: 'test' });
  for (const f of ['lib/polyfills.jsx', 'lib/json.jsx', 'lib/core.jsx', 'lib/serialize.jsx', 'commands/components.jsx']) {
    vm.runInContext(fs.readFileSync(path.join(SCRIPTS, f), 'utf8'), ctx, { filename: f });
  }
  return (ctx as any).MCP;
}

describe('component crop', () => {
  it('keeps the instance in place although After Effects re-centres its anchor on resize', () => {
    const MCP = load();
    const inner = transform([0, 0], [960, 540]);
    const content = Object.assign(new ShapeLayer(), {
      name: 'Card',
      parent: null,
      enabled: true,
      nullLayer: false,
      adjustmentLayer: false,
      guideLayer: false,
      hasVideo: true,
      threeDLayer: false,
      inPoint: 0,
      outPoint: 4,
      sourceRectAtTime: () => ({ left: -200, top: -100, width: 400, height: 200 }),
      property: () => inner.group,
    });
    const outer = transform([960, 540], [960, 540]);
    const instance = { property: () => outer.group };
    let width = 1920;
    let height = 1080;
    const comp = {
      numLayers: 1,
      duration: 4,
      frameDuration: 1 / 30,
      layer: () => content,
      get width() {
        return width;
      },
      set width(w: number) {
        width = w;
        outer.props['ADBE Anchor Point'].setValue([w / 2, height / 2]);
      },
      get height() {
        return height;
      },
      set height(h: number) {
        height = h;
        outer.props['ADBE Anchor Point'].setValue([width / 2, h / 2]);
      },
    };
    const r = MCP.components.cropToContent(comp, instance, 0);
    expect(r).toMatchObject({ applied: true, region: { x: 760, y: 440, width: 400, height: 200 } });
    expect(inner.props['ADBE Position'].value).toEqual([200, 100]);
    expect(outer.props['ADBE Anchor Point'].value).toEqual([200, 100]);
    expect(outer.props['ADBE Position'].value).toEqual([960, 540]);
  });
});
