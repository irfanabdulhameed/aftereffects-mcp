/*
 * get-help reads docs/AGENT-GUIDE.md from disk at call time, so edits to the
 * guide reach the agent without a rebuild. Prompts and resources are
 * registered here as well.
 */

import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getBridge } from '../bridge/client.js';
import { BridgeError } from '../bridge/types.js';
import { loadStyle, summarizeStyle } from '../schemas/style.js';
import { REPO_ROOT } from '../version.js';
import { defineTool } from './registry.js';

export const AGENT_GUIDE_PATH = path.join(REPO_ROOT, 'docs', 'AGENT-GUIDE.md');

export interface GuideSection {
  title: string;
  slug: string;
  body: string;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\d+\.\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Splits the guide into level-2 sections. */
export function parseGuide(markdown: string): { intro: string; sections: GuideSection[] } {
  const lines = markdown.split('\n');
  const sections: GuideSection[] = [];
  let intro: string[] = [];
  let current: GuideSection | undefined;
  for (const line of lines) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      current = { title: m[1].trim(), slug: slugify(m[1].trim()), body: '' };
      sections.push(current);
      continue;
    }
    if (current) current.body += line + '\n';
    else intro.push(line);
  }
  return { intro: intro.join('\n').trim(), sections: sections.map((s) => ({ ...s, body: s.body.trim() })) };
}

export function readGuide(): string | undefined {
  try {
    return fs.readFileSync(AGENT_GUIDE_PATH, 'utf8');
  } catch {
    return undefined;
  }
}

export function registerHelpTools(server: McpServer): void {
  defineTool(server, {
    name: 'get-help',
    group: 'help',
    mutating: false,
    bridge: null,
    description:
      'Returns the agent guide for this server: how the bridge works, how addressing works, the standard workflow, units, animation craft rules, text and effect advice, recovery steps and what not to do. The text is read from docs/AGENT-GUIDE.md on disk each time, so it is always current. ' +
      'Use when: starting a session, before your first build, or when something behaves unexpectedly. ' +
      'Do not use for: listing tools (use list-tools) or looking up one tool\'s arguments (the schema has them). ' +
      'Inputs: topic (optional), a section name or slug such as "addressing", "workflow", "animation-craft", "recovery"; omit for the whole guide; "toc" for the list of sections. ' +
      'Returns: markdown text. With an unknown topic, the list of available topics. ' +
      'Notes: if a style file is configured (AE_MCP_STYLE_FILE), its summary is appended to the "reference-and-style" section. ' +
      'Example: get-help with topic "animation-craft" before animating a lower third.',
    input: { topic: z.string().optional().describe('Section name or slug. Omit for everything, or "toc" for the table of contents.') },
    handler: async (args, ctx) => {
      const md = readGuide();
      if (!md) {
        return { content: [{ type: 'text', text: `The agent guide was not found at ${AGENT_GUIDE_PATH}. Reinstall the repository or restore docs/AGENT-GUIDE.md.` }], isError: true };
      }
      const { intro, sections } = parseGuide(md);
      let styleSummary = '';
      try {
        const { loadStyle, summarizeStyle } = await import('../schemas/style.js');
        const style = loadStyle(ctx.bridge.config.styleFile);
        if (style) styleSummary = '\n\n### Active style file\n\n' + summarizeStyle(style);
      } catch {
        styleSummary = '';
      }
      const topic = args.topic ? args.topic.trim().toLowerCase() : '';
      if (topic === 'toc') {
        return { content: [{ type: 'text', text: sections.map((s, i) => `${i + 1}. ${s.title} (topic: ${s.slug})`).join('\n') }] };
      }
      if (!topic) {
        return { content: [{ type: 'text', text: md + styleSummary }] };
      }
      const match = sections.find((s) => s.slug === topic || s.slug.includes(topic) || s.title.toLowerCase().includes(topic));
      if (!match) {
        return { content: [{ type: 'text', text: `No section matches "${args.topic}". Available topics:\n` + sections.map((s) => `- ${s.slug}: ${s.title}`).join('\n') }] };
      }
      const extra = match.slug.includes('style') ? styleSummary : '';
      return { content: [{ type: 'text', text: `## ${match.title}\n\n${match.body}${extra}` + (intro && topic === 'intro' ? intro : '') }] };
    },
  });

  registerHelpResources(server);
  registerHelpPrompts(server);
}

