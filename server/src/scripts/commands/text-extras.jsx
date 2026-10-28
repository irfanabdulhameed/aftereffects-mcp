/*
 * More text commands: text on a mask path, per-character 3D reveals, a box
 * or pill that always fits the text, and fitting the font size to a box.
 *
 * This file loads before text.jsx (files are concatenated by path), so it
 * keeps its helpers under MCP.textExtras and only calls MCP.text, MCP.masks
 * and MCP.styles at run time.
 */

MCP.textExtras = {};

MCP.textExtras.TRAVEL_EASE = { type: "custom", outSpeed: 0, outInfluence: 40, inSpeed: 0, inInfluence: 75 };
MCP.textExtras.REVEAL_EASE = { type: "custom", outSpeed: 0, outInfluence: 30, inSpeed: 0, inInfluence: 80 };

MCP.textExtras.requireText = function (layer) {
    if (!(layer instanceof TextLayer)) { MCP.fail("Layer '" + layer.name + "' is not a text layer.", "invalid-argument"); }
};

MCP.textExtras.textProps = function (layer) {
    return layer.property("ADBE Text Properties");
};

/** Reads the TextDocument at time t (keyed Source Text) or the static value. */
MCP.textExtras.readDoc = function (prop, t) {
    return prop.numKeys > 0 ? prop.valueAtTime(t, false) : prop.value;
};

MCP.textExtras.writeDoc = function (prop, t, doc) {
    if (prop.numKeys > 0) { prop.setValueAtTime(t, doc); } else { prop.setValue(doc); }
};

