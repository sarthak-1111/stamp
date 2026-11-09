import 'server-only';
import { getCharity, getConfig } from '@/lib/config';
import { getDb } from '@/lib/db';
import { newId, newToken } from '@/lib/ids';
import { type SpamReason, type Via } from '@/lib/copy';
import { getMessage, recordDecision, type Decision } from '@/lib/messages';
import * as pp from '@/lib/paypal/api';
import { issueOf, PayPalUnknownOutcomeError, type PayPalResult } from '@/lib/paypal/client';
import { readOrder } from '@/lib/paypal/toolkit';
import { addToFreeLane, getRecipientByHandle, matchesFreeLane } from '@/lib/recipients';
import { takeRateLimit } from '@/lib/ratelimit';
import { getTriage, onDelivered } from '@/lib/triage/pipeline';
import { assertOperation, isTerminal, STATE_COPY, type Actor, type Outcome } from './machine';
import * as repo from './repo';
import { SQL_NOW, type Hold } from './repo';

/**
 * Orchestration of the money flow. Rules that matter:
 *  - Only `recipientDecide` (Reply / Worth it / Spam) and the timer (`sweep` / `refreshHold`) START a
 *    void, capture or payout. Webhooks and the reconciler only finish an operation that was already
 *    started, or mirror what PayPal reports.
 *  - Nothing in this file reads AI output to decide anything. Triage is advisory and only displayed.
 *  - Every PayPal write uses a PayPal-Request-Id persisted before the first attempt.
 */

export class StampError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'StampError';
  }
}

type LogActor = Actor | 'reconciler' | 'webhook';

async function logCall(holdId: string, actor: LogActor, call: string, res: PayPalResult | null, extra: Record<string, unknown> = {}, requestId?: string) {
  await repo.addEvent(holdId, {
    kind: 'paypal',
    actor,
    detail: {
      call,
      http: res?.status ?? 'no-response',
      debug_id: res?.debugId ?? null,
      request_id: requestId ?? null,
      ...(res && !res.ok ? { issue: issueOf(res) } : {}),
      ...extra,
    },
  });
}

function isStale(iso: string | null, seconds: number): boolean {
  return !iso || Date.now() - Date.parse(iso) > seconds * 1000;
}

// ================================================================ sender

export type SendInput = {
  handle: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  inputFlags: string[];
  /** Where the message came from. Agents using the API or MCP declare themselves with agentName. */
  via?: Via;
  agentName?: string | null;
};

export type SendResult = { lane: 'free'; statusToken: string } | { lane: 'hold'; statusToken: string; approveUrl: string };

export async function sendMessage(input: SendInput, ctx: { ipHash: string | null }): Promise<SendResult> {
  const recipient = await getRecipientByHandle(input.handle);
  if (!recipient) throw new StampError('not_found', 'There is no Stamp page with that handle.', 404);
  const charity = getCharity(recipient.charityId);
  if (!charity) throw new StampError('charity_unavailable', 'This page cannot accept holds right now (no charity is configured).', 503);
  const db = await getDb();
  const messageId = newId('msg');
  const statusToken = newToken();
  const common = [messageId, recipient.id, input.senderName, input.senderEmail, input.subject, input.body, JSON.stringify(input.inputFlags), statusToken, ctx.ipHash];
  const origin = [input.via ?? 'web', input.agentName ?? null];

  if (matchesFreeLane(recipient.freeLane, input.senderEmail)) {
    await db.query(
      `INSERT INTO messages (id, recipient_id, lane, sender_name, sender_email, subject, body, input_flags, status_token, ip_hash, delivered_at, via, agent_name)
       VALUES ($1, $2, 'free', $3, $4, $5, $6, $7::jsonb, $8, $9, now(), $10, $11)`,
      [...common, ...origin],
    );
    await onDelivered(messageId);
    return { lane: 'free', statusToken };
  }

  const holdId = newId('hold');
  await db.query(
    `WITH m AS (
       INSERT INTO messages (id, recipient_id, lane, sender_name, sender_email, subject, body, input_flags, status_token, ip_hash, via, agent_name)
       VALUES ($1, $2, 'hold', $3, $4, $5, $6, $7::jsonb, $8, $9, $16, $17) RETURNING id, recipient_id
     ), h AS (
       INSERT INTO holds (id, message_id, recipient_id, state, amount_cents, currency, charity_id, release_minutes)
       SELECT $10, id, recipient_id, 'DRAFT', $11, $12, $13, $14 FROM m RETURNING id
     )
     INSERT INTO hold_events (hold_id, kind, to_state, actor, detail)
     SELECT id, 'created', 'DRAFT', 'sender', $15::jsonb FROM h`,
    [
      ...common,
      holdId,
      recipient.holdCents,
      recipient.currency,
      recipient.charityId,
      recipient.releaseMinutes,
      JSON.stringify({ amount_cents: recipient.holdCents, release_minutes: recipient.releaseMinutes, charity: charity.name, via: origin[0] }),
      ...origin,
    ],
  );

  const cfg = getConfig();
  const requestId = await repo.requestIdFor(holdId, 'create_order');
  const orderInput = {
    holdId,
    amountCents: recipient.holdCents,
    currency: recipient.currency,
    description: `Refundable hold to reach @${recipient.handle} on Stamp (sandbox)`,
    returnUrl: `${cfg.appUrl}/api/paypal/return`,
    cancelUrl: `${cfg.appUrl}/api/paypal/cancel`,
    requestId,
  };
  let res: PayPalResult | null = null;
  for (let attempt = 0; attempt < 2 && !res; attempt += 1) {
    try {
      res = await pp.createOrder(orderInput); // same PayPal-Request-Id on the retry: never two orders
    } catch (err) {
      if (!(err instanceof PayPalUnknownOutcomeError)) throw err;
      await logCall(holdId, 'sender', 'orders.create', null, { error: err.message }, requestId);
    }
  }
  if (res) await logCall(holdId, 'sender', 'orders.create', res, { order_id: res.json?.id ?? null, order_status: res.json?.status ?? null }, requestId);
  const approveUrl: string | undefined = res?.ok
    ? (res.json?.links ?? []).find((l: { rel: string; href: string }) => l.rel === 'payer-action' || l.rel === 'approve')?.href
    : undefined;
  if (!res || !res.ok || !res.json?.id || !approveUrl) {
    await repo.transition({
      holdId,
      from: 'DRAFT',
      to: 'FAILED',
      actor: 'system',
      outcome: 'order_failed',
      set: { failure_reason: res ? issueOf(res) : 'PAYPAL_UNREACHABLE' },
    });
    throw new StampError('paypal_unavailable', 'PayPal could not start the checkout. Nothing was held or charged. Please try again.', 502);
  }
  await repo.updateHoldFields(holdId, { order_id: String(res.json.id), approve_url: approveUrl, paypal_status: String(res.json.status) });
  return { lane: 'hold', statusToken, approveUrl };
}

