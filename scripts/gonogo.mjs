#!/usr/bin/env node
/**
 * Stamp: Step 0 go/no-go against the PayPal SANDBOX (never live).
 *
 *   npm run gonogo -- create     OAuth + create two AUTHORIZE orders, print the approval links
 *   npm run gonogo -- status     read both orders through the PayPal Agent Toolkit MCP server (get_order)
 *   npm run gonogo -- finish     authorize both; VOID #1; CAPTURE #2; payout to the charity; idempotency replays
 *   npm run gonogo -- coverage   list Agent Toolkit / MCP tools (local in-process server + remote sandbox server)
 *   npm run gonogo -- report     write sanitized evidence to docs/evidence/gonogo-run.json
 *
 * Reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and CHARITY_PAYPAL_EMAIL from .env.local (gitignored).
 * Access tokens are kept in memory only; nothing secret is written to disk.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(ROOT, '.gonogo');
const STATE_FILE = join(STATE_DIR, 'state.json');
const EVIDENCE_FILE = join(ROOT, 'docs', 'evidence', 'gonogo-run.json');
const BASE = 'https://api-m.sandbox.paypal.com'; // hard-coded: this script must never touch live
const REMOTE_MCP_URL = 'https://mcp.sandbox.paypal.com/http';
const HOLD_VALUE = '5.00';
const CURRENCY = 'USD';

// ---------------------------------------------------------------- state + logging

function loadState() {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}
function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(2);
  }
  return v;
}
function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 4)}***@${domain}`;
}
function log(state, entry) {
  const e = { at: new Date().toISOString(), ...entry };
  state.events.push(e);
  saveState(state);
  const rid = e.requestId ? ` [PayPal-Request-Id ${e.requestId}]` : '';
  console.log(`${e.at}  ${e.step}: ${e.method ?? ''} ${e.path ?? ''} -> ${e.status ?? ''} ${e.note ?? ''}${rid}`);
  return e;
}

// ---------------------------------------------------------------- PayPal REST

async function getToken(state) {
  const id = requireEnv('PAYPAL_CLIENT_ID');
  const secret = requireEnv('PAYPAL_CLIENT_SECRET');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  const scopes = typeof json.scope === 'string' ? json.scope.split(' ') : [];
  log(state, {
    step: 'oauth.token',
    method: 'POST',
    path: '/v1/oauth2/token',
    status: res.status,
    debugId: res.headers.get('paypal-debug-id'),
    note: res.ok ? `token_type=${json.token_type} expires_in=${json.expires_in}s` : `error=${json.error} ${json.error_description ?? ''}`,
    extract: res.ok
      ? {
          token_type: json.token_type,
          expires_in: json.expires_in,
          app_id: json.app_id,
          scope_count: scopes.length,
          payout_scopes: scopes.filter((s) => /payout/i.test(s)),
        }
      : { error: json.error, error_description: json.error_description },
  });
  if (!res.ok) throw new Error('OAuth failed; check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox app)');
  return json.access_token;
}

/** One REST call; every write carries a PayPal-Request-Id (idempotency key). */
async function pp(token, method, path, { body, requestId, prefer = 'return=representation' } = {}) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: prefer };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, debugId: res.headers.get('paypal-debug-id'), json };
}

function errSummary(r) {
  const j = r.json || {};
  const issue = j.details?.[0]?.issue;
  return [j.name, issue, j.message].filter(Boolean).join(' | ').slice(0, 300);
}

// ---------------------------------------------------------------- Agent Toolkit (MCP) read path

/**
 * get_order through the official PayPal Agent Toolkit MCP server, run in-process and
 * connected to an MCP client over an in-memory transport. The server is configured with a
 * single read-only tool (orders.get) and no model is involved.
 */
async function mcpGetOrder(accessToken, orderId) {
  const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/mcp');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = new PayPalAgentToolkit({
    accessToken,
    configuration: { actions: { orders: { get: true } }, context: { sandbox: true } },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'stamp-gonogo', version: '0.1.0' });
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const res = await client.callTool({ name: 'get_order', arguments: { id: orderId } });
    const text = res.content?.[0]?.text ?? '';
    let order = null;
    try {
      order = JSON.parse(text);
    } catch {
      order = { raw: text.slice(0, 300) };
    }
    return { exposedTools: tools.map((t) => t.name), isError: Boolean(res.isError), order };
  } finally {
    await client.close();
    await server.close();
  }
}

