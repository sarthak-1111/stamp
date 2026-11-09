import 'server-only';
import { getDb, toIso, type Row } from '@/lib/db';
import { newRequestId } from '@/lib/ids';
import { assertTransition, type Actor, type HoldState, type Operation, type Outcome } from './machine';

export type Hold = {
  id: string;
  messageId: string;
  recipientId: string;
  state: HoldState;
  amountCents: number;
  currency: string;
  charityId: string;
  releaseMinutes: number;
  orderId: string | null;
  approveUrl: string | null;
  authorizationId: string | null;
  captureId: string | null;
  payoutBatchId: string | null;
  payoutItemId: string | null;
  payerName: string | null;
  payerEmail: string | null;
  payerId: string | null;
  feeCents: number | null;
  netCents: number | null;
  donatedCents: number | null;
  payoutFeeCents: number | null;
  authorizedAt: string | null;
  releaseAt: string | null;
  authExpiresAt: string | null;
  pendingOp: Operation | null;
  pendingActor: Actor | null;
  pendingReason: string | null;
  pendingSince: string | null;
  attempts: number;
  outcome: Outcome | null;
  outcomeActor: Actor | null;
  failureReason: string | null;
  paypalStatus: string | null;
  payoutStatus: string | null;
  lastVerifiedAt: string | null;
  lastCheckAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function mapHold(r: Row): Hold {
  return {
    id: String(r.id),
    messageId: String(r.message_id),
    recipientId: String(r.recipient_id),
    state: r.state as HoldState,
    amountCents: Number(r.amount_cents),
    currency: String(r.currency),
    charityId: String(r.charity_id),
    releaseMinutes: Number(r.release_minutes),
    orderId: str(r.order_id),
    approveUrl: str(r.approve_url),
    authorizationId: str(r.authorization_id),
    captureId: str(r.capture_id),
    payoutBatchId: str(r.payout_batch_id),
    payoutItemId: str(r.payout_item_id),
    payerName: str(r.payer_name),
    payerEmail: str(r.payer_email),
    payerId: str(r.payer_id),
    feeCents: num(r.fee_cents),
    netCents: num(r.net_cents),
    donatedCents: num(r.donated_cents),
    payoutFeeCents: num(r.payout_fee_cents),
    authorizedAt: toIso(r.authorized_at),
    releaseAt: toIso(r.release_at),
    authExpiresAt: toIso(r.auth_expires_at),
    pendingOp: (r.pending_op as Operation | null) ?? null,
    pendingActor: (r.pending_actor as Actor | null) ?? null,
    pendingReason: str(r.pending_reason),
    pendingSince: toIso(r.pending_since),
    attempts: Number(r.attempts ?? 0),
    outcome: (r.outcome as Outcome | null) ?? null,
    outcomeActor: (r.outcome_actor as Actor | null) ?? null,
    failureReason: str(r.failure_reason),
    paypalStatus: str(r.paypal_status),
    payoutStatus: str(r.payout_status),
    lastVerifiedAt: toIso(r.last_verified_at),
    lastCheckAt: toIso(r.last_check_at),
    version: Number(r.version ?? 0),
    createdAt: toIso(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(r.updated_at) ?? new Date(0).toISOString(),
  };
}

async function one(sql: string, params: unknown[]): Promise<Hold | null> {
  const db = await getDb();
  const rows = await db.query(sql, params);
  return rows[0] ? mapHold(rows[0]) : null;
}

export const getHold = (id: string) => one('SELECT * FROM holds WHERE id = $1', [id]);
export const getHoldByMessageId = (id: string) => one('SELECT * FROM holds WHERE message_id = $1', [id]);
export const getHoldByOrderId = (id: string) => one('SELECT * FROM holds WHERE order_id = $1', [id]);
export const getHoldByAuthorizationId = (id: string) => one('SELECT * FROM holds WHERE authorization_id = $1', [id]);
export const getHoldByCaptureId = (id: string) => one('SELECT * FROM holds WHERE capture_id = $1', [id]);
export const getHoldByPayoutBatchId = (id: string) => one('SELECT * FROM holds WHERE payout_batch_id = $1', [id]);

// ---------------------------------------------------------------- events (the ledger's raw log)

export type EventKind = 'created' | 'transition' | 'paypal' | 'decision' | 'claim' | 'note';

export async function addEvent(
  holdId: string,
  e: { kind: EventKind; actor: Actor | 'reconciler' | 'webhook'; from?: HoldState | null; to?: HoldState | null; detail?: Record<string, unknown> },
): Promise<void> {
  const db = await getDb();
  await db.query(
    'INSERT INTO hold_events (hold_id, kind, from_state, to_state, actor, detail) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
    [holdId, e.kind, e.from ?? null, e.to ?? null, e.actor, JSON.stringify(e.detail ?? {})],
  );
}

export type HoldEventRow = {
  id: number;
  holdId: string;
  at: string;
  kind: EventKind;
  fromState: HoldState | null;
  toState: HoldState | null;
  actor: string;
  detail: Record<string, unknown>;
};

export async function listEvents(holdId: string): Promise<HoldEventRow[]> {
  const db = await getDb();
  const rows = await db.query('SELECT * FROM hold_events WHERE hold_id = $1 ORDER BY id', [holdId]);
  return rows.map((r) => ({
    id: Number(r.id),
    holdId: String(r.hold_id),
    at: toIso(r.at) ?? '',
    kind: r.kind as EventKind,
    fromState: (r.from_state as HoldState | null) ?? null,
    toState: (r.to_state as HoldState | null) ?? null,
    actor: String(r.actor),
    detail: (typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------- idempotency keys

/**
 * One PayPal-Request-Id per (hold, operation), created and stored BEFORE the first attempt and reused
 * on every retry. PayPal then returns the original result instead of performing the operation twice.
 */
export async function requestIdFor(holdId: string, op: Operation | 'create_order'): Promise<string> {
  const db = await getDb();
  const inserted = await db.query<{ request_id: string }>(
    'INSERT INTO paypal_requests (hold_id, op, request_id) VALUES ($1, $2, $3) ON CONFLICT (hold_id, op) DO NOTHING RETURNING request_id',
    [holdId, op, newRequestId()],
  );
  if (inserted[0]) return inserted[0].request_id;
  const existing = await db.query<{ request_id: string }>('SELECT request_id FROM paypal_requests WHERE hold_id = $1 AND op = $2', [holdId, op]);
  if (!existing[0]) throw new Error('idempotency key vanished');
  return existing[0].request_id;
}

// ---------------------------------------------------------------- claims (one PayPal operation in flight per hold)

/**
 * Atomically mark the hold as busy with `op`. Only succeeds if the hold is in `state` and nothing else
 * is in flight, so a recipient's Spam and the timer's auto-release can never both run.
 */
export async function claim(
  holdId: string,
  op: Operation,
  state: HoldState,
  actor: Actor,
  reason: string | null,
  guard: 'none' | 'before_release' | 'after_release' | 'payout_ready' = 'none',
): Promise<Hold | null> {
  const guards: Record<typeof guard, string> = {
    none: '',
    before_release: 'AND release_at > now()',
    after_release: 'AND release_at <= now()',
    payout_ready: "AND payout_batch_id IS NULL AND outcome = 'spam' AND net_cents IS NOT NULL AND paypal_status = 'COMPLETED'",
  };
  const db = await getDb();
  const rows = await db.query(
    `WITH upd AS (
       UPDATE holds SET pending_op = $2, pending_actor = $3, pending_reason = $4, pending_since = now(),
              attempts = attempts + 1, version = version + 1, updated_at = now()
        WHERE id = $1 AND state = $5 AND pending_op IS NULL ${guards[guard]}
       RETURNING *
     ), ev AS (
       INSERT INTO hold_events (hold_id, kind, from_state, to_state, actor, detail)
       SELECT id, 'claim', state, NULL, $3, jsonb_build_object('op', $2::text, 'reason', $4::text) FROM upd
     )
     SELECT * FROM upd`,
    [holdId, op, actor, reason, state],
  );
  return rows[0] ? mapHold(rows[0]) : null;
}

/** Reconciler: take over an operation whose outcome is unknown (the request timed out or PayPal returned 5xx). */
export async function resumeStale(holdId: string, op: Operation, staleSeconds = 20): Promise<Hold | null> {
  const db = await getDb();
  const rows = await db.query(
    `UPDATE holds SET pending_since = now(), attempts = attempts + 1, updated_at = now()
      WHERE id = $1 AND pending_op = $2 AND pending_since < now() - make_interval(secs => $3)
     RETURNING *`,
    [holdId, op, staleSeconds],
  );
  return rows[0] ? mapHold(rows[0]) : null;
}

/** PayPal definitively refused and nothing changed there: free the hold so the operation can be tried again. */
export async function releaseClaim(holdId: string, op: Operation, note: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.query(
    `WITH upd AS (
       UPDATE holds SET pending_op = NULL, pending_actor = NULL, pending_reason = NULL, pending_since = NULL, updated_at = now()
        WHERE id = $1 AND pending_op = $2 RETURNING id, state, pending_actor
     )
     INSERT INTO hold_events (hold_id, kind, actor, detail) SELECT id, 'note', 'reconciler', $3::jsonb FROM upd`,
    [holdId, op, JSON.stringify({ released_claim: op, ...note })],
  );
}

/** The operation finished without changing state (e.g. payout batch created): record ids and clear the claim. */
export async function finishClaim(holdId: string, op: Operation, set: Record<string, string | number | null>): Promise<Hold | null> {
  const allowed = new Set(['payout_batch_id', 'payout_status', 'payout_item_id', 'paypal_status', 'fee_cents', 'net_cents']);
  const params: unknown[] = [holdId, op];
  const assignments: string[] = [];
  for (const [col, value] of Object.entries(set)) {
    if (!allowed.has(col)) throw new Error(`column ${col} is not settable by finishClaim`);
    params.push(value);
    assignments.push(`${col} = $${params.length}`);
  }
  const db = await getDb();
  const rows = await db.query(
    `UPDATE holds SET ${assignments.length ? `${assignments.join(', ')},` : ''}
            pending_op = NULL, pending_actor = NULL, pending_reason = NULL, pending_since = NULL, updated_at = now()
      WHERE id = $1 AND pending_op = $2 RETURNING *`,
    params,
  );
  return rows[0] ? mapHold(rows[0]) : null;
}

// ---------------------------------------------------------------- transitions

/** Columns a transition may set. Values are bound parameters, or one of the SQL expressions below. */
const SETTABLE = new Set([
  'authorization_id',
  'capture_id',
  'payout_batch_id',
  'payout_item_id',
  'payer_name',
  'payer_email',
  'payer_id',
  'fee_cents',
  'net_cents',
  'donated_cents',
  'payout_fee_cents',
  'authorized_at',
  'release_at',
  'auth_expires_at',
  'failure_reason',
  'paypal_status',
  'payout_status',
  'last_verified_at',
]);

export const SQL_NOW = { sql: 'now()' } as const;
export const SQL_RELEASE_AT = { sql: "now() + release_minutes * interval '1 minute'" } as const;
type SqlExpr = typeof SQL_NOW | typeof SQL_RELEASE_AT;

export type TransitionInput = {
  holdId: string;
  from: HoldState;
  to: HoldState;
  actor: Actor;
  outcome?: Outcome | null;
  set?: Record<string, string | number | null | SqlExpr>;
  /** Only apply if this operation is the one in flight (it is cleared by the transition). */
  pendingOp?: Operation;
  deliverMessage?: boolean;
  detail?: Record<string, unknown>;
};

/**
 * Apply one state transition in a single SQL statement: conditional UPDATE (WHERE state = from) plus
 * the ledger event. Returns null if the hold was no longer in `from` (someone else got there first).
 */
export async function transition(t: TransitionInput): Promise<Hold | null> {
  assertTransition(t.from, t.to, t.actor, t.outcome);
  const params: unknown[] = [t.holdId, t.to, t.from, t.actor, t.outcome ?? null];
  const assignments: string[] = [];
  for (const [col, value] of Object.entries(t.set ?? {})) {
    if (!SETTABLE.has(col)) throw new Error(`column ${col} is not settable by a transition`);
    if (value !== null && typeof value === 'object' && 'sql' in value) {
      assignments.push(`${col} = ${value.sql}`);
    } else {
      params.push(value);
      assignments.push(`${col} = $${params.length}`);
    }
  }
  params.push(JSON.stringify({ outcome: t.outcome ?? undefined, ...(t.detail ?? {}) }));
  const detailParam = `$${params.length}`;
  let pendingGuard = '';
  if (t.pendingOp) {
    params.push(t.pendingOp);
    pendingGuard = `AND pending_op = $${params.length}`;
  }
  const deliver = t.deliverMessage
    ? `, msg AS (UPDATE messages SET delivered_at = COALESCE(delivered_at, now()) WHERE id IN (SELECT message_id FROM upd))`
    : '';
  const db = await getDb();
  const rows = await db.query(
    `WITH upd AS (
       UPDATE holds SET state = $2,
              ${assignments.length ? `${assignments.join(', ')},` : ''}
              outcome = COALESCE($5::text, outcome),
              outcome_actor = CASE WHEN $5::text IS NULL THEN outcome_actor ELSE $4::text END,
              pending_op = NULL, pending_actor = NULL, pending_reason = NULL, pending_since = NULL,
              version = version + 1, updated_at = now()
        WHERE id = $1 AND state = $3 ${pendingGuard}
       RETURNING *
     ), ev AS (
       INSERT INTO hold_events (hold_id, kind, from_state, to_state, actor, detail)
       SELECT id, 'transition', $3, $2, $4, ${detailParam}::jsonb FROM upd
     )${deliver}
     SELECT * FROM upd`,
    params,
  );
  return rows[0] ? mapHold(rows[0]) : null;
}

/** Non-state bookkeeping (PayPal ids, statuses, verification time). Never changes `state`. */
export async function updateHoldFields(holdId: string, set: Record<string, string | number | null | SqlExpr>, extraWhere = ''): Promise<Hold | null> {
  const allowed = new Set([...SETTABLE, 'order_id', 'approve_url', 'last_check_at']);
  const params: unknown[] = [holdId];
  const assignments: string[] = [];
  for (const [col, value] of Object.entries(set)) {
    if (!allowed.has(col)) throw new Error(`column ${col} is not updatable`);
    if (value !== null && typeof value === 'object' && 'sql' in value) assignments.push(`${col} = ${value.sql}`);
    else {
      params.push(value);
      assignments.push(`${col} = $${params.length}`);
    }
  }
  const db = await getDb();
  const rows = await db.query(`UPDATE holds SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1 ${extraWhere} RETURNING *`, params);
  return rows[0] ? mapHold(rows[0]) : null;
}

/** Cheap per-hold throttle so many pollers cannot hammer PayPal. */
export async function takeCheckSlot(holdId: string, minSeconds: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `UPDATE holds SET last_check_at = now()
      WHERE id = $1 AND (last_check_at IS NULL OR last_check_at < now() - make_interval(secs => $2)) RETURNING id`,
    [holdId, minSeconds],
  );
  return rows.length > 0;
}
