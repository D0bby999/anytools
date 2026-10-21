// Package api assembles AnyTools' HTTP surface.
package api

import (
	"encoding/json"
	"net/http"

	"github.com/D0bby999/anytools/internal/api/audioapi"
	"github.com/D0bby999/anytools/internal/api/authapi"
	"github.com/D0bby999/anytools/internal/api/bodyapi"
	"github.com/D0bby999/anytools/internal/api/bookapi"
	"github.com/D0bby999/anytools/internal/api/byokapi"
	"github.com/D0bby999/anytools/internal/api/chatapi"
	"github.com/D0bby999/anytools/internal/api/driveapi"
	"github.com/D0bby999/anytools/internal/api/examapi"
	"github.com/D0bby999/anytools/internal/api/feedapi"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/kbapi"
	"github.com/D0bby999/anytools/internal/api/loopapi"
	"github.com/D0bby999/anytools/internal/api/masteryapi"
	"github.com/D0bby999/anytools/internal/api/notebookapi"
	"github.com/D0bby999/anytools/internal/api/profileapi"
	"github.com/D0bby999/anytools/internal/api/pushapi"
	"github.com/D0bby999/anytools/internal/api/quizapi"
	"github.com/D0bby999/anytools/internal/api/readingapi"
	"github.com/D0bby999/anytools/internal/api/relatedapi"
	"github.com/D0bby999/anytools/internal/api/researchapi"
	"github.com/D0bby999/anytools/internal/api/solveapi"
	"github.com/D0bby999/anytools/internal/api/sourceapi"
	"github.com/D0bby999/anytools/internal/api/speakapi"
	"github.com/D0bby999/anytools/internal/api/storageapi"
	"github.com/D0bby999/anytools/internal/api/videonotesapi"
	"github.com/D0bby999/anytools/internal/api/visualizeapi"
	"github.com/D0bby999/anytools/internal/api/vocabapi"
	"github.com/D0bby999/anytools/internal/api/worksheetapi"
	"github.com/D0bby999/anytools/internal/api/zoteroapi"
)

// Deps are the collaborators BuildMux needs. Later phases add fields here
// rather than growing a construction god-function — postclaw's runGateway()
// reached 5036 lines because every subsystem was wired inline (scout §1).
type Deps struct {
	Auth      *authapi.Handler
	BYOK      *byokapi.Handler
	Chat      *chatapi.Handler
	Knowledge *kbapi.Handler
	Quiz      *quizapi.Handler
	Mastery   *masteryapi.Handler
	Notebook  *notebookapi.Handler
	Reading   *readingapi.Handler
	// Drive is phase 13's connector. Nil when no Google OAuth client is
	// configured: the routes are simply absent rather than present and
	// answering 503, so nothing in the UI offers a button that cannot work.
	Drive     *driveapi.Handler
	Solve     *solveapi.Handler
	Research  *researchapi.Handler
	Loop      *loopapi.Handler
	Visualize *visualizeapi.Handler
	Audio     *audioapi.Handler
	Related   *relatedapi.Handler
	// VideoNotes is a YouTube video's study notes.
	VideoNotes *videonotesapi.Handler
	// Sources is up-methods phase 18: documentation sites and repositories.
	Sources *sourceapi.Handler
	// Feeds is up-methods phase 17: podcast feeds and YouTube playlists.
	Feeds *feedapi.Handler
	// Exams is learning-depth phase 3: past papers and mock exams.
	Exams *examapi.Handler
	// Vocab is learning-depth phase 7: vocabulary notes and their cards.
	Vocab *vocabapi.Handler
	// Speak is the read-aloud check (the private design notes, phase 2).
	Speak *speakapi.Handler
	// Profile is learning-depth phase 9: the learner profile.
	Profile *profileapi.Handler
	// Worksheets is up-methods phase 0: up's worksheets.
	Worksheets *worksheetapi.Handler
	// Books is learning-depth phase 11: living books.
	Books *bookapi.Handler
	// Zotero is up-methods phase 20: "Add from Zotero".
	Zotero *zoteroapi.Handler
	// Storage is drive-user-storage phase 2: Settings → Storage.
	Storage *storageapi.Handler
	// Push is Settings → Reminders: the daily review reminder.
	Push *pushapi.Handler
	// Body is the training log and its coach (the private design notes).
	Body         *bodyapi.Handler
	Users        httpx.UserLookup
	GatewayToken string
	AllowNoAuth  bool
	RateLimiter  *httpx.RateLimiter
	// RouteLimiter holds the tighter per-class budgets (httpx.RouteClasses).
	RouteLimiter *httpx.RouteLimiter
}

