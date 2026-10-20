// Package app wires AnyTools' subsystems together.
//
// One explicit builder per subsystem, each returning its own error. postclaw's
// equivalent was a single 5036-line runGateway() in which the boot ORDER was
// the only documentation of what depended on what (scout §1); this file keeps
// the order but makes each step nameable and separately testable.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/authapi"
	"github.com/D0bby999/anytools/internal/api/byokapi"
	"github.com/D0bby999/anytools/internal/api/chatapi"
	"github.com/D0bby999/anytools/internal/api/feedapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/kbapi"
	"github.com/D0bby999/anytools/internal/api/pushapi"
	"github.com/D0bby999/anytools/internal/api/sourceapi"
	"github.com/D0bby999/anytools/internal/api/videonotesapi"
	"github.com/D0bby999/anytools/internal/api/visualizeapi"
	"github.com/D0bby999/anytools/internal/auth"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/capabilities/chat"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/capabilities/research"
	"github.com/D0bby999/anytools/internal/capabilities/solve"
	"github.com/D0bby999/anytools/internal/capabilities/videonotes"
	"github.com/D0bby999/anytools/internal/capabilities/visualize"
	"github.com/D0bby999/anytools/internal/capabilities/zoterolib"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/notebook"
	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/kbindex"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/tools"
)

// App is a fully wired AnyTools API, ready to serve.
type App struct {
	Config  *config.Config
	Handler http.Handler

	pool        *pg.Pool
	rateLimiter *httpx.RateLimiter
	routeLimits *httpx.RouteLimiter

	// stopRuntime ends the recovery sweeper's goroutine on Close.
	stopRuntime context.CancelFunc
	// bgCancel/bgDone stop and drain the job workers and the lease reaper.
	bgCancel context.CancelFunc
	bgDone   sync.WaitGroup
}

