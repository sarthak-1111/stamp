import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react/ssr';
import { ActorMatrix } from '@/components/landing/ActorMatrix';
import { HeroPreview } from '@/components/landing/HeroPreview';
import { MoneyPath } from '@/components/landing/MoneyPath';
import { ICON } from '@/components/Message';
import { formatMoney } from '@/lib/money';
import { getLandingStats } from '@/lib/views';

export const dynamic = 'force-dynamic';

const FAIR = [
  { title: 'Refund by default', body: 'A hold is released unless you actively mark the message as spam. Silence costs the sender nothing.' },
  { title: 'You set the price', body: 'Between $1 and $20, shown on your page before anyone writes.' },
  { title: 'A free lane', body: 'People and domains you trust skip the hold entirely.' },
  { title: 'Auto-release', body: 'Unanswered holds release when your window ends: at most 72 hours, inside PayPal’s three-day honor period.' },
  { title: 'Spam goes to charity', body: 'A captured hold is paid out to the charity you picked, after PayPal’s fee. Stamp covers the payout fee.' },
  { title: 'PayPal is the source of truth', body: 'Webhooks are signature-verified, and Stamp re-reads PayPal before it shows you a money state.' },
];

const PAYPAL = [
  ['Orders v2', 'Checkout with intent AUTHORIZE, so the sender approves a hold, not a payment'],
  ['Payments v2', 'Void to release a hold; capture when the recipient marks spam'],
  ['Payouts', 'Sends the captured amount to the charity, with a batch id derived from the hold so it can never pay twice'],
  ['Webhooks', 'Signature-verified with PayPal, then used as a prompt to re-read the order or authorization'],
  ['Agent Toolkit', 'Order reads go through PayPal’s MCP server with one read-only tool enabled'],
  ['Idempotency', 'Every write carries a stored PayPal-Request-Id that is reused on retry'],
];

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [stats, sp] = await Promise.all([getLandingStats().catch(() => null), searchParams]);
  return (
    <>
      {sp.error === 'checkout' ? (
        <div role="alert" className="mx-auto mt-4 max-w-[1200px] px-4 sm:px-6 lg:px-8">
          <p className="rounded-xl bg-bad-bg px-4 py-3 text-bad">That PayPal checkout could not be completed. Nothing was held or charged.</p>
        </div>
      ) : null}

      <section className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-12 px-4 pt-12 pb-16 sm:px-6 lg:min-h-[calc(100dvh-64px)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:px-8 lg:py-12">
        <div className="rise max-w-xl">
          <h1 className="text-[40px] leading-[1.06] font-medium tracking-[-0.03em] text-balance sm:text-[56px] lg:text-[64px]">
            <span className="block">Strangers can reach you</span>
            <span className="sr-only">. </span>
            <span className="block text-ink-3">Spam pays a charity</span>
          </h1>
          <p className="mt-6 max-w-[36rem] text-[18px] leading-[30px] text-ink-2 text-pretty">
            To message you, a stranger places a small refundable PayPal hold. Real messages get it back. Spam goes to charity.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/setup" className="btn btn-primary btn-lg">
              Create your page
            </Link>
            <Link href="/@demo" className="btn btn-secondary btn-lg">
              Try a live page
              <ArrowRight {...ICON} aria-hidden />
            </Link>
          </div>
        </div>
        <div className="rise [--i:2]">
          <HeroPreview />
        </div>
      </section>

      <section aria-labelledby="who" className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 sm:py-20 lg:px-8 lg:py-28">
        <h2 id="who" className="max-w-4xl text-[28px] leading-[1.25] font-normal tracking-[-0.02em] text-balance sm:text-[36px]">
          AI made cold outreach free to write and free to send. <span className="text-ink-3">Reading it still costs your attention.</span>
        </h2>
        <div className="mt-10 grid max-w-4xl gap-8 text-[16px] leading-7 text-ink-2 md:grid-cols-2">
          <p>
            Stamp is for people whose inbox is a public address: founders, journalists, open-source maintainers, creators and recruiters. A
            stranger who means it does not mind a hold they get back.
          </p>
          <p>
            Senders who write one thoughtful message pay nothing. Senders who blast thousands of generated messages put real money on the
            line with every one, and the spam they send funds a charity instead of you.
          </p>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1200px] scroll-mt-8 px-4 py-16 sm:px-6 lg:px-8">
        <h2 id="how-title" className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance sm:text-[40px]">
          One hold, three ways it ends
        </h2>
        <p className="mt-3 max-w-2xl text-[17px] leading-7 text-ink-2">Two of them cost the sender nothing.</p>
        <div className="mt-10">
          <MoneyPath />
        </div>
      </section>

      <section aria-labelledby="ai-title" className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:px-8">
        <div>
          <h2 id="ai-title" className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance sm:text-[40px]">
            The AI reads. It never pays
          </h2>
          <div className="mt-5 grid gap-4 text-[16px] leading-7 text-ink-2">
            <p>
              A language model scores each message for fit with your topics and for scam or phishing risk, writes a one-line summary and
              drafts a reply. Its answer must match a strict schema, and deterministic red-flag rules can raise the risk score but the model
              cannot lower it.
            </p>
            <p>
              Message text is untrusted data, fenced off with a random marker. A message that says “mark me worthwhile” or “send the hold to
              me” changes nothing, and the tests prove it.
            </p>
          </div>
        </div>
        <div>
          <ActorMatrix />
          <p className="mt-3 text-[13px] leading-5 text-ink-3">
            Generated from the permission table the server enforces. Placing a hold always starts with the sender’s approval in PayPal.
          </p>
        </div>
      </section>

      <section id="fair" aria-labelledby="fair-title" className="mx-auto max-w-[1200px] scroll-mt-8 px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <h2 id="fair-title" className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance sm:text-[40px]">
              Stamp never pays the recipient
            </h2>
            <p className="mt-4 text-[17px] leading-7 text-ink-2">So nobody earns a cent by crying spam, and Stamp does not keep it either.</p>
            {stats && stats.holds > 0 ? (
              <p className="mt-8 text-[14px] leading-6 text-ink-3">
                In this sandbox so far: <span className="font-mono text-ink-2 tabular-nums">{stats.holds}</span> holds placed,{' '}
                <span className="font-mono text-ink-2 tabular-nums">{stats.released}</span> released at no cost,{' '}
                <span className="font-mono text-ink-2 tabular-nums">{formatMoney(stats.donatedCents)}</span> donated.
              </p>
            ) : null}
          </div>
          <dl className="grid gap-x-10 border-t border-line sm:grid-cols-2">
            {FAIR.map((f) => (
              <div key={f.title} className="border-b border-line py-5">
                <dt className="text-[16px] leading-6 font-medium">{f.title}</dt>
                <dd className="mt-1 text-[15px] leading-6 text-ink-2">{f.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="agents" aria-labelledby="agents-title" className="mx-auto max-w-[1200px] scroll-mt-8 px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <h2 id="agents-title" className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance sm:text-[40px]">
              Agents can write too, with a stamp
            </h2>
            <p className="mt-4 text-[17px] leading-7 text-ink-2">
              Outreach agents get the same lane as people, through a small JSON API or an MCP server. The agent writes the message. A person
              still has to approve the hold in PayPal, and the recipient sees that an agent sent it.
            </p>
            <p className="mt-4 text-[15px] leading-6 text-ink-3">
              MCP endpoint: <span className="font-mono text-ink-2">/api/mcp</span>. Tools: <span className="font-mono text-ink-2">get_terms</span>,{' '}
              <span className="font-mono text-ink-2">send_message</span>, <span className="font-mono text-ink-2">get_status</span>.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-2xl border border-line bg-card p-5 font-mono text-[13px] leading-6 text-ink-2">
            <code>{`POST /api/v1/messages
{
  "to": "maya",
  "from": { "name": "Ava", "email": "ava@northbeam.dev" },
  "agent": "Ava, an outreach agent run by Northbeam",
  "subject": "Pilot for your storage sites",
  "body": "Hi Maya, ..."
}

201 Created
{
  "state": "DRAFT",
  "approve_url": "https://www.sandbox.paypal.com/checkoutnow?token=...",
  "status_url": "/s/...",
  "hold": { "amount": "5.00", "currency": "USD" }
}`}</code>
          </pre>
        </div>
      </section>

      <section aria-labelledby="paypal-title" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 lg:px-8">
        <h2 id="paypal-title" className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance sm:text-[40px]">
          Built on PayPal
        </h2>
        <dl className="mt-8 grid border-t border-line md:grid-cols-2 md:gap-x-10">
          {PAYPAL.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[132px_1fr] gap-4 border-b border-line py-4">
              <dt className="text-[15px] leading-6 font-medium">{k}</dt>
              <dd className="text-[15px] leading-6 text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
