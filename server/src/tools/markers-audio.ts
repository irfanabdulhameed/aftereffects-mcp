/*
 * Markers and audio tools. Waveform analysis runs on the server: PCM WAV is
 * read directly; other formats are decoded through ffmpeg when it is on PATH.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { CompRef, Easing, LABEL_COLORS, LayerRef, TimeArgs } from '../schemas/common.js';
import { defineTool } from './registry.js';

export interface WaveformAnalysis {
  duration: number;
  sampleRate: number;
  channels: number;
  amplitudes: number[];
  peakTimes: number[];
  waveformPoints: Array<{ time: number; amplitude: number }>;
}

/** Reads an uncompressed PCM WAV (8, 16, 24, 32-bit int or 32-bit float). */
export function analyzeWav(buf: Buffer, numPoints = 200, peakThreshold = 0.6, minGapSeconds = 0.08): WaveformAnalysis | undefined {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return undefined;
  let offset = 12;
  let channels = 0, sampleRate = 0, bits = 0, format = 0, dataOffset = -1, dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = buf.readUInt16LE(offset + 8);
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
      if (format === 0xfffe && size >= 40) format = buf.readUInt16LE(offset + 32);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = Math.min(size, buf.length - dataOffset);
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || channels === 0 || sampleRate === 0 || (format !== 1 && format !== 3)) return undefined;
  const bytesPerSample = bits / 8;
  const totalSamples = Math.floor(dataSize / (bytesPerSample * channels));
  if (totalSamples === 0) return undefined;
  const duration = totalSamples / sampleRate;
  const perPoint = Math.max(1, Math.floor(totalSamples / numPoints));
  const maxVal = format === 3 ? 1 : bits === 8 ? 128 : Math.pow(2, bits - 1);
  const read = (pos: number): number => {
    if (format === 3) return Math.abs(buf.readFloatLE(pos));
    if (bits === 16) return Math.abs(buf.readInt16LE(pos));
    if (bits === 8) return Math.abs(buf.readUInt8(pos) - 128);
    if (bits === 24) return Math.abs((buf.readInt8(pos + 2) << 16) | buf.readUInt16LE(pos));
    if (bits === 32) return Math.abs(buf.readInt32LE(pos));
    return 0;
  };
  const amplitudes: number[] = [];
  const waveformPoints: Array<{ time: number; amplitude: number }> = [];
  for (let i = 0; i < numPoints; i++) {
    let max = 0;
    const start = i * perPoint;
    const end = Math.min(start + perPoint, totalSamples);
    for (let s = start; s < end; s++) {
      for (let c = 0; c < channels; c++) {
        const pos = dataOffset + (s * channels + c) * bytesPerSample;
        if (pos + bytesPerSample > buf.length) continue;
        const v = read(pos);
        if (v > max) max = v;
      }
    }
    const norm = Math.min(1, max / maxVal);
    const t = (i / numPoints) * duration;
    amplitudes.push(norm);
    waveformPoints.push({ time: Number(t.toFixed(4)), amplitude: Number(norm.toFixed(4)) });
  }
  const peakTimes = detectPeaks(waveformPoints, peakThreshold, minGapSeconds);
  return { duration, sampleRate, channels, amplitudes, peakTimes, waveformPoints };
}

export function detectPeaks(points: Array<{ time: number; amplitude: number }>, threshold = 0.6, minGapSeconds = 0.08): number[] {
  const maxAmp = Math.max(0, ...points.map((p) => p.amplitude));
  const cut = maxAmp * threshold;
  const out: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (p.amplitude > cut && p.amplitude >= points[i - 1].amplitude && p.amplitude >= points[i + 1].amplitude && p.time - last >= minGapSeconds) {
      out.push(Number(p.time.toFixed(3)));
      last = p.time;
    }
  }
  return out;
}

