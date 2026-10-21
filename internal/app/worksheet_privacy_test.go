package app

// worksheet_privacy_test.go — AC3 and plan principle 5, end to end through the
// wiring: a private worksheet's title and words never reach a model, and
// never appear where evidence is listed or on Home's due list.
//
// Every private kind registered — today the worksheettest fixture, later the
// life toolkit and the narrative review (phases 8 and 9) — is seeded with a
// marker in its title and in every field that holds text. Then every model
// input is run against scripted OpenAI-compatible upstreams reached through
// the real BYOK chain, and every request body is searched for the marker:
//
//   - chat, in a conversation linked to the learning state the worksheets are
//     attached to (the state context, internal/app/adapters_loop.go), and in
//     a knowledge-base conversation;
//   - research;
//   - quiz generation, mastery path proposal, learn and explain-back;
//   - the nightly profile consolidation;
//   - the resume text (internal/learning/loop/resume.go), which is no model
//     call but is what a learner pastes into one.
//
// Phase 4's writing diagnosis is the one model input that reads a
// worksheet's answers. It refuses every private worksheet before any model
// call, and a public writing evidence card is the control that it does reach
// the model.
//
// The evidence surfaces are read too: Candidates, the nightly suggestion job,
// GET /v1/learning/evidence/suggest, a weekly review, a chain, the cycle and
// the state, and GET /v1/worksheets/due. A public worksheet on the same state
// is the control: it DOES appear as a suggestion, so a surface that never
// reads worksheets cannot pass this test by accident.
//
// The minimum contract's ask_for_help_when (phase 13) follows the same rule
// and carries its own marker through the same surfaces. Only its owner's
// state page shows it; its two shared answers are the control that the
// contract does reach the model.

