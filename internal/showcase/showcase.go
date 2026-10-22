// Package showcase is a learner's public profile at /u/<handle>
// (the private design notes): a page they can send to prove how they
// study, or to show it off.
//
// Two kinds of thing are on it, and the page keeps them apart:
//   - what AnyLearn counted (study days, streak, weeks, level, calendar,
//     milestones, outcomes), which the learner cannot edit;
//   - what the learner wrote (name, headline, about blocks, links).
//
// How it looks is a Design: a versioned document of a theme and blocks
// (design.go), so letting learners design their page later is a matter of new
// block types and options, not of a new page.
//
// Nothing is public until the learner publishes, and the public read sends
// the counted data of the blocks on the page only. A published page the
// learner lets search engines list (Indexed) is in the sitemap.
package showcase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/progress"
)

// Limits of the learner's own words at the top of the page.
const (
	MaxName     = 60
	MaxHeadline = 120
)

// Errors the API maps to statuses.
var (
	// ErrNotFound is a handle with no page, or a page not published: alike
	// to a visitor. (A learner choosing a handle is told it is taken, draft
	// or not; saving is limited to the "social" route class's pace.)
	ErrNotFound = errors.New("showcase: not found")
	ErrInvalid  = errors.New("showcase: invalid")
	// ErrHandleTaken is a handle another learner has.
	ErrHandleTaken = errors.New("showcase: that handle is taken; choose another")

	errHandle   = fmt.Errorf("%w: a handle is 3 to 30 characters: letters a to z, digits and single hyphens inside", ErrInvalid)
	errReserved = fmt.Errorf("%w: that handle is reserved; choose another", ErrInvalid)
	errName     = fmt.Errorf("%w: name must be 1 to 60 characters", ErrInvalid)
	errHeadline = fmt.Errorf("%w: headline must be at most 120 characters", ErrInvalid)
)

var handleRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$`)

// reserved handles read as the site speaking, or as one of its pages.
var reserved = map[string]bool{
	"admin": true, "administrator": true, "anytools": true, "anylearn": true, "anyprofile": true,
	"api": true, "app": true, "help": true, "support": true, "settings": true, "login": true,
	"logout": true, "signup": true, "signin": true, "root": true, "system": true, "staff": true,
	"team": true, "official": true, "moderator": true, "security": true, "www": true, "mail": true,
	"null": true, "undefined": true, "about": true, "privacy": true, "terms": true, "contact": true,
	"showcase": true, "home": true, "me": true,
}

// NormalizeHandle reads a handle as typed: trimmed, lower case, without a
// leading @.
func NormalizeHandle(s string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(s), "@"))
}

// CheckHandle checks a normalized handle.
func CheckHandle(h string) error {
	if !handleRE.MatchString(h) || strings.Contains(h, "--") {
		return errHandle
	}
	if reserved[h] {
		return errReserved
	}
	return nil
}

// Profile is a learner's page as stored.
type Profile struct {
	Handle    string `json:"handle"`
	Name      string `json:"name"`
	Headline  string `json:"headline"`
	Published bool   `json:"published"`
	// Indexed lets search engines list the page while it is published.
	Indexed   bool      `json:"indexed"`
	Design    Design    `json:"design"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Input is what the editor saves. The design comes raw, for ParseDesign.
type Input struct {
	Handle    string          `json:"handle"`
	Name      string          `json:"name"`
	Headline  string          `json:"headline"`
	Published bool            `json:"published"`
	Indexed   bool            `json:"indexed"`
	Design    json.RawMessage `json:"design"`
}

// Stored is a row before its design is read.
type Stored struct {
	Handle    string
	Name      string
	Headline  string
	Published bool
	Indexed   bool
	Design    []byte
	UpdatedAt time.Time
}

// Listed is a page in the sitemap.
type Listed struct {
	Handle    string    `json:"handle"`
	UpdatedAt time.Time `json:"updated_at"`
}

// MaxListed is how many pages the sitemap lists, newest change first: one
// sitemap file holds 50,000 addresses, and the site's own pages need room.
const MaxListed = 45000

