import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

/**
 * Route shape: locale-layout wraps everything, then splits into the
 * unauthenticated auth-layout and the authenticated app-layout. Feature phases
 * add children under app-layout and inherit its guard.
 *
 * The /auth/* routes are resource routes on THIS server — they are the OAuth
 * dance. Nothing under them proxies to the Go API; the browser has no route to
 * it at all (docs/architecture.md).
 */
/** AnyTools phase 4: public.page.tsx serves each of these at /{locale}/<page>. */
const STATIC_PAGES = ["about", "privacy", "terms", "contact"] as const;

/** AnyTools phase 4: the old site's sections that did not come over (owner decision 3). */
export const DROPPED_SECTIONS = ["blog", "sign-in", "sign-up", "dashboard", "favorites", "admin", "offline", "newsletter"] as const;

export default [
  layout("routes/locale-layout.tsx", [
    // `/` shows nothing: it sends a visitor to the landing page in their
    // language (/en, /vi, /es, /pt), and a signed-in one to /home.
    index("routes/home-redirect.ts"),
    layout("routes/auth-layout.tsx", [route("login", "routes/login.tsx")]),

    layout("routes/app-layout.tsx", [
      // Every signed-in page sits under one pathless layout whose error
      // boundary answers a failure inside the shell (routes/app-errors.tsx).
      layout("routes/app-errors.tsx", [
        // Phase 12: `/` is the public landing; the signed-in home lives at /home.
        route("home", "routes/home.tsx"),
        // The phone bar's "More": every destination as a plain page (sidebar.tsx).
        route("more", "routes/more.tsx"),
        // Settings is a layout with three sections rather than one long page:
        // "what have I connected", "what serves what" and "what may search the
        // web" are different questions, and stacking them buries the third.
        route("settings", "routes/settings.tsx", [
          index("routes/settings.connections.tsx"),
          route("providers", "routes/settings.providers.tsx"),
          route("providers/:type", "routes/settings.providers.$type.tsx"),
          route("routes", "routes/settings.routes.tsx"),
          route("search", "routes/settings.search.tsx"),
          route("account", "routes/settings.account.tsx"),
          // Learning depth, phase 9: the learner profile (no new rail item).
          route("profile", "routes/settings.profile.tsx"),
          // Moved to /storage (Mine); the old address redirects there.
          route("storage", "routes/settings.storage.tsx"),
          // The daily review reminder (a web push) and installing AnyLearn.
          route("reminders", "routes/settings.reminders.tsx"),
        ]),
        // Phase 6: grounded chat. Nested under app-layout, so it inherits the
        // session guard rather than remembering to ask for one.
        // Mine (2026-10-21): the learner's own files, uploads, study links and
        // storage, across every knowledge base.
        route("files", "routes/files.tsx"),
        route("upload", "routes/upload.tsx"),
        route("links", "routes/links.tsx"),
        route("storage", "routes/storage.tsx"),
        // Learning-tool-connections: every tool AnyLearn connects to.
        route("apps", "routes/apps.tsx"),
        route("apps/classroom", "routes/apps.classroom.tsx"),
        route("chat", "routes/chat.index.tsx"),
        route("chat/:sessionId", "routes/chat.$sessionId.tsx"),
        // Phase 5. `documents/:docId` is the ONE document viewer (red-team
        // RT-15); phase 8 replaces its renderer in place rather than adding a
        // second route, so citations written today keep resolving.
        route("knowledge", "routes/knowledge.index.tsx"),
        route("knowledge/:kbId", "routes/knowledge.$kbId.tsx"),
        // the private design notes, phase 4: Share to AnyLearn (the manifest's share_target).
        route("share", "routes/share.tsx"),
        route("documents/:docId", "routes/documents.$docId.tsx"),
        // Up-methods phase 17: a podcast feed or YouTube playlist to pick from.
        route("feeds/:feedId", "routes/feeds.$feedId.tsx"),
        // Phase 7: the question bank and the mastery path.
        route("quiz", "routes/quiz.index.tsx"),
        route("quiz/bank", "routes/quiz.bank.tsx"),
        route("quiz/practice", "routes/quiz.practice.tsx"),
        // Learning depth, phase 3: past papers and mock exams, under Quiz.
        route("quiz/exams", "routes/quiz.exams.tsx"),
        route("quiz/exams/templates/:templateId", "routes/quiz.exams.templates.$templateId.tsx"),
        route("quiz/exams/:examId", "routes/quiz.exams.$examId.tsx"),
        route("mastery", "routes/mastery.index.tsx"),
        // Learning depth, phase 7: word cards, under Mastery (no new rail item).
        route("mastery/vocabulary", "routes/mastery.vocabulary.tsx"),
        // Learning depth, phase 11: the living books' flash cards.
        route("mastery/book-cards", "routes/mastery.book-cards.tsx"),
        // General decks (the private design notes, phase 5).
        route("mastery/decks", "routes/mastery.decks.tsx"),
        // up-methods phase 12: one review across every path, interleaved.
        route("mastery/review", "routes/mastery.review.tsx"),
        route("mastery/:pathId", "routes/mastery.$pathId.tsx"),
        route("mastery/:pathId/session", "routes/mastery.$pathId.session.tsx"),
        // Phase 8: the notebook.
        route("notebooks", "routes/notebooks.index.tsx"),
        route("notebooks/:notebookId", "routes/notebooks.$notebookId.tsx"),
        // Phase 9: worked solutions and cited research. Both run as turns on
        // chat sessions, so their streams go through the same proxy route.
        route("solve", "routes/solve.tsx"),
        route("research", "routes/research.tsx"),
        route("research/:reportId", "routes/research.$reportId.tsx"),
        // Phase 10: the learning loop. `evidence/:id` is an evidence chain.
        route("loop", "routes/loop.index.tsx"),
        route("loop/state/:id", "routes/loop.state.$id.tsx"),
        route("loop/cycle/:id", "routes/loop.cycle.$id.tsx"),
        route("loop/review/:id", "routes/loop.review.$id.tsx"),
        route("loop/evidence/:id", "routes/loop.evidence.$id.tsx"),
        route("loop/brief/:id", "routes/loop.brief.$id.tsx"),
        // Learning depth, phase 8: a skill evidence card on a goal's chain.
        route("loop/cards/:id", "routes/loop.cards.$id.tsx"),
        // Learning depth, phase 11: a living book, made from the knowledge base
        // page (no rail item), and one chapter of it.
        route("books/:bookId", "routes/books.$bookId.tsx"),
        route("books/:bookId/chapters/:chapterId", "routes/books.$bookId.chapters.$chapterId.tsx"),
        // up methods, phase 0: up's worksheets (no rail item; /more lists it).
        route("toolkit", "routes/toolkit.index.tsx"),
        route("toolkit/new", "routes/toolkit.new.tsx"),
        route("toolkit/:id", "routes/toolkit.$id.tsx"),
        // Languages: each studied language's practice, gathered by skill
        // (the private design notes, phase 1). The old
        // English page answers with English's tab.
        route("languages", "routes/languages.tsx"),
        route("languages/:lang", "routes/languages.$lang.tsx"),
        route("english", "routes/english.tsx"),
        // Body: the training log beside the studying (the private design notes).
        // One rail row; its sections are tabs (components/body/body-tabs.tsx).
        route("body", "routes/body.tsx"),
        route("body/plan", "routes/body.plan.tsx"),
        route("body/routines/:id", "routes/body.routines.$id.tsx"),
        route("body/workouts/:id", "routes/body.workouts.$id.tsx"),
        route("body/progress", "routes/body.progress.tsx"),
        route("body/coach", "routes/body.coach.tsx"),
        route("body/library", "routes/body.library.tsx"),
        route("library", "routes/library.tsx"),
        // Progress and studying with friends (the private design notes).
        // How to study, from the research, with videos (the private design notes).
        route("methods", "routes/methods.tsx"),
        route("methods/:slug", "routes/methods.$slug.tsx"),
        route("progress", "routes/progress.tsx"),
        route("circles", "routes/circles.tsx"),
        route("circles/:id", "routes/circles.$id.tsx"),
      ]),
    ]),

    // Body: the exercise picker's search. Loader only; its loader calls requireUserId.
    route("body/exercises", "routes/body.exercises.ts"),

    // Phase 8 resource routes (loader only), NOT under app-layout: a file and
    // a download must not render a shell. Each loader calls requireUser.
    route("documents/:docId/file", "routes/documents.$docId.file.ts"),
    route("notebooks/:notebookId/export.md", "routes/notebooks.$notebookId.export.ts"),
    route("documents/:docId/study-notes.md", "routes/documents.$docId.study-notes.ts"),
    // up methods, phase 0: a worksheet as Markdown. Its loader calls requireUser.
    route("toolkit/:id/export.md", "routes/toolkit.$id.export.ts"),
    // up methods, phase 7: keep a take (action), and play or delete one.
    // Each handler calls requireUser.
    route("toolkit/:id/recordings", "routes/toolkit.$id.recordings.ts"),
    route("toolkit/:id/recordings/:rid", "routes/toolkit.$id.recordings.$rid.ts"),
    // up methods, phase 15: an uploaded recording played from 'self', and an
    // upload streamed to the API rather than buffered here. Each handler
    // calls requireUser.
    route("documents/:docId/media", "routes/documents.$docId.media.ts"),
    // the private design notes, phase 2: the read-aloud check.
    route("documents/:docId/speaking-check", "routes/documents.$docId.speaking-check.ts"),
    // phase 3: an Anki deck's words in (POST) and out (GET).
    route("mastery/vocabulary/anki", "routes/mastery.vocabulary.anki.ts"),
    route("mastery/vocabulary/sources", "routes/mastery.vocabulary.sources.ts"),
    route("mastery/decks/import", "routes/mastery.decks.import.ts"),
    route("knowledge/:kbId/upload", "routes/knowledge.$kbId.upload.ts"),
    // up methods, phase 16: a photo document's page photo. Its loader calls requireUser.
    route("documents/:docId/photo", "routes/documents.$docId.photo.ts"),

    // Phase 7: answering a question is one resource route (action only) that
    // every page showing a QuestionCard posts to. Its action calls requireUser.
    route("quiz/questions/:questionId", "routes/quiz.questions.$questionId.ts"),
    // Learning depth, phase 2: the session's learn and explain-back cards
    // post here. Action only; its action calls requireUser.
    route("mastery/points/:pointId", "routes/mastery.points.$pointId.ts"),
    // Learning depth, phase 3: an exam paper's bytes, for pdf.js on the review
    // screen. Loader only; its loader calls requireUser.
    route("quiz/exams/templates/:templateId/paper", "routes/quiz.exams.templates.$templateId.paper.ts"),

    // Phase 6: the browser's only door to a server-sent event stream. A
    // resource route (loader only), NOT under app-layout — a stream must not
    // render a shell around itself. Its own loader calls requireUserId.
    route("app/api/stream/:topic/:id", "routes/app.api.stream.$topic.$id.ts"),

    // Phase 13: the Picker's access token, fetched on the click that opens it.
    // POST-only resource route; its action calls requireUserId.
    route("app/api/drive/picker-token", "routes/app.api.drive.picker-token.ts"),

    // Learning depth, phase 0: the browser reports its time zone once.
    // POST-only resource route; its action calls requireUserId.
    route("app/api/timezone", "routes/app.api.timezone.ts"),
    route("app/api/search-index", "routes/app.api.search-index.ts"),
    route("app/api/byok-models", "routes/app.api.byok-models.ts"),

    // Learning depth, phase 5: "Draw it" and its one repair. POST-only
    // resource route; its action calls requireUserId.
    route("app/api/diagram", "routes/app.api.diagram.ts"),

    // Learning depth, phase 10: audio overviews. The WAV comes from 'self'
    // with range support (loader only, requireUserId); start, cancel and
    // delete are one POST-only resource route (requireUserId).
    route("audio-overviews/:id.wav", "routes/audio-overviews.$id.wav.ts"),
    route("app/api/audio", "routes/app.api.audio.ts"),

    // Learning depth, phase 6: related papers — listed on request (loader)
    // and added by OpenAlex id (action); both call requireUserId.
    route("app/api/related", "routes/app.api.related.ts"),
    // Up-methods phase 18: documentation sites and GitHub repositories — a
    // site's pages (loader) and every add, re-sync, cancel and delete (action).
    route("app/api/sources", "routes/app.api.sources.ts"),
    // Up-methods phase 20: "Add from Zotero" — a search or a collection of
    // the learner's library (loader) and adding one item (action); both call
    // requireUserId.
    route("app/api/zotero", "routes/app.api.zotero.ts"),

    // Learning depth, phase 11: "Make a book" (POST-only, requireUserId) and
    // a book's Markdown export (loader only, requireUser).
    route("app/api/books", "routes/app.api.books.ts"),
    route("books/:bookId/export.md", "routes/books.$bookId.export.ts"),

    // up-methods phase 11: "Close it and retell" under a chat or Solve answer.
    // POST-only resource route; its action calls requireUserId.
    route("app/api/retell", "routes/app.api.retell.ts"),

    // Plan 261021-1100 phase 1: Like / Dislike under a chat answer.
    // POST-only resource route; its action calls requireUserId.
    route("app/api/chat-feedback", "routes/app.api.chat-feedback.ts"),

    // Plan 261021-1100 phase 2: a question spoken into the chat composer,
    // where the browser has no speech recognition. POST-only resource route;
    // its action calls requireUserId.
    route("app/api/dictate", "routes/app.api.dictate.ts"),

    // up-methods, phase 13: the Home "Low day" switch. POST-only resource
    // route; its action calls requireUser and only sets a cookie.
    route("app/api/low-day", "routes/app.api.low-day.ts"),

    // drive-user-storage phase 2: "Save to my Drive" beside each Markdown
    // export. POST-only resource route; its action calls requireUserId.
    route("app/api/save-to-drive", "routes/app.api.save-to-drive.ts"),

    // OAuth: start
    route("auth/google", "routes/auth.google.tsx"),
    route("auth/github", "routes/auth.github.tsx"),
    // OAuth: provider redirects back here
    route("auth/callback/:provider", "routes/auth.callback.$provider.tsx"),
    route("auth/logout", "routes/auth.logout.tsx"),
    // Development-only local sign-in; 404 unless enabled (env.server.ts).
    route("auth/local", "routes/auth.local.ts"),
    // Phase 13: connecting Google Drive. Its own callback, NOT
    // auth/callback/:provider — that route mints sessions, and a Drive grant
    // must never reach the code that does.
    route("auth/drive", "routes/auth.drive.tsx"),
    route("auth/drive/callback", "routes/auth.drive.callback.tsx"),
    // Learning-tool-connections phases 8 and 9: Canva and Notion. Their own
    // callback, never the sign-in one.
    route("auth/app/:provider", "routes/auth.app.$provider.tsx"),
    route("auth/app/:provider/callback", "routes/auth.app.$provider.callback.tsx"),
  ]),

  // Learning-tool-connections phase 2: the study calendar feed. Outside every
  // layout: a calendar app has no session, and the token is the credential.
  route("cal/:file", "routes/cal.$file.ts"),
  // Learning-tool-connections phase 4: mail from the Cloudflare Email Worker.
  route("inbound/email", "routes/inbound.email.ts"),

  // Phase 12: crawler files, generated so they name the configured origin.
  route("robots.txt", "routes/robots[.]txt.ts"),
  route("sitemap.xml", "routes/sitemap[.]xml.ts"),
  route("llms.txt", "routes/llms[.]txt.ts"),

  // AnyTools phase 2: the app's Tools tab, which picks the visitor's locale
  // and goes to /{locale}/tools.
  route("tools", "routes/tools.ts"),
  // AnyTools phase 2: the public tool pages, in en, vi, es and pt, with no
  // sign-in. Outside locale-layout and app-layout (public.layout.tsx says
  // why). Every static first segment above outranks `:locale`, so no app
  // route can be shadowed by it; anything else is a 404 from its loader.
  route(":locale", "routes/public.layout.tsx", [
    // The site's home in each language is the landing page; the tools home
    // is /{locale}/tools (2026-10-19, one path per language for search).
    index("routes/landing.tsx"),
    route("tools", "routes/public.home.tsx"),
    // AnyTools phase 4: the guides, the AnyProfile download page, and the
    // about, privacy, terms and contact pages, at the old site's URLs. Static
    // segments, so they outrank `:cluster`.
    route("guides", "routes/public.guides.tsx"),
    route("guides/:slug", "routes/public.guide.tsx"),
    route("anyprofile", "routes/public.anyprofile.tsx"),
    // AnyLearn, the study app, beside AnyProfile: what it does and how to install it.
    route("anylearn", "routes/public.anylearn.tsx"),
    ...STATIC_PAGES.map((page) => route(page, "routes/public.page.tsx", { id: `routes/public.page.${page}` })),
    route(":cluster", "routes/public.cluster.tsx"),
    route(":cluster/:tool", "routes/public.tool.tsx"),
  ]),
  // AnyTools phase 4: the old site's dropped sections answer 301 to the
  // locale's tools home. `<section>/*` also matches the bare section, and a
  // splat under a static segment outranks `:cluster/:tool`.
  ...DROPPED_SECTIONS.map((section) =>
    route(`:locale/${section}/*`, "routes/public.dropped.ts", { id: `routes/public.dropped.${section}` }),
  ),
  // A tool page's Open Graph card. Loader only, no sign-in.
  route(":locale/:cluster/:tool/og.png", "routes/public.tool-og.ts"),
  // Wasm, models and fonts a tool fetches by URL, cached for a year. The
  // package is its own segment so that a three-segment URL
  // (/tool-runtime/<pkg>/<file>) outranks `:locale/:cluster/:tool` (phase 3a;
  // tools-server-routes.test.ts matches it against this file).
  route("tool-runtime/:pkg/*", "routes/tool-runtime.$.ts"),
  // A character's strokes for the writing card (lib/strokes.server.ts); a
  // static first segment, so it outranks `:locale/:cluster/:tool` too.
  route("strokes/:lang/:char", "routes/strokes.ts"),
  // AnyTools phase 3a: the two tools that call this server, at the old site's
  // URLs. Public, no sign-in; each address has a budget (public-budget.server.ts).
  route("api/curl-convert", "routes/api.curl-convert.ts"), // budget: curl-convert
  route("api/fx", "routes/api.fx.ts"), // budget: fx

] satisfies RouteConfig;
