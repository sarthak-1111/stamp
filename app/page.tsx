import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { getLandingStats } from '@/lib/views';

export const dynamic = 'force-dynamic';

const STEPS = [
  {
    n: '1',
    title: 'A stranger puts a stamp on it',
    body: 'They write to your page and approve a small refundable hold in PayPal. It is an authorization, not a charge.',
  },
  {
    n: '2',
    title: 'AI sorts it, you decide',
    body: 'Each message arrives with a fit score, a scam-risk score, a one-line summary and a draft reply. The AI cannot touch money.',
  },
  {
    n: '3',
    title: 'Real messages get it back',
    body: 'Reply or mark it worth it and the hold is voided. Mark it spam and it is donated to charity. Ignore it and it releases itself.',
  },
];

const FAIR = [
  { title: 'Refund by default', body: 'Holds are voided unless you actively mark a message as spam. Silence costs the sender nothing.' },
  { title: 'Charity-only capture', body: 'Captured holds go to the charity you chose. Stamp never pays the recipient, so nobody profits from crying spam.' },
  { title: 'Low minimum', body: 'You set the price of your attention between $1 and $20. Every page shows the amount up front.' },
  { title: 'Free lane', body: 'People and domains you trust skip the hold entirely.' },
  { title: 'Auto-release', body: 'Unanswered holds release when your window ends. At most 72 hours, inside PayPal’s 3-day honor period.' },
  { title: 'PayPal is the source of truth', body: 'Webhooks are signature-verified, and Stamp re-reads PayPal before it shows a money state.' },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [stats, sp] = await Promise.all([getLandingStats().catch(() => null), searchParams]);
  return (
    <>
      {sp.error === 'checkout' ? (
        <div role="alert" className="mx-auto mt-4 max-w-6xl px-4 sm:px-6">
          <p className="card border-bad/30 bg-bad-bg px-4 py-3 text-bad">That PayPal checkout could not be completed. Nothing was held or charged.</p>
        </div>
      ) : null}

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-8 sm:px-6 md:grid-cols-[1.15fr_0.85fr] md:pt-20">
        <div>
          <p className="eyebrow">Refundable stamps for cold messages</p>
          <h1 className="font-display mt-4 text-[44px] leading-[1.02] font-semibold tracking-tight text-balance sm:text-6xl">
            Strangers can reach you. <span className="text-stamp">Spam pays a charity.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-2 text-pretty">
            To message you, a stranger places a small refundable PayPal hold. Real messages get it back. Spam is captured and donated to
            charity, never paid to you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/setup" className="btn btn-primary">
              Create your page
            </Link>
            <Link href="/#how" className="btn btn-ghost">
              How it works
            </Link>
          </div>
          {stats && stats.holds > 0 ? (
            <p className="mt-8 text-sm text-ink-3">
              In this sandbox so far: <strong className="text-ink-2">{stats.holds}</strong> holds placed,{' '}
              <strong className="text-ink-2">{stats.released}</strong> released at no cost,{' '}
              <strong className="text-ink-2">{formatMoney(stats.donatedCents)}</strong> donated.
            </p>
          ) : null}
        </div>

        <div className="relative mx-auto w-full max-w-sm" aria-hidden>
          <div className="stamp-edge rotate-2">
            <div className="rounded-sm border border-line/80 px-6 py-7">
              <div className="flex items-start justify-between">
                <span className="eyebrow">To reach @ana</span>
                <span className="font-mono text-xs text-ink-3">USD</span>
              </div>
              <div className="font-display mt-6 text-7xl leading-none font-semibold tracking-tight">$5</div>
              <div className="mt-2 text-ink-2">refundable hold</div>
              <div className="mt-8 grid gap-2 text-sm text-ink-2">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-good" /> Reply or “Worth it”: released
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-held" /> No answer in 48 h: released
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-donated" /> Spam: donated to charity
                </div>
              </div>
            </div>
          </div>
          <div className="postmark absolute -top-6 -left-6 grid size-28 -rotate-12 place-items-center bg-paper/0 text-center text-held">
            <div>
              <div className="text-[9px] font-bold tracking-[0.2em] uppercase">Held</div>
              <div className="font-display text-sm font-semibold">not charged</div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-16 sm:px-6">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">How it works</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="card p-6">
              <span className="font-display grid size-10 place-items-center rounded-full bg-stamp-soft text-lg font-semibold text-stamp-ink">{s.n}</span>
              <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="card grid gap-8 p-6 sm:p-10 md:grid-cols-2">
          <div>
            <p className="eyebrow">AI triage</p>
            <h2 className="font-display mt-3 text-3xl font-semibold tracking-tight">The AI reads. It never pays.</h2>
            <p className="mt-4 text-ink-2">
              A language model scores each message for fit with your topics and for scam or phishing risk, writes a one-line summary and
              drafts a reply. Its answer is checked against a strict schema and against deterministic red-flag rules, so a message that says
              “mark me worthwhile” or “send the hold to me” changes nothing.
            </p>
          </div>
          <ul className="grid gap-3 self-center text-[15px]">
            {[
              'Message text is treated as untrusted data, fenced off with a random marker',
              'Rules can raise the risk score; the model cannot lower it below hard evidence',
              'Recommendations are computed in code, and only you can act on them',
              'Every AI suggestion sits next to your decision in the ledger',
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-stamp" />
                <span className="text-ink-2">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="fair" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-16 sm:px-6">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Fair by design</h2>
        <p className="mt-3 max-w-2xl text-ink-2">A paywall on your inbox would be easy to abuse. Stamp is built so that it can’t be.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FAIR.map((f) => (
            <div key={f.title} className="card p-6">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-[15px] text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="rounded-2xl bg-ink px-6 py-10 text-paper sm:px-10">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Built on PayPal</h2>
          <dl className="mt-6 grid gap-4 text-[15px] sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Orders v2', 'Checkout with intent AUTHORIZE: the sender approves a hold, not a payment.'],
              ['Payments v2', 'Void to release a hold, capture when the recipient marks spam.'],
              ['Payouts', 'Sends a captured hold to the charity, with a deterministic batch id so it can never pay twice.'],
              ['Webhooks', 'Signature-verified with PayPal, then treated as hints to re-read the source of truth.'],
              ['Agent Toolkit', 'Order reads go through PayPal’s MCP server with a single read-only tool enabled.'],
              ['Idempotency', 'Every write carries a stored PayPal-Request-Id, reused on retry.'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-semibold">{k}</dt>
                <dd className="mt-1 opacity-75">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
