/*
 * Text layer commands: creation, content and style, fonts, text animators
 * and selectors, outlines, paragraph boxes.
 */

MCP.textDocProp = function (layer) {
    if (!(layer instanceof TextLayer)) { MCP.fail("Layer '" + layer.name + "' is not a text layer.", "invalid-argument"); }
    return layer.property("ADBE Text Properties").property("ADBE Text Document");
};

MCP.justificationValue = function (name) {
    var map = {
        "left": "LEFT_JUSTIFY", "right": "RIGHT_JUSTIFY", "center": "CENTER_JUSTIFY", "centre": "CENTER_JUSTIFY",
        "justify-left": "FULL_JUSTIFY_LASTLINE_LEFT", "justify-right": "FULL_JUSTIFY_LASTLINE_RIGHT",
        "justify-center": "FULL_JUSTIFY_LASTLINE_CENTER", "justify-full": "FULL_JUSTIFY_LASTLINE_FULL"
    };
    var key = String(name).toLowerCase();
    if (!map[key]) { MCP.fail("Unknown justification '" + name + "'. Use left, center, right, justify-left, justify-right, justify-center or justify-full.", "invalid-argument"); }
    return ParagraphJustification[map[key]];
};

/** Applies style fields from args to a TextDocument. Returns the list of changed fields. */
MCP.applyTextStyle = function (doc, args) {
    var changed = [];
    function set(field, value) { doc[field] = value; changed.push(field); }
    if (MCP.isDefined(args.font)) { set("font", String(args.font)); }
    if (MCP.isDefined(args.fontSize)) { set("fontSize", Number(args.fontSize)); }
    if (MCP.isDefined(args.fillColor)) {
        doc.applyFill = true;
        set("fillColor", MCP.color.rgb(args.fillColor));
    }
    if (MCP.isDefined(args.strokeColor) || MCP.isDefined(args.strokeWidth)) {
        var sw = MCP.num(args.strokeWidth, MCP.isDefined(args.strokeColor) ? 2 : 0);
        if (sw > 0) {
            doc.applyStroke = true;
            if (MCP.isDefined(args.strokeColor)) { set("strokeColor", MCP.color.rgb(args.strokeColor)); }
            set("strokeWidth", sw);
            if (MCP.isDefined(args.strokeOverFill)) { set("strokeOverFill", MCP.bool(args.strokeOverFill, false)); }
        } else {
            doc.applyStroke = false; changed.push("applyStroke");
        }
    }
    if (MCP.isDefined(args.tracking)) { set("tracking", Number(args.tracking)); }
    if (MCP.isDefined(args.leading)) { doc.autoLeading = false; set("leading", Number(args.leading)); }
    if (MCP.isDefined(args.autoLeading)) { set("autoLeading", MCP.bool(args.autoLeading, true)); }
    if (MCP.isDefined(args.justification)) { set("justification", MCP.justificationValue(args.justification)); }
    if (MCP.isDefined(args.baselineShift)) { set("baselineShift", Number(args.baselineShift)); }
    if (MCP.isDefined(args.allCaps)) { set("allCaps", MCP.bool(args.allCaps, false)); }
    if (MCP.isDefined(args.smallCaps)) { set("smallCaps", MCP.bool(args.smallCaps, false)); }
    if (MCP.isDefined(args.fauxBold)) { set("fauxBold", MCP.bool(args.fauxBold, false)); }
    if (MCP.isDefined(args.fauxItalic)) { set("fauxItalic", MCP.bool(args.fauxItalic, false)); }
    if (MCP.isDefined(args.verticalScale)) { set("verticalScale", Number(args.verticalScale)); }
    if (MCP.isDefined(args.horizontalScale)) { set("horizontalScale", Number(args.horizontalScale)); }
    if (MCP.isDefined(args.tsume)) { set("tsume", Number(args.tsume)); }
    return changed;
};

MCP.register("createTextLayer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var text = MCP.isDefined(args.text) ? String(args.text) : "Text";
    var layer;
    if (MCP.isArray(args.boxSize)) {
        layer = comp.layers.addBoxText([Number(args.boxSize[0]), Number(args.boxSize[1])], text);
    } else {
        layer = comp.layers.addText(text);
    }
    var prop = MCP.textDocProp(layer);
    var doc = prop.value;
    var styleArgs = MCP.extend({}, args);
    if (!MCP.isDefined(styleArgs.fillColor)) { styleArgs.fillColor = [1, 1, 1, 1]; }
    if (!MCP.isDefined(styleArgs.fontSize)) { styleArgs.fontSize = 72; }
    if (!MCP.isDefined(styleArgs.justification)) { styleArgs.justification = "center"; }
    MCP.applyTextStyle(doc, styleArgs);
    prop.setValue(doc);
    if (!MCP.isDefined(args.position)) {
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    }
    MCP.placeNewLayer(comp, layer, args);
    if (!MCP.isDefined(args.name)) { layer.name = text.length > 40 ? text.substring(0, 40) : text; }
    var out = MCP.serialize.layer(layer);
    out.textDocument = MCP.serialize.textDocument(prop.value);
    return { composition: MCP.serialize.compRef(comp), layer: out };
}, { mutating: true });

MCP.register("setText", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.textDocProp(r.layer);
    var text = String(MCP.requireArg(args, "text"));
    if (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) {
        var doc = prop.valueAtTime(MCP.timeArg(r.comp, args), false);
        doc.text = text;
        MCP.easing.setKey(prop, MCP.timeArg(r.comp, args), doc);
    } else if (prop.numKeys > 0) {
        var d2 = prop.value; d2.text = text;
        prop.setValueAtTime(r.comp.time, d2);
    } else {
        var d3 = prop.value; d3.text = text;
        prop.setValue(d3);
    }
    if (MCP.bool(args.renameLayer, false)) { r.layer.name = text.length > 40 ? text.substring(0, 40) : text; }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), textDocument: MCP.serialize.textDocument(prop.value), numKeys: prop.numKeys };
}, { mutating: true });

MCP.register("getText", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.textDocProp(r.layer);
    var doc = (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) ? prop.valueAtTime(MCP.timeArg(r.comp, args), false) : prop.value;
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), text: doc.text, textDocument: MCP.serialize.textDocument(doc), numKeys: prop.numKeys, hasExpression: prop.expression !== "" };
}, { mutating: true });

