// Package gforms connects Quiz and Google Forms (learning-tool-connections
// phase 5), both ways, under the drive.file scope the learner already gave:
// the Forms API accepts it for a form the learner picked in the Google
// Picker, and for a form AnyLearn created.
//
//   - Import: a picked form's gradable questions become a knowledge base's
//     question bank. A one-answer choice question with its correct answer is
//     a multiple-choice question; a short-answer question with an answer key
//     is a short question. Anything Quiz cannot mark the same way (several
//     correct answers, grids, scales, uploads, no answer key) is skipped and
//     counted.
//   - Export: a knowledge base's multiple-choice, true/false, short and cloze
//     questions become a graded Google Form in the learner's Drive.
package gforms

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
)

// BaseURL is the Forms API.
const BaseURL = "https://forms.googleapis.com/v1"

// MaxExport bounds a form's questions.
const MaxExport = 200

// Bank is the quiz service as this package uses it.
type Bank interface {
	AddQuestions(ctx context.Context, userID, kbID uuid.UUID, qs []quiz.Question) (*quiz.StarterResult, error)
	Bank(ctx context.Context, userID uuid.UUID, f quiz.Filter) ([]quiz.BankEntry, error)
}

// Service is the Forms bridge.
type Service struct {
	google  googleapi.Doer
	bank    Bank
	baseURL string
	HTTP    *http.Client
}

// NewService returns a Service.
func NewService(google googleapi.Doer, bank Bank) *Service {
	return &Service{google: google, bank: bank, baseURL: BaseURL}
}

// SetBaseURL points the client at a fake, for tests.
func (s *Service) SetBaseURL(u string) { s.baseURL = u }

func (s *Service) client(userID uuid.UUID) googleapi.Client {
	return googleapi.Client{Doer: s.google, UserID: userID, Scopes: []string{drive.ScopeDriveFile}, HTTP: s.HTTP}
}

// ImportReport says what an import did.
type ImportReport struct {
	Title   string `json:"title"`
	Added   int    `json:"added"`
	Already int    `json:"already"`
	Skipped int    `json:"skipped"`
}

// ExportReport names the new form.
type ExportReport struct {
	FormID       string `json:"form_id"`
	ResponderURI string `json:"responder_uri"`
	EditURI      string `json:"edit_uri"`
	Questions    int    `json:"questions"`
	Skipped      int    `json:"skipped"`
}

// ErrNothingToImport reports a form with no question Quiz can mark.
var ErrNothingToImport = errors.New("gforms: this form has no question with an answer key Quiz can mark")

// ErrNothingToExport reports a bank with no question a form can hold.
var ErrNothingToExport = errors.New("gforms: this knowledge base has no question a Google Form can hold")

// Import adds a picked form's gradable questions to a knowledge base.
func (s *Service) Import(ctx context.Context, userID, kbID uuid.UUID, formID string) (*ImportReport, error) {
	formID = strings.TrimSpace(formID)
	if formID == "" || strings.ContainsAny(formID, "/?#") {
		return nil, errors.New("gforms: that is not a form id")
	}
	var f Form
	if err := s.client(userID).JSON(ctx, http.MethodGet, s.baseURL+"/forms/"+url.PathEscape(formID), nil, &f); err != nil {
		return nil, err
	}
	qs, skipped := ToQuestions(f)
	if len(qs) == 0 {
		return &ImportReport{Title: f.Info.Title, Skipped: skipped}, ErrNothingToImport
	}
	res, err := s.bank.AddQuestions(ctx, userID, kbID, qs)
	if err != nil {
		return nil, err
	}
	return &ImportReport{Title: f.Info.Title, Added: res.Added, Already: res.Already, Skipped: skipped}, nil
}

