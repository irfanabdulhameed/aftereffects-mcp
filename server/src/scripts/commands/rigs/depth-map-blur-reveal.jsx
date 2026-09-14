/*
 * rigDepthMapBlurReveal: the "Depth Map Blur Reveal" builder panel
 * (panels/depth-map-blur-reveal/Depth Map Blur Reveal.jsx) as a bridge
 * command. Same SPEC, same effect stack on the target layer, same hidden
 * "DBR Depth (auto)" guide solid in auto mode. Differences from the panel:
 * the target is an explicit layer reference (the panel used the first
 * selected layer), the depth map is an explicit depthLayer reference (the
 * panel used the second selected layer), glowRadius and glowThreshold are
 * exposed (the panel kept them in SPEC), and the composition must exist.
 */

MCP.rigs.DEPTH_BLUR_SPEC = {
    maxBlur   : 120,
    invert    : false,
    autoDir   : "bottom",
    useExp    : true,
    expStart  : -2.0,
    useGlow   : true,
    glowStart : 2.5,
    glowEnd   : 0.0,
    glowRad   : 90,
    glowThr   : 50,
    useScale  : false,
    scaleStart: 104,
    start     : 0.0,
    dur       : 0.8,
    ease      : 33,
    mnCompound: ["ADBE Compound Blur"],
    mnGauss   : ["ADBE Gaussian Blur 2", "ADBE Gaussian Blur"],
    mnExposure: ["ADBE Exposure2"],
    mnGlow    : ["ADBE Glo2"],
    mnRamp    : ["ADBE Ramp"]
};

MCP.rigs.describe({
    tool: "rig-depth-map-blur-reveal",
    name: "Depth Map Blur Reveal",
    panel: "panels/depth-map-blur-reveal/Depth Map Blur Reveal.jsx",
    summary: "An image starts as a heavy depth-weighted blur and resolves into focus: the far distance sharpens first while the near foreground stays soft and bloomed longest, lifted by an exposure ramp from dark to bright and a glow bloom that fades as the picture sharpens.",
    builds: [
        "Compound Blur on the target layer: Blur Layer = your depth map or an auto gradient, Maximum Blur keyframed maxBlur -> 0 (eased).",
        "Exposure (optional): expStart -> 0 stops.",
        "Glow (optional): Glow Intensity glowStart -> glowEnd with the given radius and threshold.",
        "Scale (optional): scaleStart% -> 100% of the layer's current scale.",
        "DBR Depth (auto): in auto mode, a hidden guide solid with a linear Gradient Ramp, white on the chosen near edge, used only as the Compound Blur source.",
        "Fallback: if Compound Blur is unavailable, Gaussian Blur Blurriness maxBlur -> 0 (uniform, no depth weighting) and the auto solid is removed."
    ],
    layerOrder: ["DBR Depth (auto) at the top when blurSource is auto", "target layer (unchanged position)"],
    requires: ["The target layer to reveal (any footage, image or precomp layer).", "Optionally a grayscale depth map layer (white = near) when blurSource is 'layer'."],
    optional: [],
    parameters: [
        { name: "layer", "default": null, description: "LayerRef of the image or footage layer to reveal. Required." },
        { name: "depthLayer", "default": null, description: "LayerRef of a depth map layer. Used when blurSource is 'layer'." },
        { name: "blurSource", "default": "auto", description: "'auto' fakes depth with a vertical gradient; 'layer' uses depthLayer. Defaults to 'layer' when depthLayer is given." },
        { name: "maxBlur", "default": 120, description: "Compound Blur Maximum Blur at the start, animates to 0." },
        { name: "autoDir", "default": "bottom", description: "Which edge stays soft longest in auto mode: bottom, top, left or right." },
        { name: "invert", "default": false, description: "Invert the depth so the other end blurs longest." },
        { name: "useExposure", "default": true, description: "Add the exposure lift." },
        { name: "expStart", "default": -2, description: "Exposure start in stops (negative = dark), ramps to 0." },
        { name: "useGlow", "default": true, description: "Add the glow bloom." },
        { name: "glowStart", "default": 2.5, description: "Glow Intensity at the start." },
        { name: "glowEnd", "default": 0, description: "Glow Intensity at the end." },
        { name: "glowRadius", "default": 90, description: "Glow Radius." },
        { name: "glowThreshold", "default": 50, description: "Glow Threshold in percent." },
        { name: "useScale", "default": false, description: "Add the gentle scale settle." },
        { name: "scaleStart", "default": 104, description: "Start scale as a percent of the layer's current scale, settles to 100%." },
        { name: "start", "default": 0, description: "Reveal start in seconds." },
        { name: "startAtPlayhead", "default": false, description: "Ignore start and begin at the composition's current time." },
        { name: "duration", "default": 0.8, description: "Reveal length in seconds (minimum 0.05)." },
        { name: "ease", "default": 33, description: "Keyframe influence 0 to 100; 33 is Easy Ease." },
        { name: "openInViewer", "default": true, description: "Open the composition in the viewer after building." }
    ],
    fixedValues: { compoundBlur: { stretchMapToFit: true }, autoRamp: { shape: "Linear (1)", startColor: "white", endColor: "black" }, autoSolid: { guideLayer: true, enabled: false } },
    returns: "target layer summary, depthSource {mode, layer}, blurEffect used, the reveal window, notes."
});

