/*
 * Keyframe commands. All of them go through MCP.easing so layer, effect,
 * mask and text keyframes share one easing model.
 */

MCP.coerceValue = function (prop, raw) {
    if (typeof raw !== "string") { return raw; }
    var t = raw.replace(/^\s+|\s+$/g, "");
    if (t === "") { return raw; }
    var isText = false;
    try { isText = prop.propertyValueType === PropertyValueType.TEXT_DOCUMENT; } catch (e) { isText = false; }
    if (isText) { return raw; }
    var first = t.charAt(0);
    if (first === "[" || first === "{" || t === "true" || t === "false" || t === "null") {
        try { return JSON.parse(t); } catch (e2) {}
    }
    if (/^-?\d+(\.\d+)?$/.test(t)) { return parseFloat(t); }
    return raw;
};

/** Text properties take a TextDocument; accept a plain string and keep the styling. */
MCP.valueForProperty = function (prop, raw) {
    var v = MCP.coerceValue(prop, raw);
    var isText = false;
    try { isText = prop.propertyValueType === PropertyValueType.TEXT_DOCUMENT; } catch (e) { isText = false; }
    if (isText && typeof v === "string") {
        var doc = prop.value;
        doc.text = v;
        return doc;
    }
    return v;
};

MCP.register("setKeyframe", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var t = MCP.timeArg(r.comp, args);
    var value = MCP.valueForProperty(prop, MCP.requireArg(args, "value"));
    var i = MCP.easing.setKey(prop, t, value, args.spatial);
    if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(prop, i, args.easing); }
    if (MCP.bool(args.roving, false)) { try { prop.setRovingAtKey(i, true); } catch (e) {} }
    return MCP.serialize.propertyResult(r.layer, prop, { keyframe: MCP.serialize.keyframe(prop, i), keyIndex: i });
}, { mutating: true });

/**
 * setKeyframesBulk: { property, keys: [{time|frame, value, easing?}], easing?, spatial?, replace? }
 * Keys are written in time order. A key easing of "overshoot" inserts an extra
 * key before it. easing at the top level is the default for every key.
 */
MCP.register("setKeyframesBulk", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var keys = args.keys;
    if (!MCP.isArray(keys) || !keys.length) { MCP.fail("keys must be a non-empty array of {time, value, easing}.", "invalid-argument"); }
    if (MCP.bool(args.replace, false)) {
        while (prop.numKeys > 0) { prop.removeKey(1); }
    }
    var comp = r.comp;
    var resolved = [];
    for (var k = 0; k < keys.length; k++) {
        var spec = keys[k];
        if (!spec || !MCP.isDefined(spec.value)) { MCP.fail("Key " + k + " has no value.", "invalid-argument"); }
        resolved.push({ time: MCP.timeArg(comp, spec, k === 0 ? 0 : undefined), value: MCP.valueForProperty(prop, spec.value), easing: MCP.isDefined(spec.easing) ? spec.easing : args.easing });
    }
    resolved.sort(function (a, b) { return a.time - b.time; });

    var written = [];
    var prev = null;
    for (var i = 0; i < resolved.length; i++) {
        var key = resolved[i];
        var easing = key.easing;
        if (easing === "overshoot" && prev) {
            var os = MCP.easing.overshootKey(prev.time, prev.value, key.time, key.value, args.overshootAmount, args.overshootPosition);
            var oi = MCP.easing.setKey(prop, os.time, os.value, args.spatial);
            MCP.easing.applySegment(prop, oi, "ease-out");
            written.push(oi);
            easing = "ease-in-out";
        }
        var idx = MCP.easing.setKey(prop, key.time, key.value, args.spatial);
        if (MCP.isDefined(easing)) { MCP.easing.applySegment(prop, idx, easing); }
        written.push(idx);
        prev = key;
    }
    // Indices can shift as keys are inserted; re-read them by time.
    var out = [];
    for (var w = 0; w < resolved.length; w++) {
        var ki = MCP.easing.keyIndexAtTime(prop, resolved[w].time, 1e-3);
        if (ki > 0) { out.push(MCP.serialize.keyframe(prop, ki)); }
    }
    return MCP.serialize.propertyResult(r.layer, prop, { keyframesWritten: written.length, keyframes: out });
}, { mutating: true });

/**
 * setKeyframesMulti: { targets: [{ comp?, layer, property, keys, easing?, spatial? }] }
 */
