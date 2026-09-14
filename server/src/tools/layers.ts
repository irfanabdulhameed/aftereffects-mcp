/*
 * Layer tools: listing, creating simple layer types, duplicating, centring, timing.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BLEND_MODES, Color, CompRef, Easing, LABEL_COLORS, LayerRef, TimeArgs, TRACK_MATTES, Vec2, Vec2or3, Vec3 } from '../schemas/common.js';
import { defineTool } from './registry.js';

/** Placement fields shared by every create-* tool. */
export const PlacementArgs = {
  name: z.string().optional().describe('Layer name.'),
  position: Vec2or3.optional().describe('Position in comp pixels. Default: comp centre.'),
  startTime: z.number().optional().describe('Layer start time in seconds.'),
  startFrame: z.number().int().optional().describe('Layer start frame; wins over startTime.'),
  inPoint: z.number().optional().describe('In point in seconds.'),
  outPoint: z.number().optional().describe('Out point in seconds.'),
  duration: z.number().positive().optional().describe('Duration in seconds from the in point.'),
  durationFrames: z.number().int().positive().optional().describe('Duration in frames; wins over duration.'),
  label: z.union([z.enum(LABEL_COLORS), z.number().int().min(0).max(16)]).optional().describe('Label colour name or index 0-16.'),
  parent: LayerRef.optional().describe('Parent layer.'),
  blendMode: z.enum(BLEND_MODES).optional().describe('Blend mode.'),
  threeD: z.boolean().optional().describe('Make it a 3D layer.'),
  above: LayerRef.optional().describe('Place the new layer directly above this layer.'),
  below: LayerRef.optional().describe('Place the new layer directly below this layer.'),
  toBottom: z.boolean().optional().describe('Place the new layer at the bottom of the stack.'),
};

/** Layer types reported by list-layers and accepted by its type filter. */
export const LAYER_TYPES = ['text', 'shape', 'solid', 'footage', 'precomp', 'null', 'adjustment', 'camera', 'light', 'audio', 'placeholder', 'av'] as const;

/** Several layers: an explicit list, the timeline selection, or every layer. */
export const LayersSpec = z
  .union([z.array(LayerRef).min(1), z.object({ selected: z.boolean().optional().describe('true: the layers selected in the timeline.'), all: z.boolean().optional().describe('true: every layer in the composition.') })])
  .describe('Which layers: an array of layer references, {selected: true} or {all: true}.');

/** Which project item to add as a layer. */
export const ItemRef = z
  .object({
    id: z.number().int().optional().describe('Project item id from list-project-items or get-project-info. Highest precedence.'),
    name: z.string().optional().describe('Item name, exact match first, then case-insensitive.'),
    index: z.number().int().positive().optional().describe('1-based index in the Project panel.'),
  })
  .describe('Which project item (footage or composition). Precedence: id, then index, then name.');

export const CAMERA_PRESETS = ['15mm', '20mm', '24mm', '28mm', '35mm', '50mm', '80mm', '135mm', '200mm'] as const;
export const LIGHT_TYPES = ['parallel', 'spot', 'point', 'ambient'] as const;
export const FRAME_BLENDING = ['none', 'frame-mix', 'pixel-motion'] as const;
export const LAYER_QUALITY = ['draft', 'best', 'wireframe'] as const;

