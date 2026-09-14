/*
 * Shape layer commands: layers, groups, fills, strokes, paths, modifiers,
 * trim paths, repeaters, and the Contents tree.
 */

MCP.shape = {};

MCP.shape.pathFromPoints = function (points, closed, inTangents, outTangents) {
    var s = new Shape();
    var verts = [];
    for (var i = 0; i < points.length; i++) { verts.push([Number(points[i][0]), Number(points[i][1])]); }
    s.vertices = verts;
    if (MCP.isArray(inTangents) && inTangents.length === verts.length) { s.inTangents = inTangents; }
    if (MCP.isArray(outTangents) && outTangents.length === verts.length) { s.outTangents = outTangents; }
    s.closed = MCP.isDefined(closed) ? !!closed : true;
    return s;
};

/** Adds a group with one path, an optional fill and an optional stroke to a vector group container. */
MCP.shape.addShapeGroup = function (container, args, comp) {
    var group = container.addProperty("ADBE Vector Group");
    if (MCP.isDefined(args.groupName)) { group.name = String(args.groupName); }
    var vg = group.property("ADBE Vectors Group");
    var type = MCP.arg(args, "shapeType", "rectangle");
    var size = MCP.isArray(args.size) ? [Number(args.size[0]), Number(args.size[1])] : [200, 200];
    var pathProp = null;
    var pathInfo = { type: type };
    if (type === "rectangle" || type === "rounded-rectangle") {
        pathProp = vg.addProperty("ADBE Vector Shape - Rect");
        pathProp.property("ADBE Vector Rect Size").setValue(size);
        var roundness = MCP.num(args.roundness, type === "rounded-rectangle" ? 20 : 0);
        if (MCP.isArray(args.cornerRadii)) {
            // Per-corner radii need a path; rectangle roundness is uniform.
            roundness = Math.max.apply(null, args.cornerRadii);
        }
        pathProp.property("ADBE Vector Rect Roundness").setValue(roundness);
        pathInfo.size = size; pathInfo.roundness = roundness;
    } else if (type === "ellipse" || type === "circle") {
        pathProp = vg.addProperty("ADBE Vector Shape - Ellipse");
        if (type === "circle") { size = [size[0], size[0]]; }
        pathProp.property("ADBE Vector Ellipse Size").setValue(size);
        pathInfo.size = size;
    } else if (type === "polygon" || type === "star") {
        pathProp = vg.addProperty("ADBE Vector Shape - Star");
        pathProp.property("ADBE Vector Star Type").setValue(type === "polygon" ? 1 : 2);
        pathProp.property("ADBE Vector Star Points").setValue(Math.max(3, Math.round(MCP.num(args.points, 5))));
        pathProp.property("ADBE Vector Star Outer Radius").setValue(MCP.num(args.outerRadius, size[0] / 2));
        if (type === "star") { pathProp.property("ADBE Vector Star Inner Radius").setValue(MCP.num(args.innerRadius, size[0] / 4)); }
        if (MCP.isDefined(args.outerRoundness)) { pathProp.property("ADBE Vector Star Outer Roundess").setValue(Number(args.outerRoundness)); }
        pathInfo.points = MCP.num(args.points, 5);
    } else if (type === "line") {
        pathProp = vg.addProperty("ADBE Vector Shape - Group");
        var from = MCP.isArray(args.from) ? args.from : [-size[0] / 2, 0];
        var to = MCP.isArray(args.to) ? args.to : [size[0] / 2, 0];
        pathProp.property("ADBE Vector Shape").setValue(MCP.shape.pathFromPoints([from, to], false));
        if (!MCP.isDefined(args.strokeWidth)) { args.strokeWidth = 4; }
        if (!MCP.isDefined(args.fillColor)) { args.noFill = true; }
        pathInfo.from = from; pathInfo.to = to;
    } else if (type === "arrow") {
        pathProp = vg.addProperty("ADBE Vector Shape - Group");
        var L = size[0], H = MCP.num(args.headSize, Math.max(12, size[1] / 2)), T = MCP.num(args.shaftWidth, Math.max(4, size[1] / 5));
        var pts = [[-L / 2, -T / 2], [L / 2 - H, -T / 2], [L / 2 - H, -H / 2], [L / 2, 0], [L / 2 - H, H / 2], [L / 2 - H, T / 2], [-L / 2, T / 2]];
        pathProp.property("ADBE Vector Shape").setValue(MCP.shape.pathFromPoints(pts, true));
        pathInfo.length = L; pathInfo.headSize = H;
    } else if (type === "path" || type === "custom") {
        if (!MCP.isArray(args.points) || args.points.length < 2) { MCP.fail("shapeType 'path' needs a points array of [x,y] pairs.", "invalid-argument"); }
        pathProp = vg.addProperty("ADBE Vector Shape - Group");
        pathProp.property("ADBE Vector Shape").setValue(MCP.shape.pathFromPoints(args.points, MCP.bool(args.closed, true), args.inTangents, args.outTangents));
        pathInfo.pointCount = args.points.length;
    } else {
        MCP.fail("Unknown shapeType '" + type + "'. Use rectangle, rounded-rectangle, ellipse, circle, polygon, star, line, arrow or path.", "invalid-argument");
    }
    if (MCP.isDefined(args.pathPosition) && pathProp && pathProp.property("ADBE Vector Rect Position")) {
        pathProp.property("ADBE Vector Rect Position").setValue(args.pathPosition);
    }

    // Stroke first, then fill? After Effects renders later items on top within a group,
    // and the usual look is stroke over fill, so add the fill first then the stroke.
    var fill = null, stroke = null;
    if (!MCP.bool(args.noFill, false)) {
        fill = vg.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue(MCP.color.rgba(args.fillColor, [1, 1, 1, 1]));
        fill.property("ADBE Vector Fill Opacity").setValue(MCP.num(args.fillOpacity, 100));
    }
    var strokeWidth = MCP.num(args.strokeWidth, 0);
    if (strokeWidth > 0 || MCP.isDefined(args.strokeColor)) {
        stroke = vg.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue(MCP.color.rgba(args.strokeColor, [0, 0, 0, 1]));
        stroke.property("ADBE Vector Stroke Width").setValue(strokeWidth > 0 ? strokeWidth : 2);
        stroke.property("ADBE Vector Stroke Opacity").setValue(MCP.num(args.strokeOpacity, 100));
        if (MCP.isDefined(args.lineCap)) { try { stroke.property("ADBE Vector Stroke Line Cap").setValue({ butt: 1, round: 2, square: 3 }[String(args.lineCap)] || 1); } catch (e1) {} }
        if (MCP.isDefined(args.lineJoin)) { try { stroke.property("ADBE Vector Stroke Line Join").setValue({ miter: 1, round: 2, bevel: 3 }[String(args.lineJoin)] || 1); } catch (e2) {} }
        if (MCP.isArray(args.dashes) && args.dashes.length) {
            try {
                var dashGroup = stroke.property("ADBE Vector Stroke Dashes");
                dashGroup.addProperty("ADBE Vector Stroke Dash 1").setValue(Number(args.dashes[0]));
                if (args.dashes.length > 1) { dashGroup.addProperty("ADBE Vector Stroke Gap 1").setValue(Number(args.dashes[1])); }
            } catch (e3) {}
        }
    }
    var paths = MCP.pathOf(group);
    return { group: group, path: pathProp, fill: fill, stroke: stroke, info: pathInfo, groupPath: paths.path };
};