/** The buyer came back from PayPal (return_url). Authorize right away and show the status page. */
// ================================================================ free-pass requests

export type RequestInput = { handle: string; senderName: string; senderEmail: string; note: string; inputFlags: string[] };

/** How many undecided requests a page holds before it stops taking more, and how often one person may ask. */
export const REQUEST_LIMITS = { pendingPerPage: 20, repeatDays: 7 } as const;

/**
 * Someone who cannot or will not place a hold asks for a free pass. It costs nothing, so it is tightly
 * limited: one per address per page per week, and a page stops taking requests while 20 are undecided.
 * The recipient can grant it (the address joins the free lane) or decline it. No money is involved.
 */
export async function requestFreePass(input: RequestInput, ctx: { ipHash: string | null }): Promise<{ statusToken: string }> {
  const recipient = await getRecipientByHandle(input.handle);
  if (!recipient) throw new StampError('not_found', 'There is no Stamp page with that handle.', 404);
  if (matchesFreeLane(recipient.freeLane, input.senderEmail)) {
    throw new StampError('already_free', 'This address can already write without a hold. Just send your message.', 409);
  }
  const db = await getDb();
  const recent = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM messages
      WHERE recipient_id = $1 AND lane = 'request' AND sender_email = $2 AND created_at > now() - make_interval(days => $3)`,
    [recipient.id, input.senderEmail, REQUEST_LIMITS.repeatDays],
  );
  if (Number(recent[0]?.n ?? 0) > 0) throw new StampError('already_requested', 'You already asked this page for a free pass this week.', 429);
  const pending = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM messages WHERE recipient_id = $1 AND lane = 'request' AND decision IS NULL`,
    [recipient.id],
  );
  if (Number(pending[0]?.n ?? 0) >= REQUEST_LIMITS.pendingPerPage) {
    throw new StampError('requests_full', 'This page is not taking free-pass requests right now. You can still write with a hold.', 429);
  }
  const messageId = newId('msg');
  const statusToken = newToken();
  await db.query(
    `INSERT INTO messages (id, recipient_id, lane, sender_name, sender_email, subject, body, input_flags, status_token, ip_hash, delivered_at)
     VALUES ($1, $2, 'request', $3, $4, 'Free pass request', $5, $6::jsonb, $7, $8, now())`,
    [messageId, recipient.id, input.senderName, input.senderEmail, input.note, JSON.stringify(input.inputFlags), statusToken, ctx.ipHash],
  );
  await onDelivered(messageId);
  return { statusToken };
}

export async function handleApprovalReturn(orderId: string): Promise<string> {
  const hold = await repo.getHoldByOrderId(orderId);
  if (!hold) throw new StampError('not_found', 'Unknown checkout.', 404);
  await advanceCheckout(hold.id, 'sender');
  const msg = await getMessage(hold.messageId);
  if (!msg) throw new StampError('not_found', 'Unknown message.', 404);
  return msg.statusToken;
}