function orderSnapshot(order) {
  const pu = order?.purchase_units?.[0] ?? {};
  const auths = pu.payments?.authorizations ?? [];
  const caps = pu.payments?.captures ?? [];
  return {
    id: order?.id,
    status: order?.status,
    intent: order?.intent,
    amount: pu.amount ? `${pu.amount.value} ${pu.amount.currency_code}` : undefined,
    payer: order?.payer?.email_address ? maskEmail(order.payer.email_address) : undefined,
    authorizations: auths.map((a) => ({ id: a.id, status: a.status, expiration_time: a.expiration_time })),
    captures: caps.map((c) => ({ id: c.id, status: c.status, final_capture: c.final_capture })),
  };
}

async function readOrderViaToolkit(state, token, label, orderId) {
  const r = await mcpGetOrder(token, orderId);
  const snap = orderSnapshot(r.order);
  log(state, {
    step: `toolkit.get_order(${label})`,
    method: 'MCP tools/call get_order',
    path: `GET /v2/checkout/orders/${orderId}`,
    status: r.isError ? 'tool-error' : snap.status,
    note: `exposed tools=[${r.exposedTools.join(',')}] auths=${JSON.stringify(snap.authorizations.map((a) => a.status))} captures=${JSON.stringify(snap.captures.map((c) => c.status))}`,
    extract: snap,
  });
  return snap;
}

// ---------------------------------------------------------------- commands

function orderBody(label) {
  return {
    intent: 'AUTHORIZE',
    purchase_units: [
      {
        reference_id: `gonogo-${label}`,
        custom_id: `gonogo-${label}`,
        description: `Stamp go/no-go refundable hold ${label} (sandbox test)`,
        soft_descriptor: 'STAMP HOLD',
        amount: { currency_code: CURRENCY, value: HOLD_VALUE },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Stamp (sandbox test)',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'CONTINUE',
          return_url: 'https://example.com/stamp-gonogo/approved',
          cancel_url: 'https://example.com/stamp-gonogo/cancelled',
        },
      },
    },
  };
}

async function cmdCreate() {
  const state = { runId: `gn-${Date.now()}`, startedAt: new Date().toISOString(), events: [], orders: {} };
  saveState(state);
  const token = await getToken(state);
  for (const label of ['A-void', 'B-capture']) {
    const requestId = randomUUID();
    const r = await pp(token, 'POST', '/v2/checkout/orders', { body: orderBody(label), requestId });
    const approve = r.json?.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
    log(state, {
      step: `orders.create(${label})`,
      method: 'POST',
      path: '/v2/checkout/orders',
      requestId,
      status: r.status,
      debugId: r.debugId,
      note: r.ok ? `id=${r.json.id} status=${r.json.status}` : errSummary(r),
      extract: r.ok ? { id: r.json.id, status: r.json.status, intent: 'AUTHORIZE', amount: `${HOLD_VALUE} ${CURRENCY}` } : r.json,
    });
    if (!r.ok) throw new Error(`create order ${label} failed`);
    state.orders[label] = { id: r.json.id, createRequestId: requestId, approveUrl: approve };
    saveState(state);
  }
  // Idempotency: replaying the same create with the same PayPal-Request-Id must return the SAME order.
  const a = state.orders['A-void'];
  const replay = await pp(token, 'POST', '/v2/checkout/orders', { body: orderBody('A-void'), requestId: a.createRequestId });
  log(state, {
    step: 'idempotency.replay(orders.create A-void)',
    method: 'POST',
    path: '/v2/checkout/orders',
    requestId: a.createRequestId,
    status: replay.status,
    debugId: replay.debugId,
    note: replay.ok ? `returned id=${replay.json.id} (same as original: ${replay.json.id === a.id})` : errSummary(replay),
    extract: { originalId: a.id, replayId: replay.json?.id, sameOrder: replay.json?.id === a.id },
  });
  console.log('\nApprove BOTH orders in a browser while signed in as the sandbox PERSONAL (buyer) account:\n');
  for (const [label, o] of Object.entries(state.orders)) console.log(`  ${label}: ${o.approveUrl}`);
  console.log('\nAfter approving you will land on example.com; that is expected. Then run: npm run gonogo -- status');
}

async function cmdStatus() {
  const state = loadState();
  if (!state) throw new Error('no state; run create first');
  const token = await getToken(state);
  let approved = 0;
  for (const [label, o] of Object.entries(state.orders)) {
    const snap = await readOrderViaToolkit(state, token, label, o.id);
    if (snap.status === 'APPROVED' || snap.status === 'COMPLETED') approved += 1;
  }
  console.log(`approved ${approved}/${Object.keys(state.orders).length}`);
  process.exitCode = approved === Object.keys(state.orders).length ? 0 : 3;
}

