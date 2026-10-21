package httpx

import (
	"net/http"
	"sort"
)

// route_limits.go — tighter per-user budgets for the routes that cost something.
//
// The general limiter (ratelimit.go) stops a runaway client. These stop the
// specific abuses a BYOK product invites: each of these routes spends the
// user's own provider quota, makes an outbound call on their behalf, or does
// heavy work (a parse, an index build) that every other user waits behind. A
// stolen session that hammers "verify" or "generate" should run out of budget
// here long before it runs up a bill on the victim's key.
//
// Keyed by (class, user): a user who has spent their upload budget can still
// chat. Classes are declared by mux PATTERN, looked up with the mux's own
// matcher, so `/v1/kb/{id}/documents` matches however the id is spelled, and a
// test (route_limits_test.go in package api) fails if a pattern named here is
// not registered — a renamed route cannot silently lose its limit.
//
// Every write route's registration carries a `// budget: <class>` comment
// (`none` when it spends nothing), and GET routes that spend carry one too.
// The same test holds those comments equal to this list, so a new route that
// calls a model, a TTS voice or a paper search is classified where it is
// registered, by whoever adds it.

// RouteClass is one budget shared by a set of routes.
type RouteClass struct {
	Name     string
	RPM      int
	Burst    int
	Patterns []string
}

// RouteClasses is the product's list. Numbers are per user.
var RouteClasses = []RouteClass{
	{
		// One real provider call each, against an endpoint the user named.
		Name: "verify", RPM: 10, Burst: 5,
		Patterns: []string{
			"POST /v1/byok/connections/{id}/verify",
			"POST /v1/byok/search-connections/{id}/verify",
			// Lists the provider's models: the same outbound call to an
			// endpoint the user named.
			"GET /v1/byok/connections/{id}/models",
			// A test reminder: one push per browser the learner subscribed.
			"POST /v1/push/test",
		},
	},
	{
		// A parse and an embed per document, on the user's key.
		Name: "upload", RPM: 30, Burst: 10,
		Patterns: []string{
			"POST /v1/kb/{id}/documents",
			"POST /v1/kb/{id}/reindex",
			"POST /v1/kb/{id}/drive/import",
			"POST /v1/connectors/drive/sync",
			"POST /v1/research/reports/{id}/knowledge",
			// A paper: one lookup, and a PDF fetch and parse or a note.
			"POST /v1/kb/{id}/papers",
			// Links (phase 4): a page fetch or a caption fetch, then a parse
			// and an embed; a re-sync can re-embed; a transcript upload or
			// paste re-indexes; an AI transcript is a Gemini call.
			"POST /v1/kb/{id}/links",
			"POST /v1/documents/{id}/resync",
			// A retry re-parses and re-embeds a failed upload.
			"POST /v1/documents/{id}/retry",
			"POST /v1/documents/{id}/transcript",
			"POST /v1/documents/{id}/transcribe",
			// An exam paper: read by the learner's parse model, then listed
			// in batches on their quiz model (exam/extract.go).
			"POST /v1/exams/templates",
			// Up-methods phase 7: a learner's recording on a worksheet, up
			// to 10 MB on disk.
			"POST /v1/worksheets/{id}/recordings",
			// The read-aloud check: a take of up to 30 s, heard on the
			// learner's stt route or the server's engine.
			"POST /v1/speaking/check",
			// Dictating a question into the chat composer: the same take,
			// heard the same way (plan 261021-1100 phase 2).
			"POST /v1/speaking/dictate",
			// An Anki deck's words: up to 200 notes and their cards a call.
			"POST /v1/vocab/import",
			// A general deck's cards: up to 200 a call (vocab/decks.go).
			"POST /v1/decks/{id}/cards",
			// Up-methods phase 18: a site crawl fetches up to 200 pages and a
			// repository sync one tarball; each embeds what changed.
			"POST /v1/kb/{id}/sites",
			"POST /v1/sites/{id}/resync",
			"POST /v1/kb/{id}/repos",
			"POST /v1/repos/{id}/resync",
			// Up-methods phase 20: an item of the learner's Zotero library,
			// its stored PDF up to 50 MB or a note, parsed and embedded.
			"POST /v1/kb/{id}/zotero/items",
			// Up-methods phase 17: checking a feed fetches it (and may spend
			// the learner's Data API quota); picking downloads episodes of up
			// to 500 MB each and may embed captions on the learner's key.
			"POST /v1/feeds/{id}/check",
			"POST /v1/feeds/{id}/entries",
			// drive-user-storage phase 2: moving every file between the
			// server and the learner's Drive, and saving an export into it.
			"POST /v1/me/file-storage/move",
			"POST /v1/worksheets/{id}/export/drive",
			"POST /v1/documents/{id}/study-notes/export/drive",
			"POST /v1/books/{id}/export/drive",
			"POST /v1/notebooks/{id}/export/drive",
		},
	},
	{
		// Model calls: every one of these starts at least one generation.
		Name: "generate", RPM: 30, Burst: 10,
		Patterns: []string{
			"POST /v1/chat/sessions/{id}/turns",
			"POST /v1/reading/{id}/actions",
			"POST /v1/reading/{id}/terms",
			"POST /v1/quiz/generate",
			"POST /v1/mastery/paths",
			"POST /v1/mastery/paths/{id}/propose",
			"POST /v1/mastery/paths/{id}/diagnostic",
			"POST /v1/solve",
			"POST /v1/research",
			// A short or open answer is marked by the model (quiz/judge.go).
			"POST /v1/questions/{id}/attempt",
			// Next generates a question when the knowledge point has none
			// left, and teaches a point never yet answered correctly
			// (mastery/session.go).
			"GET /v1/mastery/paths/{id}/next",
			// "Draw it": one diagram call, and at most one repair.
			"POST /v1/visualize",
			// Body's coach: one call for a plan, a review or a revision, and
			// at most one repair (body/coach.go).
			"POST /v1/body/coach/plan",
			"POST /v1/body/coach/review",
			"POST /v1/body/coach/proposals/{id}/refine",
			"POST /v1/visualize/{id}/repair",
			"POST /v1/reading/{id}/diagram",
			// A script call, then the learner's TTS in the background.
			"POST /v1/audio-overviews",
			"POST /v1/audio-overviews/{id}/speak",
			// Learning-depth phase 2: teaching a point (cached per point and
			// model, so only a miss spends) and judging an explain-back.
			"POST /v1/mastery/points/{id}/learn",
			"POST /v1/mastery/points/{id}/explain-back",
			// A model call for the queries, then paper searches (cached a day).
			"GET /v1/kb/{id}/related-papers",
			// Learning-depth phase 11: a book's proposal (one call and at most
			// one repair), a chapter's or the whole book's compile job, and
			// one block rewritten in the request.
			"POST /v1/books",
			"POST /v1/books/{id}/compile",
			"POST /v1/books/{id}/chapters/{cid}/compile",
			"POST /v1/books/{id}/blocks/{bid}/regenerate",
			// Learning-depth phase 3: a mock exam is up to 120 generation
			// calls in the background; submitting marks up to 60 answers
			// with the judge and the rubric (exam/mark.go).
			"POST /v1/exams",
			"POST /v1/exams/{id}/submit",
			// A video's study notes: one call over the whole transcript.
			"POST /v1/documents/{id}/study-notes",
			// up-methods phase 12: the cross-path review serves through the
			// same step as the per-path next, so it may teach or generate.
			"GET /v1/mastery/review/next",
			// up-methods phase 4: one pass of a writing evidence card
			// diagnosed in one call (cached per pass and draft).
			"POST /v1/worksheets/{id}/diagnose",
		},
	},
	{
		// Word lookups (the private design notes, phase 6): a
		// call to Tatoeba, Wikimedia Commons or the Free Dictionary API from
		// this server, cached a week; audio sent on from them.
		Name: "lookup", RPM: 30, Burst: 10,
		Patterns: []string{
			"GET /v1/vocab/lookup/sentences",
			"GET /v1/vocab/lookup/recordings",
			"GET /v1/vocab/lookup/audio",
		},
	},
	{
		// An embed call plus a hybrid search.
		Name: "search", RPM: 60, Burst: 20,
		Patterns: []string{
			"POST /v1/kb/{id}/query",
			// Up-methods phase 20: one Zotero Web API call on the learner's
			// key (two to browse a collection).
			"GET /v1/kb/{id}/zotero/search",
			"GET /v1/kb/{id}/zotero/collections",
		},
	},
}

