/**********************************************************************************************
 *  BLUR COLOR REVEAL  -  reusable builder panel for Adobe After Effects
 *  ------------------------------------------------------------------------------------------
 *  Recreates the user's own "blur colour reveal": a soft-edged colour blob that BLOOMS OUTWARD
 *  (Scale 0% -> 120%) over your content to wipe-reveal it. Built exactly the way the reference
 *  SECOND_SCENE comp does it - two synced Fast-Box-Blurred ellipses, the colour one clipped to a
 *  matching alpha matte so a thick stroke reads as a clean two-tone disc. One click, customisable.
 *
 *  WHAT IT BUILDS  (the exact rig from the reference comp, in one click)
 *    Top -> bottom, on top of your CONTENT layer:
 *        BR Reveal Matte  : a Fast-Box-Blurred ellipse (plain fill). Serves as the ALPHA matte,
 *                           so its video renders invisibly. Scale animates 0% -> end, eased.
 *        BR Reveal Color  : the SAME ellipse with a FILL (core colour) + optional STROKE (ring
 *                           colour), Fast Box Blur, alpha-matted by the matte so the ring is
 *                           clipped to a clean soft disc. Scale animates 0% -> end in sync.
 *        <your content>   : untouched, below - this is what the bloom reveals.
 *
 *    Both ellipses grow from the same origin point (comp centre by default), so a soft colour
 *    disc blooms outward across the content. Optionally precomposes your selection into
 *    "BR Content" first. Everything is one Undo group; a single Ctrl/Cmd+Z reverts the rig.
 *
 *  HOW TO INSTALL / USE  ->  see "Blur Color Reveal - GUIDE.md"
 *********************************************************************************************/

