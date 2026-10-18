package audio_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/audio"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/providers/builtin"
	"github.com/D0bby999/anytools/internal/providers/tts"
)

// 23:30 on the 16th in Ho Chi Minh City, while UTC is still mid-afternoon:
// the learner's day is the 16th either way, and 00:30 local would be the 17th.
func fixedNow() time.Time { return time.Date(2026, 10, 16, 16, 30, 0, 0, time.UTC) }

// usage is builtin.Usage in memory, with the same all-or-nothing Spend.
type usage struct {
	mu      sync.Mutex
	spent   map[string]int
	refunds int
}

func (u *usage) Spend(_ context.Context, userID uuid.UUID, day string, amount, limit int) (bool, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	k := userID.String() + day
	if u.spent[k]+amount > limit {
		return false, nil
	}
	u.spent[k] += amount
	return true, nil
}
func (u *usage) Refund(_ context.Context, userID uuid.UUID, day string, amount int) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.refunds++
	u.spent[userID.String()+day] = max(0, u.spent[userID.String()+day]-amount)
	return nil
}
func (u *usage) Spent(_ context.Context, userID uuid.UUID, day string) (int, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.spent[userID.String()+day], nil
}

// synth is the built-in Kokoro: 0.1 s of audio per turn.
type synth struct {
	calls  int
	voices []string
	texts  []string
}

func (s *synth) Name() string               { return tts.BuiltinProvider }
func (s *synth) Model() string              { return tts.DefaultBuiltinModel }
func (s *synth) Ping(context.Context) error { return nil }
func (s *synth) Synthesize(_ context.Context, turns []tts.Turn, speakers []tts.Speaker, _ int64) ([]byte, error) {
	s.calls++
	voice := map[string]string{}
	for _, sp := range speakers {
		voice[sp.Name] = sp.Voice
	}
	for _, t := range turns {
		s.voices = append(s.voices, voice[t.Speaker])
		s.texts = append(s.texts, t.Text)
	}
	return bytes.Repeat([]byte{1, 0}, 2400*len(turns)), nil
}

type builtinFake struct {
	b     *audio.Builtin
	synth *synth
	usage *usage
}

