import 'server-only';
import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db';
import { refreshHold, sendMessage, StampError } from '@/lib/holds/service';
import { centsToValue } from '@/lib/money';
import { cleanText } from '@/lib/sanitize';
import { parseSend, type SendFields } from '@/lib/validation';
import { getPublicPage, getStatusView } from '@/lib/views';

/**
 * The agent lane: AI outreach agents can reach a Stamp page through a JSON API or MCP, under the same
 * rules as people. The agent must say who it is, the recipient sees that an agent sent the message, and
 * the hold is only placed after a human approves it in PayPal. Nothing here can approve a payment.
 */

export const AGENT_RULES =
  'A person must open approve_url and approve the hold in PayPal. Agents must never ask for, store or enter payment credentials. ' +
  'The hold is refundable: it is released if the recipient replies, marks it worth it, or does not decide in time. ' +
  'If the recipient marks it spam it is donated to charity, never paid to the recipient. Sandbox only.';

type FieldErrors = Record<string, string>;

const API_FIELD: Record<string, string> = { handle: 'to', senderName: 'from.name', senderEmail: 'from.email', form: 'request' };

export function parseAgentSend(raw: Record<string, unknown> | null): { ok: true; data: SendFields & { agentName: string } } | { ok: false; errors: FieldErrors } {
  const r = raw ?? {};
  const from = r.from && typeof r.from === 'object' && !Array.isArray(r.from) ? (r.from as Record<string, unknown>) : {};
  const parsed = parseSend({ handle: r.to, senderName: from.name, senderEmail: from.email, subject: r.subject, body: r.body, website: '' });
  const agent = cleanText(r.agent, { max: 80 });
  const errors: FieldErrors = {};
  if (!parsed.ok) for (const [k, v] of Object.entries(parsed.errors)) errors[API_FIELD[k] ?? k] = v;
  if (agent.text.length < 2) errors.agent = 'Say which agent is sending, for example "Ava, an outreach agent run by Northbeam".';
  if (!parsed.ok || Object.keys(errors).length) return { ok: false, errors };
  const inputFlags = agent.hadHidden && !parsed.data.inputFlags.includes('hidden_characters') ? [...parsed.data.inputFlags, 'hidden_characters'] : parsed.data.inputFlags;
  return { ok: true, data: { ...parsed.data, inputFlags, agentName: agent.text } };
}

export async function getTerms(handle: string) {
  const page = await getPublicPage(handle);
  if (!page) return null;
  const base = getConfig().appUrl;
  return {
    handle: page.handle,
    display_name: page.displayName,
    bio: page.bio,
    topics: page.topics,
    accepts_messages: Boolean(page.charity),
    hold: { amount: centsToValue(page.holdCents), currency: page.currency, kind: 'refundable PayPal authorization' },
    auto_release_after_minutes: page.releaseMinutes,
    if_marked_spam: `Captured and donated to ${page.charity?.name ?? 'charity'} after PayPal's fee. The recipient never receives it.`,
    return_rate: page.returns.rate === null ? null : { percent: page.returns.rate, returned: page.returns.returned, decided: page.returns.decided },
    send: { method: 'POST', url: `${base}/api/v1/messages` },
    page_url: `${base}/@${page.handle}`,
    rules: AGENT_RULES,
    sandbox: true,
  };
}

export async function agentSend(data: SendFields & { agentName: string }, via: 'api' | 'mcp', ipHash: string | null) {
  const result = await sendMessage({ ...data, via, agentName: data.agentName }, { ipHash });
  const page = await getPublicPage(data.handle);
  const base = getConfig().appUrl;
  return {
    lane: result.lane,
    state: result.lane === 'hold' ? 'DRAFT' : 'DELIVERED',
    approve_url: result.lane === 'hold' ? result.approveUrl : null,
    status_url: `${base}/s/${result.statusToken}`,
    status_api: `${base}/api/v1/status/${result.statusToken}`,
    status_token: result.statusToken,
    hold: result.lane === 'hold' && page ? { amount: centsToValue(page.holdCents), currency: page.currency } : null,
    next_step:
      result.lane === 'hold'
        ? 'Send approve_url to the person you act for. The message is delivered once they approve the hold in PayPal.'
        : 'Delivered without a hold: this sender is on the free lane.',
    rules: AGENT_RULES,
  };
}

export async function getAgentStatus(token: string) {
  if (!token || token.length > 64) return null;
  // Same as the status page: re-verify a live hold with PayPal (throttled inside refreshHold) before answering.
  const db = await getDb();
  const rows = await db.query<{ id: string }>('SELECT h.id FROM holds h JOIN messages m ON m.id = h.message_id WHERE m.status_token = $1', [token]);
  if (rows[0]) await refreshHold(rows[0].id);
  const v = await getStatusView(token);
  if (!v) return null;
  const base = getConfig().appUrl;
  const state = v.hold?.state ?? (v.lane === 'request' ? (v.decision === 'grant' ? 'GRANTED' : v.decision === 'decline' ? 'DECLINED' : 'REQUESTED') : 'DELIVERED');
  return {
    lane: v.lane,
    state,
    label: v.hold?.stateLabel ?? null,
    outcome: v.hold?.outcomeLabel ?? null,
    decision: v.decision,
    spam_reason: v.decisionReason,
    reply: v.replyText,
    release_at: v.hold?.releaseAt ?? null,
    approve_url: v.approveUrl,
    donated: v.hold?.donatedCents !== null && v.hold?.donatedCents !== undefined ? centsToValue(v.hold.donatedCents) : null,
    checked_with_paypal_at: v.hold?.lastVerifiedAt ?? null,
    status_url: `${base}/s/${token}`,
  };
}

export function apiError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof StampError) return { status: err.status, body: { error: err.code, message: err.message } };
  console.error('[stamp] agent lane error', err);
  return { status: 500, body: { error: 'internal', message: 'Something went wrong. Nothing was charged.' } };
}
