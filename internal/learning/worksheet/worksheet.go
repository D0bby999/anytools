// Package worksheet is the engine behind up's worksheets
// (the private design notes, phase 0): a titled page of headed sections,
// each a list of labelled lines, small fixed tables, option lists, 0–2 scores,
// yes/no gates, checklists and review dates — the pages up's reader copies
// into a private note.
//
// A worksheet's KIND is Go data. It registers itself from its own file:
//
//	func init() { register(artifactBrief) }
//
// and from then on the engine stores, validates (Validate), schedules
// (reviews.go), exports (Markdown) and serves it — the web app renders the
// form from GET /v1/worksheet-kinds and has no copy of any kind. A new up
// template is a new kind file, not a new feature.
//
// What is decided here and not by the client: every answer fits its kind
// (unknown keys, wrong options, scores outside 0–2, too many rows and
// over-long text are refused), review dates are counted from their anchors on
// the learner's local day, and a dated retest row cannot be written before
// its date (up's delay rule, as internal/learning/loop/cards.go applies it to
// the skill cards).
package worksheet

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"time"

	"github.com/google/uuid"
)

// Groups, in the order /toolkit shows them.
const (
	GroupLanguage = "language"
	GroupProjects = "projects"
	GroupLife     = "life"
)

func groupOrder(g string) int {
	switch g {
	case GroupLanguage:
		return 0
	case GroupProjects:
		return 1
	case GroupLife:
		return 2
	}
	return 3
}

// What a worksheet may be attached to.
const (
	AttachNone     = "none"
	AttachState    = "state"
	AttachDocument = "document"
	// AttachStateOrDocument allows either, both optional: the grammar error
	// map (phase 6) is kept for a goal or for the document its samples
	// came from.
	AttachStateOrDocument = "state_or_document"
)

// Statuses.
const (
	StatusOpen = "open"
	StatusDone = "done"
)

// FieldType is what one line of a worksheet holds.
type FieldType string

// Field types: everything up's templates use.
const (
	// Text is one line, at most MaxText characters.
	Text FieldType = "text"
	// Long is free prose, at most MaxLong characters.
	Long FieldType = "long"
	// Choice is one of Options (up's "a / b / c" lists). With Other set, any
	// other short text is accepted too: the free "other" up offers.
	Choice FieldType = "choice"
	// Multi is several of Options.
	Multi FieldType = "multi"
	// Score is 0, 1 or 2, with up's anchor labels in ScoreLabels.
	Score FieldType = "score"
	// YesNo is a gate: true or false.
	YesNo FieldType = "yesno"
	// Date is a local calendar date, YYYY-MM-DD.
	Date FieldType = "date"
	// Check is one checklist item: true or false.
	Check FieldType = "check"
	// Table is up's small tables: Columns, and either fixed Rows or free rows
	// up to MaxRows.
	Table FieldType = "table"
	// Label is a read-only table column whose text the kind gives per row
	// (Field.Text). It is shown, never stored.
	Label FieldType = "label"
	// Audio is a reference to one of this worksheet's recordings (phase 7):
	// the recording's id, which must be one of the worksheet's own
	// (recordings.go). A table column may be audio.
	Audio FieldType = "audio"
)

// Limits.
const (
	MaxText  = 500
	MaxLong  = 5000
	MaxTitle = 200
	// MaxAnswers bounds a worksheet's whole stored answers, in bytes.
	MaxAnswers = 200 * 1024
	// MaxRowsCeiling bounds any free table, whatever its kind says.
	MaxRowsCeiling = 100
	// MaxLongCeiling bounds a long field's MaxLen: a whole draft, such as
	// the writing evidence card's unaided draft (phase 4).
	MaxLongCeiling = 20_000
)

