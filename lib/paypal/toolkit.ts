import 'server-only';
import { getAccessToken, type PayPalJson } from './client';
import { getOrderRest } from './api';

/**
 * Order reads go through the official PayPal Agent Toolkit: its MCP server runs in-process with
 * exactly ONE tool enabled (orders.get, read-only) and is called over an in-memory MCP transport.
 * No model is attached to it. The toolkit cannot move money in Stamp because no write tool is enabled.
 * If the toolkit path fails, Stamp falls back to the same REST endpoint and records which path answered.
 */

export type OrderRead = { status: number; order: PayPalJson | null; via: 'agent-toolkit' | 'rest' };
export type OrderReader = (orderId: string) => Promise<OrderRead>;

async function toolkitGetOrder(orderId: string): Promise<OrderRead> {
  const accessToken = await getAccessToken();
  const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/mcp');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = new PayPalAgentToolkit({
    accessToken,
    configuration: { actions: { orders: { get: true } }, context: { sandbox: true } },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'stamp', version: '1.0.0' });
  await client.connect(clientTransport);
  try {
    const res = await client.callTool({ name: 'get_order', arguments: { id: orderId } });
    const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === 'text')?.text ?? '';
    if (res.isError) throw new Error(`toolkit get_order error: ${text.slice(0, 200)}`);
    const order = JSON.parse(text);
    if (!order?.id) throw new Error('toolkit get_order returned no order');
    return { status: 200, order, via: 'agent-toolkit' };
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

async function restGetOrder(orderId: string): Promise<OrderRead> {
  const r = await getOrderRest(orderId);
  return { status: r.status, order: r.ok ? r.json : null, via: 'rest' };
}

const defaultReader: OrderReader = async (orderId) => {
  try {
    return await toolkitGetOrder(orderId);
  } catch {
    // Not found, toolkit unavailable, or a cold-start problem: REST gives an authoritative status code.
    return restGetOrder(orderId);
  }
};

let reader: OrderReader = defaultReader;

/** Tests read orders from the in-memory PayPal through REST. */
export function setOrderReader(r: OrderReader | 'rest' | null): void {
  reader = r === 'rest' ? restGetOrder : (r ?? defaultReader);
}

export function readOrder(orderId: string): Promise<OrderRead> {
  return reader(orderId);
}
