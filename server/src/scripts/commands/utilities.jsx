/*
 * Utilities: ping, version, bridge status, options, undo/redo, batch, raw script.
 */

MCP.register("ping", function (args) {
    return {
        pong: true,
        echo: MCP.isDefined(args.message) ? args.message : null,
        aeVersion: app.version,
        bridgeVersion: MCP.version,
        protocol: MCP.protocol,
        time: new Date().toISOString()
    };
}, { mutating: false });

MCP.register("getAeVersion", function () {
    var v = MCP.aeVersion();
    var year = null;
    if (v >= 26) { year = 2026; } else if (v >= 25) { year = 2025; } else if (v >= 24) { year = 2024; }
    else if (v >= 23) { year = 2023; } else if (v >= 22) { year = 2022; } else if (v >= 18) { year = 2021; }
    return {
        version: app.version,
        versionNumber: v,
        yearGuess: year,
        buildName: _mcpTry(function () { return app.buildName; }, null),
        buildNumber: _mcpTry(function () { return app.buildNumber; }, null),
        language: _mcpTry(function () { return String(app.isoLanguage); }, null),
        os: _mcpTry(function () { return $.os; }, null),
        bridgeVersion: MCP.version,
        protocol: MCP.protocol,
        expressionEngine: _mcpTry(function () { return app.project.expressionEngine; }, null)
    };
}, { mutating: false });

MCP.register("getBridgeStatus", function () {
    return {
        panelAlive: true,
        aeVersion: app.version,
        bridgeVersion: MCP.version,
        protocol: MCP.protocol,
        options: MCP.options,
        autoRun: MCP.state.autoRun,
        commandsRun: MCP.state.commandsRun,
        errors: MCP.state.errors,
        lastCommand: MCP.state.lastCommand,
        lastCommandAt: MCP.state.lastCommandAt,
        queueLength: MCP.queueFiles().length,
        registeredCommands: MCP.commandNames().length,
        bridgeDir: MCP.paths.root,
        projectName: (app.project && app.project.file) ? app.project.file.name : null,
        activeComp: (function () { var c = MCP.activeComp(); return c ? { id: c.id, name: c.name } : null; })()
    };
}, { mutating: false });

MCP.register("setBridgeOptions", function (args) {
    var opts = {};
    if (MCP.isDefined(args.pollMs)) { opts.pollMs = Number(args.pollMs); }
    if (MCP.isDefined(args.verbosity)) { opts.verbosity = Number(args.verbosity); }
    var applied = MCP.applyOptions(opts);
    return { options: applied };
}, { mutating: false });

MCP.register("undo", function (args) {
    var count = Math.max(1, Math.round(MCP.num(args.count, 1)));
    for (var i = 0; i < count; i++) { MCP.undo(); }
    return { undone: count };
}, { mutating: true });

MCP.register("redo", function (args) {
    var count = Math.max(1, Math.round(MCP.num(args.count, 1)));
    for (var i = 0; i < count; i++) { MCP.redo(); }
    return { redone: count };
}, { mutating: true });

MCP.register("listCommands", function () {
    var names = MCP.commandNames();
    var out = [];
    for (var i = 0; i < names.length; i++) {
        out.push({ command: names[i], mutating: MCP.meta[names[i]] ? MCP.meta[names[i]].mutating !== false : true });
    }
    return { count: out.length, commands: out };
}, { mutating: false });

/**
 * batch: { steps: [{ command, args, label? }], stopOnError: true }
 * Runs inside the single undo group opened by the panel for "batch".
 * Returns one entry per step with status ok/error/skipped.
 */
MCP.register("batch", function (args, ctx) {
    var steps = args.steps;
    if (!MCP.isArray(steps) || !steps.length) { MCP.fail("batch needs a non-empty 'steps' array of {command, args}.", "invalid-argument"); }
    var stopOnError = MCP.bool(args.stopOnError, true);
    var results = [];
    var failed = 0, ok = 0, skipped = 0;
    var stopped = false;
    for (var i = 0; i < steps.length; i++) {
        var step = steps[i] || {};
        var entry = { step: i, command: step.command, label: MCP.isDefined(step.label) ? step.label : null, status: "skipped" };
        if (stopped) { skipped++; results.push(entry); continue; }
        var started = new Date().getTime();
        try {
            if (!step.command) { MCP.fail("Step " + i + " has no command.", "invalid-argument"); }
            entry.result = MCP.invoke(step.command, step.args || {}, { id: ctx ? ctx.id : null, command: step.command, log: ctx ? ctx.log : null });
            entry.status = "ok";
            ok++;
        } catch (err) {
            entry.status = "error";
            entry.error = MCP.errorInfo(err, step.command, ctx ? ctx.id : null);
            failed++;
            if (stopOnError) { stopped = true; }
        }
        entry.durationMs = new Date().getTime() - started;
        results.push(entry);
    }
    return { steps: results.length, ok: ok, failed: failed, skipped: skipped, stoppedEarly: stopped, results: results };
}, { mutating: true });

/**
 * runExtendscript: { script } evaluates arbitrary ExtendScript inside the undo
 * group. Gated on the server by AE_MCP_ALLOW_RAW_SCRIPT=1.
 */
MCP.register("runExtendscript", function (args) {
    var script = MCP.requireArg(args, "script");
    var value = eval(String(script));
    var out = { returned: null, type: typeof value };
    if (value !== undefined) {
        try { out.returned = MCP.serialize.rawValue(value); } catch (e) { out.returned = String(value); }
        if (value && typeof value === "object" && !MCP.isArray(value) && out.returned === String(value)) {
            // Plain objects: pass through so JSON can serialise them.
            var isPlain = true;
            try { isPlain = Object.prototype.toString.call(value) === "[object Object]"; } catch (e2) { isPlain = false; }
            if (isPlain) { out.returned = value; }
        }
    }
    return out;
}, { mutating: true });
