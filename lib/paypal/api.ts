import 'server-only';
import { centsToValue, valueToCents } from '@/lib/money';
import { paypalRequest, type PayPalJson, type PayPalResult } from './client';

/**
 * The PayPal REST calls Stamp makes. All money-moving calls take a persisted PayPal-Request-Id.
 *   Orders v2:    create (intent AUTHORIZE), authorize
 *   Payments v2:  get/void/capture authorization, get capture
 *   Payouts v1:   create batch, get batch
 *   Webhooks v1:  verify-webhook-signature
 * Order reads go through the PayPal Agent Toolkit (see toolkit.ts).
 */

export function createOrder(p: {
  holdId: string;
  amountCents: number;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
}): Promise<PayPalResult> {
  return paypalRequest({
    method: 'POST',
    path: '/v2/checkout/orders',
    requestId: p.requestId,
    prefer: 'return=representation',
    body: {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: p.holdId,
          custom_id: p.holdId,
          description: p.description.slice(0, 127),
          soft_descriptor: 'STAMP HOLD',
          amount: { currency_code: p.currency, value: centsToValue(p.amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Stamp (sandbox)',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'CONTINUE',
            return_url: p.returnUrl,
            cancel_url: p.cancelUrl,
          },
        },
      },
    },
  });
}

export function authorizeOrder(orderId: string, requestId: string): Promise<PayPalResult> {
  return paypalRequest({
    method: 'POST',
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
    body: {},
    requestId,
    prefer: 'return=representation',
  });
}

export function getOrderRest(orderId: string): Promise<PayPalResult> {
  return paypalRequest({ method: 'GET', path: `/v2/checkout/orders/${encodeURIComponent(orderId)}` });
}

export function getAuthorization(authorizationId: string): Promise<PayPalResult> {
  return paypalRequest({ method: 'GET', path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}` });
}

export function voidAuthorization(authorizationId: string, requestId: string): Promise<PayPalResult> {
  return paypalRequest({
    method: 'POST',
    path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
    requestId,
    prefer: 'return=representation',
  });
}

export function captureAuthorization(authorizationId: string, requestId: string, noteToPayer: string): Promise<PayPalResult> {
  return paypalRequest({
    method: 'POST',
    path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    requestId,
    prefer: 'return=representation',
    body: { final_capture: true, note_to_payer: noteToPayer.slice(0, 255) },
  });
}

export function getCapture(captureId: string): Promise<PayPalResult> {
  return paypalRequest({ method: 'GET', path: `/v2/payments/captures/${encodeURIComponent(captureId)}` });
}

/** Deterministic per hold: PayPal rejects a reused sender_batch_id for 30 days, so a donation can never be paid twice. */
export function senderBatchIdFor(holdId: string): string {
  return `stamp-${holdId}`;
}

export function createPayout(p: {
  holdId: string;
  requestId: string;
  receiverEmail: string;
  amountCents: number;
  currency: string;
  charityName: string;
}): Promise<PayPalResult> {
  return paypalRequest({
    method: 'POST',
    path: '/v1/payments/payouts',
    requestId: p.requestId,
    body: {
      sender_batch_header: {
        sender_batch_id: senderBatchIdFor(p.holdId),
        recipient_type: 'EMAIL',
        email_subject: 'A donation from a Stamp hold',
        email_message: 'A message sent through Stamp was marked as spam. Its refundable hold was captured and donated to you.',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          receiver: p.receiverEmail,
          amount: { value: centsToValue(p.amountCents), currency: p.currency },
          note: `Stamp donation to ${p.charityName} (sandbox)`,
          sender_item_id: p.holdId,
        },
      ],
    },
  });
}

export function getPayoutBatch(batchId: string): Promise<PayPalResult> {
  return paypalRequest({ method: 'GET', path: `/v1/payments/payouts/${encodeURIComponent(batchId)}` });
}

/**
 * Post-back verification. The event body is forwarded byte-for-byte (rawBody) so that re-serialising
 * the JSON cannot change what PayPal checks the signature against.
 */
export async function verifyWebhookSignature(p: {
  headers: Headers;
  rawBody: string;
  webhookId: string;
}): Promise<boolean> {
  const h = (name: string) => p.headers.get(name) ?? '';
  const required = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
  if (!p.webhookId || required.some((n) => !h(n))) return false;
  const envelope =
    `{"auth_algo":${JSON.stringify(h('paypal-auth-algo'))},` +
    `"cert_url":${JSON.stringify(h('paypal-cert-url'))},` +
    `"transmission_id":${JSON.stringify(h('paypal-transmission-id'))},` +
    `"transmission_sig":${JSON.stringify(h('paypal-transmission-sig'))},` +
    `"transmission_time":${JSON.stringify(h('paypal-transmission-time'))},` +
    `"webhook_id":${JSON.stringify(p.webhookId)},` +
    `"webhook_event":${p.rawBody}}`;
  const res = await paypalRequest({ method: 'POST', path: '/v1/notifications/verify-webhook-signature', rawBody: envelope });
  return res.ok && res.json?.verification_status === 'SUCCESS';
}

// ---------------------------------------------------------------- parsing helpers

export type ParsedAuthorization = {
  id: string;
  status: string;
  createTime: string | null;
  expirationTime: string | null;
};

export function authorizationFromOrder(order: PayPalJson): ParsedAuthorization | null {
  const a = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!a?.id) return null;
  return { id: String(a.id), status: String(a.status), createTime: a.create_time ?? null, expirationTime: a.expiration_time ?? null };
}

export function captureIdFromOrder(order: PayPalJson): string | null {
  const c = order?.purchase_units?.[0]?.payments?.captures?.[0];
  return c?.id ? String(c.id) : null;
}

export function payerFromOrder(order: PayPalJson): { name: string | null; email: string | null; payerId: string | null } {
  const payer = order?.payer ?? order?.payment_source?.paypal ?? {};
  const given = payer?.name?.given_name ?? '';
  const surname = payer?.name?.surname ?? '';
  const name = `${given} ${surname}`.trim();
  return {
    name: name || null,
    email: payer?.email_address ?? null,
    payerId: payer?.payer_id ?? payer?.account_id ?? null,
  };
}

export type ParsedCapture = {
  id: string;
  status: string;
  grossCents: number | null;
  feeCents: number | null;
  netCents: number | null;
};

export function parseCapture(c: PayPalJson): ParsedCapture | null {
  if (!c?.id) return null;
  const b = c.seller_receivable_breakdown ?? {};
  return {
    id: String(c.id),
    status: String(c.status),
    grossCents: valueToCents(b.gross_amount?.value ?? c.amount?.value),
    feeCents: valueToCents(b.paypal_fee?.value),
    netCents: valueToCents(b.net_amount?.value),
  };
}

export type ParsedPayout = {
  batchId: string;
  batchStatus: string;
  itemId: string | null;
  itemStatus: string | null;
  amountCents: number | null;
  feeCents: number | null;
};

export function parsePayoutBatch(j: PayPalJson): ParsedPayout | null {
  const header = j?.batch_header;
  if (!header?.payout_batch_id) return null;
  const item = j.items?.[0];
  return {
    batchId: String(header.payout_batch_id),
    batchStatus: String(header.batch_status),
    itemId: item?.payout_item_id ?? null,
    itemStatus: item?.transaction_status ?? null,
    amountCents: valueToCents(item?.payout_item?.amount?.value ?? header.amount?.value),
    feeCents: valueToCents(item?.payout_item_fee?.value ?? header.fees?.value),
  };
}
