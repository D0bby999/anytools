package kbapi_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
)

// Up-methods phase 16: photos of pages and notes.

func jpegFixture(name string) []byte { return []byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00|" + name + "|") }
func pngFixture(name string) []byte {
	return []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR|" + name + "|")
}

type namedPart struct {
	name string
	data []byte
}

// uploadParts posts several "file" parts, with one_document when oneDoc.
func (e *env) uploadParts(user, kbID uuid.UUID, oneDoc bool, parts ...namedPart) *httptest.ResponseRecorder {
	e.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if oneDoc {
		_ = w.WriteField("one_document", "true")
	}
	for _, p := range parts {
		part, err := w.CreateFormFile("file", p.name)
		if err != nil {
			e.t.Fatal(err)
		}
		_, _ = part.Write(p.data)
	}
	_ = w.Close()
	req := httptest.NewRequest(http.MethodPost, "/v1/kb/"+kbID.String()+"/documents", &buf)
	req.Header.Set("Authorization", "Bearer "+gatewayToken)
	req.Header.Set(httpx.UserIDHeader, user.String())
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return rec
}

func TestPhotosUploadTogetherAsOneDocument(t *testing.T) {
	e := newEnv(t)
	kb := e.createKB(e.alice, "Photos")

	// Several files are one document only when the learner says so.
	if rec := e.uploadParts(e.alice, kb, false,
		namedPart{"a.jpg", jpegFixture("a")}, namedPart{"b.jpg", jpegFixture("b")}); rec.Code != http.StatusBadRequest {
		t.Fatalf("two files without one_document: %d %s", rec.Code, rec.Body.String())
	}
	rec := e.uploadParts(e.alice, kb, true,
		namedPart{"b.jpg", jpegFixture("b")}, namedPart{"a.png", pngFixture("a")}, namedPart{"c.jpg", jpegFixture("c")})
	if rec.Code != http.StatusAccepted {
		t.Fatalf("three photos: %d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Document struct {
			ID        uuid.UUID `json:"id"`
			MIME      string    `json:"mime"`
			PageCount int       `json:"page_count"`
		} `json:"document"`
	}
	decode(t, rec, &got)
	if got.Document.MIME != "application/vnd.longplay.photo-set" || got.Document.PageCount != 3 {
		t.Fatalf("document = %+v", got.Document)
	}
	// The same photos in the same order are the same document.
	if rec := e.uploadParts(e.alice, kb, true,
		namedPart{"b.jpg", jpegFixture("b")}, namedPart{"a.png", pngFixture("a")}, namedPart{"c.jpg", jpegFixture("c")}); rec.Code != http.StatusConflict {
		t.Fatalf("the same set again: %d", rec.Code)
	}
	e.drainJobs()

	photo := "/v1/documents/" + got.Document.ID.String() + "/photo?page="
	res := e.do(e.alice, http.MethodGet, photo+"2", nil)
	if res.Code != http.StatusOK || !bytes.Equal(res.Body.Bytes(), pngFixture("a")) {
		t.Fatalf("photo 2: %d %q", res.Code, res.Body.String())
	}
	for header, want := range map[string]string{
		"Content-Type": "image/png", "X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": "sandbox", "Content-Disposition": "inline",
	} {
		if v := res.Header().Get(header); v != want {
			t.Errorf("%s = %q, want %q", header, v, want)
		}
	}
	for _, page := range []string{"0", "4", "x"} {
		if code := e.do(e.alice, http.MethodGet, photo+page, nil).Code; code != http.StatusNotFound && code != http.StatusBadRequest {
			t.Errorf("photo %s: %d", page, code)
		}
	}
	// Another learner's photo answers like no photo at all.
	if a, b := e.do(e.bob, http.MethodGet, photo+"1", nil).Code,
		e.do(e.bob, http.MethodGet, "/v1/documents/"+uuid.NewString()+"/photo?page=1", nil).Code; a != http.StatusNotFound || b != a {
		t.Fatalf("bob: %d for alice's photo, %d for none", a, b)
	}

	// A document that is not a photo has no photo.
	pdf := e.upload(e.alice, kb, "rag.pdf", ragPDF(t))
	var pdfDoc struct {
		Document struct {
			ID uuid.UUID `json:"id"`
		} `json:"document"`
	}
	decode(t, pdf, &pdfDoc)
	if code := e.do(e.alice, http.MethodGet, "/v1/documents/"+pdfDoc.Document.ID.String()+"/photo?page=1", nil).Code; code != http.StatusNotFound {
		t.Errorf("a PDF's photo: %d", code)
	}
}

func TestOversizedPhotosAreRefusedWith413(t *testing.T) {
	e := newEnv(t)
	kb := e.createKB(e.alice, "Photos")
	big := append(jpegFixture("big"), make([]byte, 20<<20)...)

	rec := e.upload(e.alice, kb, "big.jpg", big)
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "20 MB") {
		t.Fatalf("one photo of 20 MB + some: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.uploadParts(e.alice, kb, true, namedPart{"a.jpg", jpegFixture("a")}, namedPart{"big.jpg", big})
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "each photo") {
		t.Fatalf("a set with a big photo: %d %s", rec.Code, rec.Body.String())
	}
	parts := make([]namedPart, 31)
	for i := range parts {
		parts[i] = namedPart{"p.jpg", jpegFixture(strings.Repeat("x", i+1))}
	}
	rec = e.uploadParts(e.alice, kb, true, parts...)
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "30 photos") {
		t.Fatalf("31 photos: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.uploadParts(e.alice, kb, true, namedPart{"a.jpg", jpegFixture("a")}, namedPart{"rag.pdf", ragPDF(t)})
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("a PDF among photos: %d %s", rec.Code, rec.Body.String())
	}
}
