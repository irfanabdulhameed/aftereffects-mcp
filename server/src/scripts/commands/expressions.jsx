/*
 * Expression commands.
 */

MCP.expressionResult = function (layer, prop) {
    var info = {
        hasExpression: _mcpTry(function () { return prop.expression !== ""; }, false),
        expression: _mcpTry(function () { return prop.expression; }, ""),
        enabled: _mcpTry(function () { return prop.expressionEnabled; }, null),
        error: _mcpTry(function () { return prop.expressionError || ""; }, "")
    };
    return MCP.serialize.propertyResult(layer, prop, { expressionState: info });
};

MCP.register("setExpression", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var expr = MCP.requireArg(args, "expression");
    if (!prop.canSetExpression) { MCP.fail("Property '" + MCP.pathOf(prop).path + "' does not accept expressions.", "unsupported"); }
    prop.expression = String(expr);
    if (MCP.isDefined(args.enabled)) { try { prop.expressionEnabled = MCP.bool(args.enabled, true); } catch (e) {} }
    var out = MCP.expressionResult(r.layer, prop);
    if (out.expressionState.error) {
        out.warning = "The expression was set but After Effects reports an error: " + out.expressionState.error;
    }
    return out;
}, { mutating: true });

MCP.register("getExpression", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    return MCP.expressionResult(r.layer, prop);
}, { mutating: false });

MCP.register("removeExpression", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    if (prop.canSetExpression) { prop.expression = ""; }
    return MCP.expressionResult(r.layer, prop);
}, { mutating: true });

MCP.register("setExpressionEnabled", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    if (!prop.canSetExpression || prop.expression === "") { MCP.fail("Property '" + MCP.pathOf(prop).path + "' has no expression.", "not-found"); }
    prop.expressionEnabled = MCP.bool(args.enabled, true);
    return MCP.expressionResult(r.layer, prop);
}, { mutating: true });

/* ------------------------------------------------------- error scanning */

MCP.expr = {};

/** Depth-first walk over leaf properties under root, calling cb(prop). Depth is capped so shape trees stay cheap. */
MCP.expr.walk = function (root, depth, maxDepth, cb) {
    var n = 0;
    try { n = root.numProperties; } catch (e) { return; }
    if (depth > maxDepth) { return; }
    for (var i = 1; i <= n; i++) {
        var p = null;
        try { p = root.property(i); } catch (e2) { continue; }
        if (!p) { continue; }
        if (MCP.isGroup(p)) { MCP.expr.walk(p, depth + 1, maxDepth, cb); }
        else { cb(p); }
    }
};

/** Collects expression errors on one layer into out. Returns how many properties carry expressions. */
MCP.expr.scanLayer = function (comp, layer, out, limit) {
    var withExpression = 0;
    MCP.expr.walk(layer, 0, 8, function (p) {
        var expr = _mcpTry(function () { return p.canSetExpression ? p.expression : ""; }, "");
        if (!expr) { return; }
        withExpression++;
        var err = _mcpTry(function () { return p.expressionError || ""; }, "");
        if (!err || out.length >= limit) { return; }
        out.push({
            comp: MCP.serialize.compRef(comp),
            layer: MCP.serialize.layerRef(layer),
            path: MCP.pathOf(p).path,
            matchPath: MCP.pathOf(p).matchPath,
            enabled: _mcpTry(function () { return p.expressionEnabled; }, null),
            expression: String(expr).substr(0, 200),
            error: String(err)
        });
    });
    return withExpression;
};

MCP.register("getExpressionErrors", function (args) {
    var scope = String(MCP.arg(args, "scope", "comp")).toLowerCase();
    var limit = Math.max(1, Math.round(MCP.num(args.limit, 500)));
    var errors = [];
    var comps = [], layersScanned = 0, propsWithExpressions = 0, i, j;
    if (scope === "layer") {
        var r = MCP.resolveCompAndLayer(args);
        comps.push(MCP.serialize.compRef(r.comp));
        layersScanned = 1;
        propsWithExpressions += MCP.expr.scanLayer(r.comp, r.layer, errors, limit);
    } else if (scope === "comp") {
        var comp = MCP.resolveComp(args.comp);
        comps.push(MCP.serialize.compRef(comp));
        for (i = 1; i <= comp.numLayers; i++) {
            layersScanned++;
            propsWithExpressions += MCP.expr.scanLayer(comp, comp.layer(i), errors, limit);
        }
    } else if (scope === "project") {
        for (i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (!(item instanceof CompItem)) { continue; }
            comps.push(MCP.serialize.compRef(item));
            for (j = 1; j <= item.numLayers; j++) {
                layersScanned++;
                propsWithExpressions += MCP.expr.scanLayer(item, item.layer(j), errors, limit);
            }
        }
    } else {
        MCP.fail("scope must be layer, comp or project.", "invalid-argument");
    }
    return {
        scope: scope,
        compositions: comps,
        layersScanned: layersScanned,
        propertiesWithExpressions: propsWithExpressions,
        errorCount: errors.length,
        truncated: errors.length >= limit,
        errors: errors
    };
}, { mutating: false });