MCP.register("createShapeLayer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layer = comp.layers.addShape();
    layer.name = MCP.arg(args, "name", "Shape Layer");
    var contents = layer.property("ADBE Root Vectors Group");
    var built = MCP.shape.addShapeGroup(contents, args, comp);
    var tg = layer.property("ADBE Transform Group");
    tg.property("ADBE Anchor Point").setValue([0, 0]);
    tg.property("ADBE Position").setValue(MCP.isArray(args.position) ? args.position : [comp.width / 2, comp.height / 2]);
    var placeArgs = MCP.extend({}, args);
    delete placeArgs.position;
    MCP.placeNewLayer(comp, layer, placeArgs);
    var out = MCP.serialize.layer(layer);
    out.shape = built.info;
    out.groupPath = built.groupPath;
    out.pathPropertyPath = built.path ? MCP.pathOf(built.path).path : null;
    out.fillPath = built.fill ? MCP.pathOf(built.fill).path : null;
    out.strokePath = built.stroke ? MCP.pathOf(built.stroke).path : null;
    return { composition: MCP.serialize.compRef(comp), layer: out };
}, { mutating: true });

/* ---------------------------------------------------------------- helpers */

MCP.shape.KINDS = {
    "ADBE Vector Group": "group",
    "ADBE Vector Shape - Group": "path",
    "ADBE Vector Shape - Rect": "rect",
    "ADBE Vector Shape - Ellipse": "ellipse",
    "ADBE Vector Shape - Star": "star",
    "ADBE Vector Graphic - Fill": "fill",
    "ADBE Vector Graphic - G-Fill": "gradient-fill",
    "ADBE Vector Graphic - Stroke": "stroke",
    "ADBE Vector Graphic - G-Stroke": "gradient-stroke",
    "ADBE Vector Transform Group": "transform",
    "ADBE Vector Filter - Trim": "modifier",
    "ADBE Vector Filter - Offset": "modifier",
    "ADBE Vector Filter - RC": "modifier",
    "ADBE Vector Filter - PB": "modifier",
    "ADBE Vector Filter - Roughen": "modifier",
    "ADBE Vector Filter - Wiggler": "modifier",
    "ADBE Vector Filter - Twist": "modifier",
    "ADBE Vector Filter - Zigzag": "modifier",
    "ADBE Vector Filter - Repeater": "modifier",
    "ADBE Vector Filter - Merge": "modifier"
};

MCP.shape.MODIFIERS = {
    "trim-paths": "ADBE Vector Filter - Trim",
    "offset-paths": "ADBE Vector Filter - Offset",
    "round-corners": "ADBE Vector Filter - RC",
    "pucker-bloat": "ADBE Vector Filter - PB",
    "wiggle-paths": "ADBE Vector Filter - Roughen",
    "wiggle-transform": "ADBE Vector Filter - Wiggler",
    "twist": "ADBE Vector Filter - Twist",
    "zig-zag": "ADBE Vector Filter - Zigzag",
    "repeater": "ADBE Vector Filter - Repeater",
    "merge-paths": "ADBE Vector Filter - Merge"
};

