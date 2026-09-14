/*
 * Transform and property commands: read and write any property, set
 * transform values or keyframes, anchor point with position correction,
 * fit to comp, layer bounds in comp space, separated dimensions.
 *
 * Bounds maths is 2D on purpose: anchor, position, scale and Z rotation.
 * Parenting, X and Y rotation and cameras are ignored and reported in notes.
 */

MCP.transform = {};

MCP.transform.group = function (layer) {
    var tg = _mcpTry(function () { return layer.property("ADBE Transform Group"); }, null);
    if (!tg) { MCP.fail("Layer '" + layer.name + "' has no Transform group.", "unsupported"); }
    return tg;
};

MCP.transform.prop = function (layer, matchName) {
    var tg = MCP.transform.group(layer);
    return _mcpTry(function () { return tg.property(matchName); }, null) || null;
};

/** Reads a transform value at time t, or a fallback when the property is missing (cameras have no Scale). */
MCP.transform.valueAt = function (layer, matchName, t, fallback) {
    var p = MCP.transform.prop(layer, matchName);
    if (!p) { return fallback; }
    return _mcpTry(function () { return p.valueAtTime(t, false); }, fallback);
};

/**
 * Writes a value directly, or as a keyframe when the property already has
 * keys or forceKey is true. Returns {keyframed, keyIndex}.
 */
MCP.transform.write = function (prop, value, t, forceKey, easing, spatial) {
    var hasKeys = _mcpTry(function () { return prop.numKeys > 0; }, false);
    if (hasKeys || forceKey) {
        var i = MCP.easing.setKey(prop, t, value, spatial);
        if (MCP.isDefined(easing)) { MCP.easing.applySegment(prop, i, easing); }
        return { keyframed: true, keyIndex: i };
    }
    prop.setValue(value);
    return { keyframed: false, keyIndex: null };
};

/** Position may be split into X, Y and Z Position; write each axis in that case. */
MCP.transform.writePosition = function (layer, value, t, forceKey, easing) {
    var tg = MCP.transform.group(layer);
    var pp = tg.property("ADBE Position");
    var separated = _mcpTry(function () { return !!pp.dimensionsSeparated; }, false);
    if (!separated) { return MCP.transform.write(pp, value, t, forceKey, easing); }
    var names = ["ADBE Position_0", "ADBE Position_1", "ADBE Position_2"];
    var res = { keyframed: false, keyIndex: null, separated: true };
    for (var i = 0; i < value.length && i < 3; i++) {
        var axis = _mcpTry(function () { return tg.property(names[i]); }, null);
        if (!axis) { continue; }
        var r = MCP.transform.write(axis, Number(value[i]), t, forceKey, easing);
        if (r.keyframed) { res.keyframed = true; res.keyIndex = r.keyIndex; }
    }
    return res;
};

/** Pads or trims an array value to the dimension count of the property's current value. */
MCP.transform.fitDims = function (prop, value) {
    var current = _mcpTry(function () { return prop.value; }, null);
    if (!MCP.isArray(current) || !MCP.isArray(value)) { return value; }
    var out = [];
    for (var i = 0; i < current.length; i++) {
        out.push(i < value.length ? Number(value[i]) : Number(current[i]));
    }
    return out;
};

MCP.transform.sourceRect = function (layer, t) {
    var rect = null;
    try { rect = layer.sourceRectAtTime(t, false); } catch (e) { rect = null; }
    if (!rect) {
        MCP.fail("Layer '" + layer.name + "' has no visible bounds (cameras, lights and audio-only layers have none).", "unsupported");
    }
    return { left: MCP.round(rect.left), top: MCP.round(rect.top), width: MCP.round(rect.width), height: MCP.round(rect.height) };
};

/** Layer-space point to comp space using anchor, position, scale and Z rotation (2D). */
MCP.transform.toComp = function (pt, anchor, pos, scale, rotDeg) {
    var sx = (MCP.isArray(scale) ? Number(scale[0]) : 100) / 100;
    var sy = (MCP.isArray(scale) ? Number(scale[1]) : 100) / 100;
    var dx = (pt[0] - anchor[0]) * sx;
    var dy = (pt[1] - anchor[1]) * sy;
    var r = (Number(rotDeg) || 0) * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    return [pos[0] + dx * c - dy * s, pos[1] + dx * s + dy * c];
};