MCP.register("setTextStyle", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.textDocProp(r.layer);
    var doc = prop.value;
    var changed = MCP.applyTextStyle(doc, args);
    if (!changed.length) { MCP.fail("No style fields given. Use font, fontSize, fillColor, strokeColor, strokeWidth, tracking, leading, justification, baselineShift, allCaps, smallCaps, fauxBold, fauxItalic, verticalScale, horizontalScale or tsume.", "invalid-argument"); }
    if (prop.numKeys > 0) { prop.setValueAtTime(r.comp.time, doc); } else { prop.setValue(doc); }
    var after = prop.value;
    var warnings = [];
    if (MCP.isDefined(args.font) && after.font !== String(args.font)) {
        warnings.push("Font '" + args.font + "' was not applied (After Effects reports '" + after.font + "'). Use list-fonts to find the PostScript name.");
    }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), changed: changed, textDocument: MCP.serialize.textDocument(after), warnings: warnings };
}, { mutating: true });

/* ------------------------------------------------------------------ fonts */

MCP.register("listFonts", function (args) {
    var fontsObj = null;
    try { fontsObj = (typeof app.fonts !== "undefined") ? app.fonts : null; } catch (e0) { fontsObj = null; }
    if (!fontsObj || MCP.aeVersion() < 24) {
        return {
            supported: false,
            aeVersion: _mcpTry(function () { return app.version; }, null),
            message: "The font list needs After Effects 24.0 or later (app.fonts). Any installed PostScript font name can still be passed to set-text-style or create-text-layer; the result of that call reports whether it was applied.",
            totalInstalled: 0, count: 0, truncated: false, fonts: []
        };
    }
    var query = MCP.isDefined(args.query) ? String(args.query).toLowerCase() : "";
    var max = Math.round(MCP.num(args.maxResults, 200));
    var families = _mcpTry(function () { return fontsObj.allFonts; }, null) || [];
    var out = [], total = 0, truncated = false;
    for (var f = 0; f < families.length; f++) {
        var family = families[f];
        var members = MCP.isArray(family) ? family : [family];
        for (var m = 0; m < members.length; m++) {
            var font = members[m];
            if (!font) { continue; }
            total++;
            var entry = {
                postScriptName: _mcpTry(function () { return font.postScriptName; }, null),
                family: _mcpTry(function () { return font.familyName; }, null),
                style: _mcpTry(function () { return font.styleName; }, null),
                fontType: _mcpTry(function () { return String(font.fontType); }, null),
                technology: _mcpTry(function () { return String(font.technology); }, null),
                isSubstitute: _mcpTry(function () { return !!font.isSubstitute; }, null)
            };
            if (query) {
                var hay = (String(entry.postScriptName) + " " + String(entry.family) + " " + String(entry.style)).toLowerCase();
                if (hay.indexOf(query) === -1) { continue; }
            }
            if (out.length >= max) { truncated = true; continue; }
            out.push(entry);
        }
    }
    return { supported: true, aeVersion: app.version, query: query || null, totalInstalled: total, count: out.length, truncated: truncated, fonts: out };
}, { mutating: false });

/* --------------------------------------------------------- animator helpers */

MCP.text = {};

MCP.text.BASED_ON = { "characters": 1, "characters-excluding-spaces": 2, "words": 3, "lines": 4 };
MCP.text.BASED_ON_NAMES = ["", "characters", "characters-excluding-spaces", "words", "lines"];
MCP.text.SHAPES = { "square": 1, "ramp-up": 2, "ramp-down": 3, "triangle": 4, "round": 5, "smooth": 6 };
MCP.text.SHAPE_NAMES = ["", "square", "ramp-up", "ramp-down", "triangle", "round", "smooth"];
MCP.text.MODES = { "add": 1, "subtract": 2, "intersect": 3, "min": 4, "max": 5, "difference": 6 };
MCP.text.MODE_NAMES = ["", "add", "subtract", "intersect", "min", "max", "difference"];

MCP.text.enumValue = function (table, name, label) {
    var key = String(name).toLowerCase().replace(/[\s_]+/g, "-");
    if (!MCP.isDefined(table[key])) { MCP.fail("Unknown " + label + " '" + name + "'. Use one of: " + MCP.keys(table).join(", "), "invalid-argument"); }
    return table[key];
};

MCP.text.animatorsGroup = function (layer) {
    if (!(layer instanceof TextLayer)) { MCP.fail("Layer '" + layer.name + "' is not a text layer. Text animators only exist on text layers.", "invalid-argument"); }
    var g = _mcpTry(function () { return layer.property("ADBE Text Properties").property("ADBE Text Animators"); }, null);
    if (!g) { MCP.fail("Layer '" + layer.name + "' has no Animators group.", "unsupported"); }
    return g;
};

MCP.text.resolveAnimator = function (layer, ref) {
    var g = MCP.text.animatorsGroup(layer);
    var anim = null;
    if (!MCP.isDefined(ref)) {
        if (g.numProperties === 1) { return g.property(1); }
        if (g.numProperties === 0) { MCP.fail("Layer '" + layer.name + "' has no text animators. Add one with add-text-animator.", "not-found"); }
        MCP.fail("Layer '" + layer.name + "' has " + g.numProperties + " animators; give animator {name} or an index. Animators: " + MCP.childNames(g).join(", "), "ambiguous", { animators: MCP.childNames(g) });
    }
    if (typeof ref === "number") {
        anim = _mcpTry(function () { return g.property(Number(ref)); }, null);
    } else if (typeof ref === "object" && ref !== null) {
        anim = MCP.isDefined(ref.index) ? _mcpTry(function () { return g.property(Number(ref.index)); }, null) : MCP.childProp(g, String(ref.name));
    } else {
        anim = MCP.childProp(g, String(ref));
    }
    if (!anim) { MCP.fail("Animator '" + ref + "' not found on layer '" + layer.name + "'. Animators: " + (MCP.childNames(g).join(", ") || "(none)"), "not-found", { animators: MCP.childNames(g) }); }
    return anim;
};

