function createComposition(args) {
    try {
        var name = args.name || "New Composition";
        var width = parseInt(args.width) || 1920;
        var height = parseInt(args.height) || 1080;
        var pixelAspect = parseFloat(args.pixelAspect) || 1.0;
        var duration = parseFloat(args.duration) || 10.0;
        var frameRate = parseFloat(args.frameRate) || 30.0;
        var bgColor = args.backgroundColor ? [args.backgroundColor.r/255, args.backgroundColor.g/255, args.backgroundColor.b/255] : [0, 0, 0];
        var newComp = app.project.items.addComp(name, width, height, pixelAspect, duration, frameRate);
        if (args.backgroundColor) {
            newComp.bgColor = bgColor;
        }
        return JSON.stringify({
            status: "success", message: "Composition created successfully",
            composition: { name: newComp.name, id: newComp.id, width: newComp.width, height: newComp.height, pixelAspect: newComp.pixelAspect, duration: newComp.duration, frameRate: newComp.frameRate, bgColor: newComp.bgColor }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

function listCompositions() {
    var project = app.project;
    var result = {
        compositions: []
    };
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        if (item instanceof CompItem) {
            result.compositions.push({
                id: item.id,
                name: item.name,
                duration: item.duration,
                frameRate: item.frameRate,
                width: item.width,
                height: item.height,
                numLayers: item.numLayers
            });
        }
    }
    
    return JSON.stringify(result, null, 2);
}
