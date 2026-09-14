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
