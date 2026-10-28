/*
 * UI demo commands (group 'ui-demo'): the moves of a product film that shows
 * real app screens. A cursor travels through waypoints with one eased key per
 * stop and clicks with the press mechanism; a tall screen scrolls inside a
 * window driven by one Scroll slider; a 2D camera null frames a region; device
 * frames are shape layers sized to the screen; a highlight dims the rest of
 * the frame and outlines a region with overlay layers placed by expression; a
 * toast slides in and out with two keys each way. Nothing writes a key on
 * every frame, and nothing overshoots unless asked.
 *
 * Spaces: "composition pixels" are comp coordinates. A rectangle or an anchor
 * given as [x, y] on a layer is measured in that layer's own pixels from the
 * top-left of its content (for images and precomps, the source pixels).
 * Points travel through parents with 2D math (anchor, scale, Z rotation,
 * position); 3D rotation and depth are ignored.
 *
 * Eases (speed 0 at both keys, shape from influence):
 *   EASE_LAND    leave 25, arrive 100: a brisk start and a long landing.
 *   EASE_CAMERA  leave 33.3, arrive 100: the same landing with a softer start.
 *   EASE_EXIT    leave 85, arrive 15: accelerates away (hides and exits).
 *   EASE_GLIDE   cubic-bezier(0.16, 1, 0.3, 1): a flick and a long glide
 *                (scroll momentum).
 *
 * Layer comments carry two tags: "UI demo: cursor" marks a cursor (overlays
 * are stacked under it) and "UI demo: screen overlay" marks layers fixed to
 * the frame (a new camera null does not adopt them).
 */

MCP.uidemo = {};

MCP.uidemo.EASE_LAND = { type: "custom", outSpeed: 0, outInfluence: 25, inSpeed: 0, inInfluence: 100 };
MCP.uidemo.EASE_CAMERA = { type: "custom", outSpeed: 0, outInfluence: 33.3, inSpeed: 0, inInfluence: 100 };
MCP.uidemo.EASE_EXIT = { type: "custom", outSpeed: 0, outInfluence: 85, inSpeed: 0, inInfluence: 15 };
MCP.uidemo.EASE_GLIDE = { type: "bezier", x1: 0.16, y1: 1, x2: 0.3, y2: 1 };

MCP.uidemo.LAND_TEXT = "landing (speed 0, influence 25 leaving, 100 arriving)";
MCP.uidemo.CAMERA_TEXT = "camera landing (speed 0, influence 33.3 leaving, 100 arriving)";
MCP.uidemo.GLIDE_TEXT = "glide (cubic-bezier 0.16, 1, 0.3, 1)";

MCP.uidemo.KAPPA = 0.5522847498;
MCP.uidemo.CURSOR_TAG = "UI demo: cursor";
MCP.uidemo.OVERLAY_TAG = "UI demo: screen overlay";
MCP.uidemo.SCROLL_TAG = "// Scroll in window";
MCP.uidemo.CAMERA_NAME = "UI Camera";

MCP.uidemo.ANCHORS = {
    "center": [0.5, 0.5], "top-left": [0, 0], "top": [0.5, 0], "top-right": [1, 0], "left": [0, 0.5],
    "right": [1, 0.5], "bottom-left": [0, 1], "bottom": [0.5, 1], "bottom-right": [1, 1]
};

/* ---------------------------------------------------------------- helpers */

/** A stable reference for MCP.invoke: the layer id when this version has one, else the index. */
MCP.uidemo.ref = function (layer) {
    var id = _mcpTry(function () { return layer.id; }, null);
    return MCP.isDefined(id) ? { id: id } : { index: layer.index };
};

/** Seconds from spec[frameName] or spec[secName], snapped to a frame; null when neither is set. */
MCP.uidemo.timeOf = function (comp, spec, secName, frameName) {
    if (spec && MCP.isDefined(spec[frameName])) { return MCP.snapToFrame(comp, Number(spec[frameName]) * MCP.frameDuration(comp)); }
    if (spec && MCP.isDefined(spec[secName])) { return MCP.snapToFrame(comp, Number(spec[secName])); }
    return null;
};

MCP.uidemo.valueAt = function (prop, t, fallback) {
    var v = _mcpTry(function () { return prop.valueAtTime(t, false); }, null);
    return (v === null || v === undefined) ? fallback : v;
};

/** Sets [x, y] on a point property, keeping a third value when the property has one. */
MCP.uidemo.setXY = function (prop, xy) {
    var cur = _mcpTry(function () { return prop.value; }, null);
    var v = [Number(xy[0]), Number(xy[1])];
    if (MCP.isArray(cur) && cur.length > 2) { v.push(Number(cur[2])); }
    prop.setValue(v);
};

MCP.uidemo.tag = function (layer, tag) {
    try {
        var c = String(layer.comment || "");
        if (c.indexOf(tag) < 0) { layer.comment = c ? c + "\n" + tag : tag; }
    } catch (e) {}
};

MCP.uidemo.hasTag = function (layer, tag) {
    return _mcpTry(function () { return String(layer.comment || "").indexOf(tag) >= 0; }, false);
};

MCP.uidemo.positionAt = function (layer, t) {
    var tg = layer.property("ADBE Transform Group");
    var pos = tg.property("ADBE Position");
    if (_mcpTry(function () { return !!pos.dimensionsSeparated; }, false)) {
        return [Number(MCP.uidemo.valueAt(tg.property("ADBE Position_0"), t, 0)), Number(MCP.uidemo.valueAt(tg.property("ADBE Position_1"), t, 0))];
    }
    var p = MCP.uidemo.valueAt(pos, t, [0, 0]);
    return [Number(p[0]), Number(p[1])];
};

/** A point in a layer's own space mapped into its parent's space at time t (2D). */
MCP.uidemo.toParent = function (layer, pt, t) {
    var tg = layer.property("ADBE Transform Group");
    var a = MCP.uidemo.valueAt(tg.property("ADBE Anchor Point"), t, [0, 0]);
    var s = MCP.uidemo.valueAt(tg.property("ADBE Scale"), t, [100, 100]);
    var r = Number(MCP.uidemo.valueAt(MCP.childProp(tg, "ADBE Rotate Z"), t, 0)) || 0;
    var p = MCP.uidemo.positionAt(layer, t);
    var dx = (pt[0] - a[0]) * s[0] / 100, dy = (pt[1] - a[1]) * s[1] / 100;
    var rad = r * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
    return [p[0] + dx * cs - dy * sn, p[1] + dx * sn + dy * cs];
};

/** Layer-space point to composition space through the parents; with stopAt, the result is in stopAt's own space. */
MCP.uidemo.toComp = function (layer, pt, t, stopAt) {
    var q = [Number(pt[0]), Number(pt[1])], cur = layer, guard = 0;
    while (cur && guard++ < 64) {
        if (stopAt && cur.index === stopAt.index) { break; }
        q = MCP.uidemo.toParent(cur, q, t);
        cur = _mcpTry(function () { return cur.parent; }, null);
    }
    return q;
};

/** The 2D affine map from a layer's space to composition space (or stopAt's space): {a, b, c, d, e, f}. */
MCP.uidemo.affine = function (layer, t, stopAt) {
    var o = MCP.uidemo.toComp(layer, [0, 0], t, stopAt);
    var x = MCP.uidemo.toComp(layer, [1, 0], t, stopAt);
    var y = MCP.uidemo.toComp(layer, [0, 1], t, stopAt);
    return { a: x[0] - o[0], b: x[1] - o[1], c: y[0] - o[0], d: y[1] - o[1], e: o[0], f: o[1] };
};

MCP.uidemo.identity = function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; };

MCP.uidemo.apply = function (m, p) {
    return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
};

MCP.uidemo.invert = function (m) {
    var det = m.a * m.d - m.b * m.c;
    if (Math.abs(det) < 1e-9) { MCP.fail("A parent of the layer is scaled to zero at this time, so points cannot be mapped into it.", "invalid-argument"); }
    return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
};

/** Pixels in composition space per pixel of the mapped space. */
MCP.uidemo.scaleOf = function (m) {
    return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
};

/** The map from the space a layer's Position lives in (its parent chain) to composition space. */
MCP.uidemo.parentAffine = function (layer, t) {
    var p = _mcpTry(function () { return layer.parent; }, null);
    return p ? MCP.uidemo.affine(p, t, null) : MCP.uidemo.identity();
};

MCP.uidemo.isDescendant = function (layer, ancestor) {
    var cur = _mcpTry(function () { return layer.parent; }, null), guard = 0;
    while (cur && guard++ < 64) {
        if (cur.index === ancestor.index) { return true; }
        cur = _mcpTry(function () { return cur.parent; }, null);
    }
    return false;
};

MCP.uidemo.rootOf = function (layer) {
    var cur = layer, guard = 0;
    while (guard++ < 64) {
        var p = _mcpTry(function () { return cur.parent; }, null);
        if (!p) { return cur; }
        cur = p;
    }
    return cur;
};

/** The layer's visible content in its own space: {left, top, width, height}. */
MCP.uidemo.contentRect = function (layer, t) {
    if (layer instanceof CameraLayer || layer instanceof LightLayer) {
        MCP.fail("Layer '" + layer.name + "' is a camera or light and has no pixels to measure.", "invalid-argument");
    }
    var extents = (layer instanceof ShapeLayer);
    var r = _mcpTry(function () { return layer.sourceRectAtTime(t, extents); }, null);
    if (r && r.width > 0 && r.height > 0) { return { left: r.left, top: r.top, width: r.width, height: r.height }; }
    var w = _mcpTry(function () { return layer.source.width; }, 0), h = _mcpTry(function () { return layer.source.height; }, 0);
    if (w > 0 && h > 0) { return { left: 0, top: 0, width: w, height: h }; }
    MCP.fail("Layer '" + layer.name + "' has no visible content to measure at " + MCP.round(t) + " s (a null, or empty at that time). Pick a layer with pixels, or give a point.", "invalid-argument");
    return null;
};

/** A rect {x, y, width, height} from the content's top-left (or the whole content) in the layer's own space. */
MCP.uidemo.localRect = function (layer, rect, t) {
    var c = MCP.uidemo.contentRect(layer, t);
    if (rect && typeof rect === "object") {
        var w = Number(rect.width), h = Number(rect.height);
        if (!(w > 0) || !(h > 0)) { MCP.fail("rect width and height must be greater than 0.", "invalid-argument"); }
        return { left: c.left + Number(rect.x || 0), top: c.top + Number(rect.y || 0), width: w, height: h };
    }
    return c;
};

/** A named anchor (center, top-left, ...) or [x, y] from the content's top-left, in the layer's own space. */
MCP.uidemo.anchorPoint = function (layer, anchor, t) {
    var c = MCP.uidemo.contentRect(layer, t);
    if (MCP.isArray(anchor)) { return [c.left + Number(anchor[0]), c.top + Number(anchor[1])]; }
    var key = MCP.isDefined(anchor) ? String(anchor) : "center";
    var f = MCP.uidemo.ANCHORS[key];
    if (!f) { MCP.fail("Unknown anchor '" + key + "'. Use center, top-left, top, top-right, left, right, bottom-left, bottom, bottom-right, or [x, y] in the layer's pixels.", "invalid-argument"); }
    return [c.left + c.width * f[0], c.top + c.height * f[1]];
};

MCP.uidemo.bbox = function (pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < pts.length; i++) {
        if (pts[i][0] < x0) { x0 = pts[i][0]; }
        if (pts[i][0] > x1) { x1 = pts[i][0]; }
        if (pts[i][1] < y0) { y0 = pts[i][1]; }
        if (pts[i][1] > y1) { y1 = pts[i][1]; }
    }
    return { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};

/** Bounding box of a local rect after mapping its corners to composition space (or stopAt's space). */
MCP.uidemo.regionBox = function (layer, r, t, stopAt) {
    var corners = [[r.left, r.top], [r.left + r.width, r.top], [r.left + r.width, r.top + r.height], [r.left, r.top + r.height]];
    var pts = [];
    for (var i = 0; i < corners.length; i++) { pts.push(MCP.uidemo.toComp(layer, corners[i], t, stopAt)); }
    return MCP.uidemo.bbox(pts);
};

MCP.uidemo.boxOut = function (b) {
    return { x: MCP.round(b.left, 2), y: MCP.round(b.top, 2), width: MCP.round(b.width, 2), height: MCP.round(b.height, 2) };
};

MCP.uidemo.rectOut = function (r) {
    return { x: MCP.round(r.left, 2), y: MCP.round(r.top, 2), width: MCP.round(r.width, 2), height: MCP.round(r.height, 2) };
};

MCP.uidemo.compNamed = function (name) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof CompItem && it.name === name) { return it; }
    }
    return null;
};

MCP.uidemo.uniqueCompName = function (base) {
    if (!MCP.uidemo.compNamed(base)) { return base; }
    for (var i = 2; i < 1000; i++) { if (!MCP.uidemo.compNamed(base + " " + i)) { return base + " " + i; } }
    return base + " " + new Date().getTime();
};

/** Puts layer directly above ref (Layer has no moveBefore). */
MCP.uidemo.placeAbove = function (layer, ref) {
    layer.moveAfter(ref);
    ref.moveAfter(layer);
};

/** Fails for layers whose Position this group cannot key as one 2D value. */
MCP.uidemo.requireKeyablePosition = function (layer, role) {
    if (layer instanceof CameraLayer || layer instanceof LightLayer) { MCP.fail("The " + role + " layer '" + layer.name + "' is a camera or light.", "invalid-argument"); }
    var pos = layer.property("ADBE Transform Group").property("ADBE Position");
    if (_mcpTry(function () { return !!pos.dimensionsSeparated; }, false)) {
        MCP.fail("The " + role + " layer '" + layer.name + "' has separated Position dimensions. Join them first (separate-dimensions with separate false).", "unsupported");
    }
    if (_mcpTry(function () { return pos.expression !== "" && pos.expressionEnabled; }, false)) {
        MCP.fail("The " + role + " layer '" + layer.name + "' has a Position expression that would override the keys. Remove it first (remove-expression).", "unsupported");
    }
    return pos;
};

