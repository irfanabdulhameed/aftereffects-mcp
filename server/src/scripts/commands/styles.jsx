/*
 * Layer style commands: turn styles on, set and key their settings, switch
 * them off, and list them.
 *
 * Styles live under "ADBE Layer Styles" as groups named "<prefix>/enabled"
 * with settings "<prefix>/<name>" (for example "dropShadow/opacity"). A style
 * that was never added to a layer is a hidden group: canSetEnabled is false
 * and addProperty cannot create it. Such a style is first tried through its
 * enabled flag, and when After Effects refuses, it is added with the Layer >
 * Layer Styles menu command (fixed ids 9000 to 9008; the names are ambiguous
 * because the Effect menu has items with the same names). That needs the comp
 * in the viewer and the layer selected; both are restored afterwards.
 *
 * Layer-style gradient colours are custom values that scripts can neither read
 * nor write, so gradient-overlay colours are drawn by a Gradient Ramp effect.
 */

MCP.styles = {};

MCP.styles.ROOT = "ADBE Layer Styles";
MCP.styles.RAMP_NAME = "Gradient Overlay Colors";
MCP.styles.CLASSIC_RENDERER = "ADBE Advanced 3d";
/** Arrival easing for style keys: speed 0, long influence arriving, shorter leaving. */
MCP.styles.DEFAULT_EASE = { type: "custom", inSpeed: 0, inInfluence: 80, outSpeed: 0, outInfluence: 30 };

MCP.styles.KINDS = {
    "drop-shadow": { prefix: "dropShadow", menuId: 9000, label: "Drop Shadow" },
    "inner-shadow": { prefix: "innerShadow", menuId: 9001, label: "Inner Shadow" },
    "outer-glow": { prefix: "outerGlow", menuId: 9002, label: "Outer Glow" },
    "inner-glow": { prefix: "innerGlow", menuId: 9003, label: "Inner Glow" },
    "bevel-emboss": { prefix: "bevelEmboss", menuId: 9004, label: "Bevel and Emboss" },
    "satin": { prefix: "chromeFX", menuId: 9005, label: "Satin" },
    "color-overlay": { prefix: "solidFill", menuId: 9006, label: "Color Overlay" },
    "gradient-overlay": { prefix: "gradientFill", menuId: 9007, label: "Gradient Overlay" },
    "stroke": { prefix: "frameFX", menuId: 9008, label: "Stroke" }
};

MCP.styles.ORDER = ["drop-shadow", "inner-shadow", "outer-glow", "inner-glow", "bevel-emboss", "satin", "color-overlay", "gradient-overlay", "stroke"];

/**
 * Friendly setting name -> {type, suffix, table}. byKind overrides the suffix
 * (and tableByKind the enum table) for kinds that name it differently.
 */
MCP.styles.SETTINGS = {
    color: { type: "color", suffix: "color" },
    opacity: { type: "number", suffix: "opacity" },
    blendMode: { type: "enum", suffix: "mode2", table: "blend" },
    angle: { type: "number", suffix: "localLightingAngle", byKind: { "gradient-overlay": "angle" } },
    useGlobalLight: { type: "bool", suffix: "useGlobalAngle" },
    distance: { type: "number", suffix: "distance" },
    spread: { type: "number", suffix: "chokeMatte" },
    size: { type: "number", suffix: "blur", byKind: { "stroke": "size" } },
    noise: { type: "number", suffix: "noise" },
    layerKnocksOut: { type: "bool", suffix: "layerConceals" },
    technique: { type: "enum", suffix: "glowTechnique", table: "glowTechnique", byKind: { "bevel-emboss": "bevelTechnique" }, tableByKind: { "bevel-emboss": "bevelTechnique" } },
    range: { type: "number", suffix: "inputRange" },
    jitter: { type: "number", suffix: "shadingNoise" },
    source: { type: "enum", suffix: "innerGlowSource", table: "source" },
    bevelStyle: { type: "enum", suffix: "bevelStyle", table: "bevelStyle" },
    depth: { type: "number", suffix: "strengthRatio" },
    direction: { type: "enum", suffix: "bevelDirection", table: "direction" },
    soften: { type: "number", suffix: "softness" },
    altitude: { type: "number", suffix: "localLightingAltitude" },
    highlightMode: { type: "enum", suffix: "highlightMode", table: "blend" },
    highlightColor: { type: "color", suffix: "highlightColor" },
    highlightOpacity: { type: "number", suffix: "highlightOpacity" },
    shadowMode: { type: "enum", suffix: "shadowMode", table: "blend" },
    shadowColor: { type: "color", suffix: "shadowColor" },
    shadowOpacity: { type: "number", suffix: "shadowOpacity" },
    invert: { type: "bool", suffix: "invert" },
    colors: { type: "gradient", suffix: "gradient" },
    gradientStyle: { type: "enum", suffix: "type", table: "gradientStyle" },
    reverse: { type: "bool", suffix: "reverse" },
    alignWithLayer: { type: "bool", suffix: "align" },
    scale: { type: "number", suffix: "scale" },
    offset: { type: "point", suffix: "offset" },
    smoothness: { type: "number", suffix: "gradientSmoothness" },
    position: { type: "enum", suffix: "style", table: "strokePosition" }
};

