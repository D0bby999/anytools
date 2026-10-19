package app

// isolation_test.go — AC6: every route that names a resource refuses another
// user, proven against the PRODUCTION wiring (app.Build) rather than a mux
// assembled for the test.
//
// The route list is api.RegisteredPatterns(), which a structural test already
// holds equal to what BuildMux registers. For each pattern with a `{…}` path
// segment the test fills in a resource OWNED BY ALICE and sends the request as
// BOB. Anything but 404 or 403 fails. A pattern with no fixture fails too —
// that is the point: a route added later cannot ship without someone deciding
// how it is probed.
//
// Each probe is also sent with a random id that exists nowhere. The two answers
// must match, or the endpoint tells Bob which ids are real.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/audio"
	"github.com/D0bby999/anytools/internal/capabilities/book"
	"github.com/D0bby999/anytools/internal/capabilities/exam"
	"github.com/D0bby999/anytools/internal/capabilities/mastery"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/capabilities/research"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/learning/profile"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/learning/worksheet/worksheettest"
	"github.com/D0bby999/anytools/internal/notebook"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
	"github.com/D0bby999/anytools/internal/vocab"
)

const isolationToken = "isolation-gateway-token"

// resources are Alice's ids, by kind.
type resources map[string]uuid.UUID

// idKinds maps the path before a placeholder to the kind of id it names.
// Longest prefix wins.
var idKinds = map[string]string{
	"/v1/byok/connections/":        "connection",
	"/v1/byok/search-connections/": "search_connection",
	"/v1/chat/sessions/":           "session",
	"/v1/turns/":                   "turn",
	"/v1/kb/":                      "kb",
	"/documents/":                  "document", // /v1/kb/{id}/documents/{doc}
	"/v1/documents/":               "document",
	"/v1/quiz/questions/":          "question",
	"/v1/questions/":               "question",
	"/v1/quiz/attempts/":           "attempt",
	"/v1/mastery/paths/":           "path",
	"/v1/mastery/points/":          "knowledge_point",
	"/v1/mastery/explain-back/":    "explain_back",
	"/v1/notebooks/":               "notebook",
	"/v1/note-categories/":         "category",
	"/v1/notes/":                   "note",
	"/v1/reading/highlights/":      "highlight",
	"/v1/reading/":                 "workspace",
	"/v1/solve/messages/":          "message",
	"/v1/research/reports/":        "report",
	"/v1/learning/states/":         "learning_state",
	"/v1/cycles/":                  "cycle",
	"/v1/weekly-reviews/":          "review",
	"/v1/learning/evidence/":       "evidence",
	"/v1/learning/chains/":         "chain",
	"/v1/learning/briefs/":         "brief",
	"/v1/learning/logs/":           "log",
	"/v1/visualize/":               "diagram",
	"/v1/audio-overviews/":         "audio",
	"/v1/vocab/":                   "vocab",
	"/v1/vocab/cards/":             "vocab_card",
	"/v1/learning/cards/":          "card",
	"/v1/profile/entries/":         "profile_entry",
	"/v1/profile/runs/":            "profile_run",
	"/v1/books/":                   "book",
	"/chapters/":                   "book_chapter", // /v1/books/{id}/chapters/{cid}
	"/blocks/":                     "book_block",   // /v1/books/{id}/blocks/{bid}
	"/v1/exams/":                   "exam",
	"/v1/exams/templates/":         "exam_template",
	"/v1/chat/messages/":           "message", // up-methods phase 11: retell
	"/v1/worksheets/":              "worksheet",
	"/recordings/":                 "recording", // /v1/worksheets/{id}/recordings/{rid}
	// Up-methods phase 18: documentation sites and GitHub repositories.
	"/v1/sites/": "site",
	"/v1/repos/": "repo",
	// Up-methods phase 17: podcast feeds and YouTube playlists.
	"/v1/feeds/": "feed",
}

// notResourceIDs are placeholders that do not name another user's resource.
var notResourceIDs = map[string]string{
	"PUT /v1/byok/routes/{function}": "names a route function; each user writes only their own row",
}

// bodies are what each write route needs to get PAST validation to the
// ownership check. A route that answers 400 here was never probed.
func bodies(bobNotebook uuid.UUID) map[string]any {
	return map[string]any{
		"PUT /v1/byok/connections/{id}":        map[string]any{"name": "x"},
		"PATCH /v1/chat/sessions/{id}":         map[string]any{"title": "x"},
		"POST /v1/chat/sessions/{id}/turns":    map[string]any{"message": "x"},
		"POST /v1/turns/{id}/answer":           map[string]any{"answer": "x"},
		"POST /v1/kb/{id}/query":               map[string]any{"query": "x"},
		"POST /v1/questions/{id}/attempt":      map[string]any{"user_answer": "x"},
		"POST /v1/quiz/attempts/{id}/override": map[string]any{"is_correct": true},
		"POST /v1/mastery/paths/{id}/approve":  map[string]any{"modules": []any{map[string]any{"name": "m", "knowledge_points": []any{map[string]any{"name": "k"}}}}},
		// Valid text and a fresh key, so the probe reaches the ownership check.
		"POST /v1/mastery/points/{id}/explain-back": map[string]any{
			"text": "Parametric memory is what the model keeps in its weights.", "request_id": uuid.NewString()},
		"POST /v1/mastery/points/{id}/learn":   map[string]any{},
		"PATCH /v1/notebooks/{id}":             map[string]any{"name": "x"},
		"POST /v1/notebooks/{id}/notes":        map[string]any{"title": "x", "body_md": "x"},
		"POST /v1/notebooks/{id}/categories":   map[string]any{"name": "x"},
		"PATCH /v1/notes/{id}":                 map[string]any{"title": "x"},
		"POST /v1/notes/{id}/move":             map[string]any{"notebook_id": bobNotebook},
		"POST /v1/notes/{id}/copy":             map[string]any{"notebook_id": bobNotebook},
		"PATCH /v1/reading/highlights/{hid}":   map[string]any{"color": "green"},
		"PATCH /v1/reading/{id}":               map[string]any{"progress": map[string]any{"page": 1}},
		"POST /v1/reading/{id}/highlights":     map[string]any{"page": 1, "text": "x"},
		"POST /v1/reading/{id}/actions":        map[string]any{"action": "explain", "selection": "x", "page": 1},
		"POST /v1/reading/{id}/notes":          map[string]any{"body_md": "x", "page": 1},
		"POST /v1/kb/{id}/drive/import":        map[string]any{"picked": []any{map[string]any{"id": "f1", "kind": "file"}}},
		"POST /v1/learning/states/{id}/chains": map[string]any{"question": "q"},
		"POST /v1/learning/states/{id}/briefs": map[string]any{"task": "t"},
		"POST /v1/kb/{id}/papers":              map[string]any{"openalex_id": "W1"},
		"POST /v1/visualize/{id}/repair":       map[string]any{"error": "Parse error"},
		"POST /v1/reading/{id}/diagram":        map[string]any{"selection": "x"},
		"POST /v1/reading/{id}/terms":          map[string]any{"selection": "x", "page": 1},
		"PATCH /v1/vocab/{id}":                 map[string]any{"meaning": "x"},
		"POST /v1/vocab/cards/{id}/review":     map[string]any{"rating": "good", "request_id": uuid.NewString()},
		"POST /v1/learning/states/{id}/cards":  isolationCard(),
		"POST /v1/learning/cards/{id}/entries": map[string]any{"timepoint": "baseline", "body": "x"},
		"POST /v1/learning/cards/{id}/close":   map[string]any{"held": "x"},
		"PATCH /v1/profile/entries/{id}":       map[string]any{"text": "x"},
		"PUT /v1/books/{id}/proposal": map[string]any{"title": "t", "chapters": []any{map[string]any{
			"title": "c", "objectives": []string{"o"}, "anchors": []string{uuid.NewString()}}}},
		"POST /v1/books/{id}/chapters/{cid}/notes": map[string]any{"markdown": "x"},
		"PUT /v1/books/{id}/blocks/{bid}/review":   map[string]any{"on": false},
		"PATCH /v1/exams/templates/{id}":           map[string]any{"title": "x"},
		"PUT /v1/exams/{id}/answers":               map[string]any{"answers": []any{}},
		"POST /v1/chat/messages/{id}/retell":       map[string]any{"text": "x"},
		// up methods, phase 0: a valid revision and title, so the probe
		// reaches the owner's row lock.
		"PATCH /v1/worksheets/{id}":     map[string]any{"revision": time.Now().UTC().Format(time.RFC3339Nano), "title": "x"},
		"POST /v1/worksheets/{id}/rows": map[string]any{"section": "notes", "field": "free", "row": map[string]any{"row": "", "cells": map[string]any{"text": "x"}}},
		// up methods, phase 4: a valid pass, so the probe reaches the
		// worksheet lookup.
		"POST /v1/worksheets/{id}/diagnose": map[string]any{"pass": 1},
		// up methods, phase 3: a valid scenario, so the probe reaches the
		// owner's row lock.
		"POST /v1/vocab/{id}/production": map[string]any{"scenario": "x"},
		// up methods, phase 20: a well-formed item key, so the probe reaches
		// the knowledge base's ownership check (which runs before the
		// learner's key is read or Zotero is called).
		"POST /v1/kb/{id}/zotero/items": map[string]any{"item_key": "ABCD2345"},
	}
}

type isolationEnv struct {
	pool        *pg.Pool
	url         string
	alice, bob  uuid.UUID
	ids         resources
	bobNotebook uuid.UUID
	bobSession  uuid.UUID
	// bobOwn are Bob's own resources by kind, for body probes whose PATH names
	// something of his and whose BODY names something of Alice's.
	bobOwn resources
}

