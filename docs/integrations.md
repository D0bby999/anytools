# Learning apps

AnyLearn connects to the tools a learner already studies with, on one page, **Mine → Learning apps** (`/apps`). Plan: `the private design notes`.

Every integration below works the same way:

- it asks only for what it needs;
- it is off until the learner turns it on;
- it says when it is not set up on the server, and the rest of the page keeps working.

## At a glance

| Integration | Permission | Needs Google review | Server settings |
|---|---|---|---|
| Google Drive | `drive.file` | no (non-sensitive) | `ANYTOOLS_GOOGLE_CLIENT_ID`, `_SECRET`, `_API_KEY`, `_PICKER_APP_ID` |
| Google Forms and Sheets | `drive.file` (the Drive grant) | no | Forms API enabled in the GCP project |
| Send to NotebookLM | `drive.file` (the Drive grant) | no | none |
| Study calendar feed (ICS) | none | no | none |
| Google Calendar, written directly | `calendar.app.created` | yes (sensitive) | Calendar API enabled |
| Google Classroom | `classroom.courses.readonly`, `classroom.courseworkmaterials.readonly`, `classroom.coursework.me.readonly`, `classroom.announcements.readonly` | yes (sensitive) | Classroom API enabled |
| Google Photos | `photospicker.mediaitems.readonly` | yes | Photos Picker API enabled |
| YouTube playlists | none (public data) | no | `ANYTOOLS_GOOGLE_API_KEY` with YouTube Data API v3, or `yt-dlp` |
| Email in | none | no | `ANYTOOLS_INBOUND_SECRET`, the Worker, Email Routing |
| Canva | `design:meta:read`, `design:content:read`, `design:content:write`, `profile:read` | Canva's review | `ANYTOOLS_CANVA_CLIENT_ID`, `_SECRET` |
| Notion | the pages the learner shares | no | `ANYTOOLS_NOTION_CLIENT_ID`, `_SECRET` |

## Google: one grant, widened per feature

The learner's Google grant is the row in `drive_connections`; its `scope` column records every scope granted so far.

- **Adding a feature.** Each feature asks for its own scopes on top of the grant through incremental authorization (`/auth/drive?add=calendar`, with `include_granted_scopes=true`). The feature catalogue is `internal/connectors/drive/google.go`.
- **Account check.** The consent asks for `openid email`, and the API refuses a grant from another Google account than the one already connected (409 `different_google_account`). Without that check, Drive's files would lose their grant.
- **Sensitive scopes are switched.** Calendar, Classroom and Photos are offered only to the accounts in `ANYTOOLS_GOOGLE_SENSITIVE_SCOPES`: a comma-separated list of emails, or `all` once Google has verified the app. Other learners see "Waiting for Google's approval".
- **Disconnecting.** Google revokes a token, not a scope, so there is one Disconnect for every Google feature. Its dialog says so.
- **Every Google call goes through one path.** `drive.Service.GoogleDo` checks the scope and refreshes on a 401. `internal/connectors/googleapi` reads Google's error envelope; a disabled API answers `api_disabled`, which the page puts into words.

### Calendar

There are two ways to get the study calendar into a calendar app.

- **Feed.** `/cal/<token>.ics` serves:
  - the review hour, daily;
  - the Loop's weekly reviews and cycle ends;
  - training days.

  Details:
  - it is in the learner's zone and language;
  - titles are generic unless the learner turns names on;
  - **Change the URL** kills the old one;
  - the read is a gateway-only API route (`POST /v1/calendar/feed/read`).

  Google refreshes a subscribed feed on its own schedule, up to about a day.
- **Written directly** (`internal/connectors/gcal`). Hourly, AnyLearn writes into one calendar of its own:
  - today's review, titled with how much is due;
  - the same recurring events as the feed.

  Event ids derive from the feed's UIDs, so a retry never duplicates an event. Events that no longer belong are deleted.

### Classroom

`internal/connectors/classroom` covers this.

- **Where a class goes.** Each class goes to a knowledge base of its own.
- **What is listed.** The class's materials, assignments and announcements, ticked when not yet imported.
- **How each kind is imported:**
  - links and videos go through `AddLink`;
  - posts become Markdown;
  - forms, NotebookLM notebooks and Gemini Gems become documents with their link.
- **Drive files.** `drive.file` does not reach them, so the page opens the Picker on exactly those ids (`setFileIds`); after the learner confirms, the Drive import takes them.
- **New materials.** A daily job counts what is new. It never imports.
- **School accounts.** A school administrator's refusal (403, or `admin_policy_enforced` at consent) shows what to ask the administrator:

  > Admin console → Security → API controls → App access control → AnyLearn → Trusted or Limited.

  Accounts of students under 18 are blocked from unconfigured apps by default.

### NotebookLM

NotebookLM has no API a learner's account can use (the Enterprise API is a preview behind a licence). **Send to… → NotebookLM** does this instead:

1. It writes the export as a Google Doc into the folder `AnyLearn for NotebookLM`.
2. It tells the learner to add the doc as a Drive source.

Classroom also lists NotebookLM notebooks a teacher attached.

### Photos

The Library API reads only app-created items since 2025-03-31, so AnyLearn uses the Picker API:

1. A session is created.
2. Google's window opens in the click.
3. The page polls until the set is ready.
4. The photos become one page-photo document and the session is deleted.

Only `*.googleusercontent.com` media URLs get the token.

## Email in

Each learner has `<24 chars>@in.anytools.world` (`internal/inbound`).

**Path of a message:**
1. Cloudflare Email Routing (catch-all on `in.anytools.world`) hands it to the Worker `deploy/cloudflare/inbound-email`.
2. The Worker signs it: hex HMAC-SHA256 of `<unix seconds>.<hex sha256(raw)>` with `INBOUND_SECRET`.
3. It posts to `https://anytools.world/inbound/email`.
4. The BFF forwards it to the gateway-only `POST /v1/inbound/email`.

**What becomes of it:**
- The body becomes a Markdown document.
- Attachments go through the upload pipeline's own type and size checks.
- Gmail's forwarding confirmation is shown on the card, never imported.

**Refused:**
- a bad or stale signature (more than 5 minutes);
- an unknown address;
- over 25 MiB;
- over 50 messages a day;
- a repeated Message-ID, which is filed once.

The Worker bounces these with a reason, and throws on a 5xx so the sender retries.

**Setup:**
1. Enable Email Routing on the `anytools.world` zone and add the subdomain `in.anytools.world` (Cloudflare adds its MX records).
2. Generate a secret with `openssl rand -hex 32`, then set it as `ANYTOOLS_INBOUND_SECRET` in `/opt/anytools/.env` and redeploy.
3. Deploy the Worker:
   ```
   cd deploy/cloudflare/inbound-email
   npx wrangler deploy
   npx wrangler secret put INBOUND_SECRET
   ```
4. Add the Email Routing rule: catch-all on `in.anytools.world` → Send to Worker → `anylearn-inbound`.

`ANYTOOLS_INBOUND_DOMAIN` overrides the domain for a self-hosted copy.

## Canva and Notion

Both use `internal/connectors/appconn`.

- **Consent.** The BFF owns the state cookie and the PKCE verifier (`/auth/app/:provider`). The API builds the authorize URL and exchanges the code, so the client secret never leaves it.
- **Tokens.** Refresh tokens rotate and are stored encrypted in `app_connections`.
- **Disconnecting** revokes at the app.

**Canva** (`internal/connectors/canva`):
- A design is exported as a PDF (export job, polled) into a knowledge base.
- **Send to… → Canva** writes the export as a `.docx` and imports it as a Canva Doc.
- Until Canva approves the public integration, only the developer's team can connect.

**Notion** (`internal/connectors/notion`, API version 2022-06-28):
- Pages and databases shared at consent become documents.
- They are imported again hourly when `last_edited_time` changes; an unshared page is marked gone and its document kept.
- **Send to… → Notion** writes a page under the most recently edited shared page.

**Setup:**
1. **Canva.** In the [Canva Developer Portal](https://www.canva.com/developers/integrations/connect-api):
   - create an integration;
   - set the redirect URL `https://anytools.world/auth/app/canva/callback`;
   - tick the four scopes above;
   - copy the client id and secret into `ANYTOOLS_CANVA_CLIENT_ID` and `ANYTOOLS_CANVA_CLIENT_SECRET`;
   - submit it for review.
2. **Notion.** In [Notion's integrations](https://www.notion.so/profile/integrations):
   - create a **public** connection with the redirect URI `https://anytools.world/auth/app/notion/callback`;
   - give it read content, update content and insert content capabilities;
   - copy the OAuth client id and secret into `ANYTOOLS_NOTION_CLIENT_ID` and `ANYTOOLS_NOTION_CLIENT_SECRET`.

## YouTube playlists

`internal/connectors/youtube/playlist.go`:
- It reads `playlistItems.list` with `ANYTOOLS_GOOGLE_API_KEY` (one quota unit per 50 videos) when the YouTube Data API v3 is enabled on that key.
- Otherwise it falls back to `yt-dlp --flat-playlist`.

The kept videos are added in order as video links; at most 200.

## Not integrated, and why

| Tool | Why not |
|---|---|
| Gmail API (reading mail) | Restricted scope: a paid yearly security assessment. Email in does the same with forwarding. |
| NotebookLM Enterprise API | Preview, needs an Enterprise licence. |
| Google Keep | API only for Workspace business accounts. |
| Quizlet, Khan Academy, Duolingo, Coursera | No public API for a learner's data. |
| Google Scholar | No API; OpenAlex is used. |
