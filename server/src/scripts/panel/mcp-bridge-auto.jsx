var aeVersion = parseFloat(app.version);
var isAE2025OrLater = aeVersion >= 25.0;
var panel = new Window("palette", "MCP Bridge Auto", undefined);
panel.orientation = "column";
panel.alignChildren = ["fill", "top"];
panel.spacing = 10;
panel.margins = 16;
var statusText = panel.add("statictext", undefined, "Waiting for commands...");
statusText.alignment = ["fill", "top"];
var logPanel = panel.add("panel", undefined, "Command Log");
logPanel.orientation = "column";
logPanel.alignChildren = ["fill", "fill"];
var logText = logPanel.add("edittext", undefined, "", {multiline: true, readonly: true});
logText.preferredSize.height = 200;
if (isAE2025OrLater) {
    var warning = panel.add("statictext", undefined, "AE 2025+: Dockable panels are not supported. Floating window only.");
    warning.graphics.foregroundColor = warning.graphics.newPen(warning.graphics.PenType.SOLID_COLOR, [1,0.3,0,1], 1);
}
var autoRunCheckbox = panel.add("checkbox", undefined, "Auto-run commands");
autoRunCheckbox.value = true;
var checkInterval = 2000;
var isChecking = false;
function getCommandFilePath() {
    var userFolder = Folder.myDocuments;
    var bridgeFolder = new Folder(userFolder.fsName + "/ae-mcp-bridge");
    if (!bridgeFolder.exists) {
        bridgeFolder.create();
    }
    return bridgeFolder.fsName + "/ae_command.json";
}
function getResultFilePath() {
    var userFolder = Folder.myDocuments;
    var bridgeFolder = new Folder(userFolder.fsName + "/ae-mcp-bridge");
    if (!bridgeFolder.exists) {
        bridgeFolder.create();
    }
    return bridgeFolder.fsName + "/ae_mcp_result.json";
}

