package gforms

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
)

// A form as forms.get returns it: one gradable radio, one checkbox (two
// answers), one short answer with a key, one paragraph, one radio with no key,
// and a section header.
const formJSON = `{
 "formId": "1FAIpQL-test",
 "info": {"title": "Week 3 check"},
 "items": [
  {"title": "Which layer stores embeddings?", "questionItem": {"question": {
    "grading": {"pointValue": 1, "correctAnswers": {"answers": [{"value": "Vector index"}]}, "generalFeedback": {"text": "Embeddings live in the index."}},
    "choiceQuestion": {"type": "RADIO", "options": [{"value": "Prompt"}, {"value": "Vector index"}, {"value": "Tokenizer"}, {"isOther": true}]}}}},
  {"title": "Pick all retrievers", "questionItem": {"question": {
    "grading": {"pointValue": 1, "correctAnswers": {"answers": [{"value": "BM25"}, {"value": "Dense"}]}},
    "choiceQuestion": {"type": "CHECKBOX", "options": [{"value": "BM25"}, {"value": "Dense"}, {"value": "Regex"}]}}}},
  {"title": "RAG stands for retrieval-augmented ____", "questionItem": {"question": {
    "grading": {"pointValue": 1, "correctAnswers": {"answers": [{"value": "generation"}]}},
    "textQuestion": {}}}},
  {"title": "Explain chunking", "questionItem": {"question": {"textQuestion": {"paragraph": true}}}},
  {"title": "No key here", "questionItem": {"question": {"choiceQuestion": {"type": "RADIO", "options": [{"value": "a"}, {"value": "b"}]}}}},
  {"title": "Part 2", "description": "a section"}
 ]
}`

func TestToQuestions(t *testing.T) {
	var f Form
	if err := json.Unmarshal([]byte(formJSON), &f); err != nil {
		t.Fatal(err)
	}
	qs, skipped := ToQuestions(f)
	if len(qs) != 2 || skipped != 3 {
		t.Fatalf("%d questions, %d skipped: %+v", len(qs), skipped, qs)
	}
	mcq := qs[0]
	if mcq.Type != quiz.TypeMCQ || mcq.Answer != "B" || len(mcq.Options) != 3 || mcq.Options[1].Body != "Vector index" ||
		mcq.Explanation != "Embeddings live in the index." {
		t.Fatalf("mcq: %+v", mcq)
	}
	if qs[1].Type != quiz.TypeShort || qs[1].Answer != "generation" {
		t.Fatalf("short: %+v", qs[1])
	}
}

func TestRequests_RoundTrip(t *testing.T) {
	qs := []quiz.Question{
		{Prompt: "Which?\nline two", Type: quiz.TypeMCQ, Options: []quiz.Option{{Label: "A", Body: "x"}, {Label: "B", Body: "y"}}, Answer: "B"},
		{Prompt: "The sky is green", Type: quiz.TypeTF, Answer: "false"},
		{Prompt: "2+2", Type: quiz.TypeShort, Answer: "4", Explanation: "arithmetic"},
		{Prompt: "Write an essay", Type: quiz.TypeWritten},
	}
	reqs, skipped := Requests(qs, "vi")
	if len(reqs) != 3 || skipped != 1 {
		t.Fatalf("%d requests, %d skipped", len(reqs), skipped)
	}
	raw, _ := json.Marshal(reqs)
	s := string(raw)
	for _, want := range []string{`"title":"Which? line two"`, `{"value":"y"}`, `"value":"Sai"`, `"index":2`, `"generalFeedback":{"text":"arithmetic"}`} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %s in %s", want, s)
		}
	}
	// What goes out comes back in as the same questions.
	var f Form
	for _, r := range reqs {
		item := r.(map[string]any)["createItem"].(map[string]any)["item"]
		b, _ := json.Marshal(item)
		var it Item
		_ = json.Unmarshal(b, &it)
		f.Items = append(f.Items, it)
	}
	back, _ := ToQuestions(f)
	if len(back) != 3 || back[0].Answer != "B" || back[1].Options[1].Body != "Sai" || back[1].Answer != "B" || back[2].Answer != "4" {
		t.Fatalf("round trip: %+v", back)
	}
}