/** Keys strictly between t0 and t1 that are not at one of the allowed times. */
MCP.uidemo.keysInside = function (prop, t0, t1, allowed) {
    var out = [], n = _mcpTry(function () { return prop.numKeys; }, 0);
    for (var i = 1; i <= n; i++) {
        var kt = prop.keyTime(i);
        if (kt <= t0 + 1e-4 || kt >= t1 - 1e-4) { continue; }
        var ok = false;
        for (var j = 0; j < allowed.length; j++) { if (Math.abs(allowed[j] - kt) < 1e-3) { ok = true; break; } }
        if (!ok) { out.push(MCP.round(kt)); }
    }
    return out;
};

/** Sets spatial tangents at key i, trying three values then two. */
MCP.uidemo.setTangents = function (prop, i, inT, outT) {
    try { prop.setSpatialAutoBezierAtKey(i, false); prop.setSpatialContinuousAtKey(i, false); } catch (e0) {}
    try { prop.setSpatialTangentsAtKey(i, [inT[0], inT[1], 0], [outT[0], outT[1], 0]); return true; } catch (e1) {}
    try { prop.setSpatialTangentsAtKey(i, [inT[0], inT[1]], [outT[0], outT[1]]); return true; } catch (e2) {}
    return false;
};

MCP.uidemo.tangentAt = function (prop, i, side) {
    var v = _mcpTry(function () { return side === "in" ? prop.keyInSpatialTangent(i) : prop.keyOutSpatialTangent(i); }, null);
    return MCP.isArray(v) ? [Number(v[0]), Number(v[1])] : [0, 0];
};

/** Keeps a straight (linear) segment straight on the side of key i that borders it. */
MCP.uidemo.keepLinearAround = function (prop, i) {
    var n = _mcpTry(function () { return prop.numKeys; }, 0);
    var L = KeyframeInterpolationType.LINEAR;
    try { if (i > 1 && prop.keyOutInterpolationType(i - 1) === L) { MCP.easing.setInterp(prop, i, L, null); } } catch (e1) {}
    try { if (i < n && prop.keyInInterpolationType(i + 1) === L) { MCP.easing.setInterp(prop, i, null, L); } } catch (e2) {}
};

/* ------------------------------------------------------------- shape paths */

/** Rounded rectangle as a Shape; radii is a number or [topLeft, topRight, bottomRight, bottomLeft]. Clockwise. */
MCP.uidemo.roundedRect = function (x, y, w, h, radii) {
    var rr = MCP.isArray(radii) ? radii : [radii, radii, radii, radii];
    var maxR = Math.max(0, Math.min(w, h) / 2);
    var tl = MCP.clamp(Number(rr[0]) || 0, 0, maxR), tr = MCP.clamp(Number(rr[1]) || 0, 0, maxR);
    var br = MCP.clamp(Number(rr[2]) || 0, 0, maxR), bl = MCP.clamp(Number(rr[3]) || 0, 0, maxR);
    var K = MCP.uidemo.KAPPA;
    var V = [], I = [], O = [];
    function add(p, i, o) { V.push(p); I.push(i); O.push(o); }
    if (tl > 0) { add([x, y + tl], [0, 0], [0, -K * tl]); add([x + tl, y], [-K * tl, 0], [0, 0]); } else { add([x, y], [0, 0], [0, 0]); }
    if (tr > 0) { add([x + w - tr, y], [0, 0], [K * tr, 0]); add([x + w, y + tr], [0, -K * tr], [0, 0]); } else { add([x + w, y], [0, 0], [0, 0]); }
    if (br > 0) { add([x + w, y + h - br], [0, 0], [0, K * br]); add([x + w - br, y + h], [K * br, 0], [0, 0]); } else { add([x + w, y + h], [0, 0], [0, 0]); }
    if (bl > 0) { add([x + bl, y + h], [0, 0], [-K * bl, 0]); add([x, y + h - bl], [0, K * bl], [0, 0]); } else { add([x, y + h], [0, 0], [0, 0]); }
    var s = new Shape();
    s.vertices = V;
    s.inTangents = I;
    s.outTangents = O;
    s.closed = true;
    return s;
};

MCP.uidemo.circle = function (cx, cy, r) {
    return MCP.masks.ellipseShape(cx, cy, r, r);
};

/**
 * Appends a group to a shape layer with one or more paths and either a fill or
 * a stroke. look: {fill, fillOpacity, stroke, strokeWidth, strokeOpacity, cap}.
 * Groups added first draw on top. Returns {group, fill, stroke} names.
 */
MCP.uidemo.addPathGroup = function (layer, name, shapes, look) {
    var list = MCP.isArray(shapes) ? shapes : [shapes];
    var root = function () { return layer.property("ADBE Root Vectors Group"); };
    var g = root().addProperty("ADBE Vector Group");
    g.name = name;
    var items = function () { return MCP.childProp(root(), name).property("ADBE Vectors Group"); };
    var i;
    for (i = 0; i < list.length; i++) {
        var idx = items().addProperty("ADBE Vector Shape - Group").propertyIndex;
        items().property(idx).property("ADBE Vector Shape").setValue(list[i]);
    }
    var out = { group: name, fill: null, stroke: null };
    if (look.fill) {
        var fIdx = items().addProperty("ADBE Vector Graphic - Fill").propertyIndex;
        items().property(fIdx).property("ADBE Vector Fill Color").setValue(MCP.color.rgba(look.fill));
        items().property(fIdx).property("ADBE Vector Fill Opacity").setValue(MCP.num(look.fillOpacity, 100));
        try { items().property(fIdx).name = "Fill"; } catch (e1) {}
        out.fill = items().property(fIdx).name;
    }
    if (look.stroke) {
        var sIdx = items().addProperty("ADBE Vector Graphic - Stroke").propertyIndex;
        items().property(sIdx).property("ADBE Vector Stroke Color").setValue(MCP.color.rgba(look.stroke));
        items().property(sIdx).property("ADBE Vector Stroke Width").setValue(MCP.num(look.strokeWidth, 2));
        items().property(sIdx).property("ADBE Vector Stroke Opacity").setValue(MCP.num(look.strokeOpacity, 100));
        try { items().property(sIdx).property("ADBE Vector Stroke Line Join").setValue(2); } catch (e2) {}
        try { items().property(sIdx).property("ADBE Vector Stroke Line Cap").setValue(MCP.num(look.cap, 2)); } catch (e3) {}
        try { items().property(sIdx).name = "Stroke"; } catch (e4) {}
        out.stroke = items().property(sIdx).name;
    }
    return out;
};

/** A property inside a named group of a shape layer, fetched fresh. */
MCP.uidemo.groupItem = function (layer, group, matchName) {
    var g = MCP.childProp(layer.property("ADBE Root Vectors Group"), group);
    return g ? MCP.childProp(g.property("ADBE Vectors Group"), matchName) : null;
};

/** Sets an expression and records its state; an After Effects error is collected, not thrown. */
MCP.uidemo.setExpr = function (prop, code, label, list) {
    var st = { property: label, error: "" };
    try {
        prop.expression = code;
        try { prop.expressionEnabled = true; } catch (e0) {}
        st.error = _mcpTry(function () { return prop.expressionError || ""; }, "");
    } catch (e) {
        st.error = e.toString();
    }
    list.push(st);
    return st;
};

/** A shape layer with an identity transform (anchor 0, position 0), unparented, spanning the comp. */
MCP.uidemo.newShapeLayer = function (comp, name) {
    var L = comp.layers.addShape();
    L.name = MCP.animate.uniqueLayerName(comp, name);
    var tg = L.property("ADBE Transform Group");
    tg.property("ADBE Anchor Point").setValue([0, 0]);
    tg.property("ADBE Position").setValue([0, 0]);
    return L;
};

/** Parents child to parent and makes the child's space equal the parent's layer space. */
MCP.uidemo.attach = function (child, parent) {
    child.parent = parent;
    var is3d = _mcpTry(function () { return !!parent.threeDLayer; }, false);
    if (is3d) { try { child.threeDLayer = true; } catch (e0) {} }
    var tg = child.property("ADBE Transform Group");
    tg.property("ADBE Anchor Point").setValue(is3d ? [0, 0, 0] : [0, 0]);
    tg.property("ADBE Position").setValue(is3d ? [0, 0, 0] : [0, 0]);
    tg.property("ADBE Scale").setValue(is3d ? [100, 100, 100] : [100, 100]);
    tg.property("ADBE Rotate Z").setValue(0);
    if (is3d) {
        try { tg.property("ADBE Rotate X").setValue(0); tg.property("ADBE Rotate Y").setValue(0); tg.property("ADBE Orientation").setValue([0, 0, 0]); } catch (e1) {}
    }
};

/** A two-key move with easing on the arrival; returns the serialized keys. */
MCP.uidemo.move = function (prop, t0, v0, t1, v1, easing, spatial) {
    MCP.easing.setKey(prop, t0, v0, spatial);
    var i1 = MCP.easing.setKey(prop, t1, v1, spatial);
    MCP.easing.applySegment(prop, i1, easing);
    return MCP.animate.keysAt(prop, [t0, t1]);
};

MCP.uidemo.round2 = function (v) { return MCP.roundValue(v, 2); };

/* ----------------------------------------------------------- cursor-journey */

/** The arrow pointer on a 24-unit grid, tip at 0,0. */
MCP.uidemo.ARROW = [[0, 0], [0, 17.6], [4.6, 13.6], [7.6, 20.6], [10.6, 19.3], [7.7, 12.5], [13.2, 12.5]];
MCP.uidemo.ARROW_H = 20.6;

/** Builds the arrow cursor shape layer with its tip on the anchor point. Returns {layer, shadow, look}. */
MCP.uidemo.buildCursor = function (comp, style, pos, notes) {
    var s = style || {};
    var h = MCP.clamp(MCP.num(s.height, 44), 8, 400);
    var k = h / MCP.uidemo.ARROW_H;
    var pts = [], i;
    for (i = 0; i < MCP.uidemo.ARROW.length; i++) { pts.push([MCP.uidemo.ARROW[i][0] * k, MCP.uidemo.ARROW[i][1] * k]); }
    var shape = MCP.shape.pathFromPoints(pts, true);
    var outline = MCP.num(s.outlineWidth, Math.max(1, Math.round(h / 22 * 10) / 10));
    var fill = MCP.isDefined(s.fillColor) ? s.fillColor : [1, 1, 1, 1];
    var line = MCP.isDefined(s.outlineColor) ? s.outlineColor : "#111111";
    var layer = comp.layers.addShape();
    layer.name = MCP.animate.uniqueLayerName(comp, MCP.isDefined(s.name) ? String(s.name) : "Cursor");
    MCP.uidemo.addPathGroup(layer, "Arrow", shape, { fill: fill });
    // The outline group sits behind the arrow, so only the outer half of its stroke shows.
    if (outline > 0) { MCP.uidemo.addPathGroup(layer, "Outline", shape, { stroke: line, strokeWidth: outline * 2 }); }
    var tg = layer.property("ADBE Transform Group");
    tg.property("ADBE Anchor Point").setValue([0, 0]);
    tg.property("ADBE Position").setValue([pos[0], pos[1]]);
    layer.moveToBeginning();
    var shadow = null;
    if (s.shadow !== false) {
        var settings = MCP.extend({ opacity: 30, angle: 90, distance: Math.max(1, Math.round(h / 20)), size: Math.max(2, Math.round(h / 7)), spread: 0 }, typeof s.shadow === "object" ? s.shadow : {});
        var res = MCP.styles.addToLayers(comp, [layer], "drop-shadow", settings, { useDefaults: true, allowMenu: true });
        shadow = res.results[0];
        if (shadow.status !== "ok") { notes.push("The cursor was built but its shadow failed: " + shadow.error); }
    }
    return { layer: layer, shadow: shadow, look: { height: h, outlineWidth: outline, fillColor: MCP.color.toHex(MCP.color.rgba(fill)), outlineColor: MCP.color.toHex(MCP.color.rgba(line)) } };
};

