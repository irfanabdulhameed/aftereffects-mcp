/*
 * Effects: apply (idempotent), list, inspect, set properties and keyframes,
 * remove, reorder, toggle, copy, and the built-in effect templates.
 */

MCP.fx = {};

/** Adds the first effect from a list of matchNames that this install can add. */
MCP.fx.addFirstAvailable = function (layer, matchNames) {
    var parade = MCP.effectsGroup(layer);
    for (var i = 0; i < matchNames.length; i++) {
        var ok = false;
        try { ok = parade.canAddProperty(matchNames[i]); } catch (e) { ok = false; }
        if (ok) { return { effect: parade.addProperty(matchNames[i]), matchName: matchNames[i] }; }
    }
    return null;
};

/** Adds an effect by matchName or display name. Returns {effect, resolvedBy}. */
MCP.fx.add = function (layer, identifier) {
    var parade = MCP.effectsGroup(layer);
    var id = String(identifier);
    var fx = null;
    try { if (parade.canAddProperty(id)) { fx = parade.addProperty(id); } } catch (e1) { fx = null; }
    if (fx) { return { effect: fx, resolvedBy: "matchName-or-name" }; }
    // Search the installed effect list for a display-name match.
    var found = MCP.fx.findInstalled(id);
    if (found) {
        try { fx = parade.addProperty(found.matchName); } catch (e2) { fx = null; }
        if (fx) { return { effect: fx, resolvedBy: "display-name:" + found.matchName }; }
    }
    MCP.fail("Effect '" + id + "' could not be added. Use list-available-effects to find the exact display name or matchName (for example 'ADBE Gaussian Blur 2').", "not-found");
    return null;
};

MCP.fx.installedCache = null;

MCP.fx.installed = function () {
    if (MCP.fx.installedCache) { return MCP.fx.installedCache; }
    var out = [];
    var coll = null;
    try { coll = app.effects; } catch (e) { coll = null; }
    if (!coll) { MCP.fail("app.effects is not available in this After Effects version.", "unsupported"); }
    var n = 0;
    try { n = Number(coll.length); } catch (e2) { n = 0; }
    for (var i = 0; i < n; i++) {
        var fx = null;
        try { fx = coll[i]; } catch (e3) { fx = null; }
        if (!fx) { continue; }
        out.push({
            displayName: _mcpTry(function () { return fx.displayName; }, ""),
            matchName: _mcpTry(function () { return fx.matchName; }, ""),
            category: _mcpTry(function () { return fx.category; }, ""),
            version: _mcpTry(function () { return fx.version; }, null)
        });
    }
    MCP.fx.installedCache = out;
    return out;
};

MCP.fx.findInstalled = function (name) {
    var list = MCP.fx.installed();
    var lower = String(name).toLowerCase();
    var i;
    for (i = 0; i < list.length; i++) { if (list[i].matchName === name || list[i].displayName === name) { return list[i]; } }
    for (i = 0; i < list.length; i++) { if (String(list[i].displayName).toLowerCase() === lower || String(list[i].matchName).toLowerCase() === lower) { return list[i]; } }
    return null;
};

/** Finds an existing effect on the layer by matchName or name (used for idempotency). */
MCP.fx.existing = function (layer, identifier) {
    var parade = MCP.effectsGroup(layer);
    var id = String(identifier);
    for (var i = 1; i <= parade.numProperties; i++) {
        var p = parade.property(i);
        if (p.matchName === id || p.name === id) { return p; }
    }
    var installed = MCP.fx.findInstalledSafe(id);
    if (installed) {
        for (var j = 1; j <= parade.numProperties; j++) {
            if (parade.property(j).matchName === installed.matchName) { return parade.property(j); }
        }
    }
    return null;
};

MCP.fx.findInstalledSafe = function (name) {
    try { return MCP.fx.findInstalled(name); } catch (e) { return null; }
};

/** Sets a leaf property under an effect by name (depth-first). Returns true on success. */
MCP.fx.setBy = function (effect, name, value, notes) {
    var p = MCP.findProp(effect, name);
    if (!p) { if (notes) { notes.push("Property '" + name + "' not found on " + effect.name); } return false; }
    try {
        p.setValue(MCP.coerceValue(p, value));
        return true;
    } catch (e) {
        if (notes) { notes.push("Could not set '" + name + "' on " + effect.name + ": " + e.toString()); }
        return false;
    }
};

/** Applies a {name: value} settings object to an effect. Returns {applied, notes}. */
MCP.fx.applySettings = function (effect, settings) {
    var applied = [], notes = [];
    if (!settings) { return { applied: applied, notes: notes }; }
    for (var k in settings) {
        if (!Object.prototype.hasOwnProperty.call(settings, k)) { continue; }
        var v = settings[k];
        var p = MCP.childProp(effect, k) || MCP.findProp(effect, k);
        if (!p) { notes.push("Property '" + k + "' not found on " + effect.name); continue; }
        try {
            var val = MCP.coerceValue(p, v);
            var vt = _mcpTry(function () { return MCP.serialize.valueTypeName(p); }, "");
            if (vt === "color" && MCP.isArray(val) && val.length === 3) { val = [val[0], val[1], val[2], 1]; }
            if (vt === "layer-index" && typeof val === "object" && val !== null) {
                val = MCP.resolveLayer(effect.propertyGroup(effect.propertyDepth).containingComp, val).index;
            }
            p.setValue(val);
            applied.push(k);
        } catch (e) {
            notes.push("Could not set '" + k + "' on " + effect.name + ": " + e.toString());
        }
    }
    return { applied: applied, notes: notes };
};

MCP.register("applyEffect", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var identifier = MCP.isDefined(args.effect) ? args.effect : (MCP.isDefined(args.matchName) ? args.matchName : args.name);
    if (!MCP.isDefined(identifier)) { MCP.fail("Give the effect to apply as 'effect' (display name or matchName).", "invalid-argument"); }
    var allowDuplicate = MCP.bool(args.allowDuplicate, false);
    var existing = allowDuplicate ? null : MCP.fx.existing(r.layer, identifier);
    var effect, created;
    if (existing) {
        effect = existing; created = false;
    } else {
        effect = MCP.fx.add(r.layer, identifier).effect; created = true;
        if (MCP.isDefined(args.effectName)) { effect.name = String(args.effectName); }
    }
    var settings = MCP.fx.applySettings(effect, args.settings);
    if (MCP.isDefined(args.enabled)) { effect.enabled = MCP.bool(args.enabled, true); }
    if (MCP.isDefined(args.moveToIndex)) {
        try { effect.moveTo(Math.max(1, Math.round(Number(args.moveToIndex)))); } catch (e) { settings.notes.push("Could not reorder: " + e.toString()); }
    }
    var out = {
        composition: MCP.serialize.compRef(r.comp),
        layer: MCP.serialize.layerRef(r.layer),
        created: created,
        alreadyPresent: !created,
        effect: MCP.serialize.effect(effect, { properties: MCP.bool(args.includeProperties, true), depth: 1 }),
        settingsApplied: settings.applied,
        notes: settings.notes
    };
    return out;
}, { mutating: true });

