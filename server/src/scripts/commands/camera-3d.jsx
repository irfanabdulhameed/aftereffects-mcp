/*
 * Camera, light and 3D layer commands.
 *
 * Camera options live under "ADBE Camera Options Group", light options under
 * "ADBE Light Options Group", material options under
 * "ADBE Material Options Group". Every setter looks a property up by
 * matchName first and by display name second, so a renamed or localised
 * property still resolves when the matchName differs between versions.
 */

MCP.cam = {};

MCP.cam.IRIS_SHAPES = ["fast-rectangle", "triangle", "square", "pentagon", "hexagon", "heptagon", "octagon", "nonagon", "decagon"];

MCP.cam.CAMERA_PROPS = [
    { arg: "zoom", match: "ADBE Camera Zoom", name: "Zoom" },
    { arg: "depthOfField", match: "ADBE Camera Depth of Field", name: "Depth of Field", kind: "bool" },
    { arg: "focusDistance", match: "ADBE Camera Focus Distance", name: "Focus Distance" },
    { arg: "aperture", match: "ADBE Camera Aperture", name: "Aperture" },
    { arg: "blurLevel", match: "ADBE Camera Blur Level", name: "Blur Level" },
    { arg: "irisShape", match: "ADBE Iris Shape", name: "Iris Shape", kind: "iris" },
    { arg: "irisRotation", match: "ADBE Iris Rotation", name: "Iris Rotation" },
    { arg: "irisRoundness", match: "ADBE Iris Roundness", name: "Iris Roundness" },
    { arg: "irisAspectRatio", match: "ADBE Iris Aspect Ratio", name: "Iris Aspect Ratio" },
    { arg: "irisDiffractionFringe", match: "ADBE Iris Diffraction Fringe", name: "Iris Diffraction Fringe" },
    { arg: "highlightGain", match: "ADBE Iris Highlight Gain", name: "Highlight Gain" },
    { arg: "highlightThreshold", match: "ADBE Iris Highlight Threshold", name: "Highlight Threshold" },
    { arg: "highlightSaturation", match: "ADBE Iris Hightlight Saturation", name: "Highlight Saturation" }
];

MCP.cam.LIGHT_PROPS = [
    { arg: "intensity", match: "ADBE Light Intensity", name: "Intensity" },
    { arg: "color", match: "ADBE Light Color", name: "Color", kind: "color" },
    { arg: "coneAngle", match: "ADBE Light Cone Angle", name: "Cone Angle" },
    { arg: "coneFeather", match: "ADBE Light Cone Feather 2", name: "Cone Feather" },
    { arg: "falloff", match: "ADBE Light Falloff Type", name: "Falloff", kind: "falloff" },
    { arg: "radius", match: "ADBE Light Falloff Start", name: "Radius" },
    { arg: "falloffDistance", match: "ADBE Light Falloff Distance", name: "Falloff Distance" },
    { arg: "castsShadows", match: "ADBE Casts Shadows", name: "Casts Shadows", kind: "bool" },
    { arg: "shadowDarkness", match: "ADBE Light Shadow Darkness", name: "Shadow Darkness" },
    { arg: "shadowDiffusion", match: "ADBE Light Shadow Diffusion", name: "Shadow Diffusion" }
];

MCP.cam.MATERIAL_PROPS = [
    { arg: "castsShadows", match: "ADBE Casts Shadows", name: "Casts Shadows", kind: "tri" },
    { arg: "lightTransmission", match: "ADBE Light Transmission", name: "Light Transmission" },
    { arg: "acceptsShadows", match: "ADBE Accepts Shadows", name: "Accepts Shadows", kind: "tri" },
    { arg: "acceptsLights", match: "ADBE Accepts Lights", name: "Accepts Lights", kind: "bool" },
    { arg: "appearsInReflections", match: "ADBE Appears in Reflections", name: "Appears in Reflections", kind: "tri" },
    { arg: "ambient", match: "ADBE Ambient Coefficient", name: "Ambient" },
    { arg: "diffuse", match: "ADBE Diffuse Coefficient", name: "Diffuse" },
    { arg: "specularIntensity", match: "ADBE Specular Coefficient", name: "Specular Intensity" },
    { arg: "specularShininess", match: "ADBE Shininess Coefficient", name: "Specular Shininess" },
    { arg: "metal", match: "ADBE Metal Coefficient", name: "Metal" }
];

