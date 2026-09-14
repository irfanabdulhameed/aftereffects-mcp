/*
 * Composition commands.
 */

MCP.COMP_PRESETS = {
    "1080p30":  { width: 1920, height: 1080, frameRate: 30 },
    "1080p25":  { width: 1920, height: 1080, frameRate: 25 },
    "1080p24":  { width: 1920, height: 1080, frameRate: 24 },
    "1080p60":  { width: 1920, height: 1080, frameRate: 60 },
    "4k30":     { width: 3840, height: 2160, frameRate: 30 },
    "4k25":     { width: 3840, height: 2160, frameRate: 25 },
    "4k24":     { width: 3840, height: 2160, frameRate: 24 },
    "4k60":     { width: 3840, height: 2160, frameRate: 60 },
    "720p30":   { width: 1280, height: 720, frameRate: 30 },
    "square1080": { width: 1080, height: 1080, frameRate: 30 },
    "vertical1080": { width: 1080, height: 1920, frameRate: 30 },
    "motion-graphics-template": { width: 1920, height: 1080, frameRate: 29.97 }
};

MCP.register("createComposition", function (args) {
    var preset = MCP.isDefined(args.preset) ? MCP.COMP_PRESETS[String(args.preset)] : null;
    if (MCP.isDefined(args.preset) && !preset) {
        MCP.fail("Unknown composition preset '" + args.preset + "'. Use one of: " + MCP.keys(MCP.COMP_PRESETS).join(", "), "invalid-argument");
    }
    var name = MCP.arg(args, "name", "New Composition");
    var width = Math.round(MCP.num(args.width, preset ? preset.width : 1920));
    var height = Math.round(MCP.num(args.height, preset ? preset.height : 1080));
    var frameRate = MCP.num(args.frameRate, preset ? preset.frameRate : 30);
    var pixelAspect = MCP.num(args.pixelAspect, 1);
    var duration;
    if (MCP.isDefined(args.durationFrames)) { duration = Number(args.durationFrames) / frameRate; }
    else { duration = MCP.num(args.duration, 10); }
    if (width < 4 || height < 4) { MCP.fail("Composition size must be at least 4 x 4 pixels.", "invalid-argument"); }
    if (duration <= 0) { MCP.fail("Composition duration must be greater than 0.", "invalid-argument"); }

    var folder = null;
    if (MCP.isDefined(args.folder)) { folder = MCP.resolveItem(args.folder, "folder"); }
    var comp = app.project.items.addComp(name, width, height, pixelAspect, duration, frameRate);
    if (folder) { comp.parentFolder = folder; }
    if (MCP.isDefined(args.backgroundColor)) { comp.bgColor = MCP.color.rgb(args.backgroundColor); }
    if (MCP.isDefined(args.motionBlur)) { comp.motionBlur = MCP.bool(args.motionBlur, false); }
    if (MCP.bool(args.openInViewer, true)) { try { comp.openInViewer(); } catch (e) {} }
    return { composition: MCP.serialize.comp(comp), preset: preset ? args.preset : null };
}, { mutating: true });

MCP.register("listCompositions", function (args) {
    var includeUsage = MCP.bool(args.includeUsage, true);
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!(item instanceof CompItem)) { continue; }
        var s = MCP.serialize.comp(item);
        s.itemIndex = i;
        if (includeUsage) { s.usedInCount = _mcpTry(function () { return item.usedIn.length; }, null); }
        out.push(s);
    }
    var active = MCP.activeComp();
    return { count: out.length, activeComp: active ? { id: active.id, name: active.name } : null, compositions: out };
}, { mutating: false });