// newIsolationEnv boots the production wiring on a fresh database and gives
// Alice one of everything.
func newIsolationEnv(t *testing.T) *isolationEnv {
	t.Helper()
	pool := freshDatabase(t)
	ctx := context.Background()

	t.Setenv("ANYTOOLS_POSTGRES_DSN", pool.Config().ConnString())
	t.Setenv("ANYTOOLS_GATEWAY_TOKEN", isolationToken)
	t.Setenv("ANYTOOLS_ENCRYPTION_KEY", testutil.TestEncryptionKey)
	t.Setenv("ANYTOOLS_DATA_DIR", t.TempDir())
	t.Setenv("ANYTOOLS_ENV", "development")
	t.Setenv("ANYTOOLS_JOB_WORKERS", "0")
	t.Setenv("ANYTOOLS_RATE_LIMIT_RPM", "0")
	// Dummy Google client: mounts the Drive routes so they are probed too.
	// Nothing here reaches Google — every probe is refused before any call.
	t.Setenv("ANYTOOLS_GOOGLE_CLIENT_ID", "isolation.apps.googleusercontent.com")
	t.Setenv("ANYTOOLS_GOOGLE_CLIENT_SECRET", "isolation-secret")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	application, err := Build(ctx, cfg)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	t.Cleanup(application.Close)
	server := httptest.NewServer(application.Handler)
	t.Cleanup(server.Close)

	alice, bob := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	ids := seedEverything(t, pool, alice)
	bobNotebook, err := pg.NewNotebookStore(pool).CreateNotebook(ctx, bob, "Bob's", false)
	if err != nil {
		t.Fatal(err)
	}
	bobSession, err := pg.NewChatStore(pool).CreateSession(ctx, runtime.Session{UserID: bob, Title: "b", KBIDs: []uuid.UUID{}})
	if err != nil {
		t.Fatal(err)
	}
	loops := pg.NewLoopStore(pool)
	_, bobCycle, err := loops.CreateStateWithCycle(ctx, loop.LearningState{
		UserID: bob, Goal: "g", RealScenario: "r", Outcome12w: "o", NextTask: "t",
	}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	bobReview, err := loops.CreateReview(ctx, bob, bobCycle.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	bobChain, err := loops.CreateChain(ctx, loop.Chain{UserID: bob, StateID: bobCycle.StateID, Question: "q"})
	if err != nil {
		t.Fatal(err)
	}
	bobCard, err := loops.CreateCard(ctx, loop.SkillCard{UserID: bob, StateID: bobCycle.StateID, Kind: loop.CardReading, Title: "b"})
	if err != nil {
		t.Fatal(err)
	}
	// Bob's own note, highlight, workspace and solve message: the PATH of a
	// body probe names one of these, so the only foreign thing is in the body.
	bobNote, err := pg.NewNotebookStore(pool).CreateNote(ctx, notebook.Note{
		UserID: bob, NotebookID: bobNotebook.ID, Title: "t", BodyMD: "b", CreatedBy: notebook.CreatedByUser})
	if err != nil {
		t.Fatal(err)
	}
	bobKB, err := pg.NewKnowledgeStore(pool).CreateKB(ctx, bob, "Bob's KB")
	if err != nil {
		t.Fatal(err)
	}
	bobDoc, err := pg.NewKnowledgeStore(pool).CreateDocument(ctx, knowledge.Document{
		UserID: bob, KBID: bobKB.ID, SourceKind: "upload", Title: "b.pdf", MIME: "application/pdf",
		Bytes: 1, SHA256: strings.Repeat("b", 64), Status: "ready",
	})
	if err != nil {
		t.Fatal(err)
	}
	bobWS, err := pg.NewReadingStore(pool).EnsureWorkspace(ctx, bob, bobDoc.ID)
	if err != nil {
		t.Fatal(err)
	}
	bobHL, err := pg.NewReadingStore(pool).CreateHighlight(ctx, reading.Highlight{
		UserID: bob, WorkspaceID: bobWS.ID, Page: 1, Text: "x", Color: "yellow"})
	if err != nil {
		t.Fatal(err)
	}
	bobMsg, err := pg.NewChatStore(pool).AppendMessage(ctx, runtime.ChatMessage{
		UserID: bob, SessionID: bobSession.ID, Role: runtime.RoleAssistant, Content: "x", Capability: "solve"})
	if err != nil {
		t.Fatal(err)
	}
	bobReport, err := pg.NewResearchStore(pool).InsertReport(ctx, research.Report{
		UserID: bob, Query: "q", Mode: "quick", ReportMD: "# Bob's report"})
	if err != nil {
		t.Fatal(err)
	}
	// Bob's own profile entry: PATCH names it in the path and Alice's
	// knowledge base in the body.
	bobEntry, err := pg.NewProfileStore(pool).Create(ctx, profile.NewEntry{UserID: bob, Section: profile.SectionPreferences, Text: "b"})
	if err != nil {
		t.Fatal(err)
	}
	// Bob's own books: a proposed one (the path of the outline-edit probe,
	// whose body names Alice's chunk), and a confirmed one whose chapter and
	// block are the other half of the mixed-owner probes.
	bobChunk := seedChunk(t, pool, bob, bobKB.ID, bobDoc.ID)
	bobProposed := seedBook(t, pool, bob, bobKB.ID, bobChunk, false)
	bobBook := seedBook(t, pool, bob, bobKB.ID, bobChunk, true)
	// Bob's own exam template and an exam in progress, so a body probe's
	// path names his and only the id in the body is Alice's.
	bobTemplate, bobExam := seedExam(t, pool, bob, bobKB.ID)
	// Bob's own speaking evidence and a recording on it: the path of the
	// body probes whose answers name Alice's recording, and the other half
	// of the recordings' mixed-owner probes.
	bobSheet, err := pg.NewWorksheetStore(pool).Create(ctx, worksheet.Worksheet{UserID: bob, Kind: "speaking_evidence",
		KindVersion: 1, Title: "Bob's speaking", Answers: worksheet.Answers{}, Status: worksheet.StatusOpen,
		Reviews: map[string]worksheet.ReviewDate{}})
	if err != nil {
		t.Fatal(err)
	}
	bobRecording := seedRecording(t, pool, bob, bobSheet.ID)
	// Up-methods phase 22: Bob's own audio overview, spoken on Alice's key.
	bobAudio, err := pg.NewAudioStore(pool).Create(ctx, audio.Overview{UserID: bob, KBID: &bobKB.ID, Minutes: 5, Status: audio.StatusScripting})
	if err != nil {
		t.Fatal(err)
	}
	return &isolationEnv{pool: pool, url: server.URL, alice: alice, bob: bob, ids: ids,
		bobNotebook: bobNotebook.ID, bobSession: bobSession.ID,
		bobOwn: resources{"notebook": bobNotebook.ID, "kb": bobKB.ID, "document": bobDoc.ID,
			"session": bobSession.ID, "review": bobReview.ID, "chain": bobChain.ID,
			"note": bobNote.ID, "highlight": bobHL.ID, "workspace": bobWS.ID, "message": bobMsg.ID,
			"report": bobReport.ID, "card": bobCard.ID, "profile_entry": bobEntry.ID,
			"book": bobProposed.book, "book_chapter": bobBook.chapter, "book_block": bobBook.block,
			"exam_template": bobTemplate, "exam": bobExam,
			"worksheet": bobSheet.ID, "recording": bobRecording, "audio": bobAudio.ID,
			"learning_state": bobCycle.StateID}}
}

func TestEveryRouteWithAnIDRefusesAnotherUser(t *testing.T) {
	env := newIsolationEnv(t)
	pool, ids, alice, bob, ctx := env.pool, env.ids, env.alice, env.bob, context.Background()
	serverURL := env.url
	bodyFor := bodies(env.bobNotebook)

	probed := 0
	for _, pattern := range api.RegisteredPatterns() {
		if !strings.Contains(pattern, "{") {
			continue
		}
		if reason := notResourceIDs[pattern]; reason != "" {
			continue
		}
		method, path, _ := strings.Cut(pattern, " ")
		real, fake, ok := fill(path, ids)
		if !ok {
			t.Errorf("%s: no isolation fixture — add its id kind to idKinds and a resource to seedEverything", pattern)
			continue
		}
		body := bodyFor[pattern]
		if body == nil && method != http.MethodGet && method != http.MethodDelete && isLoopRoute(path) {
			body = map[string]any{}
		}

		got, gotBody := send(t, serverURL, bob, method, real, body)
		if got != http.StatusNotFound && got != http.StatusForbidden {
			t.Errorf("%s as another user: %d %s", pattern, got, gotBody)
			continue
		}
		if control, _ := send(t, serverURL, bob, method, fake, body); control != got {
			t.Errorf("%s: another user's id answers %d, a nonexistent id answers %d — the difference leaks which ids exist", pattern, got, control)
		}
		probed++
	}
	if probed < 50 {
		t.Fatalf("probed only %d routes; the pattern list or the fixtures are broken", probed)
	}

	// Nothing Bob sent changed Alice's data.
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM knowledge_bases WHERE user_id = $1`, alice).Scan(&n)
	if n != 1 {
		t.Errorf("alice's knowledge base count is %d after the probes", n)
	}
	// A write whose read-back is owner-scoped answers 404 even when the write
	// itself landed, so the data is checked, not only the status.
	var meaning string
	var reps int
	_ = pool.QueryRow(ctx, `SELECT meaning FROM vocab_notes WHERE id = $1`, ids["vocab"]).Scan(&meaning)
	_ = pool.QueryRow(ctx, `SELECT reps FROM vocab_cards WHERE id = $1`, ids["vocab_card"]).Scan(&reps)
	if meaning != "m" || reps != 0 {
		t.Errorf("alice's vocabulary changed under bob's probes: meaning %q, reps %d", meaning, reps)
	}
	var entryText, origin string
	_ = pool.QueryRow(ctx, `SELECT text, origin FROM profile_entries WHERE id = $1`, ids["profile_entry"]).Scan(&entryText, &origin)
	if entryText != "Examples first." || origin != "learner" {
		t.Errorf("alice's profile entry changed under bob's probes: %q (%s)", entryText, origin)
	}
	var status string
	var suspended int
	_ = pool.QueryRow(ctx, `SELECT status FROM book_chapters WHERE id = $1`, ids["book_chapter"]).Scan(&status)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM vocab_cards WHERE book_block_id = $1 AND suspended`, ids["book_block"]).Scan(&suspended)
	if status != "pending" || suspended != 0 {
		t.Errorf("alice's book changed under bob's probes: chapter %q, %d cards suspended", status, suspended)
	}
	var templates, exams int
	var examStatus string
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM exam_templates WHERE user_id = $1`, alice).Scan(&templates)
	_ = pool.QueryRow(ctx, `SELECT count(*), max(status) FROM exams WHERE user_id = $1`, alice).Scan(&exams, &examStatus)
	if templates != 1 || exams != 1 || examStatus != "in_progress" {
		t.Errorf("alice's exams changed under bob's probes: %d templates, %d exams, status %q", templates, exams, examStatus)
	}
	var sheetTitle, sheetAnswers string
	var sheets int
	_ = pool.QueryRow(ctx, `SELECT title, answers::text FROM worksheets WHERE id = $1`, ids["worksheet"]).Scan(&sheetTitle, &sheetAnswers)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM worksheets WHERE user_id = $1`, alice).Scan(&sheets)
	if sheetTitle != "Alice's worksheet" || sheetAnswers != "{}" || sheets != 2 {
		t.Errorf("alice's worksheets changed under bob's probes: %q %s, %d worksheets", sheetTitle, sheetAnswers, sheets)
	}
	var recordings int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM worksheet_recordings WHERE user_id = $1`, alice).Scan(&recordings)
	if recordings != 1 {
		t.Errorf("alice has %d recordings after bob's probes, want 1", recordings)
	}
	// Bob's re-sync, cancel and delete probes left Alice's site and
	// repository as they were: present, queued, with no job.
	var sites, repos int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM sites WHERE user_id = $1 AND status = 'queued' AND job_id IS NULL`, alice).Scan(&sites)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM repos WHERE user_id = $1 AND status = 'queued' AND job_id IS NULL`, alice).Scan(&repos)
	if sites != 1 || repos != 1 {
		t.Errorf("alice's sources changed under bob's probes: %d sites, %d repos untouched", sites, repos)
	}
	// Bob's check, pick, seen, auto_add and delete probes left Alice's feed
	// as it was: present, auto_add off, its entry new and not queued.
	var feedsLeft int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM feeds f JOIN feed_entries e ON e.feed_id = f.id
		WHERE f.user_id = $1 AND NOT f.auto_add AND f.last_checked_at IS NOT NULL
		  AND e.is_new AND e.add_status = '' AND e.document_id IS NULL`, alice).Scan(&feedsLeft)
	if feedsLeft != 1 {
		t.Errorf("alice's feed changed under bob's probes: %d untouched", feedsLeft)
	}
	var diagnoses int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM worksheet_diagnoses`).Scan(&diagnoses)
	if diagnoses != 0 {
		t.Errorf("bob's probes stored %d writing diagnoses", diagnoses)
	}
}

// Learning-depth red team SF-2: a nested route (/{id}/…/{inner}) that checks
// the OUTER id's owner and then looks the inner one up by id alone passes the
// probe above, because Alice owns both. Here Bob names his own outer resource
// and Alice's inner one (and every other mix): each must be refused exactly
// as a nonexistent id is, and Alice's data must be untouched afterwards.
//
// A later phase that adds a nested route adds Bob's own resource of each kind
// it names to bobOwn in newIsolationEnv.
func TestNestedRoutesRefuseMixedOwners(t *testing.T) {
	env := newIsolationEnv(t)
	nested := 0
	for _, pattern := range api.RegisteredPatterns() {
		if notResourceIDs[pattern] != "" {
			continue
		}
		method, path, _ := strings.Cut(pattern, " ")
		kinds, ok := placeholderKinds(path)
		if !ok {
			t.Errorf("%s: no isolation fixture", pattern)
			continue
		}
		if len(kinds) < 2 {
			continue
		}
		nested++
		for foreign := range kinds {
			ids := func(alien uuid.UUID) []string {
				out := make([]string, len(kinds))
				for i, k := range kinds {
					own, has := env.bobOwn[k]
					if !has {
						t.Fatalf("%s: add Bob's own %s to bobOwn so a mixed-owner probe can name it", pattern, k)
					}
					out[i] = own.String()
				}
				out[foreign] = alien.String()
				return out
			}
			body := bodies(env.bobNotebook)[pattern]
			got, gotBody := send(t, env.url, env.bob, method, substitute(path, ids(env.ids[kinds[foreign]])), body)
			if got != http.StatusNotFound && got != http.StatusForbidden {
				t.Errorf("%s with Alice's %s among Bob's own ids: %d %s", pattern, kinds[foreign], got, gotBody)
				continue
			}
			if control, _ := send(t, env.url, env.bob, method, substitute(path, ids(uuid.New())), body); control != got {
				t.Errorf("%s: Alice's %s answers %d, a nonexistent one %d", pattern, kinds[foreign], got, control)
			}
		}
	}
	if nested == 0 {
		t.Fatal("no nested routes found; the placeholder parser is broken")
	}
	var n int
	_ = env.pool.QueryRow(context.Background(), `SELECT count(*) FROM documents WHERE user_id = $1`, env.alice).Scan(&n)
	if n != 1 {
		t.Errorf("alice has %d documents after the mixed-owner probes, want 1", n)
	}
}

// placeholderKinds names the kind of each `{…}` in path, by the same
// longest-prefix rule as fill.
func placeholderKinds(path string) ([]string, bool) {
	var kinds []string
	var built strings.Builder
	rest := path
	for {
		open := strings.Index(rest, "{")
		if open < 0 {
			return kinds, true
		}
		closeAt := strings.Index(rest, "}")
		prefix := built.String() + rest[:open]
		kind, best := "", 0
		for p, k := range idKinds {
			if strings.HasSuffix(prefix, p) && len(p) > best {
				kind, best = k, len(p)
			}
		}
		if kind == "" {
			return nil, false
		}
		kinds = append(kinds, kind)
		built.WriteString(rest[:open] + "x")
		rest = rest[closeAt+1:]
	}
}

// substitute fills path's placeholders in order.
func substitute(path string, ids []string) string {
	var out strings.Builder
	rest := path
	for _, id := range ids {
		open, closeAt := strings.Index(rest, "{"), strings.Index(rest, "}")
		out.WriteString(rest[:open] + id)
		rest = rest[closeAt+1:]
	}
	out.WriteString(rest)
	return out.String()
}

func isLoopRoute(path string) bool {
	return strings.HasPrefix(path, "/v1/learning/") || strings.HasPrefix(path, "/v1/cycles/") ||
		strings.HasPrefix(path, "/v1/weekly-reviews/")
}

// fill replaces each placeholder with Alice's id of the right kind (real) and
// with a fresh random id (fake).
func fill(path string, ids resources) (real, fake string, ok bool) {
	var r, f strings.Builder
	rest := path
	for {
		open := strings.Index(rest, "{")
		if open < 0 {
			r.WriteString(rest)
			f.WriteString(rest)
			return r.String(), f.String(), true
		}
		closeAt := strings.Index(rest, "}")
		prefix := r.String() + rest[:open]
		kind := ""
		best := 0
		for p, k := range idKinds {
			if strings.HasSuffix(prefix, p) && len(p) > best {
				kind, best = k, len(p)
			}
		}
		id, found := ids[kind]
		if !found {
			return "", "", false
		}
		r.WriteString(rest[:open] + id.String())
		f.WriteString(rest[:open] + uuid.NewString())
		rest = rest[closeAt+1:]
	}
}

func send(t *testing.T, base string, user uuid.UUID, method, path string, body any) (int, string) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, base+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+isolationToken)
	req.Header.Set(httpx.UserIDHeader, user.String())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 300))
	return res.StatusCode, string(raw)
}

// seedEverything gives Alice one resource of every kind a route can name.
func seedEverything(t *testing.T, pool *pg.Pool, alice uuid.UUID) resources {
	t.Helper()
	ctx := context.Background()
	key := testutil.TestEncryptionKey
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	ids := resources{}

	conn, err := pg.NewProviderConnectionStore(pool, key).CreateConnection(ctx, alice,
		store.NewProviderConnection{Provider: "openai", Kind: store.KindAPIKey, Name: "k", Secret: "sk-x"})
	must(err)
	ids["connection"] = conn.ID
	sc, err := pg.NewSearchConnectionStore(pool, key).UpsertSearchConnection(ctx, alice, "tavily", "tvly-x")
	must(err)
	ids["search_connection"] = sc.ID

	kbs := pg.NewKnowledgeStore(pool)
	kb, err := kbs.CreateKB(ctx, alice, "Alice's KB")
	must(err)
	ids["kb"] = kb.ID
	doc, err := kbs.CreateDocument(ctx, knowledge.Document{
		UserID: alice, KBID: kb.ID, SourceKind: "upload", Title: "a.pdf", MIME: "application/pdf",
		Bytes: 1, SHA256: strings.Repeat("a", 64), Status: "ready",
	})
	must(err)
	ids["document"] = doc.ID

	chats := pg.NewChatStore(pool)
	sess, err := chats.CreateSession(ctx, runtime.Session{UserID: alice, Title: "s", KBIDs: []uuid.UUID{}})
	must(err)
	ids["session"] = sess.ID
	msg, err := chats.AppendMessage(ctx, runtime.ChatMessage{UserID: alice, SessionID: sess.ID, Role: runtime.RoleAssistant, Content: "x", Capability: "solve"})
	must(err)
	ids["message"] = msg.ID
	diagram, err := chats.AppendMessage(ctx, runtime.ChatMessage{UserID: alice, SessionID: sess.ID, Role: runtime.RoleAssistant,
		Content: "```mermaid\nflowchart TD\n  A-->B\n```", Capability: "visualize",
		Attachments: []byte(`{"sources":[],"diagram":{"kind":"mermaid","function":"chat","repaired":false}}`)})
	must(err)
	ids["diagram"] = diagram.ID
	turn, err := pg.NewTurnStore(pool).CreateTurn(ctx, runtime.Turn{UserID: alice, SessionID: sess.ID, Capability: "chat", Status: runtime.StatusWaitingUser})
	must(err)
	ids["turn"] = turn.ID

	questions := pg.NewQuestionStore(pool)
	qs, err := questions.InsertQuestions(ctx, []quiz.Question{{UserID: alice, KBID: kb.ID, Prompt: "p", Type: quiz.TypeShort, Answer: "a", Difficulty: quiz.DifficultyEasy}})
	must(err)
	ids["question"] = qs[0].ID
	att, _, err := questions.RecordAttempt(ctx, quiz.AttemptWrite{UserID: alice, QuestionID: qs[0].ID, UserAnswer: "a", IsCorrect: true, Judge: []byte(`{}`), Rating: "good"})
	must(err)
	ids["attempt"] = att.ID
	// A later wrong answer opens a mistake, so the practice queue has one of
	// Alice's to leak.
	_, _, err = questions.RecordAttempt(ctx, quiz.AttemptWrite{UserID: alice, QuestionID: qs[0].ID, UserAnswer: "b", IsCorrect: false, Judge: []byte(`{}`), Rating: "again"})
	must(err)
	masteries := pg.NewMasteryStore(pool)
	path, err := masteries.CreatePath(ctx, mastery.Path{UserID: alice, KBID: kb.ID, Goal: "g", Status: mastery.StatusActive})
	must(err)
	ids["path"] = path.ID
	planned, err := masteries.ApproveModules(ctx, alice, path.ID, []mastery.ProposedModule{{
		Name: "m", PassThreshold: 0.7, KnowledgePoints: []mastery.ProposedKP{{Name: "k", Type: "concept"}},
	}}, time.Now().UTC())
	must(err)
	ids["knowledge_point"] = planned.Modules[0].KnowledgePoints[0].KnowledgePoint.ID

	notes := pg.NewNotebookStore(pool)
	nb, err := notes.CreateNotebook(ctx, alice, "Alice's", false)
	must(err)
	ids["notebook"] = nb.ID
	note, err := notes.CreateNote(ctx, notebook.Note{UserID: alice, NotebookID: nb.ID, Title: "t", BodyMD: "b", CreatedBy: notebook.CreatedByUser})
	must(err)
	ids["note"] = note.ID
	cat, err := notes.CreateCategory(ctx, alice, nb.ID, "c")
	must(err)
	ids["category"] = cat.ID

	readings := pg.NewReadingStore(pool)
	ws, err := readings.EnsureWorkspace(ctx, alice, doc.ID)
	must(err)
	ids["workspace"] = ws.ID
	hl, err := readings.CreateHighlight(ctx, reading.Highlight{UserID: alice, WorkspaceID: ws.ID, Page: 1, Text: "x", Color: "yellow"})
	must(err)
	ids["highlight"] = hl.ID

	loops := pg.NewLoopStore(pool)
	st, cyc, err := loops.CreateStateWithCycle(ctx, loop.LearningState{
		UserID: alice, Goal: "g", RealScenario: "r", Outcome12w: "o", NextTask: "t",
	}, time.Now().UTC())
	must(err)
	ids["learning_state"], ids["cycle"] = st.ID, cyc.ID
	review, err := loops.CreateReview(ctx, alice, cyc.ID, 1)
	must(err)
	ids["review"] = review.ID
	ev, err := loops.AddEvidence(ctx, loop.EvidenceRef{UserID: alice, ReviewID: &review.ID,
		Kind: loop.KindQuestionAttempt, RefID: att.ID, Status: loop.StatusAccepted, SuggestedBy: loop.SuggestedByUser})
	must(err)
	ids["evidence"] = ev.ID
	chain, err := loops.CreateChain(ctx, loop.Chain{UserID: alice, StateID: st.ID, Question: "q"})
	must(err)
	ids["chain"] = chain.ID
	brief, err := loops.CreateBrief(ctx, loop.Brief{UserID: alice, StateID: st.ID, Task: "t"})
	must(err)
	ids["brief"] = brief.ID
	lg, err := loops.CreateLog(ctx, loop.Log{UserID: alice, BriefID: brief.ID})
	must(err)
	ids["log"] = lg.ID
	// The learning-depth evidence kinds: an explain-back is a judged attempt
	// at Alice's point (phase 2); a card entry is a real entry on a card (phase 8).
	var eb, ce uuid.UUID
	must(pool.QueryRow(ctx, `INSERT INTO explain_back_attempts
		(user_id, kp_id, path_id, request_id, explanation, verdict, judged_at)
		VALUES ($1, $2, $3, $4, 'Parametric memory lives in the weights.', 'failed', now()) RETURNING id`,
		alice, ids["knowledge_point"], path.ID, uuid.New()).Scan(&eb))
	card, err := loops.CreateCard(ctx, loop.SkillCard{UserID: alice, StateID: st.ID, Kind: loop.CardReading, Title: "a"})
	must(err)
	at := time.Now().UTC()
	_, err = loops.AddCardEntry(ctx, alice, card.ID, loop.CardEntry{Timepoint: loop.TimepointBaseline, Body: "b",
		PromptLevel: loop.PromptUnaided, Links: []loop.CardLink{{Kind: loop.LinkNote, ID: note.ID}}},
		func(loop.SkillCard) (*loop.CardChange, error) {
			return &loop.CardChange{Status: loop.CardRetestDue, BaselineAt: &at, RetestDueOn: "2026-10-11"}, nil
		})
	must(err)
	must(pool.QueryRow(ctx, `SELECT id FROM card_entries WHERE card_id = $1`, card.ID).Scan(&ce))
	ids["explain_back"], ids["card_entry"], ids["card"] = eb, ce, card.ID

	// Learning depth, phase 7: a vocabulary note (and its two cards) saved
	// from Alice's document.
	word, _, err := pg.NewVocabStore(pool).SaveNote(ctx, vocab.NoteWrite{
		UserID: alice, Term: "equilibrium", Lang: "en", Meaning: "m",
		Context:    vocab.Context{Sentence: "s", DocumentID: &doc.ID, Page: 1},
		DocumentID: doc.ID, Page: 1, NewCard: learning.NewScheduler().NewCard(time.Now()), Now: time.Now().UTC(),
	})
	must(err)
	ids["vocab"], ids["vocab_card"] = word.ID, word.Cards[0].ID

	rep, err := pg.NewResearchStore(pool).InsertReport(ctx, research.Report{UserID: alice, SessionID: &sess.ID, Query: "q", Mode: "quick", ReportMD: "r", KBOnly: true, KBOnlyReason: "no_search_key"})
	must(err)
	ids["report"] = rep.ID
	ov, err := pg.NewAudioStore(pool).Create(ctx, audio.Overview{UserID: alice, KBID: &kb.ID, Minutes: 5, Status: audio.StatusScripting})
	must(err)
	ids["audio"] = ov.ID

	// Learning depth, phase 9: a profile entry of Alice's and a proposal
	// (which accept and reject would act on), and a consolidation run.
	profiles := pg.NewProfileStore(pool)
	entry, err := profiles.Create(ctx, profile.NewEntry{UserID: alice, Section: profile.SectionPreferences, Text: "Examples first.", KBID: &kb.ID})
	must(err)
	ids["profile_entry"] = entry.ID
	run, err := profiles.StartRun(ctx, alice, time.Now().UTC())
	must(err)
	must(profiles.FinishRun(ctx, alice, run, profile.RunResult{Status: profile.RunSkipped, Error: "no new activity"}, time.Now().UTC()))
	ids["profile_run"] = run
	// Learning depth, phase 11: a confirmed book with a chapter, a
	// flash-card block and its cards, anchored on Alice's chunk.
	ids["chunk"] = seedChunk(t, pool, alice, kb.ID, doc.ID)
	b := seedBook(t, pool, alice, kb.ID, ids["chunk"], true)
	ids["book"], ids["book_chapter"], ids["book_block"] = b.book, b.chapter, b.block
	// Learning depth, phase 3: a template, an exam in progress, and its item.
	ids["exam_template"], ids["exam"] = seedExam(t, pool, alice, kb.ID)
	items, err := pg.NewExamStore(pool).Items(ctx, alice, ids["exam"])
	must(err)
	ids["exam_item"] = items[0].ID
	// up methods, phase 0: a worksheet on Alice's learning state, and one on
	// her document.
	sheets := pg.NewWorksheetStore(pool)
	onState, err := sheets.Create(ctx, worksheet.Worksheet{UserID: alice, Kind: worksheettest.State, KindVersion: 1,
		Title: "Alice's worksheet", Answers: worksheet.Answers{}, StateID: &st.ID, Status: worksheet.StatusOpen,
		Reviews: map[string]worksheet.ReviewDate{}})
	must(err)
	onDoc, err := sheets.Create(ctx, worksheet.Worksheet{UserID: alice, Kind: worksheettest.Document, KindVersion: 1,
		Title: "Alice's document worksheet", Answers: worksheet.Answers{}, DocumentID: &doc.ID, Status: worksheet.StatusOpen,
		Reviews: map[string]worksheet.ReviewDate{}})
	must(err)
	ids["worksheet"], ids["document_worksheet"] = onState.ID, onDoc.ID
	// up methods, phase 7: a recording on Alice's worksheet. The row is
	// enough: every probe is refused before a file would be read.
	ids["recording"] = seedRecording(t, pool, alice, onState.ID)
	// Up-methods phase 18: a site and a repository in Alice's knowledge base.
	sources := pg.NewSourceStore(pool)
	site, err := sources.CreateSite(ctx, knowledge.Site{UserID: alice, KBID: kb.ID,
		StartURL: "https://docs.example.com/guide/", PathPrefix: "/guide/", MaxDepth: 1, MaxPages: 5, Title: "Guide"})
	must(err)
	ids["site"] = site.ID
	repo, err := sources.CreateRepo(ctx, knowledge.Repo{UserID: alice, KBID: kb.ID, Owner: "acme", Name: "docs",
		Extensions: []string{".md"}, IgnorePaths: []string{}})
	must(err)
	ids["repo"] = repo.ID
	// Up-methods phase 17: a podcast feed with one new episode.
	feedStore := pg.NewFeedStore(pool)
	feed, err := feedStore.CreateFeed(ctx, knowledge.Feed{UserID: alice, KBID: kb.ID, Kind: "podcast",
		URL: "https://podcast.example.com/feed.rss", Title: "A podcast", ListedBy: knowledge.ListedByFeed},
		knowledge.FeedListing{}, knowledge.MaxFeedsPerKB, time.Now())
	must(err)
	_, err = feedStore.RecordFeedCheck(ctx, alice, feed.ID, knowledge.FeedListing{ListedBy: knowledge.ListedByFeed,
		Entries: []feeds.Entry{{Key: "0123456789abcdef0123456789abcdef", Title: "Episode 1",
			MediaURL: "https://podcast.example.com/ep1.mp3", MediaType: "audio/mpeg"}}}, time.Now())
	must(err)
	ids["feed"] = feed.ID
	return ids
}

// seedRecording gives a worksheet one recording row.
func seedRecording(t *testing.T, pool *pg.Pool, user, sheet uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `INSERT INTO worksheet_recordings (user_id, worksheet_id, mime, bytes, duration_seconds)
		VALUES ($1, $2, 'audio/webm', 64, 90) RETURNING id`, user, sheet).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// seedChunk gives a user one chunk of their document (no embedding: nothing
// here searches).
func seedChunk(t *testing.T, pool *pg.Pool, user, kbID, docID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO chunks (user_id, kb_id, document_id, ord, page_start, page_end, text, dims)
		VALUES ($1, $2, $3, 0, 1, 1, 'A passage of the owner''s own.', 1536) RETURNING id`,
		user, kbID, docID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

