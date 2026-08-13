# @anytools/postclaw-blog-endpoint

Implements the [PostClaw custom_blog contract](https://postclaw.fun/docs/custom-blog-integration) ("Your Website" publisher) as Next.js App Router route handlers backed by the shared `blogs` table.

```
GET   {base}/health      → {"service":"postclaw-custom-blog","version":1}
POST  {base}/posts       → create (201, id = external_id)
PATCH {base}/posts/{id}  → update by external_id (200)
```

Base URL entered in PostClaw: `https://<site>/api/postclaw` (path-suffixed bases are supported by PostClaw).

## Wiring (per app)

```ts
// src/lib/postclaw-handlers.ts
import { getDb } from '@anytools/db-shared/client';
import {
  createDrizzleBlogStore,
  createDrizzleIdempotencyStore,
  createPostclawHandlers,
} from '@anytools/postclaw-blog-endpoint';

const db = getDb();
export const postclawHandlers = createPostclawHandlers({
  token: process.env.POSTCLAW_BLOG_TOKEN ?? '',
  siteBaseUrl: 'https://besttoys.world',
  allowedCategories: ['stem-kits', 'robotics', 'programming-toys', 'electronic-learning', 'buyer-guide'],
  blogStore: createDrizzleBlogStore(db),
  idempotencyStore: createDrizzleIdempotencyStore(db),
});

// src/app/api/postclaw/health/route.ts
export const dynamic = 'force-dynamic';
export const GET = postclawHandlers.health;
// src/app/api/postclaw/posts/route.ts       → export const POST = postclawHandlers.createPost;
// src/app/api/postclaw/posts/[id]/route.ts  → export const PATCH = postclawHandlers.updatePost;
```

## Contract decisions (deliberate, red-teamed)

- **`id` in responses = `external_id`**, never the serial row id. PATCH looks up by `external_id`, so it structurally cannot touch MDX-authored rows (`external_id IS NULL`) and row-id churn can't misdirect an update.
- **HMAC signature REQUIRED on POST/PATCH.** PostClaw always signs mutating requests for a connected account; treating the header as optional would allow bypass-by-omission. The contract explicitly permits strict mode.
- **Idempotency:** key-reservation in Postgres (`postclaw_idempotency`). Only 2xx responses are cached (a cached 5xx would poison the key — PostClaw retries reuse it). Same key + different body hash → 409. Crashed reservations are taken over after 60s.
- **Slug collision → 422** (terminal, no retry), never silent suffixing: a collision means a duplicate topic and a human should resolve it.
- **Sanitization at ingest** (allowlist, `https`/`mailto` schemes only, `rel="nofollow ugc noopener"` on all anchors). The branded `SanitizedHtml` type is the only input the per-app render component accepts.
- Posts land `locale='en'`, `content_format='html'`; `published_at` defaults to now() for published posts (the EN index sorts `DESC` = NULLS FIRST).

## Token

One high-entropy token per site (`openssl rand -hex 32`), stored as `POSTCLAW_BLOG_TOKEN` in the app's Coolify env and entered in PostClaw when connecting the channel. The token is also the HMAC signing key — rotating it in both places is the whole rotation story. It additionally grants corpus READ once the read extension ships (see plan phase 6).

## Read extension (contract v2 — phase 6, not yet implemented)

`GET {base}/posts?cursor=<synced_at_iso>.<id>&per_page=<≤100>` keyset pagination + `GET {base}/posts/{external_id}` for PostClaw content sync (RAG). Probe semantics: readable ⟺ 200 with expected shape; 404/405/anything else = plain v1, silent.
