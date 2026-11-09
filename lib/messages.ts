import 'server-only';
import type { SpamReason, Via } from '@/lib/copy';
import { getDb, toIso, toJsonArray, type Row } from '@/lib/db';

/** reply / worth_it / spam decide a message; grant / decline answer a free-pass request. */
export type Decision = 'reply' | 'worth_it' | 'spam' | 'grant' | 'decline';
export type Lane = 'hold' | 'free' | 'request';

export type Message = {
  id: string;
  recipientId: string;
  lane: Lane;
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  inputFlags: string[];
  statusToken: string;
  createdAt: string;
  deliveredAt: string | null;
  decision: Decision | null;
  decisionReason: SpamReason | null;
  decidedAt: string | null;
  replyText: string | null;
  via: Via;
  agentName: string | null;
};

export function mapMessage(r: Row): Message {
  return {
    id: String(r.id),
    recipientId: String(r.recipient_id),
    lane: r.lane as Lane,
    senderName: String(r.sender_name),
    senderEmail: String(r.sender_email),
    subject: String(r.subject),
    body: String(r.body),
    inputFlags: toJsonArray(r.input_flags),
    statusToken: String(r.status_token),
    createdAt: toIso(r.created_at) ?? '',
    deliveredAt: toIso(r.delivered_at),
    decision: (r.decision as Decision | null) ?? null,
    decisionReason: (r.decision_reason as SpamReason | null) ?? null,
    decidedAt: toIso(r.decided_at),
    replyText: r.reply_text === null || r.reply_text === undefined ? null : String(r.reply_text),
    via: ((r.via as Via | null) ?? 'web') as Via,
    agentName: r.agent_name === null || r.agent_name === undefined ? null : String(r.agent_name),
  };
}

export async function getMessage(id: string): Promise<Message | null> {
  const db = await getDb();
  const rows = await db.query('SELECT * FROM messages WHERE id = $1', [id]);
  return rows[0] ? mapMessage(rows[0]) : null;
}

export async function getMessageByStatusToken(token: string): Promise<Message | null> {
  if (!token || token.length > 64) return null;
  const db = await getDb();
  const rows = await db.query('SELECT * FROM messages WHERE status_token = $1', [token]);
  return rows[0] ? mapMessage(rows[0]) : null;
}

/** Records the recipient's decision exactly once. Returns false if a decision already exists. */
export async function recordDecision(id: string, decision: Decision, replyText: string | null, reason: SpamReason | null = null): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    'UPDATE messages SET decision = $2, decided_at = now(), reply_text = $3, decision_reason = $4 WHERE id = $1 AND decision IS NULL RETURNING id',
    [id, decision, replyText, decision === 'spam' ? reason : null],
  );
  return rows.length > 0;
}
