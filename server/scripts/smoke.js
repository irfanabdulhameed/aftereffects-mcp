#!/usr/bin/env node
/*
 * Smoke test against a real After Effects with the MCP Bridge Auto panel open.
 * Prints a checklist, then runs a short sequence of tools through the server
 * (in-process) and reports pass or fail per step. It creates one temporary
 * composition named "MCP Smoke <time>" and undoes its own changes at the end.
 *
 * Usage: npm run smoke        (from the repository root or server/)
 *        node scripts/smoke.js --keep   (leave the composition in place)
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes('--keep');

function line(s = '') {
  process.stdout.write(s + '\n');
}

async function main() {
  line('After Effects MCP smoke test');
  line('');
  line('Checklist before running:');
  line('  [ ] After Effects is open');
  line('  [ ] Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" is on');
  line('  [ ] Window > mcp-bridge-auto.jsx is open and Auto-run is ticked');
  line('  [ ] npm run build && npm run install-bridge were run after the last code change');
  line('');

  const buildIndex = path.resolve(__dirname, '..', 'build', 'index.js');
  const { createServer } = await import(buildIndex);
  const { getBridge } = await import(path.resolve(__dirname, '..', 'build', 'bridge', 'client.js'));
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

  const bridge = getBridge();
  line(`Bridge folder: ${bridge.paths.root}`);
  const hb = bridge.readHeartbeat();
  if (!hb) line('No heartbeat.json yet. The panel may not be open.');
  else line(`Heartbeat ${Math.round((Date.now() - Date.parse(hb.at)) / 1000)} s ago, panel ${hb.bridgeVersion}, After Effects ${hb.aeVersion}`);
  line('');

  const server = createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'smoke', version: '0' });
  await client.connect(ct);

  const results = [];
  let compName = `MCP Smoke ${new Date().toISOString().slice(11, 19)}`;
  let mutations = 0;

  async function step(name, tool, args, check) {
    const started = Date.now();
    try {
      const res = await client.callTool({ name: tool, arguments: args });
      const text = res.content.find((c) => c.type === 'text')?.text ?? '';
      const image = res.content.find((c) => c.type === 'image');
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      if (res.isError) throw new Error(text.slice(0, 300));
      if (check) check(json, image);
      results.push({ name, ok: true, ms: Date.now() - started });
      line(`PASS  ${name} (${Date.now() - started} ms)`);
      return json;
    } catch (err) {
      results.push({ name, ok: false, ms: Date.now() - started, error: err.message });
      line(`FAIL  ${name}: ${err.message}`);
      return undefined;
    }
  }

  await step('ping', 'ping', { message: 'smoke' }, (j) => {
    if (!j?.pong) throw new Error('no pong');
  });
  await step('get-ae-version', 'get-ae-version', {}, (j) => {
    if (!j?.version) throw new Error('no version');
  });
  await step('get-bridge-status', 'get-bridge-status', {}, (j) => {
    if (!j?.panelAlive) throw new Error('panel not alive');
    if (j.versionsMatch === false) line(`      note: server ${j.serverVersion} and panel ${j.bridgeVersion} differ; run npm run install-bridge`);
  });
  const comp = await step('create-composition', 'create-composition', { name: compName, preset: '1080p30', duration: 5, backgroundColor: '#101014' }, (j) => {
    if (!j?.composition?.id) throw new Error('no composition id');
  });
  if (comp) mutations++;
  const compRef = comp ? { id: comp.composition.id } : undefined;
  const text = await step('create-text-layer', 'create-text-layer', { comp: compRef, text: 'Smoke', fontSize: 140, fillColor: 'white', name: 'Smoke Title' }, (j) => {
    if (!j?.layer?.index) throw new Error('no layer');
  });
  if (text) mutations++;
  const keys = await step('set-keyframes-bulk', 'set-keyframes-bulk', {
    comp: compRef,
    layer: { name: 'Smoke Title' },
    property: 'Transform/Opacity',
    keys: [{ frame: 0, value: 0 }, { frame: 12, value: 100, easing: 'ease-out' }],
  }, (j) => {
    if (j?.keyframesWritten !== 2) throw new Error('expected 2 keyframes');
  });
  if (keys) mutations++;
  await step('apply-effect (idempotent)', 'apply-effect', { comp: compRef, layer: { name: 'Smoke Title' }, effect: 'ADBE Drop Shadow', settings: { Distance: 8 } }, (j) => {
    if (!j?.effect?.matchName) throw new Error('no effect');
  });
  mutations++;
  await step('see-frame', 'see-frame', { comp: compRef, frame: 12, scale: 0.25 }, (j, image) => {
    if (!image || image.mimeType !== 'image/png') throw new Error('no PNG image returned');
  });
  if (!keep) {
    await step('undo x' + (mutations + 0), 'undo', { count: mutations + 1 });
  } else {
    line(`Kept composition "${compName}".`);
  }

  const failed = results.filter((r) => !r.ok);
  line('');
  line(`${results.length - failed.length} passed, ${failed.length} failed`);
  await client.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
