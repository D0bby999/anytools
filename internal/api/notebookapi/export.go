package notebookapi

import (
	"net/http"
	"strconv"

	"github.com/D0bby999/anytools/internal/notebook"
)

// export serves `GET /v1/notebooks/{id}/export.md`.
//
// Three headers do the work, and each closes a real hole:
//
//   - `text/markdown`, not `text/html`. The body is a user's and a model's own
//     Markdown — untrusted from two directions — and a browser that decided to
//     render it as HTML would execute whatever a document once contained.
//   - `X-Content-Type-Options: nosniff`, because a browser that sniffs will
//     find `<h1>` in a Markdown file and decide it knows better.
//   - `Content-Disposition: attachment`, with a filename derived from a
//     SANITISED slug of the notebook's name rather than the name itself. A
//     notebook called `x"; filename="evil.html` would otherwise write its own
//     header, and one containing a newline would write its own headers, plural.
//
// The route ends in `.md` on purpose: it is what a person types when they want
// the file, and it is what a download names by default.
func (h *Handler) export(w http.ResponseWriter, r *http.Request) {
	userID, id, ok := ident(w, r)
	if !ok {
		return
	}
	nb, err := h.svc.GetNotebook(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	md, err := h.svc.ExportMarkdown(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition",
		"attachment; filename="+strconv.Quote(notebook.ExportFilename(nb.Name)))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(md)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(md))
}
