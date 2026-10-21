package body

import (
	"testing"
	"time"
)

// squat is a library exercise on the heavy side (upper legs: 5 kg steps);
// curl is a light one (2.5 kg).
const (
	squat = "0043" // barbell full squat
	curl  = "0031" // barbell curl
)

func session(goal int, weight float64, reps ...int) Entry {
	e := Entry{Exercise: squat, Target: PlanExercise{Exercise: squat, Mode: ModeReps, Sets: len(reps), Reps: goal, Weight: weight}}
	for _, r := range reps {
		e.Sets = append(e.Sets, Set{Weight: weight, Reps: r, Done: true})
	}
	return e
}

func TestLibraryHasTheExercisesTheseTestsName(t *testing.T) {
	for _, id := range []string{squat, curl} {
		e, ok := Lookup(id)
		if !ok {
			t.Fatalf("%s is not in the library", id)
		}
		t.Logf("%s = %s (%s)", id, e.Name, e.BodyPart)
	}
	if len(Library()) != 1324 {
		t.Errorf("library has %d exercises, want 1324", len(Library()))
	}
	for _, e := range Library() {
		if e.Name == "" || e.BodyPart == "" || e.Equipment == "" {
			t.Fatalf("incomplete exercise %+v", e)
		}
	}
}

func TestReadSessionIsHonest(t *testing.T) {
	if s := ReadSession(session(5, 100, 5, 5, 5)); !s.OK || s.Weight != 100 {
		t.Errorf("every rep = %+v, want ok", s)
	}
	if s := ReadSession(session(5, 100, 5, 5, 4)); s.OK || s.Low != 4 {
		t.Errorf("a short set = %+v, want a miss", s)
	}
	// A set never ticked is a miss, not a gap.
	e := session(5, 100, 5, 5, 5)
	e.Sets[2].Done = false
	if ReadSession(e).OK {
		t.Error("an unticked set counted as a hit")
	}
	// Fewer sets than planned is a miss.
	e = session(5, 100, 5, 5)
	e.Target.Sets = 3
	if ReadSession(e).OK {
		t.Error("two of three sets counted as a hit")
	}
}

func TestNextLinear(t *testing.T) {
	ex := PlanExercise{Exercise: squat, Mode: ModeReps, Sets: 3, Reps: 5}
	if p := Next(ex, "", nil, UnitKg); p.Kind != "first" {
		t.Fatalf("no history = %+v", p)
	}
	hit := ReadSession(session(5, 100, 5, 5, 5))
	if p := Next(ex, "", []Session{hit}, UnitKg); p.Kind != "up" || *p.Weight != 105 {
		t.Errorf("after a clean session = %+v, want 105", p)
	}
	if p := Next(ex, "", []Session{hit}, UnitLb); *p.Weight != 110 {
		t.Errorf("in pounds = %v, want 110", *p.Weight)
	}
	miss := ReadSession(session(5, 100, 5, 4, 3))
	p := Next(ex, "", []Session{hit, miss}, UnitKg)
	if p.Kind != "hold" || *p.Weight != 100 || p.Left != 2 {
		t.Errorf("after one miss = %+v, want hold at 100, 2 to go", p)
	}
	p = Next(ex, "", []Session{miss, miss, miss}, UnitKg)
	if p.Kind != "deload" || *p.Weight != 90 || p.Stalls != 3 {
		t.Errorf("after three misses = %+v, want deload to 90", p)
	}
	// A light lift takes the small step.
	c := PlanExercise{Exercise: curl, Mode: ModeReps, Sets: 3, Reps: 10}
	if p := Next(c, "", []Session{{Mode: ModeReps, Goal: 10, Weight: 20, OK: true}}, UnitKg); *p.Weight != 22.5 {
		t.Errorf("curl = %v, want 22.5", *p.Weight)
	}
}

func TestDeloadAlwaysTakesSomethingOff(t *testing.T) {
	// 10 % of 5 kg rounds back to 5 on a 2.5 step: take one step instead.
	if got := deloadTo(5, 2.5); got != 2.5 {
		t.Errorf("deloadTo(5, 2.5) = %v", got)
	}
	if got := deloadTo(2.5, 2.5); got != 2.5 {
		t.Errorf("never below one step: %v", got)
	}
}

func TestNextDoubleProgression(t *testing.T) {
	ex := PlanExercise{Exercise: curl, Mode: ModeReps, Sets: 3, Reps: 12, RepsMin: 8, Prog: PolicyDouble}
	top := Session{Mode: ModeReps, Goal: 12, Weight: 20, Low: 12, OK: true}
	if p := Next(ex, "", []Session{top}, UnitKg); p.Reason != "range_up" || *p.Weight != 22.5 || *p.Reps != 8 {
		t.Errorf("top of range = %+v", p)
	}
	mid := Session{Mode: ModeReps, Goal: 12, Weight: 20, Low: 9}
	if p := Next(ex, "", []Session{mid}, UnitKg); p.Reason != "range_hold" || *p.Reps != 10 || *p.Weight != 20 {
		t.Errorf("mid range = %+v, want 10 reps at 20", p)
	}
}

func TestBodyweightProgressesInReps(t *testing.T) {
	ex := PlanExercise{Exercise: curl, Mode: ModeReps, Sets: 3, Reps: 10}
	p := Next(ex, "", []Session{{Mode: ModeReps, Goal: 10, Weight: 0, Low: 10, OK: true}}, UnitKg)
	if p.Reason != "bodyweight_up" || *p.Reps != 11 || *p.Weight != 0 {
		t.Errorf("= %+v", p)
	}
}

