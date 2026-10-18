// Package related suggests recent papers related to a knowledge base, and
// adds one the learner picks (learning-depth phase 6).
//
// The flow is DeepTutor's knowledge frontier (findings §6): a short summary of
// the knowledge base becomes three search queries (a fixed fallback when the
// model call fails), the results are deduplicated and capped, and nothing is
// added until the learner chooses. The list is cached for a day per focus, so
// a revisit costs no model call and no search.
package related

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	researchprompts "github.com/D0bby999/anytools/internal/prompts/research"
	"github.com/D0bby999/anytools/internal/rag/papers"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// Limits.
const (
	maxPapers      = 10
	maxSummary     = 3500
	maxFocus       = 80
	sinceYears     = 5
	cacheFor       = 24 * time.Hour
	focusesPerDay  = 5
	papersPerQuery = 6
)

var (
	// ErrNotFound covers another user's knowledge base and a missing one.
	ErrNotFound = errors.New("related: not found")
	// ErrTooManyFocuses is a sixth distinct focus for one knowledge base in a
	// day: each new focus is a model call and three searches.
	ErrTooManyFocuses = errors.New("related: five different focuses a day per knowledge base; try one you have used")
	// ErrAlreadyAdded is a paper already in the knowledge base.
	ErrAlreadyAdded = errors.New("related: this paper is already in the knowledge base")
)

// List is what the page shows.
type List struct {
	Focus   string         `json:"focus"`
	Queries []string       `json:"queries"`
	Papers  []papers.Paper `json:"papers"`
	// Fallback says the model's queries were not usable and fixed ones ran.
	Fallback bool      `json:"fallback"`
	At       time.Time `json:"at"`
}

// Store is the cache (pg.PaperStore).
type Store interface {
	CachedRelated(ctx context.Context, userID, kbID uuid.UUID, focus string, since time.Time, out any) (bool, error)
	FocusesSince(ctx context.Context, userID, kbID uuid.UUID, since time.Time) (int, error)
	PutRelated(ctx context.Context, userID, kbID uuid.UUID, focus string, payload any) error
}

// KB reads a knowledge base, scoped to its owner: its name and its
// documents' titles. An error means "not yours or not there".
type KB interface {
	Describe(ctx context.Context, userID, kbID uuid.UUID) (name string, titles []string, err error)
}

// Retriever reads passages of one knowledge base, scoped to its owner.
type Retriever interface {
	Passages(ctx context.Context, userID, kbID uuid.UUID, query string, limit int) ([]string, error)
}

// Papers searches and reads works on the user's key or keyless budget.
type Papers interface {
	Recent(ctx context.Context, userID uuid.UUID, query string, limit, sinceYears int) ([]papers.Paper, error)
	Work(ctx context.Context, userID uuid.UUID, id string) (*papers.Paper, error)
}

// Documents adds a file to a knowledge base through the ordinary upload path.
// It returns ErrAlreadyAdded (or wraps it) for a duplicate.
type Documents interface {
	AddDocument(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) error
}

// Pages fetches an open-access PDF (security.FetchClient: public addresses,
// bounded size, HTML or PDF only).
type Pages interface {
	FetchPage(ctx context.Context, url string) (data []byte, contentType string, err error)
}

// Service suggests and adds related papers.
type Service struct {
	store     Store
	kbs       KB
	retriever Retriever
	models    runtime.ChatProviderResolver
	papers    Papers
	docs      Documents
	pages     Pages
	now       func() time.Time
}

// Deps are the service's collaborators.
type Deps struct {
	Store     Store
	KBs       KB
	Retriever Retriever
	Models    runtime.ChatProviderResolver
	Papers    Papers
	Documents Documents
	Pages     Pages
	Now       func() time.Time
}

// NewService builds the service.
func NewService(d Deps) *Service {
	if d.Now == nil {
		d.Now = time.Now
	}
	return &Service{store: d.Store, kbs: d.KBs, retriever: d.Retriever, models: d.Models,
		papers: d.Papers, docs: d.Documents, pages: d.Pages, now: d.Now}
}

// NormalizeFocus trims, lower-cases, folds whitespace and caps a focus, so
// "Transformers " and "transformers" are one cache entry and one allowance.
func NormalizeFocus(focus string) string {
	f := strings.ToLower(strings.Join(strings.Fields(focus), " "))
	if utf8.RuneCountInString(f) > maxFocus {
		f = string([]rune(f)[:maxFocus])
	}
	return f
}

// Related returns the knowledge base's related papers for a focus ("" for
// the whole knowledge base).
func (s *Service) Related(ctx context.Context, userID, kbID uuid.UUID, focus string) (*List, error) {
	name, titles, err := s.kbs.Describe(ctx, userID, kbID)
	if err != nil {
		return nil, ErrNotFound
	}
	focus = NormalizeFocus(focus)
	now := s.now()
	var cached List
	if ok, err := s.store.CachedRelated(ctx, userID, kbID, focus, now.Add(-cacheFor), &cached); err != nil {
		return nil, err
	} else if ok {
		return &cached, nil
	}
	if n, err := s.store.FocusesSince(ctx, userID, kbID, now.Add(-cacheFor)); err != nil {
		return nil, err
	} else if n >= focusesPerDay {
		return nil, ErrTooManyFocuses
	}

	queries, fallback := s.queries(ctx, userID, kbID, name, titles, focus)
	list := &List{Focus: focus, Queries: queries, Fallback: fallback, At: now, Papers: []papers.Paper{}}
	seen := map[string]bool{}
	var lastErr error
	for _, q := range queries {
		found, err := s.papers.Recent(ctx, userID, q, papersPerQuery, sinceYears)
		if err != nil {
			lastErr = err
			continue
		}
		for _, p := range found {
			key := strings.ToLower(p.DOI)
			if key == "" {
				key = strings.ToLower(strings.Join(strings.Fields(p.Title), " "))
			}
			if seen[key] || len(list.Papers) >= maxPapers {
				continue
			}
			seen[key] = true
			list.Papers = append(list.Papers, p)
		}
	}
	// Every search failed: that is an error to show, not "no papers", and
	// not something to cache for a day.
	if len(list.Papers) == 0 && lastErr != nil {
		return nil, lastErr
	}
	if err := s.store.PutRelated(ctx, userID, kbID, focus, list); err != nil {
		return nil, err
	}
	return list, nil
}

