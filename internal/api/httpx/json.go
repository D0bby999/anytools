package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
)

// maxRequestBody caps any JSON body this package decodes. Without it a single
// client can make the server allocate until it dies.
const maxRequestBody = 1 << 20 // 1 MiB

// ErrorBody is the one error shape the API returns.
type ErrorBody struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

// WriteJSON writes v as JSON with the given status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// The status line is already on the wire, so there is nothing to
		// correct — record it and move on.
		slog.Error("httpx: encode response", "error", err)
	}
}

// WriteError writes a JSON error body.
//
// The message is caller-controlled and must never embed a database error, a
// secret or a raw upstream response: this body reaches the browser through the
// BFF.
func WriteError(w http.ResponseWriter, status int, message string, code ...string) {
	body := ErrorBody{Error: message}
	if len(code) > 0 {
		body.Code = code[0]
	}
	WriteJSON(w, status, body)
}

// DecodeJSON reads a size-capped JSON body into v, rejecting unknown fields so
// a client typo fails loudly instead of being silently ignored.
func DecodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	return DecodeJSONLimit(w, r, v, maxRequestBody)
}

// DecodeJSONLimit is DecodeJSON with a caller-chosen cap, for the one kind of
// body that is legitimately larger than 1 MiB: an inline image (solve's
// photographed problem). A handler that raises the cap owns the reason.
func DecodeJSONLimit(w http.ResponseWriter, r *http.Request, v any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	// A second JSON value in the same body means the client sent something
	// other than the single object the endpoint documents.
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain exactly one JSON object")
	}
	return nil
}
