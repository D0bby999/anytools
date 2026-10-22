package mastery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/locale"
	masteryprompts "github.com/D0bby999/anytools/internal/prompts/mastery"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// learn.go is DeepTutor's two missing moves (learning-depth phase 2): teach a
// knowledge point before testing it, and for concept and design points make
// the learner explain it back.
//
// The division of labour is the plan's first principle. The model writes the
// explanation and proposes a verdict with its gaps; Go decides what counts —
// which citations survive, whether a verdict with a misconception can pass,
// what the schedule does, and whether a module may graduate.

// Next's kinds. A client that predates them reads `question`, which is the
// shape it always had.
const (
	NextQuestionKind = "question"
	NextLearnKind    = "learn"
	NextExplainKind  = "explain_back"
)

// EventTeachFailed is the mastery event Next writes when it could not teach a
// point; PointProgress reads it as "taught" so the failure is not re-billed.
const EventTeachFailed = "point_teach_failed"

// Explain-back verdicts, exactly as `explain_back_attempts.verdict` CHECKs them.
const (
	VerdictPending  = "pending"
	VerdictPassed   = "passed"
	VerdictFailed   = "failed"
	VerdictUnjudged = "unjudged"
)

// Bounds on what the learner writes and what the model may return.
const (
	ExplainMinChars = 20
	ExplainMaxChars = 4000
	// MaxVariants is how many "explain it differently" angles a point keeps.
	MaxVariants = 5
	// learnPassages and judgePassages are how many retrieved passages each
	// call is shown: enough to cover one idea, few enough to stay cheap.
	learnPassages = 6
	judgePassages = 6
	maxFeedback   = 120
	maxBodyRunes  = 6000
)

var (
	// ErrNoMaterial: retrieval found nothing in the knowledge base about the
	// point, so there is nothing to teach from or judge against.
	ErrNoMaterial = errors.New("mastery: your documents say nothing about this knowledge point")
	// ErrBadExplanation: the model's explanation was unreadable or cited none
	// of the passages it was given. Nothing is cached.
	ErrBadExplanation = errors.New("mastery: your model did not return a usable explanation")
	// ErrStillJudging: a replay of a request whose first judgement has not
	// finished. The first one will answer; this one must not pay again.
	ErrStillJudging = errors.New("mastery: this explanation is still being judged")
)

// angles are the routes in for "explain it differently", by variant.
var angles = []string{
	"Explain it plainly, as a first explanation.",
	"Explain it through an analogy from everyday life, then map the analogy back to the precise idea.",
	"Start from one concrete example taken from the passages, and generalise from it.",
	"Start from the most common confusion about this idea and contrast it with what is actually true.",
	"Walk through it step by step, in the order someone would reason it out.",
}

// Explanation is a cached teaching text for one knowledge point.
type Explanation struct {
	ID               uuid.UUID          `json:"id"`
	UserID           uuid.UUID          `json:"-"`
	KnowledgePointID uuid.UUID          `json:"knowledge_point_id"`
	Model            string             `json:"model"`
	Variant          int                `json:"variant"`
	BodyMD           string             `json:"body_md"`
	Sources          []citations.Source `json:"sources"`
	// Stale is true when a document it cites has been re-parsed, re-synced or
	// deleted since it was written: shown with a "sources changed" notice.
	Stale     bool      `json:"stale"`
	Cached    bool      `json:"cached"`
	CreatedAt time.Time `json:"created_at"`
	// Lang is the language it was written for, "" when it followed the
	// documents; part of the cache key.
	Lang string `json:"lang"`
}

// DocVersion is one cited document's version when an explanation was written.
type DocVersion struct {
	DocumentID uuid.UUID `json:"document_id"`
	Version    int       `json:"version"`
}

