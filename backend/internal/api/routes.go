package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func NewRouter(h *Handler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	r.Route("/api/games", func(r chi.Router) {
		r.Post("/", h.CreateGame)
		r.Get("/{id}", h.GetGame)
		r.Post("/{id}/moves", h.MakeMove)
		r.Delete("/{id}", h.DeleteGame)
		r.Get("/{id}/analysis", h.AnalyzeGame)
		r.Get("/{id}/explorer", h.Explorer)
		r.Post("/{id}/goto", h.GotoNode)
		r.Post("/{id}/pgn", h.LoadPGN)
		r.Post("/{id}/coach/explain", h.ExplainMove)
		r.Post("/{id}/coach/chat", h.CoachChat)
	})

	// Game-independent: eval an arbitrary FEN (drives per-move eval in the list).
	r.Get("/api/eval", h.EvalFEN)

	return r
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
