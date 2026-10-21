// Package mathcheck marks a maths answer by its value
// (the private design notes, phase 2).
//
// "2(x+1)", "2x + 2" and "\frac{4x+4}{2}" are one answer; asking a model to
// say so costs the learner a call and is sometimes wrong. Two expressions are
// compared by evaluating both at the same sample points, as Khan Academy's
// Perseus does (MIT; the behaviour is followed, the code is ours). Anything
// the parser does not read is never marked wrong: the caller asks the learner
// or the model instead.
//
// The notation read is what people type and what MathLive writes: numbers
// (with a decimal point or a decimal comma), single-letter variables with
// implicit multiplication (2x, 3ab), + - * / ^, brackets, percentages, the
// functions below, π, and a LaTeX subset (\frac, \sqrt, \cdot, \times, \left,
// \right, \pi, \sin …). Out of scope (owner decision 3): units, matrices,
// intervals and solution sets, inequalities, proofs.
package mathcheck

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// ErrUnreadable is any input the parser does not read as one expression or
// one equation.
var ErrUnreadable = errors.New("mathcheck: not readable as maths")

type nodeKind int

const (
	nNum nodeKind = iota
	nVar
	nNeg
	nAdd
	nSub
	nMul
	nDiv
	nPow
	nFunc
	nEq
)

// Node is a parsed expression.
type Node struct {
	kind nodeKind
	num  float64
	name string // a variable's or a function's
	a, b *Node
}

// Parsed is one input: its tree, and what it was written with.
type Parsed struct {
	Root *Node
	// Operators reports an operator, an equals sign, a function or a LaTeX
	// command: what makes a string look like maths rather than a word.
	Operators bool
	Digits    bool
}

var functions = map[string]bool{
	"sin": true, "cos": true, "tan": true, "cot": true, "sec": true, "csc": true,
	"arcsin": true, "arccos": true, "arctan": true, "asin": true, "acos": true, "atan": true,
	"sinh": true, "cosh": true, "tanh": true,
	"ln": true, "log": true, "exp": true, "sqrt": true, "abs": true,
}

// stopWords are short words of the four interface languages that would
// otherwise read as products of variables ("on" as o·n).
var stopWords = map[string]bool{
	"an": true, "and": true, "are": true, "as": true, "at": true, "be": true, "by": true, "do": true,
	"for": true, "if": true, "in": true, "is": true, "it": true, "no": true, "not": true, "of": true,
	"off": true, "on": true, "or": true, "so": true, "the": true, "to": true, "up": true, "yes": true,
	"la": true, "el": true, "de": true, "un": true, "en": true, "que": true, "los": true, "las": true,
	"da": true, "um": true, "com": true, "sim": true, "nao": true, "va": true, "co": true, "cm": true,
	"km": true, "kg": true, "mm": true, "ml": true,
}

var (
	thousands    = regexp.MustCompile(`^[1-9]\d{0,2}(,\d{3})+$`)
	decimalComma = regexp.MustCompile(`(\d),(\d)`)
	latexSpaces  = regexp.MustCompile(`\\[,;:! ]|\\quad|\\qquad`)
	// MathLive's ASCII for \sqrt[n]{x}: root(n)(x).
	asciiRoot = regexp.MustCompile(`root\(([^()]+)\)\(([^()]+)\)`)
	// 1\frac{1}{2} and MathLive's 1(1)/(2): a whole number and a fraction of
	// numbers written against it is a mixed number, 1½.
	mixedLatex = regexp.MustCompile(`(^|[^\w.^_])(\d+)\s*\\frac\{(\d+)\}\{(\d+)\}`)
	mixedASCII = regexp.MustCompile(`(^|[^\w.)^_])(\d+)\((\d+)\)/\((\d+)\)`)
)

