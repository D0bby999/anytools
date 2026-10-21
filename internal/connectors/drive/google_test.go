package drive

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestHasScope(t *testing.T) {
	granted := "openid " + ScopeDriveFile + " " + ScopeCalendarAppCreated
	if !HasScope(granted, ScopeDriveFile, ScopeCalendarAppCreated) {
		t.Fatal("both granted scopes should be found")
	}
	if HasScope(granted, ScopePhotosPicker) {
		t.Fatal("a scope that was not granted must not be found")
	}
	// Exact tokens only: calendar.app.created is not calendar.app.
	if HasScope(granted, "https://www.googleapis.com/auth/calendar.app") {
		t.Fatal("a prefix of a granted scope must not count")
	}
}

func TestSensitiveAllowed(t *testing.T) {
	t.Setenv("ANYTOOLS_GOOGLE_SENSITIVE_SCOPES", "")
	if SensitiveAllowed("a@example.com") {
		t.Fatal("unset means nobody")
	}
	t.Setenv("ANYTOOLS_GOOGLE_SENSITIVE_SCOPES", " Tester@Example.com , b@example.com")
	if !SensitiveAllowed("tester@example.com") || SensitiveAllowed("c@example.com") || SensitiveAllowed("") {
		t.Fatal("the list allows exactly its own addresses, case-insensitively")
	}
	t.Setenv("ANYTOOLS_GOOGLE_SENSITIVE_SCOPES", "all")
	if !SensitiveAllowed("") {
		t.Fatal(`"all" allows everybody`)
	}
}

func TestFeatureStates(t *testing.T) {
	rec := newRecorder(t)
	svc, store, _, user := newTestService(t, rec)
	svc.emailOf = func(context.Context, uuid.UUID) (string, error) { return "tester@example.com", nil }
	store.conns[user].Scope = ScopeDriveFile + " " + ScopeCalendarAppCreated

	t.Setenv("ANYTOOLS_GOOGLE_SENSITIVE_SCOPES", "")
	got := map[string]FeatureState{}
	for _, f := range svc.FeatureStates(context.Background(), user, store.conns[user].Scope) {
		got[f.ID] = f
	}
	if !got[FeatureDrive].Available || !got[FeatureDrive].Granted {
		t.Fatalf("drive: %+v", got[FeatureDrive])
	}
	if got[FeatureClassroom].Available || got[FeatureClassroom].Granted {
		t.Fatalf("classroom must be withheld from a non-tester: %+v", got[FeatureClassroom])
	}
	// Granted stays true for a scope given earlier, even while the feature is
	// not offered; the page must not hide what the grant already covers.
	if !got[FeatureCalendar].Granted {
		t.Fatalf("calendar: %+v", got[FeatureCalendar])
	}

	t.Setenv("ANYTOOLS_GOOGLE_SENSITIVE_SCOPES", "tester@example.com")
	for _, f := range svc.FeatureStates(context.Background(), user, "") {
		if !f.Available || f.Granted {
			t.Fatalf("%s for a tester with no grant: %+v", f.ID, f)
		}
	}
}

func TestToken_RefusesAMissingScope(t *testing.T) {
	rec := newRecorder(t)
	svc, _, _, user := newTestService(t, rec)
	if _, err := svc.Token(context.Background(), user, ScopeCalendarAppCreated); !errors.Is(err, ErrScopeMissing) {
		t.Fatalf("err = %v, want ErrScopeMissing", err)
	}
	tok, err := svc.Token(context.Background(), user, ScopeDriveFile)
	if err != nil || tok != "test-access-token" {
		t.Fatalf("tok=%q err=%v", tok, err)
	}
}

// Red team #1: a consent from another Google account must not replace the
// grant Drive's files depend on.
func TestConnect_RefusesAnotherGoogleAccount(t *testing.T) {
	rec := newRecorder(t)
	svc, store, _, user := newTestService(t, rec)
	store.conns[user].GoogleSub = "sub-a"

	err := svc.Connect(context.Background(), user, Credentials{
		RefreshToken: "1//new", AccessToken: "ya29.new", Scope: ScopeDriveFile, GoogleSub: "sub-b",
	})
	if !errors.Is(err, ErrDifferentAccount) {
		t.Fatalf("err = %v, want ErrDifferentAccount", err)
	}
	if store.conns[user].RefreshToken != "1//0g-stored-refresh" {
		t.Fatal("the stored grant was replaced")
	}

	// The same account widens the grant, and a consent that names no subject
	// keeps the one on file.
	if err := svc.Connect(context.Background(), user, Credentials{
		RefreshToken: "1//wider", AccessToken: "ya29.w", Scope: ScopeDriveFile + " " + ScopeCalendarAppCreated,
	}); err != nil {
		t.Fatal(err)
	}
	if c := store.conns[user]; c.GoogleSub != "sub-a" || c.Email != "owner@example.com" || !HasScope(c.Scope, ScopeCalendarAppCreated) {
		t.Fatalf("after widening: sub=%q email=%q scope=%q", c.GoogleSub, c.Email, c.Scope)
	}
}
