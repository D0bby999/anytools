package zotero_test

import (
	"context"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/connectors/zotero/zoterotest"
)

func TestSearchReadsTopItemsWithoutAttachments(t *testing.T) {
	srv := zoterotest.New(t)
	items, err := srv.Client().Search(context.Background(), zoterotest.Credential(), "retrieval", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("items: %+v", items)
	}
	rag := items[0]
	if rag.Key != zoterotest.ItemWithPDF || rag.ItemType != "journalArticle" || rag.Year != "2020" ||
		rag.DOI != "10.48550/arXiv.2005.11401" || rag.WebURL == "" ||
		strings.Join(rag.Creators, "; ") != "Patrick Lewis; Ethan Perez; Facebook AI Research" {
		t.Fatalf("first item: %+v", rag)
	}
	if items[1].Year != "2017" {
		t.Fatalf("a year inside a free-form date: %+v", items[1])
	}
	paths := srv.Paths()
	got := paths[len(paths)-1]
	for _, want := range []string{"/users/475425/items/top?", "itemType=-attachment", "limit=25", "q=retrieval", "format=json"} {
		if !strings.Contains(got, want) {
			t.Fatalf("search request %q lacks %q", got, want)
		}
	}
	if none, err := srv.Client().Search(context.Background(), zoterotest.Credential(), "nothing", 5); err != nil || len(none) != 0 {
		t.Fatalf("an empty result: %v %v", none, err)
	}
}

func TestCollectionsAndTheirItems(t *testing.T) {
	srv := zoterotest.New(t)
	c := srv.Client()
	cols, err := c.Collections(context.Background(), zoterotest.Credential(), "")
	if err != nil || len(cols) != 1 || cols[0].Name != "Retrieval" || cols[0].Items != 12 || cols[0].Subcollections != 1 {
		t.Fatalf("collections: %+v %v", cols, err)
	}
	if sub, err := c.Collections(context.Background(), zoterotest.Credential(), zoterotest.Collection); err != nil || len(sub) != 0 {
		t.Fatalf("subcollections: %+v %v", sub, err)
	}
	items, err := c.CollectionItems(context.Background(), zoterotest.Credential(), zoterotest.Collection, 25)
	if err != nil || len(items) != 2 {
		t.Fatalf("collection items: %+v %v", items, err)
	}
	if _, err := c.CollectionItems(context.Background(), zoterotest.Credential(), "../keys", 25); !zotero.Is(err, zotero.CodeNotFound) {
		t.Fatalf("a path in a collection key: %v", err)
	}
}

func TestStoredPDFIsFoundAndDownloadedWithoutTheKeyAtStorage(t *testing.T) {
	srv := zoterotest.New(t)
	c := srv.Client()
	ctx := context.Background()
	att, err := c.StoredPDF(ctx, zoterotest.Credential(), zoterotest.ItemWithPDF)
	if err != nil || att == nil || att.Key != "PDFK2345" {
		t.Fatalf("stored pdf: %+v %v", att, err)
	}
	data, err := c.File(ctx, zoterotest.Credential(), att.Key)
	if err != nil || !strings.HasPrefix(string(data), "%PDF-") {
		t.Fatalf("file: %v", err)
	}
	if srv.KeyAtStorage.Load() {
		t.Fatal("the Zotero key followed the redirect to the file host")
	}
	// A linked file lives on the learner's computer: not offered.
	if att, err := c.StoredPDF(ctx, zoterotest.Credential(), zoterotest.ItemWithoutPDF); err != nil || att != nil {
		t.Fatalf("a linked file was offered: %+v %v", att, err)
	}
}

func TestFileIsBoundedAndMustBeAPDF(t *testing.T) {
	srv := zoterotest.New(t)
	c := srv.Client()
	ctx := context.Background()
	srv.PDF = append([]byte("%PDF-1.4\n"), make([]byte, zotero.MaxFileBytes)...)
	if _, err := c.File(ctx, zoterotest.Credential(), "PDFK2345"); !zotero.Is(err, zotero.CodeTooLarge) {
		t.Fatalf("a file past 50 MB: %v", err)
	}
	srv.PDF = []byte("<html>not a pdf</html>")
	if _, err := c.File(ctx, zoterotest.Credential(), "PDFK2345"); !zotero.Is(err, zotero.CodeNotPDF) {
		t.Fatalf("a file that is not a PDF: %v", err)
	}
}

