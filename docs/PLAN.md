# Plan

This is the target for the overhaul. `docs/AUDIT.md` describes the starting point. `docs/DECISIONS.md` records every judgement call made along the way.

## Target folder tree

```
.
├── README.md                      user-facing README
├── LICENSE                        MIT, upstream attribution kept
├── CHANGELOG.md
├── package.json                   root workspace, scripts delegate to /server
├── .github/workflows/ci.yml       install, lint, build, test on push and pull request
├── .claude/skills/after-effects-mcp/SKILL.md
├── docs/
│   ├── AUDIT.md
│   ├── PLAN.md
│   ├── DECISIONS.md
│   ├── ARCHITECTURE.md
│   ├── TOOLS.md                   generated, never hand-edited
│   ├── AGENT-GUIDE.md             served by get-help
│   ├── TROUBLESHOOTING.md
│   ├── CONTRIBUTING.md
│   ├── style-file.example.json
│   └── media/                     demo.gif placeholder, panel stills
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── install-bridge.js
│   ├── src/
│   │   ├── index.ts               creates the server, registers tool groups, starts stdio
│   │   ├── bridge/
│   │   │   ├── client.ts          writeCommand, waitForResult, queue, ids, timeouts, cleanup
│   │   │   ├── paths.ts           bridge directory resolution and env overrides
│   │   │   └── types.ts           Command, Result, BridgeError
│   │   ├── tools/
│   │   │   ├── registry.ts        registerAllTools(server), defineTool helper
│   │   │   ├── project.ts
│   │   │   ├── composition.ts
│   │   │   ├── layers.ts
│   │   │   ├── transform.ts
│   │   │   ├── keyframes.ts
│   │   │   ├── expressions.ts
│   │   │   ├── text.ts
│   │   │   ├── shapes.ts
│   │   │   ├── masks.ts
│   │   │   ├── effects.ts
│   │   │   ├── presets.ts
│   │   │   ├── camera-3d.ts
│   │   │   ├── time.ts
│   │   │   ├── markers-audio.ts
│   │   │   ├── render.ts
│   │   │   ├── batch.ts
│   │   │   ├── rigs.ts
│   │   │   └── help.ts            get-help, list-tools, prompts, resources
│   │   ├── schemas/
│   │   │   ├── common.ts          CompRef, LayerRef, PropertyPath, Easing, Color, Vec2, Vec3, TimeArgs
│   │   │   ├── color.ts           colour normalisation (hex, 0-255, 0-1)
│   │   │   └── style.ts           style file loader and @style references
│   │   └── scripts/               ExtendScript, assembled into one panel file at build time
│   │       ├── panel/mcp-bridge-auto.jsx      UI and polling loop only
│   │       ├── lib/polyfills.jsx
│   │       ├── lib/json.jsx
│   │       ├── lib/core.jsx       MCP namespace, command registry, error shaping, time helpers
│   │       ├── lib/resolve.jsx    comp, layer, property resolvers
│   │       ├── lib/undo.jsx
│   │       ├── lib/easing.jsx     named easing presets to KeyframeEase arrays
│   │       ├── lib/color.jsx
│   │       ├── lib/serialize.jsx  layer, property, keyframe summaries returned by every command
│   │       └── commands/
│   │           ├── project.jsx
│   │           ├── composition.jsx
│   │           ├── layers.jsx
│   │           ├── transform.jsx
│   │           ├── keyframes.jsx
│   │           ├── expressions.jsx
│   │           ├── text.jsx
│   │           ├── shapes.jsx
│   │           ├── masks.jsx
│   │           ├── effects.jsx
│   │           ├── presets.jsx
│   │           ├── camera-3d.jsx
│   │           ├── time.jsx
│   │           ├── markers-audio.jsx
│   │           ├── render.jsx
│   │           ├── batch.jsx
│   │           ├── utilities.jsx
│   │           └── rigs/
│   │               ├── edge-glow.jsx
│   │               ├── power-warp-transition.jsx
│   │               ├── depth-map-blur-reveal.jsx
│   │               └── blur-color-reveal.jsx
│   ├── scripts/
│   │   ├── build-bridge.js        concatenates lib + commands + panel into build/scripts/mcp-bridge-auto.jsx
│   │   ├── lint-es3.js            fails on ES5+ syntax in .jsx
│   │   ├── gen-tools-doc.js       writes docs/TOOLS.md from the registered tools
│   │   └── smoke.js               human smoke test against a real After Effects
│   └── test/
│       ├── unit/                  schemas, easing, colour, property paths, doc generator
│       ├── bridge/                client against the mock bridge
│       └── bridge-mock/mock-ae.js a Node process that answers commands like After Effects would
├── panels/
│   ├── README.md
│   ├── edge-glow/                 Edge Glow.jsx, GUIDE.md
│   ├── power-warp-transition/
│   ├── depth-map-blur-reveal/
│   └── blur-color-reveal/
├── setup/
│   ├── setup-mac.sh               uses ./server, never clones upstream
│   ├── setup-windows.ps1
│   └── README.md
├── legacy/
│   └── standalone-scripts/        the ten dead src/scripts/*.jsx files with a note
└── examples/
    ├── 01-title-card.md
    ├── 02-lower-third.md
    ├── 03-logo-reveal-with-edge-glow.md
    └── 04-audio-driven-markers.md
```

