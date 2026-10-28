/*
 * animate commands: one-call animation shortcuts built the way an animator
 * builds them by hand. A move is two eased keys (three for a press or an
 * overshoot), typing and word reveals are text animators, and repeated or
 * derived motion is an expression driven by a slider or by markers instead
 * of copied keys. No command writes a key on every frame.
 *
 * Every key goes through MCP.easing. The default eases set speed 0 at both
 * keys and shape the curve with influence (percent of the segment):
 *   EASE_LAND    leave 25, arrive 100: a fast attack and a long landing
 *                (entrances and moves decelerate into place).
 *   EASE_EXIT    leave 85, arrive 15: a long acceleration out of the rest
 *                state (exits accelerate away).
 *   EASE_WORDS   leave 33.3, arrive 80: the Start keys of a word reveal.
 *   EASE_RIPPLE  leave 12, arrive 100: a click ring spikes on the click and
 *                creeps to its end size.
 * Nothing overshoots unless a call asks for it.
 */

MCP.animate = {};

MCP.animate.EASE_LAND = { type: "custom", outSpeed: 0, outInfluence: 25, inSpeed: 0, inInfluence: 100 };
MCP.animate.EASE_EXIT = { type: "custom", outSpeed: 0, outInfluence: 85, inSpeed: 0, inInfluence: 15 };
MCP.animate.EASE_WORDS = { type: "custom", outSpeed: 0, outInfluence: 33.3, inSpeed: 0, inInfluence: 80 };
MCP.animate.EASE_RIPPLE = { type: "custom", outSpeed: 0, outInfluence: 12, inSpeed: 0, inInfluence: 100 };

MCP.animate.LAND_TEXT = "landing (speed 0, influence 25 leaving, 100 arriving)";
MCP.animate.EXIT_TEXT = "exit (speed 0, influence 85 leaving, 15 arriving)";

MCP.animate.BLUR_NAME = "Transition Blur";
MCP.animate.BOUNDS_NAME = "Transition Bounds";

/* ---------------------------------------------------------------- helpers */

/** A time from {secName | frameName} snapped to a whole frame. frameName wins. */
MCP.animate.timeOf = function (comp, args, secName, frameName, fallback) {
    return MCP.snapToFrame(comp, MCP.durationArg(comp, args, secName, frameName, fallback));
};

/** True when either the seconds or the frames field is present. */
MCP.animate.has = function (args, secName, frameName) {
    return MCP.isDefined(args[secName]) || MCP.isDefined(args[frameName]);
};

/** A positive duration from {duration | durationFrames}, snapped to whole frames (at least one). */
MCP.animate.span = function (comp, args, fallback) {
    var d = MCP.durationArg(comp, args, "duration", "durationFrames", fallback);
    if (!(Number(d) > 0)) { MCP.fail("duration must be greater than 0.", "invalid-argument"); }
    var s = MCP.snapToFrame(comp, Number(d));
    return s > 0 ? s : MCP.frameDuration(comp);
};

/** The keyed (pre-expression) value of a property at time t. */
MCP.animate.valueAt = function (prop, t) {
    var v = null;
    try { v = prop.valueAtTime(t, true); } catch (e) { v = null; }
    if (v === null || v === undefined) { v = prop.value; }
    return v;
};

MCP.animate.raw = function (v) {
    return MCP.roundValue(MCP.serialize.rawValue(v));
};

/** a + b for numbers and arrays. A number b adds to every dimension. */
MCP.animate.plus = function (a, b) {
    var i, out;
    if (MCP.isArray(a)) {
        out = [];
        for (i = 0; i < a.length; i++) {
            var d = MCP.isArray(b) ? (i < b.length ? Number(b[i]) : 0) : Number(b);
            out.push(Number(a[i]) + d);
        }
        return out;
    }
    return Number(a) + Number(MCP.isArray(b) ? b[0] : b);
};

/** Multiplies the x and y of a scale value by f (z too when withZ). */
MCP.animate.scaleXY = function (v, f, withZ) {
    if (!MCP.isArray(v)) { return Number(v) * f; }
    var out = [];
    for (var i = 0; i < v.length; i++) { out.push(i < 2 || withZ ? Number(v[i]) * f : Number(v[i])); }
    return out;
};

/** An array as long as ref filled with n (or n when ref is a number). */
MCP.animate.fill = function (ref, n) {
    if (!MCP.isArray(ref)) { return n; }
    var out = [];
    for (var i = 0; i < ref.length; i++) { out.push(n); }
    return out;
};

MCP.animate.valueType = function (prop) {
    return _mcpTry(function () { return prop.propertyValueType; }, null);
};

/** Turns a JSON value into what prop takes: any colour form for colours, text, numbers, arrays. */
MCP.animate.coerce = function (prop, raw) {
    if (MCP.animate.valueType(prop) === PropertyValueType.COLOR) { return MCP.color.rgba(raw); }
    return MCP.valueForProperty(prop, raw);
};

/** Pads or trims an array value to the length of ref; a bare number for an array property is an error. */
MCP.animate.fit = function (v, ref, label) {
    if (!MCP.isArray(ref)) { return v; }
    if (!MCP.isArray(v)) {
        if (typeof v === "number") {
            MCP.fail(label + " must be an array of " + ref.length + " numbers for this property, for example " + JSON.stringify(MCP.roundValue(ref)) + ".", "invalid-argument");
        }
        return v;
    }
    var out = [];
    for (var i = 0; i < ref.length; i++) { out.push(i < v.length ? Number(v[i]) : Number(ref[i])); }
    return out;
};

/** Fails for properties that cannot carry an eased two-key move. */
MCP.animate.requireMovable = function (prop) {
    var path = MCP.pathOf(prop).path;
    var ok = _mcpTry(function () { return !!prop.canVaryOverTime; }, false);
    if (!ok) { MCP.fail("Property '" + path + "' cannot be keyframed.", "unsupported"); }
    var vt = MCP.animate.valueType(prop);
    if (vt === PropertyValueType.TEXT_DOCUMENT) { MCP.fail("Source Text only takes hold keys. Use set-text with a time for a word change, or typewriter-text and word-by-word-reveal for type-on.", "unsupported"); }
    if (vt === PropertyValueType.MARKER || vt === PropertyValueType.NO_VALUE || vt === PropertyValueType.LAYER_INDEX || vt === PropertyValueType.MASK_INDEX) {
        MCP.fail("Property '" + path + "' holds no animatable value.", "unsupported");
    }
};

/** The key a little past v1 shortly before t1 (overshoot). */
MCP.animate.overshootKey = function (comp, t0, v0, t1, v1, amount, position) {
    var k = MCP.easing.overshootKey(t0, v0, t1, v1, amount, position);
    k.time = MCP.snapToFrame(comp, k.time);
    return k;
};

/** The key a little against the move shortly after t0 (anticipation, the mirror of an overshoot). */
MCP.animate.anticipationKey = function (comp, t0, v0, t1, v1, amount, position) {
    var t = MCP.snapToFrame(comp, t0 + (t1 - t0) * position);
    var v, i;
    if (MCP.isArray(v0) && MCP.isArray(v1)) {
        v = [];
        for (i = 0; i < v0.length; i++) { v.push(Number(v0[i]) - (Number(v1[i]) - Number(v0[i])) * amount); }
    } else {
        v = Number(v0) - (Number(v1) - Number(v0)) * amount;
    }
    return { time: t, value: v };
};

/** Serialized keys at the given times, in order. */
MCP.animate.keysAt = function (prop, times) {
    var out = [];
    for (var k = 0; k < times.length; k++) {
        var ki = MCP.easing.keyIndexAtTime(prop, times[k], 1e-3);
        if (ki > 0) { out.push(MCP.serialize.keyframe(prop, ki)); }
    }
    return out;
};

/**
 * One move on prop: a key at t0 (v0) and a key at t1 (v1). easing describes
 * the arrival at t1 (default EASE_LAND). opts.overshoot adds one key past v1
 * near the end (so does easing "overshoot"); opts.anticipate adds one key
 * against the move near the start. Extra keys need a span of 3 frames or more.
 * opts: {comp, spatial, overshoot, anticipate, amount, position}.
 * Returns the keys written, serialized, in time order.
 */
MCP.animate.keyMove = function (prop, t0, v0, t1, v1, easing, opts) {
    var o = opts || {};
    var comp = o.comp;
    var spec = MCP.isDefined(easing) ? easing : MCP.animate.EASE_LAND;
    var extra = null;
    var fd = MCP.frameDuration(comp);
    var room = (t1 - t0) >= 3 * fd - 1e-6;
    if (room && (spec === "overshoot" || MCP.bool(o.overshoot, false))) {
        extra = MCP.animate.overshootKey(comp, t0, v0, t1, v1, MCP.num(o.amount, 0.08), MCP.num(o.position, 0.75));
        extra.easing = spec === "overshoot" ? MCP.animate.EASE_LAND : spec;
        spec = MCP.animate.EASE_LAND;
    } else if (room && MCP.bool(o.anticipate, false)) {
        extra = MCP.animate.anticipationKey(comp, t0, v0, t1, v1, MCP.num(o.amount, 0.08), MCP.num(o.position, 0.3));
        extra.easing = "ease";
    } else if (spec === "overshoot") {
        spec = MCP.animate.EASE_LAND;
    }
    if (extra && (extra.time <= t0 + 1e-6 || extra.time >= t1 - 1e-6)) { extra = null; }
    var times = [t0];
    MCP.easing.setKey(prop, t0, v0, o.spatial);
    if (extra) {
        var xi = MCP.easing.setKey(prop, extra.time, extra.value, o.spatial);
        MCP.easing.applySegment(prop, xi, extra.easing);
        times.push(extra.time);
    }
    var i1 = MCP.easing.setKey(prop, t1, v1, o.spatial);
    MCP.easing.applySegment(prop, i1, spec);
    times.push(t1);
    return MCP.animate.keysAt(prop, times);
};

/** Layers in the requested order: top-down (timeline), bottom-up, random (seeded) or as-given. */
MCP.animate.ordered = function (layers, order, seed) {
    var o = String(MCP.isDefined(order) ? order : "top-down").toLowerCase();
    var seen = {}, list = [], i;
    for (i = 0; i < layers.length; i++) {
        if (seen[layers[i].index]) { continue; }
        seen[layers[i].index] = true;
        list.push(layers[i]);
    }
    if (o === "as-given") { return list; }
    list.sort(function (a, b) { return a.index - b.index; });
    if (o === "bottom-up") { list.reverse(); }
    else if (o === "random") { list = MCP.kf.shuffle(list, MCP.isDefined(seed) ? seed : 1); }
    else if (o !== "top-down") { MCP.fail("order must be top-down, bottom-up, random or as-given.", "invalid-argument"); }
    return list;
};

/** A layer name not used in the composition yet. */
MCP.animate.uniqueLayerName = function (comp, base) {
    var used = {}, i;
    for (i = 1; i <= comp.numLayers; i++) { used[comp.layer(i).name] = true; }
    if (!used[base]) { return base; }
    for (i = 2; i < 1000; i++) { if (!used[base + " " + i]) { return base + " " + i; } }
    return base + " " + new Date().getTime();
};

