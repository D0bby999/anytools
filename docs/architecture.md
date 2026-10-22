# AnyTools architecture

Three rules govern everything else. All are load-bearing, all are enforced by
tests, and none may be relaxed without changing this file first.

## 1. The trust boundary

```
browser ──HTTPS──> web (React Router 7, the BFF) ──private network──> api (Go) ──> postgres
                   owns OAuth + session cookie      bearer + user id
```

**The Go API's port is never published.** `docker-compose.yml` gives the `api`
service no `ports:` entry, so it is reachable only from `web` on the compose
network. `web` is the only service that publishes a host port.

**The BFF performs the entire OAuth dance.** `/auth/google`, `/auth/github` and
`/auth/callback/:provider` are React Router routes. The BFF sets the encrypted
state cookie, exchanges the authorization code server-side, verifies the
id_token's RS256 signature against the issuer's JWKS, and only then posts the
resulting *verified claims* to `POST /v1/auth/identity`. The browser never holds
a route to the Go API and never sees the gateway token, the OAuth client secrets
or the authorization code.

**Every API call carries two credentials:**

| Header | Proves | Checked by |
|---|---|---|
| `Authorization: Bearer <gateway token>` | the caller is the BFF | `httpx.RequireUser` |
| `X-AnyTools-User-Id: <uuid>` | which user the BFF is acting for | `httpx.RequireUser`, against the database |

For account linking, the BFF re-reads the live session in the callback and
refuses unless it still matches the link target recorded in the state cookie
(`ui/web/app/auth/callback.server.ts`). Without that re-read the API's
`link_to_user_id` cross-check would be comparing one cookie-derived value
against another, and a session revoked during the ten-minute OAuth window would
still link.

`X-AnyTools-User-Id` is a claim, not a proof. It is trustworthy *only* because
of the unpublished port: nothing outside the compose network can set it. postclaw
carried the same shape but relied on an nginx rule for the same property — a
vhost can be edited; a compose file with no published port cannot be
misconfigured into publishing one.

### One authentication chokepoint

`httpx.RequireUser` wraps the **whole mux** in `api.BuildMux`, not individual
handlers. A route added by a later phase is authenticated by default. Handlers
read the caller's identity only from `httpx.UserID(ctx)`; re-reading the header
would be trusting the input the middleware exists to validate.

Two exception lists, both small and both pinned by tests
(`internal/api/mux_allowlist_test.go`):

- `httpx.AllowlistedPaths` — no authentication at all. Exactly `GET /health`.
- `httpx.GatewayOnlyPaths` — bearer required, user id **not** required. Exactly
  `POST /v1/auth/identity`, because that endpoint *creates* the user, so
  demanding a pre-existing id on it is a contradiction. When such a request does
  carry a user id (account linking), it is validated in full, and the handler
  refuses to link to any user other than that verified one.

Both lists are keyed on `METHOD /path`, not path alone, so a later phase adding
`GET /v1/auth/identity` cannot inherit the user-id exemption written for the
POST. Matching is exact: anything not character-for-character an entry falls
through to full authentication, which is the safe direction.

`TestRegisteredPatternsMatchesSource` greps `internal/api/**` for
`mux.HandleFunc("…")` / `mux.Handle("…")` with a **literal** pattern and fails
in both directions, so a route cannot ship without the authentication test
covering it. Its reach is textual, not semantic: a registration using a
different receiver name, a `const` pattern, or a mux built in another package
would not be seen. Registering routes any other way is therefore a reviewable
decision, not a free one.

### Account linking

`users(id uuid)` + `user_identities(provider, subject)`. The email is never the
id: it can change, can collide on case, and cannot be revoked.

The policy, in `internal/store/pg/users.go`:

1. Unverified provider email → refused.
2. Known `(provider, subject)` → the same person; return their user.
3. Unknown identity **while signed in** → link to the session's user. The
   browser already proved control of that account.
4. Unknown identity **while signed out**, email already has a live account →
   **refused** (`ErrEmailBelongsToAnotherUser`). Auto-linking here is
   pre-verified-email account takeover: register the victim's address at any
   provider AnyTools trusts and inherit their documents and BYOK credentials.
5. Otherwise → new account.

Rule 3 additionally refuses when the claimed email belongs to a *different* live
user: a proven session authorizes linking to that account, not carrying a third
party's address into it. Without that, "one live account per verified email"
would hold in `users` but not in `user_identities`, and any later feature that
resolves people by email would inherit the collision.

The whole transaction takes `pg_advisory_xact_lock` on the email first.
Otherwise the policy is a read-then-write across three statements under READ
COMMITTED, and concurrent callbacks interleave: the worst case refused a
brand-new user with "this email already has an account" for the provider that
owned it, reproducibly.

## 2. Single replica

**The API runs as exactly one process.** `docker-compose.yml` pins
`deploy.replicas: 1`.

State that lives in process today:

- the rate-limiter token buckets (`internal/api/httpx/ratelimit.go`)
- the job workers and the lease reaper (`internal/jobs`, started by
  `internal/app/wire.go`)
- the document event fan-out (`internal/knowledge/events.go`)

- the per-turn stream buses, the turn cancel registry and the ask_user answer
  channels — all three in `runtime.BusRegistry` (`internal/runtime/streambus.go`)

**The jobs half of that is now solved.** `internal/jobs` claims work with a
LEASE rather than an in-memory lock: a claim is one short `UPDATE … RETURNING`,
the worker extends it by heartbeat, and a reaper sweeps expired leases on
startup and every minute. A second replica would therefore not double-run a
parse — it would compete for the same rows through `FOR UPDATE SKIP LOCKED` and
lose cleanly. What is NOT yet safe to split is the event fan-out: a browser
subscribed on replica A would not see a document parsed on replica B.

A job that bills the learner several times (an audio overview, an exam) runs
its work as ordered units through `jobs.RunUnits`. Each finished unit is
checkpointed in `jobs.progress`, so a retry resumes instead of paying again.
The owner can cancel between units (`jobs.cancel_requested`).

