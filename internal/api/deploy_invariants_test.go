package api_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The trust boundary lives in docker-compose.yml, so it is asserted here rather
// than left to review. Every credential check in this API is sound only because
// nothing outside the compose network can reach the port; publishing it would
// expose an API whose whole authentication is a shared bearer plus a
// caller-asserted user id.
func TestComposeNeverPublishesTheAPIPort(t *testing.T) {
	compose := readRepoFile(t, "../../docker-compose.yml")

	api := stripComments(serviceBlock(t, compose, "api"))
	if strings.Contains(api, "ports:") {
		t.Fatalf("the `api` service declares `ports:` — the API must not be reachable from the host:\n%s", api)
	}

	// The counterpart: `web` must publish, or nothing is reachable at all and
	// this test would pass on an entirely broken file.
	web := stripComments(serviceBlock(t, compose, "web"))
	if !strings.Contains(web, "ports:") {
		t.Fatal("the `web` service publishes no port — nothing would be reachable")
	}
}

// Every piece of in-process API state (rate-limiter buckets now; the stream bus,
// job workers and cancel registry from phases 5 and 6) is correct only while
// there is exactly one process. Leases are the precondition for raising this.
func TestComposePinsTheAPIToOneReplica(t *testing.T) {
	compose := readRepoFile(t, "../../docker-compose.yml")
	api := serviceBlock(t, compose, "api")

	if !regexp.MustCompile(`replicas:\s*1\b`).MatchString(api) {
		t.Fatalf("the `api` service does not pin `replicas: 1`:\n%s", api)
	}
}

// The boot contract: the API refuses to start without these, so compose must
// actually supply them or every deploy fails at runtime instead of at config.
func TestComposePassesRequiredSecretsToTheAPI(t *testing.T) {
	api := serviceBlock(t, readRepoFile(t, "../../docker-compose.yml"), "api")

	for _, key := range []string{
		"ANYTOOLS_POSTGRES_DSN",
		"ANYTOOLS_GATEWAY_TOKEN",
		"ANYTOOLS_ENCRYPTION_KEY",
	} {
		if !strings.Contains(api, key) {
			t.Errorf("the `api` service does not receive %s", key)
		}
	}
}

// .env.example is the only instruction the owner gets. A variable the stack
// requires but the example never mentions is a deploy that fails with a message
// about an environment variable nobody knew to set.
func TestEnvExampleDocumentsEveryRequiredVariable(t *testing.T) {
	example := readRepoFile(t, "../../.env.example")

	for _, key := range []string{
		"ANYTOOLS_POSTGRES_DSN",
		"ANYTOOLS_GATEWAY_TOKEN",
		"ANYTOOLS_ENCRYPTION_KEY",
		"ANYTOOLS_SESSION_SECRET",
		"ANYTOOLS_APP_URL",
		"ANYTOOLS_GOOGLE_CLIENT_ID",
		"ANYTOOLS_GOOGLE_CLIENT_SECRET",
		"ANYTOOLS_GITHUB_CLIENT_ID",
		"ANYTOOLS_GITHUB_CLIENT_SECRET",
		"ANYTOOLS_DOMAIN",
		"ANYTOOLS_BACKUP_REMOTE",
	} {
		if !strings.Contains(example, key) {
			t.Errorf(".env.example does not document %s", key)
		}
	}

	// A filled-in secret in the committed example is a leaked secret.
	for _, line := range strings.Split(example, "\n") {
		for _, key := range []string{"ANYTOOLS_GATEWAY_TOKEN", "ANYTOOLS_ENCRYPTION_KEY", "ANYTOOLS_SESSION_SECRET"} {
			if strings.HasPrefix(line, key+"=") && strings.TrimSpace(strings.TrimPrefix(line, key+"=")) != "" {
				t.Errorf("%s has a value in .env.example — it must be blank", key)
			}
		}
	}
}

