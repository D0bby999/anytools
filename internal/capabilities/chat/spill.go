package chat

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// spill.go keeps a turn's large tool results whole (plan 261021-1100 phase 5,
// after postclaw's tool_output_spill.go).
//
// Capping a result keeps the prompt bounded but loses its middle for good.
// Here the whole result is kept for the rest of the turn and the prompt gets
// its head and tail with a handle; the model reads any page of it back with
// read_result, or lists the lines that contain a phrase.
//
// postclaw spills to its media store because its tool results live in the
// session's history. Here they never outlive the turn: history keeps only
// questions and answers, so a result is gone once the answer is written, and
// the book is memory the turn owns. Nothing is stored, nothing needs cleaning
// up, and no other turn or user can name a handle.

// readResultName is the turn-local tool that reads a kept result back.
const readResultName = "read_result"

const (
	// spillMaxChars bounds what one kept result may hold. A 2 MB page is
	// kept whole; past this the rest is cut, and the last page says so.
	spillMaxChars = 4_000_000
	// spillPageChars is one page of a kept result, read back.
	spillPageChars = 12_000
	// spillFindLines caps the lines one find returns.
	spillFindLines = 40
)

// spilled is one kept result.
type spilled struct {
	tool      string
	text      string
	pages     int
	retrieved bool
	clipped   bool
}

// spillBook is one turn's kept results, by handle.
type spillBook struct {
	mu      sync.Mutex
	results []spilled
}

// keep stores text and returns its handle: r1, r2, …
func (b *spillBook) keep(tool, text string, retrieved bool) string {
	r := []rune(text)
	clipped := false
	if len(r) > spillMaxChars {
		r, clipped = r[:spillMaxChars], true
	}
	pages := (len(r) + spillPageChars - 1) / spillPageChars
	b.mu.Lock()
	defer b.mu.Unlock()
	b.results = append(b.results, spilled{tool: tool, text: string(r), pages: max(pages, 1), retrieved: retrieved, clipped: clipped})
	return fmt.Sprintf("r%d", len(b.results))
}

func (b *spillBook) get(handle string) (spilled, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	var n int
	if _, err := fmt.Sscanf(handle, "r%d", &n); err != nil || n < 1 || n > len(b.results) || fmt.Sprintf("r%d", n) != handle {
		return spilled{}, false
	}
	return b.results[n-1], true
}

func (b *spillBook) empty() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.results) == 0
}

// spillHandle finds the handle in a preview, so a result cut harder later
// (an overflow retry, an elision) keeps pointing at it.
var spillHandle = regexp.MustCompile(`result_id=(r\d+)`)

// spillMarker is what stands for the part of a kept result left out.
func spillMarker(omitted, total int, handle string, pages int) string {
	return fmt.Sprintf("\n\n[… %d of %d characters left out to fit the context. The whole result is kept as result_id=%s "+
		"(%d pages): call read_result with that result_id and a page, or with find to list the lines that contain a phrase …]\n\n",
		omitted, total, handle, pages)
}

// previewKept is a kept result's head and tail within max characters, with
// the marker that names its handle.
func previewKept(text string, max int, handle string, pages int) string {
	r := []rune(text)
	if len(r) <= max {
		return text
	}
	head, tail := snapHead(string(r[:max*2/3])), snapTail(string(r[len(r)-max/3:]))
	omitted := len(r) - len([]rune(head)) - len([]rune(tail))
	return head + spillMarker(omitted, len(r), handle, pages) + tail
}

// shrinkToolOutput cuts a tool message to max characters. A preview of a
// kept result is rebuilt around its handle rather than cut through it, so the
// model can still read the whole result back.
func shrinkToolOutput(content string, max int, book *spillBook) string {
	if m := spillHandle.FindStringSubmatch(content); m != nil && book != nil {
		if kept, ok := book.get(m[1]); ok {
			return previewKept(kept.text, max, m[1], kept.pages)
		}
	}
	return capToolOutput(content, max)
}

// elidedNote stands for an earlier round's result that was taken out of the
// prompt to make room. The result is kept, so nothing is lost.
func elidedNote(tool string, chars int, handle string) string {
	return fmt.Sprintf("[This %s result (%d characters) was taken out of the context to make room. "+
		"It is kept as result_id=%s: call read_result with it to read it again.]", tool, chars, handle)
}

// Elision (postclaw loop_history_tool_elision.go): when the prompt nears the
// model's window, results from rounds before the latest leave it, oldest
// first. Each is kept in the book before it goes, so it can be read again.
// Across turns there is nothing to elide: history keeps only questions and
// answers, never tool results.
const (
	elideAt       = 0.7 // of the window
	elideMinChars = 800 // smaller results cost little and often matter
)

