/*
 * Layer commands: listing, creation of simple layer types, duplication,
 * centring, timing.
 */

MCP.applyLayerTiming = function (comp, layer, args) {
    var changed = [];
    if (MCP.isDefined(args.startTime) || MCP.isDefined(args.startFrame)) {
        layer.startTime = MCP.durationArg(comp, args, "startTime", "startFrame", layer.startTime);
        changed.push("startTime");
    }
    if (MCP.isDefined(args.inPoint) || MCP.isDefined(args.inFrame)) {
        layer.inPoint = MCP.durationArg(comp, args, "inPoint", "inFrame", layer.inPoint);
        changed.push("inPoint");
    }
    if (MCP.isDefined(args.outPoint) || MCP.isDefined(args.outFrame)) {
        layer.outPoint = MCP.durationArg(comp, args, "outPoint", "outFrame", layer.outPoint);
        changed.push("outPoint");
    }
    if (MCP.isDefined(args.duration) || MCP.isDefined(args.durationFrames)) {
        var d = MCP.durationArg(comp, args, "duration", "durationFrames", layer.outPoint - layer.inPoint);
        if (d > 0) { layer.outPoint = layer.inPoint + d; changed.push("duration"); }
    }
    if (MCP.isDefined(args.stretch)) {
        layer.stretch = Number(args.stretch);
        changed.push("stretch");
    }
    return changed;
};

MCP.placeNewLayer = function (comp, layer, args) {
    if (MCP.isDefined(args.name)) { layer.name = String(args.name); }
    if (MCP.isDefined(args.position)) {
        try { layer.property("ADBE Transform Group").property("ADBE Position").setValue(args.position); } catch (e) {}
    }
    MCP.applyLayerTiming(comp, layer, args);
    if (MCP.isDefined(args.label)) { layer.label = MCP.enums.labelIndex(args.label); }
    if (MCP.isDefined(args.parent)) { layer.parent = MCP.resolveLayer(comp, args.parent); }
    if (MCP.isDefined(args.blendMode)) { layer.blendingMode = MCP.enums.blendModeValue(args.blendMode); }
    if (MCP.isDefined(args.threeD)) { layer.threeDLayer = MCP.bool(args.threeD, false); }
    if (MCP.isDefined(args.above)) {
        var ref = MCP.resolveLayer(comp, args.above);
        // Layer has no moveBefore(): put the new layer under ref, then move ref under it.
        layer.moveAfter(ref);
        ref.moveAfter(layer);
    } else if (MCP.isDefined(args.below)) {
        var ref2 = MCP.resolveLayer(comp, args.below);
        layer.moveAfter(ref2);
    } else if (MCP.bool(args.toBottom, false)) {
        layer.moveToEnd();
    }
    return layer;
};

MCP.register("listLayers", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var out = [];
    var includeKeys = MCP.bool(args.includeKeyframes, false);
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (MCP.bool(args.selectedOnly, false) && !L.selected) { continue; }
        out.push(MCP.serialize.layer(L, { keyframes: includeKeys }));
    }
    return { composition: MCP.serialize.compRef(comp), count: out.length, layers: out };
}, { mutating: false });

MCP.register("getLayerDetails", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var out = MCP.serialize.layer(r.layer, { keyframes: true });
    var depth = Math.round(MCP.num(args.depth, 2));
    var groups = ["ADBE Transform Group", "ADBE Effect Parade", "ADBE Mask Parade", "ADBE Text Properties", "ADBE Root Vectors Group", "ADBE Audio Group", "ADBE Material Options Group", "ADBE Camera Options Group", "ADBE Light Options Group", "ADBE Layer Styles"];
    out.properties = [];
    for (var g = 0; g < groups.length; g++) {
        var grp = _mcpTry(function () { return r.layer.property(groups[g]); }, null);
        if (!grp) { continue; }
        out.properties.push(MCP.serialize.property(grp, { children: true, depth: depth, values: true }));
    }
    var comp = r.comp;
    out.timing = {
        startTime: MCP.round(r.layer.startTime), inPoint: MCP.round(r.layer.inPoint), outPoint: MCP.round(r.layer.outPoint),
        startFrame: MCP.frameOf(comp, r.layer.startTime), inFrame: MCP.frameOf(comp, r.layer.inPoint), outFrame: MCP.frameOf(comp, r.layer.outPoint),
        durationSeconds: MCP.round(r.layer.outPoint - r.layer.inPoint), durationFrames: MCP.frameOf(comp, r.layer.outPoint - r.layer.inPoint),
        sourceInPoint: MCP.round(r.layer.inPoint - r.layer.startTime), sourceOutPoint: MCP.round(r.layer.outPoint - r.layer.startTime),
        frameRate: comp.frameRate
    };
    out.markers = _mcpTry(function () {
        var mp = r.layer.property("ADBE Marker"), arr = [];
        for (var k = 1; k <= mp.numKeys; k++) { var mv = MCP.serialize.marker(mp.keyValue(k)); mv.time = MCP.round(mp.keyTime(k)); arr.push(mv); }
        return arr;
    }, []);
    out.composition = MCP.serialize.compRef(comp);
    return out;
}, { mutating: false });

MCP.register("createSolidLayer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var color = MCP.color.rgb(args.color, [1, 1, 1]);
    var size = MCP.isArray(args.size) ? args.size : [comp.width, comp.height];
    var name = MCP.arg(args, "name", "Solid");
    var layer = comp.layers.addSolid(color, name, Math.round(size[0]), Math.round(size[1]), MCP.num(args.pixelAspect, 1), comp.duration);
    if (!MCP.isDefined(args.position)) {
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    }
    MCP.placeNewLayer(comp, layer, args);
    return { composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layer(layer) };
}, { mutating: true });