"Today" is the learner's calendar day. `users.timezone` is reported once by
the browser and editable in Settings, and `learning.LocalDay` is the only way
any feature computes a day.

Cron-style work that must run exactly once across the system takes a Postgres
advisory lock instead of a lease: `jobs.WithAdvisoryLock` is `try`, not `wait`,
because a nightly job queued behind the one already running is a nightly job
that runs twice.

A second replica would split all of it silently — a user's stream on one
replica, their cancel request on the other. **Leases** on turns and jobs
(phase 5), plus a recovery sweeper, are the precondition for ever raising this
number. Until then, `replicas: 1` is a correctness requirement, not a capacity
choice.

Phase 6 built the turn half of that precondition: `turns.lease_expires_at` is
refreshed every 10 s by the worker holding the turn, and
`runtime.Recovery` (startup + every 30 s) fails any `running` or `waiting_user`
turn whose lease has passed as `WORKER_LOST`, appending a terminal event so
attached clients stop waiting. The registry above is still process-local, so
what a second replica would break today is narrower than before — a cancel or
an ask_user answer landing on the wrong process — but it is not yet safe.

**Two streams now leave this process, and BOTH fan out in memory.** The wiring
commit mounted `GET /v1/kb/{id}/events` on `knowledge.Events`, next to
`GET /v1/turns/{id}/events` on `runtime.BusRegistry`. They are different
mechanisms with the same limit:

| Stream | Fan-out | Durable? | Catch-up when a frame is missed |
|---|---|---|---|
| `GET /v1/turns/{id}/events` | `runtime.BusRegistry`, process-local | the event LOG is persisted (`turn_events`), the bus is not | `after_seq` / `Last-Event-ID` replay straight out of the table |
| `GET /v1/kb/{id}/events` | `knowledge.Events`, process-local | no | none — the client re-reads `GET /v1/kb/{id}/documents` |

The asymmetry is deliberate rather than an omission. A turn's events ARE the
answer, so losing one loses text nobody can reconstruct, and phase 6 paid for a
persisted log and a resume cursor. A document event only says a row changed;
the row itself is the truth, one query away, so the KB endpoint honours neither
`after_seq` nor `Last-Event-ID` and the Knowledge UI keeps a polling fallback
for the case where EventSource gives up. Making the document fan-out durable is
a different design (a per-document event log in Postgres) and nothing needs it
yet.

Both are one more reason `replicas: 1` stands: a browser subscribed on replica
A sees neither a document parsed nor a turn streamed on replica B.

## 3. Free + BYOK, and no platform key

**AnyTools holds no AI credential of its own.** Not for chat, not for parsing,
not for embedding, not for web search. Every provider call is made with a key a
user pasted or an account a user connected, and a user who has connected nothing
gets an explicit "blocked" from the readiness matrix rather than a quiet
fallback onto someone else's quota. The plan carried a shared Tavily key until
red-team RT-13 cut it for exactly this reason.

**One approved exception: the server's own engines.** The built-in Whisper
(speaches, compose profile `stt`) and Kokoro (Kokoro-FastAPI, profile `tts`)
run on the operator's machine with no third-party key at all. Each is optional,
reached only inside the compose network, and metered per learner per local day
(`stt_usage`, `tts_usage` through `pg.EngineUsage`: 120 minutes of
transcription and 60 minutes of speech by default), booked before the work and
partly given back after it. Every other model call is still the learner's own
(owner decisions of 2026-10-02, plan 260930-0915).

### Three seams, one chain

| Seam | Interface | Resolver |
|---|---|---|
| chat | `providers.Provider` | `byok.Service.ChatFor(ctx, user, function)` |
| parse | `parse.DocumentParser` | `byok.Service.ParserFor(ctx, user)` |
| embed | `embed.Embedder` | `byok.Service.EmbedderFor(ctx, user)` |
| search | `search.Client` | `byok.Service.SearchFor(ctx, user)` |

All four return `byok.Chain[T]`, one generic type. Cooldown, failover, the
transient-blip grace and the verify write-back are therefore written once and
behave identically in every lane — postclaw has a chat chain and a separate,
divergent copy for media, and a fix to one never reached the other.

**Cooldown is persisted, not remembered.** A failing connection's bench time
goes into `provider_connections.settings` (a shallow jsonb merge, so two writers
touching different keys cannot erase each other). `TestCooldownSurvivesAProcessRestart`
rebuilds every store from scratch and asserts the benched entry is still
skipped; without persistence, a restart resurrects a provider that is still
refusing.

### The function enum lives in one place

`byok.AllFunctions()` is the single definition of `chat, parse, embed, quiz,
mastery, reading, solve, research, rerank`. The migration's CHECK constraint
necessarily repeats the strings, and `internal/byok/functions_migration_test.go`
fails if the two ever disagree — the same test pins `MaxChainEntries` to the
position CHECK and the provider list to `APIKeyProviders()`. Red-team RT-13
found the earlier enum missing `mastery` and `reading` because the list was
written twice in prose.

Web-search keys are `search_connections`, never a `function_routes` row: a
search key has no model, no chain position and no cooldown curve.

### Secrets

Every secret goes through `pg.encryptOrFail`, which refuses rather than storing
plaintext when no key is configured. Decryption happens in exactly three places,
all named for it: `GetConnectionWithSecret`, `ChainFor` and `SearchChain`. The
reads a handler can reach (`ListConnections`, `GetConnection`) return the
connection with `Secret` empty and `HasSecret` set, so a response writer has
nothing to leak. A provider's error body is never passed through to the browser
either — `byok.VerifyErrorMessage` maps it to one sentence, because that body can
echo the prompt and carry a key fragment.

### Egress

A user-supplied `api_base` is checked **twice**, and the two checks fail
differently on purpose:

1. **At write time** — `security.ValidateBYOKEndpoint` requires https and
   refuses every address a hostname resolves to that is private, loopback,
   link-local or multicast. The user gets a sentence they can act on.
2. **At connect time** — `security.SafeBYOKClient` re-asserts the same address
   rule inside `net.Dialer.Control`, which runs on every dial including each
   redirect hop. This is what catches a hostname that resolved publicly when it
   was saved and resolves to `169.254.169.254` when it is used.

