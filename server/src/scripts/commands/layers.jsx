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
    var typeFilter = MCP.isDefined(args.type) ? String(args.type).toLowerCase() : null;
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (MCP.bool(args.selectedOnly, false) && !L.selected) { continue; }
        if (typeFilter && MCP.layerType(L) !== typeFilter) { continue; }
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

/* ------------------------------------------------------------ helpers */

MCP.layers = {};

/** Sets the first property under group that matches one of names. Returns true when set. */
MCP.layers.setOption = function (group, names, value) {
    if (!group) { return false; }
    for (var i = 0; i < names.length; i++) {
        var p = MCP.childProp(group, names[i]);
        if (!p) { continue; }
        try { p.setValue(value); return true; } catch (e) {}
    }
    return false;
};

MCP.layers.getOption = function (group, names, fallback) {
    if (!group) { return fallback; }
    for (var i = 0; i < names.length; i++) {
        var p = MCP.childProp(group, names[i]);
        if (p) { return _mcpTry(function () { return MCP.serialize.rawValue(p.value); }, fallback); }
    }
    return fallback;
};

MCP.layers.CAMERA_PRESETS = { "15mm": 15, "20mm": 20, "24mm": 24, "28mm": 28, "35mm": 35, "50mm": 50, "80mm": 80, "135mm": 135, "200mm": 200 };

MCP.layers.qualityName = function (value) {
    var names = ["DRAFT", "BEST", "WIREFRAME"];
    for (var i = 0; i < names.length; i++) {
        var v = _mcpTry(function () { return LayerQuality[names[i]]; }, undefined);
        if (v !== undefined && v === value) { return names[i].toLowerCase(); }
    }
    return String(value);
};

MCP.layers.frameBlendingName = function (value) {
    var pairs = [["NO_FRAME_BLEND", "none"], ["FRAME_MIX", "frame-mix"], ["PIXEL_MOTION", "pixel-motion"]];
    for (var i = 0; i < pairs.length; i++) {
        var v = _mcpTry(function () { return FrameBlendingType[pairs[i][0]]; }, undefined);
        if (v !== undefined && v === value) { return pairs[i][1]; }
    }
    return String(value);
};

/** Layers from args.layers (array, {selected}, {all}) or args.layer. */
MCP.layers.targets = function (comp, args) {
    if (MCP.isDefined(args.layers)) { return MCP.resolveLayers(comp, args.layers); }
    if (MCP.isDefined(args.layer)) { return [MCP.resolveLayer(comp, args.layer)]; }
    MCP.fail("Give layer {index|id|name}, or layers as an array, {selected: true} or {all: true}.", "invalid-argument");
    return [];
};

MCP.layers.deselectAll = function (comp) {
    for (var i = 1; i <= comp.numLayers; i++) {
        try { comp.layer(i).selected = false; } catch (e) {}
    }
};

MCP.layers.namesInOrder = function (comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) { out.push(comp.layer(i).name); }
    return out;
};

/* ------------------------------------------------------- camera, light */

