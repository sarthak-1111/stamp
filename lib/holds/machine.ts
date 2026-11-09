/**
 * The money state machine. Pure: no I/O, so every rule here is unit-tested.
 *
 *   DRAFT ──approve──▶ APPROVED ──authorize──▶ AUTHORIZED ──void──▶ VOIDED
 *     │                   │                       │
 *     ├──▶ EXPIRED        ├──▶ EXPIRED            ├──capture──▶ CAPTURED ──payout──▶ DONATED
 *     └──▶ FAILED         └──▶ FAILED             ├──▶ EXPIRED      └──▶ FAILED
 *                                                 └──▶ FAILED
 *
 * Who may do what (the `actor`):
 *  - sender:    approves the checkout (or cancels it before approving).
 *  - recipient: Reply / Worth it  -> void (release).  Spam -> capture, then payout to the charity.
 *  - timer:     auto-release (void) once the window has ended. Nothing else.
 *  - paypal:    PayPal reported a fact (approval, authorization, a void or capture made outside Stamp,
 *               payout success or failure). Stamp mirrors it so the UI never disagrees with PayPal.
 *  - system:    housekeeping that moves no money (give up on an abandoned checkout, record a failure).
 *  - ai:        NOTHING. The AI has no transition and no operation. It only writes advisory triage.
 */

export const HOLD_STATES = ['DRAFT', 'APPROVED', 'AUTHORIZED', 'VOIDED', 'CAPTURED', 'DONATED', 'EXPIRED', 'FAILED'] as const;
export type HoldState = (typeof HOLD_STATES)[number];

export const TERMINAL_STATES: readonly HoldState[] = ['VOIDED', 'DONATED', 'EXPIRED', 'FAILED'];

export const ACTORS = ['sender', 'recipient', 'timer', 'paypal', 'system', 'ai'] as const;
export type Actor = (typeof ACTORS)[number];

/** Why a hold ended up where it did. Recorded as `outcome` on the hold. */
export type Outcome =
  | 'reply'
  | 'worth_it'
  | 'auto_release'
  | 'spam'
  | 'cancelled'
  | 'abandoned'
  | 'declined'
  | 'voided_at_paypal'
  | 'captured_outside_stamp'
  | 'expired_at_paypal'
  | 'capture_declined'
  | 'payout_failed'
  | 'order_failed';

type TransitionRule = { from: HoldState; to: HoldState; allow: Partial<Record<Actor, readonly Outcome[] | 'any'>> };

/**
 * The complete list of legal transitions. Anything not listed is illegal.
 * For each actor: which outcomes (reasons) it may record with the transition, or 'any' when the
 * transition does not end the hold (no outcome needed).
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  // Checkout
  { from: 'DRAFT', to: 'APPROVED', allow: { sender: 'any', paypal: 'any' } },
  { from: 'DRAFT', to: 'EXPIRED', allow: { sender: ['cancelled'], system: ['abandoned'], paypal: ['abandoned'] } },
  { from: 'DRAFT', to: 'FAILED', allow: { system: ['order_failed'] } },
  { from: 'APPROVED', to: 'AUTHORIZED', allow: { sender: 'any', paypal: 'any', system: 'any' } },
  { from: 'APPROVED', to: 'FAILED', allow: { sender: ['declined'], paypal: ['declined'], system: ['declined'] } },
  { from: 'APPROVED', to: 'EXPIRED', allow: { system: ['abandoned'], paypal: ['abandoned'] } },
  // The hold is live: only the recipient or the timer can end it, unless PayPal reports otherwise.
  {
    from: 'AUTHORIZED',
    to: 'VOIDED',
    allow: { recipient: ['reply', 'worth_it'], timer: ['auto_release'], paypal: ['voided_at_paypal'] },
  },
  { from: 'AUTHORIZED', to: 'CAPTURED', allow: { recipient: ['spam'], paypal: ['captured_outside_stamp'] } },
  { from: 'AUTHORIZED', to: 'EXPIRED', allow: { paypal: ['expired_at_paypal'] } },
  { from: 'AUTHORIZED', to: 'FAILED', allow: { recipient: ['capture_declined'], paypal: ['capture_declined', 'declined'] } },
  // Donation of a captured hold.
  { from: 'CAPTURED', to: 'DONATED', allow: { paypal: 'any' } },
  { from: 'CAPTURED', to: 'FAILED', allow: { paypal: ['payout_failed'] } },
];

/** Operations that call PayPal. A hold is "claimed" for one operation at a time (pending_op). */
export type Operation = 'authorize' | 'void' | 'capture' | 'payout';

