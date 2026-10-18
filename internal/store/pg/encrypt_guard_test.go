package pg

import (
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

// Phase 11: every write of a secret goes through encryptOrFail.
//
// encryptOrFail is the only function that refuses to store a secret it could
// not encrypt (a missing key used to mean "store it in the clear"). A new store
// method that writes `token_enc = $2` with a value it encrypted some other way —
// or not at all — would pass every behavioural test that only reads the value
// back through the same store. So this reads the SOURCE: for each function in
// the module that contains an INSERT or UPDATE naming a `*_enc` column, the
// same function must call encryptOrFail with the label "<table>.<column>" for
// that column. Clearing a column (`x_enc = ''`) writes no secret and is allowed.

var (
	writeStatement = regexp.MustCompile(`(?is)\b(INSERT\s+INTO|UPDATE)\s+(\w+)`)
	encColumn      = regexp.MustCompile(`\b(\w+_enc)\b`)
	clearedColumn  = regexp.MustCompile(`\b(\w+_enc)\s*=\s*''`)
)

func TestEverySecretWriteGoesThroughEncryptOrFail(t *testing.T) {
	root := "../../.." // module root, from internal/store/pg
	fset := token.NewFileSet()
	checked := 0

	err := filepath.WalkDir(filepath.Join(root, "internal"), func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			written := map[string]bool{} // "table.column"
			labels := map[string]bool{}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.BasicLit:
					if x.Kind != token.STRING {
						return true
					}
					sql, err := strconv.Unquote(x.Value)
					if err != nil {
						return true
					}
					m := writeStatement.FindStringSubmatch(sql)
					if m == nil {
						return true
					}
					cleared := map[string]bool{}
					for _, c := range clearedColumn.FindAllStringSubmatch(sql, -1) {
						cleared[c[1]] = true
					}
					for _, c := range encColumn.FindAllStringSubmatch(sql, -1) {
						if !cleared[c[1]] {
							written[strings.ToLower(m[2])+"."+c[1]] = true
						}
					}
				case *ast.CallExpr:
					if id, ok := x.Fun.(*ast.Ident); ok && id.Name == "encryptOrFail" && len(x.Args) == 3 {
						if lit, ok := x.Args[2].(*ast.BasicLit); ok {
							if label, err := strconv.Unquote(lit.Value); err == nil {
								labels[label] = true
							}
						}
					}
				}
				return true
			})
			for col := range written {
				checked++
				if !labels[col] {
					t.Errorf("%s: %s writes %s without encryptOrFail(…, %q)",
						fset.Position(fn.Pos()), fn.Name.Name, col, col)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// A guard that finds nothing to check is a guard whose regex broke.
	if checked < 5 {
		t.Fatalf("found only %d secret writes; the scan is not seeing the stores", checked)
	}
}