// newBuiltin is the built-in engine behind a Kokoro-FastAPI-shaped health
// check that answers.
func newBuiltin(t *testing.T, dailyMinutes int) builtinFake {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"healthy"}`))
	}))
	t.Cleanup(srv.Close)
	f := builtinFake{synth: &synth{}, usage: &usage{spent: map[string]int{}}}
	f.b = &audio.Builtin{
		Engine: builtin.New(srv.URL, 2, time.Minute), Synth: f.synth, Usage: f.usage,
		DailySeconds: dailyMinutes * 60,
		Zone:         func(context.Context, uuid.UUID) (string, error) { return "Asia/Ho_Chi_Minh", nil },
		Line:         func(context.Context) (int, error) { return 1, nil },
	}
	return f
}

func scripted(t *testing.T, f *fixture) {
	t.Helper()
	if err := f.svc.Handle(context.Background(), f.job); err != nil {
		t.Fatal(err)
	}
	if f.store.o.Status != audio.StatusScriptOnly {
		t.Fatalf("status %s", f.store.o.Status)
	}
}

func TestEveryKokoroLanguageHasTwoDistinctVoicesOfItsOwn(t *testing.T) {
	langs := map[string]string{"en": "a", "en-GB": "b", "es": "e", "hi": "h", "it": "i", "ja": "j", "pt-BR": "p", "zh": "z"}
	for lang, code := range langs {
		p, ok := audio.VoicesFor(tts.FamilyKokoro, lang)
		if !ok {
			t.Errorf("%s: no Kokoro voices", lang)
			continue
		}
		if p.Host == p.Expert {
			t.Errorf("%s: one voice for both speakers", lang)
		}
		// The first letter is the voice's lang_code, the second its gender:
		// one female and one male voice of the language itself.
		if !strings.HasPrefix(p.Host, code+"f_") || !strings.HasPrefix(p.Expert, code+"m_") {
			t.Errorf("%s: %s and %s are not a female and a male voice of lang_code %s", lang, p.Host, p.Expert, code)
		}
	}
	if p, _ := audio.VoicesFor(tts.FamilyKokoro, "en"); p != (audio.VoicePair{Host: "af_heart", Expert: "am_michael"}) {
		t.Errorf("American English is %+v", p)
	}
	if p, _ := audio.VoicesFor(tts.FamilyKokoro, "en-GB"); p != (audio.VoicePair{Host: "bf_emma", Expert: "bm_george"}) {
		t.Errorf("British English is %+v", p)
	}
	// Kokoro has no Vietnamese voice, and only one French one.
	for _, lang := range []string{"vi", "fr", "de", ""} {
		if _, ok := audio.VoicesFor(tts.FamilyKokoro, lang); ok {
			t.Errorf("Kokoro claims a pair for %q", lang)
		}
	}
	if audio.KokoroLanguages() != len(langs)-2 {
		t.Errorf("KokoroLanguages = %d", audio.KokoroLanguages())
	}
	for _, lang := range []string{"en", "vi", "fr"} {
		if p, ok := audio.VoicesFor(tts.FamilyOpenAI, lang); !ok || p.Host != "nova" || p.Expert != "onyx" {
			t.Errorf("OpenAI %s: %+v %v", lang, p, ok)
		}
	}
}

// With no key, an English overview is spoken by the built-in Kokoro in two
// voices, within the day's minutes; what the booking did not use goes back.
func TestNoKeyEnglishOverviewIsSpokenByBuiltinKokoroWithinTheDay(t *testing.T) {
	bf := newBuiltin(t, 60)
	f := newFixtureWith(t, &speech{}, bf.b, "en", reply(script(10, "S1")))
	scripted(t, f)

	got, err := f.svc.Get(context.Background(), f.user, f.store.o.ID)
	if err != nil || len(got.Engines) != 1 {
		t.Fatalf("engines %+v err %v", got.Engines, err)
	}
	opt := got.Engines[0]
	if opt.Engine != audio.EngineBuiltin || !opt.Usable || opt.Voices.Host != "af_heart" || opt.Voices.Expert != "am_michael" ||
		opt.DailyMinutes != 60 || opt.NeedMinutes < 1 || opt.QueueAhead != 1 || opt.Chars == 0 {
		t.Fatalf("built-in option %+v", opt)
	}

	job := f.speakOn(t, audio.EngineChoice{Engine: audio.EngineBuiltin})
	if job.Kind != audio.JobKindBuiltin {
		t.Fatalf("queued as %s; the built-in engine has its own single-worker kind", job.Kind)
	}
	var p map[string]any
	_ = json.Unmarshal(job.Payload, &p)
	day := "2026-10-16"
	booked := int(p["charged_seconds"].(float64))
	if p["charged_day"] != day || booked <= 0 {
		t.Fatalf("payload %v", p)
	}
	if spent, _ := bf.usage.Spent(context.Background(), f.user, day); spent != booked {
		t.Fatalf("spent %d, booked %d", spent, booked)
	}
	if err := f.svc.Handle(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	o := f.store.o
	if o.Status != audio.StatusReady || o.TTSEngine != tts.BuiltinProvider || o.TTSModel != "kokoro" ||
		o.TTSVoices == nil || o.TTSVoices.Host != "af_heart" {
		t.Fatalf("overview %+v", o)
	}
	// Two voices, alternating with the turns.
	if bf.synth.voices[0] != "af_heart" || bf.synth.voices[1] != "am_michael" {
		t.Fatalf("voices %v", bf.synth.voices[:2])
	}
	// Ten turns of 0.1 s spoken: one second is kept, the rest given back.
	if spent, _ := bf.usage.Spent(context.Background(), f.user, day); spent != 1 {
		t.Fatalf("after speaking, %d seconds are spent; want the one second spoken", spent)
	}
}

// Quota: a day that cannot hold the booking refuses it before anything is
// queued, and the option says so.
func TestTheBuiltinQuotaRefusesBeforeAnythingIsQueued(t *testing.T) {
	bf := newBuiltin(t, 1)
	long := script(20, "S1")
	for i := range long.Segments {
		long.Segments[i].Text = strings.Repeat("word ", 80)
	}
	f := newFixtureWith(t, &speech{}, bf.b, "en", reply(long))
	scripted(t, f)
	got, _ := f.svc.Get(context.Background(), f.user, f.store.o.ID)
	if len(got.Engines) != 1 || got.Engines[0].Usable || !strings.Contains(got.Engines[0].Reason, "built-in minutes") {
		t.Fatalf("option %+v", got.Engines)
	}
	_, err := f.svc.Speak(context.Background(), f.user, f.store.o.ID, audio.EngineChoice{Engine: audio.EngineBuiltin})
	if !errors.Is(err, audio.ErrSpeechQuota) {
		t.Fatalf("err %v, want ErrSpeechQuota", err)
	}
	if f.q.enqueued != 1 || f.store.o.Status != audio.StatusScriptOnly || bf.synth.calls != 0 {
		t.Fatalf("refused booking queued %d jobs, status %s", f.q.enqueued, f.store.o.Status)
	}
	if spent, _ := bf.usage.Spent(context.Background(), f.user, "2026-10-16"); spent != 0 {
		t.Fatalf("a refusal spent %d", spent)
	}
}

// A Vietnamese overview is never sent to Kokoro, built-in or the learner's
// own: only an engine with Vietnamese voices is offered, and the browser.
func TestAVietnameseScriptIsNeverSentToKokoro(t *testing.T) {
	bf := newBuiltin(t, 60)
	ownKokoro := uuid.New()
	sp := &speech{available: true, extra: []audio.SpeechEngine{
		{ConnectionID: ownKokoro, Provider: "openai_compat", Name: "My Kokoro", Model: "kokoro"}}}
	f := newFixtureWith(t, sp, bf.b, "vi", reply(script(10, "S1")))
	scripted(t, f)

	got, _ := f.svc.Get(context.Background(), f.user, f.store.o.ID)
	if len(got.Engines) != 1 || got.Engines[0].Provider != "openai" || got.Engines[0].Voices.Host != "nova" {
		t.Fatalf("a Vietnamese script is offered %+v", got.Engines)
	}
	for _, choice := range []audio.EngineChoice{
		{Engine: audio.EngineBuiltin},
		{Engine: audio.EngineBYOK, ConnectionID: ownKokoro},
	} {
		if _, err := f.svc.Speak(context.Background(), f.user, f.store.o.ID, choice); !errors.Is(err, audio.ErrNoVoice) {
			t.Fatalf("%+v: err %v, want ErrNoVoice", choice, err)
		}
	}
	if bf.synth.calls != 0 || f.q.enqueued != 1 || f.store.o.Status != audio.StatusScriptOnly {
		t.Fatalf("Kokoro was asked %d times; %d jobs", bf.synth.calls, f.q.enqueued)
	}
	if spent, _ := bf.usage.Spent(context.Background(), f.user, "2026-10-16"); spent != 0 {
		t.Fatalf("a refused language booked %d seconds", spent)
	}

	// And the job checks again: a built-in job for a Vietnamese overview
	// (queued by anything) ends without a call.
	f.store.o.Status = audio.StatusSynthesizing
	f.store.o.TTSVoices = &audio.VoicePair{Host: "af_heart", Expert: "am_michael"}
	payload, _ := json.Marshal(map[string]any{"overview_id": f.store.o.ID, "speak": true, "engine": "builtin"})
	err := f.svc.Handle(context.Background(), &jobs.Job{UserID: f.user, Kind: audio.JobKindBuiltin, Payload: payload})
	var term *jobs.TerminalError
	if !errors.As(err, &term) || !errors.Is(err, audio.ErrNoVoice) || bf.synth.calls != 0 {
		t.Fatalf("job err %v, %d calls", err, bf.synth.calls)
	}

	// The learner's OpenAI key speaks it, in OpenAI's voices.
	f.store.o.Status = audio.StatusScriptOnly
	job := f.speak(t)
	if err := f.svc.Handle(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	if f.store.o.Status != audio.StatusReady || sp.voices[0][0].Voice != "nova" || sp.voices[0][1].Voice != "onyx" {
		t.Fatalf("status %s voices %v", f.store.o.Status, sp.voices)
	}
}

// Another learner's connection, named on the learner's own overview,
// answers like a missing one, before the overview's state is looked at.
func TestAConnectionNotOnTheRouteAnswersNotFoundFirst(t *testing.T) {
	f := newFixture(t, &speech{available: true}, reply(script(10, "S1")))
	// Still scripting: the connection is refused before "not speakable".
	_, err := f.svc.Speak(context.Background(), f.user, f.store.o.ID, audio.EngineChoice{Engine: audio.EngineBYOK, ConnectionID: uuid.New()})
	if !errors.Is(err, audio.ErrNotFound) {
		t.Fatalf("err %v, want ErrNotFound", err)
	}
	for _, bad := range []audio.EngineChoice{{}, {Engine: "gemini"}, {Engine: audio.EngineBuiltin, ConnectionID: uuid.New()}} {
		if _, err := f.svc.Speak(context.Background(), f.user, f.store.o.ID, bad); !errors.Is(err, audio.ErrBadRequest) {
			t.Errorf("%+v: %v", bad, err)
		}
	}
}

// A speaking job queued before phase 22 has no engine: it was for a Gemini
// voice, and ends rather than guessing another engine.
func TestASpeakingJobFromBeforePhase22Ends(t *testing.T) {
	f := newFixture(t, &speech{available: true}, reply(script(10, "S1")))
	scripted(t, f)
	f.store.o.Status = audio.StatusSynthesizing
	payload, _ := json.Marshal(map[string]any{"overview_id": f.store.o.ID, "speak": true})
	err := f.svc.Handle(context.Background(), &jobs.Job{UserID: f.user, Kind: audio.JobKind, Payload: payload})
	var term *jobs.TerminalError
	if !errors.As(err, &term) || f.sp.calls != 0 {
		t.Fatalf("err %v, %d calls", err, f.sp.calls)
	}
}
