// Package inbound turns email into study material (learning-tool-connections
// phase 4). Each learner has an address, <token>@in.anytools.world; mail sent
// or forwarded there (a newsletter a Gmail filter forwards, a teacher's
// message, a PDF attached to either) becomes documents in a knowledge base
// they choose.
//
// Reading Gmail through its API is a restricted scope (a yearly paid security
// assessment); forwarding needs no Google permission at all. Cloudflare Email
// Routing hands each message to a small Worker (deploy/cloudflare/
// inbound-email), which signs it and posts it here through the BFF.
//
// Everything in a message is untrusted: it is parsed, never executed, and its
// attachments go through the same type and size checks as an upload.
package inbound

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"html"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"path"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html/charset"
)

// Message is a parsed email.
type Message struct {
	MessageID string
	From      string
	Subject   string
	Date      time.Time
	Text      string
	HTML      string
	Files     []File
}

// File is one attachment.
type File struct {
	Name        string
	ContentType string
	Data        []byte
}

// Limits on what one message may carry.
const (
	maxParts = 200
	maxFiles = 20
	maxDepth = 6
)

var wordDecoder = &mime.WordDecoder{CharsetReader: charset.NewReaderLabel}

func decodeHeader(v string) string {
	out, err := wordDecoder.DecodeHeader(v)
	if err != nil {
		return v
	}
	return strings.TrimSpace(out)
}

// Parse reads a raw RFC 5322 message.
func Parse(raw []byte) (*Message, error) {
	m, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("inbound: not an email: %w", err)
	}
	msg := &Message{
		MessageID: strings.Trim(strings.TrimSpace(m.Header.Get("Message-Id")), "<>"),
		Subject:   decodeHeader(m.Header.Get("Subject")),
		From:      decodeHeader(m.Header.Get("From")),
	}
	if d, err := m.Header.Date(); err == nil {
		msg.Date = d
	}
	w := &walker{msg: msg}
	if err := w.part(m.Header.Get("Content-Type"), m.Header.Get("Content-Transfer-Encoding"), "", m.Body, 0); err != nil {
		return nil, err
	}
	return msg, nil
}

type walker struct {
	msg   *Message
	parts int
}

func (w *walker) part(contentType, encoding, disposition string, body io.Reader, depth int) error {
	w.parts++
	if w.parts > maxParts || depth > maxDepth {
		return nil
	}
	if contentType == "" {
		contentType = "text/plain; charset=us-ascii"
	}
	media, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		media, params = "application/octet-stream", map[string]string{}
	}

	if strings.HasPrefix(media, "multipart/") {
		mr := multipart.NewReader(body, params["boundary"])
		for {
			p, err := mr.NextRawPart()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				// A broken trailing boundary keeps what was read so far.
				return nil
			}
			if err := w.part(p.Header.Get("Content-Type"), p.Header.Get("Content-Transfer-Encoding"),
				p.Header.Get("Content-Disposition"), p, depth+1); err != nil {
				return err
			}
		}
	}

	data, err := io.ReadAll(decodeTransfer(encoding, body))
	if err != nil {
		return nil
	}

	// A forwarded-as-attachment message: what it carries is the material.
	if media == "message/rfc822" {
		inner, err := mail.ReadMessage(bytes.NewReader(data))
		if err != nil {
			return nil
		}
		if w.msg.Subject == "" {
			w.msg.Subject = decodeHeader(inner.Header.Get("Subject"))
		}
		// Its body joins the outer one (a note above it stays), and its
		// attachments join the outer list.
		sub := &walker{msg: &Message{}, parts: w.parts}
		if err := sub.part(inner.Header.Get("Content-Type"), inner.Header.Get("Content-Transfer-Encoding"), "", inner.Body, depth+1); err != nil {
			return err
		}
		w.parts = sub.parts
		w.msg.Text = joinBody(w.msg.Text, sub.msg.Text)
		w.msg.HTML = joinBody(w.msg.HTML, sub.msg.HTML)
		for _, f := range sub.msg.Files {
			if len(w.msg.Files) < maxFiles {
				w.msg.Files = append(w.msg.Files, f)
			}
		}
		return nil
	}

	name := fileName(disposition, params)
	attached := strings.HasPrefix(strings.ToLower(disposition), "attachment") || name != ""
	switch {
	case !attached && media == "text/plain" && w.msg.Text == "":
		w.msg.Text = toUTF8(data, params["charset"])
	case !attached && media == "text/html" && w.msg.HTML == "":
		w.msg.HTML = toUTF8(data, params["charset"])
	case attached && len(w.msg.Files) < maxFiles && len(data) > 0:
		if name == "" {
			name = "attachment"
		}
		w.msg.Files = append(w.msg.Files, File{Name: name, ContentType: media, Data: data})
	}
	return nil
}

