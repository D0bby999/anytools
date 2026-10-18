package vocab

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// match.go decides whether a selection is really on a page and whether a term
// is really in the selection (DeepTutor's rule, findings §8: a saved term must
// literally occur in the server-verified selection).
//
// The two sides are written by different machines. The selection comes from
// pdf.js's text layer, whitespace folded (ui/web/app/lib/reading-selection.ts);
// the page text is usually a model's Markdown rendering of the same page, with
// emphasis, headings, table pipes and links, and hyphenation already joined.
// Comparing them raw refuses real selections (red team AS-7), so both are
// normalised the same way first and the selection is matched by token overlap
// rather than as an exact substring.

// MinOverlap is the share of the selection's tokens that must occur, in a
// window of the same length, on the page. One OCR difference in a sentence of
// ten words still passes; a sentence from another page does not.
const MinOverlap = 0.85

var (
	htmlComment = regexp.MustCompile(`(?s)<!--.*?-->`)
	htmlTag     = regexp.MustCompile(`</?[A-Za-z][^>]*>`)
	image       = regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`)
	link        = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	lineMarkup  = regexp.MustCompile(`(?m)^[ \t]*(#{1,6}[ \t]+|>[ \t]?|[*+-][ \t]+|\d+[.)][ \t]+)`)
	ruleLine    = regexp.MustCompile(`(?m)^[ \t|:-]*-{3,}[ \t|:-]*$`)
	emphasis    = regexp.MustCompile(`\*{1,3}|_{2,3}|~~|` + "`+")
	// A single underscore is emphasis only at a word edge; snake_case stays.
	underscore = regexp.MustCompile(`(^|[^\p{L}\p{N}])_+|_+([^\p{L}\p{N}]|$)`)
	escape     = regexp.MustCompile(`\\([\\*_#|\[\]()` + "`" + `>~-])`)
)

// escapable are the characters a Markdown backslash escapes, in the order
// their private-use stand-ins (escapeBase + index) are numbered.
const (
	escapable  = "\\*_#|[]()`>~-"
	escapeBase = 0xE000
)

var (
	// "Transform-\ners" in a text layer, "Transform- ers" once pdf.js's line
	// break is folded to a space. Joined only across whitespace (a compound
	// like "knowledge-intensive" keeps its hyphen) and only before a
	// lowercase letter ("Wen- Tau" is a name split by the layout).
	hyphenBreak = regexp.MustCompile(`(\p{L})-(?:[ \t]*\n[ \t]*|[ \t]+)(\p{Ll})`)
	space       = regexp.MustCompile(`\s+`)
)

// Normalize is the text both sides are compared as: Unicode NFKC (NFC plus the
// compatibility folds a PDF text layer needs — the "ﬁ" ligature becomes "fi"),
// Markdown markup stripped, line-break hyphenation joined and whitespace
// folded. Case is kept; callers that compare fold it themselves.
func Normalize(s string) string {
	s = norm.NFKC.String(s)
	s = htmlComment.ReplaceAllString(s, " ")
	s = htmlTag.ReplaceAllString(s, "")
	s = image.ReplaceAllString(s, "$1")
	s = link.ReplaceAllString(s, "$1")
	s = ruleLine.ReplaceAllString(s, " ")
	s = lineMarkup.ReplaceAllString(s, "")
	// An escaped character is literal text: park it on a private-use rune
	// while the markup is stripped, then put it back.
	s = escape.ReplaceAllStringFunc(s, func(m string) string {
		return string(rune(escapeBase + strings.IndexByte(escapable, m[1])))
	})
	s = emphasis.ReplaceAllString(s, "")
	s = underscore.ReplaceAllString(s, "$1$2")
	s = strings.ReplaceAll(s, "|", " ")
	s = strings.Map(func(r rune) rune {
		if r >= escapeBase && r < escapeBase+rune(len(escapable)) {
			return rune(escapable[r-escapeBase])
		}
		return r
	}, s)
	s = hyphenBreak.ReplaceAllString(s, "$1$2")
	return strings.TrimSpace(space.ReplaceAllString(s, " "))
}

// tokens splits normalised text into lowercase words: runs of letters, digits
// and combining marks. Punctuation is not a token, so a comma the parser moved
// costs nothing.
func tokens(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && !unicode.Is(unicode.Mn, r)
	})
}

