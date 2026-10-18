package book

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	bookprompts "github.com/D0bby999/anytools/internal/prompts/book"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// propose.go is the first gate: the outline. The model reads a sample of the
// knowledge base and proposes chapters; these rules decide whether the
// proposal may be shown, and the same rules hold every edit the learner saves.

// Outline limits: how many passages the proposal reads, and how much of each.
const (
	OutlineSize     = 40
	outlineSnippet  = 600
	editorSnippet   = 240
	maxObjectives   = 6
	maxObjective    = 300
	maxAnchors      = 8
	minOutlineItems = MinMaterial
)

// CreateRequest starts a book from a knowledge base.
type CreateRequest struct {
	KBID uuid.UUID
	// Goal is the learner's optional aim, which shapes the outline.
	Goal string
	// Chapters is the length, 4–12 (default 6).
	Chapters int
}

// Create proposes a book: one model call (and at most one repair) over a
// sample of the knowledge base, validated before anything is stored. The
// knowledge base is resolved with the caller's user_id first, so another
// user's answers exactly like a missing one. Nothing is compiled.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, r CreateRequest) (*Book, error) {
	if r.Chapters == 0 {
		r.Chapters = DefaultChapters
	}
	if r.Chapters < MinChapters || r.Chapters > MaxChapters {
		return nil, fmt.Errorf("%w: a book has %d to %d chapters", ErrBadRequest, MinChapters, MaxChapters)
	}
	r.Goal = strings.TrimSpace(r.Goal)
	if utf8.RuneCountInString(r.Goal) > maxGoal {
		return nil, fmt.Errorf("%w: keep the goal under %d characters", ErrBadRequest, maxGoal)
	}
	name, err := s.store.KBName(ctx, userID, r.KBID)
	if err != nil {
		return nil, ErrNotFound
	}
	passages, err := s.store.Outline(ctx, userID, r.KBID, OutlineSize)
	if err != nil {
		return nil, err
	}
	if len(passages) < minOutlineItems {
		return nil, ErrThinKB
	}

	provider, err := s.models.ChatFor(ctx, userID, "chat")
	if err != nil {
		return nil, err
	}
	block, short := passageBlock(passages, outlineSnippet)
	user := fmt.Sprintf("Knowledge base: %s\nChapters: %d\nThe learner's goal: %s\n\nPassages:\n\n%s",
		name, r.Chapters, orNone(r.Goal), block)

	p, err := s.askProposal(ctx, provider, bookprompts.Propose, user, short, passages)
	if err != nil {
		var verr *ruleError
		if !errors.As(err, &verr) {
			return nil, err
		}
		p, err = s.askProposal(ctx, provider, bookprompts.Propose+"\n\n"+bookprompts.Repair,
			fmt.Sprintf("%s\n\nThe rule broken: %s\n\nYour answer:\n%s", user, verr.rule, verr.raw), short, passages)
		if err != nil {
			if errors.As(err, &verr) {
				return nil, fmt.Errorf("%w: %s", ErrInvalidOutput, verr.rule)
			}
			return nil, err
		}
	}

	return s.store.CreateBook(ctx, Book{
		UserID: userID, KBID: r.KBID, Title: p.Title, Goal: r.Goal, Length: r.Chapters,
		Status: StatusProposed, Proposal: *p,
	})
}

// ruleError is a model answer that broke a rule, with the answer, for the
// one repair.
type ruleError struct {
	rule string
	raw  string
}

func (e *ruleError) Error() string { return e.rule }

type draftChapter struct {
	Title         string   `json:"title"`
	Objectives    []string `json:"objectives"`
	Prerequisites []int    `json:"prerequisites"`
	Anchors       []string `json:"anchors"`
}

type draftProposal struct {
	Title    string         `json:"title"`
	Audience string         `json:"audience"`
	Chapters []draftChapter `json:"chapters"`
}

// askProposal makes one call and turns its answer into a checked Proposal.
// A broken rule is a *ruleError; a provider failure is not.
func (s *Service) askProposal(
	ctx context.Context, provider runtime.ChatProvider, system, user string,
	short map[string]uuid.UUID, passages []Passage,
) (*Proposal, error) {
	var d draftProposal
	raw, err := askJSON(ctx, provider, system, user, &d)
	if err != nil {
		if errors.Is(err, ErrInvalidOutput) {
			return nil, &ruleError{rule: "reply with the JSON object described", raw: raw}
		}
		return nil, err
	}
	p := Proposal{Title: strings.TrimSpace(d.Title), Audience: strings.TrimSpace(d.Audience), Outline: outlineOf(passages)}
	for i, c := range d.Chapters {
		ch := ProposedChapter{Title: strings.TrimSpace(c.Title), Prereqs: c.Prerequisites, Objectives: c.Objectives}
		for _, a := range c.Anchors {
			id, ok := short[strings.TrimSpace(a)]
			if !ok {
				return nil, &ruleError{rule: fmt.Sprintf("chapter %d anchors %q, which is not one of the passages given", i+1, a), raw: raw}
			}
			ch.Anchors = append(ch.Anchors, id)
		}
		p.Chapters = append(p.Chapters, ch)
	}
	known := map[uuid.UUID]bool{}
	for _, it := range p.Outline {
		known[it.ChunkID] = true
	}
	clean, err := ValidateProposal(p, known, MinChapters)
	if err != nil {
		return nil, &ruleError{rule: strings.TrimPrefix(err.Error(), ErrInvalidOutput.Error()+": "), raw: raw}
	}
	return &clean, nil
}

