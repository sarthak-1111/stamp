import 'server-only';
import { getCharity, releaseOptions } from '@/lib/config';
import { getDb, toIso, toJsonArray, type Row } from '@/lib/db';
import { OUTCOME_COPY, STATE_COPY, type HoldState, type Outcome } from '@/lib/holds/machine';
import { listEvents, mapHold, type Hold, type HoldEventRow } from '@/lib/holds/repo';
import { mapMessage, type Message } from '@/lib/messages';
import { formatMoney } from '@/lib/money';
import type { Recipient } from '@/lib/recipients';
import { getRecipientByHandle } from '@/lib/recipients';
import type { Triage } from '@/lib/triage/pipeline';

/** Plain, serialisable view models for pages and client components. */

export function windowLabel(minutes: number): string {
  const known = releaseOptions().find((o) => o.minutes === minutes);
  if (known) return known.label.replace(' (demo)', '');
  if (minutes < 60) return `${minutes} minutes`;
  const h = minutes / 60;
  return `${h} hour${h === 1 ? '' : 's'}`;
}

export type PublicPage = {
  handle: string;
  displayName: string;
  bio: string;
  topics: string[];
  holdCents: number;
  currency: string;
  releaseMinutes: number;
  releaseLabel: string;
  charity: { name: string; blurb: string } | null;
  hasFreeLane: boolean;
};

export async function getPublicPage(handle: string): Promise<PublicPage | null> {
  const r = await getRecipientByHandle(handle);
  if (!r) return null;
  const charity = getCharity(r.charityId);
  return {
    handle: r.handle,
    displayName: r.displayName,
    bio: r.bio,
    topics: r.topics,
    holdCents: r.holdCents,
    currency: r.currency,
    releaseMinutes: r.releaseMinutes,
    releaseLabel: windowLabel(r.releaseMinutes),
    charity: charity ? { name: charity.name, blurb: charity.blurb } : null,
    hasFreeLane: r.freeLane.length > 0,
  };
}

export type HoldView = {
  state: HoldState;
  stateLabel: string;
  tone: (typeof STATE_COPY)[HoldState]['tone'];
  amountCents: number;
  currency: string;
  releaseAt: string | null;
  authorizedAt: string | null;
  lastVerifiedAt: string | null;
  pendingOp: Hold['pendingOp'];
  outcome: Outcome | null;
  outcomeLabel: string | null;
  feeCents: number | null;
  netCents: number | null;
  donatedCents: number | null;
  payoutFeeCents: number | null;
  payoutStatus: string | null;
  charityName: string;
  payerName: string | null;
  failureReason: string | null;
};

export function holdView(h: Hold): HoldView {
  return {
    state: h.state,
    stateLabel: STATE_COPY[h.state].label,
    tone: STATE_COPY[h.state].tone,
    amountCents: h.amountCents,
    currency: h.currency,
    releaseAt: h.releaseAt,
    authorizedAt: h.authorizedAt,
    lastVerifiedAt: h.lastVerifiedAt,
    pendingOp: h.pendingOp,
    outcome: h.outcome,
    outcomeLabel: h.outcome ? OUTCOME_COPY[h.outcome] : null,
    feeCents: h.feeCents,
    netCents: h.netCents,
    donatedCents: h.donatedCents,
    payoutFeeCents: h.payoutFeeCents,
    payoutStatus: h.payoutStatus,
    charityName: getCharity(h.charityId)?.name ?? 'the charity',
    payerName: shortName(h.payerName),
    failureReason: h.failureReason,
  };
}

/** "John Doe" -> "John D." (the payer's PayPal name is a trust signal, not something to publish in full). */
export function shortName(name: string | null): string | null {
  if (!name) return null;
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.pop();
  return last ? `${first} ${last[0]}.` : (first ?? null);
}

export type TimelineItem = { at: string; title: string; detail?: string; tone: 'neutral' | 'held' | 'good' | 'donated' | 'bad' };

