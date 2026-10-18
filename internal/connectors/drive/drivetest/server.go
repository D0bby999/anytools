// Package drivetest is a stateful fake of the parts of Google Drive v3 that
// Drive storage uses (drive-user-storage phase 1): files.list for folders by
// appProperties, files.create for folders, resumable uploads, files.get for
// metadata and for media with a Range header, and files.delete.
//
// The response bodies are the fixtures under testdata/, shaped from Google's
// Drive v3 documentation, with `__ID__`, `__SIZE__`, `__MD5__` and
// `__TRASHED__` filled in from what the fake was sent. No Google credentials
// exist for this project, so nothing here was recorded from a live account.
//
// It is stateful rather than a list of canned answers because a resumable
// upload is: what a status probe answers depends on how much of a cut-off
// chunk arrived. It does not import package drive, so drive's own tests can
// use it.
package drivetest

import (
	"crypto/md5"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
)

//go:embed testdata/*.json
var fixtures embed.FS

// AccessToken is the bearer token every request must carry. It is shaped
// like Google's so redaction tests catch it by shape too.
const AccessToken = "ya29.drivetest-access-SECRET"

// ChunkUnit is Google's resumable chunk granularity, 256 KiB.
const ChunkUnit = 256 << 10

const folderMIME = "application/vnd.google-apps.folder"

// Options change how the fake answers. Set them with Configure.
type Options struct {
	// CutChunks names chunk numbers (1-based, counted over the server's
	// life) that are cut off half way; whole 256 KiB units that arrived are
	// kept, as Drive keeps what it persisted.
	CutChunks map[int]bool
	// CorruptMD5 makes a finished upload report another checksum.
	CorruptMD5 bool
	// Quota refuses every upload session with storageQuotaExceeded.
	Quota bool
	// Echo500 answers everything with a 500 whose message echoes the
	// request's Authorization header.
	Echo500 bool
	// ForeignSession hands out session URLs on another host.
	ForeignSession bool
	// SessionGone answers the next chunk with 404, as an expired session.
	SessionGone bool
	// FailOnDelete fails the test on any files.delete (account deletion must
	// delete nothing in the learner's Drive, owner decision 1).
	FailOnDelete bool
	// CorruptSHA256 makes files.get report another sha256Checksum than the
	// stored bytes have (drive-user-storage phase 2: a move checks it).
	CorruptSHA256 bool
	// NoSHA256 leaves sha256Checksum out of files.get, as Drive may.
	NoSHA256 bool
	// QuotaOnChunk refuses every chunk with storageQuotaExceeded, as Drive
	// does when the quota runs out part way through an upload (phase 3).
	QuotaOnChunk bool
	// Unauthorized answers the next n requests 401 authError, as Drive does
	// for an access token revoked before its expiry (phase 3).
	Unauthorized int
	// Requests, when set, sees every request before it is answered, under
	// the fake's lock.
	Requests func(r *http.Request)
}

// Stats counts what reached the fake.
type Stats struct {
	Lists, Creates, Sessions, Chunks, Probes, Deletes int
	// FileLists counts file searches by appProperties (phase 2's moves).
	FileLists int
	// FolderChecks are files.get calls on a folder; Unauthorized counts the
	// 401s answered (phase 3).
	FolderChecks, Unauthorized int
	// Ranges are the Range headers of media reads, in order.
	Ranges []string
}

// Upload is what a file was created with.
type Upload struct {
	Name          string            `json:"name"`
	MIME          string            `json:"mimeType"`
	Parents       []string          `json:"parents"`
	AppProperties map[string]string `json:"appProperties"`
}

type folder struct{ user, role, parent string }

type session struct {
	meta     Upload
	size     int64
	received []byte
}

type file struct {
	meta Upload
	data []byte
}

// Server is the fake.
type Server struct {
	t   testing.TB
	srv *httptest.Server

	mu       sync.Mutex
	opts     Options
	stats    Stats
	n        int
	folders  map[string]folder
	files    map[string]*file
	trashed  map[string]bool
	sessions map[string]*session
}

// New starts the fake; it stops with the test.
func New(t testing.TB) *Server {
	t.Helper()
	s := &Server{t: t, folders: map[string]folder{}, files: map[string]*file{},
		trashed: map[string]bool{}, sessions: map[string]*session{}}
	s.srv = httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.srv.Close)
	return s
}

// URL is the fake's origin; Host is its host:port, for an allowlist.
func (s *Server) URL() string  { return s.srv.URL }
func (s *Server) Host() string { return strings.TrimPrefix(s.srv.URL, "http://") }

// DriveBase and UploadBase stand in for Google's two endpoints.
func (s *Server) DriveBase() string  { return s.srv.URL + "/drive/v3" }
func (s *Server) UploadBase() string { return s.srv.URL + "/upload/drive/v3" }

