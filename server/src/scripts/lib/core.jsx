/*
 * MCP namespace: command registry, error helpers, argument helpers, time helpers.
 * Every command file registers functions with MCP.register(name, fn, meta).
 * The panel dispatches by name from MCP.commands, so there is no switch to
 * maintain. Bridge command names are the tool names converted to camelCase.
 */

var MCP = {
    version: (typeof MCP_BRIDGE_VERSION !== "undefined") ? MCP_BRIDGE_VERSION : "dev",
    protocol: 2,
    commands: {},
    meta: {},
    logLines: [],
    verbosity: 1,
    logSink: null
};

/* ---------------------------------------------------------------- errors */

MCP.error = function (message, code, details) {
    var err = new Error(message);
    err.mcpCode = code || "script-error";
    if (details !== undefined) { err.mcpDetails = details; }
    return err;
};

MCP.fail = function (message, code, details) {
    throw MCP.error(message, code, details);
};

MCP.errorInfo = function (err, command, id) {
    var info = {
        message: (err && err.message) ? String(err.message) : String(err),
        code: (err && err.mcpCode) ? err.mcpCode : "script-error",
        command: command,
        id: id
    };
    try { if (err && err.line !== undefined) { info.line = err.line; } } catch (e1) {}
    try { if (err && err.fileName !== undefined) { info.fileName = String(err.fileName); } } catch (e2) {}
    try { if (err && err.mcpDetails !== undefined) { info.details = err.mcpDetails; } } catch (e3) {}
    return info;
};

/* ------------------------------------------------------------- registry */

/**
 * Registers a bridge command.
 * name: camelCase command name.
 * fn:   function (args, ctx) returning a JSON-serialisable object.
 * meta: { mutating: true|false }  (documentation and undo naming)
 */
MCP.register = function (name, fn, meta) {
    if (typeof fn !== "function") { throw new Error("MCP.register: '" + name + "' needs a function"); }
    if (MCP.commands[name]) { throw new Error("MCP.register: command '" + name + "' registered twice"); }
    MCP.commands[name] = fn;
    MCP.meta[name] = meta || { mutating: true };
};

MCP.has = function (name) {
    return Object.prototype.hasOwnProperty.call(MCP.commands, name);
};

MCP.commandNames = function () {
    var names = [];
    for (var k in MCP.commands) {
        if (Object.prototype.hasOwnProperty.call(MCP.commands, k)) { names.push(k); }
    }
    names.sort();
    return names;
};

/**
 * Invokes a registered command without opening an undo group.
 * Used by batch and by commands that compose other commands.
 */
MCP.invoke = function (name, args, ctx) {
    if (!MCP.has(name)) {
        MCP.fail("Unknown bridge command '" + name + "'. Known commands: " + MCP.commandNames().join(", "), "unknown-command");
    }
    var innerCtx = ctx || {};
    innerCtx.nested = true;
    return MCP.commands[name](args || {}, innerCtx);
};

/* -------------------------------------------------------------- logging */

MCP.log = function (message, level) {
    var lvl = (level === undefined) ? 1 : level;
    if (lvl > MCP.verbosity) { return; }
    var stamp;
    try { stamp = new Date().toLocaleTimeString(); } catch (e) { stamp = ""; }
    var line = stamp + "  " + message;
    MCP.logLines.unshift(line);
    if (MCP.logLines.length > 200) { MCP.logLines.length = 200; }
    if (typeof MCP.logSink === "function") {
        try { MCP.logSink(line); } catch (e2) {}
    }
};

/* ------------------------------------------------------------ arguments */

MCP.isDefined = function (v) {
    return v !== undefined && v !== null;
};

MCP.arg = function (args, name, fallback) {
    if (args && MCP.isDefined(args[name])) { return args[name]; }
    return fallback;
};

MCP.num = function (value, fallback) {
    if (!MCP.isDefined(value)) { return fallback; }
    var n = Number(value);
    return isNaN(n) ? fallback : n;
};

MCP.bool = function (value, fallback) {
    if (!MCP.isDefined(value)) { return fallback; }
    if (typeof value === "string") { return value.toLowerCase() === "true" || value === "1"; }
    return !!value;
};

MCP.isArray = function (v) {
    return Object.prototype.toString.call(v) === "[object Array]" || v instanceof Array;
};

MCP.requireArg = function (args, name) {
    if (!args || !MCP.isDefined(args[name])) {
        MCP.fail("Missing required argument '" + name + "'.", "invalid-argument");
    }
    return args[name];
};

