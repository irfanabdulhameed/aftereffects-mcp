/*
 * Shared helpers for the rig commands. These are the low-level idioms the four
 * builder panels under panels/ use (findProp, setBy, setExpr, addEffect,
 * easeKeys, easeKey, ramp, bell, makeRoundRect, makeEllipse, setAlphaMatte),
 * ported once so every rig command behaves exactly like its panel.
 *
 * Fidelity rule: a rig command must build the same effect stack, values, layer
 * names and ordering as the panel it mirrors. When the shared MCP library does
 * the same thing (MCP.findProp, MCP.fx.addFirstAvailable, MCP.color.from255)
 * it is reused; when the panel idiom differs (raw setValue without coercion,
 * the panels' own easing shape) the panel idiom is kept here under MCP.rigs.*.
 *
 * This file sorts first inside commands/rigs/ (the assembler orders by path),
 * so MCP.rigs exists before any rig file runs. Each rig file also pushes a
 * description entry into MCP.rigs.catalog, which list-rigs returns.
 */

MCP.rigs = { catalog: [] };

/** Registers the human-readable description of a rig for list-rigs. */
MCP.rigs.describe = function (entry) {
    MCP.rigs.catalog.push(entry);
};

/* ------------------------------------------------------------ notes / log */

/** The panels keep a LOG array; commands keep a notes array and return it. */
MCP.rigs.log = function (notes, message) {
    if (notes) { notes.push(message); }
};

/* -------------------------------------------------------------- colours */

/**
 * Colour argument -> [r,g,b,1] in 0..1, the shape the panels' col() produced.
 * Tool inputs arrive as [r,g,b,a] in 0..1 (the server normalises them); the
 * panel default is a 0..255 triple from the SPEC table. Alpha is forced to 1
 * because the panels never passed alpha through.
 */
MCP.rigs.color = function (value, spec255) {
    if (MCP.isDefined(value)) {
        var c = MCP.color.rgba(value);
        return [c[0], c[1], c[2], 1];
    }
    return MCP.color.from255(spec255);
};

/** Colour argument -> [r,g,b] in 0..1 (three components, as Power Warp passes to Tint). */
MCP.rigs.color3 = function (value, spec255) {
    var c = MCP.rigs.color(value, spec255);
    return [c[0], c[1], c[2]];
};

/* ------------------------------------------------------------ properties */

/**
 * Sets a leaf value found by name anywhere under host. Mirrors the panels'
 * setBy: raw setValue, no coercion, a note on failure, true on success.
 * mark is the note prefix ("  - " in three panels, "  ? " in Power Warp).
 */
MCP.rigs.setBy = function (host, name, value, notes, mark) {
    var m = MCP.isDefined(mark) ? mark : "  - ";
    var p = MCP.findProp(host, name);
    if (!p) { MCP.rigs.log(notes, m + "could not find '" + name + "'"); return false; }
    try { p.setValue(value); return true; }
    catch (e) { MCP.rigs.log(notes, m + "'" + name + "' setValue failed: " + e.toString()); return false; }
};

/** Sets an expression on a leaf found by name under host. */
MCP.rigs.setExpr = function (host, name, expr, notes, mark) {
    var m = MCP.isDefined(mark) ? mark : "  - ";
    var p = MCP.findProp(host, name);
    if (!p) { MCP.rigs.log(notes, m + "expr target '" + name + "' missing"); return false; }
    try { p.expression = expr; return true; }
    catch (e) { MCP.rigs.log(notes, m + "expr on '" + name + "' failed"); return false; }
};

/**
 * Adds one effect by matchName or fails. Mirrors the panels' addEffect that
 * throws "Effect unavailable" when the install cannot add it.
 */
MCP.rigs.addEffect = function (layer, matchName, niceName) {
    var parade = MCP.effectsGroup(layer);
    var ok = false;
    try { ok = parade.canAddProperty(matchName); } catch (e) { ok = false; }
    if (!ok) {
        MCP.fail("Effect unavailable: " + (niceName || matchName) + " (matchName '" + matchName + "'). This rig needs it; check the effect is installed with list-available-effects.", "not-found", { matchName: matchName });
    }
    return parade.addProperty(matchName);
};

