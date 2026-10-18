package app

// exam_e2e_test.go — AC3, end to end, through the wiring: upload a past paper
// → extract → review → generate from a knowledge base → start → answer →
// submit → the wrong items appear in Practice, where the essay is marked by
// its rubric again.
//
// The model is a scripted OpenAI-compatible upstream reached through the real
// BYOK chain; the parser is the recorded Gemini replay of rag.pdf, which is
// also the "past paper", so the paper and a knowledge-base document share
// their bytes — the case red team SF-10 is about.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
)

type examModel struct {
	server *httptest.Server
	mu     sync.Mutex
	calls  map[string]int
	// batches records the page ranges extraction asked about.
	batches []string
}

var (
	examPages = regexp.MustCompile(`starts on pages (\d+) to (\d+)`)
	examType  = regexp.MustCompile(`Type: (\w+) \(fixed\)`)
	examMarks = regexp.MustCompile(`Marks: ([\d.]+)`)
)

func newExamModel(t *testing.T) *examModel {
	t.Helper()
	m := &examModel{calls: map[string]int{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.Unmarshal(body, &req); err != nil || len(req.Messages) < 2 {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		system, user := req.Messages[0].Content, req.Messages[1].Content
		var kind string
		var reply any
		switch {
		case strings.HasPrefix(system, "You are listing the questions printed"):
			kind, reply = "extract", m.extractReply(t, user)
		case strings.HasPrefix(system, "You are writing one new exam question"):
			kind, reply = "generate", examDraft(user)
		case strings.HasPrefix(system, "You are marking one written answer"):
			// 2 of the 4 points: 0.5, below the bar.
			kind, reply = "rubric", map[string]any{"criteria": []any{
				map[string]any{"number": 1, "awarded": 2}, map[string]any{"number": 2, "awarded": 0}},
				"reason": "The mechanism is missing.", "error_type": "concept"}
		case strings.HasPrefix(system, "You are marking one free-text answer"):
			kind, reply = "judge", map[string]any{"correct": true, "reason": "ok"}
		default:
			t.Errorf("exam model: unexpected system prompt %q", truncateForMsg(system))
			http.Error(w, "unexpected", http.StatusInternalServerError)
			return
		}
		m.mu.Lock()
		m.calls[kind]++
		m.mu.Unlock()
		content, _ := json.Marshal(reply)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "cmpl-" + kind, "object": "chat.completion", "model": "fake-1",
			"choices": []any{map[string]any{"index": 0, "finish_reason": "stop",
				"message": map[string]any{"role": "assistant", "content": string(content)}}},
		})
	})
	m.server = httptest.NewServer(mux)
	t.Cleanup(m.server.Close)
	return m
}

func (m *examModel) count(kind string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls[kind]
}

// extractReply finds three questions on the first batch's pages: a
// multiple-choice, an essay worth 4 and a true/false. The recorded Gemini
// parse is what the model reads, and the PDF's own text layer rides along.
func (m *examModel) extractReply(t *testing.T, user string) any {
	match := examPages.FindStringSubmatch(user)
	if match == nil {
		t.Errorf("extraction request names no pages")
		return map[string]any{"questions": []any{}}
	}
	m.mu.Lock()
	m.batches = append(m.batches, match[1]+"-"+match[2])
	m.mu.Unlock()
	if !strings.Contains(user, "text layer") {
		t.Errorf("a model-read PDF was extracted without its text layer alongside")
	}
	if match[1] != "1" {
		return map[string]any{"questions": []any{}}
	}
	return map[string]any{"questions": []any{
		map[string]any{"number": "1", "type": "mcq", "stem_md": "Where does a RAG model keep its non-parametric memory?",
			"options": []any{map[string]any{"text_md": "A dense vector index"}, map[string]any{"text_md": "Its weights"},
				map[string]any{"text_md": "The prompt"}, map[string]any{"text_md": "A cache"}},
			"points": 2, "difficulty": "easy", "source_page": 1, "topic": "non-parametric memory"},
		map[string]any{"number": "2", "type": "essay", "stem_md": "Discuss why retrieval helps knowledge-intensive tasks.",
			"points": "4 marks", "difficulty": "hard", "source_page": 2, "topic": "retrieval-augmented generation"},
		map[string]any{"number": "3", "type": "true_false", "stem_md": "RAG retrieves passages with a dense retriever.",
			"points": 1, "difficulty": "medium", "source_page": 3, "topic": "dense retrieval"},
	}}
}

