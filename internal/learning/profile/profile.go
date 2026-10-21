// Package profile is the learner profile (the private design notes,
// phase 9): what the learner studies, where they struggle, how they like to be
// taught and what constrains them, as short entries they can see, edit and
// delete.
//
// DeepTutor's memory (findings §8) is the model, minus its three layers. The
// three safeguards kept are the ones that matter:
//
//   - every consolidated statement cites evidence the engine gave it, or it is
//     dropped (guards.go);
//   - wording is hedged, and absolutes are refused at runtime;
//   - the profile is PULLED by the few features that need it (prompt.go),
//     never injected into every prompt.
//
// Red team SF-3 added two more. Consolidation reads engine aggregates only —
// counts, rates, ids and names the engine quotes inside the provenance
// envelope — never explain-back gaps, misconceptions or any other text a
// model wrote from a document (signals.go). And what it writes is a PROPOSAL:
// nothing consolidated reaches a prompt until the learner accepts it.
package profile

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// ErrNotFound is the one answer to "no such row for this user".
var ErrNotFound = errors.New("profile: not found")

// ErrInvalid marks a caller mistake the API answers with 400.
var ErrInvalid = errors.New("profile: invalid")

// ErrSectionFull is returned when a section already holds MaxPerSection
// entries; the API answers 409.
var ErrSectionFull = errors.New("profile: this section is full")

// ErrConflict is returned for an act the entry's state does not allow —
// accepting something that is not a proposal, editing a proposal.
var ErrConflict = errors.New("profile: conflict")

// Sections, exactly as the profile_entries CHECK lists them.
const (
	SectionStudying    = "studying"
	SectionStrengths   = "strengths"
	SectionStruggles   = "struggles"
	SectionPreferences = "preferences"
	SectionConstraints = "constraints"
)

// Sections returns every section in display order.
func Sections() []string {
	return []string{SectionStudying, SectionStrengths, SectionStruggles, SectionPreferences, SectionConstraints}
}

// Who wrote an entry.
const (
	OriginLearner      = "learner"
	OriginConsolidated = "consolidated"
)

// Where an entry stands. Learner entries are always accepted.
const (
	StatusProposed = "proposed"
	StatusAccepted = "accepted"
	StatusRejected = "rejected"
)

// What a proposal does when accepted.
const (
	OpAdd    = "add"
	OpUpdate = "update"
	OpRemove = "remove"
)

// Limits, matching the migration's CHECKs where one exists.
const (
	MaxTextRunes  = 280
	MaxPerSection = 12
	// MaxOpsPerRun is how many operations one consolidation may propose.
	MaxOpsPerRun = 10
	// MaxNameRunes is how much of a knowledge-point or knowledge-base name
	// the consolidation is shown.
	MaxNameRunes = 80
	// RejectCooldown is how long a rejected proposal is not proposed again.
	RejectCooldown = 30 * 24 * time.Hour
)

// Ref kinds: the rows a consolidated statement can cite.
const (
	RefMistake        = "mistake"
	RefKnowledgePoint = "knowledge_point"
	RefKnowledgeBase  = "knowledge_base"
	RefVocabCard      = "vocab_card"
	RefSkillCard      = "skill_card"
)

// RefKinds lists every ref kind.
func RefKinds() []string {
	return []string{RefMistake, RefKnowledgePoint, RefKnowledgeBase, RefVocabCard, RefSkillCard}
}

// Ref is one piece of evidence an entry cites, as stored.
type Ref struct {
	Kind string    `json:"kind"`
	ID   uuid.UUID `json:"id"`
}

// RefView is a ref as Settings shows it, resolved with the owner's user_id
// when read. A row deleted since (or never the owner's) reads back with
// Exists false and no label.
type RefView struct {
	Kind   string    `json:"kind"`
	ID     uuid.UUID `json:"id"`
	Exists bool      `json:"exists"`
	Label  string    `json:"label,omitempty"`
	// ParentID is what a link needs besides the id: the path of a knowledge
	// point, the knowledge base of a mistake.
	ParentID *uuid.UUID `json:"parent_id,omitempty"`
}

