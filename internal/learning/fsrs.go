// Package learning owns the scheduling half of the mastery path: when a
// knowledge point comes back, in what order the session serves what is waiting,
// and the nightly digest that tells a person what is due.
//
// It is deliberately separate from `internal/capabilities/mastery`. Everything
// here is a pure function of a card, a clock and a rating; nothing here reaches
// a database, a model or an HTTP request. That is what makes the FSRS fixture
// tests possible — a recorded `Next()` output is only a fixture if the code
// producing it has no other inputs.
package learning

import (
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"sync"
	"time"

	fsrs "github.com/open-spaced-repetition/go-fsrs/v4"
)

// Card is the FSRS card as stored in `kp_state.fsrs_card`.
//
// It is an ALIAS, not a wrapper. The library owns this shape — FSRS-6 carries
// 21 weights and a card with stability, difficulty, state and a step counter —
// and a struct here that mirrored it would be wrong the first time the library
// added a field, silently, at the point where the jsonb round-trip dropped it.
// What AnyTools owns is `due_at`, the copy of Card.Due that queries can index.
type Card = fsrs.Card

// Rating is the FSRS grade. AnyTools stores its NAME (see RatingName) rather
// than the integer, because `question_attempts.rating` is read by people in the
// bank UI and by SQL in the digest, and `2` is not a thing either can check.
type Rating = fsrs.Rating

// The four rating names, exactly as `question_attempts.rating` CHECKs them.
const (
	RatingAgain = "again"
	RatingHard  = "hard"
	RatingGood  = "good"
	RatingEasy  = "easy"
)

// Self-attribution values, exactly as the migration CHECKs them.
//
// AttrDisputed is the one that is not about the learner's own state: it records
// that the person overrode the judge's verdict. It lives in the same column
// because both are the same act — the learner telling the system something it
// could not see — and because an override must be visible everywhere an
// attempt is, not in a side table nobody joins.
const (
	AttrNone         = ""
	AttrConfident    = "confident"
	AttrGuessed      = "guessed"
	AttrCareless     = "careless"
	AttrMisread      = "misread"
	AttrKnowledgeGap = "knowledge_gap"
	AttrDisputed     = "disputed"
)

// Error types, exactly as the migration CHECKs them.
const (
	ErrTypeNone        = ""
	ErrTypeConcept     = "concept"
	ErrTypeRecall      = "recall"
	ErrTypeApplication = "application"
	ErrTypeCareless    = "careless"
	ErrTypeMisread     = "misread"
	ErrTypeUnknown     = "unknown"
)

// ValidAttribution reports whether s is a self-attribution the database accepts.
// Handlers check it so a bad value is a 400 with a sentence rather than a
// constraint violation surfacing as a 500.
func ValidAttribution(s string) bool {
	switch s {
	case AttrNone, AttrConfident, AttrGuessed, AttrCareless, AttrMisread, AttrKnowledgeGap, AttrDisputed:
		return true
	}
	return false
}

// ValidErrorType reports whether s is an error type the database accepts.
func ValidErrorType(s string) bool {
	switch s {
	case ErrTypeNone, ErrTypeConcept, ErrTypeRecall, ErrTypeApplication,
		ErrTypeCareless, ErrTypeMisread, ErrTypeUnknown:
		return true
	}
	return false
}

// RatingFor maps an attempt's OUTCOME onto an FSRS grade.
//
// FSRS asks a question AnyTools' UI never does — "how hard was that?" — and
// answering it with a four-button prompt after every question is the fastest
// way to make a person stop using a study tool. So the grade is derived, and
// the only extra thing the product asks for is the self-attribution it already
// needs for the error record.
//
// The mapping, and why each line is where it is:
//
//   - wrong → Again, always. A wrong answer is a lapse regardless of what the
//     learner says about it; "careless" is a reason, not an exemption, and
//     treating it as one is how a product teaches someone to explain away the
//     thing they got wrong.
//   - right but guessed → Hard. A correct guess is evidence of luck, and Hard
//     is FSRS's "you got there, but not comfortably" — a shorter interval than
//     Good, which is the honest schedule for it.
//   - right but careless or misread → Hard. The answer landed despite a slip;
//     the slip is worth seeing again sooner.
//   - right and confident → Easy. Easy lengthens the interval, so it is
//     reserved for the one attribution where the learner explicitly said the
//     recall was effortless.
//   - right, nothing said → Good. The default, and the common case.
//
// AttrDisputed is deliberately NOT special-cased: an override has already
// changed `correct`, and the dispute itself says nothing about difficulty.
func RatingFor(correct bool, selfAttribution string) string {
	if !correct {
		return RatingAgain
	}
	switch selfAttribution {
	case AttrGuessed, AttrCareless, AttrMisread:
		return RatingHard
	case AttrConfident:
		return RatingEasy
	default:
		return RatingGood
	}
}