async function authorizeOrder(state, token, label) {
  const o = state.orders[label];
  const requestId = randomUUID();
  const r = await pp(token, 'POST', `/v2/checkout/orders/${o.id}/authorize`, { body: {}, requestId });
  const auth = r.json?.purchase_units?.[0]?.payments?.authorizations?.[0];
  log(state, {
    step: `orders.authorize(${label})`,
    method: 'POST',
    path: `/v2/checkout/orders/${o.id}/authorize`,
    requestId,
    status: r.status,
    debugId: r.debugId,
    note: r.ok ? `order=${r.json.status} authorization=${auth?.id} ${auth?.status} expires=${auth?.expiration_time}` : errSummary(r),
    extract: r.ok
      ? {
          orderStatus: r.json.status,
          authorization: {
            id: auth?.id,
            status: auth?.status,
            amount: auth?.amount,
            create_time: auth?.create_time,
            expiration_time: auth?.expiration_time,
          },
        }
      : r.json,
  });
  if (!r.ok || !auth?.id) throw new Error(`authorize ${label} failed`);
  o.authorizationId = auth.id;
  o.authorizeRequestId = requestId;
  saveState(state);

  // Idempotency: replay authorize with the same key; PayPal must not create a second authorization.
  const replay = await pp(token, 'POST', `/v2/checkout/orders/${o.id}/authorize`, { body: {}, requestId });
  const rAuth = replay.json?.purchase_units?.[0]?.payments?.authorizations?.[0];
  log(state, {
    step: `idempotency.replay(orders.authorize ${label})`,
    method: 'POST',
    path: `/v2/checkout/orders/${o.id}/authorize`,
    requestId,
    status: replay.status,
    debugId: replay.debugId,
    note: replay.ok ? `authorization=${rAuth?.id} (same: ${rAuth?.id === auth.id})` : errSummary(replay),
    extract: { originalAuthorizationId: auth.id, replayAuthorizationId: rAuth?.id, same: rAuth?.id === auth.id },
  });

  const g = await pp(token, 'GET', `/v2/payments/authorizations/${auth.id}`);
  const validityDays =
    g.json?.create_time && g.json?.expiration_time
      ? (Date.parse(g.json.expiration_time) - Date.parse(g.json.create_time)) / 86_400_000
      : null;
  log(state, {
    step: `authorizations.get(${label})`,
    method: 'GET',
    path: `/v2/payments/authorizations/${auth.id}`,
    status: g.status,
    debugId: g.debugId,
    note: g.ok ? `status=${g.json.status} create=${g.json.create_time} expires=${g.json.expiration_time} (validity ${validityDays?.toFixed(2)} days)` : errSummary(g),
    extract: g.ok
      ? { id: g.json.id, status: g.json.status, create_time: g.json.create_time, expiration_time: g.json.expiration_time, validityDays, links: (g.json.links ?? []).map((l) => l.rel) }
      : g.json,
  });
  return auth.id;
}

