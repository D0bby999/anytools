package pg

import (
	"fmt"

	"github.com/D0bby999/anytools/internal/crypto"
)

// encrypt_helper.go — the one way this package encrypts a secret before storage.
//
// Ported from postclaw internal/store/pg/encrypt_helper.go with its incident
// comment intact, because the incident is the reason the helper exists:
//
// Every store there used to inline `if s.encKey != "" { crypto.Encrypt(...) }`,
// eleven times across five files. That guard reads like a safety check but is
// the opposite: with no key configured it SKIPS encryption and stores the raw
// value. The result was OAuth tokens, channel credentials and config secrets
// written in the clear with no error and no log line.
//
// AnyTools starts with the correct pattern extracted, so no store in phases
// 2..13 can copy the wrong one.

// encryptOrFail encrypts value for storage, refusing to proceed when no key is
// configured.
//
// Empty value is a no-op: there is nothing to protect, so a missing key is
// irrelevant (this keeps optional columns — refresh tokens, secondary tokens —
// working exactly as before).
//
// field names the column being encrypted and appears in the error so a failure
// points at the specific write, never at the value itself.
func encryptOrFail(value, encKey, field string) (string, error) {
	if value == "" {
		return "", nil
	}
	if encKey == "" {
		return "", fmt.Errorf("cannot store %s: %w", field, crypto.ErrNoEncryptionKey)
	}

	encrypted, err := crypto.Encrypt(value, encKey)
	if err != nil {
		return "", fmt.Errorf("encrypt %s: %w", field, err)
	}
	return encrypted, nil
}
