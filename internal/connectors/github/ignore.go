package github

import (
	"fmt"
	"path"
	"regexp"
	"strings"
)

// ignore.go — which repository paths are never imported.
//
// The default list is gitingest's (coderamp-labs/gitingest, MIT,
// src/gitingest/utils/ignore_patterns.py, DEFAULT_IGNORE_PATTERNS):
// dependency trees, build output, lockfiles, caches, binaries and media. The
// learner adds their own patterns on top, in .gitignore syntax: `#` comments,
// `!` to re-include, a trailing `/` for directories only, a slash anywhere
// else to anchor at the repository root, and `*`, `?`, `[...]` and `**`.

// DefaultIgnore is gitingest's default ignore list, entry for entry.
var DefaultIgnore = []string{
	// Python
	"*.pyc", "*.pyo", "*.pyd", "__pycache__", ".pytest_cache", ".coverage", ".tox", ".nox",
	".mypy_cache", ".ruff_cache", ".hypothesis", "poetry.lock", "Pipfile.lock",
	// JavaScript
	"node_modules", "bower_components", "package-lock.json", "yarn.lock", ".npm", ".yarn",
	".pnpm-store", "bun.lock", "bun.lockb",
	// Java
	"*.class", "*.jar", "*.war", "*.ear", "*.nar", ".gradle/", "build/", ".settings/", ".classpath",
	"gradle-app.setting", "*.gradle",
	// IDEs and editors / Java
	".project",
	// C/C++
	"*.o", "*.obj", "*.dll", "*.dylib", "*.exe", "*.lib", "*.out", "*.a", "*.pdb",
	// Binary
	"*.bin",
	// Swift/Xcode
	".build/", "*.xcodeproj/", "*.xcworkspace/", "*.pbxuser", "*.mode1v3", "*.mode2v3",
	"*.perspectivev3", "*.xcuserstate", "xcuserdata/", ".swiftpm/",
	// Ruby
	"*.gem", ".bundle/", "vendor/bundle", "Gemfile.lock", ".ruby-version", ".ruby-gemset", ".rvmrc",
	// Rust
	"Cargo.lock", "**/*.rs.bk",
	// Java / Rust
	"target/",
	// Go
	"pkg/",
	// .NET/C#
	"obj/", "*.suo", "*.user", "*.userosscache", "*.sln.docstates", "*.nupkg",
	// Go / .NET / C#
	"bin/",
	// Version control
	".git", ".svn", ".hg", ".gitignore", ".gitattributes", ".gitmodules",
	// Images and media
	"*.svg", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.ico", "*.pdf", "*.mov", "*.mp4", "*.mp3", "*.wav",
	// Virtual environments
	"venv", ".venv", "env", ".env", "virtualenv",
	// IDEs and editors
	".idea", ".vscode", ".vs", "*.swo", "*.swn", ".settings", "*.sublime-*",
	// Temporary and cache files
	"*.log", "*.bak", "*.swp", "*.tmp", "*.temp", ".cache", ".sass-cache", ".eslintcache",
	".DS_Store", "Thumbs.db", "desktop.ini",
	// Build directories and artifacts
	"build", "dist", "target", "out", "*.egg-info", "*.egg", "*.whl", "*.so",
	// Documentation
	"site-packages", ".docusaurus", ".next", ".nuxt",
	// Database
	"*.db", "*.sqlite", "*.sqlite3",
	// Minified files, source maps, Terraform state
	"*.min.js", "*.min.css", "*.map", "*.tfstate*",
	// Dependencies in various languages
	"vendor/",
	// gitingest's own output
	"digest.txt",
}

// Limits on the learner's own patterns.
const (
	MaxIgnorePatterns = 50
	MaxPatternLength  = 200
)

type ignoreRule struct {
	negate  bool
	dirOnly bool
	re      *regexp.Regexp
}

// Ignore is a compiled ignore list. The zero value ignores nothing.
type Ignore struct {
	rules []ignoreRule
}

