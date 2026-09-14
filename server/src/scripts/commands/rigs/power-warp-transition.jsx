/*
 * rigPowerWarpTransition: the "Power Warp Transition" builder panel
 * (panels/power-warp-transition/Power Warp Transition.jsx) as a bridge
 * command. Same SPEC, same map layers, same adjustment stack, same ordering.
 * Differences from the panel: outgoing, incoming and depth are explicit layer
 * references (the panel used dropdowns), and an incoming layer that collides
 * with outgoing or depth is an error instead of being silently ignored.
 * Notes use the panel's "  ? " marker for a value that fell back to a default.
 */

MCP.rigs.POWER_WARP_SPEC = {
    gradientWipe : { invert: true, softness: 0 },                         // Media Holder
    scanLine     : { blackSoft: 75, whiteSoft: 6,                          // Extract band sweep 0->255
                     glowThreshold: 60, glowRadius: 10, glowIntensity: 1 },
    shake        : { wiggleFreq: 20, sliderPeak: 79 },                     // sliderPeak * INT
    warp         : { glassSoftness: 18, glassHeight: 100, glassDisp: 500,  // height,disp,vbAmount * INT
                     vbType: 3 /*Perpendicular*/, vbAmount: 250,
                     vbRidge: 0.95, vbAngleExpr: "wiggle(16,360)",
                     shadeAmbient: 100, shadeDiffuse: 0, shadeSpecular: 0, shadeRough: 0.025, shadeMetal: 100 },
    aberration   : { glassSoftness: 12.6, glassHeight: 55.8, glassDisp: -500 }, // glassDisp * INT
    fine         : { glassSoftness: 1, glassHeight: 35, glassDisp: 500,    // glassHeight * INT
                     tnScale: 200, tnEvoExpr: "wiggle(16,350)",
                     tn1Contrast: 100, tn1Complexity: 4,
                     tn2Contrast: 50,  tn2Complexity: 14 },
    // map-prep (Extract crush + blur) values for each depth-derived source layer
    warpMap      : { bp: 199, wp: 199, bs: 116, ws: 6, boxBlur: 15 },
    shakeMap     : { bp: 223, wp: 223, bs: 215, ws: 80, boxBlur: 3 },
    fineMap      : { bp: 212, wp: 212, bs: 104, ws: 6, boxBlur: 15 },
    // popup index guesses (guarded: the effect still works if AE numbers these differently)
    idx : { dispH: 1 /*Red*/, dispV: 2 /*Green*/, glassPropLightness: 5,
            vbPropLightness: 5, glowOpScreen: 3, glowCompBehind: 2,
            tnFractalSwirly: 4, tnNoiseSpline: 3, tnBlendMultiply: 3, tnBlendSoftLight: 10 },
    defaults : { start: 0.5, duration: 1.5, intensity: 1.0, scanColor: [0, 90, 255] }
};

