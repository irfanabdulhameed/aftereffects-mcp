/*
 * Vector commands: .ai and .svg files to shape layers, gradient fills and
 * strokes (colour stops through an animation preset), and shape groups from
 * SVG path data parsed on the server.
 *
 * Never read or write "ADBE Vector Grad Colors": any access from a script
 * raises a modal error that a try/catch does not catch. Gradient items are
 * only touched through their other children, looked up by match name.
 */

MCP.vectors = {};

/** English menu names with their usual command ids as a fallback for other languages. */
MCP.vectors.MENU = {
    createShapes: { name: "Create Shapes from Vector Layer", id: 3973 },
    copy: { name: "Copy", id: 19 },
    paste: { name: "Paste", id: 20 }
};

MCP.vectors.GRADIENT = { fill: "ADBE Vector Graphic - G-Fill", stroke: "ADBE Vector Graphic - G-Stroke" };
MCP.vectors.SOLID = { fill: "ADBE Vector Graphic - Fill", stroke: "ADBE Vector Graphic - Stroke" };
MCP.vectors.PATH_ITEMS = { "ADBE Vector Shape - Group": true, "ADBE Vector Shape - Rect": true, "ADBE Vector Shape - Ellipse": true, "ADBE Vector Shape - Star": true };
MCP.vectors.SCRATCH_NAME = "MCP gradient scratch";

/* ------------------------------------------------------------------ helpers */

MCP.vectors.menuId = function (key) {
    var spec = MCP.vectors.MENU[key];
    var id = 0;
    try { id = app.findMenuCommandId(spec.name); } catch (e) { id = 0; }
    return id || spec.id;
};

MCP.vectors.selectedLayers = function (comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (_mcpTry(function () { return L.selected; }, false)) { out.push(L); }
    }
    return out;
};

MCP.vectors.deselectAll = function (comp) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        try { L.selected = false; } catch (e) {}
    }
};

MCP.vectors.restoreSelection = function (comp, layers) {
    MCP.vectors.deselectAll(comp);
    for (var i = 0; i < layers.length; i++) {
        try { layers[i].selected = true; } catch (e) {}
    }
};

MCP.vectors.layerIds = function (comp) {
    var ids = {};
    for (var i = 1; i <= comp.numLayers; i++) { ids[_mcpTry(function () { return comp.layer(i).id; }, "i" + i)] = true; }
    return ids;
};

/** A summary that never walks properties (a full serialize would touch gradient colours). */
MCP.vectors.layerInfo = function (layer) {
    var out = MCP.serialize.layerRef(layer);
    out.type = MCP.layerType(layer);
    out.enabled = _mcpTry(function () { return layer.enabled; }, null);
    out.position = MCP.roundValue(_mcpTry(function () { return layer.property("ADBE Transform Group").property("ADBE Position").value; }, null));
    out.inPoint = MCP.round(layer.inPoint);
    out.outPoint = MCP.round(layer.outPoint);
    return out;
};

/** Names of the items directly under a shape layer's Contents (match names only are read). */
MCP.vectors.groupNames = function (layer) {
    var out = [];
    var c = _mcpTry(function () { return layer.property("ADBE Root Vectors Group"); }, null);
    var n = c ? _mcpTry(function () { return c.numProperties; }, 0) : 0;
    for (var i = 1; i <= n; i++) {
        var p = c.property(i);
        out.push(p.name);
    }
    return out;
};

/** Index chain of a group under Contents, for re-resolving it after edits. */
MCP.vectors.chainOf = function (group) {
    var chain = [];
    var cur = group;
    var guard = 0;
    while (cur && guard++ < 32) {
        var mn = _mcpTry(function () { return cur.matchName; }, "");
        if (mn === "ADBE Root Vectors Group") { break; }
        if (mn !== "ADBE Vectors Group") { chain.unshift(cur.propertyIndex); }
        cur = _mcpTry(function () { return cur.parentProperty; }, null);
    }
    return chain;
};

MCP.vectors.groupAt = function (layer, chain) {
    var cur = layer.property("ADBE Root Vectors Group");
    for (var i = 0; i < chain.length; i++) {
        if (i > 0) { cur = cur.property("ADBE Vectors Group"); }
        cur = cur.property(chain[i]);
    }
    return cur;
};

/** Direct items of a group as [{index, matchName}], reading match names only. */
MCP.vectors.itemList = function (items) {
    var out = [];
    for (var i = 1; i <= items.numProperties; i++) {
        out.push({ index: i, matchName: String(items.property(i).matchName) });
    }
    return out;
};

MCP.vectors.indicesOf = function (list, matchName) {
    var out = [];
    for (var i = 0; i < list.length; i++) { if (list[i].matchName === matchName) { out.push(list[i].index); } }
    return out;
};

