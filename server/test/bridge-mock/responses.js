/*
 * Merges every response module. Each group owns one file under responses/.
 * Unknown commands get a generic echo so new commands round-trip before
 * their mock is written; tests for a tool should assert the real shape.
 */

import { responses as core } from './responses/core.js';
import { responses as project } from './responses/project.js';
import { responses as composition } from './responses/composition.js';
import { responses as layers } from './responses/layers.js';
import { responses as transform } from './responses/transform.js';
import { responses as keyframes } from './responses/keyframes.js';
import { responses as expressions } from './responses/expressions.js';
import { responses as text } from './responses/text.js';
import { responses as shapes } from './responses/shapes.js';
import { responses as masks } from './responses/masks.js';
import { responses as effects } from './responses/effects.js';
import { responses as camera3d } from './responses/camera-3d.js';
import { responses as time } from './responses/time.js';
import { responses as markersAudio } from './responses/markers-audio.js';
import { responses as render } from './responses/render.js';
import { responses as rigs } from './responses/rigs.js';
import { responses as workflow } from './responses/workflow.js';
import { responses as components } from './responses/components.js';
import { responses as animate } from './responses/animate.js';
import { responses as styles } from './responses/styles.js';
import { responses as check } from './responses/check.js';
import { responses as vectors } from './responses/vectors.js';
import { responses as textExtras } from './responses/text-extras.js';
import { responses as advanced3d } from './responses/advanced-3d.js';
import { responses as scenes } from './responses/scenes.js';
import { responses as transitions } from './responses/transitions.js';
import { responses as uiDemo } from './responses/ui-demo.js';
import { responses as motionRigs } from './responses/motion-rigs.js';
import { responses as charts } from './responses/charts.js';
import { responses as looks } from './responses/looks.js';
import { responses as figma } from './responses/figma.js';

export const responses = { ...core, ...project, ...composition, ...layers, ...transform, ...keyframes, ...expressions, ...text, ...shapes, ...masks, ...effects, ...camera3d, ...time, ...markersAudio, ...render, ...rigs, ...workflow, ...components, ...animate, ...styles, ...check, ...vectors, ...textExtras, ...advanced3d, ...scenes, ...transitions, ...uiDemo, ...motionRigs, ...charts, ...looks, ...figma };

export function respond(command, args, ctx) {
  const fn = responses[command];
  if (!fn) return { mock: true, command, args };
  return fn(args, ctx);
}
