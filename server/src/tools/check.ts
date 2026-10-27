/*
 * Project check tools (group 'check'): a construction audit of a composition
 * to run before work is shown to anyone, cache purging, saving the next
 * version of the project file, and sorting the Project panel into folders.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef } from '../schemas/common.js';
import { defineTool } from './registry.js';

export const AUDIT_CHECKS = [
  'frame-by-frame',
  'hold-ladders',
  'source-text-keys',
  'short-layers',
  'name-stems',
  'expression-errors',
  'missing-footage',
  'missing-fonts',
  'effects',
  'precomp-duration',
  'outside-comp',
  'key-counts',
] as const;

export const PURGE_TARGETS = ['all', 'memory', 'undo', 'image', 'snapshot'] as const;

export const ORGANIZE_FOLDERS = ['comps', 'precomps', 'footage', 'images', 'audio', 'solids', 'vectors'] as const;

export const AuditLimits = z
  .object({
    consecutiveKeys: z.number().int().min(2).max(100).optional().describe('Keys on consecutive frames that count as frame-by-frame. Default 3.'),
    holdKeys: z.number().int().min(2).max(100).optional().describe('Hold keys in a row that count as a ladder. Default 3.'),
    sourceTextKeys: z.number().int().min(1).max(1000).optional().describe('Source Text keys that count as typing faked by text swaps. Default 3.'),
    shortLayerFrames: z.number().int().min(0).max(100).optional().describe('Layers this many frames long or shorter are reported. Default 3.'),
    nameStemCount: z.number().int().min(2).max(1000).optional().describe('Layers sharing one name stem that are reported. Default 3.'),
    topKeyCounts: z.number().int().min(0).max(50).optional().describe('Properties with the most keys listed as info. Default 5.'),
    maxFindings: z.number().int().min(1).max(2000).optional().describe('Findings returned, most severe first. Default 200.'),
    maxDepth: z.number().int().min(1).max(10).optional().describe('Nesting depth for recurse. Default 4.'),
    maxComps: z.number().int().min(1).max(500).optional().describe('Compositions checked at most with recurse. Default 50.'),
  })
  .describe('Thresholds. Every field is optional.');

export function registerCheckTools(server: McpServer): void {
  defineTool(server, {
    name: 'audit-composition',
    group: 'check',
    timeout: 120000,
    mutating: false,
    description:
      'Checks how a composition is built and lists problems, each with severity (error, warning, info), comp, layer, property path, time and frame, and a one-line fix. Errors: frame-by-frame keys (3 or more on consecutive frames), expression errors, missing footage, fonts that are not installed. Warnings: hold-key ladders, Source Text with many keys, layers of 3 frames or less, many layers sharing one name stem, effects switched off or missing, precomps shorter than their use. Info: layers outside the comp, the properties with the most keys. ' +
      'Use when: before showing work to a person or after a large automated build. Do not use for: expression errors alone (get-expression-errors) or how a frame looks (see-frame). ' +
      'Inputs: comp; recurse into nested comps; checks to run (default all); limits; minSeverity. ' +
      'Returns: summary counts by severity, total, truncated, the comps checked, findings sorted errors first, and key statistics. ' +
      'Notes: read-only. Works from key times, never frame values, so it stays fast on large comps. Gradient colour properties are skipped. ' +
      'Example: comp {name: "Main"}, recurse true.',
    input: {
      comp: CompRef.optional(),
      recurse: z.boolean().optional().describe('Also audit every composition used as a layer, each once. Default false.'),
      checks: z.array(z.enum(AUDIT_CHECKS)).min(1).optional().describe('Checks to run. Default all.'),
      limits: AuditLimits.optional(),
      minSeverity: z.enum(['info', 'warning', 'error']).optional().describe('Lowest severity returned. Default info. The summary always counts everything.'),
    },
  });

  defineTool(server, {
    name: 'purge-caches',
    group: 'check',
    description:
      'Frees memory by purging After Effects caches, the same as Edit > Purge: all caches (RAM and, from 24.3, the disk cache), memory only, undo history, image caches or snapshots. Reports the memory in use before and after. ' +
      'Use when: after a long build or render, before rendering a time that was already cached (a stale frame can come back), or when After Effects slows down. Do not use for: removing unused project items (remove-unused-footage, reduce-project). ' +
      'Inputs: target all (default), memory (RAM only, After Effects 24.3 or later), undo, image or snapshot. ' +
      'Returns: target, the PurgeTarget used, memoryInUse before and after in bytes, the bytes freed, and notes. ' +
      'Notes: purging undo cannot be undone: every earlier step leaves the undo history. Before 24.3, all clears RAM only. Purging is not an undoable step itself. ' +
      'Example: target "all" after a batch of renders.',
    input: {
      target: z.enum(PURGE_TARGETS).optional().describe('What to purge. Default all.'),
    },
  });

  defineTool(server, {
    name: 'save-version',
    group: 'check',
    description:
      'Saves the project as the next version next to its current file and keeps working in the new file: name_v01.aep becomes name_v02.aep (padding kept), and a name without a version number gets _v02. An optional note is added to the file name. ' +
      'Use when: before a risky change, at a milestone, or before handing work over, so earlier versions stay on disk. Do not use for: saving in place (save-project) or choosing any path (save-project-as). ' +
      'Inputs: note, a few words added as _note (letters, digits, spaces, dots, dashes and underscores; spaces become dashes). ' +
      'Returns: previousPath, path, fileName, version, the version names skipped because they already existed, and saved. ' +
      'Notes: refuses a project that was never saved (use save-project-as first). A version that already exists is never overwritten; the next free number is used. Saving is not undoable. ' +
      'Example: note "before color pass" turns promo_v03.aep into promo_v04_before-color-pass.aep.',
    input: {
      note: z
        .string()
        .max(60)
        .regex(/^[A-Za-z0-9 ._-]*$/, 'Use letters, digits, spaces, dots, dashes and underscores only.')
        .optional()
        .describe('Short note added to the file name.'),
    },
  });

  defineTool(server, {
    name: 'organize-project',
    group: 'check',
    timeout: 60000,
    description:
      'Sorts Project panel items into folders by type: Comps (compositions no other comp uses), Precomps (compositions used inside other comps), Footage, Images, Audio, Solids and Vectors (.ai, .eps, .pdf, .svg). Existing folders with those names are reused. Items already inside other folders stay where the user put them unless asked. ' +
      'Use when: before handing a project over or when the Project panel is a long flat list. Do not use for: deleting unused items (remove-unused-footage, reduce-project) or moving one item (move-item-to-folder). ' +
      'Inputs: dryRun (default false) returns the plan only; includeFoldered (default false) also moves items that sit in user folders; folderNames to rename the target folders, for example {"precomps": "02 Precomps"}; removeEmptyFolders (default false) deletes user folders left empty by the move. ' +
      'Returns: dryRun, the moves [{item, from, to}], folders created, items kept in user folders, counts per folder, and empty folders removed. ' +
      'Notes: never renames or deletes items; nothing in a render changes. Undoable in one step. ' +
      'Example: dryRun true, then the same call without dryRun.',
    input: {
      dryRun: z.boolean().optional().describe('Only return the plan. Default false.'),
      includeFoldered: z.boolean().optional().describe('Also move items that are inside user folders. Default false.'),
      folderNames: z
        .object(Object.fromEntries(ORGANIZE_FOLDERS.map((k) => [k, z.string().min(1).max(200).optional()])) as Record<(typeof ORGANIZE_FOLDERS)[number], z.ZodOptional<z.ZodString>>)
        .optional()
        .describe('Folder names to use instead of Comps, Precomps, Footage, Images, Audio, Solids and Vectors.'),
      removeEmptyFolders: z.boolean().optional().describe('Delete user folders that end up empty. Default false.'),
    },
  });
}
