package quiz

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	quizprompts "github.com/D0bby999/anytools/internal/prompts/quiz"
	"github.com/D0bby999/anytools/internal/runtime"
)

// generate.go turns a plan into questions, and is where a question earns the
// right to be stored.
//
// The validation below is not defensive padding. Every rule rejects a shape
// that a real model produces and that would be broken for a learner in a way
// they could not diagnose: a multiple-choice question whose answer is not one
// of its options, a true/false question whose answer is "It depends", a cloze
// with no blank, an explanation citing a passage that was never retrieved.

type draftQuestion struct {
	Prompt      string   `json:"prompt"`
	Type        string   `json:"type"`
	Options     []Option `json:"options"`
	Answer      string   `json:"answer"`
	Explanation string   `json:"explanation"`
	Difficulty  string   `json:"difficulty"`
	ChunkIDs    []string `json:"chunk_ids"`
}

type generationReply struct {
	Questions []draftQuestion `json:"questions"`
	Note      string          `json:"note"`
}

// generate writes the questions and returns those that survived validation,
// the model's note, and how many citation markers were dropped.
func (s *Service) generate(
	ctx context.Context, provider runtime.ChatProvider, model string,
	chunks []Chunk, ideas []Idea, types []string,
) ([]Question, string, int, error) {
	var b strings.Builder
	b.WriteString("Write one question for each planned idea below, in the same order.\n\n")
	b.WriteString("Planned ideas:\n")
	for i, idea := range ideas {
		fmt.Fprintf(&b, "%d. focus=%q type=%s difficulty=%s passages=%s\n",
			i+1, idea.Focus, idea.Type, idea.Difficulty, strings.Join(idea.ChunkIDs, ", "))
	}
	fmt.Fprintf(&b, "\nAllowed question types: %s.\n", strings.Join(types, ", "))
	b.WriteString("\nPassages:\n\n")
	b.WriteString(passageBlock(chunks))

	var reply generationReply
	if err := askJSON(ctx, provider, model, quizprompts.Generate, b.String(), &reply); err != nil {
		return nil, "", 0, err
	}

	known := chunkIndex(chunks)
	// The citation index the explanation is validated against is EXACTLY the
	// passages this call was shown. Not the knowledge base, not the user's
	// documents — a citation to something real that the generator never read is
	// still a citation nobody chose.
	sources := make([]citations.Source, 0, len(chunks))
	for _, c := range chunks {
		sources = append(sources, citations.Source{
			Kind:       citations.KindChunk,
			ID:         c.ID.String(),
			Title:      c.DocumentTitle,
			Page:       c.Page,
			DocumentID: c.DocumentID.String(),
		})
	}
	index := citations.Index(sources)

	allowed := make(map[string]bool, len(types))
	for _, t := range types {
		allowed[t] = true
	}

	out := make([]Question, 0, len(reply.Questions))
	dropped := 0
	for _, d := range reply.Questions {
		q, n, ok := buildQuestion(d, allowed, known, index)
		dropped += n
		if !ok {
			continue
		}
		out = append(out, q)
	}
	return out, reply.Note, dropped, nil
}

// buildQuestion validates one draft and returns the row to store.
func buildQuestion(
	d draftQuestion, allowed map[string]bool, known map[string]Chunk, index map[string]citations.Source,
) (Question, int, bool) {
	prompt := strings.TrimSpace(d.Prompt)
	answer := strings.TrimSpace(d.Answer)
	qType := strings.ToLower(strings.TrimSpace(d.Type))

	if prompt == "" || answer == "" || !allowed[qType] {
		return Question{}, 0, false
	}
	if len(prompt) > 4000 {
		return Question{}, 0, false
	}

	// The explanation is validated BEFORE storage, exactly as a chat answer is
	// (internal/capabilities/chat.deliver). An unverifiable marker that reached
	// the row would be a citation in the bank forever, pointing at nothing.
	res := citations.Validate(strings.TrimSpace(d.Explanation), index)
	dropped := len(res.Dropped)

	options := normalizeOptions(d.Options)

	switch qType {
	case TypeMCQ:
		if len(options) < 2 {
			return Question{}, dropped, false
		}
		label, ok := matchOptionLabel(options, answer)
		if !ok {
			// The model answered with the option's TEXT, or with a label that
			// is not in the list. Text is recoverable; a label nobody offered
			// is a question that cannot be marked.
			return Question{}, dropped, false
		}
		answer = label
	case TypeTF:
		norm, ok := normalizeBoolean(answer)
		if !ok {
			return Question{}, dropped, false
		}
		answer = norm
		options = nil
	case TypeCloze:
		if !strings.Contains(prompt, "____") {
			return Question{}, dropped, false
		}
		options = nil
	case TypeShort:
		options = nil
	}

	chunkIDs := parseChunkIDs(d.ChunkIDs, known)
	if len(chunkIDs) == 0 {
		// A question with no passage behind it cannot be traced back to the
		// material, which is the one thing this product promises about it.
		return Question{}, dropped, false
	}

	return Question{
		Prompt:         prompt,
		Type:           qType,
		Options:        options,
		Answer:         answer,
		Explanation:    res.Text,
		Difficulty:     normalizeDifficulty(d.Difficulty),
		SourceChunkIDs: chunkIDs,
	}, dropped, true
}