MCP.shape.kindOf = function (prop) {
    var mn = String(_mcpTry(function () { return prop.matchName; }, ""));
    if (MCP.shape.KINDS[mn]) { return MCP.shape.KINDS[mn]; }
    if (mn.indexOf("ADBE Vector Filter") === 0) { return "modifier"; }
    return "other";
};

MCP.shape.contents = function (layer) {
    if (!(layer instanceof ShapeLayer)) { MCP.fail("Layer '" + layer.name + "' is not a shape layer. Shape tools need a layer made by create-shape-layer or convert-text-to-shapes.", "invalid-argument"); }
    var c = _mcpTry(function () { return layer.property("ADBE Root Vectors Group"); }, null);
    if (!c) { MCP.fail("Layer '" + layer.name + "' has no Contents group.", "unsupported"); }
    return c;
};

MCP.shape.groupNames = function (contents) {
    var out = [];
    for (var i = 1; i <= contents.numProperties; i++) {
        var p = contents.property(i);
        if (p.matchName === "ADBE Vector Group") { out.push(i + ": '" + p.name + "'"); }
    }
    return out;
};

/** Resolves a group under Contents by name, matchName or 1-based index. Undefined picks the first group. */
MCP.shape.resolveGroup = function (layer, ref) {
    var contents = MCP.shape.contents(layer);
    var g = null, i;
    if (!MCP.isDefined(ref)) {
        for (i = 1; i <= contents.numProperties && !g; i++) {
            if (contents.property(i).matchName === "ADBE Vector Group") { g = contents.property(i); }
        }
        if (!g) { MCP.fail("Shape layer '" + layer.name + "' has no groups. Add one with add-shape-to-layer.", "not-found"); }
        return g;
    }
    if (typeof ref === "number") {
        g = _mcpTry(function () { return contents.property(Number(ref)); }, null);
        if (!g) { MCP.fail("Contents item " + ref + " does not exist on '" + layer.name + "' (1 to " + contents.numProperties + "). Groups: " + MCP.shape.groupNames(contents).join(", "), "not-found"); }
    } else if (typeof ref === "object" && ref !== null) {
        g = MCP.isDefined(ref.index) ? _mcpTry(function () { return contents.property(Number(ref.index)); }, null) : MCP.childProp(contents, String(ref.name));
    } else {
        g = MCP.childProp(contents, String(ref));
    }
    if (!g) { MCP.fail("Group '" + ref + "' not found under Contents of '" + layer.name + "'. Groups: " + (MCP.shape.groupNames(contents).join(", ") || "(none)"), "not-found", { groups: MCP.shape.groupNames(contents) }); }
    if (g.matchName !== "ADBE Vector Group") { MCP.fail("Contents item '" + g.name + "' is a " + MCP.shape.kindOf(g) + ", not a group. Groups: " + (MCP.shape.groupNames(contents).join(", ") || "(none)"), "invalid-argument"); }
    return g;
};

/** The container that holds a group's items. */
MCP.shape.itemsOf = function (group) {
    var vg = _mcpTry(function () { return group.property("ADBE Vectors Group"); }, null);
    return vg || group;
};

/** First child of a group with one of the given matchNames. */
MCP.shape.findItem = function (group, matchNames) {
    var items = MCP.shape.itemsOf(group);
    var list = MCP.isArray(matchNames) ? matchNames : [matchNames];
    for (var i = 1; i <= items.numProperties; i++) {
        var p = items.property(i);
        for (var k = 0; k < list.length; k++) { if (p.matchName === list[k]) { return p; } }
    }
    return null;
};

/** Applies {displayName: value} settings under a property group. Returns {applied, notes}. */
MCP.shape.applySettings = function (target, settings) {
    var applied = [], notes = [];
    if (!settings) { return { applied: applied, notes: notes }; }
    for (var k in settings) {
        if (!Object.prototype.hasOwnProperty.call(settings, k)) { continue; }
        var p = MCP.childProp(target, k) || MCP.findProp(target, k);
        if (!p) { notes.push("Property '" + k + "' not found on " + target.name + ". Children: " + MCP.childNames(target).join(", ")); continue; }
        if (MCP.isGroup(p)) { notes.push("'" + k + "' on " + target.name + " is a group, not a value."); continue; }
        try {
            var val = MCP.coerceValue(p, settings[k]);
            var vt = _mcpTry(function () { return MCP.serialize.valueTypeName(p); }, "");
            if (vt === "color") { val = MCP.color.rgba(val); }
            if (typeof val === "boolean") { val = val ? 1 : 0; }
            p.setValue(val);
            applied.push(k);
        } catch (e) {
            notes.push("Could not set '" + k + "' on " + target.name + ": " + e.toString());
        }
    }
    return { applied: applied, notes: notes };
};

MCP.shape.setIf = function (root, matchName, displayName, value, changed, notes, label) {
    if (!MCP.isDefined(value)) { return null; }
    var p = MCP.childProp(root, matchName) || (displayName ? MCP.findProp(root, displayName) : null);
    if (!p) { notes.push("Property '" + (displayName || matchName) + "' not found; skipped."); return null; }
    try { p.setValue(value); changed.push(label || displayName || matchName); return p; }
    catch (e) { notes.push("Could not set '" + (displayName || matchName) + "': " + e.toString()); return null; }
};