// elideOlderResults replaces older tool results in msgs with a note naming
// their handle, oldest first, until the prompt is under elideAt of window.
// The latest round's results stay. It returns how many it replaced.
func elideOlderResults(msgs []runtime.Message, turn *turnTools, tokens, window int) int {
	limit := int(float64(window) * elideAt)
	if window <= 0 || tokens <= limit {
		return 0
	}
	latest := len(msgs)
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == runtime.RoleAssistant {
			latest = i
			break
		}
	}
	n := 0
	for i := 0; i < latest && tokens > limit; i++ {
		m := &msgs[i]
		chars := len([]rune(m.Content))
		if m.Role != runtime.RoleTool || chars < elideMinChars || strings.HasPrefix(m.Content, "[This ") {
			continue
		}
		info := turn.calls[m.ToolCallID]
		handle := ""
		if h := spillHandle.FindStringSubmatch(m.Content); h != nil {
			handle = h[1]
		} else {
			handle = turn.book.keep(info.tool, m.Content, info.retrieved)
		}
		note := elidedNote(info.tool, chars, handle)
		tokens -= estimateTokens(m.Content) - estimateTokens(note)
		m.Content = note
		n++
	}
	return n
}

func snapHead(s string) string {
	if i := strings.LastIndexByte(s, '\n'); i > len(s)/2 {
		return s[:i]
	}
	return s
}

func snapTail(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 && i < len(s)/2 {
		return s[i+1:]
	}
	return s
}

// readResultDefinition is offered once the turn has kept a result.
func readResultDefinition() runtime.ToolDefinition {
	return runtime.ToolDefinition{
		Type: "function",
		Function: runtime.ToolFunctionSchema{
			Name: readResultName,
			Description: "Read back a tool result from this turn that was too long to show whole. " +
				"Give its result_id and either a page (1-based) or find, a phrase to list the lines that contain it with their pages.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"result_id": map[string]any{"type": "string", "description": "The result_id named where the result was cut, such as r1."},
					"page":      map[string]any{"type": "integer", "description": "1-based page of the result."},
					"find":      map[string]any{"type": "string", "description": "A phrase; lists the lines containing it."},
				},
				"required": []string{"result_id"},
			},
		},
	}
}

// readResult runs read_result. Its errors go back to the model as text.
func readResult(book *spillBook, args map[string]any) (content string, retrieved, failed bool) {
	handle, _ := args["result_id"].(string)
	kept, ok := book.get(strings.TrimSpace(handle))
	if !ok {
		return fmt.Sprintf("there is no kept result %q in this turn", handle), false, true
	}
	if find, _ := args["find"].(string); strings.TrimSpace(find) != "" {
		return findLines(kept, strings.TrimSpace(find)), kept.retrieved, false
	}
	page := 1
	if v, ok := args["page"]; ok {
		n, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(v)))
		if err != nil {
			return "page must be a whole number", false, true
		}
		page = n
	}
	if page < 1 || page > kept.pages {
		return fmt.Sprintf("result %s has pages 1 to %d", handle, kept.pages), false, true
	}
	r := []rune(kept.text)
	text := string(r[(page-1)*spillPageChars : min(page*spillPageChars, len(r))])
	label := fmt.Sprintf("%s result %s, page %d of %d", kept.tool, handle, page, kept.pages)
	if page == kept.pages && kept.clipped {
		text += fmt.Sprintf("\n\n[The result was longer than %d characters; the rest was not kept.]", spillMaxChars)
	}
	if kept.retrieved {
		// A page can start or stop inside a passage's envelope, so the page
		// is enveloped as a whole; the passages' own tags inside it are
		// defused and stay legible, ids included.
		return tools.Wrap(label, "result:"+handle, text), true, false
	}
	return label + "\n\n" + text, false, false
}

// findLines lists the lines of a kept result that contain phrase.
func findLines(kept spilled, phrase string) string {
	needle := strings.ToLower(phrase)
	var b strings.Builder
	found, offset := 0, 0
	for _, line := range strings.Split(kept.text, "\n") {
		n := len([]rune(line))
		if strings.Contains(strings.ToLower(line), needle) {
			if found == spillFindLines {
				b.WriteString("[more lines match; narrow the phrase or read a page]\n")
				break
			}
			fmt.Fprintf(&b, "page %d: %s\n", offset/spillPageChars+1, truncate(strings.TrimSpace(line), 300))
			found++
		}
		offset += n + 1
	}
	if found == 0 {
		return fmt.Sprintf("no line of this result contains %q", phrase)
	}
	if kept.retrieved {
		return tools.Wrap("lines of a kept result", "result:find", strings.TrimRight(b.String(), "\n"))
	}
	return strings.TrimRight(b.String(), "\n")
}