MCP.text.animatorProps = function (anim) {
    var p = _mcpTry(function () { return anim.property("ADBE Text Animator Properties"); }, null);
    if (!p) { MCP.fail("Animator '" + anim.name + "' has no properties group.", "script-error"); }
    return p;
};

MCP.text.selectorsGroup = function (anim) {
    var s = _mcpTry(function () { return anim.property("ADBE Text Selectors"); }, null);
    if (!s) { MCP.fail("Animator '" + anim.name + "' has no selectors group.", "script-error"); }
    return s;
};

/** Direct child by matchName, then a depth-first search by display name. */
MCP.text.prop = function (root, matchName, displayName) {
    var p = MCP.childProp(root, matchName);
    if (!p && displayName) { p = MCP.findProp(root, displayName); }
    return p;
};

MCP.text.selectorType = function (sel) {
    var mn = String(_mcpTry(function () { return sel.matchName; }, ""));
    if (mn === "ADBE Text Wiggly Selector") { return "wiggly"; }
    if (mn === "ADBE Text Expressible Selector") { return "expression"; }
    return "range";
};

/** Start, End or Offset of a range selector for the current units. */
MCP.text.rangeProp = function (sel, which, units) {
    var names = {
        start: ["ADBE Text Percent Start", "ADBE Text Index Start", "Start"],
        end: ["ADBE Text Percent End", "ADBE Text Index End", "End"],
        offset: ["ADBE Text Percent Offset", "ADBE Text Index Offset", "Offset"]
    };
    var n = names[which];
    var first = units === "index" ? n[1] : n[0];
    var second = units === "index" ? n[0] : n[1];
    return MCP.childProp(sel, first) || MCP.childProp(sel, second) || MCP.findProp(sel, n[2]);
};

MCP.text.currentUnits = function (sel) {
    var adv = MCP.childProp(sel, "ADBE Text Range Advanced") || sel;
    var u = MCP.text.prop(adv, "ADBE Text Range Units", "Units");
    var v = u ? _mcpTry(function () { return u.value; }, 1) : 1;
    return Number(v) === 2 ? "index" : "percent";
};

MCP.text.setIf = function (root, matchName, displayName, value, changed, notes, label) {
    if (!MCP.isDefined(value)) { return null; }
    var p = MCP.text.prop(root, matchName, displayName);
    if (!p) { notes.push("Property '" + (displayName || matchName) + "' not found; skipped."); return null; }
    try { p.setValue(value); changed.push(label || displayName || matchName); return p; }
    catch (e) { notes.push("Could not set '" + (displayName || matchName) + "': " + e.toString()); return null; }
};

/** Applies range selector settings from args. Keys start/end/offset when args.time or args.frame is given. */
MCP.text.applyRangeSettings = function (sel, args, comp, notes) {
    var changed = [], keyframes = [];
    var adv = MCP.childProp(sel, "ADBE Text Range Advanced") || sel;
    if (MCP.isDefined(args.units)) {
        MCP.text.setIf(adv, "ADBE Text Range Units", "Units", String(args.units) === "index" ? 2 : 1, changed, notes, "units");
    }
    var units = MCP.text.currentUnits(sel);
    var keyed = MCP.isDefined(args.time) || MCP.isDefined(args.frame);
    var which = ["start", "end", "offset"];
    for (var i = 0; i < which.length; i++) {
        var w = which[i];
        if (!MCP.isDefined(args[w])) { continue; }
        var p = MCP.text.rangeProp(sel, w, units);
        if (!p) { notes.push("Selector has no '" + w + "' property; skipped."); continue; }
        try {
            if (keyed) {
                var t = MCP.timeArg(comp, args);
                var ki = MCP.easing.setKey(p, t, Number(args[w]));
                if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(p, ki, args.easing); }
                keyframes.push({ property: MCP.pathOf(p).path, keyIndex: ki, keyframe: MCP.serialize.keyframe(p, ki) });
            } else if (p.numKeys > 0) {
                p.setValueAtTime(comp.time, Number(args[w]));
            } else {
                p.setValue(Number(args[w]));
            }
            changed.push(w);
        } catch (e) { notes.push("Could not set '" + w + "': " + e.toString()); }
    }
    if (MCP.isDefined(args.basedOn)) { MCP.text.setIf(adv, "ADBE Text Range Type2", "Based On", MCP.text.enumValue(MCP.text.BASED_ON, args.basedOn, "basedOn"), changed, notes, "basedOn"); }
    if (MCP.isDefined(args.mode)) { MCP.text.setIf(adv, "ADBE Text Selector Mode", "Mode", MCP.text.enumValue(MCP.text.MODES, args.mode, "mode"), changed, notes, "mode"); }
    if (MCP.isDefined(args.amount)) { MCP.text.setIf(adv, "ADBE Text Selector Max Amount", "Amount", Number(args.amount), changed, notes, "amount"); }
    if (MCP.isDefined(args.shape)) { MCP.text.setIf(adv, "ADBE Text Range Shape", "Shape", MCP.text.enumValue(MCP.text.SHAPES, args.shape, "shape"), changed, notes, "shape"); }
    if (MCP.isDefined(args.smoothness)) { MCP.text.setIf(adv, "ADBE Text Selector Smoothness", "Smoothness", Number(args.smoothness), changed, notes, "smoothness"); }
    if (MCP.isDefined(args.easeHigh)) { MCP.text.setIf(adv, "ADBE Text Levels Max Ease", "Ease High", Number(args.easeHigh), changed, notes, "easeHigh"); }
    if (MCP.isDefined(args.easeLow)) { MCP.text.setIf(adv, "ADBE Text Levels Min Ease", "Ease Low", Number(args.easeLow), changed, notes, "easeLow"); }
    if (MCP.isDefined(args.randomizeOrder)) { MCP.text.setIf(adv, "ADBE Text Randomize Order", "Randomize Order", MCP.bool(args.randomizeOrder, false) ? 1 : 0, changed, notes, "randomizeOrder"); }
    if (MCP.isDefined(args.randomSeed)) { MCP.text.setIf(adv, "ADBE Text Random Seed", "Random Seed", Math.round(Number(args.randomSeed)), changed, notes, "randomSeed"); }
    return { changed: changed, keyframes: keyframes };
};

