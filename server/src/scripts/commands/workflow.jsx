/*
 * Workflow and utility commands: composition snapshots, snapshot restore,
 * layer search, text and colour find and replace, font relinking.
 */

MCP.workflow = {};

/* ------------------------------------------------------------- snapshots */

/** Serialises a property group recursively; leaves carry values, keyframes and expressions. */
MCP.workflow.snapshotGroup = function (group, depth, opts) {
    if (!MCP.isGroup(group)) { return MCP.serialize.property(group, { keyframes: !!opts.keyframes }); }
    var out = MCP.serialize.property(group, { keyframes: false });
    out.children = [];
    if (depth <= 0) { out.truncated = true; return out; }
    var n = _mcpTry(function () { return group.numProperties; }, 0);
    for (var i = 1; i <= n; i++) {
        var p = _mcpTry(function () { return group.property(i); }, null);
        if (!p) { continue; }
        out.children.push(MCP.workflow.snapshotGroup(p, depth - 1, opts));
    }
    return out;
};

MCP.workflow.snapshotLayer = function (layer, opts) {
    var entry = { layer: MCP.serialize.layer(layer), parent: layer.parent ? { index: layer.parent.index, name: layer.parent.name } : null };
    var tg = _mcpTry(function () { return layer.property("ADBE Transform Group"); }, null);
    entry.transform = tg ? MCP.workflow.snapshotGroup(tg, opts.depth, opts) : null;
    if (opts.effects) {
        entry.effects = [];
        var fxg = _mcpTry(function () { return layer.property("ADBE Effect Parade"); }, null);
        var nfx = fxg ? _mcpTry(function () { return fxg.numProperties; }, 0) : 0;
        for (var i = 1; i <= nfx; i++) {
            var fx = fxg.property(i);
            entry.effects.push({ index: i, name: fx.name, matchName: fx.matchName, enabled: _mcpTry(function () { return fx.enabled; }, true), properties: MCP.workflow.snapshotGroup(fx, opts.depth, opts) });
        }
    }
    if (opts.text && layer instanceof TextLayer) {
        var st = _mcpTry(function () { return layer.property("ADBE Text Properties").property("ADBE Text Document"); }, null);
        entry.text = st ? { sourceText: MCP.serialize.property(st, { keyframes: !!opts.keyframes }) } : null;
    }
    if (opts.shapes && layer instanceof ShapeLayer) {
        var contents = _mcpTry(function () { return layer.property("ADBE Root Vectors Group"); }, null);
        entry.shapes = contents ? MCP.workflow.snapshotGroup(contents, Math.max(opts.depth, 4), opts) : null;
    }
    entry.masks = [];
    var mg = _mcpTry(function () { return layer.property("ADBE Mask Parade"); }, null);
    var nm = mg ? _mcpTry(function () { return mg.numProperties; }, 0) : 0;
    for (var m = 1; m <= nm; m++) {
        var mask = mg.property(m);
        entry.masks.push({
            index: m, name: mask.name,
            inverted: _mcpTry(function () { return mask.inverted; }, null),
            mode: _mcpTry(function () { return String(mask.maskMode); }, null),
            pathKeys: _mcpTry(function () { return mask.property("ADBE Mask Shape").numKeys; }, 0)
        });
    }
    var tr = _mcpTry(function () { return layer.timeRemapEnabled ? layer.property("ADBE Time Remapping") : null; }, null);
    entry.timeRemap = tr ? MCP.serialize.property(tr, { keyframes: !!opts.keyframes }) : null;
    return entry;
};

MCP.register("snapshotComposition", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var opts = {
        depth: Math.round(MCP.num(args.depth, 3)),
        keyframes: MCP.bool(args.includeKeyframes, true),
        effects: MCP.bool(args.includeEffects, true),
        text: MCP.bool(args.includeText, true),
        shapes: MCP.bool(args.includeShapes, false)
    };
    var maxLayers = Math.round(MCP.num(args.maxLayers, 100));
    var layers = [];
    var n = Math.min(comp.numLayers, maxLayers);
    for (var i = 1; i <= n; i++) { layers.push(MCP.workflow.snapshotLayer(comp.layer(i), opts)); }
    return {
        snapshotVersion: 1,
        takenAt: _mcpTry(function () { return new Date().toISOString(); }, null),
        composition: MCP.serialize.comp(comp),
        options: opts,
        layerCount: comp.numLayers,
        truncated: comp.numLayers > maxLayers,
        markers: _mcpTry(function () { return MCP.markerList(comp, comp.markerProperty); }, []),
        layers: layers
    };
}, { mutating: false });

/* -------------------------------------------------------------- restore */

