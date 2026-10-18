# Bring your own keys

AnyTools has no AI credential of its own, and no platform key for search either. Everything it does with a model or with the web runs on an account you connect, and until you connect one, that part of the product says it cannot run. It never falls back to someone else's quota. The design behind this is in [architecture.md](./architecture.md) §3.

## What needs a key

| Capability | Route function | What it does |
|---|---|---|
| Chat | `chat` | Answers questions from your documents, with citations |
| Read documents | `parse` | Also transcribes a public YouTube video when its own captions cannot be fetched (with a Gemini key: Google reads the video, and the transcript is labelled "AI transcript"). Reads PDFs page by page, including scans, tables and formulas. With no model routed, a PDF that has a text layer is read locally (tables and formulas may be flattened, and the document says so), and a scanned PDF fails. DOCX, PPTX, EPUB, HTML and plain text are always read locally and never sent here. |
| Index | `embed` | Turns documents into vectors for search. **Changing this model means re-indexing**: vectors from two models are not comparable, so AnyTools blocks search on a knowledge base until it is re-indexed rather than return confident nonsense. |
| Quizzes | `quiz` | Writes questions and marks free-text answers |
| Mastery path | `mastery` | Proposes modules and knowledge points |
| Immersive reading | `reading` | Explains, translates or quizzes a selected passage |
| Solve | `solve` | Works a problem step by step, from text or a photo |
| Research | `research` | Plans and writes a cited report |
| Rerank | `rerank` | Reserved; not used yet |
| Speech | `tts` | Speaks audio overviews in two voices. Optional: the server's built-in voices (when it runs them) or your browser can speak a script with no key. Served by an **OpenAI API key** (`tts-1` by default; `tts-1-hd` or `gpt-4o-mini-tts` by name) or **your own OpenAI-compatible speech server**, such as your own Kokoro (name its model, e.g. `kokoro`; its base URL passes the same private-address check as every endpoint). Gemini no longer speaks: its old Speech routes were removed. Verify speaks one short sentence. |
| Speech to text | `stt` | Transcribes a video without captions, an uploaded audio or video file, or a podcast episode. Optional: the server's built-in Whisper (when it runs one, within the daily minutes) needs no key, and a subtitle file or a pasted transcript always works. Served by **Groq** (`whisper-large-v3-turbo` by default; the Groq preset under Add a key, whose free tier is on your own Groq account), **OpenAI** (`whisper-1`, the one OpenAI model with segment times), **your own OpenAI-compatible Whisper server** (name its model), or **Gemini**, which reads a public YouTube URL or an uploaded file through its Files API instead of hearing audio here. An API key only, never a subscription lane. The page shows the cost or time before anything runs. |

At a minimum, set up `chat`, `parse` and `embed`: Settings → Readiness marks those three as core. The others refuse with "no model is configured" until they are routed.

## Connecting a key

1. **Add the key.** Go to Settings → Connections → Add a key and choose a provider (table below), or any OpenAI-compatible endpoint (give its base URL).
   - The key is encrypted before it is stored and is never shown again.
   - A base URL must be `https` and must not resolve to a private address. It is checked when you save it and again on every connection.
2. **Verify it.** Press **Verify**. This makes one small real call and records which model answered.
3. **Route it.** Settings → Routes assigns connections to each function, in order. When the first connection is out of quota or refuses, the next one is tried.
   - **Embedding never fails over.** A second embedding model is a different vector space, so a failed embed fails.
   - **An answer that has started streaming is never restarted** on another connection.

Each chat turn records which connection and model actually answered.

### Which provider can do what

Every provider can serve the chat-type functions: `chat`, `quiz`, `mastery`, `reading`, `solve`, `research` and `rerank`. Reading PDFs and indexing need more:

