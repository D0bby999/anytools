package httpx

import (
	"log/slog"
	"net/http"
	"runtime/debug"
)

// Recover is the OUTERMOST HTTP wrapper.
//
// net/http does NOT recover handler panics — an unrecovered panic in any
// handler crashes the whole process, dropping every live SSE client (phase 5's
// stream primitive) and handing any input that triggers a panic a remote-DoS.
// This converts a panic into a 500 and keeps the process alive.
//
// It deliberately does NOT wrap http.ResponseWriter, so http.Flusher (SSE)
// keeps working. The 500 write is best-effort: if the response was already
// started, WriteHeader is a logged no-op in net/http, and the inner recover
// guards anyway. Ported from postclaw internal/gateway/recover_middleware.go.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			// http.ErrAbortHandler is net/http's sentinel for an intentional
			// abort — re-panic so the server handles it as designed.
			if rec == http.ErrAbortHandler {
				panic(rec)
			}
			slog.Error("httpx: recovered handler panic",
				"err", rec,
				"method", r.Method,
				"path", r.URL.Path,
				"stack", string(debug.Stack()))
			defer func() { _ = recover() }() // guard write-after-response-start
			w.WriteHeader(http.StatusInternalServerError)
		}()
		next.ServeHTTP(w, r)
	})
}
