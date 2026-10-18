package profile

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// testSignals is two knowledge points in one knowledge base, the base itself,
// and one vocabulary language.
func testSignals() (*Signals, uuid.UUID) {
	kb := uuid.New()
	return BuildSignals(SignalRows{
		Points: []PointRow{
			{KnowledgePointID: uuid.New(), KnowledgeBaseID: kb, PathID: uuid.New(), Name: "Parametric memory",
				Errors: map[string]int{"recall": 3}, OpenMistakes: 2, MistakeID: uuid.New(), Attempts: 6, Correct: 2, Mastery: 0.3},
			{KnowledgePointID: uuid.New(), KnowledgeBaseID: kb, PathID: uuid.New(), Name: "Dense retrieval",
				Attempts: 5, Correct: 5, Mastery: 0.9, Graduated: true, ExplainPassed: 1},
		},
		Bases: []BaseRow{{KnowledgeBaseID: kb, Name: "Retrieval papers", Attempts: 11, Correct: 7, OpenMistakes: 2}},
		Vocab: []VocabRow{{Lang: "vi", Cards: 10, Reviews: 20, Lapses: 8, CardID: uuid.New()}},
	}), kb
}

func check(t *testing.T, ops []RawOp, mutate func(*GuardInput)) ([]Proposal, []RunOp) {
	t.Helper()
	sig, _ := testSignals()
	in := GuardInput{Signals: sig, Accepted: map[string]int{}, Texts: map[string][]string{}, Now: time.Now()}
	if mutate != nil {
		mutate(&in)
	}
	return Check(ops, in)
}

func reasons(log []RunOp) []string {
	var out []string
	for _, l := range log {
		if l.Status == "dropped" {
			out = append(out, l.Reason)
		}
	}
	return out
}

func TestAStatementMustCiteASignalItWasGiven(t *testing.T) {
	props, log := check(t, []RawOp{
		{Op: "add", Section: "struggles", Text: "Recall mistakes recur on this point.", Refs: []string{"S1"}},
		{Op: "add", Section: "struggles", Text: "No evidence at all here.", Refs: nil},
		{Op: "add", Section: "struggles", Text: "An invented key.", Refs: []string{"S99", "E1"}},
		// An invented key beside a real one: the real one stands, the other goes.
		{Op: "add", Section: "strengths", Text: "Dense retrieval answers have held up.", Refs: []string{"S2", "S404"}},
	}, nil)
	if len(props) != 2 {
		t.Fatalf("proposals = %+v; want the two that cite a given signal (log %+v)", props, log)
	}
	if got := reasons(log); len(got) != 2 || got[0] != reasonNoRefs || got[1] != reasonNoRefs {
		t.Fatalf("drop reasons = %v", got)
	}
	// S1 is a knowledge point with an open mistake: both rows are cited, and
	// the statement is about the point's knowledge base.
	if refs := props[0].Refs; len(refs) != 2 || refs[0].Kind != RefKnowledgePoint || refs[1].Kind != RefMistake {
		t.Errorf("S1 refs = %+v", refs)
	}
	if props[0].KBID == nil {
		t.Error("a statement citing only one knowledge base's signals was not scoped to it")
	}
	if len(props[1].Refs) != 1 {
		t.Errorf("an invented key survived beside a real one: %+v", props[1].Refs)
	}
}

func TestAStatementAcrossLanguagesIsNotScopedToAKnowledgeBase(t *testing.T) {
	props, _ := check(t, []RawOp{
		{Op: "add", Section: "struggles", Text: "Vietnamese cards and recall both lapse.", Refs: []string{"S1", "S4"}},
	}, nil)
	if len(props) != 1 || props[0].KBID != nil {
		t.Fatalf("proposal = %+v; a statement citing vocabulary is about no one knowledge base", props)
	}
}

