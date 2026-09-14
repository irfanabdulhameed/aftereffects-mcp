function findPropertyByNameOrMatchName(container, propertyName) {
    if (!container || !propertyName || !container.numProperties) {
        return null;
    }

    for (var i = 1; i <= container.numProperties; i++) {
        var candidate = container.property(i);
        if (candidate && (candidate.name === propertyName || candidate.matchName === propertyName)) {
            return candidate;
        }
    }

    return null;
}

function resolvePropertyPath(rootProperty, pathTokens) {
    var current = rootProperty;

    for (var i = 0; i < pathTokens.length; i++) {
        if (!current) {
            return null;
        }

        var token = pathTokens[i];
        var nextProperty = null;

        if (typeof token === "number") {
            nextProperty = current.property(token);
        } else {
            nextProperty = current.property(token);
            if (!nextProperty) {
                nextProperty = findPropertyByNameOrMatchName(current, token);
            }
        }

        current = nextProperty;
    }

    return current;
}

function normalizePropertyPath(pathInput) {
    if (pathInput instanceof Array) {
        return pathInput;
    }

    if (typeof pathInput === "string" && pathInput.length > 0) {
        return pathInput.split("/");
    }

    return [];
}

function resolveCompAndLayer(args) {
    var compIndex = args.compIndex || 1;
    var layerIndex = args.layerIndex || 1;

    var comp = app.project.item(compIndex);
    if (!comp || !(comp instanceof CompItem)) {
        throw new Error("Composition not found at index " + compIndex);
    }

    var layer = comp.layer(layerIndex);
    if (!layer) {
        throw new Error("Layer not found at index " + layerIndex + " in composition '" + comp.name + "'");
    }

    return {
        comp: comp,
        layer: layer,
        compIndex: compIndex,
        layerIndex: layerIndex
    };
}

function resolveEffectOnLayer(layer, args) {
    var effectsGroup = layer.property("Effects");
    if (!effectsGroup) {
        throw new Error("Layer has no Effects group");
    }

    var effect = null;

    if (args.effectIndex !== undefined && args.effectIndex !== null) {
        effect = effectsGroup.property(args.effectIndex);
    }

    if (!effect && args.effectName) {
        effect = findPropertyByNameOrMatchName(effectsGroup, args.effectName);
    }

    if (!effect && args.effectMatchName) {
        effect = findPropertyByNameOrMatchName(effectsGroup, args.effectMatchName);
    }

    if (!effect) {
        throw new Error("Effect not found on layer. Provide effectIndex, effectName, or effectMatchName.");
    }

    return effect;
}
