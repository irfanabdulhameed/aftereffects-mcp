/*
 * Project-level tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { defineTool } from './registry.js';

const ItemRef = z
  .object({
    id: z.number().int().optional().describe('Project item id from get-project-info or list-project-items.'),
    name: z.string().optional().describe('Item name, exact then case-insensitive.'),
    index: z.number().int().positive().optional().describe('1-based index in the Project panel.'),
  })
  .describe('Which project item. Precedence: id, then index, then name.');

export function registerProjectTools(server: McpServer): void {
  defineTool(server, {
    name: 'get-project-info',
    group: 'project',
    mutating: false,
    description:
      'Reads the open After Effects project: file name and path, whether it has unsaved changes, colour depth, working colour space, expression engine, time display, item counts, the full item tree (compositions, footage, folders, solids with ids and parent folders), and the active composition summary. ' +
      'Use when: starting work, so you know what exists before creating anything, and to get composition ids. ' +
      'Do not use for: layer lists (use list-layers) or composition details (use get-composition-info). ' +
      'Inputs: maxItems (optional) caps the item tree; omit it for everything. ' +
      'Returns: projectName, path, saved, itemCounts, items[] with {id, name, type, parentFolder}, activeComp. ' +
      'Notes: read-only. A project with thousands of items returns a large payload; pass maxItems then list-project-items with a type filter. ' +
      'Example: get-project-info, then list-layers on the active composition.',
    input: { maxItems: z.number().int().positive().optional().describe('Maximum number of items to return. Omit for all.') },
  });

  defineTool(server, {
    name: 'list-project-items',
    group: 'project',
    mutating: false,
    description:
      'Lists project items with an optional type filter and folder scope. ' +
      'Use when: you need footage or folder ids for import, replace-footage, add-footage-to-composition or move-item-to-folder, or to inspect one folder. ' +
      'Do not use for: compositions with layer details (use list-compositions and get-composition-info). ' +
      'Inputs: type, one of comp, footage, folder, solid, placeholder or all (default all); folder, an ItemRef to list only that folder\'s direct children. ' +
      'Returns: count and items[] with id, name, type, index, parent folder, and for footage the file path, size, duration and how many comps use it. ' +
      'Notes: read-only. ' +
      'Example: list-project-items with type "footage" to find the clip to place in a comp.',
    input: {
      type: z.enum(['all', 'comp', 'footage', 'folder', 'solid', 'placeholder']).optional().describe('Filter by item type. Default all.'),
      folder: ItemRef.optional().describe('Only items directly inside this folder.'),
    },
  });
}
