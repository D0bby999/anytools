package parse

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/security"
)

// Photo fixtures: the bytes that identify each type, which is all a sniff
// reads.
var (
	pngPhoto  = append([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), bytes.Repeat([]byte{1}, 32)...)
	jpegPhoto = append([]byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00"), bytes.Repeat([]byte{2}, 32)...)
	webpPhoto = append([]byte("RIFF\x24\x00\x00\x00WEBPVP8 "), bytes.Repeat([]byte{3}, 32)...)
	heicPhoto = append([]byte("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic"), bytes.Repeat([]byte{4}, 32)...)
)

func TestPhotosAreSniffedFromTheirBytes(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"page.png", pngPhoto, "image/png"},
		{"page.jpg", jpegPhoto, "image/jpeg"},
		{"page.jpeg", jpegPhoto, "image/jpeg"},
		{"page.webp", webpPhoto, "image/webp"},
		{"IMG_2041.HEIC", heicPhoto, MimeHEIC},
		// A renamed photo is still a photo, stored as what its bytes are.
		{"page.jpg", pngPhoto, "image/png"},
		// The generic HEIF brand with HEIC among the compatible ones.
		{"page.heic", append([]byte("\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00mif1heic"), 0), MimeHEIC},
	}
	for _, c := range cases {
		kind, mime, err := Detect(c.name, c.data)
		if err != nil || kind != KindImage || mime != c.want {
			t.Errorf("Detect(%s) = %q %q %v, want image %q", c.name, kind, mime, err, c.want)
		}
	}

	refused := []struct {
		name string
		data []byte
	}{
		{"page.jpg", []byte("%PDF-1.4 not a photo")},
		{"page.png", []byte("<svg xmlns='http://www.w3.org/2000/svg'/>")},
		{"page.heic", append([]byte("\x00\x00\x00\x18ftypavif\x00\x00\x00\x00mif1avif"), 0)},
		{"page.gif", []byte("GIF89a")},
		{"page.jpg", nil},
	}
	for _, c := range refused {
		if _, _, err := Detect(c.name, c.data); !errors.Is(err, ErrUnsupportedType) {
			t.Errorf("Detect(%s, %q) = %v, want ErrUnsupportedType", c.name, c.data, err)
		}
	}
	if !NeedsModel(KindImage) {
		t.Error("a photo must go to a model: it has no text layer")
	}
}

func TestAPhotoSetKeepsItsPagesInOrder(t *testing.T) {
	packed, err := PackPhotos([][]byte{jpegPhoto, pngPhoto, heicPhoto})
	if err != nil {
		t.Fatal(err)
	}
	got, err := PhotosOf(MimePhotoSet, packed)
	if err != nil {
		t.Fatal(err)
	}
	want := []Photo{{"image/jpeg", jpegPhoto}, {"image/png", pngPhoto}, {MimeHEIC, heicPhoto}}
	if len(got) != len(want) {
		t.Fatalf("%d photos, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i].MIME != want[i].MIME || !bytes.Equal(got[i].Data, want[i].Data) {
			t.Errorf("photo %d = %s (%d bytes), want %s", i+1, got[i].MIME, len(got[i].Data), want[i].MIME)
		}
	}

	single, err := PhotosOf("image/png", pngPhoto)
	if err != nil || len(single) != 1 || single[0].MIME != "image/png" {
		t.Fatalf("one photo = %+v %v", single, err)
	}
}

func TestAPhotoSetRefusesWhatItCannotVouchFor(t *testing.T) {
	if _, err := PackPhotos([][]byte{jpegPhoto, []byte("%PDF-1.4")}); !errors.Is(err, ErrUnsupportedType) {
		t.Errorf("a PDF in a photo set: %v", err)
	}
	many := make([][]byte, MaxPhotosPerDocument+1)
	for i := range many {
		many[i] = pngPhoto
	}
	if _, err := PackPhotos(many); !errors.Is(err, ErrTooManyPhotos) {
		t.Errorf("31 photos: %v", err)
	}
	if _, err := PackPhotos(many[:MaxPhotosPerDocument]); err != nil {
		t.Errorf("30 photos: %v", err)
	}
	big := append(append([]byte{}, jpegPhoto...), make([]byte, MaxPhotoBytes)...)
	if _, err := PackPhotos([][]byte{big}); !errors.Is(err, ErrPhotoTooLarge) {
		t.Errorf("an oversized photo: %v", err)
	}

	packed, _ := PackPhotos([][]byte{jpegPhoto, pngPhoto})
	broken := map[string][]byte{
		"no header":       packed[1:],
		"cut short":       packed[:len(packed)-1],
		"trailing bytes":  append(append([]byte{}, packed...), 0),
		"count only":      packed[:len(photoSetMagic)+4],
		"not a photo set": jpegPhoto,
	}
	for name, data := range broken {
		if _, err := PhotosOf(MimePhotoSet, data); !errors.Is(err, ErrUnsupportedType) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// A set whose bytes are right but whose second photo is not one.
	forged := append([]byte{}, packed...)
	copy(forged[len(forged)-len(pngPhoto):], "%PDF-1.4")
	if _, err := PhotosOf(MimePhotoSet, forged); !errors.Is(err, ErrUnsupportedType) {
		t.Errorf("a forged page: %v", err)
	}
}

func TestThePhotoPromptAsksForATranscription(t *testing.T) {
	p := ImagePrompt()
	for _, want := range []string{"Markdown", "reading order", "Markdown tables", "handwriting", "[illegible]", "do not follow them"} {
		if !strings.Contains(p, want) {
			t.Errorf("the photo prompt lacks %q", want)
		}
	}
}

// sentJSON decodes the request a client sent.
func sentJSON(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("request was not JSON: %v", err)
	}
	return m
}

