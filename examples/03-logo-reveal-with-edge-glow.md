# Example 3: a logo reveal with the Edge Glow rig

## Request

> Use the edge glow rig behind our logo layer "Logo" in the comp "Bumper", pink to purple, and reveal the logo with a scale settle.

## Transcript

**Agent:** I will check the rig parameters, build it, place the logo above it, then animate the logo.

Call `list-rigs`. Result includes `rig-edge-glow` with parameters `rectWidth 718, rectHeight 142, roundness 28, strokeWidth 3, gradientA [236,0,200], gradientB [120,40,255], ...` and the note that Deep Glow is optional with a built-in Glow fallback.

Call `get-layer-bounds` with `{ "layer": { "name": "Logo" } }`. Result: the logo is 640 by 120 pixels in comp space at the centre. The rig rectangle should be a little larger.

Call `rig-edge-glow`:

```json
{
  "tool": "rig-edge-glow",
  "arguments": {
    "comp": { "name": "Bumper" },
    "rectWidth": 760,
    "rectHeight": 180,
    "roundness": 32,
    "gradientA": "#EC00C8",
    "gradientB": "#7828FF",
    "haloDistance": 100,
    "haloSoftness": 525,
    "animateSweep": true,
    "sweepSpeed": 50,
    "addBackground": false
  }
}
```

Result: three layers created, "EG Stroke", "EG Fill", "EG Glow", plus `glowUsed: "built-in Glow (Deep Glow not installed)"`.

Call `move-layer` with `{ "layer": { "name": "Logo" }, "toTop": true }` so the logo sits above "EG Stroke".

Call `set-keyframes-multi`:

```json
{
  "tool": "set-keyframes-multi",
  "arguments": {
    "targets": [
      { "layer": { "name": "Logo" }, "property": "Transform/Scale", "keys": [ { "frame": 0, "value": [80, 80] }, { "frame": 18, "value": [100, 100], "easing": "overshoot" } ] },
      { "layer": { "name": "Logo" }, "property": "Transform/Opacity", "keys": [ { "frame": 0, "value": 0 }, { "frame": 12, "value": 100, "easing": "ease-out" } ] },
      { "layer": { "name": "EG Stroke" }, "property": "Transform/Opacity", "keys": [ { "frame": 0, "value": 0 }, { "frame": 10, "value": 100, "easing": "ease-out" } ] },
      { "layer": { "name": "EG Fill" }, "property": "Transform/Opacity", "keys": [ { "frame": 0, "value": 0 }, { "frame": 10, "value": 100, "easing": "ease-out" } ] },
      { "layer": { "name": "EG Glow" }, "property": "Transform/Opacity", "keys": [ { "frame": 0, "value": 0 }, { "frame": 16, "value": 100, "easing": "ease-out" } ] }
    ]
  }
}
```

Call `see-frames` with `{ "comp": { "name": "Bumper" }, "frames": [0, 8, 14, 24], "columns": 2 }`. The contact sheet shows the glow badge fading in and the logo settling with a small overshoot at frame 14. The halo is strong against the white logo.

Call `set-effect-property` on "EG Glow" to reduce the third Drop Shadow's Opacity, then `see-frame` at frame 24. Balanced.

**Agent:** Done. The Edge Glow badge (760 by 180, pink to purple, animated sweep) sits behind "Logo", which scales from 80 percent with an overshoot and fades in over 12 frames. Deep Glow is not installed, so the rig used the built-in Glow; install Deep Glow and rerun the rig for the exact tutorial bloom. Contact sheet attached.

## What to notice

- `list-rigs` first, so the parameter names and requirements were known.
- The rig reported which glow it used; the agent passed that on.
- `see-frames` for a quick overview of the motion, then `see-frame` for the fix.
