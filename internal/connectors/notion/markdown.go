package notion

import (
	"encoding/json"
	"fmt"
	"strings"
)

// markdown.go — Notion blocks to Markdown (import) and Markdown to blocks
// (export). Only what a study note uses is mapped; an unknown block is
// skipped rather than guessed at.

// RichText is Notion's rich text array element.
type RichText struct {
	PlainText   string `json:"plain_text"`
	Href        string `json:"href"`
	Annotations struct {
		Bold   bool `json:"bold"`
		Italic bool `json:"italic"`
		Code   bool `json:"code"`
	} `json:"annotations"`
}

func richText(rt []RichText) string {
	var b strings.Builder
	for _, t := range rt {
		s := t.PlainText
		if s == "" {
			continue
		}
		switch {
		case t.Annotations.Code:
			s = "`" + s + "`"
		case t.Annotations.Bold:
			s = "**" + s + "**"
		case t.Annotations.Italic:
			s = "_" + s + "_"
		}
		if t.Href != "" {
			s = "[" + s + "](" + t.Href + ")"
		}
		b.WriteString(s)
	}
	return b.String()
}

func plain(rt []RichText) string {
	var b strings.Builder
	for _, t := range rt {
		b.WriteString(t.PlainText)
	}
	return b.String()
}

// Block is a Notion block, its type-specific body kept raw.
type Block struct {
	ID          string                     `json:"id"`
	Type        string                     `json:"type"`
	HasChildren bool                       `json:"has_children"`
	Body        map[string]json.RawMessage `json:"-"`
	Children    []Block                    `json:"-"`
}

