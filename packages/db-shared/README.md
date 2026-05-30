# @anytools/db-shared

**Shared Postgres schema TEMPLATE for the platform.** One schema definition, applied as-is to each project's own Postgres database.

## Architecture

Each project owns its own database inside one shared Postgres instance:

```
Hetzner CX22 host
└── postgres:5432 (Coolify service, single instance, shared)
    ├── db: anytools          ← anytools-web → DATABASE_URL=postgres://...@.../anytools
    ├── db: project2          ← project2-web → DATABASE_URL=postgres://...@.../project2
    └── db: project3          ← project3-web → DATABASE_URL=postgres://...@.../project3
```

This package contains the schema TEMPLATE that defines:

| Table | Purpose |
|---|---|
| `blogs` | MDX blog mirror (slug + locale unique within a project). |
| `blog_products` | M:n join — `blogs` ↔ `affiliate_products`. |
| `affiliate_products` | ASIN whitelist (per-project; duplicated across DBs is fine). |
| `analytics_events` | Generic event log (page_view, affiliate_click). |

There is **no** `projects` table — each Postgres DB **is** a project. Isolation is at the database level.

## Why multi-DB (not single-DB multi-tenant)

| Concern | Multi-DB (this approach) | Single-DB + `project_id` |
|---|---|---|
| Isolation | Strong (drop db = drop project) | Tenant column on every table |
| Schema flexibility | Each project can fork the schema | Schema accommodates all |
| Backup | Per-DB `pg_dump` | Single `pg_dump` |
| Cross-project queries | N connections in Node, aggregate in JS | Trivial SQL JOIN |
| Mental model | Matches "one project, one DB" | Multi-tenant SaaS pattern |

For a solo dev managing ≤ 5 projects on the same host, multi-DB is simpler and safer.

## Setup (per project / per environment)

### 1. Provision one Postgres instance (one-time, platform-wide)

Coolify → New Resource → PostgreSQL 16-alpine. Note the admin connection string.

For local dev:

```bash
docker run --name platform-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=devpass \
  -d postgres:16-alpine
```

### 2. Create the project's database (one-time per project)

```bash
# Production
ssh root@<hetzner-ip>
docker exec -it coolify-postgres psql -U platform -d postgres \
  -c 'CREATE DATABASE myproject;'

# Local dev
docker exec -it platform-pg psql -U postgres -c 'CREATE DATABASE myproject;'
```

### 3. Apply the schema template to that DB

```bash
DATABASE_URL=postgres://platform:****@host:5432/myproject \
  pnpm --filter @anytools/db-shared db:migrate
```

Run the same command for every project — same schema, different DB.

### 4. Sync MDX blogs into the project's DB

```bash
# AnyTools
DATABASE_URL=postgres://...@.../anytools \
  pnpm --filter @anytools/db-shared sync:blogs

# Other project (point at its own content + DB)
SYNC_CONTENT_ROOT=/abs/path/to/apps/myproject-web/content \
SYNC_LOCALES=en \
DATABASE_URL=postgres://...@.../myproject \
  pnpm --filter @anytools/db-shared sync:blogs
```

Idempotent — content SHA guard skips unchanged files.

## Usage from a web app

```ts
import { getDb, blogs } from '@anytools/db-shared';
import { eq, desc } from 'drizzle-orm';

const db = getDb(); // reads DATABASE_URL from env

const recent = await db
  .select()
  .from(blogs)
  .where(eq(blogs.locale, 'en'))
  .orderBy(desc(blogs.publishedAt))
  .limit(10);
```

Each app's `DATABASE_URL` env var determines which project's DB it talks to. The app code is identical.

## Cross-project queries (when actually needed)

```ts
// apps/analytics-cron/src/cron.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { blogs } from '@anytools/db-shared';

const dbs = ['anytools', 'project2', 'project3'];
const counts = await Promise.all(
  dbs.map(async (name) => {
    const client = postgres(
      `postgres://platform:${process.env.PG_PW}@postgres:5432/${name}`,
    );
    const db = drizzle(client);
    const [{ n }] = await db.execute(
      `SELECT count(*)::int as n FROM blogs WHERE locale = 'en'`,
    );
    await client.end();
    return { project: name, count: n };
  }),
);
```

Avoid `postgres_fdw` until JS aggregation no longer scales (i.e., never, for a solo dev's purposes).

## Schema changes

1. Edit `src/schema/*.ts`.
2. `pnpm db:generate` — produces a new SQL file in `src/migrations/`.
3. Run `pnpm db:migrate` against EVERY project's DB:
   ```bash
   for db in anytools project2 project3; do
     DATABASE_URL=postgres://...@.../$db \
       pnpm --filter @anytools/db-shared db:migrate
   done
   ```
4. Commit both the schema change AND the generated SQL migration.

Schema changes are NOT backwards-compatible by default — design migrations to be safe across older app builds during the deploy window.

## Environment variables

| Name | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Connection string for THE specific project DB. |
| `DATABASE_POOL_MAX` | no | `10` | `postgres-js` pool size. |
| `SYNC_CONTENT_ROOT` | no | `../../apps/anytools-web/content` | MDX root. Override per project. |
| `SYNC_LOCALES` | no | `en,vi,es,pt` | Comma list — locales to walk. |

## Backup (single cron, all DBs)

```bash
# /usr/local/bin/backup-platform.sh
#!/usr/bin/env bash
set -euo pipefail
ts=$(date +%F)
for db in anytools project2 project3; do
  docker exec coolify-postgres pg_dump "$db" | gzip > "/var/backups/${db}-${ts}.sql.gz"
done
find /var/backups -name "*.sql.gz" -mtime +7 -delete
```

Run nightly via cron. Restore = `gunzip + psql`. MDX in git is the master record.

## See also

- `docs/platform/multi-project-conventions.md` — folder layout, naming, deployment
- `docs/platform/add-new-project.md` — step-by-step new project guide
- `docs/deployment-coolify.md` — Postgres service provisioning
