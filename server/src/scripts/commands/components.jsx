/*
 * Component commands: precompose layers into a reusable composition with
 * Essential Properties, add and list Essential Properties, set instance
 * values (static or keyed), place many instances, protect intro and outro
 * time with protected-region markers, export .mogrt templates, and insert
 * components from library .aep files.
 *
 * Instances hold their values in the layer group "ADBE Layer Overrides"
 * (shown as "Essential Properties"), one child per control, named by label.
 */

MCP.components = {};

MCP.components.OVERRIDES = "ADBE Layer Overrides";
MCP.components.LIBRARY_TAG = "Component library source: ";
MCP.components.SUPPORTED = "checkboxes, colours, Source Text, single numbers (Opacity, Rotation, Slider Control, Angle Control), 2D and 3D points (Position, Scale, Point Control) and Dropdown Menu Control menus";
MCP.components.SUPPORTED_LIST = ["checkbox", "color", "source-text", "1d-number", "2d-point", "3d-point", "dropdown-menu"];
/** Arrival easing for override keys: speed 0, long influence arriving, short leaving. */
MCP.components.DEFAULT_EASE = { type: "custom", inSpeed: 0, inInfluence: 100, outSpeed: 0, outInfluence: 25 };

MCP.components.requireApi = function () {
    MCP.requireVersion(16.1, "Essential Properties by script");
};

/* ------------------------------------------------------------ comp helpers */

MCP.components.layerWithSource = function (comp, item) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        var src = _mcpTry(function () { return L.source; }, null);
        if (src && src.id === item.id) { return L; }
    }
    return null;
};

/** Controller names in panel order. Tries 1-based indices, then 0-based. */
MCP.components.controllerNames = function (comp) {
    var n = _mcpTry(function () { return comp.motionGraphicsTemplateControllerCount; }, null);
    if (n === null || n === undefined) {
        MCP.fail("This version of After Effects cannot read Essential Properties by script (needs 16.1 or later).", "unsupported");
    }
    var names = [], ok = true, i, nm;
    for (i = 1; i <= n; i++) {
        nm = _mcpTry(function () { return comp.getMotionGraphicsTemplateControllerName(i); }, undefined);
        if (nm === undefined || nm === null) { ok = false; break; }
        names.push(String(nm));
    }
    if (!ok) {
        names = [];
        for (i = 0; i < n; i++) {
            nm = _mcpTry(function () { return comp.getMotionGraphicsTemplateControllerName(i); }, "");
            names.push(String(nm));
        }
    }
    return names;
};

MCP.components.compInfo = function (comp) {
    return {
        id: comp.id,
        name: comp.name,
        width: comp.width,
        height: comp.height,
        duration: MCP.round(comp.duration),
        durationFrames: MCP.frameOf(comp, comp.duration),
        frameRate: MCP.round(comp.frameRate),
        numLayers: comp.numLayers,
        templateName: _mcpTry(function () { return comp.motionGraphicsTemplateName; }, null),
        essentialPropertyCount: _mcpTry(function () { return comp.motionGraphicsTemplateControllerCount; }, null),
        parentFolder: _mcpTry(function () { return comp.parentFolder ? comp.parentFolder.name : null; }, null)
    };
};

/** Layers in the project whose source is this comp: [{composition, layer}]. */
MCP.components.instancesOf = function (component, cap) {
    var out = [];
    var users = _mcpTry(function () { return component.usedIn; }, []) || [];
    var max = cap || 50;
    for (var u = 0; u < users.length && out.length < max; u++) {
        var c = users[u];
        for (var j = 1; j <= c.numLayers && out.length < max; j++) {
            var L = c.layer(j);
            var src = _mcpTry(function () { return L.source; }, null);
            if (src && src.id === component.id) { out.push({ composition: MCP.serialize.compRef(c), layer: MCP.serialize.layerRef(L) }); }
        }
    }
    return out;
};

MCP.components.compNamed = function (name) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof CompItem && it.name === name) { return it; }
    }
    return null;
};

/** Unique layer name in comp: base, then "base 2", "base 3", ... */
MCP.components.uniqueLayerName = function (comp, base, ignore) {
    function taken(n) {
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (ignore && L.index === ignore.index) { continue; }
            if (L.name === n) { return true; }
        }
        return false;
    }
    if (!taken(base)) { return base; }
    for (var k = 2; k < 10000; k++) {
        if (!taken(base + " " + k)) { return base + " " + k; }
    }
    return base;
};

/* -------------------------------------------------------- property helpers */

/** Index path from the layer root, so a property can be found again after a precompose. */
MCP.components.indexPath = function (prop) {
    var idx = [], cur = prop, guard = 0;
    while (cur && guard++ < 40) {
        var d = _mcpTry(function () { return cur.propertyDepth; }, -1);
        if (d <= 0) { break; }
        idx.unshift(cur.propertyIndex);
        cur = _mcpTry(function () { return cur.parentProperty; }, null);
    }
    return idx;
};

MCP.components.byIndexPath = function (layer, idx) {
    var cur = layer;
    for (var i = 0; i < idx.length; i++) {
        var next = _mcpTry(function () { return cur.property(idx[i]); }, null);
        if (!next) { return null; }
        cur = next;
    }
    return cur;
};

/** Reason a property can never be an Essential Property, or null. */
MCP.components.typeProblem = function (prop) {
    if (MCP.isGroup(prop)) { return "it is a group, not a single property"; }
    var t = MCP.serialize.valueTypeName(prop);
    if (t === "1d" || t === "2d" || t === "2d-spatial" || t === "3d" || t === "3d-spatial" || t === "color" || t === "text-document") { return null; }
    return "its value type is " + t;
};

/**
 * Adds prop to comp's Essential Properties as label. Checks canAdd first
 * (After Effects shows a warning dialog when an add fails). Returns {ok, reason}.
 */
MCP.components.addProperty = function (prop, comp, label) {
    var where = MCP.pathOf(prop).path;
    var problem = MCP.components.typeProblem(prop);
    if (problem) {
        return { ok: false, reason: "'" + where + "' cannot be an Essential Property: " + problem + ". Supported: " + MCP.components.SUPPORTED + "." };
    }
    var can = _mcpTry(function () { return !!prop.canAddToMotionGraphicsTemplate(comp); }, false);
    if (!can) {
        return { ok: false, reason: "After Effects does not accept '" + where + "' (" + MCP.serialize.valueTypeName(prop) + ") as an Essential Property of '" + comp.name + "'. It may already be in the panel, or its kind is not supported. Supported: " + MCP.components.SUPPORTED + "." };
    }
    var before = _mcpTry(function () { return comp.motionGraphicsTemplateControllerCount; }, 0);
    var ret = null, err = null;
    try { ret = prop.addToMotionGraphicsTemplateAs(comp, label); } catch (e) { err = e.message; }
    var after = _mcpTry(function () { return comp.motionGraphicsTemplateControllerCount; }, before);
    if (ret === true || after > before) { return { ok: true, index: after }; }
    return { ok: false, reason: "addToMotionGraphicsTemplateAs did not add '" + where + "'" + (err ? ": " + err : ".") };
};

