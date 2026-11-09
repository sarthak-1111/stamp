#!/usr/bin/env node
/**
 * Stamp: register (or find) the PayPal SANDBOX webhook for a deployed Stamp.
 *
 *   npm run webhook:register -- --base https://your-stamp.example
 *
 * PayPal only delivers webhooks to public https URLs, so this is for a deployed Stamp, not localhost.
 * Prints the webhook id; set it as PAYPAL_WEBHOOK_ID on the host so /api/paypal/webhook can verify
 * every event with POST /v1/notifications/verify-webhook-signature before treating it as a hint.
 * Event names: https://developer.paypal.com/api/rest/webhooks/event-names/ (see API_NOTES.md).
 */
import { arg } from './lib/stamp-client.mjs';

const PAYPAL = 'https://api-m.sandbox.paypal.com'; // hard-coded: never live
const EVENTS = [
  'CHECKOUT.ORDER.APPROVED',
  'PAYMENT.AUTHORIZATION.CREATED',
  'PAYMENT.AUTHORIZATION.VOIDED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.PENDING',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.PAYOUTSBATCH.DENIED',
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  'PAYMENT.PAYOUTS-ITEM.FAILED',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  'PAYMENT.PAYOUTS-ITEM.RETURNED',
];

const base = String(arg('base') || process.env.STAMP_URL || process.env.APP_URL || '').replace(/\/+$/, '');
if (!/^https:\/\//.test(base)) {
  console.error('Pass the deployed https URL: npm run webhook:register -- --base https://your-stamp.example');
  process.exit(2);
}
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error('Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env.local');
  process.exit(2);
}
const url = `${base}/api/paypal/webhook`;

const token = await fetch(`${PAYPAL}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
}).then((r) => r.json());
if (!token.access_token) {
  console.error('PayPal OAuth failed:', token.error ?? token);
  process.exit(1);
}
const auth = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };

const existing = await fetch(`${PAYPAL}/v1/notifications/webhooks`, { headers: auth }).then((r) => r.json());
const found = (existing.webhooks ?? []).find((w) => w.url === url);
if (found) {
  const have = new Set((found.event_types ?? []).map((e) => e.name));
  const missing = EVENTS.filter((e) => !have.has(e));
  if (missing.length) {
    const patch = await fetch(`${PAYPAL}/v1/notifications/webhooks/${found.id}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify([{ op: 'replace', path: '/event_types', value: EVENTS.map((name) => ({ name })) }]),
    });
    console.log(`Updated event types on the existing webhook (${patch.status}).`);
  }
  console.log(`Webhook already registered for ${url}\nPAYPAL_WEBHOOK_ID=${found.id}`);
  process.exit(0);
}

const res = await fetch(`${PAYPAL}/v1/notifications/webhooks`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ url, event_types: EVENTS.map((name) => ({ name })) }),
});
const body = await res.json();
if (!res.ok) {
  console.error(`PayPal refused the webhook (${res.status}):`, body.name, body.message, body.details ?? '');
  process.exit(1);
}
console.log(`Registered ${url} for ${EVENTS.length} event types.\nPAYPAL_WEBHOOK_ID=${body.id}`);
