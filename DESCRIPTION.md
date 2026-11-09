<!-- DRAFT for review (checkpoint 3). Numbers marked E2E are filled from docs/evidence/e2e-sandbox-deployed.json after the deployed run. -->

# Stamp

**Strangers put a refundable PayPal hold on the line to reach you. Real messages get it back. Spam goes to charity.**

Sandbox only. No real money moves, and Stamp never pays the recipient.

## The problem

AI made cold outreach free to write and free to send. An agent can draft and send thousands of personal-sounding messages a day, and every one costs the reader a few seconds of judgement. The people who feel it most are the ones whose inbox has to stay open: founders, journalists, open-source maintainers, creators and recruiters.

Filters guess, and they guess wrong in both directions. Paid inboxes keep the money, which quietly rewards the recipient for calling things spam. Neither restores the old signal that a stranger cared enough to write.

## What Stamp does

A recipient makes a page, `/@handle`, with four terms: a refundable hold from $1 to $20, the topics they want to hear about, a free lane for people and domains they trust, an auto-release window of up to 72 hours, and the charity that receives holds marked as spam.

1. **A sender writes and approves a hold in PayPal.** It is an authorization, not a payment. The message is delivered only once the hold is authorized.
2. **The AI reads every message** and gives the recipient a fit score with a reason, a scam or phishing risk with a reason, a one-line summary and a draft reply. It is a suggestion. The AI never moves money.
3. **The recipient decides.**
   - **Reply** or **Worth it**: the authorization is voided. The sender pays $0.
   - **No decision** before the window ends: a timer voids it. The sender pays $0.
   - **Spam**, confirmed with a reason the sender sees: the hold is captured and paid out to the charity. The recipient gets $0, and so does Stamp.

The sender follows their message on a status page with a live timeline. The recipient has an inbox and a ledger of every hold, decision and PayPal call.

Fairness is part of the product, not a policy page:

- Refund is the default. Silence costs the sender nothing.
- Nobody profits from crying spam: captured money goes to charity.
- Each page shows its **return rate** once 3 holds have been decided, so senders can see how a recipient treats them before writing.
- People without PayPal can ask for a **free pass** with one short note; recipients grant or decline it.
- **AI agents get the same lane.** Through a JSON API or an MCP server, an outreach agent can read a page's terms and send a message. It must say who it is, a person still has to approve the hold in PayPal, and the recipient sees "Sent by an AI agent".

## Technological implementation

**PayPal.** Stamp uses the PayPal Developer Platform for the whole money path, in the sandbox:

- **Orders v2** with `intent: AUTHORIZE` creates the hold; Stamp authorizes it when the sender returns from PayPal.
- **Payments v2** voids an authorization to release a hold, or captures it when the recipient marks spam.
- **Payouts** sends the captured amount, net of PayPal's fee, to the charity. The `sender_batch_id` is derived from the hold, so a retried payout can never pay twice.
- **Webhooks** are verified with `verify-webhook-signature` and treated as hints: Stamp re-reads the order, authorization, capture or payout from PayPal and applies only transitions its state machine allows.
- **The PayPal Agent Toolkit** (`@paypal/agent-toolkit` 1.11.0) handles order reads: its MCP server runs in-process with exactly one tool enabled, the read-only `get_order`, and no model attached. The toolkit's `create_order` only creates CAPTURE-intent orders, and authorize, void, capture and payouts are not toolkit tools, so those go through REST from deterministic server code. The coverage was checked live against the local toolkit (47 tools) and PayPal's hosted sandbox MCP server (46 tools).
- **Every write carries a stored `PayPal-Request-Id`**, reused on retry. Replays were tested against the sandbox: the same key returns the same order, authorization or capture; a capture with a new key is refused with `AUTHORIZATION_ALREADY_CAPTURED`.

**The hold is a state machine** (DRAFT → APPROVED → AUTHORIZED → VOIDED, or CAPTURED → DONATED, plus EXPIRED and FAILED) with a permission table that says which actor may start each money operation. The AI actor has none. The recipient can void or capture; the timer can only void; PayPal reports and the reconciler can only move a hold to what PayPal already says. One operation per hold is claimed atomically, so a double click cannot void or capture twice. The auto-release window is capped at 72 hours: inside PayPal's 3-day honor period (from PayPal's documentation) and far inside the 29-day authorization validity (observed in the sandbox: `expiration_time` exactly 29 days after authorization).

