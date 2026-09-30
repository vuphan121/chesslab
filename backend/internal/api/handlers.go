package api

import (
	"encoding/json"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/booksource"
	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/engine"
	"github.com/chesslab/backend/internal/puzzledb"
	"github.com/chesslab/backend/internal/repertoire"
)

type Handler struct {
	precomputeEngine  *engine.Engine
	repertoires       *repertoire.Store
	books             *book.Store
	bookSource        booksource.Reader
	bookChapterPrefix string
	db                *db.Store
	puzzles           *puzzledb.Store
	authCfg           auth.Config
	loginLimiter      *loginLimiter
	lineImportanceMu  sync.Mutex
	lineImportanceGen map[string]int64
	precomputeRunning atomic.Bool
	precomputeMu      sync.Mutex
	lastPrecompute    *PrecomputeEvalsResponse
	evalPruneMu       sync.Mutex
	evalPruneRunning  bool
	evalPruneAgain    bool
}

func NewHandler(precomputeEng *engine.Engine, repertoires *repertoire.Store, books *book.Store, dbStore *db.Store, authCfg auth.Config, bookSource booksource.Reader, bookChapterPrefix string) *Handler {
	return &Handler{precomputeEngine: precomputeEng, repertoires: repertoires, books: books, db: dbStore, authCfg: authCfg, bookSource: bookSource, bookChapterPrefix: bookChapterPrefix, loginLimiter: newLoginLimiter(5, 5*time.Minute, time.Now), lineImportanceGen: make(map[string]int64)}
}

func respondJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (h *Handler) SetPuzzleStore(store *puzzledb.Store) { h.puzzles = store }
