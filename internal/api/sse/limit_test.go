package sse

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestStreamsPerUserAreCappedAndReleased(t *testing.T) {
	alice, bob := uuid.New(), uuid.New()
	var releases []func()
	for i := 0; i < MaxStreamsPerUser; i++ {
		release, ok := Acquire(httptest.NewRecorder(), alice)
		if !ok {
			t.Fatalf("stream %d refused below the cap", i+1)
		}
		releases = append(releases, release)
	}
	rec := httptest.NewRecorder()
	if _, ok := Acquire(rec, alice); ok || rec.Code != http.StatusTooManyRequests {
		t.Fatalf("stream over the cap: ok=%v code=%d", ok, rec.Code)
	}
	if release, ok := Acquire(httptest.NewRecorder(), bob); !ok {
		t.Fatal("another user was refused because of alice's streams")
	} else {
		release()
	}
	releases[0]()
	releases[0]() // releasing twice must not free two slots
	refill, ok := Acquire(httptest.NewRecorder(), alice)
	if !ok {
		t.Fatal("a released slot was not reusable")
	}
	if _, ok := Acquire(httptest.NewRecorder(), alice); ok {
		t.Fatal("a double release freed a second slot")
	}
	refill()
	for _, r := range releases[1:] {
		r()
	}
}
