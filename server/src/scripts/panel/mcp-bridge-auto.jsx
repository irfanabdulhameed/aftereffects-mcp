/*
 * MCP Bridge Auto panel: UI and polling loop only. Commands live in commands/.
 *
 * Loop (every MCP.options.pollMs, default 500 ms):
 *   1. list queue/cmd-*.json, oldest first (the file name starts with a timestamp)
 *   2. rename the file to running-*.json so a crash never re-runs it
 *   3. run the command inside app.beginUndoGroup("MCP: <command>") with script
 *      alerts suppressed (app.beginSuppressDialogs), so an error comes back as
 *      a result instead of a modal that would block everything (not for undo/redo)
 *   4. write results/res-<id>.json atomically (temp file + rename)
 *   5. delete the running file
 *   6. write heartbeat.json every 2 seconds, and at the start and end of every
 *      command (state running/idle/paused, the running command and since when)
 *
 * The UI also shows who drives After Effects (driver.lock) and the last
 * DoScript run (external/), since chats may send scripts around the queue.
 * A hot reload (reload-bridge-panel) evaluates a new copy of this file with
 * MCP_RELOAD_HOST set to the open panel, so the new code reuses it. It must be
 * evaluated at global scope (from app.scheduleTask): $.evalFile inside a
 * function defines MCP locally and the timer would keep calling the old code.
 */

MCP.paths = {
    root: null, queue: null, results: null, frames: null, heartbeat: null, options: null
};

MCP.state = {
    busy: false,
    running: null,
    lastStatus: null,
    lastDurationMs: null,
    panelStartedAt: null,
    driver: { lock: null, running: null, last: null, historyStamp: 0 },
    lastTickAt: 0,
    scriptsSeen: 0,
    scriptErrors: 0,
    lastScriptId: null,
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
    var queueLength = MCP.queueFiles().length;
    MCP.refreshQueue(queueLength);
    MCP.refreshDriver();
    MCP.refreshLive();
    var hb = {
        at: new Date().toISOString(),
        aeVersion: app.version,
        bridgeVersion: MCP.version,
        protocol: MCP.protocol,
        pollMs: MCP.options.pollMs,
        queueLength: queueLength,
        busy: MCP.state.running !== null,
        state: MCP.state.running !== null ? "running" : (MCP.state.autoRun ? "idle" : "paused"),
        running: MCP.state.running,
        panelStartedAt: MCP.state.panelStartedAt,
        autoRun: MCP.state.autoRun,
        lastStatus: MCP.state.lastStatus,
        lastDurationMs: MCP.state.lastDurationMs,
        commandsRun: MCP.state.commandsRun,
        errors: MCP.state.errors,
        lastCommand: MCP.state.lastCommand,
        lastCommandAt: MCP.state.lastCommandAt,
        projectName: (app.project && app.project.file) ? app.project.file.name : null
    };
    try { MCP.writeFileAtomic(MCP.paths.heartbeat, JSON.stringify(hb)); } catch (e) {}
};

