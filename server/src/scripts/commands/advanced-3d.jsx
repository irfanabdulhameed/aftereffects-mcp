/*
 * Advanced 3D commands: the composition's 3D renderer, Geometry Options
 * (extrusion and bevels) on text and shape layers, and environment lights.
 *
 * Renderer match names: "ADBE Advanced 3d" is Classic 3D (despite the name),
 * "ADBE Calder" is Advanced 3D, "ADBE Ernst" is Cinema 4D. Compare them
 * exactly; a pattern such as /Advanced/ also matches Classic 3D.
 */

MCP.adv3d = {};

MCP.adv3d.CLASSIC = "ADBE Advanced 3d";
MCP.adv3d.ADVANCED = "ADBE Calder";
MCP.adv3d.CINEMA = "ADBE Ernst";
MCP.adv3d.NAMES = { "ADBE Advanced 3d": "Classic 3D", "ADBE Calder": "Advanced 3D", "ADBE Ernst": "Cinema 4D" };
MCP.adv3d.KEYS = { "ADBE Advanced 3d": "classic-3d", "ADBE Calder": "advanced-3d", "ADBE Ernst": "cinema-4d" };

/** Arrival easing for geometry keys: speed 0, long influence arriving, short leaving. */
MCP.adv3d.DEFAULT_EASE = { type: "custom", inSpeed: 0, inInfluence: 100, outSpeed: 0, outInfluence: 25 };

MCP.adv3d.BEVEL_STYLES = ["none", "angular", "concave", "convex"];

MCP.adv3d.GEOMETRY = [
    { arg: "extrusionDepth", match: "ADBE Extrsn Depth", name: "Extrusion Depth" },
    { arg: "bevelDepth", match: "ADBE Bevel Depth", name: "Bevel Depth" },
    { arg: "holeBevelDepth", match: "ADBE Hole Bevel Depth", name: "Hole Bevel Depth" }
];

MCP.adv3d.rendererInfo = function (matchName) {
    var mn = String(matchName);
    return { matchName: mn, name: MCP.adv3d.NAMES[mn] || mn, key: MCP.adv3d.KEYS[mn] || null };
};

MCP.adv3d.available = function (comp) {
    var out = [];
    var list = _mcpTry(function () { return comp.renderers; }, null) || [];
    for (var i = 0; i < list.length; i++) { out.push(MCP.adv3d.rendererInfo(list[i])); }
    return out;
};

MCP.adv3d.hasRenderer = function (comp, matchName) {
    var list = MCP.adv3d.available(comp);
    for (var i = 0; i < list.length; i++) { if (list[i].matchName === matchName) { return true; } }
    return false;
};

MCP.adv3d.describe = function (list) {
    var out = [];
    for (var i = 0; i < list.length; i++) { out.push(list[i].name + " (" + list[i].matchName + ")"); }
    return out.join(", ") || "(none)";
};

/** Layers with an enabled layer style (they do not render in Advanced 3D or Cinema 4D). */
MCP.adv3d.layersWithStyles = function (comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        var g = _mcpTry(function () { return L.property("ADBE Layer Styles"); }, null);
        if (!g || !_mcpTry(function () { return g.enabled; }, false)) { continue; }
        var n = _mcpTry(function () { return g.numProperties; }, 0);
        var on = false;
        for (var k = 1; k <= n && !on; k++) {
            var st = g.property(k);
            var mn = String(_mcpTry(function () { return st.matchName; }, ""));
            if (mn === "ADBE Blend Options Group") { continue; }
            if (_mcpTry(function () { return st.enabled; }, false)) { on = true; }
        }
        if (on) { out.push(MCP.serialize.layerRef(L)); }
    }
    return out;
};

/** 3D text and shape layers with an Extrusion Depth above 0 (Classic 3D draws them flat). */
MCP.adv3d.extrudedLayers = function (comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (!(L instanceof TextLayer || L instanceof ShapeLayer)) { continue; }
        if (!_mcpTry(function () { return L.threeDLayer; }, false)) { continue; }
        var d = _mcpTry(function () { return L.property("ADBE Extrsn Options Group").property("ADBE Extrsn Depth").value; }, 0);
        if (Number(d) > 0) { out.push(MCP.serialize.layerRef(L)); }
    }
    return out;
};

