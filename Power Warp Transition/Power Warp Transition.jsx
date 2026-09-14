/**********************************************************************************************
 *  POWER WARP TRANSITION  -  reusable builder panel for Adobe After Effects
 *  ------------------------------------------------------------------------------------------
 *  Recreates the depth-map "Power Warp Transition" (VideoLancer technique) as a one-click rig.
 *
 *  WHAT IT DOES
 *    You give it 3 layers that already live in your comp:
 *        - Outgoing clip (A)   : the shot that warps away
 *        - Incoming clip (B)    : the shot revealed underneath  (optional)
 *        - Depth map            : grayscale depth pass of clip A (made in Photoshop, see guide)
 *    ...and it builds the full transition automatically:
 *        depth-driven Gradient Wipe, a glowing depth Scan-Line, a pseudo-3D Shake,
 *        the core CC-Glass + Vector-Blur Warp, Chromatic Aberration, and Fine Distortions.
 *    Everything is keyframed/expression-driven and trimmed to the transition window so it
 *    ramps in and out cleanly. Re-runnable on any comp.
 *
 *  REQUIREMENTS
 *    - After Effects (any reasonably modern version; uses only stock + bundled CC effects).
 *    - A depth map of clip A. The script cannot generate one (that needs Photoshop's
 *      Neural Filters > Depth Blur). See the included guide.
 *
 *  HOW TO INSTALL  ->  see "Power Warp Transition - GUIDE.md"
 *  ------------------------------------------------------------------------------------------
 *  This script only WRITES into the active comp when you press "Build Transition".
 *  Everything happens inside a single Undo group, so one Ctrl/Cmd+Z reverts the whole build.
 *********************************************************************************************/

