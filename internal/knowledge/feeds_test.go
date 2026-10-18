package knowledge_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	feedconn "github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Feeds are tested against the real stores: the 20-feed cap, the entries'
// ownership and the auto-add window are SQL's.

// feedSite serves typed bodies as https://example.com (the podcast host,
// YouTube's feeds and pages, and the Data API all stand there).
type feedSite struct {
	mu     sync.Mutex
	bodies map[string]typedBody
	hits   map[string]int
	seen   []*http.Request
}

type typedBody struct {
	mime   string
	body   []byte
	status int
}

func (s *feedSite) set(path, mime string, body []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bodies[path] = typedBody{mime: mime, body: body}
}

func (s *feedSite) fail(path string, status int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bodies[path] = typedBody{status: status, mime: "application/json", body: []byte(`{"error":{}}`)}
}

func (s *feedSite) count(path string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits[path]
}

func (s *feedSite) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := r.URL.Path
	if r.URL.RawQuery != "" {
		if _, ok := s.bodies[key+"?"+r.URL.RawQuery]; ok {
			key += "?" + r.URL.RawQuery
		}
	}
	s.hits[key]++
	s.seen = append(s.seen, r)
	b, ok := s.bodies[key]
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", b.mime)
	if b.status != 0 {
		w.WriteHeader(b.status)
	}
	_, _ = w.Write(b.body)
}

type queued struct {
	kind    string
	payload any
}

// recJobs keeps what was queued, so a test runs the job itself.
type recJobs struct {
	mu   sync.Mutex
	jobs []queued
}

func (j *recJobs) Enqueue(_ context.Context, _ uuid.UUID, kind string, payload any, _ int) (uuid.UUID, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.jobs = append(j.jobs, queued{kind, payload})
	return uuid.New(), nil
}

func (j *recJobs) kinds() []string {
	j.mu.Lock()
	defer j.mu.Unlock()
	var out []string
	for _, q := range j.jobs {
		out = append(out, q.kind)
	}
	return out
}

// takeFeedJobs removes and returns the queued add_feed_entries payloads.
func (j *recJobs) takeFeedJobs() []knowledge.FeedJobPayload {
	j.mu.Lock()
	defer j.mu.Unlock()
	var out []knowledge.FeedJobPayload
	rest := j.jobs[:0]
	for _, q := range j.jobs {
		if q.kind == knowledge.JobAddFeedEntries {
			out = append(out, q.payload.(knowledge.FeedJobPayload))
			continue
		}
		rest = append(rest, q)
	}
	j.jobs = rest
	return out
}

type fakeDataKeys struct{ key string }

func (f *fakeDataKeys) YouTubeDataKey(context.Context, uuid.UUID) (string, error) { return f.key, nil }

type feedHarness struct {
	svc   *knowledge.Service
	docs  *pg.KnowledgeStore
	pool  *pg.Pool
	site  *feedSite
	jobs  *recJobs
	keys  *fakeDataKeys
	user  uuid.UUID
	other uuid.UUID
	kb    *knowledge.KB
	now   time.Time
}