MCP.register("createCameraLayer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var name = MCP.arg(args, "name", "Camera 1");
    var presetKey = String(MCP.arg(args, "preset", "50mm")).toLowerCase();
    var focal = MCP.layers.CAMERA_PRESETS[presetKey];
    if (!focal) { MCP.fail("Unknown camera preset '" + presetKey + "'. Use one of: " + MCP.keys(MCP.layers.CAMERA_PRESETS).join(", "), "invalid-argument"); }
    // Zoom approximation: 36 mm film width, so zoom = comp width * focal length / 36.
    var zoom = MCP.isDefined(args.zoom) ? Number(args.zoom) : comp.width * focal / 36;
    var oneNode = String(MCP.arg(args, "type", "two-node")).toLowerCase() === "one-node";
    var cam = comp.layers.addCamera(name, [comp.width / 2, comp.height / 2]);
    try {
        cam.autoOrient = oneNode ? AutoOrientType.NO_AUTO_ORIENT : AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
    } catch (e1) {}
    var tg = cam.property("ADBE Transform Group");
    var pos = MCP.isArray(args.position) ? args.position : [comp.width / 2, comp.height / 2, -zoom];
    if (pos.length < 3) { pos = [pos[0], pos[1], -zoom]; }
    try { tg.property("ADBE Position").setValue(pos); } catch (e2) {}
    var poi = null;
    if (!oneNode) {
        poi = MCP.isArray(args.pointOfInterest) ? args.pointOfInterest : [comp.width / 2, comp.height / 2, 0];
        try { tg.property("ADBE Anchor Point").setValue(poi); } catch (e3) {}
    }
    var co = _mcpTry(function () { return cam.property("ADBE Camera Options Group"); }, null);
    MCP.layers.setOption(co, ["ADBE Camera Zoom", "Zoom"], zoom);
    if (MCP.isDefined(args.depthOfField)) { MCP.layers.setOption(co, ["ADBE Camera Depth of Field", "Depth of Field"], MCP.bool(args.depthOfField, false) ? 1 : 0); }
    if (MCP.isDefined(args.focusDistance)) { MCP.layers.setOption(co, ["ADBE Camera Focus Distance", "Focus Distance"], Number(args.focusDistance)); }
    if (MCP.isDefined(args.aperture)) { MCP.layers.setOption(co, ["ADBE Camera Aperture", "Aperture"], Number(args.aperture)); }
    var placeArgs = MCP.extend({}, args);
    delete placeArgs.position;
    MCP.placeNewLayer(comp, cam, placeArgs);
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(cam),
        camera: {
            type: oneNode ? "one-node" : "two-node",
            zoom: MCP.round(MCP.layers.getOption(co, ["ADBE Camera Zoom", "Zoom"], zoom)),
            focalLengthMm: MCP.round(zoom * 36 / comp.width, 2),
            preset: MCP.isDefined(args.zoom) ? null : presetKey,
            position: MCP.roundValue(_mcpTry(function () { return tg.property("ADBE Position").value; }, pos)),
            pointOfInterest: poi ? MCP.roundValue(poi) : null,
            depthOfField: !!MCP.layers.getOption(co, ["ADBE Camera Depth of Field", "Depth of Field"], 0),
            focusDistance: MCP.layers.getOption(co, ["ADBE Camera Focus Distance", "Focus Distance"], null),
            aperture: MCP.layers.getOption(co, ["ADBE Camera Aperture", "Aperture"], null)
        }
    };
}, { mutating: true });

