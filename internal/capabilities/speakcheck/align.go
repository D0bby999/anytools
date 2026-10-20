package speakcheck

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// align.go compares what the learner meant to read with what a speech engine
// heard, word by word, without a model: both sides become word keys (case,
// punctuation, hyphens and apostrophes dropped) and are aligned by edit
// distance. Two words may stand for one ("do not" for "don't", "pre trained"
// for "pre-trained"), so those count as heard.

// The states a target word can end in.
const (
	StateOK      = "ok"
	StateMissed  = "missed"
	StateHeardAs = "heard_as"
)

// Word is one word of the text as it was written, and what became of it.
type Word struct {
	Text  string `json:"text"`
	State string `json:"state"`
	// Heard is what the engine heard instead, set on heard_as.
	Heard string `json:"heard,omitempty"`
	// Added is what the engine heard after this word that is not in the
	// text, if anything.
	Added string `json:"added,omitempty"`
}

// Alignment is the whole comparison.
type Alignment struct {
	Words []Word `json:"words"`
	// Before is what was heard before the first word that is not in the text.
	Before string `json:"before,omitempty"`
	// OK counts the words heard as written.
	OK int `json:"ok"`
}

type token struct {
	text string // as written
	key  string
}

// tokens splits s into words with their keys. A word with no letters or
// digits ("—", "…") is dropped. Han, kana and Thai are written without
// spaces, so each of their characters is a word of its own.
func tokens(s string) []token {
	var out []token
	for _, f := range strings.Fields(norm.NFC.String(s)) {
		if strings.IndexFunc(f, unspaced) >= 0 {
			for _, r := range f {
				if k := key(string(r)); k != "" {
					out = append(out, token{text: string(r), key: k})
				}
			}
			continue
		}
		if k := key(f); k != "" {
			out = append(out, token{text: f, key: k})
		}
	}
	return out
}

func unspaced(r rune) bool {
	return unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Thai)
}

// key is a word as it is compared: lower case, letters, marks and digits only.
func key(w string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(w) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// spelled lists the contractions whose spelled-out pairs no suffix rule
// gives: 's, whose base must be a word that takes "is", and 'd, which is
// "would" or "had".
var spelled = map[string][][2]string{
	"cant": {{"can", "not"}}, "cannot": {{"can", "not"}}, "wont": {{"will", "not"}},
	"im": {{"i", "am"}}, "lets": {{"let", "us"}},
	"its": {{"it", "is"}}, "thats": {{"that", "is"}}, "theres": {{"there", "is"}}, "whats": {{"what", "is"}},
	"hes": {{"he", "is"}}, "shes": {{"she", "is"}}, "heres": {{"here", "is"}}, "whos": {{"who", "is"}},
	"wheres": {{"where", "is"}}, "hows": {{"how", "is"}},
	"id": {{"i", "would"}, {"i", "had"}}, "youd": {{"you", "would"}, {"you", "had"}},
	"hed": {{"he", "would"}, {"he", "had"}}, "shed": {{"she", "would"}, {"she", "had"}},
	"wed": {{"we", "would"}, {"we", "had"}}, "theyd": {{"they", "would"}, {"they", "had"}},
}

// pairs reports whether one key is the other two said apart: a contraction
// spelled out, or a compound or hyphenated word heard as two.
func pairs(one, a, b string) bool {
	if one == a+b {
		return true
	}
	for _, p := range spelled[one] {
		if p[0] == a && p[1] == b {
			return true
		}
	}
	for _, s := range []struct{ suffix, word string }{
		{"nt", "not"}, {"re", "are"}, {"ll", "will"}, {"ve", "have"},
	} {
		if base, ok := strings.CutSuffix(one, s.suffix); ok && base == a && b == s.word {
			return true
		}
	}
	return false
}

// Align compares the text with what was heard.
func Align(text, heard string) Alignment {
	t, h := tokens(text), tokens(heard)
	n, m := len(t), len(h)
	// cost[i][j] is the cheapest alignment of t[i:] with h[j:].
	cost := make([][]int, n+1)
	for i := range cost {
		cost[i] = make([]int, m+1)
	}
	for i := n; i >= 0; i-- {
		for j := m; j >= 0; j-- {
			switch {
			case i == n:
				cost[i][j] = m - j
			case j == m:
				cost[i][j] = n - i
			default:
				best := cost[i+1][j] + 1 // missed
				best = min(best, cost[i][j+1]+1)
				if t[i].key == h[j].key {
					best = min(best, cost[i+1][j+1])
				} else {
					best = min(best, cost[i+1][j+1]+1)
				}
				if j+1 < m && pairs(t[i].key, h[j].key, h[j+1].key) {
					best = min(best, cost[i+1][j+2])
				}
				if i+1 < n && pairs(h[j].key, t[i].key, t[i+1].key) {
					best = min(best, cost[i+2][j+1])
				}
				cost[i][j] = best
			}
		}
	}

	out := Alignment{Words: make([]Word, 0, n)}
	added := func(s string) {
		if len(out.Words) == 0 {
			out.Before = join(out.Before, s)
			return
		}
		w := &out.Words[len(out.Words)-1]
		w.Added = join(w.Added, s)
	}
	ok := func(texts ...string) {
		for _, s := range texts {
			out.Words = append(out.Words, Word{Text: s, State: StateOK})
			out.OK++
		}
	}
	i, j := 0, 0
	for i < n || j < m {
		c := cost[i][j]
		switch {
		case i < n && j < m && t[i].key == h[j].key && c == cost[i+1][j+1]:
			ok(t[i].text)
			i, j = i+1, j+1
		case i < n && j+1 < m && pairs(t[i].key, h[j].key, h[j+1].key) && c == cost[i+1][j+2]:
			ok(t[i].text)
			i, j = i+1, j+2
		case i+1 < n && j < m && pairs(h[j].key, t[i].key, t[i+1].key) && c == cost[i+2][j+1]:
			ok(t[i].text, t[i+1].text)
			i, j = i+2, j+1
		case i < n && j < m && c == cost[i+1][j+1]+1:
			out.Words = append(out.Words, Word{Text: t[i].text, State: StateHeardAs, Heard: h[j].text})
			i, j = i+1, j+1
		case i < n && (j == m || c == cost[i+1][j]+1):
			out.Words = append(out.Words, Word{Text: t[i].text, State: StateMissed})
			i++
		default:
			added(h[j].text)
			j++
		}
	}
	return out
}

func join(a, b string) string {
	if a == "" {
		return b
	}
	return a + " " + b
}
