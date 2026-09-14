function createSolidLayer(args) {
    try {
        var compName = args.compName || "";
        var color = args.color || [1, 1, 1]; 
        var name = args.name || "Solid Layer";
        var position = args.position || [960, 540]; 
        var size = args.size; 
        var startTime = args.startTime || 0;
        var duration = args.duration || 5; 
        var isAdjustment = args.isAdjustment || false; 
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; } 
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        if (!size) { size = [comp.width, comp.height]; }
        var solidLayer;
        if (isAdjustment) {
            solidLayer = comp.layers.addSolid([0, 0, 0], name, size[0], size[1], 1);
            solidLayer.adjustmentLayer = true;
        } else {
            solidLayer = comp.layers.addSolid(color, name, size[0], size[1], 1);
        }
        solidLayer.property("Position").setValue(position);
        solidLayer.startTime = startTime;
        if (duration > 0) { solidLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: isAdjustment ? "Adjustment layer created successfully" : "Solid layer created successfully",
            layer: { name: solidLayer.name, index: solidLayer.index, type: isAdjustment ? "adjustment" : "solid", inPoint: solidLayer.inPoint, outPoint: solidLayer.outPoint, position: solidLayer.property("Position").value, isAdjustment: solidLayer.adjustmentLayer }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

function duplicateLayer(args) {
    try {
        app.beginUndoGroup("MCP: Duplicate layer at times");

        // resolve comp (by name, else active), same pattern as setLayerProperties
        var comp = null;
        var compName = args.compName || "";
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === compName) { comp = it; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        // resolve source layer (by index or name)
        var src = null;
        if (args.layerIndex !== undefined && args.layerIndex !== null) {
            if (args.layerIndex > 0 && args.layerIndex <= comp.numLayers) { src = comp.layer(args.layerIndex); }
            else { throw new Error("Layer index out of bounds: " + args.layerIndex); }
        } else if (args.layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === args.layerName) { src = comp.layer(j); break; }
            }
        }
        if (!src) { throw new Error("Source layer not found: " + (args.layerName || ("index " + args.layerIndex))); }

        var times = args.times;
        if (!(times instanceof Array) || times.length === 0) {
            throw new Error("'times' must be a non-empty array of seconds");
        }

        var fd = comp.frameDuration;
        var offset = (typeof args.offsetSeconds === "number" ? args.offsetSeconds : 0)
                   + (typeof args.offsetFrames === "number" ? args.offsetFrames : 0) * fd;
        var trim = src.inPoint - src.startTime; // head-trim, preserved by duplicate()

        var createdInPoints = [];
        var createdIndices = [];
        for (var k = 0; k < times.length; k++) {
            var targetIn = times[k] + offset;
            var dup = src.duplicate();          // clone above src: same source/trim/effects/audio
            dup.startTime = targetIn - trim;    // => dup.inPoint === targetIn, duration unchanged
            if (args.namePrefix) { dup.name = args.namePrefix; }
            createdInPoints.push(dup.inPoint);
            createdIndices.push(dup.index);
        }

        app.endUndoGroup();
        return JSON.stringify({
            success: true,
            composition: comp.name,
            sourceLayer: src.name,
            frameDuration: fd,
            offsetApplied: offset,
            createdCount: createdIndices.length,
            createdInPoints: createdInPoints
        });
    } catch (e) {
        try { app.endUndoGroup(); } catch (ignore) {}
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

function setLayerProperties(args) {
    try {
        var compName = args.compName || "";
        var layerName = args.layerName || "";
        var layerIndex = args.layerIndex; 
        
        
        var position = args.position; 
        var scale = args.scale; 
        var rotation = args.rotation; 
        var opacity = args.opacity; 
        var startTime = args.startTime; 
        var duration = args.duration; 

        
        var textContent = args.text; 
        var fontFamily = args.fontFamily; 
        var fontSize = args.fontSize; 
        var fillColor = args.fillColor; 
        
        
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; } 
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        
        
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); } 
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }
        
        var changedProperties = [];
        var textDocumentChanged = false;
        var textProp = null;
        var textDocument = null;

        
        if (layer instanceof TextLayer && (textContent !== undefined || fontFamily !== undefined || fontSize !== undefined || fillColor !== undefined)) {
            var sourceTextProp = layer.property("Source Text");
            if (sourceTextProp && sourceTextProp.value) {
                var currentTextDocument = sourceTextProp.value; 
                var updated = false;

                if (textContent !== undefined && textContent !== null && currentTextDocument.text !== textContent) {
                    currentTextDocument.text = textContent;
                    changedProperties.push("text");
                    updated = true;
                }
                if (fontFamily !== undefined && fontFamily !== null && currentTextDocument.font !== fontFamily) {
                    
                    
                    currentTextDocument.font = fontFamily;
                    changedProperties.push("fontFamily");
                    updated = true;
                }
                if (fontSize !== undefined && fontSize !== null && currentTextDocument.fontSize !== fontSize) {
                    currentTextDocument.fontSize = fontSize;
                    changedProperties.push("fontSize");
                    updated = true;
                }
                
                
                if (fillColor !== undefined && fillColor !== null && 
                    (currentTextDocument.fillColor[0] !== fillColor[0] || 
                     currentTextDocument.fillColor[1] !== fillColor[1] || 
                     currentTextDocument.fillColor[2] !== fillColor[2])) {
                    currentTextDocument.fillColor = fillColor;
                    changedProperties.push("fillColor");
                    updated = true;
                }

                
                if (updated) {
                    try {
                        sourceTextProp.setValue(currentTextDocument);
                        logToPanel("Applied changes to Text Document for layer: " + layer.name);
                    } catch (e) {
                        logToPanel("ERROR applying Text Document changes: " + e.toString());
                        
                        
                    }
                }
                 
                 textDocument = currentTextDocument; 

            } else {
                logToPanel("Warning: Could not access Source Text property for layer: " + layer.name);
            }
        }

        
        if (position !== undefined && position !== null) { layer.property("Position").setValue(position); changedProperties.push("position"); }
        if (scale !== undefined && scale !== null) { layer.property("Scale").setValue(scale); changedProperties.push("scale"); }
        if (rotation !== undefined && rotation !== null) {
            if (layer.threeDLayer) { 
                
                layer.property("Z Rotation").setValue(rotation);
            } else { 
                layer.property("Rotation").setValue(rotation); 
            }
            changedProperties.push("rotation");
        }
        if (opacity !== undefined && opacity !== null) { layer.property("Opacity").setValue(opacity); changedProperties.push("opacity"); }
        if (startTime !== undefined && startTime !== null) { layer.startTime = startTime; changedProperties.push("startTime"); }
        if (duration !== undefined && duration !== null && duration > 0) {
            var actualStartTime = (startTime !== undefined && startTime !== null) ? startTime : layer.startTime;
            layer.outPoint = actualStartTime + duration;
            changedProperties.push("duration");
        }

        
        var returnLayerInfo = {
            name: layer.name,
            index: layer.index,
            position: layer.property("Position").value,
            scale: layer.property("Scale").value,
            rotation: layer.threeDLayer ? layer.property("Z Rotation").value : layer.property("Rotation").value, 
            opacity: layer.property("Opacity").value,
            inPoint: layer.inPoint,
            outPoint: layer.outPoint,
            changedProperties: changedProperties
        };
        
        if (layer instanceof TextLayer && textDocument) {
            returnLayerInfo.text = textDocument.text;
            returnLayerInfo.fontFamily = textDocument.font;
            returnLayerInfo.fontSize = textDocument.fontSize;
            returnLayerInfo.fillColor = textDocument.fillColor;
        }

        
        logToPanel("Final check before return:");
        logToPanel("  Changed Properties: " + changedProperties.join(", "));
        logToPanel("  Return Layer Info Font: " + (returnLayerInfo.fontFamily || "N/A")); 
        logToPanel("  TextDocument Font: " + (textDocument ? textDocument.font : "N/A"));

        return JSON.stringify({
            status: "success", message: "Layer properties updated successfully",
            layer: returnLayerInfo
        }, null, 2);
    } catch (error) {
        
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

function createAdjustmentLayer(args) {
    try {
        var params = args || {};
        var compName = params.compName || "";
        var name = params.name || "Adjustment Layer";
        var position = params.position;
        var size = params.size;
        var startTime = params.startTime || 0;
        var duration = params.duration || 5;

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) {
                comp = item;
                break;
            }
        }

        if (!comp) {
            if (app.project.activeItem instanceof CompItem) {
                comp = app.project.activeItem;
            } else {
                throw new Error("No composition found with name '" + compName + "' and no active composition");
            }
        }

        if (!size) {
            size = [comp.width, comp.height];
        }

        if (!position) {
            position = [comp.width / 2, comp.height / 2];
        }

        var adjustmentLayer = comp.layers.addSolid([0, 0, 0], name, size[0], size[1], 1);
        adjustmentLayer.adjustmentLayer = true;
        adjustmentLayer.property("Position").setValue(position);
        adjustmentLayer.startTime = startTime;
        if (duration > 0) {
            adjustmentLayer.outPoint = startTime + duration;
        }

        return JSON.stringify({
            status: "success",
            message: "Adjustment layer created successfully",
            layer: {
                name: adjustmentLayer.name,
                index: adjustmentLayer.index,
                type: "adjustment",
                inPoint: adjustmentLayer.inPoint,
                outPoint: adjustmentLayer.outPoint,
                position: adjustmentLayer.property("Position").value,
                isAdjustment: adjustmentLayer.adjustmentLayer
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

function centerLayers(args) {
    try {
        var params = args || {};
        var compIndex = params.compIndex || 1;
        var comp = app.project.item(compIndex);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + compIndex);
        }
        var centerX = comp.width / 2;
        var centerY = comp.height / 2;
        var centered = [];

        function centerOneLayer(layer) {
            if (!layer) {
                return;
            }
            var positionProp = layer.property("Transform").property("Position");
            if (!positionProp || !positionProp.setValue) {
                return;
            }

            var current = positionProp.value;
            var nextValue = null;
            if (current instanceof Array && current.length >= 3) {
                nextValue = [centerX, centerY, current[2]];
            } else {
                nextValue = [centerX, centerY];
            }
            positionProp.setValue(nextValue);

            centered.push({
                index: layer.index,
                name: layer.name,
                position: nextValue
            });
        }

        if (params.allLayers) {
            for (var i = 1; i <= comp.numLayers; i++) {
                centerOneLayer(comp.layer(i));
            }
        } else if (params.selectedOnly) {
            var selected = comp.selectedLayers || [];
            for (var j = 0; j < selected.length; j++) {
                centerOneLayer(selected[j]);
            }
        } else if (params.layerName) {
            var target = null;
            for (var k = 1; k <= comp.numLayers; k++) {
                if (comp.layer(k).name === params.layerName) {
                    target = comp.layer(k);
                    break;
                }
            }
            if (!target) {
                throw new Error("Layer not found with name '" + params.layerName + "'.");
            }
            centerOneLayer(target);
        } else {
            centerOneLayer(comp.layer(params.layerIndex || 1));
        }

        return JSON.stringify({
            status: "success",
            message: "Layer centering completed",
            composition: {
                name: comp.name,
                index: compIndex,
                center: [centerX, centerY]
            },
            centeredCount: centered.length,
            centeredLayers: centered
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

function getLayerClipFrames(args) {
    try {
        var params = args || {};
        var compIndex = params.compIndex || 1;
        var comp = app.project.item(compIndex);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + compIndex);
        }

        var layer = null;
        if (params.layerIndex !== undefined && params.layerIndex !== null) {
            if (params.layerIndex > 0 && params.layerIndex <= comp.numLayers) {
                layer = comp.layer(params.layerIndex);
            } else {
                throw new Error("Layer index out of bounds: " + params.layerIndex);
            }
        } else if (params.layerName) {
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).name === params.layerName) {
                    layer = comp.layer(i);
                    break;
                }
            }
            if (!layer) {
                throw new Error("Layer not found with name '" + params.layerName + "'.");
            }
        } else {
            throw new Error("Provide layerIndex or layerName.");
        }

        var frameDuration = comp.frameDuration;
        function toFrameNumber(timeValue) {
            return Math.round(timeValue / frameDuration);
        }

        var clipStartTime = layer.inPoint;
        var clipEndTime = layer.outPoint;
        var layerStartTime = layer.startTime;
        var sourceStartTime = layer.inPoint - layer.startTime;
        var sourceEndTime = layer.outPoint - layer.startTime;

        return JSON.stringify({
            status: "success",
            composition: {
                name: comp.name,
                index: compIndex,
                frameRate: comp.frameRate,
                frameDuration: frameDuration
            },
            layer: {
                name: layer.name,
                index: layer.index,
                sourceName: layer.source ? layer.source.name : null,
                startTimeSeconds: layerStartTime,
                startFrame: toFrameNumber(layerStartTime),
                clipStartTimeSeconds: clipStartTime,
                clipStartFrame: toFrameNumber(clipStartTime),
                clipEndTimeSeconds: clipEndTime,
                clipEndFrame: toFrameNumber(clipEndTime),
                sourceStartTimeSeconds: sourceStartTime,
                sourceStartFrame: toFrameNumber(sourceStartTime),
                sourceEndTimeSeconds: sourceEndTime,
                sourceEndFrame: toFrameNumber(sourceEndTime),
                durationSeconds: clipEndTime - clipStartTime,
                durationFrames: toFrameNumber(clipEndTime - clipStartTime)
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

function getLayerInfo() {
    var project = app.project;
    var result = {
        layers: []
    };
    var activeComp = null;
    if (app.project.activeItem instanceof CompItem) {
        activeComp = app.project.activeItem;
    } else {
        return JSON.stringify({ error: "No active composition" }, null, 2);
    }
    for (var i = 1; i <= activeComp.numLayers; i++) {
        var layer = activeComp.layer(i);
        var layerInfo = {
            index: layer.index,
            name: layer.name,
            enabled: layer.enabled,
            locked: layer.locked,
            inPoint: layer.inPoint,
            outPoint: layer.outPoint
        };
        
        result.layers.push(layerInfo);
    }
    
    return JSON.stringify(result, null, 2);
}
