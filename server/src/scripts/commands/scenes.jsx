/*
 * Scene planning commands.
 *
 * A plan is a folder named after the film holding the master composition and
 * a scenes folder ("Scenes") with one composition per scene, numbered in
 * order ("01 Intro"). The master plays the scene comps as layers, later
 * scenes above earlier ones, each starting where the previous one ends minus
 * an optional overlap. A comp marker at every scene start carries the scene
 * name and notes; its parameters hold the scene comp id and the transition
 * planned into the next scene. The notes themselves live in the scene comp's
 * comment and in a guide text layer ("Scene Notes") inside the scene, which
 * never renders.
 *
 * list-scenes reads any master: the scene layers are the precomp layers
 * whose comps sit in the plan's scenes folder, or, in a master built by hand,
 * every full-frame precomp layer that is not a guide.
 *
 * Changing the sequence ripples: every later scene layer moves by the change,
 * so gaps and overlaps between neighbours stay as they were; non-scene layers
 * and comp markers that start at or after the change move with them, and so
 * do the matte and carry layers of transitions between later scenes.
 * Transitions on a changed cut are removed first (restoring the trims they
 * made) and built again at the new cut from their stored arguments.
 */

MCP.scenes = {};

MCP.scenes.MARKER_KEY = "mcpScene";
MCP.scenes.NOTES_LAYER = "Scene Notes";
MCP.scenes.BG_LAYER = "Background";
MCP.scenes.BG_SOLID = "Scene Background";
MCP.scenes.DEFAULT_FOLDER = "Scenes";
MCP.scenes.REF_FOLDER = "References";
MCP.scenes.EPS = 1e-4;

/* ---------------------------------------------------------------- names */

MCP.scenes.NUMBER_RE = /^\s*\d+[\s._-]+/;

MCP.scenes.bareName = function (name) {
    var s = String(name).replace(MCP.scenes.NUMBER_RE, "");
    return s.replace(/^\s+|\s+$/g, "");
};

MCP.scenes.isNumbered = function (name) {
    return MCP.scenes.NUMBER_RE.test(String(name));
};

MCP.scenes.numberedName = function (n, name, total) {
    var s = String(n), width = total >= 100 ? 3 : 2;
    while (s.length < width) { s = "0" + s; }
    return s + " " + MCP.scenes.bareName(name);
};

MCP.scenes.firstLine = function (text) {
    var line = String(text || "").split(/\r\n|\r|\n/)[0];
    return line.length > 200 ? line.substring(0, 197) + "..." : line;
};

/** Word-wraps text to lines of about width characters, keeping its own line breaks. */
MCP.scenes.wrap = function (text, width) {
    var paras = String(text).split(/\r\n|\r|\n/), out = [], p, w;
    for (p = 0; p < paras.length; p++) {
        var words = paras[p].split(/\s+/), line = "";
        for (w = 0; w < words.length; w++) {
            if (!words[w]) { continue; }
            if (line && (line + " " + words[w]).length > width) { out.push(line); line = words[w]; }
            else { line = line ? line + " " + words[w] : words[w]; }
        }
        out.push(line);
    }
    return out.join("\r");
};

/* -------------------------------------------------------------- project */

MCP.scenes.childFolder = function (parent, name) {
    var root = parent || app.project.rootFolder;
    for (var i = 1; i <= root.numItems; i++) {
        var it = root.item(i);
        if (it instanceof FolderItem && it.name === name) { return it; }
    }
    return null;
};

MCP.scenes.ensureFolder = function (parent, name, created) {
    var f = MCP.scenes.childFolder(parent, name);
    if (f) { return f; }
    f = app.project.items.addFolder(name);
    if (parent && parent.id !== app.project.rootFolder.id) { f.parentFolder = parent; }
    if (created) { created.push(name); }
    return f;
};

MCP.scenes.uniqueCompName = function (base) {
    var used = {}, i;
    for (i = 1; i <= app.project.numItems; i++) { used[app.project.item(i).name] = true; }
    if (!used[base]) { return base; }
    for (i = 2; i < 1000; i++) { if (!used[base + " " + i]) { return base + " " + i; } }
    return base + " " + new Date().getTime();
};

MCP.scenes.findLayerByName = function (comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) { if (comp.layer(i).name === name) { return comp.layer(i); } }
    return null;
};

MCP.scenes.unlocked = function (layer, fn) {
    var was = !!layer.locked;
    if (was) { layer.locked = false; }
    try { return fn(); } finally { if (was) { try { layer.locked = true; } catch (e) {} } }
};

/** Near-black on a light background, white on a dark one. */
MCP.scenes.contrast = function (rgb) {
    var lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return lum > 0.5 ? [0.1, 0.1, 0.1] : [1, 1, 1];
};

/* -------------------------------------------------------------- masters */

MCP.scenes.isMaster = function (comp) {
    return String(_mcpTry(function () { return comp.comment; }, "") || "").indexOf("Scene plan") === 0;
};

MCP.scenes.masterComment = function (folderName) {
    return "Scene plan. Scene comps live in the folder '" + folderName + "'.";
};

/** The master comp of a film: a comp named filmName marked as a plan, else one inside a folder of that name. */
MCP.scenes.findMaster = function (film) {
    var candidate = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (!(it instanceof CompItem) || it.name !== film) { continue; }
        if (MCP.scenes.isMaster(it)) { return it; }
        if (_mcpTry(function () { return it.parentFolder.name; }, "") === film) { candidate = it; }
    }
    return candidate;
};

/** The scenes folder of a master: the folder named in its comment (default "Scenes") next to it. */
MCP.scenes.folderOfMaster = function (master) {
    var name = MCP.scenes.DEFAULT_FOLDER;
    var m = /folder '([^']+)'/.exec(String(_mcpTry(function () { return master.comment; }, "") || ""));
    if (m) { name = m[1]; }
    var parent = _mcpTry(function () { return master.parentFolder; }, null);
    return parent ? MCP.scenes.childFolder(parent, name) : null;
};

MCP.scenes.isHelper = function (L) {
    var c = String(_mcpTry(function () { return L.comment; }, "") || "");
    return c.indexOf("[transition") === 0 || c.indexOf("[carry") === 0 || c.indexOf("[reference") === 0;
};

/** {layers: scene layers in time order, folder, rule}. */
MCP.scenes.sceneLayers = function (master) {
    var folder = MCP.scenes.folderOfMaster(master);
    var inFolder = [], fullFrame = [], i;
    for (i = 1; i <= master.numLayers; i++) {
        var L = master.layer(i);
        if (!(L instanceof AVLayer)) { continue; }
        var src = _mcpTry(function () { return L.source; }, null);
        if (!(src instanceof CompItem)) { continue; }
        if (_mcpTry(function () { return L.guideLayer || L.adjustmentLayer; }, false)) { continue; }
        if (MCP.scenes.isHelper(L)) { continue; }
        if (folder && _mcpTry(function () { return src.parentFolder.id; }, -1) === folder.id) { inFolder.push(L); }
        if (src.width === master.width && src.height === master.height) { fullFrame.push(L); }
    }
    var list = inFolder.length ? inFolder : fullFrame;
    list.sort(function (a, b) {
        if (Math.abs(a.inPoint - b.inPoint) > MCP.scenes.EPS) { return a.inPoint - b.inPoint; }
        return b.index - a.index;
    });
    return { layers: list, folder: folder, rule: inFolder.length ? "scenes-folder" : "full-frame-precomps" };
};