/** The instance's Essential Properties group, or null (fails when required). */
MCP.components.overridesGroup = function (layer, required) {
    var g = _mcpTry(function () { return layer.property(MCP.components.OVERRIDES); }, null);
    var src = _mcpTry(function () { return layer.source; }, null);
    if (required) {
        if (!(src instanceof CompItem)) {
            MCP.fail("Layer '" + layer.name + "' is not a component instance (its source is not a composition). Use create-component or add-component-instances first.", "invalid-argument");
        }
        if (!g || _mcpTry(function () { return g.numProperties; }, 0) === 0) {
            MCP.fail("Layer '" + layer.name + "' has no Essential Properties. Add some to its source comp '" + src.name + "' with add-essential-property.", "not-found");
        }
    }
    return g;
};

/** Leaf override properties in panel order: [{prop, label, path}], group names joined by "/". */
MCP.components.overrideLeaves = function (group) {
    var out = [];
    function walk(g, prefix, depth) {
        var n = _mcpTry(function () { return g.numProperties; }, 0);
        for (var i = 1; i <= n; i++) {
            var p = _mcpTry(function () { return g.property(i); }, null);
            if (!p) { continue; }
            if (MCP.isGroup(p) && depth < 8) { walk(p, prefix + p.name + "/", depth + 1); }
            else { out.push({ prop: p, label: p.name, path: prefix + p.name }); }
        }
    }
    if (group) { walk(group, "", 0); }
    return out;
};

MCP.components.labelsOf = function (leaves) {
    var out = [];
    for (var i = 0; i < leaves.length; i++) { out.push(leaves[i].path); }
    return out;
};

/** Leaf by path or label, exact first, then case-insensitive. */
MCP.components.findLeaf = function (leaves, label) {
    var s = String(label), lower = s.toLowerCase(), i, hits = [];
    for (i = 0; i < leaves.length; i++) { if (leaves[i].path === s) { return leaves[i]; } }
    for (i = 0; i < leaves.length; i++) { if (leaves[i].label === s) { return leaves[i]; } }
    for (i = 0; i < leaves.length; i++) {
        if (leaves[i].path.toLowerCase() === lower || leaves[i].label.toLowerCase() === lower) { hits.push(leaves[i]); }
    }
    return hits.length ? hits[0] : null;
};

/** Where an Essential Property comes from (After Effects 22 and later). */
MCP.components.sourceOf = function (prop) {
    var src = _mcpTry(function () { return prop.essentialPropertySource; }, null);
    if (!src) { return null; }
    if (src instanceof AVLayer) { return { kind: "media-replacement", layer: MCP.serialize.layerRef(src) }; }
    var layer = _mcpTry(function () { return src.propertyGroup(src.propertyDepth); }, null);
    return {
        kind: "property",
        layer: layer ? MCP.serialize.layerRef(layer) : null,
        path: MCP.pathOf(src).path,
        matchName: _mcpTry(function () { return src.matchName; }, null),
        value: MCP.serialize.value(src)
    };
};

MCP.components.describeLeaf = function (leaf) {
    var p = leaf.prop;
    return {
        label: leaf.label,
        path: leaf.path,
        valueType: MCP.serialize.valueTypeName(p),
        value: MCP.serialize.value(p),
        numKeys: _mcpTry(function () { return p.numKeys; }, 0),
        hasExpression: _mcpTry(function () { return p.canSetExpression && p.expression !== ""; }, false),
        source: MCP.components.sourceOf(p)
    };
};

MCP.components.describeInstance = function (layer) {
    var g = MCP.components.overridesGroup(layer, false);
    var leaves = MCP.components.overrideLeaves(g);
    var out = [];
    for (var i = 0; i < leaves.length; i++) { out.push(MCP.components.describeLeaf(leaves[i])); }
    return out;
};

/** 1-based menu index for a dropdown item's text, or 0 (After Effects 26 and later). */
MCP.components.dropdownIndex = function (prop, text) {
    var lower = String(text).toLowerCase();
    var candidates = [prop, _mcpTry(function () { return prop.essentialPropertySource; }, null)];
    for (var c = 0; c < candidates.length; c++) {
        var cand = candidates[c];
        if (!cand) { continue; }
        var items = _mcpTry(function () { return cand.propertyParameters; }, null);
        if (!items || !items.length) { continue; }
        for (var j = 0; j < items.length; j++) {
            if (String(items[j]).toLowerCase() === lower) { return j + 1; }
        }
    }
    return 0;
};

/** True for overrides whose keys should hold: Dropdown Menu and Checkbox controls. */
MCP.components.isStepped = function (prop) {
    var src = _mcpTry(function () { return prop.essentialPropertySource; }, null);
    var cands = [prop, src];
    for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (!c) { continue; }
        if (_mcpTry(function () { return !!c.isDropdownEffect; }, false)) { return true; }
        var mn = _mcpTry(function () { return String(c.matchName); }, "");
        if (/Checkbox Control-0001$/.test(mn) || /Dropdown Control-0001$/.test(mn)) { return true; }
    }
    return false;
};

/** Decoded file name of an ExtendScript File. */
MCP.components.fileName = function (file) {
    var n = _mcpTry(function () { return file.displayName; }, null);
    if (n) { return String(n); }
    return _mcpTry(function () { return decodeURI(file.name); }, String(file.name));
};

/**
 * Converts a JSON value into what the override property takes.
 * Returns {value, stepped}: stepped values (text, booleans, menu items) are keyed as holds.
 */
MCP.components.valueFor = function (leaf, raw, colorHint) {
    var prop = leaf.prop;
    var t = MCP.serialize.valueTypeName(prop);
    if (t === "text-document") {
        var text = (raw === null || raw === undefined) ? "" : (typeof raw === "object" && MCP.isDefined(raw.text) ? String(raw.text) : String(raw));
        return { value: MCP.valueForProperty(prop, text), stepped: true };
    }
    if (t === "color") {
        if (MCP.isArray(colorHint) && colorHint.length >= 3) {
            return { value: [Number(colorHint[0]), Number(colorHint[1]), Number(colorHint[2]), colorHint.length > 3 ? Number(colorHint[3]) : 1], stepped: false };
        }
        var c = MCP.coerceValue(prop, raw);
        if (typeof c === "string" && !/^#?[0-9a-fA-F]{3,8}$/.test(c)) {
            MCP.fail("Essential Property '" + leaf.path + "' is a colour. Give \"#RRGGBB\", [r, g, b] or {r, g, b}, not '" + c + "'.", "invalid-argument");
        }
        return { value: MCP.color.rgba(c), stepped: false };
    }
    var v = MCP.coerceValue(prop, raw);
    if (typeof v === "boolean") { return { value: v ? 1 : 0, stepped: true }; }
    if (typeof v === "string") {
        var idx = MCP.components.dropdownIndex(prop, v);
        if (idx > 0) { return { value: idx, stepped: true }; }
        MCP.fail("Essential Property '" + leaf.path + "' takes a " + t + " value, not the text '" + v + "'." + (t === "1d" ? " For a Dropdown Menu, give the 1-based item number (item text needs After Effects 26 or later)." : ""), "invalid-argument");
    }
    if (t === "1d") {
        if (MCP.isArray(v)) {
            if (v.length !== 1) { MCP.fail("Essential Property '" + leaf.path + "' takes one number, not [" + v.join(", ") + "].", "invalid-argument"); }
            v = Number(v[0]);
        }
        return { value: Number(v), stepped: MCP.components.isStepped(prop) };
    }
    if (t === "2d" || t === "2d-spatial" || t === "3d" || t === "3d-spatial") {
        var want = (t.charAt(0) === "2") ? 2 : 3;
        if (!MCP.isArray(v)) { MCP.fail("Essential Property '" + leaf.path + "' takes [" + (want === 2 ? "x, y" : "x, y, z") + "], not " + v + ".", "invalid-argument"); }
        var out = [];
        for (var i = 0; i < want; i++) {
            if (i < v.length) { out.push(Number(v[i])); }
            else {
                var cur = _mcpTry(function () { return prop.value; }, null);
                out.push(cur && cur.length > i ? cur[i] : 0);
            }
        }
        return { value: out, stepped: false };
    }
    return { value: v, stepped: false };
};

