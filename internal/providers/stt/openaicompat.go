package stt

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
)

// openaicompat.go — POST {base}/audio/transcriptions, multipart.
//
// The fields, from OpenAI's API reference (createTranscription), Groq's
// speech-to-text guide and speaches' OpenAI-compatible router (read
// 2026-10-16): `file`, `model`, `response_format`, `timestamp_granularities[]`
// and an optional `language` (ISO-639-1). With `verbose_json` all three answer
// `{language, duration, text, segments: [{start, end, text, …}]}`; they differ
// only in how they spell the language ("english", "English", "en"), which
// languageCode folds.
//
// OpenAI's gpt-4o transcribe models accept `json` or `text` only, so for them
// the client asks for `json` and spreads the text over the audio (Spread).

// silenceWAV is one second of 16 kHz mono silence, the verify probe.
//
//go:embed testdata/silence.wav
var silenceWAV []byte

// OpenAICompat is the transcriber for one OpenAI-shaped endpoint.
type OpenAICompat struct {
	key, base, model string
	hc               *http.Client
}

// NewOpenAICompat builds a transcriber. base includes its version segment
// ("https://api.openai.com/v1", "https://api.groq.com/openai/v1"); empty is
// OpenAI's. key may be empty (the built-in engine). A nil hc is the BYOK
// egress client: SSRF-guarded, ten minutes, because a twenty-minute window of
// speech can take minutes to hear.
func NewOpenAICompat(key, base, model string, hc *http.Client) *OpenAICompat {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		base = DefaultOpenAIBase
	}
	if hc == nil {
		hc = security.SafeBYOKClient(10 * time.Minute)
	}
	return &OpenAICompat{key: key, base: base, model: model, hc: hc}
}

// DefaultOpenAIBase is OpenAI's API base.
const DefaultOpenAIBase = "https://api.openai.com/v1"

// Model is the model id this client sends.
func (c *OpenAICompat) Model() string { return c.model }

var _ Transcriber = (*OpenAICompat)(nil)

// textOnly reports whether a model answers `json` without segment times.
func textOnly(model string) bool {
	m := strings.ToLower(model)
	return strings.HasPrefix(m, "gpt-4o") && strings.Contains(m, "transcribe")
}

// Transcribe sends one stretch of audio, at most MaxUpload bytes.
func (c *OpenAICompat) Transcribe(ctx context.Context, audio io.Reader, mime, lang string) (*Segments, error) {
	data, tooBig, err := blob.ReadAllLimited(audio, MaxUpload)
	if err != nil {
		return nil, fmt.Errorf("stt: read audio: %w", err)
	}
	if tooBig {
		return nil, ErrAudioTooLarge
	}
	body, contentType, err := c.form(data, mime, lang)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/audio/transcriptions", body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "application/json")
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("stt: transcribe: %s", c.redact(err.Error()))
	}
	defer resp.Body.Close()
	raw, tooBig, err := blob.ReadAllLimited(resp.Body, maxResponse)
	if err != nil {
		return nil, fmt.Errorf("stt: read answer: %s", c.redact(err.Error()))
	}
	if resp.StatusCode != http.StatusOK {
		msg := c.redact(string(raw))
		if len(msg) > 600 {
			msg = msg[:600] + "…"
		}
		return nil, &providers.HTTPError{Status: resp.StatusCode, Body: msg,
			RetryAfter: providers.ParseRetryAfter(resp.Header.Get("Retry-After"))}
	}
	if tooBig {
		return nil, ErrResponseTooLarge
	}
	return ParseResponse(raw)
}

// form is the multipart body.
func (c *OpenAICompat) form(audio []byte, mime, lang string) (io.Reader, string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", `form-data; name="file"; filename="`+fileName(mime)+`"`)
	if mime == "" {
		mime = "application/octet-stream"
	}
	h.Set("Content-Type", mime)
	part, err := w.CreatePart(h)
	if err != nil {
		return nil, "", err
	}
	if _, err := part.Write(audio); err != nil {
		return nil, "", err
	}
	fields := [][2]string{{"model", c.model}}
	if textOnly(c.model) {
		fields = append(fields, [2]string{"response_format", "json"})
	} else {
		fields = append(fields,
			[2]string{"response_format", "verbose_json"},
			[2]string{"timestamp_granularities[]", "segment"})
	}
	if code := languageCode(lang); code != "" {
		fields = append(fields, [2]string{"language", code})
	}
	for _, f := range fields {
		if err := w.WriteField(f[0], f[1]); err != nil {
			return nil, "", err
		}
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return &buf, w.FormDataContentType(), nil
}

// fileName gives the upload an extension the engine recognises: OpenAI and
// Groq pick the decoder from it.
func fileName(mime string) string {
	switch strings.ToLower(strings.TrimSpace(strings.SplitN(mime, ";", 2)[0])) {
	case "audio/ogg", "audio/opus":
		return "audio.ogg"
	case "audio/wav", "audio/x-wav", "audio/wave":
		return "audio.wav"
	case "audio/mpeg", "audio/mp3":
		return "audio.mp3"
	case "audio/mp4", "audio/m4a", "audio/x-m4a":
		return "audio.m4a"
	case "audio/webm", "video/webm":
		return "audio.webm"
	case "audio/flac":
		return "audio.flac"
	}
	return "audio.ogg"
}

// redact removes the key from text that may echo it: a gateway's error page,
// a transport error. The key is never in a URL here (it rides a header), so
// this is the second line, not the first.
func (c *OpenAICompat) redact(s string) string {
	if c.key == "" {
		return s
	}
	return strings.ReplaceAll(s, c.key, "[redacted]")
}

// Ping sends one second of silence and accepts any 200 that is a transcript,
// even an empty one: silence has no words to hear.
func (c *OpenAICompat) Ping(ctx context.Context) error {
	_, err := c.Transcribe(ctx, bytes.NewReader(silenceWAV), "audio/wav", "en")
	if errors.Is(err, ErrNoSpeech) {
		return nil
	}
	return err
}

// verbose is the answer read; every other field is ignored.
type verbose struct {
	Language string   `json:"language"`
	Duration *float64 `json:"duration"`
	Text     *string  `json:"text"`
	Segments []struct {
		Start float64 `json:"start"`
		End   float64 `json:"end"`
		Text  string  `json:"text"`
	} `json:"segments"`
}

// ParseResponse reads a verbose_json (or json) answer. Exported for the
// recorded-fixture tests.
func ParseResponse(raw []byte) (*Segments, error) {
	var v verbose
	if err := json.Unmarshal(raw, &v); err != nil || v.Text == nil {
		return nil, ErrBadResponse
	}
	out := &Segments{Language: languageCode(v.Language)}
	if v.Duration != nil && *v.Duration > 0 {
		out.Duration = *v.Duration
	}
	segs := make([]Segment, 0, len(v.Segments))
	for _, s := range v.Segments {
		segs = append(segs, Segment{Start: s.Start, End: s.End, Text: s.Text})
	}
	out.Segments = clean(segs)
	if len(out.Segments) > 0 {
		out.Timed = true
		return out, nil
	}
	if strings.TrimSpace(*v.Text) == "" {
		return out, ErrNoSpeech
	}
	out.Segments = Spread(*v.Text, out.Duration)
	return out, nil
}
