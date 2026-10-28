/*
 * Figma frame builder: takes the layer list the server made from a Figma node
 * tree (bottom to top, coordinates relative to the frame) and builds every
 * layer in one call. Shapes are centred on their layer, so the layer's anchor
 * is the node's centre; text boxes are aligned by their measured bounds.
 */

MCP.figma = {};

MCP.figma.rgba = function (c) {
    if (!c) { return null; }
    return [Number(c[0]), Number(c[1]), Number(c[2]), c.length > 3 ? Number(c[3]) : 1];
};

/** Adds a group with one path item to a shape layer's contents; returns the group's index. */
MCP.figma.group = function (layer, name) {
    var g = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    g.name = name;
    return g.propertyIndex;
};

/** The first group in a shape layer's contents draws on top: strokes go there, so a fill never covers an inside stroke. */
MCP.figma.toTop = function (layer, gi) {
    layer.property("ADBE Root Vectors Group").property(gi).moveTo(1);
};

MCP.figma.items = function (layer, gi) {
    return layer.property("ADBE Root Vectors Group").property(gi).property("ADBE Vectors Group");
};

MCP.figma.addFill = function (layer, gi, color, rule) {
    MCP.figma.items(layer, gi).addProperty("ADBE Vector Graphic - Fill");
    var items = MCP.figma.items(layer, gi);
    var f = items.property(items.numProperties);
    f.property("ADBE Vector Fill Color").setValue([color[0], color[1], color[2], 1]);
    f.property("ADBE Vector Fill Opacity").setValue(Math.round(color[3] * 1000) / 10);
    if (rule === "even-odd") { f.property("ADBE Vector Fill Rule").setValue(2); }
};

MCP.figma.addStroke = function (layer, gi, color, width) {
    MCP.figma.items(layer, gi).addProperty("ADBE Vector Graphic - Stroke");
    var items = MCP.figma.items(layer, gi);
    var s = items.property(items.numProperties);
    s.property("ADBE Vector Stroke Color").setValue([color[0], color[1], color[2], 1]);
    s.property("ADBE Vector Stroke Opacity").setValue(Math.round(color[3] * 1000) / 10);
    s.property("ADBE Vector Stroke Width").setValue(width);
};

MCP.figma.addRect = function (layer, gi, w, h, r, ellipse) {
    var items = MCP.figma.items(layer, gi);
    if (ellipse) {
        items.addProperty("ADBE Vector Shape - Ellipse");
        MCP.figma.items(layer, gi).property(1).property("ADBE Vector Ellipse Size").setValue([w, h]);
    } else {
        items.addProperty("ADBE Vector Shape - Rect");
        var rect = MCP.figma.items(layer, gi).property(1);
        rect.property("ADBE Vector Rect Size").setValue([w, h]);
        rect.property("ADBE Vector Rect Roundness").setValue(Math.max(0, Math.min(r || 0, Math.min(w, h) / 2)));
    }
};

MCP.figma.addPaths = function (layer, gi, paths) {
    for (var i = 0; i < paths.length; i++) {
        MCP.figma.items(layer, gi).addProperty("ADBE Vector Shape - Group");
        var items = MCP.figma.items(layer, gi);
        items.property(items.numProperties).property("ADBE Vector Shape").setValue(MCP.vectors.toShape(paths[i]));
    }
};

/** A Figma gradient on a shape layer: Gradient Ramp between the handles (a grey ramp turned into transparency for a fade),
 *  then Set Matte from the layer itself so the gradient stays inside the shape. */
