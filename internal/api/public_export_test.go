package api_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// anytools-merge phase 5: the public repository is made by
// scripts/export-public.sh, never by pushing this one. These tests run it.

// needExportTools skips on a laptop without gitleaks, and fails in CI, where
// test.yml installs it: a skipped export test would prove nothing about the
// repository the public sees.
// homePath is the macOS home directory prefix, spelled in two pieces so this
// file does not hold it.
const homePath = "/Us" + "ers/"

func needExportTools(t *testing.T) {
	t.Helper()
	for _, bin := range []string{"bash", "git", "gitleaks"} {
		if _, err := exec.LookPath(bin); err != nil {
			if os.Getenv("CI") != "" {
				t.Fatalf("%s is not installed; CI must install it", bin)
			}
			t.Skipf("%s is not installed", bin)
		}
	}
}

func runExport(t *testing.T, script, dest string, args ...string) (string, error) {
	t.Helper()
	cmd := exec.Command("bash", append([]string{script, dest}, args...)...)
	cmd.Env = append(os.Environ(), "ANYTOOLS_EXPORT_AUTHOR=Export Test <export@example.invalid>")
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestPublicExportIsOneCleanCommit(t *testing.T) {
	needExportTools(t)
	script, err := filepath.Abs("../../scripts/export-public.sh")
	if err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "public")
	out, err := runExport(t, script, dest)
	if err != nil {
		t.Fatalf("export failed: %v\n%s", err, out)
	}
	if !strings.Contains(out, "files containing "+homePath+": 0") {
		t.Errorf("the export did not report zero home paths:\n%s", out)
	}

	if n := gitOut(t, dest, "rev-list", "--count", "HEAD"); n != "1" {
		t.Errorf("the public repo has %s commits, want 1", n)
	}
	if who := gitOut(t, dest, "log", "-1", "--format=%an <%ae>"); who != "Export Test <export@example.invalid>" {
		t.Errorf("the commit's author is %q, not ANYTOOLS_EXPORT_AUTHOR", who)
	}
	if st := gitOut(t, dest, "status", "--porcelain"); st != "" {
		t.Errorf("the export left files outside its commit:\n%s", st)
	}

	files := strings.Split(gitOut(t, dest, "ls-files"), "\n")
	if len(files) < 500 {
		t.Fatalf("the export holds %d files; it would pass on nothing", len(files))
	}
	for _, f := range files {
		for _, private := range []string{"plans/", ".claude/", "spikes/", ".design-world/"} {
			if strings.HasPrefix(f, private) {
				t.Errorf("the export holds %s", f)
			}
		}
		if b, err := os.ReadFile(filepath.Join(dest, f)); err == nil && strings.Contains(string(b), homePath) {
			t.Errorf("%s holds a home path", f)
		}
	}
	for _, want := range []string{"LICENSE", "README.md", "THIRD-PARTY-NOTICES.md", "CONTRIBUTING.md", "SECURITY.md", "go.mod", "ui/web/package.json"} {
		if _, err := os.Stat(filepath.Join(dest, want)); err != nil {
			t.Errorf("the export lacks %s", want)
		}
	}

	// The tracked tree, not the working tree: an untracked file never leaks.
	if _, err := os.Stat(filepath.Join(dest, "ui/web/node_modules")); err == nil {
		t.Error("the export holds node_modules")
	}
}

// The two refusals, each against a throwaway repository that carries a copy of
// the script, so nothing here depends on the real tree staying dirty or clean.
func TestPublicExportRefusesSecretsAndHomePaths(t *testing.T) {
	needExportTools(t)
	for _, tc := range []struct {
		name, file, body, refusal string
	}{
		{"home path", "notes.txt", "built on " + homePath + "someone/src\n", "macOS home path"},
		// A made-up Stripe live key: gitleaks' stripe-access-token rule matches it.
		{"secret", "config.go", "package x\n\nconst k = \"sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc" + "\"\n", "gitleaks found"},
		{"private path", "plans/x/note.md", "plans are private\n", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := t.TempDir()
			gitOut(t, repo, "init", "-q", "-b", "main")
			for _, f := range []string{"scripts/export-public.sh", "scripts/public-exclude.txt", ".gitleaks.toml"} {
				b, err := os.ReadFile(filepath.Join("../..", f))
				if err != nil {
					t.Fatal(err)
				}
				writeFile(t, filepath.Join(repo, f), string(b))
			}
			writeFile(t, filepath.Join(repo, tc.file), tc.body)
			gitOut(t, repo, "add", "-A")
			gitOut(t, repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid",
				"-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "x")

			dest := filepath.Join(t.TempDir(), "public")
			out, err := runExport(t, filepath.Join(repo, "scripts/export-public.sh"), dest)
			if tc.refusal == "" {
				// Control: the same repository with the file under plans/ exports.
				if err != nil {
					t.Fatalf("export failed: %v\n%s", err, out)
				}
				if _, err := os.Stat(filepath.Join(dest, tc.file)); err == nil {
					t.Errorf("%s was exported", tc.file)
				}
				return
			}
			if err == nil {
				t.Fatalf("the export finished despite the %s:\n%s", tc.name, out)
			}
			if !strings.Contains(out, tc.refusal) {
				t.Errorf("the refusal does not say %q:\n%s", tc.refusal, out)
			}
			if tc.name == "home path" && !strings.Contains(out, "notes.txt") {
				t.Errorf("the refusal does not name the file:\n%s", out)
			}
			if _, err := os.Stat(filepath.Join(dest, ".git")); err == nil {
				t.Error("a refused export still made a repository")
			}
		})
	}
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
