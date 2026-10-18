package embed

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

// embedTimeout bounds one embedding call. Embedding is fast — a batch is
// sub-second — so a long timeout here buys nothing and a short one turns a
// hanging endpoint into a prompt failure instead of a stalled ingest job.
const embedTimeout = 60 * time.Second

func newClient() *http.Client { return security.SafeBYOKClient(embedTimeout) }

// postJSON mirrors the parse package's helper: a non-200 becomes a
// providers.HTTPError so an embedding failure classifies through exactly the
// same cooldown rules as a chat failure.
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

func clip(s string) string {
	const max = 600
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