/** The buyer backed out at PayPal (cancel_url). */
export async function handleApprovalCancel(orderId: string): Promise<string | null> {
  const hold = await repo.getHoldByOrderId(orderId);
  if (!hold) return null;
  if (hold.state === 'DRAFT') {
    const read = await readOrder(orderId).catch(() => null);
    const status = read?.order?.status as string | undefined;
    if (status === 'APPROVED' || status === 'COMPLETED') await advanceCheckout(hold.id, 'sender');
    else await repo.transition({ holdId: hold.id, from: 'DRAFT', to: 'EXPIRED', actor: 'sender', outcome: 'cancelled' });
  }
  const msg = await getMessage(hold.messageId);
  return msg?.statusToken ?? null;
}

/** DRAFT -> APPROVED -> AUTHORIZED, driven by the return URL, a webhook, or the reconciler. */
async function advanceCheckout(holdId: string, via: 'sender' | 'paypal' | 'system'): Promise<void> {
  let hold = await repo.getHold(holdId);
  if (!hold) return;
  if (hold.state === 'DRAFT') {
    if (!hold.orderId) return;
    const read = await readOrder(hold.orderId);
    const status = (read.order?.status as string | undefined) ?? null;
    await repo.addEvent(hold.id, {
      kind: 'paypal',
      actor: via === 'sender' ? 'sender' : 'reconciler',
      detail: { call: 'orders.get', via: read.via, http: read.status, order_status: status },
    });
    const approver: Actor = via === 'sender' ? 'sender' : 'paypal';
    if (status === 'APPROVED' || status === 'COMPLETED') {
      const payer = pp.payerFromOrder(read.order);
      await repo.transition({
        holdId,
        from: 'DRAFT',
        to: 'APPROVED',
        actor: status === 'COMPLETED' ? 'paypal' : approver,
        set: {
          payer_name: payer.name,
          payer_email: payer.email,
          payer_id: payer.payerId,
          paypal_status: status,
          last_verified_at: SQL_NOW,
        },
        detail: { order_status: status, via: read.via },
      });
      if (status === 'COMPLETED') {
        // Already authorized (e.g. a response we never received). Mirror what PayPal has.
        const auth = pp.authorizationFromOrder(read.order);
        if (auth) await markAuthorized(holdId, auth, 'paypal', null, null);
        return;
      }
    } else if (read.status === 404 || status === 'VOIDED') {
      await repo.transition({ holdId, from: 'DRAFT', to: 'EXPIRED', actor: 'paypal', outcome: 'abandoned', detail: { http: read.status, order_status: status } });
      return;
    } else {
      if (Date.now() - Date.parse(hold.createdAt) > getConfig().abandonMinutes * 60_000) {
        await repo.transition({ holdId, from: 'DRAFT', to: 'EXPIRED', actor: 'system', outcome: 'abandoned', detail: { order_status: status } });
      }
      return; // still waiting for the buyer
    }
    hold = await repo.getHold(holdId);
  }
  if (hold?.state === 'APPROVED') await authorizeHold(hold, via);
}

async function authorizeHold(hold: Hold, actor: 'sender' | 'paypal' | 'system'): Promise<void> {
  assertOperation('authorize', 'APPROVED', actor);
  const claimed = (await repo.claim(hold.id, 'authorize', 'APPROVED', actor, null)) ?? (await repo.resumeStale(hold.id, 'authorize'));
  if (!claimed?.orderId) return; // another request is authorizing right now
  const requestId = await repo.requestIdFor(hold.id, 'authorize');
  let res: PayPalResult;
  try {
    res = await pp.authorizeOrder(claimed.orderId, requestId);
  } catch (err) {
    if (!(err instanceof PayPalUnknownOutcomeError)) throw err;
    await logCall(hold.id, actor, 'orders.authorize', null, { error: err.message }, requestId);
    return; // outcome unknown: the reconciler retries with the same PayPal-Request-Id
  }
  const auth = res.ok ? pp.authorizationFromOrder(res.json) : null;
  await logCall(hold.id, actor, 'orders.authorize', res, { authorization_id: auth?.id ?? null, authorization_status: auth?.status ?? null }, requestId);
  if (res.ok && auth) {
    if (auth.status === 'DENIED') {
      await repo.transition({
        holdId: hold.id,
        from: 'APPROVED',
        to: 'FAILED',
        actor,
        outcome: 'declined',
        pendingOp: 'authorize',
        set: { failure_reason: 'AUTHORIZATION_DENIED', paypal_status: 'DENIED' },
      });
      return;
    }
    await markAuthorized(hold.id, auth, actor, pp.payerFromOrder(res.json), 'authorize');
    return;
  }
  const issue = issueOf(res);
  if (issue === 'ORDER_ALREADY_AUTHORIZED') {
    const read = await readOrder(claimed.orderId);
    const existing = read.order ? pp.authorizationFromOrder(read.order) : null;
    if (existing) {
      await markAuthorized(hold.id, existing, 'paypal', pp.payerFromOrder(read.order), 'authorize');
      return;
    }
  }
  if (res.status >= 400 && res.status < 500) {
    await repo.transition({
      holdId: hold.id,
      from: 'APPROVED',
      to: 'FAILED',
      actor,
      outcome: 'declined',
      pendingOp: 'authorize',
      set: { failure_reason: issue },
    });
    return;
  }
  await repo.releaseClaim(hold.id, 'authorize', { issue });
}

