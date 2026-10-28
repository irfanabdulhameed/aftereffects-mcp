/*
 * motion-rigs commands: general motion-design rigs built from expressions
 * and Expression Controls, so the result can be retuned and retimed in the
 * timeline instead of re-keyed.
 *
 *   numberCounter      a Value slider drives a formatted Source Text
 *   gridLayout         cells placed from their slot by Columns, Cell, Gap and Origin
 *   proximityEffector  layers react to their distance from an effector layer
 *   followChain        followers repeat a leader's motion a few frames later
 *   cloneArray         copies offset by index, in a row or on a ring
 *   shapeMorph         two path keys between two shapes with matched vertices
 *   wiggleRig          wiggle with Frequency, Amount, Seed, Loop and Strength
 *   swayLoop           a seamless sine float with a phase step per layer
 *   fitToBox           Scale that fits a layer's bounds into a box
 *
 * Conventions:
 *   - Every input is checked before the first change, so a refused call
 *     leaves the project as it was.
 *   - Controls are read by effect name and parameter index,
 *     effect("Radius")(1), so the expressions work in every language
 *     version of After Effects.
 *   - Expression code works element by element on arrays (no array
 *     operators) and ends on a value, so it runs on the JavaScript and the
 *     Legacy ExtendScript expression engines.
 *   - Animation is two eased keys on one control (MCP.animate.keyMove).
 *     Nothing writes a key on every frame.
 *   - An expression error is reported in the result, never thrown, and a
 *     layer that fails is reported with status "error" while the others
 *     are still rigged.
 */

MCP.mrig = {};

MCP.mrig.CONTROLS = {
    slider:   { matchName: "ADBE Slider Control",   label: "Slider Control" },
    checkbox: { matchName: "ADBE Checkbox Control", label: "Checkbox Control" },
    point:    { matchName: "ADBE Point Control",    label: "Point Control" },
    angle:    { matchName: "ADBE Angle Control",    label: "Angle Control" }
};

MCP.mrig.SLIDER_LIMIT = 1000000;

/* ------------------------------------------------------- control layers */

/** The effect named exactly name on layer, or null. */
MCP.mrig.effectNamed = function (layer, name) {
    var g = MCP.effectsGroup(layer);
    for (var i = 1; i <= g.numProperties; i++) {
        if (g.property(i).name === name) { return g.property(i); }
    }
    return null;
};

/**
 * Checks, before anything changes, that layer can hold the rig's controls:
 * it takes effects, is not locked, has no other kind of effect under one of
 * the control names ([[type, name], ...]), and has a unique name when other
 * layers' expressions will find it by name (unless selfOnly).
 */
MCP.mrig.checkHost = function (comp, layer, controls, selfOnly) {
    MCP.effectsGroup(layer);
    if (layer.locked) { MCP.fail("The control layer '" + layer.name + "' is locked. Unlock it first.", "invalid-argument"); }
    for (var i = 0; i < controls.length; i++) {
        var def = MCP.mrig.CONTROLS[controls[i][0]];
        var fx = MCP.mrig.effectNamed(layer, controls[i][1]);
        if (fx && fx.matchName !== def.matchName) {
            MCP.fail("Layer '" + layer.name + "' already has an effect named '" + controls[i][1] + "' (" + fx.matchName + ") where the rig needs a " + def.label + ". Rename that effect or choose another control layer.", "invalid-argument");
        }
    }
    if (!selfOnly) { MCP.animate.requireUniqueName(comp, layer, "control"); }
    return layer;
};

/** args.controlLayer resolved and checked, or null. */
MCP.mrig.givenHost = function (comp, args, controls) {
    if (!MCP.isDefined(args.controlLayer)) { return null; }
    return MCP.mrig.checkHost(comp, MCP.resolveLayer(comp, args.controlLayer), controls, false);
};

/** base, or base with a number, so no layer other than except has that name. */
MCP.mrig.uniqueName = function (comp, base, except) {
    var used = {}, i;
    for (i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (except && L.index === except.index) { continue; }
        used[L.name] = true;
    }
    if (!used[base]) { return base; }
    for (i = 2; i < 1000; i++) { if (!used[base + " " + i]) { return base + " " + i; } }
    return base + " " + new Date().getTime();
};

/** A null spanning the composition, named uniquely, at position (comp pixels). */
MCP.mrig.addNull = function (comp, name, position, threeD) {
    var nul = comp.layers.addNull(comp.duration);
    nul.name = MCP.animate.uniqueLayerName(comp, name);
    try { nul.startTime = 0; nul.outPoint = comp.duration; } catch (e0) {}
    if (threeD) { nul.threeDLayer = true; }
    var pp = nul.property("ADBE Transform Group").property("ADBE Position");
    var pos = MCP.isArray(position) ? position : [comp.width / 2, comp.height / 2];
    pp.setValue(MCP.animate.fit([Number(pos[0]), Number(pos[1]), MCP.isDefined(pos[2]) ? Number(pos[2]) : 0], pp.value, "position"));
    return nul;
};

/**
 * Starts a rig once every input has been checked. opts.host is a checked layer
 * for the controls; without it a new null named opts.name (or args.controlName)
 * is made at opts.position. opts.created marks a host the caller just made.
 */
MCP.mrig.begin = function (comp, opts) {
    var host = opts.host || null, created = !!opts.created;
    if (!host) {
        var args = opts.args || {};
        host = MCP.mrig.addNull(comp, MCP.isDefined(args.controlName) ? String(args.controlName) : opts.name, opts.position, opts.threeD);
        created = true;
    }
    return { comp: comp, host: host, created: created, controls: [], byName: {}, notes: [], code: {}, codeLayer: null, count: 0, errors: 0 };
};

/** Expression text that reaches the control layer from layer (thisLayer when they are the same). */
MCP.mrig.hostRef = function (rc, layer) {
    if (layer && rc.host.index === layer.index) { return "thisLayer"; }
    return "thisComp.layer(" + MCP.expr.str(rc.host.name) + ")";
};

/** Expression text that reaches another layer by name (its name was checked unique up front). */
MCP.mrig.layerRef = function (target, layer) {
    if (layer && target.index === layer.index) { return "thisLayer"; }
    return "thisComp.layer(" + MCP.expr.str(target.name) + ")";
};

/** C.effect("name")(1).value: the value of a control on the layer held in C. */
MCP.mrig.c = function (name) {
    return "C.effect(" + MCP.expr.str(name) + ")(1).value";
};

/** The first parameter of the control named name on the host (fetched fresh). */
MCP.mrig.param = function (rc, name) {
    var fx = MCP.mrig.effectNamed(rc.host, name);
    if (!fx) { MCP.fail("The control '" + name + "' is missing from '" + rc.host.name + "'.", "script-error"); }
    return fx.property(1);
};

MCP.mrig.controlValue = function (type, v) {
    if (type === "checkbox") { return (v === true || Number(v) > 0) ? 1 : 0; }
    if (type === "point") { return [Number(v[0]), Number(v[1])]; }
    return Number(v);
};

/**
 * A control on the rig's host: an Expression Control named name. A control of
 * the same kind with that name is reused, so rigs can share one control layer.
 * A new control gets given (or fallback); a reused one gets given only, and only
 * when it has no keys.
 */
MCP.mrig.control = function (rc, type, name, given, fallback) {
    var def = MCP.mrig.CONTROLS[type];
    var created = false;
    if (!MCP.mrig.effectNamed(rc.host, name)) {
        var added = MCP.fx.addFirstAvailable(rc.host, [def.matchName]);
        if (!added) { MCP.fail("A " + def.label + " could not be added to '" + rc.host.name + "'.", "unsupported"); }
        added.effect.name = name;
        created = true;
    }
    var value = created ? (MCP.isDefined(given) ? given : fallback) : given;
    if (MCP.isDefined(value)) {
        var prop = MCP.mrig.param(rc, name);
        if (_mcpTry(function () { return prop.numKeys; }, 0) > 0) {
            rc.notes.push("Control '" + name + "' has keys, so they were kept and the value " + JSON.stringify(value) + " was not written.");
        } else {
            prop.setValue(MCP.mrig.controlValue(type, value));
        }
    }
    if (!rc.byName[name]) {
        var rec = { name: name, type: type, created: created, keys: [] };
        rc.controls.push(rec);
        rc.byName[name] = rec;
    }
    return rc.byName[name];
};

/** The current value of a control (after the rig set it). */
MCP.mrig.valueOf = function (rc, name) {
    return MCP.mrig.param(rc, name).value;
};

/** Keys a control in two eased keys (its earlier keys are removed). Returns the keys. */
MCP.mrig.keyControl = function (rc, name, t0, v0, t1, v1, easing) {
    var prop = MCP.mrig.param(rc, name);
    if (_mcpTry(function () { return prop.numKeys; }, 0) > 0) {
        while (prop.numKeys > 0) { prop.removeKey(1); }
        rc.notes.push("The earlier keys of '" + name + "' were replaced.");
    }
    var keys = MCP.animate.keyMove(prop, t0, v0, t1, v1, MCP.isDefined(easing) ? easing : MCP.animate.EASE_LAND, { comp: rc.comp });
    rc.byName[name].keys = keys;
    return keys;
};

/** A per-layer result entry. */
MCP.mrig.entry = function (layer) {
    return { status: "ok", layer: MCP.serialize.layerRef(layer), expressions: [] };
};

/**
 * Sets code on prop (stacked with another rig's expression already there, see
 * MCP.mrig.stack) and records its state; the first code per property is kept
 * for the result.
 */
MCP.mrig.express = function (rc, entry, prop, code) {
    var old = _mcpTry(function () { return prop.canSetExpression ? String(prop.expression) : ""; }, "");
    var merged = MCP.mrig.stack(old, code);
    var st = MCP.animate.setExpression(prop, merged.code);
    var rec = { property: st.property, enabled: st.enabled, error: st.error };
    if (merged.stackedOn) { rec.stacked = merged.stackedOn; }
    if (merged.replaced) { rec.replaced = merged.replaced; }
    entry.expressions.push(rec);
    rc.count++;
    if (st.error) { rc.errors++; }
    if (!MCP.isDefined(rc.code[st.property])) {
        rc.code[st.property] = merged.code;
        if (!rc.codeLayer) { rc.codeLayer = entry.layer.name; }
    }
    return st;
};

/* ------------------------------------------------------ stacking rigs */

/*
 * Rigs stack on one property. Base rigs place a value (grid layout, clone
 * array, follow chain, fit to box, number counter); add-on rigs move it
 * further (proximity effector, wiggle rig, sway loop). An add-on's code takes
 * its starting value from one line, "var base = value;". Put on top of
 * another rig's expression, that line becomes a function holding the earlier
 * expression:
 *
 *   // >>> base expression (the value this rig adds to)
 *   function __base() {
 *   ...the earlier expression, its last line returned...
 *   }
 *   // <<< base expression
 *   var base = __base();
 *
 * Running a rig again replaces only its own part of the stack, so a grid
 * reflowed under a proximity effector keeps the effector. Expressions these
 * rigs did not write are replaced, and the result says so.
 */

MCP.mrig.RIGS = {
    "Grid layout": "base", "Clone array": "base", "Follow chain": "base", "Fit to box": "base", "Number counter": "base",
    "Proximity effector": "addon", "Wiggle rig": "addon", "Sway loop": "addon"
};

MCP.mrig.OPEN = "// >>> base expression (the value this rig adds to)";
MCP.mrig.CLOSE = "// <<< base expression";
MCP.mrig.PLAIN = "var base = value;";

/** The rig that wrote code ("Grid layout"...), read from its first line, or null. */
MCP.mrig.rigOf = function (code) {
    var first = String(code || "").split("\n")[0];
    for (var name in MCP.mrig.RIGS) {
        if (Object.prototype.hasOwnProperty.call(MCP.mrig.RIGS, name) && first.indexOf("// " + name + ":") === 0) { return name; }
    }
    return null;
};

/** An add-on's code as {head, base (the earlier expression, or null), tail}, or null when it has no base line. */
MCP.mrig.splitAddon = function (code) {
    var lines = String(code).split("\n"), open = -1, close = -1, i;
    for (i = 0; i < lines.length; i++) {
        if (lines[i] === MCP.mrig.OPEN && open < 0) { open = i; }
        if (lines[i] === MCP.mrig.CLOSE) { close = i; }
    }
    if (open >= 0 && close > open + 2) {
        var inner = lines.slice(open + 2, close - 1);
        inner[inner.length - 1] = inner[inner.length - 1].replace(/^return /, "");
        return { head: lines.slice(0, open), base: inner.join("\n"), tail: lines.slice(close + 2) };
    }
    for (i = 0; i < lines.length; i++) {
        if (lines[i] === MCP.mrig.PLAIN) { return { head: lines.slice(0, i), base: null, tail: lines.slice(i + 1) }; }
    }
    return null;
};

MCP.mrig.joinAddon = function (parts) {
    if (!parts.base) { return parts.head.concat([MCP.mrig.PLAIN], parts.tail).join("\n"); }
    var inner = parts.base.split("\n");
    inner[inner.length - 1] = "return " + inner[inner.length - 1];
    return parts.head.concat([MCP.mrig.OPEN, "function __base() {"], inner, ["}", MCP.mrig.CLOSE, "var base = __base();"], parts.tail).join("\n");
};

/** Puts a base rig's code under old: in place of the same rig, or under the add-ons stacked on it. */
MCP.mrig.replaceBase = function (old, code, info) {
    var kind = MCP.mrig.rigOf(old);
    if (kind && MCP.mrig.RIGS[kind] === "addon") {
        var parts = MCP.mrig.splitAddon(old);
        if (parts) {
            info.under.push(kind);
            parts.base = parts.base ? MCP.mrig.replaceBase(parts.base, code, info) : code;
            return MCP.mrig.joinAddon(parts);
        }
    }
    if (old && kind !== MCP.mrig.rigOf(code)) { info.replaced = old.split("\n")[0].substring(0, 120); }
    return code;
};

/** The code to set, given the expression already on the property. Returns {code, stackedOn, replaced}. */
MCP.mrig.stack = function (old, code) {
    var mine = MCP.mrig.rigOf(code), theirs = MCP.mrig.rigOf(old);
    if (!old) { return { code: code, stackedOn: null, replaced: null }; }
    if (MCP.mrig.RIGS[mine] !== "addon") {
        var info = { under: [], replaced: null };
        var out = MCP.mrig.replaceBase(old, code, info);
        return { code: out, stackedOn: info.under.length ? "under " + info.under.join(", ") : null, replaced: info.replaced };
    }
    var parts = MCP.mrig.splitAddon(code);
    if (!parts) { return { code: code, stackedOn: null, replaced: old.split("\n")[0].substring(0, 120) }; }
    if (theirs === mine) {
        // the same rig again: keep what it was stacked on
        var prev = MCP.mrig.splitAddon(old);
        parts.base = prev ? prev.base : null;
        return { code: MCP.mrig.joinAddon(parts), stackedOn: parts.base ? "on " + (MCP.mrig.rigOf(parts.base) || "an expression") : null, replaced: null };
    }
    if (theirs) {
        parts.base = old;
        return { code: MCP.mrig.joinAddon(parts), stackedOn: "on " + theirs, replaced: null };
    }
    return { code: code, stackedOn: null, replaced: old.split("\n")[0].substring(0, 120) };
};

MCP.mrig.positionSeparated = function (layer) {
    return _mcpTry(function () { return !!layer.property("ADBE Transform Group").property("ADBE Position").dimensionsSeparated; }, false);
};

/**
 * Sets a Position expression. gen(axis) returns the code: axis -1 for the
 * combined Position, or 0, 1, 2 for one separated dimension (only the axes
 * listed, and Z only on 3D layers).
 */
MCP.mrig.expressPosition = function (rc, entry, layer, gen, axes) {
    if (!MCP.mrig.positionSeparated(layer)) {
        MCP.mrig.express(rc, entry, layer.property("ADBE Transform Group").property("ADBE Position"), gen(-1));
        return;
    }
    for (var i = 0; i < axes.length; i++) {
        if (axes[i] === 2 && !layer.threeDLayer) { continue; }
        MCP.mrig.express(rc, entry, layer.property("ADBE Transform Group").property("ADBE Position_" + axes[i]), gen(axes[i]));
    }
};

