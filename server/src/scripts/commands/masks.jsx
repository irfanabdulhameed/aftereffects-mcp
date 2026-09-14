/*
 * Mask commands: create from rectangles, ellipses, points, text bounds and
 * shape layer paths; list, change properties, key the path, delete, and
 * build reveal animations.
 */

MCP.masks = {};

MCP.masks.KAPPA = 0.5522847498;

MCP.masks.group = function (layer) {
    var g = _mcpTry(function () { return layer.property("ADBE Mask Parade"); }, null);
    if (!g) { MCP.fail("Layer '" + layer.name + "' cannot hold masks (cameras and lights have no Masks group).", "unsupported"); }
    return g;
};

MCP.masks.resolve = function (layer, ref) {
    var g = MCP.masks.group(layer);
    var m = null;
    if (typeof ref === "number") {
        m = _mcpTry(function () { return g.property(Number(ref)); }, null);
    } else if (typeof ref === "object" && ref !== null) {
        m = MCP.isDefined(ref.index) ? _mcpTry(function () { return g.property(Number(ref.index)); }, null) : MCP.childProp(g, String(ref.name));
    } else if (MCP.isDefined(ref)) {
        m = MCP.childProp(g, String(ref));
    } else {
        MCP.fail("A mask reference is required: a name or a 1-based index. Masks on '" + layer.name + "': " + (MCP.childNames(g).join(", ") || "(none)"), "invalid-argument");
    }
    if (!m) { MCP.fail("Mask '" + ref + "' not found on layer '" + layer.name + "'. Masks: " + (MCP.childNames(g).join(", ") || "(none)"), "not-found", { masks: MCP.childNames(g) }); }
    return m;
};

MCP.masks.MODE_NAMES = { "NONE": "none", "ADD": "add", "SUBTRACT": "subtract", "INTERSECT": "intersect", "LIGHTEN": "lighten", "DARKEN": "darken", "DIFFERENCE": "difference" };

MCP.masks.modeValue = function (name) {
    var key = String(name).toUpperCase().replace(/[\s-]+/g, "_");
    if (!MCP.masks.MODE_NAMES[key]) { MCP.fail("Unknown mask mode '" + name + "'. Use none, add, subtract, intersect, lighten, darken or difference.", "invalid-argument"); }
    return MaskMode[key];
};

MCP.masks.modeName = function (value) {
    for (var k in MCP.masks.MODE_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(MCP.masks.MODE_NAMES, k)) { continue; }
        var v = _mcpTry(function () { return MaskMode[k]; }, undefined);
        if (v !== undefined && v === value) { return MCP.masks.MODE_NAMES[k]; }
    }
    return String(value);
};

/* --------------------------------------------------------------- geometry */