/* -------------------------------------------------------------- presets */

/**
 * Built-in expression library. Each preset:
 *   { description, suits: [property hints], params: { name: { "default", description } },
 *     build: function (p, ctx) -> expression source }
 * ctx = { dims, isSpatial, valueType, propName, matchPath, layerName } (dims 0 when unknown).
 * Generated code targets the JavaScript expression engine and also runs on the legacy engine
 * (no arrow functions, no let or const, no template strings).
 */
MCP.expr.presets = {};

MCP.expr.num = function (v) {
    var n = Number(v);
    if (isNaN(n)) { return "0"; }
    return String(MCP.round(n, 6));
};

MCP.expr.str = function (v) {
    return JSON.stringify(String(MCP.isDefined(v) ? v : ""));
};

/** Array of dims copies of expr, as source text, or expr itself for 1D. */
MCP.expr.vec = function (dims, expr) {
    if (!dims || dims <= 1) { return expr; }
    var parts = [];
    for (var i = 0; i < dims; i++) { parts.push(expr); }
    return "[" + parts.join(", ") + "]";
};

/** Adds off to one axis (default y for 2D and 3D) of value, as source text. */
MCP.expr.addOnAxis = function (dims, axis, offName) {
    if (!dims || dims <= 1) { return "value + " + offName; }
    var a = String(axis || "y").toLowerCase();
    var parts = [];
    for (var i = 0; i < dims; i++) {
        var name = ["x", "y", "z"][i];
        parts.push(a === "all" || a === name ? "value[" + i + "] + " + offName : "value[" + i + "]");
    }
    return "[" + parts.join(", ") + "]";
};

/** Expression-language reference to the same property on another layer. */
MCP.expr.propertyRef = function (layerExpr, ctx) {
    var known = {
        "ADBE Transform Group/ADBE Position": "transform.position",
        "ADBE Transform Group/ADBE Anchor Point": "transform.anchorPoint",
        "ADBE Transform Group/ADBE Scale": "transform.scale",
        "ADBE Transform Group/ADBE Rotate Z": "transform.rotation",
        "ADBE Transform Group/ADBE Opacity": "transform.opacity",
        "ADBE Transform Group/ADBE Position_0": "transform.xPosition",
        "ADBE Transform Group/ADBE Position_1": "transform.yPosition",
        "ADBE Transform Group/ADBE Position_2": "transform.zPosition"
    };
    var mp = ctx.matchPath || "";
    if (known[mp]) { return layerExpr + "." + known[mp]; }
    if (!mp) { return layerExpr + ".transform.position"; }
    var parts = mp.split("/");
    var out = layerExpr;
    for (var i = 0; i < parts.length; i++) { out += "(" + JSON.stringify(parts[i]) + ")"; }
    return out;
};

MCP.expr.header = function (name, p) {
    var bits = [];
    for (var k in p) {
        if (Object.prototype.hasOwnProperty.call(p, k) && MCP.isDefined(p[k])) {
            bits.push(k + "=" + (typeof p[k] === "string" ? JSON.stringify(p[k]) : JSON.stringify(p[k])));
        }
    }
    return "// MCP preset: " + name + (bits.length ? " (" + bits.join(", ") + ")" : "");
};

/** The classic inertia family: velocity at the last key drives a decaying sine after it. */
MCP.expr.inertiaCode = function (p) {
    return [
        "var amp = " + MCP.expr.num(p.amplitude) + ", freq = " + MCP.expr.num(p.frequency) + ", decay = " + MCP.expr.num(p.decay) + ";",
        "var n = 0;",
        "if (numKeys > 0) {",
        "  n = nearestKey(time).index;",
        "  if (key(n).time > time) { n--; }",
        "}",
        "var t = (n === 0) ? 0 : time - key(n).time;",
        "if (n > 0 && t < 1) {",
        "  // velocity just before the last key drives the bounce",
        "  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);",
        "  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);",
        "} else {",
        "  value;",
        "}"
    ].join("\n");
};