MCP.rigs.describe({
    tool: "rig-power-warp-transition",
    name: "Power Warp Transition",
    panel: "panels/power-warp-transition/Power Warp Transition.jsx",
    summary: "A depth-map driven transition: the outgoing shot is wiped away by its depth (near to far) while a glowing scan line sweeps through it, the picture warps and smears (CC Glass plus CC Vector Blur), red and green channels split (chromatic aberration), the frame shakes with depth parallax and fine turbulent ripples run across it. Everything ramps in and out inside the transition window.",
    builds: [
        "Gradient Wipe on the outgoing layer, driven by the depth layer, Transition Completion 0 -> 100 over the window.",
        "Scan Line: a copy of the depth layer with Extract (band sweep 0 -> 255), Fill, Solid Composite, Tint (scan colour) and Glow, blend mode Add, with a short opacity fade.",
        "Warp: adjustment layer with CC Glass (bump map = Warp Map) and CC Vector Blur, opacity bell 0 -> 100 -> 0.",
        "Aberrations: adjustment layer with CC Glass, Set Channels (green), CC Glass (negative displacement), Set Channels (red), opacity bell.",
        "Shake: adjustment layer with a Slider Control bell and a Displacement Map (Shake Map) whose max displacement wiggles by the slider.",
        "Fine Distortions: adjustment layer with CC Glass (bump map = Fine Distortions Map), opacity bell.",
        "Warp Map, Shake Map, Fine Distortions Map: hidden copies of the depth layer crushed with Extract, Solid Composite and Fast Box Blur (the fine map also carries two Turbulent Noise passes)."
    ],
    layerOrder: ["Fine Distortions", "Shake", "Aberrations", "Warp", "Scan Line", "outgoing", "depth (hidden)", "Warp Map", "Shake Map", "Fine Distortions Map", "incoming"],
    requires: [
        "An outgoing layer (the shot that warps away).",
        "A depth map layer: a grayscale depth pass of the outgoing shot, white = near, black = far. The rig cannot generate one; make it in Photoshop (Neural Filters > Depth Blur, output depth map only), a 3D render, or any depth estimator, then import it as a layer.",
        "Optionally an incoming layer revealed underneath."
    ],
    optional: [],
    parameters: [
        { name: "outgoing", "default": null, description: "LayerRef of the outgoing shot. Required." },
        { name: "depth", "default": null, description: "LayerRef of the grayscale depth map of the outgoing shot. Required, must differ from outgoing." },
        { name: "incoming", "default": null, description: "LayerRef of the shot revealed underneath. Optional, must differ from the other two." },
        { name: "start", "default": 0.5, description: "Transition start in seconds (snapped to a frame)." },
        { name: "duration", "default": 1.5, description: "Transition length in seconds (1.0 to 2.0 works best)." },
        { name: "intensity", "default": 1.0, description: "Master distortion strength: 0.5 subtle, 1.0 tutorial, 2.0 extreme." },
        { name: "scanColor", "default": [0, 90, 255], description: "Colour of the glowing scan line." },
        { name: "modules", "default": { scanLine: true, warp: true, aberration: true, shake: true, fine: true }, description: "Turn individual modules off. Gradient Wipe is always on." }
    ],
    fixedValues: {
        gradientWipe: { invert: true, softness: 0 },
        scanLine: { blackSoftness: 75, whiteSoftness: 6, glowThreshold: 60, glowRadius: 10, glowIntensity: 1 },
        shake: { wiggleFrequency: 20, sliderPeak: "79 * intensity", peakAt: "12% into the window" },
        warp: { glassSoftness: 18, glassHeight: "100 * intensity", glassDisplacement: "500 * intensity", vectorBlurType: "Perpendicular (3)", vectorBlurAmount: "250 * intensity", ridgeSmoothness: 0.95, angleOffset: "wiggle(16,360)" },
        aberration: { glassSoftness: 12.6, glassHeight: 55.8, glassDisplacement: "-500 * intensity" },
        fine: { glassSoftness: 1, glassHeight: "35 * intensity", glassDisplacement: 500, turbulentNoiseScale: 200, evolution: "wiggle(16,350)" },
        maps: { warpMap: "Extract 199/199/116/6, Fast Box Blur 15, Compound Blur 200", shakeMap: "Extract 223/223/215/80, Fast Box Blur 3", fineMap: "Extract 212/212/104/6, Fast Box Blur 15" }
    },
    returns: "outgoing, incoming and depth layer summaries, every created layer keyed by role, the transition window {start, end, mid}, notes. The playhead is parked at mid."
});

MCP.rigs.pwSnap = function (comp, t) { return Math.round(t * comp.frameRate) / comp.frameRate; };

MCP.rigs.pwNewAdjustment = function (comp, name, t0, t1) {
    var L = comp.layers.addSolid([0, 0, 0], name, comp.width, comp.height, comp.pixelAspect, comp.duration);
    L.adjustmentLayer = true;
    L.name = name;
    L.inPoint = t0;
    L.outPoint = t1;
    return L;
};

/** Duplicate the depth layer, strip inherited effects, rename: a fresh map source. */
MCP.rigs.pwNewDepthCopy = function (depthLayer, name) {
    var L = depthLayer.duplicate();
    L.name = name;
    var fx = L.property("ADBE Effect Parade");
    while (fx.numProperties > 0) { fx.property(1).remove(); }   // start clean
    return L;
};

