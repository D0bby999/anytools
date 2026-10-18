package blob

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
)

// Each way a learner's Drive file can be out of reach has its own status,
// code and sentence, wherever in the chain the reason sits (phase 3).
func TestEachUnavailableFileHasItsOwnCodeAndSentence(t *testing.T) {
	seen := map[string]bool{}
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{fmt.Errorf("drive: GET: %w: %w", ErrReconnect, errors.New("drive: the connection needs to be reconnected")), http.StatusConflict, "drive_reconnect"},
		{fmt.Errorf("open: %w", ErrRemoved), http.StatusGone, "drive_file_removed"},
		{fmt.Errorf("put: %w", ErrRemoteFull), http.StatusInsufficientStorage, "drive_full"},
	} {
		reason, ok := Unavailable(tc.err)
		if !ok || reason.Status != tc.status || reason.Code != tc.code {
			t.Errorf("%v answered %+v", tc.err, reason)
		}
		if reason.Message == "" || seen[reason.Message] {
			t.Errorf("%s has no sentence of its own: %q", tc.code, reason.Message)
		}
		seen[reason.Message] = true
	}
	for _, err := range []error{nil, ErrNotFound, ErrCorrupt, errors.New("disk on fire")} {
		if reason, ok := Unavailable(err); ok {
			t.Errorf("%v is not an unavailable Drive file, answered %+v", err, reason)
		}
	}
}

// A stored sentence gives its code back; nothing else does.
func TestAStoredSentenceGivesItsReasonBack(t *testing.T) {
	for _, want := range []Reason{ReasonReconnect, ReasonRemoved, ReasonFull} {
		if got, ok := ReasonOf(want.Message); !ok || got != want {
			t.Errorf("%q gave %+v, %v", want.Message, got, ok)
		}
	}
	for _, msg := range []string{"", "the uploaded file is no longer available", "drive_reconnect", ReasonReconnect.Message + " "} {
		if got, ok := ReasonOf(msg); ok {
			t.Errorf("%q is no reason, gave %+v", msg, got)
		}
	}
}

func TestARemovedFileIsNotSimplyGone(t *testing.T) {
	if !Gone(ErrNotFound) || !Gone(fmt.Errorf("x: %w", ErrNotFound)) {
		t.Fatal("a missing file is not gone")
	}
	if Gone(ErrRemoved) || Gone(nil) || Gone(ErrReconnect) {
		t.Fatal("a file removed from Drive, or out of reach, reads as simply gone")
	}
	// Callers that only know "missing" still see it as missing.
	if !errors.Is(ErrRemoved, ErrNotFound) {
		t.Fatal("ErrRemoved stopped being a kind of ErrNotFound")
	}
}
