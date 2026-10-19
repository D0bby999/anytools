package knowledge_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"strings"
	"sync"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// The fakes the merge contract in ports.go is tested against. Phase 4 supplies
// the real implementations; if these stop compiling, the contract changed.

var (
	_ knowledge.Parser    = (*fakeParser)(nil)
	_ knowledge.Embedder  = (*fakeEmbedder)(nil)
	_ knowledge.Providers = (*fakeProviders)(nil)
)

// fakeParser returns deterministic Markdown for whatever window it is asked
// for, with correct absolute markers.
type fakeParser struct {
	name        string
	model       string
	failWith    error
	perPage     int // characters of body per page
	mu          sync.Mutex
	windows     []string
	renumber    bool
	truncateAll bool
}

func newFakeParser(name string) *fakeParser {
	return &fakeParser{name: name, model: name + "-test-model", perPage: 4000}
}

func (f *fakeParser) ProviderName() string { return f.name }

func (f *fakeParser) ParsePages(_ context.Context, req parse.PageRequest) (parse.PageResult, error) {
	f.mu.Lock()
	f.windows = append(f.windows, fmt.Sprintf("%d-%d", req.Start, req.End))
	f.mu.Unlock()

	if f.failWith != nil {
		return parse.PageResult{}, f.failWith
	}

	var sb strings.Builder
	for p := req.Start; p <= req.End; p++ {
		marker := p
		if f.renumber {
			marker = p - req.Start + 1
		}
		sb.WriteString(parse.Marker(marker))
		sb.WriteString("\n\n## Section for page ")
		fmt.Fprintf(&sb, "%d\n\n", p)
		// Distinctive per page so a test can assert which page a chunk came
		// from, and long enough to clear the short-parse floor.
		sentence := fmt.Sprintf("Page %d discusses retrieval augmented generation in detail. ", p)
		for sb.Len() < (p-req.Start+1)*f.perPage {
			sb.WriteString(sentence)
		}
		sb.WriteString("\n\n")
	}

	res := parse.PageResult{Markdown: sb.String(), Finish: parse.PageFinishStop, Model: f.model}
	if f.truncateAll {
		res.Finish = parse.PageFinishTruncated
	}
	return res, nil
}

func (f *fakeParser) calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.windows...)
}

// fakeEmbedder hashes text into a stable vector, so the same passage always
// embeds identically and a test can reason about nearest neighbours.
type fakeEmbedder struct {
	provider string
	model    string
	dims     int
	failWith error
	ragged   bool
	mu       sync.Mutex
	batches  []int
	tasks    []knowledge.EmbedTask
}

func newFakeEmbedder(model string, dims int) *fakeEmbedder {
	return &fakeEmbedder{provider: "fake", model: model, dims: dims}
}

func (f *fakeEmbedder) Model() string        { return f.model }
func (f *fakeEmbedder) ProviderName() string { return f.provider }

func (f *fakeEmbedder) Embed(_ context.Context, texts []string, task knowledge.EmbedTask) ([][]float32, int, error) {
	f.mu.Lock()
	f.batches = append(f.batches, len(texts))
	f.tasks = append(f.tasks, task)
	f.mu.Unlock()

	if f.failWith != nil {
		return nil, 0, f.failWith
	}
	out := make([][]float32, 0, len(texts))
	for _, t := range texts {
		out = append(out, hashVector(t, f.dims))
	}
	if f.ragged && len(out) > 1 {
		out = out[:len(out)-1]
	}
	return out, f.dims, nil
}

func (f *fakeEmbedder) batchSizes() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]int(nil), f.batches...)
}

func (f *fakeEmbedder) taskUsed() []knowledge.EmbedTask {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]knowledge.EmbedTask(nil), f.tasks...)
}

func hashVector(text string, dims int) []float32 {
	v := make([]float32, dims)
	h := fnv.New64a()
	for _, word := range strings.Fields(strings.ToLower(text)) {
		h.Reset()
		_, _ = h.Write([]byte(word))
		v[h.Sum64()%uint64(dims)] += 1
	}
	// Normalise so cosine behaves.
	var norm float32
	for _, x := range v {
		norm += x * x
	}
	if norm == 0 {
		v[0] = 1
		return v
	}
	inv := float32(1) / sqrt32(norm)
	for i := range v {
		v[i] *= inv
	}
	return v
}

func sqrt32(x float32) float32 {
	// Newton's method: avoids importing math for one call in a test helper.
	if x <= 0 {
		return 0
	}
	z := x
	for i := 0; i < 20; i++ {
		z = (z + x/z) / 2
	}
	return z
}

type fakeProviders struct {
	chain    []knowledge.Parser
	embedder knowledge.Embedder
	embedErr error
}

func (f *fakeProviders) ParserChain(context.Context, knowledge.UserID) ([]knowledge.Parser, error) {
	return f.chain, nil
}

func (f *fakeProviders) EmbedderFor(context.Context, knowledge.UserID) (knowledge.Embedder, error) {
	if f.embedErr != nil {
		return nil, f.embedErr
	}
	if f.embedder == nil {
		return nil, errors.New("no embedder configured")
	}
	return f.embedder, nil
}

