<!-- DRAFT for review (checkpoint 3). Figures marked E2E come from docs/evidence/e2e-sandbox-deployed.json; if the run differs, the line changes, not the evidence. -->

# Stamp: video script (2:45)

The video shows the deployed demo working end to end in the PayPal sandbox: a sender places a hold, the AI triages, the recipient replies to one message and marks another as spam, the charity is paid, the timer releases a third, and an agent sends one over MCP. Target length 2:45 (the limit is 3:00).

## Scenes

| # | Scene | In | Out | What is on screen |
| --- | --- | --- | --- | --- |
| 1 | hook | 0:00 | 0:13 | Two lines of type on the page background, one after the other. No product yet |
| 2 | idea | 0:13 | 0:29 | The landing hero's rendered $5 stamp settles; the HELD postmark strikes it on "refundable hold". The three outcomes appear as one line each: released, released by the timer, donated |
| 3 | send | 0:29 | 0:56 | Capture of `/@maya`: the terms card, the form filled in (typing sped up, badge says so), "Hold $5 with PayPal and send", the PayPal sandbox approval, the return to the status page with the hold and "nothing charged" |
| 4 | inbox | 0:56 | 1:28 | Capture of the inbox. Push-in on the triage panel of a legitimate message: fit and reason, risk and reason, summary, draft reply. Then the injection message: its red banner, "the hold did not change", the hold still shown as held |
| 5 | decide | 1:28 | 2:02 | Reply on the first message; cut to the sender's status page: released, $0. Spam on the bulk pitch: the confirmation dialog with the reason picker; status page: captured, then donated, with the amounts (E2E) |
| 6 | ledger | 2:02 | 2:22 | The timer: a hold on a demo-window page reaching its release (sped up, badge). Then the ledger: the AI's suggestion next to each decision, a row opened to its PayPal calls and their `PayPal-Request-Id` |
| 7 | agents | 2:22 | 2:34 | A terminal calling `send_message` on `/api/mcp` and getting an `approve_url`; the inbox card with "Sent by an AI agent" |
| 8 | close | 2:34 | 2:45 | The landing page's money table with the AI row's four "No" cells; then the wordmark, the line "Stamp never pays the recipient", the demo and repository URLs |

## Voice-over

One line per row. "Says" spells numbers out for the voice; "Caption" shows the figures and is burned in.

| Line | Scene | Says | Caption |
| --- | --- | --- | --- |
| h1 | hook | AI made cold outreach free to write, and free to send. | AI made cold outreach free to write, and free to send. |
| h2 | hook | If your inbox is a public address, you pay for it with your attention. | If your inbox is a public address, you pay for it with your attention. |
| i1 | idea | Stamp puts a price on reaching you, and gives it back. | Stamp puts a price on reaching you, and gives it back. |
| i2 | idea | To write to you, a stranger places a small refundable hold in PayPal. | To write to you, a stranger places a small refundable hold in PayPal. |
| i3 | idea | Real messages get it back. Spam pays a charity. | Real messages get it back. Spam pays a charity. |
| s1 | send | This is Maya's page. Her terms are public: a five dollar hold, the topics she cares about, where spam money goes, and how often she gives holds back. | This is Maya's page. Her terms are public: a $5 hold, the topics she cares about, where spam money goes, and how often she gives holds back. |
| s2 | send | A sender writes, then approves the hold in the PayPal sandbox. It's an authorization, not a payment. No PayPal? They can ask for a free pass. | A sender writes, then approves the hold in the PayPal sandbox. It's an authorization, not a payment. No PayPal? They can ask for a free pass. |
| s3 | send | The status page shows the hold, and that nothing has been charged. | The status page shows the hold, and that nothing has been charged. |
| n1 | inbox | In Maya's inbox, the AI reads each message and suggests: how well it fits her topics, the scam risk, a one line summary and a draft reply. | In Maya's inbox, the AI reads each message and suggests: fit with her topics, scam risk, a one-line summary and a draft reply. |
| n2 | inbox | This one tells the AI to mark it worthwhile, and to send the hold back to the sender. | This one tells the AI to mark it worthwhile, and to send the hold back to the sender. |
| n3 | inbox | Message text is data, not instructions, and the AI has no way to move money. The hold doesn't change. | Message text is data, not instructions, and the AI has no way to move money. The hold doesn't change. |
| d1 | decide | Maya replies. PayPal voids the authorization, and the sender pays nothing. | Maya replies. PayPal voids the authorization, and the sender pays nothing. |
| d2 | decide | She marks the bulk pitch as spam, and picks a reason the sender will see. | She marks the bulk pitch as spam, and picks a reason the sender will see. |
| d3 | decide | PayPal captures the hold and pays it out to her charity: four dollars thirty four, after PayPal's fee. Maya gets nothing, and neither does Stamp. | PayPal captures the hold and pays it out to her charity: $4.34, after PayPal's fee (E2E). Maya gets nothing, and neither does Stamp. |
| l1 | ledger | If she never decides, a timer releases the hold, always within PayPal's three day honor period. | If she never decides, a timer releases the hold, always within PayPal's 3-day honor period. |
| l2 | ledger | The ledger shows every hold, the AI's suggestion next to her decision, and each PayPal call with its idempotency key. | The ledger shows every hold, the AI's suggestion next to her decision, and each PayPal call with its idempotency key. |
| a1 | agents | Outreach agents get the same lane, through an API or MCP. A person still approves the hold, and Maya sees that an agent wrote it. | Outreach agents get the same lane, through an API or MCP. A person still approves the hold, and Maya sees that an agent wrote it. |
| c1 | close | The AI reads. It never pays. | The AI reads. It never pays. |
| c2 | close | Stamp. Strangers can reach you. Spam pays a charity. | Stamp. Strangers can reach you. Spam pays a charity. |

About 340 words: roughly 2:15 of voice at the pipeline's pace, leaving room for the PayPal approval, the dialog and the two status-page reveals to play without narration.

## How it is made

The same pipeline as `D:\stepswitch_HN\video` (see its `VIDEO-PIPELINE.md`), adapted:

- **Captures:** Playwright records the deployed demo at 1920x1080 with an injected cursor, click ripple and follow-scroll; no browser chrome is recorded. The PayPal sandbox approval is recorded with a person at the keyboard (sandbox buyer login), because the build never types PayPal credentials.
- **Scenes:** Remotion for the hook, the idea scene (the rendered stamp and postmark from the landing page), the frames around captures, the push-ins and the close card.
- **Voice:** Bark text-to-speech, several seeded takes per line, each scored with faster-whisper; the lowest word error rate wins.
- **Music:** a bed synthesised from oscillators and noise (CC0), no samples, ducked under the voice.
- **Master:** FFmpeg: dissolves, burned-in captions, loudness -14 to -16 LUFS integrated, true peak under -1.5 dBTP; 1920x1080, 30 fps, H.264 + AAC, under 3:00.

## Honesty notes

- Everything on screen is the deployed sandbox demo. Sped-up parts (typing, the timer) carry an on-screen badge.
- Scene 3 is recorded after Maya has decided at least three holds, so the return rate on her page is real, not a placeholder.
- Every figure comes from a recorded run: the $5 hold and the $4.34 payout from the deployed end-to-end run (E2E), the honor period from PayPal's documentation as cited in `API_NOTES.md`.
- No third-party logos or music. PayPal appears only as its own sandbox checkout and in the API names, as part of the flow being demonstrated. The people and companies in the messages are invented and use reserved `.example` domains.