MCP.expr.presets["wiggle"] = {
    description: "Random organic motion around the keyframed or static value.",
    suits: ["Position", "Rotation", "Scale", "Opacity", "any numeric property"],
    params: {
        frequency: { "default": 2, description: "Wiggles per second." },
        amplitude: { "default": 10, description: "Maximum deviation in the property's units." },
        octaves: { "default": 1, description: "Layers of detail; 1 is smooth, 3 adds finer jitter." },
        ampMult: { "default": 0.5, description: "Amplitude multiplier per octave." },
        startTime: { "default": null, description: "Seconds; before this time the value is untouched. Omit to wiggle from the start." },
        ramp: { "default": 0, description: "Seconds to blend the wiggle in after startTime (0 for an instant start)." }
    },
    build: function (p) {
        var lines = ["var freq = " + MCP.expr.num(p.frequency) + ", amp = " + MCP.expr.num(p.amplitude) + ", octaves = " + MCP.expr.num(p.octaves) + ", ampMult = " + MCP.expr.num(p.ampMult) + ";"];
        if (MCP.isDefined(p.startTime)) {
            lines.push("var startTime = " + MCP.expr.num(p.startTime) + ", ramp = " + MCP.expr.num(p.ramp) + ";");
            lines.push("if (time < startTime) {");
            lines.push("  value;");
            lines.push("} else {");
            lines.push("  // blend from the plain value into the wiggle over ramp seconds");
            lines.push("  var k = ramp > 0 ? linear(time, startTime, startTime + ramp, 0, 1) : 1;");
            lines.push("  var w = wiggle(freq, amp, octaves, ampMult);");
            lines.push("  value + (w - value) * k;");
            lines.push("}");
        } else {
            lines.push("wiggle(freq, amp, octaves, ampMult);");
        }
        return lines.join("\n");
    }
};

MCP.expr.presets["loop-out-cycle"] = {
    description: "Repeats the keyframed motion forever after the last key (loopOut cycle).",
    suits: ["any keyframed property"],
    params: { numKeyframes: { "default": 0, description: "How many keys from the end form the loop; 0 means all of them." } },
    build: function (p) { return "loopOut(\"cycle\", " + MCP.expr.num(p.numKeyframes) + ");"; }
};

MCP.expr.presets["loop-out-pingpong"] = {
    description: "Plays the keyframed motion forwards then backwards, forever, after the last key.",
    suits: ["any keyframed property"],
    params: { numKeyframes: { "default": 0, description: "How many keys from the end form the loop; 0 means all of them." } },
    build: function (p) { return "loopOut(\"pingpong\", " + MCP.expr.num(p.numKeyframes) + ");"; }
};

MCP.expr.presets["loop-out-offset"] = {
    description: "Repeats the motion after the last key, each cycle continuing from where the previous one ended (a rotation that keeps turning, a walk that keeps moving).",
    suits: ["Rotation", "Position", "any keyframed property"],
    params: { numKeyframes: { "default": 0, description: "How many keys from the end form the loop; 0 means all of them." } },
    build: function (p) { return "loopOut(\"offset\", " + MCP.expr.num(p.numKeyframes) + ");"; }
};

MCP.expr.presets["loop-in"] = {
    description: "Loops the keyframed motion before the first key (loopIn).",
    suits: ["any keyframed property"],
    params: {
        type: { "default": "cycle", description: "cycle, pingpong, offset or continue." },
        numKeyframes: { "default": 0, description: "How many keys from the start form the loop; 0 means all of them." }
    },
    build: function (p) {
        var type = String(p.type || "cycle").toLowerCase();
        if (type !== "cycle" && type !== "pingpong" && type !== "offset" && type !== "continue") {
            MCP.fail("loop-in type must be cycle, pingpong, offset or continue.", "invalid-argument");
        }
        return "loopIn(" + JSON.stringify(type) + ", " + MCP.expr.num(p.numKeyframes) + ");";
    }
};

