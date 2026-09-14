/*
 * Markers and audio.
 */

MCP.markerFromSpec = function (spec) {
    var mv = new MarkerValue(MCP.isDefined(spec.comment) ? String(spec.comment) : "");
    mv.duration = MCP.num(spec.duration, 0);
    if (MCP.isDefined(spec.chapter)) { mv.chapter = String(spec.chapter); }
    if (MCP.isDefined(spec.url)) { mv.url = String(spec.url); }
    if (MCP.isDefined(spec.frameTarget)) { mv.frameTarget = String(spec.frameTarget); }
    if (MCP.isDefined(spec.cuePointName)) { mv.cuePointName = String(spec.cuePointName); }
    if (MCP.isDefined(spec.label)) { try { mv.label = MCP.enums.labelIndex(spec.label); } catch (e) {} }
    if (MCP.isDefined(spec.protectedRegion)) { try { mv.protectedRegion = MCP.bool(spec.protectedRegion, false); } catch (e2) {} }
    if (MCP.isDefined(spec.params) && typeof spec.params === "object") { try { mv.setParameters(spec.params); } catch (e3) {} }
    return mv;
};

MCP.markerTarget = function (args) {
    var comp = MCP.resolveComp(args.comp);
    var target = MCP.arg(args, "target", MCP.isDefined(args.layer) ? "layer" : "comp");
    if (target === "comp") {
        return { comp: comp, layer: null, prop: comp.markerProperty };
    }
    var layer = MCP.resolveLayer(comp, args.layer);
    var prop = layer.property("ADBE Marker");
    if (!prop) { MCP.fail("Layer '" + layer.name + "' does not support markers.", "unsupported"); }
    return { comp: comp, layer: layer, prop: prop };
};

MCP.markerList = function (comp, prop) {
    var out = [];
    for (var k = 1; k <= prop.numKeys; k++) {
        var mv = MCP.serialize.marker(prop.keyValue(k));
        mv.index = k;
        mv.time = MCP.round(prop.keyTime(k));
        mv.frame = MCP.frameOf(comp, prop.keyTime(k));
        out.push(mv);
    }
    return out;
};

MCP.register("addMarker", function (args) {
    var t = MCP.markerTarget(args);
    var time = MCP.timeArg(t.comp, args);
    t.prop.setValueAtTime(time, MCP.markerFromSpec(args));
    return {
        composition: MCP.serialize.compRef(t.comp),
        layer: t.layer ? MCP.serialize.layerRef(t.layer) : null,
        marker: { time: MCP.round(time), frame: MCP.frameOf(t.comp, time), comment: MCP.arg(args, "comment", ""), duration: MCP.num(args.duration, 0) },
        markerCount: t.prop.numKeys
    };
}, { mutating: true });

MCP.register("addMarkersBulk", function (args) {
    var t = MCP.markerTarget(args);
    var markers = args.markers;
    if (!MCP.isArray(markers) || !markers.length) { MCP.fail("markers must be a non-empty array of {time|frame, comment, duration, label, chapter, url}.", "invalid-argument"); }
    if (MCP.bool(args.clearExisting, false)) { while (t.prop.numKeys > 0) { t.prop.removeKey(1); } }
    var added = [], errors = [];
    for (var i = 0; i < markers.length; i++) {
        try {
            var spec = markers[i];
            var time = MCP.timeArg(t.comp, spec, null);
            if (!MCP.isDefined(time)) { MCP.fail("Marker " + i + " has no time or frame.", "invalid-argument"); }
            t.prop.setValueAtTime(time, MCP.markerFromSpec(spec));
            added.push({ time: MCP.round(time), frame: MCP.frameOf(t.comp, time), comment: MCP.arg(spec, "comment", "") });
        } catch (e) {
            errors.push({ index: i, error: e.toString() });
        }
    }
    return {
        composition: MCP.serialize.compRef(t.comp),
        layer: t.layer ? MCP.serialize.layerRef(t.layer) : null,
        addedCount: added.length, errorCount: errors.length, added: added, errors: errors, markerCount: t.prop.numKeys
    };
}, { mutating: true });

MCP.register("listMarkers", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var out = { composition: MCP.serialize.compRef(comp), compMarkers: MCP.markerList(comp, comp.markerProperty), layers: [] };
    var layers = MCP.isDefined(args.layer) ? [MCP.resolveLayer(comp, args.layer)] : (MCP.bool(args.includeLayers, true) ? MCP.resolveLayers(comp, { all: true }) : []);
    for (var i = 0; i < layers.length; i++) {
        var mp = _mcpTry(function () { return layers[i].property("ADBE Marker"); }, null);
        if (!mp || !mp.numKeys) { continue; }
        out.layers.push({ layer: MCP.serialize.layerRef(layers[i]), markers: MCP.markerList(comp, mp) });
    }
    return out;
}, { mutating: false });

