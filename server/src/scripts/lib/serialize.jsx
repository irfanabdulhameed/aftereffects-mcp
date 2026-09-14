/*
 * Summaries returned by commands so the agent can verify state without a
 * second round-trip. Everything here is read-only and defensive: any field
 * that throws on a given layer type is omitted rather than failing the command.
 */

MCP.serialize = {};
MCP.enums = {};

function _mcpTry(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
}

/* ------------------------------------------------------------- enum tables */

MCP.enums.blendModes = function () {
    if (MCP.enums._blend) { return MCP.enums._blend; }
    var pairs = [
        ["normal", "NORMAL"], ["dissolve", "DISSOLVE"], ["dancing-dissolve", "DANCING_DISSOLVE"],
        ["darken", "DARKEN"], ["multiply", "MULTIPLY"], ["color-burn", "COLOR_BURN"], ["classic-color-burn", "CLASSIC_COLOR_BURN"],
        ["linear-burn", "LINEAR_BURN"], ["darker-color", "DARKER_COLOR"],
        ["add", "ADD"], ["lighten", "LIGHTEN"], ["screen", "SCREEN"], ["color-dodge", "COLOR_DODGE"], ["classic-color-dodge", "CLASSIC_COLOR_DODGE"],
        ["linear-dodge", "LINEAR_DODGE"], ["lighter-color", "LIGHTER_COLOR"],
        ["overlay", "OVERLAY"], ["soft-light", "SOFT_LIGHT"], ["hard-light", "HARD_LIGHT"], ["linear-light", "LINEAR_LIGHT"],
        ["vivid-light", "VIVID_LIGHT"], ["pin-light", "PIN_LIGHT"], ["hard-mix", "HARD_MIX"],
        ["difference", "DIFFERENCE"], ["classic-difference", "CLASSIC_DIFFERENCE"], ["exclusion", "EXCLUSION"], ["subtract", "SUBTRACT"], ["divide", "DIVIDE"],
        ["hue", "HUE"], ["saturation", "SATURATION"], ["color", "COLOR"], ["luminosity", "LUMINOSITY"],
        ["stencil-alpha", "STENCIL_ALPHA"], ["stencil-luma", "STENCIL_LUMA"], ["silhouette-alpha", "SILHOUETE_ALPHA"], ["silhouette-luma", "SILHOUETE_LUMA"],
        ["alpha-add", "ALPHA_ADD"], ["luminescent-premul", "LUMINESCENT_PREMUL"]
    ];
    var table = { byName: {}, byValue: {} };
    for (var i = 0; i < pairs.length; i++) {
        var val = _mcpTry(function () { return BlendingMode[pairs[i][1]]; }, undefined);
        if (val === undefined) { continue; }
        table.byName[pairs[i][0]] = val;
        table.byValue[String(val)] = pairs[i][0];
    }
    MCP.enums._blend = table;
    return table;
};

MCP.enums.blendModeName = function (value) {
    var t = MCP.enums.blendModes();
    return t.byValue[String(value)] || String(value);
};

MCP.enums.blendModeValue = function (name) {
    var t = MCP.enums.blendModes();
    var key = String(name).toLowerCase().replace(/[\s_]+/g, "-");
    if (!MCP.isDefined(t.byName[key])) {
        MCP.fail("Unknown blend mode '" + name + "'. Use one of: " + MCP.keys(t.byName).join(", "), "invalid-argument");
    }
    return t.byName[key];
};

MCP.enums.LABELS = ["none", "red", "yellow", "aqua", "pink", "lavender", "peach", "sea-foam", "blue", "green", "purple", "orange", "brown", "fuchsia", "cyan", "sandstone", "dark-green"];

MCP.enums.labelIndex = function (label) {
    if (typeof label === "number") { return MCP.clamp(Math.round(label), 0, 16); }
    var key = String(label).toLowerCase().replace(/[\s_]+/g, "-");
    var idx = MCP.enums.LABELS.indexOf(key);
    if (idx < 0) { MCP.fail("Unknown label colour '" + label + "'. Use 0-16 or one of: " + MCP.enums.LABELS.join(", "), "invalid-argument"); }
    return idx;
};

