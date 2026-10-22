package byok

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/store"
)

// readiness.go — "can this product actually do the thing yet, and if not, what
// is the one sentence that fixes it".
//
// The matrix is the product's honest self-report. Its rules are chosen so that
// GREEN is never optimistic: a function is green only when a connection is
// routed to it, that connection is not benched, is not waiting to be
// reconnected, and has not been rejected the last time anyone asked. Anything
// else is warn or blocked with a reason the user can act on.

// Status is a readiness verdict.
type Status string

const (
	// StatusGreen means this function will run right now.
	StatusGreen Status = "green"
	// StatusWarn means it may run, or will run in a reduced form.
	StatusWarn Status = "warn"
	// StatusBlocked means it cannot run at all.
	StatusBlocked Status = "blocked"
)

// FunctionReadiness is one row of the matrix.
type FunctionReadiness struct {
	Function Function `json:"function"`
	Status   Status   `json:"status"`
	Reason   string   `json:"reason"`
	// ReasonCode names Reason for a client that words it in the learner's
	// language; Reason stays the English sentence, and the fallback.
	ReasonCode string `json:"reason_code,omitempty"`
	// Entries names the connections routed to this function, in chain order, so
	// the card can show what would be tried and in which order.
	Entries []ReadinessEntry `json:"entries"`
}

