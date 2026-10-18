package knowledge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/media"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/providers/builtin"
	"github.com/D0bby999/anytools/internal/providers/stt"
)

// transcribe_engines.go — who transcribes a video (up-methods phase 21).
//
// A video with no captions can be transcribed three ways, and the learner
// picks one on the page after seeing what each costs; nothing runs before
// that:
//
//   - gemini: the learner's Gemini key reads the public URL. No download.
//     The learning-depth phase 4 path, unchanged (links.go).
//   - builtin: the server's own Whisper. yt-dlp fetches the audio track to a
//     per-job directory, ffmpeg cuts it into windows, speaches hears each.
//     No key; ANYTOOLS_STT_DAILY_MINUTES of audio per learner per local day,
//     one job at a time on the server (a dedicated worker, internal/app).
//   - byok: the same audio, sent to one connection on the learner's stt
//     route (OpenAI, Groq, an OpenAI-compatible server).
//
// Every engine's windows end as the same youtube.Part, so FinishTranscription
// assembles them into the same transcript, and the document's processed_by
// names who heard it.

// Engine names, as the API and a job payload carry them.
const (
	EngineGemini  = "gemini"
	EngineBuiltin = "builtin"
	EngineBYOK    = "byok"
)

// AudioEngine is one of the learner's connections that hears audio.
type AudioEngine struct {
	ConnectionID uuid.UUID
	Provider     string
	Name         string
	Model        string
}

// AudioTranscribers is the learner's stt route, as transcription sees it.
// Wired to byok in internal/app; this package never sees a key.
type AudioTranscribers interface {
	// AudioEngines lists the stt route's connections that hear audio.
	AudioEngines(ctx context.Context, userID uuid.UUID) ([]AudioEngine, error)
	// TranscribeAudio sends one window to connectionID, and to nothing else.
	// open is called for each call made (the audio is re-read, not held).
	// billed counts the provider calls made, even when it fails.
	TranscribeAudio(ctx context.Context, userID, connectionID uuid.UUID, open func() (io.ReadCloser, error),
		mime, lang string) (seg *stt.Segments, model string, billed int, err error)
}

// AudioFetcher fetches a public video's audio track into dir.
type AudioFetcher interface {
	Fetch(ctx context.Context, videoID, dir string) (string, error)
}

// AudioSplitter measures audio and cuts it into normalised windows.
type AudioSplitter interface {
	Duration(ctx context.Context, path string) (float64, error)
	Split(ctx context.Context, in, dir string, windows []media.Window) ([]string, error)
}

// AudioTools are what an engine that hears audio needs before it hears any.
type AudioTools struct {
	Fetch AudioFetcher
	Media AudioSplitter
	// TmpRoot is ANYTOOLS_DATA_DIR/tmp: each job's directory is made under
	// it and removed when the job's attempt ends.
	TmpRoot string
}

// BuiltinSTT is the server's own Whisper, when the operator runs one.
type BuiltinSTT struct {
	Engine *builtin.Engine
	Model  string
	Usage  builtin.Usage
	// DailySeconds is each learner's allowance per local day.
	DailySeconds int
	// Zone is the learner's time zone (pg.UserStore.Timezone).
	Zone func(ctx context.Context, userID uuid.UUID) (string, error)
	// Line counts the built-in jobs queued or running on the server.
	Line func(ctx context.Context) (int, error)
	// Ahead is how many built-in jobs run before this document's.
	Ahead func(ctx context.Context, userID, docID uuid.UUID) (int, bool, error)
}

// EngineChoice is what the learner picked.
type EngineChoice struct {
	Engine       string
	ConnectionID uuid.UUID
	// LengthConfirmed: the learner saw that a recording's length is unknown,
	// so its cost is too, and chose to go on (up-methods phase 15).
	LengthConfirmed bool
}

