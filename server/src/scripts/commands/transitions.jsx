/*
 * Transitions commands: cuts between an outgoing and an incoming layer,
 * built with a few eased keys on the layers' own transforms.
 *
 * Curves (speed 0 at the keys, influence in percent of the segment):
 *   EASE_OUT  leave 85, arrive 14: the outgoing accelerates into the cut. Its
 *             out point sits on the cut key, so the last visible frame still
 *             moves near peak speed and the slow last step is never shown.
 *   EASE_IN   leave 16.7, arrive 90: the incoming opens with a short ramp
 *             and lands with a long deceleration.
 * Together the speed graph is a spike centred on the cut. Layers that stay on
 * screen through the cut (push, carried elements) get three keys instead,
 * with the speed passing through the cut key at twice the average speed of
 * each side, so they never stop on the cut.
 *
 * Every transition writes a record: JSON in the parameters of a layer marker
 * at the cut, on the incoming layer (or on the outgoing one when the incoming
 * layer already has a marker there; carried elements on their carry layer).
 * It lists the keys, effects, layers and trims made, with times relative to
 * the cut. Layer markers and keys move with their layer, so a record stays
 * valid when a scene sequence ripples. remove-transition undoes a record.
 */

MCP.trans = {};

MCP.trans.KEY = "mcpTransition";
MCP.trans.KINDS = { "match-cut": 1, "zoom-through": 1, "push": 1, "shape-reveal": 1, "blur-swap": 1, "whip": 1 };
MCP.trans.EASE_OUT = { outInfluence: 85, inInfluence: 14 };
MCP.trans.EASE_IN = { outInfluence: 16.7, inInfluence: 90 };
/* Default [seconds out, seconds in] per kind. */
MCP.trans.DEFAULTS = {
    "match-cut": [0.33, 0.33], "zoom-through": [0.33, 0.33], "push": [0.3, 0.3],
    "shape-reveal": [0, 0.5], "blur-swap": [0.25, 0.33], "whip": [0.2, 0.27], "carry": [0.33, 0.33]
};
MCP.trans.EPS = 1e-4;

/* ---------------------------------------------------------------- helpers */

MCP.trans.newId = function () {
    var t = new Date().getTime().toString(36);
    return "t" + t.substring(t.length - 5) + Math.floor(Math.random() * 46656).toString(36);
};

MCP.trans.tprop = function (layer, matchName) {
    return layer.property("ADBE Transform Group").property(matchName);
};

/** A layer with a picture. Shape and text layers are not instanceof AVLayer in ExtendScript, so test them too. */
MCP.trans.isAV = function (layer) {
    return (layer instanceof AVLayer) || (layer instanceof ShapeLayer) || (layer instanceof TextLayer);
};

MCP.trans.requireMovable = function (layer, role) {
    if (!MCP.trans.isAV(layer)) { MCP.fail("The " + role + " layer '" + layer.name + "' is a camera or light. Transitions need layers with a picture.", "invalid-argument"); }
    if (layer.locked) { MCP.fail("The " + role + " layer '" + layer.name + "' is locked. Unlock it first (set-layer-flags with locked false).", "invalid-argument"); }
    var pos = MCP.trans.tprop(layer, "ADBE Position");
    if (_mcpTry(function () { return pos.dimensionsSeparated; }, false)) {
        MCP.fail("The " + role + " layer '" + layer.name + "' has separated Position dimensions. Join them first (separate-dimensions with separate false).", "unsupported");
    }
};

/** Whole frames from args[name], else from fallback seconds (at least two frames). */
MCP.trans.frames = function (comp, args, name, fallbackSeconds) {
    if (MCP.isDefined(args[name])) { return Math.max(1, Math.round(Number(args[name]))); }
    return Math.max(2, Math.round(fallbackSeconds / MCP.frameDuration(comp)));
};

MCP.trans.timeBased = function (layer) {
    var src = _mcpTry(function () { return layer.source; }, null);
    if (!src) { return false; }
    if (_mcpTry(function () { return layer.timeRemapEnabled; }, false)) { return false; }
    if (src instanceof CompItem) { return true; }
    if (src instanceof FootageItem) {
        if (_mcpTry(function () { return src.mainSource.isStill; }, true)) { return false; }
        return _mcpTry(function () { return src.duration > 0; }, false);
    }
    return false;
};

/** Latest out point the layer can reach (its source's end), or a large number. */
MCP.trans.maxOut = function (layer) {
    if (!MCP.trans.timeBased(layer)) { return 1e7; }
    var st = _mcpTry(function () { return layer.stretch; }, 100) / 100;
    if (!(st > 0)) { return 1e7; }
    return layer.startTime + layer.source.duration * st;
};

/** Earliest in point the layer can reach (its start), or a very early time. */
MCP.trans.minIn = function (layer) {
    if (!MCP.trans.timeBased(layer)) { return -1e7; }
    var st = _mcpTry(function () { return layer.stretch; }, 100) / 100;
    if (!(st > 0)) { return -1e7; }
    return layer.startTime;
};

MCP.trans.frameText = function (comp, t) {
    return "frame " + MCP.frameOf(comp, t) + " (" + MCP.round(t, 3) + " s)";
};

/** Fails unless the layer has picture over [inT, outT] (null skips a side). */
MCP.trans.requireRange = function (comp, layer, inT, outT, why) {
    if (inT !== null && inT < MCP.trans.minIn(layer) - MCP.trans.EPS) {
        MCP.fail(why + ": '" + layer.name + "' must start by " + MCP.trans.frameText(comp, inT) + ", but its picture starts at " + MCP.trans.frameText(comp, MCP.trans.minIn(layer)) + ".", "invalid-argument");
    }
    if (outT !== null && outT > MCP.trans.maxOut(layer) + MCP.trans.EPS) {
        MCP.fail(why + ": '" + layer.name + "' must last until " + MCP.trans.frameText(comp, outT) + ", but its picture ends at " + MCP.trans.frameText(comp, MCP.trans.maxOut(layer)) + ".", "invalid-argument");
    }
};

/** Sets in and out points (null keeps one) and notes the change on the record entry. */
MCP.trans.trim = function (layer, entry, inT, outT) {
    if (inT !== null && Math.abs(layer.inPoint - inT) > MCP.trans.EPS) { layer.inPoint = inT; entry.changedIn = true; }
    if (outT !== null && Math.abs(layer.outPoint - outT) > MCP.trans.EPS) { layer.outPoint = outT; entry.changedOut = true; }
};

MCP.trans.dirVec = function (name) {
    var d = { "left": [-1, 0], "right": [1, 0], "up": [0, -1], "down": [0, 1] }[String(name || "left").toLowerCase()];
    if (!d) { MCP.fail("direction must be left, right, up or down.", "invalid-argument"); }
    return d;
};

/** Frame size along a direction vector. */
MCP.trans.span = function (comp, u) {
    return Math.abs(u[0]) * comp.width + Math.abs(u[1]) * comp.height;
};

MCP.trans.dist = function (a, b) {
    var s = 0;
    for (var i = 0; i < Math.min(a.length, b.length); i++) { s += (Number(a[i]) - Number(b[i])) * (Number(a[i]) - Number(b[i])); }
    return Math.sqrt(s);
};

/** An angle within 180 degrees of ref, so a turn takes the short way. */
MCP.trans.unwrap = function (a, ref) {
    var v = Number(a);
    while (v - ref > 180) { v -= 360; }
    while (v - ref < -180) { v += 360; }
    return v;
};

MCP.trans.lerp = function (a, b, p) {
    if (!MCP.isArray(a)) { return Number(a) + (Number(b) - Number(a)) * p; }
    var out = [];
    for (var i = 0; i < a.length; i++) { out.push(Number(a[i]) + (Number(b[i]) - Number(a[i])) * p); }
    return out;
};

/** Steepest slope of cubic-bezier(a, 0, 1 - b, 1), a and b in percent: the peak speed in units of the average speed. */
MCP.trans.peakSlope = function (a, b) {
    var x1 = a / 100, x2 = 1 - b / 100, best = 0;
    for (var i = 1; i < 400; i++) {
        var s = i / 400, u = 1 - s;
        var dx = 3 * u * u * x1 + 6 * u * s * (x2 - x1) + 3 * s * s * (1 - x2);
        var dy = 6 * s * u;
        if (dx > 1e-6 && dy / dx > best) { best = dy / dx; }
    }
    return best || 1;
};

/** Scale and Position of a layer scaled by f about comp point o and shifted by d, from rest values. */
MCP.trans.zoomPose = function (scaleRest, posRest, o, f, d) {
    var off = d || [0, 0];
    var s = MCP.animate.scaleXY(scaleRest, f, false);
    var p = [o[0] + (Number(posRest[0]) - o[0]) * f + off[0], o[1] + (Number(posRest[1]) - o[1]) * f + off[1]];
    if (MCP.isArray(posRest) && posRest.length > 2) { p.push(Number(posRest[2])); }
    return { scale: s, position: p };
};

/* ------------------------------------------------------------- coverage
 * A scene must cover the frame on every frame of a transition. A layer scaled
 * by f about o and shifted by d maps its rest rectangle R to o + (R - o) f + d.
 * Scale and Position share one ease, so f and d move together along the same
 * curve; the uncovered amount at an edge is then the value at the moved key
 * times (1 - progress), so covering at the keys covers every frame between. */

/** Largest scale a covering correction may reach: 300 %, or more when the call itself asked for more. */
MCP.trans.MAX_COVER = 3;

/** The rectangle a layer fills in its comp at time t, or null when it cannot be told (parent, rotation, no size). */
MCP.trans.restRect = function (layer, t) {
    if (_mcpTry(function () { return !!layer.parent; }, true)) { return null; }
    var rot = Number(MCP.animate.valueAt(MCP.trans.tprop(layer, "ADBE Rotate Z"), t));
    if (Math.abs(rot) > 1e-3) { return null; }
    var src = _mcpTry(function () { return layer.source; }, null);
    var box = null;
    if (src && Number(src.width) > 0 && Number(src.height) > 0) { box = { left: 0, top: 0, width: Number(src.width), height: Number(src.height) }; }
    else { box = _mcpTry(function () { return layer.sourceRectAtTime(t, false); }, null); }
    if (!box || !(box.width > 0) || !(box.height > 0)) { return null; }
    var a = MCP.animate.valueAt(MCP.trans.tprop(layer, "ADBE Anchor Point"), t);
    var p = MCP.animate.valueAt(MCP.trans.tprop(layer, "ADBE Position"), t);
    var s = MCP.animate.valueAt(MCP.trans.tprop(layer, "ADBE Scale"), t);
    var sx = Number(s[0]) / 100, sy = Number(s[1]) / 100;
    var x1 = Number(p[0]) + (box.left - Number(a[0])) * sx, x2 = Number(p[0]) + (box.left + box.width - Number(a[0])) * sx;
    var y1 = Number(p[1]) + (box.top - Number(a[1])) * sy, y2 = Number(p[1]) + (box.top + box.height - Number(a[1])) * sy;
    return { l: Math.min(x1, x2), r: Math.max(x1, x2), t: Math.min(y1, y2), b: Math.max(y1, y2) };
};

MCP.trans.covers = function (comp, R) {
    return !!R && R.l <= 0.5 && R.t <= 0.5 && R.r >= comp.width - 0.5 && R.b >= comp.height - 0.5;
};

/** A pivot inside both the layer's rectangle and the frame, so scaling up never pulls an edge into view. */
MCP.trans.coverPivot = function (comp, R, o) {
    return [MCP.clamp(Number(o[0]), Math.max(0, R.l), Math.min(comp.width, R.r)), MCP.clamp(Number(o[1]), Math.max(0, R.t), Math.min(comp.height, R.b))];
};