MCP.register("createLightLayer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var typeMap = { "parallel": "PARALLEL", "spot": "SPOT", "point": "POINT", "ambient": "AMBIENT" };
    var lt = String(MCP.arg(args, "lightType", "point")).toLowerCase();
    if (!typeMap[lt]) { MCP.fail("Unknown lightType '" + lt + "'. Use parallel, spot, point or ambient.", "invalid-argument"); }
    var name = MCP.arg(args, "name", "Light 1");
    var light = comp.layers.addLight(name, [comp.width / 2, comp.height / 2]);
    try { light.lightType = LightType[typeMap[lt]]; } catch (e1) {
        MCP.fail("Could not set light type '" + lt + "': " + String(e1.message || e1), "unsupported");
    }
    var tg = light.property("ADBE Transform Group");
    var skipped = [];
    var aimed = (lt === "spot" || lt === "parallel");
    if (lt !== "ambient") {
        var pos = MCP.isArray(args.position) ? args.position : [comp.width / 2, comp.height / 2, -500];
        if (pos.length < 3) { pos = [pos[0], pos[1], -500]; }
        try { tg.property("ADBE Position").setValue(pos); } catch (e2) {}
    } else if (MCP.isDefined(args.position)) {
        skipped.push({ field: "position", reason: "ambient lights have no position" });
    }
    var poi = null;
    if (aimed) {
        poi = MCP.isArray(args.pointOfInterest) ? args.pointOfInterest : [comp.width / 2, comp.height / 2, 0];
        try { tg.property("ADBE Anchor Point").setValue(poi); } catch (e3) {}
    } else if (MCP.isDefined(args.pointOfInterest)) {
        skipped.push({ field: "pointOfInterest", reason: "only spot and parallel lights have a point of interest" });
    }
    var lo = _mcpTry(function () { return light.property("ADBE Light Options Group"); }, null);
    if (MCP.isDefined(args.color)) {
        if (!MCP.layers.setOption(lo, ["ADBE Light Color", "Color"], MCP.color.rgb(args.color))) { skipped.push({ field: "color", reason: "Color property not found" }); }
    }
    if (MCP.isDefined(args.intensity)) {
        if (!MCP.layers.setOption(lo, ["ADBE Light Intensity", "Intensity"], Number(args.intensity))) { skipped.push({ field: "intensity", reason: "Intensity property not found" }); }
    }
    if (MCP.isDefined(args.coneAngle)) {
        if (lt !== "spot" || !MCP.layers.setOption(lo, ["ADBE Light Cone Angle", "Cone Angle"], Number(args.coneAngle))) { skipped.push({ field: "coneAngle", reason: "only spot lights have a cone" }); }
    }
    if (MCP.isDefined(args.coneFeather)) {
        if (lt !== "spot" || !MCP.layers.setOption(lo, ["ADBE Light Cone Feather 2", "ADBE Light Cone Feather", "Cone Feather"], Number(args.coneFeather))) { skipped.push({ field: "coneFeather", reason: "only spot lights have a cone" }); }
    }
    if (MCP.isDefined(args.castsShadows)) {
        // Casts Shadows is a tri-state property (off, on, only); 1 is on and 0 is off. Unverified against a real After Effects.
        if (lt === "ambient" || !MCP.layers.setOption(lo, ["ADBE Casts Shadows", "Casts Shadows"], MCP.bool(args.castsShadows, false) ? 1 : 0)) { skipped.push({ field: "castsShadows", reason: "ambient lights cast no shadows" }); }
    }
    if (MCP.isDefined(args.shadowDarkness)) {
        if (lt === "ambient" || !MCP.layers.setOption(lo, ["ADBE Light Shadow Darkness", "Shadow Darkness"], Number(args.shadowDarkness))) { skipped.push({ field: "shadowDarkness", reason: "ambient lights cast no shadows" }); }
    }
    var placeArgs = MCP.extend({}, args);
    delete placeArgs.position;
    MCP.placeNewLayer(comp, light, placeArgs);
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(light),
        light: {
            lightType: lt,
            position: MCP.roundValue(_mcpTry(function () { return tg.property("ADBE Position").value; }, null)),
            pointOfInterest: poi ? MCP.roundValue(poi) : null,
            color: MCP.color.toHex(MCP.layers.getOption(lo, ["ADBE Light Color", "Color"], [1, 1, 1])),
            intensity: MCP.layers.getOption(lo, ["ADBE Light Intensity", "Intensity"], null),
            coneAngle: lt === "spot" ? MCP.layers.getOption(lo, ["ADBE Light Cone Angle", "Cone Angle"], null) : null,
            coneFeather: lt === "spot" ? MCP.layers.getOption(lo, ["ADBE Light Cone Feather 2", "ADBE Light Cone Feather", "Cone Feather"], null) : null,
            castsShadows: !!MCP.layers.getOption(lo, ["ADBE Casts Shadows", "Casts Shadows"], 0),
            shadowDarkness: MCP.layers.getOption(lo, ["ADBE Light Shadow Darkness", "Shadow Darkness"], null)
        },
        skipped: skipped
    };
}, { mutating: true });

/* ------------------------------------------------------ add, delete */

MCP.register("addFootageToComposition", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var item = MCP.resolveItem(MCP.requireArg(args, "item"));
    if (item instanceof FolderItem) { MCP.fail("'" + item.name + "' is a folder; only footage and compositions can be added as layers.", "invalid-argument"); }
    if (item instanceof CompItem && item.id === comp.id) { MCP.fail("Composition '" + comp.name + "' cannot be added to itself.", "invalid-argument"); }
    var isStill = false;
    if (item instanceof FootageItem) {
        isStill = _mcpTry(function () { return !!item.mainSource.isStill; }, false) || _mcpTry(function () { return item.duration === 0; }, false);
    }
    var layer = isStill ? comp.layers.add(item, comp.duration) : comp.layers.add(item);
    var placeArgs = MCP.extend({}, args);
    if (!MCP.isDefined(placeArgs.startTime) && !MCP.isDefined(placeArgs.startFrame)) {
        if (MCP.isDefined(args.frame)) { placeArgs.startFrame = args.frame; }
        else if (MCP.isDefined(args.time)) { placeArgs.startTime = args.time; }
    }
    MCP.placeNewLayer(comp, layer, placeArgs);
    return { composition: MCP.serialize.compRef(comp), item: MCP.serialize.item(item), layer: MCP.serialize.layer(layer) };
}, { mutating: true });

MCP.register("addCompositionAsLayer", function (args, ctx) {
    var comp = MCP.resolveComp(args.comp);
    var src = args.sourceComp;
    if (!src || (!MCP.isDefined(src.id) && !MCP.isDefined(src.name))) {
        MCP.fail("sourceComp needs {id} or {name}. Available: " + MCP.describeComps(), "invalid-argument", { compositions: MCP.compList() });
    }
    var source = MCP.resolveComp(src);
    if (source.id === comp.id) { MCP.fail("Composition '" + comp.name + "' cannot be nested inside itself.", "invalid-argument"); }
    var inner = MCP.extend({}, args);
    delete inner.sourceComp;
    inner.item = { id: source.id };
    inner.comp = { id: comp.id };
    var res = MCP.invoke("addFootageToComposition", inner, ctx);
    res.sourceComp = MCP.serialize.compRef(source);
    return res;
}, { mutating: true });