`ANYTOOLS_BYOK_ALLOW_PRIVATE_ENDPOINTS=1` opens both, for an operator running a
self-hosted model. It must never be set on the hosted deployment.

### Review reminders (web push)

The daily reminder (`internal/push`) is the one outbound call whose address
comes from the browser: a push subscription's endpoint. Three rules hold it:
`push.ValidateEndpoint` accepts only https on the browser push services (FCM,
Mozilla, Apple, Windows), at subscribe time and again at send time; the sender
is `security.SafeClient`, so a name that resolves to a private address is
refused at connect time; and the VAPID private key is made on first use and
stored through `encryptOrFail` (`push_vapid.private_key_enc`). The payload is
Declarative Web Push JSON, which Safari shows without a service worker and
`ui/web/public/sw.js` shows everywhere else. `learning.DueDigestJob` ticks
hourly; `PushStore.ClaimReminder` is one UPDATE that sends only in the
learner's local hour window and records the local day, so a restart or a
second tick cannot send twice. The job's source is `push.Service.DueDigests`:
the learners in their hour (`ReminderCandidates`, the claim's own condition
without the claim), each counted by `app.dueTotal` through the same service
calls as Home's six due rows, so the push and the page give one number.

### Share target

`ui/web/public/manifest.webmanifest` declares a GET `share_target` at
`/share` (`routes/share.tsx`, inside the app layout, so a signed-out share
signs in and comes back with its query). GET keeps the service worker out of
it. The page takes only an http(s) link (`lib/share.ts`: `url`, else the
first link in `text`, else in `title`) and adds it through the same
`POST /v1/kb/{id}/links` as the knowledge page, so the API's URL checks
apply unchanged. The knowledge base used last is an HttpOnly cookie,
`al_share_kb`, checked against the learner's list on every load. Chrome on
Android offers installed web apps as share targets; Safari has no share
target, so iPhone and iPad do not.

### Interface language

AnyLearn speaks en, vi, es and pt (plan 261019-1317). `users.language` is the
account's; until it is set, app-layout fills it once, `only_if_unset`, from the
sign-in page's choice (`?lang=`, the cookie it sets, the public page the visitor
came from, then Accept-Language; `lib/language.server.ts`). English is bundled;
another language is imported by the layout loaders before the server renders
and by `entry.client.tsx` before hydration, so the first paint is translated
and hydration matches. Each language is its own i18next instance, never
switched, because two requests in two languages share one server process.
`app/test/i18n-app-locales.test.ts` fails on any English string without its
three translations.

Worksheet kinds are written in English in Go (`internal/learning/worksheet`)
and served translated: `worksheet.Localized` copies a kind with its display
text from `i18n/{vi,es,pt}.json`, keyed by the English text, for
`/v1/worksheet-kinds`, a worksheet's page, the due list and the Markdown
export. Stored keys and option values stay English, so answers validate
against the one registered kind; a translated option travels in
`option_labels`, which the form shows. `TestEveryKindIsTranslated` fails on a
text without its three translations, or a catalog entry no kind shows.

The public pages have one path per language, for search engines: the site's
home (the landing page) at `/en`, `/vi`, `/es` and `/pt`, the tools home at
`/{lng}/tools`, and every tool, cluster, guide and page under the same prefix.
Each is canonical to itself, with hreflang to the others and an x-default, and
all are in the sitemap. The bare `/` has no page (`routes/home-redirect.ts`): a
signed-in visitor goes to `/home`; anyone else gets a 302 (`Vary:
Accept-Language, Cookie`) to the language last opened (the `anylearn-lang`
cookie the landing page sets, which sign-in reads too), else the browser's,
else `/en`, which is what a crawler gets. It is the landing page's x-default.
`/?lng=xx`, the landing page's address for a few hours on 2026-10-19, answers
301 to `/xx`.