MCP.styles.BY_KIND = {
    "drop-shadow": ["useGlobalLight", "color", "opacity", "blendMode", "angle", "distance", "spread", "size", "noise", "layerKnocksOut"],
    "inner-shadow": ["useGlobalLight", "color", "opacity", "blendMode", "angle", "distance", "spread", "size", "noise"],
    "outer-glow": ["color", "opacity", "blendMode", "noise", "spread", "size", "technique", "range", "jitter"],
    "inner-glow": ["color", "opacity", "blendMode", "noise", "spread", "size", "technique", "range", "jitter", "source"],
    "bevel-emboss": ["useGlobalLight", "bevelStyle", "technique", "depth", "direction", "size", "soften", "angle", "altitude", "highlightMode", "highlightColor", "highlightOpacity", "shadowMode", "shadowColor", "shadowOpacity"],
    "satin": ["color", "opacity", "blendMode", "angle", "distance", "size", "invert"],
    "color-overlay": ["color", "opacity", "blendMode"],
    "gradient-overlay": ["colors", "opacity", "blendMode", "angle", "gradientStyle", "reverse", "alignWithLayer", "scale", "offset", "smoothness"],
    "stroke": ["color", "size", "opacity", "blendMode", "position"]
};

/** Menu values. Popup menus count their separators, so the blend mode values have gaps. */
MCP.styles.TABLES = {
    blend: {
        "normal": 1, "dissolve": 2, "darken": 4, "multiply": 5, "color-burn": 6, "linear-burn": 7, "darker-color": 8,
        "lighten": 10, "screen": 11, "color-dodge": 12, "linear-dodge": 13, "lighter-color": 14,
        "overlay": 16, "soft-light": 17, "hard-light": 18, "vivid-light": 19, "linear-light": 20, "pin-light": 21, "hard-mix": 22,
        "difference": 24, "exclusion": 25, "subtract": 26, "divide": 27,
        "hue": 29, "saturation": 30, "color": 31, "luminosity": 32
    },
    glowTechnique: { "softer": 1, "precise": 2 },
    bevelTechnique: { "smooth": 1, "chisel-hard": 2, "chisel-soft": 3 },
    source: { "center": 1, "edge": 2 },
    bevelStyle: { "outer-bevel": 1, "inner-bevel": 2, "emboss": 3, "pillow-emboss": 4, "stroke-emboss": 5 },
    direction: { "up": 1, "down": 2 },
    gradientStyle: { "linear": 1, "radial": 2, "angle": 3, "reflected": 4, "diamond": 5 },
    strokePosition: { "outside": 1, "inside": 2, "center": 3 }
};

/** Designed starting points: soft and quiet, not After Effects' 75 % hard defaults. */
MCP.styles.DEFAULTS = {
    "drop-shadow": { color: [0, 0, 0, 1], opacity: 12, blendMode: "multiply", angle: 90, useGlobalLight: false, distance: 6, spread: 0, size: 24, noise: 0 },
    "inner-shadow": { color: [0, 0, 0, 1], opacity: 10, blendMode: "multiply", angle: 90, useGlobalLight: false, distance: 2, spread: 0, size: 6, noise: 0 },
    "outer-glow": { color: [1, 1, 1, 1], opacity: 35, blendMode: "screen", noise: 0, spread: 0, size: 30, technique: "softer", range: 50, jitter: 0 },
    "inner-glow": { color: [1, 1, 1, 1], opacity: 25, blendMode: "screen", noise: 0, spread: 0, size: 12, technique: "softer", range: 50, jitter: 0, source: "edge" },
    "bevel-emboss": { bevelStyle: "inner-bevel", technique: "smooth", depth: 100, direction: "up", size: 6, soften: 4, angle: 90, useGlobalLight: false, altitude: 30, highlightMode: "screen", highlightColor: [1, 1, 1, 1], highlightOpacity: 40, shadowMode: "multiply", shadowColor: [0, 0, 0, 1], shadowOpacity: 25 },
    "satin": { color: [0, 0, 0, 1], opacity: 15, blendMode: "multiply", angle: 45, distance: 10, size: 20, invert: true },
    "color-overlay": { color: [1, 1, 1, 1], opacity: 100, blendMode: "normal" },
    "gradient-overlay": { opacity: 100, blendMode: "normal", angle: 90, gradientStyle: "linear", reverse: false, alignWithLayer: true, scale: 100 },
    "stroke": { color: [0, 0, 0, 1], size: 1, opacity: 10, blendMode: "normal", position: "inside" }
};

/* ----------------------------------------------------------------- lookups */

MCP.styles.kindInfo = function (kind) {
    var info = MCP.styles.KINDS[String(kind)];
    if (!info) { MCP.fail("Unknown layer style kind '" + kind + "'. Use one of: " + MCP.styles.ORDER.join(", "), "invalid-argument"); }
    return info;
};

MCP.styles.root = function (layer) {
    var g = _mcpTry(function () { return layer.property(MCP.styles.ROOT); }, null);
    if (!g) { MCP.fail("Layer '" + layer.name + "' cannot hold layer styles (cameras, lights and audio-only layers have none).", "unsupported"); }
    return g;
};

/** The style group ("dropShadow/enabled" and so on), fetched fresh. */
MCP.styles.group = function (layer, kind) {
    var root = MCP.styles.root(layer);
    var mn = MCP.styles.kindInfo(kind).prefix + "/enabled";
    var g = _mcpTry(function () { return root.property(mn); }, null);
    return g || MCP.childProp(root, mn);
};

/** True when the style has been added to the layer (on or off). */
MCP.styles.isPresent = function (layer, kind) {
    var g = _mcpTry(function () { return MCP.styles.group(layer, kind); }, null);
    if (!g) { return false; }
    return _mcpTry(function () { return !!g.canSetEnabled; }, false);
};