/** The smallest scale (at least 1) about o with shift d at which R still covers the frame. */
MCP.trans.minCoverScale = function (comp, R, o, d) {
    var off = d || [0, 0], f = 1;
    var need = function (num, den) {
        if (den <= 1e-9) { return num <= 1e-6 ? 1 : 1e9; }
        return num / den;
    };
    f = Math.max(f, need(o[0] + off[0], o[0] - R.l));
    f = Math.max(f, need(comp.width - o[0] - off[0], R.r - o[0]));
    f = Math.max(f, need(o[1] + off[1], o[1] - R.t));
    f = Math.max(f, need(comp.height - o[1] - off[1], R.b - o[1]));
    return f;
};

/** The shift closest to d at which R scaled by f about o covers the frame. */
MCP.trans.coverOffset = function (comp, R, o, f, d) {
    var out = [], axes = [[R.l, R.r, comp.width], [R.t, R.b, comp.height]];
    for (var i = 0; i < 2; i++) {
        var lo = axes[i][2] - o[i] - (axes[i][1] - o[i]) * f;
        var hi = -o[i] - (axes[i][0] - o[i]) * f;
        out.push(lo <= hi ? MCP.clamp(Number(d[i]), lo, hi) : (lo + hi) / 2);
    }
    return out;
};

MCP.trans.plus = function (v, d) {
    var out = [Number(v[0]) + d[0], Number(v[1]) + d[1]];
    if (MCP.isArray(v) && v.length > 2) { out.push(Number(v[2])); }
    return out;
};

MCP.trans.same = function (a, b) {
    if (MCP.isArray(a) && MCP.isArray(b)) {
        for (var i = 0; i < Math.min(a.length, b.length); i++) { if (Math.abs(Number(a[i]) - Number(b[i])) > 1e-3) { return false; } }
        return true;
    }
    return Math.abs(Number(a) - Number(b)) <= 1e-3;
};

MCP.trans.layerById = function (comp, id) {
    if (!MCP.isDefined(id)) { return null; }
    for (var i = 1; i <= comp.numLayers; i++) {
        if (_mcpTry(function () { return comp.layer(i).id; }, null) === Number(id)) { return comp.layer(i); }
    }
    return null;
};

/** Runs fn with the layer unlocked, then restores the lock. */
MCP.trans.unlocked = function (layer, fn) {
    var was = !!layer.locked;
    if (was) { layer.locked = false; }
    try { return fn(); } finally { if (was) { try { layer.locked = true; } catch (e) {} } }
};

/* ----------------------------------------------------------------- probe */

/**
 * Measures points through toComp with a temporary disabled shape layer at the
 * bottom of the comp whose Position holds an expression. Expressions name
 * layers by index, and the probe sits below them all, so their indices hold.
 * close() removes it.
 */
MCP.trans.PROBE_NAME = "MCP probe";

MCP.trans.probe = function (comp) {
    var h = { id: null };
    /** The probe layer, found by its id (never by index). */
    h.layer = function () {
        var L = h.id === null ? null : MCP.trans.layerById(comp, h.id);
        return L && L.name === MCP.trans.PROBE_NAME ? L : null;
    };
    h.measure = function (code, t) {
        if (h.id === null) {
            // Added on first use and moved to the bottom at once, so every other layer keeps its index.
            var before = MCP.trans.idSet(comp);
            comp.layers.addShape();
            var made = MCP.trans.newLayers(comp, before);
            if (made.length !== 1) { MCP.trans.removeLayers(made); MCP.fail("Could not add the measuring layer.", "script-error"); }
            h.id = made[0].id;
            made[0].name = MCP.trans.PROBE_NAME;
            made[0].enabled = false;
            made[0].moveToEnd();
        }
        var host = h.layer();
        if (!host) { MCP.fail("The measuring layer disappeared.", "script-error"); }
        var p = host.property("ADBE Transform Group").property("ADBE Position");
        var v = null, err = "";
        try {
            p.expression = code;
            v = p.valueAtTime(t, false);
            err = _mcpTry(function () { return p.expressionError || ""; }, "");
        } catch (e) { err = e.toString(); }
        try { p.expression = ""; } catch (e2) {}
        if (err || !MCP.isArray(v)) { MCP.fail("Could not measure a layer through toComp: " + (err || "no value") + ".", "script-error"); }
        return [Number(v[0]), Number(v[1])];
    };
    h.close = function () {
        var L = h.layer();
        if (L) { try { L.remove(); } catch (e) {} }
        h.id = null;
    };
    return h;
};

/** {id: true} for every layer of comp. */
MCP.trans.idSet = function (comp) {
    var s = {};
    for (var i = 1; i <= comp.numLayers; i++) { s[comp.layer(i).id] = true; }
    return s;
};

/** Layers of comp whose ids are not in before: the ones a call just added, wherever After Effects put them. */
MCP.trans.newLayers = function (comp, before) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) { if (!before[comp.layer(i).id]) { out.push(comp.layer(i)); } }
    return out;
};

MCP.trans.removeLayers = function (list) {
    for (var i = 0; i < list.length; i++) { try { list[i].locked = false; list[i].remove(); } catch (e) {} }
};

/** The comment tag a helper layer of transition id carries. */
MCP.trans.tag = function (kind, id) {
    return "[" + kind + " " + id + "]";
};

/** True when layer carries the helper tag of record id: only such layers are ever deleted. */
MCP.trans.isOwnHelper = function (layer, id) {
    var c = String(_mcpTry(function () { return layer.comment; }, "") || "");
    return c === MCP.trans.tag("transition", id) || c === MCP.trans.tag("carry", id);
};

/** Expression source mapping a point in the element's layer space to this comp at master time tm. */
MCP.trans.chainExpr = function (el, pt, ts, tm) {
    var n = MCP.expr.num;
    var p = "[" + n(pt[0]) + ", " + n(pt[1]) + "]";
    if (el.scene) {
        return "var L = thisComp.layer(" + el.scene.index + ");\n" +
            "var E = L.source.layer(" + el.layer.index + ");\n" +
            "var q = E.toComp(" + p + ", " + n(ts) + ");\n" +
            "var r = L.toComp([q[0], q[1]], " + n(tm) + ");\n" +
            "[r[0], r[1]]";
    }
    return "var E = thisComp.layer(" + el.layer.index + ");\nvar r = E.toComp(" + p + ", " + n(tm) + ");\n[r[0], r[1]]";
};

/** Time inside a scene layer's comp for master time tm. */
MCP.trans.innerTime = function (scene, tm) {
    var st = _mcpTry(function () { return scene.stretch; }, 100) / 100;
    if (!st) { st = 1; }
    return (tm - scene.startTime) / st;
};

/** {scene, comp, layer} for an element ref inside a scene layer's comp, or in comp itself when scene is null. */
MCP.trans.element = function (comp, scene, ref, role) {
    if (scene) {
        var src = _mcpTry(function () { return scene.source; }, null);
        if (!(src instanceof CompItem)) {
            MCP.fail("The " + role + " layer '" + scene.name + "' is not a precomp, so the element must be a layer of '" + comp.name + "' itself (leave scene out).", "invalid-argument");
        }
        var inner = MCP.resolveLayer(src, ref);
        if (!MCP.trans.isAV(inner)) { MCP.fail("The " + role + " element '" + inner.name + "' is a camera or light.", "invalid-argument"); }
        return { scene: scene, comp: src, layer: inner };
    }
    var L = MCP.resolveLayer(comp, ref);
    if (!MCP.trans.isAV(L)) { MCP.fail("The " + role + " element '" + L.name + "' is a camera or light.", "invalid-argument"); }
    return { scene: null, comp: comp, layer: L };
};

/** Element lookup for add-transition: inside the scene layer when it is a precomp, else in this comp. */
MCP.trans.elementIn = function (comp, sceneLayer, ref, role) {
    var src = _mcpTry(function () { return sceneLayer.source; }, null);
    return MCP.trans.element(comp, src instanceof CompItem ? sceneLayer : null, ref, role);
};

/**
 * Pose of an element in this comp at master time tm: the anchor point's
 * position, x and y scale in percent, rotation in degrees, the content's
 * centre, width, height and size (square root of the area).
 */
MCP.trans.pose = function (comp, el, tm, probe) {
    var L = el.layer;
    var ts = el.scene ? MCP.trans.innerTime(el.scene, tm) : tm;
    var a = MCP.animate.valueAt(MCP.trans.tprop(L, "ADBE Anchor Point"), ts);
    var rect = _mcpTry(function () { return L.sourceRectAtTime(ts, false); }, null);
    var w = 0, h = 0, cx = Number(a[0]), cy = Number(a[1]);
    if (rect && rect.width > 0 && rect.height > 0) {
        w = rect.width; h = rect.height; cx = rect.left + w / 2; cy = rect.top + h / 2;
    } else {
        w = _mcpTry(function () { return L.width; }, 0) || 100;
        h = _mcpTry(function () { return L.height; }, 0) || 100;
    }
    var pa = probe.measure(MCP.trans.chainExpr(el, [a[0], a[1]], ts, tm), tm);
    var px = probe.measure(MCP.trans.chainExpr(el, [Number(a[0]) + 100, a[1]], ts, tm), tm);
    var py = probe.measure(MCP.trans.chainExpr(el, [a[0], Number(a[1]) + 100], ts, tm), tm);
    var pc = probe.measure(MCP.trans.chainExpr(el, [cx, cy], ts, tm), tm);
    var sx = MCP.trans.dist(px, pa), sy = MCP.trans.dist(py, pa);
    var rot = Math.atan2(px[1] - pa[1], px[0] - pa[0]) * 180 / Math.PI;
    var ww = w * sx / 100, hh = h * sy / 100;
    return {
        position: pa, scale: [sx, sy], rotation: rot, center: pc,
        width: ww, height: hh, size: Math.sqrt(Math.abs(ww * hh)) || 1,
        local: { anchor: [Number(a[0]), Number(a[1])], center: [cx, cy], width: w, height: h }
    };
};

MCP.trans.poseOut = function (p) {
    return { position: MCP.roundValue(p.position, 2), center: MCP.roundValue(p.center, 2), scale: MCP.roundValue(p.scale, 2), rotation: MCP.round(p.rotation, 2), size: MCP.round(p.size, 2) };
};

/** Comp point for an origin spec: [x, y], {layer, from}, or the comp centre. */
MCP.trans.originPoint = function (comp, spec, A, B, tA, tB, probe) {
    if (!MCP.isDefined(spec)) { return { point: [comp.width / 2, comp.height / 2], pose: null }; }
    if (MCP.isArray(spec)) { return { point: [Number(spec[0]), Number(spec[1])], pose: null }; }
    var from = String(MCP.arg(spec, "from", "comp"));
    var el, t;
    if (from === "outgoing") { el = MCP.trans.elementIn(comp, A, MCP.requireArg(spec, "layer"), "outgoing"); t = tA; }
    else if (from === "incoming") { el = MCP.trans.elementIn(comp, B, MCP.requireArg(spec, "layer"), "incoming"); t = tB; }
    else if (from === "comp") { el = MCP.trans.element(comp, null, MCP.requireArg(spec, "layer"), "origin"); t = tA; }
    else { MCP.fail("origin.from must be comp, outgoing or incoming.", "invalid-argument"); }
    var p = MCP.trans.pose(comp, el, t, probe);
    return { point: p.center, pose: p };
};

/* ------------------------------------------------------------------- keys */

/** Notes the keys about to be written on prop at times, so remove-transition can take exactly those away. */
MCP.trans.noteKeys = function (entry, prop, times, T, notes) {
    var k = { path: MCP.pathOf(prop).matchPath, times: [], shared: [], hadKeys: prop.numKeys > 0, rest: null };
    if (!k.hadKeys) { k.rest = MCP.roundValue(MCP.serialize.rawValue(prop.value), 6); }
    var lo = times[0], hi = times[times.length - 1], i;
    for (i = 0; i < times.length; i++) {
        var rel = MCP.round(times[i] - T, 6);
        k.times.push(rel);
        if (MCP.easing.keyIndexAtTime(prop, times[i], 1e-3) > 0) { k.shared.push(rel); }
    }
    for (i = 1; i <= prop.numKeys; i++) {
        var kt = prop.keyTime(i);
        if (kt > lo + 1e-3 && kt < hi - 1e-3) {
            notes.push("'" + entry.name + "' already had a key on " + MCP.pathOf(prop).path + " inside the transition (at " + MCP.round(kt, 3) + " s); the new keys mix with it.");
            break;
        }
    }
    entry.keys.push(k);
};