/** A child name not used in a property group yet. */
MCP.animate.uniqueChildName = function (group, base) {
    var used = {}, i;
    for (i = 1; i <= group.numProperties; i++) { used[group.property(i).name] = true; }
    if (!used[base]) { return base; }
    for (i = 2; i < 1000; i++) { if (!used[base + " " + i]) { return base + " " + i; } }
    return base + " " + new Date().getTime();
};

/** Fails when an expression would reference a layer by a name other layers share. */
MCP.animate.requireUniqueName = function (comp, layer, role) {
    var count = 0;
    for (var i = 1; i <= comp.numLayers; i++) { if (comp.layer(i).name === layer.name) { count++; } }
    if (count > 1) {
        MCP.fail("The " + role + " layer '" + layer.name + "' shares its name with " + (count - 1) + " other layer(s), and the expression finds layers by name. Rename it first (rename-layer).", "ambiguous");
    }
};

MCP.animate.expressionState = function (prop) {
    return {
        property: MCP.pathOf(prop).path,
        hasExpression: _mcpTry(function () { return prop.expression !== ""; }, false),
        enabled: _mcpTry(function () { return prop.expressionEnabled; }, null),
        error: _mcpTry(function () { return prop.expressionError || ""; }, "")
    };
};

/** Sets an expression and returns its state; an error from After Effects is reported, not thrown. */
MCP.animate.setExpression = function (prop, code) {
    if (!_mcpTry(function () { return prop.canSetExpression; }, false)) {
        MCP.fail("Property '" + MCP.pathOf(prop).path + "' does not accept expressions.", "unsupported");
    }
    prop.expression = code;
    try { prop.expressionEnabled = true; } catch (e) {}
    var st = MCP.animate.expressionState(prop);
    st.expression = code;
    return st;
};

/** Removes the keys and the expression of a property, keeping its current value. */
MCP.animate.clearProp = function (p) {
    if (!p) { return; }
    try { if (p.canSetExpression && p.expression !== "") { p.expression = ""; } } catch (e) {}
    try { while (p.numKeys > 0) { p.removeKey(1); } } catch (e2) {}
};

/** Sets a value trying the given shape, then the 3D or 2D variant (text animator Position and Scale). */
MCP.animate.setFlexible = function (p, value, notes) {
    try { p.setValue(value); return true; } catch (e1) {}
    if (MCP.isArray(value) && value.length === 2) { try { p.setValue([value[0], value[1], 0]); return true; } catch (e2) {} }
    if (MCP.isArray(value) && value.length === 3) { try { p.setValue([value[0], value[1]]); return true; } catch (e3) {} }
    notes.push("Could not set '" + p.name + "' to " + JSON.stringify(value) + ".");
    return false;
};

/** Puts layer directly above ref (Layer has no moveBefore). */
MCP.animate.placeAbove = function (layer, ref) {
    layer.moveAfter(ref);
    ref.moveAfter(layer);
};

/* ------------------------------------------------------------ text helpers */

MCP.animate.requireText = function (layer) {
    if (!(layer instanceof TextLayer)) { MCP.fail("Layer '" + layer.name + "' is not a text layer. Text animators only exist on text layers (create-text-layer).", "invalid-argument"); }
    return layer.property("ADBE Text Properties").property("ADBE Text Document");
};

MCP.animate.animators = function (layer) {
    return layer.property("ADBE Text Properties").property("ADBE Text Animators");
};

MCP.animate.anim = function (layer, idx) {
    return MCP.animate.animators(layer).property(idx);
};

/** Adds a named text animator and returns its index. References are re-fetched by index after every add. */
MCP.animate.newAnimator = function (layer, name) {
    var a = MCP.animate.animators(layer).addProperty("ADBE Text Animator");
    var idx = a.propertyIndex;
    MCP.animate.anim(layer, idx).name = name;
    return idx;
};

/** Adds (or finds) a property on an animator and sets its value. Returns the fresh property or null. */
MCP.animate.animProp = function (layer, idx, matchName, value, notes) {
    var props = MCP.animate.anim(layer, idx).property("ADBE Text Animator Properties");
    var canAdd = false, p = null;
    try { canAdd = props.canAddProperty(matchName); } catch (e0) { canAdd = false; }
    if (canAdd) {
        props.addProperty(matchName);
        p = MCP.childProp(MCP.animate.anim(layer, idx).property("ADBE Text Animator Properties"), matchName);
    } else {
        p = MCP.childProp(props, matchName);
    }
    if (!p) { notes.push("This After Effects cannot add '" + matchName + "' to a text animator."); return null; }
    if (MCP.isDefined(value)) { MCP.animate.setFlexible(p, value, notes); }
    return p;
};

MCP.animate.selectors = function (layer, idx) {
    return MCP.animate.anim(layer, idx).property("ADBE Text Selectors");
};

MCP.animate.sel = function (layer, idx, sIdx) {
    return MCP.animate.selectors(layer, idx).property(sIdx);
};

/** The animator's range selector (reused when After Effects already added one), named name. Returns its index. */
MCP.animate.rangeSelector = function (layer, idx, name) {
    var sels = MCP.animate.selectors(layer, idx);
    var sIdx = 0;
    for (var i = 1; i <= sels.numProperties; i++) {
        if (sels.property(i).matchName === "ADBE Text Selector") { sIdx = i; break; }
    }
    if (!sIdx) { sIdx = sels.addProperty("ADBE Text Selector").propertyIndex; }
    if (name) { MCP.animate.sel(layer, idx, sIdx).name = name; }
    return sIdx;
};

/** Adds an expression selector whose Amount runs code, based on a unit (1 characters, 3 words, 4 lines). */
MCP.animate.expressionSelector = function (layer, idx, name, basedOn, code, notes) {
    var sIdx = MCP.animate.selectors(layer, idx).addProperty("ADBE Text Expressible Selector").propertyIndex;
    if (name) { MCP.animate.sel(layer, idx, sIdx).name = name; }
    MCP.text.setIf(MCP.animate.sel(layer, idx, sIdx), "ADBE Text Range Type2", "Based On", basedOn, [], notes, "basedOn");
    var amount = MCP.text.prop(MCP.animate.sel(layer, idx, sIdx), "ADBE Text Expressible Amount", "Amount");
    if (!amount) { MCP.fail("The expression selector has no Amount property.", "script-error"); }
    return MCP.animate.setExpression(amount, code);
};

MCP.animate.adv = function (sel) {
    return MCP.childProp(sel, "ADBE Text Range Advanced") || sel;
};

/** Characters a range selector counts (line breaks are not characters). */
MCP.animate.textChars = function (s) {
    return String(s).replace(/[\r\n\u0003]/g, "").length;
};

MCP.animate.textWords = function (s) {
    var parts = String(s).split(/[\s\u0003]+/), n = 0;
    for (var i = 0; i < parts.length; i++) { if (parts[i] !== "") { n++; } }
    return n;
};

MCP.animate.textLines = function (s) {
    return String(s).split(/[\r\n\u0003]/).length;
};

/* --------------------------------------------------------- animate-property */

MCP.register("animateProperty", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var list = MCP.requireArg(args, "properties");
    if (!MCP.isArray(list) || !list.length) { MCP.fail("properties must be a non-empty array of {property, to or by, from?}.", "invalid-argument"); }
    var t0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", layer.inPoint);
    var t1 = t0 + MCP.animate.span(comp, args, 0.5);
    var easing = MCP.isDefined(args.easing) ? args.easing : MCP.animate.EASE_LAND;
    var plan = [], i;
    // Resolve every entry first so a bad one writes nothing.
    for (i = 0; i < list.length; i++) {
        var e = list[i] || {};
        var prop = MCP.resolveProperty(layer, MCP.requireArg(e, "property"));
        MCP.animate.requireMovable(prop);
        var cur = MCP.animate.valueAt(prop, t0);
        var from = MCP.isDefined(e.from) ? MCP.animate.fit(MCP.animate.coerce(prop, e.from), cur, "from") : cur;
        var to = null;
        if (MCP.isDefined(e.to)) { to = MCP.animate.fit(MCP.animate.coerce(prop, e.to), cur, "to"); }
        else if (MCP.isDefined(e.by)) { to = MCP.animate.plus(from, MCP.coerceValue(prop, e.by)); }
        else { MCP.fail("Entry " + (i + 1) + " (" + MCP.pathOf(prop).path + ") needs to or by.", "invalid-argument"); }
        if (MCP.animate.valueType(prop) === PropertyValueType.SHAPE && easing === "overshoot") {
            MCP.fail("Path values cannot overshoot. Use another easing for '" + MCP.pathOf(prop).path + "'.", "invalid-argument");
        }
        plan.push({ prop: prop, from: from, to: to });
    }
    var out = [];
    for (i = 0; i < plan.length; i++) {
        var p = plan[i];
        var keys = MCP.animate.keyMove(p.prop, t0, p.from, t1, p.to, easing, { comp: comp, spatial: args.spatial, amount: args.overshootAmount });
        out.push({ property: MCP.pathOf(p.prop).path, from: MCP.animate.raw(p.from), to: MCP.animate.raw(p.to), keys: keys });
    }
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer),
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        easing: MCP.isDefined(args.easing) ? args.easing : MCP.animate.LAND_TEXT,
        properties: out
    };
}, { mutating: true });

/* ------------------------------------------------------- entrances and exits */

MCP.animate.KINDS = { "fade": 1, "rise": 1, "slide": 1, "scale": 1, "blur": 1, "pop": 1 };
MCP.animate.DIRS = { "up": [0, -1], "down": [0, 1], "left": [-1, 0], "right": [1, 0] };

MCP.animate.kindList = function (raw) {
    var list = MCP.isArray(raw) ? raw : [raw];
    var out = [], seen = {};
    for (var i = 0; i < list.length; i++) {
        var k = String(list[i]).toLowerCase();
        if (!MCP.animate.KINDS[k]) { MCP.fail("Unknown kind '" + list[i] + "'. Use fade, rise, slide, scale, blur or pop, or an array of them.", "invalid-argument"); }
        if (!seen[k]) { seen[k] = true; out.push(k); }
    }
    if (!out.length) { MCP.fail("kind needs at least one of fade, rise, slide, scale, blur, pop.", "invalid-argument"); }
    if (seen.rise && seen.slide) { MCP.fail("rise and slide both move Position. Use one: rise is a short slide up (distance 40).", "invalid-argument"); }
    if (seen.scale && seen.pop) { MCP.fail("scale and pop both animate Scale. Use one.", "invalid-argument"); }
    return out;
};

