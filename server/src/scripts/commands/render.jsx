/*
 * Render and preview commands: single-frame PNG capture for see-frame and
 * export-frame-png, contact sheets for see-frames, still sequences, and the
 * render queue (add, list, clear, render, template lists).
 *
 * Frame capture prefers CompItem.saveFrameToPng(time, file), which exists in
 * After Effects 22.3 and later. On older versions it falls back to a temporary
 * render queue item with the "PNG Sequence" output module, renders only that
 * item, and renames the numbered sequence file to the requested path.
 *
 * Frames for see-frame land in the bridge frames folder. The Node side passes
 * outputDir (its view of that folder) so the two sides stay in step; without
 * it the panel uses MCP.paths.frames.
 */

MCP.render = {};

MCP.render.STATUS_NAMES = ["QUEUED", "UNQUEUED", "RENDERING", "DONE", "ERR_STOPPED", "USER_STOPPED", "NEEDS_OUTPUT", "WILL_CONTINUE"];

MCP.render.statusName = function (status) {
    var names = MCP.render.STATUS_NAMES;
    for (var i = 0; i < names.length; i++) {
        var match = false;
        try { match = (RQItemStatus[names[i]] === status); } catch (e) { match = false; }
        if (match) { return names[i]; }
    }
    return String(status);
};

MCP.render.framesDir = function (args) {
    var dir = null;
    if (args && MCP.isDefined(args.outputDir) && String(args.outputDir) !== "") { dir = String(args.outputDir); }
    else if (typeof MCP.paths === "object" && MCP.paths && MCP.paths.frames) { dir = MCP.paths.frames; }
    else { dir = MCP.subFolder("frames"); }
    var folder = new Folder(dir);
    if (!folder.exists) { folder.create(); }
    return folder.fsName;
};

MCP.render.ensureFolder = function (filePath) {
    var file = new File(filePath);
    var parent = file.parent;
    if (parent && !parent.exists) { parent.create(); }
    if (parent && !parent.exists) { MCP.fail("Cannot create folder " + parent.fsName + ".", "io"); }
    return file;
};

MCP.render.safeName = function (name) {
    return String(name).replace(/[^A-Za-z0-9_.-]+/g, "_");
};

MCP.render.pad = function (n, width) {
    var s = String(Math.abs(Math.round(n)));
    while (s.length < width) { s = "0" + s; }
    return (n < 0 ? "-" : "") + s;
};

/** Clamps a time to the comp's range so the last frame is still valid. */
MCP.render.clampTime = function (comp, t) {
    var fd = MCP.frameDuration(comp);
    var last = Math.max(0, comp.duration - fd);
    return MCP.clamp(MCP.snapToFrame(comp, t), 0, last);
};

/** Sets render = false on every item except `keep` and returns the flags to restore afterwards. */
MCP.render.isolateItem = function (keep) {
    var rq = app.project.renderQueue;
    var saved = [];
    for (var i = 1; i <= rq.numItems; i++) {
        var it = rq.item(i);
        if (it === keep) { continue; }
        var flag = _mcpTry(function () { return it.render; }, false);
        saved.push({ item: it, render: flag });
        if (flag) { try { it.render = false; } catch (e) {} }
    }
    return saved;
};

MCP.render.restoreItems = function (saved) {
    for (var i = 0; i < saved.length; i++) {
        try { saved[i].item.render = saved[i].render; } catch (e) {}
    }
};

/** Finds a file in `folder` whose name starts with `base` and ends with .png (the numbered sequence file). */
MCP.render.findSequenceFile = function (folder, base) {
    var files = folder.getFiles(function (f) {
        return (f instanceof File) && f.name.indexOf(base) === 0 && /\.png$/i.test(f.name);
    });
    if (!files || !files.length) { return null; }
    var newest = files[0];
    for (var i = 1; i < files.length; i++) {
        if (files[i].modified > newest.modified) { newest = files[i]; }
    }
    return newest;
};

/**
 * Writes one frame of `comp` at time `t` to `filePath` as PNG.
 * Returns "saveFrameToPng" or "renderQueue" to say which path was taken.
 */