MCP.trans.keysOut = function (prop, times) {
    return { property: MCP.pathOf(prop).path, keys: MCP.animate.keysAt(prop, times) };
};

/** Two speed-0 keys; ease {outInfluence, inInfluence} shapes the whole segment. */
MCP.trans.move2 = function (entry, prop, t0, v0, t1, v1, ease, T, notes, out) {
    if (MCP.trans.same(v0, v1)) { return; }
    MCP.trans.noteKeys(entry, prop, [t0, t1], T, notes);
    MCP.easing.setKey(prop, t0, v0);
    var i1 = MCP.easing.setKey(prop, t1, v1);
    MCP.easing.applySegment(prop, i1, { type: "custom", outSpeed: 0, outInfluence: ease.outInfluence, inSpeed: 0, inInfluence: ease.inInfluence });
    var r = MCP.trans.keysOut(prop, [t0, t1]);
    r.layer = MCP.serialize.layerRef(entry.layerObj);
    out.push(r);
};

/**
 * Three keys t0 -> tc -> t2. The ends have speed 0; the key at tc passes
 * through with speed 2 * delta / duration on each side (signed per dimension
 * for non-spatial values, so a value that turns at tc keeps moving through
 * it). e: {a1, b1, a2, b2} influences: leaving t0, arriving at tc, leaving
 * tc, arriving at t2.
 */
MCP.trans.move3 = function (entry, prop, t0, v0, tc, vc, t2, v2, e, T, notes, out) {
    if (MCP.trans.same(v0, vc) && MCP.trans.same(vc, v2)) { return; }
    MCP.trans.noteKeys(entry, prop, [t0, tc, t2], T, notes);
    var spatial = _mcpTry(function () { return !!prop.isSpatial; }, false);
    MCP.easing.setKey(prop, t0, v0);
    MCP.easing.setKey(prop, tc, vc);
    MCP.easing.setKey(prop, t2, v2);
    var i0 = MCP.easing.keyIndexAtTime(prop, t0, 1e-3), ic = MCP.easing.keyIndexAtTime(prop, tc, 1e-3), i2 = MCP.easing.keyIndexAtTime(prop, t2, 1e-3);
    var d1 = Math.max(1e-4, tc - t0), d2 = Math.max(1e-4, t2 - tc);
    var n = MCP.easing.dims(prop), inS = [], outS = [], k;
    if (spatial) {
        inS.push(2 * MCP.trans.dist(MCP.isArray(v0) ? v0 : [v0], MCP.isArray(vc) ? vc : [vc]) / d1);
        outS.push(2 * MCP.trans.dist(MCP.isArray(vc) ? vc : [vc], MCP.isArray(v2) ? v2 : [v2]) / d2);
    } else {
        for (k = 0; k < n; k++) {
            var a = MCP.isArray(v0) ? Number(v0[k]) : Number(v0);
            var c = MCP.isArray(vc) ? Number(vc[k]) : Number(vc);
            var b = MCP.isArray(v2) ? Number(v2[k]) : Number(v2);
            inS.push(2 * (c - a) / d1);
            outS.push(2 * (b - c) / d2);
        }
    }
    var B = KeyframeInterpolationType.BEZIER;
    var zeros = [], z;
    for (z = 0; z < inS.length; z++) { zeros.push(0); }
    var mk = function (speeds, infl) {
        var arr = [];
        for (var q = 0; q < speeds.length; q++) { arr.push(new KeyframeEase(speeds[q], MCP.easing.clampInfluence(infl))); }
        return arr;
    };
    try { prop.setTemporalAutoBezierAtKey(ic, false); prop.setTemporalContinuousAtKey(ic, false); } catch (e0) {}
    MCP.easing.setInterp(prop, i0, null, B);
    MCP.easing.setInterp(prop, ic, B, B);
    MCP.easing.setInterp(prop, i2, B, null);
    MCP.easing.setTemporalEase(prop, i0, prop.keyInTemporalEase(i0), mk(zeros, e.a1));
    MCP.easing.setTemporalEase(prop, ic, mk(inS, e.b1), mk(outS, e.a2));
    MCP.easing.setTemporalEase(prop, i2, mk(zeros, e.b2), prop.keyOutTemporalEase(i2));
    var r = MCP.trans.keysOut(prop, [t0, tc, t2]);
    r.layer = MCP.serialize.layerRef(entry.layerObj);
    out.push(r);
};

/** Scale and Position of layer from its rest values to a zoom by f about o (and shift d), or back. */
MCP.trans.zoomKeys = function (entry, layer, t0, t1, o, f, d, outgoing, T, notes, out) {
    var sp = MCP.trans.tprop(layer, "ADBE Scale"), pp = MCP.trans.tprop(layer, "ADBE Position");
    var tRest = outgoing ? t0 : t1;
    // Coverage safety net: a layer that fills the frame at rest keeps filling it at the moved key.
    var comp = layer.containingComp, R = MCP.trans.restRect(layer, tRest);
    if (MCP.trans.covers(comp, R)) {
        var oc = MCP.trans.coverPivot(comp, R, o);
        if (Math.abs(oc[0] - o[0]) > 1e-6 || Math.abs(oc[1] - o[1]) > 1e-6) {
            notes.push("The pivot of '" + layer.name + "' was moved into the frame to " + JSON.stringify(MCP.roundValue(oc, 1)) + " so scaling never shows its edge.");
            o = oc;
        }
        var need = MCP.trans.minCoverScale(comp, R, o, d);
        if (f < need - 1e-6) {
            notes.push("'" + layer.name + "' scales to " + MCP.round(need * 100, 1) + " % instead of " + MCP.round(f * 100, 1) + " % so it keeps covering the frame.");
            f = need;
        }
    }
    var sR = MCP.animate.valueAt(sp, tRest), pR = MCP.animate.valueAt(pp, tRest);
    var z = MCP.trans.zoomPose(sR, pR, o, f, d);
    var ease = outgoing ? MCP.trans.EASE_OUT : MCP.trans.EASE_IN;
    if (outgoing) {
        MCP.trans.move2(entry, sp, t0, sR, t1, z.scale, ease, T, notes, out);
        MCP.trans.move2(entry, pp, t0, pR, t1, z.position, ease, T, notes, out);
    } else {
        MCP.trans.move2(entry, sp, t0, z.scale, t1, sR, ease, T, notes, out);
        MCP.trans.move2(entry, pp, t0, z.position, t1, pR, ease, T, notes, out);
    }
    return { f: f, pivot: o, rest: { scale: MCP.roundValue(sR, 3), position: MCP.roundValue(pR, 3) }, moved: { scale: MCP.roundValue(z.scale, 3), position: MCP.roundValue(z.position, 3) } };
};

/** Position from rest by an offset (outgoing: rest -> rest + d; incoming: rest + d -> rest). */
MCP.trans.slideKeys = function (entry, layer, t0, t1, d, outgoing, T, notes, out) {
    var pp = MCP.trans.tprop(layer, "ADBE Position");
    var pR = MCP.animate.valueAt(pp, outgoing ? t0 : t1);
    var moved = MCP.trans.plus(pR, d);
    if (outgoing) { MCP.trans.move2(entry, pp, t0, pR, t1, moved, MCP.trans.EASE_OUT, T, notes, out); }
    else { MCP.trans.move2(entry, pp, t0, moved, t1, pR, MCP.trans.EASE_IN, T, notes, out); }
};

/* ---------------------------------------------------------------- effects */

/** Adds a named effect for this transition and returns its name (fetch it by name; references go stale). */
MCP.trans.addEffect = function (layer, entry, matchName, label, id) {
    var parade = MCP.effectsGroup(layer);
    if (!parade.canAddProperty(matchName)) { MCP.fail("This After Effects cannot add the effect " + matchName + ".", "unsupported"); }
    var fx = parade.addProperty(matchName);
    var name = "Transition " + id + " " + label;
    fx.name = name;
    entry.effects.push(name);
    return name;
};

MCP.trans.fxProp = function (layer, fxName, matchName) {
    return MCP.effectsGroup(layer).property(fxName).property(matchName);
};

/** Gaussian Blur (Repeat Edge Pixels on) keyed from a to b. */
MCP.trans.blurKeys = function (layer, entry, id, t0, t1, a, b, ease, out) {
    var name = MCP.trans.addEffect(layer, entry, "ADBE Gaussian Blur 2", "Blur", id);
    try { MCP.trans.fxProp(layer, name, "ADBE Gaussian Blur 2-0003").setValue(1); } catch (e) {}
    var p = MCP.trans.fxProp(layer, name, "ADBE Gaussian Blur 2-0001");
    MCP.easing.setKey(p, t0, a);
    var i1 = MCP.easing.setKey(p, t1, b);
    MCP.easing.applySegment(p, i1, { type: "custom", outSpeed: 0, outInfluence: ease.outInfluence, inSpeed: 0, inInfluence: ease.inInfluence });
    var r = MCP.trans.keysOut(p, [t0, t1]);
    r.layer = MCP.serialize.layerRef(layer);
    out.push(r);
    return name;
};

/** Motion Tile with Mirror Edges, wide and tall enough that a move by off = [dx, dy] never shows the layer's edge. */
MCP.trans.tile = function (comp, layer, entry, id, off) {
    var name = MCP.trans.addEffect(layer, entry, "ADBE Tile", "Edges", id);
    var ow = 100 + Math.min(1800, 200 * Math.ceil(Math.abs(Number(off[0])) / comp.width - 1e-9));
    var oh = 100 + Math.min(1800, 200 * Math.ceil(Math.abs(Number(off[1])) / comp.height - 1e-9));
    try { MCP.trans.fxProp(layer, name, "ADBE Tile-0004").setValue(ow); } catch (e1) {}
    try { MCP.trans.fxProp(layer, name, "ADBE Tile-0005").setValue(oh); } catch (e2) {}
    try { MCP.trans.fxProp(layer, name, "ADBE Tile-0006").setValue(1); } catch (e3) {}
    return name;
};

/* ---------------------------------------------------------------- records */

MCP.trans.params = function (mv) {
    var p = null;
    try { p = mv.getParameters(); } catch (e) { p = null; }
    return p || {};
};

/** Every record in the comp: [{record, anchor, markerIndex, time}]. */
MCP.trans.records = function (comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        var mp = _mcpTry(function () { return L.property("ADBE Marker"); }, null);
        if (!mp) { continue; }
        for (var k = 1; k <= mp.numKeys; k++) {
            var raw = MCP.trans.params(mp.keyValue(k))[MCP.trans.KEY];
            if (!MCP.isDefined(raw)) { continue; }
            var rec = null;
            try { rec = JSON.parse(String(raw)); } catch (e) { rec = null; }
            if (!rec || !rec.id) { continue; }
            out.push({ record: rec, anchor: L, markerIndex: k, time: mp.keyTime(k) });
        }
    }
    return out;
};

MCP.trans.findRecord = function (comp, id) {
    var all = MCP.trans.records(comp);
    for (var i = 0; i < all.length; i++) { if (all[i].record.id === String(id)) { return all[i]; } }
    return null;
};

/** The record joining layers A and B (by id), if any. */
MCP.trans.findPair = function (comp, A, B) {
    var all = MCP.trans.records(comp);
    for (var i = 0; i < all.length; i++) {
        var r = all[i].record;
        if (r.kind !== "carry" && r.outgoing && r.incoming && r.outgoing.id === A.id && r.incoming.id === B.id) { return all[i]; }
    }
    return null;
};

