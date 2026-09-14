/*
 * MCP Bridge Auto panel: UI and polling loop only. Commands live in commands/.
 *
 * Loop (every MCP.options.pollMs, default 500 ms):
 *   1. list queue/cmd-*.json, oldest first (the file name starts with a timestamp)
 *   2. rename the file to running-*.json so a crash never re-runs it
 *   3. run the command inside app.beginUndoGroup("MCP: <command>")
 *   4. write results/res-<id>.json atomically (temp file + rename)
 *   5. delete the running file
 *   6. write heartbeat.json every 2 seconds
 */

MCP.paths = {
    root: null, queue: null, results: null, frames: null, heartbeat: null, options: null
};

MCP.state = {
    busy: false,
    taskId: null,
    commandsRun: 0,
    errors: 0,
    lastCommand: null,
    lastCommandAt: null,
    lastHeartbeat: 0,
    autoRun: true,
    optionsCheckedAt: 0
};

MCP.options = { pollMs: 500, verbosity: 1 };
MCP.ui = null;

MCP.initPaths = function () {
    MCP.paths.root = MCP.bridgeRoot();
    MCP.paths.queue = MCP.subFolder("queue");
    MCP.paths.results = MCP.subFolder("results");
    MCP.paths.frames = MCP.subFolder("frames");
    MCP.paths.heartbeat = MCP.paths.root + "/heartbeat.json";
    MCP.paths.options = MCP.paths.root + "/bridge-options.json";
};

MCP.loadOptions = function () {
    var text = MCP.readFile(MCP.paths.options);
    if (!text) { return false; }
    var changed = false;
    try {
        var o = JSON.parse(text);
        if (MCP.isDefined(o.pollMs)) {
            var p = MCP.clamp(Number(o.pollMs) || 500, 100, 10000);
            if (p !== MCP.options.pollMs) { MCP.options.pollMs = p; changed = true; }
        }
        if (MCP.isDefined(o.verbosity)) {
            var v = MCP.clamp(Math.round(Number(o.verbosity)), 0, 2);
            MCP.options.verbosity = v;
            MCP.verbosity = v;
        }
    } catch (e) {
        MCP.log("Could not read bridge-options.json: " + e.toString(), 0);
    }
    return changed;
};

MCP.saveOptions = function () {
    MCP.writeFileAtomic(MCP.paths.options, JSON.stringify(MCP.options, null, 2));
};

MCP.applyOptions = function (opts) {
    if (MCP.isDefined(opts.pollMs)) { MCP.options.pollMs = MCP.clamp(Number(opts.pollMs) || 500, 100, 10000); }
    if (MCP.isDefined(opts.verbosity)) { MCP.options.verbosity = MCP.clamp(Math.round(Number(opts.verbosity)), 0, 2); MCP.verbosity = MCP.options.verbosity; }
    MCP.saveOptions();
    MCP.reschedule();
    MCP.refreshStatus();
    return MCP.options;
};

MCP.reschedule = function () {
    try { if (MCP.state.taskId !== null) { app.cancelTask(MCP.state.taskId); } } catch (e) {}
    MCP.state.taskId = app.scheduleTask("MCP.tick()", MCP.options.pollMs, true);
};

MCP.queueFiles = function () {
    var folder = new Folder(MCP.paths.queue);
    var files = folder.getFiles("cmd-*.json") || [];
    var names = [];
    for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof File) { names.push(files[i].name); }
    }
    names.sort();
    return names;
};

MCP.writeHeartbeat = function (force) {
    var now = new Date().getTime();
    if (!force && now - MCP.state.lastHeartbeat < 2000) { return; }
    MCP.state.lastHeartbeat = now;
    var hb = {
        at: new Date().toISOString(),
        aeVersion: app.version,
        bridgeVersion: MCP.version,
        protocol: MCP.protocol,
        pollMs: MCP.options.pollMs,
        queueLength: MCP.queueFiles().length,
        busy: MCP.state.busy,
        autoRun: MCP.state.autoRun,
        commandsRun: MCP.state.commandsRun,
        errors: MCP.state.errors,
        lastCommand: MCP.state.lastCommand,
        lastCommandAt: MCP.state.lastCommandAt,
        projectName: (app.project && app.project.file) ? app.project.file.name : null
    };
    try { MCP.writeFileAtomic(MCP.paths.heartbeat, JSON.stringify(hb)); } catch (e) {}
};