MCP.textExtras.quote = function (s) {
    return "\"" + String(s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
};

/* ------------------------------------------------------------ text on path */

MCP.textExtras.pathOptions = function (layer) {
    var po = _mcpTry(function () { return MCP.textExtras.textProps(layer).property("ADBE Text Path Options"); }, null);
    if (!po) { MCP.fail("Layer '" + layer.name + "' has no Path Options group.", "unsupported"); }
    return po;
};

/** The Path menu of Path Options (a mask index; 0 is None). */
MCP.textExtras.pathMenu = function (layer) {
    var po = MCP.textExtras.pathOptions(layer);
    var p = MCP.childProp(po, "ADBE Text Path");
    if (p) { return p; }
    for (var i = 1; i <= po.numProperties; i++) {
        var c = po.property(i);
        if (_mcpTry(function () { return c.propertyValueType === PropertyValueType.MASK_INDEX; }, false)) { return c; }
    }
    MCP.fail("The Path property under Path Options was not found. Children: " + MCP.childNames(po).join(", "), "unsupported");
    return null;
};

MCP.textExtras.pathOption = function (layer, matchName) {
    return MCP.childProp(MCP.textExtras.pathOptions(layer), matchName);
};

/** Approximate length of a mask Shape in pixels (each bezier segment sampled 24 times). */
MCP.textExtras.pathLength = function (shape) {
    var v = shape.vertices, ti = shape.inTangents, to = shape.outTangents, n = v.length;
    if (n < 2) { return 0; }
    var segs = shape.closed ? n : n - 1, total = 0, s, k;
    for (s = 0; s < segs; s++) {
        var a = v[s], b = v[(s + 1) % n];
        var c1 = [a[0] + (to[s] ? to[s][0] : 0), a[1] + (to[s] ? to[s][1] : 0)];
        var c2 = [b[0] + (ti[(s + 1) % n] ? ti[(s + 1) % n][0] : 0), b[1] + (ti[(s + 1) % n] ? ti[(s + 1) % n][1] : 0)];
        var px = a[0], py = a[1];
        for (k = 1; k <= 24; k++) {
            var t = k / 24, mt = 1 - t;
            var x = mt * mt * mt * a[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * b[0];
            var y = mt * mt * mt * a[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * b[1];
            total += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
            px = x; py = y;
        }
    }
    return total;
};

MCP.textExtras.setFlag = function (layer, matchName, value, label, changed, notes) {
    if (!MCP.isDefined(value)) { return; }
    var p = MCP.textExtras.pathOption(layer, matchName);
    if (!p) { notes.push("Path option '" + label + "' not found; skipped."); return; }
    try { p.setValue(MCP.bool(value, false) ? 1 : 0); changed.push(label); } catch (e) { notes.push("Could not set " + label + ": " + e.toString()); }
};

MCP.textExtras.readOption = function (layer, matchName, asBool) {
    var p = MCP.textExtras.pathOption(layer, matchName);
    if (!p) { return null; }
    return _mcpTry(function () { return asBool ? !!Number(p.value) : MCP.round(Number(p.value)); }, null);
};

MCP.register("setTextOnPath", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    MCP.textExtras.requireText(layer);
    var notes = [], changed = [];
    var t = comp.time;
    var menu = MCP.textExtras.pathMenu(layer);
    var currentIdx = _mcpTry(function () { return Math.round(Number(menu.value)); }, 0);

    // Measure the straight text width before the path bends it.
    var textWidth = null;
    if (currentIdx > 0) {
        try { menu.setValue(0); textWidth = layer.sourceRectAtTime(t, false).width; } catch (e0) { textWidth = null; }
        try { MCP.textExtras.pathMenu(layer).setValue(currentIdx); } catch (e1) {}
        if (textWidth === null) { notes.push("The text width could not be measured without the path; the travel end uses the bounds on the path."); }
    }
    if (textWidth === null) { textWidth = _mcpTry(function () { return layer.sourceRectAtTime(t, false).width; }, 0); }

    var maskGroup = MCP.masks.group(layer);
    var mask = null, created = false, shapeLayer = null;
    if (MCP.isDefined(args.mask)) {
        mask = MCP.masks.resolve(layer, args.mask);
    } else if (args.fromShapeLayer && MCP.isDefined(args.fromShapeLayer.layer)) {
        var made = MCP.invoke("createMaskFromShapeLayer", {
            comp: { id: comp.id }, layer: { index: layer.index }, shapeLayer: args.fromShapeLayer.layer,
            group: args.fromShapeLayer.group, mode: "none", name: args.maskName
        });
        mask = MCP.masks.resolve(layer, made.mask.index);
        created = true;
        shapeLayer = MCP.resolveLayer(comp, args.fromShapeLayer.layer);
        if (made.notes && made.notes.length) { notes = notes.concat(made.notes); }
        if (MCP.bool(args.fromShapeLayer.hide, false)) { shapeLayer.enabled = false; changed.push("shapeLayerHidden"); }
    } else if (currentIdx > 0 && currentIdx <= maskGroup.numProperties) {
        mask = maskGroup.property(currentIdx);
    } else if (maskGroup.numProperties === 1) {
        mask = maskGroup.property(1);
    } else if (maskGroup.numProperties === 0) {
        MCP.fail("Layer '" + layer.name + "' has no masks. Pass fromShapeLayer, or draw one with create-mask (an ellipse for a circle) and pass mask.", "not-found");
    } else {
        MCP.fail("Layer '" + layer.name + "' has " + maskGroup.numProperties + " masks; pass mask by name or index. Masks: " + MCP.childNames(maskGroup).join(", "), "ambiguous", { masks: MCP.childNames(maskGroup) });
    }

    var shapeVal = _mcpTry(function () { return MCP.childProp(mask, "ADBE Mask Shape").valueAtTime(t, false); }, null);
    var closed = shapeVal ? !!shapeVal.closed : false;
    if (!MCP.bool(args.keepMaskMode, false) && mask.maskMode !== MaskMode.NONE) {
        mask.maskMode = MaskMode.NONE;
        notes.push("Mask '" + mask.name + "' was set to mode None so it guides the text without cutting it.");
    }

    MCP.textExtras.pathMenu(layer).setValue(mask.propertyIndex);
    changed.push("path");

    MCP.textExtras.setFlag(layer, "ADBE Text Perpendicular To Path", args.perpendicular, "perpendicular", changed, notes);
    MCP.textExtras.setFlag(layer, "ADBE Text Force Align Path", args.forceAlignment, "forceAlignment", changed, notes);
    MCP.textExtras.setFlag(layer, "ADBE Text Reverse Path", args.reversePath, "reversePath", changed, notes);

    var travel = args.travel && typeof args.travel === "object" ? args.travel : null;
    var just = MCP.isDefined(args.justification) ? String(args.justification) : (travel ? "left" : null);
    if (just) {
        var tdp = MCP.textDocProp(layer);
        var doc = MCP.textExtras.readDoc(tdp, t);
        var want = MCP.justificationValue(just);
        if (doc.justification !== want) {
            doc.justification = want;
            MCP.textExtras.writeDoc(tdp, t, doc);
            changed.push("justification");
            if (!MCP.isDefined(args.justification)) { notes.push("Justification was set to left so First Margin measures from the path start."); }
        }
    }

    var margins = [{ key: "firstMargin", mn: "ADBE Text First Margin" }, { key: "lastMargin", mn: "ADBE Text Last Margin" }];
    for (var m = 0; m < margins.length; m++) {
        if (!MCP.isDefined(args[margins[m].key])) { continue; }
        var mp = MCP.textExtras.pathOption(layer, margins[m].mn);
        if (!mp) { notes.push(margins[m].key + " not found; skipped."); continue; }
        if (mp.numKeys > 0) { mp.setValueAtTime(t, Number(args[margins[m].key])); } else { mp.setValue(Number(args[margins[m].key])); }
        changed.push(margins[m].key);
    }

    var pathLength = shapeVal ? MCP.textExtras.pathLength(shapeVal) : null;
    var travelOut = null;
    if (travel) {
        var fm = MCP.textExtras.pathOption(layer, "ADBE Text First Margin");
        if (!fm) { MCP.fail("First Margin was not found under Path Options.", "unsupported"); }
        var t0 = MCP.durationArg(comp, travel, "startTime", "startFrame", layer.inPoint);
        var dur = MCP.durationArg(comp, travel, "duration", "durationFrames", 2);
        if (dur <= 0) { MCP.fail("travel duration must be greater than 0.", "invalid-argument"); }
        var t1 = t0 + dur;
        var from = MCP.num(travel.from, 0);
        var to = MCP.isDefined(travel.to) ? Number(travel.to) : Math.max(0, (pathLength || 0) - (textWidth || 0));
        if (!MCP.isDefined(travel.to) && closed) { notes.push("On a closed path the default end is one path length minus the text width; the text stops just before the start point."); }
        if (fm.numKeys > 0) { while (fm.numKeys > 0) { fm.removeKey(1); } notes.push("Existing First Margin keys were replaced."); }
        MCP.easing.setKey(fm, t0, from);
        var k1 = MCP.easing.setKey(fm, t1, to);
        MCP.easing.applySegment(fm, k1, MCP.isDefined(travel.easing) ? travel.easing : MCP.textExtras.TRAVEL_EASE);
        travelOut = {
            from: MCP.round(from), to: MCP.round(to), property: MCP.pathOf(fm).path,
            startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
            keys: [MCP.serialize.keyframe(fm, 1), MCP.serialize.keyframe(fm, 2)]
        };
        changed.push("travel");
    }

    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer),
        mask: MCP.masks.serialize(mask), createdMask: created, shapeLayer: shapeLayer ? MCP.serialize.layerRef(shapeLayer) : null,
        pathIndex: mask.propertyIndex, pathClosed: closed,
        pathLength: pathLength === null ? null : MCP.round(pathLength, 1), textWidth: textWidth === null ? null : MCP.round(textWidth, 1),
        options: {
            perpendicular: MCP.textExtras.readOption(layer, "ADBE Text Perpendicular To Path", true),
            forceAlignment: MCP.textExtras.readOption(layer, "ADBE Text Force Align Path", true),
            reversePath: MCP.textExtras.readOption(layer, "ADBE Text Reverse Path", true),
            firstMargin: MCP.textExtras.readOption(layer, "ADBE Text First Margin", false),
            lastMargin: MCP.textExtras.readOption(layer, "ADBE Text Last Margin", false)
        },
        changed: changed, travel: travelOut, notes: notes
    };
}, { mutating: true });

