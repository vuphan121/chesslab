package api

import (
	"encoding/json"
	"fmt"
	"net/http"

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

// LoadPGN replays a pasted PGN move list from the start position, rebuilding
// the move tree via the same Game.ApplyMove used by normal play (so it goes
// through the same tree/sideline semantics, not a separate code path).
// Tokenizing and SAN matching live in the chess package (chess.go/pgn.go) —
// shared with the coach corpus's prefix-position indexing, see coach/index.go.
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

	tokens := chess.TokenizePGNMoves(req.PGN)
	if len(tokens) == 0 {
		http.Error(w, "no moves found in pgn", http.StatusBadRequest)
		return
	}

	g.Reset()

	applied := 0
	var loadErr string
	for _, tok := range tokens {
		m, ok := chess.FindLegalMoveBySAN(g.Pos, tok)
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