MCP.register("setKeyframesMulti", function (args, ctx) {
    var targets = args.targets;
    if (!MCP.isArray(targets) || !targets.length) { MCP.fail("targets must be a non-empty array.", "invalid-argument"); }
    var results = [];
    var failed = 0;
    for (var i = 0; i < targets.length; i++) {
        var t = targets[i] || {};
        if (!MCP.isDefined(t.comp) && MCP.isDefined(args.comp)) { t.comp = args.comp; }
        try {
            var res = MCP.invoke("setKeyframesBulk", t, ctx);
            results.push({ target: i, status: "ok", layer: res.layer, property: res.property.path, keyframesWritten: res.keyframesWritten });
        } catch (err) {
            failed++;
            results.push({ target: i, status: "error", error: MCP.errorInfo(err, "setKeyframesBulk", ctx ? ctx.id : null) });
            if (MCP.bool(args.stopOnError, false)) { break; }
        }
    }
    return { targets: results.length, failed: failed, results: results };
}, { mutating: true });

MCP.register("getKeyframes", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var out = MCP.serialize.property(prop, { keyframes: true });
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), property: out };
}, { mutating: false });

/* ------------------------------------------------------------- helpers */

MCP.kf = {};

/** Snapshot of everything that defines one keyframe so it can be written again at another time or on another property. */
MCP.kf.readKey = function (prop, i) {
    var snap = {
        time: prop.keyTime(i),
        value: prop.keyValue(i),
        inInterp: _mcpTry(function () { return prop.keyInInterpolationType(i); }, null),
        outInterp: _mcpTry(function () { return prop.keyOutInterpolationType(i); }, null),
        easeIn: _mcpTry(function () { return prop.keyInTemporalEase(i); }, null),
        easeOut: _mcpTry(function () { return prop.keyOutTemporalEase(i); }, null),
        temporalContinuous: _mcpTry(function () { return prop.keyTemporalContinuous(i); }, null),
        temporalAutoBezier: _mcpTry(function () { return prop.keyTemporalAutoBezier(i); }, null),
        spatial: null,
        roving: null
    };
    if (_mcpTry(function () { return !!prop.isSpatial; }, false)) {
        snap.spatial = {
            inTangent: _mcpTry(function () { return prop.keyInSpatialTangent(i); }, null),
            outTangent: _mcpTry(function () { return prop.keyOutSpatialTangent(i); }, null),
            continuous: _mcpTry(function () { return prop.keySpatialContinuous(i); }, null),
            autoBezier: _mcpTry(function () { return prop.keySpatialAutoBezier(i); }, null)
        };
        snap.roving = _mcpTry(function () { return prop.keyRoving(i); }, null);
    }
    return snap;
};

/** Sets temporal ease, widening or narrowing the ease arrays to what the property expects. */
MCP.kf.setEase = function (prop, i, inArr, outArr) {
    if (!inArr || !outArr || !inArr.length || !outArr.length) { return false; }
    if (MCP.easing.setTemporalEase(prop, i, inArr, outArr)) { return true; }
    var n = MCP.easing.dims(prop);
    var inn = [], out = [];
    for (var d = 0; d < n; d++) {
        var a = inArr[Math.min(d, inArr.length - 1)], b = outArr[Math.min(d, outArr.length - 1)];
        inn.push(new KeyframeEase(a.speed, a.influence));
        out.push(new KeyframeEase(b.speed, b.influence));
    }
    try { prop.setTemporalEaseAtKey(i, inn, out); return true; } catch (e) {}
    return false;
};

/** Re-applies interpolation, ease, temporal flags, spatial tangents and roving from a snapshot to key i. */
MCP.kf.applyKeyAttributes = function (prop, i, snap) {
    if (snap.inInterp !== null && snap.outInterp !== null) {
        try { prop.setInterpolationTypeAtKey(i, snap.inInterp, snap.outInterp); } catch (e1) {}
    }
    if (snap.temporalAutoBezier) {
        try { prop.setTemporalContinuousAtKey(i, true); prop.setTemporalAutoBezierAtKey(i, true); } catch (e2) {}
    } else {
        try { prop.setTemporalAutoBezierAtKey(i, false); } catch (e3) {}
        MCP.kf.setEase(prop, i, snap.easeIn, snap.easeOut);
        if (snap.temporalContinuous !== null) { try { prop.setTemporalContinuousAtKey(i, !!snap.temporalContinuous); } catch (e4) {} }
    }
    if (snap.spatial && _mcpTry(function () { return !!prop.isSpatial; }, false)) {
        if (snap.spatial.autoBezier) {
            try { prop.setSpatialAutoBezierAtKey(i, true); prop.setSpatialContinuousAtKey(i, true); } catch (e5) {}
        } else {
            try { prop.setSpatialAutoBezierAtKey(i, false); } catch (e6) {}
            try { prop.setSpatialContinuousAtKey(i, !!snap.spatial.continuous); } catch (e7) {}
            if (snap.spatial.inTangent && snap.spatial.outTangent) {
                try { prop.setSpatialTangentsAtKey(i, snap.spatial.inTangent, snap.spatial.outTangent); } catch (e8) {}
            }
        }
        if (snap.roving !== null) { try { prop.setRovingAtKey(i, !!snap.roving); } catch (e9) {} }
    }
};

