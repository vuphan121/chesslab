package chess

import "strings"

func FindLegalMoveBySAN(pos *Position, token string) (Move, bool) {
	want := normalizeSANToken(token)
	if want == "" {
		return Move{}, false
	}
	for _, m := range GenerateLegalMoves(pos) {
		san := normalizeSANToken(SAN(pos, m))
		if san == want {
			return m, true
		}
	}
	return Move{}, false
}

func normalizeSANToken(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "+#!?")
	switch s {
	case "0-0", "o-o":
		return "O-O"
	case "0-0-0", "o-o-o":
		return "O-O-O"
	}
	return s
}