MCP.render.saveFrame = function (comp, t, filePath) {
    var file = MCP.render.ensureFolder(filePath);
    if (file.exists) { try { file.remove(); } catch (e0) {} }
    if (typeof comp.saveFrameToPng === "function") {
        comp.saveFrameToPng(t, file);
        if (!file.exists) {
            MCP.fail("saveFrameToPng reported no error but " + file.fsName + " was not written. Check that the folder is writable.", "io", { file: file.fsName });
        }
        return "saveFrameToPng";
    }
    // Fallback for After Effects older than 22.3: a temporary render queue item.
    var rq = app.project.renderQueue;
    if (_mcpTry(function () { return rq.rendering; }, false)) {
        MCP.fail("The render queue is busy, so a frame cannot be captured right now. Wait for the render to finish.", "unsupported");
    }
    var item = rq.items.add(comp);
    var saved = MCP.render.isolateItem(item);
    var base = file.name.replace(/\.png$/i, "");
    try {
        item.timeSpanStart = t;
        item.timeSpanDuration = MCP.frameDuration(comp);
        var om = item.outputModule(1);
        try { om.applyTemplate("PNG Sequence"); } catch (e1) {
            MCP.fail("No output module template named 'PNG Sequence' and saveFrameToPng is not available in After Effects " + app.version + ". Create a PNG output module template with that name, or upgrade to 22.3 or later.", "unsupported");
        }
        // Sequence output modules number the file (base_00000.png); we rename it afterwards.
        om.file = new File(file.parent.fsName + "/" + base + "_[#####].png");
        item.render = true;
        rq.render();
    } finally {
        try { item.remove(); } catch (e2) {}
        MCP.render.restoreItems(saved);
    }
    var written = MCP.render.findSequenceFile(file.parent, base);
    if (!written) {
        MCP.fail("The render queue finished but no file starting with '" + base + "' appeared in " + file.parent.fsName + ".", "io");
    }
    if (written.fsName !== file.fsName) {
        if (!written.rename(file.name)) {
            return "renderQueue:" + written.fsName;
        }
    }
    return "renderQueue";
};

MCP.render.frameInfo = function (comp, t, frame, file, method) {
    return {
        file: file,
        width: comp.width,
        height: comp.height,
        time: MCP.round(t),
        frame: frame,
        composition: MCP.serialize.compRef(comp),
        method: method
    };
};

/** Builds the list of times for see-frames and export-still-sequence from times[], frames[], or count. */
MCP.render.timesFrom = function (comp, args, defaultCount, maxCount) {
    var fd = MCP.frameDuration(comp);
    var out = [];
    var i;
    if (MCP.isArray(args.frames) && args.frames.length) {
        for (i = 0; i < args.frames.length; i++) { out.push(MCP.render.clampTime(comp, Number(args.frames[i]) * fd)); }
    } else if (MCP.isArray(args.times) && args.times.length) {
        for (i = 0; i < args.times.length; i++) { out.push(MCP.render.clampTime(comp, Number(args.times[i]))); }
    } else {
        var start = 0;
        var end = Math.max(0, comp.duration - fd);
        if (MCP.bool(args.useWorkArea, false)) {
            start = comp.workAreaStart;
            end = Math.max(start, comp.workAreaStart + comp.workAreaDuration - fd);
        }
        if (MCP.isDefined(args.start)) { start = MCP.render.clampTime(comp, Number(args.start)); }
        if (MCP.isDefined(args.end)) { end = MCP.render.clampTime(comp, Number(args.end)); }
        if (end < start) { MCP.fail("end (" + end + "s) is before start (" + start + "s).", "invalid-argument"); }
        var count;
        if (MCP.isDefined(args.count)) { count = Math.max(1, Math.round(Number(args.count))); }
        else if (MCP.isDefined(defaultCount)) { count = defaultCount; }
        else { count = Math.round((end - start) / fd) + 1; }
        if (count === 1) { out.push(MCP.render.clampTime(comp, start)); }
        else {
            for (i = 0; i < count; i++) { out.push(MCP.render.clampTime(comp, start + (end - start) * i / (count - 1))); }
        }
    }
    if (MCP.isDefined(maxCount) && out.length > maxCount) {
        MCP.fail(out.length + " frames requested, which is above the cap of " + maxCount + ". Pass allowLarge true, a smaller count, or a narrower start/end range.", "invalid-argument", { requested: out.length, cap: maxCount });
    }
    return out;
};

