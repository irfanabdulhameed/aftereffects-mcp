/*
 * Time commands: time remapping, freeze frames, speed, reverse, frame
 * blending and looping.
 */

MCP.time = {};

MCP.time.remapProp = function (layer) {
    var p = _mcpTry(function () { return layer.property("ADBE Time Remapping"); }, null);
    if (!p) { MCP.fail("Layer '" + layer.name + "' has no Time Remap property. Only footage, precomp and other time-based layers can be remapped.", "unsupported"); }
    return p;
};

/** Turns time remapping on when it is off. Returns true when it was just enabled. */
MCP.time.ensureRemap = function (layer) {
    if (_mcpTry(function () { return layer.timeRemapEnabled; }, false)) { return false; }
    var can = _mcpTry(function () { return layer.canSetTimeRemapEnabled; }, false);
    if (!can) {
        MCP.fail("Layer '" + layer.name + "' (" + MCP.layerType(layer) + ") cannot be time remapped. Time remap needs a footage, precomp, audio or other time-based source; solids, shapes, text, nulls, cameras and lights do not support it.", "unsupported");
    }
    try { layer.timeRemapEnabled = true; }
    catch (e) { MCP.fail("Could not enable time remap on '" + layer.name + "': " + e.toString(), "script-error"); }
    return true;
};

MCP.time.timing = function (comp, layer) {
    return {
        startTime: MCP.round(layer.startTime), inPoint: MCP.round(layer.inPoint), outPoint: MCP.round(layer.outPoint),
        startFrame: MCP.frameOf(comp, layer.startTime), inFrame: MCP.frameOf(comp, layer.inPoint), outFrame: MCP.frameOf(comp, layer.outPoint),
        durationSeconds: MCP.round(layer.outPoint - layer.inPoint), durationFrames: MCP.frameOf(comp, layer.outPoint - layer.inPoint),
        stretch: _mcpTry(function () { return MCP.round(layer.stretch); }, null),
        timeRemapEnabled: _mcpTry(function () { return !!layer.timeRemapEnabled; }, false),
        frameRate: comp.frameRate
    };
};

MCP.time.sourceDuration = function (layer) {
    return _mcpTry(function () { return layer.source ? layer.source.duration : null; }, null);
};

MCP.time.remapState = function (comp, layer) {
    var enabled = _mcpTry(function () { return !!layer.timeRemapEnabled; }, false);
    var out = {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(layer),
        timing: MCP.time.timing(comp, layer),
        sourceDuration: MCP.time.sourceDuration(layer),
        timeRemap: null
    };
    if (enabled) {
        var p = _mcpTry(function () { return MCP.time.remapProp(layer); }, null);
        if (p) { out.timeRemap = MCP.serialize.property(p, { keyframes: true }); }
    }
    return out;
};

MCP.time.blendName = function (layer) {
    return _mcpTry(function () {
        var v = layer.frameBlendingType;
        if (v === FrameBlendingType.NO_FRAME_BLEND) { return "none"; }
        if (v === FrameBlendingType.FRAME_MIX) { return "frame-mix"; }
        if (v === FrameBlendingType.PIXEL_MOTION) { return "pixel-motion"; }
        return String(v);
    }, null);
};

/* -------------------------------------------------------------- commands */

MCP.register("enableTimeRemap", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer;
    var enabled = MCP.bool(args.enabled, true);
    var changed = false;
    if (enabled) {
        changed = MCP.time.ensureRemap(layer);
    } else if (_mcpTry(function () { return layer.timeRemapEnabled; }, false)) {
        try { layer.timeRemapEnabled = false; changed = true; }
        catch (e) { MCP.fail("Could not disable time remap on '" + layer.name + "': " + e.toString(), "script-error"); }
    }
    var out = MCP.time.remapState(r.comp, layer);
    out.enabled = _mcpTry(function () { return !!layer.timeRemapEnabled; }, false);
    out.changed = changed;
    return out;
}, { mutating: true });

