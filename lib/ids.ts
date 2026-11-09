import 'server-only';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** Short, URL-safe, unguessable identifiers. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

/** Bearer-style secret (status links, owner keys). 192 bits. */
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** PayPal-Request-Id: PayPal recommends a UUID (38 single-byte characters max). */
export function newRequestId(): string {
  return randomUUID();
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function hmac(secret: string, s: string): string {
  return createHmac('sha256', secret).update(s).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
