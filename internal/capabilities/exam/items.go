package exam

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
)

// items.go is what a template question is, and what makes one usable. The
// same rules run on the extractor's output and on every review edit, so a
// learner's correction cannot store a shape the extractor would have been
// refused.

// Item is one question of a template.
type Item struct {
	Number       string        `json:"number"`
	Type         string        `json:"type"`
	Topic        string        `json:"topic,omitempty"`
	StemMD       string        `json:"stem_md"`
	Options      []Option      `json:"options"`
	AnswerKey    string        `json:"answer_key,omitempty"`
	Points       float64       `json:"points"`
	Difficulty   string        `json:"difficulty"`
	SourcePage   int           `json:"source_page"`
	FigurePage   *int          `json:"figure_page,omitempty"`
	SubQuestions []SubQuestion `json:"sub_questions,omitempty"`
	// Issues are computed by ValidateItems. A template with any cannot be
	// marked ready.
	Issues []string `json:"issues,omitempty"`
}

// Option is one choice of a multiple-choice item.
type Option struct {
	Label  string `json:"label"`
	TextMD string `json:"text_md"`
}

// SubQuestion is a part (a), (b)… of a question.
type SubQuestion struct {
	Label  string  `json:"label"`
	StemMD string  `json:"stem_md"`
	Points float64 `json:"points,omitempty"`
}

// Field limits.
const (
	maxStem     = 8000
	maxOption   = 1000
	maxOptions  = 8
	maxSubParts = 12
	maxPoints   = 100
)

// normalizeType maps whatever the paper calls a question onto AnyTools'
// types. Anything unrecognised is `written`: marked by rubric, it can hold
// any question a person could answer in prose.
func normalizeType(t string) string {
	switch strings.ToLower(strings.TrimSpace(strings.ReplaceAll(t, "-", "_"))) {
	case "mcq", "choice", "multiple_choice", "single_choice":
		return quiz.TypeMCQ
	case "tf", "true_false", "truefalse", "concept":
		return quiz.TypeTF
	case "cloze", "fill_blank", "fill_in_blank", "fill_in_the_blank", "blank":
		return quiz.TypeCloze
	case "short", "short_answer":
		return quiz.TypeShort
	}
	return quiz.TypeWritten
}

// blanks are runs of three or more underscores or dots: how printed papers
// leave a gap. Each becomes the bank's one blank token.
var blanks = regexp.MustCompile(`_{3,}|\.{4,}|…{2,}`)

// leadingNumber is the question number's integer part: "12", "12.", "Câu 12",
// "Question 12(a)" all read as 12.
var leadingNumber = regexp.MustCompile(`\d+`)

// ValidateItems normalises items and records what is wrong with each. It
// returns the items (issues filled) and paper-level warnings.
//
// Nothing is dropped here: the review screen is where a person decides. A
// question with an issue is shown with it, and the template cannot be marked
// ready until it is fixed or deleted.
func ValidateItems(in []Item, pageCount int) ([]Item, []string) {
	out := make([]Item, 0, len(in))
	for _, it := range in {
		out = append(out, validateItem(it, pageCount))
	}
	return out, numberingWarnings(out)
}