/* ------------------------------------------------------------ resources */

async function bridgeJson(command: string, args: Record<string, unknown> = {}): Promise<string> {
  try {
    const result = await getBridge().run(command, args);
    return JSON.stringify(result, null, 2);
  } catch (err) {
    if (err instanceof BridgeError) return JSON.stringify(err.toJSON(), null, 2);
    return JSON.stringify({ error: 'failed', message: (err as Error).message });
  }
}

export function registerHelpResources(server: McpServer): void {
  const json = (uri: URL, text: string) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text }] });
  const markdown = (uri: URL, text: string) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] });

  server.registerResource('project', 'aftereffects://project', { description: 'The open After Effects project: file, items, active composition.', mimeType: 'application/json' }, async (uri) =>
    json(uri, await bridgeJson('getProjectInfo', {}))
  );
  server.registerResource('compositions', 'aftereffects://compositions', { description: 'Every composition in the project with ids, sizes and frame rates.', mimeType: 'application/json' }, async (uri) =>
    json(uri, await bridgeJson('listCompositions', {}))
  );
  server.registerResource(
    'comp-layers',
    new ResourceTemplate('aftereffects://comp/{name}/layers', { list: undefined }),
    { description: 'Layers of the named composition.', mimeType: 'application/json' },
    async (uri, variables) => json(uri, await bridgeJson('listLayers', { comp: { name: decodeURIComponent(String(variables.name)) } }))
  );
  server.registerResource('fonts', 'aftereffects://fonts', { description: 'Installed fonts (After Effects 24 or later).', mimeType: 'application/json' }, async (uri) =>
    json(uri, await bridgeJson('listFonts', {}))
  );
  server.registerResource('effects', 'aftereffects://effects', { description: 'Effects installed in this After Effects with matchNames.', mimeType: 'application/json' }, async (uri) =>
    json(uri, await bridgeJson('listAvailableEffects', { maxResults: 5000 }))
  );
  server.registerResource('rigs', 'aftereffects://rigs', { description: 'The four builder rigs and their parameters.', mimeType: 'application/json' }, async (uri) =>
    json(uri, await bridgeJson('listRigs', {}))
  );
  server.registerResource('help', 'aftereffects://help', { description: 'The agent guide (docs/AGENT-GUIDE.md).', mimeType: 'text/markdown' }, async (uri) =>
    markdown(uri, readGuide() ?? `Guide not found at ${AGENT_GUIDE_PATH}`)
  );
  server.registerResource('style', 'aftereffects://style', { description: 'The active style file, if AE_MCP_STYLE_FILE is set.', mimeType: 'application/json' }, async (uri) => {
    const style = loadStyle(getBridge().config.styleFile);
    return json(uri, style ? JSON.stringify({ summary: summarizeStyle(style), style }, null, 2) : JSON.stringify({ active: false, message: 'No style file. Set AE_MCP_STYLE_FILE to a JSON or YAML file; see docs/style-file.example.json.' }));
  });
}

/* -------------------------------------------------------------- prompts */

const WORKFLOW_PREAMBLE =
  'Work through the AfterEffectsMCP tools. First call ping; if it fails ask the human to open Window > mcp-bridge-auto.jsx. ' +
  'Then get-project-info and list-layers so you know what exists. Name every layer you create. Build with one batch where possible. ' +
  'Finish by calling see-frame at two or three times and looking at the frames before you report. Follow get-help topic animation-craft for timing and easing.';

