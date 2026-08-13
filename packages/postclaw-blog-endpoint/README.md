# @anytools/postclaw-blog-endpoint

Implements the [PostClaw custom_blog contract](https://postclaw.fun/docs/custom-blog-integration) ("Your Website" publisher) as Next.js App Router route handlers backed by the shared `blogs` table.

```
GET   {base}/health      → {"service":"postclaw-custom-blog","version":1}
POST  {base}/posts       → create (201, id = external_id)
PATCH {base}/posts/{id}  → update by external_id (200)
GET   {base}/posts       → keyset-paginated list of published posts (content sync — see "Read extension" below)
GET   {base}/posts/{id}  → single published post by external_id (content sync — see "Read extension" below)
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
// src/app/api/postclaw/posts/route.ts
//   export const POST = postclawHandlers.createPost;
//   export const GET  = postclawHandlers.listPosts;
// src/app/api/postclaw/posts/[id]/route.ts
//   export const PATCH = postclawHandlers.updatePost;
//   export const GET   = postclawHandlers.getPost;
```

## Contract decisions (deliberate, red-teamed)

- **`id` in responses = `external_id`**, never the serial row id. PATCH looks up by `external_id`, so it structurally cannot touch MDX-authored rows (`external_id IS NULL`) and row-id churn can't misdirect an update.
- **HMAC signature REQUIRED on POST/PATCH.** PostClaw always signs mutating requests for a connected account; treating the header as optional would allow bypass-by-omission. The contract explicitly permits strict mode.
- **Idempotency:** key-reservation in Postgres (`postclaw_idempotency`). Only 2xx responses are cached (a cached 5xx would poison the key — PostClaw retries reuse it). Same key + different body hash → 409. Crashed reservations are taken over after 60s.
- **Slug collision → 422** (terminal, no retry), never silent suffixing: a collision means a duplicate topic and a human should resolve it.
- **Sanitization at ingest** (allowlist, `https`/`mailto` schemes only, `rel="nofollow ugc noopener"` on all anchors). The branded `SanitizedHtml` type is the only input the per-app render component accepts.
- Posts land `locale='en'`, `content_format='html'`; `published_at` defaults to now() for published posts (the EN index sorts `DESC` = NULLS FIRST).

## Token

One high-entropy token per site (`openssl rand -hex 32`), stored as `POSTCLAW_BLOG_TOKEN` in the app's Coolify env and entered in PostClaw when connecting the channel. The token is also the HMAC signing key — rotating it in both places is the whole rotation story. It additionally grants corpus READ via the read extension below — rotation revokes both write and read access at once.

## Read extension (contract v2 — content sync / RAG)

Optional read endpoints so PostClaw can pull the full content corpus for embedding. Implemented and capability-detected, but **not published as a public part of the contract** (not advertised to postclaw.fun) until a real consumer has crawled it end-to-end in production.

```
GET {base}/posts?cursor=<synced_at_iso>.<id>&per_page=<≤100>&locale=<en|all>
 → 200 {"posts":[{ "id" (=external_id, or null for MDX-authored rows — row_id
                   exposes the numeric id separately), "row_id", "slug",
                   "locale", "title", "excerpt", "content_format", "content"
                   (bodyMdx verbatim), "tags", "categories", "status",
                   "published_at", "synced_at", "url" }],
        "next_cursor": "<synced_at_iso>.<id>" | null}
GET {base}/posts/{external_id} → 200 single post (status='published' ONLY — draft → 404), 404 unknown
```

- **Bearer auth only** on both — no HMAC signature required, since a GET carries no body for a signature to cover.
- **Keyset cursor on `(synced_at, id)`**, strictly-greater-than the cursor, `ORDER BY synced_at ASC, id ASC`. `synced_at` — never `updated_at` — because `updated_at` gets backdated from frontmatter by /do and can be NULL after an mdx-to-sql sync, so it isn't a safe resume point; `synced_at` is server-assigned on every write and therefore monotonic and never NULL. A post re-synced mid-crawl gets a fresh `synced_at` and is naturally re-emitted as an update, never skipped.
- **The consumer resumes from `next_cursor` as returned by the server — never from its own clock.** `next_cursor` is the last returned row's cursor whenever a full page (`per_page` rows) came back, and `null` otherwise; a full page always sets `next_cursor` even when it happens to be the actual last page — the crawl only learns it's done when the next fetch comes back short.
- `locale` defaults to `en` (a 12-locale corpus would 12x embedding cost for near-duplicate content); `all` returns every locale with no en-fallback merging (raw corpus, not a render path).
- `per_page` caps at 100 (default 50). Invalid `cursor` or `per_page` → 400 (terminal, never retried — never 500).
- By-id lookup explicitly filters `status='published'`: a draft row reads identically to an unknown id (404 either way), never confirming that an id exists.

**Capability probe semantics** (for a consumer deciding whether a connected site supports the read extension): readable ⟺ `GET {base}/posts?per_page=1` returns **200 with the expected JSON shape**. Anything else — 404, **405 (what Next.js actually returns for a missing GET export on an existing route file)**, 401, 501 — means "not readable"; probe silently, no retry, no error logging.