// RouteLimiter applies RouteClasses in front of a mux.
type RouteLimiter struct {
	byRoute map[string]*classLimiter
	classes []*classLimiter
}

type classLimiter struct {
	name    string
	limiter *RateLimiter
}

// NewRouteLimiter builds the limiter. Pass RouteClasses in production; tests
// pass their own.
func NewRouteLimiter(classes []RouteClass) *RouteLimiter {
	rl := &RouteLimiter{byRoute: map[string]*classLimiter{}}
	for _, c := range classes {
		cl := &classLimiter{name: c.Name, limiter: NewRateLimiter(c.RPM, c.Burst)}
		rl.classes = append(rl.classes, cl)
		for _, p := range c.Patterns {
			rl.byRoute[p] = cl
		}
	}
	return rl
}

// LimitedPatterns lists every pattern with a class, sorted, for the test that
// checks each one is registered.
func (rl *RouteLimiter) LimitedPatterns() []string {
	out := make([]string, 0, len(rl.byRoute))
	for p := range rl.byRoute {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

// Close stops every class's cleanup goroutine.
func (rl *RouteLimiter) Close() {
	for _, c := range rl.classes {
		c.limiter.Close()
	}
}

// Middleware must run INSIDE RequireUser, like the general limiter. mux is the
// one whose patterns the classes name; its own matcher resolves the route.
func (rl *RouteLimiter) Middleware(mux *http.ServeMux, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserID(r.Context())
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		if _, pattern := mux.Handler(r); pattern != "" {
			if cl := rl.byRoute[pattern]; cl != nil && !cl.limiter.Allow(cl.name+":"+userID.String()) {
				w.Header().Set("Retry-After", "10")
				WriteError(w, http.StatusTooManyRequests,
					"too many of these requests — wait a minute and try again", "rate_limited")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
