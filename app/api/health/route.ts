import { aiEnabled, getConfig } from '@/lib/config';
import { getDb } from '@/lib/db';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = getConfig();
  let db = 'down';
  try {
    const conn = await getDb();
    await conn.query('SELECT 1');
    db = conn.kind;
  } catch {
    // reported below
  }
  return json({
    ok: db !== 'down',
    db,
    paypal: { env: cfg.paypal.env, configured: Boolean(cfg.paypal.clientId && cfg.paypal.clientSecret), webhooks: Boolean(cfg.paypal.webhookId) },
    ai: { configured: aiEnabled(), model: aiEnabled() ? cfg.ai.model : null },
    charities: cfg.charities.length,
    time: new Date().toISOString(),
  });
}
