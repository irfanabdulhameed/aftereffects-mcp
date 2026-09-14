/*
 * rigEdgeGlow: the "Edge Glow" builder panel (panels/edge-glow/Edge Glow.jsx)
 * as a bridge command. Same SPEC, same three shape layers, same effect stacks,
 * same ordering. Differences from the panel: the composition must already
 * exist (CompRef, active by default) instead of being created, and every UI
 * control is an argument with the panel's default.
 */

MCP.rigs.EDGE_GLOW_SPEC = {
    rect        : { w: 718, h: 142, round: 28, strokeW: 3 },
    lightSweep  : { width: 88, edgeThickness: 4, edgeIntensity: 100, sweepIntensity: 0, speed: 50 },
    gradient    : { blend: 100, jitter: 0, opacity: 100 },
    shadow      : { opacity: 50, direction: -36, distance: 100, softness: 525 },
    deepGlow    : { radius: 1000, exposure: 1.0 },
    glowFallback: { threshold: 50, radius: 80, intensity: 1.5 },
    idx         : { lightReceptionCutout: 3 },
    colors      : { gradA: [236, 0, 200], gradB: [120, 40, 255], fill: [0, 0, 0],
                    halo1: [255, 0, 0], halo2: [0, 0, 255], halo3: [255, 255, 255] },
    deepGlowMatchNames: [
        "PluginEverything Deep Glow 2", "Plugin Everything Deep Glow 2",
        "PluginEverything Deep Glow",   "Plugin Everything Deep Glow",
        "Deep Glow 2", "Deep Glow"
    ]
};

MCP.rigs.describe({
    tool: "rig-edge-glow",
    name: "Edge Glow",
    panel: "panels/edge-glow/Edge Glow.jsx",
    summary: "A rounded-rectangle badge with a glowing two-colour gradient rim, an animated light sweep travelling around the edge, a dark inner panel and a soft three-colour halo behind it.",
    builds: [
        "EG Stroke: rounded-rect outline carrying CC Light Sweep (edge intensity 100, cutout, Direction = time * speed), 4-Color Gradient (corners 1 and 3 = colour A, 2 and 4 = colour B) and Deep Glow (built-in Glow if Deep Glow is missing).",
        "EG Fill: the same rounded rect filled solid (the inner panel).",
        "EG Glow: the same rounded rect at the bottom with three stacked Drop Shadows (the coloured halo).",
        "EG Background (optional): a black solid under everything."
    ],
    layerOrder: ["EG Stroke", "EG Fill", "EG Glow", "EG Background (optional)"],
    requires: ["An open composition (or comp reference). Nothing else needs to exist."],
    optional: ["Deep Glow by Plugin Everything. Without it the rig uses the built-in Glow (threshold 50, radius 80, intensity 1.5) and reports which one it used."],
    parameters: [
        { name: "width", "default": 718, description: "Rectangle width in pixels." },
        { name: "height", "default": 142, description: "Rectangle height in pixels." },
        { name: "roundness", "default": 28, description: "Corner radius in pixels." },
        { name: "strokeWidth", "default": 3, description: "Outline thickness in pixels." },
        { name: "gradientA", "default": [236, 0, 200], description: "Rim colour for gradient corners 1 and 3." },
        { name: "gradientB", "default": [120, 40, 255], description: "Rim colour for gradient corners 2 and 4." },
        { name: "fillColor", "default": [0, 0, 0], description: "Inner panel colour." },
        { name: "halo1", "default": [255, 0, 0], description: "First drop-shadow halo colour." },
        { name: "halo2", "default": [0, 0, 255], description: "Second drop-shadow halo colour." },
        { name: "halo3", "default": [255, 255, 255], description: "Third drop-shadow halo colour." },
        { name: "haloDistance", "default": 100, description: "Drop Shadow distance in pixels." },
        { name: "haloSoftness", "default": 525, description: "Drop Shadow softness." },
        { name: "haloDirection", "default": -36, description: "Drop Shadow direction in degrees." },
        { name: "sweepWidth", "default": 88, description: "CC Light Sweep width." },
        { name: "edgeIntensity", "default": 100, description: "CC Light Sweep edge intensity." },
        { name: "animate", "default": true, description: "Add the expression time * speed to the sweep Direction." },
        { name: "speed", "default": 50, description: "Degrees per second for the sweep expression." },
        { name: "addBackground", "default": false, description: "Add a black solid named EG Background at the bottom." },
        { name: "openInViewer", "default": true, description: "Open the composition in the viewer after building." }
    ],
    fixedValues: {
        lightSweep: { edgeThickness: 4, sweepIntensity: 0, lightColor: [1, 1, 1, 1], lightReception: "Cutout (popup index 3)" },
        gradient: { blend: 100, jitter: 0, opacity: 100 },
        shadowOpacity: "50% (128 of 255)",
        deepGlow: { radius: 1000, exposure: 1 },
        glowFallback: { threshold: 50, radius: 80, intensity: 1.5 }
    },
    returns: "stroke, fill, glow and background layer summaries, glowUsed, notes."
});