// Parse reads one expression or one equation.
func Parse(s string) (*Parsed, error) {
	s = normalize(s)
	if s == "" {
		return nil, ErrUnreadable
	}
	toks, err := tokenize(s)
	if err != nil {
		return nil, err
	}
	p := &parser{toks: toks}
	root, err := p.equation()
	if err != nil {
		return nil, err
	}
	if p.pos != len(p.toks) {
		return nil, ErrUnreadable
	}
	out := &Parsed{Root: root}
	for _, t := range toks {
		switch t.kind {
		case tOp, tEq, tFunc, tFrac, tSqrt, tBar:
			if !(t.kind == tOp && t.text == "-" && t.unaryOnly) {
				out.Operators = true
			}
		case tNum:
			out.Digits = true
		}
	}
	return out, nil
}

// stripDelimiters takes off $…$, $$…$$, \(…\) and \[…\].
func stripDelimiters(s string) string {
	s = strings.TrimSpace(s)
	for _, pair := range [][2]string{{"$$", "$$"}, {"$", "$"}, {`\(`, `\)`}, {`\[`, `\]`}} {
		if strings.HasPrefix(s, pair[0]) && strings.HasSuffix(s, pair[1]) && len(s) >= len(pair[0])+len(pair[1]) {
			s = strings.TrimSpace(s[len(pair[0]) : len(s)-len(pair[1])])
		}
	}
	return s
}

// normalize strips math delimiters and spells symbols one way.
func normalize(s string) string {
	s = strings.TrimSuffix(stripDelimiters(s), ".")
	s = latexSpaces.ReplaceAllString(s, " ")
	s = asciiRoot.ReplaceAllString(s, "(($2)^(1/($1)))")
	s = mixedLatex.ReplaceAllString(s, "$1($2+$3/$4)")
	s = mixedASCII.ReplaceAllString(s, "$1($2+$3/$4)")
	r := strings.NewReplacer(
		`\left`, "", `\right`, "", `\cdot`, "*", `\times`, "*", `\div`, "/", `\dfrac`, `\frac`, `\tfrac`, `\frac`,
		`\mathrm`, "", `\displaystyle`, "",
		"×", "*", "·", "*", "⋅", "*", "÷", "/", "-:", "/", "−", "-", "–", "-", "√", "sqrt", "π", " pi ",
		"²", "^2", "³", "^3", "**", "^",
	)
	s = r.Replace(s)
	if thousands.MatchString(s) {
		s = strings.ReplaceAll(s, ",", "")
	}
	// A comma between digits is a decimal comma (1,5 = 1.5): a list of
	// values is out of scope, so a comma has no other use here.
	s = decimalComma.ReplaceAllString(s, "$1.$2")
	return strings.TrimSpace(s)
}

type tokKind int

const (
	tNum tokKind = iota
	tVar
	tFunc
	tOp // + - * / ^ %
	tEq
	tOpen
	tClose
	tBar
	tFrac
	tSqrt
	tUnder // _ of \log_2
)

type token struct {
	kind tokKind
	text string
	num  float64
	// unaryOnly marks a leading minus, which a negative number has without
	// being an expression.
	unaryOnly bool
}

