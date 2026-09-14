# Example 4: audio-driven markers and a pulse

## Request

> The comp "Promo" has a music layer called "Track". Put markers on the beats and make the "Dot" layer pulse on every downbeat.

## Transcript

**Agent:** I will read the audio layer, analyse the file, mark the beats, then key the pulse from the marker times.

Call `get-audio-info` with `{ "layer": { "name": "Track" } }`. Result: `sourceFilePath: "/Users/maya/Music/promo-track.wav"`, `startTime: 0`, 44.1 kHz stereo, 32 s.

Call `analyze-audio-waveform`:

```json
{ "tool": "analyze-audio-waveform", "arguments": { "filePath": "/Users/maya/Music/promo-track.wav", "numPoints": 800, "peakThreshold": 0.55, "minGapSeconds": 0.2 } }
```

Result: `peakCount: 62`, `peakTimes: [0.48, 0.97, 1.45, 1.94, ...]`. The spacing is about 0.485 s, which is 124 BPM.

Call `markers-from-beats` on the comp using the tempo rather than the raw peaks, so the grid is even:

```json
{ "tool": "markers-from-beats", "arguments": { "target": "comp", "bpm": 124, "offset": 0.48, "beatsPerBar": 4, "labelDownbeats": true, "clearExisting": true } }
```

Result: 66 markers, comments "1" to "4", downbeats labelled.

Call `list-markers`. The agent keeps the times of every marker whose comment is "1" (16 downbeats).

Call `set-keyframes-bulk` for the pulse, three keys per downbeat:

```json
{
  "tool": "set-keyframes-bulk",
  "arguments": {
    "layer": { "name": "Dot" },
    "property": "Transform/Scale",
    "replace": true,
    "keys": [
      { "time": 0.48, "value": [100, 100] },
      { "time": 0.55, "value": [118, 118], "easing": "snappy" },
      { "time": 0.78, "value": [100, 100], "easing": "ease-out" },
      { "time": 2.42, "value": [100, 100] },
      { "time": 2.49, "value": [118, 118], "easing": "snappy" },
      { "time": 2.72, "value": [100, 100], "easing": "ease-out" }
    ]
  }
}
```

(All 16 downbeats are included in the real call; two are shown.)

Call `see-frame` at 0.55 s and 0.78 s. The dot is larger on the beat and back to normal after.

**Agent:** Done. 66 beat markers at 124 BPM starting at 0.48 s, downbeats labelled. "Dot" scales to 118 percent on each downbeat and settles over 7 frames. If you want a continuous reaction to the music instead, I can run audio-to-keyframes and link the scale to the amplitude slider.

## What to notice

- The waveform peaks were used to find the tempo, then an even grid was generated from BPM, which is cleaner than raw peaks.
- Marker times were read back with `list-markers` rather than assumed.
- The pulse uses `snappy` into the peak and `ease-out` into the rest, per the craft rules.