/** Runs one parsed command object and returns the result envelope. */
MCP.execute = function (cmd) {
    var started = new Date();
    var envelope = {
        id: cmd.id,
        command: cmd.command,
        status: "ok",
        startedAt: started.toISOString(),
        finishedAt: null,
        durationMs: 0,
        aeVersion: app.version,
        bridgeVersion: MCP.version
    };
    var ctx = { id: cmd.id, command: cmd.command, nested: false, log: function (m) { MCP.log("[" + cmd.command + "] " + m, 2); } };
    try {
        if (cmd.protocol !== undefined && Math.floor(Number(cmd.protocol)) !== MCP.protocol) {
            MCP.fail("Bridge protocol mismatch: the server speaks protocol " + cmd.protocol + " but this panel speaks " + MCP.protocol + ". Rebuild and reinstall the panel (npm run build && npm run install-bridge).", "protocol-mismatch");
        }
        if (!MCP.has(cmd.command)) {
            MCP.fail("Unknown bridge command '" + cmd.command + "'. The panel may be older than the server; rebuild and reinstall it. Known commands: " + MCP.commandNames().length, "unknown-command", { known: MCP.commandNames() });
        }
        var fn = MCP.commands[cmd.command];
        envelope.result = MCP.withUndo(cmd.command, function () { return fn(cmd.args || {}, ctx); });
        if (envelope.result === undefined) { envelope.result = null; }
    } catch (err) {
        envelope.status = "error";
        envelope.error = MCP.errorInfo(err, cmd.command, cmd.id);
        MCP.state.errors++;
        MCP.log("ERROR in " + cmd.command + ": " + envelope.error.message + (envelope.error.line ? " (line " + envelope.error.line + ")" : ""), 0);
    }
    var finished = new Date();
    envelope.finishedAt = finished.toISOString();
    envelope.durationMs = finished.getTime() - started.getTime();
    return envelope;
};

MCP.writeResult = function (envelope) {
    var text;
    try {
        text = JSON.stringify(envelope, null, 2);
    } catch (e) {
        text = JSON.stringify({
            id: envelope.id, command: envelope.command, status: "error",
            error: { message: "Result could not be serialised: " + e.toString(), code: "serialize", command: envelope.command, id: envelope.id },
            startedAt: envelope.startedAt, finishedAt: envelope.finishedAt, durationMs: envelope.durationMs,
            aeVersion: app.version, bridgeVersion: MCP.version
        });
    }
    MCP.writeFileAtomic(MCP.paths.results + "/res-" + envelope.id + ".json", text);
};

MCP.processOne = function (name) {
    var runningName = "running-" + name.substring(4);
    var pending = new File(MCP.paths.queue + "/" + name);
    if (!pending.exists) { return false; }
    if (!pending.rename(runningName)) { return false; }
    var running = new File(MCP.paths.queue + "/" + runningName);
    var text = MCP.readFile(running);
    var cmd = null;
    try {
        cmd = JSON.parse(text);
    } catch (e) {
        MCP.log("Could not parse command file " + name + ": " + e.toString(), 0);
        try { running.remove(); } catch (e2) {}
        return true;
    }
    if (!cmd || !cmd.id || !cmd.command) {
        MCP.log("Command file " + name + " has no id or command; discarded.", 0);
        try { running.remove(); } catch (e3) {}
        return true;
    }
    MCP.state.lastCommand = cmd.command;
    MCP.state.lastCommandAt = new Date().toISOString();
    MCP.refreshStatus("Running: " + cmd.command);
    MCP.log("Run " + cmd.command + " (" + cmd.id + ")", 1);
    var envelope = MCP.execute(cmd);
    MCP.writeResult(envelope);
    try { running.remove(); } catch (e4) {}
    MCP.state.commandsRun++;
    MCP.log((envelope.status === "ok" ? "Done " : "Failed ") + cmd.command + " in " + envelope.durationMs + " ms", 1);
    MCP.refreshStatus(envelope.status === "ok" ? "Completed: " + cmd.command : "Error: " + cmd.command);
    return true;
};

MCP.recoverInterrupted = function () {
    var folder = new Folder(MCP.paths.queue);
    var files = folder.getFiles("running-*.json") || [];
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!(f instanceof File)) { continue; }
        var cmd = null;
        try { cmd = JSON.parse(MCP.readFile(f)); } catch (e) { cmd = null; }
        if (cmd && cmd.id) {
            var now = new Date().toISOString();
            MCP.writeResult({
                id: cmd.id, command: cmd.command || "unknown", status: "error",
                error: { message: "Interrupted: the bridge panel was closed or After Effects restarted while this command was running. It may have partly applied; check the project and undo if needed.", code: "interrupted", command: cmd.command || "unknown", id: cmd.id },
                startedAt: now, finishedAt: now, durationMs: 0, aeVersion: app.version, bridgeVersion: MCP.version
            });
        }
        try { f.remove(); } catch (e2) {}
    }
    if (files.length) { MCP.log("Recovered " + files.length + " interrupted command(s).", 1); }
};