// Build connects to Postgres, verifies the encryption key against the database
// sentinel, and assembles the HTTP handler.
//
// Boot order matters and is deliberate:
//  1. connect — a bad DSN must fail here, not on the first request
//  2. verify the encryption key — see pg.ErrEncryptionKeyMismatch; starting
//     under the wrong key writes a second, unreadable generation of secrets
//  3. build stores, services, handlers
//  4. start background work, last, once everything it touches exists
func Build(ctx context.Context, cfg *config.Config) (*App, error) {
	pool, err := pg.Open(ctx, cfg.Database.DSN)
	if err != nil {
		return nil, err
	}

	sentinel := pg.NewSentinelStore(pool, cfg.Security.EncryptionKey)
	if err := sentinel.Verify(ctx); err != nil {
		pool.Close()
		if errors.Is(err, pg.ErrEncryptionKeyMismatch) {
			return nil, fmt.Errorf("%w — refusing to start; check ANYTOOLS_ENCRYPTION_KEY", err)
		}
		return nil, fmt.Errorf("encryption key smoke test: %w", err)
	}
	slog.Info("boot: encryption key verified against database sentinel")

	users := pg.NewUserStore(pool)
	identities := auth.NewService(users).WithLocalSignIn(config.IsDevelopmentEnv())
	rateLimiter := httpx.NewRateLimiter(cfg.Server.RateLimitRPM, cfg.Server.RateLimitBurst)
	// ANYTOOLS_RATE_LIMIT_RPM=0 turns rate limiting off, the route budgets
	// included (tests and local benchmarking).
	var routeLimits *httpx.RouteLimiter
	if cfg.Server.RateLimitRPM > 0 {
		routeLimits = httpx.NewRouteLimiter(httpx.RouteClasses)
	}

	byokService, err := buildBYOK(pool, cfg.Security.EncryptionKey)
	if err != nil {
		pool.Close()
		return nil, err
	}

	// Knowledge is built BEFORE chat and handed to it: the grounded-chat tools
	// read documents through this exact service, authorizer and retriever, so
	// that "what the model may search" and "what the Knowledge Center shows" can
	// never be two different answers.
	// Phase 13. Nil when no Google OAuth client is configured, which is a
	// normal state: the Drive routes and Drive storage are then simply
	// absent. Built before the Knowledge Center, whose file store can keep a
	// learner's files in their Drive (drive-user-storage phase 1).
	dc := newDriveConnector(cfg, pool)
	kb, err := buildKnowledge(cfg, pool, byokService, dc)
	if err != nil {
		pool.Close()
		return nil, err
	}
	driveHandler, driveConnector := buildDrive(dc, kb.service, kb.authz)
	// drive-user-storage phase 2: Settings → Storage, and "Save to my Drive"
	// on every Markdown export. See wire_storage.go.
	storageHandler := buildStorage(pool, kb, dc, users)
	driveExports := storageHandler.Exports()
	if driveConnector != nil {
		// A Drive grant Google has stopped honouring fails the same test the
		// readiness matrix applies to every AI route, so it reports there too.
		byokService.UseConnectors(driveReadiness{svc: driveConnector})
	}

	// Phase 8. The notebook is built BEFORE the turn engine because the
	// `write_note` tool and the research capability take it, and the reading
	// surface AFTER it because the selection actions take the orchestrator.
	// See wire_notebook.go.
	notes := newNotebook(pool)
	// Phase 10. Built before the turn engine; see wire_loop.go.
	loopSvc, loopHandler, startLoop := buildLoop(pool, nil)
	web := webDeps{}.withDefaults(byokService, pool)
	rt := buildChatRuntime(pool, byokService, kb, web, notes, loopStates{loopSvc})
	// Learning depth, phase 5: "Draw it" appends diagrams to the same
	// conversations the chat runtime owns.
	diagrams := visualize.NewService(rt.chatStore, newChatResolver(byokService))
	// Learning depth, phase 10: audio overviews. See wire_audio.go.
	audioHandler := buildAudio(pool, kb, byokService)
	// Learning depth, phase 6: related papers. See wire_papers.go.
	relatedHandler := buildRelated(pool, kb, byokService, web.papers, web)
	videoNotesHandler := videonotesapi.NewHandler(videonotes.NewService(
		pg.NewVideoNotesStore(pool), kb.service, newChatResolver(byokService))).WithDriveExport(driveExports)
	// Learning depth, phase 3: past papers and mock exams. See wire_exam.go.
	examHandler := buildExams(pool, kb, newChatResolver(byokService))
	// Learning depth, phase 7: the page-text loader is shared by the reading
	// surface's "Find words to save" and the vocabulary. See wire_vocab.go.
	pages := newPageLoader(pool, kb)
	notebookHandler, readingHandler := buildReadingSurface(pool, readingDeps{
		Notes:     notes,
		Chat:      rt.chatStore,
		Orch:      rt.orch,
		Knowledge: kb.service,
		Blobs:     kb.blobs,
		Authz:     kb.authz,
		Diagrams:  diagrams,
		Pages:     pages,
		Providers: newChatResolver(byokService),
	})

	// The daily review reminder: a web push at the learner's hour. See
	// wire_push.go.
	reminders := buildPush(pool, cfg).WithCounter(newDueTotal(pool, loopSvc)).WithPlanner(newTrainingPlanner(pool))

	// Phase 7. See wire_quiz.go.
	quizHandler, masteryHandler, startLearning := buildQuizMastery(pool, kb, newChatResolver(byokService), nil, reminders)

	// Phase 9. See wire_research.go.
	solveHandler, researchHandler := buildSolveResearch(pool, rt, kb, web)

	// Learning depth, phase 9: the learner profile. See wire_profile.go.
	profileHandler, startProfile := buildProfile(pool, newChatResolver(byokService))

	handler := api.BuildMux(api.Deps{
		Auth: authapi.NewHandler(identities, users).
			WithAccountDeletion(buildAccount(pool, kb, driveConnector, cfg.Security.EncryptionKey)).
			WithSessionRevocation(users).
			WithTimezones(users).
			WithLanguages(users).
			WithOwnVersionFirst(users),
		BYOK:         byokapi.NewHandler(byokService),
		Knowledge:    kb.handler,
		Chat:         rt.handler,
		Quiz:         quizHandler,
		Mastery:      masteryHandler,
		Notebook:     notebookHandler.WithDriveExport(driveExports),
		Reading:      readingHandler,
		Drive:        driveHandler,
		Solve:        solveHandler,
		Research:     researchHandler,
		Visualize:    visualizeapi.NewHandler(diagrams),
		Audio:        audioHandler,
		Related:      relatedHandler,
		VideoNotes:   videoNotesHandler,
		Exams:        examHandler,
		Loop:         loopHandler,
		Vocab:        buildVocab(pool, pages),
		Speak:        buildSpeak(pool, pages, byokService, cfg.Engines),
		Profile:      profileHandler,
		Books:        buildBooks(pool, kb, byokService).WithDriveExport(driveExports),
		Worksheets:   buildWorksheets(pool, kb).WithDiagnoser(buildWritingDiagnosis(pool, newChatResolver(byokService))).WithDriveExport(driveExports), // up methods, phases 0, 4 and 7; see wire_worksheet.go
		Sources:      sourceapi.NewHandler(kb.service, kb.authz),
		Zotero:       buildZotero(pool, kb, byokService, web.zotero), // up methods, phase 20; see wire_zotero.go
		Feeds:        feedapi.NewHandler(kb.service, kb.authz),
		Storage:      storageHandler,
		Push:         pushapi.NewHandler(reminders),
		Body:         buildBody(pool, byokService),
		Users:        users,
		GatewayToken: cfg.Security.GatewayToken,
		AllowNoAuth:  cfg.Security.AllowNoAuth,
		RateLimiter:  rateLimiter,
		RouteLimiter: routeLimits,
	})

	if oauth.ExperimentalLanesEnabled() {
		slog.Warn("boot: " + oauth.ExperimentalLanesEnv + "=1 — the ChatGPT relay and Gemini Code Assist lanes are ENABLED. " +
			"Neither is licensed for proxying, the Gemini lane asks for cloud-platform scope, and accounts using them may be restricted")
	}

	if cfg.Security.AllowNoAuth {
		slog.Warn("boot: ANYTOOLS_ALLOW_NO_AUTH=1 — the gateway bearer check is DISABLED; never use this outside local development")
	}

	app := &App{
		Config: cfg, Handler: handler, pool: pool,
		rateLimiter: rateLimiter, routeLimits: routeLimits, stopRuntime: rt.stop,
	}

	// Background work starts LAST. The reaper's first sweep runs immediately
	// (jobs.Reaper.Run) because after a restart every lease the dead process
	// held is expired by definition, and the documents behind those leases are
	// sitting in `parsing` with nothing working on them.
	bgCtx, cancel := context.WithCancel(context.Background())
	app.bgCancel = cancel
	// The vector indexes account deletions left before they swept their own
	// (internal/store/kbindex). Best effort, and once: after this, every
	// deletion cleans up after itself.
	if err := kbindex.DropOrphans(bgCtx, pool); err != nil {
		slog.Warn("boot: orphaned vector indexes were not dropped", "error", err)
	}
	kb.start(bgCtx, &app.bgDone)
	startLearning(bgCtx, &app.bgDone)
	if driveConnector != nil {
		startDriveSync(bgCtx, &app.bgDone, driveConnector)
	}
	startLoop(bgCtx, &app.bgDone)
	startProfile(bgCtx, &app.bgDone)

	return app, nil
}

