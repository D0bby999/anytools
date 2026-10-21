package mathcheck

import (
	"errors"
	"regexp"
	"strings"
)

// Answers written in brackets (an extension of the private design notes, phase 2): intervals and their unions, inequalities
// in one variable (read as intervals), sets, tuples, vectors and matrices.
// Each is compared part by part, every part by value.
//
//   - An interval is two parts in ( or [ : its brackets count, except at an
//     infinite end. ]2;5] and [2;5[ are the French way of writing (2,5] and
//     [2,5). A union is compared in any order.
//   - A set is in braces, compared in any order. One with a single element
//     ({5}) is left to the model: braces also group in LaTeX.
//   - Anything else in brackets is a tuple, a vector or a matrix: same shape,
//     parts in order, ( and [ alike.
//
// Parts are separated by commas, or by semicolons when there are any, and
// then a comma between digits is a decimal comma: (1,5; 3] is (1.5, 3].

var errNotStructure = errors.New("mathcheck: not a bracketed answer")

type part struct {
	node *Node
	inf  int // -1 or +1 for an infinite end
	sub  *group
}

type group struct {
	open, close rune // ( [ {  and  ) ] }
	parts       []part
}

// structure is one group or a union of groups.
type structure struct{ groups []group }

var (
	matrixEnv  = regexp.MustCompile(`\\begin\{[pb]?matrix\}(.*?)\\end\{[pb]?matrix\}`)
	unionU     = regexp.MustCompile(`([)\]\[])\s*U\s*([(\[\]])`)
	setPrefix  = regexp.MustCompile(`^[A-Za-z](?:_\{?\w+\}?)?\s*(?:in|=)\s*`)
	comparison = regexp.MustCompile(`<=|>=|<|>`)
	oneVar     = regexp.MustCompile(`^[A-Za-z](?:_\{?\w+\}?)?$`)
)

// normalizeStructure spells brackets, infinity, union and comparisons one way.
func normalizeStructure(s string) string {
	s = strings.TrimSuffix(stripDelimiters(s), ".")
	s = latexSpaces.ReplaceAllString(s, " ")
	s = matrixEnv.ReplaceAllStringFunc(s, func(m string) string {
		body := matrixEnv.FindStringSubmatch(m)[1]
		var rows []string
		for _, row := range strings.Split(body, `\\`) {
			if strings.TrimSpace(row) != "" {
				rows = append(rows, "["+strings.Join(strings.Split(row, "&"), ";")+"]")
			}
		}
		return "[" + strings.Join(rows, ";") + "]"
	})
	s = strings.NewReplacer(
		`\left`, "", `\right`, "", `\lbrack`, "[", `\rbrack`, "]", `\lbrace`, "{", `\rbrace`, "}",
		`\{`, "{", `\}`, "}", `\infty`, "oo", "∞", "oo", "+oo", "oo",
		`\cup`, "∪", `\emptyset`, "∅", `\varnothing`, "∅", "O/", "∅",
		`\mathbb{R}`, "ℝ", "RR", "ℝ",
		`\leq`, "<=", `\le`, "<=", `\geq`, ">=", `\ge`, ">=", `\lt`, "<", `\gt`, ">",
		"≤", "<=", "≥", ">=", `\in`, " in ", "∈", " in ", "−", "-", "–", "-",
	).Replace(s)
	s = unionU.ReplaceAllString(s, "$1∪$2")
	return strings.TrimSpace(s)
}

// parseStructure reads a bracketed answer, or says it is not one.
func parseStructure(raw string) (*structure, error) {
	s := normalizeStructure(raw)
	if rest := setPrefix.ReplaceAllString(s, ""); rest != s && rest != "" && strings.ContainsRune("([{]∅ℝ", []rune(rest)[0]) {
		s = rest
	}
	switch s {
	case "":
		return nil, errNotStructure
	case "ℝ":
		return &structure{groups: []group{{open: '(', close: ')', parts: []part{{inf: -1}, {inf: 1}}}}}, nil
	case "∅", "{}":
		return &structure{groups: []group{{open: '{', close: '}'}}}, nil
	}
	if comparison.MatchString(s) {
		g, err := inequality(s)
		if err != nil {
			return nil, err
		}
		return &structure{groups: []group{g}}, nil
	}
	out := &structure{}
	for _, piece := range strings.Split(s, "∪") {
		g, err := parseGroup(strings.TrimSpace(piece))
		if err != nil {
			return nil, err
		}
		if len(out.groups) > 0 && !isInterval(g) && g.open != '{' {
			return nil, errNotStructure // a union is of intervals or sets
		}
		out.groups = append(out.groups, *g)
	}
	if len(out.groups) > 1 && !isInterval(&out.groups[0]) && out.groups[0].open != '{' {
		return nil, errNotStructure
	}
	return out, nil
}

