// Package config loads AnyTools' runtime configuration from the environment.
//
// Every secret is env-only and tagged `json:"-"` so it can never be serialized
// into a response, a log line or a debug dump. There is deliberately no config
// file: postclaw's config.json grew a second, divergent source of truth for
// values that were already env vars (scout report §1).
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/D0bby999/anytools/internal/crypto"
)

// EnvPrefix is the single prefix for every AnyTools environment variable.
const EnvPrefix = "ANYTOOLS_"

// LegacyEnvPrefix is the prefix from before the rename to AnyTools. For one
// release a LONGPLAY_* variable still counts when its ANYTOOLS_* twin is unset
// or empty, so a deployment's old .env keeps booting; LegacyEnvNames lets the
// API warn about each one until the operator renames it.
const LegacyEnvPrefix = "LONGPLAY_"

// Getenv reads one ANYTOOLS_* variable, falling back to its LONGPLAY_* twin
// when the new name is unset or empty. Every read of an ANYTOOLS_* variable
// goes through here, so the fallback lives in exactly one place. A name
// without EnvPrefix is read as is.
func Getenv(name string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	if suffix, ok := strings.CutPrefix(name, EnvPrefix); ok {
		return os.Getenv(LegacyEnvPrefix + suffix)
	}
	return ""
}

