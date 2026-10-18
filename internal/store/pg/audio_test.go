package pg_test

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/audio"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// A job that gives up settles its overview in the same transaction: a script
// that was never written is a failure; a script whose speaking failed goes
// back to script_only, transcript kept, so "Speak it" can be tried again.
func TestAGaveUpAudioJobSettlesItsOverview(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)
	kb, err := pg.NewKnowledgeStore(pool).CreateKB(ctx, user, "Audio KB")
	if err != nil {
		t.Fatal(err)
	}
	store := pg.NewAudioStore(pool)
	create := func() *audio.Overview {
		o, err := store.Create(ctx, audio.Overview{UserID: user, KBID: &kb.ID, Minutes: 5, Status: audio.StatusScripting})
		if err != nil {
			t.Fatal(err)
		}
		return o
	}
	gaveUp := func(o *audio.Overview) {
		payload, _ := json.Marshal(map[string]any{"overview_id": o.ID})
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		if err := pg.AudioReapHandler()(ctx, tx, jobs.ReapedJob{
			ID: uuid.New(), UserID: user, Kind: audio.JobKind, Payload: payload, Terminal: true,
		}); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}

	scripting := create()
	gaveUp(scripting)
	if got, _ := store.Get(ctx, user, scripting.ID); got.Status != audio.StatusFailed || got.Error == "" {
		t.Fatalf("a scripting job that gave up: %+v", got)
	}

	speaking := create()
	script := audio.Script{Title: "t", Segments: []audio.Segment{{Speaker: "host", Text: "hi"}}}
	if err := store.SaveScript(ctx, user, speaking.ID, script, nil, nil, "en", audio.StatusScriptOnly, 1); err != nil {
		t.Fatal(err)
	}
	by := audio.SpokenBy{Engine: "builtin", Model: "kokoro", Voices: audio.VoicePair{Host: "af_heart", Expert: "am_michael"}}
	if ok, err := store.StartSpeaking(ctx, user, speaking.ID, by); err != nil || !ok {
		t.Fatalf("StartSpeaking = %v, %v", ok, err)
	}
	if ok, _ := store.StartSpeaking(ctx, user, speaking.ID, by); ok {
		t.Fatal("StartSpeaking twice")
	}
	if got, _ := store.Get(ctx, user, speaking.ID); got.TTSEngine != "builtin" || got.TTSModel != "kokoro" ||
		got.TTSVoices == nil || *got.TTSVoices != by.Voices {
		t.Fatalf("who speaks it: %+v", got)
	}
	gaveUp(speaking)
	got, _ := store.Get(ctx, user, speaking.ID)
	if got.Status != audio.StatusScriptOnly || got.Script == nil {
		t.Fatalf("a speaking job that gave up: %+v", got)
	}
	// Another user's id settles nothing.
	if _, err := store.Get(ctx, uuid.New(), speaking.ID); err == nil {
		t.Fatal("another user read the overview")
	}
}

// The list carries each overview's script: the page renders the transcript
// and player from it without a second request per row.
func TestTheOverviewListCarriesScripts(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)
	kb, err := pg.NewKnowledgeStore(pool).CreateKB(ctx, user, "List KB")
	if err != nil {
		t.Fatal(err)
	}
	store := pg.NewAudioStore(pool)
	o, err := store.Create(ctx, audio.Overview{UserID: user, KBID: &kb.ID, Minutes: 5, Status: audio.StatusScripting})
	if err != nil {
		t.Fatal(err)
	}
	script := audio.Script{Title: "t", Segments: []audio.Segment{{Speaker: "host", Text: "hi"}}}
	if err := store.SaveScript(ctx, user, o.ID, script, nil, nil, "en", audio.StatusScriptOnly, 1); err != nil {
		t.Fatal(err)
	}
	list, err := store.List(ctx, user, &kb.ID, nil)
	if err != nil || len(list) != 1 || list[0].Script == nil || len(list[0].Script.Segments) != 1 {
		t.Fatalf("list = %+v, %v", list, err)
	}
	if other, _ := store.List(ctx, uuid.New(), &kb.ID, nil); len(other) != 0 {
		t.Fatalf("another user listed %d overviews", len(other))
	}
}

