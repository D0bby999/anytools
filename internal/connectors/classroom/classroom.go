// Package classroom brings a Google Classroom class into AnyLearn
// (learning-tool-connections phase 6): each class a knowledge base of its
// own, its materials, assignments and announcements listed, and the ones the
// learner ticks imported through the paths AnyLearn already has.
//
// What each kind of material becomes:
//
//   - a link or a YouTube video: a link document (knowledge.AddLink);
//   - a post's or an assignment's own text: a Markdown document;
//   - a Drive file: nothing here. The drive.file scope does not reach a file
//     just because it is in a class, so its id goes back to the page, which
//     opens the Google Picker on exactly those files (setFileIds); the
//     learner confirms once and the existing Drive import takes them;
//   - a Google Form, a NotebookLM notebook, a Gemini Gem: a short document
//     with its link. A form's questions are its owner's (a student cannot
//     read them through the API); a notebook and a Gem open in their apps.
//
// The class is read with four read-only scopes. A school account whose
// administrator has not allowed AnyLearn is refused by Google; that refusal
// is named (ErrSchoolBlocked) so the page can say who can fix it.
package classroom

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/googleapi"
)

// BaseURL is the Classroom API.
const BaseURL = "https://classroom.googleapis.com/v1"

// Scopes are what reading a class needs.
var Scopes = []string{drive.ScopeClassroomCourses, drive.ScopeClassroomMaterials, drive.ScopeClassroomCourseWork, drive.ScopeClassroomNotices}

// Item kinds.
const (
	KindDrive    = "drive"
	KindYouTube  = "youtube"
	KindLink     = "link"
	KindForm     = "form"
	KindNotebook = "notebook"
	KindGem      = "gem"
	KindPost     = "post"
)

// ErrSchoolBlocked reports a school account whose administrator has not
// allowed AnyLearn (or Classroom access for third-party apps).
var ErrSchoolBlocked = errors.New("classroom: this school's Google administrator has not allowed AnyLearn")

// ErrNotLinked reports a class not yet brought into AnyLearn.
var ErrNotLinked = errors.New("classroom: this class is not linked to a knowledge base")

// Course is a class.
type Course struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Section string     `json:"section,omitempty"`
	Link    string     `json:"link,omitempty"`
	KBID    *uuid.UUID `json:"kb_id,omitempty"`
	New     int        `json:"new"`
}

// Item is one thing in a class that can be imported.
type Item struct {
	Key   string `json:"key"`
	Kind  string `json:"kind"`
	Title string `json:"title"`
	URL   string `json:"url,omitempty"`
	// FileID is a Drive file's id (KindDrive).
	FileID string `json:"file_id,omitempty"`
	// Text is a post's or an assignment's body (KindPost).
	Text string `json:"-"`
	// From names what it is attached to: the material, assignment or
	// announcement's title.
	From     string `json:"from"`
	Imported bool   `json:"imported"`
	Updated  string `json:"updated,omitempty"`
}

// Link is a class brought into AnyLearn.
type Link struct {
	UserID     uuid.UUID
	CourseID   string
	CourseName string
	KBID       uuid.UUID
	Seen       []string
	NewCount   int
	CheckedAt  *time.Time
	LastError  string
}

// Store persists links.
type Store interface {
	GetLink(ctx context.Context, userID uuid.UUID, courseID string) (*Link, error)
	ListLinks(ctx context.Context, userID uuid.UUID) ([]Link, error)
	SaveLink(ctx context.Context, l Link) error
	ListLinkedUsers(ctx context.Context) ([]uuid.UUID, error)
}

// Knowledge is the Knowledge Center as imports use it.
type Knowledge interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error
	CreateKB(ctx context.Context, userID uuid.UUID, name string) (uuid.UUID, error)
	Upload(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) (uuid.UUID, error)
	AddLink(ctx context.Context, userID, kbID uuid.UUID, rawURL string) error
}

// Service reads classes and imports their materials.
type Service struct {
	google  googleapi.Doer
	store   Store
	kb      Knowledge
	baseURL string
	now     func() time.Time
	HTTP    *http.Client
}

// NewService returns a Service.
func NewService(google googleapi.Doer, store Store, kb Knowledge) *Service {
	return &Service{google: google, store: store, kb: kb, baseURL: BaseURL, now: time.Now}
}