// ExplainBackAttempt is one explanation the learner wrote, and its verdict.
type ExplainBackAttempt struct {
	ID               uuid.UUID          `json:"id"`
	UserID           uuid.UUID          `json:"-"`
	KnowledgePointID uuid.UUID          `json:"knowledge_point_id"`
	PathID           uuid.UUID          `json:"path_id"`
	RequestID        uuid.UUID          `json:"request_id"`
	Explanation      string             `json:"explanation"`
	Verdict          string             `json:"verdict"`
	Passed           bool               `json:"passed"`
	Gaps             []string           `json:"gaps"`
	Misconceptions   []string           `json:"misconceptions"`
	Feedback         string             `json:"feedback"`
	Sources          []citations.Source `json:"sources"`
	Model            string             `json:"model,omitempty"`
	// OverridePassed is the learner's own verdict ("I think this was judged
	// wrongly"). The judge's verdict above is never rewritten, so the record
	// always says who decided what.
	OverridePassed *bool      `json:"override_passed,omitempty"`
	OverriddenAt   *time.Time `json:"overridden_at,omitempty"`
	JudgedAt       *time.Time `json:"judged_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// EffectivePassed is what the gate reads: the learner's override when there is
// one, otherwise the judge's verdict.
func (a ExplainBackAttempt) EffectivePassed() bool {
	if a.OverridePassed != nil {
		return *a.OverridePassed
	}
	return a.Verdict == VerdictPassed
}

// ExplainVerdict is what a finished judgement writes onto its attempt.
type ExplainVerdict struct {
	Verdict        string
	Gaps           []string
	Misconceptions []string
	Feedback       string
	Sources        []citations.Source
	Model          string
}

// PointProgress is what Next needs to decide between teaching, testing and
// asking for an explanation.
type PointProgress struct {
	HasCorrect bool
	// Taught: an explanation is cached for the point, or a session already
	// tried to teach it and the model or the material could not (an event),
	// so Next does not pay for the same failure on every visit.
	Taught        bool
	ExplainPassed bool
	// AwaitingExplain: a concept or design point with a correct answer, no
	// passed explain-back, and no explain-back since its latest correct answer.
	AwaitingExplain bool
}

// LearnStore is the persistence learn and explain-back need. It is part of
// Store; pg.MasteryStore implements it in internal/store/pg/mastery_learn.go.
type LearnStore interface {
	PointProgress(ctx context.Context, userID, kpID uuid.UUID) (*PointProgress, error)
	// AwaitingExplainBack lists the path's active points whose next step is
	// an explain-back, oldest correct answer first.
	AwaitingExplainBack(ctx context.Context, userID, pathID uuid.UUID) ([]uuid.UUID, error)

	// Explanation reads a cached explanation; ErrNotFound when there is none.
	// Stale is computed against the cited documents' current versions.
	Explanation(ctx context.Context, userID, kpID uuid.UUID, model string, variant int, lang string) (*Explanation, error)
	// SaveExplanation writes (or rewrites) one variant with the versions of
	// the documents it cites.
	SaveExplanation(ctx context.Context, e Explanation, versions []DocVersion) (*Explanation, error)
	// DocumentVersions reads the caller's documents' current versions.
	DocumentVersions(ctx context.Context, userID uuid.UUID, docIDs []uuid.UUID) ([]DocVersion, error)
	// ResolveSources re-reads chunk ids as citable sources, scoped to the
	// owner: an id that is not theirs, or no longer exists, is absent.
	ResolveSources(ctx context.Context, userID uuid.UUID, chunkIDs []uuid.UUID) ([]citations.Source, error)

	// ReserveExplainBack inserts a pending attempt under its request id, or
	// returns the existing one with created=false.
	ReserveExplainBack(ctx context.Context, a ExplainBackAttempt) (attempt *ExplainBackAttempt, created bool, err error)
	// ReleaseExplainBack deletes a still-pending reservation after a failure
	// that billed nothing, so the same request id can be retried.
	ReleaseExplainBack(ctx context.Context, userID, attemptID uuid.UUID) error
	// RecordExplainVerdict writes the verdict and, for passed or failed, rates
	// the knowledge point through RateKnowledgePoint in the same transaction.
	RecordExplainVerdict(ctx context.Context, userID, attemptID uuid.UUID, v ExplainVerdict, now time.Time) (*ExplainBackAttempt, *quiz.Scheduled, error)
	// OverrideExplainBack records the learner's opposite verdict and replays
	// the rating when nothing has rated the point since.
	OverrideExplainBack(ctx context.Context, userID, attemptID uuid.UUID, now time.Time) (*ExplainBackAttempt, *quiz.Scheduled, error)
	// LatestExplainBack is the point's newest judged attempt; ErrNotFound
	// when it has none.
	LatestExplainBack(ctx context.Context, userID, kpID uuid.UUID) (*ExplainBackAttempt, error)
	// ExplainStatus is the path's gate flag and each point's explain_passed_at.
	ExplainStatus(ctx context.Context, userID, pathID uuid.UUID) (gate bool, passed map[uuid.UUID]time.Time, err error)
}

// Profile renders the learner profile for a mastery call (learning-depth
// phase 9): the learner's Preferences and their Struggles in the path's
// knowledge base, accepted entries only, quoted inside the provenance
// envelope — or "" when there are none. The wiring renders it; this package
// only places it.
type Profile interface {
	MasteryNote(ctx context.Context, userID, kbID uuid.UUID) (string, error)
}

// profileNote is the note for this learner and knowledge base, followed by a
// blank line, or "". A profile that cannot be read costs the call its
// adaptation, not the explanation.
func (s *Service) profileNote(ctx context.Context, userID, kbID uuid.UUID) string {
	if s.profile == nil {
		return ""
	}
	note, err := s.profile.MasteryNote(ctx, userID, kbID)
	if err != nil {
		slog.Warn("mastery: learner profile unavailable", "user", userID, "error", err)
		return ""
	}
	if note == "" {
		return ""
	}
	return note + "\n\n"
}

// NeedsExplainBack reports whether a knowledge-point type is gated by an
// explain-back: the qualitative types, as in DeepTutor's policy.
func NeedsExplainBack(kpType string) bool {
	return kpType == learning.TypeConcept || kpType == learning.TypeDesign
}

// ── learn ─────────────────────────────────────────────────────────────────

// LearnRequest is `POST /v1/mastery/points/{id}/learn`.
type LearnRequest struct {
	// Variant is the angle: absent means the plain explanation, and "explain
	// it differently" asks for the next one.
	Variant *int `json:"variant,omitempty"`
	// Refresh rewrites a cached explanation from the current sources. The
	// learn card offers it when the cache is stale.
	Refresh bool `json:"refresh,omitempty"`
	// Lang asks for this one explanation in another language than the
	// path's ("Explain in English"): a code, or "source".
	Lang string `json:"lang,omitempty"`
}

// Learn returns the cached explanation for a point, or writes it.
//
// A second visit costs nothing: the cache is keyed on (point, model, variant).
// A stale entry is SERVED, flagged, rather than silently regenerated — the
// learner sees "sources changed" and decides whether to spend a call on a
// rewrite (Refresh).
func (s *Service) Learn(ctx context.Context, userID, kpID uuid.UUID, req LearnRequest) (*Explanation, error) {
	variant := 0
	if req.Variant != nil {
		variant = *req.Variant
	}
	if variant < 0 || variant >= MaxVariants {
		return nil, fmt.Errorf("%w: variant must be between 0 and %d", ErrBadRequest, MaxVariants-1)
	}
	// Ownership first, and before any model is resolved: a foreign point id
	// is a 404, never a "no provider" that says the id was real.
	point, module, err := s.store.KnowledgePoint(ctx, userID, kpID)
	if err != nil {
		return nil, err
	}
	path, err := s.store.GetPath(ctx, userID, module.PathID)
	if err != nil {
		return nil, err
	}
	if req.Lang != "" && !ValidExplainLang(req.Lang) {
		return nil, fmt.Errorf("%w: that is not a language code", ErrBadRequest)
	}
	ctx = inLanguage(ctx, path.ExplainLang)
	if req.Lang != "" {
		ctx = inLanguage(ctx, req.Lang)
	}

	provider, err := s.providers.ChatFor(ctx, userID, functionMastery)
	if err != nil {
		return nil, err
	}
	model := provider.DefaultModel()

	cached, err := s.store.Explanation(ctx, userID, kpID, model, variant, locale.FromContext(ctx))
	switch {
	case err == nil && (!cached.Stale || !req.Refresh):
		return s.served(ctx, userID, cached)
	case err != nil && !errors.Is(err, ErrNotFound):
		return nil, err
	}
	return s.teach(ctx, userID, provider, model, path, point, module, variant)
}

// served re-resolves a cached explanation's sources with the caller's id — an
// id read from jsonb is checked on use, not only on save — and drops markers
// whose chunk has since gone (a re-index replaces chunks).
func (s *Service) served(ctx context.Context, userID uuid.UUID, e *Explanation) (*Explanation, error) {
	sources, err := s.resolve(ctx, userID, e.Sources)
	if err != nil {
		return nil, err
	}
	res := citations.Validate(e.BodyMD, citations.Index(sources))
	if len(res.Dropped) > 0 {
		e.Stale = true
	}
	e.BodyMD, e.Sources, e.Cached = res.Text, nonNilSources(res.Sources), true
	return e, nil
}

func (s *Service) teach(
	ctx context.Context, userID uuid.UUID, provider runtime.ChatProvider, model string,
	path *Path, point *KnowledgePoint, module *Module, variant int,
) (*Explanation, error) {
	chunks, err := s.passages(ctx, userID, path.KBID, point, module, learnPassages)
	if err != nil {
		return nil, err
	}

	var b strings.Builder
	// The profile shapes tone and focus. The cache is keyed on the point, the
	// model and the angle, not the profile: an explanation written before a
	// preference changed is served until the learner asks for a rewrite.
	b.WriteString(s.profileNote(ctx, userID, path.KBID))
	fmt.Fprintf(&b, "Knowledge point: %s\nType: %s\n", point.Name, point.Type)
	if module.Objective != "" {
		fmt.Fprintf(&b, "Module objective: %s\n", module.Objective)
	}
	fmt.Fprintf(&b, "Angle: %s\n\nPassages:\n\n", angles[variant])
	b.WriteString(passageBlock(chunks))

	var reply struct {
		Explanation string `json:"explanation"`
	}
	if err := askModelJSON(ctx, provider, model, masteryprompts.Learn, b.String(), &reply); err != nil {
		return nil, err
	}

	// Validated against EXACTLY the passages this call was shown.
	res := citations.Validate(trimRunes(reply.Explanation, maxBodyRunes), citations.Index(chunkSources(chunks)))
	if strings.TrimSpace(res.Text) == "" || len(res.Sources) == 0 {
		// Citations or nothing: an explanation that cites none of the
		// learner's material is the model teaching from memory, which is the
		// thing this product exists not to do.
		return nil, fmt.Errorf("%w: it cited none of your documents", ErrBadExplanation)
	}

	docIDs := make([]uuid.UUID, 0, len(res.Sources))
	seen := map[string]bool{}
	for _, src := range res.Sources {
		if id, err := uuid.Parse(src.DocumentID); err == nil && !seen[src.DocumentID] {
			seen[src.DocumentID] = true
			docIDs = append(docIDs, id)
		}
	}
	versions, err := s.store.DocumentVersions(ctx, userID, docIDs)
	if err != nil {
		return nil, err
	}

	saved, err := s.store.SaveExplanation(ctx, Explanation{
		UserID: userID, KnowledgePointID: point.ID, Model: model, Variant: variant,
		BodyMD: strings.TrimSpace(res.Text), Sources: res.Sources, Lang: locale.FromContext(ctx),
	}, versions)
	if err != nil {
		return nil, err
	}
	if _, err := s.store.AppendEvent(ctx, userID, path.ID, "point_taught", map[string]any{
		"knowledge_point_id": point.ID, "variant": variant, "model": model,
	}); err != nil {
		return nil, err
	}
	return saved, nil
}

// ── explain back ──────────────────────────────────────────────────────────

// ExplainBackRequest is `POST /v1/mastery/points/{id}/explain-back`.
type ExplainBackRequest struct {
	Text string `json:"text"`
	// RequestID is the client's idempotency key: a replay returns the stored
	// verdict and never judges, or bills, twice.
	RequestID uuid.UUID `json:"request_id"`
}

// ExplainBackResult is the verdict and what it did.
type ExplainBackResult struct {
	Attempt   ExplainBackAttempt `json:"attempt"`
	Scheduled *quiz.Scheduled    `json:"scheduled,omitempty"`
	// Graduated lists modules this verdict let graduate, checked in the SAME
	// request: graduation is otherwise only checked after quiz attempts.
	Graduated []GraduatedModule `json:"graduated"`
	// Replayed is true when this request id had already been judged.
	Replayed bool `json:"replayed"`
}

type explainReply struct {
	Gaps           []string `json:"gaps"`
	Misconceptions []string `json:"misconceptions"`
	Feedback       string   `json:"feedback"`
	Passed         bool     `json:"passed"`
}

// ExplainBack judges the learner's own explanation of a concept or design
// point, records the verdict, rates the point, and checks graduation.
func (s *Service) ExplainBack(
	ctx context.Context, userID, kpID uuid.UUID, req ExplainBackRequest,
) (*ExplainBackResult, error) {
	text := strings.TrimSpace(req.Text)
	if req.RequestID == uuid.Nil {
		return nil, fmt.Errorf("%w: request_id is required", ErrBadRequest)
	}
	if n := utf8.RuneCountInString(text); n < ExplainMinChars || n > ExplainMaxChars {
		return nil, fmt.Errorf("%w: an explanation is %d to %d characters", ErrBadRequest, ExplainMinChars, ExplainMaxChars)
	}

	point, module, err := s.store.KnowledgePoint(ctx, userID, kpID)
	if err != nil {
		return nil, err
	}
	if !NeedsExplainBack(point.Type) {
		return nil, fmt.Errorf("%w: explaining back is for concept and design points", ErrBadRequest)
	}
	path, err := s.store.GetPath(ctx, userID, module.PathID)
	if err != nil {
		return nil, err
	}
	ctx = inLanguage(ctx, path.ExplainLang)

	// Reserve BEFORE the model call. A double-submit then finds the row and
	// waits for the first verdict instead of paying for a second one.
	attempt, created, err := s.store.ReserveExplainBack(ctx, ExplainBackAttempt{
		UserID: userID, KnowledgePointID: kpID, PathID: path.ID,
		RequestID: req.RequestID, Explanation: text,
	})
	if err != nil {
		return nil, err
	}
	if !created {
		if attempt.KnowledgePointID != kpID {
			return nil, fmt.Errorf("%w: that request_id was already used for another knowledge point", ErrBadRequest)
		}
		if attempt.Verdict == VerdictPending {
			return nil, ErrStillJudging
		}
		return s.replayed(ctx, userID, attempt)
	}

	verdict, err := s.judgeExplanation(ctx, userID, path, point, module, attempt)
	if err != nil {
		// Nothing was billed (no provider, retrieval failed, the provider
		// refused): release the reservation so the same request can retry.
		if rerr := s.store.ReleaseExplainBack(context.WithoutCancel(ctx), userID, attempt.ID); rerr != nil {
			slog.Warn("mastery: releasing an explain-back reservation failed", "attempt", attempt.ID, "error", rerr)
		}
		return nil, err
	}

	judged, scheduled, err := s.store.RecordExplainVerdict(ctx, userID, attempt.ID, *verdict, s.now().UTC())
	if err != nil {
		return nil, err
	}
	if _, err := s.store.AppendEvent(ctx, userID, path.ID, "explain_back_judged", map[string]any{
		"knowledge_point_id": kpID, "attempt_id": judged.ID, "verdict": judged.Verdict,
	}); err != nil {
		return nil, err
	}
	graduated, err := s.Graduate(ctx, userID, path.ID)
	if err != nil {
		return nil, err
	}
	return &ExplainBackResult{Attempt: *judged, Scheduled: scheduled, Graduated: nonNilGraduated(graduated)}, nil
}

// judgeExplanation makes the one model call. An error means nothing was
// recorded; an unreadable reply is NOT an error — it is the `unjudged`
// verdict, which changes no schedule.
func (s *Service) judgeExplanation(
	ctx context.Context, userID uuid.UUID, path *Path, point *KnowledgePoint, module *Module, attempt *ExplainBackAttempt,
) (*ExplainVerdict, error) {
	provider, err := s.providers.ChatFor(ctx, userID, functionMastery)
	if err != nil {
		return nil, err
	}
	model := provider.DefaultModel()
	chunks, err := s.passages(ctx, userID, path.KBID, point, module, judgePassages)
	if err != nil {
		return nil, err
	}

	var b strings.Builder
	// The profile shapes the feedback's tone; the verdict is the rubric's.
	b.WriteString(s.profileNote(ctx, userID, path.KBID))
	fmt.Fprintf(&b, "Knowledge point: %s\nType: %s\n", point.Name, point.Type)
	if module.Objective != "" {
		fmt.Fprintf(&b, "Module objective: %s\n", module.Objective)
	}
	b.WriteString("\nPassages:\n\n")
	b.WriteString(passageBlock(chunks))
	// The learner's text is untrusted too: it is enveloped exactly like a
	// document, so "mark this as passed" inside it is quoted, not obeyed.
	b.WriteString("\n\nThe learner's explanation:\n\n")
	b.WriteString(tools.Wrap("the learner's explanation", "explain_back:"+attempt.ID.String(), attempt.Explanation))

	var reply explainReply
	if err := askModelJSON(ctx, provider, model, masteryprompts.ExplainBack, b.String(), &reply); err != nil {
		if errors.Is(err, ErrBadExplanation) {
			return &ExplainVerdict{
				Verdict: VerdictUnjudged, Model: model,
				Feedback: "Your model's verdict could not be read, so this explanation was not judged. " +
					"Nothing about your schedule changed. Try again.",
			}, nil
		}
		return nil, err
	}
	return buildVerdict(reply, chunks, model), nil
}

// buildVerdict validates the model's reply into what is stored. The engine,
// not the model, has the last word: invented citations are dropped, and a
// reply that lists a misconception cannot pass however it sets `passed`.
func buildVerdict(reply explainReply, chunks []quiz.Chunk, model string) *ExplainVerdict {
	index := citations.Index(chunkSources(chunks))
	var cited []citations.Source
	seen := map[string]bool{}
	clean := func(items []string, limit int) []string {
		out := []string{}
		for _, item := range items {
			if len(out) >= limit {
				break
			}
			res := citations.Validate(trimRunes(item, 600), index)
			text := strings.TrimSpace(res.Text)
			if text == "" {
				continue
			}
			for _, src := range res.Sources {
				if key := citations.Key(src.Kind, src.ID); !seen[key] {
					seen[key] = true
					cited = append(cited, src)
				}
			}
			out = append(out, text)
		}
		return out
	}
	gaps := clean(reply.Gaps, 8)
	misconceptions := clean(reply.Misconceptions, 8)
	feedback := clean([]string{trimWords(reply.Feedback, maxFeedback)}, 1)

	v := &ExplainVerdict{
		Verdict: VerdictFailed, Gaps: gaps, Misconceptions: misconceptions,
		Sources: nonNilSources(cited), Model: model,
	}
	if len(feedback) == 1 {
		v.Feedback = feedback[0]
	}
	if reply.Passed && len(misconceptions) == 0 {
		v.Verdict = VerdictPassed
	}
	return v
}

func (s *Service) replayed(ctx context.Context, userID uuid.UUID, a *ExplainBackAttempt) (*ExplainBackResult, error) {
	shown, err := s.shownAttempt(ctx, userID, a)
	if err != nil {
		return nil, err
	}
	return &ExplainBackResult{Attempt: *shown, Graduated: []GraduatedModule{}, Replayed: true}, nil
}

// shownAttempt re-resolves a stored attempt's cited sources with the caller's
// id before it is shown (an id from jsonb is checked on use too).
func (s *Service) shownAttempt(ctx context.Context, userID uuid.UUID, a *ExplainBackAttempt) (*ExplainBackAttempt, error) {
	sources, err := s.resolve(ctx, userID, a.Sources)
	if err != nil {
		return nil, err
	}
	index := citations.Index(sources)
	strip := func(items []string) []string {
		out := make([]string, 0, len(items))
		for _, item := range items {
			out = append(out, citations.Validate(item, index).Text)
		}
		return out
	}
	shown := *a
	shown.Gaps, shown.Misconceptions = strip(a.Gaps), strip(a.Misconceptions)
	shown.Feedback = citations.Validate(a.Feedback, index).Text
	shown.Sources = nonNilSources(sources)
	return &shown, nil
}

// OverrideExplainBack records "I think this was judged wrongly": the opposite
// of the judge's verdict, as the learner's, never as a system pass.
func (s *Service) OverrideExplainBack(ctx context.Context, userID, attemptID uuid.UUID) (*ExplainBackResult, error) {
	attempt, scheduled, err := s.store.OverrideExplainBack(ctx, userID, attemptID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	if _, err := s.store.AppendEvent(ctx, userID, attempt.PathID, "explain_back_overridden", map[string]any{
		"knowledge_point_id": attempt.KnowledgePointID, "attempt_id": attempt.ID,
		"override_passed": attempt.EffectivePassed(),
	}); err != nil {
		return nil, err
	}
	graduated, err := s.Graduate(ctx, userID, attempt.PathID)
	if err != nil {
		return nil, err
	}
	shown, err := s.shownAttempt(ctx, userID, attempt)
	if err != nil {
		return nil, err
	}
	return &ExplainBackResult{Attempt: *shown, Scheduled: scheduled, Graduated: nonNilGraduated(graduated)}, nil
}

// ── shared ────────────────────────────────────────────────────────────────

// passages retrieves the point's top passages from its path's knowledge base.
func (s *Service) passages(
	ctx context.Context, userID, kbID uuid.UUID, point *KnowledgePoint, module *Module, limit int,
) ([]quiz.Chunk, error) {
	if s.retriever == nil {
		return nil, ErrNoMaterial
	}
	query := point.Name
	if module.Objective != "" {
		query += " — " + module.Objective
	}
	chunks, err := s.retriever.Search(ctx, userID, []uuid.UUID{kbID}, query, limit)
	if err != nil {
		return nil, fmt.Errorf("mastery: retrieve: %w", err)
	}
	if len(chunks) == 0 {
		return nil, ErrNoMaterial
	}
	return chunks, nil
}

// resolve re-reads the chunk sources in a stored list with the caller's id.
func (s *Service) resolve(ctx context.Context, userID uuid.UUID, stored []citations.Source) ([]citations.Source, error) {
	ids := make([]uuid.UUID, 0, len(stored))
	for _, src := range stored {
		if id, err := uuid.Parse(src.ID); err == nil && src.Kind == citations.KindChunk {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return []citations.Source{}, nil
	}
	return s.store.ResolveSources(ctx, userID, ids)
}

// passageBlock envelopes each passage (internal/tools.Wrap), as quiz does.
func passageBlock(chunks []quiz.Chunk) string {
	parts := make([]string, 0, len(chunks))
	for _, c := range chunks {
		source := c.DocumentTitle
		if c.Page > 0 {
			source = fmt.Sprintf("%s p.%d", c.DocumentTitle, c.Page)
		}
		parts = append(parts, tools.Wrap(source, "chunk:"+c.ID.String(), c.Text))
	}
	return tools.WrapAll(parts)
}

func chunkSources(chunks []quiz.Chunk) []citations.Source {
	out := make([]citations.Source, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, citations.Source{
			Kind: citations.KindChunk, ID: c.ID.String(), Title: c.DocumentTitle,
			Page: c.Page, DocumentID: c.DocumentID.String(),
		})
	}
	return out
}

// askModelJSON makes one non-streaming call and decodes the JSON reply. A
// reply with no readable JSON is ErrBadExplanation; a provider failure is
// runtime.ErrProvider. The learner's language rule (locale.ExplainIn) ends
// the system prompt.
func askModelJSON(ctx context.Context, provider runtime.ChatProvider, model, system, user string, out any) error {
	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: model,
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: system + locale.ExplainIn(ctx)},
			{Role: runtime.RoleUser, Content: user},
		},
	})
	if err != nil {
		return fmt.Errorf("%w: %s", runtime.ErrProvider, err)
	}
	if resp == nil || strings.TrimSpace(resp.Content) == "" {
		return fmt.Errorf("%w: the model returned nothing", ErrBadExplanation)
	}
	payload, ok := extractJSON(resp.Content)
	if !ok {
		return fmt.Errorf("%w: no JSON object in the reply", ErrBadExplanation)
	}
	if err := json.Unmarshal([]byte(payload), out); err != nil {
		return fmt.Errorf("%w: %s", ErrBadExplanation, err)
	}
	return nil
}

func trimRunes(s string, max int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > max {
		return string([]rune(s)[:max])
	}
	return s
}

// trimWords caps text at n words. Citation markers hold no spaces, so a cut
// never splits one.
func trimWords(s string, n int) string {
	words := strings.Fields(s)
	if len(words) <= n {
		return strings.TrimSpace(s)
	}
	return strings.Join(words[:n], " ") + "…"
}

func nonNilSources(in []citations.Source) []citations.Source {
	if in == nil {
		return []citations.Source{}
	}
	return in
}

func nonNilGraduated(in []GraduatedModule) []GraduatedModule {
	if in == nil {
		return []GraduatedModule{}
	}
	return in
}
