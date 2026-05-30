import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

declare global {
  var __platformDbClient: ReturnType<typeof postgres> | undefined;
  var __platformDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function readUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Provide a Postgres connection string (postgres://user:pass@host:5432/db).',
    );
  }
  return url;
}

export function getDb() {
  if (!globalThis.__platformDb) {
    const client = postgres(readUrl(), {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idle_timeout: 30,
      connect_timeout: 10,
      prepare: false,
    });
    globalThis.__platformDbClient = client;
    globalThis.__platformDb = drizzle(client, { schema });
  }
  return globalThis.__platformDb;
}

export async function closeDb(): Promise<void> {
  if (globalThis.__platformDbClient) {
    await globalThis.__platformDbClient.end({ timeout: 5 });
    globalThis.__platformDbClient = undefined;
    globalThis.__platformDb = undefined;
  }
}

export type Db = ReturnType<typeof getDb>;
