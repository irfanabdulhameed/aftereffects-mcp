# Agent guide

This guide is served by the `get-help` tool (whole text, or one section with `topic`). It is for the model driving After Effects through this server. Read it once per session.

## 1. How the bridge works and what that means for you

After Effects cannot run a network server, so this server talks to it through files. Every tool call writes one command file into a queue folder, a panel inside After Effects picks it up on its next poll (every 500 ms by default), runs it, and writes a result file. The server waits for that file and returns it to you.

What follows from that:

- Every call costs at least one poll interval plus the work itself. Ten calls cost ten round-trips. Prefer `batch`, `set-keyframes-bulk`, `set-keyframes-multi`, `apply-effects-bulk`, `add-markers-bulk` and `delete-layers` over loops of single calls.
- `batch` runs its steps inside one undo group. A title card built in one batch is one Cmd/Ctrl+Z for the human.
- Every tool waits for its result and returns the state it changed. Read it. Never assume a command worked; the result tells you the layer index, the keyframes written, the effect added, and any notes about things that were skipped.
- A timeout is not a failure of the command. If the error says `bridge-not-running`, the panel is closed or paused and nothing ran. If it says `timeout`, the command is still running inside After Effects; wait and call `get-results` with the id it gives you.
- Layer indices shift when layers are created, deleted or moved. After any of those, call `list-layers` again or address layers by `id` or `name`.

## 2. Addressing

Every tool that touches a composition takes `comp`; every tool that touches a layer takes `layer`.

- `comp`: `{id}` from `list-compositions`, or `{name}`, or nothing for the composition open in the viewer. Precedence: id, name, active. Names are matched exactly first, then case-insensitively.
- `layer`: `{index}` (1 is the top layer in the timeline), `{id}` (stable across reordering), or `{name}`. Precedence: index, id, name. A name that matches more than one layer is an error that lists the matches; use index or id then.
- Property paths use `/` between levels and accept display names or matchNames: `Transform/Position`, `Effects/Gaussian Blur/Blurriness`, `Text/Source Text`, `Masks/Mask 1/Mask Path`, `Contents/Group 1/Fill 1/Color`, or `ADBE Transform Group/ADBE Position`. A bare transform name such as `Opacity` also works. When a path is wrong the error lists the children of the deepest group that did resolve; use that list to fix the path.
- Effects are addressed by display name, matchName or 1-based index within the layer's effect stack. matchNames (`ADBE Gaussian Blur 2`) are the reliable form; `list-available-effects` gives them.
- Discover before you address: `get-project-info` for compositions and items, `list-layers` for indices and names, `get-layer-details` or `list-layer-effects` for property paths.

## 3. A standard workflow

1. `ping`. If it fails, tell the human to open Window > mcp-bridge-auto.jsx in After Effects and enable "Allow Scripts to Write Files and Access Network".
2. `get-project-info`, then `list-compositions`. Decide which composition you are working in, or `create-composition`.
3. `list-layers` on that composition. Note frame rate and size from `get-composition-info` if you will animate in frames.
4. Plan the build as a list of tool calls. Decide names for every layer you will create so later steps can address them by name.
5. Run the plan as one `batch` (or a few). Read every step's result.
6. `see-frame` at two or three times (the first frame, the middle of the entrance, the resting pose). Look at the image. Compare with what was asked.
7. Fix what is wrong with targeted calls, then `see-frame` again.
8. `save-project` when the human wants it saved, or when you are about to render.

Look at your work with `see-frame` before telling the human it is done. A description of what you did is not evidence; the frame is.

## 4. Units and coordinates

- Time: seconds in `time`, frames in `frame`. When both are given, `frame` wins. Frame numbers are integers counted from the composition start at the composition frame rate. Layer in and out points are in composition time.
- Space: pixels in composition space, origin at the top-left, x to the right, y down. A 1920 by 1080 composition has its centre at [960, 540]. Position is where the layer's anchor point sits in the composition.
- Anchor point: in the layer's own pixel space. Scaling and rotation pivot around it. Use `set-anchor-point` with named positions (`center`, `bottom-left`) and it keeps the layer where it is on screen.
- Scale is a percentage per axis: [100, 100] is unscaled. Rotation is in degrees, clockwise positive. Opacity is 0 to 100.
- Colours: every tool accepts `#RRGGBB`, `#RRGGBBAA`, `[r, g, b]` or `[r, g, b, a]` in 0 to 1 or 0 to 255, `{r, g, b, a}`, or a basic name. Results report colours as hex.
- Text size is in pixels, tracking in thousandths of an em, leading in pixels.
- Audio levels are in dB: 0 unity, -6 half, -48 near silence.

## 5. Animation craft

Short rules that make motion look intentional. Follow them unless the human asks for something else or a style file says otherwise.