MCP.register("cursorJourney", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var fd = MCP.frameDuration(comp);
    var list = MCP.requireArg(args, "waypoints");
    if (!MCP.isArray(list) || !list.length) { MCP.fail("waypoints must be a non-empty array of {to, at or frame, click, hold}.", "invalid-argument"); }
    var notes = [], i;
    var cursor = MCP.isDefined(args.cursor) ? MCP.resolveLayer(comp, args.cursor) : null;
    if (cursor) { MCP.uidemo.requireKeyablePosition(cursor, "cursor"); }
    var easing = MCP.isDefined(args.easing) ? args.easing : MCP.uidemo.EASE_LAND;
    var cursorPct = MCP.num(args.cursorScale, 92);
    var delay = Math.max(0, MCP.snapToFrame(comp, MCP.num(args.clickDelay, 0)));
    var ring = args.clickRing ? (typeof args.clickRing === "object" ? args.clickRing : {}) : null;
    var dipLen = MCP.snapToFrame(comp, 0.1) + MCP.snapToFrame(comp, 0.15);
    var popLen = fd + MCP.snapToFrame(comp, 0.25);

    // Resolve every waypoint before anything is written.
    var plan = [], anyClick = false;
    for (i = 0; i < list.length; i++) {
        var w = list[i] || {};
        var t = MCP.uidemo.timeOf(comp, w, "at", "frame");
        if (t === null) { MCP.fail("Waypoint " + (i + 1) + " needs at (seconds) or frame.", "invalid-argument"); }
        var target = null, pt = null, anchorOut = null;
        if (MCP.isArray(w.to)) {
            pt = [Number(w.to[0]), Number(w.to[1])];
        } else if (w.to && typeof w.to === "object" && MCP.isDefined(w.to.layer)) {
            target = MCP.resolveLayer(comp, w.to.layer);
            if (cursor && target.index === cursor.index) { MCP.fail("Waypoint " + (i + 1) + " points at the cursor itself.", "invalid-argument"); }
            pt = MCP.uidemo.toComp(target, MCP.uidemo.anchorPoint(target, w.to.anchor, t), t, null);
            if (MCP.isArray(w.to.offset)) { pt = [pt[0] + Number(w.to.offset[0]), pt[1] + Number(w.to.offset[1])]; }
            anchorOut = MCP.isDefined(w.to.anchor) ? w.to.anchor : "center";
        } else {
            MCP.fail("Waypoint " + (i + 1) + " needs to: [x, y] in composition pixels, or {layer, anchor, offset}.", "invalid-argument");
        }
        var click = MCP.bool(w.click, false);
        if (click) { anyClick = true; }
        var variant = String(MCP.arg(w, "variant", "dip")).toLowerCase();
        if (variant !== "dip" && variant !== "pop") { MCP.fail("Waypoint " + (i + 1) + ": variant must be dip or pop.", "invalid-argument"); }
        var pressTarget = click && !!target && MCP.bool(w.pressTarget, true);
        if (MCP.isArray(w.flip) && w.flip.length && !pressTarget) {
            MCP.fail("Waypoint " + (i + 1) + ": flip changes the pressed target on the click frame, so it needs click true and a layer target with pressTarget left on.", "invalid-argument");
        }
        var holdDefault = click ? delay + (pressTarget && variant === "pop" ? popLen : dipLen) : 0;
        plan.push({
            index: i, t: t, pt: pt, target: target, anchor: anchorOut,
            click: click, pressTarget: pressTarget, variant: variant, scale: w.scale, flip: w.flip,
            hold: MCP.isDefined(w.hold) ? Math.max(0, MCP.snapToFrame(comp, Number(w.hold))) : holdDefault,
            holdGiven: MCP.isDefined(w.hold),
            easing: MCP.isDefined(w.easing) ? w.easing : easing
        });
    }
    for (i = 1; i < plan.length; i++) {
        var prev = plan[i - 1];
        if (plan[i].t <= prev.t + 1e-6) {
            MCP.fail("Waypoint times must increase: waypoint " + (i + 1) + " at " + MCP.round(plan[i].t) + " s is not after waypoint " + i + " at " + MCP.round(prev.t) + " s.", "invalid-argument");
        }
        if (prev.t + prev.hold > plan[i].t - fd + 1e-6) {
            if (prev.holdGiven) {
                MCP.fail("Waypoint " + i + " holds until " + MCP.round(prev.t + prev.hold) + " s, leaving no frame to travel to waypoint " + (i + 1) + " at " + MCP.round(plan[i].t) + " s. Shorten the hold or move the next waypoint later.", "invalid-argument");
            }
            prev.hold = Math.max(0, MCP.snapToFrame(comp, plan[i].t - fd - prev.t));
            notes.push("Waypoint " + i + " leaves at " + MCP.round(prev.t + prev.hold) + " s, before its click has settled; move waypoint " + (i + 1) + " later for a calmer click.");
        }
    }
    var last = plan[plan.length - 1];
    var allowed = [];
    for (i = 0; i < plan.length; i++) { allowed.push(plan[i].t); if (plan[i].hold > 0 && i < plan.length - 1) { allowed.push(plan[i].t + plan[i].hold); } }
    if (cursor) {
        var existing = MCP.uidemo.keysInside(cursor.property("ADBE Transform Group").property("ADBE Position"), plan[0].t, last.t, allowed);
        if (existing.length) {
            MCP.fail("The cursor already has Position keys inside this journey (" + existing.join(", ") + " s). Remove them (delete-keyframes-in-range) or time the journey around them.", "invalid-argument", { keys: existing });
        }
        var scaleProp = cursor.property("ADBE Transform Group").property("ADBE Scale");
        if (anyClick && _mcpTry(function () { return scaleProp.expression !== "" && scaleProp.expressionEnabled; }, false)) {
            notes.push("The cursor's Scale has an expression, which may hide the click dips.");
        }
    }

    // Build the cursor when none was given; it rides a camera null that is already there.
    var created = false, shadow = null, look = null, rodeCamera = null;
    if (!cursor) {
        var built = MCP.uidemo.buildCursor(comp, args.cursorStyle || {}, plan[0].pt, notes);
        cursor = built.layer; shadow = built.shadow; look = built.look; created = true;
        if (args.rideCamera !== false) {
            var cam = MCP.uidemo.findCamera(comp, {}, MCP.uidemo.CAMERA_NAME);
            if (cam) {
                cursor.parent = cam.layer;
                MCP.uidemo.setXY(cursor.property("ADBE Transform Group").property("ADBE Scale"), [100, 100]);
                cursor.property("ADBE Transform Group").property("ADBE Rotate Z").setValue(0);
                rodeCamera = MCP.serialize.layerRef(cam.layer);
                notes.push("The cursor rides the camera null '" + cam.layer.name + "', so it stays on its targets when the camera moves.");
            }
        }
    }

    // One eased key per waypoint, plus a departure key where the cursor holds.
    var pos = cursor.property("ADBE Transform Group").property("ADBE Position");
    var keyTimes = [];
    for (i = 0; i < plan.length; i++) {
        var p = plan[i];
        var v = MCP.uidemo.apply(MCP.uidemo.invert(MCP.uidemo.parentAffine(cursor, p.t)), p.pt);
        var cur = MCP.uidemo.valueAt(pos, p.t, pos.value);
        if (MCP.isArray(cur) && cur.length > 2) { v.push(Number(cur[2])); }
        p.value = v;
        var ki = MCP.easing.setKey(pos, p.t, v, "linear");
        if (ki > 1) { MCP.easing.applySegment(pos, ki, p.easing); }
        keyTimes.push(p.t);
        p.depart = p.t;
        if (p.hold > 0 && i < plan.length - 1) {
            p.depart = p.t + p.hold;
            var kd = MCP.easing.setKey(pos, p.depart, v, "linear");
            MCP.easing.applySegment(pos, kd, "hold");
            keyTimes.push(p.depart);
        }
    }

    // Optional arc: bow each travel segment by a fraction of its length (positive bows up).
    var arc = MCP.clamp(MCP.num(args.arc, 0), -0.5, 0.5);
    var arcs = 0;
    if (arc !== 0) {
        for (i = 0; i < plan.length - 1; i++) {
            var a = plan[i], b = plan[i + 1];
            var d = [b.value[0] - a.value[0], b.value[1] - a.value[1]];
            var len = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
            if (len < 1) { continue; }
            var n = [d[1] / len, -d[0] / len];
            if (n[1] > 1e-6 || (Math.abs(n[1]) <= 1e-6 && n[0] > 0)) { n = [-n[0], -n[1]]; }
            var hgt = arc * len / 0.75;
            var outT = [d[0] / 3 + n[0] * hgt, d[1] / 3 + n[1] * hgt];
            var inT = [-d[0] / 3 + n[0] * hgt, -d[1] / 3 + n[1] * hgt];
            var ia = MCP.easing.keyIndexAtTime(pos, a.depart, 1e-3), ib = MCP.easing.keyIndexAtTime(pos, b.t, 1e-3);
            if (ia < 1 || ib < 1) { continue; }
            var okA = MCP.uidemo.setTangents(pos, ia, MCP.uidemo.tangentAt(pos, ia, "in"), outT);
            var okB = MCP.uidemo.setTangents(pos, ib, inT, MCP.uidemo.tangentAt(pos, ib, "out"));
            if (okA && okB) { arcs++; }
        }
        if (!arcs && plan.length > 1) { notes.push("The arc could not be set on this After Effects; the path stays straight."); }
    }

    // Clicks: the press mechanism on the target (with the cursor dipping), or on the cursor alone.
    var clicks = [];
    for (i = 0; i < plan.length; i++) {
        var c = plan[i];
        if (!c.click) { continue; }
        var pressArgs = { comp: { id: comp.id }, frame: MCP.frameOf(comp, c.t + delay) };
        if (ring) {
            pressArgs.ripple = MCP.extend({ style: "ring", radius: 36, strokeWidth: 2, color: [0.067, 0.067, 0.067, 1], opacity: 35, name: cursor.name + " Ring" }, ring);
            pressArgs.ripple.position = [c.pt[0], c.pt[1]];
        }
        if (c.pressTarget) {
            pressArgs.layer = MCP.uidemo.ref(c.target);
            pressArgs.variant = c.variant;
            if (MCP.isDefined(c.scale)) { pressArgs.scale = Number(c.scale); }
            if (MCP.isArray(c.flip) && c.flip.length) { pressArgs.flip = c.flip; }
            pressArgs.cursor = { layer: MCP.uidemo.ref(cursor), scale: cursorPct };
        } else {
            pressArgs.layer = MCP.uidemo.ref(cursor);
            pressArgs.variant = "dip";
            pressArgs.scale = cursorPct;
        }
        var res = MCP.invoke("press", pressArgs);
        clicks.push({
            waypoint: c.index + 1,
            pressed: c.pressTarget ? MCP.serialize.layerRef(c.target) : null,
            variant: c.pressTarget ? c.variant : "dip",
            startTime: res.startTime, clickTime: res.clickTime, endTime: res.endTime,
            startFrame: res.startFrame, clickFrame: res.clickFrame, endFrame: res.endFrame,
            point: MCP.uidemo.round2(c.pt),
            targetKeys: c.pressTarget ? res.keys : null,
            cursorKeys: c.pressTarget ? (res.cursor ? res.cursor.keys : null) : res.keys,
            flips: res.flips,
            ring: res.ripple ? { id: res.ripple.layer.id, name: res.ripple.layer.name, startTime: res.ripple.startTime, endTime: res.ripple.endTime } : null
        });
    }

    if (MCP.bool(args.keepOnTop, true)) { cursor.moveToBeginning(); }
    MCP.uidemo.tag(cursor, MCP.uidemo.CURSOR_TAG);

    var wps = [];
    for (i = 0; i < plan.length; i++) {
        wps.push({
            waypoint: i + 1, time: MCP.round(plan[i].t), frame: MCP.frameOf(comp, plan[i].t),
            point: MCP.uidemo.round2(plan[i].pt), value: MCP.uidemo.round2(plan[i].value),
            target: plan[i].target ? MCP.serialize.layerRef(plan[i].target) : null, anchor: plan[i].anchor,
            hold: MCP.round(plan[i].hold), departTime: MCP.round(plan[i].depart), click: plan[i].click
        });
    }
    return {
        composition: MCP.serialize.compRef(comp),
        cursor: MCP.serialize.layer(cursor), created: created, look: look, shadow: shadow, rodeCamera: rodeCamera,
        easing: MCP.isDefined(args.easing) ? args.easing : MCP.uidemo.LAND_TEXT,
        arc: arc, arcsSet: arcs,
        keys: MCP.animate.keysAt(pos, keyTimes),
        waypoints: wps, clicks: clicks, notes: notes
    };
}, { mutating: true });

/* --------------------------------------------------------- scroll-in-window */

MCP.uidemo.scrollExpression = function (sliderName) {
    return MCP.uidemo.SCROLL_TAG + ": moves this layer up by effect(" + MCP.expr.str(sliderName) + ") in page pixels\n" +
        "var s = effect(" + MCP.expr.str(sliderName) + ")(\"Slider\").value;\n" +
        "var k = transform.scale[1] / 100;\n" +
        "var p = value;\n" +
        "p[1] = p[1] - s * k;\n" +
        "p";
};

/** The Scroll slider of a layer that already scrolls in a window, or null. */
MCP.uidemo.scrollRig = function (layer, sliderName) {
    var fx = MCP.childProp(MCP.effectsGroup(layer), sliderName);
    if (!fx || fx.matchName !== "ADBE Slider Control") { return null; }
    var pos = layer.property("ADBE Transform Group").property("ADBE Position");
    var code = _mcpTry(function () { return pos.expression; }, "");
    if (String(code).indexOf(MCP.uidemo.SCROLL_TAG) < 0) { return null; }
    return MCP.childProp(fx, "ADBE Slider Control-0001");
};