MCP.styles.isOn = function (layer, kind) {
    if (!MCP.styles.isPresent(layer, kind)) { return false; }
    var g = MCP.styles.group(layer, kind);
    return _mcpTry(function () { return !!g.enabled; }, false);
};

MCP.styles.suffix = function (kind, name) {
    var spec = MCP.styles.SETTINGS[name];
    if (!spec) { return null; }
    return (spec.byKind && spec.byKind[kind]) ? spec.byKind[kind] : spec.suffix;
};

MCP.styles.matchName = function (kind, name) {
    return MCP.styles.kindInfo(kind).prefix + "/" + MCP.styles.suffix(kind, name);
};

MCP.styles.prop = function (layer, kind, name) {
    var g = MCP.styles.group(layer, kind);
    if (!g) { return null; }
    var mn = MCP.styles.matchName(kind, name);
    var p = MCP.childProp(g, mn);
    if (!p) { p = MCP.findProp(MCP.styles.root(layer), mn); }
    return p;
};

MCP.styles.tableFor = function (kind, name) {
    var spec = MCP.styles.SETTINGS[name];
    var t = (spec.tableByKind && spec.tableByKind[kind]) ? spec.tableByKind[kind] : spec.table;
    return MCP.styles.TABLES[t];
};

MCP.styles.allowed = function (kind, name) {
    return MCP.styles.BY_KIND[kind].indexOf(name) !== -1;
};

/* -------------------------------------------------------- value conversion */

MCP.styles.toAE = function (kind, name, value) {
    var spec = MCP.styles.SETTINGS[name];
    if (!spec) { MCP.fail("Unknown style setting '" + name + "'.", "invalid-argument"); }
    if (spec.type === "color") { return MCP.color.rgba(value); }
    if (spec.type === "bool") { return MCP.bool(value, false) ? 1 : 0; }
    if (spec.type === "point") {
        if (!MCP.isArray(value) || value.length < 2) { MCP.fail("'" + name + "' needs [x, y].", "invalid-argument"); }
        return [Number(value[0]), Number(value[1])];
    }
    if (spec.type === "enum") {
        var table = MCP.styles.tableFor(kind, name);
        if (typeof value === "number") { return Math.round(value); }
        var key = String(value).toLowerCase().replace(/[\s_]+/g, "-");
        if (!MCP.isDefined(table[key])) { MCP.fail("Unknown " + name + " '" + value + "' for " + kind + ". Use one of: " + MCP.keys(table).join(", "), "invalid-argument"); }
        return table[key];
    }
    var n = Number(value);
    if (isNaN(n)) { MCP.fail("'" + name + "' needs a number, got '" + value + "'.", "invalid-argument"); }
    return n;
};

MCP.styles.fromAE = function (kind, name, raw) {
    var spec = MCP.styles.SETTINGS[name];
    if (raw === null || raw === undefined) { return null; }
    if (spec.type === "color") { return MCP.color.toHex(raw); }
    if (spec.type === "bool") { return !!Number(raw); }
    if (spec.type === "point") { return MCP.roundValue(raw); }
    if (spec.type === "enum") {
        var table = MCP.styles.tableFor(kind, name);
        for (var k in table) {
            if (Object.prototype.hasOwnProperty.call(table, k) && table[k] === Math.round(Number(raw))) { return k; }
        }
        return Number(raw);
    }
    return MCP.round(Number(raw));
};

MCP.styles.discrete = function (name) {
    var t = MCP.styles.SETTINGS[name].type;
    return t === "bool" || t === "enum";
};

/* ---------------------------------------------------------------- serialize */

MCP.styles.serialize = function (layer, kind) {
    var info = MCP.styles.kindInfo(kind);
    var present = MCP.styles.isPresent(layer, kind);
    var g = MCP.styles.group(layer, kind);
    var out = {
        kind: kind,
        label: info.label,
        present: present,
        on: present ? _mcpTry(function () { return !!g.enabled; }, false) : false,
        path: g ? MCP.pathOf(g).path : null,
        settings: null,
        keyed: {}
    };
    if (!present) { return out; }
    var names = MCP.styles.BY_KIND[kind];
    out.settings = {};
    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        if (MCP.styles.SETTINGS[name].type === "gradient") { out.settings[name] = null; continue; }
        var p = MCP.styles.prop(layer, kind, name);
        if (!p) { continue; }
        out.settings[name] = MCP.styles.fromAE(kind, name, _mcpTry(function () { return p.value; }, null));
        var nk = _mcpTry(function () { return p.numKeys; }, 0);
        if (nk > 0) { out.keyed[name] = nk; }
    }
    return out;
};

MCP.styles.blendingOptions = function (layer) {
    var root = MCP.styles.root(layer);
    function read(mn) {
        var p = MCP.findProp(root, mn);
        return p ? _mcpTry(function () { return MCP.round(Number(p.value)); }, null) : null;
    }
    return {
        visible: _mcpTry(function () { return !!root.canSetEnabled; }, false),
        on: _mcpTry(function () { return !!root.enabled; }, null),
        globalLightAngle: read("ADBE Global Angle2"),
        globalLightAltitude: read("ADBE Global Altitude2"),
        fillOpacity: read("ADBE Layer Fill Opacity2")
    };
};

MCP.styles.rampEffect = function (layer) {
    var fx = _mcpTry(function () { return layer.property("ADBE Effect Parade"); }, null);
    if (!fx) { return null; }
    for (var i = 1; i <= fx.numProperties; i++) {
        var e = fx.property(i);
        if (e.name === MCP.styles.RAMP_NAME && e.matchName === "ADBE Ramp") { return e; }
    }
    return null;
};