MCP.register("deleteLayer", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var ref = MCP.serialize.layerRef(r.layer);
    r.layer.remove();
    return { composition: MCP.serialize.compRef(r.comp), removed: ref, remainingCount: r.comp.numLayers };
}, { mutating: true });

MCP.register("deleteLayers", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.resolveLayers(comp, MCP.requireArg(args, "layers"));
    var entries = [];
    var seen = {};
    for (var i = 0; i < layers.length; i++) {
        var idx = layers[i].index;
        if (seen[idx]) { continue; }
        seen[idx] = true;
        entries.push({ index: idx, ref: MCP.serialize.layerRef(layers[i]) });
    }
    entries.sort(function (a, b) { return b.index - a.index; });
    var removed = [];
    for (var k = 0; k < entries.length; k++) {
        comp.layer(entries[k].index).remove();
        removed.push(entries[k].ref);
    }
    return { composition: MCP.serialize.compRef(comp), removedCount: removed.length, removed: removed, remainingCount: comp.numLayers };
}, { mutating: true });

MCP.register("renameLayer", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var newName = String(MCP.requireArg(args, "newName"));
    var previous = r.layer.name;
    r.layer.name = newName;
    return { composition: MCP.serialize.compRef(r.comp), previousName: previous, layer: MCP.serialize.layer(r.layer) };
}, { mutating: true });

/* ----------------------------------------------------- order, parent */

MCP.register("moveLayer", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var previousIndex = layer.index;
    var n = comp.numLayers;
    if (MCP.isDefined(args.toIndex)) {
        var target = MCP.clamp(Math.round(Number(args.toIndex)), 1, n);
        if (target === 1) { layer.moveToBeginning(); }
        else if (target === n) { layer.moveToEnd(); }
        else if (target > layer.index) { layer.moveAfter(comp.layer(target)); }
        else if (target < layer.index) { layer.moveAfter(comp.layer(target - 1)); }
    } else if (MCP.isDefined(args.above)) {
        var refA = MCP.resolveLayer(comp, args.above);
        if (refA.index === layer.index) { MCP.fail("A layer cannot be moved above itself.", "invalid-argument"); }
        // Layer has no moveBefore(): put the layer under the reference, then the reference under the layer.
        layer.moveAfter(refA);
        refA.moveAfter(layer);
    } else if (MCP.isDefined(args.below)) {
        var refB = MCP.resolveLayer(comp, args.below);
        if (refB.index === layer.index) { MCP.fail("A layer cannot be moved below itself.", "invalid-argument"); }
        layer.moveAfter(refB);
    } else if (MCP.bool(args.toTop, false)) {
        layer.moveToBeginning();
    } else if (MCP.bool(args.toBottom, false)) {
        layer.moveToEnd();
    } else {
        MCP.fail("Give one of toIndex, above, below, toTop or toBottom.", "invalid-argument");
    }
    return {
        composition: MCP.serialize.compRef(comp),
        previousIndex: previousIndex,
        newIndex: layer.index,
        layer: MCP.serialize.layer(layer),
        order: MCP.layers.namesInOrder(comp)
    };
}, { mutating: true });

MCP.register("setLayerParent", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var parent = MCP.resolveLayer(comp, MCP.requireArg(args, "parent"));
    if (parent.index === layer.index) { MCP.fail("A layer cannot be its own parent.", "invalid-argument"); }
    var walk = parent, guard = 0;
    while (walk && guard++ < 500) {
        if (walk.index === layer.index) { MCP.fail("'" + parent.name + "' is already a child of '" + layer.name + "'; parenting would create a loop.", "invalid-argument"); }
        walk = _mcpTry(function () { return walk.parent; }, null);
    }
    var keep = MCP.bool(args.keepPosition, true);
    var method = "parent";
    var notes = [];
    if (keep) {
        layer.parent = parent;
    } else if (typeof layer.setParentWithJump === "function") {
        layer.setParentWithJump(parent);
        method = "setParentWithJump";
    } else {
        layer.parent = parent;
        notes.push("setParentWithJump is not available in this After Effects version; the child kept its on-screen position.");
    }
    return { composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layer(layer), parent: MCP.serialize.layerRef(parent), method: method, keepPosition: keep, notes: notes };
}, { mutating: true });

