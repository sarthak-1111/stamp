/**
 * Deterministic triage: the fallback when the model is unavailable, and the safety floor the model's
 * output is combined with. Pure functions (no I/O), unit-tested in tests/triage.test.ts.
 */

export type Recommendation = 'reply' | 'worth_it' | 'review' | 'spam';

export type Signal = { code: string; label: string; weight: number; injection?: boolean };

export type TriageInput = {
  recipient: { displayName: string; topics: string[] };
  message: { senderName: string; subject: string; body: string; inputFlags: string[] };
};

export type TriageResult = {
  fitScore: number;
  fitReason: string;
  riskScore: number;
  riskReason: string;
  summary: string;
  draftReply: string;
  injection: boolean;
  flags: string[];
  recommendation: Recommendation;
};

/** The AI recommends; only the recipient decides. Computed in code, never taken from model output. */
export function recommend(t: { fitScore: number; riskScore: number; injection: boolean }): Recommendation {
  if (t.injection || t.riskScore >= 70) return 'spam';
  if (t.riskScore >= 40) return 'review';
  if (t.fitScore >= 60) return 'reply';
  return 'worth_it';
}

// ---------------------------------------------------------------- prompt-injection heuristics

const INJECTION_RULES: Array<{ re: RegExp; label: string; weight: number }> = [
  {
    re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|system|your|the)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?|guidelines?|directives?)\b/i,
    label: 'Tells the AI to ignore its instructions',
    weight: 60,
  },
  {
    re: /\b(mark|flag|label|classify|rate|score|treat|consider|tag|set)\b[^.\n]{0,25}\b(me|this|it|my\s+message|this\s+message|this\s+email)\b[^.\n]{0,15}\b(as\s+)?(worth\s*-?\s*while|worth\s+it|important|legit(imate)?|not\s+spam|safe|trusted|high[\s-]priority|priority|a\s+(good|great|perfect)\s+fit)\b/i,
    label: 'Asks to be marked as worthwhile',
    weight: 60,
  },
  {
    re: /\b(send|transfer|give|pay|release|refund|forward|route|move|wire|redirect)\b[^.\n]{0,30}\b(hold|stamp|deposit|money|funds|payment|donation|captured\s+amount|\$\s?\d+(\.\d{2})?)\b[^.\n]{0,30}\b(to\s+me|to\s+my\b|back\s+to\s+me|to\s+(this|that|the\s+following)\s+(account|address|email|wallet)|to\s+[\w.+-]+@[\w-]+\.[\w.]+)/i,
    label: 'Asks for the hold to be sent somewhere',
    weight: 60,
  },
  { re: /\b(fit|risk)[\s_-]?scores?\b/i, label: 'Mentions the AI scores', weight: 45 },
  { re: /\b(system|developer|hidden)\s+(prompt|message|instructions?)\b/i, label: 'Talks to the AI system prompt', weight: 45 },
  { re: /\byou\s+are\s+(now\s+)?(an?\s+|the\s+)?(ai|assistant|model|llm|chatbot|triage\s+(bot|assistant|model))\b/i, label: 'Addresses the AI directly', weight: 40 },
  { re: /\b(dear|hey|hi|attention)\s+(ai|assistant|model|bot|chatgpt|gpt|llm|triage)\b/i, label: 'Addresses the AI directly', weight: 40 },
  { re: /<\/?\s*(message|system|assistant|user|instructions?|untrusted|im_start|im_end)\b[^>]*>|<<<|>>>|\[\/?(inst|system)\]|<\|[a-z_]+\|>/i, label: 'Contains fake prompt markers', weight: 50 },
  { re: /"\s*(fit_score|risk_score|recommendation|injection_attempt|action|decision|verdict)\s*"\s*:/i, label: 'Contains JSON aimed at the AI', weight: 50 },
  { re: /\b(do\s+not|don'?t|never|must\s+not)\s+(mark|flag|report|classify|label)\b[^.\n]{0,25}\b(as\s+)?spam\b/i, label: 'Asks not to be marked as spam', weight: 50 },
];

/** Lighter signal: giving orders about the hold is suspicious, but not proof of an attack on the AI. */
const HOLD_ORDERS = /\b(capture|void|cancel|release|refund)\b[^.\n]{0,15}\b(the\s+|my\s+|this\s+)?(hold|authori[sz]ation)\b/i;

// ---------------------------------------------------------------- scam / phishing heuristics

const SCAM_RULES: Array<{ re: RegExp; code: string; label: string; weight: number }> = [
  {
    re: /\b(password|passcode|one[-\s]?time\s+(code|password|pin)|otp\b|2fa\s+code|verification\s+code|seed\s+phrase|recovery\s+phrase|private\s+key|social\s+security|\bssn\b|bank\s+(details|login|account\s+number)|card\s+number|\bcvv\b)/i,
    code: 'credentials',
    label: 'Asks for credentials or account details',
    weight: 45,
  },
  {
    re: /\b(verify|confirm|unlock|reactivate|restore|validate|update)\s+(your\s+)?(account|identity|wallet|payment\s+(method|details)|login|billing)\b/i,
    code: 'verify_lure',
    label: 'Account verification lure',
    weight: 35,
  },
  {
    re: /\b(gift\s*cards?|wire\s+transfer|western\s+union|moneygram|bitcoin|\bbtc\b|usdt|ethereum|crypto(currency)?\s+(wallet|transfer|investment|payment)|send\s+crypto)\b/i,
    code: 'irreversible_payment',
    label: 'Asks for a hard-to-reverse payment',
    weight: 35,
  },
  {
    re: /\b(guaranteed\s+(returns?|profits?|income)|double\s+your\s+(money|investment)|risk[-\s]?free\s+(investment|returns?)|passive\s+income|get\s+rich|\d{2,}x\s+returns?)\b/i,
    code: 'investment_pitch',
    label: 'Too-good-to-be-true investment pitch',
    weight: 35,
  },
  {
    re: /\b(you('|’)?ve\s+won|you\s+have\s+(been\s+selected|won)|lottery|inheritance|unclaimed\s+(funds|prize)|claim\s+your\s+(prize|reward))\b/i,
    code: 'prize_lure',
    label: 'Prize or inheritance lure',
    weight: 40,
  },
  {
    re: /\b(urgent(ly)?|immediately|right\s+away|within\s+(12|24|48)\s+hours|final\s+(notice|warning)|account\s+(will\s+be\s+)?(suspended|locked|closed|terminated|disabled)|act\s+now|last\s+chance)\b/i,
    code: 'urgency',
    label: 'Urgency pressure',
    weight: 15,
  },
];

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'ow.ly', 'buff.ly', 'shorturl.at', 'tiny.cc', 's.id', 't.ly']);

const BRANDS: Array<{ re: RegExp; official: string[] }> = [
  { re: /p[a@]yp[a@][l1i|]|pay-pal|paypai/i, official: ['paypal.com', 'paypal.me', 'paypalobjects.com'] },
  { re: /micr[o0]s[o0]ft|rnicrosoft|0ffice365|office-365/i, official: ['microsoft.com', 'office.com', 'live.com'] },
  { re: /g[o0]{2}g[l1]e|gmai1/i, official: ['google.com', 'gmail.com', 'youtube.com'] },
  { re: /app[l1]e-?id|icl[o0]ud-/i, official: ['apple.com', 'icloud.com'] },
  { re: /amaz[o0]n|arnazon/i, official: ['amazon.com'] },
  { re: /c[o0]inbase|binance|metamask|metarnask/i, official: ['coinbase.com', 'binance.com', 'metamask.io'] },
];

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"'`]+/gi;
const BARE_DOMAIN_RE = /\b[a-z0-9][a-z0-9-]{1,62}\.(?:[a-z0-9-]{1,62}\.)*(?:com|net|org|io|co|xyz|top|info|biz|ru|cn|tk|ml|ga|cf|gq|online|site|app|me|link|click|live|support)\b(?:\/[^\s]*)?/gi;

function hostOf(raw: string): string | null {
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isOfficial(host: string, official: string[]): boolean {
  return official.some((d) => host === d || host.endsWith(`.${d}`));
}

export function extractHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const h = hostOf(m[0]);
    if (h) hosts.add(h);
  }
  for (const m of text.matchAll(BARE_DOMAIN_RE)) {
    if (m[0].includes('@')) continue;
    const h = hostOf(m[0]);
    if (h) hosts.add(h);
  }
  return [...hosts];
}