/** Writes a snapshot as a new key at time (default the snapshot time) with value (default the snapshot value). Returns the key index. */
MCP.kf.writeKey = function (prop, snap, time, value) {
    var t = MCP.isDefined(time) ? time : snap.time;
    var v = MCP.isDefined(value) ? value : snap.value;
    prop.setValueAtTime(t, v);
    var i = MCP.easing.keyIndexAtTime(prop, t, 1e-4);
    if (i < 0) { i = prop.nearestKeyIndex(t); }
    MCP.kf.applyKeyAttributes(prop, i, snap);
    return i;
};

/**
 * Resolves a key selection to ascending 1-based indices.
 * sel: undefined | "all" | [indices] | { from, to } seconds | { fromFrame, toFrame } frames (inclusive, half-frame tolerance).
 */
MCP.kf.selectKeys = function (prop, comp, sel) {
    var n = prop.numKeys, out = [], i;
    if (!n) { MCP.fail("Property '" + MCP.pathOf(prop).path + "' has no keyframes.", "not-found"); }
    if (!MCP.isDefined(sel) || sel === "all") {
        for (i = 1; i <= n; i++) { out.push(i); }
        return out;
    }
    if (MCP.isArray(sel)) {
        var seen = {};
        for (i = 0; i < sel.length; i++) {
            var k = Math.round(Number(sel[i]));
            if (isNaN(k) || k < 1 || k > n) { MCP.fail("Key index " + sel[i] + " is out of range on '" + MCP.pathOf(prop).path + "' (1 to " + n + ").", "invalid-argument"); }
            if (!seen[k]) { seen[k] = true; out.push(k); }
        }
        out.sort(function (a, b) { return a - b; });
        if (!out.length) { MCP.fail("keys is an empty list. Use \"all\", indices or {from, to}.", "invalid-argument"); }
        return out;
    }
    if (typeof sel === "object") {
        var fd = MCP.frameDuration(comp);
        var from = MCP.isDefined(sel.fromFrame) ? Number(sel.fromFrame) * fd : (MCP.isDefined(sel.from) ? Number(sel.from) : prop.keyTime(1));
        var to = MCP.isDefined(sel.toFrame) ? Number(sel.toFrame) * fd : (MCP.isDefined(sel.to) ? Number(sel.to) : prop.keyTime(n));
        var tol = fd / 2;
        for (i = 1; i <= n; i++) {
            var t = prop.keyTime(i);
            if (t >= from - tol && t <= to + tol) { out.push(i); }
        }
        if (!out.length) { MCP.fail("No keyframes between " + MCP.round(from) + "s and " + MCP.round(to) + "s on '" + MCP.pathOf(prop).path + "'. Keys are at: " + MCP.kf.keyTimes(prop).join(", "), "not-found"); }
        return out;
    }
    MCP.fail("keys must be \"all\", an array of 1-based indices, or {from, to} in seconds (or {fromFrame, toFrame}).", "invalid-argument");
    return out;
};

MCP.kf.keyTimes = function (prop) {
    var out = [];
    for (var i = 1; i <= prop.numKeys; i++) { out.push(MCP.round(prop.keyTime(i)) + "s"); }
    return out;
};

MCP.kf.allKeyframes = function (prop) {
    var out = [];
    for (var i = 1; i <= prop.numKeys; i++) { out.push(MCP.serialize.keyframe(prop, i)); }
    return out;
};

/** Removes keys by index, highest first so the remaining indices stay valid. */
MCP.kf.removeIndices = function (prop, indices) {
    var sorted = indices.slice(0).sort(function (a, b) { return b - a; });
    for (var i = 0; i < sorted.length; i++) { prop.removeKey(sorted[i]); }
};

