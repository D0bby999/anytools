package stt

import (
	"regexp"
	"strings"
)

// language.go — engines spell the detected language three ways: OpenAI
// "english", Groq "English", speaches "en". AnyTools stores a BCP-47 code
// (youtube.Transcript.Language), so the names Whisper reports are folded to
// their ISO-639-1 codes. The table is Whisper's own language list (openai/
// whisper tokenizer.py LANGUAGES), limited to the languages with a two-letter
// code; a name not in it is "", which the transcript treats as unknown.
var whisperNames = map[string]string{
	"english": "en", "chinese": "zh", "german": "de", "spanish": "es", "russian": "ru",
	"korean": "ko", "french": "fr", "japanese": "ja", "portuguese": "pt", "turkish": "tr",
	"polish": "pl", "catalan": "ca", "dutch": "nl", "arabic": "ar", "swedish": "sv",
	"italian": "it", "indonesian": "id", "hindi": "hi", "finnish": "fi", "vietnamese": "vi",
	"hebrew": "he", "ukrainian": "uk", "greek": "el", "malay": "ms", "czech": "cs",
	"romanian": "ro", "danish": "da", "hungarian": "hu", "tamil": "ta", "norwegian": "no",
	"thai": "th", "urdu": "ur", "croatian": "hr", "bulgarian": "bg", "lithuanian": "lt",
	"latin": "la", "maori": "mi", "malayalam": "ml", "welsh": "cy", "slovak": "sk",
	"telugu": "te", "persian": "fa", "latvian": "lv", "bengali": "bn", "serbian": "sr",
	"azerbaijani": "az", "slovenian": "sl", "kannada": "kn", "estonian": "et",
	"macedonian": "mk", "breton": "br", "basque": "eu", "icelandic": "is", "armenian": "hy",
	"nepali": "ne", "mongolian": "mn", "bosnian": "bs", "kazakh": "kk", "albanian": "sq",
	"swahili": "sw", "galician": "gl", "marathi": "mr", "punjabi": "pa", "sinhala": "si",
	"khmer": "km", "shona": "sn", "yoruba": "yo", "somali": "so", "afrikaans": "af",
	"occitan": "oc", "georgian": "ka", "belarusian": "be", "tajik": "tg", "sindhi": "sd",
	"gujarati": "gu", "amharic": "am", "yiddish": "yi", "lao": "lo", "uzbek": "uz",
	"faroese": "fo", "haitian creole": "ht", "pashto": "ps", "turkmen": "tk", "nynorsk": "nn",
	"maltese": "mt", "sanskrit": "sa", "luxembourgish": "lb", "myanmar": "my", "tibetan": "bo",
	"tagalog": "tl", "malagasy": "mg", "assamese": "as", "tatar": "tt", "hawaiian": "haw",
	"lingala": "ln", "hausa": "ha", "bashkir": "ba", "javanese": "jw", "sundanese": "su",
	"cantonese": "yue",
}

var codePattern = regexp.MustCompile(`^[a-z]{2,3}$`)

// languageCode folds an engine's language, or a caller's BCP-47 hint
// ("en-US"), to the bare code the engines accept and the transcript stores.
func languageCode(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if code, ok := whisperNames[s]; ok {
		return code
	}
	if i := strings.IndexAny(s, "-_"); i > 0 {
		s = s[:i]
	}
	if codePattern.MatchString(s) {
		return s
	}
	return ""
}
