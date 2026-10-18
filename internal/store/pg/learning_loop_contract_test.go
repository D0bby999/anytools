package pg_test

import (
	"strings"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// TestMinimumContractRoundTrips: the three answers are written together, read
// back on every path that scans a state, and left alone by a patch that does
// not name them.
func TestMinimumContractRoundTrips(t *testing.T) {
	ctx, f := newLoopFixture(t)
	st, _ := f.start(t, ctx, f.alice, time.Now().UTC())
	if st.MinimumContract != (loop.MinimumContract{}) {
		t.Fatalf("a new state's contract = %+v, want empty", st.MinimumContract)
	}

	want := loop.MinimumContract{
		DownshiftWhen:     "Under five hours of sleep",
		StillWorthKeeping: "Read one headline aloud",
		AskForHelpWhen:    "Two bad weeks in a row",
	}
	up, err := f.store.UpdateState(ctx, f.alice, st.ID, loop.StatePatch{MinimumContract: &want})
	if err != nil || up.MinimumContract != want {
		t.Fatalf("UpdateState contract = %+v, %v", up, err)
	}
	next := "Twelve words"
	up, err = f.store.UpdateState(ctx, f.alice, st.ID, loop.StatePatch{NextTask: &next})
	if err != nil || up.MinimumContract != want {
		t.Fatalf("a patch without the contract changed it: %+v, %v", up.MinimumContract, err)
	}
	got, err := f.store.GetState(ctx, f.alice, st.ID)
	if err != nil || got.MinimumContract != want {
		t.Fatalf("GetState contract = %+v, %v", got, err)
	}
	list, err := f.store.ListStates(ctx, f.alice)
	if err != nil || len(list) != 1 || list[0].MinimumContract != want {
		t.Fatalf("ListStates contract = %+v, %v", list, err)
	}
	if _, err := f.store.UpdateState(ctx, f.bob, st.ID, loop.StatePatch{MinimumContract: &loop.MinimumContract{}}); err == nil {
		t.Fatal("bob rewrote alice's contract")
	}

	// The column's CHECK is the backstop behind Go's limit: shape and size.
	if _, err := f.pool.Exec(ctx, `UPDATE learning_states SET minimum_contract = '[]' WHERE id = $1`, st.ID); err == nil {
		t.Error("a non-object contract was stored")
	}
	if _, err := f.pool.Exec(ctx, `UPDATE learning_states SET minimum_contract = jsonb_build_object('downshift_when', $2::text) WHERE id = $1`,
		st.ID, strings.Repeat("x", 33000)); err == nil {
		t.Error("an oversized contract was stored")
	}
}

// TestRecentInterruptionsSpanCyclesAndAreScoped: the newest first, across the
// state's cycles, bounded by n, and nothing for another user.
func TestRecentInterruptionsSpanCyclesAndAreScoped(t *testing.T) {
	ctx, f := newLoopFixture(t)
	start := time.Now().UTC().Add(-48 * time.Hour)
	st, _ := f.start(t, ctx, f.alice, start)
	record := func(fact, resistance string, at time.Time) {
		t.Helper()
		if _, _, err := f.store.RecordInterruption(ctx, f.alice, st.ID, "x", "x", loop.Interruption{
			At: at, Fact: fact, Resistance: resistance, ReducedTo: "x", Within24h: "y",
		}); err != nil {
			t.Fatalf("RecordInterruption: %v", err)
		}
	}
	record("first", loop.ResistanceTime, start.Add(time.Hour))
	record("second", loop.ResistanceEnergy, start.Add(2*time.Hour))
	if _, err := f.store.CreateCycle(ctx, f.alice, st.ID, start.Add(24*time.Hour)); err != nil {
		t.Fatalf("CreateCycle: %v", err)
	}
	// A whole second and a fraction: Go writes these as different-length
	// strings, which must still order as times.
	record("third", loop.ResistanceEnergy, start.Add(25*time.Hour))
	record("fourth", loop.ResistanceEnergy, start.Add(25*time.Hour+500*time.Millisecond))

	got, err := f.store.RecentInterruptions(ctx, f.alice, st.ID, loop.RepeatAfter)
	if err != nil {
		t.Fatalf("RecentInterruptions: %v", err)
	}
	var facts []string
	for _, it := range got {
		facts = append(facts, it.Fact)
	}
	if strings.Join(facts, ",") != "fourth,third,second" {
		t.Fatalf("recent = %v, want fourth,third,second", facts)
	}
	if r := loop.RepeatedResistance(got); r != loop.ResistanceEnergy {
		t.Fatalf("RepeatedResistance = %q, want energy", r)
	}
	if other, err := f.store.RecentInterruptions(ctx, f.bob, st.ID, 10); err != nil || len(other) != 0 {
		t.Fatalf("bob reads alice's interruptions: %v, %v", other, err)
	}
}

// TestAnInterruptionWrittenBeforePhase13StillReads: an old entry has a note and
// no fact, and decodes as such.
func TestAnInterruptionWrittenBeforePhase13StillReads(t *testing.T) {
	ctx, f := newLoopFixture(t)
	st, c := f.start(t, ctx, f.alice, time.Now().UTC())
	if _, err := f.pool.Exec(ctx, `UPDATE cycles SET interruptions = $2::jsonb WHERE id = $1`, c.ID,
		`[{"at":"2026-09-01T08:00:00Z","note":"Sick","prior_task":"Ten words"}]`); err != nil {
		t.Fatalf("seed old entry: %v", err)
	}
	cyc, err := f.store.CurrentCycle(ctx, f.alice, st.ID)
	if err != nil || len(cyc.Interruptions) != 1 {
		t.Fatalf("CurrentCycle = %+v, %v", cyc, err)
	}
	if it := cyc.Interruptions[0]; it.Note != "Sick" || it.Fact != "" || it.PriorTask != "Ten words" {
		t.Fatalf("old entry = %+v", it)
	}
	recent, err := f.store.RecentInterruptions(ctx, f.alice, st.ID, loop.RepeatAfter)
	if err != nil || len(recent) != 1 || recent[0].Note != "Sick" {
		t.Fatalf("RecentInterruptions over an old entry = %+v, %v", recent, err)
	}
}