// Kind is one worksheet template.
type Kind struct {
	Kind  string `json:"kind"`
	Name  string `json:"name"`
	Group string `json:"group"`
	// Source names the up file and section the kind follows, for example
	// "docs/en/templates/artifact-brief.md".
	Source  string `json:"source"`
	Summary string `json:"summary"`
	// Private kinds never reach a model or an evidence surface (plan
	// principle 5). The flag is copied to worksheets.private on insert, so
	// SQL can filter on it.
	Private bool `json:"private"`
	// Attach is AttachNone, AttachState (optional), AttachDocument
	// (required) or AttachStateOrDocument (either, optional). DocumentKinds narrows a document attachment to these
	// documents.source_kind values; empty allows any.
	Attach        string   `json:"attach"`
	DocumentKinds []string `json:"document_kinds,omitempty"`
	// ClosesCycle lets a worksheet name the cycle of its learning state it
	// closes (worksheets.cycle_id, phase 10): one per cycle. No other kind
	// may name a cycle.
	ClosesCycle bool `json:"closes_cycle,omitempty"`
	// Reviews are the kind's named review dates.
	Reviews []Review `json:"reviews,omitempty"`
	// RowReviews ties table rows to a review: such a row cannot be written
	// before that review's date.
	RowReviews []RowReview `json:"row_reviews,omitempty"`
	// Check runs cross-field rules up states, after every section write and
	// status change, on the merged answers. It returns a *FieldError naming
	// the field, which the API answers with 400.
	Check func(a Answers, status string) error `json:"-"`
	// CheckWritten is Check for a rule that ties one section to others and
	// binds only when that section is written; written holds the sections
	// the write names. The AI evaluation's stored pass rate must match the
	// case rows when the results are saved, and a case added afterwards is
	// not refused for the rate it makes out of date (the page shows that).
	CheckWritten func(a Answers, written map[string]bool) error `json:"-"`
	// Quick is the kind's quick version (quick.go), set from quickSets on
	// registration; empty for a short kind.
	Quick []QuickField `json:"quick,omitempty"`
	// Version is bumped when the kind's structure changes. Rows keep the
	// version they were created with (worksheets.kind_version).
	Version  int       `json:"version"`
	Sections []Section `json:"sections"`
}

// Section is one headed part of a worksheet.
type Section struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	Hint  string `json:"hint,omitempty"`
	// Added marks a section up does not have. The outline harness skips it,
	// and it needs a line in testdata/deviations.txt saying why.
	Added bool `json:"added,omitempty"`
	// Continues marks a section that carries on the up section before it:
	// a heading inside up's one code block, such as the relationship card's
	// "After the conversation:". The outline harness counts it with that
	// section, so splitting a long block for the form changes no count.
	Continues bool    `json:"-"`
	Fields    []Field `json:"fields"`
}

// Field is one line, gate, checklist item or table.
type Field struct {
	Key   string    `json:"key"`
	Label string    `json:"label"`
	Type  FieldType `json:"type"`
	Hint  string    `json:"hint,omitempty"`
	// Options are a choice's or a multi's values, in up's order.
	Options []string `json:"options,omitempty"`
	// Other accepts free text beside Options, where up offers "other".
	Other bool `json:"other,omitempty"`
	// OptionHints are a choice's help per option, shown once that option is
	// chosen, such as the reading chapter's next step for each barrier layer.
	OptionHints map[string]string `json:"option_hints,omitempty"`
	// OptionLabels are the options as the learner reads them, by stored
	// value, where the interface language differs from English (Localized).
	OptionLabels map[string]string `json:"option_labels,omitempty"`
	// ScoreLabels are up's anchors for 0, 1 and 2.
	ScoreLabels []string `json:"score_labels,omitempty"`
	// MaxLen raises a long field's limit above MaxLong, up to
	// MaxLongCeiling. Zero is MaxLong.
	MaxLen int `json:"max_len,omitempty"`

	// Table only. RowHeader titles the row-label column of a fixed table.
	Columns   []Field `json:"columns,omitempty"`
	Rows      []Row   `json:"rows,omitempty"`
	RowHeader string  `json:"row_header,omitempty"`
	MaxRows   int     `json:"max_rows,omitempty"`

	// Column only. Text is a Label column's text, by row key — or, with
	// TextFrom, by the value of that choice column in the same row, so a
	// free table can show a label derived from a row's answer (the error
	// map's priority, from its impact). RowOptions are
	// a choice or multi column's options where they differ per row.
	Text       map[string]string   `json:"text,omitempty"`
	TextFrom   string              `json:"text_from,omitempty"`
	RowOptions map[string][]string `json:"row_options,omitempty"`
	// ForRows limits a fixed table's column to these rows, such as a
	// recording cell only on the days whose evidence is a recording. Other
	// rows show nothing there and refuse a value.
	ForRows []string `json:"for_rows,omitempty"`

	// ShowWhen shows a field only while another field of its section holds
	// a yes/no value, as up states a rule that applies after a failure (the
	// shadowing ladder's rebuild after level four). It is display only: the
	// value is validated and kept either way.
	ShowWhen *Condition `json:"show_when,omitempty"`
}

