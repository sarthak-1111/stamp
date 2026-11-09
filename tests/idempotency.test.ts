import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db';
import { getHold, getHoldByMessageId } from '@/lib/holds/repo';
import { handleApprovalReturn, reconcileHold, recipientDecide, sendMessage } from '@/lib/holds/service';
import { getMessageByStatusToken } from '@/lib/messages';
import { createPayout } from '@/lib/paypal/api';
import type { FakePayPal } from './fake-paypal';
import { makeRecipient, makeStale, setup } from './helpers';

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
  body: 'We are piloting grid battery storage and would value your advice on hiring.',
  inputFlags: [],
};

async function draft() {
  const sent = await sendMessage(message, { ipHash: 'test' });
  const msg = await getMessageByStatusToken(sent.statusToken);
  return { msg: msg!, hold: (await getHoldByMessageId(msg!.id))! };
}

async function authorized() {
  const { msg, hold } = await draft();
  paypal.approve(hold.orderId!);
  await handleApprovalReturn(hold.orderId!);
  return { msg, holdId: hold.id, recipientId: hold.recipientId };
}

describe('idempotency: PayPal-Request-Id is stored first and reused on every retry', () => {
  it('create order: a lost response is retried with the same key and yields ONE order', async () => {
    paypal.fail(/POST \/v2\/checkout\/orders$/, 'lost');
    const { hold } = await draft();
    expect(paypal.orders.size).toBe(1);
    expect(hold.orderId).toBe([...paypal.orders.keys()][0]);
    const creates = paypal.calls.filter((c) => c.path === '/v2/checkout/orders');
    expect(creates).toHaveLength(2);
    expect(creates[0]!.requestId).toBe(creates[1]!.requestId);
  });

  it('authorize: lost response leaves the hold pending; the reconciler finishes it with the same key', async () => {
    const { hold } = await draft();
    paypal.approve(hold.orderId!);
    paypal.fail(/\/authorize$/, 'lost');
    await handleApprovalReturn(hold.orderId!);
    let h = await getHold(hold.id);
    expect(h?.state).toBe('APPROVED');
    expect(h?.pendingOp).toBe('authorize');
    await makeStale(db, hold.id);
    await reconcileHold(hold.id);
    h = await getHold(hold.id);
    expect(h?.state).toBe('AUTHORIZED');
    expect(paypal.auths.size).toBe(1);
    const auths = paypal.calls.filter((c) => c.path.endsWith('/authorize'));
    expect(new Set(auths.map((c) => c.requestId)).size).toBe(1);
  });

  it('void: PayPal applied it but the response was lost; reconciler records it for the recipient', async () => {
    const { msg, holdId, recipientId } = await authorized();
    paypal.fail(/\/void$/, 'lost');
    await recipientDecide(recipientId, msg.id, 'reply', { replyText: 'Thanks!' });
    let h = await getHold(holdId);
    expect(h?.state).toBe('AUTHORIZED');
    expect(h?.pendingOp).toBe('void');
    await makeStale(db, holdId);
    await reconcileHold(holdId);
    h = await getHold(holdId);
    expect(h?.state).toBe('VOIDED');
    expect(h?.outcome).toBe('reply');
    expect(h?.outcomeActor).toBe('recipient');
  });

  it('capture: HTTP 500 (not applied) is retried with the same key, then donated once', async () => {
    const { msg, holdId, recipientId } = await authorized();
    paypal.fail(/\/capture$/, 'http500');
    await recipientDecide(recipientId, msg.id, 'spam', { confirm: true });
    expect((await getHold(holdId))?.pendingOp).toBe('capture');
    await makeStale(db, holdId);
    await reconcileHold(holdId);
    const h = await getHold(holdId);
    expect(h?.state).toBe('CAPTURED');
    expect(paypal.captures.size).toBe(1);
    const caps = paypal.calls.filter((c) => c.path.endsWith('/capture'));
    expect(caps).toHaveLength(2);
    expect(caps[0]!.requestId).toBe(caps[1]!.requestId);
    expect(paypal.payouts.size).toBe(1);
  });

  it('capture: applied but response lost; reconciler mirrors the capture and starts the donation', async () => {
    const { msg, holdId, recipientId } = await authorized();
    paypal.fail(/\/capture$/, 'lost');
    await recipientDecide(recipientId, msg.id, 'spam', { confirm: true });
    await makeStale(db, holdId);
    await reconcileHold(holdId);
    const h = await getHold(holdId);
    expect(h?.state).toBe('CAPTURED');
    expect(h?.outcome).toBe('spam');
    expect(paypal.captures.size).toBe(1);
    expect(paypal.payouts.size).toBe(1);
  });

  it('payout: lost response is replayed with the same key: ONE payout to the charity', async () => {
    const { msg, holdId, recipientId } = await authorized();
    paypal.fail(/POST \/v1\/payments\/payouts$/, 'lost');
    await recipientDecide(recipientId, msg.id, 'spam', { confirm: true });
    let h = await getHold(holdId);
    expect(h?.state).toBe('CAPTURED');
    expect(h?.pendingOp).toBe('payout');
    await makeStale(db, holdId);
    await reconcileHold(holdId);
    h = await getHold(holdId);
    expect(h?.payoutBatchId).toBeTruthy();
    expect(paypal.payouts.size).toBe(1);
    await reconcileHold(holdId);
    await reconcileHold(holdId);
    expect((await getHold(holdId))?.state).toBe('DONATED');
    expect(paypal.payouts.size).toBe(1);
  });

  it('payout: even a NEW request id cannot pay twice (deterministic sender_batch_id)', async () => {
    const args = { holdId: 'hold_x', receiverEmail: 'c@example.test', amountCents: 434, currency: 'USD', charityName: 'C' };
    const first = await createPayout({ ...args, requestId: 'key-1' });
    const second = await createPayout({ ...args, requestId: 'key-2' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(400);
    expect(paypal.payouts.size).toBe(1);
  });

  it('every PayPal write carries a PayPal-Request-Id', async () => {
    const { msg, recipientId } = await authorized();
    await recipientDecide(recipientId, msg.id, 'spam', { confirm: true });
    const writes = paypal.writes();
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const w of writes) expect(w.requestId, `${w.method} ${w.path}`).toBeTruthy();
  });
});