/* ------------------------------------------------------------ turning on */

/** Tries to turn a hidden style on through its enabled flag. True when After Effects accepted it. */
MCP.styles.enableByProperty = function (layer, kind) {
    var g = _mcpTry(function () { return MCP.styles.group(layer, kind); }, null);
    if (!g) { return false; }
    try { g.enabled = true; } catch (e) { return false; }
    return MCP.styles.isOn(layer, kind);
};

/**
 * Adds the style to several layers of one comp with the Layer Styles menu
 * command: opens the comp in the viewer, selects exactly those layers, runs
 * the command, then restores the selection, locks and the previous viewer.
 */
MCP.styles.addByMenu = function (comp, layers, kind) {
    var info = MCP.styles.kindInfo(kind);
    var prevItem = _mcpTry(function () { return app.project.activeItem; }, null);
    var prevSel = [], unlocked = [], i;
    for (i = 1; i <= comp.numLayers; i++) {
        if (_mcpTry(function () { return comp.layer(i).selected; }, false)) { prevSel.push(comp.layer(i)); }
    }
    var errorText = null;
    try {
        for (i = 0; i < layers.length; i++) {
            if (layers[i].locked) { layers[i].locked = false; unlocked.push(layers[i]); }
        }
        comp.openInViewer();
        for (i = 1; i <= comp.numLayers; i++) { try { comp.layer(i).selected = false; } catch (e1) {} }
        for (i = 0; i < layers.length; i++) { layers[i].selected = true; }
        app.executeCommand(info.menuId);
    } catch (e2) {
        errorText = e2.toString();
    }
    for (i = 1; i <= comp.numLayers; i++) { try { comp.layer(i).selected = false; } catch (e3) {} }
    for (i = 0; i < prevSel.length; i++) { try { prevSel[i].selected = true; } catch (e4) {} }
    for (i = 0; i < unlocked.length; i++) { try { unlocked[i].locked = true; } catch (e5) {} }
    var restored = false;
    if (prevItem && prevItem instanceof CompItem && prevItem.id !== comp.id) {
        try { prevItem.openInViewer(); restored = true; } catch (e6) {}
    }
    return { menuId: info.menuId, menuItem: "Layer > Layer Styles > " + info.label, error: errorText, restoredViewer: restored, restoredSelection: prevSel.length, relocked: unlocked.length };
};

/* --------------------------------------------------------------- settings */

/** Sets one setting, keyed at the current time when the property already has keys. */
MCP.styles.setOne = function (layer, comp, kind, name, value, notes) {
    var p = MCP.styles.prop(layer, kind, name);
    if (!p) { notes.push(MCP.styles.KINDS[kind].label + " has no '" + name + "' property (" + MCP.styles.matchName(kind, name) + ") here; skipped."); return false; }
    var v = MCP.styles.toAE(kind, name, value);
    try {
        if (_mcpTry(function () { return p.numKeys; }, 0) > 0) { p.setValueAtTime(comp.time, v); }
        else { p.setValue(v); }
        return true;
    } catch (e) {
        notes.push("Could not set " + name + ": " + e.toString());
        return false;
    }
};

MCP.styles.setGlobalAngle = function (layer, angle, notes) {
    var p = MCP.findProp(MCP.styles.root(layer), "ADBE Global Angle2");
    if (!p) { notes.push("Global Light Angle not found; angle skipped."); return false; }
    try { p.setValue(Number(angle)); return true; } catch (e) { notes.push("Could not set the global light angle: " + e.toString()); return false; }
};

MCP.styles.setFillOpacity = function (layer, value, notes) {
    var p = MCP.findProp(MCP.styles.root(layer), "ADBE Layer Fill Opacity2");
    if (!p) { notes.push("Fill Opacity (Advanced Blending) not found; skipped."); return false; }
    try { p.setValue(Number(value)); return true; } catch (e) { notes.push("Could not set fill opacity: " + e.toString()); return false; }
};

/** Applies static settings to a style that is present. Returns {changed, notes}. Gradient colours are left to applyRamp. */
MCP.styles.applySettings = function (layer, comp, kind, settings, notes) {
    var changed = [];
    var s = settings || {};
    var names = MCP.styles.BY_KIND[kind];
    var hasGlobal = MCP.styles.allowed(kind, "useGlobalLight");
    var globalOn = MCP.isDefined(s.useGlobalLight) ? MCP.bool(s.useGlobalLight, false) : null;
    if (hasGlobal && MCP.isDefined(s.angle) && globalOn === null) {
        if (MCP.styles.setOne(layer, comp, kind, "useGlobalLight", false, notes)) { changed.push("useGlobalLight"); }
    }
    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        if (!MCP.isDefined(s[name]) || name === "colors") { continue; }
        if (name === "angle" && hasGlobal && globalOn === true) {
            if (MCP.styles.setGlobalAngle(layer, s.angle, notes)) { changed.push("angle"); notes.push("useGlobalLight is on, so angle was written to Blending Options > Global Light Angle, which every style on this layer that uses global light follows."); }
            continue;
        }
        if (MCP.styles.setOne(layer, comp, kind, name, s[name], notes)) { changed.push(name); }
        if (name === "color" && (kind === "outer-glow" || kind === "inner-glow")) {
            var choice = MCP.findProp(MCP.styles.group(layer, kind), MCP.styles.kindInfo(kind).prefix + "/AEColorChoice");
            if (choice) { try { choice.setValue(1); } catch (e) { notes.push("Could not switch the glow to a solid colour."); } }
        }
    }
    return changed;
};

