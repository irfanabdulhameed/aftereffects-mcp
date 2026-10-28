/*
 * UI demo kit tools (group 'ui-demo'): the moves of a product film that shows
 * real app screens. A cursor travels and clicks, a tall screen scrolls inside a
 * window, a 2D camera null frames the part that matters, device frames wrap
 * the screen, highlights point at a region, and toasts slide in. Every move is
 * a few eased keys or one slider driving an expression; nothing is keyed per
 * frame and nothing overshoots unless asked.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, Easing, LayerRef, PropertyPath, TimeArgs, Vec2 } from '../schemas/common.js';
import { defineTool } from './registry.js';
import { checkStyleSettings, StyleSettings } from './styles.js';

/* ------------------------------------------------------------------ schemas */

export const UI_ANCHORS = ['center', 'top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export const DEVICES = ['browser', 'phone', 'tablet', 'laptop'] as const;
export const TOAST_POSITIONS = ['top-right', 'top', 'top-left', 'bottom-right', 'bottom', 'bottom-left'] as const;

const Rect = z
  .object({
    x: z.number().describe('Left edge, pixels from the left of the layer\'s content.'),
    y: z.number().describe('Top edge, pixels from the top of the layer\'s content.'),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .describe('A rectangle in the layer\'s own pixels, measured from the top-left of its content (for images and precomps, the source pixels). Default: the whole layer.');

const LayerPoint = z.object({
  layer: LayerRef.describe('The layer to point at.'),
  anchor: z
    .union([z.enum(UI_ANCHORS), Vec2])
    .optional()
    .describe('A named point of the layer\'s content, or [x, y] in the layer\'s own pixels from the content\'s top-left. Default center.'),
  offset: Vec2.optional().describe('[dx, dy] in composition pixels added after the anchor. Default [0, 0].'),
});

const Flip = z.object({
  property: PropertyPath,
  to: z.unknown().refine((v) => v !== undefined, { message: 'to is required' }).describe('New value on the click frame, for example a fill colour.'),
});

const Waypoint = z
  .object({
    to: z.union([Vec2.describe('[x, y] in composition pixels.'), LayerPoint]).describe('Where the cursor tip lands: a point, or a layer with an anchor.'),
    at: z.number().min(0).optional().describe('Seconds when the cursor arrives.'),
    frame: z.number().int().min(0).optional().describe('Frame when the cursor arrives; wins over at.'),
    click: z.boolean().optional().describe('Click on arrival. Default false.'),
    hold: z.number().min(0).max(60).optional().describe('Seconds the cursor rests before leaving. Default 0, or the length of the press when click is true.'),
    pressTarget: z.boolean().optional().describe('With click on a layer target, press that layer as well as the cursor. Default true.'),
    variant: z.enum(['dip', 'pop']).optional().describe('How the target reacts: dip (Scale 96 % and back, default) or pop (a one-frame jump to 108 % and a settle, for a state change).'),
    scale: z.number().min(1).max(400).optional().describe('Target scale at the bottom of the dip or the peak of the pop, percent.'),
    flip: z.array(Flip).min(1).max(20).optional().describe('State changes on the target on the click frame, as hold keys: a fill colour, a checkbox opacity.'),
    easing: Easing.optional().describe('Arrival at this waypoint. Default: the journey easing.'),
  })
  .refine((w) => w.at !== undefined || w.frame !== undefined, { message: 'Each waypoint needs at (seconds) or frame.' });

const Ring = z.object({
  radius: z.number().positive().max(2000).optional().describe('Final radius in pixels. Default 36.'),
  strokeWidth: z.number().positive().max(100).optional().describe('Ring stroke in pixels. Default 2.'),
  color: Color.optional().describe('Default #111111.'),
  opacity: z.number().min(0).max(100).optional().describe('Opacity at the click, fading to 0. Default 35.'),
  style: z.enum(['ring', 'fill']).optional().describe('ring (default) or fill.'),
  duration: z.number().positive().optional().describe('Seconds the ring grows and fades. Default 0.6.'),
  durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
});

const CursorStyle = z.object({
  name: z.string().min(1).optional().describe('Layer name. Default "Cursor".'),
  height: z.number().min(8).max(400).optional().describe('Arrow height in pixels. Default 44.'),
  fillColor: Color.optional().describe('Arrow colour. Default white.'),
  outlineColor: Color.optional().describe('Outline colour. Default #111111.'),
  outlineWidth: z.number().min(0).max(20).optional().describe('Visible outline width in pixels, outside the arrow. Default height / 22.'),
  shadow: z.union([z.boolean(), StyleSettings]).optional().describe('Soft drop-shadow layer style (default on: black 30 %, distance height / 20, size height / 7), false for none, or drop-shadow settings.'),
});

const ScrollStop = z
  .object({
    to: z.union([z.number().min(0), z.enum(['top', 'bottom'])]).optional().describe('Scroll position in page pixels (the page\'s own pixels at the top of the window), or "top" or "bottom".'),
    fraction: z.number().min(0).max(1).optional().describe('Scroll position as a fraction of the scrollable range, 0 (top) to 1 (bottom). Use instead of to.'),
    at: z.number().min(0).optional().describe('Seconds when the page reaches this stop.'),
    frame: z.number().int().min(0).optional().describe('Frame; wins over at.'),
    hold: z.number().min(0).max(60).optional().describe('Seconds the page rests before the next stop. Default 0.'),
    easing: Easing.optional().describe('Arrival at this stop. Default: landing, or glide with momentum.'),
  })
  .refine((s) => (s.to === undefined) !== (s.fraction === undefined), { message: 'Each stop needs exactly one of to or fraction.' })
  .refine((s) => s.at !== undefined || s.frame !== undefined, { message: 'Each stop needs at (seconds) or frame.' });

const ReturnSpec = z.object({
  hold: z.number().min(0).max(60).optional().describe('Seconds held on the region before returning. Default 1.'),
  duration: z.number().positive().optional().describe('Seconds of the return move. Default: the same as the move in.'),
  durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
  easing: Easing.optional().describe('Arrival back at rest. Default: the move-in easing.'),
});

const DimSpec = z.object({
  color: Color.optional().describe('Default black.'),
  opacity: z.number().min(0).max(100).optional().describe('How dark the rest of the frame gets, percent. Default 55.'),
  feather: z.number().min(0).max(500).optional().describe('Soft edge of the hole, pixels. Default 16.'),
});

const OutlineSpec = z.object({
  color: Color.optional().describe('Outline colour, also the default label and line colour. Default #2F6BFF.'),
  width: z.number().positive().max(50).optional().describe('Stroke width in pixels. Default 3.'),
  opacity: z.number().min(0).max(100).optional().describe('Default 100.'),
  grow: z.number().min(0).max(400).optional().describe('Extra size the outline starts with and contracts from, pixels. Default 16.'),
});

const LabelSpec = z.object({
  text: z.string().min(1),
  side: z.enum(['auto', 'top', 'bottom', 'left', 'right']).optional().describe('Side of the region for the label. Default auto (top, then bottom, right, left, whichever fits).'),
  distance: z.number().min(0).max(2000).optional().describe('Gap between the region edge and the label pill, pixels. Default 56.'),
  fontSize: z.number().positive().max(400).optional().describe('Default 28.'),
  font: z.string().optional().describe('PostScript font name. Default: the After Effects default.'),
  textColor: Color.optional().describe('Default white.'),
  fillColor: Color.optional().describe('Pill colour. Default the outline colour.'),
  line: z.boolean().optional().describe('Draw a line from the region to the label. Default true.'),
  lineColor: Color.optional(),
  lineWidth: z.number().positive().max(50).optional().describe('Default 2.'),
  shadow: z.union([z.boolean(), StyleSettings]).optional().describe('Drop shadow on the pill.'),
});

const startArgs = {
  ...TimeArgs,
};

function requireTime(args: { time?: number; frame?: number }, tool: string, what: string): void {
  if (args.time === undefined && args.frame === undefined) throw new Error(`${tool} needs time (seconds) or frame: ${what}.`);
}

function checkShadow(shadow: unknown, label: string): void {
  if (shadow && typeof shadow === 'object') checkStyleSettings('drop-shadow', shadow as Record<string, unknown>, label);
}

/** Times given in seconds must increase; frame-based times are checked in After Effects. */
function checkIncreasing(list: Array<{ at?: number; frame?: number; hold?: number }>, what: string): void {
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (a.frame !== undefined || b.frame !== undefined || a.at === undefined || b.at === undefined) continue;
    if (b.at <= a.at + (a.hold ?? 0)) throw new Error(`${what} ${i + 1} at ${b.at} s must come after ${what} ${i} at ${a.at} s${a.hold ? ` and its ${a.hold} s hold` : ''}.`);
  }
}

/* -------------------------------------------------------------------- tools */

export function registerUiDemoTools(server: McpServer): void {
  defineTool(server, {
    name: 'cursor-journey',
    group: 'ui-demo',
    description:
      'Moves a cursor through waypoints with one eased Position key per stop and clicks with the press mechanism: the target dips, or pops to 108 % for a state change, and the cursor dips deeper, with an optional click ring. Builds a clean arrow cursor (white, dark outline, soft layer-style shadow) when none is given and keeps it on top. ' +
      'Use when: a product demo needs a pointer that travels to buttons, fields and rows and clicks them. Do not use for: a press without travel (press) or a hand-drawn route (move-along-path). ' +
      'Inputs: waypoints [{to [x, y] or {layer, anchor, offset}, at or frame, click, hold, pressTarget, variant, scale, flip, easing}]; cursor (its anchor is the tip) or cursorStyle; arc (0.1 reads natural); clickRing; clickDelay; cursorScale (default 92); easing (default landing). ' +
      'Returns: the cursor, its Position keys, the resolved waypoints and each click with times and keys. ' +
      'Notes: speed 0 at every stop; a click holds the cursor through the press; targets are measured at arrival; a new cursor rides an existing UI Camera null. Undoable in one step. ' +
      'Example: waypoints [{to: [240, 980], at: 0.5}, {to: {layer: {name: "Send"}}, at: 1.4, click: true}], arc 0.1, clickRing true.',
    input: {
      comp: CompRef.optional(),
      waypoints: z.array(Waypoint).min(1).max(100),
      cursor: LayerRef.optional().describe('An existing cursor layer. Its anchor point is the tip. Default: build an arrow cursor.'),
      cursorStyle: CursorStyle.optional().describe('Look of the cursor that is built when cursor is not given.'),
      arc: z.number().min(-0.5).max(0.5).optional().describe('Bow of each travel segment as a fraction of its length; positive bows up (left on vertical moves). Default 0, straight.'),
      clickRing: z.union([z.boolean(), Ring]).optional().describe('true for a soft ring at each click point, or its settings.'),
      clickDelay: z.number().min(0).max(5).optional().describe('Seconds between arriving and pressing. Default 0.'),
      cursorScale: z.number().min(10).max(100).optional().describe('Cursor scale at the bottom of each click, percent. Default 92.'),
      easing: Easing.optional().describe('Arrival at every waypoint. Default landing: speed 0, influence 25 leaving and 100 arriving.'),
      keepOnTop: z.boolean().optional().describe('Move the cursor to the top of the stack. Default true.'),
      rideCamera: z.boolean().optional().describe('Parent a newly built cursor to an existing UI Camera or Camera Push null. Default true.'),
    },
    toBridgeArgs: (args) => {
      checkIncreasing(args.waypoints, 'waypoint');
      checkShadow(args.cursorStyle?.shadow, 'cursorStyle.shadow');
      const { clickRing, ...rest } = args;
      if (clickRing === true) return { ...rest, clickRing: {} };
      if (clickRing === false || clickRing === undefined) return rest;
      return { ...rest, clickRing };
    },
  });

  defineTool(server, {
    name: 'scroll-in-window',
    group: 'ui-demo',
    description:
      'Scrolls a tall screen (image, footage or precomp) inside a window: the screen moves into a precomposition the size of the window, fitted to its width, and a "Scroll" slider in page pixels drives its Position by expression; each stop is one eased key on the slider. ' +
      'Use when: a web page or app screen scrolls inside a browser, phone or panel. Do not use for: moving the whole screen (animate-property) or framing a part of it (focus-on-region). ' +
      'Inputs: layer; window {x, y, width, height} in composition pixels, or windowLayer with inset; cornerRadius; fit width or keep; name; stops [{to pixels, "top" or "bottom", or fraction 0 to 1, at or frame, hold, easing}]; momentum (flick and glide); sliderName. ' +
      'Returns: the window composition and layer, the screen inside, the scroll range, the slider path and keys. ' +
      'Notes: a precomp clips by its bounds, so later moves, parents and camera pushes need no matte kept in step. Calling again on the screen inside adds stops. Undoable in one step. ' +
      'Example: layer {name: "Pricing Page"}, window {x: 360, y: 140, width: 1200, height: 800}, stops [{to: "top", at: 0.5}, {to: 1400, at: 2, hold: 0.8}, {to: "bottom", at: 4}].',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.describe('The tall screen layer, or the screen inside a window made earlier.'),
      window: z
        .object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })
        .optional()
        .describe('The visible region in composition pixels: top-left corner and size.'),
      windowLayer: LayerRef.optional().describe('Use this layer\'s content bounds as the window (a window body or a device screen); the window layer is parented to it and stacked above it.'),
      inset: z.number().min(0).max(1000).optional().describe('Pixels taken off each side of windowLayer\'s bounds. Default 0.'),
      cornerRadius: z.number().min(0).max(1000).optional().describe('Rounded corners on the window, pixels (a mask on the window layer). Default 0.'),
      fit: z.enum(['width', 'keep']).optional().describe('width (default) scales the screen to the window width; keep keeps its current scale, centred.'),
      name: z.string().min(1).max(255).optional().describe('Name of the window composition. Default "<layer> Window".'),
      stops: z.array(ScrollStop).min(1).max(100),
      momentum: z.boolean().optional().describe('Each move launches fast and glides into its stop (cubic-bezier 0.16, 1, 0.3, 1). Default false: landing ease.'),
      sliderName: z.string().min(1).optional().describe('Name of the Slider Control. Default "Scroll".'),
    },
    toBridgeArgs: (args) => {
      if (args.window && args.windowLayer) throw new Error('Pass window or windowLayer, not both.');
      checkIncreasing(args.stops, 'stop');
      return args;
    },
  });

  defineTool(server, {
    name: 'focus-on-region',
    group: 'ui-demo',
    description:
      'Frames a region of a layer so it fills a share of the composition, centred, by keying a 2D camera null: Scale and Position in two eased keys, with an optional hold and return. Reuses a UI Camera or Camera Push null when there is one; otherwise creates one and parents every unparented layer to it once. ' +
      'Use when: the camera should zoom into the part of a screen that matters, then hold or come back. Do not use for: a slow push over a whole scene (add-camera-push) or 3D camera moves (animate-camera). ' +
      'Inputs: layer; rect in its pixels (default its bounds); padding (default 24 px); fill (default 0.7 of width or height, whichever binds); time or frame; duration (default 0.8 s); easing; return true or {hold, duration, easing}; holdPush; camera; name; exclude; maxScale. ' +
      'Returns: the null (created or reused), layers parented and skipped, the scale, and the keys. ' +
      'Notes: the region is measured at the landing; screen overlays stay unparented; a camera push carries on from the new framing; overlapping moves are refused. Undoable in one step. ' +
      'Example: layer {name: "Dashboard"}, rect {x: 820, y: 140, width: 560, height: 320}, frame 90, durationFrames 48, return {hold: 1.5}.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.describe('The layer holding the region, or the element to frame.'),
      rect: Rect.optional(),
      padding: z.number().min(0).max(2000).optional().describe('Pixels of room around the region. Default 24.'),
      fill: z.number().min(0.05).max(1).optional().describe('Share of the frame the padded region fills, on the axis that binds. Default 0.7.'),
      ...startArgs,
      duration: z.number().positive().optional().describe('Seconds of the move in. Default 0.8.'),
      durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
      easing: Easing.optional().describe('Default camera landing: speed 0, influence 33.3 leaving and 100 arriving.'),
      return: z.union([z.boolean(), ReturnSpec]).optional().describe('true (hold 1 s, return as long as the move in) or settings. Default: stay on the region.'),
      holdPush: z.number().min(-50).max(50).optional().describe('Percent the zoom keeps growing over the hold, so the held frame stays alive. Default 0.'),
      camera: LayerRef.optional().describe('Use this null as the camera.'),
      name: z.string().min(1).optional().describe('Name of the camera null to find or create. Default "UI Camera".'),
      exclude: z.array(LayerRef).max(500).optional().describe('Layers that must not ride a newly created camera null (captions, a fixed logo).'),
      maxScale: z.number().min(1).max(10000).optional().describe('Highest scale in percent. Default 800.'),
    },
    toBridgeArgs: (args) => {
      requireTime(args, 'focus-on-region', 'when the move starts');
      const { return: ret, ...rest } = args;
      if (ret === true) return { ...rest, return: {} };
      if (ret === false || ret === undefined) return rest;
      return { ...rest, return: ret };
    },
  });

  defineTool(server, {
    name: 'device-frame',
    group: 'ui-demo',
    description:
      'Wraps a screen layer in a clean device frame drawn with shape layers and sized to the screen: a browser window (chrome bar, three dots, address pill with optional URL text), a phone (rounded body, bezel, optional island), a tablet or a laptop (screen and base), light or dark, with a soft layer-style shadow. ' +
      'Use when: a screenshot or screen precomp should read as an app on a device. Do not use for: a plain rounded card (create-shape-layer) or a window that scrolls (scroll-in-window first, then frame its window layer). ' +
      'Inputs: layer (the screen); device browser, phone, tablet or laptop; theme light or dark; color (frame colour); cornerRadius; url and font (browser); dots mono or color; notch (phone); shadow; name; component true or {name, templateName}; time or frame for measuring. ' +
      'Returns: the frame layers, the sizes used, the mask that rounds the screen, colour expressions, the shadow result and the component when made. ' +
      'Notes: parts are parented to the screen; derived colours follow the frame colour by expression, so one Theme Colour Essential Property recolours everything. Undoable in one step. ' +
      'Example: layer {name: "App Screen"}, device "browser", url "app.example.com", component true.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.describe('The screen layer to frame.'),
      device: z.enum(DEVICES),
      theme: z.enum(['light', 'dark']).optional().describe('Default light.'),
      color: Color.optional().describe('Frame colour (browser chrome, device rim and base). Default from the theme.'),
      cornerRadius: z.number().min(0).max(1000).optional().describe('Composition pixels: the browser window corners, or the device screen corners. Default scaled to the screen.'),
      url: z.string().max(300).optional().describe('Browser only: text in the address pill.'),
      font: z.string().optional().describe('PostScript font for the URL. Default: the After Effects default.'),
      dots: z.enum(['mono', 'color']).optional().describe('Browser only: grey dots that follow the frame colour (default) or the red, yellow and green ones.'),
      notch: z.boolean().optional().describe('Phone only: the island at the top of the screen. Default true.'),
      shadow: z.union([z.boolean(), StyleSettings]).optional().describe('Soft drop-shadow layer style on the frame (default on), false for none, or drop-shadow settings.'),
      name: z.string().min(1).optional().describe('Base name for the frame layers. Default "<screen> <Device>".'),
      component: z
        .union([z.boolean(), z.object({ name: z.string().min(1).max(255).optional(), templateName: z.string().min(1).max(255).optional() })])
        .optional()
        .describe('Put the screen and frame into one component with Essential Properties Theme Colour and URL (create-component).'),
      ...TimeArgs,
    },
    toBridgeArgs: (args) => {
      if (args.url !== undefined && args.device !== 'browser') throw new Error('url is drawn only on the browser frame.');
      if (args.dots !== undefined && args.device !== 'browser') throw new Error('dots apply only to the browser frame.');
      if (args.notch !== undefined && args.device !== 'phone') throw new Error('notch applies only to the phone frame.');
      checkShadow(args.shadow, 'shadow');
      if (args.component === false) {
        const { component, ...rest } = args;
        void component;
        return rest;
      }
      return args;
    },
  });

  defineTool(server, {
    name: 'highlight-region',
    group: 'ui-demo',
    description:
      'Draws attention to a part of a screen: dims everything else with a solid whose inverted, feathered rounded-rectangle mask leaves the region clear, outlines the region with a rounded stroke that contracts onto it, and adds an optional label in a pill with a line to it; everything reveals with eased keys and can hide again. ' +
      'Use when: a feature, button or number on a screen needs pointing out. Do not use for: moving the camera there (focus-on-region) or a fixed rectangle (create-shape-layer). ' +
      'Inputs: layer; rect in its pixels (default its bounds); padding (default 8); cornerRadius (default 12); dim true, false or {color, opacity, feather}; outline true, false or {color, width, opacity, grow}; label text or {text, side, distance, fontSize, font, textColor, fillColor, line, shadow}; time or frame; duration (default 0.4 s); hideTime or hideFrame; follow; above; name. ' +
      'Returns: the layers, the region in composition pixels, the keys, and every expression with any error. ' +
      'Notes: overlays stay fixed to the frame; follow true tracks the region through scrolls, parents and camera moves by expression. Undoable in one step. ' +
      'Example: layer {name: "Dashboard"}, rect {x: 40, y: 220, width: 380, height: 180}, frame 120, label "Live revenue", hideFrame 300.',
    input: {
      comp: CompRef.optional(),
      layer: LayerRef.describe('The layer holding the region.'),
      rect: Rect.optional(),
      padding: z.number().min(0).max(500).optional().describe('Pixels added around the region. Default 8.'),
      cornerRadius: z.number().min(0).max(1000).optional().describe('Corner radius of the region, pixels; the outline adds the padding to stay concentric. Default 12.'),
      dim: z.union([z.boolean(), DimSpec]).optional().describe('Darken the rest of the frame. Default true.'),
      outline: z.union([z.boolean(), OutlineSpec]).optional().describe('Rounded outline around the region. Default true.'),
      label: z.union([z.string().min(1), LabelSpec]).optional().describe('A callout in a pill, with a line to the region.'),
      ...startArgs,
      duration: z.number().positive().optional().describe('Seconds of each reveal. Default 0.4; parts follow each other by 3 frames at 60 fps.'),
      durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
      easing: Easing.optional().describe('Default landing: speed 0, influence 25 leaving and 100 arriving.'),
      hideTime: z.number().min(0).optional().describe('Seconds when the hide starts. Default: no hide.'),
      hideFrame: z.number().int().min(0).optional().describe('Frame; wins over hideTime.'),
      hideDuration: z.number().positive().optional().describe('Seconds of the hide. Default 0.3.'),
      hideDurationFrames: z.number().int().positive().optional().describe('Frames; wins over hideDuration.'),
      follow: z.boolean().optional().describe('Track the region every frame (scroll, parents, camera). Default true; false pins the overlays where the region is at the reveal.'),
      above: LayerRef.optional().describe('Stack the overlays directly above this layer. Default: the top, under a cursor made by cursor-journey.'),
      name: z.string().min(1).optional().describe('Base name of the overlay layers. Default "Highlight".'),
    },
    toBridgeArgs: (args) => {
      requireTime(args, 'highlight-region', 'when the reveal starts');
      if (args.dim === false && args.outline === false && args.label === undefined) throw new Error('Nothing to draw: dim and outline are off and there is no label.');
      if (args.label && typeof args.label === 'object') checkShadow(args.label.shadow, 'label.shadow');
      return args;
    },
  });

  defineTool(server, {
    name: 'add-toast',
    group: 'ui-demo',
    description:
      'Adds a notification toast: a rounded card with an accent dot, a title and an optional body, sized to its text, that slides in from the nearest frame edge with two eased keys, rests, and slides out with two accelerating keys. ' +
      'Use when: a demo shows a confirmation, an alert or a "saved" message. Do not use for: a label pointing at part of a screen (highlight-region) or a pill that wraps changing text (add-text-box). ' +
      'Inputs: title; body; position top-right (default), top, top-left, bottom-right, bottom or bottom-left; margin (default 32); width (default 420); padding; theme light or dark; accentColor; titleSize and bodySize; font and titleFont; cornerRadius; time or frame; duration (default 0.5 s) or durationFrames; hold (default 2.5 s); exit (default true); exitDuration (default 0.35 s); easing; shadow; name. ' +
      'Returns: the card and text layers, the card size, rest and start positions, the times and the keys. ' +
      'Notes: the texts are parented to the card, so only the card is keyed; the card is a screen overlay that a camera null leaves alone. Undoable in one step. ' +
      'Example: title "Export finished", body "Your video is ready to share.", frame 150, position "top-right".',
    input: {
      comp: CompRef.optional(),
      title: z.string().min(1).max(200).describe('Bold first line of the toast.'),
      body: z.string().max(600).optional().describe('Optional second line under the title.'),
      position: z.enum(TOAST_POSITIONS).optional(),
      margin: z.number().min(0).max(1000).optional().describe('Pixels from the frame edges. Default 32.'),
      width: z.number().min(120).max(2000).optional().describe('Card width in pixels. Default 420.'),
      padding: z.number().min(0).max(200).optional().describe('Inner padding in pixels. Default 20.'),
      theme: z.enum(['light', 'dark']).optional().describe('Default light.'),
      accentColor: Color.optional().describe('Colour of the dot. Default #2F6BFF.'),
      titleSize: z.number().positive().max(200).optional().describe('Default 22.'),
      bodySize: z.number().positive().max(200).optional().describe('Default 18.'),
      font: z.string().optional().describe('PostScript font for the body (and the title unless titleFont is given).'),
      titleFont: z.string().optional().describe('PostScript name of the title font. Default: the body font in bold where available.'),
      cornerRadius: z.number().min(0).max(200).optional().describe('Default 14.'),
      ...startArgs,
      duration: z.number().positive().optional().describe('Seconds of the slide in. Default 0.5.'),
      durationFrames: z.number().int().positive().optional().describe('Frames; wins over duration.'),
      hold: z.number().min(0).max(60).optional().describe('Seconds the toast rests. Default 2.5.'),
      exit: z.boolean().optional().describe('Slide out after the hold. Default true.'),
      exitDuration: z.number().positive().max(10).optional().describe('Seconds of the slide out. Default 0.35.'),
      easing: Easing.optional().describe('Arrival. Default landing: speed 0, influence 25 leaving and 100 arriving.'),
      shadow: z.union([z.boolean(), StyleSettings]).optional().describe('Soft drop-shadow layer style (default on), false for none, or settings.'),
      name: z.string().min(1).optional().describe('Card layer name. Default "Toast".'),
    },
    toBridgeArgs: (args) => {
      requireTime(args, 'add-toast', 'when it starts to slide in');
      checkShadow(args.shadow, 'shadow');
      return args;
    },
  });
}
