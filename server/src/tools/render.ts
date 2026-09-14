/*
 * Render and preview tools.
 *
 * see-frame and see-frames are the agent's eyes: the panel writes a full-size
 * PNG into the bridge frames folder, the server downsizes it with pngjs and
 * returns it as an MCP image content block. export-frame-png and
 * export-still-sequence write PNGs to paths the human asked for. The render
 * queue tools wrap app.project.renderQueue; `render` can also spawn the
 * aerender command line tool outside the panel.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import type { JsonValue } from '../bridge/types.js';
import { decodePng, encodePng, resizeImage, scalePngBuffer, targetSize, tileImages, type RgbaImage } from '../render/png.js';
import { CompRef, TimeArgs } from '../schemas/common.js';
import { defineTool, jsonResult, type ToolContext } from './registry.js';

/* ------------------------------------------------------------ helpers */

function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/|\\)/, os.homedir());
}

interface FrameInfo {
  file: string;
  width: number;
  height: number;
  time: number;
  frame: number;
  composition: { id: number; name: string };
  method: string;
  index?: number;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asFrameInfo(v: unknown): FrameInfo {
  const r = asRecord(v);
  const comp = asRecord(r.composition);
  return {
    file: String(r.file ?? ''),
    width: Number(r.width ?? 0),
    height: Number(r.height ?? 0),
    time: Number(r.time ?? 0),
    frame: Number(r.frame ?? 0),
    composition: { id: Number(comp.id ?? 0), name: String(comp.name ?? '') },
    method: String(r.method ?? ''),
    index: r.index === undefined ? undefined : Number(r.index),
  };
}

function missingFrameResult(tool: string, file: string, framesDir: string, extra: Record<string, unknown> = {}): CallToolResult {
  return jsonResult(
    {
      tool,
      error: 'frame-missing',
      message:
        `After Effects reported that it wrote ${file}, but the server cannot read it. ` +
        `The server looks in its bridge frames folder (${framesDir}). If After Effects runs under another user, on another machine, or the bridge folder ` +
        'is not shared, the two sides see different folders. Check AE_MCP_BRIDGE_DIR on the server and the folder shown in the MCP Bridge Auto panel.',
      file,
      framesDir,
      ...extra,
    },
    true
  );
}

function readFrameFile(file: string): Buffer | undefined {
  try {
    if (!file || !fs.existsSync(file)) return undefined;
    return fs.readFileSync(file);
  } catch {
    return undefined;
  }
}

/** Downsizes a PNG file on disk in place. Returns the new size. */
function resizeFileInPlace(file: string, scale: number | undefined, maxWidth: number | undefined): { width: number; height: number; sourceWidth: number; sourceHeight: number; resized: boolean } {
  const buf = fs.readFileSync(file);
  const src = decodePng(buf);
  const size = targetSize(src.width, src.height, scale, maxWidth);
  if (size.width >= src.width && size.height >= src.height) return { width: src.width, height: src.height, sourceWidth: src.width, sourceHeight: src.height, resized: false };
  const out = resizeImage(src, size.width, size.height);
  fs.writeFileSync(file, encodePng(out));
  return { width: out.width, height: out.height, sourceWidth: src.width, sourceHeight: src.height, resized: true };
}

/* --------------------------------------------------------- aerender */

export interface AerenderLaunch {
  binary: string;
  args: string[];
  logPath: string;
  pid: number | undefined;
}

/**
 * Locates the aerender binary. Overridable for tests and for unusual installs:
 * an explicit path wins, then AE_MCP_AERENDER_PATH, then the newest install.
 */
export const renderConfig = {
  findAerender(explicit?: string): string | undefined {
    const candidates: string[] = [];
    if (explicit) candidates.push(expandHome(explicit));
    if (process.env.AE_MCP_AERENDER_PATH) candidates.push(process.env.AE_MCP_AERENDER_PATH);
    const roots = process.platform === 'win32' ? ['C:\\Program Files\\Adobe'] : ['/Applications'];
    for (const root of roots) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(root).filter((n) => /^Adobe After Effects/i.test(n)).sort().reverse();
      } catch {
        names = [];
      }
      for (const n of names) {
        candidates.push(process.platform === 'win32' ? path.join(root, n, 'Support Files', 'aerender.exe') : path.join(root, n, 'aerender'));
      }
    }
    return candidates.find((c) => {
      try {
        return fs.statSync(c).isFile();
      } catch {
        return false;
      }
    });
  },
};

