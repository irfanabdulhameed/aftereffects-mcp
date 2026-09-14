/*
 * Project-level tools: reading the project, saving and opening, folders,
 * items, importing and replacing footage, and project cleanup.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CompRef } from '../schemas/common.js';
import { defineTool, jsonResult } from './registry.js';

export const ItemRef = z
  .object({
    id: z.number().int().optional().describe('Project item id from get-project-info or list-project-items.'),
    name: z.string().optional().describe('Item name, exact then case-insensitive.'),
    index: z.number().int().positive().optional().describe('1-based index in the Project panel.'),
  })
  .describe('Which project item. Precedence: id, then index, then name.');
export type ItemRefInput = z.input<typeof ItemRef>;

export const IMPORT_AS = ['footage', 'comp', 'comp-retain-layer-sizes'] as const;

/** Options shared by import-file and import-files-bulk. */
const ImportOptionFields = {
  importAs: z
    .enum(IMPORT_AS)
    .optional()
    .describe('For layered files (PSD, AI): "footage" flattens, "comp" makes a composition with document-sized layers, "comp-retain-layer-sizes" crops each layer to its content. Default: the file type default.'),
  sequence: z.boolean().optional().describe('Import numbered still images as one image sequence. Default false.'),
  forceAlphabetical: z.boolean().optional().describe('With sequence, order frames alphabetically instead of by number. Default false.'),
  folder: ItemRef.optional().describe('Project folder to file the imported item in. Default: the project root.'),
};

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

  defineTool(server, {
    name: 'save-project',
    group: 'project',
    description:
      'Saves the open project to the file it was loaded from, the same as File > Save. An After Effects project is one .aep file that holds every composition, layer and footage link, so nothing you changed is on disk until it is saved. ' +
      'Use when: you finished a batch of edits, or before rendering, opening another project or starting a new one. ' +
      'Do not use for: choosing a new file name or location (use save-project-as). ' +
      'Inputs: path (optional) saves an untitled project to that file instead of failing; on a project that already has a file it is ignored. ' +
      'Returns: path, projectName, saved (true when no unsaved changes remain) and existed (whether the file was already on disk). ' +
      'Notes: a project that has never been saved has no file, so the call fails and tells you to use save-project-as. Saving is not undoable. ' +
      'Example: save-project after set-keyframes-bulk, then render.',
    input: { path: z.string().optional().describe('Absolute .aep path used only when the project has never been saved.') },
  });

  defineTool(server, {
    name: 'save-project-as',
    group: 'project',
    description:
      'Saves the open project to a new .aep file, creating missing folders, the same as File > Save As. After the call the project is attached to the new file, so later save-project calls write there. ' +
      'Use when: saving an untitled project for the first time, making a versioned copy such as "edit_v02.aep", or moving the project next to its footage. ' +
      'Do not use for: a quick save to the current file (use save-project). ' +
      'Inputs: path, an absolute file path; ".aep" is appended when the extension is missing; overwrite (default false) must be true to replace an existing file. ' +
      'Returns: path, projectName, saved, existed. ' +
      'Notes: footage links are stored relative to the project, so moving far away from footage folders still works but breaks if you later delete the original folder. Not undoable. ' +
      'Example: path "/Users/me/Projects/promo/promo_v03.aep".',
    input: {
      path: z.string().min(1).describe('Absolute destination path. ".aep" is appended when missing.'),
      overwrite: z.boolean().optional().describe('Replace an existing file at path. Default false.'),
    },
  });

  defineTool(server, {
    name: 'new-project',
    group: 'project',
    description:
      'Closes the open project and creates a new empty untitled one, the same as File > New > New Project. Every composition and item of the current project goes away from the workspace (the .aep file on disk is untouched). ' +
      'Use when: starting a fresh piece that shares nothing with the open project. ' +
      'Do not use for: clearing items from the current project (use delete-item or remove-unused-footage). ' +
      'Inputs: confirm must be true; discardChanges must be true when the current project has unsaved changes, otherwise the call fails so nothing is lost. ' +
      'Returns: projectName, path (null), numItems (0), and discarded (whether unsaved changes were thrown away). ' +
      'Notes: not undoable. Call save-project first if you want to keep the current work. Checked on the Node side before anything is sent, then again in After Effects. ' +
      'Example: save-project, then new-project with confirm true.',
    input: {
      confirm: z.boolean().describe('Must be true. The current project is closed.'),
      discardChanges: z.boolean().optional().describe('Throw away unsaved changes in the current project. Default false, which fails when the project is dirty.'),
    },
    handler: async (args, ctx) => {
      if (args.confirm !== true) {
        return jsonResult({ tool: 'new-project', error: 'confirmation-required', message: 'new-project closes the open project. Pass confirm: true to continue, and discardChanges: true if unsaved changes may be thrown away.' }, true);
      }
      return ctx.run('newProject', args);
    },
  });

  defineTool(server, {
    name: 'open-project',
    group: 'project',
    description:
      'Opens an .aep project file from disk, replacing the open project, the same as File > Open Project. ' +
      'Use when: switching to another project, or reopening a saved version. ' +
      'Do not use for: bringing another project\'s comps into the current one (use import-file with the .aep path, which imports it as a folder). ' +
      'Inputs: path, absolute path to an existing .aep; discardChanges must be true when the current project has unsaved changes, otherwise the call fails so nothing is lost. ' +
      'Returns: projectName, path, numItems, itemCounts, compositions[] with ids and names, and activeComp. ' +
      'Notes: fails with not-found when the file is missing. Opening is not undoable. The bridge panel stays open across the switch. ' +
      'Example: path "/Users/me/Projects/promo/promo_v02.aep".',
    input: {
      path: z.string().min(1).describe('Absolute path to an existing .aep file.'),
      discardChanges: z.boolean().optional().describe('Throw away unsaved changes in the current project. Default false.'),
    },
  });

  defineTool(server, {
    name: 'create-folder',
    group: 'project',
    description:
      'Creates a folder in the Project panel, the list of everything the project contains. Folders only organise items; they do not affect rendering. ' +
      'Use when: grouping footage, precomps or solids before importing many files, or when a tool asks for a folder ItemRef. ' +
      'Do not use for: folders on disk (use save-project-as, which creates them). ' +
      'Inputs: name; parent (optional ItemRef of an existing folder, default the project root). ' +
      'Returns: item with id, name, type "folder", parentFolder and parentFolderId. Keep the id for move-item-to-folder and import-file. ' +
      'Notes: After Effects allows duplicate folder names, so use the returned id rather than the name when several exist. Undoable in one step. ' +
      'Example: name "Footage", then import-files-bulk with folder {id}.',
    input: {
      name: z.string().min(1).describe('Folder name.'),
      parent: ItemRef.optional().describe('Existing folder to create it inside. Default: project root.'),
    },
  });

  defineTool(server, {
    name: 'move-item-to-folder',
    group: 'project',
    description:
      'Moves a project item (composition, footage, solid or folder) into a folder, or back to the project root. ' +
      'Use when: tidying the Project panel or filing an item that was imported to the root. ' +
      'Do not use for: moving layers in a composition (use move-layer). ' +
      'Inputs: item ItemRef; folder ItemRef of the destination, or root true to move to the top level (one of the two is required). ' +
      'Returns: item with its new parentFolder and parentFolderId, plus previousFolder. ' +
      'Notes: a folder cannot be moved into itself or one of its own subfolders; After Effects rejects that and the error is returned. Undoable in one step. ' +
      'Example: item {name: "clip.mov"}, folder {name: "Footage"}.',
    input: {
      item: ItemRef.describe('The item to move.'),
      folder: ItemRef.optional().describe('Destination folder.'),
      root: z.boolean().optional().describe('true moves the item to the project root instead of a folder.'),
    },
  });

  defineTool(server, {
    name: 'rename-item',
    group: 'project',
    description:
      'Renames a project item: a composition, footage, solid or folder as listed in the Project panel. ' +
      'Use when: a footage or precomp name is unclear, or after duplicating an item. ' +
      'Do not use for: layer names in a timeline (use rename-layer); renaming a footage item does not rename the file on disk. ' +
      'Inputs: item ItemRef; newName. ' +
      'Returns: item summary with the new name and previousName. ' +
      'Notes: names need not be unique, so the id stays the reliable handle. Layers that use the item keep their own names unless they still carried the source name, in which case After Effects updates them. Undoable in one step. ' +
      'Example: item {id: 12}, newName "Hero Clip".',
    input: { item: ItemRef, newName: z.string().min(1).describe('New item name.') },
  });

  defineTool(server, {
    name: 'delete-item',
    group: 'project',
    description:
      'Deletes a project item: footage, solid, folder or composition. Removing a footage item also removes every layer that uses it from every composition, and removing a folder removes everything inside it. ' +
      'Use when: cleaning out an unused import, a scratch comp or an empty folder. ' +
      'Do not use for: removing one layer from a comp (use delete-layer) or sweeping every unused footage item (use remove-unused-footage). ' +
      'Inputs: item ItemRef; force (default false) must be true when the item is used in compositions, is a composition with layers, or is a folder with contents; otherwise the call fails and lists the usage. ' +
      'Returns: removed {id, name, type}, usedInCount, and for comps numLayers. ' +
      'Notes: undoable in one step (undo tool). Check usedIn with list-project-items before forcing. ' +
      'Example: item {name: "old_take.mov"}, force true.',
    input: { item: ItemRef, force: z.boolean().optional().describe('Required when the item is in use or not empty. Default false.') },
  });

  defineTool(server, {
    name: 'import-file',
    group: 'project',
    description:
      'Imports one file from disk into the project as a footage item: video, audio, still image, image sequence, layered PSD or AI, or another .aep project (which arrives as a folder of its items). The item is only added to the Project panel; nothing is placed in a composition. ' +
      'Use when: bringing media into the project before add-footage-to-composition. ' +
      'Do not use for: swapping the file behind an existing item (use replace-footage) or many files (use import-files-bulk). ' +
      'Inputs: path (absolute); importAs for PSD and AI; sequence true with the path of the first frame to import an image sequence; forceAlphabetical; folder ItemRef; name to rename the item. ' +
      'Returns: item summary (id, name, type, size, duration, hasAudio, file path, parentFolder) plus importedAs and isSequence. ' +
      'Notes: fails with not-found when the file is missing and unsupported when the type cannot be imported the requested way. Undoable in one step. ' +
      'Example: path "/Users/me/media/logo.psd", importAs "comp-retain-layer-sizes", folder {name: "Assets"}.',
    input: {
      path: z.string().min(1).describe('Absolute path of the file to import. For a sequence, the first frame.'),
      name: z.string().optional().describe('Rename the imported item.'),
      ...ImportOptionFields,
    },
  });

  defineTool(server, {
    name: 'import-files-bulk',
    group: 'project',
    description:
      'Imports several files from disk in one call, each as its own project item, with the same options as import-file applied to all of them. ' +
      'Use when: loading a folder of clips, stills or audio at the start of a job. ' +
      'Do not use for: one file (use import-file) or for image sequences that need per-file options. ' +
      'Inputs: paths[] (absolute); importAs, sequence, forceAlphabetical, folder as in import-file; continueOnError (default true) keeps going after a failed file and reports it in the results. ' +
      'Returns: count, imported, failed, results[] with status "ok" or "error" per path, each ok entry carrying the item summary, in the order of paths. ' +
      'Notes: with continueOnError false the first failure stops the batch and the items already imported stay. Undoable in one step. ' +
      'Example: paths ["/media/a.mov", "/media/b.mov"], folder {name: "Footage"}.',
    input: {
      paths: z.array(z.string().min(1)).min(1).describe('Absolute file paths.'),
      continueOnError: z.boolean().optional().describe('Keep importing after a failure. Default true.'),
      ...ImportOptionFields,
    },
  });

  defineTool(server, {
    name: 'replace-footage',
    group: 'project',
    description:
      'Points an existing footage item at a different file on disk, keeping every layer, effect and keyframe that uses the item. ' +
      'Use when: swapping a placeholder or low-resolution clip for the final one, relinking missing footage, or updating a revised still. ' +
      'Do not use for: adding a new item (use import-file) or replacing a layer\'s source in one comp only. ' +
      'Inputs: item ItemRef of footage (not a composition or solid); path (absolute); sequence true to replace with an image sequence starting at path; forceAlphabetical. ' +
      'Returns: item summary with the new file path, size and duration, plus previousFile. ' +
      'Notes: a shorter replacement leaves layers trimmed past the new end; check outPoint with list-layers. Undoable in one step. ' +
      'Example: item {name: "hero_proxy.mov"}, path "/media/hero_final.mov".',
    input: {
      item: ItemRef,
      path: z.string().min(1).describe('Absolute path of the new file, or the first frame of a sequence.'),
      sequence: z.boolean().optional().describe('Replace with an image sequence. Default false.'),
      forceAlphabetical: z.boolean().optional().describe('With sequence, order frames alphabetically. Default false.'),
    },
  });

  defineTool(server, {
    name: 'reduce-project',
    group: 'project',
    description:
      'Removes every project item that is not used by the listed compositions or their nested compositions, the same as File > Dependencies > Reduce Project. ' +
      'Use when: preparing a delivery project that should contain only the final comps and what they need. ' +
      'Do not use for: removing only unused footage while keeping spare comps (use remove-unused-footage). ' +
      'Inputs: comps[] of CompRef to keep; confirm must be true because everything else is deleted. ' +
      'Returns: removed (number of items deleted), kept[] with ids and names, numItems after. ' +
      'Notes: undoable with the undo tool, but save-project-as a copy first on a real job. Checked on the Node side before anything is sent. ' +
      'Example: comps [{name: "Final"}], confirm true.',
    input: {
      comps: z.array(CompRef).min(1).describe('Compositions to keep.'),
      confirm: z.boolean().describe('Must be true. All other items are deleted.'),
    },
    handler: async (args, ctx) => {
      if (args.confirm !== true) {
        return jsonResult({ tool: 'reduce-project', error: 'confirmation-required', message: 'reduce-project deletes every item not used by the listed compositions. Pass confirm: true to continue.' }, true);
      }
      return ctx.run('reduceProject', args);
    },
  });

  defineTool(server, {
    name: 'remove-unused-footage',
    group: 'project',
    description:
      'Deletes every footage item that no composition uses, the same as File > Dependencies > Remove Unused Footage. Compositions, folders and used footage stay. ' +
      'Use when: tidying a project after trying several takes or imports. ' +
      'Do not use for: trimming a project down to specific comps (use reduce-project) or deleting one item (use delete-item). ' +
      'Inputs: none. ' +
      'Returns: removed (count of items deleted, 0 when nothing was unused) and numItems after. ' +
      'Notes: solids that no comp uses are footage and are removed too. Undoable in one step. ' +
      'Example: remove-unused-footage after replace-footage swapped several clips.',
    input: {},
  });

  defineTool(server, {
    name: 'collect-files',
    group: 'project',
    description:
      'Lists every file on disk that the project references so the footage can be copied next to the project. After Effects has no scripting API for File > Dependencies > Collect Files, so this tool cannot perform the copy itself. ' +
      'Use when: packaging a project for another machine; call with dryRun true, then copy the listed files yourself. ' +
      'Do not use for: removing unused items (use remove-unused-footage). ' +
      'Inputs: dryRun must be true; without it the call fails with code unsupported and explains the menu route. ' +
      'Returns: supported false, projectPath, count, files[] with {id, name, path, exists, isSequence, usedIn}, and missing[] for paths that are not on disk. ' +
      'Notes: read-only. Image sequences report the file of their first frame. Fonts and effects plugins are not listed. ' +
      'Example: dryRun true, then copy each path into a "(Footage)" folder beside the .aep.',
    input: { dryRun: z.boolean().optional().describe('true lists the referenced files. Anything else fails with unsupported.') },
    mutating: false,
  });
}