MCP.scenes.seqEnd = function (seq) {
    var end = 0;
    for (var i = 0; i < seq.length; i++) { if (seq[i].outPoint > end) { end = seq[i].outPoint; } }
    return end;
};

/** Index into seq for a scene ref: 1-based position, name (with or without number), {compId}, {layer}. */
MCP.scenes.resolveScene = function (master, seq, ref) {
    var i, names = [];
    for (i = 0; i < seq.length; i++) { names.push(seq[i].source.name); }
    if (!seq.length) {
        MCP.fail("'" + master.name + "' has no scene layers. Make a plan with create-scene-plan, or place scene comps in it as layers.", "not-found");
    }
    var list = names.join(", ");
    if (typeof ref === "number") {
        if (ref < 1 || ref > seq.length) { MCP.fail("Scene position " + ref + " is out of range (1 to " + seq.length + "). Scenes: " + list, "not-found", { scenes: names }); }
        return ref - 1;
    }
    if (typeof ref === "string") {
        for (i = 0; i < seq.length; i++) { if (names[i] === ref) { return i; } }
        var lower = ref.toLowerCase(), bare = MCP.scenes.bareName(ref).toLowerCase(), hits = [];
        for (i = 0; i < seq.length; i++) { if (names[i].toLowerCase() === lower) { return i; } }
        for (i = 0; i < seq.length; i++) { if (MCP.scenes.bareName(names[i]).toLowerCase() === bare) { hits.push(i); } }
        if (hits.length === 1) { return hits[0]; }
        if (hits.length > 1) { MCP.fail("Scene name '" + ref + "' matches " + hits.length + " scenes. Use the numbered name or the position. Scenes: " + list, "ambiguous", { scenes: names }); }
        MCP.fail("No scene named '" + ref + "' in '" + master.name + "'. Scenes: " + list, "not-found", { scenes: names });
    }
    if (ref && typeof ref === "object") {
        if (MCP.isDefined(ref.compId)) {
            for (i = 0; i < seq.length; i++) { if (seq[i].source.id === Number(ref.compId)) { return i; } }
            MCP.fail("No scene layer in '" + master.name + "' uses comp id " + ref.compId + ". Scenes: " + list, "not-found", { scenes: names });
        }
        if (MCP.isDefined(ref.layer)) {
            var L = MCP.resolveLayer(master, ref.layer);
            for (i = 0; i < seq.length; i++) { if (seq[i].index === L.index) { return i; } }
            MCP.fail("Layer '" + L.name + "' is not a scene layer of '" + master.name + "'. Scenes: " + list, "invalid-argument", { scenes: names });
        }
    }
    MCP.fail("scene must be a position, a name, {compId} or {layer}.", "invalid-argument");
    return -1;
};

/* -------------------------------------------------------------- markers */

MCP.scenes.markerParams = function (mv) {
    var p = null;
    try { p = mv.getParameters(); } catch (e) { p = null; }
    return p || {};
};

/** Scene markers of a master by scene comp id: {index, time, comment, transition}. */
MCP.scenes.sceneMarkers = function (master) {
    var mp = master.markerProperty, out = {};
    for (var k = 1; k <= mp.numKeys; k++) {
        var params = MCP.scenes.markerParams(mp.keyValue(k));
        if (!MCP.isDefined(params[MCP.scenes.MARKER_KEY])) { continue; }
        out[Number(params[MCP.scenes.MARKER_KEY])] = { index: k, time: mp.keyTime(k), comment: mp.keyValue(k).comment, transition: params.transition || null };
    }
    return out;
};

/**
 * Rewrites the scene markers: one per scene at its in point, comment "name:
 * first line of the notes", duration the scene's length, parameters {scene
 * comp id, planned transition}. overrides: {compId: kind or ""} changes the
 * planned transition. Returns notes for markers that could not be placed.
 */
MCP.scenes.syncMarkers = function (master, seq, overrides) {
    var old = MCP.scenes.sceneMarkers(master), mp = master.markerProperty, notes = [], k, i;
    for (k = mp.numKeys; k >= 1; k--) {
        if (MCP.isDefined(MCP.scenes.markerParams(mp.keyValue(k))[MCP.scenes.MARKER_KEY])) { mp.removeKey(k); }
    }
    for (i = 0; i < seq.length; i++) {
        var L = seq[i], src = L.source;
        var trans = old[src.id] ? old[src.id].transition : null;
        if (overrides && Object.prototype.hasOwnProperty.call(overrides, String(src.id))) { trans = overrides[String(src.id)] || null; }
        if (mp.numKeys && MCP.easing.keyIndexAtTime(mp, L.inPoint, 1e-3) > 0) {
            notes.push("A comp marker already sits at the start of '" + src.name + "'; its scene marker was not added.");
            continue;
        }
        var notesText = String(_mcpTry(function () { return src.comment; }, "") || "");
        var mv = new MarkerValue(src.name + (notesText ? ": " + MCP.scenes.firstLine(notesText) : ""));
        try { mv.duration = Math.max(0, L.outPoint - L.inPoint); } catch (e1) {}
        var params = {};
        params[MCP.scenes.MARKER_KEY] = String(src.id);
        if (trans) { params.transition = String(trans); }
        try { mv.setParameters(params); } catch (e2) {}
        mp.setValueAtTime(L.inPoint, mv);
    }
    return notes;
};

/** Moves the comp markers (not the scene markers) at or after fromTime by delta. */
MCP.scenes.shiftCompMarkers = function (master, fromTime, delta) {
    var mp = master.markerProperty, moving = [], k;
    for (k = mp.numKeys; k >= 1; k--) {
        var t = mp.keyTime(k);
        if (t < fromTime - MCP.scenes.EPS) { continue; }
        var mv = mp.keyValue(k);
        if (MCP.isDefined(MCP.scenes.markerParams(mv)[MCP.scenes.MARKER_KEY])) { continue; }
        moving.push({ time: t, value: mv });
        mp.removeKey(k);
    }
    for (k = 0; k < moving.length; k++) { mp.setValueAtTime(moving[k].time + delta, moving[k].value); }
    return moving.length;
};

/* --------------------------------------------------- scene comp content */

/** Writes or updates the guide text layer with the scene name and notes. */
MCP.scenes.writeGuide = function (comp, notes) {
    var L = MCP.scenes.findLayerByName(comp, MCP.scenes.NOTES_LAYER);
    var text = comp.name + (notes ? "\r" + MCP.scenes.wrap(notes, 56) : "");
    if (L && !(L instanceof TextLayer)) { L = null; }
    if (!L) {
        L = comp.layers.addText(text);
        L.name = MCP.scenes.NOTES_LAYER;
        var prop = MCP.textDocProp(L), doc = prop.value;
        var size = Math.max(12, Math.round(comp.height / 30));
        MCP.applyTextStyle(doc, { fontSize: size, fillColor: MCP.scenes.contrast(comp.bgColor), justification: "left" });
        prop.setValue(doc);
        L.property("ADBE Transform Group").property("ADBE Position").setValue([Math.round(comp.width * 0.04), Math.round(comp.height * 0.05) + size]);
        L.guideLayer = true;
        L.locked = true;
        return L;
    }
    MCP.scenes.unlocked(L, function () {
        var p2 = MCP.textDocProp(L), d2 = p2.value;
        d2.text = text;
        if (p2.numKeys > 0) { p2.setValueAtTime(0, d2); } else { p2.setValue(d2); }
        if (L.outPoint < comp.duration) { L.outPoint = comp.duration; }
    });
    return L;
};