MCP.register("applyEffectsBulk", function (args, ctx) {
    var items = args.items;
    if (!MCP.isArray(items) || !items.length) { MCP.fail("items must be a non-empty array of {layer, effect, settings}.", "invalid-argument"); }
    var results = [], failed = 0;
    for (var i = 0; i < items.length; i++) {
        var it = items[i] || {};
        if (!MCP.isDefined(it.comp) && MCP.isDefined(args.comp)) { it.comp = args.comp; }
        try {
            var res = MCP.invoke("applyEffect", it, ctx);
            results.push({ item: i, status: "ok", layer: res.layer, effect: { name: res.effect.name, matchName: res.effect.matchName, index: res.effect.index }, created: res.created, notes: res.notes });
        } catch (err) {
            failed++;
            results.push({ item: i, status: "error", error: MCP.errorInfo(err, "applyEffect", ctx ? ctx.id : null) });
            if (MCP.bool(args.stopOnError, false)) { break; }
        }
    }
    return { items: results.length, failed: failed, results: results };
}, { mutating: true });

MCP.register("listLayerEffects", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var parade = MCP.effectsGroup(r.layer);
    var includeProps = MCP.bool(args.includeProperties, false);
    var depth = Math.round(MCP.num(args.depth, 2));
    var effects = [];
    for (var i = 1; i <= parade.numProperties; i++) {
        effects.push(MCP.serialize.effect(parade.property(i), { properties: includeProps, depth: depth }));
    }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), count: effects.length, effects: effects };
}, { mutating: false });

MCP.register("listAvailableEffects", function (args) {
    var list = MCP.fx.installed();
    var query = MCP.isDefined(args.query) ? String(args.query).toLowerCase() : "";
    var category = MCP.isDefined(args.category) ? String(args.category).toLowerCase() : "";
    var max = Math.round(MCP.num(args.maxResults, 500));
    var out = [], categories = {};
    for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.category) { categories[e.category] = (categories[e.category] || 0) + 1; }
        if (category && String(e.category).toLowerCase().indexOf(category) === -1) { continue; }
        if (query) {
            var hay = (e.displayName + " " + e.matchName + " " + e.category).toLowerCase();
            if (hay.indexOf(query) === -1) { continue; }
        }
        out.push(e);
        if (out.length >= max) { break; }
    }
    return { totalInstalled: list.length, returned: out.length, query: query || null, category: category || null, categories: categories, effects: out };
}, { mutating: false });

MCP.register("getEffectProperties", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var fx = MCP.resolveEffect(r.layer, MCP.requireArg(args, "effect"));
    var depth = Math.round(MCP.num(args.depth, 3));
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), effect: MCP.serialize.effect(fx, { properties: true, depth: depth }) };
}, { mutating: false });

MCP.fx.targetProperty = function (layer, args) {
    var fx = MCP.resolveEffect(layer, MCP.requireArg(args, "effect"));
    var prop = null;
    if (MCP.isDefined(args.property)) {
        var tokens = MCP.normalizePath(args.property);
        var cur = fx;
        for (var i = 0; i < tokens.length && cur; i++) {
            var tok = tokens[i];
            if (typeof tok === "string" && /^\d+$/.test(tok)) { tok = parseInt(tok, 10); }
            cur = MCP.childProp(cur, tok);
        }
        prop = cur;
        if (!prop && tokens.length === 1 && typeof tokens[0] === "string") { prop = MCP.findProp(fx, tokens[0]); }
    }
    if (!prop) {
        MCP.fail("Property '" + args.property + "' not found on effect '" + fx.name + "'. Its properties: " + MCP.childNames(fx).join(", "), "not-found", { properties: MCP.childNames(fx) });
    }
    if (MCP.isGroup(prop)) { MCP.fail("'" + args.property + "' on effect '" + fx.name + "' is a group, not a value. Children: " + MCP.childNames(prop).join(", "), "invalid-argument"); }
    return { effect: fx, prop: prop };
};

MCP.register("setEffectProperty", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var t = MCP.fx.targetProperty(r.layer, args);
    var before = MCP.serialize.value(t.prop);
    var keyIndex = null;
    if (MCP.isDefined(args.expression)) {
        if (!t.prop.canSetExpression) { MCP.fail("Property '" + t.prop.name + "' does not accept expressions.", "unsupported"); }
        t.prop.expression = String(args.expression);
    }
    if (MCP.isDefined(args.value)) {
        var value = MCP.coerceValue(t.prop, args.value);
        var vt = MCP.serialize.valueTypeName(t.prop);
        if (vt === "color" && MCP.isArray(value) && value.length === 3) { value = [value[0], value[1], value[2], 1]; }
        if (vt === "layer-index" && value && typeof value === "object") { value = MCP.resolveLayer(r.comp, value).index; }
        if (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) {
            keyIndex = MCP.easing.setKey(t.prop, MCP.timeArg(r.comp, args), value);
            if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(t.prop, keyIndex, args.easing); }
        } else if (t.prop.numKeys > 0) {
            keyIndex = MCP.easing.setKey(t.prop, r.comp.time, value);
        } else {
            t.prop.setValue(value);
        }
    }
    return MCP.serialize.propertyResult(r.layer, t.prop, {
        effect: { index: t.effect.propertyIndex, name: t.effect.name, matchName: t.effect.matchName },
        previousValue: before,
        keyIndex: keyIndex,
        keyframe: keyIndex ? MCP.serialize.keyframe(t.prop, keyIndex) : null
    });
}, { mutating: true });

MCP.register("setEffectProperties", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var fx = MCP.resolveEffect(r.layer, MCP.requireArg(args, "effect"));
    var settings = MCP.requireArg(args, "settings");
    var res = MCP.fx.applySettings(fx, settings);
    if (MCP.isDefined(args.enabled)) { fx.enabled = MCP.bool(args.enabled, true); }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), effect: MCP.serialize.effect(fx, { properties: true, depth: 1 }), applied: res.applied, notes: res.notes };
}, { mutating: true });