// BuildMux registers every route and wraps the WHOLE mux in the auth
// chokepoint.
//
// Order, outermost first: Recover → RequireUser → Localize → RateLimiter →
// routes.
//   - Recover is outermost so a panic anywhere, middleware included, becomes a
//     500 rather than a process exit.
//   - RequireUser wraps everything so a route added in a later phase is
//     authenticated by default. Opting out requires editing
//     httpx.AllowlistedPaths, which a structural test watches.
//   - The rate limiter runs INSIDE RequireUser so its key is an authenticated
//     user id, not a header any caller could set.
func BuildMux(deps Deps) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", handleHealth)
	if deps.Auth != nil {
		deps.Auth.RegisterRoutes(mux)
	}
	if deps.BYOK != nil {
		deps.BYOK.RegisterRoutes(mux)
	}
	if deps.Chat != nil {
		deps.Chat.RegisterRoutes(mux)
	}
	if deps.Knowledge != nil {
		deps.Knowledge.RegisterRoutes(mux)
	}
	if deps.Quiz != nil {
		deps.Quiz.RegisterRoutes(mux)
	}
	if deps.Mastery != nil {
		deps.Mastery.RegisterRoutes(mux)
	}
	if deps.Notebook != nil {
		deps.Notebook.RegisterRoutes(mux)
	}
	if deps.Reading != nil {
		deps.Reading.RegisterRoutes(mux)
	}
	if deps.Drive != nil {
		deps.Drive.RegisterRoutes(mux)
	}
	if deps.Solve != nil {
		deps.Solve.RegisterRoutes(mux)
	}
	if deps.Research != nil {
		deps.Research.RegisterRoutes(mux)
	}
	if deps.Loop != nil {
		deps.Loop.RegisterRoutes(mux)
	}
	if deps.Visualize != nil {
		deps.Visualize.RegisterRoutes(mux)
	}
	if deps.Audio != nil {
		deps.Audio.RegisterRoutes(mux)
	}
	if deps.Related != nil {
		deps.Related.RegisterRoutes(mux)
	}
	if deps.VideoNotes != nil {
		deps.VideoNotes.RegisterRoutes(mux)
	}
	if deps.Sources != nil {
		deps.Sources.RegisterRoutes(mux)
	}
	if deps.Feeds != nil {
		deps.Feeds.RegisterRoutes(mux)
	}
	if deps.Books != nil {
		deps.Books.RegisterRoutes(mux)
	}
	if deps.Vocab != nil {
		deps.Vocab.RegisterRoutes(mux)
	}
	if deps.Speak != nil {
		deps.Speak.RegisterRoutes(mux)
	}
	if deps.Profile != nil {
		deps.Profile.RegisterRoutes(mux)
	}
	if deps.Exams != nil {
		deps.Exams.RegisterRoutes(mux)
	}
	if deps.Worksheets != nil {
		deps.Worksheets.RegisterRoutes(mux)
	}
	if deps.Zotero != nil {
		deps.Zotero.RegisterRoutes(mux)
	}
	if deps.Push != nil {
		deps.Push.RegisterRoutes(mux)
	}
	if deps.Storage != nil {
		deps.Storage.RegisterRoutes(mux)
	}
	if deps.Body != nil {
		deps.Body.RegisterRoutes(mux)
	}

	var handler http.Handler = mux
	if deps.RouteLimiter != nil {
		handler = deps.RouteLimiter.Middleware(mux, handler)
	}
	if deps.RateLimiter != nil {
		handler = deps.RateLimiter.Middleware(handler)
	}
	// Inside RequireUser, which reads the learner's language, and outside the
	// limiters, so their refusals are translated too.
	handler = httpx.Localize(handler)
	handler = httpx.RequireUser(handler, deps.GatewayToken, deps.Users, deps.AllowNoAuth)
	handler = httpx.Recover(handler)
	return handler
}