MCP.adv3d.selectOnly = function (comp, layer) {
    for (var i = 1; i <= comp.numLayers; i++) { try { comp.layer(i).selected = false; } catch (e) {} }
    layer.selected = true;
};

MCP.adv3d.selection = function (comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) { if (_mcpTry(function () { return comp.layer(i).selected; }, false)) { out.push(comp.layer(i)); } }
    return out;
};

MCP.adv3d.restore = function (comp, layers) {
    for (var i = 1; i <= comp.numLayers; i++) { try { comp.layer(i).selected = false; } catch (e) {} }
    for (var k = 0; k < layers.length; k++) { try { layers[k].selected = true; } catch (e2) {} }
};

MCP.adv3d.layerIds = function (comp) {
    var ids = {};
    for (var i = 1; i <= comp.numLayers; i++) { ids[_mcpTry(function () { return comp.layer(i).id; }, "i" + i)] = true; }
    return ids;
};

/* --------------------------------------------------------------- renderer */

MCP.register("setCompositionRenderer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var previous = MCP.adv3d.rendererInfo(comp.renderer);
    var available = MCP.adv3d.available(comp);
    var want = MCP.isDefined(args.rendererMatchName) ? String(args.rendererMatchName) : (MCP.isDefined(args.matchName) ? String(args.matchName) : null);
    var warnings = [];
    if (!want) {
        return { composition: MCP.serialize.compRef(comp), previous: previous, renderer: previous, changed: false, listOnly: true, available: available, warnings: warnings };
    }
    if (!MCP.adv3d.hasRenderer(comp, want)) {
        MCP.fail("Renderer '" + (MCP.adv3d.NAMES[want] || want) + "' (" + want + ") is not available in After Effects " + app.version + ". Available: " + MCP.adv3d.describe(available) + ".", "unsupported", { available: available });
    }
    var changed = false;
    if (String(comp.renderer) !== want) {
        try { comp.renderer = want; } catch (e) { MCP.fail("Could not set the renderer to " + want + ": " + e.toString(), "script-error"); }
        if (String(comp.renderer) !== want) { MCP.fail("After Effects kept the renderer " + comp.renderer + " instead of " + want + ".", "script-error"); }
        changed = true;
    }
    if (want !== MCP.adv3d.CLASSIC) {
        var styled = MCP.adv3d.layersWithStyles(comp);
        if (styled.length) { warnings.push(styled.length + " layers have layer styles, which do not render in " + MCP.adv3d.NAMES[want] + ": " + MCP.adv3d.layerNames(styled) + ". Precompose them, or keep this comp in Classic 3D."); }
    } else {
        var extruded = MCP.adv3d.extrudedLayers(comp);
        if (extruded.length) { warnings.push(extruded.length + " layers are extruded, which Classic 3D draws flat: " + MCP.adv3d.layerNames(extruded) + "."); }
    }
    return { composition: MCP.serialize.compRef(comp), previous: previous, renderer: MCP.adv3d.rendererInfo(comp.renderer), changed: changed, listOnly: false, available: available, warnings: warnings };
}, { mutating: true });

MCP.adv3d.layerNames = function (refs) {
    var out = [];
    for (var i = 0; i < refs.length && i < 8; i++) { out.push("'" + refs[i].name + "'"); }
    return out.join(", ") + (refs.length > 8 ? ", ..." : "");
};

/* -------------------------------------------------------------- extrusion */

MCP.adv3d.bevelValue = function (name) {
    var i = MCP.adv3d.BEVEL_STYLES.indexOf(String(name).toLowerCase());
    if (i === -1) { MCP.fail("Unknown bevelStyle '" + name + "'. Use none, angular, concave or convex.", "invalid-argument"); }
    return i + 1;
};

