package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/runtime"
)

// ErrSessionNotFound is returned when no session matches (id, user).
var ErrSessionNotFound = errors.New("chat session not found")

// ChatStore is the pgx implementation of chat session and message persistence.
//
// EVERY query in this file filters on user_id, including the ones that also
// filter on a session id the caller just verified. That is deliberate
// redundancy: the verification is one refactor away from being moved, reordered
// or cached, and a query that does not name the owner is a query that will
// eventually run without one.
type ChatStore struct {
	pool *Pool
}

// NewChatStore builds a ChatStore over the shared pool.
func NewChatStore(pool *Pool) *ChatStore { return &ChatStore{pool: pool} }

const sessionColumns = `id, user_id, title, kb_ids, model_hint, allow_web,
	learning_state_id, created_at, updated_at`

// CreateSession inserts a session.
func (s *ChatStore) CreateSession(ctx context.Context, sess runtime.Session) (*runtime.Session, error) {
	kbIDs := sess.KBIDs
	if kbIDs == nil {
		kbIDs = []uuid.UUID{}
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO chat_sessions (user_id, title, kb_ids, model_hint, allow_web, learning_state_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+sessionColumns,
		sess.UserID, sess.Title, kbIDs, sess.ModelHint, sess.AllowWeb, sess.LearningStateID)
	return scanSession(row)
}

// GetSession reads one session scoped to its owner.
func (s *ChatStore) GetSession(ctx context.Context, userID, sessionID uuid.UUID) (*runtime.Session, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+sessionColumns+` FROM chat_sessions WHERE id = $1 AND user_id = $2`,
		sessionID, userID)
	return scanSession(row)
}

// ListSessions returns a user's sessions, most recently updated first.
func (s *ChatStore) ListSessions(ctx context.Context, userID uuid.UUID, limit int) ([]runtime.Session, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+sessionColumns+`
		   FROM chat_sessions WHERE user_id = $1
		  ORDER BY updated_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list chat sessions: %w", err)
	}
	defer rows.Close()

	out := []runtime.Session{}
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sess)
	}
	return out, rows.Err()
}

// SessionPatch carries the fields a rename/retarget may change. A nil field is
// "leave it alone", which is what lets the API expose one PATCH rather than one
// endpoint per column.
type SessionPatch struct {
	Title     *string
	KBIDs     *[]uuid.UUID
	ModelHint *string
	AllowWeb  *bool
}

// UpdateSession applies a patch.
func (s *ChatStore) UpdateSession(
	ctx context.Context, userID, sessionID uuid.UUID, patch SessionPatch,
) (*runtime.Session, error) {
	var kbIDs any
	if patch.KBIDs != nil {
		ids := *patch.KBIDs
		if ids == nil {
			ids = []uuid.UUID{}
		}
		kbIDs = ids
	}

	row := s.pool.QueryRow(ctx, `
		UPDATE chat_sessions
		   SET title = COALESCE($3, title),
		       kb_ids = COALESCE($4::uuid[], kb_ids),
		       model_hint = COALESCE($5, model_hint),
		       allow_web = COALESCE($6, allow_web),
		       updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+sessionColumns,
		sessionID, userID, patch.Title, kbIDs, patch.ModelHint, patch.AllowWeb)
	return scanSession(row)
}

// TouchSession bumps updated_at so a session with new activity sorts first.
func (s *ChatStore) TouchSession(ctx context.Context, userID, sessionID uuid.UUID) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE chat_sessions SET updated_at = now() WHERE id = $1 AND user_id = $2`,
		sessionID, userID)
	if err != nil {
		return fmt.Errorf("touch chat session: %w", err)
	}
	return nil
}

// DeleteSession removes a session and, by cascade, its messages, turns and
// turn events.
func (s *ChatStore) DeleteSession(ctx context.Context, userID, sessionID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`, sessionID, userID)
	if err != nil {
		return fmt.Errorf("delete chat session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrSessionNotFound
	}
	return nil
}

const messageColumns = `id, user_id, session_id, role, content, capability, attachments, created_at`

