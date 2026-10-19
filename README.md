# AnyTools

<!-- Screenshot placeholder: docs/images/screenshot.png (the Tools tab beside the reading view, 1600×1000). Add the file, then turn this comment into ![AnyTools](docs/images/screenshot.png). -->

Free tools that run in your browser without an account, and **AnyLearn**, a self-learning web app that works from **your own documents, with your own AI accounts**. It serves [anytools.world](https://anytools.world).

The tools (converters, formatters, generators and calculators) are public pages in English, Vietnamese, Spanish and Portuguese, under the app's **Tools** tab. AnyLearn needs a Google or GitHub sign-in and speaks the same four languages; each learner picks theirs in Settings → Account.

Upload the material you are studying. AnyLearn answers questions about it, and each answer cites the page it came from, so the claim can be checked against the original. It also:
- writes quizzes from the material, and explains the marking;
- schedules what you are about to forget, on a spaced-repetition mastery path (FSRS);
- solves problems step by step and writes cited research reports;
- runs a 90-day learning loop that advances only on evidence the product has already recorded;
- lets you practise your mistakes, sit a mock exam modelled on a past paper, and explain a point back in your own words before it counts as learned;
- adds web pages, YouTube videos and scholarly papers as sources, draws diagrams on request, keeps vocabulary cards and reads text aloud;
- turns a knowledge base into a living book or a two-voice audio overview, and remembers the learner profile you approve;
- carries up's worksheets in a Toolkit: a four-skill English diagnostic, listening, reading, writing, grammar, speaking and vocabulary evidence (with browser recordings and five-pass writing feedback that never rewrites you), project and case reviews, a structured day-90 close, and a private life toolkit;
- asks for your own version before AI help when you want it, reviews due points across every mastery path, and keeps a bad-day minimum on Home;
- adds audio and video files, photos of pages, podcast feeds and YouTube playlists, documentation sites, GitHub repositories, spreadsheets and a Zotero library as sources, transcribed by your own key or the server's built-in Whisper.
- keeps a training log beside the studying (**Body**): a weekly plan, guided workouts with a rest timer, progression worked out from what you logged, body weight, strength and a year of training at a glance, and a coach on your own model that drafts and revises the plan, applied only when you accept it.

The learning features are described for learners in [docs/learning-features.md](docs/learning-features.md).

It is free and bring-your-own-key: AnyTools holds no AI credential of its own.

## What is in it

| Area | Where |
|---|---|
| Knowledge Center: upload, parse, index, hybrid search | `internal/knowledge`, `internal/rag`, `ui/web/app/routes/knowledge.*` |
| Grounded chat, with streamed citations | `internal/runtime`, `internal/capabilities/chat`, `internal/tools` |
| Quiz, question bank, mastery path (FSRS) | `internal/capabilities/{quiz,mastery}`, `internal/learning` |
| Notebook and the immersive reader (pdf.js, tutor pane) | `internal/notebook`, `internal/capabilities/reading` |
| Solve (including photos) and Research (KB plus your own Tavily/Brave key) | `internal/capabilities/{solve,research}` |
| Learning loop: states, cycles, gates, weekly reviews, evidence chains | `internal/learning/loop` |
| Google Drive (`drive.file` and Picker) | `internal/connectors/drive` |
| Practice, exams, explain-back | `internal/store/pg/mistakes.go`, `internal/capabilities/{exam,mastery}` |
| Web pages, YouTube, papers | `internal/knowledge/links.go`, `internal/connectors/youtube`, `internal/rag/papers`, `internal/capabilities/related` |
| Diagrams, vocabulary and read-aloud, skill cards | `internal/capabilities/visualize`, `internal/vocab`, `internal/learning/loop/cards.go` |
| Audio overviews, living books, learner profile | `internal/capabilities/{audio,book}`, `internal/learning/profile` |
| Toolkit worksheets (up's templates), recordings, writing diagnosis | `internal/learning/worksheet`, `internal/api/worksheetapi`, `internal/capabilities/writingdiag` |
| Own version first, cross-path review, bad-day minimum | `internal/learning/ownversion`, `internal/capabilities/mastery`, `internal/learning/loop` |
| Media, photos, feeds, sites, repositories, spreadsheets, Zotero | `internal/connectors/{media,feeds,crawl,github,zotero}`, `internal/rag/parse` |
| Transcription and speech engines (your key, or the built-in Whisper and Kokoro) | `internal/providers/{stt,tts,builtin}`, `internal/media` |
| Body: training plan, workouts, progression, body weight, coach | `internal/body`, `internal/api/bodyapi`, `ui/web/app/routes/body.*` |
| Bring your own keys: connections, routes, readiness | `internal/byok`, `internal/providers` |

The stack is a Go 1.26 API, a React Router 7 server (the BFF) with Tailwind v4, and PostgreSQL 16 with pgvector. The browser only ever talks to the BFF, and the API is not reachable from outside the compose network. See [docs/architecture.md](docs/architecture.md).

## Quick start (local)

Prerequisites: Go (the `toolchain` line in `go.mod` pins the patch release), Node 22 with pnpm 10, and PostgreSQL 16 with pgvector running on localhost.

```sh
git clone https://github.com/D0bby999/anytools.git && cd anytools
deploy/scripts/run-local.sh --init   # once: writes .env.local (fresh secrets) and creates the database
deploy/scripts/run-local.sh          # builds, migrates, runs; open http://localhost:3000
```

This runs the same production builds the server runs. `.env.local` turns on a **development-only local sign-in** ("Continue locally" on `/login`), so you can use the app before any OAuth app exists. It is offered only on a `localhost` URL with `ANYTOOLS_DEV_LOGIN=1`, and the API accepts it only when `ANYTOOLS_ENV=development`, so a server never shows it. Back up `ANYTOOLS_ENCRYPTION_KEY` from `.env.local`: without it, the API keys you save cannot be read.

After signing in, connect an AI key in **Settings → Connections** and route it in **Settings → Routes**; see [docs/byok.md](docs/byok.md). Google and GitHub sign-in work locally too once their client ids are in `.env.local` (`.env.example` lists the redirect URIs to register).

The tools under the **Tools** tab need neither a sign-in nor a key.

## Self-hosting with Docker Compose

The stack is four services: `postgres` (pgvector), a one-shot `migrate`, `api` and `web`. Only `web` publishes a port; the API is reachable from the compose network alone, and a test keeps it that way.

```sh
cp .env.example .env                 # fill in the three secrets and POSTGRES_PASSWORD (openssl rand -hex 32)
docker compose up -d --build         # web on http://127.0.0.1:3000
```

Compose runs in production mode, so there is no local sign-in: register a Google or a GitHub OAuth app first (the redirect URIs are in `.env.example`).

For a public server there are two ready layouts:

- **One VPS with its own TLS:** add `deploy/docker-compose.prod.yml`, which puts nginx and certbot in front of `web`, caps and unprivileges the containers, and offers the optional built-in Whisper and Kokoro engines. Backups, restores and the escrowed key are in [docs/deployment.md](docs/deployment.md).
- **Behind Coolify (or any Traefik):** `deploy/coolify/docker-compose.yml` runs the prebuilt images from GHCR (`ghcr.io/d0bby999/anytools-api` and `ghcr.io/d0bby999/anytools-web`, tagged `latest` and `sha-<commit>`) with Traefik labels and memory caps for a small host. This is how anytools.world runs.

## Configuration

Every setting is an environment variable, documented in [.env.example](.env.example): the database, the three required secrets (`ANYTOOLS_GATEWAY_TOKEN`, `ANYTOOLS_ENCRYPTION_KEY`, `ANYTOOLS_SESSION_SECRET`), the public origin `ANYTOOLS_APP_URL`, the OAuth apps, the optional Google Drive connector, the built-in engines and backups. The API refuses to start without the required ones, and names what is missing.

AnyTools holds no AI credential of its own. Each learner connects their own keys, which are stored encrypted with `ANYTOOLS_ENCRYPTION_KEY`; changing that key after the first boot makes them unreadable.

## Tests

```sh
make test-db                  # once: creates and migrates anytools_test
make test                     # go test -race ./... against a real Postgres
make web-typecheck web-test web-build
```

The DB-backed tests fail rather than skip when CI cannot reach Postgres. CI (`.github/workflows/test.yml`) also runs `govulncheck`, `pnpm audit --prod` and gitleaks, and `images.yml` builds the two images.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, the checks a pull request must pass and the rules the code keeps (every row is owned by a user, every model call uses the learner's own key).

## Security

The product takes uploads from anyone, reads them with language models, and holds other people's API keys, so it was audited as that kind of system before launch; the mechanisms that came out of it are in [docs/architecture.md](docs/architecture.md) ("Hardening"). Please report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes, and not in a public issue.

## Licence and credits

AnyTools is MIT licensed: see [LICENSE](LICENSE). Third-party code and its licences are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which `make notices` regenerates.

The learning-loop method follows the structure of [byoungd/up](https://github.com/byoungd/up). Its wording is not reused (the content is CC BY-NC). The visual theme ports values from up's MIT-licensed theme code. The capabilities follow [DeepTutor](https://github.com/HKUDS/DeepTutor)'s shape.