/** The Gaussian Blur shared by entrances and exits on a layer (added once, Repeat Edge Pixels off). */
MCP.animate.blurProp = function (layer, amount, notes) {
    var vector = (layer instanceof TextLayer) || (layer instanceof ShapeLayer);
    var pixels = Math.ceil(Math.abs(Number(amount)) * 2) + 4;
    if (vector) {
        var bounds = MCP.childProp(MCP.effectsGroup(layer), MCP.animate.BOUNDS_NAME);
        if (!bounds) {
            var gb = MCP.fx.addFirstAvailable(layer, ["ADBE GROW BOUNDS"]);
            if (gb) {
                gb.effect.name = MCP.animate.BOUNDS_NAME;
                notes.push("Added Grow Bounds so the blur is not clipped at the layer's content box.");
            }
            bounds = MCP.childProp(MCP.effectsGroup(layer), MCP.animate.BOUNDS_NAME);
        }
        if (bounds) {
            var bp = MCP.childProp(bounds, "ADBE GROW BOUNDS-0001");
            if (bp && _mcpTry(function () { return bp.numKeys === 0 && Number(bp.value) < pixels; }, false)) { try { bp.setValue(pixels); } catch (e0) {} }
        }
    }
    var fx = MCP.childProp(MCP.effectsGroup(layer), MCP.animate.BLUR_NAME);
    if (!fx) {
        var res = MCP.fx.addFirstAvailable(layer, ["ADBE Gaussian Blur 2"]);
        if (!res) { MCP.fail("Gaussian Blur could not be added to '" + layer.name + "'.", "unsupported"); }
        res.effect.name = MCP.animate.BLUR_NAME;
        var rep = MCP.childProp(MCP.childProp(MCP.effectsGroup(layer), MCP.animate.BLUR_NAME), "ADBE Gaussian Blur 2-0003");
        if (rep) { try { rep.setValue(0); } catch (e1) {} }
        fx = MCP.childProp(MCP.effectsGroup(layer), MCP.animate.BLUR_NAME);
        // A new Gaussian Blur is not at 0 on every version (25 on After Effects 26); the layer's resting look is unblurred.
        var fresh = MCP.childProp(fx, "ADBE Gaussian Blur 2-0001");
        if (fresh) { try { fresh.setValue(0); } catch (e2) {} }
    }
    var p = MCP.childProp(fx, "ADBE Gaussian Blur 2-0001");
    if (!p) { MCP.fail("The Blurriness property of '" + MCP.animate.BLUR_NAME + "' was not found.", "script-error"); }
    return p;
};

/** [{prop, rest, offset}] for one kind on one layer. mode "in" or "out". */
MCP.animate.kindTargets = function (comp, layer, kind, mode, restT, args, notes) {
    var tg = _mcpTry(function () { return layer.property("ADBE Transform Group"); }, null);
    if (!tg) { MCP.fail("Layer '" + layer.name + "' has no transform.", "unsupported"); }
    var out = [], rest, prop;
    if (kind === "fade") {
        prop = MCP.childProp(tg, "ADBE Opacity");
        if (!prop) { MCP.fail("Layer '" + layer.name + "' has no Opacity (cameras and lights cannot fade).", "unsupported"); }
        rest = MCP.animate.valueAt(prop, restT);
        if (Number(rest) === 0) { notes.push("Opacity is 0 at the rest time, so the fade shows nothing. Set the layer's Opacity first."); }
        out.push({ prop: prop, rest: rest, offset: 0 });
    } else if (kind === "rise" || kind === "slide") {
        var dirName = kind === "rise" ? "up" : String(MCP.arg(args, "direction", "left")).toLowerCase();
        var dir = MCP.animate.DIRS[dirName];
        if (!dir) { MCP.fail("direction must be up, down, left or right.", "invalid-argument"); }
        var dist = MCP.num(args.distance, kind === "rise" ? 40 : 200);
        var sign = mode === "in" ? -1 : 1;
        var delta = [dir[0] * dist * sign, dir[1] * dist * sign];
        var pos = MCP.childProp(tg, "ADBE Position");
        if (!pos) { MCP.fail("Layer '" + layer.name + "' has no Position.", "unsupported"); }
        if (_mcpTry(function () { return !!pos.dimensionsSeparated; }, false)) {
            for (var ax = 0; ax < 2; ax++) {
                if (delta[ax] === 0) { continue; }
                prop = MCP.childProp(tg, "ADBE Position_" + ax);
                rest = MCP.animate.valueAt(prop, restT);
                out.push({ prop: prop, rest: rest, offset: Number(rest) + delta[ax] });
            }
        } else {
            rest = MCP.animate.valueAt(pos, restT);
            out.push({ prop: pos, rest: rest, offset: MCP.animate.plus(rest, delta) });
        }
        if (layer.parent) { notes.push("Position offsets are in the parent's space ('" + layer.parent.name + "')."); }
    } else if (kind === "scale" || kind === "pop") {
        prop = MCP.childProp(tg, "ADBE Scale");
        if (!prop) { MCP.fail("Layer '" + layer.name + "' has no Scale.", "unsupported"); }
        var pct = kind === "pop" ? MCP.num(args.popScale, 0) : MCP.num(args.scale, 90);
        rest = MCP.animate.valueAt(prop, restT);
        out.push({ prop: prop, rest: rest, offset: MCP.animate.scaleXY(rest, pct / 100, !!layer.threeDLayer) });
    } else if (kind === "blur") {
        var amount = MCP.num(args.blur, 24);
        prop = MCP.animate.blurProp(layer, amount, notes);
        rest = MCP.animate.valueAt(prop, restT);
        out.push({ prop: prop, rest: rest, offset: amount });
    }
    return out;
};

/** Writes the kinds on one layer between t0 and t1. Returns [{kind, property, from, to, keys}]. */
MCP.animate.motionForLayer = function (comp, layer, kinds, mode, t0, t1, args, notes) {
    var restT = mode === "in" ? t1 : t0;
    var easing = MCP.isDefined(args.easing) ? args.easing : (mode === "in" ? MCP.animate.EASE_LAND : MCP.animate.EASE_EXIT);
    var wantOvershoot = MCP.bool(args.overshoot, false);
    var plans = [], k, j;
    // blur first: it may add effects, and property references are taken after that.
    var sorted = [];
    for (k = 0; k < kinds.length; k++) { if (kinds[k] === "blur") { sorted.push(kinds[k]); } }
    for (k = 0; k < kinds.length; k++) { if (kinds[k] !== "blur") { sorted.push(kinds[k]); } }
    // Read every rest value before writing any key on the layer.
    for (k = 0; k < sorted.length; k++) {
        var targets = MCP.animate.kindTargets(comp, layer, sorted[k], mode, restT, args, notes);
        for (j = 0; j < targets.length; j++) { targets[j].kind = sorted[k]; plans.push(targets[j]); }
    }
    var props = [];
    for (k = 0; k < plans.length; k++) {
        var p = plans[k];
        var v0 = mode === "in" ? p.offset : p.rest;
        var v1 = mode === "in" ? p.rest : p.offset;
        var shaped = wantOvershoot && (p.kind === "pop" || p.kind === "scale");
        var keys = MCP.animate.keyMove(p.prop, t0, v0, t1, v1, easing, {
            comp: comp, spatial: "linear",
            overshoot: shaped && mode === "in", anticipate: shaped && mode === "out",
            amount: args.overshootAmount
        });
        props.push({ kind: p.kind, property: MCP.pathOf(p.prop).path, from: MCP.animate.raw(v0), to: MCP.animate.raw(v1), keys: keys });
    }
    return props;
};

MCP.animate.entranceOrExit = function (args, mode, ctx) {
    var comp = MCP.resolveComp(args.comp);
    var layers = MCP.resolveLayers(comp, MCP.requireArg(args, "layers"));
    var kinds = MCP.animate.kindList(MCP.requireArg(args, "kind"));
    var fd = MCP.frameDuration(comp);
    var ordered = MCP.animate.ordered(layers, args.order, args.seed);
    var n = ordered.length, i;
    var dur = MCP.animate.span(comp, args, 1 / 3);
    var staggerFrames = MCP.isDefined(args.staggerFrames) ? Math.max(0, Math.round(Number(args.staggerFrames))) : Math.max(1, Math.round(0.067 / fd));
    var stagger = staggerFrames * fd;
    var hasStart = MCP.animate.has(args, "startTime", "startFrame");
    var hasEnd = MCP.animate.has(args, "endTime", "endFrame");
    var starts = [];
    if (mode === "in") {
        var first = ordered[0].inPoint;
        for (i = 1; i < n; i++) { if (ordered[i].inPoint < first) { first = ordered[i].inPoint; } }
        var base = hasStart ? MCP.animate.timeOf(comp, args, "startTime", "startFrame", 0) : MCP.snapToFrame(comp, first);
        for (i = 0; i < n; i++) { starts.push(base + i * stagger); }
    } else {
        if (hasStart && hasEnd) { MCP.fail("Give the exit an end time or a start time, not both.", "invalid-argument"); }
        if (hasStart) {
            var s0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", 0);
            for (i = 0; i < n; i++) { starts.push(s0 + i * stagger); }
        } else {
            var last = ordered[0].outPoint;
            for (i = 1; i < n; i++) { if (ordered[i].outPoint < last) { last = ordered[i].outPoint; } }
            var end = hasEnd ? MCP.animate.timeOf(comp, args, "endTime", "endFrame", last) : MCP.snapToFrame(comp, last);
            for (i = 0; i < n; i++) { starts.push(end - dur - (n - 1 - i) * stagger); }
        }
    }
    var results = [], failed = 0;
    for (i = 0; i < n; i++) {
        var L = ordered[i];
        var t0 = starts[i], t1 = starts[i] + dur;
        var notes = [];
        try {
            var props = MCP.animate.motionForLayer(comp, L, kinds, mode, t0, t1, args, notes);
            if (t0 < L.inPoint - 1e-6) { notes.push("Starts before the layer's in point, so the first frames of the move are not seen."); }
            if (t1 > L.outPoint + 1e-6) { notes.push("Ends after the layer's out point, so the last frames of the move are not seen."); }
            results.push({
                status: "ok", order: i, layer: MCP.serialize.layerRef(L),
                startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
                properties: props, notes: notes
            });
        } catch (err) {
            failed++;
            results.push({ status: "error", order: i, layer: MCP.serialize.layerRef(L), error: MCP.errorInfo(err, mode === "in" ? "addEntrance" : "addExit", ctx ? ctx.id : null) });
        }
    }
    return {
        composition: MCP.serialize.compRef(comp),
        kinds: kinds,
        duration: MCP.round(dur), durationFrames: MCP.frameOf(comp, dur),
        staggerFrames: staggerFrames, order: String(MCP.arg(args, "order", "top-down")),
        easing: MCP.isDefined(args.easing) ? args.easing : (mode === "in" ? MCP.animate.LAND_TEXT : MCP.animate.EXIT_TEXT),
        count: n, failed: failed, results: results
    };
};

MCP.register("addEntrance", function (args, ctx) {
    return MCP.animate.entranceOrExit(args, "in", ctx);
}, { mutating: true });

MCP.register("addExit", function (args, ctx) {
    return MCP.animate.entranceOrExit(args, "out", ctx);
}, { mutating: true });

/* ----------------------------------------------------------- typewriter-text */

MCP.animate.isCentered = function (j) {
    return j === ParagraphJustification.CENTER_JUSTIFY || j === ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER;
};

MCP.animate.isRight = function (j) {
    return j === ParagraphJustification.RIGHT_JUSTIFY || j === ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT;
};

/** Width the glyph adds to a line in this layer's style: "H" + glyph + "H" minus "HH". */
MCP.animate.glyphAdvance = function (layer, textProp, sourceDoc, glyph, t) {
    var w = [0, 0], samples = ["HH", "H" + glyph + "H"];
    for (var i = 0; i < 2; i++) {
        var d = sourceDoc();
        d.text = samples[i];
        textProp.setValue(d);
        w[i] = _mcpTry(function () { return layer.sourceRectAtTime(t, false).width; }, 0);
    }
    return Math.max(0, w[1] - w[0]);
};

