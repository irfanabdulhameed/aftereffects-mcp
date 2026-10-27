/*
 * Mock result shapes for the check commands. See core.js for helpers and shapes to mirror.
 */

const comp = (id = 1, name = 'Main Comp') => ({ id, name });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });

const ALL_CHECKS = ['frame-by-frame', 'hold-ladders', 'source-text-keys', 'short-layers', 'name-stems', 'expression-errors', 'missing-footage', 'missing-fonts', 'effects', 'precomp-duration', 'outside-comp', 'key-counts'];
const RANK = { error: 0, warning: 1, info: 2 };

const finding = (check, severity, over = {}) => ({
  check,
  severity,
  comp: comp(),
  layer: layerRef(),
  property: null,
  time: null,
  frame: null,
  message: '',
  fix: '',
  ...over,
});

function sampleFindings(recurse) {
  const out = [
    finding('frame-by-frame', 'error', { layer: layerRef(2, 'Dot'), property: 'Transform/Position', time: 0.3333, frame: 10, endFrame: 57, count: 48, runs: 1, longestRun: 48, longestRunFrame: 10, message: '48 of 50 keys sit on consecutive frames (1 run, longest 48 keys from frame 10): frame-by-frame animation.', fix: 'Replace the run with 2 or 3 eased keys, an expression, or a native tool (animator, Trim Paths, time remap).' }),
    finding('expression-errors', 'error', { layer: layerRef(3, 'Title'), property: 'Transform/Opacity', enabled: false, message: 'Expression error: ReferenceError: slider is not defined', fix: 'Fix the expression (get-expression, set-expression) or remove it (remove-expression); a disabled expression must be enabled again after the fix.' }),
    finding('missing-fonts', 'error', { layer: layerRef(3, 'Title'), property: 'Text/Source Text', font: 'BrandSans-Bold', message: "Font 'BrandSans-Bold' is not installed; After Effects draws a substitute.", fix: 'Install the font, or swap it with relink-fonts (list-fonts shows what is installed).' }),
    finding('hold-ladders', 'warning', { layer: layerRef(4, 'Arrow'), property: 'Transform/Rotation', time: 1, frame: 30, endFrame: 36, count: 4, message: '4 hold keys in a row step the value: a hold-key ladder standing in for motion.', fix: 'Use two eased keys for the move; keep hold keys only for real state changes.' }),
    finding('source-text-keys', 'warning', { layer: layerRef(5, 'Typing'), property: 'Text/Source Text', time: 2, frame: 60, count: 12, message: 'Source Text has 12 keys: typing or word changes faked by swapping the text.', fix: 'Keep one text value and reveal it with a Typewriter or range-selector animator (typewriter-text, word-by-word-reveal).' }),
    finding('name-stems', 'warning', { layer: layerRef(6, 'Frame 01'), count: 3, stem: 'frame', layers: [layerRef(6, 'Frame 01'), layerRef(7, 'Frame 02'), layerRef(8, 'Frame 03')], message: "3 layers share the name stem 'frame' (Frame 01, Frame 02, ...): per-frame copies or loose copies of one object.", fix: 'Make the object one component (create-component) and place instances, or use one layer with a repeater or animator.' }),
    finding('short-layers', 'warning', { layer: layerRef(6, 'Frame 01'), time: 3, frame: 90, count: 1, message: 'Layer is only 1 frame long: usually a per-frame copy.', fix: 'Animate one layer through the whole span instead of swapping short copies (a state change is a key, not a new layer).' }),
    finding('effects', 'warning', { layer: layerRef(9, 'BG'), property: 'Effects/Glow', matchName: 'ADBE Glo2', message: "Effect 'Glow' is switched off.", fix: 'Turn it on (toggle-effect) or remove it (remove-effect) so the comp holds only what renders.' }),
    finding('outside-comp', 'info', { layer: layerRef(10, 'Old intro'), time: 12, frame: 360, endFrame: 400, message: 'Layer runs from 12 s to 13.33 s, outside the comp (0 to 10 s): it never shows.', fix: "Delete it or move it into the comp's time range (set-layer-timing)." }),
    finding('key-counts', 'info', { layer: layerRef(2, 'Dot'), property: 'Transform/Position', count: 50, message: 'Transform/Position has 50 keys (1 of the most keyed properties).', fix: 'Large key counts usually mean baked or hand-traced motion; check whether fewer eased keys or an expression would do.' }),
  ];
  if (recurse) {
    out.push(finding('precomp-duration', 'warning', { comp: comp(1, 'Main Comp'), layer: layerRef(11, 'Card'), time: 0, frame: 0, item: { id: 7, name: 'Card', duration: 4 }, message: "Precomp 'Card' is 4 s long but this layer uses it up to 6 s: it shows nothing after the end.", fix: 'Lengthen the precomp (set-composition-settings duration) or trim the layer (set-layer-timing).' }));
    out.push(finding('frame-by-frame', 'error', { comp: comp(7, 'Card'), layer: layerRef(1, 'Shine'), property: 'Effects/CC Light Sweep/Center', time: 0, frame: 0, endFrame: 5, count: 6, runs: 1, longestRun: 6, longestRunFrame: 0 }));
  }
  return out;
}

