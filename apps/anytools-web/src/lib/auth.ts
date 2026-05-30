import { createRequire } from 'node:module';
import { join } from 'node:path';
import { betterAuth } from 'better-auth';
import type DatabaseType from 'better-sqlite3';

// During Next.js production build, the page-data collection pass imports
// every route — including this auth module — without ever calling a handler.
// Loading the native better-sqlite3 binding there fails (webpack's bundle path
// differs from node_modules). Detect that phase and short-circuit with an
// in-memory DB; real persistent DB created at runtime.
const IS_BUILD_PHASE = process.env.NEXT_PHASE === 'phase-production-build';

// createRequire bypasses webpack's bundled require so Node resolves
// better-sqlite3 from real node_modules at runtime (where the .node native
// binding lives). Webpack's `require(stringVariable)` does NOT do this.
const nodeRequire = createRequire(import.meta.url);

function loadSqlite(inMemory = false): DatabaseType.Database {
  const SqliteCtor = nodeRequire('better-sqlite3') as typeof DatabaseType;
  const path = inMemory ? ':memory:' : (process.env.AUTH_DB_PATH ?? join(process.cwd(), 'auth.db'));
  const db = new SqliteCtor(path);
  if (!inMemory) db.pragma('journal_mode = WAL');
  return db;
}

// During Next.js build, use an in-memory SQLite so Better Auth can still
// introspect the schema without writing files. The instance is discarded
// after build finishes.
export const auth = betterAuth({
  database: loadSqlite(IS_BUILD_PHASE),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  socialProviders: {
    github:
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
        ? {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          }
        : undefined,
  },
});

export type Session = typeof auth.$Infer.Session;
