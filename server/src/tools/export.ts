/*
 * One-step export and previews. aerender renders the saved project in the
 * background (its own process, low priority), ffmpeg converts where After
 * Effects has no direct format (GIF, WebM, small previews), and a job folder
 * in <bridge>/exports/<id>/ holds the script, the log and the status, so
 * get-export-status can report progress while After Effects stays free.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { CompRef } from '../schemas/common.js';
import { expandHome } from './components.js';
import { defineTool, type ToolContext } from './registry.js';
import { assertProjectSavedForAerender, renderConfig } from './render.js';

export const EXPORT_FORMATS = ['mp4', 'prores-422', 'prores-4444', 'gif', 'webm', 'preview'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

interface FormatPlan {
  ext: string;
  /** Output module template aerender renders with. */
  template: string;
  /** ffmpeg arguments after the input, or null when the render is the final file. */
  ffmpeg: ((o: { scale: number; fps: number; width: number; out: string; progress: string }) => string[]) | null;
}

const even = 'trunc(iw*{s}/2)*2:trunc(ih*{s}/2)*2';

export const FORMAT_PLANS: Record<ExportFormat, FormatPlan> = {
  mp4: {
    ext: 'mp4',
    template: 'H.264 - Match Render Settings - 40 Mbps',
    ffmpeg: null,
  },
  'prores-422': { ext: 'mov', template: 'High Quality', ffmpeg: null },
  'prores-4444': { ext: 'mov', template: 'High Quality with Alpha', ffmpeg: null },
  gif: {
    ext: 'gif',
    template: 'High Quality',
    ffmpeg: (o) => ['-vf', `fps=${o.fps},scale=${o.width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', '-progress', o.progress, o.out],
  },
  webm: {
    ext: 'webm',
    template: 'High Quality with Alpha',
    ffmpeg: (o) => ['-vf', `scale=${even.replace(/\{s\}/g, String(o.scale))}`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-c:a', 'libopus', '-progress', o.progress, o.out],
  },
  preview: {
    ext: 'mp4',
    template: 'H.264 - Match Render Settings - 15 Mbps',
    ffmpeg: (o) => ['-vf', `scale='min(${o.width},iw)':-2`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', '-progress', o.progress, o.out],
  },
};

/** ffmpeg for an mp4 at a scale below 1: re-encode the 40 Mbps render. */
function scaledMp4Args(o: { scale: number; out: string; progress: string }): string[] {
  return ['-vf', `scale=${even.replace(/\{s\}/g, String(o.scale))}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'copy', '-progress', o.progress, o.out];
}

function findFfmpeg(): string | null {
  const env = process.env.AE_MCP_FFMPEG;
  if (env && fs.existsSync(env)) return env;
  for (const p of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) if (fs.existsSync(p)) return p;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
  const line = (r.stdout ?? '').split(/\r?\n/)[0].trim();
  return line && fs.existsSync(line) ? line : null;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function exportsRoot(ctx: ToolContext): string {
  return path.join(ctx.bridge.paths.root, 'exports');
}

export function defaultExportDir(): string {
  return process.env.AE_MCP_EXPORT_DIR ? path.resolve(expandHome(process.env.AE_MCP_EXPORT_DIR)) : path.join(os.homedir(), 'Movies', 'After Effects Exports');
}

export function defaultPreviewDir(bridgeRoot: string): string {
  return process.env.AE_MCP_PREVIEW_DIR ? path.resolve(expandHome(process.env.AE_MCP_PREVIEW_DIR)) : path.join(bridgeRoot, 'previews');
}

function safeFile(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Export';
}

export interface JobInfo {
  id: string;
  format: ExportFormat;
  comp: string;
  project: string;
  output: string;
  intermediate: string | null;
  frames: number;
  startFrame: number;
  endFrame: number;
  fps: number;
  startedAt: string;
  dir: string;
  pid?: number;
}

/** The shell script a job runs: aerender at low priority, then ffmpeg if needed, writing its phase to status. */
export function jobScript(job: JobInfo, aerender: string, ffmpeg: string | null, ffmpegArgs: string[] | null): string {
  const st = path.join(job.dir, 'status');
  const log = path.join(job.dir, 'render.log');
  const lines = [
    '#!/bin/sh',
    `echo rendering > ${q(st)}`,
    `nice -n 15 ${q(aerender)} -project ${q(job.project)} -comp ${q(job.comp)} -RStemplate 'Best Settings' -OMtemplate ${q(FORMAT_PLANS[job.format].template)} -output ${q(job.intermediate ?? job.output)} -s ${job.startFrame} -e ${job.endFrame} -v ERRORS_AND_PROGRESS >> ${q(log)} 2>&1 || { echo failed > ${q(st)}; exit 1; }`,
  ];
  if (ffmpegArgs && ffmpeg && job.intermediate) {
    lines.push(`echo converting > ${q(st)}`);
    lines.push(`nice -n 15 ${q(ffmpeg)} -y -hide_banner -loglevel error -i ${q(job.intermediate)} ${ffmpegArgs.map(q).join(' ')} >> ${q(log)} 2>&1 || { echo failed > ${q(st)}; exit 1; }`);
    lines.push(`rm -f ${q(job.intermediate)}`);
  }
  lines.push(`echo done > ${q(st)}`);
  return lines.join('\n') + '\n';
}

/** Progress of a job from its status file and logs: phase, percent and the last error lines. */
export function readJob(dir: string): Record<string, unknown> {
  let info: JobInfo;
  try {
    info = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')) as JobInfo;
  } catch {
    return { error: `No export job in ${dir}.` };
  }
  const status = fs.existsSync(path.join(dir, 'status')) ? fs.readFileSync(path.join(dir, 'status'), 'utf8').trim() : 'starting';
  const log = fs.existsSync(path.join(dir, 'render.log')) ? fs.readFileSync(path.join(dir, 'render.log'), 'utf8') : '';
  let percent: number | null = null;
  if (status === 'rendering') {
    const frames = [...log.matchAll(/PROGRESS:\s+\S+\s+\((\d+)\)/g)].map((m) => Number(m[1]));
    if (frames.length) percent = Math.min(99, Math.round(((frames[frames.length - 1] - info.startFrame) / Math.max(1, info.frames)) * 100));
    else percent = 0;
  } else if (status === 'converting') {
    const prog = fs.existsSync(path.join(dir, 'ffmpeg.progress')) ? fs.readFileSync(path.join(dir, 'ffmpeg.progress'), 'utf8') : '';
    const ms = [...prog.matchAll(/out_time_ms=(\d+)/g)].map((m) => Number(m[1]));
    const total = (info.frames / info.fps) * 1e6;
    percent = ms.length ? Math.min(99, Math.round((ms[ms.length - 1] / total) * 100)) : 0;
  } else if (status === 'done') percent = 100;
  const out: Record<string, unknown> = { id: info.id, format: info.format, comp: info.comp, status, percent, output: info.output, startedAt: info.startedAt, seconds: Math.round((Date.now() - Date.parse(info.startedAt)) / 1000) };
  if (status === 'done' && fs.existsSync(info.output)) out.bytes = fs.statSync(info.output).size;
  if (status === 'failed') {
    const errs = log.split(/\r?\n/).filter((l) => /error|fail|unable|cannot|could not/i.test(l)).slice(-6);
    out.errors = errs.length ? errs : log.split(/\r?\n/).filter(Boolean).slice(-6);
  }
  return out;
}

async function startExport(args: Record<string, any>, ctx: ToolContext, preview: boolean): Promise<Record<string, unknown>> {
  if (process.platform === 'win32') throw new Error('Background export runs on macOS for now. On Windows use add-to-render-queue and render.');
  const format: ExportFormat = preview ? 'preview' : args.format;
  const plan = FORMAT_PLANS[format];
  if (args.saveFirst) await ctx.run('saveProject', {});
  const project = assertProjectSavedForAerender(await ctx.run('getProjectInfo', { maxItems: 0 }));
  const comp = (await ctx.run('getCompositionInfo', { comp: args.comp })) as Record<string, any>;
  const c = comp.composition ?? comp;
  const fps = Number(c.frameRate);
  const name = String(c.name);
  const total = Math.round(Number(c.duration) * fps);
  let s = 0;
  let e = total - 1;
  if (args.useWorkArea && typeof c.workAreaStart === 'number') {
    s = Math.round(c.workAreaStart * fps);
    e = Math.round((c.workAreaStart + c.workAreaDuration) * fps) - 1;
  }
  if (typeof args.startTime === 'number') s = Math.round(args.startTime * fps);
  if (typeof args.endTime === 'number') e = Math.round(args.endTime * fps) - 1;
  if (!(e >= s)) throw new Error('The range is empty: endTime must be after startTime.');
  const aerender = renderConfig.findAerender(args.aerenderPath);
  if (!aerender) throw new Error('aerender was not found in the After Effects folder. Set AE_MCP_AERENDER_PATH.');
  const scale = args.scale ?? (preview ? 1 : 1);
  const needsFfmpeg = !!plan.ffmpeg || (format === 'mp4' && scale < 1);
  const ffmpeg = needsFfmpeg ? findFfmpeg() : null;
  if (needsFfmpeg && !ffmpeg) throw new Error(`${format}${scale < 1 ? ' at a smaller scale' : ''} needs ffmpeg (brew install ffmpeg), or set AE_MCP_FFMPEG.`);
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(exportsRoot(ctx), id);
  fs.mkdirSync(dir, { recursive: true });
  const outDir = args.outputPath ? path.dirname(path.resolve(expandHome(args.outputPath))) : preview ? defaultPreviewDir(ctx.bridge.paths.root) : defaultExportDir();
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  const output = args.outputPath ? path.resolve(expandHome(args.outputPath)) : path.join(outDir, `${safeFile(name)}${preview ? ' preview' : ''} ${stamp}.${plan.ext}`);
  const intermediate = needsFfmpeg ? path.join(dir, `render.${plan.template.startsWith('H.264') ? 'mp4' : 'mov'}`) : null;
  const job: JobInfo = { id, format, comp: name, project, output, intermediate, frames: e - s + 1, startFrame: s, endFrame: e, fps, startedAt: new Date().toISOString(), dir };
  const progress = path.join(dir, 'ffmpeg.progress');
  const width = args.width ?? (format === 'gif' ? 960 : 960);
  const ffArgs = plan.ffmpeg ? plan.ffmpeg({ scale, fps: args.fps ?? 15, width, out: output, progress }) : format === 'mp4' && scale < 1 ? scaledMp4Args({ scale, out: output, progress }) : null;
  const script = path.join(dir, 'run.sh');
  fs.writeFileSync(script, jobScript(job, aerender, ffmpeg, ffArgs), { mode: 0o755 });
  const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' });
  child.unref();
  job.pid = child.pid;
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job, null, 2));
  return { ...job, status: 'started', checkWith: `get-export-status {id: "${id}"}` };
}