- Entrances ease out (fast start, slow settle): easing `ease-out`. Exits ease in (slow start, fast leave): `ease-in`. Moves between two resting poses: `ease-in-out` or `ease`.
- Durations at 30 fps: 8 to 14 frames for small UI-style moves (a label sliding 40 px, an opacity fade), 18 to 30 frames for scene-scale moves (a card entering from off screen, a camera push). Scale for other frame rates.
- Stagger groups by 2 to 4 frames per item. A list of five lines enters over roughly 20 frames, not all at once and not one per second.
- Hold before you exit. Give a resting pose at least 12 frames before the exit begins.
- Never animate everything at once. One thing leads, the rest follows.
- Combine two properties for one motion: opacity plus a 30 to 60 px position offset reads better than either alone. Scale from 90 percent, not from 0, unless it is a pop.
- Use `set-keyframes-bulk` with an easing per key rather than many `set-keyframe` calls. Use `overshoot` on the arriving key for a playful settle; keep it off for corporate work.
- Prefer expressions for loops and secondary motion: `apply-expression-preset` with `loop-out-cycle`, `wiggle`, `inertia-bounce`, `follow-layer-with-delay`. They stay editable and cost nothing to retime.
- Put controls the human may want to tweak on a null: `create-null-layer`, `add-expression-control` (slider, colour, checkbox), then link with `link-to-slider`.
- Motion paths are straight lines by default (`spatial: "linear"`). Ask for `spatial: "auto"` only when you want curved paths through intermediate keys.
- Enable motion blur on fast moves: `set-layer-flags` with `motionBlur: true` and the composition switch in `set-composition-settings`.

## 6. Text

- Set the words and style first (`create-text-layer` with font, size, colour, tracking, justification), then animate. Restyling after animating can change the layout the animation was built around.
- Fonts are PostScript names (`Helvetica-Bold`, `Inter-SemiBold`). If a font is requested, check it with `list-fonts` (After Effects 24 or later); if a font was not applied, the result says so and shows the font actually used.
- Per-character, per-word or per-line motion is a text animator, not keyframed transforms: `add-text-animator` with a preset (`fade-in-by-character`, `slide-up-by-word`, `typewriter`, `blur-in-by-character`) and `direction`. Keyframed Position on the layer moves the whole block.
- Multi-line text: `\n` in the text. Paragraph text with wrapping: `boxSize`.
- Counters, timers and typewriter effects on Source Text: `apply-expression-preset` with `counter-number` or `typewriter-driver`.

## 7. Effects

- Not sure of a name: `list-available-effects` with a `query`. Use the returned matchName in later calls.
- Prefer `apply-effect-template` for common looks (shadows, glows, blurs, grain, vignette, wipes, tints). `list-effect-templates` shows the parameters.
- `apply-effect` is idempotent: applying `ADBE Gaussian Blur 2` to a layer that already has it returns the existing effect and updates its settings. Pass `allowDuplicate: true` only when you want two copies. Templates are not idempotent.
- Read property names from the result of `apply-effect` or `get-effect-properties` before `set-effect-property`. Nested controls can be given as `Group/Property`.
- Effect order matters. `reorder-effect` if a blur should come before a glow.
- Apply an effect to many layers at once with an adjustment layer (`create-adjustment-layer`) rather than copying it to each layer.

## 8. Reference and style

Working from a reference composition:

1. `snapshot-composition` on the reference. It returns every layer with transform values, keyframes (times, values, easing), expressions, effects and text styles.
2. Read the timings and easing values from the snapshot; reproduce them with `set-keyframes-bulk` (times shifted to your composition) and `apply-effect` with the same settings. `copy-keyframes` and `copy-effects` move them directly when the reference is in the same project.
3. `apply-snapshot` restores transform, effects and keyframes onto layers with matching names when you are rebuilding the same structure.

Working from a style file (the human sets `AE_MCP_STYLE_FILE`):

- `get-help` with topic `reference-and-style` shows the active style: named durations, easings, stagger, text styles, colours and free-text rules.
- Use `"@style.entrance"` anywhere an easing is accepted, `"@style.h1"` as the `style` of `create-text-layer` or `set-text-style`, and `"@style.brand"` for colours. The server substitutes the values before After Effects sees them.
- Follow the rules listed in the style summary. They override the craft defaults above.

## 9. Recovery

- `bridge-not-running`: the panel is closed, paused (Auto-run unticked) or file access is disabled. Nothing ran. Ask the human to open Window > mcp-bridge-auto.jsx. `get-bridge-status` shows the heartbeat age without waiting.
- `timeout`: the command is still running. Wait, then `get-results` with the id. Do not resend the command; it would run twice.
- Stale or surprising state: `list-layers` again. The human may have changed things between your calls.
- Expression error in a result (`expressionState.error`): the expression was set but After Effects disabled it. Fix the code and `set-expression` again, or `get-expression-errors` to find every broken expression in the comp.
- Effect not found: the name is wrong or a plugin is missing. `list-available-effects` with a query, or use the template's fallback (`deep-glow-with-fallback`).
- Wrong result from a mutating call: `undo` reverts exactly that call (or the whole batch). Then `list-layers` and try again.
- Versions do not match in `get-bridge-status`: tell the human to run `npm run build` and `npm run install-bridge`, then reopen the panel.
- `unsupported`: the feature needs a newer After Effects. Say so and offer the closest alternative the error names.

## 10. What not to do

- Do not call `run-extendscript` when a tool exists. It is disabled by default, it bypasses validation, and its results are unstructured.
- Do not create layers again on retry. If a call timed out, check `list-layers` (or `get-results`) first; the layer may already exist.
- Do not report success without a `see-frame`.
- Do not address layers by index right after creating, deleting or moving layers; use the names or ids from the results.
- Do not stack duplicate effects by re-applying templates on a retry; `list-layer-effects` first.
- Do not leave the composition in a strange state: restore the playhead with `set-current-time` if you moved it far, and do not leave test layers behind.
- Do not change the human's own layers without saying what you will change and why. Build alongside, then adjust on request.
