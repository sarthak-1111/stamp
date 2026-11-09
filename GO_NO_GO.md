# Step 0: Go/No-Go (PayPal sandbox)

**Verdict: GO.** Steps 2–5 all succeeded against the PayPal **sandbox** on 2026-11-09 (UTC). No live money was involved at any point.

Everything below comes from a real run of [`scripts/gonogo.mjs`](scripts/gonogo.mjs). The sanitized log of all 30 calls (HTTP status, `paypal-debug-id`, `PayPal-Request-Id`, timestamps) is in [`docs/evidence/gonogo-run.json`](docs/evidence/gonogo-run.json). Emails are masked; tokens and secrets are never written.

## Setup
| Item | Value |
|---|---|
| Sandbox REST app | "Stamp" (type Merchant), region US, Payouts enabled |
| Stamp merchant account (holds are placed and captured here) | `sb-anul***@business.example.com` (Business, US) |
| Charity account (receives payouts) | `sb-0fvu***@business.example.com` (Business, US) |
| Sender/buyer account (approves holds) | `sb-j4i8***@personal.example.com` (Personal, US) |
| Libraries | `@paypal/agent-toolkit` 1.11.0, `@modelcontextprotocol/sdk` 1.32.2, Node 20.12.1 |

The dashboard's default sandbox accounts were in the JP region. US accounts were created so that USD holds and USD payouts settle without currency-acceptance steps.

## Results
| # | Step | Result | Evidence (real values) |
|---|---|---|---|
| 1 | OAuth token (client credentials) | **PASS** | HTTP 200, `Bearer`, `expires_in` 32400 s. Token scopes include `https://uri.paypal.com/payments/payouts`. |
| 2a | Create order #1, `intent: AUTHORIZE`, $5.00 USD | **PASS** | `9M270105LV7490357`, status `PAYER_ACTION_REQUIRED`, HTTP 200 |
| 2b | Buyer approval (manual, see below) | **PASS** | Read back through the Agent Toolkit `get_order` tool as `APPROVED` |
| 2c | Authorize order #1 | **PASS** | HTTP 201, authorization `2KL15008VG116734L` `CREATED`, `create_time` 2026-11-09T00:10:02Z, `expiration_time` 2026-12-08T00:10:02Z (29.00 days) |
| 2d | **Void** authorization #1 | **PASS** | HTTP 200 `VOIDED`. GET confirms `VOIDED` (update_time 00:10:05Z). `get_order` via toolkit shows authorizations `["VOIDED"]`, captures `[]`. |
| 3a | Create order #2 (`AUTHORIZE`, $5.00) | **PASS** | `9AL316445N437950S` |
| 3b | Buyer approval (manual) | **PASS** | `APPROVED` via toolkit `get_order` |
| 3c | Authorize order #2 | **PASS** | HTTP 201, authorization `7L349008C5240583S`, expires 2026-12-08T00:10:11Z (29.00 days) |
| 3d | **Capture** authorization #2 (`final_capture: true`) | **PASS** | HTTP 201, capture `79H49583CL366893Y` `COMPLETED`. Gross **$5.00**, PayPal fee **$0.66**, net **$4.34**. |
| 4 | Authorization honor period / validity from the official docs | **DONE** | [`API_NOTES.md`](API_NOTES.md). Docs: valid 29 days, 3-day honor period, reauthorization possible after the honor period. Observed: `expiration_time` = authorization time + exactly 29 days. |
| 5 | **Payout** to the charity sandbox account | **PASS** | Batch `7S6Y6RQ9CWHCQ`, $4.34 (the net capture) to the charity. `PENDING` → `SUCCESS` (created 00:10:19Z, completed 00:10:43Z). Item `X8XZALW5T4LUJ` `SUCCESS`, transaction `8J311422SA0880629`, payout fee **$0.25** (paid by the sender). |
| 6 | Agent Toolkit / MCP coverage | **DONE** | See the matrix below. |

## Idempotency and PayPal-side guards (observed)
Every write was sent with a fresh UUID `PayPal-Request-Id`, then replayed.