// LegacyEnvNames lists, sorted, every LONGPLAY_* variable set in the
// environment. Names only: the caller logs them, and a value is never safe
// to log.
func LegacyEnvNames() []string {
	var names []string
	for _, kv := range os.Environ() {
		name, _, _ := strings.Cut(kv, "=")
		if strings.HasPrefix(name, LegacyEnvPrefix) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

// WarnLegacyEnv logs one warning naming every LONGPLAY_* variable found, and
// nothing when there are none. Call it once at boot, after the logger is set.
func WarnLegacyEnv(log *slog.Logger) {
	names := LegacyEnvNames()
	if len(names) == 0 {
		return
	}
	log.Warn("config: LONGPLAY_* variables are deprecated; rename each to ANYTOOLS_* "+
		"(an old one is read only while its ANYTOOLS_* twin is unset)", "variables", names)
}

// Config is the whole of AnyTools' runtime configuration.
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Security SecurityConfig
	Storage  StorageConfig
	Jobs     JobsConfig
	Engines  EnginesConfig
}

// ServerConfig holds the HTTP listener settings for the Go API.
//
// The API is never published to the internet: docker-compose gives the `api`
// service no `ports:` entry and the RR7 BFF is its only client
// (docs/architecture.md). Listen defaults to all interfaces inside the compose
// network, which is reachable only from `web`.
type ServerConfig struct {
	Addr string
	// RateLimitRPM is the per-user request budget; 0 disables rate limiting.
	RateLimitRPM   int
	RateLimitBurst int
	// AppURL is the site's public origin, the same ANYTOOLS_APP_URL the web
	// container signs in with. A reminder's push names a page on it.
	AppURL string
}

// DatabaseConfig holds the Postgres connection settings.
type DatabaseConfig struct {
	DSN string `json:"-"`
}

// SecurityConfig holds the two secrets the API refuses to boot without.
type SecurityConfig struct {
	// GatewayToken is the shared bearer the BFF presents on every API call.
	GatewayToken string `json:"-"`
	// EncryptionKey is the AES-256-GCM key protecting BYOK secrets at rest.
	EncryptionKey string `json:"-"`
	// AllowNoAuth disables the bearer requirement for local development.
	// It is refused when the process looks like production.
	AllowNoAuth bool
}

// StorageConfig says where uploaded files and parsed Markdown live.
//
// Deliberately OUTSIDE any web root. The RR7 BFF serves ui/web/build/client;
// nothing under this directory is reachable by URL, which is what stops an
// uploaded .html from being served back to a browser as same-origin content.
type StorageConfig struct {
	DataDir string
	// DriveCacheMB caps the server's cache of files kept in learners' Google
	// Drives (drive-user-storage phase 1). Zero or less is the default.
	DriveCacheMB int
	// R2, when set, keeps learners' originals and objects in a Cloudflare R2
	// bucket instead of under DataDir (internal/blob/bucket.go).
	R2 R2Config
}

// R2Config names a private R2 bucket and the S3 credentials of an R2 API
// token scoped to it. All four or none.
type R2Config struct {
	AccountID       string
	Bucket          string
	AccessKeyID     string `json:"-"`
	SecretAccessKey string `json:"-"`
}

// Enabled reports whether any of it is set; Load refuses a partial one.
func (r R2Config) Enabled() bool {
	return r.AccountID != "" || r.Bucket != "" || r.AccessKeyID != "" || r.SecretAccessKey != ""
}

// LoadR2 reads the R2 settings, for the server and for `anytools verify`.
func LoadR2() (R2Config, error) {
	r := R2Config{
		AccountID:       env("R2_ACCOUNT_ID"),
		Bucket:          env("R2_BUCKET"),
		AccessKeyID:     env("R2_ACCESS_KEY_ID"),
		SecretAccessKey: env("R2_SECRET_ACCESS_KEY"),
	}
	if r.Enabled() && (r.AccountID == "" || r.Bucket == "" || r.AccessKeyID == "" || r.SecretAccessKey == "") {
		return R2Config{}, fmt.Errorf("%w%sR2_ACCOUNT_ID, %sR2_BUCKET, %sR2_ACCESS_KEY_ID and %sR2_SECRET_ACCESS_KEY are all needed, or none",
			errRefused, EnvPrefix, EnvPrefix, EnvPrefix, EnvPrefix)
	}
	return r, nil
}

// JobsConfig tunes the background worker pool.
type JobsConfig struct {
	// Workers is how many jobs run concurrently in this process. The API is
	// single-replica by rule (docs/architecture.md), so this is the whole
	// parallelism of the system.
	Workers int
	// LeaseSeconds is how long a claim is good for without a heartbeat.
	LeaseSeconds int
}

// EnginesConfig is the server's own engines and the media tools they need
// (up-methods phase 21).
type EnginesConfig struct {
	// STTURL is the internal speaches service ("http://stt:8000"). Empty: the
	// server runs no built-in transcription, and it is never offered.
	STTURL string
	// STTModel is the faster-whisper model the service loads.
	STTModel string
	// STTDailyMinutes is each learner's built-in allowance per local day.
	STTDailyMinutes int
	// TTSURL is the internal Kokoro-FastAPI service ("http://tts:8880",
	// up-methods phase 22). Empty: the server has no built-in voices.
	TTSURL string
	// TTSDailyMinutes is each learner's built-in speech per local day.
	TTSDailyMinutes int
	// YTDLP and FFmpeg are the tools' executables, looked up on PATH by default.
	YTDLP  string
	FFmpeg string
}

// ErrMissingSecret reports a required secret that was not supplied.
var ErrMissingSecret = errors.New("config: required secret is not set")

// Load reads configuration from the environment and fail-closes on anything
// missing. Mirrors postclaw cmd/gateway.go:124's auth gate: refusing to start
// is the only safe response to a missing gateway token, because starting
// without one silently exposes every authenticated route.
func Load() (*Config, error) {
	cfg := &Config{
		Server: ServerConfig{
			Addr:           envOr("SERVER_ADDR", ":8080"),
			AppURL:         strings.TrimRight(envOr("APP_URL", "http://localhost:3000"), "/"),
			RateLimitRPM:   envInt("RATE_LIMIT_RPM", 600),
			RateLimitBurst: envInt("RATE_LIMIT_BURST", 60),
		},
		Database: DatabaseConfig{
			DSN: env("POSTGRES_DSN"),
		},
		Security: SecurityConfig{
			GatewayToken:  env("GATEWAY_TOKEN"),
			EncryptionKey: env("ENCRYPTION_KEY"),
			AllowNoAuth:   env("ALLOW_NO_AUTH") == "1",
		},
		Storage: StorageConfig{
			DataDir:      envOr("DATA_DIR", "./data"),
			DriveCacheMB: envInt("DRIVE_CACHE_MB", 2048),
		},
		Jobs: JobsConfig{
			Workers:      envInt("JOB_WORKERS", 2),
			LeaseSeconds: envInt("JOB_LEASE_SECONDS", 120),
		},
		Engines: EnginesConfig{
			STTURL:          env("STT_URL"),
			STTModel:        envOr("STT_MODEL", "Systran/faster-whisper-small"),
			STTDailyMinutes: envInt("STT_DAILY_MINUTES", 120),
			TTSURL:          env("TTS_URL"),
			TTSDailyMinutes: envInt("TTS_DAILY_MINUTES", 60),
			YTDLP:           envOr("YTDLP_BIN", "yt-dlp"),
			FFmpeg:          envOr("FFMPEG_BIN", "ffmpeg"),
		},
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// Validate enforces the fail-closed boot contract.
func (c *Config) Validate() error {
	var missing []string

	if c.Database.DSN == "" {
		missing = append(missing, EnvPrefix+"POSTGRES_DSN")
	}
	if c.Security.EncryptionKey == "" {
		missing = append(missing, EnvPrefix+"ENCRYPTION_KEY")
	}
	if c.Security.GatewayToken == "" && !c.Security.AllowNoAuth {
		missing = append(missing, EnvPrefix+"GATEWAY_TOKEN")
	}

	if len(missing) > 0 {
		return fmt.Errorf("%w: %s", ErrMissingSecret, strings.Join(missing, ", "))
	}

	if c.Storage.DataDir == "" {
		return fmt.Errorf("%w%sDATA_DIR must not be empty", errRefused, EnvPrefix)
	}
	r2, err := LoadR2()
	if err != nil {
		return err
	}
	c.Storage.R2 = r2
	if c.Jobs.Workers < 1 {
		c.Jobs.Workers = 1
	}
	if u := c.Engines.STTURL; u != "" {
		// The operator's own setting, on the compose network: http is fine,
		// anything that is not an absolute http(s) URL is a typo to report now.
		parsed, err := url.Parse(u)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return fmt.Errorf("%w%sSTT_URL must be an http(s) URL such as http://stt:8000", errRefused, EnvPrefix)
		}
	}
	if c.Engines.STTDailyMinutes < 0 {
		c.Engines.STTDailyMinutes = 0
	}
	if u := c.Engines.TTSURL; u != "" {
		parsed, err := url.Parse(u)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return fmt.Errorf("%w%sTTS_URL must be an http(s) URL such as http://tts:8880", errRefused, EnvPrefix)
		}
	}
	if c.Engines.TTSDailyMinutes < 0 {
		c.Engines.TTSDailyMinutes = 0
	}
	if c.Jobs.LeaseSeconds < 10 {
		// A lease shorter than one provider call is a lease the reaper steals
		// mid-parse, over and over, until the job runs out of attempts.
		c.Jobs.LeaseSeconds = 10
	}

	// A present-but-unusable key must fail HERE, naming the variable. Without
	// this, boot gets as far as the sentinel check and reports a key MISMATCH —
	// which reads as "you used the wrong key" and sends the operator hunting for
	// the right one, when the real problem is that this value is not a key at
	// all (wrong length, a passphrase, a truncated paste).
	if _, err := crypto.DeriveKey(c.Security.EncryptionKey); err != nil {
		return fmt.Errorf("%w%sENCRYPTION_KEY is not a valid key: %w", errRefused, EnvPrefix, err)
	}

	// ALLOW_NO_AUTH removes the only thing standing between the API and any
	// process that can reach its port. It is a local-development affordance;
	// letting it through with a production-looking environment would turn a
	// convenience into an unauthenticated API.
	if c.Security.AllowNoAuth && isProductionEnv() {
		return fmt.Errorf("%wALLOW_NO_AUTH=1 is refused when %sENV is production", errRefused, EnvPrefix)
	}

	return nil
}

var errRefused = errors.New("config: ")

// IsDevelopmentEnv reports whether ANYTOOLS_ENV is exactly "development" — not
// merely unset or not-production. Development-only conveniences (the local
// sign-in) key on this, so an unset variable on a server never enables them.
func IsDevelopmentEnv() bool { return strings.ToLower(env("ENV")) == "development" }

func isProductionEnv() bool {
	v := strings.ToLower(env("ENV"))
	return v == "production" || v == "prod"
}

func env(suffix string) string { return strings.TrimSpace(Getenv(EnvPrefix + suffix)) }

func envOr(suffix, def string) string {
	if v := env(suffix); v != "" {
		return v
	}
	return def
}

func envInt(suffix string, def int) int {
	v := env(suffix)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