// normalizeOptions trims, drops empties and relabels A, B, C… in order.
//
// Relabelling rather than trusting the model's labels: a reply that skipped D
// or repeated B produces a question whose radio group has two values that are
// the same string, which silently marks the wrong one correct.
func normalizeOptions(in []Option) []Option {
	out := make([]Option, 0, len(in))
	for _, o := range in {
		body := strings.TrimSpace(o.Body)
		if body == "" {
			continue
		}
		out = append(out, Option{Label: string(rune('A' + len(out))), Body: body})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// matchOptionLabel resolves the model's answer to one of the option labels,
// accepting either the label or the option text.
func matchOptionLabel(options []Option, answer string) (string, bool) {
	trimmed := strings.TrimSpace(answer)
	// "A", "a", "A.", "(A)", "A) …"
	cleaned := strings.ToUpper(strings.Trim(trimmed, "().: "))
	if i := strings.IndexAny(cleaned, " .)"); i > 0 {
		cleaned = cleaned[:i]
	}
	for _, o := range options {
		if o.Label == cleaned {
			return o.Label, true
		}
	}
	for _, o := range options {
		if strings.EqualFold(strings.TrimSpace(o.Body), trimmed) {
			return o.Label, true
		}
	}
	// A model that answered "1" for the first option.
	if n, err := strconv.Atoi(cleaned); err == nil && n >= 1 && n <= len(options) {
		return options[n-1].Label, true
	}
	return "", false
}

// normalizeBoolean maps a true/false answer onto the two strings the judge
// compares against.
func normalizeBoolean(s string) (string, bool) {
	switch strings.ToLower(strings.Trim(strings.TrimSpace(s), ".")) {
	case "true", "t", "yes", "y":
		return "true", true
	case "false", "f", "no", "n":
		return "false", true
	}
	return "", false
}

// marshalJudge renders a judgement for the `question_attempts.judge` column.
func marshalJudge(j Judgement) json.RawMessage {
	b, err := json.Marshal(j)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return b
}

// The bank's own rules for options, answers, difficulties and passages,
// exported so the mock exam (internal/capabilities/exam) stores exactly what
// this generator would. Two copies of "what makes an mcq markable" would
// drift, and the marking in judge.go reads one of them.

// NormalizeOptions trims, drops empties and relabels A, B, C… in order.
func NormalizeOptions(in []Option) []Option { return normalizeOptions(in) }

// MatchOptionLabel resolves an answer to one of the option labels.
func MatchOptionLabel(options []Option, answer string) (string, bool) {
	return matchOptionLabel(options, answer)
}

// NormalizeBoolean maps a true/false answer onto "true" or "false".
func NormalizeBoolean(s string) (string, bool) { return normalizeBoolean(s) }

// NormalizeDifficulty maps anything unknown to medium.
func NormalizeDifficulty(d string) string { return normalizeDifficulty(d) }

// PassageBlock renders retrieved chunks inside the provenance envelope.
func PassageBlock(chunks []Chunk) string { return passageBlock(chunks) }

// ChunkIDs keeps the ids that name one of the given chunks, as uuids.
func ChunkIDs(ids []string, chunks []Chunk) []uuid.UUID {
	return parseChunkIDs(ids, chunkIndex(chunks))
}