// UnmarshalJSON keeps the type's own object.
func (b *Block) UnmarshalJSON(data []byte) error {
	var head struct {
		ID          string `json:"id"`
		Type        string `json:"type"`
		HasChildren bool   `json:"has_children"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return err
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(data, &all); err != nil {
		return err
	}
	b.ID, b.Type, b.HasChildren, b.Body = head.ID, head.Type, head.HasChildren, all
	return nil
}

type blockBody struct {
	RichText []RichText `json:"rich_text"`
	Checked  bool       `json:"checked"`
	Language string     `json:"language"`
	Title    string     `json:"title"`
	URL      string     `json:"url"`
	Caption  []RichText `json:"caption"`
	External struct {
		URL string `json:"url"`
	} `json:"external"`
	File struct {
		URL string `json:"url"`
	} `json:"file"`
	Expression string       `json:"expression"`
	Cells      [][]RichText `json:"cells"`
	Icon       struct {
		Emoji string `json:"emoji"`
	} `json:"icon"`
}

func (b Block) body() blockBody {
	var out blockBody
	_ = json.Unmarshal(b.Body[b.Type], &out)
	return out
}

// BlocksToMarkdown renders a block tree.
func BlocksToMarkdown(blocks []Block) string {
	var b strings.Builder
	render(&b, blocks, 0)
	return strings.TrimSpace(b.String()) + "\n"
}

func render(b *strings.Builder, blocks []Block, depth int) {
	indent := strings.Repeat("  ", depth)
	number := 0
	for _, blk := range blocks {
		body := blk.body()
		text := richText(body.RichText)
		if blk.Type != "numbered_list_item" {
			number = 0
		}
		nested := true
		switch blk.Type {
		case "paragraph":
			if text != "" {
				fmt.Fprintf(b, "%s%s\n\n", indent, text)
			}
		case "heading_1", "heading_2", "heading_3":
			level := int(blk.Type[len(blk.Type)-1] - '0')
			fmt.Fprintf(b, "%s %s\n\n", strings.Repeat("#", level+1), text)
		case "bulleted_list_item":
			fmt.Fprintf(b, "%s- %s\n", indent, text)
		case "numbered_list_item":
			number++
			fmt.Fprintf(b, "%s%d. %s\n", indent, number, text)
		case "to_do":
			mark := " "
			if body.Checked {
				mark = "x"
			}
			fmt.Fprintf(b, "%s- [%s] %s\n", indent, mark, text)
		case "toggle":
			fmt.Fprintf(b, "%s- %s\n", indent, text)
		case "quote":
			fmt.Fprintf(b, "%s> %s\n\n", indent, text)
		case "callout":
			fmt.Fprintf(b, "%s> %s %s\n\n", indent, body.Icon.Emoji, text)
		case "code":
			fmt.Fprintf(b, "```%s\n%s\n```\n\n", body.Language, plain(body.RichText))
		case "equation":
			fmt.Fprintf(b, "$$%s$$\n\n", body.Expression)
		case "divider":
			b.WriteString("---\n\n")
		case "child_page":
			fmt.Fprintf(b, "%s- %s\n", indent, body.Title)
			nested = false
		case "image", "file", "pdf", "video", "audio":
			u := body.External.URL
			if u == "" {
				u = body.File.URL
			}
			label := plain(body.Caption)
			if label == "" {
				label = blk.Type
			}
			if u != "" && !strings.Contains(u, "X-Amz-") {
				fmt.Fprintf(b, "%s[%s](%s)\n\n", indent, label, u)
			} else {
				fmt.Fprintf(b, "%s(%s)\n\n", indent, label)
			}
		case "bookmark", "embed", "link_preview":
			if body.URL != "" {
				fmt.Fprintf(b, "%s<%s>\n\n", indent, body.URL)
			}
		case "table":
			renderTable(b, blk.Children)
			nested = false
		default:
			nested = blk.Type == "column_list" || blk.Type == "column" || blk.Type == "synced_block"
			if nested {
				render(b, blk.Children, depth)
			}
			continue
		}
		if nested && len(blk.Children) > 0 {
			render(b, blk.Children, depth+1)
			if depth == 0 {
				b.WriteString("\n")
			}
		}
	}
}

func renderTable(b *strings.Builder, rows []Block) {
	for i, row := range rows {
		cells := row.body().Cells
		parts := make([]string, len(cells))
		for j, c := range cells {
			parts[j] = strings.ReplaceAll(richText(c), "|", "\\|")
		}
		fmt.Fprintf(b, "| %s |\n", strings.Join(parts, " | "))
		if i == 0 {
			fmt.Fprintf(b, "|%s\n", strings.Repeat(" --- |", len(cells)))
		}
	}
	b.WriteString("\n")
}

// ---- Markdown to blocks, for an export ----

func textItems(s string) []map[string]any {
	var out []map[string]any
	r := []rune(s)
	for len(r) > 0 {
		n := min(len(r), 2000)
		out = append(out, map[string]any{"type": "text", "text": map[string]string{"content": string(r[:n])}})
		r = r[n:]
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out
}

func block(kind string, body map[string]any) map[string]any {
	return map[string]any{"object": "block", "type": kind, kind: body}
}

// MarkdownToBlocks maps Markdown to Notion blocks.
func MarkdownToBlocks(md string) []map[string]any {
	var out []map[string]any
	var code []string
	inCode, lang := false, ""
	for _, line := range strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "```") {
			if inCode {
				out = append(out, block("code", map[string]any{"rich_text": textItems(strings.Join(code, "\n")), "language": notionLanguage(lang)}))
				code, inCode = nil, false
			} else {
				inCode, lang = true, strings.TrimPrefix(t, "```")
			}
			continue
		}
		if inCode {
			code = append(code, line)
			continue
		}
		switch {
		case t == "":
		case strings.HasPrefix(t, "### "), strings.HasPrefix(t, "#### "):
			out = append(out, block("heading_3", map[string]any{"rich_text": textItems(strings.TrimLeft(t, "# "))}))
		case strings.HasPrefix(t, "## "):
			out = append(out, block("heading_2", map[string]any{"rich_text": textItems(t[3:])}))
		case strings.HasPrefix(t, "# "):
			out = append(out, block("heading_1", map[string]any{"rich_text": textItems(t[2:])}))
		case strings.HasPrefix(t, "- [ ] "), strings.HasPrefix(t, "- [x] "):
			out = append(out, block("to_do", map[string]any{"rich_text": textItems(t[6:]), "checked": t[3] == 'x'}))
		case strings.HasPrefix(t, "- "), strings.HasPrefix(t, "* "):
			out = append(out, block("bulleted_list_item", map[string]any{"rich_text": textItems(t[2:])}))
		case numberedPrefix(t) > 0:
			out = append(out, block("numbered_list_item", map[string]any{"rich_text": textItems(t[numberedPrefix(t):])}))
		case strings.HasPrefix(t, "> "):
			out = append(out, block("quote", map[string]any{"rich_text": textItems(t[2:])}))
		case t == "---":
			out = append(out, block("divider", map[string]any{}))
		default:
			out = append(out, block("paragraph", map[string]any{"rich_text": textItems(t)}))
		}
	}
	if inCode {
		out = append(out, block("code", map[string]any{"rich_text": textItems(strings.Join(code, "\n")), "language": notionLanguage(lang)}))
	}
	return out
}

func numberedPrefix(t string) int {
	i := 0
	for i < len(t) && t[i] >= '0' && t[i] <= '9' {
		i++
	}
	if i > 0 && i+1 < len(t) && (t[i] == '.' || t[i] == ')') && t[i+1] == ' ' {
		return i + 2
	}
	return 0
}

// notionLanguage maps a fence's language to one Notion accepts.
func notionLanguage(l string) string {
	switch strings.ToLower(strings.TrimSpace(l)) {
	case "py", "python":
		return "python"
	case "js", "javascript":
		return "javascript"
	case "ts", "typescript":
		return "typescript"
	case "go", "golang":
		return "go"
	case "sh", "bash", "shell":
		return "shell"
	case "json":
		return "json"
	case "sql":
		return "sql"
	case "java":
		return "java"
	case "c":
		return "c"
	case "cpp", "c++":
		return "c++"
	case "html":
		return "html"
	case "css":
		return "css"
	}
	return "plain text"
}