/** Runs fn(entry) for one layer; an error marks the entry instead of stopping the rig. */
MCP.mrig.each = function (rc, layer, results, fn) {
    var entry = MCP.mrig.entry(layer);
    try {
        fn(entry);
    } catch (err) {
        entry.status = "error";
        entry.error = (err && err.message) ? err.message : String(err);
    }
    results.push(entry);
    return entry;
};

/** The fields every rig returns, merged with extra. */
MCP.mrig.finish = function (rc, extra) {
    var controls = [];
    var hostRef = "thisComp.layer(" + MCP.expr.str(rc.host.name) + ")";
    for (var i = 0; i < rc.controls.length; i++) {
        var c = rc.controls[i];
        var prop = MCP.mrig.param(rc, c.name);
        controls.push({
            name: c.name,
            type: c.type,
            created: c.created,
            propertyPath: "Effects/" + c.name + "/" + prop.name,
            expression: hostRef + ".effect(" + MCP.expr.str(c.name) + ")(1)",
            value: MCP.serialize.value(prop),
            keys: c.keys
        });
    }
    var out = {
        composition: MCP.serialize.compRef(rc.comp),
        controlLayer: MCP.serialize.layerRef(rc.host),
        controlLayerCreated: rc.created,
        controls: controls
    };
    MCP.extend(out, extra || {});
    if (MCP.isArray(out.layers)) {
        var failed = 0;
        for (var j = 0; j < out.layers.length; j++) { if (out.layers[j].status !== "ok") { failed++; } }
        out.count = out.layers.length;
        out.failed = failed;
    }
    out.expressionCount = rc.count;
    out.expressionErrors = rc.errors;
    out.expressionCode = rc.code;
    out.expressionCodeLayer = rc.codeLayer;
    out.notes = rc.notes;
    return out;
};

/** Skips cameras, lights, locked layers, nulls (when bounds are needed) and the excluded layers; returns the rest. */
MCP.mrig.usable = function (layers, exclude, skipped, needsBounds) {
    var out = [], i, j;
    for (i = 0; i < layers.length; i++) {
        var L = layers[i], reason = null;
        for (j = 0; j < exclude.length; j++) { if (exclude[j].layer && exclude[j].layer.index === L.index) { reason = exclude[j].reason; } }
        if (!reason && ((L instanceof CameraLayer) || (L instanceof LightLayer))) { reason = "cameras and lights have no bounds, scale or opacity to rig"; }
        if (!reason && L.locked) { reason = "the layer is locked"; }
        if (!reason && needsBounds && _mcpTry(function () { return !!L.nullLayer; }, false)) { reason = "a null has no visible bounds"; }
        if (reason) { skipped.push({ layer: MCP.serialize.layerRef(L), reason: reason }); continue; }
        out.push(L);
    }
    return out;
};

/** The layers of spec in the requested order (default fallbackOrder), each once. */
MCP.mrig.layers = function (comp, spec, order, fallbackOrder) {
    return MCP.animate.ordered(MCP.resolveLayers(comp, spec), MCP.isDefined(order) ? order : fallbackOrder, 1);
};

/** Fails for a 3D layer with a parent and separated Position (its depth cannot be read without a loop). */
MCP.mrig.requirePlaceable = function (layer) {
    if (layer.threeDLayer && layer.parent && MCP.mrig.positionSeparated(layer)) {
        MCP.fail("Layer '" + layer.name + "' is 3D, has a parent and separated Position dimensions, so its position cannot be set by expression here. Join the dimensions (separate-dimensions) or remove the parent first.", "unsupported");
    }
};

/** Checks a {startTime|startFrame, duration|durationFrames} block before anything changes. */
MCP.mrig.requireSpan = function (spec, label) {
    var d = MCP.isDefined(spec.durationFrames) ? Number(spec.durationFrames) : (MCP.isDefined(spec.duration) ? Number(spec.duration) : 1);
    if (!(d > 0)) { MCP.fail(label + " needs a duration above 0.", "invalid-argument"); }
};

/* ------------------------------------------------- 2D affine transforms */

/*
 * Matrices are [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
 * A layer or shape group maps a point p to position + R(rotation) S(scale) (p - anchor).
 */

MCP.mrig.mul = function (A, B) {
    return [
        A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
        A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
        A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]
    ];
};

MCP.mrig.inv = function (A) {
    var det = A[0] * A[3] - A[1] * A[2];
    if (Math.abs(det) < 1e-12) { return null; }
    return [A[3] / det, -A[1] / det, -A[2] / det, A[0] / det, (A[2] * A[5] - A[3] * A[4]) / det, (A[1] * A[4] - A[0] * A[5]) / det];
};

MCP.mrig.apply = function (M, p) {
    return [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]];
};

MCP.mrig.applyVec = function (M, v) {
    return [M[0] * v[0] + M[2] * v[1], M[1] * v[0] + M[3] * v[1]];
};

/** position + R(rotation) S(scale percent) (p - anchor) as a matrix. */
MCP.mrig.trs = function (pos, rotDeg, scalePct, anchor) {
    var r = Number(rotDeg) * Math.PI / 180;
    var cs = Math.cos(r), sn = Math.sin(r);
    var sx = Number(scalePct[0]) / 100, sy = Number(scalePct[1]) / 100;
    var a = cs * sx, b = sn * sx, c = -sn * sy, d = cs * sy;
    return [a, b, c, d, Number(pos[0]) - (a * anchor[0] + c * anchor[1]), Number(pos[1]) - (b * anchor[0] + d * anchor[1])];
};

/** A layer's own Position at t, combined when its dimensions are separated. */
MCP.mrig.positionAt = function (layer, t) {
    var tg = layer.property("ADBE Transform Group");
    if (MCP.mrig.positionSeparated(layer)) {
        var out = [tg.property("ADBE Position_0").valueAtTime(t, false), tg.property("ADBE Position_1").valueAtTime(t, false)];
        if (layer.threeDLayer) { out.push(tg.property("ADBE Position_2").valueAtTime(t, false)); }
        return out;
    }
    return tg.property("ADBE Position").valueAtTime(t, false);
};

/** A 2D layer's transform at t (layer space to its parent's space). */
MCP.mrig.layerMatrix = function (layer, t) {
    var tg = layer.property("ADBE Transform Group");
    return MCP.mrig.trs(
        MCP.mrig.positionAt(layer, t),
        tg.property("ADBE Rotate Z").valueAtTime(t, false),
        tg.property("ADBE Scale").valueAtTime(t, false),
        tg.property("ADBE Anchor Point").valueAtTime(t, false)
    );
};

/** Layer space to composition space through every parent, or null when a 3D layer is in the chain. */
MCP.mrig.toCompMatrix = function (layer, t) {
    var M = [1, 0, 0, 1, 0, 0], L = layer, guard = 0;
    while (L && guard < 100) {
        if (_mcpTry(function () { return !!L.threeDLayer; }, false)) { return null; }
        M = MCP.mrig.mul(MCP.mrig.layerMatrix(L, t), M);
        L = L.parent;
        guard++;
    }
    return M;
};

/** A composition point in a layer's own space (from Position and Anchor alone for 3D layers). */
MCP.mrig.toLayerSpace = function (layer, compPoint, t) {
    var M = MCP.mrig.toCompMatrix(layer, t);
    var inv = M ? MCP.mrig.inv(M) : null;
    if (inv) { return MCP.mrig.apply(inv, compPoint); }
    var pos = MCP.mrig.positionAt(layer, t), anc = layer.property("ADBE Transform Group").property("ADBE Anchor Point").valueAtTime(t, false);
    return [compPoint[0] - pos[0] + anc[0], compPoint[1] - pos[1] + anc[1]];
};

/** A layer's anchor point in composition space (Position x, y for 3D layers). */
MCP.mrig.compPoint = function (layer, t) {
    var M = MCP.mrig.toCompMatrix(layer, t);
    if (M) { return MCP.mrig.apply(M, layer.property("ADBE Transform Group").property("ADBE Anchor Point").valueAtTime(t, false)); }
    var pos = MCP.mrig.positionAt(layer, t);
    return [pos[0], pos[1]];
};

/** Width and height of a layer's content at t in composition pixels (bounds times |scale|). */
MCP.mrig.visualSize = function (layer, t) {
    var r = _mcpTry(function () { return layer.sourceRectAtTime(t, false); }, null);
    if (!r) { return null; }
    var sc = _mcpTry(function () { return layer.property("ADBE Transform Group").property("ADBE Scale").valueAtTime(t, false); }, [100, 100]);
    return [Math.abs(r.width * sc[0] / 100), Math.abs(r.height * sc[1] / 100)];
};

/* -------------------------------------------------------- number counter */

/**
 * Formats a number the way the counter expression does (the same steps run
 * inside the Source Text expression; a test checks they agree).
 * o: {decimals, minDigits, group, sep, point, prefix, suffix, plus}.
 */
MCP.mrig.formatNumber = function (x, o) {
    var f = Math.pow(10, o.decimals);
    var r = Math.round(Math.abs(x) * f) / f;
    var s = r.toFixed(o.decimals);
    var ip = s, fp = "", dot = s.indexOf(".");
    if (dot >= 0) { ip = s.substring(0, dot); fp = s.substring(dot + 1); }
    while (ip.length < o.minDigits) { ip = "0" + ip; }
    if (o.group && o.sep !== "") {
        var g = "";
        while (ip.length > 3) { g = o.sep + ip.substring(ip.length - 3) + g; ip = ip.substring(0, ip.length - 3); }
        ip = ip + g;
    }
    var sign = (x < 0 && r > 0) ? "-" : ((o.plus && r > 0) ? "+" : "");
    return sign + o.prefix + ip + (o.decimals > 0 ? o.point + fp : "") + o.suffix;
};

/** The format options of a counter from its arguments. */
MCP.mrig.counterFormat = function (args) {
    var sep = MCP.isDefined(args.thousandsSeparator) ? String(args.thousandsSeparator) : ",";
    return {
        decimals: Math.round(MCP.clamp(MCP.num(args.decimals, 0), 0, 10)),
        minDigits: Math.round(MCP.clamp(MCP.num(args.minDigits, 0), 0, 30)),
        group: sep !== "",
        sep: sep !== "" ? sep : ",",
        point: MCP.isDefined(args.decimalSeparator) ? String(args.decimalSeparator) : ".",
        prefix: MCP.isDefined(args.prefix) ? String(args.prefix) : "",
        suffix: MCP.isDefined(args.suffix) ? String(args.suffix) : "",
        plus: MCP.bool(args.showPlus, false)
    };
};

/** The Source Text expression of a counter. */
MCP.mrig.counterCode = function (rc, layer, o, mult, tabular) {
    var s = MCP.expr.str, c = MCP.mrig.c;
    return [
        "// Number counter: the Value slider drives this text. Edit prefix, suffix and separators here.",
        "var C = " + MCP.mrig.hostRef(rc, layer) + ";",
        "var o = {",
        "  prefix: " + s(o.prefix) + ", suffix: " + s(o.suffix) + ", sep: " + s(o.sep) + ", point: " + s(o.point) + ", plus: " + (o.plus ? "true" : "false") + ",",
        "  decimals: Math.round(clamp(" + c("Decimals") + ", 0, 10)),",
        "  minDigits: Math.round(clamp(" + c("Min Digits") + ", 0, 30)),",
        "  group: " + c("Separator") + " > 0",
        "};",
        "var mult = " + MCP.expr.num(mult) + ";",
        "var tabular = " + (tabular ? "true" : "false") + ";",
        "function fmt(x) {",
        "  var f = Math.pow(10, o.decimals);",
        "  var r = Math.round(Math.abs(x) * f) / f;",
        "  var s = r.toFixed(o.decimals);",
        "  var ip = s, fp = \"\", dot = s.indexOf(\".\");",
        "  if (dot >= 0) { ip = s.substring(0, dot); fp = s.substring(dot + 1); }",
        "  while (ip.length < o.minDigits) { ip = \"0\" + ip; }",
        "  if (o.group && o.sep !== \"\") {",
        "    var g = \"\";",
        "    while (ip.length > 3) { g = o.sep + ip.substring(ip.length - 3) + g; ip = ip.substring(0, ip.length - 3); }",
        "    ip = ip + g;",
        "  }",
        "  var sign = (x < 0 && r > 0) ? \"-\" : ((o.plus && r > 0) ? \"+\" : \"\");",
        "  return sign + o.prefix + ip + (o.decimals > 0 ? o.point + fp : \"\") + o.suffix;",
        "}",
        "var S = C.effect(\"Value\")(1);",
        "var out = fmt(S.value * mult);",
        "if (tabular) {",
        "  // pad with figure spaces (as wide as a digit) to the widest end value",
        "  var a = S.numKeys > 0 ? S.key(1).value : S.value, b = S.numKeys > 0 ? S.key(S.numKeys).value : S.value;",
        "  var w = Math.max(fmt(a * mult).length, fmt(b * mult).length);",
        "  while (out.length < w) { out = \"\\u2007\" + out; }",
        "}",
        "out;"
    ].join("\n");
};

MCP.mrig.COUNTER_CONTROLS = [["slider", "Value"], ["slider", "Decimals"], ["slider", "Min Digits"], ["checkbox", "Separator"]];

MCP.register("numberCounter", function (args, cmdCtx) {
    var comp = MCP.resolveComp(args.comp);
    var from = MCP.num(args.from, 0);
    var to = Number(MCP.requireArg(args, "to"));
    if (isNaN(from) || isNaN(to)) { MCP.fail("from and to must be numbers.", "invalid-argument"); }
    var o = MCP.mrig.counterFormat(args);
    var mode = String(MCP.arg(args, "controls", "layer"));
    if (mode !== "layer" && mode !== "null") { MCP.fail("controls must be layer or null.", "invalid-argument"); }
    var layer = null;
    if (MCP.isDefined(args.layer)) {
        layer = MCP.resolveLayer(comp, args.layer);
        if (!(layer instanceof TextLayer)) { MCP.fail("Layer '" + layer.name + "' is not a text layer. Give a text layer, or leave layer out to create one.", "invalid-argument"); }
        if (layer.locked) { MCP.fail("Layer '" + layer.name + "' is locked.", "invalid-argument"); }
    }
    var host = MCP.mrig.givenHost(comp, args, MCP.mrig.COUNTER_CONTROLS);
    if (!host && mode === "layer" && layer) { host = MCP.mrig.checkHost(comp, layer, MCP.mrig.COUNTER_CONTROLS, true); }
    MCP.mrig.requireSpan(args, "The counter");

    var layerCreated = false;
    if (!layer) {
        var made = MCP.invoke("createTextLayer", {
            comp: args.comp, text: MCP.mrig.formatNumber(from, o),
            font: args.font, fontSize: args.fontSize, fillColor: args.fillColor, justification: args.justification,
            position: args.position, name: MCP.isDefined(args.name) ? args.name : "Counter"
        }, cmdCtx);
        layer = (MCP.isDefined(made.layer.id) && made.layer.id !== null) ? MCP.resolveLayer(comp, { id: made.layer.id }) : MCP.resolveLayer(comp, { index: made.layer.index });
        layerCreated = true;
        if (!host && mode === "layer") { host = layer; }
    }
    var t0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", layer.inPoint);
    var t1 = t0 + MCP.animate.span(comp, args, 2);
    var big = Math.max(Math.abs(from), Math.abs(to)), mult = 1;
    while (big / mult > MCP.mrig.SLIDER_LIMIT) { mult *= 10; }

    var rc = MCP.mrig.begin(comp, { args: args, name: layer.name + " Controls", host: host });
    if (mult !== 1) { rc.notes.push("The values pass one million, so Value holds them divided by " + mult + " and the expression multiplies back (var mult)."); }
    MCP.mrig.control(rc, "slider", "Value", from / mult, from / mult);
    MCP.mrig.control(rc, "slider", "Decimals", o.decimals, 0);
    MCP.mrig.control(rc, "slider", "Min Digits", o.minDigits, 0);
    MCP.mrig.control(rc, "checkbox", "Separator", o.group, true);
    if (from !== to) {
        MCP.mrig.keyControl(rc, "Value", t0, from / mult, t1, to / mult, args.easing);
    } else {
        rc.notes.push("from equals to, so Value was set without keys.");
    }
    var tabular = MCP.bool(args.tabular, false);
    var entry = MCP.mrig.each(rc, layer, [], function (e) {
        var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
        if (_mcpTry(function () { return textProp.numKeys; }, 0) > 0) { rc.notes.push("Source Text has keys; the expression overrides them."); }
        MCP.mrig.express(rc, e, textProp, MCP.mrig.counterCode(rc, layer, o, mult, tabular));
    });
    if (entry.status !== "ok") { rc.notes.push("The Source Text expression could not be set: " + entry.error); }
    if (tabular) { rc.notes.push("tabular pads with figure spaces; digits keep one width only in a font whose figures are tabular (monospaced). Scripting cannot switch on the OpenType tabular figures feature."); }
    return MCP.mrig.finish(rc, {
        layer: MCP.serialize.layerRef(layer),
        layerCreated: layerCreated,
        from: from, to: to, multiplier: mult,
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        format: {
            decimals: o.decimals, minDigits: o.minDigits, thousandsSeparator: o.group ? o.sep : "", decimalSeparator: o.point,
            prefix: o.prefix, suffix: o.suffix, showPlus: o.plus, tabular: tabular
        },
        fromText: MCP.mrig.formatNumber(from, o),
        toText: MCP.mrig.formatNumber(to, o),
        status: entry.status,
        expressions: entry.expressions
    });
}, { mutating: true });

