package youtube

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
)

// transcribe.go — a public video transcribed by the learner's own Gemini key.
//
// The production path on a VPS (owner's decision, 2026-09-27). YouTube refuses
// caption fetches from cloud addresses, but the Gemini API accepts a public
// YouTube URL as video input and Google fetches the video itself, so this
// server never touches YouTube for it.
//
// The wire shape is Gemini's native generateContent, NOT the OpenAI-compatible
// shim: the shim has no way to pass a file URI. Field names, from
// https://ai.google.dev/api/generate-content (read 2026-09-27):
//
//   - Part.fileData.fileUri — the watch URL (sent in proto snake_case,
//     `file_data.file_uri`, which the JSON mapping accepts and which the
//     existing parse lane already uses for `inline_data`);
//   - Part.videoMetadata.startOffset / endOffset — Duration strings ("1200s"),
//     for clipping a long video into windows;
//   - GenerationConfig.mediaResolution = MEDIA_RESOLUTION_LOW.
//
// Limits, from https://ai.google.dev/gemini-api/docs/video-understanding
// (read 2026-09-27): public videos only; the free tier transcribes at most 8
// hours of YouTube video a day; about 100 tokens per second at low media
// resolution; timestamps in the form MM:SS.

// TokensPerSecond is the documented cost at low media resolution.
const TokensPerSecond = 100

// FreeTierDailySeconds is the free tier's daily YouTube allowance.
const FreeTierDailySeconds = 8 * 3600

// Windowing: a video over an hour is transcribed in 20-minute windows, so one
// answer never has to carry an hour of text, and a retry re-pays for one
// window rather than the whole video.
const (
	singleCallLimit = 3600
	windowSeconds   = 1200
	// MaxTranscribeSeconds bounds one video's cost on the learner's key.
	MaxTranscribeSeconds = 4 * 3600
)

// ErrTooLong refuses a video longer than MaxTranscribeSeconds.
var ErrTooLong = fmt.Errorf("videos longer than %d hours cannot be transcribed", MaxTranscribeSeconds/3600)

// Window is a span of the video in seconds. End zero means "to the end".
type Window struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// Windows plans a transcription. An unknown duration (zero: the server could
// not ask YouTube) is one call over the whole video.
func Windows(durationSeconds int) ([]Window, error) {
	if durationSeconds > MaxTranscribeSeconds {
		return nil, ErrTooLong
	}
	if durationSeconds <= singleCallLimit {
		return []Window{{}}, nil
	}
	var out []Window
	for s := 0; s < durationSeconds; s += windowSeconds {
		out = append(out, Window{Start: s, End: min(s+windowSeconds, durationSeconds)})
	}
	return out, nil
}

// Part is one window's result.
type Part struct {
	Language string `json:"language,omitempty"`
	Cues     []Cue  `json:"cues"`
	Model    string `json:"model,omitempty"`
	// Engine is who heard the window when it was not Gemini reading the URL
	// (up-methods phase 21): "builtin", or a speech provider's name.
	Engine       string `json:"engine,omitempty"`
	InputTokens  int    `json:"input_tokens,omitempty"`
	OutputTokens int    `json:"output_tokens,omitempty"`
}

// Transcriber transcribes one window of a public video.
type Transcriber interface {
	TranscribeWindow(ctx context.Context, id string, w Window) (*Part, error)
	Model() string
}

// DefaultGeminiBase matches internal/rag/parse's.
const DefaultGeminiBase = "https://generativelanguage.googleapis.com/v1beta"

// Gemini is the native-API transcriber for one API-key connection.
type Gemini struct {
	key, base, model string
	hc               *http.Client
}

// NewGemini builds a transcriber. base may be empty for Google's endpoint.
func NewGemini(key, base, model string) *Gemini {
	b := security.NormalizeAPIBase(base, "v1beta")
	if b == "" {
		b = DefaultGeminiBase
	}
	// Minutes, not seconds: Google fetches and watches the video before it
	// answers. SafeBYOKClient, like every provider call.
	return &Gemini{key: key, base: b, model: model, hc: security.SafeBYOKClient(10 * time.Minute)}
}