func TestTimedHolds(t *testing.T) {
	ex := PlanExercise{Exercise: curl, Mode: ModeTime, Sets: 3, Sec: 30}
	if PolicyFor(ex, "") != PolicyTime {
		t.Fatalf("a hold defaults to the time policy")
	}
	if p := Next(ex, "", []Session{{Mode: ModeTime, Goal: 30, OK: true}}, UnitKg); *p.Sec != 35 {
		t.Errorf("held = %+v, want 35 s", p)
	}
	// A routine's linear default cannot drive a hold.
	if PolicyFor(ex, PolicyLinear) != PolicyOff {
		t.Error("linear drove a timed exercise")
	}
}

func TestEstimate1RM(t *testing.T) {
	cases := []struct {
		w    float64
		r    int
		want float64
	}{
		{100, 1, 100}, {100, 10, 133.3}, {100, 12, 140}, {100, 13, 0}, {0, 5, 0}, {100, 0, 0},
	}
	for _, c := range cases {
		if got := Estimate1RM(c.w, c.r); got != c.want {
			t.Errorf("Estimate1RM(%v, %d) = %v, want %v", c.w, c.r, got, c.want)
		}
	}
}

func TestRecordsAndStats(t *testing.T) {
	done := func(day string, e Entry) Workout {
		start, _ := time.Parse(dayLayout, day)
		end := start.Add(50 * time.Minute)
		return Workout{Day: day, StartedAt: start, FinishedAt: &end, Entries: []Entry{e}}
	}
	old := done("2026-10-12", session(5, 100, 5, 5, 5))
	now := done("2026-10-19", session(5, 105, 5, 5, 5))
	rec := Records(now, []Workout{old})
	if len(rec) != 1 || rec[0].E1RM != 122.5 || rec[0].Previous != 116.7 {
		t.Fatalf("records = %+v", rec)
	}
	if Records(old, []Workout{now}) != nil {
		t.Error("a lighter session set a record")
	}

	today, _ := time.Parse(dayLayout, "2026-10-19")
	st := BuildStats(DefaultProfile(), []Workout{old, now}, nil, today)
	if st.Workouts != 2 || st.ThisWeek != 1 || st.Minutes != 100 || len(st.Heatmap) != 2 {
		t.Errorf("stats = %+v", st)
	}
	if len(st.Exercises) != 1 || st.Exercises[0].Best.E1RM != 122.5 || len(st.Exercises[0].Series) != 2 {
		t.Errorf("trend = %+v", st.Exercises)
	}
	var quads Coverage
	for _, c := range st.Coverage {
		if c.Group == GroupOf(squat) {
			quads = c
		}
	}
	if quads.Week != 3 || quads.Month != 6 {
		t.Errorf("coverage of %s = %+v", GroupOf(squat), quads)
	}
}

// Found walking through the feature in a browser (2026-10-20): a first
// workout called every lift a "new best", a row took a squat's 5 kg step, the
// quads read zero after squats, and the picker showed lower-case names.
func TestWhatABrowserWalkthroughFound(t *testing.T) {
	const row, bench = "0027", "0025" // barbell bent over row, barbell bench press
	start, _ := time.Parse(dayLayout, "2026-10-19")
	end := start.Add(45 * time.Minute)
	first := Workout{Day: "2026-10-19", StartedAt: start, FinishedAt: &end, Entries: []Entry{session(5, 40, 5, 5, 5)}}

	if rec := Records(first, nil); rec != nil {
		t.Errorf("a first session set records: %+v", rec)
	}
	if got := DefaultIncrement(row, UnitKg); got != 2.5 {
		t.Errorf("a row's step = %v kg, want 2.5", got)
	}
	if got := DefaultIncrement(squat, UnitKg); got != 5 {
		t.Errorf("a squat's step = %v kg, want 5", got)
	}
	st := BuildStats(DefaultProfile(), []Workout{first}, nil, start)
	by := map[string]Coverage{}
	for _, c := range st.Coverage {
		by[c.Group] = c
	}
	if by["glutes"].Week != 3 || by["quads"].Week != 1.5 || by["chest"].Week != 0 {
		t.Errorf("coverage after three squat sets: glutes %v, quads %v, chest %v", by["glutes"].Week, by["quads"].Week, by["chest"].Week)
	}
	if e, _ := Lookup(bench); e.Name != "Barbell bench press" {
		t.Errorf("name = %q, want it capitalised", e.Name)
	}
}

// The coach is handed the goal as a phrase: given the code "strength", a model
// quoted it back to the learner as "your goal 'strength'".
func TestTheCoachReadsTheIntakeAsPhrases(t *testing.T) {
	out := intakeOut(&Intake{Goal: "strength", Experience: "new"}).(map[string]any)
	if out["goal"] != "get stronger" || out["experience"] != "new to training" {
		t.Errorf("intake = %v", out)
	}
	for _, g := range Goals {
		if goalWords[g] == "" {
			t.Errorf("goal %q has no phrase", g)
		}
	}
	for _, e := range Experiences {
		if experienceWords[e] == "" {
			t.Errorf("experience %q has no phrase", e)
		}
	}
}
