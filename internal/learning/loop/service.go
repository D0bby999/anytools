package loop

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/runtime"
)

// Store is the persistence surface this package consumes. pg.LoopStore
// implements it; the interface lives here, beside its only consumer.
//
// Every method takes the owner's id and every implementation filters on it in
// SQL, including methods whose id is already a primary key (RT-3).
type Store interface {
	CreateStateWithCycle(ctx context.Context, st LearningState, startedAt time.Time) (*LearningState, *Cycle, error)
	ListStates(ctx context.Context, userID uuid.UUID) ([]StateSummary, error)
	GetState(ctx context.Context, userID, id uuid.UUID) (*LearningState, error)
	UpdateState(ctx context.Context, userID, id uuid.UUID, patch StatePatch) (*LearningState, error)
	DeleteState(ctx context.Context, userID, id uuid.UUID) error
	// RecordInterruption swaps the next task and logs the interruption on the
	// state's current cycle, in one transaction.
	RecordInterruption(ctx context.Context, userID, stateID uuid.UUID, nextTask, minimum string, entry Interruption) (*LearningState, *Cycle, error)
	// RecentInterruptions returns a state's n most recent interruptions across
	// all its cycles, most recent first.
	RecentInterruptions(ctx context.Context, userID, stateID uuid.UUID, n int) ([]Interruption, error)

	CreateCycle(ctx context.Context, userID, stateID uuid.UUID, startedAt time.Time) (*Cycle, error)
	// CurrentCycle is the state's most recently started cycle, ErrNotFound if none.
	CurrentCycle(ctx context.Context, userID, stateID uuid.UUID) (*Cycle, error)
	GetCycle(ctx context.Context, userID, id uuid.UUID) (*Cycle, error)
	UpdateCycle(ctx context.Context, userID, id uuid.UUID, patch CyclePatch) (*Cycle, error)
	// AdvanceCycle moves the phase from rec.From to rec.To and appends rec to
	// gate_evidence — only if the phase is still rec.From. ErrConflict otherwise.
	AdvanceCycle(ctx context.Context, userID, id uuid.UUID, rec GateRecord) (*Cycle, error)
	// GateInputs returns the evidence refs in a cycle's scope and the number of
	// its written-back reviews.
	GateInputs(ctx context.Context, userID, cycleID uuid.UUID) ([]GateRef, int, error)

	// CreateReview returns ErrConflict when the week already has one.
	CreateReview(ctx context.Context, userID, cycleID uuid.UUID, week int) (*WeeklyReview, error)
	ListReviews(ctx context.Context, userID, cycleID uuid.UUID) ([]WeeklyReview, error)
	GetReview(ctx context.Context, userID, id uuid.UUID) (*WeeklyReview, error)
	// UpdateReview returns ErrConflict once the review is written back.
	UpdateReview(ctx context.Context, userID, id uuid.UUID, patch ReviewPatch) (*WeeklyReview, error)
	// ApplyWriteback locks the review, counts its accepted evidence, asks plan
	// what to append, and appends it to the state — one transaction.
	ApplyWriteback(ctx context.Context, userID, id uuid.UUID,
		plan func(WeeklyReview, int) ([]Hypothesis, error)) (*WeeklyReview, *LearningState, error)

	// OwnsTarget reports whether userID owns the row kind/refID names.
	OwnsTarget(ctx context.Context, userID uuid.UUID, kind string, refID uuid.UUID) (bool, error)
	// AddEvidence inserts a ref, or accepts the existing one for the same
	// parent and target.
	AddEvidence(ctx context.Context, ref EvidenceRef) (*EvidenceRef, error)
	ListEvidence(ctx context.Context, userID uuid.UUID, reviewID, chainID *uuid.UUID) ([]EvidenceRef, error)
	UpdateEvidence(ctx context.Context, userID, id uuid.UUID, patch EvidencePatch) (*EvidenceRef, error)
	DeleteEvidence(ctx context.Context, userID, id uuid.UUID) error
	// Candidates is the suggestion query: what the user did in [from, to).
	Candidates(ctx context.Context, userID, stateID uuid.UUID, from, to time.Time) ([]Candidate, error)

	CreateChain(ctx context.Context, c Chain) (*Chain, error)
	ListChains(ctx context.Context, userID, stateID uuid.UUID) ([]Chain, error)
	GetChain(ctx context.Context, userID, id uuid.UUID) (*Chain, error)
	SaveChain(ctx context.Context, c Chain) (*Chain, error)
	DeleteChain(ctx context.Context, userID, id uuid.UUID) error

	CreateBrief(ctx context.Context, b Brief) (*Brief, error)
	ListBriefs(ctx context.Context, userID, stateID uuid.UUID) ([]Brief, error)
	GetBrief(ctx context.Context, userID, id uuid.UUID) (*Brief, error)
	SaveBrief(ctx context.Context, b Brief) (*Brief, error)
	DeleteBrief(ctx context.Context, userID, id uuid.UUID) error

	CreateLog(ctx context.Context, l Log) (*Log, error)
	ListLogs(ctx context.Context, userID, briefID uuid.UUID) ([]Log, error)
	GetLog(ctx context.Context, userID, id uuid.UUID) (*Log, error)
	SaveLog(ctx context.Context, l Log) (*Log, error)
	DeleteLog(ctx context.Context, userID, id uuid.UUID) error

	// CreateCard inserts a card and its evidence chain in one transaction.
	CreateCard(ctx context.Context, c SkillCard) (*SkillCard, error)
	ListCards(ctx context.Context, userID, stateID uuid.UUID) ([]SkillCard, error)
	GetCard(ctx context.Context, userID, id uuid.UUID) (*SkillCard, error)
	// ListCardEntries reads a card's entries, oldest first, with each link
	// resolved against the owner's own rows.
	ListCardEntries(ctx context.Context, userID, cardID uuid.UUID) ([]CardEntry, error)
	// AddCardEntry locks the card, asks decide whether the entry may be
	// written, proves the owner owns every link, inserts the entry, applies
	// the change and attaches the entry to the card's chain — one transaction.
	AddCardEntry(ctx context.Context, userID, cardID uuid.UUID, e CardEntry,
		decide func(SkillCard) (*CardChange, error)) (*SkillCard, error)
	// CloseCard locks the card, asks decide, and applies the change.
	CloseCard(ctx context.Context, userID, id uuid.UUID, decide func(SkillCard) (*CardChange, error)) (*SkillCard, error)
	// RetestsDue lists cards with a pending retest due on or before today.
	RetestsDue(ctx context.Context, userID uuid.UUID, today string) ([]RetestDue, error)
	// CardEntryTimepoint is the timepoint an entry was written at.
	CardEntryTimepoint(ctx context.Context, userID, id uuid.UUID) (string, error)
	// GetEvidence reads one ref scoped to its owner.
	GetEvidence(ctx context.Context, userID, id uuid.UUID) (*EvidenceRef, error)
}