export function registerLayerTools(server: McpServer): void {
  defineTool(server, {
    name: 'list-layers',
    group: 'layers',
    mutating: false,
    description:
      'Lists the layers of a composition, top to bottom, with index, id, name, type (text, shape, solid, footage, precomp, null, adjustment, camera, light, audio), in and out points in seconds and frames, parent, blend mode, 3D, shy, solo, locked, label colour, track matte, effect names, whether expressions are present, and current transform values. ' +
      'Use when: before any layer-targeting call, to get indices, ids and names; after creating or deleting layers, because indices shift. ' +
      'Do not use for: property trees or keyframes on one layer (use get-layer-details or get-keyframes). ' +
      'Inputs: comp (optional, active comp by default); selectedOnly; type to keep only one layer type; includeKeyframes to list which properties carry keyframes. ' +
      'Returns: composition {id, name}, count, layers[]. ' +
      'Notes: read-only. Index 1 is the top layer. Layer ids are stable across reordering, so prefer {id} when you plan to reorder. ' +
      'Example: list-layers, then set-keyframes-bulk with layer {id: 123}.',
    input: {
      comp: CompRef.optional(),
      selectedOnly: z.boolean().optional().describe('Only layers selected in the timeline.'),
      type: z.enum(LAYER_TYPES).optional().describe('Only layers of this type, for example "text" or "camera". Default: every type.'),
      includeKeyframes: z.boolean().optional().describe('Add keyframedProperties[] to each layer. Default false.'),
    },
  });

  defineTool(server, {
    name: 'get-layer-details',
    group: 'layers',
    mutating: false,
    description:
      'Returns everything about one layer: the summary from list-layers plus timing in seconds and frames (start, in, out, source in and out), markers, keyframed properties, and the property tree of Transform, Effects, Masks, Text, Contents, Audio, Material, Camera and Light options to a chosen depth with current values, expressions and keyframe counts. ' +
      'Use when: you need exact property paths, current values, or want to copy a look from a reference layer. ' +
      'Do not use for: several layers at once (use list-layers) or reading keyframe curves (use get-keyframes). ' +
      'Inputs: comp (optional), layer, depth (default 2; 3 or 4 for shape layers and effects with nested groups). ' +
      'Returns: the layer summary, timing, markers, properties[]. ' +
      'Notes: read-only. Deep trees on shape layers can be long; start with depth 2. ' +
      'Example: get-layer-details with depth 3 to find "Contents/Group 1/Fill 1/Color".',
    input: { comp: CompRef.optional(), layer: LayerRef, depth: z.number().int().min(0).max(6).optional().describe('Property tree depth. Default 2.') },
  });

  defineTool(server, {
    name: 'create-solid-layer',
    group: 'layers',
    description:
      'Creates a solid colour layer, sized to the composition unless a size is given, centred, and places it in the stack. ' +
      'Use when: you need a background, a colour card, or a plain rectangle that does not need to be a shape. Do not use for: adjustment layers (create-adjustment-layer) or shapes with strokes and rounded corners (create-shape-layer). ' +
      'Inputs: color in any colour form (default white); size [w, h] in pixels; the shared placement fields: name, position, startTime or startFrame, inPoint, outPoint, duration or durationFrames, label, parent, blendMode, threeD, above, below, toBottom. ' +
      'Returns: composition and the new layer summary with index, id and transform. ' +
      'Notes: the solid footage item is also added to the project (Solids folder). Undoable in one step. ' +
      'Example: name "BG", color "#101014", toBottom true.',
    input: {
      comp: CompRef.optional(),
      color: Color.optional().describe('Solid colour. Default white.'),
      size: Vec2.optional().describe('[width, height] in pixels. Default: comp size.'),
      pixelAspect: z.number().positive().optional().describe('Pixel aspect ratio of the solid. Default 1.'),
      ...PlacementArgs,
    },
  });

  defineTool(server, {
    name: 'create-adjustment-layer',
    group: 'layers',
    description:
      'Creates an adjustment layer (a comp-sized solid with the adjustment switch on) so effects applied to it affect every layer below. ' +
      'Use when: adding a grade, blur, glow or any effect to a group of layers at once. Do not use for: effects on one layer (apply-effect on that layer). ' +
      'Inputs: size (optional, default comp size) and the shared placement fields: name, position, timing, label, parent, blendMode, threeD, above, below, toBottom. ' +
      'Returns: composition and the new layer summary. ' +
      'Notes: placed at the top of the stack unless above, below or toBottom is given. Undoable in one step. ' +
      'Example: create-adjustment-layer name "Grade", then apply-effect-template "lumetri-basic" on layer {name: "Grade"}.',
    input: { comp: CompRef.optional(), size: Vec2.optional().describe('[width, height]. Default: comp size.'), ...PlacementArgs },
  });

  defineTool(server, {
    name: 'create-null-layer',
    group: 'layers',
    description:
      'Creates a null object, centred by default, and optionally parents a list of layers to it. Nulls are the standard controller for moving, scaling or rotating several layers together, and the usual home for expression controls. ' +
      'Use when: you want one handle for a group, or a place for sliders from add-expression-control. Do not use for: visible geometry (use a shape or solid). ' +
      'Inputs: name; position (default comp centre); centered (default true); children, an array of layer references to parent to the null; the shared placement fields. ' +
      'Returns: composition and the null layer summary. ' +
      'Notes: parenting keeps children where they are visually. Undoable in one step. ' +
      'Example: name "CTRL Title", children [{name: "Title"}, {name: "Subtitle"}].',
    input: {
      comp: CompRef.optional(),
      centered: z.boolean().optional().describe('Place at the comp centre when no position is given. Default true.'),
      children: z.array(LayerRef).optional().describe('Layers to parent to the new null.'),
      ...PlacementArgs,
    },
  });

  defineTool(server, {
    name: 'duplicate-layer',
    group: 'layers',
    description:
      'Duplicates a layer one or more times, keeping its effects, keyframes, trims and expressions. Copies can be placed at a list of times, or spaced by an offset, and named with a pattern. ' +
      'Use when: repeating a sound effect at several beats, stamping a shape into a grid, or making copies to stagger. Do not use for: copying only effects (use copy-effects). ' +
      'Inputs: layer; count (default 1); times[] in seconds or frames[] to place each copy\'s in point; offsetTime or offsetFrames added per copy; offsetPosition [x, y] added per copy; namePattern with {n} for the copy number and {name} for the source name; below to stack copies under the source instead of above. ' +
      'Returns: source, createdCount and the new layer summaries with indices. ' +
      'Notes: copies keep the source head trim, so the in point lands exactly on the requested time. Undoable in one step. ' +
      'Example: layer {name: "Click"}, times [0.5, 1.2, 2.0], namePattern "Click {n}".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      count: z.number().int().min(1).max(500).optional().describe('Number of copies when times/frames are not given. Default 1.'),
      times: z.array(z.number()).optional().describe('In point in seconds for each copy.'),
      frames: z.array(z.number().int()).optional().describe('In point in frames for each copy; wins over times.'),
      offsetTime: z.number().optional().describe('Seconds added per copy (or to every time in times[]).'),
      offsetFrames: z.number().int().optional().describe('Frames added per copy; wins over offsetTime.'),
      offsetPosition: Vec2or3.optional().describe('Position offset added per copy.'),
      namePattern: z.string().optional().describe('Name template, for example "Dot {n}".'),
      name: z.string().optional().describe('Plain name for the copies (numbered when more than one).'),
      below: z.boolean().optional().describe('Stack copies below the source. Default above.'),
    },
  });

  defineTool(server, {
    name: 'center-layers',
    group: 'layers',
    description:
      'Moves one layer, a list of layers, the selected layers, or all layers to the composition centre by setting Position. ' +
      'Use when: a layer landed off-centre after creation or import. Do not use for: aligning to edges or to each other (use align-layers) or changing the anchor point (use set-anchor-point). ' +
      'Inputs: layer, or layers (array of refs, {selected: true} or {all: true}), or all; axis "both" (default), "x" or "y". ' +
      'Returns: the comp centre and each moved layer with its new position. ' +
      'Notes: if Position has keyframes a keyframe is set at the current time instead. Undoable in one step. ' +
      'Example: layers {selected: true}, axis "x".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.optional(),
      layers: z.union([z.array(LayerRef), z.object({ selected: z.boolean().optional(), all: z.boolean().optional() })]).optional(),
      all: z.boolean().optional().describe('Centre every layer.'),
      axis: z.enum(['both', 'x', 'y']).optional(),
    },
  });

  defineTool(server, {
    name: 'set-layer-timing',
    group: 'layers',
    description:
      'Changes when a layer starts, its in and out points, its duration, or its time stretch, in seconds or frames, any subset in one call. ' +
      'Use when: placing a clip at a beat, trimming a layer to a section, or slowing footage (stretch 200 is half speed). Do not use for: time remapping (enable-time-remap) or splitting (split-layer-at-time). ' +
      'Inputs: layer; startTime or startFrame moves the whole layer; inPoint or inFrame and outPoint or outFrame trim it; duration or durationFrames sets the out point from the in point; stretch is a percentage. ' +
      'Returns: the layer summary with in, out, start in seconds and frames, and which fields changed. ' +
      'Notes: setting inPoint before startTime is applied in the order given here: start, in, out, duration, stretch. Undoable in one step. ' +
      'Example: layer {name: "Clip"}, startFrame 24, durationFrames 60.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      startTime: z.number().optional().describe('Layer start time in seconds.'),
      startFrame: z.number().int().optional().describe('Layer start frame; wins over startTime.'),
      inPoint: z.number().optional().describe('In point in seconds.'),
      inFrame: z.number().int().optional().describe('In point in frames; wins over inPoint.'),
      outPoint: z.number().optional().describe('Out point in seconds.'),
      outFrame: z.number().int().optional().describe('Out point in frames; wins over outPoint.'),
      duration: z.number().positive().optional().describe('Duration in seconds from the in point.'),
      durationFrames: z.number().int().positive().optional().describe('Duration in frames; wins over duration.'),
      stretch: z.number().optional().describe('Time stretch percent. 100 is normal, 200 half speed, -100 reversed.'),
    },
  });
  defineTool(server, {
    name: 'create-camera-layer',
    group: 'layers',
    description:
      'Creates a camera layer in a composition. A camera only affects layers that have the 3D switch on; 2D layers ignore it. Two-node cameras orbit a point of interest, one-node cameras are aimed by rotation alone. ' +
      'Use when: you plan to move through a 3D scene, push in on 3D layers, or need depth of field. Do not use for: changing an existing camera (set-camera-settings, animate-camera) or making layers 3D (set-layer-3d). ' +
      'Inputs: name (default "Camera 1"); type "two-node" (default) or "one-node"; preset focal length "15mm" to "200mm" (default "50mm"), converted to zoom as compWidth * focalLength / 36, the same approximation After Effects uses for a 36 mm film width; zoom in pixels overrides the preset; position and pointOfInterest [x, y, z] in comp pixels; depthOfField, focusDistance, aperture; the shared placement fields. ' +
      'Returns: composition and the camera layer summary plus camera {type, zoom, focalLengthMm, depthOfField, focusDistance, aperture}. ' +
      'Notes: without a position the camera is placed at the comp centre with z = -zoom, so the framing matches the default view. Not verified against a real After Effects in this build. Undoable in one step. ' +
      'Example: name "Main Cam", preset "35mm", depthOfField true, focusDistance 1500.',
    input: {
      comp: CompRef.optional(),
      type: z.enum(['one-node', 'two-node']).optional().describe('"two-node" (default) has a point of interest; "one-node" is aimed by rotation.'),
      preset: z.enum(CAMERA_PRESETS).optional().describe('Focal length preset. Default "50mm". Zoom = compWidth * focalLength / 36.'),
      zoom: z.number().positive().optional().describe('Camera zoom in pixels. Overrides preset.'),
      pointOfInterest: Vec3.optional().describe('[x, y, z] the two-node camera looks at. Default: comp centre at z 0.'),
      depthOfField: z.boolean().optional().describe('Turn depth of field on. Default false.'),
      focusDistance: z.number().optional().describe('Focus distance in pixels from the camera.'),
      aperture: z.number().optional().describe('Aperture in pixels. Larger is blurrier out of focus.'),
      ...PlacementArgs,
      position: Vec3.optional().describe('Camera position [x, y, z] in comp pixels. Default: comp centre with z = -zoom.'),
    },
  });

  defineTool(server, {
    name: 'create-light-layer',
    group: 'layers',
    description:
      'Creates a light layer. Lights only affect 3D layers whose material options accept lights; 2D layers are unaffected. ' +
      'Use when: shading a 3D scene, casting shadows, or spotlighting a 3D title. Do not use for: glow effects on 2D layers (apply-effect with "Glow") or changing an existing light (set-light-settings). ' +
      'Inputs: lightType "point" (default), "spot", "parallel" or "ambient"; position [x, y, z] (default comp centre with z = -500); pointOfInterest [x, y, z] for spot and parallel lights; color in any colour form (default white); intensity in percent (default 100); coneAngle in degrees and coneFeather in percent for spot lights; castsShadows; shadowDarkness in percent; the shared placement fields. ' +
      'Returns: composition and the light layer summary plus light {lightType, color, intensity, coneAngle, coneFeather, castsShadows, shadowDarkness}. ' +
      'Notes: options that do not apply to the light type (cone settings on a point light) are skipped and listed in skipped[]. Not verified against a real After Effects in this build. Undoable in one step. ' +
      'Example: lightType "spot", position [960, 200, -800], pointOfInterest [960, 540, 0], intensity 120, castsShadows true.',
    input: {
      comp: CompRef.optional(),
      lightType: z.enum(LIGHT_TYPES).optional().describe('Light type. Default "point".'),
      pointOfInterest: Vec3.optional().describe('[x, y, z] the light aims at (spot and parallel).'),
      color: Color.optional().describe('Light colour. Default white.'),
      intensity: z.number().optional().describe('Intensity in percent. Default 100.'),
      coneAngle: z.number().min(0).max(180).optional().describe('Spot light cone angle in degrees.'),
      coneFeather: z.number().min(0).max(100).optional().describe('Spot light cone feather in percent.'),
      castsShadows: z.boolean().optional().describe('Cast shadows from 3D layers with shadows enabled.'),
      shadowDarkness: z.number().min(0).max(100).optional().describe('Shadow darkness in percent.'),
      ...PlacementArgs,
      position: Vec3.optional().describe('Light position [x, y, z] in comp pixels. Default: comp centre with z = -500.'),
    },
  });

  defineTool(server, {
    name: 'add-footage-to-composition',
    group: 'layers',
    description:
      'Adds a project item (imported footage, an image, an audio file, a solid or a composition) to a composition as a new layer at the top of the stack. ' +
      'Use when: a file has been imported with import-file and you want it in the timeline. Do not use for: nesting a composition when you already know it is a composition (add-composition-as-layer does the same with a comp reference) or importing from disk (import-file first). ' +
      'Inputs: item {id}, {name} or {index} from list-project-items; time or frame for the layer start (startTime and startFrame do the same); inPoint and outPoint in seconds to trim; the shared placement fields (name, position, duration, label, parent, blendMode, threeD, above, below, toBottom). ' +
      'Returns: composition, the item added and the new layer summary with index, id and timing. ' +
      'Notes: still images get the composition duration. A composition cannot be added to itself. Undoable in one step. ' +
      'Example: item {name: "clip.mov"}, frame 24, name "Clip A".',
    input: {
      comp: CompRef.optional(),
      item: ItemRef,
      ...TimeArgs,
      ...PlacementArgs,
    },
  });

  defineTool(server, {
    name: 'add-composition-as-layer',
    group: 'layers',
    description:
      'Nests one composition inside another as a precomp layer. The nested comp renders as a single layer that can be moved, scaled, trimmed and given effects. ' +
      'Use when: assembling scenes into a master comp, or reusing an animated element. Do not use for: turning existing layers into a precomp (precompose) or adding footage (add-footage-to-composition). ' +
      'Inputs: sourceComp {id} or {name}, the composition to nest; comp, the composition it goes into (default: the active one); time or frame for the layer start; the shared placement fields (name, position, inPoint, outPoint, duration, label, parent, blendMode, threeD, above, below, toBottom). ' +
      'Returns: composition, the source composition and the new layer summary. ' +
      'Notes: fails with invalid-argument when the source and target are the same comp. Collapse transformations is left off; use set-layer-flags to turn it on. Undoable in one step. ' +
      'Example: sourceComp {name: "Scene 02"}, comp {name: "Master"}, frame 120.',
    input: {
      comp: CompRef.optional().describe('The composition to add the layer to. Default: the active composition.'),
      sourceComp: CompRef.refine((r) => r.id !== undefined || r.name !== undefined, { message: 'sourceComp needs id or name' }).describe('The composition to nest, by {id} or {name}.'),
      ...TimeArgs,
      ...PlacementArgs,
    },
  });

  defineTool(server, {
    name: 'delete-layer',
    group: 'layers',
    description:
      'Removes one layer from a composition. Layers below it move up one index. ' +
      'Use when: removing a layer you created by mistake or clearing a placeholder. Do not use for: several layers (delete-layers) or hiding a layer temporarily (set-layer-flags with enabled false). ' +
      'Inputs: comp (optional) and layer by {index}, {id} or {name}. ' +
      'Returns: composition, removed {index, id, name} and remainingCount. ' +
      'Notes: layers parented to the removed layer lose their parent. Indices of the layers below shift, so re-run list-layers before further index-based calls. Undoable in one step. ' +
      'Example: layer {name: "Temp Guide"}.',
    input: { comp: CompRef.optional(), layer: LayerRef },
  });

  defineTool(server, {
    name: 'delete-layers',
    group: 'layers',
    description:
      'Removes several layers from a composition in one call: an explicit list, the timeline selection, or every layer. ' +
      'Use when: clearing a set of layers after an experiment or removing every selected layer. Do not use for: one layer (delete-layer) or emptying a comp you then delete (delete-composition). ' +
      'Inputs: comp (optional); layers as an array of layer references, {selected: true} or {all: true}. ' +
      'Returns: composition, removedCount, removed[] with {index, id, name} as they were before removal, and remainingCount. ' +
      'Notes: layers are removed from the highest index down so earlier removals do not shift later targets. Undoable in one step. ' +
      'Example: layers [{name: "Guide 1"}, {name: "Guide 2"}].',
    input: { comp: CompRef.optional(), layers: LayersSpec },
  });

  defineTool(server, {
    name: 'rename-layer',
    group: 'layers',
    description:
      'Renames a layer. The layer keeps its index, id, effects and keyframes. ' +
      'Use when: giving generated layers meaningful names before referencing them by {name}. Do not use for: renaming compositions (rename-composition) or project items (rename-item). ' +
      'Inputs: comp (optional); layer; newName, the new layer name. ' +
      'Returns: composition, previousName and the layer summary with the new name. ' +
      'Notes: names need not be unique, but duplicate names make {name} references ambiguous, so prefer unique names. Undoable in one step. ' +
      'Example: layer {index: 3}, newName "Title Shadow".',
    input: { comp: CompRef.optional(), layer: LayerRef, newName: z.string().min(1).describe('The new layer name.') },
  });

  defineTool(server, {
    name: 'move-layer',
    group: 'layers',
    description:
      'Moves a layer to a different position in the layer stack. Index 1 is the top layer and renders in front. ' +
      'Use when: putting a background behind everything, or a matte directly above the layer it masks. Do not use for: changing position in the frame (set-transform) or timing (set-layer-timing). ' +
      'Inputs: comp (optional); layer; exactly one of toIndex (1-based target index), above (a layer reference to sit directly above), below (a layer reference to sit directly below), toTop true or toBottom true. ' +
      'Returns: composition, previousIndex, newIndex, the layer summary and order[], the names of every layer from top to bottom. ' +
      'Notes: other layers keep their relative order. Layer ids do not change, so use {id} references when reordering several layers. Undoable in one step. ' +
      'Example: layer {name: "BG"}, toBottom true.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      toIndex: z.number().int().positive().optional().describe('Target 1-based index.'),
      above: LayerRef.optional().describe('Place directly above this layer.'),
      below: LayerRef.optional().describe('Place directly below this layer.'),
      toTop: z.boolean().optional().describe('Move to index 1.'),
      toBottom: z.boolean().optional().describe('Move to the last index.'),
    },
  });

  defineTool(server, {
    name: 'set-layer-parent',
    group: 'layers',
    description:
      'Parents a layer to another layer so it follows the parent\'s position, scale and rotation. This is how groups are moved together in After Effects. ' +
      'Use when: attaching layers to a null controller or making a shadow follow its object. Do not use for: removing a parent (clear-layer-parent) or creating the controller (create-null-layer with children). ' +
      'Inputs: comp (optional); layer, the child; parent, the layer to attach to; keepPosition (default true) keeps the child where it is on screen by adjusting its transform, which is what the After Effects Parent menu does; false keeps the child\'s transform values unchanged so it may jump. ' +
      'Returns: composition, the child layer summary with parent, and method ("parent" or "setParentWithJump"). ' +
      'Notes: a layer cannot be parented to itself or to one of its own children. keepPosition false uses setParentWithJump where available and otherwise falls back with a note. Undoable in one step. ' +
      'Example: layer {name: "Title"}, parent {name: "CTRL"}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      parent: LayerRef.describe('The parent layer.'),
      keepPosition: z.boolean().optional().describe('Keep the child where it is on screen. Default true.'),
    },
  });

  defineTool(server, {
    name: 'clear-layer-parent',
    group: 'layers',
    description:
      'Removes the parent from a layer so it no longer follows another layer. The layer keeps its current on-screen position. ' +
      'Use when: detaching a layer from a controller or before deleting a null that other layers follow. Do not use for: changing to a different parent (set-layer-parent does that in one step). ' +
      'Inputs: comp (optional); layer. ' +
      'Returns: composition, previousParent {index, name} or null, and the layer summary with parent null. ' +
      'Notes: does nothing and reports previousParent null when the layer has no parent. Undoable in one step. ' +
      'Example: layer {name: "Title"}.',
    input: { comp: CompRef.optional(), layer: LayerRef },
  });

  defineTool(server, {
    name: 'set-layer-flags',
    group: 'layers',
    description:
      'Sets any subset of a layer\'s switches: visibility, solo, shy, lock, guide, motion blur, collapse transformations, adjustment, 3D, audio, effects, frame blending, time remap, preserve transparency and environment layer. ' +
      'Use when: hiding a layer, soloing while you work, turning on motion blur, or making a layer 3D. Do not use for: blend modes (set-layer-blend-mode), quality (set-layer-quality) or track mattes (set-layer-track-matte). ' +
      'Inputs: comp (optional); layer; booleans enabled, solo, shy, locked, guide, motionBlur, collapseTransformations, adjustmentLayer, threeD, audioEnabled, effectsActive, timeRemapEnabled, preserveTransparency, environmentLayer; frameBlending "none", "frame-mix" or "pixel-motion". ' +
      'Returns: composition, the layer summary, changed[] and skipped[] with a reason for each flag that does not apply to this layer type. ' +
      'Notes: some flags do not exist on cameras, lights or audio-only layers and are reported as skipped rather than failing. Motion blur also needs the comp switch (set-composition-settings). Undoable in one step. ' +
      'Example: layer {name: "Card"}, motionBlur true, threeD true.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      enabled: z.boolean().optional().describe('Video switch (eye icon).'),
      solo: z.boolean().optional(),
      shy: z.boolean().optional(),
      locked: z.boolean().optional(),
      guide: z.boolean().optional().describe('Guide layer: visible in the viewer, never rendered.'),
      motionBlur: z.boolean().optional(),
      collapseTransformations: z.boolean().optional().describe('Collapse transformations (precomps) or continuously rasterize (vector layers).'),
      adjustmentLayer: z.boolean().optional(),
      threeD: z.boolean().optional().describe('3D layer switch.'),
      audioEnabled: z.boolean().optional(),
      effectsActive: z.boolean().optional().describe('Effects switch (fx icon).'),
      frameBlending: z.enum(FRAME_BLENDING).optional().describe('"none", "frame-mix" or "pixel-motion".'),
      timeRemapEnabled: z.boolean().optional(),
      preserveTransparency: z.boolean().optional(),
      environmentLayer: z.boolean().optional().describe('Use this 3D layer as an environment map.'),
    },
  });

  defineTool(server, {
    name: 'set-layer-blend-mode',
    group: 'layers',
    description:
      'Sets how a layer mixes with the layers below it (its blend mode), for example "add" for light, "multiply" for shadows, "screen" for glows. ' +
      'Use when: compositing a glow, texture or overlay, or making a black background disappear with "screen". Do not use for: opacity (set-transform) or track mattes (set-layer-track-matte). ' +
      'Inputs: comp (optional); layer; blendMode, one of the names in the schema such as "normal", "add", "multiply", "screen", "overlay", "soft-light", "difference", "stencil-alpha". ' +
      'Returns: composition, previousBlendMode and the layer summary with blendMode. ' +
      'Notes: the stencil and silhouette modes affect every layer below. Undoable in one step. ' +
      'Example: layer {name: "Glow"}, blendMode "add".',
    input: { comp: CompRef.optional(), layer: LayerRef, blendMode: z.enum(BLEND_MODES).describe('Blend mode name.') },
  });

  defineTool(server, {
    name: 'set-layer-label-color',
    group: 'layers',
    description:
      'Sets the label colour of one layer or several layers. Labels are the small colour swatches in the timeline and are used to group and select related layers. ' +
      'Use when: colour-coding audio, text and control layers so a human can read the timeline. Do not use for: anything that renders; labels never affect the picture. ' +
      'Inputs: comp (optional); layer, or layers as an array, {selected: true} or {all: true}; label as a name ("red", "yellow", "aqua", "pink", "lavender", "peach", "sea-foam", "blue", "green", "purple", "orange", "brown", "fuchsia", "cyan", "sandstone", "dark-green", "none") or index 0 to 16. ' +
      'Returns: composition, label name and index, and layers[] with index, name and label. ' +
      'Notes: label 0 is "none". Undoable in one step. ' +
      'Example: layers {selected: true}, label "aqua".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.optional(),
      layers: LayersSpec.optional(),
      label: z.union([z.enum(LABEL_COLORS), z.number().int().min(0).max(16)]).describe('Label colour name or index 0-16.'),
    },
  });

  defineTool(server, {
    name: 'set-layer-track-matte',
    group: 'layers',
    description:
      'Uses one layer as a track matte for another, so the target is only visible where the matte is opaque (alpha) or bright (luma). ' +
      'Use when: revealing a video through text, clipping a texture to a shape, or building a wipe. Do not use for: masks drawn on the layer itself (create-mask) or stencil blend modes. ' +
      'Inputs: comp (optional); layer, the layer that gets matted; matteLayer, the layer used as the matte; type "alpha", "alpha-inverted", "luma", "luma-inverted" or "none" to clear. ' +
      'Returns: composition, the layer summary with trackMatte and trackMatteLayer, the matte {index, name}, method and movedMatte. ' +
      'Notes: After Effects 23 and later accept any layer as the matte through setTrackMatte. On older versions the matte must sit directly above the layer; this tool moves it there and reports movedMatte true. The matte layer keeps rendering unless you disable it with set-layer-flags. Undoable in one step. ' +
      'Example: layer {name: "Video"}, matteLayer {name: "Title"}, type "alpha".',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      matteLayer: LayerRef.optional().describe('The layer to use as the matte. Not needed for type "none".'),
      type: z.enum(TRACK_MATTES).describe('"alpha", "alpha-inverted", "luma", "luma-inverted" or "none".'),
    },
  });

  defineTool(server, {
    name: 'set-layer-quality',
    group: 'layers',
    description:
      'Sets a layer\'s render quality: "best" (full quality, anti-aliased), "draft" (faster, no anti-aliasing or subpixel positioning) or "wireframe" (outline only). ' +
      'Use when: a preview is slow and you want draft while working, or before rendering to make sure everything is best. Do not use for: comp resolution (set-composition-settings) or motion blur (set-layer-flags). ' +
      'Inputs: comp (optional); layer; quality "best", "draft" or "wireframe". ' +
      'Returns: composition, previousQuality and the layer summary with quality. ' +
      'Notes: new layers are "best" by default. Draft quality shows in renders too, so reset it before render. Cameras and lights have no quality switch and return an error. Undoable in one step. ' +
      'Example: layer {name: "Heavy Precomp"}, quality "draft".',
    input: { comp: CompRef.optional(), layer: LayerRef, quality: z.enum(LAYER_QUALITY).describe('"best", "draft" or "wireframe".') },
  });

  defineTool(server, {
    name: 'split-layer-at-time',
    group: 'layers',
    description:
      'Splits a layer into two at a time: the original keeps the part before the split, a duplicate placed directly above keeps the part after. Both keep effects, keyframes and expressions. ' +
      'Use when: cutting a clip to change what happens after a point, or giving the second half a different effect. Do not use for: trimming without a second layer (set-layer-timing) or freeze frames (freeze-frame-at). ' +
      'Inputs: comp (optional); layer; time in seconds or frame (default: the current time); suffixes [before, after] appended to the names (default [" 1", " 2"]); keepNames true to leave both names unchanged. ' +
      'Returns: composition, splitTime, splitFrame, before (the original layer summary) and after (the new layer summary). ' +
      'Notes: the split time must be strictly inside the layer\'s in and out points. Undoable in one step. ' +
      'Example: layer {name: "Clip"}, frame 48.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef,
      ...TimeArgs,
      suffixes: z.tuple([z.string(), z.string()]).optional().describe('Name suffixes for [before, after]. Default [" 1", " 2"].'),
      keepNames: z.boolean().optional().describe('Leave both layer names unchanged. Default false.'),
    },
  });

  defineTool(server, {
    name: 'align-layers',
    group: 'layers',
    description:
      'Aligns layers to the composition edges or centre, or to the bounding box of the group, by moving Position. Layer bounds come from the visible content (sourceRectAtTime) scaled by the layer\'s Scale. ' +
      'Use when: snapping a title to the left edge, centring a group, or lining up a row of icons. Do not use for: even spacing (distribute-layers) or centring one layer (center-layers). ' +
      'Inputs: comp (optional); layers as an array, {selected: true} or {all: true}; horizontal "left", "center" or "right"; vertical "top", "center" or "bottom"; at least one of the two; relativeTo "comp" (default) or "selection" (the combined bounds of the layers). ' +
      'Returns: composition, relativeTo, the target bounds, and layers[] with index, name, bounds and new position. ' +
      'Notes: bounds ignore rotation and parenting, so rotated or parented layers may land slightly off. Cameras and lights are skipped. If Position has keyframes a keyframe is set at the current time. Undoable in one step. ' +
      'Example: layers [{name: "Icon 1"}, {name: "Icon 2"}], vertical "center", relativeTo "selection".',
    input: {
      comp: CompRef.optional(),
      layers: LayersSpec,
      horizontal: z.enum(['left', 'center', 'right']).optional(),
      vertical: z.enum(['top', 'center', 'bottom']).optional(),
      relativeTo: z.enum(['comp', 'selection']).optional().describe('"comp" (default) or "selection".'),
    },
  });

  defineTool(server, {
    name: 'distribute-layers',
    group: 'layers',
    description:
      'Spreads layers evenly along one axis by moving Position: either equal spacing between their centres, or an equal gap between their edges. ' +
      'Use when: laying out a row of icons, a column of list items, or a grid one axis at a time. Do not use for: aligning to an edge (align-layers) or staggering in time (sequence-layers). ' +
      'Inputs: comp (optional); layers (at least three for "centers"); axis "horizontal" or "vertical"; mode "centers" (default) keeps the first and last layer where they are and spaces the centres between them, or "spacing" places each layer after the previous one with gap pixels between their edges; gap in pixels (default 0, only for "spacing"). ' +
      'Returns: composition, axis, mode, and layers[] in the new order with index, name and position. ' +
      'Notes: layers are sorted by their current position along the axis first. Bounds ignore rotation and parenting. If Position has keyframes a keyframe is set at the current time. Undoable in one step. ' +
      'Example: layers {selected: true}, axis "horizontal", mode "spacing", gap 40.',
    input: {
      comp: CompRef.optional(),
      layers: LayersSpec,
      axis: z.enum(['horizontal', 'vertical']).describe('Axis to distribute along.'),
      mode: z.enum(['centers', 'spacing']).optional().describe('"centers" (default) or "spacing".'),
      gap: z.number().optional().describe('Gap in pixels between edges for mode "spacing". Default 0.'),
    },
  });

  defineTool(server, {
    name: 'sequence-layers',
    group: 'layers',
    description:
      'Places layers one after another in time, in the order given, with an optional overlap and an automatic opacity crossfade. ' +
      'Use when: turning a set of stills into a slideshow, chaining clips, or staggering entrances at a fixed interval. Do not use for: offsetting keyframes across layers (stagger-keyframes-across-layers). ' +
      'Inputs: comp (optional); layers in the desired order; interval in seconds or intervalFrames (default: each layer\'s own duration, so the next one starts when the previous ends); overlap in seconds or overlapFrames (default 0) subtracted from the interval; crossfade true adds Opacity keyframes over the overlap (fade in at the in point, fade out at the out point, first layer does not fade in and last does not fade out); time or frame for the first layer (default: its current in point). ' +
      'Returns: composition, count, overlap, and layers[] with index, name, inPoint, outPoint, inFrame, outFrame, startTime and crossfade keys written. ' +
      'Notes: layers are moved by changing startTime, so trims are kept. Undoable in one step. ' +
      'Example: layers [{name: "Slide 1"}, {name: "Slide 2"}, {name: "Slide 3"}], intervalFrames 90, overlapFrames 15, crossfade true.',
    input: {
      comp: CompRef.optional(),
      layers: LayersSpec,
      ...TimeArgs,
      interval: z.number().positive().optional().describe('Seconds from one in point to the next. Default: previous layer duration.'),
      intervalFrames: z.number().int().positive().optional().describe('Interval in frames; wins over interval.'),
      overlap: z.number().min(0).optional().describe('Overlap in seconds. Default 0.'),
      overlapFrames: z.number().int().min(0).optional().describe('Overlap in frames; wins over overlap.'),
      crossfade: z.boolean().optional().describe('Add opacity fades over the overlap. Default false.'),
      easing: Easing.optional().describe('Easing for the crossfade keys. Default "ease".'),
    },
  });

  defineTool(server, {
    name: 'select-layers',
    group: 'layers',
    description:
      'Selects layers in the timeline: a list of layers, all of them, or none. Selection matters for tools that take {selected: true} and for human-driven steps in After Effects. ' +
      'Use when: preparing a selection for precompose, delete-layers or align-layers with {selected: true}, or clearing the selection before a menu command. Do not use for: reading the selection (get-selected-layers). ' +
      'Inputs: comp (optional); layers as an array of layer references, {all: true} or {none: true}; add true keeps the existing selection and adds to it (default false replaces it). ' +
      'Returns: composition, selectedCount and selected[] with index, id and name. ' +
      'Notes: selecting a layer does not change the project, so this is not an undo step. ' +
      'Example: layers [{name: "Title"}, {name: "Subtitle"}].',
    input: {
      comp: CompRef.optional(),
      layers: z.union([z.array(LayerRef).min(1), z.object({ all: z.boolean().optional(), none: z.boolean().optional() })]).describe('Layer references, {all: true} or {none: true}.'),
      add: z.boolean().optional().describe('Add to the current selection instead of replacing it. Default false.'),
    },
  });

  defineTool(server, {
    name: 'get-selected-layers',
    group: 'layers',
    mutating: false,
    description:
      'Returns the layers currently selected in the timeline of a composition, with the same summary as list-layers. ' +
      'Use when: the user says "the selected layers" or you want to check what select-layers did. Do not use for: every layer (list-layers) or the full property tree (get-layer-details). ' +
      'Inputs: comp (optional, active comp by default); includeKeyframes to add keyframedProperties[]. ' +
      'Returns: composition, count and layers[] with index, id, name, type, timing, parent, blend mode and transform values. ' +
      'Notes: read-only. Returns count 0 and an empty list when nothing is selected. ' +
      'Example: get-selected-layers, then set-layer-label-color with layers {selected: true}.',
    input: { comp: CompRef.optional(), includeKeyframes: z.boolean().optional().describe('Add keyframedProperties[] to each layer. Default false.') },
  });
}