// Export builds a graded form from a knowledge base's questions.
func (s *Service) Export(ctx context.Context, userID, kbID uuid.UUID, title, language string) (*ExportReport, error) {
	entries, err := s.bank.Bank(ctx, userID, quiz.Filter{KBID: &kbID, Limit: MaxExport})
	if err != nil {
		return nil, err
	}
	qs := make([]quiz.Question, 0, len(entries))
	for _, e := range entries {
		qs = append(qs, e.Question)
	}
	// The bank is newest first; a form reads in the order it was written.
	for i, j := 0, len(qs)-1; i < j; i, j = i+1, j-1 {
		qs[i], qs[j] = qs[j], qs[i]
	}
	requests, skipped := Requests(qs, language)
	if len(requests) == 0 {
		return nil, ErrNothingToExport
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "AnyLearn quiz"
	}
	c := s.client(userID)
	var created Form
	if err := c.JSON(ctx, http.MethodPost, s.baseURL+"/forms",
		map[string]any{"info": map[string]string{"title": title, "documentTitle": title}}, &created); err != nil {
		return nil, err
	}
	batch := append([]any{map[string]any{"updateSettings": map[string]any{
		"settings":   map[string]any{"quizSettings": map[string]bool{"isQuiz": true}},
		"updateMask": "quizSettings.isQuiz",
	}}}, requests...)
	if err := c.JSON(ctx, http.MethodPost, s.baseURL+"/forms/"+url.PathEscape(created.FormID)+":batchUpdate",
		map[string]any{"requests": batch}, nil); err != nil {
		return nil, fmt.Errorf("gforms: the form was created but its questions were not added: %w", err)
	}
	return &ExportReport{
		FormID:       created.FormID,
		ResponderURI: created.ResponderURI,
		EditURI:      "https://docs.google.com/forms/d/" + created.FormID + "/edit",
		Questions:    len(requests),
		Skipped:      skipped,
	}, nil
}

// ---- the Forms API's shapes, as far as this package reads them ----

// Form is forms.Form.
type Form struct {
	FormID       string `json:"formId"`
	ResponderURI string `json:"responderUri"`
	Info         struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	} `json:"info"`
	Items []Item `json:"items"`
}

// Item is forms.Item.
type Item struct {
	Title        string        `json:"title"`
	Description  string        `json:"description"`
	QuestionItem *QuestionItem `json:"questionItem,omitempty"`
}

// QuestionItem is forms.QuestionItem.
type QuestionItem struct {
	Question Question `json:"question"`
}

// Question is forms.Question.
type Question struct {
	Grading *struct {
		PointValue     int `json:"pointValue"`
		CorrectAnswers *struct {
			Answers []struct {
				Value string `json:"value"`
			} `json:"answers"`
		} `json:"correctAnswers,omitempty"`
		WhenRight *struct {
			Text string `json:"text"`
		} `json:"whenRight,omitempty"`
		GeneralFeedback *struct {
			Text string `json:"text"`
		} `json:"generalFeedback,omitempty"`
	} `json:"grading,omitempty"`
	ChoiceQuestion *struct {
		Type    string `json:"type"`
		Options []struct {
			Value   string `json:"value"`
			IsOther bool   `json:"isOther"`
		} `json:"options"`
	} `json:"choiceQuestion,omitempty"`
	TextQuestion *struct {
		Paragraph bool `json:"paragraph"`
	} `json:"textQuestion,omitempty"`
}