// chatRuntime is the turn engine as the rest of the wiring sees it: chat's
// HTTP handler (which also starts solve and research turns), the transcript
// store, and the func that stops the recovery sweeper.
type chatRuntime struct {
	handler   *chatapi.Handler
	chatStore *pg.ChatStore
	// orch is shared with phase 8's reading surface, which starts turns on it.
	orch *runtime.Orchestrator
	// notes is the notebook as a NoteWriter, nil when there is none.
	notes tools.NoteWriter
	stop  context.CancelFunc
}

// buildChatRuntime assembles phase 6: the turn engine, the chat capability, the
// tool registry, the recovery sweeper and the HTTP handler — and registers
// phase 9's solve and research capabilities on the same engine.
//
// Everything it needs now exists. The four collaborators this function used to
// refuse rather than fake are supplied here:
//
//   - the provider resolver is byok.Service.ChatFor, through the chat chain
//     adapter, so a turn uses the user's own account and records which
//     connection answered;
//   - rag_search, read_source and kb_files are mounted on internal/rag/retrieve
//     and internal/knowledge, so the model can reach documents the user chose
//     for this conversation — and only those;
//   - the knowledge-base authorizer is internal/authz, so chatapi no longer
//     refuses every session that names a KB.
//
// The authorizer is passed to BOTH the tools and chatapi on purpose. chatapi
// checks at write time, so a foreign id is never stored; the tools check at
// call time, so a KB deleted after the session was created stops being
// readable. Either alone leaves a hole (internal/tools/ports.go).
//
// The web tools are registered in a SEPARATE registry that only the research
// capability mounts (runtime.OrchestratorDeps.CapabilityTools). A chat or solve
// turn has no network tool at all, whatever the session's allow-web toggle
// says; a research turn has them behind the retrieved-context gate.
//
// `notes` is phase 8's notebook and may be nil, in which case `write_note`,
// research and solve say plainly that saving is unavailable.
//
// `states` is phase 10's learning-loop reader: a chat linked to a learning
// state is shown that state on every turn. nil disables it.
func buildChatRuntime(
	pool *pg.Pool, byokService *byok.Service, kb knowledgeSubsystem, web webDeps, notes *notebook.Service,
	states chat.LearningStates,
) chatRuntime {
	chatStore := pg.NewChatStore(pool)
	turnStore := pg.NewTurnStore(pool)

	// Assigned through the interface so a nil *notebook.Service stays a nil
	// NoteWriter: a typed nil would pass the tool's own nil check and panic on
	// the first call.
	var noteWriter tools.NoteWriter
	if notes != nil {
		noteWriter = notes
	}

	owner := ownership{authz: kb.authz}
	ragSearch := tools.NewRAGSearch(kbRetriever{
		retriever: kb.retriever, kbs: kb.service, providers: kb.providers,
	}, owner)
	toolRegistry := runtime.NewToolRegistry()
	toolRegistry.Register(
		ragSearch,
		tools.NewReadSource(kbSourceReader{kbs: kb.service}, owner),
		tools.NewKBFiles(kbFileLister{kbs: kb.service}, owner),
		tools.NewAskUser(),
		tools.NewWriteNote(noteWriter),
	)

	researchTools := runtime.NewToolRegistry()
	researchTools.Register(
		ragSearch,
		tools.NewWebSearch(web.searcher),
		tools.NewWebFetch(web.fetchClient),
		tools.NewPaperSearch(web.papers),
		// Up methods, phase 20: the learner's own Zotero library.
		tools.NewZoteroSearch(zoterolib.Searcher{Creds: byokService, Lib: web.zotero}),
	)

	capabilities := runtime.NewCapabilityRegistry()
	capabilities.Register(
		chatCapability(chatStore, states, newLearnerProfile(pool)),
		// Phase 8. Registered here because the registry is built here; a
		// capability added after the orchestrator has it would be invisible to
		// turns already queued.
		reading.New(chatStore),
		solve.New(chatStore),
		research.New(research.Config{
			Reports:  pg.NewResearchStore(pool),
			Messages: chatStore,
			Search:   web.searcher,
			Notes:    noteWriter,
		}),
	)

	buses := runtime.NewBusRegistry()
	orch := runtime.NewOrchestrator(runtime.OrchestratorDeps{
		Turns:           turnStore,
		Events:          turnStore,
		Capabilities:    capabilities,
		Tools:           toolRegistry,
		CapabilityTools: map[string]*runtime.ToolRegistry{"research": researchTools},
		Providers:       newChatResolver(byokService),
		Buses:           buses,
	})

	// The sweeper runs on a context of its own so Close can stop it; tying it
	// to a request context would end it on the first cancelled request.
	sweepCtx, stop := context.WithCancel(context.Background())
	runtime.NewRecovery(turnStore, turnStore, buses).Start(sweepCtx)

	return chatRuntime{
		// up-methods phase 11: chat, and solve through it, enforce "write your
		// own version first".
		handler: chatapi.NewHandler(chatStore, turnStore, orch, owner).
			WithOwnVersion(pg.NewUserStore(pool)).
			WithChatConnections(chatStore),
		chatStore: chatStore,
		orch:      orch,
		notes:     noteWriter,
		stop:      stop,
	}
}

