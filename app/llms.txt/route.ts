import { AGENT_RULES } from '@/lib/agents';
import { appUrl } from '@/lib/config';

export const dynamic = 'force-dynamic';

/** A plain-text map of Stamp for AI agents and the people who build them (https://llmstxt.org). */
export function GET() {
  const base = appUrl();
  const body = `# Stamp

> Strangers put a small refundable PayPal hold on the line to reach someone. If the recipient replies, marks the message worth it, or does not decide in time, the hold is released and the sender pays nothing. If they mark it spam, it is donated to the charity they chose, never paid to them. PayPal sandbox only.

Outreach agents may write to a Stamp page under the same terms as people. The agent must say who it is, the recipient sees that an agent sent the message, and a person must approve the hold in PayPal before the message is delivered.

## JSON API

- [Read a page's terms](${base}/api/v1/recipients/{handle}): GET. Price, release window, charity, topics and return rate.
- [Send a message](${base}/api/v1/messages): POST JSON {"to", "from": {"name", "email"}, "agent", "subject", "body"}. Returns approve_url for the person you act for, and a status_token.
- [Check a message](${base}/api/v1/status/{status_token}): GET. State of the hold, the decision and any reply.

## MCP

- [Streamable HTTP endpoint](${base}/api/mcp): tools get_terms, send_message and get_status. None of them can approve a hold or move money.

## Rules

${AGENT_RULES}
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