// EngineOption is one engine as the page offers it, with its cost.
type EngineOption struct {
	Engine       string     `json:"engine"`
	ConnectionID *uuid.UUID `json:"connection_id,omitempty"`
	// Provider is "builtin", "gemini", "openai", "groq" or "openai_compat".
	Provider string `json:"provider"`
	Name     string `json:"name,omitempty"`
	Model    string `json:"model,omitempty"`
	// Usable is false when it is listed but cannot start now; Reason says why.
	Usable bool   `json:"usable"`
	Reason string `json:"reason,omitempty"`
	// Downloads: the server fetches the audio from YouTube for it.
	Downloads bool `json:"downloads"`
	// EstimatedTokens is Gemini's cost: 100 tokens a second of video.
	EstimatedTokens int `json:"estimated_tokens,omitempty"`
	// AudioMinutes is what OpenAI and Groq bill: minutes of audio.
	AudioMinutes int `json:"audio_minutes,omitempty"`
	// WaitMinutes is the built-in engine's time: duration ÷ measured speed.
	WaitMinutes int `json:"wait_minutes,omitempty"`
	// DailyMinutes and UsedMinutes are the built-in allowance today.
	DailyMinutes int `json:"daily_minutes,omitempty"`
	UsedMinutes  int `json:"used_minutes,omitempty"`
	// QueueAhead is how many built-in jobs are waiting or running now.
	QueueAhead int `json:"queue_ahead,omitempty"`
}

// ErrAudioBlockedSentence starts the needs_transcript reason when YouTube
// refused the server the audio; the page reads it to say what still works.
const ErrAudioBlockedSentence = "YouTube blocked this server from fetching the video's audio."

// LinkSTTQuota refuses the built-in engine once the learner's day is used up.
const LinkSTTQuota = "stt_quota"

// LinkDurationUnknown refuses the built-in engine for a video whose length
// the server could not read: the allowance is charged by length up front.
const LinkDurationUnknown = "duration_unknown"

// engineOptions lists every engine the learner can use for doc, usable or
// not, in the page's order: the free one first.
func (s *Service) engineOptions(ctx context.Context, userID uuid.UUID, doc *Document) ([]EngineOption, error) {
	duration := 0
	if doc.Media != nil {
		duration = doc.Media.DurationSeconds
	}
	audioMinutes := int(math.Ceil(float64(duration) / 60))
	var out []EngineOption
	links := s.links
	if links == nil {
		return out, nil
	}
	// A video's audio is downloaded first; a recording's is already here
	// (up-methods phase 15), so only ffmpeg is needed to cut it.
	file := doc.SourceKind == SourceMedia
	canHear := links.Audio != nil && links.Audio.Media != nil && (file || links.Audio.Fetch != nil)

	if b := links.Builtin; b != nil && canHear && b.Engine.Available(ctx) {
		opt := EngineOption{Engine: EngineBuiltin, Provider: EngineBuiltin, Model: b.Model, Downloads: !file,
			AudioMinutes: audioMinutes, DailyMinutes: b.DailySeconds / 60, Usable: true}
		opt.WaitMinutes = int(b.Engine.Estimate(float64(duration)) / time.Minute)
		used, err := b.Usage.Spent(ctx, userID, s.learnerDay(ctx, b, userID))
		if err != nil {
			return nil, err
		}
		opt.UsedMinutes = used / 60
		if b.Line != nil {
			if n, err := b.Line(ctx); err == nil {
				opt.QueueAhead = n
			}
		}
		switch {
		case duration <= 0 && file:
			opt.Usable, opt.Reason = false, "The file's length could not be read from it, so the built-in engine cannot be booked for it."
		case duration <= 0:
			opt.Usable, opt.Reason = false, "The video's length could not be read, so the built-in engine cannot be booked for it."
		case used+duration > b.DailySeconds:
			opt.Usable, opt.Reason = false, builtinQuotaSentence(used, duration, b.DailySeconds)
		}
		out = append(out, opt)
	}
	if links.AudioTranscribers != nil && canHear {
		engines, err := links.AudioTranscribers.AudioEngines(ctx, userID)
		if err != nil {
			return nil, err
		}
		for _, e := range engines {
			id := e.ConnectionID
			out = append(out, EngineOption{Engine: EngineBYOK, ConnectionID: &id, Provider: e.Provider,
				Name: e.Name, Model: e.Model, Downloads: !file, AudioMinutes: audioMinutes, Usable: true})
		}
	}
	// Gemini reads a video's URL, and hears a recording through its Files
	// API; the same keys do both.
	if links.Transcribers != nil && (!file || links.FileTranscribers != nil) {
		ok, err := links.Transcribers.TranscriberAvailable(ctx, userID)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, EngineOption{Engine: EngineGemini, Provider: EngineGemini, Usable: true,
				EstimatedTokens: duration * tokensPerSecond(doc)})
		}
	}
	return out, nil
}

func builtinQuotaSentence(used, duration, daily int) string {
	left := max(0, daily-used) / 60
	return fmt.Sprintf("This video is %d min; %d of your %d built-in minutes are left today.",
		int(math.Ceil(float64(duration)/60)), left, daily/60)
}