// The web image's build stage runs `COPY . .` immediately after copying the
// Linux node_modules from its deps stage. Without a .dockerignore excluding
// node_modules, a host tree built on macOS overwrites them with binaries for the
// wrong platform, and the build fails with an architecture error that points
// nowhere near the cause.
func TestDockerignoreExcludesNodeModules(t *testing.T) {
	for _, path := range []string{"../../.dockerignore", "../../ui/web/.dockerignore"} {
		content := readRepoFile(t, path)
		if !strings.Contains(content, "node_modules") {
			t.Errorf("%s does not exclude node_modules", path)
		}
	}

	// The root context feeds the Go image, which needs none of the web tree.
	root := readRepoFile(t, "../../.dockerignore")
	if !strings.Contains(root, "ui/web/node_modules") {
		t.Error(".dockerignore does not exclude ui/web/node_modules from the API build context")
	}
}

// Migration files are timestamp-named so parallel phase branches never collide
// on the same next integer.
func TestMigrationsUseTimestampNames(t *testing.T) {
	entries, err := os.ReadDir("../../migrations")
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("no migrations found")
	}

	// <10-digit unix timestamp>_<slug>.{up,down}.sql
	naming := regexp.MustCompile(`^\d{10}_[a-z0-9_]+\.(up|down)\.sql$`)
	seen := map[string]int{}

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !naming.MatchString(e.Name()) {
			t.Errorf("migration %q is not named <unix-timestamp>_<slug>.{up,down}.sql", e.Name())
			continue
		}
		seen[strings.SplitN(e.Name(), ".", 2)[0]]++
	}

	// A migration with no down is a migration that cannot be rolled back.
	for prefix, count := range seen {
		if count != 2 {
			t.Errorf("migration %q has %d file(s); each needs exactly an .up and a .down", prefix, count)
		}
	}
}

// The production overlay adds nginx in front of `web`. It must not undo the
// base file's two load-bearing decisions: no port on `api`, one replica.
func TestProdOverlayKeepsTheTrustBoundary(t *testing.T) {
	overlay := readRepoFile(t, "../../deploy/docker-compose.prod.yml")

	api := stripComments(serviceBlock(t, overlay, "api"))
	if strings.Contains(api, "ports:") {
		t.Fatalf("the prod overlay gives `api` a `ports:` entry:\n%s", api)
	}
	if strings.Contains(api, "replicas:") {
		t.Fatalf("the prod overlay changes the API's replica count:\n%s", api)
	}
	if strings.Contains(stripComments(serviceBlock(t, overlay, "web")), "ports:") {
		t.Fatal("the prod overlay publishes `web` directly; only nginx faces the internet")
	}
	if !strings.Contains(stripComments(serviceBlock(t, overlay, "nginx")), "443:443") {
		t.Fatal("nginx does not publish 443")
	}

	// nginx proxies to `web` and never to `api`.
	conf := readRepoFile(t, "../../deploy/nginx/anytools.conf.template")
	if strings.Contains(conf, "api:8080") || !strings.Contains(conf, "proxy_pass http://web:3000") {
		t.Fatal("nginx must proxy to web:3000 and never to the API")
	}
}

// The base file publishes `web` on loopback unless told otherwise, so a VPS
// that forgets the overlay does not serve plain HTTP to the internet.
func TestWebPublishesOnLoopbackByDefault(t *testing.T) {
	web := stripComments(serviceBlock(t, readRepoFile(t, "../../docker-compose.yml"), "web"))
	if !strings.Contains(web, "${WEB_BIND:-127.0.0.1}:") {
		t.Fatalf("`web` does not default to the loopback interface:\n%s", web)
	}
}