MCP.register("scrollInWindow", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, screen = r.layer;
    var fd = MCP.frameDuration(comp);
    var stops = MCP.requireArg(args, "stops");
    if (!MCP.isArray(stops) || !stops.length) { MCP.fail("stops must be a non-empty array of {to or fraction, at or frame, hold}.", "invalid-argument"); }
    var sliderName = MCP.isDefined(args.sliderName) ? String(args.sliderName) : "Scroll";
    var notes = [], i;
    var times = [];
    for (i = 0; i < stops.length; i++) {
        var stp = stops[i] || {};
        var st = MCP.uidemo.timeOf(comp, stp, "at", "frame");
        if (st === null) { MCP.fail("Stop " + (i + 1) + " needs at (seconds) or frame.", "invalid-argument"); }
        if (MCP.isDefined(stp.to) === MCP.isDefined(stp.fraction)) { MCP.fail("Stop " + (i + 1) + " needs exactly one of to (pixels, \"top\" or \"bottom\") or fraction (0 to 1).", "invalid-argument"); }
        if (MCP.isDefined(stp.to) && typeof stp.to === "string" && stp.to !== "top" && stp.to !== "bottom") { MCP.fail("Stop " + (i + 1) + ": to must be pixels, \"top\" or \"bottom\".", "invalid-argument"); }
        if (MCP.isDefined(stp.to) && typeof stp.to !== "string" && isNaN(Number(stp.to))) { MCP.fail("Stop " + (i + 1) + ": to must be pixels, \"top\" or \"bottom\".", "invalid-argument"); }
        times.push(st);
    }
    var t0 = times[0];

    // Resolve the window, the fit and the scroll range before anything changes.
    var rigSlider = MCP.uidemo.scrollRig(screen, sliderName);
    var method, W, H, k, content, fitMode, wl = null, win = null, name = null, explanation;
    if (rigSlider) {
        method = "existing";
        fitMode = "existing";
        W = comp.width; H = comp.height;
        k = Number(MCP.uidemo.valueAt(screen.property("ADBE Transform Group").property("ADBE Scale"), t0, [100, 100])[1]) / 100;
        content = MCP.uidemo.contentRect(screen, t0);
        if (MCP.isDefined(args.window) || MCP.isDefined(args.windowLayer)) { notes.push("The layer already scrolls in its window; window and windowLayer were ignored and only the stops were added."); }
        explanation = "The layer already carries the scroll rig; the stops became keys on its slider.";
    } else {
        method = "precomp";
        if (screen instanceof CameraLayer || screen instanceof LightLayer) { MCP.fail("Layer '" + screen.name + "' is a camera or light.", "invalid-argument"); }
        var stg = screen.property("ADBE Transform Group");
        var animated = [];
        var check = ["ADBE Anchor Point", "ADBE Position", "ADBE Scale"];
        for (i = 0; i < check.length; i++) {
            var cp = stg.property(check[i]);
            if (_mcpTry(function () { return cp.numKeys; }, 0) > 0) { animated.push(cp.name); }
            if (_mcpTry(function () { return cp.expression !== "" && cp.expressionEnabled; }, false)) { animated.push(cp.name + " (expression)"); }
        }
        if (animated.length) { MCP.fail("The screen layer's " + animated.join(", ") + " is animated, and the scroll rig sets these. Remove the keys or expressions first, or scroll a precomp of the screen.", "unsupported"); }
        wl = MCP.isDefined(args.windowLayer) ? MCP.resolveLayer(comp, args.windowLayer) : null;
        if (wl && wl.index === screen.index) { MCP.fail("windowLayer must be a different layer from the screen.", "invalid-argument"); }
        if (wl) {
            var lr = MCP.uidemo.contentRect(wl, t0);
            var inset = MCP.num(args.inset, 0);
            win = { x: lr.left + inset, y: lr.top + inset, w: lr.width - 2 * inset, h: lr.height - 2 * inset };
        } else if (args.window && typeof args.window === "object") {
            win = { x: Number(args.window.x), y: Number(args.window.y), w: Number(args.window.width), h: Number(args.window.height) };
        } else {
            MCP.fail("Give window {x, y, width, height} in composition pixels, or windowLayer.", "invalid-argument");
        }
        W = Math.round(win.w); H = Math.round(win.h);
        if (W < 4 || H < 4) { MCP.fail("The window is too small (" + W + " x " + H + " px).", "invalid-argument"); }
        content = MCP.uidemo.contentRect(screen, t0);
        fitMode = String(MCP.arg(args, "fit", "width"));
        if (fitMode === "width") { k = W / content.width; }
        else if (fitMode === "keep") { k = Number(MCP.uidemo.valueAt(stg.property("ADBE Scale"), t0, [100, 100])[0]) / 100; }
        else { MCP.fail("fit must be width or keep.", "invalid-argument"); }
        if (!(k > 0)) { MCP.fail("The screen's scale is zero.", "invalid-argument"); }
        var rot = Number(MCP.uidemo.valueAt(stg.property("ADBE Rotate Z"), t0, 0)) || 0;
        if (Math.abs(rot) > 1e-3) { notes.push("The screen layer is rotated " + MCP.round(rot) + " degrees inside the window."); }
        name = MCP.isDefined(args.name) ? String(args.name) : screen.name + " Window";
        if (MCP.uidemo.compNamed(name)) {
            if (MCP.isDefined(args.name)) { MCP.fail("A composition named '" + name + "' already exists. Pick another name.", "invalid-argument"); }
            name = MCP.uidemo.uniqueCompName(name);
        }
        explanation = "The screen now lives in a precomposition the size of the window and scrolls inside it. Clipping by the composition bounds survives any later move, scale, parent or camera push with no matte layer to keep in step, and the window layer can be framed by device-frame, highlighted or made a component.";
    }
    var pageH = content.height;
    var viewH = H / k;
    var maxScroll = Math.max(0, pageH - viewH);
    if (maxScroll <= 0) { notes.push("The page is no taller than the window, so there is nothing to scroll; keys were still written."); }
    var momentum = MCP.bool(args.momentum, false);
    var defEase = momentum ? MCP.uidemo.EASE_GLIDE : MCP.uidemo.EASE_LAND;
    var resolved = [];
    for (i = 0; i < stops.length; i++) {
        var s = stops[i];
        var v;
        if (MCP.isDefined(s.fraction)) { v = MCP.clamp(Number(s.fraction), 0, 1) * maxScroll; }
        else if (s.to === "top") { v = 0; }
        else if (s.to === "bottom") { v = maxScroll; }
        else { v = Math.max(0, Number(s.to)); }
        if (maxScroll > 0 && v > maxScroll + 0.5) { notes.push("Stop " + (i + 1) + " asked for " + MCP.round(v, 1) + " px; the page ends at " + MCP.round(maxScroll, 1) + " px, so it stops there."); v = maxScroll; }
        var hold = MCP.isDefined(s.hold) ? Math.max(0, MCP.snapToFrame(comp, Number(s.hold))) : 0;
        resolved.push({ t: times[i], v: v, hold: hold, easing: MCP.isDefined(s.easing) ? s.easing : defEase });
    }
    for (i = 1; i < resolved.length; i++) {
        if (resolved[i].t <= resolved[i - 1].t + resolved[i - 1].hold + fd - 1e-6) {
            MCP.fail("Stop " + (i + 1) + " at " + MCP.round(resolved[i].t) + " s must come at least one frame after stop " + i + " and its hold end at " + MCP.round(resolved[i - 1].t + resolved[i - 1].hold) + " s.", "invalid-argument");
        }
    }
    var allowed = [];
    for (i = 0; i < resolved.length; i++) { allowed.push(resolved[i].t); allowed.push(resolved[i].t + resolved[i].hold); }
    if (rigSlider) {
        var inside = MCP.uidemo.keysInside(rigSlider, resolved[0].t, resolved[resolved.length - 1].t, allowed);
        if (inside.length) { MCP.fail("The " + sliderName + " slider already has keys inside these stops (" + inside.join(", ") + " s).", "invalid-argument", { keys: inside }); }
    }

    // Build the window: precompose the screen, size the comp to the window, fit the screen to its top.
    var windowComp = comp, instance = null, region = null, slider = rigSlider, exprState = null;
    if (!rigSlider) {
        var origParent = _mcpTry(function () { return screen.parent; }, null);
        var newComp;
        try { newComp = comp.layers.precompose([screen.index], name, true); } catch (e) {
            MCP.fail("precompose failed: " + e.message, "script-error");
        }
        for (i = 1; i <= comp.numLayers; i++) {
            if (_mcpTry(function () { return comp.layer(i).source.id === newComp.id; }, false)) { instance = comp.layer(i); break; }
        }
        if (!instance) { MCP.fail("Precomposed, but the window layer could not be found in '" + comp.name + "'.", "script-error"); }
        newComp.width = W;
        newComp.height = H;
        windowComp = newComp;
        screen = newComp.layer(1);
        var itgS = screen.property("ADBE Transform Group");
        MCP.uidemo.setXY(itgS.property("ADBE Anchor Point"), [content.left, content.top]);
        MCP.uidemo.setXY(itgS.property("ADBE Position"), [(W - content.width * k) / 2, 0]);
        MCP.uidemo.setXY(itgS.property("ADBE Scale"), [k * 100, k * 100]);

        var itg = instance.property("ADBE Transform Group");
        MCP.uidemo.setXY(itg.property("ADBE Anchor Point"), [W / 2, H / 2]);
        if (wl) {
            instance.parent = wl;
            itg = instance.property("ADBE Transform Group");
            MCP.uidemo.setXY(itg.property("ADBE Position"), [win.x + W / 2, win.y + H / 2]);
            MCP.uidemo.setXY(itg.property("ADBE Scale"), [100, 100]);
            itg.property("ADBE Rotate Z").setValue(0);
            MCP.uidemo.placeAbove(instance, wl);
        } else {
            MCP.uidemo.setXY(itg.property("ADBE Position"), [win.x + W / 2, win.y + H / 2]);
            if (origParent) {
                instance.parent = origParent;
                notes.push("The window layer is parented to '" + origParent.name + "', the screen's parent, keeping its place at " + MCP.round(comp.time) + " s.");
            }
        }
        var radius = MCP.num(args.cornerRadius, 0);
        if (radius > 0) {
            instance.property("ADBE Mask Parade").addProperty("ADBE Mask Atom").name = "Window Corners";
            instance.property("ADBE Mask Parade").property("Window Corners").property("ADBE Mask Shape").setValue(MCP.uidemo.roundedRect(0, 0, W, H, radius));
        }
        region = { x: MCP.round(win.x, 2), y: MCP.round(win.y, 2), width: W, height: H, space: wl ? "windowLayer" : "composition", windowLayer: wl ? MCP.serialize.layerRef(wl) : null, cornerRadius: radius };

        var added = MCP.fx.addFirstAvailable(screen, ["ADBE Slider Control"]);
        if (!added) { MCP.fail("A Slider Control could not be added to '" + screen.name + "'.", "unsupported"); }
        added.effect.name = sliderName;
        var code = MCP.uidemo.scrollExpression(sliderName);
        exprState = MCP.uidemo.setExpr(screen.property("ADBE Transform Group").property("ADBE Position"), code, "Transform/Position", []);
        exprState.expression = code;
        slider = MCP.childProp(MCP.childProp(MCP.effectsGroup(screen), sliderName), "ADBE Slider Control-0001");
        if (!slider) { MCP.fail("The new Slider Control could not be found again.", "script-error"); }
    }

    // One eased key per stop, plus a hold key where the page rests.
    var keyTimes = [];
    for (i = 0; i < resolved.length; i++) {
        var rs = resolved[i];
        var ki = MCP.easing.setKey(slider, rs.t, rs.v);
        if (ki > 1) { MCP.easing.applySegment(slider, ki, rs.easing); }
        keyTimes.push(rs.t);
        if (rs.hold > 0 && i < resolved.length - 1) {
            var kh = MCP.easing.setKey(slider, rs.t + rs.hold, rs.v);
            MCP.easing.applySegment(slider, kh, "hold");
            keyTimes.push(rs.t + rs.hold);
        }
    }
    var outStops = [];
    for (i = 0; i < resolved.length; i++) {
        outStops.push({ stop: i + 1, time: MCP.round(resolved[i].t), frame: MCP.frameOf(comp, resolved[i].t), scroll: MCP.round(resolved[i].v, 2), hold: MCP.round(resolved[i].hold) });
    }
    return {
        composition: MCP.serialize.compRef(comp),
        method: method, explanation: explanation,
        window: { composition: MCP.serialize.compRef(windowComp), width: W, height: H, layer: instance ? MCP.serialize.layer(instance) : null, region: region },
        screen: { composition: MCP.serialize.compRef(windowComp), layer: MCP.serialize.layerRef(screen) },
        fit: { mode: fitMode, scale: MCP.round(k * 100, 3) },
        page: { height: MCP.round(pageH, 2), visibleHeight: MCP.round(viewH, 2), maxScroll: MCP.round(maxScroll, 2) },
        slider: {
            effect: sliderName, propertyPath: "Effects/" + sliderName + "/Slider",
            expressionRef: "effect(" + MCP.expr.str(sliderName) + ")(\"Slider\")",
            keys: MCP.animate.keysAt(slider, keyTimes)
        },
        positionExpression: exprState,
        easing: momentum ? MCP.uidemo.GLIDE_TEXT : MCP.uidemo.LAND_TEXT,
        stops: outStops, notes: notes
    };
}, { mutating: true });

/* ---------------------------------------------------------- focus-on-region */

/** The camera null to reuse: the given layer, a null with the name, or an add-camera-push null. */
MCP.uidemo.findCamera = function (comp, args, name) {
    if (MCP.isDefined(args.camera)) { return { layer: MCP.resolveLayer(comp, args.camera), how: "given" }; }
    var i, L;
    for (i = 1; i <= comp.numLayers; i++) {
        L = comp.layer(i);
        if (L.name === name && _mcpTry(function () { return L.nullLayer; }, false)) { return { layer: L, how: "named" }; }
    }
    for (i = 1; i <= comp.numLayers; i++) {
        L = comp.layer(i);
        if (String(L.name).indexOf("Camera Push") === 0 && _mcpTry(function () { return L.nullLayer; }, false)) { return { layer: L, how: "camera-push" }; }
    }
    return null;
};

/** Why a layer should not ride a new camera null, or null when it should. */
MCP.uidemo.skipReason = function (L, excluded) {
    if (L instanceof CameraLayer || L instanceof LightLayer) { return "cameras and lights do not ride a 2D camera null"; }
    var parent = _mcpTry(function () { return L.parent; }, null);
    if (parent) { return "already parented to '" + parent.name + "', which carries it"; }
    if (MCP.uidemo.hasTag(L, MCP.uidemo.OVERLAY_TAG)) { return "a screen overlay (highlight, toast) stays fixed to the frame"; }
    if (excluded[L.index]) { return "excluded"; }
    return null;
};

/**
 * Keys of a reused camera null that a focus move would break: any key inside
 * the move, and without a return any later key that does not end a straight
 * (linear) push the move can ride on.
 */
MCP.uidemo.focusConflicts = function (prop, t0, tEnd, hasReturn) {
    var n = _mcpTry(function () { return prop.numKeys; }, 0), out = [], i;
    for (i = 1; i <= n; i++) {
        var kt = prop.keyTime(i);
        if (kt > t0 + 1e-4 && kt < tEnd - 1e-4) { out.push(MCP.round(kt)); }
    }
    if (out.length || hasReturn) { return out; }
    for (i = 1; i <= n; i++) {
        var t = prop.keyTime(i);
        if (t >= tEnd - 1e-4 && t > t0 + 1e-4) {
            var ok = i > 1 && prop.keyTime(i - 1) <= t0 + 1e-4 && _mcpTry(function () { return prop.keyOutInterpolationType(i - 1) === KeyframeInterpolationType.LINEAR; }, false);
            if (!ok) { out.push(MCP.round(t)); }
            break;
        }
    }
    return out;
};

