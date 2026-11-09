/**
 * Postgres schema (Neon in production, PGlite locally and in tests).
 * Statements are idempotent; bump SCHEMA_VERSION when adding statements.
 *  v1: initial tables.
 *  v2: free-pass request lane, grant/decline decisions, spam reasons, and where a message came from
 *      (web form, JSON API or MCP) plus the agent that declared itself.
 */
export const SCHEMA_VERSION = 2;

/** Replace a CHECK constraint; safe if two cold starts race on it. */
const replaceCheck = (table: string, name: string, check: string) =>
  `DO $$ BEGIN
     ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name};
     ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check});
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_meta (id int PRIMARY KEY, version int NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS recipients (
    id text PRIMARY KEY,
    handle text NOT NULL UNIQUE,
    display_name text NOT NULL,
    bio text NOT NULL DEFAULT '',
    hold_cents int NOT NULL CHECK (hold_cents BETWEEN 100 AND 2000),
    currency text NOT NULL DEFAULT 'USD',
    topics jsonb NOT NULL DEFAULT '[]',
    free_lane jsonb NOT NULL DEFAULT '[]',
    release_minutes int NOT NULL CHECK (release_minutes BETWEEN 1 AND 4320),
    charity_id text NOT NULL,
    owner_token_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id text PRIMARY KEY,
    recipient_id text NOT NULL REFERENCES recipients(id),
    lane text NOT NULL CHECK (lane IN ('hold', 'free')),
    sender_name text NOT NULL,
    sender_email text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    input_flags jsonb NOT NULL DEFAULT '[]',
    status_token text NOT NULL UNIQUE,
    ip_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    decision text CHECK (decision IN ('reply', 'worth_it', 'spam')),
    decided_at timestamptz,
    reply_text text
  )`,
  `CREATE INDEX IF NOT EXISTS messages_recipient_idx ON messages (recipient_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS holds (
    id text PRIMARY KEY,
    message_id text NOT NULL UNIQUE REFERENCES messages(id),
    recipient_id text NOT NULL REFERENCES recipients(id),
    state text NOT NULL CHECK (state IN ('DRAFT','APPROVED','AUTHORIZED','VOIDED','CAPTURED','DONATED','EXPIRED','FAILED')),
    amount_cents int NOT NULL,
    currency text NOT NULL,
    charity_id text NOT NULL,
    release_minutes int NOT NULL,
    order_id text UNIQUE,
    approve_url text,
    authorization_id text UNIQUE,
    capture_id text UNIQUE,
    payout_batch_id text UNIQUE,
    payout_item_id text,
    payer_name text,
    payer_email text,
    payer_id text,
    fee_cents int,
    net_cents int,
    donated_cents int,
    payout_fee_cents int,
    authorized_at timestamptz,
    release_at timestamptz,
    auth_expires_at timestamptz,
    pending_op text CHECK (pending_op IN ('authorize','void','capture','payout')),
    pending_actor text,
    pending_reason text,
    pending_since timestamptz,
    attempts int NOT NULL DEFAULT 0,
    outcome text,
    outcome_actor text,
    failure_reason text,
    paypal_status text,
    payout_status text,
    last_verified_at timestamptz,
    last_check_at timestamptz,
    version int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS holds_due_idx ON holds (state, release_at)`,
  `CREATE INDEX IF NOT EXISTS holds_recipient_idx ON holds (recipient_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS hold_events (
    id serial PRIMARY KEY,
    hold_id text NOT NULL REFERENCES holds(id),
    at timestamptz NOT NULL DEFAULT clock_timestamp(),
    kind text NOT NULL,
    from_state text,
    to_state text,
    actor text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS hold_events_hold_idx ON hold_events (hold_id, id)`,

  `CREATE TABLE IF NOT EXISTS paypal_requests (
    hold_id text NOT NULL,
    op text NOT NULL,
    request_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (hold_id, op)
  )`,

  `CREATE TABLE IF NOT EXISTS triage (
    message_id text PRIMARY KEY REFERENCES messages(id),
    source text NOT NULL CHECK (source IN ('model', 'rules')),
    model text,
    fit_score int NOT NULL,
    fit_reason text NOT NULL,
    risk_score int NOT NULL,
    risk_reason text NOT NULL,
    summary text NOT NULL,
    draft_reply text NOT NULL,
    recommendation text NOT NULL CHECK (recommendation IN ('reply', 'worth_it', 'review', 'spam')),
    injection boolean NOT NULL DEFAULT false,
    flags jsonb NOT NULL DEFAULT '[]',
    latency_ms int,
    model_error text,
    model_started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS webhook_events (
    id text PRIMARY KEY,
    event_type text NOT NULL,
    resource_id text,
    verified boolean NOT NULL,
    hold_id text,
    outcome text,
    received_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS rate_limits (
    key text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    count int NOT NULL
  )`,

  // ---- v2
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS decision_reason text`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS via text NOT NULL DEFAULT 'web'`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_name text`,
  replaceCheck('messages', 'messages_lane_check', `lane IN ('hold', 'free', 'request')`),
  replaceCheck('messages', 'messages_decision_check', `decision IN ('reply', 'worth_it', 'spam', 'grant', 'decline')`),
  replaceCheck('messages', 'messages_via_check', `via IN ('web', 'api', 'mcp')`),
  replaceCheck(
    'messages',
    'messages_decision_reason_check',
    `decision_reason IS NULL OR decision_reason IN ('bulk', 'scam', 'abuse', 'manipulation', 'other')`,
  ),
  `CREATE INDEX IF NOT EXISTS messages_requests_idx ON messages (recipient_id, sender_email, created_at DESC) WHERE lane = 'request'`,
];