// examDraft writes a valid question of the requested type from the passages
// the brief carries.
func examDraft(user string) any {
	typ := examType.FindStringSubmatch(user)[1]
	marks, _ := strconv.ParseFloat(examMarks.FindStringSubmatch(user)[1], 64)
	ids := passageIDs.FindAllStringSubmatch(user, -1)
	chunk := ids[0][1]
	d := map[string]any{
		"type": typ, "prompt": "Which memory does RAG add to a sequence-to-sequence model?",
		"answer":      "a dense vector index of Wikipedia",
		"explanation": fmt.Sprintf("RAG adds a non-parametric memory [[cite:chunk:%s]].", chunk),
		"chunk_ids":   []string{chunk},
	}
	switch typ {
	case "mcq":
		d["options"] = []any{map[string]any{"body": "A dense vector index"}, map[string]any{"body": "Larger weights"},
			map[string]any{"body": "A longer prompt"}, map[string]any{"body": "A key-value cache"}}
		d["answer"] = "A"
	case "tf":
		d["prompt"], d["answer"] = "RAG retrieves passages with a dense retriever.", "true"
	case "written":
		d["rubric"] = []any{map[string]any{"criterion": "Names the non-parametric memory", "points": marks - 2},
			map[string]any{"criterion": "Explains why retrieval helps", "points": 2}}
	}
	return d
}

func (e *e2e) uploadPaper(filename string, data []byte) map[string]any {
	e.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, _ := w.CreateFormFile("file", filename)
	_, _ = part.Write(data)
	_ = w.Close()
	req, _ := http.NewRequest(http.MethodPost, e.server.URL+"/v1/exams/templates", &buf)
	req.Header.Set("Authorization", "Bearer "+e2eToken)
	req.Header.Set(httpx.UserIDHeader, e.user.String())
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := e.server.Client().Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusAccepted {
		e.t.Fatalf("upload paper: %d %s", res.StatusCode, raw)
	}
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}

func (e *e2e) fileStatus(path string) (int, []byte) {
	e.t.Helper()
	res := e.do(http.MethodGet, path, nil)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, raw
}

