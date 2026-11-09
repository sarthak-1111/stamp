import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db';
import { handleWebhookEvent } from '@/lib/holds/service';
import { json } from '@/lib/http';
import { verifyWebhookSignature } from '@/lib/paypal/api';

export const dynamic = 'force-dynamic';
// PayPal calls and AI triage (run after the response via after()) need more than a 10 s default.
export const maxDuration = 60;

/**
 * PayPal webhooks. Every event is verified with PayPal (verify-webhook-signature) before anything
 * happens, and even then it is only a hint: the reconciler re-reads PayPal and applies only the
 * transitions the state machine allows. Processing is idempotent, so PayPal's retries are harmless.
 */
export async function POST(req: Request) {
  const { webhookId } = getConfig().paypal;
  if (!webhookId) return json({ error: 'webhooks_not_configured' }, 503);
  const rawBody = await req.text();
  if (rawBody.length > 100_000) return json({ error: 'too_large' }, 413);
  let event: { id?: string; event_type?: string; resource?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const verified = await verifyWebhookSignature({ headers: req.headers, rawBody, webhookId }).catch(() => false);
  if (!verified) return json({ error: 'signature_verification_failed' }, 400);

  const db = await getDb();
  const seen = await db.query('SELECT outcome FROM webhook_events WHERE id = $1', [String(event.id ?? '')]);
  if (seen[0]?.outcome === 'reconciled') return json({ ok: true, duplicate: true });
  try {
    const result = await handleWebhookEvent(event);
    await db.query(
      `INSERT INTO webhook_events (id, event_type, resource_id, verified, hold_id, outcome) VALUES ($1, $2, $3, true, $4, $5)
       ON CONFLICT (id) DO UPDATE SET outcome = EXCLUDED.outcome, hold_id = EXCLUDED.hold_id`,
      [String(event.id ?? `noid-${Date.now()}`), String(event.event_type ?? ''), String(event.resource?.id ?? ''), result.holdId, result.outcome],
    );
    return json({ ok: true, outcome: result.outcome });
  } catch (err) {
    console.error('[stamp] webhook processing failed', err);
    return json({ error: 'processing_failed' }, 500); // PayPal retries; processing is idempotent
  }
}