MCP.shape.nodeSummary = function (prop) {
    var paths = MCP.pathOf(prop);
    return { name: prop.name, matchName: prop.matchName, kind: MCP.shape.kindOf(prop), index: prop.propertyIndex, path: paths.path, enabled: _mcpTry(function () { return prop.enabled; }, true) };
};

MCP.shape.serializeNode = function (prop, depth) {
    var out = MCP.shape.nodeSummary(prop);
    var kind = out.kind;
    if (kind === "group" && depth > 0) {
        var items = MCP.shape.itemsOf(prop);
        out.children = [];
        for (var i = 1; i <= items.numProperties; i++) { out.children.push(MCP.shape.serializeNode(items.property(i), depth - 1)); }
    } else if (kind === "path") {
        var sp = MCP.childProp(prop, "ADBE Vector Shape");
        out.pathPropertyPath = sp ? MCP.pathOf(sp).path : null;
        out.vertexCount = sp ? _mcpTry(function () { return sp.value.vertices.length; }, null) : null;
        out.closed = sp ? _mcpTry(function () { return sp.value.closed; }, null) : null;
        out.numKeys = sp ? _mcpTry(function () { return sp.numKeys; }, 0) : 0;
    } else if (kind === "rect" || kind === "ellipse") {
        var sizeProp = MCP.childProp(prop, kind === "rect" ? "ADBE Vector Rect Size" : "ADBE Vector Ellipse Size");
        out.size = sizeProp ? MCP.roundValue(_mcpTry(function () { return sizeProp.value; }, null)) : null;
    } else if (kind === "fill" || kind === "stroke") {
        var cp = MCP.childProp(prop, kind === "fill" ? "ADBE Vector Fill Color" : "ADBE Vector Stroke Color");
        out.color = cp ? _mcpTry(function () { return MCP.color.toHex(cp.value); }, null) : null;
        if (kind === "stroke") {
            var wp = MCP.childProp(prop, "ADBE Vector Stroke Width");
            out.width = wp ? _mcpTry(function () { return MCP.round(wp.value); }, null) : null;
        }
    } else if (kind === "modifier" && depth > 0) {
        out.properties = [];
        for (var j = 1; j <= prop.numProperties; j++) {
            var c = prop.property(j);
            out.properties.push({ name: c.name, matchName: c.matchName, path: MCP.pathOf(c).path, value: MCP.isGroup(c) ? null : MCP.serialize.value(c), isGroup: MCP.isGroup(c) });
        }
    }
    return out;
};

MCP.shape.modifierSummary = function (mod) {
    var out = MCP.shape.nodeSummary(mod);
    out.properties = [];
    for (var j = 1; j <= mod.numProperties; j++) {
        var c = mod.property(j);
        out.properties.push({ name: c.name, matchName: c.matchName, path: MCP.pathOf(c).path, value: MCP.isGroup(c) ? null : MCP.serialize.value(c), numKeys: _mcpTry(function () { return c.numKeys; }, 0), isGroup: MCP.isGroup(c) });
    }
    return out;
};

/** Returns the container for a modifier: the group's items or the layer root. */
MCP.shape.modifierContainer = function (layer, args) {
    if (MCP.isDefined(args.group) && !MCP.bool(args.root, false)) {
        return { container: MCP.shape.itemsOf(MCP.shape.resolveGroup(layer, args.group)), scope: "group" };
    }
    return { container: MCP.shape.contents(layer), scope: "root" };
};

/** Converts a parametric path item (rect, ellipse, star) or a bezier path to a Shape at time t. */
MCP.shape.toShape = function (item, t, notes) {
    var kind = MCP.shape.kindOf(item);
    function val(mn, fallback) {
        var p = MCP.childProp(item, mn);
        if (!p) { return fallback; }
        return _mcpTry(function () { return p.valueAtTime(t, false); }, fallback);
    }
    if (kind === "path") {
        var sp = MCP.childProp(item, "ADBE Vector Shape");
        if (!sp) { MCP.fail("Path item '" + item.name + "' has no Path property.", "script-error"); }
        return sp.valueAtTime(t, false);
    }
    if (kind === "rect") {
        var rs = val("ADBE Vector Rect Size", [100, 100]), rp = val("ADBE Vector Rect Position", [0, 0]);
        if (Number(val("ADBE Vector Rect Roundness", 0)) > 0 && notes) { notes.push("Rectangle roundness was ignored; the mask has square corners."); }
        return MCP.masks.rectShape(rp[0] - rs[0] / 2, rp[1] - rs[1] / 2, rs[0], rs[1]);
    }
    if (kind === "ellipse") {
        var es = val("ADBE Vector Ellipse Size", [100, 100]), ep = val("ADBE Vector Ellipse Position", [0, 0]);
        return MCP.masks.ellipseShape(ep[0], ep[1], es[0] / 2, es[1] / 2);
    }
    if (kind === "star") {
        var n = Math.max(3, Math.round(Number(val("ADBE Vector Star Points", 5))));
        var type = Number(val("ADBE Vector Star Type", 2));
        var R = Number(val("ADBE Vector Star Outer Radius", 50)), r = Number(val("ADBE Vector Star Inner Radius", 25));
        var pos = val("ADBE Vector Star Position", [0, 0]);
        var rot = Number(val("ADBE Vector Star Rotation", 0)) * Math.PI / 180;
        var pts = [];
        var count = type === 1 ? n : n * 2;
        for (var i = 0; i < count; i++) {
            var rad = (type === 1 || i % 2 === 0) ? R : r;
            var a = -Math.PI / 2 + rot + (i * 2 * Math.PI) / count;
            pts.push([pos[0] + Math.cos(a) * rad, pos[1] + Math.sin(a) * rad]);
        }
        return MCP.shape.pathFromPoints(pts, true);
    }
    MCP.fail("Item '" + item.name + "' (" + item.matchName + ") is not a path.", "invalid-argument");
    return null;
};