async function cmdFinish() {
  const state = loadState();
  if (!state) throw new Error('no state; run create first');
  const token = await getToken(state);
  const charity = requireEnv('CHARITY_PAYPAL_EMAIL');

  // ---- Order A: authorize, then VOID (the "Reply / Worth it" path).
  const authA = await authorizeOrder(state, token, 'A-void');
  const voidKey = randomUUID();
  const v = await pp(token, 'POST', `/v2/payments/authorizations/${authA}/void`, { requestId: voidKey });
  log(state, {
    step: 'authorizations.void(A-void)',
    method: 'POST',
    path: `/v2/payments/authorizations/${authA}/void`,
    requestId: voidKey,
    status: v.status,
    debugId: v.debugId,
    note: v.ok ? `status=${v.json?.status ?? '(204 no body)'}` : errSummary(v),
    extract: v.ok ? { status: v.json?.status ?? null } : v.json,
  });
  if (!v.ok) throw new Error('void failed');
  const vReplay = await pp(token, 'POST', `/v2/payments/authorizations/${authA}/void`, { requestId: voidKey });
  log(state, {
    step: 'idempotency.replay(authorizations.void A-void)',
    method: 'POST',
    path: `/v2/payments/authorizations/${authA}/void`,
    requestId: voidKey,
    status: vReplay.status,
    debugId: vReplay.debugId,
    note: vReplay.ok ? `status=${vReplay.json?.status ?? '(no body)'}` : errSummary(vReplay),
  });
  const gA = await pp(token, 'GET', `/v2/payments/authorizations/${authA}`);
  log(state, {
    step: 'authorizations.get(A-void, after void)',
    method: 'GET',
    path: `/v2/payments/authorizations/${authA}`,
    status: gA.status,
    debugId: gA.debugId,
    note: `status=${gA.json?.status} update_time=${gA.json?.update_time}`,
    extract: { id: gA.json?.id, status: gA.json?.status, update_time: gA.json?.update_time },
  });
  // A voided hold can no longer be captured: PayPal itself refuses (defence in depth for Stamp's state machine).
  const capVoided = await pp(token, 'POST', `/v2/payments/authorizations/${authA}/capture`, { body: { final_capture: true }, requestId: randomUUID() });
  log(state, {
    step: 'guard.capture-after-void(A-void) [expected to fail]',
    method: 'POST',
    path: `/v2/payments/authorizations/${authA}/capture`,
    status: capVoided.status,
    debugId: capVoided.debugId,
    note: capVoided.ok ? 'UNEXPECTED SUCCESS' : errSummary(capVoided),
  });
  await readOrderViaToolkit(state, token, 'A-void', state.orders['A-void'].id);

  // ---- Order B: authorize, then CAPTURE (the "Spam" path), then pay the net out to the charity.
  const authB = await authorizeOrder(state, token, 'B-capture');
  const capKey = randomUUID();
  const c = await pp(token, 'POST', `/v2/payments/authorizations/${authB}/capture`, {
    body: { final_capture: true, note_to_payer: 'Stamp sandbox test: captured hold is donated to charity.' },
    requestId: capKey,
  });
  const brk = c.json?.seller_receivable_breakdown;
  log(state, {
    step: 'authorizations.capture(B-capture)',
    method: 'POST',
    path: `/v2/payments/authorizations/${authB}/capture`,
    requestId: capKey,
    status: c.status,
    debugId: c.debugId,
    note: c.ok ? `capture=${c.json.id} status=${c.json.status} gross=${brk?.gross_amount?.value} fee=${brk?.paypal_fee?.value} net=${brk?.net_amount?.value}` : errSummary(c),
    extract: c.ok
      ? { id: c.json.id, status: c.json.status, final_capture: c.json.final_capture, create_time: c.json.create_time, seller_receivable_breakdown: brk }
      : c.json,
  });
  if (!c.ok) throw new Error('capture failed');
  state.orders['B-capture'].captureId = c.json.id;
  state.orders['B-capture'].net = brk?.net_amount?.value;
  saveState(state);

  const cReplay = await pp(token, 'POST', `/v2/payments/authorizations/${authB}/capture`, {
    body: { final_capture: true, note_to_payer: 'Stamp sandbox test: captured hold is donated to charity.' },
    requestId: capKey,
  });
  log(state, {
    step: 'idempotency.replay(authorizations.capture B-capture, same key)',
    method: 'POST',
    path: `/v2/payments/authorizations/${authB}/capture`,
    requestId: capKey,
    status: cReplay.status,
    debugId: cReplay.debugId,
    note: cReplay.ok ? `capture=${cReplay.json?.id} (same: ${cReplay.json?.id === c.json.id})` : errSummary(cReplay),
    extract: { originalCaptureId: c.json.id, replayCaptureId: cReplay.json?.id, same: cReplay.json?.id === c.json.id },
  });
  const cNew = await pp(token, 'POST', `/v2/payments/authorizations/${authB}/capture`, { body: { final_capture: true }, requestId: randomUUID() });
  log(state, {
    step: 'guard.second-capture-new-key(B-capture) [expected to fail]',
    method: 'POST',
    path: `/v2/payments/authorizations/${authB}/capture`,
    status: cNew.status,
    debugId: cNew.debugId,
    note: cNew.ok ? `UNEXPECTED SUCCESS capture=${cNew.json?.id}` : errSummary(cNew),
  });
  const gc = await pp(token, 'GET', `/v2/payments/captures/${c.json.id}`);
  log(state, {
    step: 'captures.get(B-capture)',
    method: 'GET',
    path: `/v2/payments/captures/${c.json.id}`,
    status: gc.status,
    debugId: gc.debugId,
    note: `status=${gc.json?.status}`,
    extract: { id: gc.json?.id, status: gc.json?.status, update_time: gc.json?.update_time },
  });
  await readOrderViaToolkit(state, token, 'B-capture', state.orders['B-capture'].id);

  // ---- Payout of the net captured amount to the sandbox charity account.
  const amount = brk?.net_amount?.value ?? '1.00';
  const senderBatchId = `stamp-gonogo-${state.runId}`;
  const payoutKey = randomUUID();
  const payoutBody = {
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      email_subject: 'A donation from Stamp (sandbox test)',
      email_message: 'A spam hold was captured and donated to you. This is a PayPal sandbox test.',
    },
    items: [
      {
        recipient_type: 'EMAIL',
        receiver: charity,
        amount: { value: amount, currency: CURRENCY },
        note: `Stamp go/no-go donation of captured hold ${c.json.id} (sandbox)`,
        sender_item_id: `${senderBatchId}-1`,
      },
    ],
  };
  const p = await pp(token, 'POST', '/v1/payments/payouts', { body: payoutBody, requestId: payoutKey });
  const batchId = p.json?.batch_header?.payout_batch_id;
  log(state, {
    step: 'payouts.create(charity)',
    method: 'POST',
    path: '/v1/payments/payouts',
    requestId: payoutKey,
    status: p.status,
    debugId: p.debugId,
    note: p.ok ? `batch=${batchId} status=${p.json.batch_header.batch_status} amount=${amount} ${CURRENCY} -> ${maskEmail(charity)}` : errSummary(p),
    extract: p.ok ? { payout_batch_id: batchId, batch_status: p.json.batch_header.batch_status, sender_batch_id: senderBatchId, amount, receiver: maskEmail(charity) } : p.json,
  });
  if (!p.ok) throw new Error('payout create failed');
  state.payout = { batchId, senderBatchId, payoutKey, amount };
  saveState(state);

  let final = null;
  for (let i = 0; i < 36; i += 1) {
    await new Promise((r) => setTimeout(r, 5_000));
    const g = await pp(token, 'GET', `/v1/payments/payouts/${batchId}`);
    const bs = g.json?.batch_header?.batch_status;
    const item = g.json?.items?.[0];
    if (['SUCCESS', 'DENIED', 'CANCELED'].includes(bs) || i === 35) {
      final = g;
      log(state, {
        step: 'payouts.get(charity, final)',
        method: 'GET',
        path: `/v1/payments/payouts/${batchId}`,
        status: g.status,
        debugId: g.debugId,
        note: `batch_status=${bs} item=${item?.transaction_status} item_id=${item?.payout_item_id} fee=${item?.payout_item_fee?.value} after ${(i + 1) * 5}s`,
        extract: {
          batch_status: bs,
          time_created: g.json?.batch_header?.time_created,
          time_completed: g.json?.batch_header?.time_completed,
          amount: g.json?.batch_header?.amount,
          fees: g.json?.batch_header?.fees,
          item: item && {
            payout_item_id: item.payout_item_id,
            transaction_id: item.transaction_id,
            transaction_status: item.transaction_status,
            payout_item_fee: item.payout_item_fee,
            time_processed: item.time_processed,
            receiver: maskEmail(item.payout_item?.receiver),
          },
        },
      });
      break;
    }
  }
  state.payout.finalStatus = final?.json?.batch_header?.batch_status;
  state.payout.itemStatus = final?.json?.items?.[0]?.transaction_status;
  saveState(state);

  // Idempotency for payouts is the sender_batch_id: a second batch with the same id must be rejected.
  const dup = await pp(token, 'POST', '/v1/payments/payouts', { body: payoutBody, requestId: randomUUID() });
  log(state, {
    step: 'idempotency.replay(payouts.create, same sender_batch_id, new request id) [expected to be rejected]',
    method: 'POST',
    path: '/v1/payments/payouts',
    status: dup.status,
    debugId: dup.debugId,
    note: dup.ok ? `UNEXPECTED new batch=${dup.json?.batch_header?.payout_batch_id}` : errSummary(dup),
  });
  console.log('\nfinish complete. Run: npm run gonogo -- coverage && npm run gonogo -- report');
}