/**
 * Adds the first available effect from a matchName list, or null when none
 * exists (Depth Map Blur Reveal and Blur Color Reveal use this form).
 */
MCP.rigs.addFirstEffect = function (layer, matchNames) {
    var res = MCP.fx.addFirstAvailable(layer, matchNames);
    return res ? res.effect : null;
};

/* ---------------------------------------------------------------- easing */

/**
 * Easy-Ease every key on a property. influence 0..100. Sizes the ease array
 * to the property's dimensions (spatial props want exactly 1 element). The
 * first key's in handle and the last key's out handle use influence 0.1.
 * Verbatim port of easeKeys from Depth Map Blur Reveal and Blur Color Reveal.
 */
MCP.rigs.easeKeys = function (prop, influence) {
    var n = prop.numKeys; if (!n) { return; }
    var inf = Math.max(0.1, Math.min(100, influence));
    var dim = 1;
    try { dim = prop.isSpatial ? 1 : (prop.keyValue(1).length || 1); } catch (e) { dim = 1; }
    for (var i = 1; i <= n; i++) {
        var ai = [], ao = [];
        for (var d = 0; d < dim; d++) {
            ai.push(new KeyframeEase(0, (i === 1) ? 0.1 : inf));
            ao.push(new KeyframeEase(0, (i === n) ? 0.1 : inf));
        }
        try { prop.setTemporalEaseAtKey(i, ai, ao); } catch (e2) {}
        try { prop.setInterpolationTypeAtKey(i, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER); } catch (e3) {}
    }
};

