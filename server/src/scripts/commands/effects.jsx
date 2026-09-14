function tryAddEffect(layer, identifier, mode) {
    if (!identifier) {
        return null;
    }

    try {
        if (mode === "matchName") {
            return layer.Effects.addProperty(identifier);
        }
        if (mode === "name") {
            return layer.Effects.addProperty(identifier);
        }
    } catch (e) {
        return null;
    }

    return null;
}

function addEffectByAnyIdentifier(layer, effectIdentifier, effectName, effectMatchName) {
    var attempts = [];
    var effect = null;

    if (effectMatchName) {
        attempts.push({ value: effectMatchName, mode: "matchName" });
    }

    if (effectIdentifier) {
        attempts.push({ value: effectIdentifier, mode: "matchName" });
        attempts.push({ value: effectIdentifier, mode: "name" });
    }

    if (effectName) {
        attempts.push({ value: effectName, mode: "name" });
    }

    for (var i = 0; i < attempts.length; i++) {
        effect = tryAddEffect(layer, attempts[i].value, attempts[i].mode);
        if (effect) {
            return {
                effect: effect,
                resolvedBy: attempts[i]
            };
        }
    }

    return null;
}

function applyEffect(args) {
    try {
        
        var compIndex = args.compIndex || 1; 
        var layerIndex = args.layerIndex || 1; 
        var effectIdentifier = args.effect || args.effectIdentifier; 
        var effectName = args.effectName; 
        var effectMatchName = args.effectMatchName; 
        var effectCategory = args.effectCategory || ""; 
        var presetPath = args.presetPath; 
        var effectSettings = args.effectSettings || {}; 
        
        if (!effectIdentifier && !effectName && !effectMatchName && !presetPath) {
            throw new Error("You must specify effect, effectIdentifier, effectName, effectMatchName, or presetPath");
        }
        
        
        var comp = app.project.item(compIndex);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + compIndex);
        }
        
        
        var layer = comp.layer(layerIndex);
        if (!layer) {
            throw new Error("Layer not found at index " + layerIndex + " in composition '" + comp.name + "'");
        }
        
        var effectResult;
        
        
        if (presetPath) {
            var presetFile = new File(presetPath);
            if (!presetFile.exists) {
                throw new Error("Effect preset file not found: " + presetPath);
            }
            
            
            layer.applyPreset(presetFile);
            effectResult = {
                type: "preset",
                name: presetPath.split('/').pop().split('\\').pop(),
                applied: true
            };
        }
        
        else if (effectMatchName || effectName || effectIdentifier) {
            var added = addEffectByAnyIdentifier(layer, effectIdentifier, effectName, effectMatchName);
            if (!added || !added.effect) {
                throw new Error("Could not add effect. Try a valid effectMatchName (for example: 'ADBE Gaussian Blur 2') or exact effect display name.");
            }

            var effect = added.effect;
            effectResult = {
                type: "effect",
                name: effect.name,
                matchName: effect.matchName,
                index: effect.propertyIndex,
                resolvedBy: added.resolvedBy
            };
            
            
            applyEffectSettings(effect, effectSettings);
        }
        
        return JSON.stringify({
            status: "success",
            message: "Effect applied successfully",
            effect: effectResult,
            layer: {
                name: layer.name,
                index: layerIndex
            },
            composition: {
                name: comp.name,
                index: compIndex
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

function applyEffectSettings(effect, settings) {
    
    var hasAnySetting = false;
    if (!settings) {
        return;
    }
    for (var key in settings) {
        if (settings.hasOwnProperty(key)) {
            hasAnySetting = true;
            break;
        }
    }
    if (!hasAnySetting) {
        return;
    }
    
    
    for (var propName in settings) {
        if (settings.hasOwnProperty(propName)) {
            try {
                
                var property = null;
                
                
                try {
                    property = effect.property(propName);
                } catch (e) {
                    
                    for (var i = 1; i <= effect.numProperties; i++) {
                        var prop = effect.property(i);
                        if (prop.name === propName) {
                            property = prop;
                            break;
                        }
                    }
                }
                
                
                if (property && property.setValue) {
                    property.setValue(coerceScriptValue(settings[propName]));
                }
            } catch (e) {
                
                $.writeln("Error setting effect property '" + propName + "': " + e.toString());
            }
        }
    }
}

function listLayerEffects(args) {
    try {
        var resolved = resolveCompAndLayer(args || {});
        var layer = resolved.layer;
        var effectsGroup = layer.property("Effects");
        var includeProperties = !!args.includeProperties;
        var includeValues = !!args.includeValues;
        var maxDepth = args.maxDepth || 2;

        var effects = [];
        if (effectsGroup && effectsGroup.numProperties) {
            for (var i = 1; i <= effectsGroup.numProperties; i++) {
                var effect = effectsGroup.property(i);
                var effectInfo = {
                    index: effect.propertyIndex,
                    name: effect.name,
                    matchName: effect.matchName,
                    enabled: effect.enabled
                };

                if (includeProperties) {
                    effectInfo.properties = [];
                    for (var j = 1; j <= effect.numProperties; j++) {
                        var child = effect.property(j);
                        effectInfo.properties.push(serializeEffectProperty(child, includeValues, 1, maxDepth));
                    }
                }

                effects.push(effectInfo);
            }
        }

        return JSON.stringify({
            status: "success",
            composition: {
                name: resolved.comp.name,
                index: resolved.compIndex
            },
            layer: {
                name: layer.name,
                index: resolved.layerIndex
            },
            effectCount: effects.length,
            effects: effects
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

function listAvailableEffects(args) {
    try {
        var params = args || {};
        var query = params.query ? String(params.query).toLowerCase() : "";
        var includeObsolete = !!params.includeObsolete;
        var maxResults = (params.maxResults !== undefined && params.maxResults !== null)
            ? Number(params.maxResults)
            : 5000;

        if (!app.effects) {
            throw new Error("After Effects app.effects API is not available in this version.");
        }

        var effectsCollection = app.effects;
        var collectionCount = 0;
        if (effectsCollection.length !== undefined && effectsCollection.length !== null) {
            collectionCount = Number(effectsCollection.length);
        } else if (effectsCollection.numEffects !== undefined && effectsCollection.numEffects !== null) {
            collectionCount = Number(effectsCollection.numEffects);
        }

        var effects = [];
        for (var i = 0; i < collectionCount; i++) {
            var effectObj = null;
            try {
                effectObj = effectsCollection[i];
            } catch (e1) {
                effectObj = null;
            }
            if (!effectObj && effectsCollection.effect) {
                try {
                    effectObj = effectsCollection.effect(i + 1);
                } catch (e2) {
                    effectObj = null;
                }
            }
            if (!effectObj) {
                continue;
            }

            var name = "";
            var matchName = "";
            var category = "";
            var isObsolete = false;

            try { name = effectObj.displayName || effectObj.name || ""; } catch (e3) {}
            try { matchName = effectObj.matchName || ""; } catch (e4) {}
            try { category = effectObj.category || ""; } catch (e5) {}
            try { isObsolete = !!effectObj.isObsolete; } catch (e6) {}

            if (!includeObsolete && isObsolete) {
                continue;
            }

            if (query) {
                var haystack = (String(name) + " " + String(matchName) + " " + String(category)).toLowerCase();
                if (haystack.indexOf(query) === -1) {
                    continue;
                }
            }

            effects.push({
                index: i,
                name: name,
                matchName: matchName,
                category: category,
                isObsolete: isObsolete
            });

            if (effects.length >= maxResults) {
                break;
            }
        }

        return JSON.stringify({
            status: "success",
            query: query || null,
            includeObsolete: includeObsolete,
            returnedCount: effects.length,
            totalScanned: collectionCount,
            effects: effects
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

function setEffectProperty(args) {
    try {
        var resolved = resolveCompAndLayer(args || {});
        var effect = resolveEffectOnLayer(resolved.layer, args || {});
        var propertyPath = normalizePropertyPath(args.propertyPath);
        var targetProperty = null;

        if (propertyPath.length > 0) {
            targetProperty = resolvePropertyPath(effect, propertyPath);
        }

        if (!targetProperty && args.propertyName) {
            targetProperty = findPropertyByNameOrMatchName(effect, args.propertyName);
        }

        if (!targetProperty && args.propertyIndex !== undefined && args.propertyIndex !== null) {
            targetProperty = effect.property(args.propertyIndex);
        }

        if (!targetProperty) {
            throw new Error("Target effect property not found. Provide propertyPath, propertyName, or propertyIndex.");
        }

        var previousValue = readPropertyValue(targetProperty);

        if (args.expressionString !== undefined && args.expressionString !== null) {
            if (!targetProperty.canSetExpression) {
                throw new Error("Property '" + targetProperty.name + "' does not support expressions.");
            }
            targetProperty.expression = args.expressionString;
        }

        var keyframeIndex = (args.keyframeIndex !== undefined && args.keyframeIndex !== null)
            ? Number(args.keyframeIndex)
            : -1;
        var keyframeApplied = false;

        if (args.value !== undefined) {
            if (args.timeInSeconds !== undefined && args.timeInSeconds !== null) {
                if (!targetProperty.canVaryOverTime) {
                    throw new Error("Property '" + targetProperty.name + "' cannot be keyframed.");
                }
                targetProperty.setValueAtTime(args.timeInSeconds, coerceScriptValue(args.value));
            } else if (keyframeIndex > 0 && targetProperty.setValueAtKey) {
                targetProperty.setValueAtKey(keyframeIndex, coerceScriptValue(args.value));
            } else if (targetProperty.setValue) {
                targetProperty.setValue(coerceScriptValue(args.value));
            } else {
                throw new Error("Property '" + targetProperty.name + "' is not directly writable.");
            }
        }

        if (args.timeInSeconds !== undefined && args.timeInSeconds !== null) {
            keyframeIndex = findKeyIndexAtTime(targetProperty, args.timeInSeconds);
            if (keyframeIndex < 0) {
                throw new Error("Could not find keyframe at the requested time after update.");
            }
        }

        var graphOptions = getKeyframeOptionsFromArgs(args);
        var hasGraphOptions = false;
        for (var graphKey in graphOptions) {
            if (graphOptions.hasOwnProperty(graphKey)) {
                hasGraphOptions = true;
                break;
            }
        }

        if (keyframeIndex > 0 && (hasGraphOptions || (args.timeInSeconds !== undefined && args.timeInSeconds !== null))) {
            applyKeyframeGraphOptions(targetProperty, keyframeIndex, graphOptions);
            keyframeApplied = true;
        }

        return JSON.stringify({
            status: "success",
            message: "Effect property updated successfully",
            composition: {
                name: resolved.comp.name,
                index: resolved.compIndex
            },
            layer: {
                name: resolved.layer.name,
                index: resolved.layerIndex
            },
            effect: {
                index: effect.propertyIndex,
                name: effect.name,
                matchName: effect.matchName
            },
            property: {
                name: targetProperty.name,
                matchName: targetProperty.matchName,
                index: targetProperty.propertyIndex,
                previousValue: previousValue,
                currentValue: readPropertyValue(targetProperty),
                expressionEnabled: targetProperty.canSetExpression ? (targetProperty.expression !== "") : false,
                keyframeApplied: keyframeApplied,
                keyframeIndex: keyframeIndex
            },
            keyframeTimeInSeconds: (args.timeInSeconds !== undefined && args.timeInSeconds !== null) ? args.timeInSeconds : null
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

function setEffectKeyframe(args) {
    if ((args.timeInSeconds === undefined || args.timeInSeconds === null) &&
        (args.keyframeIndex === undefined || args.keyframeIndex === null)) {
        return JSON.stringify({
            status: "error",
            message: "timeInSeconds or keyframeIndex is required for setEffectKeyframe"
        }, null, 2);
    }

    if (args.value === undefined) {
        return JSON.stringify({
            status: "error",
            message: "value is required for setEffectKeyframe"
        }, null, 2);
    }

    return setEffectProperty(args);
}

function removeLayerEffect(args) {
    try {
        var resolved = resolveCompAndLayer(args || {});
        var effectsGroup = resolved.layer.property("Effects");

        if (!effectsGroup || effectsGroup.numProperties === 0) {
            return JSON.stringify({
                status: "success",
                message: "Layer has no effects to remove",
                removedCount: 0
            }, null, 2);
        }

        var removeAll = !!args.removeAll;
        var removedEffects = [];

        if (removeAll) {
            for (var i = effectsGroup.numProperties; i >= 1; i--) {
                var current = effectsGroup.property(i);
                removedEffects.push({
                    index: current.propertyIndex,
                    name: current.name,
                    matchName: current.matchName
                });
                current.remove();
            }
        } else {
            var effect = resolveEffectOnLayer(resolved.layer, args || {});
            removedEffects.push({
                index: effect.propertyIndex,
                name: effect.name,
                matchName: effect.matchName
            });
            effect.remove();
        }

        return JSON.stringify({
            status: "success",
            message: "Effect removal completed",
            composition: {
                name: resolved.comp.name,
                index: resolved.compIndex
            },
            layer: {
                name: resolved.layer.name,
                index: resolved.layerIndex
            },
            removedCount: removedEffects.length,
            removedEffects: removedEffects
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

function applyEffectTemplate(args) {
    try {
        
        var compIndex = args.compIndex || 1; 
        var layerIndex = args.layerIndex || 1; 
        var templateName = args.templateName; 
        var customSettings = args.customSettings || {}; 
        
        if (!templateName) {
            throw new Error("You must specify a templateName");
        }
        
        
        var comp = app.project.item(compIndex);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + compIndex);
        }
        
        
        var layer = comp.layer(layerIndex);
        if (!layer) {
            throw new Error("Layer not found at index " + layerIndex + " in composition '" + comp.name + "'");
        }
        
        
        var templates = {
            
            "gaussian-blur": {
                effectMatchName: "ADBE Gaussian Blur 2",
                settings: {
                    "Blurriness": customSettings.blurriness || 20
                }
            },
            "directional-blur": {
                effectMatchName: "ADBE Directional Blur",
                settings: {
                    "Direction": customSettings.direction || 0,
                    "Blur Length": customSettings.length || 10
                }
            },
            
            
            "color-balance": {
                effectMatchName: "ADBE Color Balance (HLS)",
                settings: {
                    "Hue": customSettings.hue || 0,
                    "Lightness": customSettings.lightness || 0,
                    "Saturation": customSettings.saturation || 0
                }
            },
            "brightness-contrast": {
                effectMatchName: "ADBE Brightness & Contrast 2",
                settings: {
                    "Brightness": customSettings.brightness || 0,
                    "Contrast": customSettings.contrast || 0,
                    "Use Legacy": false
                }
            },
            "curves": {
                effectMatchName: "ADBE CurvesCustom"
            },
            
            
            "glow": {
                effectMatchName: "ADBE Glow",
                settings: {
                    "Glow Threshold": customSettings.threshold || 50,
                    "Glow Radius": customSettings.radius || 15,
                    "Glow Intensity": customSettings.intensity || 1
                }
            },
            "drop-shadow": {
                effectMatchName: "ADBE Drop Shadow",
                settings: {
                    "Shadow Color": customSettings.color || [0, 0, 0, 1],
                    "Opacity": customSettings.opacity || 50,
                    "Direction": customSettings.direction || 135,
                    "Distance": customSettings.distance || 10,
                    "Softness": customSettings.softness || 10
                }
            },
            
            
            "cinematic-look": {
                effects: [
                    {
                        effectMatchName: "ADBE CurvesCustom",
                        settings: {}
                    },
                    {
                        effectMatchName: "ADBE Vibrance",
                        settings: {
                            "Vibrance": 15,
                            "Saturation": -5
                        }
                    }
                ]
            },
            "text-pop": {
                effects: [
                    {
                        effectMatchName: "ADBE Drop Shadow",
                        settings: {
                            "Shadow Color": [0, 0, 0, 1],
                            "Opacity": 75,
                            "Distance": 5,
                            "Softness": 10
                        }
                    },
                    {
                        effectMatchName: "ADBE Glow",
                        settings: {
                            "Glow Threshold": 50,
                            "Glow Radius": 10,
                            "Glow Intensity": 1.5
                        }
                    }
                ]
            }
        };
        
        
        var template = templates[templateName];
        if (!template) {
            var templateNames = [];
            for (var templateKey in templates) {
                if (templates.hasOwnProperty(templateKey)) {
                    templateNames.push(templateKey);
                }
            }
            var availableTemplates = templateNames.join(", ");
            throw new Error("Template '" + templateName + "' not found. Available templates: " + availableTemplates);
        }
        
        var appliedEffects = [];
        
        
        if (template.effectMatchName) {
            
            var effect = layer.Effects.addProperty(template.effectMatchName);
            
            
            for (var propName in template.settings) {
                try {
                    var property = effect.property(propName);
                    if (property) {
                        property.setValue(template.settings[propName]);
                    }
                } catch (e) {
                    $.writeln("Warning: Could not set " + propName + " on effect " + effect.name + ": " + e);
                }
            }
            
            appliedEffects.push({
                name: effect.name,
                matchName: effect.matchName
            });
        } else if (template.effects) {
            
            for (var i = 0; i < template.effects.length; i++) {
                var effectData = template.effects[i];
                var effect = layer.Effects.addProperty(effectData.effectMatchName);
                
                
                for (var propName in effectData.settings) {
                    try {
                        var property = effect.property(propName);
                        if (property) {
                            property.setValue(effectData.settings[propName]);
                        }
                    } catch (e) {
                        $.writeln("Warning: Could not set " + propName + " on effect " + effect.name + ": " + e);
                    }
                }
                
                appliedEffects.push({
                    name: effect.name,
                    matchName: effect.matchName
                });
            }
        }
        
        return JSON.stringify({
            status: "success",
            message: "Effect template '" + templateName + "' applied successfully",
            appliedEffects: appliedEffects,
            layer: {
                name: layer.name,
                index: layerIndex
            },
            composition: {
                name: comp.name,
                index: compIndex
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}