/* --------------------------------------------------------------- commands */

MCP.register("addShapeToLayer", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var contents = MCP.shape.contents(r.layer);
    var built = MCP.shape.addShapeGroup(contents, MCP.extend({}, args), r.comp);
    if (MCP.isArray(args.offset)) {
        var tg = MCP.childProp(built.group, "ADBE Vector Transform Group");
        var pp = tg ? MCP.childProp(tg, "ADBE Vector Position") : null;
        if (pp) { pp.setValue([Number(args.offset[0]), Number(args.offset[1])]); }
    }
    var groups = 0;
    for (var i = 1; i <= contents.numProperties; i++) { if (contents.property(i).matchName === "ADBE Vector Group") { groups++; } }
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        group: MCP.shape.nodeSummary(built.group),
        groupPath: built.groupPath,
        pathPropertyPath: built.path ? MCP.pathOf(built.path).path : null,
        fillPath: built.fill ? MCP.pathOf(built.fill).path : null,
        strokePath: built.stroke ? MCP.pathOf(built.stroke).path : null,
        shape: built.info,
        offset: MCP.isArray(args.offset) ? args.offset : [0, 0],
        groupCount: groups
    };
}, { mutating: true });

MCP.register("setShapeFill", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var group = MCP.shape.resolveGroup(r.layer, args.group);
    var items = MCP.shape.itemsOf(group);
    var changed = [], warnings = [];
    var solid = MCP.shape.findItem(group, "ADBE Vector Graphic - Fill");
    var grad = MCP.shape.findItem(group, "ADBE Vector Graphic - G-Fill");
    var fill = null;
    if (MCP.isDefined(args.gradient)) {
        var g = args.gradient || {};
        if (solid && !grad) { solid.remove(); changed.push("removedSolidFill"); }
        fill = grad || items.addProperty("ADBE Vector Graphic - G-Fill");
        if (!grad) { changed.push("addedGradientFill"); }
        if (MCP.isDefined(g.type)) { MCP.shape.setIf(fill, "ADBE Vector Grad Type", "Type", String(g.type) === "radial" ? 2 : 1, changed, warnings, "gradient.type"); }
        if (MCP.isArray(g.start)) { MCP.shape.setIf(fill, "ADBE Vector Grad Start Pt", "Start Point", [Number(g.start[0]), Number(g.start[1])], changed, warnings, "gradient.start"); }
        if (MCP.isArray(g.end)) { MCP.shape.setIf(fill, "ADBE Vector Grad End Pt", "End Point", [Number(g.end[0]), Number(g.end[1])], changed, warnings, "gradient.end"); }
        if (MCP.isArray(g.stops) && g.stops.length) {
            warnings.push("Gradient colour stops cannot be written by After Effects scripting; the " + g.stops.length + " stops were not applied. Open the fill's Gradient Editor to set them.");
        }
        if (MCP.isDefined(args.opacity)) { MCP.shape.setIf(fill, "ADBE Vector Fill Opacity", "Opacity", Number(args.opacity), changed, warnings, "opacity"); }
        if (MCP.isDefined(args.fillRule)) { MCP.shape.setIf(fill, "ADBE Vector Fill Rule", "Fill Rule", String(args.fillRule) === "even-odd" ? 2 : 1, changed, warnings, "fillRule"); }
        if (MCP.isDefined(args.color)) { warnings.push("color was ignored because a gradient was requested."); }
    } else {
        if (!solid) {
            if (grad && MCP.isDefined(args.color)) { grad.remove(); changed.push("removedGradientFill"); }
            solid = items.addProperty("ADBE Vector Graphic - Fill");
            changed.push("addedFill");
        }
        fill = solid;
        if (MCP.isDefined(args.color)) { MCP.shape.setIf(fill, "ADBE Vector Fill Color", "Color", MCP.color.rgba(args.color), changed, warnings, "color"); }
        if (MCP.isDefined(args.opacity)) { MCP.shape.setIf(fill, "ADBE Vector Fill Opacity", "Opacity", Number(args.opacity), changed, warnings, "opacity"); }
        if (MCP.isDefined(args.fillRule)) { MCP.shape.setIf(fill, "ADBE Vector Fill Rule", "Fill Rule", String(args.fillRule) === "even-odd" ? 2 : 1, changed, warnings, "fillRule"); }
    }
    var colorProp = MCP.childProp(fill, "ADBE Vector Fill Color");
    var opacityProp = MCP.childProp(fill, "ADBE Vector Fill Opacity") || MCP.findProp(fill, "Opacity");
    var values = {
        kind: MCP.shape.kindOf(fill),
        color: colorProp ? _mcpTry(function () { return MCP.color.toHex(colorProp.value); }, null) : null,
        opacity: opacityProp ? _mcpTry(function () { return MCP.round(opacityProp.value); }, null) : null
    };
    if (values.kind === "gradient-fill") {
        values.gradientType = Number(_mcpTry(function () { return MCP.childProp(fill, "ADBE Vector Grad Type").value; }, 1)) === 2 ? "radial" : "linear";
        values.start = MCP.roundValue(_mcpTry(function () { return MCP.childProp(fill, "ADBE Vector Grad Start Pt").value; }, null));
        values.end = MCP.roundValue(_mcpTry(function () { return MCP.childProp(fill, "ADBE Vector Grad End Pt").value; }, null));
    }
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        group: MCP.shape.nodeSummary(group), fill: MCP.shape.nodeSummary(fill), fillPath: MCP.pathOf(fill).path,
        values: values, changed: changed, warnings: warnings
    };
}, { mutating: true });

