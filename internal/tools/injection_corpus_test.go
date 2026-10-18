package tools

// injection_corpus_test.go — phase 11's extension of the corpus: the
// properties CODE must hold for every fixture, whatever a model does with it.
//
// Model behaviour (does it refuse an override written in Vietnamese?) is not
// asserted here and cannot be without a model. What is asserted is that when a
// model DOES obey a fixture, the tool it calls refuses, and that no fixture can
// forge or smuggle its way out of the envelope as a model reads it.

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
)

func TestTheCorpusHasAtLeastThirtyTechniques(t *testing.T) {
	if n := len(loadCorpus(t)); n < 30 {
		t.Fatalf("the injection corpus has %d fixtures; phase 11 requires at least 30", n)
	}
}

// Every fixture, read the way a model reads it, stays inside one envelope and
// carries no invisible tag characters — and its visible text is still there.
func TestEveryFixtureStaysInsideOneEnvelopeAsAModelReadsIt(t *testing.T) {
	for name, body := range loadCorpus(t) {
		t.Run(name, func(t *testing.T) {
			wrapped := Wrap(name, "chunk:1", body)
			assertOneEnvelope(t, wrapped)
			for _, r := range wrapped {
				if r >= 0xE0000 && r <= 0xE007F {
					t.Fatalf("an invisible tag character survived")
				}
			}
			// The attempt stays legible: some visible word of it is present.
			words := strings.Fields(stripTagCharacters(body))
			if len(words) > 0 && !strings.Contains(wrapped, words[len(words)-1]) {
				t.Fatalf("fixture text was stripped rather than neutralised")
			}
		})
	}
}

var anyURL = regexp.MustCompile(`https?://[^\s)\]"'>]+`)

// Fixtures that tell the model to fetch a URL — carrying the user's data in the
// query string, or aimed at the metadata service or an internal host. Obeyed,
// each ends in web_fetch refusing BEFORE any request leaves the process,
// because the URL is not one this turn's web search returned.
func TestURLsNamedByADocumentAreNeverFetched(t *testing.T) {
	corpus := loadCorpus(t)
	var requests atomic.Int32
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		t.Errorf("a request left the process: %s", r.URL)
		return nil, http.ErrUseLastResponse
	})}
	tool := NewWebFetch(client)

	book := citations.NewURLBook()
	book.ID("https://en.wikipedia.org/wiki/Retrieval-augmented_generation")
	in := runtime.ToolInput{UserID: uuid.New(), URLs: book}

	checked := 0
	for _, name := range []string{
		"web-fetch-exfiltration.txt", "web-fetch-metadata.txt", "web-fetch-internal-host.txt",
		"markdown-image-exfiltration.txt", "link-exfiltration.txt",
	} {
		body, ok := corpus[name]
		if !ok {
			t.Fatalf("%s is missing from the corpus", name)
		}
		for _, u := range anyURL.FindAllString(body, -1) {
			checked++
			res, err := tool.Execute(context.Background(), map[string]any{"url": u + "the-users-question"}, in)
			if err != nil || !res.IsError {
				t.Errorf("%s: web_fetch(%s) was not refused: %+v %v", name, u, res, err)
			}
		}
	}
	if checked < 5 || requests.Load() != 0 {
		t.Fatalf("checked %d URLs, %d requests made", checked, requests.Load())
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

var anyUUID = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)

// A document naming another knowledge base or another user's document: the
// tool the model would call refuses, and the data layer is never reached.
func TestIDsNamedByADocumentAreRefusedByAuthorization(t *testing.T) {
	corpus := loadCorpus(t)
	named := func(file string) string {
		id := anyUUID.FindString(corpus[file])
		if id == "" {
			t.Fatalf("%s names no id", file)
		}
		return id
	}
	f := newFixture()
	ctx := context.Background()

	res, err := NewRAGSearch(f.retriever, f.authz).Execute(ctx,
		map[string]any{"query": "the rest", "kb_ids": []any{named("cross-kb-rag-search.txt")}}, f.input())
	if err != nil || !res.IsError || f.retriever.callCount() != 0 {
		t.Errorf("rag_search on a named foreign KB: %+v %v, retriever calls %d", res, err, f.retriever.callCount())
	}

	res, err = NewReadSource(f.reader, f.authz).Execute(ctx,
		map[string]any{"document_id": named("foreign-document-read-source.txt"), "page": 4}, f.input())
	if err != nil || !res.IsError || f.reader.callCount() != 0 {
		t.Errorf("read_source on a named foreign document: %+v %v, reader calls %d", res, err, f.reader.callCount())
	}

	// kb-files-enumeration names no id; obeyed, the model guesses — and the
	// only ids that could matter are other users'.
	res, err = NewKBFiles(f.lister, f.authz).Execute(ctx,
		map[string]any{"kb_id": []any{f.foreignKB.String()}}, f.input())
	if err != nil || !res.IsError || f.lister.callCount() != 0 {
		t.Errorf("kb_files on a foreign KB: %+v %v, lister calls %d", res, err, f.lister.callCount())
	}
}

// A document telling the model to cite url:99 cannot create that source: the
// validator keeps only markers a tool produced this turn.
func TestASpoofedURLCitationIsDropped(t *testing.T) {
	if !strings.Contains(loadCorpus(t)["citation-url-spoof.txt"], "[[cite:url:99]]") {
		t.Fatal("citation-url-spoof.txt no longer carries the spoofed marker")
	}
	known := citations.Index([]citations.Source{{Kind: "url", ID: "1", URL: "https://example.org/a"}})
	res := citations.Validate("Claim one [[cite:url:1]]. Claim two [[cite:url:99]].", known)
	if strings.Contains(res.Text, "url:99") || len(res.Sources) != 1 || len(res.Dropped) != 1 {
		t.Fatalf("spoofed citation survived: %+v", res)
	}
}
