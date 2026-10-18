package related_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/related"
	"github.com/D0bby999/anytools/internal/rag/papers"
	"github.com/D0bby999/anytools/internal/runtime"
)

type memCache struct {
	rows map[string][]byte
	at   map[string]time.Time
}

func (m *memCache) key(kb uuid.UUID, focus string) string { return kb.String() + "|" + focus }
func (m *memCache) CachedRelated(_ context.Context, _, kb uuid.UUID, focus string, since time.Time, out any) (bool, error) {
	raw, ok := m.rows[m.key(kb, focus)]
	if !ok || m.at[m.key(kb, focus)].Before(since) {
		return false, nil
	}
	return true, json.Unmarshal(raw, out)
}
func (m *memCache) FocusesSince(_ context.Context, _, kb uuid.UUID, since time.Time) (int, error) {
	n := 0
	for k, at := range m.at {
		if strings.HasPrefix(k, kb.String()) && !at.Before(since) {
			n++
		}
	}
	return n, nil
}
func (m *memCache) PutRelated(_ context.Context, _, kb uuid.UUID, focus string, payload any) error {
	raw, _ := json.Marshal(payload)
	m.rows[m.key(kb, focus)], m.at[m.key(kb, focus)] = raw, time.Now()
	return nil
}

type kbs struct{ owner uuid.UUID }

func (k kbs) Describe(_ context.Context, user, _ uuid.UUID) (string, []string, error) {
	if user != k.owner {
		return "", nil, errors.New("not found")
	}
	return "Retrieval papers", []string{"rag.pdf"}, nil
}

type retriever struct{}

func (retriever) Passages(context.Context, uuid.UUID, uuid.UUID, string, int) ([]string, error) {
	return []string{"Retrieval fetches passages."}, nil
}

type model struct {
	reply string
	calls int
}

func (m *model) Name() string         { return "fake" }
func (m *model) DefaultModel() string { return "m" }
func (m *model) Chat(context.Context, runtime.ChatRequest) (*runtime.ChatResponse, error) {
	m.calls++
	if m.reply == "" {
		return nil, errors.New("down")
	}
	return &runtime.ChatResponse{Content: m.reply}, nil
}
func (m *model) ChatStream(ctx context.Context, r runtime.ChatRequest, _ func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
	return m.Chat(ctx, r)
}

type models struct{ m *model }

func (r models) ChatFor(context.Context, uuid.UUID, string) (runtime.ChatProvider, error) {
	return r.m, nil
}

type fakePapers struct {
	queries []string
	work    papers.Paper
	err     error
}

func (f *fakePapers) Recent(_ context.Context, _ uuid.UUID, q string, _, since int) ([]papers.Paper, error) {
	f.queries = append(f.queries, q)
	if f.err != nil {
		return nil, f.err
	}
	return []papers.Paper{
		{ID: "W1", DOI: "10.1/a", Title: "Shared paper"},
		{ID: "W" + q, Title: "Only for " + q},
	}, nil
}
func (f *fakePapers) Work(_ context.Context, _ uuid.UUID, id string) (*papers.Paper, error) {
	w := f.work
	w.ID = id
	return &w, nil
}

type docs struct{ added map[string][]byte }

func (d *docs) AddDocument(_ context.Context, _, _ uuid.UUID, name string, data []byte) error {
	d.added[name] = data
	return nil
}

type pages struct{ fetched []string }

func (p *pages) FetchPage(_ context.Context, url string) ([]byte, string, error) {
	p.fetched = append(p.fetched, url)
	return []byte("%PDF-1.7"), "application/pdf", nil
}

type fixture struct {
	svc   *related.Service
	m     *model
	p     *fakePapers
	docs  *docs
	pages *pages
	user  uuid.UUID
	kb    uuid.UUID
}

func newFixture(reply string) *fixture {
	f := &fixture{m: &model{reply: reply}, p: &fakePapers{}, docs: &docs{added: map[string][]byte{}}, pages: &pages{},
		user: uuid.New(), kb: uuid.New()}
	f.svc = related.NewService(related.Deps{
		Store: &memCache{rows: map[string][]byte{}, at: map[string]time.Time{}}, KBs: kbs{owner: f.user},
		Retriever: retriever{}, Models: models{f.m}, Papers: f.p, Documents: f.docs, Pages: f.pages,
	})
	return f
}

