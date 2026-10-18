// Package vocab is the learner's vocabulary: words saved while reading, kept
// as notes that each own two spaced cards (plans/260926-2301-learning-depth,
// phase 7).
//
// The shape is Anki's (external findings §6). A NOTE is one term in one
// language — its meaning, reading, part of speech and the sentences it was met
// in. It owns CARDS, each with its own FSRS schedule:
//
//   - recognition: the term and its context → the meaning;
//   - cloze: the context with the term blanked → the term, typed.
//
// Since up-methods phase 3 (decisions.go) a note also carries one of up's
// five decisions about an unknown word, and only a word to "learn" owns
// cards. A third card, production (a situational cue → the term, typed),
// exists only when the learner asks for it on one note.
//
// The same card table holds a living book's `flash` cards (phase 11). They
// have no note, are scheduled by the same scheduler and reviewed by the same
// path, and live in a deck of their own: the words queue never shows them,
// and the Book cards queue shows nothing else.
//
// What is decided here and not by a model: a term is saved only if it
// literally occurs in the selection, and the selection only if it occurs on
// the page the server has stored (match.go). The meaning is the model's, and
// the learner can edit it.
package vocab

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// ErrNotFound is the one answer to "no such row for this user".
var ErrNotFound = errors.New("vocab: not found")

// ErrInvalid marks a caller mistake the API answers with 400.
var ErrInvalid = errors.New("vocab: invalid")

// ErrNoText is returned when the document has no parsed text to check a
// selection against — it has not been parsed yet.
var ErrNoText = errors.New("vocab: the document has no text yet")

// The card kinds, exactly as the migration's vocab_cards_kind_check lists
// them. A `flash` card belongs to a living book's block, not to a note
// (learning-depth phase 11): it has its own front and back, and no siblings.
const (
	KindRecognition = "recognition"
	KindCloze       = "cloze"
	KindFlash       = "flash"
)

// CardKinds returns every card kind a note creates, in creation order.
func CardKinds() []string { return []string{KindRecognition, KindCloze} }

// Decks are the two review queues over the one card table: the vocabulary's
// words, and the living books' flash cards. Neither shows the other's cards.
const (
	DeckWords = "words"
	DeckBook  = "book"
)

// Flash-card limits, matching vocab_cards_flash_fields.
const (
	MaxFlashFront = 300
	MaxFlashBack  = 1000
)

// Limits, matching the migration's CHECKs where one exists.
const (
	MaxTermLen      = 80
	MaxMeaningLen   = 1000
	MaxReadingLen   = 120
	MaxPOSLen       = 40
	MaxAnswerLen    = 200
	MaxSelectionLen = 8000
	// MaxContexts caps the sentences a note keeps; the oldest drop off.
	MaxContexts = 20
	// SessionSize is the most cards one review session serves.
	SessionSize = 50
)

// Context is one sentence the term was met in. The ids are resolved with the
// owner's user_id when saved and again when read (pg.VocabStore): a jsonb id
// has no foreign key, so a document deleted since reads back without one.
type Context struct {
	Sentence      string     `json:"sentence"`
	DocumentID    *uuid.UUID `json:"document_id,omitempty"`
	DocumentTitle string     `json:"document_title,omitempty"`
	Page          int        `json:"page,omitempty"`
	ChunkID       *uuid.UUID `json:"chunk_id,omitempty"`
	AddedAt       time.Time  `json:"added_at"`
}

// Source is the document a note was first saved from.
type Source struct {
	DocumentID uuid.UUID `json:"document_id"`
	Title      string    `json:"title"`
	Page       int       `json:"page,omitempty"`
}

// CardSummary is a card as the word list shows it.
type CardSummary struct {
	ID        uuid.UUID `json:"id"`
	Kind      string    `json:"kind"`
	DueAt     time.Time `json:"due_at"`
	Reps      int       `json:"reps"`
	Lapses    int       `json:"lapses"`
	Suspended bool      `json:"suspended"`
}