/** The hold is live. The release window is anchored to PayPal's authorization time (inside the honor period). */
async function markAuthorized(
  holdId: string,
  auth: pp.ParsedAuthorization,
  actor: 'sender' | 'paypal' | 'system',
  payer: { name: string | null; email: string | null; payerId: string | null } | null,
  pendingOp: 'authorize' | null,
): Promise<void> {
  const hold = await repo.getHold(holdId);
  if (!hold || hold.state !== 'APPROVED') return;
  const created = auth.createTime ? new Date(auth.createTime) : new Date();
  const releaseAt = new Date(created.getTime() + hold.releaseMinutes * 60_000).toISOString();
  const set: Record<string, string | number | null | typeof SQL_NOW> = {
    authorization_id: auth.id,
    authorized_at: created.toISOString(),
    release_at: releaseAt,
    auth_expires_at: auth.expirationTime,
    paypal_status: auth.status,
    last_verified_at: SQL_NOW,
  };
  if (payer?.name) set.payer_name = payer.name;
  if (payer?.email) set.payer_email = payer.email;
  if (payer?.payerId) set.payer_id = payer.payerId;
  const updated = await repo.transition({
    holdId,
    from: 'APPROVED',
    to: 'AUTHORIZED',
    actor,
    pendingOp: pendingOp ?? undefined,
    deliverMessage: true,
    set,
    detail: { authorization_id: auth.id, authorization_expires: auth.expirationTime, release_at: releaseAt },
  });
  if (updated) await onDelivered(updated.messageId);
}

// ================================================================ recipient

export async function recipientDecide(
  recipientId: string,
  messageId: string,
  action: Decision,
  opts: { replyText?: string | null; confirm?: boolean; reason?: SpamReason | null },
): Promise<{ lane: 'free' | 'hold' | 'request'; hold: Hold | null; freeLane?: 'added' | 'present' | 'full' }> {
  const msg = await getMessage(messageId);
  if (!msg || msg.recipientId !== recipientId) throw new StampError('not_found', 'Message not found.', 404);
  if (msg.decision) throw new StampError('already_decided', 'You already decided on this message.', 409);

  if (msg.lane === 'request') {
    if (action !== 'grant' && action !== 'decline') throw new StampError('invalid_action', 'A free-pass request can only be granted or declined.', 400);
    if (!(await recordDecision(messageId, action, null))) throw new StampError('already_decided', 'You already decided on this request.', 409);
    const freeLane = action === 'grant' ? await addToFreeLane(recipientId, msg.senderEmail) : undefined;
    return { lane: 'request', hold: null, freeLane };
  }
  if (action === 'grant' || action === 'decline') throw new StampError('invalid_action', 'Only free-pass requests can be granted or declined.', 400);

  const replyText = action === 'reply' ? (opts.replyText ?? '').trim() : null;
  if (action === 'reply' && !replyText) throw new StampError('reply_required', 'Write a reply first.', 400);
  if (action === 'spam' && opts.confirm !== true) throw new StampError('confirm_required', 'Please confirm before marking a message as spam.', 400);
  const reason = action === 'spam' ? (opts.reason ?? null) : null;
  if (action === 'spam' && !reason) throw new StampError('reason_required', 'Pick a reason. The sender will see it.', 400);

  if (msg.lane === 'free') {
    if (!(await recordDecision(messageId, action, replyText, reason))) throw new StampError('already_decided', 'You already decided on this message.', 409);
    return { lane: 'free', hold: null };
  }

  const hold = await repo.getHoldByMessageId(messageId);
  if (!hold) throw new StampError('not_found', 'Hold not found.', 404);
  if (hold.state !== 'AUTHORIZED') {
    throw new StampError('not_held', `This hold is no longer live (${STATE_COPY[hold.state].label.toLowerCase()}).`, 409);
  }
  const op = action === 'spam' ? 'capture' : 'void';
  assertOperation(op, 'AUTHORIZED', 'recipient', action);
  const claimed = await repo.claim(hold.id, op, 'AUTHORIZED', 'recipient', action, op === 'capture' ? 'before_release' : 'none');
  if (!claimed) {
    const now = await repo.getHold(hold.id);
    if (now?.pendingOp) throw new StampError('in_progress', 'Another action on this hold is already in progress.', 409);
    if (op === 'capture' && now?.releaseAt && Date.parse(now.releaseAt) <= Date.now()) {
      throw new StampError('window_ended', 'The window has ended, so this hold is being released to the sender. Spam can only be marked while the hold is live.', 409);
    }
    throw new StampError('not_held', 'This hold is no longer live.', 409);
  }
  const triage = await getTriage(messageId);
  await recordDecision(messageId, action, replyText, reason);
  await repo.addEvent(hold.id, {
    kind: 'decision',
    actor: 'recipient',
    detail: {
      action,
      ...(reason ? { reason } : {}),
      ai_recommendation: triage?.recommendation ?? null,
      ai_source: triage?.source ?? null,
      ai_fit: triage?.fitScore ?? null,
      ai_risk: triage?.riskScore ?? null,
    },
  });
  if (op === 'void') await executeVoid(claimed);
  else await executeCapture(claimed);
  return { lane: 'hold', hold: await repo.getHold(hold.id) };
}

