package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/chesslab/backend/internal/chess"
	"github.com/go-chi/chi/v5"
)

type LoadPGNRequest struct {
	PGN string `json:"pgn"`
}

// LoadPGNResponse is the game state after loading, plus how far the parse got
// — a malformed/illegal token stops the load but keeps whatever prefix of
// moves applied cleanly (same spirit as Lichess's PGN paste).
type LoadPGNResponse struct {
	GameStateJSON
	AppliedPlies int    `json:"appliedPlies"`
	TotalTokens  int    `json:"totalTokens"`
	Error        string `json:"error,omitempty"`
}

var moveNumberPrefix = regexp.MustCompile(`^\d+\.+`)

// LoadPGN replays a pasted PGN move list from the start position, rebuilding
// the move tree via the same Game.ApplyMove used by normal play (so it goes
// through the same tree/sideline semantics, not a separate code path).
func (h *Handler) LoadPGN(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}

	var req LoadPGNRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	tokens := tokenizePGNMoves(req.PGN)
	if len(tokens) == 0 {
		http.Error(w, "no moves found in pgn", http.StatusBadRequest)
		return
	}

	g.Reset()

	applied := 0
	var loadErr string
	for _, tok := range tokens {
		m, ok := findLegalMoveBySAN(g.Pos, tok)
		if !ok {
			loadErr = fmt.Sprintf("move %d (%q) is illegal or unrecognized in this position", applied+1, tok)
			break
		}
		if err := g.ApplyMove(m); err != nil {
			loadErr = fmt.Sprintf("move %d (%q) failed: %v", applied+1, tok, err)
			break
		}
		applied++
	}

	h.store.Save(g)

	status := http.StatusOK
	if loadErr != "" {
		status = http.StatusUnprocessableEntity
	}
	respondJSON(w, status, LoadPGNResponse{
		GameStateJSON: toGameState(g),
		AppliedPlies:  applied,
		TotalTokens:   len(tokens),
		Error:         loadErr,
	})
}

// tokenizePGNMoves strips comments, NAGs, result markers, variations, and
// move-number labels from a pasted PGN, leaving just the ordered SAN tokens.
func tokenizePGNMoves(pgn string) []string {
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

// findLegalMoveBySAN matches a pasted SAN token against the position's legal
// moves, tolerating trailing annotations ("Nf3!?", "Bd7+") and the "0-0"
// castling spelling some PGN exporters use instead of "O-O".
func findLegalMoveBySAN(pos *chess.Position, token string) (chess.Move, bool) {
	want := normalizeSANToken(token)
	if want == "" {
		return chess.Move{}, false
	}
	for _, m := range chess.GenerateLegalMoves(pos) {
		san := normalizeSANToken(chess.SAN(pos, m))
		if strings.EqualFold(san, want) {
			return m, true
		}
	}
	return chess.Move{}, false
}

func normalizeSANToken(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "+#!?")
	switch s {
	case "0-0":
		return "O-O"
	case "0-0-0":
		return "O-O-O"
	}
	return s
}