/** Bounds of a layer's content in comp space at time t. */
MCP.transform.bounds = function (layer, t) {
    var rect = MCP.transform.sourceRect(layer, t);
    var pos = MCP.transform.valueAt(layer, "ADBE Position", t, [0, 0]);
    var anchor = MCP.transform.valueAt(layer, "ADBE Anchor Point", t, [0, 0]);
    var scale = MCP.transform.valueAt(layer, "ADBE Scale", t, [100, 100]);
    var rot = MCP.transform.valueAt(layer, "ADBE Rotate Z", t, 0);
    var pts = [
        [rect.left, rect.top],
        [rect.left + rect.width, rect.top],
        [rect.left + rect.width, rect.top + rect.height],
        [rect.left, rect.top + rect.height]
    ];
    var corners = [];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < pts.length; i++) {
        var c = MCP.transform.toComp(pts[i], anchor, pos, scale, rot);
        corners.push(MCP.roundValue(c));
        if (c[0] < minX) { minX = c[0]; }
        if (c[0] > maxX) { maxX = c[0]; }
        if (c[1] < minY) { minY = c[1]; }
        if (c[1] > maxY) { maxY = c[1]; }
    }
    var notes = [];
    if (_mcpTry(function () { return !!layer.parent; }, false)) { notes.push("Layer '" + layer.name + "' has a parent; parent transforms are not included in the bounds."); }
    if (_mcpTry(function () { return !!layer.threeDLayer; }, false)) { notes.push("Layer '" + layer.name + "' is 3D; X and Y rotation, Z depth and the camera are not included in the bounds."); }
    return {
        sourceRect: rect,
        anchorPoint: MCP.roundValue(anchor),
        position: MCP.roundValue(pos),
        scale: MCP.roundValue(scale),
        rotation: MCP.round(Number(rot) || 0),
        corners: { topLeft: corners[0], topRight: corners[1], bottomRight: corners[2], bottomLeft: corners[3] },
        bounds: { left: MCP.round(minX), top: MCP.round(minY), right: MCP.round(maxX), bottom: MCP.round(maxY), width: MCP.round(maxX - minX), height: MCP.round(maxY - minY) },
        notes: notes
    };
};

/** Colour properties accept hex or 0..255 input; everything else passes through. */
MCP.transform.valueFor = function (prop, raw) {
    var isColor = _mcpTry(function () { return prop.propertyValueType === PropertyValueType.COLOR; }, false);
    if (isColor) {
        var v = MCP.coerceValue(prop, raw);
        if (typeof v === "string" || MCP.isArray(v) || (v && typeof v === "object")) { return MCP.color.rgba(v); }
        return v;
    }
    return MCP.valueForProperty(prop, raw);
};

MCP.transform.expressionState = function (prop) {
    var has = _mcpTry(function () { return prop.canSetExpression && prop.expression !== ""; }, false);
    return {
        hasExpression: has,
        expression: has ? prop.expression : "",
        enabled: has ? _mcpTry(function () { return prop.expressionEnabled; }, null) : null,
        error: has ? _mcpTry(function () { return prop.expressionError || ""; }, "") : ""
    };
};

/* ------------------------------------------------------------- commands */

MCP.register("getPropertyValue", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var t = MCP.timeArg(r.comp, args);
    var out = MCP.serialize.propertyResult(r.layer, prop);
    out.time = MCP.round(t);
    out.frame = MCP.frameOf(r.comp, t);
    out.valueAtTime = MCP.isGroup(prop) ? null : _mcpTry(function () { return MCP.serialize.rawValue(prop.valueAtTime(t, false)); }, null);
    out.dimensions = out.property.dimensions;
    out.hasKeyframes = out.property.numKeys > 0;
    out.expression = MCP.transform.expressionState(prop);
    return out;
}, { mutating: false });

