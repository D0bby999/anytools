package loop

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// cards.go is the skill evidence card: a guided view over one evidence chain.
//
// The shape comes from up's single-skill evidence cards (name a real situation
// and a finishing standard, keep an unaided first attempt, practise, retest
// after a delay, try it somewhere new, reflect). As with the rest of this
// package, the structure is reused and none of the wording is: every prompt
// below was written for AnyTools.
//
// Two rules are the server's, not the page's (learning-depth red team SF-15,
// AS-13):
//
//   - A delayed retest written before the day it is due is refused with 409.
//     "The day" is the learner's calendar day (learning.LocalDay), so the stack
//     gate cannot be met on the day of the baseline.
//   - While a retest is pending, the baseline's text and links are withheld —
//     here for the card view, and in the evidence target query
//     (store/pg/learning_loop_targets.go) for every chain, review, evidence and
//     suggestion endpoint that renders a card entry.
//
// Decision: every entry is attached to the card's chain as an ACCEPTED
// evidence ref at its own timepoint, in the same transaction that writes it.
// The learner wrote it on purpose, on a card that exists to collect evidence;
// asking them to accept it a second time would be ceremony. So the Loop's
// gates count cards with no special case — and because a card entry's ref may
// only ever carry the entry's own timepoint (checkEvidence, UpdateEvidence), a
// practice entry cannot be re-tagged as the retest the delay rule refused.

// Card kinds. The list is repeated as the skill_cards CHECK constraint; a test
// compares the two.
const (
	CardReading    = "reading"
	CardWriting    = "writing"
	CardSpeaking   = "speaking"
	CardListening  = "listening"
	CardVocabulary = "vocabulary"
	CardGrammar    = "grammar"
	CardFieldNote  = "field_note"
)

// Card statuses. retest_due means "the baseline is saved and the retest is
// not": the retest may not be writable yet — RetestOpen says whether it is today.
const (
	CardOpen      = "open"
	CardRetestDue = "retest_due"
	CardClosed    = "closed"
)

// How much help a learner had when they wrote an entry.
const (
	PromptUnaided  = "unaided"
	PromptLightCue = "light_cue"
	PromptHeavyCue = "heavy_cue"
)

// What a card entry may link to.
const (
	LinkNote        = "note"
	LinkDocument    = "document"
	LinkQuizAttempt = "quiz_attempt"
)

// Card limits, repeated from the migration's CHECKs.
const (
	MaxCardTitleLen = 200
	MaxEntryChars   = 20000
	MaxCardLinks    = 20
	// Retest delays: two weeks for a skill, five days for a field note (the
	// middle of the three-to-seven-day window a field note is retested in).
	SkillRetestDays     = 14
	FieldNoteRetestDays = 5
)

// SetupField is one thing a learner names before the first attempt.
type SetupField struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Hint     string `json:"hint"`
	Required bool   `json:"required"`
}

// CardKind is one kind of card: what it asks for up front, how long before the
// retest, and what it asks at each timepoint. CardKinds is the only copy; the
// web app renders the kinds GET /v1/learning/card-kinds serves.
type CardKind struct {
	Kind            string              `json:"kind"`
	Name            string              `json:"name"`
	Summary         string              `json:"summary"`
	RetestDelayDays int                 `json:"retest_delay_days"`
	Setup           []SetupField        `json:"setup"`
	Prompts         map[string][]string `json:"prompts"`
}

// The three setup fields every kind shares.
var (
	setupSituation = SetupField{Key: "situation", Label: "Real situation",
		Hint: "Where will you actually need this? Name the place, the task and what is at stake.", Required: true}
	setupStandard = SetupField{Key: "standard", Label: "Done looks like",
		Hint: "What result would show the task was completed, as someone else could check it.", Required: true}
	setupTimeLimit = SetupField{Key: "time_limit", Label: "Time limit",
		Hint: "Optional. How long you give yourself for one attempt."}
)

