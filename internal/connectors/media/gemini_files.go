package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
)

// gemini_files.go — an uploaded recording transcribed by the learner's own
// Gemini key (up-methods phase 15).
//
// A YouTube video is read by Gemini from its public URL (youtube.Gemini). A
// file the learner uploaded has no public URL, so it goes to Gemini's Files
// API first, then the same windowed prompt runs with file_data naming the
// uploaded file, and the file is deleted when the job is done with it. The
// pattern is open-notebook's and anything-llm's (an uploaded recording heard
// by the user's own provider); the wire shape is Google's, from
// https://ai.google.dev/gemini-api/docs/files and
// https://ai.google.dev/api/files (read 2026-10-16):
//
//   - the resumable protocol: POST {host}/upload/v1beta/files with
//     X-Goog-Upload-Protocol: resumable and X-Goog-Upload-Command: start,
//     the length and type in X-Goog-Upload-Header-Content-Length/-Type, and
//     {"file": {"display_name": …}}; the answer's X-Goog-Upload-URL header
//     takes the bytes with X-Goog-Upload-Command: upload, finalize and
//     X-Goog-Upload-Offset: 0, and answers {"file": File};
//   - File.state is PROCESSING until the file can be used (video takes a
//     while), then ACTIVE, or FAILED: GET {base}/{name} until it settles;
//   - DELETE {base}/{name} removes it. Google also deletes every file after
//     48 hours, which bounds what a crashed job leaves behind.
//
// The key goes in the x-goog-api-key header to Google's own endpoints only.
// The upload URL is accepted only on the connection's own host, and is sent
// the bytes without the key (it carries its own upload id). No error this
// file returns carries the key: a response body is cut and scrubbed, and a
// transport error is scrubbed.

// MaxFileJSON bounds every Files API answer read: a File is a few hundred
// bytes of JSON.
const MaxFileJSON = 1 << 20

// Waiting for a file to become ACTIVE.
const (
	DefaultPollInterval = 2 * time.Second
	DefaultMaxWait      = 10 * time.Minute
)

// ErrFileFailed is a file Gemini could not process (state FAILED, or still
// processing when the wait ran out).
var ErrFileFailed = errors.New("gemini could not process the uploaded file")

// File is an uploaded file, as the Files API describes it.
type File struct {
	Name     string `json:"name"`
	URI      string `json:"uri"`
	MIMEType string `json:"mimeType"`
	State    string `json:"state"`
}

// GeminiFiles is the Files API and the windowed transcription for one Gemini
// API-key connection. byok builds it from the learner's own key.
type GeminiFiles struct {
	gen              *youtube.Gemini
	key, base        string
	upload           string
	hc, uploadClient *http.Client
	// Poll and MaxWait pace the wait for ACTIVE; tests shorten them.
	Poll, MaxWait time.Duration
}

// NewGeminiFiles builds the client. base may be empty for Google's endpoint.
func NewGeminiFiles(key, base, model string) *GeminiFiles {
	gen := youtube.NewGemini(key, base, model)
	return &GeminiFiles{
		gen:  gen,
		key:  key,
		base: gen.Base(),
		// {base} is …/v1beta; the upload endpoint is the same path under
		// /upload (Google's own layout, kept for a proxy with a prefix).
		upload: uploadEndpoint(gen.Base()),
		hc:     security.SafeBYOKClient(time.Minute),
		// Half a gigabyte on a slow uplink.
		uploadClient: security.SafeBYOKClient(30 * time.Minute),
		Poll:         DefaultPollInterval,
		MaxWait:      DefaultMaxWait,
	}
}

func uploadEndpoint(base string) string {
	if i := strings.LastIndex(base, "/"); i > len("https://") {
		return base[:i] + "/upload" + base[i:] + "/files"
	}
	return base + "/upload/files"
}

// Model is the model id the windows are transcribed with.
func (g *GeminiFiles) Model() string { return g.gen.Model() }