/** The solid used by the Background layers of a master's scenes, if any. */
MCP.scenes.backgroundSolid = function (seq) {
    for (var i = 0; i < seq.length; i++) {
        var L = MCP.scenes.findLayerByName(seq[i].source, MCP.scenes.BG_LAYER);
        var src = L ? _mcpTry(function () { return L.source; }, null) : null;
        if (src instanceof FootageItem) { return src; }
    }
    return null;
};

/** Adds the locked Background solid at the bottom of a scene comp, reusing one solid item for every scene. */
MCP.scenes.addBackground = function (comp, holder) {
    var L;
    if (holder.solid) {
        L = comp.layers.add(holder.solid, comp.duration);
    } else {
        L = comp.layers.addSolid(MCP.color.rgb(comp.bgColor), MCP.scenes.BG_SOLID, comp.width, comp.height, comp.pixelAspect, comp.duration);
        holder.solid = L.source;
    }
    L.name = MCP.scenes.BG_LAYER;
    L.moveToEnd();
    L.locked = true;
    return L;
};

/** Makes one scene comp with its background and guide. */
MCP.scenes.makeSceneComp = function (o) {
    var c = app.project.items.addComp(o.name, o.width, o.height, o.pixelAspect, o.duration, o.frameRate);
    c.parentFolder = o.folder;
    c.bgColor = o.bgColor;
    if (o.notes) { c.comment = o.notes; }
    if (o.background) { MCP.scenes.addBackground(c, o.holder); }
    if (o.guides) { MCP.scenes.writeGuide(c, o.notes); }
    return c;
};

/** Extends layers in a scene comp that ran to its old end. Returns their names. */
MCP.scenes.extendInner = function (comp, oldDur, newDur) {
    var out = [];
    if (newDur <= oldDur) { return out; }
    var fd = comp.frameDuration;
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (L.outPoint < oldDur - fd / 2 || L.outPoint >= newDur - MCP.scenes.EPS) { continue; }
        var target = Math.min(newDur, MCP.trans ? MCP.trans.maxOut(L) : newDur);
        if (target <= L.outPoint + MCP.scenes.EPS) { continue; }
        MCP.scenes.unlocked(L, function () { L.outPoint = target; });
        out.push(L.name);
    }
    return out;
};

/* ---------------------------------------------------------------- ripple */

/**
 * Moves the scene layers after seq[pos] by delta, plus the helper layers of
 * transitions anchored on them and (others) every other layer starting at or
 * after cutTime, and the comp markers from cutTime. exclude: layer ids kept.
 */
MCP.scenes.ripple = function (master, seq, pos, delta, cutTime, others, exclude) {
    var res = { scenes: [], others: [], markers: 0 };
    if (Math.abs(delta) < MCP.scenes.EPS) { return res; }
    var move = {}, isScene = {}, ex = {}, i, j;
    for (i = 0; i < seq.length; i++) { isScene[seq[i].id] = true; }
    for (i = pos + 1; i < seq.length; i++) { move[seq[i].id] = "scene"; }
    for (i = 0; i < (exclude || []).length; i++) { ex[exclude[i]] = true; }
    if (MCP.trans && MCP.trans.records) {
        var recs = MCP.trans.records(master);
        for (i = 0; i < recs.length; i++) {
            var r = recs[i].record;
            var anchored = (r.incoming && move[r.incoming.id]) || (r.cutRef && move[r.cutRef.layerId]);
            if (!anchored) { continue; }
            for (j = 0; j < (r.layers || []).length; j++) {
                if (r.layers[j].created && !isScene[r.layers[j].id]) { move[r.layers[j].id] = "helper"; }
            }
        }
    }
    if (others) {
        for (i = 1; i <= master.numLayers; i++) {
            var O = master.layer(i);
            if (move[O.id] || isScene[O.id] || ex[O.id]) { continue; }
            if (O.inPoint >= cutTime - MCP.scenes.EPS) { move[O.id] = "other"; }
        }
    }
    for (i = 1; i <= master.numLayers; i++) {
        var L = master.layer(i);
        var why = move[L.id];
        if (!why || ex[L.id]) { continue; }
        MCP.scenes.unlocked(L, function () { L.startTime = L.startTime + delta; });
        if (why === "scene") { res.scenes.push(L.name); } else { res.others.push({ name: L.name, role: why }); }
    }
    res.markers = MCP.scenes.shiftCompMarkers(master, cutTime, delta);
    return res;
};

/** Keeps the master as long as its sequence plus any tail it had after the last scene. */
MCP.scenes.fitMaster = function (master, oldEnd, newEnd) {
    var fd = master.frameDuration, oldDur = master.duration;
    var full = Math.abs(master.workAreaStart) < 1e-4 && Math.abs(master.workAreaDuration - oldDur) < fd;
    var tail = Math.max(0, oldDur - oldEnd);
    var nd = Math.max(fd, MCP.snapToFrame(master, newEnd + tail));
    if (Math.abs(nd - oldDur) > 1e-6) {
        if (nd < oldDur && master.workAreaStart + master.workAreaDuration > nd) {
            try {
                if (master.workAreaStart >= nd) { master.workAreaStart = 0; }
                master.workAreaDuration = Math.max(fd, nd - master.workAreaStart);
            } catch (e) {}
        }
        master.duration = nd;
    }
    if (full) { try { master.workAreaStart = 0; master.workAreaDuration = master.duration; } catch (e2) {} }
    return { before: MCP.round(oldDur), after: MCP.round(master.duration), afterFrames: MCP.frameOf(master, master.duration) };
};

/** Renumbers scene comps in sequence order. mode: true always, false never, undefined when any is numbered. */
MCP.scenes.renumber = function (seq, mode) {
    var renames = [], i, numbered = false;
    if (mode === false) { return renames; }
    for (i = 0; i < seq.length; i++) { if (MCP.scenes.isNumbered(seq[i].source.name)) { numbered = true; } }
    if (mode !== true && !numbered) { return renames; }
    for (i = 0; i < seq.length; i++) {
        var src = seq[i].source;
        var want = MCP.scenes.numberedName(i + 1, src.name, seq.length);
        if (src.name !== want) { renames.push({ from: src.name, to: want }); src.name = want; }
    }
    return renames;
};

/* ----------------------------------------------- transitions on the cuts */

/** Removes the transitions whose record passes test, and returns what is needed to rebuild them. */
MCP.scenes.detach = function (master, test, ctx) {
    var out = [];
    if (!MCP.trans || !MCP.has("removeTransition")) { return out; }
    var recs = MCP.trans.records(master);
    for (var i = 0; i < recs.length; i++) {
        var r = recs[i].record;
        if (!test(r)) { continue; }
        out.push({ id: r.id, kind: r.kind, cutFrame: MCP.frameOf(master, recs[i].time), record: r });
        MCP.invoke("removeTransition", { comp: { id: master.id }, id: r.id }, ctx);
    }
    return out;
};

