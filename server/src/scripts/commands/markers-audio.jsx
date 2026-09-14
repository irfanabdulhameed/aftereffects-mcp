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

/* ------------------------------------------------------ audio to keyframes */

MCP.register("audioToKeyframes", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layer;
    if (MCP.isDefined(args.layer)) { layer = MCP.resolveLayer(comp, args.layer); }
    else {
        var sel = comp.selectedLayers || [];
        if (!sel.length) { MCP.fail("Give layer, or select one audio layer in the timeline.", "invalid-argument"); }
        layer = sel[0];
    }
    if (!_mcpTry(function () { return layer.hasAudio; }, false)) {
        MCP.fail("Layer '" + layer.name + "' has no audio. Pick a layer whose source carries an audio track (list-layers shows hasAudio).", "invalid-argument");
    }
    var id = _mcpTry(function () { return app.findMenuCommandId("Convert Audio to Keyframes"); }, 0);
    if (!id) { MCP.fail("The menu command 'Convert Audio to Keyframes' was not found in this After Effects install (Animation > Keyframe Assistant). Cannot convert audio.", "unsupported"); }
    var existing = {};
    for (var i = 1; i <= comp.numLayers; i++) {
        var lid = _mcpTry(function () { return comp.layer(i).id; }, null);
        if (lid !== null) { existing[String(lid)] = true; }
    }
    var restoreWork = null;
    if (MCP.bool(args.useLayerRange, false)) {
        restoreWork = { start: comp.workAreaStart, duration: comp.workAreaDuration };
        try { comp.workAreaStart = Math.max(0, layer.inPoint); comp.workAreaDuration = Math.max(MCP.frameDuration(comp), Math.min(comp.duration, layer.outPoint) - Math.max(0, layer.inPoint)); } catch (e0) { restoreWork = null; }
    }
    try { comp.openInViewer(); } catch (e1) {}
    for (var d = 1; d <= comp.numLayers; d++) { try { comp.layer(d).selected = false; } catch (e2) {} }
    layer.selected = true;
    var before = comp.numLayers;
    app.executeCommand(id);
    if (restoreWork) { try { comp.workAreaStart = restoreWork.start; comp.workAreaDuration = restoreWork.duration; } catch (e3) {} }
    var created = null;
    for (var j = 1; j <= comp.numLayers; j++) {
        var L = comp.layer(j);
        var isNew = !existing[String(_mcpTry(function () { return L.id; }, "x"))];
        if (isNew && (created === null || L.name.indexOf("Audio Amplitude") === 0)) { created = L; if (L.name.indexOf("Audio Amplitude") === 0) { break; } }
    }
    if (!created || comp.numLayers === before) {
        MCP.fail("'Convert Audio to Keyframes' ran but no new layer appeared. Make sure the composition is open in the viewer and the layer has audio inside the work area.", "script-error");
    }
    if (MCP.isDefined(args.name)) { created.name = String(args.name); }
    var sliders = [];
    var keyCounts = {};
    var fxg = _mcpTry(function () { return created.property("ADBE Effect Parade"); }, null);
    var nfx = fxg ? fxg.numProperties : 0;
    for (var k = 1; k <= nfx; k++) {
        var fx = fxg.property(k);
        var slider = MCP.childProp(fx, "ADBE Slider Control-0001") || MCP.findProp(fx, "Slider");
        if (!slider) { continue; }
        var paths = MCP.pathOf(slider);
        var nk = _mcpTry(function () { return slider.numKeys; }, 0);
        sliders.push({ channel: fx.name, path: paths.path, matchPath: paths.matchPath, numKeys: nk, maxValue: MCP.round(MCP.markerMaxKey(slider)) });
        keyCounts[fx.name] = nk;
    }
    var q = '"';
    var ref = 'thisComp.layer(' + q + created.name.replace(/"/g, '\\"') + q + ')';
    return {
        composition: MCP.serialize.compRef(comp),
        sourceLayer: MCP.serialize.layerRef(layer),
        layer: MCP.serialize.layer(created),
        sliders: sliders,
        keyCounts: keyCounts,
        expressions: {
            both: ref + '.effect("Both Channels")("Slider")',
            left: ref + '.effect("Left Channel")("Slider")',
            right: ref + '.effect("Right Channel")("Slider")',
            scaleExample: 'linear(' + ref + '.effect("Both Channels")("Slider"), 0, 20, 100, 130)'
        },
        workArea: { start: MCP.round(comp.workAreaStart), duration: MCP.round(comp.workAreaDuration) },
        notes: ["Keyframes cover the composition work area only; set-work-area before calling to change the range.", "Slider values are amplitude in arbitrary units (often 0 to 30); use linear() in an expression to map them."]
    };
}, { mutating: true });

