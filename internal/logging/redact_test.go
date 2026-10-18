package logging

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"
)

func TestSecretsNeverReachTheLog(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(NewRedactingHandler(slog.NewJSONHandler(&buf, nil))).With("gateway_token", "gw-abcdef")

	secrets := []string{
		"gw-abcdef",
		"sk-proj-ABCDEFGHIJKLMNOPQRSTUV",
		"sk-ant-api03-ABCDEFGHIJKLMNOP",
		"AIzaSyA1234567890abcdefghijklmnopqrstu",
		"ya29.a0AfH6SMBabcdefghijklmnopqrstuvwxyz",
		"1//0gABCDEFGHIJKLMNOPQRSTUVWXYZ",
		"ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
		"tvly-ABCDEFGHIJKLMNOPQRS",
		"hunter2",
		"s3cr3t-cookie-value",
		"dbpass",
		"oa-QUERYKEY-1234",
		"ZOTEROKEY0PATH0000000000",
		"github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
		"gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123",
		"AIzaSyYOUTUBEDATA567890abcdefghijklmn",
		"ADPycdDRIVESESSION0123",
	}

	log.Info("provider refused Bearer sk-proj-ABCDEFGHIJKLMNOPQRSTUV",
		"error", errors.New(`openai: 401 {"error":"Incorrect API key provided: sk-ant-api03-ABCDEFGHIJKLMNOP"}`),
		"url", "https://generativelanguage.googleapis.com/v1?key=AIzaSyA1234567890abcdefghijklmnopqrstu",
		"refresh_token", "1//0gABCDEFGHIJKLMNOPQRSTUVWXYZ",
		slog.Group("oauth", "access_token", "ya29.a0AfH6SMBabcdefghijklmnopqrstuvwxyz"),
		"note", "pushed with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 and tvly-ABCDEFGHIJKLMNOPQRS",
		"password", "hunter2",
		"Cookie", "s3cr3t-cookie-value",
		"dsn_hint", "postgres://anytools:dbpass@postgres:5432/anytools",
		"error2", errors.New(`Get "https://api.openalex.org/works?search=rag&api_key=oa-QUERYKEY-1234": dial tcp: i/o timeout`),
		"error3", errors.New(`Get "https://api.zotero.org/keys/ZOTEROKEY0PATH0000000000": dial tcp: i/o timeout`),
		// up methods, sources: the github, stt (Groq) and youtube_data keys.
		"error4", errors.New(`github: 401 for github_pat_11ABCDEFG0123456789_abcdefghijklmnop`),
		"error5", errors.New(`groq: 401 {"error":{"message":"Invalid API Key gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"}}`),
		"error6", errors.New(`Get "https://www.googleapis.com/youtube/v3/playlistItems?key=AIzaSyYOUTUBEDATA567890abcdefghijklmn": EOF`),
		// drive-user-storage: a resumable session URL is a credential for its upload.
		"error7", errors.New(`Put "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=ADPycdDRIVESESSION0123": EOF`),
	)

	out := buf.String()
	for _, s := range secrets {
		if strings.Contains(out, s) {
			t.Errorf("log line contains %q:\n%s", s, out)
		}
	}
	// What is not a secret survives: the redaction must not blind the logs.
	for _, keep := range []string{"provider refused", "generativelanguage.googleapis.com", "openai: 401", "postgres:5432/anytools", "api.zotero.org"} {
		if !strings.Contains(out, keep) {
			t.Errorf("redaction removed %q, which is not a secret:\n%s", keep, out)
		}
	}
}

func TestUsageCountsAreNotMistakenForTokens(t *testing.T) {
	var buf bytes.Buffer
	slog.New(NewRedactingHandler(slog.NewJSONHandler(&buf, nil))).Info("turn", "prompt_tokens", 900, "total_tokens", 920)
	if !strings.Contains(buf.String(), `"prompt_tokens":900`) {
		t.Fatalf("a token COUNT was redacted: %s", buf.String())
	}
}
