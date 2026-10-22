// Package circles is studying with friends: a study circle of up to
// MaxMembers people who see each other's steadiness, never what anyone
// studies (the private design notes).
//
// A member is seen by the name they gave the circle, never by their account.
// Members see each other's study days this week against their goal, streak,
// level and the day they last studied, and may cheer each other once a day.
// The earliest member is the owner: renames, makes a new invite code,
// removes members. When the owner leaves the next earliest is; the last to
// leave deletes the circle.
package circles

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/progress"
)

// Limits.
const (
	MaxMembers  = 20
	MaxCircles  = 10
	MaxName     = 60
	MaxNickname = 40
	CodeLength  = 10
)

// Errors the API maps to statuses.
var (
	// ErrNotFound is a circle the caller is not in, a code no circle has, or
	// a member not in the circle: all alike, so nothing leaks which exist.
	ErrNotFound = errors.New("circles: not found")
	// ErrNotOwner is a member asking for what only the owner may do.
	ErrNotOwner = errors.New("circles: only the circle's owner can do that")
	ErrInvalid  = errors.New("circles: invalid")
	ErrFull     = errors.New("circles: the circle is full")
	ErrTooMany  = errors.New("circles: in too many circles")
	// ErrNameTaken is a nickname another member of the circle goes by.
	ErrNameTaken = fmt.Errorf("%w: someone in the circle already goes by that name", ErrInvalid)
)

// codeAlphabet has no 0, O, 1 or I, which read alike.
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// NewCode is a random invite code.
func NewCode() string {
	b := make([]byte, CodeLength)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return string(b)
}

// NormalizeCode reads a code as typed: any case, with spaces or dashes.
func NormalizeCode(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		if strings.ContainsRune(codeAlphabet, r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Circle is a circle as one of its members sees it.
type Circle struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	InviteCode string    `json:"invite_code"`
	Members    int       `json:"members"`
	Owner      bool      `json:"owner"`
	Nickname   string    `json:"nickname"`
	CreatedAt  time.Time `json:"created_at"`
}

// Member is another member, or the caller, as the circle sees them.
type Member struct {
	ID       uuid.UUID `json:"id"`
	Nickname string    `json:"nickname"`
	Owner    bool      `json:"owner"`
	Me       bool      `json:"me"`
	JoinedAt time.Time `json:"joined_at"`
	// Cheered is whether the caller cheered them today.
	Cheered bool `json:"cheered"`
	// Cheers are the cheers they had in the last day.
	Cheers   int            `json:"cheers"`
	Progress progress.Brief `json:"progress"`

	userID uuid.UUID
}

// NewMember is what the store reads of a member; the user id stays inside.
func NewMember(id, user uuid.UUID, nickname string, owner, me bool, joined time.Time, cheered bool, cheers int) Member {
	return Member{ID: id, userID: user, Nickname: nickname, Owner: owner, Me: me, JoinedAt: joined, Cheered: cheered, Cheers: cheers}
}

// Detail is a circle's page.
type Detail struct {
	Circle  Circle   `json:"circle"`
	Members []Member `json:"members"`
	// MetGoal are the members whose week has met their goal.
	MetGoal int `json:"met_goal"`
}

// Cheer is a cheer the caller had.
type Cheer struct {
	From     string    `json:"from"`
	CircleID uuid.UUID `json:"circle_id"`
	Circle   string    `json:"circle"`
	At       time.Time `json:"at"`
}

// Store is the circles' persistence. Every method is scoped to circles the
// user is a member of and answers ErrNotFound otherwise.
type Store interface {
	List(ctx context.Context, user uuid.UUID) ([]Circle, error)
	Create(ctx context.Context, user uuid.UUID, name, nickname, code string) (Circle, error)
	Join(ctx context.Context, user uuid.UUID, code, nickname string) (Circle, error)
	Members(ctx context.Context, user, circle uuid.UUID) (Circle, []Member, error)
	// Update renames the circle (the owner only) and sets the caller's
	// nickname, either or both, in one transaction; nil leaves one as it is.
	Update(ctx context.Context, user, circle uuid.UUID, name, nickname *string) error
	SetCode(ctx context.Context, user, circle uuid.UUID, code string) error
	Leave(ctx context.Context, user, circle uuid.UUID) error
	// Remove takes a member out and replaces the invite code, so the code
	// they saw no longer lets them back in.
	Remove(ctx context.Context, user, circle, member uuid.UUID, code string) error
	// Cheer records the caller's cheer for a member today (the caller's
	// local day) and reports whether it is new.
	Cheer(ctx context.Context, user, circle, member uuid.UUID) (bool, error)
	Cheers(ctx context.Context, user uuid.UUID, since time.Time) ([]Cheer, error)
}

// Briefer is a member's progress, counted in their own zone from a count
// no older than fresh.
type Briefer interface {
	Brief(ctx context.Context, user uuid.UUID, fresh time.Duration) (progress.Brief, error)
}

// Service answers the circles.
type Service struct {
	store    Store
	progress Briefer
	now      func() time.Time
}

// NewService builds a Service.
func NewService(store Store, progress Briefer) *Service {
	return &Service{store: store, progress: progress, now: time.Now}
}

var (
	errName     = fmt.Errorf("%w: name must be 1 to 60 characters", ErrInvalid)
	errNickname = fmt.Errorf("%w: nickname must be 1 to 40 characters", ErrInvalid)
)

// text is s with its spaces tidied, or bad when it is empty or too long.
func text(s string, max int, bad error) (string, error) {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" || utf8.RuneCountInString(s) > max {
		return "", bad
	}
	return s, nil
}

