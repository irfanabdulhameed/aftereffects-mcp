/*
 * Mock result shapes for the project command group. See core.js for helpers and shapes to mirror.
 * Shapes mirror src/scripts/commands/project.jsx.
 */

const fail = (message, code) => Object.assign(new Error(message), { mcpCode: code });

const compRef = () => ({ id: 1, name: 'Main Comp' });

const footageItem = (over = {}) => ({
  id: 2,
  name: 'clip.mov',
  type: 'footage',
  parentFolder: 'Footage',
  parentFolderId: 3,
  width: 1920,
  height: 1080,
  duration: 12.5,
  hasVideo: true,
  hasAudio: true,
  file: '/mock/media/clip.mov',
  usedIn: 1,
  ...over,
});

const folderItem = (over = {}) => ({ id: 3, name: 'Footage', type: 'folder', parentFolder: null, parentFolderId: null, numItems: 1, ...over });

const compItem = (over = {}) => ({ id: 1, name: 'Main Comp', type: 'comp', parentFolder: null, parentFolderId: null, width: 1920, height: 1080, duration: 10, frameRate: 30, numLayers: 3, ...over });

/** The mock project has two footage items (id 2 in use, id 5 unused), one folder (3), one comp (1). */
function resolveItem(ref) {
  const r = typeof ref === 'number' ? { id: ref } : typeof ref === 'string' ? { name: ref } : ref ?? {};
  const table = [compItem(), footageItem(), folderItem(), footageItem({ id: 5, name: 'unused.png', file: '/mock/media/unused.png', usedIn: 0, hasAudio: false, duration: 0 })];
  let hit;
  if (r.id !== undefined) hit = table.find((t) => t.id === r.id);
  else if (r.index !== undefined) hit = table[r.index - 1];
  else if (r.name !== undefined) hit = table.find((t) => t.name === r.name) ?? table.find((t) => t.name.toLowerCase() === String(r.name).toLowerCase());
  else throw fail('Item reference needs {id}, {name} or {index}.', 'invalid-argument');
  if (!hit) throw fail(`No project item matching ${JSON.stringify(r)}.`, 'not-found');
  return hit;
}

const saveResult = (path, extra = {}) => ({ projectName: path.split('/').pop(), path, saved: true, numItems: 4, ...extra });

const importedItem = (path, args) => {
  const name = path.split('/').pop();
  const layered = /\.(psd|ai)$/i.test(name);
  const isAep = /\.aep$/i.test(name);
  if (!path.startsWith('/')) throw fail(`File not found: ${path}`, 'not-found');
  if (args.importAs && args.importAs !== 'footage' && !layered) throw fail(`'${name}' cannot be imported as '${args.importAs}'.`, 'unsupported');
  const importedAs = args.importAs ?? (isAep ? 'project' : 'footage');
  if (isAep) return { item: folderItem({ id: 20, name, numItems: 3, parentFolder: args.folder ? 'Footage' : null, parentFolderId: args.folder ? 3 : null }), path, importedAs, isSequence: false };
  if (importedAs !== 'footage') return { item: compItem({ id: 21, name, numLayers: 4, parentFolder: args.folder ? 'Footage' : null, parentFolderId: args.folder ? 3 : null }), path, importedAs, isSequence: false };
  const audio = /\.(wav|mp3|aif|aiff|m4a)$/i.test(name);
  return {
    item: footageItem({ id: 22, name: args.name ?? name, file: path, usedIn: 0, hasVideo: !audio, hasAudio: audio, width: audio ? null : 1920, height: audio ? null : 1080, isStill: /\.(png|jpg|jpeg|tif)$/i.test(name) && !args.sequence, frameRate: audio ? null : 30, parentFolder: args.folder ? 'Footage' : null, parentFolderId: args.folder ? 3 : null }),
    path,
    importedAs,
    isSequence: !!args.sequence,
  };
};

