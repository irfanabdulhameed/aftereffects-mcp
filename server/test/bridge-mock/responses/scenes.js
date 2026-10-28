/*
 * Mock result shapes for the scenes commands. See core.js for helpers and shapes to mirror.
 *
 * The mock master "Launch Film" runs at 30 fps with three scenes:
 * 01 Intro (90 f), 02 Feature (135 f, overlapping the next by 15 f) and
 * 03 Outro (60 f), and one match cut between Intro and Feature.
 */

const FPS = 30;
const round = (n) => Math.round(n * 10000) / 10000;
const fail = (message, code) => {
  throw Object.assign(new Error(message), { mcpCode: code });
};

const bare = (n) => String(n).replace(/^\s*\d+[\s._-]+/, '').trim();
const numbered = (i, n, total) => `${String(i).padStart(total >= 100 ? 3 : 2, '0')} ${bare(n)}`;
const folder = (id, name, parent = null) => ({ id, name, type: 'folder', parentFolder: parent, parentFolderId: null });

const BASE = [
  { name: 'Intro', frames: 90, overlap: 0, notes: 'Logo builds from the dot', transition: 'match-cut', compId: 61 },
  { name: 'Feature', frames: 135, overlap: 15, notes: 'Prompt types, the card opens', transition: 'push', compId: 62 },
  { name: 'Outro', frames: 60, overlap: 0, notes: '', transition: null, compId: 63 },
];

/** Scene summaries for a list of {name, frames, overlap (with next), notes, transition, compId}. */
function sequence(plan, fps = FPS) {
  let start = 0;
  const total = plan.length;
  return plan.map((p, i) => {
    const s0 = start;
    start += p.frames - (i < plan.length - 1 ? p.overlap : 0);
    const gap = i === 0 ? 0 : s0 - (plan[i - 1].start + plan[i - 1].frames);
    p.start = s0;
    return {
      position: i + 1,
      name: numbered(i + 1, p.name, total),
      bareName: bare(p.name),
      compId: p.compId ?? 70 + i,
      layer: { index: total - i, id: 200 + i, name: numbered(i + 1, p.name, total) },
      startTime: round(s0 / fps),
      inPoint: round(s0 / fps),
      outPoint: round((s0 + p.frames) / fps),
      duration: round(p.frames / fps),
      inFrame: s0,
      outFrame: s0 + p.frames,
      durationFrames: p.frames,
      compDuration: round(p.frames / fps),
      compDurationFrames: p.frames,
      notes: p.notes ?? '',
      transition: p.transition ?? null,
      gapBeforeFrames: gap,
    };
  });
}

function result(name, plan, extra = {}, fps = FPS, size = [1920, 1080], scenesFolder = 'Scenes') {
  const scenes = sequence(plan.map((p) => ({ ...p })), fps);
  const end = Math.max(...scenes.map((s) => s.outFrame));
  return {
    composition: { id: 50, name, width: size[0], height: size[1], frameRate: fps, duration: round(end / fps), durationFrames: end },
    folder: folder(40, name),
    scenesFolder: folder(41, scenesFolder, name),
    rule: 'scenes-folder',
    count: scenes.length,
    scenes,
    totalDuration: round(end / fps),
    totalFrames: end,
    ...extra,
  };
}

function framesOf(args, fps = FPS) {
  if (args.durationFrames !== undefined) return args.durationFrames;
  return Math.max(1, Math.round((args.duration ?? 0) * fps));
}

/** Index into BASE for a scene ref: position, name, {compId} or {layer}. */
function findScene(ref) {
  const names = BASE.map((p, i) => numbered(i + 1, p.name, BASE.length));
  let idx = -1;
  if (typeof ref === 'number') idx = ref - 1;
  else if (typeof ref === 'string') idx = names.findIndex((n, i) => n === ref || bare(n).toLowerCase() === bare(ref).toLowerCase() || BASE[i].name.toLowerCase() === ref.toLowerCase());
  else if (ref && ref.compId !== undefined) idx = BASE.findIndex((p) => p.compId === ref.compId);
  else if (ref && ref.layer) idx = BASE.findIndex((_, i) => ref.layer.name === names[i] || ref.layer.index === BASE.length - i);
  if (idx < 0 || idx >= BASE.length) fail(`No scene '${JSON.stringify(ref)}' in 'Launch Film'. Scenes: ${names.join(', ')}`, 'not-found');
  return idx;
}

const copyBase = () => BASE.map((p) => ({ ...p }));