// learnerDay is the learner's local day, as the allowance counts it.
func (s *Service) learnerDay(ctx context.Context, b *BuiltinSTT, userID uuid.UUID) string {
	zone := ""
	if b.Zone != nil {
		if z, err := b.Zone(ctx, userID); err == nil {
			zone = z
		}
	}
	return learning.LocalDay(s.now(), zone).String()
}

// resolveEngine matches the learner's choice to an engine offered to them.
// A connection id that is not on the caller's own stt route answers exactly
// like one that does not exist.
func (s *Service) resolveEngine(ctx context.Context, userID uuid.UUID, doc *Document, choice EngineChoice) (*EngineOption, error) {
	if choice.Engine == "" {
		// A request from before phase 21: the Gemini URL path, as it was.
		choice.Engine = EngineGemini
	}
	if choice.Engine != EngineBYOK && choice.ConnectionID != uuid.Nil {
		return nil, linkErr(LinkBadTranscript, "a connection is chosen only with the byok engine", nil)
	}
	opts, err := s.engineOptions(ctx, userID, doc)
	if err != nil {
		return nil, err
	}
	for i := range opts {
		o := &opts[i]
		if o.Engine != choice.Engine {
			continue
		}
		if o.Engine == EngineBYOK && (o.ConnectionID == nil || *o.ConnectionID != choice.ConnectionID) {
			continue
		}
		return o, nil
	}
	switch choice.Engine {
	case EngineBYOK:
		return nil, authz.ErrNoAccess
	case EngineGemini:
		return nil, linkErr(LinkNoTranscriber,
			"add a Gemini API key to your Speech to text or Parse route in Settings to transcribe videos", nil)
	case EngineBuiltin:
		return nil, linkErr(LinkNoTranscriber, "the built-in transcription engine is not available on this server right now", nil)
	}
	return nil, linkErr(LinkBadTranscript, "choose builtin, byok or gemini", nil)
}

// TranscriptionStart is what queuing a transcription returns.
type TranscriptionStart struct {
	JobID  uuid.UUID `json:"job_id"`
	Engine string    `json:"engine"`
	// QueueAhead is how many built-in jobs run before this one.
	QueueAhead int `json:"queue_ahead"`
}

// bookBuiltin takes the video's length from today's allowance, or refuses.
func (s *Service) bookBuiltin(ctx context.Context, userID uuid.UUID, duration int) (day string, err error) {
	b := s.links.Builtin
	day = s.learnerDay(ctx, b, userID)
	ok, err := b.Usage.Spend(ctx, userID, day, duration, b.DailySeconds)
	if err != nil {
		return "", err
	}
	if !ok {
		used, _ := b.Usage.Spent(ctx, userID, day)
		return "", linkErr(LinkSTTQuota, builtinQuotaSentence(used, duration, b.DailySeconds)+
			" Try again tomorrow, or choose another engine.", nil)
	}
	return day, nil
}

func (s *Service) refundBuiltin(ctx context.Context, userID uuid.UUID, day string, seconds int) {
	if b := s.links.Builtin; b != nil && day != "" {
		if err := b.Usage.Refund(context.WithoutCancel(ctx), userID, day, seconds); err != nil {
			slog.Warn("knowledge: could not refund built-in minutes", "error", err)
		}
	}
}

// ─────────────────────────────────────────── the audio job (builtin, byok)

// errAudioUnavailable: the server cannot fetch or cut audio at all.
var errAudioUnavailable = errors.New("knowledge: audio transcription is not configured")

// AudioUnits is what RunAudioTranscription asks the job queue to run: n
// resumable units (jobs.RunUnits).
type AudioUnits func(n int, unit func(ctx context.Context, i int) (billed int, err error)) error