async function executeVoid(hold: Hold): Promise<void> {
  if (!hold.authorizationId || hold.pendingOp !== 'void' || !hold.pendingActor) return;
  const actor = hold.pendingActor;
  const outcome = hold.pendingReason as Outcome;
  const requestId = await repo.requestIdFor(hold.id, 'void');
  let res: PayPalResult;
  try {
    res = await pp.voidAuthorization(hold.authorizationId, requestId);
  } catch (err) {
    if (!(err instanceof PayPalUnknownOutcomeError)) throw err;
    await logCall(hold.id, actor, 'authorizations.void', null, { error: err.message }, requestId);
    return;
  }
  await logCall(hold.id, actor, 'authorizations.void', res, { authorization_status: res.json?.status ?? null }, requestId);
  if (res.ok) {
    await repo.transition({
      holdId: hold.id,
      from: 'AUTHORIZED',
      to: 'VOIDED',
      actor,
      outcome,
      pendingOp: 'void',
      set: { paypal_status: 'VOIDED', last_verified_at: SQL_NOW },
    });
    return;
  }
  const status = await syncAuthorization(hold.id);
  if (status === 'CREATED' || status === 'PENDING') await repo.releaseClaim(hold.id, 'void', { issue: issueOf(res) });
}

async function executeCapture(hold: Hold): Promise<void> {
  if (!hold.authorizationId || hold.pendingOp !== 'capture') return;
  const charity = getCharity(hold.charityId);
  const requestId = await repo.requestIdFor(hold.id, 'capture');
  let res: PayPalResult;
  try {
    res = await pp.captureAuthorization(
      hold.authorizationId,
      requestId,
      `Marked as spam on Stamp. The full amount after PayPal's fee is donated to ${charity?.name ?? 'charity'}; the recipient receives nothing.`,
    );
  } catch (err) {
    if (!(err instanceof PayPalUnknownOutcomeError)) throw err;
    await logCall(hold.id, 'recipient', 'authorizations.capture', null, { error: err.message }, requestId);
    return;
  }
  const cap = res.ok ? pp.parseCapture(res.json) : null;
  await logCall(
    hold.id,
    'recipient',
    'authorizations.capture',
    res,
    cap ? { capture_id: cap.id, capture_status: cap.status, gross_cents: cap.grossCents, fee_cents: cap.feeCents, net_cents: cap.netCents } : {},
    requestId,
  );
  if (res.ok && cap) {
    await applyCapture(hold.id, cap, 'recipient', 'capture');
    return;
  }
  const status = await syncAuthorization(hold.id);
  if (status === 'CREATED' || status === 'PENDING') await repo.releaseClaim(hold.id, 'capture', { issue: issueOf(res) });
}

async function applyCapture(holdId: string, cap: pp.ParsedCapture, actor: 'recipient' | 'paypal', pendingOp: 'capture' | null): Promise<void> {
  if (cap.status === 'COMPLETED' || cap.status === 'PENDING') {
    const updated = await repo.transition({
      holdId,
      from: 'AUTHORIZED',
      to: 'CAPTURED',
      actor,
      outcome: actor === 'recipient' ? 'spam' : 'captured_outside_stamp',
      pendingOp: pendingOp ?? undefined,
      set: { capture_id: cap.id, fee_cents: cap.feeCents, net_cents: cap.netCents, paypal_status: cap.status, last_verified_at: SQL_NOW },
      detail: { capture_id: cap.id, gross_cents: cap.grossCents, fee_cents: cap.feeCents, net_cents: cap.netCents },
    });
    if (updated && cap.status === 'COMPLETED') await startPayout(updated);
    return;
  }
  await repo.transition({
    holdId,
    from: 'AUTHORIZED',
    to: 'FAILED',
    actor,
    outcome: 'capture_declined',
    pendingOp: pendingOp ?? undefined,
    set: { failure_reason: `CAPTURE_${cap.status}`, paypal_status: cap.status },
  });
}