// List are the caller's circles.
func (s *Service) List(ctx context.Context, user uuid.UUID) ([]Circle, error) {
	return s.store.List(ctx, user)
}

// Create starts a circle with the caller as its owner.
func (s *Service) Create(ctx context.Context, user uuid.UUID, name, nickname string) (Circle, error) {
	name, err := text(name, MaxName, errName)
	if err != nil {
		return Circle{}, err
	}
	if nickname, err = text(nickname, MaxNickname, errNickname); err != nil {
		return Circle{}, err
	}
	return s.store.Create(ctx, user, name, nickname, NewCode())
}

// Join adds the caller to the circle with the code; joining again is a no-op.
func (s *Service) Join(ctx context.Context, user uuid.UUID, code, nickname string) (Circle, error) {
	nickname, err := text(nickname, MaxNickname, errNickname)
	if err != nil {
		return Circle{}, err
	}
	code = NormalizeCode(code)
	if len(code) != CodeLength {
		return Circle{}, ErrNotFound
	}
	return s.store.Join(ctx, user, code, nickname)
}

// Detail is a circle with each member's progress.
func (s *Service) Detail(ctx context.Context, user, circle uuid.UUID) (*Detail, error) {
	c, members, err := s.store.Members(ctx, user, circle)
	if err != nil {
		return nil, err
	}
	out := &Detail{Circle: c, Members: members}
	for i := range out.Members {
		m := &out.Members[i]
		// One member's count failing shows them with nothing this week
		// rather than failing the page for everyone.
		if m.Progress, err = s.progress.Brief(ctx, m.userID, progress.FreshForCircle); err != nil {
			slog.Warn("circles: a member's progress could not be read", "circle", circle, "member", m.ID, "error", err)
			m.Progress = progress.Brief{WeekGoal: 1}
			continue
		}
		if m.Progress.WeekDays >= m.Progress.WeekGoal {
			out.MetGoal++
		}
	}
	return out, nil
}

// Update renames a circle the caller owns and changes the name the caller
// goes by in it, either or both, all or nothing.
func (s *Service) Update(ctx context.Context, user, circle uuid.UUID, name, nickname *string) error {
	if name == nil && nickname == nil {
		return fmt.Errorf("%w: name or nickname is required", ErrInvalid)
	}
	if name != nil {
		n, err := text(*name, MaxName, errName)
		if err != nil {
			return err
		}
		name = &n
	}
	if nickname != nil {
		n, err := text(*nickname, MaxNickname, errNickname)
		if err != nil {
			return err
		}
		nickname = &n
	}
	return s.store.Update(ctx, user, circle, name, nickname)
}

// NewInvite replaces the invite code of a circle the caller owns, so the
// old link stops working.
func (s *Service) NewInvite(ctx context.Context, user, circle uuid.UUID) (string, error) {
	code := NewCode()
	return code, s.store.SetCode(ctx, user, circle, code)
}

// Leave takes the caller out of a circle.
func (s *Service) Leave(ctx context.Context, user, circle uuid.UUID) error {
	return s.store.Leave(ctx, user, circle)
}

// Remove takes a member out of a circle the caller owns, and makes a new
// invite code.
func (s *Service) Remove(ctx context.Context, user, circle, member uuid.UUID) error {
	return s.store.Remove(ctx, user, circle, member, NewCode())
}

// Cheer cheers a member once a day.
func (s *Service) Cheer(ctx context.Context, user, circle, member uuid.UUID) (bool, error) {
	return s.store.Cheer(ctx, user, circle, member)
}

// RecentCheers are the cheers the caller had in the last day.
func (s *Service) RecentCheers(ctx context.Context, user uuid.UUID) ([]Cheer, error) {
	return s.store.Cheers(ctx, user, s.now().Add(-24*time.Hour))
}
