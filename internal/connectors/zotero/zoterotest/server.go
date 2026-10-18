// Package zoterotest is a scripted Zotero Web API for tests: one library
// (user 475425), two items, one collection, a stored PDF behind a redirect
// to another host, and the key check. The JSON under testdata follows the
// Web API v3 documentation's shapes; no live library was recorded, since no
// key is available to this project's tests.
package zoterotest

import (
	"context"
	"embed"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/connectors/zotero"
	"github.com/D0bby999/anytools/internal/security"
)

//go:embed testdata/*.json
var fixtures embed.FS

// The fixture library.
const (
	UserID = "475425"
	// Key is shaped like a real key (24 letters and digits) so the redaction
	// tests catch it by shape too.
	Key = "KEY0REDACTED0FIXTURE0000"
	// ItemWithPDF has a PDF in Zotero storage; ItemWithoutPDF only a linked
	// file on the learner's computer.
	ItemWithPDF    = "ABCD2345"
	ItemWithoutPDF = "NOPD2345"
	Collection     = "COLL2345"
	// APIBase and FilesHost are the fixture's names for Zotero's hosts
	// (httptest's certificate covers *.example.com).
	APIBase   = "https://zotero-api.example.com"
	FilesHost = "zotero-files.example.com"
)

// Server is the fixture.
type Server struct {
	srv *httptest.Server
	// PDF is what the stored attachment's file holds.
	PDF []byte
	// Calls counts every request that reached the fixture.
	Calls atomic.Int64
	// KeyAtStorage is set when a request to the file host carried the key.
	KeyAtStorage atomic.Bool
	mu           sync.Mutex
	paths        []string
}

// New starts the fixture.
func New(t testing.TB) *Server {
	t.Helper()
	s := &Server{PDF: []byte("%PDF-1.4\n%%EOF\n")}
	s.srv = httptest.NewTLSServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.srv.Close)
	return s
}

// Close stops the fixture early, so a client meets a transport failure.
func (s *Server) Close() { s.srv.Close() }

// Paths returns the paths requested so far, with their queries.
func (s *Server) Paths() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.paths...)
}

// HTTPClient is the guarded fetch client with every name resolved to a
// public address and every connection dialled to the fixture.
func (s *Server) HTTPClient() *http.Client {
	addr := s.srv.Listener.Addr().String()
	c := security.FetchClientWith(10*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
	c.Transport.(*http.Transport).TLSClientConfig = s.srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	return c
}

// Client is a zotero.Client aimed at the fixture.
func (s *Server) Client() *zotero.Client { return zotero.NewClientFor(s.HTTPClient(), APIBase) }

// Credential is the fixture library's credential.
func Credential() zotero.Credential { return zotero.Credential{UserID: UserID, Key: Key} }

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	s.Calls.Add(1)
	s.mu.Lock()
	s.paths = append(s.paths, r.URL.RequestURI())
	s.mu.Unlock()

	if r.Host == FilesHost {
		if r.Header.Get("Authorization") != "" {
			s.KeyAtStorage.Store(true)
		}
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write(s.PDF)
		return
	}
	// A refusal that echoes the request's credentials, as a careless
	// upstream might: none of it may reach the learner or a log.
	refuse := func(status int) {
		http.Error(w, "Forbidden for "+r.Header.Get("Authorization")+" at "+r.URL.Path, status)
	}
	path := r.URL.Path
	if strings.HasPrefix(path, "/keys/") {
		if strings.TrimPrefix(path, "/keys/") != Key {
			refuse(http.StatusNotFound)
			return
		}
		s.json(w, "key.json")
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+Key || r.Header.Get("Zotero-API-Version") != "3" {
		refuse(http.StatusForbidden)
		return
	}
	prefix := "/users/" + UserID
	if !strings.HasPrefix(path, prefix+"/") {
		refuse(http.StatusForbidden)
		return
	}
	switch rest := strings.TrimPrefix(path, prefix); rest {
	case "/items/top", "/collections/" + Collection + "/items/top":
		if r.URL.Query().Get("itemType") != "-attachment" {
			http.Error(w, "the fixture expects attachments excluded", http.StatusBadRequest)
			return
		}
		if q := r.URL.Query().Get("q"); q == "nothing" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("[]"))
			return
		}
		s.json(w, "items_top.json")
	case "/collections/top":
		s.json(w, "collections_top.json")
	case "/collections/" + Collection + "/collections":
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	case "/items/" + ItemWithPDF, "/items/" + ItemWithoutPDF:
		s.json(w, "item_"+strings.TrimPrefix(rest, "/items/")+".json")
	case "/items/" + ItemWithPDF + "/children", "/items/" + ItemWithoutPDF + "/children":
		s.json(w, "children_"+strings.TrimSuffix(strings.TrimPrefix(rest, "/items/"), "/children")+".json")
	case "/items/PDFK2345/file":
		// Zotero answers with a redirect to its file storage.
		http.Redirect(w, r, "https://"+FilesHost+"/storage/PDFK2345?signature=fixture", http.StatusFound)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) json(w http.ResponseWriter, name string) {
	b, err := fixtures.ReadFile("testdata/" + name)
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(b)
}