MCP.register("setTimeRemapKeyframes", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer, comp = r.comp;
    var keys = args.keys;
    if (!MCP.isArray(keys) || !keys.length) { MCP.fail("keys must be a non-empty array of {time|frame, value|valueFrame, easing?}. value is the source time in seconds.", "invalid-argument"); }
    var justEnabled = MCP.time.ensureRemap(layer);
    var prop = MCP.time.remapProp(layer);
    var fd = MCP.frameDuration(comp);
    if (MCP.bool(args.replace, justEnabled)) { while (prop.numKeys > 0) { prop.removeKey(1); } }
    var resolved = [];
    for (var k = 0; k < keys.length; k++) {
        var spec = keys[k] || {};
        var t = MCP.timeArg(comp, spec, null);
        if (t === null) { MCP.fail("Key " + k + " has no time or frame.", "invalid-argument"); }
        var v = null;
        if (MCP.isDefined(spec.valueFrame)) { v = Number(spec.valueFrame) * fd; }
        else if (MCP.isDefined(spec.value)) { v = Number(spec.value); }
        if (v === null || isNaN(v)) { MCP.fail("Key " + k + " has no value (source seconds) or valueFrame (source frame at the comp frame rate).", "invalid-argument"); }
        resolved.push({ time: t, value: v, easing: MCP.isDefined(spec.easing) ? spec.easing : args.easing });
    }
    resolved.sort(function (a, b) { return a.time - b.time; });
    for (var i = 0; i < resolved.length; i++) {
        var idx = MCP.easing.setKey(prop, resolved[i].time, resolved[i].value);
        if (MCP.isDefined(resolved[i].easing)) { MCP.easing.applySegment(prop, idx, resolved[i].easing); }
    }
    var written = [];
    for (var w = 0; w < resolved.length; w++) {
        var ki = MCP.easing.keyIndexAtTime(prop, resolved[w].time, 1e-3);
        if (ki > 0) { written.push(MCP.serialize.keyframe(prop, ki)); }
    }
    var out = MCP.time.remapState(comp, layer);
    out.keyframesWritten = written.length;
    out.keyframes = written;
    out.replaced = MCP.bool(args.replace, justEnabled);
    return out;
}, { mutating: true });

MCP.register("freezeFrameAt", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer, comp = r.comp;
    var t = MCP.timeArg(comp, args, comp.time);
    MCP.time.ensureRemap(layer);
    var prop = MCP.time.remapProp(layer);
    // With time remap on, the property's value at t is the source time shown at t (start time, trims and stretch included).
    var sourceTime = _mcpTry(function () { return prop.valueAtTime(t, false); }, null);
    if (sourceTime === null) {
        var stretch = _mcpTry(function () { return layer.stretch; }, 100) || 100;
        sourceTime = (t - layer.startTime) * (100 / stretch);
    }
    while (prop.numKeys > 0) { prop.removeKey(1); }
    var keyAt = MCP.bool(args.keyAtTime, false) ? t : layer.inPoint;
    var idx = MCP.easing.setKey(prop, keyAt, sourceTime);
    try { prop.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); } catch (e) {}
    if (MCP.isDefined(args.outPoint) || MCP.isDefined(args.outFrame)) {
        layer.outPoint = MCP.durationArg(comp, args, "outPoint", "outFrame", layer.outPoint);
    } else if (MCP.bool(args.extendToCompEnd, false)) {
        layer.outPoint = comp.duration;
    }
    var out = MCP.time.remapState(comp, layer);
    out.frozenAt = { time: MCP.round(t), frame: MCP.frameOf(comp, t) };
    out.sourceTime = MCP.round(sourceTime);
    out.sourceFrame = MCP.frameOf(comp, sourceTime);
    out.keyframe = MCP.serialize.keyframe(prop, idx);
    return out;
}, { mutating: true });

