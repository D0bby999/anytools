// Package drive is AnyTools' Google Drive connector: consent under the
// non-sensitive `drive.file` scope, import of picked files and folders into a
// knowledge base, and incremental sync through `changes.list`.
//
// Ported from spikes/drive (reports/spike-drive.md, 21 recorded-fixture tests)
// with the spike's two structural decisions kept:
//
//  1. stdlib net/http, not google.golang.org/api. The generated client would
//     hand back structs a fixture had already been massaged into; raw REST is
//     what makes the recorded bytes in testdata/ honest — they are the bytes
//     Google's API returns. The spike ran with no Google credentials at all and
//     so does every test here, which matters because the owner has not created
//     the GCP project yet (spike-drive.md, "BLOCKED").
//
//  2. `drive.file` and nothing wider. `drive.readonly` is a RESTRICTED scope:
//     CASA tier-2 review, months. drive.file is non-sensitive — basic
//     verification, no 100-user ceiling (researcher §5).
//
// What that scope can and cannot do is the whole shape of this package. The
// app may read a file the user "opens with" it — a Picker selection — and
// nothing else. The spike could NOT establish that a file added later to a
// picked folder becomes visible (capability row 2, UNKNOWN leaning NO), so
// nothing here assumes it: a folder is expanded to its children AT PICK TIME,
// and files that appear afterwards arrive through "Pick more".
package drive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/blob"
)

// Google's endpoints. Every one is overridable so tests can point the client at
// an httptest.Server replaying recorded responses.
const (
	DefaultDriveBaseURL = "https://www.googleapis.com/drive/v3"
	DefaultTokenURL     = "https://oauth2.googleapis.com/token"
	DefaultAuthURL      = "https://accounts.google.com/o/oauth2/v2/auth"
	DefaultRevokeURL    = "https://oauth2.googleapis.com/revoke"

	// ScopeDriveFile is the only scope this connector ever requests.
	ScopeDriveFile = "https://www.googleapis.com/auth/drive.file"
)

// Google-native MIME types. These files have no bytes to download — files.get
// with alt=media fails on them — so each has an export lane instead.
const (
	MimeGoogleDoc    = "application/vnd.google-apps.document"
	MimeGoogleSheet  = "application/vnd.google-apps.spreadsheet"
	MimeGoogleFolder = "application/vnd.google-apps.folder"

	MimeMarkdown = "text/markdown"
	MimeCSV      = "text/csv"
)

// MaxExportBytes is Google's own cap on files.export output (researcher §5).
// Read one byte past it so truncation is observable rather than silent.
const MaxExportBytes = 10 << 20

// File is the subset of drive#file this connector needs. `fields` asks for
// exactly these and nothing more.
type File struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	MimeType     string   `json:"mimeType"`
	MD5Checksum  string   `json:"md5Checksum,omitempty"` // absent for Google-native docs
	ModifiedTime string   `json:"modifiedTime"`
	Trashed      bool     `json:"trashed"`
	Parents      []string `json:"parents,omitempty"`
}

// IsFolder reports whether this file is a Drive folder.
func (f File) IsFolder() bool { return f.MimeType == MimeGoogleFolder }

type fileList struct {
	Files            []File `json:"files"`
	NextPageToken    string `json:"nextPageToken"`
	IncompleteSearch bool   `json:"incompleteSearch"`
}

// Change is one entry of changes.list.
type Change struct {
	ChangeType string `json:"changeType"`
	Time       string `json:"time"`
	Removed    bool   `json:"removed"`
	FileID     string `json:"fileId"`
	File       *File  `json:"file,omitempty"`
}

type changeList struct {
	Changes           []Change `json:"changes"`
	NextPageToken     string   `json:"nextPageToken"`
	NewStartPageToken string   `json:"newStartPageToken"`
}

type startPageToken struct {
	StartPageToken string `json:"startPageToken"`
}

// APIError carries Google's own error envelope.
//
// `Reason` is the field that separates "this token is stale, re-baseline" from
// "this app may not see this file, make the user pick it again". Collapsing the
// two — treating a 403 as a Gone — makes the connector re-baseline the change
// feed forever instead of telling the user the one thing that would fix it.
type APIError struct {
	Status  int
	Reason  string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("drive: HTTP %d (%s): %s", e.Status, e.Reason, e.Message)
}

// Unwrap makes Drive's "storage full" refusal a blob.ErrRemoteFull, so the
// learner is told their Drive is full whichever request met it: the upload
// session, or a chunk part way through (drive-user-storage phase 3).
func (e *APIError) Unwrap() error {
	if e.Status == http.StatusForbidden && e.Reason == "storageQuotaExceeded" {
		return blob.ErrRemoteFull
	}
	return nil
}

// Gone reports the stale-page-token condition that forces a re-baseline.
func (e *APIError) Gone() bool { return e.Status == http.StatusGone }

// Forbidden is how drive.file denies a file the user never handed to the app.
// A grant that gets this is marked "re-pick" and nothing else will fix it.
func (e *APIError) Forbidden() bool {
	return e.Status == http.StatusForbidden || e.Status == http.StatusNotFound
}

