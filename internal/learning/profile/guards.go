package profile

import (
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"
)

// guards.go is the engine's last word on what a consolidation may propose
// (DeepTutor's consolidator/guards.py, findings §8). The model proposes add,
// update and remove operations; each one is checked here, and anything that
// fails is DROPPED with its reason recorded on the run, never repaired:
//
//   - at most MaxOpsPerRun operations are considered;
//   - an add or update must cite at least one signal key it was given; keys
//     it invented are removed, and a statement left citing nothing is dropped;
//   - absolutes are refused ("mastered", "expert", "always", "never",
//     "fluent", "perfect", and their forms);
//   - text is one line of at most MaxTextRunes;
//   - update and remove name consolidated entries only — the learner's own
//     entries are never shown to the model and are never keyed, and a target
//     whose origin is the learner's is refused besides;
//   - a Studying statement that restates a Loop goal is dropped: chat already
//     receives the goal from the state (internal/capabilities/chat/chat.go);
//   - a statement the learner rejected within RejectCooldown is not proposed
//     again, nor is one the profile already holds;
//   - a section never grows past MaxPerSection.

// RawOp is one operation as the model wrote it.
type RawOp struct {
	Op      string   `json:"op"`
	Section string   `json:"section"`
	Entry   string   `json:"entry"`
	Text    string   `json:"text"`
	Refs    []string `json:"refs"`
}

// Proposal is a checked operation, ready to store as a proposed entry.
type Proposal struct {
	Op         string
	Section    string
	Text       string
	Refs       []Ref
	KBID       *uuid.UUID
	ReplacesID *uuid.UUID
}

// Keyed is an existing consolidated entry the model may update or remove,
// under the key ("E1") it was shown.
type Keyed struct {
	Key   string
	Entry Entry
	// Refs are the entry's stored refs, for the "same evidence" comparison.
	Refs []Ref
}

// Rejected is a proposal the learner declined, and when.
type Rejected struct {
	Section   string
	Text      string
	Refs      []Ref
	DecidedAt time.Time
}

// GuardInput is everything the checks compare against.
type GuardInput struct {
	Signals *Signals
	// Entries are the consolidated, accepted entries the model was shown.
	Entries []Keyed
	// Accepted counts every accepted entry per section, the learner's too.
	Accepted map[string]int
	// Texts are every accepted entry's section and folded text.
	Texts    map[string][]string
	Rejected []Rejected
	// Goals are the learner's Loop state goals, compared, never shown.
	Goals []string
	Now   time.Time
}

// Drop reasons, as the run records them.
const (
	reasonOverLimit   = "over the limit of operations per run"
	reasonUnknownOp   = "not an add, update or remove"
	reasonNoSection   = "not a profile section"
	reasonNoEntry     = "names no entry it was shown"
	reasonLearners    = "the learner's own entries are never changed by consolidation"
	reasonNoText      = "no text"
	reasonTooLong     = "longer than 280 characters"
	reasonAbsolute    = "uses an absolute word"
	reasonNoRefs      = "cites no evidence it was given"
	reasonGoal        = "restates a Loop goal"
	reasonRejected    = "the learner rejected it within 30 days"
	reasonDuplicate   = "the profile already says this"
	reasonSectionFull = "the section is full"
	reasonTwice       = "a second operation on the same entry"
)

// banned are the absolutes DeepTutor's guard refuses, with their forms:
// "expertise", "perfectly" and "fluently" claim exactly what the base words do.
var banned = regexp.MustCompile(`(?i)\b(mastered|expert\w*|always|never|fluent\w*|perfect\w*)\b`)

// HasAbsolute reports whether text makes an absolute claim. The text is
// NFKC-folded first, so full-width or compatibility letters spell the same word.
func HasAbsolute(text string) bool {
	return banned.MatchString(norm.NFKC.String(text))
}

