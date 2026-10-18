// Package audio is the audio overview (learning-depth phase 10): a knowledge
// base or a research report, talked through by a host and an expert, on the
// learner's own model, then spoken by the engine they choose (up-methods
// phase 22): the server's built-in Kokoro, their own OpenAI-compatible
// speech key, or the browser's voices.
//
// Two steps, so the learner sees what speaking will cost before paying for it.
// First the model proposes a script and Go decides whether it is acceptable
// (script.go); the overview stops at `script_only`, showing the transcript
// and the engines that have voices for its language, each with its cost
// (engines.go), and the browser can speak it live. Then, if the learner picks
// an engine and presses "Speak it", the script is spoken in chunks of whole
// turns, each chunk a unit of a resumable job: a retry resumes at the first
// chunk not yet spoken, and Cancel stops after the chunk in flight.
package audio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	"github.com/D0bby999/anytools/internal/jobs"
	audioprompts "github.com/D0bby999/anytools/internal/prompts/audio"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/providers/tts"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// JobKind is the queue kind of an overview's generation.
const JobKind = "audio_overview"

// Blob namespaces: the finished WAV, and its parts while it is being spoken.
const (
	nsAudio = "audio"
	nsParts = "audio_parts"
)

// Statuses, as the table's CHECK names them.
const (
	StatusScripting    = "scripting"
	StatusSynthesizing = "synthesizing"
	StatusReady        = "ready"
	StatusScriptOnly   = "script_only"
	StatusFailed       = "failed"
)

var (
	// ErrNotFound covers "not yours" and "does not exist" alike.
	ErrNotFound = errors.New("audio: not found")
	// ErrBadRequest is a request the learner can fix.
	ErrBadRequest = errors.New("audio: bad request")
	// ErrNoSources is a knowledge base or report with nothing to talk about.
	ErrNoSources = errors.New("audio: there is nothing in these sources to talk about yet")
	// ErrNoSpeech is what Speech returns when the chosen connection is no
	// longer on the learner's `tts` route.
	ErrNoSpeech = errors.New("audio: no speech route")
	// ErrNotSpeakable is "Speak it" on an overview with no finished script,
	// or one already spoken or being spoken.
	ErrNotSpeakable = errors.New("audio: this overview cannot be spoken now")
)