MCP.cam.requireCamera = function (layer) {
    if (!(layer instanceof CameraLayer)) {
        MCP.fail("Layer '" + layer.name + "' is not a camera (it is a " + MCP.layerType(layer) + " layer). Use create-camera-layer first, or pick a layer of type \"camera\" from list-layers.", "invalid-argument");
    }
    return layer;
};

MCP.cam.requireLight = function (layer) {
    if (!(layer instanceof LightLayer)) {
        MCP.fail("Layer '" + layer.name + "' is not a light (it is a " + MCP.layerType(layer) + " layer). Use create-light-layer first, or pick a layer of type \"light\" from list-layers.", "invalid-argument");
    }
    return layer;
};

MCP.cam.group = function (layer, matchName, label) {
    var g = _mcpTry(function () { return layer.property(matchName); }, null);
    if (!g) { MCP.fail("Layer '" + layer.name + "' has no " + label + " group.", "unsupported"); }
    return g;
};

/** Property inside a group: matchName first, then display name (searched recursively). */
MCP.cam.prop = function (group, matchName, displayName) {
    var p = MCP.childProp(group, matchName);
    if (!p && displayName) { p = MCP.findProp(group, displayName); }
    return p;
};

/** A three component position from any value. */
MCP.cam.vec3 = function (v) {
    if (!MCP.isArray(v)) { return [0, 0, 0]; }
    return [Number(v[0]) || 0, Number(v[1]) || 0, v.length > 2 ? (Number(v[2]) || 0) : 0];
};

MCP.cam.sub = function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; };
MCP.cam.add = function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; };
MCP.cam.scale = function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; };
MCP.cam.length = function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); };
MCP.cam.normalize = function (a) {
    var len = MCP.cam.length(a);
    if (len < 1e-9) { return [0, 0, 1]; }
    return MCP.cam.scale(a, 1 / len);
};

MCP.cam.transformGroup = function (layer) {
    return MCP.cam.group(layer, "ADBE Transform Group", "Transform");
};

MCP.cam.positionProp = function (layer) {
    var p = MCP.cam.prop(MCP.cam.transformGroup(layer), "ADBE Position", "Position");
    if (!p) { MCP.fail("Layer '" + layer.name + "' has no Position property.", "not-found"); }
    return p;
};

/** True for two-node cameras and lights (they aim at a point of interest). */
MCP.cam.isTwoNode = function (layer) {
    if (!(layer instanceof CameraLayer) && !(layer instanceof LightLayer)) { return false; }
    return _mcpTry(function () { return layer.autoOrient === AutoOrientType.CAMERA_OR_POINT_OF_INTEREST; }, false);
};

/** Point of Interest property (its matchName is "ADBE Anchor Point" on cameras and lights). */
MCP.cam.poiProp = function (layer) {
    if (!(layer instanceof CameraLayer) && !(layer instanceof LightLayer)) { return null; }
    var tg = MCP.cam.transformGroup(layer);
    var p = MCP.childProp(tg, "Point of Interest");
    if (!p) { p = MCP.childProp(tg, "ADBE Anchor Point"); }
    return p || null;
};

MCP.cam.positionAt = function (layer, t) {
    var p = MCP.cam.positionProp(layer);
    return MCP.cam.vec3(_mcpTry(function () { return p.valueAtTime(t, false); }, p.value));
};

MCP.cam.poiAt = function (layer, t) {
    var p = MCP.cam.poiProp(layer);
    if (!p) { return null; }
    return MCP.cam.vec3(_mcpTry(function () { return p.valueAtTime(t, false); }, p.value));
};

/** Unit vector the camera looks along at time t. One-node cameras look down +Z (approximation that ignores rotation). */
MCP.cam.viewAxis = function (layer, t) {
    if (MCP.cam.isTwoNode(layer)) {
        var poi = MCP.cam.poiAt(layer, t);
        var pos = MCP.cam.positionAt(layer, t);
        if (poi) { return MCP.cam.normalize(MCP.cam.sub(poi, pos)); }
    }
    return [0, 0, 1];
};

