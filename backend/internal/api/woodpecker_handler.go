package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/woodpecker"
)

const maxWoodpeckerDurationMs = 24 * 60 * 60 * 1000

type woodpeckerStateResponse struct {
	Cycle  int `json:"cycle"`
	Next   int `json:"next"`
	Done   int `json:"done"`
	Solved int `json:"solved"`
	Total  int `json:"total"`
}

type woodpeckerPuzzleResponse struct {
	Number int    `json:"number"`
	FEN    string `json:"fen"`
	Moves  string `json:"moves"`
}

type woodpeckerAttemptRequest struct {
	OperationID  string `json:"operationId"`
	Cycle        int    `json:"cycle"`
	PuzzleNumber int    `json:"puzzleNumber"`
	Solved       bool   `json:"solved"`
	Outcome      string `json:"outcome"`
	DurationMs   int    `json:"durationMs"`
}

func (h *Handler) woodpeckerUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	if h.db == nil {
		http.Error(w, "woodpecker requires database sync", http.StatusServiceUnavailable)
		return "", false
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return "", false
	}
	return username, true
}

func (h *Handler) GetWoodpeckerState(w http.ResponseWriter, r *http.Request) {
	username, ok := h.woodpeckerUser(w, r)
	if !ok {
		return
	}
	st, err := h.db.WoodpeckerState(r.Context(), username, woodpecker.Total())
	if err != nil {
		http.Error(w, "failed to load progress: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, woodpeckerStateResponse{Cycle: st.Cycle, Next: st.Next, Done: st.Done, Solved: st.Solved, Total: woodpecker.Total()})
}

func (h *Handler) GetWoodpeckerPuzzle(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.woodpeckerUser(w, r); !ok {
		return
	}
	n, err := strconv.Atoi(chi.URLParam(r, "number"))
	if err != nil {
		http.Error(w, "invalid puzzle number", http.StatusBadRequest)
		return
	}
	p, found := woodpecker.Get(n)
	if !found {
		http.Error(w, "unknown puzzle", http.StatusNotFound)
		return
	}
	moves := ""
	for i, m := range p.SolutionUCI {
		if i > 0 {
			moves += " "
		}
		moves += m
	}
	respondJSON(w, http.StatusOK, woodpeckerPuzzleResponse{Number: p.Number, FEN: p.FEN, Moves: moves})
}

func (h *Handler) SubmitWoodpeckerAttempt(w http.ResponseWriter, r *http.Request) {
	username, ok := h.woodpeckerUser(w, r)
	if !ok {
		return
	}
	var req woodpeckerAttemptRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OperationID == "" || len(req.OperationID) > 100 ||
		req.Cycle < 1 || req.PuzzleNumber < 1 || req.PuzzleNumber > woodpecker.Total() ||
		!validWoodpeckerOutcome(req.Outcome, req.Solved) || req.DurationMs < 0 || req.DurationMs > maxWoodpeckerDurationMs {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.db.RecordWoodpeckerAttempt(r.Context(), username, req.OperationID, req.Cycle, req.PuzzleNumber, req.Solved, req.Outcome, req.DurationMs); err != nil {
		http.Error(w, "failed to save the attempt: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func validWoodpeckerOutcome(outcome string, solved bool) bool {
	switch outcome {
	case "solved":
		return solved
	case "mistake", "gave_up":
		return !solved
	}
	return false
}
