/*
 * Project-level commands.
 */

MCP.projectItemTree = function (maxItems) {
    var limit = MCP.isDefined(maxItems) ? Number(maxItems) : 0;
    var items = [];
    var counts = { compositions: 0, footage: 0, folders: 0, solids: 0, placeholders: 0 };
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        var type = MCP.itemType(item);
        if (type === "comp") { counts.compositions++; }
        else if (type === "folder") { counts.folders++; }
        else if (type === "solid") { counts.solids++; }
        else if (type === "placeholder") { counts.placeholders++; }
        else { counts.footage++; }
        if (!limit || items.length < limit) {
            var s = MCP.serialize.item(item);
            s.index = i;
            items.push(s);
        }
    }
    return { items: items, counts: counts, truncated: !!(limit && app.project.numItems > limit), totalItems: app.project.numItems };
};

MCP.register("getProjectInfo", function (args) {
    var project = app.project;
    var tree = MCP.projectItemTree(MCP.isDefined(args.maxItems) ? args.maxItems : 0);
    var out = {
        projectName: project.file ? project.file.name : "Untitled Project",
        path: project.file ? project.file.fsName : null,
        saved: project.file ? !project.dirty : false,
        dirty: _mcpTry(function () { return project.dirty; }, null),
        numItems: project.numItems,
        itemCounts: tree.counts,
        bitsPerChannel: project.bitsPerChannel,
        linearBlending: _mcpTry(function () { return project.linearBlending; }, null),
        workingSpace: _mcpTry(function () { return project.workingSpace; }, null),
        workingGamma: _mcpTry(function () { return project.workingGamma; }, null),
        expressionEngine: _mcpTry(function () { return project.expressionEngine; }, null),
        timeDisplayType: _mcpTry(function () { return project.timeDisplayType === TimeDisplayType.FRAMES ? "frames" : "timecode"; }, null),
        framesCountType: _mcpTry(function () { return String(project.framesCountType); }, null),
        aeVersion: app.version,
        activeComp: null,
        items: tree.items,
        itemsTruncated: tree.truncated
    };
    var ac = MCP.activeComp();
    if (ac) { out.activeComp = MCP.serialize.comp(ac); }
    return out;
}, { mutating: false });

MCP.register("listProjectItems", function (args) {
    var typeFilter = MCP.isDefined(args.type) ? String(args.type) : null;
    var folder = null;
    if (MCP.isDefined(args.folder)) { folder = MCP.resolveItem(args.folder, "folder"); }
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        var type = MCP.itemType(item);
        if (typeFilter && typeFilter !== "all" && type !== typeFilter) { continue; }
        if (folder) {
            var parent = _mcpTry(function () { return item.parentFolder; }, null);
            if (!parent || parent.id !== folder.id) { continue; }
        }
        var s = MCP.serialize.item(item);
        s.index = i;
        out.push(s);
    }
    return { count: out.length, folder: folder ? { id: folder.id, name: folder.name } : null, type: typeFilter || "all", items: out };
}, { mutating: false });

/* ------------------------------------------------------------ helpers */

MCP.project = MCP.project || {};

MCP.project.isDirty = function () {
    return _mcpTry(function () { return app.project.dirty; }, null);
};

/** Fails unless the project is clean or the caller passed discardChanges. Returns whether changes are discarded. */
MCP.project.guardUnsaved = function (args, action) {
    var dirty = MCP.project.isDirty();
    var discard = MCP.bool(args.discardChanges, false);
    if (dirty === false) { return false; }
    if (discard) { return true; }
    if (dirty === null) {
        MCP.fail("Cannot tell whether the open project has unsaved changes in After Effects " + app.version + ". Call save-project first, or pass discardChanges: true to " + action + " without saving.", "invalid-argument");
    }
    MCP.fail("The open project '" + (app.project.file ? app.project.file.name : "Untitled Project") + "' has unsaved changes. Call save-project (or save-project-as) first, or pass discardChanges: true to " + action + " and lose them.", "invalid-argument");
    return false;
};

MCP.project.ensureAep = function (path) {
    var p = String(path);
    if (!/\.aep$/i.test(p)) { p = p + ".aep"; }
    return p;
};