/** Key values on style settings. keys: [{setting, time|frame, value, easing}]. */
MCP.styles.applyKeyframes = function (layer, comp, kind, keys, replace, notes) {
    var bySetting = {}, order = [], i, k;
    for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        var name = String(key.setting);
        if (!MCP.styles.SETTINGS[name] || !MCP.styles.allowed(kind, name)) { MCP.fail("Setting '" + name + "' does not apply to " + kind + ". It takes: " + MCP.styles.BY_KIND[kind].join(", "), "invalid-argument"); }
        if (name === "colors") { MCP.fail("Gradient colours cannot be keyframed by script.", "unsupported"); }
        if (!bySetting[name]) { bySetting[name] = []; order.push(name); }
        bySetting[name].push({ t: MCP.timeArg(comp, key), value: key.value, easing: key.easing });
    }
    var written = [];
    for (i = 0; i < order.length; i++) {
        var setting = order[i];
        var p = MCP.styles.prop(layer, kind, setting);
        if (!p) { notes.push(MCP.styles.KINDS[kind].label + " has no '" + setting + "' property here; keys skipped."); continue; }
        if (!_mcpTry(function () { return p.canVaryOverTime; }, false)) { notes.push("'" + setting + "' cannot be keyframed; skipped."); continue; }
        if (setting === "angle" && MCP.styles.allowed(kind, "useGlobalLight")) {
            var ug = MCP.styles.prop(layer, kind, "useGlobalLight");
            if (ug && _mcpTry(function () { return Number(ug.value); }, 0) === 1) {
                try { ug.setValue(0); notes.push("Use Global Light was switched off so the keyed angle takes effect."); } catch (e0) {}
            }
        }
        if (replace) { while (p.numKeys > 0) { p.removeKey(1); } }
        var list = bySetting[setting];
        list.sort(function (a, b) { return a.t - b.t; });
        for (k = 0; k < list.length; k++) { MCP.easing.setKey(p, list[k].t, MCP.styles.toAE(kind, setting, list[k].value)); }
        var serialized = [];
        for (k = 0; k < list.length; k++) {
            var idx = MCP.easing.keyIndexAtTime(p, list[k].t, 1e-3);
            if (idx < 1) { continue; }
            if (MCP.styles.discrete(setting)) {
                try { p.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); } catch (e1) {}
            } else {
                MCP.easing.applySegment(p, idx, MCP.isDefined(list[k].easing) ? list[k].easing : MCP.styles.DEFAULT_EASE);
            }
        }
        for (k = 0; k < list.length; k++) {
            var j = MCP.easing.keyIndexAtTime(p, list[k].t, 1e-3);
            if (j > 0) { serialized.push(MCP.serialize.keyframe(p, j)); }
        }
        written.push({ setting: setting, property: MCP.pathOf(p).path, matchName: p.matchName, numKeys: p.numKeys, keys: serialized });
    }
    return written;
};

/* -------------------------------------------------- gradient colours (ramp) */

/** Visible bounds in layer space. */
MCP.styles.bounds = function (layer, t) {
    var r = _mcpTry(function () { return layer.sourceRectAtTime(t, false); }, null);
    if (r && r.width > 0 && r.height > 0) { return { left: r.left, top: r.top, width: r.width, height: r.height }; }
    var w = _mcpTry(function () { return layer.width; }, 0) || _mcpTry(function () { return layer.source.width; }, 0);
    var h = _mcpTry(function () { return layer.height; }, 0) || _mcpTry(function () { return layer.source.height; }, 0);
    if (!w || !h) { MCP.fail("Could not measure the bounds of layer '" + layer.name + "' for the gradient.", "unsupported"); }
    return { left: 0, top: 0, width: w, height: h };
};

MCP.styles.stops = function (colors) {
    var out = [], n = colors.length;
    for (var i = 0; i < n; i++) {
        var c = colors[i];
        var isStop = c && !MCP.isArray(c) && typeof c === "object" && MCP.isDefined(c.color);
        var color = MCP.color.rgba(isStop ? c.color : c);
        var loc = (isStop && MCP.isDefined(c.location)) ? Number(c.location) : (n > 1 ? (100 * i) / (n - 1) : 0);
        out.push({ color: color, location: MCP.clamp(loc, 0, 100) });
    }
    out.sort(function (a, b) { return a.location - b.location; });
    return out;
};

/**
 * Draws gradient-overlay colours with a Gradient Ramp effect named
 * "Gradient Overlay Colors" (reused when present). Angle follows the style:
 * 90 runs from the bottom (first colour) to the top (last colour).
 */