MCP.masks.rectShape = function (x, y, w, h) {
    return MCP.shape.pathFromPoints([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
};

/** Four-vertex bezier ellipse centred on (cx, cy). */
MCP.masks.ellipseShape = function (cx, cy, rx, ry) {
    var kx = rx * MCP.masks.KAPPA, ky = ry * MCP.masks.KAPPA;
    var s = new Shape();
    s.vertices = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
    s.inTangents = [[-kx, 0], [0, -ky], [kx, 0], [0, ky]];
    s.outTangents = [[kx, 0], [0, ky], [-kx, 0], [0, -ky]];
    s.closed = true;
    return s;
};

/** {left, top, width, height} of the layer's visible content in layer space, padded. */
MCP.masks.layerBounds = function (layer, t, padding) {
    var pad = MCP.num(padding, 0);
    var rect = _mcpTry(function () { return layer.sourceRectAtTime(t, false); }, null);
    var b;
    if (rect && rect.width > 0 && rect.height > 0) {
        b = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    } else {
        var w = _mcpTry(function () { return layer.width; }, 0) || _mcpTry(function () { return layer.source.width; }, 0);
        var h = _mcpTry(function () { return layer.height; }, 0) || _mcpTry(function () { return layer.source.height; }, 0);
        if (!w || !h) { MCP.fail("Could not measure the bounds of layer '" + layer.name + "'. Give rect or size and center explicitly.", "unsupported"); }
        b = { left: 0, top: 0, width: w, height: h };
    }
    return { left: b.left - pad, top: b.top - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
};

/**
 * Builds a Shape from create-mask style args. Returns {shape, info}.
 * Precedence: points, then rect, then size+center, then the layer bounds.
 */
MCP.masks.shapeFromArgs = function (layer, args, t) {
    var kind = MCP.isDefined(args.shape) ? String(args.shape) : null;
    if (!kind) {
        if (MCP.isArray(args.points)) { kind = "points"; }
        else if (MCP.isDefined(args.rect) || MCP.isArray(args.size)) { kind = "rectangle"; }
        else { kind = "rectangle"; }
    }
    if (kind === "points") {
        if (!MCP.isArray(args.points) || args.points.length < 2) { MCP.fail("shape 'points' needs points[] with at least two [x, y] pairs.", "invalid-argument"); }
        return { shape: MCP.shape.pathFromPoints(args.points, MCP.bool(args.closed, true), args.inTangents, args.outTangents), info: { kind: "points", vertexCount: args.points.length } };
    }
    var box;
    if (kind === "text-bounds") {
        var lb = MCP.masks.layerBounds(layer, t, args.padding);
        box = { x: lb.left, y: lb.top, w: lb.width, h: lb.height };
    } else if (args.rect && typeof args.rect === "object") {
        var pad = MCP.num(args.padding, 0);
        box = { x: Number(args.rect.x) - pad, y: Number(args.rect.y) - pad, w: Number(args.rect.width) + 2 * pad, h: Number(args.rect.height) + 2 * pad };
    } else if (MCP.isArray(args.size)) {
        var pad2 = MCP.num(args.padding, 0);
        var c = MCP.isArray(args.center) ? args.center : null;
        if (!c) {
            var lb2 = MCP.masks.layerBounds(layer, t, 0);
            c = [lb2.left + lb2.width / 2, lb2.top + lb2.height / 2];
        }
        var w = Number(args.size[0]) + 2 * pad2, h = Number(args.size[1]) + 2 * pad2;
        box = { x: Number(c[0]) - w / 2, y: Number(c[1]) - h / 2, w: w, h: h };
    } else {
        var lb3 = MCP.masks.layerBounds(layer, t, args.padding);
        box = { x: lb3.left, y: lb3.top, w: lb3.width, h: lb3.height };
    }
    if (kind === "ellipse") {
        return { shape: MCP.masks.ellipseShape(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2), info: { kind: "ellipse", center: [MCP.round(box.x + box.w / 2), MCP.round(box.y + box.h / 2)], size: [MCP.round(box.w), MCP.round(box.h)], vertexCount: 4 } };
    }
    return { shape: MCP.masks.rectShape(box.x, box.y, box.w, box.h), info: { kind: kind === "text-bounds" ? "text-bounds" : "rectangle", rect: { x: MCP.round(box.x), y: MCP.round(box.y), width: MCP.round(box.w), height: MCP.round(box.h) }, vertexCount: 4 } };
};

/* -------------------------------------------------------------- serialize */

MCP.masks.serialize = function (mask) {
    var shapeProp = MCP.childProp(mask, "ADBE Mask Shape");
    var featherProp = MCP.childProp(mask, "ADBE Mask Feather");
    var opacityProp = MCP.childProp(mask, "ADBE Mask Opacity");
    var expansionProp = MCP.childProp(mask, "ADBE Mask Offset");
    var shapeVal = shapeProp ? _mcpTry(function () { return shapeProp.value; }, null) : null;
    return {
        index: mask.propertyIndex,
        name: mask.name,
        path: MCP.pathOf(mask).path,
        matchName: mask.matchName,
        mode: _mcpTry(function () { return MCP.masks.modeName(mask.maskMode); }, null),
        inverted: _mcpTry(function () { return !!mask.inverted; }, null),
        locked: _mcpTry(function () { return !!mask.locked; }, null),
        color: _mcpTry(function () { return MCP.color.toHex(mask.color); }, null),
        motionBlur: _mcpTry(function () { return String(mask.maskMotionBlur); }, null),
        feather: featherProp ? MCP.roundValue(_mcpTry(function () { return featherProp.value; }, null)) : null,
        opacity: opacityProp ? MCP.roundValue(_mcpTry(function () { return opacityProp.value; }, null)) : null,
        expansion: expansionProp ? MCP.roundValue(_mcpTry(function () { return expansionProp.value; }, null)) : null,
        vertexCount: shapeVal ? _mcpTry(function () { return shapeVal.vertices.length; }, null) : null,
        closed: shapeVal ? _mcpTry(function () { return shapeVal.closed; }, null) : null,
        keyframes: {
            path: shapeProp ? _mcpTry(function () { return shapeProp.numKeys; }, 0) : 0,
            feather: featherProp ? _mcpTry(function () { return featherProp.numKeys; }, 0) : 0,
            opacity: opacityProp ? _mcpTry(function () { return opacityProp.numKeys; }, 0) : 0,
            expansion: expansionProp ? _mcpTry(function () { return expansionProp.numKeys; }, 0) : 0
        },
        paths: {
            maskPath: shapeProp ? MCP.pathOf(shapeProp).path : null,
            feather: featherProp ? MCP.pathOf(featherProp).path : null,
            opacity: opacityProp ? MCP.pathOf(opacityProp).path : null,
            expansion: expansionProp ? MCP.pathOf(expansionProp).path : null
        }
    };
};

MCP.masks.list = function (layer) {
    var g = MCP.masks.group(layer);
    var out = [];
    for (var i = 1; i <= g.numProperties; i++) { out.push(MCP.masks.serialize(g.property(i))); }
    return out;
};

/** Applies mode, inverted, name, locked, color, feather, opacity, expansion (keyed when args.time/frame). */
MCP.masks.applyProps = function (mask, args, comp) {
    var changed = [], keyframes = [], notes = [];
    if (MCP.isDefined(args.mode)) { mask.maskMode = MCP.masks.modeValue(args.mode); changed.push("mode"); }
    if (MCP.isDefined(args.inverted)) { mask.inverted = MCP.bool(args.inverted, false); changed.push("inverted"); }
    if (MCP.isDefined(args.name)) { mask.name = String(args.name); changed.push("name"); }
    if (MCP.isDefined(args.locked)) { try { mask.locked = MCP.bool(args.locked, false); changed.push("locked"); } catch (e0) { notes.push("Could not set locked."); } }
    if (MCP.isDefined(args.color)) { try { mask.color = MCP.color.rgb(args.color); changed.push("color"); } catch (e1) { notes.push("Could not set color."); } }
    var keyed = MCP.isDefined(args.time) || MCP.isDefined(args.frame);
    var specs = [
        { key: "feather", matchName: "ADBE Mask Feather", value: MCP.isDefined(args.feather) ? (MCP.isArray(args.feather) ? [Number(args.feather[0]), Number(args.feather[1])] : [Number(args.feather), Number(args.feather)]) : undefined },
        { key: "opacity", matchName: "ADBE Mask Opacity", value: MCP.isDefined(args.opacity) ? Number(args.opacity) : undefined },
        { key: "expansion", matchName: "ADBE Mask Offset", value: MCP.isDefined(args.expansion) ? Number(args.expansion) : undefined }
    ];
    for (var i = 0; i < specs.length; i++) {
        var s = specs[i];
        if (!MCP.isDefined(s.value)) { continue; }
        var p = MCP.childProp(mask, s.matchName);
        if (!p) { notes.push("Mask has no '" + s.key + "' property."); continue; }
        try {
            if (keyed) {
                var t = MCP.timeArg(comp, args);
                var ki = MCP.easing.setKey(p, t, s.value);
                if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(p, ki, args.easing); }
                keyframes.push({ property: MCP.pathOf(p).path, keyIndex: ki, keyframe: MCP.serialize.keyframe(p, ki) });
            } else if (p.numKeys > 0) {
                MCP.easing.setKey(p, comp.time, s.value);
            } else {
                p.setValue(s.value);
            }
            changed.push(s.key);
        } catch (e2) { notes.push("Could not set " + s.key + ": " + e2.toString()); }
    }
    return { changed: changed, keyframes: keyframes, notes: notes };
};

MCP.masks.create = function (layer, name) {
    var g = MCP.masks.group(layer);
    var mask = g.addProperty("ADBE Mask Atom");
    if (MCP.isDefined(name)) { mask.name = String(name); }
    return mask;
};

MCP.masks.keyPair = function (p, t0, v0, t1, v1, easing, keyframes) {
    var i0 = MCP.easing.setKey(p, t0, v0);
    var i1 = MCP.easing.setKey(p, t1, v1);
    MCP.easing.applySegment(p, i1, easing || "ease-out");
    var ka = MCP.easing.keyIndexAtTime(p, t0, 1e-3), kb = MCP.easing.keyIndexAtTime(p, t1, 1e-3);
    keyframes.push({ property: MCP.pathOf(p).path, keys: [MCP.serialize.keyframe(p, ka > 0 ? ka : i0), MCP.serialize.keyframe(p, kb > 0 ? kb : i1)] });
};

/* --------------------------------------------------------------- commands */

MCP.register("createMask", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var t = MCP.timeArg(r.comp, args, r.comp.time);
    var built = MCP.masks.shapeFromArgs(r.layer, args, t);
    var mask = MCP.masks.create(r.layer, args.name);
    var shapeProp = MCP.childProp(mask, "ADBE Mask Shape");
    shapeProp.setValue(built.shape);
    var res = MCP.masks.applyProps(mask, MCP.extend(MCP.extend({}, args), { time: undefined, frame: undefined, name: undefined }), r.comp);
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), mask: MCP.masks.serialize(mask), maskPath: MCP.pathOf(mask).path, geometry: built.info, changed: res.changed, notes: res.notes, maskCount: MCP.masks.group(r.layer).numProperties };
}, { mutating: true });