/** Depth-first search for the first property with a match name, reading match names only. */
MCP.vectors.findDeep = function (root, matchName, depth) {
    if (depth > 10) { return null; }
    var n = _mcpTry(function () { return root.numProperties; }, 0);
    for (var i = 1; i <= n; i++) {
        var p = root.property(i);
        var mn = String(_mcpTry(function () { return p.matchName; }, ""));
        if (mn === matchName) { return p; }
        if (mn === "ADBE Vector Group" || mn === "ADBE Vectors Group" || mn === "ADBE Root Vectors Group") {
            var hit = MCP.vectors.findDeep(p, matchName, depth + 1);
            if (hit) { return hit; }
        }
    }
    return null;
};

/** Bounds {left, top, right, bottom} of the paths in a group at time t, in group space, or null. */
MCP.vectors.groupBounds = function (group, t) {
    var items = MCP.shape.itemsOf(group);
    var b = null;
    for (var i = 1; i <= items.numProperties; i++) {
        var it = items.property(i);
        var mn = String(it.matchName);
        if (!MCP.vectors.PATH_ITEMS[mn]) { continue; }
        var shape = _mcpTry(function () { return MCP.shape.toShape(it, t, null); }, null);
        if (!shape) { continue; }
        var v = shape.vertices;
        for (var k = 0; k < v.length; k++) {
            if (!b) { b = { left: v[k][0], top: v[k][1], right: v[k][0], bottom: v[k][1] }; continue; }
            if (v[k][0] < b.left) { b.left = v[k][0]; }
            if (v[k][0] > b.right) { b.right = v[k][0]; }
            if (v[k][1] < b.top) { b.top = v[k][1]; }
            if (v[k][1] > b.bottom) { b.bottom = v[k][1]; }
        }
    }
    return b;
};

/* ----------------------------------------------------- import vector files */

/** Copies the layers of an SVG composition into comp, keeping their order. Returns the new layers, top first. */
MCP.vectors.copyCompLayers = function (svgComp, comp, position, notes) {
    var before = MCP.vectors.layerIds(comp);
    for (var i = svgComp.numLayers; i >= 1; i--) {
        try { svgComp.layer(i).copyToComp(comp); } catch (e) { notes.push("Layer '" + svgComp.layer(i).name + "' could not be copied: " + e.toString()); }
    }
    var added = [];
    for (var j = 1; j <= comp.numLayers; j++) {
        var L = comp.layer(j);
        if (!before[_mcpTry(function () { return L.id; }, "x")]) { added.push(L); }
    }
    var target = MCP.isArray(position) ? position : [comp.width / 2, comp.height / 2];
    var dx = target[0] - svgComp.width / 2, dy = target[1] - svgComp.height / 2;
    if (dx !== 0 || dy !== 0) {
        for (var k = 0; k < added.length; k++) {
            var lay = added[k];
            if (lay.parent) { continue; }
            var pos = _mcpTry(function () { return lay.property("ADBE Transform Group").property("ADBE Position"); }, null);
            if (!pos || pos.numKeys > 0) { continue; }
            var v = pos.value;
            try { pos.setValue(v.length > 2 ? [v[0] + dx, v[1] + dy, v[2]] : [v[0] + dx, v[1] + dy]); } catch (e2) {}
        }
    }
    return added;
};

/** Runs Create Shapes from Vector Layer on one footage layer. Returns the new shape layer or null. */
MCP.vectors.createShapes = function (comp, layer) {
    var before = MCP.vectors.layerIds(comp);
    var selection = MCP.vectors.selectedLayers(comp);
    var made = null;
    try {
        try { comp.openInViewer(); } catch (e0) {}
        MCP.vectors.deselectAll(comp);
        layer.selected = true;
        app.executeCommand(MCP.vectors.menuId("createShapes"));
        var wanted = layer.name + " Outlines";
        for (var i = 1; i <= comp.numLayers && !made; i++) {
            var L = comp.layer(i);
            if (L instanceof ShapeLayer && !before[_mcpTry(function () { return L.id; }, "x")] && L.name === wanted) { made = L; }
        }
        for (var j = 1; j <= comp.numLayers && !made; j++) {
            var L2 = comp.layer(j);
            if (L2 instanceof ShapeLayer && !before[_mcpTry(function () { return L2.id; }, "x")]) { made = L2; }
        }
    } finally {
        MCP.vectors.restoreSelection(comp, selection);
    }
    return made;
};

MCP.vectors.importAs = function (file, type) {
    var io = new ImportOptions(file);
    if (type !== null) {
        var ok = _mcpTry(function () { return io.canImportAs(type); }, false);
        if (!ok) { return null; }
        io.importAs = type;
    }
    return app.project.importFile(io);
};