MCP.cam.irisValue = function (raw) {
    if (typeof raw === "number") { return MCP.clamp(Math.round(raw), 1, 10); }
    var key = String(raw).toLowerCase().replace(/[\s_]+/g, "-");
    var idx = MCP.cam.IRIS_SHAPES.indexOf(key);
    if (idx < 0) {
        if (/^\d+$/.test(key)) { return MCP.clamp(parseInt(key, 10), 1, 10); }
        MCP.fail("Unknown iris shape '" + raw + "'. Use an index 1 to 10 or one of: " + MCP.cam.IRIS_SHAPES.join(", "), "invalid-argument");
    }
    return idx + 1;
};

MCP.cam.falloffValue = function (raw) {
    if (typeof raw === "number") { return MCP.clamp(Math.round(raw), 1, 3); }
    var key = String(raw).toLowerCase().replace(/[\s_]+/g, "-");
    var map = { "none": 1, "smooth": 2, "inverse-square": 3, "inverse-square-clamped": 3 };
    if (!map[key]) { MCP.fail("Unknown falloff '" + raw + "'. Use none, smooth, inverse-square (or 1, 2, 3).", "invalid-argument"); }
    return map[key];
};

/** off/on/only (or false/true/2) -> 0/1/2 for three-state material switches. */
MCP.cam.triValue = function (raw) {
    if (typeof raw === "boolean") { return raw ? 1 : 0; }
    if (typeof raw === "number") { return MCP.clamp(Math.round(raw), 0, 2); }
    var key = String(raw).toLowerCase();
    if (key === "off" || key === "false" || key === "0") { return 0; }
    if (key === "on" || key === "true" || key === "1") { return 1; }
    if (key === "only" || key === "2") { return 2; }
    MCP.fail("Expected off, on or only (or a boolean); got '" + raw + "'.", "invalid-argument");
    return 0;
};

MCP.cam.convertValue = function (spec, raw) {
    if (spec.kind === "bool") { return MCP.bool(raw, false) ? 1 : 0; }
    if (spec.kind === "tri") { return MCP.cam.triValue(raw); }
    if (spec.kind === "iris") { return MCP.cam.irisValue(raw); }
    if (spec.kind === "falloff") { return MCP.cam.falloffValue(raw); }
    if (spec.kind === "color") { return MCP.color.rgba(raw); }
    return Number(raw);
};

/**
 * Applies every arg listed in table to the matching property in group.
 * With time or frame in args the value is keyframed (and eased); otherwise it
 * is set statically. Returns { applied: [...], notes: [...] }.
 */
MCP.cam.applyTable = function (comp, layer, group, table, args) {
    var applied = [], notes = [];
    var keyed = MCP.isDefined(args.time) || MCP.isDefined(args.frame);
    var t = keyed ? MCP.timeArg(comp, args) : null;
    for (var i = 0; i < table.length; i++) {
        var spec = table[i];
        if (!MCP.isDefined(args[spec.arg])) { continue; }
        var p = MCP.cam.prop(group, spec.match, spec.name);
        if (!p) { notes.push("Property '" + spec.name + "' (" + spec.match + ") is not available on layer '" + layer.name + "' in this renderer or version; skipped."); continue; }
        var value = MCP.cam.convertValue(spec, args[spec.arg]);
        var keyIndex = null;
        try {
            if (keyed && _mcpTry(function () { return p.canVaryOverTime; }, false)) {
                keyIndex = MCP.easing.setKey(p, t, value);
                if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(p, keyIndex, args.easing); }
            } else {
                if (p.numKeys > 0) { keyIndex = MCP.easing.setKey(p, comp.time, value); }
                else { p.setValue(value); }
            }
            applied.push({ arg: spec.arg, property: MCP.pathOf(p).path, matchName: p.matchName, value: MCP.serialize.rawValue(value), keyIndex: keyIndex });
        } catch (e) {
            notes.push("Could not set '" + spec.name + "' on layer '" + layer.name + "': " + e.toString());
        }
    }
    return { applied: applied, notes: notes };
};

