package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/chesslab/backend/internal/woodpecker"
)

type woodpeckerRunResponse struct {
	Cycle     int        `json:"cycle"`
	Name      string     `json:"name"`
	StartedAt *time.Time `json:"startedAt"`
	LastAt    *time.Time `json:"lastAt"`
	Done      int        `json:"done"`
	Solved    int        `json:"solved"`
	Half      int        `json:"half"`
	GaveUp    int        `json:"gaveUp"`
	Skipped   int        `json:"skipped"`
	TotalMs   int64      `json:"totalMs"`
	AvgMs     int64      `json:"avgMs"`
	Total     int        `json:"total"`
}

type woodpeckerRunAttemptResponse struct {
	Puzzle     int    `json:"puzzle"`
	Solved     bool   `json:"solved"`
	Outcome    string `json:"outcome"`
	DurationMs int    `json:"durationMs"`
}

func (h *Handler) ListWoodpeckerRuns(w http.ResponseWriter, r *http.Request) {
	username, ok := h.woodpeckerUser(w, r)
	if !ok {
		return
	}
	runs, err := h.db.WoodpeckerRuns(r.Context(), username)
	if err != nil {
		http.Error(w, "failed to load runs: "+err.Error(), http.StatusInternalServerError)
		return
	}
	out := make([]woodpeckerRunResponse, 0, len(runs))
	for _, run := range runs {
		resp := woodpeckerRunResponse{
			Cycle: run.Cycle, Name: run.Name, StartedAt: run.StartedAt, LastAt: run.LastAt,
			Done: run.Done, Solved: run.Solved, Half: run.Half, GaveUp: run.GaveUp, Skipped: run.Skipped,
			TotalMs: run.TotalMs, Total: woodpecker.Total(),
		}
		if run.Timed > 0 {
			resp.AvgMs = run.TotalMs / int64(run.Timed)
		}
		out = append(out, resp)
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *Handler) StartWoodpeckerRun(w http.ResponseWriter, r *http.Request) {
	username, ok := h.woodpeckerUser(w, r)
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	name := strings.TrimSpace(req.Name)
	if len(name) > 80 {
		http.Error(w, "name too long", http.StatusBadRequest)
		return
	}
	cycle, err := h.db.StartWoodpeckerRun(r.Context(), username, name)
	if err != nil {
		http.Error(w, "failed to start run: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, map[string]int{"cycle": cycle})
}

func woodpeckerCycleParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	cycle, err := strconv.Atoi(chi.URLParam(r, "cycle"))
	if err != nil || cycle < 1 {
		http.Error(w, "invalid run", http.StatusBadRequest)
		return 0, false
	}
	return cycle, true
}

func (h *Handler) RenameWoodpeckerRun(w http.ResponseWriter, r *http.Request) {
	username, ok := h.woodpeckerUser(w, r)
	if !ok {
		return
	}
	cycle, ok := woodpeckerCycleParam(w, r)
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(req.Name)
	if len(name) > 80 {
		http.Error(w, "name too long", http.StatusBadRequest)
		return
	}
	if err := h.db.RenameWoodpeckerRun(r.Context(), username, cycle, name); err != nil {
		http.Error(w, "failed to rename: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) GetWoodpeckerRunAttempts(w http.ResponseWriter, r *http.Request) {
	username, ok := h.woodpeckerUser(w, r)
	if !ok {
		return
	}
	cycle, ok := woodpeckerCycleParam(w, r)
	if !ok {
		return
	}
	attempts, err := h.db.WoodpeckerRunAttempts(r.Context(), username, cycle)
	if err != nil {
		http.Error(w, "failed to load attempts: "+err.Error(), http.StatusInternalServerError)
		return
	}
	out := make([]woodpeckerRunAttemptResponse, 0, len(attempts))
	for _, a := range attempts {
		out = append(out, woodpeckerRunAttemptResponse{Puzzle: a.Puzzle, Solved: a.Solved, Outcome: a.Outcome, DurationMs: a.DurationMs})
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *Handler) ResetWoodpeckerRange(w http.ResponseWriter, r *http.Request) {
	username, ok := h.woodpeckerUser(w, r)
	if !ok {
		return
	}
	cycle, ok := woodpeckerCycleParam(w, r)
	if !ok {
		return
	}
	var req struct {
		From int `json:"from"`
		To   int `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.From < 1 || req.To < req.From || req.To > woodpecker.Total() {
		http.Error(w, "invalid range", http.StatusBadRequest)
		return
	}
	n, err := h.db.ResetWoodpeckerRange(r.Context(), username, cycle, req.From, req.To)
	if err != nil {
		http.Error(w, "failed to reset: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, map[string]int64{"removed": n})
}

func (h *Handler) SolveWoodpeckerPuzzle(w http.ResponseWriter, r *http.Request) {
	username, ok := h.woodpeckerUser(w, r)
	if !ok {
		return
	}
	cycle, ok := woodpeckerCycleParam(w, r)
	if !ok {
		return
	}
	var req struct {
		Puzzle int `json:"puzzle"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Puzzle < 1 || req.Puzzle > woodpecker.Total() {
		http.Error(w, "invalid puzzle", http.StatusBadRequest)
		return
	}
	if err := h.db.SolveWoodpeckerPuzzle(r.Context(), username, cycle, req.Puzzle); err != nil {
		http.Error(w, "failed to update: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) UnsolveWoodpeckerPuzzle(w http.ResponseWriter, r *http.Request) {
	username, ok := h.woodpeckerUser(w, r)
	if !ok {
		return
	}
	cycle, ok := woodpeckerCycleParam(w, r)
	if !ok {
		return
	}
	var req struct {
		Puzzle int `json:"puzzle"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Puzzle < 1 || req.Puzzle > woodpecker.Total() {
		http.Error(w, "invalid puzzle", http.StatusBadRequest)
		return
	}
	if err := h.db.UnsolveWoodpeckerPuzzle(r.Context(), username, cycle, req.Puzzle); err != nil {
		http.Error(w, "failed to update: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
