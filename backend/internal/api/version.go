package api

import (
	"net/http"
	"os"
)

func buildID() string {
	commit := os.Getenv("RENDER_GIT_COMMIT")
	if commit == "" {
		return "unknown"
	}
	if len(commit) > 7 {
		commit = commit[:7]
	}
	return commit
}

func (h *Handler) Version(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	respondJSON(w, http.StatusOK, map[string]string{"build": buildID()})
}
