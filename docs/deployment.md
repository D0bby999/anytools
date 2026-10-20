# Deploying AnyTools

AnyTools runs on one VPS with docker-compose. This page covers the whole lifecycle: first setup, each deploy, backups and restore. The architecture behind these rules is in [architecture.md](./architecture.md).

## What runs where

| Service | Reachable from | Notes |
|---|---|---|
| `nginx` | the internet, ports 80/443 | TLS termination. It proxies to `web` only, never to `api`. |
| `web` | nginx, over the compose network; the box itself on `127.0.0.1:3000` | The React Router server. It is the only client of the API. |
| `api` | `web` only | It has no `ports:` entry. A test asserts this for both compose files. Exactly one replica, because runtime state (stream bus, job workers, rate limits) lives in the process. |
| `postgres` | `api` and `migrate` | Volume `postgres-data`. |
| `certbot` | — | Renews the certificate every 12 hours through the nginx webroot. |
| `stt` (profile `stt`) | `api` only | Optional. speaches running faster-whisper: the built-in transcription engine. No `ports:`, no key, model cache on volume `stt-models`. See "Built-in transcription". |
| `tts` (profile `tts`) | `api` only | Optional. Kokoro-FastAPI: the built-in voices for audio overviews. No `ports:`, no key, model on volume `tts-models`. See "Built-in voices". |

Production is the base file plus an overlay:

```sh
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml <command>
```

`deploy.sh` and `setup-server.sh` always pass both files.

## Environment names after the rename

This app was called Longplay until October 2026, and its variables used the prefix `LONGPLAY_`. For one release, a `LONGPLAY_*` variable is still read when its `ANYTOOLS_*` twin is unset or empty. A set `ANYTOOLS_*` value always wins. The API logs one warning at boot that names the old variables it found (names only, never values), and `deploy/scripts/legacy-env.sh` does the same for `deploy.sh`, `run-local.sh`, `backup.sh` and `restore.sh`. Rename each variable to `ANYTOOLS_*` before the next release, because that release drops the fallback.

## Before the first deploy

1. **Collect what the owner provides:**
   - a domain whose A/AAAA records point at the VPS;
   - a Google OAuth client with **two** redirect URIs: `https://DOMAIN/auth/callback/google` (sign-in) and `https://DOMAIN/auth/drive/callback` (the Drive connector, which has its own callback so it can never mint a session);
   - for Drive, a browser API key (`ANYTOOLS_GOOGLE_API_KEY`) and the GCP project number (`ANYTOOLS_GOOGLE_PICKER_APP_ID`). The Drive and Picker APIs must be enabled on the project. Without both values the Drive UI does not appear, and nothing else is affected;
   - a GitHub OAuth app with callback `https://DOMAIN/auth/callback/github`;
   - an off-box rsync target for backups.
2. **Create `.env` from `.env.example` and generate the three secrets:**
   ```sh
   openssl rand -hex 32   # ANYTOOLS_ENCRYPTION_KEY
   openssl rand -hex 32   # ANYTOOLS_GATEWAY_TOKEN
   openssl rand -hex 32   # ANYTOOLS_SESSION_SECRET
   ```
3. **Escrow `ANYTOOLS_ENCRYPTION_KEY` OFF the VPS before anything is stored.** Use a password manager entry, or a sealed note held by a second person. The key encrypts every user's stored API keys and OAuth tokens. It is deliberately never part of a backup, because a backup that carried its own key would decrypt every secret for whoever obtained the backup. Without the key a backup can still be restored, but every connection must then be re-entered by its user.
4. **Run the one-time setup as root, from the repo checkout** (for example `/opt/anytools`):
   ```sh
   ANYTOOLS_DOMAIN=learn.example.com LETSENCRYPT_EMAIL=you@example.com deploy/scripts/setup-server.sh
   ```
   This installs Docker, opens only ports 22, 80 and 443, issues the first certificate, and installs the hourly backup cron.

## Deploying anytools.world: from the owner's machine

Since 2026-10-20 GitHub runs no CI and no deploy; the owner's machine does both, the way postclaw
does since its Actions minutes ran out. `scripts/publish-public.sh "message"` deploys first and
publishes only after a good deploy, so the public repository never runs ahead of the site:

1. It asks the host which commit is live (`ANYTOOLS_IMAGE_TAG=host-<commit>` in
   `/opt/anytools/.env`). If HEAD changes nothing since then but `docs/`, `plans/`, `.claude/` or a
   top-level `*.md`, it publishes without a deploy.
