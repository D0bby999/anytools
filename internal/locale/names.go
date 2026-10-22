package locale

import (
	"fmt"
	"strings"
)

// englishNames are the languages a prompt names by name; any other is named
// by its code, which a model also reads.
var englishNames = map[string]string{
	"en": "English", "vi": "Vietnamese", "fr": "French", "de": "German", "es": "Spanish",
	"ja": "Japanese", "ko": "Korean", "zh": "Chinese", "pt": "Portuguese", "ru": "Russian",
	"it": "Italian", "th": "Thai", "id": "Indonesian", "nl": "Dutch", "pl": "Polish",
	"tr": "Turkish", "ar": "Arabic", "hi": "Hindi",
}

// Base is a language tag's primary subtag: "pt-BR" → "pt".
func Base(tag string) string {
	tag = strings.ToLower(strings.TrimSpace(tag))
	if i := strings.IndexAny(tag, "-_"); i > 0 {
		return tag[:i]
	}
	return tag
}

// EnglishName is how a prompt names a language: "Vietnamese" for "vi", and
// the code with what it is for one not in the list.
func EnglishName(tag string) string {
	if n, ok := englishNames[Base(tag)]; ok {
		return n
	}
	return fmt.Sprintf("the language with the BCP 47 code %q", tag)
}