Model output follows the conversation's language. The API's own sentences are
written in English where they are composed and translated at the edge:
`httpx.Localize` (inside RequireUser, which reads `users.language` in its
existence query) rewrites the `error` and `*_error` values of a JSON response
through `internal/locale`, whose catalogs (`catalog/{vi,es,pt}.json`) map each
English format string to its translation. A stored failure (a document's parse
error, a feed's check error) therefore reads in the learner's current
language; codes such as `drive_full` pass through, and streams are not
buffered. `internal/locale/catalog_test.go` finds every sentence the API can
send (by AST: WriteError messages, `%w:` wraps, stored failures, Message
fields, the `*UserMessage`/`*Reason` sentence functions) and fails on one
without three translations. The readiness matrix is the exception: its
`reason`/`note` carry a code the web words itself (`reason_code`,
`note_code`). Not yet translated: errors inside a stream (chat, live document
status), which the page shows until it reloads.

### Web tools (phase 9)

`web_search` and `web_fetch` are the only tools whose destination is chosen by
text AnyTools does not control. Three fences, all tested:

1. **Research only.** They live in a registry mounted for the `research`
   capability alone (`runtime.OrchestratorDeps.CapabilityTools`). A chat or
   solve turn has no network tool at all, whatever the session's `allow_web`
   says — `TestAChatTurnNeverSeesAWebTool`.
2. **The retrieved-context gate.** Once any tool in a turn has returned the
   user's document text, a network tool is refused unless the session allows the
   web. Chat's loop applies it through `ToolRegistry.Definitions`; staged
   pipelines through `TurnContext.CallTool`, which enforces it itself so a
   pipeline cannot forget. Research therefore reads the knowledge base FIRST and
   records `kb_only_reason = web_off_with_documents` when the gate closes —
   `TestTheWebStaysOffOnceDocumentsAreInPlayUnlessAllowed`.
3. **Where fetch may go.** `web_fetch` opens only URLs this turn's own search
   returned (`citations.URLBook`), so a page or a model cannot name a fresh URL
   carrying the user's data. Every dial goes through `security.GuardedDialer`:
   resolve, refuse if ANY record is private/loopback/link-local/ULA, dial the
   exact address checked (no second lookup for a rebinding server to answer),
   again on every redirect hop, 5 MB body cap, no proxy. The BYOK private-
   endpoint hatch never applies here.

With no Tavily or Brave key, research runs KB-only and says so (RT-13).

A stored `api_base` is normalised to include its version segment
(`security.NormalizeAPIBase`). Measured 2026-09-16: a base missing one returns
HTTP 200 with an **empty body** and `finish_reason: "stop"` — a misconfiguration
the user would experience as blank answers, not as an error. The other half of
that fix is that a zero-content non-tool completion is treated as a failure.

### Subscription lanes are experimental and off

`ANYTOOLS_EXPERIMENTAL_SUBSCRIPTION_LANES=1` enables the ChatGPT relay
(`kind=oauth_relay`) and Gemini Code Assist (`kind=oauth_gemini_sub`). Off by
default, for reasons that are recorded rather than assumed:

- **The ChatGPT lane cannot be authorised by a hosted server.** Its flow is a
  PKCE loopback on the *user's own* 127.0.0.1:1455 and OpenAI publishes no device
  flow, so AnyTools only ever *receives* a token triple the user obtained
  themselves. There is deliberately no "start the ChatGPT authorisation" code
  path, and adding one would be wrong by construction.
- **The Gemini lane asks for `cloud-platform` scope**, so its refresh token is a
  full Google Cloud credential for that user, not an AI quota. postclaw uses a
  third party's published client id and secret; AnyTools ships neither and the
  owner supplies their own pair or the lane reports itself unavailable.

Neither lane is licensed for proxying, and the Settings card says so above the
form, as an `Alert`, not inside a disclosure a user can skip.

**Account deletion revokes what can be revoked.** Drive and Gemini Code Assist
grants are revoked at Google before the rows go (`internal/account`). ChatGPT
relay tokens are deleted but cannot be revoked: OpenAI publishes no revocation
endpoint for that flow. The deletion copy says so rather than claiming
otherwise (security audit F-11).

**Token refresh takes a mandatory Postgres advisory lock.** `oauth.NewService`
returns an error for a nil locker — it is not an optional dependency. Measured
on a local stub: with no lock, five simultaneous callers produce one accepted
refresh and four `invalid_grant` rejections, and postclaw turns each rejection
into "needs reconnect", so an unsynchronised refresh self-destructs a healthy
connection. The lock alone is not enough either: it serialises but does not
deduplicate, so `AccessToken` **re-reads the credential inside the lock** and
bails out when the stored expiry has already moved. A lock-store error declines
to refresh rather than falling through unlocked.

## 4. Hardening (phase 11)

An independent audit preceded launch; its report and the disposition of every
finding are kept in the maintainers' planning record. Its mechanisms:

- **Isolation is tested from the router.** `internal/app/isolation_test.go` boots
  `app.Build` and, for every registered pattern, probes another user's resource
  by path id, body id and query id. It also requires the answer to equal a
  nonexistent id's. Every write route, including those with a path id, has a
  body probe or a stated reason it names nothing else. A nested route
  (`/{id}/…/{inner}`) is also probed with mixed owners: the caller's own outer
  id beside another user's inner one. An AST scan over all of `internal/` fails
  on any `*_id` field, or any uuid or raw-JSON field named like a reference
  (`anchors`, `items`, `links`, `refs`, `answers`, `source`, `cites`), in a
  request struct that is neither probed nor explained. A new route cannot skip
  the suite.
- **A panic ends one job or one turn, never the process.** `jobs.Worker`, the
  orchestrator and every local extractor recover. Third-party parsers panic on
  malformed uploads, which is an input error.
- **Uploads have an inflate budget.** Zip-based formats are read under 32 MB
  per part and 96 MB per document. Slides and chapters count against the
  400-page cap before anything is inflated. Extracted text is capped at 32 MB.
- **Sessions can be revoked.** `users.sessions_valid_after` is the watermark the
  BFF compares each cookie's mint time against. Signing out moves it, so every
  copy of every session of that account ends.
- **Browser boundary.** Every HTML document gets a CSP with a per-request
  nonce. Every write reaches `getUserId`, which refuses a cross-site `Origin`
  (a guard test enforces that).
- **Budgets.**
  - General per-user rate limit.
  - Per-class budgets for the routes that spend the user's key or do heavy
    work (`httpx.RouteClasses`). Every write route's registration says which
    budget it spends in a `// budget: <class>` comment (`none` when it spends
    nothing), and a test holds those comments equal to the class list.
  - Per-IP budget on sign-in.
  - At most 12 open event streams per user.
- **Secrets never reach a log.** The slog handler scrubs key-shaped values and
  secret-named attributes. A source guard requires every `*_enc` write to go
  through `encryptOrFail`.
- **Deleting means deleted.** Deleting a document removes its files, including
  the original once nothing else of that user names it. Deleting an account
  revokes Google grants, cascades every row and removes the user's files.

## 5. Learning depth (plan 260926-2301)

Eleven features added on top of the first plan, each an ordinary package with
its own store, API sub-package and routes. Four rules hold across them:

- **The engine decides, the model proposes.** Gates, marking thresholds,
  schedules, graduation and citations are Go; a model writes explanations,
  scripts and outlines, and its output is validated before it is stored.
- **"Today" is the learner's day.** `users.timezone` (reported once by the
  browser, editable in Settings) and `learning.LocalDay` decide "next day",
  "due today" and "02:00"; SQL never uses `CURRENT_DATE` for a learner.
- **Billed work resumes.** A job that makes several provider calls (exam
  extraction and generation, audio synthesis, book compilation, video
  transcription) runs units through `jobs.RunUnits`: finished units are
  checkpointed, a retry resumes, Cancel stops between units. A job that gives
  up settles its row through `jobs.ReapHandlers` in the same transaction.
- **Files that belong to a row are per-row.** Exam papers and audio are
  `blob.ObjectStore` objects keyed by the row id, never shared by content hash.