MCP.register("importVectorAsShapes", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var file = new File(String(MCP.requireArg(args, "path")));
    if (!file.exists) { MCP.fail("File not found: " + file.fsName, "not-found"); }
    var ext = String(MCP.arg(args, "extension", "")).toLowerCase() || String(file.name).replace(/^.*\./, "").toLowerCase();
    var isSvg = ext === "svg";
    var mode = String(MCP.arg(args, "mode", "auto"));
    var notes = [];
    if (isSvg) {
        if (MCP.aeVersion() < 26) {
            MCP.fail("After Effects " + app.version + " cannot import SVG files (SVG import arrived in 26.0). Save the artwork as .ai from a vector editor, or pass its path data to shape-from-svg-path.", "unsupported");
        }
    }
    var item = null, route = null, sourceLayer = null, shapeLayers = [], svgComp = null;
    var footageType = _mcpTry(function () { return ImportAsType.FOOTAGE; }, null);
    var compType = _mcpTry(function () { return ImportAsType.COMP; }, null);
    var tryFootage = !isSvg || mode !== "composition";
    if (tryFootage) {
        try { item = MCP.vectors.importAs(file, footageType); } catch (e1) { item = null; notes.push("Import as footage failed: " + e1.toString()); }
        if (item && item instanceof CompItem) { svgComp = item; item = null; }
        if (item) {
            sourceLayer = comp.layers.add(item);
            if (MCP.isArray(args.position)) { try { sourceLayer.property("ADBE Transform Group").property("ADBE Position").setValue(args.position); } catch (e2) {} }
            var made = MCP.vectors.createShapes(comp, sourceLayer);
            if (made) {
                route = "create-shapes";
                shapeLayers.push(made);
            } else if (isSvg && mode === "auto") {
                notes.push("Create Shapes from Vector Layer made no shape layer from the SVG footage; imported it as a composition instead.");
                try { sourceLayer.remove(); } catch (e3) {}
                sourceLayer = null;
                if (_mcpTry(function () { return item.usedIn.length; }, 1) === 0) { try { item.remove(); } catch (e4) {} }
                item = null;
            } else {
                MCP.fail("Create Shapes from Vector Layer produced no shape layer from '" + file.displayName + "'. The footage layer was left in the comp; check that the file holds vector artwork.", "script-error", { sourceLayer: MCP.vectors.layerInfo(sourceLayer) });
            }
        }
    }
    if (!route && isSvg && !svgComp) {
        try { svgComp = MCP.vectors.importAs(file, compType); } catch (e5) { svgComp = null; notes.push("Import as composition failed: " + e5.toString()); }
        if (svgComp && !(svgComp instanceof CompItem)) {
            if (_mcpTry(function () { return svgComp.usedIn.length; }, 1) === 0) { try { svgComp.remove(); } catch (e6) {} }
            svgComp = null;
        }
    }
    if (!route && svgComp) {
        route = "svg-composition";
        item = svgComp;
        shapeLayers = MCP.vectors.copyCompLayers(svgComp, comp, args.position, notes);
        if (!shapeLayers.length) { MCP.fail("The SVG composition '" + svgComp.name + "' has no layers to copy.", "script-error"); }
    }
    if (!route) { MCP.fail("'" + file.displayName + "' could not be imported as vector artwork. " + notes.join(" "), "unsupported", { notes: notes }); }
    if (MCP.isDefined(args.name)) {
        if (shapeLayers.length === 1) { shapeLayers[0].name = String(args.name); }
        else { notes.push("name was not applied: the SVG made " + shapeLayers.length + " layers."); }
    }
    var sourceRemoved = false;
    var sourceInfo = sourceLayer ? MCP.vectors.layerInfo(sourceLayer) : null;
    if (sourceLayer && MCP.bool(args.removeSource, false)) {
        sourceLayer.remove();
        sourceRemoved = true;
    }
    var itemInfo = item ? { id: item.id, name: item.name, type: MCP.itemType(item) } : null;
    var itemRemoved = false;
    if (item && MCP.bool(args.removeFootageItem, false)) {
        var users = _mcpTry(function () { return item.usedIn.length; }, 1);
        if (users === 0) { item.remove(); itemRemoved = true; }
        else { notes.push("The imported item is still used by " + users + (users === 1 ? " comp" : " comps") + " (the vector layer is kept unless removeSource is true); it was not removed."); }
    }
    var shapes = [];
    for (var s = 0; s < shapeLayers.length; s++) {
        var g = MCP.vectors.groupNames(shapeLayers[s]);
        shapes.push({ layer: MCP.vectors.layerInfo(shapeLayers[s]), groupCount: g.length, groups: g });
    }
    return {
        composition: MCP.serialize.compRef(comp),
        file: file.fsName,
        route: route,
        sourceItem: itemInfo,
        footageItemRemoved: itemRemoved,
        sourceLayer: sourceInfo,
        sourceRemoved: sourceRemoved,
        shapeLayers: shapes,
        notes: notes
    };
}, { mutating: true });