MCP.styles.applyRamp = function (layer, comp, s, notes) {
    var fxGroup = MCP.effectsGroup(layer);
    var fx = MCP.styles.rampEffect(layer);
    var created = false;
    if (!fx) {
        var added = fxGroup.addProperty("ADBE Ramp");
        added.name = MCP.styles.RAMP_NAME;
        created = true;
        fx = MCP.styles.rampEffect(layer);
    }
    if (!fx) { MCP.fail("Could not add the Gradient Ramp effect that draws the gradient colours.", "script-error"); }
    var stops = MCP.styles.stops(s.colors);
    var first = stops[0], last = stops[stops.length - 1];
    var l0 = first.location / 100, l1 = last.location / 100;
    if (MCP.bool(s.reverse, false)) {
        var tmp = first; first = last; last = tmp;
        var tl = l0; l0 = 1 - l1; l1 = 1 - tl;
    }
    var b = MCP.styles.bounds(layer, comp.time);
    var off = MCP.isArray(s.offset) ? s.offset : [0, 0];
    var cx = b.left + b.width / 2 + Number(off[0]), cy = b.top + b.height / 2 + Number(off[1]);
    var angle = MCP.num(s.angle, 90) * Math.PI / 180;
    var dx = Math.cos(angle), dy = -Math.sin(angle);
    var scale = MCP.num(s.scale, 100) / 100;
    var style = MCP.isDefined(s.gradientStyle) ? String(s.gradientStyle) : "linear";
    var a, z, shape;
    if (style === "radial") {
        var radius = Math.max(b.width, b.height) / 2 * scale;
        a = [cx, cy]; z = [cx + dx * radius, cy + dy * radius]; shape = 2;
    } else {
        var half = (Math.abs(dx) * b.width + Math.abs(dy) * b.height) / 2 * scale;
        a = [cx - dx * half, cy - dy * half]; z = [cx + dx * half, cy + dy * half]; shape = 1;
        if (style !== "linear") { notes.push("Gradient style '" + style + "' is drawn as a linear ramp by the Gradient Ramp effect."); }
    }
    var p0 = [a[0] + (z[0] - a[0]) * l0, a[1] + (z[1] - a[1]) * l0];
    var p1 = [a[0] + (z[0] - a[0]) * l1, a[1] + (z[1] - a[1]) * l1];
    MCP.childProp(fx, "ADBE Ramp-0001").setValue(p0);
    MCP.childProp(fx, "ADBE Ramp-0002").setValue(first.color);
    MCP.childProp(fx, "ADBE Ramp-0003").setValue(p1);
    MCP.childProp(fx, "ADBE Ramp-0004").setValue(last.color);
    MCP.childProp(fx, "ADBE Ramp-0005").setValue(shape);
    var blend = MCP.childProp(fx, "ADBE Ramp-0007");
    if (blend) {
        var amount = 1 - MCP.num(s.opacity, 100) / 100;
        var max = _mcpTry(function () { return blend.hasMax ? blend.maxValue : 1; }, 1);
        try { blend.setValue(max > 1.5 ? amount * 100 : amount); } catch (e0) { notes.push("Could not set Blend With Original for the opacity."); }
    }
    try { fx.enabled = true; } catch (e1) {}
    if (stops.length > 2) { notes.push("Gradient Ramp holds two colours: the first and last stops were used, " + (stops.length - 2) + " middle stop(s) dropped."); }
    if (MCP.isDefined(s.blendMode) && String(s.blendMode) !== "normal") { notes.push("blendMode is not available on the Gradient Ramp effect; it draws in normal mode."); }
    notes.push("After Effects does not let scripts set layer-style gradient colours, so the colours are drawn by the Gradient Ramp effect '" + MCP.styles.RAMP_NAME + "' (effects render before layer styles).");
    return {
        effect: MCP.styles.RAMP_NAME, path: MCP.pathOf(fx).path, created: created,
        startPoint: MCP.roundValue(p0), endPoint: MCP.roundValue(p1),
        startColor: MCP.color.toHex(first.color), endColor: MCP.color.toHex(last.color),
        shape: shape === 2 ? "radial" : "linear"
    };
};

/* -------------------------------------------------------------- bulk add */

MCP.styles.rendererNote = function (comp, layer) {
    var r = _mcpTry(function () { return comp.renderer; }, MCP.styles.CLASSIC_RENDERER);
    if (_mcpTry(function () { return layer.threeDLayer; }, false) && r && r !== MCP.styles.CLASSIC_RENDERER) {
        return "Layer styles on 3D layers render only with the Classic 3D renderer; this comp uses '" + r + "'.";
    }
    return null;
};

/**
 * Turns a style on for several layers of one comp and applies settings.
 * opts: {useDefaults, allowMenu, fillOpacity}. Returns per-layer results.
 */
