/*
 * get-help reads docs/AGENT-GUIDE.md from disk at call time, so edits to the
 * guide reach the agent without a rebuild. Prompts and resources are
 * registered here as well.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
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
}