func TestAbsolutesAreRefused(t *testing.T) {
	for _, text := range []string{
		"The learner has mastered dense retrieval.",
		"An expert at retrieval.",
		"Shows expertise in retrieval.",
		"Always gets recall right.",
		"Never misreads a question.",
		"Fluently reads Vietnamese.",
		"Perfect accuracy lately.",
		"Ｐｅｒｆｅｃｔ accuracy lately.", // full-width letters spell the same word
	} {
		_, log := check(t, []RawOp{{Op: "add", Section: "strengths", Text: text, Refs: []string{"S2"}}}, nil)
		if got := reasons(log); len(got) != 1 || got[0] != reasonAbsolute {
			t.Errorf("%q: %v; want it refused as an absolute", text, got)
		}
	}
	// Hedged wording passes, and words merely containing a banned one do too.
	props, log := check(t, []RawOp{{Op: "add", Section: "strengths",
		Text: "Across 5 answers, dense retrieval has held up; nevertheless keep reviewing.", Refs: []string{"S2"}}}, nil)
	if len(props) != 1 {
		t.Fatalf("a hedged statement was refused: %v", reasons(log))
	}
}

func TestTextIsOneLineOfAtMost280Characters(t *testing.T) {
	props, log := check(t, []RawOp{
		{Op: "add", Section: "struggles", Text: strings.Repeat("a", 281), Refs: []string{"S1"}},
		{Op: "add", Section: "struggles", Text: "Recall\nmistakes\n\nrecur.", Refs: []string{"S1"}},
		{Op: "add", Section: "struggles", Text: "   ", Refs: []string{"S1"}},
	}, nil)
	if got := reasons(log); len(got) != 2 || got[0] != reasonTooLong || got[1] != reasonNoText {
		t.Fatalf("drop reasons = %v", got)
	}
	if len(props) != 1 || props[0].Text != "Recall mistakes recur." {
		t.Fatalf("proposals = %+v; want the multi-line one folded onto one line", props)
	}
}

func TestLearnerEntriesAreUntouchable(t *testing.T) {
	mine := Entry{ID: uuid.New(), Section: SectionPreferences, Text: "Explain with examples.", Origin: OriginLearner}
	theirs := Entry{ID: uuid.New(), Section: SectionStruggles, Text: "Recall slips.", Origin: OriginConsolidated}
	props, log := check(t, []RawOp{
		// Keyed by mistake: a learner entry can only reach Check if a store
		// ever keyed it. Refused all the same.
		{Op: "update", Entry: "E1", Text: "Prefers terse answers.", Refs: []string{"S1"}},
		{Op: "remove", Entry: "E1"},
		// A key the model was never shown.
		{Op: "remove", Entry: "E9"},
		{Op: "update", Entry: "E2", Text: "Recall mistakes recur on this point.", Refs: []string{"S1"}},
		{Op: "remove", Entry: "E2"},
	}, func(in *GuardInput) {
		in.Entries = []Keyed{{Key: "E1", Entry: mine}, {Key: "E2", Entry: theirs}}
	})
	got := reasons(log)
	want := []string{reasonLearners, reasonLearners, reasonNoEntry, reasonTwice}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("drop reasons = %v, want %v", got, want)
	}
	if len(props) != 1 || props[0].Op != OpUpdate || *props[0].ReplacesID != theirs.ID {
		t.Fatalf("proposals = %+v; want only the update of the consolidated entry", props)
	}
	// And keyEntries never keys a learner entry in the first place.
	keyed := keyEntries(&Current{Consolidated: []Entry{mine, theirs}})
	if len(keyed) != 1 || keyed[0].Entry.ID != theirs.ID {
		t.Fatalf("keyed = %+v; the learner's entry was offered to the model", keyed)
	}
}

func TestTheOperationCapHolds(t *testing.T) {
	var ops []RawOp
	for i := 0; i < 14; i++ {
		ops = append(ops, RawOp{Op: "add", Section: "struggles", Text: "Recall mistakes recur, note " + strings.Repeat("x", i+1), Refs: []string{"S1"}})
	}
	props, log := check(t, ops, nil)
	if len(props) != MaxOpsPerRun {
		t.Fatalf("%d proposals from 14 operations; the cap is %d", len(props), MaxOpsPerRun)
	}
	if got := reasons(log); len(got) != 4 || got[0] != reasonOverLimit {
		t.Fatalf("drop reasons = %v", got)
	}
}