// SetBaseURL and SetClock are for tests.
func (s *Service) SetBaseURL(u string)           { s.baseURL = u }
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// pages fetches every page of a list.
func (s *Service) pages(ctx context.Context, userID uuid.UUID, path string, q url.Values, each func(raw []byte) (next string, err error)) error {
	c := googleapi.Client{Doer: s.google, UserID: userID, Scopes: Scopes, HTTP: s.HTTP}
	for page := 0; page < 20; page++ {
		u := s.baseURL + path + "?" + q.Encode()
		data, err := c.Raw(ctx, http.MethodGet, u, nil, "")
		var gerr *googleapi.Error
		if errors.As(err, &gerr) && gerr.Status == http.StatusForbidden && !googleapi.Disabled(err) {
			return fmt.Errorf("%w: %s", ErrSchoolBlocked, gerr.Message)
		}
		if err != nil {
			return err
		}
		next, err := each(data)
		if err != nil || next == "" {
			return err
		}
		q.Set("pageToken", next)
	}
	return nil
}

// Courses lists the learner's active classes, each with its knowledge base
// when it has one.
func (s *Service) Courses(ctx context.Context, userID uuid.UUID) ([]Course, error) {
	var out []Course
	q := url.Values{"courseStates": {"ACTIVE"}, "pageSize": {"100"}}
	err := s.pages(ctx, userID, "/courses", q, func(raw []byte) (string, error) {
		var page struct {
			Courses []struct {
				ID            string `json:"id"`
				Name          string `json:"name"`
				Section       string `json:"section"`
				AlternateLink string `json:"alternateLink"`
			} `json:"courses"`
			Next string `json:"nextPageToken"`
		}
		if err := jsonUnmarshal(raw, &page); err != nil {
			return "", err
		}
		for _, c := range page.Courses {
			out = append(out, Course{ID: c.ID, Name: c.Name, Section: c.Section, Link: c.AlternateLink})
		}
		return page.Next, nil
	})
	if err != nil {
		return nil, err
	}
	links, err := s.store.ListLinks(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range out {
		for _, l := range links {
			if l.CourseID == out[i].ID {
				kb := l.KBID
				out[i].KBID, out[i].New = &kb, l.NewCount
			}
		}
	}
	return out, nil
}

// material is the Classroom Material union.
type material struct {
	DriveFile *struct {
		DriveFile struct {
			ID            string `json:"id"`
			Title         string `json:"title"`
			AlternateLink string `json:"alternateLink"`
		} `json:"driveFile"`
	} `json:"driveFile,omitempty"`
	YouTubeVideo *struct {
		ID            string `json:"id"`
		Title         string `json:"title"`
		AlternateLink string `json:"alternateLink"`
	} `json:"youtubeVideo,omitempty"`
	Link *struct {
		URL   string `json:"url"`
		Title string `json:"title"`
	} `json:"link,omitempty"`
	Form *struct {
		FormURL string `json:"formUrl"`
		Title   string `json:"title"`
	} `json:"form,omitempty"`
	Gem *struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		URL   string `json:"url"`
	} `json:"gem,omitempty"`
	Notebook *struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		URL   string `json:"url"`
	} `json:"notebook,omitempty"`
}

func (m material) item(from string) (Item, bool) {
	switch {
	case m.DriveFile != nil && m.DriveFile.DriveFile.ID != "":
		f := m.DriveFile.DriveFile
		return Item{Key: "drive:" + f.ID, Kind: KindDrive, Title: f.Title, URL: f.AlternateLink, FileID: f.ID, From: from}, true
	case m.YouTubeVideo != nil && m.YouTubeVideo.ID != "":
		v := m.YouTubeVideo
		link := v.AlternateLink
		if link == "" {
			link = "https://www.youtube.com/watch?v=" + url.QueryEscape(v.ID)
		}
		return Item{Key: "youtube:" + v.ID, Kind: KindYouTube, Title: v.Title, URL: link, From: from}, true
	case m.Link != nil && m.Link.URL != "":
		return Item{Key: "link:" + m.Link.URL, Kind: KindLink, Title: m.Link.Title, URL: m.Link.URL, From: from}, true
	case m.Form != nil && m.Form.FormURL != "":
		return Item{Key: "form:" + m.Form.FormURL, Kind: KindForm, Title: m.Form.Title, URL: m.Form.FormURL, From: from}, true
	case m.Notebook != nil && m.Notebook.URL != "":
		return Item{Key: "notebook:" + m.Notebook.ID, Kind: KindNotebook, Title: m.Notebook.Title, URL: m.Notebook.URL, From: from}, true
	case m.Gem != nil && m.Gem.URL != "":
		return Item{Key: "gem:" + m.Gem.ID, Kind: KindGem, Title: m.Gem.Title, URL: m.Gem.URL, From: from}, true
	}
	return Item{}, false
}