/** Resolves every label in values and keyframes. Returns the unknown labels. */
MCP.components.unknownLabels = function (leaves, values, keyframes) {
    var unknown = [], seen = {}, k, i;
    if (values && typeof values === "object") {
        for (k in values) {
            if (!Object.prototype.hasOwnProperty.call(values, k)) { continue; }
            if (!MCP.components.findLeaf(leaves, k) && !seen[k]) { seen[k] = true; unknown.push(k); }
        }
    }
    if (MCP.isArray(keyframes)) {
        for (i = 0; i < keyframes.length; i++) {
            var lbl = keyframes[i] ? keyframes[i].label : undefined;
            if (!MCP.isDefined(lbl)) { MCP.fail("keyframes[" + i + "] needs a label.", "invalid-argument"); }
            if (!MCP.components.findLeaf(leaves, lbl) && !seen[lbl]) { seen[lbl] = true; unknown.push(String(lbl)); }
        }
    }
    return unknown;
};

MCP.components.failUnknown = function (layer, unknown, leaves) {
    var labels = MCP.components.labelsOf(leaves);
    MCP.fail("Unknown Essential Property label" + (unknown.length > 1 ? "s" : "") + " on '" + layer.name + "': " + unknown.join(", ") + ". Labels on this instance: " + (labels.join(", ") || "(none)") + ".", "not-found", { unknown: unknown, labels: labels });
};

/**
 * Writes values and keyframes on an instance. comp is the composition that
 * holds the instance (key times are in its time). Fails before writing when
 * a label is unknown. Returns {results, failed, keyframes}.
 */
MCP.components.applyValues = function (comp, layer, values, keyframes, opts) {
    var o = opts || {};
    var hasValues = !!(values && typeof values === "object" && MCP.keys(values).length);
    var hasKeys = MCP.isArray(keyframes) && keyframes.length > 0;
    if (!hasValues && !hasKeys) { return { results: [], failed: 0, keyframes: [] }; }
    var group = MCP.components.overridesGroup(layer, true);
    var leaves = MCP.components.overrideLeaves(group);
    var unknown = MCP.components.unknownLabels(leaves, values, keyframes);
    if (unknown.length) { MCP.components.failUnknown(layer, unknown, leaves); }
    var hints = o.colorHints || {};
    var keyHints = MCP.isArray(o.keyColorHints) ? o.keyColorHints : [];
    var results = [], failed = 0, k, leaf;
    if (hasValues) {
        for (k in values) {
            if (!Object.prototype.hasOwnProperty.call(values, k)) { continue; }
            leaf = MCP.components.findLeaf(leaves, k);
            try {
                var conv = MCP.components.valueFor(leaf, values[k], hints[k]);
                var nk = _mcpTry(function () { return leaf.prop.numKeys; }, 0);
                if (nk > 0) {
                    MCP.fail("Essential Property '" + leaf.path + "' on '" + layer.name + "' has " + nk + " keyframes. Change it through keyframes, or pass replaceKeys with keyframes.", "invalid-argument");
                }
                leaf.prop.setValue(conv.value);
                var entry = { status: "ok", label: k, path: leaf.path, valueType: MCP.serialize.valueTypeName(leaf.prop), value: MCP.serialize.value(leaf.prop) };
                if (_mcpTry(function () { return leaf.prop.expressionEnabled && leaf.prop.expression !== ""; }, false)) {
                    entry.note = "This override has an expression, which decides the rendered value.";
                }
                results.push(entry);
            } catch (e) {
                failed++;
                results.push({ status: "error", label: k, path: leaf.path, message: e.message, code: e.mcpCode || "script-error" });
            }
        }
    }
    var written = [];
    if (hasKeys) {
        var byPath = {}, order = [], i;
        for (i = 0; i < keyframes.length; i++) {
            leaf = MCP.components.findLeaf(leaves, keyframes[i].label);
            if (!byPath[leaf.path]) { byPath[leaf.path] = { leaf: leaf, items: [] }; order.push(leaf.path); }
            byPath[leaf.path].items.push({ spec: keyframes[i], hint: keyHints[i] });
        }
        for (var p = 0; p < order.length; p++) {
            var grp = byPath[order[p]];
            var prop = grp.leaf.prop;
            try {
                if (!_mcpTry(function () { return prop.canVaryOverTime; }, false)) {
                    MCP.fail("Essential Property '" + grp.leaf.path + "' cannot be keyframed.", "unsupported");
                }
                var items = [];
                for (var j = 0; j < grp.items.length; j++) {
                    var sp = grp.items[j].spec;
                    var cv = MCP.components.valueFor(grp.leaf, sp.value, grp.items[j].hint);
                    items.push({ t: MCP.timeArg(comp, sp, comp.time), value: cv.value, stepped: cv.stepped, easing: sp.easing });
                }
                items.sort(function (a, b) { return a.t - b.t; });
                if (MCP.bool(o.replaceKeys, false)) {
                    while (prop.numKeys > 0) { prop.removeKey(prop.numKeys); }
                }
                for (j = 0; j < items.length; j++) { MCP.easing.setKey(prop, items[j].t, items[j].value); }
                var isText = MCP.serialize.valueTypeName(prop) === "text-document";
                var idx;
                for (j = 0; j < items.length && !isText; j++) {
                    idx = MCP.easing.keyIndexAtTime(prop, items[j].t, 1e-3);
                    if (idx < 1) { continue; }
                    var spec = MCP.isDefined(items[j].easing) ? items[j].easing : (items[j].stepped ? "hold" : MCP.components.DEFAULT_EASE);
                    try { MCP.easing.applySegment(prop, idx, spec); } catch (eEase) {}
                }
                // Read the keys back only after every segment is eased (easing key i changes key i-1).
                var keys = [];
                for (j = 0; j < items.length; j++) {
                    idx = MCP.easing.keyIndexAtTime(prop, items[j].t, 1e-3);
                    if (idx > 0) { keys.push(MCP.serialize.keyframe(prop, idx)); }
                }
                written.push({ status: "ok", label: grp.items[0].spec.label, path: grp.leaf.path, numKeys: prop.numKeys, keys: keys });
            } catch (e2) {
                failed++;
                written.push({ status: "error", label: grp.items[0].spec.label, path: grp.leaf.path, message: e2.message, code: e2.mcpCode || "script-error" });
            }
        }
    }
    return { results: results, failed: failed, keyframes: written };
};

