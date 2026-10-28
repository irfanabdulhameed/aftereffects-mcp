/*
 * Looks and backgrounds: named effect stacks with proven values (a tight plus
 * a wide glow, bloom, mono grain, vignette, a light sweep, frosted glass,
 * motion blur) and generated backgrounds (mesh gradient, aurora, grid, dots,
 * noise, grain) that loop seamlessly over a loop length.
 *
 * Effect parameters are set by match name in the units the effect stores
 * (Glow Threshold 0 to 255, Noise Type 0 = mono).
 */

MCP.looks = {};

/** Adds an effect, names it, sets its parameters by match name; returns the effect (fetched again after addProperty). */
MCP.looks.fx = function (layer, matchName, name, values, expressions) {
    var parade = layer.property("ADBE Effect Parade");
    if (!parade.canAddProperty(matchName)) { MCP.fail("The effect '" + matchName + "' is not available in this After Effects.", "unsupported"); }
    var fx = parade.addProperty(matchName);
    var idx = fx.propertyIndex;
    fx = layer.property("ADBE Effect Parade").property(idx);
    fx.name = MCP.animate.uniqueEffectName ? MCP.animate.uniqueEffectName(layer, name) : name;
    fx = layer.property("ADBE Effect Parade").property(idx);
    var k;
    for (k in values) {
        if (values.hasOwnProperty(k)) {
            var p = fx.property(k);
            if (!p) { MCP.fail("Effect '" + name + "' has no parameter " + k + ".", "script-error"); }
            p.setValue(values[k]);
        }
    }
    if (expressions) {
        for (k in expressions) {
            if (expressions.hasOwnProperty(k)) { fx.property(k).expression = expressions[k]; }
        }
    }
    return layer.property("ADBE Effect Parade").property(idx);
};

/** A comp-sized adjustment layer at the top named "Look · <name>". */
MCP.looks.adjustment = function (comp, name) {
    var solid = comp.layers.addSolid([1, 1, 1], "Look · " + name, comp.width, comp.height, comp.pixelAspect, comp.duration);
    solid.adjustmentLayer = true;
    solid.label = 5;
    solid.moveToBeginning();
    return solid;
};

MCP.looks.LIST = ["glow", "bloom", "grain", "vignette", "light-sweep", "frosted-glass", "motion-blur"];

