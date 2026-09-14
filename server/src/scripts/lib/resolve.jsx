/*
 * Shared resolvers. Every command that targets a composition, layer, item,
 * effect or property goes through these so addressing is the same everywhere.
 *
 *   MCP.resolveComp(ref)               ref = {id} | {name} | {active:true} | undefined | number | string
 *   MCP.resolveLayer(comp, ref)        ref = {index} | {id} | {name} | number | string
 *   MCP.resolveLayers(comp, spec)      spec = [LayerRef...] | {selected:true} | {all:true}
 *   MCP.resolveProperty(layer, path)   path = "Transform/Position" | "ADBE Transform Group/ADBE Position" | ["Effects", 1, "Blurriness"]
 *   MCP.resolveEffect(layer, ref)      ref = {index} | {name} | {matchName} | number | string
 *   MCP.resolveItem(ref)               ref = {id} | {name} | {index} | number | string   (project items)
 *   MCP.findProp(root, name)           depth-first search by display name or matchName
 *   MCP.pathOf(prop)                   "Effects/Gaussian Blur/Blurriness"
 */

MCP.compList = function () {
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem) { out.push({ id: item.id, name: item.name }); }
    }
    return out;
};

MCP.activeComp = function () {
    var it = app.project ? app.project.activeItem : null;
    return (it && it instanceof CompItem) ? it : null;
};

MCP.resolveComp = function (ref) {
    var r = ref;
    if (typeof r === "number") { r = { id: r }; }
    else if (typeof r === "string") { r = { name: r }; }
    var hasId = !!(r && MCP.isDefined(r.id));
    var hasName = !!(r && MCP.isDefined(r.name));
    if (hasId) {
        var byId = null;
        try { byId = app.project.itemByID(Number(r.id)); } catch (e1) { byId = null; }
        if (byId && byId instanceof CompItem) { return byId; }
        MCP.fail("No composition with id " + r.id + ". Available: " + MCP.describeComps(), "not-found", { compositions: MCP.compList() });
    }
    if (hasName) {
        var name = String(r.name);
        var i, item;
        for (i = 1; i <= app.project.numItems; i++) {
            item = app.project.item(i);
            if (item instanceof CompItem && item.name === name) { return item; }
        }
        var lower = name.toLowerCase();
        for (i = 1; i <= app.project.numItems; i++) {
            item = app.project.item(i);
            if (item instanceof CompItem && item.name.toLowerCase() === lower) { return item; }
        }
        MCP.fail("No composition named '" + name + "'. Available: " + MCP.describeComps(), "not-found", { compositions: MCP.compList() });
    }
    var active = MCP.activeComp();
    if (active) { return active; }
    MCP.fail("No active composition. Open one in the viewer, or pass comp {name} or {id}. Available: " + MCP.describeComps(), "not-found", { compositions: MCP.compList() });
    return null;
};

MCP.describeComps = function () {
    var list = MCP.compList();
    if (!list.length) { return "(the project has no compositions)"; }
    var parts = [];
    for (var i = 0; i < list.length && i < 40; i++) { parts.push("'" + list[i].name + "' (id " + list[i].id + ")"); }
    if (list.length > 40) { parts.push("and " + (list.length - 40) + " more"); }
    return parts.join(", ");
};

MCP.layerList = function (comp) {
    var out = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        var id = null;
        try { id = L.id; } catch (e) {}
        out.push({ index: i, id: id, name: L.name });
    }
    return out;
};

MCP.describeLayers = function (comp) {
    var list = MCP.layerList(comp);
    if (!list.length) { return "(the composition has no layers)"; }
    var parts = [];
    for (var i = 0; i < list.length && i < 60; i++) { parts.push(list[i].index + ": '" + list[i].name + "'"); }
    if (list.length > 60) { parts.push("and " + (list.length - 60) + " more"); }
    return parts.join(", ");
};

