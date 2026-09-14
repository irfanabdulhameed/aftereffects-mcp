# Changelog

## 2.0.0 (2026-09-14)

A rewrite of the fork into a full After Effects MCP server. Organised by the phases in `docs/PLAN.md`.

### Audit and plan

- `docs/AUDIT.md` records every tool, bridge command, addressing style, undo and easing gap in the starting repository, and the plumbing defects found.
- `docs/PLAN.md` fixes the target tree, the final tool list and the implementation order. `docs/DECISIONS.md` records every judgement call.

### Repository reorganisation

- The server moved from `ae-mcp-setup/after-effects-mcp` to `server/`; the entry point is `server/build/index.js`.
- The four builder panels moved, byte-identical, to `panels/<kebab-name>/` with their guides.
- Setup scripts moved to `setup/` and now install this repository's server instead of cloning the upstream one.
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

The starting point: a fork of TheLlamainator/after-effects-mcp (itself based on Dakkshin/after-effects-mcp) wrapped in a setup folder, with four builder panels at the repository root. 30 tools, one command file, one result file, no tests.
