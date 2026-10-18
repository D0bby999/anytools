package app

// media_files_e2e_test.go — up-methods phase 15, end to end through the
// wiring: an uploaded MP3 rests in needs_transcript with its length read from
// its header; the built-in Whisper hears the STORED recording (no yt-dlp);
// the learner's Gemini key hears it through Gemini's Files API (upload, a
// windowed prompt per window, delete); a retry resumes after the stored
// windows and Cancel stops between them; the recording is served with range
// support to its owner only, and deleting the document deletes it.
//
// Scripted: speaches is an httptest server (newSpeechServer), and Gemini is
// one answering the Files API's and generateContent's recorded shapes
// (internal/connectors/media/testdata). ffmpeg is the real one. No live
// Gemini or Whisper call is made.

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

func seventySeconds(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "media", "testdata", "seventy-seconds.mp3"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// uploadFile posts one file as the learner and returns the status and body.
func (e *e2e) uploadFile(user uuid.UUID, kbID uuid.UUID, filename string, data []byte) (int, map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, _ := w.CreateFormFile("file", filename)
	_, _ = part.Write(data)
	_ = w.Close()
	res, raw := e.send(user, http.MethodPost, "/v1/kb/"+kbID.String()+"/documents", &buf, w.FormDataContentType(), nil)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

func (e *e2e) uploadRecording(kbID uuid.UUID, filename string, data []byte) string {
	e.t.Helper()
	status, body := e.uploadFile(e.user, kbID, filename, data)
	if status != http.StatusAccepted {
		e.t.Fatalf("upload %s: %d %v", filename, status, body)
	}
	if _, queued := body["job_id"]; queued {
		e.t.Fatal("a recording was queued before the learner chose an engine")
	}
	return body["document"].(map[string]any)["id"].(string)
}

// geminiFilesUpstream answers like Gemini's Files API and generateContent.
type geminiFilesUpstream struct {
	t        *testing.T
	server   *httptest.Server
	mu       sync.Mutex
	uploaded int
	bytes    int
	windows  []string
	deleted  int
	keys     map[string]bool
	// onWindow runs before a window is answered; a non-zero status fails it.
	onWindow func(n int) int
	generate atomic.Int32
}

func newGeminiFilesUpstream(t *testing.T) *geminiFilesUpstream {
	g := &geminiFilesUpstream{t: t, keys: map[string]bool{}}
	read := func(name string) []byte {
		raw, err := os.ReadFile(filepath.Join("..", "connectors", "media", "testdata", name))
		if err != nil {
			t.Error(err)
		}
		return bytes.ReplaceAll(raw, []byte("{{BASE}}"), []byte(g.server.URL+"/v1beta"))
	}
	g.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		if k := r.Header.Get("x-goog-api-key"); k != "" {
			g.keys[k] = true
		}
		g.mu.Unlock()
		switch {
		case r.URL.Query().Get("upload_id") != "":
			n, _ := io.Copy(io.Discard, r.Body)
			g.mu.Lock()
			g.uploaded++
			g.bytes = int(n)
			g.mu.Unlock()
			_, _ = w.Write(bytes.Replace(read("gemini_files_upload.json"), []byte(`"PROCESSING"`), []byte(`"ACTIVE"`), 1))
		case r.Method == http.MethodPost && r.URL.Path == "/upload/v1beta/files":
			w.Header().Set("X-Goog-Upload-URL", g.server.URL+"/upload/v1beta/files?upload_id=e2e")
		case r.Method == http.MethodDelete && r.URL.Path == "/v1beta/files/k3x9q2m7ab":
			g.mu.Lock()
			g.deleted++
			g.mu.Unlock()
			_, _ = w.Write([]byte("{}"))
		case strings.HasSuffix(r.URL.Path, ":generateContent"):
			n := int(g.generate.Add(1))
			var body map[string]any
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &body)
			parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
			g.mu.Lock()
			g.windows = append(g.windows, parts[1].(map[string]any)["text"].(string)[:80])
			g.mu.Unlock()
			if g.onWindow != nil {
				if status := g.onWindow(n); status != 0 {
					w.WriteHeader(status)
					_, _ = w.Write([]byte(`{"error":{"code":500,"message":"internal"}}`))
					return
				}
			}
			_, _ = w.Write(read("gemini_files_transcript.json"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(g.server.Close)
	return g
}

// withGeminiKey puts the learner's own Gemini key, aimed at the scripted
// upstream, on their Speech to text route.
func (e *engineE2E) withGeminiKey(base string) {
	e.t.Helper()
	ctx := e.t.Context()
	conn, err := pg.NewProviderConnectionStore(e.pool, testutil.TestEncryptionKey).CreateConnection(ctx, e.user,
		store.NewProviderConnection{Provider: "gemini", Kind: store.KindAPIKey, Name: "mine", APIBase: base, Secret: "AIza-learner-media-key"})
	if err != nil {
		e.t.Fatal(err)
	}
	if err := pg.NewFunctionRouteStore(e.pool, testutil.TestEncryptionKey).ReplaceRoute(ctx, e.user, "stt",
		[]store.RouteEntryInput{{ConnectionID: conn.ID, Model: "gemini-3.6-flash"}}); err != nil {
		e.t.Fatal(err)
	}
}

func TestAnUploadedMP3IsTranscribedByTheBuiltinEngineFromTheStoredFile(t *testing.T) {
	e := newEngineE2E(t, true)
	id := e.uploadRecording(e.kb, "Class 3 - rivers.mp3", seventySeconds(t))

	view := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)
	doc := view["document"].(map[string]any)
	if doc["source_kind"] != "media" || doc["status"] != "needs_transcript" || doc["media_mime"] != "audio/mpeg" {
		t.Fatalf("uploaded recording: %v", doc)
	}
	tr := view["transcribe"].(map[string]any)
	// 70.03 seconds by its Xing header, rounded up.
	if tr["duration_seconds"].(float64) != 71 || tr["length_unknown"] != false {
		t.Fatalf("estimate: %v", tr)
	}
	engines := e.engines(id)
	if len(engines) != 1 || engines[0]["engine"] != "builtin" || engines[0]["downloads"] != false || engines[0]["usable"] != true {
		t.Fatalf("engines = %v", engines)
	}

	e.json(http.MethodPost, "/v1/documents/"+id+"/transcribe", map[string]any{"engine": "builtin"}, http.StatusAccepted)
	if e.spent() != 71 {
		t.Fatalf("booked %d seconds", e.spent())
	}
	e.drainJobs()

	got := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["document"].(map[string]any)
	pb := got["processed_by"].(map[string]any)
	if got["status"] != "ready" || got["transcript_source"] != "ai_transcript" || pb["engine"] != "builtin" {
		t.Fatalf("after transcription: %v", got)
	}
	if e.builtin.calls.Load() != 1 || e.builtin.files[0] != "audio.ogg:OggS" {
		t.Fatalf("engine saw %d calls, files %v", e.builtin.calls.Load(), e.builtin.files)
	}
	if _, err := os.Stat(filepath.Join(e.ytdlp, "args")); !os.IsNotExist(err) {
		t.Fatal("yt-dlp ran for an uploaded file")
	}
	if !e.tmpEmpty() {
		t.Fatal("the job directory survived")
	}
	// The recording is still there to play, beside its transcript.
	res, body := e.send(e.user, http.MethodGet, "/v1/documents/"+id+"/media", nil, "", nil)
	if res.StatusCode != http.StatusOK || !bytes.Equal(body, seventySeconds(t)) {
		t.Fatalf("recording after transcription: %d, %d bytes", res.StatusCode, len(body))
	}

	// Deleting the document deletes both of its originals: the transcript it
	// now parses and the recording beside it.
	var transcript, recording string
	if err := e.pool.QueryRow(e.t.Context(), `SELECT sha256, media_sha256 FROM documents WHERE id = $1`, id).
		Scan(&transcript, &recording); err != nil || transcript == recording {
		t.Fatalf("originals %q %q (%v)", transcript, recording, err)
	}
	if st := e.status(http.MethodDelete, "/v1/kb/"+e.kb.String()+"/documents/"+id, nil); st != http.StatusNoContent {
		t.Fatalf("delete: %d", st)
	}
	for _, digest := range []string{transcript, recording} {
		if _, err := os.Stat(filepath.Join(e.blobRoot, "originals", e.user.String(), digest[:2], digest)); !os.IsNotExist(err) {
			t.Fatalf("an original outlived its document: %s", digest)
		}
	}
}

func TestTheRecordingIsServedWithRangesToItsOwnerOnlyAndDeletedWithItsDocument(t *testing.T) {
	e := newEngineE2E(t, false)
	mp3 := seventySeconds(t)
	id := e.uploadRecording(e.kb, "talk.mp3", mp3)

	res, body := e.send(e.user, http.MethodGet, "/v1/documents/"+id+"/media", nil, "", map[string]string{"Range": "bytes=100-199"})
	if res.StatusCode != http.StatusPartialContent || !bytes.Equal(body, mp3[100:200]) ||
		res.Header.Get("Content-Type") != "audio/mpeg" || res.Header.Get("X-Content-Type-Options") != "nosniff" ||
		res.Header.Get("Content-Range") != "bytes 100-199/"+strconv.Itoa(len(mp3)) {
		t.Fatalf("range: %d %v (%d bytes)", res.StatusCode, res.Header, len(body))
	}

	bob := testutil.NewUser(t, e.pool)
	foreign, _ := e.send(bob, http.MethodGet, "/v1/documents/"+id+"/media", nil, "", nil)
	missing, _ := e.send(bob, http.MethodGet, "/v1/documents/"+uuid.NewString()+"/media", nil, "", nil)
	if foreign.StatusCode != http.StatusNotFound || missing.StatusCode != http.StatusNotFound {
		t.Fatalf("bob: %d, nonexistent: %d", foreign.StatusCode, missing.StatusCode)
	}
	// A document that is not a recording has none to serve.
	if code, _ := e.uploadFile(e.user, e.kb, "notes.md", []byte("# Notes\n\nText.")); code != http.StatusAccepted {
		t.Fatalf("markdown upload: %d", code)
	}

	// The same recording twice in one knowledge base is refused as a duplicate.
	if code, _ := e.uploadFile(e.user, e.kb, "again.mp3", mp3); code != http.StatusConflict {
		t.Fatalf("duplicate recording: %d", code)
	}

	digest := e.scalarText(`SELECT media_sha256 FROM documents WHERE id = $1`, id)
	path := filepath.Join(e.blobRoot, "originals", e.user.String(), digest[:2], digest)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the recording is not stored: %v", err)
	}
	if st := e.status(http.MethodDelete, "/v1/kb/"+e.kb.String()+"/documents/"+id, nil); st != http.StatusNoContent {
		t.Fatalf("delete: %d", st)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("the recording outlived its document")
	}
}

// A recording gone from its store is the same 404 as no recording.
func TestARecordingMissingFromItsStoreIsNotFound(t *testing.T) {
	e := newEngineE2E(t, false)
	id := e.uploadRecording(e.kb, "talk.mp3", seventySeconds(t))
	digest := e.scalarText(`SELECT media_sha256 FROM documents WHERE id = $1`, id)
	if err := os.Remove(filepath.Join(e.blobRoot, "originals", e.user.String(), digest[:2], digest)); err != nil {
		t.Fatal(err)
	}
	if res, _ := e.send(e.user, http.MethodGet, "/v1/documents/"+id+"/media", nil, "", nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("a missing recording: %d", res.StatusCode)
	}
}

func TestAMediaNameOnAnotherKindOfBodyIsRefused(t *testing.T) {
	e := newEngineE2E(t, false)
	png := append([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), make([]byte, 256)...)
	if code, body := e.uploadFile(e.user, e.kb, "song.mp3", png); code != http.StatusUnsupportedMediaType {
		t.Fatalf("a PNG named .mp3: %d %v", code, body)
	}
	if n := e.scalar(`SELECT count(*)::int FROM documents WHERE user_id = $1`, e.user); n != 0 {
		t.Fatalf("%d documents after a refused upload", n)
	}
}

func TestGeminiHearsARecordingThroughItsFilesAPIAndTheUploadIsDeleted(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	e := newEngineE2E(t, false)
	gemini := newGeminiFilesUpstream(t)
	e.withGeminiKey(gemini.server.URL)
	mp3 := seventySeconds(t)
	id := e.uploadRecording(e.kb, "podcast.mp3", mp3)

	var opt map[string]any
	for _, o := range e.engines(id) {
		if o["engine"] == "gemini" {
			opt = o
		}
	}
	// 71 seconds of audio at Gemini's 32 tokens a second.
	if opt == nil || opt["usable"] != true || opt["estimated_tokens"].(float64) != 71*32 {
		t.Fatalf("gemini option %v", opt)
	}
	e.json(http.MethodPost, "/v1/documents/"+id+"/transcribe", map[string]any{"engine": "gemini"}, http.StatusAccepted)
	e.drainJobs()

	got := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["document"].(map[string]any)
	pb := got["processed_by"].(map[string]any)
	if got["status"] != "ready" || got["transcript_source"] != "ai_transcript" || pb["engine"] != "gemini" || pb["model"] != "gemini-3.6-flash" {
		t.Fatalf("after transcription: %v", got)
	}
	content := e.json(http.MethodGet, "/v1/documents/"+id+"/content?page=1", nil, http.StatusOK)
	if page := content["pages"].([]any)[0].(map[string]any)["markdown"].(string); !strings.Contains(page, "Welcome back to the class.") {
		t.Fatalf("page 1 = %q", page)
	}
	if gemini.uploaded != 1 || gemini.bytes != len(mp3) || gemini.generate.Load() != 1 || gemini.deleted != 1 {
		t.Fatalf("uploaded %d (%d bytes), %d windows, %d deleted", gemini.uploaded, gemini.bytes, gemini.generate.Load(), gemini.deleted)
	}
	if len(gemini.keys) != 1 || !gemini.keys["AIza-learner-media-key"] {
		t.Fatalf("keys seen: %v", gemini.keys)
	}
}

// A two-hour recording is six windows. The third fails once: the retry
// resumes at it without paying for the first two again. Then a second
// recording is cancelled during its second window and stops there.
func TestARetryResumesFromTheStoredWindowsAndCancelStopsBetweenThem(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	e := newEngineE2E(t, false)
	gemini := newGeminiFilesUpstream(t)
	e.withGeminiKey(gemini.server.URL)
	long := func(name string) string {
		data := append(append([]byte{}, seventySeconds(t)...), []byte(name)...)
		id := e.uploadRecording(e.kb, name, data)
		if _, err := e.pool.Exec(e.t.Context(),
			`UPDATE documents SET media = jsonb_set(media, '{duration_seconds}', '7200') WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
		return id
	}

	id := long("lecture.mp3")
	gemini.onWindow = func(n int) int {
		if n == 3 {
			return http.StatusInternalServerError
		}
		return 0
	}
	e.json(http.MethodPost, "/v1/documents/"+id+"/transcribe", map[string]any{"engine": "gemini"}, http.StatusAccepted)
	e.drainJobs()
	if n := gemini.generate.Load(); n != 3 {
		t.Fatalf("first attempt made %d calls", n)
	}
	// The retry's back-off and the key's 30-second bench for the 500, both
	// skipped rather than waited out.
	if _, err := e.pool.Exec(e.t.Context(), `UPDATE jobs SET run_after = now() WHERE user_id = $1`, e.user); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(e.t.Context(), `UPDATE provider_connections
		SET settings = settings - 'cooldown_until' - 'backoff_level' - 'cooldown_reason' WHERE user_id = $1`, e.user); err != nil {
		t.Fatal(err)
	}
	e.drainJobs()
	got := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["document"].(map[string]any)
	if got["status"] != "ready" {
		t.Fatalf("after the retry: %v", got)
	}
	// 3 + the four windows left: windows 1 and 2 were not heard twice.
	if n := gemini.generate.Load(); n != 7 {
		t.Fatalf("%d calls in all, want 7", n)
	}
	if gemini.uploaded != 2 || gemini.deleted != 2 {
		t.Fatalf("each attempt's upload must be deleted: %d uploaded, %d deleted", gemini.uploaded, gemini.deleted)
	}

	// Cancel, pressed while the second window is being heard.
	other := long("meeting.mp3")
	gemini.generate.Store(0)
	gemini.onWindow = func(n int) int {
		if n == 2 {
			if st := e.status(http.MethodPost, "/v1/documents/"+other+"/transcribe/cancel", nil); st != http.StatusAccepted {
				t.Errorf("cancel: %d", st)
			}
		}
		return 0
	}
	e.json(http.MethodPost, "/v1/documents/"+other+"/transcribe", map[string]any{"engine": "gemini"}, http.StatusAccepted)
	e.drainJobs()
	if n := gemini.generate.Load(); n != 2 {
		t.Fatalf("a cancelled job made %d calls, want 2", n)
	}
	got = e.json(http.MethodGet, "/v1/documents/"+other, nil, http.StatusOK)["document"].(map[string]any)
	if got["status"] != "needs_transcript" || got["error"] != "The transcription was cancelled." {
		t.Fatalf("after cancel: %v", got)
	}
	if gemini.deleted != 3 {
		t.Fatalf("a cancelled job left its upload on Gemini: %d deleted", gemini.deleted)
	}
	// Nothing is running now, so there is nothing to cancel.
	if st := e.status(http.MethodPost, "/v1/documents/"+other+"/transcribe/cancel", nil); st != http.StatusConflict {
		t.Fatalf("cancel with nothing running: %d", st)
	}
}

// A recording whose header does not say how long it is: the page says so,
// and the learner confirms before anything starts.
func TestAnUnknownLengthIsConfirmedBeforeTranscribing(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	e := newEngineE2E(t, false)
	gemini := newGeminiFilesUpstream(t)
	e.withGeminiKey(gemini.server.URL)
	id := e.uploadRecording(e.kb, "old.mpeg", mpegClip(t))

	tr := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["transcribe"].(map[string]any)
	if tr["length_unknown"] != true || tr["duration_seconds"].(float64) != 0 {
		t.Fatalf("estimate: %v", tr)
	}
	res := e.do(http.MethodPost, "/v1/documents/"+id+"/transcribe", map[string]any{"engine": "gemini"})
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusConflict || !strings.Contains(string(raw), "duration_unknown") {
		t.Fatalf("unconfirmed: %d %s", res.StatusCode, raw)
	}
	if gemini.generate.Load() != 0 || gemini.uploaded != 0 {
		t.Fatal("work started before the learner confirmed")
	}
	e.json(http.MethodPost, "/v1/documents/"+id+"/transcribe",
		map[string]any{"engine": "gemini", "confirm_unknown_length": true}, http.StatusAccepted)
	e.drainJobs()
	if got := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["document"].(map[string]any); got["status"] != "ready" {
		t.Fatalf("after a confirmed transcription: %v", got)
	}
}

func mpegClip(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "connectors", "media", "testdata", "clip.mpeg"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func (e *e2e) scalarText(sql string, args ...any) string {
	e.t.Helper()
	var s string
	if err := e.pool.QueryRow(e.t.Context(), sql, args...).Scan(&s); err != nil {
		e.t.Fatal(err)
	}
	return s
}