MCP.register("setEffectKeyframe", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var t = MCP.fx.targetProperty(r.layer, args);
    var value = MCP.coerceValue(t.prop, MCP.requireArg(args, "value"));
    var vt = MCP.serialize.valueTypeName(t.prop);
    if (vt === "color" && MCP.isArray(value) && value.length === 3) { value = [value[0], value[1], value[2], 1]; }
    var time = MCP.timeArg(r.comp, args);
    var keyIndex = MCP.easing.setKey(t.prop, time, value);
    if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(t.prop, keyIndex, args.easing); }
    return MCP.serialize.propertyResult(r.layer, t.prop, {
        effect: { index: t.effect.propertyIndex, name: t.effect.name, matchName: t.effect.matchName },
        keyIndex: keyIndex, keyframe: MCP.serialize.keyframe(t.prop, keyIndex)
    });
}, { mutating: true });

MCP.register("removeEffect", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var fx = MCP.resolveEffect(r.layer, MCP.requireArg(args, "effect"));
    var removed = { index: fx.propertyIndex, name: fx.name, matchName: fx.matchName };
    fx.remove();
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), removed: removed, remainingEffects: MCP.childNames(MCP.effectsGroup(r.layer)) };
}, { mutating: true });

MCP.register("removeAllEffects", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var parade = MCP.effectsGroup(r.layer);
    var removed = [];
    for (var i = parade.numProperties; i >= 1; i--) {
        var p = parade.property(i);
        removed.push({ index: i, name: p.name, matchName: p.matchName });
        p.remove();
    }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), removedCount: removed.length, removed: removed };
}, { mutating: true });

MCP.register("reorderEffect", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var fx = MCP.resolveEffect(r.layer, MCP.requireArg(args, "effect"));
    var parade = MCP.effectsGroup(r.layer);
    var target;
    if (MCP.isDefined(args.toIndex)) { target = Math.round(Number(args.toIndex)); }
    else if (MCP.bool(args.toTop, false)) { target = 1; }
    else if (MCP.bool(args.toBottom, false)) { target = parade.numProperties; }
    else { MCP.fail("Give toIndex, toTop or toBottom.", "invalid-argument"); }
    target = MCP.clamp(target, 1, parade.numProperties);
    fx.moveTo(target);
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), effect: { name: fx.name, index: target }, order: MCP.childNames(parade) };
}, { mutating: true });

MCP.register("toggleEffect", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var fx = MCP.resolveEffect(r.layer, MCP.requireArg(args, "effect"));
    fx.enabled = MCP.isDefined(args.enabled) ? MCP.bool(args.enabled, true) : !fx.enabled;
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), effect: MCP.serialize.effect(fx) };
}, { mutating: true });

MCP.register("copyEffects", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var from = MCP.resolveLayer(comp, MCP.requireArg(args, "fromLayer"));
    var toComp = MCP.isDefined(args.toComp) ? MCP.resolveComp(args.toComp) : comp;
    var targets = MCP.resolveLayers(toComp, MCP.isDefined(args.toLayers) ? args.toLayers : [MCP.requireArg(args, "toLayer")]);
    var parade = MCP.effectsGroup(from);
    var sources = [];
    if (MCP.isArray(args.effects) && args.effects.length) {
        for (var i = 0; i < args.effects.length; i++) { sources.push(MCP.resolveEffect(from, args.effects[i])); }
    } else {
        for (var j = 1; j <= parade.numProperties; j++) { sources.push(parade.property(j)); }
    }
    if (!sources.length) { MCP.fail("Layer '" + from.name + "' has no effects to copy.", "not-found"); }
    var copied = [];
    for (var t = 0; t < targets.length; t++) {
        var target = targets[t];
        if (target === from) { continue; }
        for (var s = 0; s < sources.length; s++) {
            var src = sources[s];
            var res = MCP.fx.addFirstAvailable(target, [src.matchName]);
            if (!res) { copied.push({ layer: target.name, effect: src.name, status: "unavailable" }); continue; }
            var dst = res.effect;
            dst.name = src.name;
            dst.enabled = src.enabled;
            MCP.fx.copyValues(src, dst);
            copied.push({ layer: target.name, effect: dst.name, status: "ok" });
        }
    }
    return { from: MCP.serialize.layerRef(from), targets: targets.length, copied: copied };
}, { mutating: true });

/** Recursively copies values, keyframes and expressions from one property group to another with the same structure. */
MCP.fx.copyValues = function (src, dst) {
    var n = 0;
    try { n = src.numProperties; } catch (e) { n = 0; }
    for (var i = 1; i <= n; i++) {
        var sp = null, dp = null;
        try { sp = src.property(i); dp = dst.property(i); } catch (e2) { continue; }
        if (!sp || !dp) { continue; }
        if (MCP.isGroup(sp)) { MCP.fx.copyValues(sp, dp); continue; }
        try {
            if (sp.numKeys > 0) {
                for (var k = 1; k <= sp.numKeys; k++) {
                    var idx = dp.addKey(sp.keyTime(k));
                    dp.setValueAtKey(idx, sp.keyValue(k));
                    try { dp.setInterpolationTypeAtKey(idx, sp.keyInInterpolationType(k), sp.keyOutInterpolationType(k)); } catch (e3) {}
                    try { dp.setTemporalEaseAtKey(idx, sp.keyInTemporalEase(k), sp.keyOutTemporalEase(k)); } catch (e4) {}
                }
            } else if (dp.setValue) {
                dp.setValue(sp.value);
            }
            if (sp.canSetExpression && sp.expression !== "") { dp.expression = sp.expression; dp.expressionEnabled = sp.expressionEnabled; }
        } catch (e5) {}
    }
};

/* ------------------------------------------------------------- templates */

/**
 * Each template: { description, params: {name: {default, description}}, build(layer, p, comp, notes) -> [effect] }
 * Parameter values that are undefined fall back to defaults (zero is respected).
 */
MCP.effectTemplates = {};

function _mcpTemplateParam(p, name, def) {
    return MCP.isDefined(p[name]) ? p[name] : def;
}

function _mcpAddFx(layer, matchNames, niceName, notes) {
    var res = MCP.fx.addFirstAvailable(layer, MCP.isArray(matchNames) ? matchNames : [matchNames]);
    if (!res) { MCP.fail("Effect '" + niceName + "' is not available in this After Effects install (tried " + (MCP.isArray(matchNames) ? matchNames.join(", ") : matchNames) + ").", "unsupported"); }
    return res.effect;
}

