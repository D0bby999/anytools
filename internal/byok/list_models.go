package byok

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
)

// maxListedModels caps a provider's list: gateways publish thousands, and the
// picker searches what it is given.
const maxListedModels = 1000

// maxModelID bounds one model id, listed or added by hand.
const maxModelID = 200

// listModelsFor asks the provider which models this key may actually call
// (plan 261021-1100 phase 4).
//
//   - Gemini: its native list, filtered to models that generate content.
//   - Anthropic: GET /v1/models with the key.
//   - OpenAI, OpenRouter, every preset and a custom endpoint: the OpenAI
//     shape, GET {base}/models with the key as a bearer token.
//
// Subscription lanes publish no list a token can read. Every call goes through
// the SSRF-safe client, and a provider's own error body is never passed on.
func listModelsFor(ctx context.Context, conn *store.ProviderConnection) ([]string, error) {
	if conn.Kind != store.KindAPIKey {
		return nil, invalid("a subscription sign-in does not publish a model list")
	}
	switch conn.Provider {
	case providers.ProviderGemini:
		return parse.GeminiListModels(ctx, conn.Secret, conn.APIBase)
	case providers.ProviderAnthropic:
		base := normalizeBaseFor(conn.Provider, conn.APIBase)
		if base == "" {
			base = "https://api.anthropic.com/v1"
		}
		return fetchModelIDs(ctx, base+"/models?limit=1000", map[string]string{
			"x-api-key": conn.Secret, "anthropic-version": "2023-06-01",
		})
	}
	base := modelListBase(conn)
	if base == "" {
		return nil, invalid("this connection has no address to ask for its models")
	}
	return fetchModelIDs(ctx, base+"/models", map[string]string{"Authorization": "Bearer " + conn.Secret})
}

// modelListBase is the OpenAI-shaped base a connection's chat is served on.
func modelListBase(conn *store.ProviderConnection) string {
	switch conn.Provider {
	case providers.ProviderOpenAI:
		if base := normalizeBaseFor(conn.Provider, conn.APIBase); base != "" {
			return base
		}
		return "https://api.openai.com/v1"
	case providers.ProviderOpenRouter:
		if base := normalizeBaseFor(conn.Provider, conn.APIBase); base != "" {
			return base
		}
		return "https://openrouter.ai/api/v1"
	case providers.ProviderOpenAICompat:
		return normalizeBaseFor(conn.Provider, conn.APIBase)
	}
	if _, ok := presetOf(conn.Provider); ok {
		return presetBase(conn.Provider, conn.APIBase)
	}
	return ""
}

// fetchModelIDs reads `{"data":[{"id":…}]}`, the shape OpenAI and Anthropic
// share, and returns the ids sorted.
func fetchModelIDs(ctx context.Context, url string, headers map[string]string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, invalid("this connection's address is not a valid URL")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := security.SafeBYOKClient(30 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("byok: list models: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// The body is kept for looksLikeBadCredential and never shown.
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		if resp.StatusCode == http.StatusNotFound {
			return nil, ErrNoModelList
		}
		return nil, &providers.HTTPError{Status: resp.StatusCode, Body: string(raw)}
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&body); err != nil {
		return nil, fmt.Errorf("byok: decode model list: %w", err)
	}
	seen := map[string]bool{}
	out := []string{}
	for _, m := range body.Data {
		if m.ID == "" || seen[m.ID] || len(m.ID) > maxModelID {
			continue
		}
		seen[m.ID] = true
		out = append(out, m.ID)
	}
	sort.Strings(out)
	if len(out) > maxListedModels {
		out = out[:maxListedModels]
	}
	return out, nil
}

// ErrNoModelList is a provider that answers 404 on /models: it serves chat
// but does not publish a list, so the learner names a model by hand.
var ErrNoModelList = errors.New("byok: the provider does not publish a model list")

// ModelList is a connection's models: what the provider lists for the key,
// and what the learner added by hand.
type ModelList struct {
	Listed []string `json:"models"`
	Custom []string `json:"custom"`
	// ListError says why the provider's list is missing, in a sentence for
	// the learner; the added models are still returned.
	ListError string `json:"list_error,omitempty"`
}

// ConnectionModels lists a connection's models. Only a missing connection is
// an error: a provider that will not list is a sentence beside the models
// the learner added.
func (s *Service) ConnectionModels(ctx context.Context, userID, id uuid.UUID) (*ModelList, error) {
	conn, err := s.conns.GetConnectionWithSecret(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	out := &ModelList{Listed: []string{}, Custom: []string{}}
	if cm, ok := s.conns.(store.CustomModelStore); ok {
		if out.Custom, err = cm.ListCustomModels(ctx, userID, id); err != nil {
			return nil, err
		}
	}
	listed, err := listModelsFor(ctx, conn)
	switch {
	case err == nil:
		out.Listed = listed
	case errors.Is(err, ErrInvalidInput):
		out.ListError = UserMessage(err)
	default:
		out.ListError = VerifyErrorMessage(err)
	}
	return out, nil
}

// AddCustomModel adds a model id to one of the learner's connections.
func (s *Service) AddCustomModel(ctx context.Context, userID, id uuid.UUID, model string) error {
	model, err := cleanModelID(model)
	if err != nil {
		return err
	}
	cm, ok := s.conns.(store.CustomModelStore)
	if !ok {
		return invalid("added models are not available here")
	}
	return cm.AddCustomModel(ctx, userID, id, model)
}

// DeleteCustomModel removes a hand-added model.
func (s *Service) DeleteCustomModel(ctx context.Context, userID, id uuid.UUID, model string) error {
	cm, ok := s.conns.(store.CustomModelStore)
	if !ok {
		return invalid("added models are not available here")
	}
	return cm.DeleteCustomModel(ctx, userID, id, strings.TrimSpace(model))
}

// cleanModelID accepts what a provider's model id can look like: printable,
// no spaces, at most maxModelID bytes.
func cleanModelID(raw string) (string, error) {
	model := strings.TrimSpace(raw)
	if model == "" {
		return "", invalid("enter a model id")
	}
	if len(model) > maxModelID {
		return "", invalid("a model id is at most %d characters", maxModelID)
	}
	for _, r := range model {
		if r <= ' ' || r == 0x7f {
			return "", invalid("a model id has no spaces or control characters")
		}
	}
	return model, nil
}