MCP.resolveLayer = function (comp, ref) {
    var r = ref;
    if (typeof r === "number") { r = { index: r }; }
    else if (typeof r === "string") { r = { name: r }; }
    if (!r || (!MCP.isDefined(r.index) && !MCP.isDefined(r.id) && !MCP.isDefined(r.name))) {
        MCP.fail("A layer reference is required: {index}, {id} or {name}. Layers in '" + comp.name + "': " + MCP.describeLayers(comp), "invalid-argument", { layers: MCP.layerList(comp) });
    }
    if (MCP.isDefined(r.index)) {
        var idx = Number(r.index);
        if (idx < 1 || idx > comp.numLayers) {
            MCP.fail("Layer index " + idx + " is out of range in '" + comp.name + "' (1 to " + comp.numLayers + "). Layers: " + MCP.describeLayers(comp), "not-found", { layers: MCP.layerList(comp) });
        }
        return comp.layer(idx);
    }
    var i, L;
    if (MCP.isDefined(r.id)) {
        var wanted = Number(r.id);
        for (i = 1; i <= comp.numLayers; i++) {
            L = comp.layer(i);
            try { if (L.id === wanted) { return L; } } catch (e2) {}
        }
        MCP.fail("No layer with id " + wanted + " in '" + comp.name + "'. Layers: " + MCP.describeLayers(comp), "not-found", { layers: MCP.layerList(comp) });
    }
    var name = String(r.name);
    var exact = [];
    for (i = 1; i <= comp.numLayers; i++) {
        L = comp.layer(i);
        if (L.name === name) { exact.push(L); }
    }
    if (exact.length === 1) { return exact[0]; }
    if (exact.length > 1) {
        var idxs = [];
        for (i = 0; i < exact.length; i++) { idxs.push(exact[i].index); }
        MCP.fail("Layer name '" + name + "' matches " + exact.length + " layers at indices " + idxs.join(", ") + " in '" + comp.name + "'. Use {index} or {id} instead.", "ambiguous", { matches: idxs });
    }
    var lower = name.toLowerCase();
    var loose = [];
    for (i = 1; i <= comp.numLayers; i++) {
        L = comp.layer(i);
        if (L.name.toLowerCase() === lower) { loose.push(L); }
    }
    if (loose.length === 1) { return loose[0]; }
    if (loose.length > 1) {
        var idxs2 = [];
        for (i = 0; i < loose.length; i++) { idxs2.push(loose[i].index); }
        MCP.fail("Layer name '" + name + "' matches " + loose.length + " layers (case-insensitive) at indices " + idxs2.join(", ") + ". Use {index} or {id}.", "ambiguous", { matches: idxs2 });
    }
    MCP.fail("No layer named '" + name + "' in '" + comp.name + "'. Layers: " + MCP.describeLayers(comp), "not-found", { layers: MCP.layerList(comp) });
    return null;
};

/** {comp, layer} from args.comp and args.layer. */
MCP.resolveCompAndLayer = function (args) {
    var comp = MCP.resolveComp(args ? args.comp : undefined);
    var layer = MCP.resolveLayer(comp, args ? args.layer : undefined);
    return { comp: comp, layer: layer };
};

/**
 * Several layers at once. spec may be an array of LayerRef, {selected:true},
 * {all:true}, or {indices:[...]} / {names:[...]}. Returns an array of layers.
 */
MCP.resolveLayers = function (comp, spec) {
    var out = [], i;
    if (MCP.isArray(spec)) {
        for (i = 0; i < spec.length; i++) { out.push(MCP.resolveLayer(comp, spec[i])); }
        return out;
    }
    if (spec && spec.all) {
        for (i = 1; i <= comp.numLayers; i++) { out.push(comp.layer(i)); }
        return out;
    }
    if (spec && spec.selected) {
        var sel = comp.selectedLayers || [];
        for (i = 0; i < sel.length; i++) { out.push(sel[i]); }
        if (!out.length) { MCP.fail("No layers are selected in '" + comp.name + "'.", "not-found"); }
        return out;
    }
    if (spec && MCP.isArray(spec.indices)) {
        for (i = 0; i < spec.indices.length; i++) { out.push(MCP.resolveLayer(comp, { index: spec.indices[i] })); }
        return out;
    }
    if (spec && MCP.isArray(spec.names)) {
        for (i = 0; i < spec.names.length; i++) { out.push(MCP.resolveLayer(comp, { name: spec.names[i] })); }
        return out;
    }
    if (spec) { return [MCP.resolveLayer(comp, spec)]; }
    MCP.fail("layers must be an array of layer references, {selected:true} or {all:true}.", "invalid-argument");
    return out;
};

/* ------------------------------------------------------------ project items */

