// Package library is the Library's catalogue in Postgres
// (the private design notes): ready material from open sources,
// the same for every learner, each item with the facts the page filters,
// sorts and shows (field, kind, language, level, hours, year, certificate,
// rating, popularity, licence).
//
// The catalogue is built from the repository's pinned data by
// ui/web/scripts/library/export.mjs and embedded here; Sync loads it into
// Postgres when the stored version differs. Nothing in it belongs to a user.
package library

import (
	"bytes"
	"compress/gzip"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"slices"
	"strings"
	"sync"
	"unicode"

	"github.com/D0bby999/anytools/internal/vocab"
)

//go:embed catalogue.json.gz
var embedded []byte

// The values the page's filters take, in the order the page shows them.
var (
	Kinds    = []string{"deck", "words", "questions", "course", "textbook", "book"}
	Subjects = []string{"business", "economics", "law", "health", "engineering", "programming", "science", "maths",
		"social", "humanities", "education", "media", "languages", "skills", "general", "fitness"}
	Levels       = []string{"beginner", "intermediate", "advanced"}
	Sorts        = []string{"featured", "rating", "popular", "shortest", "newest"}
	Certificates = []string{"any", "free", "paid"}
)

// PageSize is how many items a list answers at once; FieldSample how many
// each field shows on the first screen.
const (
	PageSize    = 30
	FieldSample = 3
	// MaxQuery is the longest search, in characters.
	MaxQuery = 80
)

// Certificate is what finishing an item earns.
type Certificate struct {
	Kind     string   `json:"kind"`
	Name     string   `json:"name,omitempty"`
	PriceMin *float64 `json:"priceMin,omitempty"`
	PriceMax *float64 `json:"priceMax,omitempty"`
	Currency string   `json:"currency,omitempty"`
}

// Rating is a source's reviews: out of 5, how many, each criterion's average.
type Rating struct {
	Value  float64            `json:"value"`
	Count  int                `json:"count"`
	Scores map[string]float64 `json:"scores,omitempty"`
}

// Popularity is how often an item is used, as its source counts.
type Popularity struct {
	Count int64  `json:"count"`
	Kind  string `json:"kind"`
}

// ItemSource names where an item comes from.
type ItemSource struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// Item is one entry, in the shape the web app's LibraryItem has.
type Item struct {
	ID            string          `json:"id"`
	Kind          string          `json:"kind"`
	Subject       string          `json:"subject"`
	Language      string          `json:"language"`
	Name          string          `json:"name"`
	NameKey       string          `json:"nameKey,omitempty"`
	About         string          `json:"about,omitempty"`
	AboutKey      string          `json:"aboutKey,omitempty"`
	Section       string          `json:"section,omitempty"`
	Author        string          `json:"author,omitempty"`
	Count         int             `json:"count,omitempty"`
	Unit          string          `json:"unit,omitempty"`
	Video         bool            `json:"video,omitempty"`
	Level         string          `json:"level,omitempty"`
	Hours         *float64        `json:"hours,omitempty"`
	Year          int             `json:"year,omitempty"`
	Certificate   *Certificate    `json:"certificate,omitempty"`
	Rating        *Rating         `json:"rating,omitempty"`
	Popularity    *Popularity     `json:"popularity,omitempty"`
	Accessibility []string        `json:"accessibility,omitempty"`
	Licence       string          `json:"licence"`
	Source        ItemSource      `json:"source"`
	Credit        string          `json:"credit,omitempty"`
	CreditText    string          `json:"creditText,omitempty"`
	URL           string          `json:"url"`
	Action        json.RawMessage `json:"action"`
}

// LanguageRank puts English first, then material in many languages, then
// the rest (the owner, 2026-10-21: the Library is mostly English).
func (i *Item) LanguageRank() int {
	switch baseLanguage(i.Language) {
	case "en":
		return 0
	case "mul":
		return 1
	}
	return 2
}

func baseLanguage(l string) string {
	base, _, _ := strings.Cut(l, "-")
	return base
}

// Exported is an item as the export carries it.
type Exported struct {
	Item
	Position int    `json:"position"`
	Reusable bool   `json:"reusable"`
	Search   string `json:"search"`
}

// Source is a source with what pins its data.
type Source struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Licence string `json:"licence"`
	Pin     string `json:"pin"`
	Read    string `json:"read"`
}

// Catalogue is the whole export. Sequence grows by one with each export
// whose version differs, so a server never loads an older catalogue over a
// newer one (a binary built before it, restarting during a deploy).
type Catalogue struct {
	Version  string     `json:"version"`
	Sequence int        `json:"sequence"`
	Sources  []Source   `json:"sources"`
	Items    []Exported `json:"items"`
}

var versionPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Embedded reads the catalogue built into the binary and checks what the
// tables' constraints would refuse, so a bad export fails here, by name.
func Embedded() (*Catalogue, error) {
	return parse(embedded)
}

