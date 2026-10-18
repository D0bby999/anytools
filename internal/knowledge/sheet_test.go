package knowledge_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// A workbook goes through the same upload and job as every document, read
// locally: no parser is called even when one is configured, each visible
// sheet is one page, and every passage's heading path names its sheet — which
// is what a citation reads.
func TestSpreadsheetUploadIndexesOnePagePerSheet(t *testing.T) {
	parser := newFakeParser("gemini")
	h := newHarness(t, &fakeProviders{
		chain:    []knowledge.Parser{parser},
		embedder: newFakeEmbedder("embed-1", 768),
	})
	ctx := context.Background()
	data, err := os.ReadFile(filepath.Join("..", "rag", "parse", "testdata", "sheets.xlsx"))
	if err != nil {
		t.Fatal(err)
	}

	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "Budget 2023.xlsx", data)
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if res.Document.MIME != parse.MimeXLSX {
		t.Fatalf("mime = %q", res.Document.MIME)
	}
	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
		DocumentID: res.Document.ID, KBID: h.kb.ID,
	}, lastAttempt); err != nil {
		t.Fatalf("ProcessDocument: %v", err)
	}
	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if doc.Status != knowledge.StatusReady || doc.PageCount != 2 {
		t.Fatalf("status %q (%s), %d pages; want ready with 2", doc.Status, doc.Error, doc.PageCount)
	}
	var pb knowledge.ProcessedBy
	_ = json.Unmarshal(doc.ProcessedBy, &pb)
	if pb.Parser != "local:excelize" {
		t.Fatalf("parser = %q, want the local reader", pb.Parser)
	}
	if len(parser.calls()) != 0 {
		t.Fatal("no model may read a spreadsheet")
	}

	sheets := map[string]int{}
	for _, c := range h.chunks.get(doc.ID) {
		sheets[c.HeadingPath] = c.PageStart
		if strings.Contains(c.Text, "HIDDEN-SHEET-MARKER") {
			t.Fatal("a hidden sheet's cells reached the index")
		}
	}
	if sheets["Sheet: Budget"] != 1 || sheets["Sheet: Orders"] != 2 {
		t.Fatalf("heading paths by page = %v, want Sheet: Budget on 1 and Sheet: Orders on 2", sheets)
	}
}

// An oversized or empty spreadsheet fails once, with a reason, rather than
// being retried: reading it again cannot change the answer.
func TestSpreadsheetLimitsFailTerminally(t *testing.T) {
	cases := []struct {
		name, filename, wantIn string
		data                   []byte
	}{
		{"over the cell budget", "huge.csv", "2 million cells",
			[]byte(strings.Repeat("1,", parse.MaxSheetCells) + "1\n")},
		{"no cells", "empty.csv", "no cells", []byte("\n\n")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t, &fakeProviders{embedder: newFakeEmbedder("embed-1", 768)})
			ctx := context.Background()
			res, err := h.svc.Upload(ctx, h.user, h.kb.ID, tc.filename, tc.data)
			if err != nil {
				t.Fatalf("Upload: %v", err)
			}
			err = h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{
				DocumentID: res.Document.ID, KBID: h.kb.ID,
			}, knowledge.Attempt{Number: 1, Max: 3})
			if err == nil || !knowledge.IsTerminal(err) {
				t.Fatalf("want a terminal failure on the first attempt, got %v", err)
			}
			doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
			if doc.Status != knowledge.StatusFailed || !strings.Contains(doc.Error, tc.wantIn) {
				t.Fatalf("status %q, error %q; want failed mentioning %q", doc.Status, doc.Error, tc.wantIn)
			}
		})
	}
}
