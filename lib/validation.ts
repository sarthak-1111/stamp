import 'server-only';
import { z } from 'zod';
import { getCharity, HOLD_MAX_CENTS, HOLD_MIN_CENTS, releaseOptions } from '@/lib/config';
import type { RecipientSettings } from '@/lib/recipients';
import { cleanText } from '@/lib/sanitize';

export const RESERVED_HANDLES = new Set(
  'setup inbox ledger api admin administrator stamp stamps paypal venmo s u signin signout login logout about help support status settings www root system official team security privacy terms charity'.split(' '),
);

export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$/;

export function parseHandle(raw: unknown): { ok: true; handle: string } | { ok: false; error: string } {
  const h = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/^@/, '') : '';
  if (!HANDLE_RE.test(h)) return { ok: false, error: 'Use 3 to 24 characters: letters, numbers, - or _.' };
  if (RESERVED_HANDLES.has(h)) return { ok: false, error: 'That handle is reserved.' };
  return { ok: true, handle: h };
}

const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DOMAIN_ENTRY_RE = /^@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function isEmail(s: string): boolean {
  return s.length <= 254 && EMAIL_RE.test(s);
}

function normaliseFreeLane(entry: string): string | null {
  const e = entry.trim().toLowerCase();
  if (!e) return null;
  const candidate = e.includes('@') ? e : `@${e}`;
  if (candidate.startsWith('@')) return DOMAIN_ENTRY_RE.test(candidate) ? candidate : null;
  return isEmail(candidate) ? candidate : null;
}

type FieldErrors = Record<string, string>;

function list(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === 'string') return raw.split(/[,\n]/);
  return [];
}

export function parseSettings(raw: Record<string, unknown> | null): { ok: true; data: RecipientSettings } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const r = raw ?? {};
  const displayName = cleanText(r.displayName, { max: 60 }).text;
  if (!displayName) errors.displayName = 'Add the name senders will see.';
  const bio = cleanText(r.bio, { multiline: true, max: 280 }).text;

  const dollars = Number(r.holdDollars);
  const holdCents = Math.round(dollars * 100);
  if (!Number.isInteger(dollars) || holdCents < HOLD_MIN_CENTS || holdCents > HOLD_MAX_CENTS) {
    errors.holdDollars = `Choose a whole-dollar hold between $${HOLD_MIN_CENTS / 100} and $${HOLD_MAX_CENTS / 100}.`;
  }

  const topics = [...new Set(list(r.topics).map((t) => cleanText(t, { max: 40 }).text).filter(Boolean))];
  if (topics.length > 8) errors.topics = 'Up to 8 topics.';

  const freeRaw = list(r.freeLane).map((e) => e.trim()).filter(Boolean);
  const freeLane: string[] = [];
  for (const entry of freeRaw) {
    const n = normaliseFreeLane(entry);
    if (!n) errors.freeLane = `"${entry.slice(0, 60)}" is not an email address or a domain like @example.org.`;
    else if (!freeLane.includes(n)) freeLane.push(n);
  }
  if (freeLane.length > 20) errors.freeLane = 'Up to 20 free-lane entries.';

  const releaseMinutes = Number(r.releaseMinutes);
  if (!releaseOptions().some((o) => o.minutes === releaseMinutes)) errors.releaseMinutes = 'Choose one of the listed windows.';

  const charityId = String(r.charityId ?? '');
  if (!getCharity(charityId)) errors.charityId = 'Choose a charity from the list.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { displayName, bio, holdCents, topics: topics.slice(0, 8), freeLane, releaseMinutes, charityId } };
}

export type SendFields = { handle: string; senderName: string; senderEmail: string; subject: string; body: string; inputFlags: string[] };

export function parseSend(raw: Record<string, unknown> | null): { ok: true; data: SendFields } | { ok: false; errors: FieldErrors } {
  const r = raw ?? {};
  const errors: FieldErrors = {};
  // Honeypot: a field humans never see. Bots fill it in.
  if (typeof r.website === 'string' && r.website.trim() !== '') errors.form = 'Could not send this message.';
  const handle = parseHandle(r.handle);
  if (!handle.ok) errors.handle = 'Unknown page.';
  const name = cleanText(r.senderName, { max: 80 });
  const email = cleanText(r.senderEmail, { max: 254 });
  const subject = cleanText(r.subject, { max: 120 });
  const body = cleanText(r.body, { multiline: true, max: 2000 });
  if (!name.text) errors.senderName = 'Add your name.';
  if (!isEmail(email.text)) errors.senderEmail = 'Add a valid email address so the recipient can reply.';
  if (!subject.text) errors.subject = 'Add a subject.';
  if (body.text.length < 10) errors.body = 'Write at least 10 characters.';
  if (typeof r.body === 'string' && r.body.length > 2000) errors.body = 'Keep it under 2,000 characters.';
  if (Object.keys(errors).length || !handle.ok) return { ok: false, errors };
  const inputFlags = [name, email, subject, body].some((c) => c.hadHidden) ? ['hidden_characters'] : [];
  return {
    ok: true,
    data: { handle: handle.handle, senderName: name.text, senderEmail: email.text.toLowerCase(), subject: subject.text, body: body.text, inputFlags },
  };
}

export const ActionSchema = z.strictObject({
  action: z.enum(['reply', 'worth_it', 'spam']),
  replyText: z.string().max(2000).optional(),
  confirm: z.boolean().optional(),
});