MCP.project.saveResult = function (extra) {
    var project = app.project;
    var out = {
        projectName: project.file ? project.file.name : "Untitled Project",
        path: project.file ? project.file.fsName : null,
        saved: project.file ? (MCP.project.isDirty() === null ? true : !project.dirty) : false,
        numItems: project.numItems
    };
    return MCP.extend(out, extra || {});
};

MCP.project.summary = function () {
    var project = app.project;
    var tree = MCP.projectItemTree(0);
    var comps = [];
    for (var i = 0; i < tree.items.length; i++) {
        if (tree.items[i].type === "comp") { comps.push({ id: tree.items[i].id, name: tree.items[i].name }); }
    }
    var ac = MCP.activeComp();
    return {
        projectName: project.file ? project.file.name : "Untitled Project",
        path: project.file ? project.file.fsName : null,
        saved: project.file ? (MCP.project.isDirty() === null ? true : !project.dirty) : false,
        numItems: project.numItems,
        itemCounts: tree.counts,
        compositions: comps,
        activeComp: ac ? MCP.serialize.compRef(ac) : null
    };
};

MCP.project.usageOf = function (item) {
    var usedIn = _mcpTry(function () { return item.usedIn; }, null);
    var out = [];
    if (usedIn) {
        for (var i = 0; i < usedIn.length; i++) { out.push({ id: usedIn[i].id, name: usedIn[i].name }); }
    }
    return out;
};

MCP.project.namesOf = function (refs) {
    var names = [];
    for (var i = 0; i < refs.length; i++) { names.push(refs[i].name); }
    return names.join(", ");
};

MCP.project.importAsValue = function (name) {
    var key = String(name);
    if (key === "footage") { return ImportAsType.FOOTAGE; }
    if (key === "comp") { return ImportAsType.COMP; }
    if (key === "comp-retain-layer-sizes") { return ImportAsType.COMP_CROPPED_LAYERS; }
    if (key === "project") { return ImportAsType.PROJECT; }
    MCP.fail("Unknown importAs '" + key + "'. Use footage, comp or comp-retain-layer-sizes.", "invalid-argument");
    return null;
};

MCP.project.importAsName = function (value) {
    if (value === ImportAsType.FOOTAGE) { return "footage"; }
    if (value === ImportAsType.COMP) { return "comp"; }
    if (value === ImportAsType.COMP_CROPPED_LAYERS) { return "comp-retain-layer-sizes"; }
    if (value === ImportAsType.PROJECT) { return "project"; }
    return null;
};

/** Best effort: a moving footage item whose file is a still-image type is an image sequence. */
MCP.project.looksLikeSequence = function (item, file) {
    var isStill = _mcpTry(function () { return item.mainSource.isStill; }, null);
    if (isStill !== false) { return false; }
    return /\.(png|jpg|jpeg|tif|tiff|exr|dpx|tga|psd|bmp|gif|dng|cr2)$/i.test(String(file.name));
};

