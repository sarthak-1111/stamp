/**
 * In-memory PayPal used by the unit tests. It mimics the sandbox behaviour recorded in
 * docs/evidence/gonogo-run.json: PayPal-Request-Id replays return the original response, a voided
 * authorization cannot be captured, a captured one cannot be captured again, and a reused
 * sender_batch_id is rejected.
 */
import { PayPalUnknownOutcomeError, type PayPalRequest, type PayPalResult, type PayPalTransport } from '@/lib/paypal/client';

type Order = {
  id: string;
  status: 'PAYER_ACTION_REQUIRED' | 'APPROVED' | 'COMPLETED' | 'VOIDED';
  amount: { currency_code: string; value: string };
  customId: string;
  authorizationId?: string;
  payer?: { name: { given_name: string; surname: string }; email_address: string; payer_id: string };
};
type Authorization = { id: string; orderId: string; status: 'CREATED' | 'VOIDED' | 'CAPTURED' | 'EXPIRED'; create_time: string; expiration_time: string; amount: { currency_code: string; value: string }; captureId?: string };
type Capture = { id: string; authorizationId: string; status: 'COMPLETED' | 'PENDING' | 'DECLINED'; gross: number; fee: number };
type Payout = { batchId: string; senderBatchId: string; amount: string; receiver: string; polls: number; itemId: string };

export type Fault = 'network' | 'http500' | 'lost';

