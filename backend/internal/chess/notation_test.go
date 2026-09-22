package chess

import "testing"

// Three white knights: c3 (the mover), c7 (shares c3's file), b4 (shares
// neither c3's file nor its rank) can all reach d5. Real SAN needs only the
// rank ("N3d5") since no competitor shares c3's rank — file alone wouldn't
// disambiguate against c7, but rank alone disambiguates against both. An
// earlier version of this logic decided needFile/needRank independently per
// competitor instead of across all of them, which over-qualified this exact
// shape (some competitor shares file, a different competitor doesn't) into
// the full square "Nc3d5".
func TestSANDisambiguationThreeCompetitors(t *testing.T) {
	fen := "7k/2N5/8/1N6/8/2N5/8/7K w - - 0 1"
	pos, err := ParseFEN(fen)
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	move := Move{From: ParseSquare("c3"), To: ParseSquare("d5"), Flag: Normal}
	if got, want := SAN(pos, move), "N3d5"; got != want {
		t.Fatalf("SAN(c3-d5) = %q, want %q", got, want)
	}
}
