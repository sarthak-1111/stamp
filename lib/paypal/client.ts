import 'server-only';
import { getConfig } from '@/lib/config';

/**
 * Thin PayPal REST transport (sandbox only). Every write carries a PayPal-Request-Id that the caller
 * persisted BEFORE sending, so a retry after a timeout replays the same request instead of repeating it.
 */

export type PayPalRequest = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Pre-serialised JSON body (used to forward a webhook event byte-for-byte). */
  rawBody?: string;
  requestId?: string;
  prefer?: 'return=representation' | 'return=minimal';
};

// PayPal JSON is untyped at this boundary; callers narrow it with the parse helpers in api.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PayPalJson = any;

export type PayPalResult = { status: number; ok: boolean; json: PayPalJson; debugId: string | null };

export type PayPalTransport = (req: PayPalRequest) => Promise<PayPalResult>;

/** The request may or may not have reached PayPal: the outcome is unknown, so keep the operation pending. */
export class PayPalUnknownOutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayPalUnknownOutcomeError';
  }
}

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(force = false): Promise<string> {
  if (!force && tokenCache && Date.now() < tokenCache.expiresAt - 120_000) return tokenCache.token;
  const { paypal } = getConfig();
  if (!paypal.clientId || !paypal.clientSecret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set');
  const res = await fetch(`${paypal.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${paypal.clientId}:${paypal.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`PayPal OAuth failed (${res.status} ${json.error ?? ''})`);
  tokenCache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3000) * 1000 };
  return json.access_token;
}

const fetchTransport: PayPalTransport = async (req) => {
  const { paypal } = getConfig();
  const send = async (token: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (req.method === 'POST') headers['Content-Type'] = 'application/json';
    if (req.requestId) headers['PayPal-Request-Id'] = req.requestId;
    if (req.prefer) headers.Prefer = req.prefer;
    const body = req.rawBody ?? (req.body === undefined ? undefined : JSON.stringify(req.body));
    return fetch(`${paypal.apiBase}${req.path}`, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(25_000),
      cache: 'no-store',
    });
  };
  let res: Response;
  try {
    res = await send(await getAccessToken());
    if (res.status === 401) res = await send(await getAccessToken(true));
  } catch (err) {
    throw new PayPalUnknownOutcomeError(`PayPal ${req.method} ${req.path} did not complete: ${String(err).slice(0, 200)}`);
  }
  const text = await res.text();
  let json: PayPalJson = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (res.status >= 500) {
    // PayPal's docs: a 5xx may or may not have been applied; retry with the same PayPal-Request-Id.
    throw new PayPalUnknownOutcomeError(`PayPal ${req.method} ${req.path} returned ${res.status}`);
  }
  return { status: res.status, ok: res.ok, json, debugId: res.headers.get('paypal-debug-id') };
};

let transport: PayPalTransport = fetchTransport;

/** Tests swap in an in-memory PayPal. */
export function setPayPalTransport(t: PayPalTransport | null): void {
  transport = t ?? fetchTransport;
}

export function paypalRequest(req: PayPalRequest): Promise<PayPalResult> {
  return transport(req);
}

/** First `issue` code from a PayPal error body, e.g. AUTHORIZATION_VOIDED. */
export function issueOf(res: PayPalResult): string {
  const j = res.json ?? {};
  return String(j.details?.[0]?.issue ?? j.name ?? j.error ?? `HTTP_${res.status}`);
}