MCP.register("clearLayerParent", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prev = r.layer.parent ? { index: r.layer.parent.index, name: r.layer.parent.name } : null;
    if (prev) { r.layer.parent = null; }
    return { composition: MCP.serialize.compRef(r.comp), previousParent: prev, layer: MCP.serialize.layer(r.layer) };
}, { mutating: true });

/* ------------------------------------------------------------ switches */

MCP.layers.FLAGS = [
    ["enabled", "enabled"], ["solo", "solo"], ["shy", "shy"], ["locked", "locked"], ["guide", "guideLayer"],
    ["motionBlur", "motionBlur"], ["collapseTransformations", "collapseTransformation"], ["adjustmentLayer", "adjustmentLayer"],
    ["threeD", "threeDLayer"], ["audioEnabled", "audioEnabled"], ["effectsActive", "effectsActive"],
    ["timeRemapEnabled", "timeRemapEnabled"], ["preserveTransparency", "preserveTransparency"], ["environmentLayer", "environmentLayer"]
];

MCP.register("setLayerFlags", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer;
    var changed = [], skipped = [];
    for (var i = 0; i < MCP.layers.FLAGS.length; i++) {
        var key = MCP.layers.FLAGS[i][0], attr = MCP.layers.FLAGS[i][1];
        if (!MCP.isDefined(args[key])) { continue; }
        var current = _mcpTry(function () { return layer[attr]; }, undefined);
        if (current === undefined) { skipped.push({ flag: key, reason: attr + " is not available on this layer type" }); continue; }
        try {
            layer[attr] = MCP.bool(args[key], false);
            changed.push(key);
        } catch (e) {
            skipped.push({ flag: key, reason: String(e.message || e) });
        }
    }
    if (MCP.isDefined(args.frameBlending)) {
        var fbMap = { "none": "NO_FRAME_BLEND", "frame-mix": "FRAME_MIX", "pixel-motion": "PIXEL_MOTION" };
        var fbKey = String(args.frameBlending).toLowerCase();
        if (!fbMap[fbKey]) { MCP.fail("Unknown frameBlending '" + args.frameBlending + "'. Use none, frame-mix or pixel-motion.", "invalid-argument"); }
        try {
            layer.frameBlendingType = FrameBlendingType[fbMap[fbKey]];
            changed.push("frameBlending");
        } catch (e2) {
            skipped.push({ flag: "frameBlending", reason: String(e2.message || e2) });
        }
    }
    if (!changed.length && !skipped.length) { MCP.fail("No flags given. Pass at least one of: enabled, solo, shy, locked, guide, motionBlur, collapseTransformations, adjustmentLayer, threeD, audioEnabled, effectsActive, frameBlending, timeRemapEnabled, preserveTransparency, environmentLayer.", "invalid-argument"); }
    var flags = {};
    for (var f = 0; f < MCP.layers.FLAGS.length; f++) {
        flags[MCP.layers.FLAGS[f][0]] = _mcpTry(function () { var v = layer[MCP.layers.FLAGS[f][1]]; return v === undefined ? null : !!v; }, null);
    }
    flags.frameBlending = _mcpTry(function () { return MCP.layers.frameBlendingName(layer.frameBlendingType); }, null);
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layer(layer), changed: changed, skipped: skipped, flags: flags };
}, { mutating: true });

MCP.register("setLayerBlendMode", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var mode = MCP.enums.blendModeValue(MCP.requireArg(args, "blendMode"));
    var previous = _mcpTry(function () { return MCP.enums.blendModeName(r.layer.blendingMode); }, null);
    if (previous === null) { MCP.fail("Layer '" + r.layer.name + "' has no blend mode (cameras and lights do not blend).", "unsupported"); }
    r.layer.blendingMode = mode;
    return { composition: MCP.serialize.compRef(r.comp), previousBlendMode: previous, blendMode: MCP.enums.blendModeName(r.layer.blendingMode), layer: MCP.serialize.layer(r.layer) };
}, { mutating: true });