export const responses = {
  createScenePlan: (args) => {
    const fps = args.fps ?? FPS;
    const plan = args.scenes.map((s, i) => ({ name: s.name, frames: framesOf(s, fps), overlap: s.overlapFrames ?? 0, notes: s.notes ?? '', transition: s.transition ?? null, compId: 61 + i }));
    if (args.filmName === 'Launch Film') {
      const mode = args.ifExists ?? 'update';
      if (mode === 'report') {
        return result('Launch Film', copyBase(), { created: false, existed: true, mode: 'report', changes: [], notes: ["A plan named 'Launch Film' already exists; nothing was changed. Pass ifExists 'update' to apply the list."] });
      }
      const merged = copyBase();
      const changes = [];
      for (const s of args.scenes) {
        const hit = merged.find((p) => p.name.toLowerCase() === bare(s.name).toLowerCase());
        if (hit) {
          const f = framesOf(s);
          if (s.notes !== undefined && s.notes !== hit.notes) { hit.notes = s.notes; changes.push({ scene: hit.name, change: 'notes' }); }
          if (f !== hit.frames) { changes.push({ scene: hit.name, change: 'duration', fromFrames: hit.frames, toFrames: f, transitionsRebuilt: 1 }); hit.frames = f; }
        } else {
          merged.push({ name: s.name, frames: framesOf(s), overlap: 0, notes: s.notes ?? '', transition: s.transition ?? null, compId: 64 });
          changes.push({ scene: s.name, change: 'inserted', position: merged.length });
        }
      }
      const kept = merged.filter((p) => !args.scenes.some((s) => bare(s.name).toLowerCase() === p.name.toLowerCase())).map((p) => p.name);
      return result('Launch Film', merged, { created: false, existed: true, mode: 'update', changes, kept, orderDiffers: false, notes: [] });
    }
    const notes = plan[plan.length - 1].transition ? ["The last scene's transition has no next scene to go to; it is stored for later."] : [];
    return result(args.filmName, plan, { created: true, existed: false, mode: 'created', foldersCreated: [args.filmName, args.folderName ?? 'Scenes'], changes: [], notes }, fps, [args.width ?? 1920, args.height ?? 1080], args.folderName ?? 'Scenes');
  },

  listScenes: () => {
    const r = result('Launch Film', copyBase());
    return {
      composition: r.composition,
      isPlan: true,
      scenesFolder: r.scenesFolder,
      rule: r.rule,
      count: r.count,
      scenes: r.scenes,
      gaps: [],
      overlaps: [{ outgoing: '02 Feature', incoming: '03 Outro', startFrame: 210, frames: 15 }],
      issues: [],
      unplaced: [{ id: 65, name: '04 Spare' }],
      transitions: [{ id: 'tmock1', kind: 'match-cut', cutFrame: 90, outgoing: '01 Intro', incoming: '02 Feature' }],
      totalDuration: r.totalDuration,
      totalFrames: r.totalFrames,
    };
  },

  setSceneDuration: (args) => {
    const idx = findScene(args.scene);
    const plan = copyBase();
    const before = sequence(copyBase())[idx];
    const frames = framesOf(args);
    const delta = frames - plan[idx].frames;
    if (delta === 0) return { composition: { id: 50, name: 'Launch Film' }, changed: false, scene: before, deltaFrames: 0, transitionsRebuilt: [], notes: [`The scene already lasts ${frames} frames.`] };
    plan[idx].frames = frames;
    const after = sequence(plan.map((p) => ({ ...p })))[idx];
    const later = sequence(copyBase()).slice(idx + 1).map((s) => s.name);
    const rebuilt = idx <= 1 ? [{ previousId: 'tmock1', id: 'tmock2', kind: 'match-cut', cutFrame: idx === 0 ? frames : 90 }] : [];
    const r = result('Launch Film', plan, {
      changed: true,
      scene: { before, after },
      deltaFrames: delta,
      layersExtended: delta > 0 ? ['Background', 'Scene Notes'] : [],
      moved: { scenes: later, others: args.rippleOtherLayers === false ? [] : [{ name: 'Music', role: 'other' }], markers: 0 },
      transitionsRebuilt: rebuilt,
      notes: [],
    });
    r.masterLength = { before: 9.5, after: r.composition.duration, afterFrames: r.composition.durationFrames };
    return r;
  },

  insertScene: (args) => {
    const plan = copyBase();
    let k = plan.length;
    if (args.after !== undefined) k = findScene(args.after) + 1;
    else if (args.before !== undefined) k = findScene(args.before);
    else if (args.position !== undefined) k = Math.min(plan.length, args.position - 1);
    const frames = framesOf(args);
    const removed = k > 0 && k < plan.length && k === 1
      ? [{ id: 'tmock1', kind: 'match-cut', cutFrame: 90, outgoing: '01 Intro', incoming: '02 Feature', args: { kind: 'match-cut', framesOut: 10, framesIn: 10 } }]
      : [];
    plan.splice(k, 0, { name: args.name, frames, overlap: args.overlapFrames ?? 0, notes: args.notes ?? '', transition: args.transition ?? null, compId: 64 });
    const renames = plan.slice(k + 1).map((p, i) => ({ from: numbered(k + 1 + i, p.name, plan.length - 1), to: numbered(k + 2 + i, p.name, plan.length) }));
    const r = result('Launch Film', plan, {
      renames,
      deltaFrames: k < plan.length - 1 ? frames - (args.overlapFrames ?? 0) : 0,
      moved: { scenes: plan.slice(k + 1).map((p, i) => numbered(k + 2 + i, p.name, plan.length)), others: [], markers: 0 },
      transitionsRemoved: removed,
      notes: removed.length ? ["The transition between '01 Intro' and '02 Feature' was removed because they are no longer neighbours; transitionsRemoved has its arguments."] : [],
    });
    r.scene = r.scenes[k];
    r.masterLength = { before: 9.5, after: r.composition.duration, afterFrames: r.composition.durationFrames };
    return r;
  },

  removeScene: (args) => {
    const idx = findScene(args.scene);
    const all = sequence(copyBase());
    const info = all[idx];
    const plan = copyBase();
    const next = idx + 1 < plan.length ? all[idx + 1] : null;
    plan.splice(idx, 1);
    const removed = idx <= 1 ? [{ id: 'tmock1', kind: 'match-cut', cutFrame: 90, outgoing: '01 Intro', incoming: '02 Feature', args: { kind: 'match-cut', framesOut: 10, framesIn: 10 } }] : [];
    const renames = plan.slice(idx).map((p, i) => ({ from: numbered(idx + 2 + i, p.name, plan.length + 1), to: numbered(idx + 1 + i, p.name, plan.length) }));
    const r = result('Launch Film', plan, {
      removed: info,
      compDeleted: !!args.deleteComp,
      renames,
      deltaFrames: next ? info.inFrame - next.inFrame : 0,
      moved: { scenes: plan.slice(idx).map((p, i) => numbered(idx + 1 + i, p.name, plan.length)), others: [], markers: 0 },
      layersInRemovedSpan: [],
      transitionsRemoved: removed,
      notes: [],
    });
    r.masterLength = { before: 9.5, after: r.composition.duration, afterFrames: r.composition.durationFrames };
    return r;
  },

  addReferenceOverlay: (args) => {
    const name = args.path ? args.path.split('/').pop() : (args.item?.name ?? 'reference.mp4');
    const item = { id: 90, name, type: 'footage', parentFolder: 'References', parentFolderId: 91, width: 1280, height: 720, duration: 8, hasVideo: true, hasAudio: true, file: args.path ?? '/refs/reference.mp4', usedIn: 1 };
    const fit = args.fit ?? 'contain';
    const s = fit === 'none' ? [100, 100] : fit === 'stretch' ? [150, 150] : [150, 150];
    const startFrame = args.startFrame ?? Math.round((args.startTime ?? 0) * FPS);
    const layerName = args.name ?? `Reference: ${name}`;
    const base = { composition: { id: 1, name: 'Main Comp' }, item, imported: !!args.path, fit: { mode: fit, scale: s, sourceSize: [1280, 720] }, startTime: round(startFrame / FPS), startFrame, notes: [] };
    if (!args.sideBySide) {
      return {
        ...base,
        mode: 'overlay',
        layer: {
          index: 1, id: 400, name: layerName, type: 'footage', enabled: true, locked: args.locked ?? true, shy: false, solo: false,
          inPoint: round(startFrame / FPS), outPoint: round(startFrame / FPS + 8), startTime: round(startFrame / FPS), isGuide: true,
          blendMode: args.blendMode ?? 'normal', label: args.label ?? 'red', comment: '[reference]',
          transform: { position: [960, 540], anchorPoint: [640, 360], scale: [...s, 100], rotation: 0, opacity: args.opacity },
        },
      };
    }
    const left = (args.referenceSide ?? 'left') === 'left';
    const gap = args.gap ?? 0;
    return {
      ...base,
      mode: 'side-by-side',
      reviewComp: { id: 92, name: 'Main Comp Review', width: 3840 + gap, height: 1080, frameRate: FPS, duration: 10, durationFrames: 300, numLayers: args.labels === false ? 2 : 4 },
      layers: {
        reference: { index: args.labels === false ? 1 : 3, id: 401, name: layerName },
        comp: { index: args.labels === false ? 2 : 4, id: 402, name: 'Main Comp' },
        labels: args.labels === false ? [] : [{ index: 2, id: 403, name: 'Label: Reference' }, { index: 1, id: 404, name: 'Label: Main Comp' }],
      },
      referenceSide: left ? 'left' : 'right',
    };
  },
};