// Store keeps pages.
type Store interface {
	// Get is the learner's page, or nil.
	Get(ctx context.Context, user uuid.UUID) (*Stored, error)
	// Published is the published page with the handle and its learner, or
	// ErrNotFound.
	Published(ctx context.Context, handle string) (uuid.UUID, *Stored, error)
	// Save writes the learner's page; ErrHandleTaken when another has the
	// handle. It returns when it was saved.
	Save(ctx context.Context, user uuid.UUID, p Profile, design []byte) (time.Time, error)
	Delete(ctx context.Context, user uuid.UUID) error
	// Listed are published pages that may be indexed, newest change first.
	Listed(ctx context.Context, limit int) ([]Listed, error)
}

// Counter counts a learner's study (progress.Service).
type Counter interface {
	SummaryWithin(ctx context.Context, user uuid.UUID, fresh time.Duration) (*progress.Summary, error)
}

// Service answers pages.
type Service struct {
	store   Store
	counter Counter
}

// NewService builds a Service.
func NewService(store Store, counter Counter) *Service {
	return &Service{store: store, counter: counter}
}

// Stats is what AnyLearn counted, for the blocks that show it. A block not on
// the page leaves its part null, so it never leaves the server.
type Stats struct {
	// AsOf is the learner's today, the day the numbers are counted through;
	// only when a counted block is on the page.
	AsOf string `json:"as_of,omitempty"`
	// Since is the learner's first study day, with the summary block only.
	Since      string              `json:"since,omitempty"`
	Summary    *Summary            `json:"summary"`
	Calendar   []progress.DayCount `json:"calendar"`
	Milestones []Milestone         `json:"milestones"`
	Outcomes   *Outcomes           `json:"outcomes"`
}

// Milestone is a milestone reached. Not progress.Milestone, whose value is
// the learner's current count of its kind: a page showing milestones only
// would send the totals of the blocks it hides.
type Milestone struct {
	Kind      string `json:"kind"`
	Target    int    `json:"target"`
	ReachedOn string `json:"reached_on"`
}

// Summary is the summary block's numbers.
type Summary struct {
	Days          int `json:"days"`
	Streak        int `json:"streak"`
	LongestStreak int `json:"longest_streak"`
	WeekGoal      int `json:"week_goal"`
	WeeksInARow   int `json:"weeks_in_a_row"`
	LongestWeeks  int `json:"longest_weeks"`
	Level         int `json:"level"`
}

// Outcomes is the outcomes block's numbers: totals, never a share right,
// which a visitor could read without its context.
type Outcomes struct {
	LongTerm       int `json:"long_term"`
	Mastered       int `json:"mastered"`
	ExplainsPassed int `json:"explains_passed"`
	Answered       int `json:"answered"`
	Workouts       int `json:"workouts"`
}

// Page is a page as shown: the learner's words, the design and the counts.
type Page struct {
	Profile Profile `json:"profile"`
	Stats   Stats   `json:"stats"`
}

// Mine is the editor's view: the learner's page (nil before the first save)
// and every count, so the preview can show any block.
type Mine struct {
	Profile *Profile `json:"profile"`
	// Dropped is how many stored blocks this version could not take and
	// left out (-1: none of the design could be read); saving keeps the page
	// without them, which the editor says first.
	Dropped int    `json:"dropped,omitempty"`
	Default Design `json:"default_design"`
	Stats   Stats  `json:"stats"`
}

// How old a count the pages take: the editor a minute, as Home; a visitor's
// view ten minutes, as a study circle, so views cannot make the server count.
const (
	freshForOwner   = progress.FreshForHome
	freshForVisitor = progress.FreshForCircle
)

// Mine is the learner's page and their counts.
func (s *Service) Mine(ctx context.Context, user uuid.UUID) (*Mine, error) {
	st, err := s.store.Get(ctx, user)
	if err != nil {
		return nil, err
	}
	sum, err := s.counter.SummaryWithin(ctx, user, freshForOwner)
	if err != nil {
		return nil, err
	}
	out := &Mine{Default: DefaultDesign(), Stats: statsOf(sum, all)}
	if st != nil {
		p, dropped := profileOf(st)
		out.Profile, out.Dropped = &p, dropped
	}
	return out, nil
}