/** Dimension count of a key value: array length, 1 for numbers, or a type label for text, shapes and markers. */
MCP.kf.dimsOf = function (v) {
    if (MCP.isArray(v)) { return v.length; }
    if (typeof v === "number") { return 1; }
    if (typeof TextDocument !== "undefined" && v instanceof TextDocument) { return "text"; }
    if (typeof Shape !== "undefined" && v instanceof Shape) { return "shape"; }
    if (typeof MarkerValue !== "undefined" && v instanceof MarkerValue) { return "marker"; }
    return "other";
};

MCP.kf.scaleValue = function (v, mult) {
    if (!MCP.isDefined(mult)) { return v; }
    if (typeof v === "number") { return v * (MCP.isArray(mult) ? Number(mult[0]) : Number(mult)); }
    if (MCP.isArray(v)) {
        var out = [];
        for (var d = 0; d < v.length; d++) {
            var m = MCP.isArray(mult) ? Number(mult[Math.min(d, mult.length - 1)]) : Number(mult);
            out.push(Number(v[d]) * m);
        }
        return out;
    }
    return v;
};

MCP.kf.negate = function (v) {
    if (!MCP.isArray(v)) { return v; }
    var out = [];
    for (var d = 0; d < v.length; d++) { out.push(-Number(v[d])); }
    return out;
};

/* ------------------------------------------------------------ commands */

MCP.register("deleteKeyframe", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    if (!prop.numKeys) { MCP.fail("Property '" + MCP.pathOf(prop).path + "' has no keyframes.", "not-found"); }
    var i = -1;
    if (MCP.isDefined(args.index)) {
        i = Math.round(Number(args.index));
        if (i < 1 || i > prop.numKeys) { MCP.fail("Key index " + args.index + " is out of range (1 to " + prop.numKeys + ").", "invalid-argument"); }
    } else if (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) {
        var t = MCP.timeArg(r.comp, args);
        i = MCP.easing.keyIndexAtTime(prop, t, MCP.frameDuration(r.comp) / 2);
        if (i < 0) { MCP.fail("No keyframe at " + MCP.round(t) + "s (frame " + MCP.frameOf(r.comp, t) + ") on '" + MCP.pathOf(prop).path + "'. Keys are at: " + MCP.kf.keyTimes(prop).join(", "), "not-found"); }
    } else {
        MCP.fail("Give index (1-based), time (seconds) or frame to say which keyframe to delete.", "invalid-argument");
    }
    var removed = MCP.serialize.keyframe(prop, i);
    prop.removeKey(i);
    return MCP.serialize.propertyResult(r.layer, prop, { removed: removed, keyframes: MCP.kf.allKeyframes(prop) });
}, { mutating: true });

MCP.register("deleteKeyframesInRange", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var fd = MCP.frameDuration(r.comp);
    var start = MCP.isDefined(args.startFrame) ? Number(args.startFrame) * fd : (MCP.isDefined(args.start) ? Number(args.start) : 0);
    var end = MCP.isDefined(args.endFrame) ? Number(args.endFrame) * fd : (MCP.isDefined(args.end) ? Number(args.end) : r.comp.duration);
    if (end < start) { MCP.fail("end (" + MCP.round(end) + "s) is before start (" + MCP.round(start) + "s).", "invalid-argument"); }
    var tol = fd / 2;
    var removedTimes = [];
    for (var i = prop.numKeys; i >= 1; i--) {
        var t = prop.keyTime(i);
        if (t >= start - tol && t <= end + tol) {
            removedTimes.unshift(MCP.round(t));
            prop.removeKey(i);
        }
    }
    return MCP.serialize.propertyResult(r.layer, prop, {
        removedCount: removedTimes.length,
        removedTimes: removedTimes,
        range: { start: MCP.round(start), end: MCP.round(end), startFrame: MCP.frameOf(r.comp, start), endFrame: MCP.frameOf(r.comp, end) },
        keyframes: MCP.kf.allKeyframes(prop)
    });
}, { mutating: true });

