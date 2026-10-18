package book

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	bookprompts "github.com/D0bby999/anytools/internal/prompts/book"
	"github.com/D0bby999/anytools/internal/runtime"
)

// plan.go is a chapter's plan: which blocks, in which order. One call; the
// order rules are DeepTutor's page planner's (findings §8: "5-10 blocks …
// interleave … explanation → example → practice → deeper insight"), checked
// here rather than trusted.

// Plan limits.
const (
	MinBlocks = 5
	MaxBlocks = 10
	maxBrief  = 1000
	// MaterialSize is the most passages a chapter is written from.
	MaterialSize    = 12
	materialSnippet = 1800
)

// ValidatePlan checks a chapter plan and returns it tidied.
func ValidatePlan(blocks []PlannedBlock) ([]PlannedBlock, error) {
	bad := func(format string, args ...any) error {
		return fmt.Errorf("%w: %s", ErrInvalidOutput, fmt.Sprintf(format, args...))
	}
	if n := len(blocks); n < MinBlocks || n > MaxBlocks {
		return nil, bad("a chapter has %d to %d blocks, not %d", MinBlocks, MaxBlocks, n)
	}
	out := make([]PlannedBlock, 0, len(blocks))
	count := map[string]int{}
	practice := 0
	for i, b := range blocks {
		num := i + 1
		b.Type = strings.ToLower(strings.TrimSpace(b.Type))
		b.Title = strings.TrimSpace(b.Title)
		b.Brief = strings.TrimSpace(b.Brief)
		if !modelTypes[b.Type] {
			return nil, bad("block %d has type %q; use one of the types listed", num, b.Type)
		}
		if b.Title == "" || utf8.RuneCountInString(b.Title) > maxTitle {
			return nil, bad("block %d needs a title of 1 to %d characters", num, maxTitle)
		}
		if b.Brief == "" || utf8.RuneCountInString(b.Brief) > maxBrief {
			return nil, bad("block %d needs a brief of 1 to %d characters", num, maxBrief)
		}
		if i == 0 && b.Type != TypeText && b.Type != TypeCallout {
			return nil, bad("the first block must explain (text or callout), not %s", b.Type)
		}
		if isPractice(b.Type) {
			practice++
			if i > 0 && isPractice(out[i-1].Type) {
				return nil, bad("blocks %d and %d are both practice; put an explanation or example between them", num-1, num)
			}
		}
		if b.Type == TypeSummary && i != len(blocks)-1 {
			return nil, bad("the summary must be the last block")
		}
		count[b.Type]++
		out = append(out, b)
	}
	if practice == 0 {
		return nil, bad("the chapter needs at least one practice block (quiz or flash_cards)")
	}
	if count[TypeDiagram] > 2 || count[TypeQuiz] > 2 {
		return nil, bad("at most two diagram blocks and two quiz blocks")
	}
	return out, nil
}

func isPractice(t string) bool { return t == TypeQuiz || t == TypeFlashCards }

type planReply struct {
	Blocks []PlannedBlock `json:"blocks"`
}

// plan asks for a chapter's blocks, with one repair when the answer breaks a
// rule. It returns the calls it billed.
func (s *Service) plan(ctx context.Context, provider runtime.ChatProvider, b *Book, ch *Chapter, material []Passage) ([]PlannedBlock, int, error) {
	block, _ := passageBlock(material, materialSnippet)
	user := chapterContext(b, ch) + "\nPassages:\n\n" + block

	var reply planReply
	raw, err := askJSON(ctx, provider, bookprompts.Plan, user, &reply)
	if err != nil && !isInvalid(err) {
		return nil, 1, err
	}
	var planned []PlannedBlock
	if err == nil {
		planned, err = ValidatePlan(reply.Blocks)
	}
	if err == nil {
		return planned, 1, nil
	}
	reply = planReply{}
	_, rerr := askJSON(ctx, provider, bookprompts.Plan+"\n\n"+bookprompts.Repair,
		fmt.Sprintf("%s\n\nThe rule broken: %s\n\nYour answer:\n%s", user, ruleOf(err), raw), &reply)
	if rerr != nil {
		return nil, 2, rerr
	}
	planned, err = ValidatePlan(reply.Blocks)
	return planned, 2, err
}

// chapterContext is what every call about a chapter is told: the book, the
// chapter, and the chapters it builds on. Titles and objectives are the
// learner's confirmed outline, not document text.
func chapterContext(b *Book, ch *Chapter) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Book: %s\n", b.Title)
	if b.Proposal.Audience != "" {
		fmt.Fprintf(&sb, "Audience: %s\n", b.Proposal.Audience)
	}
	fmt.Fprintf(&sb, "Chapter %d: %s\n", ch.Ord, ch.Title)
	sb.WriteString("Objectives:\n")
	for _, o := range ch.Objectives {
		fmt.Fprintf(&sb, "- %s\n", o)
	}
	if len(ch.Prereqs) > 0 {
		sb.WriteString("Builds on:\n")
		for _, n := range ch.Prereqs {
			for _, other := range b.Chapters {
				if other.Ord == n {
					fmt.Fprintf(&sb, "- Chapter %d: %s\n", n, other.Title)
				}
			}
		}
	}
	return sb.String()
}

func ruleOf(err error) string {
	return strings.TrimPrefix(err.Error(), ErrInvalidOutput.Error()+": ")
}
