package notion

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

type doer struct{}

func (doer) Do(_ context.Context, _ uuid.UUID, id string, send func(string) (*http.Response, error)) (*http.Response, error) {
	return send("tok")
}

type mem struct{ links map[string]Link }

func (m *mem) List(_ context.Context, u uuid.UUID) ([]Link, error) {
	var out []Link
	for _, l := range m.links {
		if l.UserID == u {
			out = append(out, l)
		}
	}
	return out, nil
}
func (m *mem) Save(_ context.Context, l Link) error       { m.links[l.PageID] = l; return nil }
func (m *mem) DeleteAll(context.Context, uuid.UUID) error { m.links = map[string]Link{}; return nil }
func (m *mem) Users(context.Context) ([]uuid.UUID, error) { return nil, nil }

type kb struct {
	uploads []string
	deleted []uuid.UUID
}

func (k *kb) OwnsKB(context.Context, uuid.UUID, uuid.UUID) error { return nil }
func (k *kb) Upload(_ context.Context, _, _ uuid.UUID, name string, data []byte) (uuid.UUID, error) {
	k.uploads = append(k.uploads, name+"|"+string(data))
	return uuid.New(), nil
}
func (k *kb) DeleteDocument(_ context.Context, _, _, doc uuid.UUID) error {
	k.deleted = append(k.deleted, doc)
	return nil
}

const pageID = "11111111-2222-3333-4444-555555555555"

func TestBlocksToMarkdown(t *testing.T) {
	var blocks []Block
	_ = json.Unmarshal([]byte(`[
	 {"id":"1","type":"heading_1","heading_1":{"rich_text":[{"plain_text":"Cells"}]}},
	 {"id":"2","type":"paragraph","paragraph":{"rich_text":[{"plain_text":"The "},{"plain_text":"nucleus","annotations":{"bold":true}},{"plain_text":" holds DNA.","href":""}]}},
	 {"id":"3","type":"numbered_list_item","numbered_list_item":{"rich_text":[{"plain_text":"one"}]}},
	 {"id":"4","type":"numbered_list_item","numbered_list_item":{"rich_text":[{"plain_text":"two"}]}},
	 {"id":"5","type":"to_do","to_do":{"rich_text":[{"plain_text":"revise"}],"checked":true}},
	 {"id":"6","type":"code","code":{"rich_text":[{"plain_text":"print(1)"}],"language":"python"}},
	 {"id":"7","type":"unsupported","unsupported":{}}
	]`), &blocks)
	md := BlocksToMarkdown(blocks)
	for _, want := range []string{"## Cells", "The **nucleus** holds DNA.", "1. one\n2. two", "- [x] revise", "```python\nprint(1)\n```"} {
		if !strings.Contains(md, want) {
			t.Errorf("missing %q in\n%s", want, md)
		}
	}
	back := MarkdownToBlocks("# Title\n\n- a\n1. b\n- [ ] c\n> d\n```go\nx\n```\nplain")
	kinds := []string{}
	for _, b := range back {
		kinds = append(kinds, b["type"].(string))
	}
	if strings.Join(kinds, ",") != "heading_1,bulleted_list_item,numbered_list_item,to_do,quote,code,paragraph" {
		t.Fatalf("%v", kinds)
	}
}

func TestImportSyncAndExport(t *testing.T) {
	edited := "2026-10-20T10:00:00.000Z"
	gone := false
	var created map[string]any
	appended := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Notion-Version") != Version || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("headers on %s", r.URL.Path)
		}
		switch {
		case r.URL.Path == "/search":
			_, _ = io.WriteString(w, `{"results":[
			 {"object":"page","id":"`+pageID+`","url":"https://notion.so/p","last_edited_time":"`+edited+`","parent":{"type":"workspace"},"properties":{"Name":{"type":"title","title":[{"plain_text":"Biology"}]}}},
			 {"object":"page","id":"row1","parent":{"type":"database_id"},"properties":{}}]}`)
		case r.URL.Path == "/pages/"+pageID && r.Method == http.MethodGet:
			if gone {
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.WriteString(w, `{"code":"object_not_found","message":"Could not find page"}`)
				return
			}
			_, _ = io.WriteString(w, `{"object":"page","id":"`+pageID+`","url":"https://notion.so/p","last_edited_time":"`+edited+`","properties":{"Name":{"type":"title","title":[{"plain_text":"Biology"}]}}}`)
		case r.URL.Path == "/blocks/"+pageID+"/children":
			_, _ = io.WriteString(w, `{"results":[{"id":"b1","type":"paragraph","paragraph":{"rich_text":[{"plain_text":"Edited `+edited+`"}]}}],"has_more":false}`)
		case r.URL.Path == "/pages" && r.Method == http.MethodPost:
			_ = json.NewDecoder(r.Body).Decode(&created)
			_, _ = io.WriteString(w, `{"id":"newpage","url":"https://notion.so/newpage"}`)
		case r.URL.Path == "/blocks/newpage/children" && r.Method == http.MethodPatch:
			appended++
			_, _ = io.WriteString(w, `{}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()
	store, k := &mem{links: map[string]Link{}}, &kb{}
	svc := NewService(doer{}, store, k)
	svc.SetBaseURL(srv.URL)
	svc.now = func() time.Time { return time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC) }
	ctx, user, base := context.Background(), uuid.New(), uuid.New()

	items, err := svc.Search(ctx, user, "")
	if err != nil || len(items) != 1 || items[0].Title != "Biology" {
		t.Fatalf("a database row is not listed on its own: %+v %v", items, err)
	}
	rep, err := svc.Import(ctx, user, base, []string{pageID})
	if err != nil || rep.Imported != 1 || !strings.HasPrefix(k.uploads[0], "Biology.md|# Biology\n\nhttps://notion.so/p") {
		t.Fatalf("%+v %v %v", rep, err, k.uploads)
	}
	if n, _ := svc.Sync(ctx, user); n != 0 {
		t.Fatal("nothing changed")
	}
	edited = "2026-10-21T08:00:00.000Z"
	if n, _ := svc.Sync(ctx, user); n != 1 || len(k.uploads) != 2 || len(k.deleted) != 1 {
		t.Fatalf("a change is imported again and the old copy deleted: %d %d", len(k.uploads), len(k.deleted))
	}
	gone = true
	_, _ = svc.Sync(ctx, user)
	if !store.links[pageID].Gone {
		t.Fatal("an unshared page is marked gone")
	}

	md := strings.Repeat("- item\n", 230)
	out, err := svc.Export(ctx, user, "", "Week 3", md)
	if err != nil || out.URL != "https://notion.so/newpage" || appended != 2 {
		t.Fatalf("%+v %v appended=%d", out, err, appended)
	}
	if created["parent"].(map[string]any)["page_id"] != pageID || len(created["children"].([]any)) != 100 {
		t.Fatalf("the first 100 blocks under the shared page: %v", created["parent"])
	}
}

func TestExportWithNothingShared(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"results":[]}`)
	}))
	defer srv.Close()
	svc := NewService(doer{}, &mem{links: map[string]Link{}}, &kb{})
	svc.SetBaseURL(srv.URL)
	if _, err := svc.Export(context.Background(), uuid.New(), "", "x", "y"); !errors.Is(err, ErrNoParent) {
		t.Fatalf("%v", err)
	}
}
