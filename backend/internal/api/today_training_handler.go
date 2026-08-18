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
	LinesPerDay   int      `json:"linesPerDay"`
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
	Incorrect    bool   `json:"incorrect"`
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
	if queue.Settings != nil && len(queue.Entries) == 0 {
		queue, err = h.buildTodayTraining(r, username, *queue.Settings)
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
	settings := db.TodayTrainingSettings{RepertoireIDs: uniqueIDs(req.RepertoireIDs), LinesPerDay: req.LinesPerDay}
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
	queue, err := h.db.AdvanceTodayTraining(r.Context(), username, req.RepertoireID, req.CardID, req.Incorrect)
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
	if settings.LinesPerDay < 1 || settings.LinesPerDay > 100 {
		return db.TodayTrainingQueue{}, errTodayTraining("linesPerDay must be between 1 and 100")
	}
	if len(settings.RepertoireIDs) == 0 {
		return db.TodayTrainingQueue{}, errTodayTraining("choose at least one repertoire")
	}
	entries := []db.TodayTrainingEntry{}
	for _, repertoireID := range settings.RepertoireIDs {
		rep, ok := h.repertoires.Get(repertoireID)
		if !ok {
			return db.TodayTrainingQueue{}, errTodayTraining("repertoire not found: " + repertoireID)
		}
		for _, card := range rep.Cards {
			entries = append(entries, db.TodayTrainingEntry{RepertoireID: repertoireID, CardID: card.ID})
		}
	}
	rand.Shuffle(len(entries), func(i, j int) { entries[i], entries[j] = entries[j], entries[i] })
	if len(entries) > settings.LinesPerDay {
		entries = entries[:settings.LinesPerDay]
	}
	return h.db.SaveTodayTraining(r.Context(), username, settings, entries)
}

func todayTrainingResponse(queue db.TodayTrainingQueue) TodayTrainingResponse {
	response := TodayTrainingResponse{Entries: make([]TodayTrainingEntryJSON, 0, len(queue.Entries))}
	if queue.Settings != nil {
		response.Settings = &TodayTrainingSettingsJSON{RepertoireIDs: queue.Settings.RepertoireIDs, LinesPerDay: queue.Settings.LinesPerDay}
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
