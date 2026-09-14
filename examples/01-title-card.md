# Example 1: a title card

A transcript of an agent building a title card from a one-line request. Tool calls are shown as JSON; results are abbreviated.

## Request

> Make a 1080p comp called "Intro" and add a title that reads "NORTHWIND" with a subtitle "Annual Report 2026". Dark background, the title fades and rises in, subtitle follows.

## Transcript

**Agent:** I will check the bridge, create the composition, build the layers in one batch, then look at the result.

Call `ping`:

```json
{ "tool": "ping", "arguments": {} }
```

Result: `{ "pong": true, "aeVersion": "24.6.0x1", "bridgeVersion": "2.0.0" }`

Call `get-project-info` to see what exists. Result: an untitled project with no compositions.

Call `batch` with the whole build. Layer names are chosen up front so later steps can address them by name.

```json
{
  "tool": "batch",
  "arguments": {
    "steps": [
      { "tool": "create-composition", "args": { "name": "Intro", "preset": "1080p30", "duration": 6, "backgroundColor": "#0E0F14" }, "label": "comp" },
      { "tool": "create-solid-layer", "args": { "name": "BG", "color": "#0E0F14", "toBottom": true } },
      { "tool": "create-text-layer", "args": { "name": "Title", "text": "NORTHWIND", "font": "Helvetica-Bold", "fontSize": 140, "fillColor": "#FFFFFF", "tracking": 40, "position": [960, 500] } },
      { "tool": "create-text-layer", "args": { "name": "Subtitle", "text": "Annual Report 2026", "font": "Helvetica", "fontSize": 44, "fillColor": "#C9CDD6", "tracking": 120, "position": [960, 620] } },
      { "tool": "set-keyframes-multi", "args": { "targets": [
        { "layer": { "name": "Title" }, "property": "Transform/Opacity", "keys": [ { "frame": 0, "value": 0 }, { "frame": 14, "value": 100, "easing": "ease-out" } ] },
        { "layer": { "name": "Title" }, "property": "Transform/Position", "keys": [ { "frame": 0, "value": [960, 540] }, { "frame": 14, "value": [960, 500], "easing": "ease-out" } ] },
        { "layer": { "name": "Subtitle" }, "property": "Transform/Opacity", "keys": [ { "frame": 6, "value": 0 }, { "frame": 20, "value": 100, "easing": "ease-out" } ] },
        { "layer": { "name": "Subtitle" }, "property": "Transform/Position", "keys": [ { "frame": 6, "value": [960, 650] }, { "frame": 20, "value": [960, 620], "easing": "ease-out" } ] }
      ] } },
      { "tool": "apply-effect-template", "args": { "layer": { "name": "Title" }, "template": "soft-shadow", "params": { "opacity": 30, "softness": 40 } } }
    ]
  }
}
```

Result: `{ "steps": 6, "ok": 6, "failed": 0, "results": [ ... ] }` with the composition id, the two text layers at indices 1 and 2, and 8 keyframes written.

Call `see-frame` at the resting pose:

```json
{ "tool": "see-frame", "arguments": { "comp": { "name": "Intro" }, "frame": 24, "scale": 0.5 } }
```

Result: an image. The agent looks at it: title centred, subtitle below, both readable on the dark background. The tracking on the subtitle looks wide.

Call `set-text-style`:

```json
{ "tool": "set-text-style", "arguments": { "layer": { "name": "Subtitle" }, "tracking": 80 } }
```

Call `see-frame` again at frame 8 (mid-entrance) and frame 24. Both look right.

**Agent:** Done. "Intro" is a 1920 by 1080, 30 fps, 6 second composition. The title fades and rises over 14 frames with an ease-out; the subtitle follows 6 frames later. One undo step reverts the whole build. Frames at 8 and 24 attached.

## What to notice

- One `batch` for the build, then targeted fixes.
- Layers addressed by the names chosen in the build, never by index.
- `see-frame` before the report, and again after the fix.