MCP.workflow.findChild = function (group, snap) {
    var p = null;
    if (snap.matchName) { p = MCP.childProp(group, snap.matchName); }
    if (!p && snap.name) { p = MCP.childProp(group, snap.name); }
    if (!p && MCP.isDefined(snap.index)) { p = _mcpTry(function () { return group.property(Number(snap.index)); }, null); }
    return p;
};

/** Converts a snapshot value back into what the property accepts. */
MCP.workflow.valueFromSnapshot = function (prop, v) {
    var vt = MCP.serialize.valueTypeName(prop);
    if (vt === "text-document") {
        var doc = prop.value;
        if (typeof v === "string") { doc.text = v; return doc; }
        if (v && typeof v === "object") {
            if (MCP.isDefined(v.text)) { doc.text = String(v.text); }
            if (MCP.isDefined(v.font)) { try { doc.font = String(v.font); } catch (e1) {} }
            if (MCP.isDefined(v.fontSize)) { try { doc.fontSize = Number(v.fontSize); } catch (e2) {} }
            if (MCP.isDefined(v.fillColor)) { try { doc.applyFill = true; doc.fillColor = MCP.color.rgb(v.fillColor); } catch (e3) {} }
            if (MCP.isDefined(v.strokeColor)) { try { doc.applyStroke = true; doc.strokeColor = MCP.color.rgb(v.strokeColor); } catch (e4) {} }
            if (MCP.isDefined(v.strokeWidth)) { try { doc.strokeWidth = Number(v.strokeWidth); } catch (e5) {} }
            if (MCP.isDefined(v.tracking)) { try { doc.tracking = Number(v.tracking); } catch (e6) {} }
            if (MCP.isDefined(v.leading)) { try { doc.leading = Number(v.leading); } catch (e7) {} }
            if (MCP.isDefined(v.justification)) { try { doc.justification = MCP.justificationValue(v.justification); } catch (e8) {} }
            if (MCP.isDefined(v.allCaps)) { try { doc.allCaps = !!v.allCaps; } catch (e9) {} }
            if (MCP.isDefined(v.fauxBold)) { try { doc.fauxBold = !!v.fauxBold; } catch (e10) {} }
            if (MCP.isDefined(v.fauxItalic)) { try { doc.fauxItalic = !!v.fauxItalic; } catch (e11) {} }
        }
        return doc;
    }
    if (vt === "shape") {
        if (v && typeof v === "object" && MCP.isArray(v.vertices)) {
            var s = new Shape();
            s.vertices = v.vertices;
            if (MCP.isArray(v.inTangents)) { s.inTangents = v.inTangents; }
            if (MCP.isArray(v.outTangents)) { s.outTangents = v.outTangents; }
            s.closed = MCP.isDefined(v.closed) ? !!v.closed : true;
            return s;
        }
        return null;
    }
    if (vt === "marker") { return null; }
    if (vt === "color") { return MCP.color.rgba(v); }
    var c = MCP.coerceValue(prop, v);
    if (typeof c === "boolean") { return c ? 1 : 0; }
    return c;
};