MCP.register("applyLook", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var look = String(MCP.requireArg(args, "look"));
    var k = MCP.num(args.intensity, 1);
    var layer = MCP.isDefined(args.layer) ? MCP.resolveLayer(comp, args.layer) : null;
    var notes = [], made = [], created = null;
    var target = function (name) {
        if (layer) { return layer; }
        created = MCP.looks.adjustment(comp, name);
        return created;
    };
    var L;
    if (look === "glow") {
        L = target("Glow");
        made.push(MCP.looks.fx(L, "ADBE Glo2", "Glow Tight", { "ADBE Glo2-0002": 153, "ADBE Glo2-0003": 40, "ADBE Glo2-0004": 0.6 * k }).name);
        made.push(MCP.looks.fx(L, "ADBE Glo2", "Glow Wide", { "ADBE Glo2-0002": 153, "ADBE Glo2-0003": 300, "ADBE Glo2-0004": 0.4 * k }).name);
        notes.push("Two glows, tight and wide; judge them on black and lower intensity before radius.");
    } else if (look === "bloom") {
        L = target("Bloom");
        made.push(MCP.looks.fx(L, "ADBE Glo2", "Bloom", { "ADBE Glo2-0002": 179, "ADBE Glo2-0003": 80, "ADBE Glo2-0004": 0.5 * k }).name);
    } else if (look === "grain") {
        L = target("Grain");
        made.push(MCP.looks.fx(L, "ADBE Noise2", "Grain", { "ADBE Noise2-0001": 4 * k, "ADBE Noise2-0002": 0, "ADBE Noise2-0003": 1 }).name);
        notes.push("Mono noise at " + MCP.round(4 * k, 2) + " %: 2 to 6 over footage, 6 to 12 on clean graphics; none on product UI.");
    } else if (look === "vignette") {
        L = target("Vignette");
        made.push(MCP.looks.fx(L, "CS Vignette", "Vignette", { "CS Vignette-0001": 150 * k, "CS Vignette-0002": 45, "CS Vignette-0005": 40 }, { "CS Vignette-0003": "[thisLayer.width / 2, thisLayer.height / 2]" }).name);
    } else if (look === "light-sweep") {
        if (!layer) { MCP.fail("light-sweep needs layer: the logo, title or card to sweep.", "invalid-argument"); }
        var r = layer.sourceRectAtTime(layer.inPoint, false);
        var sweep = MCP.looks.fx(layer, "CC Light Sweep", "Light Sweep", {
            "CC Light Sweep-0002": -30, "CC Light Sweep-0003": 3, "CC Light Sweep-0004": Math.max(20, 0.3 * r.height),
            "CC Light Sweep-0005": 100 * k, "CC Light Sweep-0006": 150 * k, "CC Light Sweep-0007": 3, "CC Light Sweep-0009": 1
        });
        made.push(sweep.name);
        var t0 = MCP.animate.timeOf(comp, args, "startTime", "startFrame", layer.inPoint);
        var t1 = t0 + MCP.animate.span(comp, args, 0.8);
        var c = sweep.property("CC Light Sweep-0001");
        var y = r.top + r.height / 2, pad = 0.3 * r.width + r.height;
        MCP.animate.keyMove(c, t0, [r.left - pad, y], t1, [r.left + r.width + pad, y], "ease-in-out", { comp: comp });
        notes.push("The sweep crosses from " + MCP.round(t0) + " s to " + MCP.round(t1) + " s, fastest in the middle.");
    } else if (look === "frosted-glass") {
        if (!layer) { MCP.fail("frosted-glass needs layer: the card or bar whose shape frosts what is behind it.", "invalid-argument"); }
        var frost = layer.duplicate();
        frost.name = layer.name + " · Frost";
        frost.moveAfter(layer);
        frost.adjustmentLayer = true;
        var fxs = frost.property("ADBE Effect Parade");
        while (fxs.numProperties > 0) { fxs.property(1).remove(); fxs = frost.property("ADBE Effect Parade"); }
        made.push(MCP.looks.fx(frost, "ADBE Box Blur2", "Frost Blur", { "ADBE Box Blur2-0001": 30 * k, "ADBE Box Blur2-0002": 3, "ADBE Box Blur2-0004": 1 }).name);
        created = frost;
        notes.push("The frost layer sits under '" + layer.name + "' and blurs what is behind it inside its shape. Give the card a semi-transparent fill (white 10 to 20 %, or 60 to 70 % for a milky card) so the frost shows.");
    } else if (look === "motion-blur") {
        comp.motionBlur = true;
        try { comp.shutterAngle = 180; } catch (e1) {}
        try { comp.motionBlurSamplesPerFrame = 16; } catch (e2) {}
        var n = 0;
        for (var i = 1; i <= comp.numLayers; i++) {
            var M = comp.layer(i);
            if (layer && M.id !== layer.id) { continue; }
            if (M instanceof CameraLayer || M instanceof LightLayer) { continue; }
            try { M.motionBlur = true; n++; } catch (e3) {}
        }
        notes.push("Motion blur on for " + n + " layer(s); shutter 180°, 16 samples (raise to 32 for finals). Nested comps need it on inside too.");
    } else {
        MCP.fail("Unknown look '" + look + "'. Looks: " + MCP.looks.LIST.join(", ") + ", soft-shadow.", "invalid-argument");
    }
    return {
        composition: MCP.serialize.compRef(comp),
        look: look,
        layer: layer ? MCP.serialize.layerRef(layer) : null,
        created: created ? MCP.serialize.layerRef(created) : null,
        effects: made,
        intensity: k,
        notes: notes
    };
}, { mutating: true });

