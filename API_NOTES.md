# API notes: what the official PayPal docs say

Everything in this file is quoted from official PayPal sources. Quotes are verbatim, and the source and the date it was fetched (2026-11-06) are given for each. Observed sandbox behaviour is kept separate, under **Observed in sandbox**, and comes from `scripts/gonogo.mjs` runs (see `GO_NO_GO.md` and `docs/evidence/gonogo-run.json`).

## 1. How long an authorization stays capturable

### Checkout guide: "Authorize a payment and capture funds later"
Source: <https://developer.paypal.com/docs/checkout/standard/customize/authorization/> (page shows "Last updated: October 14, 2026")

> Authorize a buyer's funds before you capture them, then settle the purchase later. An authorization places a hold on the funds and is valid for 29 days. For example, use authorize and capture to complete a task before finalizing the payment, such as verifying that you have the item in stock.

> A hold on the money that is valid for 29 days. After a successful authorization, capture the payment within the 3-day honor period. Payment capture is subject to risk and money availability.

Section "5. Reauthorize payment":

> If you haven't captured the payment within 3 days of authorization, you can reauthorize the payment to make sure the money is still available.
>
> You can issue multiple reauthorizations within the 29-day authorization period after the honor period expires. A reauthorization generates a new authorization ID and restarts the 3-day honor period. Use the new authorization ID on subsequent captures.
>
> If you reauthorize on the 27th day of the authorization period, you get only 2 days of the honor period.

### Payments v2 API reference: "Reauthorize authorized payment"
Source: the official OpenAPI document behind <https://developer.paypal.com/docs/api/payments/v2/>, published at <https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/payments_payment_v2.json> (`info.version` 2.12, last commit `81921a59da30`, 2026-04-07), operation `POST /v2/payments/authorizations/{authorization_id}/reauthorize`:

> Reauthorizes an authorized PayPal account payment, by ID. To ensure that funds are still available, reauthorize a payment after its initial three-day honor period expires. Within the 29-day authorization period, you can issue multiple re-authorizations after the honor period expires.
>
> If 30 days have transpired since the date of the original authorization, you must create an authorized payment instead of reauthorizing the original authorized payment.
>
> A reauthorized payment itself has a new honor period of three days.
>
> You can reauthorize an authorized payment from 4 to 29 days after the 3-day honor period. The allowed amount depends on context and geography, for example in US it is up to 115% of the original authorized amount, not to exceed an increase of $75 USD.
>
> Supports only the `amount` request parameter.

Same document, `POST /v2/payments/authorizations/{authorization_id}/void`:

> Voids, or cancels, an authorized payment, by ID. You cannot void an authorized payment that has been fully captured.

Same document, `authorization.expiration_time`:

> The date and time when the authorized payment expires, in [Internet date and time format](https://tools.ietf.org/html/rfc3339#section-5.6).

Same document, `authorization_status.status` enum: `CREATED`, `CAPTURED`, `DENIED`, `PARTIALLY_CAPTURED`, `VOIDED`, `PENDING`.

### Summary
| Question | Answer (per the docs above) |
|---|---|
| Validity of an authorization | 29 days ("valid for 29 days"); `expiration_time` on the authorization is authoritative. |
| Honor period | 3 days after a successful authorization ("capture the payment within the 3-day honor period"). Capture after that is not guaranteed ("subject to risk and money availability"). |
| Can it be reauthorized? | Yes, but only after the 3-day honor period has expired and within the 29-day period. The current docs say multiple reauthorizations are allowed. Each one creates a new authorization ID with a new 3-day honor period. After 30 days a new authorization is needed. US limit: up to 115% of the original, at most +$75. |
| Note | Older versions of PayPal's docs said a payment could be reauthorized only once. The current guide and API reference both say "multiple". Stamp never reauthorizes (see design consequences), so this does not affect us. |

### Design consequences for Stamp
- The auto-release window must end inside the **3-day honor period**. That is stricter than the 29-day validity, and it means a "Spam" capture is always made while the funds are still honored. Stamp caps the window at **72 hours**. The default is 48 hours, and the demo can set it as low as a few minutes.
- Stamp never reauthorizes. A hold that reaches the end of its window is **voided** (auto-release), never extended.
- The reconciler treats PayPal's authorization `status` and `expiration_time` as the source of truth.

## 2. Idempotency (`PayPal-Request-Id`)

Source: <https://developer.paypal.com/api/rest/reference/idempotency/> ("Last updated: August 11, 2026")

> To enforce idempotency on REST API POST calls, use the PayPal-Request-Id request header, which contains a unique user-generated ID that the server stores for a period of time.

> For example, when you include a previously specified PayPal-Request-Id header in a request, PayPal returns the latest status of the previous request that used that same header. Conversely, when you omit the PayPal-Request-Id header from a request, PayPal duplicates the request.

> Note: When you send two simultaneous API requests with same PayPal-Request-Id header, PayPal processes the first request and might fail the second request.

> The PayPal-Request-Id header value must be unique for both each request and an API call type. For example, authorize payment and capture authorized payment.

> PayPal recommends that you use the UUID standard for the PayPal-Request-Id header value because it meets the 38 single-byte character limit.

Key retention, per API (official OpenAPI documents in `paypal/paypal-rest-api-specifications`):
- Orders v2, `POST /v2/checkout/orders` (`checkout_orders_v2.json`, `info.version` 2.32): "The server stores keys for 6 hours. The API callers can request the times to up to 72 hours by speaking to their Account Manager."
- Payouts v1, `POST /v1/payments/payouts` (`payments_payouts_batch_v1.json`, `info.version` 1.9): "The server stores keys for 30 days."

Payouts also dedupe on `sender_batch_id`. From the same Payouts document:

> PayPal does not process duplicate payouts. If you specify a `sender_batch_id` that was used in the last 30 days, the API rejects the request with an error message that shows the duplicate `sender_batch_id` and includes a HATEOAS link to the original payout with the same `sender_batch_id`.
>
> If you receive an HTTP `5nn` status code, you can safely retry the request with the same `sender_batch_id`. The API completes a payment only once for a `sender_batch_id` that is used within 30 days.

Design consequence: every Stamp write stores its `PayPal-Request-Id` before sending, and reuses it on retry. Each payout uses a deterministic `sender_batch_id` derived from the hold ID, so a retried donation can never pay twice.

## 3. Payouts batch status

Source: <https://developer.paypal.com/docs/payouts/standard/integrate-api/> ("Last updated: September 10, 2026")

> Possible values: SUCCESS, PENDING, PROCESSING, DENIED, CANCELED.
> PayPal may process the batch immediately or later. If the status is PENDING, check again later.
> To retry after a server error (such as HTTP 5xx), send the request again with the same sender_batch_id within 30 days.

## 4. Webhooks

Event names Stamp subscribes to, from <https://developer.paypal.com/api/rest/webhooks/event-names/>: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTSBATCH.DENIED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.FAILED`, `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`, `PAYMENT.PAYOUTS-ITEM.RETURNED`.

Signature verification, from <https://developer.paypal.com/api/rest/webhooks/rest/> ("Last updated: June 18, 2026"):

> Alternatively to the above, rather than verifying the signature yourself you can post the event back to the verify-webhook-signature REST API endpoint.

> You may use the Webhooks simulator to generate mock events. [...] (Note: Postback verification to the verify-webhook-signature endpoint is not supported for mock events.) For message signature verification purposes, the ID of mock webhooks is the string: WEBHOOK_ID.

Design consequence: Stamp verifies every webhook with `POST /v1/notifications/verify-webhook-signature` before acting on it. Even then it treats the event as a *hint*: it re-reads the order or authorization from PayPal and only applies the transitions its own state machine allows.

## 5. Agent Toolkit and MCP server

Source: <https://developer.paypal.com/tools/mcp-server/>

> PayPal's MCP server offers a variety of helpful tools for performing many jobs. The complete catalog of tools is available in both local and remote MCP server.

The coverage check against `@paypal/agent-toolkit@1.11.0` is in `GO_NO_GO.md`, step 6.

## Observed in sandbox
From real runs of `scripts/gonogo.mjs` (details in `GO_NO_GO.md`, raw log in `docs/evidence/gonogo-run.json`):

| Observation | Value |
|---|---|
| Authorization `expiration_time − create_time` | **29.00 days**, for both authorizations (2026-11-09T00:10:02Z → 2026-12-08T00:10:02Z) |
| Order status right after `authorize` | `COMPLETED`. The hold's state lives on the authorization (`CREATED`). |
| Void response with `Prefer: return=representation` | HTTP 200 with body, `status: VOIDED`. Replaying it with the same `PayPal-Request-Id` also returned 200 `VOIDED`. |
| Capture of $5.00 | HTTP 201 `COMPLETED`; `seller_receivable_breakdown`: gross 5.00, PayPal fee 0.66, net 4.34 (USD) |
| Capture replay, same key / new key | 200 with the same capture ID / 422 `AUTHORIZATION_ALREADY_CAPTURED` |
| Capture of a voided authorization | 422 `AUTHORIZATION_VOIDED` |
| Payout of $4.34 | `PENDING` → `SUCCESS` in 24 s (batch created 00:10:19Z, completed 00:10:43Z); payout item fee 0.25 USD, charged to the sender |
| Payout with a reused `sender_batch_id` | 400 `USER_BUSINESS_ERROR` "Batch with given sender_batch_id already exists" |
| Order created but never approved | Still `PAYER_ACTION_REQUIRED` at +2 h 59 min; 404 `RESOURCE_NOT_FOUND` the next day |
| Remote MCP transports (2026-11-06 and 2026-11-09) | `https://mcp.sandbox.paypal.com/http` → 404; `https://mcp.sandbox.paypal.com/sse` with a client-credentials bearer token → works, 46 tools |
