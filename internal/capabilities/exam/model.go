package exam

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/runtime"
)

// errNoQuizModel is a job whose learner removed their Quizzes route after
// starting it.
var errNoQuizModel = errors.New("no model is routed to Quizzes — add one in Settings → Routes and try again")

// errBadReply is a reply with no usable JSON: worth a repair, not a retry.
var errBadReply = errors.New("the reply was not the JSON asked for")

// askJSON makes one non-streaming call and decodes the reply into out. A
// provider failure is wrapped in runtime.ErrProvider; a reply with no JSON
// object is errBadReply.
func askJSON(ctx context.Context, provider runtime.ChatProvider, system, user string, out any) error {
	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: provider.DefaultModel(),
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: system},
			{Role: runtime.RoleUser, Content: user},
		},
	})
	if err != nil {
		return fmt.Errorf("%w: %w", runtime.ErrProvider, err)
	}
	if resp == nil || strings.TrimSpace(resp.Content) == "" {
		return errBadReply
	}
	payload, ok := modeljson.Extract(resp.Content)
	if !ok {
		return errBadReply
	}
	if err := json.Unmarshal([]byte(payload), out); err != nil {
		return fmt.Errorf("%w: %s", errBadReply, err)
	}
	return nil
}

// terminalIfFinal marks errors a retry cannot fix as terminal: no route at
// all, and a provider refusal (a 4xx other than 429).
func terminalIfFinal(err error) error {
	var term *jobs.TerminalError
	if err == nil || errors.As(err, &term) {
		return err
	}
	if errors.Is(err, runtime.ErrNoProvider) {
		// The job's error is what the page shows: say what to do.
		return jobs.Terminal(errNoQuizModel)
	}
	if errors.Is(err, ErrNeedsParseModel) {
		return jobs.Terminal(err)
	}
	var he *providers.HTTPError
	if errors.As(err, &he) && he.Status >= 400 && he.Status < 500 && he.Status != 429 {
		return jobs.Terminal(err)
	}
	return err
}