/** Second half of the recipient's Spam decision: send the captured amount to the charity, never to the recipient. */
async function startPayout(hold: Hold): Promise<void> {
  if (hold.state !== 'CAPTURED' || hold.outcome !== 'spam') return;
  assertOperation('payout', 'CAPTURED', 'recipient', 'spam');
  const claimed =
    (await repo.claim(hold.id, 'payout', 'CAPTURED', 'recipient', 'spam', 'payout_ready')) ?? (await repo.resumeStale(hold.id, 'payout'));
  if (!claimed || claimed.netCents === null) return;
  const charity = getCharity(claimed.charityId);
  if (!charity) {
    await repo.releaseClaim(hold.id, 'payout', { issue: 'CHARITY_NOT_CONFIGURED' });
    return;
  }
  const requestId = await repo.requestIdFor(hold.id, 'payout');
  let res: PayPalResult;
  try {
    res = await pp.createPayout({
      holdId: hold.id,
      requestId,
      receiverEmail: charity.email,
      amountCents: claimed.netCents,
      currency: claimed.currency,
      charityName: charity.name,
    });
  } catch (err) {
    if (!(err instanceof PayPalUnknownOutcomeError)) throw err;
    await logCall(hold.id, 'recipient', 'payouts.create', null, { error: err.message }, requestId);
    return;
  }
  const header = res.ok ? res.json?.batch_header : null;
  await logCall(
    hold.id,
    'recipient',
    'payouts.create',
    res,
    {
      sender_batch_id: pp.senderBatchIdFor(hold.id),
      payout_batch_id: header?.payout_batch_id ?? null,
      batch_status: header?.batch_status ?? null,
      amount_cents: claimed.netCents,
      charity: charity.name,
    },
    requestId,
  );
  if (res.ok && header?.payout_batch_id) {
    const finished = await repo.finishClaim(hold.id, 'payout', { payout_batch_id: String(header.payout_batch_id), payout_status: String(header.batch_status) });
    if (finished && header.batch_status === 'SUCCESS') await pollPayout(finished);
    return;
  }
  if (res.status === 400 && /sender_batch_id already exists/i.test(JSON.stringify(res.json ?? {}))) {
    // The batch exists but its response was lost. PayPal links to the original batch.
    const link = (res.json?.links ?? []).find((l: { href?: string }) => /\/v1\/payments\/payouts\/[A-Z0-9]+/i.test(l.href ?? ''));
    const batchId = link?.href?.split('/').pop();
    if (batchId) await repo.finishClaim(hold.id, 'payout', { payout_batch_id: batchId, payout_status: 'PENDING' });
    return; // otherwise stays pending and shows as "donation in progress" for manual follow-up
  }
  await repo.transition({
    holdId: hold.id,
    from: 'CAPTURED',
    to: 'FAILED',
    actor: 'paypal',
    outcome: 'payout_failed',
    pendingOp: 'payout',
    set: { failure_reason: issueOf(res) },
  });
}

async function pollPayout(hold: Hold): Promise<void> {
  if (hold.state !== 'CAPTURED' || !hold.payoutBatchId) return;
  const res = await pp.getPayoutBatch(hold.payoutBatchId);
  const p = res.ok ? pp.parsePayoutBatch(res.json) : null;
  if (!p) return;
  const done = p.batchStatus === 'SUCCESS' && p.itemStatus === 'SUCCESS';
  const failed = ['DENIED', 'CANCELED'].includes(p.batchStatus) || ['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED', 'DENIED'].includes(p.itemStatus ?? '');
  if (done || failed || p.itemStatus !== hold.payoutStatus) {
    await logCall(hold.id, 'reconciler', 'payouts.get', res, { batch_status: p.batchStatus, item_status: p.itemStatus, payout_item_id: p.itemId, fee_cents: p.feeCents });
  }
  if (done) {
    await repo.transition({
      holdId: hold.id,
      from: 'CAPTURED',
      to: 'DONATED',
      actor: 'paypal',
      set: {
        donated_cents: p.amountCents,
        payout_fee_cents: p.feeCents,
        payout_item_id: p.itemId,
        payout_status: 'SUCCESS',
        last_verified_at: SQL_NOW,
      },
      detail: { payout_batch_id: p.batchId, payout_item_id: p.itemId, donated_cents: p.amountCents, payout_fee_cents: p.feeCents },
    });
  } else if (failed) {
    await repo.transition({
      holdId: hold.id,
      from: 'CAPTURED',
      to: 'FAILED',
      actor: 'paypal',
      outcome: 'payout_failed',
      set: { failure_reason: `PAYOUT_${p.itemStatus ?? p.batchStatus}`, payout_status: p.itemStatus ?? p.batchStatus },
    });
  } else {
    await repo.updateHoldFields(hold.id, { payout_status: p.itemStatus ?? p.batchStatus, payout_item_id: p.itemId, last_verified_at: SQL_NOW });
  }
}

/**
 * Read the authorization from PayPal and mirror any final status. Returns PayPal's status.
 * An operation that was in flight is completed in the name of whoever started it; anything else is
 * recorded as PayPal's doing (actor "paypal"), so the UI never claims a state PayPal disagrees with.
 */