func TestAPastPaperBecomesAMockExamWhoseMistakesArePractised(t *testing.T) {
	model := newExamModel(t)
	e := buildE2E(t, model.server.URL, []string{"quiz"}, nil)
	paper := ragFixturePDF(t)

	kbID := e.json(http.MethodPost, "/v1/kb", map[string]string{"name": "Retrieval papers"}, http.StatusCreated)["id"].(string)
	e.upload(uuid.MustParse(kbID), "rag.pdf", paper)
	e.drainJobs()

	// ── upload → extract ─────────────────────────────────────────────────
	tmpl := e.uploadPaper("midterm.pdf", paper)
	tmplID := tmpl["id"].(string)
	if tmpl["status"] != "queued" || tmpl["page_count"].(float64) != 19 {
		t.Fatalf("uploaded template: %v", tmpl)
	}
	e.drainJobs()
	got := e.json(http.MethodGet, "/v1/exams/templates/"+tmplID, nil, http.StatusOK)
	if got["status"] != "review" || !strings.HasPrefix(got["parsed_by"].(string), "gemini/") {
		t.Fatalf("after extraction: %v / %v (%v)", got["status"], got["parsed_by"], got["error"])
	}
	if strings.Join(model.batches, ",") != "1-8,9-16,17-19" {
		t.Fatalf("extraction batches = %v", model.batches)
	}
	items := got["items"].([]any)
	if len(items) != 3 || items[1].(map[string]any)["type"] != "written" || items[1].(map[string]any)["points"].(float64) != 4 {
		t.Fatalf("extracted items: %v", items)
	}

	// The paper is served for pdf.js, and it is not a knowledge-base document.
	if status, body := e.fileStatus("/v1/exams/templates/" + tmplID + "/file"); status != http.StatusOK || !bytes.Equal(body, paper) {
		t.Fatalf("paper file: %d, %d bytes", status, len(body))
	}
	if n := e.scalar(`SELECT count(*) FROM documents WHERE user_id = $1`, e.user); n != 1 {
		t.Fatalf("%d documents: the paper was added to a knowledge base", n)
	}

	// ── review → generate ────────────────────────────────────────────────
	ready := e.json(http.MethodPatch, "/v1/exams/templates/"+tmplID,
		map[string]any{"ready": true, "time_limit_minutes": 30}, http.StatusOK)
	if ready["status"] != "ready" || ready["total_points"].(float64) != 7 {
		t.Fatalf("review: %v", ready)
	}
	created := e.json(http.MethodPost, "/v1/exams", map[string]any{"template_id": tmplID, "kb_id": kbID}, http.StatusAccepted)
	examID := created["id"].(string)
	e.drainJobs()
	ex := e.json(http.MethodGet, "/v1/exams/"+examID, nil, http.StatusOK)
	if ex["status"] != "ready" || ex["generated"].(float64) != 3 || len(ex["items"].([]any)) != 0 {
		t.Fatalf("generated exam: %v", ex)
	}

	// ── start → answer → submit ──────────────────────────────────────────
	started := e.json(http.MethodPost, "/v1/exams/"+examID+"/start", map[string]any{}, http.StatusOK)
	if started["deadline_at"] == nil || started["time_limit_minutes"].(float64) != 30 {
		t.Fatalf("started: %v", started)
	}
	var answers []any
	questionIDs := map[string]string{}
	for _, raw := range started["items"].([]any) {
		it := raw.(map[string]any)
		q := it["question"].(map[string]any)
		if _, leaked := q["answer"]; leaked {
			t.Fatalf("an exam in progress carried an answer key: %v", q)
		}
		questionIDs[q["type"].(string)] = q["id"].(string)
		text := map[string]string{"mcq": "B", "written": "Retrieval gives the model facts.", "tf": "true"}[q["type"].(string)]
		answers = append(answers, map[string]any{"item_id": it["id"], "answer": text})
	}
	if st := e.status(http.MethodPut, "/v1/exams/"+examID+"/answers", map[string]any{"answers": answers}); st != http.StatusNoContent {
		t.Fatalf("autosave: %d", st)
	}
	result := e.json(http.MethodPost, "/v1/exams/"+examID+"/submit", nil, http.StatusOK)
	// mcq wrong (0 of 2), essay 0.5 × 4 = 2, tf right (1): 3 of 7.
	if result["status"] != "submitted" || result["score"].(float64) != 3 || result["max_score"].(float64) != 7 || result["late"] != false {
		t.Fatalf("result: %v %v/%v late %v", result["status"], result["score"], result["max_score"], result["late"])
	}
	if model.count("rubric") != 1 || model.count("judge") != 0 {
		t.Fatalf("marking calls: rubric %d, judge %d", model.count("rubric"), model.count("judge"))
	}

	// ── the wrong items are in Practice ───────────────────────────────────
	practice := e.json(http.MethodGet, "/v1/quiz/practice", nil, http.StatusOK)
	inQueue := map[string]bool{}
	for _, raw := range practice["items"].([]any) {
		q := raw.(map[string]any)["question"].(map[string]any)
		inQueue[q["id"].(string)] = true
		if q["type"] == "written" {
			if _, leaked := q["rubric"]; leaked {
				t.Fatal("practice served the essay with its rubric")
			}
		}
	}
	if !inQueue[questionIDs["mcq"]] || !inQueue[questionIDs["written"]] || inQueue[questionIDs["tf"]] || len(inQueue) != 2 {
		t.Fatalf("practice queue = %v, want the mcq and the essay", inQueue)
	}

	// Answered again in Practice, the essay is marked by its rubric, not the
	// short-answer judge.
	again := e.json(http.MethodPost, "/v1/questions/"+questionIDs["written"]+"/attempt",
		map[string]any{"user_answer": "Retrieval gives facts."}, http.StatusCreated)
	attempt := again["attempt"].(map[string]any)
	if attempt["score"].(float64) != 0.5 || attempt["is_correct"] != false || model.count("rubric") != 2 || model.count("judge") != 0 {
		t.Fatalf("practice attempt: %v; rubric %d judge %d", attempt, model.count("rubric"), model.count("judge"))
	}

	// ── per-row paper files (SF-10) ───────────────────────────────────────
	docID := e.json(http.MethodGet, "/v1/kb/"+kbID+"/documents", nil, http.StatusOK)["documents"].([]any)[0].(map[string]any)["id"].(string)
	ws := e.json(http.MethodPost, "/v1/reading/workspaces", map[string]any{"document_id": docID}, http.StatusOK)["id"].(string)
	// Deleting the template leaves the document's file, which has its bytes.
	if st := e.status(http.MethodDelete, "/v1/exams/templates/"+tmplID, nil); st != http.StatusNoContent {
		t.Fatalf("delete template: %d", st)
	}
	if status, _ := e.fileStatus("/v1/reading/" + ws + "/file"); status != http.StatusOK {
		t.Fatalf("the document's file after the template was deleted: %d", status)
	}
	if status, _ := e.fileStatus("/v1/exams/templates/" + tmplID + "/file"); status != http.StatusNotFound {
		t.Fatalf("a deleted template's paper: %d", status)
	}
	// The exam outlives its template.
	if st := e.status(http.MethodGet, "/v1/exams/"+examID, nil); st != http.StatusOK {
		t.Fatalf("the exam after its template was deleted: %d", st)
	}
	// And the other way: deleting the document leaves a paper with its bytes.
	second := e.uploadPaper("final.pdf", paper)["id"].(string)
	if st := e.status(http.MethodDelete, "/v1/kb/"+kbID+"/documents/"+docID, nil); st != http.StatusNoContent {
		t.Fatalf("delete document: %d", st)
	}
	if status, body := e.fileStatus("/v1/exams/templates/" + second + "/file"); status != http.StatusOK || !bytes.Equal(body, paper) {
		t.Fatalf("the paper after the document with its bytes was deleted: %d", status)
	}
}