MCP.expr.presets["inertia-bounce"] = {
    description: "The classic inertial bounce: after the last keyframe the value overshoots and settles based on its incoming speed.",
    suits: ["Position", "Scale", "Rotation", "any keyframed numeric property"],
    params: {
        amplitude: { "default": 0.06, description: "Bounce size as a fraction of the incoming speed." },
        frequency: { "default": 2, description: "Bounces per second." },
        decay: { "default": 4, description: "How fast the bounce dies out; higher settles sooner." }
    },
    build: function (p) { return MCP.expr.inertiaCode(p); }
};

MCP.expr.presets["overshoot"] = {
    description: "A quick overshoot past the last keyframe that settles fast (inertia family with a faster, tighter curve).",
    suits: ["Scale", "Position", "Rotation"],
    params: {
        amplitude: { "default": 0.08, description: "Overshoot size as a fraction of the incoming speed." },
        frequency: { "default": 3, description: "Oscillations per second." },
        decay: { "default": 5, description: "How fast it settles." }
    },
    build: function (p) { return MCP.expr.inertiaCode(p); }
};

MCP.expr.presets["elastic"] = {
    description: "Elastic settle after the last keyframe, scaled by the size of the last move rather than its speed.",
    suits: ["Scale", "Position", "Rotation"],
    params: {
        amplitude: { "default": 0.15, description: "Wobble size as a fraction of the last key-to-key change." },
        frequency: { "default": 2.5, description: "Wobbles per second." },
        decay: { "default": 3, description: "How fast the wobble dies out." }
    },
    build: function (p) {
        return [
            "var amp = " + MCP.expr.num(p.amplitude) + ", freq = " + MCP.expr.num(p.frequency) + ", decay = " + MCP.expr.num(p.decay) + ";",
            "var n = 0;",
            "if (numKeys > 0) {",
            "  n = nearestKey(time).index;",
            "  if (key(n).time > time) { n--; }",
            "}",
            "if (n > 1) {",
            "  var t = time - key(n).time;",
            "  // the size of the last move sets the wobble size",
            "  var delta = key(n).value - key(n - 1).value;",
            "  value + delta * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);",
            "} else {",
            "  value;",
            "}"
        ].join("\n");
    }
};

MCP.expr.presets["time-offset-by-index"] = {
    description: "Delays this property's own animation by the layer index, so duplicated layers cascade.",
    suits: ["any keyframed property on duplicated layers"],
    params: {
        delay: { "default": 0.1, description: "Seconds of delay per layer index step." },
        referenceLayer: { "default": null, description: "Layer name whose animation is copied; the delay is measured from that layer's index. Omit to delay this layer's own keys by (index - 1)." }
    },
    build: function (p, ctx) {
        var lines = ["var delay = " + MCP.expr.num(p.delay) + ";"];
        if (MCP.isDefined(p.referenceLayer) && String(p.referenceLayer) !== "") {
            lines.push("var ref = thisComp.layer(" + MCP.expr.str(p.referenceLayer) + ");");
            lines.push("// layers further from the reference lag further behind it");
            lines.push("var steps = Math.abs(index - ref.index);");
            lines.push(MCP.expr.propertyRef("ref", ctx) + ".valueAtTime(time - steps * delay);");
        } else {
            lines.push("// layer 1 plays on time, layer 2 one delay later, and so on");
            lines.push("valueAtTime(time - (index - 1) * delay);");
        }
        return lines.join("\n");
    }
};

MCP.expr.presets["follow-layer-with-delay"] = {
    description: "Copies the same property from another layer with a time delay (a trailing follower).",
    suits: ["Position", "Rotation", "Scale", "Opacity"],
    params: {
        layerName: { "default": null, description: "Name of the layer to follow. Required." },
        delay: { "default": 0.1, description: "Seconds behind the leader." }
    },
    build: function (p, ctx) {
        if (!MCP.isDefined(p.layerName) || String(p.layerName) === "") { MCP.fail("follow-layer-with-delay needs params.layerName (the layer to follow).", "invalid-argument"); }
        return [
            "var delay = " + MCP.expr.num(p.delay) + ";",
            "var leader = thisComp.layer(" + MCP.expr.str(p.layerName) + ");",
            MCP.expr.propertyRef("leader", ctx) + ".valueAtTime(time - delay);"
        ].join("\n");
    }
};

