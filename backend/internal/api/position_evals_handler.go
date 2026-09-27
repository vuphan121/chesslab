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
	Score     int                     `json:"score"`
	Mate      int                     `json:"mate"`
	Depth     int                     `json:"depth"`
	BestMoves []PositionEvalMoveJSON `json:"bestMoves,omitempty"`
}

// GetPositionEvals batch-looks-up precomputed opening-position evals (see
// internal/evalprecompute) for a set of FENs — the trainer fetches every
// ply of a just-finished line in one call the moment it goes into
// line-complete, rather than one round trip per position. Keyed in the
// response by the caller's own FEN string (not the stripped CardKey used
// internally), since the frontend already caches per-move data by full FEN
// (see MoveHistory's per-move eval cache) — a missing key just means "not
// computed yet", not an error, since the precompute cron may not have
// caught up to a brand-new line yet.
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
