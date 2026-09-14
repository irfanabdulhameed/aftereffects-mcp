/*
 * listRigs: returns the description of every rig command. The data lives in
 * MCP.rigs.catalog, filled by each rig file through MCP.rigs.describe(...),
 * so the ExtendScript source stays the single place that says what a rig
 * builds, what it needs and what its parameters default to.
 */

MCP.register("listRigs", function (args) {
    var rigs = MCP.rigs.catalog.slice(0);
    var want = MCP.isDefined(args && args.rig) ? String(args.rig) : null;
    if (want) {
        var filtered = [];
        for (var i = 0; i < rigs.length; i++) {
            if (rigs[i].tool === want || rigs[i].name === want || rigs[i].tool === "rig-" + want) { filtered.push(rigs[i]); }
        }
        if (!filtered.length) {
            var names = [];
            for (var k = 0; k < rigs.length; k++) { names.push(rigs[k].tool); }
            MCP.fail("No rig named '" + want + "'. Known rigs: " + names.join(", "), "not-found");
        }
        rigs = filtered;
    }
    return {
        count: rigs.length,
        notes: [
            "Every rig builds inside one undo step; a single undo removes the whole build.",
            "Panels under panels/ are the same logic with a ScriptUI form. Change the rig command first, then mirror it into the panel."
        ],
        rigs: rigs
    };
}, { mutating: false });