func parse(gz []byte) (*Catalogue, error) {
	r, err := gzip.NewReader(bytes.NewReader(gz))
	if err != nil {
		return nil, fmt.Errorf("library: the catalogue is not gzip: %w", err)
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("library: reading the catalogue: %w", err)
	}
	var c Catalogue
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("library: the catalogue is not JSON: %w", err)
	}
	if !versionPattern.MatchString(c.Version) || c.Sequence < 1 {
		return nil, errors.New("library: the catalogue has no version or sequence")
	}
	sources := map[string]bool{}
	for _, s := range c.Sources {
		sources[s.Name] = true
	}
	ids := map[string]bool{}
	for _, it := range c.Items {
		switch {
		case it.ID == "" || ids[it.ID]:
			return nil, fmt.Errorf("library: item %q is empty or listed twice", it.ID)
		case !slices.Contains(Kinds, it.Kind), !slices.Contains(Subjects, it.Subject):
			return nil, fmt.Errorf("library: item %q has kind %q, field %q", it.ID, it.Kind, it.Subject)
		case it.Level != "" && !slices.Contains(Levels, it.Level):
			return nil, fmt.Errorf("library: item %q has level %q", it.ID, it.Level)
		case !sources[it.Source.Name]:
			return nil, fmt.Errorf("library: item %q names source %q, which is not listed", it.ID, it.Source.Name)
		case it.Certificate != nil && !slices.Contains([]string{"free", "badge", "paid"}, it.Certificate.Kind):
			return nil, fmt.Errorf("library: item %q has certificate %q", it.ID, it.Certificate.Kind)
		case !bytes.HasPrefix(bytes.TrimSpace(it.Action), []byte("{")):
			return nil, fmt.Errorf("library: item %q has no action", it.ID)
		case it.Hours != nil && (*it.Hours < 0.01 || *it.Hours > 100_000):
			return nil, fmt.Errorf("library: item %q takes %v hours", it.ID, *it.Hours)
		case it.Year != 0 && (it.Year < 1000 || it.Year > 2100):
			return nil, fmt.Errorf("library: item %q has year %d", it.ID, it.Year)
		case it.Popularity != nil && (it.Popularity.Count < 0 || it.Popularity.Kind != "views" && it.Popularity.Kind != "downloads"):
			return nil, fmt.Errorf("library: item %q has popularity %+v", it.ID, *it.Popularity)
		case it.Rating != nil && !validRating(it.Rating):
			return nil, fmt.Errorf("library: item %q has rating %+v", it.ID, *it.Rating)
		}
		ids[it.ID] = true
	}
	return &c, nil
}

func validRating(r *Rating) bool {
	if r.Value < 0 || r.Value > 5 || r.Count < 0 {
		return false
	}
	for _, s := range r.Scores {
		if s < 1 || s > 5 {
			return false
		}
	}
	return true
}

// Filter is what the page asks for.
type Filter struct {
	Kind    string
	Subject string
	// Lang is "" (the learner's interface language and English), "all", or one language.
	Lang        string
	UI          string
	Q           string
	Sort        string
	Level       string
	Certificate string
	Video       bool
	Reusable    bool
	Offset      int
}

// ErrBadFilter is a filter value the page never sends.
var ErrBadFilter = errors.New("library: that filter is not one the Library has")

// Normalize checks a filter's values and fills its defaults.
func (f *Filter) Normalize() error {
	for _, c := range []struct {
		v    string
		list []string
	}{{f.Kind, Kinds}, {f.Subject, Subjects}, {f.Level, Levels}, {f.Sort, Sorts}, {f.Certificate, Certificates}} {
		if c.v != "" && !slices.Contains(c.list, c.v) {
			return ErrBadFilter
		}
	}
	if f.Sort == "" {
		f.Sort = "featured"
	}
	if f.Offset < 0 || f.Offset > 100_000 {
		return ErrBadFilter
	}
	if len(f.Lang) > 12 || len(f.UI) > 12 {
		return ErrBadFilter
	}
	if r := []rune(strings.TrimSpace(f.Q)); len(r) > MaxQuery {
		f.Q = string(r[:MaxQuery])
	}
	f.Q = strings.TrimSpace(f.Q)
	return nil
}

// Languages are the languages a filter keeps: nil for every language.
func (f Filter) Languages() []string {
	switch f.Lang {
	case "all":
		return nil
	case "":
		ui := baseLanguage(f.UI)
		if ui == "" || ui == "en" {
			return []string{"en"}
		}
		return []string{ui, "en"}
	}
	return []string{baseLanguage(f.Lang)}
}

