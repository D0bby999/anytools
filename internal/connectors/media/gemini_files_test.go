package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
)

const testKey = "AIza-files-test-key-0123456789"

// fakeGemini replays the recorded Files API answers and keeps what it saw.
type fakeGemini struct {
	t   *testing.T
	srv *httptest.Server

	mu        sync.Mutex
	calls     []string
	uploaded  []byte
	uploadKey string
	gotBody   map[string]any
	deleted   []string
	// polls is how many GETs answer PROCESSING before ACTIVE.
	polls int
	// state overrides the final state (FAILED).
	state string
	// uploadHost overrides the X-Goog-Upload-URL the start answers with.
	uploadHost string
	deny       bool
}

func (f *fakeGemini) body(name string) []byte {
	raw := fixture(f.t, name)
	raw = bytes.ReplaceAll(raw, []byte("{{BASE}}"), []byte(f.srv.URL+"/v1beta"))
	return bytes.ReplaceAll(raw, []byte("{{KEY}}"), []byte(testKey))
}

func newFakeGemini(t *testing.T) *fakeGemini {
	f := &fakeGemini{t: t}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls = append(f.calls, r.Method+" "+r.URL.Path)
		key := r.Header.Get("x-goog-api-key")
		if r.URL.Query().Get("upload_id") == "AB12cd" {
			f.uploadKey = key
			if r.Header.Get("X-Goog-Upload-Command") != "upload, finalize" || r.Header.Get("X-Goog-Upload-Offset") != "0" {
				t.Errorf("upload headers: %v", r.Header)
			}
			f.uploaded, _ = io.ReadAll(r.Body)
			_, _ = w.Write(f.body("gemini_files_upload.json"))
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/upload/v1beta/files" {
			if key != testKey || r.Header.Get("X-Goog-Upload-Protocol") != "resumable" ||
				r.Header.Get("X-Goog-Upload-Command") != "start" ||
				r.Header.Get("X-Goog-Upload-Header-Content-Length") != "12608" ||
				r.Header.Get("X-Goog-Upload-Header-Content-Type") != "audio/mpeg" {
				t.Errorf("start headers: %v", r.Header)
			}
			if f.deny {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write(f.body("gemini_files_denied.json"))
				return
			}
			host := f.srv.URL
			if f.uploadHost != "" {
				host = f.uploadHost
			}
			w.Header().Set("X-Goog-Upload-URL", host+"/upload/v1beta/files?upload_id=AB12cd&upload_protocol=resumable")
			w.WriteHeader(http.StatusOK)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1beta/files/k3x9q2m7ab":
			if key != testKey {
				t.Errorf("state check without the key")
			}
			if f.polls > 0 {
				f.polls--
				_, _ = w.Write(bytes.Replace(f.body("gemini_files_active.json"), []byte(`"ACTIVE"`), []byte(`"PROCESSING"`), 1))
				return
			}
			if f.state != "" {
				_, _ = w.Write(bytes.Replace(f.body("gemini_files_active.json"), []byte(`"ACTIVE"`), []byte(`"`+f.state+`"`), 1))
				return
			}
			_, _ = w.Write(f.body("gemini_files_active.json"))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, ":generateContent"):
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &f.gotBody)
			_, _ = w.Write(f.body("gemini_files_transcript.json"))
		case r.Method == http.MethodDelete && r.URL.Path == "/v1beta/files/k3x9q2m7ab":
			f.deleted = append(f.deleted, r.URL.Path)
			if key != testKey {
				t.Errorf("delete without the key")
			}
			_, _ = w.Write([]byte("{}"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeGemini) client() *GeminiFiles {
	g := NewGeminiFiles(testKey, f.srv.URL, "gemini-3.6-flash")
	g.Poll, g.MaxWait = 5*time.Millisecond, 2*time.Second
	return g
}

// captureLogs sends slog's default output to a buffer for the test.
func captureLogs(t *testing.T) *bytes.Buffer {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func TestAFileIsUploadedTranscribedByWindowAndDeleted(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	logs := captureLogs(t)
	fake := newFakeGemini(t)
	fake.polls = 2
	g := fake.client()
	audio := fixture(t, "tone.mp3")
	ctx := context.Background()

	file, err := g.Upload(ctx, bytes.NewReader(audio), int64(len(audio)), "audio/mpeg", "anytools-recording")
	if err != nil {
		t.Fatal(err)
	}
	if file.State != "ACTIVE" || file.Name != "files/k3x9q2m7ab" || file.URI != fake.srv.URL+"/v1beta/files/k3x9q2m7ab" {
		t.Fatalf("file = %+v", file)
	}
	if !bytes.Equal(fake.uploaded, audio) {
		t.Fatalf("uploaded %d bytes, want the file's %d", len(fake.uploaded), len(audio))
	}
	if fake.uploadKey != "" {
		t.Error("the key was sent to the upload URL, which carries its own upload id")
	}

	// The second window of a long recording: the windowed prompt with the
	// uploaded file as its media. Audio is not clipped by offsets.
	part, err := g.TranscribeWindow(ctx, file, youtube.Window{Start: 3600, End: 4800})
	if err != nil {
		t.Fatal(err)
	}
	parts := fake.gotBody["contents"].([]any)[0].(map[string]any)["parts"].([]any)
	data := parts[0].(map[string]any)["file_data"].(map[string]any)
	if data["file_uri"] != file.URI || data["mime_type"] != "audio/mpeg" {
		t.Fatalf("file_data = %v", data)
	}
	if _, clipped := parts[0].(map[string]any)["video_metadata"]; clipped {
		t.Error("an audio file was sent video offsets")
	}
	if text := parts[1].(map[string]any)["text"].(string); !strings.Contains(text, "from 1:00:00 to 1:20:00") {
		t.Errorf("the prompt does not name the window: %q", text)
	}
	if part.Model != "gemini-3.6-flash" || part.InputTokens != 640 {
		t.Fatalf("part = %+v", part)
	}

	if err := g.Delete(ctx, file.Name); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"POST /upload/v1beta/files", "POST /upload/v1beta/files",
		"GET /v1beta/files/k3x9q2m7ab", "GET /v1beta/files/k3x9q2m7ab", "GET /v1beta/files/k3x9q2m7ab",
		"POST /v1beta/models/gemini-3.6-flash:generateContent",
		"DELETE /v1beta/files/k3x9q2m7ab",
	}
	if strings.Join(fake.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls:\n%s\nwant:\n%s", strings.Join(fake.calls, "\n"), strings.Join(want, "\n"))
	}
	if strings.Contains(logs.String(), testKey) {
		t.Error("the key reached the log")
	}
}

func TestAVideoFileIsClippedByOffsets(t *testing.T) {
	body := youtube.FileRequestBody("https://g.test/v1beta/files/x", "video/mp4", youtube.Window{Start: 0, End: 1200})
	part := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)[0].(map[string]any)
	if md, ok := part["video_metadata"].(map[string]any); !ok || md["end_offset"] != "1200s" {
		t.Fatalf("video window not clipped: %v", part)
	}
}