// ── in-memory stores ───────────────────────────────────────────────────────

type memStore struct {
	mu   sync.Mutex
	kbs  map[uuid.UUID]*knowledge.KB
	docs map[uuid.UUID]*knowledge.Document
}

func newMemStore() *memStore {
	return &memStore{kbs: map[uuid.UUID]*knowledge.KB{}, docs: map[uuid.UUID]*knowledge.Document{}}
}

func (m *memStore) CreateKB(_ context.Context, userID uuid.UUID, name string) (*knowledge.KB, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	kb := &knowledge.KB{ID: uuid.New(), UserID: userID, Name: name, FTSConfig: "english"}
	m.kbs[kb.ID] = kb
	return kb, nil
}

func (m *memStore) ListKBs(context.Context, uuid.UUID) ([]knowledge.KBSummary, error) {
	return nil, nil
}

func (m *memStore) GetKB(_ context.Context, userID, kbID uuid.UUID) (*knowledge.KB, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	kb, ok := m.kbs[kbID]
	if !ok || kb.UserID != userID {
		return nil, errors.New("no access")
	}
	copy := *kb
	return &copy, nil
}

func (m *memStore) DeleteKB(_ context.Context, _ uuid.UUID, kbID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.kbs, kbID)
	for id, d := range m.docs {
		if d.KBID == kbID {
			delete(m.docs, id)
		}
	}
	return nil
}

func (m *memStore) PinEmbeddingRoute(_ context.Context, userID, kbID uuid.UUID, model string, dims int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	kb := m.kbs[kbID]
	if kb == nil {
		return errors.New("no kb")
	}
	if kb.EmbeddingModel != "" && (kb.EmbeddingModel != model || kb.Dims != dims) {
		kb.NeedsReembed = true
	}
	kb.EmbeddingModel, kb.Dims = model, dims
	return nil
}

func (m *memStore) ClearNeedsReembed(_ context.Context, _, kbID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if kb := m.kbs[kbID]; kb != nil {
		kb.NeedsReembed = false
	}
	return nil
}

func (m *memStore) CreateDocument(_ context.Context, d knowledge.Document) (*knowledge.Document, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d.ID = uuid.New()
	d.Status = knowledge.StatusQueued
	d.Version = 1
	d.ProcessedBy = []byte("{}")
	m.docs[d.ID] = &d
	copy := d
	return &copy, nil
}

func (m *memStore) ListDocuments(_ context.Context, userID, kbID uuid.UUID) ([]knowledge.Document, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []knowledge.Document
	for _, d := range m.docs {
		if d.UserID == userID && d.KBID == kbID {
			out = append(out, *d)
		}
	}
	return out, nil
}

func (m *memStore) GetDocument(_ context.Context, userID, docID uuid.UUID) (*knowledge.Document, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.docs[docID]
	if !ok || d.UserID != userID {
		return nil, errors.New("no access")
	}
	copy := *d
	return &copy, nil
}

// SetDocumentStatus mirrors the REAL store's terminal guard. A fake that is
// more permissive than the thing it stands in for is a fake that makes the
// service look correct on a path the database would have refused.
func (m *memStore) SetDocumentStatus(_ context.Context, _, docID uuid.UUID, status, errMsg string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	d := m.docs[docID]
	if d == nil {
		return errors.New("no doc")
	}
	settled := d.Status == knowledge.StatusReady || d.Status == knowledge.StatusFailed
	goingTerminal := status == knowledge.StatusReady || status == knowledge.StatusFailed
	if settled && !goingTerminal {
		return knowledge.ErrDocumentFinal
	}
	d.Status = status
	if status == knowledge.StatusFailed {
		d.Error = errMsg
	} else {
		d.Error = ""
	}
	return nil
}

// RequeueDocument mirrors the real store: a retryable failure goes back on the
// queue carrying its reason, and a terminal row still refuses to move.
func (m *memStore) RequeueDocument(_ context.Context, _, docID uuid.UUID, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	d := m.docs[docID]
	if d == nil {
		return errors.New("no doc")
	}
	if d.Status == knowledge.StatusReady || d.Status == knowledge.StatusFailed {
		return knowledge.ErrDocumentFinal
	}
	d.Status = knowledge.StatusQueued
	d.Error = reason
	return nil
}

// ResetDocumentForReprocessing mirrors the real store: any row, queued again,
// with a new version.
func (m *memStore) ResetDocumentForReprocessing(_ context.Context, _, docID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	d := m.docs[docID]
	if d == nil {
		return errors.New("no doc")
	}
	d.Status, d.Error = knowledge.StatusQueued, ""
	d.Version++
	return nil
}

// finishGuard mirrors the real store: only a document that is being worked on
// can be finished, so a straggler cannot flip a failed document to ready.
func (m *memStore) finishGuard(d *knowledge.Document) error {
	if d.Status != knowledge.StatusParsing && d.Status != knowledge.StatusIndexing {
		return knowledge.ErrDocumentFinal
	}
	return nil
}