export class FakePayPal {
  orders = new Map<string, Order>();
  auths = new Map<string, Authorization>();
  captures = new Map<string, Capture>();
  payouts = new Map<string, Payout>();
  replays = new Map<string, PayPalResult>();
  calls: Array<{ method: string; path: string; requestId?: string }> = [];
  faults: Array<{ match: RegExp; fault: Fault }> = [];
  /** Payout batches report PENDING for this many GETs, then SUCCESS. */
  payoutPollsUntilSuccess = 1;
  nextCaptureStatus: Capture['status'] = 'COMPLETED';
  private seq = 1000;

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}${this.seq}X${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  fail(match: RegExp, fault: Fault) {
    this.faults.push({ match, fault });
  }

  /** The buyer approves the order on PayPal's page. */
  approve(orderId: string) {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`no order ${orderId}`);
    o.status = 'APPROVED';
    o.payer = { name: { given_name: 'John', surname: 'Doe' }, email_address: 'buyer@example.test', payer_id: 'PAYERTEST01' };
  }

  writes() {
    return this.calls.filter((c) => c.method === 'POST' && !c.path.includes('verify-webhook-signature'));
  }

  transport: PayPalTransport = async (req: PayPalRequest) => {
    this.calls.push({ method: req.method, path: req.path, requestId: req.requestId });
    const faultIdx = this.faults.findIndex((f) => f.match.test(`${req.method} ${req.path}`));
    const fault = faultIdx >= 0 ? this.faults.splice(faultIdx, 1)[0]!.fault : null;
    if (fault === 'network') throw new PayPalUnknownOutcomeError('simulated network failure (request never arrived)');
    if (fault === 'http500') throw new PayPalUnknownOutcomeError('simulated HTTP 500');
    const replayKey = req.requestId ? `${req.path}|${req.requestId}` : null;
    let res: PayPalResult;
    if (replayKey && this.replays.has(replayKey)) {
      res = this.replays.get(replayKey)!;
    } else {
      res = this.handle(req);
      if (replayKey && res.status < 500) this.replays.set(replayKey, res);
    }
    if (fault === 'lost') throw new PayPalUnknownOutcomeError('simulated lost response (PayPal applied the request)');
    return structuredClone(res);
  };

  private ok(status: number, json: unknown): PayPalResult {
    return { status, ok: status >= 200 && status < 300, json, debugId: 'fake-debug' };
  }
  private err(status: number, name: string, issue: string): PayPalResult {
    return { status, ok: false, json: { name, details: [{ issue }], message: issue }, debugId: 'fake-debug' };
  }

  private orderJson(o: Order) {
    const a = o.authorizationId ? this.auths.get(o.authorizationId) : undefined;
    const c = a?.captureId ? this.captures.get(a.captureId) : undefined;
    return {
      id: o.id,
      intent: 'AUTHORIZE',
      status: o.status,
      payer: o.payer,
      purchase_units: [
        {
          custom_id: o.customId,
          amount: o.amount,
          payments: a
            ? {
                authorizations: [{ id: a.id, status: a.status, create_time: a.create_time, expiration_time: a.expiration_time, amount: a.amount }],
                ...(c ? { captures: [{ id: c.id, status: c.status }] } : {}),
              }
            : undefined,
        },
      ],
      links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${o.id}` }],
    };
  }

  private captureJson(c: Capture) {
    const net = Math.round((c.gross - c.fee) * 100) / 100;
    return {
      id: c.id,
      status: c.status,
      final_capture: true,
      amount: { currency_code: 'USD', value: c.gross.toFixed(2) },
      seller_receivable_breakdown: {
        gross_amount: { currency_code: 'USD', value: c.gross.toFixed(2) },
        paypal_fee: { currency_code: 'USD', value: c.fee.toFixed(2) },
        net_amount: { currency_code: 'USD', value: net.toFixed(2) },
      },
    };
  }

  private handle(req: PayPalRequest): PayPalResult {
    const p = req.path;
    const body = (req.rawBody ? JSON.parse(req.rawBody) : req.body) as Record<string, any> | undefined;
    let m: RegExpMatchArray | null;

    if (req.method === 'POST' && p === '/v2/checkout/orders') {
      const pu = body?.purchase_units?.[0];
      if (body?.intent !== 'AUTHORIZE') return this.err(422, 'UNPROCESSABLE_ENTITY', 'INTENT_NOT_SUPPORTED_BY_FAKE');
      const o: Order = { id: this.id('ORD'), status: 'PAYER_ACTION_REQUIRED', amount: pu.amount, customId: pu.custom_id };
      this.orders.set(o.id, o);
      return this.ok(200, this.orderJson(o));
    }
    if ((m = p.match(/^\/v2\/checkout\/orders\/([^/]+)$/)) && req.method === 'GET') {
      const o = this.orders.get(m[1]!);
      return o ? this.ok(200, this.orderJson(o)) : this.err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
    }
    if ((m = p.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/)) && req.method === 'POST') {
      const o = this.orders.get(m[1]!);
      if (!o) return this.err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (o.status === 'COMPLETED') return this.err(422, 'UNPROCESSABLE_ENTITY', 'ORDER_ALREADY_AUTHORIZED');
      if (o.status !== 'APPROVED') return this.err(422, 'UNPROCESSABLE_ENTITY', 'ORDER_NOT_APPROVED');
      const now = new Date();
      const a: Authorization = {
        id: this.id('AUTH'),
        orderId: o.id,
        status: 'CREATED',
        create_time: now.toISOString(),
        expiration_time: new Date(now.getTime() + 29 * 86_400_000).toISOString(),
        amount: o.amount,
      };
      this.auths.set(a.id, a);
      o.authorizationId = a.id;
      o.status = 'COMPLETED';
      return this.ok(201, this.orderJson(o));
    }
    if ((m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)$/)) && req.method === 'GET') {
      const a = this.auths.get(m[1]!);
      return a ? this.ok(200, { id: a.id, status: a.status, create_time: a.create_time, expiration_time: a.expiration_time, amount: a.amount }) : this.err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
    }
    if ((m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)\/void$/)) && req.method === 'POST') {
      const a = this.auths.get(m[1]!);
      if (!a) return this.err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (a.status === 'VOIDED') return this.err(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_VOIDED');
      if (a.status === 'CAPTURED') return this.err(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_ALREADY_CAPTURED');
      if (a.status === 'EXPIRED') return this.err(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_EXPIRED');
      a.status = 'VOIDED';
      return this.ok(200, { id: a.id, status: 'VOIDED' });
    }
    if ((m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)\/capture$/)) && req.method === 'POST') {
      const a = this.auths.get(m[1]!);
      if (!a) return this.err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      if (a.status === 'VOIDED') return this.err(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_VOIDED');
      if (a.status === 'CAPTURED') return this.err(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_ALREADY_CAPTURED');
      if (a.status === 'EXPIRED') return this.err(422, 'UNPROCESSABLE_ENTITY', 'AUTHORIZATION_EXPIRED');
      const gross = Number(a.amount.value);
      const c: Capture = { id: this.id('CAP'), authorizationId: a.id, status: this.nextCaptureStatus, gross, fee: Math.round((gross * 0.0349 + 0.49) * 100) / 100 };
      this.captures.set(c.id, c);
      if (c.status !== 'DECLINED') {
        a.status = 'CAPTURED';
        a.captureId = c.id;
      }
      return this.ok(201, this.captureJson(c));
    }
    if ((m = p.match(/^\/v2\/payments\/captures\/([^/]+)$/)) && req.method === 'GET') {
      const c = this.captures.get(m[1]!);
      return c ? this.ok(200, this.captureJson(c)) : this.err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
    }
    if (req.method === 'POST' && p === '/v1/payments/payouts') {
      const senderBatchId = body?.sender_batch_header?.sender_batch_id;
      if ([...this.payouts.values()].some((x) => x.senderBatchId === senderBatchId)) {
        return { status: 400, ok: false, json: { name: 'USER_BUSINESS_ERROR', message: 'Batch with given sender_batch_id already exists' }, debugId: 'fake-debug' };
      }
      const item = body?.items?.[0];
      const po: Payout = { batchId: this.id('PB'), senderBatchId, amount: item.amount.value, receiver: item.receiver, polls: 0, itemId: this.id('PI') };
      this.payouts.set(po.batchId, po);
      return this.ok(201, { batch_header: { payout_batch_id: po.batchId, batch_status: 'PENDING', sender_batch_header: { sender_batch_id: senderBatchId } } });
    }
    if ((m = p.match(/^\/v1\/payments\/payouts\/([^/]+)$/)) && req.method === 'GET') {
      const po = this.payouts.get(m[1]!);
      if (!po) return this.err(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID');
      po.polls += 1;
      const done = po.polls > this.payoutPollsUntilSuccess;
      return this.ok(200, {
        batch_header: { payout_batch_id: po.batchId, batch_status: done ? 'SUCCESS' : 'PENDING', amount: { value: po.amount, currency: 'USD' }, fees: { value: '0.25', currency: 'USD' } },
        items: [
          {
            payout_item_id: po.itemId,
            transaction_status: done ? 'SUCCESS' : 'PENDING',
            payout_item_fee: { currency: 'USD', value: '0.25' },
            payout_item: { amount: { value: po.amount, currency: 'USD' }, receiver: po.receiver },
          },
        ],
      });
    }
    if (req.method === 'POST' && p === '/v1/notifications/verify-webhook-signature') {
      return this.ok(200, { verification_status: body?.transmission_sig === 'valid-signature' ? 'SUCCESS' : 'FAILURE' });
    }
    return this.err(404, 'NOT_FOUND', `FAKE_NO_ROUTE ${req.method} ${p}`);
  };
}