export function detectSignals(input: TriageInput): Signal[] {
  const text = `${input.message.subject}\n${input.message.body}`;
  const signals: Signal[] = [];
  for (const r of INJECTION_RULES) {
    if (r.re.test(text) && !signals.some((s) => s.label === r.label)) {
      signals.push({ code: 'injection', label: r.label, weight: r.weight, injection: true });
    }
  }
  if (HOLD_ORDERS.test(text)) signals.push({ code: 'hold_orders', label: 'Gives orders about the hold', weight: 20 });
  for (const r of SCAM_RULES) if (r.re.test(text)) signals.push({ code: r.code, label: r.label, weight: r.weight });

  const hosts = extractHosts(text);
  for (const host of hosts) {
    const brand = BRANDS.find((b) => b.re.test(host));
    if (brand && !isOfficial(host, brand.official)) {
      signals.push({ code: 'lookalike_domain', label: `Look-alike domain: ${host}`, weight: 50 });
    } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      signals.push({ code: 'ip_link', label: 'Link to a bare IP address', weight: 30 });
    } else if (host.includes('xn--')) {
      signals.push({ code: 'punycode', label: `Disguised (punycode) domain: ${host}`, weight: 35 });
    } else if (SHORTENERS.has(host)) {
      signals.push({ code: 'shortener', label: `Shortened link (${host}) hides the destination`, weight: 20 });
    }
  }
  if (hosts.length >= 3) signals.push({ code: 'many_links', label: `${hosts.length} different links`, weight: 10 });

  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 40 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.5) {
    signals.push({ code: 'shouting', label: 'Mostly capital letters', weight: 10 });
  }
  if (input.message.inputFlags.includes('hidden_characters')) {
    signals.push({ code: 'hidden_characters', label: 'Hidden or direction-changing characters were removed', weight: 25 });
  }
  return signals;
}

