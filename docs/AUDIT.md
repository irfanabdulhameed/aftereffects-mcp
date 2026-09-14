# Audit of the starting repository

Date: 2026-09-14. Everything below was verified by reading every file and building the server (`npm install && npm run build` in `ae-mcp-setup/after-effects-mcp`, TypeScript 5.8.3, SDK 1.9.0, zod 3.24.2). The build passed as-is.

## Repository shape at the start

```
.
├── .gitignore
├── Blur Color Reveal/            builder panel (.jsx + GUIDE.md)
├── Depth Map Blur Reveal/        builder panel (.jsx + GUIDE.md)
├── Edge Glow/                    builder panel (.jsx + GUIDE.md)
├── Power Warp Transition/        builder panel (.jsx + GUIDE.md)
└── ae-mcp-setup/
    ├── README.md                 setup guide, still links to the upstream repository
    ├── setup-mac.sh              clones the upstream repository, ignores the vendored copy
    ├── setup-windows.ps1         same bug
    └── after-effects-mcp/
        ├── HOW-TO-USE.txt        contains another person's Windows username and paths
        ├── install-bridge.js     copies build/scripts/mcp-bridge-auto.jsx into After Effects
        ├── package.json          build = tsc + copyfiles src/scripts -> build/scripts
        ├── src/index.ts          1866 lines, 30 tools, 3 prompts, 1 resource
        └── src/scripts/
            ├── mcp-bridge-auto.jsx   2696 lines, 27 bridge commands in one switch
            └── *.jsx                 10 standalone scripts, dead (nothing loads them)
```

## How the bridge works today

1. The server writes one file, `~/Documents/ae-mcp-bridge/ae_command.json`, with `{ command, args, timestamp, status: "pending" }`.
2. The panel polls that file every 2000 ms with `app.scheduleTask`, runs the matching `case` in `executeCommand`, and writes `~/Documents/ae-mcp-bridge/ae_mcp_result.json`, adding `_responseTimestamp` and `_commandExecuted`.
3. The server either returns "queued, call get-results" immediately, or polls the result file with `waitForBridgeResult(expectedCommand, timeoutMs)` and matches on `_commandExecuted` only.

The file-based design is kept. Everything else about the lifecycle is replaced in Phase 2.

## Tool table

Columns: tool name | bridge command | what it does | addressing style | undo group | easing | duplicate of | verdict.

"Queued" in the addressing column means the tool returns immediately and expects the caller to poll `get-results`. "Sleep 1s" means the tool waits one second then reads whatever is in the result file, whether or not it belongs to this call.