/* Commands that must not run with dialogs suppressed (they drive menu commands). */
MCP.noSuppress = { undo: true, redo: true };

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
    var suppressed = false;
    if (!MCP.noSuppress[cmd.command]) {
        try { app.beginSuppressDialogs(); suppressed = true; } catch (eS) {}
    }
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
    } finally {
        if (suppressed) { try { app.endSuppressDialogs(false); } catch (eE) {} }
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
    MCP.state.running = { id: cmd.id, command: cmd.command, startedAt: MCP.state.lastCommandAt };
    MCP.refreshStatus("Running: " + cmd.command, "running");
    MCP.writeHeartbeat(true);
    MCP.log("Run " + cmd.command + " (" + cmd.id + ")", 1);
    var envelope;
    try {
        envelope = MCP.execute(cmd);
        MCP.writeResult(envelope);
    } finally {
        MCP.state.running = null;
    }
    try { running.remove(); } catch (e4) {}
    MCP.state.commandsRun++;
    MCP.state.lastStatus = envelope.status;
    MCP.state.lastDurationMs = envelope.durationMs;
    MCP.writeHeartbeat(true);
    MCP.log((envelope.status === "ok" ? "Done " : "Failed ") + cmd.command + " in " + envelope.durationMs + " ms", 1);
    MCP.refreshStatus(envelope.status === "ok" ? "Done: " + cmd.command : "Error: " + cmd.command, envelope.status === "ok" ? "ok" : "error");
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
    /* A second timer left by an older panel or a reload would tick twice as often; ignore early ticks. */
    var nowTick = new Date().getTime();
    if (nowTick - MCP.state.lastTickAt < MCP.options.pollMs * 0.8) { return; }
    MCP.state.lastTickAt = nowTick;
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

MCP.readJson = function (path) {
    var text = MCP.readFile(path);
    if (!text) { return null; }
    try { return JSON.parse(text); } catch (e) { return null; }
};

/** Reads driver.lock and the DoScript run records (external/), re-reading the history only when it changed. */
MCP.refreshDriver = function () {
    var d = MCP.state.driver;
    d.lock = MCP.readJson(MCP.paths.root + "/driver.lock");
    d.running = MCP.readJson(MCP.paths.root + "/external/running.json");
    var hist = new File(MCP.paths.root + "/external/history.jsonl");
    if (hist.exists) {
        var stamp = 0;
        try { stamp = hist.modified.getTime(); } catch (e0) {}
        if (stamp !== d.historyStamp) {
            d.historyStamp = stamp;
            var text = MCP.readFile(hist) || "";
            var lines = text.split("\n");
            for (var i = lines.length - 1; i >= 0; i--) {
                if (lines[i]) {
                    try { d.last = JSON.parse(lines[i]); } catch (e1) {}
                    break;
                }
            }
        }
    }
    MCP.refreshDriverUi();
};

/* Status kinds drive the light colour: ready, running, ok, error, paused. */
MCP.statusColors = {
    ready:   [0.30, 0.78, 0.47],
    ok:      [0.30, 0.78, 0.47],
    running: [0.27, 0.56, 1.00],
    paused:  [0.95, 0.68, 0.20],
    error:   [0.93, 0.33, 0.31]
};

MCP.shortPath = function (path) {
    var home = Folder("~").fsName;
    var p = String(path || "");
    if (home && p.indexOf(home) === 0) { p = "~" + p.substring(home.length); }
    return p;
};

/* ---------------------------------------------------------- time format */

MCP.pad2 = function (n) { return (n < 10 ? "0" : "") + n; };

/** Milliseconds since 1970 from an ISO-8601 UTC string ("2026-10-27T02:41:10.123Z"); NaN if it is not one. */
MCP.parseIso = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(String(iso || ""));
    if (!m) { return NaN; }
    var ms = m[7] ? Number((m[7] + "00").substring(0, 3)) : 0;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms);
};

/** Local wall-clock time HH:MM:SS of an ISO string. */
MCP.clock = function (iso) {
    var t = MCP.parseIso(iso);
    if (isNaN(t)) { return ""; }
    var d = new Date(t);
    return MCP.pad2(d.getHours()) + ":" + MCP.pad2(d.getMinutes()) + ":" + MCP.pad2(d.getSeconds());
};

MCP.duration = function (ms) {
    var n = Number(ms);
    if (isNaN(n)) { return ""; }
    if (n < 1000) { return n + " ms"; }
    if (n < 60000) { return (Math.round(n / 100) / 10) + " s"; }
    return Math.floor(n / 60000) + " min " + Math.round((n % 60000) / 1000) + " s";
};

MCP.ago = function (iso) {
    var t = MCP.parseIso(iso);
    if (isNaN(t)) { return ""; }
    return MCP.duration(new Date().getTime() - t);
};