type seededBook struct{ book, chapter, block uuid.UUID }

// seedBook gives a user a book on their knowledge base, anchored on their
// chunk: proposed, or confirmed with one chapter holding a flash-card block
// and two cards.
func seedBook(t *testing.T, pool *pg.Pool, user, kbID, chunk uuid.UUID, confirmed bool) seededBook {
	t.Helper()
	ctx := context.Background()
	books := pg.NewBookStore(pool)
	chapter := book.ProposedChapter{Title: "One", Objectives: []string{"o"}, Anchors: []uuid.UUID{chunk}}
	b, err := books.CreateBook(ctx, book.Book{UserID: user, KBID: kbID, Title: "A book", Length: 4,
		Status: book.StatusProposed, Proposal: book.Proposal{Title: "A book", Chapters: []book.ProposedChapter{chapter},
			Outline: []book.OutlineItem{{ChunkID: chunk, Title: "doc", Snippet: "s"}}}})
	if err != nil {
		t.Fatal(err)
	}
	out := seededBook{book: b.ID}
	if !confirmed {
		return out
	}
	if ok, err := books.Confirm(ctx, user, b.ID, []book.ProposedChapter{chapter}); err != nil || !ok {
		t.Fatalf("confirm: %v %v", ok, err)
	}
	got, err := books.GetBook(ctx, user, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	out.chapter = got.Chapters[0].ID
	if err := books.SavePlan(ctx, user, out.chapter, []book.PlannedBlock{{Type: book.TypeFlashCards, Title: "Cards", Brief: "b"}}); err != nil {
		t.Fatal(err)
	}
	blocks, err := books.Blocks(ctx, user, out.chapter)
	if err != nil {
		t.Fatal(err)
	}
	out.block = blocks[0].ID
	if err := books.SaveBlock(ctx, user, out.block, book.BlockWrite{Payload: []byte(`{"count":2}`),
		Flash:   []vocab.FlashCard{{Front: "f1", Back: "b1"}, {Front: "f2", Back: "b2"}},
		NewCard: learning.NewScheduler().NewCard(time.Now()), Now: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	return out
}

// seedExam gives user a ready template and an exam of it, started, with one
// true/false item.
func seedExam(t *testing.T, pool *pg.Pool, user, kb uuid.UUID) (template, examID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	exams := pg.NewExamStore(pool)
	tmpl, err := exams.CreateTemplate(ctx, exam.Template{UserID: user, Title: "Midterm", Filename: "m.pdf",
		Kind: exam.KindPDF, SHA256: strings.Repeat("e", 64), Bytes: 1, PageCount: 1, Status: exam.TemplateQueued})
	if err != nil {
		t.Fatal(err)
	}
	item := exam.Item{Number: "1", Type: quiz.TypeTF, StemMD: "s", Points: 1, Difficulty: "easy", SourcePage: 1}
	if err := exams.FinishExtraction(ctx, user, tmpl.ID, []exam.Item{item}, nil, 1); err != nil {
		t.Fatal(err)
	}
	e, err := exams.CreateExam(ctx, exam.Exam{UserID: user, TemplateID: &tmpl.ID, KBID: kb, Title: "Midterm",
		Status: exam.ExamGenerating, Requested: 1, Blueprint: []exam.Item{item}})
	if err != nil {
		t.Fatal(err)
	}
	if err := exams.AddGeneratedItem(ctx, e.ID, 0, quiz.Question{UserID: user, KBID: kb, Prompt: "p",
		Type: quiz.TypeTF, Answer: "true", Difficulty: "easy"}, 1, "1"); err != nil {
		t.Fatal(err)
	}
	if err := exams.FinishGeneration(ctx, user, e.ID, ""); err != nil {
		t.Fatal(err)
	}
	if ok, err := exams.Start(ctx, user, e.ID, nil, time.Now()); !ok || err != nil {
		t.Fatalf("start: %v %v", ok, err)
	}
	return tmpl.ID, e.ID
}

// A write whose BODY names a resource: Bob's request carrying Alice's id must
// fail and must fail exactly as a nonexistent id does.
//
// Every write route without a path id must appear either here or in
// writesWithoutResourceIDs, so a new one forces the decision.
type bodyProbe struct {
	// own is the kind of Bob's resource the path names (default: session).
	own     string
	pattern string
	path    string // concrete path, when it differs from the pattern
	body    func(e *isolationEnv, id uuid.UUID) any
	kind    string // the kind of Alice's id placed in the body
}

func bodyProbes() []bodyProbe {
	kbList := func(e *isolationEnv, id uuid.UUID) any {
		return map[string]any{"title": "x", "kb_ids": []string{id.String()}}
	}
	return []bodyProbe{
		{pattern: "POST /v1/chat/sessions", kind: "kb", body: kbList},
		{pattern: "PATCH /v1/chat/sessions/{id}", kind: "kb", body: func(e *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kb_ids": []string{id.String()}}
		}},
		// Alice's connection pinned to Bob's conversation.
		{pattern: "PATCH /v1/chat/sessions/{id}", kind: "connection", body: func(e *isolationEnv, id uuid.UUID) any {
			return map[string]any{"connection_id": id.String()}
		}},
		{pattern: "POST /v1/quiz/generate", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any { return map[string]any{"kb_id": id} }},
		{pattern: "POST /v1/mastery/paths", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kb_id": id, "goal": "g"}
		}},
		{pattern: "POST /v1/reading/workspaces", kind: "document", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"document_id": id}
		}},
		{pattern: "POST /v1/solve", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"problem": "2+2", "kb_ids": []string{id.String()}}
		}},
		{pattern: "POST /v1/solve", kind: "session", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"problem": "2+2", "session_id": id}
		}},
		{pattern: "POST /v1/research", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"query": "q", "mode": "quick", "kb_ids": []string{id.String()}}
		}},
		{pattern: "POST /v1/research", kind: "session", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"query": "q", "mode": "quick", "session_id": id}
		}},
		{pattern: "POST /v1/weekly-reviews/{id}/evidence", own: "review", kind: "attempt", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kind": "question_attempt", "ref_id": id}
		}},
		// Every evidence kind, including the two the groundwork migration added:
		// OwnsTarget must refuse Alice's rows of each.
		{pattern: "POST /v1/weekly-reviews/{id}/evidence", own: "review", kind: "explain_back", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kind": "explain_back", "ref_id": id}
		}},
		{pattern: "POST /v1/learning/chains/{id}/evidence", own: "chain", kind: "card_entry", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kind": "card_entry", "ref_id": id, "timepoint": "baseline"}
		}},
		{pattern: "POST /v1/learning/chains/{id}/evidence", own: "chain", kind: "attempt", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kind": "question_attempt", "ref_id": id, "timepoint": "baseline"}
		}},
		{pattern: "POST /v1/learning/chains/{id}/evidence", own: "chain", kind: "report", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kind": "research_report", "ref_id": id, "timepoint": "transfer"}
		}},
		// Audit F-8: routes whose path names Bob's own resource and whose body
		// names a second one.
		// Bob's own report into Alice's knowledge base.
		{pattern: "POST /v1/research/reports/{id}/knowledge", own: "report", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kb_id": id.String()}
		}},
		// Bob's own notebook, Alice's category on the new note.
		{pattern: "POST /v1/notebooks/{id}/notes", own: "notebook", kind: "category", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"title": "x", "body_md": "x", "category_ids": []string{id.String()}}
		}},
		{pattern: "POST /v1/notes/{id}/move", own: "note", kind: "notebook", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"notebook_id": id}
		}},
		{pattern: "POST /v1/notes/{id}/copy", own: "note", kind: "notebook", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"notebook_id": id}
		}},
		{pattern: "PATCH /v1/notes/{id}", own: "note", kind: "category", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"category_ids": []string{id.String()}}
		}},
		{pattern: "PATCH /v1/reading/highlights/{hid}", own: "highlight", kind: "note", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"note_id": id.String()}
		}},
		{pattern: "POST /v1/reading/{id}/notes", own: "workspace", kind: "notebook", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"body_md": "x", "page": 1, "notebook_id": id.String()}
		}},
		{pattern: "POST /v1/reading/{id}/notes", own: "workspace", kind: "highlight", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"body_md": "x", "page": 1, "highlight_id": id.String()}
		}},
		{pattern: "POST /v1/solve/messages/{id}/question", own: "message", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kb_id": id.String()}
		}},
		// An audio overview of Alice's knowledge base or report.
		{pattern: "POST /v1/audio-overviews", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kb_id": id.String()}
		}},
		{pattern: "POST /v1/audio-overviews", kind: "report", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"report_id": id.String()}
		}},
		// Bob's own conversation, rewound to Alice's message (regenerate, edit).
		{pattern: "POST /v1/chat/sessions/{id}/turns", kind: "message", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"message": "x", "rewind_to_id": id.String()}
		}},
		// "Draw it" on Alice's answer.
		{pattern: "POST /v1/visualize", kind: "message", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"message_id": id.String()}
		}},
		// A word saved from Alice's reading workspace.
		{pattern: "POST /v1/vocab", kind: "workspace", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"workspace_id": id, "page": 1, "selection": "x", "term": "x", "meaning": "m"}
		}},
		// Phase 8: the ids in a card entry's links (jsonb). Bob's own card,
		// Alice's note, document or attempt in the links.
		{pattern: "POST /v1/learning/cards/{id}/entries", own: "card", kind: "note", body: cardLinks("note")},
		{pattern: "POST /v1/learning/cards/{id}/entries", own: "card", kind: "document", body: cardLinks("document")},
		{pattern: "POST /v1/learning/cards/{id}/entries", own: "card", kind: "attempt", body: cardLinks("quiz_attempt")},
		// Phase 9: a profile entry scoped to Alice's knowledge base, new or
		// moved there from Bob's own entry.
		{pattern: "POST /v1/profile/entries", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"section": "struggles", "text": "x", "kb_id": id.String()}
		}},
		{pattern: "PATCH /v1/profile/entries/{id}", own: "profile_entry", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kb_id": id.String()}
		}},
		// Learning depth, phase 11: a book of Alice's knowledge base, and
		// Bob's own proposed outline anchored on Alice's chunk (jsonb ids).
		{pattern: "POST /v1/books", kind: "kb", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kb_id": id.String(), "chapters": 4}
		}},
		{pattern: "PUT /v1/books/{id}/proposal", own: "book", kind: "chunk", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"title": "t", "chapters": []any{map[string]any{
				"title": "c", "objectives": []string{"o"}, "anchors": []string{id.String()}}}}
		}},
		// A mock exam of Bob's own template from Alice's knowledge base, and of
		// Alice's template from Bob's own knowledge base.
		{pattern: "POST /v1/exams", kind: "kb", body: func(e *isolationEnv, id uuid.UUID) any {
			return map[string]any{"template_id": e.bobOwn["exam_template"], "kb_id": id}
		}},
		{pattern: "POST /v1/exams", kind: "exam_template", body: func(e *isolationEnv, id uuid.UUID) any {
			return map[string]any{"template_id": id, "kb_id": e.bobOwn["kb"]}
		}},
		// An answer to Alice's exam item, saved into Bob's own exam.
		{pattern: "PUT /v1/exams/{id}/answers", own: "exam", kind: "exam_item", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"answers": []any{map[string]any{"item_id": id, "answer": "x"}}}
		}},
		// up methods, phase 0: a worksheet on Alice's state or document.
		{pattern: "POST /v1/worksheets", kind: "learning_state", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kind": worksheettest.State, "title": "x", "state_id": id}
		}},
		{pattern: "POST /v1/worksheets", kind: "document", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kind": worksheettest.Document, "title": "x", "document_id": id}
		}},
		{pattern: "PUT /v1/byok/routes/{function}", path: "/v1/byok/routes/chat", kind: "connection", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"entries": []any{map[string]any{"connection_id": id, "model": "m"}}}
		}},
		// Up-methods phase 21: Bob's own video transcribed by Alice's speech
		// key. Resolved on Bob's own stt route, before the video's state.
		{pattern: "POST /v1/documents/{id}/transcribe", own: "document", kind: "connection", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"engine": "byok", "connection_id": id}
		}},
		// Up-methods phase 7: Bob's own speaking evidence whose audio cell
		// names Alice's recording, written by PATCH or by a row append.
		// Resolved with the worksheet id and the caller's id under the row
		// lock, on save; served only through both ids and the owner.
		{pattern: "PATCH /v1/worksheets/{id}", own: "worksheet", kind: "recording", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"revision": time.Now().UTC().Format(time.RFC3339Nano), "answers": map[string]any{
				"baselines": map[string]any{"samples": []any{map[string]any{"row": "monologue", "cells": map[string]any{"recording": id}}}}}}
		}},
		{pattern: "POST /v1/worksheets/{id}/rows", own: "worksheet", kind: "recording", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"section": "shadowing", "field": "ladder", "row": map[string]any{"row": "mark", "cells": map[string]any{"recording": id}}}
		}},
		// Up-methods phase 22: Bob's own overview spoken on Alice's speech
		// key. Resolved on Bob's own tts route before the overview's state.
		{pattern: "POST /v1/audio-overviews/{id}/speak", own: "audio", kind: "connection", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"engine": "byok", "connection_id": id}
		}},
		// Up-methods phase 10: a close of Alice's cycle, on no state or on
		// Bob's own state. The cycle is resolved with the caller before its
		// state is compared, so both answer like a missing cycle.
		{pattern: "POST /v1/worksheets", kind: "cycle", body: func(_ *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kind": "cycle_close", "title": "x", "cycle_id": id}
		}},
		{pattern: "POST /v1/worksheets", kind: "cycle", body: func(e *isolationEnv, id uuid.UUID) any {
			return map[string]any{"kind": "cycle_close", "title": "x", "cycle_id": id, "state_id": e.bobOwn["learning_state"]}
		}},
	}
}