/** Throws with a plain message when the project on disk is not what After Effects has in memory. */
export function assertProjectSavedForAerender(info: unknown): string {
  const r = asRecord(info);
  const projectPath = typeof r.path === 'string' && r.path !== '' ? r.path : undefined;
  if (!projectPath) {
    throw new Error('The project has never been saved, so aerender has no .aep file to open. Call save-project-as with a path first, then render again with useAerender true.');
  }
  if (r.dirty === true || r.saved === false) {
    throw new Error(`The project has unsaved changes. aerender reads the .aep on disk (${projectPath}), so it would render the old version. Call save-project first, then render again with useAerender true.`);
  }
  return projectPath;
}

export function launchAerender(binary: string, args: string[], logDir: string): AerenderLaunch {
  const logPath = path.join(logDir, `aerender-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const fd = fs.openSync(logPath, 'a');
  fs.writeSync(fd, `# ${new Date().toISOString()} ${binary} ${args.map((a) => JSON.stringify(a)).join(' ')}\n`);
  const child = spawn(binary, args, { detached: true, stdio: ['ignore', fd, fd] });
  child.on('error', (err) => {
    try {
      fs.appendFileSync(logPath, `\n# spawn error: ${err.message}\n`);
    } catch {
      // nothing else to do
    }
  });
  child.unref();
  fs.closeSync(fd);
  return { binary, args, logPath, pid: child.pid };
}

/* ------------------------------------------------------------- schemas */

const ScaleArg = z.number().min(0.1).max(1).optional();

const FrameSelection = {
  count: z.number().int().min(1).max(25).optional().describe('How many frames, evenly spaced across the composition (or the work area when useWorkArea is true). Default 4. Ignored when times or frames is given.'),
  times: z.array(z.number()).min(1).max(25).optional().describe('Explicit times in seconds.'),
  frames: z.array(z.number().int()).min(1).max(25).optional().describe('Explicit frame numbers. Wins over times.'),
  useWorkArea: z.boolean().optional().describe('Space count frames across the work area instead of the whole composition. Default false.'),
};

/* --------------------------------------------------------------- tools */

export function registerRenderTools(server: McpServer): void {
  defineTool(server, {
    name: 'see-frame',
    group: 'render',
    mutating: false,
    timeout: 'render',
    description:
      'Renders one frame of a composition and returns it as an image you can look at. This is how you check your own work: after building or changing anything visual, call see-frame at the relevant time and confirm the layers, colours, text and positions are what you intended before you report success to the human. ' +
      'Use when: verifying a change, comparing before and after (call it twice), or describing what a composition looks like. Do not use for: files the human keeps (export-frame-png) or several moments at once (see-frames). ' +
      'Inputs: comp (default the active composition); time in seconds or frame (default the current time); scale 0.1 to 1 (default 0.5, keeps the payload small); maxWidth in pixels (default 1280) as a second cap; setCurrentTime (default true) also moves the playhead there; includeInfo (default true) adds a JSON block with the file path and sizes. ' +
      'Returns: an image content block (PNG) plus text with file, time, frame, width, height and the capture method. ' +
      'Notes: the full-size PNG stays in the bridge frames folder until the server cleans it up. Capture uses saveFrameToPng (After Effects 22.3 and later) and falls back to a temporary render queue item on older versions, which is slower. Unverified against a real After Effects in this build. ' +
      'Example: after animating a title, see-frame with time 1.0 and check the title is fully on screen.',
    input: {
      comp: CompRef.optional(),
      ...TimeArgs,
      scale: ScaleArg.describe('Downscale factor applied on the server, 0.1 to 1. Default 0.5.'),
      maxWidth: z.number().int().min(16).max(8192).optional().describe('Cap on the returned image width in pixels. Default 1280.'),
      setCurrentTime: z.boolean().optional().describe('Move the playhead to the captured time. Default true.'),
      includeInfo: z.boolean().optional().describe('Add a JSON text block with file and size details. Default true.'),
    },
    handler: async (args, ctx) => {
      const framesDir = ctx.bridge.paths.frames;
      const raw = await ctx.run('seeFrame', { comp: args.comp, time: args.time, frame: args.frame, setCurrentTime: args.setCurrentTime ?? true, outputDir: framesDir }, 'render');
      const info = asFrameInfo(raw);
      const buf = readFrameFile(info.file);
      if (!buf) return missingFrameResult('see-frame', info.file, framesDir, { bridgeResult: raw as JsonValue });
      const scaled = scalePngBuffer(buf, args.scale ?? 0.5, args.maxWidth ?? 1280);
      const text = {
        composition: info.composition,
        time: info.time,
        frame: info.frame,
        file: info.file,
        method: info.method,
        width: scaled.width,
        height: scaled.height,
        sourceWidth: scaled.sourceWidth,
        sourceHeight: scaled.sourceHeight,
        scale: args.scale ?? 0.5,
      };
      const content: CallToolResult['content'] = [{ type: 'image', data: scaled.png.toString('base64'), mimeType: 'image/png' }];
      if (args.includeInfo !== false) content.push({ type: 'text', text: JSON.stringify(text, null, 2) });
      return { content } as CallToolResult;
    },
  });

  defineTool(server, {
    name: 'see-frames',
    group: 'render',
    mutating: false,
    timeout: 'render',
    description:
      'Renders several frames of a composition and returns them tiled into one contact-sheet image, so you can check motion over time in a single look. ' +
      'Use when: verifying an animation (does the logo arrive by frame 30, is the fade smooth), or reviewing a whole composition quickly. Do not use for: one moment in detail (see-frame) or files for the human (export-still-sequence). ' +
      'Inputs: comp; count (default 4, evenly spaced over the composition, or the work area when useWorkArea is true) or explicit times[] in seconds or frames[]; columns (default min(count, 3)); scale 0.1 to 1 per tile (default 0.33); maxWidth for the whole sheet (default 1600); label (default true) draws a one pixel white border around each tile. At most 25 frames per call. ' +
      'Returns: one PNG image content block plus text with tiles[] mapping each tile index to its time, frame and pixel rectangle {x, y, w, h} in the sheet, reading left to right, top to bottom. ' +
      'Notes: frame numbers are not drawn on the image; use the tiles[] map. Each frame is captured full size first, so 25 frames of a 4K composition takes a while. Unverified against a real After Effects in this build. ' +
      'Example: count 6, columns 3, useWorkArea true, then compare tile 0 with tile 5.',
    input: {
      comp: CompRef.optional(),
      ...FrameSelection,
      columns: z.number().int().min(1).max(10).optional().describe('Tiles per row. Default min(count, 3).'),
      scale: ScaleArg.describe('Downscale factor per tile, 0.1 to 1. Default 0.33.'),
      maxWidth: z.number().int().min(64).max(8192).optional().describe('Cap on the whole sheet width in pixels. Default 1600.'),
      label: z.boolean().optional().describe('Draw a one pixel border around each tile. Default true.'),
    },
    handler: async (args, ctx) => {
      const framesDir = ctx.bridge.paths.frames;
      const raw = await ctx.run('seeFrames', { comp: args.comp, count: args.count, times: args.times, frames: args.frames, useWorkArea: args.useWorkArea, outputDir: framesDir }, 'render');
      const result = asRecord(raw);
      const frames = (Array.isArray(result.frames) ? result.frames : []).map(asFrameInfo);
      if (frames.length === 0) return jsonResult({ tool: 'see-frames', error: 'no-frames', message: 'After Effects returned no frames.', bridgeResult: raw }, true);
      const images: RgbaImage[] = [];
      for (const f of frames) {
        const buf = readFrameFile(f.file);
        if (!buf) return missingFrameResult('see-frames', f.file, framesDir);
        images.push(decodePng(buf));
      }
      const columns = args.columns ?? Math.min(frames.length, 3);
      const sheet = tileImages(images, { columns, scale: args.scale ?? 0.33, maxWidth: args.maxWidth ?? 1600, border: args.label !== false });
      const tiles = sheet.layout.positions.map((p) => ({ index: p.index, time: frames[p.index].time, frame: frames[p.index].frame, file: frames[p.index].file, x: p.x, y: p.y, w: p.w, h: p.h }));
      const text = {
        composition: frames[0].composition,
        count: frames.length,
        columns: sheet.layout.columns,
        rows: sheet.layout.rows,
        width: sheet.layout.width,
        height: sheet.layout.height,
        tileWidth: sheet.layout.tileWidth,
        tileHeight: sheet.layout.tileHeight,
        sourceWidth: images[0].width,
        sourceHeight: images[0].height,
        tiles,
      };
      return {
        content: [
          { type: 'image', data: sheet.png.toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify(text, null, 2) },
        ],
      } as CallToolResult;
    },
  });

  defineTool(server, {
    name: 'export-frame-png',
    group: 'render',
    mutating: false,
    timeout: 'render',
    description:
      'Saves one frame of a composition as a PNG file at a path the human chooses. Nothing is returned as an image; call see-frame when you want to look at it yourself. ' +
      'Use when: the human asks for a still, a thumbnail or a poster frame on disk. Do not use for: checking your own work (see-frame) or many frames (export-still-sequence). ' +
      'Inputs: comp; time in seconds or frame (default the current time); outputPath, an absolute path ending in .png (a leading ~ is expanded, folders are created); scale 0.1 to 1 (optional) downsizes the file on the server after the full-size capture. ' +
      'Returns: file, width, height, time, frame, the composition reference and the capture method. ' +
      'Notes: the file is written at full composition size by After Effects first and only then downsized, so a scale below 1 costs a little extra time. An existing file at the path is replaced. Unverified against a real After Effects in this build. ' +
      'Example: outputPath "~/Desktop/title-frame.png", frame 45.',
    input: {
      comp: CompRef.optional(),
      ...TimeArgs,
      outputPath: z.string().min(1).describe('Absolute path for the PNG. A leading ~ is expanded.'),
      scale: ScaleArg.describe('Optional downscale factor applied on the server, 0.1 to 1. Default 1 (full size).'),
    },
    handler: async (args, ctx) => {
      const outputPath = path.resolve(expandHome(args.outputPath));
      const raw = await ctx.run('exportFramePng', { comp: args.comp, time: args.time, frame: args.frame, outputPath }, 'render');
      const info = asFrameInfo(raw);
      const out: Record<string, unknown> = { ...asRecord(raw) };
      const file = fs.existsSync(info.file) ? info.file : fs.existsSync(outputPath) ? outputPath : undefined;
      if (!file) {
        return jsonResult({ tool: 'export-frame-png', error: 'frame-missing', message: `After Effects reported success but ${info.file || outputPath} does not exist on the server side.`, bridgeResult: raw }, true);
      }
      if (args.scale !== undefined && args.scale < 1) {
        const r = resizeFileInPlace(file, args.scale, undefined);
        out.width = r.width;
        out.height = r.height;
        out.sourceWidth = r.sourceWidth;
        out.sourceHeight = r.sourceHeight;
        out.scale = args.scale;
      } else {
        try {
          const dims = decodePng(fs.readFileSync(file));
          out.width = dims.width;
          out.height = dims.height;
        } catch {
          // keep the sizes After Effects reported
        }
      }
      out.file = file;
      return out;
    },
  });

  defineTool(server, {
    name: 'export-still-sequence',
    group: 'render',
    mutating: false,
    timeout: 'render',
    description:
      'Saves many frames of a composition as numbered PNG files in a folder, one file per frame, without touching the render queue. ' +
      'Use when: the human wants an image sequence, storyboard stills or every Nth frame on disk. Do not use for: a movie file (add-to-render-queue then render) or checking your own work (see-frames). ' +
      'Inputs: comp; outputDir (absolute, ~ expanded, created if missing); filePrefix (default the composition name); which frames: start and end in seconds (default the whole composition, or the work area with useWorkArea true) for every frame in that range, count for evenly spaced frames in that range, or explicit frames[] or times[]; format only "png"; scale 0.1 to 1 (optional, applied on the server); maxFrames cap (default 300) and allowLarge true to go past it. ' +
      'Returns: outputDir, count, method and files[] with index, frame, time and file, named <prefix>_<frame padded to 5 digits>.png. ' +
      'Notes: each frame is a separate capture, so a 300 frame sequence can take minutes; the server waits with the render timeout. Existing files with the same names are replaced. Unverified against a real After Effects in this build. ' +
      'Example: outputDir "~/Desktop/stills", count 12, useWorkArea true.',
    input: {
      comp: CompRef.optional(),
      outputDir: z.string().min(1).describe('Folder for the PNG files. A leading ~ is expanded. Created if missing.'),
      filePrefix: z.string().optional().describe('File name prefix. Default the composition name with unsafe characters replaced.'),
      start: z.number().optional().describe('Range start in seconds. Default 0 or the work area start.'),
      end: z.number().optional().describe('Range end in seconds. Default the composition end or the work area end.'),
      useWorkArea: z.boolean().optional().describe('Use the work area as the default range. Default false.'),
      count: z.number().int().min(1).optional().describe('Evenly spaced frames within the range instead of every frame.'),
      frames: z.array(z.number().int()).min(1).optional().describe('Explicit frame numbers. Wins over times and the range.'),
      times: z.array(z.number()).min(1).optional().describe('Explicit times in seconds.'),
      format: z.enum(['png']).optional().describe('Only "png" is supported.'),
      scale: ScaleArg.describe('Optional downscale factor applied on the server, 0.1 to 1.'),
      maxFrames: z.number().int().min(1).optional().describe('Refuse to export more frames than this. Default 300.'),
      allowLarge: z.boolean().optional().describe('Lift the maxFrames cap. Default false.'),
    },
    handler: async (args, ctx) => {
      const outputDir = path.resolve(expandHome(args.outputDir));
      const { scale, ...rest } = args;
      const raw = await ctx.run('exportStillSequence', { ...rest, outputDir }, 'render');
      const result = { ...asRecord(raw) };
      const files = Array.isArray(result.files) ? (result.files as unknown[]).map(asRecord) : [];
      if (scale !== undefined && scale < 1) {
        let resizedCount = 0;
        for (const f of files) {
          const file = typeof f.file === 'string' ? f.file : '';
          if (file && fs.existsSync(file)) {
            const r = resizeFileInPlace(file, scale, undefined);
            f.width = r.width;
            f.height = r.height;
            if (r.resized) resizedCount++;
          }
        }
        result.scale = scale;
        result.resizedCount = resizedCount;
        result.files = files;
      }
      const missing = files.filter((f) => typeof f.file !== 'string' || !fs.existsSync(f.file)).length;
      if (missing > 0) result.missingOnServer = missing;
      return result;
    },
  });

  defineTool(server, {
    name: 'add-to-render-queue',
    group: 'render',
    description:
      'Adds a composition to the render queue with an output path and optional templates, the same as Composition > Add to Render Queue followed by setting the output file. Nothing renders until you call render. ' +
      'Use when: preparing a movie or image sequence export. Do not use for: single stills (export-frame-png) or looking at a frame (see-frame). ' +
      'Inputs: comp; outputPath, an absolute file path (~ expanded; for image sequences include a frame pattern such as name_[#####].png); outputModuleTemplate, a name from list-output-module-templates (default the current default template); renderSettingsTemplate from list-render-settings-templates; useWorkArea (default true) renders the work area, or start and end in seconds; skipExisting to skip frames already on disk. ' +
      'Returns: itemIndex (1-based position in the queue), comp, outputPath, status (QUEUED, NEEDS_OUTPUT and so on), timeSpanStart, timeSpanDuration and the output modules. ' +
      'Notes: the file extension comes from the output module template, so pass a path that matches it (for example .mov for a QuickTime template). The item stays in the queue until clear-render-queue. Undoable in one step. Unverified against a real After Effects in this build. ' +
      'Example: comp {name: "Main"}, outputPath "~/Movies/main.mov", outputModuleTemplate "H.264 - Match Render Settings - 15 Mbps".',
    input: {
      comp: CompRef.optional(),
      outputPath: z.string().min(1).describe('Absolute output file path. A leading ~ is expanded. Sequences may use a [#####] frame pattern.'),
      outputModuleTemplate: z.string().optional().describe('Output module template name. See list-output-module-templates.'),
      renderSettingsTemplate: z.string().optional().describe('Render settings template name. See list-render-settings-templates.'),
      useWorkArea: z.boolean().optional().describe('Render the work area. Default true. Ignored when start or end is given.'),
      start: z.number().optional().describe('Range start in seconds.'),
      end: z.number().optional().describe('Range end in seconds.'),
      skipExisting: z.boolean().optional().describe('Skip frames whose files already exist. Default false.'),
    },
    toBridgeArgs: (args) => ({ ...args, outputPath: expandHome(args.outputPath) }),
  });

  defineTool(server, {
    name: 'list-render-queue',
    group: 'render',
    mutating: false,
    description:
      'Lists every item in the render queue with its composition, status, output paths, templates and time span, so you can see what is waiting, done or failed. ' +
      'Use when: checking what add-to-render-queue produced, finding items to remove, or reading the result of a render that timed out. Do not use for: template names (list-output-module-templates, list-render-settings-templates). ' +
      'Inputs: none. ' +
      'Returns: count, rendering (true while After Effects renders), items[] with index, comp, status (one of QUEUED, UNQUEUED, RENDERING, DONE, ERR_STOPPED, USER_STOPPED, NEEDS_OUTPUT, WILL_CONTINUE), render flag, timeSpanStart, timeSpanDuration, elapsedSeconds, outputPaths[] and outputModules[] with file and template. ' +
      'Notes: read-only. NEEDS_OUTPUT means the item has no output file set. Indices shift when items are removed. ' +
      'Example: call it after render to collect outputPaths of the DONE items.',
    input: {},
  });

  defineTool(server, {
    name: 'clear-render-queue',
    group: 'render',
    description:
      'Removes items from the render queue: all of them, or only the finished and unqueued ones when onlyFinished is true. ' +
      'Use when: starting a clean export, or tidying after a render. Do not use for: stopping a render in progress (not possible from the bridge; the human must stop it in After Effects). ' +
      'Inputs: onlyFinished (default false) keeps items whose status is QUEUED, RENDERING, NEEDS_OUTPUT or WILL_CONTINUE and removes DONE, UNQUEUED, ERR_STOPPED and USER_STOPPED ones. ' +
      'Returns: removed count and remaining count. ' +
      'Notes: fails while a render is running. Undoable in one step. ' +
      'Example: onlyFinished true after render, then list-render-queue to confirm the queue is empty.',
    input: { onlyFinished: z.boolean().optional().describe('Remove only finished or unqueued items. Default false.') },
  });

  defineTool(server, {
    name: 'render',
    group: 'render',
    timeout: 'render',
    description:
      'Starts rendering the queued render queue items. By default After Effects renders inside the application and this call blocks until every queued item is done, then returns per-item status, elapsed time and output files. With useAerender true the server instead launches the aerender command line tool on the saved project file and returns at once with a process id and a log file path. ' +
      'Use when: the queue is prepared with add-to-render-queue. Do not use for: stills (export-frame-png) or previews (see-frame). ' +
      'Inputs: itemIndices[] to render only some items (others are unqueued for this run); useAerender (default false); with aerender: comp name (required), outputPath (required, ~ expanded), outputModuleTemplate, renderSettingsTemplate, aerenderPath to point at the binary when it is not found automatically. ' +
      'Returns: in-app: count, done, failed, elapsedSeconds, outputFiles[] and items[]. aerender: pid, logPath, binary and args. ' +
      'Notes: the in-app render blocks the panel, so nothing else can run until it finishes; if this call times out the render continues, and get-results with the returned id, or list-render-queue, shows the outcome later. aerender needs the project saved with no unsaved changes (save-project first) and there is no polling tool; tell the human where the log is. Unverified against a real After Effects in this build. ' +
      'Example: add-to-render-queue, then render with no arguments and wait.',
    input: {
      itemIndices: z.array(z.number().int().positive()).optional().describe('1-based render queue indices to render. Default: every queued item.'),
      useAerender: z.boolean().optional().describe('Spawn the aerender command line tool instead of rendering inside After Effects. Default false.'),
      comp: z.string().optional().describe('aerender only: composition name to render.'),
      outputPath: z.string().optional().describe('aerender only: output file path. A leading ~ is expanded.'),
      outputModuleTemplate: z.string().optional().describe('aerender only: output module template name (-OMtemplate).'),
      renderSettingsTemplate: z.string().optional().describe('aerender only: render settings template name (-RStemplate).'),
      aerenderPath: z.string().optional().describe('aerender only: path to the aerender binary when it is not in the default install folder.'),
    },
    handler: async (args, ctx) => {
      if (!args.useAerender) {
        return ctx.run('render', { itemIndices: args.itemIndices }, 'render');
      }
      return startAerender(args, ctx);
    },
  });

  defineTool(server, {
    name: 'list-output-module-templates',
    group: 'render',
    mutating: false,
    description:
      'Lists the output module template names (file format and codec presets such as "Lossless", "H.264 - Match Render Settings - 15 Mbps" or "PNG Sequence") and the render settings template names available in this After Effects, for use with add-to-render-queue. ' +
      'Use when: choosing a format before add-to-render-queue, or when applying a template failed and you need the exact spelling. Do not use for: effect templates (list-effect-templates). ' +
      'Inputs: comp (optional). ' +
      'Returns: outputModuleTemplates[], renderSettingsTemplates[], the composition used and currentOutputModule, the template a new item gets by default. ' +
      'Notes: read-only in effect, but After Effects only exposes templates on a render queue item, so the command adds a temporary item for the given composition (or the active one, or the first in the project), reads the lists and removes the item again. Names starting with _HIDDEN are left out. ' +
      'Example: call it once, then add-to-render-queue with outputModuleTemplate "PNG Sequence".',
    input: { comp: CompRef.optional() },
  });

  defineTool(server, {
    name: 'list-render-settings-templates',
    group: 'render',
    mutating: false,
    description:
      'Lists the render settings template names (quality and resolution presets such as "Best Settings", "Draft Settings" or "Current Settings") for use as renderSettingsTemplate in add-to-render-queue. ' +
      'Use when: you want a draft or a full quality render and need the exact template name. Do not use for: output formats (list-output-module-templates). ' +
      'Inputs: comp (optional). ' +
      'Returns: renderSettingsTemplates[] and the composition used. ' +
      'Notes: After Effects only exposes templates on a render queue item, so a temporary item is added for the composition and removed right after. Names starting with _HIDDEN are left out. ' +
      'Example: renderSettingsTemplate "Draft Settings" for a quick check render.',
    input: { comp: CompRef.optional() },
  });
}

interface AerenderArgs {
  comp?: string;
  outputPath?: string;
  outputModuleTemplate?: string;
  renderSettingsTemplate?: string;
  aerenderPath?: string;
}

async function startAerender(args: AerenderArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
  if (!args.comp) throw new Error('useAerender needs comp, the name of the composition to render.');
  if (!args.outputPath) throw new Error('useAerender needs outputPath, where the rendered file goes.');
  const info = await ctx.run('getProjectInfo', { maxItems: 0 });
  const projectPath = assertProjectSavedForAerender(info);
  const binary = renderConfig.findAerender(args.aerenderPath);
  if (!binary) {
    throw new Error(
      'aerender was not found. Looked in the default After Effects install folders. Pass aerenderPath (mac: /Applications/Adobe After Effects <year>/aerender, windows: C:\\Program Files\\Adobe\\Adobe After Effects <year>\\Support Files\\aerender.exe) or set AE_MCP_AERENDER_PATH.'
    );
  }
  const outputPath = path.resolve(expandHome(args.outputPath));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const cli = ['-project', projectPath, '-comp', args.comp, '-output', outputPath];
  if (args.outputModuleTemplate) cli.push('-OMtemplate', args.outputModuleTemplate);
  if (args.renderSettingsTemplate) cli.push('-RStemplate', args.renderSettingsTemplate);
  const launch = launchAerender(binary, cli, ctx.bridge.paths.root);
  return {
    started: true,
    pid: launch.pid ?? null,
    binary: launch.binary,
    args: launch.args,
    project: projectPath,
    comp: args.comp,
    outputPath,
    logPath: launch.logPath,
    note: 'aerender runs outside the panel. There is no tool to poll it; the human can watch the log file, and the output file appears when it finishes.',
  };
}