/** Resets a layer's own transform to identity (no keys, no expressions). */
MCP.animate.localIdentity = function (layer) {
    var tg = layer.property("ADBE Transform Group");
    var names = ["ADBE Anchor Point", "ADBE Position", "ADBE Position_0", "ADBE Position_1", "ADBE Position_2", "ADBE Scale", "ADBE Orientation", "ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z", "ADBE Opacity"];
    var i;
    for (i = 0; i < names.length; i++) { MCP.animate.clearProp(MCP.childProp(tg, names[i])); }
    var anchor = MCP.childProp(tg, "ADBE Anchor Point");
    anchor.setValue(MCP.animate.fill(anchor.value, 0));
    var pos = MCP.childProp(tg, "ADBE Position");
    if (_mcpTry(function () { return !!pos.dimensionsSeparated; }, false)) {
        for (i = 0; i < 3; i++) { var pp = MCP.childProp(tg, "ADBE Position_" + i); if (pp) { try { pp.setValue(0); } catch (e0) {} } }
    } else {
        pos.setValue(MCP.animate.fill(pos.value, 0));
    }
    var sc = MCP.childProp(tg, "ADBE Scale");
    sc.setValue(MCP.animate.fill(sc.value, 100));
    var rz = MCP.childProp(tg, "ADBE Rotate Z");
    if (rz) { rz.setValue(0); }
    if (layer.threeDLayer) {
        var extra = ["ADBE Rotate X", "ADBE Rotate Y"];
        for (i = 0; i < extra.length; i++) { var rp = MCP.childProp(tg, extra[i]); if (rp) { try { rp.setValue(0); } catch (e1) {} } }
        var ori = MCP.childProp(tg, "ADBE Orientation");
        if (ori) { try { ori.setValue([0, 0, 0]); } catch (e2) {} }
    }
    var op = MCP.childProp(tg, "ADBE Opacity");
    if (op) { op.setValue(100); }
};

/**
 * The typing cursor: a copy of the typed layer, parented to it with an
 * identity transform so its characters sit exactly on the typed ones. Its
 * text is the typed text plus the cursor glyph. Two text animators with
 * expression selectors read the typed layer's Typing selector: one hides
 * every character except the slot after the last typed one, the other
 * replaces that slot with the glyph (Character Value). Its Opacity blinks
 * while idle and stays on while typing.
 */
/** Checked cursor settings: {glyph, rate, keep, lead, color}. */
MCP.animate.cursorOptions = function (spec) {
    var glyph = MCP.isDefined(spec["char"]) ? String(spec["char"]) : "|";
    if (glyph.length !== 1) { MCP.fail("cursor.char must be one character, for example \"|\" or \"_\".", "invalid-argument"); }
    return {
        glyph: glyph,
        rate: Math.max(0, MCP.num(spec.blinkRate, 2)),
        keep: MCP.bool(spec.keepAfterTyping, true),
        lead: Math.max(0, MCP.num(spec.leadIn, 0)),
        color: spec.color
    };
};

MCP.animate.buildCursor = function (comp, main, dup, t0, animName, opts, notes) {
    var glyph = opts.glyph, rate = opts.rate, keep = opts.keep, lead = opts.lead;
    var expressions = [];
    dup.name = MCP.animate.uniqueLayerName(comp, main.name + " Cursor");

    // Transform: sit exactly on the typed layer.
    MCP.animate.localIdentity(dup);
    dup.parent = main;
    MCP.animate.localIdentity(dup);

    // The copy keeps none of the layer's own text animators: they would hide or move the cursor.
    var dropped = MCP.animate.animators(dup).numProperties;
    while (MCP.animate.animators(dup).numProperties > 0) { MCP.animate.animators(dup).property(1).remove(); }
    if (dropped > 0) { notes.push("The cursor copy leaves out the layer's " + dropped + " other text animator(s); if they move characters, the cursor does not follow them."); }

    // Text: the typed text plus the glyph, static.
    var tp = dup.property("ADBE Text Properties").property("ADBE Text Document");
    MCP.animate.clearProp(tp);
    var sourceDoc = function () { return MCP.animate.valueAt(main.property("ADBE Text Properties").property("ADBE Text Document"), t0); };
    var just = 0;
    var j = _mcpTry(function () { return sourceDoc().justification; }, null);
    if (MCP.animate.isCentered(j)) { just = 0.5; } else if (MCP.animate.isRight(j)) { just = 1; }
    var adv = just > 0 ? MCP.animate.glyphAdvance(dup, tp, sourceDoc, glyph, t0) : 0;
    var doc = sourceDoc();
    doc.text = String(doc.text) + glyph;
    if (MCP.isDefined(opts.color)) {
        try { doc.applyFill = true; } catch (e0) {}
        doc.fillColor = MCP.color.rgb(opts.color);
    }
    tp.setValue(doc);

    // Animators: hide all but the cursor slot, draw the glyph in it.
    var count = "var s = thisLayer.parent.text.animator(" + MCP.expr.str(animName) + ").selector(\"Typing\").start.value;\n" +
        "var n = textTotal - 1;\n" +
        "var c = Math.min(n, Math.max(0, Math.ceil(s * n / 100 - 0.5)));\n";
    var hideIdx = MCP.animate.newAnimator(dup, MCP.animate.uniqueChildName(MCP.animate.animators(dup), "Cursor Hide"));
    MCP.animate.animProp(dup, hideIdx, "ADBE Text Opacity", 0, notes);
    expressions.push(MCP.animate.expressionSelector(dup, hideIdx, "Cursor Slot", 1,
        "// Typing cursor: hide every character except the slot after the last typed one\n" + count + "textIndex == c + 1 ? 0 : 100", notes));
    var glyphIdx = MCP.animate.newAnimator(dup, MCP.animate.uniqueChildName(MCP.animate.animators(dup), "Cursor Glyph"));
    var cv = MCP.animate.animProp(dup, glyphIdx, "ADBE Text Character Replace", glyph.charCodeAt(0), notes);
    if (!cv) { MCP.fail("This After Effects cannot add Character Value to a text animator, which the cursor needs.", "unsupported"); }
    var props = MCP.animate.anim(dup, glyphIdx).property("ADBE Text Animator Properties");
    var range = MCP.text.prop(props, "ADBE Text Character Change Type", "Character Range");
    if (range) { try { range.setValue(2); } catch (e1) { notes.push("Character Range could not be set to Full Unicode."); } }
    else { notes.push("Character Range was not found; if the glyph does not appear, set it to Full Unicode on the Cursor Glyph animator."); }
    expressions.push(MCP.animate.expressionSelector(dup, glyphIdx, "Cursor Slot", 1,
        "// Typing cursor: draw the cursor glyph in the slot after the last typed character\n" + count + "textIndex == c + 1 ? 100 : 0", notes));
    if (adv > 0) {
        var alignIdx = MCP.animate.newAnimator(dup, MCP.animate.uniqueChildName(MCP.animate.animators(dup), "Cursor Align"));
        MCP.animate.animProp(dup, alignIdx, "ADBE Text Position 3D", [MCP.round(adv * just, 3), 0], notes);
        expressions.push(MCP.animate.expressionSelector(dup, alignIdx, "Last Line", 4,
            "// The appended glyph widens the last line; shift that line back over the typed text\ntextIndex == textTotal ? 100 : 0", notes));
    }

    // Blink: solid while typing, blinking while idle.
    var op = dup.property("ADBE Transform Group").property("ADBE Opacity");
    var blink = "// Typing cursor: solid while typing, blinking while idle\n" +
        "var s = thisLayer.parent.text.animator(" + MCP.expr.str(animName) + ").selector(\"Typing\").start;\n" +
        "var t0 = s.numKeys > 0 ? s.key(1).time : 0;\n" +
        "var t1 = s.numKeys > 0 ? s.key(s.numKeys).time : 0;\n" +
        "var rate = " + MCP.expr.num(rate) + ", lead = " + MCP.expr.num(lead) + ", keep = " + (keep ? "true" : "false") + ";\n" +
        "function blink(from) { var k = Math.floor((time - from) * rate * 2 + 0.0001); return (k % 2 + 2) % 2 == 0 ? 100 : 0; }\n" +
        "var o = 0;\n" +
        "if (time >= t0 && time < t1) { o = 100; }\n" +
        "else if (time < t0) { o = time >= t0 - lead ? blink(t0 - lead) : 0; }\n" +
        "else { o = keep ? blink(t1) : 0; }\n" +
        "o * thisLayer.parent.transform.opacity.value / 100;";
    expressions.push(MCP.animate.setExpression(op, blink));
    return {
        layer: MCP.serialize.layerRef(dup), "char": glyph, blinkRate: rate, keepAfterTyping: keep, leadIn: MCP.round(lead),
        alignShift: MCP.round(adv * just, 3), expressions: expressions
    };
};

MCP.register("typewriterText", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var fd = MCP.frameDuration(comp);
    var textProp = MCP.animate.requireText(layer);
    var notes = [];
    var t0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", layer.inPoint);
    var text = String(MCP.animate.valueAt(textProp, t0).text);
    var n = MCP.animate.textChars(text);
    if (n < 1) { MCP.fail("Layer '" + layer.name + "' has no characters to type.", "invalid-argument"); }
    if (textProp.numKeys > 0) { notes.push("Source Text has keyframes; characters were counted from the text at the start time."); }
    if (_mcpTry(function () { return textProp.expression !== "" && textProp.expressionEnabled; }, false)) {
        notes.push("Source Text has an expression; the typing reveals whatever text it returns.");
    }
    var dur;
    if (MCP.animate.has(args, "duration", "durationFrames")) {
        dur = MCP.animate.span(comp, args, 1);
    } else {
        var cps = MCP.num(args.charactersPerSecond, 20);
        if (!(cps > 0)) { MCP.fail("charactersPerSecond must be greater than 0.", "invalid-argument"); }
        dur = Math.max(fd, MCP.snapToFrame(comp, n / cps));
    }
    var t1 = t0 + dur;
    var easing = MCP.isDefined(args.easing) ? args.easing : "linear";
    var cursorSpec = (args.cursor && typeof args.cursor === "object") ? args.cursor : (args.cursor === true ? {} : null);
    var cursorOpts = cursorSpec ? MCP.animate.cursorOptions(cursorSpec) : null;
    // The cursor layer is a copy of the text taken before the typing animator exists.
    var dup = cursorOpts ? layer.duplicate() : null;

    var animName = MCP.animate.uniqueChildName(MCP.animate.animators(layer), MCP.isDefined(args.name) ? String(args.name) : "Typewriter");
    var animIdx = MCP.animate.newAnimator(layer, animName);
    MCP.animate.animProp(layer, animIdx, "ADBE Text Opacity", 0, notes);
    var si = MCP.animate.rangeSelector(layer, animIdx, "Typing");
    MCP.text.setIf(MCP.animate.adv(MCP.animate.sel(layer, animIdx, si)), "ADBE Text Range Units", "Units", 1, [], notes, "units");
    MCP.text.setIf(MCP.animate.adv(MCP.animate.sel(layer, animIdx, si)), "ADBE Text Range Type2", "Based On", 1, [], notes, "basedOn");
    MCP.text.setIf(MCP.animate.adv(MCP.animate.sel(layer, animIdx, si)), "ADBE Text Range Shape", "Shape", 1, [], notes, "shape");
    MCP.text.setIf(MCP.animate.adv(MCP.animate.sel(layer, animIdx, si)), "ADBE Text Selector Smoothness", "Smoothness", 0, [], notes, "smoothness");
    var endP = MCP.childProp(MCP.animate.sel(layer, animIdx, si), "ADBE Text Percent End");
    if (endP) { MCP.animate.clearProp(endP); endP.setValue(100); }
    var startP = MCP.childProp(MCP.animate.sel(layer, animIdx, si), "ADBE Text Percent Start");
    if (!startP) { MCP.fail("The Typing selector has no Start property.", "script-error"); }
    var keys = MCP.animate.keyMove(startP, t0, 0, t1, 100, easing, { comp: comp });

    var cursor = null;
    if (dup) { cursor = MCP.animate.buildCursor(comp, layer, dup, t0, animName, cursorOpts, notes); }
    var linear = easing === "linear";
    var rate = n / dur;
    var anim = MCP.animate.anim(layer, animIdx);
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer),
        animator: anim.name, animatorPath: MCP.pathOf(anim).path,
        selectorPath: MCP.pathOf(MCP.animate.sel(layer, animIdx, si)).path,
        characters: n, charactersPerSecond: MCP.round(rate, 3),
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        firstCharacterTime: linear ? MCP.round(t0 + 0.5 / rate) : null,
        lastCharacterTime: linear ? MCP.round(t0 + (n - 0.5) / rate) : null,
        keyframes: keys, cursor: cursor, notes: notes
    };
}, { mutating: true });

