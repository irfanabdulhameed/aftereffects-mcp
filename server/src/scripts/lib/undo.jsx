/*
 * Undo helpers. Every command executed by the panel runs inside
 * app.beginUndoGroup("MCP: <command>") ... app.endUndoGroup(), so one
 * Cmd/Ctrl+Z in After Effects reverts the whole command. batch runs its steps
 * inside one group named "MCP: batch".
 */

MCP.undoDepth = 0;

MCP.withUndo = function (name, fn) {
    var opened = false;
    if (MCP.undoDepth === 0) {
        try { app.beginUndoGroup("MCP: " + name); opened = true; } catch (e1) {}
    }
    MCP.undoDepth++;
    try {
        return fn();
    } finally {
        MCP.undoDepth--;
        if (opened) {
            try { app.endUndoGroup(); } catch (e2) {}
        }
    }
};

MCP.undo = function () {
    var id = app.findMenuCommandId("Undo");
    if (!id) { MCP.fail("Undo menu command not found.", "unsupported"); }
    app.executeCommand(id);
    return true;
};

MCP.redo = function () {
    var id = app.findMenuCommandId("Redo");
    if (!id) { MCP.fail("Redo menu command not found.", "unsupported"); }
    app.executeCommand(id);
    return true;
};