/* ----------------------------------------------------------- grid layout */

/** Column and row (1-based) of slot (0-based) in a grid of cols columns; mirrors the expression. */
MCP.mrig.gridCell = function (slot, n, cols, colFirst, reverse) {
    var j = reverse ? n - 1 - slot : slot;
    var k = Math.max(1, Math.floor(cols));
    var rows = Math.ceil(n / k);
    if (colFirst) { return { col: Math.floor(j / rows) + 1, row: (j % rows) + 1 }; }
    return { col: (j % k) + 1, row: Math.floor(j / k) + 1 };
};

/** Calls cb(item, groups, label) for every path item (Bezier path, rectangle, ellipse, star) under a vector group. */
MCP.mrig.walkShapes = function (container, groups, prefix, cb, depth) {
    if (!container || depth > 12) { return; }
    for (var i = 1; i <= container.numProperties; i++) {
        var p = container.property(i);
        var mn = p.matchName;
        if (mn === "ADBE Vector Group") {
            var next = groups.slice(0);
            next.push(p);
            MCP.mrig.walkShapes(p.property("ADBE Vectors Group"), next, prefix + p.name + "/", cb, depth + 1);
        } else if (mn === "ADBE Vector Shape - Group" || mn === "ADBE Vector Shape - Rect" || mn === "ADBE Vector Shape - Ellipse" || mn === "ADBE Vector Shape - Star") {
            cb(p, groups, prefix + p.name);
        }
    }
};

/** The indices from the layer down to prop, so it can be fetched again after other changes. */
MCP.mrig.indicesOf = function (prop) {
    var out = [], p = prop;
    while (p && p.propertyDepth > 0) {
        out.unshift(p.propertyIndex);
        p = p.parentProperty;
    }
    return out;
};

MCP.mrig.propByIndices = function (layer, indices) {
    var p = layer;
    for (var i = 0; i < indices.length; i++) { p = p.property(indices[i]); }
    return p;
};

/** Indices of the single Rectangle Path of a shape layer that holds no other path, or null. */
MCP.mrig.singleRect = function (layer) {
    if (!(layer instanceof ShapeLayer)) { return null; }
    var rects = [], paths = 0;
    MCP.mrig.walkShapes(layer.property("ADBE Root Vectors Group"), [], "", function (item) {
        if (item.matchName === "ADBE Vector Shape - Rect") { rects.push(MCP.mrig.indicesOf(item)); }
        paths++;
    }, 0);
    return (rects.length === 1 && paths === 1) ? rects[0] : null;
};

/** Shared top of every grid expression. */
MCP.mrig.gridTop = function (rc, layer, title) {
    var c = MCP.mrig.c;
    return [
        "// Grid layout: " + title + " (controls on " + MCP.expr.str(rc.host.name) + ")",
        "var C = " + MCP.mrig.hostRef(rc, layer) + ";",
        "var cw = " + c("Cell Width") + ", ch = " + c("Cell Height") + ";",
        "var gx = " + c("Gap X") + ", gy = " + c("Gap Y") + ";"
    ];
};

/** The line that sets sw and sh, the size of a cell spanning cs columns and rs rows. */
MCP.mrig.spanLine = function (cs, rs) {
    return "var sw = " + cs + " * cw + " + (cs - 1) + " * gx, sh = " + rs + " * ch + " + (rs - 1) + " * gy;";
};

/**
 * Appends the lines that turn p, a composition point [x, y], into this layer's
 * Position (or one axis of it): through the parent for parented layers, at the
 * layer's own depth for 3D layers. (3D layers with a parent and separated
 * dimensions are refused before this runs.)
 */
MCP.mrig.placeLines = function (L, layer, axis) {
    if (layer.threeDLayer) {
        if (axis < 0) { L.push("if (hasParent) { p = parent.fromWorld([p[0], p[1], parent.toWorld(value)[2]]); } else { p = [p[0], p[1], value[2]]; }"); }
    } else {
        L.push("if (hasParent) { p = parent.fromComp(p); }");
    }
    L.push(axis < 0 ? "p;" : "p[" + axis + "];");
};

/** The Position expression of one grid or bento cell. */
MCP.mrig.gridPositionCode = function (rc, layer, cell, n, bento, axis) {
    var c = MCP.mrig.c;
    var title = bento ? "bento cell at column " + cell.col + ", row " + cell.row + " (" + cell.colSpan + " x " + cell.rowSpan + ")" : "slot " + (cell.slot + 1) + " of " + n;
    var L = MCP.mrig.gridTop(rc, layer, title);
    L.push("var o = C.toComp(" + c("Origin") + ");");
    L.push("var centred = " + c("Center On Origin") + " > 0;");
    if (bento) {
        L.push("var col = " + cell.col + ", row = " + cell.row + ", cs = " + cell.colSpan + ", rs = " + cell.rowSpan + ";");
        L.push("var cols = Math.max(1, " + c("Columns") + "), rows = Math.max(1, " + c("Rows") + ");");
        L.push("var w = cols * cw + (cols - 1) * gx, h = rows * ch + (rows - 1) * gy;");
        L.push("var x0 = centred ? o[0] - w / 2 : o[0], y0 = centred ? o[1] - h / 2 : o[1];");
        L.push("var sw = cs * cw + (cs - 1) * gx, sh = rs * ch + (rs - 1) * gy;");
        L.push("var a = [x0 + (col - 1) * (cw + gx) + sw / 2, y0 + (row - 1) * (ch + gy) + sh / 2];");
    } else {
        L.push("var n = " + n + ", slot = " + cell.slot + ";");
        L.push("var colFirst = " + c("Column First") + " > 0, rev = " + c("Reverse Order") + " > 0;");
        L.push("function cellCentre(k) {");
        L.push("  var j = rev ? n - 1 - slot : slot;");
        L.push("  var rows = Math.ceil(n / k), cols, cc, rr;");
        L.push("  if (colFirst) { cc = Math.floor(j / rows); rr = j % rows; cols = Math.ceil(n / rows); }");
        L.push("  else { cc = j % k; rr = Math.floor(j / k); cols = Math.min(k, n); }");
        L.push("  var w = cols * cw + (cols - 1) * gx, h = rows * ch + (rows - 1) * gy;");
        L.push("  var x0 = centred ? o[0] - w / 2 : o[0], y0 = centred ? o[1] - h / 2 : o[1];");
        L.push("  return [x0 + cc * (cw + gx) + cw / 2, y0 + rr * (ch + gy) + ch / 2];");
        L.push("}");
        L.push("// a fractional Columns value glides each cell between the two layouts");
        L.push("var cv = Math.max(1, " + c("Columns") + ");");
        L.push("var k0 = Math.floor(cv), f = cv - k0;");
        L.push("var a = cellCentre(k0);");
        L.push("if (f > 0.0001) { var b = cellCentre(k0 + 1); a = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }");
    }
    L.push("// put the centre of the layer's bounds on the cell centre");
    L.push("var R = sourceRectAtTime(time, false), s = transform.scale.value, ap = transform.anchorPoint.value;");
    L.push("var rot = degreesToRadians(transform.rotation.value);");
    L.push("var ox = (R.left + R.width / 2 - ap[0]) * s[0] / 100, oy = (R.top + R.height / 2 - ap[1]) * s[1] / 100;");
    L.push("var p = [a[0] - (ox * Math.cos(rot) - oy * Math.sin(rot)), a[1] - (ox * Math.sin(rot) + oy * Math.cos(rot))];");
    MCP.mrig.placeLines(L, layer, axis);
    return L.join("\n");
};

/** The Scale expression that fits a layer into its cell. */
MCP.mrig.gridScaleCode = function (rc, layer, cell, fit) {
    var L = MCP.mrig.gridTop(rc, layer, "fit into the cell (" + fit + ")");
    L.push(MCP.mrig.spanLine(cell.colSpan, cell.rowSpan));
    L.push("var R = sourceRectAtTime(time, false);");
    L.push("var fx = sw / Math.max(R.width, 0.001), fy = sh / Math.max(R.height, 0.001);");
    L.push("var mode = " + MCP.expr.str(fit) + ";");
    L.push("if (mode == \"contain\") { var m1 = Math.min(fx, fy); fx = m1; fy = m1; } else if (mode == \"cover\") { var m2 = Math.max(fx, fy); fx = m2; fy = m2; }");
    L.push("var fitted = value.length > 2 ? [fx * 100, fy * 100, value[2]] : [fx * 100, fy * 100];");
    L.push(MCP.mrig.c("Fit Cells") + " > 0 ? fitted : value;");
    return L.join("\n");
};

/** The Size expression of a rectangle that fills its cell. */
MCP.mrig.gridSizeCode = function (rc, layer, cell) {
    var L = MCP.mrig.gridTop(rc, layer, "rectangle size from the cell");
    L.push(MCP.mrig.spanLine(cell.colSpan, cell.rowSpan));
    L.push("var s = thisLayer.transform.scale.value;");
    L.push("var filled = [sw * 100 / Math.max(Math.abs(s[0]), 0.001), sh * 100 / Math.max(Math.abs(s[1]), 0.001)];");
    L.push(MCP.mrig.c("Fit Cells") + " > 0 ? filled : value;");
    return L.join("\n");
};

MCP.mrig.GRID_ANIMATE = {
    "columns": ["Columns"],
    "rows": ["Rows"],
    "cell-size": ["Cell Width", "Cell Height"],
    "gap": ["Gap X", "Gap Y"],
    "origin": ["Origin"]
};

MCP.mrig.GRID_CONTROLS = [
    ["slider", "Columns"], ["slider", "Rows"], ["slider", "Cell Width"], ["slider", "Cell Height"], ["slider", "Gap X"], ["slider", "Gap Y"],
    ["point", "Origin"], ["checkbox", "Center On Origin"], ["checkbox", "Column First"], ["checkbox", "Reverse Order"], ["checkbox", "Fit Cells"]
];

/** Checks an animate block of grid-layout before anything changes; returns {names, values} (values null for origin). */
MCP.mrig.gridAnimateSpec = function (spec, bento) {
    var which = String(MCP.requireArg(spec, "control"));
    var names = MCP.mrig.GRID_ANIMATE[which];
    if (!names) { MCP.fail("animate.control must be columns, rows, cell-size, gap or origin.", "invalid-argument"); }
    if (which === "rows" && !bento) { MCP.fail("Rows is a bento control. Animate columns, cell-size, gap or origin for a grid.", "invalid-argument"); }
    MCP.mrig.requireSpan(spec, "animate");
    var to = MCP.requireArg(spec, "to");
    var values;
    if (which === "origin" || which === "cell-size") {
        if (!MCP.isArray(to) || to.length < 2) { MCP.fail("animate.to must be [x, y] for " + which + ".", "invalid-argument"); }
        values = [Number(to[0]), Number(to[1])];
    } else if (which === "gap") {
        values = MCP.isArray(to) ? [Number(to[0]), Number(to[1])] : [Number(to), Number(to)];
    } else {
        if (MCP.isArray(to)) { MCP.fail("animate.to must be a number for " + which + ".", "invalid-argument"); }
        values = [Math.max(1, Number(to))];
    }
    for (var i = 0; i < values.length; i++) { if (isNaN(values[i])) { MCP.fail("animate.to must hold numbers.", "invalid-argument"); } }
    return { control: which, names: names, values: values };
};