MCP.resolveItem = function (ref, typeFilter) {
    var r = ref;
    if (typeof r === "number") { r = { id: r }; }
    else if (typeof r === "string") { r = { name: r }; }
    if (!r) { MCP.fail("An item reference is required: {id}, {name} or {index}.", "invalid-argument"); }
    var item = null, i;
    if (MCP.isDefined(r.id)) {
        try { item = app.project.itemByID(Number(r.id)); } catch (e) { item = null; }
        if (!item) { MCP.fail("No project item with id " + r.id + ".", "not-found"); }
    } else if (MCP.isDefined(r.index)) {
        var idx = Number(r.index);
        if (idx < 1 || idx > app.project.numItems) { MCP.fail("Project item index " + idx + " is out of range (1 to " + app.project.numItems + ").", "not-found"); }
        item = app.project.item(idx);
    } else if (MCP.isDefined(r.name)) {
        var name = String(r.name);
        for (i = 1; i <= app.project.numItems && !item; i++) {
            if (app.project.item(i).name === name) { item = app.project.item(i); }
        }
        if (!item) {
            var lower = name.toLowerCase();
            for (i = 1; i <= app.project.numItems && !item; i++) {
                if (app.project.item(i).name.toLowerCase() === lower) { item = app.project.item(i); }
            }
        }
        if (!item) { MCP.fail("No project item named '" + name + "'.", "not-found"); }
    } else {
        MCP.fail("Item reference needs {id}, {name} or {index}.", "invalid-argument");
    }
    if (typeFilter === "comp" && !(item instanceof CompItem)) { MCP.fail("Item '" + item.name + "' is not a composition.", "invalid-argument"); }
    if (typeFilter === "footage" && !(item instanceof FootageItem)) { MCP.fail("Item '" + item.name + "' is not footage.", "invalid-argument"); }
    if (typeFilter === "folder" && !(item instanceof FolderItem)) { MCP.fail("Item '" + item.name + "' is not a folder.", "invalid-argument"); }
    return item;
};

/* ------------------------------------------------------------- properties */

MCP.GROUP_ALIASES = {
    "transform": "ADBE Transform Group",
    "effects": "ADBE Effect Parade",
    "effect": "ADBE Effect Parade",
    "masks": "ADBE Mask Parade",
    "mask": "ADBE Mask Parade",
    "text": "ADBE Text Properties",
    "contents": "ADBE Root Vectors Group",
    "layer styles": "ADBE Layer Styles",
    "audio": "ADBE Audio Group",
    "material options": "ADBE Material Options Group",
    "camera options": "ADBE Camera Options Group",
    "light options": "ADBE Light Options Group",
    "time remap": "ADBE Time Remapping",
    "marker": "ADBE Marker",
    "markers": "ADBE Marker"
};

/** Direct child lookup by display name, matchName, or 1-based index. Case-insensitive fallback. */
MCP.childProp = function (group, token) {
    if (!group) { return null; }
    var child = null;
    if (typeof token === "number") {
        try { child = group.property(token); } catch (e0) { child = null; }
        return child || null;
    }
    var name = String(token);
    try { child = group.property(name); } catch (e1) { child = null; }
    if (child) { return child; }
    var alias = MCP.GROUP_ALIASES[name.toLowerCase()];
    if (alias) {
        try { child = group.property(alias); } catch (e2) { child = null; }
        if (child) { return child; }
    }
    var n = 0;
    try { n = group.numProperties; } catch (e3) { n = 0; }
    var lower = name.toLowerCase();
    for (var i = 1; i <= n; i++) {
        var p = null;
        try { p = group.property(i); } catch (e4) { continue; }
        if (!p) { continue; }
        if (p.name === name || p.matchName === name) { return p; }
    }
    for (var j = 1; j <= n; j++) {
        var q = null;
        try { q = group.property(j); } catch (e5) { continue; }
        if (!q) { continue; }
        if (String(q.name).toLowerCase() === lower || String(q.matchName).toLowerCase() === lower) { return q; }
    }
    return null;
};

MCP.childNames = function (group) {
    var out = [], n = 0;
    try { n = group.numProperties; } catch (e) { n = 0; }
    for (var i = 1; i <= n && i <= 80; i++) {
        var p = null;
        try { p = group.property(i); } catch (e2) { continue; }
        if (p) { out.push(p.name + " (" + p.matchName + ")"); }
    }
    return out;
};

MCP.normalizePath = function (path) {
    if (MCP.isArray(path)) { return path.slice(0); }
    if (typeof path === "string") {
        var s = path.replace(/^\/+|\/+$/g, "");
        if (!s.length) { return []; }
        return s.split("/");
    }
    if (typeof path === "number") { return [path]; }
    return [];
};

/**
 * Resolves a property path from a layer. Tries each token as a direct child
 * (display name, matchName, alias, index). If the first token is not found on
 * the layer itself, it is looked up under Transform, then Effects, then Text,
 * then Masks, so "Opacity" or "Gaussian Blur" alone also work.
 */
