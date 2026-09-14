/*
 * Shape tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Color, CompRef, Vec2 } from '../schemas/common.js';
import { PlacementArgs } from './layers.js';
import { defineTool } from './registry.js';

export const ShapeGeometryArgs = {
  shapeType: z.enum(['rectangle', 'rounded-rectangle', 'ellipse', 'circle', 'polygon', 'star', 'line', 'arrow', 'path']).optional().describe('Default rectangle.'),
  size: Vec2.optional().describe('[width, height] in pixels. Default [200, 200]. For circle only width is used.'),
  roundness: z.number().min(0).optional().describe('Corner radius for rectangles.'),
  cornerRadii: z.array(z.number()).length(4).optional().describe('Per-corner radii; After Effects rectangles are uniform, so the largest is used.'),
  points: z.union([z.number().int().min(3), z.array(Vec2).min(2)]).optional().describe('Point count for polygon/star, or an array of [x,y] vertices for path.'),
  outerRadius: z.number().optional(),
  innerRadius: z.number().optional(),
  outerRoundness: z.number().optional(),
  from: Vec2.optional().describe('Line start, relative to the layer position.'),
  to: Vec2.optional().describe('Line end.'),
  headSize: z.number().optional().describe('Arrow head size.'),
  shaftWidth: z.number().optional().describe('Arrow shaft width.'),
  closed: z.boolean().optional().describe('Close a custom path. Default true.'),
  inTangents: z.array(Vec2).optional(),
  outTangents: z.array(Vec2).optional(),
  fillColor: Color.optional().describe('Default white.'),
  fillOpacity: z.number().min(0).max(100).optional(),
  noFill: z.boolean().optional().describe('Create no fill.'),
  strokeColor: Color.optional(),
  strokeWidth: z.number().min(0).optional().describe('0 (default) means no stroke.'),
  strokeOpacity: z.number().min(0).max(100).optional(),
  lineCap: z.enum(['butt', 'round', 'square']).optional(),
  lineJoin: z.enum(['miter', 'round', 'bevel']).optional(),
  dashes: z.array(z.number()).optional().describe('[dash, gap] in pixels.'),
  groupName: z.string().optional(),
};

export function registerShapeTools(server: McpServer): void {
  defineTool(server, {
    name: 'create-shape-layer',
    group: 'shapes',
    description:
      'Creates a shape layer with one group containing a rectangle, rounded rectangle, ellipse, circle, polygon, star, line, arrow or custom path, with an optional fill and stroke (colour, width, caps, joins, dashes). The path is centred on the layer anchor, and the layer is positioned at the comp centre unless told otherwise. ' +
      'Use when: building cards, buttons, lines, connectors, icons, backgrounds and masks-as-shapes. Do not use for: adding a second shape to an existing shape layer (add-shape-to-layer) or modifiers like trim paths (add-shape-modifier). ' +
      'Inputs: shapeType and its geometry (size, roundness, points, from/to, headSize); fillColor, noFill, strokeColor, strokeWidth, lineCap, lineJoin, dashes; the shared placement fields (name, position, timing, parent, above, below). ' +
      'Returns: the layer summary plus the property paths of the group, path, fill and stroke, ready for set-keyframes-bulk or set-shape-fill. ' +
      'Notes: coordinates for path vertices are relative to the layer position. Undoable in one step. ' +
      'Example: shapeType "rounded-rectangle", size [720, 140], roundness 28, fillColor "#111111", strokeColor "#ffffff", strokeWidth 3.',
    input: { comp: CompRef.optional(), ...ShapeGeometryArgs, ...PlacementArgs },
  });
}