/* -------------------------------------------------------- gradient fills */

/**
 * Applies a gradient preset to a temporary shape layer, copies the Gradient
 * Fill (or Stroke) it holds and pastes it into the target group. Existing
 * gradients of the same kind in the group are renamed to a marker first so
 * the pasted one can be told apart, then removed once the paste worked (or
 * renamed back when it did not).
 * Returns {ok, index, replaced, reason}; index is the pasted item's index in the group.
 */
MCP.vectors.OLD_MARK = "MCP replaced gradient ";

MCP.vectors.pasteGradientFromPreset = function (comp, layer, chain, kind, presetPath) {
    var gradMN = MCP.vectors.GRADIENT[kind];
    var label = kind === "fill" ? "Gradient Fill" : "Gradient Stroke";
    var presetFile = new File(String(presetPath));
    if (!presetFile.exists) { return { ok: false, reason: "The generated preset is missing: " + presetFile.fsName }; }
    var selection = MCP.vectors.selectedLayers(comp);
    var scratch = null;
    var result = { ok: false, reason: null, index: null, replaced: 0 };
    var renamed = [];
    var i;
    try {
        try { comp.openInViewer(); } catch (e0) {}
        scratch = comp.layers.addShape();
        scratch.name = MCP.vectors.SCRATCH_NAME;
        MCP.vectors.deselectAll(comp);
        scratch.selected = true;
        try { scratch.applyPreset(presetFile); } catch (e1) { result.reason = "applyPreset failed: " + e1.toString(); return result; }
        var source = MCP.vectors.findDeep(scratch.property("ADBE Root Vectors Group"), gradMN, 0);
        if (!source) { result.reason = "The preset added no " + label + ". Save the template from a shape group that holds one."; return result; }
        source.selected = true;
        app.executeCommand(MCP.vectors.menuId("copy"));
        try { source.selected = false; } catch (e2) {}
        scratch.selected = false;
        var items = MCP.shape.itemsOf(MCP.vectors.groupAt(layer, chain));
        var before = MCP.vectors.itemList(items);
        var olds = MCP.vectors.indicesOf(before, gradMN);
        for (i = 0; i < olds.length; i++) {
            var oldItem = items.property(olds[i]);
            renamed.push({ index: olds[i], name: oldItem.name });
            oldItem.name = MCP.vectors.OLD_MARK + (i + 1);
        }
        layer.selected = true;
        // Select an item inside the group so the paste lands in it; an empty group is selected itself.
        var anchor = null;
        var solidIdx = MCP.vectors.indicesOf(before, MCP.vectors.SOLID[kind]);
        if (solidIdx.length) { anchor = items.property(solidIdx[0]); }
        else if (olds.length) { anchor = items.property(olds[0]); }
        else if (before.length) { anchor = items.property(before.length); }
        if (anchor) { anchor.selected = true; } else { MCP.vectors.groupAt(layer, chain).selected = true; }
        var root = layer.property("ADBE Root Vectors Group");
        var rootBefore = {};
        for (i = 1; i <= root.numProperties; i++) { rootBefore[String(root.property(i).name)] = true; }
        var layersBefore = MCP.vectors.layerIds(comp);
        app.executeCommand(MCP.vectors.menuId("paste"));
        items = MCP.shape.itemsOf(MCP.vectors.groupAt(layer, chain));
        if (items.numProperties !== before.length + 1) {
            // A paste that landed at the top of Contents, or pasted whole layers, is removed again.
            root = layer.property("ADBE Root Vectors Group");
            for (i = root.numProperties; i >= 1; i--) {
                if (!rootBefore[String(root.property(i).name)]) { try { root.property(i).remove(); } catch (e6) {} root = layer.property("ADBE Root Vectors Group"); }
            }
            for (i = comp.numLayers; i >= 1; i--) {
                var stray = comp.layer(i);
                if (stray !== scratch && !layersBefore[_mcpTry(function () { return stray.id; }, "x")]) { try { stray.remove(); } catch (e7) {} }
            }
            result.reason = "Paste did not add the " + label + " to the group.";
            return result;
        }
        var idx = null;
        for (i = 1; i <= items.numProperties && idx === null; i++) {
            var it = items.property(i);
            if (String(it.matchName) === gradMN && String(it.name).indexOf(MCP.vectors.OLD_MARK) !== 0) { idx = i; }
        }
        if (idx === null) { result.reason = "The item pasted into the group is not a " + label + "."; return result; }
        for (i = items.numProperties; i >= 1; i--) {
            var cand = items.property(i);
            if (String(cand.name).indexOf(MCP.vectors.OLD_MARK) === 0) {
                cand.remove();
                if (i < idx) { idx--; }
                result.replaced++;
                items = MCP.shape.itemsOf(MCP.vectors.groupAt(layer, chain));
            }
        }
        renamed = [];
        result.ok = true;
        result.index = idx;
        return result;
    } finally {
        if (renamed.length) {
            var back = _mcpTry(function () { return MCP.shape.itemsOf(MCP.vectors.groupAt(layer, chain)); }, null);
            for (i = 1; back && i <= back.numProperties; i++) {
                var b = back.property(i);
                var nm = String(b.name);
                if (nm.indexOf(MCP.vectors.OLD_MARK) !== 0) { continue; }
                var k = parseInt(nm.substr(MCP.vectors.OLD_MARK.length), 10) - 1;
                if (renamed[k]) { try { b.name = renamed[k].name; } catch (e5) {} }
            }
        }
        if (scratch) { try { scratch.remove(); } catch (e3) {} }
        MCP.vectors.restoreSelection(comp, selection);
        try { presetFile.remove(); } catch (e4) {}
    }
};

