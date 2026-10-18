package knowledge_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// Up-methods phase 16: photos of pages and notes as sources.

// photo is a fixture of the given type whose bytes carry its name, so a
// reader can say which photo it was sent.
func photo(kind, name string) []byte {
	head := map[string]string{
		"jpeg": "\xff\xd8\xff\xe0\x00\x10JFIF\x00",
		"png":  "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR",
		"webp": "RIFF\x24\x00\x00\x00WEBPVP8 ",
		"heic": "\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic",
	}[kind]
	return []byte(head + "|" + name + "|")
}

// photoReader reads a photo fixture back as the name inside it.
type photoReader struct {
	name     string
	declines map[string]bool // types this lane does not take
	failOn   string          // a photo name this lane fails on, once
	mu       sync.Mutex
	sent     []string
}

func (r *photoReader) ProviderName() string { return r.name }

func (r *photoReader) ParsePages(_ context.Context, req parse.PageRequest) (parse.PageResult, error) {
	if r.declines[req.MIME] {
		return parse.PageResult{}, parse.ErrImageNotAccepted
	}
	parts := bytes.Split(req.Data, []byte("|"))
	name := string(parts[1])
	r.mu.Lock()
	r.sent = append(r.sent, fmt.Sprintf("%s:%s:%d", name, req.MIME, req.Start))
	fail := r.failOn == name
	if fail {
		r.failOn = ""
	}
	r.mu.Unlock()
	if fail {
		return parse.PageResult{}, errors.New("upstream 503")
	}
	// No heading: the splitter would cut at one anyway, and a page that
	// starts with a table or a line of handwriting has none.
	text := fmt.Sprintf("The %s page. Handwritten notes about %s photosynthesis, with one word [illegible].", name, name)
	return parse.PageResult{Markdown: text, Finish: parse.PageFinishStop, Model: r.name + "-vision"}, nil
}

func (r *photoReader) calls() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.sent...)
}

// objectBlobs adds blob.ObjectStore to memBlobs, as blob.Local has.
type objectBlobs struct {
	*memBlobs
	mu      sync.Mutex
	objects map[string][]byte
}

var _ blob.ObjectStore = (*objectBlobs)(nil)

func newObjectBlobs() *objectBlobs {
	return &objectBlobs{memBlobs: newMemBlobs(), objects: map[string][]byte{}}
}

func objKey(u uuid.UUID, ns string, id uuid.UUID) string {
	return u.String() + "/" + ns + "/" + id.String()
}

func (o *objectBlobs) PutObject(_ context.Context, u uuid.UUID, ns string, id uuid.UUID, data []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.objects[objKey(u, ns, id)] = append([]byte(nil), data...)
	return nil
}

func (o *objectBlobs) GetObject(_ context.Context, u uuid.UUID, ns string, id uuid.UUID) ([]byte, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	data, ok := o.objects[objKey(u, ns, id)]
	if !ok {
		return nil, errors.New("not found")
	}
	return data, nil
}

func (o *objectBlobs) WriteObject(ctx context.Context, u uuid.UUID, ns string, id uuid.UUID, write func(io.Writer) error) error {
	return errors.New("unused")
}

func (o *objectBlobs) OpenObject(context.Context, uuid.UUID, string, uuid.UUID) (*blob.File, error) {
	return nil, errors.New("unused")
}

func (o *objectBlobs) DeleteObject(_ context.Context, u uuid.UUID, ns string, id uuid.UUID) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.objects, objKey(u, ns, id))
	return nil
}

func (o *objectBlobs) count() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.objects)
}

func photoHarness(t *testing.T, chain ...knowledge.Parser) (*harness, *objectBlobs) {
	t.Helper()
	h := newHarness(t, &fakeProviders{chain: chain, embedder: newFakeEmbedder("text-embedding-3-small", 1536)})
	blobs := newObjectBlobs()
	h.blobs = blobs.memBlobs
	h.svc = knowledge.NewService(knowledge.Config{
		Store: h.store, Chunks: h.chunks, Blobs: blobs, Jobs: h.jobs,
		Providers: &fakeProviders{chain: chain, embedder: newFakeEmbedder("text-embedding-3-small", 1536)},
		Events:    h.events,
	})
	return h, blobs
}