function _mcpKeyRamp(effect, propName, comp, t0, v0, t1, v1, easing, notes) {
    var p = MCP.findProp(effect, propName);
    if (!p) { notes.push("Property '" + propName + "' not found on " + effect.name + "; ramp skipped."); return; }
    var i0 = MCP.easing.setKey(p, t0, v0);
    var i1 = MCP.easing.setKey(p, t1, v1);
    MCP.easing.applySegment(p, i1, easing || "ease");
}

MCP.effectTemplates["gaussian-blur"] = {
    description: "Gaussian Blur with a given blurriness.",
    params: { blurriness: { "default": 20, description: "Blur amount in pixels." }, repeatEdgePixels: { "default": true, description: "Avoid dark edges." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Gaussian Blur 2", "ADBE Gaussian Blur"], "Gaussian Blur", notes);
        MCP.fx.setBy(fx, "Blurriness", _mcpTemplateParam(p, "blurriness", 20), notes);
        MCP.fx.setBy(fx, "Repeat Edge Pixels", _mcpTemplateParam(p, "repeatEdgePixels", true), notes);
        return [fx];
    }
};
MCP.effectTemplates["directional-blur"] = {
    description: "Directional (motion-style) blur.",
    params: { direction: { "default": 0, description: "Angle in degrees." }, length: { "default": 10, description: "Blur length in pixels." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Directional Blur"], "Directional Blur", notes);
        MCP.fx.setBy(fx, "Direction", _mcpTemplateParam(p, "direction", 0), notes);
        MCP.fx.setBy(fx, "Blur Length", _mcpTemplateParam(p, "length", 10), notes);
        return [fx];
    }
};
MCP.effectTemplates["color-balance"] = {
    description: "Hue, lightness and saturation offsets (Color Balance HLS).",
    params: { hue: { "default": 0, description: "Degrees." }, lightness: { "default": 0, description: "-100 to 100." }, saturation: { "default": 0, description: "-100 to 100." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Color Balance (HLS)"], "Color Balance (HLS)", notes);
        MCP.fx.setBy(fx, "Hue", _mcpTemplateParam(p, "hue", 0), notes);
        MCP.fx.setBy(fx, "Lightness", _mcpTemplateParam(p, "lightness", 0), notes);
        MCP.fx.setBy(fx, "Saturation", _mcpTemplateParam(p, "saturation", 0), notes);
        return [fx];
    }
};
MCP.effectTemplates["brightness-contrast"] = {
    description: "Brightness and contrast.",
    params: { brightness: { "default": 0, description: "-150 to 150." }, contrast: { "default": 0, description: "-100 to 100." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Brightness & Contrast 2"], "Brightness & Contrast", notes);
        MCP.fx.setBy(fx, "Brightness", _mcpTemplateParam(p, "brightness", 0), notes);
        MCP.fx.setBy(fx, "Contrast", _mcpTemplateParam(p, "contrast", 0), notes);
        MCP.fx.setBy(fx, "Use Legacy", false, notes);
        return [fx];
    }
};
MCP.effectTemplates["curves"] = {
    description: "Curves with default (identity) curves for manual adjustment.",
    params: {},
    build: function (layer, p, comp, notes) { return [_mcpAddFx(layer, ["ADBE CurvesCustom"], "Curves", notes)]; }
};
MCP.effectTemplates["glow"] = {
    description: "Built-in Glow.",
    params: { threshold: { "default": 50, description: "Percent." }, radius: { "default": 15, description: "Pixels." }, intensity: { "default": 1, description: "Multiplier." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Glo2"], "Glow", notes);
        MCP.fx.setBy(fx, "Glow Threshold", _mcpTemplateParam(p, "threshold", 50), notes);
        MCP.fx.setBy(fx, "Glow Radius", _mcpTemplateParam(p, "radius", 15), notes);
        MCP.fx.setBy(fx, "Glow Intensity", _mcpTemplateParam(p, "intensity", 1), notes);
        return [fx];
    }
};
MCP.effectTemplates["neon-glow"] = {
    description: "Two stacked glows tinted with two colours for a neon look.",
    params: { colorA: { "default": "#FF3CAC", description: "Inner glow colour." }, colorB: { "default": "#784BFF", description: "Outer glow colour." }, radius: { "default": 40, description: "Outer radius." }, intensity: { "default": 1.5, description: "Multiplier." } },
    build: function (layer, p, comp, notes) {
        var inner = _mcpAddFx(layer, ["ADBE Glo2"], "Glow", notes);
        MCP.fx.setBy(inner, "Glow Threshold", 60, notes);
        MCP.fx.setBy(inner, "Glow Radius", Number(_mcpTemplateParam(p, "radius", 40)) / 3, notes);
        MCP.fx.setBy(inner, "Glow Intensity", _mcpTemplateParam(p, "intensity", 1.5), notes);
        MCP.fx.setBy(inner, "Glow Colors", 2, notes);
        MCP.fx.setBy(inner, "Color A", MCP.color.rgba(_mcpTemplateParam(p, "colorA", "#FF3CAC")), notes);
        MCP.fx.setBy(inner, "Color B", MCP.color.rgba(_mcpTemplateParam(p, "colorB", "#784BFF")), notes);
        var outer = _mcpAddFx(layer, ["ADBE Glo2"], "Glow", notes);
        outer.name = "Glow (outer)";
        MCP.fx.setBy(outer, "Glow Threshold", 40, notes);
        MCP.fx.setBy(outer, "Glow Radius", _mcpTemplateParam(p, "radius", 40), notes);
        MCP.fx.setBy(outer, "Glow Intensity", Number(_mcpTemplateParam(p, "intensity", 1.5)) * 0.6, notes);
        MCP.fx.setBy(outer, "Glow Colors", 2, notes);
        MCP.fx.setBy(outer, "Color A", MCP.color.rgba(_mcpTemplateParam(p, "colorB", "#784BFF")), notes);
        MCP.fx.setBy(outer, "Color B", MCP.color.rgba(_mcpTemplateParam(p, "colorA", "#FF3CAC")), notes);
        return [inner, outer];
    }
};
MCP.effectTemplates["deep-glow-with-fallback"] = {
    description: "Deep Glow (Plugin Everything) if installed, otherwise the built-in Glow tuned to look similar. The result says which one was used.",
    params: { radius: { "default": 200, description: "Deep Glow radius (built-in fallback uses radius / 2.5)." }, exposure: { "default": 1, description: "Deep Glow exposure (fallback intensity)." } },
    build: function (layer, p, comp, notes) {
        var res = MCP.fx.addFirstAvailable(layer, ["PluginEverything Deep Glow 2", "Plugin Everything Deep Glow 2", "PluginEverything Deep Glow", "Plugin Everything Deep Glow", "Deep Glow 2", "Deep Glow"]);
        if (res) {
            MCP.fx.setBy(res.effect, "Radius", _mcpTemplateParam(p, "radius", 200), notes);
            MCP.fx.setBy(res.effect, "Exposure", _mcpTemplateParam(p, "exposure", 1), notes);
            notes.push("Used " + res.matchName + ".");
            return [res.effect];
        }
        var fx = _mcpAddFx(layer, ["ADBE Glo2"], "Glow", notes);
        MCP.fx.setBy(fx, "Glow Threshold", 50, notes);
        MCP.fx.setBy(fx, "Glow Radius", Number(_mcpTemplateParam(p, "radius", 200)) / 2.5, notes);
        MCP.fx.setBy(fx, "Glow Intensity", Number(_mcpTemplateParam(p, "exposure", 1)) * 1.5, notes);
        notes.push("Deep Glow is not installed; used the built-in Glow instead.");
        return [fx];
    }
};
function _mcpDropShadow(layer, p, notes, defaults) {
    var fx = _mcpAddFx(layer, ["ADBE Drop Shadow"], "Drop Shadow", notes);
    MCP.fx.setBy(fx, "Shadow Color", MCP.color.rgba(_mcpTemplateParam(p, "color", defaults.color)), notes);
    // Drop Shadow opacity is stored 0..255 when set by script; the UI shows percent.
    MCP.fx.setBy(fx, "Opacity", Math.round(Number(_mcpTemplateParam(p, "opacity", defaults.opacity)) * 2.55), notes);
    MCP.fx.setBy(fx, "Direction", _mcpTemplateParam(p, "direction", defaults.direction), notes);
    MCP.fx.setBy(fx, "Distance", _mcpTemplateParam(p, "distance", defaults.distance), notes);
    MCP.fx.setBy(fx, "Softness", _mcpTemplateParam(p, "softness", defaults.softness), notes);
    return fx;
}
MCP.effectTemplates["drop-shadow"] = {
    description: "Drop Shadow.",
    params: { color: { "default": "#000000", description: "Shadow colour." }, opacity: { "default": 50, description: "Percent." }, direction: { "default": 135, description: "Degrees." }, distance: { "default": 10, description: "Pixels." }, softness: { "default": 10, description: "Pixels." } },
    build: function (layer, p, comp, notes) { return [_mcpDropShadow(layer, p, notes, { color: "#000000", opacity: 50, direction: 135, distance: 10, softness: 10 })]; }
};
MCP.effectTemplates["soft-shadow"] = {
    description: "Large, soft, low-opacity shadow for UI cards and text.",
    params: { color: { "default": "#000000", description: "Shadow colour." }, opacity: { "default": 35, description: "Percent." }, distance: { "default": 12, description: "Pixels." }, softness: { "default": 60, description: "Pixels." } },
    build: function (layer, p, comp, notes) { return [_mcpDropShadow(layer, p, notes, { color: "#000000", opacity: 35, direction: 135, distance: 12, softness: 60 })]; }
};
MCP.effectTemplates["long-shadow"] = {
    description: "Hard, offset shadow that reads as a flat long shadow.",
    params: { color: { "default": "#000000", description: "Shadow colour." }, opacity: { "default": 30, description: "Percent." }, direction: { "default": 135, description: "Degrees." }, distance: { "default": 40, description: "Pixels." } },
    build: function (layer, p, comp, notes) {
        var q = MCP.extend({}, p); q.softness = 0;
        return [_mcpDropShadow(layer, q, notes, { color: "#000000", opacity: 30, direction: 135, distance: 40, softness: 0 })];
    }
};
MCP.effectTemplates["outline"] = {
    description: "Stroke layer style around the layer's alpha (not an effect; it appears under Layer Styles).",
    params: { size: { "default": 4, description: "Pixels." }, color: { "default": "#FFFFFF", description: "Stroke colour." }, opacity: { "default": 100, description: "Percent." } },
    build: function (layer, p, comp, notes) {
        var styles = _mcpTry(function () { return layer.property("ADBE Layer Styles"); }, null);
        if (!styles) { MCP.fail("Layer styles are not available on this layer.", "unsupported"); }
        var st = null;
        try { if (styles.canAddProperty("frameFX/enabled")) { st = styles.addProperty("frameFX/enabled"); } } catch (e) { st = null; }
        if (!st) { st = _mcpTry(function () { return styles.property("frameFX/enabled"); }, null); }
        if (!st) { MCP.fail("Could not add a Stroke layer style by script in this After Effects version. Use Layer > Layer Styles > Stroke.", "unsupported"); }
        try { st.enabled = true; } catch (e2) {}
        MCP.fx.setBy(st, "frameFX/size", _mcpTemplateParam(p, "size", 4), notes);
        MCP.fx.setBy(st, "frameFX/color", MCP.color.rgba(_mcpTemplateParam(p, "color", "#FFFFFF")), notes);
        MCP.fx.setBy(st, "frameFX/opacity", _mcpTemplateParam(p, "opacity", 100), notes);
        return [st];
    }
};
MCP.effectTemplates["chromatic-aberration"] = {
    description: "RGB fringing using the VR Chromatic Aberrations effect (After Effects 2018 or later).",
    params: { amount: { "default": 4, description: "Aberration strength (red and blue offsets)." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE VR Chromatic Aberrations"], "VR Chromatic Aberrations", notes);
        var a = Number(_mcpTemplateParam(p, "amount", 4));
        MCP.fx.setBy(fx, "Aberration (Red)", a, notes);
        MCP.fx.setBy(fx, "Aberration (Green)", 0, notes);
        MCP.fx.setBy(fx, "Aberration (Blue)", -a, notes);
        MCP.fx.setBy(fx, "Falloff Distance", 100, notes);
        return [fx];
    }
};
MCP.effectTemplates["film-grain"] = {
    description: "Fine monochrome noise.",
    params: { amount: { "default": 6, description: "Percent of noise." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Noise"], "Noise", notes);
        MCP.fx.setBy(fx, "Amount of Noise", _mcpTemplateParam(p, "amount", 6), notes);
        MCP.fx.setBy(fx, "Noise Type", false, notes);
        MCP.fx.setBy(fx, "Clipping", true, notes);
        return [fx];
    }
};
MCP.effectTemplates["vignette"] = {
    description: "CC Vignette darkening the corners.",
    params: { amount: { "default": 60, description: "Percent." }, angleOfView: { "default": 60, description: "Larger is wider." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["CC Vignette"], "CC Vignette", notes);
        MCP.fx.setBy(fx, "Amount", _mcpTemplateParam(p, "amount", 60), notes);
        MCP.fx.setBy(fx, "Angle of View", _mcpTemplateParam(p, "angleOfView", 60), notes);
        return [fx];
    }
};
MCP.effectTemplates["letterbox"] = {
    description: "Two Linear Wipes that remove a band from the top and bottom of the layer.",
    params: { bars: { "default": 12, description: "Percent of the height removed at each edge." } },
    build: function (layer, p, comp, notes) {
        var bars = Number(_mcpTemplateParam(p, "bars", 12));
        var top = _mcpAddFx(layer, ["ADBE Linear Wipe"], "Linear Wipe", notes);
        top.name = "Letterbox Top";
        MCP.fx.setBy(top, "Transition Completion", bars, notes);
        MCP.fx.setBy(top, "Wipe Angle", 0, notes);
        MCP.fx.setBy(top, "Feather", 0, notes);
        var bottom = _mcpAddFx(layer, ["ADBE Linear Wipe"], "Linear Wipe", notes);
        bottom.name = "Letterbox Bottom";
        MCP.fx.setBy(bottom, "Transition Completion", bars, notes);
        MCP.fx.setBy(bottom, "Wipe Angle", 180, notes);
        MCP.fx.setBy(bottom, "Feather", 0, notes);
        return [top, bottom];
    }
};
MCP.effectTemplates["posterize-time"] = {
    description: "Posterize Time to a lower frame rate (stop-motion feel).",
    params: { frameRate: { "default": 12, description: "Frames per second." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Posterize Time"], "Posterize Time", notes);
        MCP.fx.setBy(fx, "Frame Rate", _mcpTemplateParam(p, "frameRate", 12), notes);
        return [fx];
    }
};
MCP.effectTemplates["pixelate"] = {
    description: "Mosaic pixelation.",
    params: { blocks: { "default": 40, description: "Horizontal block count; vertical follows the aspect." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Mosaic"], "Mosaic", notes);
        var h = Number(_mcpTemplateParam(p, "blocks", 40));
        MCP.fx.setBy(fx, "Horizontal Blocks", h, notes);
        MCP.fx.setBy(fx, "Vertical Blocks", Math.max(1, Math.round(h * comp.height / comp.width)), notes);
        MCP.fx.setBy(fx, "Sharp Colors", true, notes);
        return [fx];
    }
};
MCP.effectTemplates["motion-tile"] = {
    description: "Motion Tile with mirrored edges, for repeating patterns or extending a layer.",
    params: { outputWidth: { "default": 300, description: "Percent." }, outputHeight: { "default": 300, description: "Percent." }, mirror: { "default": true, description: "Mirror edges." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Tile"], "Motion Tile", notes);
        MCP.fx.setBy(fx, "Output Width", _mcpTemplateParam(p, "outputWidth", 300), notes);
        MCP.fx.setBy(fx, "Output Height", _mcpTemplateParam(p, "outputHeight", 300), notes);
        MCP.fx.setBy(fx, "Mirror Edges", _mcpTemplateParam(p, "mirror", true), notes);
        return [fx];
    }
};
MCP.effectTemplates["linear-wipe-transition"] = {
    description: "Linear Wipe keyframed to reveal (or hide) the layer over a time range.",
    params: { start: { "default": 0, description: "Start time in seconds." }, duration: { "default": 1, description: "Seconds." }, angle: { "default": 90, description: "Wipe angle in degrees." }, feather: { "default": 20, description: "Pixels." }, reveal: { "default": true, description: "true reveals the layer, false wipes it away." }, easing: { "default": "ease", description: "Easing preset." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Linear Wipe"], "Linear Wipe", notes);
        MCP.fx.setBy(fx, "Wipe Angle", _mcpTemplateParam(p, "angle", 90), notes);
        MCP.fx.setBy(fx, "Feather", _mcpTemplateParam(p, "feather", 20), notes);
        var t0 = Number(_mcpTemplateParam(p, "start", 0)), d = Number(_mcpTemplateParam(p, "duration", 1));
        var reveal = MCP.bool(_mcpTemplateParam(p, "reveal", true), true);
        _mcpKeyRamp(fx, "Transition Completion", comp, t0, reveal ? 100 : 0, t0 + d, reveal ? 0 : 100, _mcpTemplateParam(p, "easing", "ease"), notes);
        return [fx];
    }
};
MCP.effectTemplates["radial-wipe-transition"] = {
    description: "Radial Wipe keyframed to reveal (or hide) the layer over a time range.",
    params: { start: { "default": 0, description: "Seconds." }, duration: { "default": 1, description: "Seconds." }, feather: { "default": 10, description: "Pixels." }, reveal: { "default": true, description: "true reveals, false hides." }, easing: { "default": "ease", description: "Easing preset." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Radial Wipe"], "Radial Wipe", notes);
        MCP.fx.setBy(fx, "Feather", _mcpTemplateParam(p, "feather", 10), notes);
        var t0 = Number(_mcpTemplateParam(p, "start", 0)), d = Number(_mcpTemplateParam(p, "duration", 1));
        var reveal = MCP.bool(_mcpTemplateParam(p, "reveal", true), true);
        _mcpKeyRamp(fx, "Transition Completion", comp, t0, reveal ? 100 : 0, t0 + d, reveal ? 0 : 100, _mcpTemplateParam(p, "easing", "ease"), notes);
        return [fx];
    }
};
MCP.effectTemplates["venetian-blinds"] = {
    description: "Venetian Blinds keyframed as a reveal transition.",
    params: { start: { "default": 0, description: "Seconds." }, duration: { "default": 1, description: "Seconds." }, width: { "default": 40, description: "Blind width in pixels." }, direction: { "default": 0, description: "Degrees." }, reveal: { "default": true, description: "true reveals, false hides." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Venetian Blinds"], "Venetian Blinds", notes);
        MCP.fx.setBy(fx, "Width", _mcpTemplateParam(p, "width", 40), notes);
        MCP.fx.setBy(fx, "Direction", _mcpTemplateParam(p, "direction", 0), notes);
        var t0 = Number(_mcpTemplateParam(p, "start", 0)), d = Number(_mcpTemplateParam(p, "duration", 1));
        var reveal = MCP.bool(_mcpTemplateParam(p, "reveal", true), true);
        _mcpKeyRamp(fx, "Transition Completion", comp, t0, reveal ? 100 : 0, t0 + d, reveal ? 0 : 100, "ease", notes);
        return [fx];
    }
};
MCP.effectTemplates["desaturate"] = {
    description: "Removes colour with Tint at full amount (black to white).",
    params: { amount: { "default": 100, description: "Percent." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Tint"], "Tint", notes);
        MCP.fx.setBy(fx, "Map Black To", [0, 0, 0, 1], notes);
        MCP.fx.setBy(fx, "Map White To", [1, 1, 1, 1], notes);
        MCP.fx.setBy(fx, "Amount to Tint", _mcpTemplateParam(p, "amount", 100), notes);
        return [fx];
    }
};
MCP.effectTemplates["tint"] = {
    description: "Two-colour Tint (map black and white to given colours).",
    params: { black: { "default": "#1B1F3B", description: "Colour for dark values." }, white: { "default": "#FFD27F", description: "Colour for light values." }, amount: { "default": 100, description: "Percent." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Tint"], "Tint", notes);
        MCP.fx.setBy(fx, "Map Black To", MCP.color.rgba(_mcpTemplateParam(p, "black", "#1B1F3B")), notes);
        MCP.fx.setBy(fx, "Map White To", MCP.color.rgba(_mcpTemplateParam(p, "white", "#FFD27F")), notes);
        MCP.fx.setBy(fx, "Amount to Tint", _mcpTemplateParam(p, "amount", 100), notes);
        return [fx];
    }
};
MCP.effectTemplates["lumetri-basic"] = {
    description: "Lumetri Color with basic correction values.",
    params: { exposure: { "default": 0, description: "Stops." }, contrast: { "default": 0, description: "-100 to 100." }, highlights: { "default": 0, description: "-100 to 100." }, shadows: { "default": 0, description: "-100 to 100." }, saturation: { "default": 100, description: "Percent." }, temperature: { "default": 0, description: "-100 to 100." }, tint: { "default": 0, description: "-100 to 100." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Lumetri"], "Lumetri Color", notes);
        MCP.fx.setBy(fx, "Exposure", _mcpTemplateParam(p, "exposure", 0), notes);
        MCP.fx.setBy(fx, "Contrast", _mcpTemplateParam(p, "contrast", 0), notes);
        MCP.fx.setBy(fx, "Highlights", _mcpTemplateParam(p, "highlights", 0), notes);
        MCP.fx.setBy(fx, "Shadows", _mcpTemplateParam(p, "shadows", 0), notes);
        MCP.fx.setBy(fx, "Saturation", _mcpTemplateParam(p, "saturation", 100), notes);
        MCP.fx.setBy(fx, "Temperature", _mcpTemplateParam(p, "temperature", 0), notes);
        MCP.fx.setBy(fx, "Tint", _mcpTemplateParam(p, "tint", 0), notes);
        return [fx];
    }
};
MCP.effectTemplates["gradient-ramp"] = {
    description: "Gradient Ramp between two colours across the layer.",
    params: { startColor: { "default": "#000000", description: "Colour at the start point." }, endColor: { "default": "#FFFFFF", description: "Colour at the end point." }, direction: { "default": "vertical", description: "vertical, horizontal or radial." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Ramp"], "Gradient Ramp", notes);
        var w = comp.width, h = comp.height;
        var dir = String(_mcpTemplateParam(p, "direction", "vertical"));
        var s = [w / 2, 0], e = [w / 2, h], shape = 1;
        if (dir === "horizontal") { s = [0, h / 2]; e = [w, h / 2]; }
        if (dir === "radial") { s = [w / 2, h / 2]; e = [w, h / 2]; shape = 2; }
        MCP.fx.setBy(fx, "Start of Ramp", s, notes);
        MCP.fx.setBy(fx, "End of Ramp", e, notes);
        MCP.fx.setBy(fx, "Start Color", MCP.color.rgba(_mcpTemplateParam(p, "startColor", "#000000")), notes);
        MCP.fx.setBy(fx, "End Color", MCP.color.rgba(_mcpTemplateParam(p, "endColor", "#FFFFFF")), notes);
        MCP.fx.setBy(fx, "Ramp Shape", shape, notes);
        return [fx];
    }
};
MCP.effectTemplates["4-color-gradient"] = {
    description: "4-Color Gradient with the four points pinned to the layer corners.",
    params: { color1: { "default": "#EC00C8", description: "Top-left." }, color2: { "default": "#7828FF", description: "Top-right." }, color3: { "default": "#00D1FF", description: "Bottom-left." }, color4: { "default": "#FFB800", description: "Bottom-right." }, blend: { "default": 100, description: "Percent." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE 4ColorGradient"], "4-Color Gradient", notes);
        var w = comp.width, h = comp.height;
        MCP.fx.setBy(fx, "Point 1", [0, 0], notes); MCP.fx.setBy(fx, "Color 1", MCP.color.rgba(_mcpTemplateParam(p, "color1", "#EC00C8")), notes);
        MCP.fx.setBy(fx, "Point 2", [w, 0], notes); MCP.fx.setBy(fx, "Color 2", MCP.color.rgba(_mcpTemplateParam(p, "color2", "#7828FF")), notes);
        MCP.fx.setBy(fx, "Point 3", [0, h], notes); MCP.fx.setBy(fx, "Color 3", MCP.color.rgba(_mcpTemplateParam(p, "color3", "#00D1FF")), notes);
        MCP.fx.setBy(fx, "Point 4", [w, h], notes); MCP.fx.setBy(fx, "Color 4", MCP.color.rgba(_mcpTemplateParam(p, "color4", "#FFB800")), notes);
        MCP.fx.setBy(fx, "Blend", _mcpTemplateParam(p, "blend", 100), notes);
        return [fx];
    }
};
MCP.effectTemplates["fractal-noise-texture"] = {
    description: "Fractal Noise with an evolving expression, for textures and backgrounds.",
    params: { contrast: { "default": 120, description: "Percent." }, brightness: { "default": -10, description: "-100 to 100." }, scale: { "default": 150, description: "Percent." }, speed: { "default": 40, description: "Evolution degrees per second." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Fractal Noise"], "Fractal Noise", notes);
        MCP.fx.setBy(fx, "Contrast", _mcpTemplateParam(p, "contrast", 120), notes);
        MCP.fx.setBy(fx, "Brightness", _mcpTemplateParam(p, "brightness", -10), notes);
        MCP.fx.setBy(fx, "Scale", _mcpTemplateParam(p, "scale", 150), notes);
        var ev = MCP.findProp(fx, "Evolution");
        if (ev) { ev.expression = "time * " + Number(_mcpTemplateParam(p, "speed", 40)); }
        return [fx];
    }
};
MCP.effectTemplates["turbulent-displace"] = {
    description: "Turbulent Displace with animated evolution for a wobbly, liquid look.",
    params: { amount: { "default": 30, description: "Pixels." }, size: { "default": 80, description: "Pixels." }, speed: { "default": 60, description: "Evolution degrees per second." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Turbulent Displace"], "Turbulent Displace", notes);
        MCP.fx.setBy(fx, "Amount", _mcpTemplateParam(p, "amount", 30), notes);
        MCP.fx.setBy(fx, "Size", _mcpTemplateParam(p, "size", 80), notes);
        var ev = MCP.findProp(fx, "Evolution");
        if (ev) { ev.expression = "time * " + Number(_mcpTemplateParam(p, "speed", 60)); }
        return [fx];
    }
};
MCP.effectTemplates["wave-warp"] = {
    description: "Wave Warp.",
    params: { height: { "default": 10, description: "Wave height in pixels." }, width: { "default": 40, description: "Wave width in pixels." }, speed: { "default": 1, description: "Wave speed." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["ADBE Wave Warp"], "Wave Warp", notes);
        MCP.fx.setBy(fx, "Wave Height", _mcpTemplateParam(p, "height", 10), notes);
        MCP.fx.setBy(fx, "Wave Width", _mcpTemplateParam(p, "width", 40), notes);
        MCP.fx.setBy(fx, "Wave Speed", _mcpTemplateParam(p, "speed", 1), notes);
        return [fx];
    }
};
MCP.effectTemplates["cc-light-sweep"] = {
    description: "CC Light Sweep with an animated direction, the classic shine across a logo.",
    params: { width: { "default": 60, description: "Sweep width in pixels." }, intensity: { "default": 60, description: "Sweep intensity." }, edgeIntensity: { "default": 40, description: "Edge intensity." }, speed: { "default": 50, description: "Direction degrees per second (0 for static)." } },
    build: function (layer, p, comp, notes) {
        var fx = _mcpAddFx(layer, ["CC Light Sweep"], "CC Light Sweep", notes);
        MCP.fx.setBy(fx, "Center", [comp.width / 2, comp.height / 2], notes);
        MCP.fx.setBy(fx, "Width", _mcpTemplateParam(p, "width", 60), notes);
        MCP.fx.setBy(fx, "Sweep Intensity", _mcpTemplateParam(p, "intensity", 60), notes);
        MCP.fx.setBy(fx, "Edge Intensity", _mcpTemplateParam(p, "edgeIntensity", 40), notes);
        var speed = Number(_mcpTemplateParam(p, "speed", 50));
        var dir = MCP.findProp(fx, "Direction");
        if (dir && speed) { dir.expression = "time * " + speed; }
        return [fx];
    }
};
MCP.effectTemplates["cinematic-look"] = {
    description: "Curves plus Vibrance for a subtle filmic grade.",
    params: { vibrance: { "default": 15, description: "-100 to 100." }, saturation: { "default": -5, description: "-100 to 100." } },
    build: function (layer, p, comp, notes) {
        var c = _mcpAddFx(layer, ["ADBE CurvesCustom"], "Curves", notes);
        var v = _mcpAddFx(layer, ["ADBE Vibrance"], "Vibrance", notes);
        MCP.fx.setBy(v, "Vibrance", _mcpTemplateParam(p, "vibrance", 15), notes);
        MCP.fx.setBy(v, "Saturation", _mcpTemplateParam(p, "saturation", -5), notes);
        return [c, v];
    }
};
MCP.effectTemplates["text-pop"] = {
    description: "Drop Shadow plus Glow so text stands off a busy background.",
    params: { shadowOpacity: { "default": 75, description: "Percent." }, glowRadius: { "default": 10, description: "Pixels." }, glowIntensity: { "default": 1.5, description: "Multiplier." } },
    build: function (layer, p, comp, notes) {
        var ds = _mcpDropShadow(layer, { opacity: _mcpTemplateParam(p, "shadowOpacity", 75) }, notes, { color: "#000000", opacity: 75, direction: 135, distance: 5, softness: 10 });
        var g = _mcpAddFx(layer, ["ADBE Glo2"], "Glow", notes);
        MCP.fx.setBy(g, "Glow Threshold", 50, notes);
        MCP.fx.setBy(g, "Glow Radius", _mcpTemplateParam(p, "glowRadius", 10), notes);
        MCP.fx.setBy(g, "Glow Intensity", _mcpTemplateParam(p, "glowIntensity", 1.5), notes);
        return [ds, g];
    }
};

MCP.register("listEffectTemplates", function () {
    var out = [];
    var names = MCP.keys(MCP.effectTemplates);
    names.sort();
    for (var i = 0; i < names.length; i++) {
        var t = MCP.effectTemplates[names[i]];
        var params = [];
        for (var k in t.params) {
            if (Object.prototype.hasOwnProperty.call(t.params, k)) { params.push({ name: k, defaultValue: t.params[k]["default"], description: t.params[k].description }); }
        }
        out.push({ name: names[i], description: t.description, params: params });
    }
    return { count: out.length, templates: out };
}, { mutating: false });

MCP.register("applyEffectTemplate", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var name = String(MCP.requireArg(args, "template"));
    var t = MCP.effectTemplates[name];
    if (!t) { MCP.fail("Unknown effect template '" + name + "'. Available: " + MCP.keys(MCP.effectTemplates).sort().join(", "), "not-found"); }
    var params = args.params || {};
    for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k) && !Object.prototype.hasOwnProperty.call(t.params, k)) {
            MCP.fail("Template '" + name + "' has no parameter '" + k + "'. Parameters: " + MCP.keys(t.params).join(", ") || "(none)", "invalid-argument");
        }
    }
    var notes = [];
    var effects = t.build(r.layer, params, r.comp, notes);
    var summaries = [];
    for (var i = 0; i < effects.length; i++) {
        summaries.push(_mcpTry(function () { return MCP.serialize.effect(effects[i], { properties: false }); }, { name: effects[i].name }));
    }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), template: name, effects: summaries, notes: notes };
}, { mutating: true });