// ---------------------------------------------------------------- fit

const STOP = new Set(
  'a an and are as at be by for from has have i in is it its of on or our so that the their this to was we with you your about into over just can will would'.split(' '),
);

function stem(w: string): string {
  return w
    .toLowerCase()
    .replace(/(ing|edly|ed|ers|er|ies|es|s)$/u, (m) => (m === 'ies' ? 'y' : ''))
    .slice(0, 12);
}

function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? []).map((w) => w.replace(/[.]+$/, '')).filter((w) => w && !STOP.has(w));
}

export function topicMatches(topics: string[], text: string): string[] {
  const textStems = new Set(words(text).map(stem));
  const lower = text.toLowerCase();
  return topics.filter((topic) => {
    if (lower.includes(topic.toLowerCase())) return true;
    const t = words(topic).map(stem);
    if (!t.length) return false;
    const hit = t.filter((w) => textStems.has(w)).length;
    return hit / t.length >= 0.5;
  });
}

function firstSentence(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const m = flat.match(/^(.{20,180}?[.!?])(\s|$)/);
  const s = m?.[1] ?? flat.slice(0, 160);
  return s.length < flat.length && !m ? `${s}…` : s;
}

function firstName(name: string): string {
  const n = name.trim().split(/\s+/)[0] ?? '';
  return /^[\p{L}'-]{1,40}$/u.test(n) ? n : 'there';
}

// ---------------------------------------------------------------- rule-based triage

export function ruleTriage(input: TriageInput): TriageResult & { riskFloor: number } {
  const signals = detectSignals(input);
  const injection = signals.some((s) => s.injection);
  const riskScore = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));
  const riskFloor = Math.min(100, signals.filter((s) => s.weight >= 30).reduce((sum, s) => sum + s.weight, 0));

  const { topics } = input.recipient;
  const text = `${input.message.subject}\n${input.message.body}`;
  const matched = topicMatches(topics, text);
  let fitScore: number;
  let fitReason: string;
  if (!topics.length) {
    fitScore = 50;
    fitReason = 'No topics set, so fit is neutral.';
  } else if (matched.length) {
    fitScore = Math.min(95, 50 + 15 * (matched.length - 1) + (input.message.body.length > 280 ? 10 : 0) + (/\?/.test(input.message.body) ? 5 : 0));
    fitReason = `Mentions ${matched.slice(0, 3).join(', ')}.`;
  } else {
    fitScore = Math.min(30, 10 + Math.floor(input.message.body.length / 100) * 4);
    fitReason = `Doesn't mention any of your topics (${topics.slice(0, 3).join(', ')}).`;
  }
  if (injection) fitScore = Math.min(fitScore, 25);

  const riskReason = signals.length
    ? signals
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map((s) => s.label)
        .join('; ') + '.'
    : 'No scam or phishing signals found.';

  const name = firstName(input.message.senderName);
  let draftReply: string;
  if (injection || riskScore >= 60) {
    draftReply = `Thanks for reaching out. I'm not able to help with this.`;
  } else if (matched.length) {
    draftReply = `Hi ${name}, thanks for getting in touch about ${matched[0]}. I'd be glad to hear more. Could you send a short summary of what you need and a couple of times that work for you?`;
  } else {
    draftReply = `Hi ${name}, thanks for your message. It's outside what I'm focused on right now${topics.length ? ` (${topics.slice(0, 2).join(', ')})` : ''}, so I'll pass for now. Best of luck!`;
  }

  return {
    fitScore,
    fitReason,
    riskScore,
    riskReason,
    summary: `${input.message.subject.trim()}: ${firstSentence(input.message.body)}`.slice(0, 220),
    draftReply,
    injection,
    flags: [...new Set(signals.map((s) => s.label))].slice(0, 6),
    recommendation: recommend({ fitScore, riskScore, injection }),
    riskFloor,
  };
}

/** Strip anything actionable from text the AI wrote: links, email addresses, phone numbers. */
export function scrubGenerated(text: string): string {
  return text
    .replace(URL_RE, '[link removed]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number removed]')
    .replace(BARE_DOMAIN_RE, '[link removed]')
    .replace(/\s+\n/g, '\n')
    .trim();
}