MCP.scenes.touches = function (r, ids) {
    return !!((r.outgoing && ids[r.outgoing.id]) || (r.incoming && ids[r.incoming.id]));
};

/** Re-adds detached transitions at the cut their reference layer now has. */
MCP.scenes.rebuild = function (master, detached, ctx, notes) {
    var done = [];
    for (var i = 0; i < detached.length; i++) {
        var d = detached[i], r = d.record;
        var ref = r.cutRef ? MCP.trans.layerById(master, r.cutRef.layerId) : null;
        if (!ref || !r.args) { notes.push("Transition " + d.id + " (" + d.kind + ") was removed and could not be rebuilt: its layers are gone."); continue; }
        var args = MCP.extend({}, r.args);
        args.comp = { id: master.id };
        args.time = (r.cutRef.edge === "out" ? ref.outPoint : ref.inPoint) + Number(r.cutRef.offset || 0);
        try {
            if (d.kind === "carry") {
                var cr = MCP.invoke("carryElement", args, ctx);
                done.push({ previousId: d.id, id: cr.id, kind: "carry", cutFrame: cr.cutFrame });
            } else {
                args.outgoing = { id: r.outgoing.id };
                args.incoming = { id: r.incoming.id };
                var tr = MCP.invoke("addTransition", args, ctx);
                done.push({ previousId: d.id, id: tr.transition.id, kind: d.kind, cutFrame: tr.transition.cutFrame });
            }
        } catch (e) {
            notes.push("Transition " + d.id + " (" + d.kind + ") could not be rebuilt at the new cut: " + (e.message || e) + " Add it again with add-transition.");
        }
    }
    return done;
};

/** What a caller needs to add a removed transition again by hand. */
MCP.scenes.removedOut = function (detached) {
    var out = [];
    for (var i = 0; i < detached.length; i++) {
        var r = detached[i].record;
        out.push({ id: r.id, kind: r.kind, cutFrame: detached[i].cutFrame, outgoing: r.outgoing ? r.outgoing.name : null, incoming: r.incoming ? r.incoming.name : null, args: r.args || null });
    }
    return out;
};

/* --------------------------------------------------------------- reports */

MCP.scenes.info = function (master, L, position, marks) {
    var src = L.source;
    var notes = String(_mcpTry(function () { return src.comment; }, "") || "");
    var mk = marks ? marks[src.id] : null;
    return {
        position: position,
        name: src.name,
        bareName: MCP.scenes.bareName(src.name),
        compId: src.id,
        layer: MCP.serialize.layerRef(L),
        startTime: MCP.round(L.startTime),
        inPoint: MCP.round(L.inPoint), outPoint: MCP.round(L.outPoint),
        duration: MCP.round(L.outPoint - L.inPoint),
        inFrame: MCP.frameOf(master, L.inPoint), outFrame: MCP.frameOf(master, L.outPoint),
        durationFrames: MCP.frameOf(master, L.outPoint - L.inPoint),
        compDuration: MCP.round(src.duration),
        compDurationFrames: Math.round(src.duration * src.frameRate),
        notes: notes,
        transition: mk && mk.transition ? mk.transition : null
    };
};

/** Scenes with neighbour gaps and overlaps, plus problems. */
MCP.scenes.sequence = function (master, seq) {
    var marks = MCP.scenes.sceneMarkers(master), scenes = [], gaps = [], overlaps = [], issues = [], i;
    var fd = master.frameDuration;
    for (i = 0; i < seq.length; i++) {
        var L = seq[i], s = MCP.scenes.info(master, L, i + 1, marks);
        s.gapBeforeFrames = 0;
        if (i > 0) {
            var f = MCP.frameOf(master, L.inPoint - seq[i - 1].outPoint);
            s.gapBeforeFrames = f;
            if (f > 0) { gaps.push({ after: seq[i - 1].source.name, before: L.source.name, startFrame: MCP.frameOf(master, seq[i - 1].outPoint), frames: f }); }
            if (f < 0) { overlaps.push({ outgoing: seq[i - 1].source.name, incoming: L.source.name, startFrame: MCP.frameOf(master, L.inPoint), frames: -f }); }
        }
        var st = _mcpTry(function () { return L.stretch; }, 100);
        if (st !== 100) { issues.push({ scene: s.name, issue: "time-stretched", detail: "The scene layer plays at " + st + " %; ripple and transitions assume 100 %." }); }
        if (_mcpTry(function () { return L.timeRemapEnabled; }, false)) { issues.push({ scene: s.name, issue: "time-remapped", detail: "Time remapping is on; its length no longer follows the scene comp." }); }
        if (Math.abs(L.source.frameRate - master.frameRate) > 1e-3) { issues.push({ scene: s.name, issue: "frame-rate", detail: "The scene comp runs at " + L.source.frameRate + " fps in a " + master.frameRate + " fps master." }); }
        if (L.inPoint - L.startTime > fd / 2) { s.headTrimFrames = MCP.frameOf(master, L.inPoint - L.startTime); }
        var full = L.startTime + L.source.duration * (st > 0 ? st / 100 : 1);
        if (full - L.outPoint > fd / 2) { s.tailTrimFrames = MCP.frameOf(master, full - L.outPoint); }
        scenes.push(s);
    }
    return { scenes: scenes, gaps: gaps, overlaps: overlaps, issues: issues };
};

MCP.scenes.result = function (master, extra) {
    var det = MCP.scenes.sceneLayers(master);
    var sq = MCP.scenes.sequence(master, det.layers);
    var end = MCP.scenes.seqEnd(det.layers), start = det.layers.length ? det.layers[0].inPoint : 0;
    var out = {
        composition: { id: master.id, name: master.name, width: master.width, height: master.height, frameRate: master.frameRate, duration: MCP.round(master.duration), durationFrames: MCP.frameOf(master, master.duration) },
        folder: _mcpTry(function () { return master.parentFolder.id === app.project.rootFolder.id ? null : MCP.serialize.item(master.parentFolder); }, null),
        scenesFolder: det.folder ? MCP.serialize.item(det.folder) : null,
        rule: det.rule,
        count: sq.scenes.length,
        scenes: sq.scenes,
        totalDuration: MCP.round(end - start),
        totalFrames: MCP.frameOf(master, end - start)
    };
    if (extra) { MCP.extend(out, extra); }
    return out;
};

/* ------------------------------------------------------------- commands */

MCP.scenes.planSpecs = function (specs, fps) {
    var plan = [], start = 0, i;
    for (i = 0; i < specs.length; i++) {
        var s = specs[i] || {};
        var name = MCP.scenes.bareName(String(MCP.requireArg(s, "name")));
        if (!name) { MCP.fail("Scene " + (i + 1) + " needs a name with a word in it.", "invalid-argument"); }
        var frames = MCP.isDefined(s.durationFrames) ? Math.round(Number(s.durationFrames)) : Math.round(MCP.num(s.duration, 0) * fps);
        if (!(frames >= 1)) { MCP.fail("Scene '" + name + "' needs duration (seconds) or durationFrames.", "invalid-argument"); }
        var ov = i < specs.length - 1 ? Math.max(0, Math.round(MCP.num(s.overlapFrames, 0))) : 0;
        plan.push({ name: name, frames: frames, overlap: ov, notes: MCP.isDefined(s.notes) ? String(s.notes) : "", transition: MCP.isDefined(s.transition) ? String(s.transition) : null, startFrame: start });
        start += frames - ov;
    }
    for (i = 0; i < plan.length - 1; i++) {
        if (plan[i].overlap >= plan[i].frames || plan[i].overlap >= plan[i + 1].frames) {
            MCP.fail("Scene '" + plan[i].name + "' overlaps the next by " + plan[i].overlap + " frames; an overlap must be shorter than both scenes.", "invalid-argument");
        }
    }
    return plan;
};