/* ------------------------------------------------------- word-by-word-reveal */

MCP.register("wordByWordReveal", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var textProp = MCP.animate.requireText(layer);
    var notes = [];
    var t0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", layer.inPoint);
    var text = String(MCP.animate.valueAt(textProp, t0).text);
    var basedOn = String(MCP.arg(args, "basedOn", "words")).toLowerCase();
    if (basedOn !== "words" && basedOn !== "lines") { MCP.fail("basedOn must be words or lines.", "invalid-argument"); }
    var units = basedOn === "lines" ? MCP.animate.textLines(text) : MCP.animate.textWords(text);
    if (units < 1) { MCP.fail("Layer '" + layer.name + "' has no words to reveal.", "invalid-argument"); }
    var fd = MCP.frameDuration(comp);
    var dur;
    if (MCP.animate.has(args, "duration", "durationFrames")) { dur = MCP.animate.span(comp, args, 0.8); }
    else if (MCP.isDefined(args.secondsPerWord)) {
        var spw = Number(args.secondsPerWord);
        if (!(spw > 0)) { MCP.fail("secondsPerWord must be greater than 0.", "invalid-argument"); }
        dur = Math.max(fd, MCP.snapToFrame(comp, units * spw));
    } else {
        dur = Math.max(fd, MCP.snapToFrame(comp, Math.min(3, Math.max(0.7, units * 0.12))));
    }
    var t1 = t0 + dur;
    var drive = String(MCP.arg(args, "drive", "start")).toLowerCase();
    if (drive !== "start" && drive !== "offset") { MCP.fail("drive must be start or offset.", "invalid-argument"); }

    var name = MCP.animate.uniqueChildName(MCP.animate.animators(layer), MCP.isDefined(args.name) ? String(args.name) : "Word Reveal");
    var animIdx = MCP.animate.newAnimator(layer, name);
    var blur = MCP.num(args.blur, 25);
    var off = MCP.isArray(args.offset) ? [Number(args.offset[0]), Number(args.offset[1])] : [0, MCP.num(args.offset, 20)];
    var opacity = MCP.num(args.opacity, 0);
    MCP.animate.animProp(layer, animIdx, "ADBE Text Opacity", opacity, notes);
    if (blur > 0) { MCP.animate.animProp(layer, animIdx, "ADBE Text Blur", [blur, blur], notes); }
    if (off[0] !== 0 || off[1] !== 0) { MCP.animate.animProp(layer, animIdx, "ADBE Text Position 3D", off, notes); }
    if (MCP.isDefined(args.scale)) { MCP.animate.animProp(layer, animIdx, "ADBE Text Scale 3D", [Number(args.scale), Number(args.scale)], notes); }

    var si = MCP.animate.rangeSelector(layer, animIdx, "Reveal");
    var setAdv = function (mn, label, value) {
        MCP.text.setIf(MCP.animate.adv(MCP.animate.sel(layer, animIdx, si)), mn, label, value, [], notes, label);
    };
    setAdv("ADBE Text Range Units", "Units", 1);
    setAdv("ADBE Text Range Type2", "Based On", basedOn === "lines" ? 4 : 3);
    setAdv("ADBE Text Range Shape", "Shape", drive === "offset" ? 2 : 1);
    if (MCP.isDefined(args.easeHigh)) { setAdv("ADBE Text Levels Max Ease", "Ease High", Number(args.easeHigh)); }
    if (MCP.isDefined(args.easeLow)) { setAdv("ADBE Text Levels Min Ease", "Ease Low", Number(args.easeLow)); }
    if (MCP.bool(args.randomize, false)) {
        setAdv("ADBE Text Randomize Order", "Randomize Order", 1);
        setAdv("ADBE Text Random Seed", "Random Seed", Math.round(MCP.num(args.seed, 1)));
    }
    var endP = MCP.childProp(MCP.animate.sel(layer, animIdx, si), "ADBE Text Percent End");
    if (endP) { MCP.animate.clearProp(endP); endP.setValue(100); }
    var startP = MCP.childProp(MCP.animate.sel(layer, animIdx, si), "ADBE Text Percent Start");
    var easing = MCP.isDefined(args.easing) ? args.easing : MCP.animate.EASE_WORDS;
    var keys, keyed;
    if (drive === "offset") {
        if (startP) { MCP.animate.clearProp(startP); startP.setValue(0); }
        var offP = MCP.childProp(MCP.animate.sel(layer, animIdx, si), "ADBE Text Percent Offset");
        if (!offP) { MCP.fail("The Reveal selector has no Offset property.", "script-error"); }
        keys = MCP.animate.keyMove(offP, t0, -100, t1, 100, easing, { comp: comp });
        keyed = MCP.pathOf(offP).path;
    } else {
        if (!startP) { MCP.fail("The Reveal selector has no Start property.", "script-error"); }
        keys = MCP.animate.keyMove(startP, t0, 0, t1, 100, easing, { comp: comp });
        keyed = MCP.pathOf(startP).path;
    }
    var anim = MCP.animate.anim(layer, animIdx);
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer),
        animator: anim.name, animatorPath: MCP.pathOf(anim).path,
        selectorPath: MCP.pathOf(MCP.animate.sel(layer, animIdx, si)).path, keyedProperty: keyed,
        basedOn: basedOn, units: units, drive: drive,
        fromState: { opacity: opacity, blur: blur, offset: off, scale: MCP.isDefined(args.scale) ? Number(args.scale) : null },
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        keyframes: keys, notes: notes
    };
}, { mutating: true });

/* -------------------------------------------------------------------- press */

/** Comp-space point of a layer-space point at time t, read through a temporary expression on prop (2D). */
MCP.animate.compPoint = function (prop, layer, pointExpr, t, fallback) {
    var code = "var L = thisComp.layer(" + layer.index + ");\nvar p = L.toComp(" + pointExpr + ", " + MCP.expr.num(t) + ");\n[p[0], p[1]]";
    var v = null;
    try {
        prop.expression = code;
        v = prop.valueAtTime(t, false);
    } catch (e) { v = null; }
    try { prop.expression = ""; } catch (e2) {}
    if (!MCP.isArray(v) || isNaN(Number(v[0])) || isNaN(Number(v[1]))) { return fallback; }
    return [Number(v[0]), Number(v[1])];
};

/** Expression source for the centre of a layer's content in its own space at time t. */
MCP.animate.centerExpr = function (layer, t) {
    var rect = _mcpTry(function () { return layer.sourceRectAtTime(t, false); }, null);
    if (rect && rect.width > 0 && rect.height > 0) {
        return "[" + MCP.expr.num(rect.left + rect.width / 2) + ", " + MCP.expr.num(rect.top + rect.height / 2) + "]";
    }
    return "L.transform.anchorPoint.valueAtTime(" + MCP.expr.num(t) + ")";
};

/** Three keys on a layer's Scale: rest, pct of rest, rest. */
MCP.animate.scalePress = function (comp, layer, t0, t1, t2, pct, firstEase, secondEase) {
    var sp = _mcpTry(function () { return layer.property("ADBE Transform Group").property("ADBE Scale"); }, null);
    if (!sp) { MCP.fail("Layer '" + layer.name + "' has no Scale.", "unsupported"); }
    var r0 = MCP.animate.valueAt(sp, t0), r1 = MCP.animate.valueAt(sp, t1), r2 = MCP.animate.valueAt(sp, t2);
    var mid = MCP.animate.scaleXY(r1, pct / 100, !!layer.threeDLayer);
    MCP.easing.setKey(sp, t0, r0);
    var i1 = MCP.easing.setKey(sp, t1, mid);
    MCP.easing.applySegment(sp, i1, firstEase);
    var i2 = MCP.easing.setKey(sp, t2, r2);
    MCP.easing.applySegment(sp, i2, secondEase);
    return { property: MCP.pathOf(sp).path, rest: MCP.animate.raw(r0), extreme: MCP.animate.raw(mid), keys: MCP.animate.keysAt(sp, [t0, t1, t2]) };
};