MCP.register("rigEdgeGlow", function (args) {
    var SPEC = MCP.rigs.EDGE_GLOW_SPEC;
    var notes = [];
    var comp = MCP.resolveComp(args.comp);

    var opts = {
        rect: {
            w: Math.max(1, MCP.num(args.width, SPEC.rect.w)),
            h: Math.max(1, MCP.num(args.height, SPEC.rect.h)),
            round: Math.max(0, MCP.num(args.roundness, SPEC.rect.round)),
            strokeW: Math.max(0.1, MCP.num(args.strokeWidth, SPEC.rect.strokeW))
        },
        gradA: MCP.rigs.color(args.gradientA, SPEC.colors.gradA),
        gradB: MCP.rigs.color(args.gradientB, SPEC.colors.gradB),
        fillColor: MCP.rigs.color(args.fillColor, SPEC.colors.fill),
        shadow1: MCP.rigs.color(args.halo1, SPEC.colors.halo1),
        shadow2: MCP.rigs.color(args.halo2, SPEC.colors.halo2),
        shadow3: MCP.rigs.color(args.halo3, SPEC.colors.halo3),
        shadowDist: MCP.num(args.haloDistance, SPEC.shadow.distance),
        shadowSoft: MCP.num(args.haloSoftness, SPEC.shadow.softness),
        shadowDir: MCP.num(args.haloDirection, SPEC.shadow.direction),
        sweepWidth: MCP.num(args.sweepWidth, SPEC.lightSweep.width),
        edgeIntensity: MCP.num(args.edgeIntensity, SPEC.lightSweep.edgeIntensity),
        animate: MCP.bool(args.animate, true),
        speed: MCP.num(args.speed, SPEC.lightSweep.speed),
        addBG: MCP.bool(args.addBackground, false),
        openInViewer: MCP.bool(args.openInViewer, true)
    };

    var cx = comp.width / 2, cy = comp.height / 2;
    var hw = opts.rect.w / 2, hh = opts.rect.h / 2;

    // optional black background
    var bg = null;
    if (opts.addBG) {
        bg = comp.layers.addSolid([0, 0, 0], "EG Background", comp.width, comp.height, comp.pixelAspect, comp.duration);
        bg.moveToEnd();
    }

    // ----- 3. GLOW layer (built first so it ends up at the bottom) ---------------------
    var glow = MCP.rigs.makeRoundRect(comp, "EG Glow", {
        w: opts.rect.w, h: opts.rect.h, round: opts.rect.round,
        useFill: true, fillColor: MCP.color.from255([0, 0, 0]), useStroke: false
    });
    var shadowColors = [opts.shadow1, opts.shadow2, opts.shadow3];
    for (var s = 0; s < 3; s++) {
        var ds = MCP.rigs.addEffect(glow, "ADBE Drop Shadow", "Drop Shadow");
        MCP.rigs.setBy(ds, "Shadow Color", shadowColors[s], notes);
        MCP.rigs.setBy(ds, "Opacity", Math.round(SPEC.shadow.opacity / 100 * 255), notes); // Drop Shadow opacity is 0..255
        MCP.rigs.setBy(ds, "Direction", opts.shadowDir, notes);
        MCP.rigs.setBy(ds, "Distance", opts.shadowDist, notes);
        MCP.rigs.setBy(ds, "Softness", opts.shadowSoft, notes);
    }
    MCP.rigs.log(notes, "Glow layer: 3 Drop Shadows applied.");

    // ----- 2. FILL layer (the dark inner panel) ----------------------------------------
    var fill = MCP.rigs.makeRoundRect(comp, "EG Fill", {
        w: opts.rect.w, h: opts.rect.h, round: opts.rect.round,
        useFill: true, fillColor: opts.fillColor, useStroke: false
    });

    // ----- 1. STROKE layer (the glowing edge) ------------------------------------------
    var stroke = MCP.rigs.makeRoundRect(comp, "EG Stroke", {
        w: opts.rect.w, h: opts.rect.h, round: opts.rect.round,
        useFill: false, useStroke: true, strokeColor: MCP.color.from255([0, 0, 0]), strokeW: opts.rect.strokeW
    });

    //   CC Light Sweep
    var ls = MCP.rigs.addEffect(stroke, "CC Light Sweep", "CC Light Sweep");
    MCP.rigs.setBy(ls, "Center", [cx, cy], notes);
    MCP.rigs.setBy(ls, "Width", opts.sweepWidth, notes);
    MCP.rigs.setBy(ls, "Sweep Intensity", SPEC.lightSweep.sweepIntensity, notes);
    MCP.rigs.setBy(ls, "Edge Intensity", opts.edgeIntensity, notes);
    MCP.rigs.setBy(ls, "Edge Thickness", SPEC.lightSweep.edgeThickness, notes);
    MCP.rigs.setBy(ls, "Light Color", [1, 1, 1, 1], notes);
    MCP.rigs.setBy(ls, "Light Reception", SPEC.idx.lightReceptionCutout, notes);
    if (opts.animate) { MCP.rigs.setExpr(ls, "Direction", "time*" + opts.speed, notes); }
    MCP.rigs.log(notes, "CC Light Sweep applied" + (opts.animate ? " (animated)." : "."));

    //   4-Color Gradient: points pinned to the rectangle corners, 1&3=A, 2&4=B
    var g4 = MCP.rigs.addEffect(stroke, "ADBE 4ColorGradient", "4-Color Gradient");
    MCP.rigs.setBy(g4, "Point 1", [cx - hw, cy - hh], notes);  MCP.rigs.setBy(g4, "Color 1", opts.gradA, notes); // top-left
    MCP.rigs.setBy(g4, "Point 2", [cx + hw, cy - hh], notes);  MCP.rigs.setBy(g4, "Color 2", opts.gradB, notes); // top-right
    MCP.rigs.setBy(g4, "Point 3", [cx - hw, cy + hh], notes);  MCP.rigs.setBy(g4, "Color 3", opts.gradA, notes); // bottom-left
    MCP.rigs.setBy(g4, "Point 4", [cx + hw, cy + hh], notes);  MCP.rigs.setBy(g4, "Color 4", opts.gradB, notes); // bottom-right
    MCP.rigs.setBy(g4, "Blend", SPEC.gradient.blend, notes);
    MCP.rigs.setBy(g4, "Jitter", SPEC.gradient.jitter, notes);
    MCP.rigs.setBy(g4, "Opacity", SPEC.gradient.opacity, notes);
    MCP.rigs.log(notes, "4-Color Gradient applied.");

    //   Deep Glow (with graceful fallback to built-in Glow)
    var glowUsed, glowMatchName;
    var dg = MCP.fx.addFirstAvailable(stroke, SPEC.deepGlowMatchNames);
    if (dg) {
        MCP.rigs.setBy(dg.effect, "Radius", SPEC.deepGlow.radius, notes);
        MCP.rigs.setBy(dg.effect, "Exposure", SPEC.deepGlow.exposure, notes);
        glowUsed = "Deep Glow (" + dg.matchName + ")";
        glowMatchName = dg.matchName;
        MCP.rigs.log(notes, "Deep Glow applied (" + dg.matchName + ").");
    } else {
        var gl = MCP.rigs.addEffect(stroke, "ADBE Glo2", "Glow");
        MCP.rigs.setBy(gl, "Glow Threshold", SPEC.glowFallback.threshold, notes);
        MCP.rigs.setBy(gl, "Glow Radius", SPEC.glowFallback.radius, notes);
        MCP.rigs.setBy(gl, "Glow Intensity", SPEC.glowFallback.intensity, notes);
        glowUsed = "built-in Glow";
        glowMatchName = "ADBE Glo2";
        MCP.rigs.log(notes, "Deep Glow not installed -> used built-in Glow instead.");
    }

    // ----- ORDER (top -> bottom): Stroke, Fill, Glow ----------------------------------
    stroke.moveToBeginning();
    fill.moveAfter(stroke);
    glow.moveAfter(fill);

    if (opts.openInViewer) { comp.openInViewer(); }

    return {
        composition: MCP.serialize.compRef(comp),
        stroke: MCP.serialize.layer(stroke),
        fill: MCP.serialize.layer(fill),
        glow: MCP.serialize.layer(glow),
        background: MCP.rigs.layerOrNull(bg),
        glowUsed: glowUsed,
        glowMatchName: glowMatchName,
        rect: { width: opts.rect.w, height: opts.rect.h, roundness: opts.rect.round, strokeWidth: opts.rect.strokeW, center: [cx, cy] },
        notes: notes
    };
}, { mutating: true });
