package learning

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// fsrs_test.go pins AnyTools' scheduling to RECORDED outputs of the library's
// Next(), for the four ratings, across the four card states.
//
// Red-team Assumption 9 is the reason it is written this way. The earlier plan
// proposed a property test asserting that a streak of correct answers always
// lengthens the interval. That is NOT an FSRS-6 invariant: `Hard` is a correct
// answer and can SHORTEN the interval, and the relearning path can return a
// card at ten minutes from a state where it was due in a month. A property test
// stating a false invariant does one of two things — it fails on correct code,
// or it is weakened until it asserts nothing. A fixture asserts the only thing
// that is actually true and actually useful: "this input produced this output,
// and if the number changes, a human decided it changed."
//
// Regenerate with:  go test ./internal/learning -update
//
// Regenerating is a code review event, not a chore. A diff in this file means
// every learner's future review dates moved.

var update = flag.Bool("update", false, "rewrite testdata/fsrs_next.json from the current library")

const fixturePath = "testdata/fsrs_next.json"

// base is a fixed, UTC, non-midnight instant. Non-midnight on purpose: FSRS
// works in whole days for review-state cards, and a midnight base hides
// same-day/next-day boundary mistakes behind an exact multiple of 24h.
var base = time.Date(2026, time.March, 4, 9, 30, 0, 0, time.UTC)

// scenario is one recorded case: a card reached by applying `setup` ratings
// from a new card at `base`, then graded with `Rating` at base+Elapsed.
type scenario struct {
	Name    string        `json:"name"`
	Setup   []setupStep   `json:"setup"`
	Elapsed time.Duration `json:"elapsed_ns"`
	Rating  string        `json:"rating"`

	// Recorded outputs.
	Want recorded `json:"want"`
}

type setupStep struct {
	Rating  string        `json:"rating"`
	Elapsed time.Duration `json:"elapsed_ns"`
}

// recorded is the part of the resulting Card this product depends on. Reps and
// the internal step counter are excluded deliberately: they are the library's
// bookkeeping, and pinning them would turn an internal refactor into a failing
// test about nothing a learner can see.
type recorded struct {
	DueOffset  time.Duration `json:"due_offset_ns"`
	State      string        `json:"state"`
	Stability  float64       `json:"stability"`
	Difficulty float64       `json:"difficulty"`
	Lapses     uint64        `json:"lapses"`
}

// cases enumerates the states an AnyTools card actually reaches. Every one of
// the four ratings appears in every state, which is the coverage phase-07 asks
// for ("fixture-driven table tests over recorded Next() outputs for the four
// ratings").
func cases() []scenario {
	day := 24 * time.Hour
	var out []scenario
	for _, rating := range []string{RatingAgain, RatingHard, RatingGood, RatingEasy} {
		out = append(out,
			// New — the state every knowledge point starts in.
			scenario{Name: "new/" + rating, Elapsed: 0, Rating: rating},
			// Learning — inside the 1m/10m steps.
			scenario{
				Name:    "learning/" + rating,
				Setup:   []setupStep{{Rating: RatingGood, Elapsed: 0}},
				Elapsed: 10 * time.Minute, Rating: rating,
			},
			// Review — graduated out of the learning steps.
			scenario{
				Name: "review/" + rating,
				Setup: []setupStep{
					{Rating: RatingGood, Elapsed: 0},
					{Rating: RatingGood, Elapsed: 10 * time.Minute},
					{Rating: RatingGood, Elapsed: 4 * day},
				},
				Elapsed: 12 * day, Rating: rating,
			},
			// Relearning — the state AC4's "due again the same day" lives in.
			scenario{
				Name: "relearning/" + rating,
				Setup: []setupStep{
					{Rating: RatingGood, Elapsed: 0},
					{Rating: RatingGood, Elapsed: 10 * time.Minute},
					{Rating: RatingGood, Elapsed: 4 * day},
					{Rating: RatingAgain, Elapsed: 12 * day},
				},
				Elapsed: 12*day + 10*time.Minute, Rating: rating,
			},
		)
	}
	return out
}

// run replays a scenario and returns what the library produced.
func run(t *testing.T, s *Scheduler, sc scenario) recorded {
	t.Helper()
	card := s.NewCard(base)
	for _, step := range sc.Setup {
		next, err := s.Next(card, base.Add(step.Elapsed), step.Rating)
		if err != nil {
			t.Fatalf("%s: setup %s at +%s: %v", sc.Name, step.Rating, step.Elapsed, err)
		}
		card = next
	}
	at := base.Add(sc.Elapsed)
	got, err := s.Next(card, at, sc.Rating)
	if err != nil {
		t.Fatalf("%s: next: %v", sc.Name, err)
	}
	return recorded{
		DueOffset:  got.Due.Sub(at),
		State:      got.State.String(),
		Stability:  got.Stability,
		Difficulty: got.Difficulty,
		Lapses:     got.Lapses,
	}
}

func TestFSRSNextMatchesRecordedFixtures(t *testing.T) {
	s := NewScheduler()

	if *update {
		recordFixtures(t, s)
		return
	}

	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixtures (regenerate with `go test ./internal/learning -update`): %v", err)
	}
	var want []scenario
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatalf("decode fixtures: %v", err)
	}

	byName := make(map[string]scenario, len(want))
	for _, sc := range want {
		byName[sc.Name] = sc
	}

	live := cases()
	if len(live) != len(want) {
		t.Fatalf("fixture count %d does not match the %d cases in this file; regenerate with -update",
			len(want), len(live))
	}

	for _, sc := range live {
		t.Run(sc.Name, func(t *testing.T) {
			fixture, ok := byName[sc.Name]
			if !ok {
				t.Fatalf("no recorded fixture for %q; regenerate with -update", sc.Name)
			}
			got := run(t, s, sc)
			if got != fixture.Want {
				t.Errorf("scheduling changed for %s\n  got  %+v\n  want %+v\n"+
					"If this is intended, regenerate with -update and say why in the commit: "+
					"every learner's review dates just moved.", sc.Name, got, fixture.Want)
			}
		})
	}
}