/* ----------------------------------------------------------- crop helpers */

/** A layer-space point in comp space through the layer and its parents (2D: anchor, scale, Z rotation, position). */
MCP.components.toComp = function (layer, pt, t) {
    var x = pt[0], y = pt[1], cur = layer, guard = 0;
    while (cur && guard++ < 32) {
        var tg = cur.property("ADBE Transform Group");
        var a = tg.property("ADBE Anchor Point").valueAtTime(t, false);
        var s = tg.property("ADBE Scale").valueAtTime(t, false);
        var r = _mcpTry(function () { return tg.property("ADBE Rotate Z").valueAtTime(t, false); }, 0);
        var pos = tg.property("ADBE Position").valueAtTime(t, false);
        var dx = (x - a[0]) * s[0] / 100, dy = (y - a[1]) * s[1] / 100;
        var rad = r * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
        x = pos[0] + dx * cs - dy * sn;
        y = pos[1] + dx * sn + dy * cs;
        cur = _mcpTry(function () { return cur.parent; }, null);
    }
    return [x, y];
};

MCP.components.measurable = function (L) {
    if (L instanceof CameraLayer || L instanceof LightLayer) { return false; }
    if (!_mcpTry(function () { return L.enabled; }, true)) { return false; }
    if (_mcpTry(function () { return L.nullLayer || L.adjustmentLayer || L.guideLayer; }, false)) { return false; }
    if (_mcpTry(function () { return L.hasVideo; }, true) === false) { return false; }
    return true;
};

/** Union of the visible layers' bounds in comp space, sampled at in point, middle and last frame. */
MCP.components.contentBounds = function (comp) {
    var b = null, notes = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (!MCP.components.measurable(L)) { continue; }
        var fd = comp.frameDuration;
        var t0 = MCP.clamp(L.inPoint, 0, Math.max(0, comp.duration - fd));
        var t2 = MCP.clamp(L.outPoint - fd, 0, Math.max(0, comp.duration - fd));
        var times = [t0, (t0 + t2) / 2, t2];
        var extents = (L instanceof ShapeLayer);
        for (var k = 0; k < times.length; k++) {
            var t = times[k];
            var rect = _mcpTry(function () { return L.sourceRectAtTime(t, extents); }, null);
            if (!rect || !(rect.width > 0) || !(rect.height > 0)) { continue; }
            var corners = [[rect.left, rect.top], [rect.left + rect.width, rect.top], [rect.left + rect.width, rect.top + rect.height], [rect.left, rect.top + rect.height]];
            for (var c = 0; c < corners.length; c++) {
                var p = _mcpTry(function () { return MCP.components.toComp(L, corners[c], t); }, null);
                if (!p) { continue; }
                if (!b) { b = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; }
                else {
                    if (p[0] < b.x0) { b.x0 = p[0]; }
                    if (p[1] < b.y0) { b.y0 = p[1]; }
                    if (p[0] > b.x1) { b.x1 = p[0]; }
                    if (p[1] > b.y1) { b.y1 = p[1]; }
                }
            }
        }
        if (_mcpTry(function () { return L.threeDLayer; }, false)) { notes.push("Layer '" + L.name + "' is 3D; its bounds ignore depth and X/Y rotation."); }
    }
    return { bounds: b, notes: notes };
};

/** Subtracts [dx, dy] from Position (value or every key; separated dimensions too). Returns keys touched. */
MCP.components.offsetPosition = function (layer, dx, dy) {
    var tg = layer.property("ADBE Transform Group");
    var pos = tg.property("ADBE Position");
    function shift(prop, d0, d1) {
        var k, v;
        if (prop.numKeys > 0) {
            for (k = 1; k <= prop.numKeys; k++) {
                v = prop.keyValue(k);
                if (MCP.isArray(v)) { v = v.slice(0); v[0] -= d0; if (v.length > 1) { v[1] -= d1; } } else { v = v - d0; }
                prop.setValueAtKey(k, v);
            }
            return prop.numKeys;
        }
        v = prop.value;
        if (MCP.isArray(v)) { v = v.slice(0); v[0] -= d0; if (v.length > 1) { v[1] -= d1; } } else { v = v - d0; }
        prop.setValue(v);
        return 0;
    }
    if (_mcpTry(function () { return pos.dimensionsSeparated; }, false)) {
        return shift(tg.property("ADBE Position_0"), dx, 0) + shift(tg.property("ADBE Position_1"), dy, 0);
    }
    return shift(pos, dx, dy);
};

/** Crops the component to its content and keeps the instance's pixels where they were. */
MCP.components.cropToContent = function (comp, instance, pad) {
    var measured = MCP.components.contentBounds(comp);
    var b = measured.bounds;
    if (!b) { return { applied: false, reason: "no visible layer bounds to measure", notes: measured.notes }; }
    var x0 = Math.floor(b.x0 - pad), y0 = Math.floor(b.y0 - pad);
    var x1 = Math.ceil(b.x1 + pad), y1 = Math.ceil(b.y1 + pad);
    var W = MCP.clamp(x1 - x0, 4, 30000), H = MCP.clamp(y1 - y0, 4, 30000);
    var moved = 0, skipped = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (L.parent) { continue; }
        if (L instanceof CameraLayer || L instanceof LightLayer) { skipped.push(L.name + " (camera or light)"); continue; }
        try { MCP.components.offsetPosition(L, x0, y0); moved++; } catch (e) { skipped.push(L.name + " (" + e.message + ")"); }
        if (_mcpTry(function () { return L.property("ADBE Transform Group").property("ADBE Position").expression !== ""; }, false)) {
            measured.notes.push("Layer '" + L.name + "' has a Position expression; check it after the crop.");
        }
    }
    comp.width = W;
    comp.height = H;
    var tg = instance.property("ADBE Transform Group");
    var ap = tg.property("ADBE Anchor Point"), pp = tg.property("ADBE Position");
    var a0 = ap.value, p0 = pp.value;
    var a1 = [W / 2, H / 2];
    var p1 = [p0[0] - a0[0] + x0 + a1[0], p0[1] - a0[1] + y0 + a1[1]];
    if (a0.length > 2) { a1.push(a0[2]); }
    if (p0.length > 2) { p1.push(p0[2]); }
    ap.setValue(a1);
    pp.setValue(p1);
    return { applied: true, region: { x: x0, y: y0, width: W, height: H }, padding: pad, movedLayers: moved, skipped: skipped, notes: measured.notes };
};