MCP.register("deleteMarker", function (args) {
    var t = MCP.markerTarget(args);
    var removed = 0;
    if (MCP.isDefined(args.index)) {
        var idx = Number(args.index);
        if (idx < 1 || idx > t.prop.numKeys) { MCP.fail("Marker index " + idx + " out of range (1 to " + t.prop.numKeys + ").", "not-found"); }
        t.prop.removeKey(idx); removed = 1;
    } else {
        var time = MCP.timeArg(t.comp, args, null);
        if (!MCP.isDefined(time)) { MCP.fail("Give a marker index, or a time or frame.", "invalid-argument"); }
        var ki = MCP.easing.keyIndexAtTime(t.prop, time, MCP.frameDuration(t.comp) / 2);
        if (ki < 0) { MCP.fail("No marker at " + time + " s.", "not-found"); }
        t.prop.removeKey(ki); removed = 1;
    }
    return { composition: MCP.serialize.compRef(t.comp), layer: t.layer ? MCP.serialize.layerRef(t.layer) : null, removed: removed, markerCount: t.prop.numKeys };
}, { mutating: true });

MCP.register("clearMarkers", function (args) {
    var t = MCP.markerTarget(args);
    var count = t.prop.numKeys;
    while (t.prop.numKeys > 0) { t.prop.removeKey(1); }
    return { composition: MCP.serialize.compRef(t.comp), layer: t.layer ? MCP.serialize.layerRef(t.layer) : null, removed: count };
}, { mutating: true });

MCP.audioLevelsProp = function (layer) {
    var ag = _mcpTry(function () { return layer.property("ADBE Audio Group"); }, null);
    if (!ag) { MCP.fail("Layer '" + layer.name + "' has no Audio group. It must be an audio or audio-video layer.", "unsupported"); }
    var lev = MCP.childProp(ag, "ADBE Audio Levels");
    if (!lev) { MCP.fail("Audio Levels property not found on layer '" + layer.name + "'.", "not-found"); }
    return lev;
};

MCP.register("getAudioInfo", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer;
    var src = _mcpTry(function () { return layer.source; }, null);
    var out = {
        composition: MCP.serialize.compRef(r.comp),
        layer: MCP.serialize.layerRef(layer),
        hasAudio: _mcpTry(function () { return layer.hasAudio; }, false),
        audioEnabled: _mcpTry(function () { return layer.audioEnabled; }, false),
        inPoint: MCP.round(layer.inPoint), outPoint: MCP.round(layer.outPoint), startTime: MCP.round(layer.startTime),
        source: null, sourceFilePath: null, audioLevels: null, markers: []
    };
    if (src) {
        out.source = {
            name: src.name,
            hasAudio: _mcpTry(function () { return src.hasAudio; }, false),
            audioChannels: _mcpTry(function () { return src.audioChannels; }, 0),
            audioSampleRate: _mcpTry(function () { return src.audioSampleRate; }, 0),
            audioDuration: _mcpTry(function () { return src.audioDuration; }, 0),
            duration: _mcpTry(function () { return src.duration; }, 0)
        };
        out.sourceFilePath = _mcpTry(function () { return src.file ? src.file.fsName : null; }, null);
    }
    var lev = _mcpTry(function () { return MCP.audioLevelsProp(layer); }, null);
    if (lev) {
        out.audioLevels = MCP.serialize.property(lev, { keyframes: true });
    }
    out.markers = _mcpTry(function () { return MCP.markerList(r.comp, layer.property("ADBE Marker")); }, []);
    return out;
}, { mutating: false });

MCP.register("setAudioLevels", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var lev = MCP.audioLevelsProp(r.layer);
    var level = MCP.num(args.level, null);
    var left = MCP.num(args.leftLevel, level);
    var right = MCP.num(args.rightLevel, level);
    if (left === null && right === null) { MCP.fail("Provide level (both channels), leftLevel or rightLevel in dB.", "invalid-argument"); }
    if (left === null) { left = right; }
    if (right === null) { right = left; }
    var value = [left, right];
    var keyIndex = null;
    if (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) {
        var t = MCP.timeArg(r.comp, args);
        keyIndex = MCP.easing.setKey(lev, t, value);
        if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(lev, keyIndex, args.easing); }
    } else {
        lev.setValue(value);
    }
    return MCP.serialize.propertyResult(r.layer, lev, { audioLevels: { left: left, right: right }, keyIndex: keyIndex });
}, { mutating: true });
