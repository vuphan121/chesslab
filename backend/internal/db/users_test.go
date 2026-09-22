package db

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// VerifyUser runs a bcrypt compare against dummyHash when the username
// isn't found, so a missing user takes roughly as long to reject as a real
// one with a wrong password (otherwise response timing alone reveals which
// usernames exist). This just confirms the decoy hash is valid and usable —
// the actual DB-backed path isn't exercised here.
func TestDummyHashIsValidForTimingGuard(t *testing.T) {
	if len(dummyHash) == 0 {
		t.Fatal("mustDummyHash produced an empty hash")
	}
	if err := bcrypt.CompareHashAndPassword(dummyHash, []byte("anything")); err == nil {
		t.Fatal("expected the dummy hash not to match an arbitrary password")
	} else if err != bcrypt.ErrMismatchedHashAndPassword {
		t.Fatalf("expected a mismatched-hash error, got a malformed-hash error: %v", err)
	}
}
