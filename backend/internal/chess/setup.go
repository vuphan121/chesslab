package chess

import (
	"fmt"
	"strings"
)

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
