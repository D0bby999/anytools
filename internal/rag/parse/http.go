package parse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
)

// generationTimeout bounds one parse call. The spike measured 75-201 seconds
// for a 10-page batch, so the budget is generous; the point of having one at
// all is that a provider which accepts the request and then never answers must
// not hold the job worker forever.
const generationTimeout = 300 * time.Second

// pingTimeout bounds a verify ping. A verify is a button press, so it fails in
// a time a person will wait rather than inheriting the generation budget.
const pingTimeout = 60 * time.Second

// newClient is the only place a parser gets an HTTP client, so no lane can
// accidentally use http.DefaultClient against a user-supplied base URL.
func newClient() *http.Client { return security.SafeBYOKClient(generationTimeout) }

// postJSON sends a JSON body and returns the raw response, turning a non-200
// into a providers.HTTPError so the BYOK chain classifies a parse failure with
// exactly the same rules as a chat failure — including Retry-After and the
// quota-versus-rate-limit distinction.
func postJSON(ctx context.Context, hc *http.Client, url string, body any, headers map[string]string) ([]byte, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Cap the read. A provider is not a trusted peer just because the user
	// pasted its URL, and an unbounded ReadAll on a hostile endpoint is an
	// out-of-memory kill.
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, &providers.HTTPError{
			Status:     resp.StatusCode,
			Body:       clip(string(raw)),
			RetryAfter: providers.ParseRetryAfter(resp.Header.Get("Retry-After")),
		}
	}
	return raw, nil
}

// clip bounds an error body so a provider cannot write a megabyte into a log
// line or an error string that reaches a response.
func clip(s string) string {
	const max = 600
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