func recordFixtures(t *testing.T, s *Scheduler) {
	t.Helper()
	out := cases()
	for i := range out {
		out[i].Want = run(t, s, out[i])
	}
	if err := os.MkdirAll(filepath.Dir(fixturePath), 0o755); err != nil {
		t.Fatalf("mkdir testdata: %v", err)
	}
	blob, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatalf("encode fixtures: %v", err)
	}
	if err := os.WriteFile(fixturePath, append(blob, '\n'), 0o644); err != nil {
		t.Fatalf("write fixtures: %v", err)
	}
	t.Logf("recorded %d fixtures to %s", len(out), fixturePath)
}

// TestFailedCardComesBackTheSameDay is AC4's scheduling half, asserted directly
// rather than left implicit in the fixture numbers.
//
// It is the assertion red-team RT-12 asked for: a card that was comfortably in
// review, answered wrong, must be due again within the hour — which is why due
// is computed on read and why a nightly materializer with a 24-hour window
// cannot be the thing that surfaces it.
func TestFailedCardComesBackTheSameDay(t *testing.T) {
	s := NewScheduler()
	now := base

	card := s.NewCard(now)
	for _, step := range []struct {
		rating  string
		elapsed time.Duration
	}{
		{RatingGood, 0},
		{RatingGood, 10 * time.Minute},
		{RatingGood, 4 * 24 * time.Hour},
	} {
		next, err := s.Next(card, now.Add(step.elapsed), step.rating)
		if err != nil {
			t.Fatalf("setup: %v", err)
		}
		card = next
	}

	// Answer it on the day it actually came due — the realistic case, and the
	// one where "the next interval is days or weeks" is the expected outcome
	// for anything except a wrong answer.
	at := card.Due
	if at.Sub(now) < 7*24*time.Hour {
		t.Fatalf("precondition: three Goods should have pushed the card out at least a week, got %s", at.Sub(now))
	}

	failed, err := s.Next(card, at, RatingAgain)
	if err != nil {
		t.Fatalf("next(again): %v", err)
	}
	gap := failed.Due.Sub(at)
	if gap <= 0 || gap > time.Hour {
		t.Errorf("a failed knowledge point must be due again within the hour, got %s (due %s)",
			gap, failed.Due)
	}
	if failed.Lapses != 1 {
		t.Errorf("lapses = %d, want 1", failed.Lapses)
	}
}

func TestRatingForOutcome(t *testing.T) {
	for _, tc := range []struct {
		name    string
		correct bool
		attr    string
		want    string
	}{
		{"wrong is always again", false, AttrNone, RatingAgain},
		{"wrong stays again even when the learner blames a slip", false, AttrCareless, RatingAgain},
		{"wrong stays again when the learner says they were confident", false, AttrConfident, RatingAgain},
		{"right with nothing said is good", true, AttrNone, RatingGood},
		{"a correct guess is hard", true, AttrGuessed, RatingHard},
		{"right despite a slip is hard", true, AttrCareless, RatingHard},
		{"right despite misreading is hard", true, AttrMisread, RatingHard},
		{"right and confident is easy", true, AttrConfident, RatingEasy},
		{"a dispute says nothing about difficulty", true, AttrDisputed, RatingGood},
		{"a knowledge gap the learner still answered is good", true, AttrKnowledgeGap, RatingGood},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := RatingFor(tc.correct, tc.attr); got != tc.want {
				t.Errorf("RatingFor(%v, %q) = %q, want %q", tc.correct, tc.attr, got, tc.want)
			}
		})
	}
}

func TestRatingNamesRoundTrip(t *testing.T) {
	for _, name := range []string{RatingAgain, RatingHard, RatingGood, RatingEasy} {
		r, err := ParseRating(name)
		if err != nil {
			t.Fatalf("ParseRating(%q): %v", name, err)
		}
		if got := RatingName(r); got != name {
			t.Errorf("RatingName(ParseRating(%q)) = %q", name, got)
		}
	}
	if _, err := ParseRating("brilliant"); err == nil {
		t.Error("ParseRating accepted a rating outside the four")
	}
}

func TestMasteryEstimateTracksRecentCorrectness(t *testing.T) {
	// Three right answers from nothing clear the default 0.7 threshold...
	m := 0.0
	for i := 0; i < 3; i++ {
		m = MasteryEstimate(m, true)
	}
	if m < 0.7 {
		t.Errorf("three correct answers reached %.3f, which does not clear the 0.7 default threshold", m)
	}

	// ...and one wrong answer from mastered drops back below it, which is what
	// stops a graduated module from staying graduated through a lapse.
	dropped := MasteryEstimate(1.0, false)
	if dropped >= 0.7 {
		t.Errorf("one wrong answer from 1.0 left mastery at %.3f, still above the threshold", dropped)
	}

	if got := MasteryEstimate(0, false); got != 0 {
		t.Errorf("a wrong answer from zero should stay at zero, got %.3f", got)
	}
}
