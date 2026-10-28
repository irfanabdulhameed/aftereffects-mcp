# Changelog

## 2.6.2 (2026-10-28)

import-figma builds an organised project instead of one flat comp:

- Every Figma frame or instance with content is its own comp, nested like the design (a frame's clipping comes with its comp); layout-only wrappers are skipped.
- Readable names: cards and panels after their heading, rows after their parts, Title, Description, Value, Icon, Background, Edge fade left and right instead of auto names; colour labels for comps, text, shapes and overlays.
- Project folders mirror the page (Figma · <frame> / Components / <part> / …, Images).
- Per-side strokes (a rule under a table row) and inside strokes drawn above their fill; image fills can come from local files (`images`), so a frame exported from the Figma app needs no API; fetched frames are cached and a rate-limited API falls back to the cache.

## 2.6.1 (2026-10-28)

- import-figma rebuilds linear and radial gradient fills (fades to transparent included) with Gradient Ramp, kept inside the shape and following the layer, instead of drawing their first colour; a frame without a fill gets a white comp background like the Figma canvas.

## 2.6.0 (2026-10-28)

Eleven new tools, 278 in all; the core stays at 62.

- Icons: `add-icon` draws Lucide, Material Symbols and Phosphor icons as real vector shape layers (stroke widths, round caps, duotone tints kept), fetched once from jsDelivr at pinned versions and cached in the bridge folder; `search-icons` finds names by words. `shape-from-svg-path` takes `lineCap`, `lineJoin` and `groupOpacity`.
- `smart-animate`: keys the change between two state comps like Smart Animate in Figma. Layers pair by name; every differing property gets two landing-eased keys, new layers fade in, missing ones fade out. A copy of the start comp is animated by default.
- Camera rigs: `create-camera-rig` (a control null with Orbit, Tilt, Roll, Push, Truck, Pedestal, Drift and depth-of-field controls, and a one-node camera with a lens from a focal length) and `animate-camera-rig` (one control per move, so moves overlap without middle keys; rack-focus measures the new layer's distance).
- Looks pack: `apply-look` (tight plus wide glow, bloom, mono grain, vignette, light sweep, frosted glass, 6 % soft UI shadow, motion blur) and `create-background` (mesh gradient, aurora, grid, dots, noise, grain; every one loops seamlessly).
- Export: `export-video` (mp4, ProRes 422 and 4444, gif, webm) and `export-preview` (a small fast-start mp4 for a phone) render with aerender in the background at low priority, ffmpeg converting where needed; `get-export-status` follows the jobs.
- Figma pack: `import-figma` rebuilds a Figma frame as editable layers from a link and token (`FIGMA_TOKEN`) or a saved REST JSON: shapes, Figma's own vector geometry, box text with font metrics, image fills, drop shadows as layer styles, layer and background blur.

## 2.5.0 (2026-10-28)

A component library that works from a synced folder, and Live View. 267 tools, 62 of them in the core.

- `save-to-library` saves a composition and everything it uses as its own project in the library (`<Category>/<Name>/<Name>.aep`), copies its footage beside it, takes a poster frame and updates `library.json` and the README parts table. The open project is imported into a new project and reduced, so the original file is never written.
- `remove-from-library` deletes a part and its entry.
- Libraries in OneDrive, iCloud Drive or Dropbox can stay online-only. `library.json` entries are used as written (a part's `component.json` is only read for parts the index does not list), `insert-library-component` downloads a part and its footage before After Effects opens it and reports what it downloaded, transient sync errors are retried, and an index that is slow to download falls back to the server's last copy instead of hanging. `library.json` and `README.md` are written in place, so "Always Keep on This Device" stays set. New setting `AE_MCP_LIBRARY_WAIT_MS` (default 20000).
- Live View (macOS): a native plug-in (`native/live-view`) keeps the active composition's current frame in the bridge folder. `see-live` (core) returns it without a script or a render; it waits for a picture drawn after the last change made through the server and says when none came. `live-view-settings` switches it and sets its size and budget. The bridge panel shows a Live row.

## 2.4.0 (2026-10-28)

A smaller tool list for every client.

- Packs: 61 core tools are always on; every other group is a pack. `tool-packs` lists packs and switches them on or off (one tools/list_changed notice), `call-tool` runs any tool whose pack is off, `list-tools` shows which tools are active and their input schemas on request. `AE_MCP_TOOLS` picks what is on at start: `core` (default), `all`, or a comma list of packs.
- Shorter definitions: the shared composition, layer, easing, colour and property path inputs carry one short description instead of one per field, and clients get each description without its Inputs and Example parts (the full text stays in docs/TOOLS.md and list-tools). The core list is about 40k tokens; all 263 tools about 196k, down from about 255k.
- The server sends instructions on connect that point the agent to packs and get-help.
- Pie and donut percent labels always add up to 100 (largest remainder), so 37.5 / 62.5 reads 38 % and 62 %, not 38 % and 63 %.

## 2.3.0 (2026-10-28)

32 new tools, 261 in all.

- Scene planning (6): create-scene-plan, list-scenes, set-scene-duration, insert-scene, remove-scene, add-reference-overlay. A film as a master comp of scene comps, retimed without re-keying.
- Transitions (4): add-transition (match cut, push, whip, zoom-through, mask reveal and more), carry-element (one element carried across a cut), list-transitions, remove-transition. Scenes keep covering the frame through every move.
- UI demo kit (6): cursor-journey, scroll-in-window, focus-on-region, device-frame, highlight-region, add-toast.
- Motion rigs (9): number-counter, grid-layout (grids and bento layouts that reflow), proximity-effector, follow-chain, clone-array, shape-morph, wiggle-rig, sway-loop, fit-to-box. Controls on a null, expressions that stack.
- Charts (7): create-bar-chart, create-line-chart, create-pie-chart, create-stat, create-progress, update-chart-data, get-chart-data. Data from JSON or CSV, values as sliders, animated changes.
- see-frame and see-frames show transparent areas over the composition background colour, as the viewer does (`flatten: false` keeps the alpha).
- audit-composition no longer reports copies placed by an expression rig as loose copies.
- Fixes found in a live After Effects 26.5 test: create-component keeps the instance in place when it crops (After Effects re-centres the anchor when a comp is resized); see-frame waits for frames, which After Effects writes after the script returns; text animators add their properties before setting them; Star and Polygon types; the new-blur default; .mogrt export references.

## 2.2.0 (2026-10-27)

36 new tools, 229 in all.

- Components and templates (9): create-component, add-essential-property, list-essential-properties, set-component-values, add-component-instances, set-responsive-time, export-component-template, list-library-components, insert-library-component.
- Animation shortcuts (9): animate-property, add-entrance, add-exit, typewriter-text, word-by-word-reveal, press, move-along-path, play-at-markers, add-camera-push. Few eased keyframes, text animators and expressions; never a key on every frame.
- Layer styles (4): add-layer-style, set-layer-style, remove-layer-style, list-layer-styles.
- Project check (4): audit-composition, purge-caches, save-version, organize-project.
- Shapes (3): import-vector-as-shapes, set-shape-gradient, shape-from-svg-path (SVG path data parsed on the server).
- Text (4): set-text-on-path, set-per-character-3d, add-text-box, fit-text-to-box.
- Camera, lights and 3D (3): set-composition-renderer, set-extrusion, add-environment-light.
- Fixes: apply-preset now selects only its layer (After Effects applies presets to the selected layers); the "outline" effect template adds its Stroke style through the layer-styles code; property serializers never read a shape gradient's colour stops, which raises a dialog scripts cannot catch.

## 2.1.0 (2026-10-27)

The AE guard: After Effects keeps running through long and unattended sessions on macOS.

- One driver at a time: `driver.lock` in the bridge folder, re-entrant per process, taken over when its process has died.
- Fail-fast errors before a command is queued: `ae-not-running`, `dialog-open`, `panel-not-running`, `ae-busy`; timeouts say what After Effects is doing.
- New tools: `get-ae-status`, `reload-bridge-panel` (loads a new panel version without restarting After Effects), `rearm-bridge-panel`, `dismiss-ae-dialog`.
- Optional automatic closing of plain message boxes (off by default; `AE_MCP_ALLOW_DIALOG_DISMISS=1` or `guard-options.json`), never while After Effects is in front and never for dialogs with input fields.
- `ae-do`: runs `.jsx` files by DoScript through the same guard, with alerts suppressed and errors returned as text.
- The panel runs every command with dialogs suppressed, reports which command is running, and shows the driver, the last command and outside script runs; a timer throttle makes stray timers harmless.
- A native helper (`ae-guard`, built with swiftc) reads windows and dialogs through Accessibility without activating After Effects.
- README: how-it-works and guard diagrams; placeholder images removed.

## 2.0.0 (2026-09-14)

A rewrite into a full After Effects MCP server. Organised by the phases in `docs/PLAN.md`.

### Audit and plan

- `docs/AUDIT.md` records every tool, bridge command, addressing style, undo and easing gap in the starting repository, and the plumbing defects found.
- `docs/PLAN.md` fixes the target tree, the final tool list and the implementation order. `docs/DECISIONS.md` records every judgement call.

### Repository reorganisation

- The server moved from `ae-mcp-setup/after-effects-mcp` to `server/`; the entry point is `server/build/index.js`.
- The four builder panels moved, byte-identical, to `panels/<kebab-name>/` with their guides.
- Setup scripts moved to `setup/` and now install this repository's server.
- `HOW-TO-USE.txt`, which contained another person's paths, was removed. Byte order marks were stripped.
- The ten dead standalone scripts moved to `legacy/standalone-scripts/`.
- The bridge panel is assembled at build time from `server/src/scripts/{lib,commands,panel}` by `server/scripts/build-bridge.js`.
- Root `package.json` with npm workspaces; `npm run build`, `lint`, `test`, `gen-docs`, `install-bridge`, `smoke` from the root.

### Bridge plumbing

- Every command has an id; results are matched on it. No more command-name matching or modification-time heuristics.
- A queue directory of `cmd-*.json` files replaces the single command file; a results directory replaces the single result file. Files are written atomically and commands are renamed to `running-` while executing; interrupted commands are reported instead of re-run.
- Timeouts distinguish "never picked up" (`bridge-not-running`, command removed) from "still running" (`timeout`, fetch later with `get-results`).
- Every command runs inside one undo group named `MCP: <command>`; `batch` is one undo step.
- Errors carry `code`, `line`, `fileName`, `command`, `id` and structured `details` such as the list of available layers.
- Poll intervals and timeouts are configurable through environment variables and `set-bridge-options`; the panel writes a heartbeat.
- Shared resolvers for compositions (id, name, active), layers (index, id, name), properties (display-name or matchName paths), effects and project items, with errors that list what exists.
- One easing schema for every keyframe: presets, custom speed and influence, cubic-bezier approximation, straight spatial paths by default, overshoot.
- Colours accepted in every form and normalised to `[r, g, b, a]`.
- The panel docks like a normal ScriptUI panel and shows a log, counters and the bridge folder.

### Tool surface

- 30 tools (5 of them duplicates) became 189, grouped by project, composition, layers, transform, keyframes, expressions, text, shapes, masks, effects, presets, camera and 3D, time, markers and audio, render and preview, rigs, and workflow.
- `batch` runs many tool calls in one round-trip. `*-bulk` and `*-multi` tools cover the common many-at-once cases.
- `see-frame` and `see-frames` return PNG images so the agent can look at its own work.
- 33 effect templates, 21 expression presets, 12 text animator presets, shape modifiers, masks with reveal animations, camera moves, time remapping helpers, beat markers, audio to keyframes, snapshots, find and replace across a project.
- The four builder panels exist as `rig-*` tools with every panel parameter.
- Duplicated and human-in-the-loop tools (`run-script`, `test-animation`, `run-bridge-test`, `add-any-effect`, `mcp_aftereffects_*`) were removed.

### Agent guidance

- `docs/AGENT-GUIDE.md`, served by `get-help` with topics; MCP resources for the project, compositions, layers, fonts, effects, rigs, help and style; seven MCP prompts for common builds.
- Optional style file (`AE_MCP_STYLE_FILE`) with `@style.*` references for easings, text styles and colours.
- A Claude Code skill in `.claude/skills/after-effects-mcp/SKILL.md`.

### Tests and tooling

- A mock After Effects bridge, unit tests for schemas, easing, colour and the tool catalog, tool tests through the MCP server, an ES3 lint for every `.jsx`, a parse test of the assembled panel, a smoke test for a real After Effects, and GitHub Actions on Node 20 and 22 across Ubuntu and Windows.

### Documentation

- New README, `docs/ARCHITECTURE.md`, generated `docs/TOOLS.md`, `docs/TROUBLESHOOTING.md`, `docs/CONTRIBUTING.md`, `panels/README.md`, `setup/README.md`, four example transcripts, and the panel guides without em dashes.

## 1.0.0

The starting point: a small MCP server wrapped in a setup folder, with four builder panels at the repository root. 30 tools, one command file, one result file, no tests.