/** Writes a snapshot leaf (value, keyframes, expression) onto a live property. Returns a status string. */
MCP.workflow.applyPropertySnapshot = function (prop, snap, what) {
    if (!snap || snap.isGroup) { return "skipped-group"; }
    if (!_mcpTry(function () { return prop.propertyValueType !== PropertyValueType.NO_VALUE; }, false)) { return "skipped-no-value"; }
    var vt = MCP.serialize.valueTypeName(prop);
    if (vt === "marker" || vt === "custom" || vt === "layer-index" || vt === "mask-index") { return "skipped-" + vt; }
    var did = [];
    var keys = MCP.isArray(snap.keyframes) ? snap.keyframes : [];
    if (what.keyframes && keys.length) {
        while (prop.numKeys > 0) { prop.removeKey(1); }
        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            if (!key || !MCP.isDefined(key.time)) { continue; }
            var value = MCP.workflow.valueFromSnapshot(prop, key.value);
            if (value === null || value === undefined) { continue; }
            var idx = MCP.easing.setKey(prop, Number(key.time), value);
            try {
                if (key.inInterpolation || key.outInterpolation) {
                    prop.setInterpolationTypeAtKey(idx, MCP.enums.interpolationValue(key.inInterpolation || "linear"), MCP.enums.interpolationValue(key.outInterpolation || "linear"));
                }
            } catch (e1) {}
            try {
                if (MCP.isArray(key.easeIn) && key.easeIn.length && MCP.isArray(key.easeOut) && key.easeOut.length) {
                    var ins = [], outs = [];
                    for (var a = 0; a < key.easeIn.length; a++) { ins.push(new KeyframeEase(Number(key.easeIn[a].speed) || 0, MCP.easing.clampInfluence(key.easeIn[a].influence))); }
                    for (var b = 0; b < key.easeOut.length; b++) { outs.push(new KeyframeEase(Number(key.easeOut[b].speed) || 0, MCP.easing.clampInfluence(key.easeOut[b].influence))); }
                    MCP.easing.setTemporalEase(prop, idx, ins, outs);
                }
            } catch (e2) {}
            try {
                if (key.spatial && MCP.isArray(key.spatial.inTangent) && MCP.isArray(key.spatial.outTangent)) {
                    prop.setSpatialTangentsAtKey(idx, key.spatial.inTangent, key.spatial.outTangent);
                }
                if (key.spatial && MCP.isDefined(key.spatial.continuous)) { prop.setSpatialContinuousAtKey(idx, !!key.spatial.continuous); }
                if (key.spatial && MCP.isDefined(key.spatial.autoBezier)) { prop.setSpatialAutoBezierAtKey(idx, !!key.spatial.autoBezier); }
                if (MCP.isDefined(key.temporalContinuous)) { prop.setTemporalContinuousAtKey(idx, !!key.temporalContinuous); }
                if (MCP.isDefined(key.temporalAutoBezier)) { prop.setTemporalAutoBezierAtKey(idx, !!key.temporalAutoBezier); }
                if (MCP.isDefined(key.roving) && key.roving) { prop.setRovingAtKey(idx, true); }
            } catch (e3) {}
        }
        did.push("keyframes:" + keys.length);
    } else if (what.values && MCP.isDefined(snap.value)) {
        var v = MCP.workflow.valueFromSnapshot(prop, snap.value);
        if (v !== null && v !== undefined) {
            if (prop.numKeys > 0) {
                if (what.keyframes) { while (prop.numKeys > 0) { prop.removeKey(1); } prop.setValue(v); did.push("value"); }
                else { MCP.easing.setKey(prop, prop.propertyGroup(prop.propertyDepth).containingComp.time, v); did.push("value-as-key"); }
            } else {
                prop.setValue(v); did.push("value");
            }
        }
    }
    if (what.expressions && _mcpTry(function () { return prop.canSetExpression; }, false)) {
        if (snap.hasExpression && MCP.isDefined(snap.expression)) {
            prop.expression = String(snap.expression);
            if (MCP.isDefined(snap.expressionEnabled)) { try { prop.expressionEnabled = !!snap.expressionEnabled; } catch (e4) {} }
            did.push("expression");
        } else if (snap.hasExpression === false && prop.expression !== "") {
            prop.expression = ""; did.push("expression-cleared");
        }
    }
    return did.length ? did.join(",") : "unchanged";
};

/** Walks a snapshot group tree and applies each leaf to the matching live property. */
MCP.workflow.applyGroupSnapshot = function (group, snap, what, stats, path) {
    if (!snap) { return; }
    var kids = MCP.isArray(snap.children) ? snap.children : [];
    for (var i = 0; i < kids.length; i++) {
        var child = kids[i];
        var p = MCP.workflow.findChild(group, child);
        var here = path + "/" + (child.name || child.matchName || i);
        if (!p) { stats.skipped.push({ path: here, reason: "property not found on target" }); continue; }
        if (child.isGroup) { MCP.workflow.applyGroupSnapshot(p, child, what, stats, here); continue; }
        try {
            var status = MCP.workflow.applyPropertySnapshot(p, child, what);
            if (status === "unchanged" || status.indexOf("skipped") === 0) { stats.unchanged++; }
            else { stats.applied++; }
        } catch (e) {
            stats.skipped.push({ path: here, reason: e.toString() });
        }
    }
};

MCP.workflow.findTargetLayer = function (comp, snapLayer, matchBy) {
    var i, L;
    if (matchBy === "index") {
        var idx = Number(snapLayer.index);
        return (idx >= 1 && idx <= comp.numLayers) ? comp.layer(idx) : null;
    }
    if (matchBy === "id" && MCP.isDefined(snapLayer.id)) {
        for (i = 1; i <= comp.numLayers; i++) { L = comp.layer(i); if (_mcpTry(function () { return L.id === Number(snapLayer.id); }, false)) { return L; } }
        return null;
    }
    var matches = [];
    for (i = 1; i <= comp.numLayers; i++) { L = comp.layer(i); if (L.name === snapLayer.name) { matches.push(L); } }
    if (matches.length === 1) { return matches[0]; }
    if (matches.length > 1) {
        // Prefer the one with the same index, then the same id.
        for (i = 0; i < matches.length; i++) { if (matches[i].index === Number(snapLayer.index)) { return matches[i]; } }
        return matches[0];
    }
    return null;
};

