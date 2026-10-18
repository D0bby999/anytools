package byok

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/store"
)

// RouteEntry is one entry of a replacement chain as the API receives it.
type RouteEntry struct {
	ConnectionID uuid.UUID
	Model        string
	Dims         int
}

// ListRoutes returns every function's chain for the user.
func (s *Service) ListRoutes(ctx context.Context, userID uuid.UUID) ([]store.FunctionRoute, error) {
	return s.routes.ListRoutes(ctx, userID)
}

// SetRoute replaces one function's whole chain.
//
// Validation is deliberately strict, because every rejection here is a failure
// the user would otherwise meet much later and much more confusingly: a route
// to a provider that cannot embed does not fail at save time, it fails when
// their first document finishes parsing.
func (s *Service) SetRoute(ctx context.Context, userID uuid.UUID, fn Function, entries []RouteEntry) error {
	if len(entries) > MaxChainEntries {
		return invalid("a chain may have at most %d entries", MaxChainEntries)
	}

	seen := make(map[uuid.UUID]bool, len(entries))
	out := make([]store.RouteEntryInput, 0, len(entries))

	for _, e := range entries {
		if e.ConnectionID == uuid.Nil {
			return invalid("every chain entry must name a connection")
		}
		// The same connection twice in one chain is not a fallback: when it
		// fails it is benched, so the second copy is skipped and the chain is
		// shorter than it looks.
		if seen[e.ConnectionID] {
			return invalid("the same connection appears twice in this chain")
		}
		seen[e.ConnectionID] = true

		// Reading the connection proves it exists AND belongs to this user; the
		// composite foreign key would catch the second part anyway, but a 404
		// here is a better answer than a foreign-key violation.
		conn, err := s.conns.GetConnection(ctx, userID, e.ConnectionID)
		if errors.Is(err, store.ErrConnectionNotFound) {
			return invalid("one of the chosen connections no longer exists")
		}
		if err != nil {
			return err
		}

		if isSubscriptionKind(conn.Kind) && !s.lanesEnabled() {
			return oauth.ErrLanesDisabled
		}
		if !ConnectionSupports(conn.Provider, conn.Kind, fn) {
			return invalid("%s cannot serve %s", conn.Provider, fn)
		}

		model := e.Model
		if model == "" {
			model = defaultModelFor(conn.Provider, fn)
		}
		if model == "" {
			return invalid("choose a model for %q", conn.Name)
		}

		dims := e.Dims
		if fn == FunctionEmbed && dims == 0 {
			// The width the last verify measured is the best answer available;
			// zero stays zero when nothing has measured one yet, and the first
			// embedding call then learns it.
			dims = conn.Settings.Dims
		}

		out = append(out, store.RouteEntryInput{ConnectionID: e.ConnectionID, Model: model, Dims: dims})
	}

	return s.routes.ReplaceRoute(ctx, userID, string(fn), out)
}

// defaultModelFor picks the model for a provider serving a function.
func defaultModelFor(provider string, fn Function) string {
	switch KindOf(fn) {
	case KindParse:
		return defaultParseModel(provider)
	case KindEmbed:
		return defaultEmbedModel(provider)
	case KindTTS:
		return defaultTTSModel(provider)
	case KindSTT:
		return defaultSTTModel(provider)
	default:
		return defaultChatModel(provider)
	}
}