type fakeDoer struct{ scopes []string }

func (f *fakeDoer) GoogleDo(_ context.Context, _ uuid.UUID, scopes []string, send func(string) (*http.Response, error)) (*http.Response, error) {
	f.scopes = scopes
	return send("test-token")
}

type fakeBank struct {
	added   []quiz.Question
	entries []quiz.BankEntry
}

func (b *fakeBank) AddQuestions(_ context.Context, _, _ uuid.UUID, qs []quiz.Question) (*quiz.StarterResult, error) {
	b.added = qs
	return &quiz.StarterResult{Added: len(qs)}, nil
}
func (b *fakeBank) Bank(context.Context, uuid.UUID, quiz.Filter) ([]quiz.BankEntry, error) {
	return b.entries, nil
}

func TestImportAndExport(t *testing.T) {
	var batch string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("no token on %s", r.URL.Path)
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/forms/1FAIpQL-test":
			_, _ = io.WriteString(w, formJSON)
		case r.Method == http.MethodGet:
			w.WriteHeader(http.StatusForbidden)
			_, _ = io.WriteString(w, `{"error":{"code":403,"message":"Forms API has not been used","status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}`)
		case r.URL.Path == "/forms":
			_, _ = io.WriteString(w, `{"formId":"new1","responderUri":"https://docs.google.com/forms/d/e/x/viewform"}`)
		case r.URL.Path == "/forms/new1:batchUpdate":
			b, _ := io.ReadAll(r.Body)
			batch = string(b)
			_, _ = io.WriteString(w, `{}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()

	doer := &fakeDoer{}
	bank := &fakeBank{entries: []quiz.BankEntry{
		{Question: quiz.Question{Prompt: "newer", Type: quiz.TypeShort, Answer: "b"}},
		{Question: quiz.Question{Prompt: "older", Type: quiz.TypeShort, Answer: "a"}},
	}}
	svc := NewService(doer, bank)
	svc.SetBaseURL(srv.URL)
	ctx := context.Background()

	rep, err := svc.Import(ctx, uuid.New(), uuid.New(), "1FAIpQL-test")
	if err != nil || rep.Added != 2 || rep.Skipped != 3 || rep.Title != "Week 3 check" || len(doer.scopes) != 1 {
		t.Fatalf("import: %+v %v %v", rep, err, doer.scopes)
	}
	if _, err := svc.Import(ctx, uuid.New(), uuid.New(), "other"); !googleapi.Disabled(err) {
		t.Fatalf("a disabled API is named: %v", err)
	}
	if _, err := svc.Import(ctx, uuid.New(), uuid.New(), "../forms/x"); err == nil {
		t.Fatal("a path in a form id must be refused")
	}

	out, err := svc.Export(ctx, uuid.New(), uuid.New(), "Week 3", "en")
	if err != nil || out.FormID != "new1" || out.Questions != 2 || !strings.HasSuffix(out.EditURI, "/forms/d/new1/edit") {
		t.Fatalf("export: %+v %v", out, err)
	}
	if !strings.Contains(batch, `"isQuiz":true`) || strings.Index(batch, `"older"`) > strings.Index(batch, `"newer"`) {
		t.Fatalf("the quiz setting, then the oldest question first: %s", batch)
	}

	bank.entries = []quiz.BankEntry{{Question: quiz.Question{Prompt: "essay", Type: quiz.TypeWritten}}}
	if _, err := svc.Export(ctx, uuid.New(), uuid.New(), "", "en"); !errors.Is(err, ErrNothingToExport) {
		t.Fatalf("nothing to export: %v", err)
	}
}