/* ------------------------------------------------------------- backgrounds */

MCP.looks.STYLES = ["mesh-gradient", "aurora", "grid", "dots", "noise", "grain"];
MCP.looks.DEFAULT_COLORS = {
    "mesh-gradient": ["#0E0F1A", "#3358F2", "#8B5CF6", "#22D3EE"],
    "aurora": ["#08090F", "#3358F2", "#8B5CF6", "#22D3EE"],
    "grid": ["#0E0F14", "#FFFFFF"],
    "dots": ["#0E0F14", "#FFFFFF"],
    "noise": ["#0B0C12", "#3358F2"],
    "grain": ["#111217"]
};

MCP.looks.colors = function (style, given) {
    var d = MCP.looks.DEFAULT_COLORS[style], out = [];
    for (var i = 0; i < d.length; i++) { out.push(MCP.color.rgba(given && i < given.length ? given[i] : d[i])); }
    return out;
};

/** "t" in loop expressions: 0..1 over the loop length, so every move closes on itself. */
MCP.looks.phase = function (L) { return "var L = " + MCP.expr.num(L) + "; var t = (time % L) / L;\n"; };

MCP.looks.solid = function (c, color, name) {
    var s = c.layers.addSolid([color[0], color[1], color[2]], name, c.width, c.height, c.pixelAspect, c.duration);
    return s;
};

