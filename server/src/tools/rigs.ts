/*
 * Rig tools: one-call builders that reproduce the four ScriptUI builder panels
 * under panels/ (Edge Glow, Power Warp Transition, Depth Map Blur Reveal,
 * Blur Color Reveal) without the UI. The ExtendScript side under
 * scripts/commands/rigs/ holds the SPEC values and the build logic; these
 * definitions expose every panel control as an optional argument with the
 * panel's default.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, LayerRef, Vec2 } from '../schemas/common.js';
import { defineTool } from './registry.js';

type LayerRefValue = z.infer<typeof LayerRef>;

/** True when two layer references clearly point at the same layer (same index, id, or name). */
export function sameLayerRef(a: LayerRefValue | undefined, b: LayerRefValue | undefined): boolean {
  if (!a || !b) return false;
  if (a.index !== undefined && b.index !== undefined) return a.index === b.index;
  if (a.id !== undefined && b.id !== undefined) return a.id === b.id;
  if (a.name !== undefined && b.name !== undefined) return a.name.toLowerCase() === b.name.toLowerCase();
  return false;
}

const OpenInViewer = z.boolean().optional().describe('Open the composition in the viewer after building. Default true.');

export function registerRigsTools(server: McpServer): void {
  defineTool(server, {
    name: 'rig-edge-glow',
    group: 'rigs',
    timeout: 'render',
    description:
      'Builds the Edge Glow badge: a rounded rectangle whose thin outline glows with a two-colour gradient, a bright highlight sweeps around that outline over time, the inside is a dark panel, and a soft red, blue and white halo blooms behind it. ' +
      'Use when: you want a glowing pill or badge to put text or an icon on, in one call. Do not use for: a plain glow on an existing layer (use apply-effect-template "glow" or "deep-glow-with-fallback"). ' +
      'Inputs: comp (active by default); width 718, height 142, roundness 28 and strokeWidth 3 in pixels; gradientA and gradientB rim colours; fillColor; halo1, halo2, halo3; haloDistance 100, haloSoftness 525, haloDirection -36 degrees; sweepWidth 88; edgeIntensity 100; animate true with speed 50 degrees per second; addBackground false; openInViewer true. ' +
      'Returns: the stroke, fill, glow and background layer summaries, glowUsed ("Deep Glow (matchName)" or "built-in Glow"), and notes. ' +
      'Notes: three shape layers named EG Stroke, EG Fill and EG Glow are added at the top of the composition. Deep Glow by Plugin Everything is used when installed, otherwise the built-in Glow. Same logic as the Edge Glow panel. One undo step. Not verified against a real After Effects in this build. ' +
      'Example: build the default badge in the active comp, then add a text layer above EG Stroke.',
    input: {
      comp: CompRef.optional(),
      width: z.number().positive().optional().describe('Rectangle width in pixels. Default 718.'),
      height: z.number().positive().optional().describe('Rectangle height in pixels. Default 142.'),
      roundness: z.number().min(0).optional().describe('Corner radius in pixels. Default 28.'),
      strokeWidth: z.number().min(0.1).optional().describe('Outline thickness in pixels. Default 3.'),
      gradientA: Color.optional().describe('Rim colour on gradient corners 1 and 3. Default [236,0,200] (pink).'),
      gradientB: Color.optional().describe('Rim colour on gradient corners 2 and 4. Default [120,40,255] (violet).'),
      fillColor: Color.optional().describe('Inner panel colour. Default black.'),
      halo1: Color.optional().describe('First drop-shadow halo colour. Default red.'),
      halo2: Color.optional().describe('Second drop-shadow halo colour. Default blue.'),
      halo3: Color.optional().describe('Third drop-shadow halo colour. Default white.'),
      haloDistance: z.number().optional().describe('Drop Shadow distance in pixels. Default 100.'),
      haloSoftness: z.number().optional().describe('Drop Shadow softness. Default 525.'),
      haloDirection: z.number().optional().describe('Drop Shadow direction in degrees. Default -36.'),
      sweepWidth: z.number().optional().describe('CC Light Sweep width. Default 88.'),
      edgeIntensity: z.number().optional().describe('CC Light Sweep edge intensity. Default 100.'),
      animate: z.boolean().optional().describe('Animate the sweep with the expression time * speed on Direction. Default true.'),
      speed: z.number().optional().describe('Sweep speed in degrees per second. Default 50.'),
      addBackground: z.boolean().optional().describe('Add a black solid named EG Background at the bottom. Default false.'),
      openInViewer: OpenInViewer,
    },
  });

  defineTool(server, {
    name: 'rig-power-warp-transition',
    group: 'rigs',
    timeout: 'render',
    description:
      'Builds the Power Warp transition between two shots using a depth map: the outgoing shot is wiped away from near to far, a glowing scan line sweeps through it, the picture warps and smears, red and green split apart, the frame shakes with depth parallax and fine ripples run across it, all ramping in and out inside the transition window. ' +
      'Use when: you have an outgoing layer and a grayscale depth map of it (white near, black far) in the same composition. Do not use for: a simple cross-dissolve or wipe (use set-keyframes-bulk on Opacity or apply-effect-template "linear-wipe-transition"). ' +
      'Inputs: comp (active by default); outgoing and depth layer references (required, distinct); incoming (optional, distinct); start 0.5 s; duration 1.5 s; intensity 1.0 (0.5 subtle, 2.0 extreme); scanColor [0,90,255]; modules {scanLine, warp, aberration, shake, fine} all true. ' +
      'Returns: the outgoing, depth and incoming layer summaries, every created layer keyed by role, the stack order, the window {start, end, mid} and notes; lines starting with "?" mean a popup fell back to its default. ' +
      'Notes: the depth layer is hidden and the playhead is parked at mid. The rig cannot create a depth map. Same logic as the Power Warp Transition panel. One undo step. Not verified against a real After Effects in this build. ' +
      'Example: outgoing {name:"Shot A"}, depth {name:"Shot A depth"}, incoming {name:"Shot B"}, start 2, duration 1.2.',
    input: {
      comp: CompRef.optional(),
      outgoing: LayerRef.describe('The shot that warps away. Gets the Gradient Wipe.'),
      depth: LayerRef.describe('Grayscale depth map of the outgoing shot (white = near, black = far). Must differ from outgoing.'),
      incoming: LayerRef.optional().describe('The shot revealed underneath. Optional; must differ from outgoing and depth.'),
      start: z.number().min(0).optional().describe('Transition start in seconds, snapped to a frame. Default 0.5.'),
      duration: z.number().positive().optional().describe('Transition length in seconds. Default 1.5.'),
      intensity: z.number().min(0).optional().describe('Master distortion strength. Default 1.0.'),
      scanColor: Color.optional().describe('Colour of the glowing scan line. Default [0,90,255].'),
      modules: z
        .object({
          scanLine: z.boolean().optional().describe('Depth scan line. Default true.'),
          warp: z.boolean().optional().describe('CC Glass plus CC Vector Blur warp. Default true.'),
          aberration: z.boolean().optional().describe('Chromatic aberration. Default true.'),
          shake: z.boolean().optional().describe('Pseudo-3D shake. Default true.'),
          fine: z.boolean().optional().describe('Fine turbulent distortions. Default true.'),
        })
        .optional()
        .describe('Turn individual modules off. Gradient Wipe is always on.'),
    },
    handler: async (args, ctx) => {
      if (sameLayerRef(args.outgoing, args.depth)) {
        throw new Error('outgoing and depth must be different layers: the depth map is a separate grayscale layer that drives the wipe.');
      }
      if (args.incoming && (sameLayerRef(args.incoming, args.outgoing) || sameLayerRef(args.incoming, args.depth))) {
        throw new Error('incoming must differ from outgoing and depth. Omit incoming when there is no shot underneath.');
      }
      return ctx.run(ctx.command as string, args as Record<string, unknown>);
    },
  });

  defineTool(server, {
    name: 'rig-depth-map-blur-reveal',
    group: 'rigs',
    timeout: 'render',
    description:
      'Builds the depth map blur reveal on one layer: the picture starts as a heavy blur weighted by depth and resolves into focus, the far distance sharpening first and the near foreground last, while exposure lifts from dark to bright and a glow bloom fades away. ' +
      'Use when: revealing a landscape, product shot or still with a focus pull feel. Do not use for: a uniform blur-in (use set-keyframes-bulk on "Effects/Gaussian Blur/Blurriness"). ' +
      'Inputs: comp (active by default); layer (required); depthLayer optional with blurSource "auto" (a vertical gradient fakes depth) or "layer"; maxBlur 120; autoDir bottom; invert false; useExposure true with expStart -2 stops; useGlow true with glowStart 2.5, glowEnd 0, glowRadius 90, glowThreshold 50; useScale false with scaleStart 104 percent; start 0 s or startAtPlayhead; duration 0.8 s; ease 33; openInViewer true. ' +
      'Returns: the layer summary with its new effects, depthSource {mode, layer}, blurEffect used, the window and notes. ' +
      'Notes: auto mode adds a hidden guide solid "DBR Depth (auto)" at the top. If Compound Blur is missing it falls back to Gaussian Blur. Same logic as the Depth Map Blur Reveal panel. One undo step. Not verified against a real After Effects in this build. ' +
      'Example: layer {name:"meadow.jpg"}, start 1.0, duration 0.8.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.describe('The image or footage layer to reveal.'),
      depthLayer: LayerRef.optional().describe('A grayscale depth map layer (white = near). Used when blurSource is "layer".'),
      blurSource: z.enum(['auto', 'layer']).optional().describe('"auto" fakes depth with a gradient; "layer" uses depthLayer. Default "auto", or "layer" when depthLayer is given.'),
      maxBlur: z.number().min(0).optional().describe('Compound Blur Maximum Blur at the start, animates to 0. Default 120.'),
      autoDir: z.enum(['bottom', 'top', 'left', 'right']).optional().describe('Edge that stays soft longest in auto mode. Default bottom.'),
      invert: z.boolean().optional().describe('Invert the depth so the other end blurs longest. Default false.'),
      useExposure: z.boolean().optional().describe('Add the dark-to-bright exposure lift. Default true.'),
      expStart: z.number().optional().describe('Exposure start in stops, ramps to 0. Default -2.'),
      useGlow: z.boolean().optional().describe('Add the fading glow bloom. Default true.'),
      glowStart: z.number().optional().describe('Glow Intensity at the start. Default 2.5.'),
      glowEnd: z.number().optional().describe('Glow Intensity at the end. Default 0.'),
      glowRadius: z.number().optional().describe('Glow Radius. Default 90.'),
      glowThreshold: z.number().optional().describe('Glow Threshold in percent. Default 50.'),
      useScale: z.boolean().optional().describe('Add a gentle scale settle. Default false.'),
      scaleStart: z.number().min(1).optional().describe('Start scale as a percent of the current scale, settles to 100. Default 104.'),
      start: z.number().min(0).optional().describe('Reveal start in seconds. Default 0.'),
      startAtPlayhead: z.boolean().optional().describe('Ignore start and begin at the composition current time. Default false.'),
      duration: z.number().min(0.05).optional().describe('Reveal length in seconds. Default 0.8.'),
      ease: z.number().min(0).max(100).optional().describe('Keyframe influence 0 to 100. Default 33 (Easy Ease).'),
      openInViewer: OpenInViewer,
    },
  });

  defineTool(server, {
    name: 'rig-blur-color-reveal',
    group: 'rigs',
    timeout: 'render',
    description:
      'Builds the blur colour reveal: a soft-edged disc with a pale core and a coloured ring grows from a point (scale 0 to 120 percent, eased) over the content and wipes it into view. Two blurred ellipse layers are added, the colour one clipped by the other as an alpha matte. ' +
      'Use when: revealing a card, dashboard or footage with a colour bloom. Do not use for: a mask wipe (use mask-reveal-animation) or a plain fade. ' +
      'Inputs: comp (active by default); layers (one LayerRef or an array, default the top layer); precompose true (wraps the content into "BR Content"); core [251,248,149]; ring [173,215,255]; ringWidth 200 px (0 for a single colour); blur 80; sizeMultiplier 1.5; endScale 120; start 0 s; duration 1.3 s; ease 33; origin [x,y] (default the comp centre); addControlNull false; nullPush false; nullFrom 80; nullTo 90; openInViewer true. ' +
      'Returns: the content layer, the precomposed comp ref, colorLayer, matteLayer, controlNull, the window and notes. ' +
      'Notes: layers BR Reveal Matte and BR Reveal Color are added above the content. The composition needs at least one layer. Same logic as the Blur Color Reveal panel. One undo step. Not verified against a real After Effects in this build. ' +
      'Example: layers [{name:"Dashboard"}], core "#fbf895", ring "#add7ff", start 0.5.',
    input: {
      comp: CompRef.optional(),
      layers: z.union([LayerRef, z.array(LayerRef).min(1)]).optional().describe('The content to reveal: one LayerRef or an array. Default: the top layer.'),
      precompose: z.boolean().optional().describe('Precompose the content into "BR Content" first. Default true.'),
      core: Color.optional().describe('Fill colour at the centre of the disc. Default [251,248,149].'),
      ring: Color.optional().describe('Stroke colour of the rim. Default [173,215,255].'),
      ringWidth: z.number().min(0).optional().describe('Stroke thickness in pixels; 0 gives a single-colour disc. Default 200.'),
      blur: z.number().min(0).optional().describe('Fast Box Blur radius, the edge softness. Default 80.'),
      sizeMultiplier: z.number().min(0.1).optional().describe('Ellipse size as a multiple of the comp size. Default 1.5.'),
      endScale: z.number().min(1).optional().describe('Scale percent the bloom grows to. Default 120.'),
      start: z.number().min(0).optional().describe('Reveal start in seconds. Default 0.'),
      duration: z.number().min(0.1).optional().describe('Reveal length in seconds. Default 1.3.'),
      ease: z.number().min(0).max(100).optional().describe('Keyframe influence 0 to 100. Default 33 (Easy Ease).'),
      origin: Vec2.optional().describe('[x, y] in comp pixels the disc grows from. Default: the comp centre.'),
      addControlNull: z.boolean().optional().describe('Parent both ellipses to a null named BR Control. Default false.'),
      nullPush: z.boolean().optional().describe('Animate the null scale for a subtle push-in (needs addControlNull). Default false.'),
      nullFrom: z.number().optional().describe('Null scale percent at the start of the push. Default 80.'),
      nullTo: z.number().optional().describe('Null scale percent at the end of the push. Default 90.'),
      openInViewer: OpenInViewer,
    },
  });

  defineTool(server, {
    name: 'list-rigs',
    group: 'rigs',
    mutating: false,
    description:
      'Describes every rig builder: what it looks like, which layers and effects it creates and in what order, what must already exist in the composition, optional plugins, and every parameter with its default. ' +
      'Use when: deciding whether a rig fits a brief, or checking parameter names and defaults before calling rig-edge-glow, rig-power-warp-transition, rig-depth-map-blur-reveal or rig-blur-color-reveal. Do not use for: the general tool catalogue (use list-tools) or effect presets (use list-presets). ' +
      'Inputs: rig (optional) to return one entry by tool name or rig name. ' +
      'Returns: count and rigs[] with tool, name, panel path, summary, builds[], layerOrder[], requires[], optional[], parameters[] {name, default, description}, fixedValues and returns. ' +
      'Notes: read-only. The data lives in the ExtendScript rig files, which the panels mirror, so it matches what the tools build. ' +
      'Example: call with no arguments to see all four rigs, then call rig-blur-color-reveal with the parameters you need.',
    input: {
      rig: z.string().optional().describe('Tool name (rig-edge-glow) or rig name (Edge Glow) to return one entry.'),
    },
  });
}