func withShared(extra SetupField) []SetupField {
	return []SetupField{setupSituation, extra, setupStandard, setupTimeLimit}
}

var cardKinds = []CardKind{
	{
		Kind: CardReading, Name: "Reading", RetestDelayDays: SkillRetestDays,
		Summary: "Read something you need for a real task, and check what you can still do with it two weeks later.",
		Setup: withShared(SetupField{Key: "source", Label: "What you are reading",
			Hint: "Title, author or link, and the part that matters.", Required: true}),
		Prompts: map[string][]string{
			TimepointBaseline: {
				"Before any help, write what the text says and what you would do with it.",
				"Mark the places where you lost the thread.",
			},
			TimepointImmediate: {
				"After working through the hard parts, what changed in how you read it?",
				"Which difficulties were about words, and which were about the argument?",
			},
			TimepointDelayed: {
				"Without opening the text, explain its main claim and what supports it.",
				"Then read a comparable text cold and note where you stall.",
			},
			TimepointTransfer: {
				"Use the same reading on a different kind of text, or for a different purpose.",
			},
		},
	},
	{
		Kind: CardWriting, Name: "Writing", RetestDelayDays: SkillRetestDays,
		Summary: "Write for a real reader, keep the draft you made alone, and see what survives two weeks later.",
		Setup: withShared(SetupField{Key: "reader", Label: "Who will read it",
			Hint: "The person or group, and what they need to do after reading.", Required: true}),
		Prompts: map[string][]string{
			TimepointBaseline: {
				"Write the piece with no tools, templates or feedback, and keep it exactly as it came out.",
			},
			TimepointImmediate: {
				"Revise one pass at a time. Record what you changed and why it matters to the reader.",
			},
			TimepointDelayed: {
				"Write a similar piece from scratch, without looking at your earlier drafts.",
			},
			TimepointTransfer: {
				"Write for a new reader or under a new constraint, such as half the length.",
			},
		},
	},
	{
		Kind: CardSpeaking, Name: "Speaking", RetestDelayDays: SkillRetestDays,
		Summary: "Speak in a real exchange, record where it first broke down, and try again with the script gone.",
		Setup: withShared(SetupField{Key: "listener", Label: "Who you are speaking to",
			Hint: "The listener, and what they should be able to do or repeat afterwards.", Required: true}),
		Prompts: map[string][]string{
			TimepointBaseline: {
				"Speak without a script, then paste a transcript or describe what happened.",
				"Where did it first break down?",
			},
			TimepointImmediate: {
				"After practice, try again. What did the listener get this time that they missed before?",
			},
			TimepointDelayed: {
				"With old notes and scripts put away, speak on a new topic or to a new listener.",
			},
			TimepointTransfer: {
				"Handle a real exchange that includes a follow-up question you did not prepare for.",
			},
		},
	},
	{
		Kind: CardListening, Name: "Listening", RetestDelayDays: SkillRetestDays,
		Summary: "Listen to material you need, write what you caught before any captions, and retest on something new.",
		Setup: withShared(SetupField{Key: "material", Label: "What you are listening to",
			Hint: "The recording, its length and the speaker.", Required: true}),
		Prompts: map[string][]string{
			TimepointBaseline: {
				"Listen once without captions or a transcript. Write the gist and any details you caught.",
			},
			TimepointImmediate: {
				"Replay only the parts that failed. Note what you thought you heard and what was said.",
			},
			TimepointDelayed: {
				"Listen to comparable material you have not heard before, with no captions, and write the gist again.",
			},
			TimepointTransfer: {
				"Listen in a harder setting: a faster speaker, an unfamiliar accent, or background noise.",
			},
		},
	},
	{
		Kind: CardVocabulary, Name: "Vocabulary", RetestDelayDays: SkillRetestDays,
		Summary: "Work on the words a real task needs, and check that they come back when you have to produce them.",
		Setup: withShared(SetupField{Key: "items", Label: "Words or phrases",
			Hint: "The few that block the task, not every unknown word.", Required: true}),
		Prompts: map[string][]string{
			TimepointBaseline: {
				"Meet the words in context without a dictionary. Write what you think each one means and how sure you are.",
			},
			TimepointImmediate: {
				"Check the meaning, usage and usual word partners of the ones that matter. Use each in a sentence of your own.",
			},
			TimepointDelayed: {
				"With the list hidden, use each word in a new sentence. Note the ones that would not come.",
			},
			TimepointTransfer: {
				"Use the words in a real message, conversation or piece of work.",
			},
		},
	},
	{
		Kind: CardGrammar, Name: "Grammar", RetestDelayDays: SkillRetestDays,
		Summary: "Pick one structure a real task needs, compare what it means, and use it later without the rule in view.",
		Setup: withShared(SetupField{Key: "structure", Label: "The structure",
			Hint: "One pattern, and the meaning it has to carry in your task.", Required: true}),
		Prompts: map[string][]string{
			TimepointBaseline: {
				"Write or say a few sentences for the real task without looking anything up. Mark where you hesitated.",
			},
			TimepointImmediate: {
				"Set your version beside one or two alternatives, and write what each one would mean to the reader.",
			},
			TimepointDelayed: {
				"With the rule and your earlier answer out of sight, use the structure on a new topic.",
			},
			TimepointTransfer: {
				"Use it under time pressure, or for a different audience.",
			},
		},
	},
	{
		Kind: CardFieldNote, Name: "Reader field note", RetestDelayDays: FieldNoteRetestDays,
		Summary: "Right after reading, retell it and try one small action; a few days later, retell it again before rereading.",
		Setup: withShared(SetupField{Key: "source", Label: "What you read",
			Hint: "The chapter, article or page.", Required: true}),
		Prompts: map[string][]string{
			TimepointBaseline: {
				"Soon after reading, and without the page, retell the main idea in your own words.",
				"Name one small action it suggests, and try it.",
			},
			TimepointImmediate: {
				"What happened when you tried the action?",
			},
			TimepointDelayed: {
				"Before rereading anything, retell it again. What is still there, and what has gone?",
			},
			TimepointTransfer: {
				"Change one condition — a new problem, a new place, a new person — and try it again.",
			},
		},
	},
}

