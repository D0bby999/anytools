// Package gphotos picks photos from Google Photos (learning-tool-connections
// phase 7): photos of notes, a whiteboard, a textbook page, read as page
// photos like an upload.
//
// The Library API reads only what an app created since March 2025; the
// Picker API is how a learner hands over their own photos. Its scope,
// photospicker.mediaitems.readonly, reaches only the items picked in one
// session. A session is made here, the learner picks in Google's own page
// (pickerUri), the page polls until Google says the set is ready, and the
// photos are downloaded and the session deleted.
package gphotos

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
)

// BaseURL is the Photos Picker API.
const BaseURL = "https://photospicker.googleapis.com/v1"

// MaxPhotos bounds one import.
const MaxPhotos = 30

// ErrNotReady reports a session the learner has not finished picking in.
var ErrNotReady = errors.New("gphotos: nothing has been picked yet")

// Service runs picker sessions.
type Service struct {
	google  googleapi.Doer
	baseURL string
	HTTP    *http.Client
	// mediaOK says whether a baseUrl may be fetched with the learner's
	// token: Google's own media hosts only.
	mediaOK func(u *url.URL) bool
}

// NewService returns a Service.
func NewService(google googleapi.Doer) *Service {
	return &Service{google: google, baseURL: BaseURL, mediaOK: func(u *url.URL) bool {
		return u.Scheme == "https" && strings.HasSuffix(u.Hostname(), ".googleusercontent.com")
	}}
}

// SetBaseURL points the client at a fake, and lets its media through, for tests.
func (s *Service) SetBaseURL(u string) {
	s.baseURL = u
	s.mediaOK = func(*url.URL) bool { return true }
}

func (s *Service) client(userID uuid.UUID) googleapi.Client {
	return googleapi.Client{Doer: s.google, UserID: userID, Scopes: []string{drive.ScopePhotosPicker}, HTTP: s.HTTP}
}

// Session is a picker session.
type Session struct {
	ID        string `json:"id"`
	PickerURI string `json:"picker_uri"`
	// PollMS is how often to ask whether the learner is done.
	PollMS int  `json:"poll_ms"`
	Ready  bool `json:"ready"`
}

type apiSession struct {
	ID            string `json:"id"`
	PickerURI     string `json:"pickerUri"`
	MediaItemsSet bool   `json:"mediaItemsSet"`
	Polling       struct {
		PollInterval string `json:"pollInterval"`
	} `json:"pollingConfig"`
}

func (a apiSession) session() *Session {
	ms := 3000
	if d := strings.TrimSuffix(a.Polling.PollInterval, "s"); d != "" {
		var secs float64
		if _, err := fmt.Sscanf(d, "%g", &secs); err == nil && secs >= 1 && secs <= 30 {
			ms = int(secs * 1000)
		}
	}
	uri := a.PickerURI
	if uri != "" && !strings.HasSuffix(uri, "/autoclose") {
		// Google's page closes itself when the learner is done.
		uri += "/autoclose"
	}
	return &Session{ID: a.ID, PickerURI: uri, PollMS: ms, Ready: a.MediaItemsSet}
}

// Start creates a session.
func (s *Service) Start(ctx context.Context, userID uuid.UUID) (*Session, error) {
	var a apiSession
	if err := s.client(userID).JSON(ctx, http.MethodPost, s.baseURL+"/sessions", map[string]any{}, &a); err != nil {
		return nil, err
	}
	return a.session(), nil
}

func validSession(id string) bool {
	return id != "" && len(id) < 200 && !strings.ContainsAny(id, "/?#%")
}

// Poll reports whether the learner has finished picking.
func (s *Service) Poll(ctx context.Context, userID uuid.UUID, sessionID string) (*Session, error) {
	if !validSession(sessionID) {
		return nil, errors.New("gphotos: not a session id")
	}
	var a apiSession
	if err := s.client(userID).JSON(ctx, http.MethodGet, s.baseURL+"/sessions/"+url.PathEscape(sessionID), nil, &a); err != nil {
		return nil, err
	}
	return a.session(), nil
}

// Photo is one downloaded photo.
type Photo struct {
	Name string
	Data []byte
}

// Take downloads the picked photos (videos are skipped) and deletes the
// session.
func (s *Service) Take(ctx context.Context, userID uuid.UUID, sessionID string, maxBytes int64) ([]Photo, error) {
	sess, err := s.Poll(ctx, userID, sessionID)
	if err != nil {
		return nil, err
	}
	if !sess.Ready {
		return nil, ErrNotReady
	}
	c := s.client(userID)
	defer func() {
		_ = c.JSON(context.WithoutCancel(ctx), http.MethodDelete, s.baseURL+"/sessions/"+url.PathEscape(sessionID), nil, nil)
	}()

	var photos []Photo
	token := ""
	for page := 0; page < 10 && len(photos) < MaxPhotos; page++ {
		q := url.Values{"sessionId": {sessionID}, "pageSize": {"50"}}
		if token != "" {
			q.Set("pageToken", token)
		}
		var list struct {
			Items []struct {
				Type      string `json:"type"`
				MediaFile struct {
					BaseURL  string `json:"baseUrl"`
					MimeType string `json:"mimeType"`
					Filename string `json:"filename"`
				} `json:"mediaFile"`
			} `json:"mediaItems"`
			Next string `json:"nextPageToken"`
		}
		if err := c.JSON(ctx, http.MethodGet, s.baseURL+"/mediaItems?"+q.Encode(), nil, &list); err != nil {
			return nil, err
		}
		for _, it := range list.Items {
			if it.Type != "PHOTO" || !strings.HasPrefix(it.MediaFile.MimeType, "image/") || len(photos) >= MaxPhotos {
				continue
			}
			base, err := url.Parse(it.MediaFile.BaseURL)
			if err != nil || !s.mediaOK(base) {
				continue
			}
			data, err := c.Raw(ctx, http.MethodGet, it.MediaFile.BaseURL+"=d", nil, "")
			if err != nil {
				return nil, err
			}
			if int64(len(data)) > maxBytes {
				continue
			}
			name := it.MediaFile.Filename
			if name == "" {
				name = fmt.Sprintf("photo-%d.jpg", len(photos)+1)
			}
			photos = append(photos, Photo{Name: name, Data: data})
		}
		if list.Next == "" {
			break
		}
		token = list.Next
	}
	return photos, nil
}