MCP.register("press", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var fd = MCP.frameDuration(comp);
    if (!MCP.isDefined(args.time) && !MCP.isDefined(args.frame)) { MCP.fail("press needs time (seconds) or frame: when the press starts.", "invalid-argument"); }
    var variant = String(MCP.arg(args, "variant", "dip")).toLowerCase();
    if (variant !== "dip" && variant !== "pop") { MCP.fail("variant must be dip or pop.", "invalid-argument"); }
    var t0 = MCP.snapToFrame(comp, MCP.timeArg(comp, args));
    var pct = MCP.num(args.scale, variant === "pop" ? 108 : 96);
    var dipDown = Math.max(fd, MCP.animate.timeOf(comp, args, "downDuration", "downFrames", 0.1));
    var up = Math.max(fd, MCP.animate.timeOf(comp, args, "upDuration", "upFrames", variant === "pop" ? 0.25 : 0.15));
    var down = variant === "pop" ? (MCP.animate.has(args, "downDuration", "downFrames") ? dipDown : fd) : dipDown;
    var t1 = t0 + down, t2 = t1 + up;
    var settle = MCP.isDefined(args.easing) ? args.easing : MCP.animate.EASE_LAND;
    var attack = variant === "pop" ? "linear" : settle;
    var notes = [];

    // Resolve everything that can fail before writing.
    var cursorLayer = null, cursorPct = 0;
    if (args.cursor) {
        cursorLayer = MCP.resolveLayer(comp, MCP.requireArg(args.cursor, "layer"));
        if (cursorLayer.index === layer.index) { MCP.fail("cursor.layer must be a different layer from the pressed one.", "invalid-argument"); }
        cursorPct = MCP.num(args.cursor.scale, variant === "pop" ? 92 : Math.max(50, 100 - 2 * (100 - pct)));
    }
    var flips = [], f;
    if (MCP.isArray(args.flip)) {
        for (f = 0; f < args.flip.length; f++) {
            var fp = MCP.resolveProperty(layer, MCP.requireArg(args.flip[f], "property"));
            if (!_mcpTry(function () { return fp.canVaryOverTime; }, false)) { MCP.fail("Property '" + MCP.pathOf(fp).path + "' cannot be keyframed.", "unsupported"); }
            if (!MCP.isDefined(args.flip[f].to)) { MCP.fail("flip entry " + (f + 1) + " needs to.", "invalid-argument"); }
            flips.push({ prop: fp, to: MCP.animate.coerce(fp, args.flip[f].to) });
        }
    }
    var rs = null;
    if (args.ripple) {
        rs = typeof args.ripple === "object" ? args.ripple : {};
        var styleCheck = String(MCP.arg(rs, "style", "ring")).toLowerCase();
        if (styleCheck !== "ring" && styleCheck !== "fill") { MCP.fail("ripple.style must be ring or fill.", "invalid-argument"); }
    }

    var main = MCP.animate.scalePress(comp, layer, t0, t1, t2, pct, attack, settle);

    var cursor = null;
    if (cursorLayer) {
        var c0 = MCP.snapToFrame(comp, Math.min(t1 - (variant === "pop" ? 0.1 : down), t1 - fd));
        var c2 = t1 + (variant === "pop" ? Math.max(fd, MCP.snapToFrame(comp, 0.15)) : up);
        var ck = MCP.animate.scalePress(comp, cursorLayer, c0, t1, c2, cursorPct, settle, settle);
        cursor = { layer: MCP.serialize.layerRef(cursorLayer), scale: cursorPct, property: ck.property, keys: ck.keys };
    }

    var flipped = [];
    for (f = 0; f < flips.length; f++) {
        var prop = flips[f].prop;
        var before = MCP.animate.valueAt(prop, t1 - fd);
        MCP.easing.setKey(prop, t1 - fd, before);
        var ib = MCP.easing.setKey(prop, t1, flips[f].to);
        MCP.easing.applySegment(prop, ib, "hold");
        ib = MCP.easing.keyIndexAtTime(prop, t1, 1e-3);
        if (ib > 0) { try { MCP.easing.setInterp(prop, ib, null, KeyframeInterpolationType.HOLD); } catch (e0) {} }
        flipped.push({ property: MCP.pathOf(prop).path, from: MCP.animate.raw(before), to: MCP.animate.raw(flips[f].to), keys: MCP.animate.keysAt(prop, [t1 - fd, t1]) });
    }

    var ripple = null;
    if (rs) {
        var radius = MCP.num(rs.radius, 60);
        var style = String(MCP.arg(rs, "style", "ring")).toLowerCase();
        var rDur = Math.max(fd, MCP.animate.timeOf(comp, rs, "duration", "durationFrames", 0.6));
        var color = MCP.isDefined(rs.color) ? rs.color : [1, 1, 1, 1];
        var created = MCP.invoke("createShapeLayer", {
            comp: { id: comp.id }, name: MCP.animate.uniqueLayerName(comp, MCP.isDefined(rs.name) ? String(rs.name) : layer.name + " Ripple"),
            shapeType: "circle", size: [radius * 2, radius * 2],
            noFill: style === "ring", fillColor: color,
            strokeColor: style === "ring" ? color : undefined, strokeWidth: style === "ring" ? MCP.num(rs.strokeWidth, 3) : 0,
            position: [0, 0]
        });
        var rl = comp.layer(created.layer.index);
        // Directly above the pressed layer, so a cursor above it stays on top.
        MCP.animate.placeAbove(rl, layer);
        var rPos = rl.property("ADBE Transform Group").property("ADBE Position");
        var centre = null;
        if (MCP.isArray(rs.position)) {
            centre = [Number(rs.position[0]), Number(rs.position[1])];
        } else if (cursorLayer) {
            centre = MCP.animate.compPoint(rPos, cursorLayer, "L.transform.anchorPoint.valueAtTime(" + MCP.expr.num(t1) + ")", t1, null);
        } else {
            centre = MCP.animate.compPoint(rPos, layer, MCP.animate.centerExpr(layer, t1), t1, null);
        }
        if (!centre) {
            var src = cursorLayer || layer;
            centre = _mcpTry(function () { var v = src.property("ADBE Transform Group").property("ADBE Position").valueAtTime(t1, false); return [v[0], v[1]]; }, [comp.width / 2, comp.height / 2]);
            notes.push("The ripple centre was taken from the layer's Position (parenting not accounted for).");
        }
        rPos.setValue(MCP.animate.fit(centre, rPos.value, "ripple.position"));
        var rScale = rl.property("ADBE Transform Group").property("ADBE Scale");
        var full = MCP.animate.valueAt(rScale, t1);
        var sKeys = MCP.animate.keyMove(rScale, t1, MCP.animate.scaleXY(full, 0, false), t1 + rDur, full, MCP.animate.EASE_RIPPLE, { comp: comp });
        var rOp = rl.property("ADBE Transform Group").property("ADBE Opacity");
        var oKeys = MCP.animate.keyMove(rOp, t1, MCP.num(rs.opacity, 60), t1 + rDur, 0, "linear", { comp: comp });
        rl.inPoint = t1;
        rl.outPoint = t1 + rDur;
        ripple = {
            layer: MCP.serialize.layer(rl), style: style, radius: radius, center: MCP.roundValue(centre),
            startTime: MCP.round(t1), endTime: MCP.round(t1 + rDur),
            keyframes: [{ property: MCP.pathOf(rScale).path, keys: sKeys }, { property: MCP.pathOf(rOp).path, keys: oKeys }]
        };
    }

    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer),
        variant: variant, scale: pct,
        startTime: MCP.round(t0), clickTime: MCP.round(t1), endTime: MCP.round(t2),
        startFrame: MCP.frameOf(comp, t0), clickFrame: MCP.frameOf(comp, t1), endFrame: MCP.frameOf(comp, t2),
        property: main.property, keys: main.keys,
        cursor: cursor, flips: flipped, ripple: ripple, notes: notes
    };
}, { mutating: true });

/* ---------------------------------------------------------- move-along-path */

/** Depth-first search for the first Bezier path item under a shape group: {item, groups[]} or null. */
MCP.animate.findPathItem = function (group, chain) {
    var items = MCP.shape.itemsOf(group);
    var here = chain.concat([group]);
    var i, p;
    for (i = 1; i <= items.numProperties; i++) {
        p = items.property(i);
        if (p.matchName === "ADBE Vector Shape - Group") { return { item: p, groups: here }; }
    }
    for (i = 1; i <= items.numProperties; i++) {
        p = items.property(i);
        if (p.matchName === "ADBE Vector Group") {
            var found = MCP.animate.findPathItem(p, here);
            if (found) { return found; }
        }
    }
    return null;
};

MCP.animate.firstParametric = function (group) {
    var items = MCP.shape.itemsOf(group);
    for (var i = 1; i <= items.numProperties; i++) {
        var mn = items.property(i).matchName;
        if (mn === "ADBE Vector Shape - Rect" || mn === "ADBE Vector Shape - Ellipse" || mn === "ADBE Vector Shape - Star") { return items.property(i); }
    }
    return null;
};

/** {kind, ref, groups[], layerRef, closed, label} describing the path to travel along. */
MCP.animate.pathSource = function (comp, pathLayer, spec, t) {
    var lref = "thisComp.layer(" + MCP.expr.str(pathLayer.name) + ")";
    var shapeObj;
    if (MCP.isDefined(spec.mask)) {
        var mask = MCP.masks.resolve(pathLayer, spec.mask);
        shapeObj = _mcpTry(function () { return MCP.childProp(mask, "ADBE Mask Shape").valueAtTime(t, false); }, null);
        return {
            kind: "mask", ref: "L.mask(" + MCP.expr.str(mask.name) + ").maskPath", groups: [], layerRef: lref,
            closed: shapeObj ? !!shapeObj.closed : true, label: MCP.pathOf(mask).path + "/Mask Path"
        };
    }
    if (!(pathLayer instanceof ShapeLayer)) {
        MCP.fail("Layer '" + pathLayer.name + "' is not a shape layer. Give path.mask to travel along one of its masks, or pick a shape layer.", "invalid-argument");
    }
    var group = MCP.shape.resolveGroup(pathLayer, spec.group);
    var found = MCP.animate.findPathItem(group, []);
    if (!found) {
        var para = MCP.animate.firstParametric(group);
        MCP.fail("Group '" + group.name + "' has no Bezier path" + (para ? " (it holds a " + MCP.shape.kindOf(para) + ")" : "") + ". pointOnPath needs a drawn path: draw it with the Pen tool, right-click the shape and choose Convert To Bezier Path, or use set-shape-path.", "unsupported");
    }
    var ref = "L", groupRefs = [];
    for (var g = 0; g < found.groups.length; g++) {
        ref += ".content(" + MCP.expr.str(found.groups[g].name) + ")";
        groupRefs.push(ref + ".transform");
    }
    ref += ".content(" + MCP.expr.str(found.item.name) + ").path";
    shapeObj = _mcpTry(function () { return found.item.property("ADBE Vector Shape").valueAtTime(t, false); }, null);
    return { kind: "shape", ref: ref, groups: groupRefs, layerRef: lref, closed: shapeObj ? !!shapeObj.closed : false, label: MCP.pathOf(found.item).path };
};

/** Shared expression header: L, P, G, u and place(pt), which maps a path point into this layer's parent space. */
MCP.animate.pathHeader = function (src, sliderName, closed, world) {
    var toSpace = world ? "toWorld" : "toComp";
    var fromSpace = world ? "fromWorld" : "fromComp";
    return "var L = " + src.layerRef + ";\n" +
        "var P = " + src.ref + ";\n" +
        "var G = [" + src.groups.join(", ") + "];\n" +
        "var u = effect(" + MCP.expr.str(sliderName) + ")(\"Slider\").value / 100;\n" +
        (closed ? "u = u - Math.floor(u);\n" : "u = Math.min(1, Math.max(0, u));\n") +
        "function inGroup(pt, tr) {\n" +
        "  var a = tr.anchorPoint.value, s = tr.scale.value, q = tr.position.value, r = degreesToRadians(tr.rotation.value);\n" +
        "  var x = (pt[0] - a[0]) * s[0] / 100, y = (pt[1] - a[1]) * s[1] / 100;\n" +
        "  return [q[0] + x * Math.cos(r) - y * Math.sin(r), q[1] + x * Math.sin(r) + y * Math.cos(r)];\n" +
        "}\n" +
        "function place(pt) {\n" +
        "  for (var i = G.length - 1; i >= 0; i--) { pt = inGroup(pt, G[i]); }\n" +
        "  var w = L." + toSpace + "(pt);\n" +
        "  return hasParent ? parent." + fromSpace + "(w) : w;\n" +
        "}\n";
};