// CardKinds returns every kind, in the migration's order.
func CardKinds() []CardKind { return cardKinds }

// CardKindNames returns the kind identifiers, in the migration's order.
func CardKindNames() []string {
	out := make([]string, len(cardKinds))
	for i, k := range cardKinds {
		out[i] = k.Kind
	}
	return out
}

func cardKind(kind string) (CardKind, bool) {
	for _, k := range cardKinds {
		if k.Kind == kind {
			return k, true
		}
	}
	return CardKind{}, false
}

// SkillCard is one row of skill_cards.
type SkillCard struct {
	ID         uuid.UUID         `json:"id"`
	UserID     uuid.UUID         `json:"-"`
	StateID    uuid.UUID         `json:"state_id"`
	ChainID    uuid.UUID         `json:"chain_id"`
	Kind       string            `json:"kind"`
	Title      string            `json:"title"`
	Setup      map[string]string `json:"setup"`
	Status     string            `json:"status"`
	BaselineAt *time.Time        `json:"baseline_at"`
	// RetestDueOn is the learner's calendar day the retest opens, "" before
	// the baseline.
	RetestDueOn string         `json:"retest_due_on"`
	ClosedAt    *time.Time     `json:"closed_at"`
	Reflection  CardReflection `json:"reflection"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

// CardReflection is what the learner writes when a card closes.
type CardReflection struct {
	Held   string `json:"held"`
	Missed string `json:"missed"`
	Next   string `json:"next"`
}

// CardEntry is one row of card_entries: something the learner wrote at a
// timepoint. It is never changed after it is saved.
type CardEntry struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"-"`
	CardID      uuid.UUID  `json:"card_id"`
	Timepoint   string     `json:"timepoint"`
	Body        string     `json:"body"`
	PromptLevel string     `json:"prompt_level"`
	Links       []CardLink `json:"links"`
	// Withheld is true for a baseline whose retest is pending: Body and Links
	// are empty, and the page says so rather than showing nothing.
	Withheld  bool      `json:"withheld"`
	CreatedAt time.Time `json:"created_at"`
}

