package api

import (
	"encoding/json"
	"net/http"
)

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
}

// Login is the one unauthenticated /api route (besides /healthz) — see
// routes.go for how the auth middleware group is carved out around it.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// The users table (seeded from AUTH_USERNAME/AUTH_PASSWORD at boot — see
	// main.go) is the real source of truth once a database is configured;
	// the env-var comparison is only a fallback for local dev without
	// DATABASE_URL set, where there's nothing to seed a table into.
	var ok bool
	if h.db != nil {
		var err error
		ok, err = h.db.VerifyUser(r.Context(), req.Username, req.Password)
		if err != nil {
			http.Error(w, "login failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		ok = h.authCfg.CheckCredentials(req.Username, req.Password)
	}
	if !ok {
		http.Error(w, "invalid username or password", http.StatusUnauthorized)
		return
	}

	token, err := h.authCfg.IssueToken(req.Username)
	if err != nil {
		http.Error(w, "failed to issue token", http.StatusInternalServerError)
		return
	}

	respondJSON(w, http.StatusOK, LoginResponse{Token: token})
}