MCP.text.readValue = function (root, matchName, displayName) {
    var p = MCP.text.prop(root, matchName, displayName);
    if (!p) { return null; }
    return _mcpTry(function () { return MCP.serialize.rawValue(p.value); }, null);
};

MCP.text.serializeSelector = function (sel) {
    var type = MCP.text.selectorType(sel);
    var out = { index: sel.propertyIndex, name: sel.name, matchName: sel.matchName, type: type, path: MCP.pathOf(sel).path };
    var adv = MCP.childProp(sel, "ADBE Text Range Advanced") || sel;
    if (type === "range") {
        var units = MCP.text.currentUnits(sel);
        var sp = MCP.text.rangeProp(sel, "start", units), ep = MCP.text.rangeProp(sel, "end", units), op = MCP.text.rangeProp(sel, "offset", units);
        out.values = {
            units: units,
            start: sp ? _mcpTry(function () { return MCP.round(sp.value); }, null) : null,
            end: ep ? _mcpTry(function () { return MCP.round(ep.value); }, null) : null,
            offset: op ? _mcpTry(function () { return MCP.round(op.value); }, null) : null,
            basedOn: MCP.text.BASED_ON_NAMES[Number(MCP.text.readValue(adv, "ADBE Text Range Type2", "Based On"))] || null,
            mode: MCP.text.MODE_NAMES[Number(MCP.text.readValue(adv, "ADBE Text Selector Mode", "Mode"))] || null,
            amount: MCP.text.readValue(adv, "ADBE Text Selector Max Amount", "Amount"),
            shape: MCP.text.SHAPE_NAMES[Number(MCP.text.readValue(adv, "ADBE Text Range Shape", "Shape"))] || null,
            smoothness: MCP.text.readValue(adv, "ADBE Text Selector Smoothness", "Smoothness"),
            easeHigh: MCP.text.readValue(adv, "ADBE Text Levels Max Ease", "Ease High"),
            easeLow: MCP.text.readValue(adv, "ADBE Text Levels Min Ease", "Ease Low"),
            randomizeOrder: !!Number(MCP.text.readValue(adv, "ADBE Text Randomize Order", "Randomize Order"))
        };
        out.keyframes = {
            start: sp ? _mcpTry(function () { return sp.numKeys; }, 0) : 0,
            end: ep ? _mcpTry(function () { return ep.numKeys; }, 0) : 0,
            offset: op ? _mcpTry(function () { return op.numKeys; }, 0) : 0
        };
    } else if (type === "wiggly") {
        out.values = {
            mode: MCP.text.MODE_NAMES[Number(MCP.text.readValue(sel, "ADBE Text Selector Mode", "Mode"))] || null,
            maxAmount: MCP.text.readValue(sel, "ADBE Text Wiggly Max Amount", "Max Amount"),
            minAmount: MCP.text.readValue(sel, "ADBE Text Wiggly Min Amount", "Min Amount"),
            basedOn: MCP.text.BASED_ON_NAMES[Number(MCP.text.readValue(sel, "ADBE Text Range Type2", "Based On"))] || null,
            wigglesPerSecond: MCP.text.readValue(sel, "ADBE Text Temporal Freq", "Wiggles/Second"),
            correlation: MCP.text.readValue(sel, "ADBE Text Character Correlation", "Correlation"),
            temporalPhase: MCP.text.readValue(sel, "ADBE Text Temporal Phase", "Temporal Phase"),
            spatialPhase: MCP.text.readValue(sel, "ADBE Text Spatial Phase", "Spatial Phase"),
            lockDimensions: !!Number(MCP.text.readValue(sel, "ADBE Text Wiggly Lock Dim", "Lock Dimensions")),
            randomSeed: MCP.text.readValue(sel, "ADBE Text Wiggly Random Seed", "Random Seed")
        };
    } else {
        var ap = MCP.text.prop(sel, "ADBE Text Expressible Amount", "Amount");
        out.values = {
            basedOn: MCP.text.BASED_ON_NAMES[Number(MCP.text.readValue(sel, "ADBE Text Range Type2", "Based On"))] || null,
            amount: ap ? _mcpTry(function () { return MCP.serialize.rawValue(ap.value); }, null) : null
        };
        out.expression = ap ? _mcpTry(function () { return ap.expression; }, "") : "";
        out.expressionError = ap ? _mcpTry(function () { return ap.expressionError || ""; }, "") : "";
    }
    return out;
};

MCP.text.serializeAnimator = function (anim) {
    var props = MCP.text.animatorProps(anim);
    var sels = MCP.text.selectorsGroup(anim);
    var out = { index: anim.propertyIndex, name: anim.name, path: MCP.pathOf(anim).path, enabled: _mcpTry(function () { return anim.enabled; }, true), properties: [], selectors: [] };
    var i;
    for (i = 1; i <= props.numProperties; i++) {
        var p = props.property(i);
        out.properties.push({ name: p.name, matchName: p.matchName, path: MCP.pathOf(p).path, value: MCP.serialize.value(p), numKeys: _mcpTry(function () { return p.numKeys; }, 0) });
    }
    for (i = 1; i <= sels.numProperties; i++) { out.selectors.push(MCP.text.serializeSelector(sels.property(i))); }
    return out;
};

/** Adds an animated property to an animator, trying 2D then 3D array shapes. Returns the property or null. */
MCP.text.addAnimated = function (anim, matchName, value, notes) {
    var props = MCP.text.animatorProps(anim);
    var p = MCP.childProp(props, matchName);
    if (!p) {
        try { p = props.addProperty(matchName); } catch (e) { p = null; }
    }
    if (!p) { notes.push("Could not add animator property '" + matchName + "'."); return null; }
    if (MCP.isDefined(value)) {
        var ok = false;
        try { p.setValue(value); ok = true; } catch (e1) { ok = false; }
        if (!ok && MCP.isArray(value) && value.length === 2) {
            try { p.setValue([value[0], value[1], 0]); ok = true; } catch (e2) { ok = false; }
        }
        if (!ok && MCP.isArray(value) && value.length === 3) {
            try { p.setValue([value[0], value[1]]); ok = true; } catch (e3) { ok = false; }
        }
        if (!ok) { notes.push("Added '" + p.name + "' but could not set its value."); }
    }
    return p;
};

