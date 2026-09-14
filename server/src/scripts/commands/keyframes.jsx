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