MCP.expr.presets["bounce-on-landing"] = {
    description: "After the last keyframe the layer bounces upward a few times with decreasing height, like something landing on the floor.",
    suits: ["Position", "Y Position"],
    params: {
        height: { "default": 50, description: "Height of the first bounce in pixels." },
        bounces: { "default": 3, description: "Number of bounces." },
        decay: { "default": 0.5, description: "Height multiplier per bounce (0.5 halves each time)." },
        bounceDuration: { "default": 0.4, description: "Seconds the first bounce lasts; later bounces get shorter with decay." }
    },
    build: function (p, ctx) {
        var apply;
        if (!ctx.dims || ctx.dims <= 1) { apply = "value - off;"; }
        else if (ctx.dims === 2) { apply = "[value[0], value[1] - off];"; }
        else { apply = "[value[0], value[1] - off, value[2]];"; }
        return [
            "var height = " + MCP.expr.num(p.height) + ", bounces = " + MCP.expr.num(p.bounces) + ", decay = " + MCP.expr.num(p.decay) + ", dur = " + MCP.expr.num(p.bounceDuration) + ";",
            "var n = 0;",
            "if (numKeys > 0) {",
            "  n = nearestKey(time).index;",
            "  if (key(n).time > time) { n--; }",
            "}",
            "var off = 0;",
            "if (n > 0) {",
            "  var t = time - key(n).time;",
            "  var h = height, d = dur, tStart = 0;",
            "  // walk through the bounces until we find the one that contains t",
            "  for (var i = 0; i < bounces; i++) {",
            "    if (t >= tStart && t < tStart + d) {",
            "      off = h * Math.sin(Math.PI * (t - tStart) / d);",
            "      break;",
            "    }",
            "    tStart += d;",
            "    h *= decay;",
            "    d *= Math.sqrt(decay);",
            "  }",
            "}",
            "// upward is negative y in After Effects",
            apply
        ].join("\n");
    }
};

MCP.expr.presets["auto-fade-in-out"] = {
    description: "Fades the layer in after its in point and out before its out point, with no keyframes to move when the layer is retimed.",
    suits: ["Opacity"],
    params: {
        fadeIn: { "default": 0.5, description: "Seconds of fade in from the in point." },
        fadeOut: { "default": 0.5, description: "Seconds of fade out ending at the out point." }
    },
    build: function (p) {
        return [
            "var fadeIn = " + MCP.expr.num(p.fadeIn) + ", fadeOut = " + MCP.expr.num(p.fadeOut) + ";",
            "var up = fadeIn > 0 ? linear(time, inPoint, inPoint + fadeIn, 0, 1) : 1;",
            "var down = fadeOut > 0 ? linear(time, outPoint - fadeOut, outPoint, 1, 0) : 1;",
            "value * Math.min(up, down);"
        ].join("\n");
    }
};

MCP.expr.presets["scale-to-fit-text-box"] = {
    description: "Shrinks Scale so the layer's rendered width never exceeds a maximum, keeping the keyframed or static scale otherwise.",
    suits: ["Scale on text layers"],
    params: { maxWidth: { "default": 800, description: "Maximum width in composition pixels." } },
    build: function (p, ctx) {
        var out = ctx.dims === 3 ? "[value[0] * f, value[1] * f, value[2] * f];" : "[value[0] * f, value[1] * f];";
        return [
            "var maxWidth = " + MCP.expr.num(p.maxWidth) + ";",
            "var w = thisLayer.sourceRectAtTime(time, false).width;",
            "// f is 1 while the text fits, otherwise the shrink factor",
            "var f = (w > 0 && w > maxWidth) ? maxWidth / w : 1;",
            out
        ].join("\n");
    }
};