export const responses = {
  auditComposition: (args) => {
    const on = args.checks && args.checks.length ? args.checks : ALL_CHECKS;
    const all = sampleFindings(!!args.recurse).filter((f) => on.includes(f.check));
    const counts = { error: 0, warning: 0, info: 0 };
    for (const f of all) counts[f.severity]++;
    const min = RANK[args.minSeverity ?? 'info'];
    const listed = all.filter((f) => RANK[f.severity] <= min).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const max = args.limits?.maxFindings ?? 200;
    const findings = listed.slice(0, max);
    return {
      composition: comp(),
      recurse: !!args.recurse,
      checks: ALL_CHECKS.filter((c) => on.includes(c)),
      compsChecked: args.recurse ? [{ id: 1, name: 'Main Comp', depth: 0, layers: 11 }, { id: 7, name: 'Card', depth: 1, layers: 4 }] : [{ id: 1, name: 'Main Comp', depth: 0, layers: 11 }],
      summary: { ...counts, total: all.length },
      total: all.length,
      returned: findings.length,
      truncated: listed.length > findings.length,
      findings,
      keyStats: { keyedProperties: 14, totalKeys: 96, expressions: 3, top: [{ comp: comp(), layer: layerRef(2, 'Dot'), property: 'Transform/Position', numKeys: 50 }] },
      fontCheck: 'project',
      notes: [],
      durationMs: 42,
    };
  },
  purgeCaches: (args) => {
    const target = args.target ?? 'all';
    const key = { all: 'ALL_CACHES', memory: 'ALL_MEMORY_CACHES', undo: 'UNDO_CACHES', image: 'IMAGE_CACHES', snapshot: 'SNAPSHOT_CACHES' }[target];
    const notes = target === 'all' || target === 'undo' ? ['The undo history was cleared: earlier steps can no longer be undone.'] : [];
    return { target, purgeTarget: key, memoryInUseBefore: 6442450944, memoryInUseAfter: 2147483648, freedBytes: 4294967296, aeVersion: '24.6.0 (mock)', notes };
  },
  saveVersion: (args) => {
    const clean = args.note ? String(args.note).trim().replace(/\s+/g, '-') : null;
    const fileName = `promo_v04${clean ? '_' + clean : ''}.aep`;
    return {
      previousPath: '/projects/promo/promo_v03.aep',
      path: `/projects/promo/${fileName}`,
      fileName,
      version: 4,
      versionWidth: 2,
      note: clean,
      skipped: [],
      saved: true,
      projectName: fileName,
    };
  },
  organizeProject: (args) => {
    const names = { comps: 'Comps', precomps: 'Precomps', footage: 'Footage', images: 'Images', audio: 'Audio', solids: 'Solids', vectors: 'Vectors', ...(args.folderNames ?? {}) };
    const moves = [
      { item: { id: 1, name: 'Main Comp', type: 'comp' }, from: '(root)', to: names.comps },
      { item: { id: 7, name: 'Card', type: 'comp' }, from: '(root)', to: names.precomps },
      { item: { id: 12, name: 'clip.mov', type: 'footage' }, from: '(root)', to: names.footage },
      { item: { id: 13, name: 'logo.ai', type: 'footage' }, from: '(root)', to: names.vectors },
      { item: { id: 14, name: 'music.wav', type: 'footage' }, from: '(root)', to: names.audio },
    ];
    const kept = args.includeFoldered ? [] : [{ item: { id: 20, name: 'ref.png', type: 'footage' }, folder: 'References' }];
    if (args.includeFoldered) moves.push({ item: { id: 20, name: 'ref.png', type: 'footage' }, from: 'References', to: names.images });
    const counts = {};
    for (const m of moves) counts[m.to] = (counts[m.to] ?? 0) + 1;
    counts[names.solids] = 2;
    return {
      dryRun: !!args.dryRun,
      movedCount: moves.length,
      moves,
      created: [names.comps, names.precomps, names.footage, names.vectors, names.audio, ...(args.includeFoldered ? [names.images] : [])],
      keptCount: kept.length,
      kept,
      counts,
      folders: names,
      removedFolders: !args.dryRun && args.includeFoldered && args.removeEmptyFolders ? ['References'] : [],
      notes: [],
    };
  },
};