MCP.register("clearKeyframes", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var count = prop.numKeys;
    var keep = MCP.bool(args.keepValue, true);
    var fd = MCP.frameDuration(r.comp);
    var keepAt = MCP.isDefined(args.keepValueAtFrame) ? Number(args.keepValueAtFrame) * fd : (MCP.isDefined(args.keepValueAtTime) ? Number(args.keepValueAtTime) : r.comp.time);
    var kept = null;
    if (count > 0 && keep) {
        kept = _mcpTry(function () { return prop.valueAtTime(keepAt, true); }, null);
    }
    while (prop.numKeys > 0) { prop.removeKey(1); }
    if (kept !== null) {
        try { prop.setValue(kept); } catch (e) {}
    }
    return MCP.serialize.propertyResult(r.layer, prop, {
        removedCount: count,
        keptValue: kept === null ? null : MCP.serialize.rawValue(kept),
        keptValueAt: keep ? MCP.round(keepAt) : null
    });
}, { mutating: true });

/**
 * moveKeyframes: { property, keys?, offset?, offsetFrames?, scale?, pivot?, pivotFrame?, snapToFrame? }
 * Reads the selected keys, removes them, and writes them again at the new times
 * with interpolation, ease, spatial tangents and roving re-applied.
 */
MCP.register("moveKeyframes", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var fd = MCP.frameDuration(r.comp);
    var hasOffset = MCP.isDefined(args.offset) || MCP.isDefined(args.offsetFrames);
    var hasScale = MCP.isDefined(args.scale);
    if (!hasOffset && !hasScale) { MCP.fail("Give offset (seconds) or offsetFrames to shift the keys, or scale (factor) to stretch them about pivot.", "invalid-argument"); }
    var offset = hasOffset ? MCP.durationArg(r.comp, args, "offset", "offsetFrames", 0) : 0;
    var scale = hasScale ? Number(args.scale) : 1;
    if (hasScale && (isNaN(scale) || scale <= 0)) { MCP.fail("scale must be a positive number (2 doubles the spacing, 0.5 halves it).", "invalid-argument"); }
    var indices = MCP.kf.selectKeys(prop, r.comp, args.keys);
    var pivot = MCP.isDefined(args.pivotFrame) ? Number(args.pivotFrame) * fd : (MCP.isDefined(args.pivot) ? Number(args.pivot) : prop.keyTime(indices[0]));
    var snaps = [], i;
    for (i = 0; i < indices.length; i++) { snaps.push(MCP.kf.readKey(prop, indices[i])); }
    MCP.kf.removeIndices(prop, indices);
    var moved = [], overwritten = 0;
    for (i = 0; i < snaps.length; i++) {
        var t = pivot + (snaps[i].time - pivot) * scale + offset;
        if (MCP.bool(args.snapToFrame, false)) { t = MCP.snapToFrame(r.comp, t); }
        if (MCP.easing.keyIndexAtTime(prop, t, 1e-4) > 0) { overwritten++; }
        var idx = MCP.kf.writeKey(prop, snaps[i], t);
        moved.push({ from: MCP.round(snaps[i].time), to: MCP.round(t), index: idx });
    }
    return MCP.serialize.propertyResult(r.layer, prop, {
        movedCount: moved.length,
        offset: MCP.round(offset),
        scale: scale,
        pivot: MCP.round(pivot),
        overwritten: overwritten,
        moved: moved,
        keyframes: MCP.kf.allKeyframes(prop)
    });
}, { mutating: true });

/**
 * setKeyframeEasing: { property, easing, keys? }
 * Applies the easing to the segment arriving at each selected key, and to the
 * out side of the first selected key as well.
 */
MCP.register("setKeyframeEasing", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var spec = MCP.requireArg(args, "easing");
    var indices = MCP.kf.selectKeys(prop, r.comp, args.keys);
    var res = MCP.easing.resolve(spec);
    for (var k = 0; k < indices.length; k++) { MCP.easing.applySegment(prop, indices[k], spec); }
    if (indices[0] > 1) {
        var outRes = res.bezier ? MCP.easing.PRESETS["ease"] : res;
        MCP.easing.applyOut(prop, indices[0], outRes, null);
    }
    return MCP.serialize.propertyResult(r.layer, prop, { easing: spec, appliedTo: indices, keyframes: MCP.kf.allKeyframes(prop) });
}, { mutating: true });

/**
 * copyKeyframes: { fromLayer, fromProperty, toLayer?, toProperty?, toComp?, timeOffset?, frameOffset?, valueMultiplier?, replace? }
 */