MCP.register("setLayerLabelColor", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.layers.targets(comp, args);
    var idx = MCP.enums.labelIndex(MCP.requireArg(args, "label"));
    var out = [];
    for (var i = 0; i < layers.length; i++) {
        layers[i].label = idx;
        out.push({ index: layers[i].index, name: layers[i].name, label: MCP.enums.LABELS[layers[i].label] || layers[i].label });
    }
    return { composition: MCP.serialize.compRef(comp), label: MCP.enums.LABELS[idx], labelIndex: idx, count: out.length, layers: out };
}, { mutating: true });

MCP.register("setLayerTrackMatte", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var type = String(MCP.requireArg(args, "type")).toLowerCase();
    var method, moved = false, matte = null;
    if (type === "none") {
        if (typeof layer.removeTrackMatte === "function") {
            layer.removeTrackMatte();
            method = "removeTrackMatte";
        } else {
            layer.trackMatteType = TrackMatteType.NO_TRACK_MATTE;
            method = "trackMatteType";
        }
    } else {
        var value = MCP.enums.trackMatteValue(type);
        matte = MCP.resolveLayer(comp, MCP.requireArg(args, "matteLayer"));
        if (matte.index === layer.index) { MCP.fail("A layer cannot be its own track matte.", "invalid-argument"); }
        if (MCP.aeVersion() >= 23 && typeof layer.setTrackMatte === "function") {
            layer.setTrackMatte(matte, value);
            method = "setTrackMatte";
        } else {
            if (matte.index !== layer.index - 1) {
                // Older versions need the matte directly above. Layer has no moveBefore(): two-step move.
                matte.moveAfter(layer);
                layer.moveAfter(matte);
                moved = true;
            }
            layer.trackMatteType = value;
            method = "trackMatteType";
        }
    }
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(layer),
        matte: matte ? MCP.serialize.layerRef(matte) : null,
        type: type,
        method: method,
        movedMatte: moved,
        aeVersion: MCP.aeVersion()
    };
}, { mutating: true });

MCP.register("setLayerQuality", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var map = { "draft": "DRAFT", "best": "BEST", "wireframe": "WIREFRAME" };
    var key = String(MCP.requireArg(args, "quality")).toLowerCase();
    if (!map[key]) { MCP.fail("Unknown quality '" + args.quality + "'. Use draft, best or wireframe.", "invalid-argument"); }
    var previous = _mcpTry(function () { return MCP.layers.qualityName(r.layer.quality); }, null);
    try {
        r.layer.quality = LayerQuality[map[key]];
    } catch (e) {
        MCP.fail("Cannot set quality on '" + r.layer.name + "': " + String(e.message || e), "unsupported");
    }
    return { composition: MCP.serialize.compRef(r.comp), previousQuality: previous, quality: MCP.layers.qualityName(r.layer.quality), layer: MCP.serialize.layer(r.layer) };
}, { mutating: true });

/* ------------------------------------------------- split, align, space */

MCP.register("splitLayerAtTime", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var t = MCP.timeArg(comp, args);
    if (t <= layer.inPoint || t >= layer.outPoint) {
        MCP.fail("Split time " + MCP.round(t) + "s (frame " + MCP.frameOf(comp, t) + ") must be inside the layer's in point " + MCP.round(layer.inPoint) + "s and out point " + MCP.round(layer.outPoint) + "s.", "invalid-argument");
    }
    var dup = layer.duplicate();
    layer.outPoint = t;
    dup.inPoint = t;
    if (!MCP.bool(args.keepNames, false)) {
        var suffixes = MCP.isArray(args.suffixes) && args.suffixes.length >= 2 ? args.suffixes : [" 1", " 2"];
        var base = layer.name;
        layer.name = base + String(suffixes[0]);
        dup.name = base + String(suffixes[1]);
    }
    return {
        composition: MCP.serialize.compRef(comp),
        splitTime: MCP.round(t),
        splitFrame: MCP.frameOf(comp, t),
        before: MCP.serialize.layer(layer),
        after: MCP.serialize.layer(dup)
    };
}, { mutating: true });

/** Bounds for a list of layers; layers without bounds are skipped with a note. */
MCP.layers.boundsFor = function (layers, t) {
    var items = [], notes = [];
    for (var i = 0; i < layers.length; i++) {
        var b = null;
        try { b = MCP.transform.bounds(layers[i], t); } catch (e) {
            notes.push("Skipped '" + layers[i].name + "': " + String(e.message || e));
            continue;
        }
        for (var n = 0; n < b.notes.length; n++) { notes.push(b.notes[n]); }
        items.push({ layer: layers[i], bounds: b.bounds });
    }
    return { items: items, notes: notes };
};