export const responses = {
  saveProject: (args) => {
    if (args.path) return saveResult(/\.aep$/i.test(args.path) ? args.path : args.path + '.aep', { existed: false });
    return saveResult('/mock/mock.aep', { existed: true });
  },
  saveProjectAs: (args) => {
    if (!args.path) throw fail("Missing required argument 'path'.", 'invalid-argument');
    const path = /\.aep$/i.test(args.path) ? args.path : args.path + '.aep';
    if (path === '/mock/existing.aep' && !args.overwrite) throw fail(`A file already exists at ${path}. Pass overwrite: true to replace it, or choose another path.`, 'invalid-argument');
    return saveResult(path, { existed: path === '/mock/existing.aep' });
  },
  newProject: (args) => {
    if (!args.confirm) throw fail('new-project closes the open project. Pass confirm: true to continue.', 'invalid-argument');
    if (!args.discardChanges) throw fail("The open project 'mock.aep' has unsaved changes. Call save-project (or save-project-as) first, or pass discardChanges: true to start a new project and lose them.", 'invalid-argument');
    return { projectName: 'Untitled Project', path: null, saved: false, numItems: 0, discarded: true, previousPath: '/mock/mock.aep' };
  },
  openProject: (args) => {
    if (!args.path || !args.path.startsWith('/')) throw fail(`Project file not found: ${args.path}`, 'not-found');
    if (!args.discardChanges) throw fail("The open project 'mock.aep' has unsaved changes. Call save-project (or save-project-as) first, or pass discardChanges: true to open another project and lose them.", 'invalid-argument');
    return {
      projectName: args.path.split('/').pop(),
      path: args.path,
      saved: true,
      numItems: 4,
      itemCounts: { compositions: 1, footage: 2, folders: 1, solids: 0, placeholders: 0 },
      compositions: [compRef()],
      activeComp: compRef(),
      discarded: true,
    };
  },
  createFolder: (args) => {
    const parent = args.parent ? resolveItem(args.parent) : null;
    return { item: folderItem({ id: 9, name: args.name, parentFolder: parent ? parent.name : null, parentFolderId: parent ? parent.id : null, numItems: 0 }) };
  },
  moveItemToFolder: (args) => {
    const item = resolveItem(args.item);
    if (!args.root && !args.folder) throw fail('Pass folder (an ItemRef of a folder) or root: true.', 'invalid-argument');
    const target = args.root ? { id: 0, name: null } : resolveItem(args.folder);
    if (target.id === item.id) throw fail(`Cannot move folder '${item.name}' into itself.`, 'invalid-argument');
    return { item: { ...item, parentFolder: target.name, parentFolderId: target.id || null }, previousFolder: item.parentFolderId ? { id: item.parentFolderId, name: item.parentFolder } : null };
  },
  renameItem: (args) => {
    const item = resolveItem(args.item);
    return { item: { ...item, name: args.newName }, previousName: item.name };
  },
  deleteItem: (args) => {
    const item = resolveItem(args.item);
    const usage = item.usedIn ? [compRef()] : [];
    const numLayers = item.type === 'comp' ? item.numLayers : null;
    const numItems = item.type === 'folder' ? item.numItems : null;
    const reasons = [];
    if (usage.length) reasons.push(`it is used in ${usage.length} composition(s): Main Comp`);
    if (numLayers) reasons.push(`it is a composition with ${numLayers} layer(s)`);
    if (numItems) reasons.push(`it is a folder containing ${numItems} item(s)`);
    if (reasons.length && !args.force) throw Object.assign(fail(`Refusing to delete '${item.name}' because ${reasons.join(' and ')}. Pass force: true to delete it anyway.`, 'invalid-argument'), { mcpDetails: { usedIn: usage, numLayers, numItems } });
    return { removed: { id: item.id, name: item.name, type: item.type }, usedInCount: usage.length, usedIn: usage, numLayers, numItems, forced: !!args.force && reasons.length > 0 };
  },
  importFile: (args) => {
    if (args.folder) resolveItem(args.folder);
    return importedItem(args.path, args);
  },
  importFilesBulk: (args) => {
    if (args.folder) resolveItem(args.folder);
    const continueOnError = args.continueOnError !== false;
    const results = [];
    let imported = 0, failed = 0;
    for (let i = 0; i < args.paths.length; i++) {
      const path = args.paths[i];
      try {
        const r = importedItem(path, args);
        results.push({ path, status: 'ok', item: r.item, importedAs: r.importedAs, isSequence: r.isSequence });
        imported++;
      } catch (err) {
        results.push({ path, status: 'error', error: { message: err.message, code: err.mcpCode ?? 'script-error' } });
        failed++;
        if (!continueOnError) {
          for (let j = i + 1; j < args.paths.length; j++) results.push({ path: args.paths[j], status: 'skipped' });
          break;
        }
      }
    }
    return { count: args.paths.length, imported, failed, skipped: args.paths.length - imported - failed, results };
  },
  replaceFootage: (args) => {
    const item = resolveItem(args.item);
    if (item.type !== 'footage') throw fail(`Item '${item.name}' is not footage.`, 'invalid-argument');
    if (!args.path.startsWith('/')) throw fail(`File not found: ${args.path}`, 'not-found');
    return { item: { ...item, name: item.name, file: args.path, frameRate: 30 }, previousFile: item.file, isSequence: !!args.sequence };
  },
  reduceProject: (args) => {
    if (!args.confirm) throw fail('reduce-project deletes every item not used by the listed compositions. Pass confirm: true to continue.', 'invalid-argument');
    return { removed: 2, kept: (args.comps ?? []).map((c, i) => ({ id: c.id ?? i + 1, name: c.name ?? 'Main Comp' })), numItems: 2 };
  },
  removeUnusedFootage: () => ({ removed: 1, numItems: 3 }),
  collectFiles: (args) => {
    if (!args.dryRun) throw fail('Collect Files has no scripting API in After Effects; it is only available through File > Dependencies > Collect Files, which opens a dialog. Call collect-files with dryRun: true to get the list of referenced files and copy them yourself.', 'unsupported');
    return {
      supported: false,
      projectPath: '/mock/mock.aep',
      count: 2,
      files: [
        { id: 2, name: 'clip.mov', path: '/mock/media/clip.mov', exists: true, isSequence: false, usedIn: 1 },
        { id: 5, name: 'unused.png', path: '/mock/media/unused.png', exists: false, isSequence: false, usedIn: 0 },
      ],
      missing: ['/mock/media/unused.png'],
      message: 'After Effects exposes no Collect Files API. Copy these files next to the project yourself, or use File > Dependencies > Collect Files in the application.',
    };
  },
};
