package api_test

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// anytools-merge phase 1: the product is AnyTools. The old name may appear
// only where removing it would break something or rewrite history, and each
// such place is listed here with its reason.

// brandHistoryDirs are history, not product: plans record what was decided
// under the old name, and an applied migration is never edited (its file
// name and comments stay as they were written).
var brandHistoryDirs = []string{"plans/", "migrations/"}

// brandKeptEverywhere are identifiers already persisted outside the code, so
// renaming them would strand existing data.
var brandKeptEverywhere = []string{
	// documents.mime values already stored in rows.
	"application/vnd.longplay.",
	// appProperties already written on files and folders in learners' Drives;
	// the app finds its own files by these keys.
	"longplay_user", "longplay_role", "longplay_kind", "longplay_key",
	// the plaintext whose ciphertext every existing database holds; a new
	// plaintext would read as a wrong encryption key at boot.
	"longplay-encryption-key-sentinel-v1",
	// the owner's local reference checkouts, outside the repo.
	".longplay-refs",
	// links to plan folders, which keep their names.
	"260916-1225-longplay-self-learning-platform",
}

// brandKeptInFile are the one-release LONGPLAY_* fallback and its tests, and
// the one history note that says the app was renamed.
var brandKeptInFile = map[string][]string{
	"internal/config/config.go":              {"LONGPLAY_"},
	"internal/config/legacy_env_test.go":     {"LONGPLAY_"},
	"internal/testutil/db_test.go":           {"LONGPLAY_"},
	"internal/api/deploy_invariants_test.go": {"LONGPLAY_"},
	"internal/api/brand_guard_test.go":       {"longplay", "Longplay", "LONGPLAY_"},
	"deploy/scripts/legacy-env.sh":           {"LONGPLAY_"},
	"ui/web/app/lib/env.server.ts":           {"LONGPLAY_"},
	"ui/web/app/test/legacy-env.test.ts":     {"LONGPLAY_"},
	"docs/deployment.md":                     {"LONGPLAY_", "called Longplay until"},
}

func TestNoLongplayOutsideTheAllowList(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "ls-files", "-z")
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		t.Skipf("not a git checkout: %v", err)
	}
	files := strings.Split(strings.TrimRight(string(out), "\x00"), "\x00")
	if len(files) < 100 {
		t.Fatalf("git ls-files listed %d files; the guard would pass on nothing", len(files))
	}

	var hits []string
	for _, f := range files {
		if historyPath(f) {
			continue
		}
		if strings.Contains(strings.ToLower(f), "longplay") {
			hits = append(hits, f+": the path itself")
		}
		b, err := os.ReadFile(filepath.Join(root, f))
		if err != nil || bytes.IndexByte(b, 0) >= 0 {
			continue // deleted in the working tree, or binary
		}
		for i, line := range strings.Split(string(b), "\n") {
			if !strings.Contains(strings.ToLower(line), "longplay") {
				continue
			}
			rest := line
			for _, keep := range append(brandKeptEverywhere, brandKeptInFile[f]...) {
				rest = strings.ReplaceAll(rest, keep, "")
			}
			if strings.Contains(strings.ToLower(rest), "longplay") {
				hits = append(hits, f+":"+strconv.Itoa(i+1)+": "+strings.TrimSpace(line))
			}
		}
	}
	if len(hits) > 0 {
		t.Fatalf("the old name appears outside the allow-list (rename it to AnyTools, "+
			"or add it to the allow-list with a reason):\n%s", strings.Join(hits, "\n"))
	}
}

func historyPath(f string) bool {
	for _, dir := range brandHistoryDirs {
		if strings.HasPrefix(f, dir) {
			return true
		}
	}
	return false
}