MCP.layers.shiftPosition = function (layer, dx, dy, t) {
    var pp = MCP.transform.prop(layer, "ADBE Position");
    var cur = pp.value;
    var next = cur.slice(0);
    next[0] = cur[0] + dx;
    next[1] = cur[1] + dy;
    MCP.transform.writePosition(layer, next, t, false, null);
    return MCP.roundValue(pp.value);
};

MCP.register("alignLayers", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.resolveLayers(comp, MCP.requireArg(args, "layers"));
    var h = MCP.isDefined(args.horizontal) ? String(args.horizontal).toLowerCase() : null;
    var v = MCP.isDefined(args.vertical) ? String(args.vertical).toLowerCase() : null;
    if (!h && !v) { MCP.fail("Give horizontal (left, center, right) and/or vertical (top, center, bottom).", "invalid-argument"); }
    var t = comp.time;
    var found = MCP.layers.boundsFor(layers, t);
    if (!found.items.length) { MCP.fail("None of the layers has visible bounds. " + found.notes.join(" "), "unsupported"); }
    var relativeTo = String(MCP.arg(args, "relativeTo", "comp")).toLowerCase();
    var target;
    if (relativeTo === "selection") {
        target = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        for (var s = 0; s < found.items.length; s++) {
            var bb0 = found.items[s].bounds;
            if (bb0.left < target.left) { target.left = bb0.left; }
            if (bb0.top < target.top) { target.top = bb0.top; }
            if (bb0.right > target.right) { target.right = bb0.right; }
            if (bb0.bottom > target.bottom) { target.bottom = bb0.bottom; }
        }
    } else {
        target = { left: 0, top: 0, right: comp.width, bottom: comp.height };
    }
    var out = [];
    for (var i = 0; i < found.items.length; i++) {
        var L = found.items[i].layer, bb = found.items[i].bounds;
        var dx = 0, dy = 0;
        if (h === "left") { dx = target.left - bb.left; }
        else if (h === "center") { dx = (target.left + target.right) / 2 - (bb.left + bb.right) / 2; }
        else if (h === "right") { dx = target.right - bb.right; }
        if (v === "top") { dy = target.top - bb.top; }
        else if (v === "center") { dy = (target.top + target.bottom) / 2 - (bb.top + bb.bottom) / 2; }
        else if (v === "bottom") { dy = target.bottom - bb.bottom; }
        var pos = MCP.layers.shiftPosition(L, dx, dy, t);
        out.push({ index: L.index, name: L.name, bounds: bb, delta: [MCP.round(dx), MCP.round(dy)], position: pos });
    }
    return {
        composition: MCP.serialize.compRef(comp),
        relativeTo: relativeTo,
        horizontal: h,
        vertical: v,
        target: MCP.roundValue(target),
        count: out.length,
        layers: out,
        notes: found.notes
    };
}, { mutating: true });

MCP.register("distributeLayers", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.resolveLayers(comp, MCP.requireArg(args, "layers"));
    var axis = String(MCP.requireArg(args, "axis")).toLowerCase();
    if (axis !== "horizontal" && axis !== "vertical") { MCP.fail("axis must be horizontal or vertical.", "invalid-argument"); }
    var mode = String(MCP.arg(args, "mode", "centers")).toLowerCase();
    if (mode !== "centers" && mode !== "spacing") { MCP.fail("mode must be centers or spacing.", "invalid-argument"); }
    var gap = MCP.num(args.gap, 0);
    var t = comp.time;
    var found = MCP.layers.boundsFor(layers, t);
    var items = found.items;
    var horizontal = axis === "horizontal";
    for (var k = 0; k < items.length; k++) {
        var b = items[k].bounds;
        items[k].min = horizontal ? b.left : b.top;
        items[k].max = horizontal ? b.right : b.bottom;
        items[k].size = items[k].max - items[k].min;
        items[k].center = (items[k].min + items[k].max) / 2;
    }
    if (mode === "centers" && items.length < 3) { MCP.fail("mode 'centers' needs at least three layers with bounds (got " + items.length + "); the first and last stay where they are.", "invalid-argument"); }
    if (mode === "spacing" && items.length < 2) { MCP.fail("mode 'spacing' needs at least two layers with bounds (got " + items.length + ").", "invalid-argument"); }
    items.sort(function (a, b) { return mode === "centers" ? a.center - b.center : a.min - b.min; });
    var out = [];
    var n = items.length;
    var first = items[0].center, last = items[n - 1].center;
    var step = n > 1 ? (last - first) / (n - 1) : 0;
    var cursor = items[0].min;
    for (var i = 0; i < n; i++) {
        var delta = 0;
        if (mode === "centers") {
            delta = (first + step * i) - items[i].center;
        } else {
            if (i > 0) { cursor += items[i - 1].size + gap; }
            delta = cursor - items[i].min;
        }
        var pos = MCP.layers.shiftPosition(items[i].layer, horizontal ? delta : 0, horizontal ? 0 : delta, t);
        out.push({ index: items[i].layer.index, name: items[i].layer.name, delta: MCP.round(delta), position: pos });
    }
    return { composition: MCP.serialize.compRef(comp), axis: axis, mode: mode, gap: gap, count: out.length, layers: out, notes: found.notes };
}, { mutating: true });

