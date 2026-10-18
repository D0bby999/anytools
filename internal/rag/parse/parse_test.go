package parse

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
)

// The verify probe is a PDF this code generates, so it has to actually BE one:
// a malformed probe would fail verification against a working key and send the
// user hunting for a problem with their account.
func TestProbePDFIsWellFormed(t *testing.T) {
	data := probePDF()

	if !strings.HasPrefix(string(data), "%PDF-1.4\n") {
		t.Fatal("no PDF header")
	}
	if !strings.HasSuffix(string(data), "%%EOF\n") {
		t.Fatal("no EOF marker")
	}
	if !strings.Contains(string(data), pingProbeText) {
		t.Fatalf("the probe does not contain %q, so checkPing could never pass", pingProbeText)
	}

	// The xref offsets must point at the objects they claim to. A PDF with a
	// wrong xref is exactly the file that works in one reader and fails in the
	// next, which would make this lane's verification provider-dependent.
	body := string(data)
	idx := strings.Index(body, "\nxref\n")
	if idx < 0 {
		t.Fatal("no xref table")
	}
	lines := strings.Split(body[idx+len("\nxref\n"):], "\n")
	// lines[0] is "0 N", lines[1] is the free entry, then one per object.
	for i := 2; i < len(lines) && strings.HasSuffix(lines[i], " 00000 n "); i++ {
		var offset int
		if _, err := fmtSscan(lines[i][:10], &offset); err != nil {
			t.Fatalf("unparseable xref entry %q", lines[i])
		}
		objNum := i - 1
		want := itoa(objNum) + " 0 obj"
		if offset >= len(body) || !strings.HasPrefix(body[offset:], want) {
			t.Fatalf("xref entry %d points at offset %d, which is not %q", objNum, offset, want)
		}
	}
}

func fmtSscan(s string, out *int) (int, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, errors.New("not a number")
		}
		n = n*10 + int(c-'0')
	}
	*out = n
	return 1, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// recorded is a fixture server: one canned response, and a record of the
// request that asked for it.
func recorded(t *testing.T, status int, body string) (*httptest.Server, *[]byte, *string) {
	t.Helper()
	var captured []byte
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured, _ = io.ReadAll(r.Body)
		path = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &captured, &path
}

func TestGeminiParserSendsInlinePDFAndReadsTheMarkers(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, captured, path := recorded(t, http.StatusOK, `{
		"candidates":[{"content":{"parts":[{"text":"<!-- page: 7 -->\nBody text."}]},"finishReason":"STOP"}],
		"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":20}}`)

	p := NewGeminiParser("k", srv.URL, "gemini-3.6-flash")
	res, err := p.ParsePages(context.Background(), []byte("%PDF-1.4 fake"), 7, 7)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if res.Truncated {
		t.Error("finishReason STOP was read as truncated")
	}
	if !strings.Contains(res.Markdown, "<!-- page: 7 -->") {
		t.Errorf("markers lost: %q", res.Markdown)
	}
	if res.InputTokens != 100 || res.OutputTokens != 20 {
		t.Errorf("usage not read: %+v", res)
	}
	if !strings.Contains(*path, ":generateContent") {
		t.Errorf("wrong endpoint: %s", *path)
	}

	var sent map[string]any
	if err := json.Unmarshal(*captured, &sent); err != nil {
		t.Fatalf("request was not JSON: %v", err)
	}
	// The absolute page numbers must be STATED to the model — that is what makes
	// the page markers the splitter's numbers rather than the model's count, and
	// it is why page attribution survived ten forced truncations in the spike.
	body := string(*captured)
	if !strings.Contains(body, "pages 7 through 7") {
		t.Error("the prompt did not state the absolute page range")
	}
	if !strings.Contains(body, "inline_data") {
		t.Error("the PDF was not sent as inline data")
	}
}

func TestGeminiParserReportsTruncation(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, _ := recorded(t, http.StatusOK, `{
		"candidates":[{"content":{"parts":[{"text":"partial"}]},"finishReason":"MAX_TOKENS"}]}`)

	res, err := NewGeminiParser("k", srv.URL, "m").ParsePages(context.Background(), []byte("x"), 1, 10)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !res.Truncated {
		t.Fatal("MAX_TOKENS was not reported as truncated — phase 5's halving retry depends on this flag")
	}
}

// A 200 with no candidate is a refusal or a safety block. Returning it as an
// empty-but-successful parse would store a blank page as if it were the document.
func TestGeminiParserRejectsAResponseWithNoCandidate(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, _ := recorded(t, http.StatusOK, `{"candidates":[]}`)

	_, err := NewGeminiParser("k", srv.URL, "m").ParsePages(context.Background(), []byte("x"), 1, 1)
	if err == nil {
		t.Fatal("an empty candidate list was accepted as a parse")
	}
}

