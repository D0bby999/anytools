package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/config"
	mediafile "github.com/D0bby999/anytools/internal/connectors/media"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/media"
	"github.com/D0bby999/anytools/internal/providers/stt"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_links.go — web pages and YouTube videos in Knowledge (learning-depth
// phase 4): the link collaborators, the transcribe_video job, and the daily
// sync_web_sources pass. Up-methods phase 21 adds the engines that hear audio:
// the learner's stt route, the built-in Whisper and its transcribe_builtin job.

// linkDeps are the network collaborators links use. The zero value is
// production's; the end-to-end test scripts both.
type linkDeps struct {
	// fetch defaults to security.FetchClient.
	fetch *http.Client
	// youtube defaults to the allowlisted www.youtube.com client.
	youtube *youtube.Client
	// pool, queue and engines turn on the engines that hear audio (up-methods
	// phase 21): yt-dlp and ffmpeg, the learner's stt route, and the built-in
	// Whisper when engines.STTURL is set. Without a pool a video is
	// transcribed only by Gemini reading its URL.
	pool    *pg.Pool
	queue   *jobs.Queue
	engines config.EnginesConfig
}

// linkStorage is where a link's files go (blob.Router, or a test's
// blob.Local), and the server's data directory its job directories are
// made under.
type linkStorage interface {
	blob.ObjectStore
	Root() string
}

// linkConfig assembles the knowledge service's link support.
func linkConfig(kbStore *pg.KnowledgeStore, blobs linkStorage, byokSvc *byok.Service, d linkDeps) *knowledge.LinkConfig {
	if d.fetch == nil {
		d.fetch = security.FetchClient(20 * time.Second)
	}
	if d.youtube == nil {
		d.youtube = youtube.NewClient()
	}
	cfg := &knowledge.LinkConfig{
		Store:        kbStore,
		Fetch:        d.fetch,
		YouTube:      d.youtube,
		Transcribers: byokTranscribers{svc: byokSvc},
		// An uploaded recording heard by the learner's Gemini key, through
		// Gemini's Files API (up-methods phase 15).
		FileTranscribers: byokFiles{svc: byokSvc},
		Objects:          blobs,
	}
	if d.queue != nil {
		cfg.Jobs = d.queue
	}
	if d.pool == nil {
		return cfg
	}
	tmp := filepath.Join(blobs.Root(), "tmp")
	sweepTranscribeDirs(tmp)
	cfg.Audio = &knowledge.AudioTools{
		Fetch:   youtube.NewAudioFetcher(d.engines.YTDLP),
		Media:   media.NewFFmpeg(d.engines.FFmpeg),
		TmpRoot: tmp,
	}
	cfg.AudioTranscribers = byokAudio{svc: byokSvc}
	if d.engines.STTURL != "" && d.queue != nil {
		queue := d.queue
		cfg.Builtin = newBuiltinSTT(d.pool, d.engines)
		engine := cfg.Builtin.Engine
		cfg.Builtin.Line = func(ctx context.Context) (int, error) {
			return queue.Waiting(ctx, jobs.KindTranscribeBuiltin)
		}
		cfg.Builtin.Ahead = func(ctx context.Context, userID, docID uuid.UUID) (int, bool, error) {
			id, ok, err := queue.ActiveFor(ctx, userID, jobs.KindTranscribeBuiltin, docID)
			if err != nil || !ok {
				return 0, false, err
			}
			return queue.Ahead(ctx, id)
		}
		// The matrix says the server would transcribe for free, while it
		// answers its health check (byok/builtin.go).
		byokSvc.UseBuiltin(byok.FunctionSTT, byok.BuiltinEngine{
			Label: "Built-in transcription (free, slower)", Available: engine.Available})
	}
	return cfg
}

// newBuiltinSTT is the server's own speech engine with each learner's daily
// allowance, as a document's transcription and the read-aloud check share it
// (the same usage rows, so one allowance).
func newBuiltinSTT(pool *pg.Pool, engines config.EnginesConfig) *knowledge.BuiltinSTT {
	return &knowledge.BuiltinSTT{
		Engine:       stt.NewBuiltinEngine(engines.STTURL, engines.STTModel),
		Model:        engines.STTModel,
		Usage:        pg.NewSTTUsage(pool),
		DailySeconds: engines.STTDailyMinutes * 60,
		Zone:         pg.NewUserStore(pool).Timezone,
	}
}

// sweepTranscribeDirs removes job directories a crashed process left behind:
// a deferred removal does not run when the process is killed. Only ones old
// enough that no live job of this single-replica API can still own them.
func sweepTranscribeDirs(tmp string) {
	entries, err := os.ReadDir(tmp)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-2 * time.Hour)
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || !strings.HasPrefix(e.Name(), "transcribe-") || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(tmp, e.Name())); err == nil {
			slog.Info("knowledge: removed a stale transcription directory", "dir", e.Name())
		}
	}
}

