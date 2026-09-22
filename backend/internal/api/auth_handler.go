package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	clientKey := loginClientKey(r)
	if allowed, retryAfter := h.loginLimiter.reserve(clientKey); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(retryAfter.Round(time.Second)/time.Second))))
		http.Error(w, "too many login attempts; try again later", http.StatusTooManyRequests)
		return
	}
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

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
		// reserve() above already recorded this attempt against the limit.
		http.Error(w, "invalid username or password", http.StatusUnauthorized)
		return
	}

	token, err := h.authCfg.IssueToken(req.Username)
	if err != nil {
		http.Error(w, "failed to issue token", http.StatusInternalServerError)
		return
	}

	h.loginLimiter.success(clientKey)
	respondJSON(w, http.StatusOK, LoginResponse{Token: token})
}