MCP.register("focusOnRegion", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, target = r.layer;
    if (!MCP.isDefined(args.time) && !MCP.isDefined(args.frame)) { MCP.fail("focus-on-region needs time (seconds) or frame: when the move starts.", "invalid-argument"); }
    var notes = [], i;
    var t0 = MCP.snapToFrame(comp, MCP.timeArg(comp, args));
    var dur = MCP.animate.span(comp, args, 0.8);
    var t1 = t0 + dur;
    var easing = MCP.isDefined(args.easing) ? args.easing : MCP.uidemo.EASE_CAMERA;
    var fill = MCP.clamp(MCP.num(args.fill, 0.7), 0.05, 1);
    var pad = Math.max(0, MCP.num(args.padding, 24));
    var maxScale = MCP.num(args.maxScale, 800);
    var holdPush = MCP.num(args.holdPush, 0);
    var ret = args["return"] ? (typeof args["return"] === "object" ? args["return"] : {}) : null;
    var t2 = null, t3 = null, retEase = null;
    if (ret) {
        t2 = t1 + MCP.snapToFrame(comp, Math.max(0, MCP.num(ret.hold, 1)));
        t3 = t2 + MCP.animate.span(comp, ret, dur);
        retEase = MCP.isDefined(ret.easing) ? ret.easing : easing;
    }
    var tEnd = t3 !== null ? t3 : t1;
    var lrect = MCP.uidemo.localRect(target, args.rect, t1);
    var name = MCP.isDefined(args.name) ? String(args.name) : MCP.uidemo.CAMERA_NAME;
    var found = MCP.uidemo.findCamera(comp, args, name);
    var excluded = {};
    if (MCP.isArray(args.exclude)) {
        var ex = MCP.resolveLayers(comp, args.exclude);
        for (i = 0; i < ex.length; i++) { excluded[ex[i].index] = true; }
    }

    var cam = null, created = false, parented = [], skipped = [], carryTimes = [];
    if (found) {
        cam = found.layer;
        if (cam.index === target.index) { MCP.fail("The region layer is the camera null itself. Pick the screen or element to frame.", "invalid-argument"); }
        if (!MCP.uidemo.isDescendant(target, cam)) {
            MCP.fail("Layer '" + target.name + "' does not ride the camera null '" + cam.name + "', so moving the null would not frame it. Parent it (or its top parent) to '" + cam.name + "', or pass camera.", "invalid-argument");
        }
        var ctg = cam.property("ADBE Transform Group");
        if (_mcpTry(function () { return !!ctg.property("ADBE Position").dimensionsSeparated; }, false)) { MCP.fail("The camera null '" + cam.name + "' has separated Position dimensions; join them first.", "unsupported"); }
        var busy = MCP.uidemo.focusConflicts(ctg.property("ADBE Scale"), t0, tEnd, !!ret).concat(MCP.uidemo.focusConflicts(ctg.property("ADBE Position"), t0, tEnd, !!ret));
        if (busy.length) {
            MCP.fail("The camera null '" + cam.name + "' already moves at " + busy.join(", ") + " s, which this focus would break. Start the focus after that move, give it a return, or use another null (camera or name).", "invalid-argument", { keys: busy });
        }
        if (_mcpTry(function () { return ctg.property("ADBE Anchor Point").numKeys; }, 0) > 0) { notes.push("The camera null's Anchor Point is keyed; the framing uses its value at the landing."); }
        if (!ret) {
            var collect = function (prop) {
                for (var q = 1; q <= prop.numKeys; q++) {
                    var kt = prop.keyTime(q), dup = false;
                    if (kt <= t1 + 1e-4) { continue; }
                    for (var z = 0; z < carryTimes.length; z++) { if (Math.abs(carryTimes[z] - kt) < 1e-4) { dup = true; } }
                    if (!dup) { carryTimes.push(kt); }
                }
            };
            collect(ctg.property("ADBE Scale"));
            collect(ctg.property("ADBE Position"));
            carryTimes.sort(function (a, b) { return a - b; });
        }
    } else {
        var why = MCP.uidemo.skipReason(MCP.uidemo.rootOf(target), excluded);
        if (why) { MCP.fail("Layer '" + target.name + "' would not ride a new camera null: its top layer is " + why + ".", "invalid-argument"); }
        cam = comp.layers.addNull(comp.duration);
        cam.name = MCP.animate.uniqueLayerName(comp, name);
        try { cam.startTime = 0; cam.outPoint = comp.duration; } catch (e0) {}
        var ntg = cam.property("ADBE Transform Group");
        // Anchor and position on the comp centre make an identity transform, so parenting moves nothing.
        MCP.uidemo.setXY(ntg.property("ADBE Anchor Point"), [comp.width / 2, comp.height / 2]);
        MCP.uidemo.setXY(ntg.property("ADBE Position"), [comp.width / 2, comp.height / 2]);
        created = true;
        for (i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (L.index === cam.index) { continue; }
            var reason = MCP.uidemo.skipReason(L, excluded);
            if (reason) { skipped.push({ layer: MCP.serialize.layerRef(L), reason: reason }); continue; }
            try { L.parent = cam; parented.push(MCP.serialize.layerRef(L)); }
            catch (e1) { skipped.push({ layer: MCP.serialize.layerRef(L), reason: String(e1.message || e1) }); }
        }
        if (!MCP.uidemo.isDescendant(target, cam)) { MCP.fail("Layer '" + target.name + "' could not be parented to the new camera null.", "script-error"); }
    }

    var tg = cam.property("ADBE Transform Group");
    var sp = tg.property("ADBE Scale"), pp = tg.property("ADBE Position");
    var A = MCP.uidemo.valueAt(tg.property("ADBE Anchor Point"), t1, [0, 0]);
    var rot = Number(MCP.uidemo.valueAt(MCP.childProp(tg, "ADBE Rotate Z"), t1, 0)) || 0;
    if (Math.abs(rot) > 1e-3) { notes.push("The camera null is rotated " + MCP.round(rot) + " degrees; the framing assumes no rotation."); }
    // Values the null has now, read before any key is written.
    var s0 = MCP.animate.valueAt(sp, t0), p0 = MCP.animate.valueAt(pp, t0);
    var s1 = MCP.animate.valueAt(sp, t1), p1 = MCP.animate.valueAt(pp, t1);
    var s3 = t3 !== null ? MCP.animate.valueAt(sp, t3) : null, p3 = t3 !== null ? MCP.animate.valueAt(pp, t3) : null;
    var later = [];
    for (i = 0; i < carryTimes.length; i++) { later.push({ t: carryTimes[i], s: MCP.animate.valueAt(sp, carryTimes[i]), p: MCP.animate.valueAt(pp, carryTimes[i]) }); }

    // The region in the camera null's own space at the landing, so the null's current zoom does not count.
    var box = MCP.uidemo.regionBox(target, lrect, t1, cam);
    var w = box.width + 2 * pad, h = box.height + 2 * pad;
    var M = MCP.uidemo.parentAffine(cam, t1);
    var pScale = MCP.uidemo.scaleOf(M);
    var C = MCP.uidemo.apply(MCP.uidemo.invert(M), [comp.width / 2, comp.height / 2]);
    var pct = fill * Math.min(comp.width / w, comp.height / h) / pScale * 100;
    if (pct > maxScale) { notes.push("The region needs " + MCP.round(pct, 1) + " % to fill the frame; capped at maxScale " + maxScale + " %."); pct = maxScale; }
    var raster = _mcpTry(function () { return (target.source instanceof FootageItem) && !(target.source.mainSource instanceof SolidSource); }, false);
    if (pct > 100 && raster) { notes.push("A raster screen softens past 100 %; use a higher-resolution capture or a vector rebuild for close framings."); }
    var withZ = function (xy, ref) { var v = [xy[0], xy[1]]; if (MCP.isArray(ref) && ref.length > 2) { v.push(Number(ref[2])); } return v; };
    var stateFor = function (scalePct) {
        var s = scalePct / 100;
        return { scale: withZ([scalePct, scalePct], s0), position: withZ([C[0] - s * (box.cx - A[0]), C[1] - s * (box.cy - A[1])], p0) };
    };
    var land = stateFor(pct);
    var held = stateFor(pct * (1 + holdPush / 100));
    var dist = function (a, b) { return Math.sqrt(Math.pow(Number(a[0]) - Number(b[0]), 2) + Math.pow(Number(a[1]) - Number(b[1]), 2)); };

    // Carrying a push on: the push's own relative motion after the landing, applied to the new framing.
    var carried = [];
    for (i = 0; i < later.length; i++) {
        var c = later[i];
        var rx = Number(c.s[0]) / Number(s1[0]), ry = Number(c.s[1]) / Number(s1[1]);
        var sL = pct / 100;
        var bL = [land.position[0] - sL * A[0], land.position[1] - sL * A[1]];
        var b1 = [Number(p1[0]) - Number(s1[0]) / 100 * A[0], Number(p1[1]) - Number(s1[1]) / 100 * A[1]];
        var bN = [Number(c.p[0]) - Number(c.s[0]) / 100 * A[0], Number(c.p[1]) - Number(c.s[1]) / 100 * A[1]];
        var sN = [rx * sL, ry * sL];
        var b = [rx * (bL[0] - b1[0]) + bN[0], ry * (bL[1] - b1[1]) + bN[1]];
        carried.push({ t: c.t, scale: withZ([sN[0] * 100, sN[1] * 100], s0), position: withZ([b[0] + sN[0] * A[0], b[1] + sN[1] * A[1]], p0) });
    }
    if (carried.length) { notes.push("The camera null keeps moving after this focus (" + carryTimes.join(", ") + " s), so that motion now continues from the new framing."); }
    var movePos = dist(p0, land.position) > 0.01 || carried.length > 0 || (ret && (dist(p3, held.position) > 0.01 || dist(held.position, land.position) > 0.01));

    var writeChain = function (prop, entries, spatial) {
        var times = [];
        for (var j = 0; j < entries.length; j++) {
            var e = entries[j];
            var ki = MCP.easing.setKey(prop, e.t, e.v, spatial);
            if (j === 0) { MCP.uidemo.keepLinearAround(prop, ki); }
            if (j > 0) { MCP.easing.applySegment(prop, ki, e.ease); }
            if (j === entries.length - 1) {
                var n = _mcpTry(function () { return prop.numKeys; }, 0);
                try { if (ki < n && prop.keyInInterpolationType(ki + 1) === KeyframeInterpolationType.LINEAR) { MCP.easing.setInterp(prop, ki, null, KeyframeInterpolationType.LINEAR); } } catch (e2) {}
            }
            times.push(e.t);
        }
        return MCP.animate.keysAt(prop, times);
    };
    var sEntries = [{ t: t0, v: s0 }, { t: t1, v: land.scale, ease: easing }];
    var pEntries = [{ t: t0, v: p0 }, { t: t1, v: land.position, ease: easing }];
    if (ret) {
        var holdEase = holdPush !== 0 ? "linear" : "hold";
        sEntries.push({ t: t2, v: held.scale, ease: holdEase });
        sEntries.push({ t: t3, v: s3, ease: retEase });
        pEntries.push({ t: t2, v: held.position, ease: holdEase });
        pEntries.push({ t: t3, v: p3, ease: retEase });
    }
    for (i = 0; i < carried.length; i++) {
        sEntries.push({ t: carried[i].t, v: carried[i].scale, ease: "linear" });
        pEntries.push({ t: carried[i].t, v: carried[i].position, ease: "linear" });
    }
    var scaleKeys = writeChain(sp, sEntries, null);
    var posKeys = movePos ? writeChain(pp, pEntries, "linear") : null;
    if (!movePos) { notes.push("The region is already centred, so only Scale is keyed."); }

    return {
        composition: MCP.serialize.compRef(comp),
        camera: { layer: MCP.serialize.layer(cam), created: created, reused: found ? found.how : false, parented: parented, skipped: skipped },
        region: { layer: MCP.serialize.layerRef(target), rect: MCP.uidemo.rectOut(lrect), inCameraSpace: MCP.uidemo.boxOut(box), padding: pad },
        fill: fill, scale: MCP.round(pct, 3),
        easing: MCP.isDefined(args.easing) ? args.easing : MCP.uidemo.CAMERA_TEXT,
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        "return": ret ? { holdUntil: MCP.round(t2), endTime: MCP.round(t3), holdFrame: MCP.frameOf(comp, t2), endFrame: MCP.frameOf(comp, t3), holdPush: holdPush } : null,
        carriedKeys: carryTimes.length ? carryTimes : null,
        keys: { scale: scaleKeys, position: posKeys },
        notes: notes
    };
}, { mutating: true });

/* ------------------------------------------------------------- device-frame */

MCP.uidemo.THEMES = {
    light: { frame: "#F3F4F6", pill: "#E5E7EB", dots: "#D1D5DB", separator: "#E5E7EB", url: "#6B7280", edge: "#000000", edgeOpacity: 8, rim: "#E2E3E6", bezel: "#0B0B0D", camera: "#1C1D22", base: "#D6D8DC", groove: "#B9BCC2", shadowOpacity: 16 },
    dark: { frame: "#1F2023", pill: "#2C2E33", dots: "#45474E", separator: "#2C2E33", url: "#A1A5AD", edge: "#FFFFFF", edgeOpacity: 7, rim: "#2A2B2F", bezel: "#050506", camera: "#17181C", base: "#34363B", groove: "#232428", shadowOpacity: 32 }
};
MCP.uidemo.TRAFFIC = ["#FF5F57", "#FEBC2E", "#28C840"];

/** Expression for a colour that follows the Body fill: darker on light frames, lighter on dark ones. */
MCP.uidemo.followColor = function (fillName, darken, lighten) {
    return "// Follows the frame colour (Body)\n" +
        "var c = thisLayer.content(\"Body\").content(" + MCP.expr.str(fillName) + ").color;\n" +
        "var l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];\n" +
        "var d = l > 0.5 ? " + MCP.expr.num(-darken) + " : " + MCP.expr.num(lighten) + ";\n" +
        "[clamp(c[0] + d, 0, 1), clamp(c[1] + d, 0, 1), clamp(c[2] + d, 0, 1), 1]";
};

MCP.uidemo.fillColorOf = function (layer, group) {
    var f = MCP.uidemo.groupItem(layer, group, "ADBE Vector Graphic - Fill");
    return f ? f.property("ADBE Vector Fill Color") : null;
};

