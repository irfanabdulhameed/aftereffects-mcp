/*
 * Composition commands.
 */

MCP.COMP_PRESETS = {
    "1080p30":  { width: 1920, height: 1080, frameRate: 30 },
    "1080p25":  { width: 1920, height: 1080, frameRate: 25 },
    "1080p24":  { width: 1920, height: 1080, frameRate: 24 },
    "1080p60":  { width: 1920, height: 1080, frameRate: 60 },
    "4k30":     { width: 3840, height: 2160, frameRate: 30 },
    "4k25":     { width: 3840, height: 2160, frameRate: 25 },
    "4k24":     { width: 3840, height: 2160, frameRate: 24 },
    "4k60":     { width: 3840, height: 2160, frameRate: 60 },
    "720p30":   { width: 1280, height: 720, frameRate: 30 },
    "square1080": { width: 1080, height: 1080, frameRate: 30 },
    "vertical1080": { width: 1080, height: 1920, frameRate: 30 },
    "motion-graphics-template": { width: 1920, height: 1080, frameRate: 29.97 }
};

MCP.register("createComposition", function (args) {
    var preset = MCP.isDefined(args.preset) ? MCP.COMP_PRESETS[String(args.preset)] : null;
    if (MCP.isDefined(args.preset) && !preset) {
        MCP.fail("Unknown composition preset '" + args.preset + "'. Use one of: " + MCP.keys(MCP.COMP_PRESETS).join(", "), "invalid-argument");
    }
    var name = MCP.arg(args, "name", "New Composition");
    var width = Math.round(MCP.num(args.width, preset ? preset.width : 1920));
    var height = Math.round(MCP.num(args.height, preset ? preset.height : 1080));
    var frameRate = MCP.num(args.frameRate, preset ? preset.frameRate : 30);
    var pixelAspect = MCP.num(args.pixelAspect, 1);
    var duration;
    if (MCP.isDefined(args.durationFrames)) { duration = Number(args.durationFrames) / frameRate; }
    else { duration = MCP.num(args.duration, 10); }
    if (width < 4 || height < 4) { MCP.fail("Composition size must be at least 4 x 4 pixels.", "invalid-argument"); }
    if (duration <= 0) { MCP.fail("Composition duration must be greater than 0.", "invalid-argument"); }

    var folder = null;
    if (MCP.isDefined(args.folder)) { folder = MCP.resolveItem(args.folder, "folder"); }
    var comp = app.project.items.addComp(name, width, height, pixelAspect, duration, frameRate);
    if (folder) { comp.parentFolder = folder; }
    if (MCP.isDefined(args.backgroundColor)) { comp.bgColor = MCP.color.rgb(args.backgroundColor); }
    if (MCP.isDefined(args.motionBlur)) { comp.motionBlur = MCP.bool(args.motionBlur, false); }
    if (MCP.bool(args.openInViewer, true)) { try { comp.openInViewer(); } catch (e) {} }
    return { composition: MCP.serialize.comp(comp), preset: preset ? args.preset : null };
}, { mutating: true });

MCP.register("listCompositions", function (args) {
    var includeUsage = MCP.bool(args.includeUsage, true);
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!(item instanceof CompItem)) { continue; }
        var s = MCP.serialize.comp(item);
        s.itemIndex = i;
        if (includeUsage) { s.usedInCount = _mcpTry(function () { return item.usedIn.length; }, null); }
        out.push(s);
    }
    var active = MCP.activeComp();
    return { count: out.length, activeComp: active ? { id: active.id, name: active.name } : null, compositions: out };
}, { mutating: false });

MCP.register("getCompositionInfo", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var out = MCP.serialize.comp(comp);
    var layers = [];
    var nested = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        layers.push({ index: i, id: _mcpTry(function () { return L.id; }, null), name: L.name, type: MCP.layerType(L), enabled: L.enabled, inPoint: MCP.round(L.inPoint), outPoint: MCP.round(L.outPoint) });
        var src = _mcpTry(function () { return L.source; }, null);
        if (src instanceof CompItem) { nested.push({ layerIndex: i, compId: src.id, compName: src.name }); }
    }
    out.layers = layers;
    out.nestedCompositions = nested;
    out.usedInCount = _mcpTry(function () { return comp.usedIn.length; }, null);
    out.markers = _mcpTry(function () {
        var mp = comp.markerProperty, arr = [];
        for (var k = 1; k <= mp.numKeys; k++) { var mv = MCP.serialize.marker(mp.keyValue(k)); mv.time = MCP.round(mp.keyTime(k)); arr.push(mv); }
        return arr;
    }, []);
    return out;
}, { mutating: false });