/** True when a layer has a marker at time t that is not a record. */
MCP.trans.markerBusy = function (layer, t) {
    var mp = _mcpTry(function () { return layer.property("ADBE Marker"); }, null);
    if (!mp || !mp.numKeys) { return false; }
    var k = MCP.easing.keyIndexAtTime(mp, t, 1e-3);
    return k > 0;
};

MCP.trans.writeRecord = function (layer, t, rec, comment) {
    var mv = new MarkerValue(comment);
    var params = {};
    params[MCP.trans.KEY] = JSON.stringify(rec);
    mv.setParameters(params);
    MCP.trans.unlocked(layer, function () { layer.property("ADBE Marker").setValueAtTime(t, mv); });
};

/** Starts the record entry for a layer (times relative to the cut T). */
MCP.trans.track = function (rec, layer, role, T) {
    var e = {
        id: layer.id, name: layer.name, role: role,
        inRel: MCP.round(layer.inPoint - T, 6), outRel: MCP.round(layer.outPoint - T, 6),
        changedIn: false, changedOut: false,
        motionBlur: _mcpTry(function () { return !!layer.motionBlur; }, false),
        keys: [], effects: [], matte: false, created: false
    };
    rec.layers.push(e);
    e.layerObj = layer;
    return e;
};

/** A copy of the record without live object references, for JSON. */
MCP.trans.clean = function (rec) {
    var out = MCP.extend({}, rec);
    out.layers = [];
    for (var i = 0; i < rec.layers.length; i++) {
        var e = MCP.extend({}, rec.layers[i]);
        delete e.layerObj;
        out.layers.push(e);
    }
    return out;
};

/** Planned kind for a scene layer from the scene plan's marker, if any. */
MCP.trans.plannedKind = function (comp, layer) {
    if (!MCP.scenes || !MCP.scenes.sceneMarkers) { return null; }
    var src = _mcpTry(function () { return layer.source; }, null);
    if (!(src instanceof CompItem)) { return null; }
    var m = _mcpTry(function () { return MCP.scenes.sceneMarkers(comp)[src.id]; }, null);
    return m && m.transition && MCP.trans.KINDS[m.transition] ? m.transition : null;
};

MCP.trans.motionBlurOn = function (comp, rec, layers) {
    for (var i = 0; i < layers.length; i++) { try { layers[i].motionBlur = true; } catch (e) {} }
    try { comp.motionBlur = true; } catch (e2) {}
};

/* ------------------------------------------------------------------ carry */

/**
 * Checks and measures a carry before anything is written.
 * o: {comp, outEl, inEl, target, T, t0, t2, fo, fi, source, useLayer, name, cutProgress}
 */
MCP.trans.prepareCarry = function (o, probe) {
    var c = o.comp;
    var prep = { o: o };
    prep.p1 = MCP.trans.pose(c, o.outEl, o.t0, probe);
    if (o.inEl) {
        prep.p2 = MCP.trans.pose(c, o.inEl, o.t2, probe);
    } else {
        var tp = o.target;
        var f = MCP.num(tp.scale, 100) / 100;
        prep.p2 = { center: [Number(tp.position[0]), Number(tp.position[1])], size: prep.p1.size * f, rotation: MCP.num(tp.rotation, prep.p1.rotation), position: null, scale: null };
    }
    if (o.useLayer) {
        if (!MCP.trans.isAV(o.useLayer)) { MCP.fail("The carry layer '" + o.useLayer.name + "' is a camera or light.", "invalid-argument"); }
        if (o.useLayer.locked) { MCP.fail("The carry layer '" + o.useLayer.name + "' is locked. Unlock it first.", "invalid-argument"); }
        if (o.useLayer.parent) { MCP.fail("The carry layer '" + o.useLayer.name + "' has a parent; its pose is keyed in composition space. Clear the parent first (clear-layer-parent).", "invalid-argument"); }
        prep.content = MCP.trans.pose(c, { scene: null, comp: c, layer: o.useLayer }, o.T, probe);
    } else {
        var srcEl = o.source === "incoming" ? o.inEl : o.outEl;
        prep.srcEl = srcEl;
        prep.content = o.source === "incoming" ? prep.p2 : prep.p1;
        var copyStart = srcEl.scene ? srcEl.scene.startTime + srcEl.layer.startTime : srcEl.layer.startTime;
        if (MCP.trans.timeBased(srcEl.layer)) {
            var st = _mcpTry(function () { return srcEl.layer.stretch; }, 100) / 100;
            var srcEnd = copyStart + srcEl.layer.source.duration * (st > 0 ? st : 1);
            if (o.t0 < copyStart - MCP.trans.EPS || o.t2 > srcEnd + MCP.trans.EPS) {
                MCP.fail("The element '" + srcEl.layer.name + "' has picture only from " + MCP.trans.frameText(c, copyStart) + " to " + MCP.trans.frameText(c, srcEnd) + " in this comp, but the carry runs from " + MCP.trans.frameText(c, o.t0) + " to " + MCP.trans.frameText(c, o.t2) + ". Shorten framesOut or framesIn, or use the other element as source.", "invalid-argument");
            }
        }
        prep.copyStart = copyStart;
    }
    return prep;
};

/** Carry-layer transform values that put the content's centre at state.center with state.size and state.rotation. */
MCP.trans.carryValues = function (prep, state, layer) {
    var content = prep.content;
    var k = state.size / content.size;
    var base = prep.o.useLayer ? MCP.animate.valueAt(MCP.trans.tprop(layer, "ADBE Scale"), prep.o.T) : content.scale;
    var scale = [Number(base[0]) * k, Number(base[1]) * k];
    var loc = content.local;
    var vx = (loc.center[0] - loc.anchor[0]) * scale[0] / 100, vy = (loc.center[1] - loc.anchor[1]) * scale[1] / 100;
    var r = state.rotation * Math.PI / 180;
    var px = state.center[0] - (vx * Math.cos(r) - vy * Math.sin(r));
    var py = state.center[1] - (vx * Math.sin(r) + vy * Math.cos(r));
    var sv = MCP.animate.valueAt(MCP.trans.tprop(layer, "ADBE Scale"), prep.o.T);
    if (MCP.isArray(sv) && sv.length > 2) { scale.push(Number(sv[2])); }
    var pv = MCP.animate.valueAt(MCP.trans.tprop(layer, "ADBE Position"), prep.o.T);
    var pos = [px, py];
    if (MCP.isArray(pv) && pv.length > 2) { pos.push(Number(pv[2])); }
    return { position: pos, scale: scale, rotation: state.rotation };
};

/** Hides an original element for the handover: out point (outgoing) or in point (incoming), in its own comp time. */
MCP.trans.hideOriginal = function (rec, el, edge, tMaster) {
    var L = el.layer;
    var t = el.scene ? MCP.trans.innerTime(el.scene, tMaster) : tMaster;
    var entry = { compId: el.comp.id, layerId: L.id, name: L.name, edge: edge, inPoint: MCP.round(L.inPoint, 6), outPoint: MCP.round(L.outPoint, 6), changed: false };
    MCP.trans.unlocked(L, function () {
        if (edge === "out" && L.outPoint > t + MCP.trans.EPS && L.inPoint < t - MCP.trans.EPS) { L.outPoint = t; entry.changed = true; }
        if (edge === "in" && L.inPoint < t - MCP.trans.EPS && L.outPoint > t + MCP.trans.EPS) { L.inPoint = t; entry.changed = true; }
    });
    if (entry.changed) { rec.inner.push(entry); }
    return entry;
};

/**
 * Writes the carry: poses at the cut (after the scene keys exist), the carry
 * layer, its three keys per property, and the trims of the originals.
 */
MCP.trans.writeCarry = function (prep, probe, rec, id, notes, keysOut) {
    var o = prep.o, c = o.comp;
    var cutA = MCP.trans.pose(c, o.outEl, o.T, probe);
    var cutB = o.inEl ? MCP.trans.pose(c, o.inEl, o.T, probe) : null;
    var aligned = !!cutB && MCP.trans.dist(cutA.center, cutB.center) <= Math.max(2, 0.002 * c.width) && Math.abs(cutA.size / cutB.size - 1) <= 0.03;
    var p = MCP.isDefined(o.cutProgress) ? Number(o.cutProgress) : o.fo / (o.fo + o.fi);
    var s1 = { center: prep.p1.center, size: prep.p1.size, rotation: prep.p1.rotation };
    var s2 = { center: prep.p2.center, size: prep.p2.size, rotation: o.inEl ? MCP.trans.unwrap(prep.p2.rotation, prep.p1.rotation) : prep.p2.rotation };
    var sc = aligned ? { center: cutA.center, size: cutA.size, rotation: MCP.trans.unwrap(cutA.rotation, prep.p1.rotation) } :
        { center: MCP.trans.lerp(s1.center, s2.center, p), size: MCP.trans.lerp(s1.size, s2.size, p), rotation: MCP.trans.lerp(s1.rotation, s2.rotation, p) };

    var L, created = false, entry;
    if (o.useLayer) {
        L = o.useLayer;
        entry = MCP.trans.track(rec, L, "carry", o.T);
    } else {
        var el = prep.srcEl;
        // The copy is found by the layer ids that are new afterwards, never by index: copyToComp and
        // duplicate do not promise where the new layer goes.
        var before = MCP.trans.idSet(c);
        if (el.scene) { el.layer.copyToComp(c); } else { el.layer.duplicate(); }
        var made = MCP.trans.newLayers(c, before);
        if (made.length !== 1) {
            MCP.trans.removeLayers(made);
            MCP.fail("Copying '" + el.layer.name + "' into '" + c.name + "' gave " + made.length + " new layers instead of one; nothing was kept.", "script-error");
        }
        L = made[0];
        if (L.locked) { L.locked = false; }
        // Tag and track the copy at once, so an error from here on removes it again.
        L.comment = MCP.trans.tag("carry", id);
        created = true;
        entry = MCP.trans.track(rec, L, "carry", o.T);
        entry.created = true;
        L.moveToBeginning();
        try { if (L.parent) { L.parent = null; } } catch (e0) {}
        if (_mcpTry(function () { return L.threeDLayer; }, false)) { L.threeDLayer = false; notes.push("The carried element is 3D; its copy is carried as a 2D layer."); }
        L.startTime = prep.copyStart;
        L.name = MCP.isDefined(o.name) ? String(o.name) : MCP.animate.uniqueLayerName(c, el.layer.name + " Carry");
        MCP.animate.clearProp(MCP.trans.tprop(L, "ADBE Position"));
        MCP.animate.clearProp(MCP.trans.tprop(L, "ADBE Scale"));
        MCP.animate.clearProp(MCP.trans.tprop(L, "ADBE Rotate Z"));
        if (o.t0 >= L.outPoint) { L.outPoint = o.t2; L.inPoint = o.t0; }
        else { L.inPoint = o.t0; L.outPoint = o.t2; }
        entry.name = L.name;
    }
    var v1 = MCP.trans.carryValues(prep, s1, L), vc = MCP.trans.carryValues(prep, sc, L), v2 = MCP.trans.carryValues(prep, s2, L);
    var e = { a1: 85, b1: 14, a2: 16.7, b2: 90 };
    MCP.trans.move3(entry, MCP.trans.tprop(L, "ADBE Position"), o.t0, v1.position, o.T, vc.position, o.t2, v2.position, e, o.T, notes, keysOut);
    MCP.trans.move3(entry, MCP.trans.tprop(L, "ADBE Scale"), o.t0, v1.scale, o.T, vc.scale, o.t2, v2.scale, e, o.T, notes, keysOut);
    MCP.trans.move3(entry, MCP.trans.tprop(L, "ADBE Rotate Z"), o.t0, v1.rotation, o.T, vc.rotation, o.t2, v2.rotation, e, o.T, notes, keysOut);
    try { L.motionBlur = true; } catch (e1) {}
    var hidden = [];
    if (!(o.useLayer && o.useLayer.id === o.outEl.layer.id)) { hidden.push(MCP.trans.hideOriginal(rec, o.outEl, "out", o.t0)); }
    if (o.inEl && !(o.useLayer && o.useLayer.id === o.inEl.layer.id)) { hidden.push(MCP.trans.hideOriginal(rec, o.inEl, "in", o.t2)); }
    var hiddenOut = [];
    for (var h = 0; h < hidden.length; h++) {
        hiddenOut.push({ comp: hidden[h].compId, layer: hidden[h].name, edge: hidden[h].edge, changed: hidden[h].changed });
        if (!hidden[h].changed) { notes.push("The original '" + hidden[h].name + "' was not visible across the handover, so it was not trimmed."); }
    }
    return {
        layer: MCP.serialize.layerRef(L), created: created, alignedAtCut: aligned, cutProgress: aligned ? null : MCP.round(p, 3),
        poses: { start: MCP.trans.poseOut(prep.p1), cut: { center: MCP.roundValue(sc.center, 2), size: MCP.round(sc.size, 2), rotation: MCP.round(sc.rotation, 2) }, end: { center: MCP.roundValue(s2.center, 2), size: MCP.round(s2.size, 2), rotation: MCP.round(s2.rotation, 2) } },
        hidden: hiddenOut
    };
};

