package citations

import (
	"strconv"
	"sync"
)

// URLBook numbers the web pages one turn has gathered: the first URL seen is
// `[[cite:url:1]]`, the next distinct one `[[cite:url:2]]`, and a URL seen
// again keeps its number.
//
// It exists because a URL cannot be its own citation id — `/` and `?` are
// outside the marker's id charset, deliberately — and because numbering has to
// be per TURN rather than per tool call: two searches that both return the same
// page must cite it once, and a second search must not restart at 1 and collide
// with the first.
type URLBook struct {
	mu    sync.Mutex
	byURL map[string]int
	next  int
}

// NewURLBook returns an empty book.
func NewURLBook() *URLBook { return &URLBook{byURL: map[string]int{}} }

// ID returns the citation id for a URL, minting one on first sight.
func (b *URLBook) ID(url string) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if n, ok := b.byURL[url]; ok {
		return strconv.Itoa(n)
	}
	b.next++
	b.byURL[url] = b.next
	return strconv.Itoa(b.next)
}

// Has reports whether a URL has already been numbered in this turn.
func (b *URLBook) Has(url string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	_, ok := b.byURL[url]
	return ok
}

// Len reports how many distinct URLs have been numbered.
func (b *URLBook) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.byURL)
}