// RegisteredPatterns lists every pattern BuildMux registers.
//
// It exists so mux_allowlist_test.go can assert that nothing outside
// httpx.AllowlistedPaths escapes authentication. net/http's ServeMux does not
// expose its routing table, so the list is maintained here beside the
// registrations; the test fails if a pattern is registered without being
// declared, because a route nobody enumerated is exactly the route that would
// quietly ship unauthenticated.
func RegisteredPatterns() []string {
	patterns := []string{
		"GET /health",
		"POST /v1/auth/identity",
		"GET /v1/me",
		"PUT /v1/me/timezone",
		"PUT /v1/me/language",
		"DELETE /v1/me",
		"GET /v1/auth/session-watermark",
		"POST /v1/auth/session-watermark",

		// Phase 4 — BYOK. Every one of these sits behind RequireUser like
		// everything else; none is allowlisted, and none may be.
		"GET /v1/byok/connections",
		"POST /v1/byok/connections",
		"PUT /v1/byok/connections/{id}",
		"DELETE /v1/byok/connections/{id}",
		"POST /v1/byok/connections/{id}/verify",
		"GET /v1/byok/connections/{id}/models",
		"POST /v1/byok/connections/{id}/custom-models",
		"DELETE /v1/byok/connections/{id}/custom-models",
		"GET /v1/byok/catalog",
		"POST /v1/byok/connections/relay",
		"POST /v1/byok/connections/gemini-sub",
		"GET /v1/byok/connections/gemini-sub/auth-url",
		"POST /v1/byok/connections/copilot/start",
		"POST /v1/byok/connections/copilot/finish",
		"POST /v1/byok/connections/claude-sub/start",
		"POST /v1/byok/connections/claude-sub/finish",
		"GET /v1/byok/routes",
		"PUT /v1/byok/routes/{function}",
		"GET /v1/byok/search-connections",
		"POST /v1/byok/search-connections",
		"DELETE /v1/byok/search-connections/{id}",
		"POST /v1/byok/search-connections/{id}/verify",
		"GET /v1/readiness",
	}
	patterns = append(patterns, chatapi.Patterns()...)
	patterns = append(patterns, kbapi.Patterns()...)
	patterns = append(patterns, quizapi.Patterns()...)
	patterns = append(patterns, masteryapi.Patterns()...)
	// Phase 8. Every one of these sits behind RequireUser; none is allowlisted.
	patterns = append(patterns, notebookapi.Patterns()...)
	patterns = append(patterns, readingapi.Patterns()...)
	patterns = append(patterns, driveapi.Patterns()...)
	patterns = append(patterns, solveapi.Patterns()...)
	patterns = append(patterns, researchapi.Patterns()...)
	// Phase 10. Every one of these sits behind RequireUser; none is allowlisted.
	patterns = append(patterns, loopapi.Patterns()...)
	// Learning depth, phase 5: "Draw it".
	patterns = append(patterns, visualizeapi.Patterns()...)
	// Learning depth, phase 10: audio overviews.
	patterns = append(patterns, audioapi.Patterns()...)
	// Learning depth, phase 6: related papers.
	patterns = append(patterns, relatedapi.Patterns()...)
	// A YouTube video's study notes.
	patterns = append(patterns, videonotesapi.Patterns()...)
	patterns = append(patterns, sourceapi.Patterns()...)
	// Up-methods phase 17: podcast feeds and YouTube playlists.
	patterns = append(patterns, feedapi.Patterns()...)
	// Learning depth, phase 7. Behind RequireUser; none is allowlisted.
	patterns = append(patterns, vocabapi.Patterns()...)
	patterns = append(patterns, speakapi.Patterns()...)
	// Learning depth, phase 9: the learner profile.
	patterns = append(patterns, profileapi.Patterns()...)
	// Learning depth, phase 11: living books.
	patterns = append(patterns, bookapi.Patterns()...)
	// up-methods phase 11: the "write your own version first" switch.
	patterns = append(patterns, "PUT /v1/me/own-version-first")
	// Learning depth, phase 3: exams. Behind RequireUser; none is allowlisted.
	patterns = append(patterns, examapi.Patterns()...)
	// up methods, phase 0: worksheets. Behind RequireUser; none is allowlisted.
	patterns = append(patterns, worksheetapi.Patterns()...)
	// up methods, phase 20: a knowledge base's "Add from Zotero".
	patterns = append(patterns, zoteroapi.Patterns()...)
	// drive-user-storage phase 2: Settings → Storage.
	patterns = append(patterns, storageapi.Patterns()...)
	patterns = append(patterns, pushapi.Patterns()...)
	// Body: the training log and its coach. Behind RequireUser; none is allowlisted.
	patterns = append(patterns, bodyapi.Patterns()...)
	return patterns
}

// handleHealth is the one unauthenticated endpoint. It reports process
// liveness only — never database state, version or configuration, because
// anything it returns is readable by whatever can reach the port.
func handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
