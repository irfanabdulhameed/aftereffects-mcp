/*
 * JSON for ExtendScript. After Effects ships no JSON object, so this defines
 * JSON.parse and JSON.stringify when they are missing. stringify supports the
 * space argument, drops functions and undefined, writes NaN and Infinity as
 * null, and escapes control characters so the Node side can always parse it.
 */

if (typeof JSON === "undefined") {
    JSON = {};
}

if (typeof JSON.stringify !== "function") {
    (function () {
        var escapable = new RegExp("[\\\\\"\\x00-\\x1f\\x7f-\\x9f\\u00ad\\u2028\\u2029\\ufeff]", "g");
        var meta = { "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r", '"': '\\"', "\\": "\\\\" };

        function quote(str) {
            escapable.lastIndex = 0;
            if (!escapable.test(str)) { return '"' + str + '"'; }
            return '"' + str.replace(escapable, function (ch) {
                var c = meta[ch];
                if (typeof c === "string") { return c; }
                return "\\u" + ("0000" + ch.charCodeAt(0).toString(16)).slice(-4);
            }) + '"';
        }

        function isArray(v) {
            return Object.prototype.toString.call(v) === "[object Array]" || v instanceof Array;
        }

        function str(value, indent, gap) {
            if (value === null || value === undefined) { return "null"; }
            var t = typeof value;
            if (t === "number") { return isFinite(value) ? String(value) : "null"; }
            if (t === "boolean") { return String(value); }
            if (t === "string") { return quote(value); }
            if (t === "function") { return undefined; }
            if (value instanceof Date) {
                try { return quote(value.toISOString()); } catch (e) { return quote(String(value)); }
            }
            if (typeof value.toJSON === "function") { return str(value.toJSON(), indent, gap); }
            var inner = indent + gap;
            var parts = [], i;
            if (isArray(value)) {
                for (i = 0; i < value.length; i++) {
                    var av = str(value[i], inner, gap);
                    parts.push(av === undefined ? "null" : av);
                }
                if (parts.length === 0) { return "[]"; }
                return gap ? "[\n" + inner + parts.join(",\n" + inner) + "\n" + indent + "]" : "[" + parts.join(",") + "]";
            }
            for (var k in value) {
                if (Object.prototype.hasOwnProperty.call(value, k)) {
                    var ov = str(value[k], inner, gap);
                    if (ov !== undefined) { parts.push(quote(k) + (gap ? ": " : ":") + ov); }
                }
            }
            if (parts.length === 0) { return "{}"; }
            return gap ? "{\n" + inner + parts.join(",\n" + inner) + "\n" + indent + "}" : "{" + parts.join(",") + "}";
        }

        JSON.stringify = function (value, replacer, space) {
            var gap = "";
            if (typeof space === "number") {
                for (var i = 0; i < space; i++) { gap += " "; }
            } else if (typeof space === "string") {
                gap = space;
            }
            var out = str(value, "", gap);
            return out === undefined ? "null" : out;
        };
    })();
}

if (typeof JSON.parse !== "function") {
    JSON.parse = function (text) {
        var t = String(text);
        // Reject anything that is not JSON-shaped before eval so a bad file
        // cannot execute code inside After Effects.
        var cleaned = t.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
            .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
            .replace(/(?:^|:|,)(?:\s*\[)+/g, "");
        if (!/^[\],:{}\s]*$/.test(cleaned)) {
            throw new Error("JSON.parse: input is not valid JSON");
        }
        return eval("(" + t + ")");
    };
}
