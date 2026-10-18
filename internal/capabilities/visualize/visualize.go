// Package visualize is "Draw it" (learning-depth phase 5): one diagram of an
// answer, a solution or a reading selection, on the learner's own model.
//
// The learner asks; nothing is drawn unasked. The chat, solve and research
// prompts are unchanged, so Mermaid never enters a research report's claim
// check or a document added to a knowledge base.
//
// Following DeepTutor (findings §5): one model call, validated, and ONE
// targeted repair when validation fails. A failure only the browser can see
// (Mermaid's own parser) comes back through Repair, which is allowed once per
// diagram. The diagram is appended to the conversation as an assistant
// message, so it is saved, reloaded and exported like any other answer.
package visualize

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	visualizeprompts "github.com/D0bby999/anytools/internal/prompts/visualize"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// Name is the capability recorded on a diagram message.
const Name = "visualize"

// MaxRequest caps the learner's own words ("show it as a timeline").
const MaxRequest = 300

// maxContent caps what is sent to the model: a long answer is drawn from its
// first part rather than refused.
const maxContent = 12000

var (
	// ErrNotFound covers "not yours" and "does not exist" alike.
	ErrNotFound = errors.New("visualize: not found")
	// ErrRepaired means the diagram's one repair has been spent.
	ErrRepaired = errors.New("visualize: this diagram has already been repaired once")
	// ErrBadRequest is a request the learner can fix.
	ErrBadRequest = errors.New("visualize: bad request")
)

// Messages is the conversation store (pg.ChatStore).
type Messages interface {
	GetMessage(ctx context.Context, userID, messageID uuid.UUID) (*runtime.ChatMessage, error)
	AppendMessage(ctx context.Context, m runtime.ChatMessage) (*runtime.ChatMessage, error)
	// ReplaceDiagram swaps a diagram message's content and attachments, only
	// while its attachments still say it has not been repaired. It reports
	// whether it did.
	ReplaceDiagram(ctx context.Context, userID, messageID uuid.UUID, content string, attachments []byte) (bool, error)
}

// Service draws diagrams.
type Service struct {
	messages  Messages
	providers runtime.ChatProviderResolver
}

// NewService builds the service.
func NewService(messages Messages, providers runtime.ChatProviderResolver) *Service {
	return &Service{messages: messages, providers: providers}
}

// Attachment is what a diagram message carries under attachments.diagram.
type Attachment struct {
	Of   *uuid.UUID `json:"of,omitempty"`
	Kind string     `json:"kind"`
	// Function is the route the diagram was drawn on; its repair uses it too.
	Function string `json:"function"`
	Repaired bool   `json:"repaired"`
}

// Result is a drawn diagram and the message that holds it.
type Result struct {
	Message *runtime.ChatMessage
	Diagram Diagram
}

// functionFor is the route a source message's capability draws on: the
// learner chose which of their models reads solutions and which reads their
// documents, and a diagram of one is that job too.
func functionFor(capability string) string {
	switch capability {
	case "solve", "reading":
		return capability
	default:
		return "chat"
	}
}

// DrawMessage draws one of the learner's own assistant messages.
func (s *Service) DrawMessage(ctx context.Context, userID, messageID uuid.UUID, request string) (*Result, error) {
	msg, err := s.messages.GetMessage(ctx, userID, messageID)
	if err != nil || msg.Role != runtime.RoleAssistant || msg.Capability == Name {
		return nil, ErrNotFound
	}
	return s.draw(ctx, userID, msg.SessionID, &msg.ID, functionFor(msg.Capability), "Answer", msg.Content, request,
		askLine("Draw it", request))
}

// DrawSelection draws a passage the learner selected while reading. The
// session is the reading workspace's own, resolved by the caller.
func (s *Service) DrawSelection(ctx context.Context, userID, sessionID uuid.UUID, title, selection, request string) (*Result, error) {
	if strings.TrimSpace(selection) == "" {
		return nil, fmt.Errorf("%w: select some text first", ErrBadRequest)
	}
	return s.draw(ctx, userID, sessionID, nil, "reading", title, selection, request,
		askLine("Draw it: \u201c"+truncate(selection, 200)+"\u201d", request))
}

// askLine is the learner's side of the exchange, stored before the diagram so
// a transcript reads as a request and its answer (the reading tutor pairs
// them that way).
func askLine(what, request string) string {
	if request = strings.TrimSpace(request); request != "" {
		return what + " \u2014 " + request
	}
	return what
}