// SelectionOnPage reports whether the selection occurs on the page: at least
// MinOverlap of its tokens occur in some window of the page's tokens of the
// same length. A text layer that lost its spaces (the local PDF extractor
// glues words: "Retrieval-AugmentedGeneration") has no usable tokens, so a
// selection also passes when its letters and digits alone are a substring of
// the page's.
func SelectionOnPage(selection, page string) bool {
	sel, pg := tokens(Normalize(selection)), tokens(Normalize(page))
	if len(sel) == 0 || len(pg) == 0 {
		return false
	}
	if bestOverlap(sel, pg) >= MinOverlap {
		return true
	}
	return strings.Contains(strings.Join(pg, ""), strings.Join(sel, ""))
}

// bestOverlap slides a window of len(sel) over pg and returns the best share
// of sel's tokens (as a multiset) present in one window. Linear in the page.
func bestOverlap(sel, pg []string) float64 {
	n := len(sel)
	need := make(map[string]int, n)
	for _, t := range sel {
		need[t]++
	}
	window := make(map[string]int, n)
	matched, best := 0, 0
	for i, t := range pg {
		window[t]++
		if window[t] <= need[t] {
			matched++
		}
		if i >= n {
			out := pg[i-n]
			if window[out] <= need[out] {
				matched--
			}
			window[out]--
		}
		if matched > best {
			best = matched
		}
	}
	return float64(best) / float64(n)
}

// spaced reports whether a term is written in a script that separates words
// with spaces (Latin, which includes Vietnamese; Greek; Cyrillic). Those are
// matched on word boundaries; anything else (Han, kana, Thai) as a substring.
func spaced(term string) bool {
	for _, r := range term {
		if unicode.IsLetter(r) && !unicode.In(r, unicode.Latin, unicode.Greek, unicode.Cyrillic) {
			return false
		}
	}
	return true
}

// termIndex returns the byte offset of the first occurrence of term in text,
// case-insensitively and on word boundaries for spaced scripts, or -1. Both
// are normalised by the caller.
func termIndex(text, term string) int {
	lt, lterm := strings.ToLower(text), strings.ToLower(term)
	if lterm == "" || len(lt) != len(text) {
		// ToLower changed a byte length (a rare rune); fall back to a slower
		// rune-safe scan below.
		return termIndexRunes(text, term)
	}
	boundary := spaced(term)
	for from := 0; from <= len(lt); {
		i := strings.Index(lt[from:], lterm)
		if i < 0 {
			return -1
		}
		i += from
		if !boundary || (edge(lt, i, true) && edge(lt, i+len(lterm), false)) {
			return i
		}
		from = i + 1
	}
	return -1
}

func termIndexRunes(text, term string) int {
	tr, sr := []rune(strings.ToLower(term)), []rune(text)
	boundary := spaced(term)
	for i := 0; i+len(tr) <= len(sr); i++ {
		if strings.ToLower(string(sr[i:i+len(tr)])) != string(tr) {
			continue
		}
		before := i == 0 || !wordRune(sr[i-1])
		after := i+len(tr) == len(sr) || !wordRune(sr[i+len(tr)])
		if !boundary || (before && after) {
			return len(string(sr[:i]))
		}
	}
	return -1
}

// edge reports whether byte offset i in s is a word edge: the rune before it
// (start) or at it (end) is not a letter, digit or mark.
func edge(s string, i int, start bool) bool {
	if start {
		if i == 0 {
			return true
		}
		r := lastRune(s[:i])
		return !wordRune(r)
	}
	if i >= len(s) {
		return true
	}
	return !wordRune([]rune(s[i:])[0])
}

func lastRune(s string) rune {
	r := []rune(s)
	return r[len(r)-1]
}

func wordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.Is(unicode.Mn, r)
}

// TermInSelection reports whether term occurs in the selection, both
// normalised: on word boundaries for spaced scripts, as a substring otherwise.
func TermInSelection(term, selection string) bool {
	term = Normalize(term)
	return term != "" && termIndex(Normalize(selection), term) >= 0
}

// sentenceEnd matches the end of a sentence: terminal punctuation followed by
// whitespace, or the CJK full stops, which take no space after them.
var sentenceEnd = regexp.MustCompile(`[.!?…]["'”’)\]]*\s+|[。！？]`)

// MaxContextLen caps a stored context sentence, in runes. A "sentence" in a
// table or a reference list can run for a page.
const MaxContextLen = 400