MCP.register("getCompositionInfo", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var out = MCP.serialize.comp(comp);
    var layers = [];
    var nested = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        layers.push({ index: i, id: _mcpTry(function () { return L.id; }, null), name: L.name, type: MCP.layerType(L), enabled: L.enabled, inPoint: MCP.round(L.inPoint), outPoint: MCP.round(L.outPoint) });
        var src = _mcpTry(function () { return L.source; }, null);
        if (src instanceof CompItem) { nested.push({ layerIndex: i, compId: src.id, compName: src.name }); }
    }
    out.layers = layers;
    out.nestedCompositions = nested;
    out.usedInCount = _mcpTry(function () { return comp.usedIn.length; }, null);
    out.markers = _mcpTry(function () {
        var mp = comp.markerProperty, arr = [];
        for (var k = 1; k <= mp.numKeys; k++) { var mv = MCP.serialize.marker(mp.keyValue(k)); mv.time = MCP.round(mp.keyTime(k)); arr.push(mv); }
        return arr;
    }, []);
    return out;
}, { mutating: false });

/* ------------------------------------------------------------ helpers */

MCP.composition = MCP.composition || {};

/** serialize.comp plus the settings that set-composition-settings can change. */
MCP.composition.summary = function (comp) {
    var out = MCP.serialize.comp(comp);
    out.motionBlurAdaptiveSampleLimit = _mcpTry(function () { return comp.motionBlurAdaptiveSampleLimit; }, null);
    out.preserveNestedFrameRate = _mcpTry(function () { return comp.preserveNestedFrameRate; }, null);
    out.preserveNestedResolution = _mcpTry(function () { return comp.preserveNestedResolution; }, null);
    out.displayStartFrame = _mcpTry(function () { return Math.round(comp.displayStartTime / comp.frameDuration); }, null);
    out.workAreaEnd = MCP.round(comp.workAreaStart + comp.workAreaDuration);
    out.usedInCount = _mcpTry(function () { return comp.usedIn.length; }, null);
    return out;
};

MCP.composition.workArea = function (comp) {
    var start = comp.workAreaStart, dur = comp.workAreaDuration;
    return {
        composition: MCP.serialize.compRef(comp),
        workAreaStart: MCP.round(start),
        workAreaEnd: MCP.round(start + dur),
        workAreaDuration: MCP.round(dur),
        workAreaStartFrame: MCP.frameOf(comp, start),
        workAreaEndFrame: MCP.frameOf(comp, start + dur),
        workAreaDurationFrames: MCP.frameOf(comp, dur),
        compDuration: MCP.round(comp.duration)
    };
};

/** Finds the layer in comp whose source is the given item. */
MCP.composition.layerWithSource = function (comp, item) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        var src = _mcpTry(function () { return L.source; }, null);
        if (src && src.id === item.id) { return L; }
    }
    return null;
};

/** Axis-aligned bounds of a layer in comp pixels at time t, ignoring rotation and parenting. Best effort. */
MCP.composition.layerBounds = function (layer, t) {
    var rect = layer.sourceRectAtTime(t, false);
    var tg = layer.property("ADBE Transform Group");
    var pos = tg.property("ADBE Position").valueAtTime(t, false);
    var anchor = tg.property("ADBE Anchor Point").valueAtTime(t, false);
    var scale = tg.property("ADBE Scale").valueAtTime(t, false);
    var sx = scale[0] / 100, sy = scale[1] / 100;
    var left = pos[0] + (rect.left - anchor[0]) * sx;
    var top = pos[1] + (rect.top - anchor[1]) * sy;
    var right = left + rect.width * sx;
    var bottom = top + rect.height * sy;
    return {
        x: Math.min(left, right),
        y: Math.min(top, bottom),
        width: Math.abs(right - left),
        height: Math.abs(bottom - top)
    };
};