/** Position in the selection for a component-layer reference: name, 1-based index, or LayerRef. */
MCP.components.selectionPosition = function (list, ref) {
    var names = [], i;
    for (i = 0; i < list.length; i++) { names.push((i + 1) + ": '" + list[i].name + "'"); }
    var r = ref;
    if (typeof r === "number") { r = { index: r }; }
    else if (typeof r === "string") { r = { name: r }; }
    if (!r || typeof r !== "object") { MCP.fail("Each property needs layer: a name or a 1-based index inside the new component. Layers: " + names.join(", "), "invalid-argument"); }
    if (MCP.isDefined(r.index)) {
        var idx = Number(r.index);
        if (idx < 1 || idx > list.length) { MCP.fail("Component layer index " + idx + " is out of range (1 to " + list.length + "). Layers: " + names.join(", "), "not-found"); }
        return idx - 1;
    }
    if (MCP.isDefined(r.id)) {
        for (i = 0; i < list.length; i++) { if (_mcpTry(function () { return list[i].id; }, null) === Number(r.id)) { return i; } }
        MCP.fail("No layer with id " + r.id + " among the layers being made into a component. Layers: " + names.join(", "), "not-found");
    }
    var name = String(r.name), hits = [];
    for (i = 0; i < list.length; i++) { if (list[i].name === name) { hits.push(i); } }
    if (!hits.length) {
        for (i = 0; i < list.length; i++) { if (list[i].name.toLowerCase() === name.toLowerCase()) { hits.push(i); } }
    }
    if (hits.length === 1) { return hits[0]; }
    if (hits.length > 1) { MCP.fail("Layer name '" + name + "' matches " + hits.length + " of the component's layers. Use its 1-based index inside the component instead. Layers: " + names.join(", "), "ambiguous"); }
    MCP.fail("Layer '" + name + "' is not one of the layers being made into a component. Layers: " + names.join(", "), "not-found");
    return -1;
};

/** Name, position, start and duration for a freshly added instance. */
MCP.components.placeInstance = function (comp, layer, spec, baseName) {
    var s = spec || {};
    layer.name = MCP.isDefined(s.name) ? String(s.name) : MCP.components.uniqueLayerName(comp, baseName, layer);
    if (MCP.isDefined(s.startTime) || MCP.isDefined(s.startFrame)) {
        layer.startTime = MCP.durationArg(comp, s, "startTime", "startFrame", 0);
    } else {
        layer.startTime = 0;
    }
    if (MCP.isDefined(s.duration) || MCP.isDefined(s.durationFrames)) {
        var d = MCP.durationArg(comp, s, "duration", "durationFrames", 0);
        if (d > 0) { layer.outPoint = layer.inPoint + d; }
    }
    if (MCP.isArray(s.position)) {
        var pos = layer.property("ADBE Transform Group").property("ADBE Position");
        var v = [Number(s.position[0]), Number(s.position[1])];
        var cur = pos.value;
        if (cur.length > 2) { v.push(s.position.length > 2 ? Number(s.position[2]) : cur[2]); }
        pos.setValue(v);
    }
    return layer;
};

/* -------------------------------------------------------------- commands */

MCP.register("createComponent", function (args) {
    MCP.components.requireApi();
    var comp = MCP.resolveComp(args.comp);
    var name = String(MCP.requireArg(args, "name"));
    var picked = MCP.resolveLayers(comp, MCP.isDefined(args.layers) ? args.layers : { selected: true });
    if (!picked.length) { MCP.fail("No layers to make into a component.", "invalid-argument"); }
    if (MCP.components.compNamed(name)) {
        MCP.fail("A composition named '" + name + "' already exists. Components are found by name, so pick another name.", "invalid-argument");
    }
    var seen = {}, list = [], i, L;
    for (i = 0; i < picked.length; i++) {
        if (!seen[picked[i].index]) { seen[picked[i].index] = true; list.push(picked[i]); }
    }
    list.sort(function (a, b) { return a.index - b.index; });
    var minIn = null, maxOut = null, sources = [];
    for (i = 0; i < list.length; i++) {
        L = list[i];
        if (L.locked) { MCP.fail("Layer " + L.index + " '" + L.name + "' is locked. Unlock it with set-layer-flags first.", "invalid-argument"); }
        if (minIn === null || L.inPoint < minIn) { minIn = L.inPoint; }
        if (maxOut === null || L.outPoint > maxOut) { maxOut = L.outPoint; }
        sources.push(MCP.serialize.layerRef(L));
    }
    // Check every property before anything changes.
    var specs = MCP.isArray(args.properties) ? args.properties : [];
    var plan = [], labels = {};
    for (i = 0; i < specs.length; i++) {
        var spec = specs[i] || {};
        var pos = MCP.components.selectionPosition(list, spec.layer);
        var prop = MCP.resolveProperty(list[pos], MCP.requireArg(spec, "path"));
        var problem = MCP.components.typeProblem(prop);
        if (problem) {
            MCP.fail("Property '" + MCP.pathOf(prop).path + "' on '" + list[pos].name + "' cannot be an Essential Property: " + problem + ". Supported: " + MCP.components.SUPPORTED + ".", "unsupported", { supported: MCP.components.SUPPORTED_LIST });
        }
        var label = MCP.isDefined(spec.label) ? String(spec.label) : String(prop.name);
        if (labels[label.toLowerCase()]) { MCP.fail("Label '" + label + "' is used twice. Give each property its own label.", "invalid-argument"); }
        labels[label.toLowerCase()] = true;
        plan.push({ pos: pos, idx: MCP.components.indexPath(prop), path: MCP.pathOf(prop).path, layerName: list[pos].name, label: label });
    }
    var indices = [];
    for (i = 0; i < list.length; i++) { indices.push(list[i].index); }
    var newComp;
    try { newComp = comp.layers.precompose(indices, name, true); } catch (e) {
        MCP.fail("precompose failed: " + e.message, "script-error");
    }
    var instance = MCP.components.layerWithSource(comp, newComp);
    if (!instance) { MCP.fail("Precomposed, but the instance layer could not be found in '" + comp.name + "'.", "script-error"); }
    var notes = [];
    // Time: start the component at 0 s and offset the instance.
    var shift = 0;
    if (MCP.bool(args.startAtZero, true) && minIn > 1e-6) {
        shift = MCP.snapToFrame(comp, minIn);
        for (i = 1; i <= newComp.numLayers; i++) { newComp.layer(i).startTime = newComp.layer(i).startTime - shift; }
    }
    var dur = MCP.isDefined(args.duration) ? Number(args.duration) : (newComp.duration - shift);
    dur = Math.max(newComp.frameDuration, dur);
    newComp.duration = dur;
    instance.startTime = shift;
    var inT = Math.max(minIn, shift);
    var outT = Math.min(maxOut, shift + dur);
    if (outT > inT) {
        instance.inPoint = inT;
        instance.outPoint = outT;
    }
    if (MCP.isDefined(args.duration) && shift + dur < maxOut - 1e-6) {
        notes.push("duration is shorter than the content; the instance now ends at " + MCP.round(shift + dur) + " s.");
    }
    // Space: size the component to its content.
    var crop = { applied: false, reason: "cropToContent is false" };
    if (MCP.bool(args.cropToContent, true)) {
        crop = MCP.components.cropToContent(newComp, instance, Math.max(0, MCP.num(args.padding, 0)));
    }
    // Essential Properties.
    var added = [], failed = [];
    for (i = 0; i < plan.length; i++) {
        var item = plan[i];
        var inner = item.pos < newComp.numLayers ? newComp.layer(item.pos + 1) : null;
        if (!inner || inner.name !== item.layerName) {
            inner = null;
            for (var j = 1; j <= newComp.numLayers; j++) {
                if (newComp.layer(j).name === item.layerName) { inner = newComp.layer(j); break; }
            }
        }
        var p2 = inner ? MCP.components.byIndexPath(inner, item.idx) : null;
        if (!p2) {
            failed.push({ label: item.label, layer: item.layerName, path: item.path, reason: "The property could not be found again inside the component." });
            continue;
        }
        var res = MCP.components.addProperty(p2, newComp, item.label);
        if (res.ok) { added.push({ label: item.label, layer: inner.name, path: MCP.pathOf(p2).path, valueType: MCP.serialize.valueTypeName(p2), index: res.index }); }
        else { failed.push({ label: item.label, layer: inner.name, path: item.path, reason: res.reason }); }
    }
    if (MCP.isDefined(args.templateName)) {
        try { newComp.motionGraphicsTemplateName = String(args.templateName); } catch (e3) { notes.push("Could not set templateName: " + e3.message); }
    }
    return {
        composition: MCP.serialize.compRef(comp),
        component: MCP.components.compInfo(newComp),
        instance: MCP.serialize.layer(instance),
        sourceLayers: sources,
        timeShift: MCP.round(shift),
        timeShiftFrames: MCP.frameOf(comp, shift),
        crop: crop,
        added: added,
        failed: failed,
        essentialProperties: MCP.components.controllerNames(newComp),
        values: MCP.components.describeInstance(instance),
        notes: notes
    };
}, { mutating: true });