MCP.register("listMasks", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var masks = MCP.masks.list(r.layer);
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), count: masks.length, masks: masks };
}, { mutating: false });

MCP.register("setMaskProperties", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var mask = MCP.masks.resolve(r.layer, MCP.requireArg(args, "mask"));
    var res = MCP.masks.applyProps(mask, args, r.comp);
    if (!res.changed.length) { MCP.fail("No mask fields given. Use mode, inverted, feather, opacity, expansion, name, locked or color.", "invalid-argument"); }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), mask: MCP.masks.serialize(mask), changed: res.changed, keyframes: res.keyframes, notes: res.notes };
}, { mutating: true });

MCP.register("setMaskPathKeyframe", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var mask = MCP.masks.resolve(r.layer, MCP.requireArg(args, "mask"));
    var shapeProp = MCP.childProp(mask, "ADBE Mask Shape");
    if (!shapeProp) { MCP.fail("Mask '" + mask.name + "' has no Mask Path property.", "script-error"); }
    var t = MCP.timeArg(r.comp, args, r.comp.time);
    var built = MCP.masks.shapeFromArgs(r.layer, args, t);
    var keyIndex = null;
    if (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) {
        keyIndex = MCP.easing.setKey(shapeProp, t, built.shape);
        if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(shapeProp, keyIndex, args.easing); }
    } else if (shapeProp.numKeys > 0) {
        keyIndex = MCP.easing.setKey(shapeProp, r.comp.time, built.shape);
    } else {
        shapeProp.setValue(built.shape);
    }
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        mask: MCP.masks.serialize(mask), geometry: built.info, vertexCount: built.info.vertexCount,
        keyIndex: keyIndex, keyframe: keyIndex ? MCP.serialize.keyframe(shapeProp, keyIndex) : null
    };
}, { mutating: true });