// ContextSentence is the sentence of the selection the term first occurs in,
// normalised, cut to MaxContextLen around the term. Empty when the term is not
// in the selection.
func ContextSentence(term, selection string) string {
	text, term := Normalize(selection), Normalize(term)
	at := termIndex(text, term)
	if at < 0 {
		return ""
	}
	start, end := 0, len(text)
	for _, m := range sentenceEnd.FindAllStringIndex(text, -1) {
		switch {
		case m[1] <= at:
			start = m[1]
		case m[0] >= at+len(term):
			if end == len(text) {
				end = m[1]
			}
		}
	}
	sentence := strings.TrimSpace(text[start:end])
	return clip(sentence, strings.Index(strings.ToLower(sentence), strings.ToLower(term)), len(term))
}

// clip cuts s to MaxContextLen runes, keeping the term (at byte offset at,
// len bytes) inside the cut and marking removed ends with an ellipsis.
func clip(s string, at, n int) string {
	r := []rune(s)
	if len(r) <= MaxContextLen {
		return s
	}
	if at < 0 {
		at = 0
	}
	mid := len([]rune(s[:at])) + len([]rune(s[at:at+n]))/2
	lo := max(0, mid-MaxContextLen/2)
	hi := min(len(r), lo+MaxContextLen)
	lo = max(0, hi-MaxContextLen)
	out := strings.TrimSpace(string(r[lo:hi]))
	if lo > 0 {
		out = "…" + out
	}
	if hi < len(r) {
		out += "…"
	}
	return out
}

// Blank is what a cloze card shows in place of the term.
const Blank = "_____"

// Cloze is the context sentence with every occurrence of the term blanked.
// A sentence that no longer contains the term (edited by hand) is shown with
// the blank appended rather than giving the answer away.
func Cloze(term, sentence string) string {
	term = Normalize(term)
	out, hit := sentence, false
	for {
		i := termIndex(out, term)
		if i < 0 {
			break
		}
		hit = true
		// The occurrence's byte length in `out` equals the term's for every
		// script this matcher lowercases in place.
		out = out[:i] + Blank + out[i+len(term):]
	}
	if !hit {
		return strings.TrimSpace(sentence + " " + Blank)
	}
	return out
}

// Fold is the accent- and case-insensitive form a cloze answer is compared
// in: NFD with the combining marks removed, đ/Đ as d (Vietnamese's one letter
// that is not a base plus a mark), lowercased, whitespace folded.
func Fold(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		switch {
		case unicode.Is(unicode.Mn, r):
			continue
		case r == 'đ' || r == 'Đ':
			r = 'd'
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return strings.TrimSpace(space.ReplaceAllString(b.String(), " "))
}

// ClozeMatches reports whether a typed answer is the term, exactly or with
// accents and case ignored.
func ClozeMatches(answer, term string) bool {
	a := strings.TrimSpace(answer)
	return a != "" && (a == term || Fold(a) == Fold(term))
}

// DetectLang guesses a note's language from the page it was saved on, by
// script. Vietnamese is told from other Latin text by the letters only it
// uses. It is a default: the learner can change it before and after saving.
func DetectLang(text string) string {
	var latin, vi, han, kana, hangul, cyr, greek, thai int
	for _, r := range norm.NFC.String(text) {
		switch {
		case strings.ContainsRune("ăâđêôơưĂÂĐÊÔƠƯạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ", unicode.ToLower(r)):
			vi++
			latin++
		case unicode.In(r, unicode.Hiragana, unicode.Katakana):
			kana++
		case unicode.Is(unicode.Han, r):
			han++
		case unicode.Is(unicode.Hangul, r):
			hangul++
		case unicode.Is(unicode.Cyrillic, r):
			cyr++
		case unicode.Is(unicode.Greek, r):
			greek++
		case unicode.Is(unicode.Thai, r):
			thai++
		case unicode.Is(unicode.Latin, r):
			latin++
		}
	}
	switch {
	case kana > 0 && kana+han > latin:
		return "ja"
	case han > latin:
		return "zh"
	case hangul > latin:
		return "ko"
	case cyr > latin:
		return "ru"
	case greek > latin:
		return "el"
	case thai > latin:
		return "th"
	case latin > 0 && vi*20 >= latin:
		// Five Vietnamese letters in a hundred: an English page quoting one
		// Vietnamese name stays English.
		return "vi"
	}
	return "en"
}