func TestItemIsReadByKey(t *testing.T) {
	srv := zoterotest.New(t)
	it, err := srv.Client().Item(context.Background(), zoterotest.Credential(), zoterotest.ItemWithoutPDF)
	if err != nil || it.Title != "Attention Is All You Need" || it.URL == "" || it.Abstract == "" {
		t.Fatalf("item: %+v %v", it, err)
	}
	if _, err := srv.Client().Item(context.Background(), zoterotest.Credential(), "ZZZZ2345"); !zotero.Is(err, zotero.CodeNotFound) {
		t.Fatalf("a missing item: %v", err)
	}
}

func TestVerifyChecksTheKeyAndItsUser(t *testing.T) {
	srv := zoterotest.New(t)
	c := srv.Client()
	ctx := context.Background()
	if err := c.Verify(ctx, zoterotest.Credential()); err != nil {
		t.Fatalf("a good key: %v", err)
	}
	if got := srv.Paths(); got[len(got)-1] != "/keys/"+zoterotest.Key {
		t.Fatalf("verify asked %q", got[len(got)-1])
	}
	other := zoterotest.Credential()
	other.UserID = "1"
	if err := c.Verify(ctx, other); !zotero.Is(err, zotero.CodeBadKey) {
		t.Fatalf("a key for another user id: %v", err)
	}
}

// Every refusal is a fixed sentence: the fixture echoes the Authorization
// header and the path (which holds the key for /keys/{key}) in its error
// bodies, and none of it may come back.
func TestErrorsNeverCarryTheKey(t *testing.T) {
	srv := zoterotest.New(t)
	c := srv.Client()
	ctx := context.Background()
	wrong := zotero.Credential{UserID: zoterotest.UserID, Key: "WRONGKEY0SECRET000000000"}
	errs := []error{
		c.Verify(ctx, wrong),
	}
	_, err := c.Search(ctx, wrong, "x", 5)
	errs = append(errs, err)
	_, err = c.Item(ctx, wrong, zoterotest.ItemWithPDF)
	errs = append(errs, err)
	_, err = c.File(ctx, wrong, "PDFK2345")
	errs = append(errs, err)
	for i, err := range errs {
		if err == nil {
			t.Fatalf("call %d: a wrong key was accepted", i)
		}
		if strings.Contains(err.Error(), "SECRET") || strings.Contains(err.Error(), "WRONGKEY") || strings.Contains(err.Error(), "http") {
			t.Fatalf("call %d: error carries the key or a URL: %q", i, err)
		}
	}
	if !zotero.Is(errs[1], zotero.CodeBadKey) {
		t.Fatalf("a refused key: %v", errs[1])
	}

	// A transport failure: Go's error names the URL, and /keys/{key} holds
	// the key.
	down := zoterotest.New(t)
	client := down.Client()
	down.Close()
	err = client.Verify(ctx, zotero.Credential{UserID: zoterotest.UserID, Key: "DOWNKEY0SECRET0000000000"})
	if err == nil || strings.Contains(err.Error(), "SECRET") || strings.Contains(err.Error(), "keys/") {
		t.Fatalf("a transport failure carries the key: %v", err)
	}
}

func TestCredentials(t *testing.T) {
	c, err := zotero.NewCredential(" 475425 ", " "+zoterotest.Key+" ")
	if err != nil || c.Secret() != "475425:"+zoterotest.Key {
		t.Fatalf("%+v %v", c, err)
	}
	if back, err := zotero.ParseCredential(c.Secret()); err != nil || back != c {
		t.Fatalf("round trip: %+v %v", back, err)
	}
	for _, bad := range [][2]string{{"", zoterotest.Key}, {"abc", zoterotest.Key}, {"475425", "short"}, {"475425", "has space in it 12345678"}, {"1/../2", zoterotest.Key}} {
		if _, err := zotero.NewCredential(bad[0], bad[1]); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
	if _, err := zotero.ParseCredential(zoterotest.Key); err == nil {
		t.Fatal("a key without its user id")
	}
}