| Replay | Result |
|---|---|
| Create order again with the **same** `PayPal-Request-Id` | Same order ID returned (no duplicate order) |
| Authorize again with the same key (orders #1 and #2) | HTTP 201, **same** authorization ID |
| Void again with the same key | HTTP 200, `VOIDED` (no error, no side effect) |
| Capture again with the same key | HTTP 200, **same** capture `79H49583CL366893Y` |
| Capture again with a **new** key | HTTP 422 `AUTHORIZATION_ALREADY_CAPTURED` |
| Capture a **voided** authorization | HTTP 422 `AUTHORIZATION_VOIDED` |
| Payout again with the same `sender_batch_id` (new request ID) | HTTP 400 `USER_BUSINESS_ERROR`, "Batch with given sender_batch_id already exists" |

So a retried capture or payout cannot double-charge or double-donate. Stamp's own state machine still guards every transition first. PayPal's 422s are a second line of defence.

## Step 6: which operations the Agent Toolkit / MCP server covers
Checked live on 2026-11-09:
- **Local:** `@paypal/agent-toolkit` 1.11.0 MCP server, in-process, `tools/list` → **47 tools**.
- **Remote:** PayPal's hosted sandbox MCP server, `https://mcp.sandbox.paypal.com/sse` with a client-credentials bearer token → **46 tools**: the same set minus `update_plan`.
- The documented streamable-HTTP endpoint `…/http` returned HTTP 404 (also seen on 2026-11-06). SSE worked.

| Operation Stamp needs | Toolkit / MCP | Stamp uses |
|---|---|---|
| Create order with `intent: AUTHORIZE` | **Not covered.** `create_order` exists, but its input schema has no `intent` field and the implementation hard-codes `intent: "CAPTURE"`. | Direct REST: `POST /v2/checkout/orders` |
| Get order | **Covered:** `get_order` (local and remote) | **Toolkit** `get_order`, called through an in-process MCP client on a server configured with only `orders.get`. Used for the approval check and for reconciliation (order status plus nested authorization and capture states). |
| Authorize order | Not covered | Direct REST: `POST /v2/checkout/orders/{id}/authorize` |
| Void authorization | Not covered | Direct REST: `POST /v2/payments/authorizations/{id}/void` |
| Capture authorization | Not covered (`pay_order` captures a CAPTURE-intent *order*, not an authorization) | Direct REST: `POST /v2/payments/authorizations/{id}/capture` |
| Payouts (create + status) | Not covered | Direct REST: `POST /v1/payments/payouts`, `GET /v1/payments/payouts/{id}` |
| Webhook signature verification | Not covered | Direct REST: `POST /v1/notifications/verify-webhook-signature` |

The AI layer gets **no PayPal tools at all**. The toolkit is used deterministically by server code, and only for reads.

## The manual approval step (how to repeat it)
1. `npm run gonogo -- create` prints two `https://www.sandbox.paypal.com/checkoutnow?token=…` links.
2. Open each link and log in as the sandbox **Personal** (buyer) account. The password is in Developer Dashboard → Testing Tools → Sandbox Accounts → View/Edit account.
3. Click **Continue to Review Order** (the orders use `user_action: CONTINUE`, so this approves the hold and charges nothing). The browser then lands on `example.com`, which is expected.
4. `npm run gonogo -- status` confirms `APPROVED` through the toolkit. Then run `finish`, `coverage` and `report`.

## What this run taught us (inputs to the build)
- **Unapproved orders disappear.** A first pair of orders (created 2026-11-06 08:34Z) was still `PAYER_ACTION_REQUIRED` at +2 h 59 min, and returned HTTP 404 `RESOURCE_NOT_FOUND` the next day. Stamp must time out holds the sender never approved (→ `EXPIRED`).
- **After `authorize`, the order itself is `COMPLETED`.** The hold lives on the *authorization* (`CREATED` → `VOIDED` / `CAPTURED`). Reconciliation must read authorization and capture states, not just order status.
- **Validity observed:** `expiration_time` is exactly 29 days after authorization. Per the docs, capture is only guaranteed in the first 3 days (honor period), so Stamp caps its auto-release window at 72 h.
- **Payouts are asynchronous** (`PENDING` → `SUCCESS` in ~24 s here). `CAPTURED → DONATED` happens only after PayPal reports the payout item `SUCCESS` (webhook or reconciler).
- **Fees (sandbox):** a $5.00 capture cost $0.66 in PayPal fees, so the charity received the net $4.34. The $0.25 payout fee was charged to the sender (Stamp's account) on top. The recipient never receives anything.

## Reproduce
```bash
npm install
# .env.local: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (sandbox app), CHARITY_PAYPAL_EMAIL (sandbox account)
npm run gonogo -- create      # then approve both links as the sandbox buyer
npm run gonogo -- status      # both APPROVED?
npm run gonogo -- finish      # authorize, void, capture, payout, replays
npm run gonogo -- coverage    # toolkit + remote MCP tool lists
npm run gonogo -- report      # writes docs/evidence/gonogo-run.json
```