/** Subtracts [dx, dy] from a position-like property, on its value or on every keyframe. Returns the number of keys touched. */
MCP.composition.offsetProperty = function (prop, dx, dy) {
    var k, v;
    if (prop.numKeys > 0) {
        for (k = 1; k <= prop.numKeys; k++) {
            v = prop.keyValue(k);
            if (MCP.isArray(v)) {
                v = v.slice(0);
                v[0] -= dx;
                if (v.length > 1) { v[1] -= dy; }
            } else {
                v = v - dx;
            }
            prop.setValueAtKey(k, v);
        }
        return prop.numKeys;
    }
    v = prop.value;
    if (MCP.isArray(v)) {
        v = v.slice(0);
        v[0] -= dx;
        if (v.length > 1) { v[1] -= dy; }
    } else {
        v = v - dx;
    }
    prop.setValue(v);
    return 0;
};

/* ----------------------------------------------------------- commands */

MCP.register("setCompositionSettings", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var changed = [];
    function apply(name, fn) {
        if (!MCP.isDefined(args[name])) { return; }
        try { fn(args[name]); } catch (e) {
            MCP.fail("Could not set " + name + " on '" + comp.name + "': " + e.message, "invalid-argument", { changed: changed });
        }
        changed.push(name);
    }
    apply("name", function (v) { comp.name = String(v); });
    apply("width", function (v) { comp.width = Math.round(Number(v)); });
    apply("height", function (v) { comp.height = Math.round(Number(v)); });
    apply("pixelAspect", function (v) { comp.pixelAspect = Number(v); });
    apply("frameRate", function (v) { comp.frameRate = Number(v); });
    if (MCP.isDefined(args.durationFrames)) {
        apply("durationFrames", function (v) { comp.duration = Number(v) * comp.frameDuration; });
    } else {
        apply("duration", function (v) { comp.duration = Number(v); });
    }
    apply("bgColor", function (v) { comp.bgColor = MCP.color.rgb(v); });
    apply("motionBlur", function (v) { comp.motionBlur = MCP.bool(v, false); });
    apply("shutterAngle", function (v) { comp.shutterAngle = Math.round(Number(v)); });
    apply("shutterPhase", function (v) { comp.shutterPhase = Math.round(Number(v)); });
    apply("motionBlurSamplesPerFrame", function (v) { comp.motionBlurSamplesPerFrame = Math.round(Number(v)); });
    apply("motionBlurAdaptiveSampleLimit", function (v) { comp.motionBlurAdaptiveSampleLimit = Math.round(Number(v)); });
    apply("resolutionFactor", function (v) {
        if (!MCP.isArray(v) || v.length !== 2) { throw new Error("resolutionFactor must be [x, y]"); }
        comp.resolutionFactor = [Math.round(Number(v[0])), Math.round(Number(v[1]))];
    });
    if (MCP.isDefined(args.displayStartFrame)) {
        apply("displayStartFrame", function (v) { comp.displayStartTime = Number(v) * comp.frameDuration; });
    } else {
        apply("displayStartTime", function (v) { comp.displayStartTime = Number(v); });
    }
    apply("hideShyLayers", function (v) { comp.hideShyLayers = MCP.bool(v, false); });
    apply("preserveNestedFrameRate", function (v) { comp.preserveNestedFrameRate = MCP.bool(v, false); });
    apply("preserveNestedResolution", function (v) { comp.preserveNestedResolution = MCP.bool(v, false); });
    return { composition: MCP.composition.summary(comp), changed: changed };
}, { mutating: true });

MCP.register("duplicateComposition", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var dup = comp.duplicate();
    if (MCP.isDefined(args.newName)) { dup.name = String(args.newName); }
    if (MCP.bool(args.openInViewer, false)) { try { dup.openInViewer(); } catch (e) {} }
    return { source: MCP.serialize.compRef(comp), composition: MCP.composition.summary(dup) };
}, { mutating: true });

MCP.register("renameComposition", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var newName = String(MCP.requireArg(args, "newName"));
    var previous = comp.name;
    comp.name = newName;
    return { composition: MCP.composition.summary(comp), previousName: previous };
}, { mutating: true });