/* ------------------------------------------------------------ see-frame */

MCP.register("seeFrame", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var t = MCP.render.clampTime(comp, MCP.timeArg(comp, args));
    var frame = MCP.frameOf(comp, t);
    if (MCP.bool(args.setCurrentTime, true)) { try { comp.time = t; } catch (e) {} }
    var dir = MCP.render.framesDir(args);
    var filePath = dir + "/frame-" + comp.id + "-" + frame + "-" + Date.now() + ".png";
    var method = MCP.render.saveFrame(comp, t, filePath);
    return MCP.render.frameInfo(comp, t, frame, new File(filePath).fsName, method);
}, { mutating: false });

MCP.register("seeFrames", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var times = MCP.render.timesFrom(comp, args, 4, 25);
    var dir = MCP.render.framesDir(args);
    var stamp = Date.now();
    var frames = [];
    for (var i = 0; i < times.length; i++) {
        var t = times[i];
        var frame = MCP.frameOf(comp, t);
        var filePath = dir + "/frame-" + comp.id + "-" + frame + "-" + stamp + "-" + i + ".png";
        var method = MCP.render.saveFrame(comp, t, filePath);
        var info = MCP.render.frameInfo(comp, t, frame, new File(filePath).fsName, method);
        info.index = i;
        frames.push(info);
    }
    return { composition: MCP.serialize.compRef(comp), count: frames.length, width: comp.width, height: comp.height, frames: frames };
}, { mutating: false });

MCP.register("exportFramePng", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var outputPath = String(MCP.requireArg(args, "outputPath"));
    if (!/\.png$/i.test(outputPath)) { outputPath = outputPath + ".png"; }
    var t = MCP.render.clampTime(comp, MCP.timeArg(comp, args));
    var frame = MCP.frameOf(comp, t);
    var method = MCP.render.saveFrame(comp, t, outputPath);
    return MCP.render.frameInfo(comp, t, frame, new File(outputPath).fsName, method);
}, { mutating: false });

MCP.register("exportStillSequence", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var outputDir = String(MCP.requireArg(args, "outputDir"));
    var format = String(MCP.arg(args, "format", "png")).toLowerCase();
    if (format !== "png") { MCP.fail("Only format 'png' is supported by export-still-sequence. For other formats add-to-render-queue with an output module template, then render.", "invalid-argument"); }
    var cap = MCP.bool(args.allowLarge, false) ? 100000 : Math.round(MCP.num(args.maxFrames, 300));
    var times = MCP.render.timesFrom(comp, args, undefined, cap);
    var prefix = MCP.render.safeName(MCP.arg(args, "filePrefix", comp.name));
    var folder = new Folder(outputDir);
    if (!folder.exists) { folder.create(); }
    if (!folder.exists) { MCP.fail("Cannot create folder " + outputDir + ".", "io"); }
    var files = [];
    var method = null;
    for (var i = 0; i < times.length; i++) {
        var t = times[i];
        var frame = MCP.frameOf(comp, t);
        var filePath = folder.fsName + "/" + prefix + "_" + MCP.render.pad(frame, 5) + ".png";
        method = MCP.render.saveFrame(comp, t, filePath);
        files.push({ index: i, frame: frame, time: MCP.round(t), file: new File(filePath).fsName });
    }
    return { composition: MCP.serialize.compRef(comp), outputDir: folder.fsName, count: files.length, width: comp.width, height: comp.height, method: method, files: files };
}, { mutating: false });

/* --------------------------------------------------------- render queue */

MCP.render.serializeItem = function (item, index) {
    var out = {
        index: index,
        comp: _mcpTry(function () { return MCP.serialize.compRef(item.comp); }, null),
        status: MCP.render.statusName(_mcpTry(function () { return item.status; }, null)),
        render: _mcpTry(function () { return item.render; }, null),
        timeSpanStart: _mcpTry(function () { return MCP.round(item.timeSpanStart); }, null),
        timeSpanDuration: _mcpTry(function () { return MCP.round(item.timeSpanDuration); }, null),
        elapsedSeconds: _mcpTry(function () { return item.elapsedSeconds; }, null),
        outputModules: []
    };
    var n = _mcpTry(function () { return item.numOutputModules; }, 0);
    for (var i = 1; i <= n; i++) {
        var om = item.outputModule(i);
        out.outputModules.push({
            index: i,
            file: _mcpTry(function () { return om.file ? om.file.fsName : null; }, null),
            template: _mcpTry(function () { return om.name; }, null)
        });
    }
    out.outputPaths = [];
    for (var j = 0; j < out.outputModules.length; j++) { if (out.outputModules[j].file) { out.outputPaths.push(out.outputModules[j].file); } }
    return out;
};