// byokAudio is knowledge.AudioTranscribers over the learner's stt route
// (byok.STTFor): their own OpenAI, Groq or OpenAI-compatible key.
type byokAudio struct{ svc *byok.Service }

func (b byokAudio) AudioEngines(ctx context.Context, userID uuid.UUID) ([]knowledge.AudioEngine, error) {
	chain, err := b.svc.STTFor(ctx, userID, uuid.Nil)
	if err != nil {
		return nil, err
	}
	out := make([]knowledge.AudioEngine, 0, chain.Len())
	for _, e := range chain.Entries() {
		out = append(out, knowledge.AudioEngine{ConnectionID: e.ConnectionID, Provider: e.Provider, Name: e.Name, Model: e.Model})
	}
	return out, nil
}

// TranscribeAudio sends one window to the one connection the learner chose,
// resolved again on their own route: a key removed after the job was queued
// stops the job rather than falling through to another account.
func (b byokAudio) TranscribeAudio(ctx context.Context, userID, connectionID uuid.UUID, open func() (io.ReadCloser, error),
	mime, lang string) (*stt.Segments, string, int, error) {
	chain, err := b.svc.STTFor(ctx, userID, connectionID)
	if err != nil {
		return nil, "", 0, err
	}
	var (
		seg    *stt.Segments
		model  string
		billed int
	)
	err = chain.Do(ctx, func(ctx context.Context, t stt.Transcriber, e byok.Entry[stt.Transcriber]) error {
		f, err := open()
		if err != nil {
			return errors.Join(byok.ErrStopChain, err)
		}
		defer f.Close()
		billed++
		s, err := t.Transcribe(ctx, f, mime, lang)
		if err != nil {
			return err
		}
		seg, model = s, e.Model
		return nil
	})
	if errors.Is(err, byok.ErrNoRoute) {
		return nil, "", billed, knowledge.ErrNoAudioEngine
	}
	return seg, model, billed, err
}

// byokTranscribers is knowledge.VideoTranscribers over the learner's parse
// route (byok.TranscriberFor): their own Gemini key, never a platform one.
type byokTranscribers struct{ svc *byok.Service }

func (b byokTranscribers) TranscriberAvailable(ctx context.Context, userID uuid.UUID) (bool, error) {
	chain, err := b.svc.TranscriberFor(ctx, userID)
	if err != nil {
		return false, err
	}
	return chain.Len() > 0, nil
}

