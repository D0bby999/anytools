package worksheet

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// validate.go decides whether an answer fits its kind. A request may send any
// subset of a kind's sections and fields — up's worksheets are filled over
// days — but everything it sends must fit, and nothing is silently dropped or
// cut short: the answer is refused with the field it failed on.

var (
	// ErrInvalid marks a caller mistake the API answers with 400.
	ErrInvalid = errors.New("worksheet: invalid")
	// ErrNotFound is "no such worksheet, state or document for this user".
	ErrNotFound = errors.New("worksheet: not found")
	// ErrConflict is a write carrying a revision older than the section it
	// writes: another tab or component changed it since.
	ErrConflict = errors.New("worksheet: changed since you loaded it")
	// ErrTooEarly is up's delay rule: a dated row written before its date,
	// or a review moved earlier than its anchor allows.
	ErrTooEarly = errors.New("worksheet: not yet")
	// ErrCycleClosed is a second close for one cycle (phase 10).
	ErrCycleClosed = errors.New("worksheet: this cycle already has a close")
)

// FieldError is ErrInvalid naming the field: "section", "section.field" or
// "section.field[2].column".
type FieldError struct {
	Field  string
	Reason string
}

func (e *FieldError) Error() string { return "worksheet: invalid: " + e.Field + ": " + e.Reason }

// Unwrap makes errors.Is(err, ErrInvalid) hold.
func (e *FieldError) Unwrap() error { return ErrInvalid }

func invalid(field, format string, args ...any) error {
	return &FieldError{Field: field, Reason: fmt.Sprintf(format, args...)}
}

// Validate checks the sections a request sends against the kind and returns
// them cleaned: control characters stripped, text trimmed. A field sent as
// null comes back as nil, which the merge reads as "clear it".
//
// Validate refuses unknown sections and fields (keys starting with `_` are
// the engine's and are refused too), a value of the wrong type, an option not
// in the list, a score outside 0–2, more table rows than allowed, a row that
// is not one of a fixed table's rows, and over-long text. The 200 KB bound on
// a whole worksheet is checked after the merge (Service.write).
func Validate(k *Kind, sections map[string]json.RawMessage) (map[string]map[string]any, error) {
	out := make(map[string]map[string]any, len(sections))
	for key, raw := range sections {
		s := k.section(key)
		if s == nil {
			return nil, invalid(key, "not a section of %s", k.Name)
		}
		var fields map[string]json.RawMessage
		if err := strictObject(raw, &fields); err != nil || fields == nil {
			return nil, invalid(key, "a section is an object of fields")
		}
		cleaned := make(map[string]any, len(fields))
		for name, value := range fields {
			path := key + "." + name
			var f *Field
			for i := range s.Fields {
				if s.Fields[i].Key == name {
					f = &s.Fields[i]
				}
			}
			if f == nil {
				return nil, invalid(path, "not a field of this section")
			}
			if isNull(value) {
				cleaned[name] = nil
				continue
			}
			v, err := validateValue(*f, f.Options, value, path)
			if err != nil {
				return nil, err
			}
			cleaned[name] = v
		}
		out[key] = cleaned
	}
	return out, nil
}

func validateValue(f Field, options []string, raw json.RawMessage, path string) (any, error) {
	switch f.Type {
	case Text, Long:
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return nil, invalid(path, "expected text")
		}
		max := MaxText
		if f.Type == Long {
			max = MaxLong
			if f.MaxLen > 0 {
				max = f.MaxLen
			}
		}
		return cleanText(s, max, f.Type == Text, path)
	case Choice:
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return nil, invalid(path, "expected one option")
		}
		return pickOption(s, options, f.Other, path)
	case Multi:
		var list []string
		if json.Unmarshal(raw, &list) != nil {
			return nil, invalid(path, "expected a list of options")
		}
		if len(list) > len(options)+1 {
			return nil, invalid(path, "too many options")
		}
		seen := map[string]bool{}
		out := make([]string, 0, len(list))
		for _, s := range list {
			v, err := pickOption(s, options, f.Other, path)
			if err != nil {
				return nil, err
			}
			if seen[v] {
				return nil, invalid(path, "%q chosen twice", v)
			}
			seen[v] = true
			out = append(out, v)
		}
		return out, nil
	case Score:
		var n float64
		if json.Unmarshal(raw, &n) != nil || n != math.Trunc(n) || n < 0 || n > 2 {
			return nil, invalid(path, "a score is 0, 1 or 2")
		}
		return int(n), nil
	case YesNo, Check:
		var b bool
		if json.Unmarshal(raw, &b) != nil {
			return nil, invalid(path, "expected true or false")
		}
		return b, nil
	case Date:
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return nil, invalid(path, "expected a date")
		}
		if _, err := time.Parse(time.DateOnly, s); err != nil {
			return nil, invalid(path, "a date is YYYY-MM-DD")
		}
		return s, nil
	case Table:
		return validateTable(f, raw, path)
	case Label:
		return nil, invalid(path, "this column is not written")
	case Audio:
		// The id of one of this worksheet's recordings. Only its shape is
		// checked here; that it is this worksheet's own is checked under the
		// row lock (checkRecordings), with the owner's id.
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return nil, invalid(path, "expected a recording")
		}
		id, err := uuid.Parse(s)
		if err != nil || id == uuid.Nil {
			return nil, invalid(path, "expected a recording")
		}
		return id.String(), nil
	}
	return nil, invalid(path, "unknown field type")
}

