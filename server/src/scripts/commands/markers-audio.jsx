function getLayerAudioInfo(args) {
    try {
        var params = args || {};
        var compIndex = params.compIndex || 1;
        var comp = app.project.item(compIndex);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + compIndex);
        }

        var layer = null;
        if (params.layerIndex !== undefined && params.layerIndex !== null) {
            layer = comp.layer(params.layerIndex);
            if (!layer) { throw new Error("Layer not found at index " + params.layerIndex); }
        } else if (params.layerName) {
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).name === params.layerName) { layer = comp.layer(i); break; }
            }
            if (!layer) { throw new Error("Layer not found with name '" + params.layerName + "'."); }
        } else {
            throw new Error("Provide layerIndex or layerName.");
        }

        var hasAudio = layer.hasAudio || false;
        var audioEnabled = layer.audioEnabled || false;
        var sourceInfo = null;
        var sourceFilePath = null;

        if (layer.source) {
            var src = layer.source;
            sourceInfo = {
                name: src.name,
                hasAudio: src.hasAudio || false,
                audioChannels: src.audioChannels || 0,
                audioSampleRate: src.audioSampleRate || 0,
                audioDuration: src.audioDuration || 0
            };
            if (src.file) {
                sourceFilePath = src.file.fsName;
            }
        }

        var audioLevelsValue = null;
        var audioLevelsKeyframes = [];
        try {
            var audioGroup = layer.property("Audio");
            if (audioGroup) {
                var levProp = null;
                try { levProp = audioGroup.property("Audio Levels"); } catch (e) {}
                if (!levProp) {
                    for (var j = 1; j <= audioGroup.numProperties; j++) {
                        var ap = audioGroup.property(j);
                        if (ap.matchName === "ADBE Audio Levels" || ap.name === "Audio Levels") {
                            levProp = ap; break;
                        }
                    }
                }
                if (levProp) {
                    audioLevelsValue = levProp.value;
                    for (var k = 1; k <= levProp.numKeys; k++) {
                        audioLevelsKeyframes.push({
                            index: k,
                            timeInSeconds: levProp.keyTime(k),
                            value: levProp.keyValue(k)
                        });
                    }
                }
            }
        } catch (e) {}

        var existingMarkers = [];
        try {
            var markerProp = layer.property("Marker");
            if (markerProp) {
                for (var m = 1; m <= markerProp.numKeys; m++) {
                    var mv = markerProp.keyValue(m);
                    existingMarkers.push({
                        index: m,
                        timeInSeconds: markerProp.keyTime(m),
                        comment: mv.comment,
                        duration: mv.duration,
                        label: mv.label
                    });
                }
            }
        } catch (e) {}

        return JSON.stringify({
            status: "success",
            composition: { name: comp.name, index: compIndex, frameRate: comp.frameRate },
            layer: {
                name: layer.name,
                index: layer.index,
                hasAudio: hasAudio,
                audioEnabled: audioEnabled,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint
            },
            source: sourceInfo,
            sourceFilePath: sourceFilePath,
            audioLevels: { currentValue: audioLevelsValue, keyframes: audioLevelsKeyframes },
            existingMarkers: existingMarkers
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

function addMarkersFromArray(args) {
    try {
        var params = args || {};
        var compIndex = params.compIndex || 1;
        var comp = app.project.item(compIndex);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + compIndex);
        }

        var markers = params.markers;
        if (!markers || !(markers instanceof Array) || markers.length === 0) {
            throw new Error("markers must be a non-empty array of {timeInSeconds, comment?, duration?, label?} objects.");
        }

        var markerType = params.markerType || "layer";
        var layer = null;

        if (markerType === "layer") {
            if (params.layerIndex !== undefined && params.layerIndex !== null) {
                layer = comp.layer(params.layerIndex);
                if (!layer) { throw new Error("Layer not found at index " + params.layerIndex); }
            } else if (params.layerName) {
                for (var i = 1; i <= comp.numLayers; i++) {
                    if (comp.layer(i).name === params.layerName) { layer = comp.layer(i); break; }
                }
                if (!layer) { throw new Error("Layer not found with name '" + params.layerName + "'."); }
            } else {
                throw new Error("Provide layerIndex or layerName for layer markers, or set markerType to 'comp'.");
            }
        }

        var added = [];
        var errors = [];

        for (var j = 0; j < markers.length; j++) {
            try {
                var spec = markers[j];
                var timeInSeconds = Number(spec.timeInSeconds);
                var mv = new MarkerValue(spec.comment || "");
                mv.duration = (spec.duration !== undefined && spec.duration !== null) ? Number(spec.duration) : 0;
                if (spec.chapter)  { mv.chapter = spec.chapter; }
                if (spec.url)      { mv.url     = spec.url;     }
                if (spec.label)    { mv.label   = Number(spec.label); }

                if (markerType === "comp") {
                    comp.markerProperty.setValueAtTime(timeInSeconds, mv);
                } else {
                    layer.property("Marker").setValueAtTime(timeInSeconds, mv);
                }
                added.push({ timeInSeconds: timeInSeconds, comment: spec.comment || "" });
            } catch (e) {
                errors.push({ index: j, timeInSeconds: markers[j].timeInSeconds, error: e.toString() });
            }
        }

        return JSON.stringify({
            status: "success",
            message: "Bulk marker insertion complete",
            addedCount: added.length,
            errorCount: errors.length,
            added: added,
            errors: errors,
            composition: { name: comp.name, index: compIndex },
            layer: layer ? { name: layer.name, index: layer.index } : null
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

function addMarker(args) {
    try {
        var params = args || {};
        var compIndex = params.compIndex || 1;
        var comp = app.project.item(compIndex);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + compIndex);
        }

        var timeInSeconds = (params.timeInSeconds !== undefined && params.timeInSeconds !== null)
            ? Number(params.timeInSeconds)
            : comp.time;

        var comment  = params.comment  || "";
        var chapter  = params.chapter  || "";
        var url      = params.url      || "";
        var duration = (params.duration !== undefined && params.duration !== null) ? Number(params.duration) : 0;
        var label    = (params.label   !== undefined && params.label   !== null) ? Number(params.label)   : 0;

        var markerVal = new MarkerValue(comment);
        markerVal.duration = duration;
        if (chapter)  { markerVal.chapter    = chapter;  }
        if (url)      { markerVal.url        = url;      }
        if (label)    { markerVal.label      = label;    }

        var markerType = params.markerType || "layer"; 

        if (markerType === "comp") {
            comp.markerProperty.setValueAtTime(timeInSeconds, markerVal);
            return JSON.stringify({
                status: "success",
                message: "Composition marker added",
                composition: { name: comp.name, index: compIndex },
                marker: { timeInSeconds: timeInSeconds, comment: comment, duration: duration, label: label }
            }, null, 2);
        }

        
        var layer = null;
        if (params.layerIndex !== undefined && params.layerIndex !== null) {
            layer = comp.layer(params.layerIndex);
            if (!layer) { throw new Error("Layer not found at index " + params.layerIndex); }
        } else if (params.layerName) {
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).name === params.layerName) { layer = comp.layer(i); break; }
            }
            if (!layer) { throw new Error("Layer not found with name '" + params.layerName + "'."); }
        } else {
            throw new Error("Provide layerIndex or layerName for a layer marker, or set markerType to 'comp'.");
        }

        var markerProp = layer.property("Marker");
        if (!markerProp) { throw new Error("Layer '" + layer.name + "' does not support markers."); }
        markerProp.setValueAtTime(timeInSeconds, markerVal);

        return JSON.stringify({
            status: "success",
            message: "Layer marker added",
            composition: { name: comp.name, index: compIndex },
            layer: { name: layer.name, index: layer.index },
            marker: { timeInSeconds: timeInSeconds, comment: comment, duration: duration, label: label }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

function setLayerAudioLevels(args) {
    try {
        var resolved = resolveCompAndLayer(args || {});
        var layer = resolved.layer;

        var audioGroup = layer.property("Audio");
        if (!audioGroup) {
            throw new Error("Layer '" + layer.name + "' has no Audio property. Ensure it is an audio or AV layer.");
        }

        
        var audioLevelsProp = null;
        try { audioLevelsProp = audioGroup.property("Audio Levels"); } catch (e) {}
        if (!audioLevelsProp) {
            for (var i = 1; i <= audioGroup.numProperties; i++) {
                var p = audioGroup.property(i);
                if (p.matchName === "ADBE Audio Levels" || p.name === "Audio Levels") {
                    audioLevelsProp = p;
                    break;
                }
            }
        }
        if (!audioLevelsProp) {
            throw new Error("Audio Levels property not found on layer '" + layer.name + "'.");
        }

        var level      = (args.level      !== undefined && args.level      !== null) ? Number(args.level)      : null;
        var leftLevel  = (args.leftLevel  !== undefined && args.leftLevel  !== null) ? Number(args.leftLevel)  : level;
        var rightLevel = (args.rightLevel !== undefined && args.rightLevel !== null) ? Number(args.rightLevel) : level;

        if (leftLevel === null && rightLevel === null) {
            throw new Error("Provide level (both channels), leftLevel, or rightLevel in dB.");
        }
        if (leftLevel  === null) { leftLevel  = rightLevel; }
        if (rightLevel === null) { rightLevel = leftLevel;  }

        var levelsValue = [leftLevel, rightLevel];

        if (args.timeInSeconds !== undefined && args.timeInSeconds !== null) {
            if (!audioLevelsProp.canVaryOverTime) {
                throw new Error("Audio Levels property cannot be keyframed on this layer.");
            }
            audioLevelsProp.setValueAtTime(Number(args.timeInSeconds), levelsValue);
        } else {
            audioLevelsProp.setValue(levelsValue);
        }

        return JSON.stringify({
            status: "success",
            message: "Audio levels set successfully",
            composition: { name: resolved.comp.name, index: resolved.compIndex },
            layer: { name: layer.name, index: layer.index },
            audioLevels: {
                left: leftLevel,
                right: rightLevel,
                timeInSeconds: (args.timeInSeconds !== undefined && args.timeInSeconds !== null) ? Number(args.timeInSeconds) : null
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}