// Save checks and writes the learner's page.
func (s *Service) Save(ctx context.Context, user uuid.UUID, in Input) (*Profile, error) {
	p := Profile{Handle: NormalizeHandle(in.Handle), Published: in.Published, Indexed: in.Indexed}
	if err := CheckHandle(p.Handle); err != nil {
		return nil, err
	}
	var err error
	if p.Name, err = cleanText(in.Name, 1, MaxName, false, errName); err != nil {
		return nil, err
	}
	if p.Headline, err = cleanText(in.Headline, 0, MaxHeadline, false, errHeadline); err != nil {
		return nil, err
	}
	design, err := ParseDesign(in.Design)
	if err != nil {
		return nil, err
	}
	design.Version = DesignVersion
	p.Design = design
	raw, err := json.Marshal(design)
	if err != nil {
		return nil, err
	}
	if p.UpdatedAt, err = s.store.Save(ctx, user, p, raw); err != nil {
		return nil, err
	}
	return &p, nil
}

// Delete removes the learner's page; its handle is free again.
func (s *Service) Delete(ctx context.Context, user uuid.UUID) error {
	return s.store.Delete(ctx, user)
}

// Listed are the pages for the sitemap.
func (s *Service) Listed(ctx context.Context) ([]Listed, error) {
	return s.store.Listed(ctx, MaxListed)
}

// Read is the published page with the handle, as a visitor sees it.
func (s *Service) Read(ctx context.Context, handle string) (*Page, error) {
	handle = NormalizeHandle(handle)
	if CheckHandle(handle) != nil {
		return nil, ErrNotFound
	}
	user, st, err := s.store.Published(ctx, handle)
	if err != nil {
		return nil, err
	}
	p, _ := profileOf(st)
	page := &Page{Profile: p}
	if !p.Design.counted() {
		return page, nil // nothing counted on the page, so nothing to count
	}
	sum, err := s.counter.SummaryWithin(ctx, user, freshForVisitor)
	if err != nil {
		return nil, err
	}
	page.Stats = statsOf(sum, p.Design.Shows)
	return page, nil
}

// profileOf reads a stored page, leniently (readDesign).
func profileOf(st *Stored) (Profile, int) {
	d, dropped := readDesign(st.Design)
	if dropped != 0 {
		slog.Warn("showcase: stored blocks could not be read", "handle", st.Handle, "dropped", dropped)
	}
	return Profile{Handle: st.Handle, Name: st.Name, Headline: st.Headline, Published: st.Published, Indexed: st.Indexed, Design: d, UpdatedAt: st.UpdatedAt}, dropped
}

func all(string) bool { return true }

// statsOf takes from the summary the counts of the blocks shown.
func statsOf(sum *progress.Summary, shows func(string) bool) Stats {
	out := Stats{AsOf: sum.Today}
	if shows(BlockSummary) {
		out.Since = sum.FirstDay
		out.Summary = &Summary{
			Days:          sum.Level.Days,
			Streak:        sum.Streak.Current,
			LongestStreak: sum.Streak.Longest,
			WeekGoal:      sum.Settings.WeekGoal,
			WeeksInARow:   sum.Week.InARow,
			LongestWeeks:  sum.Week.Longest,
			Level:         sum.Level.Level,
		}
	}
	if shows(BlockCalendar) {
		out.Calendar = append([]progress.DayCount{}, sum.Calendar...)
	}
	if shows(BlockMilestones) {
		out.Milestones = []Milestone{}
		for _, m := range sum.Milestones {
			if m.ReachedOn != "" {
				out.Milestones = append(out.Milestones, Milestone{Kind: m.Kind, Target: m.Target, ReachedOn: m.ReachedOn})
			}
		}
	}
	if shows(BlockOutcomes) {
		out.Outcomes = &Outcomes{
			LongTerm:       sum.Outcomes.LongTerm,
			Mastered:       sum.Outcomes.Mastered,
			ExplainsPassed: sum.Outcomes.ExplainsPassed,
			Answered:       sum.Totals.Questions,
			Workouts:       sum.Totals.Workouts,
		}
	}
	return out
}