func (s *Service) draw(
	ctx context.Context, userID, sessionID uuid.UUID, of *uuid.UUID, function, label, content, request, asked string,
) (*Result, error) {
	request = strings.TrimSpace(request)
	if utf8.RuneCountInString(request) > MaxRequest {
		return nil, fmt.Errorf("%w: keep the request under %d characters", ErrBadRequest, MaxRequest)
	}
	provider, err := s.providers.ChatFor(ctx, userID, function)
	if err != nil {
		return nil, err
	}

	var user strings.Builder
	user.WriteString(tools.WrapAll([]string{tools.Wrap(label, "content", truncate(content, maxContent))}))
	if request != "" {
		fmt.Fprintf(&user, "\n\nThe learner's request: %s", request)
	}
	d, err := s.ask(ctx, provider, visualizeprompts.Draw, user.String())
	if err != nil {
		return nil, err
	}
	valid, verr := Validate(d)
	if verr != nil {
		// The one repair a server-side failure gets, in this same request.
		d, err = s.ask(ctx, provider, visualizeprompts.Repair, repairInput(d, verr.Error()))
		if err != nil {
			return nil, err
		}
		if valid, verr = Validate(d); verr != nil {
			return nil, verr
		}
	}

	// Only once there is something to show: a failed draw leaves no trace.
	if _, err := s.messages.AppendMessage(ctx, runtime.ChatMessage{
		UserID: userID, SessionID: sessionID, Role: runtime.RoleUser, Content: asked, Capability: Name,
	}); err != nil {
		return nil, err
	}
	attachments, _ := json.Marshal(map[string]any{
		"sources": []any{},
		"diagram": Attachment{Of: of, Kind: valid.Kind, Function: function},
	})
	msg, err := s.messages.AppendMessage(ctx, runtime.ChatMessage{
		UserID: userID, SessionID: sessionID, Role: runtime.RoleAssistant,
		Content: Markdown(valid), Capability: Name, Attachments: attachments,
	})
	if err != nil {
		return nil, err
	}
	return &Result{Message: msg, Diagram: valid}, nil
}

// Repair fixes a diagram the browser could not draw, once. browserError is
// Mermaid's own parse message, shown to the model as a quoted error.
func (s *Service) Repair(ctx context.Context, userID, messageID uuid.UUID, browserError string) (*Result, error) {
	msg, err := s.messages.GetMessage(ctx, userID, messageID)
	if err != nil || msg.Capability != Name {
		return nil, ErrNotFound
	}
	var att struct {
		Diagram *Attachment `json:"diagram"`
	}
	if err := json.Unmarshal(msg.Attachments, &att); err != nil || att.Diagram == nil {
		return nil, ErrNotFound
	}
	if att.Diagram.Repaired {
		return nil, ErrRepaired
	}
	current, ok := ParseMarkdown(msg.Content)
	if !ok {
		return nil, ErrNotFound
	}

	provider, err := s.providers.ChatFor(ctx, userID, functionFor(att.Diagram.Function))
	if err != nil {
		return nil, err
	}
	d, err := s.ask(ctx, provider, visualizeprompts.Repair, repairInput(current, truncate(browserError, 500)))
	if err != nil {
		return nil, err
	}
	valid, err := Validate(d)
	if err != nil {
		return nil, err
	}
	att.Diagram.Repaired = true
	att.Diagram.Kind = valid.Kind
	attachments, _ := json.Marshal(map[string]any{"sources": []any{}, "diagram": att.Diagram})
	content := Markdown(valid)
	replaced, err := s.messages.ReplaceDiagram(ctx, userID, messageID, content, attachments)
	if err != nil {
		return nil, err
	}
	if !replaced {
		// Another repair of the same diagram won the race.
		return nil, ErrRepaired
	}
	msg.Content, msg.Attachments = content, attachments
	return &Result{Message: msg, Diagram: valid}, nil
}

func (s *Service) ask(ctx context.Context, provider runtime.ChatProvider, system, user string) (Diagram, error) {
	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: provider.DefaultModel(),
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: system},
			{Role: runtime.RoleUser, Content: user},
		},
	})
	if err != nil {
		return Diagram{}, fmt.Errorf("%w: %s", runtime.ErrProvider, err)
	}
	if resp == nil {
		return Diagram{}, fmt.Errorf("%w: the model returned nothing", runtime.ErrProvider)
	}
	var d Diagram
	payload, ok := modeljson.Extract(resp.Content)
	if !ok || json.Unmarshal([]byte(payload), &d) != nil {
		// Unreadable output is a validation failure like any other, so it
		// gets the one repair.
		return Diagram{Kind: "unreadable", Source: truncate(resp.Content, 2000)}, nil
	}
	return d, nil
}

func repairInput(d Diagram, why string) string {
	return fmt.Sprintf("Error: %s\n\nYour diagram (kind %q):\n%s", why, d.Kind, d.Source)
}

// Markdown is how a diagram is stored and rendered: a fenced block the
// browser's RichText draws, then the caption as a line of text.
func Markdown(d Diagram) string {
	var b strings.Builder
	fmt.Fprintf(&b, "```%s\n%s\n```", d.Kind, d.Source)
	if d.Caption != "" {
		fmt.Fprintf(&b, "\n\n%s", d.Caption)
	}
	return b.String()
}

// ParseMarkdown reads a stored diagram message back.
func ParseMarkdown(s string) (Diagram, bool) {
	if !strings.HasPrefix(s, "```") {
		return Diagram{}, false
	}
	head, rest, ok := strings.Cut(s[3:], "\n")
	if !ok {
		return Diagram{}, false
	}
	body, caption, ok := strings.Cut(rest, "\n```")
	if !ok {
		return Diagram{}, false
	}
	return Diagram{Kind: head, Source: body, Caption: strings.TrimSpace(caption)}, true
}