/* ------------------------------------------------------- per-character 3D */

MCP.textExtras.POSES = {
    "flip-x": { rotationX: -90, opacity: 0 },
    "flip-y": { rotationY: 90, opacity: 0 },
    "tumble": { rotationX: -70, rotationY: 30, rotationZ: -25, positionZ: -120, opacity: 0 },
    "push-z": { positionZ: 400, opacity: 0 }
};

MCP.textExtras.POSE_PROPS = [
    { key: "positionZ", mn: "ADBE Text Position 3D" },
    { key: "rotationX", mn: "ADBE Text Rotation X" },
    { key: "rotationY", mn: "ADBE Text Rotation Y" },
    { key: "rotationZ", mn: "ADBE Text Rotation" },
    { key: "opacity", mn: "ADBE Text Opacity" }
];

MCP.textExtras.BASED_ON = { "characters": 1, "characters-excluding-spaces": 2, "words": 3, "lines": 4 };

/** Adds one animator property and sets it, re-fetching the group each time (references go stale after addProperty). */
MCP.textExtras.addAnimatorProp = function (animators, animIndex, matchName, value, notes) {
    // After Effects lists every animator property in this group before it is added, but only added ones take
    // effect, so always add (adding an active one is harmless) and fetch the group again afterwards.
    var props = animators.property(animIndex).property("ADBE Text Animator Properties");
    try { props.addProperty(matchName); } catch (e0) { notes.push("Could not add animator property " + matchName + ": " + e0.toString()); return null; }
    props = animators.property(animIndex).property("ADBE Text Animator Properties");
    var p = MCP.childProp(props, matchName);
    if (!p) { notes.push("Animator property " + matchName + " not found after adding it."); return null; }
    try { p.setValue(value); } catch (e1) {
        var ok = false;
        if (MCP.isArray(value) && value.length === 3) { try { p.setValue([value[0], value[1]]); ok = true; notes.push(matchName + " took a 2D value; per-character 3D may not be on."); } catch (e2) { ok = false; } }
        if (!ok) { notes.push("Could not set " + matchName + ": " + e1.toString()); }
    }
    return p;
};