// NeedsRePick is Forbidden narrowed to the reasons a user can act on.
func (e *APIError) NeedsRePick() bool { return e.Forbidden() }

// IsForbidden reports whether err is a Drive permission denial.
func IsForbidden(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Forbidden()
}

// Client is a minimal Drive v3 REST client.
type Client struct {
	HTTP    *http.Client
	BaseURL string
	// Token returns a bearer access token, refreshing underneath if it must.
	// A func rather than a string so no token value is ever held in a struct
	// field that could be %+v'd into a log line.
	Token func(context.Context) (string, error)

	// authorize, when set, sends each request in place of Token: the
	// Service's own, which refreshes and retries a 401 once and marks a grant
	// whose fresh token is refused too (Service.authorized).
	authorize func(ctx context.Context, send func(tok string) (*http.Response, error)) (*http.Response, string, error)
}

// NewClient returns a Client reading its token from tokenFn.
func NewClient(baseURL string, tokenFn func(context.Context) (string, error)) *Client {
	if baseURL == "" {
		baseURL = DefaultDriveBaseURL
	}
	return &Client{
		HTTP:    &http.Client{Timeout: 60 * time.Second},
		BaseURL: baseURL,
		Token:   tokenFn,
	}
}

func (c *Client) do(ctx context.Context, path string, q url.Values) (*http.Response, error) {
	u := strings.TrimRight(c.BaseURL, "/") + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	send := func(tok string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return nil, err
		}
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		return c.HTTP.Do(req)
	}

	var (
		resp *http.Response
		tok  string
		err  error
	)
	switch {
	case c.authorize != nil:
		resp, tok, err = c.authorize(ctx, send)
	case c.Token != nil:
		if tok, err = c.Token(ctx); err == nil {
			resp, err = send(tok)
		}
	default:
		resp, err = send("")
	}
	if err != nil {
		return nil, err
	}
	if resp.StatusCode/100 != 2 {
		defer resp.Body.Close()
		body, _, _ := blob.ReadAllLimited(resp.Body, 64<<10)
		e := parseAPIError(resp.StatusCode, body)
		e.Message = scrub(e.Message, tok)
		return nil, e
	}
	return resp, nil
}

func (c *Client) getJSON(ctx context.Context, path string, q url.Values, out any) error {
	resp, err := c.do(ctx, path, q)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(out)
}

// parseAPIError reads Google's standard error envelope:
//
//	{"error":{"code":410,"message":"...","errors":[{"reason":"pageTokenInvalid"}]}}
//
// The body is never echoed wholesale into anything user-facing: a Drive error
// message can quote a file name from an account this app may not name back.
func parseAPIError(status int, body []byte) *APIError {
	var env struct {
		Error struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Status  string `json:"status"`
			Errors  []struct {
				Reason  string `json:"reason"`
				Message string `json:"message"`
			} `json:"errors"`
		} `json:"error"`
	}
	e := &APIError{Status: status}
	if json.Unmarshal(body, &env) == nil {
		e.Message = env.Error.Message
		if len(env.Error.Errors) > 0 {
			e.Reason = env.Error.Errors[0].Reason
		} else if env.Error.Status != "" {
			e.Reason = env.Error.Status
		}
	}
	if e.Reason == "" {
		e.Reason = http.StatusText(status)
	}
	return e
}

// escapeQueryLiteral quotes a file id for Drive's query language.
//
// A picked id arrives from the browser, so it is untrusted input going into a
// query string. Drive ids are alphanumeric in practice; "in practice" is not a
// reason to interpolate one unescaped.
func escapeQueryLiteral(s string) string {
	return strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(s)
}

const fileFields = "id,name,mimeType,md5Checksum,modifiedTime,trashed,parents"

// ListFolderChildren expands a picked folder, paged to exhaustion.
//
// This runs AT PICK TIME and never again for the same folder: the scope's own
// wording is per-file, so a file that lands in the folder later was never
// opened with this app and may well be invisible. maxPages bounds a server that
// never stops handing back tokens.
func (c *Client) ListFolderChildren(ctx context.Context, folderID string) ([]File, error) {
	const maxPages = 50
	var out []File
	page := ""
	for i := 0; i < maxPages; i++ {
		q := url.Values{}
		q.Set("q", fmt.Sprintf("'%s' in parents and trashed = false", escapeQueryLiteral(folderID)))
		q.Set("fields", "nextPageToken,incompleteSearch,files("+fileFields+")")
		q.Set("pageSize", "100")
		q.Set("supportsAllDrives", "true")
		q.Set("includeItemsFromAllDrives", "true")
		if page != "" {
			q.Set("pageToken", page)
		}
		var resp fileList
		if err := c.getJSON(ctx, "/files", q, &resp); err != nil {
			return out, err
		}
		out = append(out, resp.Files...)
		if resp.NextPageToken == "" {
			return out, nil
		}
		page = resp.NextPageToken
	}
	return out, errors.New("drive: files.list did not terminate within 50 pages")
}