async function syncAuthorization(holdId: string): Promise<string | null> {
  const hold = await repo.getHold(holdId);
  if (!hold || hold.state !== 'AUTHORIZED' || !hold.authorizationId) return null;
  const res = await pp.getAuthorization(hold.authorizationId);
  if (!res.ok) {
    await logCall(hold.id, 'reconciler', 'authorizations.get', res);
    return null;
  }
  const status = String(res.json?.status ?? '');
  if (status === 'CREATED' || status === 'PENDING') {
    await repo.updateHoldFields(hold.id, { paypal_status: status, last_verified_at: SQL_NOW });
    return status;
  }
  await logCall(hold.id, 'reconciler', 'authorizations.get', res, { authorization_status: status });
  if (status === 'VOIDED') {
    const mine = hold.pendingOp === 'void' && hold.pendingActor;
    await repo.transition({
      holdId: hold.id,
      from: 'AUTHORIZED',
      to: 'VOIDED',
      actor: mine ? (hold.pendingActor as Actor) : 'paypal',
      outcome: mine ? (hold.pendingReason as Outcome) : 'voided_at_paypal',
      set: { paypal_status: 'VOIDED', last_verified_at: SQL_NOW },
      detail: { completed_by: 'reconciler' },
    });
  } else if (status === 'CAPTURED' || status === 'PARTIALLY_CAPTURED') {
    const read = hold.orderId ? await readOrder(hold.orderId) : null;
    const captureId = read?.order ? pp.captureIdFromOrder(read.order) : null;
    const capRes = captureId ? await pp.getCapture(captureId) : null;
    const cap = capRes?.ok ? pp.parseCapture(capRes.json) : null;
    if (cap) {
      const mine = hold.pendingOp === 'capture';
      await applyCapture(hold.id, cap, mine ? 'recipient' : 'paypal', mine ? 'capture' : null);
    }
  } else if (status === 'EXPIRED') {
    await repo.transition({ holdId: hold.id, from: 'AUTHORIZED', to: 'EXPIRED', actor: 'paypal', outcome: 'expired_at_paypal', set: { paypal_status: status, last_verified_at: SQL_NOW } });
  } else if (status === 'DENIED') {
    await repo.transition({ holdId: hold.id, from: 'AUTHORIZED', to: 'FAILED', actor: 'paypal', outcome: 'declined', set: { paypal_status: status, failure_reason: 'AUTHORIZATION_DENIED' } });
  }
  return status;
}

// ================================================================ reconciler + timer

/** Re-read PayPal for one hold and finish whatever was left half-done. Never starts a new money movement. */
export async function reconcileHold(holdId: string): Promise<Hold | null> {
  const hold = await repo.getHold(holdId);
  if (!hold) return null;
  try {
    if (hold.state === 'DRAFT' || hold.state === 'APPROVED') {
      if (hold.pendingOp && !isStale(hold.pendingSince, 20)) return hold;
      await advanceCheckout(hold.id, 'system');
    } else if (hold.state === 'AUTHORIZED') {
      if (hold.pendingOp && !isStale(hold.pendingSince, 20)) return hold;
      const status = await syncAuthorization(hold.id);
      const after = await repo.getHold(hold.id);
      if (after?.state === 'AUTHORIZED' && after.pendingOp && (status === 'CREATED' || status === 'PENDING')) {
        const resumed = await repo.resumeStale(after.id, after.pendingOp);
        if (resumed?.pendingOp === 'void') await executeVoid(resumed);
        else if (resumed?.pendingOp === 'capture') await executeCapture(resumed);
      }
    } else if (hold.state === 'CAPTURED') {
      let current: Hold | null = hold;
      if ((hold.paypalStatus !== 'COMPLETED' || hold.netCents === null) && hold.captureId) {
        const capRes = await pp.getCapture(hold.captureId);
        const cap = capRes.ok ? pp.parseCapture(capRes.json) : null;
        if (cap) current = await repo.updateHoldFields(hold.id, { paypal_status: cap.status, fee_cents: cap.feeCents, net_cents: cap.netCents, last_verified_at: SQL_NOW });
      }
      if (!current) return null;
      if (current.payoutBatchId) await pollPayout(current);
      else if (!current.pendingOp || isStale(current.pendingSince, 20)) await startPayout(current);
    }
  } catch (err) {
    if (!(err instanceof PayPalUnknownOutcomeError)) throw err;
    await repo.addEvent(hold.id, { kind: 'note', actor: 'reconciler', detail: { error: err.message } });
  }
  return repo.getHold(holdId);
}

/** Timer: auto-release holds whose window ended. This is the ONLY place (with refreshHold) the timer acts. */
async function autoRelease(holdId: string): Promise<boolean> {
  const claimed = await repo.claim(holdId, 'void', 'AUTHORIZED', 'timer', 'auto_release', 'after_release');
  if (!claimed) return false;
  await executeVoid(claimed);
  return true;
}