func validateItem(it Item, pageCount int) Item {
	it.Number = trimRunes(it.Number, 20)
	it.Type = normalizeType(it.Type)
	it.Topic = trimRunes(it.Topic, 240)
	it.StemMD = strings.TrimSpace(it.StemMD)
	it.AnswerKey = trimRunes(it.AnswerKey, 4000)
	it.Difficulty = quiz.NormalizeDifficulty(it.Difficulty)
	it.Issues = nil
	issue := func(format string, args ...any) { it.Issues = append(it.Issues, fmt.Sprintf(format, args...)) }

	if it.Number == "" {
		issue("it has no question number")
	}
	switch {
	case it.StemMD == "":
		issue("the question text is empty")
	case utf8.RuneCountInString(it.StemMD) > maxStem:
		it.StemMD = trimRunes(it.StemMD, maxStem)
		issue("the question text was longer than %d characters and was cut", maxStem)
	}
	if math.IsNaN(it.Points) || it.Points <= 0 {
		it.Points = 1
	}
	if it.Points > maxPoints {
		it.Points = maxPoints
		issue("points were capped at %d", maxPoints)
	}
	it.Points = math.Round(it.Points*100) / 100

	it.Options = normalizeOptions(it.Options)
	switch it.Type {
	case quiz.TypeMCQ:
		if len(it.Options) < 2 {
			issue("a multiple-choice question needs at least two options")
		}
		if len(it.Options) > maxOptions {
			it.Options = it.Options[:maxOptions]
			issue("only the first %d options were kept", maxOptions)
		}
	case quiz.TypeCloze:
		it.Options = nil
		it.StemMD = blanks.ReplaceAllString(it.StemMD, "____")
		if n := strings.Count(it.StemMD, "____"); n != 1 {
			issue("a fill-in-the-blank question needs exactly one blank (____), this has %d", n)
		}
	default:
		it.Options = nil
	}

	if it.SourcePage < 1 || it.SourcePage > pageCount {
		issue("page %d is not in this %d-page paper", it.SourcePage, pageCount)
	}
	if it.FigurePage != nil && (*it.FigurePage < 1 || *it.FigurePage > pageCount) {
		issue("its figure is on page %d, which is not in this paper", *it.FigurePage)
		it.FigurePage = nil
	}

	if len(it.SubQuestions) > maxSubParts {
		it.SubQuestions = it.SubQuestions[:maxSubParts]
		issue("only the first %d parts were kept", maxSubParts)
	}
	parts := it.SubQuestions[:0]
	for _, sq := range it.SubQuestions {
		sq.Label = trimRunes(sq.Label, 20)
		sq.StemMD = trimRunes(sq.StemMD, maxStem)
		if sq.StemMD == "" {
			continue
		}
		if math.IsNaN(sq.Points) || sq.Points < 0 {
			sq.Points = 0
		}
		parts = append(parts, sq)
	}
	it.SubQuestions = parts
	if len(it.SubQuestions) == 0 {
		it.SubQuestions = nil
	}
	return it
}

// normalizeOptions trims each option and relabels A, B, C… in order, as the
// bank does.
func normalizeOptions(in []Option) []Option {
	opts := make([]quiz.Option, 0, len(in))
	for _, o := range in {
		opts = append(opts, quiz.Option{Label: o.Label, Body: trimRunes(o.TextMD, maxOption)})
	}
	norm := quiz.NormalizeOptions(opts)
	out := make([]Option, 0, len(norm))
	for _, o := range norm {
		out = append(out, Option{Label: o.Label, TextMD: o.Body})
	}
	return out
}

// numberingWarnings says where the question numbers skip or repeat. A gap is
// most often a question the extraction missed, so it is worth a look — but a
// paper may skip numbers on purpose, so it does not block the template.
func numberingWarnings(items []Item) []string {
	var warnings []string
	prev := 0
	seen := map[int]bool{}
	for _, it := range items {
		m := leadingNumber.FindString(it.Number)
		if m == "" {
			continue
		}
		n, err := strconv.Atoi(m)
		if err != nil {
			continue
		}
		switch {
		case seen[n]:
			// "3(a)" and "3(b)" share a number; that is not a repeat.
			if strings.TrimSpace(it.Number) == m {
				warnings = append(warnings, fmt.Sprintf("question %d appears more than once", n))
			}
		case prev > 0 && n > prev+1:
			if n == prev+2 {
				warnings = append(warnings, fmt.Sprintf("question %d is missing (between %d and %d)", prev+1, prev, n))
			} else {
				warnings = append(warnings, fmt.Sprintf("questions %d to %d are missing (between %d and %d)", prev+1, n-1, prev, n))
			}
		case prev > 0 && n < prev:
			warnings = append(warnings, fmt.Sprintf("question %d comes after question %d", n, prev))
		}
		seen[n] = true
		if n > prev {
			prev = n
		}
	}
	return warnings
}

// TotalPoints is the template's total.
func TotalPoints(items []Item) float64 {
	total := 0.0
	for _, it := range items {
		total += it.Points
	}
	return math.Round(total*100) / 100
}

func countIssues(items []Item) int {
	n := 0
	for _, it := range items {
		if len(it.Issues) > 0 {
			n++
		}
	}
	return n
}

// trimRunes trims s and cuts it to at most n characters.
func trimRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n]))
}

func errorf(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrBadRequest}, args...)...)
}
