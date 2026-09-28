package db

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

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