/** Easy-Ease one key with a single 33.3333 influence handle (Power Warp's easeKey). */
MCP.rigs.easeKey = function (prop, i) {
    try {
        prop.setInterpolationTypeAtKey(i, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        prop.setTemporalEaseAtKey(i, [new KeyframeEase(0, 33.3333)], [new KeyframeEase(0, 33.3333)]);
    } catch (e) {}
};

/** Two-keyframe ramp v0 -> v1 over [t0, t1] on a property found by name (Power Warp). */
MCP.rigs.ramp = function (host, name, t0, v0, t1, v1, notes) {
    var p = MCP.findProp(host, name);
    if (!p) { MCP.rigs.log(notes, "  ? ramp target '" + name + "' missing"); return; }
    p.setValueAtTime(t0, v0);
    p.setValueAtTime(t1, v1);
    MCP.rigs.easeKey(p, p.nearestKeyIndex(t0));
    MCP.rigs.easeKey(p, p.nearestKeyIndex(t1));
};

/** Three-keyframe bell base -> peak -> base with the peak at tPeak (Power Warp). */
MCP.rigs.bell = function (prop, t0, tPeak, t1, base, peak) {
    if (!prop) { return; }
    prop.setValueAtTime(t0, base);
    prop.setValueAtTime(tPeak, peak);
    prop.setValueAtTime(t1, base);
    MCP.rigs.easeKey(prop, prop.nearestKeyIndex(t0));
    MCP.rigs.easeKey(prop, prop.nearestKeyIndex(tPeak));
    MCP.rigs.easeKey(prop, prop.nearestKeyIndex(t1));
};

/** Two-key animate an already resolved property v0 -> v1, eased with easeKeys. */
MCP.rigs.animProp = function (prop, t0, v0, t1, v1, ease, notes) {
    if (!prop) { return false; }
    try { prop.setValueAtTime(t0, v0); prop.setValueAtTime(t1, v1); MCP.rigs.easeKeys(prop, ease); return true; }
    catch (e) { MCP.rigs.log(notes, "  - keyframe failed on '" + (prop.name || "?") + "': " + e.toString()); return false; }
};

/** Resolve a named property under host, then two-key animate it. */
MCP.rigs.animBy = function (host, name, t0, v0, t1, v1, ease, notes) {
    var p = MCP.findProp(host, name);
    if (!p) { MCP.rigs.log(notes, "  - could not find '" + name + "' to animate"); return false; }
    return MCP.rigs.animProp(p, t0, v0, t1, v1, ease, notes);
};

/* ------------------------------------------------------------ transforms */

MCP.rigs.opacityProp = function (layer) {
    return layer.property("ADBE Transform Group").property("ADBE Opacity");
};

/** Opacity bell 0 -> 100 -> 0 so an adjustment layer ramps in and out (Power Warp). */
MCP.rigs.opacityBell = function (layer, t0, tPeak, t1) {
    MCP.rigs.bell(MCP.rigs.opacityProp(layer), t0, tPeak, t1, 0, 100);
};

/* ------------------------------------------------------------- shapes */

/**
 * A centred rounded-rectangle shape layer (Edge Glow's makeRoundRect).
 * o: { w, h, round, useFill, fillColor, useStroke, strokeColor, strokeW }
 * Colours are [r,g,b,1] in 0..1 already.
 */
MCP.rigs.makeRoundRect = function (comp, name, o) {
    var L = comp.layers.addShape();
    L.name = name;

    var root = L.property("ADBE Root Vectors Group");
    var grp = root.addProperty("ADBE Vector Group");
    grp.name = "Rectangle";
    var vg = grp.property("ADBE Vectors Group");

    var rect = vg.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([o.w, o.h]);
    try { rect.property("ADBE Vector Rect Roundness").setValue(o.round); } catch (e) {}
    try { rect.property("ADBE Vector Rect Position").setValue([0, 0]); } catch (e2) {}

    // Fill first (drawn under the stroke), then Stroke: AE draws bottom-up within a group.
    if (o.useFill) {
        var fill = vg.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue(o.fillColor);
    }
    if (o.useStroke) {
        var stroke = vg.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue(o.strokeColor);
        stroke.property("ADBE Vector Stroke Width").setValue(o.strokeW);
    }

    // centre the layer in the comp (anchor stays [0,0]; rect path is centred on it)
    L.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
    L.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    return L;
};

/**
 * A centred ellipse shape layer, fill plus optional stroke, anchor at [0,0]
 * (Blur Color Reveal's makeEllipse). Colours are [r,g,b,1] in 0..1 already;
 * strokeRGBA may be null.
 */
MCP.rigs.makeEllipse = function (comp, name, w, h, fillRGBA, strokeRGBA, strokeW) {
    var L = comp.layers.addShape(); L.name = name;
    var grp = L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    grp.name = "Ellipse 1";
    var vg = grp.property("ADBE Vectors Group");

    var el = vg.addProperty("ADBE Vector Shape - Ellipse");
    el.property("ADBE Vector Ellipse Size").setValue([w, h]);   // path centred on layer origin

    // stroke first then fill -> matches the reference (stroke renders over the fill)
    if (strokeW > 0 && strokeRGBA) {
        var st = vg.addProperty("ADBE Vector Graphic - Stroke");
        st.property("ADBE Vector Stroke Color").setValue(strokeRGBA);
        st.property("ADBE Vector Stroke Width").setValue(strokeW);
    }
    var fl = vg.addProperty("ADBE Vector Graphic - Fill");
    fl.property("ADBE Vector Fill Color").setValue(fillRGBA);

    L.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
    return L;
};

/**
 * Makes `fill` use `matte` as an ALPHA track matte (new setTrackMatte API with
 * the legacy fallback). Layer has no moveBefore(), so the fallback moves the
 * fill under the matte and sets trackMatteType.
 */
MCP.rigs.setAlphaMatte = function (fill, matte, notes) {
    if (typeof fill.setTrackMatte === "function") {
        try { fill.setTrackMatte(matte, TrackMatteType.ALPHA); return true; } catch (e) {}
    }
    try { fill.moveAfter(matte); fill.trackMatteType = TrackMatteType.ALPHA; return true; }
    catch (e2) { MCP.rigs.log(notes, "  - could not set track matte: " + e2.toString()); return false; }
};

/* --------------------------------------------------------------- layers */

/** Layer summary or null, for return values where a layer is optional. */
MCP.rigs.layerOrNull = function (layer) {
    return layer ? MCP.serialize.layer(layer) : null;
};

/** Optional layer reference -> Layer or null (undefined/null means "not given"). */
MCP.rigs.optionalLayer = function (comp, ref) {
    if (!MCP.isDefined(ref)) { return null; }
    return MCP.resolveLayer(comp, ref);
};