/** Current values of every property in a table, keyed by arg name. */
MCP.cam.readTable = function (group, table) {
    var out = {};
    for (var i = 0; i < table.length; i++) {
        var spec = table[i];
        var p = MCP.cam.prop(group, spec.match, spec.name);
        if (!p) { continue; }
        var v = MCP.serialize.value(p);
        if (spec.kind === "bool") { v = !!v; }
        else if (spec.kind === "iris" && typeof v === "number") { v = MCP.cam.IRIS_SHAPES[v - 1] || v; }
        else if (spec.kind === "falloff" && typeof v === "number") { v = ["none", "smooth", "inverse-square"][v - 1] || v; }
        else if (spec.kind === "tri" && typeof v === "number") { v = ["off", "on", "only"][v] || v; }
        else if (spec.kind === "color" && MCP.isArray(v)) { v = MCP.color.toHex(v); }
        out[spec.arg] = v;
    }
    return out;
};

MCP.cam.cameraSummary = function (layer) {
    var comp = layer.containingComp;
    var g = MCP.cam.group(layer, "ADBE Camera Options Group", "Camera Options");
    var opts = MCP.cam.readTable(g, MCP.cam.CAMERA_PROPS);
    var zoom = typeof opts.zoom === "number" ? opts.zoom : null;
    var out = {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(layer),
        twoNode: MCP.cam.isTwoNode(layer),
        position: MCP.roundValue(MCP.cam.positionAt(layer, comp.time)),
        pointOfInterest: MCP.cam.isTwoNode(layer) ? MCP.roundValue(MCP.cam.poiAt(layer, comp.time)) : null,
        cameraOptions: opts,
        focalLengthMm: zoom !== null && comp.width ? MCP.round(zoom * 36 / comp.width, 2) : null,
        keyframedProperties: MCP.serialize.keyframedPaths(layer)
    };
    return out;
};

MCP.cam.lightSummary = function (layer) {
    var comp = layer.containingComp;
    var g = MCP.cam.group(layer, "ADBE Light Options Group", "Light Options");
    var typeName = _mcpTry(function () {
        var lt = layer.lightType;
        if (lt === LightType.PARALLEL) { return "parallel"; }
        if (lt === LightType.SPOT) { return "spot"; }
        if (lt === LightType.POINT) { return "point"; }
        if (lt === LightType.AMBIENT) { return "ambient"; }
        return String(lt);
    }, null);
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layer(layer),
        lightType: typeName,
        twoNode: MCP.cam.isTwoNode(layer),
        position: MCP.roundValue(MCP.cam.positionAt(layer, comp.time)),
        pointOfInterest: MCP.cam.isTwoNode(layer) ? MCP.roundValue(MCP.cam.poiAt(layer, comp.time)) : null,
        lightOptions: MCP.cam.readTable(g, MCP.cam.LIGHT_PROPS),
        keyframedProperties: MCP.serialize.keyframedPaths(layer)
    };
};

MCP.cam.lightTypeValue = function (name) {
    var key = String(name).toLowerCase();
    var map = { "parallel": "PARALLEL", "spot": "SPOT", "point": "POINT", "ambient": "AMBIENT" };
    if (!map[key]) { MCP.fail("Unknown light type '" + name + "'. Use parallel, spot, point or ambient.", "invalid-argument"); }
    return LightType[map[key]];
};

MCP.cam.autoOrientValue = function (name) {
    var key = String(name).toLowerCase().replace(/[\s_]+/g, "-");
    var map = { "none": "NO_AUTO_ORIENT", "along-path": "ALONG_PATH", "camera-or-poi": "CAMERA_OR_POINT_OF_INTEREST", "camera-or-point-of-interest": "CAMERA_OR_POINT_OF_INTEREST", "characters-toward-camera": "CHARACTERS_TOWARD_CAMERA" };
    if (!map[key]) { MCP.fail("Unknown autoOrient '" + name + "'. Use none, along-path or camera-or-poi.", "invalid-argument"); }
    var v = _mcpTry(function () { return AutoOrientType[map[key]]; }, undefined);
    if (v === undefined) { MCP.fail("Auto-orient mode '" + name + "' is not available in this After Effects version.", "unsupported"); }
    return v;
};

MCP.cam.autoOrientName = function (layer) {
    return _mcpTry(function () {
        var v = layer.autoOrient;
        if (v === AutoOrientType.NO_AUTO_ORIENT) { return "none"; }
        if (v === AutoOrientType.ALONG_PATH) { return "along-path"; }
        if (v === AutoOrientType.CAMERA_OR_POINT_OF_INTEREST) { return "camera-or-poi"; }
        if (v === AutoOrientType.CHARACTERS_TOWARD_CAMERA) { return "characters-toward-camera"; }
        return String(v);
    }, null);
};

