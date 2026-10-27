/*
 * Project check commands: a construction audit of a composition (and its
 * nested comps), cache purging, saving the next version of the project file,
 * and sorting project items into folders by type.
 *
 * The audit reads key times, key interpolation types and expression state,
 * never per-frame values, so it stays fast on large compositions. It never
 * touches gradient colour properties: reading them raises a modal error.
 */

MCP.check = {};

MCP.check.ALL_CHECKS = ["frame-by-frame", "hold-ladders", "source-text-keys", "short-layers", "name-stems", "expression-errors", "missing-footage", "missing-fonts", "effects", "precomp-duration", "outside-comp", "key-counts"];

MCP.check.DEFAULT_LIMITS = { consecutiveKeys: 3, holdKeys: 3, sourceTextKeys: 3, shortLayerFrames: 3, nameStemCount: 3, topKeyCounts: 5, maxFindings: 200, maxDepth: 4, maxComps: 50 };

MCP.check.SEVERITY_RANK = { "error": 0, "warning": 1, "info": 2 };

/** Findings kept in memory before sorting; the total is still counted past it. */
MCP.check.HARD_CAP = 5000;

/** Custom-value properties that must never be read (a modal error a try/catch cannot catch). */
MCP.check.UNSAFE = { "ADBE Vector Grad Colors": true, "outerGlow/gradient": true, "innerGlow/gradient": true, "gradientFill/gradient": true };

MCP.check.TEXT_DOCUMENT = "ADBE Text Document";

/** Properties whose keys are not animation (markers). */
MCP.check.NOT_ANIMATION = { "ADBE Marker": true };

/* ------------------------------------------------------------------ helpers */

MCP.check.limits = function (raw) {
    var out = {};
    var d = MCP.check.DEFAULT_LIMITS;
    for (var k in d) {
        if (!Object.prototype.hasOwnProperty.call(d, k)) { continue; }
        out[k] = (raw && MCP.isDefined(raw[k])) ? Number(raw[k]) : d[k];
    }
    return out;
};

MCP.check.enabledChecks = function (list) {
    var on = {};
    var i;
    if (MCP.isArray(list) && list.length) {
        for (i = 0; i < list.length; i++) {
            if (MCP.check.ALL_CHECKS.indexOf(String(list[i])) === -1) {
                MCP.fail("Unknown check '" + list[i] + "'. Use: " + MCP.check.ALL_CHECKS.join(", "), "invalid-argument");
            }
            on[String(list[i])] = true;
        }
    } else {
        for (i = 0; i < MCP.check.ALL_CHECKS.length; i++) { on[MCP.check.ALL_CHECKS[i]] = true; }
    }
    return on;
};

/** Visits every leaf property under root (depth-limited), skipping unsafe ones. visit(prop, matchName). */
MCP.check.walk = function (root, visit, depth) {
    if (depth > 14) { return; }
    var n = 0;
    try { n = root.numProperties; } catch (e0) { return; }
    for (var i = 1; i <= n; i++) {
        var p = null;
        try { p = root.property(i); } catch (e1) { p = null; }
        if (!p) { continue; }
        var mn = "";
        try { mn = String(p.matchName); } catch (e2) { mn = ""; }
        if (MCP.check.UNSAFE[mn]) { continue; }
        var type = null;
        try { type = p.propertyType; } catch (e3) { type = null; }
        if (type === PropertyType.PROPERTY) { visit(p, mn); }
        else { MCP.check.walk(p, visit, depth + 1); }
    }
};

/** Name stem for grouping: trailing numbers, "copy" and separators removed, lower case. */
MCP.check.nameStem = function (name) {
    var s = String(name).replace(/^\s+|\s+$/g, "");
    var prev = null;
    while (prev !== s) {
        prev = s;
        s = s.replace(/[\s_.\-]*\d+$/, "").replace(/[\s_.\-]*copy$/i, "");
    }
    s = s.toLowerCase();
    return s.length ? s : "#";
};

/**
 * Runs of keys on consecutive frames, from key frame numbers.
 * Returns [{start: index, length}] for runs of at least minRun keys.
 */
MCP.check.consecutiveRuns = function (frames, minRun) {
    var runs = [];
    var start = 0;
    for (var i = 1; i <= frames.length; i++) {
        var continues = i < frames.length && (frames[i] - frames[i - 1]) <= 1;
        if (!continues) {
            var len = i - start;
            if (len >= minRun) { runs.push({ start: start, length: len }); }
            start = i;
        }
    }
    return runs;
};

/**
 * Runs of hold keys: consecutive keys whose outgoing interpolation is hold.
 * holds[i] is true when key i holds. The last key never counts (nothing follows it).
 * Returns [{start, length}] for runs of at least minRun hold keys.
 */
