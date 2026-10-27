# AE MCP Live View

A small After Effects plug-in (AEGP) that keeps a picture of the active composition in the bridge folder, so an MCP client can see what is on screen at any moment without moving the playhead or running a script. The MCP tools `see-live` and `live-view-settings` read it.

## What it does

- Watches the active composition: which comp, the playhead, and any edit that changes the frame.
- When nothing has changed for 250 ms (so never during playback or scrubbing), it draws a quick quarter-size picture, then the half-size one if the quick picture shows it will take less than 400 ms.
- Writes `<bridge>/live/latest.jpg` and `latest.json` (comp, time, frame, size, `final`), plus `status.json` every 2 seconds.
- An idle project costs nothing: it draws only after a change.

After Effects renders whole compositions only on its main thread, and it ignores cancel requests for them. The quick picture is how the plug-in avoids starting a frame that would make After Effects pause.

## Settings

`<bridge>/live/options.json`, re-read every 2 seconds (or use the `live-view-settings` tool):

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Off stops all drawing |
| `scale` | `2` | Full-size picture: 1 full, 2 half, 4 quarter |
| `maxFps` | `4` | At most this many new pictures per second |
| `budgetMs` | `400` | A full-size frame expected to take longer stays at quick size |
| `settleMs` | `250` | Wait this long after the last change |
| `quality` | `80` | JPEG quality |

The bridge folder is `~/Documents/ae-mcp-bridge`, or `AE_MCP_BRIDGE_DIR` when set.

## Build

Adobe does not allow the SDK to be redistributed, so download it yourself: [After Effects SDK](https://developer.adobe.com/console/servicesandapis/ae) (free Adobe account), and unzip it into `sdk/` here (ignored by git).

macOS (Xcode command-line tools and CMake; full Xcode is not needed):

```sh
cmake -S . -B build -DAE_SDK_DIR="$PWD/sdk/AfterEffectsSDK/Examples" -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

This produces `build/AE MCP Live View.plugin`, universal (Apple silicon and Intel), ad-hoc signed.

Windows (Visual Studio 2022): the same two commands with the Windows SDK's `Examples` folder, giving `AE MCP Live View.aex`. The Windows build is written but has not been built or tested yet.

## Install

Copy the plug-in into either folder and restart After Effects:

- macOS: `/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore/` (usually writable without sudo) or `/Applications/Adobe After Effects <version>/Plug-ins/`
- Windows: `C:\Program Files\Adobe\Common\Plug-ins\7.0\MediaCore\` or the After Effects `Plug-ins` folder

`<bridge>/live/status.json` appears as soon as After Effects loads it.