MCP.register("gridLayout", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var t = MCP.snapToFrame(comp, comp.time);
    var bento = MCP.isArray(args.bento) && args.bento.length ? args.bento : null;
    var layers = [], i;
    if (bento && MCP.isDefined(bento[0].layer)) {
        for (i = 0; i < bento.length; i++) {
            if (!MCP.isDefined(bento[i].layer)) { MCP.fail("Bento entry " + (i + 1) + " has no layer, but entry 1 has one: give every entry a layer, or none and use layers.", "invalid-argument"); }
            layers.push(MCP.resolveLayer(comp, bento[i].layer));
        }
    } else {
        layers = MCP.mrig.layers(comp, MCP.requireArg(args, "layers"), args.order, "top-down");
        if (bento && bento.length !== layers.length) { MCP.fail("bento has " + bento.length + " entries for " + layers.length + " layers. Give one entry per layer, in the layers' order.", "invalid-argument"); }
    }
    var seen = {};
    for (i = 0; i < layers.length; i++) {
        var Li = layers[i];
        if (seen[Li.index]) { MCP.fail("Layer '" + Li.name + "' is listed twice.", "invalid-argument"); }
        seen[Li.index] = true;
        if ((Li instanceof CameraLayer) || (Li instanceof LightLayer)) { MCP.fail("Layer '" + Li.name + "' is a camera or light and cannot sit in a grid.", "invalid-argument"); }
        if (Li.locked) { MCP.fail("Layer '" + Li.name + "' is locked.", "invalid-argument"); }
        MCP.mrig.requirePlaceable(Li);
    }
    var n = layers.length;
    if (!n) { MCP.fail("No layers to arrange.", "invalid-argument"); }
    var cells = [], cols, rows = 0;
    if (bento) {
        cols = 0;
        for (i = 0; i < n; i++) {
            var b = bento[i];
            var cell = { slot: i, col: Math.round(MCP.num(b.col, 0)), row: Math.round(MCP.num(b.row, 0)), colSpan: Math.round(MCP.num(b.colSpan, 1)), rowSpan: Math.round(MCP.num(b.rowSpan, 1)) };
            if (cell.col < 1 || cell.row < 1 || cell.colSpan < 1 || cell.rowSpan < 1) { MCP.fail("Bento entry " + (i + 1) + ": col and row start at 1 and spans are at least 1.", "invalid-argument"); }
            cols = Math.max(cols, cell.col + cell.colSpan - 1);
            rows = Math.max(rows, cell.row + cell.rowSpan - 1);
            cells.push(cell);
        }
        if (MCP.isDefined(args.columns)) { cols = Math.max(cols, Math.round(Number(args.columns))); }
    } else {
        cols = Math.max(1, Math.round(MCP.num(args.columns, Math.ceil(Math.sqrt(n)))));
    }
    var fill = String(MCP.arg(args, "fill", "rows"));
    if (fill !== "rows" && fill !== "columns") { MCP.fail("fill must be rows or columns.", "invalid-argument"); }
    var colFirst = fill === "columns";
    var reverse = MCP.bool(args.reverse, false);
    var fit = String(MCP.arg(args, "fit", bento ? "contain" : "none"));
    if (fit !== "none" && fit !== "contain" && fit !== "cover" && fit !== "stretch") { MCP.fail("fit must be none, contain, cover or stretch.", "invalid-argument"); }
    var align = String(MCP.arg(args, "align", "center"));
    if (align !== "center" && align !== "top-left") { MCP.fail("align must be center or top-left.", "invalid-argument"); }
    var anim = args.animate ? MCP.mrig.gridAnimateSpec(args.animate, bento) : null;
    var host = MCP.mrig.givenHost(comp, args, MCP.mrig.GRID_CONTROLS);
    if (host && seen[host.index]) { MCP.fail("The control layer '" + host.name + "' is one of the grid's layers. Use a separate layer for the controls.", "invalid-argument"); }

    var gridRows = bento ? rows : Math.ceil(n / cols);
    var usedCols = bento ? cols : Math.min(cols, n);
    var gap = MCP.isArray(args.gap) ? [Number(args.gap[0]), Number(args.gap[1])] : (MCP.isDefined(args.gap) ? [Number(args.gap), Number(args.gap)] : [24, 24]);
    var cellSize;
    if (MCP.isArray(args.cellSize)) {
        cellSize = [Number(args.cellSize[0]), Number(args.cellSize[1])];
    } else if (!bento && fit === "none") {
        cellSize = [1, 1];
        for (i = 0; i < n; i++) {
            var vs = MCP.mrig.visualSize(layers[i], t);
            if (vs) { cellSize = [Math.max(cellSize[0], Math.ceil(vs[0])), Math.max(cellSize[1], Math.ceil(vs[1]))]; }
        }
    } else {
        cellSize = [
            Math.max(1, Math.round((comp.width * 0.8 - (usedCols - 1) * gap[0]) / usedCols)),
            Math.max(1, Math.round((comp.height * 0.8 - (gridRows - 1) * gap[1]) / gridRows))
        ];
    }
    var centred = align === "center";
    var gridW = usedCols * cellSize[0] + (usedCols - 1) * gap[0];
    var gridH = gridRows * cellSize[1] + (gridRows - 1) * gap[1];
    var origin = MCP.isArray(args.origin) ? [Number(args.origin[0]), Number(args.origin[1])] :
        (centred ? [comp.width / 2, comp.height / 2] : [Math.round((comp.width - gridW) / 2), Math.round((comp.height - gridH) / 2)]);

    var rc = MCP.mrig.begin(comp, { args: args, name: "Grid Controls", host: host, position: origin });
    MCP.mrig.control(rc, "slider", "Columns", (MCP.isDefined(args.columns) || bento) ? cols : undefined, cols);
    if (bento) { MCP.mrig.control(rc, "slider", "Rows", rows, rows); }
    MCP.mrig.control(rc, "slider", "Cell Width", MCP.isArray(args.cellSize) ? cellSize[0] : undefined, cellSize[0]);
    MCP.mrig.control(rc, "slider", "Cell Height", MCP.isArray(args.cellSize) ? cellSize[1] : undefined, cellSize[1]);
    MCP.mrig.control(rc, "slider", "Gap X", MCP.isDefined(args.gap) ? gap[0] : undefined, gap[0]);
    MCP.mrig.control(rc, "slider", "Gap Y", MCP.isDefined(args.gap) ? gap[1] : undefined, gap[1]);
    var originValue = MCP.mrig.toLayerSpace(rc.host, origin, t);
    MCP.mrig.control(rc, "point", "Origin", MCP.isArray(args.origin) ? originValue : undefined, originValue);
    MCP.mrig.control(rc, "checkbox", "Center On Origin", MCP.isDefined(args.align) ? centred : undefined, centred);
    if (!bento) {
        MCP.mrig.control(rc, "checkbox", "Column First", MCP.isDefined(args.fill) ? colFirst : undefined, colFirst);
        MCP.mrig.control(rc, "checkbox", "Reverse Order", MCP.isDefined(args.reverse) ? reverse : undefined, reverse);
    }
    if (fit !== "none") { MCP.mrig.control(rc, "checkbox", "Fit Cells", true, true); }
    // Report the layout the controls now hold (a shared control layer may keep earlier values).
    cols = MCP.mrig.valueOf(rc, "Columns");
    cellSize = [MCP.mrig.valueOf(rc, "Cell Width"), MCP.mrig.valueOf(rc, "Cell Height")];
    gap = [MCP.mrig.valueOf(rc, "Gap X"), MCP.mrig.valueOf(rc, "Gap Y")];
    if (!bento) {
        colFirst = MCP.mrig.valueOf(rc, "Column First") > 0;
        reverse = MCP.mrig.valueOf(rc, "Reverse Order") > 0;
    }

    var results = [];
    for (i = 0; i < n; i++) {
        var cellInfo = bento ? cells[i] : { slot: i, colSpan: 1, rowSpan: 1 };
        if (!bento) {
            var gc = MCP.mrig.gridCell(i, n, cols, colFirst, reverse);
            cellInfo.col = gc.col;
            cellInfo.row = gc.row;
        }
        MCP.mrig.gridLayer(rc, layers[i], cellInfo, n, bento, fit, results);
    }

    var animation = null;
    if (anim) {
        var a0 = MCP.animate.timeOf(comp, args.animate, "startTime", "startFrame", t);
        var a1 = a0 + MCP.animate.span(comp, args.animate, 0.6);
        animation = { control: anim.control, controls: anim.names, startTime: MCP.round(a0), endTime: MCP.round(a1), startFrame: MCP.frameOf(comp, a0), endFrame: MCP.frameOf(comp, a1), keys: {} };
        if (anim.control === "origin") {
            var target = MCP.mrig.toLayerSpace(rc.host, anim.values, a1);
            animation.keys.Origin = MCP.mrig.keyControl(rc, "Origin", a0, MCP.mrig.param(rc, "Origin").valueAtTime(a0, true), a1, target, args.animate.easing);
        } else {
            for (i = 0; i < anim.names.length; i++) {
                var pa = MCP.mrig.param(rc, anim.names[i]);
                animation.keys[anim.names[i]] = MCP.mrig.keyControl(rc, anim.names[i], a0, pa.valueAtTime(a0, true), a1, anim.values[i], args.animate.easing);
            }
        }
    }
    if (fit !== "none") { rc.notes.push("Cells are fitted with the " + fit + " rule; a shape layer holding one Rectangle gets its Size set to the cell instead, so its corners stay round. Shape group scale is not counted."); }
    rc.notes.push("Move the control null or drag the Origin point to move the grid; Columns, Cell Width, Cell Height and Gap reflow it.");
    return MCP.mrig.finish(rc, {
        mode: bento ? "bento" : "grid",
        layout: {
            columns: MCP.round(cols, 2), rows: gridRows, cellSize: MCP.roundValue(cellSize), gap: MCP.roundValue(gap), origin: MCP.roundValue(origin),
            align: centred ? "center" : "top-left", fill: colFirst ? "columns" : "rows", reverse: reverse, fit: fit,
            width: MCP.round(gridW), height: MCP.round(gridH)
        },
        animation: animation,
        layers: results
    });
}, { mutating: true });

/** Sets the expressions of one grid layer. */
MCP.mrig.gridLayer = function (rc, L, cell, n, bento, fit, results) {
    MCP.mrig.each(rc, L, results, function (e) {
        e.slot = cell.slot + 1;
        e.col = cell.col;
        e.row = cell.row;
        e.colSpan = cell.colSpan;
        e.rowSpan = cell.rowSpan;
        e.fill = "none";
        if (fit !== "none") {
            var rect = MCP.mrig.singleRect(L);
            if (rect) {
                MCP.mrig.express(rc, e, MCP.mrig.propByIndices(L, rect).property("ADBE Vector Rect Size"), MCP.mrig.gridSizeCode(rc, L, cell));
                e.fill = "rectangle size";
            } else {
                MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Scale"), MCP.mrig.gridScaleCode(rc, L, cell, fit));
                e.fill = "scale (" + fit + ")";
            }
        }
        MCP.mrig.expressPosition(rc, e, L, function (axis) { return MCP.mrig.gridPositionCode(rc, L, cell, n, bento, axis); }, [0, 1]);
    });
};

/* ---------------------------------------------------- proximity effector */

/**
 * The lines every effector expression starts with: the start value in base
 * and the weight in w (0 to 1). In the Position expression the layer's place
 * is base itself (so a grid below it counts); elsewhere it is the Position.
 */
MCP.mrig.weightLines = function (rc, layer, effector, positionExpr, what) {
    var c = MCP.mrig.c;
    var e3 = !!effector.threeDLayer, l3 = !!layer.threeDLayer;
    var L = [
        "// Proximity effector: " + (what || "weight") + " from the distance to " + MCP.expr.str(effector.name),
        MCP.mrig.PLAIN,
        "var C = " + MCP.mrig.hostRef(rc, layer) + ";",
        "var rad = Math.max(0.001, " + c("Radius") + ");",
        "var soft = clamp(" + c("Falloff") + " / 100, 0, 1);",
        "var P = " + (positionExpr ? "base" : "transform.position.value") + ";"
    ];
    if (l3) {
        L.push("var a = hasParent ? parent.toWorld(P) : P;");
        L.push(e3 ? "var e = C.toWorld(C.transform.anchorPoint.value);" : "var e2 = C.toComp(C.transform.anchorPoint.value), e = [e2[0], e2[1], 0];");
        L.push("var d = length([a[0], a[1], a.length > 2 ? a[2] : 0], [e[0], e[1], e.length > 2 ? e[2] : 0]);");
    } else {
        L.push("var a = hasParent ? parent.toComp(P) : P;");
        L.push("var e = C.toComp(C.transform.anchorPoint.value);");
        L.push("var d = length([a[0], a[1]], [e[0], e[1]]);");
    }
    L.push("var inner = rad * (1 - soft);");
    L.push("var w = d >= rad ? 0 : (d <= inner ? 1 : 1 - (d - inner) / (rad - inner));");
    L.push("if (" + c("Smooth Falloff") + " > 0) { w = w * w * (3 - 2 * w); }");
    L.push("if (" + c("Invert") + " > 0) { w = 1 - w; }");
    L.push("w = w * " + c("Strength") + " / 100;");
    return L;
};

MCP.mrig.EFFECTOR_BLUR = "Effector Blur";

MCP.mrig.EFFECTOR_CONTROLS = [
    ["slider", "Radius"], ["slider", "Falloff"], ["checkbox", "Smooth Falloff"], ["checkbox", "Invert"], ["slider", "Strength"],
    ["slider", "Scale Amount"], ["slider", "Opacity Amount"], ["slider", "Blur Amount"], ["slider", "Rotation Amount"],
    ["slider", "Offset X"], ["slider", "Offset Y"], ["slider", "Offset Z"]
];

MCP.register("proximityEffector", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var want = {
        scale: MCP.isDefined(args.scale), opacity: MCP.isDefined(args.opacity), blur: MCP.isDefined(args.blur),
        rotation: MCP.isDefined(args.rotation), offset: MCP.isArray(args.offset)
    };
    if (!want.scale && !want.opacity && !want.blur && !want.rotation && !want.offset) {
        MCP.fail("Give at least one reaction: scale, opacity, blur, rotation or offset.", "invalid-argument");
    }
    var all = MCP.resolveLayers(comp, MCP.requireArg(args, "layers"));
    var effector = null, i;
    if (MCP.isDefined(args.effector)) {
        effector = MCP.mrig.checkHost(comp, MCP.resolveLayer(comp, args.effector), MCP.mrig.EFFECTOR_CONTROLS, false);
    }
    var skipped = [];
    var targets = MCP.mrig.usable(all, [{ layer: effector, reason: "it is the effector" }], skipped, false);
    if (!targets.length) { MCP.fail("No layers left to react after skipping " + skipped.length + " (cameras, lights, locked layers, the effector).", "invalid-argument", { skipped: skipped }); }
    var any3D = false;
    for (i = 0; i < targets.length; i++) { if (targets[i].threeDLayer) { any3D = true; } }
    if (args.animate) {
        MCP.requireArg(args.animate, "to");
        MCP.mrig.requireSpan(args.animate, "animate");
        if (effector && MCP.mrig.positionSeparated(effector)) { MCP.fail("The effector's Position has separated dimensions; join them first or key X and Y Position yourself.", "unsupported"); }
    }

    var created = false;
    if (!effector) {
        effector = MCP.mrig.addNull(comp, MCP.isDefined(args.name) ? String(args.name) : "Effector", args.position, any3D || MCP.bool(args.threeD, false));
        created = true;
    }
    var rc = MCP.mrig.begin(comp, { host: effector, created: created });
    MCP.mrig.control(rc, "slider", "Radius", args.radius, 300);
    MCP.mrig.control(rc, "slider", "Falloff", args.falloff, 100);
    MCP.mrig.control(rc, "checkbox", "Smooth Falloff", args.smooth, true);
    MCP.mrig.control(rc, "checkbox", "Invert", args.invert, false);
    MCP.mrig.control(rc, "slider", "Strength", args.strength, 100);
    if (want.scale) { MCP.mrig.control(rc, "slider", "Scale Amount", args.scale, 0); }
    if (want.opacity) { MCP.mrig.control(rc, "slider", "Opacity Amount", args.opacity, 0); }
    if (want.blur) { MCP.mrig.control(rc, "slider", "Blur Amount", args.blur, 0); }
    if (want.rotation) { MCP.mrig.control(rc, "slider", "Rotation Amount", args.rotation, 0); }
    var offZ = false;
    if (want.offset) {
        offZ = args.offset.length > 2 || any3D;
        MCP.mrig.control(rc, "slider", "Offset X", Number(args.offset[0]), 0);
        MCP.mrig.control(rc, "slider", "Offset Y", Number(args.offset[1]), 0);
        if (offZ) { MCP.mrig.control(rc, "slider", "Offset Z", args.offset.length > 2 ? Number(args.offset[2]) : undefined, 0); }
    }

    var results = [];
    for (i = 0; i < targets.length; i++) {
        MCP.mrig.effectorLayer(rc, targets[i], effector, want, offZ, results);
    }

    var keys = null;
    if (args.animate) { keys = MCP.mrig.effectorMove(rc, effector, args.animate); }
    var guide = null;
    if (MCP.bool(args.radiusGuide, false)) { guide = MCP.mrig.radiusGuide(rc, effector); }
    if (want.offset) { rc.notes.push("Scale, rotation, opacity and blur measure from each layer's position after its offset, so an offset toward or away from the effector shifts them slightly."); }
    rc.notes.push("Animate the effector's Position (or key Strength) to sweep the field; Radius, Falloff and the amounts retune every layer at once.");
    return MCP.mrig.finish(rc, {
        effector: MCP.serialize.layerRef(effector), effectorCreated: created, threeD: !!effector.threeDLayer,
        reactions: want, effectorKeys: keys, radiusGuide: guide ? MCP.serialize.layerRef(guide) : null,
        layers: results, skipped: skipped
    });
}, { mutating: true });

/** The expression of one reaction: blur, scale, opacity, rotation or offset (Position). */
MCP.mrig.effectorCode = function (rc, layer, effector, reaction, offZ) {
    var c = MCP.mrig.c;
    var head = MCP.mrig.weightLines(rc, layer, effector, reaction === "offset", reaction).join("\n") + "\n";
    if (reaction === "blur") { return head + "base + w * " + c("Blur Amount") + ";"; }
    if (reaction === "scale") {
        return head + "var m = 1 + w * " + c("Scale Amount") + " / 100, q = [];\n" +
            "for (var i = 0; i < base.length; i++) { q.push(base[i] * m); }\nq;";
    }
    if (reaction === "opacity") { return head + "clamp(base + w * " + c("Opacity Amount") + ", 0, 100);"; }
    if (reaction === "rotation") { return head + "base + w * " + c("Rotation Amount") + ";"; }
    return head + "var off = [" + c("Offset X") + ", " + c("Offset Y") + ", " + (offZ ? c("Offset Z") : "0") + "], q = [];\n" +
        "for (var i = 0; i < base.length; i++) { q.push(base[i] + off[i] * w); }\nq;";
};