MCP.check.holdRuns = function (holds, minRun) {
    var runs = [];
    var start = -1;
    var n = holds.length - 1;
    for (var i = 0; i <= n; i++) {
        var h = i < n && holds[i];
        if (h && start === -1) { start = i; }
        if (!h && start !== -1) {
            if (i - start >= minRun) { runs.push({ start: start, length: i - start }); }
            start = -1;
        }
    }
    return runs;
};

MCP.check.sameValue = function (a, b) {
    if (typeof a === "number" && typeof b === "number") { return Math.abs(a - b) < 1e-9; }
    if (MCP.isArray(a) && MCP.isArray(b)) {
        if (a.length !== b.length) { return false; }
        for (var i = 0; i < a.length; i++) { if (!MCP.check.sameValue(a[i], b[i])) { return false; } }
        return true;
    }
    if (typeof a === "string" || typeof a === "boolean") { return a === b; }
    return false;
};

/** Precomp source time range [min, max] used by a layer without time remapping. */
MCP.check.sourceRange = function (layer) {
    var stretch = Number(_mcpTry(function () { return layer.stretch; }, 100)) || 100;
    var a = (layer.inPoint - layer.startTime) * 100 / stretch;
    var b = (layer.outPoint - layer.startTime) * 100 / stretch;
    return { min: Math.min(a, b), max: Math.max(a, b) };
};

MCP.check.fmt = function (seconds) {
    return String(MCP.round(seconds, 2)) + " s";
};

/* ------------------------------------------------------------ audit state */

MCP.check.newState = function (args) {
    return {
        on: MCP.check.enabledChecks(args.checks),
        limits: MCP.check.limits(args.limits),
        findings: [],
        counts: { error: 0, warning: 0, info: 0 },
        total: 0,
        notes: [],
        keyed: [],
        totalKeys: 0,
        expressions: 0,
        compOrder: {},
        effectOk: {},
        fontCache: {},
        missingFontLayers: null,
        fontMode: null
    };
};

MCP.check.add = function (state, f) {
    state.total++;
    state.counts[f.severity] = (state.counts[f.severity] || 0) + 1;
    if (state.findings.length < MCP.check.HARD_CAP) { state.findings.push(f); }
};

MCP.check.finding = function (check, severity, comp, layer, extra) {
    var f = {
        check: check,
        severity: severity,
        comp: MCP.serialize.compRef(comp),
        layer: layer ? MCP.serialize.layerRef(layer) : null,
        property: null,
        time: null,
        frame: null,
        message: "",
        fix: ""
    };
    if (extra) { MCP.extend(f, extra); }
    return f;
};

/* ------------------------------------------------------------------ fonts */

/** Builds {layerId: [{font, time}]} from app.project.usedFonts (After Effects 24.5+), or null. */
MCP.check.missingFontsByLayer = function () {
    var used = _mcpTry(function () { return app.project.usedFonts; }, null);
    if (!used || !MCP.isDefined(used.length)) { return null; }
    var out = {};
    for (var i = 0; i < used.length; i++) {
        var entry = used[i];
        var font = _mcpTry(function () { return entry.font; }, null);
        if (!font) { continue; }
        var ps = String(_mcpTry(function () { return font.postScriptName; }, ""));
        var missing = _mcpTry(function () { return font.isSubstitute === true; }, false);
        if (!missing && ps && app.fonts && typeof app.fonts.getFontsByPostScriptName === "function") {
            var found = _mcpTry(function () { return app.fonts.getFontsByPostScriptName(ps); }, null);
            if (found && found.length === 0) { missing = true; }
        }
        if (!missing) { continue; }
        var at = _mcpTry(function () { return entry.usedAt; }, []) || [];
        for (var j = 0; j < at.length; j++) {
            var id = _mcpTry(function () { return at[j].layerID; }, null);
            if (id === null) { continue; }
            if (!out[id]) { out[id] = []; }
            out[id].push({ font: ps, layerTime: _mcpTry(function () { return at[j].layerTimeD; }, null) });
        }
    }
    return out;
};

/** True when a PostScript font name is not installed (After Effects 24.0+ font API), null when unknown. */
MCP.check.fontMissing = function (state, doc) {
    var ps = String(_mcpTry(function () { return doc.font; }, ""));
    if (!ps) { return null; }
    if (Object.prototype.hasOwnProperty.call(state.fontCache, ps)) { return state.fontCache[ps] ? ps : null; }
    var missing = false;
    var fo = _mcpTry(function () { return doc.fontObject; }, null);
    if (fo && _mcpTry(function () { return fo.isSubstitute === true; }, false)) { missing = true; }
    if (!missing && app.fonts && typeof app.fonts.getFontsByPostScriptName === "function") {
        var found = _mcpTry(function () { return app.fonts.getFontsByPostScriptName(ps); }, null);
        if (found && found.length === 0) { missing = true; }
    }
    state.fontCache[ps] = missing;
    return missing ? ps : null;
};