MCP.adv3d.geometryValues = function (g) {
    var out = {};
    for (var i = 0; i < MCP.adv3d.GEOMETRY.length; i++) {
        var spec = MCP.adv3d.GEOMETRY[i];
        var p = _mcpTry(function () { return g.property(spec.match); }, null);
        out[spec.arg] = p ? MCP.roundValue(_mcpTry(function () { return p.value; }, null)) : null;
    }
    var bs = _mcpTry(function () { return g.property("ADBE Bevel Styles"); }, null);
    var bv = bs ? _mcpTry(function () { return bs.value; }, null) : null;
    out.bevelStyle = typeof bv === "number" ? (MCP.adv3d.BEVEL_STYLES[bv - 1] || bv) : null;
    return out;
};

MCP.register("setExtrusion", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var rend = String(comp.renderer);
    if (rend !== MCP.adv3d.ADVANCED && rend !== MCP.adv3d.CINEMA) {
        MCP.fail("Composition '" + comp.name + "' uses the " + (MCP.adv3d.NAMES[rend] || rend) + " renderer, which cannot extrude. Run set-composition-renderer with advanced-3d (or cinema-4d) first.", "unsupported", { renderer: MCP.adv3d.rendererInfo(rend) });
    }
    if (!(layer instanceof TextLayer || layer instanceof ShapeLayer)) {
        MCP.fail("Layer '" + layer.name + "' is a " + MCP.layerType(layer) + " layer. Only text and shape layers extrude; footage and solids have Curvature and Segments under Geometry Options instead.", "invalid-argument");
    }
    var applied = [], notes = [], keyframes = [];
    if (!layer.threeDLayer) {
        if (!MCP.bool(args.make3d, true)) { MCP.fail("Layer '" + layer.name + "' is 2D. Turn its 3D switch on (or pass make3d true) to extrude it.", "invalid-argument"); }
        layer.threeDLayer = true;
        applied.push({ arg: "make3d", value: true });
    }
    var g = _mcpTry(function () { return layer.property("ADBE Extrsn Options Group"); }, null);
    if (!g) { MCP.fail("Layer '" + layer.name + "' has no Geometry Options (ADBE Extrsn Options Group) in this renderer or version.", "unsupported"); }
    var i, p;
    if (MCP.isDefined(args.bevelStyle)) {
        var bvProp = _mcpTry(function () { return g.property("ADBE Bevel Styles"); }, null);
        if (!bvProp) { notes.push("Bevel Style (ADBE Bevel Styles) is not available in this renderer; skipped."); }
        else {
            try { bvProp.setValue(MCP.adv3d.bevelValue(args.bevelStyle)); applied.push({ arg: "bevelStyle", property: MCP.pathOf(bvProp).path, value: String(args.bevelStyle) }); }
            catch (e0) { notes.push("Could not set Bevel Style: " + e0.toString()); }
        }
    }
    for (i = 0; i < MCP.adv3d.GEOMETRY.length; i++) {
        var spec = MCP.adv3d.GEOMETRY[i];
        if (!MCP.isDefined(args[spec.arg])) { continue; }
        p = _mcpTry(function () { return g.property(spec.match); }, null);
        if (!p) { notes.push(spec.name + " (" + spec.match + ") is not available in this renderer; skipped."); continue; }
        try {
            var value = Number(args[spec.arg]);
            var keyIndex = null;
            if (p.numKeys > 0) { keyIndex = MCP.easing.setKey(p, comp.time, value); }
            else { p.setValue(value); }
            applied.push({ arg: spec.arg, property: MCP.pathOf(p).path, value: value, keyIndex: keyIndex });
        } catch (e1) { notes.push("Could not set " + spec.name + " (hidden in this renderer?): " + e1.toString()); }
    }
    if (MCP.isArray(args.keyframes) && args.keyframes.length) {
        var keys = args.keyframes.slice(0);
        keys.sort(function (a, b) { return MCP.timeArg(comp, a, 0) - MCP.timeArg(comp, b, 0); });
        var written = {};
        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var t = MCP.timeArg(comp, key, comp.time);
            for (i = 0; i < MCP.adv3d.GEOMETRY.length; i++) {
                var gs = MCP.adv3d.GEOMETRY[i];
                if (!MCP.isDefined(key[gs.arg])) { continue; }
                var kp = _mcpTry(function () { return g.property(gs.match); }, null);
                if (!kp) { notes.push(gs.name + " is not available in this renderer; its keys were skipped."); continue; }
                try {
                    var ki = MCP.easing.setKey(kp, t, Number(key[gs.arg]));
                    MCP.easing.applySegment(kp, ki, MCP.isDefined(key.easing) ? key.easing : MCP.adv3d.DEFAULT_EASE);
                    if (!written[gs.arg]) { written[gs.arg] = { match: gs.match, property: MCP.pathOf(kp).path, times: [] }; }
                    written[gs.arg].times.push(t);
                } catch (e2) { notes.push("Could not key " + gs.name + " at " + MCP.round(t) + " s: " + e2.toString()); }
            }
        }
        for (var w in written) {
            if (!Object.prototype.hasOwnProperty.call(written, w)) { continue; }
            var wp = g.property(written[w].match);
            var list = [];
            for (var q = 0; q < written[w].times.length; q++) {
                var idx = MCP.easing.keyIndexAtTime(wp, written[w].times[q], 1e-3);
                if (idx > 0) { list.push(MCP.serialize.keyframe(wp, idx)); }
            }
            keyframes.push({ arg: w, property: written[w].property, keys: list });
        }
    }
    var paths = {};
    for (i = 0; i < MCP.adv3d.GEOMETRY.length; i++) {
        p = _mcpTry(function () { return g.property(MCP.adv3d.GEOMETRY[i].match); }, null);
        paths[MCP.adv3d.GEOMETRY[i].arg] = p ? MCP.pathOf(p).path : null;
    }
    var bsp = _mcpTry(function () { return g.property("ADBE Bevel Styles"); }, null);
    paths.bevelStyle = bsp ? MCP.pathOf(bsp).path : null;
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layerRef(layer),
        threeD: !!layer.threeDLayer,
        renderer: MCP.adv3d.rendererInfo(rend),
        geometryOptions: MCP.adv3d.geometryValues(g),
        paths: paths,
        applied: applied,
        keyframes: keyframes,
        notes: notes
    };
}, { mutating: true });

