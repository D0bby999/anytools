package sourceapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/D0bby999/anytools/internal/blob"
)

// A site or repository refused by the learner's own storage Drive answers
// with its reason's code, as every upload does (drive-user-storage phase 5).
func TestFailAnswersAStorageRefusalWithItsCode(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{blob.ErrReconnect, http.StatusConflict, "drive_reconnect"},
		{blob.ErrRemoteFull, http.StatusInsufficientStorage, "drive_full"},
		{errors.New("something of ours"), http.StatusInternalServerError, "internal"},
	} {
		w := httptest.NewRecorder()
		fail(w, httptest.NewRequest(http.MethodPost, "/v1/sources/sites", nil), tc.err)
		var body struct {
			Code string `json:"code"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != tc.status || body.Code != tc.code {
			t.Errorf("%v: answered %d %q, want %d %q", tc.err, w.Code, body.Code, tc.status, tc.code)
		}
	}
}