MCP.register("setShapeStroke", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var group = MCP.shape.resolveGroup(r.layer, args.group);
    var items = MCP.shape.itemsOf(group);
    var changed = [], notes = [];
    var stroke = MCP.shape.findItem(group, "ADBE Vector Graphic - Stroke");
    if (!stroke) {
        stroke = items.addProperty("ADBE Vector Graphic - Stroke");
        changed.push("addedStroke");
        MCP.shape.setIf(stroke, "ADBE Vector Stroke Color", "Color", MCP.color.rgba(args.color, [1, 1, 1, 1]), [], notes, "color");
        MCP.shape.setIf(stroke, "ADBE Vector Stroke Width", "Stroke Width", MCP.num(args.width, 2), [], notes, "width");
    }
    if (MCP.isDefined(args.color)) { MCP.shape.setIf(stroke, "ADBE Vector Stroke Color", "Color", MCP.color.rgba(args.color), changed, notes, "color"); }
    if (MCP.isDefined(args.width)) { MCP.shape.setIf(stroke, "ADBE Vector Stroke Width", "Stroke Width", Number(args.width), changed, notes, "width"); }
    if (MCP.isDefined(args.opacity)) { MCP.shape.setIf(stroke, "ADBE Vector Stroke Opacity", "Opacity", Number(args.opacity), changed, notes, "opacity"); }
    if (MCP.isDefined(args.lineCap)) { MCP.shape.setIf(stroke, "ADBE Vector Stroke Line Cap", "Line Cap", { butt: 1, round: 2, square: 3 }[String(args.lineCap)] || 1, changed, notes, "lineCap"); }
    if (MCP.isDefined(args.lineJoin)) { MCP.shape.setIf(stroke, "ADBE Vector Stroke Line Join", "Line Join", { miter: 1, round: 2, bevel: 3 }[String(args.lineJoin)] || 1, changed, notes, "lineJoin"); }
    if (MCP.isDefined(args.miterLimit)) { MCP.shape.setIf(stroke, "ADBE Vector Stroke Miter Limit", "Miter Limit", Number(args.miterLimit), changed, notes, "miterLimit"); }
    if (MCP.isArray(args.dashes) && args.dashes.length) {
        var dashGroup = MCP.childProp(stroke, "ADBE Vector Stroke Dashes") || MCP.findProp(stroke, "Dashes");
        if (!dashGroup) { notes.push("Stroke has no Dashes group; dashes skipped."); }
        else {
            for (var d = 0; d < args.dashes.length && d < 6; d++) {
                var n = Math.floor(d / 2) + 1;
                var mn = (d % 2 === 0 ? "ADBE Vector Stroke Dash " : "ADBE Vector Stroke Gap ") + n;
                var dp = MCP.childProp(dashGroup, mn);
                if (!dp) { try { dp = dashGroup.addProperty(mn); } catch (e) { dp = null; } }
                if (!dp) { notes.push("Could not add dash entry '" + mn + "'."); continue; }
                try { dp.setValue(Number(args.dashes[d])); } catch (e2) { notes.push("Could not set '" + mn + "': " + e2.toString()); }
            }
            changed.push("dashes");
            if (MCP.isDefined(args.dashOffset)) {
                var op = MCP.childProp(dashGroup, "ADBE Vector Stroke Offset");
                if (!op) { try { op = dashGroup.addProperty("ADBE Vector Stroke Offset"); } catch (e3) { op = null; } }
                if (op) { try { op.setValue(Number(args.dashOffset)); changed.push("dashOffset"); } catch (e4) { notes.push("Could not set dash offset."); } }
            }
        }
    }
    if (!changed.length) { MCP.fail("No stroke fields given. Use color, width, opacity, lineCap, lineJoin, miterLimit, dashes or dashOffset.", "invalid-argument"); }
    var cp = MCP.childProp(stroke, "ADBE Vector Stroke Color"), wp = MCP.childProp(stroke, "ADBE Vector Stroke Width"), opp = MCP.childProp(stroke, "ADBE Vector Stroke Opacity");
    var values = {
        color: cp ? _mcpTry(function () { return MCP.color.toHex(cp.value); }, null) : null,
        width: wp ? _mcpTry(function () { return MCP.round(wp.value); }, null) : null,
        opacity: opp ? _mcpTry(function () { return MCP.round(opp.value); }, null) : null,
        lineCap: _mcpTry(function () { return ["", "butt", "round", "square"][Number(MCP.childProp(stroke, "ADBE Vector Stroke Line Cap").value)] || null; }, null),
        lineJoin: _mcpTry(function () { return ["", "miter", "round", "bevel"][Number(MCP.childProp(stroke, "ADBE Vector Stroke Line Join").value)] || null; }, null)
    };
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        group: MCP.shape.nodeSummary(group), stroke: MCP.shape.nodeSummary(stroke), strokePath: MCP.pathOf(stroke).path,
        values: values, changed: changed, notes: notes
    };
}, { mutating: true });