MCP.register("deleteMask", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var mask = MCP.masks.resolve(r.layer, MCP.requireArg(args, "mask"));
    var removed = { index: mask.propertyIndex, name: mask.name };
    mask.remove();
    var remaining = [];
    var g = MCP.masks.group(r.layer);
    for (var i = 1; i <= g.numProperties; i++) { remaining.push({ index: i, name: g.property(i).name }); }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), removed: removed, remainingCount: remaining.length, masks: remaining };
}, { mutating: true });

MCP.register("createMaskFromShapeLayer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var target = MCP.resolveLayer(comp, MCP.requireArg(args, "layer"));
    var shapeLayer = MCP.resolveLayer(comp, MCP.requireArg(args, "shapeLayer"));
    var group = MCP.shape.resolveGroup(shapeLayer, args.group);
    var item = MCP.shape.findItem(group, ["ADBE Vector Shape - Group", "ADBE Vector Shape - Rect", "ADBE Vector Shape - Ellipse", "ADBE Vector Shape - Star"]);
    if (!item) { MCP.fail("Group '" + group.name + "' on '" + shapeLayer.name + "' has no path item. Items: " + MCP.childNames(MCP.shape.itemsOf(group)).join(", "), "not-found"); }
    var t = MCP.timeArg(comp, args, comp.time);
    var notes = [];
    var src = MCP.shape.toShape(item, t, notes);
    function xf(layer, mn) { return _mcpTry(function () { return layer.property("ADBE Transform Group").property(mn).valueAtTime(t, false); }, [0, 0]); }
    var posS = xf(shapeLayer, "ADBE Position"), ancS = xf(shapeLayer, "ADBE Anchor Point");
    var posT = xf(target, "ADBE Position"), ancT = xf(target, "ADBE Anchor Point");
    var gt = MCP.childProp(group, "ADBE Vector Transform Group");
    var gPos = gt ? _mcpTry(function () { return MCP.childProp(gt, "ADBE Vector Position").valueAtTime(t, false); }, [0, 0]) : [0, 0];
    var gAnc = gt ? _mcpTry(function () { return MCP.childProp(gt, "ADBE Vector Anchor").valueAtTime(t, false); }, [0, 0]) : [0, 0];
    var dx = (gPos[0] - gAnc[0]) + (posS[0] - ancS[0]) - (posT[0] - ancT[0]);
    var dy = (gPos[1] - gAnc[1]) + (posS[1] - ancS[1]) - (posT[1] - ancT[1]);
    var verts = [];
    for (var i = 0; i < src.vertices.length; i++) { verts.push([src.vertices[i][0] + dx, src.vertices[i][1] + dy]); }
    var shape = MCP.shape.pathFromPoints(verts, src.closed, src.inTangents, src.outTangents);
    var mask = MCP.masks.create(target, MCP.isDefined(args.name) ? args.name : (group.name + " Mask"));
    MCP.childProp(mask, "ADBE Mask Shape").setValue(shape);
    var res = MCP.masks.applyProps(mask, MCP.extend(MCP.extend({}, args), { time: undefined, frame: undefined, name: undefined }), comp);
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(target), shapeLayer: MCP.serialize.layerRef(shapeLayer),
        sourceGroup: MCP.shape.nodeSummary(group), sourceItem: MCP.shape.nodeSummary(item),
        offset: [MCP.round(dx), MCP.round(dy)], mask: MCP.masks.serialize(mask), maskPath: MCP.pathOf(mask).path,
        changed: res.changed, notes: notes.concat(res.notes)
    };
}, { mutating: true });