// CardLink points an entry at something else the learner has in AnyTools.
// Kind, ID and Page are what is stored; Label and Path are read on render,
// with the owner's id, and are empty when the target is gone.
type CardLink struct {
	Kind  string    `json:"kind"`
	ID    uuid.UUID `json:"id"`
	Page  int       `json:"page,omitempty"`
	Label string    `json:"label,omitempty"`
	Path  string    `json:"path,omitempty"`
	// Missing is true when the target no longer exists (or never was the
	// learner's): shown as such rather than dropped.
	Missing bool `json:"missing,omitempty"`
}

// NewCard is the input for creating a card on a state.
type NewCard struct {
	Kind  string            `json:"kind"`
	Title string            `json:"title"`
	Setup map[string]string `json:"setup"`
}

// CardEntryInput is the input for writing an entry.
type CardEntryInput struct {
	Timepoint   string     `json:"timepoint"`
	Body        string     `json:"body"`
	PromptLevel string     `json:"prompt_level"`
	Links       []CardLink `json:"links"`
}

// CardChange is what a write does to its card, decided by the service while
// the store holds the card's row lock.
type CardChange struct {
	Status      string
	BaselineAt  *time.Time
	RetestDueOn string
	ClosedAt    *time.Time
	Reflection  *CardReflection
}

// CardDetail is a card's page.
type CardDetail struct {
	Card    SkillCard   `json:"card"`
	Kind    CardKind    `json:"kind"`
	Entries []CardEntry `json:"entries"`
	// Today is the learner's calendar day, as the retest rule reads it.
	Today string `json:"today"`
	// RetestOpen is true when a delayed retest may be written today.
	RetestOpen bool `json:"retest_open"`
	// BaselineHidden is true while the retest is pending.
	BaselineHidden bool `json:"baseline_hidden"`
	// Allowed are the timepoints an entry may be written at now.
	Allowed []string `json:"allowed"`
}

// RetestDue is one card whose retest may be written today.
type RetestDue struct {
	CardID      uuid.UUID `json:"card_id"`
	StateID     uuid.UUID `json:"state_id"`
	Kind        string    `json:"kind"`
	Title       string    `json:"title"`
	RetestDueOn string    `json:"retest_due_on"`
}

// Zones reads a learner's time zone. pg.UserStore implements it.
type Zones interface {
	Timezone(ctx context.Context, userID uuid.UUID) (string, error)
}

// WithZones gives the service the learners' zones. Without it every learner is
// on UTC, which is what users.timezone defaults to anyway.
func (s *Service) WithZones(z Zones) *Service {
	s.zones = z
	return s
}

// today is the learner's calendar day now.
func (s *Service) today(ctx context.Context, userID uuid.UUID) (learning.Day, error) {
	zone, err := s.zone(ctx, userID)
	if err != nil {
		return learning.Day{}, err
	}
	return learning.LocalDay(s.now(), zone), nil
}

// zone is the learner's IANA zone, UTC without WithZones.
func (s *Service) zone(ctx context.Context, userID uuid.UUID) (string, error) {
	if s.zones == nil {
		return "UTC", nil
	}
	z, err := s.zones.Timezone(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("learner time zone: %w", err)
	}
	return z, nil
}

// dayOf parses a stored retest_due_on.
func dayOf(iso string) (learning.Day, error) {
	t, err := time.Parse(time.DateOnly, iso)
	if err != nil {
		return learning.Day{}, fmt.Errorf("retest date %q: %w", iso, err)
	}
	return learning.Day{Year: t.Year(), Month: t.Month(), Day: t.Day()}, nil
}

