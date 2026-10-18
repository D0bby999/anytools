package loopapi_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// clock is a test's controllable now.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time  { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) set(t time.Time) { c.mu.Lock(); c.t = t; c.mu.Unlock() }

// The baseline's text and the title of the note it links to. Neither may
// appear in any response while the retest is pending.
const (
	secretBaseline = "UNAIDED-FIRST-ATTEMPT-TEXT"
	secretLinked   = "LINKED-NOTE-TITLE"
)

// cardWorld is Alice in Ho Chi Minh City with one reading card whose unaided
// baseline was written at 06:30 local time on 28 September (23:30 UTC on the
// 27th), so its retest is due on 12 October in her zone — and it would be
// due a day earlier if the server read UTC.
type cardWorld struct {
	h                    *harness
	clk                  *clock
	state, cycle, review string
	card, chain          string
	note                 uuid.UUID
}

func newCardWorld(t *testing.T) *cardWorld {
	t.Helper()
	clk := &clock{t: time.Date(2026, 9, 27, 23, 30, 0, 0, time.UTC)}
	h := newHarnessAt(t, clk.now)
	ctx := context.Background()
	if _, err := h.pool.Exec(ctx, `UPDATE users SET timezone = 'Asia/Ho_Chi_Minh' WHERE id = $1`, h.alice); err != nil {
		t.Fatal(err)
	}
	w := &cardWorld{h: h, clk: clk, note: seedNote(t, h, h.alice, secretLinked)}
	// The note is old: a week's suggestions would otherwise propose it on its
	// own merit, which is not the baseline leaking.
	if _, err := h.pool.Exec(ctx, `UPDATE notes SET updated_at = now() - interval '60 days' WHERE id = $1`, w.note); err != nil {
		t.Fatal(err)
	}
	started := h.json(t, h.alice, http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "Read Vietnamese news", "real_scenario": "The morning paper",
		"outcome_12w": "One article unaided", "first_task": "Learn ten words",
	}, http.StatusCreated)
	w.state = started["state"].(map[string]any)["id"].(string)
	w.cycle = started["cycle"].(map[string]any)["id"].(string)
	w.review = h.json(t, h.alice, http.MethodPost, "/v1/cycles/"+w.cycle+"/reviews", nil, http.StatusCreated)["id"].(string)
	created := h.json(t, h.alice, http.MethodPost, "/v1/learning/states/"+w.state+"/cards", cardBody(), http.StatusCreated)
	card := created["card"].(map[string]any)
	w.card, w.chain = card["id"].(string), card["chain_id"].(string)
	if card["status"] != "open" || strings.Join(strs(created["allowed"]), ",") != "baseline" {
		t.Fatalf("new card = %v", created)
	}
	return w
}

func (w *cardWorld) entry(t *testing.T, tp, body string, want int) map[string]any {
	t.Helper()
	in := map[string]any{"timepoint": tp, "body": body}
	if tp == "baseline" {
		in["links"] = []any{map[string]any{"kind": "note", "id": w.note}}
	}
	return w.h.json(t, w.h.alice, http.MethodPost, "/v1/learning/cards/"+w.card+"/entries", in, want)
}

// baseline writes the unaided attempt and returns the card page it answers.
func (w *cardWorld) baseline(t *testing.T) map[string]any {
	t.Helper()
	return w.entry(t, "baseline", secretBaseline, http.StatusCreated)
}