func tokenize(s string) ([]token, error) {
	var out []token
	rs := []rune(s)
	for i := 0; i < len(rs); {
		c := rs[i]
		switch {
		case unicode.IsSpace(c):
			i++
		case c >= '0' && c <= '9' || c == '.' && i+1 < len(rs) && rs[i+1] >= '0' && rs[i+1] <= '9':
			j := i
			dot := false
			for j < len(rs) && (rs[j] >= '0' && rs[j] <= '9' || rs[j] == '.' && !dot) {
				if rs[j] == '.' {
					dot = true
				}
				j++
			}
			var v float64
			if _, err := fmt.Sscan(string(rs[i:j]), &v); err != nil {
				return nil, ErrUnreadable
			}
			out = append(out, token{kind: tNum, text: string(rs[i:j]), num: v})
			i = j
		case c == '\\':
			j := i + 1
			for j < len(rs) && unicode.IsLetter(rs[j]) && rs[j] < unicode.MaxASCII {
				j++
			}
			cmd := string(rs[i+1 : j])
			switch {
			case cmd == "frac":
				out = append(out, token{kind: tFrac, text: `\frac`})
			case cmd == "sqrt":
				out = append(out, token{kind: tSqrt, text: `\sqrt`})
			case cmd == "pi":
				out = append(out, token{kind: tVar, text: "pi"})
			case functions[cmd]:
				out = append(out, token{kind: tFunc, text: cmd})
			case cmd == "operatorname":
				// \operatorname{abs} is the function's name in braces.
				k := j
				if k < len(rs) && rs[k] == '{' {
					end := runeIndex(rs[k:], '}')
					if end > 0 && functions[string(rs[k+1:k+end])] {
						out = append(out, token{kind: tFunc, text: string(rs[k+1 : k+end])})
						j = k + end + 1
						break
					}
				}
				return nil, ErrUnreadable
			default:
				return nil, ErrUnreadable
			}
			i = j
		case c < unicode.MaxASCII && unicode.IsLetter(c):
			j := i
			for j < len(rs) && rs[j] < unicode.MaxASCII && unicode.IsLetter(rs[j]) {
				j++
			}
			word := string(rs[i:j])
			lower := strings.ToLower(word)
			switch {
			case functions[lower]:
				out = append(out, token{kind: tFunc, text: lower})
			case lower == "pi":
				out = append(out, token{kind: tVar, text: "pi"})
			case len(word) == 1:
				out = append(out, token{kind: tVar, text: word})
			case len(word) <= 3 && !stopWords[lower]:
				// 3ab is 3·a·b.
				for _, r := range word {
					out = append(out, token{kind: tVar, text: string(r)})
				}
			default:
				return nil, ErrUnreadable
			}
			i = j
			// x_1, x_{12}: a subscript is part of the variable's name.
			if i < len(rs) && rs[i] == '_' && len(out) > 0 && out[len(out)-1].kind == tVar {
				k := i + 1
				var sub string
				if k < len(rs) && (rs[k] == '{' || rs[k] == '(') {
					// x_{12}, and MathLive's x_(12)
					end := runeIndex(rs[k:], map[rune]rune{'{': '}', '(': ')'}[rs[k]])
					if end < 0 {
						return nil, ErrUnreadable
					}
					sub = string(rs[k+1 : k+end])
					k += end + 1
				} else if k < len(rs) && (unicode.IsLetter(rs[k]) || unicode.IsDigit(rs[k])) {
					sub = string(rs[k])
					k++
				}
				if sub == "" {
					return nil, ErrUnreadable
				}
				out[len(out)-1].text += "_" + sub
				i = k
			}
		case strings.ContainsRune("+-*/^%", c):
			out = append(out, token{kind: tOp, text: string(c)})
			i++
		case c == '=':
			out = append(out, token{kind: tEq, text: "="})
			i++
		case c == '(' || c == '[' || c == '{':
			out = append(out, token{kind: tOpen, text: string(c)})
			i++
		case c == ')' || c == ']' || c == '}':
			out = append(out, token{kind: tClose, text: string(c)})
			i++
		case c == '|':
			out = append(out, token{kind: tBar, text: "|"})
			i++
		case c == '_':
			out = append(out, token{kind: tUnder, text: "_"})
			i++
		default:
			return nil, ErrUnreadable
		}
	}
	// A minus with nothing before it is a sign, not an operation.
	if len(out) > 0 && out[0].kind == tOp && out[0].text == "-" {
		out[0].unaryOnly = true
	}
	return out, nil
}

type parser struct {
	toks []token
	pos  int
	// inBars counts the |…| being read, so a closing bar is not read as the
	// start of an implicit factor.
	inBars int
}

func (p *parser) peek() *token {
	if p.pos < len(p.toks) {
		return &p.toks[p.pos]
	}
	return nil
}

