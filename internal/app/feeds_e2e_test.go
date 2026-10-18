package app

// feeds_e2e_test.go — podcast feeds and YouTube playlists, end to end
// through the wiring (up-methods phase 17).
//
// "Add a link" given a podcast's RSS follows it; the feed's page lists the
// episodes; ticking two queues the add_feed_entries job on the real queue,
// which downloads each enclosure into a media document that waits for a
// transcript. A YouTube playlist link lists the keyless feed's 15 videos.
//
// Scripted: the podcast host and YouTube (one TLS fixture reached through
// the fetch guard's dialer). The enclosures are real recordings made with
// ffmpeg (internal/connectors/media/testdata). No live host is called.

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/feedapi"
	"github.com/D0bby999/anytools/internal/api/kbapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// feedsFixture serves the podcast, its enclosures and YouTube's feed.
func feedsFixture(t *testing.T) *http.Client {
	t.Helper()
	read := func(path string) []byte {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	rss := strings.ReplaceAll(string(read("../connectors/feeds/testdata/podcast.rss")),
		"https://cdn.example.com/", "https://example.com/cdn/")
	bodies := map[string][2]string{
		"/show.rss":          {"application/rss+xml", rss},
		"/cdn/audio/ep3.mp3": {"audio/mpeg", string(read("../connectors/media/testdata/tone.mp3"))},
		"/cdn/audio/ep2.m4a": {"audio/x-m4a", string(read("../connectors/media/testdata/tone.m4a"))},
		"/feeds/videos.xml":  {"text/xml; charset=UTF-8", string(read("../connectors/feeds/testdata/youtube_playlist.xml"))},
		"/robots.txt":        {"text/plain", "User-agent: *\nAllow: /\n"},
	}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, ok := bodies[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", b[0])
		_, _ = w.Write([]byte(b[1]))
	}))
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
	return fetch
}