MCP.register("setPerCharacter3d", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    MCP.textExtras.requireText(layer);
    var notes = [];
    var enable = MCP.bool(args.enabled, true);
    var wasPerChar = _mcpTry(function () { return !!layer.threeDPerChar; }, false);
    if (!enable) {
        if (args.reveal) { MCP.fail("A reveal needs per-character 3D on.", "invalid-argument"); }
        try { layer.threeDPerChar = false; } catch (e0) { MCP.fail("Could not switch per-character 3D off: " + e0.toString(), "unsupported"); }
        return { composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layer(layer), threeDPerChar: false, changed: wasPerChar, animator: null, notes: notes };
    }
    if (!wasPerChar) {
        try { layer.threeDPerChar = true; } catch (e1) {
            try { layer.threeDLayer = true; layer.threeDPerChar = true; } catch (e2) { MCP.fail("Could not turn per-character 3D on: " + e2.toString(), "unsupported"); }
        }
        if (!_mcpTry(function () { return !!layer.threeDPerChar; }, false)) { MCP.fail("Per-character 3D did not switch on for '" + layer.name + "'.", "unsupported"); }
    }
    var renderer = _mcpTry(function () { return comp.renderer; }, null);
    if (renderer && renderer !== "ADBE Advanced 3d") { notes.push("The comp renders with '" + renderer + "'. Per-character 3D is tested with Classic 3D; Cinema 4D turns motion blur off."); }

    var out = {
        composition: MCP.serialize.compRef(comp), threeDPerChar: true, changed: !wasPerChar,
        animator: null, animatorPath: null, selectorPath: null, keyframes: [], pose: null, preset: null, pivot: null, notes: notes
    };
    var rv = args.reveal;
    if (!rv || typeof rv !== "object") { out.layer = MCP.serialize.layer(layer); return out; }

    var explicit = {}, anyExplicit = false, i;
    for (i = 0; i < MCP.textExtras.POSE_PROPS.length; i++) {
        var key = MCP.textExtras.POSE_PROPS[i].key;
        if (MCP.isDefined(rv[key])) { explicit[key] = Number(rv[key]); anyExplicit = true; }
    }
    var preset = MCP.isDefined(rv.preset) ? String(rv.preset) : (anyExplicit ? null : "flip-x");
    if (preset && !MCP.textExtras.POSES[preset]) { MCP.fail("Unknown preset '" + preset + "'. Use " + MCP.keys(MCP.textExtras.POSES).join(", ") + ".", "invalid-argument"); }
    var pose = MCP.extend(MCP.extend({}, preset ? MCP.textExtras.POSES[preset] : {}), explicit);

    var pivot = MCP.isDefined(rv.pivot) ? String(rv.pivot) : "center";
    if (pivot === "center") {
        var align = MCP.findProp(MCP.textExtras.textProps(layer), "ADBE Text Anchor Point Align");
        if (align) { try { align.setValue([0, -50]); } catch (e3) { notes.push("Could not set Grouping Alignment: " + e3.toString()); } }
        else { notes.push("More Options > Grouping Alignment not found; characters turn around their baseline."); }
    }

    var animators = MCP.textExtras.textProps(layer).property("ADBE Text Animators");
    var added = animators.addProperty("ADBE Text Animator");
    var animIndex = added.propertyIndex;
    animators.property(animIndex).name = MCP.isDefined(rv.name) ? String(rv.name) : "3D " + (preset ? preset : "Reveal");
    for (i = 0; i < MCP.textExtras.POSE_PROPS.length; i++) {
        var pp = MCP.textExtras.POSE_PROPS[i];
        if (!MCP.isDefined(pose[pp.key])) { continue; }
        var val = pp.key === "positionZ" ? [0, 0, pose.positionZ] : pose[pp.key];
        MCP.textExtras.addAnimatorProp(animators, animIndex, pp.mn, val, notes);
    }

    animators.property(animIndex).property("ADBE Text Selectors").addProperty("ADBE Text Selector");
    var selIndex = animators.property(animIndex).property("ADBE Text Selectors").numProperties;
    var sel = animators.property(animIndex).property("ADBE Text Selectors").property(selIndex);
    var adv = MCP.childProp(sel, "ADBE Text Range Advanced") || sel;
    var dir = MCP.isDefined(rv.direction) ? String(rv.direction) : "forward";
    var basedOn = MCP.isDefined(rv.basedOn) ? String(rv.basedOn) : "characters";
    if (!MCP.isDefined(MCP.textExtras.BASED_ON[basedOn])) { MCP.fail("Unknown basedOn '" + basedOn + "'.", "invalid-argument"); }
    var setAdv = function (mn, v, label) {
        var p = MCP.childProp(adv, mn);
        if (!p) { notes.push(label + " not found on the range selector; skipped."); return; }
        try { p.setValue(v); } catch (e) { notes.push("Could not set " + label + ": " + e.toString()); }
    };
    setAdv("ADBE Text Range Type2", MCP.textExtras.BASED_ON[basedOn], "Based On");
    setAdv("ADBE Text Range Shape", dir === "backward" ? 3 : 2, "Shape");
    setAdv("ADBE Text Levels Max Ease", 50, "Ease High");
    setAdv("ADBE Text Levels Min Ease", 50, "Ease Low");

    sel = animators.property(animIndex).property("ADBE Text Selectors").property(selIndex);
    var offset = MCP.childProp(sel, "ADBE Text Percent Offset");
    if (!offset) { MCP.fail("The range selector has no Offset property to key.", "script-error"); }
    var t0 = MCP.durationArg(comp, rv, "startTime", "startFrame", layer.inPoint);
    var dur = MCP.durationArg(comp, rv, "duration", "durationFrames", 1);
    if (dur <= 0) { MCP.fail("reveal duration must be greater than 0.", "invalid-argument"); }
    var t1 = t0 + dur;
    var v0 = dir === "backward" ? 100 : -100, v1 = -v0;
    MCP.easing.setKey(offset, t0, v0);
    var k1 = MCP.easing.setKey(offset, t1, v1);
    MCP.easing.applySegment(offset, k1, MCP.isDefined(rv.easing) ? rv.easing : MCP.textExtras.REVEAL_EASE);

    var anim = animators.property(animIndex);
    out.layer = MCP.serialize.layer(layer);
    out.animator = MCP.text.serializeAnimator(anim);
    out.animatorPath = MCP.pathOf(anim).path;
    out.selectorPath = MCP.pathOf(sel).path;
    out.keyframes = [{ property: MCP.pathOf(offset).path, keys: [MCP.serialize.keyframe(offset, 1), MCP.serialize.keyframe(offset, 2)] }];
    out.pose = pose;
    out.preset = preset;
    out.pivot = pivot;
    out.direction = dir;
    out.basedOn = basedOn;
    out.startTime = MCP.round(t0); out.endTime = MCP.round(t1);
    out.startFrame = MCP.frameOf(comp, t0); out.endFrame = MCP.frameOf(comp, t1);
    out.scheme = (dir === "backward" ? "Ramp Down, Offset 100 to -100" : "Ramp Up, Offset -100 to 100") + ": the animator holds the starting pose and each unit settles as the ramp passes it.";
    return out;
}, { mutating: true });

