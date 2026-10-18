package readingapi

import (
	"bytes"
	"net/http"
	"time"

	"github.com/D0bby999/anytools/internal/api/httpx"
)

// renderableTypes are the media types this endpoint will serve.
//
// An ALLOWLIST, and a short one. The bytes here are a file a user uploaded, and
// serving them back inline on the BFF's own origin is how a stored HTML or SVG
// document becomes script running with that origin's cookies. PDF and EPUB are
// the two the viewers need; every other type is answered 415 and the viewer
// falls back to the parsed Markdown it already has, which is a real fallback
// rather than a broken page.
//
// EPUB is a zip, so the browser never renders it directly — epub.js unpacks it
// in JavaScript — which is why it is safe to serve here and `text/html` is not.
var renderableTypes = map[string]bool{
	"application/pdf":      true,
	"application/epub+zip": true,
}

// file serves the ORIGINAL uploaded bytes for a workspace's document, for
// pdf.js and epub.js to render.
//
// It exists because the parsed Markdown the Knowledge Center stores is a
// TRANSCRIPTION of the document, not the document: it has no figures, no
// layout, and no selectable original text. Immersive reading is reading the
// actual page, so the actual page has to reach the browser.
//
// Headers, and why each is there:
//   - `Content-Type` from the allowlist, never from the request or a sniff.
//   - `X-Content-Type-Options: nosniff` so a browser cannot decide a PDF that
//     starts with "<" is HTML.
//   - `Content-Disposition: inline` with no filename: the viewer renders it,
//     nothing downloads it, and a filename header built from a user-supplied
//     title is a header-injection surface for no gain.
//   - `Content-Security-Policy: sandbox` so that even if one of the two
//     allowlisted types is ever mis-set on a row, what reaches the browser has
//     no origin, no scripts and no forms.
//   - `Cache-Control: private` plus an ETag on the content digest. A PDF is
//     re-requested on every page navigation, and the digest is already the
//     document's identity — a changed file is a different sha256 and therefore
//     a different ETag, with no invalidation logic to get wrong.
func (h *Handler) file(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := h.requireWorkspace(w, r)
	if !ok {
		return
	}

	doc, err := h.d.Documents.GetDocument(r.Context(), userID, ws.DocumentID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if !renderableTypes[doc.MIME] {
		httpx.WriteError(w, http.StatusUnsupportedMediaType,
			"this document is not rendered as a file; read the parsed text instead",
			"not_renderable")
		return
	}

	etag := `"` + doc.SHA256 + `"`
	if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	data, err := h.d.Blobs.GetOriginal(r.Context(), userID, doc.SHA256)
	if err != nil {
		h.fail(w, r, err)
		return
	}

	w.Header().Set("Content-Type", doc.MIME)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("ETag", etag)

	// ServeContent rather than Write: pdf.js asks for byte ranges so it can
	// render page 40 of a 400-page file without downloading the first 39, and
	// this is what answers a Range request correctly, 206 and all.
	http.ServeContent(w, r, "", modTime(doc.UpdatedAt), bytes.NewReader(data))
}

func modTime(t time.Time) time.Time {
	if t.IsZero() {
		return time.Time{}
	}
	return t
}