async function cmdCoverage() {
  const state = loadState() ?? { runId: `gn-cov-${Date.now()}`, events: [], orders: {} };
  const token = await getToken(state);
  // Local toolkit MCP server with every action enabled: the full catalogue.
  const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/mcp');
  const { ALL_TOOLS_ENABLED } = await import('@paypal/agent-toolkit/ai-sdk');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = new PayPalAgentToolkit({ accessToken: token, configuration: { actions: ALL_TOOLS_ENABLED, context: { sandbox: true } } });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'stamp-gonogo-coverage', version: '0.1.0' });
  await client.connect(ct);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  const localNames = tools.map((t) => t.name).sort();
  const createOrderSchema = tools.find((t) => t.name === 'create_order')?.inputSchema;
  log(state, {
    step: 'coverage.local-toolkit-mcp',
    method: 'MCP tools/list',
    path: '@paypal/agent-toolkit@1.11.0 (in-process)',
    status: `${localNames.length} tools`,
    note: localNames.join(','),
    extract: { tools: localNames, create_order_input_has_intent: JSON.stringify(createOrderSchema ?? {}).includes('intent') },
  });

  // Remote sandbox MCP server (streamable HTTP), bearer = sandbox access token.
  let remote = { ok: false };
  try {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const transport = new StreamableHTTPClientTransport(new URL(REMOTE_MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const rc = new Client({ name: 'stamp-gonogo-remote', version: '0.1.0' });
    await Promise.race([rc.connect(transport), new Promise((_, rej) => setTimeout(() => rej(new Error('connect timeout 25s')), 25_000))]);
    const listed = await rc.listTools();
    remote = { ok: true, tools: listed.tools.map((t) => t.name).sort() };
    await rc.close();
  } catch (e) {
    remote = { ok: false, error: String(e?.message ?? e).slice(0, 300) };
  }
  log(state, {
    step: 'coverage.remote-mcp',
    method: 'MCP tools/list',
    path: REMOTE_MCP_URL,
    status: remote.ok ? `${remote.tools.length} tools` : 'not reachable with client-credentials bearer',
    note: remote.ok ? remote.tools.join(',') : remote.error,
    extract: remote,
  });

  const needs = {
    'create order (intent AUTHORIZE)': ['create_order'],
    'get order': ['get_order'],
    'authorize order': ['authorize_order'],
    'void authorization': ['void_authorization', 'void_payment'],
    'capture authorization': ['capture_authorization', 'capture_authorized_payment'],
    payouts: ['create_payout', 'create_batch_payout', 'get_payout'],
  };
  const matrix = Object.fromEntries(
    Object.entries(needs).map(([op, names]) => [op, { local: names.filter((n) => localNames.includes(n)), remote: remote.ok ? names.filter((n) => remote.tools.includes(n)) : null }]),
  );
  state.coverage = { localNames, remote, matrix };
  saveState(state);
  console.log(JSON.stringify(matrix, null, 2));
}

function cmdReport() {
  const state = loadState();
  if (!state) throw new Error('no state');
  const evidence = {
    note: 'Sanitized evidence from scripts/gonogo.mjs against the PayPal SANDBOX. No tokens or secrets; emails masked.',
    runId: state.runId,
    startedAt: state.startedAt,
    orders: Object.fromEntries(Object.entries(state.orders).map(([k, o]) => [k, { id: o.id, authorizationId: o.authorizationId, captureId: o.captureId, net: o.net }])),
    payout: state.payout && { batchId: state.payout.batchId, senderBatchId: state.payout.senderBatchId, amount: state.payout.amount, finalStatus: state.payout.finalStatus, itemStatus: state.payout.itemStatus },
    coverage: state.coverage,
    events: state.events,
  };
  mkdirSync(dirname(EVIDENCE_FILE), { recursive: true });
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  const raw = readFileSync(EVIDENCE_FILE, 'utf8');
  for (const secretName of ['PAYPAL_CLIENT_SECRET', 'PAYPAL_CLIENT_ID']) {
    const val = process.env[secretName];
    if (val && raw.includes(val)) throw new Error(`refusing: ${secretName} leaked into evidence`);
  }
  if (/A21AA[A-Za-z0-9_-]{20,}/.test(raw)) throw new Error('refusing: something that looks like an access token leaked into evidence');
  console.log(`wrote ${EVIDENCE_FILE}`);
}

const cmd = process.argv[2];
const commands = { create: cmdCreate, status: cmdStatus, finish: cmdFinish, coverage: cmdCoverage, report: cmdReport };
if (!commands[cmd]) {
  console.error(`usage: npm run gonogo -- <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
Promise.resolve(commands[cmd]()).catch((e) => {
  console.error(`FAILED: ${e?.message ?? e}`);
  process.exit(1);
});
