package profile

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/tools"
)

// signals.go is everything the nightly consolidation is allowed to read.
//
// The rule (red team SF-3): engine-rendered aggregates only. Counts, rates,
// ids, enum values the database CHECKs, and knowledge-point and
// knowledge-base names — the only strings — cut to MaxNameRunes and quoted
// inside the provenance envelope (tools.Wrap) as untrusted data. Explain-back
// gaps and misconceptions, feedback, question text, a learner's answers,
// vocabulary terms and skill-card titles never enter: each is text a model
// wrote from a document, or text a document or a learner wrote, and phase 4
// lets any web page or transcript steer the former.
//
// The types below are the enforcement. The store hands over SignalRows (plain
// columns); BuildSignals turns them into Signals, and the only string-kinded
// fields Signals can carry are Key (assigned here), Label (built only by
// quote, which wraps), and the enums, each validated against its fixed list
// on the way in. TestSignalsCarryOnlyIDsCountsRatesAndWrappedNames walks the
// types; a new plain `string` field fails it.

// SignalWindow is how far back the aggregates look.
const SignalWindow = 30 * 24 * time.Hour

// Caps on how much one run is shown.
const (
	maxPointSignals = 20
	maxBaseSignals  = 10
	maxVocabSignals = 5
	maxCardSignals  = 10
)

// Key is a signal's handle in the prompt ("S1"), which the model cites and the
// engine maps back to rows. Assigned by BuildSignals, never read from input.
type Key string

// Label is a name the engine quotes: cut to MaxNameRunes and inside a
// provenance envelope. Only quote makes one.
type Label string

// ErrorType is an error_records.error_type value.
type ErrorType string

// LangTag is a vocabulary note's language tag, as vocab_notes CHECKs it.
type LangTag string

// CardKind and CardStatus are a skill card's kind and status.
type (
	CardKind   string
	CardStatus string
)

// errorTypes is the error_records CHECK list.
var errorTypes = []string{"concept", "recall", "application", "careless", "misread", "unknown"}

