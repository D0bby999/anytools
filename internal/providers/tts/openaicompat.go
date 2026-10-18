package tts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
)

// openaicompat.go — POST {base}/audio/speech, one request per turn.
//
// The fields, from OpenAI's API reference (createSpeech) and Kokoro-FastAPI's
// OpenAISpeechRequest (v0.9.0, read 2026-10-16): `model`, `input`, `voice`,
// `response_format` and `speed`. Both answer `pcm` with the raw samples and
// nothing else: 24 kHz, 16-bit, mono. Kokoro-FastAPI streams by default; the
// body is the same bytes either way, read to the end.
//
// One request per turn, because an OpenAI-shaped endpoint speaks one voice
// per request. The chunk's turns are spoken in order and concatenated; the
// budget is the chunk's, shared by its turns.

// DefaultOpenAIBase is OpenAI's API base.
const DefaultOpenAIBase = "https://api.openai.com/v1"

// maxErrorBody bounds what is read of a refusal.
const maxErrorBody = 64 << 10

// OpenAICompat is the synthesizer for one OpenAI-shaped speech endpoint.
type OpenAICompat struct {
	name, key, base, model string
	hc                     *http.Client
}

// NewOpenAICompat builds a synthesizer. base includes its version segment
// ("https://api.openai.com/v1"); empty is OpenAI's. key may be empty (the
// built-in engine). A nil hc is the BYOK egress client: SSRF-guarded, three
// minutes, which one turn of at most 90 words never needs.
func NewOpenAICompat(name, key, base, model string, hc *http.Client) *OpenAICompat {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		base = DefaultOpenAIBase
	}
	if hc == nil {
		hc = security.SafeBYOKClient(3 * time.Minute)
	}
	return &OpenAICompat{name: name, key: key, base: base, model: model, hc: hc}
}

var _ Synthesizer = (*OpenAICompat)(nil)

// Name is the engine's provider name ("openai", "openai_compat", "builtin").
func (c *OpenAICompat) Name() string { return c.name }

// Model is the model id this client sends.
func (c *OpenAICompat) Model() string { return c.model }

type speechRequest struct {
	Model          string  `json:"model"`
	Input          string  `json:"input"`
	Voice          string  `json:"voice"`
	ResponseFormat string  `json:"response_format"`
	Speed          float64 `json:"speed"`
}

// Synthesize speaks each turn in its speaker's voice and returns the PCM of
// all of them, in order, within maxPCM bytes in total.
func (c *OpenAICompat) Synthesize(ctx context.Context, turns []Turn, speakers []Speaker, maxPCM int64) ([]byte, error) {
	voices := make(map[string]string, len(speakers))
	fallback := ""
	for i, s := range speakers {
		voices[s.Name] = s.Voice
		if i == 0 {
			fallback = s.Voice
		}
	}
	var out []byte
	for _, t := range turns {
		if strings.TrimSpace(t.Text) == "" {
			continue
		}
		voice, ok := voices[t.Speaker]
		if !ok {
			voice = fallback
		}
		pcm, err := c.speak(ctx, t.Text, voice, maxPCM-int64(len(out)))
		if err != nil {
			return nil, err
		}
		out = append(out, pcm...)
	}
	return out, nil
}

// pingVoices are a voice each family is sure to have.
var pingVoices = map[string]string{FamilyKokoro: "af_heart", FamilyOpenAI: "alloy"}

// Ping synthesises one short sentence and accepts any readable audio.
func (c *OpenAICompat) Ping(ctx context.Context) error {
	_, err := c.speak(ctx, "Hello, this is a test.", pingVoices[Family(c.model)], 10*BytesPerSecond)
	return err
}

// speak is one request: one voice, one text, at most budget bytes of PCM.
func (c *OpenAICompat) speak(ctx context.Context, text, voice string, budget int64) ([]byte, error) {
	if budget <= 0 {
		return nil, ErrTooLong
	}
	raw, err := json.Marshal(speechRequest{Model: c.model, Input: text, Voice: voice, ResponseFormat: "pcm", Speed: 1.0})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/audio/speech", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("tts: request failed: %s", c.redact(err.Error()))
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		data, _, _ := blob.ReadAllLimited(resp.Body, maxErrorBody)
		msg := c.redact(string(data))
		if len(msg) > 600 {
			msg = msg[:600] + "…"
		}
		return nil, &providers.HTTPError{
			Status: resp.StatusCode, Body: msg,
			RetryAfter: providers.ParseRetryAfter(resp.Header.Get("Retry-After")),
		}
	}
	// A 200 that is JSON or a page is an error written by something in the
	// way (a gateway, a proxy), not audio.
	if ct, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type")); strings.HasPrefix(ct, "application/json") ||
		strings.HasPrefix(ct, "text/") {
		return nil, fmt.Errorf("%w: the answer was %s, not audio", ErrBadAudio, ct)
	}
	pcm, tooBig, err := blob.ReadAllLimited(resp.Body, budget)
	if err != nil {
		return nil, fmt.Errorf("tts: read response: %s", c.redact(err.Error()))
	}
	if tooBig {
		return nil, ErrTooLong
	}
	if len(pcm) == 0 {
		return nil, fmt.Errorf("%w: no audio in the response", ErrBadAudio)
	}
	if len(pcm)%2 != 0 {
		return nil, fmt.Errorf("%w: odd byte count for 16-bit audio", ErrBadAudio)
	}
	return pcm, nil
}

// redact removes the key from text that may echo it: a gateway's error page,
// a transport error. The key rides a header, never the URL, so this is the
// second line, not the first.
func (c *OpenAICompat) redact(s string) string {
	if c.key == "" {
		return s
	}
	return strings.ReplaceAll(s, c.key, "[redacted]")
}