MCP.render.queueSummary = function () {
    var rq = app.project.renderQueue;
    var items = [];
    for (var i = 1; i <= rq.numItems; i++) { items.push(MCP.render.serializeItem(rq.item(i), i)); }
    return { count: items.length, rendering: _mcpTry(function () { return rq.rendering; }, false), items: items };
};

MCP.render.visibleTemplates = function (names) {
    var out = [];
    for (var i = 0; i < names.length; i++) {
        var n = String(names[i]);
        if (n.indexOf("_HIDDEN") === 0) { continue; }
        out.push(n);
    }
    return out;
};

/** Adds a throwaway render queue item for `comp`, calls fn(item), removes it. Templates only exist on items. */
MCP.render.withTempItem = function (comp, fn) {
    var rq = app.project.renderQueue;
    var item = rq.items.add(comp);
    var result;
    try { result = fn(item); }
    finally { try { item.remove(); } catch (e) {} }
    return result;
};

MCP.render.compForTemplates = function (args) {
    if (MCP.isDefined(args.comp)) { return MCP.resolveComp(args.comp); }
    var active = MCP.activeComp();
    if (active) { return active; }
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem) { return item; }
    }
    MCP.fail("The project has no composition. Templates can only be read through a render queue item, which needs a composition. Create one first.", "not-found");
    return null;
};

MCP.register("addToRenderQueue", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var outputPath = String(MCP.requireArg(args, "outputPath"));
    var rq = app.project.renderQueue;
    var item = rq.items.add(comp);
    var index = rq.numItems;
    var notes = [];
    if (MCP.isDefined(args.renderSettingsTemplate)) {
        var rs = String(args.renderSettingsTemplate);
        try { item.applyTemplate(rs); } catch (e1) {
            try { item.remove(); } catch (e1b) {}
            MCP.fail("Render settings template '" + rs + "' could not be applied. list-render-settings-templates shows the names.", "invalid-argument", { available: MCP.render.visibleTemplates(_mcpTry(function () { return item.templates; }, [])) });
        }
    }
    var om = item.outputModule(1);
    if (MCP.isDefined(args.outputModuleTemplate)) {
        var omt = String(args.outputModuleTemplate);
        try { om.applyTemplate(omt); } catch (e2) {
            var available = MCP.render.visibleTemplates(_mcpTry(function () { return om.templates; }, []));
            try { item.remove(); } catch (e2b) {}
            MCP.fail("Output module template '" + omt + "' could not be applied. list-output-module-templates shows the names.", "invalid-argument", { available: available });
        }
    }
    MCP.render.ensureFolder(outputPath);
    om.file = new File(outputPath);
    if (MCP.bool(args.useWorkArea, true) && !MCP.isDefined(args.start) && !MCP.isDefined(args.end)) {
        item.timeSpanStart = comp.workAreaStart;
        item.timeSpanDuration = comp.workAreaDuration;
    } else if (MCP.isDefined(args.start) || MCP.isDefined(args.end)) {
        var start = MCP.isDefined(args.start) ? Number(args.start) : 0;
        var end = MCP.isDefined(args.end) ? Number(args.end) : comp.duration;
        if (end <= start) { try { item.remove(); } catch (e3) {} MCP.fail("end must be after start.", "invalid-argument"); }
        item.timeSpanStart = start;
        item.timeSpanDuration = end - start;
    }
    if (MCP.isDefined(args.skipExisting)) {
        var ok = _mcpTry(function () { item.setSetting("Skip existing files", MCP.bool(args.skipExisting, false) ? "true" : "false"); return true; }, false);
        if (!ok) { notes.push("skipExisting could not be set through setSetting on this After Effects version."); }
    }
    item.render = true;
    var out = MCP.render.serializeItem(item, index);
    out.itemIndex = index;
    out.outputPath = _mcpTry(function () { return om.file.fsName; }, outputPath);
    out.notes = notes;
    return out;
}, { mutating: true });