// stripComments drops YAML comment lines so prose ABOUT a key is never mistaken
// for the key itself — the `api` service's comment explains at length why it has
// no `ports:` entry.
func stripComments(block string) string {
	var kept []string
	for _, line := range strings.Split(block, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		if i := strings.Index(line, " #"); i >= 0 {
			line = line[:i]
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

func readRepoFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

// serviceBlock extracts one service's YAML block by indentation, so a `ports:`
// belonging to a different service is never mistaken for this one's.
func serviceBlock(t *testing.T, compose, name string) string {
	t.Helper()

	lines := strings.Split(compose, "\n")
	start := -1
	for i, line := range lines {
		if strings.TrimRight(line, " ") == "  "+name+":" {
			start = i + 1
			break
		}
	}
	if start == -1 {
		t.Fatalf("service %q not found in docker-compose.yml", name)
	}

	var block []string
	for _, line := range lines[start:] {
		trimmed := strings.TrimSpace(line)
		// A new top-level or service-level key ends the block.
		if trimmed != "" && !strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "  #") {
			break
		}
		block = append(block, line)
	}
	return strings.Join(block, "\n")
}

// Security audit F-7: the application containers are memory-capped and
// unprivileged in production, so a runaway parse cannot take the host.
func TestProdOverlayCapsAndUnprivilegesTheAppContainers(t *testing.T) {
	overlay := readRepoFile(t, "../../deploy/docker-compose.prod.yml")
	for _, name := range []string{"api", "web", "migrate"} {
		block := stripComments(serviceBlock(t, overlay, name))
		for _, want := range []string{"mem_limit:", "<<: *hardened"} {
			if !strings.Contains(block, want) {
				t.Errorf("prod overlay `%s` lacks %q", name, want)
			}
		}
	}
	for _, want := range []string{"cap_drop: [ALL]", "no-new-privileges:true", "pids_limit:"} {
		if !strings.Contains(overlay, want) {
			t.Errorf("the hardened anchor lacks %q", want)
		}
	}
}

// Up-methods phase 21: the built-in transcription engine is internal only.
// It has no key, so publishing it would hand anyone the owner's CPU; and it
// runs under a profile, so a server without it still starts.
func TestTheBuiltinTranscriptionEngineIsInternalAndOptional(t *testing.T) {
	overlay := readRepoFile(t, "../../deploy/docker-compose.prod.yml")
	for _, name := range []string{"stt", "stt-model"} {
		block := stripComments(serviceBlock(t, overlay, name))
		if strings.Contains(block, "ports:") || strings.Contains(block, "expose:") {
			t.Errorf("`%s` is published:\n%s", name, block)
		}
		if !strings.Contains(block, `profiles: ["stt"]`) {
			t.Errorf("`%s` is not under the stt profile", name)
		}
		if !strings.Contains(block, "<<: *hardened") || !strings.Contains(block, "mem_limit:") {
			t.Errorf("`%s` is not capped and unprivileged", name)
		}
	}
	if image := stripComments(serviceBlock(t, overlay, "stt")); strings.Contains(image, ":latest") {
		t.Error("the stt image is not pinned")
	}
	conf := readRepoFile(t, "../../deploy/nginx/anytools.conf.template")
	if strings.Contains(conf, "stt:") {
		t.Fatal("nginx proxies to the built-in engine")
	}
}

// Up-methods phase 22: the built-in voices are internal and optional on the
// same terms, and pinned by digest.
func TestTheBuiltinVoicesAreInternalOptionalAndPinned(t *testing.T) {
	overlay := readRepoFile(t, "../../deploy/docker-compose.prod.yml")
	block := stripComments(serviceBlock(t, overlay, "tts"))
	if strings.Contains(block, "ports:") || strings.Contains(block, "expose:") {
		t.Errorf("`tts` is published:\n%s", block)
	}
	if !strings.Contains(block, `profiles: ["tts"]`) {
		t.Error("`tts` is not under the tts profile")
	}
	if !strings.Contains(block, "<<: *hardened") || !strings.Contains(block, "mem_limit:") {
		t.Error("`tts` is not capped and unprivileged")
	}
	if !strings.Contains(block, "ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0@sha256:") {
		t.Error("the tts image is not pinned by digest")
	}
	if !strings.Contains(block, "tts-models:") {
		t.Error("the tts model cache is not on a volume")
	}
	if conf := readRepoFile(t, "../../deploy/nginx/anytools.conf.template"); strings.Contains(conf, "tts:") {
		t.Fatal("nginx proxies to the built-in voices")
	}
}

// The media tools ship with the API, yt-dlp at one exact release checked
// against its published digest: "latest" would change what the server runs
// on every rebuild.
func TestTheAPIImagePinsItsMediaTools(t *testing.T) {
	dockerfile := readRepoFile(t, "../../deploy/Dockerfile.api")
	for _, want := range []string{"ARG YTDLP_VERSION=20", "sha256sum -c", "/usr/local/bin/yt-dlp", " ffmpeg ", " deno"} {
		if !strings.Contains(dockerfile, want) {
			t.Errorf("Dockerfile.api lacks %q", want)
		}
	}
	if strings.Contains(dockerfile, "releases/latest") {
		t.Error("yt-dlp is fetched from the latest release")
	}
}

// The Drive cache size is the one Drive setting the owner may tune
// (drive-user-storage phase 1); without this line, .env.example documents a
// variable the API container never receives.
func TestComposePassesTheDriveCacheSizeToTheAPI(t *testing.T) {
	api := serviceBlock(t, readRepoFile(t, "../../docker-compose.yml"), "api")
	if !strings.Contains(api, "ANYTOOLS_DRIVE_CACHE_MB") {
		t.Error("the `api` service does not receive ANYTOOLS_DRIVE_CACHE_MB")
	}
}

// The Drive cache holds copies of files kept in learners' own Drives, up to
// ANYTOOLS_DRIVE_CACHE_MB. Losing it loses nothing, so the hourly backup unit
// leaves it out, and keeps everything else in the data directory.
func TestTheBackupLeavesTheDriveCacheOut(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash is not installed")
	}
	data := t.TempDir()
	for _, f := range []string{"originals/a/doc.pdf", "cache/u1/ab/abc", "objects/books/x.md"} {
		path := filepath.Join(data, f)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	lib, err := filepath.Abs("../../deploy/scripts/lib.sh")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("bash", "-c", `source "$1" && archive_data | tar -tzf -`, "bash", lib)
	cmd.Env = append(os.Environ(), "ANYTOOLS_BACKUP_MODE=local",
		"ANYTOOLS_POSTGRES_DSN=postgres://unused", "ANYTOOLS_DATA_DIR="+data)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("archive_data: %v\n%s", err, out)
	}
	list := string(out)
	for _, want := range []string{"originals/a/doc.pdf", "objects/books/x.md"} {
		if !strings.Contains(list, want) {
			t.Errorf("the backup lacks %s:\n%s", want, list)
		}
	}
	if strings.Contains(list, "cache/") {
		t.Errorf("the backup holds the Drive cache:\n%s", list)
	}
	// The compose branch runs the same exclusion inside the api container.
	if !strings.Contains(readRepoFile(t, "../../deploy/scripts/lib.sh"), "api -C /var/lib/anytools/data --exclude=./cache") {
		t.Error("the compose backup does not leave the Drive cache out")
	}
}

// anytools-merge phase 1: for one release the deploy scripts still accept a
// LONGPLAY_* variable when its ANYTOOLS_* twin is unset, never over a set twin,
// and warn with the old names only.
func TestScriptsAcceptLegacyEnvForOneRelease(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash is not installed")
	}
	shim, err := filepath.Abs("../../deploy/scripts/legacy-env.sh")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("bash", "-c", `set -euo pipefail; source "$1"; echo "dsn=$ANYTOOLS_POSTGRES_DSN dir=$ANYTOOLS_DATA_DIR"`, "bash", shim)
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"),
		"LONGPLAY_POSTGRES_DSN=postgres://old-secret@db/x",
		"LONGPLAY_DATA_DIR=/old", "ANYTOOLS_DATA_DIR=/new"}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("legacy-env.sh: %v\n%s", err, out)
	}
	got := string(out)
	if !strings.Contains(got, "dsn=postgres://old-secret@db/x dir=/new") {
		t.Errorf("the fallback did not fill only the unset twin:\n%s", got)
	}
	warning, _, _ := strings.Cut(got, "dsn=")
	if !strings.Contains(warning, "LONGPLAY_POSTGRES_DSN") || !strings.Contains(warning, "LONGPLAY_DATA_DIR") {
		t.Errorf("the warning does not name the old variables:\n%s", got)
	}
	if strings.Contains(warning, "old-secret") || strings.Contains(warning, "/old") {
		t.Errorf("the warning leaks a value:\n%s", got)
	}
	for _, script := range []string{"lib.sh", "deploy.sh", "run-local.sh"} {
		if !strings.Contains(readRepoFile(t, "../../deploy/scripts/"+script), "legacy-env.sh") {
			t.Errorf("deploy/scripts/%s does not source legacy-env.sh", script)
		}
	}
}