func (b byokTranscribers) TranscribeWindow(ctx context.Context, userID uuid.UUID, videoID string, w youtube.Window) (*youtube.Part, int, error) {
	chain, err := b.svc.TranscriberFor(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	var (
		part   *youtube.Part
		billed int
	)
	err = chain.Do(ctx, func(ctx context.Context, t youtube.Transcriber, _ byok.Entry[youtube.Transcriber]) error {
		billed++
		p, err := t.TranscribeWindow(ctx, videoID, w)
		if err != nil {
			return err
		}
		part = p
		return nil
	})
	if errors.Is(err, byok.ErrNoRoute) {
		// The Gemini key was removed from the route after the job was queued.
		return nil, billed, errNoTranscriber
	}
	return part, billed, err
}

var errNoTranscriber = errors.New("no Gemini key is routed for parsing any more")

// byokFiles is knowledge.FileTranscribers over the learner's Gemini keys
// (byok.GeminiFilesFor): the same keys TranscriberFor reads a video with.
type byokFiles struct{ svc *byok.Service }

func (b byokFiles) OpenFile(ctx context.Context, userID uuid.UUID, f knowledge.FileUpload) (knowledge.FileSession, error) {
	chain, err := b.svc.GeminiFilesFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	if chain.Len() == 0 {
		return nil, errNoTranscriber
	}
	return &geminiFileSession{chain: chain, file: f, uploaded: map[uuid.UUID]uploadedFile{}}, nil
}

type uploadedFile struct {
	client *mediafile.GeminiFiles
	file   *mediafile.File
}

// geminiFileSession uploads the recording under a key the first time that key
// hears a window of it, so a window that falls through to the next key in the
// chain is heard from that key's own copy. Close deletes every copy.
type geminiFileSession struct {
	chain    *byok.Chain[*mediafile.GeminiFiles]
	file     knowledge.FileUpload
	mu       sync.Mutex
	uploaded map[uuid.UUID]uploadedFile
}

func (s *geminiFileSession) TranscribeWindow(ctx context.Context, w youtube.Window) (*youtube.Part, int, error) {
	var (
		part   *youtube.Part
		billed int
	)
	err := s.chain.Do(ctx, func(ctx context.Context, g *mediafile.GeminiFiles, e byok.Entry[*mediafile.GeminiFiles]) error {
		s.mu.Lock()
		up, ok := s.uploaded[e.ConnectionID]
		s.mu.Unlock()
		if !ok {
			body, err := s.file.Open()
			if err != nil {
				return errors.Join(byok.ErrStopChain, err)
			}
			f, err := g.Upload(ctx, body, s.file.Size, s.file.MIME, s.file.Name)
			_ = body.Close()
			if err != nil {
				return err
			}
			up = uploadedFile{client: g, file: f}
			s.mu.Lock()
			s.uploaded[e.ConnectionID] = up
			s.mu.Unlock()
		}
		billed++
		p, err := g.TranscribeWindow(ctx, up.file, w)
		if err != nil {
			return err
		}
		part = p
		return nil
	})
	if errors.Is(err, byok.ErrNoRoute) {
		return nil, billed, errNoTranscriber
	}
	return part, billed, err
}

func (s *geminiFileSession) Close(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, up := range s.uploaded {
		if err := up.client.Delete(ctx, up.file.Name); err != nil {
			// Google deletes every file after 48 hours, which bounds this.
			slog.Warn("knowledge: an uploaded recording was not deleted from Gemini", "connection", id, "error", err)
		}
		delete(s.uploaded, id)
	}
}

// transcribeVideoHandler is the transcribe_video job: one billed call per
// window, each persisted before the next (jobs.RunUnits), so a retry resumes
// at the first unfinished window and a cancel stops after the current one.
func transcribeVideoHandler(svc *knowledge.Service, queue *jobs.Queue) jobs.Handler {
	audio := transcribeAudioHandler(svc, queue)
	return func(ctx context.Context, job *jobs.Job) error {
		var p knowledge.TranscribeJobPayload
		if err := decodePayload(job, &p); err != nil {
			return jobs.Terminal(err)
		}
		switch {
		case p.File:
			// An uploaded recording (up-methods phase 15): every engine on
			// this worker hears the stored file, Gemini through its Files API.
			if p.Engine != knowledge.EngineGemini && p.Engine != knowledge.EngineBYOK {
				return jobs.Terminal(errors.New("transcribe_video: unknown engine " + p.Engine))
			}
			return audio(ctx, job, p)
		case p.Engine == "", p.Engine == knowledge.EngineGemini:
		case p.Engine == knowledge.EngineBYOK:
			return audio(ctx, job, p)
		default:
			// A built-in job belongs on the built-in worker, never here: it
			// would run beside another and skip the one-at-a-time rule.
			return jobs.Terminal(errors.New("transcribe_video: unknown engine " + p.Engine))
		}
		windows, err := svc.TranscriptionWindows(ctx, job.UserID, p)
		if err != nil {
			if knowledge.IsTerminal(err) {
				return jobs.Terminal(err)
			}
			return err
		}
		err = queue.RunUnits(ctx, job, len(windows), func(ctx context.Context, i int) (int, error) {
			return svc.TranscribeWindow(ctx, job.UserID, p, i, windows[i])
		})
		if err == nil {
			err = svc.FinishTranscription(ctx, job.UserID, p, len(windows))
		}
		return settleTranscription(ctx, svc, job, p, err)
	}
}

// transcribeAudioHandler is the job of an engine that hears audio: the
// learner's own key (transcribe_video with engine "byok") or the built-in
// Whisper (transcribe_builtin, one at a time on its own worker). The audio
// lives in a per-job directory that RunAudioTranscription removes before it
// returns, whatever happened.
func transcribeAudioHandler(svc *knowledge.Service, queue *jobs.Queue) func(context.Context, *jobs.Job, knowledge.TranscribeJobPayload) error {
	return func(ctx context.Context, job *jobs.Job, p knowledge.TranscribeJobPayload) error {
		progress := jobs.ProgressOf(job)
		windows, err := svc.RunAudioTranscription(ctx, job.UserID, p, job.ID, progress.Done, progress.Total,
			func(n int, unit func(context.Context, int) (int, error)) error {
				return queue.RunUnits(ctx, job, n, unit)
			})
		if err == nil {
			err = svc.FinishTranscription(ctx, job.UserID, p, windows)
		}
		return settleTranscription(ctx, svc, job, p, err)
	}
}

// transcribeBuiltinHandler is the transcribe_builtin job. Registered on ONE
// worker (wire.go): the server runs one built-in transcription at a time.
func transcribeBuiltinHandler(svc *knowledge.Service, queue *jobs.Queue) jobs.Handler {
	audio := transcribeAudioHandler(svc, queue)
	return func(ctx context.Context, job *jobs.Job) error {
		var p knowledge.TranscribeJobPayload
		if err := decodePayload(job, &p); err != nil {
			return jobs.Terminal(err)
		}
		if p.Engine != knowledge.EngineBuiltin {
			return jobs.Terminal(errors.New("transcribe_builtin: not a built-in job"))
		}
		return audio(ctx, job, p)
	}
}

// settleTranscription reports a transcription's outcome to the queue, after
// the service has settled the video on the attempt that will not be retried.
func settleTranscription(ctx context.Context, svc *knowledge.Service, job *jobs.Job, p knowledge.TranscribeJobPayload, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, jobs.ErrLeaseLost) {
		// Another worker owns the job now; it writes the outcome.
		return err
	}
	var terminal *jobs.TerminalError
	isTerminal := errors.As(err, &terminal) || knowledge.IsTerminal(err) ||
		knowledge.TranscriptionRefused(err) || errors.Is(err, errNoTranscriber) ||
		errors.Is(err, knowledge.ErrNoAudioEngine) || audioRefused(err) || errors.Is(err, mediafile.ErrFileFailed)
	err = svc.FailTranscription(ctx, job.UserID, p, err, isTerminal,
		knowledge.Attempt{Number: job.Attempts, Max: job.MaxAttempts})
	if knowledge.IsTerminal(err) {
		return jobs.Terminal(err)
	}
	return err
}