MCP.figma.gradient = function (layer, s) {
    var g = s.gradient, w = s.w, h = s.h;
    var pt = function (hnd) { return [hnd[0] * w - w / 2, hnd[1] * h - h / 2]; };
    var a = g.stops[0].color, b = g.stops[1].color;
    var fx = function (match) {
        var e = layer.property("ADBE Effect Parade").addProperty(match);
        return layer.property("ADBE Effect Parade").property(e.propertyIndex);
    };
    var ramp = fx("ADBE Ramp");
    ramp.name = "Figma gradient";
    ramp = layer.property("ADBE Effect Parade").property("Figma gradient");
    // Shape layers render continuously: their effects work in comp space, so the handles go through toComp and follow the layer.
    var p0 = pt(g.handles[0]), p1 = pt(g.handles[1]);
    ramp.property("ADBE Ramp-0001").expression = "toComp([" + MCP.round(p0[0], 3) + ", " + MCP.round(p0[1], 3) + "]);";
    ramp.property("ADBE Ramp-0003").expression = "toComp([" + MCP.round(p1[0], 3) + ", " + MCP.round(p1[1], 3) + "]);";
    ramp.property("ADBE Ramp-0005").setValue(g.type === "radial" ? 2 : 1);
    if (g.fade) {
        ramp.property("ADBE Ramp-0002").setValue([a[3], a[3], a[3], 1]);
        ramp.property("ADBE Ramp-0004").setValue([b[3], b[3], b[3], 1]);
        var sc = fx("ADBE Shift Channels");
        sc.property("ADBE Shift Channels-0001").setValue(7);
        sc.property("ADBE Shift Channels-0002").setValue(9);
        sc.property("ADBE Shift Channels-0003").setValue(9);
        sc.property("ADBE Shift Channels-0004").setValue(9);
        var fl = fx("ADBE Fill");
        fl.property("ADBE Fill-0002").setValue([a[0], a[1], a[2], 1]);
    } else {
        ramp.property("ADBE Ramp-0002").setValue([a[0], a[1], a[2], 1]);
        ramp.property("ADBE Ramp-0004").setValue([b[0], b[1], b[2], 1]);
    }
    var sm = fx("ADBE Set Matte3");
    sm.property("ADBE Set Matte3-0001").setValue(layer.index);
    sm.property("ADBE Set Matte3-0002").setValue(4);
};

MCP.figma.place = function (layer, s) {
    var tg = layer.property("ADBE Transform Group");
    tg.property("ADBE Position").setValue([s.x + s.w / 2, s.y + s.h / 2]);
    if (s.rotation) { tg.property("ADBE Rotate Z").setValue(s.rotation); }
    if (s.opacity < 100) { tg.property("ADBE Opacity").setValue(s.opacity); }
};

MCP.figma.shape = function (comp, s, notes) {
    var layer = comp.layers.addShape();
    layer.name = s.name;
    var fill = MCP.figma.rgba(s.fill), stroke = s.stroke;
    var ellipse = s.kind === "ellipse";
    if (s.blur && s.blur > 0) {
        // Effects on a shape layer stop at the shape's bounds: an invisible rectangle gives the blur room to spread.
        var pad = MCP.figma.group(layer, "Blur room");
        MCP.figma.addRect(layer, pad, s.w + 6 * s.blur, s.h + 6 * s.blur, 0, false);
        MCP.figma.addFill(layer, pad, [0, 0, 0, 0], null);
    }
    if (s.kind === "path") {
        if (s.paths && s.paths.length) {
            var gi = MCP.figma.group(layer, "Fill");
            MCP.figma.addPaths(layer, gi, s.paths);
            if (fill) { MCP.figma.addFill(layer, gi, fill, s.fillRule); }
        }
        if (stroke && s.strokePaths && s.strokePaths.length) {
            // Figma's stroke geometry is the stroke's outline: fill it.
            var si = MCP.figma.group(layer, "Stroke");
            MCP.figma.addPaths(layer, si, s.strokePaths);
            MCP.figma.addFill(layer, si, MCP.figma.rgba(stroke.color), "non-zero");
            MCP.figma.toTop(layer, si);
        }
    } else {
        if (fill || s.kind === "image") {
            var fi = MCP.figma.group(layer, "Fill");
            MCP.figma.addRect(layer, fi, s.w, s.h, s.radius, ellipse);
            MCP.figma.addFill(layer, fi, fill || [0.5, 0.5, 0.5, 1], null);
        }
        if (stroke && stroke.sides) {
            // Per-side strokes (a bottom rule under a row): one thin filled bar per side, inside the box.
            var sd = stroke.sides, sc = MCP.figma.rgba(stroke.color);
            var bars = [["Top", sd.top, s.w, sd.top, 0, -s.h / 2 + sd.top / 2], ["Bottom", sd.bottom, s.w, sd.bottom, 0, s.h / 2 - sd.bottom / 2],
                        ["Left", sd.left, sd.left, s.h, -s.w / 2 + sd.left / 2, 0], ["Right", sd.right, sd.right, s.h, s.w / 2 - sd.right / 2, 0]];
            for (var b = 0; b < bars.length; b++) {
                if (!(bars[b][1] > 0)) { continue; }
                var bi = MCP.figma.group(layer, "Stroke " + bars[b][0]);
                MCP.figma.addRect(layer, bi, bars[b][2], bars[b][3], 0, false);
                MCP.figma.items(layer, bi).property(1).property("ADBE Vector Rect Position").setValue([bars[b][4], bars[b][5]]);
                MCP.figma.addFill(layer, bi, sc, null);
                MCP.figma.toTop(layer, bi);
            }
        } else if (stroke) {
            // After Effects centres strokes: draw inside and outside strokes on a resized copy of the shape.
            var d = stroke.align === "inside" ? -stroke.width : (stroke.align === "outside" ? stroke.width : 0);
            var ki = MCP.figma.group(layer, "Stroke");
            MCP.figma.addRect(layer, ki, s.w + d, s.h + d, (s.radius || 0) + d / 2, ellipse);
            MCP.figma.addStroke(layer, ki, MCP.figma.rgba(stroke.color), stroke.width);
            MCP.figma.toTop(layer, ki);
        }
    }
    MCP.figma.place(layer, s);
    if (s.gradient && s.kind !== "image") { MCP.figma.gradient(layer, s); }
    return layer;
};

