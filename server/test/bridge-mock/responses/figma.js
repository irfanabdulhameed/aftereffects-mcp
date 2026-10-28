/*
 * Mock result shape for the Figma builder.
 */

export const responses = {
  buildFigma: (args) => {
    const made = (args.layers ?? []).map((l, i) => ({ figmaId: l.id, layer: { index: i + 1, id: 500 + i, name: l.name }, kind: l.kind }));
    const counts = {};
    for (const l of args.layers ?? []) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
    return { composition: { id: 77, name: args.frame?.name ?? 'Frame' }, created: !args.comp, width: Math.round(args.frame?.width ?? 0), height: Math.round(args.frame?.height ?? 0), counts, layerCount: made.length, made, failed: [], missingFonts: [], notes: [] };
  },
};
