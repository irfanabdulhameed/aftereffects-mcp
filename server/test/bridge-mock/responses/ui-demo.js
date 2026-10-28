/*
 * Mock result shapes for the ui-demo commands. See core.js for helpers and shapes to mirror.
 */

const FPS = 60;
const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });
const refOf = (ref, index = 1, name = 'Layer 1') => layerRef(ref?.index ?? index, ref?.name ?? name);
const round = (n) => Math.round(n * 10000) / 10000;
const snap = (t) => Math.round(t * FPS) / FPS;
const frame = (t) => Math.round(t * FPS);
const timeOf = (spec, sec = 'at', fr = 'frame') => snap(spec[fr] !== undefined ? spec[fr] / FPS : spec[sec] ?? 0);
const layerSummary = (index, name, type, extra = {}) => ({ ...layerRef(index, name), type, enabled: true, inPoint: 0, outPoint: 10, parent: null, ...extra });

const keyframe = (index, time, value, ease = {}) => ({
  index,
  time: round(time),
  frame: frame(time),
  value,
  inInterpolation: ease.inInterpolation ?? 'bezier',
  outInterpolation: ease.outInterpolation ?? 'bezier',
  easeIn: [{ speed: 0, influence: ease.inInfluence ?? 100 }],
  easeOut: [{ speed: 0, influence: ease.outInfluence ?? 25 }],
  temporalContinuous: false,
  temporalAutoBezier: false,
  selected: false,
});

/** A point for a waypoint target: [x, y] as given, or a layer's centre on a fixed mock layout. */
const pointOf = (to) => {
  if (Array.isArray(to)) return to;
  const base = [1420, 836];
  const off = to.offset ?? [0, 0];
  return [base[0] + off[0], base[1] + off[1]];
};

const pressLen = (variant) => (variant === 'pop' ? snap(1 / FPS + 0.25) : snap(0.1) + snap(0.15));