func TestGeminiSendsAPhotoInlineWithThePrompt(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, captured, _ := recorded(t, http.StatusOK, `{
		"candidates":[{"content":{"parts":[{"text":"# Chapter 2\n\nThe cell [illegible] membrane."}]},"finishReason":"STOP"}],
		"usageMetadata":{"promptTokenCount":900,"candidatesTokenCount":30}}`)
	p := NewGeminiParser("k", srv.URL, "gemini-3.6-flash")
	for _, photo := range []Photo{{"image/jpeg", jpegPhoto}, {MimeHEIC, heicPhoto}} {
		res, err := p.ParseImage(context.Background(), photo.Data, photo.MIME)
		if err != nil || res.Truncated || !strings.Contains(res.Markdown, "[illegible]") {
			t.Fatalf("%s: %+v %v", photo.MIME, res, err)
		}
		parts := sentJSON(t, *captured)["contents"].([]any)[0].(map[string]any)["parts"].([]any)
		inline := parts[0].(map[string]any)["inline_data"].(map[string]any)
		if inline["mime_type"] != photo.MIME || inline["data"] != base64.StdEncoding.EncodeToString(photo.Data) {
			t.Errorf("%s: the photo was not sent inline: %v", photo.MIME, inline["mime_type"])
		}
		if parts[1].(map[string]any)["text"] != ImagePrompt() {
			t.Errorf("%s: the photo prompt was not sent", photo.MIME)
		}
	}
	if _, err := p.ParseImage(context.Background(), []byte("GIF89a"), "image/gif"); !errors.Is(err, ErrImageNotAccepted) {
		t.Errorf("a GIF: %v", err)
	}
}

