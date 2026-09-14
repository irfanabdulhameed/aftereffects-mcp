# Power Warp Transition: Reusable Builder Panel

> This panel also exists as the `rig-power-warp-transition` tool of the MCP server in this repository, with the same logic and defaults. See [panels/README.md](../README.md) for how the two relate.


**Created by Irfan Abdul Hameed**
Connect with me → [LinkedIn](http://www.linkedin.com/in/irfan-abdul-hameed-a81b98230)

> The same guide is built into the panel, click the **ⓘ Guide** button in the top-right corner.

---

A one-click After Effects panel that recreates VideoLancer's **depth-map "Power Warp Transition"**. You point it at three layers (outgoing clip, incoming clip, depth map) and it builds the entire rig, depth-driven gradient wipe, glowing scan-line, pseudo-3D shake, CC-Glass warp, chromatic aberration and fine distortions, fully keyframed and trimmed to the transition window.

> **The only thing it can't do for you is generate the depth map**, that needs Photoshop's Neural Filters (see [§3](#3-make-a-depth-map-the-one-manual-prerequisite)). Everything else is automatic.

---

## 1. Install (once)

**Mac**
1. Copy **`Power Warp Transition.jsx`** to:
   `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`
2. In After Effects: **After Effects → Settings → Scripting & Expressions** → tick **"Allow Scripts to Write Files and Access Network."**
3. Restart After Effects. The panel now appears under the **Window** menu → **Power Warp Transition.jsx**. Dock it like any panel.

**Windows**
1. Copy the `.jsx` to:
   `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`
2. Same scripting setting + restart as above.

**Don't want to install?** You can also run it ad-hoc via **File → Scripts → Run Script File…** and pick the `.jsx`. It opens as a floating window instead of a dockable panel. (Installing is nicer because it stays docked.)

---

## 2. The 60-second workflow

1. Build a comp with your **outgoing clip (A)** and **incoming clip (B)** on two layers.
2. Add a **depth map of clip A** as a layer (see §3).
3. Open the **Power Warp Transition** panel → **Refresh layer list**.
4. Set **Outgoing (A)**, **Incoming (B)**, **Depth map** from the dropdowns.
5. Set **Start** and **Duration**, pick an **Intensity** and **Scan color**.
6. Press **Build Transition**. The playhead parks mid-transition so you can preview immediately.
7. Not happy? **Ctrl/Cmd + Z** removes the whole build in one step. Tweak and rebuild.

---

## 3. Make a depth map (the one manual prerequisite)

The transition is driven by a **grayscale depth map** of the outgoing clip, white = near, black = far (or vice-versa).

### For a still / single frame
1. In AE, get clip A's frame: **Composition → Save Frame As → File…** (or Photoshop layers), or just open the source image.
2. In **Photoshop**: **Filter → Neural Filters → Depth Blur**. Enable the filter, then turn on **"Output depth map only."**
3. **OK** → flatten → **Save As** a PNG or PSD.
4. Import that into AE and drop it on a layer in your comp. That's your **Depth map** layer.

### For video footage (every frame needs a map)
You can't hand-make a map per frame, so automate it:
1. In AE, render clip A as a **PNG sequence** (Composition → Add to Render Queue → output a PNG sequence).
2. In Photoshop, open one frame and **record an Action** (Window → Actions → new Action) that runs **Neural Filters → Depth Blur → Output depth map only**, flattens, and saves.
3. Run **File → Automate → Batch…**, choosing that Action and the folder of PNGs → it writes a depth map for every frame.
4. Import the resulting depth sequence back into AE **as a single footage item** ("PNG Sequence" checkbox in the import dialog) and use it as the **Depth map** layer.

> Tip: any depth source works, Photoshop Neural Filters, a render from a 3D app, a depth pass from Runway/Marigold/MiDaS, etc. The panel only cares that it's a grayscale depth layer the same size as your comp.

---

## 4. Panel controls

| Control | What it does |
|---|---|
| **Outgoing (A)** | The clip that warps away. Gets the depth Gradient Wipe. **Required.** |
| **Incoming (B)** | The clip revealed underneath. Optional, leave on `(none)` if it's already at the bottom. |
| **Depth map** | Grayscale depth pass of clip A. Drives every module. **Required.** |
| **Start (sec)** | When the transition begins. **Use playhead as Start** copies the current time. |
| **Duration (s)** | Length of the transition (≈1.0–2.0 s looks best). |
| **Intensity** | Master multiplier for distortion strength. `0.5` subtle … `1.0` matches the tutorial … `2.0` extreme. |
| **Scan color** | RGB (0–255) of the glowing depth scan-line. Default is electric blue `0 / 90 / 255`. |
| **Modules** | Toggle individual layers on/off (Gradient Wipe is always on). |

---

## 5. What it builds (the rig)

Top → bottom in your comp after a build:

| Layer | Type | Role |
|---|---|---|
| **Fine Distortions** | adjustment | Turbulent-noise micro-warp via CC Glass (fades in/out on opacity). |
| **Shake** | adjustment | Displacement-Map parallax driven by `wiggle(20, Slider)`; slider punches then decays. |
| **Aberrations** | adjustment | CC Glass + paired Set Channels for RGB fringing (CC Glass displacement **−500**). |
| **Warp** | adjustment | The core: CC Glass + CC Vector Blur (`Angle = wiggle(16,360)`), opacity-belled. |
| **Scan Line** | depth copy, **Add** | Extract band that sweeps the depth gradient → Fill → Tint → Glow. |
| **(your A)** | footage | **Gradient Wipe**, Transition Completion 0 → 100, gradient = depth map, inverted. |
| **(your depth)** | footage *(video off)* | Drives the gradient wipe + all maps. |
| **Warp Map / Shake Map / Fine Distortions Map** | depth copies *(video off)* | Pre-processed displacement sources (Extract + blur, etc.). |
| **(your B)** | footage | The revealed clip, at the bottom. |

The five transition layers are **trimmed to the Start→Duration window**, so they only affect footage during the transition and leave the rest of your timeline untouched.

---

## 6. Tips & troubleshooting

- **Preview is slow / heavy.** This is a stack of CC Glass + Vector Blur + Turbulent Noise, normal. Lower comp resolution to 1/2 while designing; turn off modules you don't need.
- **Warp/scan looks flat or wrong.** Open the **Warp Map** layer's **CC Glass → Bump Map** (and the Gradient Wipe's **Gradient Layer**) and confirm the small dropdown beside the layer reads **"Effects & Masks"** (maps) / **"Source"** (gradient wipe). Scripting can't always set that secondary menu, so it's the one thing worth eyeballing.
- **A module did nothing.** A few effect dropdowns (e.g. CC Glass *Property*, Glow *Operation*) are set by best-guess index and silently fall back to defaults if your AE numbers them differently, the look still holds; nudge them by hand if you want the exact tutorial value (they're listed in §7).
- **The depth wipe goes the wrong direction.** Toggle **Invert Gradient** on the outgoing clip's **Gradient Wipe**, or invert your depth map.
- **Hard pop at the start/end.** Increase **Duration**, or check the depth map has smooth tonal range (a hard black/white map gives an abrupt wipe).
- **Re-use as a template.** After one good build, you can also **save the whole comp as a template project** or select the transition layers and **Animation → Save Animation Preset** for the single-layer pieces.

---

## 7. Reference, exact tutorial values baked in

All values live in the `SPEC` object at the top of the `.jsx`, so you can edit them once and every build inherits the change:

- **Gradient Wipe**, gradient = depth map, **Invert on**, Softness 0, Completion 0→100 (Easy Ease).
- **Scan Line** (depth copy, **Add**), Extract Black/White Point 0→255 (Easy Ease), Black Softness 75 / White Softness 6 → Fill white → Solid Composite black → Tint (white→scan color, 100%) → Glow (Threshold 60, Radius 10, Intensity 1, Composite Behind, Screen).
- **Shake**, Slider Control belled 0→**79**→0; Displacement Map (H=Red, V=Green, layer = Shake Map) with `wiggle(20, Slider)` on both amplitudes.
- **Warp**, CC Glass (Property Lightness, Softness 18, Height **100**, Displacement **500**, Shading Ambient 100 / Metal 100 / Roughness 0.025) + CC Vector Blur (Perpendicular, Amount **250**, Ridge 0.95, `Angle = wiggle(16,360)`).
- **Aberrations**, duplicate Warp look, CC Glass Displacement **−500** (Softness 12.6, Height 55.8) sandwiched between two Set Channels (green pass / red pass).
- **Fine Distortions**, CC Glass (Softness 1, Height **35**, Displacement 500) reading a **Fine Distortions Map** = two Turbulent Noise layers (Swirly/Spline, Contrast 100 & 50, Complexity 4 & 14, Scale 200, `Evolution = wiggle(16,350)`).
- **Map prep**, each depth copy gets Extract (crush) → black Solid Composite → blur, so the displacement sources are smooth grayscale gradients.

*Magnitudes marked in bold scale with the **Intensity** control.*

---

*Recreated by frame analysis of the VideoLancer "Power Warp Transition" tutorial for your own production use. The script uses only stock + bundled (CC) After Effects effects, no third-party plugins required.*