MCP.register("addEssentialProperty", function (args) {
    MCP.components.requireApi();
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "path"));
    var label = MCP.isDefined(args.label) ? String(args.label) : String(prop.name);
    var names = MCP.components.controllerNames(r.comp);
    for (var i = 0; i < names.length; i++) {
        if (names[i].toLowerCase() === label.toLowerCase()) {
            MCP.fail("'" + r.comp.name + "' already has an Essential Property named '" + names[i] + "'. Pick another label. Existing: " + names.join(", "), "invalid-argument", { essentialProperties: names });
        }
    }
    var res = MCP.components.addProperty(prop, r.comp, label);
    if (!res.ok) {
        MCP.fail(res.reason, "unsupported", { valueType: MCP.serialize.valueTypeName(prop), supported: MCP.components.SUPPORTED_LIST });
    }
    return {
        composition: MCP.serialize.compRef(r.comp),
        layer: MCP.serialize.layerRef(r.layer),
        property: MCP.serialize.property(prop),
        label: label,
        index: res.index,
        essentialProperties: MCP.components.controllerNames(r.comp),
        instances: MCP.components.instancesOf(r.comp, 50)
    };
}, { mutating: true });

MCP.register("listEssentialProperties", function (args) {
    MCP.components.requireApi();
    var comp = MCP.resolveComp(args.comp);
    var component = comp, instance = null, sample = null;
    if (MCP.isDefined(args.layer)) {
        instance = MCP.resolveLayer(comp, args.layer);
        var src = _mcpTry(function () { return instance.source; }, null);
        if (!(src instanceof CompItem)) {
            MCP.fail("Layer '" + instance.name + "' is not a component instance (its source is not a composition). Pass the component comp without layer to list its controls.", "invalid-argument");
        }
        component = src;
    }
    var names = MCP.components.controllerNames(component);
    var controllers = [];
    for (var i = 0; i < names.length; i++) { controllers.push({ index: i + 1, name: names[i] }); }
    var out = {
        composition: MCP.serialize.compRef(comp),
        component: MCP.components.compInfo(component),
        count: names.length,
        controllers: controllers,
        notes: []
    };
    if (instance) {
        out.instance = MCP.serialize.layerRef(instance);
        out.properties = MCP.components.describeInstance(instance);
        return out;
    }
    var instances = MCP.components.instancesOf(component, 50);
    out.instances = instances;
    if (instances.length) {
        var holder = MCP.resolveComp({ id: instances[0].composition.id });
        sample = MCP.resolveLayer(holder, { id: instances[0].layer.id });
        var props = MCP.components.describeInstance(sample);
        for (var k = 0; k < props.length; k++) {
            if (props[k].source && props[k].source.kind === "property") { props[k].value = props[k].source.value; }
        }
        out.properties = props;
        out.notes.push("Types and sources read through instance '" + sample.name + "' in '" + holder.name + "'; values are the component's own.");
    } else {
        out.properties = [];
        for (var n = 0; n < names.length; n++) { out.properties.push({ label: names[n], path: names[n], valueType: null, value: null }); }
        if (names.length) { out.notes.push("No instance of '" + component.name + "' exists, so only the names are known. Place one with add-component-instances to read types and values."); }
    }
    return out;
}, { mutating: false });

MCP.register("setComponentValues", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var hasValues = !!(args.values && typeof args.values === "object" && MCP.keys(args.values).length);
    var hasKeys = MCP.isArray(args.keyframes) && args.keyframes.length > 0;
    if (!hasValues && !hasKeys) { MCP.fail("Pass values {label: value}, keyframes [{label, time, value}] or both.", "invalid-argument"); }
    var res = MCP.components.applyValues(r.comp, r.layer, args.values, args.keyframes, { colorHints: args.colorHints, keyColorHints: args.keyColorHints, replaceKeys: args.replaceKeys });
    return {
        composition: MCP.serialize.compRef(r.comp),
        layer: MCP.serialize.layerRef(r.layer),
        component: MCP.serialize.compRef(r.layer.source),
        count: res.results.length + res.keyframes.length,
        failed: res.failed,
        results: res.results,
        keyframes: res.keyframes,
        essentialProperties: MCP.components.describeInstance(r.layer)
    };
}, { mutating: true });

MCP.register("addComponentInstances", function (args) {
    var target = MCP.resolveComp(args.comp);
    var component = MCP.resolveComp(MCP.requireArg(args, "component"));
    if (component.id === target.id) { MCP.fail("Composition '" + target.name + "' cannot be placed inside itself.", "invalid-argument"); }
    var specs = MCP.isArray(args.instances) ? args.instances : null;
    if (!specs) {
        specs = [];
        var n = Math.max(1, Math.min(100, Math.round(MCP.num(args.count, 1))));
        for (var c = 0; c < n; c++) { specs.push({}); }
    }
    var results = [], failed = 0, prev = null, i;
    for (i = 0; i < specs.length; i++) {
        var spec = specs[i] || {};
        var layer;
        try { layer = target.layers.add(component); } catch (e) {
            MCP.fail("Could not add '" + component.name + "' to '" + target.name + "': " + e.message + (i ? " (" + i + " instances were added before this)" : ""), "script-error");
        }
        if (i === 0) {
            var unknownAll = [], leaves = MCP.components.overrideLeaves(MCP.components.overridesGroup(layer, false));
            for (var s = 0; s < specs.length; s++) {
                var u = MCP.components.unknownLabels(leaves, specs[s] ? specs[s].values : null, specs[s] ? specs[s].keyframes : null);
                for (var q = 0; q < u.length; q++) { if (unknownAll.indexOf(u[q]) < 0) { unknownAll.push(u[q]); } }
            }
            if (unknownAll.length) {
                var labels = MCP.components.labelsOf(leaves);
                layer.remove();
                MCP.fail("Unknown Essential Property label" + (unknownAll.length > 1 ? "s" : "") + " for '" + component.name + "': " + unknownAll.join(", ") + ". Labels: " + (labels.join(", ") || "(none)") + ". Nothing was added.", "not-found", { unknown: unknownAll, labels: labels });
            }
        }
        if (prev) { layer.moveAfter(prev); }
        MCP.components.placeInstance(target, layer, spec, component.name);
        prev = layer;
        try {
            var vals = MCP.components.applyValues(target, layer, spec.values, spec.keyframes, { colorHints: spec.colorHints, keyColorHints: spec.keyColorHints });
            if (vals.failed) { failed++; }
            results.push({ status: vals.failed ? "error" : "ok", index: i, layer: MCP.serialize.layer(layer), values: vals.results, keyframes: vals.keyframes });
        } catch (e2) {
            failed++;
            results.push({ status: "error", index: i, layer: MCP.serialize.layer(layer), message: e2.message, code: e2.mcpCode || "script-error" });
        }
    }
    return {
        composition: MCP.serialize.compRef(target),
        component: MCP.components.compInfo(component),
        count: results.length,
        failed: failed,
        results: results
    };
}, { mutating: true });

