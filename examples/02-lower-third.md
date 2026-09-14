# Example 2: a lower third

## Request

> Add a lower third for "Maya Chen, Head of Product" to the comp "Interview". It should slide in at 1 s, stay for 4 s, and slide out. Accent colour #7C86FF.

## Transcript

**Agent:** I will read the composition first so the lower third fits its size and frame rate.

Call `get-composition-info` with `{ "comp": { "name": "Interview" } }`. Result: 1920 by 1080 at 25 fps, 30 s. Frame math: 1 s is frame 25, the hold ends at frame 125.

Call `list-layers`. Result: two layers, "Interview.mov" and "Audio". Nothing named like the layers about to be created, so the names are safe.

Call `batch`:

```json
{
  "tool": "batch",
  "arguments": {
    "steps": [
      { "tool": "create-null-layer", "args": { "name": "LT Control", "position": [160, 900] } },
      { "tool": "create-shape-layer", "args": { "name": "LT Bar", "shapeType": "rectangle", "size": [8, 110], "fillColor": "#7C86FF", "position": [160, 900], "parent": { "name": "LT Control" } } },
      { "tool": "create-text-layer", "args": { "name": "LT Name", "text": "Maya Chen", "font": "Helvetica-Bold", "fontSize": 52, "fillColor": "#FFFFFF", "justification": "left", "position": [190, 880], "parent": { "name": "LT Control" } } },
      { "tool": "create-text-layer", "args": { "name": "LT Role", "text": "Head of Product", "font": "Helvetica", "fontSize": 32, "fillColor": "#C9CDD6", "justification": "left", "position": [190, 925], "parent": { "name": "LT Control" } } },
      { "tool": "set-anchor-point", "args": { "layer": { "name": "LT Name" }, "anchor": "center-left" } },
      { "tool": "set-anchor-point", "args": { "layer": { "name": "LT Role" }, "anchor": "center-left" } },
      { "tool": "set-keyframes-multi", "args": { "targets": [
        { "layer": { "name": "LT Bar" }, "property": "Transform/Scale", "keys": [ { "frame": 25, "value": [100, 0] }, { "frame": 37, "value": [100, 100], "easing": "ease-out" }, { "frame": 125, "value": [100, 100] }, { "frame": 135, "value": [100, 0], "easing": "ease-in" } ] },
        { "layer": { "name": "LT Name" }, "property": "Transform/Opacity", "keys": [ { "frame": 29, "value": 0 }, { "frame": 39, "value": 100, "easing": "ease-out" }, { "frame": 123, "value": 100 }, { "frame": 131, "value": 0, "easing": "ease-in" } ] },
        { "layer": { "name": "LT Name" }, "property": "Transform/Position", "keys": [ { "frame": 29, "value": [150, 880] }, { "frame": 39, "value": [190, 880], "easing": "ease-out" }, { "frame": 123, "value": [190, 880] }, { "frame": 131, "value": [150, 880], "easing": "ease-in" } ] },
        { "layer": { "name": "LT Role" }, "property": "Transform/Opacity", "keys": [ { "frame": 32, "value": 0 }, { "frame": 42, "value": 100, "easing": "ease-out" }, { "frame": 121, "value": 100 }, { "frame": 129, "value": 0, "easing": "ease-in" } ] },
        { "layer": { "name": "LT Role" }, "property": "Transform/Position", "keys": [ { "frame": 32, "value": [150, 925] }, { "frame": 42, "value": [190, 925], "easing": "ease-out" }, { "frame": 121, "value": [190, 925] }, { "frame": 129, "value": [150, 925], "easing": "ease-in" } ] }
      ] } }
    ]
  }
}
```

Result: 7 steps ok. The bar, name and role layers sit above the interview footage and are parented to "LT Control".

Call `see-frame` at frame 45 (fully in), frame 33 (mid-entrance) and frame 130 (mid-exit). The name overlaps the bar slightly at frame 33 because the slide starts to the left of the bar.

Call `set-keyframes-bulk` on "LT Name" Position with `replace: true` and the start x at 175 instead of 150; same for "LT Role". Call `see-frame` at frame 33 again. Clean.

**Agent:** Done. The lower third enters at 1 s (bar grows in 12 frames, text slides and fades 4 and 7 frames later), holds until 5 s and exits over 10 frames. Everything is parented to "LT Control" so you can move it as one. Frames at 33, 45 and 130 attached.

## What to notice

- The agent read the frame rate before converting seconds to frames.
- The exit mirrors the entrance with `ease-in`.
- Anchor points were set to the left so left-justified text scales and slides from its own left edge.