func TestRelatedUsesTheModelsQueriesDedupesAndCaches(t *testing.T) {
	f := newFixture(`{"queries":["dense retrieval","rag evaluation","retrieval open problems"]}`)
	list, err := f.svc.Related(context.Background(), f.user, f.kb, "")
	if err != nil {
		t.Fatal(err)
	}
	if list.Fallback || len(f.p.queries) != 3 || f.p.queries[0] != "dense retrieval" {
		t.Fatalf("queries = %v (fallback %v)", f.p.queries, list.Fallback)
	}
	if len(list.Papers) != 4 {
		t.Fatalf("%d papers; the shared DOI must appear once", len(list.Papers))
	}
	if _, err := f.svc.Related(context.Background(), f.user, f.kb, ""); err != nil {
		t.Fatal(err)
	}
	if f.m.calls != 1 || len(f.p.queries) != 3 {
		t.Fatalf("a second visit made %d model calls and %d searches", f.m.calls, len(f.p.queries))
	}
}

func TestRelatedFallsBackWhenTheModelFails(t *testing.T) {
	f := newFixture("")
	list, err := f.svc.Related(context.Background(), f.user, f.kb, "  Dense   RETRIEVAL ")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"dense retrieval", "recent advances dense retrieval", "open problems dense retrieval"}
	if !list.Fallback || strings.Join(f.p.queries, "|") != strings.Join(want, "|") || list.Focus != "dense retrieval" {
		t.Fatalf("queries = %v, focus %q", f.p.queries, list.Focus)
	}
}

// An outage is an error, never an empty list, and is not cached.
func TestRelatedReportsAnOutage(t *testing.T) {
	f := newFixture("")
	f.p.err = &papers.Error{Host: "api.openalex.org", Status: 503}
	if _, err := f.svc.Related(context.Background(), f.user, f.kb, ""); err == nil {
		t.Fatal("an outage came back as a list")
	}
	f.p.err = nil
	if list, err := f.svc.Related(context.Background(), f.user, f.kb, ""); err != nil || len(list.Papers) == 0 {
		t.Fatalf("after the outage: %v, %v", list, err)
	}
}

// Red team SF-6: a sixth distinct focus in a day makes no model call.
func TestASixthFocusInADayIsRefused(t *testing.T) {
	f := newFixture(`{"queries":["q"]}`)
	for i := 0; i < 5; i++ {
		if _, err := f.svc.Related(context.Background(), f.user, f.kb, "topic "+string(rune('a'+i))); err != nil {
			t.Fatal(err)
		}
	}
	calls := f.m.calls
	if _, err := f.svc.Related(context.Background(), f.user, f.kb, "topic f"); !errors.Is(err, related.ErrTooManyFocuses) {
		t.Fatalf("sixth focus: %v", err)
	}
	if f.m.calls != calls {
		t.Fatal("the refused focus made a model call")
	}
	// A focus already used today is still served, from the cache.
	if _, err := f.svc.Related(context.Background(), f.user, f.kb, "Topic A"); err != nil {
		t.Fatalf("a used focus: %v", err)
	}
}

func TestAddImportsThePDFOnlyUnderAnOpenLicence(t *testing.T) {
	f := newFixture("")
	f.p.work = papers.Paper{Title: "Open paper", License: "cc-by", PDFURL: "https://arxiv.org/pdf/1", URL: "https://doi.org/1"}
	added, err := f.svc.Add(context.Background(), f.user, f.kb, "W1")
	if err != nil || !added.AsPDF || f.docs.added["Open paper.pdf"] == nil || f.pages.fetched[0] != "https://arxiv.org/pdf/1" {
		t.Fatalf("open paper: %+v, %v, %v", added, err, f.docs.added)
	}

	f = newFixture("")
	f.p.work = papers.Paper{Title: "Closed/paper", License: "publisher-specific", PDFURL: "https://pub.example/p.pdf",
		URL: "https://doi.org/2", Abstract: "An abstract."}
	added, err = f.svc.Add(context.Background(), f.user, f.kb, "W2")
	if err != nil || added.AsPDF || len(f.pages.fetched) != 0 {
		t.Fatalf("closed paper fetched its PDF: %+v, %v", added, err)
	}
	md := string(f.docs.added["Closed paper.md"])
	if !strings.Contains(md, "https://doi.org/2") || !strings.Contains(md, "An abstract.") {
		t.Fatalf("markdown = %q (files %v)", md, f.docs.added)
	}
}

func TestAnotherUsersKnowledgeBaseIsNotFound(t *testing.T) {
	f := newFixture("")
	if _, err := f.svc.Related(context.Background(), uuid.New(), f.kb, ""); !errors.Is(err, related.ErrNotFound) {
		t.Fatalf("related: %v", err)
	}
	if _, err := f.svc.Add(context.Background(), uuid.New(), f.kb, "W1"); !errors.Is(err, related.ErrNotFound) {
		t.Fatalf("add: %v", err)
	}
	if len(f.p.queries) != 0 || f.m.calls != 0 {
		t.Fatal("another user's request reached the model or the search")
	}
}