MCP.figma.text = function (comp, s, notes, missing) {
    var t = s.text;
    var bw = Math.max(4, s.w + 4), bh = Math.max(4, s.h * 1.25 + 4);
    var layer = t.box ? comp.layers.addBoxText([bw, bh], t.characters) : comp.layers.addText(t.characters);
    layer.name = s.name;
    var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = prop.value;
    if (t.font) {
        try { doc.font = t.font; } catch (e0) {}
    }
    doc.fontSize = t.size;
    doc.applyFill = true;
    var c = MCP.figma.rgba(t.color);
    doc.fillColor = [c[0], c[1], c[2]];
    doc.applyStroke = false;
    doc.tracking = t.tracking;
    if (t.leading) {
        try { doc.autoLeading = false; doc.leading = t.leading; } catch (e1) {}
    }
    doc.justification = t.align === "center" ? ParagraphJustification.CENTER_JUSTIFY : (t.align === "right" ? ParagraphJustification.RIGHT_JUSTIFY : ParagraphJustification.LEFT_JUSTIFY);
    prop.setValue(doc);
    // After Effects keeps the requested name even when it substitutes, so ask its font list (26+) whether the font exists.
    var have = _mcpTry(function () { return app.fonts.getFontsByPostScriptName(t.font).length > 0; }, null);
    var got = _mcpTry(function () { return String(prop.value.font); }, "");
    if (t.font && (have === false || got !== t.font)) { missing[t.font] = (t.family || t.font) + (t.style ? " " + t.style : ""); }
    if (c[3] < 1) { layer.property("ADBE Transform Group").property("ADBE Opacity").setValue(s.opacity * c[3]); }
    // Align the measured text to the Figma box: box text by its box, point text by its glyphs.
    var r = layer.sourceRectAtTime(0, false);
    var tg = layer.property("ADBE Transform Group");
    var targetX, rx;
    if (t.box) { targetX = s.x; rx = r.left; }
    else if (t.align === "center") { targetX = s.x + s.w / 2; rx = r.left + r.width / 2; }
    else if (t.align === "right") { targetX = s.x + s.w; rx = r.left + r.width; }
    else { targetX = s.x; rx = r.left; }
    // Exact: put the letters where Figma draws them (its render bounds); sourceRectAtTime gives the letters' bounds here too.
    if (s.ink) {
        tg.property("ADBE Position").setValue([s.ink.x - r.left, s.ink.y - r.top]);
        if (s.rotation) { tg.property("ADBE Rotate Z").setValue(s.rotation); }
        if (s.opacity < 100 && c[3] >= 1) { tg.property("ADBE Opacity").setValue(s.opacity); }
        return layer;
    }
    // Text layers keep their anchor at [0, 0], so a layer-space point lands at position + point.
    // Box text is placed by its box (sourceRectAtTime gives the glyphs, not the box): the box's top-left in
    // layer space is boxTextPos where After Effects has it, else the box is centred on the anchor.
    if (t.box) {
        var bp = _mcpTry(function () { return prop.value.boxTextPos; }, null);
        var left = bp ? bp[0] : -bw / 2, top = bp ? bp[1] : -bh / 2;
        // The box is 4 px wider than Figma's: the extra goes after the text (right for left-aligned, both sides when centred).
        var shift = t.align === "center" ? 2 : (t.align === "right" ? 4 : 0);
        tg.property("ADBE Position").setValue([s.x - left - shift, s.y - top]);
    } else {
        tg.property("ADBE Position").setValue([targetX - rx, (s.y + s.h / 2) - (r.top + r.height / 2)]);
    }
    if (s.rotation) { tg.property("ADBE Rotate Z").setValue(s.rotation); }
    if (s.opacity < 100 && c[3] >= 1) { tg.property("ADBE Opacity").setValue(s.opacity); }
    return layer;
};