MCP.register("moveAlongPath", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var spec = MCP.requireArg(args, "path");
    var pathLayer = MCP.resolveLayer(comp, MCP.requireArg(spec, "layer"));
    if (pathLayer.index === layer.index) { MCP.fail("The moving layer and the path layer must be different layers.", "invalid-argument"); }
    MCP.animate.requireUniqueName(comp, pathLayer, "path");
    var t0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", layer.inPoint);
    var t1 = t0 + MCP.animate.span(comp, args, 1);
    var src = MCP.animate.pathSource(comp, pathLayer, spec, t0);
    var tg = layer.property("ADBE Transform Group");
    var pos = MCP.childProp(tg, "ADBE Position");
    if (!pos) { MCP.fail("Layer '" + layer.name + "' has no Position.", "unsupported"); }
    var orient = MCP.bool(args.orient, false);
    var rot = orient ? MCP.childProp(tg, "ADBE Rotate Z") : null;
    if (orient && !rot) { MCP.fail("Layer '" + layer.name + "' has no Rotation to orient.", "unsupported"); }
    var notes = [];
    var mover3D = !!layer.threeDLayer, path3D = !!pathLayer.threeDLayer;
    var world = mover3D || path3D;

    // Progress slider with two eased keys.
    var sliderName = MCP.animate.uniqueChildName(MCP.effectsGroup(layer), MCP.isDefined(args.sliderName) ? String(args.sliderName) : "Progress");
    var added = MCP.fx.addFirstAvailable(layer, ["ADBE Slider Control"]);
    if (!added) { MCP.fail("A Slider Control could not be added to '" + layer.name + "'.", "unsupported"); }
    added.effect.name = sliderName;
    var slider = MCP.childProp(MCP.childProp(MCP.effectsGroup(layer), sliderName), "ADBE Slider Control-0001");
    if (!slider) { MCP.fail("The new Slider Control could not be found again.", "script-error"); }
    var from = MCP.num(args.from, 0), to = MCP.num(args.to, 100);
    var easing = MCP.isDefined(args.easing) ? args.easing : MCP.animate.EASE_LAND;
    var keys = MCP.animate.keyMove(slider, t0, from, t1, to, easing, { comp: comp });
    if (!src.closed && (from < 0 || from > 100 || to < 0 || to > 100)) { notes.push("The path is open, so progress outside 0 to 100 holds at the ends."); }

    // Re-fetch after adding the effect: earlier transform references may be stale.
    tg = layer.property("ADBE Transform Group");
    pos = MCP.childProp(tg, "ADBE Position");
    var header = "// Move along path: " + src.label + " at effect(\"" + sliderName + "\")\n" + MCP.animate.pathHeader(src, sliderName, src.closed, world);
    var pointLine = "var p = place(P.pointOnPath(u));\n";
    var expressions = [];
    var hasKeys = _mcpTry(function () { return pos.numKeys > 0; }, false);
    if (_mcpTry(function () { return !!pos.dimensionsSeparated; }, false)) {
        var axes = mover3D ? 3 : 2;
        for (var ax = 0; ax < axes; ax++) {
            if (ax === 2 && !path3D) { continue; }
            var axp = MCP.childProp(tg, "ADBE Position_" + ax);
            if (!axp) { continue; }
            if (axp.numKeys > 0) { hasKeys = true; }
            expressions.push(MCP.animate.setExpression(axp, header + pointLine + "p[" + ax + "];"));
        }
    } else {
        var last = mover3D ? (path3D ? "[p[0], p[1], p[2]];" : "[p[0], p[1], value[2]];") : "[p[0], p[1]];";
        expressions.push(MCP.animate.setExpression(pos, header + pointLine + last));
    }
    if (hasKeys) { notes.push("Position keys stay on the layer but the expression overrides them."); }

    if (orient) {
        rot = MCP.childProp(layer.property("ADBE Transform Group"), "ADBE Rotate Z");
        var code = header +
            "var q = P.pointOnPath(u), tn = P.tangentOnPath(u);\n" +
            "var a = place(q), b = place([q[0] + tn[0], q[1] + tn[1]]);\n" +
            "value + radiansToDegrees(Math.atan2(b[1] - a[1], b[0] - a[0]));";
        expressions.push(MCP.animate.setExpression(rot, code));
        notes.push("Rotation follows the path direction and keeps the layer's own Rotation as an offset: at 0 the layer should face along +X.");
        if (_mcpTry(function () { return layer.autoOrient !== AutoOrientType.NO_AUTO_ORIENT; }, false)) {
            notes.push("Auto-Orient is on for this layer and adds its own turn; switch it off when orient is used.");
        }
    }
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer),
        path: { layer: MCP.serialize.layerRef(pathLayer), kind: src.kind, property: src.label, closed: src.closed, expressionRef: src.ref },
        slider: { effect: sliderName, propertyPath: "Effects/" + sliderName + "/Slider", expression: "effect(" + MCP.expr.str(sliderName) + ")(\"Slider\")", from: from, to: to, keys: keys },
        orient: orient,
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        expressions: expressions, notes: notes
    };
}, { mutating: true });

/* ---------------------------------------------------------- play-at-markers */

MCP.register("playAtMarkers", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var comp = r.comp, layer = r.layer;
    var list = MCP.requireArg(args, "properties");
    if (!MCP.isArray(list) || !list.length) { MCP.fail("properties must be a non-empty array of property paths.", "invalid-argument"); }
    var source = String(MCP.arg(args, "markerSource", "layer")).toLowerCase();
    if (source !== "layer" && source !== "comp") { MCP.fail("markerSource must be layer or comp.", "invalid-argument"); }
    var markerLayer = null, markerProp, markerExpr;
    if (MCP.isDefined(args.markerLayer)) {
        markerLayer = MCP.resolveLayer(comp, args.markerLayer);
        source = "layer";
    }
    if (source === "comp") {
        markerProp = comp.markerProperty;
        markerExpr = "thisComp.marker";
    } else if (markerLayer && markerLayer.index !== layer.index) {
        MCP.animate.requireUniqueName(comp, markerLayer, "marker");
        markerProp = markerLayer.property("ADBE Marker");
        markerExpr = "thisComp.layer(" + MCP.expr.str(markerLayer.name) + ").marker";
    } else {
        markerProp = layer.property("ADBE Marker");
        markerExpr = "thisLayer.marker";
    }
    if (!markerProp) { MCP.fail("The marker source cannot hold markers.", "unsupported"); }
    var tag = MCP.isDefined(args.comment) ? String(args.comment) : "";

    // Resolve every property first so a bad one writes nothing.
    var props = [], i;
    for (i = 0; i < list.length; i++) {
        var p = MCP.resolveProperty(layer, list[i]);
        var nk = _mcpTry(function () { return p.numKeys; }, 0);
        if (nk < 2) { MCP.fail("Property '" + MCP.pathOf(p).path + "' needs at least two keyframes to replay (it has " + nk + "). Key the animation once, then call this.", "invalid-argument"); }
        if (!_mcpTry(function () { return p.canSetExpression; }, false)) { MCP.fail("Property '" + MCP.pathOf(p).path + "' does not accept expressions.", "unsupported"); }
        props.push(p);
    }
    var specs = MCP.isArray(args.addMarkers) ? args.addMarkers : [];
    for (i = 0; i < specs.length; i++) {
        if (!specs[i] || (!MCP.isDefined(specs[i].time) && !MCP.isDefined(specs[i].frame))) { MCP.fail("addMarkers entry " + (i + 1) + " needs time or frame.", "invalid-argument"); }
    }

    var addedMarkers = [];
    for (i = 0; i < specs.length; i++) {
        var mt = MCP.snapToFrame(comp, MCP.timeArg(comp, specs[i]));
        var comment = MCP.isDefined(specs[i].comment) ? String(specs[i].comment) : tag;
        markerProp.setValueAtTime(mt, new MarkerValue(comment));
        addedMarkers.push({ time: MCP.round(mt), frame: MCP.frameOf(comp, mt), comment: comment });
    }

    var code = "// Play at markers: replays this property's keys from each marker" + (tag ? " named " + MCP.expr.str(tag) : "") + "\n" +
        "var M = " + markerExpr + ";\n" +
        "var tag = " + MCP.expr.str(tag) + ";\n" +
        "var k1 = key(1).time, kN = key(numKeys).time;\n" +
        "var start = null;\n" +
        "for (var i = M.numKeys; i >= 1; i--) {\n" +
        "  var m = M.key(i);\n" +
        "  if (m.time <= time && (tag == \"\" || m.comment == tag)) { start = m.time; break; }\n" +
        "}\n" +
        "start === null ? valueAtTime(k1) : valueAtTime(k1 + Math.min(time - start, kN - k1));";
    var out = [];
    for (i = 0; i < props.length; i++) {
        var prop = props[i];
        var old = _mcpTry(function () { return prop.expression; }, "");
        var st = MCP.animate.setExpression(prop, code);
        var first = prop.keyTime(1), lastKey = prop.keyTime(prop.numKeys);
        out.push({
            property: MCP.pathOf(prop).path,
            keySpan: { from: MCP.round(first), to: MCP.round(lastKey), seconds: MCP.round(lastKey - first) },
            replacedExpression: old ? old : null,
            expressionState: st
        });
    }
    var markers = [];
    for (i = 1; i <= markerProp.numKeys; i++) {
        var mv = markerProp.keyValue(i);
        var c = _mcpTry(function () { return mv.comment; }, "");
        if (tag && c !== tag) { continue; }
        markers.push({ time: MCP.round(markerProp.keyTime(i)), frame: MCP.frameOf(comp, markerProp.keyTime(i)), comment: c });
    }
    var notes = [];
    if (!markers.length) { notes.push("No matching markers yet: each property holds its first key value until one is added."); }
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layerRef(layer),
        markerSource: source, markerLayer: markerLayer ? MCP.serialize.layerRef(markerLayer) : null, comment: tag || null,
        markersAdded: addedMarkers, markers: markers, properties: out, notes: notes
    };
}, { mutating: true });

/* ---------------------------------------------------------- add-camera-push */