MCP.expr.presets["counter-number"] = {
    description: "Animates a number counting from one value to another as text, with formatting.",
    suits: ["Source Text"],
    params: {
        from: { "default": 0, description: "Start value." },
        to: { "default": 100, description: "End value." },
        start: { "default": 0, description: "Seconds when counting starts." },
        duration: { "default": 2, description: "Seconds the count takes." },
        decimals: { "default": 0, description: "Decimal places shown." },
        prefix: { "default": "", description: "Text before the number, for example \"$\"." },
        suffix: { "default": "", description: "Text after the number, for example \"%\"." },
        thousandsSeparator: { "default": false, description: "Insert commas every three digits." }
    },
    build: function (p) {
        return [
            "var from = " + MCP.expr.num(p.from) + ", to = " + MCP.expr.num(p.to) + ", start = " + MCP.expr.num(p.start) + ", duration = " + MCP.expr.num(p.duration) + ";",
            "var decimals = " + MCP.expr.num(p.decimals) + ", prefix = " + MCP.expr.str(p.prefix) + ", suffix = " + MCP.expr.str(p.suffix) + ", separator = " + (MCP.bool(p.thousandsSeparator, false) ? "true" : "false") + ";",
            "var n = duration > 0 ? linear(time, start, start + duration, from, to) : to;",
            "var s = n.toFixed(decimals);",
            "if (separator) {",
            "  var parts = s.split(\".\");",
            "  var whole = parts[0], neg = whole.charAt(0) === \"-\";",
            "  if (neg) { whole = whole.substr(1); }",
            "  var grouped = \"\";",
            "  while (whole.length > 3) {",
            "    grouped = \",\" + whole.substr(whole.length - 3) + grouped;",
            "    whole = whole.substr(0, whole.length - 3);",
            "  }",
            "  s = (neg ? \"-\" : \"\") + whole + grouped + (parts.length > 1 ? \".\" + parts[1] : \"\");",
            "}",
            "prefix + s + suffix;"
        ].join("\n");
    }
};

MCP.expr.presets["typewriter-driver"] = {
    description: "Reveals the layer's own text one character at a time from a start time.",
    suits: ["Source Text"],
    params: {
        charactersPerSecond: { "default": 15, description: "Typing speed." },
        start: { "default": 0, description: "Seconds when typing starts." }
    },
    build: function (p) {
        return [
            "var cps = " + MCP.expr.num(p.charactersPerSecond) + ", start = " + MCP.expr.num(p.start) + ";",
            "var txt = String(value);",
            "var shown = Math.floor(Math.max(0, time - start) * cps);",
            "txt.substr(0, Math.min(shown, txt.length));"
        ].join("\n");
    }
};

MCP.expr.presets["sine-wave"] = {
    description: "Adds a smooth oscillation to the value (a float, a sway, a pulse).",
    suits: ["Position", "Rotation", "Scale", "Opacity", "any numeric property"],
    params: {
        amplitude: { "default": 20, description: "Peak offset in the property's units." },
        frequency: { "default": 1, description: "Cycles per second." },
        phase: { "default": 0, description: "Phase offset in degrees." },
        axis: { "default": "y", description: "For 2D and 3D properties: x, y, z or all. Ignored for 1D." }
    },
    build: function (p, ctx) {
        return [
            "var amp = " + MCP.expr.num(p.amplitude) + ", freq = " + MCP.expr.num(p.frequency) + ", phase = " + MCP.expr.num(p.phase) + ";",
            "var off = amp * Math.sin(2 * Math.PI * freq * time + phase * Math.PI / 180);",
            MCP.expr.addOnAxis(ctx.dims, p.axis, "off") + ";"
        ].join("\n");
    }
};

MCP.expr.presets["random-hold"] = {
    description: "Jumps to a new random value every few frames and holds it (flicker, glitch, jitter).",
    suits: ["Opacity", "Position", "Rotation", "any numeric property"],
    params: {
        min: { "default": 0, description: "Lowest value." },
        max: { "default": 100, description: "Highest value." },
        holdFrames: { "default": 6, description: "Frames each random value is held for." },
        seed: { "default": 1, description: "Random seed; change it for a different sequence." }
    },
    build: function (p, ctx) {
        return [
            "var lo = " + MCP.expr.num(p.min) + ", hi = " + MCP.expr.num(p.max) + ", holdFrames = " + MCP.expr.num(p.holdFrames) + ", seed = " + MCP.expr.num(p.seed) + ";",
            "// quantise time so the value only changes every holdFrames frames",
            "posterizeTime(1 / (Math.max(1, holdFrames) * thisComp.frameDuration));",
            "seedRandom(seed, false);",
            MCP.expr.vec(ctx.dims, "random(lo, hi)") + ";"
        ].join("\n");
    }
};

MCP.expr.presets["clamp-value"] = {
    description: "Keeps the value inside a minimum and maximum, whatever keyframes or other expressions produce.",
    suits: ["any numeric property"],
    params: {
        min: { "default": 0, description: "Lower limit." },
        max: { "default": 100, description: "Upper limit." }
    },
    build: function (p) {
        return "clamp(value, " + MCP.expr.num(p.min) + ", " + MCP.expr.num(p.max) + ");";
    }
};