/** Auto depth source: a hidden guide solid with a linear Gradient Ramp, white on the near edge. */
MCP.rigs.dbrMakeAutoDepth = function (comp, dir, notes) {
    var SPEC = MCP.rigs.DEPTH_BLUR_SPEC;
    var sol = comp.layers.addSolid([0, 0, 0], "DBR Depth (auto)", comp.width, comp.height, 1.0, comp.duration);
    sol.moveToBeginning();
    var ramp = MCP.rigs.addFirstEffect(sol, SPEC.mnRamp);
    if (!ramp) { MCP.fail("Gradient Ramp effect is not available; cannot build the auto depth map. Pass depthLayer with blurSource 'layer' instead.", "not-found"); }

    // white end = blurs longest (= near). Place white on the chosen edge.
    var w = comp.width, h = comp.height;
    var table = {
        bottom: { s: [w / 2, h], e: [w / 2, 0] },
        top   : { s: [w / 2, 0], e: [w / 2, h] },
        left  : { s: [0, h / 2], e: [w, h / 2] },
        right : { s: [w, h / 2], e: [0, h / 2] }
    };
    var pts = table[dir] || { s: [w / 2, h], e: [w / 2, 0] };

    MCP.rigs.setBy(ramp, "Start of Ramp", pts.s, notes);
    MCP.rigs.setBy(ramp, "Start Color", [1, 1, 1, 1], notes);
    MCP.rigs.setBy(ramp, "End of Ramp", pts.e, notes);
    MCP.rigs.setBy(ramp, "End Color", [0, 0, 0, 1], notes);
    MCP.rigs.setBy(ramp, "Ramp Shape", 1, notes);              // 1 = Linear Ramp

    sol.guideLayer = true;     // excluded from final render
    sol.enabled = false;       // hidden in the comp; Compound Blur still samples it
    return sol;
};

