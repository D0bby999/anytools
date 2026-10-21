// Package notion connects AnyLearn and Notion (learning-tool-connections
// phase 9), both ways:
//
//   - pages and databases the learner shared with AnyLearn (Notion's own
//     page picker, at consent) become documents in a knowledge base, and are
//     imported again when they change in Notion;
//   - study notes, a worksheet, a book or a notebook becomes a Notion page
//     under a page the learner shared.
//
// AnyLearn sees only what the learner shared; a page they stop sharing
// answers 404, which marks it gone and keeps the document.
package notion

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/appconn"
)

// Notion's endpoints.
const (
	BaseURL   = "https://api.notion.com/v1"
	Version   = "2022-06-28"
	AuthURL   = "https://api.notion.com/v1/oauth/authorize"
	TokenURL  = "https://api.notion.com/v1/oauth/token"
	RevokeURL = "https://api.notion.com/v1/oauth/revoke"
)

// Limits.
const (
	MaxBlocks    = 3000
	MaxDepth     = 4
	MaxRows      = 1000
	SyncInterval = time.Hour
)

// ErrNoParent reports an export with no shared page to put it under.
var ErrNoParent = errors.New("notion: share a page with AnyLearn in Notion to put exports under it")

// Provider is Notion's OAuth for appconn.
func Provider(clientID, secret string) appconn.Provider {
	return appconn.Provider{
		ID: "notion", AuthURL: AuthURL, TokenURL: TokenURL, RevokeURL: RevokeURL,
		ClientID: clientID, ClientSecret: secret, JSONBody: true,
		AuthParams: url.Values{"owner": {"user"}},
		Label: func(_ context.Context, tok map[string]any, _ string) string {
			name, _ := tok["workspace_name"].(string)
			return name
		},
	}
}

// Doer sends a request with the learner's Notion token (appconn.Service).
type Doer interface {
	Do(ctx context.Context, userID uuid.UUID, id string, send func(tok string) (*http.Response, error)) (*http.Response, error)
}

// Link is a Notion page or database imported into a knowledge base.
type Link struct {
	UserID     uuid.UUID
	PageID     string
	Kind       string // page | database
	Title      string
	KBID       uuid.UUID
	DocumentID *uuid.UUID
	LastEdited string
	SyncedAt   *time.Time
	Gone       bool
	LastError  string
}

// Store persists links.
type Store interface {
	List(ctx context.Context, userID uuid.UUID) ([]Link, error)
	Save(ctx context.Context, l Link) error
	DeleteAll(ctx context.Context, userID uuid.UUID) error
	Users(ctx context.Context) ([]uuid.UUID, error)
}

// Knowledge files documents.
type Knowledge interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error
	Upload(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) (uuid.UUID, error)
	DeleteDocument(ctx context.Context, userID, kbID, docID uuid.UUID) error
}

// Service is the Notion bridge.
type Service struct {
	conn    Doer
	store   Store
	kb      Knowledge
	baseURL string
	HTTP    *http.Client
	now     func() time.Time
	gap     time.Duration

	mu   sync.Mutex
	last time.Time
}

// NewService returns a Service.
func NewService(conn Doer, store Store, kb Knowledge) *Service {
	return &Service{conn: conn, store: store, kb: kb, baseURL: BaseURL, HTTP: &http.Client{Timeout: 60 * time.Second},
		now: time.Now, gap: 350 * time.Millisecond}
}

// SetBaseURL points the client at a fake with no pacing, for tests.
func (s *Service) SetBaseURL(u string) { s.baseURL, s.gap = u, 0 }

// APIError is a Notion refusal.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("notion: %d %s: %s", e.Status, e.Code, e.Message)
}

// pace keeps this process under Notion's average of three requests a second.
func (s *Service) pace() {
	if s.gap == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if wait := s.gap - time.Since(s.last); wait > 0 {
		time.Sleep(wait)
	}
	s.last = time.Now()
}

