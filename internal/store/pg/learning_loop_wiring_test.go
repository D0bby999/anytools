package pg

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// Red team SF-2: an evidence kind is wired at four points — targetQuery,
// byIDFilter, windowFilter and an OwnsTarget case. A kind missing its window
// filter makes Candidates build "… AND " with nothing after it, and the
// week's suggestions fail for everyone; a kind missing its OwnsTarget case
// fails closed forever. Every kind in EvidenceKinds() has all four.
func TestEveryEvidenceKindIsFullyWired(t *testing.T) {
	// A pool that never connects: OwnsTarget reaches the database only for a
	// kind it has a case for, and a cancelled context makes that reach an
	// error. The default branch answers (false, nil) without asking.
	pool, err := pgxpool.New(context.Background(), "postgres://wiring.invalid:5432/none?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := NewLoopStore(pool)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	for _, kind := range loop.EvidenceKinds() {
		if q := targetQuery[kind]; !strings.Contains(q, "{{where}}") {
			t.Errorf("%s: no targetQuery with a {{where}} placeholder", kind)
		}
		if strings.TrimSpace(byIDFilter[kind]) == "" {
			t.Errorf("%s: no byIDFilter", kind)
		}
		if strings.TrimSpace(windowFilter[kind]) == "" {
			t.Errorf("%s: no windowFilter", kind)
		}
		if _, err := store.OwnsTarget(ctx, uuid.New(), kind, uuid.New()); err == nil {
			t.Errorf("%s: no OwnsTarget case (it answered without asking the database)", kind)
		}
		if strings.Contains(windowFilter[kind], "$4") != stateScoped[kind] {
			t.Errorf("%s: its window filter names the state ($4) but Candidates does not pass it, or the reverse", kind)
		}
	}
	// And nothing is wired for a kind the CHECK does not allow.
	legal := map[string]bool{}
	for _, k := range loop.EvidenceKinds() {
		legal[k] = true
	}
	for kind := range targetQuery {
		if !legal[kind] {
			t.Errorf("targetQuery has %s, which is not an evidence kind", kind)
		}
	}

	// The worksheet kind's every reader excludes private worksheets.
	for name, sql := range map[string]string{
		"targetQuery": targetQuery[loop.KindWorksheet], "byIDFilter": byIDFilter[loop.KindWorksheet],
		"windowFilter": windowFilter[loop.KindWorksheet],
	} {
		if !strings.Contains(sql, "NOT w.private") {
			t.Errorf("worksheet %s does not exclude private worksheets: %s", name, sql)
		}
	}
}
