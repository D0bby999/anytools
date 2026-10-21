package drive

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/config"
)

// google.go — the Drive grant as the learner's one Google grant
// (learning-tool-connections phase 1).
//
// Calendar, Classroom and Google Photos ask for their scopes on top of the
// grant Drive already holds, through incremental authorization
// (include_granted_scopes=true): one consent per feature, one refresh token
// that carries every scope granted so far, one row in drive_connections whose
// `scope` column records them verbatim. The table keeps its name; it is the
// Google grant now, and Drive is the feature every Google consent includes.
//
// Disconnecting therefore ends every Google feature at once. Google revokes a
// token, not a scope, so there is no honest per-feature disconnect; the UI
// says which features stop.

// Scopes beyond drive.file. Each feature's list is what its consent asks for.
const (
	ScopeOpenID              = "openid"
	ScopeEmail               = "email"
	ScopeCalendarAppCreated  = "https://www.googleapis.com/auth/calendar.app.created"
	ScopeClassroomCourses    = "https://www.googleapis.com/auth/classroom.courses.readonly"
	ScopeClassroomMaterials  = "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly"
	ScopeClassroomCourseWork = "https://www.googleapis.com/auth/classroom.coursework.me.readonly"
	ScopeClassroomNotices    = "https://www.googleapis.com/auth/classroom.announcements.readonly"
	ScopePhotosPicker        = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly"
)

// Feature ids, shared with the BFF's consent route and the /apps page.
const (
	FeatureDrive     = "drive"
	FeatureCalendar  = "calendar"
	FeatureClassroom = "classroom"
	FeaturePhotos    = "photos"
)

// Feature is one Google feature a learner can turn on.
type Feature struct {
	ID     string   `json:"id"`
	Scopes []string `json:"scopes"`
	// Sensitive scopes need Google's verification before strangers may grant
	// them; until then only the test accounts in
	// ANYTOOLS_GOOGLE_SENSITIVE_SCOPES are offered the consent.
	Sensitive bool `json:"sensitive"`
}

// Features is the closed catalogue. Forms, Sheets, NotebookLM and YouTube
// are not here: they work under drive.file or an API key.
var Features = []Feature{
	{ID: FeatureDrive, Scopes: []string{ScopeDriveFile}},
	{ID: FeatureCalendar, Scopes: []string{ScopeCalendarAppCreated}, Sensitive: true},
	{ID: FeatureClassroom, Scopes: []string{
		ScopeClassroomCourses, ScopeClassroomMaterials, ScopeClassroomCourseWork, ScopeClassroomNotices,
	}, Sensitive: true},
	{ID: FeaturePhotos, Scopes: []string{ScopePhotosPicker}, Sensitive: true},
}

// FeatureByID finds a feature in the catalogue.
func FeatureByID(id string) (Feature, bool) {
	for _, f := range Features {
		if f.ID == id {
			return f, true
		}
	}
	return Feature{}, false
}

// FeatureState is a feature as one learner sees it.
type FeatureState struct {
	Feature
	// Available: this learner may be offered the consent.
	Available bool `json:"available"`
	// Granted: every scope of the feature is in the stored grant.
	Granted bool `json:"granted"`
}

// ErrScopeMissing reports a grant that lacks a scope the caller needs: the
// learner has not turned that feature on, or unticked it at Google.
var ErrScopeMissing = errors.New("drive: the Google connection does not include this feature yet")

// ErrDifferentAccount reports a consent given with another Google account
// than the one already connected. Storing it would replace the grant Drive's
// files and the other features depend on.
var ErrDifferentAccount = errors.New("drive: that is a different Google account from the one already connected")

// HasScope reports whether a space-separated grant includes every scope.
func HasScope(granted string, want ...string) bool {
	have := strings.Fields(granted)
	for _, w := range want {
		if !slices.Contains(have, w) {
			return false
		}
	}
	return true
}

// SensitiveAllowed reports whether sensitive features may be offered to the
// learner with this email: ANYTOOLS_GOOGLE_SENSITIVE_SCOPES is "all" once
// Google has verified the app, or a comma-separated list of test accounts.
func SensitiveAllowed(email string) bool {
	raw := strings.TrimSpace(config.Getenv("ANYTOOLS_GOOGLE_SENSITIVE_SCOPES"))
	if raw == "" {
		return false
	}
	email = strings.ToLower(strings.TrimSpace(email))
	for _, part := range strings.Split(raw, ",") {
		part = strings.ToLower(strings.TrimSpace(part))
		if part == "all" || (part != "" && part == email) {
			return true
		}
	}
	return false
}

// FeatureStates lists the catalogue for one learner.
func (s *Service) FeatureStates(ctx context.Context, userID uuid.UUID, granted string) []FeatureState {
	email := ""
	if s.emailOf != nil {
		email, _ = s.emailOf(ctx, userID)
	}
	allowed := SensitiveAllowed(email)
	out := make([]FeatureState, 0, len(Features))
	for _, f := range Features {
		out = append(out, FeatureState{
			Feature:   f,
			Available: !f.Sensitive || allowed,
			Granted:   granted != "" && HasScope(granted, f.Scopes...),
		})
	}
	return out
}

// Token returns an access token for a grant that includes every scope asked
// for. Other connectors (Calendar, Classroom, Forms, Photos) call this rather
// than holding a grant of their own.
func (s *Service) Token(ctx context.Context, userID uuid.UUID, scopes ...string) (string, error) {
	conn, err := s.store.GetConnection(ctx, userID)
	if err != nil {
		return "", err
	}
	if !HasScope(conn.Scope, scopes...) {
		return "", ErrScopeMissing
	}
	return s.accessToken(ctx, userID)
}

// TokenRejected renews the access token after a Google API answered 401 to
// rejected; see refreshRejected.
func (s *Service) TokenRejected(ctx context.Context, userID uuid.UUID, rejected string) (string, error) {
	return s.refreshRejected(ctx, userID, rejected)
}

// sameAccount reports whether a new consent may replace the stored grant: the
// same Google subject, or a side that does not know its subject (rows from
// before phase 1, or a BFF that sent none).
func sameAccount(stored *Connection, incoming string) bool {
	return stored == nil || stored.GoogleSub == "" || incoming == "" || stored.GoogleSub == incoming
}

// GoogleDo sends one request to any Google API with the learner's token,
// after checking the grant includes the scopes the call needs. A 401
// refreshes once and sends again; a second marks the grant for reconnecting,
// exactly as Drive's own calls do.
func (s *Service) GoogleDo(ctx context.Context, userID uuid.UUID, scopes []string, send func(tok string) (*http.Response, error)) (*http.Response, error) {
	conn, err := s.store.GetConnection(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !HasScope(conn.Scope, scopes...) {
		return nil, ErrScopeMissing
	}
	resp, _, err := s.authorized(ctx, userID, send)
	return resp, err
}

// ExportSheet returns a picked Google Sheet's first sheet as CSV, with its
// name. Only drive.file is needed: the learner picked the file.
func (s *Service) ExportSheet(ctx context.Context, userID uuid.UUID, fileID string) (string, []byte, error) {
	c := s.client(userID)
	f, err := c.GetFile(ctx, fileID)
	if err != nil {
		return "", nil, err
	}
	if f.MimeType != MimeGoogleSheet {
		return "", nil, ErrNotASheet
	}
	data, _, err := c.ExportDoc(ctx, fileID, "text/csv")
	if err != nil {
		return "", nil, err
	}
	return f.Name, data, nil
}

// ErrNotASheet reports a picked file that is not a Google Sheet.
var ErrNotASheet = errors.New("drive: that file is not a Google Sheet")
