/*
 * Colour conversion inside the bridge. The Node side already normalises tool
 * inputs to [r,g,b,a] in 0..1, so most commands can pass colours straight to
 * After Effects. These helpers exist for rig commands (which use 0..255
 * triples from the panels) and for returning readable colours.
 */

MCP.color = {};

MCP.color.fromHex = function (hex) {
    var s = String(hex).replace(/^#/, "").toLowerCase();
    if (s.length === 3 || s.length === 4) {
        var expanded = "";
        for (var i = 0; i < s.length; i++) { expanded += s.charAt(i) + s.charAt(i); }
        s = expanded;
    }
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) {
        MCP.fail("Unrecognised hex colour '" + hex + "'.", "invalid-argument");
    }
    var r = parseInt(s.substr(0, 2), 16) / 255;
    var g = parseInt(s.substr(2, 2), 16) / 255;
    var b = parseInt(s.substr(4, 2), 16) / 255;
    var a = s.length === 8 ? parseInt(s.substr(6, 2), 16) / 255 : 1;
    return [r, g, b, a];
};

/** Any accepted colour form -> [r,g,b,a] in 0..1. */
MCP.color.rgba = function (value, fallback) {
    if (!MCP.isDefined(value)) { return fallback || [1, 1, 1, 1]; }
    if (typeof value === "string") { return MCP.color.fromHex(value); }
    var parts = null;
    if (MCP.isArray(value)) {
        parts = value.slice(0, 4);
    } else if (typeof value === "object") {
        parts = [value.r, value.g, value.b];
        if (MCP.isDefined(value.a)) { parts.push(value.a); }
    }
    if (!parts || parts.length < 3) {
        MCP.fail("Colour must be a hex string, [r,g,b], [r,g,b,a] or {r,g,b,a}.", "invalid-argument");
    }
    var scale = 1;
    for (var i = 0; i < parts.length; i++) {
        if (Number(parts[i]) > 1) { scale = 255; break; }
    }
    var out = [];
    for (var j = 0; j < 3; j++) { out.push(MCP.clamp(Number(parts[j]) / scale, 0, 1)); }
    out.push(parts.length > 3 ? MCP.clamp(Number(parts[3]) / scale, 0, 1) : 1);
    return out;
};

/** [r,g,b] in 0..1 (After Effects solids and shape fills take 3 components). */
MCP.color.rgb = function (value, fallback) {
    var c = MCP.color.rgba(value, fallback);
    return [c[0], c[1], c[2]];
};

/** 0..255 triple used by the panel SPEC tables -> [r,g,b,1]. */
MCP.color.from255 = function (rgb) {
    return [(rgb[0] || 0) / 255, (rgb[1] || 0) / 255, (rgb[2] || 0) / 255, 1];
};

MCP.color.toHex = function (arr) {
    if (!MCP.isArray(arr)) { return null; }
    function h(v) {
        var n = Math.round(MCP.clamp(Number(v) || 0, 0, 1) * 255).toString(16);
        return n.length < 2 ? "0" + n : n;
    }
    var hex = "#" + h(arr[0]) + h(arr[1]) + h(arr[2]);
    if (arr.length > 3 && Number(arr[3]) < 1) { hex += h(arr[3]); }
    return hex;
};