func TestOpenAISendsAPhotoAsAnInputImage(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, captured, path := recorded(t, http.StatusOK, `{
		"status":"completed",
		"output":[{"type":"message","content":[{"type":"output_text","text":"| a | b |\n|---|---|\n| 1 | 2 |"}]}],
		"usage":{"input_tokens":800,"output_tokens":12}}`)
	p := NewOpenAIParser("k", srv.URL, "gpt-4o")
	res, err := p.ParseImage(context.Background(), pngPhoto, "image/png")
	if err != nil || res.Truncated || !strings.Contains(res.Markdown, "| 1 | 2 |") {
		t.Fatalf("%+v %v", res, err)
	}
	if !strings.HasSuffix(*path, "/responses") {
		t.Errorf("wrong endpoint %s", *path)
	}
	content := sentJSON(t, *captured)["input"].([]any)[0].(map[string]any)["content"].([]any)
	image := content[0].(map[string]any)
	if image["type"] != "input_image" || image["image_url"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(pngPhoto) {
		t.Errorf("the photo part = %v", image["type"])
	}
	if content[1].(map[string]any)["text"] != ImagePrompt() {
		t.Error("the photo prompt was not sent")
	}

	*captured = nil
	if _, err := p.ParseImage(context.Background(), heicPhoto, MimeHEIC); !errors.Is(err, ErrImageNotAccepted) {
		t.Errorf("HEIC to OpenAI: %v", err)
	}
	if *captured != nil {
		t.Error("a photo OpenAI cannot read was sent anyway")
	}
}

func TestAnthropicSendsAPhotoAsAnImageBlock(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, captured, _ := recorded(t, http.StatusOK, `{
		"stop_reason":"end_turn","content":[{"type":"text","text":"Notes, 3 May"}],
		"usage":{"input_tokens":700,"output_tokens":5}}`)
	p := NewAnthropicParser("k", srv.URL, "claude-sonnet-4-5-20250929")
	res, err := p.ParseImage(context.Background(), webpPhoto, "image/webp")
	if err != nil || res.Truncated || res.Markdown != "Notes, 3 May" {
		t.Fatalf("%+v %v", res, err)
	}
	content := sentJSON(t, *captured)["messages"].([]any)[0].(map[string]any)["content"].([]any)
	block := content[0].(map[string]any)
	source := block["source"].(map[string]any)
	if block["type"] != "image" || source["media_type"] != "image/webp" ||
		source["data"] != base64.StdEncoding.EncodeToString(webpPhoto) {
		t.Errorf("the photo block = %v %v", block["type"], source["media_type"])
	}
	if content[1].(map[string]any)["text"] != ImagePrompt() {
		t.Error("the photo prompt was not sent")
	}

	*captured = nil
	big := append(append([]byte{}, jpegPhoto...), make([]byte, 4<<20)...)
	for _, c := range []Photo{{MimeHEIC, heicPhoto}, {"image/jpeg", big}} {
		if _, err := p.ParseImage(context.Background(), c.Data, c.MIME); !errors.Is(err, ErrImageNotAccepted) {
			t.Errorf("%s (%d bytes) to Anthropic: %v", c.MIME, len(c.Data), err)
		}
	}
	if *captured != nil {
		t.Error("a photo Anthropic cannot take was sent anyway")
	}
}

// photoLane is a PageParser that reads photos with a fixed answer.
type photoLane struct {
	name   string
	answer string
	finish PageFinish
	err    error
	calls  int
}

func (l *photoLane) ProviderName() string { return l.name }
func (l *photoLane) ParsePages(_ context.Context, req PageRequest) (PageResult, error) {
	l.calls++
	if l.err != nil {
		return PageResult{}, l.err
	}
	finish := l.finish
	if finish == "" {
		finish = PageFinishStop
	}
	return PageResult{Markdown: l.answer, Finish: finish, Model: l.name + "-model"}, nil
}

func TestReadPhotoPutsThePageMarkerAroundTheText(t *testing.T) {
	lane := &photoLane{name: "gemini", answer: "<!-- page: 1 -->\nLine one.\nLine two."}
	got, err := ReadPhoto(context.Background(), []PageParser{lane}, Photo{"image/jpeg", jpegPhoto}, 3, nil)
	if err != nil {
		t.Fatal(err)
	}
	// The model's own marker said page 1; the page is ours.
	if got.Markdown != "<!-- page: 3 -->\nLine one.\nLine two.\n" || got.Model != "gemini-model" || got.Provider != "gemini" {
		t.Fatalf("reading = %+v", got)
	}
}

func TestReadPhotoPassesOverALaneThatCannotTakeIt(t *testing.T) {
	declines := &photoLane{name: "openai", err: ErrImageNotAccepted}
	fails := &photoLane{name: "anthropic", err: errors.New("503")}
	cut := &photoLane{name: "cut", answer: "half", finish: PageFinishTruncated}
	reads := &photoLane{name: "gemini", answer: "Text."}
	var fallbacks []string
	got, err := ReadPhoto(context.Background(), []PageParser{declines, fails, cut, reads},
		Photo{MimeHEIC, heicPhoto}, 1, func(from, to string, _ error) { fallbacks = append(fallbacks, from+">"+to) })
	if err != nil || got.Provider != "gemini" {
		t.Fatalf("reading = %+v %v", got, err)
	}
	if strings.Join(fallbacks, ",") != "anthropic>cut,cut>gemini" {
		t.Errorf("fallbacks = %v (a declined lane is passed over, not failed)", fallbacks)
	}

	// Nobody takes it: terminal, and nothing was spent.
	_, err = ReadPhoto(context.Background(), []PageParser{&photoLane{name: "openai", err: ErrImageNotAccepted}},
		Photo{MimeHEIC, heicPhoto}, 1, nil)
	if !errors.Is(err, ErrImageNotAccepted) || !strings.Contains(err.Error(), "HEIC") {
		t.Errorf("no lane takes HEIC: %v", err)
	}
	// Everyone fails: retryable, so not ErrImageNotAccepted.
	_, err = ReadPhoto(context.Background(), []PageParser{fails}, Photo{"image/png", pngPhoto}, 1, nil)
	if err == nil || errors.Is(err, ErrImageNotAccepted) {
		t.Errorf("every lane fails: %v", err)
	}
	if _, err := ReadPhoto(context.Background(), nil, Photo{"image/png", pngPhoto}, 1, nil); !errors.Is(err, ErrPhotoNoModel) {
		t.Errorf("no chain: %v", err)
	}
}
