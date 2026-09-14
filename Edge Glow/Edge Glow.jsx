/**********************************************************************************************
 *  EDGE GLOW  -  reusable builder panel for Adobe After Effects
 *  ------------------------------------------------------------------------------------------
 *  Recreates the "Edge Glow" look (glowing gradient-rimmed rounded rectangle with an animated
 *  light sweep and a soft coloured halo) as a one-click rig.
 *
 *  WHAT IT BUILDS  (exactly what the tutorial does, in one click)
 *    Three shape layers, top -> bottom:
 *        1. EG Stroke   : rounded-rect OUTLINE (no fill) carrying the glowing edge.
 *                         - CC Light Sweep   (edge intensity 100, cutout, animated sweep)
 *                         - 4-Color Gradient (corners 1&3 = colour A, 2&4 = colour B)
 *                         - Deep Glow        (falls back to AE's built-in Glow if not installed)
 *        2. EG Fill     : the same rounded-rect filled solid (the dark inner panel).
 *        3. EG Glow     : the same rounded-rect again, sent to the bottom, carrying three
 *                         stacked Drop Shadows (red / blue / white) that bloom the coloured halo.
 *    (Optional) a black background solid underneath everything.
 *
 *  Everything is built inside ONE Undo group, so a single Ctrl/Cmd+Z reverts the whole thing.
 *  Re-runnable on any comp. If no comp is open it makes a 1920x1080 / 30fps one for you.
 *
 *  HOW TO INSTALL / USE  ->  see "Edge Glow - GUIDE.md"
 *********************************************************************************************/