MCP.register("setResponsiveTime", function (args) {
    MCP.requireVersion(16.0, "Protected region markers (Responsive Design - Time)");
    var comp = MCP.resolveComp(args.comp);
    var fd = comp.frameDuration, dur = comp.duration;
    var intro = MCP.snapToFrame(comp, Math.max(0, MCP.durationArg(comp, args, "intro", "introFrames", 0)));
    var outro = MCP.snapToFrame(comp, Math.max(0, MCP.durationArg(comp, args, "outro", "outroFrames", 0)));
    var extra = MCP.isArray(args.regions) ? args.regions : [];
    if (intro <= 0 && outro <= 0 && !extra.length) { MCP.fail("Give intro, outro (seconds or frames) or regions.", "invalid-argument"); }
    if (intro + outro > dur + fd / 2) {
        MCP.fail("intro (" + MCP.round(intro) + " s) plus outro (" + MCP.round(outro) + " s) is longer than '" + comp.name + "' (" + MCP.round(dur) + " s).", "invalid-argument");
    }
    var planned = [], i;
    if (intro > 0) { planned.push({ start: 0, duration: intro, comment: MCP.isDefined(args.introComment) ? String(args.introComment) : "Intro", kind: "intro" }); }
    if (outro > 0) { planned.push({ start: MCP.snapToFrame(comp, dur - outro), duration: outro, comment: MCP.isDefined(args.outroComment) ? String(args.outroComment) : "Outro", kind: "outro" }); }
    for (i = 0; i < extra.length; i++) {
        var rg = extra[i] || {};
        var st = MCP.snapToFrame(comp, MCP.durationArg(comp, rg, "start", "startFrame", -1));
        var d = MCP.snapToFrame(comp, MCP.durationArg(comp, rg, "duration", "durationFrames", 0));
        if (st < 0 || d <= 0) { MCP.fail("regions[" + i + "] needs start or startFrame, and a duration above 0.", "invalid-argument"); }
        if (st + d > dur + fd / 2) { MCP.fail("regions[" + i + "] ends at " + MCP.round(st + d) + " s, after the end of '" + comp.name + "' (" + MCP.round(dur) + " s).", "invalid-argument"); }
        planned.push({ start: st, duration: d, comment: MCP.isDefined(rg.comment) ? String(rg.comment) : "Protected", kind: "region" });
    }
    var mp = comp.markerProperty;
    var replace = MCP.bool(args.replace, true);
    // A marker at the same time would be replaced: refuse unless it is a protected region we remove anyway.
    for (i = 0; i < planned.length; i++) {
        var at = MCP.easing.keyIndexAtTime(mp, planned[i].start, fd / 4);
        if (at > 0) {
            var existing = mp.keyValue(at);
            var isProtected = _mcpTry(function () { return existing.protectedRegion; }, false);
            if (!(isProtected && replace)) {
                MCP.fail("'" + comp.name + "' already has a marker at " + MCP.round(mp.keyTime(at)) + " s ('" + existing.comment + "'). Delete it with delete-marker or move it first.", "invalid-argument");
            }
        }
    }
    var removed = 0;
    if (replace) {
        for (i = mp.numKeys; i >= 1; i--) {
            var mv0 = mp.keyValue(i);
            if (_mcpTry(function () { return mv0.protectedRegion; }, false)) { mp.removeKey(i); removed++; }
        }
    }
    var notes = [];
    for (i = 0; i < planned.length; i++) {
        var mv = new MarkerValue(planned[i].comment);
        mv.duration = planned[i].duration;
        try { mv.protectedRegion = true; } catch (e) { MCP.fail("This version of After Effects cannot make protected-region markers: " + e.message, "unsupported"); }
        mp.setValueAtTime(planned[i].start, mv);
        var back = MCP.easing.keyIndexAtTime(mp, planned[i].start, fd / 4);
        if (back > 0 && !_mcpTry(function () { return mp.keyValue(back).protectedRegion; }, false)) {
            notes.push("The marker at " + MCP.round(planned[i].start) + " s did not keep Protected Region on.");
        }
    }
    var markers = [];
    for (i = 1; i <= mp.numKeys; i++) {
        var m = MCP.serialize.marker(mp.keyValue(i));
        m.index = i;
        m.time = MCP.round(mp.keyTime(i));
        m.frame = MCP.frameOf(comp, mp.keyTime(i));
        markers.push(m);
    }
    var instances = MCP.components.instancesOf(comp, 50);
    if (instances.length) { notes.push("Instances placed before this keep the old regions until Layer > Markers > Update Markers from Source is run on them."); }
    return {
        composition: MCP.serialize.compRef(comp),
        duration: MCP.round(dur),
        intro: MCP.round(intro),
        introFrames: MCP.frameOf(comp, intro),
        outro: MCP.round(outro),
        outroFrames: MCP.frameOf(comp, outro),
        stretchable: { start: MCP.round(intro), end: MCP.round(dur - outro), startFrame: MCP.frameOf(comp, intro), endFrame: MCP.frameOf(comp, dur - outro) },
        removedProtected: removed,
        markers: markers,
        instances: instances,
        notes: notes
    };
}, { mutating: true });