// queries asks the learner's research model for three search queries from a
// summary of the knowledge base, and falls back to fixed ones.
func (s *Service) queries(ctx context.Context, userID, kbID uuid.UUID, name string, titles []string, focus string) ([]string, bool) {
	subject := name
	if focus != "" {
		subject = focus
	}
	fallback := []string{subject, "recent advances " + subject, "open problems " + subject}

	passages, err := s.retriever.Passages(ctx, userID, kbID, "key concepts, methods and open questions", 8)
	if err != nil {
		passages = nil
	}
	var summary strings.Builder
	summary.WriteString("Documents: " + strings.Join(titles, "; ") + "\n\n")
	for _, p := range passages {
		if summary.Len()+len(p) > maxSummary {
			break
		}
		summary.WriteString(p + "\n\n")
	}
	provider, err := s.models.ChatFor(ctx, userID, "research")
	if err != nil {
		return fallback, true
	}
	user := tools.Wrap(name, "kb", truncate(summary.String(), maxSummary))
	if focus != "" {
		user += "\n\nThe learner's focus: " + focus
	}
	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: provider.DefaultModel(),
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: researchprompts.RelatedQueries},
			{Role: runtime.RoleUser, Content: user},
		},
	})
	if err != nil || resp == nil {
		return fallback, true
	}
	var out struct {
		Queries []string `json:"queries"`
	}
	payload, ok := modeljson.Extract(resp.Content)
	if !ok || json.Unmarshal([]byte(payload), &out) != nil {
		return fallback, true
	}
	var qs []string
	for _, q := range out.Queries {
		q = strings.Join(strings.Fields(q), " ")
		if q != "" && utf8.RuneCountInString(q) <= 120 {
			qs = append(qs, q)
		}
		if len(qs) == 3 {
			break
		}
	}
	if len(qs) == 0 {
		return fallback, true
	}
	return qs, false
}

// Added says how a paper went into the knowledge base.
type Added struct {
	Title string `json:"title"`
	// AsPDF is true when the open-access PDF was imported; false when a
	// Markdown document with the metadata, the abstract and a link was.
	AsPDF bool `json:"as_pdf"`
}

// Add puts a paper into the knowledge base. The work is re-read from OpenAlex
// by its id: no URL, title or file comes from the client. The PDF is stored
// only under an open licence (cc-*); otherwise, as arXiv's terms ask, the
// paper is represented by its metadata, abstract and a link.
func (s *Service) Add(ctx context.Context, userID, kbID uuid.UUID, workID string) (*Added, error) {
	if _, _, err := s.kbs.Describe(ctx, userID, kbID); err != nil {
		return nil, ErrNotFound
	}
	p, err := s.papers.Work(ctx, userID, workID)
	if err != nil {
		return nil, err
	}
	name := safeFilename(p.Title)
	if p.OpenLicence() && p.PDFURL != "" {
		data, ct, err := s.pages.FetchPage(ctx, p.PDFURL)
		if err == nil && strings.Contains(ct, "application/pdf") {
			if err := s.docs.AddDocument(ctx, userID, kbID, name+".pdf", data); err != nil {
				return nil, err
			}
			return &Added{Title: p.Title, AsPDF: true}, nil
		}
		// The PDF could not be fetched: the metadata still goes in.
	}
	if err := s.docs.AddDocument(ctx, userID, kbID, name+".md", []byte(Markdown(*p))); err != nil {
		return nil, err
	}
	return &Added{Title: p.Title}, nil
}

// Markdown is a paper as a knowledge-base document: what it is and where it
// lives, never the paper itself.
func Markdown(p papers.Paper) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", p.Title)
	if len(p.Authors) > 0 {
		fmt.Fprintf(&b, "**Authors:** %s\n\n", strings.Join(p.Authors, ", "))
	}
	if p.Year > 0 {
		fmt.Fprintf(&b, "**Year:** %d · cited %d times\n\n", p.Year, p.Citations)
	}
	if p.DOI != "" {
		fmt.Fprintf(&b, "**DOI:** %s\n\n", p.DOI)
	}
	fmt.Fprintf(&b, "**Read it at:** %s\n\n", p.URL)
	if p.Abstract != "" {
		fmt.Fprintf(&b, "## Abstract\n\n%s\n\n", p.Abstract)
	}
	b.WriteString("_Added from OpenAlex as a reference: the paper itself is not stored here._\n")
	return b.String()
}

var unsafeFilename = regexp.MustCompile(`[^\p{L}\p{N} ._-]+`)

func safeFilename(title string) string {
	f := strings.TrimSpace(unsafeFilename.ReplaceAllString(title, " "))
	f = strings.Join(strings.Fields(f), " ")
	if f == "" {
		f = "paper"
	}
	return truncate(f, 100)
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