/** Extract crush -> black Solid Composite -> Fast Box Blur on a map layer. */
MCP.rigs.pwBuildMapBase = function (layer, m, notes) {
    var Q = "  ? ";
    var ex = MCP.rigs.addEffect(layer, "ADBE Extract", "Extract");
    MCP.rigs.setBy(ex, "Black Point", m.bp, notes, Q); MCP.rigs.setBy(ex, "White Point", m.wp, notes, Q);
    MCP.rigs.setBy(ex, "Black Softness", m.bs, notes, Q); MCP.rigs.setBy(ex, "White Softness", m.ws, notes, Q);
    var sc = MCP.rigs.addEffect(layer, "ADBE Solid Composite", "Solid Composite");
    MCP.rigs.setBy(sc, "Color", [0, 0, 0], notes, Q);
    var fb = MCP.rigs.addEffect(layer, "ADBE Box Blur2", "Fast Box Blur");
    MCP.rigs.setBy(fb, "Blur Radius", m.boxBlur, notes, Q); MCP.rigs.setBy(fb, "Iterations", 3, notes, Q);
    MCP.rigs.setBy(fb, "Repeat Edge Pixels", true, notes, Q);
    return layer;
};

MCP.register("rigPowerWarpTransition", function (args) {
    var SPEC = MCP.rigs.POWER_WARP_SPEC;
    var Q = "  ? ";
    var notes = [];
    var comp = MCP.resolveComp(args.comp);

    var A = MCP.resolveLayer(comp, MCP.requireArg(args, "outgoing"));
    var D = MCP.resolveLayer(comp, MCP.requireArg(args, "depth"));
    var B = MCP.rigs.optionalLayer(comp, args.incoming);
    if (A.index === D.index) {
        MCP.fail("Outgoing and depth map must be different layers (both resolved to layer " + A.index + " '" + A.name + "').", "invalid-argument");
    }
    if (B && (B.index === A.index || B.index === D.index)) {
        MCP.fail("Incoming must differ from outgoing and depth (incoming resolved to layer " + B.index + " '" + B.name + "'). Omit incoming if there is no shot underneath.", "invalid-argument");
    }

    var mods = args.modules || {};
    var opts = {
        start: MCP.num(args.start, SPEC.defaults.start),
        duration: MCP.num(args.duration, SPEC.defaults.duration),
        intensity: Math.max(0, MCP.num(args.intensity, SPEC.defaults.intensity)),
        scanColor: MCP.rigs.color3(args.scanColor, SPEC.defaults.scanColor),
        mods: {
            scanLine: MCP.bool(mods.scanLine, true),
            warp: MCP.bool(mods.warp, true),
            aberration: MCP.bool(mods.aberration, true),
            shake: MCP.bool(mods.shake, true),
            fine: MCP.bool(mods.fine, true)
        }
    };
    var INT = opts.intensity;

    var t0 = MCP.rigs.pwSnap(comp, opts.start);
    var t1 = MCP.rigs.pwSnap(comp, opts.start + opts.duration);
    if (t1 <= t0) { MCP.fail("Duration must be greater than 0 (after snapping to frames, start " + t0 + " and end " + t1 + " coincide).", "invalid-argument"); }
    var dur = t1 - t0;
    var mid = t0 + dur * 0.5;
    var early = t0 + dur * 0.12;                       // shake punches early then decays

    // ----- depth-derived source layers (built first; referenced later by index) -------
    var warpMap = null, shakeMap = null, fineMap = null;

    if (opts.mods.warp || opts.mods.aberration) {
        warpMap = MCP.rigs.pwNewDepthCopy(D, "Warp Map");
        MCP.rigs.pwBuildMapBase(warpMap, SPEC.warpMap, notes);
        // Compound Blur (self-referencing) sits before the box blur in the tutorial;
        // it is added after for simpler ordering: visually equivalent smoothing.
        try {
            var cb = MCP.rigs.addEffect(warpMap, "ADBE Compound Blur", "Compound Blur");
            MCP.rigs.setBy(cb, "Blur Layer", warpMap.index, notes, Q);
            MCP.rigs.setBy(cb, "Maximum Blur", 200, notes, Q);
            MCP.rigs.setBy(cb, "Stretch Map to Fit", true, notes, Q);
        } catch (eCB) { MCP.rigs.log(notes, "Warp Map: Compound Blur skipped (" + eCB.toString() + ")"); }
        warpMap.enabled = false;
    }

    if (opts.mods.shake) {
        shakeMap = MCP.rigs.pwNewDepthCopy(D, "Shake Map");
        MCP.rigs.pwBuildMapBase(shakeMap, SPEC.shakeMap, notes);
        shakeMap.enabled = false;
    }

    if (opts.mods.fine) {
        fineMap = MCP.rigs.pwNewDepthCopy(D, "Fine Distortions Map");
        // Extract -> Solid Composite -> Turbulent Noise -> Fast Box Blur -> Turbulent Noise 2
        var fx = MCP.rigs.addEffect(fineMap, "ADBE Extract", "Extract");
        MCP.rigs.setBy(fx, "Black Point", SPEC.fineMap.bp, notes, Q); MCP.rigs.setBy(fx, "White Point", SPEC.fineMap.wp, notes, Q);
        MCP.rigs.setBy(fx, "Black Softness", SPEC.fineMap.bs, notes, Q); MCP.rigs.setBy(fx, "White Softness", SPEC.fineMap.ws, notes, Q);
        var fsc = MCP.rigs.addEffect(fineMap, "ADBE Solid Composite", "Solid Composite");
        MCP.rigs.setBy(fsc, "Color", [0, 0, 0], notes, Q);
        var tn1 = MCP.rigs.addEffect(fineMap, "ADBE Turbulent Noise", "Turbulent Noise");
        MCP.rigs.setBy(tn1, "Fractal Type", SPEC.idx.tnFractalSwirly, notes, Q);
        MCP.rigs.setBy(tn1, "Noise Type", SPEC.idx.tnNoiseSpline, notes, Q);
        MCP.rigs.setBy(tn1, "Contrast", SPEC.fine.tn1Contrast, notes, Q);
        MCP.rigs.setBy(tn1, "Complexity", SPEC.fine.tn1Complexity, notes, Q);
        MCP.rigs.setBy(tn1, "Scale", SPEC.fine.tnScale, notes, Q);
        MCP.rigs.setBy(tn1, "Blending Mode", SPEC.idx.tnBlendMultiply, notes, Q);
        MCP.rigs.setExpr(tn1, "Evolution", SPEC.fine.tnEvoExpr, notes, Q);
        var ffb = MCP.rigs.addEffect(fineMap, "ADBE Box Blur2", "Fast Box Blur");
        MCP.rigs.setBy(ffb, "Blur Radius", SPEC.fineMap.boxBlur, notes, Q); MCP.rigs.setBy(ffb, "Iterations", 3, notes, Q);
        MCP.rigs.setBy(ffb, "Repeat Edge Pixels", true, notes, Q);
        var tn2 = MCP.rigs.addEffect(fineMap, "ADBE Turbulent Noise", "Turbulent Noise");
        MCP.rigs.setBy(tn2, "Fractal Type", SPEC.idx.tnFractalSwirly, notes, Q);
        MCP.rigs.setBy(tn2, "Noise Type", SPEC.idx.tnNoiseSpline, notes, Q);
        MCP.rigs.setBy(tn2, "Contrast", SPEC.fine.tn2Contrast, notes, Q);
        MCP.rigs.setBy(tn2, "Complexity", SPEC.fine.tn2Complexity, notes, Q);
        MCP.rigs.setBy(tn2, "Scale", SPEC.fine.tnScale, notes, Q);
        MCP.rigs.setBy(tn2, "Blending Mode", SPEC.idx.tnBlendSoftLight, notes, Q);
        MCP.rigs.setExpr(tn2, "Evolution", SPEC.fine.tnEvoExpr, notes, Q);
        fineMap.enabled = false;
    }

    // ----- 1. GRADIENT WIPE on the outgoing clip --------------------------------------
    var gw = MCP.rigs.addEffect(A, "ADBE Gradient Wipe", "Gradient Wipe");
    MCP.rigs.setBy(gw, "Transition Softness", SPEC.gradientWipe.softness, notes, Q);
    MCP.rigs.setBy(gw, "Gradient Layer", D.index, notes, Q);
    MCP.rigs.setBy(gw, "Invert Gradient", SPEC.gradientWipe.invert, notes, Q);
    MCP.rigs.ramp(gw, "Transition Completion", t0, 0, t1, 100, notes);
    MCP.rigs.log(notes, "Gradient Wipe applied to '" + A.name + "'.");

    // ----- 2. SCAN LINE (depth copy, Add) ---------------------------------------------
    var scan = null;
    if (opts.mods.scanLine) {
        scan = MCP.rigs.pwNewDepthCopy(D, "Scan Line");
        var sEx = MCP.rigs.addEffect(scan, "ADBE Extract", "Extract");
        MCP.rigs.setBy(sEx, "Black Softness", SPEC.scanLine.blackSoft, notes, Q);
        MCP.rigs.setBy(sEx, "White Softness", SPEC.scanLine.whiteSoft, notes, Q);
        MCP.rigs.ramp(sEx, "Black Point", t0, 0, t1, 255, notes);     // the band sweeps near -> far
        MCP.rigs.ramp(sEx, "White Point", t0, 0, t1, 255, notes);
        var sFill = MCP.rigs.addEffect(scan, "ADBE Fill", "Fill");
        MCP.rigs.setBy(sFill, "Color", [1, 1, 1], notes, Q);
        var sSC = MCP.rigs.addEffect(scan, "ADBE Solid Composite", "Solid Composite");
        MCP.rigs.setBy(sSC, "Color", [0, 0, 0], notes, Q);
        var sTint = MCP.rigs.addEffect(scan, "ADBE Tint", "Tint");
        MCP.rigs.setBy(sTint, "Map White To", opts.scanColor, notes, Q);
        MCP.rigs.setBy(sTint, "Amount to Tint", 100, notes, Q);
        var sGlow = MCP.rigs.addEffect(scan, "ADBE Glo2", "Glow");
        MCP.rigs.setBy(sGlow, "Glow Threshold", SPEC.scanLine.glowThreshold, notes, Q);
        MCP.rigs.setBy(sGlow, "Glow Radius", SPEC.scanLine.glowRadius, notes, Q);
        MCP.rigs.setBy(sGlow, "Glow Intensity", SPEC.scanLine.glowIntensity, notes, Q);
        MCP.rigs.setBy(sGlow, "Composite Original", SPEC.idx.glowCompBehind, notes, Q);
        MCP.rigs.setBy(sGlow, "Glow Operation", SPEC.idx.glowOpScreen, notes, Q);
        scan.blendingMode = BlendingMode.ADD;
        scan.inPoint = t0; scan.outPoint = t1;
        scan.enabled = true;
        // short opacity fade so the Add band doesn't pop
        var sOp = MCP.rigs.opacityProp(scan);
        sOp.setValueAtTime(t0, 0);
        sOp.setValueAtTime(t0 + dur * 0.12, 100);
        sOp.setValueAtTime(t1 - dur * 0.12, 100);
        sOp.setValueAtTime(t1, 0);
        MCP.rigs.log(notes, "Scan Line built.");
    }

    // ----- 3. WARP (core distortion adjustment) ---------------------------------------
    var warp = null;
    if (opts.mods.warp) {
        warp = MCP.rigs.pwNewAdjustment(comp, "Warp", t0, t1);
        var wG = MCP.rigs.addEffect(warp, "CC Glass", "CC Glass");
        MCP.rigs.setBy(wG, "Bump Map", warpMap.index, notes, Q);
        MCP.rigs.setBy(wG, "Property", SPEC.idx.glassPropLightness, notes, Q);
        MCP.rigs.setBy(wG, "Softness", SPEC.warp.glassSoftness, notes, Q);
        MCP.rigs.setBy(wG, "Height", SPEC.warp.glassHeight * INT, notes, Q);
        MCP.rigs.setBy(wG, "Displacement", SPEC.warp.glassDisp * INT, notes, Q);
        MCP.rigs.setBy(wG, "Ambient", SPEC.warp.shadeAmbient, notes, Q);
        MCP.rigs.setBy(wG, "Diffuse", SPEC.warp.shadeDiffuse, notes, Q);
        MCP.rigs.setBy(wG, "Specular", SPEC.warp.shadeSpecular, notes, Q);
        MCP.rigs.setBy(wG, "Roughness", SPEC.warp.shadeRough, notes, Q);
        MCP.rigs.setBy(wG, "Metal", SPEC.warp.shadeMetal, notes, Q);
        var wVB = MCP.rigs.addEffect(warp, "CC Vector Blur", "CC Vector Blur");
        MCP.rigs.setBy(wVB, "Type", SPEC.warp.vbType, notes, Q);
        MCP.rigs.setBy(wVB, "Amount", SPEC.warp.vbAmount * INT, notes, Q);
        MCP.rigs.setBy(wVB, "Ridge Smoothness", SPEC.warp.vbRidge, notes, Q);
        MCP.rigs.setBy(wVB, "Vector Map", warpMap.index, notes, Q);
        MCP.rigs.setBy(wVB, "Property", SPEC.idx.vbPropLightness, notes, Q);
        MCP.rigs.setBy(wVB, "Map Softness", 0, notes, Q);
        MCP.rigs.setExpr(wVB, "Angle Offset", SPEC.warp.vbAngleExpr, notes, Q);
        MCP.rigs.opacityBell(warp, t0, mid, t1);
        MCP.rigs.log(notes, "Warp built.");
    }

    // ----- 4. CHROMATIC ABERRATION (CC Glass + Set Channels pair) ----------------------
    var aberr = null;
    if (opts.mods.aberration) {
        aberr = MCP.rigs.pwNewAdjustment(comp, "Aberrations", t0, t1);
        MCP.rigs.addEffect(aberr, "CC Glass", "CC Glass");                          // base glass (inherited look)
        var sc1 = MCP.rigs.addEffect(aberr, "ADBE Set Channels", "Set Channels");  // isolate GREEN
        var aG = MCP.rigs.addEffect(aberr, "CC Glass", "CC Glass");               // negative-displacement glass
        MCP.rigs.setBy(aG, "Bump Map", warpMap.index, notes, Q);
        MCP.rigs.setBy(aG, "Property", SPEC.idx.glassPropLightness, notes, Q);
        MCP.rigs.setBy(aG, "Softness", SPEC.aberration.glassSoftness, notes, Q);
        MCP.rigs.setBy(aG, "Height", SPEC.aberration.glassHeight, notes, Q);
        MCP.rigs.setBy(aG, "Displacement", SPEC.aberration.glassDisp * INT, notes, Q);
        var sc2 = MCP.rigs.addEffect(aberr, "ADBE Set Channels", "Set Channels");  // isolate RED
        // green pass: keep only source-layer-2 (self) -> Green
        MCP.rigs.setBy(sc1, "Source Layer 1", 0, notes, Q);
        MCP.rigs.setBy(sc1, "Source Layer 2", aberr.index, notes, Q);
        MCP.rigs.setBy(sc1, "Source Layer 3", 0, notes, Q);
        MCP.rigs.setBy(sc1, "Source Layer 4", 0, notes, Q);
        // red pass: keep only source-layer-1 (self) -> Red
        MCP.rigs.setBy(sc2, "Source Layer 1", aberr.index, notes, Q);
        MCP.rigs.setBy(sc2, "Source Layer 2", 0, notes, Q);
        MCP.rigs.setBy(sc2, "Source Layer 3", 0, notes, Q);
        MCP.rigs.setBy(sc2, "Source Layer 4", 0, notes, Q);
        MCP.rigs.opacityBell(aberr, t0, mid, t1);
        MCP.rigs.log(notes, "Chromatic Aberration built.");
    }

    // ----- 5. SHAKE (pseudo-3D parallax) ----------------------------------------------
    var shake = null;
    if (opts.mods.shake) {
        shake = MCP.rigs.pwNewAdjustment(comp, "Shake", t0, t1);
        var slider = MCP.rigs.addEffect(shake, "ADBE Slider Control", "Slider Control");
        var sProp = MCP.findProp(slider, "Slider");
        MCP.rigs.bell(sProp, t0, early, t1, 0, SPEC.shake.sliderPeak * INT);   // amplitude punch + decay
        var dm = MCP.rigs.addEffect(shake, "ADBE Displacement Map", "Displacement Map");
        MCP.rigs.setBy(dm, "Displacement Map Layer", shakeMap.index, notes, Q);
        MCP.rigs.setBy(dm, "Use For Horizontal Displacement", SPEC.idx.dispH, notes, Q);
        MCP.rigs.setBy(dm, "Use For Vertical Displacement", SPEC.idx.dispV, notes, Q);
        var wig = "wiggle(" + SPEC.shake.wiggleFreq + ",effect(\"Slider Control\")(\"Slider\"))";
        MCP.rigs.setExpr(dm, "Max Horizontal Displacement", wig, notes, Q);
        MCP.rigs.setExpr(dm, "Max Vertical Displacement", wig, notes, Q);
        MCP.rigs.log(notes, "Shake built.");
    }

    // ----- 6. FINE DISTORTIONS --------------------------------------------------------
    var fine = null;
    if (opts.mods.fine) {
        fine = MCP.rigs.pwNewAdjustment(comp, "Fine Distortions", t0, t1);
        var fG = MCP.rigs.addEffect(fine, "CC Glass", "CC Glass");
        MCP.rigs.setBy(fG, "Bump Map", fineMap.index, notes, Q);
        MCP.rigs.setBy(fG, "Property", SPEC.idx.glassPropLightness, notes, Q);
        MCP.rigs.setBy(fG, "Softness", SPEC.fine.glassSoftness, notes, Q);
        MCP.rigs.setBy(fG, "Height", SPEC.fine.glassHeight * INT, notes, Q);
        MCP.rigs.setBy(fG, "Displacement", SPEC.fine.glassDisp, notes, Q);
        MCP.rigs.opacityBell(fine, t0, mid, t1);
        MCP.rigs.log(notes, "Fine Distortions built.");
    }

    // ----- ORDER THE STACK (top -> bottom) -------------------------------------------
    var order = [];
    if (fine) { order.push(fine); }
    if (shake) { order.push(shake); }
    if (aberr) { order.push(aberr); }
    if (warp) { order.push(warp); }
    if (scan) { order.push(scan); }
    order.push(A);            // outgoing (Gradient Wipe)
    order.push(D);            // depth (referenced by Gradient Wipe)
    if (warpMap) { order.push(warpMap); }
    if (shakeMap) { order.push(shakeMap); }
    if (fineMap) { order.push(fineMap); }
    if (B) { order.push(B); }  // incoming, at the very bottom
    for (var i = order.length - 1; i >= 0; i--) {
        try { order[i].moveToBeginning(); } catch (eM) {}
    }

    D.enabled = false;        // depth map is a control source, not visible

    comp.time = mid;          // park the playhead mid-transition for instant preview

    var stackNames = [];
    for (var k = 0; k < order.length; k++) { stackNames.push(order[k].name); }

    return {
        composition: MCP.serialize.compRef(comp),
        window: { start: MCP.round(t0), end: MCP.round(t1), mid: MCP.round(mid), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1), duration: MCP.round(dur) },
        intensity: INT,
        modules: opts.mods,
        outgoing: MCP.serialize.layer(A),
        depth: MCP.serialize.layer(D),
        incoming: MCP.rigs.layerOrNull(B),
        created: {
            fineDistortions: MCP.rigs.layerOrNull(fine),
            shake: MCP.rigs.layerOrNull(shake),
            aberrations: MCP.rigs.layerOrNull(aberr),
            warp: MCP.rigs.layerOrNull(warp),
            scanLine: MCP.rigs.layerOrNull(scan),
            warpMap: MCP.rigs.layerOrNull(warpMap),
            shakeMap: MCP.rigs.layerOrNull(shakeMap),
            fineDistortionsMap: MCP.rigs.layerOrNull(fineMap)
        },
        stack: stackNames,
        notes: notes
    };
}, { mutating: true });
