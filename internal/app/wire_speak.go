package app

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/speakapi"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/capabilities/speakcheck"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/media"
	"github.com/D0bby999/anytools/internal/providers/stt"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_speak.go assembles the read-aloud check (the private design notes, phase 2): the passage is checked against the stored page as a
// vocabulary selection is, and the take is heard on the learner's own stt
// route, or by the server's built-in engine on their daily allowance.

// speakWait is how long a check waits for the server's shared engine before
// it says the engine is busy, rather than hold the request.
const speakWait = 60 * time.Second

func buildSpeak(pool *pg.Pool, pages reading.PageLoader, byokSvc *byok.Service, engines config.EnginesConfig) *speakapi.Handler {
	ears := speakEars{byok: byokSvc}
	if engines.STTURL != "" {
		ears.builtin = newBuiltinSTT(pool, engines)
	}
	return speakapi.NewHandler(speakcheck.New(vocabPages{pages}, media.NewFFmpeg(engines.FFmpeg), ears, os.TempDir()))
}

// speakEars is speakcheck.Ears: the learner's own stt connections in route
// order, and only when they have none, the built-in engine.
type speakEars struct {
	byok    *byok.Service
	builtin *knowledge.BuiltinSTT
}

// Hear implements speakcheck.Ears.
func (e speakEars) Hear(ctx context.Context, userID uuid.UUID, path, mime, lang string, seconds int) (speakcheck.Heard, error) {
	chain, err := e.byok.STTFor(ctx, userID, uuid.Nil)
	if err != nil && !errors.Is(err, byok.ErrNoRoute) {
		return speakcheck.Heard{}, err
	}
	if chain != nil && chain.Len() > 0 {
		var heard speakcheck.Heard
		err := chain.Do(ctx, func(ctx context.Context, t stt.Transcriber, entry byok.Entry[stt.Transcriber]) error {
			f, err := os.Open(path)
			if err != nil {
				return errors.Join(byok.ErrStopChain, err)
			}
			defer f.Close()
			seg, err := t.Transcribe(ctx, f, mime, lang)
			if err != nil {
				return err
			}
			heard = speakcheck.Heard{Text: segmentText(seg), By: speakcheck.By{Kind: "own", Name: entry.Name}}
			return nil
		})
		if err != nil {
			slog.Warn("speakcheck: the learner's stt route failed", "error", err)
			return speakcheck.Heard{}, speakcheck.ErrEngine
		}
		return heard, nil
	}
	return e.hearBuiltin(ctx, userID, path, mime, lang, seconds)
}

func (e speakEars) hearBuiltin(ctx context.Context, userID uuid.UUID, path, mime, lang string, seconds int) (speakcheck.Heard, error) {
	b := e.builtin
	if b == nil || !b.Engine.Configured() || !b.Engine.Available(ctx) {
		return speakcheck.Heard{}, speakcheck.ErrNoEngine
	}
	zone, _ := b.Zone(ctx, userID)
	day := learning.LocalDay(time.Now(), zone).String()
	ok, err := b.Usage.Spend(ctx, userID, day, seconds, b.DailySeconds)
	if err != nil {
		return speakcheck.Heard{}, err
	}
	if !ok {
		return speakcheck.Heard{}, speakcheck.ErrQuota
	}
	refund := func() {
		if err := b.Usage.Refund(context.WithoutCancel(ctx), userID, day, seconds); err != nil {
			slog.Warn("speakcheck: could not refund built-in seconds", "error", err)
		}
	}
	f, err := os.Open(path)
	if err != nil {
		refund()
		return speakcheck.Heard{}, err
	}
	defer f.Close()
	wait, cancel := context.WithTimeout(ctx, speakWait)
	defer cancel()
	seg, err := stt.NewBuiltin(b.Engine, b.Model).Transcribe(wait, f, mime, lang)
	if err != nil {
		// Queued behind documents past speakWait, or down: either way the
		// learner can only try again later.
		refund()
		slog.Warn("speakcheck: the built-in engine did not answer", "error", err)
		return speakcheck.Heard{}, speakcheck.ErrBusy
	}
	return speakcheck.Heard{Text: segmentText(seg), By: speakcheck.By{Kind: "builtin"}}, nil
}

func segmentText(seg *stt.Segments) string {
	parts := make([]string, 0, len(seg.Segments))
	for _, s := range seg.Segments {
		parts = append(parts, strings.TrimSpace(s.Text))
	}
	return strings.Join(parts, " ")
}