func (s *Service) call(ctx context.Context, userID uuid.UUID, method, path string, in, out any) error {
	var body []byte
	if in != nil {
		body, _ = json.Marshal(in)
	}
	for attempt := 0; ; attempt++ {
		s.pace()
		resp, err := s.conn.Do(ctx, userID, "notion", func(tok string) (*http.Response, error) {
			req, err := http.NewRequestWithContext(ctx, method, s.baseURL+path, bytes.NewReader(body))
			if err != nil {
				return nil, err
			}
			req.Header.Set("Authorization", "Bearer "+tok)
			req.Header.Set("Notion-Version", Version)
			if in != nil {
				req.Header.Set("Content-Type", "application/json")
			}
			return s.HTTP.Do(req)
		})
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if err != nil {
			return err
		}
		if resp.StatusCode == http.StatusTooManyRequests && attempt == 0 {
			wait, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(min(max(wait, 1), 10)) * time.Second):
			}
			continue
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
}

// Item is a shared page or database.
type Item struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	LastEdited string `json:"last_edited"`
	Imported   bool   `json:"imported"`
}

type object struct {
	Object         string                     `json:"object"`
	ID             string                     `json:"id"`
	URL            string                     `json:"url"`
	LastEditedTime string                     `json:"last_edited_time"`
	Title          []RichText                 `json:"title"`
	Properties     map[string]json.RawMessage `json:"properties"`
	Parent         struct {
		Type string `json:"type"`
	} `json:"parent"`
	Archived bool `json:"archived"`
	InTrash  bool `json:"in_trash"`
}

// title is a page's or a database's title.
func (o object) title() string {
	if o.Object == "database" {
		return plain(o.Title)
	}
	for _, raw := range o.Properties {
		var p struct {
			Type  string     `json:"type"`
			Title []RichText `json:"title"`
		}
		if json.Unmarshal(raw, &p) == nil && p.Type == "title" {
			return plain(p.Title)
		}
	}
	return ""
}

// Search lists what the learner shared, optionally matching query.
func (s *Service) Search(ctx context.Context, userID uuid.UUID, query string) ([]Item, error) {
	body := map[string]any{"page_size": 100, "sort": map[string]string{"direction": "descending", "timestamp": "last_edited_time"}}
	if q := strings.TrimSpace(query); q != "" {
		body["query"] = q
	}
	var res struct {
		Results []object `json:"results"`
	}
	if err := s.call(ctx, userID, http.MethodPost, "/search", body, &res); err != nil {
		return nil, err
	}
	links, err := s.store.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	imported := map[string]bool{}
	for _, l := range links {
		imported[l.PageID] = !l.Gone
	}
	out := []Item{}
	for _, o := range res.Results {
		if o.Archived || o.InTrash || o.Parent.Type == "database_id" {
			// Rows of a database come with the database.
			continue
		}
		t := o.title()
		if t == "" {
			t = "Untitled"
		}
		out = append(out, Item{ID: o.ID, Kind: o.Object, Title: t, URL: o.URL, LastEdited: o.LastEditedTime, Imported: imported[o.ID]})
	}
	return out, nil
}

func validID(id string) bool {
	return id != "" && len(id) <= 64 && !strings.ContainsAny(id, "/?#%")
}

// children reads a block tree, depth-first, bounded.
func (s *Service) children(ctx context.Context, userID uuid.UUID, id string, depth int, budget *int) ([]Block, error) {
	var out []Block
	cursor := ""
	for {
		q := url.Values{"page_size": {"100"}}
		if cursor != "" {
			q.Set("start_cursor", cursor)
		}
		var page struct {
			Results    []Block `json:"results"`
			HasMore    bool    `json:"has_more"`
			NextCursor string  `json:"next_cursor"`
		}
		if err := s.call(ctx, userID, http.MethodGet, "/blocks/"+url.PathEscape(id)+"/children?"+q.Encode(), nil, &page); err != nil {
			return nil, err
		}
		for _, b := range page.Results {
			if *budget <= 0 {
				return out, nil
			}
			*budget--
			if b.HasChildren && depth < MaxDepth && b.Type != "child_page" && b.Type != "child_database" {
				kids, err := s.children(ctx, userID, b.ID, depth+1, budget)
				if err != nil {
					return nil, err
				}
				b.Children = kids
			}
			out = append(out, b)
		}
		if !page.HasMore || page.NextCursor == "" {
			return out, nil
		}
		cursor = page.NextCursor
	}
}

