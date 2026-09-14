/*
 * Easing. One schema for layer keyframes, effect keyframes, masks, everything.
 *
 * Model: an easing value describes the SEGMENT that arrives at a keyframe,
 * that is the motion from the previous key to this one. Applying easing E to
 * key i sets the OUT handle of key i-1 and the IN handle of key i. On the
 * first key (no previous key) E sets that key's OUT handle instead.
 *
 * Presets (speed / influence pairs; influence is a percentage of the segment):
 *   linear       both handles linear
 *   ease         Easy Ease: 0 / 33.33 on both sides
 *   ease-in      slow start: out handle of previous key 0 / 66, arrival linear
 *   ease-out     slow end: arrival handle 0 / 66, start linear (use for entrances)
 *   ease-in-out  0 / 66 on both sides
 *   smooth       0 / 33 on both sides and the arriving key set to continuous auto-bezier
 *   snappy       0 / 75 leaving the previous key, 0 / 25 arriving
 *   overshoot    handled by the caller (an extra key is inserted). Alone it behaves like ease-out with 80 influence.
 *   hold         previous key holds its value until this key
 *   {type:"custom", inSpeed, inInfluence, outSpeed, outInfluence}
 *   {type:"bezier", x1, y1, x2, y2}   CSS cubic-bezier approximated to speed/influence:
 *        outInfluence = x1 * 100, inInfluence = (1 - x2) * 100,
 *        outSpeed = (y1 / x1) * (value delta / duration), inSpeed = ((1 - y2) / (1 - x2)) * (value delta / duration).
 *        Limits: y values outside 0..1 cannot be represented (no overshoot), and the mapping
 *        is per segment, so the same curve on a longer segment produces a different speed.
 *
 * Spatial properties (Position, Anchor Point): after every keyframe write the
 * spatial tangents are zeroed so motion paths are straight lines, unless
 * spatial: "auto" is requested, in which case After Effects auto-bezier is kept.
 */

MCP.easing = {};

MCP.easing.PRESETS = {
    "linear":      { kind: "linear" },
    "ease":        { kind: "bezier", out: { speed: 0, influence: 33.33 }, inn: { speed: 0, influence: 33.33 } },
    "ease-in":     { kind: "bezier", out: { speed: 0, influence: 66 },    inn: null },
    "ease-out":    { kind: "bezier", out: null,                            inn: { speed: 0, influence: 66 } },
    "ease-in-out": { kind: "bezier", out: { speed: 0, influence: 66 },    inn: { speed: 0, influence: 66 } },
    "smooth":      { kind: "bezier", out: { speed: 0, influence: 33 },    inn: { speed: 0, influence: 33 }, continuous: true },
    "snappy":      { kind: "bezier", out: { speed: 0, influence: 75 },    inn: { speed: 0, influence: 25 } },
    "overshoot":   { kind: "bezier", out: null,                            inn: { speed: 0, influence: 80 }, overshoot: true },
    "hold":        { kind: "hold" }
};

MCP.easing.presetNames = function () { return MCP.keys(MCP.easing.PRESETS); };

MCP.easing.clampInfluence = function (v) {
    return MCP.clamp(Number(v), 0.1, 100);
};

/** Normalises any easing input to {kind, out, inn, continuous, overshoot, bezier}. */
MCP.easing.resolve = function (spec) {
    if (!MCP.isDefined(spec)) { return null; }
    if (typeof spec === "string") {
        var key = spec.toLowerCase();
        if (key.indexOf("@style.") === 0) {
            MCP.fail("Style references such as '" + spec + "' must be resolved by the server before reaching After Effects.", "invalid-argument");
        }
        var p = MCP.easing.PRESETS[key];
        if (!p) { MCP.fail("Unknown easing preset '" + spec + "'. Use one of: " + MCP.easing.presetNames().join(", "), "invalid-argument"); }
        return p;
    }
    if (typeof spec === "object") {
        if (spec.type === "bezier") {
            return { kind: "bezier", bezier: { x1: Number(spec.x1), y1: Number(spec.y1), x2: Number(spec.x2), y2: Number(spec.y2) } };
        }
        if (spec.type === "custom" || MCP.isDefined(spec.inInfluence) || MCP.isDefined(spec.outInfluence) || MCP.isDefined(spec.inSpeed) || MCP.isDefined(spec.outSpeed)) {
            return {
                kind: "bezier",
                out: { speed: MCP.num(spec.outSpeed, 0), influence: MCP.easing.clampInfluence(MCP.num(spec.outInfluence, 33.33)) },
                inn: { speed: MCP.num(spec.inSpeed, 0), influence: MCP.easing.clampInfluence(MCP.num(spec.inInfluence, 33.33)) }
            };
        }
        if (MCP.isDefined(spec.preset)) { return MCP.easing.resolve(spec.preset); }
    }
    MCP.fail("Easing must be a preset name, {type:'custom',...} or {type:'bezier',...}.", "invalid-argument");
    return null;
};