MCP.register("setPropertyValue", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    if (MCP.isGroup(prop)) {
        MCP.fail("'" + MCP.pathOf(prop).path + "' is a group, not a value. Children: " + MCP.childNames(prop).join(", "), "invalid-argument");
    }
    var value = MCP.transform.valueFor(prop, MCP.requireArg(args, "value"));
    var previous = MCP.serialize.value(prop);
    var hasKeys = _mcpTry(function () { return prop.numKeys > 0; }, false);
    var force = MCP.bool(args.forceKeyframe, false);
    if (hasKeys || force) {
        var t = MCP.timeArg(r.comp, args);
        var i = MCP.easing.setKey(prop, t, value, args.spatial);
        if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(prop, i, args.easing); }
        return MCP.serialize.propertyResult(r.layer, prop, {
            mode: "keyframe", previousValue: previous, keyIndex: i, keyframe: MCP.serialize.keyframe(prop, i),
            time: MCP.round(t), frame: MCP.frameOf(r.comp, t)
        });
    }
    prop.setValue(value);
    return MCP.serialize.propertyResult(r.layer, prop, { mode: "value", previousValue: previous, keyIndex: null, keyframe: null });
}, { mutating: true });

MCP.register("setTransform", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var tg = MCP.transform.group(layer);
    var hasTime = MCP.isDefined(args.time) || MCP.isDefined(args.frame);
    var t = MCP.timeArg(comp, args);
    var is3D = _mcpTry(function () { return !!layer.threeDLayer; }, false);
    var changed = [], skipped = [], keyframed = false;
    var easing = args.easing;

    function writeOne(name, matchName, value, threeDOnly) {
        var prop = _mcpTry(function () { return tg.property(matchName); }, null);
        if (!prop) { skipped.push({ field: name, reason: "not available on this layer type" }); return; }
        if (threeDOnly && !is3D) { skipped.push({ field: name, reason: "layer is not 3D" }); return; }
        var res;
        try {
            res = (matchName === "ADBE Position")
                ? MCP.transform.writePosition(layer, MCP.transform.fitDims(prop, value), t, hasTime, easing)
                : MCP.transform.write(prop, MCP.transform.fitDims(prop, value), t, hasTime, easing);
        } catch (e) {
            skipped.push({ field: name, reason: String(e.message || e) });
            return;
        }
        changed.push(name);
        if (res.keyframed) { keyframed = true; }
    }

    if (MCP.isDefined(args.position)) { writeOne("position", "ADBE Position", args.position, false); }
    if (MCP.isDefined(args.anchorPoint)) { writeOne("anchorPoint", "ADBE Anchor Point", args.anchorPoint, false); }
    if (MCP.isDefined(args.scale)) {
        var sv = args.scale;
        if (typeof sv === "number") { sv = [sv, sv, sv]; }
        writeOne("scale", "ADBE Scale", sv, false);
    }
    var zRot = MCP.isDefined(args.zRotation) ? args.zRotation : args.rotation;
    if (MCP.isDefined(zRot)) { writeOne("rotation", "ADBE Rotate Z", Number(zRot), false); }
    if (MCP.isDefined(args.xRotation)) { writeOne("xRotation", "ADBE Rotate X", Number(args.xRotation), true); }
    if (MCP.isDefined(args.yRotation)) { writeOne("yRotation", "ADBE Rotate Y", Number(args.yRotation), true); }
    if (MCP.isDefined(args.orientation)) { writeOne("orientation", "ADBE Orientation", args.orientation, true); }
    if (MCP.isDefined(args.opacity)) { writeOne("opacity", "ADBE Opacity", Number(args.opacity), false); }

    if (!changed.length && !skipped.length) {
        MCP.fail("Nothing to set. Give at least one of position, anchorPoint, scale, rotation, xRotation, yRotation, zRotation, orientation, opacity.", "invalid-argument");
    }
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(layer),
        changed: changed,
        skipped: skipped,
        keyframed: keyframed,
        time: MCP.round(t),
        frame: MCP.frameOf(comp, t)
    };
}, { mutating: true });

