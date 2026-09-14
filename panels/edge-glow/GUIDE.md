# Edge Glow: Reusable Builder Panel

> This panel also exists as the `rig-edge-glow` tool of the MCP server in this repository, with the same logic and defaults. See [panels/README.md](../README.md) for how the two relate.


> The same guide is built into the panel, click the **ⓘ Guide** button in the top-right corner.

---

A one-click After Effects panel that recreates the **Edge Glow** look: a rounded-rectangle outline with a glowing 4-colour gradient edge, an animated light sweep travelling around it, and a soft coloured halo blooming behind, finished with Deep Glow. Point it at a comp (or let it make one) and it builds the whole rig in a single Undo group.

This is the exact rig from the tutorial, parameterised so you can re-skin it (size, colours, glow strength, sweep speed) without rebuilding anything by hand.

---

## 1. Install (once)

**Mac**
1. Copy **`Edge Glow.jsx`** to:
   `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`
2. In After Effects: **After Effects → Settings → Scripting & Expressions** → tick **"Allow Scripts to Write Files and Access Network."**
3. Restart After Effects. The panel appears under the **Window** menu → **Edge Glow.jsx**. Dock it like any panel.

**Windows**
1. Copy the `.jsx` to:
   `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`
2. Same scripting setting + restart as above.

**Don't want to install?** Run it ad-hoc via **File → Scripts → Run Script File…** and pick the `.jsx`. It opens as a floating window instead of a dockable panel.

---

## 2. The 30-second workflow

1. (Optional) Open the comp you want the badge in. **No comp open? The panel makes a 1920×1080 / 30 fps one for you.**
2. Set the rectangle **Size / Roundness / Stroke**.
3. Pick **Gradient A** and **Gradient B** (the two edge colours) and the three **Halo** colours.
4. Tick **Animate light sweep** for the moving highlight.
5. Press **Build Edge Glow**. One **Ctrl/Cmd+Z** undoes the entire build.
6. Drop your **text or icon** on a layer *above* `EG Stroke` to finish the design.

---

## 3. What gets built

Top → bottom in the comp:

| Layer | Role | Effects |
|---|---|---|
| **EG Stroke** | the glowing outline | CC Light Sweep · 4-Color Gradient · Deep Glow |
| **EG Fill** | the dark inner panel | (solid-filled rounded rect) |
| **EG Glow** | the coloured halo (sent to the bottom) | 3 × Drop Shadow (red / blue / white) |
| **EG Background** *(optional)* | black backdrop |, |

How it maps to the tutorial:

- **CC Light Sweep**, Sweep Intensity `0`, **Edge Intensity `100`**, Edge Thickness `4`, white light, **Light Reception = Cutout**, Center pinned to the rectangle. Animated with the expression `time * speed` on **Direction**.
- **4-Color Gradient**, the four points are pinned to the rectangle's corners. **Corners 1 & 3 = Gradient A**, **corners 2 & 4 = Gradient B**, so the rim reads as a smooth A→B sweep.
- **Drop Shadows**, three stacked shadows (default red / blue / white), Distance `100`, Softness `525`, ~50 % opacity, giving the layered coloured bloom.
- **Deep Glow**, Radius `1000`, Exposure `1` on the stroke. *If the Deep Glow plugin isn't installed, the script automatically falls back to After Effects' built-in **Glow** so it still works.*

---

## 4. Controls

| Control | What it does | Tutorial value |
|---|---|---|
| **Size W × H** | rectangle dimensions | 718 × 142 |
| **Roundness** | corner radius | 28 |
| **Stroke (px)** | outline thickness | 3 |
| **Gradient A** | edge colour for corners 1 & 3 | pink |
| **Gradient B** | edge colour for corners 2 & 4 | blue/purple |
| **Fill (inner)** | inner panel colour | black |
| **Halo 1 / 2 / 3** | the three drop-shadow colours | red / blue / white |
| **Halo distance / softness / direction** | spread & angle of the bloom | 100 / 525 / −36 |
| **Sweep width** | thickness of the moving highlight | 88 |
| **Edge intensity** | brightness of the swept edge | 100 |
| **Animate + speed** | adds `time * speed` to the sweep Direction | on, 50 |
| **Add black background solid** | drop a black solid under everything | on for new comps |

Change **Size** and everything re-pins automatically, the gradient corners and the light-sweep centre follow the new rectangle.

---

## 5. Tips & troubleshooting

- **No "Deep Glow" plugin?** The script falls back to built-in **Glow** automatically, close, but install Plugin Everything's **Deep Glow** for the exact tutorial bloom.
- **Halo too strong / weak?** Raise or lower **Halo distance** & **softness**. Want it more saturated? Push the three halo colours.
- **`Light Reception` didn't switch to "Cutout"?** A few AE builds block scripting popup menus, set it by hand on **CC Light Sweep** if needed.
- **Edge looks flat?** Increase **Edge intensity**, or widen the **Sweep width**.
- **Want a pill / square?** Just change **Size** and **Roundness**, set roundness very high for a full pill.
- Everything lives in **one Undo group**, tweak the controls and rebuild as often as you like.