| Tool | Bridge command | What it does | Addressing | Undo | Easing | Duplicate of | Verdict |
|---|---|---|---|---|---|---|---|
| run-script | any of 28 names | Queues any allow-listed bridge command. Described as read-only, allow-list includes every mutating command. | Pass-through, queued | No | n/a | every other tool | delete (replaced by dedicated tools and `batch`) |
| get-results | none | Reads the single result file. 30 s mtime staleness heuristic. | none | n/a | n/a | | rewrite (takes optional `id`) |
| get-help | none | Returns a hard-coded string that lists run-script names. | none | n/a | n/a | mcp_aftereffects_get_effects_help | rewrite (reads docs/AGENT-GUIDE.md from disk) |
| create-composition | createComposition | Adds a comp. Colour as 0-255 RGB object. | none (project level), queued | No | n/a | | keep, upgrade (presets, frames duration, waits for result) |
| create-adjustment-layer | createAdjustmentLayer | Adds a black solid flagged as adjustment layer. | compName or active | No | n/a | | keep, move to shared addressing |
| center-layers | centerLayers | Sets Position to comp centre for one, selected, or all layers. | compIndex (project item index), layerIndex or layerName | No | n/a | | keep, shared addressing |
| get-layer-clip-frames | getLayerClipFrames | In/out/start in seconds and frames. | compIndex, layerIndex or layerName | n/a | n/a | | merge into get-layer-details and set-layer-timing return shape |
| setLayerKeyframe | setLayerKeyframe | Sets one keyframe on a Transform, Effects or Text child by display name. Adds a keyframe at comp time first if the property has none. | compIndex is `app.project.items[i]` (project item index, not composition index), layerIndex; queued | No | None | set-effect-keyframe (which has full graph controls) | rename to set-keyframe, add easing, shared addressing |
| setLayerExpression | setLayerExpression | Sets or clears an expression on a Transform, Effects or Text child. Does not read `expressionError`. | same as setLayerKeyframe; queued | No | n/a | set-effect-property (expressionString) | rename to set-expression, validate, shared addressing |
| test-animation | none | Writes a temp .jsx and asks the human to run it by hand. | compIndex, layerIndex | No | n/a | | delete |
| apply-effect | applyEffect | Adds an effect by match name or display name, or applies an .ffx. | compIndex, layerIndex; queued | No | n/a | add-any-effect, mcp_aftereffects_applyEffect | keep as the one canonical tool, add idempotency and settings object |
| add-any-effect | applyEffect | Same, waits for result. | compIndex, layerIndex | No | n/a | apply-effect | delete |
| apply-effect-template | applyEffectTemplate | Applies one of 9 built-in templates. `customSettings.x || default` drops legitimate zero values. | compIndex, layerIndex; queued | No | n/a | mcp_aftereffects_applyEffectTemplate | keep, expand templates, fix zero-value bug |
| list-layer-effects | listLayerEffects | Lists effects with optional property tree. | compIndex, layerIndex | n/a | n/a | | keep, shared addressing |
| list-available-effects | listAvailableEffects | Enumerates `app.effects` with text filter. | none | n/a | n/a | | keep, add category filter |
| set-effect-property | setEffectProperty | Sets a value, keyframe, or expression on an effect property with full graph options. | compIndex, layerIndex, effectIndex/Name/MatchName, propertyPath array | No | Full (speed, influence, interpolation, spatial) | set-effect-keyframe | keep, shared addressing and shared Easing schema |
| set-effect-keyframe | setEffectKeyframe | Thin wrapper over setEffectProperty that requires value and time. | same | No | Full | set-effect-property | keep, share Easing schema with layer keyframes |
| list-presets | none (Node) | Walks preset folders for .ffx files. Windows-only application roots; Mac app bundle Presets folder not searched. | none | n/a | n/a | | keep, add Mac roots |
| search-presets | none (Node) | Same walk with a query. | none | n/a | n/a | list-presets | keep |
| apply-preset | applyLayerPreset | `layer.applyPreset(file)`. | compIndex, layerIndex | No | n/a | apply-effect (presetPath) | keep, shared addressing |
| mcp_aftereffects_applyEffect | applyEffect | Same as apply-effect. Sleep 1s then reads result file. | compIndex, layerIndex | No | n/a | apply-effect | delete |
| mcp_aftereffects_applyEffectTemplate | applyEffectTemplate | Same as apply-effect-template. Sleep 1s. | compIndex, layerIndex | No | n/a | apply-effect-template | delete |
| mcp_aftereffects_get_effects_help | none | Hard-coded list of match names. | none | n/a | n/a | get-help | delete (content moves to AGENT-GUIDE.md and list-available-effects) |
| run-bridge-test | bridgeTestEffects | Applies Gaussian Blur and drop-shadow template to layer 1 of comp 1. Mutates the user's project as a "test". | hard-coded | No | n/a | | delete (replaced by `ping` and `npm run smoke`) |
| remove-effect | removeLayerEffect | Removes one effect or all. | compIndex, layerIndex, effectIndex/Name/MatchName | No | n/a | | keep, split removeAll into remove-all-effects |
| add-marker | addMarker | Adds a comp or layer marker. | compIndex, layerIndex or layerName | No | n/a | add-markers-bulk | keep, shared addressing |
| set-audio-levels | setLayerAudioLevels | Sets Audio Levels in dB, optional keyframe. | compIndex, layerIndex | No | None | | keep |
| get-audio-info | getLayerAudioInfo | Source file, channels, levels, markers. | compIndex, layerIndex or layerName | n/a | n/a | | keep |
| analyze-audio-waveform | none (Node) | Parses PCM WAV, returns amplitude envelope and peaks. | file path | n/a | n/a | | keep, add ffmpeg decode path |
| add-markers-bulk | addMarkersFromArray | Adds many markers. | compIndex, layerIndex or layerName | No | n/a | add-marker | keep |

Reachable only through run-script, with no dedicated tool:

| Bridge command | What it does | Verdict |
|---|---|---|
| getProjectInfo | Project summary, item list capped at 50. | becomes get-project-info |
| listCompositions | All comps with basic fields. | becomes list-compositions |
| getLayerInfo | Layers of the active comp: index, name, enabled, locked, in, out. | becomes list-layers |
| createTextLayer | Text layer with font, size, colour, justification. Addressing: compName or active. | becomes create-text-layer |
| createShapeLayer | Rectangle, ellipse, polygon, star with fill and stroke. Addressing: compName or active. | becomes create-shape-layer |
| createSolidLayer | Solid, optionally flagged as adjustment. | becomes create-solid-layer |
| setLayerProperties | Position, scale, rotation, opacity, start, duration, and text document fields. | split into set-transform, set-layer-timing, set-text, set-text-style |
| duplicateLayer | Clones a layer to many times. The only bridge command wrapped in an undo group. | becomes duplicate-layer |

