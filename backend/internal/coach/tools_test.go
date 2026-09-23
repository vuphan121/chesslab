package coach

import (
	"strings"
	"testing"
)

func TestAnalyzePositionRejectsInvalidFENBeforeCallingProviders(t *testing.T) {
	tools := NewTools(nil, nil, nil)

	_, err := tools.AnalyzePosition("not a fen")
	if err == nil {
		t.Fatal("AnalyzePosition accepted an invalid FEN")
	}
	if !strings.Contains(err.Error(), "invalid fen") {
		t.Fatalf("AnalyzePosition error = %q, want an invalid FEN error", err)
	}
}