MCP.register("rigDepthMapBlurReveal", function (args) {
    var SPEC = MCP.rigs.DEPTH_BLUR_SPEC;
    var notes = [];
    var comp = MCP.resolveComp(args.comp);
    var target = MCP.resolveLayer(comp, MCP.requireArg(args, "layer"));
    var givenDepth = MCP.rigs.optionalLayer(comp, args.depthLayer);

    var blurSource = MCP.isDefined(args.blurSource) ? String(args.blurSource) : (givenDepth ? "layer" : "auto");
    if (blurSource !== "auto" && blurSource !== "layer") {
        MCP.fail("blurSource must be 'auto' or 'layer' (got '" + blurSource + "').", "invalid-argument");
    }
    if (blurSource === "layer" && !givenDepth) {
        MCP.fail("blurSource 'layer' needs depthLayer: the grayscale depth map of the image (white = near). Use blurSource 'auto' to fake depth with a gradient instead.", "invalid-argument");
    }
    if (givenDepth && givenDepth.index === target.index) {
        MCP.fail("depthLayer must be a different layer from the target (both resolved to layer " + target.index + " '" + target.name + "').", "invalid-argument");
    }

    var startT = MCP.bool(args.startAtPlayhead, false) ? comp.time : Math.max(0, MCP.num(args.start, SPEC.start));
    var opts = {
        maxBlur    : Math.max(0, MCP.num(args.maxBlur, SPEC.maxBlur)),
        blurSource : blurSource,
        autoDir    : MCP.isDefined(args.autoDir) ? String(args.autoDir) : SPEC.autoDir,
        invert     : MCP.bool(args.invert, SPEC.invert),
        useExp     : MCP.bool(args.useExposure, SPEC.useExp),   expStart  : MCP.num(args.expStart, SPEC.expStart),
        useGlow    : MCP.bool(args.useGlow, SPEC.useGlow),      glowStart : MCP.num(args.glowStart, SPEC.glowStart), glowEnd : MCP.num(args.glowEnd, SPEC.glowEnd),
        glowRad    : MCP.num(args.glowRadius, SPEC.glowRad),    glowThr   : MCP.num(args.glowThreshold, SPEC.glowThr),
        useScale   : MCP.bool(args.useScale, SPEC.useScale),    scaleStart: Math.max(1, MCP.num(args.scaleStart, SPEC.scaleStart)),
        start      : startT,
        dur        : Math.max(0.05, MCP.num(args.duration, SPEC.dur)),
        ease       : Math.max(0, Math.min(100, MCP.num(args.ease, SPEC.ease))),
        openInViewer: MCP.bool(args.openInViewer, true)
    };

    // ---- 0. Resolve the depth source ------------------------------------------------
    var depthLayer = null;
    if (opts.blurSource === "layer") {
        depthLayer = givenDepth;
        MCP.rigs.log(notes, "Depth source: selected layer '" + depthLayer.name + "'.");
    } else {
        depthLayer = MCP.rigs.dbrMakeAutoDepth(comp, opts.autoDir, notes);
        MCP.rigs.log(notes, "Depth source: auto gradient ('" + opts.autoDir + "' edge stays soft longest).");
    }

    var t0 = opts.start, t1 = opts.start + opts.dur;
    var blurEffect;

    // ---- 1. Compound Blur (the depth-weighted reveal) -------------------------------
    var cb = MCP.rigs.addFirstEffect(target, SPEC.mnCompound);
    if (cb) {
        MCP.rigs.setBy(cb, "Blur Layer", depthLayer.index, notes);
        MCP.rigs.setBy(cb, "Stretch Map to Fit", true, notes);
        if (opts.invert) { MCP.rigs.setBy(cb, "Invert Blur", true, notes); }
        if (!MCP.rigs.animBy(cb, "Maximum Blur", t0, opts.maxBlur, t1, 0, opts.ease, notes)) {
            MCP.rigs.animBy(cb, "Max Blur", t0, opts.maxBlur, t1, 0, opts.ease, notes);  // name fallback
        }
        blurEffect = "Compound Blur";
        MCP.rigs.log(notes, "Compound Blur: Maximum Blur " + opts.maxBlur + " -> 0.");
    } else {
        // fallback: plain Gaussian blur resolve (no depth weighting)
        var gb = MCP.rigs.addFirstEffect(target, SPEC.mnGauss);
        if (!gb) { MCP.fail("Neither Compound Blur nor Gaussian Blur is available in this After Effects install.", "not-found"); }
        MCP.rigs.animBy(gb, "Blurriness", t0, opts.maxBlur, t1, 0, opts.ease, notes);
        if (opts.blurSource === "auto" && depthLayer) { depthLayer.remove(); depthLayer = null; }  // gradient unused
        blurEffect = "Gaussian Blur";
        MCP.rigs.log(notes, "Compound Blur unavailable - used Gaussian Blur (uniform, no depth weighting).");
    }

    // ---- 2. Exposure lift (dark -> bright) ------------------------------------------
    if (opts.useExp) {
        var ex = MCP.rigs.addFirstEffect(target, SPEC.mnExposure);
        if (ex) {
            var exP = null;
            try { exP = ex.property("Master").property("Exposure"); } catch (e) {}
            if (!exP) { exP = MCP.findProp(ex, "Exposure"); }
            MCP.rigs.animProp(exP, t0, opts.expStart, t1, 0, opts.ease, notes);
            MCP.rigs.log(notes, "Exposure: " + opts.expStart + " -> 0.");
        } else { MCP.rigs.log(notes, "  - Exposure effect unavailable, skipped."); }
    }

    // ---- 3. Glow bloom (fades as it sharpens) ---------------------------------------
    if (opts.useGlow) {
        var gl = MCP.rigs.addFirstEffect(target, SPEC.mnGlow);
        if (gl) {
            MCP.rigs.setBy(gl, "Glow Radius", opts.glowRad, notes);
            MCP.rigs.setBy(gl, "Glow Threshold", opts.glowThr, notes);
            MCP.rigs.animBy(gl, "Glow Intensity", t0, opts.glowStart, t1, opts.glowEnd, opts.ease, notes);
            MCP.rigs.log(notes, "Glow: Intensity " + opts.glowStart + " -> " + opts.glowEnd + ".");
        } else { MCP.rigs.log(notes, "  - Glow effect unavailable, skipped."); }
    }

    // ---- 4. Gentle scale settle (preserves the layer's current framing) -------------
    if (opts.useScale) {
        var sc = target.property("ADBE Transform Group").property("ADBE Scale");
        var base = sc.value, from = [];
        for (var d = 0; d < base.length; d++) { from.push(base[d] * (opts.scaleStart / 100)); }
        MCP.rigs.animProp(sc, t0, from, t1, base, opts.ease, notes);
        MCP.rigs.log(notes, "Scale: " + opts.scaleStart + "% -> 100% of current.");
    }

    if (opts.openInViewer) { comp.openInViewer(); }
    MCP.rigs.log(notes, "Built on '" + target.name + "':  " + t0.toFixed(2) + "s -> " + t1.toFixed(2) + "s.");

    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(target),
        depthSource: { mode: opts.blurSource, layer: MCP.rigs.layerOrNull(depthLayer) },
        blurEffect: blurEffect,
        window: { start: MCP.round(t0), end: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1), duration: MCP.round(opts.dur) },
        settings: { maxBlur: opts.maxBlur, invert: opts.invert, autoDir: opts.autoDir, useExposure: opts.useExp, expStart: opts.expStart, useGlow: opts.useGlow, glowStart: opts.glowStart, glowEnd: opts.glowEnd, glowRadius: opts.glowRad, glowThreshold: opts.glowThr, useScale: opts.useScale, scaleStart: opts.scaleStart, ease: opts.ease },
        notes: notes
    };
}, { mutating: true });
