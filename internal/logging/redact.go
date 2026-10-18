// Package logging holds the process's one log handler decoration: redaction.
package logging

import (
	"context"
	"log/slog"
	"regexp"
	"strings"
)

// Redacted is what a secret is replaced with.
const Redacted = "[REDACTED]"

// secretKey matches attribute keys that name a credential. It is anchored at
// the END so `prompt_tokens` (a usage count) is kept and `refresh_token` is not.
var secretKey = regexp.MustCompile(`(?i)(^|[_.-])(token|secret|password|passwd|api_?key|authorization|cookie|credential|dsn)$`)

// secretValue matches credentials by their SHAPE, wherever they appear —
// including inside an error string a provider echoed back ("invalid key
// sk-…"), which no key name would catch.
var secretValue = regexp.MustCompile(strings.Join([]string{
	`(?i)bearer\s+[A-Za-z0-9._~+/=-]{8,}`,     // Authorization header values
	`sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}`,    // OpenAI, Anthropic, OpenRouter
	`AIza[0-9A-Za-z_-]{30,}`,                  // Google API keys
	`ya29\.[0-9A-Za-z_-]{20,}`,                // Google access tokens
	`1//[0-9A-Za-z_-]{20,}`,                   // Google refresh tokens
	`gh[pousr]_[A-Za-z0-9]{20,}`,              // GitHub tokens
	`github_pat_[A-Za-z0-9_]{20,}`,            // GitHub fine-grained tokens (the github connection)
	`gsk_[A-Za-z0-9]{20,}`,                    // Groq (the stt function's preset)
	`tvly-[A-Za-z0-9_-]{16,}`,                 // Tavily
	`postgres(?:ql)?://[^\s:@/]+:[^\s@/]+@`,   // a DSN with a password in it
	`(?i)[?&](?:api_?key|key|token)=[^&\s"]+`, // a key in a URL's query (OpenAlex)
	`/keys/[A-Za-z0-9]{16,}`,                  // a key in a URL's path (Zotero's /keys/{key})
	`(?i)[?&]upload_id=[^&\s"]+`,              // a Drive resumable session, a credential for its upload
}, "|"))

// Redact scrubs one string of anything shaped like a credential.
func Redact(s string) string { return secretValue.ReplaceAllString(s, Redacted) }

// NewRedactingHandler wraps next so no record reaches it with a secret in it.
//
// Redaction happens at the one handler every log line passes through, not at
// call sites: a call site that remembers today is one refactor away from
// logging `err` from a provider that quoted the request's key back.
func NewRedactingHandler(next slog.Handler) slog.Handler { return redacting{next} }

type redacting struct{ next slog.Handler }

func (h redacting) Enabled(ctx context.Context, l slog.Level) bool { return h.next.Enabled(ctx, l) }

func (h redacting) Handle(ctx context.Context, r slog.Record) error {
	out := slog.NewRecord(r.Time, r.Level, Redact(r.Message), r.PC)
	r.Attrs(func(a slog.Attr) bool {
		out.AddAttrs(redactAttr(a))
		return true
	})
	return h.next.Handle(ctx, out)
}

func (h redacting) WithAttrs(attrs []slog.Attr) slog.Handler {
	clean := make([]slog.Attr, len(attrs))
	for i, a := range attrs {
		clean[i] = redactAttr(a)
	}
	return redacting{h.next.WithAttrs(clean)}
}

func (h redacting) WithGroup(name string) slog.Handler { return redacting{h.next.WithGroup(name)} }

func redactAttr(a slog.Attr) slog.Attr {
	v := a.Value.Resolve()
	if v.Kind() == slog.KindGroup {
		group := v.Group()
		clean := make([]any, len(group))
		for i, g := range group {
			clean[i] = redactAttr(g)
		}
		return slog.Group(a.Key, clean...)
	}
	if secretKey.MatchString(a.Key) {
		return slog.String(a.Key, Redacted)
	}
	switch v.Kind() {
	case slog.KindString:
		return slog.String(a.Key, Redact(v.String()))
	case slog.KindAny:
		// Errors and Stringers are rendered to text by the JSON handler; do it
		// here instead so the text can be scrubbed first.
		switch x := v.Any().(type) {
		case error:
			return slog.String(a.Key, Redact(x.Error()))
		case interface{ String() string }:
			return slog.String(a.Key, Redact(x.String()))
		}
	}
	return slog.Attr{Key: a.Key, Value: v}
}
