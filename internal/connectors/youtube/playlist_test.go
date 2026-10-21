package youtube

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPlaylistID(t *testing.T) {
	for raw, want := range map[string]string{
		"https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG":        "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
		"https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG": "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ":                                     "",
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ":                  "",
		"https://evil.example/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG":           "",
		"javascript:alert(1)?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG":                     "",
	} {
		got, ok := PlaylistID(raw)
		if got != want || ok != (want != "") {
			t.Errorf("%s: %q %v", raw, got, ok)
		}
	}
}

func TestParseFlatPlaylist(t *testing.T) {
	pl, err := ParseFlatPlaylist([]byte(`{"id":"PLabc","title":"Linear algebra","entries":[
	 {"id":"aaaaaaaaaaa","title":"1. Vectors"},{"id":"bad"},{"id":"bbbbbbbbbbb","title":"[Deleted video]"},{"id":"ccccccccccc","title":"2. Matrices"}]}`))
	if err != nil || pl.Title != "Linear algebra" || len(pl.Videos) != 2 || pl.Videos[1].URL != "https://www.youtube.com/watch?v=ccccccccccc" {
		t.Fatalf("%+v %v", pl, err)
	}
	if _, err := ParseFlatPlaylist([]byte(`{"entries":[]}`)); !errors.Is(err, ErrPlaylistUnavailable) {
		t.Fatalf("empty: %v", err)
	}
}

func TestPlaylistFromTheDataAPI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "k" {
			t.Errorf("no key")
		}
		switch r.URL.Path {
		case "/playlists":
			_, _ = io.WriteString(w, `{"items":[{"snippet":{"title":"Course"}}]}`)
		case "/playlistItems":
			if r.URL.Query().Get("pageToken") == "" {
				_, _ = io.WriteString(w, `{"items":[{"snippet":{"title":"One","resourceId":{"videoId":"aaaaaaaaaaa"}}},{"snippet":{"title":"Private video","resourceId":{"videoId":"bbbbbbbbbbb"}}}],"nextPageToken":"t2"}`)
			} else {
				_, _ = io.WriteString(w, `{"items":[{"snippet":{"title":"Two","resourceId":{"videoId":"ccccccccccc"}}}]}`)
			}
		}
	}))
	defer srv.Close()
	p := &PlaylistReader{APIKey: "k", HTTP: http.DefaultClient, Base: srv.URL}
	pl, err := p.Read(context.Background(), "https://www.youtube.com/playlist?list=PLabcdefghijk")
	if err != nil || pl.Title != "Course" || len(pl.Videos) != 2 || pl.Videos[0].Title != "One" || pl.Videos[1].ID != "ccccccccccc" {
		t.Fatalf("%+v %v", pl, err)
	}
}