(function edgeGlow(thisObj) {

    var SCRIPT_NAME = "Edge Glow";
    var VERSION     = "1.0";

    /* =========================================================================================
     *  SPEC  -  every number lifted from the tutorial, in one place so it is easy to tweak.
     * =======================================================================================*/
    var SPEC = {
        comp        : { w: 1920, h: 1080, fps: 30, dur: 10 },     // used only when no comp is open
        rect        : { w: 718, h: 142, round: 28, strokeW: 3 },  // tutorial rectangle
        lightSweep  : { width: 88, edgeThickness: 4, edgeIntensity: 100, sweepIntensity: 0,
                        speed: 50 },                               // Direction = time * speed
        gradient    : { blend: 100, jitter: 0, opacity: 100 },
        shadow      : { opacity: 50, direction: -36, distance: 100, softness: 525 },
        deepGlow    : { radius: 1000, exposure: 1.0 },
        glowFallback: { threshold: 50, radius: 80, intensity: 1.5 }, // built-in Glow if no Deep Glow
        // CC Light Sweep "Light Reception" popup -> Cutout (Add=1, Composite=2, Cutout=3)
        idx         : { lightReceptionCutout: 3 },
        // candidate match names for the Deep Glow plugin (Plugin Everything), tried in order
        deepGlowMatchNames: [
            "PluginEverything Deep Glow 2", "Plugin Everything Deep Glow 2",
            "PluginEverything Deep Glow",   "Plugin Everything Deep Glow",
            "Deep Glow 2", "Deep Glow"
        ]
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

    // [r,g,b] 0..255  ->  [r,g,b,1] 0..1   (AE colour properties are 4-channel, 0..1)
    function col(rgb){ return [ (rgb[0]||0)/255, (rgb[1]||0)/255, (rgb[2]||0)/255, 1 ]; }

    // depth-first search for a property by display name (robust to effect/popup grouping)
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
        if (!p) { log("  - could not find '" + name + "'"); return false; }
        try { p.setValue(value); return true; }
        catch(e){ log("  - '" + name + "' setValue failed: " + e.toString()); return false; }
    }

    function setExpr(host, name, expr){
        var p = findProp(host, name);
        if (!p) { log("  - expr target '" + name + "' missing"); return false; }
        try { p.expression = expr; return true; } catch(e){ log("  - expr on '"+name+"' failed"); return false; }
    }

    /* =========================================================================================
     *  SHAPE BUILDER  -  a centred rounded rectangle layer (fill and/or stroke)
     * =======================================================================================*/
    function makeRoundRect(comp, name, o){
        var L = comp.layers.addShape();
        L.name = name;

        var root = L.property("ADBE Root Vectors Group");
        var grp  = root.addProperty("ADBE Vector Group");
        grp.name = "Rectangle";
        var vg   = grp.property("ADBE Vectors Group");

        var rect = vg.addProperty("ADBE Vector Shape - Rect");
        rect.property("ADBE Vector Rect Size").setValue([o.w, o.h]);
        try { rect.property("ADBE Vector Rect Roundness").setValue(o.round); } catch(e){}
        try { rect.property("ADBE Vector Rect Position").setValue([0, 0]); } catch(e2){}

        // Fill first (drawn under the stroke), then Stroke -- AE draws bottom-up within a group
        if (o.useFill){
            var fill = vg.addProperty("ADBE Vector Graphic - Fill");
            fill.property("ADBE Vector Fill Color").setValue(col(o.fillColor));
        }
        if (o.useStroke){
            var stroke = vg.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("ADBE Vector Stroke Color").setValue(col(o.strokeColor));
            stroke.property("ADBE Vector Stroke Width").setValue(o.strokeW);
        }

        // centre the layer in the comp (anchor stays [0,0]; rect path is centred on it)
        L.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        L.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width/2, comp.height/2]);
        return L;
    }

    /* =========================================================================================
     *  MAIN BUILD
     * =======================================================================================*/
    function build(opts){
        LOG = [];
        var comp = opts.comp;

        app.beginUndoGroup(SCRIPT_NAME + " - Build");
        try {
            var cx = comp.width / 2, cy = comp.height / 2;
            var hw = opts.rect.w / 2, hh = opts.rect.h / 2;

            // optional black background
            if (opts.addBG){
                var bg = comp.layers.addSolid([0,0,0], "EG Background", comp.width, comp.height, comp.pixelAspect, comp.duration);
                bg.moveToEnd();
            }

            // ----- 3. GLOW layer (built first so it ends up at the bottom) ---------------------
            var glow = makeRoundRect(comp, "EG Glow", {
                w: opts.rect.w, h: opts.rect.h, round: opts.rect.round,
                useFill: true, fillColor: [0,0,0], useStroke: false
            });
            var shadowColors = [ opts.shadow1, opts.shadow2, opts.shadow3 ];
            for (var s = 0; s < 3; s++){
                var ds = addEffect(glow, "ADBE Drop Shadow", "Drop Shadow");
                setBy(ds, "Shadow Color", col(shadowColors[s]));
                setBy(ds, "Opacity",   Math.round(SPEC.shadow.opacity/100*255)); // Drop Shadow opacity is 0..255
                setBy(ds, "Direction", opts.shadowDir);
                setBy(ds, "Distance",  opts.shadowDist);
                setBy(ds, "Softness",  opts.shadowSoft);
            }
            log("Glow layer: 3 Drop Shadows applied.");

            // ----- 2. FILL layer (the dark inner panel) ----------------------------------------
            var fill = makeRoundRect(comp, "EG Fill", {
                w: opts.rect.w, h: opts.rect.h, round: opts.rect.round,
                useFill: true, fillColor: opts.fillColor, useStroke: false
            });

            // ----- 1. STROKE layer (the glowing edge) ------------------------------------------
            var stroke = makeRoundRect(comp, "EG Stroke", {
                w: opts.rect.w, h: opts.rect.h, round: opts.rect.round,
                useFill: false, useStroke: true, strokeColor: [0,0,0], strokeW: opts.rect.strokeW
            });

            //   CC Light Sweep
            var ls = addEffect(stroke, "CC Light Sweep", "CC Light Sweep");
            setBy(ls, "Center", [cx, cy]);
            setBy(ls, "Width", opts.sweepWidth);
            setBy(ls, "Sweep Intensity", SPEC.lightSweep.sweepIntensity);
            setBy(ls, "Edge Intensity",  opts.edgeIntensity);
            setBy(ls, "Edge Thickness",  SPEC.lightSweep.edgeThickness);
            setBy(ls, "Light Color", [1,1,1,1]);
            setBy(ls, "Light Reception", SPEC.idx.lightReceptionCutout);
            if (opts.animate) setExpr(ls, "Direction", "time*" + opts.speed);
            log("CC Light Sweep applied" + (opts.animate ? " (animated)." : "."));

            //   4-Color Gradient  -- points pinned to the rectangle corners, 1&3=A, 2&4=B
            var g4 = addEffect(stroke, "ADBE 4ColorGradient", "4-Color Gradient");
            setBy(g4, "Point 1", [cx - hw, cy - hh]);  setBy(g4, "Color 1", col(opts.gradA)); // top-left
            setBy(g4, "Point 2", [cx + hw, cy - hh]);  setBy(g4, "Color 2", col(opts.gradB)); // top-right
            setBy(g4, "Point 3", [cx - hw, cy + hh]);  setBy(g4, "Color 3", col(opts.gradA)); // bottom-left
            setBy(g4, "Point 4", [cx + hw, cy + hh]);  setBy(g4, "Color 4", col(opts.gradB)); // bottom-right
            setBy(g4, "Blend",   SPEC.gradient.blend);
            setBy(g4, "Jitter",  SPEC.gradient.jitter);
            setBy(g4, "Opacity", SPEC.gradient.opacity);
            log("4-Color Gradient applied.");

            //   Deep Glow (with graceful fallback to built-in Glow)
            var dgMatch = null, parade = stroke.property("ADBE Effect Parade");
            for (var d = 0; d < SPEC.deepGlowMatchNames.length; d++){
                if (parade.canAddProperty(SPEC.deepGlowMatchNames[d])){ dgMatch = SPEC.deepGlowMatchNames[d]; break; }
            }
            if (dgMatch){
                var dg = parade.addProperty(dgMatch);
                setBy(dg, "Radius", SPEC.deepGlow.radius);
                setBy(dg, "Exposure", SPEC.deepGlow.exposure);
                log("Deep Glow applied (" + dgMatch + ").");
            } else {
                var gl = addEffect(stroke, "ADBE Glo2", "Glow");
                setBy(gl, "Glow Threshold", SPEC.glowFallback.threshold);
                setBy(gl, "Glow Radius",    SPEC.glowFallback.radius);
                setBy(gl, "Glow Intensity", SPEC.glowFallback.intensity);
                log("Deep Glow not installed -> used built-in Glow instead.");
            }

            // ----- ORDER  (top -> bottom): Stroke, Fill, Glow ----------------------------------
            stroke.moveToBeginning();
            fill.moveAfter(stroke);
            glow.moveAfter(fill);

            comp.openInViewer();
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
        "Builds the 'Edge Glow' look in one click: a rounded-rectangle outline with a glowing",
        "4-colour gradient edge, an animated CC Light Sweep, a soft coloured drop-shadow halo,",
        "and Deep Glow on top -- exactly the rig from the tutorial. Re-runnable on any comp.",
        "",
        "==============================  QUICK START  ==============================",
        "1.  (Optional) open the comp you want the badge in. No comp open? It makes one.",
        "2.  Set the rectangle size / roundness / stroke width.",
        "3.  Pick the two gradient colours (A = corners 1&3, B = corners 2&4) and the",
        "    three halo shadow colours (red / blue / white by default).",
        "4.  Tick 'Animate light sweep' for the moving highlight (Direction = time * speed).",
        "5.  Click 'Build Edge Glow'.  One Ctrl/Cmd+Z undoes the whole build.",
        "6.  Drop your text / icon on a layer ABOVE 'EG Stroke' to finish the design.",
        "",
        "==============================  THE LAYERS  ===============================",
        "EG Stroke  -- the glowing outline (CC Light Sweep + 4-Color Gradient + Deep Glow).",
        "EG Fill    -- the dark inner panel (solid-filled rounded rect).",
        "EG Glow    -- bottom layer; 3 stacked Drop Shadows make the coloured halo.",
        "EG Background (optional) -- a black solid behind everything.",
        "",
        "==============================  CONTROLS  =================================",
        "Width / Height / Roundness / Stroke -- the rectangle shape. Tutorial: 718 x 142, r28, 3px.",
        "Gradient A / B   -- the two edge colours. A fills corners 1 & 3, B fills corners 2 & 4.",
        "Fill colour      -- the inner panel colour (black by default).",
        "Shadow 1/2/3     -- the three halo colours that bloom outward (red / blue / white).",
        "Shadow distance/softness -- spread of the halo (100 / 525 in the tutorial).",
        "Sweep width      -- thickness of the moving highlight along the edge.",
        "Edge intensity   -- brightness of the swept edge (100 = tutorial).",
        "Animate + speed  -- adds the expression 'time * speed' to the sweep Direction.",
        "Add black background -- drop a black solid under everything (on by default for new comps).",
        "",
        "========================  TIPS & TROUBLESHOOTING  =========================",
        "- No 'Deep Glow' plugin?  The script auto-falls back to AE's built-in Glow -- the look",
        "  is close. Install Plugin Everything's Deep Glow for the exact tutorial bloom.",
        "- Halo too strong / weak?  Raise or lower Shadow distance & softness, or shadow opacity.",
        "- Light Reception popup didn't switch to 'Cutout'?  Set it by hand on CC Light Sweep",
        "  (scripting can't always move popup menus on every AE build).",
        "- Want a different aspect?  Just change Width / Height -- the gradient corners and the",
        "  light-sweep centre re-pin themselves automatically.",
        "- Everything is in one Undo group -- tweak the controls and rebuild freely."
    ].join("\n");

    function showGuide(){
        var g = new Window("dialog", SCRIPT_NAME + "  -  Guide");
        g.alignChildren = ["fill","top"]; g.margins = 16; g.spacing = 8;
        var title = g.add("statictext", undefined, SCRIPT_NAME);
        title.graphics.font = ScriptUI.newFont(title.graphics.font.name, ScriptUI.FontStyle.BOLD, 16);
        var body = g.add("edittext", undefined, GUIDE_TEXT, {multiline:true, readonly:true, scrolling:true});
        body.preferredSize = [580, 440];
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
        win.alignChildren = ["fill","top"];
        win.spacing = 7; win.margins = 12;

        // header
        var head = win.add("group"); head.orientation = "row"; head.alignment = ["fill","top"];
        var headL = head.add("statictext", undefined, "Edge Glow");
        headL.alignment = ["fill","center"];
        headL.graphics.font = ScriptUI.newFont(headL.graphics.font.name, ScriptUI.FontStyle.BOLD, 13);
        var infoBtn = head.add("button", undefined, "ⓘ Guide");
        infoBtn.preferredSize = [78, 24];
        infoBtn.onClick = showGuide;

        win.add("statictext", undefined, "Builds a glowing gradient-edge badge in the active comp.", {multiline:true});
        var compLbl = win.add("statictext", undefined, "Active comp: -");

        // helpers for rows
        function rowNum(parent, label, def, w){
            var r = parent.add("group"); r.alignment = ["fill","top"];
            var l = r.add("statictext", undefined, label); l.preferredSize.width = (w||95);
            var e = r.add("edittext", undefined, def); e.characters = 6;
            return e;
        }
        function swatchFor(group, rgb){
            var sw = group.add("panel"); sw.preferredSize = [24,18];
            sw.fillBrush = [rgb[0]/255, rgb[1]/255, rgb[2]/255, 1];
            sw.onDraw = function(){
                var gx = this.graphics;
                try { var b = gx.newBrush(gx.BrushType.SOLID_COLOR, this.fillBrush);
                      gx.newPath(); gx.rectPath(0,0,this.size.width,this.size.height); gx.fillPath(b); } catch(e){}
            };
            return sw;
        }
        function rowColor(parent, label, rgb){
            var r = parent.add("group"); r.alignment = ["fill","top"];
            var l = r.add("statictext", undefined, label); l.preferredSize.width = 95;
            var eR = r.add("edittext", undefined, String(rgb[0])); eR.characters = 4;
            var eG = r.add("edittext", undefined, String(rgb[1])); eG.characters = 4;
            var eB = r.add("edittext", undefined, String(rgb[2])); eB.characters = 4;
            var sw = swatchFor(r, rgb);
            function repaint(){
                sw.fillBrush = [ (parseInt(eR.text,10)||0)/255, (parseInt(eG.text,10)||0)/255, (parseInt(eB.text,10)||0)/255, 1 ];
                try { sw.hide(); sw.show(); } catch(e){}
            }
            eR.onChanging = eG.onChanging = eB.onChanging = repaint;
            return { get: function(){ return [ parseInt(eR.text,10)||0, parseInt(eG.text,10)||0, parseInt(eB.text,10)||0 ]; } };
        }

        // 1. Shape
        var gShape = win.add("panel", undefined, "1.  Shape"); gShape.alignChildren = ["fill","top"]; gShape.margins = 10; gShape.spacing = 5;
        var rowWH = gShape.add("group"); rowWH.alignment = ["fill","top"];
        rowWH.add("statictext", undefined, "Size W x H:").preferredSize.width = 95;
        var etW = rowWH.add("edittext", undefined, String(SPEC.rect.w)); etW.characters = 6;
        rowWH.add("statictext", undefined, "x");
        var etH = rowWH.add("edittext", undefined, String(SPEC.rect.h)); etH.characters = 6;
        var etRound  = rowNum(gShape, "Roundness:", String(SPEC.rect.round));
        var etStroke = rowNum(gShape, "Stroke (px):", String(SPEC.rect.strokeW));

        // 2. Colours
        var gCol = win.add("panel", undefined, "2.  Colours  (R  G  B)"); gCol.alignChildren = ["fill","top"]; gCol.margins = 10; gCol.spacing = 4;
        var cGradA = rowColor(gCol, "Gradient A:", [236, 0, 200]);   // corners 1 & 3 (pink)
        var cGradB = rowColor(gCol, "Gradient B:", [120, 40, 255]);  // corners 2 & 4 (blue)
        var cFill  = rowColor(gCol, "Fill (inner):", [0, 0, 0]);
        var cSh1   = rowColor(gCol, "Halo 1:", [255, 0, 0]);
        var cSh2   = rowColor(gCol, "Halo 2:", [0, 0, 255]);
        var cSh3   = rowColor(gCol, "Halo 3:", [255, 255, 255]);

        // 3. Halo + Sweep
        var gFX = win.add("panel", undefined, "3.  Halo & Sweep"); gFX.alignChildren = ["fill","top"]; gFX.margins = 10; gFX.spacing = 5;
        var etShDist = rowNum(gFX, "Halo distance:", String(SPEC.shadow.distance));
        var etShSoft = rowNum(gFX, "Halo softness:", String(SPEC.shadow.softness));
        var etShDir  = rowNum(gFX, "Halo direction:", String(SPEC.shadow.direction));
        var etSwW    = rowNum(gFX, "Sweep width:", String(SPEC.lightSweep.width));
        var etEdge   = rowNum(gFX, "Edge intensity:", String(SPEC.lightSweep.edgeIntensity));
        var animRow  = gFX.add("group"); animRow.alignment = ["fill","top"];
        var cAnim = animRow.add("checkbox", undefined, "Animate light sweep   speed:"); cAnim.value = true;
        var etSpeed = animRow.add("edittext", undefined, String(SPEC.lightSweep.speed)); etSpeed.characters = 4;
        var cBG = gFX.add("checkbox", undefined, "Add black background solid"); cBG.value = false;

        // actions
        var buildBtn = win.add("button", undefined, "Build Edge Glow"); buildBtn.alignment = ["fill","center"];
        var status = win.add("statictext", undefined, "Ready.", {multiline:true}); status.preferredSize.height = 34;

        function refresh(){
            var comp = activeComp();
            compLbl.text = "Active comp: " + (comp ? comp.name + "  (" + comp.width + "x" + comp.height + ")" : "- none open: one will be created -");
            cBG.value = !comp;   // default the background ON when we'll create a fresh comp
        }
        refresh();

        buildBtn.onClick = function(){
            var comp = activeComp();
            if (!comp){
                comp = app.project.items.addComp("Edge Glow Comp", SPEC.comp.w, SPEC.comp.h, 1.0, SPEC.comp.dur, SPEC.comp.fps);
                comp.openInViewer();
            }
            var opts = {
                comp: comp,
                rect: { w: Math.max(1, parseFloat(etW.text)||SPEC.rect.w),
                        h: Math.max(1, parseFloat(etH.text)||SPEC.rect.h),
                        round: Math.max(0, parseFloat(etRound.text)||0),
                        strokeW: Math.max(0.1, parseFloat(etStroke.text)||SPEC.rect.strokeW) },
                gradA: cGradA.get(), gradB: cGradB.get(), fillColor: cFill.get(),
                shadow1: cSh1.get(), shadow2: cSh2.get(), shadow3: cSh3.get(),
                shadowDist: parseFloat(etShDist.text)||SPEC.shadow.distance,
                shadowSoft: parseFloat(etShSoft.text)||SPEC.shadow.softness,
                shadowDir:  parseFloat(etShDir.text)||SPEC.shadow.direction,
                sweepWidth: parseFloat(etSwW.text)||SPEC.lightSweep.width,
                edgeIntensity: parseFloat(etEdge.text)||SPEC.lightSweep.edgeIntensity,
                animate: cAnim.value,
                speed: parseFloat(etSpeed.text)||SPEC.lightSweep.speed,
                addBG: cBG.value
            };
            try {
                build(opts);
                status.text = "Done. Built 'EG Stroke / Fill / Glow' into '" + comp.name + "'.";
                if (LOG.join("").indexOf(" - ") !== -1) status.text += "  (Some values used defaults - see notes.)";
            } catch(err){
                status.text = "Error: " + err.toString();
                alert("Build failed:\n" + err.toString() + "\n\nPress Ctrl/Cmd+Z if anything was half-built.");
            }
        };

        if (win instanceof Window){ win.center(); win.show(); }
        else { win.layout.layout(true); win.layout.resize(); }
        return win;
    }

    buildUI(thisObj);

})(this);
