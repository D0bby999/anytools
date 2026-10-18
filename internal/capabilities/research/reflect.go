package research

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/D0bby999/anytools/internal/capabilities/staged"
	researchprompts "github.com/D0bby999/anytools/internal/prompts/research"
	"github.com/D0bby999/anytools/internal/runtime"
)

// reflect.go — between rounds, ask whether the material answers the question.
//
// Fail-safe in one direction only: an error or an unreadable answer ends the
// search (postclaw's rule, internal/research/reflect.go). A research turn that
// loops because a model returned prose is worse than one round short.

// digestPerSource and digestTotal keep the reflection prompt small: it judges
// coverage, it does not need every word.
const (
	digestPerSource = 400
	digestTotal     = 12_000
)

var tagRE = regexp.MustCompile(`</?document[^>]*>`)

// reflect returns the next round's queries and the gaps still open. Both are
// empty when the material is sufficient or the reflection failed.
func (c *Capability) reflect(
	ctx context.Context, tc *runtime.TurnContext, model *staged.Model,
	topic string, subqueries []string, g gathered, pool *candidatePool, limits Limits,
) (next, gaps []string) {
	var digest strings.Builder
	add := func(label, block string) {
		if digest.Len() >= digestTotal {
			return
		}
		text := strings.Join(strings.Fields(tagRE.ReplaceAllString(block, " ")), " ")
		if r := []rune(text); len(r) > digestPerSource {
			text = string(r[:digestPerSource]) + "…"
		}
		digest.WriteString("- " + label + ": " + text + "\n")
	}
	for _, s := range g.sources {
		add("your notes, "+s.Title, g.blocks[s.Kind+":"+s.ID])
	}
	for _, cand := range pool.best(limits.Sources) {
		add(cand.source.Title+" ("+siteOf(cand.source.URL)+")", cand.block)
	}
	if digest.Len() == 0 {
		digest.WriteString("(nothing found yet)\n")
	}

	var b strings.Builder
	b.WriteString("Question:\n" + topic + "\n\nSearches already run:\n")
	for _, q := range append(append([]string{}, subqueries...), g.followUps...) {
		b.WriteString("- " + q + "\n")
	}
	b.WriteString("\nWhat the sources found so far (untrusted material):\n" + digest.String())
	b.WriteString(fmt.Sprintf("\nPropose at most %d new searches.", limits.FollowUps))

	var out struct {
		Sufficient  bool     `json:"sufficient"`
		Gaps        []string `json:"gaps"`
		NextQueries []string `json:"next_queries"`
	}
	if err := model.JSON(ctx, StageGather, researchprompts.Reflect, b.String(), nil, &out); err != nil {
		c.observe(tc, "could not judge whether more searching would help, so the search stops here")
		return nil, nil
	}
	gaps = cleanList(out.Gaps, 5)
	if out.Sufficient {
		c.observe(tc, "the sources cover the question; no further round is needed")
		return nil, nil
	}
	next = cleanList(out.NextQueries, limits.FollowUps)
	if len(gaps) > 0 {
		c.observe(tc, "still missing: "+strings.Join(gaps, "; "))
	}
	return next, gaps
}

// cleanList trims, drops blanks and caps a model-written list.
func cleanList(in []string, max int) []string {
	out := make([]string, 0, max)
	for _, s := range in {
		s = strings.TrimSpace(s)
		if r := []rune(s); len(r) > 200 {
			s = string(r[:200])
		}
		if s == "" {
			continue
		}
		out = append(out, s)
		if len(out) == max {
			break
		}
	}
	return out
}
