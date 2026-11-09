import 'server-only';
import { runInBackground } from '@/lib/background';
import { aiEnabled } from '@/lib/config';
import { getDb, toIso, toJsonArray, type Row } from '@/lib/db';
import { callModel, combine } from './model';
import { ruleTriage, type Recommendation, type TriageInput, type TriageResult } from './rules';

/**
 * Triage lifecycle for a delivered message:
 *   1. Rule-based triage is written synchronously at delivery, so the inbox card is never empty.
 *   2. Model triage runs in the background and replaces it when (and only if) it validates.
 * Triage rows are read by the UI and copied into the ledger next to the human decision. No code path
 * reads triage to move money.
 */

export type Triage = {
  messageId: string;
  source: 'model' | 'rules';
  model: string | null;
  fitScore: number;
  fitReason: string;
  riskScore: number;
  riskReason: string;
  summary: string;
  draftReply: string;
  recommendation: Recommendation;
  injection: boolean;
  flags: string[];
  latencyMs: number | null;
  modelError: string | null;
  modelStartedAt: string | null;
  updatedAt: string;
};

function mapTriage(r: Row): Triage {
  return {
    messageId: String(r.message_id),
    source: r.source as 'model' | 'rules',
    model: r.model ? String(r.model) : null,
    fitScore: Number(r.fit_score),
    fitReason: String(r.fit_reason),
    riskScore: Number(r.risk_score),
    riskReason: String(r.risk_reason),
    summary: String(r.summary),
    draftReply: String(r.draft_reply),
    recommendation: r.recommendation as Recommendation,
    injection: Boolean(r.injection),
    flags: toJsonArray(r.flags),
    latencyMs: r.latency_ms === null || r.latency_ms === undefined ? null : Number(r.latency_ms),
    modelError: r.model_error ? String(r.model_error) : null,
    modelStartedAt: toIso(r.model_started_at),
    updatedAt: toIso(r.updated_at) ?? '',
  };
}

export async function getTriage(messageId: string): Promise<Triage | null> {
  const db = await getDb();
  const rows = await db.query('SELECT * FROM triage WHERE message_id = $1', [messageId]);
  return rows[0] ? mapTriage(rows[0]) : null;
}

async function loadInput(messageId: string): Promise<TriageInput | null> {
  const db = await getDb();
  const rows = await db.query(
    `SELECT m.sender_name, m.subject, m.body, m.input_flags, r.display_name, r.topics
       FROM messages m JOIN recipients r ON r.id = m.recipient_id WHERE m.id = $1`,
    [messageId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    recipient: { displayName: String(r.display_name), topics: toJsonArray(r.topics) },
    message: { senderName: String(r.sender_name), subject: String(r.subject), body: String(r.body), inputFlags: toJsonArray(r.input_flags) },
  };
}

function values(t: TriageResult) {
  return [t.fitScore, t.fitReason, t.riskScore, t.riskReason, t.summary, t.draftReply, t.recommendation, t.injection, JSON.stringify(t.flags)];
}

/** Called when a message becomes visible to the recipient (hold authorized, or free lane). */
export async function onDelivered(messageId: string): Promise<void> {
  const input = await loadInput(messageId);
  if (!input) return;
  const rules = ruleTriage(input);
  const db = await getDb();
  await db.query(
    `INSERT INTO triage (message_id, source, model, fit_score, fit_reason, risk_score, risk_reason, summary, draft_reply, recommendation, injection, flags)
     VALUES ($1, 'rules', NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (message_id) DO NOTHING`,
    [messageId, ...values(rules)],
  );
  if (aiEnabled()) runInBackground(() => runModelTriage(messageId));
}

export async function runModelTriage(messageId: string): Promise<void> {
  const db = await getDb();
  const claimed = await db.query(
    `UPDATE triage SET model_started_at = now()
      WHERE message_id = $1 AND source = 'rules' AND (model_started_at IS NULL OR model_started_at < now() - interval '5 minutes')
     RETURNING message_id`,
    [messageId],
  );
  if (!claimed.length) return;
  const input = await loadInput(messageId);
  if (!input) return;
  const rules = ruleTriage(input);
  const result = await callModel(input);
  if (!result.ok) {
    await db.query('UPDATE triage SET model_error = $2, latency_ms = $3, updated_at = now() WHERE message_id = $1', [messageId, result.error, result.latencyMs]);
    return;
  }
  const final = combine(result.output, rules);
  await db.query(
    `UPDATE triage SET source = 'model', model = $11, fit_score = $2, fit_reason = $3, risk_score = $4, risk_reason = $5,
            summary = $6, draft_reply = $7, recommendation = $8, injection = $9, flags = $10::jsonb,
            latency_ms = $12, model_error = NULL, updated_at = now()
      WHERE message_id = $1`,
    [messageId, ...values(final), result.model, result.latencyMs],
  );
}

/** Inbox visit: retry model triage for recent messages that only have the rule-based result. */
export async function ensureModelTriage(messageIds: string[]): Promise<void> {
  if (!aiEnabled() || !messageIds.length) return;
  const db = await getDb();
  const rows = await db.query<{ message_id: string }>(
    `SELECT message_id FROM triage
      WHERE message_id = ANY($1::text[]) AND source = 'rules' AND created_at > now() - interval '1 day'
        AND (model_started_at IS NULL OR model_started_at < now() - interval '5 minutes')
      LIMIT 3`,
    [messageIds],
  );
  for (const r of rows) runInBackground(() => runModelTriage(r.message_id));
}