// Note is one term in one language.
type Note struct {
	ID       uuid.UUID `json:"id"`
	UserID   uuid.UUID `json:"-"`
	Term     string    `json:"term"`
	Lang     string    `json:"lang"`
	Reading  string    `json:"reading"`
	POS      string    `json:"pos"`
	Meaning  string    `json:"meaning"`
	Contexts []Context `json:"contexts"`
	// Decision is one of the five (decisions.go), Record its minimum record.
	// A note saved before decisions existed is "learn" with an empty record.
	Decision   string            `json:"decision"`
	Record     map[string]string `json:"record"`
	TaskImpact string            `json:"task_impact"`
	DecidedAt  time.Time         `json:"decided_at"`
	// Scenario and Confusable are the production card's back; Production is
	// whether the learner asked for that card.
	Scenario   string        `json:"scenario"`
	Confusable string        `json:"confusable"`
	Production bool          `json:"production"`
	Source     *Source       `json:"source,omitempty"`
	Cards      []CardSummary `json:"cards"`
	Suspended  bool          `json:"suspended"`
	CreatedAt  time.Time     `json:"created_at"`
	UpdatedAt  time.Time     `json:"updated_at"`
}

// DueCard is one card in a review session, with what it shows.
type DueCard struct {
	ID uuid.UUID `json:"id"`
	// NoteID is nil for a flash card, which has no note.
	NoteID  *uuid.UUID `json:"note_id,omitempty"`
	Kind    string     `json:"kind"`
	DueAt   time.Time  `json:"due_at"`
	Reps    int        `json:"reps"`
	Term    string     `json:"term"`
	Lang    string     `json:"lang"`
	Reading string     `json:"reading"`
	POS     string     `json:"pos"`
	Meaning string     `json:"meaning"`
	// Context is the newest sentence; Cloze is that sentence with the term
	// blanked, set on cloze cards only.
	Context string  `json:"context"`
	Cloze   string  `json:"cloze,omitempty"`
	Source  *Source `json:"source,omitempty"`
	// Scenario and Confusable are set on production cards only: the front is
	// the scenario and the meaning, the back adds the confusable expression.
	Scenario   string `json:"scenario,omitempty"`
	Confusable string `json:"confusable,omitempty"`
	// Front, Back and Book are set on flash cards only.
	Front string   `json:"front,omitempty"`
	Back  string   `json:"back,omitempty"`
	Book  *BookRef `json:"book,omitempty"`

	FSRS learning.Card `json:"-"`
}

// BookRef is where a flash card came from: the book and its chapter.
type BookRef struct {
	BookID    uuid.UUID `json:"book_id"`
	Title     string    `json:"title"`
	ChapterID uuid.UUID `json:"chapter_id"`
}

// FlashCard is one front/back pair a book's block writes.
type FlashCard struct {
	Front string `json:"front"`
	Back  string `json:"back"`
}

// NoteWrite is a save, after the service has checked it.
type NoteWrite struct {
	UserID     uuid.UUID
	Term       string
	Lang       string
	Reading    string
	POS        string
	Meaning    string
	Context    Context
	DocumentID uuid.UUID
	Page       int
	// Decision, Record and TaskImpact are checked. Cards are created only
	// for DecisionLearn.
	Decision   string
	Record     map[string]string
	TaskImpact string
	// NewCard is the FSRS card each new card starts with.
	NewCard learning.Card
	Now     time.Time
}

// NotePatch carries the fields an edit may change.
type NotePatch struct {
	Meaning   *string
	Reading   *string
	POS       *string
	Lang      *string
	Suspended *bool
	// Decision changes the decision: moving to learn creates or resumes the
	// cards, moving away suspends them. Record nil leaves the record alone.
	Decision   *string
	Record     map[string]string
	TaskImpact *string
	Scenario   *string
	Confusable *string
	// Production turns the production card on (created, or resumed) or off
	// (suspended, its schedule kept).
	Production *bool
	// Check runs on the note as the patch would leave it, under the row
	// lock, before anything is written.
	Check func(next NoteState) error
	// NewCard is the FSRS state a card created by this patch starts with.
	NewCard learning.Card
	Now     time.Time
}

// NoteState is what a patch's Check sees: the decision fields of the note
// as the patch would leave them.
type NoteState struct {
	Decision   string
	Record     map[string]string
	Meaning    string
	Scenario   string
	Production bool
}

