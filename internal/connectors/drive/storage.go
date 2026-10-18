package drive

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/security"
)

// storage.go — the learner's Drive as a place to keep their own files
// (drive-user-storage phase 1). It implements blob.Remote: a "AnyTools"
// folder with its subfolders, resumable uploads, ranged reads and deletes.
//
// The scope is still `drive.file` and nothing wider. That scope grants full
// access to the files this app created, so the folder and every file written
// into it are readable, rangeable and deletable here, and nothing else in the
// learner's Drive becomes visible.
//
// Every request is proven against fixtures in testdata/storage/, shaped from
// Google's Drive v3 documentation (files.create, resumable uploads,
// files.get with alt=media, files.delete and the storageQuotaExceeded error):
// no Google credentials exist for this project yet, so no live run has been
// possible. docs/ lists the checks to make once they do.

// DefaultUploadURL is Drive's media upload endpoint.
const DefaultUploadURL = "https://www.googleapis.com/upload/drive/v3"

// googleAPIHost is the one host storage requests may reach: the metadata
// API, the upload endpoint and the upload sessions all live on it.
const googleAPIHost = "www.googleapis.com"

// chunkUnit is Google's rule for resumable chunks: every chunk but the last
// is a multiple of 256 KiB.
const chunkUnit = 256 << 10

// defaultChunkSize is 8 MiB, Google's suggested size for a reliable link.
const defaultChunkSize = 32 * chunkUnit

// maxJSONBytes bounds every metadata response read.
const maxJSONBytes = 1 << 20

// appProperties keys. A folder carries longplay_user and longplay_role; a
// file carries longplay_user, longplay_kind, longplay_key and sha256. Drive
// searches them (`appProperties has {…}`), so a reconnect or a second device
// finds the same folders and files without the database.
const (
	propUser = "longplay_user"
	propRole = "longplay_role"
	propKind = "longplay_kind"
	propKey  = "longplay_key"
	propSHA  = "sha256"
)

// folderNames are what the learner sees in Drive.
var folderNames = map[string]string{
	blob.FolderRoot:       "AnyTools",
	blob.FolderUploads:    "Uploads",
	blob.FolderRecordings: "Recordings",
	blob.FolderAudio:      "Audio",
	blob.FolderExamPapers: "Exam papers",
	blob.FolderExports:    "Exports",
}

