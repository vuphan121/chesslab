package api

import (
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func NewRouter(h *Handler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// Render (and most PaaS load balancers) probe "/" or a configured health
	// check path before routing traffic to a new instance — chi has no route
	// for "/" otherwise, which some health checks treat as unhealthy.
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok")) //nolint:errcheck
	})

	r.Route("/api/games", func(r chi.Router) {
		r.Post("/", h.CreateGame)
		r.Get("/{id}", h.GetGame)
		r.Post("/{id}/moves", h.MakeMove)
		r.Delete("/{id}", h.DeleteGame)
		r.Get("/{id}/analysis", h.AnalyzeGame)
		r.Get("/{id}/explorer", h.Explorer)
		r.Post("/{id}/goto", h.GotoNode)
		r.Post("/{id}/pgn", h.LoadPGN)
		r.Post("/{id}/position", h.SetPosition)
		r.Post("/{id}/coach/explain", h.ExplainMove)
		r.Post("/{id}/coach/chat", h.CoachChat)
	})

	// Game-independent: eval an arbitrary FEN (drives per-move eval in the list).
	r.Get("/api/eval", h.EvalFEN)

	r.Route("/api/repertoires", func(r chi.Router) {
		r.Get("/", h.ListRepertoires)
		r.Get("/{id}", h.GetRepertoire)
	})

	return r
}

// allowedOrigin defaults to "*" (unchanged local-dev behavior). Set
// ALLOWED_ORIGIN in production to the deployed frontend's origin instead of
// leaving the API open to any site.
func allowedOrigin() string {
	if v := os.Getenv("ALLOWED_ORIGIN"); v != "" {
		return v
	}
	return "*"
}

func corsMiddleware(next http.Handler) http.Handler {
	origin := allowedOrigin()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