/* -------------------------------------------------------------- commands */

MCP.register("setCameraSettings", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = MCP.cam.requireCamera(r.layer);
    var comp = r.comp;
    var g = MCP.cam.group(layer, "ADBE Camera Options Group", "Camera Options");
    var notes = [];
    var a = MCP.extend({}, args);
    if (MCP.isDefined(a.focalLength) && !MCP.isDefined(a.zoom)) {
        // Zoom in pixels for a 36 mm wide film back: zoom = compWidth * focalLength / 36. An approximation of the Camera Settings dialog.
        a.zoom = comp.width * Number(a.focalLength) / 36;
        notes.push("focalLength " + a.focalLength + " mm converted to zoom " + MCP.round(a.zoom, 2) + " px using a 36 mm film width.");
    }
    var res = MCP.cam.applyTable(comp, layer, g, MCP.cam.CAMERA_PROPS, a);
    var out = MCP.cam.cameraSummary(layer);
    out.applied = res.applied;
    out.notes = notes.concat(res.notes);
    return out;
}, { mutating: true });

/** Progress shaping for sampled (orbit) moves, so the sampled keys still ease. */
MCP.cam.progress = function (p, easing) {
    var e = typeof easing === "string" ? easing.toLowerCase() : "ease-in-out";
    if (e === "linear" || e === "hold") { return p; }
    if (e === "ease-in") { return p * p; }
    if (e === "ease-out") { return 1 - (1 - p) * (1 - p); }
    return p * p * (3 - 2 * p);
};

MCP.cam.writeTwoKeys = function (prop, t0, v0, t1, v1, easing) {
    var i0 = MCP.easing.setKey(prop, t0, v0);
    var i1 = MCP.easing.setKey(prop, t1, v1);
    MCP.easing.applySegment(prop, i1, MCP.isDefined(easing) ? easing : "ease-in-out");
    return [MCP.serialize.keyframe(prop, MCP.easing.keyIndexAtTime(prop, t0, 1e-3)), MCP.serialize.keyframe(prop, MCP.easing.keyIndexAtTime(prop, t1, 1e-3))];
};

