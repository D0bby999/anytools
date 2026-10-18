package audio

import (
	"github.com/D0bby999/anytools/internal/providers/tts"
)

// voices.go — who speaks the Host and the Expert, per engine and language
// (up-methods phase 22). Two DISTINCT voices, so a listener can tell the two
// apart, one female and one male where the engine has both.
//
// Kokoro's voices are from hexgrad/Kokoro-82M VOICES.md (read 2026-10-16),
// one list per lang_code; the first letter of a voice is its language and the
// second its gender. A language with no pair is absent on purpose: an
// overview in it is never sent to that engine, and the page offers the
// others and the browser instead.
//
//   - Vietnamese: Kokoro has no Vietnamese voice at all.
//   - French: Kokoro has one French voice, ff_siwis, and no second one to
//     answer it, so French has no pair either.
//
// OpenAI's voices speak every language the model does, so one pair serves
// all of them.

// VoicePair is the two voices of an overview.
type VoicePair struct {
	Host   string `json:"host"`
	Expert string `json:"expert"`
}

// kokoroVoices is Kokoro's pair per language (BCP 47).
var kokoroVoices = map[string]VoicePair{
	"en":    {Host: "af_heart", Expert: "am_michael"},  // American English, lang_code a
	"en-GB": {Host: "bf_emma", Expert: "bm_george"},    // British English, b
	"es":    {Host: "ef_dora", Expert: "em_alex"},      // Spanish, e
	"hi":    {Host: "hf_alpha", Expert: "hm_omega"},    // Hindi, h
	"it":    {Host: "if_sara", Expert: "im_nicola"},    // Italian, i
	"ja":    {Host: "jf_alpha", Expert: "jm_kumo"},     // Japanese, j
	"pt-BR": {Host: "pf_dora", Expert: "pm_alex"},      // Brazilian Portuguese, p
	"zh":    {Host: "zf_xiaoxiao", Expert: "zm_yunxi"}, // Mandarin Chinese, z
}

// openAIVoices is OpenAI's pair, for every language.
var openAIVoices = VoicePair{Host: "nova", Expert: "onyx"}

// VoicesFor is the pair a voice family (tts.Family) speaks lang with, and
// false when it has none.
func VoicesFor(family, lang string) (VoicePair, bool) {
	switch family {
	case tts.FamilyKokoro:
		p, ok := kokoroVoices[lang]
		return p, ok
	case tts.FamilyOpenAI:
		return openAIVoices, true
	}
	return VoicePair{}, false
}

// KokoroLanguages counts the languages Kokoro can speak an overview in,
// besides English (American and British count as one): the number the
// readiness row states, so it can never say more than the table holds.
func KokoroLanguages() int {
	n := 0
	for lang := range kokoroVoices {
		if lang != "en" && lang != "en-GB" {
			n++
		}
	}
	return n
}

// speakers is the pair as the synthesizer takes it.
func (p VoicePair) speakers() []tts.Speaker {
	return []tts.Speaker{{Name: "Host", Voice: p.Host}, {Name: "Expert", Voice: p.Expert}}
}
