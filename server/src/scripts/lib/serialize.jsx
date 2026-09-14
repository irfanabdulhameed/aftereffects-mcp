function readPropertyValue(prop) {
    try {
        if (!prop || prop.propertyType === PropertyType.NAMED_GROUP || prop.propertyType === PropertyType.INDEXED_GROUP) {
            return null;
        }
        return prop.value;
    } catch (e) {
        return null;
    }
}

function serializeEffectProperty(prop, includeValues, currentDepth, maxDepth) {
    var propertyInfo = {
        name: prop.name,
        matchName: prop.matchName,
        index: prop.propertyIndex,
        canSetExpression: !!prop.canSetExpression,
        canVaryOverTime: !!prop.canVaryOverTime,
        numKeys: prop.numKeys || 0,
        isGroup: prop.propertyType === PropertyType.NAMED_GROUP || prop.propertyType === PropertyType.INDEXED_GROUP,
        children: []
    };

    if (includeValues) {
        propertyInfo.value = readPropertyValue(prop);
    }

    if (propertyInfo.isGroup && currentDepth < maxDepth && prop.numProperties) {
        for (var i = 1; i <= prop.numProperties; i++) {
            var child = prop.property(i);
            if (child) {
                propertyInfo.children.push(serializeEffectProperty(child, includeValues, currentDepth + 1, maxDepth));
            }
        }
    }

    return propertyInfo;
}
