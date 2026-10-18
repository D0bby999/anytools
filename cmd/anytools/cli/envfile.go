package cli

import (
	"bufio"
	"os"
	"strings"
)

// loadEnvFile reads a KEY=VALUE file and sets variables that are not already
// set. Ported from postclaw cmd/root.go:72 — a 25-line dotenv reader instead of
// a dependency.
//
// Never overriding an existing variable is the important half: docker-compose
// and CI inject the real configuration, and a forgotten .env.local must not be
// able to point a production process at a developer's database.
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // absent file is the normal case
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, val)
		}
	}
}