// Filter narrows the word list.
type Filter struct {
	Q     string
	Lang  string
	Limit int
	// Decision keeps one decision's notes. Terms keeps the notes of exactly
	// these terms, case ignored: the word picker's "already saved as".
	Decision string
	Terms    []string
}

// MaxFilterTerms bounds Filter.Terms.
const MaxFilterTerms = 50

// ReviewWrite is one review, applied in one transaction.
type ReviewWrite struct {
	UserID    uuid.UUID
	CardID    uuid.UUID
	RequestID uuid.UUID
	Rating    string
	Answer    string
	Matched   *bool
	Now       time.Time
	// BuryUntil is the start of the learner's tomorrow: a sibling due before
	// it moves to it.
	BuryUntil time.Time
	// Schedule turns the card's FSRS state into the next one.
	Schedule func(learning.Card) (learning.Card, error)
}

// ReviewResult is a review's outcome. Replayed is true when the request id
// had already been applied and nothing was scheduled again.
type ReviewResult struct {
	CardID   uuid.UUID `json:"card_id"`
	Rating   string    `json:"rating"`
	Matched  *bool     `json:"matched,omitempty"`
	DueAt    time.Time `json:"due_at"`
	Reps     int       `json:"reps"`
	Lapses   int       `json:"lapses"`
	Buried   int       `json:"buried"`
	Replayed bool      `json:"replayed"`
}

// Store is the persistence this package needs. pg.VocabStore implements it.
type Store interface {
	// SaveNote inserts the note with its cards, or — when the user already
	// has the term in that language — adds the context to the existing one.
	SaveNote(ctx context.Context, w NoteWrite) (*Note, bool, error)
	ListNotes(ctx context.Context, userID uuid.UUID, f Filter) ([]Note, error)
	GetNote(ctx context.Context, userID, id uuid.UUID) (*Note, error)
	UpdateNote(ctx context.Context, userID, id uuid.UUID, p NotePatch) (*Note, error)
	DeleteNote(ctx context.Context, userID, id uuid.UUID) error
	// CountLearnSince counts the notes whose decision was set to learn at or
	// after since.
	CountLearnSince(ctx context.Context, userID uuid.UUID, since time.Time) (int, error)
	// DueCards returns the deck's cards due before `before`, oldest first, at
	// most limit, and how many are due in all.
	DueCards(ctx context.Context, userID uuid.UUID, deck string, before time.Time, limit int) ([]DueCard, int, error)
	GetCard(ctx context.Context, userID, cardID uuid.UUID) (*DueCard, error)
	Review(ctx context.Context, w ReviewWrite) (*ReviewResult, error)
}

// PageLoader reads the text of a reading workspace's page, as the server
// stored it. It answers ErrNotFound for a workspace that is not the user's and
// ErrNoText for a document with no parsed text.
type PageLoader interface {
	WorkspacePage(ctx context.Context, userID, workspaceID uuid.UUID, page int) (documentID uuid.UUID, text string, err error)
}

// Zones reads the learner's IANA time zone. pg.UserStore implements it.
type Zones interface {
	Timezone(ctx context.Context, userID uuid.UUID) (string, error)
}

// Config are the Service's collaborators.
type Config struct {
	Store     Store
	Pages     PageLoader
	Zones     Zones
	Scheduler *learning.Scheduler
	Now       func() time.Time
}

// Service is the vocabulary's application logic.
type Service struct {
	store     Store
	pages     PageLoader
	zones     Zones
	scheduler *learning.Scheduler
	now       func() time.Time
}

// NewScheduler is the vocabulary schedule (external findings §6): retention
// 0.9 (the library's default), one 10-minute learning and relearning step,
// intervals capped at a year, and fuzz ON so words saved together do not all
// come back on one day. rnd is nil in production; tests pass a seeded source.
func NewScheduler(rnd *rand.Rand) *learning.Scheduler {
	return learning.NewSchedulerWith(learning.Options{
		Fuzz: true, MaxIntervalDays: 365, Rand: rnd,
		Steps: []time.Duration{10 * time.Minute},
	})
}