// Client reaches the fake.
func (s *Server) Client() *http.Client { return s.srv.Client() }

// Raw is the underlying server, for a test that swaps its handler.
func (s *Server) Raw() *httptest.Server { return s.srv }

// Configure changes the options under the fake's lock.
func (s *Server) Configure(f func(*Options)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.opts.CutChunks == nil {
		s.opts.CutChunks = map[int]bool{}
	}
	f(&s.opts)
}

// Stats is a copy of the counters.
func (s *Server) Stats() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.stats
	out.Ranges = append([]string(nil), s.stats.Ranges...)
	return out
}

// File is a stored file's bytes and what it was created with.
func (s *Server) File(id string) ([]byte, Upload, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.files[id]
	if !ok {
		return nil, Upload{}, false
	}
	return append([]byte(nil), f.data...), f.meta, true
}

// FileCount is how many files (not folders) the fake holds.
func (s *Server) FileCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.files)
}

// Folder is a folder's role and parent.
func (s *Server) Folder(id string) (role, parent string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.folders[id]
	return f.role, f.parent, ok
}

// Trash marks a file or a folder trashed, as the learner might in Drive. A
// trashed folder's contents are trashed with it.
func (s *Server) Trash(id string, trashed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trashed[id] = trashed
}

// RemoveFolder deletes a folder for good, as the learner might after
// emptying their trash. What was in it goes with it.
func (s *Server) RemoveFolder(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.folders, id)
	for fid, f := range s.files {
		for _, p := range f.meta.Parents {
			if p == id {
				delete(s.files, fid)
			}
		}
	}
}

// FolderCount is how many folders the fake holds, trashed or not.
func (s *Server) FolderCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.folders)
}

// folderTrashed is a folder trashed itself or through a trashed parent, as
// Drive reports it.
func (s *Server) folderTrashed(id string) bool {
	for range 8 {
		if s.trashed[id] {
			return true
		}
		f, ok := s.folders[id]
		if !ok || f.parent == "" {
			return false
		}
		id = f.parent
	}
	return false
}

func (s *Server) fileTrashed(id string, f *file) bool {
	if s.trashed[id] {
		return true
	}
	for _, p := range f.meta.Parents {
		if s.folderTrashed(p) {
			return true
		}
	}
	return false
}

// Remove deletes a file as the learner might, outside AnyTools.
func (s *Server) Remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.files, id)
}

func (s *Server) fixture(name string, vars map[string]string) []byte {
	b, err := fixtures.ReadFile("testdata/" + name)
	if err != nil {
		s.t.Errorf("fixture %s: %v", name, err)
		return nil
	}
	out := string(b)
	for k, v := range vars {
		out = strings.ReplaceAll(out, k, v)
	}
	return []byte(out)
}

func writeJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json; charset=UTF-8")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func (s *Server) newID(prefix string) string {
	s.n++
	return fmt.Sprintf("%s%04dAbC_-", prefix, s.n)
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.opts.Echo500 {
		writeJSON(w, 500, []byte(`{"error":{"code":500,"message":"backend said: `+r.Header.Get("Authorization")+`"}}`))
		return
	}
	if s.opts.Requests != nil {
		s.opts.Requests(r)
	}
	if s.opts.Unauthorized > 0 {
		s.opts.Unauthorized--
		s.stats.Unauthorized++
		writeJSON(w, 401, s.fixture("error_401_auth.json", nil))
		return
	}
	if got := r.Header.Get("Authorization"); got != "Bearer "+AccessToken {
		s.t.Errorf("%s %s: Authorization = %q", r.Method, r.URL.Path, got)
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/drive/v3/files":
		s.list(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/drive/v3/files":
		s.createFolder(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/upload/drive/v3/files":
		s.openSession(w, r)
	case r.Method == http.MethodPut && r.URL.Path == "/upload/drive/v3/files":
		s.chunk(w, r)
	case strings.HasPrefix(r.URL.Path, "/drive/v3/files/"):
		s.file(w, r, strings.TrimPrefix(r.URL.Path, "/drive/v3/files/"))
	default:
		s.t.Errorf("drivetest: unexpected request %s %s", r.Method, r.URL.Path)
		http.Error(w, "unexpected", http.StatusTeapot)
	}
}

// list answers a folder search by appProperties and parent.
func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if strings.Contains(q, "key='longplay_kind'") {
		s.listFiles(w, q)
		return
	}
	s.stats.Lists++
	if !strings.Contains(q, "trashed = false") || !strings.Contains(q, "mimeType = '"+folderMIME+"'") {
		s.t.Errorf("drivetest: folder search %q", q)
	}
	for id, f := range s.folders {
		if s.folderTrashed(id) {
			continue
		}
		if strings.Contains(q, "key='longplay_user' and value='"+f.user+"'") &&
			strings.Contains(q, "key='longplay_role' and value='"+f.role+"'") &&
			(f.parent == "" || strings.Contains(q, "'"+f.parent+"' in parents")) {
			writeJSON(w, 200, s.fixture("folders_found.json", map[string]string{"__ID__": id}))
			return
		}
	}
	writeJSON(w, 200, s.fixture("folders_none.json", nil))
}