/* ------------------------------------------------------------ the kinds */

MCP.trans.build = {};

/** match-cut: outgoing pushes in (or slides) accelerating; incoming opens oversized (or offset) and lands. */
MCP.trans.build["match-cut"] = function (x) {
    var mode = String(MCP.arg(x.args, "move", "scale"));
    if (mode !== "scale" && mode !== "position") { MCP.fail("move must be scale or position.", "invalid-argument"); }
    var info = { move: mode };
    var fA = 1 + 1.5 * x.intensity, fB = fA, oA = x.origin.point, oB = x.origin.point, d = [0, 0];
    if (x.carryPrep) {
        oA = x.carryPrep.p1.center;
        oB = x.carryPrep.p2.center;
    }
    if (mode === "scale") {
        var RA = MCP.trans.restRect(x.A, x.t0), RB = MCP.trans.restRect(x.B, x.t2);
        if (MCP.trans.covers(x.comp, RA)) { oA = MCP.trans.coverPivot(x.comp, RA, oA); }
        if (MCP.trans.covers(x.comp, RB)) { oB = MCP.trans.coverPivot(x.comp, RB, oB); }
        if (x.carryPrep) {
            // Line the elements up: the incoming element opens at the pushed-in size of the outgoing one, where it is.
            fB = fA * x.carryPrep.p1.size / x.carryPrep.p2.size;
            d = [oA[0] - oB[0], oA[1] - oB[1]];
        }
        if (fB > 12) { x.notes.push("The incoming would open at " + Math.round(fB * 100) + " %; capped at 1200 %."); fB = 12; }
        if (fB < 1.02) {
            if (x.carryPrep) { x.notes.push("The incoming element is larger than the outgoing one after the push-in, so the incoming cannot open oversized and line up; raise intensity so the outgoing grows to its size."); }
            fB = 1.02;
        }
        if (MCP.trans.covers(x.comp, RB)) {
            // The incoming must still cover the frame while it is shifted. Raise both scales together
            // (the elements keep matching) to the smallest that covers; past the limit, take the closest
            // covering pose: both scales as far as allowed and the incoming shifted only as far as covering lets.
            var need = MCP.trans.minCoverScale(x.comp, RB, oB, d);
            if (fB < need - 1e-6) {
                var limitA = Math.max(fA, MCP.trans.MAX_COVER), limitB = Math.max(fB, MCP.trans.MAX_COVER);
                var r = need / fB;
                if (fA * r <= limitA + 1e-6 && need <= limitB + 1e-6) {
                    x.notes.push("Both scenes scale " + MCP.round((r - 1) * 100, 1) + " % further (outgoing " + MCP.round(fA * r * 100, 1) + " %, incoming " + MCP.round(need * 100, 1) + " %) so the incoming covers the frame while the elements line up.");
                    fA = fA * r; fB = need;
                } else {
                    var rr = Math.min(limitA / fA, limitB / fB);
                    fA = fA * rr; fB = fB * rr;
                    var d2 = MCP.trans.coverOffset(x.comp, RB, oB, fB, d);
                    x.notes.push("Lining the elements up exactly would show the frame edge below " + MCP.round(MCP.trans.MAX_COVER * 100) + " %, so the incoming opens shifted by " + JSON.stringify(MCP.roundValue([d2[0] - d[0], d2[1] - d[1]], 1)) + " px from the exact match" + (x.carryPrep ? "; the carry layer bridges the difference." : "."));
                    d = d2;
                }
            }
        }
        if (fB > 2.5) { x.notes.push("The incoming opens at " + Math.round(fB * 100) + " %. A precomp renders at its own size, so turn on Collapse Transformations on vector scenes (set-layer-flags collapseTransformations) to keep them sharp."); }
        var za = MCP.trans.zoomKeys(x.ea, x.A, x.t0, x.T, oA, fA, null, true, x.T, x.notes, x.keys);
        var zb = MCP.trans.zoomKeys(x.eb, x.B, x.T, x.t2, oB, fB, d, false, x.T, x.notes, x.keys);
        info.outgoingScale = MCP.round(za.f * 100, 2);
        info.incomingScale = MCP.round(zb.f * 100, 2);
        info.pivots = { outgoing: MCP.roundValue(za.pivot, 2), incoming: MCP.roundValue(zb.pivot, 2) };
        info.incomingShift = MCP.roundValue(d, 2);
    } else {
        var u = MCP.trans.dirVec(x.args.direction);
        var span = MCP.trans.span(x.comp, u);
        var DA = 0.25 * span * x.intensity;
        var DB = DA * (x.fi / x.fo) * MCP.trans.peakSlope(85, 14) / MCP.trans.peakSlope(16.7, 90);
        DB = Math.min(DB, span);
        var offB = [-u[0] * DB, -u[1] * DB];
        if (x.carryPrep) {
            offB = [oA[0] + u[0] * DA - oB[0], oA[1] + u[1] * DA - oB[1]];
            DB = Math.sqrt(offB[0] * offB[0] + offB[1] * offB[1]);
        }
        info.travel = { outgoing: MCP.round(DA, 2), incoming: MCP.round(DB, 2) };
        MCP.trans.slideKeys(x.ea, x.A, x.t0, x.T, [u[0] * DA, u[1] * DA], true, x.T, x.notes, x.keys);
        MCP.trans.slideKeys(x.eb, x.B, x.T, x.t2, offB, false, x.T, x.notes, x.keys);
        // Mirrored tiles fill whatever the slide uncovers, on both axes.
        MCP.trans.tile(x.comp, x.A, x.ea, x.id, [u[0] * DA, u[1] * DA]);
        MCP.trans.tile(x.comp, x.B, x.eb, x.id, offB);
    }
    return info;
};

/** zoom-through: outgoing scales up fast with a blur peak at the cut; incoming arrives from slightly large, blur falling off. */
MCP.trans.build["zoom-through"] = function (x) {
    var fA = 1 + 3 * x.intensity, fB = 1 + 0.2 * x.intensity, blur = 40 * x.intensity;
    var oA = x.carryPrep ? x.carryPrep.p1.center : x.origin.point;
    var oB = x.carryPrep ? x.carryPrep.p2.center : x.origin.point;
    var za = MCP.trans.zoomKeys(x.ea, x.A, x.t0, x.T, oA, fA, null, true, x.T, x.notes, x.keys);
    var zb = MCP.trans.zoomKeys(x.eb, x.B, x.T, x.t2, oB, fB, null, false, x.T, x.notes, x.keys);
    MCP.trans.blurKeys(x.A, x.ea, x.id, x.t0, x.T, 0, blur, MCP.trans.EASE_OUT, x.keys);
    MCP.trans.blurKeys(x.B, x.eb, x.id, x.T, x.t2, blur, 0, MCP.trans.EASE_IN, x.keys);
    return { outgoingScale: MCP.round(za.f * 100, 2), incomingScale: MCP.round(zb.f * 100, 2), blurPeak: MCP.round(blur, 2), pivots: { outgoing: MCP.roundValue(za.pivot, 2), incoming: MCP.roundValue(zb.pivot, 2) } };
};

/** push: both layers slide edge to edge with the same three keys, fastest at the cut. */
MCP.trans.build.push = function (x) {
    var u = MCP.trans.dirVec(x.args.direction);
    var D = MCP.trans.span(x.comp, u);
    var p = x.fo / (x.fo + x.fi);
    var e = { a1: 60, b1: 25, a2: 25, b2: 85 };
    var pp = MCP.trans.tprop(x.A, "ADBE Position"), pa = MCP.animate.valueAt(pp, x.t0);
    MCP.trans.move3(x.ea, pp, x.t0, pa, x.T, MCP.trans.plus(pa, [u[0] * D * p, u[1] * D * p]), x.t2, MCP.trans.plus(pa, [u[0] * D, u[1] * D]), e, x.T, x.notes, x.keys);
    var pq = MCP.trans.tprop(x.B, "ADBE Position"), pb = MCP.animate.valueAt(pq, x.t2);
    MCP.trans.move3(x.eb, pq, x.t0, MCP.trans.plus(pb, [-u[0] * D, -u[1] * D]), x.T, MCP.trans.plus(pb, [-u[0] * D * (1 - p), -u[1] * D * (1 - p)]), x.t2, pb, e, x.T, x.notes, x.keys);
    return { travel: D, direction: String(x.args.direction || "left") };
};