// chatCapability builds the chat capability, with phase 10's learning-state
// injection when states is non-nil (callers pass an untyped nil to disable
// it), and learning-depth phase 9's preferences note.
func chatCapability(store *pg.ChatStore, states chat.LearningStates, profile chat.LearnerProfile) *chat.Capability {
	c := chat.New(store).WithProfile(profile)
	if states != nil {
		c.WithLearningStates(states)
	}
	return c
}

// buildBYOK assembles the BYOK subsystem: four stores, the advisory lock, the
// OAuth token service and the service the API handlers call.
//
// The one line here that is a decision rather than plumbing is the locker. It is
// passed as a required argument and oauth.NewService refuses a nil one, because
// postclaw's equivalent is an optional package global whose absence silently
// disables the exclusive section: measured, five concurrent refreshes on one
// connection then produce one accepted token and four invalid_grant rejections,
// each of which marks the connection as needing reconnect. The configuration
// that does that is not reachable from here.
func buildBYOK(pool *pg.Pool, encKey string) (*byok.Service, error) {
	conns := pg.NewProviderConnectionStore(pool, encKey)
	routes := pg.NewFunctionRouteStore(pool, encKey)
	searchKeys := pg.NewSearchConnectionStore(pool, encKey)
	creds := pg.NewOAuthCredentialStore(pool, encKey)
	locker := pg.NewConnectionLockStore(pool)

	tokens, err := oauth.NewService(creds, conns, locker, nil, oauth.StoreNotifier{Conns: conns})
	if err != nil {
		return nil, fmt.Errorf("wire byok oauth: %w", err)
	}
	return byok.NewService(conns, routes, searchKeys, tokens), nil
}