// anytools-merge phase 5: anytools.world runs as a Coolify compose resource
// behind Coolify's own Traefik. The trust boundary and the single replica hold
// there as in the base file, and every container is capped for a 4 GB host
// shared with other sites.
func TestCoolifyComposeKeepsTheBoundaryAndTheCaps(t *testing.T) {
	compose := readRepoFile(t, "../../deploy/coolify/docker-compose.yml")

	api := stripComments(serviceBlock(t, compose, "api"))
	for _, banned := range []string{"ports:", "traefik.", "build:"} {
		if strings.Contains(api, banned) {
			t.Errorf("the `api` service has %q:\n%s", banned, api)
		}
	}
	if !regexp.MustCompile(`replicas:\s*1\b`).MatchString(api) {
		t.Error("the `api` service does not pin `replicas: 1`")
	}

	for name, limit := range map[string]string{"api": "768m", "web": "384m", "postgres": "256m"} {
		block := stripComments(serviceBlock(t, compose, name))
		if !regexp.MustCompile(`(?m)^\s*mem_limit:\s*` + limit + `\s*$`).MatchString(block) {
			t.Errorf("`%s` is not capped at %s", name, limit)
		}
	}
	for _, name := range []string{"api", "web", "migrate"} {
		block := stripComments(serviceBlock(t, compose, name))
		if !strings.Contains(block, "<<: *hardened") || !strings.Contains(block, "mem_limit:") {
			t.Errorf("`%s` is not capped and unprivileged", name)
		}
		if strings.Contains(block, "build:") {
			t.Errorf("`%s` builds on the host; it must pull its image", name)
		}
	}

	// Coolify's Traefik holds 80/443: nothing here publishes a port, and
	// `web` is reached by its labels.
	body := stripComments(compose)
	if strings.Contains(body, "ports:") {
		t.Error("a service publishes a port; Coolify's Traefik is the only way in")
	}
	web := stripComments(serviceBlock(t, compose, "web"))
	for _, want := range []string{
		"traefik.enable=true",
		"Host(`anytools.world`) || Host(`www.anytools.world`)",
		"loadbalancer.server.port=3000",
		"ghcr.io/d0bby999/anytools-web:",
	} {
		if !strings.Contains(web, want) {
			t.Errorf("`web` lacks %q", want)
		}
	}
	if !strings.Contains(api, "ghcr.io/d0bby999/anytools-api:") {
		t.Error("`api` does not run the GHCR image")
	}
	if !strings.Contains(stripComments(serviceBlock(t, compose, "postgres")), "pgvector/pgvector:pg16") {
		t.Error("postgres is not pgvector/pgvector:pg16")
	}

	// No nginx or certbot, and the built-in engines stay off on this host.
	for _, absent := range []string{"nginx", "certbot", "stt", "tts", "stt-model"} {
		if regexp.MustCompile(`(?m)^  ` + regexp.QuoteMeta(absent) + `:`).MatchString(compose) {
			t.Errorf("the Coolify compose defines `%s`", absent)
		}
	}
	for _, absent := range []string{"ANYTOOLS_STT_URL", "ANYTOOLS_TTS_URL", "speaches", "kokoro"} {
		if strings.Contains(strings.ToLower(body), strings.ToLower(absent)) {
			t.Errorf("the Coolify compose mentions %s", absent)
		}
	}

	// The API refuses to boot without these.
	for _, key := range []string{"ANYTOOLS_POSTGRES_DSN", "ANYTOOLS_GATEWAY_TOKEN", "ANYTOOLS_ENCRYPTION_KEY"} {
		if !strings.Contains(api, key) {
			t.Errorf("the `api` service does not receive %s", key)
		}
	}
}

// The web image runs `corepack enable` then `pnpm install --frozen-lockfile`.
// Without a pinned packageManager, Corepack fetches the newest pnpm, which may
// no longer read package.json's "pnpm" settings (overrides, built
// dependencies) and so refuses the lockfile: every image build fails.
func TestTheWebPackagePinsItsPnpm(t *testing.T) {
	if !regexp.MustCompile(`"packageManager":\s*"pnpm@10\.`).MatchString(readRepoFile(t, "../../ui/web/package.json")) {
		t.Error("ui/web/package.json does not pin packageManager to pnpm 10")
	}
}