// Check validates the model's operations against in.
func Check(ops []RawOp, in GuardInput) ([]Proposal, []RunOp) {
	targets := in.Signals.targets()
	byKey := map[string]Keyed{}
	for _, k := range in.Entries {
		byKey[k.Key] = k
	}
	counts := map[string]int{}
	for sec, n := range in.Accepted {
		counts[sec] = n
	}
	touched := map[uuid.UUID]bool{}

	var props []Proposal
	var log []RunOp
	drop := func(op RawOp, section, reason string) {
		log = append(log, RunOp{Op: op.Op, Section: section, Text: oneLine(op.Text, MaxTextRunes+20), Status: "dropped", Reason: reason})
	}

	for i, op := range ops {
		op.Op = strings.TrimSpace(strings.ToLower(op.Op))
		if i >= MaxOpsPerRun {
			drop(op, op.Section, reasonOverLimit)
			continue
		}
		var target *Keyed
		section := strings.TrimSpace(op.Section)
		switch op.Op {
		case OpAdd:
			if !slices.Contains(Sections(), section) {
				drop(op, section, reasonNoSection)
				continue
			}
		case OpUpdate, OpRemove:
			k, ok := byKey[strings.TrimSpace(op.Entry)]
			if !ok {
				drop(op, section, reasonNoEntry)
				continue
			}
			if k.Entry.Origin != OriginConsolidated {
				drop(op, k.Entry.Section, reasonLearners)
				continue
			}
			if touched[k.Entry.ID] {
				drop(op, k.Entry.Section, reasonTwice)
				continue
			}
			target, section = &k, k.Entry.Section
		default:
			drop(op, section, reasonUnknownOp)
			continue
		}

		if op.Op == OpRemove {
			touched[target.Entry.ID] = true
			id := target.Entry.ID
			props = append(props, Proposal{Op: OpRemove, Section: section, Text: target.Entry.Text, ReplacesID: &id})
			log = append(log, RunOp{Op: OpRemove, Section: section, Text: target.Entry.Text, Status: StatusProposed})
			continue
		}

		text := strings.Join(strings.Fields(op.Text), " ")
		switch {
		case text == "":
			drop(op, section, reasonNoText)
			continue
		case utf8.RuneCountInString(text) > MaxTextRunes:
			drop(op, section, reasonTooLong)
			continue
		case HasAbsolute(text):
			drop(op, section, reasonAbsolute)
			continue
		}

		refs, kbID := resolveRefs(op.Refs, targets)
		if len(refs) == 0 {
			drop(op, section, reasonNoRefs)
			continue
		}
		if section == SectionStudying && restatesGoal(text, in.Goals) {
			drop(op, section, reasonGoal)
			continue
		}
		if wasRejected(section, text, refs, in.Rejected, in.Now) {
			drop(op, section, reasonRejected)
			continue
		}
		if slices.Contains(in.Texts[section], fold(text)) {
			drop(op, section, reasonDuplicate)
			continue
		}
		if op.Op == OpAdd {
			if counts[section] >= MaxPerSection {
				drop(op, section, reasonSectionFull)
				continue
			}
			// A pending add counts against its section, so accepting every
			// proposal of one run cannot overfill it.
			counts[section]++
		}

		p := Proposal{Op: op.Op, Section: section, Text: text, Refs: refs, KBID: kbID}
		if target != nil {
			touched[target.Entry.ID] = true
			id := target.Entry.ID
			p.ReplacesID = &id
		}
		props = append(props, p)
		log = append(log, RunOp{Op: op.Op, Section: section, Text: text, Status: StatusProposed})
	}
	return props, log
}

// resolveRefs maps the keys a statement cites to rows, dropping every key it
// was not given. The statement is about a knowledge base when everything it
// cites is.
func resolveRefs(keys []string, targets map[Key]target) ([]Ref, *uuid.UUID) {
	var refs []Ref
	seen := map[Ref]bool{}
	kb, oneKB := uuid.Nil, true
	for _, k := range keys {
		t, ok := targets[Key(strings.TrimSpace(k))]
		if !ok {
			continue
		}
		for _, r := range t.refs {
			if !seen[r] {
				seen[r] = true
				refs = append(refs, r)
			}
		}
		switch {
		case t.kbID == uuid.Nil:
			oneKB = false
		case kb == uuid.Nil:
			kb = t.kbID
		case kb != t.kbID:
			oneKB = false
		}
	}
	if len(refs) == 0 || !oneKB || kb == uuid.Nil {
		return refs, nil
	}
	return refs, &kb
}

// restatesGoal: a goal of some substance that the statement contains, or
// that contains the statement.
func restatesGoal(text string, goals []string) bool {
	t := fold(text)
	for _, g := range goals {
		g = fold(g)
		if utf8.RuneCountInString(g) >= 8 && (strings.Contains(t, g) || strings.Contains(g, t)) {
			return true
		}
	}
	return false
}

// wasRejected: the same section, and the same words or the same evidence.
func wasRejected(section, text string, refs []Ref, rejected []Rejected, now time.Time) bool {
	t := fold(text)
	for _, r := range rejected {
		if r.Section != section || now.Sub(r.DecidedAt) > RejectCooldown {
			continue
		}
		if fold(r.Text) == t || sameRefs(r.Refs, refs) {
			return true
		}
	}
	return false
}

func sameRefs(a, b []Ref) bool {
	if len(a) == 0 || len(a) != len(b) {
		return false
	}
	set := map[Ref]bool{}
	for _, r := range a {
		set[r] = true
	}
	for _, r := range b {
		if !set[r] {
			return false
		}
	}
	return true
}

// fold is the comparison form of a statement: NFKC, lower case, letters and
// digits only, single-spaced.
func fold(s string) string {
	s = strings.ToLower(norm.NFKC.String(s))
	var b strings.Builder
	space := false
	for _, r := range s {
		if isWordRune(r) {
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = false
			b.WriteRune(r)
			continue
		}
		space = true
	}
	return b.String()
}

func isWordRune(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }

// FoldText exposes the comparison form for the store's duplicate lookup.
func FoldText(s string) string { return fold(s) }

// oneLine is text for the run log: one line, capped.
func oneLine(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > max {
		return string([]rune(s)[:max]) + "…"
	}
	return s
}