// NewService builds the Service.
func NewService(c Config) *Service {
	if c.Now == nil {
		c.Now = time.Now
	}
	if c.Scheduler == nil {
		c.Scheduler = NewScheduler(nil)
	}
	return &Service{store: c.Store, pages: c.Pages, zones: c.Zones, scheduler: c.Scheduler, now: c.Now}
}

// SaveInput is a term the learner saves from a selection.
type SaveInput struct {
	WorkspaceID uuid.UUID
	Page        int
	Selection   string
	Term        string
	Meaning     string
	Lang        string
	Reading     string
	POS         string
	// Decision is one of the five, with its Record. Empty is a client from
	// before decisions: the note is a word to learn, with no record, as
	// every note was then.
	Decision   string
	Record     map[string]string
	TaskImpact string
}

// Save checks the term against the selection and the selection against the
// stored page, then saves the note (or adds a context to the existing one).
// The bool is true when a new note was created.
func (s *Service) Save(ctx context.Context, userID uuid.UUID, in SaveInput) (*Note, bool, error) {
	term := strings.TrimSpace(Normalize(in.Term))
	meaning := strings.TrimSpace(in.Meaning)
	selection := strings.TrimSpace(in.Selection)
	decision, record := strings.TrimSpace(in.Decision), map[string]string{}
	if decision == "" {
		decision = DecisionLearn
	} else {
		var err error
		if record, err = CheckRecord(decision, in.Record); err != nil {
			return nil, false, err
		}
	}
	impact, err := CheckTaskImpact(in.TaskImpact)
	if err != nil {
		return nil, false, err
	}
	switch {
	case term == "":
		return nil, false, fmt.Errorf("%w: a word needs some text", ErrInvalid)
	case utf8.RuneCountInString(term) > MaxTermLen:
		return nil, false, fmt.Errorf("%w: that is too long to be one term", ErrInvalid)
	case meaning == "" && NeedsMeaning(decision):
		return nil, false, fmt.Errorf("%w: a word to %s needs a meaning", ErrInvalid, decision)
	case utf8.RuneCountInString(meaning) > MaxMeaningLen:
		return nil, false, fmt.Errorf("%w: that meaning is too long", ErrInvalid)
	case selection == "":
		return nil, false, fmt.Errorf("%w: select the passage the word is in", ErrInvalid)
	case utf8.RuneCountInString(selection) > MaxSelectionLen:
		return nil, false, fmt.Errorf("%w: that selection is too long", ErrInvalid)
	case in.Page < 0:
		return nil, false, fmt.Errorf("%w: page cannot be negative", ErrInvalid)
	}
	if err := checkShortFields(in.Reading, in.POS); err != nil {
		return nil, false, err
	}

	// The workspace resolves to its document with the caller's user_id; a
	// workspace of anyone else's is ErrNotFound before any text is read.
	docID, pageText, err := s.pages.WorkspacePage(ctx, userID, in.WorkspaceID, in.Page)
	if err != nil {
		return nil, false, err
	}
	if !SelectionOnPage(selection, pageText) {
		return nil, false, fmt.Errorf("%w: that passage is not on this page of the document", ErrInvalid)
	}
	if !TermInSelection(term, selection) {
		return nil, false, fmt.Errorf("%w: %q does not occur in the selected passage", ErrInvalid, term)
	}

	lang := strings.TrimSpace(in.Lang)
	if lang == "" {
		lang = DetectLang(pageText)
	}
	if !ValidLang(lang) {
		return nil, false, fmt.Errorf("%w: %q is not a language code", ErrInvalid, lang)
	}

	now := s.now().UTC()
	return s.store.SaveNote(ctx, NoteWrite{
		UserID:  userID,
		Term:    term,
		Lang:    lang,
		Reading: strings.TrimSpace(in.Reading),
		POS:     strings.TrimSpace(in.POS),
		Meaning: meaning,
		Context: Context{
			Sentence:   ContextSentence(term, selection),
			DocumentID: &docID,
			Page:       in.Page,
			AddedAt:    now,
		},
		DocumentID: docID,
		Page:       in.Page,
		Decision:   decision,
		Record:     record,
		TaskImpact: impact,
		NewCard:    s.scheduler.NewCard(now),
		Now:        now,
	})
}