// Words are the folded words a search must all contain.
func (f Filter) Words() []string {
	// Split as the web app's search was: on anything not a letter or a digit.
	return strings.FieldsFunc(vocab.Fold(f.Q), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
}

// FieldGroup is one field on the first screen.
type FieldGroup struct {
	Subject string `json:"subject"`
	Total   int    `json:"total"`
	Items   []Item `json:"items"`
}

// Store is the Postgres side.
type Store interface {
	// LoadedCatalogue is the version and sequence loaded: "" and 0 before
	// the first load, or when the tables are not there yet.
	LoadedCatalogue(ctx context.Context) (version string, sequence int, err error)
	// ReplaceCatalogue loads c in one transaction and reports whether it
	// did: without force, not when the same version or a later sequence is
	// already loaded, checked under the lock.
	ReplaceCatalogue(ctx context.Context, c *Catalogue, force bool) (bool, error)
	FindItems(ctx context.Context, f Filter, limit int) (total int, items []Item, err error)
	FieldSamples(ctx context.Context, f Filter, per int) (total int, groups []FieldGroup, err error)
	LibraryItem(ctx context.Context, id string) (*Item, error)
	CatalogueLanguages(ctx context.Context) ([]string, error)
}

// ErrNotFound is an item the catalogue does not have.
var ErrNotFound = errors.New("library: no such item")

// ErrNotLoaded is a Library whose catalogue is not in the database yet.
var ErrNotLoaded = errors.New("library: the catalogue is not loaded yet")

// Service answers the page from the store.
type Service struct {
	store Store
	mu    sync.Mutex
	// langs are the catalogue's languages, for the version in langsOf.
	langs   []string
	langsOf string
}

// NewService returns a Service.
func NewService(store Store) *Service { return &Service{store: store} }

// Sync loads the embedded catalogue unless the same version or a later
// one is loaded; force loads it regardless. It reports whether it loaded.
func (s *Service) Sync(ctx context.Context, force bool) (bool, error) {
	c, err := Embedded()
	if err != nil {
		return false, err
	}
	if !force {
		// A cheap look first, so a restart takes no lock; ReplaceCatalogue
		// decides again under the lock.
		have, seq, err := s.store.LoadedCatalogue(ctx)
		if err != nil {
			return false, err
		}
		if have == c.Version || seq > c.Sequence {
			if seq > c.Sequence {
				slog.Info("library: a later catalogue is loaded; this one is not", "loaded", seq, "this", c.Sequence)
			}
			return false, nil
		}
	}
	loaded, err := s.store.ReplaceCatalogue(ctx, c, force)
	if err != nil || !loaded {
		return false, err
	}
	slog.Info("library: catalogue loaded", "version", c.Version[:12], "sequence", c.Sequence, "items", len(c.Items), "sources", len(c.Sources))
	return true, nil
}

// loaded is the version loaded, or ErrNotLoaded.
func (s *Service) loaded(ctx context.Context) (string, error) {
	v, _, err := s.store.LoadedCatalogue(ctx)
	if err != nil {
		return "", err
	}
	if v == "" {
		return "", ErrNotLoaded
	}
	return v, nil
}

// Find is one page of a list: a field, a search, or every item.
func (s *Service) Find(ctx context.Context, f Filter) (int, []Item, error) {
	if err := f.Normalize(); err != nil {
		return 0, nil, err
	}
	if _, err := s.loaded(ctx); err != nil {
		return 0, nil, err
	}
	return s.store.FindItems(ctx, f, PageSize)
}

// Fields is the first screen: each field's first items and how many it has.
func (s *Service) Fields(ctx context.Context, f Filter) (int, []FieldGroup, error) {
	if err := f.Normalize(); err != nil {
		return 0, nil, err
	}
	if _, err := s.loaded(ctx); err != nil {
		return 0, nil, err
	}
	f.Subject, f.Q, f.Offset = "", "", 0
	return s.store.FieldSamples(ctx, f, FieldSample)
}

// Item is one item by id.
func (s *Service) Item(ctx context.Context, id string) (*Item, error) {
	if id == "" || len(id) > 200 {
		return nil, ErrNotFound
	}
	return s.store.LibraryItem(ctx, id)
}

// Languages are the languages the catalogue has material in, English first,
// kept while the same version is loaded (another server or the import
// command may load a new one).
func (s *Service) Languages(ctx context.Context) ([]string, error) {
	version, err := s.loaded(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	langs, of := s.langs, s.langsOf
	s.mu.Unlock()
	if of == version {
		return langs, nil
	}
	langs, err = s.store.CatalogueLanguages(ctx)
	if err != nil {
		return nil, err
	}
	slices.SortFunc(langs, func(a, b string) int {
		switch {
		case a == b:
			return 0
		case a == "en":
			return -1
		case b == "en":
			return 1
		}
		return strings.Compare(a, b)
	})
	s.mu.Lock()
	s.langs, s.langsOf = langs, version
	s.mu.Unlock()
	return langs, nil
}