MCP.register("setSpeed", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer, comp = r.comp;
    var current = _mcpTry(function () { return layer.stretch; }, null);
    if (current === null) { MCP.fail("Layer '" + layer.name + "' has no time stretch.", "unsupported"); }
    var sign = current < 0 ? -1 : 1;
    var target = null, mode = null;
    if (MCP.isDefined(args.percent)) {
        target = Number(args.percent); mode = "percent";
    } else if (MCP.isDefined(args.speedFactor)) {
        var f = Number(args.speedFactor);
        if (!(f > 0)) { MCP.fail("speedFactor must be greater than zero (2 doubles the speed, 0.5 halves it).", "invalid-argument"); }
        target = sign * 100 / f; mode = "speedFactor";
    } else if (MCP.isDefined(args.fitToDuration) || MCP.isDefined(args.fitToDurationFrames)) {
        var wanted = MCP.durationArg(comp, args, "fitToDuration", "fitToDurationFrames", null);
        if (!(wanted > 0)) { MCP.fail("fitToDuration must be greater than zero.", "invalid-argument"); }
        var visible = layer.outPoint - layer.inPoint;
        if (!(visible > 0)) { MCP.fail("Layer '" + layer.name + "' has no duration to fit.", "invalid-argument"); }
        var sourceCovered = visible * 100 / Math.abs(current);
        target = sign * wanted / sourceCovered * 100; mode = "fitToDuration";
    } else {
        MCP.fail("Give percent (stretch, 100 is normal speed), speedFactor (2 is double speed) or fitToDuration / fitToDurationFrames.", "invalid-argument");
    }
    if (target === 0 || isNaN(target)) { MCP.fail("The resulting stretch would be 0. Use a non-zero speed.", "invalid-argument"); }
    if (Math.abs(target) < 1) { target = target < 0 ? -1 : 1; }
    var oldIn = layer.inPoint, oldOut = layer.outPoint;
    var before = MCP.time.timing(comp, layer);
    layer.stretch = target;
    var anchor = MCP.bool(args.keepInPoint, true) ? "in" : "start";
    if (anchor === "in") {
        var shift = layer.inPoint - oldIn;
        if (Math.abs(shift) > 1e-6) { layer.startTime = layer.startTime - shift; }
    }
    var out = {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(layer),
        mode: mode,
        stretch: MCP.round(layer.stretch),
        speedFactor: MCP.round(100 / Math.abs(layer.stretch)),
        reversed: layer.stretch < 0,
        anchoredTo: anchor,
        before: before,
        timing: MCP.time.timing(comp, layer),
        notes: []
    };
    if (Math.abs(target - layer.stretch) > 1e-3) { out.notes.push("After Effects clamped the stretch to " + MCP.round(layer.stretch) + " (requested " + MCP.round(target) + ")."); }
    if (Math.abs(oldOut - layer.outPoint) > 1e-6 && Math.abs(layer.outPoint - comp.duration) < 1e-6) { out.notes.push("The out point reached the composition end; the source may extend past it."); }
    return out;
}, { mutating: true });

MCP.register("reverseLayer", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer, comp = r.comp;
    var current = _mcpTry(function () { return layer.stretch; }, null);
    if (current === null) { MCP.fail("Layer '" + layer.name + "' has no time stretch.", "unsupported"); }
    var before = MCP.time.timing(comp, layer);
    var oldIn = layer.inPoint, oldOut = layer.outPoint;
    layer.stretch = -current;
    // Negative stretch moves the layer; put it back on the same time range.
    var shift = layer.inPoint - oldIn;
    if (Math.abs(shift) > 1e-6) { layer.startTime = layer.startTime - shift; }
    var notes = [];
    if (Math.abs(layer.outPoint - oldOut) > 1e-4) { notes.push("Out point moved from " + MCP.round(oldOut) + " to " + MCP.round(layer.outPoint) + " s after reversing; adjust with set-layer-timing if needed."); }
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(layer),
        stretch: MCP.round(layer.stretch),
        reversed: layer.stretch < 0,
        before: before,
        timing: MCP.time.timing(comp, layer),
        notes: notes
    };
}, { mutating: true });

MCP.register("setFrameBlending", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer, comp = r.comp;
    var mode = String(MCP.arg(args, "mode", "frame-mix")).toLowerCase().replace(/[\s_]+/g, "-");
    var map = { "none": "NO_FRAME_BLEND", "off": "NO_FRAME_BLEND", "frame-mix": "FRAME_MIX", "pixel-motion": "PIXEL_MOTION" };
    if (!map[mode]) { MCP.fail("Unknown frame blending mode '" + mode + "'. Use none, frame-mix or pixel-motion.", "invalid-argument"); }
    if (!_mcpTry(function () { return layer.canSetTimeRemapEnabled || layer.source instanceof CompItem || layer.source instanceof FootageItem; }, false)) {
        MCP.fail("Layer '" + layer.name + "' (" + MCP.layerType(layer) + ") does not support frame blending. It needs a footage or precomp source.", "unsupported");
    }
    try { layer.frameBlendingType = FrameBlendingType[map[mode]]; }
    catch (e) { MCP.fail("Could not set frame blending on '" + layer.name + "': " + e.toString(), "script-error"); }
    var compSwitch = MCP.isDefined(args.compSwitch) ? MCP.bool(args.compSwitch, true) : (mode !== "none" && mode !== "off");
    var compChanged = false;
    if (MCP.isDefined(args.compSwitch) || (mode !== "none" && mode !== "off")) {
        try { if (comp.frameBlending !== compSwitch) { comp.frameBlending = compSwitch; compChanged = true; } } catch (e2) {}
    }
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(layer),
        frameBlending: MCP.time.blendName(layer),
        layerSwitch: _mcpTry(function () { return !!layer.frameBlending; }, null),
        compFrameBlending: _mcpTry(function () { return !!comp.frameBlending; }, null),
        compSwitchChanged: compChanged
    };
}, { mutating: true });

