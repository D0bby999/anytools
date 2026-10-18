package book

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/capabilities/visualize"
	"github.com/D0bby999/anytools/internal/citations"
	bookprompts "github.com/D0bby999/anytools/internal/prompts/book"
	visualizeprompts "github.com/D0bby999/anytools/internal/prompts/visualize"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/vocab"
)

// blocks.go writes one block and holds it to the rules of its type. Each
// type has a validator; a block that breaks its rules is refused, and the
// caller marks it `error` with the reason. Nothing here stores anything.

// Block types, as book_blocks.type CHECKs them. `note` is the learner's own
// and never the model's.
const (
	TypeText          = "text"
	TypeCallout       = "callout"
	TypeWorkedExample = "worked_example"
	TypeDiagram       = "diagram"
	TypeQuiz          = "quiz"
	TypeFlashCards    = "flash_cards"
	TypeSummary       = "summary"
	TypeNote          = "note"
)

// modelTypes are the types a chapter plan may ask for.
var modelTypes = map[string]bool{
	TypeText: true, TypeCallout: true, TypeWorkedExample: true, TypeDiagram: true,
	TypeQuiz: true, TypeFlashCards: true, TypeSummary: true,
}

// Block limits.
const (
	maxMarkdown     = 8000
	maxCallout      = 2000
	maxProblem      = 2000
	maxStep         = 1500
	maxAnswer       = 1000
	minSteps        = 2
	maxSteps        = 12
	minFlashCards   = 3
	maxFlashCards   = 8
	quizQuestions   = 3
	calloutVariants = "definition warning tip"
)

// Payloads, by type: what the reader renders and the export writes.
type (
	// MarkdownPayload is a text, summary or note block.
	MarkdownPayload struct {
		Markdown string `json:"markdown"`
	}
	// CalloutPayload is a definition, warning or tip.
	CalloutPayload struct {
		Variant  string `json:"variant"`
		Title    string `json:"title"`
		Markdown string `json:"markdown"`
	}
	// ExamplePayload is a worked example.
	ExamplePayload struct {
		Problem string   `json:"problem"`
		Steps   []string `json:"steps"`
		Answer  string   `json:"answer"`
	}
	// QuizPayload names the block's questions in the bank.
	QuizPayload struct {
		QuestionIDs []uuid.UUID `json:"question_ids"`
	}
	// FlashPayload is empty: the cards are rows of vocab_cards, where their
	// schedule lives.
	FlashPayload struct {
		Count int `json:"count"`
	}
)

// written is one block's output after its rules, ready to store.
type written struct {
	payload any
	sources []citations.Source
	flash   []vocab.FlashCard
}

// material is a chapter's passages with their prompt ids.
type material struct {
	passages []Passage
	block    string
	short    map[string]uuid.UUID
	index    map[string]citations.Source
	byID     map[uuid.UUID]Passage
}

func newMaterial(passages []Passage) material {
	block, short := passageBlock(passages, materialSnippet)
	m := material{passages: passages, block: block, short: short,
		index: map[string]citations.Source{}, byID: map[uuid.UUID]Passage{}}
	for _, p := range passages {
		m.byID[p.ChunkID] = p
		m.index[citations.Key(citations.KindChunk, p.ChunkID.String())] = citations.Source{
			Kind: citations.KindChunk, ID: p.ChunkID.String(), Title: p.Title, Page: p.Page,
			DocumentID: p.DocumentID.String(),
		}
	}
	return m
}

// cite turns the model's `[[cite:chunk:C2]]` markers into chunk ids and keeps
// only those that name a passage this call was given: an invented one is
// dropped, never shown.
func (m material) cite(text string) citations.Result {
	for _, ref := range citations.Parse(text) {
		if ref.Kind != citations.KindChunk {
			continue
		}
		if id, ok := m.short[ref.ID]; ok {
			text = strings.ReplaceAll(text, ref.Match, citations.Format(citations.KindChunk, id.String()))
		}
	}
	return citations.Validate(text, m.index)
}

// write asks for one block and holds it to its type's rules. It returns the
// calls it billed; a broken rule wraps ErrInvalidOutput.
func (s *Service) write(ctx context.Context, b *Book, ch *Chapter, blk *Block, before []Block, m material) (*written, int, error) {
	switch blk.Type {
	case TypeQuiz:
		return s.writeQuiz(ctx, b, blk, m)
	case TypeDiagram:
		return s.writeDiagram(ctx, b, ch, blk, m)
	}
	section, ok := map[string]string{
		TypeText: bookprompts.Text, TypeCallout: bookprompts.Callout, TypeWorkedExample: bookprompts.WorkedExample,
		TypeFlashCards: bookprompts.FlashCards, TypeSummary: bookprompts.Summary,
	}[blk.Type]
	if !ok {
		return nil, 0, fmt.Errorf("%w: a %s block is not written by the model", ErrInvalidOutput, blk.Type)
	}
	provider, err := s.models.ChatFor(ctx, b.UserID, "chat")
	if err != nil {
		return nil, 0, err
	}
	var raw json.RawMessage
	if _, err := askJSON(ctx, provider, bookprompts.Block+"\n\n"+section, blockRequest(b, ch, blk, before, m), &raw); err != nil {
		return nil, 1, err
	}
	w, err := ValidateBlock(blk.Type, raw, m)
	return w, 1, err
}

