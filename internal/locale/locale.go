// Package locale words the API's sentences in the learner's language.
//
// The Go code writes every sentence a learner can read in English, where it is
// composed; the catalog (catalog/<lang>.json) maps each one, by its format
// string, to vi, es and pt. Translate is applied at the edge (httpx.Localize),
// so no handler or service has to know which language it is answering in, and
// a sentence the catalog lacks reaches the learner in English rather than not
// at all. catalog_test.go fails on an English sentence with no translation.
package locale

import (
	"embed"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Languages are the interface languages, English first: the one every
// sentence is written in.
var Languages = []string{"en", "vi", "es", "pt"}

//go:embed catalog/*.json
var files embed.FS

// verb is one fmt verb in a format string. %% is a literal and not a verb.
var verb = regexp.MustCompile(`%(\[(\d+)\])?[-+# 0]*(\d+|\*)?(\.\d+)?[vTtbcdoOqxXUeEfFgGsp]`)

// pattern is one catalog entry with verbs: the English as a regexp capturing
// each verb's text, and the translation to fill.
type pattern struct {
	english *regexp.Regexp
	fixed   int // the English's characters outside its verbs; longer wins
	target  string
}

type language struct {
	exact    map[string]string
	patterns []pattern
}

var catalogs = map[string]*language{}

func init() {
	for _, lang := range Languages[1:] {
		raw, err := files.ReadFile("catalog/" + lang + ".json")
		if err != nil {
			panic(fmt.Sprintf("locale: %s catalog: %v", lang, err))
		}
		entries := map[string]string{}
		if err := json.Unmarshal(raw, &entries); err != nil {
			panic(fmt.Sprintf("locale: %s catalog: %v", lang, err))
		}
		catalogs[lang] = compile(entries)
	}
}

func compile(entries map[string]string) *language {
	l := &language{exact: map[string]string{}}
	for en, target := range entries {
		if !verb.MatchString(en) {
			l.exact[strings.ReplaceAll(en, "%%", "%")] = target
			continue
		}
		var re strings.Builder
		re.WriteString(`^`)
		last := 0
		for _, m := range verb.FindAllStringIndex(en, -1) {
			re.WriteString(regexp.QuoteMeta(strings.ReplaceAll(en[last:m[0]], "%%", "%")))
			re.WriteString(`(.+?)`)
			last = m[1]
		}
		re.WriteString(regexp.QuoteMeta(strings.ReplaceAll(en[last:], "%%", "%")))
		re.WriteString(`$`)
		l.patterns = append(l.patterns, pattern{
			english: regexp.MustCompile(re.String()),
			fixed:   len(verb.ReplaceAllString(en, "")),
			target:  target,
		})
	}
	// The most specific sentence first: "%s is due" must not swallow
	// "this review is due on %s".
	sort.SliceStable(l.patterns, func(i, j int) bool { return l.patterns[i].fixed > l.patterns[j].fixed })
	return l
}

// Translate is msg in lang: the catalog's sentence, or msg itself when lang
// is English or unknown or the catalog has no match.
//
// A sentence with verbs is matched with the verbs' text captured; each
// capture is translated in turn (an error quoted inside another) before it
// fills the translation's verbs, in order, or by %[n] index. A message the
// whole catalog misses is tried as "head: tail", the way wrapped errors read.
func Translate(lang, msg string) string {
	l := catalogs[lang]
	if l == nil || msg == "" {
		return msg
	}
	out := l.translate(lang, msg, 0)
	if out != msg {
		return out
	}
	// A sentence written lower-case where it is composed and capitalised on
	// its way out (byok.UserMessage): matched lower-case, sent capitalised.
	if low := lowerFirst(msg); low != msg {
		if t := l.translate(lang, low, 0); t != low {
			return upperFirst(t)
		}
	}
	return msg
}

func lowerFirst(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError || !unicode.IsUpper(r) {
		return s
	}
	return string(unicode.ToLower(r)) + s[size:]
}

func upperFirst(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return s
	}
	return string(unicode.ToUpper(r)) + s[size:]
}

func (l *language) translate(lang, msg string, depth int) string {
	if depth > 3 {
		return msg
	}
	if t, ok := l.exact[msg]; ok {
		return t
	}
	for _, p := range l.patterns {
		m := p.english.FindStringSubmatch(msg)
		if m == nil {
			continue
		}
		args := m[1:]
		next := 0
		return verb.ReplaceAllStringFunc(p.target, func(v string) string {
			i := next
			if sm := verb.FindStringSubmatch(v); sm[2] != "" {
				n, _ := strconv.Atoi(sm[2])
				i = n - 1
			}
			next = i + 1
			if i < 0 || i >= len(args) {
				return v
			}
			return l.translate(lang, args[i], depth+1)
		})
	}
	if head, tail, ok := strings.Cut(msg, ": "); ok {
		h, t := l.translate(lang, head, depth+1), l.translate(lang, tail, depth+1)
		if h != head || t != tail {
			return h + ": " + t
		}
	}
	return msg
}

// Verbs counts the verbs in a format string, for the catalog test.
func Verbs(format string) int { return len(verb.FindAllString(format, -1)) }