// SessionCreator starts the chat a resume runs in. pg.ChatStore implements it.
type SessionCreator interface {
	CreateSession(ctx context.Context, sess runtime.Session) (*runtime.Session, error)
}

// Service is the learning loop's application logic.
type Service struct {
	store    Store
	sessions SessionCreator
	zones    Zones
	now      func() time.Time
}

// NewService builds a Service. sessions may be nil, in which case resume is
// unavailable; now may be nil for the wall clock.
func NewService(store Store, sessions SessionCreator, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{store: store, sessions: sessions, now: now}
}

// ─────────────────────────────────────────────────────────────────── states

// StateDetail is a state's page: the state, its current cycle and gate, and
// its chains and briefs.
type StateDetail struct {
	State    LearningState `json:"state"`
	Revision string        `json:"revision"`
	Cycle    *Cycle        `json:"cycle"`
	Gate     *GateResult   `json:"gate"`
	Chains   []Chain       `json:"chains"`
	Briefs   []Brief       `json:"briefs"`
	Cards    []SkillCard   `json:"cards"`
	// RepeatedResistance is set when the state's last RepeatAfter
	// interruptions all named it; the page then shows up's advice.
	RepeatedResistance string `json:"repeated_resistance"`
}

// Start is the minimal start: four fields make a state and its first cycle.
func (s *Service) Start(ctx context.Context, userID uuid.UUID, in MinimalStart) (*LearningState, *Cycle, error) {
	if err := in.Validate(); err != nil {
		return nil, nil, err
	}
	return s.store.CreateStateWithCycle(ctx, LearningState{
		UserID:       userID,
		Goal:         strings.TrimSpace(in.Goal),
		RealScenario: strings.TrimSpace(in.RealScenario),
		Outcome12w:   strings.TrimSpace(in.Outcome12w),
		NextTask:     strings.TrimSpace(in.FirstTask),
	}, s.now().UTC())
}