func TestTheKeyIsInNoErrorAndAForeignHostIsRefused(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	logs := captureLogs(t)
	audio := fixture(t, "tone.mp3")
	ctx := context.Background()

	// A refusal whose body quotes the key: the error says 403, never the key.
	fake := newFakeGemini(t)
	fake.deny = true
	_, err := fake.client().Upload(ctx, bytes.NewReader(audio), int64(len(audio)), "audio/mpeg", "x")
	var he *providers.HTTPError
	if !errors.As(err, &he) || he.Status != http.StatusForbidden {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), testKey) {
		t.Fatalf("the key is in the error: %v", err)
	}

	// An upload URL on another host is not followed, so neither the bytes
	// nor anything else go there.
	other := newFakeGemini(t)
	fake = newFakeGemini(t)
	fake.uploadHost = other.srv.URL
	if _, err := fake.client().Upload(ctx, bytes.NewReader(audio), int64(len(audio)), "audio/mpeg", "x"); err == nil {
		t.Fatal("an upload URL on another host was used")
	}
	if len(other.calls) != 0 {
		t.Fatalf("the other host was called: %v", other.calls)
	}

	// A transport failure: the error names the operation, not the key.
	g := NewGeminiFiles(testKey, "http://127.0.0.1:1", "m")
	if _, err := g.Upload(ctx, bytes.NewReader(audio), int64(len(audio)), "audio/mpeg", "x"); err == nil || strings.Contains(err.Error(), testKey) {
		t.Fatalf("transport error = %v", err)
	}

	// A file Gemini could not process is deleted, and says so.
	fake = newFakeGemini(t)
	fake.state = "FAILED"
	if _, err := fake.client().Upload(ctx, bytes.NewReader(audio), int64(len(audio)), "audio/mpeg", "x"); !errors.Is(err, ErrFileFailed) {
		t.Fatalf("failed file: %v", err)
	}
	if len(fake.deleted) != 1 {
		t.Fatalf("a failed file was not deleted: %v", fake.calls)
	}

	// A malformed file name never reaches a URL.
	if err := fake.client().Delete(ctx, "files/../../v1beta/models"); err == nil {
		t.Fatal("a malformed name was deleted")
	}
	// A URI under another base is not sent to generateContent.
	if _, err := fake.client().TranscribeWindow(ctx, &File{Name: "files/x", URI: "https://evil.test/v1beta/files/x", MIMEType: "audio/mpeg"}, youtube.Window{}); err == nil {
		t.Fatal("a foreign file URI was transcribed")
	}
	if strings.Contains(logs.String(), testKey) {
		t.Error("the key reached the log")
	}
}

func TestTheUploadEndpointSitsBesideTheBase(t *testing.T) {
	for base, want := range map[string]string{
		"https://generativelanguage.googleapis.com/v1beta": "https://generativelanguage.googleapis.com/upload/v1beta/files",
		"https://proxy.example/gemini/v1beta":              "https://proxy.example/gemini/upload/v1beta/files",
	} {
		if got := uploadEndpoint(base); got != want {
			t.Errorf("%s: %s, want %s", base, got, want)
		}
	}
}