export function buildTimeline(events: HoldEventRow[], h: Hold, recipientName: string): TimelineItem[] {
  const amount = formatMoney(h.amountCents, h.currency);
  const charity = getCharity(h.charityId)?.name ?? 'the charity';
  const items: TimelineItem[] = [];
  for (const e of events) {
    if (e.kind === 'created') items.push({ at: e.at, title: 'Message written, PayPal checkout started', tone: 'neutral' });
    if (e.kind !== 'transition') continue;
    const outcome = (e.detail.outcome as Outcome | undefined) ?? null;
    const key = `${e.fromState}->${e.toState}`;
    if (key === 'DRAFT->APPROVED') items.push({ at: e.at, title: `Approved in PayPal${h.payerName ? ` by ${shortName(h.payerName)}` : ''}`, tone: 'neutral' });
    else if (key === 'APPROVED->AUTHORIZED')
      items.push({ at: e.at, title: `${amount} held, not charged`, detail: `PayPal authorized the hold. Your message was delivered to ${recipientName}.`, tone: 'held' });
    else if (e.toState === 'VOIDED') {
      const why: Record<string, string> = {
        reply: `${recipientName} replied.`,
        worth_it: `${recipientName} marked your message as worth it.`,
        auto_release: 'The window ended, so the hold was released automatically.',
        voided_at_paypal: 'The authorization was voided at PayPal.',
      };
      items.push({ at: e.at, title: 'Hold released. You paid nothing.', detail: outcome ? why[outcome] : undefined, tone: 'good' });
    } else if (key === 'AUTHORIZED->CAPTURED') {
      const fee = typeof e.detail.fee_cents === 'number' ? ` PayPal kept a ${formatMoney(e.detail.fee_cents as number)} fee.` : '';
      items.push({
        at: e.at,
        title: outcome === 'spam' ? `Marked as spam. ${amount} captured for ${charity}.` : `${amount} captured at PayPal.`,
        detail: `${recipientName} receives nothing.${fee}`,
        tone: 'donated',
      });
    } else if (key === 'CAPTURED->DONATED') {
      const donated = typeof e.detail.donated_cents === 'number' ? formatMoney(e.detail.donated_cents as number) : 'The net amount';
      items.push({ at: e.at, title: `${donated} donated to ${charity}`, detail: 'Paid out with PayPal Payouts. Stamp covered the payout fee.', tone: 'donated' });
    } else if (e.toState === 'EXPIRED') {
      items.push({ at: e.at, title: outcome === 'cancelled' ? 'Checkout cancelled at PayPal. Nothing was held.' : 'PayPal approval was not completed. Nothing was held.', tone: 'neutral' });
    } else if (e.toState === 'FAILED') {
      items.push({ at: e.at, title: outcome ? OUTCOME_COPY[outcome] : 'Something went wrong', detail: h.failureReason ?? undefined, tone: 'bad' });
    }
  }
  return items;
}

export type StatusView = {
  token: string;
  lane: 'hold' | 'free';
  subject: string;
  createdAt: string;
  recipient: { handle: string; displayName: string };
  replyText: string | null;
  decidedAt: string | null;
  decision: Message['decision'];
  hold: HoldView | null;
  approveUrl: string | null;
  timeline: TimelineItem[];
};

export async function getStatusView(token: string): Promise<StatusView | null> {
  const db = await getDb();
  const rows = await db.query(
    `SELECT m.*, r.handle AS r_handle, r.display_name AS r_name FROM messages m JOIN recipients r ON r.id = m.recipient_id WHERE m.status_token = $1`,
    [token],
  );
  const row = rows[0];
  if (!row) return null;
  const msg = mapMessage(row);
  const recipientName = String(row.r_name);
  const holdRows = await db.query('SELECT * FROM holds WHERE message_id = $1', [msg.id]);
  const hold = holdRows[0] ? mapHold(holdRows[0]) : null;
  const timeline = hold ? buildTimeline(await listEvents(hold.id), hold, recipientName) : [{ at: msg.createdAt, title: 'Delivered through the free lane. No hold needed.', tone: 'good' as const }];
  if (msg.decision === 'reply' && msg.decidedAt && !hold) timeline.push({ at: msg.decidedAt, title: `${recipientName} replied`, tone: 'good' });
  return {
    token,
    lane: msg.lane,
    subject: msg.subject,
    createdAt: msg.createdAt,
    recipient: { handle: String(row.r_handle), displayName: recipientName },
    replyText: msg.decision === 'reply' ? msg.replyText : null,
    decidedAt: msg.decidedAt,
    decision: msg.decision,
    hold: hold ? holdView(hold) : null,
    approveUrl: hold?.state === 'DRAFT' ? hold.approveUrl : null,
    timeline,
  };
}

export type InboxCard = {
  messageId: string;
  holdId: string | null;
  lane: 'hold' | 'free';
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  decision: Message['decision'];
  decidedAt: string | null;
  replyText: string | null;
  hold: HoldView | null;
  triage: Omit<Triage, 'messageId' | 'modelStartedAt'> | null;
};

export type InboxView = {
  recipient: Recipient & { charityName: string; releaseLabel: string };
  cards: InboxCard[];
  stats: { heldCents: number; heldCount: number; releasedCount: number; donatedCents: number; spamCount: number };
};

