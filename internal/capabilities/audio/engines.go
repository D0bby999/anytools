package audio

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/providers/builtin"
	"github.com/D0bby999/anytools/internal/providers/tts"
)

// engines.go — who speaks a finished script (up-methods phase 22).
//
// "Speak it" offers, for the script's language, every engine that has two
// voices for it, each with its cost, and nothing runs before the learner
// picks one:
//
//   - builtin: the server's own Kokoro. No key; ANYTOOLS_TTS_DAILY_MINUTES of
//     speech per learner per local day, booked up front in one statement,
//     one job at a time on the server (a dedicated worker, internal/app).
//   - byok: one connection on the learner's tts route, an OpenAI key or
//     their own OpenAI-compatible speech server, billed per character.
//
// The browser's own voices are the third way; they run in the page and the
// server is not involved.

// Engine names, as the API and a job payload carry them.
const (
	EngineBuiltin = "builtin"
	EngineBYOK    = "byok"
)

// JobKindBuiltin is speaking on the built-in engine. Its own kind, because
// one dedicated worker claims it: one built-in job runs at a time, the
// others wait their turn.
const JobKindBuiltin = "audio_overview_builtin"

// wordsPerMinute is the pace an estimate assumes: a measured conversational
// pace for Kokoro and OpenAI at speed 1.0. Bookings use chunkBudget's slower
// 110, the most audio a chunk may come back as, so a booking is never short.
const wordsPerMinute = 150

var (
	// ErrNoVoice is an engine with no voice pair for the script's language.
	ErrNoVoice = errors.New("audio: this engine has no voices for the script's language")
	// ErrSpeechQuota is the built-in engine's day used up.
	ErrSpeechQuota = errors.New("audio: not enough built-in speech minutes left today")
	// ErrBuiltinUnavailable is the built-in engine chosen while it is not
	// running.
	ErrBuiltinUnavailable = errors.New("audio: the built-in voices are not available on this server right now")
)

// SpeechEngine is one connection on the learner's tts route.
type SpeechEngine struct {
	ConnectionID uuid.UUID
	Provider     string
	Name         string
	Model        string
}

// Builtin is the server's own Kokoro, when the operator runs one.
type Builtin struct {
	Engine *builtin.Engine
	Synth  tts.Synthesizer
	Usage  builtin.Usage
	// DailySeconds is each learner's allowance per local day.
	DailySeconds int
	// Zone is the learner's time zone (pg.UserStore.Timezone).
	Zone func(ctx context.Context, userID uuid.UUID) (string, error)
	// Line counts the built-in jobs queued or running on the server.
	Line func(ctx context.Context) (int, error)
}

// EngineChoice is what the learner picked.
type EngineChoice struct {
	Engine       string
	ConnectionID uuid.UUID
}

// EngineOption is one engine as "Speak it" offers it, with its cost.
type EngineOption struct {
	Engine       string     `json:"engine"`
	ConnectionID *uuid.UUID `json:"connection_id,omitempty"`
	// Provider is "builtin", "openai" or "openai_compat".
	Provider string    `json:"provider"`
	Name     string    `json:"name,omitempty"`
	Model    string    `json:"model"`
	Voices   VoicePair `json:"voices"`
	// Usable is false when it is listed but cannot start now; Reason says why.
	Usable bool   `json:"usable"`
	Reason string `json:"reason,omitempty"`
	// Chars is what a speech key bills: the script's spoken characters.
	Chars int `json:"chars"`
	// SpeechMinutes is about how long the audio will be.
	SpeechMinutes int `json:"speech_minutes"`
	// The built-in engine's time and allowance: WaitMinutes is the speech
	// ÷ the measured speed; NeedMinutes is what is booked from today's
	// DailyMinutes (the unused part is given back when it finishes).
	WaitMinutes  int `json:"wait_minutes,omitempty"`
	NeedMinutes  int `json:"need_minutes,omitempty"`
	DailyMinutes int `json:"daily_minutes,omitempty"`
	UsedMinutes  int `json:"used_minutes,omitempty"`
	// QueueAhead is how many built-in jobs are waiting or running now.
	QueueAhead int `json:"queue_ahead,omitempty"`
}

// speakable is what every overview's options are made from, read once per
// page: the learner's route and the built-in engine's state.
type speakable struct {
	routed     []SpeechEngine
	builtinUp  bool
	usedSecs   int
	queueAhead int
}

func (s *Service) speakable(ctx context.Context, userID uuid.UUID) (*speakable, error) {
	out := &speakable{}
	if s.speech != nil {
		routed, err := s.speech.Engines(ctx, userID)
		if err != nil {
			return nil, err
		}
		out.routed = routed
	}
	if b := s.builtin; b != nil && b.Synth != nil && b.Usage != nil && b.Engine.Available(ctx) {
		out.builtinUp = true
		used, err := b.Usage.Spent(ctx, userID, s.learnerDay(ctx, userID))
		if err != nil {
			return nil, err
		}
		out.usedSecs = used
		if b.Line != nil {
			if n, err := b.Line(ctx); err == nil {
				out.queueAhead = n
			}
		}
	}
	return out, nil
}