// NewIgnore compiles patterns, in order: a later pattern overrides an
// earlier one for the same path, as in .gitignore.
func NewIgnore(patterns ...[]string) (*Ignore, error) {
	ig := &Ignore{}
	for _, list := range patterns {
		for _, p := range list {
			rule, ok, err := compileRule(p)
			if err != nil {
				return nil, err
			}
			if ok {
				ig.rules = append(ig.rules, rule)
			}
		}
	}
	return ig, nil
}

// ValidatePatterns checks a learner's own patterns before they are stored.
func ValidatePatterns(patterns []string) error {
	if len(patterns) > MaxIgnorePatterns {
		return fmt.Errorf("at most %d ignore patterns", MaxIgnorePatterns)
	}
	for _, p := range patterns {
		if len(p) > MaxPatternLength {
			return fmt.Errorf("an ignore pattern is longer than %d characters", MaxPatternLength)
		}
		if _, _, err := compileRule(p); err != nil {
			return err
		}
	}
	return nil
}

func compileRule(p string) (ignoreRule, bool, error) {
	p = strings.TrimRight(p, " \t\r")
	if p == "" || strings.HasPrefix(p, "#") {
		return ignoreRule{}, false, nil
	}
	var r ignoreRule
	if strings.HasPrefix(p, "!") {
		r.negate, p = true, p[1:]
	}
	if strings.HasSuffix(p, "/") {
		r.dirOnly, p = true, strings.TrimRight(p, "/")
	}
	if p == "" {
		return ignoreRule{}, false, nil
	}
	anchored := strings.Contains(p, "/")
	p = strings.TrimPrefix(p, "/")
	body, err := globToRegexp(p)
	if err != nil {
		return ignoreRule{}, false, fmt.Errorf("ignore pattern %q: %w", p, err)
	}
	// Unanchored: the pattern names an entry at any depth.
	if anchored {
		body = "^" + body + "$"
	} else {
		body = "^(?:.*/)?" + body + "$"
	}
	re, err := regexp.Compile(body)
	if err != nil {
		return ignoreRule{}, false, fmt.Errorf("ignore pattern %q: %w", p, err)
	}
	r.re = re
	return r, true, nil
}

// globToRegexp translates one wildmatch pattern.
func globToRegexp(p string) (string, error) {
	var b strings.Builder
	for i := 0; i < len(p); i++ {
		c := p[i]
		switch c {
		case '*':
			if i+1 < len(p) && p[i+1] == '*' {
				i++
				if i+1 < len(p) && p[i+1] == '/' {
					i++
					b.WriteString("(?:.*/)?")
				} else {
					b.WriteString(".*")
				}
				continue
			}
			b.WriteString("[^/]*")
		case '?':
			b.WriteString("[^/]")
		case '[':
			j := strings.IndexByte(p[i+1:], ']')
			if j < 0 {
				return "", fmt.Errorf("unclosed [")
			}
			class := p[i+1 : i+1+j]
			if strings.HasPrefix(class, "!") {
				class = "^" + class[1:]
			}
			class = strings.ReplaceAll(class, `\`, `\\`)
			b.WriteString("[" + class + "]")
			i += j + 1
		case '\\':
			if i+1 < len(p) {
				i++
				b.WriteString(regexp.QuoteMeta(string(p[i])))
			}
		default:
			b.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	return b.String(), nil
}

// Ignored reports whether a file at rel (slash-separated, relative to the
// repository root) is excluded: by a rule naming the file, or a rule naming
// any directory above it. As in git, a file under an excluded directory
// cannot be re-included.
func (ig *Ignore) Ignored(rel string) bool {
	if ig == nil || len(ig.rules) == 0 {
		return false
	}
	rel = strings.Trim(path.Clean(rel), "/")
	parts := strings.Split(rel, "/")
	for i := 1; i < len(parts); i++ {
		if ig.match(strings.Join(parts[:i], "/"), true) {
			return true
		}
	}
	return ig.match(rel, false)
}

// match applies the last matching rule.
func (ig *Ignore) match(p string, isDir bool) bool {
	ignored := false
	for _, r := range ig.rules {
		if r.dirOnly && !isDir {
			continue
		}
		if r.re.MatchString(p) {
			ignored = !r.negate
		}
	}
	return ignored
}
