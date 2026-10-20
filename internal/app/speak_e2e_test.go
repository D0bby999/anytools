package app

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/testutil"
)

// speak_e2e_test.go is the read-aloud check (plans/261020-1155-open-source-
// adds, phase 2) through the real mux: the passage is checked against the
// stored page, the take is normalised by ffmpeg and heard by the server's
// engine on the learner's daily allowance, and nothing is left on disk.

// speakTake is a short real recording: three seconds of tone, as Opus.
func speakTake(t *testing.T) []byte {
	t.Helper()
	out := filepath.Join(t.TempDir(), "take.ogg")
	if err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=3",
		"-c:a", "libopus", out).Run(); err != nil {
		t.Skipf("ffmpeg could not make a take: %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// speakCheck posts a check as the e2e's current user.
func (e *e2e) speakCheck(ws string, page int, text string, take []byte) (int, map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("workspace_id", ws)
	_ = w.WriteField("page", itoa(page))
	_ = w.WriteField("text", text)
	part, _ := w.CreateFormFile("audio", "take.ogg")
	_, _ = part.Write(take)
	_ = w.Close()
	req, _ := http.NewRequest(http.MethodPost, e.server.URL+"/v1/speaking/check", &buf)
	req.Header.Set("Authorization", "Bearer "+e2eToken)
	req.Header.Set(httpx.UserIDHeader, e.user.String())
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := e.server.Client().Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

// speakPage uploads a short text and opens it for reading.
func (e *engineE2E) speakPage() string {
	e.t.Helper()
	e.upload(e.kb, "beach.md", []byte("# The beach\n\nThe beach was a popular spot on a hot summer day. People were swimming in the ocean.\n"))
	e.drainJobs()
	var docID uuid.UUID
	if err := e.pool.QueryRow(e.t.Context(),
		`SELECT id FROM documents WHERE user_id = $1 AND title = 'beach.md'`, e.user).Scan(&docID); err != nil {
		e.t.Fatal(err)
	}
	return e.json(http.MethodPost, "/v1/reading/workspaces", map[string]any{"document_id": docID}, http.StatusOK)["id"].(string)
}

func TestTheReadAloudCheckHearsATakeOnTheBuiltinEngine(t *testing.T) {
	e := newEngineE2E(t, true)
	ws := e.speakPage()
	take := speakTake(t)
	const passage = "The beach was a popular spot on a hot summer day."

	status, res := e.speakCheck(ws, 1, passage, take)
	if status != http.StatusOK {
		t.Fatalf("check: %d %v", status, res)
	}
	words := res["words"].([]any)
	last := words[len(words)-1].(map[string]any)
	if len(words) != 11 || res["ok"].(float64) != 11 || last["added"] != "People were swimming in the ocean." ||
		res["by"].(map[string]any)["kind"] != "builtin" || res["lang"] != "en" {
		t.Fatalf("result = %v", res)
	}
	// One normalised Opus window reached the engine; three seconds were
	// spent from today's minutes; the take is gone.
	if e.builtin.calls.Load() != 1 || e.builtin.files[0] != "audio.ogg:OggS" || e.spent() != 3 {
		t.Fatalf("engine calls %d, files %v, spent %d", e.builtin.calls.Load(), e.builtin.files, e.spent())
	}

	// A passage that is not on the page is refused before anything is heard.
	if status, res := e.speakCheck(ws, 1, "a sentence from somewhere else", take); status != http.StatusBadRequest {
		t.Fatalf("a passage not on the page: %d %v", status, res)
	}
	if e.builtin.calls.Load() != 1 {
		t.Fatal("a refused check reached the engine")
	}
}

func TestTheReadAloudCheckRefusesAnotherUsersWorkspace(t *testing.T) {
	e := newEngineE2E(t, true)
	ws := e.speakPage()
	take := speakTake(t)

	owner := e.user
	e.user = testutil.NewUser(t, e.pool)
	status, _ := e.speakCheck(ws, 1, "The beach was a popular spot on a hot summer day.", take)
	e.user = owner
	if status != http.StatusNotFound || e.builtin.calls.Load() != 0 {
		t.Fatalf("another user's workspace: %d, %d engine calls", status, e.builtin.calls.Load())
	}
}

func TestTheReadAloudCheckSaysWhenNoEngineCanHear(t *testing.T) {
	e := newEngineE2E(t, false)
	ws := e.speakPage()
	status, res := e.speakCheck(ws, 1, "The beach was a popular spot on a hot summer day.", speakTake(t))
	if status != http.StatusConflict || res["code"] != "no_stt" {
		t.Fatalf("no engine: %d %v", status, res)
	}
}