/** Number of KeyframeEase entries After Effects expects for this property. */
MCP.easing.dims = function (prop) {
    try {
        if (prop.isSpatial) { return 1; }
        var v = prop.value;
        if (MCP.isArray(v)) { return v.length; }
    } catch (e) {}
    return 1;
};

MCP.easing.easeArray = function (n, speed, influence) {
    var arr = [];
    for (var i = 0; i < n; i++) { arr.push(new KeyframeEase(speed, influence)); }
    return arr;
};

MCP.easing.easeArrayPerDim = function (speeds, influence) {
    var arr = [];
    for (var i = 0; i < speeds.length; i++) { arr.push(new KeyframeEase(speeds[i], influence)); }
    return arr;
};

/** Sets temporal ease trying the property's dimension count first, then 1. */
MCP.easing.setTemporalEase = function (prop, i, inArr, outArr) {
    try { prop.setTemporalEaseAtKey(i, inArr, outArr); return true; } catch (e1) {}
    try { prop.setTemporalEaseAtKey(i, [inArr[0]], [outArr[0]]); return true; } catch (e2) {}
    return false;
};

MCP.easing.valueDelta = function (prop, fromKey, toKey) {
    var a = prop.keyValue(fromKey), b = prop.keyValue(toKey);
    var dt = prop.keyTime(toKey) - prop.keyTime(fromKey);
    if (dt <= 0) { dt = 1e-6; }
    var deltas = [];
    if (MCP.isArray(a) && MCP.isArray(b)) {
        for (var d = 0; d < a.length; d++) { deltas.push((Number(b[d]) - Number(a[d])) / dt); }
    } else if (typeof a === "number" && typeof b === "number") {
        deltas.push((b - a) / dt);
    } else {
        deltas.push(0);
    }
    return deltas;
};

/** Bezier -> per-handle speed arrays for the segment prevKey -> key. */
MCP.easing.bezierHandles = function (prop, prevKey, key, bz) {
    var rates = MCP.easing.valueDelta(prop, prevKey, key);
    var n = MCP.easing.dims(prop);
    var outSpeeds = [], inSpeeds = [];
    var x1 = MCP.clamp(bz.x1, 0.001, 1), x2 = MCP.clamp(bz.x2, 0, 0.999);
    var slopeOut = MCP.clamp(bz.y1 / x1, 0, 10);
    var slopeIn = MCP.clamp((1 - bz.y2) / (1 - x2), 0, 10);
    for (var i = 0; i < n; i++) {
        var rate = rates[i] !== undefined ? rates[i] : rates[0];
        if (prop.isSpatial) {
            var mag = 0;
            for (var d = 0; d < rates.length; d++) { mag += rates[d] * rates[d]; }
            rate = Math.sqrt(mag);
        }
        outSpeeds.push(slopeOut * rate);
        inSpeeds.push(slopeIn * rate);
    }
    return {
        outInfluence: MCP.easing.clampInfluence(x1 * 100),
        inInfluence: MCP.easing.clampInfluence((1 - x2) * 100),
        outSpeeds: outSpeeds,
        inSpeeds: inSpeeds
    };
};

MCP.easing.setInterp = function (prop, i, inType, outType) {
    var curIn = prop.keyInInterpolationType(i), curOut = prop.keyOutInterpolationType(i);
    prop.setInterpolationTypeAtKey(i, inType || curIn, outType || curOut);
};

/** Applies the OUT side of a resolved spec to key i. */
MCP.easing.applyOut = function (prop, i, res, handles) {
    var LINEAR = KeyframeInterpolationType.LINEAR, BEZIER = KeyframeInterpolationType.BEZIER, HOLD = KeyframeInterpolationType.HOLD;
    if (res.kind === "hold") { MCP.easing.setInterp(prop, i, null, HOLD); return; }
    if (res.kind === "linear" || (!res.out && !handles)) { MCP.easing.setInterp(prop, i, null, LINEAR); return; }
    try { prop.setTemporalAutoBezierAtKey(i, false); } catch (e0) {}
    try { prop.setTemporalContinuousAtKey(i, false); } catch (e1) {}
    MCP.easing.setInterp(prop, i, null, BEZIER);
    var n = MCP.easing.dims(prop);
    var inArr = prop.keyInTemporalEase(i);
    var outArr = handles
        ? MCP.easing.easeArrayPerDim(handles.outSpeeds, handles.outInfluence)
        : MCP.easing.easeArray(n, res.out.speed, MCP.easing.clampInfluence(res.out.influence));
    MCP.easing.setTemporalEase(prop, i, inArr, outArr);
};

