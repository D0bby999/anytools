package research

import (
	"context"
	"fmt"
	"strings"

	"github.com/D0bby999/anytools/internal/capabilities/staged"
	researchprompts "github.com/D0bby999/anytools/internal/prompts/research"
	"github.com/D0bby999/anytools/internal/rag/search"
	"github.com/D0bby999/anytools/internal/runtime"
)

// rephrase turns the request into one self-contained question and a title.
func (c *Capability) rephrase(ctx context.Context, tc *runtime.TurnContext, model *staged.Model) (string, string, error) {
	end := staged.Stage(tc, StageRephrase)
	defer end()

	var out struct {
		Topic string `json:"topic"`
		Title string `json:"title"`
	}
	if err := model.JSON(ctx, StageRephrase, researchprompts.Rephrase,
		"The learner's request:\n"+tc.Input, nil, &out); err != nil {
		return "", "", err
	}
	topic := strings.TrimSpace(out.Topic)
	if topic == "" {
		topic = tc.Input
	}
	title := strings.TrimSpace(out.Title)
	if title == "" {
		title = ReportTitle(tc.Input)
	}
	tc.Emit(runtime.Event{
		Type: runtime.EvProgress, Stage: StageRephrase, Source: c.Name(), Content: topic,
		Metadata: map[string]any{"title": title},
	})
	return topic, title, nil
}

// decompose splits the question into at most limits.Subqueries sub-questions.
// The cap is applied here, not trusted to the prompt: each sub-question is a
// search on the user's own key. scholarly says whether papers would help.
func (c *Capability) decompose(
	ctx context.Context, tc *runtime.TurnContext, model *staged.Model, topic string, limits Limits,
) ([]string, string, bool, error) {
	end := staged.Stage(tc, StageDecompose)
	defer end()

	var out struct {
		Subqueries []string `json:"subqueries"`
		Freshness  string   `json:"freshness"`
		Scholarly  bool     `json:"scholarly"`
	}
	if err := model.JSON(ctx, StageDecompose, researchprompts.Decompose,
		fmt.Sprintf("Question:\n%s\n\nWrite at most %d sub-questions.", topic, limits.Subqueries), nil, &out); err != nil {
		return nil, "", false, err
	}

	seen := map[string]bool{}
	subqueries := make([]string, 0, limits.Subqueries)
	for _, q := range out.Subqueries {
		q = strings.TrimSpace(q)
		key := strings.ToLower(q)
		if q == "" || seen[key] {
			continue
		}
		seen[key] = true
		subqueries = append(subqueries, q)
		if len(subqueries) == limits.Subqueries {
			break
		}
	}
	if len(subqueries) == 0 {
		subqueries = []string{topic}
	}
	freshness := search.NormalizeFreshness(out.Freshness)
	tc.Emit(runtime.Event{
		Type: runtime.EvProgress, Stage: StageDecompose, Source: c.Name(),
		Content:  fmt.Sprintf("%d sub-questions", len(subqueries)),
		Metadata: map[string]any{"subqueries": subqueries, "freshness": freshness, "scholarly": out.Scholarly},
	})
	return subqueries, freshness, out.Scholarly, nil
}

// synthesize streams the report.
func (c *Capability) synthesize(
	ctx context.Context, tc *runtime.TurnContext, model *staged.Model,
	topic string, subqueries []string, g gathered,
) (string, error) {
	end := staged.Stage(tc, StageSynthesize)
	defer end()

	var b strings.Builder
	b.WriteString("Question:\n" + topic + "\n\nSub-questions, one section each:\n")
	for i, q := range subqueries {
		b.WriteString(fmt.Sprintf("%d. %s\n", i+1, q))
	}
	b.WriteString("\n")
	if g.kbOnlyReason != "" {
		b.WriteString("The web was NOT used for this report; write from the learner's material alone and say so.\n\n")
	}
	if len(g.followUps) > 0 {
		b.WriteString("Follow-up searches run to fill gaps:\n- " + strings.Join(g.followUps, "\n- ") + "\n\n")
	}
	if len(g.openQuestions) > 0 {
		b.WriteString("Gaps a reviewer still saw (cover them under Open questions if the sources do not settle them):\n- " +
			strings.Join(g.openQuestions, "\n- ") + "\n\n")
	}
	if len(g.material) == 0 {
		b.WriteString("No sources were gathered.\n")
	} else {
		b.WriteString("Sources:\n\n" + strings.Join(g.material, "\n\n") + "\n")
	}
	return model.Stream(ctx, StageSynthesize, researchprompts.Synthesize, b.String())
}

func (c *Capability) observe(tc *runtime.TurnContext, text string) {
	c.observeAt(tc, StageGather, text)
}

func (c *Capability) observeAt(tc *runtime.TurnContext, stage, text string) {
	tc.Emit(runtime.Event{Type: runtime.EvObservation, Stage: stage, Source: c.Name(), Content: text})
}

// shortErr keeps an error on the stream to one short line.
func shortErr(err error) string {
	s := err.Error()
	if r := []rune(s); len(r) > 160 {
		s = string(r[:160]) + "…"
	}
	return s
}