MCP.register("applySnapshot", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var snapshot = MCP.requireArg(args, "snapshot");
    if (!snapshot || !MCP.isArray(snapshot.layers)) { MCP.fail("snapshot must be the object returned by snapshot-composition (it needs a layers[] array).", "invalid-argument"); }
    var matchBy = String(MCP.arg(args, "matchBy", "name")).toLowerCase();
    var w = args.what || {};
    var what = {
        values: MCP.bool(w.transform, true),
        transform: MCP.bool(w.transform, true),
        effects: MCP.bool(w.effects, true),
        keyframes: MCP.bool(w.keyframes, true),
        expressions: MCP.bool(w.expressions, true),
        text: MCP.bool(w.text, false)
    };
    var results = [], skipped = [];
    for (var i = 0; i < snapshot.layers.length; i++) {
        var entry = snapshot.layers[i] || {};
        var sl = entry.layer || {};
        var target = MCP.workflow.findTargetLayer(comp, sl, matchBy);
        if (!target) { skipped.push({ name: sl.name, index: sl.index, reason: "no layer matched by " + matchBy }); continue; }
        var stats = { applied: 0, unchanged: 0, skipped: [], effectsAdded: [], effectsUpdated: 0 };
        if (what.transform && entry.transform) {
            var tg = _mcpTry(function () { return target.property("ADBE Transform Group"); }, null);
            if (tg) { MCP.workflow.applyGroupSnapshot(tg, entry.transform, what, stats, "Transform"); }
        }
        if (what.effects && MCP.isArray(entry.effects)) {
            var fxg = _mcpTry(function () { return target.property("ADBE Effect Parade"); }, null);
            if (!fxg) { stats.skipped.push({ path: "Effects", reason: "layer cannot hold effects" }); }
            else {
                for (var f = 0; f < entry.effects.length; f++) {
                    var sfx = entry.effects[f];
                    var fx = null;
                    var nfx = _mcpTry(function () { return fxg.numProperties; }, 0);
                    for (var j = 1; j <= nfx && !fx; j++) {
                        var cand = fxg.property(j);
                        if (cand.matchName === sfx.matchName && cand.name === sfx.name) { fx = cand; }
                    }
                    if (!fx) { for (var j2 = 1; j2 <= nfx && !fx; j2++) { if (fxg.property(j2).matchName === sfx.matchName) { fx = fxg.property(j2); } } }
                    if (!fx) {
                        try {
                            fx = fxg.addProperty(sfx.matchName);
                            if (sfx.name) { fx.name = sfx.name; }
                            stats.effectsAdded.push(sfx.name || sfx.matchName);
                        } catch (e) {
                            stats.skipped.push({ path: "Effects/" + (sfx.name || sfx.matchName), reason: "effect could not be added: " + e.toString() });
                            continue;
                        }
                    } else { stats.effectsUpdated++; }
                    if (MCP.isDefined(sfx.enabled)) { try { fx.enabled = !!sfx.enabled; } catch (e2) {} }
                    MCP.workflow.applyGroupSnapshot(fx, sfx.properties, what, stats, "Effects/" + fx.name);
                }
            }
        }
        if (what.text && entry.text && entry.text.sourceText) {
            var st = _mcpTry(function () { return target.property("ADBE Text Properties").property("ADBE Text Document"); }, null);
            if (!st) { stats.skipped.push({ path: "Text/Source Text", reason: "target is not a text layer" }); }
            else {
                try { var ts = MCP.workflow.applyPropertySnapshot(st, entry.text.sourceText, MCP.extend(MCP.extend({}, what), { values: true })); if (ts !== "unchanged") { stats.applied++; } }
                catch (e3) { stats.skipped.push({ path: "Text/Source Text", reason: e3.toString() }); }
            }
        }
        if (what.transform && entry.timeRemap && _mcpTry(function () { return target.timeRemapEnabled; }, false)) {
            try { MCP.workflow.applyPropertySnapshot(target.property("ADBE Time Remapping"), entry.timeRemap, what); stats.applied++; }
            catch (e4) { stats.skipped.push({ path: "Time Remap", reason: e4.toString() }); }
        }
        results.push({ status: "ok", snapshotLayer: { name: sl.name, index: sl.index }, layer: MCP.serialize.layerRef(target), applied: stats.applied, unchanged: stats.unchanged, effectsAdded: stats.effectsAdded, effectsUpdated: stats.effectsUpdated, skipped: stats.skipped });
    }
    return {
        composition: MCP.serialize.compRef(comp),
        matchBy: matchBy,
        what: what,
        layersApplied: results.length,
        layersSkipped: skipped.length,
        results: results,
        skipped: skipped,
        notRestored: ["masks", "shape contents", "layer order and parenting", "layer styles", "layer timing and switches", "markers"]
    };
}, { mutating: true });

/* ---------------------------------------------------------- find layers */