function executeCommand(command, args) {
    var result = "";
    
    logToPanel("Executing command: " + command);
    statusText.text = "Running: " + command;
    panel.update();
    
    try {
        logToPanel("Attempting to execute: " + command); // Log before switch
        switch (command) {
            case "getProjectInfo":
                result = getProjectInfo();
                break;
            case "listCompositions":
                result = listCompositions();
                break;
            case "getLayerInfo":
                result = getLayerInfo();
                break;
            case "createComposition":
                logToPanel("Calling createComposition function...");
                result = createComposition(args);
                logToPanel("Returned from createComposition.");
                break;
            case "createTextLayer":
                logToPanel("Calling createTextLayer function...");
                result = createTextLayer(args);
                logToPanel("Returned from createTextLayer.");
                break;
            case "createShapeLayer":
                logToPanel("Calling createShapeLayer function...");
                result = createShapeLayer(args);
                logToPanel("Returned from createShapeLayer. Result type: " + typeof result);
                break;
            case "createSolidLayer":
                logToPanel("Calling createSolidLayer function...");
                result = createSolidLayer(args);
                logToPanel("Returned from createSolidLayer.");
                break;
            case "setLayerProperties":
                logToPanel("Calling setLayerProperties function...");
                result = setLayerProperties(args);
                logToPanel("Returned from setLayerProperties.");
                break;
            case "setLayerKeyframe":
                logToPanel("Calling setLayerKeyframe function...");
                result = setLayerKeyframe(args.compIndex, args.layerIndex, args.propertyName, args.timeInSeconds, args.value);
                logToPanel("Returned from setLayerKeyframe.");
                break;
            case "setLayerExpression":
                logToPanel("Calling setLayerExpression function...");
                result = setLayerExpression(args.compIndex, args.layerIndex, args.propertyName, args.expressionString);
                logToPanel("Returned from setLayerExpression.");
                break;
            case "applyEffect":
                logToPanel("Calling applyEffect function...");
                result = applyEffect(args);
                logToPanel("Returned from applyEffect.");
                break;
            case "applyEffectTemplate":
                logToPanel("Calling applyEffectTemplate function...");
                result = applyEffectTemplate(args);
                logToPanel("Returned from applyEffectTemplate.");
                break;
            case "listLayerEffects":
                logToPanel("Calling listLayerEffects function...");
                result = listLayerEffects(args);
                logToPanel("Returned from listLayerEffects.");
                break;
            case "listAvailableEffects":
                logToPanel("Calling listAvailableEffects function...");
                result = listAvailableEffects(args);
                logToPanel("Returned from listAvailableEffects.");
                break;
            case "setEffectProperty":
                logToPanel("Calling setEffectProperty function...");
                result = setEffectProperty(args);
                logToPanel("Returned from setEffectProperty.");
                break;
            case "setEffectKeyframe":
                logToPanel("Calling setEffectKeyframe function...");
                result = setEffectKeyframe(args);
                logToPanel("Returned from setEffectKeyframe.");
                break;
            case "applyLayerPreset":
                logToPanel("Calling applyLayerPreset function...");
                result = applyLayerPreset(args);
                logToPanel("Returned from applyLayerPreset.");
                break;
            case "createAdjustmentLayer":
                logToPanel("Calling createAdjustmentLayer function...");
                result = createAdjustmentLayer(args);
                logToPanel("Returned from createAdjustmentLayer.");
                break;
            case "centerLayers":
                logToPanel("Calling centerLayers function...");
                result = centerLayers(args);
                logToPanel("Returned from centerLayers.");
                break;
            case "getLayerClipFrames":
                logToPanel("Calling getLayerClipFrames function...");
                result = getLayerClipFrames(args);
                logToPanel("Returned from getLayerClipFrames.");
                break;
            case "getLayerAudioInfo":
                logToPanel("Calling getLayerAudioInfo function...");
                result = getLayerAudioInfo(args);
                logToPanel("Returned from getLayerAudioInfo.");
                break;
            case "addMarkersFromArray":
                logToPanel("Calling addMarkersFromArray function...");
                result = addMarkersFromArray(args);
                logToPanel("Returned from addMarkersFromArray.");
                break;
            case "addMarker":
                logToPanel("Calling addMarker function...");
                result = addMarker(args);
                logToPanel("Returned from addMarker.");
                break;
            case "setLayerAudioLevels":
                logToPanel("Calling setLayerAudioLevels function...");
                result = setLayerAudioLevels(args);
                logToPanel("Returned from setLayerAudioLevels.");
                break;
            case "removeLayerEffect":
                logToPanel("Calling removeLayerEffect function...");
                result = removeLayerEffect(args);
                logToPanel("Returned from removeLayerEffect.");
                break;
            case "duplicateLayer":
                logToPanel("Calling duplicateLayer function...");
                result = duplicateLayer(args);
                logToPanel("Returned from duplicateLayer.");
                break;
            case "bridgeTestEffects":
                logToPanel("Calling bridgeTestEffects function...");
                result = bridgeTestEffects(args);
                logToPanel("Returned from bridgeTestEffects.");
                break;
            default:
                result = JSON.stringify({ error: "Unknown command: " + command });
        }
        logToPanel("Execution finished for: " + command); // Log after switch
        logToPanel("Preparing to write result file...");
        var resultString = (typeof result === 'string') ? result : JSON.stringify(result);
        try {
            var resultObj = JSON.parse(resultString);
            resultObj._responseTimestamp = new Date().toISOString();
            resultObj._commandExecuted = command;
            resultString = JSON.stringify(resultObj, null, 2);
            logToPanel("Added timestamp to result JSON for tracking freshness.");
        } catch (parseError) {
            
            logToPanel("Could not parse result as JSON to add timestamp: " + parseError.toString());
            
        }
        
        var resultFile = new File(getResultFilePath());
        resultFile.encoding = "UTF-8"; 
        logToPanel("Opening result file for writing...");
        var opened = resultFile.open("w");
        if (!opened) {
            logToPanel("ERROR: Failed to open result file for writing: " + resultFile.fsName);
            throw new Error("Failed to open result file for writing.");
        }
        logToPanel("Writing to result file...");
        var written = resultFile.write(resultString);
        if (!written) {
             logToPanel("ERROR: Failed to write to result file (write returned false): " + resultFile.fsName);
             
        }
        logToPanel("Closing result file...");
        var closed = resultFile.close();
         if (!closed) {
             logToPanel("ERROR: Failed to close result file: " + resultFile.fsName);
             
        }
        logToPanel("Result file write process complete.");
        
        logToPanel("Command completed successfully: " + command); 
        statusText.text = "Command completed: " + command;
        
        
        logToPanel("Updating command status to completed...");
        updateCommandStatus("completed");
        logToPanel("Command status updated.");
        
    } catch (error) {
        var errorMsg = "ERROR in executeCommand for '" + command + "': " + error.toString() + (error.line ? " (line: " + error.line + ")" : "");
        logToPanel(errorMsg); 
        statusText.text = "Error: " + error.toString();
        
        
        try {
            logToPanel("Attempting to write ERROR to result file...");
            var errorResult = JSON.stringify({ 
                status: "error", 
                command: command,
                message: error.toString(),
                line: error.line,
                fileName: error.fileName
            });
            var errorFile = new File(getResultFilePath());
            errorFile.encoding = "UTF-8";
            if (errorFile.open("w")) {
                errorFile.write(errorResult);
                errorFile.close();
                logToPanel("Successfully wrote ERROR to result file.");
            } else {
                 logToPanel("CRITICAL ERROR: Failed to open result file to write error!");
            }
        } catch (writeError) {
             logToPanel("CRITICAL ERROR: Failed to write error to result file: " + writeError.toString());
        }
        
        
        logToPanel("Updating command status to error...");
        updateCommandStatus("error");
        logToPanel("Command status updated to error.");
    }
}


