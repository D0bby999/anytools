// Package crypto provides AES-256-GCM encryption for sensitive data
// (BYOK API keys, OAuth tokens).
//
// Ported verbatim from postclaw internal/crypto/aes.go — including the
// fail-closed behavior of Encrypt, which exists because the previous version
// returned plaintext with a nil error when no key was configured. Every caller
// that did not separately check the key wrote secrets to Postgres in the clear
// with no error and no log line. Failing closed converts a silent
// confidentiality breach into a loud, obvious failure.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
)

const prefix = "aes-gcm:"

// ErrNoEncryptionKey is returned by Encrypt when there is something to protect
// but no key to protect it with.
var ErrNoEncryptionKey = errors.New("crypto: encryption key not configured (set ANYTOOLS_ENCRYPTION_KEY)")

// ErrDecryptFailed is returned when the ciphertext does not authenticate under
// the configured key. It is a distinct sentinel so the boot-time decrypt smoke
// test can tell "wrong key" apart from "database unreachable".
var ErrDecryptFailed = errors.New("crypto: decrypt failed — wrong key or corrupted data")

// Encrypt encrypts plaintext using AES-256-GCM.
// Returns "aes-gcm:" + base64(nonce + ciphertext + tag).
//
// Empty plaintext is a no-op (nothing to protect). A missing key with non-empty
// plaintext is an ERROR — see ErrNoEncryptionKey.
func Encrypt(plaintext, key string) (string, error) {
	if plaintext == "" {
		return plaintext, nil
	}
	if key == "" {
		return "", ErrNoEncryptionKey
	}

	keyBytes, err := DeriveKey(key)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return prefix + base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decrypts ciphertext produced by Encrypt.
//
// A value WITHOUT the "aes-gcm:" prefix is returned as-is: this database starts
// empty, but a column can still legitimately hold a non-secret default, and the
// prefix is what marks a value as claiming to be encrypted.
//
// A value WITH the prefix that does not decrypt is an ERROR, never a
// passthrough. postclaw's version returned malformed base64 and short payloads
// as plaintext, so a corrupted secrets column handed the caller its own
// ciphertext back and the caller used it as a key. From phase 4 these columns
// hold real BYOK credentials; the only safe answer to "this does not decrypt"
// is to say so.
func Decrypt(ciphertext, key string) (string, error) {
	if key == "" || ciphertext == "" {
		return ciphertext, nil
	}

	if !IsEncrypted(ciphertext) {
		return ciphertext, nil
	}

	keyBytes, err := DeriveKey(key)
	if err != nil {
		return "", err
	}

	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ciphertext, prefix))
	if err != nil {
		// It claimed to be encrypted and is not decodable — corruption, not
		// plaintext.
		return "", ErrDecryptFailed
	}

	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", ErrDecryptFailed // truncated: too short to even hold a nonce
	}

	plaintext, err := gcm.Open(nil, data[:nonceSize], data[nonceSize:], nil)
	if err != nil {
		return "", ErrDecryptFailed
	}

	return string(plaintext), nil
}

// IsEncrypted returns true if the value has the "aes-gcm:" encryption prefix.
func IsEncrypted(value string) bool {
	return strings.HasPrefix(value, prefix)
}

// DeriveKey converts the input string to a 32-byte AES key.
// Accepts: hex-encoded (64 chars), base64-encoded (44 chars), or raw 32 bytes.
func DeriveKey(input string) ([]byte, error) {
	// Hex-encoded: 64 hex chars = 32 bytes
	if len(input) == 64 {
		if b, err := hex.DecodeString(input); err == nil {
			return b, nil
		}
	}

	// Base64-encoded: 44 chars = 32 bytes
	if len(input) == 44 && strings.HasSuffix(input, "=") {
		if b, err := base64.StdEncoding.DecodeString(input); err == nil && len(b) == 32 {
			return b, nil
		}
	}

	// Raw 32 bytes
	if len(input) == 32 {
		return []byte(input), nil
	}

	return nil, errors.New("encryption key must be 32 bytes (hex-encoded 64 chars, base64 44 chars, or raw 32 bytes)")
}
