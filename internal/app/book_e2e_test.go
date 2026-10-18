package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Learning depth, phase 11, end to end through the production handlers and
// the real BYOK chain, with a scripted OpenAI-compatible upstream: a
// knowledge base becomes a proposed outline, is edited and confirmed, and one
// chapter is compiled by the job into cited blocks whose quiz lands in the
// bank and whose flash cards land in the Book cards queue.
func TestALivingBookGoesFromAConfirmedOutlineToCitedBlocks(t *testing.T) {
	upstream := newBookUpstream(t)
	e := buildE2E(t, upstream.server.URL, []string{"chat", "quiz"}, nil)
	ctx := context.Background()
	kb, doc, chunks := seedE2EBookKB(t, e, e.user, "Retrieval-augmented generation finds passages")
	other := testutil.NewUser(t, e.pool)
	_, _, theirs := seedE2EBookKB(t, e, other, "ALICE-PRIVATE passage")

	created := e.json(http.MethodPost, "/v1/books", map[string]any{"kb_id": kb.String(), "goal": "build one", "chapters": 4}, http.StatusCreated)
	id := created["id"].(string)
	if created["status"] != "proposed" || len(created["chapters"].([]any)) != 0 {
		t.Fatalf("created = %v", created)
	}
	// Nothing is written before the outline is confirmed.
	e.json(http.MethodPost, "/v1/books/"+id+"/compile", nil, http.StatusConflict)
	e.json(http.MethodPost, "/v1/books/"+id+"/chapters/"+uuid.NewString()+"/compile", nil, http.StatusNotFound)
	if n := upstream.count(""); n != 1 {
		t.Fatalf("%d upstream calls before confirmation, want the proposal's one", n)
	}

	// An outline anchored on another user's chunk is refused like a missing id.
	chapter := func(title string, anchors ...uuid.UUID) map[string]any {
		return map[string]any{"title": title, "objectives": []string{"explain it"}, "anchors": anchors}
	}
	e.json(http.MethodPut, "/v1/books/"+id+"/proposal", map[string]any{"title": "Mine",
		"chapters": []any{chapter("Stolen", theirs[0])}}, http.StatusNotFound)
	// Forward prerequisites are refused with the rule.
	bad := chapter("First", chunks[0])
	bad["prereqs"] = []int{2}
	e.json(http.MethodPut, "/v1/books/"+id+"/proposal", map[string]any{"title": "Mine",
		"chapters": []any{bad, chapter("Second", chunks[1])}}, http.StatusBadRequest)
	edited := e.json(http.MethodPut, "/v1/books/"+id+"/proposal", map[string]any{"title": "My RAG book",
		"chapters": []any{chapter("Basics", chunks[0], chunks[1]), chapter("Indexing", chunks[2])}}, http.StatusOK)
	if edited["title"] != "My RAG book" {
		t.Fatalf("edited = %v", edited)
	}

	confirmed := e.json(http.MethodPost, "/v1/books/"+id+"/confirm", nil, http.StatusOK)
	chapters := confirmed["chapters"].([]any)
	first := chapters[0].(map[string]any)
	cid := first["id"].(string)
	if len(chapters) != 2 || first["status"] != "pending" || first["estimated_calls"].(float64) != 11 {
		t.Fatalf("confirmed = %v", confirmed)
	}

	queued := e.json(http.MethodPost, "/v1/books/"+id+"/chapters/"+cid+"/compile", nil, http.StatusAccepted)
	if queued["compiling"] != true {
		t.Fatalf("queued = %v", queued)
	}
	e.drainJobs()

	view := e.json(http.MethodGet, "/v1/books/"+id+"/chapters/"+cid, nil, http.StatusOK)
	ch := view["chapter"].(map[string]any)
	if ch["status"] != "ready" || ch["stale"] != false {
		t.Fatalf("chapter = %v", ch)
	}
	blocks := view["blocks"].([]any)
	var quizQuestion, flashBlock string
	for _, raw := range blocks {
		blk := raw.(map[string]any)
		if blk["status"] != "ready" {
			t.Fatalf("block = %v", blk)
		}
		switch blk["type"] {
		case "quiz":
			qs := blk["questions"].([]any)
			quizQuestion = qs[0].(map[string]any)["id"].(string)
			if _, leaked := qs[0].(map[string]any)["answer"]; leaked {
				t.Fatal("an unanswered question's answer reached the reader")
			}
		case "flash_cards":
			flashBlock = blk["id"].(string)
		case "text":
			if strings.Contains(fmt.Sprint(blk["payload"]), "C99") || len(blk["sources"].([]any)) != 1 {
				t.Fatalf("text block = %v", blk)
			}
		}
	}
	// Every passage reached the model inside the untrusted envelope, and no
	// other user's text reached it at all.
	if !upstream.allEnveloped() || upstream.saw("ALICE-PRIVATE") {
		t.Fatal("a passage reached the model outside its envelope, or another user's did")
	}

	// The quiz block's question is a real bank question: answering it works
	// like any other, and the reader then shows its answer.
	answered := e.json(http.MethodPost, "/v1/questions/"+quizQuestion+"/attempt", map[string]any{"user_answer": "A"}, http.StatusCreated)
	if answered["attempt"].(map[string]any)["is_correct"] != true {
		t.Fatalf("attempt = %v", answered)
	}
	for _, raw := range e.json(http.MethodGet, "/v1/books/"+id+"/chapters/"+cid, nil, http.StatusOK)["blocks"].([]any) {
		if blk := raw.(map[string]any); blk["type"] == "quiz" {
			if q := blk["questions"].([]any)[0].(map[string]any); q["revealed"] != true || q["answer"] != "A" {
				t.Fatalf("answered question in the reader = %v", q)
			}
		}
	}
	var kbOf uuid.UUID
	_ = e.pool.QueryRow(ctx, `SELECT kb_id FROM questions WHERE id = $1`, quizQuestion).Scan(&kbOf)
	if kbOf != kb {
		t.Fatalf("the question's kb_id is %s, want %s", kbOf, kb)
	}

	// Flash cards: in the Book cards queue, never in Vocabulary.
	if words := e.json(http.MethodGet, "/v1/vocab/due", nil, http.StatusOK); words["due_count"].(float64) != 0 {
		t.Fatalf("vocabulary queue = %v", words)
	}
	deck := e.json(http.MethodGet, "/v1/vocab/due?deck=book", nil, http.StatusOK)
	if deck["due_count"].(float64) != 3 {
		t.Fatalf("book deck = %v", deck)
	}
	e.json(http.MethodPut, "/v1/books/"+id+"/blocks/"+flashBlock+"/review", map[string]any{"on": false}, http.StatusNoContent)
	if deck = e.json(http.MethodGet, "/v1/vocab/due?deck=book", nil, http.StatusOK); deck["due_count"].(float64) != 0 {
		t.Fatalf("book deck after 'Add to review' off = %v", deck)
	}

	// The learner's own note; a citation marker in it is not kept.
	note := e.json(http.MethodPost, "/v1/books/"+id+"/chapters/"+cid+"/notes",
		map[string]any{"markdown": "My own words [[cite:chunk:" + chunks[0].String() + "]]"}, http.StatusCreated)
	if strings.Contains(fmt.Sprint(note["payload"]), "cite") || note["type"] != "note" {
		t.Fatalf("note = %v", note)
	}

	// Export resolves the citations.
	res := e.do(http.MethodGet, "/v1/books/"+id+"/export", nil)
	md, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/markdown") ||
		strings.Contains(string(md), "[[cite") || !strings.Contains(string(md), "(Notes.pdf, p. 1)") ||
		!strings.Contains(string(md), "My own words") {
		t.Fatalf("export %d:\n%s", res.StatusCode, md)
	}

	// A changed source document makes the chapter say so.
	if _, err := e.pool.Exec(ctx, `UPDATE documents SET version = version + 1 WHERE id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	book := e.json(http.MethodGet, "/v1/books/"+id, nil, http.StatusOK)
	if book["chapters"].([]any)[0].(map[string]any)["stale"] != true {
		t.Fatalf("book after a source changed = %v", book["chapters"])
	}
	listed := e.json(http.MethodGet, "/v1/books?kb_id="+kb.String(), nil, http.StatusOK)
	if len(listed["books"].([]any)) != 1 {
		t.Fatalf("list = %v", listed)
	}

	e.json(http.MethodDelete, "/v1/books/"+id, nil, http.StatusNoContent)
	var cards int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM vocab_cards WHERE user_id = $1`, e.user).Scan(&cards)
	if cards != 0 {
		t.Fatalf("%d cards left after the book was deleted", cards)
	}
}

