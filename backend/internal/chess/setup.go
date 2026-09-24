package chess

import (
	"fmt"
	"strings"
)

// NormalizeSetupCastling rewrites a set-up position's castling field so it
// matches piece placement. A side keeps a castling right exactly when its king
// and that rook are both on their original squares. Diagrams in books and
// Lichess study chapters starting from a custom FEN often leave the field as
// "-" even when castling is obviously still available, or claim a right whose
// rook isn't there. Only use this for a position someone set up, never for one
// reached by playing moves: there, a king or rook that moved and came back has
// genuinely lost the right.
//
// Every other field is passed through unchanged, so a FEN whose castling
// field is already right comes back byte-for-byte identical.
func NormalizeSetupCastling(fen string) (string, error) {
	pos, err := ParseFEN(fen)
	if err != nil {
		return "", err
	}
	fields := strings.Fields(fen)
	if len(fields) < 3 {
		return "", fmt.Errorf("FEN %q has no castling field", fen)
	}

	at := func(file, rank int, t PieceType, c Color) bool {
		p := pos.Board[NewSquare(file, rank)]
		return p != nil && p.Type == t && p.Color == c
	}
	rights := ""
	if at(4, 0, King, White) {
		if at(7, 0, Rook, White) {
			rights += "K"
		}
		if at(0, 0, Rook, White) {
			rights += "Q"
		}
	}
	if at(4, 7, King, Black) {
		if at(7, 7, Rook, Black) {
			rights += "k"
		}
		if at(0, 7, Rook, Black) {
			rights += "q"
		}
	}
	if rights == "" {
		rights = "-"
	}
	fields[2] = rights
	return strings.Join(fields, " "), nil
}