var langShape = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$`)

// ErrorCount is how many mistakes of one type a point has.
type ErrorCount struct {
	Type  ErrorType
	Count int
}

// PointSignal is one knowledge point's evidence.
type PointSignal struct {
	Key              Key
	KnowledgePointID uuid.UUID
	KnowledgeBaseID  uuid.UUID
	PathID           uuid.UUID
	Name             Label
	Errors           []ErrorCount
	OpenMistakes     int
	// MistakeID is the point's newest open mistake, cited when a statement
	// is about its errors; uuid.Nil when none is open.
	MistakeID     uuid.UUID
	Attempts      int
	Correct       int
	Mastery       float64
	Graduated     bool
	ExplainPassed int
	ExplainFailed int
}

// BaseSignal is quiz accuracy in one knowledge base.
type BaseSignal struct {
	Key             Key
	KnowledgeBaseID uuid.UUID
	Name            Label
	Attempts        int
	Correct         int
	Accuracy        float64
	OpenMistakes    int
}

// VocabSignal is one language's vocabulary reviews. The terms themselves are
// never included: they are text copied out of documents.
type VocabSignal struct {
	Key       Key
	Lang      LangTag
	Cards     int
	Reviews   int
	Lapses    int
	LapseRate float64
	// CardID is the language's most-lapsed card, cited as an example.
	CardID uuid.UUID
}

// CardSignal is one skill evidence card's progress. Its title and entries
// are the learner's own text and are never included.
type CardSignal struct {
	Key         Key
	SkillCardID uuid.UUID
	Kind        CardKind
	Status      CardStatus
	Entries     int
	RetestDone  bool
}

// Signals is one learner's aggregates for one run.
type Signals struct {
	Points []PointSignal
	Bases  []BaseSignal
	Vocab  []VocabSignal
	Cards  []CardSignal
}

// Empty reports whether there is nothing to consolidate from.
func (s *Signals) Empty() bool {
	return len(s.Points) == 0 && len(s.Bases) == 0 && len(s.Vocab) == 0 && len(s.Cards) == 0
}

// target is what a signal key can be cited as, and the knowledge base it is
// about (uuid.Nil when it is about none).
type target struct {
	refs []Ref
	kbID uuid.UUID
}

// targets maps each key to the rows a statement citing it will link to.
func (s *Signals) targets() map[Key]target {
	out := map[Key]target{}
	for _, p := range s.Points {
		refs := []Ref{{Kind: RefKnowledgePoint, ID: p.KnowledgePointID}}
		if p.MistakeID != uuid.Nil {
			refs = append(refs, Ref{Kind: RefMistake, ID: p.MistakeID})
		}
		out[p.Key] = target{refs: refs, kbID: p.KnowledgeBaseID}
	}
	for _, b := range s.Bases {
		out[b.Key] = target{refs: []Ref{{Kind: RefKnowledgeBase, ID: b.KnowledgeBaseID}}, kbID: b.KnowledgeBaseID}
	}
	for _, v := range s.Vocab {
		out[v.Key] = target{refs: []Ref{{Kind: RefVocabCard, ID: v.CardID}}}
	}
	for _, c := range s.Cards {
		out[c.Key] = target{refs: []Ref{{Kind: RefSkillCard, ID: c.SkillCardID}}}
	}
	return out
}

// ── what the store hands over ────────────────────────────────────────────

// SignalRows are the aggregates as the store reads them: plain columns, every
// row already scoped to one user. BuildSignals is the only way they become
// Signals.
type SignalRows struct {
	Points []PointRow
	Bases  []BaseRow
	Vocab  []VocabRow
	Cards  []CardRow
}

// PointRow is one knowledge point's aggregates.
type PointRow struct {
	KnowledgePointID uuid.UUID
	KnowledgeBaseID  uuid.UUID
	PathID           uuid.UUID
	Name             string
	Errors           map[string]int
	OpenMistakes     int
	MistakeID        uuid.UUID
	Attempts         int
	Correct          int
	Mastery          float64
	Graduated        bool
	ExplainPassed    int
	ExplainFailed    int
}

// BaseRow is one knowledge base's quiz aggregates.
type BaseRow struct {
	KnowledgeBaseID uuid.UUID
	Name            string
	Attempts        int
	Correct         int
	OpenMistakes    int
}

// VocabRow is one language's review aggregates.
type VocabRow struct {
	Lang    string
	Cards   int
	Reviews int
	Lapses  int
	CardID  uuid.UUID
}

// CardRow is one skill card's progress.
type CardRow struct {
	SkillCardID uuid.UUID
	Kind        string
	Status      string
	Entries     int
	RetestDone  bool
}

// BuildSignals validates and quotes the store's rows, and gives each a key.
// Anything with an unknown enum value is dropped rather than passed on.
func BuildSignals(rows SignalRows) *Signals {
	s := &Signals{}
	n := 0
	next := func() Key {
		n++
		return Key(fmt.Sprintf("S%d", n))
	}
	for _, p := range capRows(rows.Points, maxPointSignals) {
		sig := PointSignal{
			Key: next(), KnowledgePointID: p.KnowledgePointID, KnowledgeBaseID: p.KnowledgeBaseID,
			PathID: p.PathID, Name: quote("knowledge point", p.KnowledgePointID, p.Name),
			OpenMistakes: p.OpenMistakes, MistakeID: p.MistakeID, Attempts: p.Attempts, Correct: p.Correct,
			Mastery: clamp01(p.Mastery), Graduated: p.Graduated,
			ExplainPassed: p.ExplainPassed, ExplainFailed: p.ExplainFailed,
		}
		for _, t := range errorTypes {
			if c := p.Errors[t]; c > 0 {
				sig.Errors = append(sig.Errors, ErrorCount{Type: ErrorType(t), Count: c})
			}
		}
		s.Points = append(s.Points, sig)
	}
	for _, b := range capRows(rows.Bases, maxBaseSignals) {
		acc := 0.0
		if b.Attempts > 0 {
			acc = float64(b.Correct) / float64(b.Attempts)
		}
		s.Bases = append(s.Bases, BaseSignal{
			Key: next(), KnowledgeBaseID: b.KnowledgeBaseID, Name: quote("knowledge base", b.KnowledgeBaseID, b.Name),
			Attempts: b.Attempts, Correct: b.Correct, Accuracy: acc, OpenMistakes: b.OpenMistakes,
		})
	}
	for _, v := range capRows(rows.Vocab, maxVocabSignals) {
		if !langShape.MatchString(v.Lang) || v.CardID == uuid.Nil {
			continue
		}
		rate := 0.0
		if v.Reviews > 0 {
			rate = float64(v.Lapses) / float64(v.Reviews)
		}
		s.Vocab = append(s.Vocab, VocabSignal{
			Key: next(), Lang: LangTag(v.Lang), Cards: v.Cards, Reviews: v.Reviews,
			Lapses: v.Lapses, LapseRate: rate, CardID: v.CardID,
		})
	}
	for _, c := range capRows(rows.Cards, maxCardSignals) {
		if !slices.ContainsFunc(loop.CardKinds(), func(k loop.CardKind) bool { return k.Kind == c.Kind }) ||
			!slices.Contains([]string{loop.CardOpen, loop.CardRetestDue, loop.CardClosed}, c.Status) {
			continue
		}
		s.Cards = append(s.Cards, CardSignal{
			Key: next(), SkillCardID: c.SkillCardID, Kind: CardKind(c.Kind), Status: CardStatus(c.Status),
			Entries: c.Entries, RetestDone: c.RetestDone,
		})
	}
	return s
}

// quote is the one constructor of a Label: the name cut to MaxNameRunes, on
// one line, inside the provenance envelope, so an instruction in a document's
// heading reaches the model as quoted data.
func quote(kind string, id uuid.UUID, name string) Label {
	name = strings.Join(strings.Fields(name), " ")
	if utf8.RuneCountInString(name) > MaxNameRunes {
		name = string([]rune(name)[:MaxNameRunes])
	}
	return Label(tools.Wrap(kind+" name", kind+":"+id.String(), name))
}

// Render is the signals as the consolidation prompt shows them: one line per
// signal, engine-worded, with its key first.
func (s *Signals) Render() string {
	var b strings.Builder
	if len(s.Points) > 0 {
		b.WriteString("Knowledge points (mastery path practice, last 30 days):\n")
		for _, p := range s.Points {
			fmt.Fprintf(&b, "%s — knowledge point in knowledge base %s:\n%s\n", p.Key, s.baseKey(p.KnowledgeBaseID), p.Name)
			fmt.Fprintf(&b, "  answers %d, correct %d; mastery estimate %.2f; graduated %t; open mistakes %d",
				p.Attempts, p.Correct, p.Mastery, p.Graduated, p.OpenMistakes)
			if len(p.Errors) > 0 {
				parts := make([]string, 0, len(p.Errors))
				for _, e := range p.Errors {
					parts = append(parts, fmt.Sprintf("%s %d", e.Type, e.Count))
				}
				fmt.Fprintf(&b, "; mistake types: %s", strings.Join(parts, ", "))
			}
			fmt.Fprintf(&b, "; explain-back passed %d, failed %d\n", p.ExplainPassed, p.ExplainFailed)
		}
		b.WriteString("\n")
	}
	if len(s.Bases) > 0 {
		b.WriteString("Knowledge bases (all quiz answers, last 30 days):\n")
		for _, k := range s.Bases {
			fmt.Fprintf(&b, "%s — knowledge base:\n%s\n", k.Key, k.Name)
			fmt.Fprintf(&b, "  answers %d, correct %d (accuracy %.0f%%); open mistakes %d\n",
				k.Attempts, k.Correct, k.Accuracy*100, k.OpenMistakes)
		}
		b.WriteString("\n")
	}
	if len(s.Vocab) > 0 {
		b.WriteString("Vocabulary reviews (last 30 days):\n")
		for _, v := range s.Vocab {
			fmt.Fprintf(&b, "%s — language %s: %d cards, %d reviews, %d forgotten (lapse rate %.0f%%)\n",
				v.Key, v.Lang, v.Cards, v.Reviews, v.Lapses, v.LapseRate*100)
		}
		b.WriteString("\n")
	}
	if len(s.Cards) > 0 {
		b.WriteString("Skill evidence cards (last 30 days):\n")
		for _, c := range s.Cards {
			fmt.Fprintf(&b, "%s — a %s card, status %s, %d entries, delayed retest done %t\n",
				c.Key, strings.ReplaceAll(string(c.Kind), "_", " "), strings.ReplaceAll(string(c.Status), "_", " "),
				c.Entries, c.RetestDone)
		}
	}
	return strings.TrimSpace(b.String())
}

// baseKey names a knowledge base by its own signal key when it has one.
func (s *Signals) baseKey(id uuid.UUID) string {
	for _, b := range s.Bases {
		if b.KnowledgeBaseID == id {
			return string(b.Key)
		}
	}
	return "(not listed)"
}

func capRows[T any](rows []T, n int) []T {
	if len(rows) > n {
		return rows[:n]
	}
	return rows
}

func clamp01(f float64) float64 {
	switch {
	case f < 0:
		return 0
	case f > 1:
		return 1
	}
	return f
}
