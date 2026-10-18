package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/D0bby999/anytools/internal/blob"
)

func TestWriteStorageErrorAnswersEachReason(t *testing.T) {
	for _, reason := range []blob.Reason{blob.ReasonReconnect, blob.ReasonRemoved, blob.ReasonFull} {
		var err error
		switch reason.Code {
		case "drive_reconnect":
			err = fmt.Errorf("read: %w", blob.ErrReconnect)
		case "drive_file_removed":
			err = fmt.Errorf("read: %w", blob.ErrRemoved)
		default:
			err = fmt.Errorf("put: %w", blob.ErrRemoteFull)
		}
		w := httptest.NewRecorder()
		if !WriteStorageError(w, err) {
			t.Fatalf("%s was not answered", reason.Code)
		}
		var body ErrorBody
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != reason.Status || body.Code != reason.Code || body.Error != reason.Message {
			t.Errorf("%s answered %d %+v", reason.Code, w.Code, body)
		}
	}
	w := httptest.NewRecorder()
	if WriteStorageError(w, blob.ErrNotFound) || WriteStorageError(w, errors.New("other")) || w.Body.Len() != 0 {
		t.Fatal("an ordinary error was answered as a Drive reason")
	}
}
