package kbapi_test

import (
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// zeros is an endless reader of zero bytes.
type zeros struct{}

func (zeros) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

// uploadStream posts size bytes as the file part without holding them: the
// handler's bounded read is what is being tested, not this test's memory.
func (e *env) uploadStream(filename string, size int64) *httptest.ResponseRecorder {
	e.t.Helper()
	kbID := e.createKB(e.alice, "Recordings")
	pr, pw := io.Pipe()
	w := multipart.NewWriter(pw)
	go func() {
		part, err := w.CreateFormFile("file", filename)
		if err == nil {
			_, err = io.Copy(part, io.LimitReader(zeros{}, size))
		}
		if err == nil {
			err = w.Close()
		}
		pw.CloseWithError(err)
	}()
	req := httptest.NewRequest(http.MethodPost, "/v1/kb/"+kbID.String()+"/documents", pr)
	req.Header.Set("Authorization", "Bearer "+gatewayToken)
	req.Header.Set(httpx.UserIDHeader, e.alice.String())
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	_ = pr.CloseWithError(io.ErrClosedPipe)
	return rec
}

// An audio or video file gets 500 MB, one byte more is refused before the
// file is looked at; a document keeps its 50 MB.
func TestTheMediaCapIs500MBAndADocumentKeeps50(t *testing.T) {
	e := newEnv(t)
	rec := e.uploadStream("lecture.mp3", knowledge.MaxMediaBytes+1)
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "500 MB") {
		t.Fatalf("500 MB + 1 byte: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.uploadStream("notes.pdf", knowledge.MaxUploadBytes+1)
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "50 MB") {
		t.Fatalf("50 MB + 1 byte as a document: %d %s", rec.Code, rec.Body.String())
	}
	if knowledge.UploadLimit("talk.MOV") != knowledge.MaxMediaBytes || knowledge.UploadLimit("talk.pdf") != knowledge.MaxUploadBytes {
		t.Fatal("the cap does not follow the name")
	}
}