| Feature | Package | Notes |
|---|---|---|
| Practise mistakes | `store/pg/mistakes.go`, `quiz/practice.go` | Every wrong answer opens a mistake; the second right answer graduates it only on a later local day. |
| Explain-back | `capabilities/mastery` | A judged explanation gates new paths' modules. |
| Exam mimic | `capabilities/exam` | A past paper is read, reviewed, then mimicked from a knowledge base; `written` answers are marked by rubric (pass at 0.7). |
| Web and YouTube | `knowledge/links.go`, `connectors/youtube` | Captions first, then a Gemini transcription of the public URL, then upload or paste. Chapters are read from the description by YouTube's rules. |
| Video study notes | `capabilities/videonotes` | One call per language; times outside the transcript or their section are dropped; creator chapters are the boundaries; stale when the transcript's sha256 changes. |
| Diagrams | `capabilities/visualize`, `components/diagram` | Mermaid shown only through `<img src=blob:>`; charts from an allow-listed JSON spec. |
| Papers | `rag/papers`, `capabilities/related` | OpenAlex then arXiv; keys never reach an error; a keyless budget per user. |
| Library | `internal/library`, `internal/store/pg/library.go`, `internal/api/libraryapi`, `ui/web/app/lib/library`, `quiz/starters` | Catalogue built from pinned data by `ui/web/scripts/library/export.mjs` into `internal/library/catalogue.json.gz`, embedded in the API and loaded into Postgres (`library_catalogue`, `library_sources`, `library_items`, `library_item_scores`) at start unless the same version or a later export (by its sequence, checked again under an advisory lock) is loaded, or by `anytools library import [--force]`. A failed load at start is retried in the background (1 minute, doubling to an hour); until a catalogue is loaded the routes answer 503 `library_not_loaded` and the page says so. A page, its total and its scores are read in one read-only snapshot. `GET /v1/library/items`, `/fields` and `/items/{id}` filter and sort in SQL. Actions reuse decks, the vocabulary import (`origin library:<level>`), quiz sets (`AddSet`) and the link import. No live call. |
| Progress and study circles | `internal/progress`, `internal/circles`, `internal/store/pg/progress.go`, `internal/store/pg/circles.go`, `internal/api/progressapi`, `internal/api/circleapi`, `ui/web/app/routes/{progress,circles,circles.$id}.tsx` | `study_days` holds each local day's study counts per kind, recounted from the activity tables (`vocab_reviews`, `question_attempts`, `explain_back_attempts`, finished `body_workouts`, `worksheet_recordings`, `reading_highlights`, `card_entries`) for yesterday and today on every read, under a per-learner advisory lock; older days are frozen. Streak, week and level are computed in Go; `progress_milestones` keeps the day each was first reached. `study_circles`, `study_circle_members` (nickname per circle; owner is the earliest member) and `study_cheers` (one a member a day). Every circle query is scoped to circles the caller is in and answers 404 otherwise; the `social` route class limits create, join, invite and cheer. The review reminder adds the streak (`push.Streaker`). The public profile (`internal/showcase`, `internal/store/pg/showcase.go`, `internal/api/showcaseapi`, `ui/web/app/routes/{showcase,u.$handle,u.$handle.og[.]png}.tsx`) is one `public_profiles` row a learner: a unique handle, their words and a versioned JSON `design` that `showcase.ParseDesign` checks strictly. `/u/<handle>` reads it through the gateway-only `POST /v1/showcase/read` (published pages only; data only for the blocks on the page; counts at most ten minutes old) with a per-IP budget on the web route. A published page with `indexed` is in `sitemap.xml` (from the gateway-only `POST /v1/showcase/listed`: handles and dates) with per-language canonical, hreflang and a `ProfilePage`; otherwise `noindex`. |
| Learning methods | `ui/web/app/lib/methods.ts`, `methods.server.ts`, `ui/web/app/routes/methods{,.$slug}.tsx`, `ui/web/app/components/methods/video-list.tsx`, `ui/web/app/data/methods/videos.json`, `ui/web/scripts/methods/videos.mjs` | Web only: evidence levels, studies (DOIs), links into the app and pinned YouTube videos, with words in `public/locales/*/methods.json`. Videos play in a `www.youtube-nocookie.com` iframe created on press (CSP `frame-src` unchanged); "Add to my knowledge" accepts only listed video ids and calls the existing link import. |
| Word sources | `connectors/wordsources` | Tatoeba, Wikimedia Commons, Free Dictionary API from the server on the safe client; a week's cache; audio only for ids it returned, at most 3 MB; route class `lookup`. |
| Vocabulary, read-aloud | `vocab` | Its own FSRS scheduler with fuzz; read-aloud is the browser's voices. |
| Skill cards | `learning/loop/cards.go` | The server enforces the retest date and withholds the baseline until then. |
| Learner profile | `learning/profile` | Consolidation is off by default and writes proposals the learner approves. |
| Audio overview | `capabilities/audio`, `providers/tts` | Script first, then speech from the server's built-in Kokoro (metered per learner) or the learner's OpenAI-compatible `tts` route, or the browser; bounded reads; one WAV header written by AnyTools. Gemini no longer speaks (up-methods phase 22). |
| Living books | `capabilities/book` | Outlines anchored on the learner's own chunks; flash cards are `vocab_cards` of kind `flash`. |

## 6. up's methods: worksheets (plan 260930-0915)

up's templates (`byoungd/up` at `f13ff2d`, English edition; first built at `7478ac2`) become
**worksheets**: rows of `worksheets` whose kind is Go data.

- **The engine** is `internal/learning/worksheet`, served by
  `api/worksheetapi` and rendered by `ui/web/app/components/worksheet/`. A
  kind is sections of fields (`text`, `long`, `choice`, `multi`, `score`,
  `yesno`, `date`, `check`, `table`, `label`, `audio`), an attach target
  (none, an optional learning state, or a required document of named source
  kinds), review dates and per-row retest dates. The server validates every
  write against the kind (a 400 names the field); the form and the Markdown
  export are built from the same data, so the web app holds no copy of a kind.