/* -------------------------------------------------------------- refresh */

MCP.refreshStatus = function (message, kind) {
    if (!MCP.ui) { return; }
    var ui = MCP.ui;
    try {
        if (!MCP.state.autoRun && kind !== "running") { kind = "paused"; }
        if (kind) { ui.kind = kind; }
        if (message) { ui.status.text = message; }
        ui.statRun.text = String(MCP.state.commandsRun);
        ui.statScripts.text = String(MCP.state.scriptsSeen);
        ui.statErr.text = String(MCP.state.errors + MCP.state.scriptErrors);
        if (MCP.state.lastCommand) {
            ui.rowCommand.text = MCP.state.lastCommand +
                (MCP.state.lastStatus ? "  ·  " + MCP.state.lastStatus + (MCP.state.lastDurationMs !== null ? " " + MCP.duration(MCP.state.lastDurationMs) : "") : "") +
                "  ·  " + MCP.clock(MCP.state.lastCommandAt);
        }
        ui.footer.text = "v" + MCP.version + "  ·  poll " + MCP.options.pollMs + " ms  ·  script alerts suppressed";
        ui.light.hide(); ui.light.show();
    } catch (e) {}
};

MCP.refreshQueue = function (count) {
    if (!MCP.ui) { return; }
    try { MCP.ui.statQueue.text = String(count); } catch (e) {}
};

/** Driver row (who holds driver.lock) and Script row (last DoScript run); logs each new run once. */
MCP.refreshDriverUi = function () {
    var d = MCP.state.driver;
    if (d.last && d.last.id && d.last.id !== MCP.state.lastScriptId) {
        if (MCP.state.lastScriptId !== null) {
            MCP.state.scriptsSeen++;
            if (d.last.status !== "ok") { MCP.state.scriptErrors++; }
            MCP.log("Script " + (d.last.status === "ok" ? "done" : "FAILED") + ": " + d.last.label + " in " + MCP.duration(d.last.durationMs) +
                (d.last.status !== "ok" && d.last.message ? " (" + d.last.message + ")" : ""), d.last.status === "ok" ? 1 : 0);
        }
        MCP.state.lastScriptId = d.last.id;
    }
    if (!MCP.ui) { return; }
    var ui = MCP.ui;
    try {
        var driver = "free";
        if (d.lock && d.lock.owner) {
            driver = d.lock.owner + (d.lock.purpose && d.lock.owner.indexOf(d.lock.purpose) < 0 ? "  ·  " + d.lock.purpose : "") + "  ·  " + MCP.ago(d.lock.acquiredAt);
        }
        ui.rowDriver.text = driver;
        if (d.running && d.running.label) {
            ui.rowScript.text = d.running.label + "  ·  running " + MCP.ago(d.running.startedAt);
        } else if (d.last && d.last.label) {
            ui.rowScript.text = d.last.label + "  ·  " + (d.last.status === "ok" ? "ok" : "error") + " " + MCP.duration(d.last.durationMs) + "  ·  " + MCP.clock(d.last.startedAt);
        }
        ui.statScripts.text = String(MCP.state.scriptsSeen);
        ui.statErr.text = String(MCP.state.errors + MCP.state.scriptErrors);
    } catch (e) {}
};

/** Live row: state of the AE MCP Live View plug-in from <bridge>/live/status.json. */
MCP.refreshLive = function () {
    if (!MCP.ui || !MCP.ui.rowLive) { return; }
    var text = "plug-in not installed";
    try {
        var raw = MCP.readFile(MCP.paths.root + "/live/status.json");
        if (raw) {
            var st = JSON.parse(raw);
            if (st.enabled === false) {
                text = "off  ·  v" + st.version;
            } else {
                text = "on  ·  " + st.frames + " pictures";
                var meta = MCP.readFile(MCP.paths.root + "/live/latest.json");
                if (meta) {
                    var m = JSON.parse(meta);
                    text += "  ·  last " + m.comp + " f" + m.frame + "  ·  " + Math.round(m.renderMs) + " ms";
                }
                if (st.lastError) { text += "  ·  " + st.lastError; }
            }
        }
        MCP.ui.rowLive.text = text;
    } catch (e) {}
};