// Condition names a yes/no field of the same section, or one cell of a
// fixed table there, and the value that shows the field.
type Condition struct {
	Field  string `json:"field"`
	Row    string `json:"row,omitempty"`
	Column string `json:"column,omitempty"`
	Equals bool   `json:"equals"`
}

// Row is one fixed row of a table. Its Key is what answers store.
type Row struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	// See points the row at a section of another kind, such as an
	// experiment's day that practises the speaking evidence's shadowing
	// ladder. The page links the learner's own worksheet of that kind when
	// one exists.
	See *SeeAlso `json:"see,omitempty"`
}

// SeeAlso names a section of another kind.
type SeeAlso struct {
	Kind    string `json:"kind"`
	Section string `json:"section"`
}

// Review is a named review date, counted Days after its anchor:
//   - no From field: the day the worksheet was created;
//   - a From field of type Date: the date the learner wrote there;
//   - any other From field: the day that field was first filled (the first
//     pass, the delivery).
//
// Until an event anchor is filled the review is "not scheduled".
type Review struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Days  int    `json:"days"`
	From  Anchor `json:"from"`
}

// Anchor names the field a review counts from; zero means creation. Row and
// Column name one cell of a fixed table instead, such as the monologue
// baseline's recording or day 1's "done".
type Anchor struct {
	Section string `json:"section,omitempty"`
	Field   string `json:"field,omitempty"`
	Row     string `json:"row,omitempty"`
	Column  string `json:"column,omitempty"`
}

// IsCreation reports whether the anchor is the day the worksheet was created.
func (a Anchor) IsCreation() bool { return a.Section == "" && a.Field == "" }

// RowReview ties one row of a table to a review.
type RowReview struct {
	Section string `json:"section"`
	Field   string `json:"field"`
	Row     string `json:"row"`
	Review  string `json:"review"`
}

// ─────────────────────────────────────────────────────────── stored rows

// Answers are a worksheet's stored answers: section → field → value. A table
// value is []TableRow.
type Answers map[string]map[string]any

// TableRow is one row of a table value. Row is the fixed row's key, or "" in
// a free table.
type TableRow struct {
	Row   string         `json:"row"`
	Cells map[string]any `json:"cells"`
}

// ReviewDate is one scheduled review: when it is due, the earliest date it
// may be moved to (its anchor plus the kind's offset), and whether it is done.
type ReviewDate struct {
	Due      string `json:"due"`
	Earliest string `json:"earliest"`
	Done     bool   `json:"done,omitempty"`
}

// Worksheet is one row of worksheets.
type Worksheet struct {
	ID          uuid.UUID             `json:"id"`
	UserID      uuid.UUID             `json:"-"`
	Kind        string                `json:"kind"`
	KindVersion int                   `json:"kind_version"`
	Title       string                `json:"title"`
	Answers     Answers               `json:"answers"`
	StateID     *uuid.UUID            `json:"state_id,omitempty"`
	DocumentID  *uuid.UUID            `json:"document_id,omitempty"`
	CycleID     *uuid.UUID            `json:"cycle_id,omitempty"` // a cycle close's cycle (Kind.ClosesCycle)
	Status      string                `json:"status"`
	Private     bool                  `json:"private"`
	Reviews     map[string]ReviewDate `json:"reviews"`
	// Recordings are the worksheet's own recordings, oldest first. An audio
	// value must name one of them.
	Recordings []Recording `json:"recordings"`
	// SectionRevs is when each section (and "_title", "_status",
	// "_reviews") was last written: a PATCH is refused for a section written
	// after the revision it carries.
	SectionRevs map[string]time.Time `json:"-"`
	CreatedAt   time.Time            `json:"created_at"`
	// UpdatedAt is the revision a PATCH carries back.
	UpdatedAt time.Time `json:"updated_at"`
}

// Summary is a worksheet without its answers, for lists.
type Summary struct {
	ID         uuid.UUID             `json:"id"`
	Kind       string                `json:"kind"`
	Title      string                `json:"title"`
	Status     string                `json:"status"`
	Private    bool                  `json:"private"`
	StateID    *uuid.UUID            `json:"state_id,omitempty"`
	DocumentID *uuid.UUID            `json:"document_id,omitempty"`
	CycleID    *uuid.UUID            `json:"cycle_id,omitempty"`
	Reviews    map[string]ReviewDate `json:"reviews"`
	UpdatedAt  time.Time             `json:"updated_at"`
}