// driveID is the shape of a Drive file id. An id is put in a URL path, so
// anything else is refused before a request is made.
var driveID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,512}$`)

// FolderStore is drive_folders: where this learner's folders are, once
// found or created.
type FolderStore interface {
	// ListFolders returns role → Drive folder id.
	ListFolders(ctx context.Context, userID uuid.UUID) (map[string]string, error)
	SaveFolder(ctx context.Context, userID uuid.UUID, role, folderID string) error
	// ForgetFolders drops every recorded folder, so the next EnsureFolders
	// searches Drive again (phase 3: a folder the learner trashed).
	ForgetFolders(ctx context.Context, userID uuid.UUID) error
}

// FileIndex is what Storage reads of drive_files (phase 3): how much of a
// learner's is in their Drive, for the disconnect page, and the marks a
// reconnect clears.
type FileIndex interface {
	CountDriveFiles(ctx context.Context, userID uuid.UUID) (files int, bytes int64, err error)
	// ClearDriveFilesMissing forgets every "removed from Drive" mark, so
	// the next read asks Drive again.
	ClearDriveFilesMissing(ctx context.Context, userID uuid.UUID) error
}

// StorageConfig assembles a Storage.
type StorageConfig struct {
	Folders FolderStore
	// Files is optional; without it a reconnect keeps the missing marks and
	// Status counts nothing.
	Files FileIndex
	// HTTP defaults to the guarded fetch client, allowlisted to Google's API
	// host. Tests pass a client allowlisted to their fixture server.
	HTTP *http.Client
	// BaseURL and UploadURL default to Google's (or the Service's BaseURL).
	BaseURL   string
	UploadURL string
	// ChunkSize is rounded down to a multiple of 256 KiB; zero is 8 MiB.
	ChunkSize int64
	// Retries is how many failed requests in a row an upload survives
	// (default 5). Backoff is the wait before the next try.
	Retries int
	Backoff func(attempt int) time.Duration
}

// Storage keeps a learner's files in their Drive.
type Storage struct {
	svc       *Service
	folders   FolderStore
	files     FileIndex
	http      *http.Client
	baseURL   string
	uploadURL string
	chunk     int64
	retries   int
	backoff   func(int) time.Duration

	// folderMu serialises EnsureFolders per user, so two uploads at once do
	// not both create a "AnyTools" folder. Process-local, like refreshMu.
	folderMu sync.Map // uuid.UUID -> *sync.Mutex
}

var _ blob.Remote = (*Storage)(nil)

// NewStorage returns a Storage whose every request authenticates through
// the Service's token refresh.
func NewStorage(svc *Service, cfg StorageConfig) *Storage {
	st := &Storage{
		svc: svc, folders: cfg.Folders, files: cfg.Files, http: cfg.HTTP,
		baseURL: cfg.BaseURL, uploadURL: cfg.UploadURL,
		chunk: cfg.ChunkSize / chunkUnit * chunkUnit, retries: cfg.Retries, backoff: cfg.Backoff,
	}
	if st.http == nil {
		// No overall timeout: a long recording streams for as long as the
		// learner listens. Each request bounds itself instead (see send).
		st.http = security.AllowlistClientOver(security.FetchClient(0), googleAPIHost)
	}
	if st.baseURL == "" {
		st.baseURL = svc.baseURL
	}
	if st.baseURL == "" {
		st.baseURL = DefaultDriveBaseURL
	}
	if st.uploadURL == "" {
		st.uploadURL = DefaultUploadURL
	}
	if st.chunk <= 0 {
		st.chunk = defaultChunkSize
	}
	if st.retries <= 0 {
		st.retries = 5
	}
	if st.backoff == nil {
		st.backoff = func(attempt int) time.Duration { return time.Duration(attempt) * time.Second }
	}
	return st
}

// ─────────────────────────────────────────────────────────────── transport

// send makes one authenticated request. The access token is read through
// the Service's refresh and set as a header; it is never part of a URL, and
// no error this returns carries it (see scrub).
//
// body makes the request's body, or is nil for none. It is a func because a
// request Drive answers 401 is sent again with a fresh token (phase 3), and
// the transport may still be reading the first body when the second starts.
//
// A 401 is refreshed and retried once (Service.authorized). A connection
// that cannot give a token (revoked, disconnected) is blob.ErrReconnect, and
// so is a grant whose freshly refreshed token Drive refuses too: the
// learner's files are out of reach until they reconnect.
func (s *Storage) send(ctx context.Context, userID uuid.UUID, method, rawURL string, header http.Header, body func() io.Reader, length int64) (*http.Response, string, error) {
	resp, tok, err := s.svc.authorized(ctx, userID, func(tok string) (*http.Response, error) {
		return s.sendWith(ctx, tok, method, rawURL, header, body, length)
	})
	return resp, tok, reconnectError(err)
}

func (s *Storage) sendWith(ctx context.Context, tok, method, rawURL string, header http.Header, body func() io.Reader, length int64) (*http.Response, error) {
	var rd io.Reader
	if body != nil {
		rd = body()
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, rd)
	if err != nil {
		return nil, errors.New("drive: could not build the request")
	}
	for k, v := range header {
		req.Header[k] = v
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	if rd != nil {
		req.ContentLength = length
	} else if method == http.MethodPut || method == http.MethodPost {
		req.ContentLength = 0
		req.Body = http.NoBody
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, transportError(method, req.URL, err)
	}
	return resp, nil
}

// drain reads a little of an answer that is being thrown away, so its
// connection can be reused, and closes it.
func drain(resp *http.Response) {
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
}

// reconnectError marks a connection that cannot authenticate as
// blob.ErrReconnect, keeping the connector's own error in the chain. Any
// other failure to get a token (Google's token endpoint down) passes as it
// is: telling a learner with a good account to reconnect is the worse
// mistake.
func reconnectError(err error) error {
	if errors.Is(err, ErrNeedsReconnect) || errors.Is(err, ErrNotConnected) {
		return fmt.Errorf("%w: %w", blob.ErrReconnect, err)
	}
	return err
}

// transportError names the method and the host and drops the URL: an upload
// session URL is itself a credential for that upload.
func transportError(method string, u *url.URL, err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) {
		err = uerr.Err
	}
	return &netError{msg: fmt.Sprintf("drive: %s %s: %v", method, u.Host, err), err: err}
}

// netError is a request that never got an answer. An upload retries it.
type netError struct {
	msg string
	err error
}

func (e *netError) Error() string { return e.msg }
func (e *netError) Unwrap() error { return e.err }

// apiError reads Google's error envelope with a bounded read, and takes the
// token out of the message in case anything ever echoed it back.
func apiError(resp *http.Response, tok string) error {
	body, _, _ := blob.ReadAllLimited(resp.Body, 64<<10)
	e := parseAPIError(resp.StatusCode, body)
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("%w (%s)", blob.ErrRemoved, scrub(e.Message, tok))
	}
	e.Message = scrub(e.Message, tok)
	return e
}

func scrub(s, tok string) string {
	if tok == "" {
		return s
	}
	return strings.ReplaceAll(s, tok, "[redacted]")
}

// call makes a JSON request and decodes a JSON answer, bounded in time and
// in size.
func (s *Storage) call(ctx context.Context, userID uuid.UUID, method, rawURL string, in, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	var (
		body   func() io.Reader
		length int64
		header = http.Header{}
	)
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body, length = bytesBody(b), int64(len(b))
		header.Set("Content-Type", "application/json; charset=UTF-8")
	}
	resp, tok, err := s.send(ctx, userID, method, rawURL, header, body, length)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return apiError(resp, tok)
	}
	if out == nil {
		return nil
	}
	data, over, err := blob.ReadAllLimited(resp.Body, maxJSONBytes)
	if err != nil {
		return fmt.Errorf("drive: reading the answer: %w", err)
	}
	if over {
		return errors.New("drive: the answer was larger than expected")
	}
	return json.Unmarshal(data, out)
}

func bytesBody(b []byte) func() io.Reader {
	return func() io.Reader { return bytes.NewReader(b) }
}

func (s *Storage) filesURL(path string, q url.Values) string {
	u := strings.TrimRight(s.baseURL, "/") + "/files" + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return u
}

// ───────────────────────────────────────────────────────────────── folders

type driveObject struct {
	ID          string `json:"id"`
	Name        string `json:"name,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
	Size        string `json:"size,omitempty"` // int64 as a string, as Drive sends it
	MD5Checksum string `json:"md5Checksum,omitempty"`
	// SHA256Checksum is Drive's own digest of the stored bytes, checked
	// before a move deletes the old copy (storage_move.go).
	SHA256Checksum string            `json:"sha256Checksum,omitempty"`
	Trashed        bool              `json:"trashed,omitempty"`
	Parents        []string          `json:"parents,omitempty"`
	AppProperties  map[string]string `json:"appProperties,omitempty"`
}