// post is a material, an assignment or an announcement.
type post struct {
	ID            string     `json:"id"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	Text          string     `json:"text"`
	AlternateLink string     `json:"alternateLink"`
	UpdateTime    string     `json:"updateTime"`
	Materials     []material `json:"materials"`
}

// Items lists everything importable in a class, newest first, each marked
// when it was imported before.
func (s *Service) Items(ctx context.Context, userID uuid.UUID, courseID string) ([]Item, error) {
	if courseID == "" || strings.ContainsAny(courseID, "/?#") {
		return nil, errors.New("classroom: that is not a class id")
	}
	base := "/courses/" + url.PathEscape(courseID)
	var items []Item
	for _, list := range []struct{ path, field string }{
		{base + "/courseWorkMaterials", "courseWorkMaterial"},
		{base + "/courseWork", "courseWork"},
		{base + "/announcements", "announcements"},
	} {
		q := url.Values{"pageSize": {"100"}}
		err := s.pages(ctx, userID, list.path, q, func(raw []byte) (string, error) {
			var page map[string]jsonRaw
			if err := jsonUnmarshal(raw, &page); err != nil {
				return "", err
			}
			var posts []post
			if body, ok := page[list.field]; ok {
				if err := jsonUnmarshal(body, &posts); err != nil {
					return "", err
				}
			}
			for _, p := range posts {
				items = append(items, p.items()...)
			}
			var next string
			if n, ok := page["nextPageToken"]; ok {
				_ = jsonUnmarshal(n, &next)
			}
			return next, nil
		})
		if err != nil {
			return nil, err
		}
	}
	items = dedupe(items)
	link, err := s.store.GetLink(ctx, userID, courseID)
	if err == nil {
		for i := range items {
			items[i].Imported = slices.Contains(link.Seen, items[i].Key)
		}
	} else if !errors.Is(err, ErrNotLinked) {
		return nil, err
	}
	return items, nil
}

func (p post) items() []Item {
	from := strings.TrimSpace(p.Title)
	body := strings.TrimSpace(p.Description)
	if body == "" {
		body = strings.TrimSpace(p.Text)
	}
	if from == "" {
		from = firstLine(body, 80)
	}
	var out []Item
	if body != "" {
		sum := sha256.Sum256([]byte(body))
		out = append(out, Item{Key: "post:" + p.ID + ":" + hex.EncodeToString(sum[:6]), Kind: KindPost, Title: from,
			URL: p.AlternateLink, Text: body, From: from, Updated: p.UpdateTime})
	}
	for _, m := range p.Materials {
		if it, ok := m.item(from); ok {
			it.Updated = p.UpdateTime
			out = append(out, it)
		}
	}
	return out
}

func dedupe(items []Item) []Item {
	seen := map[string]bool{}
	out := items[:0]
	for _, it := range items {
		if !seen[it.Key] {
			seen[it.Key] = true
			out = append(out, it)
		}
	}
	return out
}

func firstLine(s string, n int) string {
	line, _, _ := strings.Cut(strings.TrimSpace(s), "\n")
	if r := []rune(line); len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return line
}

// LinkCourse gives a class its knowledge base: the one named, or a new one
// named after the class.
func (s *Service) LinkCourse(ctx context.Context, userID uuid.UUID, courseID, courseName string, kbID *uuid.UUID) (*Link, error) {
	if l, err := s.store.GetLink(ctx, userID, courseID); err == nil {
		if kbID != nil && *kbID != l.KBID {
			if err := s.kb.OwnsKB(ctx, userID, *kbID); err != nil {
				return nil, err
			}
			l.KBID = *kbID
			return l, s.store.SaveLink(ctx, *l)
		}
		return l, nil
	} else if !errors.Is(err, ErrNotLinked) {
		return nil, err
	}
	var target uuid.UUID
	if kbID != nil {
		if err := s.kb.OwnsKB(ctx, userID, *kbID); err != nil {
			return nil, err
		}
		target = *kbID
	} else {
		name := strings.TrimSpace(courseName)
		if name == "" {
			name = "Google Classroom"
		}
		id, err := s.kb.CreateKB(ctx, userID, name)
		if err != nil {
			return nil, err
		}
		target = id
	}
	l := Link{UserID: userID, CourseID: courseID, CourseName: courseName, KBID: target, Seen: []string{}}
	return &l, s.store.SaveLink(ctx, l)
}

// ImportReport says what an import did. DriveFiles are the files the page
// must offer in the Picker.
type ImportReport struct {
	KBID       uuid.UUID `json:"kb_id"`
	Imported   int       `json:"imported"`
	Failed     int       `json:"failed"`
	DriveFiles []string  `json:"drive_files"`
}

// Import brings the chosen items of a linked class into its knowledge base.
func (s *Service) Import(ctx context.Context, userID uuid.UUID, courseID string, keys []string) (*ImportReport, error) {
	l, err := s.store.GetLink(ctx, userID, courseID)
	if err != nil {
		return nil, err
	}
	items, err := s.Items(ctx, userID, courseID)
	if err != nil {
		return nil, err
	}
	rep := &ImportReport{KBID: l.KBID, DriveFiles: []string{}}
	for _, it := range items {
		if !slices.Contains(keys, it.Key) {
			continue
		}
		var err error
		switch it.Kind {
		case KindDrive:
			rep.DriveFiles = append(rep.DriveFiles, it.FileID)
		case KindLink, KindYouTube:
			err = s.kb.AddLink(ctx, userID, l.KBID, it.URL)
		case KindPost:
			_, err = s.kb.Upload(ctx, userID, l.KBID, safeName(it.Title)+".md", []byte(postMarkdown(it, l.CourseName)))
		default: // form, notebook, gem
			_, err = s.kb.Upload(ctx, userID, l.KBID, safeName(kindLabel(it.Kind)+": "+it.Title)+".md", []byte(linkMarkdown(it, l.CourseName)))
		}
		if err != nil {
			rep.Failed++
			continue
		}
		// A Drive file counts as imported only once the learner has
		// confirmed it in the Picker and the Drive import took it (MarkSeen).
		if it.Kind == KindDrive {
			continue
		}
		rep.Imported++
		if !slices.Contains(l.Seen, it.Key) {
			l.Seen = append(l.Seen, it.Key)
		}
	}
	l.NewCount = countNew(items, l.Seen)
	now := s.now()
	l.CheckedAt = &now
	return rep, s.store.SaveLink(ctx, *l)
}

// MarkSeen records Drive files of a class as imported, after the Picker
// confirmation and the Drive import.
func (s *Service) MarkSeen(ctx context.Context, userID uuid.UUID, courseID string, fileIDs []string) error {
	l, err := s.store.GetLink(ctx, userID, courseID)
	if err != nil {
		return err
	}
	for _, id := range fileIDs {
		if key := "drive:" + id; !slices.Contains(l.Seen, key) {
			l.Seen = append(l.Seen, key)
		}
	}
	if l.NewCount -= len(fileIDs); l.NewCount < 0 {
		l.NewCount = 0
	}
	return s.store.SaveLink(ctx, *l)
}

func countNew(items []Item, seen []string) int {
	n := 0
	for _, it := range items {
		if !slices.Contains(seen, it.Key) {
			n++
		}
	}
	return n
}

// Check counts what is new in every linked class of every learner; nothing
// is imported without the learner choosing it.
func (s *Service) Check(ctx context.Context) (classes, failed int) {
	users, err := s.store.ListLinkedUsers(ctx)
	if err != nil {
		return 0, 0
	}
	for _, u := range users {
		links, err := s.store.ListLinks(ctx, u)
		if err != nil {
			continue
		}
		for _, l := range links {
			if ctx.Err() != nil {
				return classes, failed
			}
			classes++
			items, err := s.Items(ctx, u, l.CourseID)
			now := s.now()
			l.CheckedAt = &now
			if err != nil {
				failed++
				l.LastError = err.Error()
			} else {
				l.LastError = ""
				l.NewCount = countNew(items, l.Seen)
			}
			_ = s.store.SaveLink(ctx, l)
		}
	}
	return classes, failed
}

func kindLabel(kind string) string {
	switch kind {
	case KindForm:
		return "Google Form"
	case KindNotebook:
		return "NotebookLM"
	case KindGem:
		return "Gemini Gem"
	}
	return kind
}

func postMarkdown(it Item, course string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", it.Title)
	if course != "" {
		fmt.Fprintf(&b, "Google Classroom: %s  \n", course)
	}
	if it.URL != "" {
		fmt.Fprintf(&b, "<%s>\n", it.URL)
	}
	b.WriteString("\n" + it.Text + "\n")
	return b.String()
}

func linkMarkdown(it Item, course string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s: %s\n\n", kindLabel(it.Kind), it.Title)
	if course != "" {
		fmt.Fprintf(&b, "Google Classroom: %s  \n", course)
	}
	if it.From != "" && it.From != it.Title {
		fmt.Fprintf(&b, "%s  \n", it.From)
	}
	fmt.Fprintf(&b, "\n<%s>\n", it.URL)
	return b.String()
}

func safeName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 120 {
		s = string(r[:120])
	}
	if s == "" {
		s = "Classroom"
	}
	return s
}
