package worksheet

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// service.go is the worksheet's life: created against a kind (and, where the
// kind allows, a learning state or a document of the caller's), written one
// section at a time, appended to from other components, reviewed on dated
// days, exported, deleted.
//
// Concurrency (red team SF-3). A page autosaves one section per PATCH, and a
// selection toolbar or a copy from vocabulary may add a row meanwhile. So:
//
//   - every write locks the row and merges only the sections it names; a
//     write never rewrites another section;
//   - a PATCH carries the revision it was loaded at (updated_at), and is
//     refused with ErrConflict when a section it writes was written after
//     that revision, by anyone. Sections it does not write may have moved on;
//     two tabs editing different sections both land;
//   - POST …/rows appends one row server-side, under the same lock, needing
//     no revision; it stamps its section, so a stale PATCH of that table is
//     refused instead of dropping the row.

// Pseudo-sections in Worksheet.SectionRevs for the non-answer parts a PATCH
// can write. They start with `_`, which no section key can.
const (
	revTitle   = "_title"
	revStatus  = "_status"
	revReviews = "_reviews"
)

// Store is the persistence the service needs. pg.WorksheetStore implements it;
// every method names the owner.
type Store interface {
	// Create inserts w. An attached state or document that is not the
	// owner's is ErrNotFound — resolved in the INSERT, not before it.
	Create(ctx context.Context, w Worksheet) (*Worksheet, error)
	// StateExists and DocumentSource resolve an attachment with the owner.
	// DocumentSource returns the document's source kind, or ErrNotFound.
	StateExists(ctx context.Context, userID, stateID uuid.UUID) (bool, error)
	DocumentSource(ctx context.Context, userID, documentID uuid.UUID) (string, error)
	// CycleState is the learning state of the owner's cycle, or ErrNotFound.
	CycleState(ctx context.Context, userID, cycleID uuid.UUID) (uuid.UUID, error)
	// CycleCloses reads the close of the owner's cycle and the close of the
	// cycle before it in the same learning state, each nil when there is
	// none; ErrNotFound for a cycle that is not the owner's.
	CycleCloses(ctx context.Context, userID, cycleID uuid.UUID) (current *Summary, previous *Worksheet, err error)
	Get(ctx context.Context, userID, id uuid.UUID) (*Worksheet, error)
	List(ctx context.Context, userID uuid.UUID, f Filter) ([]Summary, error)
	// Update locks the row, hands it to fn, and applies what fn returns;
	// fn's error aborts with nothing written.
	Update(ctx context.Context, userID, id uuid.UUID, fn func(*Worksheet) (*Write, error)) (*Worksheet, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
	// Due lists open worksheets with a review not done and due on or before
	// today. A private worksheet's title is not read.
	Due(ctx context.Context, userID uuid.UUID, today string, limit int) ([]DueReview, error)
}

// Write is what one Update changes. Sections are whole section objects,
// each written with jsonb_set; nil fields keep their value.
type Write struct {
	Sections map[string]map[string]any
	Title    *string
	Status   *string
	Reviews  map[string]ReviewDate
	// Touched are the SectionRevs keys this write stamps.
	Touched []string
}

// Filter narrows a list. Zero values do not filter.
type Filter struct {
	Kind       string
	StateID    *uuid.UUID
	DocumentID *uuid.UUID
	Limit      int
}

// ListLimit bounds a list read.
const ListLimit = 200

// DueLimit bounds the due list.
const DueLimit = 50

// PrivateTitle replaces a private worksheet's title wherever a list could be
// shown beside other people's eyes (Home).
const PrivateTitle = "Private note"

// DueReview is one review due today or earlier.
type DueReview struct {
	ID      uuid.UUID `json:"id"`
	Kind    string    `json:"kind"`
	Name    string    `json:"name"`
	Title   string    `json:"title"`
	Private bool      `json:"private"`
	Review  string    `json:"review"`
	Label   string    `json:"label"`
	Due     string    `json:"due"`
}

// Zones reads the learner's IANA zone. pg.UserStore implements it.
type Zones interface {
	Timezone(ctx context.Context, userID uuid.UUID) (string, error)
}

// Service is the engine's entry point.
type Service struct {
	store Store
	zones Zones
	now   func() time.Time
}

// NewService builds a Service. now may be nil.
func NewService(store Store, zones Zones, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{store: store, zones: zones, now: now}
}

func (s *Service) today(ctx context.Context, userID uuid.UUID) (learning.Day, string, error) {
	zone, err := s.zones.Timezone(ctx, userID)
	if err != nil {
		return learning.Day{}, "", err
	}
	return learning.LocalDay(s.now(), zone), zone, nil
}

// NewWorksheet is a create request.
type NewWorksheet struct {
	Kind       string
	Title      string
	StateID    *uuid.UUID
	DocumentID *uuid.UUID
	// CycleID is the cycle a cycle close closes. It must be a cycle of the
	// worksheet's learning state; with no state named, it names the state.
	CycleID *uuid.UUID
}

// Create starts a worksheet. The attachment is resolved with the caller's
// user_id first (another user's answers like a missing one: ErrNotFound),
// and only then checked against what the kind allows (ErrInvalid). A second
// close of one cycle is ErrCycleClosed.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, in NewWorksheet) (*Worksheet, error) {
	k, ok := Lookup(in.Kind)
	if !ok {
		return nil, invalid("kind", "unknown worksheet kind")
	}
	title, err := CleanTitle(in.Title)
	if err != nil {
		return nil, err
	}
	if in.StateID != nil && in.DocumentID != nil {
		return nil, invalid("document_id", "a worksheet is attached to a learning state or a document, not both")
	}
	if in.StateID != nil {
		ok, err := s.store.StateExists(ctx, userID, *in.StateID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrNotFound
		}
		if k.Attach != AttachState && k.Attach != AttachStateOrDocument {
			return nil, invalid("state_id", "%s is not attached to a learning state", k.Name)
		}
	}
	if in.DocumentID != nil {
		source, err := s.store.DocumentSource(ctx, userID, *in.DocumentID)
		if err != nil {
			return nil, err
		}
		if k.Attach != AttachDocument && k.Attach != AttachStateOrDocument {
			return nil, invalid("document_id", "%s is not attached to a document", k.Name)
		}
		if len(k.DocumentKinds) > 0 && !contains(k.DocumentKinds, source) {
			return nil, invalid("document_id", "%s works on another kind of document", k.Name)
		}
	} else if k.Attach == AttachDocument {
		return nil, invalid("document_id", "%s needs a document", k.Name)
	}
	if in.CycleID != nil {
		cycleState, err := s.store.CycleState(ctx, userID, *in.CycleID)
		if err != nil {
			return nil, err
		}
		if !k.ClosesCycle {
			return nil, invalid("cycle_id", "%s does not close a cycle", k.Name)
		}
		if in.StateID == nil {
			in.StateID = &cycleState
		} else if *in.StateID != cycleState {
			return nil, invalid("cycle_id", "this cycle belongs to another learning state")
		}
	}
	today, _, err := s.today(ctx, userID)
	if err != nil {
		return nil, err
	}
	reviews := map[string]ReviewDate{}
	schedule(k, Answers{}, reviews, today, today)
	return s.store.Create(ctx, Worksheet{
		UserID: userID, Kind: k.Kind, KindVersion: k.Version, Title: title, Answers: Answers{},
		StateID: in.StateID, DocumentID: in.DocumentID, CycleID: in.CycleID, Status: StatusOpen, Private: k.Private,
		Reviews: reviews,
	})
}