// EnsureFolders returns the learner's folders, role → id, creating what is
// missing. Before creating one it searches for it by appProperties, so a
// reconnect, a lost drive_folders row or a second device reuses the folder
// that is already there.
func (s *Storage) EnsureFolders(ctx context.Context, userID uuid.UUID) (map[string]string, error) {
	defer s.lockFolders(userID)()
	return s.ensureFolders(ctx, userID)
}

func (s *Storage) lockFolders(userID uuid.UUID) (unlock func()) {
	mu, _ := s.folderMu.LoadOrStore(userID, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	return mu.(*sync.Mutex).Unlock
}

func (s *Storage) ensureFolders(ctx context.Context, userID uuid.UUID) (map[string]string, error) {
	known, err := s.folders.ListFolders(ctx, userID)
	if err != nil {
		return nil, err
	}
	if known == nil {
		known = map[string]string{}
	}
	for _, role := range blob.FolderRoles {
		if known[role] != "" {
			continue
		}
		parent := ""
		if role != blob.FolderRoot {
			parent = known[blob.FolderRoot]
		}
		id, err := s.findOrCreateFolder(ctx, userID, role, parent)
		if err != nil {
			return nil, err
		}
		if err := s.folders.SaveFolder(ctx, userID, role, id); err != nil {
			return nil, err
		}
		known[role] = id
	}
	return known, nil
}

func (s *Storage) findOrCreateFolder(ctx context.Context, userID uuid.UUID, role, parent string) (string, error) {
	query := fmt.Sprintf("mimeType = '%s' and trashed = false"+
		" and appProperties has { key='%s' and value='%s' }"+
		" and appProperties has { key='%s' and value='%s' }",
		MimeGoogleFolder, propUser, userID, propRole, escapeQueryLiteral(role))
	if parent != "" {
		query += fmt.Sprintf(" and '%s' in parents", escapeQueryLiteral(parent))
	}
	q := url.Values{}
	q.Set("q", query)
	q.Set("spaces", "drive")
	q.Set("orderBy", "createdTime")
	q.Set("pageSize", "10")
	q.Set("fields", "files(id)")
	var found struct {
		Files []driveObject `json:"files"`
	}
	if err := s.call(ctx, userID, http.MethodGet, s.filesURL("", q), nil, &found); err != nil {
		return "", err
	}
	// The oldest wins: if two were ever made, every device settles on the
	// same one.
	if len(found.Files) > 0 && driveID.MatchString(found.Files[0].ID) {
		return found.Files[0].ID, nil
	}

	meta := driveObject{
		Name:          folderNames[role],
		MimeType:      MimeGoogleFolder,
		AppProperties: map[string]string{propUser: userID.String(), propRole: role},
	}
	if parent != "" {
		meta.Parents = []string{parent}
	}
	q = url.Values{}
	q.Set("fields", "id")
	var created driveObject
	if err := s.call(ctx, userID, http.MethodPost, s.filesURL("", q), meta, &created); err != nil {
		return "", err
	}
	if !driveID.MatchString(created.ID) {
		return "", errors.New("drive: the new folder came back without a usable id")
	}
	return created.ID, nil
}

// ───────────────────────────────────────────────────────────────── upload

// Put uploads one file with a resumable session, resuming from what Drive
// says it received whenever a chunk is cut off, and returns it only once
// Drive's own size and md5Checksum match what was sent.
func (s *Storage) Put(ctx context.Context, userID uuid.UUID, up blob.RemoteUpload) (blob.RemoteFile, error) {
	folders, err := s.liveFolders(ctx, userID, up.Folder)
	if err != nil {
		return blob.RemoteFile{}, err
	}
	parent := folders[up.Folder]
	if parent == "" {
		return blob.RemoteFile{}, fmt.Errorf("drive: no folder for %q", up.Folder)
	}
	md5hex, err := checkBody(up)
	if err != nil {
		return blob.RemoteFile{}, err
	}
	meta := driveObject{
		Name:     up.Name,
		MimeType: up.MIME,
		Parents:  []string{parent},
		AppProperties: map[string]string{
			propUser: userID.String(), propKind: up.Kind, propKey: up.Key, propSHA: up.SHA256,
		},
	}

	got, err := s.upload(ctx, userID, meta, up)
	if err != nil {
		return blob.RemoteFile{}, err
	}
	if !driveID.MatchString(got.ID) {
		return blob.RemoteFile{}, errors.New("drive: the upload came back without a usable id")
	}
	if got.Size != strconv.FormatInt(up.Size, 10) || !strings.EqualFold(got.MD5Checksum, md5hex) {
		// What Drive stored is not what was sent. It is removed, and the
		// write fails: a row must never point at the wrong bytes.
		_ = s.Delete(ctx, userID, got.ID)
		return blob.RemoteFile{}, fmt.Errorf("%w: Drive received %s bytes with a different checksum", blob.ErrCorrupt, got.Size)
	}
	return blob.RemoteFile{ID: got.ID}, nil
}

// checkBody reads the body once for its md5 (what Drive reports back) and
// its sha256 (what the caller promised).
func checkBody(up blob.RemoteUpload) (string, error) {
	m, sh := md5.New(), sha256.New()
	n, err := io.Copy(io.MultiWriter(m, sh), io.NewSectionReader(up.Body, 0, up.Size+1))
	if err != nil {
		return "", err
	}
	if n != up.Size || hexSum(sh) != up.SHA256 {
		return "", errors.New("drive: the file changed before it could be uploaded")
	}
	return hexSum(m), nil
}

func hexSum(h hash.Hash) string { return hex.EncodeToString(h.Sum(nil)) }

// upload runs the resumable protocol: open a session, send chunks, and
// after any cut ask the session how much arrived and carry on from there. A
// session Drive has forgotten (404 or 410) is opened again once.
func (s *Storage) upload(ctx context.Context, userID uuid.UUID, meta driveObject, up blob.RemoteUpload) (*driveObject, error) {
	session, err := s.openSession(ctx, userID, meta, up)
	if err != nil {
		return nil, err
	}
	var (
		offset   int64
		failures int
		reopened bool
		probe    bool // ask how much arrived instead of sending
	)
	for {
		at := offset
		if probe {
			at = -1
		}
		res, next, file, err := s.sendChunk(ctx, userID, session, up, at)
		switch res {
		case chunkDone:
			return file, nil
		case chunkMore:
			// Only bytes Drive confirms are progress. A probe that finds
			// nothing new keeps counting towards the retry limit.
			if next > offset {
				failures = 0
			}
			probe, offset = false, next
		case chunkRetry:
			failures++
			if failures > s.retries {
				return nil, fmt.Errorf("drive: the upload kept failing: %w", err)
			}
			if err := sleep(ctx, s.backoff(failures)); err != nil {
				return nil, err
			}
			probe = true
		case chunkExpired:
			if reopened {
				return nil, errors.New("drive: the upload session expired twice")
			}
			reopened = true
			if session, err = s.openSession(ctx, userID, meta, up); err != nil {
				return nil, err
			}
			offset, probe = 0, false
		default:
			return nil, err
		}
	}
}

type chunkResult int

const (
	chunkMore    chunkResult = iota // 308: send from the next offset
	chunkDone                       // 200/201: the file
	chunkRetry                      // cut off or a 5xx: probe, then resume
	chunkExpired                    // 404/410: the session is gone
	chunkFailed                     // any other answer
)

// openSession starts a resumable upload and returns its session URL, which
// must be on the upload endpoint's own host.
func (s *Storage) openSession(ctx context.Context, userID uuid.UUID, meta driveObject, up blob.RemoteUpload) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	q := url.Values{}
	q.Set("uploadType", "resumable")
	q.Set("fields", "id,size,md5Checksum")
	b, err := json.Marshal(meta)
	if err != nil {
		return "", err
	}
	h := http.Header{}
	h.Set("Content-Type", "application/json; charset=UTF-8")
	h.Set("X-Upload-Content-Type", up.MIME)
	h.Set("X-Upload-Content-Length", strconv.FormatInt(up.Size, 10))
	endpoint := strings.TrimRight(s.uploadURL, "/") + "/files?" + q.Encode()
	resp, tok, err := s.send(ctx, userID, http.MethodPost, endpoint, h, bytesBody(b), int64(len(b)))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", apiError(resp, tok)
	}
	loc, err := url.Parse(resp.Header.Get("Location"))
	base, _ := url.Parse(s.uploadURL)
	if err != nil || loc.Host == "" || base == nil || !strings.EqualFold(loc.Host, base.Host) {
		return "", errors.New("drive: the upload session is not on Drive's upload host")
	}
	return loc.String(), nil
}