// blockRequest is the user message for one block: where it sits, what it
// is for, and the chapter's passages.
func blockRequest(b *Book, ch *Chapter, blk *Block, before []Block, m material) string {
	var sb strings.Builder
	sb.WriteString(chapterContext(b, ch))
	if len(before) > 0 {
		sb.WriteString("The blocks before this one:\n")
		for _, o := range before {
			fmt.Fprintf(&sb, "- %s: %s\n", o.Type, o.Title)
		}
	}
	fmt.Fprintf(&sb, "\nThis block (%s): %s\nBrief: %s\n\nPassages:\n\n%s", blk.Type, blk.Title, blk.Brief, m.block)
	return sb.String()
}

// ValidateBlock holds a model's block to its type's rules.
func ValidateBlock(kind string, raw json.RawMessage, m material) (*written, error) {
	bad := func(format string, args ...any) error {
		return fmt.Errorf("%w: %s", ErrInvalidOutput, fmt.Sprintf(format, args...))
	}
	// cited checks a piece of prose: within max, and resting on at least one
	// passage once invented citations are dropped.
	cited := func(what, text string, max int) (citations.Result, error) {
		text = strings.TrimSpace(text)
		if text == "" {
			return citations.Result{}, bad("the %s is empty", what)
		}
		if utf8.RuneCountInString(text) > max {
			return citations.Result{}, bad("the %s is over %d characters", what, max)
		}
		return m.cite(text), nil
	}
	needSources := func(sources []citations.Source) error {
		if len(sources) == 0 {
			return bad("the block cites none of the passages it was given")
		}
		return nil
	}

	switch kind {
	case TypeText, TypeSummary:
		var p MarkdownPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, bad("reply with {\"markdown\": …}")
		}
		res, err := cited("text", p.Markdown, maxMarkdown)
		if err != nil {
			return nil, err
		}
		if err := needSources(res.Sources); err != nil {
			return nil, err
		}
		return &written{payload: MarkdownPayload{Markdown: res.Text}, sources: res.Sources}, nil

	case TypeCallout:
		var p CalloutPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, bad("reply with {\"variant\", \"title\", \"markdown\"}")
		}
		p.Variant = strings.ToLower(strings.TrimSpace(p.Variant))
		if p.Variant == "" || !strings.Contains(" "+calloutVariants+" ", " "+p.Variant+" ") {
			return nil, bad("the variant is definition, warning or tip, not %q", p.Variant)
		}
		p.Title = strings.TrimSpace(citations.Strip(p.Title))
		if utf8.RuneCountInString(p.Title) > maxTitle {
			return nil, bad("the title is over %d characters", maxTitle)
		}
		res, err := cited("callout", p.Markdown, maxCallout)
		if err != nil {
			return nil, err
		}
		if err := needSources(res.Sources); err != nil {
			return nil, err
		}
		p.Markdown = res.Text
		return &written{payload: p, sources: res.Sources}, nil

	case TypeWorkedExample:
		var p ExamplePayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, bad("reply with {\"problem\", \"steps\", \"answer\"}")
		}
		if n := len(p.Steps); n < minSteps || n > maxSteps {
			return nil, bad("a worked example has %d to %d steps, not %d", minSteps, maxSteps, n)
		}
		var sources []citations.Source
		seen := map[string]bool{}
		keep := func(res citations.Result) string {
			for _, src := range res.Sources {
				if !seen[src.ID] {
					seen[src.ID] = true
					sources = append(sources, src)
				}
			}
			return res.Text
		}
		res, err := cited("problem", p.Problem, maxProblem)
		if err != nil {
			return nil, err
		}
		p.Problem = keep(res)
		for i, step := range p.Steps {
			res, err := cited(fmt.Sprintf("step %d", i+1), step, maxStep)
			if err != nil {
				return nil, err
			}
			p.Steps[i] = keep(res)
		}
		if res, err = cited("answer", p.Answer, maxAnswer); err != nil {
			return nil, err
		}
		p.Answer = keep(res)
		if err := needSources(sources); err != nil {
			return nil, err
		}
		return &written{payload: p, sources: sources}, nil

	case TypeFlashCards:
		var p struct {
			Cards     []vocab.FlashCard `json:"cards"`
			SourceIDs []string          `json:"source_ids"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, bad("reply with {\"cards\": [{\"front\", \"back\"}], \"source_ids\"}")
		}
		if n := len(p.Cards); n < minFlashCards || n > maxFlashCards {
			return nil, bad("a flash-card block has %d to %d cards, not %d", minFlashCards, maxFlashCards, n)
		}
		for i := range p.Cards {
			p.Cards[i].Front = citations.Strip(p.Cards[i].Front)
			p.Cards[i].Back = citations.Strip(p.Cards[i].Back)
		}
		cards, err := vocab.CleanFlashCards(p.Cards)
		if err != nil {
			return nil, bad("%s", strings.TrimPrefix(err.Error(), vocab.ErrInvalid.Error()+": "))
		}
		var sources []citations.Source
		seen := map[string]bool{}
		for _, id := range p.SourceIDs {
			chunk, ok := m.short[strings.TrimSpace(id)]
			if !ok || seen[id] {
				continue
			}
			seen[id] = true
			sources = append(sources, m.index[citations.Key(citations.KindChunk, chunk.String())])
		}
		if err := needSources(sources); err != nil {
			return nil, err
		}
		return &written{payload: FlashPayload{Count: len(cards)}, sources: sources, flash: cards}, nil
	}
	return nil, bad("a %s block is not written from a reply", kind)
}

// writeQuiz writes a quiz block's questions on the learner's `quiz` route,
// through the question bank: they are real rows with the book's kb_id, so
// they show up in the bank, in practice and as evidence.
func (s *Service) writeQuiz(ctx context.Context, b *Book, blk *Block, m material) (*written, int, error) {
	chunks := make([]quiz.Chunk, 0, len(m.passages))
	for _, p := range m.passages {
		chunks = append(chunks, quiz.Chunk{ID: p.ChunkID, DocumentID: p.DocumentID, DocumentTitle: p.Title, Page: p.Page, Text: p.Text})
	}
	focus := blk.Title
	if blk.Brief != "" {
		focus += ": " + blk.Brief
	}
	res, err := s.quiz.GenerateFromPassages(ctx, b.UserID, b.KBID, chunks, quizQuestions, focus)
	switch {
	case errors.Is(err, quiz.ErrNoQuestions), errors.Is(err, quiz.ErrBadModelOutput):
		return nil, 1, fmt.Errorf("%w: no usable question came back", ErrInvalidOutput)
	case errors.Is(err, quiz.ErrNoAccess):
		return nil, 0, ErrNotFound
	case err != nil:
		return nil, 1, err
	}
	p := QuizPayload{}
	var sources []citations.Source
	seen := map[uuid.UUID]bool{}
	for _, q := range res.Questions {
		p.QuestionIDs = append(p.QuestionIDs, q.ID)
		for _, id := range q.SourceChunkIDs {
			if pass, ok := m.byID[id]; ok && !seen[id] {
				seen[id] = true
				sources = append(sources, m.index[citations.Key(citations.KindChunk, pass.ChunkID.String())])
			}
		}
	}
	return &written{payload: p, sources: sources}, 1, nil
}

// writeDiagram draws one diagram with phase 5's own prompt and validator: a
// Mermaid or chart source that breaks their rules is refused here exactly
// as "Draw it" refuses it, and the browser draws it through RichText.
func (s *Service) writeDiagram(ctx context.Context, b *Book, ch *Chapter, blk *Block, m material) (*written, int, error) {
	provider, err := s.models.ChatFor(ctx, b.UserID, "chat")
	if err != nil {
		return nil, 0, err
	}
	var d visualize.Diagram
	user := fmt.Sprintf("%s\nDraw: %s\nBrief: %s\n\nContent:\n\n%s", chapterContext(b, ch), blk.Title, blk.Brief, m.block)
	if _, err := askJSON(ctx, provider, visualizeprompts.Draw, user, &d); err != nil {
		return nil, 1, err
	}
	clean, err := visualize.Validate(d)
	if err != nil {
		return nil, 1, fmt.Errorf("%w: %s", ErrInvalidOutput, err)
	}
	clean.Caption = citations.Strip(clean.Caption)
	return &written{payload: clean}, 1, nil
}

func isInvalid(err error) bool { return errors.Is(err, ErrInvalidOutput) }

// providerFailure reports whether err is the provider's fault (a failed or
// refused call, or no route at all) rather than an answer that broke a rule.
func providerFailure(err error) bool {
	return err != nil && !isInvalid(err) &&
		(errors.Is(err, runtime.ErrProvider) || errors.Is(err, runtime.ErrNoProvider))
}
