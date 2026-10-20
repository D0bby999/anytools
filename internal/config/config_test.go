package config

import (
	"errors"
	"strings"
	"testing"
)

func setEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		t.Setenv(EnvPrefix+k, v)
	}
}

func TestLoadSucceedsWithAllSecrets(t *testing.T) {
	setEnv(t, map[string]string{
		"POSTGRES_DSN":   "postgres://localhost/anytools_test?sslmode=disable",
		"ENCRYPTION_KEY": "0123456789abcdef0123456789abcdef",
		"GATEWAY_TOKEN":  "gw-token",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server.Addr != ":8080" {
		t.Fatalf("default addr: %q", cfg.Server.Addr)
	}
}

// Boot must fail, not degrade, when a secret is absent.
func TestLoadFailsClosedPerSecret(t *testing.T) {
	base := map[string]string{
		"POSTGRES_DSN":   "postgres://localhost/anytools_test?sslmode=disable",
		"ENCRYPTION_KEY": "0123456789abcdef0123456789abcdef",
		"GATEWAY_TOKEN":  "gw-token",
	}
	for _, missing := range []string{"POSTGRES_DSN", "ENCRYPTION_KEY", "GATEWAY_TOKEN"} {
		t.Run(missing, func(t *testing.T) {
			env := map[string]string{}
			for k, v := range base {
				env[k] = v
			}
			env[missing] = ""
			setEnv(t, env)

			_, err := Load()
			if !errors.Is(err, ErrMissingSecret) {
				t.Fatalf("want ErrMissingSecret, got %v", err)
			}
			if !strings.Contains(err.Error(), EnvPrefix+missing) {
				t.Fatalf("error should name %s, got %v", EnvPrefix+missing, err)
			}
		})
	}
}

func TestAllowNoAuthDropsGatewayTokenRequirementLocally(t *testing.T) {
	setEnv(t, map[string]string{
		"POSTGRES_DSN":   "postgres://localhost/anytools_test?sslmode=disable",
		"ENCRYPTION_KEY": "0123456789abcdef0123456789abcdef",
		"GATEWAY_TOKEN":  "",
		"ALLOW_NO_AUTH":  "1",
		"ENV":            "development",
	})
	if _, err := Load(); err != nil {
		t.Fatalf("dev escape hatch should load: %v", err)
	}
}

// The dev escape hatch must not survive into production, where it would leave
// the API unauthenticated to anything that can reach its port.
func TestAllowNoAuthRefusedInProduction(t *testing.T) {
	setEnv(t, map[string]string{
		"POSTGRES_DSN":   "postgres://localhost/anytools_test?sslmode=disable",
		"ENCRYPTION_KEY": "0123456789abcdef0123456789abcdef",
		"GATEWAY_TOKEN":  "gw-token",
		"ALLOW_NO_AUTH":  "1",
		"ENV":            "production",
	})
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "ALLOW_NO_AUTH") {
		t.Fatalf("want refusal naming ALLOW_NO_AUTH, got %v", err)
	}
}

// Secrets must never be serializable: a `json:"-"` tag regression would put the
// encryption key into any response that embeds Config.
func TestSecretsAreNotSerializable(t *testing.T) {
	setEnv(t, map[string]string{
		"POSTGRES_DSN":   "postgres://u:p@localhost/anytools_test?sslmode=disable",
		"ENCRYPTION_KEY": "0123456789abcdef0123456789abcdef",
		"GATEWAY_TOKEN":  "gw-token-secret",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	blob := mustJSON(t, cfg)
	for _, secret := range []string{"gw-token-secret", "0123456789abcdef0123456789abcdef", "u:p@localhost"} {
		if strings.Contains(blob, secret) {
			t.Fatalf("secret %q leaked into JSON: %s", secret, blob)
		}
	}
}

// R2 is all four settings or none; its credentials never reach JSON.
func TestR2IsAllOrNothingAndItsKeysStaySecret(t *testing.T) {
	base := map[string]string{
		"POSTGRES_DSN":   "postgres://localhost/anytools_test?sslmode=disable",
		"ENCRYPTION_KEY": "0123456789abcdef0123456789abcdef",
		"GATEWAY_TOKEN":  "gw-token",
	}
	setEnv(t, base)
	setEnv(t, map[string]string{"R2_BUCKET": "anytools-media", "R2_ACCOUNT_ID": "acct"})
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "R2_SECRET_ACCESS_KEY") {
		t.Fatalf("a partial R2 setting = %v, want a refusal naming the variables", err)
	}
	setEnv(t, map[string]string{"R2_ACCESS_KEY_ID": "r2-key-id-secret", "R2_SECRET_ACCESS_KEY": "r2-secret-value"})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.Storage.R2.Enabled() || cfg.Storage.R2.Bucket != "anytools-media" {
		t.Fatalf("R2 = %+v", cfg.Storage.R2.Bucket)
	}
	blob := mustJSON(t, cfg)
	for _, secret := range []string{"r2-key-id-secret", "r2-secret-value"} {
		if strings.Contains(blob, secret) {
			t.Fatalf("secret %q leaked into JSON", secret)
		}
	}
}

// A present-but-unusable key must fail at config load, naming the variable.
// Without this the failure surfaces later as a sentinel MISMATCH, which reads
// as "you used the wrong key" and sends the operator hunting for a different
// one when the real problem is that this value is not a key at all.
func TestLoadRejectsAnUnusableEncryptionKey(t *testing.T) {
	for name, key := range map[string]string{
		"too short":     "short",
		"passphrase":    "correct-horse-battery-staple",
		"truncated hex": "00112233445566778899aabbccddee",
		"63 hex chars":  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeef",
		"33 raw bytes":  "0123456789abcdef0123456789abcdefX",
	} {
		t.Run(name, func(t *testing.T) {
			setEnv(t, map[string]string{
				"POSTGRES_DSN":   "postgres://localhost/anytools_test?sslmode=disable",
				"ENCRYPTION_KEY": key,
				"GATEWAY_TOKEN":  "gw-token",
			})
			_, err := Load()
			if err == nil {
				t.Fatalf("key %q was accepted", key)
			}
			if !strings.Contains(err.Error(), "ENCRYPTION_KEY") {
				t.Fatalf("error should name ENCRYPTION_KEY, got %v", err)
			}
		})
	}
}

// The valid forms must keep loading — a stricter check that rejects real keys
// would be worse than no check.
func TestLoadAcceptsEveryValidEncryptionKeyForm(t *testing.T) {
	for name, key := range map[string]string{
		"raw 32 bytes": "0123456789abcdef0123456789abcdef",
		"hex 64":       "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
		"base64 44":    "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
	} {
		t.Run(name, func(t *testing.T) {
			setEnv(t, map[string]string{
				"POSTGRES_DSN":   "postgres://localhost/anytools_test?sslmode=disable",
				"ENCRYPTION_KEY": key,
				"GATEWAY_TOKEN":  "gw-token",
			})
			if _, err := Load(); err != nil {
				t.Fatalf("valid key %q rejected: %v", name, err)
			}
		})
	}
}

func TestDevelopmentMeansExactlyDevelopment(t *testing.T) {
	for v, want := range map[string]bool{"development": true, "Development": true, "": false, "dev": false, "production": false, "staging": false} {
		t.Setenv("ANYTOOLS_ENV", v)
		if got := IsDevelopmentEnv(); got != want {
			t.Errorf("ANYTOOLS_ENV=%q: IsDevelopmentEnv = %v, want %v", v, got, want)
		}
	}
}

// Up-methods phase 21: the built-in engines' settings. No URL means no
// built-in transcription; a URL that is not http(s) is a typo refused at boot.
func TestEngineSettings(t *testing.T) {
	setEnv(t, map[string]string{
		"POSTGRES_DSN":   "postgres://localhost/anytools_test?sslmode=disable",
		"ENCRYPTION_KEY": "0123456789abcdef0123456789abcdef",
		"GATEWAY_TOKEN":  "gw-token",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	e := cfg.Engines
	if e.STTURL != "" || e.STTModel != "Systran/faster-whisper-small" || e.STTDailyMinutes != 120 ||
		e.YTDLP != "yt-dlp" || e.FFmpeg != "ffmpeg" {
		t.Fatalf("defaults %+v", e)
	}
	t.Setenv(EnvPrefix+"STT_URL", "http://stt:8000")
	t.Setenv(EnvPrefix+"STT_DAILY_MINUTES", "45")
	if cfg, err = Load(); err != nil || cfg.Engines.STTURL != "http://stt:8000" || cfg.Engines.STTDailyMinutes != 45 {
		t.Fatalf("set: %+v %v", cfg, err)
	}
	for _, bad := range []string{"stt:8000", "ftp://stt", "http://"} {
		t.Setenv(EnvPrefix+"STT_URL", bad)
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STT_URL") {
			t.Errorf("%q: %v", bad, err)
		}
	}
}

// Up-methods phase 22: the built-in voices' settings, refused the same way.
func TestSpeechEngineSettings(t *testing.T) {
	setEnv(t, map[string]string{
		"POSTGRES_DSN":   "postgres://localhost/anytools_test?sslmode=disable",
		"ENCRYPTION_KEY": "0123456789abcdef0123456789abcdef",
		"GATEWAY_TOKEN":  "gw-token",
	})
	cfg, err := Load()
	if err != nil || cfg.Engines.TTSURL != "" || cfg.Engines.TTSDailyMinutes != 60 {
		t.Fatalf("defaults %+v %v", cfg, err)
	}
	t.Setenv(EnvPrefix+"TTS_URL", "http://tts:8880")
	t.Setenv(EnvPrefix+"TTS_DAILY_MINUTES", "30")
	if cfg, err = Load(); err != nil || cfg.Engines.TTSURL != "http://tts:8880" || cfg.Engines.TTSDailyMinutes != 30 {
		t.Fatalf("set: %+v %v", cfg, err)
	}
	for _, bad := range []string{"tts:8880", "ftp://tts", "http://"} {
		t.Setenv(EnvPrefix+"TTS_URL", bad)
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "TTS_URL") {
			t.Errorf("%q: %v", bad, err)
		}
	}
}