func parseGroup(s string) (*group, error) {
	rs := []rune(s)
	if len(rs) < 2 {
		return nil, errNotStructure
	}
	open, close := rs[0], rs[len(rs)-1]
	switch open {
	case '(', '[', '{':
	case ']':
		open = '(' // ]2;5] is (2,5]
	default:
		return nil, errNotStructure
	}
	switch close {
	case ')', ']', '}':
	case '[':
		close = ')' // [2;5[ is [2,5)
	default:
		return nil, errNotStructure
	}
	if (open == '{') != (close == '}') {
		return nil, errNotStructure
	}
	inner := string(rs[1 : len(rs)-1])
	sep := ','
	if strings.ContainsRune(topLevel(inner), ';') {
		sep = ';'
	}
	items, ok := splitTop(inner, sep)
	if !ok {
		return nil, errNotStructure
	}
	g := &group{open: open, close: close}
	for _, item := range items {
		item = strings.TrimSpace(item)
		p, err := parsePart(item)
		if err != nil {
			return nil, err
		}
		g.parts = append(g.parts, p)
	}
	// One part in brackets is a grouped expression, or a one-row matrix
	// (its one part a row); one element in braces is left to the model.
	if len(g.parts) < 2 && (g.parts[0].sub == nil || open == '{') {
		return nil, errNotStructure
	}
	return g, nil
}

func parsePart(item string) (part, error) {
	switch strings.ReplaceAll(item, " ", "") {
	case "":
		return part{}, errNotStructure
	case "oo", "+oo":
		return part{inf: 1}, nil
	case "-oo":
		return part{inf: -1}, nil
	}
	if strings.ContainsRune("([{]", []rune(item)[0]) {
		if g, err := parseGroup(item); err == nil {
			return part{sub: g}, nil
		}
	}
	p, err := Parse(item)
	if err != nil || p.Root.kind == nEq {
		return part{}, errNotStructure
	}
	return part{node: p.Root}, nil
}

