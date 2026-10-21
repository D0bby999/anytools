package wordsources

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// fake answers as the three services did when read on 2026-10-21.
func fake(t *testing.T, calls *atomic.Int32) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/unstable/sentences", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		q := r.URL.Query()
		if q.Get("sort") == "" || q.Get("lang") != "eng" || q.Get("q") != "=carefully" || q.Get("trans:lang") != "vie" {
			http.Error(w, "bad query "+r.URL.RawQuery, 400)
			return
		}
		io.WriteString(w, `{"data":[
		 {"id":2107662,"text":"Watch carefully.","license":"CC BY 2.0 FR","owner":"CK","is_unapproved":false,
		  "translations":[{"text":"Hãy xem kỹ.","lang":"vie","license":"CC BY 2.0 FR","owner":"a","is_direct":false},
		                  {"text":"Hãy nhìn thật kỹ.","lang":"vie","license":"CC BY 2.0 FR","owner":"dotheduyet1999","is_direct":true}]},
		 {"id":2,"text":"Unchecked carefully.","license":"CC BY 2.0 FR","owner":"x","is_unapproved":true,"translations":[]},
		 {"id":3,"text":"No licence carefully.","license":"","owner":"x","translations":[]}]}`)
	})
	mux.HandleFunc("/w/api.php", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		io.WriteString(w, `{"query":{"pages":[
		 {"title":"File:LL-Q1860 (eng)-Vealhurl-carefully.wav","imageinfo":[{"extmetadata":{"LicenseShortName":{"value":"CC BY-SA 4.0"}}}]},
		 {"title":"File:LL-Q1860 (eng)-Someone-carefully done.wav","imageinfo":[{"extmetadata":{"LicenseShortName":{"value":"CC BY-SA 4.0"}}}]},
		 {"title":"File:LL-Q1860 (eng)-Nolicence-carefully.wav","imageinfo":[{"extmetadata":{}}]}]}}`)
	})
	mux.HandleFunc("/api/v2/entries/en/carefully", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		io.WriteString(w, `[{"phonetics":[
		 {"audio":"https://api.dictionaryapi.dev/media/pronunciations/en/carefully-us.mp3","sourceUrl":"https://commons.wikimedia.org/w/index.php?curid=1","license":{"name":"BY-SA 3.0"}},
		 {"audio":"https://evil.example/x.mp3","license":{"name":"BY-SA 3.0"}}]}]`)
	})
	// MediaWiki's path for "LL-Q1860_(eng)-Vealhurl-carefully.wav".
	mux.HandleFunc("/wikipedia/commons/", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/LL-Q1860_(eng)-Vealhurl-carefully.wav") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		io.WriteString(w, "RIFF")
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func client(srv *httptest.Server) *Client {
	return New().WithEndpoints(srv.URL, srv.URL, srv.URL, srv.Client())
}

func TestSentencesComeWithTheirTranslationAndCredit(t *testing.T) {
	var calls atomic.Int32
	srv := fake(t, &calls)
	c := client(srv)
	got, err := c.Sentences(context.Background(), "en", "carefully", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Text != "Watch carefully." || got[0].Author != "CK" || got[0].Licence != "CC BY 2.0 FR" ||
		got[0].URL != "https://tatoeba.org/en/sentences/show/2107662" || got[0].Translation == nil || got[0].Translation.Text != "Hãy nhìn thật kỹ." {
		t.Fatalf("sentences = %+v", got)
	}
	// Cached: a second lookup makes no call.
	before := calls.Load()
	if _, err := c.Sentences(context.Background(), "en", "Carefully", "vi"); err != nil || calls.Load() != before {
		t.Fatalf("second lookup: %v, %d calls", err, calls.Load()-before)
	}
	// A language these sources do not name has nothing, without a call.
	if got, err := c.Sentences(context.Background(), "xx", "carefully", "vi"); err != nil || got != nil || calls.Load() != before {
		t.Fatalf("unknown language: %+v, %v", got, err)
	}
}

func TestRecordingsAreTheWordItselfWithALicence(t *testing.T) {
	var calls atomic.Int32
	srv := fake(t, &calls)
	got, err := client(srv).Recordings(context.Background(), "en", "carefully")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "commons:LL-Q1860 (eng)-Vealhurl-carefully.wav" || got[0].Speaker != "Vealhurl" ||
		got[1].ID != "dictapi:media/pronunciations/en/carefully-us.mp3" || got[1].Licence != "BY-SA 3.0" {
		t.Fatalf("recordings = %+v", got)
	}
}

func TestAudioIsSentOnOnlyForARecordingsID(t *testing.T) {
	var calls atomic.Int32
	srv := fake(t, &calls)
	c := client(srv)
	body, ct, err := c.Audio(context.Background(), "commons:LL-Q1860 (eng)-Vealhurl-carefully.wav")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(body)
	body.Close()
	if string(b) != "RIFF" || ct != "audio/wav" {
		t.Fatalf("audio %q, %s", b, ct)
	}
	for _, id := range []string{"", "commons:Some photo.jpg", "commons:../../etc/passwd", "dictapi:../secret.mp3", "dictapi:media/pronunciations/en/a b.mp3", "https://evil.example/x.mp3"} {
		if _, _, err := c.Audio(context.Background(), id); !errors.Is(err, ErrNotARecording) {
			t.Errorf("%q: %v", id, err)
		}
	}
}

func TestASourceDownIsUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "down", 503) }))
	defer srv.Close()
	_, err := client(srv).Sentences(context.Background(), "en", "carefully", "vi")
	if !errors.Is(err, ErrUnavailable) || !strings.Contains(err.Error(), "503") {
		t.Fatalf("err = %v", err)
	}
}

func TestACommonsFileIsAskedForWhereMediaWikiKeepsIt(t *testing.T) {
	got := New().uploadURL("LL-Q1860 (eng)-Ajshul-carefully.wav")
	if got != "https://upload.wikimedia.org/wikipedia/commons/8/84/LL-Q1860_%28eng%29-Ajshul-carefully.wav" {
		t.Fatal(got)
	}
}