/** Imports one file with the shared options. Returns the result entry. */
MCP.project.importOne = function (path, options, folder) {
    var file = new File(String(path));
    if (!file.exists) { MCP.fail("File not found: " + file.fsName, "not-found"); }
    var io;
    try { io = new ImportOptions(file); } catch (e1) { MCP.fail("After Effects cannot import '" + file.fsName + "': " + e1.message, "unsupported"); }
    var isAep = /\.aep$/i.test(file.name);
    var wantSequence = MCP.bool(options.sequence, false);
    if (wantSequence) {
        if (!io.canImportAs(ImportAsType.FOOTAGE)) { MCP.fail("'" + file.name + "' cannot be imported as an image sequence.", "unsupported"); }
        io.sequence = true;
        io.forceAlphabetical = MCP.bool(options.forceAlphabetical, false);
    }
    if (MCP.isDefined(options.importAs)) {
        var asType = MCP.project.importAsValue(options.importAs);
        if (!io.canImportAs(asType)) {
            MCP.fail("'" + file.name + "' cannot be imported as '" + options.importAs + "'. Only layered PSD and AI files support the comp options; use importAs 'footage' or omit it.", "unsupported");
        }
        io.importAs = asType;
    } else if (isAep && io.canImportAs(ImportAsType.PROJECT)) {
        io.importAs = ImportAsType.PROJECT;
    }
    var item;
    try { item = app.project.importFile(io); } catch (e2) { MCP.fail("Import of '" + file.fsName + "' failed: " + e2.message, "io"); }
    if (!item) { MCP.fail("Import of '" + file.fsName + "' returned nothing.", "io"); }
    if (folder) { try { item.parentFolder = folder; } catch (e3) {} }
    if (MCP.isDefined(options.name)) { item.name = String(options.name); }
    var out = { item: MCP.serialize.item(item), path: file.fsName };
    out.importedAs = MCP.project.importAsName(_mcpTry(function () { return io.importAs; }, null)) || MCP.itemType(item);
    out.isSequence = wantSequence;
    if (item instanceof FootageItem) {
        out.item.isStill = _mcpTry(function () { return item.mainSource.isStill; }, null);
        out.item.frameRate = _mcpTry(function () { return item.frameRate; }, null);
    } else if (item instanceof FolderItem) {
        out.item.numItems = _mcpTry(function () { return item.numItems; }, null);
    }
    return out;
};

/* ----------------------------------------------------------- commands */

MCP.register("saveProject", function (args) {
    var project = app.project;
    if (!project.file) {
        if (!MCP.isDefined(args.path)) {
            MCP.fail("The project has never been saved and has no file. Use save-project-as with a path, or pass path here.", "invalid-argument");
        }
        return MCP.invoke("saveProjectAs", { path: args.path, overwrite: MCP.bool(args.overwrite, false) });
    }
    var existed = project.file.exists;
    try { project.save(); } catch (e) { MCP.fail("Save failed for " + project.file.fsName + ": " + e.message, "io"); }
    return MCP.project.saveResult({ existed: existed });
}, { mutating: true });

MCP.register("saveProjectAs", function (args) {
    var path = MCP.project.ensureAep(MCP.requireArg(args, "path"));
    var file = new File(path);
    var existed = file.exists;
    if (existed && !MCP.bool(args.overwrite, false)) {
        MCP.fail("A file already exists at " + file.fsName + ". Pass overwrite: true to replace it, or choose another path.", "invalid-argument");
    }
    var folder = file.parent;
    if (folder && !folder.exists && !folder.create()) {
        MCP.fail("Cannot create folder " + folder.fsName, "io");
    }
    try { app.project.save(file); } catch (e) { MCP.fail("Save failed for " + file.fsName + ": " + e.message, "io"); }
    return MCP.project.saveResult({ existed: existed });
}, { mutating: true });

MCP.register("newProject", function (args) {
    if (!MCP.bool(args.confirm, false)) {
        MCP.fail("new-project closes the open project. Pass confirm: true to continue.", "invalid-argument");
    }
    var discarded = MCP.project.guardUnsaved(args, "start a new project");
    var previous = app.project.file ? app.project.file.fsName : null;
    if (discarded && app.project) {
        try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e1) {}
    }
    if (!app.project || (app.project.numItems > 0 || app.project.file)) {
        try { app.newProject(); } catch (e2) { MCP.fail("app.newProject() failed: " + e2.message, "script-error"); }
    }
    return MCP.project.saveResult({ discarded: discarded, previousPath: previous });
}, { mutating: true });

MCP.register("openProject", function (args) {
    var file = new File(String(MCP.requireArg(args, "path")));
    if (!file.exists) { MCP.fail("Project file not found: " + file.fsName, "not-found"); }
    var discarded = MCP.project.guardUnsaved(args, "open another project");
    if (discarded) {
        try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e1) {}
    }
    var opened;
    try { opened = app.open(file); } catch (e2) { MCP.fail("Could not open " + file.fsName + ": " + e2.message, "io"); }
    if (!opened && !app.project) { MCP.fail("After Effects did not open " + file.fsName + ".", "io"); }
    return MCP.extend(MCP.project.summary(), { discarded: discarded });
}, { mutating: true });