/** Sets the reaction expressions on one target layer. */
MCP.mrig.effectorLayer = function (rc, L, effector, want, offZ, results) {
    MCP.mrig.each(rc, L, results, function (e) {
        if (want.blur) {
            if (!MCP.mrig.effectNamed(L, MCP.mrig.EFFECTOR_BLUR)) {
                var added = MCP.fx.addFirstAvailable(L, ["ADBE Gaussian Blur 2"]);
                if (!added) { MCP.fail("Gaussian Blur could not be added", "unsupported"); }
                added.effect.name = MCP.mrig.EFFECTOR_BLUR;
                // A new Gaussian Blur starts at 25 on recent versions: start sharp, soft edges.
                var fresh = MCP.mrig.effectNamed(L, MCP.mrig.EFFECTOR_BLUR);
                fresh.property("ADBE Gaussian Blur 2-0001").setValue(0);
                _mcpTry(function () { fresh.property("ADBE Gaussian Blur 2-0003").setValue(0); return true; }, false);
            }
            var blur = MCP.mrig.effectNamed(L, MCP.mrig.EFFECTOR_BLUR).property("ADBE Gaussian Blur 2-0001");
            MCP.mrig.express(rc, e, blur, MCP.mrig.effectorCode(rc, L, effector, "blur", offZ));
        }
        if (want.scale) {
            MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Scale"), MCP.mrig.effectorCode(rc, L, effector, "scale", offZ));
        }
        if (want.opacity) {
            MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Opacity"), MCP.mrig.effectorCode(rc, L, effector, "opacity", offZ));
        }
        if (want.rotation) {
            MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Rotate Z"), MCP.mrig.effectorCode(rc, L, effector, "rotation", offZ));
        }
        if (want.offset) {
            if (MCP.mrig.positionSeparated(L)) {
                e.notes = ["Position has separated dimensions, so the offset was left out on this layer (join them with separate-dimensions to use it)."];
            } else {
                MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Position"), MCP.mrig.effectorCode(rc, L, effector, "offset", offZ));
            }
        }
    });
};

/** Keys the effector's Position in two eased keys (checked before anything changed). */
MCP.mrig.effectorMove = function (rc, effector, spec) {
    var comp = rc.comp;
    var pp = effector.property("ADBE Transform Group").property("ADBE Position");
    var t0 = MCP.animate.timeOf(comp, spec, "startTime", "startFrame", effector.inPoint);
    var t1 = t0 + MCP.animate.span(comp, spec, 2);
    var cur = pp.valueAtTime(t0, true);
    var from = MCP.isArray(spec.from) ? MCP.animate.fit(spec.from, cur, "from") : cur;
    var to = MCP.animate.fit(spec.to, cur, "to");
    return MCP.animate.keyMove(pp, t0, from, t1, to, MCP.isDefined(spec.easing) ? spec.easing : MCP.animate.EASE_LAND, { comp: comp, spatial: "linear" });
};

/** A guide shape layer that draws the effector's radius (guide layers never render). */
MCP.mrig.radiusGuide = function (rc, effector) {
    var comp = rc.comp;
    var g = comp.layers.addShape();
    g.name = MCP.animate.uniqueLayerName(comp, effector.name + " Radius");
    var root = g.property("ADBE Root Vectors Group");
    root.addProperty("ADBE Vector Group").name = "Radius";
    g.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Ellipse");
    g.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
    var items = g.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
    items.property(2).property("ADBE Vector Stroke Color").setValue([0.2, 0.75, 1, 1]);
    items.property(2).property("ADBE Vector Stroke Width").setValue(2);
    if (effector.threeDLayer) { g.threeDLayer = true; }
    g.parent = effector;
    var tg = g.property("ADBE Transform Group");
    tg.property("ADBE Anchor Point").setValue(MCP.animate.fill(tg.property("ADBE Anchor Point").value, 0));
    tg.property("ADBE Position").setValue(MCP.animate.fit(effector.property("ADBE Transform Group").property("ADBE Anchor Point").value, tg.property("ADBE Position").value, "anchor"));
    tg.property("ADBE Scale").setValue(MCP.animate.fill(tg.property("ADBE Scale").value, 100));
    tg.property("ADBE Rotate Z").setValue(0);
    try { g.guideLayer = true; } catch (e0) { rc.notes.push("The radius guide could not be made a guide layer; turn its visibility off before rendering."); }
    var size = g.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(1).property("ADBE Vector Ellipse Size");
    var st = MCP.animate.setExpression(size, [
        "// Draws the effector's Radius (a guide layer: it does not render)",
        "var E = thisComp.layer(" + MCP.expr.str(effector.name) + ");",
        "var r = E.effect(\"Radius\")(1).value, s = E.transform.scale.value;",
        "[2 * r * 100 / Math.max(Math.abs(s[0]), 0.001), 2 * r * 100 / Math.max(Math.abs(s[1]), 0.001)];"
    ].join("\n"));
    rc.count++;
    if (st.error) { rc.errors++; }
    return g;
};

/* ----------------------------------------------------------- follow chain */

MCP.mrig.CHAIN_PROPS = {
    position: { matchName: "ADBE Position", lead: "transform.position" },
    rotation: { matchName: "ADBE Rotate Z", lead: "transform.rotation" },
    scale: { matchName: "ADBE Scale", lead: "transform.scale" },
    opacity: { matchName: "ADBE Opacity", lead: "transform.opacity" }
};

/** The expression of one follower property. sameSpace: leader and follower share a parent (or have none). */
MCP.mrig.chainCode = function (rc, layer, leader, k, total, prop, mode, sameSpace, axis) {
    var c = MCP.mrig.c;
    var def = MCP.mrig.CHAIN_PROPS[prop];
    var L = [
        "// Follow chain: step " + k + " of " + total + " behind " + MCP.expr.str(leader.name) + " (" + mode + ")",
        "var Ld = " + MCP.mrig.layerRef(leader, layer) + ";",
        "var C = " + MCP.mrig.hostRef(rc, layer) + ";",
        "var k = " + k + ";",
        "var dt = " + c("Delay") + " * thisComp.frameDuration * k;",
        "var w = Math.pow(1 - clamp(" + c("Decay") + ", 0, 100) / 100, k);",
        "var P = Ld." + def.lead + ";",
        "// the leader's rest value is the one at its first key of this property (or at 0 s)",
        "var t0 = P.numKeys > 0 ? P.key(1).time : 0;"
    ];
    var space = layer.threeDLayer ? "World" : "Comp";
    if (prop === "position" && !sameSpace) {
        L.push("// the leader has another parent: follow in " + (space === "World" ? "world" : "composition") + " space");
        L.push("var lead = Ld.to" + space + "(Ld.transform.anchorPoint.valueAtTime(time - dt), time - dt);");
        L.push("var rest = Ld.to" + space + "(Ld.transform.anchorPoint.valueAtTime(t0), t0);");
        L.push("var me = hasParent ? parent.to" + space + "(value) : value;");
    } else {
        L.push("var lead = P.valueAtTime(time - dt), rest = P.valueAtTime(t0);");
        L.push("var me = value;");
    }
    if (axis >= 0) {
        if (mode === "absolute") {
            L.push("var a = lead.length > " + axis + " ? lead[" + axis + "] : value;");
            L.push("value + (a - value) * w;");
        } else {
            L.push("var a = lead.length > " + axis + " ? lead[" + axis + "] - rest[" + axis + "] : 0;");
            L.push("value + a * w;");
        }
        return L.join("\n");
    }
    if (mode === "absolute") {
        L.push("function follow(v, a) {");
        L.push("  if (typeof v == \"number\") { return v + (a - v) * w; }");
        L.push("  var o = [];");
        L.push("  for (var i = 0; i < v.length; i++) { o.push(v[i] + ((i < a.length ? a[i] : v[i]) - v[i]) * w); }");
        L.push("  return o;");
        L.push("}");
        L.push("var out = follow(me, lead);");
    } else {
        L.push("function follow(v, a, b) {");
        L.push("  if (typeof v == \"number\") { return v + (a - b) * w; }");
        L.push("  var o = [];");
        L.push("  for (var i = 0; i < v.length; i++) { o.push(v[i] + (i < a.length ? a[i] - b[i] : 0) * w); }");
        L.push("  return o;");
        L.push("}");
        L.push("var out = follow(me, lead, rest);");
    }
    if (prop === "position" && !sameSpace) {
        L.push("hasParent ? parent.from" + space + "(out) : out;");
    } else if (prop === "opacity") {
        L.push("clamp(out, 0, 100);");
    } else {
        L.push("out;");
    }
    return L.join("\n");
};

MCP.register("followChain", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var leader = MCP.resolveLayer(comp, MCP.requireArg(args, "leader"));
    MCP.animate.requireUniqueName(comp, leader, "leader");
    var all = MCP.mrig.layers(comp, MCP.requireArg(args, "followers"), args.order, "as-given");
    var skipped = [];
    var followers = MCP.mrig.usable(all, [{ layer: leader, reason: "it is the leader" }], skipped, false);
    if (!followers.length) { MCP.fail("No followers left after skipping the leader, cameras, lights and locked layers.", "invalid-argument", { skipped: skipped }); }
    var props = MCP.isArray(args.properties) && args.properties.length ? args.properties : ["position"];
    var i;
    for (i = 0; i < props.length; i++) {
        if (!MCP.mrig.CHAIN_PROPS[props[i]]) { MCP.fail("properties may hold position, rotation, scale and opacity.", "invalid-argument"); }
    }
    var mode = String(MCP.arg(args, "mode", "offset"));
    if (mode !== "offset" && mode !== "absolute") { MCP.fail("mode must be offset or absolute.", "invalid-argument"); }
    var where = String(MCP.arg(args, "controls", "leader"));
    if (where !== "leader" && where !== "null") { MCP.fail("controls must be leader or null.", "invalid-argument"); }
    var leaderParent = leader.parent ? leader.parent.index : 0;
    var hasPosition = false;
    for (i = 0; i < props.length; i++) { if (props[i] === "position") { hasPosition = true; } }
    for (i = 0; i < followers.length; i++) {
        var same = (followers[i].parent ? followers[i].parent.index : 0) === leaderParent;
        if (hasPosition && !same && MCP.mrig.positionSeparated(followers[i])) {
            MCP.fail("Follower '" + followers[i].name + "' has separated Position dimensions and another parent than the leader. Join its dimensions or give both the same parent.", "unsupported");
        }
    }
    var names = [["slider", "Delay"], ["slider", "Decay"]];
    var host = MCP.mrig.givenHost(comp, args, names);
    var leaderCanHold = !((leader instanceof CameraLayer) || (leader instanceof LightLayer)) && !leader.locked;
    if (!host && where === "leader" && leaderCanHold) { host = MCP.mrig.checkHost(comp, leader, names, false); }

    var rc = MCP.mrig.begin(comp, { args: args, name: leader.name + " Chain", host: host });
    if (where === "leader" && !leaderCanHold && !MCP.isDefined(args.controlLayer)) { rc.notes.push("The leader cannot hold effects (camera, light or locked), so the controls are on a new null."); }
    MCP.mrig.control(rc, "slider", "Delay", args.delayFrames, 3);
    MCP.mrig.control(rc, "slider", "Decay", args.decay, 0);
    var results = [];
    for (i = 0; i < followers.length; i++) {
        MCP.mrig.chainLayer(rc, followers[i], leader, i + 1, followers.length, props, mode, leaderParent, results);
    }
    rc.notes.push("Delay is in frames per step and Decay in percent per step; key either control to change the chain over time.");
    return MCP.mrig.finish(rc, { leader: MCP.serialize.layerRef(leader), properties: props, mode: mode, steps: results.length, layers: results, skipped: skipped });
}, { mutating: true });

MCP.mrig.chainLayer = function (rc, F, leader, k, total, props, mode, leaderParent, results) {
    MCP.mrig.each(rc, F, results, function (e) {
        e.step = k;
        var sameSpace = (F.parent ? F.parent.index : 0) === leaderParent;
        e.space = sameSpace ? "parent" : (F.threeDLayer ? "world" : "composition");
        for (var j = 0; j < props.length; j++) {
            var p = props[j];
            if (p === "position") {
                MCP.mrig.expressPosition(rc, e, F, function (axis) { return MCP.mrig.chainCode(rc, F, leader, k, total, "position", mode, sameSpace, axis); }, [0, 1, 2]);
            } else {
                MCP.mrig.express(rc, e, F.property("ADBE Transform Group").property(MCP.mrig.CHAIN_PROPS[p].matchName), MCP.mrig.chainCode(rc, F, leader, k, total, p, mode, true, -1));
            }
        }
    });
};

/* ------------------------------------------------------------ clone array */

/** Header lines of a clone expression: S (source), C (controls), k and the delayed time t. */
MCP.mrig.cloneTop = function (rc, layer, src, k, total, what) {
    var lines = ["// Clone array: " + what + ", copy " + k + " of " + total + " from " + MCP.expr.str(src.name) + " (controls on " + MCP.expr.str(rc.host.name) + ")"];
    if (k > 0) { lines.push("var S = " + MCP.mrig.layerRef(src, layer) + ";"); }
    lines.push("var C = " + MCP.mrig.hostRef(rc, layer) + ";");
    lines.push("var k = " + k + ";");
    lines.push("var t = time - " + MCP.mrig.c("Time Offset") + " * thisComp.frameDuration * k;");
    return lines;
};

MCP.mrig.clonePositionCode = function (rc, layer, src, k, total, radial, axis, step3D) {
    var c = MCP.mrig.c;
    var L = MCP.mrig.cloneTop(rc, layer, src, k, total, "position");
    if (radial) {
        L.push("var cen = C.toComp(" + c("Center") + ");");
        L.push("var R = C.effect(\"Radius\")(1).valueAtTime(t) + k * " + c("Radius Step") + ";");
        L.push("var ang = degreesToRadians(C.effect(\"Start Angle\")(1).valueAtTime(t) + k * " + c("Angle Step") + ");");
        L.push("var p = [cen[0] + R * Math.cos(ang), cen[1] + R * Math.sin(ang)];");
        MCP.mrig.placeLines(L, layer, axis);
        return L.join("\n");
    }
    L.push("var sp = S.transform.position.valueAtTime(t);");
    L.push("var st = [" + c("Step X") + ", " + c("Step Y") + ", " + (step3D ? c("Step Z") : "0") + "];");
    if (axis >= 0) {
        L.push("(sp.length > " + axis + " ? sp[" + axis + "] : value) + k * st[" + axis + "];");
    } else {
        L.push("var q = [];");
        L.push("for (var i = 0; i < value.length; i++) { q.push((i < sp.length ? sp[i] : value[i]) + k * st[i]); }");
        L.push("q;");
    }
    return L.join("\n");
};

MCP.mrig.CLONE_CONTROLS = [
    ["point", "Center"], ["slider", "Radius"], ["slider", "Radius Step"], ["angle", "Start Angle"], ["angle", "Angle Step"], ["checkbox", "Orient"],
    ["slider", "Step X"], ["slider", "Step Y"], ["slider", "Step Z"], ["slider", "Rotation Step"], ["slider", "Scale Step"], ["slider", "Opacity Step"], ["slider", "Time Offset"]
];

