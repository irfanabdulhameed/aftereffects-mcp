/*
 * Mock result shapes for the expressions command group. See core.js for helpers and shapes to mirror.
 * The four original expression commands live in core.js; this file covers errors, presets and controls.
 */

const comp = () => ({ id: 1, name: 'Main Comp' });
const layerRef = (index = 1, name = 'Layer 1') => ({ index, id: 100 + index, name });
const propertyState = (path = 'Transform/Opacity', value = 100) => ({
  name: path.split('/').pop(),
  matchName: 'ADBE ' + path.split('/').pop(),
  path,
  matchPath: path,
  index: 1,
  isGroup: false,
  value,
  valueType: Array.isArray(value) ? (value.length === 2 ? '2d-spatial' : '3d') : '1d',
  dimensions: Array.isArray(value) ? value.length : 1,
  canVaryOverTime: true,
  isSpatial: path.endsWith('Position'),
  numKeys: 0,
  hasExpression: true,
});

/* Mirrors MCP.expr.presets in src/scripts/commands/expressions.jsx: name, description, params. */
const PRESETS = [
  { name: 'auto-fade-in-out', description: 'Fades the layer in after its in point and out before its out point.', suits: ['Opacity'], params: [{ name: 'fadeIn', defaultValue: 0.5, description: 'Seconds' }, { name: 'fadeOut', defaultValue: 0.5, description: 'Seconds' }] },
  { name: 'bounce-on-landing', description: 'Bounces after the last keyframe.', suits: ['Position'], params: [{ name: 'height', defaultValue: 50, description: 'Pixels' }, { name: 'bounces', defaultValue: 3, description: 'Count' }, { name: 'decay', defaultValue: 0.5, description: 'Multiplier' }] },
  { name: 'clamp-value', description: 'Keeps the value inside limits.', suits: ['any numeric property'], params: [{ name: 'min', defaultValue: 0, description: '' }, { name: 'max', defaultValue: 100, description: '' }] },
  { name: 'counter-number', description: 'Counts a number as text.', suits: ['Source Text'], params: [{ name: 'from', defaultValue: 0, description: '' }, { name: 'to', defaultValue: 100, description: '' }] },
  { name: 'elastic', description: 'Elastic settle after the last key.', suits: ['Scale'], params: [{ name: 'amplitude', defaultValue: 0.15, description: '' }] },
  { name: 'follow-layer-with-delay', description: 'Copies another layer with a delay.', suits: ['Position'], params: [{ name: 'layerName', defaultValue: null, description: 'Required' }, { name: 'delay', defaultValue: 0.1, description: 'Seconds' }] },
  { name: 'inertia-bounce', description: 'Inertial bounce after the last key.', suits: ['Position'], params: [{ name: 'amplitude', defaultValue: 0.06, description: '' }, { name: 'frequency', defaultValue: 2, description: '' }, { name: 'decay', defaultValue: 4, description: '' }] },
  { name: 'link-to-checkbox', description: 'Switches between two values.', suits: ['Opacity'], params: [{ name: 'controlName', defaultValue: 'Checkbox Control', description: '' }] },
  { name: 'link-to-slider', description: 'Drives the property from a slider.', suits: ['any numeric property'], params: [{ name: 'controlName', defaultValue: 'Slider Control', description: '' }, { name: 'multiplier', defaultValue: 1, description: '' }] },
  { name: 'loop-in', description: 'Loops before the first key.', suits: ['any keyframed property'], params: [{ name: 'type', defaultValue: 'cycle', description: '' }] },
  { name: 'loop-out-cycle', description: 'Repeats after the last key.', suits: ['any keyframed property'], params: [{ name: 'numKeyframes', defaultValue: 0, description: '' }] },
  { name: 'loop-out-offset', description: 'Repeats with offset.', suits: ['Rotation'], params: [{ name: 'numKeyframes', defaultValue: 0, description: '' }] },
  { name: 'loop-out-pingpong', description: 'Ping-pongs after the last key.', suits: ['any keyframed property'], params: [{ name: 'numKeyframes', defaultValue: 0, description: '' }] },
  { name: 'overshoot', description: 'Quick overshoot after the last key.', suits: ['Scale'], params: [{ name: 'amplitude', defaultValue: 0.08, description: '' }] },
  { name: 'posterize-time', description: 'Stepped updates.', suits: ['any property'], params: [{ name: 'fps', defaultValue: 12, description: '' }] },
  { name: 'random-hold', description: 'Random value held for a few frames.', suits: ['Opacity'], params: [{ name: 'min', defaultValue: 0, description: '' }, { name: 'max', defaultValue: 100, description: '' }, { name: 'holdFrames', defaultValue: 6, description: '' }] },
  { name: 'scale-to-fit-text-box', description: 'Shrinks scale to a maximum width.', suits: ['Scale'], params: [{ name: 'maxWidth', defaultValue: 800, description: '' }] },
  { name: 'sine-wave', description: 'Smooth oscillation.', suits: ['Position'], params: [{ name: 'amplitude', defaultValue: 20, description: '' }, { name: 'frequency', defaultValue: 1, description: '' }] },
  { name: 'time-offset-by-index', description: 'Delays by layer index.', suits: ['any keyframed property'], params: [{ name: 'delay', defaultValue: 0.1, description: '' }] },
  { name: 'typewriter-driver', description: 'Reveals text one character at a time.', suits: ['Source Text'], params: [{ name: 'charactersPerSecond', defaultValue: 15, description: '' }] },
  { name: 'wiggle', description: 'Random organic motion.', suits: ['Position'], params: [{ name: 'frequency', defaultValue: 2, description: '' }, { name: 'amplitude', defaultValue: 10, description: '' }] },
];

