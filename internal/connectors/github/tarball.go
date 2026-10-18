// Package github reads a GitHub repository for the Knowledge Center
// (up-methods phase 18): which commit a branch is at, and the repository's
// files from ONE tarball request.
//
// One request, not one per file: anything-llm's RepoLoader warns that the
// per-file API exhausts its rate limit, and DeepTutor's sync spends a request
// per file too. The commit comes from git's smart-HTTP ref advertisement on
// github.com, which has no API rate limit, and the files from the tarball
// (codeload.github.com, or the API's tarball redirect with a token). Every
// request goes through an allowlisted client over the guarded fetch client
// (internal/security), so nothing a repository says can send the server, or
// the learner's token, anywhere else.
//
// Caps: a file at most 2 MB (DeepTutor, services/github_source/client.py),
// at most 2,000 files and 100 MB a repository (gitingest allows 10,000 files
// of 10 MB; each file here is embedded on the learner's own key).
package github

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/D0bby999/anytools/internal/security"
)

// Caps.
const (
	MaxFileBytes = 2 << 20
	MaxFiles     = 2000
	MaxRepoBytes = 100 << 20
	// maxInflated bounds what the gzip stream may expand to, whatever the
	// compressed size: a tarball is a stranger's bytes.
	maxInflated = 1 << 30
	// maxRefsBytes bounds the ref advertisement; it is read only as far as
	// the branch asked for.
	maxRefsBytes = security.MaxFetchBytes
)

// DocExtensions are the documentation types imported by default, as
// DeepTutor imports; CodeExtensions are offered for gitingest's code mode.
var (
	DocExtensions  = []string{".md", ".mdx", ".rst", ".txt", ".adoc"}
	CodeExtensions = []string{".go", ".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".kt", ".rs",
		".rb", ".php", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".swift", ".scala", ".sh",
		".sql", ".yaml", ".yml", ".toml"}
)

// Error is a refusal whose message is written for the learner. It never
// carries a URL, a header or anything GitHub sent, so a token cannot leak
// through it.
type Error struct {
	Code string
	Msg  string
	// internal is set when the fetch guard refused an address.
	internal bool
}

func (e *Error) Error() string { return e.Msg }

// Error codes.
const (
	CodeNotFound    = "not_found"
	CodeRateLimited = "rate_limited"
	CodeBadToken    = "bad_token"
	CodeTooLarge    = "too_large"
	CodeNetwork     = "network"
	CodeBadArchive  = "bad_archive"
	CodeEmpty       = "empty"
)

// IsInternal reports whether the fetch guard refused the address.
func IsInternal(err error) bool {
	var e *Error
	return errors.As(err, &e) && e.internal
}

// Client reads repositories.
type Client struct {
	http *http.Client
	web  string
	api  string
	load string
}

// Production hosts.
const (
	WebBase      = "https://github.com"
	APIBase      = "https://api.github.com"
	CodeloadBase = "https://codeload.github.com"
)

// NewClient restricts base (security.FetchClient in production) to GitHub's
// three hosts.
func NewClient(base *http.Client) *Client {
	return NewClientFor(base, WebBase, APIBase, CodeloadBase)
}

// NewClientFor is NewClient with other base URLs; tests aim them at a fixture.
func NewClientFor(base *http.Client, web, api, codeload string) *Client {
	var hosts []string
	for _, b := range []string{web, api, codeload} {
		if u, err := url.Parse(b); err == nil {
			hosts = append(hosts, u.Host)
		}
	}
	return &Client{http: security.AllowlistClientOver(base, hosts...),
		web: strings.TrimRight(web, "/"), api: strings.TrimRight(api, "/"), load: strings.TrimRight(codeload, "/")}
}

// ─────────────────────────────────────────────────────────── a repo URL

// Ref names a repository, and the branch and folder a URL pointed at.
type Ref struct {
	Owner, Name string
	// Branch and Path come from a /tree/<branch>/<path> URL. A branch with a
	// slash in it cannot be told apart from a folder there, so the form's own
	// branch field wins over this guess.
	Branch, Path string
}