export function registerHelpPrompts(server: McpServer): void {
  const text = (t: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: t } }] });

  server.registerPrompt(
    'build-title-card',
    {
      description: 'Build a title card: background, headline, optional subtitle, animated entrance and hold.',
      argsSchema: {
        title: z.string().describe('Headline text.'),
        subtitle: z.string().optional().describe('Second line, optional.'),
        style: z.string().optional().describe('Mood or style notes, for example "minimal, dark, corporate".'),
        durationSeconds: z.string().optional().describe('Total length in seconds. Default 5.'),
      },
    },
    ({ title, subtitle, style, durationSeconds }) =>
      text(
        `${WORKFLOW_PREAMBLE}\n\nBuild a title card reading "${title}"${subtitle ? ` with the subtitle "${subtitle}"` : ''}${style ? ` in this style: ${style}` : ''}. Duration ${durationSeconds ?? '5'} seconds.\n\n` +
          'Recommended sequence: get-composition-info or create-composition (preset 1080p30); create-solid-layer for the background (toBottom true); create-text-layer for the headline (font, size, colour, centred); ' +
          'create-text-layer for the subtitle below it; set-keyframes-bulk on Transform/Opacity and Transform/Position for each text layer with ease-out entrances staggered by 3 to 4 frames; ' +
          'apply-effect-template soft-shadow on the text if the background is busy; see-frame at the first frame, mid-entrance and the resting pose; adjust; report what you built and what the frames show.'
      )
  );

  server.registerPrompt(
    'build-lower-third',
    {
      description: 'Build a lower third: name, role, a bar or card shape, slide-in entrance and exit.',
      argsSchema: {
        name: z.string().describe('Name line.'),
        role: z.string().optional().describe('Role or subtitle line.'),
        accentColor: z.string().optional().describe('Accent colour, hex.'),
        inTime: z.string().optional().describe('When it enters, seconds. Default 1.'),
        holdSeconds: z.string().optional().describe('How long it stays. Default 4.'),
      },
    },
    ({ name, role, accentColor, inTime, holdSeconds }) =>
      text(
        `${WORKFLOW_PREAMBLE}\n\nBuild a lower third for "${name}"${role ? ` (${role})` : ''}${accentColor ? ` using accent colour ${accentColor}` : ''}, entering at ${inTime ?? '1'} s and holding ${holdSeconds ?? '4'} s.\n\n` +
          'Recommended sequence: create-null-layer "LT Control" at the lower-left safe area; create-shape-layer rounded-rectangle card or a thin accent bar parented to the null; create-text-layer for the name and the role parented to the null, left-justified; ' +
          'create-mask on the text (or a track matte) so the text can wipe in from behind the bar; set-keyframes-multi for the bar Scale (x from 0 to 100, ease-out, 14 frames) and the text Position (slide 40 px, ease-out, staggered 3 frames); ' +
          'mirror the entrance as an exit with ease-in at inTime + hold; see-frame at entrance middle, hold and exit; adjust.'
      )
  );

  server.registerPrompt(
    'animate-in-selected-layers',
    {
      description: 'Give the selected layers an entrance animation with staggered timing.',
      argsSchema: {
        style: z.string().optional().describe('fade, slide-up, scale-in, blur-in, or a description. Default fade plus slide-up.'),
        staggerFrames: z.string().optional().describe('Frames between layers. Default 3.'),
        durationFrames: z.string().optional().describe('Entrance length per layer in frames. Default 12.'),
      },
    },
    ({ style, staggerFrames, durationFrames }) =>
      text(
        `${WORKFLOW_PREAMBLE}\n\nAnimate the currently selected layers in with style "${style ?? 'fade plus slide-up'}", ${durationFrames ?? '12'} frames each, staggered by ${staggerFrames ?? '3'} frames in stack order.\n\n` +
          'Recommended sequence: get-selected-layers; get-composition-info for the frame rate; stagger-keyframes-across-layers on Transform/Opacity (0 to 100, ease-out) and again on Transform/Position with a 40 px offset (or Transform/Scale 90 to 100 for scale-in, or an Effects Gaussian Blur ramp for blur-in via apply-effects-bulk then stagger on Effects/Gaussian Blur/Blurriness); ' +
          'see-frame at the first entrance and the last; adjust.'
      )
  );

  server.registerPrompt(
    'logo-reveal',
    {
      description: 'Reveal a logo layer with scale, glow or the edge-glow rig.',
      argsSchema: {
        logoLayer: z.string().describe('Name of the logo layer already in the composition.'),
        technique: z.string().optional().describe('scale-settle, mask-wipe, blur-color-reveal, edge-glow. Default scale-settle with glow.'),
      },
    },
    ({ logoLayer, technique }) =>
      text(
        `${WORKFLOW_PREAMBLE}\n\nReveal the layer "${logoLayer}" using the technique "${technique ?? 'scale-settle with glow'}".\n\n` +
          'Options: scale-settle = set-keyframes-bulk on Transform/Scale from 80 to 100 with overshoot and Opacity 0 to 100 (ease-out), plus apply-effect-template glow with intensity keyed down over the settle; ' +
          'mask-wipe = mask-reveal-animation with direction left; blur-color-reveal = rig-blur-color-reveal with the logo as content; edge-glow = rig-edge-glow then move the logo above EG Stroke. ' +
          'Use list-rigs to read the rig parameters. see-frame at the start, mid and end of the reveal.'
      )
  );

  server.registerPrompt(
    'explainer-diagram-build',
    {
      description: 'Build a diagram of N shapes with labels and connectors that reveal in sequence.',
      argsSchema: {
        nodes: z.string().describe('Comma-separated node labels, in reveal order.'),
        layout: z.string().optional().describe('row, column, grid or circle. Default row.'),
        connectors: z.string().optional().describe('yes or no. Default yes.'),
      },
    },
    ({ nodes, layout, connectors }) =>
      text(
        `${WORKFLOW_PREAMBLE}\n\nBuild an explainer diagram with these nodes in order: ${nodes}. Layout: ${layout ?? 'row'}. Connectors: ${connectors ?? 'yes'}.\n\n` +
          'Recommended sequence: compute positions from get-composition-info; one batch with create-shape-layer (rounded-rectangle or circle) and create-text-layer per node, named "Node N" and "Label N"; ' +
          'create-shape-layer line or arrow between consecutive nodes named "Link N"; animate-trim-paths on each link (end 0 to 100, ease-out) timed after its source node; ' +
          'stagger-keyframes-across-layers for the node Scale (90 to 100) and Opacity with 8 to 12 frames per node; see-frames with count 4; adjust spacing so nothing overlaps.'
      )
  );

  server.registerPrompt(
    'sync-to-audio',
    {
      description: 'Place markers on the beats of an audio layer and drive animation from them.',
      argsSchema: {
        audioLayer: z.string().describe('Name of the audio layer.'),
        bpm: z.string().optional().describe('Beats per minute if known; otherwise peaks are detected.'),
        target: z.string().optional().describe('What to animate on the beats, for example "scale pulse on Logo".'),
      },
    },
    ({ audioLayer, bpm, target }) =>
      text(
        `${WORKFLOW_PREAMBLE}\n\nSync to the audio layer "${audioLayer}"${bpm ? ` at ${bpm} BPM` : ''}${target ? ` and ${target}` : ''}.\n\n` +
          'Recommended sequence: get-audio-info on the layer for sourceFilePath and start time; either markers-from-beats with bpm and offset, or analyze-audio-waveform on the file then markers-from-beats with peakTimes (add the layer start time); ' +
          'list-markers to read the times; set-keyframes-bulk on the target property with a key pair per beat (for example Scale 100 to 108 to 100 over 6 frames, snappy); or audio-to-keyframes and apply-expression-preset link-to-slider for continuous reaction; see-frame on two beats.'
      )
  );

  server.registerPrompt(
    'match-reference-comp',
    {
      description: 'Read timing, easing and styling from a reference composition and rebuild a target in the same style.',
      argsSchema: {
        referenceComp: z.string().describe('Name of the reference composition.'),
        targetComp: z.string().describe('Name of the composition to build or adjust.'),
        notes: z.string().optional().describe('What to match: timing, easing, colours, fonts, effects.'),
      },
    },
    ({ referenceComp, targetComp, notes }) =>
      text(
        `${WORKFLOW_PREAMBLE}\n\nMatch "${targetComp}" to the reference "${referenceComp}"${notes ? `, focusing on ${notes}` : ''}.\n\n` +
          'Recommended sequence: snapshot-composition on the reference (depth 3, keyframes on); read the durations between keys, the easing influence values, the fonts and colours; list-layers on the target; ' +
          'for layers with matching names apply-snapshot with what {transform, keyframes, effects, expressions}; for others reproduce with set-keyframes-bulk using the same frame counts and easing, set-text-style with the reference fonts, apply-effect with the reference settings; ' +
          'see-frame both compositions at the same times and compare; adjust until they match.'
      )
  );
}