// cardLinks is a card entry naming one linked row of the given kind.
func cardLinks(kind string) func(*isolationEnv, uuid.UUID) any {
	return func(_ *isolationEnv, id uuid.UUID) any {
		return map[string]any{"timepoint": "baseline", "body": "x",
			"links": []any{map[string]any{"kind": kind, "id": id}}}
	}
}

func isolationCard() map[string]any {
	return map[string]any{"kind": "reading", "title": "t", "setup": map[string]string{
		"situation": "s", "source": "s", "standard": "s"}}
}

// validatesBeforeOwnership are body probes whose foreign-id answer is a 400
// with a sentence identical to a nonexistent id's — still no oracle.
var validatesBeforeOwnership = map[string]bool{
	"PUT /v1/byok/routes/{function}": true, // "One of the chosen connections no longer exists"
}

// writesWithoutResourceIDs name no other resource in their body.
var writesWithoutResourceIDs = map[string]string{
	"POST /v1/auth/identity":                     "gateway-only; link target is cross-checked against the verified identity",
	"POST /v1/byok/connections":                  "creates the caller's own connection",
	"POST /v1/byok/connections/relay":            "creates the caller's own connection",
	"POST /v1/byok/connections/gemini-sub":       "creates the caller's own connection",
	"POST /v1/byok/connections/copilot/start":    "starts the caller's own sign-in",
	"POST /v1/byok/connections/claude-sub/start": "starts the caller's own sign-in",
	// The finish body names a sign-in handle: an in-memory string bound to the
	// user who started it, not a database row a fixture can seed. Probed by
	// TestASignInHandleIsRefusedToAnotherUser instead.
	"POST /v1/byok/connections/copilot/finish":    "sign-in handle; probed by TestASignInHandleIsRefusedToAnotherUser",
	"POST /v1/byok/connections/claude-sub/finish": "sign-in handle; probed by TestASignInHandleIsRefusedToAnotherUser",
	"POST /v1/byok/search-connections":            "creates the caller's own search key",
	"POST /v1/kb":                                 "creates the caller's own knowledge base",
	"POST /v1/notebooks":                          "creates the caller's own notebook",
	"POST /v1/connectors/drive/credentials":       "stores the caller's own Drive grant",
	"POST /v1/connectors/drive/sync":              "syncs the caller's own grants",
	"POST /v1/connectors/drive/picker-token":      "returns the caller's own token",
	"DELETE /v1/connectors/drive":                 "disconnects the caller's own grant",
	"DELETE /v1/me":                               "deletes the caller's own account",
	"POST /v1/auth/session-watermark":             "revokes the caller's own sessions",
	"POST /v1/learning/states":                    "creates the caller's own learning state from text fields",
	// Writes whose PATH names the resource and whose body names no other one.
	// A route whose body gains an id moves to bodyProbes.
	"PUT /v1/me/timezone": "stores the caller's own zone name",
	// A push endpoint is a browser's capability URL, not a row id: the
	// delete is scoped to the caller's rows, and a subscribe moves the row
	// to the caller because only that browser knows its endpoint.
	"PUT /v1/push/settings":                        "stores the caller's own reminder hour",
	"POST /v1/push/subscriptions":                  "subscribes the caller's own browser",
	"DELETE /v1/push/subscriptions":                "unsubscribes one of the caller's own browsers; WHERE user_id",
	"POST /v1/push/test":                           "pushes to the caller's own browsers",
	"PUT /v1/byok/connections/{id}":                "renames or re-keys the path's connection; body names nothing else",
	"DELETE /v1/byok/connections/{id}":             "no body",
	"POST /v1/byok/connections/{id}/verify":        "no body",
	"DELETE /v1/byok/search-connections/{id}":      "no body",
	"POST /v1/byok/search-connections/{id}/verify": "no body",
	"DELETE /v1/chat/sessions/{id}":                "no body",
	"POST /v1/turns/{id}/cancel":                   "no body",
	"POST /v1/turns/{id}/answer":                   "question_id is matched against the turn's own pending question (requestIDFields)",
	"DELETE /v1/kb/{id}":                           "no body",
	"POST /v1/kb/{id}/documents":                   "a multipart file; names nothing else",
	"DELETE /v1/kb/{id}/documents/{doc}":           "no body; both path ids probed, mixed owners too (TestNestedRoutesRefuseMixedOwners)",
	"POST /v1/kb/{id}/reindex":                     "no body",
	"POST /v1/kb/{id}/query":                       "query text and a limit",
	"POST /v1/questions/{id}/attempt":              "the answer text and a self-attribution",
	"POST /v1/quiz/attempts/{id}/override":         "a verdict",
	"DELETE /v1/mastery/paths/{id}":                "no body",
	"POST /v1/mastery/paths/{id}/propose":          "no body",
	"POST /v1/mastery/paths/{id}/approve":          "module and knowledge-point names; no ids",
	"POST /v1/mastery/paths/{id}/diagnostic":       "no body",
	"POST /v1/mastery/points/{id}/learn":           "a variant number and a refresh flag",
	"POST /v1/mastery/points/{id}/explain-back":    "the learner's text and request_id, an idempotency key scoped to the caller (requestIDFields)",
	"POST /v1/mastery/explain-back/{id}/override":  "no body",
	"PATCH /v1/notebooks/{id}":                     "a name",
	"DELETE /v1/notebooks/{id}":                    "no body",
	"POST /v1/notebooks/{id}/categories":           "a name",
	"DELETE /v1/note-categories/{id}":              "no body",
	"DELETE /v1/notes/{id}":                        "no body",
	"DELETE /v1/reading/highlights/{hid}":          "no body",
	"PATCH /v1/reading/{id}":                       "reading progress",
	"DELETE /v1/reading/{id}":                      "no body",
	"POST /v1/reading/{id}/highlights":             "page, text and colour",
	"POST /v1/reading/{id}/actions":                "an action, the selected text and a page",
	"POST /v1/kb/{id}/drive/import":                "Drive file ids name Google's files through the caller's own grant, not rows",
	"POST /v1/solve/messages/{id}/note":            "no body; the note goes to the caller's default notebook",
	"POST /v1/research/reports/{id}/note":          "no body; the note goes to the caller's default notebook",
	"PATCH /v1/learning/states/{id}":               "text fields",
	"DELETE /v1/learning/states/{id}":              "no body",
	"POST /v1/learning/states/{id}/interrupt":      "the interruption's six text lines",
	"POST /v1/learning/states/{id}/cycles":         "no body",
	"POST /v1/learning/states/{id}/resume":         "no body",
	"POST /v1/learning/states/{id}/handover":       "handover text and two flags",
	"POST /v1/learning/states/{id}/chains":         "a question and a split",
	"POST /v1/learning/states/{id}/briefs":         "text fields",
	"PATCH /v1/cycles/{id}":                        "weekly questions and a review text",
	"POST /v1/cycles/{id}/advance":                 "no body; the gate reads the cycle's own evidence",
	"POST /v1/cycles/{id}/reviews":                 "a week number",
	"PATCH /v1/weekly-reviews/{id}":                "scores and text",
	"POST /v1/weekly-reviews/{id}/writeback":       "no body",
	"PATCH /v1/learning/evidence/{id}":             "status, timepoint and a note",
	"DELETE /v1/learning/evidence/{id}":            "no body",
	"PATCH /v1/learning/chains/{id}":               "a question and a split",
	"DELETE /v1/learning/chains/{id}":              "no body",
	"PATCH /v1/learning/briefs/{id}":               "text fields",
	"DELETE /v1/learning/briefs/{id}":              "no body",
	"POST /v1/learning/briefs/{id}/logs":           "table cells and text",
	"PATCH /v1/learning/logs/{id}":                 "table cells and text",
	"DELETE /v1/learning/logs/{id}":                "no body",
	"POST /v1/visualize/{id}/repair":               "the browser's parse error text",
	"POST /v1/kb/{id}/papers":                      "openalex_id names an OpenAlex work the server re-reads, not a row; the path's knowledge base is probed",
	"POST /v1/reading/{id}/diagram":                "the selected text and the learner's request",
	"POST /v1/audio-overviews/{id}/cancel":         "no body",
	"DELETE /v1/audio-overviews/{id}":              "no body",
	"POST /v1/reading/{id}/terms":                  "the selected text and a page",
	"PATCH /v1/vocab/{id}":                         "meaning, reading, part of speech, language and a suspend flag",
	"DELETE /v1/vocab/{id}":                        "no body",
	"POST /v1/vocab/cards/{id}/review":             "a rating, the typed answer and request_id (an idempotency key, not a row)",
	"POST /v1/learning/states/{id}/cards":          "a kind, a title and setup text",
	"POST /v1/learning/cards/{id}/close":           "reflection text",
	// Links (learning-depth phase 4). Their bodies name a URL, a flag, a
	// subtitle file, pasted text or a caption language: never a row.
	"POST /v1/kb/{id}/links":             "a URL and an auto-sync flag; the URL names a page or a video, not a row",
	"PATCH /v1/documents/{id}":           "an auto-sync flag",
	"POST /v1/documents/{id}/resync":     "no body",
	"POST /v1/documents/{id}/retry":      "no body",
	"POST /v1/documents/{id}/transcript": "a subtitle file, pasted text, or a caption language code",
	// Up-methods phase 15: stopping a recording's or a video's transcription.
	"POST /v1/documents/{id}/transcribe/cancel":   "no body; the job is found by the document and the caller",
	"DELETE /v1/profile":                          "clears the caller's own profile",
	"PUT /v1/profile/settings":                    "the caller's own consolidation switch",
	"DELETE /v1/profile/entries/{id}":             "no body",
	"POST /v1/profile/entries/{id}/accept":        "no body",
	"POST /v1/profile/entries/{id}/reject":        "no body",
	"POST /v1/books/{id}/confirm":                 "no body",
	"POST /v1/books/{id}/compile":                 "no body",
	"POST /v1/books/{id}/cancel":                  "no body",
	"POST /v1/books/{id}/chapters/{cid}/compile":  "no body; both path ids probed, mixed owners too",
	"POST /v1/books/{id}/chapters/{cid}/notes":    "the note's text; both path ids probed, mixed owners too",
	"POST /v1/books/{id}/blocks/{bid}/regenerate": "no body; both path ids probed, mixed owners too",
	"PUT /v1/books/{id}/blocks/{bid}/review":      "an on/off flag; both path ids probed, mixed owners too",
	"DELETE /v1/books/{id}":                       "no body",
	"POST /v1/exams/templates":                    "a multipart file; names nothing else",
	"POST /v1/documents/{id}/study-notes":         "a language code",
	"PATCH /v1/exams/templates/{id}":              "title, time limit and the reviewed items, which name no rows (numbers, types, text, points, pages)",
	"DELETE /v1/exams/templates/{id}":             "no body",
	"POST /v1/exams/templates/{id}/cancel":        "no body",
	"POST /v1/exams/{id}/start":                   "an optional time limit",
	"POST /v1/exams/{id}/submit":                  "no body",
	"POST /v1/exams/{id}/cancel":                  "no body",
	"DELETE /v1/exams/{id}":                       "no body",
	// up-methods phase 11.
	"PUT /v1/me/own-version-first":       "the caller's own on/off switch",
	"POST /v1/chat/messages/{id}/retell": "the learner's retell text; the path's answer is probed",
	// up methods, phase 0.
	"DELETE /v1/worksheets/{id}": "no body",
	// Up-methods phase 7. The upload's body is the audio and its length.
	"POST /v1/worksheets/{id}/recordings":         "a multipart audio part and its duration; the path's worksheet is resolved before the body is read",
	"DELETE /v1/worksheets/{id}/recordings/{rid}": "no body; both path ids probed, mixed owners too",
	// Up-methods phase 18. Bodies name a URL, limits, a branch, a folder,
	// file types and ignore patterns: never a row. The path's knowledge base,
	// site or repository is probed.
	"POST /v1/kb/{id}/sites":     "a start URL, a depth and a page limit",
	"POST /v1/sites/{id}/resync": "no body",
	"POST /v1/sites/{id}/cancel": "no body",
	"DELETE /v1/sites/{id}":      "no body",
	"POST /v1/kb/{id}/repos":     "a GitHub URL, a branch, a folder, file types and ignore patterns",
	"POST /v1/repos/{id}/resync": "no body",
	"DELETE /v1/repos/{id}":      "no body",
	// Up-methods phase 17. A pick names entry keys, which are resolved only
	// within the path's feed (itself probed): another feed's key matches
	// nothing. The others carry no body or a boolean.
	"POST /v1/feeds/{id}/check":   "no body",
	"POST /v1/feeds/{id}/entries": "entry keys of the path's feed, never a row id",
	"POST /v1/feeds/{id}/seen":    "no body",
	"PATCH /v1/feeds/{id}":        "auto_add, a boolean",
	"DELETE /v1/feeds/{id}":       "no body",
	// up methods, phase 4.
	"POST /v1/worksheets/{id}/diagnose": "a pass number, 1 to 5; the draft is read from the path's worksheet",
	// up methods, phase 3.
	"POST /v1/vocab/{id}/production": "the learner's scenario and a confusable expression; the path's note is probed",
	// up methods, phase 20.
	"POST /v1/kb/{id}/zotero/items": "item_key names an item in the caller's own Zotero library, re-read from Zotero on the caller's key, not a row; the path's knowledge base is probed",
	// drive-user-storage phase 2. The storage routes name nothing but the
	// caller; a move is planned from the caller's own files and runs as the
	// caller. Each "Save to my Drive" resolves the path's resource first.
	"PUT /v1/me/file-storage":                          `"server" or "drive", the caller's own choice`,
	"POST /v1/me/file-storage/move":                    "no body; the caller's own files, planned from their own rows and directory",
	"POST /v1/me/file-storage/move/cancel":             "no body; the caller's own latest move",
	"POST /v1/worksheets/{id}/export/drive":            "no body; the path's worksheet is probed",
	"POST /v1/documents/{id}/study-notes/export/drive": "a language query parameter; the path's video is probed",
	"POST /v1/books/{id}/export/drive":                 "no body; the path's book is probed",
	"POST /v1/notebooks/{id}/export/drive":             "no body; the path's notebook is probed",
}

