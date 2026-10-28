/*
 * Looks and backgrounds: named, proven effect stacks applied in one call, and
 * generated backgrounds that loop seamlessly.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color } from '../schemas/color.js';
import { CompRef, LayerRef } from '../schemas/common.js';
import { defineTool, invokeTool } from './registry.js';

export const LOOKS = ['glow', 'bloom', 'grain', 'vignette', 'light-sweep', 'frosted-glass', 'soft-shadow', 'motion-blur'] as const;
export const BACKGROUND_STYLES = ['mesh-gradient', 'aurora', 'grid', 'dots', 'noise', 'grain'] as const;

export function registerLookTools(server: McpServer): void {
  defineTool(server, {
    name: 'apply-look',
    group: 'looks',
    description:
      'Applies a named look with proven values to a layer, or to a new adjustment layer over the whole comp: glow (a tight plus a wide glow, never one), bloom (soft highlight bloom), grain (mono noise 4 %), vignette, light-sweep (a sharp streak crossing a logo, title or card), frosted-glass (an adjustment copy of a card that blurs what is behind it inside its shape), soft-shadow (a 6 % UI drop shadow as a layer style) or motion-blur (comp and layer switches, shutter 180). ' +
      'Use when: a title, card or scene needs a finish quickly and correctly. Do not use for: a single effect with your own values (apply-effect) or one of the 33 effect templates (apply-effect-template). ' +
      'Inputs: look; layer (default a new adjustment layer "Look · <name>" for glow, bloom, grain and vignette; required for light-sweep, frosted-glass and soft-shadow; motion-blur without layer covers every layer); intensity, a multiplier for strength (default 1); startTime or startFrame and duration (light-sweep: default the layer in point and 0.8 s). ' +
      'Returns: the layer used or created, the effects added and notes on dialling it in. ' +
      'Notes: judge glow on black; grain stays off product UI; frosted glass needs a semi-transparent card. Undoable in one step. ' +
      'Example: look "light-sweep", layer {name: "Logo"}, startTime 2.',
    input: {
      comp: CompRef.optional(),
      look: z.enum(LOOKS),
      layer: LayerRef.optional(),
      intensity: z.number().min(0).max(5).optional().describe('Strength multiplier. Default 1.'),
      startTime: z.number().optional().describe('light-sweep: seconds. Default the layer in point.'),
      startFrame: z.number().int().optional().describe('Frames; wins over startTime.'),
      duration: z.number().positive().optional().describe('light-sweep: seconds. Default 0.8.'),
      durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
    },
    handler: async (args, ctx) => {
      if (args.look === 'soft-shadow') {
        if (!args.layer) throw new Error('soft-shadow needs layer: the card or panel that casts it.');
        const k = args.intensity ?? 1;
        const settings = { color: '#000000', opacity: Math.min(100, Math.round(6 * k * 10) / 10), angle: 90, distance: Math.round(12 * k), size: Math.round(40 * k) };
        const r = await invokeTool('add-layer-style', { comp: args.comp, layer: args.layer, kind: 'drop-shadow', settings });
        return r;
      }
      return ctx.run('applyLook', args as Record<string, unknown>);
    },
  });

  defineTool(server, {
    name: 'create-background',
    group: 'looks',
    timeout: 'render',
    description:
      'Generates a moving background as its own comp, placed at the bottom of the target comp, that loops seamlessly: mesh-gradient (four colours drifting on orbits with a slow turbulent flow), aurora (blurred colour blobs with a liquid wave), grid (thin lines drifting, faded at the edges), dots (a dot grid drifting, faded at the edges), noise (soft fractal clouds in two colours) or grain (a flat colour with mono grain, never a dead flat background). ' +
      'Use when: a scene, title or UI shot needs a background that is alive but quiet. Do not use for: a still solid (create-solid-layer) or footage. ' +
      'Inputs: style; colors, the first is the base (defaults: dark navy with the brand blue, violet and cyan); loop in seconds (default the comp duration) and cycles per loop (default 1, more = faster); cellSize for grid (80) and dots (40); grain percent (default 3, grain style 6, 0 for none); name. ' +
      'Returns: the background comp, the layer in the target comp, loop length, colours and notes. ' +
      'Notes: every move is driven by expressions over the loop length, so the last frame meets the first. Soft gradients band less at 16 bpc. Undoable in one step. ' +
      'Example: style "aurora", colors ["#08090F", "#3358F2", "#8B5CF6", "#22D3EE"], loop 8.',
    input: {
      comp: CompRef.optional(),
      style: z.enum(BACKGROUND_STYLES),
      colors: z.array(Color).min(1).max(4).optional().describe('Base colour first, then accents.'),
      loop: z.number().positive().optional().describe('Loop length in seconds. Default the comp duration.'),
      cycles: z.number().int().min(1).max(20).optional().describe('Cycles per loop. Default 1.'),
      cellSize: z.number().positive().max(1000).optional().describe('grid and dots: spacing in pixels.'),
      grain: z.number().min(0).max(30).optional().describe('Mono grain percent. Default 3 (grain style 6); 0 for none.'),
      name: z.string().min(1).optional().describe('Name of the background comp and layer.'),
    },
  });
}