(function blurColorReveal(thisObj) {

    var SCRIPT_NAME = "Blur Color Reveal";
    var VERSION     = "2.0";

    /* =========================================================================================
     *  SPEC  -  defaults lifted straight from the reference SECOND_SCENE comp.
     * =======================================================================================*/
    var SPEC = {
        comp     : { w: 1920, h: 1080, fps: 30, dur: 8 },   // used only when no comp is open
        core     : [251, 248, 149],     // fill colour  (pale yellow, from the reference)
        ring     : [173, 215, 255],     // stroke colour (light blue, from the reference)
        ringW    : 200,                 // stroke width in px (0 = single-colour disc)
        blur     : 80,                  // Fast Box Blur radius (soft edges)
        sizeMul  : 1.5,                 // ellipse size = comp size * this (before scale anim)
        endScale : 120,                 // Scale animates 0% -> this %
        start    : 0.0,                 // reveal start time (s)
        dur      : 1.3,                 // reveal duration (s)  (reference: ~2.57s, pre-rolled)
        ease     : 33,                  // keyframe influence % (33 = Easy Ease, matches reference)
        boxBlurMatchNames: [ "ADBE Box Blur2", "ADBE Box Blur" ]
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

    // [r,g,b] 0..255  ->  [r,g,b,1] 0..1
    function col(rgb){ return [ (rgb[0]||0)/255, (rgb[1]||0)/255, (rgb[2]||0)/255, 1 ]; }

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

    function addBoxBlur(layer){
        var parade = layer.property("ADBE Effect Parade");
        for (var i = 0; i < SPEC.boxBlurMatchNames.length; i++){
            if (parade.canAddProperty(SPEC.boxBlurMatchNames[i]))
                return parade.addProperty(SPEC.boxBlurMatchNames[i]);
        }
        throw new Error("Fast Box Blur / Box Blur effect is not available in this AE install.");
    }

    // Easy-Ease every key. influence 0..100. Sizes the ease array to the property's dimensions
    // (spatial props want exactly 1 element; value props want one per dimension).
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

    // Make `fill` use `matte` as an ALPHA track matte (new AE setTrackMatte + legacy fallback).
    // NB: AE Layer has NO moveBefore() - only moveAfter / moveToBeginning / moveToEnd.
    function setAlphaMatte(fill, matte){
        if (typeof fill.setTrackMatte === "function"){
            try { fill.setTrackMatte(matte, TrackMatteType.ALPHA); return true; } catch(e){}
        }
        try { fill.moveAfter(matte); fill.trackMatteType = TrackMatteType.ALPHA; return true; }
        catch(e2){ log("  - could not set track matte: " + e2.toString()); return false; }
    }

    /* =========================================================================================
     *  SHAPE BUILDER  -  a centred ellipse layer (fill + optional stroke), anchor at [0,0]
     * =======================================================================================*/
    function makeEllipse(comp, name, w, h, fillRGB, strokeRGB, strokeW){
        var L = comp.layers.addShape(); L.name = name;
        var grp = L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        grp.name = "Ellipse 1";
        var vg = grp.property("ADBE Vectors Group");

        var el = vg.addProperty("ADBE Vector Shape - Ellipse");
        el.property("ADBE Vector Ellipse Size").setValue([w, h]);   // path centred on layer origin

        // stroke first then fill -> matches the reference (stroke renders over the fill)
        if (strokeW > 0 && strokeRGB){
            var st = vg.addProperty("ADBE Vector Graphic - Stroke");
            st.property("ADBE Vector Stroke Color").setValue(col(strokeRGB));
            st.property("ADBE Vector Stroke Width").setValue(strokeW);
        }
        var fl = vg.addProperty("ADBE Vector Graphic - Fill");
        fl.property("ADBE Vector Fill Color").setValue(col(fillRGB));

        L.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
        return L;
    }

    // Fast Box Blur + Scale-bloom (0% -> end), eased - applied identically to matte & colour.
    function rigLayer(L, opts, origin){
        var fbb = addBoxBlur(L);
        setBy(fbb, "Blur Radius", opts.blur);
        setBy(fbb, "Iterations", 3);
        setBy(fbb, "Blur Dimensions", 1);        // Horizontal and Vertical
        setBy(fbb, "Repeat Edge Pixels", true);  // matches reference

        var tg = L.property("ADBE Transform Group");
        tg.property("ADBE Position").setValue(origin);

        var sc = tg.property("ADBE Scale");
        var t0 = opts.start, t1 = opts.start + opts.dur;
        sc.setValueAtTime(t0, [0, 0]);
        sc.setValueAtTime(t1, [opts.endScale, opts.endScale]);
        easeKeys(sc, opts.ease);
    }

    /* =========================================================================================
     *  MAIN BUILD
     * =======================================================================================*/
    function build(opts){
        LOG = [];
        var comp = opts.comp;

        app.beginUndoGroup(SCRIPT_NAME + " - Build");
        try {
            if (comp.numLayers < 1){
                throw new Error("This comp has no layers. Add your content (card / dashboard / footage) first.");
            }

            // ---- 0.  Resolve CONTENT (optionally precompose for tidiness) ---------------------
            var content = null, sel = comp.selectedLayers;
            if (opts.precompose){
                var idx = [];
                if (sel.length){ for (var s = 0; s < sel.length; s++) idx.push(sel[s].index); }
                else { idx = [ comp.layer(1).index ]; }
                var pcComp = comp.layers.precompose(idx, "BR Content", true);  // returns a CompItem
                for (var li = 1; li <= comp.numLayers; li++){
                    var cl = comp.layer(li);
                    if (cl.source === pcComp || cl.name === "BR Content"){ content = cl; break; }
                }
                if (!content) content = comp.layer(1);
                log("Precomposed " + idx.length + " layer(s) into 'BR Content'.");
            } else {
                content = (sel.length ? sel[0] : comp.layer(1));
                log("Content layer: '" + content.name + "'.");
            }

            // ---- 1.  Build the two ellipses (colour created first -> matte ends up above it) ---
            var W = comp.width  * opts.sizeMul;
            var H = comp.height * opts.sizeMul;
            var origin = opts.originCenter ? [comp.width/2, comp.height/2] : [opts.originX, opts.originY];

            var color = makeEllipse(comp, "BR Reveal Color", W, H, opts.core, opts.ring, opts.ringW);
            var matte = makeEllipse(comp, "BR Reveal Matte", W, H, [255,255,255], null, 0);
            // both are now at the very top of the comp (matte above colour), above the content

            rigLayer(color, opts, origin);
            rigLayer(matte, opts, origin);

            setAlphaMatte(color, matte);   // colour clipped to the soft blurred matte disc
            log("Reveal built: ellipse bloom 0% -> " + opts.endScale + "% , blur " + opts.blur +
                " , " + opts.start.toFixed(2) + "s -> " + (opts.start+opts.dur).toFixed(2) + "s.");

            // ---- 2.  (optional) parent both to a control null for a subtle scene push ----------
            if (opts.addNull){
                var nul = comp.layers.addNull(comp.duration);
                nul.name = "BR Control";
                // anchor == position == comp centre -> net-zero offset to children, pivot at centre
                nul.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([comp.width/2, comp.height/2]);
                nul.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width/2, comp.height/2]);
                nul.moveToBeginning();
                color.parent = nul; matte.parent = nul;
                if (opts.nullPush){
                    var ns = nul.property("ADBE Transform Group").property("ADBE Scale");
                    ns.setValueAtTime(opts.start, [opts.nullFrom, opts.nullFrom]);
                    ns.setValueAtTime(opts.start + opts.dur + 0.8, [opts.nullTo, opts.nullTo]);
                    easeKeys(ns, opts.ease);
                }
                log("Control null added (both ellipses parented).");
            }

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
        "Recreates your blur-colour-reveal rig: a soft-edged colour disc BLOOMS OUTWARD (Scale",
        "0% -> 120%, eased) over your content to wipe-reveal it. Two synced Fast-Box-Blurred",
        "ellipses - a plain matte and a fill+stroke colour clipped to it - exactly like the",
        "SECOND_SCENE reference. Re-runnable on any comp; one Ctrl/Cmd+Z undoes the whole rig.",
        "",
        "==============================  QUICK START  ==============================",
        "1.  Open the comp with your content (dashboard / card / footage).",
        "2.  SELECT the layer(s) you want to reveal.",
        "3.  (Recommended) leave 'Precompose selected first' on -> wraps them into 'BR Content'.",
        "4.  Pick the core + ring colours, softness, end scale and timing.",
        "5.  Click 'Build Reveal'. Preview, tweak, rebuild freely.",
        "",
        "==============================  THE LAYERS  ===============================",
        "BR Reveal Matte -- a blurred plain-fill ellipse, used as the ALPHA matte (renders",
        "                   invisibly). Scale animates 0% -> end.",
        "BR Reveal Color -- the same ellipse with a fill (core) + optional stroke (ring), blurred,",
        "                   clipped to the matte so the ring reads as a clean soft disc. Same scale.",
        "BR Content (opt)-- your selected layers, precomposed to stay tidy.",
        "BR Control (opt)-- a null both ellipses parent to, for a subtle scene push-in.",
        "",
        "==============================  CONTROLS  =================================",
        "Core (fill) colour  -- the centre colour of the disc (reference: pale yellow).",
        "Ring (stroke) colour-- the rim colour. Set Ring width 0 for a single-colour disc.",
        "Ring width          -- stroke thickness in px (reference: ~200-300). 0 = no ring.",
        "Softness (blur)     -- Fast Box Blur radius. Higher = softer, glowier edges (ref: 80).",
        "Size (xComp)        -- ellipse size as a multiple of the comp (ref: ~1.5).",
        "End scale %         -- how far the bloom grows (ref: 120). Raise to cover more.",
        "Start / Duration    -- when the bloom begins and how long it takes (seconds).",
        "Ease (0-100)        -- keyframe influence. 33 = Easy Ease (matches the reference).",
        "Origin              -- centre by default; untick to grow from a custom X / Y point.",
        "Precompose first    -- wrap the selection into 'BR Content'.",
        "Control null + push -- parent both ellipses to a null and add a subtle scale push-in.",
        "",
        "========================  TIPS & TROUBLESHOOTING  =========================",
        "- Disc doesn't cover the frame? Raise End scale % or Size (xComp).",
        "- Want a single solid colour (no rim)? Set Ring width to 0.",
        "- Edges too hard / soft? Raise / lower Softness (blur radius).",
        "- Grow from a corner instead of centre? Untick Origin = centre and set X / Y.",
        "- Track matte didn't stick on an older AE build? 'BR Reveal Matte' sits directly above",
        "  'BR Reveal Color' -- just set the colour layer's track-matte dropdown to Alpha by hand.",
        "- Everything is one Undo group -- tweak the controls and rebuild as often as you like."
    ].join("\n");

    function showGuide(){
        var g = new Window("dialog", SCRIPT_NAME + "  -  Guide");
        g.alignChildren = ["fill","top"]; g.margins = 16; g.spacing = 8;
        var title = g.add("statictext", undefined, SCRIPT_NAME);
        title.graphics.font = ScriptUI.newFont(title.graphics.font.name, ScriptUI.FontStyle.BOLD, 16);
        var body = g.add("edittext", undefined, GUIDE_TEXT, {multiline:true, readonly:true, scrolling:true});
        body.preferredSize = [600, 470];
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
        var headL = head.add("statictext", undefined, "Blur Color Reveal"); headL.alignment = ["fill","center"];
        headL.graphics.font = ScriptUI.newFont(headL.graphics.font.name, ScriptUI.FontStyle.BOLD, 13);
        var infoBtn = head.add("button", undefined, "ⓘ Guide"); infoBtn.preferredSize = [78, 24];
        infoBtn.onClick = showGuide;

        win.add("statictext", undefined, "Blooms a soft colour disc outward to reveal your content.", {multiline:true});
        var compLbl = win.add("statictext", undefined, "Active comp: -");

        function rowNum(parent, label, def, w){
            var r = parent.add("group"); r.alignment = ["fill","top"];
            var l = r.add("statictext", undefined, label); l.preferredSize.width = (w||110);
            var e = r.add("edittext", undefined, def); e.characters = 6;
            return e;
        }
        function swatchFor(group, rgb){
            var sw = group.add("panel"); sw.preferredSize = [24,18];
            sw.fillBrush = [rgb[0]/255, rgb[1]/255, rgb[2]/255, 1];
            sw.onDraw = function(){ var gx = this.graphics;
                try { var b = gx.newBrush(gx.BrushType.SOLID_COLOR, this.fillBrush);
                      gx.newPath(); gx.rectPath(0,0,this.size.width,this.size.height); gx.fillPath(b); } catch(e){} };
            return sw;
        }
        function rowColor(parent, label, rgb){
            var r = parent.add("group"); r.alignment = ["fill","top"];
            var l = r.add("statictext", undefined, label); l.preferredSize.width = 110;
            var eR = r.add("edittext", undefined, String(rgb[0])); eR.characters = 4;
            var eG = r.add("edittext", undefined, String(rgb[1])); eG.characters = 4;
            var eB = r.add("edittext", undefined, String(rgb[2])); eB.characters = 4;
            var sw = swatchFor(r, rgb);
            function repaint(){ sw.fillBrush = [ (parseInt(eR.text,10)||0)/255, (parseInt(eG.text,10)||0)/255, (parseInt(eB.text,10)||0)/255, 1 ];
                try { sw.hide(); sw.show(); } catch(e){} }
            eR.onChanging = eG.onChanging = eB.onChanging = repaint;
            return { get: function(){ return [ parseInt(eR.text,10)||0, parseInt(eG.text,10)||0, parseInt(eB.text,10)||0 ]; } };
        }

        // 1. Colour & softness
        var g1 = win.add("panel", undefined, "1.  Colour & Softness"); g1.alignChildren = ["fill","top"]; g1.margins = 10; g1.spacing = 5;
        var cCore = rowColor(g1, "Core (fill):", SPEC.core);
        var cRing = rowColor(g1, "Ring (stroke):", SPEC.ring);
        var etRingW = rowNum(g1, "Ring width (px):", String(SPEC.ringW));
        var etBlur  = rowNum(g1, "Softness (blur):", String(SPEC.blur));

        // 2. Bloom
        var g2 = win.add("panel", undefined, "2.  Bloom"); g2.alignChildren = ["fill","top"]; g2.margins = 10; g2.spacing = 5;
        var etSize  = rowNum(g2, "Size (xComp):", String(SPEC.sizeMul));
        var etEnd   = rowNum(g2, "End scale %:", String(SPEC.endScale));
        var etStart = rowNum(g2, "Start (s):", String(SPEC.start));
        var etDur   = rowNum(g2, "Duration (s):", String(SPEC.dur));
        var etEase  = rowNum(g2, "Ease (0-100):", String(SPEC.ease));
        var oRow = g2.add("group"); oRow.alignment = ["fill","top"];
        var cCenter = oRow.add("checkbox", undefined, "Origin = centre"); cCenter.value = true;
        oRow.add("statictext", undefined, "X:");
        var etOX = oRow.add("edittext", undefined, "960"); etOX.characters = 5;
        oRow.add("statictext", undefined, "Y:");
        var etOY = oRow.add("edittext", undefined, "540"); etOY.characters = 5;
        cCenter.onClick = function(){ etOX.enabled = etOY.enabled = !cCenter.value; };
        etOX.enabled = etOY.enabled = false;
        var cPre = g2.add("checkbox", undefined, "Precompose selected first (BR Content)"); cPre.value = true;

        // 3. Control null (optional)
        var g3 = win.add("panel", undefined, "3.  Control Null (optional)"); g3.alignChildren = ["fill","top"]; g3.margins = 10; g3.spacing = 5;
        var cNull = g3.add("checkbox", undefined, "Parent both ellipses to a control null"); cNull.value = false;
        var cPush = g3.add("checkbox", undefined, "Add subtle scale push-in"); cPush.value = false;
        var pRow = g3.add("group"); pRow.alignment = ["fill","top"];
        pRow.add("statictext", undefined, "Push from %:").preferredSize.width = 110;
        var etNF = pRow.add("edittext", undefined, "80"); etNF.characters = 5;
        pRow.add("statictext", undefined, "to %:");
        var etNT = pRow.add("edittext", undefined, "90"); etNT.characters = 5;

        var buildBtn = win.add("button", undefined, "Build Reveal"); buildBtn.alignment = ["fill","center"];
        var status = win.add("statictext", undefined, "Ready.", {multiline:true}); status.preferredSize.height = 34;

        function refresh(){
            var comp = activeComp();
            compLbl.text = "Active comp: " + (comp ? comp.name + "  (" + comp.width + "x" + comp.height + ")" : "- none open: a comp will be made -");
            if (comp && cCenter.value){ etOX.text = String(comp.width/2); etOY.text = String(comp.height/2); }
        }
        refresh();

        buildBtn.onClick = function(){
            var comp = activeComp();
            if (!comp){
                comp = app.project.items.addComp("Blur Color Reveal", SPEC.comp.w, SPEC.comp.h, 1.0, SPEC.comp.dur, SPEC.comp.fps);
                comp.openInViewer(); refresh();
            }
            var opts = {
                comp: comp,
                core: cCore.get(), ring: cRing.get(),
                ringW: Math.max(0, parseFloat(etRingW.text) || 0),
                blur: Math.max(0, parseFloat(etBlur.text) || SPEC.blur),
                sizeMul: Math.max(0.1, parseFloat(etSize.text) || SPEC.sizeMul),
                endScale: Math.max(1, parseFloat(etEnd.text) || SPEC.endScale),
                start: Math.max(0, parseFloat(etStart.text) || 0),
                dur: Math.max(0.1, parseFloat(etDur.text) || SPEC.dur),
                ease: Math.max(0, Math.min(100, parseFloat(etEase.text) || SPEC.ease)),
                originCenter: cCenter.value,
                originX: parseFloat(etOX.text) || comp.width/2,
                originY: parseFloat(etOY.text) || comp.height/2,
                precompose: cPre.value,
                addNull: cNull.value, nullPush: cPush.value,
                nullFrom: parseFloat(etNF.text) || 80, nullTo: parseFloat(etNT.text) || 90
            };
            try {
                build(opts);
                status.text = "Done. Built the reveal into '" + comp.name + "'. Preview the comp.";
                if (LOG.join("").indexOf(" - ") !== -1) status.text += "  (Some values used defaults - see notes.)";
            } catch(err){
                status.text = "Error: " + err.toString();
                alert("Build failed:\n" + err.toString() + "\n\nPress Ctrl/Cmd+Z if anything was half-built.");
            }
        };

        // responsive: reflow on resize
        win.onResizing = win.onResize = function(){ try { this.layout.resize(); } catch(e){} };
        win.layout.layout(true); win.layout.resize();
        if (win instanceof Window){ win.minimumSize = [300, 340]; win.center(); win.show(); }
        return win;
    }

    buildUI(thisObj);

})(this);
