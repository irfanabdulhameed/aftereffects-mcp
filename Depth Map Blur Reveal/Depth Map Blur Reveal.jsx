/**********************************************************************************************
 *  DEPTH MAP BLUR REVEAL  -  reusable builder panel for Adobe After Effects
 *  ------------------------------------------------------------------------------------------
 *  Recreates the "depth-map blur reveal" from the reference reel (the MEADOW resolving into
 *  focus - NOT the rectangle / text zoom). An image starts as a huge depth-weighted blur and
 *  RESOLVES INTO FOCUS, with the near foreground staying soft & bloomed longest while the
 *  distance sharpens first, lifted by an exposure ramp (dark -> bright) and a fading glow bloom.
 *  One click, fully customisable, re-runnable on any layer.
 *
 *  WHAT IT BUILDS  (on the SELECTED image layer, top -> bottom of the effect stack)
 *        Compound Blur  : depth-weighted blur. Its "Blur Layer" is either YOUR depth map or an
 *                         auto vertical gradient (white at the bottom = near = blurs longest).
 *                         "Maximum Blur" keyframes maxBlur -> 0, eased  => the reveal.
 *        Exposure (opt) : keyframes a negative exposure -> 0  => the dark-to-bright lift.
 *        Glow     (opt) : keyframes Glow Intensity high -> low  => the bloom that fades as it sharpens.
 *        Scale    (opt) : a gentle settle (e.g. 104% -> 100%) on the layer's own transform.
 *    + (auto mode) a hidden guide solid "DBR Depth (auto)" carrying a Gradient Ramp, used only
 *      as the Compound Blur source. Everything is ONE undo group; a single Ctrl/Cmd+Z reverts it.
 *
 *  HOW TO INSTALL / USE  ->  see "Depth Map Blur Reveal - GUIDE.md"
 *********************************************************************************************/