func TestEveryBodyIDRefusesAnotherUser(t *testing.T) {
	env := newIsolationEnv(t)

	probed := map[string]bool{}
	for _, p := range bodyProbes() {
		probed[p.pattern] = true
		method, path, _ := strings.Cut(p.pattern, " ")
		if p.path != "" {
			path = p.path
		}
		// A path id in a body probe is Bob's OWN resource: the only foreign
		// thing in the request is the id in the body.
		own := p.own
		if own == "" {
			own = "session"
		}
		if i, j := strings.Index(path, "{"), strings.Index(path, "}"); i >= 0 && j > i && !strings.Contains(path, "{function}") {
			path = path[:i] + env.bobOwn[own].String() + path[j+1:]
		}

		got, gotBody := send(t, env.url, env.bob, method, path, p.body(env, env.ids[p.kind]))
		// Only an ownership answer proves anything. A 400 or 429 for both the
		// foreign and the random id would pass the comparison below while
		// never reaching the ownership check; a 500 is a bug either way.
		if got != http.StatusNotFound && got != http.StatusForbidden && !validatesBeforeOwnership[p.pattern] {
			t.Errorf("%s [%s]: status %d never reached the ownership check: %s", p.pattern, p.kind, got, gotBody)
			continue
		}
		if got >= 200 && got < 300 {
			t.Errorf("%s with another user's %s in the body succeeded: %d %s", p.pattern, p.kind, got, gotBody)
			continue
		}
		if control, _ := send(t, env.url, env.bob, method, path, p.body(env, uuid.New())); control != got {
			t.Errorf("%s: another user's %s answers %d, a nonexistent one %d", p.pattern, p.kind, got, control)
		}
	}

	// Every write route, path id or not (learning-depth red team SF-2: a
	// route like PATCH /v1/notes/{id} can carry a SECOND id in its body, and
	// the exemption for path-id routes meant nobody had to decide).
	for _, pattern := range api.RegisteredPatterns() {
		method, _, _ := strings.Cut(pattern, " ")
		if method == http.MethodGet {
			continue
		}
		if !probed[pattern] && writesWithoutResourceIDs[pattern] == "" {
			t.Errorf("%s: write route with no body probe — add one to bodyProbes, or say why it names no resource in writesWithoutResourceIDs", pattern)
		}
	}
}