function mapTriageRow(r: Row): InboxCard['triage'] {
  if (r.t_source === null || r.t_source === undefined) return null;
  return {
    source: r.t_source as 'model' | 'rules',
    model: r.t_model ? String(r.t_model) : null,
    fitScore: Number(r.t_fit),
    fitReason: String(r.t_fit_reason),
    riskScore: Number(r.t_risk),
    riskReason: String(r.t_risk_reason),
    summary: String(r.t_summary),
    draftReply: String(r.t_draft),
    recommendation: r.t_rec as Triage['recommendation'],
    injection: Boolean(r.t_injection),
    flags: toJsonArray(r.t_flags),
    latencyMs: r.t_latency === null || r.t_latency === undefined ? null : Number(r.t_latency),
    modelError: r.t_error ? String(r.t_error) : null,
    updatedAt: toIso(r.t_updated) ?? '',
  };
}

export async function getInboxView(recipient: Recipient): Promise<InboxView> {
  const db = await getDb();
  const rows = await db.query(
    `SELECT m.*, h.id AS h_id,
            t.source AS t_source, t.model AS t_model, t.fit_score AS t_fit, t.fit_reason AS t_fit_reason,
            t.risk_score AS t_risk, t.risk_reason AS t_risk_reason, t.summary AS t_summary, t.draft_reply AS t_draft,
            t.recommendation AS t_rec, t.injection AS t_injection, t.flags AS t_flags, t.latency_ms AS t_latency,
            t.model_error AS t_error, t.updated_at AS t_updated
       FROM messages m
       LEFT JOIN holds h ON h.message_id = m.id
       LEFT JOIN triage t ON t.message_id = m.id
      WHERE m.recipient_id = $1 AND m.delivered_at IS NOT NULL
      ORDER BY m.delivered_at DESC
      LIMIT 200`,
    [recipient.id],
  );
  const holdIds = rows.map((r) => r.h_id).filter(Boolean) as string[];
  const holds = new Map<string, Hold>();
  if (holdIds.length) {
    for (const h of await db.query('SELECT * FROM holds WHERE id = ANY($1::text[])', [holdIds])) holds.set(String(h.id), mapHold(h));
  }
  const cards: InboxCard[] = rows.map((r) => {
    const m = mapMessage(r);
    const h = r.h_id ? holds.get(String(r.h_id)) : undefined;
    return {
      messageId: m.id,
      holdId: h?.id ?? null,
      lane: m.lane,
      senderName: m.senderName,
      senderEmail: m.senderEmail,
      subject: m.subject,
      body: m.body,
      createdAt: m.createdAt,
      deliveredAt: m.deliveredAt,
      decision: m.decision,
      decidedAt: m.decidedAt,
      replyText: m.replyText,
      hold: h ? holdView(h) : null,
      triage: mapTriageRow(r),
    };
  });
  const stats = { heldCents: 0, heldCount: 0, releasedCount: 0, donatedCents: 0, spamCount: 0 };
  for (const h of holds.values()) {
    if (h.state === 'AUTHORIZED') {
      stats.heldCents += h.amountCents;
      stats.heldCount += 1;
    }
    if (h.state === 'VOIDED') stats.releasedCount += 1;
    if (h.state === 'DONATED') stats.donatedCents += h.donatedCents ?? 0;
    if (h.outcome === 'spam') stats.spamCount += 1;
  }
  return {
    recipient: { ...recipient, charityName: getCharity(recipient.charityId)?.name ?? 'the charity', releaseLabel: windowLabel(recipient.releaseMinutes) },
    cards,
    stats,
  };
}

export type LedgerRow = {
  holdId: string | null;
  messageId: string;
  receivedAt: string;
  lane: 'hold' | 'free';
  sender: string;
  payer: string | null;
  subject: string;
  amount: number | null;
  state: string;
  aiSource: string | null;
  aiRecommendation: string | null;
  aiFit: number | null;
  aiRisk: number | null;
  injection: boolean;
  decision: string | null;
  decidedBy: string | null;
  agreement: 'agree' | 'differ' | null;
  outcome: string | null;
  paypalFee: number | null;
  donated: number | null;
  payoutFee: number | null;
  authorizationId: string | null;
  captureId: string | null;
  payoutBatchId: string | null;
  lastVerifiedAt: string | null;
};

export type LedgerEvent = { holdId: string; at: string; kind: string; actor: string; change: string; detail: string };

/** Human decision vs AI recommendation. The timer's auto-release is not a human decision. */
function agreement(rec: string | null, decision: string | null): 'agree' | 'differ' | null {
  if (!rec || !decision) return null;
  if (decision === 'spam') return rec === 'spam' ? 'agree' : 'differ';
  return rec === 'spam' ? 'differ' : 'agree';
}