MCP.expr.presets["link-to-slider"] = {
    description: "Drives the property from a Slider Control effect, optionally on another layer and scaled.",
    suits: ["any numeric property"],
    params: {
        sliderLayer: { "default": null, description: "Layer name carrying the slider. Omit for this layer." },
        controlName: { "default": "Slider Control", description: "Effect name of the slider (add-expression-control sets it)." },
        multiplier: { "default": 1, description: "Slider value is multiplied by this." }
    },
    build: function (p, ctx) {
        var host = (MCP.isDefined(p.sliderLayer) && String(p.sliderLayer) !== "") ? "thisComp.layer(" + MCP.expr.str(p.sliderLayer) + ")" : "thisLayer";
        return [
            "var s = " + host + ".effect(" + MCP.expr.str(MCP.isDefined(p.controlName) ? p.controlName : "Slider Control") + ")(\"Slider\") * " + MCP.expr.num(p.multiplier) + ";",
            MCP.expr.vec(ctx.dims, "s") + ";"
        ].join("\n");
    }
};

MCP.expr.presets["link-to-checkbox"] = {
    description: "Switches the property between two values with a Checkbox Control effect.",
    suits: ["Opacity", "any property"],
    params: {
        controlName: { "default": "Checkbox Control", description: "Effect name of the checkbox." },
        onValue: { "default": 100, description: "Value when checked (a number or an array for 2D and 3D)." },
        offValue: { "default": 0, description: "Value when unchecked." },
        checkboxLayer: { "default": null, description: "Layer name carrying the checkbox. Omit for this layer." }
    },
    build: function (p) {
        var host = (MCP.isDefined(p.checkboxLayer) && String(p.checkboxLayer) !== "") ? "thisComp.layer(" + MCP.expr.str(p.checkboxLayer) + ")" : "thisLayer";
        return [
            "var on = " + JSON.stringify(MCP.isDefined(p.onValue) ? p.onValue : 100) + ", off = " + JSON.stringify(MCP.isDefined(p.offValue) ? p.offValue : 0) + ";",
            "var checked = " + host + ".effect(" + MCP.expr.str(MCP.isDefined(p.controlName) ? p.controlName : "Checkbox Control") + ")(\"Checkbox\") == 1;",
            "checked ? on : off;"
        ].join("\n");
    }
};

MCP.expr.presets["posterize-time"] = {
    description: "Makes the property update only a few times per second (stop-motion, stepped motion).",
    suits: ["any property"],
    params: { fps: { "default": 12, description: "Updates per second." } },
    build: function (p) {
        return "posterizeTime(" + MCP.expr.num(p.fps) + ");\nvalue;";
    }
};

MCP.expr.presetNames = function () {
    var names = MCP.keys(MCP.expr.presets);
    names.sort();
    return names;
};

MCP.expr.describePreset = function (name) {
    var def = MCP.expr.presets[name];
    var params = [];
    for (var k in def.params) {
        if (Object.prototype.hasOwnProperty.call(def.params, k)) {
            params.push({ name: k, defaultValue: def.params[k]["default"], description: def.params[k].description });
        }
    }
    return { name: name, description: def.description, suits: def.suits, params: params };
};

/** Fills defaults, then builds the expression source for a preset. */
MCP.expr.build = function (name, params, ctx) {
    var def = MCP.expr.presets[name];
    if (!def) { MCP.fail("Unknown expression preset '" + name + "'. Available: " + MCP.expr.presetNames().join(", "), "not-found"); }
    var p = {};
    for (var k in def.params) {
        if (Object.prototype.hasOwnProperty.call(def.params, k)) {
            p[k] = (params && MCP.isDefined(params[k])) ? params[k] : def.params[k]["default"];
        }
    }
    var code = def.build(p, ctx || { dims: 0 });
    return { params: p, code: MCP.expr.header(name, p) + "\n" + code };
};

MCP.register("listExpressionPresets", function () {
    var names = MCP.expr.presetNames();
    var out = [];
    for (var i = 0; i < names.length; i++) { out.push(MCP.expr.describePreset(names[i])); }
    return { count: out.length, presets: out };
}, { mutating: false });

