function coerceScriptValue(rawValue) {
    if (rawValue === undefined || rawValue === null) {
        return rawValue;
    }

    if (typeof rawValue !== "string") {
        return rawValue;
    }

    var trimmed = rawValue.replace(/^\s+|\s+$/g, "");
    if (trimmed === "") {
        return rawValue;
    }

    
    var firstChar = trimmed.charAt(0);
    if (firstChar === "[" || firstChar === "{" || firstChar === '"' || trimmed === "true" || trimmed === "false" || trimmed === "null") {
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            
        }
    }

    
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return parseFloat(trimmed);
    }

    return rawValue;
}