func checkShortFields(reading, pos string) error {
	if utf8.RuneCountInString(strings.TrimSpace(reading)) > MaxReadingLen {
		return fmt.Errorf("%w: that reading is too long", ErrInvalid)
	}
	if utf8.RuneCountInString(strings.TrimSpace(pos)) > MaxPOSLen {
		return fmt.Errorf("%w: that part of speech is too long", ErrInvalid)
	}
	return nil
}

// ValidLang reports whether s is a language code the database accepts: a
// two- or three-letter primary tag with an optional region (en, vi, pt-BR).
func ValidLang(s string) bool {
	primary, region, hasRegion := strings.Cut(s, "-")
	if len(primary) < 2 || len(primary) > 3 {
		return false
	}
	for _, r := range primary {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	if !hasRegion {
		return true
	}
	if len(region) < 2 || len(region) > 8 {
		return false
	}
	for _, r := range region {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

// List returns the user's notes, newest first.
func (s *Service) List(ctx context.Context, userID uuid.UUID, f Filter) ([]Note, error) {
	f.Q = strings.TrimSpace(f.Q)
	f.Lang = strings.TrimSpace(f.Lang)
	if len(f.Q) > 200 {
		f.Q = f.Q[:200]
	}
	f.Decision = strings.TrimSpace(f.Decision)
	if f.Decision != "" && !ValidDecision(f.Decision) {
		return nil, fmt.Errorf("%w: the decision is skip, infer, lookup, learn or verify", ErrInvalid)
	}
	if len(f.Terms) > MaxFilterTerms {
		return nil, fmt.Errorf("%w: at most %d terms at once", ErrInvalid, MaxFilterTerms)
	}
	terms := make([]string, 0, len(f.Terms))
	for _, t := range f.Terms {
		if t = strings.TrimSpace(Normalize(t)); t != "" && utf8.RuneCountInString(t) <= MaxTermLen {
			terms = append(terms, t)
		}
	}
	if len(f.Terms) > 0 && len(terms) == 0 {
		// Asked for terms, none of which can be a saved term.
		return []Note{}, nil
	}
	f.Terms = terms
	return s.store.ListNotes(ctx, userID, f)
}

// Get reads one note.
func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*Note, error) {
	return s.store.GetNote(ctx, userID, id)
}

// Update edits a note's fields, or suspends or resumes all its cards, or
// changes its decision. A decision changes here, in one transaction, and
// never by saving the term again: a second save only adds a context.
func (s *Service) Update(ctx context.Context, userID, id uuid.UUID, p NotePatch) (*Note, error) {
	if p.Meaning != nil {
		m := strings.TrimSpace(*p.Meaning)
		if utf8.RuneCountInString(m) > MaxMeaningLen {
			return nil, fmt.Errorf("%w: a meaning has at most %d characters", ErrInvalid, MaxMeaningLen)
		}
		p.Meaning = &m
	}
	if p.Decision != nil {
		d := strings.TrimSpace(*p.Decision)
		if !ValidDecision(d) {
			return nil, fmt.Errorf("%w: the decision is skip, infer, lookup, learn or verify", ErrInvalid)
		}
		p.Decision = &d
	}
	if p.TaskImpact != nil {
		v, err := CheckTaskImpact(*p.TaskImpact)
		if err != nil {
			return nil, err
		}
		p.TaskImpact = &v
	}
	if err := trimProduction(&p); err != nil {
		return nil, err
	}
	decisionSent, recordSent, meaningSent := p.Decision != nil, p.Record != nil, p.Meaning != nil
	// Cards are a word to learn's only (AC5): nothing else may turn one on.
	turnsCardsOn := (p.Production != nil && *p.Production) || (p.Suspended != nil && !*p.Suspended)
	p.Check = func(next NoteState) error {
		if turnsCardsOn && !HasCards(next.Decision) {
			return fmt.Errorf("%w: only a word you chose to learn has cards to review", ErrInvalid)
		}
		// A note from before decisions has an empty record; only a change of
		// decision or record has to bring a full one.
		if decisionSent || recordSent {
			if _, err := CheckRecord(next.Decision, next.Record); err != nil {
				return err
			}
		}
		if (decisionSent || meaningSent) && next.Meaning == "" && NeedsMeaning(next.Decision) {
			return fmt.Errorf("%w: a word to %s needs a meaning", ErrInvalid, next.Decision)
		}
		return checkProduction(next)
	}
	if p.Record != nil {
		rec := make(map[string]string, len(p.Record))
		for k, v := range p.Record {
			rec[k] = strings.TrimSpace(v)
		}
		p.Record = rec
	}
	now := s.now().UTC()
	p.NewCard, p.Now = s.scheduler.NewCard(now), now
	if p.Lang != nil {
		l := strings.TrimSpace(*p.Lang)
		if !ValidLang(l) {
			return nil, fmt.Errorf("%w: %q is not a language code", ErrInvalid, l)
		}
		p.Lang = &l
	}
	var reading, pos string
	if p.Reading != nil {
		reading = strings.TrimSpace(*p.Reading)
		p.Reading = &reading
	}
	if p.POS != nil {
		pos = strings.TrimSpace(*p.POS)
		p.POS = &pos
	}
	if err := checkShortFields(reading, pos); err != nil {
		return nil, err
	}
	return s.store.UpdateNote(ctx, userID, id, p)
}

// Practise is "Practise using it" on a word being learned: the learner's own
// second scenario (and optionally a confusable expression) is saved, and the
// production card is created, or resumed with its schedule kept.
func (s *Service) Practise(ctx context.Context, userID, id uuid.UUID, scenario, confusable string) (*Note, error) {
	on := true
	return s.Update(ctx, userID, id, NotePatch{Scenario: &scenario, Confusable: &confusable, Production: &on})
}

// trimProduction trims the production card's fields and checks their length.
func trimProduction(p *NotePatch) error {
	if p.Scenario != nil {
		v := strings.TrimSpace(*p.Scenario)
		if utf8.RuneCountInString(v) > MaxScenarioLen {
			return fmt.Errorf("%w: a scenario has at most %d characters", ErrInvalid, MaxScenarioLen)
		}
		p.Scenario = &v
	}
	if p.Confusable != nil {
		v := strings.TrimSpace(*p.Confusable)
		if utf8.RuneCountInString(v) > MaxConfusableLen {
			return fmt.Errorf("%w: a confusable expression has at most %d characters", ErrInvalid, MaxConfusableLen)
		}
		p.Confusable = &v
	}
	return nil
}

// checkProduction is the production card's rule: it is asked for on a word
// being learned, with a scenario of the learner's own.
func checkProduction(next NoteState) error {
	if !next.Production {
		return nil
	}
	if next.Scenario == "" {
		return fmt.Errorf("%w: write a scenario of your own first", ErrInvalid)
	}
	return nil
}

// Week counts the words the learner chose to learn in their current week,
// Monday to Sunday in their zone, with up's notice for that many.
func (s *Service) Week(ctx context.Context, userID uuid.UUID) (Week, error) {
	zone, err := s.zones.Timezone(ctx, userID)
	if err != nil {
		return Week{}, err
	}
	n, err := s.store.CountLearnSince(ctx, userID, WeekStart(s.now().UTC(), zone).UTC())
	if err != nil {
		return Week{}, err
	}
	return Week{Learning: n, Notice: WeekNotice(n)}, nil
}

// Delete removes a note and, by cascade, its cards and reviews.
func (s *Service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteNote(ctx, userID, id)
}

// tomorrow is the instant the learner's next calendar day begins. "Due today"
// is everything before it, and a buried sibling moves to it.
func (s *Service) tomorrow(ctx context.Context, userID uuid.UUID, now time.Time) (time.Time, error) {
	zone, err := s.zones.Timezone(ctx, userID)
	if err != nil {
		return time.Time{}, err
	}
	return learning.StartOf(learning.LocalDay(now, zone), zone).AddDate(0, 0, 1).UTC(), nil
}

// Due returns the words due today in the learner's zone, oldest first, at
// most limit (capped at SessionSize), and how many are due in all. limit 0
// returns only the count. Flash cards are never among them.
func (s *Service) Due(ctx context.Context, userID uuid.UUID, limit int) ([]DueCard, int, error) {
	return s.DueDeck(ctx, userID, DeckWords, limit)
}

// DueDeck is Due for either deck: DeckWords, or DeckBook for the living
// books' flash cards.
func (s *Service) DueDeck(ctx context.Context, userID uuid.UUID, deck string, limit int) ([]DueCard, int, error) {
	if deck != DeckWords && deck != DeckBook {
		return nil, 0, fmt.Errorf("%w: the deck is words or book", ErrInvalid)
	}
	if limit < 0 || limit > SessionSize {
		limit = SessionSize
	}
	before, err := s.tomorrow(ctx, userID, s.now().UTC())
	if err != nil {
		return nil, 0, err
	}
	return s.store.DueCards(ctx, userID, deck, before, limit)
}

// NewCard is the FSRS state a new card starts with, on the vocabulary's
// schedule. A living book's flash cards start here too, so they are
// scheduled exactly as a word is.
func (s *Service) NewCard() learning.Card { return s.scheduler.NewCard(s.now().UTC()) }

// CleanFlashCards trims a book block's pairs and checks them against the
// table's limits. It returns the reason for the first pair that breaks one.
func CleanFlashCards(in []FlashCard) ([]FlashCard, error) {
	out := make([]FlashCard, 0, len(in))
	for i, c := range in {
		front, back := strings.TrimSpace(c.Front), strings.TrimSpace(c.Back)
		switch {
		case front == "" || back == "":
			return nil, fmt.Errorf("%w: card %d needs a front and a back", ErrInvalid, i+1)
		case utf8.RuneCountInString(front) > MaxFlashFront:
			return nil, fmt.Errorf("%w: card %d's front is over %d characters", ErrInvalid, i+1, MaxFlashFront)
		case utf8.RuneCountInString(back) > MaxFlashBack:
			return nil, fmt.Errorf("%w: card %d's back is over %d characters", ErrInvalid, i+1, MaxFlashBack)
		}
		out = append(out, FlashCard{Front: front, Back: back})
	}
	return out, nil
}

// ReviewInput is one answer to a card.
type ReviewInput struct {
	Rating    string
	Answer    string
	RequestID uuid.UUID
}

// Review applies the learner's rating to a card. The rating is the learner's
// own — for a cloze card the UI suggests one from the typed answer and the
// learner confirms it — and the server records whether the answer matched.
// A request id that was already applied returns the first result unchanged.
func (s *Service) Review(ctx context.Context, userID, cardID uuid.UUID, in ReviewInput) (*ReviewResult, error) {
	if _, err := learning.ParseRating(in.Rating); err != nil {
		return nil, fmt.Errorf("%w: rating must be one of again, hard, good, easy", ErrInvalid)
	}
	if in.RequestID == uuid.Nil {
		return nil, fmt.Errorf("%w: a review needs a request_id", ErrInvalid)
	}
	answer := strings.TrimSpace(in.Answer)
	if utf8.RuneCountInString(answer) > MaxAnswerLen {
		return nil, fmt.Errorf("%w: that answer is too long", ErrInvalid)
	}

	card, err := s.store.GetCard(ctx, userID, cardID)
	if err != nil {
		return nil, err
	}
	var matched *bool
	// A production card is marked as a cloze is: the typed term, matched.
	if card.Kind == KindCloze || card.Kind == KindProduction {
		m := ClozeMatches(answer, card.Term)
		matched = &m
	} else {
		answer = ""
	}

	now := s.now().UTC()
	bury, err := s.tomorrow(ctx, userID, now)
	if err != nil {
		return nil, err
	}
	return s.store.Review(ctx, ReviewWrite{
		UserID: userID, CardID: cardID, RequestID: in.RequestID,
		Rating: in.Rating, Answer: answer, Matched: matched,
		Now: now, BuryUntil: bury,
		Schedule: func(c learning.Card) (learning.Card, error) {
			return s.scheduler.Next(c, now, in.Rating)
		},
	})
}

// SuggestedRating is the rating a cloze answer suggests: Good for a match,
// accents and case ignored; Again otherwise. The learner confirms it.
func SuggestedRating(answer, term string) string {
	if ClozeMatches(answer, term) {
		return learning.RatingGood
	}
	return learning.RatingAgain
}