MCP.text.addRangeSelector = function (anim, name) {
    var sel = MCP.text.selectorsGroup(anim).addProperty("ADBE Text Selector");
    if (MCP.isDefined(name)) { sel.name = String(name); }
    return sel;
};

/** The first range selector on an animator, adding one if there is none. */
MCP.text.ensureRangeSelector = function (anim) {
    var sels = MCP.text.selectorsGroup(anim);
    for (var i = 1; i <= sels.numProperties; i++) {
        if (MCP.text.selectorType(sels.property(i)) === "range") { return sels.property(i); }
    }
    return MCP.text.addRangeSelector(anim);
};

MCP.text.keyPair = function (p, t0, v0, t1, v1, easing, keyframes) {
    var i0 = MCP.easing.setKey(p, t0, v0);
    var i1 = MCP.easing.setKey(p, t1, v1);
    MCP.easing.applySegment(p, i1, easing || "ease-out");
    var ka = MCP.easing.keyIndexAtTime(p, t0, 1e-3), kb = MCP.easing.keyIndexAtTime(p, t1, 1e-3);
    keyframes.push({ property: MCP.pathOf(p).path, keys: [MCP.serialize.keyframe(p, ka > 0 ? ka : i0), MCP.serialize.keyframe(p, kb > 0 ? kb : i1)] });
};

/**
 * Reveal scheme. The animator's values apply to units inside the selector range.
 *   forward:  Start 0 -> 100 (End 100). The range shrinks from the first unit, which finishes first.
 *   backward: End 100 -> 0 (Start 0). The last unit finishes first.
 *   center:   Start 50 -> 0 and End 50 -> 100 with mode subtract, so units outside the growing
 *             middle range stay affected and the middle finishes first.
 */
MCP.text.animateReveal = function (sel, ctx) {
    var units = MCP.text.currentUnits(sel);
    var sp = MCP.text.rangeProp(sel, "start", units), ep = MCP.text.rangeProp(sel, "end", units);
    if (!sp || !ep) { MCP.fail("The range selector has no Start/End properties to animate.", "script-error"); }
    var adv = MCP.childProp(sel, "ADBE Text Range Advanced") || sel;
    var dir = ctx.direction || "forward";
    if (dir === "backward") {
        sp.setValue(0);
        MCP.text.keyPair(ep, ctx.t0, 100, ctx.t1, 0, ctx.easing, ctx.keyframes);
    } else if (dir === "center") {
        MCP.text.setIf(adv, "ADBE Text Selector Mode", "Mode", 2, [], ctx.notes, "mode");
        MCP.text.keyPair(sp, ctx.t0, 50, ctx.t1, 0, ctx.easing, ctx.keyframes);
        MCP.text.keyPair(ep, ctx.t0, 50, ctx.t1, 100, ctx.easing, ctx.keyframes);
    } else {
        ep.setValue(100);
        MCP.text.keyPair(sp, ctx.t0, 0, ctx.t1, 100, ctx.easing, ctx.keyframes);
    }
    ctx.scheme = dir;
};

MCP.text.titleCase = function (s) {
    var parts = String(s).split("-"), out = [];
    for (var i = 0; i < parts.length; i++) { out.push(parts[i].charAt(0).toUpperCase() + parts[i].substring(1)); }
    return out.join(" ");
};

/* -------------------------------------------------------- animator presets */

/**
 * Each preset: { description, defaultBasedOn, params: {name: {default, description}}, build(anim, sel, p, ctx) }
 * ctx: { comp, layer, t0, t1, easing, direction, basedOn, amount, randomSeed, notes, keyframes }
 * build returns nothing; it records keys in ctx.keyframes and may set ctx.selector.
 */
MCP.textAnimatorPresets = {};

function _mcpTextRevealPreset(anim, sel, ctx) {
    MCP.text.setIf(MCP.childProp(sel, "ADBE Text Range Advanced") || sel, "ADBE Text Range Type2", "Based On", MCP.text.enumValue(MCP.text.BASED_ON, ctx.basedOn, "basedOn"), [], ctx.notes, "basedOn");
    MCP.text.animateReveal(sel, ctx);
}