MCP.figma.image = function (comp, s, notes) {
    if (!s.image || !s.image.file) {
        var ph = MCP.figma.shape(comp, s, notes);
        ph.name = s.name + " (image placeholder)";
        return ph;
    }
    var f = new File(s.image.file);
    var item = app.project.importFile(new ImportOptions(f));
    if (MCP.figma.imagesFolder) { try { item.parentFolder = MCP.figma.imagesFolder; } catch (eF) {} }
    var layer = comp.layers.add(item);
    layer.name = s.name;
    var tg = layer.property("ADBE Transform Group");
    tg.property("ADBE Scale").setValue([s.w / item.width * 100, s.h / item.height * 100]);
    MCP.figma.place(layer, s);
    return layer;
};

MCP.figma.LABELS = { comp: 8, text: 2, shape: 9, overlay: 5, image: 6 };

MCP.register("buildFigma", function (args) {
    var frame = MCP.requireArg(args, "frame");
    var specs = MCP.requireArg(args, "layers");
    var fps = MCP.num(args.frameRate, 30), dur = MCP.num(args.duration, 10);
    var root, created = false;
    var rootName = String(MCP.arg(args, "name", frame.name));
    if (MCP.isDefined(args.comp)) { root = MCP.resolveComp(args.comp); }
    else {
        root = app.project.items.addComp(rootName, Math.max(4, Math.round(frame.width)), Math.max(4, Math.round(frame.height)), 1, dur, fps);
        created = true;
        root.bgColor = frame.background ? [frame.background[0], frame.background[1], frame.background[2]] : [1, 1, 1];
    }
    var notes = [], made = [], failed = [], missing = {}, counts = {};
    if (created && !frame.background) { notes.push("The frame has no fill, so the comp background was set to white (the Figma canvas); it renders transparent."); }
    // Project folders: Figma · <frame> / Components, Images.
    var folder = app.project.items.addFolder(/^Figma · /.test(rootName) ? rootName : "Figma · " + rootName);
    var compsFolder = null;
    if (created) { root.parentFolder = folder; }
    MCP.figma.imagesFolder = null;
    for (i = 0; i < specs.length; i++) { if (specs[i].kind === "image" && specs[i].image && specs[i].image.file) { MCP.figma.imagesFolder = app.project.items.addFolder("Images"); MCP.figma.imagesFolder.parentFolder = folder; break; } }
    var comps = {}, origins = {};
    comps["__root"] = root;
    origins["__root"] = [0, 0];
    var key = function (id) { return id === null || id === undefined ? "__root" : String(id); };
    var i;
    // Component comps are filed like the design: Components / <top-level part> / <its part> / <its part>, three levels at most.
    var groupSpec = {}, subFolders = {};
    for (i = 0; i < specs.length; i++) { if (specs[i].kind === "group") { groupSpec[specs[i].id] = specs[i]; } }
    var folderFor = function (g) {
        var chain = [], p = g.parent, guard = 0;
        while (p !== null && p !== undefined && groupSpec[p] && guard++ < 50) { chain.unshift(String(groupSpec[p].name)); p = groupSpec[p].parent; }
        var f = compsFolder, path = "";
        for (var d = 0; d < chain.length && d < 3; d++) {
            path += "/" + chain[d];
            if (!subFolders[path]) { subFolders[path] = app.project.items.addFolder(chain[d]); subFolders[path].parentFolder = f; }
            f = subFolders[path];
        }
        return f;
    };
    for (i = 0; i < specs.length; i++) {
        var g = specs[i];
        if (g.kind !== "group") { continue; }
        if (!compsFolder) { compsFolder = app.project.items.addFolder("Components"); compsFolder.parentFolder = folder; }
        // Frames that do not clip in Figma get room around them, so text that renders a little wider is not cut.
        var pad = Number(g.pad) || 0;
        var c = app.project.items.addComp(String(g.name), Math.max(4, Math.round(g.w + 2 * pad)), Math.max(4, Math.round(g.h + 2 * pad)), 1, dur, fps);
        c.parentFolder = folderFor(g);
        c.bgColor = root.bgColor;
        comps[g.id] = c;
        origins[g.id] = [g.x - pad, g.y - pad];
    }
    if (created && frame.background) {
        var bg = root.layers.addSolid([frame.background[0], frame.background[1], frame.background[2]], "Background", root.width, root.height, 1, root.duration);
        bg.label = MCP.figma.LABELS.shape;
        made.push({ figmaId: frame.id, comp: root.id, layer: MCP.serialize.layerRef(bg), kind: "background" });
    }
    for (i = 0; i < specs.length; i++) {
        var s = specs[i];
        var target = comps[key(s.parent)];
        var o = origins[key(s.parent)];
        if (!target) { failed.push({ figmaId: s.id, name: s.path, error: "its group was not built" }); continue; }
        // Coordinates arrive relative to the frame; move them into the comp that holds the layer.
        var local = {};
        for (var k in s) { if (s.hasOwnProperty(k)) { local[k] = s[k]; } }
        local.x = s.x - o[0];
        local.y = s.y - o[1];
        if (s.ink) { local.ink = { x: s.ink.x - o[0], y: s.ink.y - o[1], w: s.ink.w, h: s.ink.h }; }
        try {
            var L;
            if (s.kind === "group") {
                L = target.layers.add(comps[s.id]);
                L.name = String(s.name);
                MCP.figma.place(L, local);
            } else if (s.kind === "text") { L = MCP.figma.text(target, local, notes, missing); }
            else if (s.kind === "image") { L = MCP.figma.image(target, local, notes); }
            else { L = MCP.figma.shape(target, local, notes); }
            L.comment = "figma " + s.id + " · " + s.path;
            if (MCP.figma.LABELS[s.role]) { L.label = MCP.figma.LABELS[s.role]; }
            if (s.blur && s.blur > 0) {
                var fx = L.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
                L.property("ADBE Effect Parade").property(fx.propertyIndex).property("ADBE Gaussian Blur 2-0001").setValue(s.blur);
            }
            counts[s.kind] = (counts[s.kind] || 0) + 1;
            made.push({ figmaId: s.id, comp: target.id, layer: MCP.serialize.layerRef(L), kind: s.kind });
        } catch (e) {
            failed.push({ figmaId: s.id, name: s.path, error: e.message });
        }
    }
    var fonts = [];
    for (var f in missing) { if (missing.hasOwnProperty(f)) { fonts.push(missing[f] + " (" + f + ")"); } }
    if (fonts.length) { notes.push("Fonts not installed here, so After Effects used a fallback: " + fonts.join(", ") + ". Install them and set the font again (relink-fonts)."); }
    var compList = [];
    for (var id in comps) { if (comps.hasOwnProperty(id) && id !== "__root") { compList.push(MCP.serialize.compRef(comps[id])); } }
    return {
        composition: MCP.serialize.compRef(root),
        created: created,
        width: root.width,
        height: root.height,
        folder: folder.name,
        components: compList,
        counts: counts,
        layerCount: made.length,
        made: made,
        failed: failed,
        missingFonts: fonts,
        notes: notes
    };
}, { mutating: true });