MCP.styles.addToLayers = function (comp, layers, kind, settings, opts) {
    var info = MCP.styles.kindInfo(kind);
    var o = opts || {};
    var s = settings || {};
    var useRamp = kind === "gradient-overlay" && MCP.isArray(s.colors);
    var states = [], menuQueue = [], i, st;
    for (i = 0; i < layers.length; i++) {
        st = { layer: layers[i], status: "ok", added: false, method: null, notes: [], error: null, code: null };
        states.push(st);
        try {
            MCP.styles.root(layers[i]);
            var present = MCP.styles.isPresent(layers[i], kind);
            if (useRamp) {
                st.method = "gradient-ramp-effect";
                if (present && MCP.styles.isOn(layers[i], kind)) {
                    try { MCP.styles.group(layers[i], kind).enabled = false; } catch (e0) {}
                    st.notes.push("The Gradient Overlay style was switched off: its colours cannot be set by script, so the Gradient Ramp effect draws the gradient.");
                }
            } else if (present) {
                if (!MCP.styles.isOn(layers[i], kind)) { MCP.styles.group(layers[i], kind).enabled = true; st.method = "re-enabled"; }
                else { st.method = "already-on"; }
            } else if (MCP.styles.enableByProperty(layers[i], kind)) {
                st.method = "property"; st.added = true;
            } else {
                menuQueue.push(st);
            }
        } catch (e1) {
            st.status = "error"; st.error = (e1 && e1.message) ? e1.message : String(e1); st.code = (e1 && e1.mcpCode) ? e1.mcpCode : "script-error";
        }
    }
    var menu = null;
    if (menuQueue.length) {
        if (o.allowMenu === false) {
            for (i = 0; i < menuQueue.length; i++) {
                menuQueue[i].status = "error"; menuQueue[i].code = "unsupported";
                menuQueue[i].error = info.label + " is not on layer '" + menuQueue[i].layer.name + "' and After Effects only adds it through the Layer > Layer Styles menu command, which allowMenuCommand false forbids.";
            }
        } else {
            var targets = [];
            for (i = 0; i < menuQueue.length; i++) { targets.push(menuQueue[i].layer); }
            menu = MCP.styles.addByMenu(comp, targets, kind);
            for (i = 0; i < menuQueue.length; i++) {
                st = menuQueue[i];
                if (MCP.styles.isPresent(st.layer, kind)) {
                    if (!MCP.styles.isOn(st.layer, kind)) { try { MCP.styles.group(st.layer, kind).enabled = true; } catch (e2) {} }
                    st.method = "menu"; st.added = true;
                } else {
                    st.status = "error"; st.code = "script-error";
                    st.error = "The menu command " + menu.menuItem + " did not add the style to '" + st.layer.name + "'" + (menu.error ? " (" + menu.error + ")" : "") + ". The comp must be able to open in the viewer.";
                }
            }
        }
    }
    var results = [];
    for (i = 0; i < states.length; i++) {
        st = states[i];
        if (st.status !== "ok") {
            results.push({ status: "error", layer: MCP.serialize.layerRef(st.layer), error: st.error, code: st.code });
            continue;
        }
        var notes = st.notes;
        var useDefaults = MCP.isDefined(o.useDefaults) ? MCP.bool(o.useDefaults, false) : (st.added || useRamp && !MCP.styles.rampEffect(st.layer));
        var merged = useDefaults ? MCP.extend(MCP.extend({}, MCP.styles.DEFAULTS[kind]), s) : s;
        var changed = [], ramp = null;
        try {
            if (useRamp) {
                ramp = MCP.styles.applyRamp(st.layer, comp, merged, notes);
                changed.push("colors");
            } else {
                changed = MCP.styles.applySettings(st.layer, comp, kind, merged, notes);
                if (kind === "gradient-overlay") { notes.push("The style keeps its current gradient colours (scripts cannot set them); pass settings.colors to draw custom colours with a Gradient Ramp effect."); }
            }
            if (MCP.isDefined(o.fillOpacity) && MCP.styles.setFillOpacity(st.layer, o.fillOpacity, notes)) { changed.push("fillOpacity"); }
            var root = MCP.styles.root(st.layer);
            if (!useRamp && _mcpTry(function () { return root.canSetEnabled && !root.enabled; }, false)) {
                try { root.enabled = true; notes.push("The Layer Styles group was switched off; it was switched on."); } catch (e3) {}
            }
            var rn = MCP.styles.rendererNote(comp, st.layer);
            if (rn) { notes.push(rn); }
            results.push({
                status: "ok", layer: MCP.serialize.layerRef(st.layer), kind: kind, added: st.added, method: st.method,
                defaultsApplied: useDefaults, changed: changed,
                style: MCP.styles.serialize(st.layer, kind), colorsEffect: ramp, notes: notes
            });
        } catch (e4) {
            results.push({ status: "error", layer: MCP.serialize.layerRef(st.layer), error: (e4 && e4.message) ? e4.message : String(e4), code: (e4 && e4.mcpCode) ? e4.mcpCode : "script-error" });
        }
    }
    return { results: results, menu: menu };
};

MCP.styles.layersFromArgs = function (comp, args) {
    if (MCP.isDefined(args.layer)) { return [MCP.resolveLayer(comp, args.layer)]; }
    return MCP.resolveLayers(comp, MCP.requireArg(args, "layers"));
};

MCP.styles.bulkResult = function (comp, args, results, extra) {
    var failed = 0;
    for (var i = 0; i < results.length; i++) { if (results[i].status !== "ok") { failed++; } }
    if (MCP.isDefined(args.layer) && results.length === 1 && results[0].status !== "ok") {
        MCP.fail(results[0].error, results[0].code || "script-error");
    }
    var out = { composition: MCP.serialize.compRef(comp), count: results.length, failed: failed, results: results };
    if (extra) { MCP.extend(out, extra); }
    return out;
};

/* ---------------------------------------------------------------- commands */

MCP.register("addLayerStyle", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var kind = String(MCP.requireArg(args, "kind"));
    MCP.styles.kindInfo(kind);
    var layers = MCP.styles.layersFromArgs(comp, args);
    var res = MCP.styles.addToLayers(comp, layers, kind, args.settings || {}, {
        useDefaults: args.useDefaults,
        allowMenu: MCP.bool(args.allowMenuCommand, true),
        fillOpacity: args.fillOpacity
    });
    return MCP.styles.bulkResult(comp, args, res.results, { kind: kind, menuCommand: res.menu });
}, { mutating: true });

