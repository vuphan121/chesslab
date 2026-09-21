package api

import (
	"encoding/json"
	"net/http"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/db"
)

type UserSettingsJSON struct {
	PieceTheme string `json:"pieceTheme"`
}

func (h *Handler) GetUserSettings(w http.ResponseWriter, r *http.Request) {
	username, ok := h.userSettingsUsername(w, r)
	if !ok {
		return
	}
	settings, err := h.db.GetUserSettings(r.Context(), username)
	if err != nil {
		http.Error(w, "failed to load user settings: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, UserSettingsJSON{PieceTheme: settings.PieceTheme})
}

func (h *Handler) SaveUserSettings(w http.ResponseWriter, r *http.Request) {
	username, ok := h.userSettingsUsername(w, r)
	if !ok {
		return
	}
	var req UserSettingsJSON
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if !validPieceTheme(req.PieceTheme) {
		http.Error(w, "pieceTheme must be classic or glass", http.StatusBadRequest)
		return
	}
	if err := h.db.SaveUserSettings(r.Context(), username, db.UserSettings{PieceTheme: req.PieceTheme}); err != nil {
		http.Error(w, "failed to save user settings: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, req)
}

func (h *Handler) userSettingsUsername(w http.ResponseWriter, r *http.Request) (string, bool) {
	if h.db == nil {
		http.Error(w, "user settings are not configured", http.StatusServiceUnavailable)
		return "", false
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return "", false
	}
	return username, true
}

func validPieceTheme(theme string) bool {
	return theme == "classic" || theme == "glass"
}
