package inbound

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/rag/parse"
)

// The refusals, each one answer the Worker turns into a bounce or a retry.
var (
	ErrBadSignature   = errors.New("inbound: the delivery is not signed by the mail worker")
	ErrUnknownAddress = errors.New("inbound: no learner has this address")
	ErrTooLarge       = errors.New("inbound: the message is larger than 25 MiB")
	ErrTooMany        = errors.New("inbound: this address has received its messages for today")
	ErrNotConfigured  = errors.New("inbound: email is not configured on this deployment")
	ErrNoAddress      = errors.New("inbound: no address yet")
	ErrUnreadable     = errors.New("inbound: the message could not be read as an email")
)

// Limits.
const (
	MaxMessageBytes = 25 << 20
	DailyLimit      = 50
	// MaxSkew bounds how old a signed delivery may be, against replay.
	MaxSkew = 5 * time.Minute
)

// Address is a learner's inbound address.
type Address struct {
	UserID uuid.UUID  `json:"-"`
	Token  string     `json:"-"`
	Email  string     `json:"email"`
	KBID   *uuid.UUID `json:"kb_id,omitempty"`
	// Gmail's forwarding confirmation, while it is fresh.
	ConfirmCode string     `json:"confirm_code,omitempty"`
	ConfirmLink string     `json:"confirm_link,omitempty"`
	ConfirmAt   *time.Time `json:"confirm_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// Received is one delivered message, for the card's recent list.
type Received struct {
	Subject    string     `json:"subject"`
	From       string     `json:"from"`
	Status     string     `json:"status"`
	Documents  int        `json:"documents"`
	Skipped    int        `json:"skipped"`
	KBID       *uuid.UUID `json:"kb_id,omitempty"`
	ReceivedAt time.Time  `json:"received_at"`
}

// Statuses of a received message.
const (
	StatusImported     = "imported"
	StatusConfirmation = "confirmation"
	StatusEmpty        = "empty"
	StatusFailed       = "failed"
)

// Store persists addresses and the log of received messages.
type Store interface {
	GetAddress(ctx context.Context, userID uuid.UUID) (*Address, error)
	AddressByHash(ctx context.Context, hash []byte) (*Address, error)
	SaveAddress(ctx context.Context, a Address, hash []byte) error
	SetAddressKB(ctx context.Context, userID uuid.UUID, kbID uuid.UUID) error
	SaveConfirmation(ctx context.Context, userID uuid.UUID, code, link string, at time.Time) error
	// ClaimMessage records a message id; false when it was already received.
	ClaimMessage(ctx context.Context, userID uuid.UUID, messageID string, r Received) (bool, error)
	FinishMessage(ctx context.Context, userID uuid.UUID, messageID string, r Received) error
	CountSince(ctx context.Context, userID uuid.UUID, since time.Time) (int, error)
	Recent(ctx context.Context, userID uuid.UUID, n int) ([]Received, error)
	Language(ctx context.Context, userID uuid.UUID) (string, error)
}

// Knowledge is the Knowledge Center as the inbound path uses it.
type Knowledge interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error
	CreateKB(ctx context.Context, userID uuid.UUID, name string) (uuid.UUID, error)
	Upload(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) (uuid.UUID, error)
}

// Service is the inbound mail path.
type Service struct {
	store  Store
	kb     Knowledge
	secret []byte
	domain string
	now    func() time.Time
}

// NewService returns a Service. An empty secret leaves email off: addresses
// are still shown, and every delivery is refused.
func NewService(store Store, kb Knowledge, secret, domain string) *Service {
	return &Service{store: store, kb: kb, secret: []byte(secret), domain: strings.ToLower(domain), now: time.Now}
}

// SetClock replaces the clock, for tests.
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// Enabled reports whether deliveries are accepted.
func (s *Service) Enabled() bool { return len(s.secret) > 0 && s.domain != "" }

// Domain is the domain addresses live on.
func (s *Service) Domain() string { return s.domain }

// Address returns the learner's address, creating it on first use.
func (s *Service) Address(ctx context.Context, userID uuid.UUID) (*Address, error) {
	a, err := s.store.GetAddress(ctx, userID)
	if err == nil {
		a.Email = a.Token + "@" + s.domain
		return a, nil
	}
	if !errors.Is(err, ErrNoAddress) {
		return nil, err
	}
	return s.issue(ctx, Address{UserID: userID})
}

// Rotate replaces the address; mail to the old one bounces.
func (s *Service) Rotate(ctx context.Context, userID uuid.UUID) (*Address, error) {
	a, err := s.Address(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.issue(ctx, Address{UserID: userID, KBID: a.KBID})
}

// SetKB chooses where messages go.
func (s *Service) SetKB(ctx context.Context, userID, kbID uuid.UUID) error {
	if err := s.kb.OwnsKB(ctx, userID, kbID); err != nil {
		return err
	}
	if _, err := s.Address(ctx, userID); err != nil {
		return err
	}
	return s.store.SetAddressKB(ctx, userID, kbID)
}

// Recent lists the last messages received.
func (s *Service) Recent(ctx context.Context, userID uuid.UUID) ([]Received, error) {
	return s.store.Recent(ctx, userID, 10)
}

var tokenAlphabet = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)

func (s *Service) issue(ctx context.Context, a Address) (*Address, error) {
	raw := make([]byte, 15) // 120 bits, 24 characters
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	a.Token = tokenAlphabet.EncodeToString(raw)
	a.CreatedAt = s.now()
	if err := s.store.SaveAddress(ctx, a, hashToken(a.Token)); err != nil {
		return nil, err
	}
	return s.Address(ctx, a.UserID)
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(strings.ToLower(token)))
	return sum[:]
}

// Sign is what the Worker computes: hex HMAC-SHA256 over
// "<unix seconds>.<hex sha256 of the raw message>". Exported for tests.
func Sign(secret []byte, timestamp string, raw []byte) string {
	sum := sha256.Sum256(raw)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(timestamp + "." + hex.EncodeToString(sum[:])))
	return hex.EncodeToString(mac.Sum(nil))
}

// Delivery is one message as the Worker posts it.
type Delivery struct {
	Recipient string
	Timestamp string
	Signature string
	Raw       []byte
}

// Result says what became of a delivery.
type Result struct {
	Status    string `json:"status"`
	Documents int    `json:"documents"`
	Skipped   int    `json:"skipped"`
	Duplicate bool   `json:"duplicate,omitempty"`
}

func (s *Service) verify(d Delivery) error {
	if !s.Enabled() {
		return ErrNotConfigured
	}
	ts, err := strconv.ParseInt(d.Timestamp, 10, 64)
	if err != nil {
		return ErrBadSignature
	}
	if skew := s.now().Sub(time.Unix(ts, 0)); skew > MaxSkew || skew < -MaxSkew {
		return ErrBadSignature
	}
	want := Sign(s.secret, d.Timestamp, d.Raw)
	if !hmac.Equal([]byte(want), []byte(strings.ToLower(d.Signature))) {
		return ErrBadSignature
	}
	return nil
}

var localPart = regexp.MustCompile(`^[a-z2-7]{24}$`)

// Receive files one delivered message.
func (s *Service) Receive(ctx context.Context, d Delivery) (*Result, error) {
	if len(d.Raw) > MaxMessageBytes {
		return nil, ErrTooLarge
	}
	if err := s.verify(d); err != nil {
		return nil, err
	}
	local, domain, ok := strings.Cut(strings.ToLower(strings.TrimSpace(d.Recipient)), "@")
	local, _, _ = strings.Cut(local, "+")
	if !ok || domain != s.domain || !localPart.MatchString(local) {
		return nil, ErrUnknownAddress
	}
	addr, err := s.store.AddressByHash(ctx, hashToken(local))
	if errors.Is(err, ErrNoAddress) {
		return nil, ErrUnknownAddress
	}
	if err != nil {
		return nil, err
	}
	user := addr.UserID

	msg, err := Parse(d.Raw)
	if err != nil {
		return nil, ErrUnreadable
	}
	if msg.MessageID == "" {
		sum := sha256.Sum256(d.Raw)
		msg.MessageID = "sha256:" + hex.EncodeToString(sum[:])
	}

	if code, link, ok := msg.Confirmation(); ok {
		if err := s.store.SaveConfirmation(ctx, user, code, link, s.now()); err != nil {
			return nil, err
		}
		_, _ = s.store.ClaimMessage(ctx, user, msg.MessageID, Received{Subject: msg.Subject, From: msg.From, Status: StatusConfirmation, ReceivedAt: s.now()})
		return &Result{Status: StatusConfirmation}, nil
	}

	n, err := s.store.CountSince(ctx, user, s.now().Add(-24*time.Hour))
	if err != nil {
		return nil, err
	}
	if n >= DailyLimit {
		return nil, ErrTooMany
	}
	rec := Received{Subject: msg.Subject, From: msg.From, Status: StatusFailed, ReceivedAt: s.now()}
	fresh, err := s.store.ClaimMessage(ctx, user, msg.MessageID, rec)
	if err != nil {
		return nil, err
	}
	if !fresh {
		return &Result{Status: StatusImported, Duplicate: true}, nil
	}

	kbID, err := s.target(ctx, addr)
	if err != nil {
		return nil, err
	}
	rec.KBID = &kbID
	res := &Result{Status: StatusImported}

	if body := Markdown(msg); body != "" {
		if _, err := s.kb.Upload(ctx, user, kbID, docName(msg.Subject, ".md"), []byte(body)); err != nil {
			slog.Warn("inbound: the body was not imported", "user", user, "error", err)
			res.Skipped++
		} else {
			res.Documents++
		}
	}
	for _, f := range msg.Files {
		if _, err := s.kb.Upload(ctx, user, kbID, f.Name, f.Data); err != nil {
			// An attachment of a type the pipeline does not read (a .zip, an
			// .ics) is skipped, not fatal; the card counts it.
			res.Skipped++
			continue
		}
		res.Documents++
	}
	if res.Documents == 0 {
		res.Status = StatusEmpty
	}
	rec.Status, rec.Documents, rec.Skipped = res.Status, res.Documents, res.Skipped
	if err := s.store.FinishMessage(ctx, user, msg.MessageID, rec); err != nil {
		return nil, err
	}
	return res, nil
}

// target is the knowledge base messages go to: the chosen one while the
// learner still owns it, else "Inbox" in their language, created once.
func (s *Service) target(ctx context.Context, a *Address) (uuid.UUID, error) {
	if a.KBID != nil {
		if err := s.kb.OwnsKB(ctx, a.UserID, *a.KBID); err == nil {
			return *a.KBID, nil
		}
	}
	lang, _ := s.store.Language(ctx, a.UserID)
	id, err := s.kb.CreateKB(ctx, a.UserID, inboxName(lang))
	if err != nil {
		return uuid.Nil, err
	}
	if err := s.store.SetAddressKB(ctx, a.UserID, id); err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

func inboxName(lang string) string {
	switch lang {
	case "vi":
		return "Hộp thư học tập"
	case "es":
		return "Buzón de estudio"
	case "pt":
		return "Caixa de estudo"
	}
	return "Study inbox"
}

// Markdown is a message's body as a document: its subject, who sent it and
// when, then its text (the HTML part read as a web page when there is one).
func Markdown(m *Message) string {
	text := strings.TrimSpace(m.Text)
	if m.HTML != "" {
		if t, _, err := parse.LocalHTMLText([]byte(m.HTML), ""); err == nil && strings.TrimSpace(t) != "" {
			text = strings.TrimSpace(t)
		}
	}
	if text == "" {
		return ""
	}
	var b strings.Builder
	subject := m.Subject
	if subject == "" {
		subject = "(no subject)"
	}
	fmt.Fprintf(&b, "# %s\n\n", subject)
	if m.From != "" {
		fmt.Fprintf(&b, "From: %s  \n", m.From)
	}
	if !m.Date.IsZero() {
		fmt.Fprintf(&b, "Date: %s\n", m.Date.UTC().Format("2006-01-02 15:04 UTC"))
	}
	b.WriteString("\n")
	b.WriteString(text)
	b.WriteString("\n")
	return b.String()
}

// docName is a safe file name for the body document.
func docName(subject, ext string) string {
	name := strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', '\n', '\r', '\t':
			return ' '
		}
		return r
	}, strings.TrimSpace(subject))
	name = strings.Join(strings.Fields(name), " ")
	if r := []rune(name); len(r) > 120 {
		name = string(r[:120])
	}
	if name == "" {
		name = "Email"
	}
	return path.Base(name) + ext
}
