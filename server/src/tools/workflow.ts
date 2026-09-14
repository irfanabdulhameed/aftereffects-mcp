/*
 * Workflow tools: snapshots, search, find and replace, colour and font relinking.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, LABEL_COLORS } from '../schemas/common.js';
import { LAYER_TYPES } from './layers.js';
import { defineTool } from './registry.js';

const Scope = z.enum(['comp', 'project']).describe('"comp" (default) searches one composition, the given or the active one; "project" searches every composition.');

export function registerWorkflowTools(server: McpServer): void {
  defineTool(server, {
    name: 'snapshot-composition',
    group: 'batch',
    mutating: false,
    description:
      'Captures a composition as one JSON object: the composition settings, markers, and for every layer its summary, parent, the Transform property tree with values, keyframes (time, value, interpolation, ease) and expressions, each effect with its property tree, the text document for text layers, a mask summary and Time Remap. ' +
      'Use when: saving a state before a risky change, diffing two versions, or copying animation to another composition through apply-snapshot. Do not use for: a single layer (get-layer-details) or rendering (see-frame). ' +
      'Inputs: comp; depth of the property trees (default 3); includeKeyframes (default true); includeEffects (default true); includeText (default true); includeShapes (default false, shape trees are large); maxLayers (default 100). ' +
      'Returns: snapshotVersion, composition, options, layerCount, truncated, markers[], layers[]. Pass the whole object to apply-snapshot as snapshot. ' +
      'Notes: read-only. Masks, shape contents, layer order and styles are described but apply-snapshot cannot restore them. ' +
      'Example: comp {name: "Intro"}, depth 3, includeShapes false.',
    input: {
      comp: CompRef.optional(),
      depth: z.number().int().min(0).max(8).optional().describe('Property tree depth. Default 3.'),
      includeKeyframes: z.boolean().optional().describe('Default true.'),
      includeEffects: z.boolean().optional().describe('Default true.'),
      includeText: z.boolean().optional().describe('Include the text document of text layers. Default true.'),
      includeShapes: z.boolean().optional().describe('Include the Contents tree of shape layers. Default false.'),
      maxLayers: z.number().int().min(1).max(1000).optional().describe('Stop after this many layers. Default 100.'),
    },
  });

  defineTool(server, {
    name: 'apply-snapshot',
    group: 'batch',
    description:
      'Restores or copies the state captured by snapshot-composition onto a composition: for each snapshot layer it finds the target layer by name (default) or index, then writes transform values, keyframes (with interpolation and ease), expressions, effects (adding missing ones by matchName and setting their properties) and, on request, text. ' +
      'Use when: undoing changes across many layers, moving an animation to a duplicate composition, or copying a look between projects. Do not use for: one property (set-keyframes-bulk) or one effect (copy-effects). ' +
      'Inputs: comp; snapshot (the object from snapshot-composition); matchBy "name" or "index"; what {transform, effects, keyframes, expressions (all default true), text (default false)}. ' +
      'Returns: per-layer applied and unchanged counts, effects added, skipped properties with reasons, layers with no match, and the list of things a snapshot cannot restore. ' +
      'Notes: masks, shape contents, layer order, parenting, layer styles, timing and markers are not restored. Existing keys on a restored property are replaced. Not verified against a live After Effects. Undoable in one step. ' +
      'Example: snapshot from snapshot-composition, matchBy "name", what {effects: false}.',
    input: {
      comp: CompRef.optional(),
      snapshot: z.record(z.unknown()).describe('The object returned by snapshot-composition.'),
      matchBy: z.enum(['name', 'index']).optional().describe('How snapshot layers map to target layers. Default "name".'),
      what: z
        .object({
          transform: z.boolean().optional().describe('Transform values. Default true.'),
          effects: z.boolean().optional().describe('Effects and their properties. Default true.'),
          keyframes: z.boolean().optional().describe('Keyframes. Default true.'),
          expressions: z.boolean().optional().describe('Expressions. Default true.'),
          text: z.boolean().optional().describe('Source Text of text layers. Default false.'),
        })
        .optional(),
    },
  });

  defineTool(server, {
    name: 'find-layers',
    group: 'batch',
    mutating: false,
    description:
      'Searches layers in one composition or the whole project by name pattern (case-insensitive substring, or "/regex/i"), layer type, an effect they carry, expression text, whether they have expressions, enabled state, label colour and the 3D switch; all filters combine. ' +
      'Use when: locating every layer that uses a font or effect, finding expressions that reference a deleted layer, or gathering targets for a bulk change. Do not use for: listing one composition without filters (list-layers). ' +
      'Inputs: scope "comp" or "project"; namePattern; type; hasEffect (display name or matchName); expressionContains; hasExpressions; enabled; label; threeD; includeExpressions to list expressions on each match; limit (default and maximum 500). ' +
      'Returns: count, truncated, layers[] each with the composition and the layer summary, plus matchedExpressions when expressionContains is used. ' +
      'Notes: read-only. Expressions are scanned to depth 6 under Transform, Effects, Text, Contents, Masks and the option groups. ' +
      'Example: scope "project", hasEffect "ADBE Gaussian Blur 2", enabled true.',
    input: {
      scope: Scope.optional(),
      comp: CompRef.optional(),
      namePattern: z.string().optional().describe('Substring (case-insensitive) or a regular expression written as "/pattern/flags".'),
      type: z.enum(LAYER_TYPES).optional().describe('Layer type.'),
      hasEffect: z.string().optional().describe('Effect display name or matchName the layer must carry.'),
      expressionContains: z.string().optional().describe('Substring or "/regex/" that an expression on the layer must contain.'),
      hasExpressions: z.boolean().optional().describe('true: only layers with at least one expression; false: only layers without.'),
      enabled: z.boolean().optional().describe('Filter by the video switch.'),
      label: z.union([z.enum(LABEL_COLORS), z.number().int().min(0).max(16)]).optional().describe('Label colour name or index.'),
      threeD: z.boolean().optional().describe('Filter by the 3D switch.'),
      includeExpressions: z.boolean().optional().describe('List every expression on each matched layer. Default false.'),
      limit: z.number().int().min(1).max(500).optional().describe('Maximum results. Default 500.'),
    },
  });

  defineTool(server, {
    name: 'find-and-replace-text',
    group: 'batch',
    description:
      'Finds text inside every text layer of a composition or the whole project and replaces it, in static Source Text values and in every Source Text keyframe, keeping the styling. ' +
      'Use when: renaming a product across a template, fixing a typo in many titles, or previewing what would change with dryRun. Do not use for: changing one layer (set-text) or layer names (rename-layer). ' +
      'Inputs: scope "comp" or "project"; find; replace (default empty string); caseSensitive (default false); wholeWord (default false); useRegex (default false, then replace may use $1 groups); dryRun (default false) reports matches without writing. ' +
      'Returns: matchedLayers, changedLayers, totalMatches and layers[] with per-value before and after text and the key index when keyframed. ' +
      'Notes: text animators and expressions on Source Text are untouched. Undoable in one step. ' +
      'Example: scope "project", find "Acme", replace "Acme Corp", wholeWord true.',
    input: {
      scope: Scope.optional(),
      comp: CompRef.optional(),
      find: z.string().min(1).describe('Text or pattern to find.'),
      replace: z.string().optional().describe('Replacement text. Default empty (deletes the match).'),
      caseSensitive: z.boolean().optional().describe('Default false.'),
      wholeWord: z.boolean().optional().describe('Match whole words only. Default false.'),
      useRegex: z.boolean().optional().describe('Treat find as a regular expression. Default false.'),
      dryRun: z.boolean().optional().describe('Report matches without changing anything. Default false.'),
    },
  });

  defineTool(server, {
    name: 'replace-color',
    group: 'batch',
    description:
      'Swaps one colour for another across a composition: shape fills and strokes (including keyframed colours), text fill and stroke colours, solid layer colours and, on request, every colour property on effects. Colours match when their RGB distance is within a tolerance. ' +
      'Use when: rebranding a template, fixing an off-by-one colour, or previewing the affected properties with dryRun. Do not use for: a single fill (set-shape-fill) or colour grading (apply-effect-template "tint"). ' +
      'Inputs: comp; from and to in any colour form; tolerance as RGB distance in 0..1 space (default 0.02, 0 exact); includeShapes, includeText, includeSolids (default true); includeEffects (default false); dryRun. ' +
      'Returns: from and to as hex, changedCount and changes[] with the layer, the target kind, property path, key index, before and after. ' +
      'Notes: changing a solid changes every layer that uses that solid item. Alpha is kept. Gradient fills are not touched. Undoable in one step. ' +
      'Example: from "#ff0000", to "#1e90ff", tolerance 0.05, dryRun true.',
    input: {
      comp: CompRef.optional(),
      from: Color.describe('Colour to find.'),
      to: Color.describe('Replacement colour.'),
      tolerance: z.number().min(0).max(1).optional().describe('RGB distance in 0..1 space. Default 0.02.'),
      includeShapes: z.boolean().optional().describe('Shape fills and strokes. Default true.'),
      includeText: z.boolean().optional().describe('Text fill and stroke. Default true.'),
      includeSolids: z.boolean().optional().describe('Solid layer colours. Default true.'),
      includeEffects: z.boolean().optional().describe('Colour properties on effects. Default false.'),
      dryRun: z.boolean().optional().describe('Report without changing. Default false.'),
    },
  });

  defineTool(server, {
    name: 'relink-fonts',
    group: 'batch',
    description:
      'Changes the font of text layers from one PostScript font name to another across a composition or the project, including every Source Text keyframe, and reports where After Effects kept the old font. fromFont may be "*" for every text layer or "missing" for fonts After Effects has substituted. ' +
      'Use when: a template arrives with missing fonts, or the brand font changed. Do not use for: size, colour or tracking (set-text-style) or listing fonts (list-fonts). ' +
      'Inputs: scope "comp" or "project"; fromFont (PostScript name, "*" or "missing"); toFont (PostScript name from list-fonts); dryRun. ' +
      'Returns: matchedLayers, changedCount, changes[] with before and after font per layer and key, and warnings[] for values After Effects did not accept. ' +
      'Notes: "missing" needs After Effects 2023 (23.0) or later and fails with code unsupported before that. Mixed fonts inside one text layer are read as the first character\'s font. Undoable in one step. ' +
      'Example: scope "project", fromFont "missing", toFont "Inter-Regular".',
    input: {
      scope: Scope.optional(),
      comp: CompRef.optional(),
      fromFont: z.string().min(1).describe('PostScript name to replace, or "*" for all, or "missing" for substituted fonts.'),
      toFont: z.string().min(1).describe('PostScript name of the new font.'),
      dryRun: z.boolean().optional().describe('Report without changing. Default false.'),
    },
  });
}
