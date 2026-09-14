/*
 * Registers every tool group. Add a new group here and nowhere else.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBatchTools } from './batch.js';
import { registerCompositionTools } from './composition.js';
import { registerEffectsTools } from './effects.js';
import { registerExpressionTools } from './expressions.js';
import { registerHelpTools } from './help.js';
import { registerKeyframeTools } from './keyframes.js';
import { registerLayerTools } from './layers.js';
import { registerMarkersAudioTools } from './markers-audio.js';
import { registerPresetTools } from './presets.js';
import { registerProjectTools } from './project.js';
import { registerShapeTools } from './shapes.js';
import { registerTextTools } from './text.js';

export function registerAllTools(server: McpServer): void {
  registerBatchTools(server);
  registerProjectTools(server);
  registerCompositionTools(server);
  registerLayerTools(server);
  registerKeyframeTools(server);
  registerExpressionTools(server);
  registerTextTools(server);
  registerShapeTools(server);
  registerEffectsTools(server);
  registerPresetTools(server);
  registerMarkersAudioTools(server);
  registerHelpTools(server);
}