- **Kinds register themselves.** Each kind is one file calling
  `register(kind)` from `init()`. A new up template is a new file; the
  registry, the API, the store and the web app do not change. `GET
  /v1/worksheet-kinds` serves the plan's 21 kinds
  (`worksheetapi.TestWorksheetKindsAreThePlansInventory`); the engine's
  `example` kind is registered only on a development server.
- **Outlines pin a kind to its source.** `testdata/gen` counts an up
  Markdown file's sections, labels, checks, tables and options into
  `testdata/outlines/<kind>.txt`, committed unedited.
  `TestEveryKindMatchesItsUpOutline` compares each kind with it, and every
  difference needs a line, with its reason, in `testdata/deviations.txt`; a
  line for a difference that no longer exists fails too. Wording is written
  fresh (up's text is CC BY-NC); each kind names its source file and section.
- **Writes merge, never clobber.** A PATCH carries the revision it loaded and
  is refused (409 `stale`) only for a section written since. Each named
  section is merged field by field with `jsonb_set` under a row lock; keys a
  kind no longer has are kept, and `kind_version` lets an older row still be
  edited. A table row can be appended server-side with no revision. Keys
  starting with `_` are the engine's.
- **Private kinds never reach a model.** The life toolkit and the narrative
  case review are `Private: true`, stored in a `private` column that every
  evidence query filters on (the four wiring points that
  `TestEveryEvidenceKindIsFullyWired` guards). A private worksheet answers 404
  to every evidence write. `TestPrivateWorksheetsNeverReachAModel` seeds a
  marker in every private kind, and in the minimum contract's
  `ask_for_help_when`, and searches every model request (chat with state
  context, research, quiz, mastery, profile, writing diagnosis), the resume
  text, evidence candidates and suggestions, review and chain pages, and
  Home's due list. `TestOnlyTheWorksheetStoreReadsAnswers` fails on any SQL
  outside `store/pg/worksheets.go` that reads `answers`. An unknown kind is
  treated as private. Private answers are not encrypted at rest, like notes.
- **Recordings** (`worksheet_recordings`) are per-row `blob.ObjectStore`
  objects in namespace `recordings`, written inside the transaction that inserts their row, and deleted
  with it: with the worksheet, through `RecordingCleaner` before a document or
  knowledge base goes, and with the account. Limits: 10 minutes each, 30 per
  worksheet, 500 MB per learner. They are served only to their owner through
  both ids. The CSP has `media-src 'self' blob:` and the Permissions-Policy
  `microphone=(self)`, both pinned by `security-headers.test.ts`.
- **One model call:** a writing evidence pass can be diagnosed on the
  learner's `chat` route (`capabilities/writingdiag`). It returns at most three
  quoted issues, never a rewrite, and lives in `worksheet_diagnoses`, outside
  `answers`.

The rest of the plan, outside the engine:

| Feature | Package | Notes |
|---|---|---|
| Own version first | `learning/ownversion`, `users.own_version_first` | The server refuses a chat turn or a solve without the three lines when the switch is on. |
| Interleaved review | `capabilities/mastery` (`ReviewNext`) | Built on the bounded `Due`; the previous point is read from the learner's last attempt, so the rule survives a reload. |
| Bad-day minimum | `learning/loop`, `learning_states.minimum_contract` | `ask_for_help_when` is kept out of resume text and every model input. |
| Vocabulary decisions | `vocab`, `vocab_notes.decision` | Only `learn` makes cards; a production card only on request. |
| Day-90 close | `worksheet` kind `cycle_close`, `worksheets.cycle_id` | One close per cycle; the next cycle starts from its continue and transfer results. |

Learning sources added by the same plan:

| Source | Package | Notes |
|---|---|---|
| Audio and video files | `connectors/media`, `media` (ffmpeg), `providers/stt` | Sniffed, 500 MB; transcribed by the built-in Whisper or the learner's `stt` route (Groq, OpenAI, own server, Gemini Files API), in windows through `jobs.RunUnits`. |
| Photos | `rag/parse` | Read by the learner's `parse` model, one page per photo. |
| Feeds and playlists | `connectors/feeds` | gofeed through `security.FetchPage`; nothing is transcribed automatically. |
| Sites and repositories | `connectors/crawl`, `connectors/github` | Path-prefix crawl obeying robots.txt; one bounded tarball per repository, paths validated. |
| Spreadsheets | `rag/parse` (excelize) | Local, no model; one page per visible sheet. |
| Zotero | `connectors/zotero`, `capabilities/zoterolib` | The learner's read-only key; a research tool whose result is enveloped. |
| Built-in engines | `providers/builtin`, `providers/stt`, `providers/tts` | Health and readiness, one job at a time, the metered exception in §3. |

## 7. The chat agent loop (plan 261019-1015)

Where each part lives and how to change it: [chat.md](chat.md).

`internal/capabilities/chat` is still think → tool → observe, with what
postclaw's agent (`internal/agent`) learned the hard way:

- **History is sized in tokens, not messages.** `context_window.go` keeps
  postclaw's model-window table, but an unknown model is assumed to have 32k,
  not 200k: AnyTools is BYOK and its unknown models are mostly self-hosted,
  where a large guess means a prompt the server silently cuts from the front.
  Half the window, capped at 24k tokens, goes to earlier messages.
- **What no longer fits is summarised, once.** `history.go` folds the overflow
  into `chat_sessions.summary` with the learner's own chat route and records
  `summary_through_id`; the next turns send the summary and only the messages
  after it. The kept part is cut back to 60% of the budget, so the summary call
  is not repeated every turn. A failed summary call trims instead of failing
  the turn. Rewinding past the summary's last message clears it.
- **A summary must be whole to be kept** (plan 261021-1100 phase 5,
  `compaction.go`). It is written in four labelled parts (Goal, Covered, Open,
  Documents; the labels stay English, the text is the conversation's
  language). One cut at the output limit or empty never replaces the stored
  one; one missing a part is asked for once more; the titles the overflow's
  answers cited and its questions that got no full answer are added back
  without a call when the model left them out. The chat page draws a
  checkpoint after `summary_through_id` that opens the summary.
- **Overflow recovers once.** A provider's "context length" refusal
  (`providers.IsContextOverflow`) rebuilds the history at a third of the budget,
  cuts this turn's tool output to 4k characters each, and retries; a second
  refusal fails the turn.
- **A stable prefix for prompt caches** (`prompt.go`). The first message is
  the rules, what the conversation reads and the learner's Preferences, ending
  at `providers.SystemCacheBoundaryMarker`; then the summary, the kept history,
  this turn's own notes (a linked learning state, documents pointed at with
  `@`) and the question. A request repeats the previous turn's, byte for byte,
  up to that turn's question. Anthropic gets its breakpoint at the marker, a
  later system message never moves it, and OpenAI-shaped providers cache the
  repeated prefix themselves. Cache reads are summed into
  `attachments.work.cached_tokens` and shown on the context meter.
