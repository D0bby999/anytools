package learning

import (
	"math/rand/v2"
	"testing"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v4"
)

// fsrs_options_test.go covers NewSchedulerWith, the vocabulary scheduler's
// parameters. The mastery scheduler's behaviour is pinned by fsrs_test.go's
// recorded fixtures, which this file does not touch.

func vocabScheduler(seed uint64) *Scheduler {
	return NewSchedulerWith(Options{
		Fuzz: true, MaxIntervalDays: 365,
		Rand:  rand.New(rand.NewPCG(seed, seed+1)),
		Steps: []time.Duration{10 * time.Minute},
	})
}

// reviewCard walks a new card to the review state with a few Good ratings a
// few days apart, returning the card and the time of its last review.
func reviewCard(t *testing.T, s *Scheduler) (Card, time.Time) {
	t.Helper()
	now := base
	card := s.NewCard(now)
	for i := 0; i < 4; i++ {
		next, err := s.Next(card, now, RatingGood)
		if err != nil {
			t.Fatal(err)
		}
		card = next
		now = card.Due
	}
	return card, now
}

func TestVocabFuzzIsDeterministicWithASeededSource(t *testing.T) {
	a, _ := reviewCard(t, vocabScheduler(7))
	b, _ := reviewCard(t, vocabScheduler(7))
	if !a.Due.Equal(b.Due) || a.ScheduledDays != b.ScheduledDays {
		t.Fatalf("same seed, different schedules: %v/%d vs %v/%d", a.Due, a.ScheduledDays, b.Due, b.ScheduledDays)
	}
}

func TestVocabFuzzSpreadsCardsAddedTogether(t *testing.T) {
	s := vocabScheduler(42)
	plain := NewSchedulerWith(Options{MaxIntervalDays: 365, Steps: []time.Duration{10 * time.Minute}})

	want, at := reviewCard(t, plain)
	days := map[uint64]bool{}
	for i := 0; i < 40; i++ {
		// The same card state, reviewed at the same instant: without fuzz
		// every one lands on the same day.
		card, _ := reviewCard(t, plain)
		next, err := s.Next(card, at, RatingGood)
		if err != nil {
			t.Fatal(err)
		}
		days[next.ScheduledDays] = true
	}
	unfuzzed, err := plain.Next(want, at, RatingGood)
	if err != nil {
		t.Fatal(err)
	}
	if unfuzzed.ScheduledDays < 3 {
		t.Fatalf("the fixture card's interval is %d days; too short to fuzz", unfuzzed.ScheduledDays)
	}
	if len(days) < 2 {
		t.Fatalf("40 identical cards all fell due %v days out; fuzz is not applied", days)
	}
	iv := float64(unfuzzed.ScheduledDays)
	for d := range days {
		if float64(d) < iv*0.8-1 || float64(d) > iv*1.2+1 {
			t.Errorf("fuzzed interval %d is outside the library's range around %v", d, iv)
		}
	}
}

func TestVocabMaximumIntervalIs365Days(t *testing.T) {
	s := vocabScheduler(3)
	now := base
	card := s.NewCard(now)
	for i := 0; i < 20; i++ {
		next, err := s.Next(card, now, RatingEasy)
		if err != nil {
			t.Fatal(err)
		}
		if next.ScheduledDays > 365 {
			t.Fatalf("review %d scheduled %d days out, past the 365-day cap", i, next.ScheduledDays)
		}
		if next.Due.Sub(now) > 365*24*time.Hour+time.Minute {
			t.Fatalf("review %d due %v out, past the cap", i, next.Due.Sub(now))
		}
		card, now = next, next.Due
	}
	if card.ScheduledDays < 300 {
		t.Fatalf("twenty Easy reviews reached only %d days; the cap was never tested", card.ScheduledDays)
	}
}

func TestVocabUsesOneTenMinuteStep(t *testing.T) {
	s := vocabScheduler(1)
	card := s.NewCard(base)
	again, err := s.Next(card, base, RatingAgain)
	if err != nil {
		t.Fatal(err)
	}
	if got := again.Due.Sub(base); got != 10*time.Minute {
		t.Fatalf("Again on a new card is due in %v, want the single 10m step", got)
	}
	// Good on a card with one step graduates it on the step after.
	good, err := s.Next(again, again.Due, RatingGood)
	if err != nil {
		t.Fatal(err)
	}
	if good.State != fsrs.Review {
		t.Fatalf("Good after the only step left the card in %v", good.State)
	}
}

// The mastery scheduler must not fuzz: same input, same output, every time.
func TestMasterySchedulerHasNoFuzz(t *testing.T) {
	s := NewScheduler()
	if s.fuzz != nil {
		t.Fatal("NewScheduler has a fuzz source")
	}
	a, _ := reviewCard(t, s)
	b, _ := reviewCard(t, NewScheduler())
	if !a.Due.Equal(b.Due) {
		t.Fatalf("mastery schedules differ: %v vs %v", a.Due, b.Due)
	}
}

func TestFuzzIntervalLeavesShortIntervalsAlone(t *testing.T) {
	if got := fuzzInterval(2, 0, 365, 0.99); got != 2 {
		t.Fatalf("a 2-day interval was fuzzed to %v", got)
	}
	if got := fuzzInterval(400, 0, 365, 0.99); got > 365 {
		t.Fatalf("fuzz went past the maximum: %v", got)
	}
}

// The cap holds without fuzz too: go-fsrs keeps Easy a day past Good and can
// step over its own MaximumInterval.
func TestMaximumIntervalHoldsWithoutFuzz(t *testing.T) {
	s := NewSchedulerWith(Options{MaxIntervalDays: 365})
	now := base
	card := s.NewCard(now)
	for i := 0; i < 20; i++ {
		next, err := s.Next(card, now, RatingEasy)
		if err != nil {
			t.Fatal(err)
		}
		if next.ScheduledDays > 365 {
			t.Fatalf("review %d scheduled %d days out", i, next.ScheduledDays)
		}
		card, now = next, next.Due
	}
}
