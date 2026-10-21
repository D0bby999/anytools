package gphotos

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
)

type doer struct{}

func (doer) GoogleDo(_ context.Context, _ uuid.UUID, _ []string, send func(string) (*http.Response, error)) (*http.Response, error) {
	return send("tok")
}

func TestPickerSession(t *testing.T) {
	ready, deleted := false, false
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/sessions":
			_, _ = io.WriteString(w, `{"id":"s1","pickerUri":"https://photos.google.com/picker/s1","pollingConfig":{"pollInterval":"5s"}}`)
		case r.Method == http.MethodGet && r.URL.Path == "/sessions/s1":
			if ready {
				_, _ = io.WriteString(w, `{"id":"s1","mediaItemsSet":true}`)
			} else {
				_, _ = io.WriteString(w, `{"id":"s1","mediaItemsSet":false}`)
			}
		case r.Method == http.MethodGet && r.URL.Path == "/mediaItems":
			_, _ = io.WriteString(w, `{"mediaItems":[
			 {"type":"PHOTO","mediaFile":{"baseUrl":"`+srv.URL+`/media/a","mimeType":"image/jpeg","filename":"board.jpg"}},
			 {"type":"VIDEO","mediaFile":{"baseUrl":"`+srv.URL+`/media/v","mimeType":"video/mp4","filename":"clip.mp4"}},
			 {"type":"PHOTO","mediaFile":{"baseUrl":"`+srv.URL+`/media/big","mimeType":"image/png","filename":"huge.png"}}]}`)
		case r.URL.Path == "/media/a=d":
			_, _ = io.WriteString(w, "JPEGDATA")
		case r.URL.Path == "/media/big=d":
			_, _ = io.WriteString(w, strings.Repeat("x", 100))
		case r.Method == http.MethodDelete && r.URL.Path == "/sessions/s1":
			deleted = true
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()
	svc := NewService(doer{})
	svc.SetBaseURL(srv.URL)
	ctx, user := context.Background(), uuid.New()

	s, err := svc.Start(ctx, user)
	if err != nil || s.PickerURI != "https://photos.google.com/picker/s1/autoclose" || s.PollMS != 5000 {
		t.Fatalf("%+v %v", s, err)
	}
	if _, err := svc.Take(ctx, user, "s1", 50); !errors.Is(err, ErrNotReady) {
		t.Fatalf("not ready: %v", err)
	}
	ready = true
	photos, err := svc.Take(ctx, user, "s1", 50)
	if err != nil || len(photos) != 1 || photos[0].Name != "board.jpg" || string(photos[0].Data) != "JPEGDATA" || !deleted {
		t.Fatalf("photos=%v err=%v deleted=%v", photos, err, deleted)
	}
	if _, err := svc.Poll(ctx, user, "../x"); err == nil {
		t.Fatal("a path in a session id is refused")
	}
	if NewService(doer{}).mediaOK(mustURL("https://evil.example/a")) {
		t.Fatal("only Google's media hosts get the token")
	}
}

func mustURL(s string) *url.URL {
	u, _ := url.Parse(s)
	return u
}
