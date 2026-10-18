package api_test

// migrations_order_test.go — two guards over migrations/ (up methods,
// phase 14).
//
// golang-migrate never applies a version below the database's current one,
// and deploy/scripts/deploy.sh migrates a live volume. A migration that lands
// on main sorting below one main already had is skipped on every deployed
// database, silently. Parallel phase branches make that easy, which is why
// the merger renames a branch's migration to the next free timestamp.
//
// A migration that restates a CHECK list (DROP CONSTRAINT, then ADD it with
// one value more) must keep every value the lists before it allowed. Two
// phases restating search_connections_provider_known each dropped the other's
// value until the merger fixed it.

import (
	"bufio"
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// ruleSince is the commit that set the rule: plan.md of
// plans/260930-0915-up-methods, "Migrations" (red team SF-4).
const ruleSince = "704436c"

// gitLines runs git in the repository root and returns its output lines.
func gitLines(t *testing.T, args ...string) []string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = filepath.Join("..", "..")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %s: %v", strings.Join(args, " "), err)
	}
	var lines []string
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	return lines
}

// TestMigrationsAreInCommitOrder walks main's first-parent history, the
// commits a deployed database is migrated through, oldest first. A
// migration that a commit brings in must sort above every migration an
// earlier commit brought in.
//
// Each file is dated by the commit that first added it under its current
// name. A merger's rename is that file's arrival, and the name it had on its
// branch, which no database applies, is ignored. Comparing by first-parent
// commits rather than by any ancestor is what a deploy sees: a branch's own
// commits reach main only at its merge.
//
// The rule dates from the up-methods plan (ruleSince). The learning-depth
// plan merged seven migrations below audio_overviews' 1789860000 on
// 2026-09-27, before it; everything that arrived by then is the baseline,
// compared with nothing, and every later arrival must sort above it.
func TestMigrationsAreInCommitOrder(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	if shallow := gitLines(t, "rev-parse", "--is-shallow-repository"); len(shallow) == 1 && shallow[0] == "true" {
		t.Skip("a shallow clone has no history to compare")
	}

	current := map[string]bool{}
	entries, err := os.ReadDir(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".up.sql") {
			current[e.Name()] = true
		}
	}

	baseline := map[string]bool{}
	for _, c := range gitLines(t, "rev-list", "--first-parent", ruleSince) {
		baseline[c] = true
	}

	// One block per first-parent commit, oldest first: a "commit <sha>" line,
	// then the up-migrations it added against its first parent.
	log := gitLines(t, "log", "--first-parent", "--reverse", "--diff-merges=first-parent",
		"--diff-filter=A", "--no-renames", "--name-only", "--format=commit %H", "HEAD", "--", "migrations/*.up.sql")
	arrived := map[string]bool{}
	var highest, highestCommit, commit string
	var batch []string
	flush := func() {
		sort.Strings(batch)
		for _, name := range batch {
			if !baseline[commit] && highest != "" && name < highest {
				t.Errorf("%s arrived on main in %.10s, after %s (%.10s); a deployed database skips it. "+
					"Rename it to the next free timestamp.", name, commit, highest, highestCommit)
			}
		}
		for _, name := range batch {
			if name > highest {
				highest, highestCommit = name, commit
			}
		}
		batch = nil
	}
	for _, line := range log {
		switch {
		case strings.HasPrefix(line, "commit "):
			flush()
			commit = strings.TrimPrefix(line, "commit ")
		case strings.TrimSpace(line) != "":
			name := filepath.Base(line)
			// Only the top level is applied; deferred/ is not. A name that
			// no longer exists was renamed or moved, and its later name
			// counts instead. A name added twice counts once.
			if filepath.Dir(line) != "migrations" || !current[name] || arrived[name] {
				continue
			}
			arrived[name] = true
			batch = append(batch, name)
		}
	}
	flush()
	for name := range current {
		if !arrived[name] {
			// Not yet committed: it arrives with the commit being made, so it
			// must sort above everything committed.
			if name < highest {
				t.Errorf("%s is not committed yet and sorts below %s; give it the next free timestamp", name, highest)
			}
		}
	}
	if len(arrived) == 0 {
		t.Fatal("no migration found in the history; the walk is not reading it")
	}
}

// checkList is `CONSTRAINT <name> CHECK (<column> IN (<values>)`, inline in a
// CREATE TABLE or in an ALTER TABLE … ADD.
var (
	checkList    = regexp.MustCompile(`(?is)CONSTRAINT\s+(\w+)\s+CHECK\s*\(\s*\(?\s*(\w+)\s+IN\s*\(([^)]*)\)`)
	dropCheck    = regexp.MustCompile(`(?is)DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\w+)`)
	sqlComment   = regexp.MustCompile(`--[^\n]*`)
	quotedValues = regexp.MustCompile(`'([^']*)'`)
)

// removedOnPurpose lists a value a migration took out of a CHECK list on
// purpose: "<constraint> <value>" → the migration and why. Every other value
// an earlier list allowed must still be allowed.
var removedOnPurpose = map[string]string{}

func TestRestatedCheckListsKeepEveryEarlierValue(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "migrations", "*.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)

	type history struct {
		ever  map[string]string // value → the migration that first allowed it
		final map[string]bool   // the list in force
		live  bool
		count int
	}
	seen := map[string]*history{}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		sql := sqlComment.ReplaceAllString(string(raw), "")
		// Statements in order, so a DROP then ADD in one file ends live.
		type event struct {
			at     int
			name   string
			values []string // nil for a drop
		}
		var events []event
		for _, m := range dropCheck.FindAllStringSubmatchIndex(sql, -1) {
			events = append(events, event{at: m[0], name: sql[m[2]:m[3]]})
		}
		for _, m := range checkList.FindAllStringSubmatchIndex(sql, -1) {
			var values []string
			for _, v := range quotedValues.FindAllStringSubmatch(sql[m[6]:m[7]], -1) {
				values = append(values, v[1])
			}
			events = append(events, event{at: m[0], name: sql[m[2]:m[3]], values: values})
		}
		sort.Slice(events, func(i, j int) bool { return events[i].at < events[j].at })
		for _, e := range events {
			h := seen[e.name]
			if e.values == nil {
				if h != nil {
					h.live = false
				}
				continue
			}
			if h == nil {
				h = &history{ever: map[string]string{}}
				seen[e.name] = h
			}
			h.live, h.count, h.final = true, h.count+1, map[string]bool{}
			for _, v := range e.values {
				h.final[v] = true
				if _, ok := h.ever[v]; !ok {
					h.ever[v] = filepath.Base(f)
				}
			}
		}
	}

	restated := 0
	for name, h := range seen {
		if !h.live || h.count < 2 {
			continue
		}
		restated++
		for v, from := range h.ever {
			if h.final[v] {
				continue
			}
			if _, ok := removedOnPurpose[name+" "+v]; ok {
				continue
			}
			t.Errorf("%s no longer allows %q, which %s added; a restated list must keep every earlier value "+
				"(or list the removal in removedOnPurpose with its reason)", name, v, from)
		}
	}
	for key := range removedOnPurpose {
		name, v, _ := strings.Cut(key, " ")
		if h := seen[name]; h == nil || h.final[v] {
			t.Errorf("removedOnPurpose names %q, which is not a value removed from a list in force", key)
		}
	}
	// search_connections_provider_known alone is restated four times.
	if restated == 0 {
		t.Fatal("no restated CHECK list found; the scan is not reading the migrations")
	}
}