// Entry is one statement in the profile.
type Entry struct {
	ID      uuid.UUID `json:"id"`
	UserID  uuid.UUID `json:"-"`
	Section string    `json:"section"`
	Text    string    `json:"text"`
	Refs    []RefView `json:"refs"`
	Origin  string    `json:"origin"`
	Status  string    `json:"status"`
	Op      string    `json:"op"`
	// ReplacesID is the entry an update or remove proposal changes, and
	// ReplacesText what it says now.
	ReplacesID   *uuid.UUID `json:"replaces_id,omitempty"`
	ReplacesText string     `json:"replaces_text,omitempty"`
	KBID         *uuid.UUID `json:"kb_id,omitempty"`
	KBName       string     `json:"kb_name,omitempty"`
	RunID        *uuid.UUID `json:"run_id,omitempty"`
	DecidedAt    *time.Time `json:"decided_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// NewEntry is a learner's entry, after the service has checked it.
type NewEntry struct {
	UserID  uuid.UUID
	Section string
	Text    string
	KBID    *uuid.UUID
}

// EntryPatch is a learner's edit. KBID set to uuid.Nil clears the scope.
type EntryPatch struct {
	Section *string
	Text    *string
	KBID    *uuid.UUID
}

// Run is one consolidation pass.
type Run struct {
	ID         uuid.UUID  `json:"id"`
	UserID     uuid.UUID  `json:"-"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	Status     string     `json:"status"`
	Ops        []RunOp    `json:"ops"`
	Error      string     `json:"error,omitempty"`
	Model      string     `json:"model,omitempty"`
}

// Run statuses, exactly as the profile_runs CHECK lists them.
const (
	RunRunning   = "running"
	RunSucceeded = "succeeded"
	RunSkipped   = "skipped"
	RunFailed    = "failed"
)

// RunOp is one operation a run's model proposed, as the engine judged it.
type RunOp struct {
	Op      string `json:"op"`
	Section string `json:"section,omitempty"`
	Text    string `json:"text,omitempty"`
	// Status is `proposed` (it became a proposal) or `dropped`.
	Status string `json:"status"`
	// Reason says why an operation was dropped.
	Reason string `json:"reason,omitempty"`
}