| Provider | `parse` (PDFs) | `embed` (index) | Default chat model |
|---|---|---|---|
| Google Gemini | yes | yes | `gemini-2.5-flash` |
| OpenAI | yes | yes | `gpt-4o-mini` |
| Anthropic | yes | no | `claude-sonnet-4-5-20250929` |
| OpenRouter | no | no | `z-ai/glm-5.2:free` |
| DeepSeek | no | no | `deepseek-chat` |
| Qwen (Alibaba Cloud, international) | no | yes, `text-embedding-v4` | `qwen3-max` |
| Mistral | no | yes, `mistral-embed` | `mistral-medium-latest` |
| xAI (Grok) | no | no | `grok-4` |
| Groq | no | no | `openai/gpt-oss-120b` |
| Z.AI (GLM) | no | no | `glm-5.3` |
| OpenAI-compatible endpoint | no | no | none: name one under Routes |

The defaults were current on 2026-09-26 (`internal/byok/models.go`, `internal/byok/presets.go`). A model named on a route always wins, so when a default is retired, route the replacement. To index documents you need at least one connection that can embed.

## Web search

Research searches the web with your own **Tavily** or **Brave** key (Settings → Search keys). Without one, or when every key you have fails, it falls back to **DuckDuckGo**, which needs no key: AnyTools reads its no-JavaScript results page, the way postclaw does. It has no official API, so it can be slow, refuse automated requests, or break when the page changes; the report says when it was used, and a key is the reliable choice. An operator can turn the fallback off with `ANYTOOLS_KEYLESS_SEARCH=0`, and then research without a key runs on your documents only.

How a report is built:

- **Rounds.** Quick mode searches once. Deep mode then asks the model what the sources still miss and searches for that, for up to three rounds. It never repeats a search, and stops early when the sources suffice.
- **Choosing sources.** Results from every search are merged (the same page with different tracking parameters is one page), ranked across searches, weighted by kind of site (academic, official, reference works such as Wikipedia, news, other, forums), and capped at two pages per site. Quick reports stand on up to 5 sources and read the top 2 pages in full; deep reports on up to 20 and read 6.
- **Recency.** For a question about something current ("latest", "this year"), searches are limited to recent pages.
- **Claim check.** After writing, the model checks each claim against the text of the source it cites and marks it supported, partly supported, not in the source, or uncited. It is an AI reading the cited text, not proof; the report page lists the claims to check first.
- **Keep studying.** A report can be added to a knowledge base, optionally with the pages it cites. It then works like any document: quiz, mastery paths, and chat.

**Papers.** For a scholarly question (the model decides while planning), research also searches **OpenAlex**, falling back to **arXiv**, and papers rank as academic sources. A knowledge base page can list recent related papers and add one: an open-access PDF under an open licence is imported; any other paper comes in as a note with its abstract and a link. An OpenAlex key is optional (Settings → Search keys) and is used only for papers, never for web search. Without one, each person gets 20 keyless paper searches a day from OpenAlex's free allowance, which everyone on the server shares.

**Source keys.** Three more keys under Settings → Search keys bring sources in; none is a model, and each is used only from the server, stored encrypted and redacted from errors and logs:

- **YouTube Data API key** (`youtube_data`): lists a whole playlist, up to 500 videos. Without it, a playlist shows YouTube's keyless feed, its latest 15 videos.
- **GitHub token** (`github`): a fine-grained token with read-only access to contents, for private repositories. Public repositories need none.
- **Zotero** (`zotero`): your Zotero user id and a read-only API key. Verify makes one call to Zotero's key endpoint. With it, a knowledge base can add items from your library, and research may search the library.

Web tools exist only in research turns. Once your documents are in a research turn's context, the web is used only if you allowed it for that session, and `web_fetch` opens only pages the turn's own search returned.

## Google Drive

Drive import uses the `drive.file` scope with Google Picker, so AnyTools can see only the files you pick. A folder's contents are imported as they are at pick time. **Files added to the folder later need "Pick more"**, and the knowledge base page says this. Picked files are re-synced when they change. Disconnecting revokes the grant at Google.

The operator must configure a Google OAuth client, a browser API key and the Picker app id; see [deployment.md](./deployment.md). Without them the Drive buttons do not appear.

### Keeping your files in your Drive

With Drive connected, Settings → Storage can keep your own files in your Google Drive instead of on AnyTools' server. It stays off until you turn it on there; connecting Drive alone changes nothing. It uses the same `drive.file` grant: AnyTools can open the files it writes and nothing else in your Drive.