MCP.transform.ANCHOR_FRACTIONS = {
    "center": [0.5, 0.5], "top-left": [0, 0], "top-center": [0.5, 0], "top-right": [1, 0],
    "center-left": [0, 0.5], "center-right": [1, 0.5], "bottom-left": [0, 1], "bottom-center": [0.5, 1], "bottom-right": [1, 1]
};

MCP.register("setAnchorPoint", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var tg = MCP.transform.group(layer);
    var t = MCP.timeArg(comp, args);
    var ap = tg.property("ADBE Anchor Point");
    var pp = tg.property("ADBE Position");
    var oldA = ap.value, oldP = pp.value;
    var scale = MCP.transform.valueAt(layer, "ADBE Scale", t, [100, 100]);
    var rot = MCP.transform.valueAt(layer, "ADBE Rotate Z", t, 0);
    var anchorArg = MCP.requireArg(args, "anchor");
    var rect = null, target;
    if (typeof anchorArg === "string") {
        var key = anchorArg.toLowerCase();
        var f = MCP.transform.ANCHOR_FRACTIONS[key];
        if (!f) { MCP.fail("Unknown anchor name '" + anchorArg + "'. Use one of: " + MCP.keys(MCP.transform.ANCHOR_FRACTIONS).join(", ") + " or [x, y].", "invalid-argument"); }
        rect = MCP.transform.sourceRect(layer, t);
        target = [rect.left + rect.width * f[0], rect.top + rect.height * f[1]];
    } else if (MCP.isArray(anchorArg) && anchorArg.length >= 2) {
        target = anchorArg;
    } else {
        MCP.fail("anchor must be a name such as 'center' or an [x, y] array.", "invalid-argument");
    }
    var newA = oldA.slice(0);
    newA[0] = Number(target[0]);
    newA[1] = Number(target[1]);
    if (target.length > 2 && newA.length > 2) { newA[2] = Number(target[2]); }
    MCP.transform.write(ap, newA, t, false, null);

    var newP = oldP.slice(0);
    var notes = [];
    if (MCP.bool(args.keepVisualPosition, true)) {
        var dx = (newA[0] - oldA[0]) * (Number(scale[0]) / 100);
        var dy = (newA[1] - oldA[1]) * (Number(scale[1]) / 100);
        var rad = (Number(rot) || 0) * Math.PI / 180;
        var c = Math.cos(rad), s = Math.sin(rad);
        newP[0] = oldP[0] + dx * c - dy * s;
        newP[1] = oldP[1] + dx * s + dy * c;
        if (newA.length > 2 && oldA.length > 2 && newP.length > 2) { newP[2] = oldP[2] + (newA[2] - oldA[2]) * (Number(scale[2] || 100) / 100); }
        MCP.transform.writePosition(layer, newP, t, false, null);
        if (_mcpTry(function () { return !!layer.threeDLayer; }, false)) { notes.push("Position correction uses Z rotation only; X and Y rotation are not compensated."); }
        if (_mcpTry(function () { return !!layer.parent; }, false)) { notes.push("Position correction is in the parent's space; parent scale or rotation is not compensated."); }
    }
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layerRef(layer),
        anchorPoint: MCP.roundValue(ap.value),
        position: MCP.roundValue(pp.value),
        previousAnchorPoint: MCP.roundValue(oldA),
        previousPosition: MCP.roundValue(oldP),
        sourceRect: rect || _mcpTry(function () { return MCP.transform.sourceRect(layer, t); }, null),
        keepVisualPosition: MCP.bool(args.keepVisualPosition, true),
        notes: notes
    };
}, { mutating: true });

