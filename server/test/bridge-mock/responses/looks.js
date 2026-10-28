/*
 * Mock result shapes for the looks commands.
 */

export const responses = {
  applyLook: (args) => {
    if (['light-sweep', 'frosted-glass'].includes(args.look) && !args.layer) throw Object.assign(new Error(`${args.look} needs layer.`), { mcpCode: 'invalid-argument' });
    return {
      composition: { id: 1, name: 'Main Comp' },
      look: args.look,
      layer: args.layer ? { index: 1, id: 5, name: args.layer.name ?? 'Layer' } : null,
      created: args.layer ? null : { index: 1, id: 40, name: `Look · ${args.look}` },
      effects: args.look === 'glow' ? ['Glow Tight', 'Glow Wide'] : [args.look],
      intensity: args.intensity ?? 1,
      notes: [],
    };
  },
  createBackground: (args) => ({
    composition: { id: 1, name: 'Main Comp' },
    style: args.style,
    background: { id: 41, name: args.name ?? `Background · ${args.style}` },
    layer: { index: 3, id: 42, name: args.name ?? `Background · ${args.style}` },
    loop: args.loop ?? 10,
    cycles: args.cycles ?? 1,
    colors: [],
    grain: args.grain ?? 3,
    notes: [],
  }),
};