/** shape-reveal: a growing circle or rounded rectangle shape layer is the incoming layer's alpha track matte. */
MCP.trans.build["shape-reveal"] = function (x) {
    var c = x.comp, A = x.A, B = x.B;
    var shape = String(MCP.arg(x.args, "shape", "circle"));
    if (shape !== "circle" && shape !== "rounded-rectangle") { MCP.fail("shape must be circle or rounded-rectangle.", "invalid-argument"); }
    var o = x.origin.point, op = x.origin.pose;
    var margin = 2 + 0.01 * Math.max(c.width, c.height);
    var r = MCP.num(x.args.roundness, Math.round(32 * c.height / 1080));
    var startSize, endSize;
    if (shape === "circle") {
        var R = Math.max(MCP.trans.dist(o, [0, 0]), MCP.trans.dist(o, [c.width, 0]), MCP.trans.dist(o, [0, c.height]), MCP.trans.dist(o, [c.width, c.height]));
        var s0 = op ? Math.min(op.width, op.height) : 0;
        startSize = [s0, s0];
        endSize = [2 * (R + margin), 2 * (R + margin)];
    } else {
        startSize = op ? [op.width, op.height] : [0, 0];
        endSize = [2 * (Math.max(o[0], c.width - o[0]) + margin + r), 2 * (Math.max(o[1], c.height - o[1]) + margin + r)];
    }
    if (B.index > A.index) {
        MCP.animate.placeAbove(B, A);
        x.eb.movedAboveId = A.id;
        x.notes.push("'" + B.name + "' was moved above '" + A.name + "' so the reveal shows it over the outgoing layer.");
    }
    var M = c.layers.addShape();
    // Tag and track the matte at once, so an error from here on removes it again.
    M.comment = MCP.trans.tag("transition", x.id);
    var em = MCP.trans.track(x.rec, M, "matte", x.T);
    em.created = true;
    M.name = MCP.animate.uniqueLayerName(c, "Transition " + x.id + " Matte");
    em.name = M.name;
    M.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
    M.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
    var grp = M.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    grp.name = "Reveal";
    M.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").addProperty(shape === "circle" ? "ADBE Vector Shape - Ellipse" : "ADBE Vector Shape - Rect");
    M.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
    var vg = M.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
    var path = vg.property(1);
    try { vg.property(2).property("ADBE Vector Fill Color").setValue([1, 1, 1, 1]); } catch (e0) {}
    var sizeProp, posMatch;
    if (shape === "circle") { sizeProp = path.property("ADBE Vector Ellipse Size"); posMatch = "ADBE Vector Ellipse Position"; }
    else { sizeProp = path.property("ADBE Vector Rect Size"); posMatch = "ADBE Vector Rect Position"; path.property("ADBE Vector Rect Roundness").setValue(r); }
    path.property(posMatch).setValue([o[0], o[1]]);
    MCP.easing.setKey(sizeProp, x.T, startSize);
    var i1 = MCP.easing.setKey(sizeProp, x.t2, endSize);
    MCP.easing.applySegment(sizeProp, i1, { type: "custom", outSpeed: 0, outInfluence: MCP.trans.EASE_IN.outInfluence, inSpeed: 0, inInfluence: MCP.trans.EASE_IN.inInfluence });
    var kr = MCP.trans.keysOut(sizeProp, [x.T, x.t2]);
    kr.layer = MCP.serialize.layerRef(M);
    x.keys.push(kr);
    M.inPoint = x.T;
    M.outPoint = Math.max(B.outPoint, x.t2);
    try { M.motionBlur = true; } catch (e1) {}
    MCP.animate.placeAbove(M, B);
    if (typeof B.setTrackMatte === "function") { B.setTrackMatte(M, TrackMatteType.ALPHA); }
    else { B.trackMatteType = TrackMatteType.ALPHA; }
    try { M.enabled = false; } catch (e2) {}
    x.eb.matte = true;
    x.helpers.push({ layer: MCP.serialize.layerRef(M), role: "matte" });
    return { shape: shape, origin: MCP.roundValue(o, 2), startSize: MCP.roundValue(startSize, 2), endSize: MCP.roundValue(endSize, 2), roundness: shape === "circle" ? null : r };
};

/** blur-swap: both blur, the swap at the blur peak, with a small breath of scale. */
MCP.trans.build["blur-swap"] = function (x) {
    var blur = 40 * x.intensity, fA = 1 + 0.04 * x.intensity, fB = 1 + 0.08 * x.intensity;
    var za = MCP.trans.zoomKeys(x.ea, x.A, x.t0, x.T, x.origin.point, fA, null, true, x.T, x.notes, x.keys);
    var zb = MCP.trans.zoomKeys(x.eb, x.B, x.T, x.t2, x.origin.point, fB, null, false, x.T, x.notes, x.keys);
    MCP.trans.blurKeys(x.A, x.ea, x.id, x.t0, x.T, 0, blur, MCP.trans.EASE_OUT, x.keys);
    MCP.trans.blurKeys(x.B, x.eb, x.id, x.T, x.t2, blur, 0, MCP.trans.EASE_IN, x.keys);
    return { blurPeak: MCP.round(blur, 2), outgoingScale: MCP.round(za.f * 100, 2), incomingScale: MCP.round(zb.f * 100, 2) };
};

/** whip: a fast pan, the speed spike on the cut, matched speed on both sides, edges filled by Motion Tile. */
MCP.trans.build.whip = function (x) {
    var u = MCP.trans.dirVec(x.args.direction);
    var span = MCP.trans.span(x.comp, u);
    var DA = 0.75 * span * x.intensity;
    var DB = DA * (x.fi / x.fo) * MCP.trans.peakSlope(85, 14) / MCP.trans.peakSlope(16.7, 90);
    DB = Math.max(0.25 * span, Math.min(DB, 2 * span));
    MCP.trans.slideKeys(x.ea, x.A, x.t0, x.T, [u[0] * DA, u[1] * DA], true, x.T, x.notes, x.keys);
    MCP.trans.slideKeys(x.eb, x.B, x.T, x.t2, [-u[0] * DB, -u[1] * DB], false, x.T, x.notes, x.keys);
    MCP.trans.tile(x.comp, x.A, x.ea, x.id, [u[0] * DA, u[1] * DA]);
    MCP.trans.tile(x.comp, x.B, x.eb, x.id, [-u[0] * DB, -u[1] * DB]);
    if (_mcpTry(function () { return x.comp.motionBlurSamplesPerFrame; }, 16) < 32) {
        x.notes.push("A whip streaks best with more motion blur samples: set-composition-settings motionBlurSamplesPerFrame 32.");
    }
    return { travel: { outgoing: MCP.round(DA, 2), incoming: MCP.round(DB, 2) }, direction: String(x.args.direction || "left") };
};

/* ----------------------------------------------------------- windows */

/** push: the cut and window; both layers must have picture over the whole window. */
MCP.trans.pushWindow = function (comp, A, B, T, fo, fi, timeGiven, framesGiven) {
    var fd = MCP.frameDuration(comp);
    if (!timeGiven) {
        var ovStart = B.inPoint, ovEnd = Math.min(A.outPoint, MCP.trans.maxOut(A));
        var total = Math.round((ovEnd - ovStart) / fd);
        if (total >= 2) {
            if (!framesGiven && total < fo + fi) { fo = Math.floor(total / 2); fi = total - fo; }
            T = MCP.snapToFrame(comp, ovStart + fo * fd);
        }
    }
    var t0 = T - fo * fd, t2 = T + fi * fd;
    var why = "push shows both layers at once from " + MCP.trans.frameText(comp, t0) + " to " + MCP.trans.frameText(comp, t2) +
        ". Give the two layers an overlap of at least " + (fo + fi) + " frames (overlapFrames in create-scene-plan or insert-scene), or use match-cut or whip, which need none";
    MCP.trans.requireRange(comp, B, t0, null, why);
    MCP.trans.requireRange(comp, A, null, t2, why);
    return { T: T, fo: fo, fi: fi };
};

/** shape-reveal: frames the outgoing stays under the growing shape. */
MCP.trans.revealFrames = function (comp, A, T, fi, framesGiven) {
    var fd = MCP.frameDuration(comp);
    var avail = Math.floor((MCP.trans.maxOut(A) - T) / fd + 1e-6);
    if (T + fi * fd > MCP.trans.maxOut(A) + MCP.trans.EPS) {
        if (!framesGiven && avail >= 2) { return avail; }
        MCP.fail("shape-reveal keeps '" + A.name + "' under the growing shape for " + fi + " frames after the cut, but its picture ends " + Math.max(0, avail) + " frames after it. Give the two layers an overlap (overlapFrames in create-scene-plan or insert-scene), pass a smaller framesIn, or use match-cut.", "invalid-argument");
    }
    return fi;
};

/** The args stored for a rebuild: layer references as ids. */
MCP.trans.storedArgs = function (args, kind, fo, fi, carryEls) {
    var keep = ["direction", "intensity", "move", "shape", "roundness"];
    var out = { kind: kind, framesIn: fi };
    if (kind !== "shape-reveal") { out.framesOut = fo; }
    for (var i = 0; i < keep.length; i++) { if (MCP.isDefined(args[keep[i]])) { out[keep[i]] = args[keep[i]]; } }
    if (MCP.isArray(args.origin)) { out.origin = args.origin; }
    else if (args.origin && args.origin.layer) { out.origin = { layer: { id: args.origin.resolvedId }, from: MCP.arg(args.origin, "from", "comp") }; }
    if (args.carry && carryEls) {
        out.carry = { outgoing: { id: carryEls.outEl.layer.id }, incoming: { id: carryEls.inEl.layer.id } };
        if (MCP.isDefined(args.carry.layer)) { out.carry.layer = args.carry.layer; }
        if (MCP.isDefined(args.carry.source)) { out.carry.source = args.carry.source; }
        if (MCP.isDefined(args.carry.name)) { out.carry.name = args.carry.name; }
    }
    return out;
};

/* --------------------------------------------------------------- commands */

