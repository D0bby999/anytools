package book

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
)

func testPassages(n int) []Passage {
	doc := uuid.New()
	out := make([]Passage, n)
	for i := range out {
		out[i] = Passage{ChunkID: uuid.New(), DocumentID: doc, Title: "Notes.pdf", Page: i + 1,
			Text: "Retrieval finds passages; the model writes from them."}
	}
	return out
}

func validProposal(anchors []uuid.UUID, chapters int) Proposal {
	p := Proposal{Title: "Retrieval", Audience: "Beginners"}
	for i := 0; i < chapters; i++ {
		ch := ProposedChapter{Title: "Chapter", Objectives: []string{"explain it"}, Anchors: []uuid.UUID{anchors[i%len(anchors)]}}
		if i > 0 {
			ch.Prereqs = []int{i}
		}
		p.Chapters = append(p.Chapters, ch)
	}
	return p
}

func knownOf(ids []uuid.UUID) map[uuid.UUID]bool {
	out := map[uuid.UUID]bool{}
	for _, id := range ids {
		out[id] = true
	}
	return out
}

func TestProposalRules(t *testing.T) {
	anchors := []uuid.UUID{uuid.New(), uuid.New(), uuid.New()}
	known := knownOf(anchors)
	if _, err := ValidateProposal(validProposal(anchors, 5), known, MinChapters); err != nil {
		t.Fatalf("a valid proposal was refused: %v", err)
	}

	cases := map[string]func(p *Proposal){
		"a forward prerequisite":            func(p *Proposal) { p.Chapters[1].Prereqs = []int{3} },
		"a chapter as its own prerequisite": func(p *Proposal) { p.Chapters[2].Prereqs = []int{3} },
		"an anchor outside the retrieved set": func(p *Proposal) {
			p.Chapters[0].Anchors = []uuid.UUID{uuid.New()}
		},
		"no anchor":           func(p *Proposal) { p.Chapters[0].Anchors = nil },
		"no objective":        func(p *Proposal) { p.Chapters[0].Objectives = []string{"  "} },
		"an empty title":      func(p *Proposal) { p.Title = " " },
		"too few chapters":    func(p *Proposal) { p.Chapters = p.Chapters[:3] },
		"too many chapters":   func(p *Proposal) { *p = validProposal(anchors, 13) },
		"a nameless chapter":  func(p *Proposal) { p.Chapters[4].Title = "" },
		"a runaway objective": func(p *Proposal) { p.Chapters[0].Objectives = []string{strings.Repeat("x", 301)} },
	}
	for name, mutate := range cases {
		p := validProposal(anchors, 5)
		mutate(&p)
		if _, err := ValidateProposal(p, known, MinChapters); !errors.Is(err, ErrInvalidOutput) {
			t.Errorf("%s: err = %v, want a refusal", name, err)
		}
	}

	// The learner may cut below the model's minimum; never above the maximum.
	short := validProposal(anchors, 2)
	if _, err := ValidateProposal(short, known, 1); err != nil {
		t.Errorf("a learner's two-chapter outline was refused: %v", err)
	}
}

func TestPlanRules(t *testing.T) {
	plan := func(types ...string) []PlannedBlock {
		out := make([]PlannedBlock, len(types))
		for i, ty := range types {
			out[i] = PlannedBlock{Type: ty, Title: "t", Brief: "b"}
		}
		return out
	}
	good := plan(TypeText, TypeWorkedExample, TypeQuiz, TypeCallout, TypeDiagram, TypeFlashCards, TypeSummary)
	if _, err := ValidatePlan(good); err != nil {
		t.Fatalf("a valid plan was refused: %v", err)
	}
	bad := map[string][]PlannedBlock{
		"four blocks":             plan(TypeText, TypeWorkedExample, TypeQuiz, TypeSummary),
		"eleven blocks":           plan(TypeText, TypeQuiz, TypeText, TypeQuiz, TypeText, TypeFlashCards, TypeText, TypeFlashCards, TypeText, TypeCallout, TypeSummary),
		"practice first":          plan(TypeQuiz, TypeText, TypeWorkedExample, TypeText, TypeSummary),
		"two practice in a row":   plan(TypeText, TypeQuiz, TypeFlashCards, TypeText, TypeSummary),
		"no practice":             plan(TypeText, TypeWorkedExample, TypeCallout, TypeDiagram, TypeSummary),
		"summary in the middle":   plan(TypeText, TypeSummary, TypeQuiz, TypeText, TypeWorkedExample),
		"three diagrams":          plan(TypeText, TypeDiagram, TypeDiagram, TypeQuiz, TypeDiagram),
		"the learner's note type": plan(TypeText, TypeNote, TypeQuiz, TypeText, TypeSummary),
		"an unknown type":         plan(TypeText, "animation", TypeQuiz, TypeText, TypeSummary),
	}
	for name, p := range bad {
		if _, err := ValidatePlan(p); !errors.Is(err, ErrInvalidOutput) {
			t.Errorf("%s: err = %v, want a refusal", name, err)
		}
	}
}