- **Tools.** Arguments are checked against the tool's own schema first, as
  leniently as the tools read them; a bad one is said back with what the tool
  takes. Each call has a time bound: 60 s locally, 90 s for a network tool, or
  the tool's own `Timeout()`; running out is a tool error, not a failed turn.
  A result over 16k characters is kept whole for the turn (`spill.go`, memory
  only, since tool results never outlive the turn) and enters the prompt as
  its head and tail with a handle; `read_result` reads any 12k-character page
  of it back, or the lines containing a phrase. Near 70% of the window, older
  rounds' results leave the prompt for a note naming their handle. Retrieved
  text that addresses the model ("ignore previous instructions", in English,
  Vietnamese, Spanish or Portuguese, or a system tag) gets a note in front of
  it and the step is flagged. Several calls in one response run concurrently
  (four at a time), and their results are handled in the model's order, so
  sources and citation numbers do not depend on timing. The same call twice
  in a turn is answered from the first result.
- **Guards** (`guard.go`). Two rounds in a row whose every call was a repeat
  or failed end the loop (`work.stopped = "loop"`) and ask for an answer from
  what was found. A response the provider stopped for safety is not acted on
  (`SAFETY_STOP`); tool calls written into a response cut at the length limit
  are not run, and the model is asked to send them again. A call that sends
  nothing for 90 s (180 s before its first chunk; thinking counts) is ended
  as `PROVIDER_STALLED`, keeping what streamed. A learner's message loses its
  control characters and direction overrides at the API.
- **Endings.** Running out of rounds makes one call without tools for an answer
  from what was found. An answer cut at the output limit is continued once.
  Text that streamed before a provider failure or a stop is stored, marked
  `incomplete`.