MCP.register("createAdjustmentLayer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var size = MCP.isArray(args.size) ? args.size : [comp.width, comp.height];
    var name = MCP.arg(args, "name", "Adjustment Layer");
    var layer = comp.layers.addSolid([0, 0, 0], name, Math.round(size[0]), Math.round(size[1]), 1, comp.duration);
    layer.adjustmentLayer = true;
    if (!MCP.isDefined(args.position)) {
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    }
    MCP.placeNewLayer(comp, layer, args);
    return { composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layer(layer) };
}, { mutating: true });

MCP.register("createNullLayer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layer = comp.layers.addNull(comp.duration);
    layer.name = MCP.arg(args, "name", "Null");
    if (MCP.isDefined(args.position)) {
        layer.property("ADBE Transform Group").property("ADBE Position").setValue(args.position);
    } else if (MCP.bool(args.centered, true)) {
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    }
    MCP.placeNewLayer(comp, layer, args);
    if (MCP.isArray(args.children)) {
        var kids = MCP.resolveLayers(comp, args.children);
        for (var i = 0; i < kids.length; i++) { if (kids[i] !== layer) { kids[i].parent = layer; } }
    }
    return { composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layer(layer) };
}, { mutating: true });

/**
 * duplicateLayer: one copy above the source by default, or several copies at
 * given times (times[]), or count copies each offset by offsetTime.
 */
MCP.register("duplicateLayer", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, src = r.layer;
    var fd = comp.frameDuration;
    var created = [];
    var headTrim = src.inPoint - src.startTime;
    var namePattern = MCP.isDefined(args.namePattern) ? String(args.namePattern) : null;
    var offsetTime = MCP.durationArg(comp, args, "offsetTime", "offsetFrames", 0);
    var offsetPosition = MCP.isArray(args.offsetPosition) ? args.offsetPosition : null;

    var targets = [];
    if (MCP.isArray(args.times) && args.times.length) {
        for (var t = 0; t < args.times.length; t++) { targets.push({ inPoint: Number(args.times[t]) + offsetTime }); }
    } else if (MCP.isArray(args.frames) && args.frames.length) {
        for (var f = 0; f < args.frames.length; f++) { targets.push({ inPoint: Number(args.frames[f]) * fd + offsetTime }); }
    } else {
        var count = Math.max(1, Math.round(MCP.num(args.count, 1)));
        for (var c = 1; c <= count; c++) {
            targets.push({ inPoint: offsetTime ? src.inPoint + offsetTime * c : null, copyIndex: c });
        }
    }
    var prev = src;
    for (var k = 0; k < targets.length; k++) {
        var dup = src.duplicate();
        if (targets[k].inPoint !== null && targets[k].inPoint !== undefined) { dup.startTime = targets[k].inPoint - headTrim; }
        if (namePattern) {
            dup.name = namePattern.replace(/\{n\}/g, String(k + 1)).replace(/\{name\}/g, src.name).replace(/\{i\}/g, String(k));
        } else if (MCP.isDefined(args.name)) {
            dup.name = String(args.name) + (targets.length > 1 ? " " + (k + 1) : "");
        }
        if (offsetPosition) {
            var pp = dup.property("ADBE Transform Group").property("ADBE Position");
            var cur = pp.value, next = [];
            for (var d = 0; d < cur.length; d++) { next.push(cur[d] + (offsetPosition[d] || 0) * (k + 1)); }
            if (pp.numKeys === 0) { pp.setValue(next); }
        }
        if (MCP.bool(args.below, false)) { dup.moveAfter(prev); prev = dup; }
        created.push(MCP.serialize.layer(dup));
    }
    return { composition: MCP.serialize.compRef(comp), source: MCP.serialize.layerRef(src), createdCount: created.length, layers: created };
}, { mutating: true });

MCP.register("centerLayers", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers;
    if (MCP.isDefined(args.layers)) { layers = MCP.resolveLayers(comp, args.layers); }
    else if (MCP.isDefined(args.layer)) { layers = [MCP.resolveLayer(comp, args.layer)]; }
    else if (MCP.bool(args.all, false)) { layers = MCP.resolveLayers(comp, { all: true }); }
    else { layers = MCP.resolveLayers(comp, { selected: true }); }
    var cx = comp.width / 2, cy = comp.height / 2;
    var axis = MCP.arg(args, "axis", "both");
    var out = [];
    for (var i = 0; i < layers.length; i++) {
        var pp = layers[i].property("ADBE Transform Group").property("ADBE Position");
        var cur = pp.value;
        var next = cur.slice(0);
        if (axis === "both" || axis === "x") { next[0] = cx; }
        if (axis === "both" || axis === "y") { next[1] = cy; }
        if (pp.numKeys > 0) { pp.setValueAtTime(comp.time, next); } else { pp.setValue(next); }
        out.push({ index: layers[i].index, name: layers[i].name, position: MCP.roundValue(pp.value) });
    }
    return { composition: MCP.serialize.compRef(comp), center: [cx, cy], centeredCount: out.length, layers: out };
}, { mutating: true });

MCP.register("setLayerTiming", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var changed = MCP.applyLayerTiming(r.comp, r.layer, args);
    var s = MCP.serialize.layer(r.layer);
    return { composition: MCP.serialize.compRef(r.comp), layer: s, changed: changed };
}, { mutating: true });