MCP.register("createBackground", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var style = String(MCP.requireArg(args, "style"));
    var found = false;
    for (var s = 0; s < MCP.looks.STYLES.length; s++) { if (MCP.looks.STYLES[s] === style) { found = true; } }
    if (!found) { MCP.fail("Unknown style '" + style + "'. Styles: " + MCP.looks.STYLES.join(", ") + ".", "invalid-argument"); }
    var L = MCP.num(args.loop, comp.duration);
    if (!(L > 0)) { MCP.fail("loop must be greater than 0 seconds.", "invalid-argument"); }
    var speed = Math.max(1, Math.round(MCP.num(args.cycles, 1)));
    var cols = MCP.looks.colors(style, args.colors);
    var grain = MCP.num(args.grain, style === "grain" ? 6 : 3);
    var name = String(MCP.arg(args, "name", "Background · " + style));
    var W = comp.width, H = comp.height;
    var bg = app.project.items.addComp(name, W, H, comp.pixelAspect, comp.duration, comp.frameRate);
    bg.bgColor = [cols[0][0], cols[0][1], cols[0][2]];
    var P = MCP.looks.phase(L);
    var TAU = "(2 * Math.PI)";
    var base = MCP.looks.solid(bg, cols[0], "Base");
    var top = base;
    if (style === "mesh-gradient") {
        var pts = [[0.2, 0.25, 220, 1, 0], [0.8, 0.2, 180, 1, 1.7], [0.25, 0.8, 260, 2, 3.1], [0.78, 0.78, 150, 1, 4.4]];
        var ex = {};
        for (var i = 0; i < 4; i++) {
            var p = pts[i];
            ex["ADBE 4ColorGradient-000" + (2 * i + 1)] = P + "var a = " + TAU + " * " + (p[3] * speed) + " * t + " + p[4] + ";\n[" + MCP.round(p[0] * W) + " + " + p[2] + " * Math.cos(a), " + MCP.round(p[1] * H) + " + " + p[2] + " * Math.sin(a)];";
        }
        MCP.looks.fx(base, "ADBE 4ColorGradient", "Mesh Gradient", {
            "ADBE 4ColorGradient-0002": cols[0], "ADBE 4ColorGradient-0004": cols[1], "ADBE 4ColorGradient-0006": cols[2], "ADBE 4ColorGradient-0008": cols[3],
            "ADBE 4ColorGradient-0009": 300, "ADBE 4ColorGradient-0010": 0
        }, ex);
        MCP.looks.fx(base, "ADBE Turbulent Displace", "Flow", { "ADBE Turbulent Displace-0002": 60, "ADBE Turbulent Displace-0003": 420, "ADBE Turbulent Displace-0008": 1, "ADBE Turbulent Displace-0009": speed }, { "ADBE Turbulent Displace-0006": P + "t * 360 * " + speed + ";" });
    } else if (style === "aurora") {
        var shape = bg.layers.addShape();
        shape.name = "Blobs";
        var blobs = [[0.3, 0.35, 1100, 620, 1, 0], [0.7, 0.45, 1000, 560, 2, 2.1], [0.5, 0.75, 1200, 520, 3, 4.2]];
        for (var b = 0; b < blobs.length; b++) {
            var q = blobs[b];
            var g = shape.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
            g.name = "Blob " + (b + 1);
            var gi = g.propertyIndex;
            var items = shape.property("ADBE Root Vectors Group").property(gi).property("ADBE Vectors Group");
            items.addProperty("ADBE Vector Shape - Ellipse");
            items = shape.property("ADBE Root Vectors Group").property(gi).property("ADBE Vectors Group");
            items.property(1).property("ADBE Vector Ellipse Size").setValue([q[2] * W / 1920, q[3] * H / 1080]);
            items.addProperty("ADBE Vector Graphic - Fill");
            items = shape.property("ADBE Root Vectors Group").property(gi).property("ADBE Vectors Group");
            items.property(2).property("ADBE Vector Fill Color").setValue(cols[1 + (b % 3)]);
            var gt = shape.property("ADBE Root Vectors Group").property(gi).property("ADBE Vector Transform Group");
            gt.property("ADBE Vector Position").expression = P + "var a = " + TAU + " * " + (q[4] * speed) + " * t + " + q[5] + ";\n[" + MCP.round(q[0] * W - W / 2) + " + 260 * Math.cos(a), " + MCP.round(q[1] * H - H / 2) + " + 140 * Math.sin(a)];";
        }
        shape.property("ADBE Transform Group").property("ADBE Position").setValue([W / 2, H / 2]);
        // Wave first, blur after: the blur hides the warped layer edges.
        MCP.looks.fx(shape, "ADBE Wave Warp", "Liquid", { "ADBE Wave Warp-0002": 60, "ADBE Wave Warp-0003": 700, "ADBE Wave Warp-0004": 120, "ADBE Wave Warp-0005": 0 }, { "ADBE Wave Warp-0007": P + "t * 360 * " + speed + ";" });
        MCP.looks.fx(shape, "ADBE Box Blur2", "Soften", { "ADBE Box Blur2-0001": 120, "ADBE Box Blur2-0002": 3, "ADBE Box Blur2-0004": 1 });
        top = shape;
    } else if (style === "grid" || style === "dots") {
        var cell = MCP.num(args.cellSize, style === "grid" ? 80 : 40);
        var drift = P + "var d = t * " + MCP.expr.num(cell) + " * " + speed + ";\n";
        var layerG;
        if (style === "grid") {
            layerG = MCP.looks.solid(bg, [0, 0, 0], "Grid");
            MCP.looks.fx(layerG, "ADBE Grid", "Grid", { "ADBE Grid-0002": 3, "ADBE Grid-0004": cell, "ADBE Grid-0005": cell, "ADBE Grid-0006": 1.5, "ADBE Grid-0012": cols[1], "ADBE Grid-0013": 18 }, { "ADBE Grid-0001": drift + "[thisLayer.width / 2, thisLayer.height / 2 + d];" });
        } else {
            layerG = bg.layers.addShape();
            layerG.name = "Dots";
            var dg = layerG.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
            dg.name = "Dot";
            var di = layerG.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
            di.addProperty("ADBE Vector Shape - Ellipse");
            di = layerG.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
            di.property(1).property("ADBE Vector Ellipse Size").setValue([4, 4]);
            di.addProperty("ADBE Vector Graphic - Fill");
            di = layerG.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
            di.property(2).property("ADBE Vector Fill Color").setValue(cols[1]);
            di.property(2).property("ADBE Vector Fill Opacity").setValue(28);
            var nx = Math.ceil(W / cell) + 3, ny = Math.ceil(H / cell) + 3;
            var root = layerG.property("ADBE Root Vectors Group");
            root.addProperty("ADBE Vector Filter - Repeater");
            root = layerG.property("ADBE Root Vectors Group");
            var rep1 = root.property(root.numProperties);
            rep1.property("ADBE Vector Repeater Copies").setValue(nx);
            rep1.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([cell, 0]);
            root.addProperty("ADBE Vector Filter - Repeater");
            root = layerG.property("ADBE Root Vectors Group");
            var rep2 = root.property(root.numProperties);
            rep2.property("ADBE Vector Repeater Copies").setValue(ny);
            rep2.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([0, cell]);
            layerG.property("ADBE Root Vectors Group").property(1).property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue([-(nx - 1) * cell / 2, -(ny - 1) * cell / 2]);
            layerG.property("ADBE Transform Group").property("ADBE Position").expression = drift + "[" + (W / 2) + ", " + (H / 2) + " + d];";
        }
        var mask = layerG.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        var sh = new Shape();
        var rx = W * 0.62, ry = H * 0.7, cx = W / 2, cy = H / 2, kk = 0.5523;
        if (style === "dots") { cx = 0; cy = 0; }
        sh.vertices = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
        sh.inTangents = [[-rx * kk, 0], [0, -ry * kk], [rx * kk, 0], [0, ry * kk]];
        sh.outTangents = [[rx * kk, 0], [0, ry * kk], [-rx * kk, 0], [0, -ry * kk]];
        sh.closed = true;
        mask = layerG.property("ADBE Mask Parade").property(1);
        mask.property("ADBE Mask Shape").setValue(sh);
        mask.property("ADBE Mask Feather").setValue([W * 0.25, W * 0.25]);
        top = layerG;
    } else if (style === "noise") {
        MCP.looks.fx(base, "ADBE Fractal Noise", "Noise", {
            "ADBE Fractal Noise-0004": 120, "ADBE Fractal Noise-0005": -20, "ADBE Fractal Noise-0010": 700, "ADBE Fractal Noise-0015": 5,
            "ADBE Fractal Noise-0025": 1, "ADBE Fractal Noise-0026": speed
        }, { "ADBE Fractal Noise-0023": P + "t * 360 * " + speed + ";" });
        MCP.looks.fx(base, "ADBE Tint", "Colour", { "ADBE Tint-0001": cols[0], "ADBE Tint-0002": cols[1], "ADBE Tint-0003": 100 });
    }
    if (grain > 0) {
        var adj = bg.layers.addSolid([1, 1, 1], "Grain", W, H, comp.pixelAspect, comp.duration);
        adj.adjustmentLayer = true;
        adj.moveToBeginning();
        MCP.looks.fx(adj, "ADBE Noise2", "Grain", { "ADBE Noise2-0001": grain, "ADBE Noise2-0002": 0, "ADBE Noise2-0003": 1 });
    }
    var layer = comp.layers.add(bg);
    layer.moveToEnd();
    layer.name = name;
    var notes = ["Loops every " + MCP.round(L, 3) + " s" + (speed > 1 ? " (" + speed + " cycles)" : "") + ". Edit the colours inside the '" + name + "' comp."];
    if (app.project.bitsPerChannel < 16 && style !== "grid" && style !== "dots") { notes.push("The project is " + app.project.bitsPerChannel + " bpc: soft gradients band less at 16 bpc (the grain also hides banding)."); }
    return {
        composition: MCP.serialize.compRef(comp),
        style: style,
        background: MCP.serialize.compRef(bg),
        layer: MCP.serialize.layerRef(layer),
        loop: MCP.round(L, 3),
        cycles: speed,
        colors: (function () { var o = []; for (var i = 0; i < cols.length; i++) { o.push(MCP.color.hex ? MCP.color.hex(cols[i]) : cols[i]); } return o; })(),
        grain: grain,
        notes: notes
    };
}, { mutating: true });
