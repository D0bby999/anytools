package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/inbound"
)

// InboundStore is inbound_addresses and inbound_messages
// (learning-tool-connections phase 4).
type InboundStore struct {
	pool   *Pool
	encKey string
}

// NewInboundStore returns an InboundStore.
func NewInboundStore(pool *Pool, encKey string) *InboundStore {
	return &InboundStore{pool: pool, encKey: encKey}
}

const inboundAddressColumns = `user_id, token_enc, kb_id, confirm_code, confirm_link, confirm_at, created_at`

func (s *InboundStore) scanAddress(row pgx.Row) (*inbound.Address, error) {
	var a inbound.Address
	var enc string
	err := row.Scan(&a.UserID, &enc, &a.KBID, &a.ConfirmCode, &a.ConfirmLink, &a.ConfirmAt, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, inbound.ErrNoAddress
	}
	if err != nil {
		return nil, fmt.Errorf("pg: read inbound address: %w", err)
	}
	if a.Token, err = decryptIfPresent(enc, s.encKey, "inbound address"); err != nil {
		return nil, err
	}
	return &a, nil
}

// GetAddress returns the learner's address or inbound.ErrNoAddress.
func (s *InboundStore) GetAddress(ctx context.Context, userID uuid.UUID) (*inbound.Address, error) {
	return s.scanAddress(s.pool.QueryRow(ctx, `SELECT `+inboundAddressColumns+` FROM inbound_addresses WHERE user_id = $1`, userID))
}

// AddressByHash finds the address a delivery names.
func (s *InboundStore) AddressByHash(ctx context.Context, hash []byte) (*inbound.Address, error) {
	return s.scanAddress(s.pool.QueryRow(ctx, `SELECT `+inboundAddressColumns+` FROM inbound_addresses WHERE token_hash = $1`, hash))
}

// SaveAddress creates the address or replaces its token, keeping the target.
func (s *InboundStore) SaveAddress(ctx context.Context, a inbound.Address, hash []byte) error {
	enc, err := encryptOrFail(a.Token, s.encKey, "inbound_addresses.token_enc")
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
        INSERT INTO inbound_addresses (user_id, token_hash, token_enc, kb_id, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) DO UPDATE SET
            token_hash = EXCLUDED.token_hash, token_enc = EXCLUDED.token_enc,
            kb_id = EXCLUDED.kb_id, created_at = EXCLUDED.created_at,
            confirm_code = '', confirm_link = '', confirm_at = NULL`,
		a.UserID, hash, enc, a.KBID, a.CreatedAt)
	if err != nil {
		return fmt.Errorf("pg: save inbound address: %w", err)
	}
	return nil
}

// SetAddressKB sets where messages go.
func (s *InboundStore) SetAddressKB(ctx context.Context, userID, kbID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE inbound_addresses SET kb_id = $2 WHERE user_id = $1`, userID, kbID)
	return err
}

// SaveConfirmation keeps Gmail's forwarding confirmation for the card.
func (s *InboundStore) SaveConfirmation(ctx context.Context, userID uuid.UUID, code, link string, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
        UPDATE inbound_addresses SET confirm_code = $2, confirm_link = $3, confirm_at = $4 WHERE user_id = $1`,
		userID, code, link, at)
	return err
}

func clipText(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// ClaimMessage records a message; false when its id was already received.
func (s *InboundStore) ClaimMessage(ctx context.Context, userID uuid.UUID, messageID string, r inbound.Received) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
        INSERT INTO inbound_messages (user_id, message_id, subject, sender, status, received_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, message_id) DO NOTHING`,
		userID, clipText(messageID, 1000), clipText(r.Subject, 1000), clipText(r.From, 1000), r.Status, r.ReceivedAt)
	if err != nil {
		return false, fmt.Errorf("pg: claim inbound message: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// FinishMessage records what a message became.
func (s *InboundStore) FinishMessage(ctx context.Context, userID uuid.UUID, messageID string, r inbound.Received) error {
	_, err := s.pool.Exec(ctx, `
        UPDATE inbound_messages SET status = $3, documents = $4, skipped = $5, kb_id = $6
         WHERE user_id = $1 AND message_id = $2`,
		userID, clipText(messageID, 1000), r.Status, r.Documents, r.Skipped, r.KBID)
	return err
}

// CountSince counts messages received since a time.
func (s *InboundStore) CountSince(ctx context.Context, userID uuid.UUID, since time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM inbound_messages WHERE user_id = $1 AND received_at > $2`, userID, since).Scan(&n)
	return n, err
}

// Recent lists the newest messages.
func (s *InboundStore) Recent(ctx context.Context, userID uuid.UUID, n int) ([]inbound.Received, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT subject, sender, status, documents, skipped, kb_id, received_at
          FROM inbound_messages WHERE user_id = $1 ORDER BY received_at DESC LIMIT $2`, userID, n)
	if err != nil {
		return nil, fmt.Errorf("pg: list inbound messages: %w", err)
	}
	defer rows.Close()
	out := []inbound.Received{}
	for rows.Next() {
		var r inbound.Received
		if err := rows.Scan(&r.Subject, &r.From, &r.Status, &r.Documents, &r.Skipped, &r.KBID, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Language is the learner's interface language.
func (s *InboundStore) Language(ctx context.Context, userID uuid.UUID) (string, error) {
	var lang string
	err := s.pool.QueryRow(ctx, `SELECT language FROM users WHERE id = $1`, userID).Scan(&lang)
	return lang, err
}