MCP.register("maskRevealAnimation", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var dir = String(MCP.requireArg(args, "direction"));
    var valid = ["left", "right", "up", "down", "center-out", "feather", "expansion"];
    if (valid.indexOf(dir) === -1) { MCP.fail("Unknown direction '" + dir + "'. Use " + valid.join(", ") + ".", "invalid-argument"); }
    var t0 = MCP.durationArg(comp, args, "startTime", "startFrame", layer.inPoint);
    var duration = MCP.durationArg(comp, args, "duration", "durationFrames", 1);
    if (duration <= 0) { MCP.fail("duration must be greater than 0.", "invalid-argument"); }
    var t1 = t0 + duration;
    var easing = MCP.isDefined(args.easing) ? args.easing : "ease-out";
    var b = MCP.masks.layerBounds(layer, t0, args.padding);
    var l = b.left, tp = b.top, rt = b.left + b.width, bt = b.top + b.height;
    var cx = l + b.width / 2, cy = tp + b.height / 2;
    var full = [[l, tp], [rt, tp], [rt, bt], [l, bt]];
    var hidden = null;
    if (dir === "right") { hidden = [[l, tp], [l, tp], [l, bt], [l, bt]]; }
    else if (dir === "left") { hidden = [[rt, tp], [rt, tp], [rt, bt], [rt, bt]]; }
    else if (dir === "down") { hidden = [[l, tp], [rt, tp], [rt, tp], [l, tp]]; }
    else if (dir === "up") { hidden = [[l, bt], [rt, bt], [rt, bt], [l, bt]]; }
    else if (dir === "center-out") { hidden = [[cx, cy], [cx, cy], [cx, cy], [cx, cy]]; }
    var mask = MCP.masks.create(layer, MCP.isDefined(args.name) ? args.name : "Reveal " + dir);
    if (MCP.isDefined(args.mode)) { mask.maskMode = MCP.masks.modeValue(args.mode); }
    var shapeProp = MCP.childProp(mask, "ADBE Mask Shape");
    var keyframes = [];
    if (hidden) {
        shapeProp.setValue(MCP.shape.pathFromPoints(full, true));
        MCP.masks.keyPair(shapeProp, t0, MCP.shape.pathFromPoints(hidden, true), t1, MCP.shape.pathFromPoints(full, true), easing, keyframes);
    } else {
        shapeProp.setValue(MCP.shape.pathFromPoints(full, true));
        if (dir === "feather") {
            var f = MCP.num(args.featherAmount, 200);
            MCP.masks.keyPair(MCP.childProp(mask, "ADBE Mask Feather"), t0, [f, f], t1, [0, 0], easing, keyframes);
        } else {
            var maxExp = Math.ceil(Math.max(b.width, b.height) / 2) + 1;
            MCP.masks.keyPair(MCP.childProp(mask, "ADBE Mask Offset"), t0, -maxExp, t1, 0, easing, keyframes);
        }
    }
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer),
        direction: dir, bounds: { left: MCP.round(l), top: MCP.round(tp), width: MCP.round(b.width), height: MCP.round(b.height) },
        mask: MCP.masks.serialize(mask), maskPath: MCP.pathOf(mask).path,
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        keyframes: keyframes
    };
}, { mutating: true });