MCP.check.checkFonts = function (state, comp, layer, docProp) {
    var fix = "Install the font, or swap it with relink-fonts (list-fonts shows what is installed).";
    var i;
    if (state.fontMode === "project") {
        var id = _mcpTry(function () { return layer.id; }, null);
        var list = (id !== null && state.missingFontLayers) ? state.missingFontLayers[id] : null;
        if (!list) { return; }
        var seen = {};
        for (i = 0; i < list.length; i++) {
            if (seen[list[i].font]) { continue; }
            seen[list[i].font] = true;
            var lt = list[i].layerTime;
            var t = (typeof lt === "number") ? layer.startTime + lt : null;
            MCP.check.add(state, MCP.check.finding("missing-fonts", "error", comp, layer, {
                property: "Text/Source Text", time: t === null ? null : MCP.round(t), frame: t === null ? null : MCP.frameOf(comp, t),
                font: list[i].font,
                message: "Font '" + list[i].font + "' is not installed; After Effects draws a substitute.", fix: fix
            }));
        }
        return;
    }
    if (state.fontMode !== "layer") { return; }
    var docs = [];
    var nk = _mcpTry(function () { return docProp.numKeys; }, 0);
    if (nk > 0) {
        for (i = 1; i <= nk && i <= 20; i++) { docs.push({ doc: _mcpTry(function () { return docProp.keyValue(i); }, null), time: _mcpTry(function () { return docProp.keyTime(i); }, null) }); }
    } else {
        docs.push({ doc: _mcpTry(function () { return docProp.value; }, null), time: null });
    }
    var reported = {};
    for (i = 0; i < docs.length; i++) {
        if (!docs[i].doc) { continue; }
        var ps = MCP.check.fontMissing(state, docs[i].doc);
        if (!ps || reported[ps]) { continue; }
        reported[ps] = true;
        MCP.check.add(state, MCP.check.finding("missing-fonts", "error", comp, layer, {
            property: "Text/Source Text", time: docs[i].time === null ? null : MCP.round(docs[i].time), frame: docs[i].time === null ? null : MCP.frameOf(comp, docs[i].time),
            font: ps,
            message: "Font '" + ps + "' is not installed; After Effects draws a substitute.", fix: fix
        }));
    }
};

/* ------------------------------------------------------------- properties */

MCP.check.checkKeys = function (state, comp, layer, prop, mn) {
    var on = state.on, L = state.limits;
    var nk = 0;
    try { nk = prop.numKeys; } catch (e0) { nk = 0; }
    if (nk > 0) {
        state.totalKeys += nk;
        state.keyed.push({ comp: comp, layer: layer, prop: prop, numKeys: nk });
    }
    var isText = mn === MCP.check.TEXT_DOCUMENT;
    var path = null;
    var pathOf = function () { if (path === null) { path = MCP.pathOf(prop).path; } return path; };
    var i;
    if (isText && on["source-text-keys"] && nk >= L.sourceTextKeys) {
        var t0 = prop.keyTime(1);
        MCP.check.add(state, MCP.check.finding("source-text-keys", "warning", comp, layer, {
            property: pathOf(), time: MCP.round(t0), frame: MCP.frameOf(comp, t0), count: nk,
            message: "Source Text has " + nk + " keys: typing or word changes faked by swapping the text.",
            fix: "Keep one text value and reveal it with a Typewriter or range-selector animator (typewriter-text, word-by-word-reveal)."
        }));
    }
    if (isText && on["missing-fonts"]) { MCP.check.checkFonts(state, comp, layer, prop); }
    var flaggedFrames = false;
    if (on["frame-by-frame"] && nk >= L.consecutiveKeys) {
        var frames = [];
        for (i = 1; i <= nk; i++) { frames.push(MCP.frameOf(comp, prop.keyTime(i))); }
        var runs = MCP.check.consecutiveRuns(frames, L.consecutiveKeys);
        if (runs.length) {
            flaggedFrames = true;
            var longest = runs[0], inRuns = 0;
            for (i = 0; i < runs.length; i++) { inRuns += runs[i].length; if (runs[i].length > longest.length) { longest = runs[i]; } }
            var ts = prop.keyTime(runs[0].start + 1);
            MCP.check.add(state, MCP.check.finding("frame-by-frame", "error", comp, layer, {
                property: pathOf(), time: MCP.round(ts), frame: frames[runs[0].start], endFrame: frames[runs[0].start + runs[0].length - 1],
                count: inRuns, runs: runs.length, longestRun: longest.length, longestRunFrame: frames[longest.start],
                message: inRuns + " of " + nk + " keys sit on consecutive frames (" + runs.length + (runs.length === 1 ? " run" : " runs") + ", longest " + longest.length + " keys from frame " + frames[longest.start] + "): frame-by-frame animation.",
                fix: "Replace the run with 2 or 3 eased keys, an expression, or a native tool (animator, Trim Paths, time remap)."
            }));
        }
    }
    if (on["hold-ladders"] && !isText && !flaggedFrames && nk >= L.holdKeys + 1) {
        var holdOnly = _mcpTry(function () { return !prop.isInterpolationTypeValid(KeyframeInterpolationType.LINEAR); }, false);
        if (!holdOnly) {
            var holds = [];
            for (i = 1; i <= nk; i++) { holds.push(_mcpTry(function () { return prop.keyOutInterpolationType(i) === KeyframeInterpolationType.HOLD; }, false)); }
            var hr = MCP.check.holdRuns(holds, L.holdKeys);
            for (var r = 0; r < hr.length; r++) {
                var run = hr[r];
                var moving = false;
                var first = _mcpTry(function () { return prop.keyValue(run.start + 1); }, null);
                for (i = run.start + 2; i <= run.start + run.length + 1 && i <= nk && !moving; i++) {
                    var v = _mcpTry(function () { return prop.keyValue(i); }, null);
                    if (!MCP.check.sameValue(first, v)) { moving = true; }
                }
                if (!moving) { continue; }
                var th = prop.keyTime(run.start + 1);
                MCP.check.add(state, MCP.check.finding("hold-ladders", "warning", comp, layer, {
                    property: pathOf(), time: MCP.round(th), frame: MCP.frameOf(comp, th), endFrame: MCP.frameOf(comp, prop.keyTime(run.start + run.length)),
                    count: run.length,
                    message: run.length + " hold keys in a row step the value: a hold-key ladder standing in for motion.",
                    fix: "Use two eased keys for the move; keep hold keys only for real state changes."
                }));
            }
        }
    }
};