// addDays is the calendar day n days after d.
func addDays(d learning.Day, n int) learning.Day {
	t := time.Date(d.Year, d.Month, d.Day+n, 0, 0, 0, 0, time.UTC)
	return learning.Day{Year: t.Year(), Month: t.Month(), Day: t.Day()}
}

// ErrRetestNotDue is the 409 for a retest written too early.
var ErrRetestNotDue = errors.New("loop: retest not due")

// ───────────────────────────────────────────────────────────────── the rules

// allowedTimepoints is what a card accepts now. It is pure, so the page's
// forms and the write path cannot disagree.
//
//   - A closed card takes nothing.
//   - Before the baseline, only the baseline: practice before an unaided
//     attempt would make the attempt aided.
//   - While the retest is pending: practice, and the retest once it is due.
//   - After the retest: more practice, more retests, and transfer — the same
//     skill under a changed condition, which only means something once it has
//     been shown to last.
func allowedTimepoints(c SkillCard, today learning.Day) ([]string, bool) {
	switch {
	case c.Status == CardClosed:
		return []string{}, false
	case c.BaselineAt == nil:
		return []string{TimepointBaseline}, false
	case c.Status == CardRetestDue:
		due, err := dayOf(c.RetestDueOn)
		if err != nil || today.Before(due) {
			return []string{TimepointImmediate}, false
		}
		return []string{TimepointImmediate, TimepointDelayed}, true
	default:
		return []string{TimepointImmediate, TimepointDelayed, TimepointTransfer}, true
	}
}

// decideEntry is the write rule: given the card (locked) and today, either the
// entry may be written and this is what it does to the card, or it may not.
func decideEntry(c SkillCard, in CardEntryInput, today learning.Day, now time.Time) (*CardChange, error) {
	allowed, _ := allowedTimepoints(c, today)
	if contains(allowed, in.Timepoint) {
		ch := &CardChange{Status: c.Status}
		switch in.Timepoint {
		case TimepointBaseline:
			k, _ := cardKind(c.Kind)
			at := now.UTC()
			ch.Status, ch.BaselineAt = CardRetestDue, &at
			ch.RetestDueOn = addDays(today, k.RetestDelayDays).String()
		case TimepointDelayed:
			ch.Status = CardOpen
		}
		return ch, nil
	}
	switch {
	case c.Status == CardClosed:
		return nil, fmt.Errorf("%w: this card is closed; start a new card to keep going", ErrConflict)
	case in.Timepoint == TimepointBaseline:
		return nil, fmt.Errorf("%w: the first attempt is already saved and cannot be replaced; start a new card instead", ErrConflict)
	case c.BaselineAt == nil:
		return nil, fmt.Errorf("%w: write the unaided first attempt before anything else", ErrConflict)
	case in.Timepoint == TimepointDelayed:
		return nil, fmt.Errorf("%w: the retest opens on %s", ErrRetestNotDue, c.RetestDueOn)
	default:
		return nil, fmt.Errorf("%w: save the retest before recording a transfer", ErrConflict)
	}
}

func (in CardEntryInput) validate() error {
	if !contains(Timepoints(), in.Timepoint) {
		return fmt.Errorf("%w: unknown timepoint %q", ErrInvalid, in.Timepoint)
	}
	if strings.TrimSpace(in.Body) == "" {
		return fmt.Errorf("%w: write something first", ErrInvalid)
	}
	if utf8.RuneCountInString(in.Body) > MaxEntryChars {
		return fmt.Errorf("%w: an entry is at most %d characters", ErrInvalid, MaxEntryChars)
	}
	switch in.PromptLevel {
	case PromptUnaided, PromptLightCue, PromptHeavyCue:
	default:
		return fmt.Errorf("%w: unknown prompt level %q", ErrInvalid, in.PromptLevel)
	}
	if in.Timepoint == TimepointBaseline && in.PromptLevel != PromptUnaided {
		return fmt.Errorf("%w: the first attempt is the unaided one; save cued work as practice", ErrInvalid)
	}
	if len(in.Links) > MaxCardLinks {
		return fmt.Errorf("%w: at most %d links", ErrInvalid, MaxCardLinks)
	}
	for _, l := range in.Links {
		switch l.Kind {
		case LinkNote, LinkQuizAttempt:
			if l.Page != 0 {
				return fmt.Errorf("%w: only a document link has a page", ErrInvalid)
			}
		case LinkDocument:
			if l.Page < 0 || l.Page > 100000 {
				return fmt.Errorf("%w: a page number is out of range", ErrInvalid)
			}
		default:
			return fmt.Errorf("%w: unknown link kind %q", ErrInvalid, l.Kind)
		}
		if l.ID == uuid.Nil {
			return fmt.Errorf("%w: a link needs an id", ErrInvalid)
		}
	}
	return nil
}