Prompts: `list-compositions`, `analyze-composition`, `create-composition`. All three are one-line prompts. Replaced in Phase 4.

Resource: `aftereffects://compositions`. Kept and joined by six more in Phase 4.

## Totals

| | Count |
|---|---|
| Tools registered | 30 |
| Tools that are duplicates of another tool | 5 (add-any-effect, mcp_aftereffects_applyEffect, mcp_aftereffects_applyEffectTemplate, mcp_aftereffects_get_effects_help, run-bridge-test) |
| Tools that ask a human to do something | 1 (test-animation) |
| Bridge commands | 27 (plus `test-animation` in the run-script allow-list, which has no bridge case and returns "Unknown command") |
| Bridge commands inside an undo group | 1 (duplicateLayer) |
| Tools with easing control | 2 (set-effect-property, set-effect-keyframe) |
| Distinct addressing styles | 4 (compIndex as project item index; compName or active; compIndex plus layerIndex or layerName; none) |

## Plumbing defects found

1. No command identifier. Result matching is on command name only, so two calls to the same command in a row can return the first call's result.
2. No queue. One command file, one result file. A second call while the first is running overwrites the first.
3. Stale detection is a 30 s mtime heuristic in `readResultsFromTempFile`.
4. Three tools sleep one second and then read whatever the result file holds.
5. Panel poll interval 2000 ms and server wait 5 to 10 s are hard-coded.
6. Only `duplicateLayer` uses `app.beginUndoGroup`. The four builder panels all do it correctly with try/finally.
7. Inner functions catch errors and return `{status:"error", message}` without `line` or `fileName`. Only the outer `executeCommand` catch includes them, and it is never reached for those errors.
8. `setLayerKeyframe` and `setLayerExpression` use `app.project.items[compIndex]` (project item index). Other tools use `app.project.item(compIndex)` and call it a composition index. Neither is a composition index.
9. `setLayerKeyframe` adds a hidden extra keyframe at the current comp time when the property has none.
10. `applyEffectTemplate` uses `customSettings.x || default`, so a requested `0` becomes the default.
11. `SCRIPTS_DIR`, `TEMP_DIR` and `execSync` are declared in `index.ts` and never used. The ten standalone `src/scripts/*.jsx` files are copied to `build/scripts` but nothing reads them. Confirmed by searching `index.ts` for `scripts/`: no reference other than the unused constant.
12. The panel is created with `new Window("palette")` and `panel.show()`, so it opens as a floating window rather than a dockable panel. The builder panels use the `thisObj instanceof Panel` pattern, which docks correctly.
13. `index.ts` and every `.jsx` start with a UTF-8 byte order mark.
14. `list-presets` searches Windows `Program Files` roots and never the Mac application bundle.
15. The `JSON` shim is defined after the command functions but before they run, which works, but `JSON.stringify` in the shim ignores the `space` argument, and the shim has no `Object.keys`, `Array.prototype.indexOf` or `String.prototype.trim` polyfills. ES3 helpers are missing.
16. Both setup scripts run `git clone https://github.com/TheLlamainator/after-effects-mcp.git`, so setup installs the upstream code and ignores every change in this repository.
17. `HOW-TO-USE.txt` contains another person's Windows user folder in its paths.
18. README files describe and link to upstream.
19. No tests, no lint, no continuous integration, no ES3 check for the ExtendScript side.
20. Four panels are loose at the root with spaces in folder names. Their `.jsx` files contain no em dashes; their `GUIDE.md` files do.

## What is good and is kept

- The file bridge itself: no sockets, no native modules, works on Mac and Windows, survives After Effects restarts.
- `set-effect-property`'s keyframe graph options (speed, influence, interpolation, roving, spatial tangents) are correct and complete. They become the shared easing implementation.
- `listAvailableEffects` handles both `app.effects[i]` and `app.effects.effect(i)`.
- `analyzeWavAmplitudes` is a correct PCM WAV reader.
- `install-bridge.js` handles elevated copies on both platforms.
- The four builder panels: undo groups, `findProp` depth-first search, match-name fallback lists, and `thisObj` docking are all the right idioms and are reused in the bridge library.