/** Index after the last path item (including nested groups) in a group's items, so a fill or stroke below it draws on them. */
MCP.vectors.lastShapeIndex = function (items) {
    var last = 0;
    for (var i = 1; i <= items.numProperties; i++) {
        var mn = String(items.property(i).matchName);
        if (MCP.vectors.PATH_ITEMS[mn] || mn === "ADBE Vector Group") { last = i; }
    }
    return last;
};

MCP.vectors.setChild = function (grad, matchName, value, label, changed, notes) {
    var p = _mcpTry(function () { return grad.property(matchName); }, null);
    if (!p) { notes.push(label + " is not available on this gradient; skipped."); return; }
    try {
        if (p.numKeys > 0) { MCP.easing.setKey(p, grad.propertyGroup(grad.propertyDepth).containingComp.time, value); }
        else { p.setValue(value); }
        changed.push(label);
    } catch (e) { notes.push("Could not set " + label + ": " + e.toString()); }
};

MCP.vectors.readChild = function (grad, matchName) {
    var p = _mcpTry(function () { return grad.property(matchName); }, null);
    return p ? MCP.roundValue(_mcpTry(function () { return p.value; }, null)) : null;
};

MCP.register("setShapeGradient", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var kind = String(MCP.arg(args, "target", "fill")) === "stroke" ? "stroke" : "fill";
    var gradMN = MCP.vectors.GRADIENT[kind], solidMN = MCP.vectors.SOLID[kind];
    var group = MCP.shape.resolveGroup(layer, args.group);
    var chain = MCP.vectors.chainOf(group);
    var changed = [], notes = [];
    var stopsInfo = { requested: MCP.isArray(args.stops) ? args.stops.length : 0, applied: false, route: null, reason: null };
    var created = false;
    var solidSnapshot = null;

    // Read the solid fill or stroke settings before anything changes.
    var solid = MCP.shape.findItem(group, solidMN);
    if (solid) {
        solidSnapshot = {
            opacity: _mcpTry(function () { return solid.property(kind === "fill" ? "ADBE Vector Fill Opacity" : "ADBE Vector Stroke Opacity").value; }, null),
            width: kind === "stroke" ? _mcpTry(function () { return solid.property("ADBE Vector Stroke Width").value; }, null) : null,
            cap: kind === "stroke" ? _mcpTry(function () { return solid.property("ADBE Vector Stroke Line Cap").value; }, null) : null,
            join: kind === "stroke" ? _mcpTry(function () { return solid.property("ADBE Vector Stroke Line Join").value; }, null) : null,
            rule: kind === "fill" ? _mcpTry(function () { return solid.property("ADBE Vector Fill Rule").value; }, null) : null
        };
    }

    // And the gradient that a pasted one would replace, so its settings carry over.
    var prev = MCP.shape.findItem(group, gradMN);
    var prevSnapshot = null;
    if (prev && stopsInfo.requested) {
        prevSnapshot = {
            type: Number(MCP.vectors.readChild(prev, "ADBE Vector Grad Type")) === 2 ? "radial" : "linear",
            start: MCP.vectors.readChild(prev, "ADBE Vector Grad Start Pt"),
            end: MCP.vectors.readChild(prev, "ADBE Vector Grad End Pt"),
            highlightLength: MCP.vectors.readChild(prev, "ADBE Vector Grad HiLite Length"),
            highlightAngle: MCP.vectors.readChild(prev, "ADBE Vector Grad HiLite Angle"),
            opacity: MCP.vectors.readChild(prev, kind === "fill" ? "ADBE Vector Fill Opacity" : "ADBE Vector Stroke Opacity"),
            width: kind === "stroke" ? MCP.vectors.readChild(prev, "ADBE Vector Stroke Width") : null
        };
    }

    var gradIndex = null;
    if (stopsInfo.requested) {
        if (args.presetPath) {
            var pasted = MCP.vectors.pasteGradientFromPreset(comp, layer, chain, kind, args.presetPath);
            if (pasted.ok) {
                gradIndex = pasted.index;
                stopsInfo.applied = true;
                stopsInfo.route = "preset";
                created = true;
                changed.push("stops");
                if (pasted.replaced) { changed.push("replacedGradient"); } else { prevSnapshot = null; }
            } else {
                stopsInfo.reason = pasted.reason;
                prevSnapshot = null;
            }
        } else {
            stopsInfo.reason = args.stopsUnavailable || "No gradient template was found, so the colour stops could not be written.";
            prevSnapshot = null;
        }
    }

    group = MCP.vectors.groupAt(layer, chain);
    var items = MCP.shape.itemsOf(group);
    if (gradIndex === null) {
        var existing = MCP.vectors.indicesOf(MCP.vectors.itemList(items), gradMN);
        if (existing.length) {
            gradIndex = existing[0];
        } else {
            items.addProperty(gradMN);
            created = true;
            changed.push(kind === "fill" ? "addedGradientFill" : "addedGradientStroke");
            group = MCP.vectors.groupAt(layer, chain);
            items = MCP.shape.itemsOf(group);
            gradIndex = items.numProperties;
        }
    }
    // Keep the gradient below every path so it draws on them.
    var lastShape = MCP.vectors.lastShapeIndex(items);
    if (gradIndex < lastShape) {
        items.property(gradIndex).moveTo(lastShape);
        gradIndex = lastShape;
        group = MCP.vectors.groupAt(layer, chain);
        items = MCP.shape.itemsOf(group);
    }
    // Remove the solid of the same kind so only the gradient draws.
    if (MCP.bool(args.replaceSolid, true)) {
        var solids = MCP.vectors.indicesOf(MCP.vectors.itemList(items), solidMN);
        for (var s = solids.length - 1; s >= 0; s--) {
            items.property(solids[s]).remove();
            if (solids[s] < gradIndex) { gradIndex--; }
            changed.push(kind === "fill" ? "removedSolidFill" : "removedSolidStroke");
            group = MCP.vectors.groupAt(layer, chain);
            items = MCP.shape.itemsOf(group);
        }
    }
    var grad = items.property(gradIndex);

    // Defaults: the settings of a replaced gradient, else (for a new one) across the group's own paths.
    var base = prevSnapshot;
    var start = MCP.isArray(args.start) ? [Number(args.start[0]), Number(args.start[1])] : (base ? base.start : null);
    var end = MCP.isArray(args.end) ? [Number(args.end[0]), Number(args.end[1])] : (base ? base.end : null);
    var type = MCP.isDefined(args.type) ? String(args.type) : (base ? base.type : (created ? "linear" : null));
    if (created && !base && (!start || !end)) {
        var b = MCP.vectors.groupBounds(group, comp.time);
        if (b) {
            var cy = (b.top + b.bottom) / 2, cx = (b.left + b.right) / 2;
            if (type === "radial") {
                if (!start) { start = [cx, cy]; }
                if (!end) { end = [b.right, cy]; }
            } else {
                if (!start) { start = [b.left, cy]; }
                if (!end) { end = [b.right, cy]; }
            }
        }
    }
    var hlLength = MCP.isDefined(args.highlightLength) ? Number(args.highlightLength) : (base ? base.highlightLength : null);
    var hlAngle = MCP.isDefined(args.highlightAngle) ? Number(args.highlightAngle) : (base ? base.highlightAngle : null);
    if (type) { MCP.vectors.setChild(grad, "ADBE Vector Grad Type", type === "radial" ? 2 : 1, "type", changed, notes); }
    if (start) { MCP.vectors.setChild(grad, "ADBE Vector Grad Start Pt", start, "start", changed, notes); }
    if (end) { MCP.vectors.setChild(grad, "ADBE Vector Grad End Pt", end, "end", changed, notes); }
    if (typeof hlLength === "number") { MCP.vectors.setChild(grad, "ADBE Vector Grad HiLite Length", hlLength, "highlightLength", changed, notes); }
    if (typeof hlAngle === "number") { MCP.vectors.setChild(grad, "ADBE Vector Grad HiLite Angle", hlAngle, "highlightAngle", changed, notes); }
    var opacityMN = kind === "fill" ? "ADBE Vector Fill Opacity" : "ADBE Vector Stroke Opacity";
    var opacity = MCP.isDefined(args.opacity) ? Number(args.opacity) : (base && typeof base.opacity === "number" ? base.opacity : (created && solidSnapshot && typeof solidSnapshot.opacity === "number" ? solidSnapshot.opacity : null));
    if (opacity !== null) { MCP.vectors.setChild(grad, opacityMN, opacity, "opacity", changed, notes); }
    if (kind === "stroke") {
        var width = null;
        if (MCP.isDefined(args.width)) { width = Number(args.width); }
        else if (base && typeof base.width === "number") { width = base.width; }
        else if (created) { width = (solidSnapshot && typeof solidSnapshot.width === "number") ? solidSnapshot.width : 2; }
        if (width !== null) { MCP.vectors.setChild(grad, "ADBE Vector Stroke Width", width, "width", changed, notes); }
        if (created && solidSnapshot) {
            if (typeof solidSnapshot.cap === "number") { MCP.vectors.setChild(grad, "ADBE Vector Stroke Line Cap", solidSnapshot.cap, "lineCap", changed, notes); }
            if (typeof solidSnapshot.join === "number") { MCP.vectors.setChild(grad, "ADBE Vector Stroke Line Join", solidSnapshot.join, "lineJoin", changed, notes); }
        }
    } else if (created && solidSnapshot && typeof solidSnapshot.rule === "number") {
        MCP.vectors.setChild(grad, "ADBE Vector Fill Rule", solidSnapshot.rule, "fillRule", changed, notes);
    }
    var values = {
        type: Number(MCP.vectors.readChild(grad, "ADBE Vector Grad Type")) === 2 ? "radial" : "linear",
        start: MCP.vectors.readChild(grad, "ADBE Vector Grad Start Pt"),
        end: MCP.vectors.readChild(grad, "ADBE Vector Grad End Pt"),
        highlightLength: MCP.vectors.readChild(grad, "ADBE Vector Grad HiLite Length"),
        highlightAngle: MCP.vectors.readChild(grad, "ADBE Vector Grad HiLite Angle"),
        opacity: MCP.vectors.readChild(grad, opacityMN)
    };
    if (kind === "stroke") { values.width = MCP.vectors.readChild(grad, "ADBE Vector Stroke Width"); }
    var out = {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layerRef(layer),
        target: kind,
        group: MCP.shape.nodeSummary(group),
        gradient: MCP.shape.nodeSummary(grad),
        gradientPath: MCP.pathOf(grad).path,
        created: created,
        values: values,
        changed: changed,
        stops: stopsInfo,
        notes: notes
    };
    if (stopsInfo.requested && !stopsInfo.applied && !MCP.bool(args.stopsOptional, false)) {
        MCP.fail("The gradient type and points were set, but the colour stops were not: " + stopsInfo.reason + " Pass stopsOptional true to accept the gradient without stops.", "unsupported", out);
    }
    return out;
}, { mutating: true });