MCP.register("exportComponentTemplate", function (args) {
    MCP.requireVersion(15.0, "Motion Graphics template export");
    var comp = MCP.resolveComp(args.comp);
    var folderPath = String(MCP.requireArg(args, "folder"));
    var proj = app.project;
    if (!proj.file) {
        MCP.fail("The project has never been saved. After Effects asks to save before exporting a template, which would block the bridge. Save it first with save-project-as.", "invalid-argument");
    }
    var notes = [];
    if (MCP.isDefined(args.templateName)) {
        try { comp.motionGraphicsTemplateName = String(args.templateName); } catch (e0) { MCP.fail("Could not set the template name: " + e0.message, "script-error"); }
    }
    var name = _mcpTry(function () { return comp.motionGraphicsTemplateName; }, "") || comp.name;
    var folder = new Folder(folderPath);
    if (!folder.exists && !folder.create()) { MCP.fail("Cannot create folder " + folder.fsName, "io"); }
    var file = new File(folder.fsName + "/" + name + ".mogrt");
    var overwrite = MCP.bool(args.overwrite, false);
    if (file.exists && !overwrite) {
        MCP.fail("A template already exists at " + file.fsName + ". Pass overwrite: true to replace it, or choose another path or templateName.", "invalid-argument");
    }
    var dirty = _mcpTry(function () { return proj.dirty; }, true);
    var saved = false;
    if (dirty !== false) {
        if (!MCP.bool(args.saveProject, true)) {
            MCP.fail("The project has unsaved changes, and After Effects would ask to save them before exporting. Save it (save-project) or pass saveProject: true.", "invalid-argument");
        }
        try { proj.save(); saved = true; } catch (e1) { MCP.fail("Could not save the project before exporting: " + e1.message, "io"); }
    }
    var ok = false;
    try { ok = comp.exportAsMotionGraphicsTemplate(overwrite, folder.fsName); } catch (e2) {
        MCP.fail("Exporting '" + comp.name + "' as a Motion Graphics template failed: " + e2.message, "io");
    }
    var check = new File(file.fsName);
    var exists = check.exists;
    if (!ok && !exists) {
        MCP.fail("exportAsMotionGraphicsTemplate returned false for '" + comp.name + "' and no file appeared at " + check.fsName + ". Check that the folder is writable and the template name has no characters the file system refuses.", "io");
    }
    if (!ok) { notes.push("After Effects returned false, but the file exists."); }
    var count = _mcpTry(function () { return comp.motionGraphicsTemplateControllerCount; }, null);
    if (count === 0) { notes.push("The template has no Essential Properties, so editors cannot change anything in it."); }
    return {
        composition: MCP.serialize.compRef(comp),
        templateName: name,
        file: check.fsName,
        exists: exists,
        size: exists ? check.length : 0,
        overwrite: overwrite,
        projectSaved: saved,
        projectFile: proj.file ? proj.file.fsName : null,
        essentialPropertyCount: count,
        notes: notes
    };
}, { mutating: true });

/* ------------------------------------------------------------ library */

/** Comps inside a folder item, depth first. */
MCP.components.compsIn = function (folder, out, depth) {
    var list = out || [];
    if (depth > 12) { return list; }
    for (var i = 1; i <= folder.numItems; i++) {
        var it = folder.item(i);
        if (it instanceof CompItem) { list.push(it); }
        else if (it instanceof FolderItem) { MCP.components.compsIn(it, list, (depth || 0) + 1); }
    }
    return list;
};

MCP.components.pickComp = function (comps, name) {
    var i, lower = String(name).toLowerCase();
    for (i = 0; i < comps.length; i++) { if (comps[i].name === name) { return comps[i]; } }
    for (i = 0; i < comps.length; i++) { if (comps[i].name.toLowerCase() === lower) { return comps[i]; } }
    return null;
};

/** A copy of this .aep already imported into the project: {root, comp} or null. */
MCP.components.findImported = function (file, compName) {
    var tag = MCP.components.LIBRARY_TAG + file.fsName;
    var display = MCP.components.fileName(file);
    var fallback = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        var comment = _mcpTry(function () { return it.comment; }, "");
        if (comment === tag) {
            if (it instanceof CompItem) { return { root: it, comp: it }; }
            if (it instanceof FolderItem) {
                var c = MCP.components.pickComp(MCP.components.compsIn(it, [], 0), compName);
                if (c) { return { root: it, comp: c }; }
            }
        }
        if (!fallback && it instanceof FolderItem && it.name === display && _mcpTry(function () { return it.parentFolder.id === app.project.rootFolder.id; }, false)) {
            var c2 = MCP.components.pickComp(MCP.components.compsIn(it, [], 0), compName);
            if (c2) { fallback = { root: it, comp: c2 }; }
        }
    }
    if (fallback) { try { fallback.root.comment = tag; } catch (e) {} }
    return fallback;
};

MCP.register("insertLibraryComponent", function (args) {
    var target = MCP.resolveComp(args.comp);
    var file = new File(String(MCP.requireArg(args, "aepPath")));
    if (!file.exists) { MCP.fail("Component file not found: " + file.fsName, "not-found"); }
    var compName = String(MCP.arg(args, "compName", MCP.arg(args, "componentName", MCP.components.fileName(file).replace(/\.aep$/i, ""))));
    var found = MCP.bool(args.reuseImported, true) ? MCP.components.findImported(file, compName) : null;
    var imported = false, root = null, main = null, notes = [];
    if (found) {
        root = found.root;
        main = found.comp;
    } else {
        var before = {}, i;
        for (i = 1; i <= app.project.numItems; i++) { before[app.project.item(i).id] = true; }
        var io;
        try { io = new ImportOptions(file); } catch (e1) { MCP.fail("After Effects cannot import '" + file.fsName + "': " + e1.message, "unsupported"); }
        try { if (io.canImportAs(ImportAsType.PROJECT)) { io.importAs = ImportAsType.PROJECT; } } catch (e2) {}
        var item;
        try { item = app.project.importFile(io); } catch (e3) { MCP.fail("Import of '" + file.fsName + "' failed: " + e3.message, "io"); }
        imported = true;
        var fresh = [];
        for (i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (!before[it.id] && it instanceof CompItem) { fresh.push(it); }
        }
        main = MCP.components.pickComp(fresh, compName);
        root = (item instanceof FolderItem) ? item : main;
        if (root) { try { root.comment = MCP.components.LIBRARY_TAG + file.fsName; } catch (e4) {} }
        if (!main) {
            var names = [];
            for (i = 0; i < fresh.length && i < 40; i++) { names.push("'" + fresh[i].name + "'"); }
            MCP.fail("Imported '" + MCP.components.fileName(file) + "', but it has no composition named '" + compName + "'. Its compositions: " + (names.join(", ") || "(none)") + ". Set \"comp\" in component.json or pass compName. The import stays in the project.", "not-found", { compositions: names });
        }
    }
    if (main.id === target.id) { MCP.fail("The component '" + main.name + "' cannot be placed inside itself.", "invalid-argument"); }
    var layer;
    try { layer = target.layers.add(main); } catch (e5) { MCP.fail("Could not add '" + main.name + "' to '" + target.name + "': " + e5.message, "script-error"); }
    var leaves = MCP.components.overrideLeaves(MCP.components.overridesGroup(layer, false));
    var unknown = MCP.components.unknownLabels(leaves, args.values, args.keyframes);
    if (unknown.length) {
        layer.remove();
        MCP.components.failUnknown({ name: main.name }, unknown, leaves);
    }
    MCP.components.placeInstance(target, layer, args, main.name);
    var vals = MCP.components.applyValues(target, layer, args.values, args.keyframes, { colorHints: args.colorHints, keyColorHints: args.keyColorHints });
    var sameName = MCP.components.compNamed(main.name);
    if (sameName && sameName.id !== main.id) { notes.push("Another composition is also named '" + main.name + "'; refer to the component by id."); }
    return {
        composition: MCP.serialize.compRef(target),
        component: MCP.components.compInfo(main),
        library: {
            aep: file.fsName,
            componentName: MCP.arg(args, "componentName", null),
            imported: imported,
            reused: !imported,
            folder: root ? { id: root.id, name: root.name, type: MCP.itemType(root) } : null
        },
        instance: MCP.serialize.layer(layer),
        failed: vals.failed,
        values: vals.results,
        keyframes: vals.keyframes,
        essentialProperties: MCP.components.describeInstance(layer),
        notes: notes
    };
}, { mutating: true });