// RunAudioTranscription is one attempt of an audio-engine job. It makes the
// job's directory and removes it when it returns, success or failure; inside
// it, yt-dlp fetches the audio, ffmpeg cuts it into windows (the source file
// is deleted as soon as the windows exist), and run transcribes them one unit
// each. It returns the number of windows for FinishTranscription.
//
// done and total are the job's checkpoint: a retry whose windows are all
// stored already skips the download.
func (s *Service) RunAudioTranscription(ctx context.Context, userID uuid.UUID, p TranscribeJobPayload,
	jobID uuid.UUID, done, total int, run AudioUnits) (int, error) {
	deps, err := s.linkDeps()
	if err != nil || deps.Objects == nil {
		return 0, errTerminal{errAudioUnavailable}
	}
	geminiFile := p.File && p.Engine == EngineGemini
	switch {
	case geminiFile:
		if deps.FileTranscribers == nil {
			return 0, errTerminal{errAudioUnavailable}
		}
	case deps.Audio == nil || deps.Audio.Media == nil || (!p.File && deps.Audio.Fetch == nil):
		return 0, errTerminal{errAudioUnavailable}
	}
	doc, err := s.store.GetDocument(ctx, userID, p.DocumentID)
	if err != nil {
		if errors.Is(err, authz.ErrNoAccess) {
			return 0, errTerminal{err}
		}
		return 0, err
	}
	if !doc.Timed() || p.File != (doc.SourceKind == SourceMedia) || doc.Status != StatusParsing {
		return 0, errTerminal{errors.New("knowledge: the video is no longer waiting for a transcript")}
	}
	if total > 0 && done >= total {
		return total, nil
	}
	if geminiFile {
		// No job directory: the recording is uploaded from where it is stored.
		return s.runGeminiFile(ctx, doc, p, run)
	}

	dir, cleanup, err := media.JobDir(deps.Audio.TmpRoot, "transcribe-"+jobID.String())
	if err != nil {
		return 0, err
	}
	defer cleanup()

	// A video's audio is fetched into the job directory; a recording is
	// copied there from wherever it is stored. Either way the source is the
	// job's own file.
	var source string
	if p.File {
		source, err = s.materializeRecording(ctx, doc, dir)
	} else {
		source, err = deps.Audio.Fetch.Fetch(ctx, doc.MediaID, dir)
	}
	if err != nil {
		return 0, err
	}
	seconds, err := deps.Audio.Media.Duration(ctx, source)
	if err != nil {
		return 0, errTerminal{err}
	}
	// A built-in job was booked by the video's listed length; audio much
	// longer than that would spend minutes nobody booked.
	if p.Engine == EngineBuiltin && seconds > float64(p.ChargedSeconds)+60 {
		return 0, errTerminal{errAudioLongerThanBooked}
	}
	windows, err := youtube.Windows(int(math.Ceil(seconds)))
	if err != nil {
		return 0, errTerminal{err}
	}
	spans := make([]media.Window, len(windows))
	for i, w := range windows {
		spans[i] = media.Window{Start: w.Start, End: w.End}
	}
	files, err := deps.Audio.Media.Split(ctx, source, dir, spans)
	if err != nil {
		return 0, errTerminal{err}
	}
	_ = os.Remove(source)

	err = run(len(files), func(ctx context.Context, i int) (int, error) {
		length := float64(windows[i].End - windows[i].Start)
		if windows[i].End == 0 {
			length = seconds - float64(windows[i].Start)
		}
		return s.transcribeAudioWindow(ctx, doc, p, i, windows[i], length, files[i])
	})
	return len(files), err
}

var errAudioLongerThanBooked = errors.New("knowledge: the audio is longer than the video's listed length")

// transcribeAudioWindow hears one window and stores its part before it
// returns, so a retry resumes after it.
func (s *Service) transcribeAudioWindow(ctx context.Context, doc *Document, p TranscribeJobPayload,
	i int, w youtube.Window, length float64, path string) (int, error) {
	deps := s.links
	open := func() (io.ReadCloser, error) { return os.Open(path) }
	var (
		seg    *stt.Segments
		model  string
		engine string
		billed int
		err    error
	)
	switch p.Engine {
	case EngineBuiltin:
		b := deps.Builtin
		if b == nil || !b.Engine.Configured() {
			return 0, errTerminal{errors.New("knowledge: the built-in engine is no longer configured")}
		}
		engine, model, billed = EngineBuiltin, b.Model, 1
		f, oerr := open()
		if oerr != nil {
			return 0, oerr
		}
		started := time.Now()
		seg, err = stt.NewBuiltin(b.Engine, b.Model).Transcribe(ctx, f, media.OutputMIME, "")
		_ = f.Close()
		if err == nil {
			b.Engine.Observe(length, time.Since(started))
		} else {
			b.Engine.Forget()
		}
	case EngineBYOK:
		if deps.AudioTranscribers == nil {
			return 0, errTerminal{errAudioUnavailable}
		}
		seg, model, billed, err = deps.AudioTranscribers.TranscribeAudio(ctx, doc.UserID, p.ConnectionID, open, media.OutputMIME, "")
		engine = p.Provider
	default:
		return 0, errTerminal{fmt.Errorf("knowledge: %q is not an audio engine", p.Engine)}
	}
	if errors.Is(err, stt.ErrNoSpeech) {
		// A silent window (music, an intro) is a window with nothing said.
		seg, err = &stt.Segments{Timed: true}, nil
	}
	if err != nil {
		return billed, err
	}
	raw, err := json.Marshal(audioPart(seg, w, length, engine, model))
	if err != nil {
		return billed, err
	}
	return billed, deps.Objects.PutObject(ctx, doc.UserID, transcriptObjects, windowObject(p.DocumentID, i), raw)
}

