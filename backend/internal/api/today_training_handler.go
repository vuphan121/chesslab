package api

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"net/http"
	"slices"
	"sort"
	"time"

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
	importance := 0.5
	if cached, err := h.db.GetLineImportance(r.Context(), req.RepertoireID); err == nil {
		if entry, ok := cached[req.CardID]; ok {
			importance = entry.Importance
		}
	}
	queue, err := h.db.AdvanceTodayTraining(r.Context(), username, req.RepertoireID, req.CardID, req.Incorrect, importance)
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
	type candidate struct {
		entry   db.TodayTrainingEntry
		urgency int
		score   float64
	}
	candidates := []candidate{}
	for _, repertoireID := range settings.RepertoireIDs {
		rep, ok := h.repertoires.Get(repertoireID)
		if !ok {
			return db.TodayTrainingQueue{}, errTodayTraining("repertoire not found: " + repertoireID)
		}
		importance := h.ensureLineImportance(r.Context(), rep)
		progress, err := h.db.GetProgress(r.Context(), username, repertoireID)
		if err != nil {
			return db.TodayTrainingQueue{}, errTodayTraining("load repertoire progress: " + err.Error())
		}
		for _, card := range rep.Cards {
			value := importance[card.ID]
			candidates = append(candidates, candidate{
				entry:   db.TodayTrainingEntry{RepertoireID: repertoireID, CardID: card.ID},
				urgency: dailyUrgency(progress[card.ID], time.Now()),
				score:   value*0.7 + rand.Float64()*0.7,
			})
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].urgency != candidates[j].urgency {
			return candidates[i].urgency > candidates[j].urgency
		}
		return candidates[i].score > candidates[j].score
	})
	entries := make([]db.TodayTrainingEntry, 0, len(candidates))
	for _, candidate := range candidates {
		entries = append(entries, candidate.entry)
	}
	if len(entries) > settings.LinesPerDay {
		entries = entries[:settings.LinesPerDay]
	}
	return h.db.SaveTodayTraining(r.Context(), username, settings, entries)
}

func dailyUrgency(progress db.CardProgress, now time.Time) int {
	if progress.Seen == 0 || progress.LastSeenISO == nil {
		return 4
	}
	lastSeen, err := time.Parse(time.RFC3339, *progress.LastSeenISO)
	if err != nil {
		return 4
	}
	box := max(0, min(progress.Box, 5))
	baseGap := []float64{2, 4, 8, 16, 32, 64}[box]
	gap := baseGap * math.Pow(0.8, float64(progress.Lapses))
	ageDays := max(0, now.Sub(lastSeen).Hours()/24)
	ratio := ageDays / max(gap, 1)
	ratio += min(float64(progress.Lapses)*0.12, 0.6)
	return min(int(math.Floor(ratio*4)), 99)
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
