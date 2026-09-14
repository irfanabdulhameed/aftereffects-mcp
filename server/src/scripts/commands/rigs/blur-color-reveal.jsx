/*
 * rigBlurColorReveal: the "Blur Color Reveal" builder panel
 * (panels/blur-color-reveal/Blur Color Reveal.jsx) as a bridge command. Same
 * SPEC, same two blurred ellipses, same alpha matte, same optional control
 * null. Differences from the panel: the content layers are explicit references
 * (the panel used the selection, falling back to layer 1), origin is an
 * optional [x, y] (the panel had an "Origin = centre" checkbox plus X/Y), and
 * the composition must exist.
 */

MCP.rigs.BLUR_COLOR_SPEC = {
    core     : [251, 248, 149],     // fill colour (pale yellow, from the reference)
    ring     : [173, 215, 255],     // stroke colour (light blue, from the reference)
    ringW    : 200,                 // stroke width in px (0 = single-colour disc)
    blur     : 80,                  // Fast Box Blur radius (soft edges)
    sizeMul  : 1.5,                 // ellipse size = comp size * this (before scale anim)
    endScale : 120,                 // Scale animates 0% -> this %
    start    : 0.0,
    dur      : 1.3,
    ease     : 33,
    nullFrom : 80,
    nullTo   : 90,
    boxBlurMatchNames: ["ADBE Box Blur2", "ADBE Box Blur"]
};

MCP.rigs.describe({
    tool: "rig-blur-color-reveal",
    name: "Blur Color Reveal",
    panel: "panels/blur-color-reveal/Blur Color Reveal.jsx",
    summary: "A soft-edged two-tone colour disc blooms outward from a point (scale 0% -> 120%, eased) over the content to wipe-reveal it: a pale core with a coloured ring, both blurred, the ring clipped to a matching alpha matte so it reads as a clean soft disc.",
    builds: [
        "BR Reveal Matte: a Fast Box Blurred plain white ellipse (comp size * sizeMultiplier) used as the alpha matte, scale 0% -> endScale% eased.",
        "BR Reveal Color: the same ellipse with a core fill and an optional ring stroke, Fast Box Blurred, alpha-matted by the matte, same scale animation.",
        "BR Content (optional): the content layers precomposed so they stay tidy underneath.",
        "BR Control (optional): a null at the comp centre both ellipses are parented to, with an optional scale push nullFrom% -> nullTo% ending 0.8 s after the reveal."
    ],
    layerOrder: ["BR Control (optional)", "BR Reveal Matte", "BR Reveal Color", "content (BR Content when precomposed)"],
    requires: ["A composition with at least one layer: the content to reveal."],
    optional: [],
    parameters: [
        { name: "layers", "default": "layer 1", description: "LayerRef or array of LayerRefs: the content to reveal. Defaults to the top layer." },
        { name: "precompose", "default": true, description: "Precompose the content layers into 'BR Content' first." },
        { name: "core", "default": [251, 248, 149], description: "Fill colour at the centre of the disc." },
        { name: "ring", "default": [173, 215, 255], description: "Stroke colour of the rim." },
        { name: "ringWidth", "default": 200, description: "Stroke thickness in pixels; 0 gives a single-colour disc." },
        { name: "blur", "default": 80, description: "Fast Box Blur radius (edge softness)." },
        { name: "sizeMultiplier", "default": 1.5, description: "Ellipse size as a multiple of the comp size." },
        { name: "endScale", "default": 120, description: "Scale percent the bloom grows to." },
        { name: "start", "default": 0, description: "Reveal start in seconds." },
        { name: "duration", "default": 1.3, description: "Reveal length in seconds (minimum 0.1)." },
        { name: "ease", "default": 33, description: "Keyframe influence 0 to 100; 33 is Easy Ease." },
        { name: "origin", "default": "comp centre", description: "[x, y] the disc grows from, in comp pixels." },
        { name: "addControlNull", "default": false, description: "Parent both ellipses to a 'BR Control' null." },
        { name: "nullPush", "default": false, description: "Animate the null's scale for a subtle push-in (needs addControlNull)." },
        { name: "nullFrom", "default": 80, description: "Null scale percent at the start of the push." },
        { name: "nullTo", "default": 90, description: "Null scale percent at the end of the push." },
        { name: "openInViewer", "default": true, description: "Open the composition in the viewer after building." }
    ],
    fixedValues: { fastBoxBlur: { iterations: 3, blurDimensions: "Horizontal and Vertical (1)", repeatEdgePixels: true }, matteFill: "white", trackMatte: "alpha" },
    returns: "content layer summary, precomposed comp ref, colorLayer, matteLayer, controlNull, the reveal window, notes."
});

