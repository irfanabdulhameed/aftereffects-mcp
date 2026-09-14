/*
 * Registers every tool group. Add a new group here and nowhere else.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBatchTools } from './batch.js';
import { registerCamera3dTools } from './camera-3d.js';
import { registerCompositionTools } from './composition.js';
import { registerEffectsTools } from './effects.js';
import { registerExpressionTools } from './expressions.js';
import { registerHelpTools } from './help.js';
import { registerKeyframeTools } from './keyframes.js';
import { registerLayerTools } from './layers.js';
import { registerMarkersAudioTools } from './markers-audio.js';
import { registerMasksTools } from './masks.js';
import { registerPresetTools } from './presets.js';
import { registerProjectTools } from './project.js';
import { registerRenderTools } from './render.js';
import { registerRigsTools } from './rigs.js';
import { registerShapeTools } from './shapes.js';
import { registerTextTools } from './text.js';
import { registerTimeTools } from './time.js';
import { registerTransformTools } from './transform.js';
import { registerWorkflowTools } from './workflow.js';

export function registerAllTools(server: McpServer): void {
  registerBatchTools(server);
  registerProjectTools(server);
  registerCompositionTools(server);
  registerLayerTools(server);
  registerTransformTools(server);
  registerKeyframeTools(server);
  registerExpressionTools(server);
  registerTextTools(server);
  registerShapeTools(server);
  registerMasksTools(server);
  registerEffectsTools(server);
  registerPresetTools(server);
  registerCamera3dTools(server);
  registerTimeTools(server);
  registerMarkersAudioTools(server);
  registerRenderTools(server);
  registerRigsTools(server);
  registerWorkflowTools(server);
  registerHelpTools(server);
}