// Get reads one worksheet.
func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*Worksheet, error) {
	return s.store.Get(ctx, userID, id)
}

// List reads worksheets' metadata, newest first.
func (s *Service) List(ctx context.Context, userID uuid.UUID, f Filter) ([]Summary, error) {
	if f.Limit <= 0 || f.Limit > ListLimit {
		f.Limit = ListLimit
	}
	return s.store.List(ctx, userID, f)
}

// Delete removes a worksheet, its recordings' files first (the store's
// Delete).
func (s *Service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	return s.store.Delete(ctx, userID, id)
}

// Due lists the reviews due on the learner's local day or earlier.
func (s *Service) Due(ctx context.Context, userID uuid.UUID) ([]DueReview, error) {
	today, _, err := s.today(ctx, userID)
	if err != nil {
		return nil, err
	}
	list, err := s.store.Due(ctx, userID, today.String(), DueLimit)
	if err != nil {
		return nil, err
	}
	for i := range list {
		d := &list[i]
		d.Name, d.Label = Name(d.Kind), d.Review
		if k, ok := Lookup(d.Kind); ok {
			if r := k.review(d.Review); r != nil {
				d.Label = r.Label
			}
		}
		if d.Private {
			d.Title = PrivateTitle
		}
	}
	return list, nil
}

