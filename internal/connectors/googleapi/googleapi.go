// Package googleapi is the one JSON call every Google connector makes
// (learning-tool-connections): Forms, Calendar, Classroom and Photos send
// their requests through the learner's Google grant (drive.Service.GoogleDo)
// and read Google's error envelope the same way.
package googleapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// Doer sends a request with the learner's token; drive.Service is one.
type Doer interface {
	GoogleDo(ctx context.Context, userID uuid.UUID, scopes []string, send func(tok string) (*http.Response, error)) (*http.Response, error)
}

// Error is a Google API refusal.
type Error struct {
	Status int
	// Reason is the first errors[].reason or details[].reason, e.g.
	// "accessNotConfigured", "SERVICE_DISABLED", "notFound".
	Reason  string
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("google: %d %s: %s", e.Status, e.Reason, e.Message)
}

// IsStatus reports a Google refusal with this HTTP status.
func IsStatus(err error, status int) bool {
	var e *Error
	return errors.As(err, &e) && e.Status == status
}

// Disabled reports the API being off in the project (the owner has to enable
// it in the Google Cloud console).
func Disabled(err error) bool {
	var e *Error
	return errors.As(err, &e) && (e.Reason == "accessNotConfigured" || e.Reason == "SERVICE_DISABLED")
}

// Client calls one Google API as one learner.
type Client struct {
	Doer   Doer
	UserID uuid.UUID
	Scopes []string
	HTTP   *http.Client
}

var defaultHTTP = &http.Client{Timeout: 60 * time.Second}

// MaxResponse bounds what one call reads.
const MaxResponse = 32 << 20

// JSON sends in (when not nil) as JSON and decodes the answer into out (when
// not nil).
func (c Client) JSON(ctx context.Context, method, url string, in, out any) error {
	var body []byte
	if in != nil {
		var err error
		if body, err = json.Marshal(in); err != nil {
			return err
		}
	}
	data, err := c.Raw(ctx, method, url, body, "application/json")
	if err != nil {
		return err
	}
	if out == nil || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

// Raw sends a body of any type and returns the answer's bytes.
func (c Client) Raw(ctx context.Context, method, url string, body []byte, contentType string) ([]byte, error) {
	hc := c.HTTP
	if hc == nil {
		hc = defaultHTTP
	}
	resp, err := c.Doer.GoogleDo(ctx, c.UserID, c.Scopes, func(tok string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", contentType)
		}
		return hc.Do(req)
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponse))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode/100 != 2 {
		return nil, parseError(resp.StatusCode, data)
	}
	return data, nil
}

func parseError(status int, data []byte) error {
	var env struct {
		Error struct {
			Message string `json:"message"`
			Status  string `json:"status"`
			Errors  []struct {
				Reason string `json:"reason"`
			} `json:"errors"`
			Details []struct {
				Reason string `json:"reason"`
			} `json:"details"`
		} `json:"error"`
	}
	_ = json.Unmarshal(data, &env)
	e := &Error{Status: status, Message: env.Error.Message, Reason: env.Error.Status}
	for _, d := range env.Error.Details {
		if d.Reason != "" {
			e.Reason = d.Reason
		}
	}
	if len(env.Error.Errors) > 0 && env.Error.Errors[0].Reason != "" {
		e.Reason = env.Error.Errors[0].Reason
	}
	if e.Message == "" {
		e.Message = http.StatusText(status)
	}
	return e
}
