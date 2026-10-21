package classroom

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
)

type fakeDoer struct{}

func (fakeDoer) GoogleDo(_ context.Context, _ uuid.UUID, _ []string, send func(string) (*http.Response, error)) (*http.Response, error) {
	return send("tok")
}

type memStore struct{ links map[string]Link }

func (m *memStore) key(u uuid.UUID, c string) string { return u.String() + "/" + c }
func (m *memStore) GetLink(_ context.Context, u uuid.UUID, c string) (*Link, error) {
	if l, ok := m.links[m.key(u, c)]; ok {
		l.Seen = slices.Clone(l.Seen)
		return &l, nil
	}
	return nil, ErrNotLinked
}
func (m *memStore) ListLinks(_ context.Context, u uuid.UUID) ([]Link, error) {
	var out []Link
	for _, l := range m.links {
		if l.UserID == u {
			out = append(out, l)
		}
	}
	return out, nil
}
func (m *memStore) SaveLink(_ context.Context, l Link) error {
	m.links[m.key(l.UserID, l.CourseID)] = l
	return nil
}
func (m *memStore) ListLinkedUsers(context.Context) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for _, l := range m.links {
		if !slices.Contains(out, l.UserID) {
			out = append(out, l.UserID)
		}
	}
	return out, nil
}

type fakeKB struct {
	created []string
	uploads []string
	links   []string
}

func (k *fakeKB) OwnsKB(context.Context, uuid.UUID, uuid.UUID) error { return nil }
func (k *fakeKB) CreateKB(_ context.Context, _ uuid.UUID, name string) (uuid.UUID, error) {
	k.created = append(k.created, name)
	return uuid.New(), nil
}
func (k *fakeKB) Upload(_ context.Context, _, _ uuid.UUID, name string, data []byte) (uuid.UUID, error) {
	k.uploads = append(k.uploads, name+"|"+string(data))
	return uuid.New(), nil
}
func (k *fakeKB) AddLink(_ context.Context, _, _ uuid.UUID, u string) error {
	k.links = append(k.links, u)
	return nil
}

const materialsPage1 = `{"courseWorkMaterial":[{"id":"m1","title":"Week 3 reading","description":"Read before Thursday.","alternateLink":"https://classroom.google.com/c/x/m/m1","materials":[
 {"driveFile":{"driveFile":{"id":"1PDF","title":"week3.pdf","alternateLink":"https://drive.google.com/file/d/1PDF"},"shareMode":"VIEW"}},
 {"youtubeVideo":{"id":"dQw4w9WgXcQ","title":"Lecture","alternateLink":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}},
 {"notebook":{"id":"nb1","title":"RAG notebook","url":"https://notebooklm.google.com/notebook/nb1"}}
]}],"nextPageToken":"p2"}`

const materialsPage2 = `{"courseWorkMaterial":[{"id":"m2","title":"Extra","materials":[
 {"link":{"url":"https://example.edu/rag","title":"RAG explained"}},
 {"gem":{"id":"g1","title":"Tutor gem","url":"https://gemini.google.com/gem/g1"}}
]}]}`

const courseWork = `{"courseWork":[{"id":"w1","title":"Quiz 3","description":"","materials":[
 {"form":{"formUrl":"https://docs.google.com/forms/d/e/abc/viewform","title":"Quiz 3 form"}},
 {"driveFile":{"driveFile":{"id":"1PDF","title":"week3.pdf"}}}
]}]}`

const announcements = `{"announcements":[{"id":"a1","text":"Exam moved to Friday.\nRoom 204.","alternateLink":"https://classroom.google.com/c/x/p/a1"}]}`

func server(t *testing.T, blocked *bool) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if *blocked {
			w.WriteHeader(http.StatusForbidden)
			_, _ = io.WriteString(w, `{"error":{"code":403,"message":"The caller does not have permission","status":"PERMISSION_DENIED"}}`)
			return
		}
		switch r.URL.Path {
		case "/courses":
			if r.URL.Query().Get("courseStates") != "ACTIVE" {
				t.Errorf("only active classes: %s", r.URL.RawQuery)
			}
			_, _ = io.WriteString(w, `{"courses":[{"id":"c1","name":"Biology 10A","section":"Period 2","alternateLink":"https://classroom.google.com/c/c1"}]}`)
		case "/courses/c1/courseWorkMaterials":
			if r.URL.Query().Get("pageToken") == "p2" {
				_, _ = io.WriteString(w, materialsPage2)
			} else {
				_, _ = io.WriteString(w, materialsPage1)
			}
		case "/courses/c1/courseWork":
			_, _ = io.WriteString(w, courseWork)
		case "/courses/c1/announcements":
			_, _ = io.WriteString(w, announcements)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	}))
}

