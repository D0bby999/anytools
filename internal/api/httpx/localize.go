package httpx

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/D0bby999/anytools/internal/locale"
)

// Localize words a JSON response's learner-facing sentences in the learner's
// interface language (internal/locale).
//
// The sentences are the values of "error" and of every "*_error" key, at any
// depth: an error body, a document's parse failure, a feed's check error. They
// are written in English where they are composed and translated here, once,
// so a handler never has to know the language, and a stored failure written
// before the learner switched language reads in the new one. Codes stay as
// they are: the catalog holds sentences, never a snake_case code, so
// `"error": "drive_full"` passes through untouched.
//
// Only JSON is buffered. A stream (Server-Sent Events, a download) passes
// straight through, flushes included, and an English learner's response is
// not touched at all.
func Localize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lang := Language(r.Context())
		if lang == "" || lang == "en" {
			next.ServeHTTP(w, r)
			return
		}
		lw := &localizingWriter{ResponseWriter: w, lang: lang}
		next.ServeHTTP(lw, r)
		lw.finish()
	})
}

type localizingWriter struct {
	http.ResponseWriter
	lang    string
	decided bool
	buffer  bool
	status  int
	body    bytes.Buffer
}

func (w *localizingWriter) decide(status int) {
	if w.decided {
		return
	}
	w.decided = true
	w.status = status
	w.buffer = strings.HasPrefix(w.Header().Get("Content-Type"), "application/json")
	if !w.buffer {
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *localizingWriter) WriteHeader(status int) { w.decide(status) }

func (w *localizingWriter) Write(p []byte) (int, error) {
	w.decide(http.StatusOK)
	if w.buffer {
		return w.body.Write(p)
	}
	return w.ResponseWriter.Write(p)
}

// Flush passes a stream's flushes through; a buffered JSON body has nothing
// to flush until finish.
func (w *localizingWriter) Flush() {
	if w.decided && w.buffer {
		return
	}
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap lets http.ResponseController reach the connection underneath.
func (w *localizingWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *localizingWriter) finish() {
	if !w.decided || !w.buffer {
		return
	}
	out := localizeJSON(w.lang, w.body.Bytes())
	w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(w.status)
	_, _ = w.ResponseWriter.Write(out)
}

// localizeJSON translates body's sentences, or returns body unchanged when it
// is not JSON or holds nothing to translate.
func localizeJSON(lang string, body []byte) []byte {
	if !bytes.Contains(body, []byte(`error"`)) {
		return body
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber() // a large id or a precise float must survive the round trip
	var v any
	if err := dec.Decode(&v); err != nil {
		return body
	}
	if !translateSentences(lang, v) {
		return body
	}
	var out bytes.Buffer
	if err := json.NewEncoder(&out).Encode(v); err != nil {
		return body
	}
	return out.Bytes()
}

// translateSentences rewrites v's sentence fields in place and reports
// whether any changed.
func translateSentences(lang string, v any) bool {
	changed := false
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			if s, ok := val.(string); ok && (k == "error" || strings.HasSuffix(k, "_error")) {
				if tr := locale.Translate(lang, s); tr != s {
					t[k] = tr
					changed = true
				}
				continue
			}
			changed = translateSentences(lang, val) || changed
		}
	case []any:
		for _, val := range t {
			changed = translateSentences(lang, val) || changed
		}
	}
	return changed
}