// ErrUnknownRating is returned for a rating name outside the four.
var ErrUnknownRating = errors.New("learning: unknown rating")

// ParseRating turns a stored name into the library's grade.
func ParseRating(name string) (Rating, error) {
	switch name {
	case RatingAgain:
		return fsrs.Again, nil
	case RatingHard:
		return fsrs.Hard, nil
	case RatingGood:
		return fsrs.Good, nil
	case RatingEasy:
		return fsrs.Easy, nil
	}
	return 0, fmt.Errorf("%w: %q", ErrUnknownRating, name)
}

// RatingName is ParseRating's inverse.
func RatingName(r Rating) string {
	switch r {
	case fsrs.Again:
		return RatingAgain
	case fsrs.Hard:
		return RatingHard
	case fsrs.Good:
		return RatingGood
	case fsrs.Easy:
		return RatingEasy
	}
	return ""
}

// Scheduler wraps the FSRS-6 implementation with AnyTools' parameters.
//
// Despite the `/v4` module path, `open-spaced-repetition/go-fsrs/v4` implements
// FSRS-6 — the major version is the Go module's, not the algorithm's
// (researcher §7). Reading the two as the same number is the mistake this
// comment exists to prevent.
type Scheduler struct {
	fsrs *fsrs.FSRS

	// fuzz is nil for the mastery scheduler, which must stay deterministic
	// (see NewScheduler). maxInterval bounds a fuzzed interval as the library
	// bounds its own.
	fuzz        *lockedRand
	maxInterval float64
}

// Options are the parameters a scheduler other than mastery's may choose.
type Options struct {
	// Fuzz spreads review intervals of three days and more across a small
	// range, so cards added together do not all fall due on one day.
	Fuzz bool
	// MaxIntervalDays caps an interval. Zero keeps the library's 36500.
	MaxIntervalDays int
	// Rand is the fuzz's random source. Nil seeds one from the clock; tests
	// pass a seeded one so fuzzed schedules are reproducible.
	Rand *rand.Rand
	// Steps replaces both the learning and the relearning steps. Nil keeps the
	// library's {1m, 10m} and {10m}.
	Steps []time.Duration
}

// lockedRand is a *rand.Rand shared by concurrent reviews; rand.Rand itself
// is not safe for concurrent use.
type lockedRand struct {
	mu sync.Mutex
	r  *rand.Rand
}

func (l *lockedRand) float64() float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.r.Float64()
}

// NewScheduler builds the scheduler on the library's default parameters.
//
// Two settings are chosen rather than inherited, and both matter:
//
//   - EnableFuzz stays OFF. Fuzz spreads due dates by a few percent so a large
//     deck does not pile every card onto one day; it also makes `Next()`
//     non-deterministic, which would make the recorded fixtures this package is
//     tested with unreproducible. AnyTools' decks are a few dozen knowledge
//     points inside one module, where pile-up is not the problem fuzz solves.
//   - The default parameters are POPULATION-level. FSRS can fit weights to one
//     person's history; doing so is out of scope for this phase and is recorded
//     as such in phase-07's Risks. A user's schedule is therefore "what FSRS-6
//     believes about people in general", which is the correct starting point and
//     is honest about what it is.
func NewScheduler() *Scheduler {
	p := fsrs.DefaultParam()
	p.EnableFuzz = false
	return &Scheduler{fsrs: fsrs.NewFSRS(p)}
}

// NewSchedulerWith builds a scheduler on chosen parameters. Vocabulary uses it
// (internal/vocab): a deck of hundreds of words is exactly the pile-up fuzz
// exists for.
//
// The fuzz is applied HERE rather than by the library. go-fsrs seeds its own
// fuzz from the review time and the card's state, so it cannot take an
// injected random source and a test of "fuzz is on" could not be made
// reproducible. The library's fuzz stays off and Next applies the same range
// table (fsrs.FuzzRanges) to the interval it chose, drawing from o.Rand.
func NewSchedulerWith(o Options) *Scheduler {
	p := fsrs.DefaultParam()
	p.EnableFuzz = false
	if o.MaxIntervalDays > 0 {
		p.MaximumInterval = float64(o.MaxIntervalDays)
	}
	if len(o.Steps) > 0 {
		steps := make([]float64, len(o.Steps))
		for i, d := range o.Steps {
			steps[i] = d.Minutes()
		}
		p.LearningSteps = steps
		p.RelearningSteps = append([]float64(nil), steps...)
	}
	s := &Scheduler{fsrs: fsrs.NewFSRS(p), maxInterval: p.MaximumInterval}
	if o.Fuzz {
		r := o.Rand
		if r == nil {
			now := uint64(time.Now().UnixNano())
			r = rand.New(rand.NewPCG(now, now>>17|1))
		}
		s.fuzz = &lockedRand{r: r}
	}
	return s
}