MCP.register("copyKeyframes", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var fromLayer = MCP.resolveLayer(comp, MCP.requireArg(args, "fromLayer"));
    var fromProp = MCP.resolveProperty(fromLayer, MCP.requireArg(args, "fromProperty"));
    var toComp = MCP.isDefined(args.toComp) ? MCP.resolveComp(args.toComp) : comp;
    var toLayer = MCP.isDefined(args.toLayer) ? MCP.resolveLayer(toComp, args.toLayer) : (toComp === comp ? fromLayer : MCP.resolveLayer(toComp, { name: fromLayer.name }));
    var toPath = MCP.isDefined(args.toProperty) ? args.toProperty : MCP.pathOf(fromProp).matchPath;
    var toProp = MCP.resolveProperty(toLayer, toPath);
    if (fromProp === toProp) { MCP.fail("Source and target are the same property. Give toLayer, toProperty or toComp.", "invalid-argument"); }
    if (!fromProp.numKeys) { MCP.fail("Property '" + MCP.pathOf(fromProp).path + "' on '" + fromLayer.name + "' has no keyframes to copy.", "not-found"); }
    if (!toProp.canVaryOverTime) { MCP.fail("Property '" + MCP.pathOf(toProp).path + "' cannot be keyframed.", "unsupported"); }
    var srcDims = MCP.kf.dimsOf(fromProp.keyValue(1));
    var dstDims = MCP.kf.dimsOf(_mcpTry(function () { return toProp.value; }, null));
    if (srcDims !== dstDims) {
        MCP.fail("Cannot copy keyframes from '" + MCP.pathOf(fromProp).path + "' (" + srcDims + (typeof srcDims === "number" ? " dimension(s)" : "") + ") to '" + MCP.pathOf(toProp).path + "' (" + dstDims + (typeof dstDims === "number" ? " dimension(s)" : "") + "). Pick a target with the same value type, for example Position to Position or Opacity to a slider.", "invalid-argument", { sourceDimensions: srcDims, targetDimensions: dstDims });
    }
    var mult = args.valueMultiplier;
    if (MCP.isArray(mult) && typeof srcDims === "number" && mult.length !== srcDims && mult.length !== 1) {
        MCP.fail("valueMultiplier has " + mult.length + " entries but the property has " + srcDims + " dimension(s).", "invalid-argument");
    }
    if (MCP.isDefined(mult) && typeof srcDims !== "number") { mult = undefined; }
    var offset = MCP.durationArg(toComp, args, "timeOffset", "frameOffset", 0);
    var snaps = [], i;
    for (i = 1; i <= fromProp.numKeys; i++) { snaps.push(MCP.kf.readKey(fromProp, i)); }
    if (MCP.bool(args.replace, false)) { while (toProp.numKeys > 0) { toProp.removeKey(1); } }
    var written = [];
    for (i = 0; i < snaps.length; i++) {
        var idx = MCP.kf.writeKey(toProp, snaps[i], snaps[i].time + offset, MCP.kf.scaleValue(snaps[i].value, mult));
        written.push(idx);
    }
    return MCP.serialize.propertyResult(toLayer, toProp, {
        from: { composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(fromLayer), property: MCP.pathOf(fromProp).path },
        copiedCount: written.length,
        timeOffset: MCP.round(offset),
        keyframes: MCP.kf.allKeyframes(toProp)
    });
}, { mutating: true });

/**
 * reverseKeyframes: { property, keys? }
 * Mirrors the selected keys about the midpoint of their time span and swaps
 * in and out ease so the motion plays backwards.
 */
