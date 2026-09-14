function getInterpolationTypeByName(name) {
    if (!name) {
        return null;
    }

    var normalized = String(name).toLowerCase();
    if (normalized === "linear") {
        return KeyframeInterpolationType.LINEAR;
    }
    if (normalized === "bezier") {
        return KeyframeInterpolationType.BEZIER;
    }
    if (normalized === "hold") {
        return KeyframeInterpolationType.HOLD;
    }

    return null;
}

function getPropertyDimensionCount(property) {
    try {
        var value = property.value;
        if (value instanceof Array) {
            return value.length;
        }
    } catch (e) {
        
    }
    return 1;
}

function findKeyIndexAtTime(property, timeInSeconds) {
    var epsilon = 0.0001;
    for (var i = 1; i <= property.numKeys; i++) {
        if (Math.abs(property.keyTime(i) - timeInSeconds) <= epsilon) {
            return i;
        }
    }
    return -1;
}

function buildEaseArray(dimensionCount, speed, influence) {
    var easeArray = [];
    var resolvedSpeed = (speed !== undefined && speed !== null) ? Number(speed) : 0;
    var resolvedInfluence = (influence !== undefined && influence !== null) ? Number(influence) : 33.333;

    for (var i = 0; i < dimensionCount; i++) {
        easeArray.push(new KeyframeEase(resolvedSpeed, resolvedInfluence));
    }

    return easeArray;
}

function buildEaseArrayFromSpec(dimensionCount, spec, fallbackSpeed, fallbackInfluence) {
    if (spec instanceof Array) {
        var result = [];
        for (var i = 0; i < dimensionCount; i++) {
            var item = spec[i] || spec[spec.length - 1] || {};
            var itemSpeed = (item.speed !== undefined && item.speed !== null) ? Number(item.speed) : fallbackSpeed;
            var itemInfluence = (item.influence !== undefined && item.influence !== null) ? Number(item.influence) : fallbackInfluence;
            result.push(new KeyframeEase(itemSpeed, itemInfluence));
        }
        return result;
    }

    var speed = spec && spec.speed;
    var influence = spec && spec.influence;
    return buildEaseArray(
        dimensionCount,
        (speed !== undefined && speed !== null) ? speed : fallbackSpeed,
        (influence !== undefined && influence !== null) ? influence : fallbackInfluence
    );
}

function getKeyframeOptionsFromArgs(args) {
    var options = args.keyframeOptions || {};

    
    if (args.easyEase !== undefined) {
        options.easyEase = args.easyEase;
    }
    if (args.interpolationIn !== undefined) {
        options.interpolationIn = args.interpolationIn;
    }
    if (args.interpolationOut !== undefined) {
        options.interpolationOut = args.interpolationOut;
    }
    if (args.temporalContinuous !== undefined) {
        options.temporalContinuous = args.temporalContinuous;
    }
    if (args.temporalAutoBezier !== undefined) {
        options.temporalAutoBezier = args.temporalAutoBezier;
    }
    if (args.roving !== undefined) {
        options.roving = args.roving;
    }
    if (args.easeIn !== undefined) {
        options.easeIn = args.easeIn;
    }
    if (args.easeOut !== undefined) {
        options.easeOut = args.easeOut;
    }
    if (args.spatialTangentsIn !== undefined) {
        options.spatialTangentsIn = args.spatialTangentsIn;
    }
    if (args.spatialTangentsOut !== undefined) {
        options.spatialTangentsOut = args.spatialTangentsOut;
    }
    if (args.spatialContinuous !== undefined) {
        options.spatialContinuous = args.spatialContinuous;
    }
    if (args.spatialAutoBezier !== undefined) {
        options.spatialAutoBezier = args.spatialAutoBezier;
    }

    return options;
}

function applyKeyframeGraphOptions(property, keyIndex, options) {
    if (!options) {
        return;
    }

    var dimensionCount = getPropertyDimensionCount(property);

    if (options.easyEase) {
        var easyInfluence = (options.easyEaseInfluence !== undefined && options.easyEaseInfluence !== null)
            ? Number(options.easyEaseInfluence)
            : 33.333;
        var easyIn = buildEaseArray(dimensionCount, 0, easyInfluence);
        var easyOut = buildEaseArray(dimensionCount, 0, easyInfluence);
        property.setTemporalEaseAtKey(keyIndex, easyIn, easyOut);
    }

    if (options.easeIn || options.easeOut) {
        var inEase = buildEaseArrayFromSpec(dimensionCount, options.easeIn, 0, 33.333);
        var outEase = buildEaseArrayFromSpec(dimensionCount, options.easeOut, 0, 33.333);
        property.setTemporalEaseAtKey(keyIndex, inEase, outEase);
    }

    var inInterpolation = getInterpolationTypeByName(options.interpolationIn);
    var outInterpolation = getInterpolationTypeByName(options.interpolationOut);
    if (inInterpolation || outInterpolation) {
        if (!inInterpolation) {
            inInterpolation = property.keyInInterpolationType(keyIndex);
        }
        if (!outInterpolation) {
            outInterpolation = property.keyOutInterpolationType(keyIndex);
        }
        property.setInterpolationTypeAtKey(keyIndex, inInterpolation, outInterpolation);
    }

    if (options.temporalContinuous !== undefined) {
        property.setTemporalContinuousAtKey(keyIndex, !!options.temporalContinuous);
    }

    if (options.temporalAutoBezier !== undefined) {
        property.setTemporalAutoBezierAtKey(keyIndex, !!options.temporalAutoBezier);
    }

    if (options.roving !== undefined) {
        try {
            property.setRovingAtKey(keyIndex, !!options.roving);
        } catch (e) {
            
        }
    }

    if (options.spatialTangentsIn !== undefined || options.spatialTangentsOut !== undefined) {
        try {
            var inTangent = options.spatialTangentsIn;
            var outTangent = options.spatialTangentsOut;
            if (inTangent === undefined || inTangent === null) {
                inTangent = property.keyInSpatialTangent(keyIndex);
            }
            if (outTangent === undefined || outTangent === null) {
                outTangent = property.keyOutSpatialTangent(keyIndex);
            }
            property.setSpatialTangentsAtKey(keyIndex, inTangent, outTangent);
        } catch (e) {
            
        }
    }

    if (options.spatialContinuous !== undefined) {
        try {
            property.setSpatialContinuousAtKey(keyIndex, !!options.spatialContinuous);
        } catch (e) {
            
        }
    }

    if (options.spatialAutoBezier !== undefined) {
        try {
            property.setSpatialAutoBezierAtKey(keyIndex, !!options.spatialAutoBezier);
        } catch (e) {
            
        }
    }
}