func (p *parser) eat(kind tokKind, text string) bool {
	if t := p.peek(); t != nil && t.kind == kind && (text == "" || t.text == text) {
		p.pos++
		return true
	}
	return false
}

func (p *parser) equation() (*Node, error) {
	lhs, err := p.sum()
	if err != nil {
		return nil, err
	}
	if !p.eat(tEq, "") {
		return lhs, nil
	}
	rhs, err := p.sum()
	if err != nil {
		return nil, err
	}
	if t := p.peek(); t != nil && t.kind == tEq {
		return nil, ErrUnreadable
	}
	return &Node{kind: nEq, a: lhs, b: rhs}, nil
}

func (p *parser) sum() (*Node, error) {
	left, err := p.product()
	if err != nil {
		return nil, err
	}
	for {
		switch {
		case p.eat(tOp, "+"):
			right, err := p.product()
			if err != nil {
				return nil, err
			}
			left = &Node{kind: nAdd, a: left, b: right}
		case p.eat(tOp, "-"):
			right, err := p.product()
			if err != nil {
				return nil, err
			}
			left = &Node{kind: nSub, a: left, b: right}
		default:
			return left, nil
		}
	}
}

func (p *parser) product() (*Node, error) {
	left, err := p.unary()
	if err != nil {
		return nil, err
	}
	for {
		switch {
		case p.eat(tOp, "*"):
			right, err := p.unary()
			if err != nil {
				return nil, err
			}
			left = &Node{kind: nMul, a: left, b: right}
		case p.eat(tOp, "/"):
			right, err := p.unary()
			if err != nil {
				return nil, err
			}
			left = &Node{kind: nDiv, a: left, b: right}
		case p.startsFactor():
			// Implicit multiplication: 2x, 2(x+1), (a+b)(a-b), x sqrt(2).
			if t := p.peek(); t.kind == tNum && endsInNumber(left) {
				return nil, ErrUnreadable
			}
			right, err := p.power()
			if err != nil {
				return nil, err
			}
			left = &Node{kind: nMul, a: left, b: right}
		default:
			return left, nil
		}
	}
}

func endsInNumber(n *Node) bool {
	for n.kind == nMul {
		n = n.b
	}
	return n.kind == nNum
}

func (p *parser) startsFactor() bool {
	t := p.peek()
	if t == nil {
		return false
	}
	switch t.kind {
	case tNum, tVar, tFunc, tOpen, tFrac, tSqrt:
		return true
	case tBar:
		return p.inBars == 0
	}
	return false
}

func (p *parser) unary() (*Node, error) {
	if p.eat(tOp, "-") {
		x, err := p.unary()
		if err != nil {
			return nil, err
		}
		return &Node{kind: nNeg, a: x}, nil
	}
	if p.eat(tOp, "+") {
		return p.unary()
	}
	return p.power()
}

func (p *parser) power() (*Node, error) {
	base, err := p.postfix()
	if err != nil {
		return nil, err
	}
	if p.eat(tOp, "^") {
		exp, err := p.unary() // x^-1, and 2^3^2 = 2^(3^2)
		if err != nil {
			return nil, err
		}
		return &Node{kind: nPow, a: base, b: exp}, nil
	}
	return base, nil
}

func (p *parser) postfix() (*Node, error) {
	x, err := p.primary()
	if err != nil {
		return nil, err
	}
	for p.eat(tOp, "%") {
		x = &Node{kind: nDiv, a: x, b: &Node{kind: nNum, num: 100}}
	}
	return x, nil
}

func closing(open string) string {
	switch open {
	case "(":
		return ")"
	case "[":
		return "]"
	}
	return "}"
}