MCP.register("applyExpressionPreset", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var name = String(MCP.requireArg(args, "preset")).toLowerCase();
    if (!prop.canSetExpression) { MCP.fail("Property '" + MCP.pathOf(prop).path + "' does not accept expressions.", "unsupported"); }
    var v = _mcpTry(function () { return prop.value; }, null);
    var ctx = {
        dims: MCP.isArray(v) ? v.length : (typeof v === "number" ? 1 : 0),
        isSpatial: _mcpTry(function () { return !!prop.isSpatial; }, false),
        valueType: MCP.serialize.valueTypeName(prop),
        propName: prop.name,
        matchPath: MCP.pathOf(prop).matchPath,
        layerName: r.layer.name
    };
    var built = MCP.expr.build(name, args.params || {}, ctx);
    prop.expression = built.code;
    if (MCP.isDefined(args.enabled)) { try { prop.expressionEnabled = MCP.bool(args.enabled, true); } catch (e) {} }
    var out = MCP.expressionResult(r.layer, prop);
    out.preset = name;
    out.params = built.params;
    out.code = built.code;
    if (out.expressionState.error) {
        out.warning = "The preset was applied but After Effects reports an error: " + out.expressionState.error;
    }
    return out;
}, { mutating: true });

/* --------------------------------------------------- expression controls */

MCP.expr.CONTROLS = {
    "slider":   { matchName: "ADBE Slider Control",   prop: "Slider",   defaultName: "Slider Control" },
    "checkbox": { matchName: "ADBE Checkbox Control", prop: "Checkbox", defaultName: "Checkbox Control" },
    "color":    { matchName: "ADBE Color Control",    prop: "Color",    defaultName: "Color Control" },
    "point":    { matchName: "ADBE Point Control",    prop: "Point",    defaultName: "Point Control" },
    "angle":    { matchName: "ADBE Angle Control",    prop: "Angle",    defaultName: "Angle Control" },
    "dropdown": { matchName: "ADBE Dropdown Control", prop: "Menu",     defaultName: "Dropdown Menu Control" },
    "layer":    { matchName: "ADBE Layer Control",    prop: "Layer",    defaultName: "Layer Control" }
};

MCP.register("addExpressionControl", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var type = String(MCP.requireArg(args, "type")).toLowerCase();
    var def = MCP.expr.CONTROLS[type];
    if (!def) { MCP.fail("type must be one of: " + MCP.keys(MCP.expr.CONTROLS).join(", "), "invalid-argument"); }
    var res = MCP.fx.addFirstAvailable(r.layer, [def.matchName]);
    if (!res) { MCP.fail("Cannot add '" + def.matchName + "' to layer '" + r.layer.name + "' (this layer type may not take effects, or the control is missing from this install).", "unsupported"); }
    var fx = res.effect;
    var name = MCP.isDefined(args.name) && String(args.name) !== "" ? String(args.name) : def.defaultName;
    fx.name = name;
    var prop = fx.property(1);
    var notes = [];
    if (type === "dropdown" && MCP.isArray(args.items) && args.items.length) {
        var items = [];
        for (var i = 0; i < args.items.length; i++) { items.push(String(args.items[i])); }
        var ok = false;
        try { prop.setPropertyParameters(items); ok = true; } catch (e1) { ok = false; }
        if (!ok) { notes.push("Dropdown items could not be set (needs After Effects 2023 or later); the menu keeps its default items."); }
    }
    if (MCP.isDefined(args.value)) {
        var value = args.value;
        try {
            if (type === "color") { value = MCP.color.rgba(value); }
            else if (type === "layer") { value = (value && typeof value === "object") ? MCP.resolveLayer(r.comp, value).index : Number(value); }
            else if (type === "checkbox") { value = MCP.bool(value, false) ? 1 : 0; }
            else if (type === "point") { value = MCP.coerceValue(prop, value); }
            else { value = Number(value); }
            prop.setValue(value);
        } catch (e2) {
            notes.push("Initial value could not be set: " + (e2 && e2.message ? e2.message : String(e2)));
        }
    }
    var path = "Effects/" + name + "/" + prop.name;
    return {
        composition: MCP.serialize.compRef(r.comp),
        layer: MCP.serialize.layerRef(r.layer),
        effect: MCP.serialize.effect(fx, { properties: true, depth: 1 }),
        control: { type: type, name: name, matchName: def.matchName },
        propertyPath: path,
        matchPath: MCP.pathOf(prop).matchPath,
        expression: "effect(" + JSON.stringify(name) + ")(" + JSON.stringify(prop.name) + ")",
        value: MCP.serialize.value(prop),
        notes: notes
    };
}, { mutating: true });