func (in NewCard) validate() (CardKind, map[string]string, error) {
	k, ok := cardKind(in.Kind)
	if !ok {
		return CardKind{}, nil, fmt.Errorf("%w: unknown card kind %q", ErrInvalid, in.Kind)
	}
	if err := requireText("title", in.Title, MaxCardTitleLen); err != nil {
		return CardKind{}, nil, err
	}
	setup := map[string]string{}
	known := map[string]SetupField{}
	for _, f := range k.Setup {
		known[f.Key] = f
	}
	for key, v := range in.Setup {
		if _, ok := known[key]; !ok {
			return CardKind{}, nil, fmt.Errorf("%w: a %s card has no %q field", ErrInvalid, k.Kind, key)
		}
		if len(v) > MaxTextLen {
			return CardKind{}, nil, fmt.Errorf("%w: the %s is too long", ErrInvalid, strings.ToLower(known[key].Label))
		}
		if v = strings.TrimSpace(v); v != "" {
			setup[key] = v
		}
	}
	for _, f := range k.Setup {
		if f.Required && setup[f.Key] == "" {
			return CardKind{}, nil, fmt.Errorf("%w: %s is required", ErrInvalid, strings.ToLower(f.Label))
		}
	}
	return k, setup, nil
}

func (r CardReflection) validate() error {
	for _, v := range []string{r.Held, r.Missed, r.Next} {
		if len(v) > MaxTextLen {
			return fmt.Errorf("%w: a reflection answer is too long", ErrInvalid)
		}
	}
	if strings.TrimSpace(r.Held+r.Missed+r.Next) == "" {
		return fmt.Errorf("%w: write at least one line of reflection", ErrInvalid)
	}
	return nil
}

// withhold empties a pending retest's baseline. It is the card view's half of
// the rule; the evidence target query is the other half.
func withhold(c SkillCard, entries []CardEntry) []CardEntry {
	if c.Status != CardRetestDue {
		return entries
	}
	for i := range entries {
		if entries[i].Timepoint == TimepointBaseline {
			entries[i].Body, entries[i].Links, entries[i].Withheld = "", []CardLink{}, true
		}
	}
	return entries
}

// ───────────────────────────────────────────────────────────────── service

// CreateCard starts a card, and its chain, on a state.
func (s *Service) CreateCard(ctx context.Context, userID, stateID uuid.UUID, in NewCard) (*CardDetail, error) {
	_, setup, err := in.validate()
	if err != nil {
		return nil, err
	}
	if _, err := s.store.GetState(ctx, userID, stateID); err != nil {
		return nil, err
	}
	c, err := s.store.CreateCard(ctx, SkillCard{
		UserID: userID, StateID: stateID, Kind: in.Kind, Title: strings.TrimSpace(in.Title), Setup: setup,
	})
	if err != nil {
		return nil, err
	}
	return s.cardDetail(ctx, userID, c)
}