func TestClassroom(t *testing.T) {
	blocked := false
	srv := server(t, &blocked)
	defer srv.Close()
	store, kb := &memStore{links: map[string]Link{}}, &fakeKB{}
	svc := NewService(fakeDoer{}, store, kb)
	svc.SetBaseURL(srv.URL)
	ctx := context.Background()
	user := uuid.New()

	courses, err := svc.Courses(ctx, user)
	if err != nil || len(courses) != 1 || courses[0].Name != "Biology 10A" || courses[0].KBID != nil {
		t.Fatalf("courses: %+v %v", courses, err)
	}

	items, err := svc.Items(ctx, user, "c1")
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, it := range items {
		kinds[it.Kind]++
	}
	// Two pages of materials, an assignment and a post; the PDF attached
	// twice is listed once; an assignment with no text has no post.
	want := map[string]int{KindDrive: 1, KindYouTube: 1, KindNotebook: 1, KindLink: 1, KindGem: 1, KindForm: 1, KindPost: 2}
	for k, n := range want {
		if kinds[k] != n {
			t.Fatalf("%s: %d, want %d (%v)", k, kinds[k], n, kinds)
		}
	}

	if _, err := svc.Import(ctx, user, "c1", []string{"youtube:dQw4w9WgXcQ"}); !errors.Is(err, ErrNotLinked) {
		t.Fatalf("import before linking: %v", err)
	}
	if _, err := svc.LinkCourse(ctx, user, "c1", "Biology 10A", nil); err != nil || kb.created[0] != "Biology 10A" {
		t.Fatalf("link: %v %v", err, kb.created)
	}
	var keys []string
	for _, it := range items {
		keys = append(keys, it.Key)
	}
	rep, err := svc.Import(ctx, user, "c1", keys)
	if err != nil || rep.Imported != 7 || !slices.Equal(rep.DriveFiles, []string{"1PDF"}) {
		t.Fatalf("import: %+v %v", rep, err)
	}
	if !slices.Contains(kb.links, "https://www.youtube.com/watch?v=dQw4w9WgXcQ") || !slices.Contains(kb.links, "https://example.edu/rag") {
		t.Fatalf("links: %v", kb.links)
	}
	joined := strings.Join(kb.uploads, "\n")
	for _, want := range []string{"NotebookLM: RAG notebook.md|# NotebookLM: RAG notebook", "<https://notebooklm.google.com/notebook/nb1>", "Exam moved to Friday.", "Google Form: Quiz 3 form.md"} {
		if !strings.Contains(joined, want) {
			t.Errorf("uploads miss %q", want)
		}
	}

	// The Drive file is new until the Picker confirmation is recorded.
	items, _ = svc.Items(ctx, user, "c1")
	for _, it := range items {
		if it.Imported != (it.Kind != KindDrive) {
			t.Fatalf("%s imported=%v", it.Key, it.Imported)
		}
	}
	if err := svc.MarkSeen(ctx, user, "c1", []string{"1PDF"}); err != nil {
		t.Fatal(err)
	}
	if classes, failed := svc.Check(ctx); classes != 1 || failed != 0 {
		t.Fatalf("check: %d %d", classes, failed)
	}
	if l, _ := store.GetLink(ctx, user, "c1"); l.NewCount != 0 || l.CheckedAt == nil {
		t.Fatalf("nothing new: %+v", l)
	}
	if c, _ := svc.Courses(ctx, user); c[0].KBID == nil {
		t.Fatal("a linked class shows its knowledge base")
	}

	blocked = true
	if _, err := svc.Courses(ctx, user); !errors.Is(err, ErrSchoolBlocked) {
		t.Fatalf("a school's refusal is named: %v", err)
	}
	if _, err := svc.Items(ctx, user, "../x"); err == nil {
		t.Fatal("a path in a class id is refused")
	}
}
