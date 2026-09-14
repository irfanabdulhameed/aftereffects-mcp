function applyLayerPreset(args) {
    try {
        var resolved = resolveCompAndLayer(args || {});
        var presetPath = args.presetPath;

        if (!presetPath) {
            throw new Error("presetPath is required.");
        }

        var presetFile = new File(presetPath);
        if (!presetFile.exists) {
            throw new Error("Preset file not found: " + presetPath);
        }

        resolved.layer.applyPreset(presetFile);

        return JSON.stringify({
            status: "success",
            message: "Preset applied successfully",
            composition: {
                name: resolved.comp.name,
                index: resolved.compIndex
            },
            layer: {
                name: resolved.layer.name,
                index: resolved.layerIndex
            },
            presetPath: presetFile.fsName
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}
