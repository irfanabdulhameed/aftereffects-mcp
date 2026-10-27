/*
 * Mock result shapes for the vectors commands. See core.js for helpers and shapes to mirror.
 */

import * as fs from 'fs';

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });
const layerInfo = (index, name, type, over = {}) => ({ ...layerRef(index, name), type, enabled: true, position: [960, 540], inPoint: 0, outPoint: 10, ...over });
const node = (name, matchName, kind, index, path) => ({ name, matchName, kind, index, path, enabled: true });

const unsupported = (message, details) => Object.assign(new Error(message), { mcpCode: 'unsupported', details });

export const responses = {
  importVectorAsShapes: (args) => {
    const file = String(args.path ?? '/tmp/logo.ai');
    const base = file.split('/').pop();
    const isSvg = args.extension === 'svg';
    const route = isSvg && args.mode === 'composition' ? 'svg-composition' : 'create-shapes';
    const shapeLayers =
      route === 'svg-composition'
        ? [
            { layer: layerInfo(1, 'circle', 'shape'), groupCount: 1, groups: ['Group 1'] },
            { layer: layerInfo(2, 'path', 'shape'), groupCount: 2, groups: ['Group 1', 'Group 2'] },
          ]
        : [{ layer: layerInfo(1, args.name ?? `${base} Outlines`, 'shape', { position: args.position ?? [960, 540] }), groupCount: 3, groups: ['Group 1', 'Group 2', 'Group 3'] }];
    return {
      composition: comp(),
      file,
      route,
      sourceItem: { id: 12, name: base, type: route === 'svg-composition' ? 'comp' : 'footage' },
      footageItemRemoved: !!args.removeFootageItem && (route === 'svg-composition' || !!args.removeSource),
      sourceLayer: route === 'create-shapes' ? layerInfo(2, base, 'footage', { enabled: false }) : null,
      sourceRemoved: route === 'create-shapes' && !!args.removeSource,
      shapeLayers,
      notes: [],
    };
  },

  setShapeGradient: (args) => {
    const kind = args.target === 'stroke' ? 'stroke' : 'fill';
    const label = kind === 'fill' ? 'Gradient Fill 1' : 'Gradient Stroke 1';
    const matchName = kind === 'fill' ? 'ADBE Vector Graphic - G-Fill' : 'ADBE Vector Graphic - G-Stroke';
    const requested = Array.isArray(args.stops) ? args.stops.length : 0;
    const applied = requested > 0 && !!args.presetPath && fs.existsSync(args.presetPath);
    const stops = { requested, applied, route: applied ? 'preset' : null, reason: requested && !applied ? args.stopsUnavailable ?? 'No gradient template was found, so the colour stops could not be written.' : null };
    const changed = [];
    if (applied) changed.push('stops');
    else changed.push(kind === 'fill' ? 'addedGradientFill' : 'addedGradientStroke');
    if (args.replaceSolid !== false) changed.push(kind === 'fill' ? 'removedSolidFill' : 'removedSolidStroke');
    changed.push('type', 'start', 'end');
    const values = { type: args.type ?? 'linear', start: args.start ?? [-100, 0], end: args.end ?? [100, 0], highlightLength: args.highlightLength ?? 0, highlightAngle: args.highlightAngle ?? 0, opacity: args.opacity ?? 100 };
    if (kind === 'stroke') values.width = args.width ?? 2;
    const out = {
      composition: comp(),
      layer: layerRef(1, 'Card'),
      target: kind,
      group: node('Card', 'ADBE Vector Group', 'group', 1, 'Contents/Card'),
      gradient: node(label, matchName, kind === 'fill' ? 'gradient-fill' : 'gradient-stroke', 2, `Contents/Card/Contents/${label}`),
      gradientPath: `Contents/Card/Contents/${label}`,
      created: true,
      values,
      changed,
      stops,
      notes: [],
    };
    if (requested && !applied && !args.stopsOptional) {
      throw unsupported(`The gradient type and points were set, but the colour stops were not: ${stops.reason} Pass stopsOptional true to accept the gradient without stops.`, out);
    }
    return out;
  },

  shapeFromSvgPath: (args) => {
    const mode = args.layer ? (args.group !== undefined ? 'replace' : 'add') : 'new-layer';
    const groupName = mode === 'replace' ? (typeof args.group === 'string' ? args.group : 'Group 1') : (args.groupName ?? 'SVG Path');
    const paths = Array.isArray(args.paths) ? args.paths : [];
    const hasStroke = (args.strokeWidth ?? 0) > 0 || args.strokeColor !== undefined;
    const hasFill = !args.noFill && (args.fillColor !== undefined || (mode !== 'replace' && !hasStroke));
    return {
      composition: comp(),
      layer: layerInfo(1, args.name ?? (mode === 'new-layer' ? 'SVG Path' : 'Icon'), 'shape', { position: args.position ?? [960, 540] }),
      mode,
      group: node(groupName, 'ADBE Vector Group', 'group', 1, `Contents/${groupName}`),
      groupPath: `Contents/${groupName}`,
      pathCount: paths.length,
      removedPaths: mode === 'replace' ? 1 : 0,
      pathPaths: paths.map((_, i) => `Contents/${groupName}/Contents/Path ${i + 1}/Path`),
      vertexCount: paths.reduce((n, p) => n + (p.vertices?.length ?? 0), 0),
      bounds: args.bounds ?? null,
      placement: args.placement ?? null,
      fillPath: hasFill ? `Contents/${groupName}/Contents/Fill 1` : null,
      strokePath: hasStroke ? `Contents/${groupName}/Contents/Stroke 1` : null,
      notes: [],
    };
  },
};