MCP.enums.trackMatteName = function (value) {
    var names = { "NO_TRACK_MATTE": "none", "ALPHA": "alpha", "ALPHA_INVERTED": "alpha-inverted", "LUMA": "luma", "LUMA_INVERTED": "luma-inverted" };
    for (var k in names) {
        if (Object.prototype.hasOwnProperty.call(names, k)) {
            var v = _mcpTry(function () { return TrackMatteType[k]; }, undefined);
            if (v !== undefined && v === value) { return names[k]; }
        }
    }
    return "none";
};

MCP.enums.trackMatteValue = function (name) {
    var map = { "none": "NO_TRACK_MATTE", "alpha": "ALPHA", "alpha-inverted": "ALPHA_INVERTED", "luma": "LUMA", "luma-inverted": "LUMA_INVERTED" };
    var key = String(name).toLowerCase().replace(/[\s_]+/g, "-");
    if (!map[key]) { MCP.fail("Unknown track matte type '" + name + "'. Use none, alpha, alpha-inverted, luma or luma-inverted.", "invalid-argument"); }
    return TrackMatteType[map[key]];
};

MCP.enums.interpolationName = function (value) {
    if (value === KeyframeInterpolationType.LINEAR) { return "linear"; }
    if (value === KeyframeInterpolationType.BEZIER) { return "bezier"; }
    if (value === KeyframeInterpolationType.HOLD) { return "hold"; }
    return String(value);
};

MCP.enums.interpolationValue = function (name) {
    var key = String(name).toLowerCase();
    if (key === "linear") { return KeyframeInterpolationType.LINEAR; }
    if (key === "bezier") { return KeyframeInterpolationType.BEZIER; }
    if (key === "hold") { return KeyframeInterpolationType.HOLD; }
    MCP.fail("Unknown interpolation '" + name + "'. Use linear, bezier or hold.", "invalid-argument");
    return null;
};

/* ------------------------------------------------------------- layer type */

MCP.layerType = function (layer) {
    if (layer instanceof TextLayer) { return "text"; }
    if (layer instanceof ShapeLayer) { return "shape"; }
    if (layer instanceof CameraLayer) { return "camera"; }
    if (layer instanceof LightLayer) { return "light"; }
    if (layer instanceof AVLayer) {
        if (_mcpTry(function () { return layer.nullLayer; }, false)) { return "null"; }
        if (_mcpTry(function () { return layer.adjustmentLayer; }, false)) { return "adjustment"; }
        var src = _mcpTry(function () { return layer.source; }, null);
        if (src instanceof CompItem) { return "precomp"; }
        if (src instanceof FootageItem) {
            if (src.mainSource instanceof SolidSource) { return "solid"; }
            if (src.mainSource instanceof PlaceholderSource) { return "placeholder"; }
            if (_mcpTry(function () { return src.hasVideo; }, true) === false && _mcpTry(function () { return src.hasAudio; }, false)) { return "audio"; }
            return "footage";
        }
        return "av";
    }
    return "unknown";
};

MCP.itemType = function (item) {
    if (item instanceof CompItem) { return "comp"; }
    if (item instanceof FolderItem) { return "folder"; }
    if (item instanceof FootageItem) {
        if (item.mainSource instanceof SolidSource) { return "solid"; }
        if (item.mainSource instanceof PlaceholderSource) { return "placeholder"; }
        return "footage";
    }
    return "unknown";
};

/* ------------------------------------------------------------- summaries */

MCP.serialize.item = function (item) {
    var out = {
        id: item.id,
        name: item.name,
        type: MCP.itemType(item),
        parentFolder: _mcpTry(function () { return item.parentFolder ? item.parentFolder.name : null; }, null),
        parentFolderId: _mcpTry(function () { return item.parentFolder ? item.parentFolder.id : null; }, null)
    };
    if (item instanceof CompItem) {
        out.width = item.width; out.height = item.height; out.duration = item.duration; out.frameRate = item.frameRate; out.numLayers = item.numLayers;
    } else if (item instanceof FootageItem) {
        out.width = _mcpTry(function () { return item.width; }, null);
        out.height = _mcpTry(function () { return item.height; }, null);
        out.duration = _mcpTry(function () { return item.duration; }, null);
        out.hasVideo = _mcpTry(function () { return item.hasVideo; }, null);
        out.hasAudio = _mcpTry(function () { return item.hasAudio; }, null);
        out.file = _mcpTry(function () { return item.file ? item.file.fsName : null; }, null);
        out.usedIn = _mcpTry(function () { return item.usedIn.length; }, null);
    }
    return out;
};