MCP.scenes.updatePlan = function (master, args, ctx) {
    var mode = String(MCP.arg(args, "ifExists", "update"));
    var notes = [];
    if (mode === "report") {
        notes.push("A plan named '" + master.name + "' already exists; nothing was changed. Pass ifExists 'update' to apply the list.");
        return MCP.scenes.result(master, { created: false, existed: true, mode: "report", changes: [], notes: notes });
    }
    var specs = args.scenes, changes = [], overrides = {}, matched = {}, prevId = null, i, j;
    var fps = master.frameRate;
    if (MCP.isDefined(args.fps) && Math.abs(Number(args.fps) - fps) > 1e-3) { notes.push("The plan runs at " + fps + " fps; fps, size and background are not changed on update, and durations are counted at " + fps + " fps."); }
    var order = [];
    for (i = 0; i < specs.length; i++) {
        var s = specs[i] || {};
        var bare = MCP.scenes.bareName(String(MCP.requireArg(s, "name"))).toLowerCase();
        var seq = MCP.scenes.sceneLayers(master).layers;
        var hit = null;
        for (j = 0; j < seq.length; j++) {
            if (!matched[seq[j].source.id] && MCP.scenes.bareName(seq[j].source.name).toLowerCase() === bare) { hit = seq[j]; break; }
        }
        var frames = MCP.isDefined(s.durationFrames) ? Math.round(Number(s.durationFrames)) : Math.round(MCP.num(s.duration, 0) * fps);
        if (hit) {
            var src = hit.source;
            matched[src.id] = true;
            order.push(src.id);
            if (MCP.isDefined(s.notes) && String(s.notes) !== String(src.comment || "")) {
                src.comment = String(s.notes);
                if (MCP.bool(args.guides, true) || MCP.scenes.findLayerByName(src, MCP.scenes.NOTES_LAYER)) { MCP.scenes.writeGuide(src, String(s.notes)); }
                changes.push({ scene: src.name, change: "notes" });
            }
            if (MCP.isDefined(s.transition)) {
                var mk = MCP.scenes.sceneMarkers(master)[src.id];
                if (!mk || mk.transition !== String(s.transition)) { overrides[String(src.id)] = String(s.transition); changes.push({ scene: src.name, change: "transition", to: String(s.transition) }); }
            }
            var cur = Math.round(src.duration * src.frameRate);
            if (frames >= 1 && frames !== cur) {
                var rs = MCP.invoke("setSceneDuration", { comp: { id: master.id }, scene: { compId: src.id }, durationFrames: frames }, ctx);
                changes.push({ scene: src.name, change: "duration", fromFrames: cur, toFrames: frames, transitionsRebuilt: rs.transitionsRebuilt.length });
            }
            prevId = src.id;
        } else {
            var ins = { comp: { id: master.id }, name: s.name, durationFrames: frames, guides: args.guides, backgroundLayer: args.backgroundLayer };
            if (MCP.isDefined(s.notes)) { ins.notes = s.notes; }
            if (MCP.isDefined(s.transition)) { ins.transition = s.transition; }
            if (prevId !== null) { ins.after = { compId: prevId }; } else { ins.position = 1; }
            var ri = MCP.invoke("insertScene", ins, ctx);
            matched[ri.scene.compId] = true;
            order.push(ri.scene.compId);
            prevId = ri.scene.compId;
            changes.push({ scene: ri.scene.name, change: "inserted", position: ri.scene.position });
            if (MCP.isDefined(s.overlapFrames) && Number(s.overlapFrames) > 0) { notes.push("overlapFrames of the new scene '" + ri.scene.name + "' was not applied on update; use set-scene-duration or move the layer."); }
        }
    }
    var finalSeq = MCP.scenes.sceneLayers(master).layers, kept = [];
    for (i = 0; i < finalSeq.length; i++) { if (!matched[finalSeq[i].source.id]) { kept.push(finalSeq[i].source.name); } }
    var orderDiffers = false, at = {};
    for (i = 0; i < finalSeq.length; i++) { at[finalSeq[i].source.id] = i; }
    for (i = 1; i < order.length; i++) { if (at[order[i]] < at[order[i - 1]]) { orderDiffers = true; } }
    if (orderDiffers) { notes.push("The list orders some existing scenes differently from the master; their order was not changed."); }
    if (kept.length) { notes.push("Scenes not in the list were kept: " + kept.join(", ") + ". Use remove-scene to take one out."); }
    notes = notes.concat(MCP.scenes.syncMarkers(master, finalSeq, overrides));
    return MCP.scenes.result(master, { created: false, existed: true, mode: "update", changes: changes, kept: kept, orderDiffers: orderDiffers, notes: notes });
};

MCP.register("createScenePlan", function (args, ctx) {
    var film = String(MCP.requireArg(args, "filmName"));
    var specs = MCP.requireArg(args, "scenes");
    if (!MCP.isArray(specs) || !specs.length) { MCP.fail("scenes must be a non-empty array of {name, duration or durationFrames, notes, transition, overlapFrames}.", "invalid-argument"); }
    var existing = MCP.scenes.findMaster(film);
    if (existing) { return MCP.scenes.updatePlan(existing, args, ctx); }

    var fps = MCP.num(args.fps, 30), fd = 1 / fps;
    var W = Math.round(MCP.num(args.width, 1920)), H = Math.round(MCP.num(args.height, 1080)), pa = MCP.num(args.pixelAspect, 1);
    var bg = MCP.color.rgb(MCP.isDefined(args.backgroundColor) ? args.backgroundColor : "#000000");
    var folderName = String(MCP.arg(args, "folderName", MCP.scenes.DEFAULT_FOLDER));
    var plan = MCP.scenes.planSpecs(specs, fps);
    var totalFrames = 0, i;
    for (i = 0; i < plan.length; i++) { totalFrames = Math.max(totalFrames, plan[i].startFrame + plan[i].frames); }

    var createdFolders = [];
    var filmFolder = MCP.scenes.ensureFolder(null, film, createdFolders);
    var scenesFolder = MCP.scenes.ensureFolder(filmFolder, folderName, createdFolders);
    var master = app.project.items.addComp(film, W, H, pa, Math.max(fd, totalFrames * fd), fps);
    master.parentFolder = filmFolder;
    master.bgColor = bg;
    master.comment = MCP.scenes.masterComment(folderName);
    var holder = { solid: null }, overrides = {}, seq = [];
    for (i = 0; i < plan.length; i++) {
        var p = plan[i];
        var c = MCP.scenes.makeSceneComp({
            name: MCP.scenes.numberedName(i + 1, p.name, plan.length), width: W, height: H, pixelAspect: pa, duration: p.frames * fd, frameRate: fps,
            folder: scenesFolder, bgColor: bg, notes: p.notes, background: MCP.bool(args.backgroundLayer, true), guides: MCP.bool(args.guides, true), holder: holder
        });
        var L = master.layers.add(c);
        L.startTime = p.startFrame * fd;
        seq.push(L);
        if (p.transition) { overrides[String(c.id)] = p.transition; }
    }
    var notes = MCP.scenes.syncMarkers(master, seq, overrides);
    if (plan[plan.length - 1].transition) { notes.push("The last scene's transition has no next scene to go to; it is stored for later."); }
    return MCP.scenes.result(master, { created: true, existed: false, mode: "created", foldersCreated: createdFolders, changes: [], notes: notes });
}, { mutating: true });