MCP.register("deviceFrame", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, screen = r.layer;
    var device = String(MCP.requireArg(args, "device"));
    if (device !== "browser" && device !== "phone" && device !== "tablet" && device !== "laptop") { MCP.fail("device must be browser, phone, tablet or laptop.", "invalid-argument"); }
    var themeName = String(MCP.arg(args, "theme", "light"));
    var th = MCP.uidemo.THEMES[themeName];
    if (!th) { MCP.fail("theme must be light or dark.", "invalid-argument"); }
    if (screen instanceof CameraLayer || screen instanceof LightLayer || _mcpTry(function () { return screen.nullLayer; }, false)) { MCP.fail("Layer '" + screen.name + "' has no pixels to frame.", "invalid-argument"); }
    var dotStyle = String(MCP.arg(args, "dots", "mono"));
    if (dotStyle !== "mono" && dotStyle !== "color") { MCP.fail("dots must be mono or color.", "invalid-argument"); }
    var notes = [], exprs = [], i;
    var t = MCP.timeArg(comp, args, screen.inPoint);
    var rc = MCP.uidemo.contentRect(screen, t);
    var k = MCP.uidemo.scaleOf(MCP.uidemo.affine(screen, t, null));
    if (!(k > 0)) { MCP.fail("The screen layer is scaled to zero.", "invalid-argument"); }
    var wc = rc.width * k, hc = rc.height * k;
    var Lc = function (v) { return v / k; };
    var x = rc.left, y = rc.top, w = rc.width, h = rc.height;
    var mainColor = MCP.isDefined(args.color) ? args.color : (device === "browser" ? th.frame : th.rim);
    var base = MCP.isDefined(args.name) ? String(args.name) : screen.name + " " + device.charAt(0).toUpperCase() + device.substring(1);

    var cspec = null, cname = null;
    if (args.component) {
        cspec = typeof args.component === "object" ? args.component : {};
        cname = MCP.isDefined(cspec.name) ? String(cspec.name) : base;
        if (MCP.uidemo.compNamed(cname)) {
            if (MCP.isDefined(cspec.name)) { MCP.fail("A composition named '" + cname + "' already exists. Pick another component name.", "invalid-argument"); }
            cname = MCP.uidemo.uniqueCompName(cname);
        }
    }

    var frame = comp.layers.addShape();
    frame.name = MCP.animate.uniqueLayerName(comp, base + " Frame");
    var notch = null, urlLayer = null, sizes = {}, screenRadii, bodyShape, fillName = "Fill", body;
    var hair = Lc(1);

    if (device === "browser") {
        var barH = MCP.clamp(Math.round(wc * 0.042), 30, 64);
        var R = MCP.isDefined(args.cornerRadius) ? Number(args.cornerRadius) : MCP.clamp(Math.round(wc * 0.011), 8, 18);
        var dotD = Math.round(barH * 0.24), gap = Math.round(dotD * 0.68), padL = Math.round(barH * 0.4);
        var pillH = Math.round(barH * 0.58), pillW = Math.min(Math.round(wc * 0.4), 640);
        var cy = y - Lc(barH) / 2;
        var dots = [];
        for (i = 0; i < 3; i++) { dots.push(MCP.uidemo.circle(x + Lc(padL + dotD / 2 + i * (dotD + gap)), cy, Lc(dotD / 2))); }
        if (dotStyle === "color") {
            for (i = 0; i < 3; i++) { MCP.uidemo.addPathGroup(frame, "Dot " + (i + 1), dots[i], { fill: MCP.uidemo.TRAFFIC[i] }); }
        } else {
            MCP.uidemo.addPathGroup(frame, "Dots", dots, { fill: th.dots });
        }
        MCP.uidemo.addPathGroup(frame, "Address", MCP.uidemo.roundedRect(x + w / 2 - Lc(pillW) / 2, cy - Lc(pillH) / 2, Lc(pillW), Lc(pillH), Lc(pillH) / 2), { fill: th.pill });
        MCP.uidemo.addPathGroup(frame, "Separator", MCP.uidemo.roundedRect(x, y - hair, w, hair, 0), { fill: th.separator });
        bodyShape = MCP.uidemo.roundedRect(x, y - Lc(barH), w, h + Lc(barH), Lc(R));
        body = MCP.uidemo.addPathGroup(frame, "Body", bodyShape, { fill: mainColor });
        fillName = body.fill || "Fill";
        MCP.uidemo.setExpr(MCP.uidemo.fillColorOf(frame, "Address"), MCP.uidemo.followColor(fillName, 0.055, 0.05), "Contents/Address/Fill/Color", exprs);
        MCP.uidemo.setExpr(MCP.uidemo.fillColorOf(frame, "Separator"), MCP.uidemo.followColor(fillName, 0.055, 0.05), "Contents/Separator/Fill/Color", exprs);
        if (dotStyle !== "color") { MCP.uidemo.setExpr(MCP.uidemo.fillColorOf(frame, "Dots"), MCP.uidemo.followColor(fillName, 0.13, 0.14), "Contents/Dots/Fill/Color", exprs); }
        screenRadii = [0, 0, Lc(R), Lc(R)];
        sizes = { barHeight: barH, cornerRadius: R, dotDiameter: dotD, addressPill: [pillW, pillH] };
        if (MCP.isDefined(args.url) && String(args.url) !== "") {
            var fs = Math.max(8, Math.round(pillH * 0.48));
            var made = MCP.invoke("createTextLayer", { comp: { id: comp.id }, text: String(args.url), fontSize: Lc(fs), fillColor: th.url, justification: "center", name: MCP.animate.uniqueLayerName(comp, base + " URL"), font: args.font });
            urlLayer = MCP.resolveLayer(comp, { name: made.layer.name });
            MCP.uidemo.attach(urlLayer, screen);
            MCP.uidemo.setXY(urlLayer.property("ADBE Transform Group").property("ADBE Position"), [x + w / 2, cy + Lc(fs) * 0.35]);
            sizes.urlFontSize = fs;
        }
    } else if (device === "phone" || device === "tablet") {
        var m = Math.min(wc, hc);
        var bz = device === "phone" ? Math.max(6, Math.round(wc * 0.035)) : Math.max(8, Math.round(m * 0.045));
        var rim = device === "phone" ? Math.max(2, Math.round(wc * 0.011)) : Math.max(2, Math.round(m * 0.008));
        var Rs = MCP.isDefined(args.cornerRadius) ? Number(args.cornerRadius) : (device === "phone" ? Math.round(wc * 0.13) : Math.round(m * 0.03));
        if (device === "tablet") {
            var camD = Math.max(4, Math.round(bz * 0.22));
            MCP.uidemo.addPathGroup(frame, "Camera", MCP.uidemo.circle(x + w / 2, y - Lc(bz) / 2, Lc(camD) / 2), { fill: th.camera });
            sizes.cameraDiameter = camD;
        }
        MCP.uidemo.addPathGroup(frame, "Bezel", MCP.uidemo.roundedRect(x - Lc(bz), y - Lc(bz), w + 2 * Lc(bz), h + 2 * Lc(bz), Lc(Rs + bz)), { fill: th.bezel });
        bodyShape = MCP.uidemo.roundedRect(x - Lc(bz + rim), y - Lc(bz + rim), w + 2 * Lc(bz + rim), h + 2 * Lc(bz + rim), Lc(Rs + bz + rim));
        body = MCP.uidemo.addPathGroup(frame, "Body", bodyShape, { fill: mainColor });
        fillName = body.fill || "Fill";
        screenRadii = Lc(Rs);
        sizes = { bezel: bz, rim: rim, screenRadius: Rs };
        if (device === "phone" && args.notch !== false) {
            var iw = Math.round(wc * 0.3), ih = Math.max(6, Math.round(wc * 0.088));
            notch = comp.layers.addShape();
            notch.name = MCP.animate.uniqueLayerName(comp, base + " Island");
            MCP.uidemo.addPathGroup(notch, "Island", MCP.uidemo.roundedRect(x + w / 2 - Lc(iw) / 2, y + Lc(Math.round(wc * 0.03)), Lc(iw), Lc(ih), Lc(ih) / 2), { fill: "#000000" });
            sizes.island = [iw, ih];
        }
    } else {
        var bzs = Math.round(wc * 0.022), bzt = Math.round(wc * 0.03), bzb = Math.round(wc * 0.05);
        var lrim = Math.max(2, Math.round(wc * 0.005)), Rl = Math.round(wc * 0.022), Rlb = Math.max(2, Math.round(wc * 0.004));
        var Rsl = MCP.isDefined(args.cornerRadius) ? Number(args.cornerRadius) : Math.round(wc * 0.008);
        var lidX = x - Lc(bzs), lidY = y - Lc(bzt), lidW = w + 2 * Lc(bzs), lidH = h + Lc(bzt + bzb);
        var baseW = (lidW + 2 * Lc(lrim)) * 1.16, baseH = Lc(Math.max(10, Math.round(wc * 0.032)));
        var baseY = lidY + lidH + Lc(lrim);
        var grooveW = baseW * 0.15, grooveH = baseH * 0.38;
        MCP.uidemo.addPathGroup(frame, "Groove", MCP.uidemo.roundedRect(x + w / 2 - grooveW / 2, baseY, grooveW, grooveH, [0, 0, grooveH * 0.5, grooveH * 0.5]), { fill: th.groove });
        MCP.uidemo.addPathGroup(frame, "Base", MCP.uidemo.roundedRect(x + w / 2 - baseW / 2, baseY, baseW, baseH, [Lc(2), Lc(2), baseH * 0.7, baseH * 0.7]), { fill: th.base });
        MCP.uidemo.addPathGroup(frame, "Camera", MCP.uidemo.circle(x + w / 2, y - Lc(bzt) / 2, Lc(Math.max(3, Math.round(bzt * 0.2))) / 2), { fill: th.camera });
        MCP.uidemo.addPathGroup(frame, "Bezel", MCP.uidemo.roundedRect(lidX, lidY, lidW, lidH, [Lc(Rl), Lc(Rl), Lc(Rlb), Lc(Rlb)]), { fill: th.bezel });
        bodyShape = MCP.uidemo.roundedRect(lidX - Lc(lrim), lidY - Lc(lrim), lidW + 2 * Lc(lrim), lidH + 2 * Lc(lrim), [Lc(Rl + lrim), Lc(Rl + lrim), Lc(Rlb + lrim), Lc(Rlb + lrim)]);
        body = MCP.uidemo.addPathGroup(frame, "Body", bodyShape, { fill: mainColor });
        fillName = body.fill || "Fill";
        MCP.uidemo.setExpr(MCP.uidemo.fillColorOf(frame, "Base"), MCP.uidemo.followColor(fillName, 0.04, 0.03), "Contents/Base/Fill/Color", exprs);
        MCP.uidemo.setExpr(MCP.uidemo.fillColorOf(frame, "Groove"), MCP.uidemo.followColor(fillName, 0.13, -0.04), "Contents/Groove/Fill/Color", exprs);
        screenRadii = [Lc(Rsl), Lc(Rsl), 0, 0];
        sizes = { sideBezel: bzs, topBezel: bzt, chin: bzb, lidRadius: Rl, screenRadius: Rsl, baseWidth: MCP.round(baseW * k, 1), baseHeight: MCP.round(baseH * k, 1) };
    }
    // A hairline behind the body: only its outer half shows, keeping the edge crisp on any background.
    MCP.uidemo.addPathGroup(frame, "Edge", bodyShape, { stroke: th.edge, strokeWidth: 2 * hair, strokeOpacity: th.edgeOpacity });

    // Parent, stack and time the parts with the screen.
    MCP.uidemo.attach(frame, screen);
    frame.moveAfter(screen);
    if (urlLayer) { urlLayer.moveAfter(screen); }
    if (notch) { MCP.uidemo.attach(notch, screen); MCP.uidemo.placeAbove(notch, screen); }
    var parts = [frame];
    if (urlLayer) { parts.push(urlLayer); }
    if (notch) { parts.push(notch); }
    for (i = 0; i < parts.length; i++) {
        try { parts[i].inPoint = screen.inPoint; parts[i].outPoint = screen.outPoint; } catch (e0) {}
    }

    // Round the screen's corners so it sits inside the frame.
    var hadMasks = screen.property("ADBE Mask Parade").numProperties > 0;
    var mask = screen.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
    mask.name = "Device Screen";
    var dmask = screen.property("ADBE Mask Parade").property("Device Screen");
    dmask.property("ADBE Mask Shape").setValue(MCP.uidemo.roundedRect(x, y, w, h, screenRadii));
    if (hadMasks) { try { dmask.maskMode = MaskMode.INTERSECT; } catch (e1) {} notes.push("The screen already had masks; the device mask intersects with them."); }

    var shadow = null, shadowRoom = 0;
    if (args.shadow !== false) {
        var dist = MCP.clamp(Math.round(wc * 0.012), 4, 24), size = MCP.clamp(Math.round(wc * 0.035), 12, 80);
        var settings = MCP.extend({ opacity: th.shadowOpacity, angle: 90, distance: Lc(dist), size: Lc(size), spread: 0 }, typeof args.shadow === "object" ? args.shadow : {});
        var res = MCP.styles.addToLayers(comp, [frame], "drop-shadow", settings, { useDefaults: true, allowMenu: true });
        shadow = res.results[0];
        shadowRoom = Math.ceil((Number(settings.distance) + Number(settings.size)) * k) + 4;
        if (shadow.status !== "ok") { notes.push("The frame was built but its shadow failed: " + shadow.error); }
    }

    var component = null;
    if (cspec) {
        var refs = [MCP.uidemo.ref(screen), MCP.uidemo.ref(frame)];
        if (urlLayer) { refs.push(MCP.uidemo.ref(urlLayer)); }
        if (notch) { refs.push(MCP.uidemo.ref(notch)); }
        var props = [{ layer: frame.name, path: ["ADBE Root Vectors Group", "Body", "ADBE Vectors Group", "ADBE Vector Graphic - Fill", "ADBE Vector Fill Color"], label: "Theme Colour" }];
        if (urlLayer) { props.push({ layer: urlLayer.name, path: ["ADBE Text Properties", "ADBE Text Document"], label: "URL" }); }
        var cargs = { comp: { id: comp.id }, layers: refs, name: cname, properties: props, cropToContent: true, padding: shadowRoom };
        if (MCP.isDefined(cspec.templateName)) { cargs.templateName = cspec.templateName; }
        component = MCP.invoke("createComponent", cargs);
    }

    return {
        composition: MCP.serialize.compRef(comp),
        device: device, theme: themeName,
        screen: component ? null : MCP.serialize.layerRef(screen),
        frame: component ? null : MCP.serialize.layer(frame),
        island: notch && !component ? MCP.serialize.layerRef(notch) : null,
        urlLayer: urlLayer && !component ? MCP.serialize.layerRef(urlLayer) : null,
        screenSize: [MCP.round(wc, 1), MCP.round(hc, 1)],
        sizes: sizes, frameColor: MCP.color.toHex(MCP.color.rgba(mainColor)),
        mask: { name: "Device Screen", mode: hadMasks ? "intersect" : "add" },
        expressions: exprs, shadow: shadow, component: component, notes: notes
    };
}, { mutating: true });