// sendChunk sends the chunk at offset, or with offset -1 asks the session
// how much it has (an empty PUT with "bytes */size"). It answers what to do
// next, the next offset after a 308, and the file once it is complete.
func (s *Storage) sendChunk(ctx context.Context, userID uuid.UUID, session string, up blob.RemoteUpload, offset int64) (chunkResult, int64, *driveObject, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	h := http.Header{}
	var (
		body   func() io.Reader
		length int64
	)
	switch {
	case offset < 0:
		h.Set("Content-Range", fmt.Sprintf("bytes */%d", up.Size))
	case up.Size == 0:
		// An empty file is one empty PUT.
	default:
		// A reader of its own per chunk: the transport may still be reading
		// an abandoned chunk when the next one starts.
		end := min(offset+s.chunk, up.Size)
		body = func() io.Reader { return io.NewSectionReader(up.Body, offset, end-offset) }
		length = end - offset
		h.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, end-1, up.Size))
	}
	resp, tok, err := s.send(ctx, userID, http.MethodPut, session, h, body, length)
	if err != nil {
		var nerr *netError
		if errors.As(err, &nerr) && ctx.Err() == nil || errors.Is(err, context.DeadlineExceeded) {
			return chunkRetry, 0, nil, err
		}
		return chunkFailed, 0, nil, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated:
		data, over, err := blob.ReadAllLimited(resp.Body, maxJSONBytes)
		if err != nil || over {
			return chunkRetry, 0, nil, errors.New("drive: the finished upload's answer could not be read")
		}
		var file driveObject
		if err := json.Unmarshal(data, &file); err != nil {
			return chunkFailed, 0, nil, fmt.Errorf("drive: the finished upload's answer: %w", err)
		}
		return chunkDone, 0, &file, nil
	case resp.StatusCode == http.StatusPermanentRedirect: // 308 Resume Incomplete
		next, err := receivedUpTo(resp.Header.Get("Range"), up.Size)
		if err != nil {
			return chunkFailed, 0, nil, err
		}
		return chunkMore, next, nil, nil
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return chunkExpired, 0, nil, nil
	case resp.StatusCode >= 500 || resp.StatusCode == http.StatusRequestTimeout || resp.StatusCode == http.StatusTooManyRequests:
		return chunkRetry, 0, nil, apiError(resp, tok)
	default:
		return chunkFailed, 0, nil, apiError(resp, tok)
	}
}