MCP.register("fitLayerToComposition", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var tg = MCP.transform.group(layer);
    var mode = String(MCP.arg(args, "mode", "both")).toLowerCase();
    var margin = Math.max(0, MCP.num(args.margin, 0));
    var t = comp.time;
    var rect = MCP.transform.sourceRect(layer, t);
    if (rect.width <= 0 || rect.height <= 0) { MCP.fail("Layer '" + layer.name + "' has an empty source rectangle; nothing to fit.", "invalid-argument"); }
    var availW = comp.width - 2 * margin, availH = comp.height - 2 * margin;
    if (availW <= 0 || availH <= 0) { MCP.fail("margin " + margin + " leaves no room inside a " + comp.width + "x" + comp.height + " composition.", "invalid-argument"); }
    var sx = availW / rect.width * 100, sy = availH / rect.height * 100;
    var s;
    if (mode === "width") { s = sx; }
    else if (mode === "height") { s = sy; }
    else if (mode === "cover") { s = Math.max(sx, sy); }
    else if (mode === "both") { s = Math.min(sx, sy); }
    else { MCP.fail("Unknown mode '" + mode + "'. Use width, height, both or cover.", "invalid-argument"); }

    var sp = tg.property("ADBE Scale");
    var cur = sp.value;
    var newS = [s, s];
    if (MCP.isArray(cur) && cur.length > 2) { newS.push(Number(cur[2])); }
    MCP.transform.write(sp, newS, t, false, null);

    var pp = tg.property("ADBE Position");
    var notes = [];
    if (MCP.bool(args.center, true)) {
        var anchor = tg.property("ADBE Anchor Point").value;
        var rectCx = rect.left + rect.width / 2, rectCy = rect.top + rect.height / 2;
        var newP = pp.value.slice(0);
        newP[0] = comp.width / 2 - (rectCx - anchor[0]) * s / 100;
        newP[1] = comp.height / 2 - (rectCy - anchor[1]) * s / 100;
        MCP.transform.writePosition(layer, newP, t, false, null);
    }
    var rot = MCP.transform.valueAt(layer, "ADBE Rotate Z", t, 0);
    if (Math.abs(Number(rot) || 0) > 0.001) { notes.push("Layer is rotated by " + MCP.round(rot) + " degrees; the fit ignores rotation."); }
    if (_mcpTry(function () { return !!layer.parent; }, false)) { notes.push("Layer has a parent; the fit is measured in the parent's space."); }
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layerRef(layer),
        mode: mode,
        margin: margin,
        scale: MCP.roundValue(sp.value),
        position: MCP.roundValue(pp.value),
        sourceRect: rect,
        fitted: { width: MCP.round(rect.width * s / 100), height: MCP.round(rect.height * s / 100) },
        notes: notes
    };
}, { mutating: true });

MCP.register("getLayerBounds", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var t = MCP.timeArg(r.comp, args);
    var b = MCP.transform.bounds(r.layer, t);
    b.composition = MCP.serialize.compRef(r.comp);
    b.layer = MCP.serialize.layerRef(r.layer);
    b.time = MCP.round(t);
    b.frame = MCP.frameOf(r.comp, t);
    return b;
}, { mutating: false });

MCP.register("separateDimensions", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var tg = MCP.transform.group(r.layer);
    var pp = tg.property("ADBE Position");
    var want = MCP.bool(args.separate, true);
    try {
        pp.dimensionsSeparated = want;
    } catch (e) {
        MCP.fail("Cannot change separated dimensions on '" + r.layer.name + "': " + String(e.message || e), "unsupported");
    }
    var now = _mcpTry(function () { return !!pp.dimensionsSeparated; }, want);
    var is3D = _mcpTry(function () { return !!r.layer.threeDLayer; }, false);
    var paths, matchNames;
    if (now) {
        paths = ["Transform/X Position", "Transform/Y Position"];
        matchNames = ["ADBE Transform Group/ADBE Position_0", "ADBE Transform Group/ADBE Position_1"];
        if (is3D) { paths.push("Transform/Z Position"); matchNames.push("ADBE Transform Group/ADBE Position_2"); }
    } else {
        paths = ["Transform/Position"];
        matchNames = ["ADBE Transform Group/ADBE Position"];
    }
    return {
        composition: MCP.serialize.compRef(r.comp),
        layer: MCP.serialize.layerRef(r.layer),
        dimensionsSeparated: now,
        properties: paths,
        matchPaths: matchNames,
        position: MCP.roundValue(_mcpTry(function () { return pp.value; }, null))
    };
}, { mutating: true });