// ReadinessEntry is one connection as the matrix sees it.
type ReadinessEntry struct {
	ConnectionID uuid.UUID `json:"connection_id"`
	Name         string    `json:"name"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	Status       Status    `json:"status"`
	Note         string    `json:"note,omitempty"`
	// NoteCode names Note, as ReasonCode names a row's Reason. Detail is the
	// provider's own words where Note quotes them (a rejected key).
	NoteCode      string     `json:"note_code,omitempty"`
	Detail        string     `json:"detail,omitempty"`
	CooldownUntil *time.Time `json:"cooldown_until,omitempty"`
}

// Readiness is the whole matrix.
type Readiness struct {
	Functions []FunctionReadiness `json:"functions"`
	// Core is the verdict for the functions nothing else works without. It is
	// what the home card shows, because a user who has not routed `rerank` is
	// not blocked in any sense they would recognise.
	Core Status `json:"core"`
	// CoreFunctions names them, so the browser does not keep its own copy of a
	// list that is defined here.
	CoreFunctions []Function `json:"core_functions"`
	// OptionalFunctions are the ones a learner may leave unrouted and still
	// use the product fully (speech and transcription; builtin.go).
	OptionalFunctions []Function `json:"optional_functions"`
	// LanesEnabled tells the UI whether to render the experimental cards at all.
	LanesEnabled bool `json:"lanes_enabled"`
	// Connectors are the non-AI sources — phase 13's Drive grant — whose
	// failure is just as invisible as a missing key. See connectors.go.
	Connectors []ConnectorReadiness `json:"connectors"`
}

// coreFunctions are the two without which nothing in the product runs: a
// document cannot be retrieved without embed, and cannot be asked about
// without chat. Parse is not one of them: Markdown, Word, web pages and a PDF
// with a text layer are read on the server, and only a scanned PDF or a photo
// needs a model that reads images (readinessFor's parse_local).
var coreFunctions = []Function{FunctionChat, FunctionEmbed}

// Compute builds the readiness matrix for a user.
func (s *Service) Compute(ctx context.Context, userID uuid.UUID) (*Readiness, error) {
	conns, err := s.conns.ListConnections(ctx, userID)
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]store.ProviderConnection, len(conns))
	for _, c := range conns {
		byID[c.ID] = c
	}

	routes, err := s.routes.ListRoutes(ctx, userID)
	if err != nil {
		return nil, err
	}
	routesByFunction := map[string][]store.FunctionRoute{}
	for _, r := range routes {
		routesByFunction[r.Function] = append(routesByFunction[r.Function], r)
	}

	searchKeys, err := s.search.ListSearchConnections(ctx, userID)
	if err != nil {
		return nil, err
	}

	out := &Readiness{
		LanesEnabled:      s.lanesEnabled(),
		CoreFunctions:     coreFunctions,
		OptionalFunctions: optionalFunctions,
		Connectors:        s.connectorRows(ctx, userID),
	}
	for _, fn := range AllFunctions() {
		row := s.readinessFor(fn, routesByFunction[string(fn)], byID, searchKeys)
		out.Functions = append(out.Functions, s.withBuiltin(ctx, row))
	}

	out.Core = StatusGreen
	for _, row := range out.Functions {
		if !isCoreFunction(row.Function) {
			continue
		}
		out.Core = worst(out.Core, row.Status)
	}
	return out, nil
}

func isCoreFunction(fn Function) bool {
	for _, c := range coreFunctions {
		if c == fn {
			return true
		}
	}
	return false
}

func (s *Service) readinessFor(fn Function, routes []store.FunctionRoute,
	byID map[uuid.UUID]store.ProviderConnection, searchKeys []store.SearchConnection) FunctionReadiness {

	row := FunctionReadiness{Function: fn, Entries: []ReadinessEntry{}}
	now := s.now()

	if len(routes) == 0 && fn == FunctionParse {
		row.Status = StatusWarn
		row.Reason = "No model reads documents: files with text are read on the server, but scanned PDFs and photos need a model that reads images (Gemini, OpenAI or Anthropic)."
		row.ReasonCode = "parse_local"
		return row
	}
	if len(routes) == 0 {
		row.Status = StatusBlocked
		row.Reason = fmt.Sprintf("No %s route. Choose a connection for it in Settings → Routes.", fn)
		row.ReasonCode = "no_route"
		return row
	}

	usable := 0
	for _, r := range routes {
		conn, ok := byID[r.ConnectionID]
		if !ok {
			// The composite foreign key makes this unreachable; reporting it
			// rather than skipping means a future schema change that broke the
			// invariant would be visible instead of silent.
			row.Entries = append(row.Entries, ReadinessEntry{
				ConnectionID: r.ConnectionID, Model: r.Model,
				Status: StatusBlocked, Note: "This connection no longer exists.", NoteCode: "connection_gone",
			})
			continue
		}

		entry := ReadinessEntry{
			ConnectionID: conn.ID,
			Name:         conn.Name,
			Provider:     conn.Provider,
			Model:        r.Model,
			Status:       StatusGreen,
		}

		switch {
		// The same condition buildChain drops an entry on. Without it a route
		// to a provider with no client for this function reads GREEN in the
		// matrix and is invisible at serve time — the worst combination.
		case !ConnectionSupports(conn.Provider, conn.Kind, fn):
			entry.Status = StatusBlocked
			entry.Note = UserMessage(unsupported(conn.Provider, fn)) + "."
			entry.NoteCode = "unsupported"
		case isSubscriptionKind(conn.Kind) && !s.lanesEnabled():
			entry.Status = StatusBlocked
			entry.Note = "Experimental subscription lanes are turned off."
			entry.NoteCode = "lanes_off"
		case conn.Settings.OAuth != nil && conn.Settings.OAuth.NeedsReconnect:
			entry.Status = StatusBlocked
			entry.Note = "Relay token needs reconnect."
			entry.NoteCode = "reconnect"
		case conn.Settings.CoolingDownAt(now):
			entry.Status = StatusWarn
			entry.CooldownUntil = conn.Settings.CooldownUntil
			if conn.Settings.CooldownReason == "quota" {
				entry.Note = "Out of quota — resting until the allowance resets."
				entry.NoteCode = "quota"
			} else {
				entry.Note = "Resting after a rate limit."
				entry.NoteCode = "rate_limited"
			}
		case conn.Settings.VerifyStatus == store.VerifyStatusFailed:
			entry.Status = StatusBlocked
			entry.Note = "Key rejected. " + conn.LastError
			entry.NoteCode = "key_rejected"
			entry.Detail = conn.LastError
		case conn.VerifiedAt == nil:
			entry.Status = StatusWarn
			entry.Note = "Not verified yet."
			entry.NoteCode = "not_verified"
		}

		// A cooling-down connection still counts as usable: it will come back,
		// and if it is the only one the function is degraded rather than dead.
		if entry.Status != StatusBlocked {
			usable++
		}
		row.Entries = append(row.Entries, entry)
	}

	switch {
	case usable == 0:
		row.Status = StatusBlocked
		row.Reason = fmt.Sprintf("Every connection routed to %s is unusable.", fn)
		row.ReasonCode = "all_unusable"
	case usable < len(routes):
		row.Status = StatusWarn
		row.Reason = fmt.Sprintf("%d of %d connections for %s are unusable.", len(routes)-usable, len(routes), fn)
		row.ReasonCode = "some_unusable"
	default:
		row.Status = StatusGreen
	}

	// Any entry that is merely warning (resting, unverified) drags a green row
	// to warn: "green" has to mean "this will work when you press the button".
	if row.Status == StatusGreen {
		for _, e := range row.Entries {
			if e.Status == StatusWarn {
				row.Status = StatusWarn
				row.Reason = e.Note
				row.ReasonCode = e.NoteCode
				break
			}
		}
	}

	// Research is the one function whose readiness depends on something other
	// than its own chain. With no search key it still works — against the
	// user's own documents only — so it is a warning with the exact sentence
	// the plan specifies, not a block.
	webKeys := 0
	for _, k := range searchKeys {
		if isWebSearch(k.Provider) {
			webKeys++
		}
	}
	if fn == FunctionResearch && webKeys == 0 && row.Status == StatusGreen {
		row.Status = StatusWarn
		row.Reason = "No search key: research runs KB-only."
		row.ReasonCode = "kb_only"
		if s.keylessSearch {
			row.Reason = "No search key: research searches the web through DuckDuckGo, which can be slow or refuse. A Tavily or Brave key is more reliable."
			row.ReasonCode = "keyless_search"
		}
	}

	return row
}

// worst returns the more severe of two statuses.
func worst(a, b Status) Status {
	rank := map[Status]int{StatusGreen: 0, StatusWarn: 1, StatusBlocked: 2}
	if rank[b] > rank[a] {
		return b
	}
	return a
}
