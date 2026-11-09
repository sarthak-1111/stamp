import { describe, expect, it } from 'vitest';
import {
  ACTORS,
  assertTransition,
  canOperate,
  canTransition,
  HOLD_STATES,
  isTerminal,
  OPERATIONS,
  TransitionError,
  TRANSITIONS,
  type Actor,
  type HoldState,
  type Operation,
  type Outcome,
} from '@/lib/holds/machine';

const ALL_OUTCOMES: Outcome[] = [
  'reply',
  'worth_it',
  'auto_release',
  'spam',
  'cancelled',
  'abandoned',
  'declined',
  'voided_at_paypal',
  'captured_outside_stamp',
  'expired_at_paypal',
  'capture_declined',
  'payout_failed',
  'order_failed',
];

/** The intended table, written out independently of the implementation. */
const EXPECTED: Array<[HoldState, HoldState, Actor, Outcome | null]> = [
  ['DRAFT', 'APPROVED', 'sender', null],
  ['DRAFT', 'APPROVED', 'paypal', null],
  ['DRAFT', 'EXPIRED', 'sender', 'cancelled'],
  ['DRAFT', 'EXPIRED', 'system', 'abandoned'],
  ['DRAFT', 'EXPIRED', 'paypal', 'abandoned'],
  ['DRAFT', 'FAILED', 'system', 'order_failed'],
  ['APPROVED', 'AUTHORIZED', 'sender', null],
  ['APPROVED', 'AUTHORIZED', 'paypal', null],
  ['APPROVED', 'AUTHORIZED', 'system', null],
  ['APPROVED', 'FAILED', 'sender', 'declined'],
  ['APPROVED', 'FAILED', 'paypal', 'declined'],
  ['APPROVED', 'FAILED', 'system', 'declined'],
  ['APPROVED', 'EXPIRED', 'system', 'abandoned'],
  ['APPROVED', 'EXPIRED', 'paypal', 'abandoned'],
  ['AUTHORIZED', 'VOIDED', 'recipient', 'reply'],
  ['AUTHORIZED', 'VOIDED', 'recipient', 'worth_it'],
  ['AUTHORIZED', 'VOIDED', 'timer', 'auto_release'],
  ['AUTHORIZED', 'VOIDED', 'paypal', 'voided_at_paypal'],
  ['AUTHORIZED', 'CAPTURED', 'recipient', 'spam'],
  ['AUTHORIZED', 'CAPTURED', 'paypal', 'captured_outside_stamp'],
  ['AUTHORIZED', 'EXPIRED', 'paypal', 'expired_at_paypal'],
  ['AUTHORIZED', 'FAILED', 'recipient', 'capture_declined'],
  ['AUTHORIZED', 'FAILED', 'paypal', 'capture_declined'],
  ['AUTHORIZED', 'FAILED', 'paypal', 'declined'],
  ['CAPTURED', 'DONATED', 'paypal', null],
  ['CAPTURED', 'FAILED', 'paypal', 'payout_failed'],
];

function expectedAllows(from: HoldState, to: HoldState, actor: Actor, outcome: Outcome | null): boolean {
  return EXPECTED.some(([f, t, a, o]) => {
    if (f !== from || t !== to || a !== actor) return false;
    if (o === null) return true; // non-ending transition: any (or no) outcome accepted
    return o === outcome;
  });
}

describe('state machine: every (from, to, actor, outcome) combination', () => {
  for (const from of HOLD_STATES) {
    for (const to of HOLD_STATES) {
      for (const actor of ACTORS) {
        it(`${from} -> ${to} by ${actor}`, () => {
          for (const outcome of [null, ...ALL_OUTCOMES]) {
            const allowed = canTransition(from, to, actor, outcome);
            expect(allowed, `${from}->${to} by ${actor} (${outcome})`).toBe(expectedAllows(from, to, actor, outcome));
          }
        });
      }
    }
  }
});

describe('state machine: invariants', () => {
  it('the AI can never change a hold', () => {
    for (const from of HOLD_STATES) for (const to of HOLD_STATES) for (const o of [null, ...ALL_OUTCOMES]) expect(canTransition(from, to, 'ai', o)).toBe(false);
    for (const op of ['authorize', 'void', 'capture', 'payout'] as Operation[]) {
      for (const s of HOLD_STATES) for (const r of [null, 'spam', 'reply', 'worth_it', 'auto_release']) expect(canOperate(op, s, 'ai', r)).toBe(false);
    }
  });

  it('only the recipient can capture, and only for spam', () => {
    for (const actor of ACTORS) {
      for (const r of [null, 'spam', 'reply', 'worth_it', 'auto_release']) {
        expect(canOperate('capture', 'AUTHORIZED', actor, r)).toBe(actor === 'recipient' && r === 'spam');
      }
    }
  });

  it('only the recipient (reply / worth it) or the timer (auto-release) can start a void', () => {
    for (const actor of ACTORS) {
      for (const r of [null, 'spam', 'reply', 'worth_it', 'auto_release']) {
        const expected = (actor === 'recipient' && (r === 'reply' || r === 'worth_it')) || (actor === 'timer' && r === 'auto_release');
        expect(canOperate('void', 'AUTHORIZED', actor, r)).toBe(expected);
      }
    }
  });

  it('a payout can only follow a spam capture', () => {
    for (const actor of ACTORS) for (const s of HOLD_STATES) for (const r of [null, 'spam', 'reply', 'auto_release']) {
      expect(canOperate('payout', s, actor, r)).toBe(actor === 'recipient' && s === 'CAPTURED' && r === 'spam');
    }
  });

  it('the timer can do nothing except auto-release', () => {
    const timerRules = TRANSITIONS.filter((t) => t.allow.timer);
    expect(timerRules).toHaveLength(1);
    expect(timerRules[0]).toMatchObject({ from: 'AUTHORIZED', to: 'VOIDED' });
    expect(OPERATIONS.filter((o) => o.allow.timer).map((o) => o.op)).toEqual(['void']);
  });

  it('terminal states have no way out', () => {
    for (const s of HOLD_STATES.filter(isTerminal)) {
      expect(TRANSITIONS.some((t) => t.from === s)).toBe(false);
    }
    expect(HOLD_STATES.filter(isTerminal).sort()).toEqual(['DONATED', 'EXPIRED', 'FAILED', 'VOIDED']);
  });

  it('assertTransition throws a TransitionError for illegal moves', () => {
    expect(() => assertTransition('VOIDED', 'CAPTURED', 'recipient', 'spam')).toThrow(TransitionError);
    expect(() => assertTransition('AUTHORIZED', 'CAPTURED', 'timer', 'spam')).toThrow(TransitionError);
    expect(() => assertTransition('AUTHORIZED', 'VOIDED', 'recipient', 'spam')).toThrow(TransitionError);
    expect(() => assertTransition('AUTHORIZED', 'VOIDED', 'recipient', 'reply')).not.toThrow();
  });
});
