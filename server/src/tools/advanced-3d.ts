/*
 * Advanced 3D tools (group 'camera-3d'): choosing the composition's 3D
 * renderer, Geometry Options for extruded text and shape layers, and
 * image-based environment lights.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { CompRef, Easing, LayerRef, TimeArgs, Vec3 } from '../schemas/common.js';
import { defineTool } from './registry.js';

export const RENDERERS = ['classic-3d', 'advanced-3d', 'cinema-4d'] as const;
export const RENDERER_MATCH_NAMES: Record<(typeof RENDERERS)[number], string> = {
  'classic-3d': 'ADBE Advanced 3d',
  'advanced-3d': 'ADBE Calder',
  'cinema-4d': 'ADBE Ernst',
};
export const BEVEL_STYLES = ['none', 'angular', 'concave', 'convex'] as const;

const GeometryKey = z
  .object({
    ...TimeArgs,
    extrusionDepth: z.number().min(0).optional().describe('Extrusion Depth in pixels at this key.'),
    bevelDepth: z.number().min(0).optional().describe('Bevel Depth in pixels at this key.'),
    holeBevelDepth: z.number().min(0).max(100).optional().describe('Hole Bevel Depth in percent at this key.'),
    easing: Easing.optional().describe('Motion arriving at this key. Default: speed 0, influence 100 arriving and 25 leaving.'),
  })
  .refine((k) => k.time !== undefined || k.frame !== undefined, { message: 'Each key needs time (seconds) or frame.' })
  .refine((k) => k.extrusionDepth !== undefined || k.bevelDepth !== undefined || k.holeBevelDepth !== undefined, { message: 'Each key needs extrusionDepth, bevelDepth or holeBevelDepth.' });

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function registerAdvanced3dTools(server: McpServer): void {
  defineTool(server, {
    name: 'set-composition-renderer',
    group: 'camera-3d',
    description:
      'Sets the 3D renderer of a composition, the same as the 3D Renderer menu in the Composition panel: classic-3d, advanced-3d (match name ADBE Calder) or cinema-4d (ADBE Ernst). Without renderer it only lists what this After Effects offers. ' +
      'Use when: before extruding text or shapes, adding an environment light or meshes (advanced-3d), or going back to Classic 3D for layer styles and older effects. Do not use for: camera or light settings (set-camera-settings, set-light-settings). ' +
      'Inputs: comp; renderer as a name, or matchName for any entry of the available list. ' +
      'Returns: previous and current renderer (matchName and name), changed, the available renderers, and warnings such as layers with layer styles, which do not render in Advanced 3D or Cinema 4D. ' +
      'Notes: set Advanced 3D before adding a mesh or nesting a mesh comp, or After Effects shows a modal dialog. Cinema 4D may be missing from newer versions; the error lists what exists. Undoable in one step. ' +
      'Example: comp {name: "Logo 3D"}, renderer "advanced-3d".',
    input: {
      comp: CompRef.optional(),
      renderer: z.enum(RENDERERS).optional().describe('Renderer to use. Omit to only list the available renderers.'),
      matchName: z.string().min(1).optional().describe('A renderer match name from the available list. Wins over renderer.'),
    },
    toBridgeArgs: (args) => ({ ...args, rendererMatchName: args.matchName ?? (args.renderer ? RENDERER_MATCH_NAMES[args.renderer] : undefined) }),
  });

  defineTool(server, {
    name: 'set-extrusion',
    group: 'camera-3d',
    description:
      'Sets Geometry Options on a text or shape layer so it becomes a solid 3D object: extrusion depth, bevel style (none, angular, concave, convex), bevel depth and hole bevel depth, as static values or keyframes. ' +
      'Use when: extruding a logo, title or icon for a 3D shot. Do not use for: footage layer curvature, material and shadows (set-material-options) or the renderer (set-composition-renderer). ' +
      'Inputs: layer (text or shape); extrusionDepth and bevelDepth in pixels; bevelStyle; holeBevelDepth in percent; make3d (default true) turns the 3D switch on; keyframes [{time or frame, extrusionDepth, bevelDepth, holeBevelDepth, easing}]. ' +
      'Returns: the renderer, the Geometry Options values read back with property paths, what was applied, keyframes written and notes for options the renderer hides. ' +
      'Notes: refuses unless the comp renderer is Advanced 3D or Cinema 4D, because Classic 3D cannot extrude; run set-composition-renderer first. Bevel Depth is in layer pixels. Keys land softly unless easing is given. Undoable in one step. ' +
      'Example: layer {name: "LOGO"}, extrusionDepth 60, bevelStyle "convex", bevelDepth 4.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      extrusionDepth: z.number().min(0).optional().describe('Extrusion Depth in pixels.'),
      bevelStyle: z.enum(BEVEL_STYLES).optional().describe('Bevel Style.'),
      bevelDepth: z.number().min(0).optional().describe('Bevel Depth in pixels.'),
      holeBevelDepth: z.number().min(0).max(100).optional().describe('Hole Bevel Depth in percent of the bevel depth.'),
      make3d: z.boolean().optional().describe('Turn the layer\'s 3D switch on when it is off. Default true.'),
      keyframes: z.array(GeometryKey).max(50).optional().describe('Keys for extrusion and bevel depths.'),
    },
    toBridgeArgs: (args) => {
      const any = args.extrusionDepth !== undefined || args.bevelStyle !== undefined || args.bevelDepth !== undefined || args.holeBevelDepth !== undefined || (args.keyframes?.length ?? 0) > 0;
      if (!any) throw new Error('Give extrusionDepth, bevelStyle, bevelDepth, holeBevelDepth or keyframes.');
      return args;
    },
  });

  defineTool(server, {
    name: 'add-environment-light',
    group: 'camera-3d',
    description:
      'Adds an Environment light that lights the 3D scene from an image: an HDR or EXR, or (After Effects 25.2 and later) any 2D still, video or comp layer. Sets intensity and rotation, shadows, and an optional background layer showing the environment. ' +
      'Use when: lighting extruded logos, meshes, metal or glass with real reflections. Do not use for: spot, point, parallel or ambient lights (create-light-layer). ' +
      'Inputs: comp; one of source (a 2D layer), sourceItem (a project item placed as a new layer) or sourceFile (a path to import); intensity in percent (default 100); rotation, Y degrees or [x, y, z]; castsShadows; shadowDarkness; useAsBackground; hideSource (default true); switchRenderer; name. ' +
      'Returns: the light (type, options), the source layer, the background layer and how it was made, the renderer, and notes. ' +
      'Notes: needs After Effects 24.3 or later and the Advanced 3D renderer; refuses otherwise unless switchRenderer is true. Rotation and shadows are set while the light is still a spot light, because environment lights hide them. The background uses Create Environment Light Background Layer, else a solid with CC Environment. Undoable in one step. ' +
      'Example: sourceFile "~/HDRI/studio.hdr", intensity 120, rotation 45, useAsBackground true.',
    input: {
      comp: CompRef.optional(),
      source: LayerRef.optional().describe('An existing 2D layer in the comp to use as the light source.'),
      sourceItem: z
        .object({ id: z.number().int().optional(), name: z.string().optional() })
        .optional()
        .describe('A footage item or composition in the project, placed as a new 2D layer.'),
      sourceFile: z.string().min(1).optional().describe('Absolute path of an image, HDR, EXR or video to import and use. "~/" is expanded.'),
      name: z.string().min(1).optional().describe('Light name. Default "Environment Light".'),
      intensity: z.number().min(0).optional().describe('Intensity in percent. Default 100.'),
      rotation: z.union([z.number(), Vec3]).optional().describe('Y rotation in degrees, or [x, y, z] rotation in degrees.'),
      castsShadows: z.boolean().optional().describe('Light casts shadows (Advanced 3D).'),
      shadowDarkness: z.number().min(0).max(100).optional().describe('Shadow Darkness in percent.'),
      useAsBackground: z.boolean().optional().describe('Add a background layer that shows the environment. Default false.'),
      hideSource: z.boolean().optional().describe('Turn the source layer\'s visibility off so it does not render flat. Default true.'),
      switchRenderer: z.boolean().optional().describe('Switch the comp to Advanced 3D first when it uses another renderer. Default false (refuse).'),
    },
    toBridgeArgs: (args) => {
      const given = [args.source, args.sourceItem, args.sourceFile].filter((v) => v !== undefined).length;
      if (given > 1) throw new Error('Give only one of source, sourceItem or sourceFile.');
      if (args.sourceItem && args.sourceItem.id === undefined && !args.sourceItem.name) throw new Error('sourceItem needs {id} or {name}.');
      return args.sourceFile ? { ...args, sourceFile: path.resolve(expandHome(args.sourceFile.trim())) } : args;
    },
  });
}
