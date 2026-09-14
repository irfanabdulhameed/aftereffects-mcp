# Troubleshooting

Every error the server can return has a stable `error` code in the JSON result and a message that says what to do. This page lists them, plus the setup problems that produce no error at all.

## Setup problems

| Symptom | Cause | Fix |
|---|---|---|
| Window menu has no `mcp-bridge-auto.jsx` | The panel was not copied into the ScriptUI Panels folder, or After Effects was not restarted | `npm run install-bridge`, then quit and reopen After Effects. On Mac the copy may need your password; on Windows an elevated PowerShell window opens. |
| The panel opens but every tool times out | "Allow Scripts to Write Files and Access Network" is off | After Effects > Settings (Mac) or Edit > Preferences (Windows) > Scripting & Expressions, tick it, reopen the panel. |
| The MCP client cannot start the server | The path in the client config is wrong or the build is missing | The path must end in `server/build/index.js`. Run `npm run build`. Restart the client. |
| `get-bridge-status` says `versionsMatch: false` | The panel in After Effects is older than the server | `npm run build && npm run install-bridge`, close and reopen the panel. |
| The panel log shows "protocol mismatch" | Same as above, across a protocol change | Same fix. |
| Tools work but the panel log is empty | Verbosity 0 | `set-bridge-options` with `verbosity: 1`. |
| After Effects feels sluggish while the panel is open | Poll interval too short | `set-bridge-options` with `pollMs: 500` or more. |
| Nothing happens and the panel shows "Paused" | Auto-run is unticked | Tick "Auto-run" in the panel. |

The bridge folder is `~/Documents/ae-mcp-bridge` (both sides). Deleting its `queue` and `results` contents is always safe when After Effects is idle.

## Error codes from the server

These come back as `{ "tool": "...", "error": "<code>", "message": "...", ... }` with `isError: true`.

| Code | Meaning | What to do |
|---|---|---|
| `bridge-not-running` | The command was queued but the panel never picked it up before the timeout. The server removed it, so nothing ran. | Open the panel, check Auto-run and scripting file access. `get-bridge-status` shows the heartbeat age. Then call the tool again. |
| `timeout` | The panel picked up the command but it did not finish within the timeout. It is still running. | Wait, then `get-results` with the id from the message. Do not resend. For renders and big batches the server already waits `AE_MCP_RENDER_TIMEOUT_MS` (10 minutes). |
| `command-failed` | The command ran inside After Effects and threw. `bridgeError` holds the ExtendScript error with `code`, `line` and `fileName`. | Read `bridgeError.message`; the codes below say what went wrong. |
| `invalid-result` | The result file could not be parsed. | Rare. Retry once; if it persists, file a bug with the file from `results/`. |
| `disabled` | `run-extendscript` was called without `AE_MCP_ALLOW_RAW_SCRIPT=1`. | Use a dedicated tool, or have the human enable the variable. |
| `invalid-batch` | One or more batch steps failed validation; nothing was sent. `problems[]` lists them. | Fix the step arguments. Node-only tools (`get-help`, `list-presets`, `analyze-audio-waveform`, `see-frame`) cannot be batched. |
| `confirmation-required` | A destructive tool (`new-project`, `delete-item`, `reduce-project`) needs `confirm: true` or `force: true`. | Confirm only after telling the human. |
| `tool-failed` | A Node-side failure not covered above. | The message has the detail. |
| `not-found` (Node side) | A file path did not exist (`analyze-audio-waveform`, `apply-preset`). | Check the path; `~` is expanded. |
| `unsupported-format`, `decode-failed` | `analyze-audio-waveform` could not read the file. | Only PCM WAV is read directly; install ffmpeg for other formats or convert to WAV. |

Zod validation failures (wrong types, missing required fields, values out of range) are returned by the MCP layer before the tool runs, with the field path and the constraint.

## Error codes from inside After Effects

These appear in `bridgeError.code` after a `command-failed`.

| Code | Meaning | What to do |
|---|---|---|
| `not-found` | A composition, layer, property, effect, mask, item or file could not be found. The message lists what exists. | Use the list in the message; call `list-layers`, `list-compositions`, `get-layer-details` or `list-available-effects`. |
| `ambiguous` | A layer name matches more than one layer. `details.matches` has their indices. | Address the layer by `index` or `id`. |
| `invalid-argument` | A required argument is missing or a value is out of range for After Effects. | The message names the argument and the accepted values. |
| `unsupported` | The feature needs a newer After Effects (per-layer track mattes, font list, saveFrameToPng, saving presets, layer style stroke) or the effect or plugin is not installed. | The message names the version or the alternative. `get-ae-version` confirms the version. |
| `unknown-command` | The panel does not know the command. The panel is older than the server. | `npm run build && npm run install-bridge`, reopen the panel. |
| `protocol-mismatch` | The panel and server speak different bridge protocols. | Same fix. |
| `interrupted` | The panel was closed or After Effects restarted while the command was running. It may have partly applied. | Check the composition with `list-layers`; `undo` if needed. |
| `io` | The panel could not write a file (results or frames). | Check disk space and folder permissions on `~/Documents/ae-mcp-bridge`. |
| `serialize` | The result could not be turned into JSON. | Retry with smaller `depth` or `maxItems` arguments. |
| `script-error` | Any other ExtendScript error. `line` and `fileName` point into the assembled panel; the file banners (`/* ---- commands/... ---- */`) map lines back to source files. | Report it with the message and line. |
| `mock-failure` | Only from the mock bridge in tests. | Not seen with a real After Effects. |

## Result fields that signal a partial success

- `notes[]` on effect and template results lists properties that could not be set (a name that does not exist on this version, or a value After Effects refused). The effect was still added.
- `warnings[]` on text results says when a font was not applied and which font After Effects used instead.
- `expressionState.error` on expression results means the expression was set but After Effects disabled it. Fix and set again.
- `results[].status: "error"` inside bulk results identifies the failed items; the others were applied.

## Reading the panel log

The panel shows the last 80 log lines. `Run <command> (<id>)`, `Done <command> in <ms>` and `Failed <command>` bracket each command; `ERROR in <command>: <message> (line N)` gives the ExtendScript error. "Open bridge folder" opens the folder in Finder or Explorer so you can inspect `queue/` and `results/` by hand.

## When to file a bug

If a tool returns `script-error` with a line number, or a result shape does not match `docs/TOOLS.md`, open an issue with the tool name, the arguments, the After Effects version from `get-ae-version`, and the result file from `~/Documents/ae-mcp-bridge/results/`.