// ──────────────────────────────────────────────────────────── the registry

var (
	registry = map[string]*Kind{}
	keyShape = regexp.MustCompile(`^[a-z][a-z0-9_]{0,47}$`)
)

// register adds a kind. It panics on a mistake a kind file could make, so a
// broken kind fails every test binary that links it.
func register(k Kind) {
	if len(k.Quick) == 0 {
		k.Quick = quickSets[k.Kind]
	}
	if err := checkKind(&k); err != nil {
		panic(fmt.Sprintf("worksheet: kind %q: %v", k.Kind, err))
	}
	if _, dup := registry[k.Kind]; dup {
		panic(fmt.Sprintf("worksheet: kind %q registered twice", k.Kind))
	}
	registry[k.Kind] = &k
}

// Register is register for kinds declared outside this package: test
// fixtures (worksheettest). Product kinds live in this package and call
// register from init().
func Register(k Kind) { register(k) }

func checkKind(k *Kind) error {
	if !keyShape.MatchString(k.Kind) {
		return errors.New("kind id must be lower_snake_case")
	}
	if k.Name == "" || k.Source == "" {
		return errors.New("name and source are required")
	}
	if groupOrder(k.Group) > 2 {
		return fmt.Errorf("unknown group %q", k.Group)
	}
	switch k.Attach {
	case "":
		k.Attach = AttachNone
	case AttachNone, AttachState, AttachDocument, AttachStateOrDocument:
	default:
		return fmt.Errorf("unknown attach %q", k.Attach)
	}
	if k.ClosesCycle && k.Attach != AttachState {
		return errors.New("a kind that closes a cycle attaches to a learning state")
	}
	if k.Version < 1 {
		return errors.New("version must be at least 1")
	}
	if len(k.Sections) == 0 {
		return errors.New("no sections")
	}
	sections := map[string]bool{}
	for i, s := range k.Sections {
		if s.Continues && (i == 0 || s.Added || k.Sections[i-1].Added) {
			return fmt.Errorf("section %q continues no up section", s.Key)
		}
		if !keyShape.MatchString(s.Key) {
			return fmt.Errorf("section key %q", s.Key)
		}
		if sections[s.Key] {
			return fmt.Errorf("duplicate section %q", s.Key)
		}
		sections[s.Key] = true
		if s.Title == "" || len(s.Fields) == 0 {
			return fmt.Errorf("section %q needs a title and fields", s.Key)
		}
		fields := map[string]bool{}
		for _, f := range s.Fields {
			if fields[f.Key] {
				return fmt.Errorf("duplicate field %s.%s", s.Key, f.Key)
			}
			fields[f.Key] = true
			if err := checkField(f, false); err != nil {
				return fmt.Errorf("%s.%s: %w", s.Key, f.Key, err)
			}
		}
		for _, f := range s.Fields {
			if c := f.ShowWhen; c != nil {
				target := k.anchorField(Anchor{Section: s.Key, Field: c.Field, Row: c.Row, Column: c.Column})
				if target == nil || target.Type != YesNo || c.Field == f.Key {
					return fmt.Errorf("%s.%s: show_when names no yes/no field of its section", s.Key, f.Key)
				}
			}
		}
	}
	reviews := map[string]bool{}
	for _, r := range k.Reviews {
		if !keyShape.MatchString(r.Key) || reviews[r.Key] {
			return fmt.Errorf("review key %q", r.Key)
		}
		reviews[r.Key] = true
		if r.Days < 0 || r.Label == "" {
			return fmt.Errorf("review %q needs a label and a non-negative offset", r.Key)
		}
		if !r.From.IsCreation() && k.anchorField(r.From) == nil {
			return fmt.Errorf("review %q counts from %s.%s, which is not a field or a fixed table's cell",
				r.Key, r.From.Section, r.From.Field)
		}
	}
	for _, rr := range k.RowReviews {
		f := k.field(rr.Section, rr.Field)
		if f == nil || f.Type != Table || !reviews[rr.Review] || !f.hasRow(rr.Row) {
			return fmt.Errorf("row review %s.%s[%s] → %s does not name a fixed row and a review", rr.Section, rr.Field, rr.Row, rr.Review)
		}
	}
	return checkQuick(k)
}

