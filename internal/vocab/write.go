package vocab

import (
	"strings"
	"unicode"
)

// KindWrite is the writing card (plans/261020-1535-beyond-english-learning-
// areas, phase 3): the learner draws a Chinese or Japanese word stroke by
// stroke from its meaning and reading, each stroke checked in the browser as
// it is drawn (hanzi-writer). Like listening it is not in CardKinds(); only
// "Practise writing it" creates it. Its rating is the learner's, suggested
// from the mistakes they made.
const KindWrite = "write"

// Writable reports whether a word can be drawn: a Chinese or Japanese word
// with at least one Han character or kana. Stroke data exists for those
// (Chinese from hanzi-writer-data, Japanese kanji and kana from animCJK); a
// Latin letter or a digit inside the term is shown, not drawn.
func Writable(term, lang string) bool {
	switch strings.SplitN(lang, "-", 2)[0] {
	case "zh", "ja":
	default:
		return false
	}
	for _, r := range term {
		if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana) {
			return true
		}
	}
	return false
}