MCP.aeVersion = function () {
    try { return parseFloat(app.version); } catch (e) { return 0; }
};

MCP.requireVersion = function (minVersion, featureName) {
    var v = MCP.aeVersion();
    if (v < minVersion) {
        MCP.fail(featureName + " is not supported in After Effects " + app.version + " (needs " + minVersion + " or later).", "unsupported");
    }
};

/* ----------------------------------------------------------------- time */

MCP.frameDuration = function (comp) {
    return comp && comp.frameDuration ? comp.frameDuration : (1 / 30);
};

/** Seconds from {time, frame}. frame wins. Falls back to defaultTime (or comp.time). */
MCP.timeArg = function (comp, args, defaultTime) {
    var fd = MCP.frameDuration(comp);
    if (args && MCP.isDefined(args.frame)) { return Number(args.frame) * fd; }
    if (args && MCP.isDefined(args.time)) { return Number(args.time); }
    if (MCP.isDefined(defaultTime)) { return defaultTime; }
    return comp ? comp.time : 0;
};

MCP.frameOf = function (comp, t) {
    return Math.round(t / MCP.frameDuration(comp));
};

MCP.snapToFrame = function (comp, t) {
    var fd = MCP.frameDuration(comp);
    return Math.round(t / fd) * fd;
};

/** Seconds from either seconds or frames given as {seconds, frames} or a number. */
MCP.durationArg = function (comp, args, secondsName, framesName, fallback) {
    var fd = MCP.frameDuration(comp);
    if (args && MCP.isDefined(args[framesName])) { return Number(args[framesName]) * fd; }
    if (args && MCP.isDefined(args[secondsName])) { return Number(args[secondsName]); }
    return fallback;
};

/* -------------------------------------------------------------- objects */

MCP.extend = function (target, source) {
    for (var k in source) {
        if (Object.prototype.hasOwnProperty.call(source, k)) { target[k] = source[k]; }
    }
    return target;
};

MCP.keys = function (obj) {
    return Object.keys(obj || {});
};

MCP.round = function (n, digits) {
    var f = Math.pow(10, digits === undefined ? 4 : digits);
    return Math.round(n * f) / f;
};

MCP.clamp = function (n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
};

MCP.roundValue = function (v, digits) {
    if (typeof v === "number") { return MCP.round(v, digits); }
    if (MCP.isArray(v)) {
        var out = [];
        for (var i = 0; i < v.length; i++) { out.push(MCP.roundValue(v[i], digits)); }
        return out;
    }
    return v;
};

/* ------------------------------------------------------------- filesystem */

MCP.readFile = function (file) {
    var f = (file instanceof File) ? file : new File(file);
    if (!f.exists) { return null; }
    f.encoding = "UTF-8";
    if (!f.open("r")) { return null; }
    var text = f.read();
    f.close();
    return text;
};

/** Writes text atomically: temp file in the same folder, then rename. */
MCP.writeFileAtomic = function (finalPath, text) {
    var finalFile = new File(finalPath);
    var folder = finalFile.parent;
    if (!folder.exists) { folder.create(); }
    var tmpName = ".tmp-" + finalFile.name + "-" + Math.floor(Math.random() * 1e9);
    var tmp = new File(folder.fsName + "/" + tmpName);
    tmp.encoding = "UTF-8";
    tmp.lineFeed = "Unix";
    if (!tmp.open("w")) { throw MCP.error("Cannot open file for writing: " + tmp.fsName, "io"); }
    tmp.write(text);
    tmp.close();
    if (finalFile.exists) { finalFile.remove(); }
    if (!tmp.rename(finalFile.name)) {
        // rename failed (rare): fall back to a direct write
        var direct = new File(finalPath);
        direct.encoding = "UTF-8";
        direct.lineFeed = "Unix";
        direct.open("w");
        direct.write(text);
        direct.close();
        try { tmp.remove(); } catch (e) {}
    }
    return finalPath;
};

MCP.bridgeRoot = function () {
    var docs = Folder.myDocuments;
    var root = new Folder(docs.fsName + "/ae-mcp-bridge");
    if (!root.exists) { root.create(); }
    return root.fsName;
};

MCP.subFolder = function (name) {
    var f = new Folder(MCP.bridgeRoot() + "/" + name);
    if (!f.exists) { f.create(); }
    return f.fsName;
};
