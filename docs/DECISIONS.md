# Decisions

One line per judgement call, newest at the bottom. Phase numbers refer to `docs/PLAN.md`.

- P0: The audit and plan were written against the repository as committed on 2026-09-14 (commit b0e7731). No code was changed in Phase 0.
- P0: Development and builds were done in a local clone outside the OneDrive folder that holds the original files, because `node_modules` in a OneDrive path failed to populate and file reads timed out. The OneDrive copy is synced from GitHub after each push.
- P0: The bridge command name for every tool is the tool name converted from kebab-case to camelCase. No hand-maintained mapping table exists; a test asserts every tool that goes through the bridge has a matching registered command.
- P0: `convert-to-hold`, `convert-to-linear` and `convert-to-bezier` were merged into one `set-keyframe-interpolation` tool with a `type` argument, to keep the one-tool-one-command rule. Same for `enable-expression` and `disable-expression`, merged into `set-expression-enabled`.
- P0: `get-layer-clip-frames` is not kept as a tool. Its frame arithmetic is returned by `get-layer-details` and by every tool that changes timing.
- P0: The panel `.jsx` files contain no em dashes and are moved byte-identical. The four `GUIDE.md` files do contain em dashes and are edited in Phase 6 as the task allows.
- P1: The compiled entry point moves from `ae-mcp-setup/after-effects-mcp/build/index.js` to `server/build/index.js`. It is still `build/index.js` relative to the server package, but anyone with an existing `claude mcp add` entry must re-run setup or point it at the new path.
- P1: Root `package.json` uses npm workspaces with `server` as the only workspace, so one `npm install` at the root installs everything and CI can run `npm ci` once. The server's own `package-lock.json` was removed in favour of the root lock file.
- P1: The bridge assembler concatenates `lib/` in a fixed order (polyfills, json, core, color, undo, resolve, serialize, easing, then any others alphabetically), then `commands/**` sorted by path, then the panel. Every included file is marked with a `/* ---- path ---- */` banner so runtime error line numbers can be traced back.
- P1: The split of the old bridge into files kept every function unchanged except two lint fixes: a trailing comma in the `curves` template object and an em dash in a comment. Behaviour is identical.
- P1: The ten dead standalone scripts were moved to `legacy/standalone-scripts/` rather than deleted, with a README explaining they are not built.
- P1: Byte order marks were stripped from every moved source file.
- P1: The panel `.jsx` and `GUIDE.md` files were moved byte-identical. Panel folder names use kebab-case; the `.jsx` file names keep their spaces because After Effects shows the file name in the Window menu and the guides refer to it.
- P2: Commands are one file each under `queue/`, named `cmd-<ms>-<seq>-<id>.json`, written to a temp name and renamed so the panel never reads a partial file. The panel renames a file to `running-` before executing it, so a crash cannot re-run a mutating command; leftover `running-` files are turned into "interrupted" error results when the panel starts.
- P2: Result files are kept in `results/` so `get-results` can fetch them by id, and removed by the server on start when older than `AE_MCP_RESULT_MAX_AGE_MS` (default one hour).
- P2: On timeout, if the command file is still pending the server deletes it and reports `bridge-not-running`, so a command never runs minutes later when the panel opens. If the panel already picked it up, the server reports `timeout` with the id and leaves it running.
- P2: Easing describes the segment that arrives at a keyframe: it sets the out handle of the previous key and the in handle of the key. Presets use CSS-style naming (ease-out is slow at the end, the right default for entrances). Cubic-bezier is approximated per segment as influence = x1 * 100 and (1 - x2) * 100 with speeds from the handle slopes and the segment's value delta; values of y outside 0 to 1 are not representable.
- P2: Spatial keyframes (Position, Anchor Point) get zero spatial tangents by default so motion paths are straight lines; `spatial: "auto"` keeps After Effects auto-bezier.
- P2: Colours are normalised on the Node side by a zod transform, so every bridge command receives `[r, g, b, a]` in 0 to 1. The bridge also has `MCP.color.rgba` as a safety net and for the rig commands.
- P2: `@style.*` references are resolved on the Node side before validation, so the panel never sees them.
- P2: The effect template names exist in both `server/src/tools/effects.ts` (as the enum the model sees) and `commands/effects.jsx` (the implementation). A unit test fails if the two lists differ.
- P2: Drop Shadow opacity is written as `percent * 2.55` because the effect stores 0 to 255 when set by script, as found while building the Edge Glow panel. Unverified on other versions.
- P2: `run-extendscript` exists but is refused unless `AE_MCP_ALLOW_RAW_SCRIPT=1`; the tool description says so.
- P2: Tools are registered with `registerTool` (the SDK deprecated `server.tool`) with `readOnlyHint` and `destructiveHint` annotations derived from the `mutating` flag.
- P2: The panel handles up to 20 queued commands per tick and stops after 4 seconds so the After Effects UI stays responsive; it writes `heartbeat.json` at most every 2 seconds.
- P2: The panel uses the `thisObj instanceof Panel` pattern from the builder panels so it docks like a normal ScriptUI panel.
- P2: The old `run-script`, `test-animation`, `run-bridge-test`, `add-any-effect`, `mcp_aftereffects_*` and `get-layer-clip-frames` tools are gone as planned in `docs/PLAN.md`. The `_responseTimestamp` and `_commandExecuted` fields no longer exist; results carry `id`, `command`, `status`, timing and versions.
- P2: Effect matchNames used by the templates (for example `ADBE VR Chromatic Aberrations`, `CC Vignette`, `frameFX/enabled` for the outline layer style) could not be verified against a running After Effects during this work. Each template fails with an "unsupported" error naming the effect if it cannot be added.
