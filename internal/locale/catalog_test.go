package locale

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// sentenceFunc names the functions whose returned strings are sentences a
// learner reads (byok.UserMessage, stt.Explain, drive's userFacing*Error…).
var sentenceFunc = regexp.MustCompile(`(?i)(userfacing|usermessage|errormessage|reason$|sentence$|^ruleOf$|^explain$|failurenote|^trimErr$|^shortErr$)`)

// failureCalls store a failure sentence on a row the learner later reads.
var failureCalls = map[string]bool{"failDocument": true, "FailTemplate": true, "FailBlock": true, "SetEntryFailed": true}

// notSentences are strings the rules find that no learner reads as a
// sentence: bare verbs, fragments of a log line, codes.
var notSentences = map[string]bool{
	"%d (supported: %v)": true, "%q": true, "%s": true, "%s -> %s": true, "%s reply: %s": true,
	"%s sniffed as %s": true, "%v": true, "%w": true, "no duration": true, "photo %d": true,
	"photo set: %s": true, "provider %q": true, "quota": true, "rate_limit": true,
	"redirect to %s": true, "want %d, got %d": true, "%d parts": true, "%d entries": true,
	// A 401's body, which the web answers by signing out, never by showing it.
	"unauthorized": true,
}

// sentences finds the English the API can send a learner, by rule:
// httpx.WriteError's message, a "%w: …" wrap's text (the part a handler
// trims and sends), a failure stored for the learner, a Message/Msg field,
// and what the sentence functions return.
func sentences(t *testing.T) map[string]string {
	t.Helper()
	root := filepath.Join("..")
	found := map[string]string{}
	add := func(s, where string) {
		s = strings.TrimSpace(s)
		if s == "" || notSentences[s] || !strings.ContainsAny(s, "abcdefghijklmnopqrstuvwxyz") {
			return
		}
		if _, ok := found[s]; !ok {
			found[s] = where
		}
	}
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		at := func(n ast.Node) string { return fmt.Sprintf("%s:%d", path, fset.Position(n.Pos()).Line) }
		for _, decl := range f.Decls {
			fd, ok := decl.(*ast.FuncDecl)
			if !ok || fd.Body == nil || !sentenceFunc.MatchString(fd.Name.Name) {
				continue
			}
			ast.Inspect(fd.Body, func(n ast.Node) bool {
				r, ok := n.(*ast.ReturnStmt)
				if !ok || len(r.Results) == 0 {
					return true
				}
				e := r.Results[0]
				if c, ok := e.(*ast.CallExpr); ok && callee(c.Fun) == "Sprintf" && len(c.Args) > 0 {
					e = c.Args[0]
				}
				if s, ok := literal(e); ok {
					add(s, at(r))
				}
				return true
			})
		}
		ast.Inspect(f, func(n ast.Node) bool {
			if kv, ok := n.(*ast.KeyValueExpr); ok {
				if k, ok := kv.Key.(*ast.Ident); ok && (k.Name == "Message" || k.Name == "Msg") {
					if s, ok := literal(kv.Value); ok {
						add(s, at(kv))
					}
				}
				return true
			}
			c, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			switch fn := callee(c.Fun); {
			case fn == "WriteError" && len(c.Args) >= 3:
				if s, ok := literal(c.Args[2]); ok {
					add(s, at(c))
				}
			case fn == "Errorf" && len(c.Args) >= 2:
				if s, ok := literal(c.Args[0]); ok && strings.HasPrefix(s, "%w: ") {
					add(strings.TrimPrefix(s, "%w: "), at(c))
				}
			case failureCalls[fn]:
				for _, a := range c.Args {
					if s, ok := literal(a); ok {
						add(s, at(c))
					}
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

func literal(e ast.Expr) (string, bool) {
	switch v := e.(type) {
	case *ast.BasicLit:
		if v.Kind == token.STRING {
			s, err := strconv.Unquote(v.Value)
			return s, err == nil
		}
	case *ast.BinaryExpr:
		if v.Op == token.ADD {
			a, ok1 := literal(v.X)
			b, ok2 := literal(v.Y)
			return a + b, ok1 && ok2
		}
	}
	return "", false
}

func callee(e ast.Expr) string {
	switch v := e.(type) {
	case *ast.Ident:
		return v.Name
	case *ast.SelectorExpr:
		return v.Sel.Name
	}
	return ""
}

// A sentence the API can send has a translation in every catalog, with the
// same verbs: a missing one would reach a Vietnamese learner in English, a
// dropped verb would lose the number it carried.
func TestEverySentenceIsTranslated(t *testing.T) {
	found := sentences(t)
	if len(found) < 300 {
		t.Fatalf("found %d sentences; the extraction rules have stopped matching the code", len(found))
	}
	for _, lang := range Languages[1:] {
		entries := raw(t, lang)
		missing := 0
		for s, where := range found {
			tr, ok := entries[s]
			if !ok {
				missing++
				if missing <= 20 {
					t.Errorf("%s: no translation for %q (%s)", lang, s, where)
				}
				continue
			}
			if Verbs(tr) != Verbs(s) {
				t.Errorf("%s: %q has %d verbs, its translation %q has %d", lang, s, Verbs(s), tr, Verbs(tr))
			}
		}
		if missing > 20 {
			t.Errorf("%s: %d more sentences untranslated", lang, missing-20)
		}
	}
}

// A catalog key is a sentence, never a code: the middleware translates every
// "error" value, and `"error": "drive_full"` is a code the web matches on.
func TestCatalogHoldsSentencesNotCodes(t *testing.T) {
	code := regexp.MustCompile(`^[a-z0-9_]+$`)
	for _, lang := range Languages[1:] {
		for en, tr := range raw(t, lang) {
			if code.MatchString(en) {
				t.Errorf("%s: catalog key %q is a code", lang, en)
			}
			if strings.TrimSpace(tr) == "" {
				t.Errorf("%s: %q translates to nothing", lang, en)
			}
		}
	}
}