func newFeedsE2E(t *testing.T) (*e2e, uuid.UUID) {
	t.Helper()
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey
	user := testutil.NewUser(t, pool)
	conns := pg.NewProviderConnectionStore(pool, key)
	tokens, err := oauth.NewService(pg.NewOAuthCredentialStore(pool, key), conns, pg.NewConnectionLockStore(pool), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	byokSvc := byok.NewService(conns, pg.NewFunctionRouteStore(pool, key), pg.NewSearchConnectionStore(pool, key), tokens)

	blobs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fetch := feedsFixture(t)
	kbStore := pg.NewKnowledgeStore(pool)
	queue := jobs.NewQueue(pool, time.Minute)
	providers := &replayProviders{parser: newReplayParser(t, "rag"), embedder: newHashEmbedder(768)}
	links := linkConfig(kbStore, blobs, byokSvc, linkDeps{fetch: fetch})
	// YouTube's captions are not reached: every video waits for a transcript.
	links.YouTube.Base = "https://example.com/youtube-is-blocked"
	links.YouTube.HTTP = fetch
	svc := knowledge.NewService(knowledge.Config{
		Store: kbStore, Chunks: pg.NewChunkStore(pool), Blobs: blobs,
		Jobs: queue, Providers: providers, Events: knowledge.NewEvents(),
		Links: links,
		Feeds: feedConfig(pool, byokSvc, feedDeps{fetch: fetch, media: fetch,
			youtubeBase: "https://example.com", dataBase: "https://example.com/youtube/v3"}),
	})
	authorizer := authz.New(kbStore)
	handlers := map[string]jobs.Handler{}
	addFeedJobs(handlers, svc, queue)

	server := httptest.NewServer(api.BuildMux(api.Deps{
		Knowledge: kbapi.NewHandler(svc, authorizer, retrieve.New(pool), providers),
		Feeds:     feedapi.NewHandler(svc, authorizer),
		Users:     e2eUsers{pool}, GatewayToken: e2eToken,
	}))
	t.Cleanup(server.Close)

	worker := jobs.NewWorker(queue, "e2e-"+uuid.NewString()[:8], time.Millisecond)
	worker.Handle(jobs.KindParseDocument, parseDocumentHandler(svc))
	for kind, h := range handlers {
		worker.Handle(kind, h)
	}
	e := &e2e{t: t, pool: pool, server: server, worker: worker, user: user}
	kbID := uuid.MustParse(e.json(http.MethodPost, "/v1/kb", map[string]string{"name": "Feeds"}, http.StatusCreated)["id"].(string))
	return e, kbID
}

func TestAPodcastLinkIsFollowedAndTwoTickedEpisodesWaitForATranscript(t *testing.T) {
	e, kbID := newFeedsE2E(t)

	added := e.json(http.MethodPost, "/v1/kb/"+kbID.String()+"/links",
		map[string]any{"url": "https://example.com/show.rss"}, http.StatusAccepted)
	feed, ok := added["feed"].(map[string]any)
	if !ok || feed["kind"] != "podcast" || feed["entries"] != float64(4) || added["document"] != nil {
		t.Fatalf("Add a link = %v", added)
	}
	feedID := feed["id"].(string)

	view := e.json(http.MethodGet, "/v1/feeds/"+feedID, nil, http.StatusOK)
	var keys []string
	for _, raw := range view["entries"].([]any) {
		entry := raw.(map[string]any)
		if _, leaked := entry["media_url"]; leaked {
			t.Fatalf("an entry exposes its enclosure URL: %v", entry)
		}
		title := entry["title"].(string)
		if strings.HasPrefix(title, "Episode 3") || strings.HasPrefix(title, "Episode 2") {
			keys = append(keys, entry["key"].(string))
		}
	}
	if len(keys) != 2 {
		t.Fatalf("entries = %v", view["entries"])
	}

	picked := e.json(http.MethodPost, "/v1/feeds/"+feedID+"/entries", map[string]any{"entries": keys}, http.StatusAccepted)
	if len(picked["queued"].([]any)) != 2 {
		t.Fatalf("pick = %v", picked)
	}
	e.drainJobs()

	view = e.json(http.MethodGet, "/v1/feeds/"+feedID, nil, http.StatusOK)
	if view["feed"].(map[string]any)["added"] != float64(2) {
		t.Fatalf("feed after adding = %v", view["feed"])
	}
	for _, raw := range view["entries"].([]any) {
		entry := raw.(map[string]any)
		docID, _ := entry["document_id"].(string)
		if docID == "" {
			continue
		}
		doc := e.json(http.MethodGet, "/v1/documents/"+docID, nil, http.StatusOK)
		d := doc["document"].(map[string]any)
		if d["source_kind"] != "media" || d["status"] != "needs_transcript" || entry["document_status"] != "needs_transcript" {
			t.Fatalf("an episode's document = %v", d)
		}
	}
	// Nothing transcribes by itself.
	var transcribing int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM jobs WHERE user_id = $1 AND kind LIKE 'transcribe%'`, e.user).Scan(&transcribing)
	if transcribing != 0 {
		t.Fatalf("%d transcription jobs were queued", transcribing)
	}

	// A YouTube playlist link lists the keyless feed's latest 15 videos.
	added = e.json(http.MethodPost, "/v1/kb/"+kbID.String()+"/links",
		map[string]any{"url": "https://www.youtube.com/playlist?list=UU_x5XG1OV2P6uZZ5FSM9Ttw"}, http.StatusAccepted)
	if yt := added["feed"].(map[string]any); yt["kind"] != "youtube" || yt["entries"] != float64(15) || yt["listed_by"] != "feed" {
		t.Fatalf("playlist = %v", yt)
	}
	list := e.json(http.MethodGet, "/v1/kb/"+kbID.String()+"/feeds", nil, http.StatusOK)
	if len(list["feeds"].([]any)) != 2 || list["limits"].(map[string]any)["youtube_feed_limit"] != float64(15) {
		t.Fatalf("feeds = %v", list)
	}
}