// Overview is one row of audio_overviews.
type Overview struct {
	ID       uuid.UUID  `json:"id"`
	UserID   uuid.UUID  `json:"-"`
	KBID     *uuid.UUID `json:"kb_id,omitempty"`
	ReportID *uuid.UUID `json:"report_id,omitempty"`
	Title    string     `json:"title"`
	// Language is the spoken language, set with the script.
	Language string `json:"language"`
	// LanguageChoice is what the learner asked for: "en", "vi", or "" to
	// follow the sources.
	LanguageChoice  string         `json:"-"`
	Minutes         int            `json:"minutes"`
	Topic           string         `json:"topic,omitempty"`
	Status          string         `json:"status"`
	Error           string         `json:"error,omitempty"`
	Script          *Script        `json:"script,omitempty"`
	Sources         []Source       `json:"sources"`
	SourceVersions  map[string]int `json:"source_versions"`
	ChunksDone      int            `json:"chunks_done"`
	ChunksTotal     int            `json:"chunks_total"`
	AudioBytes      int64          `json:"audio_bytes"`
	DurationSeconds float64        `json:"duration_seconds"`
	JobID           *uuid.UUID     `json:"job_id,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	// Who spoke it (up-methods phase 22): "builtin", "openai" or
	// "openai_compat", the model and the two voices. Empty for an overview
	// spoken before phase 22, or never spoken.
	TTSEngine string     `json:"tts_engine,omitempty"`
	TTSModel  string     `json:"tts_model,omitempty"`
	TTSVoices *VoicePair `json:"tts_voices,omitempty"`
	// Engines are what "Speak it" offers for a finished script, by language.
	Engines []EngineOption `json:"engines,omitempty"`
}

// SpokenBy is the engine, model and voices an overview is spoken with.
type SpokenBy struct {
	Engine string
	Model  string
	Voices VoicePair
}

// Store is audio_overviews (pg.AudioStore).
type Store interface {
	Create(ctx context.Context, o Overview) (*Overview, error)
	Get(ctx context.Context, userID, id uuid.UUID) (*Overview, error)
	List(ctx context.Context, userID uuid.UUID, kbID, reportID *uuid.UUID) ([]Overview, error)
	SetJob(ctx context.Context, userID, id, jobID uuid.UUID) error
	SaveScript(ctx context.Context, userID, id uuid.UUID, s Script, sources []Source, versions map[string]int, language, status string, chunks int) error
	// StartSpeaking moves a script_only overview to synthesizing, records who
	// speaks it, and reports false when it was not script_only.
	StartSpeaking(ctx context.Context, userID, id uuid.UUID, by SpokenBy) (bool, error)
	Progress(ctx context.Context, userID, id uuid.UUID, done int) error
	Ready(ctx context.Context, userID, id uuid.UUID, bytes int64, seconds float64) error
	Fail(ctx context.Context, userID, id uuid.UUID, message string) error
	Delete(ctx context.Context, userID, id uuid.UUID) (*Overview, error)
	// KBName is the knowledge base's name, scoped to its owner.
	KBName(ctx context.Context, userID, kbID uuid.UUID) (string, error)
	// DocumentVersions reads the current version of each document.
	DocumentVersions(ctx context.Context, userID uuid.UUID, docIDs []uuid.UUID) (map[string]int, error)
}

// Passage is one retrieved chunk of a knowledge base.
type Passage struct {
	ChunkID, DocumentID uuid.UUID
	Title               string
	Page                int
	Text                string
}

// Retriever searches one knowledge base, scoped to its owner.
type Retriever interface {
	Search(ctx context.Context, userID uuid.UUID, kbID uuid.UUID, query string, limit int) ([]Passage, error)
}

// Report is the little of a research report an overview reads.
type Report struct {
	Query    string
	ReportMD string
}

// Reports reads a report, scoped to its owner.
type Reports interface {
	Report(ctx context.Context, userID, reportID uuid.UUID) (*Report, error)
}

// Speech is the learner's `tts` route. Wired to byok in internal/app; this
// package never sees a key.
type Speech interface {
	// Engines lists the route's connections.
	Engines(ctx context.Context, userID uuid.UUID) ([]SpeechEngine, error)
	// Speak speaks turns on connectionID, and on nothing else. ErrNoSpeech
	// when it is not on the route.
	Speak(ctx context.Context, userID, connectionID uuid.UUID, turns []tts.Turn, voices []tts.Speaker, maxPCM int64) ([]byte, error)
}

// Queue is the slice of jobs.Queue the service uses.
type Queue interface {
	Enqueue(ctx context.Context, userID uuid.UUID, kind string, payload any, maxAttempts int) (uuid.UUID, error)
	RunUnits(ctx context.Context, job *jobs.Job, total int, unit jobs.UnitFunc) error
	RequestCancel(ctx context.Context, userID, jobID uuid.UUID) (bool, error)
}

// Files is where the audio lives: one object per overview, and its parts.
type Files interface {
	PutObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, data []byte) error
	OpenObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) (*blob.File, error)
	WriteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, write func(io.Writer) error) error
	DeleteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) error
}

// Service makes audio overviews.
type Service struct {
	store     Store
	retriever Retriever
	reports   Reports
	models    runtime.ChatProviderResolver
	speech    Speech
	builtin   *Builtin
	queue     Queue
	files     Files
	now       func() time.Time
}

// Deps are the service's collaborators.
type Deps struct {
	Store     Store
	Retriever Retriever
	Reports   Reports
	Models    runtime.ChatProviderResolver
	Speech    Speech
	// Builtin is the server's own Kokoro; nil when the operator runs none.
	Builtin *Builtin
	Queue   Queue
	Files   Files
	// Now defaults to time.Now; the allowance's day is read from it.
	Now func() time.Time
}

// NewService builds the service.
func NewService(d Deps) *Service {
	if d.Now == nil {
		d.Now = time.Now
	}
	return &Service{store: d.Store, retriever: d.Retriever, reports: d.Reports, models: d.Models,
		speech: d.Speech, builtin: d.Builtin, queue: d.Queue, files: d.Files, now: d.Now}
}

// Request starts an overview of a knowledge base or a report.
type Request struct {
	KBID     *uuid.UUID `json:"kb_id"`
	ReportID *uuid.UUID `json:"report_id"`
	// Minutes is the target length, 3–15 (default 5).
	Minutes int `json:"minutes"`
	// Language is "en", "vi", or "" to follow the sources.
	Language string `json:"language"`
	// Topic narrows a knowledge base's overview (optional).
	Topic string `json:"topic"`
}

// Create checks the request, stores the overview and queues its generation.
// Ownership of the knowledge base or report is checked here, before anything
// is queued, so another user's id answers exactly like a missing one.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, r Request) (*Overview, error) {
	if (r.KBID == nil) == (r.ReportID == nil) {
		return nil, fmt.Errorf("%w: name a knowledge base or a report", ErrBadRequest)
	}
	if r.Minutes == 0 {
		r.Minutes = 5
	}
	if r.Minutes < 3 || r.Minutes > 15 {
		return nil, fmt.Errorf("%w: an overview is 3 to 15 minutes", ErrBadRequest)
	}
	if r.Language != "" && r.Language != "en" && r.Language != "vi" {
		return nil, fmt.Errorf("%w: the language is English or Vietnamese", ErrBadRequest)
	}
	r.Topic = strings.TrimSpace(r.Topic)
	if utf8.RuneCountInString(r.Topic) > 200 {
		return nil, fmt.Errorf("%w: keep the topic under 200 characters", ErrBadRequest)
	}
	if r.KBID != nil {
		if _, err := s.store.KBName(ctx, userID, *r.KBID); err != nil {
			return nil, ErrNotFound
		}
	} else if _, err := s.reports.Report(ctx, userID, *r.ReportID); err != nil {
		return nil, ErrNotFound
	}

	o, err := s.store.Create(ctx, Overview{
		UserID: userID, KBID: r.KBID, ReportID: r.ReportID, Minutes: r.Minutes,
		LanguageChoice: r.Language, Topic: r.Topic, Status: StatusScripting,
	})
	if err != nil {
		return nil, err
	}
	// Writing the script is one call (and at most one repair); a failed
	// attempt is worth one retry.
	jobID, err := s.queue.Enqueue(ctx, userID, JobKind, jobPayload{OverviewID: o.ID}, 2)
	if err != nil {
		return nil, err
	}
	if err := s.store.SetJob(ctx, userID, o.ID, jobID); err != nil {
		return nil, err
	}
	o.JobID = &jobID
	return o, nil
}

// Cancel stops an overview's generation after the chunk in flight.
func (s *Service) Cancel(ctx context.Context, userID, id uuid.UUID) error {
	o, err := s.store.Get(ctx, userID, id)
	if err != nil || o.JobID == nil {
		return ErrNotFound
	}
	if _, err := s.queue.RequestCancel(ctx, userID, *o.JobID); err != nil {
		return err
	}
	return nil
}

// Get reads one overview.
func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*Overview, error) {
	o, err := s.store.Get(ctx, userID, id)
	if err != nil {
		return nil, ErrNotFound
	}
	one := []Overview{*o}
	if err := s.withEngines(ctx, userID, one); err != nil {
		return nil, err
	}
	return &one[0], nil
}

// List lists a knowledge base's or a report's overviews.
func (s *Service) List(ctx context.Context, userID uuid.UUID, kbID, reportID *uuid.UUID) ([]Overview, error) {
	list, err := s.store.List(ctx, userID, kbID, reportID)
	if err != nil {
		return nil, err
	}
	if err := s.withEngines(ctx, userID, list); err != nil {
		return nil, err
	}
	return list, nil
}

// OpenAudio opens the finished WAV for the handler to stream. The caller
// closes it.
func (s *Service) OpenAudio(ctx context.Context, userID, id uuid.UUID) (*blob.File, error) {
	o, err := s.store.Get(ctx, userID, id)
	if err != nil || o.Status != StatusReady {
		return nil, ErrNotFound
	}
	f, err := s.files.OpenObject(ctx, userID, nsAudio, id)
	if blob.Gone(err) {
		return nil, ErrNotFound
	}
	return f, err
}

// Delete removes an overview and its audio.
func (s *Service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	o, err := s.store.Delete(ctx, userID, id)
	if err != nil {
		return ErrNotFound
	}
	if o.JobID != nil {
		_, _ = s.queue.RequestCancel(ctx, userID, *o.JobID)
	}
	_ = s.files.DeleteObject(ctx, userID, nsAudio, id)
	for i := 0; i < o.ChunksTotal; i++ {
		_ = s.files.DeleteObject(ctx, userID, nsParts, partID(id, i))
	}
	return nil
}

// Speak starts speaking a finished script on the engine the learner chose.
// The overview's ownership is checked first, then the chosen connection's
// (another learner's answers like a missing one), then the language: an
// engine with no voices for it is refused, never sent the script. The
// built-in engine's minutes are booked in one statement before anything is
// queued.
func (s *Service) Speak(ctx context.Context, userID, id uuid.UUID, choice EngineChoice) (*Overview, error) {
	o, err := s.store.Get(ctx, userID, id)
	if err != nil {
		return nil, ErrNotFound
	}
	opt, err := s.resolve(ctx, userID, o, choice)
	if err != nil {
		return nil, err
	}
	if o.Status != StatusScriptOnly {
		return nil, ErrNotSpeakable
	}
	p := jobPayload{OverviewID: id, Speak: true, Engine: opt.Engine}
	kind := JobKind
	if opt.Engine == EngineBuiltin {
		kind = JobKindBuiltin
		seconds := bookedSeconds(*o.Script)
		day, err := s.book(ctx, userID, seconds)
		if err != nil {
			return nil, err
		}
		p.ChargedDay, p.ChargedSeconds = day, seconds
	} else {
		p.ConnectionID = choice.ConnectionID
	}
	started, err := s.store.StartSpeaking(ctx, userID, id, SpokenBy{Engine: opt.Provider, Model: opt.Model, Voices: opt.Voices})
	if err == nil && !started {
		err = ErrNotSpeakable
	}
	if err != nil {
		s.refund(ctx, userID, p.ChargedDay, p.ChargedSeconds)
		return nil, err
	}
	// Two attempts: a retry resumes at the first chunk not yet spoken, so the
	// second attempt pays only for what the first did not finish.
	jobID, err := s.queue.Enqueue(ctx, userID, kind, p, 2)
	if err != nil {
		s.refund(ctx, userID, p.ChargedDay, p.ChargedSeconds)
		return nil, err
	}
	if err := s.store.SetJob(ctx, userID, id, jobID); err != nil {
		return nil, err
	}
	return s.Get(ctx, userID, id)
}

// jobPayload is an audio_overview job's, and an audio_overview_builtin one's.
type jobPayload struct {
	OverviewID uuid.UUID `json:"overview_id"`
	// Speak is the second step; without it the job writes the script only.
	Speak bool `json:"speak,omitempty"`
	// Engine is builtin or byok; ConnectionID is the byok connection chosen.
	// A speaking job without an engine was queued before phase 22, for a
	// Gemini voice that no longer exists.
	Engine       string    `json:"engine,omitempty"`
	ConnectionID uuid.UUID `json:"connection_id,omitempty"`
	// ChargedDay and ChargedSeconds are the built-in booking, for the
	// refund of what was not spoken (pg.AudioReapHandler).
	ChargedDay     string `json:"charged_day,omitempty"`
	ChargedSeconds int    `json:"charged_seconds,omitempty"`
}

// partID names chunk i of an overview's audio, stably across attempts.
func partID(overview uuid.UUID, i int) uuid.UUID {
	return uuid.NewSHA1(overview, []byte(fmt.Sprintf("part-%d", i)))
}

// Handle is the audio_overview job.
func (s *Service) Handle(ctx context.Context, job *jobs.Job) error {
	var p jobPayload
	if err := json.Unmarshal(job.Payload, &p); err != nil {
		return jobs.Terminal(fmt.Errorf("audio: unreadable payload: %w", err))
	}
	o, err := s.store.Get(ctx, job.UserID, p.OverviewID)
	if err != nil {
		// Deleted while queued: nothing left to make.
		return nil
	}
	if !p.Speak {
		if o.Script != nil {
			return nil
		}
		return terminalIfFinal(s.writeScript(ctx, o))
	}
	if o.Status != StatusSynthesizing || o.Script == nil {
		return nil
	}
	speak, err := s.speaker(o, p)
	if err != nil {
		return terminalIfFinal(err)
	}
	speakers := o.TTSVoices.speakers()

	chunks := o.Script.Chunks()
	err = s.queue.RunUnits(ctx, job, len(chunks), func(ctx context.Context, i int) (int, error) {
		chunk := chunks[i]
		turns := make([]tts.Turn, 0, len(chunk))
		for _, seg := range chunk {
			name := speakers[0].Name
			if seg.Speaker == SpeakerExpert {
				name = speakers[1].Name
			}
			turns = append(turns, tts.Turn{Speaker: name, Text: seg.Text})
		}
		pcm, err := speak(ctx, turns, speakers, chunkBudget(chunk.Words()))
		if err != nil {
			return 1, err
		}
		if err := s.files.PutObject(ctx, o.UserID, nsParts, partID(o.ID, i), pcm); err != nil {
			return 1, err
		}
		return 1, s.store.Progress(ctx, o.UserID, o.ID, i+1)
	})
	if err != nil {
		return terminalIfFinal(err)
	}
	seconds, err := s.join(ctx, o, len(chunks))
	if err != nil {
		return err
	}
	// The booking was the most the script could take; what it did not
	// take goes back today.
	s.refund(ctx, o.UserID, p.ChargedDay, p.ChargedSeconds-int(math.Ceil(seconds)))
	return nil
}

type speakFunc func(ctx context.Context, turns []tts.Turn, voices []tts.Speaker, maxPCM int64) ([]byte, error)

// speaker is the engine a speaking job uses. The language is checked again
// here, against the engine that will run: a script in a language the engine
// has no voices for is never sent to it.
func (s *Service) speaker(o *Overview, p jobPayload) (speakFunc, error) {
	if o.TTSVoices == nil || o.TTSVoices.Host == "" || o.TTSVoices.Expert == "" {
		// Queued before phase 22, for a Gemini voice that no longer exists.
		return nil, ErrNoSpeech
	}
	switch p.Engine {
	case EngineBuiltin:
		b := s.builtin
		if b == nil || b.Synth == nil {
			return nil, ErrBuiltinUnavailable
		}
		if _, ok := VoicesFor(tts.Family(b.Synth.Model()), o.Language); !ok {
			return nil, ErrNoVoice
		}
		return func(ctx context.Context, turns []tts.Turn, voices []tts.Speaker, maxPCM int64) ([]byte, error) {
			start := time.Now()
			pcm, err := b.Synth.Synthesize(ctx, turns, voices, maxPCM)
			if err != nil {
				b.Engine.Forget()
				return nil, err
			}
			b.Engine.Observe(Seconds(int64(len(pcm))), time.Since(start))
			return pcm, nil
		}, nil
	case EngineBYOK:
		if _, ok := VoicesFor(tts.Family(o.TTSModel), o.Language); !ok {
			return nil, ErrNoVoice
		}
		return func(ctx context.Context, turns []tts.Turn, voices []tts.Speaker, maxPCM int64) ([]byte, error) {
			return s.speech.Speak(ctx, o.UserID, p.ConnectionID, turns, voices, maxPCM)
		}, nil
	}
	return nil, ErrNoSpeech
}

// join writes the finished WAV: one header, then every part in order. It
// returns the audio's length in seconds.
func (s *Service) join(ctx context.Context, o *Overview, parts int) (float64, error) {
	// Every part is opened before the header is written, so the length it
	// declares is the length of the files that are then copied.
	files := make([]*blob.File, 0, parts)
	defer func() {
		for _, f := range files {
			f.Close()
		}
	}()
	var total int64
	for i := 0; i < parts; i++ {
		f, err := s.files.OpenObject(ctx, o.UserID, nsParts, partID(o.ID, i))
		if err != nil {
			return 0, err
		}
		files = append(files, f)
		total += f.Size
	}
	if total > int64(MaxSeconds)*tts.BytesPerSecond {
		return 0, jobs.Terminal(ErrTooLong)
	}
	err := s.files.WriteObject(ctx, o.UserID, nsAudio, o.ID, func(w io.Writer) error {
		if err := writeWAVHeader(w, total); err != nil {
			return err
		}
		for _, f := range files {
			if _, err := io.Copy(w, f); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	for i := 0; i < parts; i++ {
		_ = s.files.DeleteObject(ctx, o.UserID, nsParts, partID(o.ID, i))
	}
	return Seconds(total), s.store.Ready(ctx, o.UserID, o.ID, total+44, Seconds(total))
}

// writeScript retrieves the sources, asks for a script, validates it (one
// repair), and stores it as script_only: speaking it is the learner's call.
func (s *Service) writeScript(ctx context.Context, o *Overview) error {
	sources, err := s.sources(ctx, o)
	if err != nil {
		return err
	}
	lang := o.LanguageChoice
	if lang == "" {
		lang = detectLanguage(sources)
	}

	provider, err := s.models.ChatFor(ctx, o.UserID, "chat")
	if err != nil {
		return err
	}
	block, known := sourceBlock(sources, tools.Wrap)
	turns := clamp(o.Minutes*150/55, MinSegments, MaxSegments)
	language := map[string]string{"vi": "Vietnamese", "en": "English"}[lang]
	user := fmt.Sprintf("Language: %s\nAbout %d turns (about %d minutes spoken).\nSource ids you may cite: %s\n\n%s",
		language, turns, o.Minutes, strings.Join(sortedIDs(known), ", "), block)

	script, err := askScript(ctx, provider, audioprompts.Script, user)
	if err != nil {
		return err
	}
	if verr := Validate(script, known); verr != nil {
		raw, _ := json.Marshal(script)
		script, err = askScript(ctx, provider, audioprompts.Script+"\n\n"+audioprompts.Repair,
			fmt.Sprintf("%s\n\nThe rule broken: %s\n\nYour script:\n%s", user, verr.Error(), raw))
		if err != nil {
			return err
		}
		if verr := Validate(script, known); verr != nil {
			return jobs.Terminal(verr)
		}
	}

	cited := citedSources(script, sources)
	var docIDs []uuid.UUID
	for _, src := range cited {
		if id, err := uuid.Parse(src.DocumentID); err == nil {
			docIDs = append(docIDs, id)
		}
	}
	versions, err := s.store.DocumentVersions(ctx, o.UserID, docIDs)
	if err != nil {
		return err
	}

	return s.store.SaveScript(ctx, o.UserID, o.ID, script, cited, versions, lang, StatusScriptOnly, len(script.Chunks()))
}

// sources are the passages an overview talks about, numbered S1…Sn.
func (s *Service) sources(ctx context.Context, o *Overview) ([]Source, error) {
	var out []Source
	if o.KBID != nil {
		name, err := s.store.KBName(ctx, o.UserID, *o.KBID)
		if err != nil {
			return nil, jobs.Terminal(ErrNotFound)
		}
		query := o.Topic
		if query == "" {
			query = name
		}
		hits, err := s.retriever.Search(ctx, o.UserID, *o.KBID, query, MaxSources)
		if err != nil {
			return nil, err
		}
		for i, h := range hits {
			out = append(out, Source{ID: fmt.Sprintf("S%d", i+1), Title: h.Title, Page: h.Page,
				DocumentID: h.DocumentID.String(), ChunkID: h.ChunkID.String(), Text: h.Text})
		}
	} else {
		r, err := s.reports.Report(ctx, o.UserID, *o.ReportID)
		if err != nil {
			return nil, jobs.Terminal(ErrNotFound)
		}
		// A report is talked through from its own text, one section a source,
		// so a turn's chip opens the report it came from.
		for i, part := range sections(r.ReportMD, maxSnippetChars, MaxSources) {
			out = append(out, Source{ID: fmt.Sprintf("S%d", i+1), Title: r.Query,
				ReportID: o.ReportID.String(), Text: part})
		}
	}
	if len(out) == 0 {
		return nil, jobs.Terminal(ErrNoSources)
	}
	return out, nil
}

func askScript(ctx context.Context, provider runtime.ChatProvider, system, user string) (Script, error) {
	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: provider.DefaultModel(),
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: system},
			{Role: runtime.RoleUser, Content: user},
		},
	})
	if err != nil {
		return Script{}, fmt.Errorf("%w: %s", runtime.ErrProvider, err)
	}
	var s Script
	if resp == nil {
		return s, nil
	}
	if payload, ok := modeljson.Extract(resp.Content); ok {
		_ = json.Unmarshal([]byte(payload), &s)
	}
	for i := range s.Segments {
		s.Segments[i].Speaker = strings.ToLower(strings.TrimSpace(s.Segments[i].Speaker))
		s.Segments[i].Text = strings.TrimSpace(s.Segments[i].Text)
	}
	s.Title = strings.TrimSpace(s.Title)
	return s, nil
}

// citedSources keeps the sources the script cites, in S-number order.
func citedSources(s Script, all []Source) []Source {
	used := map[string]bool{}
	for _, seg := range s.Segments {
		for _, id := range seg.SourceIDs {
			used[id] = true
		}
	}
	out := []Source{}
	for _, src := range all {
		if used[src.ID] {
			out = append(out, src)
		}
	}
	return out
}

// terminalIfFinal marks errors a retry cannot fix as terminal: an overlong or
// unreadable audio answer, a provider refusal (4xx other than 429), and no
// route at all.
func terminalIfFinal(err error) error {
	var term *jobs.TerminalError
	if err == nil || errors.As(err, &term) {
		return err
	}
	if errors.Is(err, tts.ErrTooLong) || errors.Is(err, tts.ErrBadAudio) || errors.Is(err, runtime.ErrNoProvider) ||
		errors.Is(err, ErrNoSpeech) || errors.Is(err, ErrNoVoice) || errors.Is(err, ErrBuiltinUnavailable) {
		return jobs.Terminal(err)
	}
	var he *providers.HTTPError
	if errors.As(err, &he) && he.Status >= 400 && he.Status < 500 && he.Status != 429 {
		return jobs.Terminal(err)
	}
	return err
}

// detectLanguage follows the sources: Vietnamese when enough of their letters
// carry Vietnamese-only marks, English otherwise.
func detectLanguage(sources []Source) string {
	letters, marked := 0, 0
	for _, s := range sources {
		for _, r := range s.Text {
			if !unicode.IsLetter(r) {
				continue
			}
			letters++
			if strings.ContainsRune(vietnameseMarks, unicode.ToLower(r)) {
				marked++
			}
		}
	}
	if letters > 0 && marked*20 > letters {
		return "vi"
	}
	return "en"
}

const vietnameseMarks = "ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ"

// sections splits Markdown into at most n pieces of at most max characters,
// on paragraph boundaries.
func sections(md string, max, n int) []string {
	var (
		out []string
		cur strings.Builder
	)
	flush := func() {
		if t := strings.TrimSpace(cur.String()); t != "" && len(out) < n {
			out = append(out, truncate(t, max))
		}
		cur.Reset()
	}
	for _, para := range strings.Split(md, "\n\n") {
		if cur.Len() > 0 && utf8.RuneCountInString(cur.String())+utf8.RuneCountInString(para) > max {
			flush()
		}
		cur.WriteString(para)
		cur.WriteString("\n\n")
	}
	flush()
	return out
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func sortedIDs(known map[string]bool) []string {
	out := make([]string, 0, len(known))
	for i := 1; i <= len(known)+MaxSources; i++ {
		if id := fmt.Sprintf("S%d", i); known[id] {
			out = append(out, id)
		}
	}
	return out
}