func (w *cardWorld) raw(t *testing.T, method, path string, body any) (int, string) {
	t.Helper()
	res := w.h.do(t, w.h.alice, method, path, body)
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

func (w *cardWorld) entryID(t *testing.T, tp string) string {
	t.Helper()
	var id string
	if err := w.h.pool.QueryRow(context.Background(),
		`SELECT id FROM card_entries WHERE card_id = $1 AND timepoint = $2 ORDER BY created_at LIMIT 1`, w.card, tp).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func strs(v any) []string {
	var out []string
	for _, s := range v.([]any) {
		out = append(out, s.(string))
	}
	return out
}

func seedNote(t *testing.T, h *harness, user uuid.UUID, title string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var nb, n uuid.UUID
	if err := h.pool.QueryRow(ctx, `INSERT INTO notebooks (user_id, name) VALUES ($1, 'n') RETURNING id`, user).Scan(&nb); err != nil {
		t.Fatal(err)
	}
	if err := h.pool.QueryRow(ctx, `INSERT INTO notes (user_id, notebook_id, title, body_md) VALUES ($1, $2, $3, 'b') RETURNING id`,
		user, nb, title).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func stackGate(t *testing.T, w *cardWorld) map[string]int {
	t.Helper()
	cyc := w.h.json(t, w.h.alice, http.MethodGet, "/v1/cycles/"+w.cycle, nil, http.StatusOK)
	out := map[string]int{}
	for _, p := range cyc["gate"].(map[string]any)["progress"].([]any) {
		m := p.(map[string]any)
		out[m["requirement"].(string)] = int(m["have"].(float64))
	}
	if cyc["gate"].(map[string]any)["open"] == true {
		out["open"] = 1
	}
	return out
}

// TestACardRunsFromBaselineToReflection is the whole card over HTTP, on the
// learner's calendar.
func TestACardRunsFromBaselineToReflection(t *testing.T) {
	w := newCardWorld(t)
	h := w.h
	if kinds := h.json(t, h.alice, http.MethodGet, "/v1/learning/card-kinds", nil, http.StatusOK)["kinds"].([]any); len(kinds) != 7 {
		t.Fatalf("%d kinds served, want 7", len(kinds))
	}

	page := w.baseline(t)
	card := page["card"].(map[string]any)
	if card["status"] != "retest_due" || card["retest_due_on"] != "2026-10-12" || page["today"] != "2026-09-28" {
		t.Fatalf("after the baseline: card %v, today %v — want due 2026-10-12, 14 local days on", card, page["today"])
	}
	if page["retest_open"] != false || strings.Join(strs(page["allowed"]), ",") != "immediate" {
		t.Fatalf("retest open on day 0: %v", page)
	}

	// A baseline is kept once; a new one is a new card.
	if code, body := w.raw(t, http.MethodPost, "/v1/learning/cards/"+w.card+"/entries",
		map[string]any{"timepoint": "baseline", "body": "second go"}); code != http.StatusConflict {
		t.Fatalf("second baseline: %d %s", code, body)
	}
	// Practice is free; transfer waits for the retest.
	w.entry(t, "immediate", "practised the hard paragraph", http.StatusCreated)
	if code, body := w.raw(t, http.MethodPost, "/v1/learning/cards/"+w.card+"/entries",
		map[string]any{"timepoint": "transfer", "body": "t"}); code != http.StatusConflict {
		t.Fatalf("transfer before the retest: %d %s", code, body)
	}

	// Put the cycle in stack: its gate needs a delayed and a transfer.
	if _, err := h.pool.Exec(context.Background(), `UPDATE cycles SET phase = 'stack', started_at = now() - interval '1 day' WHERE id = $1`, w.cycle); err != nil {
		t.Fatal(err)
	}
	// 23:59 on 11 October in Ho Chi Minh City: 16:59 UTC. Not yet.
	w.clk.set(time.Date(2026, 10, 11, 16, 59, 0, 0, time.UTC))
	code, body := w.raw(t, http.MethodPost, "/v1/learning/cards/"+w.card+"/entries",
		map[string]any{"timepoint": "delayed", "body": "retest", "prompt_level": "unaided"})
	if code != http.StatusConflict || !strings.Contains(body, "retest_not_due") || !strings.Contains(body, "2026-10-12") {
		t.Fatalf("retest a day early: %d %s", code, body)
	}
	if g := stackGate(t, w); g["delayed"] != 0 || g["open"] == 1 {
		t.Fatalf("the stack gate counts a delayed check before its day: %v", g)
	}
	if n := h.json(t, h.alice, http.MethodGet, "/v1/learning/retests", nil, http.StatusOK)["count"]; n != float64(0) {
		t.Fatalf("a retest due tomorrow is listed as due: %v", n)
	}

	// Midnight local time: the retest opens, and is listed.
	w.clk.set(time.Date(2026, 10, 11, 17, 0, 0, 0, time.UTC))
	due := h.json(t, h.alice, http.MethodGet, "/v1/learning/retests", nil, http.StatusOK)
	if due["count"] != float64(1) || due["today"] != "2026-10-12" {
		t.Fatalf("retests due on the day: %v", due)
	}
	if got := h.json(t, h.alice, http.MethodGet, "/v1/learning/cards/"+w.card, nil, http.StatusOK); got["retest_open"] != true {
		t.Fatalf("retest not open on its day: %v", got)
	}
	page = h.json(t, h.alice, http.MethodPost, "/v1/learning/cards/"+w.card+"/entries",
		map[string]any{"timepoint": "delayed", "body": "retold it without the text", "prompt_level": "light_cue"}, http.StatusCreated)
	if page["baseline_hidden"] != false || !strings.Contains(mustJSON(t, page), secretBaseline) {
		t.Fatalf("after the retest the baseline should be shown: %v", page)
	}
	w.entry(t, "transfer", "read a different paper", http.StatusCreated)
	if g := stackGate(t, w); g["delayed"] != 1 || g["transfer"] != 1 || g["open"] != 1 {
		t.Fatalf("card evidence does not open the stack gate: %v", g)
	}
	if n := h.json(t, h.alice, http.MethodGet, "/v1/learning/retests", nil, http.StatusOK)["count"]; n != float64(0) {
		t.Fatalf("a done retest is still listed: %v", n)
	}

	closed := h.json(t, h.alice, http.MethodPost, "/v1/learning/cards/"+w.card+"/close",
		map[string]any{"held": "the gist", "missed": "two idioms", "next": "a harder paper"}, http.StatusOK)
	if closed["card"].(map[string]any)["status"] != "closed" || len(strs(closed["allowed"])) != 0 {
		t.Fatalf("closed card = %v", closed)
	}
	if code, _ := w.raw(t, http.MethodPost, "/v1/learning/cards/"+w.card+"/entries",
		map[string]any{"timepoint": "immediate", "body": "x"}); code != http.StatusConflict {
		t.Fatalf("entry on a closed card: %d", code)
	}
	if code, _ := w.raw(t, http.MethodPost, "/v1/learning/cards/"+w.card+"/close", map[string]any{"held": "x"}); code != http.StatusConflict {
		t.Fatalf("second close: %d", code)
	}
	// The state page lists the card.
	st := h.json(t, h.alice, http.MethodGet, "/v1/learning/states/"+w.state, nil, http.StatusOK)
	if cards := st["cards"].([]any); len(cards) != 1 {
		t.Fatalf("state lists %d cards", len(cards))
	}
}

// TestAPendingBaselineIsWithheldFromEveryEndpoint: one subtest per endpoint
// that can return a card entry, each reading the raw response for the
// baseline's text and its linked note's title.
func TestAPendingBaselineIsWithheldFromEveryEndpoint(t *testing.T) {
	w := newCardWorld(t)
	h := w.h
	// The week's window starts before the entries, so the suggestion query
	// has them to propose.
	if _, err := h.pool.Exec(context.Background(),
		`UPDATE cycles SET started_at = now() - interval '1 hour' WHERE id = $1`, w.cycle); err != nil {
		t.Fatal(err)
	}
	base := w.baseline(t)
	baselineID := w.entryID(t, "baseline")
	// A second chain and the week's review, each with the baseline attached,
	// so the chain, review and evidence endpoints all have it to render.
	other := h.json(t, h.alice, http.MethodPost, "/v1/learning/states/"+w.state+"/chains",
		map[string]any{"question": "q"}, http.StatusCreated)["id"].(string)
	chainRef := map[string]any{"kind": "card_entry", "ref_id": baselineID, "timepoint": "baseline"}
	var refID string

	endpoints := []struct {
		name         string
		method, path string
		body         any
		want         int
		after        func(map[string]any)
		// shows is what proves the endpoint rendered the baseline at all.
		shows string
	}{
		{"POST entries (the baseline's own response)", "", "", nil, 0, nil, `"withheld":true`},
		{"GET card", http.MethodGet, "/v1/learning/cards/" + w.card, nil, http.StatusOK, nil, `"withheld":true`},
		{"POST entries (practice)", http.MethodPost, "/v1/learning/cards/" + w.card + "/entries",
			map[string]any{"timepoint": "immediate", "body": "practice"}, http.StatusCreated, nil, `"withheld":true`},
		{"GET chain", http.MethodGet, "/v1/learning/chains/" + w.chain, nil, http.StatusOK, nil, "hidden until your retest"},
		{"POST chain evidence", http.MethodPost, "/v1/learning/chains/" + other + "/evidence", chainRef, http.StatusCreated, nil, "hidden until your retest"},
		{"GET the other chain", http.MethodGet, "/v1/learning/chains/" + other, nil, http.StatusOK, nil, "hidden until your retest"},
		{"GET state chains", http.MethodGet, "/v1/learning/states/" + w.state + "/chains", nil, http.StatusOK, nil, "Read a headline"},
		{"GET state", http.MethodGet, "/v1/learning/states/" + w.state, nil, http.StatusOK, nil, `"cards":[{`},
		{"POST review evidence", http.MethodPost, "/v1/weekly-reviews/" + w.review + "/evidence",
			map[string]any{"kind": "card_entry", "ref_id": baselineID, "timepoint": "baseline"}, http.StatusCreated,
			func(m map[string]any) { refID = m["id"].(string) }, "hidden until your retest"},
		{"GET review", http.MethodGet, "/v1/weekly-reviews/" + w.review, nil, http.StatusOK, nil, "hidden until your retest"},
		{"PATCH evidence", http.MethodPatch, "/v1/learning/evidence/{ref}", map[string]any{"note": "n"}, http.StatusOK, nil, "hidden until your retest"},
		{"GET suggest", http.MethodGet, "/v1/learning/evidence/suggest?cycle_id=" + w.cycle, nil, http.StatusOK, nil, "hidden until your retest"},
		{"GET cycle", http.MethodGet, "/v1/cycles/" + w.cycle, nil, http.StatusOK, nil, `"gate"`},
		{"GET retests", http.MethodGet, "/v1/learning/retests", nil, http.StatusOK, nil, `"retests"`},
	}
	for _, e := range endpoints {
		t.Run(e.name, func(t *testing.T) {
			var body string
			if e.method == "" {
				body = mustJSON(t, base)
			} else {
				path := strings.Replace(e.path, "{ref}", refID, 1)
				var code int
				code, body = w.raw(t, e.method, path, e.body)
				if code != e.want {
					t.Fatalf("%s %s: %d %s", e.method, path, code, body)
				}
				if e.after != nil {
					e.after(decodeJSON(t, body))
				}
			}
			if !strings.Contains(body, e.shows) {
				t.Errorf("the response never rendered the entry (want %q): %s", e.shows, body)
			}
			for _, secret := range []string{secretBaseline, secretLinked} {
				if strings.Contains(body, secret) {
					t.Errorf("the pending baseline leaks (%s): %s", secret, body)
				}
			}
		})
	}
	// And the card view says it is withheld rather than showing nothing.
	card := h.json(t, h.alice, http.MethodGet, "/v1/learning/cards/"+w.card, nil, http.StatusOK)
	first := card["entries"].([]any)[0].(map[string]any)
	if card["baseline_hidden"] != true || first["withheld"] != true || first["timepoint"] != "baseline" {
		t.Fatalf("card page = %v", card)
	}
}

// TestACardEntryKeepsItsTimepoint: a practice entry written on the day of the
// baseline cannot become the delayed retest by attaching or re-tagging it.
// Mutation-checked: without checkCardEntryTimepoint the stack gate counts it.
func TestACardEntryKeepsItsTimepoint(t *testing.T) {
	w := newCardWorld(t)
	h := w.h
	w.baseline(t)
	w.entry(t, "immediate", "practice", http.StatusCreated)
	practice := w.entryID(t, "immediate")
	if _, err := h.pool.Exec(context.Background(), `UPDATE cycles SET phase = 'stack', started_at = now() - interval '1 day' WHERE id = $1`, w.cycle); err != nil {
		t.Fatal(err)
	}
	other := h.json(t, h.alice, http.MethodPost, "/v1/learning/states/"+w.state+"/chains",
		map[string]any{"question": "q"}, http.StatusCreated)["id"].(string)
	if code, body := w.raw(t, http.MethodPost, "/v1/learning/chains/"+other+"/evidence",
		map[string]any{"kind": "card_entry", "ref_id": practice, "timepoint": "delayed"}); code != http.StatusBadRequest {
		t.Errorf("practice attached as delayed: %d %s", code, body)
	}
	if code, body := w.raw(t, http.MethodPost, "/v1/weekly-reviews/"+w.review+"/evidence",
		map[string]any{"kind": "card_entry", "ref_id": practice, "timepoint": "delayed"}); code != http.StatusBadRequest {
		t.Errorf("practice attached to a review as delayed: %d %s", code, body)
	}
	chain := h.json(t, h.alice, http.MethodGet, "/v1/learning/chains/"+w.chain, nil, http.StatusOK)
	var autoRef string
	for _, col := range chain["columns"].([]any) {
		c := col.(map[string]any)
		if c["timepoint"] == "immediate" {
			autoRef = c["refs"].([]any)[0].(map[string]any)["id"].(string)
		}
	}
	if code, body := w.raw(t, http.MethodPatch, "/v1/learning/evidence/"+autoRef,
		map[string]any{"timepoint": "delayed"}); code != http.StatusBadRequest {
		t.Errorf("practice re-tagged as delayed: %d %s", code, body)
	}
	if g := stackGate(t, w); g["delayed"] != 0 {
		t.Fatalf("the stack gate counts a delayed check on the day of the baseline: %v", g)
	}
	// The entry's own timepoint is fine anywhere.
	h.json(t, h.alice, http.MethodPost, "/v1/learning/chains/"+other+"/evidence",
		map[string]any{"kind": "card_entry", "ref_id": practice, "timepoint": "immediate"}, http.StatusCreated)
}

// TestCardLinksMustBeTheCallersOwn: Alice's note, document or attempt in Bob's
// links answers exactly as a nonexistent id does, and writes nothing.
func TestCardLinksMustBeTheCallersOwn(t *testing.T) {
	h := newHarness(t)
	st := h.json(t, h.bob, http.MethodPost, "/v1/learning/states", map[string]string{
		"goal": "g", "real_scenario": "r", "outcome_12w": "o", "first_task": "t"}, http.StatusCreated)
	card := h.json(t, h.bob, http.MethodPost, "/v1/learning/states/"+st["state"].(map[string]any)["id"].(string)+"/cards",
		cardBody(), http.StatusCreated)["card"].(map[string]any)["id"].(string)
	var aliceDoc uuid.UUID
	ctx := context.Background()
	if err := h.pool.QueryRow(ctx, `
		WITH kb AS (INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'k') RETURNING id)
		INSERT INTO documents (user_id, kb_id, source_kind, title, mime, bytes, sha256, status)
		SELECT $1, kb.id, 'upload', 'a.pdf', 'application/pdf', 1, repeat('c', 64), 'ready' FROM kb RETURNING id`,
		h.alice).Scan(&aliceDoc); err != nil {
		t.Fatal(err)
	}
	for kind, alien := range map[string]uuid.UUID{
		"note": seedNote(t, h, h.alice, "a"), "document": aliceDoc, "quiz_attempt": h.seedAttempt(t, h.alice),
	} {
		send := func(id uuid.UUID) int {
			return h.status(t, h.bob, http.MethodPost, "/v1/learning/cards/"+card+"/entries", map[string]any{
				"timepoint": "baseline", "body": "b", "links": []any{map[string]any{"kind": kind, "id": id}}})
		}
		if got, control := send(alien), send(uuid.New()); got != http.StatusNotFound || control != got {
			t.Errorf("alice's %s in bob's links: %d, a nonexistent one %d — want 404 for both", kind, got, control)
		}
	}
	var n int
	_ = h.pool.QueryRow(ctx, `SELECT count(*) FROM card_entries WHERE card_id = $1`, card).Scan(&n)
	if n != 0 {
		t.Fatalf("a refused entry was written: %d", n)
	}
}

// TestRetestsDueAreTheCallersOwn: the list has no id to aim, so it is scoped
// by the authenticated user alone.
func TestRetestsDueAreTheCallersOwn(t *testing.T) {
	w := newCardWorld(t)
	w.baseline(t)
	w.clk.set(time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC))
	if n := w.h.json(t, w.h.alice, http.MethodGet, "/v1/learning/retests", nil, http.StatusOK)["count"]; n != float64(1) {
		t.Fatalf("alice's retests: %v", n)
	}
	if n := w.h.json(t, w.h.bob, http.MethodGet, "/v1/learning/retests", nil, http.StatusOK)["count"]; n != float64(0) {
		t.Fatalf("bob sees alice's retests: %v", n)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func decodeJSON(t *testing.T, s string) map[string]any {
	t.Helper()
	out := map[string]any{}
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		t.Fatalf("decode %s: %v", s, err)
	}
	return out
}
