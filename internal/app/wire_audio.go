package app

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/audioapi"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/capabilities/audio"
	"github.com/D0bby999/anytools/internal/providers/tts"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_audio.go wires the audio overview (learning depth, phase 10): its
// store, the same retrieval quiz uses, the learner's chat model for the
// script, and a job kind the knowledge workers run. Up-methods phase 22 adds
// who speaks it: the learner's `tts` route (an OpenAI key, their own
// OpenAI-compatible speech server) and, when ANYTOOLS_TTS_URL is set, the
// server's built-in Kokoro with its daily allowance and its own job kind,
// claimed by one dedicated worker so one built-in job runs at a time.
func buildAudio(pool *pg.Pool, kb knowledgeSubsystem, byokService *byok.Service) *audioapi.Handler {
	deps := audio.Deps{
		Store: pg.NewAudioStore(pool),
		Retriever: audioRetriever{inner: kbRetriever{
			retriever: kb.retriever, kbs: kb.service, providers: kb.providers,
		}},
		Reports: audioReports{pg.NewResearchStore(pool)},
		Models:  newChatResolver(byokService),
		Speech:  byokSpeech{byokService},
		Queue:   kb.queue,
		Files:   kb.objects,
	}
	if url := kb.engines.TTSURL; url != "" && kb.queue != nil {
		engine := tts.NewBuiltinEngine(url)
		users, queue := pg.NewUserStore(pool), kb.queue
		deps.Builtin = &audio.Builtin{
			Engine:       engine,
			Synth:        tts.NewBuiltin(engine),
			Usage:        pg.NewTTSUsage(pool),
			DailySeconds: kb.engines.TTSDailyMinutes * 60,
			Zone:         users.Timezone,
			Line: func(ctx context.Context) (int, error) {
				return queue.Waiting(ctx, audio.JobKindBuiltin)
			},
		}
		// The matrix says the server would speak for free, while it answers
		// its health check (byok/builtin.go).
		byokService.UseBuiltin(byok.FunctionTTS, byok.BuiltinEngine{
			Label: builtinVoicesLabel(), Available: engine.Available})
	}
	svc := audio.NewService(deps)
	kb.jobHandlers[audio.JobKind] = svc.Handle
	if kb.soloHandlers != nil {
		kb.soloHandlers[audio.JobKindBuiltin] = svc.Handle
	}
	return audioapi.NewHandler(svc)
}

// builtinVoicesLabel is the readiness row's sentence, counted from the voice
// table so it never claims a language the table has no pair for.
func builtinVoicesLabel() string {
	return fmt.Sprintf("Built-in voices (free, English and %d other languages, not Vietnamese)", audio.KokoroLanguages())
}

// audioRetriever is grounded chat's retrieval, narrowed to one knowledge base.
type audioRetriever struct{ inner kbRetriever }

func (r audioRetriever) Search(ctx context.Context, userID, kbID uuid.UUID, query string, limit int) ([]audio.Passage, error) {
	hits, err := r.inner.Search(ctx, userID, []uuid.UUID{kbID}, query, limit)
	if err != nil {
		return nil, err
	}
	out := make([]audio.Passage, 0, len(hits))
	for _, h := range hits {
		id, err1 := uuid.Parse(h.ID)
		docID, err2 := uuid.Parse(h.DocumentID)
		if err1 != nil || err2 != nil {
			return nil, fmt.Errorf("audio retrieval: malformed chunk id %q / %q", h.ID, h.DocumentID)
		}
		out = append(out, audio.Passage{ChunkID: id, DocumentID: docID, Title: h.DocumentTitle, Page: h.Page, Text: h.Text})
	}
	return out, nil
}

type audioReports struct{ store *pg.ResearchStore }

func (r audioReports) Report(ctx context.Context, userID, id uuid.UUID) (*audio.Report, error) {
	rep, err := r.store.GetReport(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return &audio.Report{Query: rep.Query, ReportMD: rep.ReportMD}, nil
}

// byokSpeech is the learner's `tts` route, narrowed to the one connection
// they chose: the same cooldown rules as every other function, but no
// fallback to another key the learner did not pick.
type byokSpeech struct{ svc *byok.Service }

func (s byokSpeech) Engines(ctx context.Context, userID uuid.UUID) ([]audio.SpeechEngine, error) {
	chain, err := s.svc.TTSFor(ctx, userID, uuid.Nil)
	if err != nil {
		return nil, err
	}
	out := make([]audio.SpeechEngine, 0, chain.Len())
	for _, e := range chain.Entries() {
		out = append(out, audio.SpeechEngine{ConnectionID: e.ConnectionID, Provider: e.Provider, Name: e.Name, Model: e.Client.Model()})
	}
	return out, nil
}

func (s byokSpeech) Speak(ctx context.Context, userID, connectionID uuid.UUID, turns []tts.Turn, voices []tts.Speaker, maxPCM int64) ([]byte, error) {
	if connectionID == uuid.Nil {
		return nil, audio.ErrNoSpeech
	}
	chain, err := s.svc.TTSFor(ctx, userID, connectionID)
	if err != nil {
		return nil, err
	}
	if chain.Len() == 0 {
		return nil, audio.ErrNoSpeech
	}
	var pcm []byte
	err = chain.Do(ctx, func(ctx context.Context, client tts.Synthesizer, _ byok.Entry[tts.Synthesizer]) error {
		out, err := client.Synthesize(ctx, turns, voices, maxPCM)
		pcm = out
		return err
	})
	if errors.Is(err, byok.ErrNoRoute) {
		return nil, audio.ErrNoSpeech
	}
	return pcm, err
}