MCP.check.checkExpression = function (state, comp, layer, prop) {
    var can = false;
    try { can = prop.canSetExpression; } catch (e0) { can = false; }
    if (!can) { return; }
    var expr = "";
    try { expr = prop.expression; } catch (e1) { expr = ""; }
    if (!expr) { return; }
    state.expressions++;
    if (!state.on["expression-errors"]) { return; }
    var err = _mcpTry(function () { return prop.expressionError || ""; }, "");
    if (!err) { return; }
    MCP.check.add(state, MCP.check.finding("expression-errors", "error", comp, layer, {
        property: MCP.pathOf(prop).path,
        enabled: _mcpTry(function () { return prop.expressionEnabled; }, null),
        message: "Expression error: " + String(err).substr(0, 200),
        fix: "Fix the expression (get-expression, set-expression) or remove it (remove-expression); a disabled expression must be enabled again after the fix."
    }));
};

/* ----------------------------------------------------------------- layers */

MCP.check.auditLayer = function (state, comp, layer, queue, depth) {
    var on = state.on, L = state.limits;
    var fd = MCP.frameDuration(comp);
    var src = _mcpTry(function () { return layer.source; }, null);
    var outside = layer.outPoint <= 1e-9 || layer.inPoint >= comp.duration - 1e-9;
    if (outside && on["outside-comp"]) {
        MCP.check.add(state, MCP.check.finding("outside-comp", "info", comp, layer, {
            time: MCP.round(layer.inPoint), frame: MCP.frameOf(comp, layer.inPoint), endFrame: MCP.frameOf(comp, layer.outPoint),
            message: "Layer runs from " + MCP.check.fmt(layer.inPoint) + " to " + MCP.check.fmt(layer.outPoint) + ", outside the comp (0 to " + MCP.check.fmt(comp.duration) + "): it never shows.",
            fix: "Delete it or move it into the comp's time range (set-layer-timing)."
        }));
    }
    if (!outside && on["short-layers"]) {
        var frames = Math.round((layer.outPoint - layer.inPoint) / fd);
        if (frames <= L.shortLayerFrames) {
            MCP.check.add(state, MCP.check.finding("short-layers", "warning", comp, layer, {
                time: MCP.round(layer.inPoint), frame: MCP.frameOf(comp, layer.inPoint), count: frames,
                message: "Layer is only " + frames + (frames === 1 ? " frame" : " frames") + " long: usually a per-frame copy.",
                fix: "Animate one layer through the whole span instead of swapping short copies (a state change is a key, not a new layer)."
            }));
        }
    }
    if (on["missing-footage"] && src && src instanceof FootageItem && _mcpTry(function () { return src.footageMissing; }, false)) {
        var missingPath = _mcpTry(function () { return src.mainSource.missingFootagePath; }, null) || _mcpTry(function () { return src.file ? src.file.fsName : null; }, null);
        MCP.check.add(state, MCP.check.finding("missing-footage", "error", comp, layer, {
            item: { id: src.id, name: src.name }, path: missingPath,
            message: "Footage '" + src.name + "' is missing" + (missingPath ? " (" + missingPath + ")" : "") + ".",
            fix: "Relink it with replace-footage, or File > Dependencies > Find Missing Footage."
        }));
    }
    if (src && src instanceof CompItem) {
        if (on["precomp-duration"]) {
            var half = fd / 2;
            var remap = _mcpTry(function () { return layer.timeRemapEnabled; }, false);
            var maxUse = null;
            if (remap) {
                var tr = _mcpTry(function () { return layer.property("ADBE Time Remapping"); }, null);
                var nk = tr ? _mcpTry(function () { return tr.numKeys; }, 0) : 0;
                for (var k = 1; k <= nk; k++) {
                    var kv = Number(_mcpTry(function () { return tr.keyValue(k); }, 0));
                    if (maxUse === null || kv > maxUse) { maxUse = kv; }
                }
            } else {
                maxUse = MCP.check.sourceRange(layer).max;
            }
            if (maxUse !== null && maxUse > src.duration + half) {
                MCP.check.add(state, MCP.check.finding("precomp-duration", "warning", comp, layer, {
                    time: MCP.round(layer.inPoint), frame: MCP.frameOf(comp, layer.inPoint),
                    item: { id: src.id, name: src.name, duration: MCP.round(src.duration) },
                    message: "Precomp '" + src.name + "' is " + MCP.check.fmt(src.duration) + " long but this layer uses it up to " + MCP.check.fmt(maxUse) + (remap ? " through time remapping" : "") + ": it shows nothing after the end.",
                    fix: "Lengthen the precomp (set-composition-settings duration) or trim the layer (set-layer-timing)."
                }));
            }
        }
        if (queue && depth < L.maxDepth) { queue.push({ comp: src, depth: depth + 1 }); }
    }
    if (on["effects"]) {
        var fx = _mcpTry(function () { return layer.property("ADBE Effect Parade"); }, null);
        var nfx = fx ? _mcpTry(function () { return fx.numProperties; }, 0) : 0;
        for (var e = 1; e <= nfx; e++) {
            var eff = _mcpTry(function () { return fx.property(e); }, null);
            if (!eff) { continue; }
            var emn = String(_mcpTry(function () { return eff.matchName; }, ""));
            if (state.effectOk[emn] !== true) {
                var ok = _mcpTry(function () { return fx.canAddProperty(emn); }, true);
                if (ok) { state.effectOk[emn] = true; }
                else {
                    MCP.check.add(state, MCP.check.finding("effects", "warning", comp, layer, {
                        property: "Effects/" + eff.name, matchName: emn,
                        message: "Effect '" + eff.name + "' (" + emn + ") is not installed: it renders nothing.",
                        fix: "Install the plug-in, or replace the effect with an installed one (list-available-effects)."
                    }));
                    continue;
                }
            }
            if (_mcpTry(function () { return eff.enabled === false; }, false)) {
                MCP.check.add(state, MCP.check.finding("effects", "warning", comp, layer, {
                    property: "Effects/" + eff.name, matchName: emn,
                    message: "Effect '" + eff.name + "' is switched off.",
                    fix: "Turn it on (toggle-effect) or remove it (remove-effect) so the comp holds only what renders."
                }));
            }
        }
    }
    var needWalk = on["frame-by-frame"] || on["hold-ladders"] || on["source-text-keys"] || on["missing-fonts"] || on["expression-errors"] || on["key-counts"];
    if (needWalk) {
        MCP.check.walk(layer, function (prop, mn) {
            if (!MCP.check.NOT_ANIMATION[mn]) { MCP.check.checkKeys(state, comp, layer, prop, mn); }
            MCP.check.checkExpression(state, comp, layer, prop);
        }, 0);
    }
};

