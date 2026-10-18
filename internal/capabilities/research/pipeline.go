// Package research is the cited-report capability: rephrase → decompose →
// gather → synthesize.
//
// The web is the user's own. Search runs on the Tavily or Brave key the user
// connected (tools.WebSearcher over byok.SearchFor); with none, the report is
// written from the knowledge base alone and says so — in the stream, on the
// stored row, and in the report's own summary (RT-13: there is no platform key
// to fall back on).
//
// The egress rule is the phase 6 one, applied through runtime.TurnContext
// .CallTool so the pipeline cannot forget it: once the learner's document text
// is in this turn's context, no network tool runs unless the session allows the
// web. Gather therefore reads the knowledge base FIRST — the web is only ever
// queried either with the learner's consent or before any of their documents
// has been read, from sub-questions derived from their own request.
package research

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/staged"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// Stages, in order. The UI renders these four plus StageVerify (verify.go).
const (
	StageRephrase   = "rephrase"
	StageDecompose  = "decompose"
	StageGather     = "gather"
	StageSynthesize = "synthesize"
)

// Modes, through StartTurn.Params["mode"].
const (
	ModeQuick = "quick"
	ModeDeep  = "deep"
)

// Why a report was written without the web. Stored in
// research_reports.kb_only_reason and pinned by its CHECK.
const (
	ReasonNoSearchKey         = "no_search_key"
	ReasonWebOffWithDocuments = "web_off_with_documents"
	ReasonSearchFailed        = "search_failed"
)

// Function is the byok route function research resolves its MODEL through
// (byok.FunctionResearch). Its search key is not a route: see byok.SearchFor.
const Function = "research"

// Limits bound one mode. Sources is the phase's cap on what the report may
// stand on: quick ≤ 5, deep ≤ 20. WebPerQuery is how many results each search
// asks for — more than the report keeps, so ranking has a choice. Rounds is
// the search-round cap (reflect.go), FollowUps the new queries per extra
// round, and Fetch how many chosen pages are read in full.
type Limits struct {
	Subqueries int
	// PaperQueries is how many sub-questions also search papers, when the
	// question is scholarly: every one in deep mode, the first two in quick.
	PaperQueries int
	// ZoteroQueries is how many sub-questions also search the learner's
	// Zotero library, when they have connected one (up-methods phase 20).
	// Their own library is searched whatever the question.
	ZoteroQueries int
	KBPerQuery    int
	WebPerQuery   int
	Fetch         int
	Sources       int
	Rounds        int
	FollowUps     int
}

// LimitsFor returns a mode's bounds; anything but deep is quick.
func LimitsFor(mode string) Limits {
	if mode == ModeDeep {
		return Limits{Subqueries: 6, PaperQueries: 6, ZoteroQueries: 6, KBPerQuery: 4, WebPerQuery: 6, Fetch: 6, Sources: 20, Rounds: 3, FollowUps: 3}
	}
	return Limits{Subqueries: 3, PaperQueries: 2, ZoteroQueries: 2, KBPerQuery: 2, WebPerQuery: 5, Fetch: 2, Sources: 5, Rounds: 1}
}