func TestAPhotoIsSniffedAndCappedAtTwentyMegabytes(t *testing.T) {
	h, _ := photoHarness(t, &photoReader{name: "gemini"})
	ctx := context.Background()

	pad := func(b []byte, size int) []byte { return append(append([]byte{}, b...), make([]byte, size-len(b))...) }
	if _, err := h.svc.Upload(ctx, h.user, h.kb.ID, "page.jpg", pad(photo("jpeg", "a"), parse.MaxPhotoBytes+1)); !errors.Is(err, parse.ErrPhotoTooLarge) {
		t.Fatalf("20 MB + 1 byte: %v", err)
	}
	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "page.jpg", pad(photo("png", "a"), parse.MaxPhotoBytes))
	if err != nil {
		t.Fatalf("exactly 20 MB: %v", err)
	}
	// Stored as what the bytes are, not as what the name says.
	if res.Document.MIME != "image/png" || res.Document.PageCount != 1 {
		t.Fatalf("document = %s, %d pages", res.Document.MIME, res.Document.PageCount)
	}
	if _, err := h.svc.Upload(ctx, h.user, h.kb.ID, "page.jpg", []byte("%PDF-1.4 renamed")); !errors.Is(err, parse.ErrUnsupportedType) {
		t.Fatalf("a PDF named .jpg: %v", err)
	}
	if n := len(h.store.docs); n != 1 {
		t.Fatalf("%d documents, want only the accepted photo", n)
	}
}

func TestThreePhotosBecomeOneDocumentWithThreePagesInOrder(t *testing.T) {
	reader := &photoReader{name: "gemini"}
	h, blobs := photoHarness(t, reader)
	ctx := context.Background()

	res, err := h.svc.UploadPhotos(ctx, h.user, h.kb.ID, []knowledge.PhotoFile{
		{Name: "IMG_3.jpg", Data: photo("jpeg", "third")},
		{Name: "IMG_1.png", Data: photo("png", "first")},
		{Name: "IMG_2.heic", Data: photo("heic", "second")},
	})
	if err != nil {
		t.Fatal(err)
	}
	doc := res.Document
	if doc.MIME != parse.MimePhotoSet || doc.PageCount != 3 || doc.Title != "IMG_3.jpg" {
		t.Fatalf("document = %s, %d pages, %q", doc.MIME, doc.PageCount, doc.Title)
	}
	if len(h.store.docs) != 1 || len(h.jobs.enqueued) != 1 {
		t.Fatalf("%d documents and %d jobs, want one of each", len(h.store.docs), len(h.jobs.enqueued))
	}

	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{DocumentID: doc.ID, KBID: h.kb.ID}, lastAttempt); err != nil {
		t.Fatal(err)
	}
	// The order chosen, not the names' order; each photo with its own type.
	if got := strings.Join(reader.calls(), ","); got != "third:image/jpeg:1,first:image/png:2,second:image/heic:3" {
		t.Fatalf("photos were read as %s", got)
	}

	content, err := h.svc.DocumentContent(ctx, h.user, doc.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if content.Document.Status != knowledge.StatusReady || len(content.Pages) != 3 {
		t.Fatalf("status %s, %d pages", content.Document.Status, len(content.Pages))
	}
	for i, name := range []string{"third", "first", "second"} {
		if p := content.Pages[i]; p.Number != i+1 || !strings.Contains(p.Markdown, "The "+name+" page") {
			t.Errorf("page %d = %d %q", i+1, p.Number, p.Markdown)
		}
	}
	pb := string(content.Document.ProcessedBy)
	if !strings.Contains(pb, `"parser":"gemini"`) || !strings.Contains(pb, `"model":"gemini-vision"`) {
		t.Errorf("processed_by = %s", pb)
	}
	// Every passage cites the page its photo is, and no passage spans two
	// photos, however short they are.
	stored := h.chunks.get(doc.ID)
	if len(stored) != 3 {
		t.Errorf("%d passages for three short photos, want one each", len(stored))
	}
	for _, c := range stored {
		if c.PageStart != c.PageEnd {
			t.Errorf("a passage spans photos %d-%d", c.PageStart, c.PageEnd)
		}
		for i, name := range []string{"third", "first", "second"} {
			if strings.Contains(c.Text, "The "+name+" page") && (c.PageStart != i+1 || c.PageEnd != i+1) {
				t.Errorf("a passage of photo %d cites pages %d-%d", i+1, c.PageStart, c.PageEnd)
			}
		}
	}

	// The reading view gets each page's own photo.
	_, second, err := h.svc.DocumentPhoto(ctx, h.user, doc.ID, 2)
	if err != nil || second.MIME != "image/png" || !bytes.Equal(second.Data, photo("png", "first")) {
		t.Fatalf("photo 2 = %s %v", second.MIME, err)
	}
	for _, page := range []int{0, 4} {
		if _, _, err := h.svc.DocumentPhoto(ctx, h.user, doc.ID, page); !errors.Is(err, knowledge.ErrNotAPhoto) {
			t.Errorf("photo %d: %v", page, err)
		}
	}
	// Indexed: the kept readings are gone.
	if n := blobs.count(); n != 0 {
		t.Errorf("%d page readings left behind", n)
	}
}

