/*
 * Mock result shapes for the markers-audio command group. The base marker and
 * audio commands are answered by core.js; this file covers the commands added
 * later (audioToKeyframes, markersFromBeats). Shapes mirror
 * src/scripts/commands/markers-audio.jsx.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Music') => ({ index, id: 100 + index, name });
const nullSummary = (name) => ({
  index: 1, id: 150, name, type: 'null', enabled: true, locked: false, shy: false, solo: false,
  inPoint: 0, outPoint: 10, startTime: 0, inFrame: 0, outFrame: 300, durationFrames: 300, stretch: 100,
  parent: null, label: 'none', comment: '', hasVideo: false, hasAudio: false, isNull: true, isGuide: false, threeD: false, adjustment: false,
  blendMode: 'normal', trackMatte: 'none', trackMatteLayer: null, motionBlur: false, collapseTransformation: false, source: null,
  effects: ['Left Channel', 'Right Channel', 'Both Channels'], hasEffects: true, hasExpressions: false,
  transform: { position: [960, 540], anchorPoint: [0, 0], scale: [100, 100], rotation: 0, opacity: 100 },
});

export const responses = {
  audioToKeyframes: (args) => {
    const name = args.name ?? 'Audio Amplitude';
    const ref = `thisComp.layer("${name}")`;
    const slider = (channel) => ({ channel, path: `Effects/${channel}/Slider`, matchPath: `ADBE Effect Parade/ADBE Slider Control/ADBE Slider Control-0001`, numKeys: 300, maxValue: 24.3 });
    return {
      composition: comp(),
      sourceLayer: layerRef(args.layer?.index ?? 2, args.layer?.name ?? 'Music'),
      layer: nullSummary(name),
      sliders: [slider('Left Channel'), slider('Right Channel'), slider('Both Channels')],
      keyCounts: { 'Left Channel': 300, 'Right Channel': 300, 'Both Channels': 300 },
      expressions: {
        both: `${ref}.effect("Both Channels")("Slider")`,
        left: `${ref}.effect("Left Channel")("Slider")`,
        right: `${ref}.effect("Right Channel")("Slider")`,
        scaleExample: `linear(${ref}.effect("Both Channels")("Slider"), 0, 20, 100, 130)`,
      },
      workArea: { start: 0, duration: 10 },
      notes: ['Keyframes cover the composition work area only.'],
    };
  },
  markersFromBeats: (args) => {
    const offset = args.offset ?? 0;
    let times = [];
    let mode;
    if (Array.isArray(args.peakTimes) && args.peakTimes.length) {
      mode = 'peaks';
      times = args.peakTimes.map((t) => t + offset).filter((t) => t >= 0 && t <= 10);
    } else if (args.bpm) {
      mode = 'bpm';
      const step = 60 / args.bpm / (args.subdivisions ?? 1);
      const start = args.start ?? (args.startFrame !== undefined ? args.startFrame / 30 : 0);
      const end = args.end ?? (args.endFrame !== undefined ? args.endFrame / 30 : 10);
      for (let t = start + offset; t <= end + 1e-6; t += step) times.push(Math.round(t * 30) / 30);
    } else {
      const err = new Error('Give bpm or peakTimes[].');
      err.mcpCode = 'invalid-argument';
      throw err;
    }
    times = times.slice(0, 5000);
    return {
      composition: comp(),
      layer: args.layer ? layerRef(args.layer.index ?? 1, args.layer.name ?? 'Music') : null,
      mode,
      bpm: mode === 'bpm' ? args.bpm : null,
      beatInterval: mode === 'bpm' ? 60 / args.bpm : null,
      offset,
      count: times.length,
      errorCount: 0,
      firstTime: times[0] ?? null,
      lastTime: times[times.length - 1] ?? null,
      firstFrame: times.length ? Math.round(times[0] * 30) : null,
      lastFrame: times.length ? Math.round(times[times.length - 1] * 30) : null,
      markerCount: times.length,
      cleared: !!args.clearExisting,
    };
  },
};