func (s *Server) createFolder(w http.ResponseWriter, r *http.Request) {
	s.stats.Creates++
	var meta Upload
	if err := json.NewDecoder(r.Body).Decode(&meta); err != nil {
		s.t.Errorf("drivetest: folder body: %v", err)
	}
	role, user := meta.AppProperties["longplay_role"], meta.AppProperties["longplay_user"]
	if meta.MIME != folderMIME || role == "" || user == "" {
		s.t.Errorf("drivetest: folder created as %+v", meta)
	}
	parent := ""
	if len(meta.Parents) == 1 {
		parent = meta.Parents[0]
	}
	if (role == "root") != (parent == "") {
		s.t.Errorf("drivetest: folder %q has parents %v", meta.Name, meta.Parents)
	}
	id := s.newID("folder")
	s.folders[id] = folder{user: user, role: role, parent: parent}
	writeJSON(w, 200, s.fixture("folder_created.json", map[string]string{"__ID__": id}))
}

func (s *Server) openSession(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("uploadType") != "resumable" {
		s.t.Errorf("drivetest: uploadType = %q", r.URL.Query().Get("uploadType"))
	}
	if s.opts.Quota {
		writeJSON(w, 403, s.fixture("error_403_storage_quota.json", nil))
		return
	}
	size, err := strconv.ParseInt(r.Header.Get("X-Upload-Content-Length"), 10, 64)
	if err != nil {
		s.t.Errorf("drivetest: X-Upload-Content-Length %q", r.Header.Get("X-Upload-Content-Length"))
	}
	var meta Upload
	if err := json.NewDecoder(r.Body).Decode(&meta); err != nil {
		s.t.Errorf("drivetest: upload metadata: %v", err)
	}
	if len(meta.Parents) != 1 {
		s.t.Errorf("drivetest: upload with parents %v", meta.Parents)
	} else if _, ok := s.folders[meta.Parents[0]]; !ok {
		s.t.Errorf("drivetest: upload into %q, which is not a folder AnyTools made", meta.Parents[0])
	} else if s.folderTrashed(meta.Parents[0]) {
		s.t.Errorf("drivetest: upload into %q, a folder in the learner's trash", meta.Parents[0])
	}
	s.stats.Sessions++
	id := s.newID("session")
	s.sessions[id] = &session{meta: meta, size: size}
	origin := s.srv.URL
	if s.opts.ForeignSession {
		origin = "http://upload.example.com"
	}
	w.Header().Set("Location", origin+"/upload/drive/v3/files?uploadType=resumable&upload_id="+id)
	w.WriteHeader(http.StatusOK)
}

// chunk takes one PUT to a session: a chunk, or a status probe.
func (s *Server) chunk(w http.ResponseWriter, r *http.Request) {
	ses := s.sessions[r.URL.Query().Get("upload_id")]
	if ses == nil || s.opts.SessionGone {
		s.opts.SessionGone = false
		writeJSON(w, 404, s.fixture("error_404_file.json", map[string]string{"__ID__": "session"}))
		return
	}
	cr := r.Header.Get("Content-Range")
	if strings.HasPrefix(cr, "bytes */") {
		s.stats.Probes++
		s.answer(w, ses)
		return
	}
	s.stats.Chunks++
	if s.opts.QuotaOnChunk {
		writeJSON(w, 403, s.fixture("error_403_storage_quota.json", nil))
		return
	}
	var first, last, total int64
	if ses.size > 0 {
		if _, err := fmt.Sscanf(cr, "bytes %d-%d/%d", &first, &last, &total); err != nil || total != ses.size {
			s.t.Errorf("drivetest: Content-Range %q", cr)
		}
		if first != int64(len(ses.received)) {
			s.t.Errorf("drivetest: chunk starts at %d, the session has %d", first, len(ses.received))
		}
		if n := last - first + 1; first+n < ses.size && n%ChunkUnit != 0 {
			s.t.Errorf("drivetest: a middle chunk of %d bytes is not a multiple of 256 KiB", n)
		}
	}
	if s.opts.CutChunks[s.stats.Chunks] {
		half := make([]byte, (last-first+1)/2)
		n, _ := io.ReadFull(r.Body, half)
		keep := int64(n) / ChunkUnit * ChunkUnit
		ses.received = append(ses.received, half[:keep]...)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			s.t.Errorf("drivetest: hijack: %v", err)
			return
		}
		conn.Close()
		return
	}
	data, err := io.ReadAll(r.Body)
	if err != nil {
		s.t.Errorf("drivetest: chunk body: %v", err)
	}
	ses.received = append(ses.received, data...)
	s.answer(w, ses)
}

