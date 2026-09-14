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