MCP.check.auditComp = function (state, comp, queue, depth) {
    var on = state.on, L = state.limits;
    var stems = {}, order = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        MCP.check.auditLayer(state, comp, layer, queue, depth);
        if (on["name-stems"]) {
            var stem = MCP.check.nameStem(layer.name);
            if (!stems[stem]) { stems[stem] = []; order.push(stem); }
            stems[stem].push(layer);
        }
    }
    if (on["name-stems"]) {
        for (var s = 0; s < order.length; s++) {
            var group = stems[order[s]];
            if (group.length < L.nameStemCount) { continue; }
            var refs = [];
            for (var j = 0; j < group.length && j < 12; j++) { refs.push(MCP.serialize.layerRef(group[j])); }
            MCP.check.add(state, MCP.check.finding("name-stems", "warning", comp, group[0], {
                count: group.length, stem: order[s], layers: refs,
                message: group.length + " layers share the name stem '" + order[s] + "' (" + group[0].name + ", " + group[1].name + ", ...): per-frame copies or loose copies of one object.",
                fix: "Make the object one component (create-component) and place instances, or use one layer with a repeater or animator."
            }));
        }
    }
};

/** Info findings for the properties with the most keys. */
MCP.check.keyCountFindings = function (state) {
    var top = state.keyed.slice(0);
    top.sort(function (a, b) { return b.numKeys - a.numKeys; });
    var out = [];
    for (var i = 0; i < top.length && i < state.limits.topKeyCounts; i++) {
        var k = top[i];
        var path = MCP.pathOf(k.prop).path;
        out.push({ comp: MCP.serialize.compRef(k.comp), layer: MCP.serialize.layerRef(k.layer), property: path, numKeys: k.numKeys });
        if (state.on["key-counts"]) {
            MCP.check.add(state, MCP.check.finding("key-counts", "info", k.comp, k.layer, {
                property: path, count: k.numKeys,
                message: path + " has " + k.numKeys + " keys (" + (i + 1) + " of the most keyed properties).",
                fix: "Large key counts usually mean baked or hand-traced motion; check whether fewer eased keys or an expression would do."
            }));
        }
    }
    return out;
};