MCP.serialize.comp = function (comp) {
    return {
        id: comp.id,
        name: comp.name,
        width: comp.width,
        height: comp.height,
        pixelAspect: comp.pixelAspect,
        duration: comp.duration,
        frameRate: comp.frameRate,
        frameDuration: comp.frameDuration,
        durationFrames: MCP.frameOf(comp, comp.duration),
        numLayers: comp.numLayers,
        bgColor: MCP.color.toHex(comp.bgColor),
        time: comp.time,
        frame: MCP.frameOf(comp, comp.time),
        workAreaStart: comp.workAreaStart,
        workAreaDuration: comp.workAreaDuration,
        motionBlur: _mcpTry(function () { return comp.motionBlur; }, null),
        shutterAngle: _mcpTry(function () { return comp.shutterAngle; }, null),
        shutterPhase: _mcpTry(function () { return comp.shutterPhase; }, null),
        motionBlurSamplesPerFrame: _mcpTry(function () { return comp.motionBlurSamplesPerFrame; }, null),
        resolutionFactor: _mcpTry(function () { return comp.resolutionFactor; }, null),
        displayStartTime: _mcpTry(function () { return comp.displayStartTime; }, null),
        hideShyLayers: _mcpTry(function () { return comp.hideShyLayers; }, null),
        parentFolder: _mcpTry(function () { return comp.parentFolder ? comp.parentFolder.name : null; }, null)
    };
};

MCP.serialize.layer = function (layer, opts) {
    var comp = layer.containingComp;
    var out = {
        index: layer.index,
        id: _mcpTry(function () { return layer.id; }, null),
        name: layer.name,
        type: MCP.layerType(layer),
        enabled: layer.enabled,
        locked: layer.locked,
        shy: layer.shy,
        solo: layer.solo,
        inPoint: MCP.round(layer.inPoint),
        outPoint: MCP.round(layer.outPoint),
        startTime: MCP.round(layer.startTime),
        inFrame: MCP.frameOf(comp, layer.inPoint),
        outFrame: MCP.frameOf(comp, layer.outPoint),
        durationFrames: MCP.frameOf(comp, layer.outPoint - layer.inPoint),
        stretch: _mcpTry(function () { return layer.stretch; }, null),
        parent: layer.parent ? { index: layer.parent.index, name: layer.parent.name } : null,
        label: _mcpTry(function () { return MCP.enums.LABELS[layer.label] || layer.label; }, null),
        comment: _mcpTry(function () { return layer.comment; }, ""),
        hasVideo: _mcpTry(function () { return layer.hasVideo; }, null),
        hasAudio: _mcpTry(function () { return layer.hasAudio; }, null),
        isNull: _mcpTry(function () { return !!layer.nullLayer; }, false),
        isGuide: _mcpTry(function () { return !!layer.guideLayer; }, false),
        threeD: _mcpTry(function () { return !!layer.threeDLayer; }, false),
        adjustment: _mcpTry(function () { return !!layer.adjustmentLayer; }, false),
        blendMode: _mcpTry(function () { return MCP.enums.blendModeName(layer.blendingMode); }, null),
        trackMatte: _mcpTry(function () { return MCP.enums.trackMatteName(layer.trackMatteType); }, null),
        trackMatteLayer: _mcpTry(function () { return layer.trackMatteLayer ? { index: layer.trackMatteLayer.index, name: layer.trackMatteLayer.name } : null; }, null),
        motionBlur: _mcpTry(function () { return !!layer.motionBlur; }, null),
        collapseTransformation: _mcpTry(function () { return !!layer.collapseTransformation; }, null),
        source: _mcpTry(function () { return layer.source ? { id: layer.source.id, name: layer.source.name, type: MCP.itemType(layer.source) } : null; }, null)
    };
    var fx = _mcpTry(function () { return layer.property("ADBE Effect Parade"); }, null);
    var fxNames = [];
    if (fx) {
        for (var i = 1; i <= fx.numProperties; i++) { fxNames.push(fx.property(i).name); }
    }
    out.effects = fxNames;
    out.hasEffects = fxNames.length > 0;
    out.hasExpressions = MCP.serialize.hasExpressions(layer, 0);
    var tg = _mcpTry(function () { return layer.property("ADBE Transform Group"); }, null);
    if (tg) {
        out.transform = {
            position: MCP.roundValue(_mcpTry(function () { return tg.property("ADBE Position").value; }, null)),
            anchorPoint: MCP.roundValue(_mcpTry(function () { return tg.property("ADBE Anchor Point").value; }, null)),
            scale: MCP.roundValue(_mcpTry(function () { return tg.property("ADBE Scale").value; }, null)),
            rotation: MCP.roundValue(_mcpTry(function () { return tg.property("ADBE Rotate Z").value; }, null)),
            opacity: MCP.roundValue(_mcpTry(function () { return tg.property("ADBE Opacity").value; }, null))
        };
    }
    if (layer instanceof TextLayer) {
        out.text = _mcpTry(function () { return layer.property("ADBE Text Properties").property("ADBE Text Document").value.text; }, null);
    }
    if (opts && opts.keyframes) {
        out.keyframedProperties = MCP.serialize.keyframedPaths(layer);
    }
    return out;
};