2. Otherwise `deploy/scripts/deploy-host.sh root@157.180.70.19`:
   - checks, fast: `gofmt`, `go vet ./...`, the web app's typecheck;
   - builds the API for linux/amd64 and the web app, and renders every old URL against the build
     (`ssr-smoke.mjs`);
   - copies both to `/opt/anytools/stage` and builds runtime-only images there, tagged
     `host-<commit>` (nothing compiles on the host);
   - runs `/opt/anytools/bin/activate` (`deploy/scripts/activate.sh`, installed by each deploy).
3. `activate` dumps the database to `/opt/anytools/backups/…-pre-host-<commit>.sql.gz` (it keeps
   ten), sets `ANYTOOLS_IMAGE_TAG` and runs the stack with the one-shot `migrate` before `api`,
   then waits up to two minutes for the API's `/health`, the web server and
   `https://anytools.world/` through Traefik. When anything fails it puts the previous compose file
   and tag back, restarts `api` and `web`, and prints the dump's path; migrations are forward-only,
   so that dump is the way back for the schema. It keeps the live images and the two before them.
4. A failed deploy publishes nothing.

`SKIP_DEPLOY=1` publishes without deploying. `deploy-host.sh` can also run on its own, to deploy
HEAD again. The full suites are not in the deploy path; run them by hand before a release:
`go test ./...` (with `ANYTOOLS_TEST_DSN`) and `pnpm test` in `ui/web`. The Test and Images
workflows still exist on GitHub, by hand only (**Run workflow**); Images publishes images for
self-hosters.

**Rolling back by hand.** Set `ANYTOOLS_IMAGE_TAG` in `/opt/anytools/.env` to one of the kept
`host-…` tags (`docker images ghcr.io/d0bby999/anytools-web`) and run
`docker compose -p anytools up -d` there.

## Deploying a self-hosted copy

```sh
deploy/scripts/deploy.sh
```

The script runs these steps in order:
1. A backup, if the stack is already running, because a migration is a schema change.
2. Build the images.
3. The one-shot `migrate` container. `serve` never migrates.
4. Start `api`, `web`, `nginx` and `certbot`, and, when `ANYTOOLS_STT_URL` is set, the built-in transcription engine (`stt` and its one-shot `stt-model`).
5. Wait for `https://DOMAIN/` to answer. If it never answers, the deploy fails and prints the service logs.

## Review reminders