func TestASectionNeverGrowsPastTwelve(t *testing.T) {
	props, log := check(t, []RawOp{
		{Op: "add", Section: "struggles", Text: "Recall mistakes recur.", Refs: []string{"S1"}},
		{Op: "add", Section: "struggles", Text: "Misread questions recur.", Refs: []string{"S1"}},
	}, func(in *GuardInput) { in.Accepted[SectionStruggles] = MaxPerSection - 1 })
	if len(props) != 1 || strings.Join(reasons(log), "") != reasonSectionFull {
		t.Fatalf("proposals %+v, reasons %v", props, reasons(log))
	}
}

func TestLoopGoalsAreNotRestatedAsStudying(t *testing.T) {
	props, log := check(t, []RawOp{
		{Op: "add", Section: "studying", Text: "Pass IELTS 7.0 by March", Refs: []string{"S3"}},
		{Op: "add", Section: "studying", Text: "Recent quiz activity centres on retrieval papers.", Refs: []string{"S3"}},
	}, func(in *GuardInput) { in.Goals = []string{"pass IELTS 7.0 by March"} })
	if len(props) != 1 || strings.Join(reasons(log), "") != reasonGoal {
		t.Fatalf("proposals %+v, reasons %v", props, reasons(log))
	}
}

func TestARejectedStatementIsNotProposedAgainForThirtyDays(t *testing.T) {
	sig, _ := testSignals()
	now := time.Now()
	s1 := sig.targets()["S1"].refs
	rejected := []Rejected{
		{Section: SectionStruggles, Text: "Recall mistakes recur!", DecidedAt: now.Add(-24 * time.Hour)},
		{Section: SectionStrengths, Text: "old", Refs: sig.targets()["S2"].refs, DecidedAt: now.Add(-24 * time.Hour)},
		{Section: SectionStruggles, Text: "Misreads recur.", Refs: s1, DecidedAt: now.Add(-31 * 24 * time.Hour)},
	}
	props, log := Check([]RawOp{
		// Same words (punctuation aside).
		{Op: "add", Section: "struggles", Text: "recall mistakes recur", Refs: []string{"S1"}},
		// Same evidence, reworded.
		{Op: "add", Section: "strengths", Text: "Dense retrieval has held up lately.", Refs: []string{"S2"}},
		// Rejected 31 days ago: allowed again.
		{Op: "add", Section: "struggles", Text: "Misreads recur.", Refs: []string{"S1"}},
	}, GuardInput{Signals: sig, Accepted: map[string]int{}, Texts: map[string][]string{}, Rejected: rejected, Now: now})
	if got := reasons(log); len(got) != 2 || got[0] != reasonRejected || got[1] != reasonRejected {
		t.Fatalf("drop reasons = %v", got)
	}
	if len(props) != 1 || props[0].Text != "Misreads recur." {
		t.Fatalf("proposals = %+v", props)
	}
}

func TestWhatTheProfileAlreadySaysIsNotProposedAgain(t *testing.T) {
	props, log := check(t, []RawOp{
		{Op: "add", Section: "struggles", Text: "Recall mistakes recur.", Refs: []string{"S1"}},
	}, func(in *GuardInput) { in.Texts[SectionStruggles] = []string{fold("Recall mistakes recur")} })
	if len(props) != 0 || strings.Join(reasons(log), "") != reasonDuplicate {
		t.Fatalf("proposals %+v, reasons %v", props, reasons(log))
	}
}

func TestUnknownOperationsAndSectionsAreDropped(t *testing.T) {
	_, log := check(t, []RawOp{
		{Op: "rewrite", Section: "struggles", Text: "x", Refs: []string{"S1"}},
		{Op: "add", Section: "secrets", Text: "x", Refs: []string{"S1"}},
	}, nil)
	if got := reasons(log); strings.Join(got, "|") != reasonUnknownOp+"|"+reasonNoSection {
		t.Fatalf("drop reasons = %v", got)
	}
}
