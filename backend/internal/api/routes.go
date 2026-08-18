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

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	r.Post("/api/auth/login", h.Login)

	r.Group(func(r chi.Router) {
		r.Use(h.authCfg.Middleware)

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

		r.Get("/api/eval", h.EvalFEN)

		r.Route("/api/repertoires", func(r chi.Router) {
			r.Get("/", h.ListRepertoires)
			r.Post("/import", h.ImportRepertoire)
			r.Post("/{id}/refresh", h.RefreshRepertoire)
			r.Get("/{id}", h.GetRepertoire)
		})

		r.Route("/api/books", func(r chi.Router) {
			r.Get("/", h.ListBooks)
			r.Get("/{id}/chapters/{chapterID}/source.pdf", h.GetBookChapterPDF)
			r.Get("/{id}", h.GetBook)
		})

		r.Route("/api/progress", func(r chi.Router) {
			r.Get("/{repertoireId}", h.GetProgress)
			r.Post("/{repertoireId}", h.SaveProgress)
		})
		r.Get("/api/today-training", h.GetTodayTraining)
		r.Put("/api/today-training", h.SaveTodayTraining)
		r.Post("/api/today-training/advance", h.AdvanceTodayTraining)

		r.Route("/api/book-progress", func(r chi.Router) {
			r.Get("/{bookId}", h.GetBookProgress)
			r.Post("/{bookId}/{itemId}", h.MarkItemDone)
		})
		r.Post("/api/book-activity/{bookId}/{chapterId}/{itemId}", h.RecordBookStudyActivity)

		r.Get("/api/analytics", h.Analytics)
	})

	return r
}

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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