MCP.textAnimatorPresets["fade-in-by-character"] = {
    description: "Each character fades from transparent to its normal opacity, one after another.",
    defaultBasedOn: "characters",
    params: {},
    build: function (anim, sel, p, ctx) {
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["fade-in-by-word"] = {
    description: "Each word fades in, one after another.",
    defaultBasedOn: "words",
    params: {},
    build: function (anim, sel, p, ctx) {
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["fade-in-by-line"] = {
    description: "Each line fades in, one after another.",
    defaultBasedOn: "lines",
    params: {},
    build: function (anim, sel, p, ctx) {
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["slide-up-by-character"] = {
    description: "Characters rise into place from below while fading in.",
    defaultBasedOn: "characters",
    params: { amount: { "default": 60, description: "Distance in pixels the characters start below their resting position." } },
    build: function (anim, sel, p, ctx) {
        MCP.text.addAnimated(anim, "ADBE Text Position 3D", [0, MCP.num(p.amount, 60)], ctx.notes);
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["slide-up-by-word"] = {
    description: "Words rise into place from below while fading in.",
    defaultBasedOn: "words",
    params: { amount: { "default": 60, description: "Distance in pixels the words start below their resting position." } },
    build: function (anim, sel, p, ctx) {
        MCP.text.addAnimated(anim, "ADBE Text Position 3D", [0, MCP.num(p.amount, 60)], ctx.notes);
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["scale-in-by-character"] = {
    description: "Characters grow from nothing to full size while fading in.",
    defaultBasedOn: "characters",
    params: { amount: { "default": 0, description: "Starting scale in percent (0 grows from nothing, 150 shrinks in)." } },
    build: function (anim, sel, p, ctx) {
        var s = MCP.num(p.amount, 0);
        MCP.text.addAnimated(anim, "ADBE Text Scale 3D", [s, s], ctx.notes);
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["blur-in-by-character"] = {
    description: "Characters sharpen from a blur while fading in.",
    defaultBasedOn: "characters",
    params: { amount: { "default": 30, description: "Starting blur in pixels, applied on both axes." } },
    build: function (anim, sel, p, ctx) {
        var b = MCP.num(p.amount, 30);
        MCP.text.addAnimated(anim, "ADBE Text Blur", [b, b], ctx.notes);
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["tracking-in"] = {
    description: "The whole text tightens from wide letter spacing to normal. Tracking Amount is keyframed directly; the selector is not animated.",
    defaultBasedOn: "characters",
    params: { amount: { "default": 60, description: "Starting tracking offset; 0 is the layer's own tracking." } },
    build: function (anim, sel, p, ctx) {
        var tp = MCP.text.addAnimated(anim, "ADBE Text Tracking Amount", MCP.num(p.amount, 60), ctx.notes);
        if (tp) { MCP.text.keyPair(tp, ctx.t0, MCP.num(p.amount, 60), ctx.t1, 0, ctx.easing, ctx.keyframes); }
        ctx.scheme = "tracking keyframed directly, selector static at 0 to 100";
    }
};
MCP.textAnimatorPresets["typewriter"] = {
    description: "Characters appear one at a time with hard edges, like typing. Start is keyed 0 to 100 with linear interpolation and a square selector shape.",
    defaultBasedOn: "characters",
    params: {},
    build: function (anim, sel, p, ctx) {
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        var adv = MCP.childProp(sel, "ADBE Text Range Advanced") || sel;
        MCP.text.setIf(adv, "ADBE Text Range Shape", "Shape", 1, [], ctx.notes, "shape");
        MCP.text.setIf(adv, "ADBE Text Selector Smoothness", "Smoothness", 0, [], ctx.notes, "smoothness");
        ctx.easing = "linear";
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["random-fade-in"] = {
    description: "Characters fade in in a random order.",
    defaultBasedOn: "characters",
    params: {},
    build: function (anim, sel, p, ctx) {
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        var adv = MCP.childProp(sel, "ADBE Text Range Advanced") || sel;
        MCP.text.setIf(adv, "ADBE Text Randomize Order", "Randomize Order", 1, [], ctx.notes, "randomizeOrder");
        if (MCP.isDefined(ctx.randomSeed)) { MCP.text.setIf(adv, "ADBE Text Random Seed", "Random Seed", Math.round(Number(ctx.randomSeed)), [], ctx.notes, "randomSeed"); }
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["rotate-in-by-character"] = {
    description: "Characters spin into place while fading in.",
    defaultBasedOn: "characters",
    params: { amount: { "default": 90, description: "Starting rotation in degrees." } },
    build: function (anim, sel, p, ctx) {
        MCP.text.addAnimated(anim, "ADBE Text Rotation", MCP.num(p.amount, 90), ctx.notes);
        MCP.text.addAnimated(anim, "ADBE Text Opacity", 0, ctx.notes);
        _mcpTextRevealPreset(anim, sel, ctx);
    }
};
MCP.textAnimatorPresets["wave-y-position"] = {
    description: "Characters bob up and down continuously through a wiggly selector on a vertical Position offset. No keyframes are written.",
    defaultBasedOn: "characters",
    params: { amount: { "default": 30, description: "Wave height in pixels." }, wigglesPerSecond: { "default": 1, description: "Speed of the wave." }, correlation: { "default": 75, description: "Percent. Higher values make neighbours move together, giving a smoother wave." } },
    build: function (anim, sel, p, ctx) {
        MCP.text.addAnimated(anim, "ADBE Text Position 3D", [0, MCP.num(p.amount, 30)], ctx.notes);
        var adv = MCP.childProp(sel, "ADBE Text Range Advanced") || sel;
        MCP.text.setIf(adv, "ADBE Text Range Type2", "Based On", MCP.text.enumValue(MCP.text.BASED_ON, ctx.basedOn, "basedOn"), [], ctx.notes, "basedOn");
        var w = MCP.text.selectorsGroup(anim).addProperty("ADBE Text Wiggly Selector");
        w.name = "Wave";
        MCP.text.setIf(w, "ADBE Text Temporal Freq", "Wiggles/Second", MCP.num(p.wigglesPerSecond, 1), [], ctx.notes, "wigglesPerSecond");
        MCP.text.setIf(w, "ADBE Text Character Correlation", "Correlation", MCP.num(p.correlation, 75), [], ctx.notes, "correlation");
        MCP.text.setIf(w, "ADBE Text Range Type2", "Based On", MCP.text.enumValue(MCP.text.BASED_ON, ctx.basedOn, "basedOn"), [], ctx.notes, "basedOn");
        if (MCP.isDefined(ctx.randomSeed)) { MCP.text.setIf(w, "ADBE Text Wiggly Random Seed", "Random Seed", Math.round(Number(ctx.randomSeed)), [], ctx.notes, "randomSeed"); }
        ctx.selector = w;
        ctx.scheme = "continuous wiggly selector, no keyframes";
    }
};

MCP.text.SCHEME_TEXT = "The animator's values apply to units inside the selector range. forward keys Start 0 to 100 (End 100) so the first unit finishes first. backward keys End 100 to 0 (Start 0) so the last unit finishes first. center keys Start 50 to 0 and End 50 to 100 with the selector in subtract mode so the middle finishes first. tracking-in keys Tracking Amount directly. wave-y-position uses a wiggly selector and writes no keys.";

MCP.register("listTextAnimatorPresets", function () {
    var out = [];
    var names = MCP.keys(MCP.textAnimatorPresets);
    names.sort();
    for (var i = 0; i < names.length; i++) {
        var t = MCP.textAnimatorPresets[names[i]];
        var params = [];
        for (var k in t.params) {
            if (Object.prototype.hasOwnProperty.call(t.params, k)) { params.push({ name: k, defaultValue: t.params[k]["default"], description: t.params[k].description }); }
        }
        out.push({ name: names[i], description: t.description, defaultBasedOn: t.defaultBasedOn, params: params });
    }
    return { count: out.length, presets: out, scheme: MCP.text.SCHEME_TEXT };
}, { mutating: false });

MCP.register("addTextAnimator", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var presetName = String(MCP.requireArg(args, "preset"));
    var preset = MCP.textAnimatorPresets[presetName];
    if (!preset) { MCP.fail("Unknown text animator preset '" + presetName + "'. Available: " + MCP.keys(MCP.textAnimatorPresets).sort().join(", "), "not-found"); }
    var animators = MCP.text.animatorsGroup(layer);
    var anim = animators.addProperty("ADBE Text Animator");
    anim.name = MCP.isDefined(args.name) ? String(args.name) : MCP.text.titleCase(presetName);
    var delay = MCP.durationArg(comp, args, "delay", "delayFrames", 0);
    var duration = MCP.durationArg(comp, args, "duration", "durationFrames", 1);
    if (duration <= 0) { MCP.fail("duration must be greater than 0.", "invalid-argument"); }
    var t0 = layer.inPoint + delay, t1 = t0 + duration;
    var ctx = {
        comp: comp, layer: layer, t0: t0, t1: t1,
        easing: MCP.isDefined(args.easing) ? args.easing : "ease-out",
        direction: MCP.arg(args, "direction", "forward"),
        basedOn: MCP.arg(args, "basedOn", preset.defaultBasedOn),
        randomSeed: args.randomSeed,
        notes: [], keyframes: [], selector: null, scheme: null
    };
    var params = {};
    if (MCP.isDefined(args.amount)) { params.amount = Number(args.amount); }
    var sel = MCP.text.ensureRangeSelector(anim);
    preset.build(anim, sel, params, ctx);
    var selector = ctx.selector || sel;
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layerRef(layer),
        preset: presetName,
        animator: MCP.text.serializeAnimator(anim),
        animatorPath: MCP.pathOf(anim).path,
        selectorPath: MCP.pathOf(selector).path,
        startTime: MCP.round(t0), endTime: MCP.round(t1),
        startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        direction: ctx.direction, basedOn: ctx.basedOn, scheme: ctx.scheme,
        keyframes: ctx.keyframes,
        notes: ctx.notes
    };
}, { mutating: true });

MCP.register("addTextRangeSelector", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var anim = MCP.text.resolveAnimator(r.layer, args.animator);
    var sel = MCP.text.addRangeSelector(anim, args.name);
    var notes = [];
    var res = MCP.text.applyRangeSettings(sel, args, r.comp, notes);
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        animator: { index: anim.propertyIndex, name: anim.name, path: MCP.pathOf(anim).path },
        selector: MCP.text.serializeSelector(sel), selectorPath: MCP.pathOf(sel).path,
        changed: res.changed, notes: notes
    };
}, { mutating: true });

MCP.register("setRangeSelector", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var anim = MCP.text.resolveAnimator(r.layer, args.animator);
    var sels = MCP.text.selectorsGroup(anim);
    var idx = Math.round(MCP.num(args.selector, 1));
    var sel = _mcpTry(function () { return sels.property(idx); }, null);
    if (!sel) { MCP.fail("Animator '" + anim.name + "' has no selector " + idx + ". Selectors: " + (MCP.childNames(sels).join(", ") || "(none)"), "not-found", { selectors: MCP.childNames(sels) }); }
    if (MCP.text.selectorType(sel) !== "range") { MCP.fail("Selector " + idx + " on '" + anim.name + "' is a " + MCP.text.selectorType(sel) + " selector, not a range selector.", "invalid-argument"); }
    var notes = [];
    var res = MCP.text.applyRangeSettings(sel, args, r.comp, notes);
    if (MCP.isDefined(args.name)) { sel.name = String(args.name); res.changed.push("name"); }
    if (!res.changed.length) { MCP.fail("No selector fields given. Use start, end, offset, units, basedOn, mode, amount, shape, smoothness, easeHigh, easeLow, randomizeOrder or randomSeed.", "invalid-argument"); }
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        animator: { index: anim.propertyIndex, name: anim.name, path: MCP.pathOf(anim).path },
        selector: MCP.text.serializeSelector(sel), selectorPath: MCP.pathOf(sel).path,
        changed: res.changed, keyframes: res.keyframes, notes: notes
    };
}, { mutating: true });

MCP.register("addTextWigglySelector", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var anim = MCP.text.resolveAnimator(r.layer, args.animator);
    var w = MCP.text.selectorsGroup(anim).addProperty("ADBE Text Wiggly Selector");
    if (MCP.isDefined(args.name)) { w.name = String(args.name); }
    var changed = [], notes = [];
    if (MCP.isDefined(args.mode)) { MCP.text.setIf(w, "ADBE Text Selector Mode", "Mode", MCP.text.enumValue(MCP.text.MODES, args.mode, "mode"), changed, notes, "mode"); }
    MCP.text.setIf(w, "ADBE Text Wiggly Max Amount", "Max Amount", MCP.isDefined(args.maxAmount) ? Number(args.maxAmount) : undefined, changed, notes, "maxAmount");
    MCP.text.setIf(w, "ADBE Text Wiggly Min Amount", "Min Amount", MCP.isDefined(args.minAmount) ? Number(args.minAmount) : undefined, changed, notes, "minAmount");
    if (MCP.isDefined(args.basedOn)) { MCP.text.setIf(w, "ADBE Text Range Type2", "Based On", MCP.text.enumValue(MCP.text.BASED_ON, args.basedOn, "basedOn"), changed, notes, "basedOn"); }
    MCP.text.setIf(w, "ADBE Text Temporal Freq", "Wiggles/Second", MCP.isDefined(args.wigglesPerSecond) ? Number(args.wigglesPerSecond) : undefined, changed, notes, "wigglesPerSecond");
    MCP.text.setIf(w, "ADBE Text Character Correlation", "Correlation", MCP.isDefined(args.correlation) ? Number(args.correlation) : undefined, changed, notes, "correlation");
    MCP.text.setIf(w, "ADBE Text Temporal Phase", "Temporal Phase", MCP.isDefined(args.temporalPhase) ? Number(args.temporalPhase) : undefined, changed, notes, "temporalPhase");
    MCP.text.setIf(w, "ADBE Text Spatial Phase", "Spatial Phase", MCP.isDefined(args.spatialPhase) ? Number(args.spatialPhase) : undefined, changed, notes, "spatialPhase");
    MCP.text.setIf(w, "ADBE Text Wiggly Lock Dim", "Lock Dimensions", MCP.isDefined(args.lockDimensions) ? (MCP.bool(args.lockDimensions, false) ? 1 : 0) : undefined, changed, notes, "lockDimensions");
    MCP.text.setIf(w, "ADBE Text Wiggly Random Seed", "Random Seed", MCP.isDefined(args.randomSeed) ? Math.round(Number(args.randomSeed)) : undefined, changed, notes, "randomSeed");
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        animator: { index: anim.propertyIndex, name: anim.name, path: MCP.pathOf(anim).path },
        selector: MCP.text.serializeSelector(w), selectorPath: MCP.pathOf(w).path,
        changed: changed, notes: notes
    };
}, { mutating: true });

MCP.register("addTextExpressionSelector", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var anim = MCP.text.resolveAnimator(r.layer, args.animator);
    var expr = String(MCP.requireArg(args, "expression"));
    var sel = MCP.text.selectorsGroup(anim).addProperty("ADBE Text Expressible Selector");
    if (MCP.isDefined(args.name)) { sel.name = String(args.name); }
    var notes = [];
    if (MCP.isDefined(args.basedOn)) { MCP.text.setIf(sel, "ADBE Text Range Type2", "Based On", MCP.text.enumValue(MCP.text.BASED_ON, args.basedOn, "basedOn"), [], notes, "basedOn"); }
    var amount = MCP.text.prop(sel, "ADBE Text Expressible Amount", "Amount");
    if (!amount) { MCP.fail("The expression selector has no Amount property to hold the expression.", "script-error"); }
    if (!amount.canSetExpression) { MCP.fail("The selector Amount property does not accept expressions in this version.", "unsupported"); }
    amount.expression = expr;
    var state = {
        hasExpression: amount.expression !== "",
        expression: amount.expression,
        enabled: _mcpTry(function () { return amount.expressionEnabled; }, null),
        error: _mcpTry(function () { return amount.expressionError || ""; }, "")
    };
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        animator: { index: anim.propertyIndex, name: anim.name, path: MCP.pathOf(anim).path },
        selector: MCP.text.serializeSelector(sel), selectorPath: MCP.pathOf(sel).path,
        amountPath: MCP.pathOf(amount).path, expressionState: state, notes: notes
    };
}, { mutating: true });

/* ------------------------------------------------------ outlines and boxes */

MCP.register("convertTextToShapes", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    if (!(layer instanceof TextLayer)) { MCP.fail("Layer '" + layer.name + "' is not a text layer.", "invalid-argument"); }
    var id = 0;
    try { id = app.findMenuCommandId("Create Shapes from Text"); } catch (e0) { id = 0; }
    if (!id) { MCP.fail("The 'Create Shapes from Text' menu command is not available in this After Effects.", "unsupported"); }
    var before = comp.numLayers;
    var srcName = layer.name;
    try { comp.openInViewer(); } catch (e1) {}
    var i;
    for (i = 1; i <= comp.numLayers; i++) { try { comp.layer(i).selected = false; } catch (e2) {} }
    layer.selected = true;
    try { app.executeCommand(id); } catch (e3) { MCP.fail("Create Shapes from Text failed: " + e3.toString(), "script-error"); }
    if (comp.numLayers <= before) { MCP.fail("Create Shapes from Text produced no new layer. Make sure the composition is open in the viewer and the font has outline data.", "script-error"); }
    var outlines = null;
    var wanted = srcName + " Outlines";
    for (i = 1; i <= comp.numLayers && !outlines; i++) {
        var L = comp.layer(i);
        if (L instanceof ShapeLayer && L.name === wanted) { outlines = L; }
    }
    if (!outlines) {
        for (i = 1; i <= comp.numLayers && !outlines; i++) {
            var L2 = comp.layer(i);
            if (L2 instanceof ShapeLayer && L2.selected) { outlines = L2; }
        }
    }
    if (!outlines) { MCP.fail("A new layer was created but the outlines layer could not be identified. Expected a shape layer named '" + wanted + "'.", "script-error"); }
    if (MCP.bool(args.keepSource, false)) { layer.enabled = true; }
    var groups = _mcpTry(function () { return outlines.property("ADBE Root Vectors Group").numProperties; }, 0);
    var src = MCP.serialize.layerRef(layer);
    src.enabled = layer.enabled;
    return { composition: MCP.serialize.compRef(comp), sourceLayer: src, shapeLayer: MCP.serialize.layer(outlines), groupCount: groups };
}, { mutating: true });

MCP.register("setTextBox", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.textDocProp(r.layer);
    if (!MCP.isArray(args.boxSize) && !MCP.bool(args.pointText, false)) { MCP.fail("Give boxSize [width, height] or pointText true.", "invalid-argument"); }
    var doc = prop.value;
    var changed = [];
    var wasBox = _mcpTry(function () { return !!doc.boxText; }, false);
    if (MCP.bool(args.pointText, false)) {
        if (wasBox) {
            try { doc.boxText = false; } catch (e0) {}
            changed.push("boxText");
        }
    } else {
        if (!wasBox) {
            try { doc.boxText = true; } catch (e1) {}
            changed.push("boxText");
        }
        try { doc.boxTextSize = [Math.round(Number(args.boxSize[0])), Math.round(Number(args.boxSize[1]))]; changed.push("boxTextSize"); }
        catch (e2) { MCP.fail("boxTextSize could not be set: " + e2.toString(), "unsupported"); }
    }
    if (prop.numKeys > 0) { prop.setValueAtTime(r.comp.time, doc); } else { prop.setValue(doc); }
    var after = prop.value;
    var isBox = _mcpTry(function () { return !!after.boxText; }, false);
    var wantBox = !MCP.bool(args.pointText, false);
    if (isBox !== wantBox) {
        MCP.fail("This After Effects version does not let scripts switch between point and box text (TextDocument.boxText is read-only here). Create a new layer with create-text-layer and boxSize, then copy the style with set-text-style.", "unsupported");
    }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), changed: changed, textDocument: MCP.serialize.textDocument(after) };
}, { mutating: true });
