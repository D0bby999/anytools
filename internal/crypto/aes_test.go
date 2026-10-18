package crypto

import (
	"errors"
	"strings"
	"testing"
)

const testKey = "0123456789abcdef0123456789abcdef" // raw 32 bytes

func TestEncryptDecryptRoundTrip(t *testing.T) {
	ct, err := Encrypt("sk-secret-value", testKey)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if !IsEncrypted(ct) {
		t.Fatalf("ciphertext missing prefix: %q", ct)
	}
	if strings.Contains(ct, "sk-secret-value") {
		t.Fatal("plaintext leaked into ciphertext")
	}
	pt, err := Decrypt(ct, testKey)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if pt != "sk-secret-value" {
		t.Fatalf("round trip mismatch: got %q", pt)
	}
}

// Encrypting with no key must fail loudly rather than silently storing the
// plaintext — the incident this whole package's fail-closed design exists for.
func TestEncryptWithoutKeyFailsClosed(t *testing.T) {
	_, err := Encrypt("sk-secret-value", "")
	if !errors.Is(err, ErrNoEncryptionKey) {
		t.Fatalf("want ErrNoEncryptionKey, got %v", err)
	}
}

func TestEncryptEmptyPlaintextIsNoOp(t *testing.T) {
	got, err := Encrypt("", "")
	if err != nil || got != "" {
		t.Fatalf("empty plaintext: got (%q, %v)", got, err)
	}
}

func TestDecryptWithWrongKeyFails(t *testing.T) {
	ct, err := Encrypt("sk-secret-value", testKey)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	_, err = Decrypt(ct, "fedcba9876543210fedcba9876543210")
	if !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("want ErrDecryptFailed, got %v", err)
	}
}

func TestDecryptPassesThroughUnencryptedValues(t *testing.T) {
	got, err := Decrypt("plain-value", testKey)
	if err != nil || got != "plain-value" {
		t.Fatalf("passthrough: got (%q, %v)", got, err)
	}
}

func TestDeriveKeyAcceptedForms(t *testing.T) {
	cases := map[string]string{
		"raw32": testKey,
		"hex64": "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
		"b64":   "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			b, err := DeriveKey(in)
			if err != nil {
				t.Fatalf("DeriveKey: %v", err)
			}
			if len(b) != 32 {
				t.Fatalf("want 32 bytes, got %d", len(b))
			}
		})
	}
}

func TestDeriveKeyRejectsShortKey(t *testing.T) {
	if _, err := DeriveKey("too-short"); err == nil {
		t.Fatal("want error for short key")
	}
}

// A value that CLAIMS to be encrypted and does not decrypt is corruption, not
// plaintext. postclaw's version returned malformed base64 and truncated
// payloads to the caller as if they were the secret — so a damaged BYOK column
// handed back its own ciphertext and the caller used it as a key.
func TestDecryptRefusesMalformedCiphertext(t *testing.T) {
	cases := map[string]string{
		"not base64":          "aes-gcm:!!!not-base64!!!",
		"too short for nonce": "aes-gcm:" + "AAAA",
		"empty payload":       "aes-gcm:",
	}
	for name, ct := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := Decrypt(ct, testKey)
			if err == nil {
				t.Fatalf("malformed ciphertext was accepted and returned %q", got)
			}
			if got != "" {
				t.Fatalf("a failed decrypt must return no value, got %q", got)
			}
		})
	}
}

// Values with no prefix are still passed through: a column can legitimately
// hold a non-secret default, and the prefix is what marks a claim to be
// encrypted.
func TestDecryptStillPassesThroughUnprefixedValues(t *testing.T) {
	got, err := Decrypt("not-a-secret", testKey)
	if err != nil || got != "not-a-secret" {
		t.Fatalf("passthrough broke: (%q, %v)", got, err)
	}
}