// topLevel is s with everything inside brackets removed.
func topLevel(s string) string {
	var b strings.Builder
	depth := 0
	for _, r := range s {
		switch r {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		default:
			if depth == 0 {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

// splitTop splits s at sep outside brackets; false when the brackets do not
// balance, as in "1,2),(3,4" (two groups side by side, not one).
func splitTop(s string, sep rune) ([]string, bool) {
	var out []string
	depth, start := 0, 0
	for i, r := range s {
		switch r {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
			if depth < 0 {
				return nil, false
			}
		case sep:
			if depth == 0 {
				out = append(out, s[start:i])
				start = i + len(string(sep))
			}
		}
	}
	if depth != 0 {
		return nil, false
	}
	return append(out, s[start:]), true
}

// inequality reads x > 3, x <= 5, 2 < x <= 5 or 5 >= x > 2 as an interval.
func inequality(s string) (group, error) {
	ops := comparison.FindAllString(s, -1)
	sides := comparison.Split(s, -1)
	for i := range sides {
		sides[i] = strings.TrimSpace(sides[i])
	}
	bound := func(side string) (part, error) {
		if side == "oo" || side == "-oo" {
			return parsePart(side)
		}
		p, err := Parse(side)
		if err != nil {
			return part{}, errNotStructure
		}
		vars := map[string]bool{}
		collect(p.Root, vars)
		if len(vars) > 0 || p.Root.kind == nEq {
			return part{}, errNotStructure
		}
		return part{node: p.Root}, nil
	}
	lower, upper := part{inf: -1}, part{inf: 1}
	open, close := '(', ')'
	// set records one comparison read as "x op b".
	set := func(op string, b part) {
		switch op {
		case "<", "<=":
			upper, close = b, ')'
			if op == "<=" {
				close = ']'
			}
		default:
			lower, open = b, '('
			if op == ">=" {
				open = '['
			}
		}
	}
	flip := map[string]string{"<": ">", "<=": ">=", ">": "<", ">=": "<="}
	switch {
	case len(sides) == 2 && oneVar.MatchString(sides[0]):
		b, err := bound(sides[1])
		if err != nil {
			return group{}, err
		}
		set(ops[0], b)
	case len(sides) == 2 && oneVar.MatchString(sides[1]):
		b, err := bound(sides[0])
		if err != nil {
			return group{}, err
		}
		set(flip[ops[0]], b)
	case len(sides) == 3 && oneVar.MatchString(sides[1]) && (ops[0][0] == ops[1][0]):
		a, err := bound(sides[0])
		if err != nil {
			return group{}, err
		}
		b, err := bound(sides[2])
		if err != nil {
			return group{}, err
		}
		set(flip[ops[0]], a)
		set(ops[1], b)
	default:
		return group{}, errNotStructure
	}
	return group{open: open, close: close, parts: []part{lower, upper}}, nil
}

func flat(g *group) bool {
	for _, p := range g.parts {
		if p.sub != nil {
			return false
		}
	}
	return true
}

func symmetric(g *group) bool {
	return g.open == '(' && g.close == ')' || g.open == '[' && g.close == ']'
}

func isInterval(g *group) bool {
	return g.open != '{' && len(g.parts) == 2 && g.parts[0].sub == nil && g.parts[1].sub == nil
}

// sameStructure compares two answers; decided is false when a part's value
// could not be compared.
func sameStructure(a, b *structure) (eq, decided bool) {
	if len(a.groups) != len(b.groups) {
		return false, true
	}
	used := make([]bool, len(b.groups))
	for i := range a.groups {
		found := false
		for j := range b.groups {
			if used[j] {
				continue
			}
			eq, decided := sameGroup(&a.groups[i], &b.groups[j], false)
			if !decided {
				return false, false
			}
			if eq {
				used[j], found = true, true
				break
			}
		}
		if !found {
			return false, true
		}
	}
	return true, true
}

// sameGroup compares two groups; nested is a group inside another, a row of
// a matrix, whose brackets never count.
func sameGroup(a, b *group, nested bool) (eq, decided bool) {
	interval := !nested && isInterval(a)
	switch {
	case flat(a) && flat(b) && len(b.parts) > len(a.parts) && (a.open == '{') == (b.open == '{'):
		// (1,5, 3] for (1.5, 3]: a decimal comma read as a separator, maybe.
		return false, false
	case (a.open == '{') != (b.open == '{'), interval != (!nested && isInterval(b)):
		return false, true
	case a.open == '{':
		return sameSet(a.parts, b.parts)
	case interval:
		lo, hi := a.parts[0], a.parts[1]
		// [1, 2] and (1, 2) may be a vector written two ways, or a closed
		// and an open interval: not decided here.
		if lo.inf == 0 && hi.inf == 0 && symmetric(a) && symmetric(b) && a.open != b.open {
			return false, false
		}
		if lo.inf == 0 && a.open != b.open || hi.inf == 0 && a.close != b.close {
			return false, true
		}
	case len(a.parts) != len(b.parts):
		return false, true
	}
	for i := range a.parts {
		if eq, decided := samePart(a.parts[i], b.parts[i]); !eq || !decided {
			return eq, decided
		}
	}
	return true, true
}

// sameSet: every element of each is in the other, repeats aside.
func sameSet(a, b []part) (eq, decided bool) {
	for _, pair := range [][2][]part{{a, b}, {b, a}} {
		for _, x := range pair[0] {
			in := false
			for _, y := range pair[1] {
				eq, decided := samePart(x, y)
				if !decided {
					return false, false
				}
				if eq {
					in = true
					break
				}
			}
			if !in {
				return false, true
			}
		}
	}
	return true, true
}

func samePart(a, b part) (eq, decided bool) {
	switch {
	case a.inf != 0 || b.inf != 0:
		return a.inf == b.inf, true
	case a.sub != nil || b.sub != nil:
		if a.sub == nil || b.sub == nil {
			return false, true
		}
		return sameGroup(a.sub, b.sub, true)
	}
	return equivalent(a.node, b.node)
}