MCP.register("createFolder", function (args) {
    var name = String(MCP.requireArg(args, "name"));
    var parent = MCP.isDefined(args.parent) ? MCP.resolveItem(args.parent, "folder") : null;
    var folder = app.project.items.addFolder(name);
    if (parent) { folder.parentFolder = parent; }
    var out = MCP.serialize.item(folder);
    out.numItems = folder.numItems;
    return { item: out };
}, { mutating: true });

MCP.register("moveItemToFolder", function (args) {
    var item = MCP.resolveItem(MCP.requireArg(args, "item"));
    var target;
    if (MCP.bool(args.root, false)) { target = app.project.rootFolder; }
    else if (MCP.isDefined(args.folder)) { target = MCP.resolveItem(args.folder, "folder"); }
    else { MCP.fail("Pass folder (an ItemRef of a folder) or root: true.", "invalid-argument"); }
    if (target.id === item.id) { MCP.fail("Cannot move folder '" + item.name + "' into itself.", "invalid-argument"); }
    var previous = _mcpTry(function () { return item.parentFolder ? { id: item.parentFolder.id, name: item.parentFolder.name } : null; }, null);
    try { item.parentFolder = target; } catch (e) {
        MCP.fail("After Effects refused to move '" + item.name + "' into '" + target.name + "': " + e.message + ". A folder cannot go inside itself or one of its subfolders.", "invalid-argument");
    }
    return { item: MCP.serialize.item(item), previousFolder: previous };
}, { mutating: true });

MCP.register("renameItem", function (args) {
    var item = MCP.resolveItem(MCP.requireArg(args, "item"));
    var newName = String(MCP.requireArg(args, "newName"));
    var previous = item.name;
    item.name = newName;
    return { item: MCP.serialize.item(item), previousName: previous };
}, { mutating: true });

MCP.register("deleteItem", function (args) {
    var item = MCP.resolveItem(MCP.requireArg(args, "item"));
    var force = MCP.bool(args.force, false);
    var type = MCP.itemType(item);
    var usage = MCP.project.usageOf(item);
    var numLayers = (item instanceof CompItem) ? item.numLayers : null;
    var numChildren = (item instanceof FolderItem) ? item.numItems : null;
    var reasons = [];
    if (usage.length) { reasons.push("it is used in " + usage.length + " composition(s): " + MCP.project.namesOf(usage)); }
    if (numLayers) { reasons.push("it is a composition with " + numLayers + " layer(s)"); }
    if (numChildren) { reasons.push("it is a folder containing " + numChildren + " item(s)"); }
    if (reasons.length && !force) {
        MCP.fail("Refusing to delete '" + item.name + "' because " + reasons.join(" and ") + ". Pass force: true to delete it anyway.", "invalid-argument", { usedIn: usage, numLayers: numLayers, numItems: numChildren });
    }
    var removed = { id: item.id, name: item.name, type: type };
    item.remove();
    return { removed: removed, usedInCount: usage.length, usedIn: usage, numLayers: numLayers, numItems: numChildren, forced: force && reasons.length > 0 };
}, { mutating: true });

MCP.register("importFile", function (args) {
    var folder = MCP.isDefined(args.folder) ? MCP.resolveItem(args.folder, "folder") : null;
    return MCP.project.importOne(MCP.requireArg(args, "path"), args, folder);
}, { mutating: true });

MCP.register("importFilesBulk", function (args) {
    var paths = MCP.requireArg(args, "paths");
    if (!MCP.isArray(paths) || !paths.length) { MCP.fail("paths must be a non-empty array of file paths.", "invalid-argument"); }
    var folder = MCP.isDefined(args.folder) ? MCP.resolveItem(args.folder, "folder") : null;
    var continueOnError = MCP.bool(args.continueOnError, true);
    var results = [];
    var imported = 0, failed = 0;
    for (var i = 0; i < paths.length; i++) {
        var entry = { path: String(paths[i]), status: "ok" };
        try {
            var r = MCP.project.importOne(paths[i], args, folder);
            entry.item = r.item;
            entry.importedAs = r.importedAs;
            entry.isSequence = r.isSequence;
            imported++;
        } catch (e) {
            entry.status = "error";
            entry.error = { message: String(e.message), code: e.mcpCode || "script-error" };
            failed++;
            if (!continueOnError) {
                results.push(entry);
                for (var j = i + 1; j < paths.length; j++) { results.push({ path: String(paths[j]), status: "skipped" }); }
                break;
            }
        }
        results.push(entry);
    }
    return { count: paths.length, imported: imported, failed: failed, skipped: paths.length - imported - failed, results: results };
}, { mutating: true });