// audioPart places one window's segments on the video's clock.
func audioPart(seg *stt.Segments, w youtube.Window, length float64, engine, model string) *youtube.Part {
	segments := seg.Segments
	if !seg.Timed && seg.Duration <= 0 && len(segments) > 0 {
		// A text-only answer with no duration: spread it over the window.
		text := ""
		for _, s := range segments {
			text += s.Text + " "
		}
		segments = stt.Spread(text, length)
	}
	part := &youtube.Part{Language: seg.Language, Model: model, Engine: engine, Cues: []youtube.Cue{}}
	offset := float64(w.Start)
	for _, s := range segments {
		end := s.End + offset
		if s.End <= s.Start {
			end = -1
		}
		part.Cues = append(part.Cues, youtube.Cue{Start: s.Start + offset, End: end, Text: s.Text})
	}
	return part
}

// engineProcessedBy is the transcript's label: who heard it, with which model.
func engineProcessedBy(engine, model string) ProcessedBy {
	const caveat = "; words may be misheard and times are approximate"
	switch engine {
	case "", EngineGemini:
		return ProcessedBy{Parser: "gemini", Model: model, Engine: EngineGemini,
			Note: "an AI transcript made by your Gemini key" + caveat}
	case EngineBuiltin:
		return ProcessedBy{Parser: "whisper:builtin", Model: model, Engine: EngineBuiltin,
			Note: "transcribed by " + stt.ModelLabel(model) + " on this server" + caveat}
	}
	return ProcessedBy{Parser: "stt:" + engine, Model: model, Engine: engine,
		Note: "transcribed by " + providerLabel(engine) + ", " + model + caveat}
}

func providerLabel(p string) string {
	switch p {
	case providers.ProviderOpenAI:
		return "your OpenAI key"
	case providers.ProviderGroq:
		return "your Groq key"
	case providers.ProviderOpenAICompat:
		return "your own speech server"
	}
	return "your " + p + " key"
}

// audioSentence is the needs_transcript reason for a failed audio-engine job.
func audioSentence(engine string, err error) string {
	switch {
	case errors.Is(err, youtube.ErrAudioBlocked):
		return ErrAudioBlockedSentence + " Transcribe with your Gemini key, which reads the video without a download, or upload subtitles or paste the transcript."
	case errors.Is(err, youtube.ErrAudioUnavailable):
		return "YouTube says this video's audio is not publicly available. Only public videos can be transcribed."
	case errors.Is(err, youtube.ErrAudioTooLarge), errors.Is(err, youtube.ErrTooLong):
		return "This video is too long to transcribe here."
	case errors.Is(err, youtube.ErrAudioTimeout):
		return "Fetching the video's audio took too long. Try again later."
	case errors.Is(err, errAudioLongerThanBooked):
		return "The video's audio is longer than its listed length, so the built-in engine stopped. Try another engine."
	case errors.Is(err, media.ErrUnreadable), errors.Is(err, media.ErrWindowTooLarge):
		return "The video's audio could not be read."
	case errors.Is(err, youtube.ErrTranscriptTooLarge):
		return youtube.ErrTranscriptTooLarge.Error() + "."
	case errors.Is(err, youtube.ErrEmptyTranscript):
		return "No speech was heard in this video."
	case err != nil && err.Error() == "cancelled":
		return "The transcription was cancelled."
	case errors.Is(err, ErrNoAudioEngine):
		return "The chosen key is no longer on your Speech to text route. Choose another engine."
	}
	var he *providers.HTTPError
	if engine == EngineBuiltin && !errors.As(err, &he) {
		return "The built-in transcription engine did not answer. Try again later, or choose another engine."
	}
	if engine == EngineBuiltin {
		return "The built-in transcription engine could not transcribe this video. Try again later, or choose another engine."
	}
	return stt.Explain(err) + " Try again, or upload subtitles or paste the transcript."
}

// ErrNoAudioEngine: the chosen connection left the stt route after the job
// was queued. The app's adapter returns it; retrying will not bring it back.
var ErrNoAudioEngine = errors.New("knowledge: the chosen speech connection is no longer routed")
