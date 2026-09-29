package api

import (
	"encoding/json"
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

	var request struct {
		FENs []string `json:"fens"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid position eval request", http.StatusBadRequest)
		return
	}
	if len(request.FENs) == 0 {
		respondJSON(w, http.StatusOK, map[string]PositionEvalJSON{})
		return
	}

	keyToFENs := make(map[string][]string)
	keys := make([]string, 0, 16)
	for _, fen := range request.FENs {
		fen = strings.TrimSpace(fen)
		if fen == "" {
			continue
		}
		key := repertoire.CardKey(fen)
		if _, exists := keyToFENs[key]; !exists {
			keys = append(keys, key)
		}
		keyToFENs[key] = append(keyToFENs[key], fen)
	}

	evals, err := h.db.GetPositionEvals(r.Context(), keys)
	if err != nil {
		http.Error(w, "failed to load position evals: "+err.Error(), http.StatusInternalServerError)
		return
	}

	out := make(map[string]PositionEvalJSON, len(evals))
	for key, e := range evals {
		fens, ok := keyToFENs[key]
		if !ok {
			continue
		}
		var moves []PositionEvalMoveJSON
		for _, m := range e.BestMoves {
			moves = append(moves, PositionEvalMoveJSON{Rank: m.Rank, San: m.SAN, UCI: m.UCI, Score: m.Score, Mate: m.Mate})
		}
		value := PositionEvalJSON{Score: e.Score, Mate: e.Mate, Depth: e.Depth, BestMoves: moves}
		for _, fen := range fens {
			out[fen] = value
		}
	}
	respondJSON(w, http.StatusOK, out)
}
