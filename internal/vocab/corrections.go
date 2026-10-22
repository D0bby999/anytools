package vocab

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// corrections.go saves a mistake corrected in chat as a word to learn
// (the private design notes, phase 3). Its term is the corrected
// words, its meaning why they are right, its retrieval cue what the learner
// wrote, and its context the corrected sentence when it holds the words. It
// has no document page behind it, so it is not Save: there is no selection
// to check, and the learner ticked it from a list the server already
// filtered against their own message (chat.FilterCorrections).

// OriginChat marks a note saved from a chat answer's corrections.
const OriginChat = "chat"

// MaxCorrectionWrongLen leaves room for "You wrote: " in a production card's
// scenario (MaxScenarioLen).
const MaxCorrectionWrongLen = 280

// MaxCorrectionsPerSave is the most corrections one request saves.
const MaxCorrectionsPerSave = 10

// CorrectionInput is one ticked correction.
type CorrectionInput struct {
	Wrong    string `json:"wrong"`
	Right    string `json:"right"`
	Why      string `json:"why"`
	Sentence string `json:"sentence"`
	// Production adds the production card: "You wrote: …" → the right words.
	Production bool `json:"production"`
}

// SaveCorrection saves one correction for userID in lang. link is where it
// came from ("/chat/<session id>"), kept as the context's link. The bool is
// true when a new note was created; a correction already saved gains the
// sentence, as Save does.
func (s *Service) SaveCorrection(ctx context.Context, userID uuid.UUID, lang, link string, in CorrectionInput) (*Note, bool, error) {
	right := strings.TrimSpace(Normalize(in.Right))
	wrong := strings.TrimSpace(strings.ReplaceAll(in.Wrong, "\x00", ""))
	why := strings.TrimSpace(in.Why)
	sentence := strings.TrimSpace(Normalize(in.Sentence))
	lang = strings.TrimSpace(lang)
	if lang == "" {
		lang = DetectLang(right + " " + sentence)
	}
	switch {
	case right == "":
		return nil, false, fmt.Errorf("%w: a correction needs the right words", ErrInvalid)
	case utf8.RuneCountInString(right) > MaxTermLen:
		return nil, false, fmt.Errorf("%w: that is too long to be one term", ErrInvalid)
	case utf8.RuneCountInString(wrong) > MaxCorrectionWrongLen:
		return nil, false, fmt.Errorf("%w: what you wrote is over %d characters", ErrInvalid, MaxCorrectionWrongLen)
	case utf8.RuneCountInString(why) > MaxMeaningLen:
		return nil, false, fmt.Errorf("%w: that meaning is too long", ErrInvalid)
	case !ValidLang(lang):
		return nil, false, fmt.Errorf("%w: %q is not a language code", ErrInvalid, lang)
	case link != "" && !strings.HasPrefix(link, "/chat/"):
		return nil, false, fmt.Errorf("%w: a correction links back to its conversation", ErrInvalid)
	}
	meaning := why
	if meaning == "" {
		meaning = right
	}
	record := map[string]string{}
	if wrong != "" {
		record["cue"] = wrong
	}
	// A cloze card needs a sentence that holds the words; without one the
	// note gets its recognition card only.
	kinds := CardKinds()
	if utf8.RuneCountInString(sentence) > MaxContextLen || !TermInSelection(right, sentence) {
		sentence, kinds = "", []string{KindRecognition}
	}

	now := s.now().UTC()
	note, created, err := s.store.SaveNote(ctx, NoteWrite{
		UserID:   userID,
		Term:     right,
		Lang:     lang,
		Meaning:  meaning,
		Context:  Context{Sentence: sentence, AddedAt: now, Credit: "Chat", URL: link},
		Decision: DecisionLearn,
		Record:   record,
		Origin:   OriginChat,
		Kinds:    kinds,
		NewCard:  s.scheduler.NewCard(now),
		Now:      now,
	})
	if err != nil || !created || !in.Production || wrong == "" {
		return note, created, err
	}
	note, err = s.Practise(ctx, userID, note.ID, "You wrote: "+wrong, "")
	return note, created, err
}
