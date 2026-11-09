/** Copy shared by server and client code. No secrets, no I/O. */

export const SPAM_REASONS = ['bulk', 'scam', 'abuse', 'manipulation', 'other'] as const;
export type SpamReason = (typeof SPAM_REASONS)[number];

/** Shown to the recipient when they mark spam, and to the sender on their status page. */
export const SPAM_REASON_LABEL: Record<SpamReason, string> = {
  bulk: 'Mass outreach or a sales blast',
  scam: 'Scam or phishing',
  abuse: 'Abusive or harassing',
  manipulation: 'Tried to manipulate the AI triage',
  other: 'Other',
};

export function isSpamReason(v: unknown): v is SpamReason {
  return typeof v === 'string' && (SPAM_REASONS as readonly string[]).includes(v);
}

export type Via = 'web' | 'api' | 'mcp';
export const VIA_LABEL: Record<Via, string> = { web: 'web form', api: 'JSON API', mcp: 'MCP' };

/** A return rate is shown once a page has at least this many decided holds. */
export const RETURN_RATE_MIN_DECIDED = 3;
