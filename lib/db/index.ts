import 'server-only';
import { SCHEMA, SCHEMA_VERSION } from './schema';

export type Row = Record<string, unknown>;

/** Minimal driver interface: every Stamp write is a single SQL statement, so no interactive transactions. */
export interface Db {
  kind: 'neon' | 'pglite';
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  close?(): Promise<void>;
}

const g = globalThis as unknown as { __stampDb?: Promise<Db> };

/**
 * Production: Neon serverless Postgres over HTTP (DATABASE_URL).
 * Local dev: PGlite persisted in .data/pglite. Tests: in-memory PGlite (STAMP_DB=memory).
 */
export function getDb(): Promise<Db> {
  if (!g.__stampDb) {
    g.__stampDb = open().catch((err) => {
      g.__stampDb = undefined;
      throw err;
    });
  }
  return g.__stampDb;
}

async function open(): Promise<Db> {
  const url = (process.env.DATABASE_URL ?? '').trim();
  const mode = (process.env.STAMP_DB ?? '').trim();
  const db =
    url && mode !== 'memory'
      ? await openNeon(url)
      : await openPglite(mode === 'memory' ? undefined : process.env.PGLITE_DIR || '.data/pglite');
  await migrate(db);
  return db;
}

export async function openPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) (await import('node:fs')).mkdirSync(dir, { recursive: true });
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return {
    kind: 'pglite',
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pg.query(text, params as never[]);
      return res.rows as T[];
    },
    async close() {
      await pg.close();
    },
  };
}

async function openNeon(url: string): Promise<Db> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return {
    kind: 'neon',
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.query(text, params)) as T[];
    },
  };
}

export async function migrate(db: Db): Promise<void> {
  try {
    const rows = await db.query<{ version: number }>('SELECT version FROM schema_meta WHERE id = 1');
    if (rows[0] && rows[0].version >= SCHEMA_VERSION) return;
  } catch {
    // schema_meta does not exist yet
  }
  for (const stmt of SCHEMA) {
    try {
      await db.query(stmt);
    } catch (err) {
      // Two cold starts migrating at once can race on CREATE ... IF NOT EXISTS; retry once.
      await db.query(stmt).catch(() => {
        throw err;
      });
    }
  }
  await db.query(
    'INSERT INTO schema_meta (id, version) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version',
    [SCHEMA_VERSION],
  );
}

/** Tests: give every test file its own empty in-memory database. */
export async function useFreshTestDb(): Promise<Db> {
  const db = await openPglite();
  await migrate(db);
  g.__stampDb = Promise.resolve(db);
  return db;
}

export function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