export function ffmpegAvailable(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function decodeWithFfmpeg(filePath: string): Buffer {
  const tmp = path.join(os.tmpdir(), `ae-mcp-${process.pid}-${Date.now()}.wav`);
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', filePath, '-ac', '1', '-ar', '22050', '-f', 'wav', '-acodec', 'pcm_s16le', tmp], { stdio: 'ignore' });
    return fs.readFileSync(tmp);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

const MarkerFields = {
  comment: z.string().optional().describe('Marker text.'),
  duration: z.number().min(0).optional().describe('Seconds. 0 is a point marker.'),
  label: z.union([z.enum(LABEL_COLORS), z.number().int().min(0).max(16)]).optional(),
  chapter: z.string().optional(),
  url: z.string().optional(),
  frameTarget: z.string().optional(),
  cuePointName: z.string().optional(),
  protectedRegion: z.boolean().optional().describe('Protected region marker (After Effects 2020 and later).'),
  params: z.record(z.string()).optional().describe('Cue point key/value pairs.'),
};

export function registerMarkersAudioTools(server: McpServer): void {
  defineTool(server, {
    name: 'add-marker',
    group: 'markers-audio',
    description:
      'Adds one marker to a composition or a layer at a time or frame, with comment, duration, label colour, chapter, URL, frame target, cue point name and parameters, and protected region. ' +
      'Use when: marking a beat, a section, or a note for the human. Do not use for: many markers (add-markers-bulk) or beat grids (markers-from-beats). ' +
      'Inputs: target "comp" (default when no layer is given) or "layer" with layer; time or frame (default: current time); the marker fields. ' +
      'Returns: the marker as written and the new marker count. ' +
      'Notes: a second marker at exactly the same time replaces the first. Undoable in one step. ' +
      'Example: target "comp", frame 48, comment "Logo in", label "green".',
    input: { comp: CompRef.optional(), target: z.enum(['comp', 'layer']).optional(), layer: LayerRef.optional(), ...TimeArgs, ...MarkerFields },
  });

  defineTool(server, {
    name: 'add-markers-bulk',
    group: 'markers-audio',
    description:
      'Adds many markers to a composition or a layer in one round-trip. Combine with analyze-audio-waveform peaks to mark transients. ' +
      'Use when: placing more than one marker. Do not use for: a single marker (add-marker) or evenly spaced beats (markers-from-beats). ' +
      'Inputs: target and layer as in add-marker; markers[] each with time or frame plus the marker fields; clearExisting to remove current markers first. ' +
      'Returns: addedCount, errorCount, the markers added and any per-marker errors. ' +
      'Notes: markers at the same time replace each other. Undoable in one step. ' +
      'Example: markers = peakTimes mapped to {time, comment: "hit"}.',
    input: {
      comp: CompRef.optional(),
      target: z.enum(['comp', 'layer']).optional(),
      layer: LayerRef.optional(),
      markers: z.array(z.object({ ...TimeArgs, ...MarkerFields })).min(1).max(5000),
      clearExisting: z.boolean().optional(),
    },
  });

  defineTool(server, {
    name: 'list-markers',
    group: 'markers-audio',
    mutating: false,
    description:
      'Lists composition markers and layer markers with index, time, frame, comment, duration, label, chapter, URL and cue point data. ' +
      'Use when: reading beat markers a human placed, or verifying add-markers-bulk. Do not use for: keyframes (get-keyframes). ' +
      'Inputs: comp (optional); layer to list one layer only; includeLayers (default true) to include every layer that has markers. ' +
      'Returns: compMarkers[] and layers[] with their markers[]. ' +
      'Notes: read-only. ' +
      'Example: list-markers, then use the times to sequence layers.',
    input: { comp: CompRef.optional(), layer: LayerRef.optional(), includeLayers: z.boolean().optional() },
  });

  defineTool(server, {
    name: 'delete-marker',
    group: 'markers-audio',
    description:
      'Deletes one marker from a composition or a layer, by index or by time. ' +
      'Use when: removing a wrong marker. Do not use for: all markers (clear-markers). ' +
      'Inputs: target and layer as in add-marker; index (1-based) or time or frame (matched within half a frame). ' +
      'Returns: removed count and the markers remaining. ' +
      'Notes: undoable in one step. ' +
      'Example: target "comp", frame 48.',
    input: { comp: CompRef.optional(), target: z.enum(['comp', 'layer']).optional(), layer: LayerRef.optional(), index: z.number().int().positive().optional(), ...TimeArgs },
  });

  defineTool(server, {
    name: 'clear-markers',
    group: 'markers-audio',
    description:
      'Removes every marker from a composition or from one layer in one call. ' +
      'Use when: regenerating a beat grid with markers-from-beats or add-markers-bulk, or clearing markers a script left behind. Do not use for: one marker (delete-marker) or keyframes (clear-keyframes). ' +
      'Inputs: target "comp" (default when no layer is given) or "layer" with a layer reference. ' +
      'Returns: how many markers were removed, plus the composition and layer touched. ' +
      'Notes: comment text on the markers is lost; undo brings them all back in one step. Markers on other layers are not affected. ' +
      'Example: target "layer", layer {name: "Music"}.',
    input: { comp: CompRef.optional(), target: z.enum(['comp', 'layer']).optional(), layer: LayerRef.optional() },
  });

  defineTool(server, {
    name: 'get-audio-info',
    group: 'markers-audio',
    mutating: false,
    description:
      'Reads a layer\'s audio facts: whether it has audio and it is enabled, in and out points, the source file path (needed by analyze-audio-waveform), channels, sample rate, duration, current Audio Levels with keyframes, and the layer markers. ' +
      'Use when: before analyzing a soundtrack or setting levels. Do not use for: the waveform itself (analyze-audio-waveform). ' +
      'Inputs: layer. ' +
      'Returns: hasAudio, audioEnabled, source, sourceFilePath, audioLevels, markers. ' +
      'Notes: read-only. ' +
      'Example: layer {name: "Music"} then analyze-audio-waveform with sourceFilePath.',
    input: { comp: CompRef.optional(), layer: LayerRef },
  });

  defineTool(server, {
    name: 'set-audio-levels',
    group: 'markers-audio',
    description:
      'Sets a layer\'s Audio Levels in dB, for both channels or each separately, as a static value or as a keyframe at a time with easing (for fades). ' +
      'Use when: ducking music under a voice, muting, or fading out. Do not use for: audio-driven animation (audio-to-keyframes). ' +
      'Inputs: layer; level (both channels) or leftLevel and rightLevel in dB (0 unity, -6 half, -48 near silent); time or frame to keyframe; easing for that key. ' +
      'Returns: the Audio Levels property state and the values set. ' +
      'Notes: two calls with times make a fade. Undoable in one step. ' +
      'Example: level -12 at frame 0, then level -48 at frame 24 with easing "ease-in".',
    input: { comp: CompRef.optional(), layer: LayerRef, level: z.number().optional(), leftLevel: z.number().optional(), rightLevel: z.number().optional(), ...TimeArgs, easing: Easing.optional() },
  });

  defineTool(server, {
    name: 'analyze-audio-waveform',
    group: 'markers-audio',
    mutating: false,
    bridge: null,
    description:
      'Analyses an audio file on disk and returns an amplitude envelope and detected peak (transient) times. PCM WAV files are read directly; MP3, AAC, M4A, MOV and other formats are decoded through ffmpeg when it is installed on PATH, otherwise the error says so. Runs on the server. ' +
      'Use when: syncing animation to music or a voice track: get the file path from get-audio-info, analyse, then add-markers-bulk or sequence-layers at the peaks. Do not use for: reading levels inside After Effects (get-audio-info). ' +
      'Inputs: filePath; numPoints (default 200, higher for finer timing); peakThreshold 0..1 of the loudest point (default 0.6); minGapSeconds between peaks (default 0.08). ' +
      'Returns: duration, sampleRate, channels, peakCount, peakTimes[], waveformPoints[] of {time, amplitude}. ' +
      'Notes: read-only. Times are relative to the file start; add the layer start time when it does not start at 0. ' +
      'Example: filePath from get-audio-info, numPoints 400, then markers at peakTimes.',
    input: {
      filePath: z.string().min(1).describe('Absolute path to the audio file.'),
      numPoints: z.number().int().min(10).max(20000).optional(),
      peakThreshold: z.number().min(0).max(1).optional(),
      minGapSeconds: z.number().min(0).optional(),
    },
    handler: async (args) => {
      const filePath = args.filePath.replace(/^~(?=$|\/|\\)/, os.homedir());
      if (!fs.existsSync(filePath)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'not-found', message: `File not found: ${filePath}` }) }], isError: true };
      }
      let buf: Buffer = fs.readFileSync(filePath);
      let decodedWith = 'wav';
      let result = analyzeWav(buf, args.numPoints ?? 200, args.peakThreshold ?? 0.6, args.minGapSeconds ?? 0.08);
      if (!result) {
        if (!ffmpegAvailable()) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'unsupported-format', message: 'Only uncompressed PCM WAV can be read directly, and ffmpeg was not found on PATH to decode this file. Install ffmpeg or convert the file to WAV.' }) }], isError: true };
        }
        try {
          buf = decodeWithFfmpeg(filePath);
          decodedWith = 'ffmpeg';
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'decode-failed', message: `ffmpeg could not decode the file: ${(err as Error).message}` }) }], isError: true };
        }
        result = analyzeWav(buf, args.numPoints ?? 200, args.peakThreshold ?? 0.6, args.minGapSeconds ?? 0.08);
        if (!result) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'decode-failed', message: 'ffmpeg produced no readable audio.' }) }], isError: true };
        }
      }
      return {
        filePath,
        decodedWith,
        duration: result.duration,
        sampleRate: result.sampleRate,
        channels: result.channels,
        numPoints: result.waveformPoints.length,
        peakCount: result.peakTimes.length,
        peakTimes: result.peakTimes,
        waveformPoints: result.waveformPoints,
      };
    },
  });
}