export const responses = {
  cursorJourney: (args) => {
    const delay = snap(args.clickDelay ?? 0);
    const wps = args.waypoints.map((w, i) => {
      const t = timeOf(w);
      const target = Array.isArray(w.to) ? null : refOf(w.to.layer, 3 + i, 'Button');
      const pressTarget = !!w.click && !!target && w.pressTarget !== false;
      const hold = w.hold !== undefined ? w.hold : w.click ? delay + pressLen(pressTarget ? w.variant : 'dip') : 0;
      const last = i === args.waypoints.length - 1;
      return { waypoint: i + 1, time: round(t), frame: frame(t), point: pointOf(w.to), value: pointOf(w.to), target, anchor: target ? (w.to.anchor ?? 'center') : null, hold: round(hold), departTime: round(last ? t : t + hold), click: !!w.click, pressTarget, variant: w.variant ?? 'dip' };
    });
    const keys = [];
    wps.forEach((w) => {
      keys.push(keyframe(keys.length + 1, w.time, w.value));
      if (w.departTime !== w.time) keys.push(keyframe(keys.length + 1, w.departTime, w.value, { outInterpolation: 'hold' }));
    });
    const clicks = wps
      .filter((w) => w.click)
      .map((w) => {
        const t0 = snap(w.time + delay);
        const down = w.pressTarget && w.variant === 'pop' ? 1 / FPS : snap(0.1);
        const up = w.pressTarget && w.variant === 'pop' ? snap(0.25) : snap(0.15);
        const t1 = t0 + down, t2 = t1 + up;
        const rest = [100, 100, 100];
        const dip = (pct) => [keyframe(1, t0, rest), keyframe(2, t1, [pct, pct, 100]), keyframe(3, t2, rest)];
        return {
          waypoint: w.waypoint,
          pressed: w.pressTarget ? w.target : null,
          variant: w.pressTarget ? w.variant : 'dip',
          startTime: round(t0), clickTime: round(t1), endTime: round(t2),
          startFrame: frame(t0), clickFrame: frame(t1), endFrame: frame(t2),
          point: w.point,
          targetKeys: w.pressTarget ? dip(w.variant === 'pop' ? 108 : 96) : null,
          cursorKeys: dip(args.cursorScale ?? 92),
          flips: [],
          ring: args.clickRing ? { id: 200 + w.waypoint, name: 'Cursor Ring', startTime: round(t1), endTime: round(t1 + 0.6) } : null,
        };
      });
    const created = !args.cursor;
    return {
      composition: comp(),
      cursor: layerSummary(1, args.cursor?.name ?? args.cursorStyle?.name ?? 'Cursor', 'shape', { comment: 'UI demo: cursor' }),
      created,
      look: created ? { height: args.cursorStyle?.height ?? 44, outlineWidth: 2, fillColor: '#ffffff', outlineColor: '#111111' } : null,
      shadow: created && args.cursorStyle?.shadow !== false ? { status: 'ok', kind: 'drop-shadow', added: true, method: 'menu' } : null,
      rodeCamera: null,
      easing: args.easing ?? 'landing (speed 0, influence 25 leaving, 100 arriving)',
      arc: args.arc ?? 0,
      arcsSet: args.arc ? Math.max(0, wps.length - 1) : 0,
      keys,
      waypoints: wps.map(({ pressTarget, variant, ...w }) => (void pressTarget, void variant, w)),
      clicks,
      notes: [],
    };
  },

  scrollInWindow: (args) => {
    const existing = !args.window && !args.windowLayer;
    const W = existing ? 1200 : Math.round(args.window ? args.window.width : 1180);
    const H = existing ? 800 : Math.round(args.window ? args.window.height : 760);
    const pageW = 1440, pageH = 4000;
    const k = args.fit === 'keep' ? 0.5 : W / pageW;
    const maxScroll = Math.max(0, pageH - H / k);
    const name = args.name ?? 'Page Window';
    const stops = args.stops.map((s, i) => {
      let v = s.fraction !== undefined ? s.fraction * maxScroll : s.to === 'top' ? 0 : s.to === 'bottom' ? maxScroll : Math.min(s.to, maxScroll);
      v = Math.max(0, v);
      const t = timeOf(s);
      return { stop: i + 1, time: round(t), frame: frame(t), scroll: Math.round(v * 100) / 100, hold: s.hold ?? 0 };
    });
    const keys = [];
    stops.forEach((s, i) => {
      keys.push(keyframe(keys.length + 1, s.time, s.scroll, args.momentum ? { inInfluence: 70, outInfluence: 16 } : {}));
      if (s.hold && i < stops.length - 1) keys.push(keyframe(keys.length + 1, s.time + s.hold, s.scroll, { outInterpolation: 'hold' }));
    });
    const slider = args.sliderName ?? 'Scroll';
    const code = `// Scroll in window: moves this layer up by effect("${slider}") in page pixels\nvar s = effect("${slider}")("Slider").value;\nvar k = transform.scale[1] / 100;\nvar p = value;\np[1] = p[1] - s * k;\np`;
    return {
      composition: comp(),
      method: existing ? 'existing' : 'precomp',
      explanation: existing ? 'The layer already carries the scroll rig; the stops became keys on its slider.' : 'The screen now lives in a precomposition the size of the window and scrolls inside it.',
      window: {
        composition: { id: 9, name },
        width: W,
        height: H,
        layer: existing ? null : layerSummary(2, name, 'precomp', { source: { id: 9, name } }),
        region: existing ? null : { x: args.window?.x ?? 370, y: args.window?.y ?? 150, width: W, height: H, space: args.windowLayer ? 'windowLayer' : 'composition', windowLayer: args.windowLayer ? refOf(args.windowLayer, 3, 'Window Body') : null, cornerRadius: args.cornerRadius ?? 0 },
      },
      screen: { composition: { id: 9, name }, layer: layerRef(1, args.layer?.name ?? 'Page') },
      fit: { mode: existing ? 'existing' : args.fit ?? 'width', scale: round(k * 100) },
      page: { height: pageH, visibleHeight: round(H / k), maxScroll: Math.round(maxScroll * 100) / 100 },
      slider: { effect: slider, propertyPath: `Effects/${slider}/Slider`, expressionRef: `effect("${slider}")("Slider")`, keys },
      positionExpression: existing ? null : { property: 'Transform/Position', error: '', expression: code },
      easing: args.momentum ? 'glide (cubic-bezier 0.16, 1, 0.3, 1)' : 'landing (speed 0, influence 25 leaving, 100 arriving)',
      stops,
      notes: [],
    };
  },

  focusOnRegion: (args) => {
    const t0 = snap(args.frame !== undefined ? args.frame / FPS : args.time);
    const t1 = t0 + snap(args.durationFrames !== undefined ? args.durationFrames / FPS : args.duration ?? 0.8);
    const rect = args.rect ?? { x: 0, y: 0, width: 240, height: 72 };
    const pad = args.padding ?? 24;
    const fill = args.fill ?? 0.7;
    let pct = (fill * Math.min(1920 / (rect.width + 2 * pad), 1080 / (rect.height + 2 * pad))) * 100;
    pct = Math.min(pct, args.maxScale ?? 800);
    const ret = args.return;
    const hold = ret ? snap(ret.hold ?? 1) : 0;
    const t2 = ret ? t1 + hold : null;
    const t3 = ret ? t2 + snap(ret.durationFrames !== undefined ? ret.durationFrames / FPS : ret.duration ?? t1 - t0) : null;
    const s = [pct, pct, 100];
    const scaleKeys = [keyframe(1, t0, [100, 100, 100]), keyframe(2, t1, s, { outInfluence: 33.3 })];
    if (ret) { scaleKeys.push(keyframe(3, t2, s, { outInterpolation: 'hold' })); scaleKeys.push(keyframe(4, t3, [100, 100, 100])); }
    const created = !args.camera;
    return {
      composition: comp(),
      camera: {
        layer: layerSummary(1, args.camera?.name ?? args.name ?? 'UI Camera', 'null', { isNull: true }),
        created,
        reused: created ? false : 'given',
        parented: created ? [layerRef(2, 'Screen'), layerRef(3, args.layer?.name ?? 'Button')] : [],
        skipped: created ? [{ layer: layerRef(4, 'Highlight Dim'), reason: 'a screen overlay (highlight, toast) stays fixed to the frame' }] : [],
      },
      region: { layer: refOf(args.layer, 3, 'Button'), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, inCameraSpace: { x: 1300 + rect.x, y: 800 + rect.y, width: rect.width, height: rect.height }, padding: pad },
      fill,
      scale: round(pct),
      easing: args.easing ?? 'camera landing (speed 0, influence 33.3 leaving, 100 arriving)',
      startTime: round(t0), endTime: round(t1), startFrame: frame(t0), endFrame: frame(t1),
      return: ret ? { holdUntil: round(t2), endTime: round(t3), holdFrame: frame(t2), endFrame: frame(t3), holdPush: args.holdPush ?? 0 } : null,
      carriedKeys: null,
      keys: { scale: scaleKeys, position: scaleKeys.map((k) => ({ ...k, value: [960, 540] })) },
      notes: [],
    };
  },

  deviceFrame: (args) => {
    const sizes = {
      browser: { barHeight: 50, cornerRadius: args.cornerRadius ?? 13, dotDiameter: 12, addressPill: [480, 29], ...(args.url ? { urlFontSize: 14 } : {}) },
      phone: { bezel: 14, rim: 4, screenRadius: args.cornerRadius ?? 51, ...(args.notch === false ? {} : { island: [117, 34] }) },
      tablet: { bezel: 37, rim: 7, screenRadius: args.cornerRadius ?? 25, cameraDiameter: 8 },
      laptop: { sideBezel: 26, topBezel: 36, chin: 60, lidRadius: 26, screenRadius: args.cornerRadius ?? 10, baseWidth: 1468, baseHeight: 38 },
    }[args.device];
    const base = args.name ?? `Screen ${args.device[0].toUpperCase()}${args.device.slice(1)}`;
    const component = args.component
      ? { composition: comp(), component: { id: 12, name: args.component.name ?? base }, added: [{ label: 'Theme Colour' }, ...(args.url ? [{ label: 'URL' }] : [])], failed: [] }
      : null;
    const theme = args.theme ?? 'light';
    return {
      composition: comp(),
      device: args.device,
      theme,
      screen: component ? null : refOf(args.layer, 2, 'Screen'),
      frame: component ? null : layerSummary(3, `${base} Frame`, 'shape', { parent: refOf(args.layer, 2, 'Screen') }),
      island: args.device === 'phone' && args.notch !== false && !component ? layerRef(1, `${base} Island`) : null,
      urlLayer: args.url && !component ? layerRef(3, `${base} URL`) : null,
      screenSize: [1200, 750],
      sizes,
      frameColor: args.color ? '#custom' : args.device === 'browser' ? (theme === 'dark' ? '#1f2023' : '#f3f4f6') : theme === 'dark' ? '#2a2b2f' : '#e2e3e6',
      mask: { name: 'Device Screen', mode: 'add' },
      expressions: args.device === 'browser' ? [{ property: 'Contents/Address/Fill/Color', error: '' }, { property: 'Contents/Separator/Fill/Color', error: '' }] : [],
      shadow: args.shadow === false ? null : { status: 'ok', kind: 'drop-shadow', added: true, method: 'menu' },
      component,
      notes: [],
    };
  },

  highlightRegion: (args) => {
    const t0 = snap(args.frame !== undefined ? args.frame / FPS : args.time);
    const dur = snap(args.durationFrames !== undefined ? args.durationFrames / FPS : args.duration ?? 0.4);
    const st = 3 / FPS;
    const t2 = args.hideFrame !== undefined ? args.hideFrame / FPS : args.hideTime;
    const t3 = t2 !== undefined ? t2 + snap(args.hideDurationFrames !== undefined ? args.hideDurationFrames / FPS : args.hideDuration ?? 0.3) : undefined;
    const pad = args.padding ?? 8;
    const label = typeof args.label === 'string' ? { text: args.label } : args.label;
    const layers = {};
    const keys = [];
    const hide = (v) => (t2 !== undefined ? [keyframe(3, t2, v, { outInfluence: 85 }), keyframe(4, t3, 0, { inInfluence: 15 })] : []);
    let idx = 2;
    if (args.dim !== false) { layers.dim = layerRef(idx++, `${args.name ?? 'Highlight'} Dim`); keys.push({ layer: layers.dim.name, property: 'Transform/Opacity', keys: [keyframe(1, t0, 0), keyframe(2, t0 + dur, args.dim?.opacity ?? 55), ...hide(args.dim?.opacity ?? 55)] }); }
    if (args.outline !== false) {
      layers.outline = layerRef(idx++, `${args.name ?? 'Highlight'} Outline`);
      const g = args.outline?.grow ?? 16;
      keys.push({ layer: layers.outline.name, property: 'Contents/Outline/Rectangle Path 1/Size', keys: [keyframe(1, t0 + st, [g, g]), keyframe(2, t0 + st + dur, [0, 0])] });
      keys.push({ layer: layers.outline.name, property: 'Transform/Opacity', keys: [keyframe(1, t0 + st, 0), keyframe(2, t0 + st + dur, 100), ...hide(100)] });
    }
    if (label) {
      if (label.line !== false) { layers.line = layerRef(idx++, `${args.name ?? 'Highlight'} Line`); keys.push({ layer: layers.line.name, property: 'Contents/Line/Trim Paths 1/End', keys: [keyframe(1, t0 + 2 * st, 0), keyframe(2, t0 + 2 * st + dur * 0.6, 100)] }); }
      layers.label = layerRef(idx++, `${args.name ?? 'Highlight'} Label`);
      layers.labelPill = layerRef(idx++, `${args.name ?? 'Highlight'} Label Pill`);
      keys.push({ layer: layers.label.name, property: 'Transform/Scale', keys: [keyframe(1, t0 + 3 * st, [92, 92, 100]), keyframe(2, t0 + 3 * st + dur, [100, 100, 100])] });
    }
    const follow = args.follow !== false;
    const expressions = [];
    if (layers.dim) expressions.push({ property: 'Masks/Hole/Mask Path', error: '' });
    if (layers.outline) { expressions.push({ property: 'Contents/Outline/Rectangle Path 1/Size', error: '' }); expressions.push({ property: 'Contents/Outline/Rectangle Path 1/Position', error: '' }); }
    if (layers.line) expressions.push({ property: 'Contents/Line/Path 1/Path', error: '' });
    if (layers.label) expressions.push({ property: 'Transform/Position', error: '' });
    const rect = args.rect ?? { x: 0, y: 0, width: 240, height: 72 };
    return {
      composition: comp(),
      region: { layer: refOf(args.layer, 6, 'Button'), rect, box: { x: 1300 + rect.x - pad, y: 800 + rect.y - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }, padding: pad, cornerRadius: (args.cornerRadius ?? 12) + pad },
      follow,
      label: label ? { side: label.side && label.side !== 'auto' ? label.side : 'top', size: [label.text.length * 15 + 34, 44] } : null,
      layers,
      revealTime: round(t0), revealFrame: frame(t0), settledTime: round(t0 + dur + (label ? 3 : 1) * st),
      hideTime: t2 !== undefined ? round(t2) : null, hideEndTime: t3 !== undefined ? round(t3) : null,
      keys,
      expressions,
      notes: [],
    };
  },

  addToast: (args) => {
    const t0 = snap(args.frame !== undefined ? args.frame / FPS : args.time);
    const t1 = t0 + snap(args.durationFrames !== undefined ? args.durationFrames / FPS : args.duration ?? 0.5);
    const exit = args.exit !== false;
    const t2 = t1 + snap(args.hold ?? 2.5), t3 = t2 + snap(args.exitDuration ?? 0.35);
    const w = args.width ?? 420, h = args.body ? 104 : 66, m = args.margin ?? 32;
    const pos = args.position ?? 'top-right';
    const rx = pos.includes('right') ? 1920 - m - w / 2 : pos.includes('left') ? m + w / 2 : 960;
    const ry = pos.startsWith('top') ? m + h / 2 : 1080 - m - h / 2;
    const from = pos === 'top' ? [rx, -h / 2 - 40] : pos === 'bottom' ? [rx, 1080 + h / 2 + 40] : pos.includes('right') ? [1920 + w / 2 + 40, ry] : [-w / 2 - 40, ry];
    const keys = [keyframe(1, t0, from), keyframe(2, t1, [rx, ry])];
    if (exit) { keys.push(keyframe(3, t2, [rx, ry], { outInfluence: 85 })); keys.push(keyframe(4, t3, from, { inInfluence: 15 })); }
    const name = args.name ?? 'Toast';
    return {
      composition: comp(),
      card: layerSummary(2, name, 'shape', { comment: 'UI demo: screen overlay' }),
      title: layerRef(1, `${name} Title`),
      body: args.body ? layerRef(2, `${name} Body`) : null,
      size: [w, h], position: pos, rest: [rx, ry], from,
      startTime: round(t0), landTime: round(t1), exitTime: exit ? round(t2) : null, endTime: exit ? round(t3) : null,
      startFrame: frame(t0), landFrame: frame(t1),
      easing: args.easing ?? 'landing (speed 0, influence 25 leaving, 100 arriving)',
      keys: [{ layer: name, property: 'Transform/Position', keys }],
      shadow: args.shadow === false ? null : { status: 'ok', kind: 'drop-shadow', added: true, method: 'menu' },
      notes: [],
    };
  },
};
