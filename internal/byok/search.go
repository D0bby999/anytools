package byok

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/rag/search"
	"github.com/D0bby999/anytools/internal/store"
)

// search.go — BYOK web-search keys.
//
// There is no platform search key. The plan carried a system Tavily key until
// red-team RT-13 cut it: one shared key is one shared quota with no accounting,
// and "free + BYOK, no platform key of any kind" does not have an exception for
// search. With no key, research runs against the user's own documents and the
// readiness matrix says exactly that.

// UseKeylessSearch tells readiness that research can still reach the web
// without a key (the DuckDuckGo fallback, wired in internal/app).
func (s *Service) UseKeylessSearch(enabled bool) { s.keylessSearch = enabled }

// KeylessSearch reports whether research reaches the web without a key.
func (s *Service) KeylessSearch() bool { return s.keylessSearch }

// SearchProviders lists the web-search providers AnyTools can call.
func SearchProviders() []string { return []string{search.ProviderTavily, search.ProviderBrave} }

// ProviderOpenAlex is the optional scholarly-search key (learning depth,
// phase 6). It lives in search_connections but is not a web-search key: the
// web chain and readiness read SearchProviders() only.
const ProviderOpenAlex = "openalex"

// ProviderGitHub is the learner's GitHub token for private repositories
// (up-methods phase 18): fine-grained, read-only contents. Like OpenAlex it
// is a search_connections row (encrypted, one per user) but not a web-search
// key.
const ProviderGitHub = "github"

// ProviderZotero is the learner's Zotero library (up-methods phase 20): a
// read-only key and the library's numeric user id, stored together as one
// encrypted secret ("<user id>:<key>", zotero.Credential). Not a web-search
// key either.
const ProviderZotero = "zotero"

// ProviderYouTubeData is the learner's YouTube Data API key, which lists a
// whole playlist rather than the keyless feed's latest 15 videos
// (up-methods phase 17). Like OpenAlex it is a search_connections row, used
// only from the server, and not a web-search key.
const ProviderYouTubeData = "youtube_data"

// isWebSearch reports whether a stored search key serves web search.
func isWebSearch(provider string) bool {
	for _, p := range SearchProviders() {
		if p == provider {
			return true
		}
	}
	return false
}

// PaperKeyFor returns the user's OpenAlex key, or "" for the keyless budget.
func (s *Service) PaperKeyFor(ctx context.Context, userID uuid.UUID) (string, error) {
	rows, err := s.search.SearchChain(ctx, userID)
	if err != nil {
		return "", err
	}
	for _, r := range rows {
		if r.Provider == ProviderOpenAlex {
			return r.Secret, nil
		}
	}
	return "", nil
}

// GitHubToken returns the user's GitHub token, or "" for public
// repositories only.
func (s *Service) GitHubToken(ctx context.Context, userID uuid.UUID) (string, error) {
	rows, err := s.search.SearchChain(ctx, userID)
	if err != nil {
		return "", err
	}
	for _, r := range rows {
		if r.Provider == ProviderGitHub {
			return r.Secret, nil
		}
	}
	return "", nil
}

// ZoteroCredential returns the user's Zotero library and key, or ok=false
// when they have not added one.
func (s *Service) ZoteroCredential(ctx context.Context, userID uuid.UUID) (zotero.Credential, bool, error) {
	rows, err := s.search.SearchChain(ctx, userID)
	if err != nil {
		return zotero.Credential{}, false, err
	}
	for _, r := range rows {
		if r.Provider == ProviderZotero {
			cred, err := zotero.ParseCredential(r.Secret)
			if err != nil {
				return zotero.Credential{}, false, err
			}
			return cred, true, nil
		}
	}
	return zotero.Credential{}, false, nil
}

// ZoteroSecret joins a Zotero user id and key into the secret
// SaveSearchConnection stores, refusing either when it cannot be one.
func ZoteroSecret(userID, key string) (string, error) {
	cred, err := zotero.NewCredential(userID, key)
	if err != nil {
		return "", invalid("%s", err.Error())
	}
	return cred.Secret(), nil
}

// YouTubeDataKey returns the user's YouTube Data API key, or "" for the
// keyless feeds only.
func (s *Service) YouTubeDataKey(ctx context.Context, userID uuid.UUID) (string, error) {
	rows, err := s.search.SearchChain(ctx, userID)
	if err != nil {
		return "", err
	}
	for _, r := range rows {
		if r.Provider == ProviderYouTubeData {
			return r.Secret, nil
		}
	}
	return "", nil
}

// ListSearchConnections returns the user's search keys, without secrets.
func (s *Service) ListSearchConnections(ctx context.Context, userID uuid.UUID) ([]store.SearchConnection, error) {
	return s.search.ListSearchConnections(ctx, userID)
}

// SaveSearchConnection stores or replaces the key for one provider.
func (s *Service) SaveSearchConnection(ctx context.Context, userID uuid.UUID, provider, secret string) (*store.SearchConnection, error) {
	provider = strings.TrimSpace(provider)
	if !isWebSearch(provider) && provider != ProviderOpenAlex && provider != ProviderGitHub && provider != ProviderZotero &&
		provider != ProviderYouTubeData {
		return nil, invalid("unknown search provider %q", provider)
	}
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, invalid("a search API key is required")
	}
	if provider == ProviderZotero {
		if _, err := zotero.ParseCredential(secret); err != nil {
			return nil, invalid("%s", err.Error())
		}
	}
	return s.search.UpsertSearchConnection(ctx, userID, provider, secret)
}

// DeleteSearchConnection removes a search key.
func (s *Service) DeleteSearchConnection(ctx context.Context, userID, id uuid.UUID) error {
	return s.search.DeleteSearchConnection(ctx, userID, id)
}