// group reads ( … ), [ … ] or { … }.
func (p *parser) group() (*Node, error) {
	t := p.peek()
	if t == nil || t.kind != tOpen {
		return nil, ErrUnreadable
	}
	open := t.text
	p.pos++
	x, err := p.sum()
	if err != nil {
		return nil, err
	}
	if !p.eat(tClose, closing(open)) {
		return nil, ErrUnreadable
	}
	return x, nil
}

func (p *parser) primary() (*Node, error) {
	t := p.peek()
	if t == nil {
		return nil, ErrUnreadable
	}
	switch t.kind {
	case tNum:
		p.pos++
		return &Node{kind: nNum, num: t.num}, nil
	case tVar:
		p.pos++
		return &Node{kind: nVar, name: t.text}, nil
	case tOpen:
		return p.group()
	case tBar:
		p.pos++
		p.inBars++
		x, err := p.sum()
		p.inBars--
		if err != nil {
			return nil, err
		}
		if !p.eat(tBar, "") {
			return nil, ErrUnreadable
		}
		return &Node{kind: nFunc, name: "abs", a: x}, nil
	case tFrac:
		p.pos++
		num, err := p.group()
		if err != nil {
			return nil, err
		}
		den, err := p.group()
		if err != nil {
			return nil, err
		}
		return &Node{kind: nDiv, a: num, b: den}, nil
	case tSqrt:
		p.pos++
		// \sqrt[3]{x} is a cube root.
		if q := p.peek(); q != nil && q.kind == tOpen && q.text == "[" {
			n, err := p.group()
			if err != nil {
				return nil, err
			}
			x, err := p.group()
			if err != nil {
				return nil, err
			}
			return &Node{kind: nPow, a: x, b: &Node{kind: nDiv, a: &Node{kind: nNum, num: 1}, b: n}}, nil
		}
		x, err := p.group()
		if err != nil {
			return nil, err
		}
		return &Node{kind: nFunc, name: "sqrt", a: x}, nil
	case tFunc:
		p.pos++
		name := t.text
		var base *Node
		// \log_2 x, log_{10}(x)
		if name == "log" && p.eat(tUnder, "") {
			b, err := p.subscript()
			if err != nil {
				return nil, err
			}
			base = b
		}
		// sin^2 x is (sin x)^2.
		var power *Node
		if p.eat(tOp, "^") {
			e, err := p.primary()
			if err != nil {
				return nil, err
			}
			power = e
		}
		var arg *Node
		var err error
		if q := p.peek(); q != nil && q.kind == tOpen {
			arg, err = p.group()
		} else {
			// sin x, sqrt 2, and sin 2x as sin(2x): a bracketless argument
			// is a number and the variables written against it.
			arg, err = p.power()
			for err == nil {
				if q := p.peek(); q == nil || q.kind != tVar {
					break
				}
				var v *Node
				if v, err = p.power(); err == nil {
					arg = &Node{kind: nMul, a: arg, b: v}
				}
			}
		}
		if err != nil {
			return nil, err
		}
		x := &Node{kind: nFunc, name: name, a: arg}
		if base != nil {
			x = &Node{kind: nDiv, a: &Node{kind: nFunc, name: "ln", a: arg}, b: &Node{kind: nFunc, name: "ln", a: base}}
		}
		if power != nil {
			x = &Node{kind: nPow, a: x, b: power}
		}
		return x, nil
	}
	return nil, ErrUnreadable
}

func (p *parser) subscript() (*Node, error) {
	t := p.peek()
	if t == nil {
		return nil, ErrUnreadable
	}
	if t.kind == tOpen {
		return p.group()
	}
	if t.kind == tNum || t.kind == tVar {
		p.pos++
		if t.kind == tNum {
			return &Node{kind: nNum, num: t.num}, nil
		}
		return &Node{kind: nVar, name: t.text}, nil
	}
	return nil, ErrUnreadable
}

// runeIndex is strings.IndexRune counted in runes.
func runeIndex(rs []rune, r rune) int {
	for i, c := range rs {
		if c == r {
			return i
		}
	}
	return -1
}