MCP.tick = function () {
    if (MCP.state.busy) { return; }
    MCP.state.busy = true;
    try {
        var now = new Date().getTime();
        if (now - MCP.state.optionsCheckedAt > 5000) {
            MCP.state.optionsCheckedAt = now;
            if (MCP.loadOptions()) { MCP.reschedule(); MCP.refreshStatus(); }
        }
        if (MCP.state.autoRun) {
            var names = MCP.queueFiles();
            var handled = 0;
            var startedAt = new Date().getTime();
            for (var i = 0; i < names.length && handled < 20; i++) {
                if (MCP.processOne(names[i])) { handled++; }
                if (new Date().getTime() - startedAt > 4000) { break; }
            }
        }
        MCP.writeHeartbeat(false);
    } catch (e) {
        MCP.log("Loop error: " + e.toString(), 0);
    } finally {
        MCP.state.busy = false;
    }
};

MCP.refreshStatus = function (message) {
    if (!MCP.ui) { return; }
    try {
        if (message) { MCP.ui.status.text = message; }
        MCP.ui.info.text = "Bridge: " + MCP.paths.root + "   |   poll " + MCP.options.pollMs + " ms   |   run " + MCP.state.commandsRun + "   |   errors " + MCP.state.errors;
    } catch (e) {}
};

/* -------------------------------------------------------------------- UI */

(function mcpBridgePanel(thisObj) {
    var win = (thisObj instanceof Panel)
        ? thisObj
        : new Window("palette", "MCP Bridge Auto  v" + MCP.version, undefined, { resizeable: true });
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 8;
    win.margins = 12;

    var head = win.add("group"); head.orientation = "row"; head.alignment = ["fill", "top"];
    var title = head.add("statictext", undefined, "MCP Bridge Auto");
    title.alignment = ["fill", "center"];
    try { title.graphics.font = ScriptUI.newFont(title.graphics.font.name, ScriptUI.FontStyle.BOLD, 13); } catch (e0) {}
    var autoRun = head.add("checkbox", undefined, "Auto-run");
    autoRun.value = true;

    var status = win.add("statictext", undefined, "Starting...");
    status.alignment = ["fill", "top"];
    var info = win.add("statictext", undefined, "");
    info.alignment = ["fill", "top"];

    var logPanel = win.add("panel", undefined, "Log");
    logPanel.orientation = "column";
    logPanel.alignChildren = ["fill", "fill"];
    logPanel.margins = 8;
    var logText = logPanel.add("edittext", undefined, "", { multiline: true, readonly: true, scrolling: true });
    logText.preferredSize = [420, 180];
    logText.alignment = ["fill", "fill"];

    var buttons = win.add("group"); buttons.orientation = "row"; buttons.alignment = ["fill", "bottom"];
    var checkBtn = buttons.add("button", undefined, "Check now");
    var clearBtn = buttons.add("button", undefined, "Clear log");
    var openBtn = buttons.add("button", undefined, "Open bridge folder");

    MCP.ui = { win: win, status: status, info: info, logText: logText, autoRun: autoRun };
    MCP.logSink = function () {
        try { logText.text = MCP.logLines.slice(0, 80).join("\n"); } catch (e) {}
    };

    autoRun.onClick = function () {
        MCP.state.autoRun = autoRun.value;
        MCP.refreshStatus(autoRun.value ? "Ready" : "Paused (Auto-run is off)");
        MCP.writeHeartbeat(true);
    };
    checkBtn.onClick = function () { MCP.tick(); };
    clearBtn.onClick = function () { MCP.logLines = []; MCP.logSink(); };
    openBtn.onClick = function () { try { new Folder(MCP.paths.root).execute(); } catch (e) {} };

    win.onResizing = win.onResize = function () { try { this.layout.resize(); } catch (e) {} };

    MCP.initPaths();
    MCP.loadOptions();
    MCP.recoverInterrupted();
    MCP.log("MCP Bridge Auto " + MCP.version + " (protocol " + MCP.protocol + ") on After Effects " + app.version, 1);
    MCP.log(MCP.commandNames().length + " commands registered", 1);
    MCP.log("Bridge folder: " + MCP.paths.root, 1);
    MCP.refreshStatus("Ready");
    MCP.writeHeartbeat(true);
    MCP.reschedule();

    if (win instanceof Window) { win.center(); win.show(); }
    else { win.layout.layout(true); win.layout.resize(); }
})(this);
