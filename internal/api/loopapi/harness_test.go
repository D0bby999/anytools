package loopapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/loopapi"
	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

const testGatewayToken = "loopapi-test-token"

// harness is the real mux, the real middleware and the real store over the
// test database, with two users. Every test here is about HTTP behaviour —
// status codes and who can see what — so nothing below the handler is faked.
type harness struct {
	pool       *pgxpool.Pool
	server     *httptest.Server
	alice, bob uuid.UUID
}

func newHarness(t *testing.T) *harness { return newHarnessAt(t, nil) }

// newHarnessAt is the harness on a clock the test controls (nil for the wall
// clock), with the learners' real time zones: the card retest rule reads both.
func newHarnessAt(t *testing.T, now func() time.Time) *harness {
	t.Helper()
	pool := testutil.TestDB(t)
	h := &harness{pool: pool, alice: testutil.NewUser(t, pool), bob: testutil.NewUser(t, pool)}
	svc := loop.NewService(pg.NewLoopStore(pool), pg.NewChatStore(pool), now).WithZones(pg.NewUserStore(pool))
	h.server = httptest.NewServer(api.BuildMux(api.Deps{
		Loop:         loopapi.NewHandler(svc),
		Users:        stubUsers{live: map[uuid.UUID]bool{h.alice: true, h.bob: true}},
		GatewayToken: testGatewayToken,
	}))
	t.Cleanup(h.server.Close)
	return h
}

func (h *harness) do(t *testing.T, user uuid.UUID, method, path string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, h.server.URL+path, reader)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testGatewayToken)
	req.Header.Set("X-AnyTools-User-Id", user.String())
	req.Header.Set("Content-Type", "application/json")
	res, err := h.server.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

// json issues a request and decodes the answer, failing on an unexpected status.
func (h *harness) json(t *testing.T, user uuid.UUID, method, path string, body any, want int) map[string]any {
	t.Helper()
	res := h.do(t, user, method, path, body)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != want {
		t.Fatalf("%s %s: status %d, want %d (%s)", method, path, res.StatusCode, want, raw)
	}
	out := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("decode %s: %v", raw, err)
		}
	}
	return out
}

func (h *harness) status(t *testing.T, user uuid.UUID, method, path string, body any) int {
	t.Helper()
	res := h.do(t, user, method, path, body)
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode
}

// seedAttempt inserts a question and an attempt for user and returns the
// attempt id: something the product recorded, for evidence to point at.
func (h *harness) seedAttempt(t *testing.T, user uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var kb, q, a uuid.UUID
	if err := h.pool.QueryRow(ctx, `INSERT INTO knowledge_bases (user_id, name) VALUES ($1, 'k') RETURNING id`, user).Scan(&kb); err != nil {
		t.Fatal(err)
	}
	if err := h.pool.QueryRow(ctx, `INSERT INTO questions (user_id, kb_id, prompt, type, answer)
		VALUES ($1, $2, 'p', 'short', 'a') RETURNING id`, user, kb).Scan(&q); err != nil {
		t.Fatal(err)
	}
	if err := h.pool.QueryRow(ctx, `INSERT INTO question_attempts (user_id, question_id, is_correct, rating)
		VALUES ($1, $2, true, 'good') RETURNING id`, user, q).Scan(&a); err != nil {
		t.Fatal(err)
	}
	return a
}

type stubUsers struct{ live map[uuid.UUID]bool }

func (s stubUsers) UserExists(_ context.Context, id uuid.UUID) (bool, error) { return s.live[id], nil }

func (s stubUsers) GetUser(_ context.Context, id uuid.UUID) (*store.User, error) {
	if !s.live[id] {
		return nil, store.ErrUserNotFound
	}
	return &store.User{ID: id, Email: id.String() + "@example.test", DisplayName: "Stub"}, nil
}

func (s stubUsers) UpsertIdentity(_ context.Context, c store.IdentityClaims, _ uuid.UUID) (*store.User, error) {
	return &store.User{Email: c.Email, DisplayName: c.DisplayName}, nil
}