MCP.markerMaxKey = function (prop) {
    var max = 0;
    var n = _mcpTry(function () { return prop.numKeys; }, 0);
    for (var i = 1; i <= n; i++) {
        var v = Number(prop.keyValue(i));
        if (v > max) { max = v; }
    }
    return max;
};

/* ---------------------------------------------------------- beat markers */

MCP.register("markersFromBeats", function (args, ctx) {
    var t = MCP.markerTarget(args);
    var comp = t.comp;
    var fd = MCP.frameDuration(comp);
    var offset = MCP.num(args.offset, 0);
    var snap = MCP.bool(args.snapToFrames, true);
    var downLabel = MCP.isDefined(args.downbeatLabel) ? args.downbeatLabel : "red";
    var labelDownbeats = MCP.bool(args.labelDownbeats, true);
    var specs = [];
    var mode;
    var beatInterval = null;
    if (MCP.isArray(args.peakTimes) && args.peakTimes.length) {
        mode = "peaks";
        for (var p = 0; p < args.peakTimes.length; p++) {
            var pt = Number(args.peakTimes[p]) + offset;
            if (isNaN(pt) || pt < 0 || pt > comp.duration) { continue; }
            specs.push({ time: snap ? MCP.snapToFrame(comp, pt) : pt, comment: MCP.isDefined(args.comment) ? String(args.comment) : String(p + 1) });
        }
    } else if (MCP.isDefined(args.bpm)) {
        mode = "bpm";
        var bpm = Number(args.bpm);
        if (!(bpm > 0)) { MCP.fail("bpm must be greater than zero.", "invalid-argument"); }
        var beatsPerBar = Math.max(1, Math.round(MCP.num(args.beatsPerBar, 4)));
        var subdivisions = Math.max(1, Math.round(MCP.num(args.subdivisions, 1)));
        beatInterval = 60 / bpm;
        var step = beatInterval / subdivisions;
        var start = MCP.isDefined(args.start) || MCP.isDefined(args.startFrame) ? MCP.durationArg(comp, args, "start", "startFrame", 0) : (MCP.bool(args.useWorkArea, false) ? comp.workAreaStart : 0);
        var end = MCP.isDefined(args.end) || MCP.isDefined(args.endFrame) ? MCP.durationArg(comp, args, "end", "endFrame", comp.duration) : (MCP.bool(args.useWorkArea, false) ? comp.workAreaStart + comp.workAreaDuration : comp.duration);
        if (end <= start) { MCP.fail("end must be after start (start " + start + " s, end " + end + " s).", "invalid-argument"); }
        var first = start + offset;
        var n = 0;
        var guard = 20000;
        while (n < guard) {
            var time = first + n * step;
            if (time > end + 1e-6) { break; }
            if (time >= start - 1e-6) {
                var beatIndex = Math.floor(n / subdivisions);
                var sub = n % subdivisions;
                var beatInBar = (beatIndex % beatsPerBar) + 1;
                var isDownbeat = beatInBar === 1 && sub === 0;
                var spec = { time: snap ? MCP.snapToFrame(comp, time) : time, comment: sub === 0 ? String(beatInBar) : (beatInBar + "." + (sub + 1)) };
                if (isDownbeat && labelDownbeats) { spec.label = downLabel; }
                specs.push(spec);
            }
            n++;
        }
    } else {
        MCP.fail("Give bpm (with optional offset, beatsPerBar, subdivisions, start, end) or peakTimes[] from analyze-audio-waveform.", "invalid-argument");
    }
    if (specs.length > 5000) { specs.length = 5000; }
    if (!specs.length) { MCP.fail("No marker times fell inside the composition. Check offset, start and end.", "invalid-argument"); }
    var bulkArgs = { comp: args.comp, target: t.layer ? "layer" : "comp", layer: args.layer, markers: specs, clearExisting: MCP.bool(args.clearExisting, false) };
    var res = MCP.invoke("addMarkersBulk", bulkArgs, ctx);
    return {
        composition: MCP.serialize.compRef(comp),
        layer: t.layer ? MCP.serialize.layerRef(t.layer) : null,
        mode: mode,
        bpm: mode === "bpm" ? Number(args.bpm) : null,
        beatInterval: beatInterval !== null ? MCP.round(beatInterval) : null,
        offset: offset,
        count: res.addedCount,
        errorCount: res.errorCount,
        firstTime: MCP.round(specs[0].time), lastTime: MCP.round(specs[specs.length - 1].time),
        firstFrame: MCP.frameOf(comp, specs[0].time), lastFrame: MCP.frameOf(comp, specs[specs.length - 1].time),
        markerCount: res.markerCount,
        cleared: MCP.bool(args.clearExisting, false)
    };
}, { mutating: true });