async function waitFor(dir: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const st = readJob(dir);
    if (st.status === 'done' || st.status === 'failed' || Date.now() > end) return st;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const RangeArgs = {
  startTime: z.number().min(0).optional().describe('Range start in seconds. Default 0 (or the work area).'),
  endTime: z.number().positive().optional().describe('Range end in seconds. Default the comp end (or the work area).'),
  useWorkArea: z.boolean().optional().describe('Export the work area only. Default false.'),
  saveFirst: z.boolean().optional().describe('Save the project first (aerender renders the saved file). Default false: unsaved changes stop the call.'),
  aerenderPath: z.string().optional().describe('Path to aerender when it is not in the After Effects folder.'),
};

export function registerExportTools(server: McpServer): void {
  defineTool(server, {
    name: 'export-video',
    group: 'render',
    mutating: false,
    timeout: 'render',
    bridge: null,
    description:
      'Exports a composition in one step, in the background so After Effects stays free: mp4 (H.264 40 Mbps), prores-422, prores-4444 (with alpha), gif (palette-optimised, 15 fps) or webm (VP9 with alpha). aerender renders the saved project at low priority and ffmpeg converts where After Effects has no direct format. ' +
      'Use when: the human wants a finished file to share, upload or hand over. Do not use for: a quick look on a phone (export-preview) or one still (export-frame-png). ' +
      'Inputs: comp; format (default mp4); outputPath (default ~/Movies/After Effects Exports/<comp> <date>.<ext>, or AE_MCP_EXPORT_DIR); scale 0.1 to 1 (mp4, webm); width for gif (default 960) and fps (default 15); startTime and endTime or useWorkArea; saveFirst; wait (default false) to block until the file is done. ' +
      'Returns: the job id, output path, frame range and status; with wait, the finished status with the file size. ' +
      'Notes: aerender reads the project on disk, so unsaved changes are not in the export (saveFirst saves them). Follow a job with get-export-status. Needs ffmpeg for gif, webm and scaled mp4. ' +
      'Example: comp {name: "Launch film"}, format "mp4", saveFirst true.',
    input: {
      comp: CompRef.optional(),
      format: z.enum(['mp4', 'prores-422', 'prores-4444', 'gif', 'webm']).optional().describe('Output format. Default mp4.'),
      outputPath: z.string().optional().describe('Output file. Default in AE_MCP_EXPORT_DIR or ~/Movies/After Effects Exports.'),
      scale: z.number().min(0.1).max(1).optional().describe('Size factor for mp4 and webm. Default 1.'),
      width: z.number().int().min(64).max(4096).optional().describe('gif width in pixels. Default 960.'),
      fps: z.number().min(1).max(60).optional().describe('gif frame rate. Default 15.'),
      wait: z.boolean().optional().describe('Wait for the file. Default false.'),
      ...RangeArgs,
    },
    handler: async (args, ctx) => {
      const started = await startExport({ ...args, format: args.format ?? 'mp4' }, ctx, false);
      if (!args.wait) return started;
      return waitFor(String(started.dir), 3 * 60 * 60 * 1000);
    },
  });

  defineTool(server, {
    name: 'export-preview',
    group: 'render',
    mutating: false,
    timeout: 'render',
    bridge: null,
    description:
      'Renders a small, phone-friendly MP4 of a composition in the background (H.264, at most 960 px wide, fast start) into the previews folder and waits for it, so it can be watched on a phone. ' +
      'Use when: the human wants to see the motion away from the Mac, or a quick review copy. Do not use for: a finished delivery (export-video). ' +
      'Inputs: comp; width (default 960); startTime and endTime or useWorkArea; saveFirst; wait (default true, up to 20 minutes); outputPath (default AE_MCP_PREVIEW_DIR, else the bridge folder\'s previews). ' +
      'Returns: the finished status with the file path and size, or the running job when wait is false or it takes longer. ' +
      'Notes: point AE_MCP_PREVIEW_DIR at a synced folder (OneDrive, iCloud Drive) and the preview appears on the phone; a chat client that can send files can also send it directly. aerender renders the saved project. ' +
      'Example: comp {name: "Scene 3"}, useWorkArea true, saveFirst true.',
    input: {
      comp: CompRef.optional(),
      width: z.number().int().min(160).max(1920).optional().describe('Maximum width in pixels. Default 960.'),
      outputPath: z.string().optional().describe('Output file. Default in AE_MCP_PREVIEW_DIR or the bridge folder\'s previews.'),
      wait: z.boolean().optional().describe('Wait for the file. Default true.'),
      ...RangeArgs,
    },
    handler: async (args, ctx) => {
      const started = await startExport(args, ctx, true);
      if (args.wait === false) return started;
      return waitFor(String(started.dir), 20 * 60 * 1000);
    },
  });

  defineTool(server, {
    name: 'get-export-status',
    group: 'render',
    mutating: false,
    bridge: null,
    description:
      'Reports background exports started by export-video or export-preview: status (starting, rendering, converting, done, failed), percent, output path and size, and the error lines of a failed job. ' +
      'Use when: following an export, or before telling the human a file is ready. Do not use for: render queue items (list-render-queue). ' +
      'Inputs: id of one job (default the 10 most recent). ' +
      'Returns: one job or a list of jobs, newest first. ' +
      'Notes: reads the job folders in the bridge folder\'s exports; it does not touch After Effects. ' +
      'Example: id "20261028-ab12".',
    input: {
      id: z.string().optional().describe('Job id from export-video or export-preview.'),
    },
    handler: async (args, ctx) => {
      const root = exportsRoot(ctx);
      if (args.id) return readJob(path.join(root, args.id));
      const ids = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'job.json'))).sort().reverse().slice(0, 10) : [];
      return { jobs: ids.map((id) => readJob(path.join(root, id))) };
    },
  });
}