/** Fast Box Blur + Scale bloom (0% -> end), eased: applied identically to matte and colour. */
MCP.rigs.bcrRigLayer = function (L, opts, origin, notes) {
    var SPEC = MCP.rigs.BLUR_COLOR_SPEC;
    var fbb = MCP.rigs.addFirstEffect(L, SPEC.boxBlurMatchNames);
    if (!fbb) { MCP.fail("Fast Box Blur / Box Blur effect is not available in this After Effects install.", "not-found"); }
    MCP.rigs.setBy(fbb, "Blur Radius", opts.blur, notes);
    MCP.rigs.setBy(fbb, "Iterations", 3, notes);
    MCP.rigs.setBy(fbb, "Blur Dimensions", 1, notes);        // Horizontal and Vertical
    MCP.rigs.setBy(fbb, "Repeat Edge Pixels", true, notes);  // matches reference

    var tg = L.property("ADBE Transform Group");
    tg.property("ADBE Position").setValue(origin);

    var sc = tg.property("ADBE Scale");
    var t0 = opts.start, t1 = opts.start + opts.dur;
    sc.setValueAtTime(t0, [0, 0]);
    sc.setValueAtTime(t1, [opts.endScale, opts.endScale]);
    MCP.rigs.easeKeys(sc, opts.ease);
};

