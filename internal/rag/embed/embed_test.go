package embed

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

// task_type is the parameter that makes a question land near its answers rather
// than near other questions. Sending the wrong one degrades every search
// silently, so the mapping is behaviour, not a detail.
func TestGeminiEmbedderSendsTheRightTaskType(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")

	for _, tc := range []struct {
		task Task
		want string
	}{
		{TaskDocument, "RETRIEVAL_DOCUMENT"},
		{TaskQuery, "RETRIEVAL_QUERY"},
		// An unrecognised task falls back to the QUERY type, which is the safer
		// error: a query embedded as a document is one bad search, while a
		// corpus embedded as queries is a bad index.
		{Task("nonsense"), "RETRIEVAL_QUERY"},
	} {
		srv, captured, path := recorded(t, http.StatusOK, `{"embeddings":[{"values":[0.1,0.2,0.3]}]}`)
		e := NewGeminiEmbedder("k", srv.URL, "gemini-embedding-001", 0)
		if _, err := e.Embed(context.Background(), []string{"hello"}, tc.task); err != nil {
			t.Fatalf("embed: %v", err)
		}
		if !strings.Contains(string(*captured), tc.want) {
			t.Errorf("task %q did not send %s: %s", tc.task, tc.want, string(*captured))
		}
		if !strings.Contains(*path, ":batchEmbedContents") {
			t.Errorf("wrong endpoint: %s", *path)
		}
	}
}

// Zero dims means "not yet known" and must make the first call learn the
// model's native width rather than imposing one.
func TestEmbeddersOnlyPinAWidthOnceItIsKnown(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")

	srv, captured, _ := recorded(t, http.StatusOK, `{"embeddings":[{"values":[0.1,0.2,0.3]}]}`)
	if _, err := NewGeminiEmbedder("k", srv.URL, "m", 0).
		Embed(context.Background(), []string{"x"}, TaskQuery); err != nil {
		t.Fatalf("embed: %v", err)
	}
	if strings.Contains(string(*captured), "outputDimensionality") {
		t.Error("an unknown width was sent as a truncation instruction")
	}

	srv2, captured2, _ := recorded(t, http.StatusOK, `{"embeddings":[{"values":[0.1,0.2,0.3]}]}`)
	if _, err := NewGeminiEmbedder("k", srv2.URL, "m", 3).
		Embed(context.Background(), []string{"x"}, TaskQuery); err != nil {
		t.Fatalf("embed: %v", err)
	}
	if !strings.Contains(string(*captured2), `"outputDimensionality":3`) {
		t.Errorf("a pinned width was not sent: %s", string(*captured2))
	}
}

// A provider returning a different width than the one a knowledge base was
// built at must be an error, not a row of vectors nothing can compare.
func TestEmbedRejectsAWidthMismatch(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, _ := recorded(t, http.StatusOK, `{"embeddings":[{"values":[0.1,0.2]}]}`)

	_, err := NewGeminiEmbedder("k", srv.URL, "m", 3072).
		Embed(context.Background(), []string{"x"}, TaskDocument)
	if !errors.Is(err, ErrDimensionMismatch) {
		t.Fatalf("got %v, want ErrDimensionMismatch", err)
	}
}

// One vector per input, IN INPUT ORDER, is the contract phase 5 will chunk
// against. OpenAI returns an index; honouring it makes the contract true even
// if a provider ever answers out of order.
func TestOpenAIEmbedderPlacesVectorsByIndex(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, captured, path := recorded(t, http.StatusOK, `{"data":[
		{"index":2,"embedding":[3]},
		{"index":0,"embedding":[1]},
		{"index":1,"embedding":[2]}]}`)

	vecs, err := NewOpenAIEmbedder("k", srv.URL, "text-embedding-3-small", 0).
		Embed(context.Background(), []string{"a", "b", "c"}, TaskDocument)
	if err != nil {
		t.Fatalf("embed: %v", err)
	}
	if len(vecs) != 3 || vecs[0][0] != 1 || vecs[1][0] != 2 || vecs[2][0] != 3 {
		t.Fatalf("out-of-order response was not reordered: %v", vecs)
	}
	if !strings.HasSuffix(*path, "/embeddings") {
		t.Errorf("wrong endpoint: %s", *path)
	}
	var sent map[string]any
	if err := json.Unmarshal(*captured, &sent); err != nil {
		t.Fatalf("request was not JSON: %v", err)
	}
	if sent["model"] != "text-embedding-3-small" {
		t.Errorf("model not sent: %v", sent["model"])
	}
}

// A short response is a silent data-loss bug if it is accepted: the caller would
// pair chunk 3's text with chunk 2's vector.
func TestEmbedRejectsAShortResponse(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, _ := recorded(t, http.StatusOK, `{"data":[{"index":0,"embedding":[1]}]}`)

	if _, err := NewOpenAIEmbedder("k", srv.URL, "m", 0).
		Embed(context.Background(), []string{"a", "b"}, TaskDocument); err == nil {
		t.Fatal("a response with fewer vectors than inputs was accepted")
	}
}

// Embedding failures must classify through the same cooldown rules as chat.
func TestEmbedErrorsAreClassifiable(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, _ := recorded(t, http.StatusTooManyRequests, `{"error":{"message":"rate limit"}}`)

	_, err := NewOpenAIEmbedder("k", srv.URL, "m", 0).
		Embed(context.Background(), []string{"x"}, TaskDocument)
	var httpErr *providers.HTTPError
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusTooManyRequests {
		t.Fatalf("embed error is not a classifiable HTTPError: %v", err)
	}
}

// Ping reports the width from a REAL call, which is how a route entry learns
// what a knowledge base must be pinned to.
func TestPingReportsTheMeasuredWidth(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, _ := recorded(t, http.StatusOK, `{"embeddings":[{"values":[0.1,0.2,0.3,0.4]}]}`)

	dims, err := NewGeminiEmbedder("k", srv.URL, "m", 0).Ping(context.Background())
	if err != nil {
		t.Fatalf("ping: %v", err)
	}
	if dims != 4 {
		t.Fatalf("dims = %d, want 4", dims)
	}
}

func TestEmbedNormalisesAnUnversionedBaseURL(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	srv, _, path := recorded(t, http.StatusOK, `{"data":[{"index":0,"embedding":[1]}]}`)

	if _, err := NewOpenAIEmbedder("k", srv.URL+"/proxy", "m", 0).
		Embed(context.Background(), []string{"x"}, TaskQuery); err != nil {
		t.Fatalf("embed: %v", err)
	}
	if *path != "/proxy/v1/embeddings" {
		t.Fatalf("path = %q, want the version segment appended", *path)
	}
}