func checkField(f Field, column bool) error {
	if !keyShape.MatchString(f.Key) {
		return fmt.Errorf("field key %q", f.Key)
	}
	if f.Label == "" {
		return errors.New("no label")
	}
	switch f.Type {
	case Text, Long, YesNo, Date, Check, Audio:
	case Score:
		if len(f.ScoreLabels) != 0 && len(f.ScoreLabels) != 3 {
			return errors.New("a score has three anchor labels or none")
		}
	case Choice, Multi:
		if len(f.Options) == 0 && len(f.RowOptions) == 0 {
			return errors.New("a choice without options")
		}
		if len(f.RowOptions) > 0 && !column {
			return errors.New("row options belong to a table column")
		}
		for _, opts := range f.RowOptions {
			if len(opts) == 0 {
				return errors.New("a choice without options")
			}
		}
		for o := range f.OptionHints {
			if !contains(f.Options, o) {
				return fmt.Errorf("a hint for %q, which is not one of the choice's options", o)
			}
		}
	case Label:
		if !column {
			return errors.New("a label is a table column")
		}
	case Table:
		if column {
			return errors.New("a table inside a table")
		}
		if len(f.Columns) == 0 {
			return errors.New("a table without columns")
		}
		if len(f.Rows) == 0 && (f.MaxRows < 1 || f.MaxRows > MaxRowsCeiling) {
			return fmt.Errorf("a free table needs MaxRows between 1 and %d", MaxRowsCeiling)
		}
		if len(f.Rows) > 0 && f.MaxRows != 0 {
			return errors.New("a fixed table has no MaxRows")
		}
		rows := map[string]bool{}
		for _, r := range f.Rows {
			if !keyShape.MatchString(r.Key) || rows[r.Key] || r.Label == "" {
				return fmt.Errorf("row %q", r.Key)
			}
			if r.See != nil && (!keyShape.MatchString(r.See.Kind) || !keyShape.MatchString(r.See.Section)) {
				return fmt.Errorf("row %q: see names no kind and section", r.Key)
			}
			rows[r.Key] = true
		}
		cols := map[string]bool{}
		for _, c := range f.Columns {
			if cols[c.Key] {
				return fmt.Errorf("duplicate column %q", c.Key)
			}
			cols[c.Key] = true
			if err := checkField(c, true); err != nil {
				return fmt.Errorf("column %s: %w", c.Key, err)
			}
			if c.TextFrom != "" {
				if err := checkTextFrom(f, c); err != nil {
					return fmt.Errorf("column %s: %w", c.Key, err)
				}
				continue
			}
			if (len(c.RowOptions) > 0 || len(c.Text) > 0) && len(f.Rows) == 0 {
				return fmt.Errorf("column %s: per-row text and options need fixed rows", c.Key)
			}
			for row := range c.RowOptions {
				if !rows[row] {
					return fmt.Errorf("column %s: row options for unknown row %q", c.Key, row)
				}
			}
			for row := range c.Text {
				if !rows[row] {
					return fmt.Errorf("column %s: text for unknown row %q", c.Key, row)
				}
			}
			for _, row := range c.ForRows {
				if !rows[row] {
					return fmt.Errorf("column %s: for unknown row %q", c.Key, row)
				}
			}
		}
	default:
		return fmt.Errorf("unknown type %q", f.Type)
	}
	if f.MaxLen != 0 && (f.Type != Long || column || f.MaxLen < MaxLong || f.MaxLen > MaxLongCeiling) {
		return fmt.Errorf("MaxLen belongs to a long field, between %d and %d", MaxLong, MaxLongCeiling)
	}
	if len(f.OptionHints) > 0 && f.Type != Choice {
		return errors.New("option hints belong to a choice")
	}
	if f.Type != Table && (len(f.Columns) > 0 || len(f.Rows) > 0 || f.MaxRows > 0) {
		return errors.New("columns and rows belong to a table")
	}
	if len(f.ForRows) > 0 && !column {
		return errors.New("for_rows belongs to a table column")
	}
	if f.TextFrom != "" && !column {
		return errors.New("text_from belongs to a table column")
	}
	if f.ShowWhen != nil && column {
		return errors.New("show_when belongs to a field, not a column")
	}
	return nil
}

