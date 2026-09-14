/*
 * Animation preset (.ffx) commands. Listing and searching preset files happens
 * on the Node side; only applying and saving need After Effects.
 */

MCP.register("applyPreset", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var presetPath = MCP.requireArg(args, "presetPath");
    var file = new File(String(presetPath));
    if (!file.exists) { MCP.fail("Preset file not found: " + presetPath, "not-found"); }
    var before = [];
    var fxg = _mcpTry(function () { return r.layer.property("ADBE Effect Parade"); }, null);
    var i;
    if (fxg) { for (i = 1; i <= fxg.numProperties; i++) { before.push(fxg.property(i).name); } }
    r.layer.applyPreset(file);
    var added = [];
    if (fxg) {
        for (i = before.length + 1; i <= fxg.numProperties; i++) { added.push(MCP.serialize.effect(fxg.property(i))); }
    }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layer(r.layer), presetPath: file.fsName, effectsAdded: added };
}, { mutating: true });

MCP.register("savePreset", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var outPath = MCP.requireArg(args, "outputPath");
    var fxg = MCP.effectsGroup(r.layer);
    var props = [];
    if (MCP.isArray(args.effects) && args.effects.length) {
        for (var i = 0; i < args.effects.length; i++) { props.push(MCP.resolveEffect(r.layer, args.effects[i])); }
    } else {
        for (var j = 1; j <= fxg.numProperties; j++) { props.push(fxg.property(j)); }
    }
    if (!props.length) { MCP.fail("Layer '" + r.layer.name + "' has no effects to save.", "not-found"); }
    var file = new File(String(outPath));
    if (!/\.ffx$/i.test(file.name)) { file = new File(file.fsName + ".ffx"); }
    if (!file.parent.exists) { file.parent.create(); }
    var ok = r.layer.savePreset ? false : false;
    // Layer.savePreset exists on newer versions; fall back to the property-based API.
    try {
        if (typeof r.layer.savePreset === "function") {
            for (var p = 0; p < props.length; p++) { props[p].selected = true; }
            ok = r.layer.savePreset(file);
        }
    } catch (e) { ok = false; }
    if (!ok) {
        MCP.fail("Saving presets is not supported by scripting in this After Effects version. Select the effects and use Animation > Save Animation Preset.", "unsupported");
    }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), presetPath: file.fsName, effectCount: props.length };
}, { mutating: false });