function updateCommandStatus(status) {
    try {
        var commandFile = new File(getCommandFilePath());
        if (commandFile.exists) {
            commandFile.open("r");
            var content = commandFile.read();
            commandFile.close();
            
            if (content) {
                var commandData = JSON.parse(content);
                commandData.status = status;
                
                commandFile.open("w");
                commandFile.write(JSON.stringify(commandData, null, 2));
                commandFile.close();
            }
        }
    } catch (e) {
        logToPanel("Error updating command status: " + e.toString());
    }
}


function logToPanel(message) {
    var timestamp = new Date().toLocaleTimeString();
    logText.text = timestamp + ": " + message + "\n" + logText.text;
}


function checkForCommands() {
    if (!autoRunCheckbox.value || isChecking) return;
    
    isChecking = true;
    
    try {
        var commandFile = new File(getCommandFilePath());
        if (commandFile.exists) {
            commandFile.open("r");
            var content = commandFile.read();
            commandFile.close();
            
            if (content) {
                var commandData = (typeof JSON !== "undefined" && JSON.parse)
                    ? JSON.parse(content)
                    : eval("(" + content + ")");
                
                
                if (commandData.status === "pending") {
                    
                    updateCommandStatus("running");
                    
                    
                    executeCommand(commandData.command, commandData.args || {});
                }
            }
        }
    } catch (e) {
        logToPanel("Error checking for commands: " + e.toString());
    }
    
    isChecking = false;
}


function startCommandChecker() {
    app.scheduleTask("checkForCommands()", checkInterval, true);
}


var checkButton = panel.add("button", undefined, "Check for Commands Now");
checkButton.onClick = function() {
    logToPanel("Manually checking for commands");
    checkForCommands();
};


logToPanel("MCP Bridge Auto started");
logToPanel("Command file: " + getCommandFilePath());
statusText.text = "Ready - Auto-run is " + (autoRunCheckbox.value ? "ON" : "OFF");


startCommandChecker();


panel.center();
panel.show();