/* ----------------------------------------------------------------- text box */

/** Builds the Size, Position and Roundness expressions for a box around text layer `name`. */
MCP.textExtras.boxExpressions = function (name, o) {
    var head = [
        "var t = thisComp.layer(" + MCP.textExtras.quote(name) + ");",
        "var r = t.sourceRectAtTime(time, false);",
        "var px = " + o.px + ", py = " + o.py + ";",
        "var x = r.left, w = r.width, y = r.top, h = r.height;"
    ];
    if (o.heightFrom === "font") {
        head.push("var st = t.text.sourceText.style;");
        head.push("var fs = st.fontSize;");
        head.push("var lines = (\"\" + t.text.sourceText).split(/\\r\\n|\\r|\\n|\\u0003/).length;");
        head.push("var lead = st.autoLeading ? fs * 1.2 : st.leading;");
        head.push("var capH = fs * " + o.capHeight + ";");
        head.push("y = -capH; h = capH + (lines - 1) * lead;");
    }
    head.push("var W = Math.max(w + 2 * px, " + o.minWidth + "), H = h + 2 * py;");
    var base = head.join("\n") + "\n";
    var pos = o.link === "expression"
        ? base + "var p = t.toComp([x + w / 2, y + h / 2]);\n[p[0], p[1]]"
        : base + "[x + w / 2, y + h / 2]";
    var round = o.pill ? base + "Math.min(W, H) / 2" : base + "Math.min(" + o.radius + ", Math.min(W, H) / 2)";
    return { size: base + "[W, H]", position: pos, roundness: round };
};