func readFixture(t *testing.T, parts ...string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(append([]string{".."}, parts...)...))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func newFeedHarness(t *testing.T) *feedHarness {
	t.Helper()
	pool := testutil.TestDB(t)
	st := &feedSite{bodies: map[string]typedBody{}, hits: map[string]int{}}
	srv := httptest.NewTLSServer(st)
	t.Cleanup(srv.Close)
	addr := srv.Listener.Addr().String()
	fetch := security.FetchClientWith(10*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
	fetch.Transport.(*http.Transport).TLSClientConfig = srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	// YouTube's captions: refused, so every video rests in needs_transcript.
	yt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(yt.Close)

	blobs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := &feedHarness{
		docs: pg.NewKnowledgeStore(pool), pool: pool, site: st, jobs: &recJobs{}, keys: &fakeDataKeys{},
		user: testutil.NewUser(t, pool), other: testutil.NewUser(t, pool), now: time.Now().UTC(),
	}
	h.svc = knowledge.NewService(knowledge.Config{
		Store: h.docs, Chunks: pg.NewChunkStore(pool), Blobs: blobs, Jobs: h.jobs,
		Providers: &fakeProviders{embedder: newFakeEmbedder("fake-embed", 768)},
		Links: &knowledge.LinkConfig{
			Store: h.docs, Fetch: fetch,
			YouTube:      &youtube.Client{HTTP: yt.Client(), Base: yt.URL},
			Transcribers: &fakeTranscribers{}, Objects: blobs,
			Now: func() time.Time { return h.now },
		},
		Feeds: &knowledge.FeedConfig{
			Store: pg.NewFeedStore(pool), Fetch: fetch, MediaFetch: fetch,
			YouTube: &feedconn.YouTube{HTTP: fetch, Base: "https://example.com"},
			Data:    &feedconn.Data{HTTP: fetch, Base: "https://example.com/youtube/v3"},
			Keys:    h.keys,
			Now:     func() time.Time { return h.now },
		},
	})
	h.kb, err = h.svc.CreateKB(context.Background(), h.user, "Feeds")
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// podcast serves the RSS fixture at path, with its enclosures on the
// fixture host and two of them real recordings.
func (h *feedHarness) podcast(t *testing.T, path string) {
	t.Helper()
	rss := strings.ReplaceAll(string(readFixture(t, "connectors", "feeds", "testdata", "podcast.rss")),
		"https://cdn.example.com/", "https://example.com/cdn/")
	h.site.set(path, "application/rss+xml; charset=utf-8", []byte(rss))
	h.site.set("/cdn/audio/ep3.mp3", "audio/mpeg", readFixture(t, "connectors", "media", "testdata", "tone.mp3"))
	h.site.set("/cdn/audio/ep2.m4a", "application/octet-stream", readFixture(t, "connectors", "media", "testdata", "tone.m4a"))
}

// runFeedJobs runs every queued add_feed_entries job, unit by unit.
func (h *feedHarness) runFeedJobs(t *testing.T) int {
	t.Helper()
	n := 0
	for _, p := range h.jobs.takeFeedJobs() {
		err := h.svc.RunFeedAdds(context.Background(), h.user, p,
			func(ctx context.Context, total int, unit func(context.Context, int) (int, error)) error {
				for i := 0; i < total; i++ {
					if _, err := unit(ctx, i); err != nil {
						return err
					}
				}
				return nil
			})
		if err != nil {
			t.Fatalf("RunFeedAdds: %v", err)
		}
		n++
	}
	return n
}

func entryByTitle(t *testing.T, entries []knowledge.FeedEntry, prefix string) knowledge.FeedEntry {
	t.Helper()
	for _, e := range entries {
		if strings.HasPrefix(e.Title, prefix) {
			return e
		}
	}
	t.Fatalf("no entry %q in %+v", prefix, entries)
	return knowledge.FeedEntry{}
}

func TestAPodcastLinkIsFollowedAndPickedEpisodesBecomeUntranscribedRecordings(t *testing.T) {
	h := newFeedHarness(t)
	ctx := context.Background()
	h.podcast(t, "/show.rss")

	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/show.rss", false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Feed == nil || res.Document != nil {
		t.Fatalf("result = %+v", res)
	}
	if res.Feed.Kind != feedconn.KindPodcast || res.Feed.Title != "Slow English & Friends" || res.Feed.Entries != 4 || res.Feed.New != 0 {
		t.Fatalf("feed = %+v", res.Feed)
	}
	feed, entries, err := h.svc.GetFeed(ctx, h.user, res.Feed.ID)
	if err != nil || feed.ID != res.Feed.ID || len(entries) != 4 {
		t.Fatalf("GetFeed = %v, %d entries", err, len(entries))
	}
	ep3, ep2 := entryByTitle(t, entries, "Episode 3"), entryByTitle(t, entries, "Episode 2")
	if ep3.DurationSeconds != 1445 || ep3.PublishedAt == nil || ep3.DocumentID != nil || ep3.New {
		t.Errorf("episode 3 = %+v", ep3)
	}
	if entries[0].Key != ep3.Key {
		t.Errorf("the newest episode is not first: %+v", entries[0])
	}
	if h.site.count("/cdn/audio/ep3.mp3") != 0 {
		t.Error("an enclosure was fetched before anyone picked it")
	}

	jobID, picked, err := h.svc.AddFeedEntries(ctx, h.user, feed.ID, []string{ep3.Key, ep2.Key, ep3.Key})
	if err != nil || jobID == uuid.Nil || len(picked) != 2 {
		t.Fatalf("AddFeedEntries = %v, %v, %v", jobID, picked, err)
	}
	// Picking them again while they are queued adds nothing.
	if _, _, err := h.svc.AddFeedEntries(ctx, h.user, feed.ID, []string{ep3.Key}); !errors.Is(err, knowledge.ErrNoEntries) {
		t.Errorf("picking a queued entry: %v", err)
	}
	if n := h.runFeedJobs(t); n != 1 {
		t.Fatalf("jobs run = %d", n)
	}

	_, entries, _ = h.svc.GetFeed(ctx, h.user, feed.ID)
	for _, prefix := range []string{"Episode 3", "Episode 2"} {
		e := entryByTitle(t, entries, prefix)
		if e.DocumentID == nil || e.AddStatus != "" {
			t.Fatalf("%s: %+v", prefix, e)
		}
		doc, err := h.docs.GetDocument(ctx, h.user, *e.DocumentID)
		if err != nil {
			t.Fatal(err)
		}
		if doc.SourceKind != knowledge.SourceMedia || doc.Status != knowledge.StatusNeedsTranscript ||
			!strings.HasPrefix(doc.Title, prefix) || doc.MediaSHA256 == "" || doc.Media == nil || doc.Media.DurationSeconds <= 0 {
			t.Errorf("%s document = %+v", prefix, doc)
		}
	}
	if doc, _ := h.docs.GetDocument(ctx, h.user, *entryByTitle(t, entries, "Episode 2").DocumentID); doc.MediaMIME != "audio/mp4" {
		t.Errorf("a generic enclosure type was not sniffed: %s", doc.MediaMIME)
	}
	if h.site.count("/cdn/audio/ep3.mp3") != 1 {
		t.Errorf("enclosure fetched %d times", h.site.count("/cdn/audio/ep3.mp3"))
	}
	// Nothing was transcribed and nothing parsed: each recording waits for
	// the learner to choose an engine.
	if kinds := h.jobs.kinds(); len(kinds) != 0 {
		t.Errorf("jobs queued besides adding: %v", kinds)
	}
	feed, _, _ = h.svc.GetFeed(ctx, h.user, feed.ID)
	if feed.Added != 2 {
		t.Errorf("added = %d", feed.Added)
	}

	// An enclosure the host refuses is recorded on its entry.
	ep1 := entryByTitle(t, entries, "Episode 1")
	if _, _, err := h.svc.AddFeedEntries(ctx, h.user, feed.ID, []string{ep1.Key}); err != nil {
		t.Fatal(err)
	}
	h.runFeedJobs(t)
	_, entries, _ = h.svc.GetFeed(ctx, h.user, feed.ID)
	if e := entryByTitle(t, entries, "Episode 1"); e.AddStatus != "failed" || e.AddError != "the episode's host answered HTTP 404" || e.DocumentID != nil {
		t.Errorf("a refused enclosure: %+v", e)
	}

	// Deleting the document makes the episode addable again; deleting the
	// feed keeps the documents it added.
	ep3Doc := *entryByTitle(t, entries, "Episode 3").DocumentID
	if err := h.svc.DeleteDocument(ctx, h.user, h.kb.ID, ep3Doc); err != nil {
		t.Fatal(err)
	}
	_, entries, _ = h.svc.GetFeed(ctx, h.user, feed.ID)
	if e := entryByTitle(t, entries, "Episode 3"); e.DocumentID != nil {
		t.Errorf("a deleted document is still named: %+v", e)
	}
	ep2Doc := *entryByTitle(t, entries, "Episode 2").DocumentID
	if err := h.svc.DeleteFeed(ctx, h.user, feed.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.docs.GetDocument(ctx, h.user, ep2Doc); err != nil {
		t.Errorf("deleting the feed deleted its document: %v", err)
	}
	if _, _, err := h.svc.GetFeed(ctx, h.user, feed.ID); !errors.Is(err, authz.ErrNoAccess) {
		t.Errorf("a deleted feed: %v", err)
	}
}

func TestABlogFeedOrAFeedTwiceIsRefused(t *testing.T) {
	h := newFeedHarness(t)
	ctx := context.Background()
	h.site.set("/blog.rss", "application/rss+xml", readFixture(t, "connectors", "feeds", "testdata", "blog.rss"))
	_, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/blog.rss", false)
	if linkCode(err) != knowledge.LinkNotPodcast {
		t.Errorf("a blog's feed: %v", err)
	}
	h.podcast(t, "/show.rss")
	if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/show.rss", true); linkCode(err) != knowledge.LinkBadURL {
		t.Errorf("a feed with auto-sync: %v", err)
	}
	if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/show.rss", false); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/show.rss", false); !errors.Is(err, knowledge.ErrDuplicateSource) {
		t.Errorf("the same feed twice: %v", err)
	}
}

