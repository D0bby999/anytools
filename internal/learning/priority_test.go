package learning

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

var (
	now = time.Date(2026, time.March, 4, 9, 30, 0, 0, time.UTC)

	// Fixed ids so the deterministic tie-break is testable: kpA < kpB as
	// strings, which is the order Rank falls back to.
	kpA = uuid.MustParse("11111111-1111-4111-8111-111111111111")
	kpB = uuid.MustParse("22222222-2222-4222-8222-222222222222")
	kpC = uuid.MustParse("33333333-3333-4333-8333-333333333333")

	modOne = uuid.MustParse("aaaaaaaa-0000-4000-8000-000000000001")
	modTwo = uuid.MustParse("aaaaaaaa-0000-4000-8000-000000000002")
)

func TestRankServesDueReviewsBeforeAnythingElse(t *testing.T) {
	// A very weak point in a very weak module, not yet due...
	weak := Candidate{
		KPID: kpA, Type: TypeConcept, ModuleID: modTwo, ModuleOrd: 1,
		ModuleMastery: 0.05, MasteryEstimate: 0.0, DueAt: now.Add(48 * time.Hour),
	}
	// ...loses to a nearly-mastered point in a nearly-mastered module that is
	// due. Forgetting in progress beats a gap that is merely known about.
	due := Candidate{
		KPID: kpB, Type: TypeDesign, ModuleID: modOne, ModuleOrd: 0,
		ModuleMastery: 0.95, MasteryEstimate: 0.95, DueAt: now.Add(-time.Minute),
	}

	got, ok := Select([]Candidate{weak, due}, now)
	if !ok {
		t.Fatal("Select found nothing to serve")
	}
	if got.KPID != kpB {
		t.Errorf("served %s, want the due review %s", got.KPID, kpB)
	}
}

func TestRankServesTheOldestDueFirst(t *testing.T) {
	recent := Candidate{KPID: kpA, Type: TypeMemory, DueAt: now.Add(-time.Minute)}
	stale := Candidate{KPID: kpB, Type: TypeDesign, DueAt: now.Add(-72 * time.Hour)}

	got, _ := Select([]Candidate{recent, stale}, now)
	if got.KPID != kpB {
		t.Errorf("served %s, want the card that has been waiting three days (%s)", got.KPID, kpB)
	}
}

func TestRankBreaksADueTieByKnowledgeType(t *testing.T) {
	at := now.Add(-time.Hour)
	design := Candidate{KPID: kpA, Type: TypeDesign, DueAt: at}
	fact := Candidate{KPID: kpB, Type: TypeMemory, DueAt: at}

	got, _ := Select([]Candidate{design, fact}, now)
	if got.KPID != kpB {
		t.Errorf("served %s, want the memory point %s — a forgotten fact decays fastest", got.KPID, kpB)
	}
}

func TestACardDueExactlyNowCounts(t *testing.T) {
	exact := Candidate{KPID: kpA, Type: TypeConcept, DueAt: now}
	if !exact.IsDue(now) {
		t.Error("a card due at exactly now is not due — it would be invisible until the next poll")
	}
}

func TestRankFallsBackToTheWeakestModule(t *testing.T) {
	// Nothing is due, so the session is teaching. The weakest module leads
	// even though its point is individually stronger than one in a module
	// that is doing better overall.
	strongModuleWeakPoint := Candidate{
		KPID: kpA, Type: TypeMemory, ModuleID: modOne, ModuleOrd: 0,
		ModuleMastery: 0.9, MasteryEstimate: 0.1, DueAt: now.Add(time.Hour),
	}
	weakModule := Candidate{
		KPID: kpB, Type: TypeDesign, ModuleID: modTwo, ModuleOrd: 1,
		ModuleMastery: 0.2, MasteryEstimate: 0.4, DueAt: now.Add(time.Hour),
	}

	got, _ := Select([]Candidate{strongModuleWeakPoint, weakModule}, now)
	if got.KPID != kpB {
		t.Errorf("served %s, want the weakest module's point %s", got.KPID, kpB)
	}
}

func TestRankIsDeterministic(t *testing.T) {
	// Three candidates that are identical in every ordering field. A session
	// that reshuffled these on every refresh would look to a learner exactly
	// like a system that had lost their place.
	same := func(id uuid.UUID) Candidate {
		return Candidate{KPID: id, Type: TypeConcept, ModuleID: modOne, DueAt: now.Add(time.Hour)}
	}
	in := []Candidate{same(kpC), same(kpA), same(kpB)}

	first := Rank(in, now)
	for i := 0; i < 5; i++ {
		again := Rank(in, now)
		for j := range first {
			if first[j].KPID != again[j].KPID {
				t.Fatalf("Rank is not stable: position %d was %s, then %s", j, first[j].KPID, again[j].KPID)
			}
		}
	}
	if first[0].KPID != kpA {
		t.Errorf("deterministic tie-break put %s first, want %s", first[0].KPID, kpA)
	}
}

func TestRankDoesNotMutateItsInput(t *testing.T) {
	in := []Candidate{
		{KPID: kpC, DueAt: now.Add(time.Hour)},
		{KPID: kpA, DueAt: now.Add(-time.Hour)},
	}
	_ = Rank(in, now)
	if in[0].KPID != kpC {
		t.Error("Rank sorted its argument in place; a caller holding the slice would see it change")
	}
}

func TestSelectOnAnEmptyQueue(t *testing.T) {
	if _, ok := Select(nil, now); ok {
		t.Error("Select reported something to serve from an empty queue")
	}
}

func TestGraduationNeedsBothHalves(t *testing.T) {
	for _, tc := range []struct {
		name      string
		mastery   float64
		threshold float64
		due       int
		want      bool
	}{
		{"mastered and nothing waiting", 0.8, 0.7, 0, true},
		{"exactly at the threshold", 0.7, 0.7, 0, true},
		{"mastered but a card is overdue", 0.95, 0.7, 1, false},
		{"nothing due but not yet mastered", 0.5, 0.7, 0, false},
		{"a module with a higher bar", 0.8, 0.9, 0, false},
		{"a zero threshold falls back to the default", 0.8, 0, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := Graduated(tc.mastery, tc.threshold, tc.due); got != tc.want {
				t.Errorf("Graduated(%.2f, %.2f, %d) = %v, want %v",
					tc.mastery, tc.threshold, tc.due, got, tc.want)
			}
		})
	}
}

func TestModuleMasteryOfAnEmptyModule(t *testing.T) {
	if got := ModuleMastery(nil); got != 0 {
		t.Errorf("an empty module reported mastery %.2f; it would graduate on its first day", got)
	}
	if got := ModuleMastery([]float64{0.5, 1.0}); got != 0.75 {
		t.Errorf("ModuleMastery([0.5, 1.0]) = %.3f, want 0.75", got)
	}
}