/* --------------------------------------------------------- SVG path data */

MCP.vectors.toShape = function (spec) {
    var s = new Shape();
    s.vertices = spec.vertices;
    s.inTangents = spec.inTangents;
    s.outTangents = spec.outTangents;
    s.closed = !!spec.closed;
    return s;
};

MCP.register("shapeFromSvgPath", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var paths = MCP.requireArg(args, "paths");
    if (!MCP.isArray(paths) || !paths.length) { MCP.fail("paths must be a non-empty array (the server parses d into it).", "invalid-argument"); }
    var layer, mode, chain, notes = [];
    if (MCP.isDefined(args.layer)) {
        layer = MCP.resolveLayer(comp, args.layer);
        MCP.shape.contents(layer);
        if (MCP.isDefined(args.group)) {
            mode = "replace";
            chain = MCP.vectors.chainOf(MCP.shape.resolveGroup(layer, args.group));
        } else {
            mode = "add";
        }
    } else {
        mode = "new-layer";
        layer = comp.layers.addShape();
        layer.name = String(MCP.arg(args, "name", "SVG Path"));
        var tg = layer.property("ADBE Transform Group");
        tg.property("ADBE Anchor Point").setValue([0, 0]);
        tg.property("ADBE Position").setValue(MCP.isArray(args.position) ? [Number(args.position[0]), Number(args.position[1])] : [comp.width / 2, comp.height / 2]);
    }
    if (mode !== "replace") {
        var g = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        g.name = String(MCP.arg(args, "groupName", "SVG Path"));
        chain = MCP.vectors.chainOf(g);
    }
    var group = MCP.vectors.groupAt(layer, chain);
    var items = MCP.shape.itemsOf(group);
    var removed = 0;
    if (mode === "replace") {
        for (var r = items.numProperties; r >= 1; r--) {
            if (MCP.vectors.PATH_ITEMS[String(items.property(r).matchName)]) { items.property(r).remove(); removed++; items = MCP.shape.itemsOf(MCP.vectors.groupAt(layer, chain)); }
        }
    }
    var vertexCount = 0;
    for (var i = 0; i < paths.length; i++) {
        items = MCP.shape.itemsOf(MCP.vectors.groupAt(layer, chain));
        var p = items.addProperty("ADBE Vector Shape - Group");
        p.property("ADBE Vector Shape").setValue(MCP.vectors.toShape(paths[i]));
        vertexCount += paths[i].vertices.length;
        if (mode === "replace") {
            items = MCP.shape.itemsOf(MCP.vectors.groupAt(layer, chain));
            items.property(items.numProperties).moveTo(i + 1);
        }
    }
    group = MCP.vectors.groupAt(layer, chain);
    items = MCP.shape.itemsOf(group);
    var hasStroke = (MCP.isDefined(args.strokeWidth) && Number(args.strokeWidth) > 0) || MCP.isDefined(args.strokeColor);
    var fill = MCP.shape.findItem(group, "ADBE Vector Graphic - Fill");
    var stroke = MCP.shape.findItem(group, "ADBE Vector Graphic - Stroke");
    var wantFill = !MCP.bool(args.noFill, false) && (MCP.isDefined(args.fillColor) || (mode !== "replace" && !hasStroke));
    if (wantFill) {
        if (!fill) {
            items.addProperty("ADBE Vector Graphic - Fill");
            items = MCP.shape.itemsOf(MCP.vectors.groupAt(layer, chain));
            var lastPath = MCP.vectors.lastShapeIndex(items);
            if (mode === "replace" && lastPath < items.numProperties - 1) { items.property(items.numProperties).moveTo(lastPath + 1); }
            fill = MCP.shape.findItem(MCP.vectors.groupAt(layer, chain), "ADBE Vector Graphic - Fill");
        }
        fill.property("ADBE Vector Fill Color").setValue(MCP.color.rgba(args.fillColor, [1, 1, 1, 1]));
    } else if (MCP.bool(args.noFill, false) && fill && mode === "replace") {
        notes.push("noFill keeps the group's existing fill; remove it with set-shape-fill or by hand.");
    }
    if (MCP.isDefined(args.fillRule)) {
        fill = MCP.shape.findItem(MCP.vectors.groupAt(layer, chain), "ADBE Vector Graphic - Fill");
        if (fill) { fill.property("ADBE Vector Fill Rule").setValue(String(args.fillRule) === "even-odd" ? 2 : 1); }
        else { notes.push("fillRule needs a fill; none was added."); }
    }
    if (hasStroke) {
        stroke = MCP.shape.findItem(MCP.vectors.groupAt(layer, chain), "ADBE Vector Graphic - Stroke");
        if (!stroke) { MCP.shape.itemsOf(MCP.vectors.groupAt(layer, chain)).addProperty("ADBE Vector Graphic - Stroke"); stroke = MCP.shape.findItem(MCP.vectors.groupAt(layer, chain), "ADBE Vector Graphic - Stroke"); }
        if (MCP.isDefined(args.strokeColor)) { stroke.property("ADBE Vector Stroke Color").setValue(MCP.color.rgba(args.strokeColor)); }
        var sw = MCP.isDefined(args.strokeWidth) && Number(args.strokeWidth) > 0 ? Number(args.strokeWidth) : 2;
        stroke.property("ADBE Vector Stroke Width").setValue(sw);
    }
    group = MCP.vectors.groupAt(layer, chain);
    items = MCP.shape.itemsOf(group);
    var pathPaths = [];
    for (var k = 1; k <= items.numProperties; k++) {
        var it = items.property(k);
        if (String(it.matchName) === "ADBE Vector Shape - Group") { pathPaths.push(MCP.pathOf(it.property("ADBE Vector Shape")).path); }
    }
    fill = MCP.shape.findItem(group, "ADBE Vector Graphic - Fill");
    stroke = MCP.shape.findItem(group, "ADBE Vector Graphic - Stroke");
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.vectors.layerInfo(layer),
        mode: mode,
        group: MCP.shape.nodeSummary(group),
        groupPath: MCP.pathOf(group).path,
        pathCount: paths.length,
        removedPaths: removed,
        pathPaths: pathPaths,
        vertexCount: vertexCount,
        bounds: MCP.isDefined(args.bounds) ? args.bounds : null,
        placement: MCP.isDefined(args.placement) ? args.placement : null,
        fillPath: fill ? MCP.pathOf(fill).path : null,
        strokePath: stroke ? MCP.pathOf(stroke).path : null,
        notes: notes
    };
}, { mutating: true });