MCP.register("listRenderQueue", function () {
    return MCP.render.queueSummary();
}, { mutating: false });

MCP.register("clearRenderQueue", function (args) {
    var rq = app.project.renderQueue;
    if (_mcpTry(function () { return rq.rendering; }, false)) {
        MCP.fail("The render queue is rendering; items cannot be removed until it finishes or is stopped in After Effects.", "unsupported");
    }
    var onlyFinished = MCP.bool(args.onlyFinished, false);
    var removed = 0;
    for (var i = rq.numItems; i >= 1; i--) {
        var item = rq.item(i);
        if (onlyFinished) {
            var name = MCP.render.statusName(_mcpTry(function () { return item.status; }, null));
            if (name !== "DONE" && name !== "UNQUEUED" && name !== "ERR_STOPPED" && name !== "USER_STOPPED") { continue; }
        }
        item.remove();
        removed++;
    }
    return { removed: removed, remaining: rq.numItems };
}, { mutating: true });

MCP.register("render", function (args) {
    var rq = app.project.renderQueue;
    if (_mcpTry(function () { return rq.rendering; }, false)) {
        MCP.fail("The render queue is already rendering.", "unsupported");
    }
    var i, item;
    if (MCP.isArray(args.itemIndices) && args.itemIndices.length) {
        var wanted = {};
        for (i = 0; i < args.itemIndices.length; i++) { wanted[String(Math.round(Number(args.itemIndices[i])))] = true; }
        for (i = 1; i <= rq.numItems; i++) {
            item = rq.item(i);
            var want = !!wanted[String(i)];
            if (want && MCP.render.statusName(item.status) === "NEEDS_OUTPUT") {
                MCP.fail("Render queue item " + i + " has no output path. Set one with add-to-render-queue or in After Effects.", "invalid-argument");
            }
            try { item.render = want; } catch (e1) {}
        }
    }
    var queued = 0;
    for (i = 1; i <= rq.numItems; i++) {
        if (MCP.render.statusName(rq.item(i).status) === "QUEUED") { queued++; }
    }
    if (queued === 0) {
        MCP.fail("Nothing is queued. add-to-render-queue first, or check list-render-queue for items with status NEEDS_OUTPUT or UNQUEUED.", "invalid-argument", MCP.render.queueSummary());
    }
    var started = Date.now();
    rq.render();
    var summary = MCP.render.queueSummary();
    summary.elapsedSeconds = MCP.round((Date.now() - started) / 1000, 2);
    var done = 0, failed = 0;
    var outputs = [];
    for (i = 0; i < summary.items.length; i++) {
        if (summary.items[i].status === "DONE") { done++; outputs = outputs.concat(summary.items[i].outputPaths); }
        else if (summary.items[i].status === "ERR_STOPPED" || summary.items[i].status === "USER_STOPPED") { failed++; }
    }
    summary.done = done;
    summary.failed = failed;
    summary.outputFiles = outputs;
    summary.queuedBefore = queued;
    return summary;
}, { mutating: true });

MCP.register("listOutputModuleTemplates", function (args) {
    var comp = MCP.render.compForTemplates(args);
    return MCP.render.withTempItem(comp, function (item) {
        var om = item.outputModule(1);
        return {
            composition: MCP.serialize.compRef(comp),
            outputModuleTemplates: MCP.render.visibleTemplates(_mcpTry(function () { return om.templates; }, [])),
            renderSettingsTemplates: MCP.render.visibleTemplates(_mcpTry(function () { return item.templates; }, [])),
            currentOutputModule: _mcpTry(function () { return om.name; }, null)
        };
    });
}, { mutating: false });

MCP.register("listRenderSettingsTemplates", function (args) {
    var comp = MCP.render.compForTemplates(args);
    return MCP.render.withTempItem(comp, function (item) {
        return {
            composition: MCP.serialize.compRef(comp),
            renderSettingsTemplates: MCP.render.visibleTemplates(_mcpTry(function () { return item.templates; }, []))
        };
    });
}, { mutating: false });