// States lists a user's states with their current phase.
func (s *Service) States(ctx context.Context, userID uuid.UUID) ([]StateSummary, error) {
	return s.store.ListStates(ctx, userID)
}

// State reads a state's page.
func (s *Service) State(ctx context.Context, userID, id uuid.UUID) (*StateDetail, error) {
	st, err := s.store.GetState(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	d := &StateDetail{State: *st, Revision: Revision(*st)}
	cycle, err := s.store.CurrentCycle(ctx, userID, id)
	switch {
	case errors.Is(err, ErrNotFound):
	case err != nil:
		return nil, err
	default:
		gate, err := s.gate(ctx, userID, cycle)
		if err != nil {
			return nil, err
		}
		d.Cycle, d.Gate = cycle, &gate
	}
	if d.Chains, err = s.store.ListChains(ctx, userID, id); err != nil {
		return nil, err
	}
	if d.Briefs, err = s.store.ListBriefs(ctx, userID, id); err != nil {
		return nil, err
	}
	if d.Cards, err = s.store.ListCards(ctx, userID, id); err != nil {
		return nil, err
	}
	recent, err := s.store.RecentInterruptions(ctx, userID, id, RepeatAfter)
	if err != nil {
		return nil, err
	}
	d.RepeatedResistance = RepeatedResistance(recent)
	return d, nil
}

// UpdateState applies a patch.
func (s *Service) UpdateState(ctx context.Context, userID, id uuid.UUID, patch StatePatch) (*LearningState, error) {
	if err := patch.Validate(); err != nil {
		return nil, err
	}
	if patch.MinimumContract != nil {
		c := patch.MinimumContract.trimmed()
		patch.MinimumContract = &c
	}
	return s.store.UpdateState(ctx, userID, id, patch)
}

// DeleteState removes a state; its cycles, reviews, chains, briefs and logs
// cascade, and a linked chat is unlinked rather than deleted.
func (s *Service) DeleteState(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteState(ctx, userID, id)
}

// Interrupt is "I got interrupted": the next task shrinks to its minimum and
// the interruption is logged on the current cycle.
func (s *Service) Interrupt(ctx context.Context, userID, stateID uuid.UUID, req InterruptRequest) (*LearningState, *Cycle, error) {
	st, err := s.store.GetState(ctx, userID, stateID)
	if err != nil {
		return nil, nil, err
	}
	next, minimum, entry, err := PlanInterruption(*st, req, s.now())
	if err != nil {
		return nil, nil, err
	}
	return s.store.RecordInterruption(ctx, userID, stateID, next, minimum, entry)
}

// NewCycle starts another cycle. Only after the current one has reached its
// last phase: two open cycles on one goal would split its evidence in two.
func (s *Service) NewCycle(ctx context.Context, userID, stateID uuid.UUID) (*Cycle, error) {
	if _, err := s.store.GetState(ctx, userID, stateID); err != nil {
		return nil, err
	}
	current, err := s.store.CurrentCycle(ctx, userID, stateID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if current != nil && current.Phase != PhaseDeliver {
		return nil, fmt.Errorf("%w: finish the current cycle first — it is still in %s", ErrConflict, current.Phase)
	}
	return s.store.CreateCycle(ctx, userID, stateID, s.now().UTC())
}

// ResumeTitle is the title a resume chat is created with.
func ResumeTitle(goal string) string {
	r := []rune("Resume: " + strings.TrimSpace(goal))
	if len(r) > 120 {
		r = r[:120]
	}
	return string(r)
}

// Resume starts a chat linked to the state. The chat capability sees the link
// and injects the state (internal/capabilities/chat/state_context.go).
func (s *Service) Resume(ctx context.Context, userID, stateID uuid.UUID) (*runtime.Session, error) {
	if s.sessions == nil {
		return nil, fmt.Errorf("%w: resume is not available", ErrInvalid)
	}
	st, err := s.store.GetState(ctx, userID, stateID)
	if err != nil {
		return nil, err
	}
	id := st.ID
	return s.sessions.CreateSession(ctx, runtime.Session{
		UserID: userID, Title: ResumeTitle(st.Goal), LearningStateID: &id,
	})
}

// Handover validates a paste-back and, when asked and valid, writes it.
//
// Writing it changes the state's updated_at and therefore its revision, so the
// same block pasted twice is refused the second time: it was written against a
// version that no longer exists.
func (s *Service) Handover(ctx context.Context, userID, stateID uuid.UUID, req HandoverRequest) (*HandoverResult, error) {
	st, err := s.store.GetState(ctx, userID, stateID)
	if err != nil {
		return nil, err
	}
	pb, problems, err := ParsePasteBack(req.Text)
	if errors.Is(err, ErrNoPasteBack) {
		return &HandoverResult{Problems: []string{
			"No handover block found. Paste the fenced block tagged " + PasteBackFence + ", or the JSON inside it."}}, nil
	}
	if err != nil {
		return nil, err
	}
	if pb != nil && len(problems) == 0 {
		problems = CheckRevision(pb, *st)
	}
	res := &HandoverResult{Valid: len(problems) == 0, Problems: problems, PasteBack: pb}
	if res.Problems == nil {
		res.Problems = []string{}
	}
	if !res.Valid || !req.Accept {
		return res, nil
	}

	handover := strings.TrimSpace(pb.HandoverMD)
	patch := StatePatch{HandoverMD: &handover}
	if req.AcceptNextTask && strings.TrimSpace(pb.NextTask) != "" {
		next := strings.TrimSpace(pb.NextTask)
		patch.NextTask = &next
	}
	updated, err := s.store.UpdateState(ctx, userID, stateID, patch)
	if err != nil {
		return nil, err
	}
	res.Accepted, res.State = true, updated
	return res, nil
}

// ─────────────────────────────────────────────────────────────────── cycles

// Cycle reads a cycle's page.
func (s *Service) Cycle(ctx context.Context, userID, id uuid.UUID) (*CycleDetail, error) {
	c, err := s.store.GetCycle(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return s.cycleDetail(ctx, userID, c)
}

func (s *Service) cycleDetail(ctx context.Context, userID uuid.UUID, c *Cycle) (*CycleDetail, error) {
	st, err := s.store.GetState(ctx, userID, c.StateID)
	if err != nil {
		return nil, err
	}
	gate, err := s.gate(ctx, userID, c)
	if err != nil {
		return nil, err
	}
	reviews, err := s.store.ListReviews(ctx, userID, c.ID)
	if err != nil {
		return nil, err
	}
	zone, err := s.zone(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &CycleDetail{
		Cycle: *c, Goal: st.Goal, CurrentWeek: WeekOf(c.StartedAt, s.now()),
		Gate: gate, Reviews: reviews,
		Day: CycleDay(c.StartedAt, s.now(), zone), CloseFromDay: CloseFromDay,
	}, nil
}

// UpdateCycle applies a patch.
func (s *Service) UpdateCycle(ctx context.Context, userID, id uuid.UUID, patch CyclePatch) (*Cycle, error) {
	if err := patch.Validate(); err != nil {
		return nil, err
	}
	return s.store.UpdateCycle(ctx, userID, id, patch)
}

// Advance moves a cycle to its next phase if, and only if, its gate is open.
// A shut gate is a NotReadyError carrying the gate, so the caller can say
// exactly what is missing.
func (s *Service) Advance(ctx context.Context, userID, id uuid.UUID) (*CycleDetail, error) {
	c, err := s.store.GetCycle(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	gate, err := s.gate(ctx, userID, c)
	if err != nil {
		return nil, err
	}
	if !gate.Open {
		return nil, &NotReadyError{Problems: gate.Missing, Gate: &gate}
	}
	reviews := 0
	for _, p := range gate.Progress {
		if p.Requirement == "weekly_reviews" {
			reviews = p.Have
		}
	}
	advanced, err := s.store.AdvanceCycle(ctx, userID, id, GateRecord{
		From: gate.From, To: gate.To, At: s.now().UTC(), RefIDs: gate.Counted, Reviews: reviews,
	})
	if err != nil {
		return nil, err
	}
	return s.cycleDetail(ctx, userID, advanced)
}

func (s *Service) gate(ctx context.Context, userID uuid.UUID, c *Cycle) (GateResult, error) {
	refs, reviews, err := s.store.GateInputs(ctx, userID, c.ID)
	if err != nil {
		return GateResult{}, err
	}
	return EvaluateGate(GateInput{Phase: c.Phase, Refs: refs, WrittenBackReviews: reviews}), nil
}

// ────────────────────────────────────────────────────────────────── reviews

// ReviewDetail is a weekly review's page.
type ReviewDetail struct {
	Review   WeeklyReview  `json:"review"`
	Evidence []EvidenceRef `json:"evidence"`
	// Problems are what still blocks writeback; empty when it may proceed.
	Problems []string `json:"problems"`
	// CannotProve is what the four scores, however high, do not show.
	CannotProve string    `json:"cannot_prove"`
	Cycle       CycleLink `json:"cycle"`
}

// CycleLink is the little of a cycle a review page shows.
type CycleLink struct {
	ID        uuid.UUID `json:"id"`
	StateID   uuid.UUID `json:"state_id"`
	Phase     string    `json:"phase"`
	StartedAt time.Time `json:"started_at"`
	Goal      string    `json:"goal"`
}

// ScoresCannotProve is the note every set of weekly scores carries.
const ScoresCannotProve = "These scores are your own judgement of one week. " +
	"They cannot show progress on their own; the evidence attached to them is what can be checked."

// CreateReview opens the review for a week of a cycle; week 0 means the
// current week.
func (s *Service) CreateReview(ctx context.Context, userID, cycleID uuid.UUID, week int) (*WeeklyReview, error) {
	c, err := s.store.GetCycle(ctx, userID, cycleID)
	if err != nil {
		return nil, err
	}
	if week == 0 {
		week = WeekOf(c.StartedAt, s.now())
	}
	if week < 1 || week > MaxWeek {
		return nil, fmt.Errorf("%w: week must be between 1 and %d", ErrInvalid, MaxWeek)
	}
	return s.store.CreateReview(ctx, userID, cycleID, week)
}

// Review reads a review's page.
func (s *Service) Review(ctx context.Context, userID, id uuid.UUID) (*ReviewDetail, error) {
	r, err := s.store.GetReview(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return s.reviewDetail(ctx, userID, r)
}

func (s *Service) reviewDetail(ctx context.Context, userID uuid.UUID, r *WeeklyReview) (*ReviewDetail, error) {
	refs, err := s.store.ListEvidence(ctx, userID, &r.ID, nil)
	if err != nil {
		return nil, err
	}
	c, err := s.store.GetCycle(ctx, userID, r.CycleID)
	if err != nil {
		return nil, err
	}
	st, err := s.store.GetState(ctx, userID, c.StateID)
	if err != nil {
		return nil, err
	}
	problems := []string{}
	if !r.WritebackDone {
		if p := WritebackProblems(*r, countAccepted(refs)); p != nil {
			problems = p
		}
	}
	return &ReviewDetail{
		Review: *r, Evidence: refs, Problems: problems, CannotProve: ScoresCannotProve,
		Cycle: CycleLink{ID: c.ID, StateID: c.StateID, Phase: c.Phase, StartedAt: c.StartedAt, Goal: st.Goal},
	}, nil
}

// UpdateReview applies a patch.
func (s *Service) UpdateReview(ctx context.Context, userID, id uuid.UUID, patch ReviewPatch) (*ReviewDetail, error) {
	if err := patch.Validate(); err != nil {
		return nil, err
	}
	r, err := s.store.UpdateReview(ctx, userID, id, patch)
	if err != nil {
		return nil, err
	}
	return s.reviewDetail(ctx, userID, r)
}

// Writeback writes a finished review into its state.
func (s *Service) Writeback(ctx context.Context, userID, id uuid.UUID) (*ReviewDetail, *LearningState, error) {
	r, st, err := s.store.ApplyWriteback(ctx, userID, id, PlanWriteback)
	if err != nil {
		return nil, nil, err
	}
	d, err := s.reviewDetail(ctx, userID, r)
	if err != nil {
		return nil, nil, err
	}
	return d, st, nil
}

// ───────────────────────────────────────────────────────────────── evidence

// AddReviewEvidence attaches evidence to a review (accepting a suggestion is
// the same call).
func (s *Service) AddReviewEvidence(ctx context.Context, userID, reviewID uuid.UUID, in NewEvidence) (*EvidenceRef, error) {
	if _, err := s.store.GetReview(ctx, userID, reviewID); err != nil {
		return nil, err
	}
	if err := s.checkEvidence(ctx, userID, in, false); err != nil {
		return nil, err
	}
	return s.store.AddEvidence(ctx, EvidenceRef{
		UserID: userID, ReviewID: &reviewID, Timepoint: in.Timepoint, Kind: in.Kind,
		RefID: in.RefID, Note: strings.TrimSpace(in.Note),
		Status: StatusAccepted, SuggestedBy: SuggestedByUser,
	})
}

// AddChainEvidence places evidence on a chain at a timepoint.
func (s *Service) AddChainEvidence(ctx context.Context, userID, chainID uuid.UUID, in NewEvidence) (*EvidenceRef, error) {
	if _, err := s.store.GetChain(ctx, userID, chainID); err != nil {
		return nil, err
	}
	if err := s.checkEvidence(ctx, userID, in, true); err != nil {
		return nil, err
	}
	return s.store.AddEvidence(ctx, EvidenceRef{
		UserID: userID, ChainID: &chainID, Timepoint: in.Timepoint, Kind: in.Kind,
		RefID: in.RefID, Note: strings.TrimSpace(in.Note),
		Status: StatusAccepted, SuggestedBy: SuggestedByUser,
	})
}

// checkEvidence validates a new ref and proves the caller owns its target.
// A target that is not theirs is ErrNotFound, exactly like one that does not
// exist.
func (s *Service) checkEvidence(ctx context.Context, userID uuid.UUID, in NewEvidence, needTimepoint bool) error {
	if !validKind(in.Kind) {
		return fmt.Errorf("%w: unknown evidence kind %q", ErrInvalid, in.Kind)
	}
	if !validTimepoint(in.Timepoint) {
		return fmt.Errorf("%w: unknown timepoint %q", ErrInvalid, in.Timepoint)
	}
	if needTimepoint && in.Timepoint == "" {
		return fmt.Errorf("%w: evidence on a chain needs a timepoint", ErrInvalid)
	}
	if len(in.Note) > MaxTextLen {
		return fmt.Errorf("%w: the note is too long", ErrInvalid)
	}
	if in.RefID == uuid.Nil {
		return fmt.Errorf("%w: ref_id is required", ErrInvalid)
	}
	owns, err := s.store.OwnsTarget(ctx, userID, in.Kind, in.RefID)
	if err != nil {
		return err
	}
	if !owns {
		return ErrNotFound
	}
	if in.Kind == KindCardEntry {
		return s.checkCardEntryTimepoint(ctx, userID, in.RefID, in.Timepoint, needTimepoint)
	}
	return nil
}

// UpdateEvidence changes a ref's status, timepoint or note.
func (s *Service) UpdateEvidence(ctx context.Context, userID, id uuid.UUID, patch EvidencePatch) (*EvidenceRef, error) {
	if patch.Status != nil && !validStatus(*patch.Status) {
		return nil, fmt.Errorf("%w: unknown status %q", ErrInvalid, *patch.Status)
	}
	if patch.Timepoint != nil && !validTimepoint(*patch.Timepoint) {
		return nil, fmt.Errorf("%w: unknown timepoint %q", ErrInvalid, *patch.Timepoint)
	}
	if patch.Note != nil && len(*patch.Note) > MaxTextLen {
		return nil, fmt.Errorf("%w: the note is too long", ErrInvalid)
	}
	if patch.Timepoint != nil {
		ref, err := s.store.GetEvidence(ctx, userID, id)
		if err != nil {
			return nil, err
		}
		if ref.Kind == KindCardEntry {
			if err := s.checkCardEntryTimepoint(ctx, userID, ref.RefID, *patch.Timepoint, ref.ChainID != nil); err != nil {
				return nil, err
			}
		}
	}
	return s.store.UpdateEvidence(ctx, userID, id, patch)
}

// DeleteEvidence removes a ref.
func (s *Service) DeleteEvidence(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteEvidence(ctx, userID, id)
}

// Suggest lists what the user did in one week of a cycle, computed on read,
// each marked with the status of any ref already recorded for it on that
// week's review. week 0 means the current week.
//
// It is the same query the nightly job runs; the job exists so suggestions are
// waiting when the person opens the review, and this exists so an attempt made
// five minutes ago shows up without waiting for the night.
func (s *Service) Suggest(ctx context.Context, userID, cycleID uuid.UUID, week int) ([]Candidate, int, error) {
	c, err := s.store.GetCycle(ctx, userID, cycleID)
	if err != nil {
		return nil, 0, err
	}
	if week == 0 {
		week = WeekOf(c.StartedAt, s.now())
	}
	if week < 1 || week > MaxWeek {
		return nil, 0, fmt.Errorf("%w: week must be between 1 and %d", ErrInvalid, MaxWeek)
	}
	from, to := WeekWindow(c.StartedAt, week)
	cands, err := s.store.Candidates(ctx, userID, c.StateID, from, to)
	if err != nil {
		return nil, 0, err
	}

	reviews, err := s.store.ListReviews(ctx, userID, cycleID)
	if err != nil {
		return nil, 0, err
	}
	for _, r := range reviews {
		if r.WeekNo != week {
			continue
		}
		refs, err := s.store.ListEvidence(ctx, userID, &r.ID, nil)
		if err != nil {
			return nil, 0, err
		}
		status := map[string]string{}
		for _, ref := range refs {
			status[ref.Kind+":"+ref.RefID.String()] = ref.Status
		}
		for i := range cands {
			cands[i].Status = status[cands[i].Kind+":"+cands[i].RefID.String()]
		}
	}
	return cands, week, nil
}

// ─────────────────────────────────────────────────────────────────── chains

// CreateChain starts an evidence chain on a state.
func (s *Service) CreateChain(ctx context.Context, userID, stateID uuid.UUID, in ChainInput) (*Chain, error) {
	if err := in.Validate(true); err != nil {
		return nil, err
	}
	if _, err := s.store.GetState(ctx, userID, stateID); err != nil {
		return nil, err
	}
	c := Chain{UserID: userID, StateID: stateID, Question: strings.TrimSpace(*in.Question)}
	if in.Split != nil {
		c.Split = *in.Split
	}
	return s.store.CreateChain(ctx, c)
}

// Chains lists a state's chains.
func (s *Service) Chains(ctx context.Context, userID, stateID uuid.UUID) ([]Chain, error) {
	if _, err := s.store.GetState(ctx, userID, stateID); err != nil {
		return nil, err
	}
	return s.store.ListChains(ctx, userID, stateID)
}

// Chain reads a chain with its four columns.
func (s *Service) Chain(ctx context.Context, userID, id uuid.UUID) (*ChainDetail, error) {
	c, err := s.store.GetChain(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	refs, err := s.store.ListEvidence(ctx, userID, nil, &c.ID)
	if err != nil {
		return nil, err
	}
	d := GroupChain(*c, refs)
	return &d, nil
}

// UpdateChain applies a patch.
func (s *Service) UpdateChain(ctx context.Context, userID, id uuid.UUID, in ChainInput) (*Chain, error) {
	if err := in.Validate(false); err != nil {
		return nil, err
	}
	c, err := s.store.GetChain(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if in.Question != nil {
		c.Question = strings.TrimSpace(*in.Question)
	}
	if in.Split != nil {
		c.Split = *in.Split
	}
	return s.store.SaveChain(ctx, *c)
}

// DeleteChain removes a chain and its refs.
func (s *Service) DeleteChain(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteChain(ctx, userID, id)
}

// ─────────────────────────────────────────────────────────── briefs and logs

// BriefDetail is a brief's page: the brief, what is unchecked, and its logs.
type BriefDetail struct {
	Brief     Brief       `json:"brief"`
	Unchecked []string    `json:"unchecked"`
	Logs      []LogDetail `json:"logs"`
}

// LogDetail is a log with its three-way reading.
type LogDetail struct {
	Log  Log           `json:"log"`
	Rows []ThreeWayRow `json:"rows"`
}

// CreateBrief writes a brief on a state.
func (s *Service) CreateBrief(ctx context.Context, userID, stateID uuid.UUID, in BriefInput) (*Brief, error) {
	if err := in.Validate(true); err != nil {
		return nil, err
	}
	if _, err := s.store.GetState(ctx, userID, stateID); err != nil {
		return nil, err
	}
	b := Brief{UserID: userID, StateID: stateID}
	in.Apply(&b)
	b.Task = strings.TrimSpace(b.Task)
	return s.store.CreateBrief(ctx, b)
}

// Briefs lists a state's briefs.
func (s *Service) Briefs(ctx context.Context, userID, stateID uuid.UUID) ([]Brief, error) {
	if _, err := s.store.GetState(ctx, userID, stateID); err != nil {
		return nil, err
	}
	return s.store.ListBriefs(ctx, userID, stateID)
}

// Brief reads a brief's page.
func (s *Service) Brief(ctx context.Context, userID, id uuid.UUID) (*BriefDetail, error) {
	b, err := s.store.GetBrief(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	logs, err := s.store.ListLogs(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	d := &BriefDetail{Brief: *b, Unchecked: b.Unchecked(), Logs: []LogDetail{}}
	if d.Unchecked == nil {
		d.Unchecked = []string{}
	}
	for _, l := range logs {
		d.Logs = append(d.Logs, LogDetail{Log: l, Rows: ThreeWay(l)})
	}
	return d, nil
}

// UpdateBrief applies a patch.
func (s *Service) UpdateBrief(ctx context.Context, userID, id uuid.UUID, in BriefInput) (*Brief, error) {
	if err := in.Validate(false); err != nil {
		return nil, err
	}
	b, err := s.store.GetBrief(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	in.Apply(b)
	return s.store.SaveBrief(ctx, *b)
}

// DeleteBrief removes a brief and its logs.
func (s *Service) DeleteBrief(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteBrief(ctx, userID, id)
}

// CreateLog starts a learning log on a brief.
func (s *Service) CreateLog(ctx context.Context, userID, briefID uuid.UUID, in LogInput) (*LogDetail, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	if _, err := s.store.GetBrief(ctx, userID, briefID); err != nil {
		return nil, err
	}
	l := Log{UserID: userID, BriefID: briefID}
	in.Apply(&l)
	created, err := s.store.CreateLog(ctx, l)
	if err != nil {
		return nil, err
	}
	return &LogDetail{Log: *created, Rows: ThreeWay(*created)}, nil
}

// Logs lists a brief's logs with their readings.
func (s *Service) Logs(ctx context.Context, userID, briefID uuid.UUID) ([]LogDetail, error) {
	d, err := s.Brief(ctx, userID, briefID)
	if err != nil {
		return nil, err
	}
	return d.Logs, nil
}

// Log reads one log with its reading.
func (s *Service) Log(ctx context.Context, userID, id uuid.UUID) (*LogDetail, error) {
	l, err := s.store.GetLog(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return &LogDetail{Log: *l, Rows: ThreeWay(*l)}, nil
}

// UpdateLog applies a patch.
func (s *Service) UpdateLog(ctx context.Context, userID, id uuid.UUID, in LogInput) (*LogDetail, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	l, err := s.store.GetLog(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	in.Apply(l)
	saved, err := s.store.SaveLog(ctx, *l)
	if err != nil {
		return nil, err
	}
	return &LogDetail{Log: *saved, Rows: ThreeWay(*saved)}, nil
}

// DeleteLog removes a log.
func (s *Service) DeleteLog(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.DeleteLog(ctx, userID, id)
}

func countAccepted(refs []EvidenceRef) int {
	n := 0
	for _, r := range refs {
		if r.Status == StatusAccepted {
			n++
		}
	}
	return n
}
