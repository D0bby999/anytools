package canva

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"regexp"
	"strconv"
	"strings"
)

// docx.go — Markdown as a minimal Word document, which Canva's design
// import accepts and opens as a Canva Doc. Headings keep their level, list
// items keep a bullet or their number, code keeps a monospace face, and
// inline marks (**, *, `, links) become plain text.

var (
	inlineLink = regexp.MustCompile(`\[([^\]]*)\]\(([^)]*)\)`)
	inlineMark = strings.NewReplacer("**", "", "__", "", "`", "")
	bullet     = regexp.MustCompile(`^\s*[-*+]\s+`)
	numbered   = regexp.MustCompile(`^\s*\d+[.)]\s+`)
)

func plainInline(s string) string {
	s = inlineLink.ReplaceAllString(s, "$1")
	return inlineMark.Replace(s)
}

func xmlText(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func paragraph(style, text string, mono bool) string {
	var b strings.Builder
	b.WriteString("<w:p>")
	if style != "" {
		b.WriteString(`<w:pPr><w:pStyle w:val="` + style + `"/></w:pPr>`)
	}
	b.WriteString("<w:r>")
	if mono {
		b.WriteString(`<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr>`)
	}
	b.WriteString(`<w:t xml:space="preserve">` + xmlText(text) + "</w:t></w:r></w:p>")
	return b.String()
}

// MarkdownToDOCX renders Markdown as a .docx file's bytes.
func MarkdownToDOCX(markdown string) ([]byte, error) {
	var body strings.Builder
	inCode := false
	for _, line := range strings.Split(strings.ReplaceAll(markdown, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inCode = !inCode
			continue
		}
		switch {
		case inCode:
			body.WriteString(paragraph("", line, true))
		case trimmed == "" || strings.Trim(trimmed, "-|: ") == "" && strings.Contains(trimmed, "-"):
			continue
		case strings.HasPrefix(trimmed, "#"):
			level := len(trimmed) - len(strings.TrimLeft(trimmed, "#"))
			text := strings.TrimSpace(trimmed[level:])
			style := "Heading3"
			if level == 1 {
				style = "Heading1"
			} else if level == 2 {
				style = "Heading2"
			}
			body.WriteString(paragraph(style, plainInline(text), false))
		case bullet.MatchString(line):
			body.WriteString(paragraph("ListParagraph", "• "+plainInline(bullet.ReplaceAllString(line, "")), false))
		case numbered.MatchString(line):
			body.WriteString(paragraph("ListParagraph", plainInline(trimmed), false))
		case strings.HasPrefix(trimmed, ">"):
			body.WriteString(paragraph("Quote", plainInline(strings.TrimSpace(strings.TrimPrefix(trimmed, ">"))), false))
		case strings.HasPrefix(trimmed, "|"):
			cells := strings.Split(strings.Trim(trimmed, "|"), "|")
			for i := range cells {
				cells[i] = strings.TrimSpace(plainInline(cells[i]))
			}
			body.WriteString(paragraph("", strings.Join(cells, "  ·  "), false))
		default:
			body.WriteString(paragraph("", plainInline(trimmed), false))
		}
	}

	files := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
		"word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
			style("Heading1", "heading 1", 36) + style("Heading2", "heading 2", 30) + style("Heading3", "heading 3", 26) +
			`<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="360"/></w:pPr></w:style>` +
			`<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:i/></w:rPr></w:style></w:styles>`,
		"word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` + body.String() + `</w:body></w:document>`,
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range []string{"[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/styles.xml", "word/document.xml"} {
		f, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := f.Write([]byte(files[name])); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func style(id, name string, halfPoints int) string {
	size := strconv.Itoa(halfPoints)
	return `<w:style w:type="paragraph" w:styleId="` + id + `"><w:name w:val="` + name + `"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="` + size + `"/></w:rPr></w:style>`
}