// answer is 308 with what arrived so far, or the file once all of it has.
func (s *Server) answer(w http.ResponseWriter, ses *session) {
	if int64(len(ses.received)) < ses.size {
		if len(ses.received) > 0 {
			w.Header().Set("Range", fmt.Sprintf("bytes=0-%d", len(ses.received)-1))
		}
		w.WriteHeader(http.StatusPermanentRedirect)
		return
	}
	id := s.newID("file")
	s.files[id] = &file{meta: ses.meta, data: ses.received}
	sum := md5.Sum(ses.received)
	md5hex := hex.EncodeToString(sum[:])
	if s.opts.CorruptMD5 {
		md5hex = strings.Repeat("0", 32)
	}
	writeJSON(w, 200, s.fixture("upload_complete.json", map[string]string{
		"__ID__": id, "__SIZE__": strconv.Itoa(len(ses.received)), "__MD5__": md5hex}))
}

func (s *Server) file(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method == http.MethodDelete && s.opts.FailOnDelete {
		s.t.Errorf("drivetest: a file was deleted from the learner's Drive (%s)", id)
	}
	if _, ok := s.folders[id]; ok && r.Method == http.MethodGet {
		s.stats.FolderChecks++
		writeJSON(w, 200, s.fixture("folder_metadata.json", map[string]string{
			"__ID__": id, "__TRASHED__": strconv.FormatBool(s.folderTrashed(id))}))
		return
	}
	f, ok := s.files[id]
	if !ok {
		writeJSON(w, 404, s.fixture("error_404_file.json", map[string]string{"__ID__": id}))
		return
	}
	data := f.data
	switch {
	case r.Method == http.MethodDelete:
		s.stats.Deletes++
		delete(s.files, id)
		w.WriteHeader(http.StatusNoContent)
	case r.URL.Query().Get("alt") == "media":
		rg := r.Header.Get("Range")
		s.stats.Ranges = append(s.stats.Ranges, rg)
		var first, last int64
		if _, err := fmt.Sscanf(rg, "bytes=%d-%d", &first, &last); err != nil || last >= int64(len(data)) || first > last {
			s.t.Errorf("drivetest: Range %q", rg)
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", first, last, len(data)))
		w.Header().Set("Content-Length", strconv.FormatInt(last-first+1, 10))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(data[first : last+1])
	default:
		vars := s.fileVars(id, f)
		// A file in a trashed folder reads as trashed too (phase 3).
		vars["__TRASHED__"] = strconv.FormatBool(s.fileTrashed(id, f))
		writeJSON(w, 200, s.fixture("file_metadata.json", vars))
	}
}

// fileVars fill a file's fixture: its size, trashed flag and Drive's own
// checksums of the stored bytes.
func (s *Server) fileVars(id string, f *file) map[string]string {
	m := md5.Sum(f.data)
	sh := sha256.Sum256(f.data)
	sha := hex.EncodeToString(sh[:])
	if s.opts.CorruptSHA256 {
		sha = strings.Repeat("0", 64)
	}
	if s.opts.NoSHA256 {
		sha = ""
	}
	props, _ := json.Marshal(f.meta.AppProperties)
	return map[string]string{
		"__ID__": id, "__SIZE__": strconv.Itoa(len(f.data)), "__TRASHED__": strconv.FormatBool(s.trashed[id]),
		"__MD5__": hex.EncodeToString(m[:]), "__SHA256__": sha, "__PROPS__": string(props),
	}
}

// listFiles answers a file search by appProperties (user, kind and key), in
// the order the files were made, leaving trashed ones out.
func (s *Server) listFiles(w http.ResponseWriter, q string) {
	s.stats.FileLists++
	if !strings.Contains(q, "trashed = false") {
		s.t.Errorf("drivetest: file search %q", q)
	}
	var ids []string
	for id, f := range s.files {
		p := f.meta.AppProperties
		if s.trashed[id] || p == nil {
			continue
		}
		if strings.Contains(q, "key='longplay_user' and value='"+p["longplay_user"]+"'") &&
			strings.Contains(q, "key='longplay_kind' and value='"+p["longplay_kind"]+"'") &&
			strings.Contains(q, "key='longplay_key' and value='"+p["longplay_key"]+"'") {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids) // newID numbers them in creation order
	items := make([]string, 0, len(ids))
	for _, id := range ids {
		items = append(items, string(s.fixture("file_listed.json", s.fileVars(id, s.files[id]))))
	}
	writeJSON(w, 200, s.fixture("files_found.json", map[string]string{"__FILES__": strings.Join(items, ",")}))
}
