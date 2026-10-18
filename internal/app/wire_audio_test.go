package app

import (
	"testing"

	"github.com/D0bby999/anytools/internal/capabilities/audio"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Up-methods phase 22: one built-in speaking job at a time. Its kind is a
// solo kind (one dedicated worker in buildKnowledge's start), never on the
// shared workers, which would run as many at once as ANYTOOLS_JOB_WORKERS.
func TestTheBuiltinVoicesRunOneJobAtATime(t *testing.T) {
	pool := testutil.TestDB(t)
	byokSvc, err := buildBYOK(pool, testutil.TestEncryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	kb := knowledgeSubsystem{
		queue: jobs.NewQueue(pool, 0), jobHandlers: map[string]jobs.Handler{}, soloHandlers: map[string]jobs.Handler{},
		engines: config.EnginesConfig{TTSURL: "http://tts:8880", TTSDailyMinutes: 60},
	}
	buildAudio(pool, kb, byokSvc)
	if _, shared := kb.jobHandlers[audio.JobKindBuiltin]; shared {
		t.Fatal("the built-in speaking kind runs on the shared workers")
	}
	if _, solo := kb.soloHandlers[audio.JobKindBuiltin]; !solo {
		t.Fatal("the built-in speaking kind has no worker of its own")
	}
	if _, ok := kb.jobHandlers[audio.JobKind]; !ok {
		t.Fatal("the script and key jobs lost their handler")
	}
	if got := builtinVoicesLabel(); got != "Built-in voices (free, English and 6 other languages, not Vietnamese)" {
		t.Fatalf("readiness label %q", got)
	}
}
