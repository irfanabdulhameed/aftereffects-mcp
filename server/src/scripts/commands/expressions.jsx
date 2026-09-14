/*
 * Expression commands.
 */

MCP.expressionResult = function (layer, prop) {
    var info = {
        hasExpression: _mcpTry(function () { return prop.expression !== ""; }, false),
        expression: _mcpTry(function () { return prop.expression; }, ""),
        enabled: _mcpTry(function () { return prop.expressionEnabled; }, null),
        error: _mcpTry(function () { return prop.expressionError || ""; }, "")
    };
    return MCP.serialize.propertyResult(layer, prop, { expressionState: info });
};

MCP.register("setExpression", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    var expr = MCP.requireArg(args, "expression");
    if (!prop.canSetExpression) { MCP.fail("Property '" + MCP.pathOf(prop).path + "' does not accept expressions.", "unsupported"); }
    prop.expression = String(expr);
    if (MCP.isDefined(args.enabled)) { try { prop.expressionEnabled = MCP.bool(args.enabled, true); } catch (e) {} }
    var out = MCP.expressionResult(r.layer, prop);
    if (out.expressionState.error) {
        out.warning = "The expression was set but After Effects reports an error: " + out.expressionState.error;
    }
    return out;
}, { mutating: true });

MCP.register("getExpression", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    return MCP.expressionResult(r.layer, prop);
}, { mutating: false });

MCP.register("removeExpression", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    if (prop.canSetExpression) { prop.expression = ""; }
    return MCP.expressionResult(r.layer, prop);
}, { mutating: true });

MCP.register("setExpressionEnabled", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.resolveProperty(r.layer, MCP.requireArg(args, "property"));
    if (!prop.canSetExpression || prop.expression === "") { MCP.fail("Property '" + MCP.pathOf(prop).path + "' has no expression.", "not-found"); }
    prop.expressionEnabled = MCP.bool(args.enabled, true);
    return MCP.expressionResult(r.layer, prop);
}, { mutating: true });