(function depthMapBlurReveal(thisObj) {

    var SCRIPT_NAME = "Depth Map Blur Reveal";
    var VERSION     = "1.0";

    /* =========================================================================================
     *  SPEC  -  defaults measured from the reference reel (meadow reveal ~0.8s @ 60fps).
     * =======================================================================================*/
    var SPEC = {
        comp      : { w: 1080, h: 1080, fps: 30, dur: 6 },   // used only when no comp is open
        maxBlur   : 120,     // Compound Blur "Maximum Blur" start value (-> 0)
        invert    : false,   // invert the depth so the OTHER end blurs longest
        autoDir   : "bottom",// auto-gradient near edge: bottom|top|left|right (which side blurs longest)

        useExp    : true,    // exposure lift on?
        expStart  : -2.0,    // Exposure start (stops) -> 0

        useGlow   : true,    // glow bloom on?
        glowStart : 2.5,     // Glow Intensity start
        glowEnd   : 0.0,     // Glow Intensity end
        glowRad   : 90,      // Glow Radius
        glowThr   : 50,      // Glow Threshold (%)

        useScale  : false,   // gentle scale settle on?
        scaleStart: 104,     // % of the layer's current scale at the start (-> 100% of current)

        start     : 0.0,     // reveal start time (s)  (or "at playhead")
        dur       : 0.8,     // reveal duration (s)
        ease      : 33,      // keyframe influence % (33 = Easy Ease, matches the sibling panels)

        // effect match-name fallbacks (AE version differences)
        mnCompound: [ "ADBE Compound Blur" ],
        mnGauss   : [ "ADBE Gaussian Blur 2", "ADBE Gaussian Blur" ],
        mnExposure: [ "ADBE Exposure2" ],
        mnGlow    : [ "ADBE Glo2" ],
        mnRamp    : [ "ADBE Ramp" ]
    };

    /* =========================================================================================
     *  LOW-LEVEL HELPERS  (shared idioms with the sibling builder panels)
     * =======================================================================================*/
    var LOG = [];
    function log(m){ LOG.push(m); }

    function activeComp(){
        var it = app.project ? app.project.activeItem : null;
        return (it && it instanceof CompItem) ? it : null;
    }

    // depth-first search for a property by display name, anywhere under `root`
    function findProp(root, name){
        var stack = [root];
        while (stack.length){
            var g = stack.pop(), n = 0;
            try { n = g.numProperties; } catch(e){ n = 0; }
            for (var i = 1; i <= n; i++){
                var p; try { p = g.property(i); } catch(e2){ continue; }
                if (!p) continue;
                if (p.name === name) return p;
                var isGroup = false;
                try { isGroup = (p.numProperties && p.numProperties > 0); } catch(e3){}
                if (isGroup) stack.push(p);
            }
        }
        return null;
    }

    function setBy(host, name, value){
        var p = findProp(host, name);
        if (!p) { log("  - could not find '" + name + "'"); return false; }
        try { p.setValue(value); return true; }
        catch(e){ log("  - '" + name + "' setValue failed: " + e.toString()); return false; }
    }

    // add the first available effect from a match-name list; null if none exist in this install
    function addEffect(layer, matchNames){
        var parade = layer.property("ADBE Effect Parade");
        for (var i = 0; i < matchNames.length; i++){
            if (parade.canAddProperty(matchNames[i]))
                return parade.addProperty(matchNames[i]);
        }
        return null;
    }

    // Easy-Ease every key. influence 0..100. Sizes the ease array to the property's dimensions.
    function easeKeys(prop, influence){
        var n = prop.numKeys; if (!n) return;
        var inf = Math.max(0.1, Math.min(100, influence));
        var dim = 1;
        try { dim = prop.isSpatial ? 1 : (prop.keyValue(1).length || 1); } catch(e){ dim = 1; }
        for (var i = 1; i <= n; i++){
            var ai = [], ao = [];
            for (var d = 0; d < dim; d++){
                ai.push(new KeyframeEase(0, (i === 1) ? 0.1 : inf));
                ao.push(new KeyframeEase(0, (i === n) ? 0.1 : inf));
            }
            try { prop.setTemporalEaseAtKey(i, ai, ao); } catch(e2){}
            try { prop.setInterpolationTypeAtKey(i, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER); } catch(e3){}
        }
    }

    // two-key animate a (already-resolved) property from v0 -> v1, eased
    function animProp(prop, t0, v0, t1, v1, ease){
        if (!prop) return false;
        try { prop.setValueAtTime(t0, v0); prop.setValueAtTime(t1, v1); easeKeys(prop, ease); return true; }
        catch(e){ log("  - keyframe failed on '" + (prop.name||"?") + "': " + e.toString()); return false; }
    }

    // resolve a named property under an effect, then two-key animate it
    function animBy(host, name, t0, v0, t1, v1, ease){
        var p = findProp(host, name);
        if (!p){ log("  - could not find '" + name + "' to animate"); return false; }
        return animProp(p, t0, v0, t1, v1, ease);
    }

    /* =========================================================================================
     *  DEPTH SOURCE  -  auto vertical/edge gradient on a hidden guide solid
     * =======================================================================================*/
    function makeAutoDepth(comp, dir){
        var sol = comp.layers.addSolid([0,0,0], "DBR Depth (auto)", comp.width, comp.height, 1.0, comp.duration);
        sol.moveToBeginning();
        var ramp = addEffect(sol, SPEC.mnRamp);
        if (!ramp) throw new Error("Gradient Ramp effect is not available - cannot build the auto depth map.");

        // white end = blurs longest (= near). Place white on the chosen edge.
        var w = comp.width, h = comp.height;
        var pts = {
            bottom: { s:[w/2, h], e:[w/2, 0] },
            top   : { s:[w/2, 0], e:[w/2, h] },
            left  : { s:[0, h/2], e:[w, h/2] },
            right : { s:[w, h/2], e:[0, h/2] }
        }[dir] || { s:[w/2, h], e:[w/2, 0] };

        setBy(ramp, "Start of Ramp",  pts.s);
        setBy(ramp, "Start Color",    [1,1,1,1]);
        setBy(ramp, "End of Ramp",    pts.e);
        setBy(ramp, "End Color",      [0,0,0,1]);
        setBy(ramp, "Ramp Shape",     1);              // 1 = Linear Ramp

        sol.guideLayer = true;     // excluded from final render
        sol.enabled    = false;    // hidden in the comp; Compound Blur still samples it
        return sol;
    }

    /* =========================================================================================
     *  MAIN BUILD
     * =======================================================================================*/
    function build(opts){
        LOG = [];
        var comp = opts.comp;

        app.beginUndoGroup(SCRIPT_NAME + " - Build");
        try {
            var sel = comp.selectedLayers;
            if (!sel.length) throw new Error("Select the IMAGE layer to reveal first.");
            var target = sel[0];   // topmost selected layer = the layer that gets the reveal

            // ---- 0.  Resolve the depth source ------------------------------------------------
            var depthLayer = null;
            if (opts.blurSource === "selected"){
                if (sel.length < 2)
                    throw new Error("Depth-map mode: select TWO layers - the image (on top) and its depth map.");
                depthLayer = sel[1];
                log("Depth source: selected layer '" + depthLayer.name + "'.");
            } else {
                depthLayer = makeAutoDepth(comp, opts.autoDir);
                log("Depth source: auto gradient ('" + opts.autoDir + "' edge stays soft longest).");
            }

            var t0 = opts.start, t1 = opts.start + opts.dur;

            // ---- 1.  Compound Blur (the depth-weighted reveal) -------------------------------
            var cb = addEffect(target, SPEC.mnCompound);
            if (cb){
                setBy(cb, "Blur Layer", depthLayer.index);
                setBy(cb, "Stretch Map to Fit", true);
                if (opts.invert) setBy(cb, "Invert Blur", true);
                if (!animBy(cb, "Maximum Blur", t0, opts.maxBlur, t1, 0, opts.ease))
                    animBy(cb, "Max Blur", t0, opts.maxBlur, t1, 0, opts.ease);  // name fallback
                log("Compound Blur: Maximum Blur " + opts.maxBlur + " -> 0.");
            } else {
                // fallback: plain Gaussian blur resolve (no depth weighting)
                var gb = addEffect(target, SPEC.mnGauss);
                if (!gb) throw new Error("Neither Compound Blur nor Gaussian Blur is available in this AE install.");
                animBy(gb, "Blurriness", t0, opts.maxBlur, t1, 0, opts.ease);
                if (opts.blurSource === "auto" && depthLayer) { depthLayer.remove(); }  // gradient unused
                log("Compound Blur unavailable - used Gaussian Blur (uniform, no depth weighting).");
            }

            // ---- 2.  Exposure lift (dark -> bright) ------------------------------------------
            if (opts.useExp){
                var ex = addEffect(target, SPEC.mnExposure);
                if (ex){
                    var exP = null;
                    try { exP = ex.property("Master").property("Exposure"); } catch(e){}
                    if (!exP) exP = findProp(ex, "Exposure");
                    animProp(exP, t0, opts.expStart, t1, 0, opts.ease);
                    log("Exposure: " + opts.expStart + " -> 0.");
                } else log("  - Exposure effect unavailable, skipped.");
            }

            // ---- 3.  Glow bloom (fades as it sharpens) ---------------------------------------
            if (opts.useGlow){
                var gl = addEffect(target, SPEC.mnGlow);
                if (gl){
                    setBy(gl, "Glow Radius", opts.glowRad);
                    setBy(gl, "Glow Threshold", opts.glowThr);
                    animBy(gl, "Glow Intensity", t0, opts.glowStart, t1, opts.glowEnd, opts.ease);
                    log("Glow: Intensity " + opts.glowStart + " -> " + opts.glowEnd + ".");
                } else log("  - Glow effect unavailable, skipped.");
            }

            // ---- 4.  Gentle scale settle (preserves the layer's current framing) -------------
            if (opts.useScale){
                var sc = target.property("ADBE Transform Group").property("ADBE Scale");
                var base = sc.value, from = [];
                for (var d = 0; d < base.length; d++) from.push(base[d] * (opts.scaleStart / 100));
                animProp(sc, t0, from, t1, base, opts.ease);
                log("Scale: " + opts.scaleStart + "% -> 100% of current.");
            }

            comp.openInViewer();
            log("Built on '" + target.name + "':  " + t0.toFixed(2) + "s -> " + t1.toFixed(2) + "s.");
        } finally {
            app.endUndoGroup();
        }
        return LOG;
    }

    /* =========================================================================================
     *  IN-PANEL GUIDE
     * =======================================================================================*/
    var GUIDE_TEXT = [
        "WHAT IT DOES",
        "Recreates the depth-map blur reveal from the reel: an image starts as a huge",
        "DEPTH-WEIGHTED blur and resolves into focus - the near foreground stays soft & bloomed",
        "longest while the distance sharpens first - lifted by an exposure ramp (dark -> bright)",
        "and a fading glow bloom. Re-runnable on any layer; one Ctrl/Cmd+Z undoes the whole rig.",
        "",
        "==============================  QUICK START  ==============================",
        "1.  Open a comp and add your image / footage.",
        "2.  SELECT the layer you want to reveal.",
        "      - Auto gradient mode: select just that one layer.",
        "      - Depth-map mode: select TWO layers - the image (on top) + its depth map.",
        "3.  Set Max blur, the look toggles (exposure / glow / scale) and the timing.",
        "4.  Click 'Build Depth Blur Reveal'. Preview, tweak, rebuild freely.",
        "",
        "==============================  THE RIG  ==================================",
        "Compound Blur     -- depth-weighted blur. Its 'Blur Layer' is your depth map OR an auto",
        "                     gradient (white edge = near = blurs longest). Maximum Blur: max -> 0.",
        "Exposure (opt)    -- a negative exposure ramps up to 0  => the dark-to-bright lift.",
        "Glow (opt)        -- Glow Intensity high -> low  => the bloom that fades as it sharpens.",
        "Scale (opt)       -- a gentle settle (e.g. 104% -> 100% of the layer's current scale).",
        "DBR Depth (auto)  -- a hidden guide solid carrying the Gradient Ramp (auto mode only).",
        "",
        "==============================  CONTROLS  =================================",
        "Max blur          -- Compound Blur 'Maximum Blur' start value (animates to 0). Ref ~120.",
        "Blur source       -- Auto gradient (no map needed) or a Selected depth-map layer.",
        "Near edge         -- which edge of the auto gradient stays soft longest (ref: bottom).",
        "Invert depth      -- swap which depths blur longest (use if your map reads inverted).",
        "Exposure start    -- starting stops (negative = dark). Ramps to 0. Ref ~-2.0.",
        "Glow start / end  -- Glow Intensity at the start and end of the reveal (ref 2.5 -> 0).",
        "Scale start %     -- start scale as a % of the layer's CURRENT scale (-> 100%).",
        "Start / Duration  -- when the reveal begins and how long it takes (seconds).",
        "Start at playhead -- ignore Start (s) and begin at the current time indicator.",
        "Ease (0-100)      -- keyframe influence. 33 = Easy Ease.",
        "",
        "========================  TIPS & TROUBLESHOOTING  =========================",
        "- No depth map? Leave Blur source on 'Auto gradient' - it fakes depth from a vertical ramp.",
        "- Foreground sharpening too soon / too late? Toggle 'Invert depth' or change 'Near edge'.",
        "- Want a flat blur (no depth weighting)? It auto-falls back to Gaussian if Compound Blur",
        "  is missing - or just point Blur source at a solid grey layer.",
        "- Bloom too strong? Lower Glow start, or raise Glow Threshold (less of the image blooms).",
        "- Reveal too slow / fast? Adjust Duration. Begin exactly on a beat with 'Start at playhead'.",
        "- Everything is one Undo group - tweak the controls and rebuild as often as you like."
    ].join("\n");

    function showGuide(){
        var g = new Window("dialog", SCRIPT_NAME + "  -  Guide");
        g.alignChildren = ["fill","top"]; g.margins = 16; g.spacing = 8;
        var title = g.add("statictext", undefined, SCRIPT_NAME);
        title.graphics.font = ScriptUI.newFont(title.graphics.font.name, ScriptUI.FontStyle.BOLD, 16);
        var body = g.add("edittext", undefined, GUIDE_TEXT, {multiline:true, readonly:true, scrolling:true});
        body.preferredSize = [620, 470];
        var foot = g.add("group"); foot.alignment = ["fill","bottom"]; foot.alignChildren = ["right","center"];
        var close = foot.add("button", undefined, "Close", {name:"ok"});
        close.onClick = function(){ g.close(); };
        g.center(); g.show();
    }

    /* =========================================================================================
     *  UI
     * =======================================================================================*/
    function buildUI(thisObj){
        var win = (thisObj instanceof Panel)
                ? thisObj
                : new Window("palette", SCRIPT_NAME + "  v" + VERSION, undefined, {resizeable:true});
        win.alignChildren = ["fill","top"]; win.spacing = 7; win.margins = 12;

        var head = win.add("group"); head.orientation = "row"; head.alignment = ["fill","top"];
        var headL = head.add("statictext", undefined, "Depth Map Blur Reveal"); headL.alignment = ["fill","center"];
        headL.graphics.font = ScriptUI.newFont(headL.graphics.font.name, ScriptUI.FontStyle.BOLD, 13);
        var infoBtn = head.add("button", undefined, "ⓘ Guide"); infoBtn.preferredSize = [78, 24];
        infoBtn.onClick = showGuide;

        win.add("statictext", undefined, "Resolves an image out of a depth-weighted blur to reveal it.", {multiline:true});
        var compLbl = win.add("statictext", undefined, "Active comp: -");

        function rowNum(parent, label, def, w){
            var r = parent.add("group"); r.alignment = ["fill","top"];
            var l = r.add("statictext", undefined, label); l.preferredSize.width = (w||128);
            var e = r.add("edittext", undefined, def); e.characters = 6;
            return e;
        }

        // 1. Blur
        var g1 = win.add("panel", undefined, "1.  Depth Blur"); g1.alignChildren = ["fill","top"]; g1.margins = 10; g1.spacing = 5;
        var etMax = rowNum(g1, "Max blur:", String(SPEC.maxBlur));
        var srcRow = g1.add("group"); srcRow.alignment = ["fill","top"];
        srcRow.add("statictext", undefined, "Blur source:").preferredSize.width = 128;
        var ddSrc = srcRow.add("dropdownlist", undefined, ["Auto gradient", "Selected depth layer"]);
        ddSrc.selection = 0;
        var dirRow = g1.add("group"); dirRow.alignment = ["fill","top"];
        dirRow.add("statictext", undefined, "Near (soft) edge:").preferredSize.width = 128;
        var ddDir = dirRow.add("dropdownlist", undefined, ["bottom", "top", "left", "right"]);
        ddDir.selection = 0;
        var cInv = g1.add("checkbox", undefined, "Invert depth"); cInv.value = SPEC.invert;
        ddSrc.onChange = function(){ var auto = (ddSrc.selection.index === 0); ddDir.enabled = auto; };

        // 2. Look
        var g2 = win.add("panel", undefined, "2.  Look"); g2.alignChildren = ["fill","top"]; g2.margins = 10; g2.spacing = 5;
        var cExp = g2.add("checkbox", undefined, "Exposure lift (dark -> bright)"); cExp.value = SPEC.useExp;
        var etExp = rowNum(g2, "  Exposure start:", String(SPEC.expStart));
        var cGlow = g2.add("checkbox", undefined, "Glow bloom (fades as it sharpens)"); cGlow.value = SPEC.useGlow;
        var etGS = rowNum(g2, "  Glow start:", String(SPEC.glowStart));
        var etGE = rowNum(g2, "  Glow end:", String(SPEC.glowEnd));
        var cScale = g2.add("checkbox", undefined, "Scale settle"); cScale.value = SPEC.useScale;
        var etSS = rowNum(g2, "  Scale start %:", String(SPEC.scaleStart));
        function syncLook(){
            etExp.enabled = cExp.value;
            etGS.enabled = etGE.enabled = cGlow.value;
            etSS.enabled = cScale.value;
        }
        cExp.onClick = cGlow.onClick = cScale.onClick = syncLook;

        // 3. Timing
        var g3 = win.add("panel", undefined, "3.  Timing"); g3.alignChildren = ["fill","top"]; g3.margins = 10; g3.spacing = 5;
        var etStart = rowNum(g3, "Start (s):", String(SPEC.start));
        var cPlay = g3.add("checkbox", undefined, "Start at playhead (ignore Start s)"); cPlay.value = false;
        var etDur = rowNum(g3, "Duration (s):", String(SPEC.dur));
        var etEase = rowNum(g3, "Ease (0-100):", String(SPEC.ease));
        cPlay.onClick = function(){ etStart.enabled = !cPlay.value; };

        var buildBtn = win.add("button", undefined, "Build Depth Blur Reveal"); buildBtn.alignment = ["fill","center"];
        var status = win.add("statictext", undefined, "Ready.", {multiline:true}); status.preferredSize.height = 40;

        function refresh(){
            var comp = activeComp();
            compLbl.text = "Active comp: " + (comp ? comp.name + "  (" + comp.width + "x" + comp.height + ")" : "- none open: a comp will be made -");
        }
        refresh(); syncLook();

        buildBtn.onClick = function(){
            var comp = activeComp();
            if (!comp){
                comp = app.project.items.addComp(SCRIPT_NAME, SPEC.comp.w, SPEC.comp.h, 1.0, SPEC.comp.dur, SPEC.comp.fps);
                comp.openInViewer(); refresh();
                status.text = "Made a new comp - add an image, select it, then Build again.";
                return;
            }
            var startT = cPlay.value ? comp.time : Math.max(0, parseFloat(etStart.text) || 0);
            var opts = {
                comp       : comp,
                maxBlur    : Math.max(0, parseFloat(etMax.text) || SPEC.maxBlur),
                blurSource : (ddSrc.selection.index === 1) ? "selected" : "auto",
                autoDir    : ddDir.selection ? ddDir.selection.text : SPEC.autoDir,
                invert     : cInv.value,
                useExp     : cExp.value,   expStart  : parseFloat(etExp.text) || 0,
                useGlow    : cGlow.value,  glowStart : parseFloat(etGS.text) || 0, glowEnd : parseFloat(etGE.text) || 0,
                glowRad    : SPEC.glowRad, glowThr   : SPEC.glowThr,
                useScale   : cScale.value, scaleStart: Math.max(1, parseFloat(etSS.text) || SPEC.scaleStart),
                start      : startT,
                dur        : Math.max(0.05, parseFloat(etDur.text) || SPEC.dur),
                ease       : Math.max(0, Math.min(100, parseFloat(etEase.text) || SPEC.ease))
            };
            try {
                build(opts);
                status.text = "Done. Reveal built into '" + comp.name + "'. Preview the comp.";
                if (LOG.join("").indexOf("  - ") !== -1) status.text += "  (Some steps were skipped - see notes.)";
            } catch(err){
                status.text = "Error: " + err.toString();
                alert("Build failed:\n" + err.toString() + "\n\nPress Ctrl/Cmd+Z if anything was half-built.");
            }
        };

        win.onResizing = win.onResize = function(){ try { this.layout.resize(); } catch(e){} };
        win.layout.layout(true); win.layout.resize();
        if (win instanceof Window){ win.minimumSize = [300, 360]; win.center(); win.show(); }
        return win;
    }

    buildUI(thisObj);

})(this);