/* -------------------------------------------------------------------- UI */

(function mcpBridgePanel(thisObj) {
    /* A hot reload (reload-bridge-panel) sets MCP_RELOAD_HOST to the open, emptied panel. */
    var host = thisObj;
    try { if (typeof MCP_RELOAD_HOST !== "undefined" && MCP_RELOAD_HOST) { host = MCP_RELOAD_HOST; } } catch (eH) {}
    MCP_RELOAD_HOST = null;
    var win = (host instanceof Panel || host instanceof Window)
        ? host
        : new Window("palette", "MCP Bridge  v" + MCP.version, undefined, { resizeable: true });
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 10;
    win.margins = 12;

    function font(el, style, size) {
        try { el.graphics.font = ScriptUI.newFont(el.graphics.font.name, style, size); } catch (e) {}
    }
    function dim(el) {
        try { el.graphics.foregroundColor = el.graphics.newPen(el.graphics.PenType.SOLID_COLOR, [0.6, 0.6, 0.6], 1); } catch (e) {}
    }

    /* Header: status light, status text, Auto-run switch */
    var head = win.add("group"); head.orientation = "row"; head.alignment = ["fill", "top"]; head.spacing = 8;
    var light = head.add("group"); light.preferredSize = [12, 12]; light.alignment = ["left", "center"];
    light.onDraw = function () {
        var g = this.graphics;
        var c = MCP.statusColors[(MCP.ui && MCP.ui.kind) || "ready"] || MCP.statusColors.ready;
        try {
            g.newPath(); g.ellipsePath(1, 1, 10, 10);
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, c));
        } catch (e) {}
    };
    var status = head.add("statictext", undefined, "Starting...", { truncate: "end" });
    status.alignment = ["fill", "center"];
    font(status, ScriptUI.FontStyle.BOLD, 13);
    var autoRun = head.add("checkbox", undefined, "Auto-run");
    autoRun.alignment = ["right", "center"];
    autoRun.value = MCP.state.autoRun;
    autoRun.helpTip = "Off pauses the queue: commands wait until you turn it back on.";

    /* Stat tiles */
    var stats = win.add("group"); stats.orientation = "row"; stats.alignment = ["fill", "top"]; stats.spacing = 6;
    function tile(label, tip) {
        var p = stats.add("panel"); p.orientation = "column"; p.alignChildren = ["left", "top"];
        p.alignment = ["fill", "top"]; p.margins = [8, 6, 8, 6]; p.spacing = 0;
        var v = p.add("statictext", undefined, "0"); v.characters = 5; font(v, ScriptUI.FontStyle.BOLD, 16);
        var l = p.add("statictext", undefined, label); dim(l);
        v.helpTip = l.helpTip = tip;
        return v;
    }
    var statQueue = tile("Queue", "Bridge commands waiting in the queue.");
    var statRun = tile("Commands", "Bridge commands this panel ran since it opened.");
    var statScripts = tile("Scripts", "Scripts sent straight to After Effects (ae-do) since this panel opened.");
    var statErr = tile("Errors", "Failed commands plus failed scripts since this panel opened.");

    /* Activity rows: who drives After Effects, the last command, the last script */
    var rows = win.add("group"); rows.orientation = "column"; rows.alignChildren = ["fill", "top"]; rows.alignment = ["fill", "top"]; rows.spacing = 3;
    function row(label, tip) {
        var g = rows.add("group"); g.orientation = "row"; g.alignment = ["fill", "top"]; g.spacing = 8;
        var l = g.add("statictext", undefined, label); l.characters = 8; dim(l);
        var v = g.add("statictext", undefined, "none yet", { truncate: "end" }); v.alignment = ["fill", "center"];
        l.helpTip = v.helpTip = tip;
        return v;
    }
    var rowDriver = row("Driver", "Who is driving After Effects now (driver.lock): one chat at a time.");
    var rowCommand = row("Command", "The last bridge command: name, result, time taken, local time.");
    var rowScript = row("Script", "The last script sent straight to After Effects by ae-do: label, result, time taken, local time.");
    var rowLive = row("Live", "AE MCP Live View plug-in: keeps a picture of the active comp for Claude (see-live). On/off with live-view-settings.");
    rowDriver.text = "free";

    /* Log */
    var logText = win.add("edittext", undefined, "", { multiline: true, readonly: true, scrolling: true });
    logText.preferredSize = [380, 180];
    logText.alignment = ["fill", "fill"];

    /* Actions */
    var buttons = win.add("group"); buttons.orientation = "row"; buttons.alignment = ["fill", "bottom"]; buttons.spacing = 6;
    var checkBtn = buttons.add("button", undefined, "Check now");
    checkBtn.helpTip = "Run anything waiting in the queue now, and restart the panel's timer if it stopped.";
    var openBtn = buttons.add("button", undefined, "Open folder");
    openBtn.helpTip = "Show the bridge folder in Finder / Explorer.";
    var spacer = buttons.add("group"); spacer.alignment = ["fill", "center"];
    var clearBtn = buttons.add("button", undefined, "Clear log");
    clearBtn.alignment = ["right", "center"];

    /* Footer: version, poll, guard; bridge folder */
    var footer = win.add("statictext", undefined, "", { truncate: "end" });
    footer.alignment = ["fill", "bottom"];
    dim(footer);
    var info = win.add("statictext", undefined, "", { truncate: "middle" });
    info.alignment = ["fill", "bottom"];
    dim(info);

    MCP.ui = {
        win: win, kind: "ready", light: light, status: status, info: info, footer: footer, logText: logText, autoRun: autoRun,
        statQueue: statQueue, statRun: statRun, statScripts: statScripts, statErr: statErr,
        rowDriver: rowDriver, rowCommand: rowCommand, rowScript: rowScript, rowLive: rowLive
    };
    MCP.logSink = function () {
        try { logText.text = MCP.logLines.slice(0, 80).join("\n"); } catch (e) {}
    };

    autoRun.onClick = function () {
        MCP.state.autoRun = autoRun.value;
        MCP.refreshStatus(autoRun.value ? "Ready" : "Paused: commands wait", autoRun.value ? "ready" : "paused");
        MCP.writeHeartbeat(true);
    };
    checkBtn.onClick = function () { MCP.reschedule(); MCP.tick(); MCP.writeHeartbeat(true); };
    clearBtn.onClick = function () { MCP.logLines = []; MCP.logSink(); };
    openBtn.onClick = function () { try { new Folder(MCP.paths.root).execute(); } catch (e) {} };

    win.onResizing = win.onResize = function () { try { this.layout.resize(); } catch (e) {} };

    MCP.state.panelStartedAt = new Date().toISOString();
    MCP.initPaths();
    MCP.loadOptions();
    MCP.recoverInterrupted();
    info.text = MCP.shortPath(MCP.paths.root);
    info.helpTip = MCP.paths.root;
    MCP.log("MCP Bridge Auto " + MCP.version + " (protocol " + MCP.protocol + ") on After Effects " + app.version, 1);
    MCP.log(MCP.commandNames().length + " commands registered; script alerts are suppressed while commands run", 1);
    MCP.log("Bridge folder: " + MCP.paths.root, 1);
    MCP.refreshStatus("Ready", "ready");
    MCP.writeHeartbeat(true);
    MCP.reschedule();

    if (win instanceof Window && !(host instanceof Window)) { win.center(); win.show(); }
    else { win.layout.layout(true); win.layout.resize(); }
})(this);