// ValidateProposal checks an outline — the model's, or the learner's edit —
// and returns it tidied. known is the set of passages the proposal was
// written from: an anchor outside it is refused. min is the fewest chapters
// allowed: MinChapters for the model, 1 for the learner, who may cut.
func ValidateProposal(p Proposal, known map[uuid.UUID]bool, min int) (Proposal, error) {
	bad := func(format string, args ...any) error {
		return fmt.Errorf("%w: %s", ErrInvalidOutput, fmt.Sprintf(format, args...))
	}
	p.Title = strings.TrimSpace(p.Title)
	p.Audience = strings.TrimSpace(p.Audience)
	if p.Title == "" || utf8.RuneCountInString(p.Title) > maxTitle {
		return p, bad("the title must be 1 to %d characters", maxTitle)
	}
	if utf8.RuneCountInString(p.Audience) > maxAudience {
		return p, bad("the audience must be at most %d characters", maxAudience)
	}
	if n := len(p.Chapters); n < min || n > MaxChapters {
		return p, bad("a book has %d to %d chapters, not %d", min, MaxChapters, n)
	}
	for i := range p.Chapters {
		ch := &p.Chapters[i]
		num := i + 1
		ch.Title = strings.TrimSpace(ch.Title)
		if ch.Title == "" || utf8.RuneCountInString(ch.Title) > maxTitle {
			return p, bad("chapter %d needs a title of 1 to %d characters", num, maxTitle)
		}
		objectives := make([]string, 0, len(ch.Objectives))
		for _, o := range ch.Objectives {
			if o = strings.TrimSpace(o); o != "" {
				objectives = append(objectives, o)
			}
		}
		if len(objectives) == 0 || len(objectives) > maxObjectives {
			return p, bad("chapter %d needs 1 to %d objectives", num, maxObjectives)
		}
		for _, o := range objectives {
			if utf8.RuneCountInString(o) > maxObjective {
				return p, bad("an objective of chapter %d is over %d characters", num, maxObjective)
			}
		}
		ch.Objectives = objectives
		seen := map[int]bool{}
		prereqs := []int{}
		for _, pr := range ch.Prereqs {
			if pr < 1 || pr >= num {
				return p, bad("chapter %d names chapter %d as a prerequisite; prerequisites must be earlier chapters", num, pr)
			}
			if !seen[pr] {
				seen[pr] = true
				prereqs = append(prereqs, pr)
			}
		}
		ch.Prereqs = prereqs
		if len(ch.Anchors) == 0 || len(ch.Anchors) > maxAnchors {
			return p, bad("chapter %d needs 1 to %d anchors from the passages", num, maxAnchors)
		}
		anchors := []uuid.UUID{}
		dup := map[uuid.UUID]bool{}
		for _, a := range ch.Anchors {
			if !known[a] {
				return p, bad("chapter %d anchors a passage that is not in this book's outline", num)
			}
			if !dup[a] {
				dup[a] = true
				anchors = append(anchors, a)
			}
		}
		ch.Anchors = anchors
	}
	return p, nil
}

// EditRequest is an edited outline: renamed, reordered, cut or added to.
type EditRequest struct {
	Title    string
	Audience string
	Chapters []ProposedChapter
}

// UpdateProposal saves the learner's edit of a proposed book's outline. The
// rules are the model's, and every anchor must be one of the outline's
// passages AND still resolve to the caller's chunk in the book's knowledge
// base: an id from anywhere else is refused.
func (s *Service) UpdateProposal(ctx context.Context, userID, id uuid.UUID, e EditRequest) (*Book, error) {
	b, err := s.store.GetBook(ctx, userID, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if b.Status != StatusProposed {
		return nil, ErrNotEditable
	}
	known, resolved, err := s.knownAnchors(ctx, b, e.Chapters)
	if err != nil {
		return nil, err
	}
	// An anchor that is not the caller's chunk in this knowledge base — or
	// no chunk at all — answers as a missing id does. One of theirs that is
	// not in the outline is a rule the editor can explain, below.
	for _, ch := range e.Chapters {
		for _, a := range ch.Anchors {
			if !resolved[a] {
				return nil, ErrNotFound
			}
		}
	}
	p, err := ValidateProposal(Proposal{Title: e.Title, Audience: e.Audience, Chapters: e.Chapters, Outline: b.Proposal.Outline}, known, 1)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrBadRequest, strings.TrimPrefix(err.Error(), ErrInvalidOutput.Error()+": "))
	}
	if err := s.store.SaveProposal(ctx, userID, id, p); err != nil {
		return nil, err
	}
	return s.Get(ctx, userID, id)
}

