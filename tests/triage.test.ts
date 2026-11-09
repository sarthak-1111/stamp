import { describe, expect, it } from 'vitest';
import { combine, extractJson, ModelOutput } from '@/lib/triage/model';
import { recommend, ruleTriage, scrubGenerated, topicMatches, type TriageInput } from '@/lib/triage/rules';
import { cleanText } from '@/lib/sanitize';

function input(body: string, subject = 'Hello', topics = ['climate tech', 'battery storage', 'hiring']): TriageInput {
  return { recipient: { displayName: 'Ana', topics }, message: { senderName: 'Sam Lee', subject, body, inputFlags: [] } };
}

describe('rule-based triage', () => {
  it('on-topic, benign message: good fit, low risk, recommend reply', () => {
    const t = ruleTriage(input('We are piloting grid battery storage in Osaka and are hiring two engineers. Could we talk next week?', 'Battery storage pilot'));
    expect(t.fitScore).toBeGreaterThanOrEqual(60);
    expect(t.riskScore).toBeLessThan(20);
    expect(t.recommendation).toBe('reply');
    expect(t.draftReply).toMatch(/^Hi Sam/);
  });

  it('off-topic but harmless: release without reply', () => {
    const t = ruleTriage(input('I make handmade ceramic mugs and wondered if you would like to see my catalogue.', 'Mugs'));
    expect(t.fitScore).toBeLessThan(40);
    expect(t.riskScore).toBeLessThan(20);
    expect(t.recommendation).toBe('worth_it');
  });

  it('phishing with a look-alike domain and a credential ask: high risk, recommend spam', () => {
    const t = ruleTriage(input('URGENT: your account will be suspended. Verify your account at http://paypa1-secure.example/login and enter your password.', 'Account notice'));
    expect(t.riskScore).toBeGreaterThanOrEqual(70);
    expect(t.recommendation).toBe('spam');
    expect(t.flags.join(' ')).toMatch(/Look-alike domain/);
  });

  it('a link to the real paypal.com is not a look-alike', () => {
    const t = ruleTriage(input('Our invoice tool is at https://www.paypal.com/invoice and we love battery storage.'));
    expect(t.flags.join(' ')).not.toMatch(/Look-alike/);
  });

  it('crypto / gift-card pitches are risky', () => {
    const t = ruleTriage(input('Guaranteed returns! Send crypto or gift cards today and double your money.'));
    expect(t.riskScore).toBeGreaterThanOrEqual(60);
  });

  it('topic matching tolerates plurals and phrasing', () => {
    expect(topicMatches(['battery storage'], 'We build batteries for grid storage')).toEqual(['battery storage']);
    expect(topicMatches(['hiring'], 'We are hiring')).toEqual(['hiring']);
    expect(topicMatches(['climate tech'], 'I sell mugs')).toEqual([]);
  });

  it('recommendation thresholds', () => {
    expect(recommend({ fitScore: 90, riskScore: 10, injection: true })).toBe('spam');
    expect(recommend({ fitScore: 90, riskScore: 80, injection: false })).toBe('spam');
    expect(recommend({ fitScore: 90, riskScore: 45, injection: false })).toBe('review');
    expect(recommend({ fitScore: 60, riskScore: 0, injection: false })).toBe('reply');
    expect(recommend({ fitScore: 20, riskScore: 0, injection: false })).toBe('worth_it');
  });
});

describe('model output handling', () => {
  const good = {
    fit_score: 80,
    fit_reason: 'On battery storage.',
    risk_score: 5,
    risk_reason: 'Nothing unusual.',
    summary: 'Sam asks for advice on a storage pilot.',
    draft_reply: 'Hi Sam, happy to help. Call me at +1 415 555 0100 or visit https://example.com',
    injection_attempt: false,
    risk_signals: [],
  };

  it('valid output is accepted', () => {
    expect(ModelOutput.safeParse(good).success).toBe(true);
  });

  it('out-of-range scores and unknown keys are rejected', () => {
    expect(ModelOutput.safeParse({ ...good, risk_score: 101 }).success).toBe(false);
    expect(ModelOutput.safeParse({ ...good, fit_score: 7.5 }).success).toBe(false);
    expect(ModelOutput.safeParse({ ...good, release_hold: true }).success).toBe(false);
  });

  it('JSON wrapped in prose or code fences is extracted', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('combine: the model cannot lower risk below hard evidence; links are scrubbed from drafts', () => {
    const rules = ruleTriage(input('Verify your account at http://paypa1-secure.example/login with your password.'));
    const out = combine(ModelOutput.parse({ ...good, risk_score: 0 }), rules);
    expect(out.riskScore).toBeGreaterThanOrEqual(rules.riskFloor);
    expect(out.recommendation).toBe('spam');
    const clean = combine(ModelOutput.parse(good), ruleTriage(input('Battery storage question for you.')));
    expect(clean.draftReply).not.toMatch(/https?:|555/);
  });

  it('scrubGenerated removes links, emails and phone numbers', () => {
    expect(scrubGenerated('see https://x.example/a, mail a@b.example or call +1 (415) 555-0100')).toBe(
      'see [link removed] mail [email removed] or call [number removed]',
    );
  });
});

describe('input sanitising', () => {
  it('removes zero-width and bidi-override characters and reports them', () => {
    const c = cleanText('pay​pal‮moc.evil', { max: 100 });
    expect(c.text).toBe('paypalmoc.evil');
    expect(c.hadHidden).toBe(true);
  });

  it('single-line fields lose newlines; control characters are dropped; length is capped', () => {
    expect(cleanText('a\nb\u0007c', { max: 100 }).text).toBe('a bc');
    expect(cleanText('x'.repeat(500), { max: 10 }).text).toHaveLength(10);
  });
});
