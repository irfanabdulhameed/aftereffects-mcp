/*
 * Composition tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef } from '../schemas/common.js';
import { defineTool } from './registry.js';

export const COMP_PRESETS = ['1080p30', '1080p25', '1080p24', '1080p60', '4k30', '4k25', '4k24', '4k60', '720p30', 'square1080', 'vertical1080', 'motion-graphics-template'] as const;

export function registerCompositionTools(server: McpServer): void {
  defineTool(server, {
    name: 'create-composition',
    group: 'composition',
    description:
      'Creates a new composition and, by default, opens it in the viewer so it becomes the active composition for the tools that follow. ' +
      'Use when: starting a new piece or a precomp from scratch. Do not use for: nesting an existing comp (use add-composition-as-layer) or changing an existing comp (use set-composition-settings). ' +
      'Inputs: name; a preset such as "1080p30", "4k24", "square1080" or "vertical1080" that fills width, height and frameRate; any explicit width, height, frameRate override the preset; duration in seconds or durationFrames; pixelAspect (default 1); backgroundColor in any colour form; motionBlur; folder to file it in. ' +
      'Returns: the composition summary with id, size, frame rate, duration in seconds and frames, background colour. ' +
      'Notes: undoable in one step. Names need not be unique in After Effects, so keep the returned id. ' +
      'Example: name "Intro", preset "1080p30", duration 6, backgroundColor "#101014".',
    input: {
      name: z.string().describe('Composition name.'),
      preset: z.enum(COMP_PRESETS).optional().describe('Size and frame rate preset. Explicit values override it.'),
      width: z.number().int().min(4).max(30000).optional().describe('Pixels. Default 1920 or the preset.'),
      height: z.number().int().min(4).max(30000).optional().describe('Pixels. Default 1080 or the preset.'),
      frameRate: z.number().positive().max(240).optional().describe('Frames per second. Default 30 or the preset.'),
      duration: z.number().positive().optional().describe('Seconds. Default 10.'),
      durationFrames: z.number().int().positive().optional().describe('Duration in frames; wins over duration.'),
      pixelAspect: z.number().positive().optional().describe('Pixel aspect ratio. Default 1.'),
      backgroundColor: Color.optional().describe('Composition background colour.'),
      motionBlur: z.boolean().optional().describe('Enable the comp motion blur switch.'),
      folder: z.object({ id: z.number().int().optional(), name: z.string().optional() }).optional().describe('Project folder to place the comp in.'),
      openInViewer: z.boolean().optional().describe('Open the comp in the viewer so it becomes active. Default true.'),
    },
  });

  defineTool(server, {
    name: 'list-compositions',
    group: 'composition',
    mutating: false,
    description:
      'Lists every composition in the project with id, name, size, frame rate, duration, layer count, background colour, parent folder, and how many other comps use it. Also reports which composition is active. ' +
      'Use when: you need a composition id or name for comp references, or to see the structure of a project. ' +
      'Do not use for: layers inside a comp (use list-layers). ' +
      'Inputs: includeUsage (default true) adds the used-in count, which costs a little time on big projects. ' +
      'Returns: count, activeComp, compositions[]. ' +
      'Notes: read-only. ' +
      'Example: list-compositions, then pass {name: "Lower Third"} as comp to other tools.',
    input: { includeUsage: z.boolean().optional().describe('Include how many comps use each comp. Default true.') },
  });

  defineTool(server, {
    name: 'get-composition-info',
    group: 'composition',
    mutating: false,
    description:
      'Returns everything about one composition: dimensions, duration, frame rate and frame duration, work area, background colour, motion blur settings (shutter angle, phase, samples), resolution factor, display start time, a short layer list, nested compositions, comp markers, and the used-in count. ' +
      'Use when: before animating in a comp, to know its frame rate and size, or to check the work area before rendering. ' +
      'Do not use for: full layer property trees (use get-layer-details). ' +
      'Inputs: comp (optional, defaults to the active composition). ' +
      'Returns: the composition summary plus layers[], nestedCompositions[], markers[]. ' +
      'Notes: read-only. ' +
      'Example: get-composition-info to learn frameRate 25 before converting frames to seconds.',
    input: { comp: CompRef.optional() },
  });
}