/** Shallow scan for expressions on Transform, Effects and Text (depth-limited). */
MCP.serialize.hasExpressions = function (root, depth) {
    var n = 0;
    try { n = root.numProperties; } catch (e) { return false; }
    if (depth > 4) { return false; }
    for (var i = 1; i <= n; i++) {
        var p = null;
        try { p = root.property(i); } catch (e2) { continue; }
        if (!p) { continue; }
        if (MCP.isGroup(p)) {
            if (MCP.serialize.hasExpressions(p, depth + 1)) { return true; }
        } else if (_mcpTry(function () { return p.canSetExpression && p.expression !== ""; }, false)) {
            return true;
        }
    }
    return false;
};

MCP.serialize.keyframedPaths = function (root) {
    var found = [];
    function walk(g, depth) {
        var n = 0;
        try { n = g.numProperties; } catch (e) { return; }
        if (depth > 6) { return; }
        for (var i = 1; i <= n; i++) {
            var p = null;
            try { p = g.property(i); } catch (e2) { continue; }
            if (!p) { continue; }
            if (MCP.isGroup(p)) { walk(p, depth + 1); }
            else if (_mcpTry(function () { return p.numKeys > 0; }, false)) {
                found.push({ path: MCP.pathOf(p).path, numKeys: p.numKeys });
            }
        }
    }
    walk(root, 0);
    return found;
};

MCP.serialize.value = function (prop) {
    if (!prop || MCP.isGroup(prop)) { return null; }
    var v = null;
    try { v = prop.value; } catch (e) { return null; }
    return MCP.serialize.rawValue(v);
};

MCP.serialize.rawValue = function (v) {
    if (v === null || v === undefined) { return null; }
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") { return MCP.roundValue(v); }
    if (MCP.isArray(v)) { return MCP.roundValue(v); }
    if (typeof TextDocument !== "undefined" && v instanceof TextDocument) { return MCP.serialize.textDocument(v); }
    if (typeof Shape !== "undefined" && v instanceof Shape) {
        return { vertices: MCP.roundValue(v.vertices), inTangents: MCP.roundValue(v.inTangents), outTangents: MCP.roundValue(v.outTangents), closed: v.closed };
    }
    if (typeof MarkerValue !== "undefined" && v instanceof MarkerValue) { return MCP.serialize.marker(v); }
    return String(v);
};

MCP.serialize.textDocument = function (td) {
    return {
        text: td.text,
        font: _mcpTry(function () { return td.font; }, null),
        fontFamily: _mcpTry(function () { return td.fontFamily; }, null),
        fontStyle: _mcpTry(function () { return td.fontStyle; }, null),
        fontSize: _mcpTry(function () { return td.fontSize; }, null),
        fillColor: _mcpTry(function () { return td.applyFill ? MCP.color.toHex(td.fillColor) : null; }, null),
        strokeColor: _mcpTry(function () { return td.applyStroke ? MCP.color.toHex(td.strokeColor) : null; }, null),
        strokeWidth: _mcpTry(function () { return td.applyStroke ? td.strokeWidth : 0; }, null),
        tracking: _mcpTry(function () { return td.tracking; }, null),
        leading: _mcpTry(function () { return td.leading; }, null),
        justification: _mcpTry(function () { return MCP.serialize.justificationName(td.justification); }, null),
        boxText: _mcpTry(function () { return td.boxText; }, null),
        boxTextSize: _mcpTry(function () { return td.boxText ? td.boxTextSize : null; }, null),
        allCaps: _mcpTry(function () { return td.allCaps; }, null),
        smallCaps: _mcpTry(function () { return td.smallCaps; }, null),
        fauxBold: _mcpTry(function () { return td.fauxBold; }, null),
        fauxItalic: _mcpTry(function () { return td.fauxItalic; }, null),
        baselineShift: _mcpTry(function () { return td.baselineShift; }, null),
        verticalScale: _mcpTry(function () { return td.verticalScale; }, null),
        horizontalScale: _mcpTry(function () { return td.horizontalScale; }, null),
        tsume: _mcpTry(function () { return td.tsume; }, null)
    };
};