MCP.register("replaceFootage", function (args) {
    var item = MCP.resolveItem(MCP.requireArg(args, "item"), "footage");
    var file = new File(String(MCP.requireArg(args, "path")));
    if (!file.exists) { MCP.fail("File not found: " + file.fsName, "not-found"); }
    var previous = _mcpTry(function () { return item.file ? item.file.fsName : null; }, null);
    try {
        if (MCP.bool(args.sequence, false)) { item.replaceWithSequence(file, MCP.bool(args.forceAlphabetical, false)); }
        else { item.replace(file); }
    } catch (e) {
        MCP.fail("Replace failed for '" + item.name + "' with " + file.fsName + ": " + e.message, "io");
    }
    var out = MCP.serialize.item(item);
    out.frameRate = _mcpTry(function () { return item.frameRate; }, null);
    return { item: out, previousFile: previous, isSequence: MCP.bool(args.sequence, false) };
}, { mutating: true });

MCP.register("reduceProject", function (args) {
    if (!MCP.bool(args.confirm, false)) {
        MCP.fail("reduce-project deletes every item not used by the listed compositions. Pass confirm: true to continue.", "invalid-argument");
    }
    var refs = MCP.requireArg(args, "comps");
    if (!MCP.isArray(refs) || !refs.length) { MCP.fail("comps must be a non-empty array of composition references.", "invalid-argument"); }
    var comps = [], kept = [];
    for (var i = 0; i < refs.length; i++) {
        var c = MCP.resolveComp(refs[i]);
        comps.push(c);
        kept.push(MCP.serialize.compRef(c));
    }
    var before = app.project.numItems;
    var removed;
    try { removed = app.project.reduceProject(comps); } catch (e) { MCP.fail("reduceProject failed: " + e.message, "script-error"); }
    if (!MCP.isDefined(removed) || isNaN(Number(removed))) { removed = before - app.project.numItems; }
    return { removed: Number(removed), kept: kept, numItems: app.project.numItems };
}, { mutating: true });

MCP.register("removeUnusedFootage", function () {
    var before = app.project.numItems;
    var removed;
    try { removed = app.project.removeUnusedFootage(); } catch (e) { MCP.fail("removeUnusedFootage failed: " + e.message, "script-error"); }
    if (!MCP.isDefined(removed) || isNaN(Number(removed))) { removed = before - app.project.numItems; }
    return { removed: Number(removed), numItems: app.project.numItems };
}, { mutating: true });

MCP.register("collectFiles", function (args) {
    if (!MCP.bool(args.dryRun, false)) {
        MCP.fail("Collect Files has no scripting API in After Effects; it is only available through File > Dependencies > Collect Files, which opens a dialog. Call collect-files with dryRun: true to get the list of referenced files and copy them yourself.", "unsupported");
    }
    var files = [], missing = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!(item instanceof FootageItem)) { continue; }
        var f = _mcpTry(function () { return item.file; }, null);
        if (!f) { continue; }
        var exists = _mcpTry(function () { return f.exists; }, false);
        var entry = {
            id: item.id,
            name: item.name,
            path: f.fsName,
            exists: exists,
            isSequence: MCP.project.looksLikeSequence(item, f),
            usedIn: MCP.project.usageOf(item).length
        };
        files.push(entry);
        if (!exists) { missing.push(f.fsName); }
    }
    return {
        supported: false,
        projectPath: app.project.file ? app.project.file.fsName : null,
        count: files.length,
        files: files,
        missing: missing,
        message: "After Effects exposes no Collect Files API. Copy these files next to the project yourself, or use File > Dependencies > Collect Files in the application."
    };
}, { mutating: false });
