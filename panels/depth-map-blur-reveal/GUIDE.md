# Depth Map Blur Reveal: Reusable Builder Panel

> This panel also exists as the `rig-depth-map-blur-reveal` tool of the MCP server in this repository, with the same logic and defaults. See [panels/README.md](../README.md) for how the two relate.


> The same guide is built into the panel, click the **ⓘ Guide** button in the top-right corner.

---

A one-click After Effects panel that recreates the **depth-map blur reveal** from the reference reel, the part where the **meadow resolves into focus** (the rectangle / text zoom is a separate element and is *not* part of this rig). An image starts as a huge **depth-weighted blur** and resolves into focus: the **near foreground stays soft & bloomed longest** while the distance sharpens first, lifted by an **exposure ramp** (dark → bright) and a **fading glow bloom**. Parameterised so you can re-use it on any layer.

---

## 1. Install (once)

**Mac**
1. Copy **`Depth Map Blur Reveal.jsx`** to:
   `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`
2. In After Effects: **After Effects → Settings → Scripting & Expressions** → tick **"Allow Scripts to Write Files and Access Network."**
3. Restart After Effects. The panel appears under the **Window** menu → **Depth Map Blur Reveal.jsx**. Dock it like any panel.

**Windows**
1. Copy the `.jsx` to:
   `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`
2. Same scripting setting + restart as above.

**Don't want to install?** Run it ad-hoc via **File → Scripts → Run Script File…** and pick the `.jsx`. It opens as a floating window instead of a dockable panel.

---

## 2. The 30-second workflow

1. Open a comp and add your image / footage.
2. **Select the layer** you want to reveal.
   - **Auto gradient** mode → select **just that one layer**.
   - **Selected depth layer** mode → select **two layers**: the image **on top** + its depth map directly below.
3. Set **Max blur**, the **look toggles** (exposure / glow / scale) and the **timing**.
4. Press **Build Depth Blur Reveal**. Preview, then tweak and rebuild. One **Ctrl/Cmd+Z** undoes the entire rig.

---

## 3. What gets built

Applied to the **selected image layer**, top → bottom of its effect stack:

| Effect | Role |
|---|---|
| **Compound Blur** | depth-weighted blur. Its **Blur Layer** is your depth map *or* an auto vertical gradient (white edge = near = blurs longest). **Maximum Blur** keyframes `max → 0`, the reveal. |
| **Exposure** *(optional)* | a negative exposure ramps up to `0` → the dark-to-bright lift. |
| **Glow** *(optional)* | **Glow Intensity** `high → low` → the bloom that fades as the image sharpens. |
| **Scale** *(optional)* | a gentle settle (e.g. `104% → 100%` of the layer's **current** scale, so your framing is preserved). |
| **DBR Depth (auto)** *(auto mode only)* | a hidden guide solid carrying a **Gradient Ramp**, used only as the Compound Blur source. It's a guide layer (excluded from render) with its visibility off. |

Everything is one **Undo group**, a single **Ctrl/Cmd+Z** reverts the whole rig.

How it maps to the reference reel:

- **Depth-weighted blur, not flat**, Compound Blur reads a depth source, so brighter (= nearer) areas carry the most blur. As **Maximum Blur** animates to `0`, the distance sharpens first and the foreground last, exactly like the meadow.
- **Dark → golden lift**, the **Exposure** ramp matches the muddy-purple-to-sunset brightening.
- **Leading-edge bloom**, the **Glow** that fades out matches the glowing soft foreground that resolves into crisp flowers.

---

## 4. Controls

| Control | What it does | Reference value |
|---|---|---|
| **Max blur** | Compound Blur **Maximum Blur** start (animates to `0`) | ~120 |
| **Blur source** | **Auto gradient** (no map needed) or a **Selected depth layer** | Auto gradient |
| **Near (soft) edge** | which edge of the auto gradient stays soft longest | bottom |
| **Invert depth** | swap which depths blur longest (use if your map reads inverted) | off |
| **Exposure lift + start** | enable the dark-to-bright ramp; start in stops (negative = dark) | on / −2.0 |
| **Glow bloom + start/end** | enable the bloom; Glow Intensity at the start and end | on / 2.5 → 0 |
| **Scale settle + start %** | gentle scale settle; start as a % of the layer's current scale | off / 104% |
| **Start (s) / Start at playhead** | when the reveal begins (or begin at the time indicator) | 0 |
| **Duration (s)** | how long the reveal takes | ~0.8 |
| **Ease (0–100)** | keyframe influence, `33` = Easy Ease | 33 |

---

## 5. Tips & troubleshooting

- **No depth map?** Leave **Blur source** on **Auto gradient**, it fakes depth from a vertical ramp.
- **Foreground sharpening too soon / too late?** Toggle **Invert depth**, or change the **Near (soft) edge**.
- **Want a flat blur (no depth weighting)?** If Compound Blur is missing it auto-falls back to **Gaussian Blur**; or point **Blur source** at a flat grey layer.
- **Bloom too strong?** Lower **Glow start** (Glow Radius `90` / Threshold `50%` are baked in, edit the `.jsx` `SPEC` to change them).
- **Reveal too slow / fast?** Adjust **Duration**. Land it on a beat with **Start at playhead**.
- **Depth-map mode error?** It needs **two** selected layers, the image on top, the depth map below.
- Everything lives in **one Undo group**, tweak the controls and rebuild as often as you like.