MCP.register("setShapePath", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var pathProp = null;
    if (MCP.isDefined(args.pathProperty)) {
        pathProp = MCP.resolveProperty(r.layer, args.pathProperty);
        if (MCP.isGroup(pathProp) && pathProp.matchName === "ADBE Vector Shape - Group") { pathProp = MCP.childProp(pathProp, "ADBE Vector Shape"); }
    } else {
        var group = MCP.shape.resolveGroup(r.layer, args.group);
        var item = MCP.shape.findItem(group, "ADBE Vector Shape - Group");
        if (!item) {
            var parametric = MCP.shape.findItem(group, ["ADBE Vector Shape - Rect", "ADBE Vector Shape - Ellipse", "ADBE Vector Shape - Star"]);
            if (parametric) {
                MCP.fail("Group '" + group.name + "' holds a parametric " + parametric.name + " (" + parametric.matchName + "), which has no editable vertices. Change its Size with set-property-value, or add a bezier path with add-shape-to-layer shapeType 'path'.", "unsupported");
            }
            MCP.fail("Group '" + group.name + "' has no Path item. Items: " + MCP.childNames(MCP.shape.itemsOf(group)).join(", "), "not-found");
        }
        pathProp = MCP.childProp(item, "ADBE Vector Shape");
    }
    var vt = _mcpTry(function () { return MCP.serialize.valueTypeName(pathProp); }, "");
    if (vt !== "shape") { MCP.fail("Property '" + MCP.pathOf(pathProp).path + "' is not a Path (value type " + vt + ").", "invalid-argument"); }
    var points = MCP.requireArg(args, "points");
    if (!MCP.isArray(points) || points.length < 2) { MCP.fail("points must be an array of at least two [x, y] pairs.", "invalid-argument"); }
    var shape = MCP.shape.pathFromPoints(points, MCP.bool(args.closed, true), args.inTangents, args.outTangents);
    var keyIndex = null;
    if (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) {
        keyIndex = MCP.easing.setKey(pathProp, MCP.timeArg(r.comp, args), shape);
        if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(pathProp, keyIndex, args.easing); }
    } else if (pathProp.numKeys > 0) {
        keyIndex = MCP.easing.setKey(pathProp, r.comp.time, shape);
    } else {
        pathProp.setValue(shape);
    }
    return MCP.serialize.propertyResult(r.layer, pathProp, {
        vertexCount: points.length, closed: MCP.bool(args.closed, true),
        keyIndex: keyIndex, keyframe: keyIndex ? MCP.serialize.keyframe(pathProp, keyIndex) : null
    });
}, { mutating: true });

MCP.register("addShapeModifier", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var type = String(MCP.requireArg(args, "type"));
    var matchName = MCP.shape.MODIFIERS[type];
    if (!matchName) { MCP.fail("Unknown modifier type '" + type + "'. Use one of: " + MCP.keys(MCP.shape.MODIFIERS).join(", "), "invalid-argument"); }
    var target = MCP.shape.modifierContainer(r.layer, args);
    var mod = null;
    try { mod = target.container.addProperty(matchName); } catch (e) { mod = null; }
    if (!mod) { MCP.fail("Could not add " + type + " (" + matchName + ") to " + (target.scope === "root" ? "the Contents root" : "the group") + ".", "script-error"); }
    if (MCP.isDefined(args.name)) { mod.name = String(args.name); }
    var res = MCP.shape.applySettings(mod, args.params);
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        type: type, scope: target.scope, modifier: MCP.shape.modifierSummary(mod), modifierPath: MCP.pathOf(mod).path,
        applied: res.applied, notes: res.notes
    };
}, { mutating: true });