import (
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
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/learning/profile"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/learning/worksheet/worksheettest"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// privateMarker is in every private worksheet's title and text. It is
// alphanumeric, so JSON escaping cannot hide it in a raw body.
const privateMarker = "PRIVSHEET7Q"

// helpMarker is in the minimum contract's ask_for_help_when (AC3).
const helpMarker = "PRIVHELP7Q"

// privateKinds are the plan's private kinds (principle 5): the life toolkit
// (phase 9), the narrative case review (phase 8), and from
// the private design notes the care card (phase 1) and the
// self-reflection cards (phase 3).
var privateKinds = []string{"attention_audit", "choice_brief", "life_weekly_review",
	"narrative_case_review", "recovery_reset", "relationship_card", "life_care_card",
	"self_reflection"}

// seedPrivateWorksheets creates one worksheet of every private kind, with
// the marker in its title and every text field, attached to the state or
// document its kind takes, and with a review due long ago (so the due list
// has it). It returns their ids.
func seedPrivateWorksheets(t *testing.T, e *e2e, stateID, documentID string) []string {
	t.Helper()
	var ids []string
	for _, k := range worksheet.Kinds() {
		if !k.Private {
			continue
		}
		body := map[string]any{"kind": k.Kind, "title": privateMarker + " " + k.Name}
		switch k.Attach {
		case worksheet.AttachState:
			if stateID != "" {
				body["state_id"] = stateID
			}
		case worksheet.AttachDocument:
			body["document_id"] = documentID
		}
		created := e.json(http.MethodPost, "/v1/worksheets", body, http.StatusCreated)
		id := created["id"].(string)
		patched := e.do(http.MethodPatch, "/v1/worksheets/"+id, map[string]any{
			"revision": created["updated_at"], "answers": worksheettest.Fill(k, privateMarker)})
		raw, _ := io.ReadAll(patched.Body)
		patched.Body.Close()
		if patched.StatusCode != http.StatusOK {
			t.Fatalf("%s: filling every field answered %d %s — make worksheettest.Fill fit this kind", k.Kind, patched.StatusCode, raw)
		}
		if !strings.Contains(string(raw), privateMarker) {
			t.Fatalf("%s: the marker was not stored", k.Kind)
		}
		if _, err := e.pool.Exec(context.Background(),
			`UPDATE worksheets SET reviews = '{"seeded":{"due":"2000-01-01","earliest":"2000-01-01"}}' WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		t.Fatal("no private kind is registered; worksheettest should register one")
	}
	for _, kind := range privateKinds {
		if k, ok := worksheet.Lookup(kind); !ok || !k.Private {
			t.Fatalf("%s is not registered as private, so it was not seeded", kind)
		}
	}
	return ids
}

// noMarker fails if any of the texts carries a private worksheet's marker
// or the minimum contract's.
func noMarker(t *testing.T, surface string, texts ...string) {
	t.Helper()
	noMarkers(t, surface, []string{privateMarker, helpMarker}, texts...)
}

func noMarkers(t *testing.T, surface string, markers []string, texts ...string) {
	t.Helper()
	for _, s := range texts {
		for _, marker := range markers {
			if i := strings.Index(s, marker); i >= 0 {
				lo := max(0, i-200)
				t.Errorf("%s carries private words (%s): …%s…", surface, marker, s[lo:min(len(s), i+80)])
			}
		}
	}
}

func (e *e2e) raw(method, path string, body any) string {
	e.t.Helper()
	res := e.do(method, path, body)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		e.t.Fatalf("%s %s: %d %s", method, path, res.StatusCode, raw)
	}
	return string(raw)
}

func TestPrivateWorksheetsNeverReachAModel(t *testing.T) {
	e, model, kbID := newPhase9E2E(t, newScriptedWeb(t, false))
	ctx := context.Background()
	var documentID string
	if err := e.pool.QueryRow(ctx, `SELECT id::text FROM documents WHERE kb_id = $1 LIMIT 1`, kbID).Scan(&documentID); err != nil {
		t.Fatal(err)
	}

	started := e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Explain parametric memory", "real_scenario": "A design review",
		"outcome_12w": "Explain it unaided", "first_task": "One question a day",
	}, http.StatusCreated)
	stateID := mapAt(started, "state")["id"].(string)
	cycleID := mapAt(started, "cycle")["id"].(string)
	e.json(http.MethodPatch, "/v1/learning/states/"+stateID, map[string]any{
		"minimum_contract": map[string]string{
			"downshift_when":      "PUBLICDOWNSHIFT when tired",
			"still_worth_keeping": "PUBLICKEEPING ten minutes",
			"ask_for_help_when":   helpMarker + " three bad weeks",
		},
	}, http.StatusOK)

	private := seedPrivateWorksheets(t, e, stateID, documentID)
	control := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": worksheettest.State, "title": "PUBLICCONTROL sheet", "state_id": stateID}, http.StatusCreated)

	// ── evidence: a private worksheet cannot be attached anywhere ──────────
	chain := e.json(http.MethodPost, "/v1/learning/states/"+stateID+"/chains", map[string]any{"question": "q"}, http.StatusCreated)
	chainID := chain["id"].(string)
	review := e.json(http.MethodPost, "/v1/cycles/"+cycleID+"/reviews", map[string]any{"week": 1}, http.StatusCreated)
	reviewID := review["id"].(string)
	for _, id := range private {
		if got := e.status(http.MethodPost, "/v1/weekly-reviews/"+reviewID+"/evidence",
			map[string]any{"kind": "worksheet", "ref_id": id}); got != http.StatusNotFound {
			t.Errorf("a private worksheet attached to a review: %d", got)
		}
		if got := e.status(http.MethodPost, "/v1/learning/chains/"+chainID+"/evidence",
			map[string]any{"kind": "worksheet", "ref_id": id, "timepoint": "baseline"}); got != http.StatusNotFound {
			t.Errorf("a private worksheet attached to a chain: %d", got)
		}
	}
	// The public control attaches: the route works for worksheets at all.
	e.json(http.MethodPost, "/v1/learning/chains/"+chainID+"/evidence",
		map[string]any{"kind": "worksheet", "ref_id": control["id"], "timepoint": "baseline"}, http.StatusCreated)

	// ── evidence surfaces ──────────────────────────────────────────────────
	job := loop.NewSuggestJob(e.pool, pg.NewLoopStore(e.pool))
	if _, _, err := job.RunOnce(ctx); err != nil {
		t.Fatalf("suggest job: %v", err)
	}
	cands, err := pg.NewLoopStore(e.pool).Candidates(ctx, e.user, uuid.MustParse(stateID),
		time.Now().Add(-24*time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	candJSON, _ := json.Marshal(cands)
	suggest := e.raw(http.MethodGet, "/v1/learning/evidence/suggest?cycle_id="+cycleID, nil)
	if !strings.Contains(suggest, "PUBLICCONTROL") {
		t.Fatalf("the control worksheet is not suggested; the evidence surfaces are not reading worksheets: %s", truncateForMsg(suggest))
	}
	due := e.raw(http.MethodGet, "/v1/worksheets/due", nil)
	if !strings.Contains(due, worksheet.PrivateTitle) {
		t.Fatalf("the private worksheets' seeded reviews are not due, so the due list proves nothing: %s", due)
	}
	noMarker(t, "Candidates", string(candJSON))
	noMarker(t, "GET /v1/learning/evidence/suggest", suggest)
	noMarker(t, "GET /v1/weekly-reviews/{id}", e.raw(http.MethodGet, "/v1/weekly-reviews/"+reviewID, nil))
	noMarker(t, "GET /v1/learning/chains/{id}", e.raw(http.MethodGet, "/v1/learning/chains/"+chainID, nil))
	noMarker(t, "GET /v1/cycles/{id}", e.raw(http.MethodGet, "/v1/cycles/"+cycleID, nil))
	// The owner's own state page shows their contract, help line included.
	statePage := e.raw(http.MethodGet, "/v1/learning/states/"+stateID, nil)
	if !strings.Contains(statePage, helpMarker) {
		t.Fatal("the minimum contract was not stored; the help marker proves nothing")
	}
	noMarkers(t, "GET /v1/learning/states/{id}", []string{privateMarker}, statePage)
	noMarker(t, "GET /v1/worksheets/due", due)

	// ── model inputs ───────────────────────────────────────────────────────
	// The writing diagnosis refuses every private worksheet, with no call.
	before := len(model.requests())
	for _, id := range private {
		if got := e.status(http.MethodPost, "/v1/worksheets/"+id+"/diagnose", map[string]any{"pass": 1}); got != http.StatusBadRequest {
			t.Errorf("a private worksheet was diagnosed: %d", got)
		}
		if got := e.status(http.MethodGet, "/v1/worksheets/"+id+"/diagnoses", nil); got != http.StatusBadRequest {
			t.Errorf("a private worksheet's diagnoses were listed: %d", got)
		}
	}
	if n := len(model.requests()) - before; n != 0 {
		t.Fatalf("%d model calls for private worksheets' diagnoses", n)
	}
	card := e.json(http.MethodPost, "/v1/worksheets", map[string]any{
		"kind": worksheet.WritingEvidenceKind, "title": "Public card", "state_id": stateID}, http.StatusCreated)
	e.json(http.MethodPatch, "/v1/worksheets/"+card["id"].(string), map[string]any{"revision": card["updated_at"],
		"answers": map[string]any{"draft": map[string]any{"draft": "PUBLICDRAFT is late by a day."}}}, http.StatusOK)
	e.json(http.MethodPost, "/v1/worksheets/"+card["id"].(string)+"/diagnose", map[string]any{"pass": 1}, http.StatusOK)
	if model.count("writing-diagnose") != 1 || !strings.Contains(contents(t, model.requests()[before:]), "PUBLICDRAFT") {
		t.Fatal("the public card's diagnosis did not reach the model; the harness is not measuring it")
	}

	// The resume text, and a chat in the conversation it opens: the state's
	// context goes to the model.
	resumed := e.raw(http.MethodPost, "/v1/learning/states/"+stateID+"/resume", nil)
	noMarker(t, "the resume text", resumed)
	var session struct {
		SessionID string `json:"session_id"`
	}
	_ = json.Unmarshal([]byte(resumed), &session)
	chatTurn := func(sessionID string) {
		t.Helper()
		turn := e.json(http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
			map[string]any{"message": "Where was I?"}, http.StatusAccepted)
		resultOf(t, e.readTurnStream(turn["turn_id"].(string)))
	}
	chatTurn(session.SessionID)
	if !strings.Contains(contents(t, model.requests()), "learning state") {
		t.Fatal("the state-linked chat did not carry the state's context; the harness is not measuring it")
	}
	if sent := contents(t, model.requests()); !strings.Contains(sent, "PUBLICDOWNSHIFT") || !strings.Contains(sent, "PUBLICKEEPING") {
		t.Fatal("the minimum contract's shared answers did not reach the model; the help marker is not measured")
	}
	sess := e.json(http.MethodPost, "/v1/chat/sessions",
		map[string]any{"title": "c", "kb_ids": []string{kbID.String()}}, http.StatusCreated)
	chatTurn(sess["id"].(string))

	before = len(model.requests())
	research := e.json(http.MethodPost, "/v1/research", map[string]any{
		"query": "parametric memory", "kb_ids": []string{kbID.String()}}, http.StatusAccepted)
	resultOf(t, e.readTurnStream(research["turn_id"].(string)))
	if n := len(model.requests()) - before; n < 3 {
		t.Fatalf("research made %d model calls; the harness is not measuring a research turn", n)
	}

	// The nightly profile consolidation, with activity to consolidate.
	seedProfileActivity(t, e, kbID)
	e.json(http.MethodPut, "/v1/profile/settings", map[string]any{"consolidation": true}, http.StatusOK)
	byokSvc := byok.NewService(pg.NewProviderConnectionStore(e.pool, testutil.TestEncryptionKey),
		pg.NewFunctionRouteStore(e.pool, testutil.TestEncryptionKey),
		pg.NewSearchConnectionStore(e.pool, testutil.TestEncryptionKey), nil)
	consolidate := profile.NewJob(e.pool, optedInOnly{pg.NewProfileStore(e.pool), e.user}, newChatResolver(byokSvc))
	if _, _, err := consolidate.RunOnce(ctx); err != nil || model.count("profile-consolidate") != 1 {
		t.Fatalf("consolidation: %d calls, %v", model.count("profile-consolidate"), err)
	}

	if model.count("chat") < 2 {
		t.Fatalf("%d chat calls; the harness is not measuring chat", model.count("chat"))
	}
	for i, body := range model.requests() {
		noMarker(t, fmt.Sprintf("model request %d", i), body)
	}
}

// seedProfileActivity is a wrong answer an hour ago, for consolidation to read.
func seedProfileActivity(t *testing.T, e *e2e, kbID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	var path, module, kp, q uuid.UUID
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(e.pool.QueryRow(ctx, `INSERT INTO mastery_paths (user_id, kb_id, goal) VALUES ($1, $2, 'g') RETURNING id`, e.user, kbID).Scan(&path))
	must(e.pool.QueryRow(ctx, `INSERT INTO mastery_modules (user_id, path_id, ord, name) VALUES ($1, $2, 0, 'm') RETURNING id`, e.user, path).Scan(&module))
	must(e.pool.QueryRow(ctx, `INSERT INTO knowledge_points (user_id, module_id, name) VALUES ($1, $2, 'Parametric memory') RETURNING id`, e.user, module).Scan(&kp))
	must(e.pool.QueryRow(ctx, `INSERT INTO questions (user_id, kb_id, knowledge_point_id, prompt, type, answer)
		VALUES ($1, $2, $3, 'p', 'short', 'a') RETURNING id`, e.user, kbID, kp).Scan(&q))
	_, err := e.pool.Exec(ctx, `INSERT INTO question_attempts (user_id, question_id, knowledge_point_id, is_correct, rating, created_at)
		VALUES ($1, $2, $3, false, 'again', $4)`, e.user, q, kp, time.Now().UTC().Add(-time.Hour))
	must(err)
}

// recordingProxy forwards to target and keeps every request body, so a
// scripted model that records only some of what it receives is measured in
// full.
type recordingProxy struct {
	server *httptest.Server
	mu     sync.Mutex
	bodies []string
}

func newRecordingProxy(t *testing.T, target string) *recordingProxy {
	t.Helper()
	u, err := url.Parse(target)
	if err != nil {
		t.Fatal(err)
	}
	p := &recordingProxy{}
	forward := httputil.NewSingleHostReverseProxy(u)
	forward.FlushInterval = -1
	p.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		p.mu.Lock()
		p.bodies = append(p.bodies, string(body))
		p.mu.Unlock()
		r.Body = io.NopCloser(strings.NewReader(string(body)))
		r.ContentLength = int64(len(body))
		forward.ServeHTTP(w, r)
	}))
	t.Cleanup(p.server.Close)
	return p
}

func (p *recordingProxy) requests() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.bodies...)
}

// The quiz and mastery model inputs, on the same seeded private worksheets.
func TestPrivateWorksheetsNeverReachQuizOrMastery(t *testing.T) {
	model := newQuizModel(t)
	proxy := newRecordingProxy(t, model.server.URL)
	e := buildE2E(t, proxy.server.URL, []string{"quiz", "mastery"}, nil)
	kbID := uuid.MustParse(e.json(http.MethodPost, "/v1/kb",
		map[string]string{"name": "Retrieval papers"}, http.StatusCreated)["id"].(string))
	e.upload(kbID, "rag.pdf", ragFixturePDF(t))
	e.drainJobs()
	var documentID string
	if err := e.pool.QueryRow(context.Background(), `SELECT id::text FROM documents WHERE kb_id = $1 LIMIT 1`, kbID).Scan(&documentID); err != nil {
		t.Fatal(err)
	}
	started := e.json(http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "g", "real_scenario": "s", "outcome_12w": "o", "first_task": "t"}, http.StatusCreated)
	seedPrivateWorksheets(t, e, mapAt(started, "state")["id"].(string), documentID)

	e.json(http.MethodPost, "/v1/quiz/generate", map[string]any{
		"kb_id": kbID, "n": 2, "types": []string{"mcq", "short"}}, http.StatusCreated)
	created := e.json(http.MethodPost, "/v1/mastery/paths",
		map[string]any{"kb_id": kbID, "goal": "Explain the two memories of RAG"}, http.StatusCreated)
	pathID := mapAt(created, "path")["id"].(string)
	detail := e.json(http.MethodPost, "/v1/mastery/paths/"+pathID+"/approve",
		map[string]any{"modules": mapAt(created, "proposal")["modules"]}, http.StatusCreated)
	kpID := detail["modules"].([]any)[0].(map[string]any)["knowledge_points"].([]any)[0].(map[string]any)["knowledge_point"].(map[string]any)["id"].(string)
	e.json(http.MethodPost, "/v1/mastery/points/"+kpID+"/learn", nil, http.StatusOK)
	e.json(http.MethodPost, "/v1/mastery/points/"+kpID+"/explain-back",
		map[string]any{"text": "It is what a model learned in training, stored in its weights.", "request_id": uuid.NewString()},
		http.StatusCreated)

	for _, kind := range []string{"ideate", "generate", "path", "learn", "explain_back"} {
		if model.count(kind) == 0 {
			t.Fatalf("no %s call; the harness is not measuring it", kind)
		}
	}
	bodies := proxy.requests()
	if len(bodies) < 5 {
		t.Fatalf("the proxy recorded %d requests", len(bodies))
	}
	for i, body := range bodies {
		noMarker(t, fmt.Sprintf("quiz/mastery model request %d", i), body)
	}
}

// Plan principle 5, requirement 13: only the worksheet store reads
// worksheets.answers. Every other SQL string that names the table is an
// evidence query (title and kind only), in a file listed here. Phase 4's
// diagnosis reads a card's draft through worksheet.Service, so through this
// store, and its own store (store/pg/worksheet_diagnoses.go) names neither
// the table nor its answers.
func TestOnlyTheWorksheetStoreReadsAnswers(t *testing.T) {
	// Phase 7: the worksheet store's recordings live in their own file. It
	// reads answers only to clear a deleted recording's id from them.
	answersReaders := map[string]bool{"store/pg/worksheets.go": true, "store/pg/worksheet_recordings.go": true}
	tableNamers := map[string]bool{
		"store/pg/worksheets.go":             true,
		"store/pg/worksheet_recordings.go":   true,
		"store/pg/learning_loop_targets.go":  true,
		"store/pg/learning_loop_evidence.go": true,
	}
	names := regexp.MustCompile(`(?i)\b(FROM|JOIN|UPDATE|INTO)\s+worksheets\b`)
	fset := token.NewFileSet()
	var checked int
	_ = filepath.WalkDir("..", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(fset, p, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		rel := strings.TrimPrefix(filepath.ToSlash(p), "../")
		ast.Inspect(file, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING || !names.MatchString(lit.Value) {
				return true
			}
			checked++
			if !tableNamers[rel] {
				t.Errorf("%s: SQL naming worksheets outside the store and the evidence queries (plan principle 5)", fset.Position(lit.Pos()))
			}
			if !answersReaders[rel] && strings.Contains(lit.Value, "answers") {
				t.Errorf("%s: SQL reading worksheets.answers outside the worksheet store", fset.Position(lit.Pos()))
			}
			return true
		})
		return nil
	})
	if checked < 5 {
		t.Fatalf("found %d SQL strings naming worksheets; the walk is broken", checked)
	}
}
