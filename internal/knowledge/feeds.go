package knowledge

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	feedconn "github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/security"
)

// feeds.go — podcast feeds and YouTube playlists and channels (up-methods
// phase 17).
//
// A feed is a list the learner picks from. "Add a link" recognises one (a
// URL that serves RSS or Atom with audio, or a YouTube playlist, channel or
// handle link), reads it once, and stores its entries. The learner ticks
// entries and adds them; each becomes an ordinary document:
//
//   - a podcast episode a `media` document, through phase 15's path: its
//     enclosure is fetched once, under the media cap, and stored as the
//     recording. It is never played from its host;
//   - a YouTube entry a `youtube` document, through AddLink.
//
// Nothing is transcribed by itself: an episode rests in needs_transcript
// until the learner picks an engine and sees its cost. The daily sync pass
// checks each feed once a day; entries it finds are "New", and with
// auto_add on, up to 5 of them a day become documents (still untranscribed).

// MaxFeedsPerKB caps a knowledge base's feeds: each is checked every day.
const MaxFeedsPerKB = 20

// MaxAutoAddPerDay is how many new entries auto_add adds per feed in a day.
const MaxAutoAddPerDay = 5

// MaxPickPerRequest is how many entries one "Add" adds.
const MaxPickPerRequest = 20

// FeedCheckEvery is how often the daily pass checks a feed.
const FeedCheckEvery = 24 * time.Hour

// JobAddFeedEntries adds picked entries, one unit each.
const JobAddFeedEntries = "add_feed_entries"

// Feed listing sources.
const (
	ListedByFeed    = "feed"
	ListedByDataAPI = "data_api"
)