// Audit F-8: ids in a QUERY string. A list filtered by another user's id must
// return none of that user's rows, whatever status it answers with.
func TestQueryStringIDsNeverReturnAnotherUsersRows(t *testing.T) {
	env := newIsolationEnv(t)
	probes := []struct{ path, kind string }{
		{"/v1/quiz/questions?kb_id=%s", "kb"},
		{"/v1/notes?document_id=%s", "document"},
		{"/v1/notes?category_id=%s", "category"},
		{"/v1/learning/evidence/suggest?week=1&cycle_id=%s", "cycle"},
		{"/v1/quiz/practice?kb_id=%s", "kb"},
		{"/v1/quiz/practice?path_id=%s", "path"},
		{"/v1/audio-overviews?kb_id=%s", "kb"},
		{"/v1/audio-overviews?report_id=%s", "report"},
		{"/v1/books?kb_id=%s", "kb"},
		{"/v1/worksheets?state_id=%s", "learning_state"},
		{"/v1/worksheets?document_id=%s", "document"},
		// up-methods phase 12: Alice's due point named as Bob's previous one
		// is ignored; Bob's review is his own, and he has nothing due.
		{"/v1/mastery/review/next?after=%s", "knowledge_point"},
		// No filter at all: the queue is Bob's own, whatever he names.
		{"/v1/quiz/practice?x=%s", "kb"},
	}
	for _, p := range probes {
		got, body := send(t, env.url, env.bob, http.MethodGet, fmt.Sprintf(p.path, env.ids[p.kind]), nil)
		if got >= 500 {
			t.Errorf("%s: %d %s", p.path, got, body)
		}
		for kind, id := range env.ids {
			if kind != p.kind && strings.Contains(body, id.String()) {
				t.Errorf("%s with alice's %s returned alice's %s: %s", p.path, p.kind, kind, body)
			}
		}
	}
}