type OperationRule = { op: Operation; state: HoldState; allow: Partial<Record<Actor, readonly string[] | 'any'>> };

export const OPERATIONS: readonly OperationRule[] = [
  { op: 'authorize', state: 'APPROVED', allow: { sender: 'any', paypal: 'any', system: 'any' } },
  { op: 'void', state: 'AUTHORIZED', allow: { recipient: ['reply', 'worth_it'], timer: ['auto_release'] } },
  { op: 'capture', state: 'AUTHORIZED', allow: { recipient: ['spam'] } },
  // The payout is the second half of the recipient's Spam decision; nobody else can start one.
  { op: 'payout', state: 'CAPTURED', allow: { recipient: ['spam'] } },
];

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export function canTransition(from: HoldState, to: HoldState, actor: Actor, outcome?: Outcome | null): boolean {
  const rule = TRANSITIONS.find((r) => r.from === from && r.to === to);
  if (!rule) return false;
  const allowed = rule.allow[actor];
  if (!allowed) return false;
  if (allowed === 'any') return true;
  return outcome !== undefined && outcome !== null && allowed.includes(outcome);
}

export function assertTransition(from: HoldState, to: HoldState, actor: Actor, outcome?: Outcome | null): void {
  if (!canTransition(from, to, actor, outcome)) {
    throw new TransitionError(`Illegal transition ${from} -> ${to} by ${actor}${outcome ? ` (${outcome})` : ''}`);
  }
}

export function canOperate(op: Operation, state: HoldState, actor: Actor, reason?: string | null): boolean {
  const rule = OPERATIONS.find((r) => r.op === op && r.state === state);
  if (!rule) return false;
  const allowed = rule.allow[actor];
  if (!allowed) return false;
  if (allowed === 'any') return true;
  return reason !== undefined && reason !== null && allowed.includes(reason);
}

export function assertOperation(op: Operation, state: HoldState, actor: Actor, reason?: string | null): void {
  if (!canOperate(op, state, actor, reason)) {
    throw new TransitionError(`Illegal operation ${op} on ${state} by ${actor}${reason ? ` (${reason})` : ''}`);
  }
}

export function isTerminal(state: HoldState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Copy used by the sender status page, inbox and ledger. */
export const STATE_COPY: Record<HoldState, { label: string; tone: 'neutral' | 'held' | 'good' | 'donated' | 'bad' }> = {
  DRAFT: { label: 'Awaiting PayPal approval', tone: 'neutral' },
  APPROVED: { label: 'Approved, placing hold', tone: 'neutral' },
  AUTHORIZED: { label: 'Held, not charged', tone: 'held' },
  VOIDED: { label: 'Released, nothing charged', tone: 'good' },
  CAPTURED: { label: 'Captured for charity', tone: 'donated' },
  DONATED: { label: 'Donated to charity', tone: 'donated' },
  EXPIRED: { label: 'Not sent', tone: 'neutral' },
  FAILED: { label: 'Did not go through', tone: 'bad' },
};

export const OUTCOME_COPY: Record<Outcome, string> = {
  reply: 'Recipient replied',
  worth_it: 'Recipient marked it worth it',
  auto_release: 'Auto-released when the window ended',
  spam: 'Recipient marked it as spam',
  cancelled: 'Sender cancelled at PayPal',
  abandoned: 'PayPal approval was never completed',
  declined: 'PayPal declined the hold',
  voided_at_paypal: 'Voided at PayPal',
  captured_outside_stamp: 'Captured outside Stamp',
  expired_at_paypal: 'Authorization expired at PayPal',
  capture_declined: 'PayPal declined the capture',
  payout_failed: 'The donation payout failed',
  order_failed: 'PayPal order could not be created',
};
