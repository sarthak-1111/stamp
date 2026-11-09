import 'server-only';
import { getDb, toIso, toJsonArray, type Row } from '@/lib/db';
import { newId, newToken, safeEqual, sha256 } from '@/lib/ids';

export type Recipient = {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  holdCents: number;
  currency: string;
  topics: string[];
  freeLane: string[];
  releaseMinutes: number;
  charityId: string;
  createdAt: string;
};

function mapRecipient(r: Row): Recipient {
  return {
    id: String(r.id),
    handle: String(r.handle),
    displayName: String(r.display_name),
    bio: String(r.bio ?? ''),
    holdCents: Number(r.hold_cents),
    currency: String(r.currency),
    topics: toJsonArray(r.topics),
    freeLane: toJsonArray(r.free_lane),
    releaseMinutes: Number(r.release_minutes),
    charityId: String(r.charity_id),
    createdAt: toIso(r.created_at) ?? '',
  };
}

export type RecipientSettings = {
  displayName: string;
  bio: string;
  holdCents: number;
  topics: string[];
  freeLane: string[];
  releaseMinutes: number;
  charityId: string;
};

/** Creates the page and returns the owner key ONCE. Only its SHA-256 is stored. */
export async function createRecipient(handle: string, s: RecipientSettings): Promise<{ recipient: Recipient; ownerKey: string } | null> {
  const db = await getDb();
  const id = newId('rcp');
  const secret = newToken();
  const rows = await db.query(
    `INSERT INTO recipients (id, handle, display_name, bio, hold_cents, topics, free_lane, release_minutes, charity_id, owner_token_hash)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
     ON CONFLICT (handle) DO NOTHING RETURNING *`,
    [id, handle, s.displayName, s.bio, s.holdCents, JSON.stringify(s.topics), JSON.stringify(s.freeLane), s.releaseMinutes, s.charityId, sha256(secret)],
  );
  if (!rows[0]) return null;
  return { recipient: mapRecipient(rows[0]), ownerKey: `${id}.${secret}` };
}

export async function updateRecipient(id: string, s: RecipientSettings): Promise<Recipient | null> {
  const db = await getDb();
  const rows = await db.query(
    `UPDATE recipients SET display_name = $2, bio = $3, hold_cents = $4, topics = $5::jsonb, free_lane = $6::jsonb,
            release_minutes = $7, charity_id = $8, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, s.displayName, s.bio, s.holdCents, JSON.stringify(s.topics), JSON.stringify(s.freeLane), s.releaseMinutes, s.charityId],
  );
  return rows[0] ? mapRecipient(rows[0]) : null;
}

export async function getRecipientByHandle(handle: string): Promise<Recipient | null> {
  const db = await getDb();
  const rows = await db.query('SELECT * FROM recipients WHERE handle = $1', [handle.toLowerCase()]);
  return rows[0] ? mapRecipient(rows[0]) : null;
}

export async function getRecipientById(id: string): Promise<Recipient | null> {
  const db = await getDb();
  const rows = await db.query('SELECT * FROM recipients WHERE id = $1', [id]);
  return rows[0] ? mapRecipient(rows[0]) : null;
}

/** Owner key format: "<recipientId>.<secret>". Constant-time comparison of the stored hash. */
export async function verifyOwnerKey(key: string | undefined | null): Promise<Recipient | null> {
  if (!key || key.length > 200) return null;
  const dot = key.indexOf('.');
  if (dot < 1) return null;
  const id = key.slice(0, dot);
  const secret = key.slice(dot + 1);
  const db = await getDb();
  const rows = await db.query('SELECT * FROM recipients WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return null;
  return safeEqual(String(row.owner_token_hash), sha256(secret)) ? mapRecipient(row) : null;
}

/**
 * Free lane: an exact address ("ana@example.org") or a whole domain ("@example.org").
 * The address is typed by the sender and NOT verified, so free-lane messages are labelled as such.
 */
export function matchesFreeLane(freeLane: string[], email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return false;
  const domain = e.slice(at);
  return freeLane.some((entry) => {
    const f = entry.trim().toLowerCase();
    return f.startsWith('@') ? domain === f : e === f;
  });
}