// requestIDFields is every `*_id`/`*_ids` JSON field in a request struct under
// internal/api (and the loop package's inputs, which loopapi decodes), mapped
// to how it is probed. A new id field fails this test until someone decides.
var requestIDFields = map[string]string{
	"kb_id":              "bodyProbes: quiz/generate, mastery/paths, solve question, research report to knowledge base; query probe",
	"kb_ids":             "bodyProbes: chat sessions, solve, research",
	"session_id":         "bodyProbes: solve, research",
	"document_id":        "bodyProbes: reading/workspaces",
	"connection_id":      "bodyProbes: chat session pin (OnChatRoute reads the caller's own route), byok routes, transcribe (resolved on the caller's own stt route on start and again for every window), audio speak (resolved on the caller's own tts route on start and again for every chunk)",
	"notebook_id":        "bodyProbes: notes move/copy, reading capture",
	"category_ids":       "bodyProbes: PATCH notes",
	"note_id":            "bodyProbes: PATCH highlights",
	"highlight_id":       "bodyProbes: reading capture",
	"message_id":         "bodyProbes: visualize",
	"rewind_to_id":       "bodyProbes: chat turns (Bob's conversation, Alice's message); RewindTo also requires the message to be in the path's session",
	"openalex_id":        "not a row: an OpenAlex work id (W and digits), checked by pattern and re-read from OpenAlex",
	"report_id":          "bodyProbes: audio overviews",
	"ref_id":             "bodyProbes: review and chain evidence",
	"links":              "bodyProbes: card entries (note, document, quiz attempt); resolved with the caller's user_id on save and on render (TestCardLinksAreTheOwnersOnSaveAndOnRender)",
	"question_id":        "not a row: matched against the turn's own pending question id",
	"account_id":         "not a row: the ChatGPT account id OpenAI issued the pasted tokens for",
	"link_to_user_id":    "gateway-only route; cross-checked against the BFF's verified session",
	"workspace_id":       "bodyProbes: POST /v1/vocab",
	"knowledge_point_id": "quizapi.generate clears it before the service sees it; only the mastery session sets it, from its own rows",
	"request_id":         "not a row: an idempotency key, unique per user (explain-back: TestExplainBackRequestIDIsPerUser; vocabulary reviews: vocab_reviews)",
	"anchors":            "bodyProbes: PUT /v1/books/{id}/proposal; chunk ids resolved with the caller's user_id and the book's kb_id on save, on confirm and on every compile (TestAnchorsAreResolvedOnSaveAndOnCompile)",
	"template_id":        "bodyProbes: POST /v1/exams (Alice's template with Bob's knowledge base)",
	"item_id":            "bodyProbes: PUT /v1/exams/{id}/answers (Alice's item in Bob's exam); resolved with the exam id and the caller's user_id (TestAnswersAreSavedOnlyToTheExamsOwnItems)",
	"state_id":           "bodyProbes: POST /v1/worksheets; query probe /v1/worksheets?state_id=",
	"cycle_id":           "bodyProbes: POST /v1/worksheets (a cycle close of Alice's cycle, alone and on Bob's own state); resolved with the caller's user_id in Go and again in the INSERT, and by the composite key (cycle_id, user_id)",
	"answers":            "bodyProbes: PATCH /v1/worksheets/{id} and POST …/rows with Alice's recording in an audio cell (resolved with the worksheet and the caller's user_id under the row lock on save; served only through both ids and the owner), PUT /v1/exams/{id}/answers",
}

