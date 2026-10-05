package api

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestPuzzleSyncIsOnlyForTheAccountItIsLinkedTo(t *testing.T) {
	t.Setenv("AUTH_USERNAME", "owner")
	t.Setenv("LICHESS_USERNAME", "owners-lichess")
	t.Setenv("LICHESS_PUZZLE_TOKEN", "token")

	if !puzzleSyncAvailableTo("owner") {
		t.Error("the linked account should see puzzle sync")
	}
	for _, other := range []string{"manh", "", "OWNER", "owner "} {
		if puzzleSyncAvailableTo(other) {
			t.Errorf("account %q must not see puzzle sync", other)
		}
	}

	h := &Handler{}
	if _, err := h.syncPuzzles(context.Background(), "manh"); !errors.Is(err, errPuzzleSyncNotLinked) {
		t.Errorf("another account's sync must be refused before anything is fetched, got %v", err)
	}
	if got := syncErrorStatus(errPuzzleSyncNotLinked); got != http.StatusForbidden {
		t.Errorf("not linked should be 403, got %d", got)
	}
}

func TestPuzzleSyncNeedsTheLichessSettings(t *testing.T) {
	t.Setenv("AUTH_USERNAME", "owner")
	t.Setenv("LICHESS_USERNAME", "")
	t.Setenv("LICHESS_PUZZLE_TOKEN", "")
	if puzzleSyncAvailableTo("owner") {
		t.Error("without the Lichess settings nobody has puzzle sync")
	}
	h := &Handler{}
	if _, err := h.syncPuzzles(context.Background(), "owner"); !errors.Is(err, errPuzzleSyncNotConfigured) {
		t.Errorf("expected not configured, got %v", err)
	}
}