MCP.register("animateTrimPaths", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var target = MCP.shape.modifierContainer(layer, args);
    var trim = null;
    for (var i = 1; i <= target.container.numProperties && !trim; i++) {
        if (target.container.property(i).matchName === "ADBE Vector Filter - Trim") { trim = target.container.property(i); }
    }
    var created = false;
    if (!trim) { trim = target.container.addProperty("ADBE Vector Filter - Trim"); created = true; }
    var t0 = MCP.durationArg(comp, args, "startTime", "startFrame", layer.inPoint);
    var duration = MCP.durationArg(comp, args, "duration", "durationFrames", 1);
    if (duration <= 0) { MCP.fail("duration must be greater than 0.", "invalid-argument"); }
    var t1 = t0 + duration;
    var easing = MCP.isDefined(args.easing) ? args.easing : "ease-out";
    var notes = [], keyframes = [];
    if (MCP.isDefined(args.trimMultipleShapes)) {
        MCP.shape.setIf(trim, "ADBE Vector Trim Type", "Trim Multiple Shapes", String(args.trimMultipleShapes) === "individually" ? 2 : 1, [], notes, "trimMultipleShapes");
    }
    var specs = [
        { key: "start", matchName: "ADBE Vector Trim Start", display: "Start" },
        { key: "end", matchName: "ADBE Vector Trim End", display: "End" },
        { key: "offset", matchName: "ADBE Vector Trim Offset", display: "Offset" }
    ];
    var any = MCP.isDefined(args.start) || MCP.isDefined(args.end) || MCP.isDefined(args.offset);
    var plan = any ? args : { end: { from: 0, to: 100 } };
    for (var s = 0; s < specs.length; s++) {
        var spec = plan[specs[s].key];
        if (!spec || !MCP.isDefined(spec.from) || !MCP.isDefined(spec.to)) { continue; }
        var p = MCP.childProp(trim, specs[s].matchName) || MCP.findProp(trim, specs[s].display);
        if (!p) { notes.push("Trim Paths has no '" + specs[s].display + "' property."); continue; }
        var i0 = MCP.easing.setKey(p, t0, Number(spec.from));
        var i1 = MCP.easing.setKey(p, t1, Number(spec.to));
        MCP.easing.applySegment(p, i1, easing);
        var ka = MCP.easing.keyIndexAtTime(p, t0, 1e-3), kb = MCP.easing.keyIndexAtTime(p, t1, 1e-3);
        keyframes.push({ property: MCP.pathOf(p).path, keys: [MCP.serialize.keyframe(p, ka > 0 ? ka : i0), MCP.serialize.keyframe(p, kb > 0 ? kb : i1)] });
    }
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer),
        scope: target.scope, created: created, modifier: MCP.shape.modifierSummary(trim), modifierPath: MCP.pathOf(trim).path,
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        keyframes: keyframes, notes: notes
    };
}, { mutating: true });

MCP.register("addRepeater", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var target = MCP.shape.modifierContainer(r.layer, args);
    var rep = null;
    try { rep = target.container.addProperty("ADBE Vector Filter - Repeater"); } catch (e) { rep = null; }
    if (!rep) { MCP.fail("Could not add a Repeater to " + (target.scope === "root" ? "the Contents root" : "the group") + ".", "script-error"); }
    if (MCP.isDefined(args.name)) { rep.name = String(args.name); }
    var changed = [], notes = [];
    MCP.shape.setIf(rep, "ADBE Vector Repeater Copies", "Copies", MCP.num(args.copies, 3), changed, notes, "copies");
    if (MCP.isDefined(args.offset)) { MCP.shape.setIf(rep, "ADBE Vector Repeater Offset", "Offset", Number(args.offset), changed, notes, "offset"); }
    if (MCP.isDefined(args.compositeOrder)) { MCP.shape.setIf(rep, "ADBE Vector Repeater Order", "Composite", String(args.compositeOrder) === "above" ? 2 : 1, changed, notes, "compositeOrder"); }
    var tr = MCP.childProp(rep, "ADBE Vector Repeater Transform") || MCP.findProp(rep, "Transform") || rep;
    var t = args.transform || {};
    if (MCP.isArray(t.position)) { MCP.shape.setIf(tr, "ADBE Vector Repeater Position", "Position", [Number(t.position[0]), Number(t.position[1])], changed, notes, "transform.position"); }
    if (MCP.isArray(t.scale)) { MCP.shape.setIf(tr, "ADBE Vector Repeater Scale", "Scale", [Number(t.scale[0]), Number(t.scale[1])], changed, notes, "transform.scale"); }
    if (MCP.isDefined(t.rotation)) { MCP.shape.setIf(tr, "ADBE Vector Repeater Rotation", "Rotation", Number(t.rotation), changed, notes, "transform.rotation"); }
    if (MCP.isArray(t.anchorPoint)) { MCP.shape.setIf(tr, "ADBE Vector Repeater Anchor Point", "Anchor Point", [Number(t.anchorPoint[0]), Number(t.anchorPoint[1])], changed, notes, "transform.anchorPoint"); }
    if (MCP.isDefined(t.startOpacity)) { MCP.shape.setIf(tr, "ADBE Vector Repeater Opacity 1", "Start Opacity", Number(t.startOpacity), changed, notes, "transform.startOpacity"); }
    if (MCP.isDefined(t.endOpacity)) { MCP.shape.setIf(tr, "ADBE Vector Repeater Opacity 2", "End Opacity", Number(t.endOpacity), changed, notes, "transform.endOpacity"); }
    return {
        composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer),
        scope: target.scope, repeater: MCP.shape.modifierSummary(rep), repeaterPath: MCP.pathOf(rep).path,
        changed: changed, notes: notes
    };
}, { mutating: true });

MCP.register("listShapeGroups", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var contents = MCP.shape.contents(r.layer);
    var depth = Math.round(MCP.num(args.depth, 3));
    var out = [], groups = 0;
    for (var i = 1; i <= contents.numProperties; i++) {
        var p = contents.property(i);
        if (p.matchName === "ADBE Vector Group") { groups++; }
        out.push(MCP.shape.serializeNode(p, depth - 1));
    }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), groupCount: groups, count: out.length, contents: out };
}, { mutating: false });