MCP.workflow.matcher = function (pattern) {
    if (!MCP.isDefined(pattern)) { return null; }
    var s = String(pattern);
    var m = s.match(/^\/(.*)\/([gimy]*)$/);
    if (m) {
        var flags = m[2].replace(/g/g, "");
        var re;
        try { re = new RegExp(m[1], flags); } catch (e) { MCP.fail("Invalid regular expression '" + s + "': " + e.toString(), "invalid-argument"); }
        return function (text) { return re.test(String(text)); };
    }
    var lower = s.toLowerCase();
    return function (text) { return String(text).toLowerCase().indexOf(lower) >= 0; };
};

/** Collects {path, expression} under the given roots up to depth. */
MCP.workflow.expressions = function (layer, maxDepth) {
    var found = [];
    var roots = ["ADBE Transform Group", "ADBE Effect Parade", "ADBE Text Properties", "ADBE Root Vectors Group", "ADBE Mask Parade", "ADBE Time Remapping", "ADBE Audio Group", "ADBE Camera Options Group", "ADBE Light Options Group", "ADBE Material Options Group"];
    function walk(g, depth) {
        if (depth > maxDepth) { return; }
        if (!MCP.isGroup(g)) {
            if (_mcpTry(function () { return g.canSetExpression && g.expression !== ""; }, false)) { found.push({ path: MCP.pathOf(g).path, expression: g.expression }); }
            return;
        }
        var n = _mcpTry(function () { return g.numProperties; }, 0);
        for (var i = 1; i <= n; i++) {
            var p = _mcpTry(function () { return g.property(i); }, null);
            if (p) { walk(p, depth + 1); }
        }
    }
    for (var r = 0; r < roots.length; r++) {
        var root = _mcpTry(function () { return layer.property(roots[r]); }, null);
        if (root) { walk(root, 1); }
    }
    return found;
};

MCP.workflow.compsInScope = function (args) {
    var scope = String(MCP.arg(args, "scope", "comp")).toLowerCase();
    if (scope === "project") {
        var out = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem) { out.push(it); }
        }
        return out;
    }
    return [MCP.resolveComp(args.comp)];
};

MCP.register("findLayers", function (args) {
    var comps = MCP.workflow.compsInScope(args);
    var nameMatch = MCP.workflow.matcher(args.namePattern);
    var exprMatch = MCP.workflow.matcher(args.expressionContains);
    var type = MCP.isDefined(args.type) ? String(args.type).toLowerCase() : null;
    var hasEffect = MCP.isDefined(args.hasEffect) ? String(args.hasEffect) : null;
    var hasExpressions = MCP.isDefined(args.hasExpressions) ? MCP.bool(args.hasExpressions, true) : null;
    var enabled = MCP.isDefined(args.enabled) ? MCP.bool(args.enabled, true) : null;
    var label = MCP.isDefined(args.label) ? MCP.enums.labelIndex(args.label) : null;
    var threeD = MCP.isDefined(args.threeD) ? MCP.bool(args.threeD, true) : null;
    var limit = Math.round(MCP.num(args.limit, 500));
    var includeExpr = MCP.bool(args.includeExpressions, false);
    var out = [], scanned = 0, truncated = false;
    for (var c = 0; c < comps.length && !truncated; c++) {
        var comp = comps[c];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            scanned++;
            if (nameMatch && !nameMatch(L.name)) { continue; }
            if (type && MCP.layerType(L) !== type) { continue; }
            if (enabled !== null && !!L.enabled !== enabled) { continue; }
            if (label !== null && L.label !== label) { continue; }
            if (threeD !== null && !!_mcpTry(function () { return L.threeDLayer; }, false) !== threeD) { continue; }
            if (hasEffect) {
                var fxg = _mcpTry(function () { return L.property("ADBE Effect Parade"); }, null);
                if (!fxg || !MCP.childProp(fxg, hasEffect)) { continue; }
            }
            var exprs = null;
            if (exprMatch || hasExpressions !== null || includeExpr) { exprs = MCP.workflow.expressions(L, 6); }
            if (hasExpressions !== null && (exprs.length > 0) !== hasExpressions) { continue; }
            var matchedExpr = [];
            if (exprMatch) {
                for (var x = 0; x < exprs.length; x++) { if (exprMatch(exprs[x].expression)) { matchedExpr.push(exprs[x]); } }
                if (!matchedExpr.length) { continue; }
            }
            var entry = { composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layer(L) };
            if (exprMatch) { entry.matchedExpressions = matchedExpr; }
            else if (includeExpr && exprs) { entry.expressions = exprs; }
            out.push(entry);
            if (out.length >= limit) { truncated = true; break; }
        }
    }
    return { scope: String(MCP.arg(args, "scope", "comp")), compositionsScanned: comps.length, layersScanned: scanned, count: out.length, truncated: truncated, layers: out };
}, { mutating: false });

