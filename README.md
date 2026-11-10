# Stamp

**Strangers put a refundable PayPal hold on the line to reach you. Real messages get it back. Spam goes to charity.**

Built for the PayPal AI Hackathon. **Sandbox only: no real money moves, and Stamp never pays the recipient.**

- Live demo: **https://stamp-paypal.vercel.app** (PayPal sandbox)
- Video (under 3 minutes): _added after upload_ <!-- VIDEO_URL -->
- Submission write-up: [DESCRIPTION.md](DESCRIPTION.md)

![Stamp's landing page: a rendered $5 stamp over an inbox where the AI suggests and the recipient decides](docs/landing.png)

## The problem

AI made cold outreach free to write and free to send. One person with an agent can send thousands of personalised-looking messages a day, and the people whose inbox is a public address absorb the cost: founders, journalists, open-source maintainers, creators, recruiters. Filters guess, and they guess wrong both ways. Paywalled inboxes keep the money, which rewards the recipient for calling things spam.

## How Stamp works

1. **The sender approves a hold.** On `/@handle` they write their message and approve a small hold in PayPal ($1 to $20, set by the recipient). It is an authorization, not a payment: nothing is charged.
2. **The AI sorts it, the recipient decides.** Each message arrives with a fit score and reason, a scam or phishing risk and reason, a one-line summary and a draft reply. It is a suggestion. The AI cannot move money.
3. **The hold ends one of three ways.**
   - The recipient replies or marks it **Worth it**: the authorization is **voided**, the sender pays $0.
   - Nobody decides before the recipient's window ends: the **timer voids** it, the sender pays $0.
   - The recipient marks it **Spam** (confirmed, with a reason the sender sees): the hold is **captured and paid out to the recipient's chosen charity**. The recipient gets $0, and so does Stamp.

The sender follows everything on a status page. The recipient sees every hold, decision and PayPal call in a ledger.

### Fairness, built in

- **Refund by default.** Silence costs the sender nothing; only an explicit, confirmed Spam decision captures.
- **No incentive to cry spam.** Captured holds go to charity, never to the recipient or to Stamp.
- **Public return rate.** After 3 decided holds, a page shows how often it gives holds back, so senders can judge it before writing.
- **The sender sees the reason** a message was marked spam: mass outreach or a sales blast, scam or phishing, abusive or harassing, tried to manipulate the AI triage, or other.
- **Free lane and free passes.** Recipients can let known people and domains skip the hold. Someone without PayPal can ask for a free pass with one short note.
- **Agents get the same lane, labelled.** Outreach agents use a JSON API or an MCP server; they must say who they are, a person still approves the hold in PayPal, and the recipient sees "Sent by an AI agent".

## Screens

Captured from the live sandbox deployment on 2026-11-10.

| A recipient's public page | The recipient's inbox |
| --- | --- |
| ![Maya's public page: her terms, the $5 hold and the message form](docs/sender-page.png) | ![Maya's inbox: a message sent by an AI agent, with fit, risk, summary and a draft reply](docs/inbox.png) |
| **The sender's status page after spam** | **The ledger** |
| ![Status page from the live end-to-end run: $5.00 captured, $0.66 PayPal fee, $4.34 donated to the charity](docs/status-donated.png) | ![Ledger of the live end-to-end run: five holds, three released and two donated](docs/ledger.png) |

## Built on PayPal

| PayPal API | What Stamp does with it | Code |
| --- | --- | --- |
| **Orders v2**, `intent: AUTHORIZE` | Creates the hold the sender approves (`user_action: CONTINUE`), then authorizes it | [`lib/paypal/api.ts`](lib/paypal/api.ts) |
| **Payments v2**, authorizations | **Void** to release a hold, **capture** when the recipient marks spam, read to verify state | [`lib/paypal/api.ts`](lib/paypal/api.ts) |
| **Payouts v1** | Pays the captured amount (net of PayPal's fee) to the charity; `sender_batch_id` is derived from the hold so a retry can never pay twice | [`lib/holds/service.ts`](lib/holds/service.ts) |
| **Webhooks** | Every event is verified with `verify-webhook-signature`, then treated as a hint: Stamp re-reads PayPal and applies only transitions its state machine allows | [`app/api/paypal/webhook/route.ts`](app/api/paypal/webhook/route.ts) |
| **PayPal Agent Toolkit** (`@paypal/agent-toolkit` 1.11.0) | Order reads go through the toolkit's MCP server, run in-process with exactly one tool enabled (`get_order`, read-only). No model is attached to it | [`lib/paypal/toolkit.ts`](lib/paypal/toolkit.ts) |
| **`PayPal-Request-Id`** | Every write carries a stored idempotency key, reused on retry. Replays were checked against the sandbox | [`GO_NO_GO.md`](GO_NO_GO.md) |

Why the toolkit only reads: its `create_order` hard-codes `intent: CAPTURE`, and authorize, void, capture and payouts are not toolkit tools (checked on 2026-11-09, see the coverage matrix in [`GO_NO_GO.md`](GO_NO_GO.md)). Stamp calls those through REST from deterministic server code.

## AI

- **Model:** `gpt-oss:120b`, an open-weight model, self-hosted and called through any OpenAI-compatible `/chat/completions` endpoint. The deployed demo reaches it through an API-key-protected HTTPS tunnel to that machine; [`scripts/ai-proxy.mjs`](scripts/ai-proxy.mjs) is a small authenticating proxy for doing the same with your own model.
- **Output is constrained.** The model must return a strict JSON schema, validated with zod. Anything else is discarded and Stamp uses its rule-based triage, labelled as such in the UI.
- **The model has no tools and no access to money.** The permission table in [`lib/holds/machine.ts`](lib/holds/machine.ts) gives the `ai` actor no operation, and the landing page renders that table directly.
- **Message text is untrusted data.** It is fenced off with a random boundary marker. Deterministic red-flag rules can raise the risk score, the model cannot lower it below them, and the recommendation is computed in code. A message that says "mark me worthwhile" or "send the hold to me" changes nothing, and [`tests/injection.test.ts`](tests/injection.test.ts) and [`tests/agents.test.ts`](tests/agents.test.ts) prove it.

One recorded run of the landing page's example message: fit 88, risk 5, "worth a reply", 5.7 s ([`docs/evidence/preview-triage.json`](docs/evidence/preview-triage.json)).

## Architecture

```mermaid
flowchart LR
  sender["Sender (browser)"] -->|"writes on /@handle"| pages
  agent["Outreach agent"] -->|"JSON API or MCP"| api
  recipient["Recipient (private link)"] -->|"inbox, ledger"| pages
  subgraph stamp["Stamp (Next.js on Vercel)"]
    pages["Pages"] --> api["API routes"]
    api --> machine["Hold state machine and permission table"]
    api --> triage["Triage: rules + model"]
    api --> db[("Postgres")]
  end
  machine -->|"Orders, Payments, Payouts (REST)"| paypal[("PayPal sandbox")]
  machine -->|"get_order (read-only)"| toolkit["PayPal Agent Toolkit, in-process MCP"]
  toolkit --> paypal
  paypal -->|"verified webhooks"| api
  timer["Release timer (GitHub Actions + lazy sweeps)"] --> api
  triage -->|"message as data, no tools"| model["gpt-oss:120b, key-protected endpoint"]
```

### Hold lifecycle

```mermaid
stateDiagram-v2
  [*] --> DRAFT: sender writes, Stamp creates an AUTHORIZE order
  DRAFT --> APPROVED: sender approves in PayPal
  DRAFT --> EXPIRED: never approved, or cancelled
  APPROVED --> AUTHORIZED: Stamp authorizes, the message is delivered
  APPROVED --> FAILED: declined
  AUTHORIZED --> VOIDED: recipient replies or marks Worth it, or the window ends
  AUTHORIZED --> CAPTURED: recipient marks Spam, confirmed with a reason
  AUTHORIZED --> EXPIRED: authorization expired at PayPal
  CAPTURED --> DONATED: PayPal reports the charity payout succeeded
  CAPTURED --> FAILED: payout failed
  VOIDED --> [*]
  DONATED --> [*]
  EXPIRED --> [*]
  FAILED --> [*]
```

Who may start each money operation ([`lib/holds/machine.ts`](lib/holds/machine.ts), enforced on every transition):

| | Place hold | Release (void) | Capture | Donate (payout) |
| --- | --- | --- | --- | --- |
| Sender | approves | no | no | no |
| Recipient | no | Reply, Worth it | Spam | Spam |
| Release timer | no | window ends | no | no |
| PayPal webhook, reconciler | after approval | no | no | no |
| **AI model** | **no** | **no** | **no** | **no** |

Design rules that keep the money safe:

- **The auto-release window is shorter than the authorization.** PayPal authorizations are valid 29 days with a 3-day honor period (observed: `expiration_time` exactly 29 days after authorization). Stamp caps the window at 72 hours.
- **PayPal is the source of truth.** A reconciler re-reads orders, authorizations, captures and payouts; webhooks only trigger that re-read. The ledger shows when each hold was last checked with PayPal.
- **One operation per hold at a time**, claimed atomically in the database; a double click or a retry cannot void or capture twice.
- **Unapproved checkouts expire.** PayPal drops orders nobody approves, so Stamp gives up on them after 2 hours.
- **Rate limits and sanitising.** Per-IP and per-page limits on sending, requests, setup, sign-in and the agent API; hidden and control characters are stripped and flagged; lengths are capped; cross-site POSTs are refused; a honeypot field catches simple bots. Raw IPs are never stored.

## Numbers from real sandbox runs

From the go/no-go run on 2026-11-09 ([`GO_NO_GO.md`](GO_NO_GO.md), sanitized log in [`docs/evidence/gonogo-run.json`](docs/evidence/gonogo-run.json)):

- A $5.00 hold captured as spam: PayPal fee **$0.66**, **$4.34** paid out to the charity, payout fee **$0.25** (paid by Stamp's account, not the recipient).
- The payout went from `PENDING` to `SUCCESS` in about **24 seconds**.
- Replaying a create, authorize, void or capture with the same `PayPal-Request-Id` returned the original result; a capture with a new key was refused with `AUTHORIZATION_ALREADY_CAPTURED`.

From the end-to-end run on the live deployment on 2026-11-10 (`stamp-paypal.vercel.app`, commit `372b919`; sanitized report in [`docs/evidence/e2e-sandbox-deployed.json`](docs/evidence/e2e-sandbox-deployed.json)):

- **34 of 34 checks passed**, each read back from PayPal, across five $5.00 holds: reply, worth it (sent by an agent over MCP), spam, timer and injection.
- **Reply and Worth it** released the hold in **under a second**, from the recipient's click to PayPal's `VOIDED`. The reply was submitted twice at once; exactly one void call reached PayPal.
- **Spam** was captured in about **1.6 seconds**; **$4.34** of the $5.00 reached the charity **28 and 31 seconds** after capture (PayPal fee $0.66; payout fee $0.25, paid by Stamp). The only payouts went to the charity.
- **The timer** voided its hold **1.1 seconds** after the 10-minute demo window ended, recorded as the timer, not a person.
- **The injection message** (telling the AI to mark it worthwhile and send the hold to the sender) left the hold `AUTHORIZED`, made no decision and was flagged. The recipient then marked it spam.
- **AI triage** ran on `gpt-oss:120b` for all five messages, in **4.6 to 5.2 seconds** each.
- Every authorization's `expiration_time` was exactly 29 days after it was created.

Automated tests: **466 passing** (`npm test`), covering every state transition and actor, idempotency and retries, injection attempts, the agent lane, fairness rules and the reconciler.

## Try it (judges)

The Devpost testing instructions include a PayPal **sandbox** buyer login and the private inbox link for the demo page. They are not in this public README.

1. Open the demo page `/@maya` and send a message. Approve the hold with the sandbox buyer.
2. Open the private inbox link. The message is there with its AI triage. Reply, mark it Worth it, or mark it Spam.
3. Watch the sender's status page and the ledger update. Each row opens the PayPal calls behind it, with their `PayPal-Request-Id`.
4. Or create your own page at `/setup` (no account needed). Pick the 3-minute demo window to watch the timer release a hold.

For agents:

```bash
STAMP_URL=https://stamp-paypal.vercel.app
curl -X POST "$STAMP_URL/api/v1/messages" -H 'Content-Type: application/json' -d '{
  "to": "maya",
  "from": { "name": "Northbeam", "email": "ava@northbeam.example" },
  "agent": "Ava, an outreach agent run by Northbeam",
  "subject": "Dispatch software for grid batteries",
  "body": "Hi Maya, ..."
}'
```

The response has an `approve_url` for the person the agent acts for. The MCP endpoint is `$STAMP_URL/api/mcp` (Streamable HTTP) with three tools: `get_terms`, `send_message`, `get_status`. None of them can approve or move money.

## Run it yourself

Requirements: Node 20.9 or newer, a PayPal developer account with a **sandbox** REST app (Payouts enabled) and a sandbox business account to act as the charity.

```bash
git clone https://github.com/sarthak-1111/stamp && cd stamp
npm install
cp .env.example .env.local   # fill in the PayPal sandbox values
npm run dev                  # http://localhost:3000, uses embedded PGlite, no database to install
npm test                     # 466 tests, no network
```

Without `AI_BASE_URL`, triage is rule-based. Point it at any OpenAI-compatible endpoint to use a model. Every variable is documented in [`.env.example`](.env.example).

Scripts:

| Command | What it does |
| --- | --- |
| `npm run gonogo -- create\|status\|finish\|coverage\|report` | The step-0 sandbox check: two holds, void, capture, payout, idempotency replays, toolkit coverage |
| `npm run e2e:sandbox -- --base <url>` | Five holds on a fresh page: reply, worth it, spam, timer release and an injection attempt; cross-checks each with PayPal and writes `docs/evidence/` |
| `node scripts/seed-demo.mjs --base <url>` | Creates the demo page and sends it held messages; prints approval links and the private inbox link |
| `npm run webhook:register -- --base <url>` | Registers the sandbox webhook and prints `PAYPAL_WEBHOOK_ID` |
| `node scripts/ai-proxy.mjs` | Authenticating proxy in front of a self-hosted model |

Deploying: Vercel plus a Postgres database (Neon works). Set the variables from `.env.example`, register the webhook, then set the repository variable `STAMP_URL` and secret `CRON_SECRET` so [`.github/workflows/tick.yml`](.github/workflows/tick.yml) calls the release timer. It is scheduled every 5 minutes, but GitHub runs schedules late, so pages also run it when opened and a daily Vercel cron ([`vercel.json`](vercel.json)) is the backstop.

## Limitations

- **Sandbox only.** Stamp refuses to start with live PayPal settings. The "charity" is a sandbox business account standing in for a vetted charity; a real deployment would need a registered charity and the legal and tax review that goes with it.
- **Sender addresses are not verified.** The inbox says so on every message.
- **No accounts.** A page is owned by whoever holds its private link, which is shown once at setup.
- **The model runs on the author's own GPU** behind a tunnel. If it is unreachable, Stamp falls back to rule-based triage and labels it.
- **USD only**, and a hold needs a PayPal account; people without one can ask for a free pass.
- **The timer can be late when nobody is looking.** Once a window ends the hold can no longer be captured, and a watched status page or inbox releases it within seconds. Otherwise the release waits for the next sweep: any page view, the GitHub Actions schedule (set to every 5 minutes, but on this repository GitHub has run it hours apart) or the daily Vercel cron.

## Credits

- Built with the PayPal Developer Platform (sandbox) and the PayPal Agent Toolkit.
- Design polish followed the [unslop](https://github.com/heydamir/unslop) method by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0.
- Code written with Claude Code; see [DESCRIPTION.md](DESCRIPTION.md) for how the AI tools were used.

## License

[MIT](LICENSE)