func TestThe21stFeedIsRefused(t *testing.T) {
	h := newFeedHarness(t)
	ctx := context.Background()
	for i := 0; i <= knowledge.MaxFeedsPerKB; i++ {
		h.podcast(t, fmt.Sprintf("/show%d.rss", i))
	}
	for i := 0; i < knowledge.MaxFeedsPerKB; i++ {
		if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, fmt.Sprintf("https://example.com/show%d.rss", i), false); err != nil {
			t.Fatalf("feed %d: %v", i, err)
		}
	}
	_, err := h.svc.AddLink(ctx, h.user, h.kb.ID, fmt.Sprintf("https://example.com/show%d.rss", knowledge.MaxFeedsPerKB), false)
	if linkCode(err) != knowledge.LinkFeedLimit {
		t.Fatalf("the 21st feed: %v", err)
	}
	// The cap is per knowledge base.
	other, err := h.svc.CreateKB(ctx, h.user, "Another")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.AddLink(ctx, h.user, other.ID, "https://example.com/show0.rss", false); err != nil {
		t.Errorf("another knowledge base: %v", err)
	}
}

func TestAnotherUsersFeedAnswersLikeAMissingOne(t *testing.T) {
	h := newFeedHarness(t)
	ctx := context.Background()
	h.podcast(t, "/show.rss")
	h.podcast(t, "/other.rss")
	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/show.rss", false)
	if err != nil {
		t.Fatal(err)
	}
	feedID := res.Feed.ID
	_, entries, _ := h.svc.GetFeed(ctx, h.user, feedID)
	key := entries[0].Key

	checks := map[string]error{}
	_, _, checks["get"] = h.svc.GetFeed(ctx, h.other, feedID)
	_, _, checks["pick"] = h.svc.AddFeedEntries(ctx, h.other, feedID, []string{key})
	_, _, checks["check"] = h.svc.CheckFeed(ctx, h.other, feedID)
	_, checks["auto_add"] = h.svc.SetFeedAutoAdd(ctx, h.other, feedID, true)
	checks["seen"] = h.svc.MarkFeedSeen(ctx, h.other, feedID)
	checks["delete"] = h.svc.DeleteFeed(ctx, h.other, feedID)
	_, _, checks["missing"] = h.svc.GetFeed(ctx, h.user, uuid.New())
	for name, err := range checks {
		if !errors.Is(err, authz.ErrNoAccess) {
			t.Errorf("%s: err = %v, want ErrNoAccess", name, err)
		}
	}
	if list, err := h.svc.ListFeeds(ctx, h.other, h.kb.ID); err != nil || len(list) != 0 {
		t.Errorf("another user's list: %v, %d", err, len(list))
	}
	// The other user's own feed cannot pick this feed's entries: keys are
	// resolved within the feed in the path.
	otherKB, _ := h.svc.CreateKB(ctx, h.other, "Theirs")
	theirs, err := h.svc.AddLink(ctx, h.other, otherKB.ID, "https://example.com/other.rss", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.svc.AddFeedEntries(ctx, h.other, theirs.Feed.ID, []string{"0123456789abcdef0123456789abcdef"}); !errors.Is(err, knowledge.ErrNoEntries) {
		t.Errorf("a key not in the feed: %v", err)
	}
	if _, _, err := h.svc.AddFeedEntries(ctx, h.user, feedID, []string{"../../etc"}); linkCode(err) != knowledge.LinkBadURL {
		t.Errorf("a malformed key: %v", err)
	}
	if len(h.jobs.takeFeedJobs()) != 0 {
		t.Error("a refused pick queued a job")
	}
	// Nothing was changed for the owner.
	feed, _, err := h.svc.GetFeed(ctx, h.user, feedID)
	if err != nil || feed.AutoAdd {
		t.Errorf("owner's feed after the attempts: %+v, %v", feed, err)
	}
}

// youtubeFeed is a keyless YouTube feed: the fixture's 15 videos, after
// `extra` newer ones.
func youtubeFeed(t *testing.T, extra int) []byte {
	t.Helper()
	feed := string(readFixture(t, "connectors", "feeds", "testdata", "youtube_playlist.xml"))
	var b strings.Builder
	for i := 0; i < extra; i++ {
		id := fmt.Sprintf("newvideo%03d", i)[:11]
		fmt.Fprintf(&b, `<entry><id>yt:video:%s</id><yt:videoId>%s</yt:videoId><title>New video %d</title>
<published>2026-10-20T%02d:00:00+00:00</published></entry>`, id, id, i, 23-i)
	}
	return []byte(strings.Replace(feed, "<entry>", b.String()+"<entry>", 1))
}

const uploadsPlaylist = "/feeds/videos.xml?playlist_id=UU_x5XG1OV2P6uZZ5FSM9Ttw"

func TestAutoAddAddsAtMostFiveADayAndNeverStartsATranscription(t *testing.T) {
	h := newFeedHarness(t)
	ctx := context.Background()
	h.site.set(uploadsPlaylist, "text/xml; charset=UTF-8", youtubeFeed(t, 0))

	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://www.youtube.com/playlist?list=UU_x5XG1OV2P6uZZ5FSM9Ttw", false)
	if err != nil {
		t.Fatal(err)
	}
	feed := res.Feed
	if feed.Kind != feedconn.KindYouTube || feed.Entries != feedconn.YouTubeFeedLimit || feed.New != 0 ||
		feed.ListedBy != knowledge.ListedByFeed || feed.URL != "https://www.youtube.com/feeds/videos.xml?playlist_id=UU_x5XG1OV2P6uZZ5FSM9Ttw" {
		t.Fatalf("feed = %+v", feed)
	}
	if _, err := h.svc.SetFeedAutoAdd(ctx, h.user, feed.ID, true); err != nil {
		t.Fatal(err)
	}

	// The next day the feed has 8 new videos.
	h.site.set(uploadsPlaylist, "text/xml; charset=UTF-8", youtubeFeed(t, 8))
	h.now = h.now.Add(25 * time.Hour)
	rep, err := h.svc.SyncDueFeeds(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Checked != 1 || rep.New != 8 || rep.AutoAdded != knowledge.MaxAutoAddPerDay {
		t.Fatalf("report = %+v", rep)
	}
	h.runFeedJobs(t)
	feed, entries, _ := h.svc.GetFeed(ctx, h.user, feed.ID)
	if feed.Added != 5 || feed.New != 3 {
		t.Fatalf("after the first day: added %d, new %d", feed.Added, feed.New)
	}
	for i := 0; i < 5; i++ {
		e := entries[i]
		if e.DocumentID == nil || !strings.HasPrefix(e.Title, "New video") {
			t.Fatalf("entry %d = %+v", i, e)
		}
		doc, _ := h.docs.GetDocument(ctx, h.user, *e.DocumentID)
		if doc.SourceKind != knowledge.SourceYouTube || doc.Status != knowledge.StatusNeedsTranscript || doc.MediaID != e.VideoID {
			t.Errorf("document %d = %+v", i, doc)
		}
	}

	// Checked again within the same 24 hours, nothing more is added.
	if _, err := h.pool.Exec(ctx, `UPDATE feeds SET last_checked_at = $2 WHERE id = $1`, feed.ID, h.now.Add(-48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	h.now = h.now.Add(2 * time.Hour)
	if rep, err := h.svc.SyncDueFeeds(ctx); err != nil || rep.AutoAdded != 0 {
		t.Fatalf("a second pass the same day: %+v, %v", rep, err)
	}
	// The day after, the three left are added.
	h.now = h.now.Add(25 * time.Hour)
	if rep, err := h.svc.SyncDueFeeds(ctx); err != nil || rep.AutoAdded != 3 {
		t.Fatalf("the next day: %+v, %v", rep, err)
	}
	h.runFeedJobs(t)
	for _, k := range h.jobs.kinds() {
		if strings.HasPrefix(k, "transcribe") {
			t.Fatalf("auto_add started a transcription: %v", h.jobs.kinds())
		}
	}
	if len(h.jobs.kinds()) != 0 {
		t.Errorf("jobs left: %v", h.jobs.kinds())
	}
}

func TestANewEntryIsMarkedNewUntilAddedOrSeen(t *testing.T) {
	h := newFeedHarness(t)
	ctx := context.Background()
	h.site.set(uploadsPlaylist, "text/xml", youtubeFeed(t, 0))
	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://www.youtube.com/watch?list=UU_x5XG1OV2P6uZZ5FSM9Ttw", false)
	if err != nil {
		t.Fatal(err)
	}
	h.site.set(uploadsPlaylist, "text/xml", youtubeFeed(t, 2))
	feed, n, err := h.svc.CheckFeed(ctx, h.user, res.Feed.ID)
	if err != nil || n != 2 || feed.New != 2 || feed.Entries != 17 {
		t.Fatalf("CheckFeed = %+v, %d, %v", feed, n, err)
	}
	// A manual check adds nothing, even with auto_add on.
	if len(h.jobs.takeFeedJobs()) != 0 {
		t.Error("a check queued an add")
	}
	// The daily pass with auto_add off checks the feed and adds nothing.
	h.now = h.now.Add(25 * time.Hour)
	if rep, err := h.svc.SyncDueFeeds(ctx); err != nil || rep.Checked != 1 || rep.AutoAdded != 0 || len(h.jobs.takeFeedJobs()) != 0 {
		t.Fatalf("a daily pass with auto_add off: %+v, %v", rep, err)
	}
	if err := h.svc.MarkFeedSeen(ctx, h.user, feed.ID); err != nil {
		t.Fatal(err)
	}
	if feed, _, _ = h.svc.GetFeed(ctx, h.user, feed.ID); feed.New != 0 {
		t.Errorf("new after seen = %d", feed.New)
	}
	// A failed check is recorded on the feed and changes no entry.
	h.site.fail(uploadsPlaylist, http.StatusInternalServerError)
	if _, _, err := h.svc.CheckFeed(ctx, h.user, feed.ID); err == nil {
		t.Fatal("a failed check reported success")
	}
	if feed, _, _ = h.svc.GetFeed(ctx, h.user, feed.ID); feed.CheckError != "the site answered HTTP 500" || feed.Entries != 17 {
		t.Errorf("after a failed check: %+v", feed)
	}
}

func TestAHandleAndAChannelLinkFollowTheChannelsFeed(t *testing.T) {
	h := newFeedHarness(t)
	ctx := context.Background()
	h.site.set("/@GoogleDevelopers", "text/html; charset=utf-8", readFixture(t, "connectors", "feeds", "testdata", "youtube_handle_page.html"))
	h.site.set("/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw", "text/xml; charset=UTF-8",
		readFixture(t, "connectors", "feeds", "testdata", "youtube_channel.xml"))

	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://www.youtube.com/@GoogleDevelopers", false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Feed.URL != "https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw" || res.Feed.Entries != 15 {
		t.Fatalf("feed = %+v", res.Feed)
	}
	// The channel's own link is the same feed.
	if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw", false); !errors.Is(err, knowledge.ErrDuplicateSource) {
		t.Errorf("the channel link after its handle: %v", err)
	}
	// A watch link inside a playlist is still the video.
	res, err = h.svc.AddLink(ctx, h.user, h.kb.ID, "https://www.youtube.com/watch?v=qJplHFjyv2A&list=UU_x5XG1OV2P6uZZ5FSM9Ttw", false)
	if err != nil || res.Document == nil || res.Feed != nil {
		t.Errorf("a watch link with list=: %+v, %v", res, err)
	}
}

func TestADataAPIKeyListsTheWholePlaylistAndNeverReachesAnError(t *testing.T) {
	h := newFeedHarness(t)
	ctx := context.Background()
	const key = "AIzaLearnersOwnKey-0000"
	h.keys.key = key
	data := func(name string) []byte { return readFixture(t, "connectors", "feeds", "testdata", name) }
	h.site.set("/youtube/v3/playlistItems", "application/json; charset=UTF-8", data("data_playlist_items_1.json"))
	h.site.set("/youtube/v3/playlistItems?maxResults=50&pageToken=PAGE2&part=snippet%2CcontentDetails%2Cstatus&playlistId=PLfixture0001",
		"application/json; charset=UTF-8", data("data_playlist_items_2.json"))
	h.site.set("/youtube/v3/videos", "application/json; charset=UTF-8", data("data_videos.json"))
	h.site.set("/feeds/videos.xml?playlist_id=PLfixture0001", "text/xml", youtubeFeed(t, 0))

	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://www.youtube.com/playlist?list=PLfixture0001", false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Feed.ListedBy != knowledge.ListedByDataAPI || res.Feed.Title != "Uploads from Google for Developers" {
		t.Fatalf("feed = %+v", res.Feed)
	}
	_, entries, _ := h.svc.GetFeed(ctx, h.user, res.Feed.ID)
	// Two pages; the private video is left out.
	if len(entries) != 2 || entries[0].VideoID != "aaaaaaaaaa1" || entries[0].DurationSeconds != 725 ||
		entries[1].VideoID != "aaaaaaaaaa3" || entries[1].DurationSeconds != 3720 {
		t.Fatalf("entries = %+v", entries)
	}
	for _, r := range h.site.seen {
		if strings.Contains(r.URL.String(), key) {
			t.Fatalf("the key was in a URL: %s", r.URL)
		}
		if strings.HasPrefix(r.URL.Path, "/youtube/v3/") && r.Header.Get("X-Goog-Api-Key") != key {
			t.Fatalf("a Data API call without the key: %s", r.URL)
		}
		if !strings.HasPrefix(r.URL.Path, "/youtube/v3/") && r.Header.Get("X-Goog-Api-Key") != "" {
			t.Fatalf("the key went to %s", r.URL)
		}
	}

	// A refused key falls back to the keyless feed, and says so without
	// the key.
	h.site.fail("/youtube/v3/playlistItems", http.StatusForbidden)
	feed, _, err := h.svc.CheckFeed(ctx, h.user, res.Feed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if feed.ListedBy != knowledge.ListedByFeed || feed.Entries < 15 || !strings.Contains(feed.CheckError, "refused the key") ||
		strings.Contains(feed.CheckError, key) {
		t.Fatalf("after a refusal: %+v", feed)
	}
	raw, _ := json.Marshal(feed)
	if strings.Contains(string(raw), key) {
		t.Fatal("the key is in the feed's JSON")
	}
}