MCP.register("cloneArray", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var src = MCP.resolveLayer(comp, MCP.requireArg(args, "layer"));
    if ((src instanceof CameraLayer) || (src instanceof LightLayer)) { MCP.fail("Cameras and lights cannot be cloned into an array.", "invalid-argument"); }
    if (src.locked) { MCP.fail("Layer '" + src.name + "' is locked.", "invalid-argument"); }
    MCP.animate.requireUniqueName(comp, src, "source");
    var t = MCP.snapToFrame(comp, comp.time);
    var radial = (args.radial && typeof args.radial === "object") ? args.radial : null;
    var given = MCP.isDefined(args.copies);
    if (given && MCP.isDefined(args.count)) { MCP.fail("Give count or copies, not both.", "invalid-argument"); }
    var copies = [], skipped = [], i, count = 0;
    if (given) {
        copies = MCP.mrig.usable(MCP.mrig.layers(comp, args.copies, args.order, "as-given"), [{ layer: src, reason: "it is the source" }], skipped, false);
        if (!copies.length) { MCP.fail("No copies left after skipping the source, cameras, lights and locked layers.", "invalid-argument", { skipped: skipped }); }
    } else {
        count = Math.round(MCP.num(args.count, 0));
        if (count < 1 || count > 200) { MCP.fail("count must be 1 to 200 copies.", "invalid-argument"); }
    }
    var stack = String(MCP.arg(args, "stack", "below"));
    if (stack !== "below" && stack !== "above") { MCP.fail("stack must be below or above.", "invalid-argument"); }
    if (radial) {
        MCP.mrig.requirePlaceable(src);
        if (MCP.isDefined(radial.radius) && !(Number(radial.radius) >= 0)) { MCP.fail("radial.radius must be 0 or more.", "invalid-argument"); }
    }
    for (i = 0; i < copies.length; i++) { if (radial) { MCP.mrig.requirePlaceable(copies[i]); } }
    var host = MCP.mrig.givenHost(comp, args, MCP.mrig.CLONE_CONTROLS);
    if (host) {
        if (host.index === src.index) { MCP.fail("The control layer is the source. Use a separate layer for the controls.", "invalid-argument"); }
        for (i = 0; i < copies.length; i++) { if (copies[i].index === host.index) { MCP.fail("The control layer is one of the copies. Use a separate layer for the controls.", "invalid-argument"); } }
    }

    if (!given) {
        var prev = src;
        for (i = 1; i <= count; i++) {
            var cp = src.duplicate();
            // duplicate() already names the copy "<name> 2", so the copy itself is left out of the name check
            cp.name = MCP.mrig.uniqueName(comp, src.name + " " + (i + 1), cp);
            if (stack === "above") { MCP.animate.placeAbove(cp, prev); } else { cp.moveAfter(prev); }
            prev = cp;
            copies.push(cp);
        }
    }
    var total = copies.length;
    var is3D = !!src.threeDLayer;
    for (i = 0; i < copies.length; i++) { if (copies[i].threeDLayer) { is3D = true; } }
    var center = (radial && MCP.isArray(radial.center)) ? [Number(radial.center[0]), Number(radial.center[1])] : MCP.mrig.compPoint(src, t);
    var rc = MCP.mrig.begin(comp, { args: args, name: src.name + " Array", host: host, position: center });

    if (radial) {
        var centerValue = MCP.mrig.toLayerSpace(rc.host, center, t);
        MCP.mrig.control(rc, "point", "Center", MCP.isArray(radial.center) ? centerValue : undefined, centerValue);
        MCP.mrig.control(rc, "slider", "Radius", radial.radius, 300);
        MCP.mrig.control(rc, "slider", "Radius Step", radial.radiusStep, 0);
        MCP.mrig.control(rc, "angle", "Start Angle", radial.startAngle, -90);
        MCP.mrig.control(rc, "angle", "Angle Step", radial.angleStep, 360 / (total + 1));
        MCP.mrig.control(rc, "checkbox", "Orient", radial.orient, false);
    } else {
        var step = MCP.isArray(args.positionStep) ? args.positionStep : null;
        if (!step && !MCP.isDefined(args.rotationStep) && !MCP.isDefined(args.scaleStep) && !MCP.isDefined(args.opacityStep) && !MCP.isDefined(args.timeOffsetFrames)) {
            var vs = MCP.mrig.visualSize(src, t);
            step = [vs ? Math.round(vs[0] + 24) : 100, 0];
            rc.notes.push("No step was given, so the copies sit in a row " + step[0] + " px apart (the source's width plus 24).");
        }
        MCP.mrig.control(rc, "slider", "Step X", step ? Number(step[0]) : undefined, 0);
        MCP.mrig.control(rc, "slider", "Step Y", step ? Number(step[1]) : undefined, 0);
        if (is3D) { MCP.mrig.control(rc, "slider", "Step Z", (step && step.length > 2) ? Number(step[2]) : undefined, 0); }
    }
    MCP.mrig.control(rc, "slider", "Rotation Step", args.rotationStep, 0);
    MCP.mrig.control(rc, "slider", "Scale Step", args.scaleStep, 0);
    MCP.mrig.control(rc, "slider", "Opacity Step", args.opacityStep, 0);
    MCP.mrig.control(rc, "slider", "Time Offset", args.timeOffsetFrames, 0);

    var c = MCP.mrig.c;
    var results = [];
    if (radial) {
        MCP.mrig.each(rc, src, results, function (e) {
            e.copy = 0;
            MCP.mrig.expressPosition(rc, e, src, function (axis) { return MCP.mrig.clonePositionCode(rc, src, src, 0, total, true, axis, false); }, [0, 1]);
            MCP.mrig.express(rc, e, src.property("ADBE Transform Group").property("ADBE Rotate Z"),
                "// Clone array: the source turns with the ring when Orient is on\nvar C = " + MCP.mrig.hostRef(rc, src) + ";\n" +
                "value + (" + c("Orient") + " > 0 ? " + c("Start Angle") + " + 90 : 0);");
        });
    }
    var delayContent = MCP.bool(args.delayContent, false);
    for (i = 0; i < copies.length; i++) {
        MCP.mrig.cloneCopy(rc, copies[i], src, i + 1, total, radial, given, delayContent, is3D, results);
    }
    if (radial) { rc.notes.push("In ring mode the source's own Position is replaced by the ring; key Radius or Start Angle to animate it (Time Offset delays each copy)."); }
    rc.notes.push("The copies follow the source live: change the source's keys and every copy follows, offset by its number.");
    return MCP.mrig.finish(rc, {
        source: MCP.serialize.layerRef(src), mode: radial ? "radial" : "linear", copiesCreated: !given,
        layers: results, skipped: skipped
    });
}, { mutating: true });

/** Rigs one copy of a clone array. */
MCP.mrig.cloneCopy = function (rc, L, src, k, total, radial, given, delayContent, step3D, results) {
    var c = MCP.mrig.c;
    MCP.mrig.each(rc, L, results, function (e) {
        e.copy = k;
        var names = ["ADBE Position", "ADBE Position_0", "ADBE Position_1", "ADBE Position_2", "ADBE Scale", "ADBE Rotate Z", "ADBE Opacity"];
        var cleared = 0;
        if (!given) {
            // The copies read the source live, so their own copied keys would only clutter the timeline.
            for (var q = 0; q < names.length; q++) {
                var p = _mcpTry(function () { return L.property("ADBE Transform Group").property(names[q]); }, null);
                if (p && _mcpTry(function () { return p.numKeys; }, 0) > 0) {
                    while (p.numKeys > 0) { p.removeKey(1); }
                    cleared++;
                }
            }
        }
        if (cleared) { e.clearedKeys = cleared; }
        MCP.mrig.expressPosition(rc, e, L, function (axis) { return MCP.mrig.clonePositionCode(rc, L, src, k, total, !!radial, axis, step3D); }, radial ? [0, 1] : [0, 1, 2]);
        var top = MCP.mrig.cloneTop(rc, L, src, k, total, "scale").join("\n") + "\n";
        MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Scale"), top +
            "var s = S.transform.scale.valueAtTime(t), d = k * " + c("Scale Step") + ", q = [];\n" +
            "for (var i = 0; i < value.length; i++) { var b = i < s.length ? s[i] : value[i]; q.push(b >= 0 ? Math.max(0, b + d) : Math.min(0, b - d)); }\nq;");
        top = MCP.mrig.cloneTop(rc, L, src, k, total, "rotation").join("\n") + "\n";
        MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Rotate Z"), top +
            "S.transform.rotation.valueAtTime(t) + k * (" + c("Rotation Step") + (radial ? " + (" + c("Orient") + " > 0 ? " + c("Angle Step") + " : 0)" : "") + ");");
        top = MCP.mrig.cloneTop(rc, L, src, k, total, "opacity").join("\n") + "\n";
        MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Opacity"), top +
            "clamp(S.transform.opacity.valueAtTime(t) + k * " + c("Opacity Step") + ", 0, 100);");
        if (delayContent) {
            if (_mcpTry(function () { return L.canSetTimeRemapEnabled; }, false)) {
                if (!L.timeRemapEnabled) { L.timeRemapEnabled = true; }
                top = MCP.mrig.cloneTop(rc, L, src, k, total, "content delay").join("\n") + "\n";
                MCP.mrig.express(rc, e, L.property("ADBE Time Remapping"), top + "valueAtTime(t);");
                e.contentDelayed = true;
            } else {
                e.contentDelayed = false;
                e.notes = ["This layer has no time to remap (text, shape or solid), so only its transform is delayed."];
            }
        }
    });
};

/* ------------------------------------------------------------ shape morph */

/** Finds the one path of a shape layer, or the one named ("Path 1", "Group 1/Path 1" or a group holding one path). */
MCP.mrig.findPath = function (layer, name, role) {
    if (!(layer instanceof ShapeLayer)) { MCP.fail("The " + role + " layer '" + layer.name + "' is not a shape layer.", "invalid-argument"); }
    var all = [];
    MCP.mrig.walkShapes(layer.property("ADBE Root Vectors Group"), [], "", function (item, groups, label) {
        all.push({ item: item, groups: groups, label: label, kind: MCP.shape.kindOf(item) });
    }, 0);
    var labels = [], i;
    for (i = 0; i < all.length; i++) { labels.push(all[i].label + " (" + all[i].kind + ")"); }
    if (!all.length) { MCP.fail("The " + role + " layer '" + layer.name + "' has no path.", "not-found"); }
    if (!MCP.isDefined(name)) {
        if (all.length > 1) { MCP.fail("The " + role + " layer '" + layer.name + "' has " + all.length + " paths: " + labels.join(", ") + ". Name one with " + role + ".path.", "ambiguous", { paths: labels }); }
        return all[0];
    }
    var want = String(name), hits = [];
    for (i = 0; i < all.length; i++) {
        var lab = all[i].label;
        if (lab === want || all[i].item.name === want || lab.indexOf(want + "/") === 0) { hits.push(all[i]); }
    }
    if (hits.length === 1) { return hits[0]; }
    if (!hits.length) { MCP.fail("No path '" + want + "' on '" + layer.name + "'. Paths: " + labels.join(", "), "not-found", { paths: labels }); }
    var hitLabels = [];
    for (i = 0; i < hits.length; i++) { hitLabels.push(hits[i].label); }
    MCP.fail("'" + want + "' matches " + hits.length + " paths on '" + layer.name + "': " + hitLabels.join(", ") + ". Give the full Group/Path name.", "ambiguous", { paths: hitLabels });
    return null;
};

/** A shape group's transform at t as a matrix (skew is not counted, and noted). */
MCP.mrig.groupMatrix = function (group, t, notes) {
    var tr = group.property("ADBE Vector Transform Group");
    var at = function (mn, fallback) {
        var p = _mcpTry(function () { return tr.property(mn); }, null);
        return p ? p.valueAtTime(t, false) : fallback;
    };
    if (Number(at("ADBE Vector Skew", 0)) !== 0 && notes) { notes.push("Group '" + group.name + "' is skewed; skew is not counted when the paths are matched."); }
    return MCP.mrig.trs(at("ADBE Vector Position", [0, 0]), at("ADBE Vector Rotation", 0), at("ADBE Vector Scale", [100, 100]), at("ADBE Vector Anchor", [0, 0]));
};

/** Path space of a found path to composition space at t, or null for 3D layers. */
MCP.mrig.pathToComp = function (layer, found, t, notes) {
    var M = MCP.mrig.toCompMatrix(layer, t);
    if (!M) { return null; }
    for (var i = 0; i < found.groups.length; i++) { M = MCP.mrig.mul(M, MCP.mrig.groupMatrix(found.groups[i], t, notes)); }
    return M;
};

MCP.mrig.pathFromShape = function (shape) {
    var p = { v: [], i: [], o: [], closed: !!shape.closed };
    var V = shape.vertices, I = shape.inTangents || [], O = shape.outTangents || [];
    for (var k = 0; k < V.length; k++) {
        p.v.push([Number(V[k][0]), Number(V[k][1])]);
        p.i.push(k < I.length ? [Number(I[k][0]), Number(I[k][1])] : [0, 0]);
        p.o.push(k < O.length ? [Number(O[k][0]), Number(O[k][1])] : [0, 0]);
    }
    return p;
};

MCP.mrig.pathToShape = function (p) {
    var s = new Shape();
    s.vertices = p.v;
    s.inTangents = p.i;
    s.outTangents = p.o;
    s.closed = p.closed;
    return s;
};

MCP.mrig.KAPPA = 0.5522847498;

/** A rectangle centred on c with size sz and corner radius r, clockwise from the top edge. */
MCP.mrig.rectPath = function (c, sz, r) {
    var x0 = c[0] - sz[0] / 2, x1 = c[0] + sz[0] / 2, y0 = c[1] - sz[1] / 2, y1 = c[1] + sz[1] / 2;
    if (!(r > 0)) {
        return { v: [[x1, y0], [x1, y1], [x0, y1], [x0, y0]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], closed: true };
    }
    var k = r * MCP.mrig.KAPPA;
    return {
        v: [[x1 - r, y0], [x1, y0 + r], [x1, y1 - r], [x1 - r, y1], [x0 + r, y1], [x0, y1 - r], [x0, y0 + r], [x0 + r, y0]],
        i: [[0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0]],
        o: [[k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k], [0, 0]],
        closed: true
    };
};

/** An ellipse centred on c with radii rx, ry: four vertices clockwise from the top. */
MCP.mrig.ellipsePath = function (c, rx, ry) {
    var kx = rx * MCP.mrig.KAPPA, ky = ry * MCP.mrig.KAPPA;
    return {
        v: [[c[0], c[1] - ry], [c[0] + rx, c[1]], [c[0], c[1] + ry], [c[0] - rx, c[1]]],
        i: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
        o: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
        closed: true
    };
};

/** Any path item at t as a Bezier path: a drawn path, a rectangle (with roundness), an ellipse, a star (Type 1) or a polygon (Type 2). */
MCP.mrig.itemPath = function (item, t, notes) {
    var kind = MCP.shape.kindOf(item);
    var at = function (mn, fallback) {
        var p = _mcpTry(function () { return item.property(mn); }, null);
        return p ? p.valueAtTime(t, false) : fallback;
    };
    if (kind === "path") { return MCP.mrig.pathFromShape(item.property("ADBE Vector Shape").valueAtTime(t, false)); }
    if (kind === "rect") {
        var sz = at("ADBE Vector Rect Size", [100, 100]);
        var r = Math.max(0, Math.min(Number(at("ADBE Vector Rect Roundness", 0)), Math.min(Math.abs(sz[0]), Math.abs(sz[1])) / 2));
        return MCP.mrig.rectPath(at("ADBE Vector Rect Position", [0, 0]), sz, r);
    }
    if (kind === "ellipse") {
        var es = at("ADBE Vector Ellipse Size", [100, 100]);
        return MCP.mrig.ellipsePath(at("ADBE Vector Ellipse Position", [0, 0]), es[0] / 2, es[1] / 2);
    }
    var n = Math.max(3, Math.round(Number(at("ADBE Vector Star Points", 5))));
    var star = Number(at("ADBE Vector Star Type", 1)) === 1;
    var R = Number(at("ADBE Vector Star Outer Radius", 50)), ri = Number(at("ADBE Vector Star Inner Radius", 25));
    var pos = at("ADBE Vector Star Position", [0, 0]);
    var rot = Number(at("ADBE Vector Star Rotation", 0)) * Math.PI / 180;
    if ((Number(at("ADBE Vector Star Outer Roundess", 0)) !== 0 || Number(at("ADBE Vector Star Inner Roundess", 0)) !== 0) && notes) {
        notes.push("The star's roundness is not counted; its corners are drawn sharp.");
    }
    var out = { v: [], i: [], o: [], closed: true };
    var count = star ? n * 2 : n;
    for (var k = 0; k < count; k++) {
        var rad = (!star || k % 2 === 0) ? R : ri;
        var a = -Math.PI / 2 + rot + (k * 2 * Math.PI) / count;
        out.v.push([pos[0] + Math.cos(a) * rad, pos[1] + Math.sin(a) * rad]);
        out.i.push([0, 0]);
        out.o.push([0, 0]);
    }
    return out;
};

