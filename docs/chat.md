# The chat surface: where it lives and how to change it

AnyLearn's chat was rebuilt after postclaw's in two plans: 261019-1015 (the
agent loop's first upgrade) and 261021-1100 (five phases: the page and
transcript, the composer, the renderers, providers and configuration, and the
loop's guards). This page is the maintainer's map: which file owns what, the
contracts between the API and the web app, and the steps for the changes most
likely to come next.

The reasons behind the loop's limits are in
[architecture.md §7](architecture.md#7-the-chat-agent-loop-plan-261019-1015). Its
look is in `ui/web/DESIGN.md` (items 14, 23, 24 and 25). What a learner sees
about keys and providers is in [byok.md](byok.md).

## One turn, end to end

1. The learner sends from the composer. `routes/chat.$sessionId.tsx` (action)
   calls `lib/chat.server.ts` `startTurn`, which posts
   `POST /v1/chat/sessions/{id}/turns`.
2. `internal/api/chatapi/turns.go` cleans the message (`chat.CleanInput`),
   checks a one-turn model (`turnModel`), and queues the turn for the
   orchestrator (`internal/runtime/orchestrator.go`).
3. The orchestrator runs `internal/capabilities/chat` (`chat.go` `Execute`):
   history, prompt, model calls, tool rounds, guards. Every step is an event.
4. The browser reads the events through the BFF
   (`routes/app.api.stream.$topic.$id.ts`, topic `turns`, upstream
   `GET /v1/turns/{id}/events`). `hooks/use-turn-stream.ts` folds them into a
   `TurnState`.
5. The answer is stored with `attachments` (`sources`, `work`, `suggestions`).
   Reloading reads the stored record (`lib/chat-work.ts` `readWork`); a live
   turn reads the stream (`liveWork`). Both feed the same components.

## Where things live

### API (Go)

| File | Owns |
|---|---|
| `internal/capabilities/chat/chat.go` | The loop: rounds, the stream guard (`watchStream`), the safety stop, the stale-round stop, the per-turn model (`chatProvider`), `work.CachedTokens`. |
| `…/chat/prompt.go` | Message order and the cache-stable prefix (`buildMessages`, `promptNotes`). `SystemPrompt` is the rules. |
| `…/chat/history.go`, `compaction.go` | Sizing history in tokens, the summary and its checks (`checkSummary`, `completeSummary`). |
| `…/chat/context_window.go` | Model window table, `historyShare`, the 32k guess for unknown models. |
| `…/chat/tools.go` | Running tool calls: concurrency, argument checks, time bounds, caps, the work record (`workStep`, `workRecord`). |
| `…/chat/spill.go` | Long results kept for the turn, `read_result`, setting old results aside (`elideOlderResults`). |
| `…/chat/args_check.go` | The lenient schema check. |
| `…/chat/guard.go` | Input cleaning, injection markers, safety and length stops, the stale-round rule. |
| `…/chat/suggestions.go` | Follow-up kinds, chosen by rule. |
| `internal/api/chatapi/` | HTTP: `handler.go` (routes), `turns.go`, `sessions.go`, `feedback.go`, `retell.go`. |
| `internal/runtime/` | `events.go` (event and failure codes), `orchestrator.go` (retryable errors), `capability.go` (turn params), `tools.go` (`Tool`, `ToolRegistry`). |
| `internal/app/wire.go` | Which tools chat gets (`toolRegistry.Register`). |
| `internal/providers/anthropic_request.go` | `SystemCacheBoundaryMarker` and Anthropic's cache breakpoint; `codex.go` and `gemini_code_assist.go` strip the marker. |
| `internal/byok/catalog.go`, `presets.go` | The provider catalog (tiles) and each preset's base URL and default models. |
| `internal/byok/models.go` | What a provider may serve (`ProviderSupports`, `ConnectionSupports`). |
| `internal/byok/list_models.go` | Live model lists, and Verify without a model. |
| `internal/byok/routes.go`, `chain.go` | Route chains per function, checked on save. |

Tables: `chat_sessions` (including `summary`, `summary_through_id`,
`connection_id`, `model_hint`), `chat_messages`, `turns`, `chat_feedback`
(migration 1790300000), `provider_custom_models` (1790320000, users FK in
1790560000).

### Web (React Router)

| File | Owns |
|---|---|
| `routes/chat.$sessionId.tsx` | The page: loader, action intents (`send`, `solve`, `research`, `draw`, `answer`, `cancel`, `model`, `kbs`), failure codes, wiring of everything below. |
| `routes/chat.index.tsx` | New conversation. |
| `components/chat/message-list.tsx` | The transcript, answer actions, the summary checkpoint. |
| `components/chat/save-mistakes.tsx` | "Save mistakes to review": the row's button and the list under the answer share one keyed fetcher; `routes/app.api.chat-corrections.ts` posts to `/v1/chat/messages/{id}/corrections` and `…/save` (`internal/api/chatapi/corrections.go`). |
| `components/chat/process-row.tsx`, `tool-activity.tsx`, `work-row.tsx` | "How this was answered": steps, notes, timings. |
| `components/chat/composer.tsx` and `composer/` | Composer, attachments, mic, model chip, `/` and `@` menu, queue, context meter. |
| `components/chat/search-bar.tsx`, `shortcut-help-dialog.tsx`, `feedback-dialog.tsx`, `follow-ups.tsx`, `recent-conversations.tsx`, `ask-again-with.tsx`, `summary-checkpoint.tsx` | One feature each, named as they read. |
| `components/rich-text/` | Code, diff and terminal blocks inside answers. |
| `hooks/use-turn-stream.ts` | Event stream → `TurnState`. |
| `hooks/use-follow-scroll.ts`, `use-chat-search.ts`, `use-chat-feedback.ts`, `use-connection-models.ts` | Scrolling, find in conversation, ratings, a connection's model list. |
| `lib/chat-work.ts` | The work record, stored and live. |
| `lib/chat-slash.ts`, `chat-shortcuts.ts`, `chat-tool-categories.ts`, `chat-process-groups.ts`, `chat-search.ts` | Pure logic, each with its own test. |
| `lib/highlight.ts`, `ansi.ts`, `diff-lines.ts` | Highlighting (shiki, lazy grammars), ANSI colour, diff lines. |
| `routes/settings.providers.tsx`, `settings.providers.$type.tsx`, `settings.routes.tsx` | Provider grid, provider page, route chains. |
| `components/settings/` | `provider-grid`, `provider-tile`, `model-picker`, `connection-models`, `route-chain-dialog`, `connection-card`. |
| `lib/provider-catalog.ts`, `byok.server.ts`, `byok.types.ts` | Catalog filters and model grouping, BFF calls, types. |

Strings live in `public/locales/{en,vi,es,pt}/common.json` under `chat.*` and
`settings.*`.

## Contracts between the API and the web app

Change both sides together; these shapes are read by name.

- **`attachments.work`** is `workRecord` in `tools.go`, read by `readWork` in
  `lib/chat-work.ts`. Steps carry `tool`, `detail`, `found`, `error`,
  `repeated`, `flagged`, `kept`, `ms`. The record carries `rounds`,
  `summarised`, `continued`, `limit_reached`, `stopped` (`"loop"`), `elided`,
  `cached_tokens`, `context_tokens`, `context_window`, `history_budget`, `ms`.
  Old answers lack the newer fields, so each one is optional on the web.
- **Progress events** (`progress` with `metadata.kind`): `compaction`
  (`messages`), `elided`, `loop_stopped`. `use-turn-stream.ts` reads them.
- **Tool events**: `tool_call` / `tool_result`; the result's metadata may carry
  `kept` and `flagged`.
- **Failure codes** (`internal/runtime/events.go`) that the page puts in the
  learner's words: `PROVIDER_STALLED`, `SAFETY_STOP`, `TOOL_ROUND_LIMIT`,
  `TOKEN_BUDGET` (`FAILURE_CODES` in `chat.$sessionId.tsx`, strings under
  `chat.failureCode`). Any other code shows the API's message.
- **A turn request** may carry `rewind_to_id` (ask again), `connection_id` and
  `model` (one turn on another route entry; the conversation's pin is left
  alone), and attachments.
- **A session** (`GET /v1/chat/sessions/{id}`) carries `summary` and
  `summary_through_id`; the list does not.
- **The summary** has four labelled parts, `Goal:`, `Covered:`, `Open:`,
  `Documents:`, with English labels. `summaryParts` in
  `summary-checkpoint.tsx` parses them; rename one on both sides or not at all.

## Making the usual changes

### Give chat a new tool

1. Write it in `internal/tools` as a `runtime.Tool`: `Name`, `Definition`
   (a JSON schema: `checkArgs` validates `required`, `type` and `enum`),
   `NeedsNetwork`, and `Execute`. Arguments are the model's and untrusted.
   Retrieved text goes back wrapped with `tools.Wrap`.
2. For a time bound other than 60 s (local) or 90 s (network), add
   `Timeout() time.Duration`.
3. Register it in `internal/app/wire.go` (`toolRegistry.Register`).
4. On the web, give it a category in `lib/chat-tool-categories.ts` and running
   and done strings under `chat.work.tool.<name>` in all four locales.
5. Test it in `internal/capabilities/chat` with the fake provider used by
   `loop_test.go`.

### Add a provider to the catalog

1. Add a row to `catalogRows` in `internal/byok/catalog.go`: type, label, two
   letters, auth, free tier, key URL, and a preset with the base URL including
   its version segment.
2. Leave `ChatModel` empty unless the id is checked against the live list; the
   learner picks from `/models`. Set `EmbedModel` only for an embeddings
   endpoint whose width the vector column takes, and `EmbedSendsDims` only if
   it accepts `dimensions`.
3. If its model list is not OpenAI-shaped, add a case to `list_models.go`.
4. `catalog_test.go` and `presets_internal_test.go` check the rows; credit
   any copied list in `scripts/notices/adapted.md`.

Excluded on purpose: media-only providers, and "coding plan" endpoints whose
terms tie the key to coding tools.

### Let a provider serve another function

`ProviderSupports` in `internal/byok/models.go` decides. Parse and embed need a
default model (`defaultParseModel`, `defaultEmbedModel`: Gemini and OpenAI in
code, the others from their preset); speech is an allow-list. Route saving
(`routes.go`) and the grid's "can do" chips read from it, so a change shows in
both.

### Add a `/` command

Add it to `SLASH_COMMANDS` in `lib/chat-slash.ts`, with its strings under
`chat.slash.command.<id>` in the four locales; a `prompt` command needs a
`template` there (`{{topic}}` is what follows the command); `solve`, `research` and `draw` go through
`planSend` and the page action. `chat-composer-libs.test.ts` covers parsing.

### Add a language to code highlighting

Add a lazy import to `GRAMMARS` in `lib/highlight.ts`, plus aliases in
`grammarFor`. Colours come from `--lp-code-*` tokens, never a theme's literal
colours (`no-raw-colour.test.ts`).

### Show a new failure code in the learner's words

Define it in `internal/runtime/events.go`, classify its error in
`orchestrator.go` (retryable or not), add it to `FAILURE_CODES`, and add
`chat.failureCode.<CODE>` to the four locales.

### Say something new in "How this was answered"

Add the field to `workRecord` (or `workStep`) with `omitempty`, read it in
`readWork` and `liveWork`, and write it in `process-row.tsx`. Use words; only
a warning takes the warning ink.

### Change the prompt

The first system message must stay identical from turn to turn. Rules,
attachments and Preferences go before `SystemCacheBoundaryMarker`; anything
that changes per turn goes in `promptNotes.turn`, after the history.
`TestThePromptPrefixStaysTheSameFromTurnToTurn` (in `phase5_test.go`) fails if this
breaks. Text that names a heading the app inserts (such as the own-attempt
heading) can be echoed by a small model.

### Tune a limit

| Limit | Where | Now |
|---|---|---|
| Tool rounds | `runtime.MaxToolRounds` (`internal/runtime/tools.go`) | 8 |
| Calls run at once | `toolConcurrency` (`tools.go`) | 4 |
| Result in the prompt | `toolOutputMaxChars` / retry `toolOutputRetryChars` | 16k / 4k chars |
| Tool time | `localToolTimeout` / `networkToolTimeout` | 60 s / 90 s |
| Kept result | `spillMaxChars`, page `spillPageChars`, find `spillFindLines` | 4M chars, 12k, 40 lines |
| Setting results aside | `elideAt`, `elideMinChars` (`spill.go`) | 70% of window, 800 chars |
| Rounds with nothing new | `staleRoundLimit` (`guard.go`) | 2 |
| Silent stream | `stallBeforeFirst` / `stallBetween` (`chat.go`) | 180 s / 90 s |
| History share | `historyShare`, `historyCeiling` (`context_window.go`) | half the window, at most 24k tokens |
| Unknown window | `defaultContextWindow` | 32,768 |

Each has a test in `phase5_test.go` or `loop_test.go`; run them after a change.

## Rules that are easy to trip on

- Every new string goes in all four `common.json` files; Vietnamese needs the
  `_one` form of a plural too (copy `_other`). An API sentence needs its
  vi/es/pt line in `internal/locale/catalog/*.json`
  (`TestEverySentenceIsTranslated`); add lines without re-sorting.
- A new write route needs a `// budget:` comment, an entry in `Patterns()`,
  and one in `internal/app/isolation_test.go`.
- No colour literals in components, and contrast is tested
  (`theme-contrast.test.ts`). Nothing spins in chat.
- A migration's number must be above the one live in production, or
  golang-migrate will skip it.
- `chat` may import `internal/tools`; a test in `tools` that needs `chat`
  lives in the external package `tools_test` (`injection_prompt_test.go`),
  or the import cycle returns.

## Testing

- Go: `go test ./internal/capabilities/chat/ ./internal/api/chatapi/
  ./internal/byok/ ./internal/providers/`. The API tests need
  `ANYTOOLS_TEST_DSN` pointing at a test database.
- Web: `chat-*.test.ts(x)`, `code-blocks.test.tsx`, `code-render-libs.test.ts`,
  `providers.test.tsx`, `recent-conversations.test.tsx`,
  `settings-readiness.test.tsx`, run with
  `npx vitest run --maxWorkers=3 <files>`.
- By hand, with no cloud key: Ollama's OpenAI-compatible endpoint
  (`http://localhost:11434/v1`) as a Custom endpoint, with
  `ANYTOOLS_BYOK_ALLOW_PRIVATE_ENDPOINTS=1` on the API and
  `ANYTOOLS_DEV_LOGIN=1` on the web for "Continue locally". A second sign-in
  is `ANYTOOLS_DEV_LOGIN_EMAIL`. Small local models rarely call tools, so
  check tool paths with tests or a cloud key.

## Known gaps and next upgrades

From the phases' own notes and a learner walkthrough on 2026-10-22:

- **Setting up is not finished when the checklist says so.** Home ticks
  "Connect an AI account" once any connection exists, but a preset without a
  default model leaves every route empty, and the first upload fails with "No
  embedding model is configured". The checklist should look at routes, or
  connecting should offer to fill them.
- **A Custom endpoint cannot index.** `ProviderSupports` refuses embed when
  the preset has no default embed model, so Ollama or LM Studio users cannot
  add documents. Yet the Index dialog offers the connection and its
  embeddings models, then shows "Openai_compat cannot serve embed" as an
  untranslated error, and the dialog closes on submit, hiding it. The OpenAI
  page has no Base URL field either.
- **No check by running.** Code exercises are Python only, and Solve's "Check
  my answer" is a model's opinion (it passed a SQL query that always returns
  nothing). A SQL exercise run in the browser would fix both for SQL.
- **"Only from your documents" depends on the model calling tools.** When it
  does not, nothing is retrieved and the work row does not say so.
  Pre-retrieval, or a "your documents were not searched" note, is open.
- **Unfenced code renders as Markdown or maths**: `COUNT(*)` loses its
  asterisks, and `$…$` in Solve becomes maths.
- "Try again" on a Solve question asked in chat re-asks without the photo.
- Cached tokens and the stall guard are tested but not yet seen against a
  real cloud provider.
- At 390 px, the Routes table is 2 px wider than the page.