// ToQuestions maps a form's gradable questions; skipped counts the rest.
func ToQuestions(f Form) (qs []quiz.Question, skipped int) {
	for _, it := range f.Items {
		if it.QuestionItem == nil {
			continue
		}
		q := it.QuestionItem.Question
		prompt := strings.TrimSpace(it.Title)
		if d := strings.TrimSpace(it.Description); d != "" {
			prompt = strings.TrimSpace(prompt + "\n\n" + d)
		}
		var answers []string
		explanation := ""
		if q.Grading != nil {
			if q.Grading.CorrectAnswers != nil {
				for _, a := range q.Grading.CorrectAnswers.Answers {
					if v := strings.TrimSpace(a.Value); v != "" {
						answers = append(answers, v)
					}
				}
			}
			if q.Grading.GeneralFeedback != nil {
				explanation = q.Grading.GeneralFeedback.Text
			} else if q.Grading.WhenRight != nil {
				explanation = q.Grading.WhenRight.Text
			}
		}
		switch {
		case prompt == "" || len(answers) == 0:
			skipped++
		case q.ChoiceQuestion != nil && (q.ChoiceQuestion.Type == "RADIO" || q.ChoiceQuestion.Type == "DROP_DOWN") && len(answers) == 1:
			var opts []quiz.Option
			answer := ""
			for _, o := range q.ChoiceQuestion.Options {
				if o.IsOther || strings.TrimSpace(o.Value) == "" {
					continue
				}
				label := string(rune('A' + len(opts)))
				opts = append(opts, quiz.Option{Label: label, Body: strings.TrimSpace(o.Value)})
				if strings.TrimSpace(o.Value) == answers[0] {
					answer = label
				}
			}
			if len(opts) < 2 || len(opts) > 26 || answer == "" {
				skipped++
				continue
			}
			qs = append(qs, quiz.Question{Prompt: prompt, Type: quiz.TypeMCQ, Options: opts, Answer: answer,
				Explanation: explanation, Difficulty: quiz.DifficultyMedium})
		case q.TextQuestion != nil && !q.TextQuestion.Paragraph:
			qs = append(qs, quiz.Question{Prompt: prompt, Type: quiz.TypeShort, Answer: answers[0],
				Explanation: explanation, Difficulty: quiz.DifficultyMedium})
		default:
			skipped++
		}
	}
	return qs, skipped
}

var trueFalse = map[string][2]string{
	"en": {"True", "False"}, "vi": {"Đúng", "Sai"}, "es": {"Verdadero", "Falso"}, "pt": {"Verdadeiro", "Falso"},
}

// Requests maps questions to batchUpdate createItem requests; skipped counts
// the types a form cannot mark (written, code).
func Requests(qs []quiz.Question, language string) (requests []any, skipped int) {
	tf, ok := trueFalse[language]
	if !ok {
		tf = trueFalse["en"]
	}
	for _, q := range qs {
		var question map[string]any
		grading := func(answer string) map[string]any {
			g := map[string]any{"pointValue": 1, "correctAnswers": map[string]any{"answers": []map[string]string{{"value": answer}}}}
			if strings.TrimSpace(q.Explanation) != "" {
				g["generalFeedback"] = map[string]string{"text": q.Explanation}
			}
			return g
		}
		choice := func(options []string, answer string) map[string]any {
			opts := make([]map[string]string, 0, len(options))
			for _, o := range options {
				opts = append(opts, map[string]string{"value": o})
			}
			return map[string]any{"required": true, "grading": grading(answer),
				"choiceQuestion": map[string]any{"type": "RADIO", "options": opts}}
		}
		switch q.Type {
		case quiz.TypeMCQ:
			var bodies []string
			answer := ""
			seen := map[string]bool{}
			for _, o := range q.Options {
				if seen[o.Body] || strings.TrimSpace(o.Body) == "" {
					continue // Forms refuses duplicate options
				}
				seen[o.Body] = true
				bodies = append(bodies, o.Body)
				if strings.EqualFold(o.Label, q.Answer) {
					answer = o.Body
				}
			}
			if answer == "" || len(bodies) < 2 {
				skipped++
				continue
			}
			question = choice(bodies, answer)
		case quiz.TypeTF:
			answer := tf[1]
			if q.Answer == "true" {
				answer = tf[0]
			}
			question = choice([]string{tf[0], tf[1]}, answer)
		case quiz.TypeShort, quiz.TypeCloze:
			if strings.TrimSpace(q.Answer) == "" {
				skipped++
				continue
			}
			question = map[string]any{"required": true, "grading": grading(q.Answer),
				"textQuestion": map[string]bool{"paragraph": false}}
		default:
			skipped++
			continue
		}
		requests = append(requests, map[string]any{"createItem": map[string]any{
			"item":     map[string]any{"title": formTitle(q.Prompt), "questionItem": map[string]any{"question": question}},
			"location": map[string]int{"index": len(requests)},
		}})
	}
	return requests, skipped
}

// formTitle is a prompt as a form item's title: one line, which is all a
// title holds.
func formTitle(prompt string) string {
	return strings.Join(strings.Fields(prompt), " ")
}