const CONTROLS = {
  slider: { matchName: 'ADBE Slider Control', prop: 'Slider', defaultName: 'Slider Control' },
  checkbox: { matchName: 'ADBE Checkbox Control', prop: 'Checkbox', defaultName: 'Checkbox Control' },
  color: { matchName: 'ADBE Color Control', prop: 'Color', defaultName: 'Color Control' },
  point: { matchName: 'ADBE Point Control', prop: 'Point', defaultName: 'Point Control' },
  angle: { matchName: 'ADBE Angle Control', prop: 'Angle', defaultName: 'Angle Control' },
  dropdown: { matchName: 'ADBE Dropdown Control', prop: 'Menu', defaultName: 'Dropdown Menu Control' },
  layer: { matchName: 'ADBE Layer Control', prop: 'Layer', defaultName: 'Layer Control' },
};

export const responses = {
  getExpressionErrors: (args) => {
    const scope = args.scope ?? 'comp';
    const errors = [
      { comp: comp(), layer: layerRef(2, 'Card'), path: 'Transform/Position', matchPath: 'ADBE Transform Group/ADBE Position', enabled: true, expression: 'thisComp.layer("Missing").transform.position', error: 'Layer named "Missing" does not exist' },
    ];
    return { scope, compositions: [comp()], layersScanned: scope === 'layer' ? 1 : 3, propertiesWithExpressions: 2, errorCount: errors.length, truncated: false, errors };
  },
  listExpressionPresets: () => ({ count: PRESETS.length, presets: PRESETS }),
  applyExpressionPreset: (args) => {
    const def = PRESETS.find((p) => p.name === args.preset);
    if (!def) throw Object.assign(new Error(`Unknown expression preset '${args.preset}'.`), { mcpCode: 'not-found' });
    if (args.preset === 'follow-layer-with-delay' && !args.params?.layerName) throw Object.assign(new Error('follow-layer-with-delay needs params.layerName (the layer to follow).'), { mcpCode: 'invalid-argument' });
    const params = {};
    for (const p of def.params) params[p.name] = args.params?.[p.name] ?? p.defaultValue;
    const code = `// MCP preset: ${args.preset}\nvalue;`;
    return {
      composition: comp(),
      layer: layerRef(),
      property: propertyState(args.property, 100),
      expressionState: { hasExpression: true, expression: code, enabled: args.enabled ?? true, error: '' },
      preset: args.preset,
      params,
      code,
    };
  },
  addExpressionControl: (args) => {
    const def = CONTROLS[args.type];
    const name = args.name || def.defaultName;
    const notes = [];
    if (args.type === 'dropdown' && args.items) notes.push('Dropdown items set.');
    return {
      composition: comp(),
      layer: layerRef(),
      effect: { index: 1, name, matchName: def.matchName, enabled: true, numProperties: 1, properties: [propertyState(`Effects/${name}/${def.prop}`, args.value ?? 0)] },
      control: { type: args.type, name, matchName: def.matchName },
      propertyPath: `Effects/${name}/${def.prop}`,
      matchPath: `ADBE Effect Parade/${def.matchName}/${def.matchName}-0001`,
      expression: `effect(${JSON.stringify(name)})(${JSON.stringify(def.prop)})`,
      value: args.value ?? 0,
      notes,
    };
  },
};