// seedE2EBookKB gives a user a knowledge base with six chunks of one
// document (no embeddings: a book reads chunks, it does not search).
func seedE2EBookKB(t *testing.T, e *e2e, user uuid.UUID, text string) (kb, doc uuid.UUID, chunks []uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	ks := pg.NewKnowledgeStore(e.pool)
	k, err := ks.CreateKB(ctx, user, "Notes")
	if err != nil {
		t.Fatal(err)
	}
	d, err := ks.CreateDocument(ctx, knowledge.Document{UserID: user, KBID: k.ID, SourceKind: "upload",
		Title: "Notes.pdf", MIME: "application/pdf", Bytes: 1,
		SHA256: strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""), Status: "ready"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 6; i++ {
		var id uuid.UUID
		if err := e.pool.QueryRow(ctx, `
			INSERT INTO chunks (user_id, kb_id, document_id, ord, page_start, page_end, text, dims)
			VALUES ($1, $2, $3, $4, $5, $5, $6, 1536) RETURNING id`,
			user, k.ID, d.ID, i, i+1, fmt.Sprintf("%s (%d).", text, i+1)).Scan(&id); err != nil {
			t.Fatal(err)
		}
		chunks = append(chunks, id)
	}
	return k.ID, d.ID, chunks
}

// bookUpstream is an OpenAI-compatible endpoint that answers each of the
// book's calls by the prompt it was sent.
type bookUpstream struct {
	server *httptest.Server
	mu     sync.Mutex
	calls  []string
	users  []string
}

var e2eQuizChunk = regexp.MustCompile(`id="chunk:([0-9a-f-]{36})"`)

func newBookUpstream(t *testing.T) *bookUpstream {
	u := &bookUpstream{}
	u.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		system, user := "", ""
		for _, m := range req.Messages {
			if m.Role == "system" {
				system = m.Content
			} else {
				user = m.Content
			}
		}
		kind, reply := bookReply(system, user)
		u.mu.Lock()
		u.calls = append(u.calls, kind)
		u.users = append(u.users, user)
		u.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "cmpl", "object": "chat.completion", "model": "fake-1",
			"choices": []any{map[string]any{"index": 0, "finish_reason": "stop",
				"message": map[string]any{"role": "assistant", "content": reply}}},
			"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
		})
	}))
	t.Cleanup(u.server.Close)
	return u
}

