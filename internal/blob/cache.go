package blob

import (
	"container/list"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// cache.go — recently read Drive files, kept on the server's disk
// (drive-user-storage phase 1, plan decision 4).
//
// A learner who keeps their files in Drive still re-parses, plays and
// transcribes them here, and every one of those reads would otherwise be a
// download. The cache holds whole files only, keyed by their sha256, under
// cache/<user>/<aa>/<sha256>, and forgets the least recently used once the
// total passes its cap (ANYTOOLS_DRIVE_CACHE_MB).
//
// Two rules make it safe to serve from:
//
//   - An entry is written under a temporary name and renamed into place only
//     once it is complete and its digest matches its name. A reader therefore
//     never sees part of a file, and a crash leaves only a temporary file,
//     which the next start removes.
//   - The cap counts committed entries, and an entry is committed only after
//     older ones have been evicted to make room. A file larger than the whole
//     cap is never cached; it is read from Drive each time.

// DefaultCacheMB is the cap when ANYTOOLS_DRIVE_CACHE_MB is unset.
const DefaultCacheMB = 2048

// Cache is an LRU of whole files on disk, keyed by user and sha256.
type Cache struct {
	root string
	max  int64

	mu      sync.Mutex
	lru     *list.List // front: most recently used
	entries map[cacheKey]*list.Element
	size    int64
}

type cacheKey struct {
	user uuid.UUID
	sha  string
}

type cacheEntry struct {
	key  cacheKey
	size int64
}

// NewCache opens the cache under dir, capped at maxBytes. It removes what a
// crash left half written, takes stock of what is there, and evicts down to
// the cap (which may have shrunk since the last start).
func NewCache(dir string, maxBytes int64) (*Cache, error) {
	if dir == "" {
		return nil, errors.New("blob: cache directory is empty")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("blob: resolve cache dir: %w", err)
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, fmt.Errorf("blob: create cache dir: %w", err)
	}
	c := &Cache{root: abs, max: maxBytes, lru: list.New(), entries: map[cacheKey]*list.Element{}}
	type found struct {
		cacheEntry
		at int64
	}
	var all []found
	err = filepath.WalkDir(abs, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if strings.HasPrefix(d.Name(), ".tmp-") {
			_ = os.Remove(path)
			return nil
		}
		rel, _ := filepath.Rel(abs, path)
		parts := strings.Split(rel, string(filepath.Separator))
		if len(parts) != 3 {
			return nil
		}
		user, uerr := uuid.Parse(parts[0])
		if uerr != nil || validDigest(parts[2]) != nil || parts[1] != parts[2][:2] {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		all = append(all, found{cacheEntry{cacheKey{user, parts[2]}, info.Size()}, info.ModTime().UnixNano()})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("blob: read cache: %w", err)
	}
	// Oldest first, so each push to the front leaves the newest in front.
	sort.Slice(all, func(i, j int) bool { return all[i].at < all[j].at })
	for _, f := range all {
		e := f.cacheEntry
		c.entries[e.key] = c.lru.PushFront(&e)
		c.size += e.size
	}
	c.mu.Lock()
	c.evictLocked(0)
	c.mu.Unlock()
	return c, nil
}

// Size is the total of committed entries.
func (c *Cache) Size() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.size
}

// Max is the cap.
func (c *Cache) Max() int64 { return c.max }

func (c *Cache) path(k cacheKey) string {
	return filepath.Join(c.root, k.user.String(), k.sha[:2], k.sha)
}

// Open returns the cached file, or false on a miss. A hit becomes the most
// recently used. An entry whose size is not the size the caller expects is
// dropped and reported as a miss.
func (c *Cache) Open(user uuid.UUID, sha string, size int64) (*File, bool) {
	if validDigest(sha) != nil {
		return nil, false
	}
	k := cacheKey{user, sha}
	c.mu.Lock()
	el, ok := c.entries[k]
	if ok {
		c.lru.MoveToFront(el)
	}
	c.mu.Unlock()
	if !ok {
		return nil, false
	}
	f, err := openFile(c.path(k))
	if err != nil || f.Size != size {
		if f != nil {
			f.Close()
		}
		c.Remove(user, sha)
		return nil, false
	}
	// The modification time is the use time NewCache orders by after a
	// restart.
	now := time.Now()
	_ = os.Chtimes(c.path(k), now, now)
	return f, true
}

// Put caches data under its digest. A file larger than the cap is not cached.
func (c *Cache) Put(user uuid.UUID, data []byte) error {
	if int64(len(data)) > c.max {
		return nil
	}
	s, err := c.Stage(user)
	if err != nil {
		return err
	}
	if _, err := s.Write(data); err != nil {
		s.Discard()
		return err
	}
	return s.Commit()
}

// Remove forgets one entry and deletes its file.
func (c *Cache) Remove(user uuid.UUID, sha string) {
	if validDigest(sha) != nil {
		return
	}
	k := cacheKey{user, sha}
	c.mu.Lock()
	if el, ok := c.entries[k]; ok {
		c.size -= el.Value.(*cacheEntry).size
		c.lru.Remove(el)
		delete(c.entries, k)
	}
	c.mu.Unlock()
	_ = os.Remove(c.path(k))
}

// DeleteUser forgets every entry of a user and removes their directory
// (account deletion).
func (c *Cache) DeleteUser(user uuid.UUID) error {
	c.mu.Lock()
	for k, el := range c.entries {
		if k.user == user {
			c.size -= el.Value.(*cacheEntry).size
			c.lru.Remove(el)
			delete(c.entries, k)
		}
	}
	c.mu.Unlock()
	return os.RemoveAll(filepath.Join(c.root, user.String()))
}

// evictLocked removes least recently used entries until room more bytes fit
// under the cap.
func (c *Cache) evictLocked(room int64) {
	for c.size+room > c.max {
		el := c.lru.Back()
		if el == nil {
			return
		}
		e := el.Value.(*cacheEntry)
		c.lru.Remove(el)
		delete(c.entries, e.key)
		c.size -= e.size
		// An open reader keeps its file: removing a name does not close it.
		_ = os.Remove(c.path(e.key))
	}
}

// Staged is a cache entry being written. Its digest is computed as it is
// written, so a stream (a download, an audio overview being joined) can be
// cached without being held in memory. Commit or Discard it.
type Staged struct {
	c    *Cache
	user uuid.UUID
	f    *os.File
	h    hash.Hash
	n    int64
	done bool
}

// Stage starts an entry for user.
func (c *Cache) Stage(user uuid.UUID) (*Staged, error) {
	dir := filepath.Join(c.root, user.String())
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("blob: create cache dir: %w", err)
	}
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return nil, fmt.Errorf("blob: cache temp file: %w", err)
	}
	return &Staged{c: c, user: user, f: f, h: sha256.New()}, nil
}

