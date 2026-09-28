package api

import (
	"net/http"
	"strings"

	"github.com/chesslab/backend/internal/repertoire"
)

type PositionEvalMoveJSON struct {
	Rank  int    `json:"rank"`
	San   string `json:"san"`
	UCI   string `json:"uci"`
	Score int    `json:"score"`
	Mate  int    `json:"mate"`
}

type PositionEvalJSON struct {
	Score     int                    `json:"score"`
	Mate      int                    `json:"mate"`
	Depth     int                    `json:"depth"`
	BestMoves []PositionEvalMoveJSON `json:"bestMoves,omitempty"`
}

func (h *Handler) GetPositionEvals(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "position evals require database sync", http.StatusServiceUnavailable)
		return
	}

	raw := r.URL.Query().Get("fens")
	if raw == "" {
		respondJSON(w, http.StatusOK, map[string]PositionEvalJSON{})
		return
	}

	keyToFen := make(map[string]string)
	keys := make([]string, 0, 16)
	for _, fen := range strings.Split(raw, ",") {
		fen = strings.TrimSpace(fen)
		if fen == "" {
			continue
		}
		key := repertoire.CardKey(fen)
		if _, exists := keyToFen[key]; !exists {
			keys = append(keys, key)
		}
		keyToFen[key] = fen
	}

	evals, err := h.db.GetPositionEvals(r.Context(), keys)
	if err != nil {
		http.Error(w, "failed to load position evals: "+err.Error(), http.StatusInternalServerError)
		return
	}

	out := make(map[string]PositionEvalJSON, len(evals))
	for key, e := range evals {
		fen, ok := keyToFen[key]
		if !ok {
			continue
		}
		var moves []PositionEvalMoveJSON
		for _, m := range e.BestMoves {
			moves = append(moves, PositionEvalMoveJSON{Rank: m.Rank, San: m.SAN, UCI: m.UCI, Score: m.Score, Mate: m.Mate})
		}
		out[fen] = PositionEvalJSON{Score: e.Score, Mate: e.Mate, Depth: e.Depth, BestMoves: moves}
	}
	respondJSON(w, http.StatusOK, out)
}