MCP.register("setLayerStyle", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var kind = String(MCP.requireArg(args, "kind"));
    var info = MCP.styles.kindInfo(kind);
    MCP.styles.root(layer);
    var s = args.settings || {};
    var notes = [], changed = [], ramp = null, keyframes = [];
    var rampOnly = kind === "gradient-overlay" && MCP.isArray(s.colors);
    var present = MCP.styles.isPresent(layer, kind);
    if (!present && !(rampOnly && !(MCP.isArray(args.keyframes) && args.keyframes.length))) {
        MCP.fail(info.label + " is not on layer '" + layer.name + "'. Turn it on with add-layer-style first.", "not-found", { styles: MCP.styles.presentKinds(layer) });
    }
    if (rampOnly) {
        var rampSettings = MCP.extend({}, s);
        var old = MCP.styles.rampEffect(layer);
        if (old) { notes.push("Updated the existing Gradient Ramp effect; angle, scale, offset and style not given use their defaults."); }
        ramp = MCP.styles.applyRamp(layer, comp, rampSettings, notes);
        changed.push("colors");
        if (present && MCP.styles.isOn(layer, kind)) {
            try { MCP.styles.group(layer, kind).enabled = false; notes.push("The Gradient Overlay style was switched off so its own colours do not cover the Gradient Ramp."); } catch (e0) {}
        }
    }
    if (present) {
        changed = changed.concat(MCP.styles.applySettings(layer, comp, kind, s, notes));
        if (MCP.isArray(args.keyframes) && args.keyframes.length) {
            keyframes = MCP.styles.applyKeyframes(layer, comp, kind, args.keyframes, MCP.bool(args.replaceKeys, false), notes);
        }
        if (!rampOnly && !MCP.styles.isOn(layer, kind)) { notes.push(info.label + " is switched off on this layer; the changes apply when add-layer-style turns it on."); }
    }
    if (MCP.isDefined(args.fillOpacity) && MCP.styles.setFillOpacity(layer, args.fillOpacity, notes)) { changed.push("fillOpacity"); }
    if (!changed.length && !keyframes.length) { MCP.fail("Nothing was changed. Give settings that apply to " + kind + " (" + MCP.styles.BY_KIND[kind].join(", ") + "), keyframes or fillOpacity.", "invalid-argument"); }
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer), kind: kind,
        style: MCP.styles.serialize(layer, kind), changed: changed, keyframes: keyframes, colorsEffect: ramp, notes: notes
    };
}, { mutating: true });

MCP.styles.presentKinds = function (layer) {
    var out = [];
    for (var i = 0; i < MCP.styles.ORDER.length; i++) {
        if (MCP.styles.isPresent(layer, MCP.styles.ORDER[i])) { out.push(MCP.styles.ORDER[i]); }
    }
    return out;
};

MCP.register("removeLayerStyle", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.styles.layersFromArgs(comp, args);
    var all = MCP.bool(args.all, false);
    if (!all) { MCP.styles.kindInfo(MCP.requireArg(args, "kind")); }
    var kinds = all ? MCP.styles.ORDER : [String(args.kind)];
    var results = [];
    for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        try {
            MCP.styles.root(L);
            var off = [], alreadyOff = [], notAdded = [], rampOff = false;
            for (var k = 0; k < kinds.length; k++) {
                var kind = kinds[k];
                if (!MCP.styles.isPresent(L, kind)) { notAdded.push(kind); continue; }
                if (MCP.styles.isOn(L, kind)) { MCP.styles.group(L, kind).enabled = false; off.push(kind); }
                else { alreadyOff.push(kind); }
            }
            if (kinds.indexOf("gradient-overlay") !== -1) {
                var fx = MCP.styles.rampEffect(L);
                if (fx && fx.enabled) { fx.enabled = false; rampOff = true; }
            }
            results.push({ status: "ok", layer: MCP.serialize.layerRef(L), turnedOff: off, alreadyOff: alreadyOff, notAdded: notAdded, colorsEffectOff: rampOff });
        } catch (e) {
            results.push({ status: "error", layer: MCP.serialize.layerRef(L), error: (e && e.message) ? e.message : String(e), code: (e && e.mcpCode) ? e.mcpCode : "script-error" });
        }
    }
    return MCP.styles.bulkResult(comp, args, results, { kind: all ? "all" : String(args.kind) });
}, { mutating: true });

MCP.register("listLayerStyles", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.styles.layersFromArgs(comp, args);
    var includeOff = MCP.bool(args.includeOff, true);
    var out = [];
    for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        try {
            MCP.styles.root(L);
            var styles = [], notAdded = [];
            for (var k = 0; k < MCP.styles.ORDER.length; k++) {
                var kind = MCP.styles.ORDER[k];
                if (!MCP.styles.isPresent(L, kind)) { notAdded.push(kind); continue; }
                var sd = MCP.styles.serialize(L, kind);
                if (!sd.on && !includeOff) { continue; }
                styles.push(sd);
            }
            var fx = MCP.styles.rampEffect(L);
            var entry = {
                status: "ok", layer: MCP.serialize.layerRef(L), count: styles.length, styles: styles, notAdded: notAdded,
                blendingOptions: MCP.styles.blendingOptions(L),
                colorsEffect: fx ? { name: fx.name, path: MCP.pathOf(fx).path, enabled: !!fx.enabled } : null
            };
            var rn = MCP.styles.rendererNote(comp, L);
            if (rn) { entry.notes = [rn]; }
            out.push(entry);
        } catch (e) {
            out.push({ status: "error", layer: MCP.serialize.layerRef(L), error: (e && e.message) ? e.message : String(e), code: (e && e.mcpCode) ? e.mcpCode : "script-error" });
        }
    }
    var failed = 0;
    for (var j = 0; j < out.length; j++) { if (out[j].status !== "ok") { failed++; } }
    if (MCP.isDefined(args.layer) && out.length === 1 && out[0].status !== "ok") { MCP.fail(out[0].error, out[0].code); }
    return { composition: MCP.serialize.compRef(comp), count: out.length, failed: failed, layers: out };
}, { mutating: false });