## Final tool list

One kebab-case tool name maps to exactly one camelCase bridge command. The bridge command is the tool name converted to camelCase, so the mapping needs no table. Tools that run entirely on the Node side (preset search, waveform analysis, help) have no bridge command.

### Project (16)

get-project-info, save-project, save-project-as, new-project, open-project, list-project-items, create-folder, move-item-to-folder, rename-item, delete-item, import-file, import-files-bulk, replace-footage, reduce-project, remove-unused-footage, collect-files

### Composition (12)

create-composition, get-composition-info, set-composition-settings, list-compositions, duplicate-composition, rename-composition, delete-composition, set-work-area, set-current-time, precompose, open-composition-in-viewer, crop-composition-to-region

### Layers (31)

list-layers, get-layer-details, create-text-layer, create-shape-layer, create-solid-layer, create-adjustment-layer, create-null-layer, create-camera-layer, create-light-layer, add-footage-to-composition, add-composition-as-layer, duplicate-layer, delete-layer, delete-layers, rename-layer, move-layer, set-layer-parent, clear-layer-parent, set-layer-flags, set-layer-blend-mode, set-layer-label-color, set-layer-track-matte, set-layer-quality, set-layer-timing, split-layer-at-time, align-layers, distribute-layers, center-layers, sequence-layers, select-layers, get-selected-layers

### Transform and properties (7)

get-property-value, set-property-value, set-transform, set-anchor-point, fit-layer-to-composition, get-layer-bounds, separate-dimensions

### Keyframes (14)

set-keyframe, set-keyframes-bulk, set-keyframes-multi, get-keyframes, delete-keyframe, delete-keyframes-in-range, clear-keyframes, move-keyframes, set-keyframe-easing, copy-keyframes, reverse-keyframes, set-keyframe-interpolation (hold, linear, bezier), bake-expression-to-keyframes, stagger-keyframes-across-layers

### Expressions (8)

set-expression, get-expression, remove-expression, set-expression-enabled, get-expression-errors, apply-expression-preset, list-expression-presets, add-expression-control

### Text (12)

set-text, get-text, set-text-style, list-fonts, add-text-animator, list-text-animator-presets, add-text-range-selector, set-range-selector, add-text-wiggly-selector, add-text-expression-selector, convert-text-to-shapes, set-text-box

### Shapes (8)

add-shape-to-layer, set-shape-fill, set-shape-stroke, set-shape-path, add-shape-modifier, animate-trim-paths, add-repeater, list-shape-groups

### Masks (7)

create-mask, list-masks, set-mask-properties, set-mask-path-keyframe, delete-mask, create-mask-from-shape-layer, mask-reveal-animation

### Effects and presets (19)

apply-effect, apply-effects-bulk, list-layer-effects, list-available-effects, get-effect-properties, set-effect-property, set-effect-properties, set-effect-keyframe, remove-effect, remove-all-effects, reorder-effect, toggle-effect, copy-effects, apply-effect-template, list-effect-templates, list-presets, search-presets, apply-preset, save-preset

### Camera, lights, 3D (6)

set-camera-settings, animate-camera, set-light-settings, set-layer-3d, set-material-options, look-at-layer