MCP.check.sortFindings = function (state, list) {
    list.sort(function (a, b) {
        var sa = MCP.check.SEVERITY_RANK[a.severity], sb = MCP.check.SEVERITY_RANK[b.severity];
        if (sa !== sb) { return sa - sb; }
        var ca = state.compOrder[a.comp.id] || 0, cb = state.compOrder[b.comp.id] || 0;
        if (ca !== cb) { return ca - cb; }
        var la = a.layer ? a.layer.index : 0, lb = b.layer ? b.layer.index : 0;
        if (la !== lb) { return la - lb; }
        return (a.time === null ? -1 : a.time) - (b.time === null ? -1 : b.time);
    });
    return list;
};

/* --------------------------------------------------------------- commands */

MCP.register("auditComposition", function (args) {
    var started = new Date().getTime();
    var root = MCP.resolveComp(args.comp);
    var state = MCP.check.newState(args);
    var recurse = MCP.bool(args.recurse, false);
    if (state.on["missing-fonts"]) {
        var byLayer = MCP.check.missingFontsByLayer();
        if (byLayer) { state.fontMode = "project"; state.missingFontLayers = byLayer; }
        else if (MCP.aeVersion() >= 24) { state.fontMode = "layer"; }
        else { state.fontMode = null; state.notes.push("The font check needs After Effects 24.0 or later (app.fonts); it was skipped."); }
    }
    var queue = [{ comp: root, depth: 0 }];
    var visited = {}, checked = [];
    var skipped = 0;
    while (queue.length) {
        var next = queue.shift();
        if (visited[next.comp.id]) { continue; }
        if (checked.length >= state.limits.maxComps) { skipped++; visited[next.comp.id] = true; continue; }
        visited[next.comp.id] = true;
        state.compOrder[next.comp.id] = checked.length;
        checked.push({ id: next.comp.id, name: next.comp.name, depth: next.depth, layers: next.comp.numLayers });
        MCP.check.auditComp(state, next.comp, recurse ? queue : null, next.depth);
    }
    if (skipped) { state.notes.push(skipped + " nested comps were not checked: limits.maxComps is " + state.limits.maxComps + "."); }
    var top = MCP.check.keyCountFindings(state);
    var minRank = MCP.check.SEVERITY_RANK[String(MCP.arg(args, "minSeverity", "info"))];
    if (minRank === undefined) { minRank = 2; }
    var list = [];
    for (var i = 0; i < state.findings.length; i++) {
        if (MCP.check.SEVERITY_RANK[state.findings[i].severity] <= minRank) { list.push(state.findings[i]); }
    }
    MCP.check.sortFindings(state, list);
    var maxF = state.limits.maxFindings;
    var returned = list.slice(0, maxF);
    var checksRun = [];
    for (var c = 0; c < MCP.check.ALL_CHECKS.length; c++) { if (state.on[MCP.check.ALL_CHECKS[c]]) { checksRun.push(MCP.check.ALL_CHECKS[c]); } }
    if (state.total > MCP.check.HARD_CAP) { state.notes.push("More than " + MCP.check.HARD_CAP + " findings: only the first " + MCP.check.HARD_CAP + " were sorted."); }
    return {
        composition: MCP.serialize.compRef(root),
        recurse: recurse,
        checks: checksRun,
        compsChecked: checked,
        summary: { error: state.counts.error, warning: state.counts.warning, info: state.counts.info, total: state.total },
        total: state.total,
        returned: returned.length,
        truncated: list.length > returned.length || state.total > state.findings.length,
        findings: returned,
        keyStats: { keyedProperties: state.keyed.length, totalKeys: state.totalKeys, expressions: state.expressions, top: top },
        fontCheck: state.fontMode,
        notes: state.notes,
        durationMs: new Date().getTime() - started
    };
}, { mutating: false });

/* ------------------------------------------------------------------ purge */

MCP.check.PURGE = { "all": "ALL_CACHES", "memory": "ALL_MEMORY_CACHES", "undo": "UNDO_CACHES", "image": "IMAGE_CACHES", "snapshot": "SNAPSHOT_CACHES" };