// receivedUpTo reads a 308's Range header ("bytes=0-524287") as the next
// offset to send. No header means nothing arrived.
func receivedUpTo(h string, size int64) (int64, error) {
	if h == "" {
		return 0, nil
	}
	rest, ok := strings.CutPrefix(h, "bytes=0-")
	if !ok {
		return 0, fmt.Errorf("drive: an upload answered with an unreadable range %q", h)
	}
	last, err := strconv.ParseInt(rest, 10, 64)
	if err != nil || last < 0 || last >= size {
		return 0, fmt.Errorf("drive: an upload answered with an impossible range %q", h)
	}
	return last + 1, nil
}

func sleep(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// ─────────────────────────────────────────────────────────────────── read

// Open checks the file is still there and the size AnyTools recorded, then
// returns a reader that fetches ranges lazily: nothing is downloaded until
// it is read, and a seek costs nothing until the next read. That is what
// lets http.ServeContent answer a player's range requests from Drive.
func (s *Storage) Open(ctx context.Context, userID uuid.UUID, fileID string, size int64) (io.ReadSeekCloser, error) {
	if !driveID.MatchString(fileID) {
		return nil, errors.New("drive: malformed file id")
	}
	q := url.Values{}
	q.Set("fields", "id,size,trashed")
	q.Set("supportsAllDrives", "true")
	var meta driveObject
	if err := s.call(ctx, userID, http.MethodGet, s.filesURL("/"+fileID, q), nil, &meta); err != nil {
		return nil, err
	}
	if meta.Trashed {
		return nil, blob.ErrRemoved
	}
	if meta.Size != strconv.FormatInt(size, 10) {
		return nil, fmt.Errorf("%w: Drive holds %s bytes, not %d", blob.ErrCorrupt, meta.Size, size)
	}
	return &rangeReader{ctx: ctx, s: s, user: userID, id: fileID, size: size}, nil
}

// rangeReader reads a Drive file through files.get?alt=media with a Range
// header, from wherever it was last sought.
type rangeReader struct {
	ctx  context.Context
	s    *Storage
	user uuid.UUID
	id   string
	size int64

	off    int64
	body   io.ReadCloser
	left   int64
	cancel context.CancelFunc
}

func (r *rangeReader) Read(p []byte) (int, error) {
	if r.off >= r.size {
		return 0, io.EOF
	}
	if r.body == nil {
		if err := r.fetch(); err != nil {
			return 0, err
		}
	}
	if int64(len(p)) > r.left {
		p = p[:r.left]
	}
	n, err := r.body.Read(p)
	r.off += int64(n)
	r.left -= int64(n)
	if r.off >= r.size {
		r.closeBody()
		return n, nil
	}
	if errors.Is(err, io.EOF) {
		// Drive stopped before the end of the range.
		r.closeBody()
		return n, io.ErrUnexpectedEOF
	}
	if err != nil {
		r.closeBody()
	}
	return n, err
}

// fetch opens the range from r.off to the end. Only the wait for headers is
// bounded here; the body streams for as long as the caller's context lives.
func (r *rangeReader) fetch() error {
	ctx, cancel := context.WithCancel(r.ctx)
	timer := time.AfterFunc(60*time.Second, cancel)
	q := url.Values{}
	q.Set("alt", "media")
	q.Set("supportsAllDrives", "true")
	h := http.Header{}
	h.Set("Range", fmt.Sprintf("bytes=%d-%d", r.off, r.size-1))
	resp, tok, err := r.s.send(ctx, r.user, http.MethodGet, r.s.filesURL("/"+r.id, q), h, nil, 0)
	timer.Stop()
	if err != nil {
		cancel()
		return err
	}
	ok := false
	switch resp.StatusCode {
	case http.StatusPartialContent:
		ok = contentRangeStarts(resp.Header.Get("Content-Range"), r.off, r.size)
	case http.StatusOK:
		// A server may ignore Range; that is only usable from the start.
		ok = r.off == 0
	default:
		err := apiError(resp, tok)
		resp.Body.Close()
		cancel()
		return err
	}
	if !ok {
		resp.Body.Close()
		cancel()
		return fmt.Errorf("%w: Drive answered a different range than was asked", blob.ErrCorrupt)
	}
	r.body, r.left, r.cancel = resp.Body, r.size-r.off, cancel
	return nil
}

// contentRangeStarts checks "bytes 100-149/5000" starts at off and names
// the size AnyTools recorded.
func contentRangeStarts(h string, off, size int64) bool {
	rest, ok := strings.CutPrefix(h, "bytes ")
	if !ok {
		return false
	}
	span, total, ok := strings.Cut(rest, "/")
	if !ok || total != strconv.FormatInt(size, 10) {
		return false
	}
	first, _, ok := strings.Cut(span, "-")
	return ok && first == strconv.FormatInt(off, 10)
}

func (r *rangeReader) Seek(offset int64, whence int) (int64, error) {
	var abs int64
	switch whence {
	case io.SeekStart:
		abs = offset
	case io.SeekCurrent:
		abs = r.off + offset
	case io.SeekEnd:
		abs = r.size + offset
	default:
		return 0, errors.New("drive: invalid whence")
	}
	if abs < 0 {
		return 0, errors.New("drive: negative position")
	}
	if abs != r.off {
		r.closeBody()
	}
	r.off = abs
	return abs, nil
}

func (r *rangeReader) Close() error {
	r.closeBody()
	return nil
}

func (r *rangeReader) closeBody() {
	if r.body != nil {
		r.body.Close()
		r.body = nil
	}
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
}

// ───────────────────────────────────────────────────────────────── delete

// Delete removes a file AnyTools wrote. One already gone is the state asked
// for, not an error.
func (s *Storage) Delete(ctx context.Context, userID uuid.UUID, fileID string) error {
	if !driveID.MatchString(fileID) {
		return errors.New("drive: malformed file id")
	}
	q := url.Values{}
	q.Set("supportsAllDrives", "true")
	err := s.call(ctx, userID, http.MethodDelete, s.filesURL("/"+fileID, q), nil, nil)
	if errors.Is(err, blob.ErrRemoved) {
		return nil
	}
	return err
}

// QuotaExceeded reports Drive's "storage full" refusal (403
// storageQuotaExceeded), which phase 3 shows as "Your Google Drive is full".
func QuotaExceeded(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusForbidden && apiErr.Reason == "storageQuotaExceeded"
}
