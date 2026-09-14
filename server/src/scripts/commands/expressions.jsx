function setLayerExpression(compIndex, layerIndex, propertyName, expressionString) {
    try {
         
        var comp = app.project.items[compIndex];
         if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "Composition not found at index " + compIndex });
        }
        var layer = comp.layers[layerIndex];
         if (!layer) {
            return JSON.stringify({ success: false, message: "Layer not found at index " + layerIndex + " in composition '" + comp.name + "'"});
        }

        var transformGroup = layer.property("Transform");
         if (!transformGroup) {
             
             
        }

        var property = transformGroup ? transformGroup.property(propertyName) : null;
         if (!property) {
            
             if (layer.property("Effects") && layer.property("Effects").property(propertyName)) {
                 property = layer.property("Effects").property(propertyName);
             } else if (layer.property("Text") && layer.property("Text").property(propertyName)) {
                 property = layer.property("Text").property(propertyName);
             } 

            if (!property) {
                 return JSON.stringify({ success: false, message: "Property '" + propertyName + "' not found on layer '" + layer.name + "'." });
            }
        }

        if (!property.canSetExpression) {
            return JSON.stringify({ success: false, message: "Property '" + propertyName + "' does not support expressions." });
        }

        property.expression = expressionString;

        var action = expressionString === "" ? "removed" : "set";
        return JSON.stringify({ success: true, message: "Expression " + action + " for '" + propertyName + "' on layer '" + layer.name + "'." });
    } catch (e) {
        return JSON.stringify({ success: false, message: "Error setting expression: " + e.toString() + " (Line: " + e.line + ")" });
    }
}