export async function getLedger(recipient: Recipient): Promise<{ rows: LedgerRow[]; events: LedgerEvent[] }> {
  const db = await getDb();
  const rows = await db.query(
    `SELECT m.id AS m_id, m.lane, m.sender_name, m.sender_email, m.subject, m.delivered_at, m.created_at AS m_created,
            m.decision, h.*, t.source AS t_source, t.recommendation AS t_rec, t.fit_score AS t_fit, t.risk_score AS t_risk, t.injection AS t_injection
       FROM messages m
       LEFT JOIN holds h ON h.message_id = m.id
       LEFT JOIN triage t ON t.message_id = m.id
      WHERE m.recipient_id = $1
      ORDER BY m.created_at DESC
      LIMIT 500`,
    [recipient.id],
  );
  const ledger: LedgerRow[] = rows.map((r) => {
    const h = r.id ? mapHold(r) : null;
    const decision = (r.decision as string | null) ?? (h?.outcome === 'auto_release' ? 'auto_release' : null);
    return {
      holdId: h?.id ?? null,
      messageId: String(r.m_id),
      receivedAt: toIso(r.delivered_at) ?? toIso(r.m_created) ?? '',
      lane: r.lane as 'hold' | 'free',
      sender: `${String(r.sender_name)} <${String(r.sender_email)}>`,
      payer: shortName(h?.payerName ?? null),
      subject: String(r.subject),
      amount: h ? h.amountCents / 100 : null,
      state: h ? h.state : r.delivered_at ? 'FREE LANE' : 'NOT SENT',
      aiSource: r.t_source ? String(r.t_source) : null,
      aiRecommendation: r.t_rec ? String(r.t_rec) : null,
      aiFit: r.t_fit === null || r.t_fit === undefined ? null : Number(r.t_fit),
      aiRisk: r.t_risk === null || r.t_risk === undefined ? null : Number(r.t_risk),
      injection: Boolean(r.t_injection),
      decision,
      decidedBy: r.decision ? 'you' : h?.outcome === 'auto_release' ? 'timer' : null,
      agreement: r.decision ? agreement(r.t_rec ? String(r.t_rec) : null, String(r.decision)) : null,
      outcome: h?.outcome ? OUTCOME_COPY[h.outcome] : null,
      paypalFee: h?.feeCents === null || h?.feeCents === undefined ? null : h.feeCents / 100,
      donated: h?.donatedCents === null || h?.donatedCents === undefined ? null : h.donatedCents / 100,
      payoutFee: h?.payoutFeeCents === null || h?.payoutFeeCents === undefined ? null : h.payoutFeeCents / 100,
      authorizationId: h?.authorizationId ?? null,
      captureId: h?.captureId ?? null,
      payoutBatchId: h?.payoutBatchId ?? null,
      lastVerifiedAt: h?.lastVerifiedAt ?? null,
    };
  });
  const evRows = await db.query(
    `SELECT e.* FROM hold_events e JOIN holds h ON h.id = e.hold_id WHERE h.recipient_id = $1 ORDER BY e.id DESC LIMIT 1000`,
    [recipient.id],
  );
  const events: LedgerEvent[] = evRows.map((e) => {
    const detail = (typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail) as Record<string, unknown>;
    const change = e.from_state || e.to_state ? `${e.from_state ?? ''} → ${e.to_state ?? ''}`.trim() : String(detail.call ?? detail.op ?? detail.action ?? '');
    const { call: _c, ...rest } = detail;
    return {
      holdId: String(e.hold_id),
      at: toIso(e.at) ?? '',
      kind: String(e.kind),
      actor: String(e.actor),
      change,
      detail: JSON.stringify(rest),
    };
  });
  return { rows: ledger, events };
}

export async function getLandingStats(): Promise<{ holds: number; released: number; donatedCents: number; pages: number }> {
  const db = await getDb();
  const rows = await db.query<{ holds: number; released: number; donated: number; pages: number }>(
    `SELECT (SELECT count(*)::int FROM holds WHERE state IN ('AUTHORIZED','VOIDED','CAPTURED','DONATED')) AS holds,
            (SELECT count(*)::int FROM holds WHERE state = 'VOIDED') AS released,
            (SELECT COALESCE(sum(donated_cents), 0)::int FROM holds WHERE state = 'DONATED') AS donated,
            (SELECT count(*)::int FROM recipients) AS pages`,
  );
  const r = rows[0];
  return { holds: Number(r?.holds ?? 0), released: Number(r?.released ?? 0), donatedCents: Number(r?.donated ?? 0), pages: Number(r?.pages ?? 0) };
}