MCP.serialize.justificationName = function (j) {
    var names = ["LEFT_JUSTIFY", "RIGHT_JUSTIFY", "CENTER_JUSTIFY", "FULL_JUSTIFY_LASTLINE_LEFT", "FULL_JUSTIFY_LASTLINE_RIGHT", "FULL_JUSTIFY_LASTLINE_CENTER", "FULL_JUSTIFY_LASTLINE_FULL"];
    var labels = ["left", "right", "center", "justify-left", "justify-right", "justify-center", "justify-full"];
    for (var i = 0; i < names.length; i++) {
        var v = _mcpTry(function () { return ParagraphJustification[names[i]]; }, undefined);
        if (v !== undefined && v === j) { return labels[i]; }
    }
    return String(j);
};

MCP.serialize.marker = function (mv) {
    return {
        comment: mv.comment,
        duration: mv.duration,
        chapter: _mcpTry(function () { return mv.chapter; }, ""),
        url: _mcpTry(function () { return mv.url; }, ""),
        label: _mcpTry(function () { return mv.label; }, 0),
        cuePointName: _mcpTry(function () { return mv.cuePointName; }, ""),
        protectedRegion: _mcpTry(function () { return mv.protectedRegion; }, false)
    };
};

MCP.serialize.property = function (prop, opts) {
    var o = opts || {};
    var paths = MCP.pathOf(prop);
    var out = {
        name: prop.name,
        matchName: prop.matchName,
        path: paths.path,
        matchPath: paths.matchPath,
        index: _mcpTry(function () { return prop.propertyIndex; }, null),
        isGroup: MCP.isGroup(prop)
    };
    if (out.isGroup) {
        out.numProperties = _mcpTry(function () { return prop.numProperties; }, 0);
        if (o.children) {
            out.children = [];
            var depth = o.depth === undefined ? 1 : o.depth;
            if (depth > 0) {
                for (var i = 1; i <= prop.numProperties; i++) {
                    out.children.push(MCP.serialize.property(prop.property(i), { children: true, depth: depth - 1, values: o.values }));
                }
            }
        }
        return out;
    }
    out.value = MCP.serialize.value(prop);
    out.valueType = MCP.serialize.valueTypeName(prop);
    out.dimensions = _mcpTry(function () { var v = prop.value; return MCP.isArray(v) ? v.length : 1; }, 1);
    out.canVaryOverTime = _mcpTry(function () { return !!prop.canVaryOverTime; }, false);
    out.isSpatial = _mcpTry(function () { return !!prop.isSpatial; }, false);
    out.numKeys = _mcpTry(function () { return prop.numKeys; }, 0);
    out.hasExpression = _mcpTry(function () { return prop.canSetExpression && prop.expression !== ""; }, false);
    if (out.hasExpression) {
        out.expression = prop.expression;
        out.expressionEnabled = _mcpTry(function () { return prop.expressionEnabled; }, null);
        out.expressionError = _mcpTry(function () { return prop.expressionError || ""; }, "");
    }
    if (_mcpTry(function () { return prop.hasMin; }, false)) { out.min = prop.minValue; }
    if (_mcpTry(function () { return prop.hasMax; }, false)) { out.max = prop.maxValue; }
    if (o.keyframes && out.numKeys > 0) {
        out.keyframes = [];
        for (var k = 1; k <= prop.numKeys; k++) { out.keyframes.push(MCP.serialize.keyframe(prop, k)); }
    }
    return out;
};