MCP.register("purgeCaches", function (args) {
    var target = String(MCP.arg(args, "target", "all"));
    var key = MCP.check.PURGE[target];
    if (!key) { MCP.fail("Unknown purge target '" + target + "'. Use all, memory, undo, image or snapshot.", "invalid-argument"); }
    var value = _mcpTry(function () { return PurgeTarget[key]; }, undefined);
    if (value === undefined || value === null) {
        MCP.fail("PurgeTarget." + key + " is not available in After Effects " + app.version + (target === "memory" ? " (it needs 24.3 or later; use target all)." : "."), "unsupported");
    }
    var notes = [];
    var before = _mcpTry(function () { return app.memoryInUse; }, null);
    try { app.purge(value); } catch (e) { MCP.fail("app.purge failed: " + e.toString(), "script-error"); }
    var after = _mcpTry(function () { return app.memoryInUse; }, null);
    if (target === "all" && MCP.aeVersion() < 24.3) { notes.push("Before After Effects 24.3 this clears the RAM cache only; the disk cache stays."); }
    if (target === "all" || target === "undo") { notes.push("The undo history was cleared: earlier steps can no longer be undone."); }
    return {
        target: target,
        purgeTarget: key,
        memoryInUseBefore: before,
        memoryInUseAfter: after,
        freedBytes: (typeof before === "number" && typeof after === "number") ? before - after : null,
        aeVersion: app.version,
        notes: notes
    };
}, { mutating: true });

/* ----------------------------------------------------------- save version */

MCP.check.pad = function (n, width) {
    var s = String(n);
    while (s.length < width) { s = "0" + s; }
    return s;
};

