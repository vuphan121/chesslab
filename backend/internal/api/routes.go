package api

import (
	"net/http"
	"os"

	"github.com/chesslab/backend/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func NewRouter(h *Handler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)
	r.Use(maxRequestBody(4 << 20))

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	r.Get("/api/version", h.Version)

	r.Post("/api/auth/login", h.Login)

	r.Post("/api/cron/refresh-repertoires", h.RefreshAllRepertoires)
	r.Post("/api/cron/precompute-evals", h.PrecomputeEvals)
	r.Post("/api/cron/sync-puzzles", h.CronSyncPuzzles)

	r.Group(func(r chi.Router) {
		r.Use(h.authCfg.Middleware)

		r.Get("/api/lichess-token", h.GetLichessToken)
		r.Post("/api/position-evals", h.GetPositionEvals)

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
		r.Get("/api/today-training/snapshot", h.GetTodayTrainingSnapshot)
		r.Put("/api/today-training", h.SaveTodayTraining)
		r.Post("/api/today-training/advance", h.AdvanceTodayTraining)

		r.Route("/api/book-progress", func(r chi.Router) {
			r.Get("/{bookId}", h.GetBookProgress)
			r.Post("/{bookId}/{itemId}", h.MarkItemDone)
		})
		r.Post("/api/book-activity/{bookId}/{chapterId}/{itemId}", h.RecordBookStudyActivity)

		r.Route("/api/book-saved-lines", func(r chi.Router) {
			r.Get("/{bookId}/{itemId}", h.GetBookSavedLine)
			r.Post("/{bookId}/{itemId}", h.SaveBookLine)
			r.Delete("/{bookId}/{itemId}", h.DeleteBookSavedLine)
		})

		r.Get("/api/puzzles/themes", h.GetPuzzleThemes)
		r.Post("/api/puzzles/next", h.NextPuzzle)
		r.Post("/api/puzzles/result", h.SubmitPuzzleResult)
		r.Post("/api/puzzles/retry-queue", h.AddPuzzleRetry)
		r.Delete("/api/puzzles/retry-queue/{puzzleId}", h.RemovePuzzleRetry)

		r.Get("/api/user-settings", h.GetUserSettings)
		r.Put("/api/user-settings", h.SaveUserSettings)

		r.Get("/api/analytics", h.Analytics)
		r.Get("/api/statistics", h.GetStatistics)
		r.Post("/api/statistics/sync-puzzles", h.SyncPuzzles)
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Chesslab-Time-Zone")
		w.Header().Set("Access-Control-Expose-Headers", auth.RefreshedTokenHeader)
		w.Header().Set("Access-Control-Max-Age", "7200")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func maxRequestBody(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}