### Time (7)

enable-time-remap, set-time-remap-keyframes, freeze-frame-at, set-speed, reverse-layer, set-frame-blending, loop-layer

### Markers and audio (10)

add-marker, add-markers-bulk, list-markers, delete-marker, clear-markers, get-audio-info, set-audio-levels, analyze-audio-waveform, audio-to-keyframes, markers-from-beats

### Render and preview (10)

see-frame, see-frames, add-to-render-queue, list-render-queue, clear-render-queue, render, export-frame-png, export-still-sequence, list-output-module-templates, list-render-settings-templates

### Rigs (5)

rig-edge-glow, rig-power-warp-transition, rig-depth-map-blur-reveal, rig-blur-color-reveal, list-rigs

### Batch, workflow, utilities (17)

run-extendscript, batch, undo, redo, get-ae-version, get-bridge-status, ping, set-bridge-options, snapshot-composition, apply-snapshot, find-layers, find-and-replace-text, replace-color, relink-fonts, get-results, get-help, list-tools

Total: 189 tools. The acceptance target is 90 or more.

### Removed from the starting set

run-script, test-animation, add-any-effect, mcp_aftereffects_applyEffect, mcp_aftereffects_applyEffectTemplate, mcp_aftereffects_get_effects_help, run-bridge-test, get-layer-clip-frames (folded into get-layer-details), setLayerKeyframe (renamed set-keyframe), setLayerExpression (renamed set-expression).

## Implementation order

1. Phase 0. This plan, the audit. Commit `chore: audit and plan`.
2. Phase 1. Move files into the target tree. Split the bridge into lib, commands, panel and write `build-bridge.js` so the assembled file is byte-for-byte the same behaviour as before. Root `package.json`. Fix setup scripts and `install-bridge.js`. Move the dead scripts to `legacy/`. Rewrite `HOW-TO-USE.txt` out of existence. Commit `refactor: reorganise repository into server, panels, setup, docs`.
3. Phase 2. New bridge client with ids and a queue directory. New panel loop with atomic file handoff, undo groups, error shaping, heartbeat, options file. Shared resolvers and easing library in ExtendScript. Shared zod schemas. `defineTool` helper. Port the existing commands onto the new foundation. Mock bridge and the first tests. Commit `feat(bridge): command ids, queue, shared resolvers, easing presets, undo groups`.
4. Phase 3. Implement the tool groups above, one file pair per group, in this order: utilities and batch (so everything after can be tested through `batch`), composition, layers, transform, keyframes, expressions, effects and presets, text, shapes, masks, markers and audio, time, camera, render and see-frame, project, rigs. Each group ships with mock-bridge tests. Commit `feat(tools): ...` per group or as one commit for the phase.
5. Phase 4. Agent guide, `get-help` from disk with topics, prompts, resources, style file, Claude Code skill. Commit `feat: agent guide, prompts, resources, style file hook, Claude Code skill`.
6. Phase 5. Unit tests for every schema, easing mapping, colour conversion, property path parsing, doc generator. ES3 lint. Bridge assembly parse test. Smoke script. Continuous integration. Commit `test: mock bridge, unit tests, ES3 lint, continuous integration`.
7. Phase 6. README, ARCHITECTURE, TOOLS (generated), TROUBLESHOOTING, CONTRIBUTING, panels README, setup README, guides without em dashes, CHANGELOG, examples. Commit `docs: rewrite README, add architecture, tools reference, troubleshooting, contributing`.

## Conventions fixed now

- Tool names: kebab-case. Bridge commands: the same name in camelCase.
- Every tool that targets a layer takes `comp` (CompRef, optional, defaults to the active composition) and `layer` (LayerRef).
- Times are seconds in `time`; an integer `frame` wins when both are given.
- Colours: every tool input accepts hex (`#RRGGBB`, `#RRGGBBAA`), `[r,g,b]` or `[r,g,b,a]` in 0-1 or 0-255, or `{r,g,b,a}`. The server normalises to `[r,g,b,a]` in 0-1 before the bridge sees it.
- Angles in degrees, scale in percent, pixels in composition space with origin top-left.
- Every mutating command runs in one undo group named `MCP: <command>` and returns the changed state.
- ExtendScript is ECMAScript 3 only, enforced by `npm run lint`.