// settle puts a document into a terminal state behind the service's back, the
// way a reaper on another goroutine would.
func (m *memStore) settle(docID uuid.UUID, status, reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if d := m.docs[docID]; d != nil {
		d.Status = status
		d.Error = reason
	}
}

func (m *memStore) FinishDocument(_ context.Context, _, docID uuid.UUID, pages int, pb knowledge.ProcessedBy, path string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	d := m.docs[docID]
	if d == nil {
		return errors.New("no doc")
	}
	if err := m.finishGuard(d); err != nil {
		return err
	}
	d.Status = knowledge.StatusReady
	d.Error = ""
	d.PageCount = pages
	d.ParsedMarkdownPath = path
	d.ProcessedBy = mustJSON(pb)
	return nil
}

func (m *memStore) RecordProcessedBy(_ context.Context, _, docID uuid.UUID, pb knowledge.ProcessedBy) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if d := m.docs[docID]; d != nil {
		d.ProcessedBy = mustJSON(pb)
	}
	return nil
}

func (m *memStore) DeleteDocument(_ context.Context, _, _, docID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.docs, docID)
	return nil
}

func (m *memStore) ListDocumentIDs(_ context.Context, userID, kbID uuid.UUID) ([]uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []uuid.UUID
	for id, d := range m.docs {
		if d.UserID == userID && d.KBID == kbID && d.Status == knowledge.StatusReady {
			out = append(out, id)
		}
	}
	return out, nil
}

type memChunks struct {
	mu   sync.Mutex
	rows map[uuid.UUID][]knowledge.StoredChunk
}

func newMemChunks() *memChunks {
	return &memChunks{rows: map[uuid.UUID][]knowledge.StoredChunk{}}
}

func (m *memChunks) ReplaceDocumentChunks(_ context.Context, _, _, docID uuid.UUID, chunks []knowledge.StoredChunk) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rows[docID] = chunks
	return nil
}

func (m *memChunks) DeleteDocumentChunks(_ context.Context, _, docID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rows, docID)
	return nil
}

func (m *memChunks) ChunkTexts(_ context.Context, _, docID uuid.UUID) ([]knowledge.StoredChunk, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rows[docID], nil
}

func (m *memChunks) get(docID uuid.UUID) []knowledge.StoredChunk {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rows[docID]
}

type memJobs struct {
	mu       sync.Mutex
	enqueued []string
	failWith error
}

func (m *memJobs) Enqueue(_ context.Context, _ uuid.UUID, kind string, _ any, _ int) (uuid.UUID, error) {
	if m.failWith != nil {
		return uuid.Nil, m.failWith
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.enqueued = append(m.enqueued, kind)
	return uuid.New(), nil
}

type memBlobs struct {
	mu        sync.Mutex
	originals map[string][]byte
	parsed    map[string]string
	// getErr fails every read of an original (drive-user-storage phase 3).
	getErr error
}

func newMemBlobs() *memBlobs {
	return &memBlobs{originals: map[string][]byte{}, parsed: map[string]string{}}
}

func (m *memBlobs) PutOriginal(_ context.Context, userID uuid.UUID, data []byte) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	h := fnv.New64a()
	_, _ = h.Write(data)
	digest := fmt.Sprintf("%064x", h.Sum64())
	m.originals[userID.String()+"/"+digest] = data
	return digest, nil
}

func (m *memBlobs) GetOriginal(_ context.Context, userID uuid.UUID, digest string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.getErr != nil {
		return nil, m.getErr
	}
	b, ok := m.originals[userID.String()+"/"+digest]
	if !ok {
		return nil, errors.New("not found")
	}
	return b, nil
}

func (m *memBlobs) OpenOriginal(_ context.Context, userID uuid.UUID, digest string) (*blob.File, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.originals[userID.String()+"/"+digest]
	if !ok {
		return nil, blob.ErrNotFound
	}
	return &blob.File{ReadSeekCloser: nopSeekCloser{bytes.NewReader(b)}, Size: int64(len(b))}, nil
}

type nopSeekCloser struct{ *bytes.Reader }

func (nopSeekCloser) Close() error { return nil }

func (m *memBlobs) PutParsed(_ context.Context, userID, docID uuid.UUID, version int, md string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	path := fmt.Sprintf("parsed/%s/%s-v%d.md", userID, docID, version)
	m.parsed[path] = md
	return path, nil
}

func (m *memBlobs) GetParsed(_ context.Context, path string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	md, ok := m.parsed[path]
	if !ok {
		return "", errors.New("not found")
	}
	return md, nil
}

func (m *memBlobs) DeleteDocument(context.Context, uuid.UUID, uuid.UUID) error { return nil }
func (m *memBlobs) DeleteUser(context.Context, uuid.UUID) error                { return nil }

func (m *memBlobs) DeleteOriginal(_ context.Context, userID uuid.UUID, digest string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.originals, userID.String()+"/"+digest)
	return nil
}

func (m *memStore) OriginalReferenced(_ context.Context, userID uuid.UUID, sha string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, d := range m.docs {
		if d.UserID == userID && d.SHA256 == sha {
			return true, nil
		}
	}
	return false, nil
}
