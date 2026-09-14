/*
 * Text layer commands: creation, content and style.
 */

MCP.textDocProp = function (layer) {
    if (!(layer instanceof TextLayer)) { MCP.fail("Layer '" + layer.name + "' is not a text layer.", "invalid-argument"); }
    return layer.property("ADBE Text Properties").property("ADBE Text Document");
};

MCP.justificationValue = function (name) {
    var map = {
        "left": "LEFT_JUSTIFY", "right": "RIGHT_JUSTIFY", "center": "CENTER_JUSTIFY", "centre": "CENTER_JUSTIFY",
        "justify-left": "FULL_JUSTIFY_LASTLINE_LEFT", "justify-right": "FULL_JUSTIFY_LASTLINE_RIGHT",
        "justify-center": "FULL_JUSTIFY_LASTLINE_CENTER", "justify-full": "FULL_JUSTIFY_LASTLINE_FULL"
    };
    var key = String(name).toLowerCase();
    if (!map[key]) { MCP.fail("Unknown justification '" + name + "'. Use left, center, right, justify-left, justify-right, justify-center or justify-full.", "invalid-argument"); }
    return ParagraphJustification[map[key]];
};

/** Applies style fields from args to a TextDocument. Returns the list of changed fields. */
MCP.applyTextStyle = function (doc, args) {
    var changed = [];
    function set(field, value) { doc[field] = value; changed.push(field); }
    if (MCP.isDefined(args.font)) { set("font", String(args.font)); }
    if (MCP.isDefined(args.fontSize)) { set("fontSize", Number(args.fontSize)); }
    if (MCP.isDefined(args.fillColor)) {
        doc.applyFill = true;
        set("fillColor", MCP.color.rgb(args.fillColor));
    }
    if (MCP.isDefined(args.strokeColor) || MCP.isDefined(args.strokeWidth)) {
        var sw = MCP.num(args.strokeWidth, MCP.isDefined(args.strokeColor) ? 2 : 0);
        if (sw > 0) {
            doc.applyStroke = true;
            if (MCP.isDefined(args.strokeColor)) { set("strokeColor", MCP.color.rgb(args.strokeColor)); }
            set("strokeWidth", sw);
            if (MCP.isDefined(args.strokeOverFill)) { set("strokeOverFill", MCP.bool(args.strokeOverFill, false)); }
        } else {
            doc.applyStroke = false; changed.push("applyStroke");
        }
    }
    if (MCP.isDefined(args.tracking)) { set("tracking", Number(args.tracking)); }
    if (MCP.isDefined(args.leading)) { doc.autoLeading = false; set("leading", Number(args.leading)); }
    if (MCP.isDefined(args.autoLeading)) { set("autoLeading", MCP.bool(args.autoLeading, true)); }
    if (MCP.isDefined(args.justification)) { set("justification", MCP.justificationValue(args.justification)); }
    if (MCP.isDefined(args.baselineShift)) { set("baselineShift", Number(args.baselineShift)); }
    if (MCP.isDefined(args.allCaps)) { set("allCaps", MCP.bool(args.allCaps, false)); }
    if (MCP.isDefined(args.smallCaps)) { set("smallCaps", MCP.bool(args.smallCaps, false)); }
    if (MCP.isDefined(args.fauxBold)) { set("fauxBold", MCP.bool(args.fauxBold, false)); }
    if (MCP.isDefined(args.fauxItalic)) { set("fauxItalic", MCP.bool(args.fauxItalic, false)); }
    if (MCP.isDefined(args.verticalScale)) { set("verticalScale", Number(args.verticalScale)); }
    if (MCP.isDefined(args.horizontalScale)) { set("horizontalScale", Number(args.horizontalScale)); }
    if (MCP.isDefined(args.tsume)) { set("tsume", Number(args.tsume)); }
    return changed;
};

MCP.register("createTextLayer", function (args) {
    var comp = MCP.resolveComp(args.comp);
    var text = MCP.isDefined(args.text) ? String(args.text) : "Text";
    var layer;
    if (MCP.isArray(args.boxSize)) {
        layer = comp.layers.addBoxText([Number(args.boxSize[0]), Number(args.boxSize[1])], text);
    } else {
        layer = comp.layers.addText(text);
    }
    var prop = MCP.textDocProp(layer);
    var doc = prop.value;
    var styleArgs = MCP.extend({}, args);
    if (!MCP.isDefined(styleArgs.fillColor)) { styleArgs.fillColor = [1, 1, 1, 1]; }
    if (!MCP.isDefined(styleArgs.fontSize)) { styleArgs.fontSize = 72; }
    if (!MCP.isDefined(styleArgs.justification)) { styleArgs.justification = "center"; }
    MCP.applyTextStyle(doc, styleArgs);
    prop.setValue(doc);
    if (!MCP.isDefined(args.position)) {
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    }
    MCP.placeNewLayer(comp, layer, args);
    if (!MCP.isDefined(args.name)) { layer.name = text.length > 40 ? text.substring(0, 40) : text; }
    var out = MCP.serialize.layer(layer);
    out.textDocument = MCP.serialize.textDocument(prop.value);
    return { composition: MCP.serialize.compRef(comp), layer: out };
}, { mutating: true });

MCP.register("setText", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.textDocProp(r.layer);
    var text = String(MCP.requireArg(args, "text"));
    if (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) {
        var doc = prop.valueAtTime(MCP.timeArg(r.comp, args), false);
        doc.text = text;
        MCP.easing.setKey(prop, MCP.timeArg(r.comp, args), doc);
    } else if (prop.numKeys > 0) {
        var d2 = prop.value; d2.text = text;
        prop.setValueAtTime(r.comp.time, d2);
    } else {
        var d3 = prop.value; d3.text = text;
        prop.setValue(d3);
    }
    if (MCP.bool(args.renameLayer, false)) { r.layer.name = text.length > 40 ? text.substring(0, 40) : text; }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), textDocument: MCP.serialize.textDocument(prop.value), numKeys: prop.numKeys };
}, { mutating: true });

MCP.register("getText", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.textDocProp(r.layer);
    var doc = (MCP.isDefined(args.time) || MCP.isDefined(args.frame)) ? prop.valueAtTime(MCP.timeArg(r.comp, args), false) : prop.value;
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), text: doc.text, textDocument: MCP.serialize.textDocument(doc), numKeys: prop.numKeys, hasExpression: prop.expression !== "" };
}, { mutating: true });

MCP.register("setTextStyle", function (args) {
    var r = MCP.resolveCompAndLayer(args);
    var prop = MCP.textDocProp(r.layer);
    var doc = prop.value;
    var changed = MCP.applyTextStyle(doc, args);
    if (!changed.length) { MCP.fail("No style fields given. Use font, fontSize, fillColor, strokeColor, strokeWidth, tracking, leading, justification, baselineShift, allCaps, smallCaps, fauxBold, fauxItalic, verticalScale, horizontalScale or tsume.", "invalid-argument"); }
    if (prop.numKeys > 0) { prop.setValueAtTime(r.comp.time, doc); } else { prop.setValue(doc); }
    var after = prop.value;
    var warnings = [];
    if (MCP.isDefined(args.font) && after.font !== String(args.font)) {
        warnings.push("Font '" + args.font + "' was not applied (After Effects reports '" + after.font + "'). Use list-fonts to find the PostScript name.");
    }
    return { composition: MCP.serialize.compRef(r.comp), layer: MCP.serialize.layerRef(r.layer), changed: changed, textDocument: MCP.serialize.textDocument(after), warnings: warnings };
}, { mutating: true });