/* ------------------------------------------------- find and replace text */

MCP.workflow.escapeRegex = function (s) {
    return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
};

MCP.workflow.textRegex = function (args) {
    var find = MCP.requireArg(args, "find");
    var body = MCP.bool(args.useRegex, false) ? String(find) : MCP.workflow.escapeRegex(find);
    if (MCP.bool(args.wholeWord, false)) { body = "\\b(?:" + body + ")\\b"; }
    var flags = "g" + (MCP.bool(args.caseSensitive, false) ? "" : "i");
    try { return new RegExp(body, flags); }
    catch (e) { MCP.fail("Invalid search pattern '" + find + "': " + e.toString(), "invalid-argument"); }
    return null;
};

MCP.workflow.countMatches = function (re, text) {
    var m = String(text).match(re);
    return m ? m.length : 0;
};

MCP.register("findAndReplaceText", function (args) {
    var comps = MCP.workflow.compsInScope(args);
    var re = MCP.workflow.textRegex(args);
    var replacement = MCP.isDefined(args.replace) ? String(args.replace) : "";
    var dryRun = MCP.bool(args.dryRun, false);
    var layersOut = [], matchedLayers = 0, changedLayers = 0, totalMatches = 0;
    for (var c = 0; c < comps.length; c++) {
        var comp = comps[c];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (!(L instanceof TextLayer)) { continue; }
            var prop = _mcpTry(function () { return L.property("ADBE Text Properties").property("ADBE Text Document"); }, null);
            if (!prop) { continue; }
            var changes = [];
            var nk = _mcpTry(function () { return prop.numKeys; }, 0);
            if (nk > 0) {
                for (var k = 1; k <= nk; k++) {
                    var doc = prop.keyValue(k);
                    var count = MCP.workflow.countMatches(re, doc.text);
                    if (!count) { continue; }
                    var after = String(doc.text).replace(re, replacement);
                    if (!dryRun) { doc.text = after; prop.setValueAtKey(k, doc); }
                    changes.push({ keyIndex: k, time: MCP.round(prop.keyTime(k)), matches: count, before: String(prop.keyValue(k).text), after: after });
                    totalMatches += count;
                }
            } else {
                var d = prop.value;
                var cnt = MCP.workflow.countMatches(re, d.text);
                if (cnt) {
                    var before = String(d.text);
                    var after2 = before.replace(re, replacement);
                    if (!dryRun) { d.text = after2; prop.setValue(d); }
                    changes.push({ keyIndex: null, matches: cnt, before: before, after: after2 });
                    totalMatches += cnt;
                }
            }
            if (changes.length) {
                matchedLayers++;
                if (!dryRun) { changedLayers++; }
                layersOut.push({ composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(L), changes: changes });
            }
        }
    }
    return { scope: String(MCP.arg(args, "scope", "comp")), find: String(args.find), replace: replacement, dryRun: dryRun, matchedLayers: matchedLayers, changedLayers: changedLayers, totalMatches: totalMatches, layers: layersOut };
}, { mutating: true });

/* -------------------------------------------------------- replace colour */

MCP.workflow.colorDistance = function (a, b) {
    var dr = (a[0] || 0) - (b[0] || 0), dg = (a[1] || 0) - (b[1] || 0), db = (a[2] || 0) - (b[2] || 0);
    return Math.sqrt(dr * dr + dg * dg + db * db);
};

/** Replaces the colour on one colour property (static or per key). Pushes change records. */
MCP.workflow.replaceOnProp = function (ctx, layer, prop, target) {
    var nk = _mcpTry(function () { return prop.numKeys; }, 0);
    var path = MCP.pathOf(prop).path;
    if (nk > 0) {
        for (var k = 1; k <= nk; k++) {
            var kv = prop.keyValue(k);
            if (!MCP.isArray(kv)) { continue; }
            if (MCP.workflow.colorDistance(kv, ctx.from) <= ctx.tolerance) {
                var next = [ctx.to[0], ctx.to[1], ctx.to[2], kv.length > 3 ? kv[3] : 1];
                if (!ctx.dryRun) { prop.setValueAtKey(k, kv.length > 3 ? next : [next[0], next[1], next[2]]); }
                ctx.changes.push({ layer: MCP.serialize.layerRef(layer), target: target, path: path, keyIndex: k, before: MCP.color.toHex(kv), after: MCP.color.toHex(next) });
            }
        }
        return;
    }
    var v = _mcpTry(function () { return prop.value; }, null);
    if (!MCP.isArray(v)) { return; }
    if (MCP.workflow.colorDistance(v, ctx.from) <= ctx.tolerance) {
        var nv = [ctx.to[0], ctx.to[1], ctx.to[2], v.length > 3 ? v[3] : 1];
        if (!ctx.dryRun) { prop.setValue(v.length > 3 ? nv : [nv[0], nv[1], nv[2]]); }
        ctx.changes.push({ layer: MCP.serialize.layerRef(layer), target: target, path: path, keyIndex: null, before: MCP.color.toHex(v), after: MCP.color.toHex(nv) });
    }
};