var idTag = regexp.MustCompile(`json:"([a-z_]+_ids?)[",]`)

// referenceNames are JSON names that carry ids without saying so: a list of
// anchors, the items of an exam, the links of a card. A uuid or raw-JSON
// field under one of these names is treated like a `*_id` field.
var referenceNames = map[string]bool{
	"anchors": true, "items": true, "links": true, "refs": true,
	"answers": true, "source": true, "cites": true,
}

var jsonName = regexp.MustCompile(`json:"([a-z_]+)[",]`)

// carriesIDs reports whether a field's type can hold row ids: uuid.UUID,
// []uuid.UUID (pointer or not), or json.RawMessage.
func carriesIDs(expr ast.Expr) bool {
	switch e := expr.(type) {
	case *ast.StarExpr:
		return carriesIDs(e.X)
	case *ast.ArrayType:
		return carriesIDs(e.Elt)
	case *ast.SelectorExpr:
		pkg, ok := e.X.(*ast.Ident)
		return ok && (pkg.Name == "uuid" && e.Sel.Name == "UUID" || pkg.Name == "json" && e.Sel.Name == "RawMessage")
	}
	return false
}

// TestEveryRequestIDFieldIsProbedOrExplained scans EVERY package under
// internal/ (learning-depth red team SF-2: it used to scan four named
// directories, so a new package's request struct was never read).
func TestEveryRequestIDFieldIsProbedOrExplained(t *testing.T) {
	var files []string
	_ = filepath.WalkDir("..", func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".go") && !strings.HasSuffix(p, "_test.go") {
			files = append(files, p)
		}
		return nil
	})
	if len(files) < 200 {
		t.Fatalf("scanned only %d files; the walk is broken", len(files))
	}
	fset := token.NewFileSet()
	for _, f := range files {
		file, err := parser.ParseFile(fset, f, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			ts, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}
			st, ok := ts.Type.(*ast.StructType)
			name := strings.ToLower(ts.Name.Name)
			if !ok || !(strings.Contains(name, "request") || strings.HasPrefix(name, "new") ||
				strings.HasSuffix(name, "input") || strings.HasSuffix(name, "patch")) {
				return true
			}
			for _, field := range st.Fields.List {
				if field.Tag == nil {
					continue
				}
				if m := idTag.FindStringSubmatch(field.Tag.Value); m != nil && requestIDFields[m[1]] == "" {
					t.Errorf("%s: %s.%s — add a body probe and list %q in requestIDFields",
						fset.Position(field.Pos()), ts.Name.Name, m[1], m[1])
				}
				if m := jsonName.FindStringSubmatch(field.Tag.Value); m != nil && referenceNames[m[1]] &&
					carriesIDs(field.Type) && requestIDFields[m[1]] == "" {
					t.Errorf("%s: %s.%s holds ids under a name that does not say so — resolve each with the caller's user_id on save AND on use, probe it, and list %q in requestIDFields",
						fset.Position(field.Pos()), ts.Name.Name, m[1], m[1])
				}
			}
			return false
		})
	}
}
