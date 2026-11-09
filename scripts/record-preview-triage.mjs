#!/usr/bin/env node
/**
 * Stamp: record the real triage output for the landing page's example message.
 *
 *   node scripts/record-preview-triage.mjs --base http://localhost:3000
 *
 * Creates a throwaway local page whose free lane includes the example sender (so no PayPal is involved),
 * sends lib/preview.ts's legitimate example through the normal pipeline, waits for the model, and writes
 * docs/evidence/preview-triage.json. lib/preview.ts shows exactly that output. Needs AI_BASE_URL on the server.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseUrl, ROOT, saveKey, sleep, stampClient } from './lib/stamp-client.mjs';

const BASE = baseUrl();
const INPUT = {
  senderName: 'Leah Park',
  senderEmail: 'leah@parkandfield.example',
  subject: 'Pilot of our battery health sensor at one of your sites',
  body: "Hi Maya, I'm Leah, a hardware engineer who left a utility to build a low-cost sensor that predicts cell failures in stationary battery storage. We're looking for two sites for a free six-week pilot this spring. Would a 20-minute call next week make sense? I can send the test data from our first pilot beforehand.",
};
const TOPICS = ['battery storage', 'grid software', 'climate hiring'];

const api = stampClient(BASE);
const handle = `preview${Math.floor(Date.now() / 1000).toString(36)}`;
const page = await api.post('/api/recipients', { handle, displayName: 'Maya Chen', bio: '', holdDollars: 5, topics: TOPICS, freeLane: [INPUT.senderEmail], releaseMinutes: 2880, charityId: 'demo-charity' });
if (page.status !== 201) throw new Error(`page: ${page.status} ${JSON.stringify(page.json)}`);
saveKey(handle, { base: BASE, handle, ownerKey: page.json.ownerKey, purpose: 'preview-triage' });
await api.signIn(page.json.ownerKey);
const sent = await api.post('/api/messages', { handle, ...INPUT, website: '' });
if (sent.status !== 201) throw new Error(`send: ${sent.status} ${JSON.stringify(sent.json)}`);

for (let i = 0; i < 60; i++) {
  await sleep(3000);
  const t = (await api.get('/api/inbox')).json.cards?.[0]?.triage;
  if (t?.modelError) console.log('model error:', t.modelError);
  if (t?.source === 'model') {
    const { updatedAt: _u, modelError: _e, ...triage } = t;
    const out = {
      what: "Triage output for the landing page's example message, produced by Stamp's real pipeline (free-lane message to a local page with the topics below). Regenerate with scripts/record-preview-triage.mjs.",
      recordedAt: new Date().toISOString(),
      topics: TOPICS,
      input: INPUT,
      triage,
    };
    writeFileSync(join(ROOT, 'docs', 'evidence', 'preview-triage.json'), JSON.stringify(out, null, 2) + '\n');
    console.log(JSON.stringify(out.triage, null, 2));
    process.exit(0);
  }
}
console.error('Timed out waiting for the model.');
process.exit(1);