MCP.register("reverseKeyframes", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var indices = MCP.kf.selectKeys(prop, r.comp, args.keys);
    if (indices.length < 2) { MCP.fail("Reversing needs at least two keyframes; '" + MCP.pathOf(prop).path + "' selection has " + indices.length + ".", "invalid-argument"); }
    var HOLD = KeyframeInterpolationType.HOLD, BEZIER = KeyframeInterpolationType.BEZIER;
    var snaps = [], i, n = indices.length;
    for (i = 0; i < n; i++) { snaps.push(MCP.kf.readKey(prop, indices[i])); }
    var first = snaps[0].time, last = snaps[n - 1].time;
    var mid = (first + last) / 2;
    // Segment k (between local keys k and k+1) is held when the out side of key k is HOLD.
    var held = [];
    for (i = 0; i < n - 1; i++) { held.push(snaps[i].outInterp === HOLD); }
    MCP.kf.removeIndices(prop, indices);
    var newSnaps = [];
    for (i = 0; i < n; i++) {
        var src = snaps[n - 1 - i];
        var ns = {
            time: mid + (mid - src.time),
            value: src.value,
            inInterp: src.outInterp === HOLD ? BEZIER : src.outInterp,
            outInterp: src.inInterp,
            easeIn: src.easeOut,
            easeOut: src.easeIn,
            temporalContinuous: src.temporalContinuous,
            temporalAutoBezier: src.temporalAutoBezier,
            spatial: null,
            roving: src.roving
        };
        // New segment i (local keys i and i+1) is the old segment n-2-i.
        if (i < n - 1 && held[n - 2 - i]) { ns.outInterp = HOLD; }
        else if (ns.outInterp === HOLD) { ns.outInterp = BEZIER; }
        if (src.spatial) {
            ns.spatial = {
                inTangent: MCP.kf.negate(src.spatial.outTangent),
                outTangent: MCP.kf.negate(src.spatial.inTangent),
                continuous: src.spatial.continuous,
                autoBezier: src.spatial.autoBezier
            };
        }
        newSnaps.push(ns);
    }
    for (i = 0; i < n; i++) { MCP.kf.writeKey(prop, newSnaps[i]); }
    return MCP.serialize.propertyResult(r.layer, prop, {
        reversedCount: n,
        range: { start: MCP.round(first), end: MCP.round(last), midpoint: MCP.round(mid) },
        keyframes: MCP.kf.allKeyframes(prop)
    });
}, { mutating: true });

/**
 * setKeyframeInterpolation: { property, type: "hold"|"linear"|"bezier", keys? }
 */
MCP.register("setKeyframeInterpolation", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var type = String(MCP.requireArg(args, "type")).toLowerCase();
    var value = MCP.enums.interpolationValue(type);
    var indices = MCP.kf.selectKeys(prop, r.comp, args.keys);
    for (var k = 0; k < indices.length; k++) {
        var i = indices[k];
        if (type === "hold") {
            prop.setInterpolationTypeAtKey(i, prop.keyInInterpolationType(i), value);
        } else {
            try { prop.setTemporalAutoBezierAtKey(i, false); } catch (e1) {}
            prop.setInterpolationTypeAtKey(i, value, value);
        }
    }
    return MCP.serialize.propertyResult(r.layer, prop, { interpolation: type, appliedTo: indices, keyframes: MCP.kf.allKeyframes(prop) });
}, { mutating: true });

/**
 * bakeExpressionToKeyframes: { property, start?, end?, startFrame?, endFrame?, step?, allowLarge? }
 * Samples the property (expression included) every step frames, removes the
 * expression and writes the samples as linear keys.
 */
MCP.register("bakeExpressionToKeyframes", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    if (!prop.canSetExpression || prop.expression === "") { MCP.fail("Property '" + MCP.pathOf(prop).path + "' has no expression to bake.", "not-found"); }
    if (!prop.canVaryOverTime) { MCP.fail("Property '" + MCP.pathOf(prop).path + "' cannot be keyframed.", "unsupported"); }
    var fd = MCP.frameDuration(r.comp);
    var start = MCP.isDefined(args.startFrame) ? Number(args.startFrame) * fd : (MCP.isDefined(args.start) ? Number(args.start) : r.layer.inPoint);
    var end = MCP.isDefined(args.endFrame) ? Number(args.endFrame) * fd : (MCP.isDefined(args.end) ? Number(args.end) : r.layer.outPoint);
    if (end < start) { MCP.fail("end (" + MCP.round(end) + "s) is before start (" + MCP.round(start) + "s).", "invalid-argument"); }
    var stepFrames = Math.max(1, Math.round(MCP.num(args.step, 1)));
    var step = stepFrames * fd;
    var count = Math.floor((end - start) / step + 1e-6) + 1;
    var LIMIT = 5000;
    if (count > LIMIT && !MCP.bool(args.allowLarge, false)) {
        MCP.fail("Baking would write " + count + " keyframes (limit " + LIMIT + "). Narrow start/end, raise step (frames between samples), or pass allowLarge true.", "invalid-argument", { samples: count, limit: LIMIT });
    }
    var wasEnabled = _mcpTry(function () { return prop.expressionEnabled; }, true);
    if (wasEnabled === false) { try { prop.expressionEnabled = true; } catch (e0) {} }
    var samples = [], i, t;
    for (i = 0; i < count; i++) {
        t = start + i * step;
        samples.push({ time: t, value: prop.valueAtTime(t, false) });
    }
    var expression = prop.expression;
    prop.expression = "";
    while (prop.numKeys > 0) { prop.removeKey(1); }
    var LINEAR = KeyframeInterpolationType.LINEAR;
    for (i = 0; i < samples.length; i++) {
        prop.setValueAtTime(samples[i].time, samples[i].value);
    }
    for (i = 1; i <= prop.numKeys; i++) {
        try { prop.setInterpolationTypeAtKey(i, LINEAR, LINEAR); } catch (e1) {}
        MCP.easing.applySpatial(prop, i, "linear");
    }
    var nk = prop.numKeys;
    return MCP.serialize.propertyResult(r.layer, prop, {
        bakedExpression: expression,
        sampleCount: nk,
        stepFrames: stepFrames,
        range: { start: MCP.round(start), end: MCP.round(end), startFrame: MCP.frameOf(r.comp, start), endFrame: MCP.frameOf(r.comp, end) },
        first: nk ? MCP.serialize.keyframe(prop, 1) : null,
        last: nk ? MCP.serialize.keyframe(prop, nk) : null
    });
}, { mutating: true });

