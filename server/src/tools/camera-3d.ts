/*
 * Camera, light and 3D layer tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, Easing, LayerRef, TimeArgs } from '../schemas/common.js';
import { defineTool } from './registry.js';

export const CAMERA_MOVES = ['dolly', 'orbit', 'crane', 'push-in', 'pull-out', 'rack-focus'] as const;
export const LIGHT_TYPES = ['parallel', 'spot', 'point', 'ambient'] as const;
export const AUTO_ORIENT_MODES = ['none', 'along-path', 'camera-or-poi'] as const;
export const IRIS_SHAPES = ['fast-rectangle', 'triangle', 'square', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'nonagon', 'decagon'] as const;

const TriState = z
  .union([z.boolean(), z.enum(['off', 'on', 'only'])])
  .describe('true/false, or "off", "on", "only" (only means the layer is invisible and only its shadow or reflection shows).');

const LayersSpec = z
  .union([z.array(LayerRef).min(1), z.object({ selected: z.boolean().optional(), all: z.boolean().optional() })])
  .describe('Several layers: an array of layer references, {selected: true} for the timeline selection, or {all: true}.');

export function registerCamera3dTools(server: McpServer): void {
  defineTool(server, {
    name: 'set-camera-settings',
    group: 'camera-3d',
    description:
      'Sets any subset of a camera layer\'s Camera Options: zoom (the distance in pixels from the camera to the plane it sees at 100 percent), focal length in millimetres (converted to zoom using a 36 mm film width, an approximation of the Camera Settings dialog), depth of field on or off, focus distance, aperture, blur level, iris shape, rotation, roundness, aspect ratio and diffraction fringe, and highlight gain, threshold and saturation. ' +
      'Use when: framing a 3D scene, enabling depth of field before a rack focus, or matching a lens. Do not use for: moving the camera (use set-transform or animate-camera) or lights (set-light-settings). ' +
      'Inputs: layer (must be a camera); the option fields; time or frame plus easing to write keyframes instead of static values. ' +
      'Returns: the camera summary (position, point of interest, every camera option, focal length estimate), what was applied with property paths, and notes for options the renderer does not expose. ' +
      'Notes: giving both zoom and focalLength uses zoom. Iris options only affect renders with depth of field on. Not verified against a live After Effects; the mock covers the shape. Undoable in one step. ' +
      'Example: layer {name: "Camera 1"}, focalLength 35, depthOfField true, focusDistance 1800, aperture 60.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      zoom: z.number().positive().optional().describe('Zoom in pixels. Larger values narrow the view.'),
      focalLength: z.number().positive().optional().describe('Focal length in mm, converted to zoom = compWidth * focalLength / 36. Ignored when zoom is given.'),
      depthOfField: z.boolean().optional().describe('Enable depth of field blur.'),
      focusDistance: z.number().min(0).optional().describe('Distance in pixels from the camera that is in sharp focus.'),
      aperture: z.number().min(0).optional().describe('Aperture in pixels; larger blurs more away from the focus distance.'),
      blurLevel: z.number().min(0).optional().describe('Blur level in percent. 100 is normal.'),
      irisShape: z.union([z.number().int().min(1).max(10), z.enum(IRIS_SHAPES)]).optional().describe('Iris shape as an index 1 to 10 or a name.'),
      irisRotation: z.number().optional().describe('Iris rotation in degrees.'),
      irisRoundness: z.number().min(0).max(100).optional().describe('Iris roundness in percent.'),
      irisAspectRatio: z.number().positive().optional().describe('Iris aspect ratio. 1 is round.'),
      irisDiffractionFringe: z.number().min(0).optional().describe('Diffraction fringe in percent.'),
      highlightGain: z.number().min(0).optional().describe('Highlight gain in percent.'),
      highlightThreshold: z.number().min(0).max(255).optional().describe('Highlight threshold, 0 to 255.'),
      highlightSaturation: z.number().min(0).optional().describe('Highlight saturation in percent.'),
      ...TimeArgs,
      easing: Easing.optional().describe('Easing for the keyframes written when time or frame is given.'),
    },
  });

  defineTool(server, {
    name: 'animate-camera',
    group: 'camera-3d',
    description:
      'Writes a ready-made camera move as keyframes: dolly (along the view axis by pixels), crane (vertically), orbit (around the point of interest by degrees, sampled as linear keys because a circle is not one bezier), push-in and pull-out (zoom by a factor, default 1.3, or move by a distance), and rack-focus (focus distance from one layer to another, depth of field on). ' +
      'Use when: you want a cinematic camera move without computing positions. Do not use for: arbitrary paths (set-keyframes-bulk on Transform/Position) or camera options alone (set-camera-settings). ' +
      'Inputs: layer (a camera); move; amount (pixels, degrees or zoom factor by move); distance in pixels for push-in and pull-out; fromLayer and toLayer for rack-focus; startTime or startFrame (default: current time); duration or durationFrames (default 2 s); easing (default ease-in-out); sampleFrames for orbit (default 2). ' +
      'Returns: the move, the time range, property paths, every keyframe written and notes. ' +
      'Notes: on a one-node camera dolly assumes a +Z view axis and orbit becomes a Y Rotation. Positive crane moves down. Rack-focus uses straight-line distances to each layer\'s Position. Not verified against a live After Effects. Undoable in one step. ' +
      'Example: layer {name: "Camera 1"}, move "orbit", amount 45, startFrame 0, durationFrames 90.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      move: z.enum(CAMERA_MOVES).describe('Which move to write.'),
      amount: z.number().optional().describe('dolly and crane: pixels; orbit: degrees; push-in and pull-out: zoom factor (default 1.3).'),
      distance: z.number().optional().describe('push-in and pull-out only: move the camera this many pixels along its view axis instead of changing zoom.'),
      fromLayer: LayerRef.optional().describe('rack-focus: the layer in focus at the start.'),
      toLayer: LayerRef.optional().describe('rack-focus: the layer in focus at the end.'),
      startTime: z.number().optional().describe('Start of the move in seconds. Default: current time.'),
      startFrame: z.number().int().optional().describe('Start frame; wins over startTime.'),
      duration: z.number().positive().optional().describe('Length of the move in seconds. Default 2.'),
      durationFrames: z.number().int().positive().optional().describe('Length in frames; wins over duration.'),
      easing: Easing.optional().describe('Easing of the move. Default "ease-in-out".'),
      sampleFrames: z.number().int().min(1).max(30).optional().describe('orbit only: frames between sampled keys. Default 2.'),
    },
  });

  defineTool(server, {
    name: 'set-light-settings',
    group: 'camera-3d',
    description:
      'Sets any subset of a light layer\'s options: light type (parallel, spot, point, ambient), intensity in percent, colour, cone angle and feather for spots, falloff (none, smooth, inverse-square) with radius and falloff distance, casts shadows, shadow darkness and shadow diffusion. ' +
      'Use when: lighting a 3D scene, dimming or recolouring a light, or turning on shadows. Do not use for: aiming the light (use look-at-layer or set-transform) or cameras (set-camera-settings). ' +
      'Inputs: layer (must be a light); lightType; intensity; color in any colour form; coneAngle and coneFeather in degrees and percent; falloff as a name or 1 to 3; radius and falloffDistance in pixels; castsShadows; shadowDarkness and shadowDiffusion; time or frame plus easing to write keyframes. ' +
      'Returns: the light summary (type, position, point of interest, every light option), what was applied with property paths, and notes for options the light type does not expose. ' +
      'Notes: ambient lights only have intensity and colour; cone options exist on spot lights only. Shadows need 3D layers with Casts Shadows on (set-material-options). Not verified against a live After Effects. Undoable in one step. ' +
      'Example: layer {name: "Key"}, lightType "spot", intensity 120, coneAngle 60, castsShadows true.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      lightType: z.enum(LIGHT_TYPES).optional().describe('Light type.'),
      intensity: z.number().optional().describe('Intensity in percent. 100 is normal; negative values subtract light.'),
      color: Color.optional().describe('Light colour.'),
      coneAngle: z.number().min(0).max(180).optional().describe('Spot cone angle in degrees.'),
      coneFeather: z.number().min(0).max(100).optional().describe('Spot cone feather in percent.'),
      falloff: z.union([z.enum(['none', 'smooth', 'inverse-square']), z.number().int().min(1).max(3)]).optional().describe('Falloff type: none (1), smooth (2) or inverse-square (3).'),
      radius: z.number().min(0).optional().describe('Falloff start radius in pixels.'),
      falloffDistance: z.number().min(0).optional().describe('Falloff distance in pixels.'),
      castsShadows: z.boolean().optional().describe('Whether the light casts shadows.'),
      shadowDarkness: z.number().min(0).max(100).optional().describe('Shadow darkness in percent.'),
      shadowDiffusion: z.number().min(0).optional().describe('Shadow diffusion in pixels.'),
      ...TimeArgs,
      easing: Easing.optional().describe('Easing for the keyframes written when time or frame is given.'),
    },
  });

  defineTool(server, {
    name: 'set-layer-3d',
    group: 'camera-3d',
    description:
      'Turns the 3D switch on or off for one layer or several, and optionally sets auto-orientation: none, along-path (the layer turns to follow its motion path) or camera-or-poi (a 3D layer faces the camera; a camera or light aims at its point of interest). ' +
      'Use when: preparing layers for a camera move, or making cards face the camera. Do not use for: material and shadow settings (set-material-options) or the 3D switch at creation time (create-* tools accept threeD). ' +
      'Inputs: layer, or layers as an array, {selected: true} or {all: true}; threeD true or false; autoOrient. ' +
      'Returns: count and each layer summary with its auto-orient mode, plus notes for layers that were skipped. ' +
      'Notes: turning 3D off on a keyframed layer keeps the Z values but stops using them. Cameras and lights are always 3D, so threeD is ignored for them. Undoable in one step. ' +
      'Example: layers [{name: "Card 1"}, {name: "Card 2"}], threeD true, autoOrient "camera-or-poi".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.optional(),
      layers: LayersSpec.optional(),
      threeD: z.boolean().optional().describe('true turns the 3D switch on, false off.'),
      autoOrient: z.enum(AUTO_ORIENT_MODES).optional().describe('Auto-orientation mode.'),
    },
  });

  defineTool(server, {
    name: 'set-material-options',
    group: 'camera-3d',
    description:
      'Sets the Material Options of a 3D image layer: how it responds to lights and shadows. castsShadows off, on or only; lightTransmission percent; acceptsShadows off, on or only; acceptsLights; appearsInReflections; and the surface coefficients ambient, diffuse, specularIntensity, specularShininess and metal in percent. ' +
      'Use when: a layer should cast or receive shadows, or should ignore scene lights. Do not use for: the light itself (set-light-settings) or the 3D switch alone (set-layer-3d). ' +
      'Inputs: layer (a 3D image layer; the 3D switch is turned on when off unless enable3d false); the option fields. ' +
      'Returns: the layer summary, the current material options, what was applied with property paths, and notes for options the renderer does not expose. ' +
      'Notes: shadows only render when a light has castsShadows on and the renderer is Classic 3D or Cinema 4D; appearsInReflections belongs to the ray-traced renderer. Cameras and lights have no material options. Not verified against a live After Effects. Undoable in one step. ' +
      'Example: layer {name: "Card"}, castsShadows "on", acceptsShadows "on", diffuse 60.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      enable3d: z.boolean().optional().describe('Turn the 3D switch on when the layer is not 3D. Default true.'),
      castsShadows: TriState.optional(),
      lightTransmission: z.number().min(0).max(100).optional().describe('Percent of light that passes through the layer.'),
      acceptsShadows: TriState.optional(),
      acceptsLights: z.boolean().optional(),
      appearsInReflections: TriState.optional(),
      ambient: z.number().min(0).max(100).optional().describe('Percent.'),
      diffuse: z.number().min(0).max(100).optional().describe('Percent.'),
      specularIntensity: z.number().min(0).max(100).optional().describe('Percent.'),
      specularShininess: z.number().min(0).max(100).optional().describe('Percent.'),
      metal: z.number().min(0).max(100).optional().describe('Percent.'),
    },
  });

  defineTool(server, {
    name: 'look-at-layer',
    group: 'camera-3d',
    description:
      'Aims a camera, a light or a 3D layer at another layer. Two-node cameras and lights get their Point of Interest set to the target\'s position (a static value, or a keyframe when time or frame is given). One-node cameras and ordinary 3D layers get an Orientation expression, lookAt(position, target position), that keeps following the target. ' +
      'Use when: a camera should frame a specific layer, or a light should point at it. Do not use for: parenting (set-layer-parent) or auto-orient toward the camera (set-layer-3d with autoOrient). ' +
      'Inputs: layer; target (a layer reference); useExpression true to force the expression even on two-node cameras; time or frame and easing for a Point of Interest keyframe. ' +
      'Returns: mode "point-of-interest" or "expression", the property state, the target and the value or expression written. ' +
      'Notes: the target\'s own Position value is used, parenting ignored; a note says so when the target has a parent. The expression follows the target as it moves; the point of interest value does not unless keyframed. Undoable in one step. ' +
      'Example: layer {name: "Camera 1"}, target {name: "Hero"}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      target: LayerRef.describe('The layer to look at.'),
      useExpression: z.boolean().optional().describe('Force the Orientation expression. Default false.'),
      ...TimeArgs,
      easing: Easing.optional().describe('Easing for a Point of Interest keyframe.'),
    },
  });
}
