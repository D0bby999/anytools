package tools

import (
	"fmt"
	"strings"
	"unicode"
)

// Wrap puts retrieved text inside a provenance envelope.
//
//	<document source="Chapter 3.pdf p.14" id="chunk:…" trust="untrusted">
//	…text…
//	</document>
//
// This is one half of the injection defense; the other half is the system
// prompt in internal/capabilities/chat, which tells the model that anything
// inside such an envelope is quoted material to reason ABOUT and never
// instructions to follow. Neither half works alone: an envelope with no
// instruction is decoration, and an instruction with no envelope has no way to
// say where the untrusted text starts and stops.
//
// It is not a guarantee. It is a boundary the model can see, which measurably
// raises the bar, and it is why the fixture corpus in
// internal/runtime/testdata/injection exists — the fixtures are how a
// regression in this wrapping shows up as a failing test rather than as a
// quietly obedient model.
func Wrap(source, id, text string) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("<document source=%q id=%q trust=\"untrusted\">\n", sanitize(source), sanitize(id)))
	b.WriteString(neutralize(text))
	b.WriteString("\n</document>")
	return b.String()
}

// WrapAll envelopes several passages and joins them.
func WrapAll(parts []string) string { return strings.Join(parts, "\n\n") }

// sanitize keeps an attribute value from closing the tag it sits in. A document
// titled `x" trust="trusted` would otherwise rewrite its own provenance — the
// exact trick the fixture corpus calls envelope-escape.
func sanitize(s string) string {
	s = strings.ReplaceAll(s, `"`, "'")
	s = strings.ReplaceAll(s, "<", "(")
	s = strings.ReplaceAll(s, ">", ")")
	s = strings.ReplaceAll(s, "\n", " ")
	// Rune boundary, not byte: this value goes into an attribute and then into
	// a `text` column, and a half-written multi-byte rune is a sequence
	// Postgres refuses outright.
	if r := []rune(s); len(r) > 200 {
		s = string(r[:200])
	}
	return s
}

// neutralize defuses anything in untrusted text that a MODEL could read as an
// envelope tag, and removes invisible Unicode tag characters.
//
// A byte-exact regex is not enough: `</docu\u200bment>`, `＜/document＞`,
// `</dоcument>` (Cyrillic о) and `< /document>` (no-break space) are not
// `</document>` to a regex and are `</document>` to a reader. So the scan below
// reads the way a model does — format characters are invisible, look-alike
// letters from other scripts are Latin, full-width brackets are brackets, any
// space is a space — and every tag it finds that way has its brackets turned
// into parentheses. The rest of the attempt stays in place, legible, so the
// model and the transcript both show what the document tried.
//
// Ordinary text keeps its brackets: `x < 3`, `<b>` and `<documentation>` are
// not tags of THIS envelope, and study material needs them.
func neutralize(text string) string {
	runes := []rune(stripTagCharacters(text))
	var b strings.Builder
	for i := 0; i < len(runes); i++ {
		if isOpenBracket(runes[i]) {
			end, named, closed := matchDocumentTag(runes, i)
			if named && !closed {
				// `</document` with no `>` in reach — or none at all — still
				// reads as a closing tag to a model, which treats an unclosed
				// tag as closed at the line break (security audit F-3).
				// Defusing its bracket is enough: what follows stays text.
				b.WriteRune('(')
				continue
			}
			if named {
				b.WriteRune('(')
				for _, r := range runes[i+1 : end] {
					if !unicode.Is(unicode.Cf, r) {
						b.WriteRune(r)
					}
				}
				b.WriteRune(')')
				i = end
				continue
			}
		}
		b.WriteRune(runes[i])
	}
	return b.String()
}

// stripTagCharacters removes U+E0000–U+E007F: invisible to people, readable by
// models, and meaningless in study material — the "ASCII smuggling" channel.
func stripTagCharacters(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= 0xE0000 && r <= 0xE007F {
			return -1
		}
		return r
	}, s)
}

func isOpenBracket(r rune) bool  { return r == '<' || r == '＜' || r == '﹤' || r == '‹' }
func isCloseBracket(r rune) bool { return r == '>' || r == '＞' || r == '﹥' || r == '›' }
func isSlash(r rune) bool        { return r == '/' || r == '／' || r == '⁄' || r == '∕' }

// isGap is anything a reader skips between the pieces of a tag.
func isGap(r rune) bool {
	return unicode.Is(unicode.Cf, r) || unicode.IsSpace(r) || unicode.Is(unicode.Zs, r)
}

// lookAlike folds letters that render like Latin ones to the Latin letter.
var lookAlike = map[rune]rune{
	'о': 'o', 'ο': 'o', 'օ': 'o', 'ⲟ': 'o', 'ԁ': 'd', 'ⅾ': 'd',
	'с': 'c', 'ϲ': 'c', 'ⅽ': 'c', 'м': 'm', 'ⅿ': 'm', 'е': 'e', 'ε': 'e',
	'п': 'n', 'ո': 'n', 'т': 't', 'τ': 't', 'ս': 'u', 'υ': 'u', 'μ': 'u',
}

func fold(r rune) rune {
	if l, ok := lookAlike[r]; ok {
		return l
	}
	if r >= 'Ａ' && r <= 'Ｚ' {
		r = r - 'Ａ' + 'A'
	} else if r >= 'ａ' && r <= 'ｚ' {
		r = r - 'ａ' + 'a'
	}
	return unicode.ToLower(r)
}

// matchDocumentTag reports whether runes[start] opens something that reads
// as `<document` or `</document` (named), and where its closing bracket is
// when one follows within reach (closed).
func matchDocumentTag(runes []rune, start int) (end int, named, closed bool) {
	i := start + 1
	skip := func() {
		for i < len(runes) && isGap(runes[i]) {
			i++
		}
	}
	skip()
	if i < len(runes) && isSlash(runes[i]) {
		i++
		skip()
	}
	for _, want := range "document" {
		for i < len(runes) && unicode.Is(unicode.Cf, runes[i]) {
			i++
		}
		if i >= len(runes) || fold(runes[i]) != want {
			return 0, false, false
		}
		i++
	}
	for i < len(runes) && unicode.Is(unicode.Cf, runes[i]) {
		i++
	}
	// A word boundary: `<documentation>` is not this envelope's tag.
	if i < len(runes) {
		if r := fold(runes[i]); unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' {
			return 0, false, false
		}
	}
	for limit := i + 512; i < len(runes) && i < limit; i++ {
		if isCloseBracket(runes[i]) {
			return i, true, true
		}
		if isOpenBracket(runes[i]) {
			return 0, true, false
		}
	}
	return 0, true, false
}