// propertyText is one database cell as text.
func propertyText(raw json.RawMessage) string {
	var p struct {
		Type        string                       `json:"type"`
		Title       []RichText                   `json:"title"`
		RichText    []RichText                   `json:"rich_text"`
		Number      *float64                     `json:"number"`
		Select      *struct{ Name string }       `json:"select"`
		Status      *struct{ Name string }       `json:"status"`
		MultiSelect []struct{ Name string }      `json:"multi_select"`
		Date        *struct{ Start, End string } `json:"date"`
		Checkbox    bool                         `json:"checkbox"`
		URL         string                       `json:"url"`
		Email       string                       `json:"email"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return ""
	}
	switch p.Type {
	case "title":
		return plain(p.Title)
	case "rich_text":
		return plain(p.RichText)
	case "number":
		if p.Number != nil {
			return strconv.FormatFloat(*p.Number, 'f', -1, 64)
		}
	case "select":
		if p.Select != nil {
			return p.Select.Name
		}
	case "status":
		if p.Status != nil {
			return p.Status.Name
		}
	case "multi_select":
		names := make([]string, len(p.MultiSelect))
		for i, m := range p.MultiSelect {
			names[i] = m.Name
		}
		return strings.Join(names, ", ")
	case "date":
		if p.Date != nil {
			return strings.TrimSuffix(p.Date.Start+" – "+p.Date.End, " – ")
		}
	case "checkbox":
		if p.Checkbox {
			return "✓"
		}
	case "url":
		return p.URL
	case "email":
		return p.Email
	}
	return ""
}

// databaseMarkdown is a database as a Markdown table, its title column first.
func (s *Service) databaseMarkdown(ctx context.Context, userID uuid.UUID, id string) (string, error) {
	var cols []string
	var rows [][]string
	cursor := ""
	for len(rows) < MaxRows {
		body := map[string]any{"page_size": 100}
		if cursor != "" {
			body["start_cursor"] = cursor
		}
		var page struct {
			Results    []object `json:"results"`
			HasMore    bool     `json:"has_more"`
			NextCursor string   `json:"next_cursor"`
		}
		if err := s.call(ctx, userID, http.MethodPost, "/databases/"+url.PathEscape(id)+"/query", body, &page); err != nil {
			return "", err
		}
		for _, r := range page.Results {
			if cols == nil {
				for name, raw := range r.Properties {
					var t struct{ Type string }
					_ = json.Unmarshal(raw, &t)
					if t.Type == "title" {
						cols = append([]string{name}, cols...)
					} else {
						cols = append(cols, name)
					}
				}
				if len(cols) > 1 {
					sort.Strings(cols[1:])
				}
			}
			row := make([]string, len(cols))
			for i, c := range cols {
				row[i] = strings.ReplaceAll(propertyText(r.Properties[c]), "|", "\\|")
			}
			rows = append(rows, row)
		}
		if !page.HasMore || page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	if len(cols) == 0 {
		return "", nil
	}
	var b strings.Builder
	fmt.Fprintf(&b, "| %s |\n|%s\n", strings.Join(cols, " | "), strings.Repeat(" --- |", len(cols)))
	for _, r := range rows {
		fmt.Fprintf(&b, "| %s |\n", strings.Join(r, " | "))
	}
	return b.String(), nil
}

// fetch reads one shared page or database: its meta and its Markdown.
func (s *Service) fetch(ctx context.Context, userID uuid.UUID, id string) (*object, string, error) {
	if !validID(id) {
		return nil, "", errors.New("notion: not a page id")
	}
	var o object
	err := s.call(ctx, userID, http.MethodGet, "/pages/"+url.PathEscape(id), nil, &o)
	var ae *APIError
	if errors.As(err, &ae) && (ae.Status == http.StatusBadRequest || ae.Code == "object_not_found") {
		// Not a page: perhaps a database.
		if derr := s.call(ctx, userID, http.MethodGet, "/databases/"+url.PathEscape(id), nil, &o); derr == nil {
			err = nil
		}
	}
	if err != nil {
		return nil, "", err
	}
	title := o.title()
	if title == "" {
		title = "Untitled"
	}
	var md string
	if o.Object == "database" {
		md, err = s.databaseMarkdown(ctx, userID, id)
	} else {
		budget := MaxBlocks
		var blocks []Block
		blocks, err = s.children(ctx, userID, id, 0, &budget)
		md = BlocksToMarkdown(blocks)
	}
	if err != nil {
		return nil, "", err
	}
	return &o, "# " + title + "\n\n" + o.URL + "\n\n" + md, nil
}

// ImportReport says what an import did.
type ImportReport struct {
	Imported int      `json:"imported"`
	Failed   int      `json:"failed"`
	Errors   []string `json:"errors,omitempty"`
}

// Import brings shared pages or databases into a knowledge base.
func (s *Service) Import(ctx context.Context, userID, kbID uuid.UUID, ids []string) (*ImportReport, error) {
	if err := s.kb.OwnsKB(ctx, userID, kbID); err != nil {
		return nil, err
	}
	links, err := s.store.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	rep := &ImportReport{}
	for _, id := range ids {
		var prev *Link
		for i := range links {
			if links[i].PageID == id {
				prev = &links[i]
			}
		}
		l, err := s.importOne(ctx, userID, kbID, id, prev)
		if err != nil {
			rep.Failed++
			rep.Errors = append(rep.Errors, err.Error())
			continue
		}
		if err := s.store.Save(ctx, *l); err != nil {
			return nil, err
		}
		rep.Imported++
	}
	return rep, nil
}

func (s *Service) importOne(ctx context.Context, userID, kbID uuid.UUID, id string, prev *Link) (*Link, error) {
	o, md, err := s.fetch(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	title := o.title()
	if title == "" {
		title = "Untitled"
	}
	doc, err := s.kb.Upload(ctx, userID, kbID, fileName(title)+".md", []byte(md))
	if err != nil {
		return nil, err
	}
	// A re-import replaces the document it made before.
	if prev != nil && prev.DocumentID != nil {
		if err := s.kb.DeleteDocument(ctx, userID, prev.KBID, *prev.DocumentID); err != nil {
			slog.Warn("notion: the previous copy was not deleted", "user", userID, "error", err)
		}
	}
	now := s.now()
	return &Link{UserID: userID, PageID: id, Kind: o.Object, Title: title, KBID: kbID, DocumentID: &doc,
		LastEdited: o.LastEditedTime, SyncedAt: &now}, nil
}

func fileName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r < 32 {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 120 {
		s = string(r[:120])
	}
	if s == "" {
		s = "Notion"
	}
	return s
}

// Sync imports again every page of one learner that changed in Notion, and
// marks the ones no longer shared.
func (s *Service) Sync(ctx context.Context, userID uuid.UUID) (changed int, err error) {
	links, err := s.store.List(ctx, userID)
	if err != nil {
		return 0, err
	}
	for _, l := range links {
		if l.Gone || ctx.Err() != nil {
			continue
		}
		var o object
		path := "/pages/"
		if l.Kind == "database" {
			path = "/databases/"
		}
		err := s.call(ctx, userID, http.MethodGet, path+url.PathEscape(l.PageID), nil, &o)
		var ae *APIError
		switch {
		case errors.As(err, &ae) && (ae.Status == http.StatusNotFound || ae.Status == http.StatusForbidden):
			l.Gone, l.LastError = true, "no longer shared with AnyLearn"
		case err != nil:
			if errors.Is(err, appconn.ErrNeedsReconnect) || errors.Is(err, appconn.ErrNotConnected) {
				return changed, err
			}
			l.LastError = err.Error()
		case o.Archived || o.InTrash:
			l.Gone, l.LastError = true, "moved to the trash in Notion"
		case o.LastEditedTime != l.LastEdited:
			fresh, err := s.importOne(ctx, userID, l.KBID, l.PageID, &l)
			if err != nil {
				l.LastError = err.Error()
			} else {
				l, changed = *fresh, changed+1
			}
		default:
			now := s.now()
			l.SyncedAt, l.LastError = &now, ""
		}
		if err := s.store.Save(ctx, l); err != nil {
			return changed, err
		}
	}
	return changed, nil
}

// SyncAll runs Sync for every learner with an imported page.
func (s *Service) SyncAll(ctx context.Context) (users, changed int) {
	ids, err := s.store.Users(ctx)
	if err != nil {
		return 0, 0
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			break
		}
		users++
		n, err := s.Sync(ctx, id)
		changed += n
		if err != nil && !errors.Is(err, appconn.ErrNeedsReconnect) {
			slog.Warn("notion: sync failed", "user", id, "error", err)
		}
	}
	return users, changed
}

// Imported lists the learner's imported pages.
func (s *Service) Imported(ctx context.Context, userID uuid.UUID) ([]Link, error) {
	return s.store.List(ctx, userID)
}

// Forget drops the learner's links (their documents stay).
func (s *Service) Forget(ctx context.Context, userID uuid.UUID) error {
	return s.store.DeleteAll(ctx, userID)
}

// Exported is a page AnyLearn wrote.
type Exported struct {
	ID    string `json:"file_id"`
	Title string `json:"name"`
	URL   string `json:"url"`
}

// Parents lists the shared pages an export can go under.
func (s *Service) Parents(ctx context.Context, userID uuid.UUID) ([]Item, error) {
	items, err := s.Search(ctx, userID, "")
	if err != nil {
		return nil, err
	}
	out := items[:0]
	for _, it := range items {
		if it.Kind == "page" {
			out = append(out, it)
		}
	}
	return out, nil
}

// Export writes Markdown as a new page under parentID, or under the most
// recently edited shared page when parentID is empty.
func (s *Service) Export(ctx context.Context, userID uuid.UUID, parentID, title, markdown string) (*Exported, error) {
	if parentID == "" {
		parents, err := s.Parents(ctx, userID)
		if err != nil {
			return nil, err
		}
		if len(parents) == 0 {
			return nil, ErrNoParent
		}
		parentID = parents[0].ID
	}
	if !validID(parentID) {
		return nil, errors.New("notion: not a page id")
	}
	blocks := MarkdownToBlocks(markdown)
	first := blocks[:min(len(blocks), 100)]
	var created struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	err := s.call(ctx, userID, http.MethodPost, "/pages", map[string]any{
		"parent":     map[string]string{"page_id": parentID},
		"properties": map[string]any{"title": map[string]any{"title": textItems(title)}},
		"children":   first,
	}, &created)
	if err != nil {
		return nil, err
	}
	for i := 100; i < len(blocks); i += 100 {
		batch := blocks[i:min(i+100, len(blocks))]
		if err := s.call(ctx, userID, http.MethodPatch, "/blocks/"+url.PathEscape(created.ID)+"/children",
			map[string]any{"children": batch}, nil); err != nil {
			return nil, fmt.Errorf("notion: the page was made but not all of it was written: %w", err)
		}
	}
	return &Exported{ID: created.ID, Title: title, URL: created.URL}, nil
}