/** Applies the IN side of a resolved spec to key i. */
MCP.easing.applyIn = function (prop, i, res, handles) {
    var LINEAR = KeyframeInterpolationType.LINEAR, BEZIER = KeyframeInterpolationType.BEZIER;
    if (res.kind === "hold") { return; }
    if (res.kind === "linear" || (!res.inn && !handles)) { MCP.easing.setInterp(prop, i, LINEAR, null); return; }
    try { prop.setTemporalAutoBezierAtKey(i, false); } catch (e0) {}
    try { prop.setTemporalContinuousAtKey(i, false); } catch (e1) {}
    MCP.easing.setInterp(prop, i, BEZIER, null);
    var n = MCP.easing.dims(prop);
    var outArr = prop.keyOutTemporalEase(i);
    var inArr = handles
        ? MCP.easing.easeArrayPerDim(handles.inSpeeds, handles.inInfluence)
        : MCP.easing.easeArray(n, res.inn.speed, MCP.easing.clampInfluence(res.inn.influence));
    MCP.easing.setTemporalEase(prop, i, inArr, outArr);
    if (res.continuous) {
        try { prop.setTemporalContinuousAtKey(i, true); prop.setTemporalAutoBezierAtKey(i, true); } catch (e2) {}
    }
};

/**
 * Applies easing to the segment arriving at key i (out of i-1, in of i).
 * On the first key applies the out side only.
 */
MCP.easing.applySegment = function (prop, i, spec) {
    var res = MCP.easing.resolve(spec);
    if (!res) { return false; }
    var handles = null;
    if (res.bezier && i > 1) { handles = MCP.easing.bezierHandles(prop, i - 1, i, res.bezier); }
    if (res.bezier && i <= 1) { res = MCP.easing.PRESETS["ease"]; }
    if (i > 1) { MCP.easing.applyOut(prop, i - 1, res, handles); }
    MCP.easing.applyIn(prop, i, res, handles);
    if (i === 1 && res.kind !== "hold") { MCP.easing.applyOut(prop, 1, res, null); }
    return true;
};

/** Applies the same easing to several keys (each as the arriving key). */
MCP.easing.applyToKeys = function (prop, indices, spec) {
    for (var k = 0; k < indices.length; k++) { MCP.easing.applySegment(prop, indices[k], spec); }
    return indices.length;
};

/** Straight or auto-bezier motion path on a spatial key. */
MCP.easing.applySpatial = function (prop, i, mode) {
    var spatial = false;
    try { spatial = !!prop.isSpatial; } catch (e) { spatial = false; }
    if (!spatial) { return; }
    var m = mode || "linear";
    try {
        if (m === "auto") {
            prop.setSpatialAutoBezierAtKey(i, true);
            prop.setSpatialContinuousAtKey(i, true);
        } else {
            prop.setSpatialAutoBezierAtKey(i, false);
            prop.setSpatialContinuousAtKey(i, false);
            var v = prop.keyValue(i);
            var zeros = [];
            for (var d = 0; d < (MCP.isArray(v) ? v.length : 1); d++) { zeros.push(0); }
            prop.setSpatialTangentsAtKey(i, zeros, zeros);
        }
    } catch (e2) {}
};

/** Overshoot helper: the extra key inserted before key (t1, v1) for a segment from (t0, v0). */
MCP.easing.overshootKey = function (t0, v0, t1, v1, amount, position) {
    var amt = MCP.isDefined(amount) ? Number(amount) : 0.12;
    var pos = MCP.isDefined(position) ? Number(position) : 0.75;
    var t = t0 + (t1 - t0) * pos;
    var v;
    if (MCP.isArray(v1) && MCP.isArray(v0)) {
        v = [];
        for (var i = 0; i < v1.length; i++) { v.push(Number(v1[i]) + (Number(v1[i]) - Number(v0[i])) * amt); }
    } else {
        v = Number(v1) + (Number(v1) - Number(v0)) * amt;
    }
    return { time: t, value: v };
};

/** Index of the key at time t (within a frame tolerance) or -1. */
MCP.easing.keyIndexAtTime = function (prop, t, tolerance) {
    var tol = MCP.isDefined(tolerance) ? tolerance : 1e-4;
    if (!prop.numKeys) { return -1; }
    var i = prop.nearestKeyIndex(t);
    if (Math.abs(prop.keyTime(i) - t) <= tol) { return i; }
    return -1;
};

/** Sets a value at time t and returns the key index. Handles spatial tangents. */
MCP.easing.setKey = function (prop, t, value, spatialMode) {
    if (!prop.canVaryOverTime) {
        MCP.fail("Property '" + MCP.pathOf(prop).path + "' cannot be keyframed.", "unsupported");
    }
    prop.setValueAtTime(t, value);
    var i = MCP.easing.keyIndexAtTime(prop, t, 1e-3);
    if (i < 0) { i = prop.nearestKeyIndex(t); }
    MCP.easing.applySpatial(prop, i, spatialMode);
    return i;
};