MCP.textExtras.setExpression = function (prop, expr, label, errors) {
    try {
        prop.expression = expr;
        var err = _mcpTry(function () { return prop.expressionError || ""; }, "");
        if (err) { errors.push({ property: label, error: err }); }
    } catch (e) {
        errors.push({ property: label, error: e.toString() });
    }
};

MCP.register("addTextBox", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, text = r.layer;
    MCP.textExtras.requireText(text);
    var notes = [], errors = [];
    var pad = MCP.isArray(args.padding) ? [Number(args.padding[0]), Number(args.padding[1])] : (MCP.isDefined(args.padding) ? [Number(args.padding), Number(args.padding)] : [24, 12]);
    var pill = args.cornerRadius === "pill";
    var radius = pill ? 0 : MCP.num(args.cornerRadius, 12);
    var heightFrom = MCP.isDefined(args.heightFrom) ? String(args.heightFrom) : "text";
    var link = MCP.isDefined(args.link) ? String(args.link) : "parent";

    var doc = MCP.textDocProp(text).value;
    var fill = args.fillColor;
    if (!MCP.isDefined(fill)) {
        var tc = _mcpTry(function () { return doc.applyFill ? doc.fillColor : [1, 1, 1]; }, [1, 1, 1]);
        var lum = 0.2126 * tc[0] + 0.7152 * tc[1] + 0.0722 * tc[2];
        fill = lum > 0.5 ? [17 / 255, 24 / 255, 39 / 255, 1] : [1, 1, 1, 1];
    }
    if (heightFrom === "font" && _mcpTry(function () { return !!doc.boxText; }, false)) {
        notes.push("heightFrom font assumes point text; this is paragraph text, whose first baseline is not at the layer origin. Use heightFrom text if the box sits off.");
    }

    var box = comp.layers.addShape();
    box.name = MCP.isDefined(args.name) ? String(args.name) : text.name + " Box";
    // Shape property references go stale after addProperty in the same tree: fetch fresh every time.
    var itemsOf = function () { return box.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group"); };
    box.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    box.property("ADBE Root Vectors Group").property(1).name = "Box";
    itemsOf().addProperty("ADBE Vector Shape - Rect");
    itemsOf().addProperty("ADBE Vector Graphic - Fill");
    var hasStroke = !!(args.stroke && typeof args.stroke === "object");
    if (hasStroke) { itemsOf().addProperty("ADBE Vector Graphic - Stroke"); }
    var fillProp = MCP.childProp(itemsOf(), "ADBE Vector Graphic - Fill");
    fillProp.property("ADBE Vector Fill Color").setValue(MCP.color.rgba(fill));
    fillProp.property("ADBE Vector Fill Opacity").setValue(MCP.num(args.fillOpacity, 100));
    if (hasStroke) {
        var strokeProp = MCP.childProp(itemsOf(), "ADBE Vector Graphic - Stroke");
        strokeProp.property("ADBE Vector Stroke Color").setValue(MCP.color.rgba(args.stroke.color, [0, 0, 0, 1]));
        strokeProp.property("ADBE Vector Stroke Width").setValue(MCP.num(args.stroke.width, 1));
        strokeProp.property("ADBE Vector Stroke Opacity").setValue(MCP.num(args.stroke.opacity, 100));
    }

    // Timing, stacking and 3D follow the text.
    box.moveAfter(text);
    try { box.inPoint = text.inPoint; box.outPoint = text.outPoint; } catch (e0) { notes.push("Could not match the text layer's in and out points."); }
    var is3d = _mcpTry(function () { return !!text.threeDLayer; }, false);
    if (is3d) { try { box.threeDLayer = true; } catch (e1) {} }

    var tg = box.property("ADBE Transform Group");
    if (link === "parent") {
        box.parent = text;
        // Setting a parent by script keeps the world transform; reset so box space equals text layer space.
        tg = box.property("ADBE Transform Group");
        tg.property("ADBE Anchor Point").setValue(is3d ? [0, 0, 0] : [0, 0]);
        tg.property("ADBE Position").setValue(is3d ? [0, 0, 0] : [0, 0]);
        tg.property("ADBE Scale").setValue(is3d ? [100, 100, 100] : [100, 100]);
        tg.property("ADBE Rotate Z").setValue(0);
        if (is3d) {
            try { tg.property("ADBE Rotate X").setValue(0); tg.property("ADBE Rotate Y").setValue(0); tg.property("ADBE Orientation").setValue([0, 0, 0]); } catch (e2) {}
        }
    } else {
        tg.property("ADBE Anchor Point").setValue(is3d ? [0, 0, 0] : [0, 0]);
        tg.property("ADBE Position").setValue(is3d ? [0, 0, 0] : [0, 0]);
        notes.push("link expression: the box follows the text position through toComp; rotation and scale of the text are not followed.");
    }

    var exprs = MCP.textExtras.boxExpressions(text.name, {
        px: pad[0], py: pad[1], heightFrom: heightFrom, capHeight: MCP.num(args.capHeight, 0.7),
        minWidth: MCP.num(args.minWidth, 0), link: link, pill: pill, radius: radius
    });
    var rectProp = function (mn) { return MCP.childProp(itemsOf(), "ADBE Vector Shape - Rect").property(mn); };
    MCP.textExtras.setExpression(rectProp("ADBE Vector Rect Size"), exprs.size, "size", errors);
    MCP.textExtras.setExpression(rectProp("ADBE Vector Rect Position"), exprs.position, "position", errors);
    MCP.textExtras.setExpression(rectProp("ADBE Vector Rect Roundness"), exprs.roundness, "roundness", errors);
    var outExprs = { size: exprs.size, position: exprs.position, roundness: exprs.roundness, opacity: null };
    if (MCP.bool(args.linkOpacity, true)) {
        outExprs.opacity = "thisComp.layer(" + MCP.textExtras.quote(text.name) + ").transform.opacity";
        MCP.textExtras.setExpression(box.property("ADBE Transform Group").property("ADBE Opacity"), outExprs.opacity, "opacity", errors);
    }

    var shadow = null;
    if (args.shadow) {
        var shadowSettings = typeof args.shadow === "object" ? args.shadow : {};
        var merged = MCP.extend({ opacity: 14, angle: 90, distance: 4, size: 16 }, shadowSettings);
        var res = MCP.styles.addToLayers(comp, [box], "drop-shadow", merged, { useDefaults: true, allowMenu: true });
        shadow = res.results[0];
        if (shadow.status !== "ok") { notes.push("The box was built but the shadow failed: " + shadow.error); }
    }

    var rectNow = _mcpTry(function () { return box.sourceRectAtTime(comp.time, false); }, null);
    return {
        composition: MCP.serialize.compRef(comp),
        textLayer: MCP.serialize.layerRef(text),
        layer: MCP.serialize.layer(box),
        groupPath: "Contents/Box",
        padding: pad, cornerRadius: pill ? "pill" : radius, heightFrom: heightFrom, link: link,
        fillColor: MCP.color.toHex(MCP.color.rgba(fill)),
        size: rectNow ? [MCP.round(rectNow.width, 1), MCP.round(rectNow.height, 1)] : null,
        expressions: outExprs, expressionErrors: errors, shadow: shadow, notes: notes
    };
}, { mutating: true });