// knowledgeSubsystem is what the Knowledge Center exposes to the rest of the
// wiring: its HTTP handler, plus the four collaborators grounded chat needs.
//
// It is a struct rather than six return values because phase 6's tools, phase
// 7's quiz and phase 9's research all read documents through the SAME service
// and the SAME authorizer, and a second construction of either would be a
// second answer to "does this user own this".
type knowledgeSubsystem struct {
	handler   *kbapi.Handler
	service   *knowledge.Service
	authz     *authz.Authorizer
	retriever *retrieve.Retriever
	providers knowledge.Providers
	// blobs holds the original uploaded bytes; phase 8's viewer serves them.
	blobs blob.Store
	// objects are per-row files (learning depth: audio overviews).
	objects blob.ObjectStore
	// driveFiles is the Drive backend, nil when Drive is not configured.
	// Phase 2's storage setting routes learners to it.
	driveFiles *blob.Drive
	// queue is the job queue; jobHandlers are the kinds other subsystems add
	// before start runs (learning depth: audio_overview).
	queue       *jobs.Queue
	jobHandlers map[string]jobs.Handler
	// soloHandlers are kinds that run one at a time, each on a worker of its
	// own (up-methods phase 22: audio_overview_builtin). engines are the
	// server's own engines' settings.
	soloHandlers map[string]jobs.Handler
	engines      config.EnginesConfig
	// start launches the job workers and the lease reaper.
	start func(context.Context, *sync.WaitGroup)
}

