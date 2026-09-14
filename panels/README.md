# Builder panels

This folder holds four After Effects ScriptUI panels. Each one is a small form that builds a complete effect rig in the open composition with one click, inside one undo step.

| Folder | Panel file | What it builds | MCP tool with the same logic |
|---|---|---|---|
| `edge-glow/` | `Edge Glow.jsx` | A rounded-rectangle badge with a glowing gradient rim, an animated light sweep and a soft coloured halo | `rig-edge-glow` |
| `power-warp-transition/` | `Power Warp Transition.jsx` | A depth-map driven transition: gradient wipe, glowing scan line, warp, chromatic aberration, shake and fine distortions | `rig-power-warp-transition` |
| `depth-map-blur-reveal/` | `Depth Map Blur Reveal.jsx` | An image that resolves out of a depth-weighted blur, lifted by exposure and a fading glow | `rig-depth-map-blur-reveal` |
| `blur-color-reveal/` | `Blur Color Reveal.jsx` | A soft two-tone colour disc that blooms outward to reveal the content underneath | `rig-blur-color-reveal` |

Each folder also has a `GUIDE.md` with the panel's own instructions and the values it uses.

## What a panel is

A ScriptUI panel is a `.jsx` file that After Effects loads as a dockable window. It draws its controls with ScriptUI (text fields, checkboxes, dropdowns, a build button) and runs ExtendScript against the open project when you press the button. It does not need the MCP server, the bridge or any other file: each panel is self-contained and ships with its own copies of the helper functions it uses.

## Installing a panel

The steps are the same for all four.

1. Copy the `.jsx` file into the ScriptUI Panels folder of your After Effects install.
   - macOS: `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`
   - Windows: `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`
2. In After Effects open Settings (Preferences) > Scripting and Expressions and enable "Allow Scripts to Write Files and Access Network".
3. Restart After Effects. The panel is listed at the bottom of the Window menu under its file name. Open it and dock it like any other panel.

To try a panel without installing it, use File > Scripts > Run Script File and pick the `.jsx`. It opens as a floating window instead of a dockable panel.

Every panel has a "Guide" button in its top right corner that shows the same instructions inside After Effects.

## Panels and rig tools are the same logic in two forms

The MCP server exposes one tool per panel (`rig-edge-glow`, `rig-power-warp-transition`, `rig-depth-map-blur-reveal`, `rig-blur-color-reveal`) plus `list-rigs`, which describes them. The ExtendScript for those tools lives in `server/src/scripts/commands/rigs/`:

| Command file | Registers |
|---|---|
| `_shared.jsx` | the helpers every rig uses (`MCP.rigs.setBy`, `setExpr`, `addEffect`, `easeKeys`, `easeKey`, `ramp`, `bell`, `makeRoundRect`, `makeEllipse`, `setAlphaMatte`) and the `MCP.rigs.catalog` that `list-rigs` returns |
| `edge-glow.jsx` | `rigEdgeGlow` |
| `power-warp-transition.jsx` | `rigPowerWarpTransition` |
| `depth-map-blur-reveal.jsx` | `rigDepthMapBlurReveal` |
| `blur-color-reveal.jsx` | `rigBlurColorReveal` |
| `list-rigs.jsx` | `listRigs` |

A rig command and its panel build the same layers with the same names, the same effects in the same order and the same values. The differences are only in how inputs arrive:

- A panel reads its form. A tool takes the same values as arguments, each with the panel's default.
- A panel that finds no open composition creates one. A tool requires a composition (the active one by default) and fails if there is none.
- A panel that works on the selected layers takes explicit layer references instead (`layer`, `layers`, `outgoing`, `depth`, `incoming`, `depthLayer`).
- A panel opens its own undo group. A rig command does not: the bridge panel wraps every command in one.

### The rule for changes

Change `server/src/scripts/commands/rigs/` first, then mirror the change into the panel `.jsx` under `panels/`. Keep the SPEC values, layer names, effect order and log lines identical in both. When a rig grows a parameter, add it to the tool schema in `server/src/tools/rigs.ts`, to the `MCP.rigs.describe(...)` entry in the command file (which is what `list-rigs` reports), to the panel form, and to the panel's `GUIDE.md`.

### Could the panels `#include` the command files instead?

ExtendScript supports `#include "path"` and `//@include "path"`. The path is resolved relative to the script file that contains the directive, and `$.evalFile()` can load a file from any absolute path. In principle a panel in the ScriptUI Panels folder could include the shared library and the rig command file from the repository on either platform, and the UI would then call the registered command instead of its own copy of the build function.

This was not tested here. The included files depend on the `MCP` object and its library files (`core.jsx`, `resolve.jsx`, `serialize.jsx`, `easing.jsx`, `color.jsx`) being loaded first and in order, the include paths would need to point out of the After Effects install folder into the repository (or a copy of it), and a broken path fails silently at panel load. The panels are therefore shipped self-contained on purpose: a single file that can be copied anywhere. The mirroring rule above is what keeps the two forms in step.
