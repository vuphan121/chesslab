package api

import (
	"encoding/json"
	"math/rand/v2"
	"net/http"
	"slices"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/db"
)

type TodayTrainingSettingsJSON struct {
	RepertoireIDs []string `json:"repertoireIds"`
}

type TodayTrainingEntryJSON struct {
	RepertoireID string `json:"repertoireId"`
	CardID       string `json:"cardId"`
}

type TodayTrainingResponse struct {
	Settings *TodayTrainingSettingsJSON `json:"settings"`
	Entries  []TodayTrainingEntryJSON   `json:"entries"`
}

type AdvanceTodayTrainingRequest struct {
	RepertoireID string `json:"repertoireId"`
	CardID       string `json:"cardId"`
}

func (h *Handler) GetTodayTraining(w http.ResponseWriter, r *http.Request) {
	username, ok := h.todayTrainingUsername(w, r)
	if !ok {
		return
	}
	queue, err := h.db.GetTodayTraining(r.Context(), username)
	if err != nil {
		http.Error(w, "failed to load today's training: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if queue.Settings != nil {
		expected, expectedErr := h.todayTrainingEntries(*queue.Settings)
		if expectedErr != nil {
			http.Error(w, "failed to prepare today's training: "+expectedErr.Error(), http.StatusBadRequest)
			return
		}
		if !sameTodayTrainingEntries(queue.Entries, expected) {
			queue, err = h.saveTodayTraining(r, username, *queue.Settings, expected)
		}
		if err != nil {
			http.Error(w, "failed to prepare today's training: "+err.Error(), http.StatusBadRequest)
			return
		}
	}
	respondJSON(w, http.StatusOK, todayTrainingResponse(queue))
}

func (h *Handler) SaveTodayTraining(w http.ResponseWriter, r *http.Request) {
	username, ok := h.todayTrainingUsername(w, r)
	if !ok {
		return
	}
	var req TodayTrainingSettingsJSON
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	// LinesPerDay is retained only in the database schema for backwards
	// compatibility. Today's queue now always contains every eligible entry.
	settings := db.TodayTrainingSettings{RepertoireIDs: uniqueIDs(req.RepertoireIDs), LinesPerDay: 1}
	queue, err := h.buildTodayTraining(r, username, settings)
	if err != nil {
		http.Error(w, "failed to prepare today's training: "+err.Error(), http.StatusBadRequest)
		return
	}
	respondJSON(w, http.StatusOK, todayTrainingResponse(queue))
}

func (h *Handler) AdvanceTodayTraining(w http.ResponseWriter, r *http.Request) {
	username, ok := h.todayTrainingUsername(w, r)
	if !ok {
		return
	}
	var req AdvanceTodayTrainingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.RepertoireID == "" || req.CardID == "" {
		http.Error(w, "repertoireId and cardId are required", http.StatusBadRequest)
		return
	}
	queue, err := h.db.AdvanceTodayTraining(r.Context(), username, req.RepertoireID, req.CardID)
	if err != nil {
		http.Error(w, "failed to advance today's training: "+err.Error(), http.StatusBadRequest)
		return
	}
	respondJSON(w, http.StatusOK, todayTrainingResponse(queue))
}

func (h *Handler) todayTrainingUsername(w http.ResponseWriter, r *http.Request) (string, bool) {
	if h.db == nil {
		http.Error(w, "today's training requires database sync", http.StatusServiceUnavailable)
		return "", false
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return "", false
	}
	return username, true
}

func (h *Handler) buildTodayTraining(r *http.Request, username string, settings db.TodayTrainingSettings) (db.TodayTrainingQueue, error) {
	entries, err := h.todayTrainingEntries(settings)
	if err != nil {
		return db.TodayTrainingQueue{}, err
	}
	return h.saveTodayTraining(r, username, settings, entries)
}

func (h *Handler) todayTrainingEntries(settings db.TodayTrainingSettings) ([]db.TodayTrainingEntry, error) {
	if len(settings.RepertoireIDs) == 0 {
		return nil, errTodayTraining("choose at least one repertoire")
	}
	entries := []db.TodayTrainingEntry{}
	for _, repertoireID := range settings.RepertoireIDs {
		rep, ok := h.repertoires.Get(repertoireID)
		if !ok {
			return nil, errTodayTraining("repertoire not found: " + repertoireID)
		}
		for _, card := range rep.Cards {
			entries = append(entries, db.TodayTrainingEntry{RepertoireID: repertoireID, CardID: card.ID})
		}
	}
	return entries, nil
}

func (h *Handler) saveTodayTraining(r *http.Request, username string, settings db.TodayTrainingSettings, entries []db.TodayTrainingEntry) (db.TodayTrainingQueue, error) {
	entries = shuffleTodayTrainingEntries(entries, rand.IntN)
	return h.db.SaveTodayTraining(r.Context(), username, settings, entries)
}

func shuffleTodayTrainingEntries(entries []db.TodayTrainingEntry, intN func(int) int) []db.TodayTrainingEntry {
	shuffled := append([]db.TodayTrainingEntry(nil), entries...)
	for i := len(shuffled) - 1; i > 0; i-- {
		j := intN(i + 1)
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	}
	return shuffled
}

func sameTodayTrainingEntries(left, right []db.TodayTrainingEntry) bool {
	if len(left) != len(right) {
		return false
	}
	counts := make(map[db.TodayTrainingEntry]int, len(left))
	for _, entry := range left {
		counts[entry]++
	}
	for _, entry := range right {
		if counts[entry] == 0 {
			return false
		}
		counts[entry]--
	}
	return true
}

func todayTrainingResponse(queue db.TodayTrainingQueue) TodayTrainingResponse {
	response := TodayTrainingResponse{Entries: make([]TodayTrainingEntryJSON, 0, len(queue.Entries))}
	if queue.Settings != nil {
		response.Settings = &TodayTrainingSettingsJSON{RepertoireIDs: queue.Settings.RepertoireIDs}
	}
	for _, entry := range queue.Entries {
		response.Entries = append(response.Entries, TodayTrainingEntryJSON{RepertoireID: entry.RepertoireID, CardID: entry.CardID})
	}
	return response
}

func uniqueIDs(ids []string) []string {
	out := []string{}
	for _, id := range ids {
		if id != "" && !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	return out
}

type errTodayTraining string

func (e errTodayTraining) Error() string {
	return string(e)
}