/* ------------------------------------------------------- environment light */

MCP.adv3d.ENV_BG_MENU = "Create Environment Light Background Layer";

MCP.adv3d.importSource = function (path) {
    var file = new File(String(path));
    if (!file.exists) { MCP.fail("Source file not found: " + file.fsName, "not-found"); }
    try { return app.project.importFile(new ImportOptions(file)); }
    catch (e) { MCP.fail("Could not import " + file.fsName + ": " + e.toString(), "io"); }
    return null;
};

MCP.adv3d.isHdrSource = function (layer) {
    var src = _mcpTry(function () { return layer.source; }, null);
    var f = src ? _mcpTry(function () { return src.file; }, null) : null;
    return !!(f && /\.(hdr|exr)$/i.test(String(f.name)));
};

/** Builds a background layer: the menu command when it exists, else a comp-size solid with CC Environment. */
MCP.adv3d.backgroundLayer = function (comp, light, source, name, notes) {
    var id = 0;
    try { id = app.findMenuCommandId(MCP.adv3d.ENV_BG_MENU); } catch (e0) { id = 0; }
    if (id) {
        var before = MCP.adv3d.layerIds(comp);
        var sel = MCP.adv3d.selection(comp);
        var made = null;
        try {
            try { comp.openInViewer(); } catch (e1) {}
            MCP.adv3d.selectOnly(comp, light);
            app.executeCommand(id);
            for (var i = 1; i <= comp.numLayers && !made; i++) {
                var L = comp.layer(i);
                if (!before[_mcpTry(function () { return L.id; }, "x")]) { made = L; }
            }
        } catch (e2) {
            notes.push("'" + MCP.adv3d.ENV_BG_MENU + "' failed: " + e2.toString());
        } finally {
            MCP.adv3d.restore(comp, sel);
        }
        if (made) { return { layer: made, route: "menu" }; }
        notes.push("'" + MCP.adv3d.ENV_BG_MENU + "' made no layer; built the background with CC Environment instead.");
    }
    var bg = comp.layers.addSolid([0, 0, 0], name + " Background", comp.width, comp.height, comp.pixelAspect, comp.duration);
    bg.moveToEnd();
    var fx = bg.property("ADBE Effect Parade").addProperty("CC Environment");
    if (!fx) { MCP.fail("CC Environment could not be added for the background.", "unsupported"); }
    fx = bg.property("ADBE Effect Parade").property(1);
    try { fx.property("CC Environment-0001").setValue(source.index); } catch (e3) { notes.push("Could not point CC Environment at the source layer: " + e3.toString()); }
    try { fx.property("CC Environment-0004").setValue(1); } catch (e4) {}
    return { layer: bg, route: "cc-environment" };
};