MCP.register("deleteComposition", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var usage = MCP.project.usageOf(comp);
    var force = MCP.bool(args.force, false);
    if (usage.length && !force) {
        MCP.fail("Refusing to delete '" + comp.name + "' because " + usage.length + " composition(s) nest it: " + MCP.project.namesOf(usage) + ". Their layers would disappear. Pass force: true to delete it anyway.", "invalid-argument", { usedIn: usage });
    }
    var removed = { id: comp.id, name: comp.name };
    var numLayers = comp.numLayers;
    comp.remove();
    return { removed: removed, usedInCount: usage.length, usedIn: usage, numLayers: numLayers, forced: force && usage.length > 0 };
}, { mutating: true });

MCP.register("setWorkArea", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var fd = MCP.frameDuration(comp);
    var start = MCP.durationArg(comp, args, "start", "startFrame", comp.workAreaStart);
    var end;
    if (MCP.isDefined(args.end) || MCP.isDefined(args.endFrame)) {
        end = MCP.durationArg(comp, args, "end", "endFrame", null);
    } else if (MCP.isDefined(args.duration) || MCP.isDefined(args.durationFrames)) {
        end = start + MCP.durationArg(comp, args, "duration", "durationFrames", comp.workAreaDuration);
    } else {
        end = comp.workAreaStart + comp.workAreaDuration;
    }
    start = MCP.clamp(MCP.snapToFrame(comp, start), 0, Math.max(0, comp.duration - fd));
    end = MCP.clamp(MCP.snapToFrame(comp, end), start + fd, comp.duration);
    if (end - start < fd * 0.5) { MCP.fail("The work area must be at least one frame long.", "invalid-argument"); }
    comp.workAreaStart = start;
    comp.workAreaDuration = end - start;
    return MCP.composition.workArea(comp);
}, { mutating: true });

MCP.register("setCurrentTime", function (args) {
    var comp = MCP.resolveComp(args.comp);
    if (!MCP.isDefined(args.time) && !MCP.isDefined(args.frame)) {
        MCP.fail("Pass time (seconds) or frame.", "invalid-argument");
    }
    var t = MCP.timeArg(comp, args);
    t = MCP.clamp(MCP.snapToFrame(comp, t), 0, Math.max(0, comp.duration - MCP.frameDuration(comp)));
    comp.time = t;
    return { composition: MCP.serialize.compRef(comp), time: MCP.round(comp.time), frame: MCP.frameOf(comp, comp.time), duration: MCP.round(comp.duration) };
}, { mutating: true });

MCP.register("precompose", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.resolveLayers(comp, MCP.requireArg(args, "layers"));
    var name = String(MCP.requireArg(args, "name"));
    var moveAll = MCP.bool(args.moveAllAttributes, true);
    if (!layers.length) { MCP.fail("No layers to precompose.", "invalid-argument"); }
    if (!moveAll && layers.length > 1) {
        MCP.fail("moveAllAttributes: false is only allowed for a single layer in After Effects. Precompose one layer, or set moveAllAttributes true.", "invalid-argument");
    }
    var indices = [], sources = [];
    var minIn = null, maxOut = null;
    for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        if (L.locked) { MCP.fail("Layer " + L.index + " '" + L.name + "' is locked. Unlock it with set-layer-flags first.", "invalid-argument"); }
        indices.push(L.index);
        sources.push(MCP.serialize.layerRef(L));
        if (minIn === null || L.inPoint < minIn) { minIn = L.inPoint; }
        if (maxOut === null || L.outPoint > maxOut) { maxOut = L.outPoint; }
    }
    var newComp;
    try { newComp = comp.layers.precompose(indices, name, moveAll); } catch (e) {
        MCP.fail("precompose failed: " + e.message, "script-error");
    }
    var newLayer = MCP.composition.layerWithSource(comp, newComp);
    if (!newLayer) { MCP.fail("Precomposed, but the new layer could not be found in '" + comp.name + "'.", "script-error"); }
    var trimmed = false;
    if (MCP.bool(args.trimToLayers, false) && minIn !== null) {
        var fd = MCP.frameDuration(comp);
        var start = MCP.clamp(MCP.snapToFrame(comp, minIn), 0, comp.duration);
        var end = MCP.clamp(MCP.snapToFrame(comp, maxOut), start + fd, comp.duration);
        if (end < newComp.duration) { newComp.duration = end; }
        newLayer.inPoint = start;
        newLayer.outPoint = end;
        trimmed = true;
    }
    return {
        composition: MCP.serialize.compRef(comp),
        precomp: MCP.composition.summary(newComp),
        layer: MCP.serialize.layer(newLayer),
        sourceLayers: sources,
        moveAllAttributes: moveAll,
        trimmed: trimmed
    };
}, { mutating: true });