// fuzzInterval spreads a review interval (in days) over the library's fuzz
// range: ±15% up to a week, ±10% to twenty days, ±5% beyond, never below the
// days already elapsed + 1 and never above the maximum. It mirrors go-fsrs's
// own getFuzzRange, using its exported table, so the spread is the library's.
func fuzzInterval(interval, elapsedDays, maxInterval, draw float64) float64 {
	if interval < 2.5 {
		return interval
	}
	delta := 1.0
	for _, r := range fsrs.FuzzRanges() {
		delta += r.Factor * math.Max(math.Min(interval, r.End)-r.Start, 0)
	}
	interval = math.Min(interval, maxInterval)
	lo := math.Max(2, math.Round(interval-delta))
	hi := math.Min(math.Round(interval+delta), maxInterval)
	if interval > elapsedDays {
		lo = math.Max(lo, elapsedDays+1)
	}
	lo = math.Min(lo, hi)
	return math.Floor(draw*(hi-lo+1)) + lo
}

// NewCard returns the card a knowledge point starts life with: due immediately,
// so a freshly approved module's points are all waiting for the first session
// rather than invisible until some future date nobody chose.
func (s *Scheduler) NewCard(now time.Time) Card {
	return fsrs.NewCard(now.UTC())
}

// Next applies one review and returns the updated card.
//
// The returned card's Due is the ONLY source of `kp_state.due_at`; the store
// copies it rather than computing a date of its own, which is what keeps the
// two columns from ever disagreeing.
func (s *Scheduler) Next(card Card, now time.Time, rating string) (Card, error) {
	grade, err := ParseRating(rating)
	if err != nil {
		return Card{}, err
	}
	// A card restored from jsonb may carry a zero Due — a row written before
	// the card existed, or a hand-edited fixture. The library rejects a review
	// dated before the card, so seed it at `now` rather than failing a real
	// attempt over a column default.
	if card.Due.IsZero() {
		card.Due = now.UTC()
	}
	info, err := s.fsrs.Next(card, now.UTC(), grade)
	if err != nil {
		return Card{}, fmt.Errorf("learning: fsrs next: %w", err)
	}
	out := info.Card
	// Only whole-day review intervals are fuzzed; a ten-minute step is not a
	// date anyone's queue piles up on.
	if s.fuzz != nil && out.State == fsrs.Review && out.ScheduledDays >= 3 {
		elapsed := 0.0
		if !card.LastReview.IsZero() {
			elapsed = math.Floor(now.UTC().Sub(card.LastReview).Hours() / 24)
		}
		days := fuzzInterval(float64(out.ScheduledDays), elapsed, s.maxInterval, s.fuzz.float64())
		out.ScheduledDays = uint64(days)
		out.Due = now.UTC().Add(time.Duration(days) * 24 * time.Hour)
	}
	// The library keeps Easy a day past Good, which can step over its own
	// MaximumInterval (a 365-day cap produced 367). maxInterval is set only by
	// NewSchedulerWith, so the mastery scheduler's output is untouched.
	if s.maxInterval > 0 && float64(out.ScheduledDays) > s.maxInterval {
		out.ScheduledDays = uint64(s.maxInterval)
		out.Due = now.UTC().Add(time.Duration(s.maxInterval) * 24 * time.Hour)
	}
	return out, nil
}

// MasteryEstimate folds one attempt into the running per-knowledge-point
// estimate that module mastery averages.
//
// It is an exponentially weighted moving average of correctness, NOT FSRS's
// retrievability, and that is a deliberate choice rather than an oversight.
// Retrievability answers "would you recall this right now", which by
// construction is about 0.9 for any card immediately after any review,
// including the review that got it wrong and rescheduled it ten minutes out.
// A module gated on that graduates on a single answer. What "have you mastered
// this module" needs is "have you been getting these right lately", which is
// this.
//
// alpha = 0.4: three consecutive correct answers from zero reach 0.784, which
// clears the default 0.7 threshold, and one wrong answer drops a mastered point
// from 1.0 to 0.6, back below it. Both of those are the behaviour a learner
// would predict from the outside, which is the property that matters for a
// number shown on a progress bar.
func MasteryEstimate(prev float64, correct bool) float64 {
	const alpha = 0.4
	target := 0.0
	if correct {
		target = 1.0
	}
	next := prev*(1-alpha) + target*alpha
	switch {
	case next < 0:
		return 0
	case next > 1:
		return 1
	}
	return next
}
