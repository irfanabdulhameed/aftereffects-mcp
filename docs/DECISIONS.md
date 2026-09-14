# Decisions

One line per judgement call, newest at the bottom. Phase numbers refer to `docs/PLAN.md`.

- P0: The audit and plan were written against the repository as committed on 2026-09-14 (commit b0e7731). No code was changed in Phase 0.
- P0: Development and builds were done in a local clone outside the OneDrive folder that holds the original files, because `node_modules` in a OneDrive path failed to populate and file reads timed out. The OneDrive copy is synced from GitHub after each push.
- P0: The bridge command name for every tool is the tool name converted from kebab-case to camelCase. No hand-maintained mapping table exists; a test asserts every tool that goes through the bridge has a matching registered command.
- P0: `convert-to-hold`, `convert-to-linear` and `convert-to-bezier` were merged into one `set-keyframe-interpolation` tool with a `type` argument, to keep the one-tool-one-command rule. Same for `enable-expression` and `disable-expression`, merged into `set-expression-enabled`.
- P0: `get-layer-clip-frames` is not kept as a tool. Its frame arithmetic is returned by `get-layer-details` and by every tool that changes timing.
- P0: The panel `.jsx` files contain no em dashes and are moved byte-identical. The four `GUIDE.md` files do contain em dashes and are edited in Phase 6 as the task allows.