MCP.register("listScenes", function (args) {
    var master = MCP.resolveComp(args.comp);
    var det = MCP.scenes.sceneLayers(master);
    var sq = MCP.scenes.sequence(master, det.layers);
    var used = {}, unplaced = [], i;
    for (i = 0; i < det.layers.length; i++) { used[det.layers[i].source.id] = true; }
    if (det.folder) {
        for (i = 1; i <= det.folder.numItems; i++) {
            var it = det.folder.item(i);
            if (it instanceof CompItem && !used[it.id]) { unplaced.push({ id: it.id, name: it.name }); }
        }
    }
    var transitions = [];
    if (MCP.trans && MCP.trans.records) {
        var recs = MCP.trans.records(master);
        for (i = 0; i < recs.length; i++) {
            var r = recs[i].record;
            transitions.push({ id: r.id, kind: r.kind, cutFrame: MCP.frameOf(master, recs[i].time), outgoing: r.outgoing ? r.outgoing.name : null, incoming: r.incoming ? r.incoming.name : null });
        }
        transitions.sort(function (a, b) { return a.cutFrame - b.cutFrame; });
    }
    var end = MCP.scenes.seqEnd(det.layers), start = det.layers.length ? det.layers[0].inPoint : 0;
    return {
        composition: { id: master.id, name: master.name, width: master.width, height: master.height, frameRate: master.frameRate, duration: MCP.round(master.duration), durationFrames: MCP.frameOf(master, master.duration) },
        isPlan: MCP.scenes.isMaster(master),
        scenesFolder: det.folder ? MCP.serialize.item(det.folder) : null,
        rule: det.rule,
        count: sq.scenes.length,
        scenes: sq.scenes,
        gaps: sq.gaps,
        overlaps: sq.overlaps,
        issues: sq.issues,
        unplaced: unplaced,
        transitions: transitions,
        totalDuration: MCP.round(end - start),
        totalFrames: MCP.frameOf(master, end - start)
    };
}, { mutating: false });

MCP.register("setSceneDuration", function (args, ctx) {
    var master = MCP.resolveComp(args.comp);
    var seq = MCP.scenes.sceneLayers(master).layers;
    var pos = MCP.scenes.resolveScene(master, seq, MCP.requireArg(args, "scene"));
    var L = seq[pos], src = L.source;
    var before = MCP.scenes.info(master, L, pos + 1, null);
    var d = MCP.durationArg(src, args, "duration", "durationFrames", null);
    if (!MCP.isDefined(d) || !(Number(d) > 0)) { MCP.fail("Give duration (seconds) or durationFrames greater than 0.", "invalid-argument"); }
    var newDur = Math.max(src.frameDuration, MCP.snapToFrame(src, Number(d)));
    if (Math.abs(newDur - src.duration) < src.frameDuration / 2) {
        return { composition: MCP.serialize.compRef(master), changed: false, scene: before, deltaFrames: 0, transitionsRebuilt: [], notes: ["The scene already lasts " + before.compDurationFrames + " frames."] };
    }
    var notes = [];
    var oldEnd = MCP.scenes.seqEnd(seq);
    var ids = {};
    ids[L.id] = true;
    var detached = MCP.scenes.detach(master, function (r) { return MCP.scenes.touches(r, ids); }, ctx);
    var oldOut = L.outPoint, oldDur = src.duration;
    src.duration = newDur;
    var extended = MCP.bool(args.extendLayers, true) ? MCP.scenes.extendInner(src, oldDur, newDur) : [];
    var st = _mcpTry(function () { return L.stretch; }, 100) / 100;
    MCP.scenes.unlocked(L, function () { L.outPoint = L.startTime + newDur * (st > 0 ? st : 1); });
    var delta = L.outPoint - oldOut;
    var moved = MCP.scenes.ripple(master, seq, pos, delta, oldOut, MCP.bool(args.rippleOtherLayers, true), [L.id]);
    var length = MCP.scenes.fitMaster(master, oldEnd, MCP.scenes.seqEnd(seq));
    notes = notes.concat(MCP.scenes.syncMarkers(master, seq, null));
    var rebuilt = MCP.scenes.rebuild(master, detached, ctx, notes);
    return MCP.scenes.result(master, {
        changed: true,
        scene: { before: before, after: MCP.scenes.info(master, L, pos + 1, MCP.scenes.sceneMarkers(master)) },
        deltaFrames: MCP.frameOf(master, delta),
        layersExtended: extended,
        moved: moved,
        masterLength: length,
        transitionsRebuilt: rebuilt,
        notes: notes
    });
}, { mutating: true });