MCP.mrig.transformPath = function (p, M) {
    var out = { v: [], i: [], o: [], closed: p.closed };
    for (var k = 0; k < p.v.length; k++) {
        out.v.push(MCP.mrig.apply(M, p.v[k]));
        out.i.push(MCP.mrig.applyVec(M, p.i[k]));
        out.o.push(MCP.mrig.applyVec(M, p.o[k]));
    }
    return out;
};

MCP.mrig.lerp2 = function (a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

/** Segment j as four absolute control points. */
MCP.mrig.segment = function (p, j) {
    var n = p.v.length, j2 = (j + 1) % n;
    var a = p.v[j], b = p.v[j2];
    return [a, [a[0] + p.o[j][0], a[1] + p.o[j][1]], [b[0] + p.i[j2][0], b[1] + p.i[j2][1]], b];
};

MCP.mrig.segmentCount = function (p) {
    return p.closed ? p.v.length : p.v.length - 1;
};

/** de Casteljau split of a cubic at t: [left, right]. */
MCP.mrig.splitCubic = function (P, t) {
    var l = MCP.mrig.lerp2;
    var q0 = l(P[0], P[1], t), q1 = l(P[1], P[2], t), q2 = l(P[2], P[3], t);
    var r0 = l(q0, q1, t), r1 = l(q1, q2, t);
    var s = l(r0, r1, t);
    return [[P[0], q0, r0, s], [s, r1, q2, P[3]]];
};

MCP.mrig.cubicPoint = function (P, t) {
    var u = 1 - t;
    return [
        u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0],
        u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]
    ];
};

MCP.mrig.cubicLength = function (P) {
    var len = 0, prev = P[0];
    for (var k = 1; k <= 16; k++) {
        var q = MCP.mrig.cubicPoint(P, k / 16);
        len += Math.sqrt((q[0] - prev[0]) * (q[0] - prev[0]) + (q[1] - prev[1]) * (q[1] - prev[1]));
        prev = q;
    }
    return len;
};

/**
 * The curve parameters that cut a cubic into parts pieces of equal length
 * (from a 32-step length table, so new vertices are spread evenly even where
 * the curve's parameter is not, as on straight edges with no handles).
 */
MCP.mrig.arcParams = function (P, parts) {
    var steps = 32, lens = [0], total = 0, prev = P[0], k;
    for (k = 1; k <= steps; k++) {
        var q = MCP.mrig.cubicPoint(P, k / steps);
        total += Math.sqrt((q[0] - prev[0]) * (q[0] - prev[0]) + (q[1] - prev[1]) * (q[1] - prev[1]));
        lens.push(total);
        prev = q;
    }
    var out = [];
    for (var m = 1; m < parts; m++) {
        var want = total * m / parts, t = m / parts;
        if (total > 1e-9) {
            for (k = 1; k <= steps; k++) {
                if (lens[k] >= want) {
                    var seg = lens[k] - lens[k - 1];
                    t = (k - 1 + (seg > 1e-12 ? (want - lens[k - 1]) / seg : 0)) / steps;
                    break;
                }
            }
        }
        out.push(t);
    }
    return out;
};

/**
 * Adds extra vertices to a path without changing its shape: every original
 * vertex (so every corner) stays, and the longest segments are split
 * (de Casteljau, at equal lengths along the curve) until the count is reached.
 */
MCP.mrig.subdivide = function (p, extra) {
    var nseg = MCP.mrig.segmentCount(p);
    if (extra <= 0 || nseg < 1) { return p; }
    var lens = [], splits = [], j, e;
    for (j = 0; j < nseg; j++) { lens.push(Math.max(MCP.mrig.cubicLength(MCP.mrig.segment(p, j)), 1e-6)); splits.push(0); }
    for (e = 0; e < extra; e++) {
        var best = 0, bestLen = -1;
        for (j = 0; j < nseg; j++) {
            var per = lens[j] / (splits[j] + 1);
            if (per > bestLen + 1e-9) { bestLen = per; best = j; }
        }
        splits[best]++;
    }
    var pieces = [];
    for (j = 0; j < nseg; j++) {
        var cur = MCP.mrig.segment(p, j);
        var ts = MCP.mrig.arcParams(cur, splits[j] + 1), done = 0;
        for (var r = 0; r < ts.length; r++) {
            // the piece left after a split covers [done, 1] of the original segment
            var sp = MCP.mrig.splitCubic(cur, (ts[r] - done) / (1 - done));
            pieces.push(sp[0]);
            cur = sp[1];
            done = ts[r];
        }
        pieces.push(cur);
    }
    var out = { v: [], i: [], o: [], closed: p.closed };
    var m = pieces.length;
    for (var k = 0; k < m; k++) {
        var pc = pieces[k];
        out.v.push([pc[0][0], pc[0][1]]);
        out.o.push([pc[1][0] - pc[0][0], pc[1][1] - pc[0][1]]);
        var prevPiece = k > 0 ? pieces[k - 1] : (p.closed ? pieces[m - 1] : null);
        if (prevPiece) { out.i.push([prevPiece[2][0] - prevPiece[3][0], prevPiece[2][1] - prevPiece[3][1]]); }
        else { out.i.push([p.i[0][0], p.i[0][1]]); }
    }
    if (!p.closed) {
        var lp = pieces[m - 1], ln = p.v.length - 1;
        out.v.push([lp[3][0], lp[3][1]]);
        out.i.push([lp[2][0] - lp[3][0], lp[2][1] - lp[3][1]]);
        out.o.push([p.o[ln][0], p.o[ln][1]]);
    }
    return out;
};

MCP.mrig.reversePath = function (p) {
    var out = { v: [], i: [], o: [], closed: p.closed };
    for (var k = p.v.length - 1; k >= 0; k--) {
        out.v.push(p.v[k]);
        out.i.push(p.o[k]);
        out.o.push(p.i[k]);
    }
    return out;
};

/** The closed path p starting at vertex s. */
MCP.mrig.shiftPath = function (p, s) {
    var n = p.v.length, out = { v: [], i: [], o: [], closed: p.closed };
    for (var k = 0; k < n; k++) {
        var j = (k + s) % n;
        out.v.push(p.v[j]);
        out.i.push(p.i[j]);
        out.o.push(p.o[j]);
    }
    return out;
};

MCP.mrig.centroid = function (pts) {
    var x = 0, y = 0;
    for (var k = 0; k < pts.length; k++) { x += pts[k][0]; y += pts[k][1]; }
    return [x / pts.length, y / pts.length];
};

/**
 * Reorders b (same vertex count as a) so each vertex travels as little as
 * possible: every start vertex (closed paths) in both directions, compared
 * around each path's own centre. Returns {path, shift, reversed, cost}.
 */
MCP.mrig.matchPaths = function (a, b) {
    var n = a.v.length;
    var ca = MCP.mrig.centroid(a.v), cb = MCP.mrig.centroid(b.v);
    var stride = Math.max(1, Math.ceil(n / 200));
    var cands = [b, MCP.mrig.reversePath(b)];
    var best = null, samples = 0;
    for (var r = 0; r < 2; r++) {
        var cnd = cands[r];
        var shifts = a.closed ? n : 1;
        for (var s = 0; s < shifts; s++) {
            var cost = 0;
            samples = 0;
            for (var k = 0; k < n; k += stride) {
                var pa = a.v[k], pb = cnd.v[(k + s) % n];
                var dx = (pa[0] - ca[0]) - (pb[0] - cb[0]), dy = (pa[1] - ca[1]) - (pb[1] - cb[1]);
                cost += dx * dx + dy * dy;
                samples++;
            }
            if (!best || cost < best.cost - 1e-9) { best = { r: r, s: s, cost: cost }; }
        }
    }
    var out = cands[best.r];
    if (best.s) { out = MCP.mrig.shiftPath(out, best.s); }
    return { path: out, shift: best.s, reversed: best.r === 1, cost: Math.sqrt(best.cost / Math.max(1, samples)) };
};

MCP.register("shapeMorph", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var fromSpec = MCP.requireArg(args, "from"), toSpec = MCP.requireArg(args, "to");
    var fromLayer = MCP.resolveLayer(comp, MCP.requireArg(fromSpec, "layer"));
    var toLayer = MCP.resolveLayer(comp, MCP.requireArg(toSpec, "layer"));
    if (fromLayer.locked) { MCP.fail("Layer '" + fromLayer.name + "' is locked.", "invalid-argument"); }
    var A = MCP.mrig.findPath(fromLayer, fromSpec.path, "from");
    var B = MCP.mrig.findPath(toLayer, toSpec.path, "to");
    if (fromLayer.index === toLayer.index && A.label === B.label) { MCP.fail("from and to name the same path. Name two different paths.", "invalid-argument"); }
    if (A.kind !== "path") {
        MCP.fail("The from path '" + A.label + "' is a parametric " + A.kind + ", which cannot hold vertex keys. Convert it to a Bezier path first (right-click it, Convert To Bezier Path) or draw it with set-shape-path.", "unsupported");
    }
    var easing = MCP.isDefined(args.easing) ? args.easing : MCP.animate.EASE_LAND;
    if (easing === "overshoot") { MCP.fail("A path cannot overshoot. Use another easing.", "invalid-argument"); }
    if (MCP.isDefined(easing) && typeof easing !== "object") { MCP.easing.resolve(easing); }
    var space = String(MCP.arg(args, "space", "comp"));
    if (space !== "comp" && space !== "local") { MCP.fail("space must be comp or local.", "invalid-argument"); }
    var matchStart = String(MCP.arg(args, "matchStart", "auto"));
    if (matchStart !== "auto" && matchStart !== "keep") { MCP.fail("matchStart must be auto or keep.", "invalid-argument"); }
    MCP.mrig.requireSpan(args, "The morph");
    var t0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", fromLayer.inPoint);
    var t1 = t0 + MCP.animate.span(comp, args, 0.5);
    var notes = [];
    var pathProp = A.item.property("ADBE Vector Shape");
    var hadKeys = _mcpTry(function () { return pathProp.numKeys; }, 0);
    if (hadKeys > 0 && !MCP.bool(args.replaceKeys, false)) {
        MCP.fail("The from path '" + A.label + "' already has " + hadKeys + " keys, and keys with another vertex count would break its animation. Pass replaceKeys true to replace them.", "invalid-argument");
    }
    if (_mcpTry(function () { return pathProp.expression !== "" && pathProp.expressionEnabled; }, false)) { notes.push("The from path has an expression, which overrides the keys."); }

    var pa = MCP.mrig.pathFromShape(pathProp.valueAtTime(t0, true));
    var pb = MCP.mrig.itemPath(B.item, t1, notes);
    if (pa.v.length < 2 || pb.v.length < 2) { MCP.fail("Both paths need at least two vertices.", "invalid-argument"); }
    if (pa.closed !== pb.closed) { MCP.fail("One path is closed and the other open (" + A.label + ": " + (pa.closed ? "closed" : "open") + ", " + B.label + ": " + (pb.closed ? "closed" : "open") + "). Close or open one so they match.", "invalid-argument"); }

    if (space === "comp") {
        var MA = MCP.mrig.pathToComp(fromLayer, A, t1, notes), MB = MCP.mrig.pathToComp(toLayer, B, t1, notes);
        var inv = MA ? MCP.mrig.inv(MA) : null;
        if (!MA || !MB || !inv) {
            space = "local";
            notes.push("A 3D layer (or a zero scale) is involved, so the to path was copied in its own coordinates (space local).");
        } else {
            pb = MCP.mrig.transformPath(pb, MCP.mrig.mul(inv, MB));
        }
    }
    var counts = { from: pa.v.length, to: pb.v.length };
    var subdivided = null;
    if (pa.v.length < pb.v.length) {
        subdivided = { path: "from", added: pb.v.length - pa.v.length };
        pa = MCP.mrig.subdivide(pa, pb.v.length - pa.v.length);
    } else if (pb.v.length < pa.v.length) {
        subdivided = { path: "to", added: pa.v.length - pb.v.length };
        pb = MCP.mrig.subdivide(pb, pa.v.length - pb.v.length);
    }
    var match = { shift: 0, reversed: false, cost: null };
    if (matchStart === "auto") {
        var m = MCP.mrig.matchPaths(pa, pb);
        pb = m.path;
        match = { shift: m.shift, reversed: m.reversed, cost: MCP.round(m.cost, 2) };
    }

    // Everything is checked and computed: now write.
    if (hadKeys > 0) {
        while (pathProp.numKeys > 0) { pathProp.removeKey(1); }
        notes.push("The " + hadKeys + " earlier path keys were replaced.");
    }
    var keys = MCP.animate.keyMove(pathProp, t0, MCP.mrig.pathToShape(pa), t1, MCP.mrig.pathToShape(pb), easing, { comp: comp });
    var hidden = null;
    if (MCP.bool(args.hideTo, true)) {
        if (toLayer.index !== fromLayer.index) {
            toLayer.enabled = false;
            hidden = "layer";
            notes.push("The to layer '" + toLayer.name + "' was hidden (eye off); it stays as the reference shape.");
        } else {
            B.item.enabled = false;
            hidden = "path";
            notes.push("The to path '" + B.label + "' was switched off; it stays as the reference shape.");
        }
    }
    if (B.kind !== "path") { notes.push("The to shape is a parametric " + B.kind + "; its Bezier outline at the end time was used."); }
    if (subdivided) { notes.push("The " + subdivided.path + " path got " + subdivided.added + " vertices on its longest segments; its shape and corners are unchanged."); }
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layerRef(fromLayer),
        from: { layer: MCP.serialize.layerRef(fromLayer), path: A.label, propertyPath: MCP.pathOf(pathProp).path, vertexCount: counts.from },
        to: { layer: MCP.serialize.layerRef(toLayer), path: B.label, kind: B.kind, vertexCount: counts.to, hidden: hidden },
        vertexCount: pa.v.length, closed: pa.closed, subdivided: subdivided, match: match, space: space,
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        keys: keys, notes: notes
    };
}, { mutating: true });

/* ------------------------------------------------------------- wiggle rig */

MCP.mrig.WIGGLE_PROPS = {
    position: { matchName: "ADBE Position", control: "Position Amount", fallback: 10 },
    rotation: { matchName: "ADBE Rotate Z", control: "Rotation Amount", fallback: 2 },
    scale: { matchName: "ADBE Scale", control: "Scale Amount", fallback: 2 },
    opacity: { matchName: "ADBE Opacity", control: "Opacity Amount", fallback: 10 }
};

MCP.mrig.AXES = { "xy": [1, 1, 0], "x": [1, 0, 0], "y": [0, 1, 0], "xyz": [1, 1, 1] };

/** The noise part of a wiggle expression: leaves base (the start value), n (number or array) and s (strength). */
MCP.mrig.wiggleTop = function (rc, layer, prop, k) {
    var c = MCP.mrig.c;
    return [
        "// Wiggle rig: " + prop + " (controls on " + MCP.expr.str(rc.host.name) + ")",
        MCP.mrig.PLAIN,
        "var C = " + MCP.mrig.hostRef(rc, layer) + ";",
        "var f = " + c("Frequency") + ", amp = " + c(MCP.mrig.WIGGLE_PROPS[prop].control) + ";",
        "var loop = " + c("Loop Seconds") + ", s = " + c("Strength") + " / 100;",
        "seedRandom(Math.round(" + c("Seed") + ") * 1000 + " + k + ", true);",
        "function noiseAt(t) {",
        "  var w = wiggle(f, amp, 1, 0.5, t), b = valueAtTime(t);",
        "  if (typeof w == \"number\") { return w - b; }",
        "  var o = [];",
        "  for (var i = 0; i < w.length; i++) { o.push(w[i] - b[i]); }",
        "  return o;",
        "}",
        "var n;",
        "if (loop > 0) {",
        "  // blend two passes so the last frame of each loop meets the first",
        "  var t = time % loop, u = t / loop, n1 = noiseAt(t), n2 = noiseAt(t - loop);",
        "  if (typeof n1 == \"number\") { n = n1 * (1 - u) + n2 * u; }",
        "  else { n = []; for (var i = 0; i < n1.length; i++) { n.push(n1[i] * (1 - u) + n2[i] * u); } }",
        "} else {",
        "  n = noiseAt(time);",
        "}"
    ];
};