Nothing to configure. The API makes its VAPID key pair on first use and keeps it in `push_vapid`, encrypted under `ANYTOOLS_ENCRYPTION_KEY`; restoring a backup restores it, and losing it means every learner turns reminders on again. The `api` container needs outbound HTTPS to the browser push services (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`), and `ANYTOOLS_APP_URL` must be the public https origin, since Apple refuses a VAPID subject that is not.

## Built-in transcription

Learners can transcribe a video without captions, an uploaded audio or video file, or a podcast episode in two ways: with their own speech key (Groq, OpenAI, Gemini, or their own OpenAI-compatible Whisper server, under Settings → Connections and the Speech to text route), or with the server's own engine, which needs no key. The server's engine is optional.

**Turn it on.**
1. In `.env`, set `ANYTOOLS_STT_URL=http://stt:8000`. Optionally set `ANYTOOLS_STT_MODEL` (default `Systran/faster-whisper-small`, int8 on CPU) and `ANYTOOLS_STT_DAILY_MINUTES` (default 120 minutes of audio per learner per local day).
2. Start the stack with the profile:
   ```sh
   docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --profile stt up -d
   ```
   The one-shot `stt-model` service downloads the model once into the `stt-models` volume, then exits.
3. Settings → Routes → Readiness lists "Built-in transcription (free, slower)" under Speech to text once `GET http://stt:8000/health` answers and the model is downloaded.

Without the profile, or with `ANYTOOLS_STT_URL` unset, the built-in option simply does not appear and nothing else changes.

**Sizing.** `stt` is capped at 3 GB. The small model hears a few seconds of audio per second on a few CPU cores; the page's time estimate is the video's length divided by the speed the server last measured. On a bigger server, set `ANYTOOLS_STT_MODEL=deepdml/faster-whisper-large-v3-turbo-ct2`, run `--profile stt up -d` again, and the new model is downloaded. One built-in job runs at a time; the others wait, and the page shows how many are ahead.

**Audio from YouTube.** For any engine but Gemini (which reads the video's URL itself), the API fetches the audio track with `yt-dlp` (pinned in `deploy/Dockerfile.api`) into a per-job directory under `ANYTOOLS_DATA_DIR/tmp`, cuts it with `ffmpeg`, and removes the directory when the job ends, whatever the outcome. A directory left by a crash is removed at the next start. Audio is never stored or served.

YouTube often refuses downloads from data-centre addresses. When it does, the job ends with "YouTube blocked this server", the minutes are given back, and the page offers what still works: Gemini reading the URL, or a subtitle file or a pasted transcript. AnyTools never uses browser cookies or proxies to get around the block.

**Storage.** Uploaded audio and video files and podcast episodes are kept as originals, up to 500 MB each, in `ANYTOOLS_DATA_DIR`; an upload or an episode is held in the API's memory while it is stored, so leave room for a few at once. Speaking recordings are capped at 500 MB per learner. Size the data volume for both.

**Updating yt-dlp.** YouTube changes often, and an old yt-dlp stops working. To update it, change `YTDLP_VERSION` in `deploy/Dockerfile.api` and replace both checksums with the `yt-dlp_musllinux` and `yt-dlp_musllinux_aarch64` lines of that release's `SHA2-256SUMS`, then deploy.

**Local runs.** `deploy/scripts/run-local.sh` starts the same image on `127.0.0.1:8000` when Docker is present, and skips it with a message when it is not.

## Built-in voices

An audio overview's script can be spoken three ways: by the learner's own speech key (an OpenAI key, or their own OpenAI-compatible speech server, routed to Speech), by the browser's own voices, or by the server's own Kokoro, which needs no key. The server's voices are optional.

**Turn them on.**
1. In `.env`, set `ANYTOOLS_TTS_URL=http://tts:8880`. Optionally set `ANYTOOLS_TTS_DAILY_MINUTES` (default 60 minutes of speech per learner per local day).
2. Start the stack with the profile:
   ```sh
   docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --profile tts up -d
   ```
   The image is `ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0`, pinned by digest. It ships the Kokoro model; the `tts-models` volume keeps it across restarts. `deploy.sh` starts the profile whenever `ANYTOOLS_TTS_URL` is set.
3. Settings → Routes → Readiness lists "Built-in voices (free, English and 6 other languages, not Vietnamese)" under Speech once `GET http://tts:8880/health` and `GET /v1/models/kokoro` answer.

Without the profile, or with `ANYTOOLS_TTS_URL` unset, the built-in option does not appear and nothing else changes.

**Languages.** Kokoro has two distinct voices (one female, one male) for American and British English, Spanish, Hindi, Italian, Japanese, Brazilian Portuguese and Mandarin. It has one French voice and no Vietnamese voice, so it is never offered for French or Vietnamese; those overviews are offered the learner's own key and the browser. Overviews are currently written in English or Vietnamese only.

**Allowance and sizing.** "Speak it" books the most audio the script could take (its words at 110 a minute) from the learner's day in one statement, and gives back what was not spoken when the job ends, however it ends. One built-in job runs at a time on its own worker; the page shows how many are ahead and the time estimate from the speed the server last measured. `tts` is capped at 2 GB.

**Updating Kokoro-FastAPI.** Read the new release's multi-arch index digest from ghcr (`docker buildx imagetools inspect ghcr.io/remsky/kokoro-fastapi-cpu:vX.Y.Z`), replace the tag and digest in `deploy/docker-compose.prod.yml` and `deploy/scripts/run-local.sh`, then deploy.

**Local runs.** `deploy/scripts/run-local.sh` starts the same image on `127.0.0.1:8880` when Docker is present (`ANYTOOLS_LOCAL_TTS=0` skips it), and skips it with a message when Docker is absent.

## Learners' files in their Google Drive

**The data volume must belong to the API's user (uid 10001).** Images from 2026-10-20 on create the mount point with that owner, so a new volume gets it. A volume made by an older image is root's: the API then boots until a Google client is set, and fails with `blob: create cache dir: ... permission denied`. Fix it once:

```sh
docker run --rm -v anytools_anytools-data:/d alpine chown 10001:10001 /d
```


When Drive is configured, a learner can choose in Settings → Storage to keep their uploads, page photos, recordings, generated audio, exam papers and exports in a "AnyTools" folder in their own Drive instead of in `ANYTOOLS_DATA_DIR`. It is off for everyone until each learner turns it on. Parsed text, chunks, embeddings and every database row stay on the server. See [byok.md](./byok.md#keeping-your-files-in-your-drive) for what learners see.

- **What it needs.** Nothing beyond Drive import: the same OAuth client and the **Google Drive API** enabled on the project. It uses the same `drive.file` scope, so the consent screen and the scopes Google reviews do not change, and learners who connected already do not reconnect. Storage requests reach only `www.googleapis.com`.
- **The cache.** Files read back from Drive are cached under `ANYTOOLS_DATA_DIR/cache`, up to `ANYTOOLS_DRIVE_CACHE_MB` (default 2048) across all learners, least recently used first out. Count it in the data volume. The cache is rebuilt from Drive, so backups leave it out; a learner's cache goes when they disconnect, lose access or delete their account.
- **Moving files** (Settings → Storage) runs as the `storage_move` job on a worker of its own, one move at a time across the server. Each file is written, checked against Drive's checksum, recorded, and only then deleted from where it was.
- **Account deletion** removes the learner's rows and cache and never deletes a file in their Drive.
- **The restore drill** (`anytools verify`) counts originals kept in Drive without contacting Google, so it cannot see a file a learner deleted in Drive that nobody has opened since.

### Live checks, once the GCP project exists

Every Drive behaviour has been proven only against a fake of Drive v3 shaped from Google's documentation (`internal/connectors/drive/drivetest`). Run these once against a real Google account, with a test learner, before offering storage to anyone. Each names what the fake assumed.

1. **Connect.** In Settings → Connections, connect Google Drive. The row turns ready.
2. **Turn storage on.** In Settings → Storage, choose "In my Google Drive" and save. A "AnyTools" folder with "Uploads", "Recordings", "Audio", "Exam papers" and "Exports" appears in Drive, once. Saving again or connecting from a second browser makes no second folder (the folder search by `appProperties`).
3. **Upload a PDF and an MP3** into a knowledge base. Both land in "Uploads" with readable names; nothing new appears under `ANYTOOLS_DATA_DIR/originals/<user>`. In Drive's file details, each carries AnyTools' tags. Also upload a file over 20 MB, so the resumable upload takes several 8 MiB chunks: the session's `Location` header, the `308` answer's `Range` header (`bytes=0-N`), and `md5Checksum` and `size` on the final answer must be what AnyTools checks.
4. **Play the MP3 and seek.** Playback starts, and dragging the seek bar jumps without restarting (`alt=media` with `Range` answers 206 with a `Content-Range` naming the whole size). Clear the learner's cache directory first, so the read comes from Drive.
5. **Check the folder in Drive.** The PDF and the MP3 are in "Uploads"; a speaking take lands in "Recordings", a generated audio overview in "Audio" and an exam paper in "Exam papers". "Save to my Drive" on a worksheet lands in "Exports" and its link opens the file.
6. **Checksums.** For an app-uploaded file, `files.get` with `fields=sha256Checksum,md5Checksum,size` returns `sha256Checksum` (a move to Drive checks it, and falls back to md5 without it).
7. **Search by file.** `files.list` with three `appProperties has` clauses (`longplay_user`, `longplay_kind`, `longplay_key`) and `trashed = false` finds exactly the one file (a resumed move adopts an earlier upload this way).
8. **Delete a file in Drive** (the PDF), empty the cache, and open it in AnyTools. The viewer says "This file was removed from your Drive" and the text still shows (a trashed file reports `trashed: true`; one deleted from the trash answers 404). Upload the same PDF again: it opens again.
9. **Trash the "Uploads" folder** in Drive, then upload. AnyTools makes a new "Uploads" and the file lands there (a file in a trashed folder reports `trashed: true` through its parent). Delete the old folder from the trash too, then reconnect: AnyTools does not look for it (a folder deleted from the trash answers 404).
10. **Revoke access** at myaccount.google.com → Security → Third-party connections, then (after the access token's hour, or with the cache cleared) open the MP3. The player says "Reconnect Google Drive" with a link, and an upload is refused with the same reason. Record Drive's 401 body: AnyTools expects the `authError` envelope and refreshes once before asking the learner to reconnect.
11. **Reconnect.** The same files open again, and no new "AnyTools" folder appears in Drive.
12. **Full Drive.** With a nearly full test account, upload a file larger than the space left. The upload is refused with "Your Google Drive is full" and nothing is kept on the server. Record whether Drive answers 403 `storageQuotaExceeded` when the session opens or on a chunk part way through; AnyTools handles both.
13. **A large move.** With a few GB of files on the server, choose Drive and press "Move my files to Drive". Progress counts up, "Stop moving" stops after the current file, and pressing Move again picks up where it stopped. Then choose the server and move everything back: "Space used" ends with 0 files in Drive, and nothing is left in the "AnyTools" folder but exports.
14. **Disconnect with files in Drive.** Disconnect asks first, and offers "Move my files back first".
15. **Delete the test account.** The "AnyTools" folder and its files are still in that Drive.

## Cloudflare in front of anytools.world

The web server sends `Cache-Control: private, no-cache` on every page and every `*.data` response (`applyCachePolicy` in `ui/web/app/lib/security-headers.server.ts`). Hashed files under `/assets/` are `immutable` for a year.

**No cache rule may override it.** Until 2026-10-20 the zone had a "cache everything" rule left from the old Next.js site: it stored every 200 for about two hours whatever its headers, keyed on the URL alone, and stripped `Set-Cookie` from what it stored. Its only bypass was the old site's `better-auth.session_token` cookie. So cached pages named scripts a deploy had removed (tools dead until the copy expired), and a 200 rendered for one session came back as a `HIT` for another session and for an anonymous visitor. Headers from the origin could not stop it (49e32eb tried a `Set-Cookie` on every signed-in response, and was reverted). The owner deleted the rule on 2026-10-20; pages and data are now `DYNAMIC`, and `/assets/` still `HIT`.

Check it after any change in Cloudflare:

```sh
u="https://anytools.world/vi/health?check=$RANDOM"
curl -sI "$u" | grep -i cf-cache-status   # DYNAMIC
curl -sI "$u" | grep -i cf-cache-status   # DYNAMIC again, never HIT
```

## Backups

- **Unit.** One timestamped directory holding `db.dump` (`pg_dump -Fc`), `data.tar.gz` (the `anytools-data` volume: uploaded originals and parsed Markdown, without the Drive cache `cache/`) and `SHA256SUMS`. A unit without `SHA256SUMS` is incomplete and is removed.
- **Schedule.** Every hour, from `/etc/cron.d/anytools-backup`. The **RPO is 1 hour**.
- **Retention.** 7 days on the box, set by `ANYTOOLS_BACKUP_KEEP_DAYS`.
- **Off-box copy.** Every unit is `rsync`ed to `ANYTOOLS_BACKUP_REMOTE`. In compose mode `backup.sh` refuses to run without that variable, because a backup that never leaves the VPS dies with the VPS.
- **Log.** `/var/log/anytools-backup.log`.
- **anytools.world today.** The hourly unit above is not installed; instead:
  - every night at 03:10 UTC the host's `/root/nightly-pg-backup.sh`, beside its other sites, writes the database (`/var/backups/pg/anytools-<date>.sql.gz`) and the learners' files without the Drive cache (`anytools-data-<date>.tar.gz`), kept 7 days (log `/var/log/nightly-pg-backup.log`);
  - before every deploy `activate` dumps the database to `/opt/anytools/backups/` (ten kept);
  - every day at 11:00 the owner's Mac pulls both to `~/Backups/anytools.world/`, kept 30 days (`deploy/scripts/pull-backups.sh`, run by launchd from `deploy/launchd/world.anytools.backup-pull.plist`, whose header says how to install it; log `~/Backups/anytools.world/pull.log`). It checks the newest dump is a real one. A Mac asleep at 11:00 pulls on waking; one away for more than a week misses dumps the host has already dropped.

  The pulled dump of 2026-10-20 restored cleanly into an empty database (83 tables, schema 1790270000). It names the `anytools` role, so a restore elsewhere needs that role, or the dump's `OWNER TO` and `GRANT` lines removed. The encryption key's escrow (`~/.anytools-secrets/`) is on the same Mac: losing the Mac loses both, so keep a copy of the key elsewhere too.

## Restoring

```sh
set -a; . ./.env; set +a    # ANYTOOLS_ENCRYPTION_KEY must be the ESCROWED key
deploy/scripts/restore.sh /var/backups/anytools/20260926T010000Z --yes
```

`restore.sh` is destructive and refuses to run without `--yes`. It runs these steps in order:
1. Verify the checksums.
2. Stop `api` and `web`.
3. Replace the database contents and the data volume.
4. Run `anytools verify`.
5. Start `api` and `web` again.

If `verify` fails, the services stay stopped.

`anytools verify` is read-only. It checks three things:
- the key matches the database sentinel;
- every `*_enc` column decrypts, and none of them holds a plaintext value;
- every document's original file and parsed Markdown exist.

Run it on its own at any time:

```sh
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml run --rm --no-deps api verify
```

### Restore drill

Do a drill before going live, and again after any change to backups. Restore the latest unit onto a **fresh** box using only the off-box copy and the escrowed key, then:
- open a document that is `ready`;
- follow a citation to its page;
- check that a connection still verifies.

The drill done so far ran on a development machine in local mode. The production drill is still owed.

## Observability

- Both `api` and `web` log to stdout. `api` writes structured JSON. Docker keeps 5 × 20 MB per service.
- `api` exposes `GET /health`, which reports process liveness only. It is reachable only inside the compose network.
- Point an external uptime check at `https://DOMAIN/`.
