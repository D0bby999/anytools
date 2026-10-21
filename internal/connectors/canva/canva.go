// Package canva connects AnyLearn and Canva (learning-tool-connections
// phase 8), both ways, through the Canva Connect REST API:
//
//   - a Canva design (slides, an infographic, a poster) exported as a PDF
//     into a knowledge base, where it is read like any upload;
//   - an AnyLearn export (study notes, a worksheet, a book, a notebook)
//     imported into Canva as a Canva Doc the learner turns into slides or a
//     poster there; it opens in a new tab.
//
// Exports and imports are jobs: started, then polled until they finish.
package canva

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/appconn"
)

// Canva's endpoints and the scopes AnyLearn asks for.
const (
	BaseURL   = "https://api.canva.com/rest/v1"
	AuthURL   = "https://www.canva.com/api/oauth/authorize"
	TokenURL  = "https://api.canva.com/rest/v1/oauth/token"
	RevokeURL = "https://api.canva.com/rest/v1/oauth/revoke"
)

// Scopes: list and read designs, export them, create designs by import, and
// name the account.
var Scopes = []string{"design:meta:read", "design:content:read", "design:content:write", "profile:read"}

// Errors a caller can name.
var (
	ErrJobFailed  = errors.New("canva: Canva could not finish the job")
	ErrJobTimeout = errors.New("canva: Canva is taking too long; try again")
	ErrTooLarge   = errors.New("canva: the exported file is too large")
)

// MaxExportBytes bounds a downloaded export.
const MaxExportBytes = 50 << 20

// Doer sends a request with the learner's Canva token (appconn.Service).
type Doer interface {
	Do(ctx context.Context, userID uuid.UUID, id string, send func(tok string) (*http.Response, error)) (*http.Response, error)
}

// Service is the Canva bridge.
type Service struct {
	conn     Doer
	baseURL  string
	HTTP     *http.Client
	Download *http.Client
	poll     time.Duration
	deadline time.Duration
	// plainHTTP lets a test's fake serve exports over http.
	plainHTTP bool
}

// NewService returns a Service. download fetches export files from Canva's
// download host; it must refuse private addresses.
func NewService(conn Doer, download *http.Client) *Service {
	return &Service{conn: conn, baseURL: BaseURL, HTTP: &http.Client{Timeout: 60 * time.Second}, Download: download,
		poll: time.Second, deadline: 2 * time.Minute}
}

// SetBaseURL points the client at a fake and polls fast, for tests.
func (s *Service) SetBaseURL(u string) { s.baseURL, s.poll, s.plainHTTP = u, 10*time.Millisecond, true }

// Provider is Canva's OAuth for appconn.
func Provider(clientID, secret string) appconn.Provider {
	return appconn.Provider{
		ID: "canva", AuthURL: AuthURL, TokenURL: TokenURL, RevokeURL: RevokeURL,
		ClientID: clientID, ClientSecret: secret, Scopes: Scopes, PKCE: true,
		Label: func(ctx context.Context, _ map[string]any, access string) string {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, BaseURL+"/users/me/profile", nil)
			if err != nil {
				return ""
			}
			req.Header.Set("Authorization", "Bearer "+access)
			resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
			if err != nil {
				return ""
			}
			defer resp.Body.Close()
			var p struct {
				Profile struct {
					DisplayName string `json:"display_name"`
				} `json:"profile"`
			}
			_ = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&p)
			return p.Profile.DisplayName
		},
	}
}

// APIError is a Canva refusal.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("canva: %d %s: %s", e.Status, e.Code, e.Message)
}

func (s *Service) call(ctx context.Context, userID uuid.UUID, method, path string, body []byte, header http.Header, out any) error {
	resp, err := s.conn.Do(ctx, userID, "canva", func(tok string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, method, s.baseURL+path, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		for k, v := range header {
			req.Header[k] = v
		}
		return s.HTTP.Do(req)
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		var e struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &e)
		return &APIError{Status: resp.StatusCode, Code: e.Code, Message: e.Message}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(data, out)
}

func jsonHeader() http.Header { return http.Header{"Content-Type": {"application/json"}} }

// Design is one of the learner's designs.
type Design struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Thumbnail string `json:"thumbnail,omitempty"`
	EditURL   string `json:"edit_url,omitempty"`
	UpdatedAt int64  `json:"updated_at,omitempty"`
}

// Designs lists the learner's designs, newest first, optionally searched.
func (s *Service) Designs(ctx context.Context, userID uuid.UUID, query, continuation string) ([]Design, string, error) {
	q := url.Values{"sort_by": {"modified_descending"}}
	if query = strings.TrimSpace(query); query != "" {
		q.Set("query", query)
	}
	if continuation != "" {
		q.Set("continuation", continuation)
	}
	var page struct {
		Items []struct {
			ID        string `json:"id"`
			Title     string `json:"title"`
			UpdatedAt int64  `json:"updated_at"`
			Thumbnail struct {
				URL string `json:"url"`
			} `json:"thumbnail"`
			URLs struct {
				EditURL string `json:"edit_url"`
			} `json:"urls"`
		} `json:"items"`
		Continuation string `json:"continuation"`
	}
	if err := s.call(ctx, userID, http.MethodGet, "/designs?"+q.Encode(), nil, nil, &page); err != nil {
		return nil, "", err
	}
	out := make([]Design, 0, len(page.Items))
	for _, it := range page.Items {
		out = append(out, Design{ID: it.ID, Title: it.Title, Thumbnail: it.Thumbnail.URL, EditURL: it.URLs.EditURL, UpdatedAt: it.UpdatedAt})
	}
	return out, page.Continuation, nil
}