MCP.register("insertScene", function (args, ctx) {
    var master = MCP.resolveComp(args.comp);
    var det = MCP.scenes.sceneLayers(master), seq = det.layers;
    var name = MCP.scenes.bareName(String(MCP.requireArg(args, "name")));
    if (!name) { MCP.fail("name needs a word, not only a number.", "invalid-argument"); }
    var fd = master.frameDuration;
    var d = MCP.durationArg(master, args, "duration", "durationFrames", null);
    if (!MCP.isDefined(d) || !(Number(d) > 0)) { MCP.fail("Give duration (seconds) or durationFrames greater than 0.", "invalid-argument"); }
    var dur = Math.max(fd, MCP.snapToFrame(master, Number(d)));
    var k;
    if (MCP.isDefined(args.after)) { k = MCP.scenes.resolveScene(master, seq, args.after) + 1; }
    else if (MCP.isDefined(args.before)) { k = MCP.scenes.resolveScene(master, seq, args.before); }
    else if (MCP.isDefined(args.position)) { k = Math.max(0, Math.min(seq.length, Math.round(Number(args.position)) - 1)); }
    else { k = seq.length; }
    var prev = k > 0 ? seq[k - 1] : null, next = k < seq.length ? seq[k] : null;
    var ov = Math.max(0, Math.round(MCP.num(args.overlapFrames, 0))) * fd;
    if (ov >= dur - fd / 2 || (prev && ov >= prev.outPoint - prev.inPoint - fd / 2)) { MCP.fail("overlapFrames must be shorter than the new scene and its neighbour.", "invalid-argument"); }
    var notes = [];
    var removed = [];
    if (prev && next) {
        removed = MCP.scenes.detach(master, function (r) { return !!(r.outgoing && r.incoming && r.outgoing.id === prev.id && r.incoming.id === next.id) || !!(r.kind === "carry" && r.outgoing && r.incoming && r.outgoing.id === prev.id && r.incoming.id === next.id); }, ctx);
        if (removed.length) { notes.push("The transition between '" + prev.source.name + "' and '" + next.source.name + "' was removed because they are no longer neighbours; transitionsRemoved has its arguments."); }
    }
    var oldEnd = MCP.scenes.seqEnd(seq);
    var start = prev ? prev.outPoint - ov : (next ? next.inPoint : 0);
    var delta = 0, cut = next ? next.inPoint : start;
    if (next) {
        var nextNew = prev ? start + dur + (next.inPoint - prev.outPoint) : start + dur - ov;
        delta = nextNew - next.inPoint;
    }
    var folder = det.folder || _mcpTry(function () { return master.parentFolder; }, null) || app.project.rootFolder;
    var hasBg = MCP.scenes.backgroundSolid(seq);
    var useBg = MCP.isDefined(args.backgroundLayer) ? MCP.bool(args.backgroundLayer, false) : !!hasBg;
    var numberedStyle = !seq.length;
    for (var q = 0; q < seq.length; q++) { if (MCP.scenes.isNumbered(seq[q].source.name)) { numberedStyle = true; } }
    var c = MCP.scenes.makeSceneComp({
        name: numberedStyle ? MCP.scenes.numberedName(k + 1, name, seq.length + 1) : name, width: master.width, height: master.height, pixelAspect: master.pixelAspect,
        duration: dur, frameRate: master.frameRate, folder: folder, bgColor: master.bgColor, notes: MCP.isDefined(args.notes) ? String(args.notes) : "",
        background: useBg, guides: MCP.bool(args.guides, true), holder: { solid: hasBg }
    });
    var L = master.layers.add(c);
    L.startTime = start;
    if (next) { L.moveAfter(next); }
    else if (prev) { MCP.animate.placeAbove(L, prev); }
    var moved = MCP.scenes.ripple(master, seq, k - 1, delta, cut, MCP.bool(args.rippleOtherLayers, true), [L.id]);
    var newSeq = MCP.scenes.sceneLayers(master).layers;
    var renames = MCP.scenes.renumber(newSeq, MCP.isDefined(args.renumber) ? MCP.bool(args.renumber, true) : (numberedStyle ? undefined : false));
    var length = MCP.scenes.fitMaster(master, oldEnd, MCP.scenes.seqEnd(newSeq));
    var overrides = {};
    if (MCP.isDefined(args.transition)) { overrides[String(c.id)] = String(args.transition); }
    notes = notes.concat(MCP.scenes.syncMarkers(master, newSeq, overrides));
    var pos = 0;
    for (var i = 0; i < newSeq.length; i++) { if (newSeq[i].id === L.id) { pos = i + 1; } }
    return MCP.scenes.result(master, {
        scene: MCP.scenes.info(master, L, pos, MCP.scenes.sceneMarkers(master)),
        renames: renames,
        deltaFrames: MCP.frameOf(master, delta),
        moved: moved,
        masterLength: length,
        transitionsRemoved: MCP.scenes.removedOut(removed),
        notes: notes
    });
}, { mutating: true });

MCP.register("removeScene", function (args, ctx) {
    var master = MCP.resolveComp(args.comp);
    var seq = MCP.scenes.sceneLayers(master).layers;
    var pos = MCP.scenes.resolveScene(master, seq, MCP.requireArg(args, "scene"));
    var L = seq[pos], src = L.source;
    var info = MCP.scenes.info(master, L, pos + 1, MCP.scenes.sceneMarkers(master));
    var ids = {};
    ids[L.id] = true;
    var removed = MCP.scenes.detach(master, function (r) { return MCP.scenes.touches(r, ids); }, ctx);
    var notes = [];
    var next = pos + 1 < seq.length ? seq[pos + 1] : null;
    var delta = next ? L.inPoint - next.inPoint : 0;
    var cut = next ? next.inPoint : L.outPoint;
    var oldEnd = MCP.scenes.seqEnd(seq);
    var inSpan = [], i;
    for (i = 1; i <= master.numLayers; i++) {
        var O = master.layer(i);
        if (O.index === L.index || MCP.scenes.isHelper(O)) { continue; }
        var isScene = false;
        for (var j = 0; j < seq.length; j++) { if (seq[j].index === O.index) { isScene = true; } }
        if (!isScene && O.inPoint >= L.inPoint - MCP.scenes.EPS && O.inPoint < cut - MCP.scenes.EPS) { inSpan.push(O.name); }
    }
    if (inSpan.length) { notes.push("These layers started inside the removed scene and were left in place: " + inSpan.join(", ") + "."); }
    var lid = L.id;
    MCP.scenes.unlocked(L, function () { L.remove(); });
    var rest = [];
    for (i = 0; i < seq.length; i++) { if (i !== pos) { rest.push(seq[i]); } }
    var moved = MCP.scenes.ripple(master, rest, pos - 1, delta, cut, MCP.bool(args.rippleOtherLayers, true), [lid]);
    var renames = MCP.scenes.renumber(rest, MCP.isDefined(args.renumber) ? MCP.bool(args.renumber, true) : undefined);
    var length = MCP.scenes.fitMaster(master, oldEnd, MCP.scenes.seqEnd(rest));
    notes = notes.concat(MCP.scenes.syncMarkers(master, rest, null));
    var compDeleted = false;
    if (MCP.bool(args.deleteComp, false)) {
        var users = _mcpTry(function () { return src.usedIn.length; }, 1);
        if (users === 0) { src.remove(); compDeleted = true; }
        else { notes.push("The scene comp is still used in " + users + " other comp(s), so it was kept."); }
    }
    return MCP.scenes.result(master, {
        removed: info,
        compDeleted: compDeleted,
        renames: renames,
        deltaFrames: MCP.frameOf(master, delta),
        moved: moved,
        masterLength: length,
        layersInRemovedSpan: inSpan,
        transitionsRemoved: MCP.scenes.removedOut(removed),
        notes: notes
    });
}, { mutating: true });

/* ------------------------------------------------------------ references */

MCP.scenes.footageByPath = function (fsName) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (!(it instanceof FootageItem)) { continue; }
        var f = _mcpTry(function () { return it.file ? it.file.fsName : null; }, null);
        if (f && f === fsName) { return it; }
    }
    return null;
};

/** Adds item to comp starting at t0, centred on center and fitted into a boxW x boxH box. */
MCP.scenes.placeReference = function (comp, item, t0, center, boxW, boxH, fit) {
    var still = item instanceof FootageItem && (_mcpTry(function () { return item.mainSource.isStill; }, false) || _mcpTry(function () { return item.duration === 0; }, false));
    var L = still ? comp.layers.add(item, comp.duration) : comp.layers.add(item);
    L.startTime = t0;
    var w = Math.max(1, _mcpTry(function () { return item.width; }, boxW)), h = Math.max(1, _mcpTry(function () { return item.height; }, boxH));
    var sx = boxW / w, sy = boxH / h, s;
    if (fit === "cover") { s = [Math.max(sx, sy), Math.max(sx, sy)]; }
    else if (fit === "stretch") { s = [sx, sy]; }
    else if (fit === "none") { s = [1, 1]; }
    else if (fit === "contain") { s = [Math.min(sx, sy), Math.min(sx, sy)]; }
    else { MCP.fail("fit must be contain, cover, stretch or none.", "invalid-argument"); }
    var tg = L.property("ADBE Transform Group");
    var cur = tg.property("ADBE Scale").value;
    var sv = [s[0] * 100, s[1] * 100];
    if (MCP.isArray(cur) && cur.length > 2) { sv.push(cur[2]); }
    tg.property("ADBE Scale").setValue(sv);
    tg.property("ADBE Position").setValue([center[0], center[1]]);
    return { layer: L, scale: [MCP.round(sv[0], 3), MCP.round(sv[1], 3)], sourceSize: [w, h] };
};