MCP.resolvePropertyOptional = function (layer, path) {
    var tokens = MCP.normalizePath(path);
    if (!tokens.length) { return null; }
    var current = layer;
    for (var i = 0; i < tokens.length; i++) {
        var tok = tokens[i];
        if (typeof tok === "string" && /^\d+$/.test(tok)) { tok = parseInt(tok, 10); }
        var next = MCP.childProp(current, tok);
        if (!next && i === 0 && typeof tok === "string") {
            var fallbacks = ["ADBE Transform Group", "ADBE Effect Parade", "ADBE Text Properties", "ADBE Mask Parade", "ADBE Root Vectors Group"];
            for (var f = 0; f < fallbacks.length && !next; f++) {
                var g = null;
                try { g = layer.property(fallbacks[f]); } catch (e) { g = null; }
                if (g) { next = MCP.childProp(g, tok); }
            }
        }
        if (!next) { return null; }
        current = next;
    }
    return current;
};

MCP.resolveProperty = function (layer, path) {
    var prop = MCP.resolvePropertyOptional(layer, path);
    if (prop) { return prop; }
    // Build a helpful error: find the deepest container that did resolve.
    var tokens = MCP.normalizePath(path);
    var current = layer, depth = 0;
    for (var i = 0; i < tokens.length; i++) {
        var tok = tokens[i];
        if (typeof tok === "string" && /^\d+$/.test(tok)) { tok = parseInt(tok, 10); }
        var next = MCP.childProp(current, tok);
        if (!next) { break; }
        current = next;
        depth = i + 1;
    }
    var where = depth === 0 ? "layer '" + layer.name + "'" : "'" + tokens.slice(0, depth).join("/") + "'";
    MCP.fail("Property '" + tokens.join("/") + "' not found on layer '" + layer.name + "'. Children of " + where + ": " + MCP.childNames(current).join(", "), "not-found", { resolvedDepth: depth, children: MCP.childNames(current) });
    return null;
};

/** Depth-first search for a property by display name or matchName anywhere under root. */
MCP.findProp = function (root, name) {
    var stack = [root];
    while (stack.length) {
        var g = stack.pop();
        var n = 0;
        try { n = g.numProperties; } catch (e) { n = 0; }
        for (var i = 1; i <= n; i++) {
            var p;
            try { p = g.property(i); } catch (e2) { continue; }
            if (!p) { continue; }
            if (p.name === name || p.matchName === name) { return p; }
            var isGroup = false;
            try { isGroup = (p.numProperties && p.numProperties > 0); } catch (e3) {}
            if (isGroup) { stack.push(p); }
        }
    }
    return null;
};

MCP.isGroup = function (prop) {
    try {
        return prop.propertyType === PropertyType.NAMED_GROUP || prop.propertyType === PropertyType.INDEXED_GROUP;
    } catch (e) { return false; }
};

/** Display-name path from the layer root, e.g. "Effects/Gaussian Blur/Blurriness". */
MCP.pathOf = function (prop) {
    var names = [], matches = [];
    var cur = prop;
    var guard = 0;
    while (cur && guard++ < 32) {
        var depth = -1;
        try { depth = cur.propertyDepth; } catch (e) { depth = -1; }
        if (depth === 0 || depth === -1) { break; }
        names.unshift(cur.name);
        matches.unshift(cur.matchName);
        try { cur = cur.parentProperty; } catch (e2) { cur = null; }
    }
    return { path: names.join("/"), matchPath: matches.join("/") };
};

/* ---------------------------------------------------------------- effects */

MCP.effectsGroup = function (layer) {
    var g = null;
    try { g = layer.property("ADBE Effect Parade"); } catch (e) { g = null; }
    if (!g) { MCP.fail("Layer '" + layer.name + "' cannot hold effects.", "unsupported"); }
    return g;
};

MCP.resolveEffectOptional = function (layer, ref) {
    var g = MCP.effectsGroup(layer);
    var r = ref;
    if (typeof r === "number") { r = { index: r }; }
    else if (typeof r === "string") { r = { name: r }; }
    if (!r) { return null; }
    var fx = null;
    if (MCP.isDefined(r.index)) {
        try { fx = g.property(Number(r.index)); } catch (e) { fx = null; }
        return fx || null;
    }
    if (MCP.isDefined(r.matchName)) {
        fx = MCP.childProp(g, String(r.matchName));
        if (fx) { return fx; }
    }
    if (MCP.isDefined(r.name)) {
        fx = MCP.childProp(g, String(r.name));
        if (fx) { return fx; }
    }
    return null;
};

MCP.resolveEffect = function (layer, ref) {
    var fx = MCP.resolveEffectOptional(layer, ref);
    if (fx) { return fx; }
    var g = MCP.effectsGroup(layer);
    MCP.fail("Effect not found on layer '" + layer.name + "'. Give effect {index}, {name} or {matchName}. Effects present: " + (MCP.childNames(g).join(", ") || "(none)"), "not-found", { effects: MCP.childNames(g) });
    return null;
};
