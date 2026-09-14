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

export const responses = { ...core, ...project, ...composition, ...layers, ...transform, ...keyframes, ...expressions, ...text, ...shapes, ...masks, ...effects, ...camera3d, ...time, ...markersAudio, ...render, ...rigs, ...workflow };

export function respond(command, args, ctx) {
  const fn = responses[command];
  if (!fn) return { mock: true, command, args };
  return fn(args, ctx);
}