MCP.register("addTransition", function (args, ctx) {
    // 1. Everything that can be checked without changing the project.
    var comp = MCP.resolveComp(args.comp);
    var A = MCP.resolveLayer(comp, MCP.requireArg(args, "outgoing"));
    var B = MCP.resolveLayer(comp, MCP.requireArg(args, "incoming"));
    if (A.index === B.index) { MCP.fail("outgoing and incoming must be two different layers.", "invalid-argument"); }
    MCP.trans.requireMovable(A, "outgoing");
    MCP.trans.requireMovable(B, "incoming");
    var kind = MCP.isDefined(args.kind) ? String(args.kind) : (MCP.trans.plannedKind(comp, A) || "match-cut");
    if (!MCP.trans.KINDS[kind]) { MCP.fail("Unknown kind '" + kind + "'. Use match-cut, zoom-through, push, shape-reveal, blur-swap or whip.", "invalid-argument"); }
    if (MCP.isDefined(args.move) && args.move !== "scale" && args.move !== "position") { MCP.fail("move must be scale or position.", "invalid-argument"); }
    if (MCP.isDefined(args.shape) && args.shape !== "circle" && args.shape !== "rounded-rectangle") { MCP.fail("shape must be circle or rounded-rectangle.", "invalid-argument"); }
    if (MCP.isDefined(args.direction)) { MCP.trans.dirVec(args.direction); }
    var fd = MCP.frameDuration(comp);
    var intensity = MCP.clamp(MCP.num(args.intensity, 1), 0.1, 4);
    var defs = MCP.trans.DEFAULTS[kind];
    var fo = kind === "shape-reveal" ? 0 : MCP.trans.frames(comp, args, "framesOut", defs[0]);
    var fi = MCP.trans.frames(comp, args, "framesIn", defs[1]);
    var timeGiven = MCP.isDefined(args.time) || MCP.isDefined(args.frame);
    var notes = [];
    var carryEls = null;
    if (args.carry) {
        carryEls = {
            outEl: MCP.trans.elementIn(comp, A, MCP.requireArg(args.carry, "outgoing"), "outgoing"),
            inEl: MCP.trans.elementIn(comp, B, MCP.requireArg(args.carry, "incoming"), "incoming")
        };
    }
    if (args.origin && !MCP.isArray(args.origin)) {
        var oFrom = String(MCP.arg(args.origin, "from", "comp"));
        if (oFrom !== "comp" && oFrom !== "outgoing" && oFrom !== "incoming") { MCP.fail("origin.from must be comp, outgoing or incoming.", "invalid-argument"); }
        var oHost = oFrom === "outgoing" ? A : (oFrom === "incoming" ? B : null);
        var oEl = oHost ? MCP.trans.elementIn(comp, oHost, MCP.requireArg(args.origin, "layer"), oFrom) : MCP.trans.element(comp, null, MCP.requireArg(args.origin, "layer"), "origin");
        args.origin.resolvedId = oEl.layer.id;
    }
    var existing = MCP.trans.findPair(comp, A, B);
    if (existing && !MCP.bool(args.replace, false)) {
        MCP.fail("A " + existing.record.kind + " transition (id " + existing.record.id + ") already joins '" + A.name + "' and '" + B.name + "'. Remove it first (remove-transition) or pass replace: true.", "invalid-argument");
    }

    // 2. The changes. A failure from here on is rolled back before it is reported.
    var id = MCP.trans.newId();
    var rec = null, replaced = null, T = null, t0 = null, t2 = null;
    var probe = MCP.trans.probe(comp);
    var keys = [], helpers = [], info = null, carry = null, origin = null, ea = null, eb = null;
    try {
        if (existing) {
            MCP.invoke("removeTransition", { comp: { id: comp.id }, id: existing.record.id }, ctx);
            replaced = existing;
            notes.push("Replaced transition " + existing.record.id + ".");
        }
        // The default cut is read after a replaced transition gave the incoming its in point back.
        T = MCP.snapToFrame(comp, MCP.timeArg(comp, args, B.inPoint));
        if (A.parent || B.parent) { notes.push("A scene layer has a parent: pivots and offsets are applied in the parent's space, so check the framing."); }
        if (_mcpTry(function () { return A.stretch !== 100 || B.stretch !== 100; }, false)) { notes.push("A scene layer is time-stretched; carried elements are measured at that stretch."); }
        if (kind === "push") {
            var w = MCP.trans.pushWindow(comp, A, B, T, fo, fi, timeGiven, MCP.isDefined(args.framesOut) || MCP.isDefined(args.framesIn));
            T = w.T; fo = w.fo; fi = w.fi;
        } else if (kind === "shape-reveal") {
            fi = MCP.trans.revealFrames(comp, A, T, fi, MCP.isDefined(args.framesIn));
            MCP.trans.requireRange(comp, B, T, null, "shape-reveal starts the incoming at the cut");
            // From After Effects 23 a matte is a layer reference (removeTrackMatte keeps the type); before, the type alone says.
            var tm = typeof B.setTrackMatte === "function" ? _mcpTry(function () { return B.trackMatteLayer; }, null) :
                (_mcpTry(function () { return B.trackMatteType !== TrackMatteType.NO_TRACK_MATTE; }, false) ? B : null);
            if (tm) { MCP.fail("'" + B.name + "' already uses a track matte; shape-reveal needs its own. Remove that matte first (set-layer-track-matte type none).", "invalid-argument"); }
        } else {
            MCP.trans.requireRange(comp, A, null, T, "The outgoing must play until the cut");
            MCP.trans.requireRange(comp, B, T, null, "The incoming must start at the cut");
        }
        t0 = MCP.snapToFrame(comp, T - fo * fd);
        t2 = MCP.snapToFrame(comp, T + fi * fd);
        if (MCP.trans.markerBusy(B, T) && MCP.trans.markerBusy(A, T)) {
            MCP.fail("Both layers already have a marker exactly at the cut " + MCP.trans.frameText(comp, T) + ", where the transition stores its record. Move one of those markers by a frame.", "invalid-argument");
        }
        rec = {
            v: 1, id: id, kind: kind, framesOut: fo, framesIn: fi, intensity: intensity,
            outgoing: { id: A.id, name: A.name }, incoming: { id: B.id, name: B.name },
            cutRef: { layerId: B.id, edge: "in", offset: MCP.round(T - B.inPoint, 6) },
            compMotionBlur: _mcpTry(function () { return !!comp.motionBlur; }, false),
            layers: [], inner: []
        };
        origin = MCP.trans.originPoint(comp, args.origin, A, B, t0, t2, probe);
        var carryPrep = null;
        if (carryEls) {
            // shape-reveal has no outgoing move: the carry starts half its reveal length before the cut.
            var cfo = kind === "shape-reveal" ? Math.max(1, Math.round(fi / 2)) : Math.max(1, fo);
            carryPrep = MCP.trans.prepareCarry({
                comp: comp, outEl: carryEls.outEl, inEl: carryEls.inEl, target: null, T: T, t0: MCP.snapToFrame(comp, T - cfo * fd), t2: t2,
                fo: cfo, fi: fi, source: MCP.arg(args.carry, "source", "outgoing"), useLayer: null, name: args.carry.name, cutProgress: null
            }, probe);
        }
        ea = MCP.trans.track(rec, A, "outgoing", T);
        eb = MCP.trans.track(rec, B, "incoming", T);
        // Trims: the cut kinds meet on the cut; push and shape-reveal keep both on screen through the window.
        if (kind === "push") { MCP.trans.trim(A, ea, null, t2); MCP.trans.trim(B, eb, t0, null); }
        else if (kind === "shape-reveal") { MCP.trans.trim(A, ea, null, t2); MCP.trans.trim(B, eb, T, null); }
        else { MCP.trans.trim(A, ea, null, T); MCP.trans.trim(B, eb, T, null); }
        var x = { comp: comp, args: args, A: A, B: B, ea: ea, eb: eb, T: T, t0: t0, t2: t2, fo: Math.max(1, fo), fi: fi, id: id, intensity: intensity, origin: origin, carryPrep: carryPrep, notes: notes, keys: keys, helpers: helpers, rec: rec };
        info = MCP.trans.build[kind](x);
        MCP.trans.motionBlurOn(comp, rec, [A, B]);
        if (carryPrep && MCP.bool(args.carry.layer, true)) {
            carry = MCP.trans.writeCarry(carryPrep, probe, rec, id, notes, keys);
            helpers.push({ layer: carry.layer, role: "carry" });
        }
        rec.args = MCP.trans.storedArgs(args, kind, fo, fi, carryEls);
        var anchor = MCP.trans.markerBusy(B, T) ? A : B;
        rec.anchorRole = anchor.id === B.id ? "incoming" : "outgoing";
        MCP.trans.writeRecord(anchor, T, MCP.trans.clean(rec), "Transition: " + kind + " (" + A.name + " to " + B.name + ")");
    } catch (err) {
        probe.close();
        MCP.trans.rollback(comp, rec, T, err, replaced, ctx);
    }
    probe.close();
    return {
        composition: MCP.serialize.compRef(comp),
        transition: {
            id: id, kind: kind, cutTime: MCP.round(T), cutFrame: MCP.frameOf(comp, T),
            startTime: MCP.round(Math.min(t0, T)), endTime: MCP.round(t2), startFrame: MCP.frameOf(comp, Math.min(t0, T)), endFrame: MCP.frameOf(comp, t2),
            framesOut: fo, framesIn: fi, intensity: intensity, origin: MCP.roundValue(origin.point, 2), details: info
        },
        outgoing: MCP.serialize.layer(A),
        incoming: MCP.serialize.layer(B),
        keys: keys,
        effects: ea.effects.concat(eb.effects),
        helpers: helpers,
        carry: carry,
        motionBlur: { composition: true, layers: [A.name, B.name] },
        notes: notes
    };
}, { mutating: true });

MCP.register("carryElement", function (args, ctx) {
    var comp = MCP.resolveComp(args.comp);
    var outSpec = MCP.requireArg(args, "outgoing"), inSpec = MCP.requireArg(args, "incoming");
    var sceneA = MCP.isDefined(outSpec.scene) ? MCP.resolveLayer(comp, outSpec.scene) : null;
    var sceneB = MCP.isDefined(inSpec.scene) ? MCP.resolveLayer(comp, inSpec.scene) : null;
    var outEl = MCP.trans.element(comp, sceneA, MCP.requireArg(outSpec, "layer"), "outgoing");
    var inEl = MCP.isDefined(inSpec.layer) ? MCP.trans.element(comp, sceneB, inSpec.layer, "incoming") : null;
    var target = inEl ? null : inSpec.pose;
    if (!inEl && !target) { MCP.fail("incoming needs layer (the counterpart in the incoming scene) or pose (a target pose).", "invalid-argument"); }
    if (target && !MCP.isArray(target.position)) { MCP.fail("incoming.pose.position must be [x, y].", "invalid-argument"); }
    var source = String(MCP.arg(args, "source", "outgoing"));
    if (source !== "outgoing" && source !== "incoming") { MCP.fail("source must be outgoing or incoming.", "invalid-argument"); }
    if (source === "incoming" && !inEl) { MCP.fail("source incoming needs incoming.layer.", "invalid-argument"); }
    var useLayer = MCP.isDefined(args.layer) ? MCP.resolveLayer(comp, args.layer) : null;
    var fd = MCP.frameDuration(comp);
    var fallbackT = sceneB ? sceneB.inPoint : (sceneA ? sceneA.outPoint : null);
    if (!MCP.isDefined(args.time) && !MCP.isDefined(args.frame) && fallbackT === null) {
        MCP.fail("Give time or frame of the cut: without scene layers there is no in point to default to.", "invalid-argument");
    }
    var T = MCP.snapToFrame(comp, MCP.timeArg(comp, args, fallbackT));
    var fo = MCP.trans.frames(comp, args, "framesOut", MCP.trans.DEFAULTS.carry[0]);
    var fi = MCP.trans.frames(comp, args, "framesIn", MCP.trans.DEFAULTS.carry[1]);
    var t0 = MCP.snapToFrame(comp, T - fo * fd), t2 = MCP.snapToFrame(comp, T + fi * fd);
    var all = MCP.trans.records(comp), i;
    for (i = 0; i < all.length; i++) {
        var r0 = all[i].record;
        if (r0.kind === "carry" && r0.element && r0.element.outgoing === outEl.layer.id && Math.abs(all[i].time - T) < fd / 2) {
            MCP.fail("'" + outEl.layer.name + "' is already carried across this cut (id " + r0.id + "). Remove it first (remove-transition).", "invalid-argument");
        }
    }
    if (useLayer) {
        if (!MCP.trans.isAV(useLayer)) { MCP.fail("The carry layer '" + useLayer.name + "' is a camera or light.", "invalid-argument"); }
        if (useLayer.locked) { MCP.fail("The carry layer '" + useLayer.name + "' is locked. Unlock it first.", "invalid-argument"); }
        if (useLayer.parent) { MCP.fail("The carry layer '" + useLayer.name + "' has a parent; its pose is keyed in composition space. Clear the parent first (clear-layer-parent).", "invalid-argument"); }
        if (useLayer.id === (sceneA && sceneA.id) || useLayer.id === (sceneB && sceneB.id)) { MCP.fail("The carry layer cannot be one of the scene layers.", "invalid-argument"); }
    }
    if (useLayer && MCP.trans.markerBusy(useLayer, T)) {
        MCP.fail("The carry layer '" + useLayer.name + "' already has a marker exactly at the cut, where the record is stored. Move that marker by a frame.", "invalid-argument");
    }
    var notes = [], keys = [];
    var id = MCP.trans.newId();
    var cutLayer = sceneB || sceneA;
    var rec = {
        v: 1, id: id, kind: "carry", framesOut: fo, framesIn: fi,
        outgoing: sceneA ? { id: sceneA.id, name: sceneA.name } : null,
        incoming: sceneB ? { id: sceneB.id, name: sceneB.name } : null,
        element: { outgoing: outEl.layer.id, incoming: inEl ? inEl.layer.id : null },
        cutRef: cutLayer ? { layerId: cutLayer.id, edge: sceneB ? "in" : "out", offset: MCP.round(T - (sceneB ? sceneB.inPoint : sceneA.outPoint), 6) } : null,
        compMotionBlur: _mcpTry(function () { return !!comp.motionBlur; }, false),
        layers: [], inner: []
    };
    var probe = MCP.trans.probe(comp);
    var carry;
    try {
        var prep = MCP.trans.prepareCarry({ comp: comp, outEl: outEl, inEl: inEl, target: target, T: T, t0: t0, t2: t2, fo: fo, fi: fi, source: source, useLayer: useLayer, name: args.name, cutProgress: args.cutProgress }, probe);
        carry = MCP.trans.writeCarry(prep, probe, rec, id, notes, keys);
        try { comp.motionBlur = true; } catch (e0) {}
        var stored = { framesOut: fo, framesIn: fi, source: source };
        stored.outgoing = { layer: { id: outEl.layer.id } };
        if (sceneA) { stored.outgoing.scene = { id: sceneA.id }; }
        stored.incoming = inEl ? { layer: { id: inEl.layer.id } } : { pose: target };
        if (sceneB) { stored.incoming.scene = { id: sceneB.id }; }
        if (useLayer) { stored.layer = { id: useLayer.id }; }
        if (MCP.isDefined(args.name)) { stored.name = args.name; }
        if (MCP.isDefined(args.cutProgress)) { stored.cutProgress = args.cutProgress; }
        rec.args = stored;
        var carryLayer = MCP.trans.layerById(comp, carry.layer.id);
        rec.anchorRole = "carry";
        MCP.trans.writeRecord(carryLayer, T, MCP.trans.clean(rec), "Carry: " + outEl.layer.name);
    } catch (err) {
        probe.close();
        MCP.trans.rollback(comp, rec, T, err, null, ctx);
    }
    probe.close();
    return {
        composition: MCP.serialize.compRef(comp),
        id: id,
        cutTime: MCP.round(T), cutFrame: MCP.frameOf(comp, T),
        startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t2), framesOut: fo, framesIn: fi,
        carry: carry,
        keys: keys,
        notes: notes
    };
}, { mutating: true });