/* --------------------------------------------------------- highlight-region */

/** Expression source that defines x0, x1, y0, y1: the padded region in composition pixels. */
MCP.uidemo.regionHeader = function (layer, lr, pad, follow, box) {
    var n = MCP.expr.num;
    if (!follow) {
        return "// Region pinned in composition pixels\n" +
            "var x0 = " + n(box.left - pad) + ", x1 = " + n(box.right + pad) + ";\n" +
            "var y0 = " + n(box.top - pad) + ", y1 = " + n(box.bottom + pad) + ";\n";
    }
    return "// Region of " + MCP.expr.str(layer.name) + " in composition pixels, followed every frame\n" +
        "var L = thisComp.layer(" + MCP.expr.str(layer.name) + ");\n" +
        "var R = [" + n(lr.left) + ", " + n(lr.top) + ", " + n(lr.width) + ", " + n(lr.height) + "];\n" +
        "var P = [L.toComp([R[0], R[1]]), L.toComp([R[0] + R[2], R[1]]), L.toComp([R[0] + R[2], R[1] + R[3]]), L.toComp([R[0], R[1] + R[3]])];\n" +
        "var x0 = Math.min(P[0][0], P[1][0], P[2][0], P[3][0]) - " + n(pad) + ";\n" +
        "var x1 = Math.max(P[0][0], P[1][0], P[2][0], P[3][0]) + " + n(pad) + ";\n" +
        "var y0 = Math.min(P[0][1], P[1][1], P[2][1], P[3][1]) - " + n(pad) + ";\n" +
        "var y1 = Math.max(P[0][1], P[1][1], P[2][1], P[3][1]) + " + n(pad) + ";\n";
};

/** Rounded-rectangle Mask Path expression around x0..y1, in the layer's own space. */
MCP.uidemo.holeExpression = function (header, radius) {
    return header +
        "var r = Math.min(" + MCP.expr.num(radius) + ", (x1 - x0) / 2, (y1 - y0) / 2);\n" +
        "var k = r * 0.5523;\n" +
        "var pts = [[x0, y0 + r], [x0 + r, y0], [x1 - r, y0], [x1, y0 + r], [x1, y1 - r], [x1 - r, y1], [x0 + r, y1], [x0, y1 - r]];\n" +
        "for (var i = 0; i < pts.length; i++) { pts[i] = fromComp(pts[i]); }\n" +
        "createPath(pts, [[0, 0], [-k, 0], [0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k]], [[0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0]], true)";
};

/** Places overlay layers: the first under the topmost cursor (or above `above`, or at the top), each next one above the last. */
MCP.uidemo.overlayPlacer = function (comp, aboveRef) {
    var state = { last: null, anchor: aboveRef || null, cursor: null };
    if (!aboveRef) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (MCP.uidemo.hasTag(comp.layer(i), MCP.uidemo.CURSOR_TAG)) { state.cursor = comp.layer(i); break; }
        }
    }
    return function (layer) {
        if (state.last) { MCP.uidemo.placeAbove(layer, state.last); }
        else if (state.anchor) { MCP.uidemo.placeAbove(layer, state.anchor); }
        else if (state.cursor && state.cursor.index !== layer.index) { layer.moveAfter(state.cursor); }
        else { layer.moveToBeginning(); }
        state.last = layer;
        return layer;
    };
};

MCP.register("highlightRegion", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, target = r.layer;
    var fd = MCP.frameDuration(comp);
    if (!MCP.isDefined(args.time) && !MCP.isDefined(args.frame)) { MCP.fail("highlight-region needs time (seconds) or frame: when the reveal starts.", "invalid-argument"); }
    var notes = [], exprs = [], keys = [], i;
    var t0 = MCP.snapToFrame(comp, MCP.timeArg(comp, args));
    var dur = MCP.animate.span(comp, args, 0.4);
    var easing = MCP.isDefined(args.easing) ? args.easing : MCP.uidemo.EASE_LAND;
    var stagger = Math.max(fd, MCP.snapToFrame(comp, 0.05));
    var tLand = t0 + dur;
    var t2 = MCP.uidemo.timeOf(comp, args, "hideTime", "hideFrame"), t3 = null;
    if (t2 !== null) {
        var hd = MCP.isDefined(args.hideDurationFrames) ? Number(args.hideDurationFrames) * fd : MCP.num(args.hideDuration, 0.3);
        t3 = t2 + Math.max(fd, MCP.snapToFrame(comp, hd));
        if (t2 < t0 + dur + 3 * stagger - 1e-6) { MCP.fail("The hide starts at " + MCP.round(t2) + " s, before the reveal finishes at " + MCP.round(t0 + dur + 3 * stagger) + " s.", "invalid-argument"); }
    }
    var dimOn = args.dim !== false, outlineOn = args.outline !== false;
    var dimSpec = (args.dim && typeof args.dim === "object") ? args.dim : {};
    var olSpec = (args.outline && typeof args.outline === "object") ? args.outline : {};
    var labelSpec = null;
    if (MCP.isDefined(args.label)) { labelSpec = typeof args.label === "string" ? { text: args.label } : args.label; }
    if (!dimOn && !outlineOn && !labelSpec) { MCP.fail("Nothing to draw: dim, outline and label are all off.", "invalid-argument"); }
    var follow = MCP.bool(args.follow, true);
    if (follow) { MCP.animate.requireUniqueName(comp, target, "region"); }
    var pad = MCP.num(args.padding, 8);
    var radius = Math.max(0, MCP.num(args.cornerRadius, 12) + pad);
    var accent = MCP.isDefined(olSpec.color) ? olSpec.color : "#2F6BFF";
    var lr = MCP.uidemo.localRect(target, args.rect, tLand);
    var box = MCP.uidemo.regionBox(target, lr, tLand, null);
    var header = MCP.uidemo.regionHeader(target, lr, pad, follow, box);
    var x0 = box.left - pad, x1 = box.right + pad, y0 = box.top - pad, y1 = box.bottom + pad;
    var side = null, labelPrep = null;
    if (labelSpec) {
        if (!MCP.isDefined(labelSpec.text) || String(labelSpec.text) === "") { MCP.fail("label needs text.", "invalid-argument"); }
        side = String(MCP.arg(labelSpec, "side", "auto"));
        if (side !== "auto" && side !== "top" && side !== "bottom" && side !== "left" && side !== "right") { MCP.fail("label.side must be top, bottom, left, right or auto.", "invalid-argument"); }
    }
    var place = MCP.uidemo.overlayPlacer(comp, MCP.isDefined(args.above) ? MCP.resolveLayer(comp, args.above) : null);
    var base = MCP.isDefined(args.name) ? String(args.name) : "Highlight";
    var endT = t3 !== null ? t3 : comp.duration;
    var trim = function (L) { try { L.inPoint = t0; L.outPoint = Math.max(t0 + fd, endT); } catch (e) {} };
    var hide = function (prop) {
        if (t2 === null) { return null; }
        return MCP.uidemo.move(prop, t2, MCP.animate.valueAt(prop, t2), t3, 0, MCP.uidemo.EASE_EXIT, null);
    };
    var layers = {};

    if (dimOn) {
        var dimColor = MCP.isDefined(dimSpec.color) ? dimSpec.color : "#000000";
        var dim = comp.layers.addSolid(MCP.color.rgb(dimColor), MCP.animate.uniqueLayerName(comp, base + " Dim"), comp.width, comp.height, 1, comp.duration);
        MCP.uidemo.setXY(dim.property("ADBE Transform Group").property("ADBE Position"), [comp.width / 2, comp.height / 2]);
        place(dim);
        trim(dim);
        MCP.uidemo.tag(dim, MCP.uidemo.OVERLAY_TAG);
        dim.property("ADBE Mask Parade").addProperty("ADBE Mask Atom").name = "Hole";
        var mk = dim.property("ADBE Mask Parade").property("Hole");
        mk.maskMode = MaskMode.ADD;
        mk.inverted = true;
        var feather = MCP.num(dimSpec.feather, 16);
        mk.property("ADBE Mask Feather").setValue([feather, feather]);
        mk.property("ADBE Mask Shape").setValue(MCP.uidemo.roundedRect(x0, y0, x1 - x0, y1 - y0, radius));
        MCP.uidemo.setExpr(dim.property("ADBE Mask Parade").property("Hole").property("ADBE Mask Shape"), MCP.uidemo.holeExpression(header, radius), "Masks/Hole/Mask Path", exprs);
        var dimOp = dim.property("ADBE Transform Group").property("ADBE Opacity");
        var dk = MCP.uidemo.move(dimOp, t0, 0, tLand, MCP.num(dimSpec.opacity, 55), easing, null);
        var dh = hide(dimOp);
        keys.push({ layer: dim.name, property: "Transform/Opacity", keys: dh ? dk.concat(dh) : dk });
        layers.dim = MCP.serialize.layerRef(dim);
    }

    if (outlineOn) {
        var ol = MCP.uidemo.newShapeLayer(comp, base + " Outline");
        place(ol);
        trim(ol);
        MCP.uidemo.tag(ol, MCP.uidemo.OVERLAY_TAG);
        ol.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").name = "Outline";
        var olItems = function () { return MCP.childProp(ol.property("ADBE Root Vectors Group"), "Outline").property("ADBE Vectors Group"); };
        olItems().addProperty("ADBE Vector Shape - Rect");
        var strokeIdx = olItems().addProperty("ADBE Vector Graphic - Stroke").propertyIndex;
        olItems().property(strokeIdx).property("ADBE Vector Stroke Color").setValue(MCP.color.rgba(accent));
        olItems().property(strokeIdx).property("ADBE Vector Stroke Width").setValue(MCP.num(olSpec.width, 3));
        olItems().property(strokeIdx).property("ADBE Vector Stroke Opacity").setValue(MCP.num(olSpec.opacity, 100));
        var rect = function () { return MCP.childProp(olItems(), "ADBE Vector Shape - Rect"); };
        rect().property("ADBE Vector Rect Roundness").setValue(radius);
        rect().property("ADBE Vector Rect Size").setValue([0, 0]);
        rect().property("ADBE Vector Rect Position").setValue([(x0 + x1) / 2, (y0 + y1) / 2]);
        // Size is keyed as the extra size around the region; the expression adds the region's own size.
        MCP.uidemo.setExpr(rect().property("ADBE Vector Rect Size"), header + "[x1 - x0 + value[0], y1 - y0 + value[1]]", "Contents/Outline/Rectangle Path 1/Size", exprs);
        MCP.uidemo.setExpr(rect().property("ADBE Vector Rect Position"), header + "fromComp([(x0 + x1) / 2, (y0 + y1) / 2])", "Contents/Outline/Rectangle Path 1/Position", exprs);
        var grow = MCP.num(olSpec.grow, 16);
        var ta = t0 + stagger;
        var sk = MCP.uidemo.move(rect().property("ADBE Vector Rect Size"), ta, [grow, grow], ta + dur, [0, 0], easing, null);
        var olOp = ol.property("ADBE Transform Group").property("ADBE Opacity");
        var ok = MCP.uidemo.move(olOp, ta, 0, ta + dur, 100, easing, null);
        var oh = hide(olOp);
        keys.push({ layer: ol.name, property: "Contents/Outline/Rectangle Path 1/Size", keys: sk });
        keys.push({ layer: ol.name, property: "Transform/Opacity", keys: oh ? ok.concat(oh) : ok });
        layers.outline = MCP.serialize.layerRef(ol);
    }

    if (labelSpec) {
        var fs = MCP.num(labelSpec.fontSize, 28);
        var capH = fs * 0.7;
        var padX = Math.round(fs * 0.6), padY = Math.round(fs * 0.35);
        var distance = MCP.num(labelSpec.distance, 56);
        var pillColor = MCP.isDefined(labelSpec.fillColor) ? labelSpec.fillColor : accent;
        var textColor = MCP.isDefined(labelSpec.textColor) ? labelSpec.textColor : "#FFFFFF";
        var made = MCP.invoke("createTextLayer", { comp: { id: comp.id }, text: String(labelSpec.text), fontSize: fs, fillColor: textColor, justification: "center", position: [comp.width / 2, comp.height / 2], name: MCP.animate.uniqueLayerName(comp, base + " Label"), font: labelSpec.font });
        var text = MCP.resolveLayer(comp, { name: made.layer.name });
        var gr = _mcpTry(function () { return text.sourceRectAtTime(tLand, false); }, null) || { left: -fs, top: -capH, width: fs * 2, height: capH };
        var pw = gr.width + 2 * padX, ph = capH + 2 * padY;
        if (side === "auto") {
            var margin = 24;
            if (y0 - distance - ph >= margin) { side = "top"; }
            else if (y1 + distance + ph <= comp.height - margin) { side = "bottom"; }
            else if (x1 + distance + pw <= comp.width - margin) { side = "right"; }
            else { side = "left"; }
        }
        var sideCode = "var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, d = " + MCP.expr.num(distance) + ", pw = " + MCP.expr.num(pw) + ", ph = " + MCP.expr.num(ph) + ";\n";
        var labelPoint = { top: "[cx, y0 - d - ph / 2]", bottom: "[cx, y1 + d + ph / 2]", left: "[x0 - d - pw / 2, cy]", right: "[x1 + d + pw / 2, cy]" }[side];
        var lineEnds = { top: "[[cx, y0], [cx, y0 - d]]", bottom: "[[cx, y1], [cx, y1 + d]]", left: "[[x0, cy], [x0 - d, cy]]", right: "[[x1, cy], [x1 + d, cy]]" }[side];
        labelPrep = { side: side, size: [MCP.round(pw, 1), MCP.round(ph, 1)] };

        if (labelSpec.line !== false) {
            var ln = MCP.uidemo.newShapeLayer(comp, base + " Line");
            place(ln);
            trim(ln);
            MCP.uidemo.tag(ln, MCP.uidemo.OVERLAY_TAG);
            ln.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").name = "Line";
            var lnItems = function () { return MCP.childProp(ln.property("ADBE Root Vectors Group"), "Line").property("ADBE Vectors Group"); };
            lnItems().addProperty("ADBE Vector Shape - Group");
            var lsIdx = lnItems().addProperty("ADBE Vector Graphic - Stroke").propertyIndex;
            lnItems().property(lsIdx).property("ADBE Vector Stroke Color").setValue(MCP.color.rgba(MCP.isDefined(labelSpec.lineColor) ? labelSpec.lineColor : accent));
            lnItems().property(lsIdx).property("ADBE Vector Stroke Width").setValue(MCP.num(labelSpec.lineWidth, 2));
            try { lnItems().property(lsIdx).property("ADBE Vector Stroke Line Cap").setValue(2); } catch (e2) {}
            lnItems().addProperty("ADBE Vector Filter - Trim");
            var lpath = MCP.childProp(lnItems(), "ADBE Vector Shape - Group").property("ADBE Vector Shape");
            MCP.uidemo.setExpr(lpath, header + sideCode + "var e = " + lineEnds + ";\ncreatePath([fromComp(e[0]), fromComp(e[1])], [], [], false)", "Contents/Line/Path 1/Path", exprs);
            var trimEnd = MCP.childProp(lnItems(), "ADBE Vector Filter - Trim").property("ADBE Vector Trim End");
            var tl0 = t0 + 2 * stagger, tl1 = tl0 + Math.max(4 * fd, MCP.snapToFrame(comp, dur * 0.6));
            var lk = MCP.uidemo.move(trimEnd, tl0, 0, tl1, 100, easing, null);
            var lh = hide(ln.property("ADBE Transform Group").property("ADBE Opacity"));
            keys.push({ layer: ln.name, property: "Contents/Line/Trim Paths 1/End", keys: lk });
            if (lh) { keys.push({ layer: ln.name, property: "Transform/Opacity", keys: lh }); }
            layers.line = MCP.serialize.layerRef(ln);
        }

        place(text);
        trim(text);
        MCP.uidemo.tag(text, MCP.uidemo.OVERLAY_TAG);
        var boxArgs = { comp: { id: comp.id }, layer: MCP.uidemo.ref(text), padding: [padX, padY], cornerRadius: "pill", fillColor: pillColor, heightFrom: "font", link: "parent", linkOpacity: true, name: text.name + " Pill" };
        if (labelSpec.shadow) { boxArgs.shadow = labelSpec.shadow; }
        var boxRes = MCP.invoke("addTextBox", boxArgs);
        // Anchor on the pill centre: the label scales about its middle and its Position is the pill centre.
        var ttg = text.property("ADBE Transform Group");
        MCP.uidemo.setXY(ttg.property("ADBE Anchor Point"), [gr.left + gr.width / 2, -capH / 2]);
        MCP.uidemo.setExpr(ttg.property("ADBE Position"), header + sideCode + labelPoint, "Transform/Position", exprs);
        var tb = t0 + 3 * stagger;
        var restScale = ttg.property("ADBE Scale").value;
        var zScale = MCP.isArray(restScale) && restScale.length > 2 ? [Number(restScale[2])] : [];
        var lsk = MCP.uidemo.move(ttg.property("ADBE Scale"), tb, [92, 92].concat(zScale), tb + dur, [100, 100].concat(zScale), easing, null);
        var lok = MCP.uidemo.move(ttg.property("ADBE Opacity"), tb, 0, tb + dur, 100, easing, null);
        var loh = hide(text.property("ADBE Transform Group").property("ADBE Opacity"));
        keys.push({ layer: text.name, property: "Transform/Scale", keys: lsk });
        keys.push({ layer: text.name, property: "Transform/Opacity", keys: loh ? lok.concat(loh) : lok });
        layers.label = MCP.serialize.layerRef(text);
        layers.labelPill = boxRes && boxRes.layer ? { index: boxRes.layer.index, id: boxRes.layer.id, name: boxRes.layer.name } : null;
        if (boxRes && boxRes.expressionErrors && boxRes.expressionErrors.length) { notes.push("The label pill reported expression errors: " + JSON.stringify(boxRes.expressionErrors)); }
    }

    var errs = 0;
    for (i = 0; i < exprs.length; i++) { if (exprs[i].error) { errs++; } }
    if (errs) { notes.push(errs + " expression(s) reported an error; see expressions."); }
    return {
        composition: MCP.serialize.compRef(comp),
        region: { layer: MCP.serialize.layerRef(target), rect: MCP.uidemo.rectOut(lr), box: MCP.uidemo.boxOut({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }), padding: pad, cornerRadius: radius },
        follow: follow, label: labelPrep, layers: layers,
        revealTime: MCP.round(t0), revealFrame: MCP.frameOf(comp, t0), settledTime: MCP.round(t0 + dur + (labelSpec ? 3 : 1) * stagger),
        hideTime: t2 !== null ? MCP.round(t2) : null, hideEndTime: t3 !== null ? MCP.round(t3) : null,
        keys: keys, expressions: exprs, notes: notes
    };
}, { mutating: true });