// GetStartPageToken baselines the change feed, and re-baselines after a 410.
func (c *Client) GetStartPageToken(ctx context.Context) (string, error) {
	q := url.Values{}
	q.Set("supportsAllDrives", "true")
	var resp startPageToken
	if err := c.getJSON(ctx, "/changes/startPageToken", q, &resp); err != nil {
		return "", err
	}
	if resp.StartPageToken == "" {
		return "", errors.New("drive: changes.getStartPageToken returned an empty token")
	}
	return resp.StartPageToken, nil
}

// SyncResult is what one poll of the change feed produced.
type SyncResult struct {
	Changes []Change
	// NextToken is the checkpoint to persist in drive_sync_state.
	NextToken string
	// Rebaselined is true when the stored token was 410 Gone and this call
	// recovered with a fresh one. The caller must treat it as "the change feed
	// lost history" and re-check every grant directly, not as "nothing
	// happened".
	Rebaselined bool
}

// SyncChanges drains changes.list from the stored token and, on 410,
// re-baselines instead of failing the sync.
func (c *Client) SyncChanges(ctx context.Context, storedToken string) (SyncResult, error) {
	const maxPages = 100
	res := SyncResult{}
	page := storedToken
	for i := 0; i < maxPages; i++ {
		q := url.Values{}
		q.Set("pageToken", page)
		q.Set("pageSize", "100")
		// Without includeRemoved a trashed grant never reaches the sync job and
		// the document stays indexed forever.
		q.Set("includeRemoved", "true")
		q.Set("supportsAllDrives", "true")
		q.Set("includeItemsFromAllDrives", "true")
		q.Set("fields", "nextPageToken,newStartPageToken,changes(changeType,time,removed,fileId,file("+fileFields+"))")

		var resp changeList
		err := c.getJSON(ctx, "/changes", q, &resp)
		if err != nil {
			var apiErr *APIError
			if errors.As(err, &apiErr) && apiErr.Gone() {
				// 410: the token is older than Drive's change history. The only
				// recovery is a fresh baseline; the caller then re-reads every
				// grant, because the changes between the two tokens are gone.
				fresh, ferr := c.GetStartPageToken(ctx)
				if ferr != nil {
					return res, fmt.Errorf("re-baseline after 410: %w", ferr)
				}
				return SyncResult{NextToken: fresh, Rebaselined: true}, nil
			}
			return res, err
		}
		res.Changes = append(res.Changes, resp.Changes...)
		if resp.NextPageToken != "" {
			page = resp.NextPageToken
			continue
		}
		res.NextToken = resp.NewStartPageToken
		if res.NextToken == "" {
			return res, errors.New("drive: final changes.list page carried neither nextPageToken nor newStartPageToken")
		}
		return res, nil
	}
	return res, errors.New("drive: changes.list did not terminate within 100 pages")
}

// ExportDoc converts a Google-native file to a portable type.
//
// A Google Doc exports straight to Markdown, which is why a Doc never touches
// the LLM parse lane: the heading structure and tables survive, so phase 5's
// chunker can split it as-is. Non-Google files must use DownloadFile instead —
// export only works on Google-native types.
func (c *Client) ExportDoc(ctx context.Context, fileID, mimeType string) ([]byte, string, error) {
	if mimeType == "" {
		mimeType = MimeMarkdown
	}
	q := url.Values{}
	q.Set("mimeType", mimeType)
	q.Set("supportsAllDrives", "true")
	resp, err := c.do(ctx, "/files/"+url.PathEscape(fileID)+"/export", q)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxExportBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(body) > MaxExportBytes {
		return nil, "", fmt.Errorf("drive: export exceeded Google's %d MB limit", MaxExportBytes>>20)
	}
	return body, resp.Header.Get("Content-Type"), nil
}

// DownloadFile fetches a non-Google file's bytes (files.get?alt=media).
//
// limit caps the read so a 2 GB file in someone's Drive cannot be pulled into
// this process's memory; exceeding it is an error, not a truncation, because a
// half a PDF parses into confident nonsense.
func (c *Client) DownloadFile(ctx context.Context, fileID string, limit int64) ([]byte, error) {
	q := url.Values{}
	q.Set("alt", "media")
	q.Set("supportsAllDrives", "true")
	resp, err := c.do(ctx, "/files/"+url.PathEscape(fileID), q)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("drive: file is larger than the %d MB limit", limit>>20)
	}
	return body, nil
}

// GetFile reads one file's metadata.
//
// This is what the 410 path needs: after a re-baseline the change history is
// gone, so every grant is re-checked directly rather than assumed unchanged.
func (c *Client) GetFile(ctx context.Context, fileID string) (*File, error) {
	q := url.Values{}
	q.Set("fields", fileFields)
	q.Set("supportsAllDrives", "true")
	var f File
	if err := c.getJSON(ctx, "/files/"+url.PathEscape(fileID), q, &f); err != nil {
		return nil, err
	}
	return &f, nil
}
