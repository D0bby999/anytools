package inbound

import (
	"context"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func crlf(s string) []byte { return []byte(strings.ReplaceAll(s, "\n", "\r\n")) }

// A Gmail-style message: multipart/mixed holding an alternative (text and
// HTML, quoted-printable) and a base64 PDF.
var gmailMessage = crlf(`MIME-Version: 1.0
Date: Tue, 20 Oct 2026 09:15:00 +0700
Message-ID: <CAF=abc123@mail.gmail.com>
Subject: =?UTF-8?Q?B=C3=A0i_gi=E1=BA=A3ng_tu=E1=BA=A7n_3?=
From: =?UTF-8?B?Q8O0IExhbg==?= <colan@example.edu>
To: abc@in.anytools.world
Content-Type: multipart/mixed; boundary="mixed"

--mixed
Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain; charset="UTF-8"
Content-Transfer-Encoding: quoted-printable

Ch=C3=A0o c=E1=BA=A3 l=E1=BB=9Bp, b=C3=A0i =C4=91=E1=BB=8Dc tu=E1=BA=A7n n=
=C3=A0y =E1=BB=9F t=E1=BB=87p =C4=91=C3=ADnh k=C3=A8m.

--alt
Content-Type: text/html; charset="UTF-8"
Content-Transfer-Encoding: quoted-printable

<div>Ch=C3=A0o c=E1=BA=A3 l=E1=BB=9Bp, <b>b=C3=A0i =C4=91=E1=BB=8Dc</b> tu=E1=BA=A7n n=C3=A0y.</div>

--alt--

--mixed
Content-Type: application/pdf; name="week3.pdf"
Content-Disposition: attachment; filename="week3.pdf"
Content-Transfer-Encoding: base64

` + wrap(base64.StdEncoding.EncodeToString([]byte("%PDF-1.4 fake pdf bytes for the test"))) + `
--mixed--
`)

func wrap(s string) string {
	var b strings.Builder
	for len(s) > 20 {
		b.WriteString(s[:20] + "\n")
		s = s[20:]
	}
	b.WriteString(s)
	return b.String()
}

func TestParse_GmailMultipart(t *testing.T) {
	m, err := Parse(gmailMessage)
	if err != nil {
		t.Fatal(err)
	}
	if m.Subject != "Bài giảng tuần 3" || m.From != "Cô Lan <colan@example.edu>" || m.MessageID != "CAF=abc123@mail.gmail.com" {
		t.Fatalf("headers: %q %q %q", m.Subject, m.From, m.MessageID)
	}
	if !strings.Contains(m.Text, "bài đọc tuần này ở tệp đính kèm") {
		t.Fatalf("quoted-printable text with a soft break: %q", m.Text)
	}
	if !strings.Contains(m.HTML, "<b>bài đọc</b>") {
		t.Fatalf("html: %q", m.HTML)
	}
	if len(m.Files) != 1 || m.Files[0].Name != "week3.pdf" || !strings.HasPrefix(string(m.Files[0].Data), "%PDF-1.4") {
		t.Fatalf("files: %+v", m.Files)
	}
	if m.Date.IsZero() {
		t.Fatal("date")
	}
	md := Markdown(m)
	if !strings.HasPrefix(md, "# Bài giảng tuần 3\n") || !strings.Contains(md, "bài đọc") || !strings.Contains(md, "From: Cô Lan") {
		t.Fatalf("markdown: %q", md)
	}
}

func TestParse_LatinCharsetAndPathInFilename(t *testing.T) {
	raw := crlf("Subject: =?ISO-8859-1?Q?R=E9sum=E9?=\nFrom: a@b.c\nContent-Type: multipart/mixed; boundary=b\n\n--b\nContent-Type: text/plain; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable\n\nCaf=E9 cr=E8me\n--b\nContent-Type: text/plain; name=\"../../etc/notes.txt\"\nContent-Disposition: attachment; filename=\"..\\\\..\\\\notes.txt\"\n\nhello\n--b--\n")
	m, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if m.Subject != "Résumé" || strings.TrimSpace(m.Text) != "Café crème" {
		t.Fatalf("%q %q", m.Subject, m.Text)
	}
	if len(m.Files) != 1 || m.Files[0].Name != "notes.txt" {
		t.Fatalf("a path in a file name must be dropped: %+v", m.Files)
	}
}

func TestParse_ForwardedAsAttachment(t *testing.T) {
	raw := crlf("Subject: Fwd\nFrom: me@gmail.com\nContent-Type: multipart/mixed; boundary=o\n\n--o\nContent-Type: text/plain\n\nRead this one.\n--o\nContent-Type: message/rfc822\n\nSubject: Inner newsletter\nFrom: news@example.com\nContent-Type: text/plain; charset=utf-8\n\nThe inner body.\n--o--\n")
	m, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	md := Markdown(m)
	if !strings.Contains(md, "Read this one.") || !strings.Contains(md, "The inner body.") {
		t.Fatalf("the note and the forwarded body are both kept: %q", md)
	}
}

func TestConfirmation(t *testing.T) {
	raw := crlf("Subject: (#123456789) Gmail Forwarding Confirmation - Receive Mail from me@gmail.com\nFrom: Gmail Team <forwarding-noreply@google.com>\nContent-Type: text/plain\n\nTo allow this, please click the link below to confirm the request:\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc?x=1&amp;y=2\n\nConfirmation code: 123456789\n")
	m, _ := Parse(raw)
	code, link, ok := m.Confirmation()
	if !ok || code != "123456789" || !strings.HasPrefix(link, "https://mail-settings.google.com/mail/vf-") || strings.Contains(link, "&amp;") {
		t.Fatalf("%v %q %q", ok, code, link)
	}
	if _, _, ok := (&Message{From: "someone@google.com"}).Confirmation(); ok {
		t.Fatal("only Gmail's forwarding sender counts")
	}
}

// --- the service ---

type memStore struct {
	addrs    map[uuid.UUID]*Address
	byHash   map[string]uuid.UUID
	messages map[string]Received
	lang     string
}

func newMem() *memStore {
	return &memStore{addrs: map[uuid.UUID]*Address{}, byHash: map[string]uuid.UUID{}, messages: map[string]Received{}, lang: "vi"}
}
func (m *memStore) GetAddress(_ context.Context, u uuid.UUID) (*Address, error) {
	if a, ok := m.addrs[u]; ok {
		c := *a
		return &c, nil
	}
	return nil, ErrNoAddress
}
func (m *memStore) AddressByHash(ctx context.Context, h []byte) (*Address, error) {
	if u, ok := m.byHash[string(h)]; ok {
		return m.GetAddress(ctx, u)
	}
	return nil, ErrNoAddress
}
func (m *memStore) SaveAddress(_ context.Context, a Address, h []byte) error {
	for k, u := range m.byHash {
		if u == a.UserID {
			delete(m.byHash, k)
		}
	}
	m.addrs[a.UserID], m.byHash[string(h)] = &a, a.UserID
	return nil
}
func (m *memStore) SetAddressKB(_ context.Context, u, kb uuid.UUID) error {
	m.addrs[u].KBID = &kb
	return nil
}
func (m *memStore) SaveConfirmation(_ context.Context, u uuid.UUID, code, link string, at time.Time) error {
	m.addrs[u].ConfirmCode, m.addrs[u].ConfirmLink, m.addrs[u].ConfirmAt = code, link, &at
	return nil
}
func (m *memStore) ClaimMessage(_ context.Context, u uuid.UUID, id string, r Received) (bool, error) {
	k := u.String() + id
	if _, ok := m.messages[k]; ok {
		return false, nil
	}
	m.messages[k] = r
	return true, nil
}
func (m *memStore) FinishMessage(_ context.Context, u uuid.UUID, id string, r Received) error {
	m.messages[u.String()+id] = r
	return nil
}
func (m *memStore) CountSince(_ context.Context, u uuid.UUID, _ time.Time) (int, error) {
	n := 0
	for k := range m.messages {
		if strings.HasPrefix(k, u.String()) {
			n++
		}
	}
	return n, nil
}
func (m *memStore) Recent(context.Context, uuid.UUID, int) ([]Received, error) { return nil, nil }
func (m *memStore) Language(context.Context, uuid.UUID) (string, error)        { return m.lang, nil }

type fakeKB struct {
	owned   map[uuid.UUID]bool
	created []string
	uploads []string
}

func (k *fakeKB) OwnsKB(_ context.Context, _, kb uuid.UUID) error {
	if k.owned[kb] {
		return nil
	}
	return errors.New("no access")
}
func (k *fakeKB) CreateKB(_ context.Context, _ uuid.UUID, name string) (uuid.UUID, error) {
	id := uuid.New()
	k.owned[id] = true
	k.created = append(k.created, name)
	return id, nil
}
func (k *fakeKB) Upload(_ context.Context, _, _ uuid.UUID, name string, _ []byte) (uuid.UUID, error) {
	if strings.HasSuffix(name, ".zip") {
		return uuid.Nil, errors.New("unsupported type")
	}
	k.uploads = append(k.uploads, name)
	return uuid.New(), nil
}

var secret = []byte("test-inbound-secret")

func setup(t *testing.T) (*Service, *memStore, *fakeKB, uuid.UUID, string) {
	t.Helper()
	store, kb := newMem(), &fakeKB{owned: map[uuid.UUID]bool{}}
	svc := NewService(store, kb, string(secret), "in.anytools.world")
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	svc.SetClock(func() time.Time { return now })
	user := uuid.New()
	a, err := svc.Address(context.Background(), user)
	if err != nil || !strings.HasSuffix(a.Email, "@in.anytools.world") || len(a.Token) != 24 {
		t.Fatalf("address: %+v %v", a, err)
	}
	return svc, store, kb, user, a.Email
}

func deliver(svc *Service, to string, raw []byte) (*Result, error) {
	ts := strconv.FormatInt(svc.now().Unix(), 10)
	return svc.Receive(context.Background(), Delivery{Recipient: to, Timestamp: ts, Signature: Sign(secret, ts, raw), Raw: raw})
}

func TestReceive_FilesBodyAndAttachmentInTheInbox(t *testing.T) {
	svc, store, kb, user, to := setup(t)
	res, err := deliver(svc, to, gmailMessage)
	if err != nil || res.Documents != 2 || res.Status != StatusImported {
		t.Fatalf("%+v %v", res, err)
	}
	if len(kb.created) != 1 || kb.created[0] != "Hộp thư học tập" {
		t.Fatalf("the inbox is created once, in the learner's language: %v", kb.created)
	}
	if kb.uploads[0] != "Bài giảng tuần 3.md" || kb.uploads[1] != "week3.pdf" {
		t.Fatalf("uploads: %v", kb.uploads)
	}
	// Delivered twice (Gmail retries): filed once.
	res, err = deliver(svc, to, gmailMessage)
	if err != nil || !res.Duplicate || len(kb.uploads) != 2 {
		t.Fatalf("duplicate: %+v %v %v", res, err, kb.uploads)
	}
	if store.addrs[user].KBID == nil {
		t.Fatal("the inbox becomes the address's target")
	}
}

func TestReceive_Refusals(t *testing.T) {
	svc, _, _, _, to := setup(t)
	ts := strconv.FormatInt(svc.now().Unix(), 10)
	bad := []struct {
		name string
		d    Delivery
		want error
	}{
		{"wrong signature", Delivery{Recipient: to, Timestamp: ts, Signature: Sign([]byte("other"), ts, gmailMessage), Raw: gmailMessage}, ErrBadSignature},
		{"replayed later", Delivery{Recipient: to, Timestamp: strconv.FormatInt(svc.now().Add(-10*time.Minute).Unix(), 10),
			Signature: Sign(secret, strconv.FormatInt(svc.now().Add(-10*time.Minute).Unix(), 10), gmailMessage), Raw: gmailMessage}, ErrBadSignature},
		{"unknown address", Delivery{Recipient: "aaaaaaaaaaaaaaaaaaaaaaaa@in.anytools.world", Timestamp: ts, Signature: Sign(secret, ts, gmailMessage), Raw: gmailMessage}, ErrUnknownAddress},
		{"another domain", Delivery{Recipient: strings.Replace(to, "in.anytools.world", "evil.example", 1), Timestamp: ts, Signature: Sign(secret, ts, gmailMessage), Raw: gmailMessage}, ErrUnknownAddress},
		{"too large", Delivery{Recipient: to, Raw: make([]byte, MaxMessageBytes+1)}, ErrTooLarge},
	}
	for _, c := range bad {
		if _, err := svc.Receive(context.Background(), c.d); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", c.name, err, c.want)
		}
	}

	off := NewService(newMem(), &fakeKB{}, "", "in.anytools.world")
	if _, err := off.Receive(context.Background(), Delivery{Recipient: to, Raw: gmailMessage}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("no secret: %v", err)
	}
}