MCP.workflow.walkColors = function (ctx, layer, group, depth, filter, target) {
    if (depth > 8) { return; }
    var n = _mcpTry(function () { return group.numProperties; }, 0);
    for (var i = 1; i <= n; i++) {
        var p = _mcpTry(function () { return group.property(i); }, null);
        if (!p) { continue; }
        if (MCP.isGroup(p)) { MCP.workflow.walkColors(ctx, layer, p, depth + 1, filter, target); continue; }
        var t = filter(p);
        if (t) { MCP.workflow.replaceOnProp(ctx, layer, p, t); }
    }
};

MCP.workflow.replaceTextColors = function (ctx, layer, prop) {
    var nk = _mcpTry(function () { return prop.numKeys; }, 0);
    var path = MCP.pathOf(prop).path;
    function handleDoc(doc, keyIndex) {
        var changed = false;
        if (_mcpTry(function () { return doc.applyFill; }, false) && MCP.workflow.colorDistance(doc.fillColor, ctx.from) <= ctx.tolerance) {
            ctx.changes.push({ layer: MCP.serialize.layerRef(layer), target: "text-fill", path: path, keyIndex: keyIndex, before: MCP.color.toHex(doc.fillColor), after: MCP.color.toHex(ctx.to) });
            if (!ctx.dryRun) { doc.fillColor = [ctx.to[0], ctx.to[1], ctx.to[2]]; }
            changed = true;
        }
        if (_mcpTry(function () { return doc.applyStroke; }, false) && MCP.workflow.colorDistance(doc.strokeColor, ctx.from) <= ctx.tolerance) {
            ctx.changes.push({ layer: MCP.serialize.layerRef(layer), target: "text-stroke", path: path, keyIndex: keyIndex, before: MCP.color.toHex(doc.strokeColor), after: MCP.color.toHex(ctx.to) });
            if (!ctx.dryRun) { doc.strokeColor = [ctx.to[0], ctx.to[1], ctx.to[2]]; }
            changed = true;
        }
        return changed;
    }
    if (nk > 0) {
        for (var k = 1; k <= nk; k++) {
            var doc = prop.keyValue(k);
            if (handleDoc(doc, k) && !ctx.dryRun) { prop.setValueAtKey(k, doc); }
        }
    } else {
        var d = prop.value;
        if (handleDoc(d, null) && !ctx.dryRun) { prop.setValue(d); }
    }
};

MCP.register("replaceColor", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var ctx = {
        from: MCP.color.rgba(MCP.requireArg(args, "from")),
        to: MCP.color.rgba(MCP.requireArg(args, "to")),
        tolerance: MCP.clamp(MCP.num(args.tolerance, 0.02), 0, 2),
        dryRun: MCP.bool(args.dryRun, false),
        changes: []
    };
    var includeEffects = MCP.bool(args.includeEffects, false);
    var includeShapes = MCP.bool(args.includeShapes, true);
    var includeText = MCP.bool(args.includeText, true);
    var includeSolids = MCP.bool(args.includeSolids, true);
    var solidsDone = {};
    var shapeFilter = function (p) {
        var mn = p.matchName;
        if (mn === "ADBE Vector Fill Color") { return "shape-fill"; }
        if (mn === "ADBE Vector Stroke Color") { return "shape-stroke"; }
        return null;
    };
    var effectFilter = function (p) {
        return MCP.serialize.valueTypeName(p) === "color" ? "effect" : null;
    };
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (includeShapes && L instanceof ShapeLayer) {
            var contents = _mcpTry(function () { return L.property("ADBE Root Vectors Group"); }, null);
            if (contents) { MCP.workflow.walkColors(ctx, L, contents, 0, shapeFilter, "shape"); }
        }
        if (includeText && L instanceof TextLayer) {
            var st = _mcpTry(function () { return L.property("ADBE Text Properties").property("ADBE Text Document"); }, null);
            if (st) { MCP.workflow.replaceTextColors(ctx, L, st); }
        }
        if (includeSolids && L instanceof AVLayer) {
            var src = _mcpTry(function () { return L.source; }, null);
            var ms = src ? _mcpTry(function () { return src.mainSource; }, null) : null;
            if (ms && ms instanceof SolidSource && !solidsDone[src.id]) {
                solidsDone[src.id] = true;
                var sc = _mcpTry(function () { return ms.color; }, null);
                if (MCP.isArray(sc) && MCP.workflow.colorDistance(sc, ctx.from) <= ctx.tolerance) {
                    if (!ctx.dryRun) { ms.color = [ctx.to[0], ctx.to[1], ctx.to[2]]; }
                    ctx.changes.push({ layer: MCP.serialize.layerRef(L), target: "solid", path: "source:" + src.name, keyIndex: null, before: MCP.color.toHex(sc), after: MCP.color.toHex(ctx.to), note: "Every layer using this solid item changes." });
                }
            }
        }
        if (includeEffects) {
            var fxg = _mcpTry(function () { return L.property("ADBE Effect Parade"); }, null);
            if (fxg) { MCP.workflow.walkColors(ctx, L, fxg, 0, effectFilter, "effect"); }
        }
    }
    return {
        composition: MCP.serialize.compRef(comp),
        from: MCP.color.toHex(ctx.from), to: MCP.color.toHex(ctx.to), tolerance: ctx.tolerance,
        dryRun: ctx.dryRun,
        changedCount: ctx.changes.length,
        changes: ctx.changes
    };
}, { mutating: true });