/** Summary of one record for list-transitions. */
MCP.trans.summary = function (comp, entry) {
    var r = entry.record, T = entry.time, i;
    var ref = function (o) {
        if (!o) { return null; }
        var L = MCP.trans.layerById(comp, o.id);
        return { id: o.id, name: L ? L.name : o.name, index: L ? L.index : null, exists: !!L };
    };
    var helpers = [], effects = [], keyCount = 0, missing = [];
    for (i = 0; i < (r.layers || []).length; i++) {
        var le = r.layers[i];
        var L = MCP.trans.layerById(comp, le.id);
        if (!L) { missing.push(le.name); }
        if (le.created) { helpers.push({ id: le.id, name: L ? L.name : le.name, role: le.role, exists: !!L }); }
        for (var f = 0; f < (le.effects || []).length; f++) { effects.push({ layer: le.name, name: le.effects[f] }); }
        for (var k = 0; k < (le.keys || []).length; k++) { keyCount += le.keys[k].times.length; }
    }
    var fo = Number(r.framesOut) || 0, fi = Number(r.framesIn) || 0, fd = MCP.frameDuration(comp);
    var start = r.kind === "shape-reveal" ? T : T - fo * fd;
    return {
        id: r.id, kind: r.kind, cutTime: MCP.round(T), cutFrame: MCP.frameOf(comp, T),
        startFrame: MCP.frameOf(comp, start), endFrame: MCP.frameOf(comp, T + fi * fd),
        framesOut: fo, framesIn: fi,
        outgoing: ref(r.outgoing), incoming: ref(r.incoming),
        helpers: helpers, effects: effects, keyCount: keyCount, innerTrims: (r.inner || []).length,
        anchor: MCP.serialize.layerRef(entry.anchor),
        missingLayers: missing,
        args: r.args || null
    };
};

MCP.register("listTransitions", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var all = MCP.trans.records(comp);
    all.sort(function (a, b) { return a.time - b.time; });
    var out = [], ids = {}, i;
    for (i = 0; i < all.length; i++) { out.push(MCP.trans.summary(comp, all[i])); ids[all[i].record.id] = true; }
    var orphans = [];
    for (i = 1; i <= comp.numLayers; i++) {
        var m = /^\[(transition|carry) ([a-z0-9]+)\]/.exec(String(_mcpTry(function () { return comp.layer(i).comment; }, "")));
        if (m && !ids[m[2]]) { orphans.push({ layer: MCP.serialize.layerRef(comp.layer(i)), id: m[2] }); }
    }
    return { composition: MCP.serialize.compRef(comp), count: out.length, transitions: out, orphanHelpers: orphans };
}, { mutating: false });

/** True when another record still lists the layer. */
MCP.trans.usedByOthers = function (comp, layerId, exceptId) {
    var all = MCP.trans.records(comp);
    for (var i = 0; i < all.length; i++) {
        if (all[i].record.id === exceptId) { continue; }
        var ls = all[i].record.layers || [];
        for (var j = 0; j < ls.length; j++) { if (ls[j].id === layerId) { return true; } }
    }
    return false;
};

/**
 * Undoes what a record lists (used by remove-transition and to roll back a call
 * that failed half way). T is the cut. Layers the record created are deleted
 * only when they still carry this record's tag, so a scene layer is never
 * deleted, whatever the ids say. Returns a summary; notes collect what was
 * already missing.
 */
MCP.trans.undoRecord = function (comp, r, T, notes) {
    var fd = MCP.frameDuration(comp), i, j;
    var res = { id: r.id, kind: r.kind, cutFrame: MCP.frameOf(comp, T), keysRemoved: 0, effectsRemoved: 0, layersDeleted: [], trimsRestored: 0 };
    var layers = r.layers || [];
    for (i = 0; i < layers.length; i++) {
        var le = layers[i];
        var L = MCP.trans.layerById(comp, le.id);
        if (!L) { notes.push("Layer '" + le.name + "' of transition " + r.id + " no longer exists; skipped."); continue; }
        if (le.created) {
            if (!MCP.trans.isOwnHelper(L, r.id)) {
                notes.push("Layer '" + L.name + "' is listed as made by transition " + r.id + " but does not carry its tag " + MCP.trans.tag(le.role === "carry" ? "carry" : "transition", r.id) + ", so it was not deleted.");
                continue;
            }
            var nm = L.name;
            MCP.trans.unlocked(L, function () { L.remove(); });
            res.layersDeleted.push(nm);
            continue;
        }
        MCP.trans.unlocked(L, function () {
            if (le.matte) {
                try {
                    if (typeof L.removeTrackMatte === "function") { L.removeTrackMatte(); }
                    else { L.trackMatteType = TrackMatteType.NO_TRACK_MATTE; }
                } catch (e0) { notes.push("Could not remove the track matte from '" + L.name + "'."); }
            }
            for (j = 0; j < (le.keys || []).length; j++) {
                var kk = le.keys[j];
                var prop = MCP.resolvePropertyOptional(L, kk.path);
                if (!prop) { continue; }
                var times = kk.times.slice(0).sort(function (a, b) { return b - a; });
                for (var t = 0; t < times.length; t++) {
                    var shared = false;
                    for (var s = 0; s < (kk.shared || []).length; s++) { if (Math.abs(kk.shared[s] - times[t]) < 1e-4) { shared = true; } }
                    if (shared) { continue; }
                    var idx = prop.numKeys ? MCP.easing.keyIndexAtTime(prop, T + times[t], fd / 2) : -1;
                    if (idx > 0) { prop.removeKey(idx); res.keysRemoved++; }
                }
                if (!kk.hadKeys && prop.numKeys === 0 && kk.rest !== null && MCP.isDefined(kk.rest)) {
                    try { prop.setValue(kk.rest); } catch (e1) {}
                }
            }
            for (j = 0; j < (le.effects || []).length; j++) {
                var fx = _mcpTry(function () { return MCP.effectsGroup(L).property(le.effects[j]); }, null);
                if (fx) { fx.remove(); res.effectsRemoved++; }
            }
            if (le.changedIn) { try { L.inPoint = T + le.inRel; res.trimsRestored++; } catch (e2) {} }
            if (le.changedOut) { try { L.outPoint = T + le.outRel; res.trimsRestored++; } catch (e3) {} }
            if (le.motionBlur === false && !MCP.trans.usedByOthers(comp, L.id, r.id)) { L.motionBlur = false; }
        });
        if (MCP.isDefined(le.movedAboveId)) {
            var below = MCP.trans.layerById(comp, le.movedAboveId);
            if (below && L.index < below.index) { try { L.moveAfter(below); } catch (e4) {} }
        }
    }
    var inner = r.inner || [];
    for (i = 0; i < inner.length; i++) {
        var it = inner[i];
        var ic = _mcpTry(function () { return app.project.itemByID(Number(it.compId)); }, null);
        var IL = ic instanceof CompItem ? MCP.trans.layerById(ic, it.layerId) : null;
        if (!IL) { notes.push("The carried original '" + it.name + "' no longer exists; skipped."); continue; }
        MCP.trans.unlocked(IL, function () {
            if (it.edge === "out") { IL.outPoint = it.outPoint; } else { IL.inPoint = it.inPoint; }
        });
        res.trimsRestored++;
    }
    return res;
};

/** Removes a stored record: its marker, then everything it lists. */
MCP.trans.removeOne = function (comp, entry, notes) {
    var r = entry.record;
    // The record marker first: it may sit on a layer about to be deleted.
    MCP.trans.unlocked(entry.anchor, function () {
        var mp = entry.anchor.property("ADBE Marker");
        for (var k = mp.numKeys; k >= 1; k--) {
            var raw = MCP.trans.params(mp.keyValue(k))[MCP.trans.KEY];
            if (!MCP.isDefined(raw)) { continue; }
            var got = null;
            try { got = JSON.parse(String(raw)); } catch (e) { got = null; }
            if (got && got.id === r.id) { mp.removeKey(k); }
        }
    });
    return MCP.trans.undoRecord(comp, r, entry.time, notes);
};

/**
 * Rolls back a call that failed after it started changing the project: undoes
 * the record built so far and, when it had replaced a transition, builds that
 * one again. Then fails with the original error.
 */
MCP.trans.rollback = function (comp, rec, T, err, replaced, ctx) {
    var notes = [], msg = (err && err.message) ? String(err.message) : String(err);
    var code = (err && err.mcpCode) ? err.mcpCode : "script-error";
    try {
        if (rec && rec.layers && (rec.layers.length || (rec.inner && rec.inner.length))) { MCP.trans.undoRecord(comp, MCP.trans.clean(rec), T, notes); }
        if (rec) { try { comp.motionBlur = !!rec.compMotionBlur; } catch (e0) {} }
    } catch (e1) {
        msg += " Rolling back also failed (" + (e1.message || e1) + "); check the layers with list-transitions and undo the step.";
    }
    if (replaced) {
        try {
            var B = MCP.trans.layerById(comp, replaced.record.cutRef ? replaced.record.cutRef.layerId : replaced.record.incoming.id);
            var a = MCP.extend({}, replaced.record.args || {});
            a.comp = { id: comp.id };
            a.outgoing = { id: replaced.record.outgoing.id };
            a.incoming = { id: replaced.record.incoming.id };
            if (B && replaced.record.cutRef) { a.time = (replaced.record.cutRef.edge === "out" ? B.outPoint : B.inPoint) + Number(replaced.record.cutRef.offset || 0); }
            MCP.invoke("addTransition", a, ctx);
            msg += " The transition it was replacing was built again.";
        } catch (e2) {
            msg += " The transition it was replacing (" + replaced.record.kind + ") could not be built again: add it with add-transition.";
        }
    }
    if (notes.length) { msg += " " + notes.join(" "); }
    MCP.fail(msg + (replaced ? "" : " Nothing was kept."), code);
};

MCP.register("removeTransition", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var notes = [], removed = [], i;
    var targets = [];
    if (MCP.bool(args.all, false)) {
        targets = MCP.trans.records(comp);
        targets.sort(function (a, b) { return b.time - a.time; });
    } else {
        var id = String(MCP.requireArg(args, "id"));
        var one = MCP.trans.findRecord(comp, id);
        if (!one) {
            var ids = [], all = MCP.trans.records(comp);
            for (i = 0; i < all.length; i++) { ids.push(all[i].record.id + " (" + all[i].record.kind + ")"); }
            MCP.fail("No transition with id '" + id + "' in '" + comp.name + "'. Transitions: " + (ids.join(", ") || "(none)") + ".", "not-found");
        }
        targets = [one];
    }
    var before = _mcpTry(function () { return !!targets[0].record.compMotionBlur; }, true);
    for (i = 0; i < targets.length; i++) {
        // Re-read: removing one record can renumber markers on a shared layer.
        var fresh = MCP.trans.findRecord(comp, targets[i].record.id);
        if (!fresh) { continue; }
        removed.push(MCP.trans.removeOne(comp, fresh, notes));
        if (fresh.record.compMotionBlur === false) { before = false; }
    }
    var remaining = MCP.trans.records(comp).length;
    if (remaining === 0 && before === false) { try { comp.motionBlur = false; } catch (e) {} }
    return { composition: MCP.serialize.compRef(comp), removedCount: removed.length, removed: removed, remaining: remaining, compositionMotionBlur: _mcpTry(function () { return !!comp.motionBlur; }, null), notes: notes };
}, { mutating: true });