type job struct {
	ID     string   `json:"id"`
	Status string   `json:"status"`
	URLs   []string `json:"urls"`
	Error  struct {
		Message string `json:"message"`
	} `json:"error"`
	Result struct {
		Designs []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
			URLs  struct {
				EditURL string `json:"edit_url"`
			} `json:"urls"`
		} `json:"designs"`
	} `json:"result"`
}

// wait polls a job until it leaves in_progress.
func (s *Service) wait(ctx context.Context, userID uuid.UUID, path string, j job) (job, error) {
	deadline := time.Now().Add(s.deadline)
	delay := s.poll
	for j.Status == "in_progress" {
		if time.Now().After(deadline) {
			return j, ErrJobTimeout
		}
		select {
		case <-ctx.Done():
			return j, ctx.Err()
		case <-time.After(delay):
		}
		if delay < 5*time.Second {
			delay *= 2
		}
		var got struct {
			Job job `json:"job"`
		}
		if err := s.call(ctx, userID, http.MethodGet, path+"/"+url.PathEscape(j.ID), nil, nil, &got); err != nil {
			return j, err
		}
		j = got.Job
	}
	if j.Status != "success" {
		return j, fmt.Errorf("%w: %s", ErrJobFailed, j.Error.Message)
	}
	return j, nil
}

func validID(id string) bool {
	return id != "" && len(id) < 100 && !strings.ContainsAny(id, "/?#%")
}

// ExportPDF exports a design as a PDF and returns its bytes and title.
func (s *Service) ExportPDF(ctx context.Context, userID uuid.UUID, designID string) ([]byte, string, error) {
	if !validID(designID) {
		return nil, "", errors.New("canva: not a design id")
	}
	var meta struct {
		Design struct {
			Title string `json:"title"`
		} `json:"design"`
	}
	if err := s.call(ctx, userID, http.MethodGet, "/designs/"+url.PathEscape(designID), nil, nil, &meta); err != nil {
		return nil, "", err
	}
	body, _ := json.Marshal(map[string]any{"design_id": designID, "format": map[string]string{"type": "pdf"}})
	var started struct {
		Job job `json:"job"`
	}
	if err := s.call(ctx, userID, http.MethodPost, "/exports", body, jsonHeader(), &started); err != nil {
		return nil, "", err
	}
	j, err := s.wait(ctx, userID, "/exports", started.Job)
	if err != nil {
		return nil, "", err
	}
	if len(j.URLs) == 0 {
		return nil, "", ErrJobFailed
	}
	data, err := s.download(ctx, j.URLs[0])
	return data, meta.Design.Title, err
}

// download fetches an export (a design of several pages comes as the first
// URL holding the whole PDF).
func (s *Service) download(ctx context.Context, raw string) ([]byte, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && !s.plainHTTP) {
		return nil, errors.New("canva: the export link is not https")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.Download.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("canva: the export download answered %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, MaxExportBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxExportBytes {
		return nil, ErrTooLarge
	}
	return data, nil
}

// Opened is a design made from an AnyLearn export.
type Opened struct {
	ID      string `json:"design_id"`
	Title   string `json:"name"`
	EditURL string `json:"url"`
}

// ImportMarkdown makes a Canva Doc from Markdown and returns where to edit it.
func (s *Service) ImportMarkdown(ctx context.Context, userID uuid.UUID, title, markdown string) (*Opened, error) {
	data, err := MarkdownToDOCX(markdown)
	if err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if r := []rune(title); len(r) > 50 {
		title = string(r[:50])
	}
	if title == "" {
		title = "AnyLearn"
	}
	meta, _ := json.Marshal(map[string]string{
		"title_base64": base64.StdEncoding.EncodeToString([]byte(title)),
		"mime_type":    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	})
	header := http.Header{"Content-Type": {"application/octet-stream"}, "Import-Metadata": {string(meta)}}
	var started struct {
		Job job `json:"job"`
	}
	if err := s.call(ctx, userID, http.MethodPost, "/imports", data, header, &started); err != nil {
		return nil, err
	}
	j, err := s.wait(ctx, userID, "/imports", started.Job)
	if err != nil {
		return nil, err
	}
	if len(j.Result.Designs) == 0 || !strings.HasPrefix(j.Result.Designs[0].URLs.EditURL, "https://") {
		return nil, ErrJobFailed
	}
	d := j.Result.Designs[0]
	return &Opened{ID: d.ID, Title: d.Title, EditURL: d.URLs.EditURL}, nil
}