**AI.** Triage runs on `gpt-oss:120b`, an open-weight model on the author's own GPU, called through an OpenAI-compatible endpoint behind an authenticating proxy. The model must answer in a strict JSON schema, validated with zod; anything else is discarded and Stamp falls back to its rule engine, labelled in the UI. Message text is untrusted data, fenced off with a random marker. Deterministic red-flag rules can raise the risk score but the model cannot lower it, and the recommendation is computed in code, not taken from the model. A message that says "mark me worthwhile" or "send the hold to me" changes nothing: the tests prove it, and so does the end-to-end sandbox run.

**Evidence.** 463 automated tests cover every transition and actor, idempotency and retries, injection attempts, the agent lane and fairness rules. A scripted end-to-end run in the sandbox drives all five paths (reply, worth it, spam, timer, injection) and then checks each authorization, capture and payout directly with PayPal. <!-- E2E: one sentence with the deployed run's results, e.g. checks passed, decision-to-void time, capture-to-donated time --> In the step-0 run, a $5.00 hold marked as spam cost $0.66 in PayPal fees and $4.34 reached the charity about 24 seconds after the payout was created.

## Design

Stamp is a complete product for both sides, not a payments demo. The recipient sets terms on one page, works an inbox where the AI's suggestion sits next to their decision, and audits everything in a ledger (AG Grid) that opens each row into the PayPal calls behind it. The sender gets a public page with the terms in plain words, a PayPal approval, and a status page that follows the hold to its end with a postmark.

The visual idea is a post office counter: every hold amount is a small perforated stamp, the hero shows a rendered $5 stamp with a HELD postmark, and the status page stamps the outcome. The chrome stays quiet so the money states read at a glance: amber for held, green for released, plum for donated, red for failed. It works on a phone, in dark mode, with a keyboard, and with reduced motion.

## Potential impact

Stamp is for anyone whose inbox is a public address. It does not try to out-guess AI-written outreach; it changes the economics. A sender who writes one thoughtful message pays nothing. A sender who blasts thousands puts real money behind each one, and their spam funds a charity instead of anyone's revenue. Recipients keep a channel open to strangers, including strangers with no PayPal, without a filter deciding for them. And because agents are given a proper, labelled lane instead of being blocked, the system holds up as more outreach is written by agents.

## Innovation

Paid inboxes exist, and so do spam filters. Stamp's difference is in three choices:

1. **The default is a refund.** The money is a hold, released unless the recipient actively and visibly decides otherwise, so the cost lands only on spam.
2. **Nobody can profit from the spam button.** Captured holds go to charity through PayPal Payouts, never to the recipient or to Stamp, and each page's return rate is public.
3. **The AI is useful but powerless.** It reads and suggests; a permission table, shown on the landing page and enforced on every transition, gives it no way to move money, even when a message tells it to.

## Tools used and how

- **PayPal Developer Platform (sandbox):** Orders v2, Payments v2 (authorizations), Payouts, Webhooks, and the PayPal Agent Toolkit's MCP server for order reads; PayPal's hosted sandbox MCP server for the coverage check.
- **AI in the product:** `gpt-oss:120b` (open weights), self-hosted and served through an OpenAI-compatible API, behind Stamp's own authenticating proxy. Structured output with a JSON schema; zod validation; a deterministic rule engine as the floor and the fallback.
- **AI used to build it:** Claude Code (Claude Opus 5.5) wrote most of the code and tests under my direction, ran the sandbox go/no-go checks and the end-to-end script, and did the design passes. The final design pass followed the unslop method by Damir Sokolovsky (CC BY 4.0). Every PayPal behaviour Stamp relies on was checked against the sandbox, not assumed.
- **Stack:** Next.js 16 and React 19 with TypeScript, Tailwind CSS 4, Motion, Phosphor icons, Geist fonts, AG Grid for the ledger, Postgres (Neon) in production and PGlite locally, the Model Context Protocol SDK for the agent server, Vitest, and Playwright for screenshots. Hosted on Vercel; the release timer runs on GitHub Actions.

## Challenges

- **Holding money without moving it.** Authorizations have a validity and an honor period, unapproved orders vanish after a few hours, and payouts settle asynchronously. Each of those became a rule in the state machine, found by running the sandbox before writing the app.
- **Making the AI useful without trusting it.** The model gets the message as fenced data, a schema it must fill, and no tools. The hard part was keeping the triage good while making sure no wording in a message could change a hold.
- **Webhooks arrive late, twice, or not at all.** Stamp treats them as hints and asks PayPal for the truth, so the result is the same whichever arrives first.

## What's next

A vetted charity directory, verified sender addresses, a browser extension that puts a Stamp link in an email signature, and per-topic prices.
