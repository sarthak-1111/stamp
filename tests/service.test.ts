import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db';
import { getHold, getHoldByMessageId, listEvents } from '@/lib/holds/repo';
import {
  handleApprovalCancel,
  handleApprovalReturn,
  handleWebhookEvent,
  reconcileHold,
  recipientDecide,
  sendMessage,
  StampError,
  sweep,
} from '@/lib/holds/service';
import { getMessageByStatusToken } from '@/lib/messages';
import { getTriage } from '@/lib/triage/pipeline';
import type { FakePayPal } from './fake-paypal';
import { expireWindow, makeRecipient, setup } from './helpers';

let db: Db;
let paypal: FakePayPal;

beforeEach(async () => {
  ({ db, paypal } = await setup());
  await makeRecipient('ana');
});

const message = {
  handle: 'ana',
  senderName: 'Sam Lee',
  senderEmail: 'sam@startup.example',
  subject: 'Battery storage pilot',
  body: 'Hi Ana, we are piloting grid battery storage in Osaka and would love 15 minutes of your advice. Would next week work?',
  inputFlags: [],
};

async function sendAndAuthorize(overrides: Partial<typeof message> = {}) {
  const sent = await sendMessage({ ...message, ...overrides }, { ipHash: 'test' });
  if (sent.lane !== 'hold') throw new Error('expected hold lane');
  const msg = await getMessageByStatusToken(sent.statusToken);
  const hold = await getHoldByMessageId(msg!.id);
  paypal.approve(hold!.orderId!);
  await handleApprovalReturn(hold!.orderId!);
  return { sent, msg: msg!, holdId: hold!.id };
}

async function expectStampError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof StampError && e.code === code);
}