/* ----------------------------------------------------------- relink fonts */

MCP.workflow.substituteFontNames = function () {
    MCP.requireVersion(23, "Missing font detection (app.fonts)");
    var names = {};
    var list = _mcpTry(function () { return app.fonts.missingOrSubstitutedFonts; }, null);
    if (!list) { MCP.fail("app.fonts.missingOrSubstitutedFonts is not available in this After Effects version. Pass the PostScript name in fromFont instead of \"missing\".", "unsupported"); }
    for (var i = 0; i < list.length; i++) {
        var ps = _mcpTry(function () { return list[i].postScriptName; }, null);
        if (ps) { names[ps] = true; }
    }
    return names;
};

MCP.register("relinkFonts", function (args) {
    var comps = MCP.workflow.compsInScope(args);
    var fromFont = String(MCP.requireArg(args, "fromFont"));
    var toFont = String(MCP.requireArg(args, "toFont"));
    var dryRun = MCP.bool(args.dryRun, false);
    var lower = fromFont.toLowerCase();
    var all = lower === "*" || lower === "all";
    var missing = lower === "missing" || lower === "substituted";
    var missingNames = missing ? MCP.workflow.substituteFontNames() : null;
    var matches = function (font) {
        if (all) { return true; }
        if (missing) { return !!missingNames[font]; }
        return font === fromFont;
    };
    var changed = [], warnings = [], matchedLayers = 0;
    for (var c = 0; c < comps.length; c++) {
        var comp = comps[c];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (!(L instanceof TextLayer)) { continue; }
            var prop = _mcpTry(function () { return L.property("ADBE Text Properties").property("ADBE Text Document"); }, null);
            if (!prop) { continue; }
            var nk = _mcpTry(function () { return prop.numKeys; }, 0);
            var hit = false;
            if (nk > 0) {
                for (var k = 1; k <= nk; k++) {
                    var doc = prop.keyValue(k);
                    var f = _mcpTry(function () { return doc.font; }, "");
                    if (!matches(f)) { continue; }
                    hit = true;
                    var readBack = f;
                    if (!dryRun) {
                        doc.font = toFont;
                        prop.setValueAtKey(k, doc);
                        readBack = _mcpTry(function () { return prop.keyValue(k).font; }, null);
                        if (readBack !== toFont) { warnings.push("Layer '" + L.name + "' key " + k + ": After Effects kept '" + readBack + "' instead of '" + toFont + "'. Check the PostScript name with list-fonts."); }
                    }
                    changed.push({ composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(L), keyIndex: k, before: f, after: dryRun ? toFont : readBack });
                }
            } else {
                var d = prop.value;
                var f2 = _mcpTry(function () { return d.font; }, "");
                if (matches(f2)) {
                    hit = true;
                    var rb = f2;
                    if (!dryRun) {
                        d.font = toFont;
                        prop.setValue(d);
                        rb = _mcpTry(function () { return prop.value.font; }, null);
                        if (rb !== toFont) { warnings.push("Layer '" + L.name + "': After Effects kept '" + rb + "' instead of '" + toFont + "'. Check the PostScript name with list-fonts."); }
                    }
                    changed.push({ composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(L), keyIndex: null, before: f2, after: dryRun ? toFont : rb });
                }
            }
            if (hit) { matchedLayers++; }
        }
    }
    return { scope: String(MCP.arg(args, "scope", "comp")), fromFont: fromFont, toFont: toFont, dryRun: dryRun, matchedLayers: matchedLayers, changedCount: dryRun ? 0 : changed.length, changes: changed, warnings: warnings };
}, { mutating: true });