// buildKnowledge assembles the Knowledge Center.
//
// The start is separated from the construction so that a failure to build never
// leaves goroutines running against a half-wired system.
func buildKnowledge(cfg *config.Config, pool *pg.Pool, byokService *byok.Service, dc *driveConnector) (knowledgeSubsystem, error) {
	local, err := blob.NewLocal(cfg.Storage.DataDir)
	if err != nil {
		return knowledgeSubsystem{}, err
	}
	slog.Info("boot: knowledge storage ready", "data_dir", local.Root())
	// Every learner's files go through the router (drive-user-storage
	// phase 0). The Drive backend exists when Drive is configured (phase 1).
	// The router writes where the learner chose in Settings → Storage, the
	// server until they turn Drive on (phase 2, owner decision 2), and reads
	// each file from where drive_files says it is. Account deletion reaches
	// the Drive backend too, for its cache.
	driveFiles, err := buildDriveStorage(cfg, pool, local, dc)
	if err != nil {
		return knowledgeSubsystem{}, err
	}
	var others []blob.Backend
	if driveFiles != nil {
		others = append(others, driveFiles)
	}
	blobs := blob.NewRouter(local, blob.StorageChoice(local, driveFiles, fileStorageOf(pg.NewUserStore(pool))), others...)

	kbStore := pg.NewKnowledgeStore(pool)
	chunkStore := pg.NewChunkStore(pool)
	queue := jobs.NewQueue(pool, time.Duration(cfg.Jobs.LeaseSeconds)*time.Second)
	// The other half of the job-to-document coupling. The reaper handles a
	// lease that expired; this handles a job that gave up while still holding
	// one — out of attempts, an unreadable payload, a kind nobody registered.
	// Both must stop the document waiting for a job that is never coming back.
	queue.OnGaveUp(reapHandler())
	authorizer := authz.New(kbStore)

	// The MERGE SEAM that used to be `unconfiguredProviders{}`. Parse and embed
	// now resolve per job through the user's own routes; a user who has
	// connected nothing still gets the same honest outcome, because the chain
	// is genuinely empty rather than stubbed empty.
	providers := newProviders(byokService)

	svc := knowledge.NewService(knowledge.Config{
		Store:     kbStore,
		Chunks:    chunkStore,
		Blobs:     blobs,
		Jobs:      queue,
		Providers: providers,
		Events:    knowledge.NewEvents(),
		// Web pages and YouTube videos (learning-depth phase 4).
		Links: linkConfig(kbStore, blobs, byokService, linkDeps{pool: pool, queue: queue, engines: cfg.Engines}),
		// Documentation sites and GitHub repositories (up-methods phase 18).
		Sources: sourceConfig(pool, byokService, queue, sourceDeps{}),
		// Podcast feeds and YouTube playlists and channels (up-methods phase 17).
		Feeds: feedConfig(pool, byokService, feedDeps{}),
	})

	extraHandlers := map[string]jobs.Handler{}
	soloHandlers := map[string]jobs.Handler{}
	// Up-methods phase 18: crawl_site and sync_repo. See wire_sources.go.
	addSourceJobs(extraHandlers, svc, queue)
	// Up-methods phase 17: add_feed_entries. See wire_feeds.go.
	addFeedJobs(extraHandlers, svc, queue)
	retriever := retrieve.New(pool)
	handler := kbapi.NewHandler(svc, authorizer, retriever, providers)

	start := func(ctx context.Context, wg *sync.WaitGroup) {
		reaper := jobs.NewReaper(pool, reapHandler(), time.Minute)
		wg.Add(1)
		go func() {
			defer wg.Done()
			reaper.Run(ctx)
		}()

		for i := 0; i < cfg.Jobs.Workers; i++ {
			// A worker id unique per process AND per restart: a lease taken by
			// "worker-0" of a dead process must not be extendable by
			// "worker-0" of the new one.
			worker := jobs.NewWorker(queue, fmt.Sprintf("worker-%d-%s", i, uuid.NewString()[:8]), time.Second)
			worker.Handle(jobs.KindParseDocument, parseDocumentHandler(svc))
			worker.Handle(jobs.KindReindexKB, reindexHandler(svc))
			for kind, h := range extraHandlers {
				worker.Handle(kind, h)
			}
			worker.Handle(jobs.KindTranscribeVideo, transcribeVideoHandler(svc, queue))
			wg.Add(1)
			go func() {
				defer wg.Done()
				worker.Run(ctx)
			}()
		}
		// Up-methods phase 21: the built-in Whisper runs one job at a time on
		// the server, so its kind has one worker of its own and no other.
		builtinWorker := jobs.NewWorker(queue, "builtin-stt-"+uuid.NewString()[:8], time.Second)
		builtinWorker.Handle(jobs.KindTranscribeBuiltin, transcribeBuiltinHandler(svc, queue))
		wg.Add(1)
		go func() {
			defer wg.Done()
			builtinWorker.Run(ctx)
		}()
		// Up-methods phase 22: the same rule for the built-in voices, one
		// worker per solo kind.
		for kind, h := range soloHandlers {
			solo := jobs.NewWorker(queue, "solo-"+kind+"-"+uuid.NewString()[:8], time.Second)
			solo.Handle(kind, h)
			wg.Add(1)
			go func() {
				defer wg.Done()
				solo.Run(ctx)
			}()
		}
		startWebSync(ctx, wg, pool, svc)
		startSourceSync(ctx, wg, pool, svc)
		slog.Info("boot: job workers started",
			"workers", cfg.Jobs.Workers, "lease_seconds", cfg.Jobs.LeaseSeconds)
	}
	return knowledgeSubsystem{
		handler: handler, service: svc, authz: authorizer,
		retriever: retriever, providers: providers, blobs: blobs, start: start,
		objects: blobs, queue: queue, jobHandlers: extraHandlers,
		soloHandlers: soloHandlers, engines: cfg.Engines, driveFiles: driveFiles,
	}, nil
}