MCP.register("addCameraPush", function (args, ctx) {
    var comp = MCP.resolveComp(args.comp);
    var targets = [], skipped = [], i;
    if (MCP.isDefined(args.layers)) {
        targets = MCP.resolveLayers(comp, args.layers);
    } else {
        for (i = 1; i <= comp.numLayers; i++) { targets.push(comp.layer(i)); }
    }
    var t0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", 0);
    var dur = MCP.animate.span(comp, args, Math.max(MCP.frameDuration(comp), comp.duration - t0));
    var t1 = t0 + dur;
    var pivot = MCP.isArray(args.pivot) ? [Number(args.pivot[0]), Number(args.pivot[1])] : [comp.width / 2, comp.height / 2];
    var from = MCP.num(args.from, 100), to = MCP.num(args.to, 105);
    var easing = MCP.isDefined(args.easing) ? args.easing : "linear";

    var nul = comp.layers.addNull(comp.duration);
    nul.name = MCP.animate.uniqueLayerName(comp, MCP.isDefined(args.name) ? String(args.name) : "Camera Push");
    try { nul.startTime = 0; nul.outPoint = comp.duration; } catch (e0) {}
    var tg = nul.property("ADBE Transform Group");
    // Anchor and position on the pivot make an identity transform, so parenting moves nothing.
    tg.property("ADBE Anchor Point").setValue(MCP.animate.fit(pivot, tg.property("ADBE Anchor Point").value, "pivot"));
    tg.property("ADBE Position").setValue(MCP.animate.fit(pivot, tg.property("ADBE Position").value, "pivot"));

    var parented = [];
    for (i = 0; i < targets.length; i++) {
        var L = targets[i];
        if (L.index === nul.index) { continue; }
        if ((L instanceof CameraLayer) || (L instanceof LightLayer)) { skipped.push({ layer: MCP.serialize.layerRef(L), reason: "cameras and lights are not pushed (scaling a camera's parent moves the camera)" }); continue; }
        if (L.parent) { skipped.push({ layer: MCP.serialize.layerRef(L), reason: "already parented to '" + L.parent.name + "', which carries it" }); continue; }
        try {
            L.parent = nul;
            parented.push(MCP.serialize.layerRef(L));
        } catch (err) {
            skipped.push({ layer: MCP.serialize.layerRef(L), reason: MCP.errorInfo(err, "addCameraPush", ctx ? ctx.id : null).message });
        }
    }
    tg = nul.property("ADBE Transform Group");
    var sp = tg.property("ADBE Scale");
    var base = MCP.animate.fill(sp.value, 100);
    var scaleKeys = MCP.animate.keyMove(sp, t0, MCP.animate.scaleXY(base, from / 100, false), t1, MCP.animate.scaleXY(base, to / 100, false), easing, { comp: comp });
    var driftKeys = null;
    if (MCP.isArray(args.drift) && (Number(args.drift[0]) !== 0 || Number(args.drift[1]) !== 0)) {
        var pp = tg.property("ADBE Position");
        var p0 = pp.value;
        driftKeys = MCP.animate.keyMove(pp, t0, p0, t1, MCP.animate.plus(p0, [Number(args.drift[0]), Number(args.drift[1])]), easing, { comp: comp, spatial: "linear" });
    }
    return {
        composition: MCP.serialize.compRef(comp), layer: MCP.serialize.layer(nul),
        pivot: MCP.roundValue(pivot), from: from, to: to,
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        scaleKeys: scaleKeys, driftKeys: driftKeys,
        parented: parented, skipped: skipped
    };
}, { mutating: true });

/* ------------------------------------------------------------ smart animate */

MCP.smart = {};
MCP.smart.SKIP_GROUPS = { "ADBE Marker": true, "ADBE Time Remapping": true, "ADBE Audio Group": true, "ADBE Layer Sets": true };

/** The property in group b that matches pa: by name in indexed groups (effects, masks, shape contents), by match name elsewhere. */
MCP.smart.partner = function (b, pa, index) {
    var indexed = _mcpTry(function () { return b.propertyType === PropertyType.INDEXED_GROUP; }, false);
    var hit = null;
    if (indexed) {
        hit = _mcpTry(function () { return b.property(pa.name); }, null);
        if (hit && String(hit.matchName) !== String(pa.matchName)) { hit = null; }
        if (!hit && index <= b.numProperties) {
            var same = _mcpTry(function () { return b.property(index); }, null);
            if (same && String(same.matchName) === String(pa.matchName) && same.name === pa.name) { hit = same; }
        }
        return hit;
    }
    return _mcpTry(function () { return b.property(String(pa.matchName)); }, null);
};

MCP.smart.same = function (va, vb, vt) {
    var i;
    if (vt === PropertyValueType.SHAPE) {
        if (!va || !vb || va.closed !== vb.closed || va.vertices.length !== vb.vertices.length) { return false; }
        var lists = ["vertices", "inTangents", "outTangents"];
        for (var l = 0; l < lists.length; l++) {
            for (i = 0; i < va[lists[l]].length; i++) {
                if (Math.abs(va[lists[l]][i][0] - vb[lists[l]][i][0]) > 1e-3 || Math.abs(va[lists[l]][i][1] - vb[lists[l]][i][1]) > 1e-3) { return false; }
            }
        }
        return true;
    }
    if (vt === PropertyValueType.TEXT_DOCUMENT) {
        return String(va.text) === String(vb.text) && _mcpTry(function () { return va.fontSize === vb.fontSize && String(va.font) === String(vb.font) && String(va.fillColor) === String(vb.fillColor); }, true);
    }
    if (MCP.isArray(va) && MCP.isArray(vb)) {
        if (va.length !== vb.length) { return false; }
        for (i = 0; i < va.length; i++) { if (Math.abs(Number(va[i]) - Number(vb[i])) > 1e-4) { return false; } }
        return true;
    }
    return Math.abs(Number(va) - Number(vb)) <= 1e-4;
};

/** Keys one property from its value at t0 to the partner's value; returns a change record or null. */
MCP.smart.leaf = function (pa, pb, ctx) {
    if (!_mcpTry(function () { return pa.canVaryOverTime; }, false)) { return null; }
    var vt = MCP.animate.valueType(pa);
    if (vt === PropertyValueType.NO_VALUE || vt === PropertyValueType.MARKER || vt === PropertyValueType.LAYER_INDEX || vt === PropertyValueType.MASK_INDEX || vt === PropertyValueType.CUSTOM_VALUE) { return null; }
    if (_mcpTry(function () { return pa.dimensionsSeparated; }, false)) { return null; }
    if (_mcpTry(function () { return pa.isSeparationFollower && !pa.propertyGroup(1).property("ADBE Position").dimensionsSeparated; }, false)) { return null; }
    var path = MCP.pathOf(pa).path;
    if (_mcpTry(function () { return pa.expressionEnabled && pa.expression !== ""; }, false)) { ctx.notes.push(ctx.layerName + ": " + path + " has an expression, so it was left alone."); return null; }
    var va = MCP.animate.valueAt(pa, ctx.t0);
    var vb = MCP.animate.valueAt(pb, ctx.toTime);
    if (va === null || vb === null || MCP.smart.same(va, vb, vt)) { return null; }
    if (vt === PropertyValueType.TEXT_DOCUMENT) {
        pa.setValueAtTime(ctx.t0, va);
        pa.setValueAtTime(MCP.snapToFrame(ctx.comp, (ctx.t0 + ctx.t1) / 2), vb);
        return { property: path, kind: "text swap" };
    }
    MCP.animate.keyMove(pa, ctx.t0, va, ctx.t1, vb, ctx.easing, { comp: ctx.comp });
    return { property: path, from: vt === PropertyValueType.SHAPE ? "path" : MCP.animate.raw(va), to: vt === PropertyValueType.SHAPE ? "path" : MCP.animate.raw(vb) };
};

MCP.smart.walk = function (a, b, ctx, out, depth) {
    if (depth > 14) { return; }
    for (var i = 1; i <= a.numProperties; i++) {
        var pa = a.property(i);
        if (MCP.smart.SKIP_GROUPS[String(pa.matchName)]) { continue; }
        var pb = MCP.smart.partner(b, pa, i);
        if (!pb) { continue; }
        if (pa.propertyType === PropertyType.PROPERTY) {
            var ch = null;
            try { ch = MCP.smart.leaf(pa, pb, ctx); } catch (e) { ctx.notes.push(ctx.layerName + ": " + MCP.pathOf(pa).path + " was not animated: " + e.message); }
            if (ch) { out.push(ch); }
        } else {
            MCP.smart.walk(pa, pb, ctx, out, depth + 1);
        }
    }
};

MCP.smart.opacity = function (layer) {
    return layer.property("ADBE Transform Group").property("ADBE Opacity");
};

MCP.register("smartAnimate", function (args) {
    var from = MCP.resolveComp(MCP.requireArg(args, "from"));
    var to = MCP.resolveComp(MCP.requireArg(args, "to"));
    if (from.id === to.id) { MCP.fail("from and to are the same composition. Pass two compositions: the start state and the end state.", "invalid-argument"); }
    var comp = from;
    if (MCP.bool(args.duplicate, true)) {
        comp = from.duplicate();
        comp.name = String(MCP.arg(args, "name", from.name + " to " + to.name));
    }
    var t0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", 0);
    var t1 = t0 + MCP.animate.span(comp, args, 0.5);
    var toTime = MCP.num(args.toTime, 0);
    var easing = MCP.isDefined(args.easing) ? args.easing : MCP.animate.EASE_LAND;
    var notes = [], matched = [], added = [], removed = [], skipped = [];
    var toByName = {}, twice = {}, fromNames = {}, i;
    for (i = 1; i <= to.numLayers; i++) {
        var nm = to.layer(i).name;
        if (toByName[nm]) { twice[nm] = true; } else { toByName[nm] = to.layer(i); }
    }
    var layers = [];
    for (i = 1; i <= comp.numLayers; i++) { layers.push(comp.layer(i)); }
    for (i = 0; i < layers.length; i++) {
        var L = layers[i];
        if (fromNames[L.name]) { skipped.push({ layer: MCP.serialize.layerRef(L), reason: "another layer in " + from.name + " has the same name" }); continue; }
        fromNames[L.name] = true;
        if (twice[L.name]) { skipped.push({ layer: MCP.serialize.layerRef(L), reason: "two layers in " + to.name + " have this name" }); continue; }
        var M = toByName[L.name];
        if (!M) {
            if (MCP.bool(args.fadeOut, true) && L.hasVideo) {
                var op = MCP.smart.opacity(L);
                MCP.animate.keyMove(op, t0, MCP.animate.valueAt(op, t0), t1, 0, MCP.animate.EASE_EXIT, { comp: comp });
                removed.push(MCP.serialize.layerRef(L));
            }
            continue;
        }
        var ctx = { comp: comp, t0: t0, t1: t1, toTime: toTime, easing: easing, notes: notes, layerName: L.name };
        var changes = [];
        MCP.smart.walk(L, M, ctx, changes, 0);
        matched.push({ layer: MCP.serialize.layerRef(L), changes: changes });
    }
    if (MCP.bool(args.fadeIn, true)) {
        for (i = to.numLayers; i >= 1; i--) {
            var N = to.layer(i);
            if (fromNames[N.name] || twice[N.name]) { continue; }
            // copyToComp does not promise where the new layer goes: find it by the layer id that is new afterwards.
            var ids = {}, k;
            for (k = 1; k <= comp.numLayers; k++) { ids[comp.layer(k).id] = true; }
            N.copyToComp(comp);
            var copy = null;
            for (k = 1; k <= comp.numLayers; k++) { if (!ids[comp.layer(k).id]) { copy = comp.layer(k); break; } }
            if (!copy) { notes.push("'" + N.name + "' could not be copied in."); continue; }
            var cop = MCP.smart.opacity(copy);
            if (copy.hasVideo && !(cop.expressionEnabled && cop.expression !== "")) {
                var target = MCP.animate.valueAt(cop, toTime);
                while (cop.numKeys > 0) { cop.removeKey(1); }
                MCP.animate.keyMove(cop, t0, 0, t1, target, easing, { comp: comp });
            }
            added.push(MCP.serialize.layerRef(copy));
        }
    }
    var keyed = 0;
    for (i = 0; i < matched.length; i++) { keyed += matched[i].changes.length; }
    return {
        composition: MCP.serialize.compRef(comp),
        from: MCP.serialize.compRef(from),
        to: MCP.serialize.compRef(to),
        duplicated: comp.id !== from.id,
        startTime: MCP.round(t0),
        endTime: MCP.round(t1),
        propertiesAnimated: keyed,
        matched: matched,
        added: added,
        removed: removed,
        skipped: skipped,
        notes: notes
    };
}, { mutating: true });
