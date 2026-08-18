package chess

import (
	"regexp"
	"strings"
)

var moveNumberPrefix = regexp.MustCompile(`^\d+\.+`)

func TokenizePGNMoves(pgn string) []string {
	s := stripBraceComments(pgn)
	s = stripLineComments(s)
	s = stripParenVariations(s)

	fields := strings.Fields(s)
	moves := make([]string, 0, len(fields))
	for _, f := range fields {
		if isResultToken(f) || strings.HasPrefix(f, "$") {
			continue
		}
		f = moveNumberPrefix.ReplaceAllString(f, "")
		if f == "" {
			continue
		}
		moves = append(moves, f)
	}
	return moves
}

func stripBraceComments(s string) string {
	var sb strings.Builder
	depth := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 {
				sb.WriteByte(s[i])
			}
		}
	}
	return sb.String()
}

func stripLineComments(s string) string {
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		if idx := strings.Index(l, ";"); idx >= 0 {
			lines[i] = l[:idx]
		}
	}
	return strings.Join(lines, " ")
}

func stripParenVariations(s string) string {
	var sb strings.Builder
	depth := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '(':
			depth++
		case ')':
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 {
				sb.WriteByte(s[i])
			}
		}
	}
	return sb.String()
}

func isResultToken(f string) bool {
	switch f {
	case "1-0", "0-1", "1/2-1/2", "*":
		return true
	}
	return false
}

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

func ReplayLine(tokens []string) []string {
	pos, err := ParseFEN(StartFEN)
	if err != nil {
		return nil
	}
	fens := make([]string, 0, len(tokens))
	for _, tok := range tokens {
		m, ok := FindLegalMoveBySAN(pos, tok)
		if !ok {
			break
		}
		pos = applyMove(pos, m)
		fens = append(fens, FEN(pos))
	}
	return fens
}
