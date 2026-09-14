---
name: after-effects-mcp
description: Drive Adobe After Effects through the AfterEffectsMCP server. Use when the user asks to build, animate, edit, inspect or render anything in After Effects (compositions, layers, text, shapes, keyframes, effects, rigs, markers, audio sync).
---

# After Effects MCP

The `AfterEffectsMCP` server exposes about 190 tools that build and edit inside a running After Effects through a file bridge. A panel inside After Effects (Window > mcp-bridge-auto.jsx) executes them.

## Before anything

1. Call `ping`. If it fails, ask the user to open Window > mcp-bridge-auto.jsx and enable "Allow Scripts to Write Files and Access Network" (Preferences > Scripting & Expressions). Do not continue until ping succeeds.
2. Call `get-help` once (or with a topic such as `addressing`, `animation-craft`, `recovery`) for the full guide.

## Standard workflow

1. `get-project-info` and `list-compositions`: learn what exists and get composition ids.
2. `list-layers` on the target composition; `get-composition-info` for frame rate and size.
3. Plan every step and name every layer you will create.
4. Build with one `batch` (steps of tool name plus args) so it is one round-trip and one undo.
5. `see-frame` at two or three times and look at the image.
6. Fix, `see-frame` again, then `save-project` if asked.

Report done only after you have looked at a frame.

## Addressing

- `comp`: `{id}` or `{name}`; omit for the active composition.
- `layer`: `{index}` (1 is the top), `{id}` (stable), or `{name}`.
- Properties: `Transform/Position`, `Effects/Gaussian Blur/Blurriness`, `Text/Source Text`. Errors list the valid children.
- Indices shift after create, delete and move. Re-list or use names and ids.

## Units

Seconds in `time`, integer `frame` wins when both are given. Pixels with origin top-left. Scale in percent, rotation in degrees, opacity 0 to 100. Colours as `#RRGGBB`, `[r,g,b]` 0 to 1 or 0 to 255, or names.

## Animation rules

- Entrances: `ease-out`. Exits: `ease-in`. Moves between poses: `ease-in-out`.
- 8 to 14 frames for small UI moves, 18 to 30 for scene moves at 30 fps.
- Stagger items by 2 to 4 frames. Hold a resting pose at least 12 frames before an exit.
- One thing leads; do not animate everything at once. Pair opacity with a 30 to 60 px offset.
- `set-keyframes-bulk` with per-key `easing` instead of many single keys. `overshoot` only when playful.
- Loops and secondary motion are expressions: `apply-expression-preset` (`loop-out-cycle`, `wiggle`, `inertia-bounce`).
- Controls for the human go on a null with `add-expression-control`.
- Per-character text motion is `add-text-animator`, never keyframed transforms.

## Effects

`list-available-effects` when unsure of a name; use matchNames. `apply-effect-template` for shadows, glows, blurs, grain, vignette and wipes. `apply-effect` is idempotent; templates are not. Effect order matters (`reorder-effect`).

## Rigs

`rig-edge-glow`, `rig-power-warp-transition`, `rig-depth-map-blur-reveal`, `rig-blur-color-reveal` build the four studio rigs in one call. `list-rigs` explains their inputs.

## Recovery

- `bridge-not-running`: nothing ran; the panel is closed or paused.
- `timeout`: still running; wait, then `get-results` with the id. Never resend.
- Wrong result: `undo`, `list-layers`, retry.
- Expression error in a result: fix the code and set it again.
- Never use `run-extendscript` when a tool exists; it is off by default.

## Style file

If the user has a style file (`AE_MCP_STYLE_FILE`), `get-help` topic `reference-and-style` shows it. Use `"@style.entrance"` for easings, `"@style.h1"` for text styles and `"@style.brand"` for colours, and follow its rules.