// AppendMessage writes one transcript message.
func (s *ChatStore) AppendMessage(ctx context.Context, m runtime.ChatMessage) (*runtime.ChatMessage, error) {
	attachments := m.Attachments
	if len(attachments) == 0 {
		attachments = []byte("[]")
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO chat_messages (user_id, session_id, role, content, capability, attachments)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb)
		RETURNING `+messageColumns,
		m.UserID, m.SessionID, m.Role, m.Content, m.Capability, attachments)
	return scanMessage(row)
}

// GetMessage reads one transcript message scoped to its owner.
func (s *ChatStore) GetMessage(ctx context.Context, userID, messageID uuid.UUID) (*runtime.ChatMessage, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+messageColumns+` FROM chat_messages WHERE id = $1 AND user_id = $2`,
		messageID, userID)
	return scanMessage(row)
}

// ReplaceDiagram swaps a "Draw it" message's content and attachments for its
// one repair (internal/capabilities/visualize). The WHERE clause is the
// once-only rule: a message whose diagram is already marked repaired is not
// touched, so two repair requests racing each other change it once.
func (s *ChatStore) ReplaceDiagram(
	ctx context.Context, userID, messageID uuid.UUID, content string, attachments []byte,
) (bool, error) {
	// Merged, not replaced: the answer may carry a retell (SetRetell) that a
	// repair must not wipe. Legacy rows hold the default array, which merges
	// as an empty object.
	tag, err := s.pool.Exec(ctx, `
		UPDATE chat_messages
		   SET content = $3,
		       attachments = CASE WHEN jsonb_typeof(attachments) = 'object' THEN attachments ELSE '{}'::jsonb END
		                     || $4::jsonb
		 WHERE id = $1 AND user_id = $2 AND capability = 'visualize'
		   AND COALESCE((attachments->'diagram'->>'repaired')::boolean, false) = false`,
		messageID, userID, content, attachments)
	if err != nil {
		return false, fmt.Errorf("replace diagram: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// ErrNoOwnVersion is a retell on an answer whose question carried no
// own-version lines.
var ErrNoOwnVersion = errors.New("this answer's question carried no own version")

// SetRetell stores the learner's "close it and retell" on an answer
// (up-methods phase 11), replacing an earlier one.
//
// The answer must be the caller's, an assistant message, and its exchange —
// the user messages since the previous answer in the session — must include
// one carrying own_version. The exchange and not only the newest user
// message, because an ask_user reply is stored as a user message too. It
// returns ErrNoOwnVersion when the answer exists but does not qualify; the
// caller has already resolved the answer with GetMessage.
func (s *ChatStore) SetRetell(ctx context.Context, userID, messageID uuid.UUID, retell []byte) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE chat_messages a
		   SET attachments = jsonb_set(
		         CASE WHEN jsonb_typeof(a.attachments) = 'object' THEN a.attachments ELSE '{}'::jsonb END,
		         '{retell}', $3::jsonb)
		 WHERE a.id = $1 AND a.user_id = $2 AND a.role = 'assistant'
		   AND EXISTS (
		       SELECT 1 FROM chat_messages q
		        WHERE q.session_id = a.session_id AND q.user_id = $2 AND q.role = 'user'
		          AND (q.created_at, q.id) < (a.created_at, a.id)
		          AND jsonb_typeof(q.attachments) = 'object' AND q.attachments ? 'own_version'
		          AND NOT EXISTS (
		              SELECT 1 FROM chat_messages p
		               WHERE p.session_id = a.session_id AND p.user_id = $2 AND p.role = 'assistant'
		                 AND (p.created_at, p.id) > (q.created_at, q.id)
		                 AND (p.created_at, p.id) < (a.created_at, a.id)))`,
		messageID, userID, retell)
	if err != nil {
		return fmt.Errorf("set retell: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNoOwnVersion
	}
	return nil
}

// History returns a session's messages oldest-first.
//
// The cap is applied to the NEWEST messages and the result is re-ordered, so a
// long conversation drops its oldest turns rather than its most recent ones —
// the opposite would hand the model a transcript that ends before the question
// it is answering.
func (s *ChatStore) History(
	ctx context.Context, userID, sessionID uuid.UUID, limit int,
) ([]runtime.ChatMessage, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+messageColumns+` FROM (
			SELECT `+messageColumns+`
			  FROM chat_messages
			 WHERE session_id = $1 AND user_id = $2
			 ORDER BY created_at DESC, id DESC
			 LIMIT $3
		) recent
		ORDER BY created_at, id`, sessionID, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("load chat history: %w", err)
	}
	defer rows.Close()

	out := []runtime.ChatMessage{}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// ListTurns returns a session's turns, newest first. The UI uses it to show a
// turn that failed while nobody was watching.
func (s *ChatStore) ListTurns(
	ctx context.Context, userID, sessionID uuid.UUID, limit int,
) ([]runtime.Turn, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+turnColumns+`
		  FROM turns WHERE session_id = $1 AND user_id = $2
		 ORDER BY created_at DESC LIMIT $3`, sessionID, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list turns: %w", err)
	}
	defer rows.Close()

	out := []runtime.Turn{}
	for rows.Next() {
		t, err := scanTurn(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func scanSession(row rowScanner) (*runtime.Session, error) {
	var s runtime.Session
	err := row.Scan(&s.ID, &s.UserID, &s.Title, &s.KBIDs, &s.ModelHint, &s.AllowWeb,
		&s.LearningStateID, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan chat session: %w", err)
	}
	return &s, nil
}

func scanMessage(row rowScanner) (*runtime.ChatMessage, error) {
	var m runtime.ChatMessage
	err := row.Scan(&m.ID, &m.UserID, &m.SessionID, &m.Role, &m.Content,
		&m.Capability, &m.Attachments, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan chat message: %w", err)
	}
	return &m, nil
}