MCP.mrig.WIGGLE_CONTROLS = [
    ["slider", "Frequency"], ["slider", "Position Amount"], ["slider", "Rotation Amount"], ["slider", "Scale Amount"], ["slider", "Opacity Amount"],
    ["slider", "Loop Seconds"], ["slider", "Seed"], ["slider", "Strength"]
];

MCP.register("wiggleRig", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var all = MCP.mrig.layers(comp, MCP.requireArg(args, "layers"), args.order, "top-down");
    var props = MCP.isArray(args.properties) && args.properties.length ? args.properties : ["position"];
    var i;
    for (i = 0; i < props.length; i++) { if (!MCP.mrig.WIGGLE_PROPS[props[i]]) { MCP.fail("properties may hold position, rotation, scale and opacity.", "invalid-argument"); } }
    var axesName = String(MCP.arg(args, "axes", "xy"));
    var mask = MCP.mrig.AXES[axesName];
    if (!mask) { MCP.fail("axes must be xy, x, y or xyz.", "invalid-argument"); }
    if (args.rampIn) { MCP.mrig.requireSpan(args.rampIn, "rampIn"); }
    var host = MCP.mrig.givenHost(comp, args, MCP.mrig.WIGGLE_CONTROLS);
    var skipped = [];
    var layers = MCP.mrig.usable(all, [], skipped, false);
    if (!layers.length) { MCP.fail("No layers left to wiggle.", "invalid-argument", { skipped: skipped }); }

    var rc = MCP.mrig.begin(comp, { args: args, name: "Wiggle Controls", host: host });
    MCP.mrig.control(rc, "slider", "Frequency", args.frequency, 0.8);
    var amounts = { position: args.positionAmount, rotation: args.rotationAmount, scale: args.scaleAmount, opacity: args.opacityAmount };
    for (i = 0; i < props.length; i++) {
        var def = MCP.mrig.WIGGLE_PROPS[props[i]];
        MCP.mrig.control(rc, "slider", def.control, amounts[props[i]], def.fallback);
    }
    MCP.mrig.control(rc, "slider", "Loop Seconds", args.loop, 0);
    MCP.mrig.control(rc, "slider", "Seed", args.seed, 1);
    MCP.mrig.control(rc, "slider", "Strength", args.strength, 100);
    var ramp = null;
    if (args.rampIn) {
        var r0 = MCP.animate.timeOf(comp, args.rampIn, "startTime", "startFrame", 0);
        var r1 = r0 + MCP.animate.span(comp, args.rampIn, 1);
        ramp = { startTime: MCP.round(r0), endTime: MCP.round(r1), startFrame: MCP.frameOf(comp, r0), endFrame: MCP.frameOf(comp, r1), keys: MCP.mrig.keyControl(rc, "Strength", r0, 0, r1, MCP.num(args.strength, 100), args.rampIn.easing) };
    }
    var results = [];
    for (i = 0; i < layers.length; i++) {
        MCP.mrig.wiggleLayer(rc, layers[i], i, props, mask, results);
    }
    if (MCP.num(args.loop, 0) > 0) { rc.notes.push("With Loop Seconds above 0 the wiggle repeats exactly every Loop Seconds."); }
    rc.notes.push("Each layer has its own seed (Seed x 1000 + its place in the list), so no two move in step.");
    return MCP.mrig.finish(rc, { properties: props, axes: axesName, rampIn: ramp, layers: results, skipped: skipped });
}, { mutating: true });

/** The wiggle expression of one property; axis -1 for the whole value, 0 to 2 for one separated Position axis. */
MCP.mrig.wiggleCode = function (rc, layer, prop, k, mask, axis) {
    var top = MCP.mrig.wiggleTop(rc, layer, prop, k).join("\n") + "\n";
    if (prop === "position") {
        if (axis >= 0) { return top + "base + n * s;"; }
        return top + "var m = [" + mask.join(", ") + "], q = [];\n" +
            "for (var j = 0; j < base.length; j++) { q.push(base[j] + n[j] * m[j] * s); }\nq;";
    }
    if (prop === "scale") {
        return top + "var d = typeof n == \"number\" ? n : n[0], q = [];\n" +
            "for (var j = 0; j < base.length; j++) { q.push(base[j] + d * s); }\nq;";
    }
    if (prop === "opacity") { return top + "clamp(base + n * s, 0, 100);"; }
    return top + "base + n * s;";
};

MCP.mrig.wiggleLayer = function (rc, L, k, props, mask, results) {
    MCP.mrig.each(rc, L, results, function (e) {
        for (var j = 0; j < props.length; j++) {
            var p = props[j];
            if (p === "position") {
                var axes = [];
                for (var a = 0; a < 3; a++) { if (mask[a]) { axes.push(a); } }
                MCP.mrig.expressPosition(rc, e, L, function (axis) { return MCP.mrig.wiggleCode(rc, L, "position", k, mask, axis); }, axes);
            } else {
                MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property(MCP.mrig.WIGGLE_PROPS[p].matchName), MCP.mrig.wiggleCode(rc, L, p, k, mask, -1));
            }
        }
    });
};

/* -------------------------------------------------------------- sway loop */

MCP.mrig.SWAY_CONTROLS = [
    ["slider", "Period"], ["slider", "Phase Step"], ["slider", "Sway X"], ["slider", "Sway Y"], ["slider", "Sway Rotation"], ["slider", "Sway Scale"], ["slider", "Strength"]
];

MCP.register("swayLoop", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var all = MCP.mrig.layers(comp, MCP.requireArg(args, "layers"), args.order, "top-down");
    var sway = MCP.isArray(args.sway) ? [Number(args.sway[0]), Number(args.sway[1])] : [0, 12];
    var useRot = MCP.isDefined(args.rotation) && Number(args.rotation) !== 0;
    var useScale = MCP.isDefined(args.scale) && Number(args.scale) !== 0;
    var usePos = sway[0] !== 0 || sway[1] !== 0;
    if (!usePos && !useRot && !useScale) { MCP.fail("Nothing to sway: give sway [x, y] pixels, rotation degrees or scale percent.", "invalid-argument"); }
    var period = MCP.num(args.period, 4);
    if (!(period > 0)) { MCP.fail("period must be greater than 0 seconds.", "invalid-argument"); }
    var host = MCP.mrig.givenHost(comp, args, MCP.mrig.SWAY_CONTROLS);
    var skipped = [];
    var layers = MCP.mrig.usable(all, [], skipped, false);
    if (!layers.length) { MCP.fail("No layers left to sway.", "invalid-argument", { skipped: skipped }); }

    var rc = MCP.mrig.begin(comp, { args: args, name: "Sway Controls", host: host });
    MCP.mrig.control(rc, "slider", "Period", args.period, 4);
    MCP.mrig.control(rc, "slider", "Phase Step", args.phaseStep, 60);
    if (usePos) {
        MCP.mrig.control(rc, "slider", "Sway X", MCP.isArray(args.sway) ? sway[0] : undefined, sway[0]);
        MCP.mrig.control(rc, "slider", "Sway Y", MCP.isArray(args.sway) ? sway[1] : undefined, sway[1]);
    }
    if (useRot) { MCP.mrig.control(rc, "slider", "Sway Rotation", Number(args.rotation), 0); }
    if (useScale) { MCP.mrig.control(rc, "slider", "Sway Scale", Number(args.scale), 0); }
    MCP.mrig.control(rc, "slider", "Strength", args.strength, 100);
    var results = [];
    for (var i = 0; i < layers.length; i++) {
        MCP.mrig.swayLayer(rc, layers[i], i, usePos, useRot, useScale, results);
    }
    period = MCP.mrig.valueOf(rc, "Period");
    var loops = comp.duration / period;
    if (Math.abs(loops - Math.round(loops)) > 1e-3) { rc.notes.push("The composition (" + MCP.round(comp.duration) + " s) is not a whole number of periods (" + MCP.round(period) + " s); make it one for a seamless loop."); }
    return MCP.mrig.finish(rc, {
        period: MCP.round(period), phaseStep: MCP.round(MCP.mrig.valueOf(rc, "Phase Step")),
        sway: usePos ? sway : null, rotation: useRot ? Number(args.rotation) : null, scale: useScale ? Number(args.scale) : null,
        layers: results, skipped: skipped
    });
}, { mutating: true });

/** The sway expression of position, rotation or scale for layer k; axis 0 or 1 for one separated Position axis. */
MCP.mrig.swayCode = function (rc, layer, k, what, axis) {
    var c = MCP.mrig.c;
    var top = [
        "// Sway loop: " + what + ", layer " + (k + 1) + " (controls on " + MCP.expr.str(rc.host.name) + "); repeats every Period seconds",
        MCP.mrig.PLAIN,
        "var C = " + MCP.mrig.hostRef(rc, layer) + ";",
        "var per = Math.max(0.001, " + c("Period") + ");",
        "var a = 2 * Math.PI * time / per + degreesToRadians(" + c("Phase Step") + " * " + k + ");",
        "var s = " + c("Strength") + " / 100;"
    ].join("\n") + "\n";
    if (what === "rotation") { return top + "base + " + c("Sway Rotation") + " * Math.cos(a) * s;"; }
    if (what === "scale") {
        return top + "var d = " + c("Sway Scale") + " * Math.sin(a) * s, q = [];\n" +
            "for (var j = 0; j < base.length; j++) { q.push(base[j] + d); }\nq;";
    }
    if (axis === 0) { return top + "base + " + c("Sway X") + " * Math.cos(a) * s;"; }
    if (axis === 1) { return top + "base + " + c("Sway Y") + " * Math.sin(a) * s;"; }
    return top + "var d = [" + c("Sway X") + " * Math.cos(a), " + c("Sway Y") + " * Math.sin(a)], q = [];\n" +
        "for (var j = 0; j < base.length; j++) { q.push(base[j] + (j < 2 ? d[j] : 0) * s); }\nq;";
};

MCP.mrig.swayLayer = function (rc, L, k, usePos, useRot, useScale, results) {
    MCP.mrig.each(rc, L, results, function (e) {
        e.phase = k;
        if (usePos) {
            MCP.mrig.expressPosition(rc, e, L, function (axis) { return MCP.mrig.swayCode(rc, L, k, "position", axis); }, [0, 1]);
        }
        if (useRot) {
            MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Rotate Z"), MCP.mrig.swayCode(rc, L, k, "rotation", -1));
        }
        if (useScale) {
            MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Scale"), MCP.mrig.swayCode(rc, L, k, "scale", -1));
        }
    });
};

/* ------------------------------------------------------------- fit to box */

MCP.mrig.FIT_MODES = { "contain": "Math.min(fx, fy)", "cover": "Math.max(fx, fy)", "width": "fx", "height": "fy" };

MCP.mrig.FIT_CONTROLS = [["slider", "Box Width"], ["slider", "Box Height"], ["checkbox", "Upscale"], ["slider", "Scale Offset"]];

/** The scale (percent) a box fit gives a layer whose bounds are w x h; mirrors the expression. */
MCP.mrig.fitScale = function (w, h, boxW, boxH, mode, upscale, offset) {
    var fx = boxW / Math.max(w, 0.001), fy = boxH / Math.max(h, 0.001);
    var f = mode === "contain" ? Math.min(fx, fy) : (mode === "cover" ? Math.max(fx, fy) : (mode === "width" ? fx : fy));
    if (!upscale) { f = Math.min(f, 1); }
    return f * 100 + offset;
};

MCP.register("fitToBox", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var all = MCP.mrig.layers(comp, MCP.requireArg(args, "layers"), args.order, "top-down");
    var size = MCP.requireArg(args, "size");
    if (!MCP.isArray(size) || !(Number(size[0]) > 0) || !(Number(size[1]) > 0)) { MCP.fail("size must be [width, height] in pixels, both above 0.", "invalid-argument"); }
    var mode = String(MCP.arg(args, "mode", "contain"));
    if (!MCP.mrig.FIT_MODES[mode]) { MCP.fail("mode must be contain, cover, width or height.", "invalid-argument"); }
    var where = MCP.isDefined(args.controls) ? String(args.controls) : (all.length === 1 ? "layer" : "null");
    if (where !== "layer" && where !== "null") { MCP.fail("controls must be layer or null.", "invalid-argument"); }
    if (where === "layer" && all.length > 1 && !MCP.isDefined(args.controlLayer)) { MCP.fail("controls 'layer' needs exactly one layer; several layers share controls on a null (controls 'null').", "invalid-argument"); }
    var skipped = [];
    var layers = MCP.mrig.usable(all, [], skipped, true);
    if (!layers.length) { MCP.fail("No layers left to fit (nulls, cameras, lights and locked layers are skipped).", "invalid-argument", { skipped: skipped }); }
    var host = MCP.mrig.givenHost(comp, args, MCP.mrig.FIT_CONTROLS);
    if (!host && where === "layer") { host = MCP.mrig.checkHost(comp, layers[0], MCP.mrig.FIT_CONTROLS, true); }

    var rc = MCP.mrig.begin(comp, { args: args, name: "Fit Controls", host: host });
    MCP.mrig.control(rc, "slider", "Box Width", Number(size[0]), Number(size[0]));
    MCP.mrig.control(rc, "slider", "Box Height", Number(size[1]), Number(size[1]));
    MCP.mrig.control(rc, "checkbox", "Upscale", args.upscale, false);
    MCP.mrig.control(rc, "slider", "Scale Offset", args.offset, 0);
    var results = [];
    for (var i = 0; i < layers.length; i++) {
        MCP.mrig.fitLayer(rc, layers[i], mode, size, args, results);
    }
    rc.notes.push("Each layer scales about its anchor point, so the anchor decides which edge stays put. Text refits live as its words change.");
    return MCP.mrig.finish(rc, { mode: mode, size: [Number(size[0]), Number(size[1])], layers: results, skipped: skipped });
}, { mutating: true });

MCP.mrig.fitLayer = function (rc, L, mode, size, args, results) {
    var c = MCP.mrig.c;
    MCP.mrig.each(rc, L, results, function (e) {
        var code = [
            "// Fit to box: " + mode + " (controls on " + MCP.expr.str(rc.host.name) + ")",
            "var C = " + MCP.mrig.hostRef(rc, L) + ";",
            "var R = sourceRectAtTime(time, false);",
            "var fx = " + c("Box Width") + " / Math.max(R.width, 0.001), fy = " + c("Box Height") + " / Math.max(R.height, 0.001);",
            "var f = " + MCP.mrig.FIT_MODES[mode] + ";",
            "if (" + c("Upscale") + " <= 0) { f = Math.min(f, 1); }",
            "var sc = f * 100 + " + c("Scale Offset") + ";",
            "value.length > 2 ? [sc, sc, value[2]] : [sc, sc];"
        ].join("\n");
        MCP.mrig.express(rc, e, L.property("ADBE Transform Group").property("ADBE Scale"), code);
        var r = _mcpTry(function () { return L.sourceRectAtTime(rc.comp.time, false); }, null);
        if (r) {
            e.bounds = [MCP.round(r.width, 1), MCP.round(r.height, 1)];
            e.scaleNow = MCP.round(MCP.mrig.fitScale(r.width, r.height, Number(size[0]), Number(size[1]), mode, MCP.bool(args.upscale, false), MCP.num(args.offset, 0)), 2);
        }
    });
};