func joinBody(outer, inner string) string {
	switch {
	case strings.TrimSpace(inner) == "":
		return outer
	case strings.TrimSpace(outer) == "":
		return inner
	}
	return strings.TrimRight(outer, "\r\n") + "\n\n" + inner
}

func decodeTransfer(encoding string, r io.Reader) io.Reader {
	switch strings.ToLower(strings.TrimSpace(encoding)) {
	case "base64":
		return base64.NewDecoder(base64.StdEncoding, &stripSpace{r: r})
	case "quoted-printable":
		return quotedprintable.NewReader(r)
	default:
		return r
	}
}

// stripSpace drops the line breaks base64 bodies are wrapped with.
type stripSpace struct{ r io.Reader }

func (s *stripSpace) Read(p []byte) (int, error) {
	n, err := s.r.Read(p)
	j := 0
	for i := 0; i < n; i++ {
		switch p[i] {
		case '\r', '\n', ' ', '\t':
		default:
			p[j] = p[i]
			j++
		}
	}
	if j == 0 && n > 0 && err == nil {
		return s.Read(p)
	}
	return j, err
}

func toUTF8(data []byte, label string) string {
	if label == "" || strings.EqualFold(label, "utf-8") || strings.EqualFold(label, "us-ascii") {
		return string(bytes.ToValidUTF8(data, []byte("\uFFFD")))
	}
	r, err := charset.NewReaderLabel(label, bytes.NewReader(data))
	if err != nil {
		return string(bytes.ToValidUTF8(data, []byte("\uFFFD")))
	}
	out, err := io.ReadAll(r)
	if err != nil {
		return string(bytes.ToValidUTF8(data, []byte("\uFFFD")))
	}
	return string(out)
}

// fileName is an attachment's name, reduced to a base name with no path.
func fileName(disposition string, ctParams map[string]string) string {
	name := ""
	if _, p, err := mime.ParseMediaType(disposition); err == nil {
		name = p["filename"]
	}
	if name == "" {
		name = ctParams["name"]
	}
	name = decodeHeader(name)
	name = path.Base(strings.ReplaceAll(name, `\`, "/"))
	if name == "." || name == "/" {
		return ""
	}
	return name
}

// Gmail's forwarding confirmation: sent to a new forwarding address before
// Gmail will forward to it automatically. It is shown to the learner, never
// imported.
var (
	confirmCode = regexp.MustCompile(`\(#(\d{6,12})\)|(?i)confirmation code:\s*(\d{6,12})`)
	confirmLink = regexp.MustCompile(`https://(?:mail-settings\.google\.com|mail\.google\.com)/mail/[^\s"'<>]+`)
)

// Confirmation reports Gmail's forwarding confirmation, with its code and link.
func (m *Message) Confirmation() (code, link string, ok bool) {
	if !strings.Contains(strings.ToLower(m.From), "forwarding-noreply@google.com") {
		return "", "", false
	}
	for _, s := range []string{m.Subject, m.Text, m.HTML} {
		if code == "" {
			if g := confirmCode.FindStringSubmatch(s); g != nil {
				code = g[1] + g[2]
			}
		}
		if link == "" {
			link = confirmLink.FindString(s)
		}
	}
	return code, html.UnescapeString(strings.TrimRight(link, ".,)")), true
}