func (u *bookUpstream) count(kind string) int {
	u.mu.Lock()
	defer u.mu.Unlock()
	n := 0
	for _, c := range u.calls {
		if kind == "" || c == kind {
			n++
		}
	}
	return n
}

func (u *bookUpstream) saw(s string) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	for _, m := range u.users {
		if strings.Contains(m, s) {
			return true
		}
	}
	return false
}

// allEnveloped reports whether every passage the model was shown sat inside
// a provenance envelope marked untrusted.
func (u *bookUpstream) allEnveloped() bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	for _, m := range u.users {
		if strings.Contains(m, "passages") && !strings.Contains(m, `trust="untrusted"`) {
			return false
		}
		if strings.Count(m, "Retrieval-augmented generation finds passages") != strings.Count(m, `trust="untrusted"`) {
			return false
		}
	}
	return true
}

func bookReply(system, user string) (string, string) {
	switch {
	case strings.Contains(system, "You propose the outline"):
		return "propose", `{"title":"Retrieval","audience":"New learners","chapters":[
			{"title":"One","objectives":["o"],"prerequisites":[],"anchors":["C1"]},
			{"title":"Two","objectives":["o"],"prerequisites":[1],"anchors":["C2"]},
			{"title":"Three","objectives":["o"],"prerequisites":[2],"anchors":["C3"]},
			{"title":"Four","objectives":["o"],"prerequisites":[3],"anchors":["C4"]}]}`
	case strings.Contains(system, "You plan one chapter"):
		return "plan", `{"blocks":[{"type":"text","title":"Idea","brief":"b"},{"type":"quiz","title":"Check","brief":"b"},
			{"type":"callout","title":"Term","brief":"b"},{"type":"flash_cards","title":"Cards","brief":"b"},
			{"type":"diagram","title":"Flow","brief":"b"},{"type":"summary","title":"Recap","brief":"b"}]}`
	case strings.Contains(system, "You draw ONE diagram"):
		return "diagram", `{"kind":"mermaid","source":"flowchart TD\n  A --> B","caption":"The flow."}`
	case strings.Contains(system, "writing questions from a plan"):
		chunk := e2eQuizChunk.FindStringSubmatch(user)[1]
		return "quiz", fmt.Sprintf(`{"questions":[{"prompt":"What comes first?","type":"mcq",
			"options":[{"label":"A","body":"Retrieval"},{"label":"B","body":"Writing"},{"label":"C","body":"Ranking"},{"label":"D","body":"Nothing"}],
			"answer":"A","explanation":"Retrieval first. [[cite:chunk:%s]]","difficulty":"easy","chunk_ids":["%s"]}]}`, chunk, chunk)
	case strings.Contains(system, "This block is `text`"):
		return "text", `{"markdown":"Retrieval finds passages first. [[cite:chunk:C1]] Made up. [[cite:chunk:C99]]"}`
	case strings.Contains(system, "This block is `callout`"):
		return "callout", `{"variant":"definition","title":"RAG","markdown":"Retrieval plus generation. [[cite:chunk:C2]]"}`
	case strings.Contains(system, "This block is `flash_cards`"):
		return "flash_cards", `{"cards":[{"front":"a","back":"b"},{"front":"c","back":"d"},{"front":"e","back":"f"}],"source_ids":["C1"]}`
	case strings.Contains(system, "This block is `summary`"):
		return "summary", `{"markdown":"- Retrieval first. [[cite:chunk:C1]]"}`
	}
	return "unknown", `{}`
}