MCP.register("animateCamera", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = MCP.cam.requireCamera(r.layer);
    var comp = r.comp;
    var fd = MCP.frameDuration(comp);
    var move = String(MCP.requireArg(args, "move")).toLowerCase();
    var t0 = MCP.timeArg(comp, { time: args.startTime, frame: args.startFrame }, comp.time);
    var dur = MCP.durationArg(comp, args, "duration", "durationFrames", 2);
    if (dur <= 0) { MCP.fail("duration must be greater than zero.", "invalid-argument"); }
    var t1 = t0 + dur;
    var easing = MCP.isDefined(args.easing) ? args.easing : "ease-in-out";
    var notes = [];
    var written = [];
    var twoNode = MCP.cam.isTwoNode(layer);
    var posProp = MCP.cam.positionProp(layer);
    var pos0 = MCP.cam.positionAt(layer, t0);
    var camGroup = MCP.cam.group(layer, "ADBE Camera Options Group", "Camera Options");

    if (move === "dolly" || move === "crane") {
        var amount = MCP.num(args.amount, null);
        if (amount === null) { MCP.fail(move + " needs amount: a distance in pixels (dolly along the view axis, crane along Y where positive is down).", "invalid-argument"); }
        var delta = move === "dolly" ? MCP.cam.scale(MCP.cam.viewAxis(layer, t0), amount) : [0, amount, 0];
        if (move === "dolly" && !twoNode) { notes.push("One-node camera: the view axis is approximated as +Z (rotation ignored)."); }
        written.push({ property: MCP.pathOf(posProp).path, keyframes: MCP.cam.writeTwoKeys(posProp, t0, pos0, t1, MCP.cam.add(pos0, delta), easing) });
    } else if (move === "push-in" || move === "pull-out") {
        var distance = MCP.num(args.distance, null);
        if (distance !== null) {
            var axis = MCP.cam.viewAxis(layer, t0);
            var d = move === "push-in" ? distance : -distance;
            written.push({ property: MCP.pathOf(posProp).path, keyframes: MCP.cam.writeTwoKeys(posProp, t0, pos0, t1, MCP.cam.add(pos0, MCP.cam.scale(axis, d)), easing) });
        } else {
            var factor = MCP.num(args.amount, 1.3);
            if (factor <= 0) { MCP.fail("amount for push-in and pull-out is a zoom factor and must be positive (default 1.3).", "invalid-argument"); }
            var zoomProp = MCP.cam.prop(camGroup, "ADBE Camera Zoom", "Zoom");
            if (!zoomProp) { MCP.fail("Zoom property not found on camera '" + layer.name + "'.", "not-found"); }
            var z0 = Number(_mcpTry(function () { return zoomProp.valueAtTime(t0, false); }, zoomProp.value));
            var z1 = move === "push-in" ? z0 * factor : z0 / factor;
            written.push({ property: MCP.pathOf(zoomProp).path, keyframes: MCP.cam.writeTwoKeys(zoomProp, t0, z0, t1, z1, easing) });
        }
    } else if (move === "orbit") {
        var angle = MCP.num(args.amount, null);
        if (angle === null) { MCP.fail("orbit needs amount: the angle in degrees to travel around the point of interest (positive is clockwise seen from above).", "invalid-argument"); }
        if (!twoNode) {
            var rotProp = MCP.cam.prop(MCP.cam.transformGroup(layer), "ADBE Rotate Y", "Y Rotation");
            if (!rotProp) { MCP.fail("Y Rotation property not found on camera '" + layer.name + "'.", "not-found"); }
            var ry0 = Number(_mcpTry(function () { return rotProp.valueAtTime(t0, false); }, rotProp.value));
            written.push({ property: MCP.pathOf(rotProp).path, keyframes: MCP.cam.writeTwoKeys(rotProp, t0, ry0, t1, ry0 + angle, easing) });
            notes.push("One-node camera: orbit is a Y Rotation change, the camera turns in place.");
        } else {
            var poi = MCP.cam.poiAt(layer, t0);
            var rel = MCP.cam.sub(pos0, poi);
            var radius = Math.sqrt(rel[0] * rel[0] + rel[2] * rel[2]);
            if (radius < 1e-6) { MCP.fail("The camera sits on its point of interest, so there is no orbit radius. Move the camera first.", "invalid-argument"); }
            var theta0 = Math.atan2(rel[0], rel[2]);
            var step = Math.max(1, Math.round(MCP.num(args.sampleFrames, 2)));
            var totalFrames = Math.max(1, Math.round(dur / fd));
            var times = [];
            for (var f = 0; f <= totalFrames; f += step) { times.push(f); }
            if (times[times.length - 1] !== totalFrames) { times.push(totalFrames); }
            var indices = [];
            for (var s = 0; s < times.length; s++) {
                var p = MCP.cam.progress(times[s] / totalFrames, easing);
                var theta = theta0 + angle * Math.PI / 180 * p;
                var pt = [poi[0] + radius * Math.sin(theta), rel[1] + poi[1], poi[2] + radius * Math.cos(theta)];
                var ki = MCP.easing.setKey(posProp, t0 + times[s] * fd, pt);
                indices.push(ki);
            }
            var keys = [];
            for (var q = 0; q < times.length; q++) {
                var idx = MCP.easing.keyIndexAtTime(posProp, t0 + times[q] * fd, 1e-3);
                if (idx > 0) {
                    try { posProp.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR); } catch (e) {}
                    keys.push(MCP.serialize.keyframe(posProp, idx));
                }
            }
            written.push({ property: MCP.pathOf(posProp).path, keyframes: keys });
            notes.push("Orbit sampled every " + step + " frame(s) with linear keys, easing applied to the sampling; the path is a circle in the XZ plane around the point of interest at radius " + MCP.round(radius, 2) + ".");
        }
    } else if (move === "rack-focus") {
        if (!MCP.isDefined(args.fromLayer) || !MCP.isDefined(args.toLayer)) { MCP.fail("rack-focus needs fromLayer and toLayer (layer references). Focus moves from the first to the second.", "invalid-argument"); }
        var la = MCP.resolveLayer(comp, args.fromLayer), lb = MCP.resolveLayer(comp, args.toLayer);
        var pa = MCP.cam.vec3(_mcpTry(function () { return la.property("ADBE Transform Group").property("ADBE Position").valueAtTime(t0, false); }, [0, 0, 0]));
        var pb = MCP.cam.vec3(_mcpTry(function () { return lb.property("ADBE Transform Group").property("ADBE Position").valueAtTime(t1, false); }, [0, 0, 0]));
        var cam0 = pos0, cam1 = MCP.cam.positionAt(layer, t1);
        var dA = MCP.cam.length(MCP.cam.sub(pa, cam0)), dB = MCP.cam.length(MCP.cam.sub(pb, cam1));
        var dofProp = MCP.cam.prop(camGroup, "ADBE Camera Depth of Field", "Depth of Field");
        if (dofProp) { try { if (dofProp.numKeys === 0) { dofProp.setValue(1); } } catch (e2) { notes.push("Could not enable Depth of Field: " + e2.toString()); } }
        var focusProp = MCP.cam.prop(camGroup, "ADBE Camera Focus Distance", "Focus Distance");
        if (!focusProp) { MCP.fail("Focus Distance property not found on camera '" + layer.name + "'.", "not-found"); }
        written.push({ property: MCP.pathOf(focusProp).path, keyframes: MCP.cam.writeTwoKeys(focusProp, t0, dA, t1, dB, easing) });
        notes.push("Distances are Euclidean from the camera to each layer's Position (parenting ignored): " + MCP.round(dA, 2) + " to " + MCP.round(dB, 2) + " px. Depth of Field was enabled.");
    } else {
        MCP.fail("Unknown move '" + move + "'. Use dolly, orbit, crane, push-in, pull-out or rack-focus.", "invalid-argument");
    }
    var paths = [];
    for (var w = 0; w < written.length; w++) { paths.push(written[w].property); }
    return {
        composition: MCP.serialize.compRef(comp),
        layer: MCP.serialize.layerRef(layer),
        move: move,
        startTime: MCP.round(t0), endTime: MCP.round(t1), startFrame: MCP.frameOf(comp, t0), endFrame: MCP.frameOf(comp, t1),
        easing: easing,
        twoNode: twoNode,
        propertyPaths: paths,
        keyframes: written,
        notes: notes
    };
}, { mutating: true });