// audioRefused: YouTube refused the server, the video is not public, or it is
// too large. Retrying from the same address gives the same answer.
func audioRefused(err error) bool {
	return errors.Is(err, youtube.ErrAudioBlocked) || errors.Is(err, youtube.ErrAudioUnavailable) ||
		errors.Is(err, youtube.ErrAudioTooLarge) || errors.Is(err, stt.ErrAudioTooLarge)
}

// WebSyncLock is the advisory-lock name the daily re-sync holds.
const WebSyncLock = "sync_web_sources"

// startWebSync runs the re-sync pass hourly; each page is due a day (or a
// week, after repeated changes) after its last sync, so the hourly tick only
// decides how promptly a due page is noticed. Advisory-locked like the due
// digest (internal/learning/due_digest_job.go), so two processes never sync
// the same page twice.
func startWebSync(ctx context.Context, wg *sync.WaitGroup, pool *pg.Pool, svc *knowledge.Service) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runWebSync(ctx, pool, svc)
			}
		}
	}()
}

func runWebSync(ctx context.Context, pool *pg.Pool, svc *knowledge.Service) {
	var rep knowledge.SyncReport
	ran, err := jobs.WithAdvisoryLock(ctx, pool, WebSyncLock, func(ctx context.Context) error {
		var err error
		rep, err = svc.SyncDueWebSources(ctx)
		// Podcast feeds and YouTube playlists are checked in the same daily
		// pass (up-methods phase 17), whatever the pages did.
		runFeedSync(ctx, svc)
		return err
	})
	switch {
	case err != nil:
		slog.Error("knowledge: web sync pass failed", "error", err)
	case ran && rep.Checked > 0:
		slog.Info("knowledge: web sync pass", "checked", rep.Checked, "changed", rep.Changed, "failed", rep.Failed)
	}
}