func TestEachBlockTypeIsHeldToItsRules(t *testing.T) {
	m := newMaterial(testPassages(4))
	cite := "[[cite:chunk:C2]]"
	valid := map[string]string{
		TypeText:          `{"markdown":"Retrieval finds passages. ` + cite + `"}`,
		TypeSummary:       `{"markdown":"- Retrieval first. ` + cite + `"}`,
		TypeCallout:       `{"variant":"definition","title":"RAG","markdown":"Retrieval-augmented generation. ` + cite + `"}`,
		TypeWorkedExample: `{"problem":"Find it.","steps":["Search. ` + cite + `","Read."],"answer":"Found."}`,
		TypeFlashCards:    `{"cards":[{"front":"a","back":"b"},{"front":"c","back":"d"},{"front":"e","back":"f"}],"source_ids":["C1"]}`,
	}
	for kind, raw := range valid {
		w, err := ValidateBlock(kind, json.RawMessage(raw), m)
		if err != nil {
			t.Errorf("%s: a valid block was refused: %v", kind, err)
			continue
		}
		if len(w.sources) == 0 {
			t.Errorf("%s: no sources kept", kind)
		}
	}

	invalid := map[string]string{
		"text with no citation":         `{"markdown":"Retrieval finds passages."}`,
		"text citing only an invention": `{"markdown":"Retrieval finds passages. [[cite:chunk:C99]]"}`,
		"empty text":                    `{"markdown":"  "}`,
		"a callout of no variant":       `{"variant":"aside","markdown":"x ` + cite + `"}`,
		"an example of one step":        `{"problem":"p","steps":["s ` + cite + `"],"answer":"a"}`,
		"two flash cards":               `{"cards":[{"front":"a","back":"b"},{"front":"c","back":"d"}],"source_ids":["C1"]}`,
		"a faceless flash card":         `{"cards":[{"front":"a","back":""},{"front":"c","back":"d"},{"front":"e","back":"f"}],"source_ids":["C1"]}`,
		"flash cards from nowhere":      `{"cards":[{"front":"a","back":"b"},{"front":"c","back":"d"},{"front":"e","back":"f"}],"source_ids":["C77"]}`,
		"a note from the model":         `{"markdown":"x ` + cite + `"}`,
	}
	kinds := map[string]string{
		"text with no citation": TypeText, "text citing only an invention": TypeText, "empty text": TypeText,
		"a callout of no variant": TypeCallout, "an example of one step": TypeWorkedExample,
		"two flash cards": TypeFlashCards, "a faceless flash card": TypeFlashCards, "flash cards from nowhere": TypeFlashCards,
		"a note from the model": TypeNote,
	}
	for name, raw := range invalid {
		if _, err := ValidateBlock(kinds[name], json.RawMessage(raw), m); !errors.Is(err, ErrInvalidOutput) {
			t.Errorf("%s: err = %v, want a refusal", name, err)
		}
	}
}

// An invented citation is dropped, never shown; a real one becomes the
// chunk's own id.
func TestAnInventedCitationIsDropped(t *testing.T) {
	passages := testPassages(3)
	m := newMaterial(passages)
	w, err := ValidateBlock(TypeText, json.RawMessage(
		`{"markdown":"Real. [[cite:chunk:C1]] Invented. [[cite:chunk:C9]] Raw uuid. [[cite:chunk:`+uuid.NewString()+`]]"}`), m)
	if err != nil {
		t.Fatal(err)
	}
	text := w.payload.(MarkdownPayload).Markdown
	if strings.Contains(text, "C9") || strings.Count(text, "[[cite:") != 1 {
		t.Fatalf("text = %q", text)
	}
	if !strings.Contains(text, citations.Format(citations.KindChunk, passages[0].ChunkID.String())) {
		t.Fatalf("the real citation was not mapped to its chunk: %q", text)
	}
	if len(w.sources) != 1 || w.sources[0].ID != passages[0].ChunkID.String() {
		t.Fatalf("sources = %+v", w.sources)
	}
}

// Flash-card faces are plain text: a marker on a card would be read out on
// review with nothing to open.
func TestFlashCardFacesCarryNoMarkers(t *testing.T) {
	m := newMaterial(testPassages(2))
	w, err := ValidateBlock(TypeFlashCards, json.RawMessage(
		`{"cards":[{"front":"What is RAG? [[cite:chunk:C1]]","back":"Retrieval plus generation."},{"front":"c","back":"d"},{"front":"e","back":"f"}],"source_ids":["C1","C1","C2"]}`), m)
	if err != nil {
		t.Fatal(err)
	}
	if w.flash[0].Front != "What is RAG?" || len(w.sources) != 2 {
		t.Fatalf("cards = %+v, sources = %d", w.flash, len(w.sources))
	}
}

func TestEstimateCalls(t *testing.T) {
	cases := []struct {
		ch   Chapter
		want int
	}{
		{Chapter{}, 1 + MaxBlocks},
		{Chapter{Blocks: 7, Ready: 3}, 4},
		{Chapter{Blocks: 7, Ready: 7}, 7},
	}
	for _, c := range cases {
		if got := EstimateCalls(c.ch); got != c.want {
			t.Errorf("EstimateCalls(%+v) = %d, want %d", c.ch, got, c.want)
		}
	}
}

func TestExportNameIsSafe(t *testing.T) {
	if got := exportName(`A/B "C"`); got != "A-B -C-.md" {
		t.Fatalf("exportName = %q", got)
	}
	if got := exportName("  "); got != "book.md" {
		t.Fatalf("exportName = %q", got)
	}
}