MCP.register("setLightSettings", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = MCP.cam.requireLight(r.layer);
    var notes = [];
    if (MCP.isDefined(args.lightType)) {
        try { layer.lightType = MCP.cam.lightTypeValue(args.lightType); }
        catch (e) { if (e && e.mcpCode) { throw e; } notes.push("Could not change the light type: " + e.toString()); }
    }
    var g = MCP.cam.group(layer, "ADBE Light Options Group", "Light Options");
    var res = MCP.cam.applyTable(r.comp, layer, g, MCP.cam.LIGHT_PROPS, args);
    var out = MCP.cam.lightSummary(layer);
    out.applied = res.applied;
    out.notes = notes.concat(res.notes);
    return out;
}, { mutating: true });

MCP.register("setLayer3d", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var layers;
    if (MCP.isDefined(args.layers)) { layers = MCP.resolveLayers(comp, args.layers); }
    else if (MCP.isDefined(args.layer)) { layers = [MCP.resolveLayer(comp, args.layer)]; }
    else { MCP.fail("Give layer or layers (an array of layer references, {selected: true} or {all: true}).", "invalid-argument"); }
    var threeD = MCP.isDefined(args.threeD) ? MCP.bool(args.threeD, true) : null;
    var out = [], notes = [];
    for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        var entry = { layer: null, changed: [] };
        if (threeD !== null) {
            if (L instanceof CameraLayer || L instanceof LightLayer) { notes.push("Layer '" + L.name + "' is a " + MCP.layerType(L) + " and is always 3D; threeD ignored."); }
            else {
                try { L.threeDLayer = threeD; entry.changed.push("threeD"); }
                catch (e) { notes.push("Could not set 3D on '" + L.name + "': " + e.toString()); }
            }
        }
        if (MCP.isDefined(args.autoOrient)) {
            try { L.autoOrient = MCP.cam.autoOrientValue(args.autoOrient); entry.changed.push("autoOrient"); }
            catch (e2) { if (e2 && e2.mcpCode === "invalid-argument") { throw e2; } notes.push("Could not set autoOrient on '" + L.name + "': " + e2.toString()); }
        }
        entry.layer = MCP.serialize.layer(L);
        entry.autoOrient = MCP.cam.autoOrientName(L);
        out.push(entry);
    }
    return { composition: MCP.serialize.compRef(comp), count: out.length, layers: out, notes: notes };
}, { mutating: true });