(function powerWarpTransition(thisObj) {

    var SCRIPT_NAME = "Power Warp Transition";
    var VERSION     = "1.0";

    /* =========================================================================================
     *  SPEC  -  every number lifted from the tutorial, in one place so it is easy to tweak.
     *  (Distortion magnitudes flagged "* INT" are multiplied by the Intensity control.)
     * =======================================================================================*/
    var SPEC = {
        gradientWipe : { invert: true, softness: 0 },                         // Media Holder
        scanLine     : { blackSoft: 75, whiteSoft: 6,                          // Extract band sweep 0->255
                         glowThreshold: 60, glowRadius: 10, glowIntensity: 1 },
        shake        : { wiggleFreq: 20, sliderPeak: 79 },                     // sliderPeak * INT
        warp         : { glassSoftness: 18, glassHeight: 100, glassDisp: 500,  // height,disp,vbAmount * INT
                         vbType: 3 /*Perpendicular*/, vbAmount: 250,
                         vbRidge: 0.95, vbAngleExpr: "wiggle(16,360)",
                         shadeAmbient:100, shadeDiffuse:0, shadeSpecular:0, shadeRough:0.025, shadeMetal:100 },
        aberration   : { glassSoftness: 12.6, glassHeight: 55.8, glassDisp: -500 }, // glassDisp * INT
        fine         : { glassSoftness: 1, glassHeight: 35, glassDisp: 500,    // glassHeight * INT
                         tnScale: 200, tnEvoExpr: "wiggle(16,350)",
                         tn1Contrast: 100, tn1Complexity: 4,
                         tn2Contrast: 50,  tn2Complexity: 14 },
        // map-prep (Extract crush + blur) values for each depth-derived source layer
        warpMap      : { bp:199, wp:199, bs:116, ws:6, boxBlur:15 },
        shakeMap     : { bp:223, wp:223, bs:215, ws:80, boxBlur:3 },
        fineMap      : { bp:212, wp:212, bs:104, ws:6, boxBlur:15 },
        // popup index guesses (guarded - effect still works if AE numbers these differently)
        idx : { dispH:1 /*Red*/, dispV:2 /*Green*/, glassPropLightness:5,
                vbPropLightness:5, glowOpScreen:3, glowCompBehind:2,
                tnFractalSwirly:4, tnNoiseSpline:3, tnBlendMultiply:3, tnBlendSoftLight:10 }
    };

    /* =========================================================================================
     *  LOW-LEVEL HELPERS
     * =======================================================================================*/
    var LOG = [];
    function log(m){ LOG.push(m); }

    function activeComp(){
        var it = app.project ? app.project.activeItem : null;
        return (it && it instanceof CompItem) ? it : null;
    }

    function snap(comp, t){ return Math.round(t * comp.frameRate) / comp.frameRate; }

    // depth-first search for a leaf/group property by display name (robust to effect grouping)
    function findProp(root, name){
        var stack = [root];
        while (stack.length){
            var g = stack.pop();
            var n = 0;
            try { n = g.numProperties; } catch(e){ n = 0; }
            for (var i = 1; i <= n; i++){
                var p;
                try { p = g.property(i); } catch(e2){ continue; }
                if (!p) continue;
                if (p.name === name) return p;
                var isGroup = false;
                try { isGroup = (p.numProperties && p.numProperties > 0); } catch(e3){}
                if (isGroup) stack.push(p);
            }
        }
        return null;
    }

    function addEffect(layer, matchName, niceName){
        var parade = layer.property("ADBE Effect Parade");
        if (!parade.canAddProperty(matchName)){
            throw new Error("Effect unavailable: " + (niceName || matchName));
        }
        return parade.addProperty(matchName);
    }

    // set a leaf value found by name anywhere under host; returns true on success
    function setBy(host, name, value){
        var p = findProp(host, name);
        if (!p) { log("  ? could not find '" + name + "'"); return false; }
        try { p.setValue(value); return true; }
        catch(e){ log("  ? '" + name + "' setValue failed: " + e.toString()); return false; }
    }

    function setExpr(host, name, expr){
        var p = findProp(host, name);
        if (!p) return false;
        try { p.expression = expr; return true; } catch(e){ log("  ? expr on '"+name+"' failed"); return false; }
    }

    function easeKey(prop, i){
        try {
            prop.setInterpolationTypeAtKey(i, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            prop.setTemporalEaseAtKey(i, [new KeyframeEase(0, 33.3333)], [new KeyframeEase(0, 33.3333)]);
        } catch(e){}
    }

    // two-keyframe ramp  v0 -> v1  over [t0,t1]
    function ramp(host, name, t0, v0, t1, v1){
        var p = findProp(host, name);
        if (!p) { log("  ? ramp target '"+name+"' missing"); return; }
        p.setValueAtTime(t0, v0);
        p.setValueAtTime(t1, v1);
        easeKey(p, p.nearestKeyIndex(t0));
        easeKey(p, p.nearestKeyIndex(t1));
    }

    // three-keyframe bell  base -> peak -> base  (peak at tPeak)
    function bell(prop, t0, tPeak, t1, base, peak){
        if (!prop) return;
        prop.setValueAtTime(t0,   base);
        prop.setValueAtTime(tPeak, peak);
        prop.setValueAtTime(t1,   base);
        easeKey(prop, prop.nearestKeyIndex(t0));
        easeKey(prop, prop.nearestKeyIndex(tPeak));
        easeKey(prop, prop.nearestKeyIndex(t1));
    }

    function opacityProp(layer){
        return layer.property("ADBE Transform Group").property("ADBE Opacity");
    }
    // ramp an adjustment layer's effect in & out via opacity bell 0 -> 100 -> 0
    function opacityBell(layer, t0, tPeak, t1){
        bell(opacityProp(layer), t0, tPeak, t1, 0, 100);
    }

    function newAdjustment(comp, name, t0, t1){
        var L = comp.layers.addSolid([0,0,0], name, comp.width, comp.height, comp.pixelAspect, comp.duration);
        L.adjustmentLayer = true;
        L.name = name;
        L.inPoint  = t0;
        L.outPoint = t1;
        return L;
    }

    // duplicate the depth layer, strip any inherited effects, rename -> a fresh map source
    function newDepthCopy(depthLayer, name){
        var L = depthLayer.duplicate();
        L.name = name;
        var fx = L.property("ADBE Effect Parade");
        while (fx.numProperties > 0) fx.property(1).remove();   // start clean
        return L;
    }

    /* =========================================================================================
     *  MAP BUILDERS  (depth-derived grayscale source layers, video OFF)
     * =======================================================================================*/
    function buildMapBase(layer, m){           // Extract crush -> black Solid Composite -> Fast Box Blur
        var ex = addEffect(layer, "ADBE Extract", "Extract");
        setBy(ex, "Black Point", m.bp); setBy(ex, "White Point", m.wp);
        setBy(ex, "Black Softness", m.bs); setBy(ex, "White Softness", m.ws);
        var sc = addEffect(layer, "ADBE Solid Composite", "Solid Composite");
        setBy(sc, "Color", [0,0,0]);
        var fb = addEffect(layer, "ADBE Box Blur2", "Fast Box Blur");
        setBy(fb, "Blur Radius", m.boxBlur); setBy(fb, "Iterations", 3);
        setBy(fb, "Repeat Edge Pixels", true);
        return layer;
    }

    /* =========================================================================================
     *  MAIN BUILD
     * =======================================================================================*/
    function build(opts){
        LOG = [];
        var comp = opts.comp;
        var A = opts.outgoing, B = opts.incoming, D = opts.depth;
        var INT = opts.intensity;

        var t0 = snap(comp, opts.start);
        var t1 = snap(comp, opts.start + opts.duration);
        if (t1 <= t0) throw new Error("Duration must be greater than 0.");
        var dur   = t1 - t0;
        var mid   = t0 + dur * 0.5;
        var early = t0 + dur * 0.12;                       // shake punches early then decays

        app.beginUndoGroup(SCRIPT_NAME + " - Build");
        try {
            // ----- depth-derived source layers (built first; referenced later by index) -------
            var warpMap = null, shakeMap = null, fineMap = null;

            if (opts.mods.warp || opts.mods.aberration){
                warpMap = newDepthCopy(D, "Warp Map");
                buildMapBase(warpMap, SPEC.warpMap);
                // Compound Blur (self-referencing) sits before the box blur in the tutorial;
                // we add it after for simpler ordering - visually equivalent smoothing.
                try {
                    var cb = addEffect(warpMap, "ADBE Compound Blur", "Compound Blur");
                    setBy(cb, "Blur Layer", warpMap.index);
                    setBy(cb, "Maximum Blur", 200);
                    setBy(cb, "Stretch Map to Fit", true);
                } catch(eCB){ log("Warp Map: Compound Blur skipped (" + eCB.toString() + ")"); }
                warpMap.enabled = false;
            }

            if (opts.mods.shake){
                shakeMap = newDepthCopy(D, "Shake Map");
                buildMapBase(shakeMap, SPEC.shakeMap);
                shakeMap.enabled = false;
            }

            if (opts.mods.fine){
                fineMap = newDepthCopy(D, "Fine Distortions Map");
                // Extract -> Solid Composite -> Turbulent Noise -> Fast Box Blur -> Turbulent Noise 2
                var fx = addEffect(fineMap, "ADBE Extract", "Extract");
                setBy(fx, "Black Point", SPEC.fineMap.bp); setBy(fx, "White Point", SPEC.fineMap.wp);
                setBy(fx, "Black Softness", SPEC.fineMap.bs); setBy(fx, "White Softness", SPEC.fineMap.ws);
                var fsc = addEffect(fineMap, "ADBE Solid Composite", "Solid Composite");
                setBy(fsc, "Color", [0,0,0]);
                var tn1 = addEffect(fineMap, "ADBE Turbulent Noise", "Turbulent Noise");
                setBy(tn1, "Fractal Type", SPEC.idx.tnFractalSwirly);
                setBy(tn1, "Noise Type",   SPEC.idx.tnNoiseSpline);
                setBy(tn1, "Contrast",     SPEC.fine.tn1Contrast);
                setBy(tn1, "Complexity",   SPEC.fine.tn1Complexity);
                setBy(tn1, "Scale",        SPEC.fine.tnScale);
                setBy(tn1, "Blending Mode", SPEC.idx.tnBlendMultiply);
                setExpr(tn1, "Evolution",  SPEC.fine.tnEvoExpr);
                var ffb = addEffect(fineMap, "ADBE Box Blur2", "Fast Box Blur");
                setBy(ffb, "Blur Radius", SPEC.fineMap.boxBlur); setBy(ffb, "Iterations", 3);
                setBy(ffb, "Repeat Edge Pixels", true);
                var tn2 = addEffect(fineMap, "ADBE Turbulent Noise", "Turbulent Noise");
                setBy(tn2, "Fractal Type", SPEC.idx.tnFractalSwirly);
                setBy(tn2, "Noise Type",   SPEC.idx.tnNoiseSpline);
                setBy(tn2, "Contrast",     SPEC.fine.tn2Contrast);
                setBy(tn2, "Complexity",   SPEC.fine.tn2Complexity);
                setBy(tn2, "Scale",        SPEC.fine.tnScale);
                setBy(tn2, "Blending Mode", SPEC.idx.tnBlendSoftLight);
                setExpr(tn2, "Evolution",  SPEC.fine.tnEvoExpr);
                fineMap.enabled = false;
            }

            // ----- 1. GRADIENT WIPE on the outgoing clip --------------------------------------
            var gw = addEffect(A, "ADBE Gradient Wipe", "Gradient Wipe");
            setBy(gw, "Transition Softness", SPEC.gradientWipe.softness);
            setBy(gw, "Gradient Layer", D.index);
            setBy(gw, "Invert Gradient", SPEC.gradientWipe.invert);
            ramp(gw, "Transition Completion", t0, 0, t1, 100);
            log("Gradient Wipe applied to '" + A.name + "'.");

            // ----- 2. SCAN LINE (depth copy, Add) ---------------------------------------------
            var scan = null;
            if (opts.mods.scanLine){
                scan = newDepthCopy(D, "Scan Line");
                var sEx = addEffect(scan, "ADBE Extract", "Extract");
                setBy(sEx, "Black Softness", SPEC.scanLine.blackSoft);
                setBy(sEx, "White Softness", SPEC.scanLine.whiteSoft);
                ramp(sEx, "Black Point", t0, 0, t1, 255);     // the band sweeps near -> far
                ramp(sEx, "White Point", t0, 0, t1, 255);
                var sFill = addEffect(scan, "ADBE Fill", "Fill");
                setBy(sFill, "Color", [1,1,1]);
                var sSC = addEffect(scan, "ADBE Solid Composite", "Solid Composite");
                setBy(sSC, "Color", [0,0,0]);
                var sTint = addEffect(scan, "ADBE Tint", "Tint");
                setBy(sTint, "Map White To", opts.scanColor);
                setBy(sTint, "Amount to Tint", 100);
                var sGlow = addEffect(scan, "ADBE Glo2", "Glow");
                setBy(sGlow, "Glow Threshold", SPEC.scanLine.glowThreshold);
                setBy(sGlow, "Glow Radius",    SPEC.scanLine.glowRadius);
                setBy(sGlow, "Glow Intensity", SPEC.scanLine.glowIntensity);
                setBy(sGlow, "Composite Original", SPEC.idx.glowCompBehind);
                setBy(sGlow, "Glow Operation",     SPEC.idx.glowOpScreen);
                scan.blendingMode = BlendingMode.ADD;
                scan.inPoint = t0; scan.outPoint = t1;
                scan.enabled = true;
                // short opacity fade so the Add band doesn't pop
                var sOp = opacityProp(scan);
                sOp.setValueAtTime(t0, 0);
                sOp.setValueAtTime(t0 + dur*0.12, 100);
                sOp.setValueAtTime(t1 - dur*0.12, 100);
                sOp.setValueAtTime(t1, 0);
                log("Scan Line built.");
            }

            // ----- 3. WARP (core distortion adjustment) ---------------------------------------
            var warp = null;
            if (opts.mods.warp){
                warp = newAdjustment(comp, "Warp", t0, t1);
                var wG = addEffect(warp, "CC Glass", "CC Glass");
                setBy(wG, "Bump Map", warpMap.index);
                setBy(wG, "Property", SPEC.idx.glassPropLightness);
                setBy(wG, "Softness", SPEC.warp.glassSoftness);
                setBy(wG, "Height",   SPEC.warp.glassHeight * INT);
                setBy(wG, "Displacement", SPEC.warp.glassDisp * INT);
                setBy(wG, "Ambient",  SPEC.warp.shadeAmbient);
                setBy(wG, "Diffuse",  SPEC.warp.shadeDiffuse);
                setBy(wG, "Specular", SPEC.warp.shadeSpecular);
                setBy(wG, "Roughness",SPEC.warp.shadeRough);
                setBy(wG, "Metal",    SPEC.warp.shadeMetal);
                var wVB = addEffect(warp, "CC Vector Blur", "CC Vector Blur");
                setBy(wVB, "Type",   SPEC.warp.vbType);
                setBy(wVB, "Amount", SPEC.warp.vbAmount * INT);
                setBy(wVB, "Ridge Smoothness", SPEC.warp.vbRidge);
                setBy(wVB, "Vector Map", warpMap.index);
                setBy(wVB, "Property", SPEC.idx.vbPropLightness);
                setBy(wVB, "Map Softness", 0);
                setExpr(wVB, "Angle Offset", SPEC.warp.vbAngleExpr);
                opacityBell(warp, t0, mid, t1);
                log("Warp built.");
            }

            // ----- 4. CHROMATIC ABERRATION (CC Glass + Set Channels pair) ----------------------
            var aberr = null;
            if (opts.mods.aberration){
                aberr = newAdjustment(comp, "Aberrations", t0, t1);
                addEffect(aberr, "CC Glass", "CC Glass");                 // base glass (inherited look)
                var sc1 = addEffect(aberr, "ADBE Set Channels", "Set Channels");  // isolate GREEN
                var aG  = addEffect(aberr, "CC Glass", "CC Glass");        // negative-displacement glass
                setBy(aG, "Bump Map", warpMap.index);
                setBy(aG, "Property", SPEC.idx.glassPropLightness);
                setBy(aG, "Softness", SPEC.aberration.glassSoftness);
                setBy(aG, "Height",   SPEC.aberration.glassHeight);
                setBy(aG, "Displacement", SPEC.aberration.glassDisp * INT);
                var sc2 = addEffect(aberr, "ADBE Set Channels", "Set Channels");  // isolate RED
                // green pass : keep only source-layer-2 (self) -> Green
                setBy(sc1, "Source Layer 1", 0);
                setBy(sc1, "Source Layer 2", aberr.index);
                setBy(sc1, "Source Layer 3", 0);
                setBy(sc1, "Source Layer 4", 0);
                // red pass : keep only source-layer-1 (self) -> Red
                setBy(sc2, "Source Layer 1", aberr.index);
                setBy(sc2, "Source Layer 2", 0);
                setBy(sc2, "Source Layer 3", 0);
                setBy(sc2, "Source Layer 4", 0);
                opacityBell(aberr, t0, mid, t1);
                log("Chromatic Aberration built.");
            }

            // ----- 5. SHAKE (pseudo-3D parallax) ----------------------------------------------
            var shake = null;
            if (opts.mods.shake){
                shake = newAdjustment(comp, "Shake", t0, t1);
                var slider = addEffect(shake, "ADBE Slider Control", "Slider Control");
                var sProp = findProp(slider, "Slider");
                bell(sProp, t0, early, t1, 0, SPEC.shake.sliderPeak * INT);   // amplitude punch + decay
                var dm = addEffect(shake, "ADBE Displacement Map", "Displacement Map");
                setBy(dm, "Displacement Map Layer", shakeMap.index);
                setBy(dm, "Use For Horizontal Displacement", SPEC.idx.dispH);
                setBy(dm, "Use For Vertical Displacement",   SPEC.idx.dispV);
                var wig = "wiggle(" + SPEC.shake.wiggleFreq + ",effect(\"Slider Control\")(\"Slider\"))";
                setExpr(dm, "Max Horizontal Displacement", wig);
                setExpr(dm, "Max Vertical Displacement",   wig);
                log("Shake built.");
            }

            // ----- 6. FINE DISTORTIONS --------------------------------------------------------
            var fine = null;
            if (opts.mods.fine){
                fine = newAdjustment(comp, "Fine Distortions", t0, t1);
                var fG = addEffect(fine, "CC Glass", "CC Glass");
                setBy(fG, "Bump Map", fineMap.index);
                setBy(fG, "Property", SPEC.idx.glassPropLightness);
                setBy(fG, "Softness", SPEC.fine.glassSoftness);
                setBy(fG, "Height",   SPEC.fine.glassHeight * INT);
                setBy(fG, "Displacement", SPEC.fine.glassDisp);
                opacityBell(fine, t0, mid, t1);
                log("Fine Distortions built.");
            }

            // ----- ORDER THE STACK  (top -> bottom) -------------------------------------------
            var order = [];
            if (fine)    order.push(fine);
            if (shake)   order.push(shake);
            if (aberr)   order.push(aberr);
            if (warp)    order.push(warp);
            if (scan)    order.push(scan);
            order.push(A);            // outgoing (Gradient Wipe)
            order.push(D);            // depth (referenced by Gradient Wipe)
            if (warpMap)  order.push(warpMap);
            if (shakeMap) order.push(shakeMap);
            if (fineMap)  order.push(fineMap);
            if (B) order.push(B);     // incoming, at the very bottom
            for (var i = order.length - 1; i >= 0; i--){
                try { order[i].moveToBeginning(); } catch(eM){}
            }

            D.enabled = false;        // depth map is a control source, not visible

            comp.time = mid;          // park the playhead mid-transition for instant preview
        } finally {
            app.endUndoGroup();
        }
        return LOG;
    }

    /* =========================================================================================
     *  IN-PANEL GUIDE  (opened by the top-right "Guide" button)
     * =======================================================================================*/
    var LINKEDIN = "http://www.linkedin.com/in/irfan-abdul-hameed-a81b98230";

    function openURL(url){
        try {
            if ($.os.indexOf("Windows") !== -1) system.callSystem('cmd.exe /c start "" "' + url + '"');
            else system.callSystem('open "' + url + '"');
        } catch(e){ alert("Copy this link into your browser:\n" + url); }
    }

    var GUIDE_TEXT = [
        "WHAT IT DOES",
        "Builds the entire depth-map 'Power Warp Transition' in your active comp with one click:",
        "a depth Gradient Wipe, a glowing Scan-Line, a pseudo-3D Shake, the CC-Glass Warp,",
        "Chromatic Aberration and Fine Distortions -- all keyframed and trimmed to the transition.",
        "",
        "==============================  QUICK START  ==============================",
        "1.  Put your OUTGOING clip (A) and INCOMING clip (B) on layers in a comp.",
        "2.  Add a DEPTH MAP of clip A as a layer (see below).",
        "3.  Click 'Refresh layer list', then choose A / B / Depth in the dropdowns.",
        "4.  Set Start + Duration, pick Intensity and Scan color.",
        "5.  Click 'Build Transition'.  The playhead parks mid-transition for instant preview.",
        "6.  Press Ctrl/Cmd+Z to undo the whole build, then tweak and rebuild.",
        "",
        "============================  MAKE A DEPTH MAP  ===========================",
        "The look is driven by a grayscale depth map of clip A (white = near, black = far).",
        "The script can't make it for you -- create it once in Photoshop:",
        "",
        "Still / single frame:",
        "   - In AE:  Composition > Save Frame As > File   (or open clip A's image).",
        "   - Photoshop:  Filter > Neural Filters > Depth Blur > tick 'Output depth map only'.",
        "   - Flatten, Save As PNG/PSD, import into AE, drop it on a layer.",
        "",
        "Video footage (needs a map per frame):",
        "   - Render clip A as a PNG sequence.",
        "   - In Photoshop, record an Action of the Depth Blur step above.",
        "   - File > Automate > Batch  ->  run the Action over the whole sequence.",
        "   - Import the result back into AE as one PNG-sequence footage item.",
        "   - Tip: any depth source works (3D render, Runway / MiDaS depth, etc.).",
        "",
        "==============================  CONTROLS  =================================",
        "Outgoing (A)  --  the clip that warps away; gets the Gradient Wipe.  (required)",
        "Incoming (B)  --  the clip revealed underneath.  (optional)",
        "Depth map     --  grayscale depth pass of clip A; drives everything.  (required)",
        "Start (sec)   --  when the transition begins; 'Use playhead' copies current time.",
        "Duration (s)  --  length of the transition (about 1.0-2.0 s works best).",
        "Intensity     --  master distortion strength.  0.5 subtle / 1.0 tutorial / 2.0 extreme.",
        "Scan color    --  RGB of the glowing depth scan-line (default electric blue).",
        "Modules       --  turn individual layers on/off (Gradient Wipe is always on).",
        "",
        "========================  TIPS & TROUBLESHOOTING  =========================",
        "- Preview heavy?  It's a big effect stack -- drop comp resolution to 1/2 while working.",
        "- Warp/scan looks off?  On the map references (CC Glass 'Bump Map', Gradient Wipe",
        "  'Gradient Layer') check the small dropdown beside the layer reads 'Effects & Masks'",
        "  (for maps) or 'Source' (for the gradient wipe).  Scripting can't always set that menu.",
        "- Wipe goes the wrong way?  Toggle 'Invert Gradient' on clip A's Gradient Wipe.",
        "- Hard pop at the edges?  Increase Duration, or use a smoother depth map.",
        "- Re-runnable on any comp;  one Undo clears a whole build."
    ].join("\n");

    function showGuide(){
        var g = new Window("dialog", "Power Warp Transition  -  Guide");
        g.alignChildren = ["fill","top"]; g.margins = 16; g.spacing = 8;

        var title = g.add("statictext", undefined, "Power Warp Transition");
        title.graphics.font = ScriptUI.newFont(title.graphics.font.name, ScriptUI.FontStyle.BOLD, 16);

        var by = g.add("statictext", undefined, "Created by Irfan Abdul Hameed");
        by.graphics.font = ScriptUI.newFont(by.graphics.font.name, ScriptUI.FontStyle.BOLD, 11);

        var cRow = g.add("group"); cRow.alignment = ["left","top"]; cRow.spacing = 8;
        cRow.add("statictext", undefined, "Connect with me:");
        var lk = cRow.add("button", undefined, "  Open LinkedIn  ");
        lk.onClick = function(){ openURL(LINKEDIN); };

        var url = g.add("edittext", undefined, LINKEDIN, {readonly:true});
        url.alignment = ["fill","top"];
        url.helpTip = "Select and copy this link";

        var body = g.add("edittext", undefined, GUIDE_TEXT, {multiline:true, readonly:true, scrolling:true});
        body.preferredSize = [560, 420];

        var foot = g.add("group"); foot.alignment = ["fill","bottom"]; foot.alignChildren = ["right","center"];
        var close = foot.add("button", undefined, "Close", {name:"ok"});
        close.onClick = function(){ g.close(); };

        g.center();
        g.show();
    }

    /* =========================================================================================
     *  UI
     * =======================================================================================*/
    function buildUI(thisObj){
        var win = (thisObj instanceof Panel)
                ? thisObj
                : new Window("palette", SCRIPT_NAME + "  v" + VERSION, undefined, {resizeable:true});
        win.alignChildren = ["fill","top"];
        win.spacing = 8;
        win.margins = 12;

        // --- header (title + top-right info/Guide button) ---
        var head = win.add("group");
        head.orientation = "row";
        head.alignment = ["fill","top"];
        var headL = head.add("statictext", undefined, "Power Warp Transition");
        headL.alignment = ["fill","center"];
        headL.graphics.font = ScriptUI.newFont(headL.graphics.font.name, ScriptUI.FontStyle.BOLD, 13);
        var infoBtn = head.add("button", undefined, "ⓘ Guide");   // circled-i + label
        infoBtn.preferredSize = [78, 24];
        infoBtn.helpTip = "How to use + credits (Irfan Abdul Hameed)";
        infoBtn.onClick = showGuide;

        var hdr = win.add("statictext", undefined,
            "Builds the full depth-map transition in the active comp.", {multiline:true});

        var compLbl = win.add("statictext", undefined, "Active comp: -");

        // --- layer assignment ---
        var gAssign = win.add("panel", undefined, "1.  Layers");
        gAssign.alignChildren = ["fill","top"]; gAssign.margins = 10; gAssign.spacing = 6;
        function rowDD(parent, label){
            var r = parent.add("group"); r.alignment = ["fill","top"];
            var l = r.add("statictext", undefined, label); l.preferredSize.width = 95;
            var dd = r.add("dropdownlist", undefined, []); dd.alignment = ["fill","top"];
            return dd;
        }
        var ddA = rowDD(gAssign, "Outgoing (A):");
        var ddB = rowDD(gAssign, "Incoming (B):");
        var ddD = rowDD(gAssign, "Depth map:");
        var refreshBtn = gAssign.add("button", undefined, "Refresh layer list");

        // --- timing ---
        var gTime = win.add("panel", undefined, "2.  Timing");
        gTime.alignChildren = ["fill","top"]; gTime.margins = 10; gTime.spacing = 6;
        function rowNum(parent, label, def, hint){
            var r = parent.add("group"); r.alignment = ["fill","top"];
            var l = r.add("statictext", undefined, label); l.preferredSize.width = 95;
            var e = r.add("edittext", undefined, def); e.preferredSize.width = 60; e.characters = 6;
            if (hint){ var h = r.add("statictext", undefined, hint); h.alignment=["fill","center"]; }
            return e;
        }
        var etStart = rowNum(gTime, "Start (sec):", "0.5", "where the transition begins");
        var etDur   = rowNum(gTime, "Duration (s):", "1.5", "length of the transition");
        var useCurBtn = gTime.add("button", undefined, "Use playhead as Start");

        // --- look ---
        var gLook = win.add("panel", undefined, "3.  Look");
        gLook.alignChildren = ["fill","top"]; gLook.margins = 10; gLook.spacing = 6;
        var etInt = rowNum(gLook, "Intensity:", "1.0", "0.5 = subtle ... 2.0 = extreme");
        var rgbRow = gLook.add("group"); rgbRow.alignment = ["fill","top"];
        var rgbL = rgbRow.add("statictext", undefined, "Scan color:"); rgbL.preferredSize.width = 95;
        var etR = rgbRow.add("edittext", undefined, "0");   etR.characters = 4;
        var etG = rgbRow.add("edittext", undefined, "90");  etG.characters = 4;
        var etB = rgbRow.add("edittext", undefined, "255"); etB.characters = 4;
        var swatch = rgbRow.add("panel"); swatch.preferredSize = [24,18];
        swatch.fillBrush = [0, 90/255, 1, 1];
        swatch.onDraw = function(){
            var g = this.graphics;
            try {
                var b = g.newBrush(g.BrushType.SOLID_COLOR, this.fillBrush);
                g.newPath(); g.rectPath(0, 0, this.size.width, this.size.height); g.fillPath(b);
            } catch(e){}
        };
        function paintSwatch(){
            swatch.fillBrush = [ (parseInt(etR.text,10)||0)/255, (parseInt(etG.text,10)||0)/255, (parseInt(etB.text,10)||0)/255, 1 ];
            try { swatch.hide(); swatch.show(); } catch(e){}   // force a repaint (no .notify() needed)
        }
        etR.onChanging = etG.onChanging = etB.onChanging = paintSwatch;

        // --- modules ---
        var gMods = win.add("panel", undefined, "4.  Modules");
        gMods.alignChildren = ["left","top"]; gMods.margins = 10; gMods.spacing = 2;
        var col = gMods.add("group"); col.orientation = "column"; col.alignChildren = ["left","top"];
        var cGW = col.add("checkbox", undefined, "Gradient Wipe (always on)"); cGW.value = true; cGW.enabled = false;
        var cScan = col.add("checkbox", undefined, "Depth Scan-Line");      cScan.value = true;
        var cWarp = col.add("checkbox", undefined, "Warp (CC Glass)");      cWarp.value = true;
        var cAber = col.add("checkbox", undefined, "Chromatic Aberration"); cAber.value = true;
        var cShk  = col.add("checkbox", undefined, "Pseudo-3D Shake");      cShk.value  = true;
        var cFine = col.add("checkbox", undefined, "Fine Distortions");     cFine.value = true;

        // --- actions ---
        var gAct = win.add("group"); gAct.alignment = ["fill","top"];
        var buildBtn = gAct.add("button", undefined, "Build Transition"); buildBtn.alignment = ["fill","center"];

        var status = win.add("statictext", undefined, "Ready.", {multiline:true});
        status.preferredSize.height = 30;

        var credit = win.add("statictext", undefined, "Power Warp Transition  ·  by Irfan Abdul Hameed");
        credit.alignment = ["center","bottom"];

        // --- populate dropdowns from active comp ---
        function fillDD(dd, includeNone, guessName){
            var prev = dd.selection ? dd.selection.text : null;
            dd.removeAll();
            var comp = activeComp();
            if (includeNone) dd.add("item", "(none)");
            if (comp){
                for (var i = 1; i <= comp.numLayers; i++) dd.add("item", i + ". " + comp.layer(i).name);
            }
            // restore previous pick, else guess by name, else first
            var picked = false;
            if (prev){ for (var a=0;a<dd.items.length;a++){ if (dd.items[a].text===prev){ dd.selection=a; picked=true; break; } } }
            if (!picked && guessName){
                for (var b=0;b<dd.items.length;b++){
                    if (dd.items[b].text.toLowerCase().indexOf(guessName) !== -1){ dd.selection=b; picked=true; break; }
                }
            }
            if (!picked && dd.items.length) dd.selection = 0;
        }
        function refresh(){
            var comp = activeComp();
            compLbl.text = "Active comp: " + (comp ? comp.name + "  (" + comp.width + "x" + comp.height + ", " + comp.frameRate.toFixed(2) + " fps)" : "- none open -");
            fillDD(ddA, false, null);
            fillDD(ddB, true,  null);
            fillDD(ddD, false, "depth");
            if (ddB.items.length > 2) ddB.selection = 2;     // default incoming = 2nd layer
        }
        refreshBtn.onClick = refresh;
        useCurBtn.onClick = function(){ var c = activeComp(); if (c) etStart.text = (c.time).toFixed(2); };

        buildBtn.onClick = function(){
            var comp = activeComp();
            if (!comp){ alert("Open a composition first."); return; }
            if (!ddA.selection){ alert("Pick the Outgoing (A) layer."); return; }
            if (!ddD.selection){ alert("Pick the Depth map layer."); return; }

            var idxA = parseInt(ddA.selection.text, 10);
            var idxD = parseInt(ddD.selection.text, 10);
            var idxB = (ddB.selection && ddB.selection.index > 0) ? parseInt(ddB.selection.text, 10) : 0;
            if (idxA === idxD){ alert("Outgoing and Depth map must be different layers."); return; }
            if (idxB === idxA || idxB === idxD) idxB = 0;   // ignore an Incoming that collides with A/Depth

            var opts = {
                comp: comp,
                outgoing: comp.layer(idxA),
                depth:    comp.layer(idxD),
                incoming: idxB ? comp.layer(idxB) : null,
                start:    parseFloat(etStart.text) || 0,
                duration: parseFloat(etDur.text)   || 1.5,
                intensity:Math.max(0, parseFloat(etInt.text) || 1),
                scanColor:[ (parseInt(etR.text,10)||0)/255, (parseInt(etG.text,10)||0)/255, (parseInt(etB.text,10)||0)/255 ],
                mods: { scanLine:cScan.value, warp:cWarp.value, aberration:cAber.value, shake:cShk.value, fine:cFine.value }
            };
            try {
                build(opts);
                status.text = "Done. Built into '" + comp.name + "'. Playhead parked mid-transition - preview now.";
                if (LOG.join("").indexOf("?") !== -1){
                    status.text += "  (Some popups used defaults - see notes.)";
                }
            } catch(err){
                status.text = "Error: " + err.toString();
                alert("Build failed:\n" + err.toString() + "\n\nNothing was left half-built - press Undo if needed.");
            }
        };

        refresh();
        paintSwatch();

        if (win instanceof Window){ win.center(); win.show(); }
        else { win.layout.layout(true); win.layout.resize(); }
        return win;
    }

    buildUI(thisObj);

})(this);