MCP.register("sequenceLayers", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.resolveLayers(comp, MCP.requireArg(args, "layers"));
    if (!layers.length) { MCP.fail("No layers to sequence.", "invalid-argument"); }
    var interval = MCP.durationArg(comp, args, "interval", "intervalFrames", null);
    var overlap = Math.max(0, MCP.durationArg(comp, args, "overlap", "overlapFrames", 0));
    var start = (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) ? MCP.timeArg(comp, args) : layers[0].inPoint;
    var crossfade = MCP.bool(args.crossfade, false);
    var easing = MCP.arg(args, "easing", "ease");
    var out = [];
    var prevIn = null, prevDur = null;
    var n = layers.length;
    for (var i = 0; i < n; i++) {
        var L = layers[i];
        var dur = L.outPoint - L.inPoint;
        var targetIn = (i === 0) ? start : prevIn + (interval !== null ? interval : prevDur) - overlap;
        L.startTime = L.startTime + (targetIn - L.inPoint);
        prevIn = L.inPoint;
        prevDur = L.outPoint - L.inPoint;
        var keys = 0;
        if (crossfade && overlap > 0) {
            var op = MCP.transform.prop(L, "ADBE Opacity");
            if (op) {
                var fade = Math.min(overlap, dur);
                if (i > 0) {
                    MCP.easing.setKey(op, L.inPoint, 0);
                    var kIn = MCP.easing.setKey(op, L.inPoint + fade, 100);
                    MCP.easing.applySegment(op, kIn, easing);
                    keys += 2;
                }
                if (i < n - 1) {
                    MCP.easing.setKey(op, L.outPoint - fade, 100);
                    var kOut = MCP.easing.setKey(op, L.outPoint, 0);
                    MCP.easing.applySegment(op, kOut, easing);
                    keys += 2;
                }
            }
        }
        out.push({
            index: L.index, name: L.name,
            startTime: MCP.round(L.startTime), inPoint: MCP.round(L.inPoint), outPoint: MCP.round(L.outPoint),
            inFrame: MCP.frameOf(comp, L.inPoint), outFrame: MCP.frameOf(comp, L.outPoint),
            crossfadeKeys: keys
        });
    }
    return {
        composition: MCP.serialize.compRef(comp),
        count: out.length,
        start: MCP.round(start),
        interval: interval === null ? null : MCP.round(interval),
        overlap: MCP.round(overlap),
        crossfade: crossfade,
        layers: out
    };
}, { mutating: true });

/* ----------------------------------------------------------- selection */

MCP.register("selectLayers", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var spec = MCP.requireArg(args, "layers");
    var add = MCP.bool(args.add, false);
    if (!MCP.isArray(spec) && spec && spec.none) {
        MCP.layers.deselectAll(comp);
    } else {
        var targets = (!MCP.isArray(spec) && spec && spec.all) ? MCP.resolveLayers(comp, { all: true }) : MCP.resolveLayers(comp, spec);
        if (!add) { MCP.layers.deselectAll(comp); }
        for (var i = 0; i < targets.length; i++) { targets[i].selected = true; }
    }
    var sel = comp.selectedLayers || [];
    var out = [];
    for (var s = 0; s < sel.length; s++) { out.push(MCP.serialize.layerRef(sel[s])); }
    return { composition: MCP.serialize.compRef(comp), selectedCount: out.length, selected: out };
}, { mutating: false });

MCP.register("getSelectedLayers", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var sel = comp.selectedLayers || [];
    var out = [];
    for (var i = 0; i < sel.length; i++) { out.push(MCP.serialize.layer(sel[i], { keyframes: MCP.bool(args.includeKeyframes, false) })); }
    return { composition: MCP.serialize.compRef(comp), count: out.length, layers: out };
}, { mutating: false });
