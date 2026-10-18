package sse

import (
	"net/http"
	"sync"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
)

// MaxStreamsPerUser caps how many event streams one account holds open at
// once. A person has a few tabs; thousands of EventSources from one account
// pin as many goroutines and sockets here and in the BFF for up to an hour
// (security audit F-6). The rate limiter charges only the request that OPENS
// a stream, so it cannot see this.
const MaxStreamsPerUser = 12

var open = struct {
	sync.Mutex
	n map[uuid.UUID]int
}{n: map[uuid.UUID]int{}}

// Acquire reserves one stream slot for userID. When the user is at the cap it
// writes a 429 and returns ok=false; otherwise the caller must call release
// when the stream ends.
func Acquire(w http.ResponseWriter, userID uuid.UUID) (release func(), ok bool) {
	open.Lock()
	if open.n[userID] >= MaxStreamsPerUser {
		open.Unlock()
		w.Header().Set("Retry-After", "5")
		httpx.WriteError(w, http.StatusTooManyRequests,
			"too many live views are open — close a few tabs and try again", "too_many_streams")
		return nil, false
	}
	open.n[userID]++
	open.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			open.Lock()
			if open.n[userID]--; open.n[userID] <= 0 {
				delete(open.n, userID)
			}
			open.Unlock()
		})
	}, true
}
