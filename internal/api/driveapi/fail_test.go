package driveapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/drive"
)

// A refusal from the learner's own storage Drive answers with its reason's
// code, so the page can say why (drive-user-storage phase 5); the
// connector's own refusals keep theirs.
func TestFailAnswersAStorageRefusalWithItsCode(t *testing.T) {
	h := &Handler{}
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{fmt.Errorf("%w: %w", blob.ErrReconnect, drive.ErrNeedsReconnect), http.StatusConflict, "drive_reconnect"},
		{fmt.Errorf("keeping it: %w", blob.ErrRemoteFull), http.StatusInsufficientStorage, "drive_full"},
		{drive.ErrNeedsReconnect, http.StatusConflict, "needs_reconnect"},
		{errors.New("something of ours"), http.StatusInternalServerError, "internal"},
	} {
		w := httptest.NewRecorder()
		h.fail(w, httptest.NewRequest(http.MethodPost, "/v1/drive/import", nil), tc.err)
		var body struct {
			Code string `json:"code"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != tc.status || body.Code != tc.code {
			t.Errorf("%v: answered %d %q, want %d %q", tc.err, w.Code, body.Code, tc.status, tc.code)
		}
	}
}