- **Every answer keeps its work**: `attachments.work` lists the steps, the
  rounds, what was summarised and the context used; `attachments.suggestions`
  holds follow-up kinds, picked by rule (postclaw RT#10), never written by the
  model. The client owns their words.
- **Asking again** is `POST /v1/chat/sessions/{id}/turns` with `rewind_to_id`:
  that question and everything after it are deleted in one transaction, then
  the turn runs (the same text when `message` is empty). Refusals happen before
  anything is deleted.
- **A conversation can be pinned** to an entry of the learner's chat route
  (`chat_sessions.connection_id` + `model_hint`); `byok.Chain.Prefer` moves it
  to the front and leaves the rest as the fallback. Only connections on the
  caller's own chat route are accepted (`ChatStore.OnChatRoute`). One turn can
  name another entry of the route instead (`connection_id` and `model` on the
  turn, "Ask again with…" under the last answer); the pin is left alone.
- An untitled conversation is named after its first question, without a model
  call.

## Boot sequence

`internal/app/wire.go`, in order, each step fail-closed:

1. `config.Load` — refuses to start without `ANYTOOLS_POSTGRES_DSN`,
   `ANYTOOLS_ENCRYPTION_KEY` and `ANYTOOLS_GATEWAY_TOKEN`
   (`ANYTOOLS_ALLOW_NO_AUTH=1` drops the last one, and is itself refused when
   `ANYTOOLS_ENV=production`).
2. `pg.Open` — connects and pings, so a bad DSN fails here rather than on the
   first request.
3. `SentinelStore.Verify` — decrypts a known plaintext from `app_sentinel` under
   the configured key, seeding it on a first run. **A mismatch refuses to
   start.** Booting under the wrong key otherwise succeeds, and the damage — a
   second, unreadable generation of secrets interleaved with the first — only
   surfaces much later.
4. Stores, services, handlers, mux.

Migrations are **never** run on boot. `anytools migrate up` is a separate
one-shot container so a restart of the API can never become a schema change.

## Ownership, in the schema

Every table carries `user_id uuid NOT NULL`, and every child table carries a
COMPOSITE foreign key to its parent's `(id, user_id)`:

```
documents (kb_id, user_id)   -> knowledge_bases (id, user_id)
chunks    (kb_id, user_id)   -> knowledge_bases (id, user_id)
chunks    (document_id, user_id) -> documents   (id, user_id)
```

That makes a cross-tenant row **unrepresentable** rather than merely forbidden:
an application bug that passes the wrong `kb_id` gets a foreign key violation,
not somebody else's document. It is the structural half of red-team RT-3; the
procedural half is `internal/authz`, which every handler calls before it touches
a named resource.

`authz` has exactly one error for "no", `ErrNoAccess`, and handlers map it to
**404, never 403**. "You may not have this" and "this does not exist" must be
indistinguishable, or any endpoint taking an id becomes an oracle for which ids
are real.

## Where files live

Uploads and parsed Markdown go under `ANYTOOLS_DATA_DIR`, which is **not inside
any web root** — the BFF serves `ui/web/build/client`, so nothing under the data
directory is reachable by URL and an uploaded `.html` can never be served back
as same-origin content. Every path segment is derived from a uuid or a sha256
this process computed, so no caller-supplied filename reaches the filesystem.

### The storage seam (plan 261017-1828)

A learner may keep their own files in their Google Drive instead (Settings →
Storage, off by default). Every caller reaches files through one seam, so no
feature knows which:

- **`blob.Store` and `blob.ObjectStore`** are the only interfaces. Callers
  `Put`/`Get`/`Delete` bytes and `OpenOriginal`/`OpenObject` streams; a
  `*blob.File` is an `io.ReadSeekCloser` with a size and a time, which is what
  `http.ServeContent` needs for range requests. No caller asks for a path
  (`TestNothingOutsideBlobAsksForAPath`). ffmpeg, which needs one, gets
  `media.Materialize`: a copy inside the job directory, removed with it.
- **`blob.Router`** chooses a backend per learner on every call, from
  `users.file_storage` (`blob.StorageChoice`). `drive` is the Drive backend;
  `server` writes to `blob.Local`. Parsed Markdown always stays on `Local`.
  If the choice cannot be read, the call fails: nothing falls back to the
  server's disk.
- **`blob.Drive`** writes to Drive first and then the `drive_files` row
  (`user_id`, `kind`, `key`, `drive_file_id`, `sha256`, `missing_at`), and
  deletes the upload if the row fails. A read follows the file's row: a row
  means Drive, no row means the server, so a learner part way through a move
  reads both. Reads go through `blob.Cache`, an on-disk LRU keyed by sha256
  under `ANYTOOLS_DATA_DIR/cache/<user>`, capped by `ANYTOOLS_DRIVE_CACHE_MB`.
  A miss is a lazy ranged read; only a whole file whose digest matches is
  cached. Derived and scratch kinds (transcripts, audio parts, parsed exam
  pages) never go to Drive.
- **`drive.Storage`** (`internal/connectors/drive`) is the Drive v3 client:
  folders found by `appProperties` before any is created, resumable uploads
  checked against Drive's md5, ranged `alt=media` reads, and a 401 refreshed
  once. The import and sync client (`drive.Client`) shares the same rule
  through `Service.authorized`: one refresh and one retry, and a second 401
  marks the connection `needs_reconnect`. It reaches only `www.googleapis.com`, through `security.FetchClient`,
  with the token in a header. Errors name the method and host, never the URL,
  because a resumable session URL is a credential for its upload; the log
  handler also scrubs `upload_id`.
- **Why a file is out of reach** is one of three sentinels
  (`internal/blob/unavailable.go`): `ErrReconnect` (409 `drive_reconnect`),
  `ErrRemoved` (410 `drive_file_removed`, and the row is marked
  `missing_at`), `ErrRemoteFull` (507 `drive_full`). `httpx.WriteStorageError`
  answers them; a failed parse stores the sentence and the document's
  `error_code` gives the page its code back. Every upload form (documents,
  photos, worksheet recordings, exam papers, links, sites, repositories, and
  each item of a Drive import, whose outcome carries `code`) shows the
  reason through `DriveFileNotice`, with "Reconnect Google Drive" for
  `drive_reconnect`.
- **Moving** existing files is the `storage_move` job: one unit per file,
  write, check the checksum, record, and only then delete the old copy.

Account deletion removes the rows (by cascade) and the cache, and never calls
Drive's delete: the files in the learner's Drive are theirs.

## Migrations

Named `<unix-timestamp>_<slug>.{up,down}.sql`. A shared sequence number makes
every concurrent phase branch collide on the same next integer; postclaw carries
252 such pairs and each collision was a manual merge. A timestamp cannot
collide.

golang-migrate never applies a version below the database's current one, so a
migration must also **arrive on main above every migration main already has**,
or every deployed database skips it. A merger renames a branch's migration to
the next free timestamp. `TestMigrationsAreInCommitOrder` walks main's
first-parent history and fails on one that arrives below an earlier one (the
learning-depth merges of 2026-09-27, before the rule, are the baseline). A
migration that restates a CHECK list must keep every value the lists before it
allowed (`TestRestatedCheckListsKeepEveryEarlierValue`).

## Layout

```
cmd/anytools/          cobra: serve, migrate
internal/app/          explicit builders per subsystem, no god-function
internal/config/       env-only secrets, json:"-", ANYTOOLS_ prefix
internal/api/          one sub-package per feature; each exposes RegisterRoutes(mux)
internal/api/httpx/    RequireUser, JSON helpers, recover, rate limiting
internal/auth/         identity linking policy (claims arrive verified from the BFF)
internal/authz/        does this user own this resource? one answer for "no"
internal/knowledge/    knowledge bases, documents, the parse->chunk->embed pipeline
internal/rag/          parse (splitting, batching, truncation, local lanes),
                       chunk, embed (padding), retrieve (one hybrid RRF query)
internal/jobs/         Postgres work queue: leases, heartbeat, reaper, advisory locks
internal/blob/         uploaded files and parsed Markdown under ANYTOOLS_DATA_DIR
internal/crypto/       AES-256-GCM
internal/store/        narrow interfaces, defined next to their consumer
internal/store/pg/     pgx implementations
internal/byok/         BYOK: connections, routes, chain, verify, readiness
internal/providers/    chat clients (OpenAI-compatible, Gemini shim, Anthropic, relay lanes)
internal/oauth/        the two experimental subscription lanes + locked token refresh
internal/security/     SSRF address guard, BYOK endpoint validation, hardened HTTP clients
internal/rag/parse/    document parsing seam (Gemini, OpenAI, Anthropic)
internal/rag/embed/    embedding seam (OpenAI, Gemini)
internal/rag/search/   web-search seam (Tavily, Brave)
internal/capabilities/ chat (loop), quiz + mastery (services), solve + research (staged turns)
internal/learning/     the learner's day, the loop, profile, worksheets (up's templates)
internal/connectors/   drive, youtube, media, feeds, crawl, github, zotero
internal/media/        ffmpeg and yt-dlp subprocesses, per-job directories
internal/providers/stt, tts, builtin   speech seams and the server's own engines
internal/testutil/     TestDB — fails in CI, skips locally
migrations/            <unix-timestamp>_<slug>.{up,down}.sql
ui/web/                React Router 7 BFF: OAuth, session, the only API client
deploy/                Dockerfile.api
```

Interfaces live next to the code that consumes them, never in one `Stores`
struct — postclaw's grew to 60 fields and every handler depended on all of them.