export type SweepSummary = { released: number; reconciled: number; errors: number };

export async function sweep(limit = 10): Promise<SweepSummary> {
  const db = await getDb();
  const summary: SweepSummary = { released: 0, reconciled: 0, errors: 0 };
  const due = await db.query<{ id: string }>(
    `SELECT id FROM holds WHERE state = 'AUTHORIZED' AND pending_op IS NULL AND release_at <= now() ORDER BY release_at LIMIT $1`,
    [limit],
  );
  for (const r of due) {
    try {
      if (await autoRelease(r.id)) summary.released += 1;
    } catch (err) {
      summary.errors += 1;
      console.error('[stamp] auto-release failed', r.id, err);
    }
  }
  const work = await db.query<{ id: string }>(
    `SELECT id FROM holds
      WHERE (pending_op IS NOT NULL AND pending_since < now() - interval '20 seconds')
         OR state IN ('APPROVED', 'CAPTURED')
         OR (state = 'DRAFT' AND order_id IS NOT NULL AND created_at < now() - interval '1 minute'
             AND (last_check_at IS NULL OR last_check_at < now() - interval '2 minutes'))
         OR (state = 'AUTHORIZED' AND (last_verified_at IS NULL OR last_verified_at < now() - interval '10 minutes'))
      ORDER BY updated_at LIMIT $1`,
    [limit],
  );
  for (const r of work) {
    try {
      await repo.updateHoldFields(r.id, { last_check_at: SQL_NOW });
      await reconcileHold(r.id);
      summary.reconciled += 1;
    } catch (err) {
      summary.errors += 1;
      console.error('[stamp] reconcile failed', r.id, err);
    }
  }
  return summary;
}

/** Lazy timer for pages people are looking at: at most one global sweep per 15 s. */
export async function maybeSweep(): Promise<void> {
  if (await takeRateLimit('sweep:global', 1, 15)) await sweep(5);
}

/** Status page / inbox polling: release if due, otherwise re-verify with PayPal at most every 10 s. */
export async function refreshHold(holdId: string): Promise<Hold | null> {
  const hold = await repo.getHold(holdId);
  if (!hold || isTerminal(hold.state)) return hold;
  try {
    if (hold.state === 'AUTHORIZED' && !hold.pendingOp && hold.releaseAt && Date.parse(hold.releaseAt) <= Date.now()) {
      if (await autoRelease(hold.id)) return repo.getHold(hold.id);
    }
    if (await repo.takeCheckSlot(hold.id, 10)) return await reconcileHold(hold.id);
  } catch (err) {
    console.error('[stamp] refresh failed', holdId, err);
  }
  return repo.getHold(holdId);
}

// ================================================================ webhooks

type WebhookEvent = { id?: string; event_type?: string; resource?: Record<string, any> };

/** Webhooks are hints: find the hold, then re-read PayPal through the reconciler. */
export async function handleWebhookEvent(event: WebhookEvent): Promise<{ holdId: string | null; outcome: string }> {
  const type = String(event.event_type ?? '');
  const r = event.resource ?? {};
  const related = r.supplementary_data?.related_ids ?? {};
  let hold: Hold | null = null;
  if (type.startsWith('CHECKOUT.ORDER.')) hold = await repo.getHoldByOrderId(String(r.id ?? ''));
  else if (type.startsWith('PAYMENT.AUTHORIZATION.')) {
    hold = (await repo.getHoldByAuthorizationId(String(r.id ?? ''))) ?? (related.order_id ? await repo.getHoldByOrderId(String(related.order_id)) : null);
  } else if (type.startsWith('PAYMENT.CAPTURE.')) {
    hold =
      (await repo.getHoldByCaptureId(String(r.id ?? ''))) ??
      (related.authorization_id ? await repo.getHoldByAuthorizationId(String(related.authorization_id)) : null) ??
      (related.order_id ? await repo.getHoldByOrderId(String(related.order_id)) : null);
  } else if (type.startsWith('PAYMENT.PAYOUTSBATCH.')) {
    const batchId = r.batch_header?.payout_batch_id;
    const senderBatch = String(r.batch_header?.sender_batch_header?.sender_batch_id ?? '');
    hold = (batchId ? await repo.getHoldByPayoutBatchId(String(batchId)) : null) ?? (senderBatch.startsWith('stamp-') ? await repo.getHold(senderBatch.slice(6)) : null);
  } else if (type.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
    hold =
      (r.payout_batch_id ? await repo.getHoldByPayoutBatchId(String(r.payout_batch_id)) : null) ??
      (r.payout_item?.sender_item_id ? await repo.getHold(String(r.payout_item.sender_item_id)) : null);
  }
  if (!hold) return { holdId: null, outcome: 'no_matching_hold' };
  await repo.addEvent(hold.id, { kind: 'note', actor: 'webhook', detail: { webhook: type, event_id: event.id ?? null } });
  await reconcileHold(hold.id);
  return { holdId: hold.id, outcome: 'reconciled' };
}