func validateTable(f Field, raw json.RawMessage, path string) (any, error) {
	var rows []json.RawMessage
	if json.Unmarshal(raw, &rows) != nil {
		return nil, invalid(path, "a table is a list of rows")
	}
	limit := f.MaxRows
	if len(f.Rows) > 0 {
		limit = len(f.Rows)
	}
	if len(rows) > limit {
		return nil, invalid(path, "at most %d rows", limit)
	}
	out := make([]TableRow, 0, len(rows))
	seen := map[string]bool{}
	for i, rawRow := range rows {
		rowPath := fmt.Sprintf("%s[%d]", path, i)
		var row struct {
			Row   string                     `json:"row"`
			Cells map[string]json.RawMessage `json:"cells"`
		}
		if err := strictObject(rawRow, &row); err != nil {
			return nil, invalid(rowPath, "a row is {row, cells}")
		}
		if len(f.Rows) > 0 {
			if !f.hasRow(row.Row) {
				return nil, invalid(rowPath, "%q is not a row of this table", row.Row)
			}
			if seen[row.Row] {
				return nil, invalid(rowPath, "row %q appears twice", row.Row)
			}
			seen[row.Row] = true
		} else if row.Row != "" {
			return nil, invalid(rowPath, "rows of this table have no label")
		}
		cells := make(map[string]any, len(row.Cells))
		for col, value := range row.Cells {
			cellPath := rowPath + "." + col
			var c *Field
			for j := range f.Columns {
				if f.Columns[j].Key == col {
					c = &f.Columns[j]
				}
			}
			if c == nil {
				return nil, invalid(cellPath, "not a column of this table")
			}
			if isNull(value) {
				continue
			}
			if !c.appliesTo(row.Row) {
				return nil, invalid(cellPath, "this column is not used on row %q", row.Row)
			}
			options := c.Options
			if opts, ok := c.RowOptions[row.Row]; ok {
				options = opts
			}
			v, err := validateValue(*c, options, value, cellPath)
			if err != nil {
				return nil, err
			}
			cells[col] = v
		}
		out = append(out, TableRow{Row: row.Row, Cells: cells})
	}
	return out, nil
}

func pickOption(s string, options []string, other bool, path string) (string, error) {
	for _, o := range options {
		if s == o {
			return s, nil
		}
	}
	if !other {
		return "", invalid(path, "%q is not one of the options", truncate(s, 40))
	}
	v, err := cleanText(s, MaxText, true, path)
	if err != nil {
		return "", err
	}
	if v == "" {
		return "", invalid(path, "an empty answer")
	}
	return v, nil
}

// cleanText strips control characters other than newline and tab (and, on a
// one-line field, those too), trims, and refuses text over max characters.
func cleanText(s string, max int, oneLine bool, path string) (string, error) {
	if !utf8.ValidString(s) {
		return "", invalid(path, "not valid UTF-8")
	}
	s = strings.Map(func(r rune) rune {
		switch {
		case r == '\n' || r == '\t':
			if oneLine {
				return ' '
			}
			return r
		case r == '\r':
			return -1
		case unicode.IsControl(r) || r == '\u2028' || r == '\u2029':
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n > max {
		return "", invalid(path, "at most %d characters (this is %d)", max, n)
	}
	return s, nil
}

// CleanTitle is a worksheet's title, cleaned: 1–200 characters on one line.
func CleanTitle(s string) (string, error) {
	t, err := cleanText(s, MaxTitle, true, "title")
	if err != nil {
		return "", err
	}
	if t == "" {
		return "", invalid("title", "a worksheet needs a title")
	}
	return t, nil
}

func strictObject(raw json.RawMessage, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func isNull(raw json.RawMessage) bool { return bytes.Equal(bytes.TrimSpace(raw), []byte("null")) }

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

// filled reports whether a stored or cleaned value says anything: not
// absent, not empty text, not an empty list, not a table of empty rows.
// false is an answer to a yes/no gate, so it counts.
func filled(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return x != ""
	case []string:
		return len(x) > 0
	case []TableRow:
		for _, r := range x {
			if len(r.Cells) > 0 {
				return true
			}
		}
		return false
	case []any:
		for _, r := range x {
			if m, ok := r.(map[string]any); ok {
				if cells, ok := m["cells"].(map[string]any); ok && len(cells) > 0 {
					return true
				}
			} else if r != nil {
				return true
			}
		}
		return false
	}
	return true
}