// Model is the model id this transcriber calls.
func (g *Gemini) Model() string { return g.model }

// Prompt is the instruction. It follows the documented advice to put the text
// after the video part.
func Prompt(w Window) string {
	span := "the whole video"
	if w.End > 0 {
		span = fmt.Sprintf("the part of the video from %s to %s", FormatClock(float64(w.Start)), FormatClock(float64(w.End)))
	}
	return "Transcribe the speech in " + span + ` verbatim, in the language it is spoken in. Do not translate, summarise, or describe what is on screen.
Answer with JSON only, in exactly this shape:
{"language": "<BCP-47 code of the spoken language>", "cues": [{"start": "MM:SS", "text": "<what was said>"}]}
Use "H:MM:SS" for times of an hour or more. Every "start" is measured from the beginning of the whole video, not from the beginning of this part. One cue per sentence or short phrase, in order. If nothing is spoken, answer {"language": "", "cues": []}.`
}

// RequestBody is the generateContent body for one window. Exported so the
// recorded-shape test compares it with testdata/gemini_request.json.
func RequestBody(id string, w Window) map[string]any {
	return requestBody(map[string]any{"file_uri": WatchURL(id)}, true, w)
}

// FileRequestBody is the same request for a file the learner uploaded to
// Gemini's Files API (up-methods phase 15): the same prompt, with
// file_data naming the uploaded file. Gemini documents start and end
// offsets for video only, so an audio file's window is asked for by the
// prompt alone, and ParseGeminiResponse keeps what falls inside it.
func FileRequestBody(fileURI, mime string, w Window) map[string]any {
	return requestBody(map[string]any{"file_uri": fileURI, "mime_type": mime}, strings.HasPrefix(mime, "video/"), w)
}

func requestBody(fileData map[string]any, clip bool, w Window) map[string]any {
	video := map[string]any{"file_data": fileData}
	if w.End > 0 && clip {
		video["video_metadata"] = map[string]any{
			"start_offset": fmt.Sprintf("%ds", w.Start),
			"end_offset":   fmt.Sprintf("%ds", w.End),
		}
	}
	return map[string]any{
		"contents": []any{map[string]any{"role": "user", "parts": []any{
			video,
			map[string]any{"text": Prompt(w)},
		}}},
		"generationConfig": map[string]any{
			"mediaResolution":  "MEDIA_RESOLUTION_LOW",
			"responseMimeType": "application/json",
			"temperature":      0,
			"maxOutputTokens":  65536,
		},
	}
}

// maxResponse bounds the read of Google's answer. A 20-minute window of
// speech is well under a megabyte of JSON.
const maxResponse = 8 << 20

// TranscribeWindow calls generateContent for one window.
//
// A non-200 is a providers.HTTPError, so the BYOK chain classifies it exactly
// as it classifies a parse failure (Retry-After, quota versus rate limit), and
// the job can tell a refused request (4xx: a private video, a bad key) from a
// transient one.
func (g *Gemini) TranscribeWindow(ctx context.Context, id string, w Window) (*Part, error) {
	if !ValidID(id) {
		return nil, errors.New("youtube: invalid id")
	}
	return g.generate(ctx, RequestBody(id, w), w)
}

// TranscribeFile runs the same windowed prompt on a file uploaded to
// Gemini's Files API (up-methods phase 15). fileURI is the one the Files
// API returned for that upload, under this transcriber's own base.
func (g *Gemini) TranscribeFile(ctx context.Context, fileURI, mime string, w Window) (*Part, error) {
	if !strings.HasPrefix(fileURI, g.base+"/files/") {
		return nil, errors.New("gemini: the file is not on this connection's endpoint")
	}
	return g.generate(ctx, FileRequestBody(fileURI, mime, w), w)
}

