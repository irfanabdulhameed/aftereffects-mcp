/*
 * Shape layer commands.
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