// Up-methods phase 22: a built-in speaking job that gives up gives back the
// booked seconds of the chunks it never spoke, in its final transaction.
func TestAGaveUpBuiltinSpeakingJobRefundsWhatItDidNotSpeak(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)
	usage := pg.NewTTSUsage(pool)
	const day = "2026-10-16"
	if ok, err := usage.Spend(ctx, user, day, 400, 3600); err != nil || !ok {
		t.Fatalf("book: %v %v", ok, err)
	}
	queue := jobs.NewQueue(pool, 0)
	jobID, err := queue.Enqueue(ctx, user, audio.JobKindBuiltin,
		map[string]any{"overview_id": uuid.New(), "speak": true, "engine": "builtin", "charged_day": day, "charged_seconds": 400}, 2)
	if err != nil {
		t.Fatal(err)
	}
	// One chunk of four was spoken.
	if _, err := pool.Exec(ctx, `UPDATE jobs SET progress = '{"done":1,"total":4}' WHERE id = $1`, jobID); err != nil {
		t.Fatal(err)
	}
	var payload []byte
	if err := pool.QueryRow(ctx, `SELECT payload FROM jobs WHERE id = $1`, jobID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	reap := func(kind string) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		if err := pg.AudioReapHandler()(ctx, tx, jobs.ReapedJob{ID: jobID, UserID: user, Kind: kind, Payload: payload, Terminal: true}); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	reap(audio.JobKindBuiltin)
	if spent, _ := usage.Spent(ctx, user, day); spent != 100 {
		t.Fatalf("after the refund %d seconds are spent; want the one chunk of four (100)", spent)
	}
	// A key's job books nothing and gives nothing back.
	reap(audio.JobKind)
	if spent, _ := usage.Spent(ctx, user, day); spent != 100 {
		t.Fatalf("a byok job refunded built-in speech: %d", spent)
	}
}

// The migration removes the tts routes that point at Gemini (nothing serves
// them now) and nothing else; finished overviews are untouched.
func TestTheKokoroMigrationRemovesGeminiSpeechRoutesOnly(t *testing.T) {
	ctx := context.Background()
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)
	key := testutil.TestEncryptionKey
	conns := pg.NewProviderConnectionStore(pool, key)
	mk := func(provider string) uuid.UUID {
		c, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
			Provider: provider, Kind: store.KindAPIKey, Name: provider + "-" + uuid.NewString()[:6], Secret: "k"})
		if err != nil {
			t.Fatal(err)
		}
		return c.ID
	}
	gemini, openai := mk("gemini"), mk("openai")
	routes := pg.NewFunctionRouteStore(pool, key)
	// Rows as phase 10 left them: a Gemini key speaking, and the same key
	// parsing, which stays.
	if _, err := pool.Exec(ctx, `INSERT INTO function_routes (user_id, "function", position, connection_id, model)
		VALUES ($1, 'tts', 0, $2, 'gemini-3.8-flash-tts'), ($1, 'tts', 1, $3, 'tts-1'), ($1, 'parse', 0, $2, '')`,
		user, gemini, openai); err != nil {
		t.Fatal(err)
	}
	kb, err := pg.NewKnowledgeStore(pool).CreateKB(ctx, user, "Spoken KB")
	if err != nil {
		t.Fatal(err)
	}
	overviews := pg.NewAudioStore(pool)
	ov, err := overviews.Create(ctx, audio.Overview{UserID: user, KBID: &kb.ID, Minutes: 5, Status: audio.StatusScripting})
	if err != nil {
		t.Fatal(err)
	}
	if err := overviews.Ready(ctx, user, ov.ID, 4844, 0.1); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile("../../../migrations/1790012000_tts_kokoro.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	step, _, ok := strings.Cut(string(raw), "-- Who spoke each overview.")
	if !ok {
		t.Fatal("the migration's route step is no longer marked")
	}
	if _, err := pool.Exec(ctx, step); err != nil {
		t.Fatal(err)
	}

	tts, err := routes.ChainFor(ctx, user, "tts")
	if err != nil || len(tts) != 1 || tts[0].Connection.ID != openai {
		t.Fatalf("tts route after the migration: %+v %v", tts, err)
	}
	if parse, _ := routes.ChainFor(ctx, user, "parse"); len(parse) != 1 {
		t.Fatalf("the Gemini key's parse route went too: %+v", parse)
	}
	got, err := overviews.Get(ctx, user, ov.ID)
	if err != nil || got.Status != audio.StatusReady || got.AudioBytes != 4844 || got.TTSEngine != "" || got.TTSVoices != nil {
		t.Fatalf("a finished overview after the migration: %+v %v", got, err)
	}
}