// Report is one row of research_reports.
type Report struct {
	ID           uuid.UUID          `json:"id"`
	UserID       uuid.UUID          `json:"-"`
	SessionID    *uuid.UUID         `json:"session_id,omitempty"`
	TurnID       *uuid.UUID         `json:"turn_id,omitempty"`
	Query        string             `json:"query"`
	Mode         string             `json:"mode"`
	ReportMD     string             `json:"report_md"`
	Sources      []citations.Source `json:"sources"`
	KBOnly       bool               `json:"kb_only"`
	KBOnlyReason string             `json:"kb_only_reason,omitempty"`
	NoteID       string             `json:"note_id,omitempty"`
	// Verification is the claim check (verify.go); nil on reports written
	// before it existed.
	Verification *Verification `json:"verification,omitempty"`
	// OpenQuestions are the gaps the last reflection still saw: natural next
	// research topics.
	OpenQuestions []string `json:"open_questions,omitempty"`
	// Engine is "key", "duckduckgo" or "" (no web).
	Engine    string    `json:"engine,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// ErrNotFound is the one answer for "no such report for this user".
var ErrNotFound = errors.New("research: report not found")

// Store is the persistence the capability needs; pg.ResearchStore implements it.
type Store interface {
	InsertReport(ctx context.Context, r Report) (*Report, error)
	SetReportNote(ctx context.Context, userID, reportID uuid.UUID, noteID string) error
}

// MessageStore is the transcript write.
type MessageStore interface {
	AppendMessage(ctx context.Context, m runtime.ChatMessage) (*runtime.ChatMessage, error)
}

// Capability is the research turn.
type Capability struct {
	reports  Store
	messages MessageStore
	search   tools.WebSearcher
	// notes is phase 8's notebook. Nil until that merges: the report is still
	// stored in research_reports, and the stream says the notebook copy was not
	// made rather than pretending it was.
	notes tools.NoteWriter
}

// Config assembles a Capability.
type Config struct {
	Reports  Store
	Messages MessageStore
	Search   tools.WebSearcher
	Notes    tools.NoteWriter
}

// New builds the capability.
func New(cfg Config) *Capability {
	return &Capability{reports: cfg.Reports, messages: cfg.Messages, search: cfg.Search, notes: cfg.Notes}
}

// Name implements runtime.Capability.
func (c *Capability) Name() string { return "research" }

// Run implements runtime.Capability.
func (c *Capability) Run(ctx context.Context, tc *runtime.TurnContext) error {
	model, err := staged.Resolve(ctx, tc, Function)
	if err != nil {
		return err
	}
	mode := tc.Param("mode")
	if mode != ModeDeep {
		mode = ModeQuick
	}
	limits := LimitsFor(mode)

	topic, title, err := c.rephrase(ctx, tc, model)
	if err != nil {
		return err
	}
	subqueries, freshness, scholarly, err := c.decompose(ctx, tc, model, topic, limits)
	if err != nil {
		return err
	}
	if !scholarly {
		limits.PaperQueries = 0
	}
	g, err := c.gather(ctx, tc, model, topic, subqueries, freshness, limits)
	if err != nil {
		return err
	}
	text, err := c.synthesize(ctx, tc, model, topic, subqueries, g)
	if err != nil {
		return err
	}
	// Validated before the check, so it judges exactly what the learner sees.
	res := citations.Validate(text, citations.Index(g.sources))
	check := c.verify(ctx, tc, model, res.Text, res.Sources, g)
	return c.deliver(ctx, tc, mode, title, res, g, check)
}

// deliver validates the report's citations against everything gathered, then
// stores the report row, the transcript message and — when the notebook
// exists — the note, and only then emits `result`, so the event can carry the
// report's id.
//
// Citations are validated against what the report was GIVEN (g.sources), not
// every result any search returned: a ranked-out page was never in front of
// the model, so a marker naming it is invented.
func (c *Capability) deliver(
	ctx context.Context, tc *runtime.TurnContext, mode, title string, res citations.Result, g gathered, check Verification,
) error {
	if len(res.Sources) > 0 {
		tc.Emit(runtime.Event{
			Type: runtime.EvSources, Stage: StageSynthesize, Source: c.Name(),
			Metadata: map[string]any{"sources": res.Sources},
		})
	}

	sessionID, turnID := tc.Session.ID, tc.Turn.ID
	report, err := c.reports.InsertReport(ctx, Report{
		UserID: tc.Turn.UserID, SessionID: &sessionID, TurnID: &turnID,
		Query: tc.Input, Mode: mode, ReportMD: res.Text, Sources: res.Sources,
		KBOnly: g.kbOnlyReason != "", KBOnlyReason: g.kbOnlyReason,
		Verification: &check, OpenQuestions: g.openQuestions, Engine: g.engine,
	})
	if err != nil {
		return fmt.Errorf("store report: %w", err)
	}

	noteSaved := false
	if c.notes != nil {
		noteID, err := c.notes.WriteNote(ctx, tc.Turn.UserID, tc.Session.ID, title, res.Text)
		if err != nil {
			// The report is already stored; losing the notebook copy is worth a
			// line on the stream, not the whole turn.
			slog.Warn("research: save report as note", "error", err, "report", report.ID)
		} else if err := c.reports.SetReportNote(ctx, tc.Turn.UserID, report.ID, noteID); err == nil {
			report.NoteID, noteSaved = noteID, true
		}
	}
	if !noteSaved {
		tc.Emit(runtime.Event{
			Type: runtime.EvObservation, Stage: StageSynthesize, Source: c.Name(),
			Content:  "the report is saved under Research; saving it to the notebook is not available yet",
			Metadata: map[string]any{"note_saved": false},
		})
	}

	attachments, _ := json.Marshal(map[string]any{
		"sources": res.Sources,
		"research": map[string]any{
			"report_id": report.ID, "mode": mode, "kb_only": report.KBOnly,
			"kb_only_reason": report.KBOnlyReason, "verification": check,
		},
	})
	if _, err := c.messages.AppendMessage(ctx, runtime.ChatMessage{
		UserID: tc.Turn.UserID, SessionID: tc.Session.ID, Role: runtime.RoleAssistant,
		Content: res.Text, Capability: c.Name(), Attachments: attachments,
	}); err != nil {
		return fmt.Errorf("store report message: %w", err)
	}

	tc.Emit(runtime.Event{
		Type: runtime.EvResult, Stage: StageSynthesize, Source: c.Name(), Content: res.Text,
		Metadata: map[string]any{
			"report_id":         report.ID.String(),
			"mode":              mode,
			"kb_only":           report.KBOnly,
			"kb_only_reason":    report.KBOnlyReason,
			"note_saved":        noteSaved,
			"web_sources":       g.webSources,
			"kb_sources":        g.kbSources,
			"dropped_citations": len(res.Dropped),
			"rounds":            g.rounds,
			"engine":            g.engine,
			"verification":      check,
			"open_questions":    g.openQuestions,
		},
	})
	return nil
}

// ReportTitle is the fallback title when rephrase gave none.
func ReportTitle(query string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(query), "\n")
	if r := []rune(line); len(r) > 80 {
		line = string(r[:80]) + "…"
	}
	return "Research: " + line
}

var _ runtime.Capability = (*Capability)(nil)