/* ------------------------------------------------------------- fit to box */

MCP.register("fitTextToBox", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    MCP.textExtras.requireText(layer);
    var notes = [];
    var t = MCP.timeArg(comp, args, comp.time);
    var prop = MCP.textDocProp(layer);
    var doc0 = MCP.textExtras.readDoc(prop, t);
    var isBox = _mcpTry(function () { return !!doc0.boxText; }, false);
    var mode = MCP.isDefined(args.mode) ? String(args.mode) : "once";
    var size0 = Number(doc0.fontSize);
    var W = MCP.isDefined(args.width) ? Number(args.width) : (isBox ? Number(doc0.boxTextSize[0]) : null);
    var H = MCP.isDefined(args.height) ? Number(args.height) : (isBox ? Number(doc0.boxTextSize[1]) : null);
    if (W === null && H === null) { MCP.fail("Point text needs width, height or both.", "invalid-argument"); }
    if (isBox) {
        // boxTextSize takes whole pixels; a missing side keeps the current box.
        W = Math.max(1, Math.round(W !== null ? W : Number(doc0.boxTextSize[0])));
        H = Math.max(1, Math.round(H !== null ? H : Number(doc0.boxTextSize[1])));
    }
    var shrinkOnly = MCP.bool(args.shrinkOnly, mode === "expression");
    var tol = 0.05;

    if (mode === "expression") {
        if (isBox) { MCP.fail("mode expression scales the layer and only fits point text; paragraph text wraps, so use mode once (or convert it with set-text-box pointText true).", "unsupported"); }
        var terms = [];
        if (W !== null) { terms.push(W + " / Math.max(r.width, 0.001)"); }
        if (H !== null) { terms.push(H + " / Math.max(r.height, 0.001)"); }
        var expr = "var r = sourceRectAtTime(time, false);\n" +
            "var k = 100 * " + (terms.length > 1 ? "Math.min(" + terms.join(", ") + ")" : terms[0]) + ";\n" +
            (shrinkOnly ? "k = Math.min(k, 100);\n" : "") +
            "value.length > 2 ? [k, k, k] : [k, k]";
        var sp = layer.property("ADBE Transform Group").property("ADBE Scale");
        sp.expression = expr;
        var err = _mcpTry(function () { return sp.expressionError || ""; }, "");
        notes.push("The Scale expression replaces the layer's own Scale value; the font size is unchanged.");
        return {
            composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer), mode: "expression", method: "scale-expression",
            fontSizeBefore: MCP.round(size0, 2), fontSize: MCP.round(size0, 2), width: W, height: H, shrinkOnly: shrinkOnly,
            expression: expr, expressionError: err, scale: MCP.roundValue(_mcpTry(function () { return sp.value; }, null)), notes: notes
        };
    }

    var leading0 = _mcpTry(function () { return doc0.autoLeading ? null : Number(doc0.leading); }, null);
    var scaleLeading = MCP.bool(args.scaleLeading, true);
    var hasOverflow = _mcpTry(function () { return typeof doc0.boxOverflow === "boolean"; }, false);
    var method = isBox ? (hasOverflow ? "box-overflow" : "tall-box-compare") : "point-bounds";
    var lo = MCP.num(args.minFontSize, 1), hi = MCP.num(args.maxFontSize, 1296);
    if (shrinkOnly) { hi = Math.min(hi, size0); }
    if (hi < lo) { hi = lo; }
    var iterations = 0;

    function rect() { return layer.sourceRectAtTime(t, false); }
    function styled(s) {
        var d = MCP.textExtras.readDoc(prop, t);
        d.fontSize = s;
        if (leading0 !== null && scaleLeading && size0 > 0) { d.leading = leading0 * s / size0; }
        return d;
    }
    function fits(s) {
        iterations++;
        var d = styled(s), rc;
        if (!isBox) {
            MCP.textExtras.writeDoc(prop, t, d);
            rc = rect();
            return (W === null || rc.width <= W + tol) && (H === null || rc.height <= H + tol);
        }
        if (hasOverflow) {
            d.boxTextSize = [W, H];
            MCP.textExtras.writeDoc(prop, t, d);
            rc = rect();
            return !MCP.textExtras.readDoc(prop, t).boxOverflow && rc.width <= W + tol;
        }
        d.boxTextSize = [W, Math.min(30000, Math.max(H * 10, 4000))];
        MCP.textExtras.writeDoc(prop, t, d);
        var tall = rect();
        if (tall.width > W + tol || tall.height > H + tol) { return false; }
        var d2 = MCP.textExtras.readDoc(prop, t);
        d2.boxTextSize = [W, H];
        MCP.textExtras.writeDoc(prop, t, d2);
        rc = rect();
        return Math.abs(rc.height - tall.height) < tol && Math.abs(rc.width - tall.width) < tol;
    }

    var best = lo, fitsAtAll = true;
    if (fits(hi)) {
        best = hi;
    } else if (!fits(lo)) {
        fitsAtAll = false;
        best = lo;
        notes.push("The text does not fit even at minFontSize " + lo + "; it was set to that size.");
    } else {
        var a = lo, b = hi;
        while (b - a > 0.1 && iterations < 40) {
            var mid = (a + b) / 2;
            if (fits(mid)) { best = mid; a = mid; } else { b = mid; }
        }
    }
    best = Math.floor(best * 10) / 10;
    if (best < 0.1) { best = 0.1; }
    var fin = styled(best);
    if (isBox) { fin.boxTextSize = [W, H]; }
    MCP.textExtras.writeDoc(prop, t, fin);
    if (prop.numKeys > 0) { notes.push("Source Text has keyframes, so the size was keyed at " + MCP.round(t) + " s."); }
    var after = MCP.textExtras.readDoc(prop, t);
    var rc2 = _mcpTry(function () { return rect(); }, null);
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer), mode: "once", method: method,
        fontSizeBefore: MCP.round(size0, 2), fontSize: MCP.round(Number(after.fontSize), 2),
        leading: _mcpTry(function () { return after.autoLeading ? "auto" : MCP.round(Number(after.leading), 2); }, null),
        boxText: isBox, boxSize: isBox ? MCP.roundValue(after.boxTextSize) : null, width: W, height: H,
        bounds: rc2 ? { left: MCP.round(rc2.left, 1), top: MCP.round(rc2.top, 1), width: MCP.round(rc2.width, 1), height: MCP.round(rc2.height, 1) } : null,
        overflow: hasOverflow ? !!after.boxOverflow : null, fits: fitsAtAll, iterations: iterations, shrinkOnly: shrinkOnly,
        textDocument: MCP.serialize.textDocument(after), notes: notes
    };
}, { mutating: true });