MCP.register("openCompositionInViewer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    try { comp.openInViewer(); } catch (e) { MCP.fail("openInViewer failed for '" + comp.name + "': " + e.message, "script-error"); }
    var active = MCP.activeComp();
    return { composition: MCP.serialize.compRef(comp), active: !!(active && active.id === comp.id) };
}, { mutating: false });

MCP.register("cropCompositionToRegion", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var region = null;
    var pad = Math.max(0, MCP.num(args.padding, 0));
    if (MCP.isDefined(args.region)) {
        region = { x: Number(args.region.x), y: Number(args.region.y), width: Number(args.region.width), height: Number(args.region.height) };
    } else if (MCP.isDefined(args.fromLayer)) {
        var src = MCP.resolveLayer(comp, args.fromLayer);
        var b;
        try { b = MCP.composition.layerBounds(src, comp.time); } catch (e1) {
            MCP.fail("Could not measure layer " + src.index + " '" + src.name + "': " + e1.message + ". Pass region {x, y, width, height} instead.", "invalid-argument");
        }
        region = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
    } else {
        MCP.fail("Pass region {x, y, width, height} or fromLayer.", "invalid-argument");
    }
    var width = Math.max(4, Math.round(region.width));
    var height = Math.max(4, Math.round(region.height));
    var dx = Math.round(region.x), dy = Math.round(region.y);
    var moved = [], skipped = [];
    var i, L;
    for (i = 1; i <= comp.numLayers; i++) {
        L = comp.layer(i);
        var ref = MCP.serialize.layerRef(L);
        if (L.parent) { skipped.push(MCP.extend(ref, { reason: "parented; it follows its parent" })); continue; }
        if (L instanceof CameraLayer || L instanceof LightLayer) { skipped.push(MCP.extend(ref, { reason: "camera or light; comp space for 3D is unchanged" })); continue; }
        var tg = _mcpTry(function () { return L.property("ADBE Transform Group"); }, null);
        if (!tg) { skipped.push(MCP.extend(ref, { reason: "no transform group" })); continue; }
        var pos = tg.property("ADBE Position");
        var keys = 0;
        try {
            if (_mcpTry(function () { return pos.dimensionsSeparated; }, false)) {
                keys += MCP.composition.offsetProperty(tg.property("ADBE Position_0"), dx, 0);
                keys += MCP.composition.offsetProperty(tg.property("ADBE Position_1"), dy, 0);
            } else {
                keys = MCP.composition.offsetProperty(pos, dx, dy);
            }
        } catch (e2) {
            skipped.push(MCP.extend(ref, { reason: "position could not be changed: " + e2.message }));
            continue;
        }
        var entry = MCP.extend(ref, { keyframesOffset: keys });
        entry.hasPositionExpression = _mcpTry(function () { return pos.expressionEnabled && pos.expression !== ""; }, false);
        moved.push(entry);
    }
    comp.width = width;
    comp.height = height;
    return {
        composition: MCP.composition.summary(comp),
        region: { x: dx, y: dy, width: width, height: height },
        movedLayers: moved.length,
        moved: moved,
        skippedLayers: skipped
    };
}, { mutating: true });