/** Small deterministic generator for the "random" stagger order. */
MCP.kf.shuffle = function (arr, seed) {
    var s = (Math.abs(Math.round(MCP.num(seed, 1))) % 2147483647) || 1;
    var out = arr.slice(0);
    for (var i = out.length - 1; i > 0; i--) {
        s = (s * 48271) % 2147483647;
        var j = s % (i + 1);
        var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
};

/**
 * staggerKeyframesAcrossLayers: { layers, property, keys, interval?, intervalFrames?, startTime?, startFrame?, order?, seed?, easing?, spatial?, replace? }
 * Writes the same keys on every layer, shifting each layer by interval.
 */
MCP.register("staggerKeyframesAcrossLayers", function (args, ctx) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.resolveLayers(comp, MCP.requireArg(args, "layers"));
    var keys = MCP.requireArg(args, "keys");
    if (!MCP.isArray(keys) || !keys.length) { MCP.fail("keys must be a non-empty array of {time or frame, value, easing?}.", "invalid-argument"); }
    var fd = MCP.frameDuration(comp);
    var interval = MCP.durationArg(comp, args, "interval", "intervalFrames", 0.1);
    var startAt = MCP.isDefined(args.startFrame) ? Number(args.startFrame) * fd : MCP.num(args.startTime, 0);
    var order = String(MCP.arg(args, "order", "top-down")).toLowerCase();
    var ordered = layers.slice(0);
    ordered.sort(function (a, b) { return a.index - b.index; });
    if (order === "bottom-up") { ordered.reverse(); }
    else if (order === "random") { ordered = MCP.kf.shuffle(ordered, args.seed); }
    else if (order !== "top-down") { MCP.fail("order must be top-down, bottom-up or random.", "invalid-argument"); }
    var results = [], failed = 0;
    for (var i = 0; i < ordered.length; i++) {
        var L = ordered[i];
        var offset = startAt + i * interval;
        var shifted = [];
        for (var k = 0; k < keys.length; k++) {
            var spec = keys[k] || {};
            var base = MCP.isDefined(spec.frame) ? Number(spec.frame) * fd : MCP.num(spec.time, 0);
            var one = { time: base + offset, value: spec.value };
            if (MCP.isDefined(spec.easing)) { one.easing = spec.easing; }
            shifted.push(one);
        }
        var call = { comp: { id: comp.id }, layer: { index: L.index }, property: args.property, keys: shifted, easing: args.easing, spatial: args.spatial, replace: args.replace };
        try {
            var res = MCP.invoke("setKeyframesBulk", call, ctx);
            results.push({ order: i, status: "ok", layer: res.layer, property: res.property.path, offset: MCP.round(offset), offsetFrame: MCP.frameOf(comp, offset), keyframesWritten: res.keyframesWritten, keyframes: res.keyframes });
        } catch (err) {
            failed++;
            results.push({ order: i, status: "error", layer: MCP.serialize.layerRef(L), offset: MCP.round(offset), error: MCP.errorInfo(err, "setKeyframesBulk", ctx ? ctx.id : null) });
        }
    }
    return { composition: MCP.serialize.compRef(comp), layers: results.length, failed: failed, interval: MCP.round(interval), order: order, results: results };
}, { mutating: true });