- **Where they go.** A folder named "AnyTools" with "Uploads" (originals and page photos), "Recordings", "Audio" (generated audio overviews), "Exam papers" and "Exports". Each file has a readable name, and AnyTools tags it so a reconnect finds it again.
- **What stays on the server.** The parsed text of each document, its passages and their embeddings, and the database rows. Search, chat and citations need them for every question, and they can be rebuilt from the original. Recently read files are also cached on the server for speed, up to a size the operator sets.
- **Moving.** Settings → Storage moves the files you already have, to Drive or back to the server, one file at a time. Each copy's checksum is checked before the old copy is deleted, and a stopped move picks up where it stopped.
- **Exports.** With storage in Drive, each "Download as Markdown" (worksheets, video study notes, books and notebooks) also offers "Save to my Drive", which writes into "Exports".

When Drive cannot be used, nothing is lost and nothing falls back to the server's disk. Search and chat keep working from the text on the server; only opening the original (playback, the PDF viewer, a re-parse) or keeping a new file fails, each with its own reason:

- **Access revoked or expired**, or Drive disconnected: "Reconnect Google Drive", with a link. New uploads are refused. Reconnecting gives back the same files and folders; nothing is copied. Disconnecting first asks whether to move your files back to the server.
- **A file deleted in your Drive**: "This file was removed from your Drive". Upload the same file again to put it back, or delete it from AnyTools.
- **Drive full**: "Your Google Drive is full". The upload is refused and nothing is kept on the server instead.

Deleting your AnyTools account never deletes anything in your Drive. The "AnyTools" folder and its files stay yours to keep or delete.

## Experimental subscription lanes (off by default)

`ANYTOOLS_EXPERIMENTAL_SUBSCRIPTION_LANES=1` enables four unofficial lanes. **None is licensed for this use, and accounts using them may be restricted.** All four serve chat-type functions only; they cannot read PDFs or index.

- **ChatGPT subscription (relay).** You obtain the token triple yourself and paste it in. AnyTools cannot sign you in to ChatGPT, and OpenAI offers no way for AnyTools to revoke these tokens, so deleting the connection or your account deletes them here only.
- **Gemini Code Assist.** Asks for `cloud-platform` scope, so the stored token can reach far more than AI. The operator supplies their own OAuth client (`ANYTOOLS_GEMINI_SUB_CLIENT_ID` / `_SECRET`) and the list of redirect URIs registered on it (`ANYTOOLS_GEMINI_SUB_REDIRECT_URIS`).

- **GitHub Copilot.** Settings shows a code; you enter it at github.com/login/device and approve, then press Finish. Needs an active Copilot seat. AnyTools signs in as VS Code's Copilot extension and stores the long-lived GitHub token (scope `read:user`), exchanging it for a short-lived Copilot token when it serves. Default model `gpt-5-mini`. Revoke it on GitHub under Settings → Applications; deleting it here deletes AnyTools' copy only.
- **Claude Pro or Max.** Open the approval link, approve on claude.ai, and paste the `code#state` text Claude shows. Codes work once and expire within minutes. AnyTools signs in as Claude Code and presents itself as it when serving; the token is renewed automatically. Anthropic may bill this traffic to extra usage rather than to your plan. Default model `claude-sonnet-4-5-20250929`. There is no revoke endpoint; sign out of other sessions on claude.ai to cut it off.

A started Copilot or Claude sign-in is held in the API's memory for up to 15 minutes, bound to the user who started it; restarting the API means starting again.

An ordinary API key is the reliable choice.

## Where your data goes

Reading a PDF or a photo sends it to the model you routed for `parse`, when you routed one. Transcribing sends the audio to the engine you chose: the server's built-in Whisper keeps it on the server; Groq, OpenAI or your own server receive it; Gemini receives the file and it is deleted there afterwards. Indexing sends the text of every document to your `embed` model. Asking about a document sends the retrieved passages to your `chat` model. Every document shows which provider read it. AnyTools cannot promise that a file never reaches an AI provider, so it does not offer a "never upload" switch.

Deleting a document removes its files. Deleting your account (Settings → Account) removes everything on the server, and revokes the Google grants. Files kept in your Google Drive stay there.
