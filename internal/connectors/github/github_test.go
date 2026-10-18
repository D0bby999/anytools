package github_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/connectors/github"
	"github.com/D0bby999/anytools/internal/security"
)

const sha = "0123456789abcdef0123456789abcdef01234567"

// entry is one archive member.
type entry struct {
	name string
	body []byte
	typ  byte
	link string
	size int64 // for a header that lies about its size; 0 means len(body)
}

func tarball(t *testing.T, entries []entry) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Typeflag: tar.TypeXGlobalHeader, Name: "pax_global_header",
		PAXRecords: map[string]string{"comment": sha}}); err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		typ := e.typ
		if typ == 0 {
			typ = tar.TypeReg
		}
		h := &tar.Header{Name: e.name, Typeflag: typ, Mode: 0o644, Linkname: e.link, Format: tar.FormatPAX}
		if typ == tar.TypeReg {
			h.Size = int64(len(e.body))
		}
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if typ == tar.TypeReg {
			if _, err := tw.Write(e.body); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func readAll(t *testing.T, data []byte, f github.Filter) (*github.Report, []string) {
	t.Helper()
	var kept []string
	rep, err := github.ReadArchive(bytes.NewReader(data), f, func(file github.File) error {
		kept = append(kept, file.Path)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return rep, kept
}

func defaults(t *testing.T, extra ...string) *github.Ignore {
	t.Helper()
	ig, err := github.NewIgnore(github.DefaultIgnore, extra)
	if err != nil {
		t.Fatal(err)
	}
	return ig
}

func TestUnsafeEntriesAreRefusedAndLargeFilesSkipped(t *testing.T) {
	top := "repo-" + sha + "/"
	data := tarball(t, []entry{
		{name: top, typ: tar.TypeDir},
		{name: top + "docs/intro.md", body: []byte("# Intro\n")},
		{name: top + "../escape.md", body: []byte("# Out\n")},
		{name: top + "docs/link.md", typ: tar.TypeSymlink, link: "/etc/passwd"},
		{name: top + "docs/hard.md", typ: tar.TypeLink, link: top + "docs/intro.md"},
		{name: "/abs/path.md", body: []byte("# Abs\n")},
		{name: top + "docs/big.md", body: bytes.Repeat([]byte("a"), 3<<20)},
		{name: top + "docs/after.md", body: []byte("# After\n")},
	})
	rep, kept := readAll(t, data, github.Filter{Extensions: github.DocExtensions, Ignore: defaults(t)})
	if strings.Join(kept, ",") != "docs/intro.md,docs/after.md" {
		t.Fatalf("kept %v", kept)
	}
	if len(rep.Refused) != 4 {
		t.Fatalf("refused %v; want the ../ path, the symlink, the hard link and the absolute path", rep.Refused)
	}
	if len(rep.Skipped) != 1 || rep.Skipped[0] != "docs/big.md" {
		t.Fatalf("skipped %v; want the 3 MB file", rep.Skipped)
	}
}

func TestTheIgnoreListPrefixAndTypesApply(t *testing.T) {
	top := "repo-" + sha + "/"
	data := tarball(t, []entry{
		{name: top + "README.md", body: []byte("# Readme\n")},
		{name: top + "docs/guide.md", body: []byte("# Guide\n")},
		{name: top + "docs/node_modules/pkg/README.md", body: []byte("# dep\n")},
		{name: top + "docs/build/out.md", body: []byte("# built\n")},
		{name: top + "docs/drafts/wip.md", body: []byte("# wip\n")},
		{name: top + "docs/drafts/keep.md", body: []byte("# keep\n")},
		{name: top + "docs/main.go", body: []byte("package main\n")},
		{name: top + "docs/blob.txt", body: []byte("bin\x00ary")},
		{name: top + "docs-old/x.md", body: []byte("# old\n")},
	})
	// The learner ignores drafts/ but re-includes nothing under it (git: a
	// file under an excluded directory cannot be re-included).
	ig := defaults(t, "drafts/", "!drafts/keep.md")
	rep, kept := readAll(t, data, github.Filter{Prefix: "docs", Extensions: github.DocExtensions, Ignore: ig})
	if strings.Join(kept, ",") != "docs/guide.md" {
		t.Fatalf("kept %v", kept)
	}
	if len(rep.Skipped) != 1 || rep.Skipped[0] != "docs/blob.txt" {
		t.Fatalf("a binary under a text extension: skipped %v", rep.Skipped)
	}

	// Code mode adds code types; the default list still applies.
	_, kept = readAll(t, data, github.Filter{Prefix: "docs",
		Extensions: append(append([]string{}, github.DocExtensions...), ".go"), Ignore: defaults(t)})
	if strings.Join(kept, ",") != "docs/guide.md,docs/drafts/wip.md,docs/drafts/keep.md,docs/main.go" {
		t.Fatalf("code mode kept %v", kept)
	}
}

func TestThe2001stFileIsNotImported(t *testing.T) {
	top := "repo-" + sha + "/"
	entries := make([]entry, 0, github.MaxFiles+5)
	for i := 0; i < github.MaxFiles+5; i++ {
		entries = append(entries, entry{name: fmt.Sprintf("%sdocs/p%04d.md", top, i), body: []byte("# p\n")})
	}
	rep, kept := readAll(t, tarball(t, entries), github.Filter{Extensions: github.DocExtensions, Ignore: defaults(t)})
	if len(kept) != github.MaxFiles || rep.Imported != github.MaxFiles || !rep.Capped {
		t.Fatalf("kept %d, imported %d, capped %v", len(kept), rep.Imported, rep.Capped)
	}
	if kept[len(kept)-1] != fmt.Sprintf("docs/p%04d.md", github.MaxFiles-1) {
		t.Fatalf("last kept %s", kept[len(kept)-1])
	}
}

func TestIgnorePatterns(t *testing.T) {
	ig := defaults(t, "/internal/*.md", "**/generated/**", "*.draft.md")
	for p, want := range map[string]bool{
		"node_modules/a/README.md":   true,
		"web/node_modules/README.md": true,
		"vendor/bundle/x.md":         true,  // anchored default
		"docs/vendor/bundle/x.md":    true,  // vendor/ (unanchored, dir) also matches
		"internal/notes.md":          true,  // anchored learner pattern
		"docs/internal/notes.md":     false, // anchored: not at depth
		"a/generated/b/c.md":         true,
		"chapter.draft.md":           true,
		"docs/guide.md":              false,
		"target":                     true,
		"x.min.js":                   true,
		"main.tfstate.backup":        true,
	} {
		if got := ig.Ignored(p); got != want {
			t.Errorf("Ignored(%s) = %v, want %v", p, got, want)
		}
	}
	if err := github.ValidatePatterns([]string{"[unclosed"}); err == nil {
		t.Error("an unclosed class was accepted")
	}
	many := make([]string, github.MaxIgnorePatterns+1)
	for i := range many {
		many[i] = "x"
	}
	if err := github.ValidatePatterns(many); err == nil {
		t.Error("too many patterns were accepted")
	}
}

func TestParseURLAndPrefixes(t *testing.T) {
	for raw, want := range map[string]github.Ref{
		"https://github.com/golang/go":                       {Owner: "golang", Name: "go"},
		"https://github.com/golang/go.git":                   {Owner: "golang", Name: "go"},
		"github.com/vitejs/vite/tree/main/docs/guide":        {Owner: "vitejs", Name: "vite", Branch: "main", Path: "docs/guide"},
		"https://www.github.com/a-b/c.d_e/tree/v2":           {Owner: "a-b", Name: "c.d_e", Branch: "v2"},
		"https://github.com/golang/go/blob/master/README.md": {Owner: "golang", Name: "go"},
	} {
		got, err := github.ParseURL(raw)
		if err != nil || got != want {
			t.Errorf("ParseURL(%s) = %+v, %v; want %+v", raw, got, err, want)
		}
	}
	for _, raw := range []string{"https://gitlab.com/a/b", "http://github.com/a/b", "https://github.com/a",
		"https://github.com/-a/b", "https://github.com/a/..", "https://user:pw@github.com/a/b"} {
		if _, err := github.ParseURL(raw); err == nil {
			t.Errorf("ParseURL(%s) accepted", raw)
		}
	}
	for raw, want := range map[string]string{"": "", "/docs/": "docs", "docs//api": "docs/api", `docs\x`: "docs/x"} {
		if got, ok := github.CleanPrefix(raw); !ok || got != want {
			t.Errorf("CleanPrefix(%q) = %q %v", raw, got, ok)
		}
	}
	if _, ok := github.CleanPrefix("docs/../../etc"); ok {
		t.Error("a climbing prefix was accepted")
	}
	if github.ValidBranch("feature/x") != true || github.ValidBranch("a..b") || github.ValidBranch("-x") || github.ValidBranch("a b") {
		t.Error("branch validation")
	}
}

// ───────────────────────────────────────────── the client against GitHub

func pkt(s string) string { return fmt.Sprintf("%04x%s", len(s)+4, s) }

func advertisement(refs ...string) string {
	var b strings.Builder
	b.WriteString(pkt("# service=git-upload-pack\n"))
	b.WriteString("0000")
	for i, r := range refs {
		if i == 0 {
			r = strings.Replace(r, "\n", "\x00multi_ack side-band-64k symref=HEAD:refs/heads/main agent=git/github\n", 1)
		}
		b.WriteString(pkt(r))
	}
	b.WriteString("0000")
	return b.String()
}

type fakeGitHub struct {
	mu       sync.Mutex
	token    string
	tarball  []byte
	refs     string
	hits     map[string]int
	authSeen map[string]string
	status   map[string]int
}

func (f *fakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := r.Host + r.URL.Path
	f.hits[key]++
	f.authSeen[key] = r.Header.Get("Authorization")
	if st, ok := f.status[key]; ok {
		if st < 0 {
			// The connection drops: Go's error then names the URL, which for
			// codeload carries the redirect's grant.
			conn, _, _ := w.(http.Hijacker).Hijack()
			_ = conn.Close()
			return
		}
		http.Error(w, "upstream says "+f.token, st) // a body echoing the token must not surface
		return
	}
	switch {
	case r.Host == "gh.example.com" && strings.HasSuffix(r.URL.Path, ".git/info/refs"):
		w.Header().Set("Content-Type", "application/x-git-upload-pack-advertisement")
		_, _ = w.Write([]byte(f.refs))
	case r.Host == "api.example.com" && strings.HasPrefix(r.URL.Path, "/repos/"):
		if r.Header.Get("Authorization") != "Bearer "+f.token {
			http.Error(w, "bad credentials", http.StatusUnauthorized)
			return
		}
		http.Redirect(w, r, "https://codeload.example.com/acme/docs/legacy.tar.gz/"+sha+"?token=GRANT-"+f.token[:4], http.StatusFound)
	case r.Host == "api.example.com" && r.URL.Path == "/rate_limit":
		if r.Header.Get("Authorization") != "Bearer "+f.token {
			http.Error(w, "bad credentials", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resources":{}}`))
	case r.Host == "codeload.example.com":
		w.Header().Set("Content-Type", "application/x-gzip")
		_, _ = w.Write(f.tarball)
	default:
		http.NotFound(w, r)
	}
}

func newFake(t *testing.T) (*fakeGitHub, *github.Client) {
	t.Helper()
	f := &fakeGitHub{token: "github_pat_SECRET0123456789", hits: map[string]int{},
		authSeen: map[string]string{}, status: map[string]int{}}
	srv := httptest.NewTLSServer(f)
	t.Cleanup(srv.Close)
	addr := srv.Listener.Addr().String()
	base := security.FetchClientWith(10*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("140.82.112.3")}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
	base.Transport.(*http.Transport).TLSClientConfig = srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	return f, github.NewClientFor(base, "https://gh.example.com", "https://api.example.com", "https://codeload.example.com")
}

func TestLatestCommitReadsTheRefAdvertisement(t *testing.T) {
	f, c := newFake(t)
	other := strings.Repeat("b", 40)
	f.refs = advertisement(sha+" HEAD\n", other+" refs/heads/dev\n", sha+" refs/heads/main\n",
		strings.Repeat("c", 40)+" refs/pull/1/head\n", strings.Repeat("d", 40)+" refs/tags/v1\n")
	ctx := context.Background()

	head, err := c.LatestCommit(ctx, "acme", "docs", "", "")
	if err != nil || head.Branch != "main" || head.SHA != sha {
		t.Fatalf("default branch: %+v %v", head, err)
	}
	head, err = c.LatestCommit(ctx, "acme", "docs", "dev", "")
	if err != nil || head.SHA != other {
		t.Fatalf("named branch: %+v %v", head, err)
	}
	if _, err := c.LatestCommit(ctx, "acme", "docs", "nope", ""); err == nil || !strings.Contains(err.Error(), "no branch") {
		t.Fatalf("missing branch: %v", err)
	}
	// With a token, git's basic auth carries it to github.com only.
	if _, err := c.LatestCommit(ctx, "acme", "docs", "", f.token); err != nil {
		t.Fatal(err)
	}
	if got := f.authSeen["gh.example.com/acme/docs.git/info/refs"]; !strings.HasPrefix(got, "Basic ") {
		t.Fatalf("auth sent to github.com: %q", got)
	}

	f.refs = pkt("# service=git-upload-pack\n") + "0000" + "0000"
	if _, err := c.LatestCommit(ctx, "acme", "docs", "", ""); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("empty repository: %v", err)
	}
}

func TestImportPublicAndPrivate(t *testing.T) {
	f, c := newFake(t)
	f.tarball = tarball(t, []entry{{name: "docs-" + sha + "/guide.md", body: []byte("# Guide\n")}})
	ctx := context.Background()
	filter := github.Filter{Extensions: github.DocExtensions, Ignore: defaults(t)}
	var got []string
	keep := func(file github.File) error { got = append(got, file.Path); return nil }

	if _, err := c.Import(ctx, "acme", "docs", sha, "", filter, keep); err != nil || len(got) != 1 {
		t.Fatalf("public: %v %v", got, err)
	}
	if f.hits["api.example.com/repos/acme/docs/tarball/"+sha] != 0 {
		t.Fatal("a public import went through the API")
	}

	got = nil
	if _, err := c.Import(ctx, "acme", "docs", sha, f.token, filter, keep); err != nil || len(got) != 1 {
		t.Fatalf("private: %v %v", got, err)
	}
	// The token went to the API and stayed there: the redirect to codeload
	// carried no Authorization header.
	for key, auth := range f.authSeen {
		if strings.HasPrefix(key, "codeload.example.com") && auth != "" {
			t.Fatalf("the token followed the redirect to %s", key)
		}
	}
}

func TestTheTokenNeverAppearsInAnError(t *testing.T) {
	f, c := newFake(t)
	ctx := context.Background()
	filter := github.Filter{Extensions: github.DocExtensions, Ignore: defaults(t)}
	keep := func(github.File) error { return nil }
	check := func(name string, err error) {
		t.Helper()
		if err == nil {
			t.Fatalf("%s: no error", name)
		}
		for _, s := range []string{err.Error(), fmt.Sprintf("%+v", err), fmt.Sprintf("%#v", err)} {
			if strings.Contains(s, f.token) || strings.Contains(s, f.token[:12]) || strings.Contains(s, "GRANT") {
				t.Fatalf("%s: the token appears in the error: %s", name, s)
			}
		}
	}

	// A wrong token, then the codeload grant URL failing after the redirect.
	_, err := c.Import(ctx, "acme", "docs", sha, f.token+"x", filter, keep)
	check("refused token", err)
	var ge *github.Error
	if !errors.As(err, &ge) || ge.Code != github.CodeBadToken {
		t.Fatalf("refused token: %v", err)
	}
	f.status["codeload.example.com/acme/docs/legacy.tar.gz/"+sha] = http.StatusInternalServerError
	_, err = c.Import(ctx, "acme", "docs", sha, f.token, filter, keep)
	check("codeload failure", err)
	f.status["codeload.example.com/acme/docs/legacy.tar.gz/"+sha] = -1
	_, err = c.Import(ctx, "acme", "docs", sha, f.token, filter, keep)
	check("codeload connection dropped", err)
	f.status["gh.example.com/acme/docs.git/info/refs"] = http.StatusForbidden
	_, err = c.LatestCommit(ctx, "acme", "docs", "", f.token)
	check("refs refused", err)
	check("ping", c.Ping(ctx, f.token+"x"))
	if err := c.Ping(ctx, f.token); err != nil {
		t.Fatalf("a good token: %v", err)
	}
}

func TestAPrivateAddressIsRefused(t *testing.T) {
	base := security.FetchClientWith(2*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("169.254.169.254")}}, nil
		},
		Dial: (&net.Dialer{}).DialContext,
	})
	c := github.NewClient(base)
	_, err := c.LatestCommit(context.Background(), "acme", "docs", "", "")
	if !github.IsInternal(err) {
		t.Fatalf("a GitHub name resolving to a private address: %v", err)
	}
}