// reapHandler settles whatever a job that gave up owned: a document for a
// parse, an audio overview for audio_overview, a book's chapters for
// compile_book, a template or an exam for extract_exam and generate_exam.
func reapHandler() jobs.ReapHandler {
	return jobs.ReapHandlers(pg.KnowledgeReapHandler(), pg.AudioReapHandler(), pg.BookReapHandler(), pg.ExamReapHandler(),
		pg.SourceReapHandler(), pg.FeedReapHandler())
}

func parseDocumentHandler(svc *knowledge.Service) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job) error {
		var payload knowledge.ParseJobPayload
		if err := decodePayload(job, &payload); err != nil {
			return jobs.Terminal(err)
		}
		// The attempt count reaches the service because only the service knows
		// whether a failure is worth retrying, and only the queue knows whether
		// a retry remains. Split apart, a retryable failure on the last attempt
		// leaves a non-terminal document nothing will ever move again.
		err := svc.ProcessDocument(ctx, job.UserID, payload,
			knowledge.Attempt{Number: job.Attempts, Max: job.MaxAttempts})
		if knowledge.IsTerminal(err) {
			return jobs.Terminal(err)
		}
		return err
	}
}

func reindexHandler(svc *knowledge.Service) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job) error {
		var payload knowledge.ReindexJobPayload
		if err := decodePayload(job, &payload); err != nil {
			return jobs.Terminal(err)
		}
		err := svc.ReindexKB(ctx, job.UserID, payload)
		if knowledge.IsTerminal(err) {
			return jobs.Terminal(err)
		}
		return err
	}
}

func decodePayload(job *jobs.Job, v any) error {
	if err := json.Unmarshal(job.Payload, v); err != nil {
		return fmt.Errorf("job %s: unreadable payload: %w", job.ID, err)
	}
	return nil
}

// Close stops background work and releases the pool.
//
// Workers are stopped and WAITED FOR before the pool closes. Closing the pool
// under a running worker turns an in-flight parse into a connection error that
// the worker then cannot record, which leaves the document in `parsing` until
// the next process's reaper finds it — recoverable, but noisy for no reason.
func (a *App) Close() {
	if a.stopRuntime != nil {
		a.stopRuntime()
	}
	if a.bgCancel != nil {
		a.bgCancel()
		a.bgDone.Wait()
	}
	if a.rateLimiter != nil {
		a.rateLimiter.Close()
	}
	if a.routeLimits != nil {
		a.routeLimits.Close()
	}
	if a.pool != nil {
		a.pool.Close()
	}
}