// options lists the engines that can speak o, in the page's order: the free
// one first. An engine with no voices for o's language is not listed.
func (s *Service) options(sp *speakable, o *Overview) []EngineOption {
	if o.Script == nil {
		return nil
	}
	chars, words := o.Script.Chars(), o.Script.Words()
	speech := int(math.Ceil(float64(words) / wordsPerMinute))
	var out []EngineOption
	if sp.builtinUp {
		if voices, ok := VoicesFor(tts.Family(s.builtin.Synth.Model()), o.Language); ok {
			b := s.builtin
			need := bookedSeconds(*o.Script)
			opt := EngineOption{Engine: EngineBuiltin, Provider: tts.BuiltinProvider, Model: b.Synth.Model(),
				Voices: voices, Usable: true, Chars: chars, SpeechMinutes: speech,
				NeedMinutes: minutes(need), DailyMinutes: b.DailySeconds / 60, UsedMinutes: sp.usedSecs / 60,
				QueueAhead: sp.queueAhead}
			opt.WaitMinutes = int(b.Engine.Estimate(float64(words)/wordsPerMinute*60) / time.Minute)
			if sp.usedSecs+need > b.DailySeconds {
				opt.Usable, opt.Reason = false, quotaSentence(sp.usedSecs, need, b.DailySeconds)
			}
			out = append(out, opt)
		}
	}
	for _, e := range sp.routed {
		voices, ok := VoicesFor(tts.Family(e.Model), o.Language)
		if !ok {
			continue
		}
		id := e.ConnectionID
		out = append(out, EngineOption{Engine: EngineBYOK, ConnectionID: &id, Provider: e.Provider, Name: e.Name,
			Model: e.Model, Voices: voices, Usable: true, Chars: chars, SpeechMinutes: speech})
	}
	return out
}

// resolve matches the learner's choice to an engine offered for o. A
// connection that is not on the caller's own tts route answers exactly like
// one that does not exist, whatever the overview's state or language.
func (s *Service) resolve(ctx context.Context, userID uuid.UUID, o *Overview, choice EngineChoice) (*EngineOption, error) {
	if choice.Engine != EngineBYOK && choice.ConnectionID != uuid.Nil {
		return nil, fmt.Errorf("%w: a connection is chosen only with the byok engine", ErrBadRequest)
	}
	sp, err := s.speakable(ctx, userID)
	if err != nil {
		return nil, err
	}
	switch choice.Engine {
	case EngineBYOK:
		var routed *SpeechEngine
		for i := range sp.routed {
			if sp.routed[i].ConnectionID == choice.ConnectionID {
				routed = &sp.routed[i]
			}
		}
		if routed == nil {
			return nil, ErrNotFound
		}
		if _, ok := VoicesFor(tts.Family(routed.Model), o.Language); !ok {
			return nil, ErrNoVoice
		}
	case EngineBuiltin:
		if !sp.builtinUp {
			return nil, ErrBuiltinUnavailable
		}
		if _, ok := VoicesFor(tts.Family(s.builtin.Synth.Model()), o.Language); !ok {
			return nil, ErrNoVoice
		}
	default:
		return nil, fmt.Errorf("%w: choose builtin or byok", ErrBadRequest)
	}
	if o.Script == nil {
		return nil, ErrNotSpeakable
	}
	for _, opt := range s.options(sp, o) {
		if opt.Engine != choice.Engine {
			continue
		}
		if opt.Engine == EngineBYOK && *opt.ConnectionID != choice.ConnectionID {
			continue
		}
		return &opt, nil
	}
	return nil, ErrNotSpeakable
}

// bookedSeconds is what the built-in engine books for a script: every
// chunk's budget, the most audio the engine may return for it.
func bookedSeconds(sc Script) int {
	total := 0
	for _, c := range sc.Chunks() {
		total += int(chunkBudget(c.Words()) / tts.BytesPerSecond)
	}
	return total
}

func minutes(seconds int) int { return int(math.Ceil(float64(seconds) / 60)) }

func quotaSentence(used, need, daily int) string {
	left := max(0, daily-used) / 60
	return fmt.Sprintf("Speaking this script books up to %d min; %d of your %d built-in minutes are left today.",
		minutes(need), left, daily/60)
}

// learnerDay is the learner's local day, as the allowance counts it.
func (s *Service) learnerDay(ctx context.Context, userID uuid.UUID) string {
	zone := ""
	if b := s.builtin; b != nil && b.Zone != nil {
		if z, err := b.Zone(ctx, userID); err == nil {
			zone = z
		}
	}
	return learning.LocalDay(s.now(), zone).String()
}

// book takes seconds from today's built-in allowance, or refuses.
func (s *Service) book(ctx context.Context, userID uuid.UUID, seconds int) (string, error) {
	b := s.builtin
	day := s.learnerDay(ctx, userID)
	ok, err := b.Usage.Spend(ctx, userID, day, seconds, b.DailySeconds)
	if err != nil {
		return "", err
	}
	if !ok {
		used, _ := b.Usage.Spent(ctx, userID, day)
		return "", fmt.Errorf("%w: %s Try again tomorrow, or choose another way to listen.",
			ErrSpeechQuota, quotaSentence(used, seconds, b.DailySeconds))
	}
	return day, nil
}

func (s *Service) refund(ctx context.Context, userID uuid.UUID, day string, seconds int) {
	if b := s.builtin; b != nil && day != "" && seconds > 0 {
		if err := b.Usage.Refund(context.WithoutCancel(ctx), userID, day, seconds); err != nil {
			slog.Warn("audio: could not refund built-in speech", "error", err)
		}
	}
}

// withEngines fills in what "Speak it" offers each overview that has a
// finished script waiting.
func (s *Service) withEngines(ctx context.Context, userID uuid.UUID, list []Overview) error {
	var sp *speakable
	for i := range list {
		o := &list[i]
		if o.Status != StatusScriptOnly || o.Script == nil {
			continue
		}
		if sp == nil {
			var err error
			if sp, err = s.speakable(ctx, userID); err != nil {
				return err
			}
		}
		o.Engines = s.options(sp, o)
		if o.Engines == nil {
			o.Engines = []EngineOption{}
		}
	}
	return nil
}