func (s *Staged) Write(p []byte) (int, error) {
	n, err := s.f.Write(p)
	s.h.Write(p[:n])
	s.n += int64(n)
	return n, err
}

// Digest is the sha256 of what has been written so far.
func (s *Staged) Digest() string { return hex.EncodeToString(s.h.Sum(nil)) }

// Len is how many bytes have been written.
func (s *Staged) Len() int64 { return s.n }

// ReaderAt reads back what was staged, for a caller that uploads it before
// committing it.
func (s *Staged) ReaderAt() io.ReaderAt { return s.f }

// Commit renames the entry into place under its digest, after making room.
// Committing an entry that is already cached, or one larger than the cap,
// discards it instead.
func (s *Staged) Commit() error {
	return s.commit("")
}

// CommitAs is Commit for an entry that must have the digest want. Any other
// content is discarded and reported as ErrCorrupt.
func (s *Staged) CommitAs(want string) error {
	return s.commit(want)
}

func (s *Staged) commit(want string) error {
	if s.done {
		return errors.New("blob: cache entry already finished")
	}
	sha := s.Digest()
	if want != "" && sha != want {
		s.Discard()
		return ErrCorrupt
	}
	if err := s.f.Sync(); err != nil {
		s.Discard()
		return fmt.Errorf("blob: sync: %w", err)
	}
	if err := s.f.Close(); err != nil {
		s.done = true
		_ = os.Remove(s.f.Name())
		return fmt.Errorf("blob: close: %w", err)
	}
	s.done = true
	tmp := s.f.Name()
	c := s.c
	k := cacheKey{s.user, sha}

	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[k]; ok || s.n > c.max {
		_ = os.Remove(tmp)
		return nil
	}
	c.evictLocked(s.n)
	dst := c.path(k)
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("blob: create cache dir: %w", err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("blob: rename: %w", err)
	}
	c.entries[k] = c.lru.PushFront(&cacheEntry{key: k, size: s.n})
	c.size += s.n
	return nil
}

// Discard removes the temporary file. Safe after Commit.
func (s *Staged) Discard() {
	if s.done {
		return
	}
	s.done = true
	s.f.Close()
	_ = os.Remove(s.f.Name())
}

// validDigest accepts a lowercase hex sha256 and nothing else, so a digest is
// always safe as a file name.
func validDigest(digest string) error {
	if len(digest) != 64 {
		return fmt.Errorf("blob: malformed digest")
	}
	for _, r := range digest {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return fmt.Errorf("blob: malformed digest")
		}
	}
	return nil
}