MCP.register("setMaterialOptions", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer;
    if (layer instanceof CameraLayer || layer instanceof LightLayer) { MCP.fail("Layer '" + layer.name + "' is a " + MCP.layerType(layer) + "; material options exist only on 3D image layers.", "invalid-argument"); }
    var notes = [];
    if (!_mcpTry(function () { return layer.threeDLayer; }, false)) {
        if (MCP.bool(args.enable3d, true)) {
            try { layer.threeDLayer = true; notes.push("Layer '" + layer.name + "' was not 3D; the 3D switch was turned on."); }
            catch (e) { MCP.fail("Layer '" + layer.name + "' is not 3D and cannot be made 3D: " + e.toString(), "unsupported"); }
        } else {
            MCP.fail("Layer '" + layer.name + "' is not a 3D layer. Pass enable3d true or use set-layer-3d first.", "invalid-argument");
        }
    }
    var g = MCP.cam.group(layer, "ADBE Material Options Group", "Material Options");
    var res = MCP.cam.applyTable(r.comp, layer, g, MCP.cam.MATERIAL_PROPS, args);
    return {
        composition: MCP.serialize.compRef(r.comp),
        layer: MCP.serialize.layer(layer),
        materialOptions: MCP.cam.readTable(g, MCP.cam.MATERIAL_PROPS),
        applied: res.applied,
        notes: notes.concat(res.notes)
    };
}, { mutating: true });

MCP.register("lookAtLayer", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var layer = r.layer, comp = r.comp;
    var target = MCP.resolveLayer(comp, MCP.requireArg(args, "target"));
    if (target === layer) { MCP.fail("A layer cannot look at itself. Pick a different target.", "invalid-argument"); }
    var useExpression = MCP.bool(args.useExpression, false);
    var t = MCP.timeArg(comp, args, comp.time);
    var keyed = MCP.isDefined(args.time) || MCP.isDefined(args.frame);
    var notes = [];
    var poi = MCP.cam.poiProp(layer);
    var twoNode = MCP.cam.isTwoNode(layer);
    if (!useExpression && poi && twoNode) {
        var tp = MCP.cam.vec3(_mcpTry(function () { return target.property("ADBE Transform Group").property("ADBE Position").valueAtTime(t, false); }, [0, 0, 0]));
        if (_mcpTry(function () { return !!target.parent; }, false)) { notes.push("Target '" + target.name + "' has a parent; its own Position value was used, parenting ignored."); }
        var keyIndex = null;
        if (keyed || poi.numKeys > 0) {
            keyIndex = MCP.easing.setKey(poi, t, tp);
            if (MCP.isDefined(args.easing)) { MCP.easing.applySegment(poi, keyIndex, args.easing); }
        } else {
            poi.setValue(tp);
        }
        return MCP.serialize.propertyResult(layer, poi, { mode: "point-of-interest", target: MCP.serialize.layerRef(target), value: MCP.roundValue(tp), keyIndex: keyIndex, notes: notes });
    }
    if (!(layer instanceof CameraLayer) && !(layer instanceof LightLayer) && !_mcpTry(function () { return layer.threeDLayer; }, false)) {
        MCP.fail("Layer '" + layer.name + "' is not 3D. Use set-layer-3d first, or pick a camera or light.", "invalid-argument");
    }
    var orient = MCP.cam.prop(MCP.cam.transformGroup(layer), "ADBE Orientation", "Orientation");
    if (!orient) { MCP.fail("Orientation property not found on layer '" + layer.name + "'.", "not-found"); }
    var expr = 'lookAt(transform.position, thisComp.layer("' + String(target.name).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '").transform.position)';
    orient.expression = expr;
    if (!twoNode && poi && !useExpression) { notes.push("One-node camera or light: it has no active point of interest, so an Orientation expression was used instead."); }
    var err = _mcpTry(function () { return orient.expressionError || ""; }, "");
    if (err) { notes.push("Expression error reported by After Effects: " + err); }
    return MCP.serialize.propertyResult(layer, orient, { mode: "expression", target: MCP.serialize.layerRef(target), expression: expr, notes: notes });
}, { mutating: true });