// Store is the persistence the learner-facing service needs;
// pg.ProfileStore implements it.
type Store interface {
	// List is every entry except rejected proposals, refs resolved.
	List(ctx context.Context, userID uuid.UUID) ([]Entry, error)
	// Create inserts a learner entry, refusing with ErrSectionFull when the
	// section already holds MaxPerSection accepted entries, and with
	// ErrNotFound when KBID is not the learner's knowledge base.
	Create(ctx context.Context, e NewEntry) (*Entry, error)
	// Update edits an accepted entry. The edited entry becomes the learner's
	// own: consolidation never touches it again, and any pending proposal to
	// change it is withdrawn.
	Update(ctx context.Context, userID, id uuid.UUID, p EntryPatch) (*Entry, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
	// Accept applies a proposal; Reject records the learner's no.
	Accept(ctx context.Context, userID, id uuid.UUID, now time.Time) (*Entry, error)
	Reject(ctx context.Context, userID, id uuid.UUID, now time.Time) (*Entry, error)
	// Clear removes every entry, proposals included, and reports how many.
	Clear(ctx context.Context, userID uuid.UUID) (int, error)

	Consolidation(ctx context.Context, userID uuid.UUID) (bool, error)
	SetConsolidation(ctx context.Context, userID uuid.UUID, on bool) error

	Runs(ctx context.Context, userID uuid.UUID, limit int) ([]Run, error)
	Run(ctx context.Context, userID, id uuid.UUID) (*Run, error)
}

// Service is the learner-facing half: entries, proposals and the switch.
type Service struct {
	store Store
	now   func() time.Time
}

// NewService builds the service. now may be nil for the wall clock.
func NewService(store Store, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{store: store, now: now}
}

// Profile is what Settings → Learning profile shows.
type Profile struct {
	Entries       []Entry `json:"entries"`
	Consolidation bool    `json:"consolidation"`
	LastRun       *Run    `json:"last_run"`
	MaxPerSection int     `json:"max_per_section"`
	MaxTextRunes  int     `json:"max_text_runes"`
}

// Get returns the whole profile.
func (s *Service) Get(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	entries, err := s.store.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	on, err := s.store.Consolidation(ctx, userID)
	if err != nil {
		return nil, err
	}
	runs, err := s.store.Runs(ctx, userID, 1)
	if err != nil {
		return nil, err
	}
	p := &Profile{Entries: nonNilEntries(entries), Consolidation: on,
		MaxPerSection: MaxPerSection, MaxTextRunes: MaxTextRunes}
	if len(runs) > 0 {
		p.LastRun = &runs[0]
	}
	return p, nil
}

// Add stores a learner's entry. It needs no refs: the learner is the evidence.
func (s *Service) Add(ctx context.Context, userID uuid.UUID, section, text string, kbID *uuid.UUID) (*Entry, error) {
	section = strings.TrimSpace(section)
	if !slices.Contains(Sections(), section) {
		return nil, fmt.Errorf("%w: unknown section %q", ErrInvalid, section)
	}
	clean, err := checkText(text)
	if err != nil {
		return nil, err
	}
	return s.store.Create(ctx, NewEntry{UserID: userID, Section: section, Text: clean, KBID: kbID})
}

// Edit changes an accepted entry's text, section or knowledge base.
func (s *Service) Edit(ctx context.Context, userID, id uuid.UUID, p EntryPatch) (*Entry, error) {
	if p.Section != nil {
		sec := strings.TrimSpace(*p.Section)
		if !slices.Contains(Sections(), sec) {
			return nil, fmt.Errorf("%w: unknown section %q", ErrInvalid, sec)
		}
		p.Section = &sec
	}
	if p.Text != nil {
		clean, err := checkText(*p.Text)
		if err != nil {
			return nil, err
		}
		p.Text = &clean
	}
	return s.store.Update(ctx, userID, id, p)
}

// Delete removes one entry.
func (s *Service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.Delete(ctx, userID, id)
}

// Accept applies a proposal.
func (s *Service) Accept(ctx context.Context, userID, id uuid.UUID) (*Entry, error) {
	return s.store.Accept(ctx, userID, id, s.now().UTC())
}

// Reject declines a proposal; the same statement is not proposed again for
// RejectCooldown.
func (s *Service) Reject(ctx context.Context, userID, id uuid.UUID) (*Entry, error) {
	return s.store.Reject(ctx, userID, id, s.now().UTC())
}

// Clear removes every entry.
func (s *Service) Clear(ctx context.Context, userID uuid.UUID) (int, error) {
	return s.store.Clear(ctx, userID)
}

// SetConsolidation turns the nightly consolidation on or off.
func (s *Service) SetConsolidation(ctx context.Context, userID uuid.UUID, on bool) error {
	return s.store.SetConsolidation(ctx, userID, on)
}

// Runs lists the latest consolidation runs, newest first.
func (s *Service) Runs(ctx context.Context, userID uuid.UUID) ([]Run, error) {
	runs, err := s.store.Runs(ctx, userID, 20)
	if runs == nil {
		runs = []Run{}
	}
	return runs, err
}

// Run returns one consolidation run.
func (s *Service) Run(ctx context.Context, userID, id uuid.UUID) (*Run, error) {
	return s.store.Run(ctx, userID, id)
}

// checkText trims an entry and folds it onto one line: an entry is a single
// statement, and a line break inside one is a formatting trick in the prompt
// it is later quoted into.
func checkText(text string) (string, error) {
	clean := strings.Join(strings.Fields(text), " ")
	if clean == "" {
		return "", fmt.Errorf("%w: an entry needs some text", ErrInvalid)
	}
	if utf8.RuneCountInString(clean) > MaxTextRunes {
		return "", fmt.Errorf("%w: an entry is at most %d characters", ErrInvalid, MaxTextRunes)
	}
	return clean, nil
}

func nonNilEntries(in []Entry) []Entry {
	if in == nil {
		return []Entry{}
	}
	return in
}