MCP.register("loopLayer", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer, comp = r.comp;
    var fd = MCP.frameDuration(comp);
    var mode = String(MCP.arg(args, "mode", "cycle")).toLowerCase().replace(/[\s_]+/g, "-");
    var modes = { "cycle": "cycle", "pingpong": "pingpong", "ping-pong": "pingpong", "offset": "offset", "continue": "continue" };
    if (!modes[mode]) { MCP.fail("Unknown loop mode '" + mode + "'. Use cycle, pingpong, offset or continue.", "invalid-argument"); }
    var loopMode = modes[mode];
    var notes = [];
    var justEnabled = MCP.time.ensureRemap(layer);
    var prop = MCP.time.remapProp(layer);
    if (prop.numKeys < 2) {
        MCP.fail("Time Remap on '" + layer.name + "' has fewer than two keyframes, so there is nothing to loop. Disable and re-enable time remap, or set keys with set-time-remap-keyframes.", "invalid-argument");
    }
    var sourceDuration = MCP.time.sourceDuration(layer);
    var fixed = false;
    if (MCP.bool(args.fixLastFrame, true)) {
        var last = prop.numKeys;
        var lastTime = prop.keyTime(last), lastValue = Number(prop.keyValue(last));
        var endsOnDuration = sourceDuration !== null ? Math.abs(lastValue - sourceDuration) < fd / 2 : justEnabled;
        if (endsOnDuration && last > 1 && (lastTime - fd) > prop.keyTime(last - 1) + 1e-6) {
            // The last key sits one frame past the final source frame; pulling it back one frame removes the duplicated frame at the loop seam.
            prop.removeKey(last);
            var ni = MCP.easing.setKey(prop, lastTime - fd, lastValue - fd);
            try { prop.setInterpolationTypeAtKey(ni, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR); } catch (e) {}
            fixed = true;
            notes.push("Last Time Remap key moved one frame earlier (to " + MCP.round(lastTime - fd) + " s, value " + MCP.round(lastValue - fd) + " s) so the final frame is not repeated at the seam.");
        }
    }
    var expr = 'loopOut("' + loopMode + '")';
    var loopIn = MCP.bool(args.loopBefore, false);
    if (loopIn) { expr = 'loopOut("' + loopMode + '") + loopIn("' + loopMode + '") - value'; }
    try { prop.expression = expr; }
    catch (e2) { MCP.fail("Could not set the loop expression on Time Remap: " + e2.toString(), "script-error"); }
    var outPoint;
    if (MCP.isDefined(args.outPoint) || MCP.isDefined(args.outFrame)) { outPoint = MCP.durationArg(comp, args, "outPoint", "outFrame", comp.duration); }
    else if (MCP.isDefined(args.duration) || MCP.isDefined(args.durationFrames)) { outPoint = layer.inPoint + MCP.durationArg(comp, args, "duration", "durationFrames", comp.duration); }
    else { outPoint = comp.duration; }
    try { layer.outPoint = outPoint; }
    catch (e3) { notes.push("Could not extend the out point to " + MCP.round(outPoint) + " s: " + e3.toString()); }
    var out = MCP.time.remapState(comp, layer);
    out.mode = loopMode;
    out.expression = expr;
    out.expressionError = _mcpTry(function () { return prop.expressionError || ""; }, "");
    out.lastKeyFixed = fixed;
    out.notes = notes;
    return out;
}, { mutating: true });
