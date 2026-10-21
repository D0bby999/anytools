// Package gdocs writes Markdown into the learner's Drive as a Google Doc
// (learning-tool-connections phase 7): "Send to NotebookLM". NotebookLM has
// no API a learner's account can use, but it reads sources from Google
// Drive; a Google Doc in a folder of AnyLearn's own is the source it adds.
//
// Drive converts the Markdown itself (an upload with the Doc mime type), and
// drive.file covers both the folder and the doc, since AnyLearn creates them.
package gdocs

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
)

// FolderName is the Drive folder the docs go into.
const FolderName = "AnyLearn for NotebookLM"

// Service writes Google Docs.
type Service struct {
	google     googleapi.Doer
	driveBase  string
	uploadBase string
	HTTP       *http.Client
}

// NewService returns a Service.
func NewService(google googleapi.Doer) *Service {
	return &Service{google: google, driveBase: drive.DefaultDriveBaseURL, uploadBase: drive.DefaultUploadURL}
}

// SetBaseURLs points the client at a fake, for tests.
func (s *Service) SetBaseURLs(driveBase, uploadBase string) {
	s.driveBase, s.uploadBase = driveBase, uploadBase
}

// Doc is a written Google Doc.
type Doc struct {
	ID   string `json:"file_id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

func (s *Service) client(userID uuid.UUID) googleapi.Client {
	return googleapi.Client{Doer: s.google, UserID: userID, Scopes: []string{drive.ScopeDriveFile}, HTTP: s.HTTP}
}

// folder finds AnyLearn's folder, or creates it. Under drive.file the query
// sees only files AnyLearn created, which is exactly the folder it wants.
func (s *Service) folder(ctx context.Context, userID uuid.UUID) (string, error) {
	c := s.client(userID)
	q := url.Values{
		"q":      {fmt.Sprintf("name = '%s' and mimeType = '%s' and trashed = false", FolderName, drive.MimeGoogleFolder)},
		"fields": {"files(id)"},
		"spaces": {"drive"},
	}
	var found struct {
		Files []struct {
			ID string `json:"id"`
		} `json:"files"`
	}
	if err := c.JSON(ctx, http.MethodGet, s.driveBase+"/files?"+q.Encode(), nil, &found); err != nil {
		return "", err
	}
	if len(found.Files) > 0 {
		return found.Files[0].ID, nil
	}
	var created struct {
		ID string `json:"id"`
	}
	err := c.JSON(ctx, http.MethodPost, s.driveBase+"/files?fields=id",
		map[string]any{"name": FolderName, "mimeType": drive.MimeGoogleFolder}, &created)
	return created.ID, err
}

// Create writes markdown as a Google Doc named name.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, name, markdown string) (*Doc, error) {
	folder, err := s.folder(ctx, userID)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSuffix(strings.TrimSpace(name), ".md")
	if name == "" {
		name = "AnyLearn"
	}
	meta, _ := json.Marshal(map[string]any{"name": name, "mimeType": drive.MimeGoogleDoc, "parents": []string{folder}})

	b := make([]byte, 12)
	_, _ = rand.Read(b)
	boundary := "anylearn-" + hex.EncodeToString(b)
	var body bytes.Buffer
	fmt.Fprintf(&body, "--%s\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n%s\r\n", boundary, meta)
	fmt.Fprintf(&body, "--%s\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n%s\r\n--%s--\r\n", boundary, markdown, boundary)

	data, err := s.client(userID).Raw(ctx, http.MethodPost, s.uploadBase+"/files?uploadType=multipart&fields=id,name",
		body.Bytes(), "multipart/related; boundary="+boundary)
	if err != nil {
		return nil, err
	}
	var created struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(data, &created); err != nil || created.ID == "" {
		return nil, fmt.Errorf("gdocs: Drive did not return the new doc: %w", err)
	}
	return &Doc{ID: created.ID, Name: created.Name, URL: "https://docs.google.com/document/d/" + created.ID + "/edit"}, nil
}
