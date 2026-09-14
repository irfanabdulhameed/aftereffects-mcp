# Blur Color Reveal: Reusable Builder Panel

> This panel also exists as the `rig-blur-color-reveal` tool of the MCP server in this repository, with the same logic and defaults. See [panels/README.md](../README.md) for how the two relate.


> The same guide is built into the panel, click the **ⓘ Guide** button in the top-right corner.

---

A one-click After Effects panel that recreates the **blur colour reveal** from your `SECOND_SCENE` comp: a soft-edged colour disc that **blooms outward** (Scale `0% → 120%`, eased) over your content to wipe-reveal it. It builds the exact rig you made by hand, two synced **Fast-Box-Blurred ellipses**, the coloured one clipped to a matching **alpha matte** so a thick stroke reads as a clean two-tone disc, parameterised so you can re-use it on any comp.

---

## 1. Install (once)

**Mac**
1. Copy **`Blur Color Reveal.jsx`** to:
   `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`
2. In After Effects: **After Effects → Settings → Scripting & Expressions** → tick **"Allow Scripts to Write Files and Access Network."**
3. Restart After Effects. The panel appears under the **Window** menu → **Blur Color Reveal.jsx**. Dock it like any panel.

**Windows**
1. Copy the `.jsx` to:
   `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`
2. Same scripting setting + restart as above.

**Don't want to install?** Run it ad-hoc via **File → Scripts → Run Script File…** and pick the `.jsx`. It opens as a floating window instead of a dockable panel.

---

## 2. The 30-second workflow

1. Open the comp with your content (dashboard / card / footage).
2. **Select the layer(s)** you want to reveal.
3. (Recommended) leave **Precompose selected first** ticked, it wraps them into a tidy `BR Content` precomp.
4. Pick the **core + ring colours**, **softness**, **end scale** and **timing**.
5. Press **Build Reveal**. Preview, then tweak the controls and rebuild. One **Ctrl/Cmd+Z** undoes the entire rig.

---

## 3. What gets built

Top → bottom in the comp:

| Layer | Role |
|---|---|
| **BR Reveal Matte** | a Fast-Box-Blurred plain-fill ellipse used as the **alpha matte** (renders invisibly). **Scale** animates `0% → end`. |
| **BR Reveal Color** | the **same ellipse** with a **fill** (core colour) + optional **stroke** (ring colour), Fast Box Blur, **alpha-matted** by the matte so the ring is clipped to a clean soft disc. **Scale** animates `0% → end` in sync. |
| **BR Content** *(optional)* | your selected layers, precomposed to stay tidy. |
| **BR Control** *(optional)* | a null both ellipses parent to, for a subtle scene push-in. |

How it maps to your reference rig:

- **Two synced ellipses**, identical `Ellipse Path` size, both with **Fast Box Blur** (radius `80`, iterations `3`, repeat-edge on) for the soft edge.
- **Alpha matte**, the colour layer (fill + thick stroke) is clipped by the plain-fill matte above it, so the stroke that overflows the path is cut back to a clean soft disc (blue rim / yellow core in your reference).
- **Scale bloom, not a sweep**, both layers animate **Scale `0% → 120%`** from a shared origin with **Easy-Ease** (influence `33`), so the disc grows outward from a point to reveal the content beneath.

---

## 4. Controls

| Control | What it does | Reference value |
|---|---|---|
| **Core (fill)** | the centre colour of the disc | pale yellow `251,248,149` |
| **Ring (stroke)** | the rim colour (set Ring width `0` for a single colour) | light blue `173,215,255` |
| **Ring width (px)** | stroke thickness; `0` = no ring | ~200–300 |
| **Softness (blur)** | Fast Box Blur radius, higher = softer/glowier edge | 80 |
| **Size (×Comp)** | ellipse size as a multiple of the comp (before scaling) | ~1.5 |
| **End scale %** | how far the bloom grows | 120 |
| **Start / Duration (s)** | when the bloom begins and how long it takes | 0 / 1.3 |
| **Ease (0–100)** | keyframe influence, `33` = Easy Ease | 33 |
| **Origin = centre** | grow from comp centre, or untick to set a custom **X / Y** point | centre |
| **Precompose selected first** | wrap the selection into `BR Content` | on |
| **Control null + push** | parent both ellipses to a null and add a subtle scale push-in | off |

---

## 5. Tips & troubleshooting

- **Disc doesn't cover the frame?** Raise **End scale %** or **Size (×Comp)**.
- **Want a single solid colour (no rim)?** Set **Ring width** to `0`.
- **Edges too hard / too soft?** Raise or lower **Softness** (the blur radius).
- **Grow from a corner instead of the centre?** Untick **Origin = centre** and set **X / Y**.
- **Track matte didn't stick on an older AE build?** `BR Reveal Matte` sits directly above `BR Reveal Color`, just set the colour layer's track-matte dropdown to **Alpha** by hand.
- Everything lives in **one Undo group**, tweak the controls and rebuild as often as you like.