// A provider error must arrive as a providers.HTTPError so the BYOK chain
// classifies a parse failure with the same cooldown rules as a chat failure.
func TestParseErrorsAreClassifiable(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, _ := recorded(t, http.StatusTooManyRequests, `{"error":{"message":"quota exceeded"}}`)

	_, err := NewGeminiParser("k", srv.URL, "m").ParsePages(context.Background(), []byte("x"), 1, 1)
	var httpErr *providers.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("parse error is not an HTTPError: %v", err)
	}
	if httpErr.Status != http.StatusTooManyRequests {
		t.Fatalf("status = %d", httpErr.Status)
	}
	cd := providers.ClassifyProviderError(err, 0)
	if !cd.QuotaExhausted {
		t.Fatal("a quota-exceeded parse failure did not classify as quota exhaustion")
	}
}

func TestOpenAIParserUsesTheResponsesFileShape(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, captured, path := recorded(t, http.StatusOK, `{
		"status":"completed",
		"output":[{"type":"message","content":[{"type":"output_text","text":"<!-- page: 1 -->\nHello."}]}],
		"usage":{"input_tokens":5,"output_tokens":6}}`)

	res, err := NewOpenAIParser("k", srv.URL, "gpt-4o").ParsePages(context.Background(), []byte("x"), 1, 1)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if res.Truncated || res.Markdown == "" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if !strings.HasSuffix(*path, "/responses") {
		t.Errorf("wrong endpoint: %s", *path)
	}
	body := string(*captured)
	if !strings.Contains(body, `"type":"input_file"`) {
		t.Error("the PDF was not sent as an input_file part")
	}
	if !strings.Contains(body, "data:application/pdf;base64,") {
		t.Error("the file was not sent as a data URI, which is what the Responses API takes")
	}
}

func TestOpenAIParserTreatsAnIncompleteStatusAsTruncated(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, _ := recorded(t, http.StatusOK, `{
		"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},
		"output":[{"type":"message","content":[{"type":"output_text","text":"half"}]}]}`)

	res, err := NewOpenAIParser("k", srv.URL, "m").ParsePages(context.Background(), []byte("x"), 1, 1)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !res.Truncated {
		t.Fatal("status=incomplete was not reported as truncated")
	}
	if !strings.Contains(res.FinishReason, "max_output_tokens") {
		t.Errorf("the reason was lost: %q", res.FinishReason)
	}
}

func TestAnthropicParserUsesTheDocumentBlock(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, captured, path := recorded(t, http.StatusOK, `{
		"stop_reason":"end_turn",
		"content":[{"type":"text","text":"<!-- page: 1 -->\nHello."}],
		"usage":{"input_tokens":5,"output_tokens":6}}`)

	res, err := NewAnthropicParser("k", srv.URL, "claude").ParsePages(context.Background(), []byte("x"), 1, 1)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if res.Truncated {
		t.Error("end_turn was read as truncated")
	}
	if !strings.HasSuffix(*path, "/messages") {
		t.Errorf("wrong endpoint: %s", *path)
	}
	if !strings.Contains(string(*captured), `"type":"document"`) {
		t.Error("the PDF was not sent as a document content block")
	}
}

// The measured silent failure: a base URL without its version segment answers
// HTTP 200 with an empty body. The base must be normalised before it is used.
func TestParserNormalisesAnUnversionedBaseURL(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, path := recorded(t, http.StatusOK, `{"stop_reason":"end_turn","content":[{"type":"text","text":"x"}]}`)

	// A proxy base with no /v1, which is exactly the shape that returned an
	// empty 200 when measured on 2026-09-16.
	_, err := NewAnthropicParser("k", srv.URL+"/api/anthropic", "m").ParsePages(context.Background(), []byte("x"), 1, 1)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if *path != "/api/anthropic/v1/messages" {
		t.Fatalf("path = %q, want the version segment appended", *path)
	}
}

// A verify ping must assert on CONTENT. A ping that accepted any 200 would mark
// a silently-empty endpoint as a working connection.
func TestCheckPingRejectsAnEmptyOrWrongAnswer(t *testing.T) {
	if err := checkPing("gemini", Result{Markdown: "   "}, nil); err == nil {
		t.Error("an empty document passed the ping")
	}
	if err := checkPing("gemini", Result{Markdown: "something else entirely"}, nil); err == nil {
		t.Error("a document without the probe text passed the ping")
	}
	if err := checkPing("gemini", Result{Markdown: "<!-- page: 1 -->\nAnyTools verify page"}, nil); err != nil {
		t.Errorf("a correct answer failed the ping: %v", err)
	}
}
