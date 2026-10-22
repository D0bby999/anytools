package showcase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/progress"
)

func TestADesignIsReadStrictlyAndCleaned(t *testing.T) {
	d, err := ParseDesign([]byte(`{"version":1,"theme":{"accent":"read"},"blocks":[
		{"type":"summary"},
		{"type":"about","title":"  Why  ","body":"Line one\r\nline two "},
		{"type":"links","links":[{"label":" Site ","url":" https://example.com/me "}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if d.Theme.Accent != "read" || d.Blocks[1].Title != "Why" || d.Blocks[1].Body != "Line one\nline two" {
		t.Fatalf("not cleaned: %+v", d)
	}
	if l := d.Blocks[2].Links[0]; l.Label != "Site" || l.URL != "https://example.com/me" {
		t.Fatalf("link = %+v", l)
	}

	d, err = ParseDesign([]byte(`{"version":1,"theme":{},"blocks":null}`))
	if err != nil || d.Theme.Accent != "reflect" || d.Blocks == nil || len(d.Blocks) != 0 {
		t.Fatalf("empty design = %+v, %v", d, err)
	}

	many := `{"version":1,"theme":{},"blocks":[` + strings.Repeat(`{"type":"about","body":"x"},`, 12) + `{"type":"summary"}]}`
	for name, tc := range map[string]struct {
		raw  string
		want error
	}{
		"not json":        {`{`, errDesign},
		"later version":   {`{"version":2,"theme":{},"blocks":[]}`, errDesign},
		"no version":      {`{"theme":{},"blocks":[]}`, errDesign},
		"unknown field":   {`{"version":1,"theme":{},"blocks":[],"css":"body{}"}`, errDesign},
		"unknown option":  {`{"version":1,"theme":{},"blocks":[{"type":"summary","html":"<b>"}]}`, errField},
		"theme option":    {`{"version":1,"theme":{"css":"x"},"blocks":[]}`, errDesign},
		"unknown type":    {`{"version":1,"theme":{},"blocks":[{"type":"script"}]}`, errBlockType},
		"too many":        {many, errBlocks},
		"two calendars":   {`{"version":1,"theme":{},"blocks":[{"type":"calendar"},{"type":"calendar"}]}`, errRepeat},
		"four abouts":     {`{"version":1,"theme":{},"blocks":[` + strings.Repeat(`{"type":"about","body":"x"},`, 3) + `{"type":"about","body":"x"}]}`, errRepeat},
		"data with text":  {`{"version":1,"theme":{},"blocks":[{"type":"summary","title":"Mine"}]}`, errField},
		"about with link": {`{"version":1,"theme":{},"blocks":[{"type":"about","body":"x","links":[]}]}`, errField},
		"empty about":     {`{"version":1,"theme":{},"blocks":[{"type":"about","body":"  "}]}`, errAbout},
		"long about":      {`{"version":1,"theme":{},"blocks":[{"type":"about","body":"` + strings.Repeat("ẽ", 1001) + `"}]}`, errAbout},
		"control char":    {`{"version":1,"theme":{},"blocks":[{"type":"about","title":"a\u0007","body":"x"}]}`, errHidden},
		"direction mark":  {`{"version":1,"theme":{},"blocks":[{"type":"links","links":[{"label":"moc.live\u202e","url":"https://a.example"}]}]}`, errHidden},
		"zero width":      {`{"version":1,"theme":{},"blocks":[{"type":"about","body":"a\u200bb"}]}`, errHidden},
		"empty title key": {`{"version":1,"theme":{},"blocks":[{"type":"calendar","title":""}]}`, errField},
		"accent":          {`{"version":1,"theme":{"accent":"#ff0000"},"blocks":[]}`, errAccent},
		"http link":       {`{"version":1,"theme":{},"blocks":[{"type":"links","links":[{"label":"a","url":"http://example.com"}]}]}`, errLinks},
		"script link":     {`{"version":1,"theme":{},"blocks":[{"type":"links","links":[{"label":"a","url":"javascript:alert(1)"}]}]}`, errLinks},
		"credentials":     {`{"version":1,"theme":{},"blocks":[{"type":"links","links":[{"label":"a","url":"https://u:p@example.com"}]}]}`, errLinks},
		"no links":        {`{"version":1,"theme":{},"blocks":[{"type":"links","links":[]}]}`, errLinks},
		"six links":       {`{"version":1,"theme":{},"blocks":[{"type":"links","links":[` + strings.Repeat(`{"label":"a","url":"https://a.example"},`, 5) + `{"label":"a","url":"https://a.example"}]}]}`, errLinks},
	} {
		if _, err := ParseDesign([]byte(tc.raw)); !errors.Is(err, tc.want) || !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want %v", name, err, tc.want)
		}
	}
}

func TestHandles(t *testing.T) {
	for _, ok := range []string{"minh", "an-nguyen", "a1b", strings.Repeat("a", 30)} {
		if err := CheckHandle(ok); err != nil {
			t.Errorf("%q refused: %v", ok, err)
		}
	}
	for _, bad := range []string{"ab", "-ab", "ab-", "a--b", "a_b", "Ab", "ả", "a b", strings.Repeat("a", 31)} {
		if !errors.Is(CheckHandle(bad), errHandle) {
			t.Errorf("%q accepted", bad)
		}
	}
	if !errors.Is(CheckHandle("admin"), errReserved) || !errors.Is(CheckHandle("anylearn"), errReserved) {
		t.Error("a reserved handle was accepted")
	}
	if NormalizeHandle("  @Minh-Anh ") != "minh-anh" {
		t.Error("handle not normalized")
	}
}

type fakeStore struct {
	rows  map[uuid.UUID]*Stored
	saved []byte
}

func (f *fakeStore) Get(_ context.Context, user uuid.UUID) (*Stored, error) { return f.rows[user], nil }
func (f *fakeStore) Published(_ context.Context, handle string) (uuid.UUID, *Stored, error) {
	for u, st := range f.rows {
		if st.Handle == handle && st.Published {
			return u, st, nil
		}
	}
	return uuid.Nil, nil, ErrNotFound
}
func (f *fakeStore) Save(_ context.Context, user uuid.UUID, p Profile, design []byte) (time.Time, error) {
	f.saved = design
	f.rows[user] = &Stored{Handle: p.Handle, Name: p.Name, Headline: p.Headline, Published: p.Published, Design: design}
	return time.Now(), nil
}
func (f *fakeStore) Delete(_ context.Context, user uuid.UUID) error { delete(f.rows, user); return nil }
func (f *fakeStore) Listed(context.Context, int) ([]Listed, error)  { return nil, nil }

type fakeCounter struct{ fresh []time.Duration }

func (f *fakeCounter) SummaryWithin(_ context.Context, _ uuid.UUID, fresh time.Duration) (*progress.Summary, error) {
	f.fresh = append(f.fresh, fresh)
	return &progress.Summary{
		Today: "2026-10-22", FirstDay: "2026-01-05",
		Settings: progress.Settings{WeekGoal: 4},
		Streak:   progress.Streak{Current: 12, Longest: 30},
		Week:     progress.Week{InARow: 3, Longest: 8},
		Level:    progress.LevelOf(90),
		Totals:   progress.Counts{Questions: 400, Workouts: 20},
		Outcomes: progress.Outcomes{LongTerm: 150, Mastered: 9, ExplainsPassed: 4, Right: 3, Answered: 5},
		Calendar: []progress.DayCount{{Day: "2026-10-21", Count: 7}},
		Milestones: []progress.Milestone{
			{Kind: "days", Target: 60, Value: 90, ReachedOn: "2026-08-01"},
			{Kind: "days", Target: 100, Value: 90},
		},
	}, nil
}

func TestTheServiceSavesAndShowsOnlyWhatThePageHas(t *testing.T) {
	ctx := context.Background()
	store := &fakeStore{rows: map[uuid.UUID]*Stored{}}
	counter := &fakeCounter{}
	svc := NewService(store, counter)
	user := uuid.New()

	mine, err := svc.Mine(ctx, user)
	if err != nil || mine.Profile != nil || mine.Stats.Summary == nil || mine.Stats.Outcomes == nil || len(mine.Default.Blocks) != 3 {
		t.Fatalf("before saving: %+v, %v", mine, err)
	}

	in := Input{Handle: " @Minh ", Name: " Minh ", Headline: "Learning Go", Design: json.RawMessage(`{"version":1,"theme":{"accent":"ask"},"blocks":[{"type":"calendar"},{"type":"milestones"}]}`)}
	if _, err := svc.Read(ctx, "minh"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("read before saving: %v", err)
	}
	p, err := svc.Save(ctx, user, in)
	if err != nil || p.Handle != "minh" || p.Name != "Minh" {
		t.Fatalf("save = %+v, %v", p, err)
	}
	if _, err := svc.Read(ctx, "minh"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an unpublished page was read: %v", err)
	}

	in.Published = true
	if _, err := svc.Save(ctx, user, in); err != nil {
		t.Fatal(err)
	}
	page, err := svc.Read(ctx, "MINH")
	if err != nil {
		t.Fatal(err)
	}
	s := page.Stats
	if s.Summary != nil || s.Outcomes != nil {
		t.Errorf("blocks not on the page sent their data: %+v", s)
	}
	if len(s.Calendar) != 1 || len(s.Milestones) != 1 || s.Milestones[0].Target != 60 || s.AsOf != "2026-10-22" {
		t.Errorf("stats = %+v", s)
	}
	if s.Since != "" {
		t.Errorf("the first study day went out without the summary block: %q", s.Since)
	}
	if got := counter.fresh[len(counter.fresh)-1]; got != progress.FreshForCircle {
		t.Errorf("a visitor's read counted with fresh %v", got)
	}
	raw, _ := json.Marshal(page)
	// A milestone's value is the current total of its kind: 90 study days
	// here, which only the summary block may show.
	for _, leak := range []string{`"summary":{`, `"right"`, `"value"`, `90`, `"since"`} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("the public page says more than its blocks (%s): %s", leak, raw)
		}
	}

	// A page of the learner's words only is not counted at all.
	calls := len(counter.fresh)
	store.rows[user].Design = []byte(`{"version":1,"theme":{},"blocks":[{"type":"about","body":"Hi"}]}`)
	page, err = svc.Read(ctx, "minh")
	if err != nil || len(counter.fresh) != calls || page.Stats.AsOf != "" || page.Stats.Calendar != nil {
		t.Fatalf("an uncounted page was counted: %+v, %v", page.Stats, err)
	}

	// A stored block a later rule refuses is left out, the rest still show,
	// and the editor is told.
	store.rows[user].Design = []byte(`{"version":1,"theme":{"accent":"gone"},"blocks":[{"type":"calendar"},{"type":"about","body":"` + strings.Repeat("x", 1001) + `"},{"type":"widget"}]}`)
	page, err = svc.Read(ctx, "minh")
	if err != nil || len(page.Profile.Design.Blocks) != 1 || page.Profile.Design.Theme.Accent != "reflect" || page.Stats.Calendar == nil {
		t.Fatalf("lenient read: %+v, %v", page, err)
	}
	if mine, _ := svc.Mine(ctx, user); mine.Dropped != 2 {
		t.Errorf("dropped = %d, want 2", mine.Dropped)
	}

	// A stored design this version cannot read shows no blocks.
	store.rows[user].Design = []byte(`{"version":9}`)
	page, err = svc.Read(ctx, "minh")
	if err != nil || len(page.Profile.Design.Blocks) != 0 || page.Stats.Calendar != nil {
		t.Fatalf("unreadable design: %+v, %v", page, err)
	}
	if mine, _ := svc.Mine(ctx, user); mine.Dropped != -1 {
		t.Errorf("dropped = %d, want -1", mine.Dropped)
	}

	for name, bad := range map[string]Input{
		"handle":   {Handle: "a", Name: "x", Design: in.Design},
		"reserved": {Handle: "admin", Name: "x", Design: in.Design},
		"name":     {Handle: "minh", Name: " ", Design: in.Design},
		"headline": {Handle: "minh", Name: "x", Headline: strings.Repeat("h", 121), Design: in.Design},
		"design":   {Handle: "minh", Name: "x"},
		"bidi":     {Handle: "minh", Name: "Minh\u202e", Design: in.Design},
	} {
		if _, err := svc.Save(ctx, user, bad); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if _, err := svc.Read(ctx, "../etc"); !errors.Is(err, ErrNotFound) {
		t.Errorf("a malformed handle: %v", err)
	}
}