// checkTextFrom checks a label column whose text follows another column: it
// names a choice column of the same table, and has a text for each of that
// column's options and nothing else.
func checkTextFrom(table Field, c Field) error {
	if c.Type != Label {
		return errors.New("text_from belongs to a label column")
	}
	var from *Field
	for i := range table.Columns {
		if table.Columns[i].Key == c.TextFrom {
			from = &table.Columns[i]
		}
	}
	if from == nil || from.Type != Choice || len(from.RowOptions) > 0 {
		return fmt.Errorf("text_from %q names no choice column", c.TextFrom)
	}
	if len(c.Text) != len(from.Options) {
		return fmt.Errorf("text_from %q: one text per option", c.TextFrom)
	}
	for _, o := range from.Options {
		if _, ok := c.Text[o]; !ok {
			return fmt.Errorf("text_from %q: no text for %q", c.TextFrom, o)
		}
	}
	return nil
}

// LabelText is what a label column shows in a row: its text for the row's
// key, or for the row's answer in the TextFrom column.
func (f *Field) LabelText(rowKey string, cells map[string]any) string {
	if f.TextFrom == "" {
		return f.Text[rowKey]
	}
	v, _ := cells[f.TextFrom].(string)
	return f.Text[v]
}

// anchorField is the field an anchor names: a field that holds a value, or
// one cell (Row, Column) of a fixed table. nil when it names nothing usable.
func (k *Kind) anchorField(a Anchor) *Field {
	f := k.field(a.Section, a.Field)
	if f == nil || f.Type == Label {
		return nil
	}
	if f.Type != Table {
		if a.Row != "" || a.Column != "" {
			return nil
		}
		return f
	}
	if !f.hasRow(a.Row) {
		return nil
	}
	for i := range f.Columns {
		if c := &f.Columns[i]; c.Key == a.Column && c.Type != Label && c.appliesTo(a.Row) {
			return c
		}
	}
	return nil
}

// appliesTo reports whether a column is used on a row (ForRows).
func (f *Field) appliesTo(row string) bool {
	return len(f.ForRows) == 0 || contains(f.ForRows, row)
}

// HasAudio reports whether any field or column of the kind holds a
// recording: only such a worksheet takes uploads.
func (k *Kind) HasAudio() bool {
	for _, s := range k.Sections {
		for _, f := range s.Fields {
			if f.Type == Audio {
				return true
			}
			for _, c := range f.Columns {
				if c.Type == Audio {
					return true
				}
			}
		}
	}
	return false
}

func (k *Kind) field(section, field string) *Field {
	for i := range k.Sections {
		if k.Sections[i].Key != section {
			continue
		}
		for j := range k.Sections[i].Fields {
			if k.Sections[i].Fields[j].Key == field {
				return &k.Sections[i].Fields[j]
			}
		}
	}
	return nil
}

func (k *Kind) section(key string) *Section {
	for i := range k.Sections {
		if k.Sections[i].Key == key {
			return &k.Sections[i]
		}
	}
	return nil
}

func (k *Kind) review(key string) *Review {
	for i := range k.Reviews {
		if k.Reviews[i].Key == key {
			return &k.Reviews[i]
		}
	}
	return nil
}

func (f *Field) hasRow(key string) bool {
	for _, r := range f.Rows {
		if r.Key == key {
			return true
		}
	}
	return false
}

// Lookup returns a registered kind.
func Lookup(kind string) (*Kind, bool) {
	k, ok := registry[kind]
	return k, ok
}

// Name is a kind's display name, or the id itself for a kind no longer
// registered.
func Name(kind string) string {
	if k, ok := registry[kind]; ok {
		return k.Name
	}
	return kind
}

// IsPrivate reports whether a kind is private. An unknown kind answers true:
// what cannot be classified is not shown to a model.
func IsPrivate(kind string) bool {
	k, ok := registry[kind]
	return !ok || k.Private
}

// Kinds returns every registered kind, sorted by group, then name.
func Kinds() []*Kind {
	out := make([]*Kind, 0, len(registry))
	for _, k := range registry {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool {
		if gi, gj := groupOrder(out[i].Group), groupOrder(out[j].Group); gi != gj {
			return gi < gj
		}
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].Kind < out[j].Kind
	})
	return out
}