MCP.register("addEnvironmentLight", function (args) {
    var comp = MCP.resolveComp(args.comp);
    MCP.requireVersion(24.3, "The Environment light type");
    var envType = _mcpTry(function () { return LightType.ENVIRONMENT; }, undefined);
    if (envType === undefined || envType === null) { MCP.fail("LightType.ENVIRONMENT is not available in After Effects " + app.version + ".", "unsupported"); }
    var notes = [];
    var rend = String(comp.renderer);
    if (rend !== MCP.adv3d.ADVANCED) {
        if (!MCP.bool(args.switchRenderer, false)) {
            MCP.fail("Composition '" + comp.name + "' uses the " + (MCP.adv3d.NAMES[rend] || rend) + " renderer; environment lights need Advanced 3D. Run set-composition-renderer with advanced-3d, or pass switchRenderer true.", "unsupported", { renderer: MCP.adv3d.rendererInfo(rend) });
        }
        if (!MCP.adv3d.hasRenderer(comp, MCP.adv3d.ADVANCED)) { MCP.fail("Advanced 3D is not available. Available: " + MCP.adv3d.describe(MCP.adv3d.available(comp)) + ".", "unsupported"); }
        comp.renderer = MCP.adv3d.ADVANCED;
        notes.push("Renderer switched from " + (MCP.adv3d.NAMES[rend] || rend) + " to Advanced 3D.");
    }
    // Source layer.
    var src = null, srcCreated = false;
    if (MCP.isDefined(args.source)) {
        src = MCP.resolveLayer(comp, args.source);
    } else if (MCP.isDefined(args.sourceItem) || MCP.isDefined(args.sourceFile)) {
        var item = MCP.isDefined(args.sourceItem) ? MCP.resolveItem(args.sourceItem) : MCP.adv3d.importSource(args.sourceFile);
        if (item instanceof FolderItem) { MCP.fail("'" + item.name + "' is a folder; give a footage item or a composition.", "invalid-argument"); }
        src = comp.layers.add(item);
        srcCreated = true;
        src.moveToEnd();
    }
    if (src) {
        if (src instanceof CameraLayer || src instanceof LightLayer) { MCP.fail("Layer '" + src.name + "' is a " + MCP.layerType(src) + "; the source must be a 2D image, video or comp layer.", "invalid-argument"); }
        if (_mcpTry(function () { return src.threeDLayer; }, false)) {
            if (srcCreated) { src.threeDLayer = false; }
            else { MCP.fail("Layer '" + src.name + "' is 3D. Environment light sources must be 2D layers: turn its 3D switch off (set-layer-3d) or pass a different layer.", "invalid-argument"); }
        }
        if (MCP.aeVersion() < 25.2 && !MCP.adv3d.isHdrSource(src)) {
            if (srcCreated) { try { src.remove(); } catch (e0) {} }
            MCP.fail("Before After Effects 25.2 an environment light source must be an .hdr or .exr file; '" + src.name + "' is not.", "unsupported");
        }
    } else {
        notes.push("No source given: the environment light has no image and lights the scene like an even sky.");
    }
    var name = String(MCP.arg(args, "name", "Environment Light"));
    var light = comp.layers.addLight(name, [comp.width / 2, comp.height / 2]);
    // Rotation and shadows are hidden on environment lights: set them while the light is a spot light.
    try { light.lightType = LightType.SPOT; } catch (e1) {}
    var tg = light.property("ADBE Transform Group");
    var rotation = null;
    if (MCP.isDefined(args.rotation)) {
        rotation = MCP.isArray(args.rotation) ? [Number(args.rotation[0]), Number(args.rotation[1]), Number(args.rotation[2])] : [0, Number(args.rotation), 0];
        var axes = ["ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"];
        for (var a = 0; a < 3; a++) {
            if (rotation[a] === 0 && !MCP.isArray(args.rotation)) { continue; }
            try { tg.property(axes[a]).setValue(rotation[a]); } catch (e2) { notes.push("Could not set " + axes[a] + ": " + e2.toString()); }
        }
    }
    var lo = light.property("ADBE Light Options Group");
    if (MCP.isDefined(args.castsShadows)) {
        try { lo.property("ADBE Casts Shadows").setValue(MCP.bool(args.castsShadows, false) ? 1 : 0); } catch (e3) { notes.push("Could not set Casts Shadows: " + e3.toString()); }
    }
    if (MCP.isDefined(args.shadowDarkness)) {
        try { lo.property("ADBE Light Shadow Darkness").setValue(Number(args.shadowDarkness)); } catch (e4) { notes.push("Could not set Shadow Darkness: " + e4.toString()); }
    }
    try { light.lightType = envType; }
    catch (e5) {
        try { light.remove(); } catch (e6) {}
        if (srcCreated) { try { src.remove(); } catch (e7) {} }
        MCP.fail("After Effects refused the Environment light type: " + e5.toString(), "unsupported");
    }
    lo = light.property("ADBE Light Options Group");
    var intensity = MCP.num(args.intensity, 100);
    try { lo.property("ADBE Light Intensity").setValue(intensity); } catch (e8) { notes.push("Could not set Intensity: " + e8.toString()); }
    var sourceApplied = false;
    if (src) {
        try { light.lightSource = src; } catch (e9) {
            try { light.remove(); } catch (e10) {}
            if (srcCreated) { try { src.remove(); } catch (e11) {} }
            MCP.fail("Could not set the light source to '" + src.name + "': " + e9.toString(), "unsupported");
        }
        var back = _mcpTry(function () { return light.lightSource; }, null);
        sourceApplied = !!(back && _mcpTry(function () { return back.index === src.index; }, false));
        if (!sourceApplied) { notes.push("light.lightSource did not read back as '" + src.name + "'; check the Source menu under Light Options."); }
        if (MCP.bool(args.hideSource, true)) { try { src.enabled = false; } catch (e12) {} }
    }
    var background = null;
    if (MCP.bool(args.useAsBackground, false)) {
        if (!src) { notes.push("useAsBackground needs a source image; no background was made."); }
        else {
            var bg = MCP.adv3d.backgroundLayer(comp, light, src, name, notes);
            background = { layer: MCP.serialize.layerRef(bg.layer), route: bg.route };
        }
    }
    var options = _mcpTry(function () { return MCP.cam.readTable(light.property("ADBE Light Options Group"), MCP.cam.LIGHT_PROPS); }, {});
    var rot = {
        x: MCP.round(_mcpTry(function () { return tg.property("ADBE Rotate X").value; }, 0)),
        y: MCP.round(_mcpTry(function () { return light.property("ADBE Transform Group").property("ADBE Rotate Y").value; }, 0)),
        z: MCP.round(_mcpTry(function () { return light.property("ADBE Transform Group").property("ADBE Rotate Z").value; }, 0))
    };
    return {
        composition: MCP.serialize.compRef(comp),
        renderer: MCP.adv3d.rendererInfo(comp.renderer),
        light: MCP.serialize.layerRef(light),
        lightType: _mcpTry(function () { return light.lightType === envType; }, false) ? "environment" : String(_mcpTry(function () { return light.lightType; }, "")),
        intensity: MCP.round(_mcpTry(function () { return light.property("ADBE Light Options Group").property("ADBE Light Intensity").value; }, intensity)),
        rotation: rot,
        lightOptions: options,
        source: src ? { layer: MCP.serialize.layerRef(src), created: srcCreated, enabled: _mcpTry(function () { return src.enabled; }, null), type: MCP.layerType(src), hdr: MCP.adv3d.isHdrSource(src) } : null,
        sourceApplied: sourceApplied,
        background: background,
        notes: notes
    };
}, { mutating: true });
