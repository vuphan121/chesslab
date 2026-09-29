package api

import (
	"net/http"
	"os"
)

type LichessTokenResponse struct {
	Token string `json:"token"`
}

func (h *Handler) GetLichessToken(w http.ResponseWriter, r *http.Request) {
	token := os.Getenv("LICHESS_TOKEN")
	if token == "" {
		http.Error(w, "LICHESS_TOKEN not configured", http.StatusServiceUnavailable)
		return
	}
	respondJSON(w, http.StatusOK, LichessTokenResponse{Token: token})
}
