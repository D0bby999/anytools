package citations

import (
	"log/slog"
	"strings"
)

// Result is a validated answer: the text with unknown markers removed, and the
// sources actually cited, in first-citation order.
type Result struct {
	Text    string
	Sources []Source
	// Dropped are the ids the model cited that no tool in this turn produced.
	Dropped []Ref
}

// Validate drops every marker whose id was not produced by a tool call in this
// turn, and returns the sources that survived.
//
// Why dropping rather than rendering: a model that hallucinates `[[cite:chunk:
// 42]]` produces a chip that looks exactly like a real citation and opens
// nothing, or worse, opens someone else's document if the id happens to exist.
// The product's whole claim is that an answer is worth what its source is
// worth. An unverifiable citation is therefore not a degraded citation, it is a
// lie, and it is removed.
//
// It is logged, never silently swallowed: a rising drop rate is the signal that
// a prompt or a model is producing citations it cannot support.
func Validate(text string, known map[string]Source) Result {
	res := Result{Text: text}
	if known == nil {
		known = map[string]Source{}
	}

	seen := map[string]bool{}
	for _, ref := range Parse(text) {
		key := ref.Kind + ":" + ref.ID
		src, ok := known[key]
		if !ok {
			res.Dropped = append(res.Dropped, ref)
			continue
		}
		if !seen[key] {
			seen[key] = true
			res.Sources = append(res.Sources, src)
		}
	}

	for _, ref := range res.Dropped {
		res.Text = strings.ReplaceAll(res.Text, ref.Match, "")
	}
	if len(res.Dropped) > 0 {
		ids := make([]string, 0, len(res.Dropped))
		for _, r := range res.Dropped {
			ids = append(ids, r.Kind+":"+r.ID)
		}
		slog.Warn("citations: dropped unknown references",
			"count", len(res.Dropped), "refs", ids)
	}
	res.Text = collapseSpaces(res.Text)
	return res
}

// Key is the map key Validate looks a source up by.
func Key(kind, id string) string { return kind + ":" + id }

// Index builds the lookup Validate takes from the sources a turn collected.
func Index(sources []Source) map[string]Source {
	idx := make(map[string]Source, len(sources))
	for _, s := range sources {
		idx[Key(s.Kind, s.ID)] = s
	}
	return idx
}