func (g *Gemini) generate(ctx context.Context, body map[string]any, w Window) (*Part, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		g.base+"/models/"+g.model+":generateContent", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", g.key)

	resp, err := g.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gemini: transcribe: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil {
		return nil, fmt.Errorf("gemini: transcribe: %w", err)
	}
	if len(raw) > maxResponse {
		return nil, errors.New("gemini: transcript response too large")
	}
	if resp.StatusCode != http.StatusOK {
		body := string(raw)
		if g.key != "" {
			body = strings.ReplaceAll(body, g.key, "[redacted]")
		}
		if len(body) > 600 {
			body = body[:600] + "…"
		}
		return nil, &providers.HTTPError{Status: resp.StatusCode, Body: body,
			RetryAfter: providers.ParseRetryAfter(resp.Header.Get("Retry-After"))}
	}
	part, err := ParseGeminiResponse(raw, w)
	if err != nil {
		return nil, err
	}
	part.Model = g.model
	return part, nil
}

// Base is the API base this transcriber calls, for the Files API client that
// uploads under the same connection.
func (g *Gemini) Base() string { return g.base }

// ErrNoTranscript is a 200 that carried no usable transcript: a refusal, a
// safety block, or JSON that is not the shape asked for.
var ErrNoTranscript = errors.New("gemini returned no usable transcript")

// ParseGeminiResponse reads a generateContent answer into cues, repairing what
// can be repaired: fenced JSON, cues out of order, a time outside the window,
// a timestamp that is not a timestamp. What cannot be repaired is refused:
// no candidate, no cues, or more than MaxCues.
func ParseGeminiResponse(raw []byte, w Window) (*Part, error) {
	var r struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text    string `json:"text"`
					Thought bool   `json:"thought"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(raw, &r); err != nil || len(r.Candidates) == 0 {
		return nil, ErrNoTranscript
	}
	var text strings.Builder
	for _, p := range r.Candidates[0].Content.Parts {
		if !p.Thought {
			text.WriteString(p.Text)
		}
	}
	body := strings.TrimSpace(text.String())
	body = strings.TrimPrefix(strings.TrimPrefix(body, "```json"), "```")
	body = strings.TrimSpace(strings.TrimSuffix(body, "```"))

	var out struct {
		Language string `json:"language"`
		Cues     []struct {
			Start json.RawMessage `json:"start"`
			Text  string          `json:"text"`
		} `json:"cues"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		if r.Candidates[0].FinishReason == "MAX_TOKENS" {
			return nil, fmt.Errorf("%w: the answer was cut off", ErrNoTranscript)
		}
		return nil, ErrNoTranscript
	}
	if len(out.Cues) > MaxCues {
		return nil, ErrTranscriptTooLarge
	}

	cues := make([]Cue, 0, len(out.Cues))
	relative := w.Start > 0
	for _, c := range out.Cues {
		sec, ok := cueSeconds(c.Start)
		if !ok {
			continue
		}
		cues = append(cues, Cue{Start: sec, End: -1, Text: c.Text})
		if sec >= float64(w.Start) {
			relative = false
		}
	}
	// A window's cues all earlier than the window's start were measured from
	// the clip, despite the prompt: shift them into the video's time.
	if relative {
		for i := range cues {
			cues[i].Start += float64(w.Start)
		}
	}
	if w.End > 0 {
		kept := cues[:0]
		for _, c := range cues {
			if c.Start >= float64(w.Start)-1 && c.Start <= float64(w.End)+1 {
				kept = append(kept, c)
			}
		}
		cues = kept
	}
	cues, err := Normalize(cues)
	if err != nil {
		return nil, err
	}
	return &Part{
		Language:     strings.TrimSpace(out.Language),
		Cues:         cues,
		InputTokens:  r.UsageMetadata.PromptTokenCount,
		OutputTokens: r.UsageMetadata.CandidatesTokenCount,
	}, nil
}

// cueSeconds accepts "MM:SS", "H:MM:SS" or a bare number of seconds.
func cueSeconds(raw json.RawMessage) (float64, bool) {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return ParseClock(s)
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil && f >= 0 {
		return f, true
	}
	return 0, false
}

// Merge joins the windows of one video, in order, through the same repair.
func Merge(parts []*Part) (*Transcript, error) {
	t := &Transcript{Timed: true}
	var all []Cue
	for _, p := range parts {
		if p == nil {
			continue
		}
		if t.Language == "" {
			t.Language = p.Language
		}
		all = append(all, p.Cues...)
	}
	cues, err := Normalize(all)
	if err != nil {
		return nil, err
	}
	t.Cues = cues
	return t, nil
}