/* ---------------------------------------------------------------- add-toast */

MCP.register("addToast", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var fd = MCP.frameDuration(comp);
    if (!MCP.isDefined(args.time) && !MCP.isDefined(args.frame)) { MCP.fail("add-toast needs time (seconds) or frame: when it starts to slide in.", "invalid-argument"); }
    var title = String(MCP.requireArg(args, "title"));
    var notes = [], keys = [], i;
    var themeName = String(MCP.arg(args, "theme", "light"));
    if (themeName !== "light" && themeName !== "dark") { MCP.fail("theme must be light or dark.", "invalid-argument"); }
    var dark = themeName === "dark";
    var corner = String(MCP.arg(args, "position", "top-right"));
    var valid = { "top-right": 1, "top": 1, "top-left": 1, "bottom-right": 1, "bottom": 1, "bottom-left": 1 };
    if (!valid[corner]) { MCP.fail("position must be top-right, top, top-left, bottom-right, bottom or bottom-left.", "invalid-argument"); }
    var t0 = MCP.snapToFrame(comp, MCP.timeArg(comp, args));
    var t1 = t0 + MCP.animate.span(comp, args, 0.5);
    var exitOn = args.exit !== false;
    var t2 = t1 + MCP.snapToFrame(comp, Math.max(0, MCP.num(args.hold, 2.5)));
    var t3 = t2 + Math.max(fd, MCP.snapToFrame(comp, MCP.num(args.exitDuration, 0.35)));
    var easing = MCP.isDefined(args.easing) ? args.easing : MCP.uidemo.EASE_LAND;
    var cardW = MCP.num(args.width, 420), margin = MCP.num(args.margin, 32);
    var padIn = Math.round(MCP.num(args.padding, 20));
    var titleSize = MCP.num(args.titleSize, 22), bodySize = MCP.num(args.bodySize, 18);
    var accent = MCP.isDefined(args.accentColor) ? args.accentColor : "#2F6BFF";
    var dotD = Math.round(titleSize * 0.5);
    var textX = padIn + dotD + Math.round(dotD * 1.2);
    var base = MCP.isDefined(args.name) ? String(args.name) : "Toast";

    var card = MCP.uidemo.newShapeLayer(comp, base);
    MCP.uidemo.tag(card, MCP.uidemo.OVERLAY_TAG);
    var titleMade = MCP.invoke("createTextLayer", { comp: { id: comp.id }, text: title, fontSize: titleSize, fillColor: dark ? "#F5F6F7" : "#111111", justification: "left", name: MCP.animate.uniqueLayerName(comp, base + " Title"), font: MCP.isDefined(args.titleFont) ? args.titleFont : args.font });
    var titleL = MCP.resolveLayer(comp, { name: titleMade.layer.name });
    var bodyL = null;
    if (MCP.isDefined(args.body) && String(args.body) !== "") {
        var bw = cardW - textX - padIn;
        var bodyMade = MCP.invoke("createTextLayer", { comp: { id: comp.id }, text: String(args.body), fontSize: bodySize, fillColor: dark ? "#A1A5AD" : "#5F636B", justification: "left", boxSize: [bw, Math.round(bodySize * 1.35 * 6)], name: MCP.animate.uniqueLayerName(comp, base + " Body"), font: args.font });
        bodyL = MCP.resolveLayer(comp, { name: bodyMade.layer.name });
    }
    // Lay the text out in card space (origin at the card's top-left), then size the card to it.
    MCP.uidemo.attach(titleL, card);
    var tr = _mcpTry(function () { return titleL.sourceRectAtTime(t1, false); }, null) || { left: 0, top: -titleSize * 0.75, width: 100, height: titleSize };
    var titleBase = padIn - tr.top;
    MCP.uidemo.setXY(titleL.property("ADBE Transform Group").property("ADBE Position"), [textX - tr.left, titleBase]);
    var bottom = titleBase + tr.top + tr.height;
    if (bodyL) {
        MCP.uidemo.attach(bodyL, card);
        var br = _mcpTry(function () { return bodyL.sourceRectAtTime(t1, false); }, null) || { left: 0, top: 0, width: 100, height: bodySize };
        var bodyY = bottom + Math.round(bodySize * 0.4) - br.top;
        MCP.uidemo.setXY(bodyL.property("ADBE Transform Group").property("ADBE Position"), [textX - br.left, bodyY]);
        bottom = bodyY + br.top + br.height;
    }
    var cardH = Math.ceil(bottom + padIn);
    var radius = MCP.num(args.cornerRadius, 14);
    MCP.uidemo.addPathGroup(card, "Dot", MCP.uidemo.circle(padIn + dotD / 2, titleBase + tr.top + tr.height / 2, dotD / 2), { fill: accent });
    MCP.uidemo.addPathGroup(card, "Card", MCP.uidemo.roundedRect(0, 0, cardW, cardH, radius), { fill: dark ? "#1F2023" : "#FFFFFF" });
    MCP.uidemo.addPathGroup(card, "Edge", MCP.uidemo.roundedRect(0, 0, cardW, cardH, radius), { stroke: dark ? "#FFFFFF" : "#000000", strokeWidth: 2, strokeOpacity: dark ? 8 : 6 });
    var tg = card.property("ADBE Transform Group");
    MCP.uidemo.setXY(tg.property("ADBE Anchor Point"), [cardW / 2, cardH / 2]);

    // Rest position from the corner and margin; the slide comes in from the nearest edge.
    var W = comp.width, H = comp.height;
    var rx = corner.indexOf("right") >= 0 ? W - margin - cardW / 2 : (corner.indexOf("left") >= 0 ? margin + cardW / 2 : W / 2);
    var ry = corner.indexOf("top") === 0 ? margin + cardH / 2 : H - margin - cardH / 2;
    var from;
    if (corner === "top" || corner === "bottom") { from = [rx, corner === "top" ? -cardH / 2 - 40 : H + cardH / 2 + 40]; }
    else if (corner.indexOf("right") >= 0) { from = [W + cardW / 2 + 40, ry]; }
    else { from = [-cardW / 2 - 40, ry]; }
    var rest = [rx, ry];
    var pos = tg.property("ADBE Position");
    var pk = MCP.uidemo.move(pos, t0, from, t1, rest, easing, "linear");
    if (exitOn) { pk = pk.concat(MCP.uidemo.move(pos, t2, rest, t3, from, MCP.uidemo.EASE_EXIT, "linear")); }
    keys.push({ layer: card.name, property: "Transform/Position", keys: pk });

    // Stack: the card at the top (under a cursor), its texts directly above it.
    var place = MCP.uidemo.overlayPlacer(comp, null);
    place(card);
    if (bodyL) { place(bodyL); }
    place(titleL);
    var parts = [card, titleL];
    if (bodyL) { parts.push(bodyL); }
    for (i = 0; i < parts.length; i++) {
        try { parts[i].inPoint = t0; parts[i].outPoint = exitOn ? t3 : comp.duration; } catch (e0) {}
    }
    var shadow = null;
    if (args.shadow !== false) {
        var settings = MCP.extend({ opacity: dark ? 35 : 14, angle: 90, distance: 8, size: 28, spread: 0 }, typeof args.shadow === "object" ? args.shadow : {});
        var res = MCP.styles.addToLayers(comp, [card], "drop-shadow", settings, { useDefaults: true, allowMenu: true });
        shadow = res.results[0];
        if (shadow.status !== "ok") { notes.push("The toast was built but its shadow failed: " + shadow.error); }
    }
    return {
        composition: MCP.serialize.compRef(comp),
        card: MCP.serialize.layer(card), title: MCP.serialize.layerRef(titleL), body: bodyL ? MCP.serialize.layerRef(bodyL) : null,
        size: [cardW, cardH], position: corner, rest: MCP.uidemo.round2(rest), from: MCP.uidemo.round2(from),
        startTime: MCP.round(t0), landTime: MCP.round(t1), exitTime: exitOn ? MCP.round(t2) : null, endTime: exitOn ? MCP.round(t3) : null,
        startFrame: MCP.frameOf(comp, t0), landFrame: MCP.frameOf(comp, t1),
        easing: MCP.isDefined(args.easing) ? args.easing : MCP.uidemo.LAND_TEXT,
        keys: keys, shadow: shadow, notes: notes
    };
}, { mutating: true });
