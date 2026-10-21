package canva

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

type doer struct{}

func (doer) Do(_ context.Context, _ uuid.UUID, id string, send func(string) (*http.Response, error)) (*http.Response, error) {
	if id != "canva" {
		panic(id)
	}
	return send("tok")
}

func TestMarkdownToDOCX(t *testing.T) {
	data, err := MarkdownToDOCX("# Tuần 3 & RAG\n\n- **Truy xuất** <tài liệu>\n1. Bước một\n\n```\ncode()\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var doc string
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			doc = string(b)
		}
	}
	for _, want := range []string{`w:val="Heading1"`, "Tuần 3 &amp; RAG", "• Truy xuất &lt;tài liệu&gt;", "1. Bước một", "Courier New", "1  ·  2"} {
		if !strings.Contains(doc, want) {
			t.Errorf("missing %q in %s", want, doc)
		}
	}
	if strings.Contains(doc, "---") || strings.Contains(doc, "**") {
		t.Error("table rules and inline marks are dropped")
	}
}

func TestExportAndImport(t *testing.T) {
	polls := 0
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" && !strings.HasPrefix(r.URL.Path, "/dl/") {
			t.Errorf("token on %s", r.URL.Path)
		}
		switch {
		case r.URL.Path == "/designs" && r.Method == http.MethodGet:
			if r.URL.Query().Get("query") != "biology" {
				t.Errorf("query: %s", r.URL.RawQuery)
			}
			_, _ = io.WriteString(w, `{"items":[{"id":"DAF1","title":"Cell slides","urls":{"edit_url":"https://www.canva.com/design/DAF1/edit"},"thumbnail":{"url":"https://x/t.png"}}],"continuation":"c2"}`)
		case r.URL.Path == "/designs/DAF1":
			_, _ = io.WriteString(w, `{"design":{"title":"Cell slides"}}`)
		case r.URL.Path == "/exports" && r.Method == http.MethodPost:
			var b map[string]any
			_ = json.NewDecoder(r.Body).Decode(&b)
			if b["design_id"] != "DAF1" || b["format"].(map[string]any)["type"] != "pdf" {
				t.Errorf("export body: %v", b)
			}
			_, _ = io.WriteString(w, `{"job":{"id":"e1","status":"in_progress"}}`)
		case r.URL.Path == "/exports/e1":
			polls++
			if polls < 2 {
				_, _ = io.WriteString(w, `{"job":{"id":"e1","status":"in_progress"}}`)
				return
			}
			_, _ = io.WriteString(w, `{"job":{"id":"e1","status":"success","urls":["`+srv.URL+`/dl/e1.pdf"]}}`)
		case r.URL.Path == "/dl/e1.pdf":
			_, _ = io.WriteString(w, "%PDF-1.7 slides")
		case r.URL.Path == "/imports" && r.Method == http.MethodPost:
			var meta map[string]string
			_ = json.Unmarshal([]byte(r.Header.Get("Import-Metadata")), &meta)
			title, _ := base64.StdEncoding.DecodeString(meta["title_base64"])
			if string(title) != "Week 3 notes" || !strings.Contains(meta["mime_type"], "wordprocessingml") {
				t.Errorf("import meta: %v", meta)
			}
			b, _ := io.ReadAll(r.Body)
			if !bytes.HasPrefix(b, []byte("PK")) {
				t.Error("the body is a docx")
			}
			_, _ = io.WriteString(w, `{"job":{"id":"i1","status":"in_progress"}}`)
		case r.URL.Path == "/imports/i1":
			_, _ = io.WriteString(w, `{"job":{"id":"i1","status":"success","result":{"designs":[{"id":"DAF9","title":"Week 3 notes","urls":{"edit_url":"https://www.canva.com/design/DAF9/edit"}}]}}}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()
	svc := NewService(doer{}, http.DefaultClient)
	svc.SetBaseURL(srv.URL)
	ctx, user := context.Background(), uuid.New()

	designs, next, err := svc.Designs(ctx, user, " biology ", "")
	if err != nil || len(designs) != 1 || designs[0].Title != "Cell slides" || next != "c2" {
		t.Fatalf("%+v %q %v", designs, next, err)
	}
	pdf, title, err := svc.ExportPDF(ctx, user, "DAF1")
	if err != nil || string(pdf) != "%PDF-1.7 slides" || title != "Cell slides" || polls != 2 {
		t.Fatalf("%q %q %v polls=%d", pdf, title, err, polls)
	}
	if _, _, err := svc.ExportPDF(ctx, user, "../x"); err == nil {
		t.Fatal("a path in a design id is refused")
	}
	opened, err := svc.ImportMarkdown(ctx, user, "Week 3 notes", "# Week 3\n\nNotes.")
	if err != nil || opened.EditURL != "https://www.canva.com/design/DAF9/edit" {
		t.Fatalf("%+v %v", opened, err)
	}
}