// Card reads a card's page.
func (s *Service) Card(ctx context.Context, userID, id uuid.UUID) (*CardDetail, error) {
	c, err := s.store.GetCard(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return s.cardDetail(ctx, userID, c)
}

// Cards lists a state's cards.
func (s *Service) Cards(ctx context.Context, userID, stateID uuid.UUID) ([]SkillCard, error) {
	return s.store.ListCards(ctx, userID, stateID)
}

func (s *Service) cardDetail(ctx context.Context, userID uuid.UUID, c *SkillCard) (*CardDetail, error) {
	entries, err := s.store.ListCardEntries(ctx, userID, c.ID)
	if err != nil {
		return nil, err
	}
	today, err := s.today(ctx, userID)
	if err != nil {
		return nil, err
	}
	k, _ := cardKind(c.Kind)
	allowed, open := allowedTimepoints(*c, today)
	return &CardDetail{
		Card: *c, Kind: k, Entries: withhold(*c, entries), Today: today.String(),
		RetestOpen: open && c.Status == CardRetestDue, BaselineHidden: c.Status == CardRetestDue,
		Allowed: allowed,
	}, nil
}

// AddCardEntry writes an entry and attaches it to the card's chain.
func (s *Service) AddCardEntry(ctx context.Context, userID, cardID uuid.UUID, in CardEntryInput) (*CardDetail, error) {
	if in.PromptLevel == "" {
		in.PromptLevel = PromptUnaided
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	today, err := s.today(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	entry := CardEntry{UserID: userID, CardID: cardID, Timepoint: in.Timepoint, Body: in.Body,
		PromptLevel: in.PromptLevel, Links: make([]CardLink, 0, len(in.Links))}
	for _, l := range in.Links {
		entry.Links = append(entry.Links, CardLink{Kind: l.Kind, ID: l.ID, Page: l.Page})
	}
	c, err := s.store.AddCardEntry(ctx, userID, cardID, entry, func(c SkillCard) (*CardChange, error) {
		return decideEntry(c, in, today, now)
	})
	if err != nil {
		return nil, err
	}
	return s.cardDetail(ctx, userID, c)
}

// CloseCard records the reflection and closes the card.
func (s *Service) CloseCard(ctx context.Context, userID, id uuid.UUID, in CardReflection) (*CardDetail, error) {
	if err := in.validate(); err != nil {
		return nil, err
	}
	r := CardReflection{Held: strings.TrimSpace(in.Held), Missed: strings.TrimSpace(in.Missed), Next: strings.TrimSpace(in.Next)}
	now := s.now().UTC()
	c, err := s.store.CloseCard(ctx, userID, id, func(c SkillCard) (*CardChange, error) {
		switch {
		case c.Status == CardClosed:
			return nil, fmt.Errorf("%w: this card is already closed", ErrConflict)
		case c.BaselineAt == nil:
			return nil, fmt.Errorf("%w: there is nothing to reflect on before the first attempt", ErrConflict)
		}
		return &CardChange{Status: CardClosed, ClosedAt: &now, Reflection: &r}, nil
	})
	if err != nil {
		return nil, err
	}
	return s.cardDetail(ctx, userID, c)
}

// RetestsDue lists the cards whose retest may be written today, in the
// learner's zone. A retest due tomorrow is not listed.
func (s *Service) RetestsDue(ctx context.Context, userID uuid.UUID) ([]RetestDue, string, error) {
	today, err := s.today(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	due, err := s.store.RetestsDue(ctx, userID, today.String())
	if err != nil {
		return nil, "", err
	}
	return due, today.String(), nil
}

// checkCardEntryTimepoint holds a card entry's evidence ref to the timepoint
// the entry was written at. Without it, a practice entry written on the day of
// the baseline could be attached — or re-tagged — as the delayed retest the
// card refused.
func (s *Service) checkCardEntryTimepoint(ctx context.Context, userID, entryID uuid.UUID, timepoint string, onChain bool) error {
	if timepoint == "" && !onChain {
		return nil
	}
	tp, err := s.store.CardEntryTimepoint(ctx, userID, entryID)
	if err != nil {
		return err
	}
	if tp != timepoint {
		return fmt.Errorf("%w: a card entry keeps the timepoint it was written at (%s)", ErrInvalid, tp)
	}
	return nil
}