// knownAnchors is the set an outline's anchors may come from: the book's
// outline, narrowed to the ids that resolve to the caller's chunks in the
// book's knowledge base right now.
// It also returns every named id that resolved at all.
func (s *Service) knownAnchors(ctx context.Context, b *Book, chapters []ProposedChapter) (known, resolved map[uuid.UUID]bool, err error) {
	outline := map[uuid.UUID]bool{}
	for _, it := range b.Proposal.Outline {
		outline[it.ChunkID] = true
	}
	var named []uuid.UUID
	for _, ch := range chapters {
		named = append(named, ch.Anchors...)
	}
	resolved, err = s.store.ResolveAnchors(ctx, b.UserID, b.KBID, named)
	if err != nil {
		return nil, nil, err
	}
	known = map[uuid.UUID]bool{}
	for id := range resolved {
		if outline[id] {
			known[id] = true
		}
	}
	return known, resolved, nil
}

// Confirm is the second gate: the outline as it stands becomes the book's
// chapters. Its anchors are resolved once more, and nothing is compiled.
func (s *Service) Confirm(ctx context.Context, userID, id uuid.UUID) (*Book, error) {
	b, err := s.store.GetBook(ctx, userID, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if b.Status != StatusProposed {
		return nil, ErrNotEditable
	}
	known, _, err := s.knownAnchors(ctx, b, b.Proposal.Chapters)
	if err != nil {
		return nil, err
	}
	if _, err := ValidateProposal(b.Proposal, known, 1); err != nil {
		return nil, fmt.Errorf("%w: %s — edit the outline", ErrBadRequest, strings.TrimPrefix(err.Error(), ErrInvalidOutput.Error()+": "))
	}
	ok, err := s.store.Confirm(ctx, userID, id, b.Proposal.Chapters)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotEditable
	}
	return s.Get(ctx, userID, id)
}

// passageBlock renders passages for a prompt, each in the provenance
// envelope with a short id (C1, C2, …) a model copies reliably. It returns
// the block and the short ids' chunk ids.
func passageBlock(passages []Passage, snippet int) (string, map[string]uuid.UUID) {
	short := map[string]uuid.UUID{}
	parts := make([]string, 0, len(passages))
	for i, p := range passages {
		id := "C" + strconv.Itoa(i+1)
		short[id] = p.ChunkID
		label := p.Title
		if p.Page > 0 {
			label = fmt.Sprintf("%s p.%d", p.Title, p.Page)
		}
		if p.Heading != "" {
			label += " — " + p.Heading
		}
		parts = append(parts, tools.Wrap(label, id, truncate(p.Text, snippet)))
	}
	return tools.WrapAll(parts), short
}

func outlineOf(passages []Passage) []OutlineItem {
	out := make([]OutlineItem, 0, len(passages))
	for _, p := range passages {
		out = append(out, OutlineItem{ChunkID: p.ChunkID, DocumentID: p.DocumentID, Title: p.Title,
			Page: p.Page, Heading: p.Heading, Snippet: truncate(strings.TrimSpace(p.Text), editorSnippet)})
	}
	return out
}

// askJSON makes one call and decodes the JSON object in its reply. A
// provider failure wraps runtime.ErrProvider (and keeps the provider's own
// error, so a 4xx can be told apart); an answer with no usable JSON wraps
// ErrInvalidOutput. The raw reply is returned for a repair.
func askJSON(ctx context.Context, provider runtime.ChatProvider, system, user string, out any) (string, error) {
	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: provider.DefaultModel(),
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: system},
			{Role: runtime.RoleUser, Content: user},
		},
	})
	if err != nil {
		return "", fmt.Errorf("%w: %w", runtime.ErrProvider, err)
	}
	if resp == nil || strings.TrimSpace(resp.Content) == "" {
		return "", fmt.Errorf("%w: the answer was empty", ErrInvalidOutput)
	}
	payload, ok := modeljson.Extract(resp.Content)
	if !ok {
		return resp.Content, fmt.Errorf("%w: no JSON object in the answer", ErrInvalidOutput)
	}
	if err := json.Unmarshal([]byte(payload), out); err != nil {
		return payload, fmt.Errorf("%w: %s", ErrInvalidOutput, err)
	}
	return payload, nil
}

func orNone(s string) string {
	if s == "" {
		return "(none given)"
	}
	return s
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