func TestReceive_DailyLimitAndConfirmation(t *testing.T) {
	svc, store, kb, user, to := setup(t)
	for i := 0; i < DailyLimit; i++ {
		store.messages[user.String()+"m"+strconv.Itoa(i)] = Received{}
	}
	if _, err := deliver(svc, to, gmailMessage); !errors.Is(err, ErrTooMany) {
		t.Fatalf("limit: %v", err)
	}

	confirm := crlf("Subject: (#987654321) Gmail Forwarding Confirmation\nFrom: forwarding-noreply@google.com\nMessage-ID: <c1@google.com>\nContent-Type: text/plain\n\nhttps://mail-settings.google.com/mail/vf-xyz\n")
	res, err := deliver(svc, to, confirm)
	if err != nil || res.Status != StatusConfirmation || store.addrs[user].ConfirmCode != "987654321" || len(kb.uploads) != 0 {
		t.Fatalf("the confirmation is shown, not imported, even at the limit: %+v %v", res, err)
	}
}

func TestReceive_SkipsAnUnreadableAttachmentAndKeepsThePlusTag(t *testing.T) {
	svc, _, kb, _, to := setup(t)
	raw := crlf("Subject: Zip\nMessage-ID: <z@x>\nContent-Type: multipart/mixed; boundary=b\n\n--b\nContent-Type: text/plain\n\nSee the zip.\n--b\nContent-Type: application/zip\nContent-Disposition: attachment; filename=a.zip\n\nPK\n--b--\n")
	local, domain, _ := strings.Cut(to, "@")
	res, err := deliver(svc, local+"+physics@"+strings.ToUpper(domain), raw)
	if err != nil || res.Documents != 1 || res.Skipped != 1 || kb.uploads[0] != "Zip.md" {
		t.Fatalf("%+v %v %v", res, err, kb.uploads)
	}
}

func TestRotateKillsTheOldAddress(t *testing.T) {
	svc, _, _, user, to := setup(t)
	a, err := svc.Rotate(context.Background(), user)
	if err != nil || a.Email == to {
		t.Fatalf("%+v %v", a, err)
	}
	if _, err := deliver(svc, to, gmailMessage); !errors.Is(err, ErrUnknownAddress) {
		t.Fatalf("old address: %v", err)
	}
}
