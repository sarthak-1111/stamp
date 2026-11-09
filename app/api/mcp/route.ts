import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { AGENT_RULES, agentSend, apiError, getAgentStatus, getTerms, parseAgentSend } from '@/lib/agents';
import { preflight, withCors } from '@/lib/cors';
import { clientIpHash, LIMITS, takeRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export const OPTIONS = preflight;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

const ok = (data: Record<string, unknown>): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const fail = (data: Record<string, unknown>): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true });

/**
 * Stamp's MCP server (Streamable HTTP, stateless). Three tools, no way to approve or move money:
 * the hold is placed only after a person approves it in PayPal.
 */
function buildServer(ipHash: string | null): McpServer {
  const server = new McpServer(
    { name: 'stamp', version: '1.0.0' },
    { instructions: `Stamp lets you reach a person by attaching a small refundable PayPal hold to your message. ${AGENT_RULES}` },
  );

  server.registerTool(
    'get_terms',
    {
      title: 'Get a Stamp page’s terms',
      description: 'Read the price, release window, charity, topics and public return rate of a Stamp page before writing to it.',
      inputSchema: { handle: z.string().min(1).max(40).describe('The page handle, for example "maya"') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ handle }) => {
      if (!(await takeRateLimit(`api-read:${ipHash}`, LIMITS.status.limit, LIMITS.status.windowSeconds))) return fail({ error: 'rate_limited' });
      const terms = await getTerms(handle.replace(/^@/, '').toLowerCase()).catch(() => null);
      return terms ? ok(terms) : fail({ error: 'not_found', message: 'There is no Stamp page with that handle.' });
    },
  );

  server.registerTool(
    'send_message',
    {
      title: 'Send a stamped message',
      description:
        'Write to a Stamp page. Returns approve_url: give it to the person you act for so they can approve the refundable hold in PayPal. ' +
        'The message is delivered only after that approval. You must identify yourself in `agent`; the recipient sees it.',
      inputSchema: {
        to: z.string().min(1).max(40).describe('Recipient handle'),
        from_name: z.string().min(1).max(80).describe('Name of the person or company you write for'),
        from_email: z.string().min(3).max(254).describe('Email the recipient can reply to'),
        agent: z.string().min(2).max(80).describe('Who is sending, for example "Ava, an outreach agent run by Northbeam"'),
        subject: z.string().min(1).max(120),
        body: z.string().min(10).max(2000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const parsed = parseAgentSend({ to: args.to, from: { name: args.from_name, email: args.from_email }, agent: args.agent, subject: args.subject, body: args.body });
      if (!parsed.ok) return fail({ error: 'invalid', fields: parsed.errors });
      const okIp = await takeRateLimit(`api:${ipHash}`, LIMITS.api.limit, LIMITS.api.windowSeconds);
      const okPage = await takeRateLimit(`send-page:${parsed.data.handle}`, LIMITS.sendPerPage.limit, LIMITS.sendPerPage.windowSeconds);
      if (!okIp || !okPage) return fail({ error: 'rate_limited', message: 'Too many messages right now. Try again in a few minutes.' });
      try {
        return ok(await agentSend(parsed.data, 'mcp', ipHash));
      } catch (err) {
        return fail(apiError(err).body);
      }
    },
  );

  server.registerTool(
    'get_status',
    {
      title: 'Check a stamped message',
      description: 'Where a message stands: waiting for approval, held, released, replied, or donated as spam (with the reason).',
      inputSchema: { status_token: z.string().min(8).max(64).describe('status_token returned by send_message') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status_token }) => {
      if (!(await takeRateLimit(`api-read:${ipHash}`, LIMITS.status.limit, LIMITS.status.windowSeconds))) return fail({ error: 'rate_limited' });
      const status = await getAgentStatus(status_token).catch(() => null);
      return status ? ok(status) : fail({ error: 'not_found' });
    },
  );

  return server;
}

async function handle(req: Request): Promise<Response> {
  const server = buildServer(clientIpHash(req.headers));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } finally {
    void server.close().catch(() => undefined);
  }
}

// PayPal calls and AI triage (run after the response via after()) need more than a 10 s default.
export const maxDuration = 60;
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