func TestARetryDoesNotPayForAPhotoAlreadyRead(t *testing.T) {
	reader := &photoReader{name: "gemini", failOn: "c"}
	h, blobs := photoHarness(t, reader)
	ctx := context.Background()

	res, err := h.svc.UploadPhotos(ctx, h.user, h.kb.ID, []knowledge.PhotoFile{
		{Name: "a.jpg", Data: photo("jpeg", "a")},
		{Name: "b.jpg", Data: photo("jpeg", "b")},
		{Name: "c.jpg", Data: photo("jpeg", "c")},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := knowledge.ParseJobPayload{DocumentID: res.Document.ID, KBID: h.kb.ID}
	if err := h.svc.ProcessDocument(ctx, h.user, payload, knowledge.Attempt{Number: 1, Max: 3}); err == nil || knowledge.IsTerminal(err) {
		t.Fatalf("an upstream 503 on photo 3: %v (want a retryable error)", err)
	}
	if n := blobs.count(); n != 2 {
		t.Fatalf("%d readings kept after the failure, want 2", n)
	}
	if err := h.svc.ProcessDocument(ctx, h.user, payload, knowledge.Attempt{Number: 2, Max: 3}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(reader.calls(), ","); got != "a:image/jpeg:1,b:image/jpeg:2,c:image/jpeg:3,c:image/jpeg:3" {
		t.Fatalf("calls = %s (photos 1 and 2 must not be sent twice)", got)
	}
	content, _ := h.svc.DocumentContent(ctx, h.user, res.Document.ID, 0)
	if len(content.Pages) != 3 || !strings.Contains(content.Pages[0].Markdown, "The a page") {
		t.Fatalf("pages after the retry = %+v", content.Pages)
	}
}

func TestAPhotoFallsToTheLaneThatReadsIt(t *testing.T) {
	openai := &photoReader{name: "openai", declines: map[string]bool{parse.MimeHEIC: true}}
	gemini := &photoReader{name: "gemini"}
	h, _ := photoHarness(t, openai, gemini)
	ctx := context.Background()

	res, err := h.svc.UploadPhotos(ctx, h.user, h.kb.ID, []knowledge.PhotoFile{
		{Name: "a.jpg", Data: photo("jpeg", "a")},
		{Name: "b.heic", Data: photo("heic", "b")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{DocumentID: res.Document.ID, KBID: h.kb.ID}, lastAttempt); err != nil {
		t.Fatal(err)
	}
	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	pb := string(doc.ProcessedBy)
	if !strings.Contains(pb, `"model":"openai-vision"`) || !strings.Contains(pb, "page 2 by gemini gemini-vision") ||
		!strings.Contains(pb, `"downgraded":true`) {
		t.Errorf("processed_by = %s", pb)
	}

	// Only lanes that cannot take a HEIC: failed for good, with the sentence.
	h2, _ := photoHarness(t, &photoReader{name: "openai", declines: map[string]bool{parse.MimeHEIC: true}})
	res, err = h2.svc.Upload(ctx, h2.user, h2.kb.ID, "b.heic", photo("heic", "b"))
	if err != nil {
		t.Fatal(err)
	}
	err = h2.svc.ProcessDocument(ctx, h2.user, knowledge.ParseJobPayload{DocumentID: res.Document.ID, KBID: h2.kb.ID}, knowledge.Attempt{Number: 1, Max: 3})
	doc, _ = h2.svc.GetDocument(ctx, h2.user, res.Document.ID)
	if !knowledge.IsTerminal(err) || doc.Status != knowledge.StatusFailed || !strings.Contains(doc.Error, "Gemini reads HEIC") {
		t.Errorf("HEIC with no lane for it: %v, %s %q", err, doc.Status, doc.Error)
	}
}

func TestAPhotoWithNoParseRouteSaysWhatToDo(t *testing.T) {
	h, _ := photoHarness(t)
	ctx := context.Background()
	res, err := h.svc.Upload(ctx, h.user, h.kb.ID, "notes.png", photo("png", "notes"))
	if err != nil {
		t.Fatal(err)
	}
	err = h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{DocumentID: res.Document.ID, KBID: h.kb.ID}, knowledge.Attempt{Number: 1, Max: 3})
	doc, _ := h.svc.GetDocument(ctx, h.user, res.Document.ID)
	if !knowledge.IsTerminal(err) || doc.Status != knowledge.StatusFailed || !strings.Contains(doc.Error, "Route a model to Parse documents") {
		t.Errorf("no parse route: %v, %s %q", err, doc.Status, doc.Error)
	}
}

func TestAPhotoSetRefusesWhatIsNotAPhotoSet(t *testing.T) {
	h, _ := photoHarness(t, &photoReader{name: "gemini"})
	ctx := context.Background()

	many := make([]knowledge.PhotoFile, parse.MaxPhotosPerDocument+1)
	for i := range many {
		many[i] = knowledge.PhotoFile{Name: fmt.Sprintf("p%d.jpg", i), Data: photo("jpeg", fmt.Sprint(i))}
	}
	if _, err := h.svc.UploadPhotos(ctx, h.user, h.kb.ID, many); !errors.Is(err, parse.ErrTooManyPhotos) {
		t.Errorf("31 photos: %v", err)
	}
	mixed := []knowledge.PhotoFile{{Name: "a.jpg", Data: photo("jpeg", "a")}, {Name: "b.pdf", Data: ragPDF(t)}}
	if _, err := h.svc.UploadPhotos(ctx, h.user, h.kb.ID, mixed); !errors.Is(err, parse.ErrUnsupportedType) {
		t.Errorf("a PDF among the photos: %v", err)
	}
	big := make([]knowledge.PhotoFile, 3)
	for i := range big {
		data := append(photo("jpeg", fmt.Sprint(i)), make([]byte, 18<<20)...)
		big[i] = knowledge.PhotoFile{Name: "big.jpg", Data: data}
	}
	if _, err := h.svc.UploadPhotos(ctx, h.user, h.kb.ID, big); !errors.Is(err, knowledge.ErrPhotoSetTooLarge) {
		t.Errorf("54 MB of photos: %v", err)
	}
	if n := len(h.store.docs); n != 0 {
		t.Errorf("%d documents created by refused sets", n)
	}
	if _, err := h.svc.UploadPhotos(ctx, h.user, h.kb.ID, many[:parse.MaxPhotosPerDocument]); err != nil {
		t.Errorf("30 photos: %v", err)
	}
}

func TestDeletingAPhotoDocumentDropsItsKeptReadings(t *testing.T) {
	reader := &photoReader{name: "gemini", failOn: "b"}
	h, blobs := photoHarness(t, reader)
	ctx := context.Background()
	res, _ := h.svc.UploadPhotos(ctx, h.user, h.kb.ID, []knowledge.PhotoFile{
		{Name: "a.jpg", Data: photo("jpeg", "a")}, {Name: "b.jpg", Data: photo("jpeg", "b")},
	})
	_ = h.svc.ProcessDocument(ctx, h.user, knowledge.ParseJobPayload{DocumentID: res.Document.ID, KBID: h.kb.ID}, knowledge.Attempt{Number: 1, Max: 3})
	if blobs.count() != 1 {
		t.Fatalf("%d kept readings, want 1", blobs.count())
	}
	if err := h.svc.DeleteDocument(ctx, h.user, h.kb.ID, res.Document.ID); err != nil {
		t.Fatal(err)
	}
	if n := blobs.count(); n != 0 {
		t.Errorf("%d readings left after the delete", n)
	}
}