// Upload sends size bytes of body as one file and waits until Gemini can
// use it.
func (g *GeminiFiles) Upload(ctx context.Context, body io.Reader, size int64, mime, displayName string) (*File, error) {
	meta, err := json.Marshal(map[string]any{"file": map[string]any{"display_name": displayName}})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.upload, bytes.NewReader(meta))
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-goog-api-key", g.key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Upload-Protocol", "resumable")
	req.Header.Set("X-Goog-Upload-Command", "start")
	req.Header.Set("X-Goog-Upload-Header-Content-Length", strconv.FormatInt(size, 10))
	req.Header.Set("X-Goog-Upload-Header-Content-Type", mime)
	resp, err := g.hc.Do(req)
	if err != nil {
		return nil, g.scrub("start upload", err)
	}
	_, err = g.read(resp)
	if err != nil {
		return nil, err
	}
	target := resp.Header.Get("X-Goog-Upload-URL")
	if err := g.sameHost(target); err != nil {
		return nil, err
	}

	put, err := http.NewRequestWithContext(ctx, http.MethodPost, target, body)
	if err != nil {
		return nil, err
	}
	put.ContentLength = size
	put.Header.Set("X-Goog-Upload-Offset", "0")
	put.Header.Set("X-Goog-Upload-Command", "upload, finalize")
	resp, err = g.uploadClient.Do(put)
	if err != nil {
		return nil, g.scrub("upload", err)
	}
	raw, err := g.read(resp)
	if err != nil {
		return nil, err
	}
	var out struct {
		File File `json:"file"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, errors.New("gemini files: the upload answer was not a file")
	}
	f, err := g.checked(out.File)
	if err != nil {
		return nil, err
	}
	return g.wait(ctx, f)
}

// wait polls the file until it is ACTIVE. A file that FAILED is deleted.
func (g *GeminiFiles) wait(ctx context.Context, f *File) (*File, error) {
	deadline := time.Now().Add(g.MaxWait)
	for f.State != "ACTIVE" {
		if f.State == "FAILED" || time.Now().After(deadline) {
			_ = g.Delete(context.WithoutCancel(ctx), f.Name)
			return nil, ErrFileFailed
		}
		select {
		case <-ctx.Done():
			_ = g.Delete(context.WithoutCancel(ctx), f.Name)
			return nil, ctx.Err()
		case <-time.After(g.Poll):
		}
		got, err := g.get(ctx, f.Name)
		if err != nil {
			_ = g.Delete(context.WithoutCancel(ctx), f.Name)
			return nil, err
		}
		f = got
	}
	return f, nil
}

func (g *GeminiFiles) get(ctx context.Context, name string) (*File, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.base+"/"+name, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-goog-api-key", g.key)
	resp, err := g.hc.Do(req)
	if err != nil {
		return nil, g.scrub("file state", err)
	}
	raw, err := g.read(resp)
	if err != nil {
		return nil, err
	}
	var f File
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, errors.New("gemini files: the state answer was not a file")
	}
	return g.checked(f)
}

// Delete removes an uploaded file. A file already gone is not an error.
func (g *GeminiFiles) Delete(ctx context.Context, name string) error {
	if !fileName.MatchString(name) {
		return errors.New("gemini files: malformed file name")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, g.base+"/"+name, nil)
	if err != nil {
		return err
	}
	req.Header.Set("x-goog-api-key", g.key)
	resp, err := g.hc.Do(req)
	if err != nil {
		return g.scrub("delete", err)
	}
	if resp.StatusCode == http.StatusNotFound {
		resp.Body.Close()
		return nil
	}
	_, err = g.read(resp)
	return err
}

// TranscribeWindow runs the windowed prompt on an uploaded file.
func (g *GeminiFiles) TranscribeWindow(ctx context.Context, f *File, w youtube.Window) (*youtube.Part, error) {
	return g.gen.TranscribeFile(ctx, f.URI, f.MIMEType, w)
}

var fileName = regexp.MustCompile(`^files/[a-z0-9-]{1,64}$`)

// checked accepts a File only with a well-formed name and a URI under this
// connection's own base, since both are put in later requests.
func (g *GeminiFiles) checked(f File) (*File, error) {
	if !fileName.MatchString(f.Name) || f.URI != g.base+"/"+f.Name {
		return nil, errors.New("gemini files: the answer named a file this connection does not own")
	}
	return &f, nil
}

// sameHost accepts an upload URL only on the connection's own scheme and host.
func (g *GeminiFiles) sameHost(target string) error {
	t, err := url.Parse(target)
	b, berr := url.Parse(g.base)
	if target == "" || err != nil || berr != nil || t.Scheme != b.Scheme || t.Host != b.Host || t.User != nil {
		return errors.New("gemini files: the upload was offered on another host")
	}
	return nil
}

// read reads a bounded answer and turns a non-2xx into a providers.HTTPError,
// which the job classifies as the parse lane does (a 4xx is not retried).
func (g *GeminiFiles) read(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, MaxFileJSON+1))
	if err != nil {
		return nil, g.scrub("read", err)
	}
	if len(raw) > MaxFileJSON {
		return nil, errors.New("gemini files: the answer is too large")
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body := g.redact(string(raw))
		if len(body) > 600 {
			body = body[:600] + "…"
		}
		return nil, &providers.HTTPError{Status: resp.StatusCode, Body: body,
			RetryAfter: providers.ParseRetryAfter(resp.Header.Get("Retry-After"))}
	}
	return raw, nil
}

func (g *GeminiFiles) redact(s string) string {
	if g.key == "" {
		return s
	}
	return strings.ReplaceAll(s, g.key, "[redacted]")
}

// scrub keeps a transport error's kind (a cancel stays a cancel) and drops
// its text when it names the key.
func (g *GeminiFiles) scrub(op string, err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return context.Canceled
	case errors.Is(err, context.DeadlineExceeded):
		return context.DeadlineExceeded
	}
	return fmt.Errorf("gemini files: %s: %s", op, g.redact(err.Error()))
}