describe('sender flow', () => {
  it('creates an AUTHORIZE order and does not deliver until PayPal approval', async () => {
    const sent = await sendMessage(message, { ipHash: 'test' });
    expect(sent.lane).toBe('hold');
    if (sent.lane !== 'hold') return;
    expect(sent.approveUrl).toContain('sandbox.paypal.com');
    const msg = await getMessageByStatusToken(sent.statusToken);
    expect(msg?.deliveredAt).toBeNull();
    const hold = await getHoldByMessageId(msg!.id);
    expect(hold?.state).toBe('DRAFT');
    expect(hold?.amountCents).toBe(500);
    const create = paypal.calls.find((c) => c.path === '/v2/checkout/orders');
    expect(create?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('approval -> authorization: hold is AUTHORIZED, message delivered, rule triage written', async () => {
    const { msg, holdId } = await sendAndAuthorize();
    const hold = await getHold(holdId);
    expect(hold?.state).toBe('AUTHORIZED');
    expect(hold?.authorizationId).toBeTruthy();
    expect(hold?.payerName).toBe('John Doe');
    const releaseMs = Date.parse(hold!.releaseAt!) - Date.parse(hold!.authorizedAt!);
    expect(releaseMs).toBe(60 * 60_000);
    expect((await getMessageByStatusToken(msg.statusToken))?.deliveredAt).toBeTruthy();
    const triage = await getTriage(msg.id);
    expect(triage?.source).toBe('rules');
    expect(triage?.fitScore).toBeGreaterThanOrEqual(50);
  });

  it('returning twice does not authorize twice', async () => {
    const { holdId } = await sendAndAuthorize();
    const hold = await getHold(holdId);
    await handleApprovalReturn(hold!.orderId!);
    expect(paypal.calls.filter((c) => c.path.endsWith('/authorize'))).toHaveLength(1);
    expect(paypal.auths.size).toBe(1);
  });

  it('cancel at PayPal expires the draft without any money movement', async () => {
    const sent = await sendMessage(message, { ipHash: 'test' });
    const msg = await getMessageByStatusToken(sent.statusToken);
    const hold = await getHoldByMessageId(msg!.id);
    await handleApprovalCancel(hold!.orderId!);
    const after = await getHold(hold!.id);
    expect(after?.state).toBe('EXPIRED');
    expect(after?.outcome).toBe('cancelled');
    expect(paypal.auths.size).toBe(0);
  });

  it('free lane: allowlisted domain skips the hold entirely', async () => {
    const sent = await sendMessage({ ...message, senderEmail: 'kim@friends.example' }, { ipHash: 'test' });
    expect(sent.lane).toBe('free');
    const msg = await getMessageByStatusToken(sent.statusToken);
    expect(msg?.deliveredAt).toBeTruthy();
    expect(await getHoldByMessageId(msg!.id)).toBeNull();
    expect(paypal.calls).toHaveLength(0);
  });

  it('abandoned checkout expires after the abandon window', async () => {
    const sent = await sendMessage(message, { ipHash: 'test' });
    const msg = await getMessageByStatusToken(sent.statusToken);
    const hold = await getHoldByMessageId(msg!.id);
    await db.query("UPDATE holds SET created_at = now() - interval '5 hours' WHERE id = $1", [hold!.id]);
    await sweep();
    const after = await getHold(hold!.id);
    expect(after?.state).toBe('EXPIRED');
    expect(after?.outcome).toBe('abandoned');
  });
});

describe('recipient actions', () => {
  it('Reply voids the hold: sender pays nothing, reply is stored', async () => {
    const { msg, holdId } = await sendAndAuthorize();
    const rid = (await getHold(holdId))!.recipientId;
    await recipientDecide(rid, msg.id, 'reply', { replyText: 'Happy to talk. Tuesday 10:00 works.' });
    const hold = await getHold(holdId);
    expect(hold?.state).toBe('VOIDED');
    expect(hold?.outcome).toBe('reply');
    expect(hold?.outcomeActor).toBe('recipient');
    expect(paypal.auths.get(hold!.authorizationId!)?.status).toBe('VOIDED');
    expect(paypal.captures.size).toBe(0);
    expect((await getMessageByStatusToken(msg.statusToken))?.replyText).toContain('Tuesday');
  });

  it('Worth it voids the hold', async () => {
    const { msg, holdId } = await sendAndAuthorize();
    const rid = (await getHold(holdId))!.recipientId;
    await recipientDecide(rid, msg.id, 'worth_it', {});
    const hold = await getHold(holdId);
    expect(hold?.state).toBe('VOIDED');
    expect(hold?.outcome).toBe('worth_it');
  });

  it('Spam requires explicit confirmation', async () => {
    const { msg, holdId } = await sendAndAuthorize();
    const rid = (await getHold(holdId))!.recipientId;
    await expectStampError(recipientDecide(rid, msg.id, 'spam', {}), 'confirm_required');
    expect((await getHold(holdId))?.state).toBe('AUTHORIZED');
    expect(paypal.captures.size).toBe(0);
  });

  it('Spam captures, then pays the net amount to the CHARITY, never the recipient', async () => {
    const { msg, holdId } = await sendAndAuthorize();
    const rid = (await getHold(holdId))!.recipientId;
    await recipientDecide(rid, msg.id, 'spam', { confirm: true, reason: 'bulk' });
    let hold = await getHold(holdId);
    expect(hold?.state).toBe('CAPTURED');
    expect(hold?.feeCents).toBe(66);
    expect(hold?.netCents).toBe(434);
    expect(hold?.payoutBatchId).toBeTruthy();
    const payout = [...paypal.payouts.values()][0]!;
    expect(payout.receiver).toBe('charity@example.test');
    expect(payout.amount).toBe('4.34');
    expect(payout.senderBatchId).toBe(`stamp-${holdId}`);
    // PayPal settles the payout; the reconciler records the donation.
    await reconcileHold(holdId);
    await reconcileHold(holdId);
    hold = await getHold(holdId);
    expect(hold?.state).toBe('DONATED');
    expect(hold?.donatedCents).toBe(434);
    expect(hold?.payoutFeeCents).toBe(25);
  });

  it('a decision on another recipient’s message is refused', async () => {
    const { msg } = await sendAndAuthorize();
    await expectStampError(recipientDecide('rcp_someone_else', msg.id, 'spam', { confirm: true, reason: 'bulk' }), 'not_found');
  });

  it('cannot decide twice', async () => {
    const { msg, holdId } = await sendAndAuthorize();
    const rid = (await getHold(holdId))!.recipientId;
    await recipientDecide(rid, msg.id, 'worth_it', {});
    await expectStampError(recipientDecide(rid, msg.id, 'spam', { confirm: true, reason: 'bulk' }), 'already_decided');
    expect(paypal.captures.size).toBe(0);
  });

  it('Reply and Spam racing each other: exactly one wins', async () => {
    const { msg, holdId } = await sendAndAuthorize();
    const rid = (await getHold(holdId))!.recipientId;
    const results = await Promise.allSettled([
      recipientDecide(rid, msg.id, 'reply', { replyText: 'hi' }),
      recipientDecide(rid, msg.id, 'spam', { confirm: true, reason: 'bulk' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const writes = paypal.writes().filter((c) => c.path.includes('/v2/payments/authorizations/'));
    expect(writes).toHaveLength(1);
  });
});

describe('timer', () => {
  it('auto-releases an untouched hold when the window ends', async () => {
    const { holdId } = await sendAndAuthorize();
    expect((await sweep()).released).toBe(0);
    await expireWindow(db, holdId);
    const summary = await sweep();
    expect(summary.released).toBe(1);
    const hold = await getHold(holdId);
    expect(hold?.state).toBe('VOIDED');
    expect(hold?.outcome).toBe('auto_release');
    expect(hold?.outcomeActor).toBe('timer');
  });

  it('Spam is refused once the window has ended (the timer owns that hold)', async () => {
    const { msg, holdId } = await sendAndAuthorize();
    const rid = (await getHold(holdId))!.recipientId;
    await expireWindow(db, holdId);
    await expectStampError(recipientDecide(rid, msg.id, 'spam', { confirm: true, reason: 'bulk' }), 'window_ended');
    expect(paypal.captures.size).toBe(0);
  });

  it('the timer never captures', async () => {
    const { holdId } = await sendAndAuthorize();
    await expireWindow(db, holdId);
    await sweep();
    await sweep();
    expect(paypal.captures.size).toBe(0);
    expect(paypal.payouts.size).toBe(0);
  });
});

describe('PayPal is the source of truth', () => {
  it('approval delivered by webhook (buyer never returned) still authorizes', async () => {
    const sent = await sendMessage(message, { ipHash: 'test' });
    const msg = await getMessageByStatusToken(sent.statusToken);
    const hold = await getHoldByMessageId(msg!.id);
    paypal.approve(hold!.orderId!);
    const out = await handleWebhookEvent({ id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: hold!.orderId } });
    expect(out.outcome).toBe('reconciled');
    expect((await getHold(hold!.id))?.state).toBe('AUTHORIZED');
  });

  it('a void made outside Stamp is mirrored, attributed to PayPal', async () => {
    const { holdId } = await sendAndAuthorize();
    const hold = await getHold(holdId);
    paypal.auths.get(hold!.authorizationId!)!.status = 'VOIDED';
    await reconcileHold(holdId);
    const after = await getHold(holdId);
    expect(after?.state).toBe('VOIDED');
    expect(after?.outcome).toBe('voided_at_paypal');
    expect(after?.outcomeActor).toBe('paypal');
  });

  it('every state change is in the ledger with its actor', async () => {
    const { msg, holdId } = await sendAndAuthorize();
    const rid = (await getHold(holdId))!.recipientId;
    await recipientDecide(rid, msg.id, 'worth_it', {});
    const events = await listEvents(holdId);
    const transitions = events.filter((e) => e.kind === 'transition').map((e) => `${e.fromState}->${e.toState}:${e.actor}`);
    expect(transitions).toEqual(['DRAFT->APPROVED:sender', 'APPROVED->AUTHORIZED:sender', 'AUTHORIZED->VOIDED:recipient']);
    expect(events.some((e) => e.kind === 'decision' && e.detail.action === 'worth_it')).toBe(true);
  });
});
