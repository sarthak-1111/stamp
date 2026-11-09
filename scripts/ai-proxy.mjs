#!/usr/bin/env node
/**
 * Stamp: a small authenticating proxy in front of a self-hosted, OpenAI-compatible model server.
 *
 *   AI_PROXY_KEY=<long random string> node --env-file=.env.local scripts/ai-proxy.mjs
 *
 * Why: the model server (for example Ollama serving gpt-oss) usually listens on a private network and
 * accepts requests without a key. A deployed Stamp cannot reach it, and it must not be exposed as is.
 * Run this proxy next to the model, expose ONLY the proxy through a tunnel, and give the deployed app
 *   AI_BASE_URL=https://<tunnel host>/v1   AI_API_KEY=<AI_PROXY_KEY>
 *
 * The proxy:
 *   - requires "Authorization: Bearer <AI_PROXY_KEY>" (constant-time compare)
 *   - forwards only POST /v1/chat/completions and GET /v1/models
 *   - only allows the configured model, caps max_tokens and the body size
 *   - rate-limits to AI_PROXY_RPM requests per minute (default 60)
 *   - logs one line per request, never the message text
 *
 * Env: AI_PROXY_KEY (required), AI_UPSTREAM_URL (default: AI_BASE_URL without /v1), AI_UPSTREAM_KEY
 * (default: AI_API_KEY), AI_MODEL (default gpt-oss:120b), AI_PROXY_PORT (default 8787), AI_PROXY_RPM.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const KEY = process.env.AI_PROXY_KEY || '';
if (KEY.length < 24) {
  console.error('Set AI_PROXY_KEY to a long random string (24+ characters).');
  process.exit(2);
}
const UPSTREAM = (process.env.AI_UPSTREAM_URL || (process.env.AI_BASE_URL || '').replace(/\/v1\/?$/, '')).replace(/\/+$/, '');
if (!UPSTREAM) {
  console.error('Set AI_UPSTREAM_URL (or AI_BASE_URL) to the model server, for example http://192.168.0.12:11434');
  process.exit(2);
}
const UPSTREAM_KEY = process.env.AI_UPSTREAM_KEY ?? process.env.AI_API_KEY ?? '';
const MODEL = process.env.AI_MODEL || 'gpt-oss:120b';
const PORT = Number(process.env.AI_PROXY_PORT) || 8787;
const RPM = Number(process.env.AI_PROXY_RPM) || 60;
const MAX_BODY = 64 * 1024;
const MAX_TOKENS = 4096;

const digest = (s) => createHash('sha256').update(s).digest();
const KEY_DIGEST = digest(`Bearer ${KEY}`);
const authorized = (h) => typeof h === 'string' && timingSafeEqual(digest(h), KEY_DIGEST);

let windowStart = Date.now();
let count = 0;
function allow() {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    count = 0;
  }
  count += 1;
  return count <= RPM;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const path = (req.url || '').split('?')[0];
  let status = 500;
  try {
    if (!authorized(req.headers.authorization)) return send(res, (status = 401), { error: { message: 'unauthorized' } });
    if (!allow()) return send(res, (status = 429), { error: { message: 'rate limited' } });

    if (req.method === 'GET' && path === '/v1/models') {
      return send(res, (status = 200), { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'self-hosted' }] });
    }
    if (req.method !== 'POST' || path !== '/v1/chat/completions') return send(res, (status = 404), { error: { message: 'not found' } });

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return send(res, (status = err.status || 400), { error: { message: err.status ? 'request too large' : 'invalid JSON' } });
    }
    if (body.model !== MODEL) return send(res, (status = 400), { error: { message: `only ${MODEL} is served here` } });
    if (body.stream) return send(res, (status = 400), { error: { message: 'streaming is not supported by this proxy' } });
    body.max_tokens = Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS);

    const upstream = await fetch(`${UPSTREAM}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(UPSTREAM_KEY ? { Authorization: `Bearer ${UPSTREAM_KEY}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    status = upstream.status;
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    status = 502;
    if (!res.headersSent) send(res, 502, { error: { message: 'upstream unavailable' } });
    else res.end();
    console.error(`upstream error: ${err?.name ?? 'error'}`);
  } finally {
    console.log(`${new Date().toISOString()} ${req.method} ${path} -> ${status} ${Date.now() - started}ms`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI proxy on http://127.0.0.1:${PORT} -> ${new URL(UPSTREAM).host} (model ${MODEL}, ${RPM}/min)`);
  console.log('Expose only this port through a tunnel. Never expose the model server directly.');
});
