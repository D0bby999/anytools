package gdocs

import (
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

type doer struct{}

func (doer) GoogleDo(_ context.Context, _ uuid.UUID, _ []string, send func(string) (*http.Response, error)) (*http.Response, error) {
	return send("tok")
}

func TestCreateFindsOrMakesTheFolderAndUploadsADoc(t *testing.T) {
	folders := 0
	var meta, md string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/drive/files":
			if !strings.Contains(r.URL.Query().Get("q"), "name = 'AnyLearn for NotebookLM'") {
				t.Errorf("q: %s", r.URL.Query().Get("q"))
			}
			if folders == 0 {
				_, _ = io.WriteString(w, `{"files":[]}`)
			} else {
				_, _ = io.WriteString(w, `{"files":[{"id":"folder1"}]}`)
			}
		case r.Method == http.MethodPost && r.URL.Path == "/drive/files":
			folders++
			_, _ = io.WriteString(w, `{"id":"folder1"}`)
		case r.Method == http.MethodPost && r.URL.Path == "/upload/files":
			_, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			mr := multipart.NewReader(r.Body, params["boundary"])
			p1, _ := mr.NextPart()
			b1, _ := io.ReadAll(p1)
			p2, _ := mr.NextPart()
			b2, _ := io.ReadAll(p2)
			meta, md = string(b1), string(b2)
			_, _ = io.WriteString(w, `{"id":"doc1","name":"Week 3 notes"}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()
	svc := NewService(doer{})
	svc.SetBaseURLs(srv.URL+"/drive", srv.URL+"/upload")

	for i := 0; i < 2; i++ {
		doc, err := svc.Create(context.Background(), uuid.New(), "Week 3 notes.md", "# Week 3\n\nNotes.")
		if err != nil || doc.URL != "https://docs.google.com/document/d/doc1/edit" {
			t.Fatalf("%+v %v", doc, err)
		}
	}
	if folders != 1 {
		t.Fatalf("the folder is made once: %d", folders)
	}
	if !strings.Contains(meta, `"mimeType":"application/vnd.google-apps.document"`) || !strings.Contains(meta, `"parents":["folder1"]`) ||
		!strings.Contains(meta, `"name":"Week 3 notes"`) || md != "# Week 3\n\nNotes." {
		t.Fatalf("meta=%s md=%q", meta, md)
	}
}