MCP.serialize.valueTypeName = function (prop) {
    var t = _mcpTry(function () { return prop.propertyValueType; }, null);
    if (t === null) { return "unknown"; }
    var names = ["NO_VALUE", "ThreeD_SPATIAL", "ThreeD", "TwoD_SPATIAL", "TwoD", "OneD", "COLOR", "CUSTOM_VALUE", "MARKER", "LAYER_INDEX", "MASK_INDEX", "SHAPE", "TEXT_DOCUMENT"];
    var labels = ["none", "3d-spatial", "3d", "2d-spatial", "2d", "1d", "color", "custom", "marker", "layer-index", "mask-index", "shape", "text-document"];
    for (var i = 0; i < names.length; i++) {
        var v = _mcpTry(function () { return PropertyValueType[names[i]]; }, undefined);
        if (v !== undefined && v === t) { return labels[i]; }
    }
    return String(t);
};

MCP.serialize.ease = function (arr) {
    var out = [];
    if (!arr) { return out; }
    for (var i = 0; i < arr.length; i++) {
        out.push({ speed: MCP.round(arr[i].speed), influence: MCP.round(arr[i].influence, 2) });
    }
    return out;
};

MCP.serialize.keyframe = function (prop, i) {
    var comp = null;
    try { comp = prop.propertyGroup(prop.propertyDepth).containingComp; } catch (e) { comp = MCP.activeComp(); }
    var t = prop.keyTime(i);
    var out = {
        index: i,
        time: MCP.round(t),
        frame: comp ? MCP.frameOf(comp, t) : null,
        value: MCP.serialize.rawValue(prop.keyValue(i)),
        inInterpolation: _mcpTry(function () { return MCP.enums.interpolationName(prop.keyInInterpolationType(i)); }, null),
        outInterpolation: _mcpTry(function () { return MCP.enums.interpolationName(prop.keyOutInterpolationType(i)); }, null),
        easeIn: _mcpTry(function () { return MCP.serialize.ease(prop.keyInTemporalEase(i)); }, []),
        easeOut: _mcpTry(function () { return MCP.serialize.ease(prop.keyOutTemporalEase(i)); }, []),
        temporalContinuous: _mcpTry(function () { return prop.keyTemporalContinuous(i); }, null),
        temporalAutoBezier: _mcpTry(function () { return prop.keyTemporalAutoBezier(i); }, null),
        selected: _mcpTry(function () { return prop.keySelected(i); }, null)
    };
    if (_mcpTry(function () { return prop.isSpatial; }, false)) {
        out.roving = _mcpTry(function () { return prop.keyRoving(i); }, null);
        out.spatial = {
            inTangent: MCP.roundValue(_mcpTry(function () { return prop.keyInSpatialTangent(i); }, null)),
            outTangent: MCP.roundValue(_mcpTry(function () { return prop.keyOutSpatialTangent(i); }, null)),
            continuous: _mcpTry(function () { return prop.keySpatialContinuous(i); }, null),
            autoBezier: _mcpTry(function () { return prop.keySpatialAutoBezier(i); }, null)
        };
    }
    return out;
};

MCP.serialize.effect = function (fx, opts) {
    var out = {
        index: fx.propertyIndex,
        name: fx.name,
        matchName: fx.matchName,
        enabled: fx.enabled,
        numProperties: fx.numProperties
    };
    if (opts && opts.properties) {
        out.properties = [];
        for (var i = 1; i <= fx.numProperties; i++) {
            out.properties.push(MCP.serialize.property(fx.property(i), { children: true, depth: (opts.depth === undefined ? 2 : opts.depth), values: true }));
        }
    }
    return out;
};

/** Standard return shape for a mutated property. */
MCP.serialize.propertyResult = function (layer, prop, extra) {
    var out = {
        composition: MCP.serialize.compRef(layer.containingComp),
        layer: MCP.serialize.layerRef(layer),
        property: MCP.serialize.property(prop, { keyframes: false })
    };
    if (extra) { MCP.extend(out, extra); }
    return out;
};

MCP.serialize.compRef = function (comp) {
    return { id: comp.id, name: comp.name };
};

MCP.serialize.layerRef = function (layer) {
    return { index: layer.index, id: _mcpTry(function () { return layer.id; }, null), name: layer.name };
};
