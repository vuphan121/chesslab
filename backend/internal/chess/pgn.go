package chess

import (
	"regexp"
	"strings"
)

var moveNumberPrefix = regexp.MustCompile(`^\d+\.+`)

// TokenizePGNMoves strips comments, NAGs, result markers, variations, and
// move-number labels from a pasted PGN, leaving just the ordered SAN tokens.
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

// stripParenVariations drops any parenthetical sidelines from the pasted PGN
// (nesting-aware) — only the mainline is loaded.
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

// FindLegalMoveBySAN matches a pasted SAN token against the position's legal
// moves, tolerating trailing annotations ("Nf3!?", "Bd7+") and the "0-0"/"o-o"
// castling spellings some PGN exporters use instead of "O-O". Comparison is
// case-SENSITIVE beyond that normalization — SAN case is semantically load-
// bearing (piece letter vs. pawn-capture file letter), and "b" is exactly the
// one file letter that collides with a piece letter ("B" for bishop). A
// case-insensitive match here would let a bishop capture like "Bxc6" match a
// legal pawn capture "bxc6" (or vice versa) whenever both are legal in the
// position, silently replaying the wrong move — a real bug caught via a
// repertoire chapter whose recorded line was 9...Bxc6 10.Qxc6+ bxc6, which a
// case-insensitive matcher could resolve as 9...bxc6 10.Qxc6 Bxc6 instead.
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

// ReplayLine parses and replays a sequence of SAN tokens (as produced by
// TokenizePGNMoves) from the start position, returning the FEN after each ply
// in order. Stops at the first illegal/unrecognized token, returning
// whatever prefix replayed cleanly — callers that need to know whether the
// whole line replayed should compare len(result) to len(tokens).
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