// Patch is a PATCH request. Revision is the updated_at the client loaded.
type Patch struct {
	Revision time.Time
	Title    *string
	Answers  map[string]json.RawMessage
	Status   *string
	Reviews  map[string]ReviewPatch
}

// ReviewPatch moves a review or marks it done.
type ReviewPatch struct {
	Due  *string
	Done *bool
}

// Update applies a PATCH.
func (s *Service) Update(ctx context.Context, userID, id uuid.UUID, p Patch) (*Worksheet, error) {
	if p.Revision.IsZero() {
		return nil, invalid("revision", "send the revision the worksheet was loaded at")
	}
	var title *string
	if p.Title != nil {
		t, err := CleanTitle(*p.Title)
		if err != nil {
			return nil, err
		}
		title = &t
	}
	if p.Status != nil && *p.Status != StatusOpen && *p.Status != StatusDone {
		return nil, invalid("status", "open or done")
	}
	today, zone, err := s.today(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.store.Update(ctx, userID, id, func(w *Worksheet) (*Write, error) {
		k, ok := Lookup(w.Kind)
		if !ok {
			return nil, invalid("kind", "this worksheet's kind is no longer available")
		}
		touched := make([]string, 0, len(p.Answers)+3)
		for key := range p.Answers {
			touched = append(touched, key)
		}
		if title != nil {
			touched = append(touched, revTitle)
		}
		if p.Status != nil {
			touched = append(touched, revStatus)
		}
		if p.Reviews != nil {
			touched = append(touched, revReviews)
		}
		for _, key := range touched {
			if at, ok := w.SectionRevs[key]; ok && at.After(p.Revision) {
				return nil, ErrConflict
			}
		}
		cleaned, err := Validate(k, p.Answers)
		if err != nil {
			return nil, err
		}
		if err := checkRecordings(k, w, cleaned); err != nil {
			return nil, err
		}
		write := &Write{Title: title, Status: p.Status, Touched: touched, Sections: map[string]map[string]any{}}
		for key, fields := range cleaned {
			write.Sections[key] = merge(w.Answers[key], fields)
		}
		if err := s.finish(k, w, write, learning.LocalDay(w.CreatedAt, zone), today, p.Reviews); err != nil {
			return nil, err
		}
		return write, nil
	})
}

// AppendRow adds one row to a table, server-side: a selection toolbar or a
// copy from vocabulary adds a row without the page's revision. It is capped
// at the table's rows under the row lock.
func (s *Service) AppendRow(ctx context.Context, userID, id uuid.UUID, section, field string, row json.RawMessage) (*Worksheet, error) {
	today, zone, err := s.today(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.store.Update(ctx, userID, id, func(w *Worksheet) (*Write, error) {
		k, ok := Lookup(w.Kind)
		if !ok {
			return nil, invalid("kind", "this worksheet's kind is no longer available")
		}
		f := k.field(section, field)
		path := section + "." + field
		if f == nil || f.Type != Table {
			return nil, invalid(path, "not a table of this worksheet")
		}
		cleaned, err := Validate(k, map[string]json.RawMessage{
			section: mustJSON(map[string]any{field: []json.RawMessage{row}}),
		})
		if err != nil {
			return nil, err
		}
		if err := checkRecordings(k, w, cleaned); err != nil {
			return nil, err
		}
		added := normalize(cleaned[section][field]).([]any)[0].(map[string]any)
		existing, _ := normalize(w.Answers[section][field]).([]any)
		limit := f.MaxRows
		if len(f.Rows) > 0 {
			limit = len(f.Rows)
			for _, r := range existing {
				if m, _ := r.(map[string]any); m != nil && m["row"] == added["row"] {
					return nil, invalid(path, "row %q is already there", added["row"])
				}
			}
		}
		if len(existing)+1 > limit {
			return nil, invalid(path, "at most %d rows", limit)
		}
		fields := merge(w.Answers[section], map[string]any{field: append(existing, added)})
		write := &Write{Sections: map[string]map[string]any{section: fields}, Touched: []string{section}}
		if err := s.finish(k, w, write, learning.LocalDay(w.CreatedAt, zone), today, nil); err != nil {
			return nil, err
		}
		return write, nil
	})
}

// finish applies the rules every write shares, on the merged answers: up's
// delay rule for dated rows, the size bound, the kind's own Check and
// CheckWritten, and the review dates.
func (s *Service) finish(k *Kind, w *Worksheet, write *Write, created, today learning.Day, moves map[string]ReviewPatch) error {
	merged := Answers{}
	for key, fields := range w.Answers {
		merged[key] = fields
	}
	for key, fields := range write.Sections {
		merged[key] = fields
	}
	reviews := make(map[string]ReviewDate, len(w.Reviews))
	for key, r := range w.Reviews {
		reviews[key] = r
	}

	// up's delay rule: a dated row (Day 7, the retest) is written on or
	// after its review date, never before — the same rule the skill cards
	// apply to an early retest. Re-sending a row unchanged is not a write.
	for _, rr := range k.RowReviews {
		if _, sent := write.Sections[rr.Section]; !sent {
			continue
		}
		before := rowCells(w.Answers[rr.Section][rr.Field], rr.Row)
		after := rowCells(merged[rr.Section][rr.Field], rr.Row)
		if reflect.DeepEqual(before, after) {
			continue
		}
		r, scheduled := reviews[rr.Review]
		if !scheduled || !r.isDue(today) {
			return fmt.Errorf("%w: this row opens on its review date", ErrTooEarly)
		}
		r.Done = true
		reviews[rr.Review] = r
	}

	if raw, _ := json.Marshal(merged); len(raw) > MaxAnswers {
		return invalid("answers", "a worksheet holds at most %d KB", MaxAnswers/1024)
	}
	status := w.Status
	if write.Status != nil {
		status = *write.Status
	}
	if k.Check != nil {
		if err := k.Check(merged, status); err != nil {
			return err
		}
	}
	if k.CheckWritten != nil {
		written := make(map[string]bool, len(write.Sections))
		for key := range write.Sections {
			written[key] = true
		}
		if err := k.CheckWritten(merged, written); err != nil {
			return err
		}
	}

	schedule(k, merged, reviews, created, today)
	for key, m := range moves {
		r, ok := reviews[key]
		if k.review(key) == nil {
			return invalid("reviews."+key, "not a review of %s", k.Name)
		}
		if !ok {
			return fmt.Errorf("%w: this review is not scheduled yet", ErrTooEarly)
		}
		if m.Due != nil {
			due, valid := parseDay(*m.Due)
			if !valid {
				return invalid("reviews."+key, "a date is YYYY-MM-DD")
			}
			if earliest, _ := parseDay(r.Earliest); due.Before(earliest) {
				return fmt.Errorf("%w: a review cannot come before %s", ErrTooEarly, r.Earliest)
			}
			r.Due = due.String()
		}
		if m.Done != nil {
			if *m.Done && !r.isDue(today) {
				return fmt.Errorf("%w: this review is due on %s", ErrTooEarly, r.Due)
			}
			r.Done = *m.Done
		}
		reviews[key] = r
	}
	if !reflect.DeepEqual(reviews, w.Reviews) {
		write.Reviews = reviews
	}
	return nil
}

// merge is a stored section with the cleaned fields written over it. A nil
// field is cleared. Stored keys the kind no longer has are kept.
func merge(stored map[string]any, fields map[string]any) map[string]any {
	out := make(map[string]any, len(stored)+len(fields))
	for k, v := range stored {
		out[k] = v
	}
	for k, v := range fields {
		if v == nil {
			delete(out, k)
			continue
		}
		out[k] = normalize(v)
	}
	return out
}

// rowCells is one fixed row's cells in a stored or merged table, or nil.
func rowCells(table any, row string) map[string]any {
	rows, _ := normalize(table).([]any)
	for _, r := range rows {
		m, _ := r.(map[string]any)
		if m == nil || m["row"] != row {
			continue
		}
		cells, _ := m["cells"].(map[string]any)
		if len(cells) == 0 {
			return nil
		}
		return cells
	}
	return nil
}

// normalize is v as encoding/json decodes it back: what a stored value looks
// like, so cleaned and stored values compare.
func normalize(v any) any {
	var out any
	_ = json.Unmarshal(mustJSON(v), &out)
	return out
}

func mustJSON(v any) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return raw
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