var (
	ownerPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`)
	namePattern  = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)
)

// ParseURL reads https://github.com/<owner>/<repo>[.git][/tree/<branch>[/<path>]].
func ParseURL(raw string) (Ref, error) {
	bad := &Error{Code: CodeNotFound, Msg: "that is not a GitHub repository link (https://github.com/owner/repository)"}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || len(raw) > 2048 {
		return Ref{}, bad
	}
	if u.Scheme == "" && u.Host == "" {
		// "github.com/owner/repo" without a scheme.
		if u, err = url.Parse("https://" + strings.TrimSpace(raw)); err != nil {
			return Ref{}, bad
		}
	}
	if u.Scheme != "https" || (strings.ToLower(u.Host) != "github.com" && strings.ToLower(u.Host) != "www.github.com") || u.User != nil {
		return Ref{}, bad
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 {
		return Ref{}, bad
	}
	ref := Ref{Owner: parts[0], Name: strings.TrimSuffix(parts[1], ".git")}
	if !ownerPattern.MatchString(ref.Owner) || !namePattern.MatchString(ref.Name) || ref.Name == "." || ref.Name == ".." {
		return Ref{}, bad
	}
	if len(parts) >= 4 && parts[2] == "tree" {
		ref.Branch = parts[3]
		ref.Path = strings.Join(parts[4:], "/")
	}
	return ref, nil
}

// CleanPrefix normalises a path prefix: relative, slash-separated, no
// trailing slash, "" for the root. A prefix that climbs out is refused.
func CleanPrefix(p string) (string, bool) {
	p = strings.TrimSpace(strings.ReplaceAll(p, `\`, "/"))
	p = strings.Trim(p, "/")
	if p == "" {
		return "", true
	}
	if !safePath(p) || len(p) > 512 {
		return "", false
	}
	return path.Clean(p), true
}

// ValidBranch reports whether a branch name is one git would accept, as far
// as it matters here: no control characters, no "..", no leading dash.
func ValidBranch(b string) bool {
	if b == "" || len(b) > 255 || strings.HasPrefix(b, "-") || strings.Contains(b, "..") ||
		strings.HasSuffix(b, "/") || strings.HasSuffix(b, ".lock") {
		return false
	}
	for _, r := range b {
		if r < 0x20 || r == 0x7f || strings.ContainsRune(" ~^:?*[\\", r) {
			return false
		}
	}
	return true
}

// ─────────────────────────────────────────────────────── latest commit

// Head is the commit a branch points at.
type Head struct {
	Branch string
	SHA    string
}

func (c *Client) header(token string, basic bool) http.Header {
	h := http.Header{}
	if token == "" {
		return h
	}
	if basic {
		// Git over HTTPS takes a token as the password of any user name.
		h.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("x-access-token:"+token)))
	} else {
		h.Set("Authorization", "Bearer "+token)
	}
	return h
}

// LatestCommit resolves branch ("" for the repository's default) to its
// commit, from git's ref advertisement.
func (c *Client) LatestCommit(ctx context.Context, owner, name, branch, token string) (Head, error) {
	s, err := security.OpenStream(ctx, c.http, security.PageRequest{
		URL:       fmt.Sprintf("%s/%s/%s.git/info/refs?service=git-upload-pack", c.web, url.PathEscape(owner), url.PathEscape(name)),
		Accept:    "*/*",
		UserAgent: "git/2.45.0 (AnyTools)",
		Types:     []string{"application/x-git-upload-pack-advertisement"},
		Header:    c.header(token, true),
	}, maxRefsBytes)
	if err != nil {
		return Head{}, fetchError(err, token != "")
	}
	defer s.Body.Close()
	head, err := readRefs(s.Body, branch)
	if err != nil {
		return Head{}, err
	}
	return head, nil
}

// readRefs walks the pkt-line advertisement only as far as it must. The
// first ref line is HEAD, whose capabilities name the default branch
// (symref=HEAD:refs/heads/<name>); branches follow in sorted order.
func readRefs(r io.Reader, branch string) (Head, error) {
	br := bufio.NewReader(r)
	want := "refs/heads/" + branch
	sawAny := false
	var headSHA, defaultRef string
	for {
		line, flush, err := readPkt(br)
		if err == io.EOF {
			break
		}
		if err != nil {
			return Head{}, &Error{Code: CodeNetwork, Msg: "GitHub's answer about the repository could not be read"}
		}
		if flush || strings.HasPrefix(line, "# service=") {
			continue
		}
		refPart, caps, _ := strings.Cut(line, "\x00")
		sha, ref, ok := strings.Cut(strings.TrimRight(refPart, "\n"), " ")
		if !ok || !isSHA(sha) {
			continue
		}
		if !sawAny {
			sawAny = true
			for _, c := range strings.Fields(caps) {
				if v, ok := strings.CutPrefix(c, "symref=HEAD:"); ok {
					defaultRef = v
				}
			}
		}
		if ref == "HEAD" {
			headSHA = sha
			if branch == "" && defaultRef != "" {
				return Head{Branch: strings.TrimPrefix(defaultRef, "refs/heads/"), SHA: sha}, nil
			}
			continue
		}
		if branch != "" && ref == want {
			return Head{Branch: branch, SHA: sha}, nil
		}
		if branch == "" && ref == defaultRef {
			return Head{Branch: strings.TrimPrefix(ref, "refs/heads/"), SHA: sha}, nil
		}
		if !strings.HasPrefix(ref, "refs/heads/") && ref > "refs/heads/" {
			// Past the branches: refs are sorted, so it is not there.
			break
		}
	}
	if !sawAny {
		return Head{}, &Error{Code: CodeEmpty, Msg: "the repository is empty"}
	}
	if branch == "" && headSHA != "" {
		return Head{}, &Error{Code: CodeNotFound, Msg: "the repository's default branch could not be found; name a branch"}
	}
	return Head{}, &Error{Code: CodeNotFound, Msg: fmt.Sprintf("the repository has no branch named %q", branch)}
}

// readPkt reads one pkt-line: four hex digits of length (including
// themselves), then the payload; 0000 is a flush.
func readPkt(r *bufio.Reader) (string, bool, error) {
	var lenHex [4]byte
	if _, err := io.ReadFull(r, lenHex[:]); err != nil {
		return "", false, err
	}
	n, err := strconv.ParseUint(string(lenHex[:]), 16, 16)
	if err != nil {
		return "", false, fmt.Errorf("pkt-line length %q", lenHex)
	}
	if n == 0 {
		return "", true, nil
	}
	if n < 4 {
		return "", false, fmt.Errorf("pkt-line length %d", n)
	}
	buf := make([]byte, n-4)
	if _, err := io.ReadFull(r, buf); err != nil {
		return "", false, err
	}
	return string(buf), false, nil
}

func isSHA(s string) bool {
	if len(s) != 40 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil && strings.ToLower(s) == s
}

// ────────────────────────────────────────────────────────────── tarball

// Filter is what an import keeps.
type Filter struct {
	// Prefix is a CleanPrefix result: "" for the whole repository.
	Prefix string
	// Extensions are lowercase with the dot.
	Extensions []string
	Ignore     *Ignore
}

// File is one imported file.
type File struct {
	Path string
	Data []byte
}

// Report is what an import left out, for the learner.
type Report struct {
	Imported int
	Bytes    int64
	// Refused are unsafe entries: a path that climbs out or is absolute, a
	// symbolic or hard link. Never written anywhere.
	Refused []string
	// Skipped are files over MaxFileBytes, or not text.
	Skipped []string
	// Capped is set when the file or byte cap stopped the import; files after
	// it were not read.
	Capped bool
}

// Import reads the tarball of sha and calls keep for every file the filter
// accepts, in archive order. An error from keep ends the import.
func (c *Client) Import(ctx context.Context, owner, name, sha, token string, f Filter, keep func(File) error) (*Report, error) {
	if !isSHA(sha) {
		return nil, &Error{Code: CodeNotFound, Msg: "that commit cannot be downloaded"}
	}
	target := fmt.Sprintf("%s/%s/%s/tar.gz/%s", c.load, url.PathEscape(owner), url.PathEscape(name), sha)
	if token != "" {
		// The API's tarball endpoint answers with a redirect to codeload
		// carrying a short-lived grant; the token itself stays on api.
		target = fmt.Sprintf("%s/repos/%s/%s/tarball/%s", c.api, url.PathEscape(owner), url.PathEscape(name), sha)
	}
	s, err := security.OpenStream(ctx, c.http, security.PageRequest{
		URL:       target,
		Accept:    "application/x-gzip, application/gzip, application/octet-stream",
		UserAgent: "AnyTools/1.0",
		Types:     []string{"application/x-gzip", "application/gzip", "application/octet-stream"},
		Header:    c.header(token, false),
	}, MaxRepoBytes)
	if err != nil {
		return nil, fetchError(err, token != "")
	}
	defer s.Body.Close()
	rep, err := ReadArchive(s.Body, f, keep)
	if err != nil {
		var ge *Error
		if errors.As(err, &ge) || ctx.Err() != nil {
			return nil, err
		}
		if errors.Is(err, security.ErrStreamTooLarge) {
			return nil, &Error{Code: CodeTooLarge, Msg: "the repository's download is larger than 100 MB; pick a folder or fewer file types"}
		}
		return nil, err
	}
	return rep, nil
}

// ReadArchive applies the filter and caps to a gzipped tar stream. GitHub's
// tarballs put everything under one top folder (<repo>-<sha>/), which is
// removed from every path.
func ReadArchive(r io.Reader, f Filter, keep func(File) error) (*Report, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return nil, archiveError(err)
	}
	defer gz.Close()
	tr := tar.NewReader(&inflateBudget{r: gz, left: maxInflated})

	exts := map[string]bool{}
	for _, e := range f.Extensions {
		exts[strings.ToLower(e)] = true
	}
	rep := &Report{}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return rep, nil
		}
		if err != nil {
			return nil, archiveError(err)
		}
		switch hdr.Typeflag {
		case tar.TypeXGlobalHeader, tar.TypeDir:
			continue
		}
		rel, ok := entryPath(hdr.Name)
		if !ok {
			rep.Refused = append(rep.Refused, printable(hdr.Name))
			continue
		}
		if hdr.Typeflag == tar.TypeSymlink || hdr.Typeflag == tar.TypeLink {
			rep.Refused = append(rep.Refused, rel)
			continue
		}
		if hdr.Typeflag != tar.TypeReg || rel == "" {
			continue
		}
		if f.Prefix != "" && rel != f.Prefix && !strings.HasPrefix(rel, f.Prefix+"/") {
			continue
		}
		if !exts[strings.ToLower(path.Ext(rel))] || f.Ignore.Ignored(rel) {
			continue
		}
		if hdr.Size > MaxFileBytes {
			rep.Skipped = append(rep.Skipped, rel)
			continue
		}
		if rep.Imported >= MaxFiles || rep.Bytes+hdr.Size > MaxRepoBytes {
			rep.Capped = true
			return rep, nil
		}
		data, err := io.ReadAll(io.LimitReader(tr, MaxFileBytes+1))
		if err != nil {
			return nil, archiveError(err)
		}
		if len(data) > MaxFileBytes {
			rep.Skipped = append(rep.Skipped, rel)
			continue
		}
		if !isText(data) {
			rep.Skipped = append(rep.Skipped, rel)
			continue
		}
		if err := keep(File{Path: rel, Data: data}); err != nil {
			return nil, err
		}
		rep.Imported++
		rep.Bytes += int64(len(data))
	}
}

// entryPath validates an archive name and removes the top folder: no
// absolute path, no "..", no backslash or NUL, no empty segment trickery.
func entryPath(name string) (string, bool) {
	if name == "" || strings.HasPrefix(name, "/") || strings.ContainsAny(name, "\\\x00") {
		return "", false
	}
	if !safePath(strings.TrimSuffix(name, "/")) {
		return "", false
	}
	_, rest, found := strings.Cut(name, "/")
	if !found {
		return "", true // the top folder itself
	}
	return strings.TrimSuffix(rest, "/"), true
}

// safePath reports whether p stays inside its root.
func safePath(p string) bool {
	if strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\\\x00") {
		return false
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return false
		}
	}
	return true
}

func printable(s string) string {
	s = strings.ToValidUTF8(strings.ReplaceAll(s, "\x00", ""), "?")
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// isText refuses a file with a NUL byte in its first 8 KB, or that is not
// UTF-8: a binary under a text extension.
func isText(data []byte) bool {
	head := data
	if len(head) > 8<<10 {
		head = head[:8<<10]
	}
	return bytes.IndexByte(head, 0) < 0 && utf8.Valid(data)
}

// inflateBudget fails a decompressed stream past its budget.
type inflateBudget struct {
	r    io.Reader
	left int64
}

func (b *inflateBudget) Read(p []byte) (int, error) {
	if b.left <= 0 {
		return 0, &Error{Code: CodeTooLarge, Msg: "the repository expands to more than 1 GB; pick a folder"}
	}
	if int64(len(p)) > b.left {
		p = p[:b.left]
	}
	n, err := b.r.Read(p)
	b.left -= int64(n)
	return n, err
}

func archiveError(err error) error {
	var ge *Error
	if errors.As(err, &ge) {
		return ge
	}
	if errors.Is(err, security.ErrStreamTooLarge) {
		return err
	}
	return &Error{Code: CodeBadArchive, Msg: "GitHub's download of the repository could not be read"}
}

// fetchError turns a fetch failure into a sentence. The raw error is
// dropped: a transport error names the URL, and a codeload redirect's URL
// carries a short-lived grant.
func fetchError(err error, withToken bool) error {
	var status *security.HTTPStatusError
	switch {
	case security.IsInternalAddress(err) || errors.Is(err, security.ErrFetchURL):
		return &Error{Code: CodeNetwork, Msg: "GitHub's address did not resolve to the public internet", internal: true}
	case errors.Is(err, security.ErrStreamTooLarge):
		return &Error{Code: CodeTooLarge, Msg: "GitHub's answer was larger than allowed"}
	case errors.As(err, &status) && (status.Status == 401 || status.Status == 403) && withToken:
		return &Error{Code: CodeBadToken, Msg: "GitHub refused your token; check that it can read this repository's contents"}
	case errors.As(err, &status) && status.Status == 429:
		return &Error{Code: CodeRateLimited, Msg: "GitHub is rate-limiting this server; try again later"}
	case errors.As(err, &status) && (status.Status == 401 || status.Status == 403 || status.Status == 404):
		if withToken {
			return &Error{Code: CodeNotFound, Msg: "the repository or branch was not found with your token"}
		}
		return &Error{Code: CodeNotFound, Msg: "the repository was not found; if it is private, add a GitHub token in Settings"}
	case errors.As(err, &status):
		return &Error{Code: CodeNetwork, Msg: fmt.Sprintf("GitHub answered HTTP %d", status.Status)}
	case errors.Is(err, security.ErrPageType):
		return &Error{Code: CodeNetwork, Msg: "GitHub answered with something other than the repository"}
	}
	return &Error{Code: CodeNetwork, Msg: "GitHub could not be reached"}
}

// Ping checks a token with one request to the API's rate-limit endpoint,
// which any valid token may read and which costs no quota.
func (c *Client) Ping(ctx context.Context, token string) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, err := security.FetchPage(ctx, c.http, security.PageRequest{
		URL:       c.api + "/rate_limit",
		Accept:    "application/vnd.github+json",
		UserAgent: "AnyTools/1.0",
		Types:     []string{"application/json"},
		Header:    c.header(token, false),
		MaxBytes:  64 << 10,
	})
	if err != nil {
		return fetchError(err, true)
	}
	return nil
}