MCP.register("rigBlurColorReveal", function (args) {
    var SPEC = MCP.rigs.BLUR_COLOR_SPEC;
    var notes = [];
    var comp = MCP.resolveComp(args.comp);

    if (comp.numLayers < 1) {
        MCP.fail("This comp has no layers. Add your content (card / dashboard / footage) first.", "not-found");
    }

    var originArg = args.origin;
    var originCenter = !MCP.isDefined(originArg);
    var opts = {
        core: MCP.rigs.color(args.core, SPEC.core),
        ring: MCP.rigs.color(args.ring, SPEC.ring),
        ringW: Math.max(0, MCP.num(args.ringWidth, SPEC.ringW)),
        blur: Math.max(0, MCP.num(args.blur, SPEC.blur)),
        sizeMul: Math.max(0.1, MCP.num(args.sizeMultiplier, SPEC.sizeMul)),
        endScale: Math.max(1, MCP.num(args.endScale, SPEC.endScale)),
        start: Math.max(0, MCP.num(args.start, SPEC.start)),
        dur: Math.max(0.1, MCP.num(args.duration, SPEC.dur)),
        ease: Math.max(0, Math.min(100, MCP.num(args.ease, SPEC.ease))),
        originCenter: originCenter,
        originX: originCenter ? comp.width / 2 : MCP.num(originArg[0], comp.width / 2),
        originY: originCenter ? comp.height / 2 : MCP.num(originArg[1], comp.height / 2),
        precompose: MCP.bool(args.precompose, true),
        addNull: MCP.bool(args.addControlNull, false),
        nullPush: MCP.bool(args.nullPush, false),
        nullFrom: MCP.num(args.nullFrom, SPEC.nullFrom),
        nullTo: MCP.num(args.nullTo, SPEC.nullTo),
        openInViewer: MCP.bool(args.openInViewer, true)
    };

    // ---- 0. Resolve CONTENT (optionally precompose for tidiness) ---------------------
    var sel = [];
    if (MCP.isDefined(args.layers)) {
        sel = MCP.resolveLayers(comp, args.layers);
    }
    var content = null, pcComp = null;
    if (opts.precompose) {
        var idx = [];
        if (sel.length) { for (var s = 0; s < sel.length; s++) { idx.push(sel[s].index); } }
        else { idx = [comp.layer(1).index]; }
        pcComp = comp.layers.precompose(idx, "BR Content", true);  // returns a CompItem
        for (var li = 1; li <= comp.numLayers; li++) {
            var cl = comp.layer(li);
            if (cl.source === pcComp || cl.name === "BR Content") { content = cl; break; }
        }
        if (!content) { content = comp.layer(1); }
        MCP.rigs.log(notes, "Precomposed " + idx.length + " layer(s) into 'BR Content'.");
    } else {
        content = (sel.length ? sel[0] : comp.layer(1));
        MCP.rigs.log(notes, "Content layer: '" + content.name + "'.");
    }

    // ---- 1. Build the two ellipses (colour created first -> matte ends up above it) ---
    var W = comp.width * opts.sizeMul;
    var H = comp.height * opts.sizeMul;
    var origin = opts.originCenter ? [comp.width / 2, comp.height / 2] : [opts.originX, opts.originY];

    var color = MCP.rigs.makeEllipse(comp, "BR Reveal Color", W, H, opts.core, opts.ring, opts.ringW);
    var matte = MCP.rigs.makeEllipse(comp, "BR Reveal Matte", W, H, MCP.color.from255([255, 255, 255]), null, 0);
    // both are now at the very top of the comp (matte above colour), above the content

    MCP.rigs.bcrRigLayer(color, opts, origin, notes);
    MCP.rigs.bcrRigLayer(matte, opts, origin, notes);

    MCP.rigs.setAlphaMatte(color, matte, notes);   // colour clipped to the soft blurred matte disc
    MCP.rigs.log(notes, "Reveal built: ellipse bloom 0% -> " + opts.endScale + "% , blur " + opts.blur +
        " , " + opts.start.toFixed(2) + "s -> " + (opts.start + opts.dur).toFixed(2) + "s.");

    // ---- 2. (optional) parent both to a control null for a subtle scene push ----------
    var nul = null;
    if (opts.addNull) {
        nul = comp.layers.addNull(comp.duration);
        nul.name = "BR Control";
        // anchor == position == comp centre -> net-zero offset to children, pivot at centre
        nul.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([comp.width / 2, comp.height / 2]);
        nul.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
        nul.moveToBeginning();
        color.parent = nul; matte.parent = nul;
        if (opts.nullPush) {
            var ns = nul.property("ADBE Transform Group").property("ADBE Scale");
            ns.setValueAtTime(opts.start, [opts.nullFrom, opts.nullFrom]);
            ns.setValueAtTime(opts.start + opts.dur + 0.8, [opts.nullTo, opts.nullTo]);
            MCP.rigs.easeKeys(ns, opts.ease);
        }
        MCP.rigs.log(notes, "Control null added (both ellipses parented).");
    }

    if (opts.openInViewer) { comp.openInViewer(); }

    return {
        composition: MCP.serialize.compRef(comp),
        content: MCP.serialize.layer(content),
        precomposed: pcComp ? MCP.serialize.compRef(pcComp) : null,
        colorLayer: MCP.serialize.layer(color),
        matteLayer: MCP.serialize.layer(matte),
        controlNull: MCP.rigs.layerOrNull(nul),
        origin: [origin[0], origin[1]],
        window: { start: MCP.round(opts.start), end: MCP.round(opts.start + opts.dur), startFrame: MCP.frameOf(comp, opts.start), endFrame: MCP.frameOf(comp, opts.start + opts.dur), duration: MCP.round(opts.dur) },
        settings: { ringWidth: opts.ringW, blur: opts.blur, sizeMultiplier: opts.sizeMul, endScale: opts.endScale, ease: opts.ease, ellipseSize: [W, H] },
        notes: notes
    };
}, { mutating: true });