/** Rectangle mask on a layer that clips it to a comp-space box (layer without rotation). */
MCP.scenes.clipToBox = function (L, box) {
    var tg = L.property("ADBE Transform Group");
    var p = tg.property("ADBE Position").value, a = tg.property("ADBE Anchor Point").value, s = tg.property("ADBE Scale").value;
    var toLayer = function (x, y) { return [(x - p[0]) / (s[0] / 100) + a[0], (y - p[1]) / (s[1] / 100) + a[1]]; };
    var tl = toLayer(box[0], box[1]), br = toLayer(box[0] + box[2], box[1] + box[3]);
    var m = L.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
    m.name = "Review Clip";
    var sh = new Shape();
    sh.vertices = [[tl[0], tl[1]], [br[0], tl[1]], [br[0], br[1]], [tl[0], br[1]]];
    sh.closed = true;
    L.property("ADBE Mask Parade").property(1).property("ADBE Mask Shape").setValue(sh);
};

MCP.scenes.label = function (comp, text, x, size) {
    var T = comp.layers.addText(text);
    var prop = MCP.textDocProp(T), doc = prop.value;
    MCP.applyTextStyle(doc, { fontSize: size, fillColor: [1, 1, 1], strokeColor: [0, 0, 0], strokeWidth: Math.max(2, Math.round(size / 10)), justification: "left" });
    prop.setValue(doc);
    T.property("ADBE Transform Group").property("ADBE Position").setValue([x + Math.round(size * 0.8), Math.round(size * 0.8) + size]);
    T.name = "Label: " + text;
    return T;
};

MCP.register("addReferenceOverlay", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var item = null, imported = false;
    if (MCP.isDefined(args.item)) {
        item = MCP.resolveItem(args.item);
        if (item instanceof FolderItem) { MCP.fail("'" + item.name + "' is a folder; give a footage item or a composition.", "invalid-argument"); }
        if (item.id === comp.id) { MCP.fail("A composition cannot be its own reference.", "invalid-argument"); }
    } else {
        var file = new File(String(MCP.requireArg(args, "path")));
        if (!file.exists) { MCP.fail("File not found: " + file.fsName, "not-found"); }
        item = MCP.scenes.footageByPath(file.fsName);
        if (!item) {
            var folder = MCP.scenes.ensureFolder(null, MCP.scenes.REF_FOLDER, []);
            var res = MCP.project.importOne(file.fsName, {}, folder);
            item = app.project.itemByID(res.item.id);
            imported = true;
        }
    }
    var fit = String(MCP.arg(args, "fit", "contain"));
    var blend = String(MCP.arg(args, "blendMode", "normal"));
    if (blend !== "normal" && blend !== "difference") { MCP.fail("blendMode must be normal or difference.", "invalid-argument"); }
    var t0 = MCP.durationArg(comp, args, "startTime", "startFrame", 0);
    var name = MCP.isDefined(args.name) ? String(args.name) : "Reference: " + item.name;
    var labelIdx = MCP.enums.labelIndex(MCP.arg(args, "label", "red"));
    var notes = [];
    if (_mcpTry(function () { return Math.abs(item.pixelAspect - comp.pixelAspect) > 1e-3; }, false)) { notes.push("The reference's pixel aspect differs from the comp's; the fit uses its pixel size."); }

    if (!MCP.bool(args.sideBySide, false)) {
        var placed = MCP.scenes.placeReference(comp, item, t0, [comp.width / 2, comp.height / 2], comp.width, comp.height, fit);
        var L = placed.layer;
        L.name = name;
        L.comment = "[reference]";
        L.guideLayer = true;
        L.property("ADBE Transform Group").property("ADBE Opacity").setValue(MCP.num(args.opacity, blend === "difference" ? 100 : 50));
        L.blendingMode = MCP.enums.blendModeValue(blend);
        L.label = labelIdx;
        if (!MCP.bool(args.audio, true)) { try { if (L.hasAudio) { L.audioEnabled = false; } } catch (e0) {} }
        L.moveToBeginning();
        if (MCP.bool(args.locked, true)) { L.locked = true; }
        return {
            composition: MCP.serialize.compRef(comp), mode: "overlay", item: MCP.serialize.item(item), imported: imported,
            layer: MCP.serialize.layer(L), fit: { mode: fit, scale: placed.scale, sourceSize: placed.sourceSize },
            startTime: MCP.round(t0), startFrame: MCP.frameOf(comp, t0), notes: notes
        };
    }

    var gap = Math.max(0, Math.round(MCP.num(args.gap, 0)));
    var W = comp.width, H = comp.height;
    var review = app.project.items.addComp(MCP.scenes.uniqueCompName(comp.name + " Review"), 2 * W + gap, H, comp.pixelAspect, comp.duration, comp.frameRate);
    try { review.parentFolder = comp.parentFolder; } catch (e1) {}
    review.bgColor = comp.bgColor;
    var refLeft = String(MCP.arg(args, "referenceSide", "left")) === "left";
    var refX = refLeft ? W / 2 : W + gap + W / 2, compX = refLeft ? W + gap + W / 2 : W / 2;
    var CL = review.layers.add(comp);
    CL.property("ADBE Transform Group").property("ADBE Position").setValue([compX, H / 2]);
    var rp = MCP.scenes.placeReference(review, item, t0, [refX, H / 2], W, H, fit);
    var RL = rp.layer;
    RL.name = name;
    RL.comment = "[reference]";
    RL.label = labelIdx;
    RL.property("ADBE Transform Group").property("ADBE Opacity").setValue(MCP.num(args.opacity, 100));
    if (blend === "difference") { notes.push("blendMode difference has no effect side by side; the reference is shown normally."); }
    if (!MCP.bool(args.audio, true)) { try { if (RL.hasAudio) { RL.audioEnabled = false; } } catch (e2) {} }
    if (fit === "cover" || fit === "none") { MCP.scenes.clipToBox(RL, [refLeft ? 0 : W + gap, 0, W, H]); }
    var labelLayers = [], labels = [], li;
    if (MCP.bool(args.labels, true)) {
        var size = Math.max(14, Math.round(H / 36));
        labelLayers.push(MCP.scenes.label(review, "Reference", refLeft ? 0 : W + gap, size));
        labelLayers.push(MCP.scenes.label(review, comp.name, refLeft ? W + gap : 0, size));
    }
    for (li = 0; li < labelLayers.length; li++) { labels.push(MCP.serialize.layerRef(labelLayers[li])); }
    if (MCP.bool(args.locked, true)) { RL.locked = true; CL.locked = true; }
    return {
        composition: MCP.serialize.compRef(comp), mode: "side-by-side", item: MCP.serialize.item(item), imported: imported,
        reviewComp: MCP.serialize.comp(review),
        layers: { reference: MCP.serialize.layerRef(RL), comp: MCP.serialize.layerRef(CL), labels: labels },
        fit: { mode: fit, scale: rp.scale, sourceSize: rp.sourceSize },
        referenceSide: refLeft ? "left" : "right",
        startTime: MCP.round(t0), startFrame: MCP.frameOf(comp, t0), notes: notes
    };
}, { mutating: true });