MCP.check.cleanNote = function (note) {
    if (!MCP.isDefined(note)) { return ""; }
    var s = String(note).replace(/^\s+|\s+$/g, "").replace(/[^A-Za-z0-9 ._\-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
    return s.replace(/^[-_.]+|[-_.]+$/g, "");
};

/**
 * Next version of a file base name (no extension): the last "v<digits>" that
 * follows a separator or starts the name is incremented with its padding kept,
 * and anything after it (an old note) is dropped. Without one, "_v02" is added.
 * step adds more when names are taken (1 = the next version).
 */
MCP.check.nextVersionName = function (base, note, step) {
    var re = /(^|[ _.\-])([vV])(\d+)(?=$|[ _.\-])/g;
    var m, last = null;
    while ((m = re.exec(base)) !== null) {
        last = { index: m.index, sep: m[1], v: m[2], digits: m[3] };
        if (m[0].length === 0) { re.lastIndex++; }
    }
    var add = MCP.isDefined(step) ? step : 1;
    var clean = MCP.check.cleanNote(note);
    var name, version, width;
    if (last) {
        width = last.digits.length;
        version = parseInt(last.digits, 10) + add;
        name = base.substr(0, last.index) + last.sep + last.v + MCP.check.pad(version, width);
    } else {
        width = 2;
        version = 1 + add;
        name = base + "_v" + MCP.check.pad(version, width);
    }
    if (clean) { name += "_" + clean; }
    return { name: name, version: version, width: width, hadVersion: !!last, note: clean || null };
};

MCP.register("saveVersion", function (args) {
    var project = app.project;
    if (!project || !project.file) {
        MCP.fail("The project has never been saved, so there is no file to version. Save it once with save-project-as (for example name_v01.aep), then use save-version.", "invalid-argument");
    }
    var current = project.file;
    var fileName = String(current.displayName || decodeURI(current.name));
    var dot = fileName.lastIndexOf(".");
    var base = dot > 0 ? fileName.substr(0, dot) : fileName;
    var ext = dot > 0 ? fileName.substr(dot) : ".aep";
    var folder = current.parent;
    var skipped = [];
    var info = null, target = null;
    for (var step = 1; step <= 999; step++) {
        info = MCP.check.nextVersionName(base, args.note, step);
        target = new File(folder.fsName + "/" + info.name + ext);
        if (!target.exists) { break; }
        skipped.push(target.fsName);
        target = null;
    }
    if (!target) { MCP.fail("No free version name found after " + skipped.length + " tries next to " + current.fsName + ".", "io"); }
    try { project.save(target); } catch (e) { MCP.fail("Save failed for " + target.fsName + ": " + e.toString(), "io"); }
    var nowFile = project.file;
    return {
        previousPath: current.fsName,
        path: nowFile ? nowFile.fsName : target.fsName,
        fileName: info.name + ext,
        version: info.version,
        versionWidth: info.width,
        note: info.note,
        skipped: skipped,
        saved: !!(nowFile && nowFile.exists),
        projectName: nowFile ? String(nowFile.displayName || decodeURI(nowFile.name)) : null
    };
}, { mutating: true });

/* ------------------------------------------------------------- organize */

MCP.check.FOLDER_DEFAULTS = { comps: "Comps", precomps: "Precomps", footage: "Footage", images: "Images", audio: "Audio", solids: "Solids", vectors: "Vectors" };
MCP.check.FOLDER_ORDER = ["comps", "precomps", "footage", "images", "audio", "solids", "vectors"];
MCP.check.VECTOR_EXT = /\.(ai|eps|pdf|svg)$/i;

/** Folder key for a project item, or null for folders. */
MCP.check.classify = function (item) {
    if (item instanceof FolderItem) { return null; }
    if (item instanceof CompItem) {
        var used = _mcpTry(function () { return item.usedIn.length; }, 0);
        return used > 0 ? "precomps" : "comps";
    }
    if (item instanceof FootageItem) {
        var src = _mcpTry(function () { return item.mainSource; }, null);
        if (src instanceof SolidSource) { return "solids"; }
        if (src instanceof PlaceholderSource) { return "footage"; }
        var file = _mcpTry(function () { return item.file; }, null);
        var name = file ? String(file.name) : String(item.name);
        if (MCP.check.VECTOR_EXT.test(name)) { return "vectors"; }
        var hasVideo = _mcpTry(function () { return item.hasVideo; }, true);
        var hasAudio = _mcpTry(function () { return item.hasAudio; }, false);
        if (!hasVideo && hasAudio) { return "audio"; }
        if (_mcpTry(function () { return src.isStill; }, false)) { return "images"; }
        return "footage";
    }
    return null;
};

MCP.check.itemSummary = function (item) {
    return { id: item.id, name: item.name, type: MCP.itemType(item) };
};

MCP.check.isRoot = function (folder) {
    if (!folder) { return true; }
    var root = app.project.rootFolder;
    return folder === root || _mcpTry(function () { return folder.id === root.id; }, false);
};

MCP.check.folderLabel = function (folder) {
    return MCP.check.isRoot(folder) ? "(root)" : folder.name;
};

MCP.register("organizeProject", function (args) {
    var dryRun = MCP.bool(args.dryRun, false);
    var includeFoldered = MCP.bool(args.includeFoldered, false);
    var names = MCP.extend({}, MCP.check.FOLDER_DEFAULTS);
    if (args.folderNames) {
        for (var nk in args.folderNames) {
            if (Object.prototype.hasOwnProperty.call(args.folderNames, nk) && MCP.isDefined(args.folderNames[nk]) && Object.prototype.hasOwnProperty.call(names, nk)) { names[nk] = String(args.folderNames[nk]); }
        }
    }
    var items = [];
    var i;
    for (i = 1; i <= app.project.numItems; i++) { items.push(app.project.item(i)); }
    // Existing top-level folders with the target names are reused.
    var folders = {}, targetIds = {};
    for (i = 0; i < items.length; i++) {
        var it = items[i];
        if (!(it instanceof FolderItem) || !MCP.check.isRoot(it.parentFolder)) { continue; }
        for (var key in names) {
            if (!Object.prototype.hasOwnProperty.call(names, key) || folders[key]) { continue; }
            if (it.name === names[key] || String(it.name).toLowerCase() === String(names[key]).toLowerCase()) { folders[key] = it; targetIds[it.id] = key; }
        }
    }
    var moves = [], kept = [], counts = {}, created = [], vacated = {};
    var keptCount = 0, movedCount = 0;
    for (i = 0; i < items.length; i++) {
        var item = items[i];
        var kind = MCP.check.classify(item);
        if (!kind) { continue; }
        var parent = item.parentFolder;
        var atRoot = MCP.check.isRoot(parent);
        var inTarget = atRoot ? undefined : targetIds[parent.id];
        if (inTarget === kind) { counts[names[kind]] = (counts[names[kind]] || 0) + 1; continue; }
        if (!atRoot && !inTarget && !includeFoldered) {
            keptCount++;
            if (kept.length < 50) { kept.push({ item: MCP.check.itemSummary(item), folder: parent.name }); }
            continue;
        }
        if (!folders[kind]) {
            created.push(names[kind]);
            if (!dryRun) { folders[kind] = app.project.items.addFolder(names[kind]); targetIds[folders[kind].id] = kind; }
            else { folders[kind] = { name: names[kind], id: -1, planned: true }; }
        }
        var from = MCP.check.folderLabel(parent);
        if (!dryRun) {
            if (!atRoot && !inTarget) { vacated[parent.id] = parent; }
            item.parentFolder = folders[kind];
        }
        movedCount++;
        counts[names[kind]] = (counts[names[kind]] || 0) + 1;
        if (moves.length < 300) { moves.push({ item: MCP.check.itemSummary(item), from: from, to: names[kind] }); }
    }
    var removed = [];
    if (!dryRun && MCP.bool(args.removeEmptyFolders, false)) {
        for (var fid in vacated) {
            if (!Object.prototype.hasOwnProperty.call(vacated, fid)) { continue; }
            var f = vacated[fid];
            if (_mcpTry(function () { return f.numItems; }, 1) === 0) {
                removed.push(f.name);
                try { f.remove(); } catch (e2) { removed.pop(); }
            }
        }
    }
    return {
        dryRun: dryRun,
        movedCount: movedCount,
        moves: moves,
        created: created,
        keptCount: keptCount,
        kept: kept,
        counts: counts,
        folders: names,
        removedFolders: removed,
        notes: movedCount > moves.length ? ["Only the first " + moves.length + " of " + movedCount + " moves are listed."] : []
    };
}, { mutating: true });