// Feed is a podcast feed or a YouTube playlist or channel.
type Feed struct {
	ID            uuid.UUID  `json:"id"`
	UserID        uuid.UUID  `json:"-"`
	KBID          uuid.UUID  `json:"kb_id"`
	Kind          string     `json:"kind"`
	URL           string     `json:"url"`
	Title         string     `json:"title"`
	LastCheckedAt *time.Time `json:"last_checked_at,omitempty"`
	CheckError    string     `json:"check_error,omitempty"`
	AutoAdd       bool       `json:"auto_add"`
	ListedBy      string     `json:"listed_by"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	// Counts over the entries.
	Entries int `json:"entries"`
	New     int `json:"new"`
	Added   int `json:"added"`
}

// FeedEntry is one episode or video of a feed.
type FeedEntry struct {
	Key             string     `json:"key"`
	Title           string     `json:"title"`
	PublishedAt     *time.Time `json:"published_at,omitempty"`
	DurationSeconds int        `json:"duration_seconds"`
	MediaURL        string     `json:"-"`
	MediaType       string     `json:"media_type,omitempty"`
	MediaBytes      int64      `json:"media_bytes,omitempty"`
	VideoID         string     `json:"video_id,omitempty"`
	New             bool       `json:"new"`
	AddStatus       string     `json:"add_status,omitempty"`
	AddError        string     `json:"add_error,omitempty"`
	// DocumentID is the document the entry is in this knowledge base as:
	// the one it was added as, or for a video any document of it.
	DocumentID *uuid.UUID `json:"document_id,omitempty"`
	DocStatus  string     `json:"document_status,omitempty"`
}

// FeedListing is what one read of a feed found.
type FeedListing struct {
	Title    string
	ListedBy string
	Entries  []feedconn.Entry
	// Note is a sentence about the listing (the Data API refused the key,
	// so only the latest 15 are listed); '' when there is nothing to say.
	Note string
}

// FeedStore is the persistence feeds need. Every method but DueFeeds is
// scoped by user.
type FeedStore interface {
	// CreateFeed inserts a feed with its first listing, refusing with
	// ErrFeedLimit when the knowledge base already has max feeds (counted
	// under the knowledge base's row lock) and ErrDuplicateSource for a URL
	// it follows already.
	CreateFeed(ctx context.Context, f Feed, l FeedListing, max int, at time.Time) (*Feed, error)
	GetFeed(ctx context.Context, userID, feedID uuid.UUID) (*Feed, error)
	ListFeeds(ctx context.Context, userID, kbID uuid.UUID) ([]Feed, error)
	FeedEntries(ctx context.Context, userID, feedID uuid.UUID) ([]FeedEntry, error)
	FeedEntry(ctx context.Context, userID, feedID uuid.UUID, key string) (*FeedEntry, error)
	DeleteFeed(ctx context.Context, userID, feedID uuid.UUID) error
	SetFeedAutoAdd(ctx context.Context, userID, feedID uuid.UUID, on bool) (*Feed, error)
	MarkFeedSeen(ctx context.Context, userID, feedID uuid.UUID) error
	// RecordFeedCheck stores a listing: entries upserted, those not seen
	// before marked new, the feed's newest feedconn.MaxEntries kept. It
	// returns how many entries were new.
	RecordFeedCheck(ctx context.Context, userID, feedID uuid.UUID, l FeedListing, at time.Time) (int, error)
	RecordFeedError(ctx context.Context, userID, feedID uuid.UUID, msg string, at time.Time) error
	// QueueFeedEntries marks the given entries queued, skipping any already
	// in the knowledge base or queued, and returns those it marked.
	QueueFeedEntries(ctx context.Context, userID, feedID uuid.UUID, keys []string) ([]string, error)
	// QueueAutoAdd marks up to max minus those auto-added since `since` of
	// the feed's new entries queued, oldest first, and returns them.
	QueueAutoAdd(ctx context.Context, userID, feedID uuid.UUID, since time.Time, max int, at time.Time) ([]string, error)
	SetEntryAdded(ctx context.Context, userID, feedID uuid.UUID, key string, docID *uuid.UUID) error
	SetEntryFailed(ctx context.Context, userID, feedID uuid.UUID, key, msg string) error
	DueFeeds(ctx context.Context, before time.Time, limit int) ([]Feed, error)
}

// YouTubeDataKeys reads the learner's own YouTube Data API key ("" when
// they have none). Wired to byok in internal/app; this package stores none.
type YouTubeDataKeys interface {
	YouTubeDataKey(ctx context.Context, userID uuid.UUID) (string, error)
}

// FeedConfig turns feeds on. It needs Links as well: entries become link
// documents.
type FeedConfig struct {
	Store FeedStore
	// Fetch reads podcast feeds and YouTube's pages (security.FetchClient).
	Fetch *http.Client
	// MediaFetch downloads an episode: security.FetchClient with a timeout
	// long enough for MaxMediaBytes.
	MediaFetch *http.Client
	YouTube    *feedconn.YouTube
	Data       *feedconn.Data
	Keys       YouTubeDataKeys
	Now        func() time.Time
}

// FeedJobPayload is the body of an add_feed_entries job.
type FeedJobPayload struct {
	FeedID uuid.UUID `json:"feed_id"`
	Keys   []string  `json:"keys"`
}

// ErrFeedLimit refuses a 21st feed in one knowledge base.
var ErrFeedLimit = fmt.Errorf("a knowledge base can follow at most %d feeds; remove one first", MaxFeedsPerKB)

// ErrFeedsUnavailable is returned when feeds are not wired.
var ErrFeedsUnavailable = errors.New("knowledge: feeds are not configured")

// LinkError codes of feeds.
const (
	LinkNotPodcast = "not_podcast"
	LinkFeedLimit  = "feed_limit"
)

func (s *Service) feedDeps() (*FeedConfig, error) {
	if s.feeds == nil || s.feeds.Store == nil || s.links == nil || s.links.Store == nil {
		return nil, ErrFeedsUnavailable
	}
	return s.feeds, nil
}

func (s *Service) feedNow() time.Time {
	if s.feeds != nil && s.feeds.Now != nil {
		return s.feeds.Now()
	}
	return s.now()
}

// ─────────────────────────────────────────────────────────── adding one

// addPodcastFeed follows a podcast feed whose bytes "Add a link" fetched.
func (s *Service) addPodcastFeed(ctx context.Context, userID, kbID uuid.UUID, u *url.URL, body []byte) (*UploadResult, error) {
	if _, err := s.feedDeps(); err != nil {
		return nil, err
	}
	parsed, err := feedconn.ParsePodcast(body)
	if err != nil {
		return nil, podcastError(err)
	}
	title := parsed.Title
	if title == "" {
		title = u.Host
	}
	listing := FeedListing{Title: title, ListedBy: ListedByFeed, Entries: parsed.Entries}
	return s.createFeed(ctx, Feed{UserID: userID, KBID: kbID, Kind: feedconn.KindPodcast, URL: u.String(), Title: title}, listing)
}

func podcastError(err error) error {
	if errors.Is(err, feedconn.ErrNoEpisodes) {
		return linkErr(LinkNotPodcast, "that feed has no audio episodes, so there is nothing to add from it", err)
	}
	return linkErr(LinkUnsupported, "that address serves XML that is not an RSS or Atom feed", err)
}

// addYouTubeFeed follows a playlist, a channel, or a handle's channel.
func (s *Service) addYouTubeFeed(ctx context.Context, userID, kbID uuid.UUID, t feedconn.Target) (*UploadResult, error) {
	deps, err := s.feedDeps()
	if err != nil {
		return nil, linkErr(LinkBadURL, "that YouTube link does not name a video", err)
	}
	if t, err = deps.YouTube.Resolve(ctx, t); err != nil {
		if errors.Is(err, feedconn.ErrNoChannel) {
			return nil, linkErr(LinkFetchFailed, "YouTube's page for that handle did not name a channel", err)
		}
		return nil, youtubeFeedError(err)
	}
	feed := Feed{UserID: userID, KBID: kbID, Kind: feedconn.KindYouTube, URL: feedconn.FeedURL(t)}
	listing, err := s.listFeed(ctx, &feed)
	if err != nil {
		return nil, err
	}
	feed.Title = listing.Title
	if feed.Title == "" {
		feed.Title = "YouTube " + t.Kind + " " + t.ID
	}
	return s.createFeed(ctx, feed, *listing)
}

func youtubeFeedError(err error) error {
	var status *security.HTTPStatusError
	if errors.As(err, &status) && status.Status == http.StatusNotFound {
		return linkErr(LinkFetchFailed, "YouTube has no public playlist or channel at that link", err)
	}
	if errors.Is(err, feedconn.ErrNotFeed) {
		return linkErr(LinkFetchFailed, "YouTube's feed for that link could not be read", err)
	}
	return fetchLinkError(err)
}

func (s *Service) createFeed(ctx context.Context, f Feed, l FeedListing) (*UploadResult, error) {
	deps := s.feeds
	f.ListedBy = l.ListedBy
	f.CheckError = l.Note
	feed, err := deps.Store.CreateFeed(ctx, f, l, MaxFeedsPerKB, s.feedNow())
	if errors.Is(err, ErrFeedLimit) {
		return nil, linkErr(LinkFeedLimit, ErrFeedLimit.Error(), err)
	}
	if err != nil {
		return nil, err
	}
	return &UploadResult{Feed: feed}, nil
}

// ───────────────────────────────────────────────────────────── listing

// listFeed reads a feed now. A podcast feed is fetched and parsed; a
// YouTube playlist is listed through the Data API when the learner has a
// key, else (and for a channel) through the keyless feed.
func (s *Service) listFeed(ctx context.Context, f *Feed) (*FeedListing, error) {
	deps := s.feeds
	if f.Kind == feedconn.KindPodcast {
		page, err := security.FetchPage(ctx, deps.Fetch, security.PageRequest{
			URL: f.URL, Accept: "application/rss+xml,application/atom+xml,application/xml;q=0.9",
			UserAgent: linkUserAgent, Types: feedconn.FeedTypes,
		})
		if err != nil {
			return nil, fetchLinkError(err)
		}
		parsed, err := feedconn.ParsePodcast(page.Body)
		if err != nil {
			return nil, podcastError(err)
		}
		return &FeedListing{Title: parsed.Title, ListedBy: ListedByFeed, Entries: parsed.Entries}, nil
	}

	note := ""
	if id, ok := feedconn.PlaylistOf(f.URL); ok && deps.Keys != nil && deps.Data != nil {
		key, err := deps.Keys.YouTubeDataKey(ctx, f.UserID)
		if err != nil {
			return nil, err
		}
		if key != "" {
			entries, truncated, err := deps.Data.Playlist(ctx, key, id)
			if err == nil {
				l := &FeedListing{Title: f.Title, ListedBy: ListedByDataAPI, Entries: entries}
				if truncated {
					l.Note = fmt.Sprintf("This playlist is longer than %d videos; the first %d are listed.", feedconn.MaxDataEntries, feedconn.MaxDataEntries)
				}
				if l.Title == "" {
					// The Data API's playlistItems carry no playlist title;
					// the keyless feed does, and costs nothing.
					if kf, kerr := deps.YouTube.Fetch(ctx, feedconn.Target{Kind: feedconn.TargetPlaylist, ID: id}); kerr == nil {
						l.Title = kf.Title
					}
				}
				return l, nil
			}
			// The keyless feed still works; the learner is told why only
			// the latest videos are listed. The sentence is the client's
			// own and never carries the key.
			var de *feedconn.DataError
			if errors.As(err, &de) {
				note = "The YouTube Data API could not list the whole playlist (" + de.Msg + "), so only the latest videos are listed."
			} else {
				note = "The YouTube Data API could not list the whole playlist, so only the latest videos are listed."
			}
		}
	}
	t, ok := youtubeTarget(f.URL)
	if !ok {
		return nil, linkErr(LinkBadURL, "this feed's address is not a YouTube feed", nil)
	}
	parsed, err := deps.YouTube.Fetch(ctx, t)
	if err != nil {
		return nil, youtubeFeedError(err)
	}
	return &FeedListing{Title: parsed.Title, ListedBy: ListedByFeed, Entries: parsed.Entries, Note: note}, nil
}

// youtubeTarget reads a stored keyless feed URL back into its target.
func youtubeTarget(feedURL string) (feedconn.Target, bool) {
	if id, ok := feedconn.PlaylistOf(feedURL); ok {
		return feedconn.Target{Kind: feedconn.TargetPlaylist, ID: id}, true
	}
	u, err := url.Parse(feedURL)
	if err != nil {
		return feedconn.Target{}, false
	}
	id := u.Query().Get("channel_id")
	if !channelPattern.MatchString(id) {
		return feedconn.Target{}, false
	}
	return feedconn.Target{Kind: feedconn.TargetChannel, ID: id}, true
}

var channelPattern = regexp.MustCompile(`^UC[A-Za-z0-9_-]{22}$`)

// ─────────────────────────────────────────────────────────────── reads

// ListFeeds are a knowledge base's feeds with their counts.
func (s *Service) ListFeeds(ctx context.Context, userID, kbID uuid.UUID) ([]Feed, error) {
	deps, err := s.feedDeps()
	if err != nil {
		return nil, err
	}
	return deps.Store.ListFeeds(ctx, userID, kbID)
}

// GetFeed is one feed with its entries.
func (s *Service) GetFeed(ctx context.Context, userID, feedID uuid.UUID) (*Feed, []FeedEntry, error) {
	deps, err := s.feedDeps()
	if err != nil {
		return nil, nil, err
	}
	feed, err := deps.Store.GetFeed(ctx, userID, feedID)
	if err != nil {
		return nil, nil, err
	}
	entries, err := deps.Store.FeedEntries(ctx, userID, feedID)
	if err != nil {
		return nil, nil, err
	}
	return feed, entries, nil
}

// DeleteFeed stops following a feed. The documents it added stay.
func (s *Service) DeleteFeed(ctx context.Context, userID, feedID uuid.UUID) error {
	deps, err := s.feedDeps()
	if err != nil {
		return err
	}
	return deps.Store.DeleteFeed(ctx, userID, feedID)
}

// SetFeedAutoAdd turns auto_add on or off.
func (s *Service) SetFeedAutoAdd(ctx context.Context, userID, feedID uuid.UUID, on bool) (*Feed, error) {
	deps, err := s.feedDeps()
	if err != nil {
		return nil, err
	}
	return deps.Store.SetFeedAutoAdd(ctx, userID, feedID, on)
}

// MarkFeedSeen clears the feed's "New" marks.
func (s *Service) MarkFeedSeen(ctx context.Context, userID, feedID uuid.UUID) error {
	deps, err := s.feedDeps()
	if err != nil {
		return err
	}
	return deps.Store.MarkFeedSeen(ctx, userID, feedID)
}

// ───────────────────────────────────────────────────────────── checking

// CheckFeed reads a feed now, because the learner asked. New entries are
// marked new; nothing is added by itself here.
func (s *Service) CheckFeed(ctx context.Context, userID, feedID uuid.UUID) (*Feed, int, error) {
	deps, err := s.feedDeps()
	if err != nil {
		return nil, 0, err
	}
	feed, err := deps.Store.GetFeed(ctx, userID, feedID)
	if err != nil {
		return nil, 0, err
	}
	n, err := s.checkFeed(ctx, feed)
	if err != nil {
		return nil, 0, err
	}
	feed, err = deps.Store.GetFeed(ctx, userID, feedID)
	return feed, n, err
}

// checkFeed lists a feed and records what it found, or why it could not.
func (s *Service) checkFeed(ctx context.Context, feed *Feed) (int, error) {
	deps := s.feeds
	at := s.feedNow()
	listing, err := s.listFeed(ctx, feed)
	if err != nil {
		if werr := deps.Store.RecordFeedError(ctx, feed.UserID, feed.ID, syncSentence(err), at); werr != nil {
			slog.Warn("knowledge: could not record a feed check", "feed", feed.ID, "error", werr)
		}
		return 0, err
	}
	if listing.Title == "" {
		listing.Title = feed.Title
	}
	return deps.Store.RecordFeedCheck(ctx, feed.UserID, feed.ID, *listing, at)
}

// FeedSyncReport is one pass of the daily feed check.
type FeedSyncReport struct {
	Checked, New, AutoAdded, Failed int
}

// SyncDueFeeds checks every feed last checked a day ago or more, across
// users, and queues auto_add's entries. Each feed is handled on its own; an
// error on one is recorded on its row and the pass goes on. Only a failure
// to LIST ends it.
func (s *Service) SyncDueFeeds(ctx context.Context) (FeedSyncReport, error) {
	var rep FeedSyncReport
	deps, err := s.feedDeps()
	if err != nil {
		return rep, err
	}
	now := s.feedNow()
	// An hour's slack, as for web links, so an hourly ticker does not drift.
	due, err := deps.Store.DueFeeds(ctx, now.Add(-FeedCheckEvery+time.Hour), 200)
	if err != nil {
		return rep, err
	}
	for i := range due {
		if ctx.Err() != nil {
			return rep, ctx.Err()
		}
		feed := &due[i]
		rep.Checked++
		n, err := s.checkFeed(ctx, feed)
		if err != nil {
			rep.Failed++
			slog.Info("knowledge: feed check failed", "feed", feed.ID, "error", err)
			continue
		}
		rep.New += n
		if !feed.AutoAdd {
			continue
		}
		added, err := s.autoAdd(ctx, feed, now)
		if err != nil {
			rep.Failed++
			slog.Info("knowledge: feed auto-add not queued", "feed", feed.ID, "error", err)
		}
		rep.AutoAdded += added
	}
	return rep, nil
}

// autoAdd queues up to MaxAutoAddPerDay of the feed's new entries a day.
// The window is the last 24 hours, counted in the store, so a second pass
// on the same day adds nothing more.
func (s *Service) autoAdd(ctx context.Context, feed *Feed, now time.Time) (int, error) {
	keys, err := s.feeds.Store.QueueAutoAdd(ctx, feed.UserID, feed.ID, now.Add(-24*time.Hour), MaxAutoAddPerDay, now)
	if err != nil || len(keys) == 0 {
		return 0, err
	}
	if _, err := s.enqueueFeedAdds(ctx, feed.UserID, feed.ID, keys); err != nil {
		return 0, err
	}
	return len(keys), nil
}

// ───────────────────────────────────────────────────────────── picking

// ErrNoEntries: a pick named no entry of the feed that could be added.
var ErrNoEntries = errors.New("none of those entries can be added: they are already in this knowledge base, already being added, or not in this feed")

var entryKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// AddFeedEntries queues the entries the learner ticked. Only keys of this
// feed's own entries are queued (the feed is the caller's, resolved by
// user); anything else in the list is ignored.
func (s *Service) AddFeedEntries(ctx context.Context, userID, feedID uuid.UUID, keys []string) (uuid.UUID, []string, error) {
	deps, err := s.feedDeps()
	if err != nil {
		return uuid.Nil, nil, err
	}
	// The feed before the body: another user's feed answers 404 whatever
	// the keys are.
	if _, err := deps.Store.GetFeed(ctx, userID, feedID); err != nil {
		return uuid.Nil, nil, err
	}
	if len(keys) == 0 {
		return uuid.Nil, nil, linkErr(LinkBadURL, "tick at least one entry to add", nil)
	}
	if len(keys) > MaxPickPerRequest {
		return uuid.Nil, nil, linkErr(LinkBadURL, fmt.Sprintf("add at most %d entries at a time", MaxPickPerRequest), nil)
	}
	seen := map[string]bool{}
	var clean []string
	for _, k := range keys {
		if !entryKeyPattern.MatchString(k) {
			return uuid.Nil, nil, linkErr(LinkBadURL, "that entry is not one of this feed's", nil)
		}
		if !seen[k] {
			seen[k] = true
			clean = append(clean, k)
		}
	}
	queued, err := deps.Store.QueueFeedEntries(ctx, userID, feedID, clean)
	if err != nil {
		return uuid.Nil, nil, err
	}
	if len(queued) == 0 {
		return uuid.Nil, nil, linkErr(LinkBusy, ErrNoEntries.Error(), ErrNoEntries)
	}
	jobID, err := s.enqueueFeedAdds(ctx, userID, feedID, queued)
	if err != nil {
		return uuid.Nil, nil, err
	}
	return jobID, queued, nil
}

func (s *Service) enqueueFeedAdds(ctx context.Context, userID, feedID uuid.UUID, keys []string) (uuid.UUID, error) {
	// Two attempts, one unit per entry (jobs.RunUnits): a retry never adds
	// an entry twice.
	jobID, err := s.jobs.Enqueue(ctx, userID, JobAddFeedEntries, FeedJobPayload{FeedID: feedID, Keys: keys}, 2)
	if err != nil {
		for _, k := range keys {
			_ = s.feeds.Store.SetEntryFailed(ctx, userID, feedID, k, "adding could not be queued. Try again.")
		}
		return uuid.Nil, err
	}
	return jobID, nil
}

// RunFeedAdds is the add_feed_entries job: each entry is a unit.
func (s *Service) RunFeedAdds(ctx context.Context, userID uuid.UUID, p FeedJobPayload, run UnitRunner) error {
	if _, err := s.feedDeps(); err != nil {
		return errTerminal{err}
	}
	return run(ctx, len(p.Keys), func(ctx context.Context, i int) (int, error) {
		return 0, s.AddFeedEntry(ctx, userID, p.FeedID, p.Keys[i])
	})
}

// FailFeedAdds settles the entries of a job that will not run again.
func (s *Service) FailFeedAdds(ctx context.Context, userID uuid.UUID, p FeedJobPayload) {
	deps, err := s.feedDeps()
	if err != nil {
		return
	}
	for _, k := range p.Keys {
		e, err := deps.Store.FeedEntry(ctx, userID, p.FeedID, k)
		if err != nil || e.AddStatus != "queued" {
			continue
		}
		_ = deps.Store.SetEntryFailed(ctx, userID, p.FeedID, k, "adding stopped before it finished. Try again.")
	}
}

// AddFeedEntry turns one queued entry into a document. A failure of this
// entry (a host that refused, a file that is not audio) is recorded on its
// row and is not the job's: the next entry still runs. Only a context
// error, or the feed gone, is returned.
func (s *Service) AddFeedEntry(ctx context.Context, userID, feedID uuid.UUID, key string) error {
	deps, err := s.feedDeps()
	if err != nil {
		return errTerminal{err}
	}
	feed, err := deps.Store.GetFeed(ctx, userID, feedID)
	if err != nil {
		if errors.Is(err, authz.ErrNoAccess) {
			return errTerminal{err}
		}
		return err
	}
	entry, err := deps.Store.FeedEntry(ctx, userID, feedID, key)
	if errors.Is(err, authz.ErrNoAccess) {
		return nil // trimmed from the feed meanwhile
	}
	if err != nil {
		return err
	}
	if entry.DocumentID != nil {
		return deps.Store.SetEntryAdded(ctx, userID, feedID, key, entry.DocumentID)
	}

	var res *UploadResult
	if entry.VideoID != "" {
		res, err = s.AddLink(ctx, userID, feed.KBID, youtube.WatchURL(entry.VideoID), false)
	} else {
		res, err = s.addEpisode(ctx, userID, feed.KBID, entry)
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	switch {
	case err == nil && res != nil && res.Document != nil:
		return deps.Store.SetEntryAdded(ctx, userID, feedID, key, &res.Document.ID)
	case IsDuplicateDocument(err) && entry.VideoID != "":
		// Added by hand already: FeedEntries finds that document itself.
		return deps.Store.SetEntryAdded(ctx, userID, feedID, key, nil)
	case err == nil:
		err = errors.New("no document was made")
	}
	slog.Info("knowledge: a feed entry was not added", "feed", feedID, "error", err)
	return deps.Store.SetEntryFailed(ctx, userID, feedID, key, entrySentence(err))
}

// enclosureTypes are what an episode may be served as. Hosts often send a
// generic type; the bytes are sniffed afterwards either way.
var enclosureTypes = []string{
	"audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/wav", "audio/x-wav",
	"audio/wave", "audio/ogg", "audio/opus", "audio/webm", "video/mp4", "video/x-m4v", "video/quicktime",
	"video/mpeg", "video/webm", "application/octet-stream", "binary/octet-stream", "",
}

// episodeFetchBudget bounds one episode's download.
const episodeFetchBudget = 10 * time.Minute

// addEpisode downloads an episode's enclosure, under the media cap, and
// stores it as a recording waiting for a transcript (phase 15's path).
func (s *Service) addEpisode(ctx context.Context, userID, kbID uuid.UUID, e *FeedEntry) (*UploadResult, error) {
	if e.MediaBytes > MaxMediaBytes {
		return nil, ErrMediaTooLarge
	}
	fetchCtx, cancel := context.WithTimeout(ctx, episodeFetchBudget)
	defer cancel()
	client := s.feeds.MediaFetch
	if client == nil {
		client = s.feeds.Fetch
	}
	stream, err := security.OpenStream(fetchCtx, client, security.PageRequest{
		URL: e.MediaURL, Accept: "audio/*,video/*;q=0.9,*/*;q=0.5", UserAgent: linkUserAgent, Types: enclosureTypes,
	}, MaxMediaBytes)
	if err != nil {
		return nil, err
	}
	defer stream.Body.Close()
	data, over, err := blob.ReadAllLimited(stream.Body, MaxMediaBytes)
	if errors.Is(err, security.ErrStreamTooLarge) || (err == nil && over) {
		return nil, ErrMediaTooLarge
	}
	if err != nil {
		return nil, err
	}
	title := strings.NewReplacer("/", "-", "\\", "-").Replace(e.Title)
	return s.storeMedia(ctx, userID, kbID, "episode"+feedconn.Extension(e.MediaURL, e.MediaType), title, data)
}

// entrySentence is an entry's add_error.
func entrySentence(err error) string {
	var status *security.HTTPStatusError
	var le *LinkError
	switch {
	case errors.Is(err, ErrMediaTooLarge), errors.Is(err, security.ErrStreamTooLarge):
		return fmt.Sprintf("the episode is larger than %d MB", MaxMediaBytes>>20)
	case errors.Is(err, parse.ErrUnsupportedType), errors.Is(err, security.ErrPageType):
		return "the episode's file is not audio or video AnyLearn can read"
	case IsDuplicateDocument(err):
		return "this episode's recording is already in this knowledge base"
	case errors.As(err, &status):
		return fmt.Sprintf("the episode's host answered HTTP %d", status.Status)
	case errors.Is(err, security.ErrFetchURL), security.IsInternalAddress(err):
		return "the episode's address is not on the public internet"
	case errors.Is(err, context.DeadlineExceeded):
		return "the episode took too long to download"
	case errors.As(err, &le):
		return truncateSentence(le.Msg)
	case strings.Contains(err.Error(), "stopped after"):
		return "the episode's address redirected too many times"
	}
	return "the episode could not be downloaded. Try again."
}

func truncateSentence(s string) string {
	if r := []rune(s); len(r) > 300 {
		return string(r[:300])
	}
	return s
}
