package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/booksource"
	"github.com/chesslab/backend/internal/chess"
	"github.com/chesslab/backend/internal/coach"
	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/engine"
	"github.com/chesslab/backend/internal/lichess"
	"github.com/chesslab/backend/internal/repertoire"
	"github.com/chesslab/backend/internal/storage"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/sync/singleflight"
)

type Handler struct {
	store             storage.Store
	engine            *engine.Engine
	coach             *coach.Service
	coachAgent        *coach.Agent
	repertoires       *repertoire.Store
	books             *book.Store
	bookSource        booksource.Reader
	bookChapterPrefix string
	db                *db.Store
	authCfg           auth.Config
	prefetchMu        sync.Mutex
	prefetchedCloud   map[string]prefetchedCloudEval
	prefetchSem       chan struct{}
	analysisMu        sync.Mutex
	analysisCache     map[string]cachedAnalysis
	analysisGroup     singleflight.Group
	loginLimiter      *loginLimiter
	lineImportanceMu  sync.Mutex
	lineImportanceGen map[string]int64
}

type prefetchedCloudEval struct {
	value     *lichess.CloudEval
	expiresAt time.Time
}

type cachedAnalysis struct {
	value     AnalysisJSON
	expiresAt time.Time
}

var errEngineUnavailable = errors.New("engine not configured")

func NewHandler(store storage.Store, eng *engine.Engine, coachSvc *coach.Service, coachAgent *coach.Agent, repertoires *repertoire.Store, books *book.Store, dbStore *db.Store, authCfg auth.Config, bookSource booksource.Reader, bookChapterPrefix string) *Handler {
	return &Handler{store: store, engine: eng, coach: coachSvc, coachAgent: coachAgent, repertoires: repertoires, books: books, db: dbStore, authCfg: authCfg, bookSource: bookSource, bookChapterPrefix: bookChapterPrefix, prefetchedCloud: make(map[string]prefetchedCloudEval), prefetchSem: make(chan struct{}, 1), analysisCache: make(map[string]cachedAnalysis), loginLimiter: newLoginLimiter(5, 5*time.Minute, time.Now), lineImportanceGen: make(map[string]int64)}
}

type PieceJSON struct {
	Type  string `json:"type"`
	Color string `json:"color"`
}

type MoveJSON struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Flag      string `json:"flag,omitempty"`
	Promotion string `json:"promotion,omitempty"`
}

type MoveNodeJSON struct {
	ID        string         `json:"id"`
	SAN       string         `json:"san"`
	FEN       string         `json:"fen"`
	Ply       int            `json:"ply"`
	From      string         `json:"from,omitempty"`
	To        string         `json:"to,omitempty"`
	Promotion string         `json:"promotion,omitempty"`
	Children  []MoveNodeJSON `json:"children"`
}

type GameStateJSON struct {
	ID             string               `json:"id"`
	FEN            string               `json:"fen"`
	Turn           string               `json:"turn"`
	FullMove       int                  `json:"fullMove"`
	Pieces         map[string]PieceJSON `json:"pieces"`
	LegalMoves     []MoveJSON           `json:"legalMoves"`
	LastMove       *MoveJSON            `json:"lastMove"`
	IsCheck        bool                 `json:"isCheck"`
	IsCheckmate    bool                 `json:"isCheckmate"`
	IsStalemate    bool                 `json:"isStalemate"`
	IsDraw         bool                 `json:"isDraw"`
	IsGameOver     bool                 `json:"isGameOver"`
	GameOverReason string               `json:"gameOverReason"`
	MoveTree       MoveNodeJSON         `json:"moveTree"`
	CurrentNodeID  string               `json:"currentNodeId"`
}

type GotoNodeRequest struct {
	NodeID string `json:"nodeId"`
}

type MakeMoveRequest struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Promotion string `json:"promotion"`
}

type LineJSON struct {
	Score    int      `json:"score"`
	Mate     int      `json:"mate"`
	Depth    int      `json:"depth"`
	Moves    []string `json:"moves"`
	UCIMoves []string `json:"uciMoves"`
	FENs     []string `json:"fens"`
}

type AnalysisJSON struct {
	BestMove   string     `json:"bestMove"`
	Score      int        `json:"score"`
	Mate       int        `json:"mate"`
	Depth      int        `json:"depth"`
	EngineName string     `json:"engineName"`
	Lines      []LineJSON `json:"lines"`
	// TablebaseCategory/TablebaseDTZ are only set when the position was
	// resolved via a Syzygy tablebase lookup instead of engine search — see
	// tablebaseAnalysis. White-relative, like Score/Mate.
	TablebaseCategory string `json:"tablebaseCategory,omitempty"`
	TablebaseDTZ      *int   `json:"tablebaseDtz,omitempty"`
}

type ExplorerMoveJSON struct {
	SAN         string  `json:"san"`
	UCI         string  `json:"uci"`
	Games       int     `json:"games"`
	SharePct    float64 `json:"sharePct"`
	WhitePct    float64 `json:"whitePct"`
	DrawPct     float64 `json:"drawPct"`
	BlackPct    float64 `json:"blackPct"`
	OpeningName string  `json:"openingName,omitempty"`
	OpeningECO  string  `json:"openingEco,omitempty"`
}

type ExplorerJSON struct {
	TotalGames  int                `json:"totalGames"`
	OpeningName string             `json:"openingName,omitempty"`
	OpeningECO  string             `json:"openingEco,omitempty"`
	Moves       []ExplorerMoveJSON `json:"moves"`
}

type CreateGameRequest struct {
	FEN string `json:"fen"`
}

func (h *Handler) CreateGame(w http.ResponseWriter, r *http.Request) {
	var req CreateGameRequest
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
	}

	id := uuid.New().String()
	var g *chess.Game
	if req.FEN != "" {
		var err error
		g, err = chess.NewGameFromFEN(id, req.FEN)
		if err != nil {
			http.Error(w, "invalid fen: "+err.Error(), http.StatusBadRequest)
			return
		}
	} else {
		g = chess.NewGame(id)
	}

	h.store.Save(g)
	respondJSON(w, http.StatusCreated, toGameState(g))
}

type SetPositionRequest struct {
	FEN string `json:"fen"`
}

func (h *Handler) SetPosition(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}

	var req SetPositionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	g.Lock()
	defer g.Unlock()
	if err := g.ResetTo(req.FEN); err != nil {
		http.Error(w, "invalid fen: "+err.Error(), http.StatusBadRequest)
		return
	}

	h.store.Save(g)
	respondJSON(w, http.StatusOK, toGameStateLocked(g))
}

func (h *Handler) GetGame(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}
	respondJSON(w, http.StatusOK, toGameState(g))
}

func (h *Handler) MakeMove(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}

	var req MakeMoveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	from := chess.ParseSquare(req.From)
	to := chess.ParseSquare(req.To)
	if !from.Valid() || !to.Valid() {
		http.Error(w, "invalid square", http.StatusBadRequest)
		return
	}

	flag := chess.Normal
	switch req.Promotion {
	case "q":
		flag = chess.PromoQ
	case "r":
		flag = chess.PromoR
	case "b":
		flag = chess.PromoB
	case "n":
		flag = chess.PromoN
	}

	g.Lock()
	defer g.Unlock()
	if err := g.ApplyMove(chess.Move{From: from, To: to, Flag: flag}); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.store.Save(g)
	respondJSON(w, http.StatusOK, toGameStateLocked(g))
}

func (h *Handler) DeleteGame(w http.ResponseWriter, r *http.Request) {
	h.store.Delete(chi.URLParam(r, "id"))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteNode(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}
	g.Lock()
	defer g.Unlock()
	if err := g.DeleteNode(chi.URLParam(r, "nodeId")); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	h.store.Save(g)
	respondJSON(w, http.StatusOK, toGameStateLocked(g))
}

func (h *Handler) AnalyzeGame(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}

	fen := r.URL.Query().Get("fen")
	if fen == "" {
		g.RLock()
		fen = chess.FEN(g.Pos)
		g.RUnlock()
	}
	pos, err := chess.ParseFEN(fen)
	if err != nil {
		http.Error(w, "invalid fen", http.StatusBadRequest)
		return
	}

	quick := r.URL.Query().Get("speed") == "quick"
	cacheKey := fen + "|deep"
	if quick {
		cacheKey = fen + "|quick"
	}
	if result, ok := h.cachedAnalysis(cacheKey); ok {
		respondJSON(w, http.StatusOK, result)
		h.prefetchLikelyReplies(result.Lines)
		return
	}

	value, err, _ := h.analysisGroup.Do(cacheKey, func() (any, error) {
		if result, ok := h.cachedAnalysis(cacheKey); ok {
			return result, nil
		}
		result, analyzeErr := h.analyzePosition(fen, pos, quick)
		if analyzeErr != nil {
			return AnalysisJSON{}, analyzeErr
		}
		h.rememberAnalysis(cacheKey, result)
		return result, nil
	})
	if err != nil {
		if errors.Is(err, errEngineUnavailable) {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
		} else {
			http.Error(w, "analysis failed: "+err.Error(), http.StatusInternalServerError)
		}
		return
	}
	result := value.(AnalysisJSON)
	respondJSON(w, http.StatusOK, result)
	h.prefetchLikelyReplies(result.Lines)
}

func (h *Handler) analyzePosition(fen string, pos *chess.Position, quick bool) (AnalysisJSON, error) {
	probe, _ := chess.NewGameFromFEN("", fen)
	if probe.IsGameOver() {
		name := "Stockfish"
		if h.engine != nil {
			name = h.engine.Name
		}
		return AnalysisJSON{EngineName: name}, nil
	}

	flipScore := pos.Turn == chess.Black
	depth := 20
	cloudTimeout := 3 * time.Second
	if quick {
		depth = 10
		cloudTimeout = 400 * time.Millisecond
	}

	tablebaseEligible := pos.PieceCount() <= lichess.MaxTablebasePieces
	if tablebaseEligible {
		// Bounded to the same budget as the cloud-eval call just below (400ms
		// quick / 3s full) — an unbounded lookup here would let a slow
		// tablebase response blow the "quick" pass's whole latency budget,
		// defeating the reason it's split from "full" in the first place.
		if tb, err := lichess.FetchTablebaseWithTimeout(fen, cloudTimeout); err == nil && tb != nil {
			return tablebaseAnalysis(pos, tb), nil
		} else if err != nil && !quick {
			log.Printf("lichess tablebase: %v", err)
		}
	}

	// Skip the cloud-eval attempt below when a tablebase-eligible position's
	// lookup just missed/timed out: that cache is populated from real played
	// games' opening/middlegame analysis, so a sparse (≤7-piece) synthetic
	// endgame FEN is essentially never going to hit it anyway. Trying it here
	// would stack a second up-to-cloudTimeout wait on top of the tablebase
	// attempt for no realistic benefit — verified live: a quick-pass
	// tablebase miss followed by this cloud attempt measured ~880ms, more
	// than double the ~400ms "quick" budget this pass is supposed to honor.
	if !tablebaseEligible {
		if cloud := h.takePrefetchedCloud(fen); cloud != nil {
			return cloudAnalysis(pos, cloud), nil
		}
		if cloud, err := lichess.FetchWithTimeout(fen, 3, cloudTimeout); err == nil && cloud != nil {
			return cloudAnalysis(pos, cloud), nil
		} else if err != nil && !quick {
			log.Printf("lichess cloud eval: %v", err)
		}
	}

	if h.engine == nil {
		return AnalysisJSON{}, errEngineUnavailable
	}
	raw, err := h.engine.Analyze(fen, 3, depth)
	if err != nil {
		return AnalysisJSON{}, err
	}

	result := AnalysisJSON{BestMove: raw.BestMove, EngineName: h.engine.Name}
	for i, l := range raw.Lines {
		score, mate := l.Score, l.Mate
		if flipScore {
			score, mate = -score, -mate
		}
		if i == 0 {
			result.Score = score
			result.Mate = mate
			result.Depth = l.Depth
		}
		sans, fens := chess.MovesToSANAndFENs(pos, l.Moves)
		result.Lines = append(result.Lines, LineJSON{
			Score:    score,
			Mate:     mate,
			Depth:    l.Depth,
			Moves:    sans,
			UCIMoves: l.Moves,
			FENs:     fens,
		})
	}
	return result, nil
}

func (h *Handler) cachedAnalysis(key string) (AnalysisJSON, bool) {
	h.analysisMu.Lock()
	defer h.analysisMu.Unlock()
	entry, ok := h.analysisCache[key]
	if !ok || time.Now().After(entry.expiresAt) {
		delete(h.analysisCache, key)
		return AnalysisJSON{}, false
	}
	return entry.value, true
}

func (h *Handler) rememberAnalysis(key string, result AnalysisJSON) {
	h.analysisMu.Lock()
	defer h.analysisMu.Unlock()
	now := time.Now()
	for cacheKey, entry := range h.analysisCache {
		if now.After(entry.expiresAt) {
			delete(h.analysisCache, cacheKey)
		}
	}
	if len(h.analysisCache) >= 256 {
		for cacheKey := range h.analysisCache {
			delete(h.analysisCache, cacheKey)
			break
		}
	}
	h.analysisCache[key] = cachedAnalysis{value: result, expiresAt: now.Add(10 * time.Minute)}
}

func cloudAnalysis(pos *chess.Position, cloud *lichess.CloudEval) AnalysisJSON {
	result := AnalysisJSON{EngineName: "Lichess Cloud", Depth: cloud.Depth}
	for i, pv := range cloud.PVs {
		score, mate := 0, 0
		if pv.CP != nil {
			score = *pv.CP
		}
		if pv.Mate != nil {
			mate = *pv.Mate
		}
		moves := strings.Fields(pv.Moves)
		sans, fens := chess.MovesToSANAndFENs(pos, moves)
		if i == 0 {
			result.Score = score
			result.Mate = mate
			if len(moves) > 0 {
				result.BestMove = moves[0]
			}
		}
		result.Lines = append(result.Lines, LineJSON{Score: score, Mate: mate, Depth: cloud.Depth, Moves: sans, UCIMoves: moves, FENs: fens})
	}
	return result
}

// tablebaseAnalysis converts a Syzygy lookup (side-to-move relative) into the
// app's White-relative AnalysisJSON shape, matching how cloudAnalysis/the
// Stockfish path already normalize score/mate. There's no centipawn score
// for an exact result, so decisive categories get a saturating sentinel
// (±10000 — same order of magnitude the eval bar's tanh curve already
// treats as a full 97/3% fill) instead of a fabricated cp value; Mate is
// only set when the API returned a real distance-to-mate (DTM), which it
// only does up to 6-man positions.
//
// "cursed-win"/"blessed-loss" are NOT decisive here, even though the raw
// win/loss exists in unlimited play: the position is a provable DRAW under
// the 50-move rule (the losing side can always claim it — that's the literal
// definition of "cursed"/"blessed"), and Lichess's own /standard/mainline
// endpoint claims exactly that draw as soon as possible. Treating them as a
// ±10000 win/loss with a fabricated "#N" mate (from the raw DTM, which
// ignores the 50-move rule entirely) would show a forced result that isn't
// actually provable under standard rules — verified live: the repro
// `8/8/8/7p/3K1N2/5N2/2k5/8 b - - 50 1` (a real "blessed-loss") produced a
// DTM-derived "Mate: 69" before this fix, despite being a legally drawn
// position. "maybe-win"/"maybe-loss" (result uncertain, some search was
// capped) are excluded from decisive treatment for the same reason: neither
// is a provable result. "unknown"/"draw" fall through untouched (Score/Mate
// stay 0).
func tablebaseAnalysis(pos *chess.Position, tb *lichess.TablebaseResult) AnalysisJSON {
	flip := pos.Turn == chess.Black

	result := AnalysisJSON{
		EngineName:        fmt.Sprintf("Syzygy Tablebase (%d-man)", pos.PieceCount()),
		TablebaseCategory: flipTablebaseCategory(tb.Category, flip),
	}
	if tb.DTZ != nil {
		dtz := *tb.DTZ
		if flip {
			dtz = -dtz
		}
		result.TablebaseDTZ = &dtz
	}

	// "syzygy-win"/"syzygy-loss" are a documented Lichess category (see the
	// lila-tablebase README's full category list) for a decisive result
	// sourced from a coarser table than the primary win/loss lookup — still
	// provable under the 50-move rule, unlike cursed-win/blessed-loss/maybe-*.
	decisive := tb.Category == "win" || tb.Category == "loss" ||
		tb.Category == "syzygy-win" || tb.Category == "syzygy-loss"

	switch tb.Category {
	case "win", "syzygy-win":
		result.Score = 10000
	case "loss", "syzygy-loss":
		result.Score = -10000
	}
	if decisive && tb.DTM != nil {
		dtm := *tb.DTM
		moves := (abs(dtm) + 1) / 2
		if dtm < 0 {
			moves = -moves
		}
		result.Mate = moves
	}
	if flip {
		result.Score = -result.Score
		result.Mate = -result.Mate
	}

	if best := bestTablebaseMove(tb.Moves); best != nil {
		result.BestMove = best.UCI
		sans, fens := chess.MovesToSANAndFENs(pos, []string{best.UCI})
		line := LineJSON{Score: result.Score, Mate: result.Mate, UCIMoves: []string{best.UCI}, Moves: sans, FENs: fens}
		result.Lines = []LineJSON{line}
	}
	return result
}

// flipTablebaseCategory normalizes a side-to-move-relative category to
// White-relative by swapping each win/loss pair when Black is to move; draw
// categories are symmetric and pass through unchanged.
func flipTablebaseCategory(category string, flip bool) string {
	if !flip {
		return category
	}
	switch category {
	case "win":
		return "loss"
	case "loss":
		return "win"
	case "cursed-win":
		return "blessed-loss"
	case "blessed-loss":
		return "cursed-win"
	case "maybe-win":
		return "maybe-loss"
	case "maybe-loss":
		return "maybe-win"
	case "syzygy-win":
		return "syzygy-loss"
	case "syzygy-loss":
		return "syzygy-win"
	default: // "draw", "unknown" are symmetric
		return category
	}
}

// bestTablebaseMove returns Lichess's own best reply. The API's docs state
// the "moves" array is "information about legal moves, best first"
// (lila-tablebase's README), so no client-side re-ranking is needed.
//
// An earlier version re-ranked moves itself, collapsing "loss"/"blessed-loss"/
// "maybe-loss" into one tier and tie-breaking by DTM — but "blessed-loss"
// means the opponent's loss is only real without the 50-move rule (a
// provable draw with it), while "loss" is a real, provable loss for them;
// DTM (raw plies-to-mate) has no relation to the 50-move threshold that
// separates the two, so that tie-break could prefer a move that merely draws
// over one that actually wins. Trusting Lichess's documented ordering
// sidesteps the whole class of bug. Returns nil if Moves is empty (e.g. the
// position is already checkmate/stalemate).
func bestTablebaseMove(moves []lichess.TablebaseMove) *lichess.TablebaseMove {
	if len(moves) == 0 {
		return nil
	}
	return &moves[0]
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// Prefetching is deliberately cloud-only: background Stockfish searches would contend with the
// foreground engine and make a user's next move slower. This is a short-lived buffer for likely
// child positions, not a general-purpose evaluation cache.
func (h *Handler) prefetchLikelyReplies(lines []LineJSON) {
	fens := make([]string, 0, 2)
	for _, line := range lines {
		if len(line.FENs) == 0 {
			continue
		}
		fen := line.FENs[0]
		duplicate := false
		for _, existing := range fens {
			duplicate = duplicate || existing == fen
		}
		if !duplicate {
			fens = append(fens, fen)
		}
		if len(fens) == 2 {
			break
		}
	}
	if len(fens) == 0 {
		return
	}

	go func() {
		select {
		case h.prefetchSem <- struct{}{}:
			defer func() { <-h.prefetchSem }()
		default:
			return
		}
		for _, fen := range fens {
			if h.hasPrefetchedCloud(fen) {
				continue
			}
			cloud, err := lichess.FetchWithTimeout(fen, 3, 700*time.Millisecond)
			if err == nil && cloud != nil {
				h.rememberPrefetchedCloud(fen, cloud)
			}
		}
	}()
}

func (h *Handler) takePrefetchedCloud(fen string) *lichess.CloudEval {
	h.prefetchMu.Lock()
	defer h.prefetchMu.Unlock()
	entry, ok := h.prefetchedCloud[fen]
	if !ok || time.Now().After(entry.expiresAt) {
		delete(h.prefetchedCloud, fen)
		return nil
	}
	delete(h.prefetchedCloud, fen)
	return entry.value
}

func (h *Handler) hasPrefetchedCloud(fen string) bool {
	h.prefetchMu.Lock()
	defer h.prefetchMu.Unlock()
	entry, ok := h.prefetchedCloud[fen]
	if !ok || time.Now().After(entry.expiresAt) {
		delete(h.prefetchedCloud, fen)
		return false
	}
	return true
}

func (h *Handler) rememberPrefetchedCloud(fen string, cloud *lichess.CloudEval) {
	h.prefetchMu.Lock()
	defer h.prefetchMu.Unlock()
	now := time.Now()
	for key, entry := range h.prefetchedCloud {
		if now.After(entry.expiresAt) {
			delete(h.prefetchedCloud, key)
		}
	}
	if len(h.prefetchedCloud) >= 6 {
		for key := range h.prefetchedCloud {
			delete(h.prefetchedCloud, key)
			break
		}
	}
	h.prefetchedCloud[fen] = prefetchedCloudEval{value: cloud, expiresAt: now.Add(15 * time.Second)}
}

type EvalFENResponse struct {
	Score             int    `json:"score"`
	Mate              int    `json:"mate"`
	Depth             int    `json:"depth"`
	TablebaseCategory string `json:"tablebaseCategory,omitempty"`
	TablebaseDTZ      *int   `json:"tablebaseDtz,omitempty"`
}

func (h *Handler) EvalFEN(w http.ResponseWriter, r *http.Request) {
	fen := r.URL.Query().Get("fen")
	pos, err := chess.ParseFEN(fen)
	if err != nil {
		http.Error(w, "invalid fen", http.StatusBadRequest)
		return
	}
	flipScore := pos.Turn == chess.Black

	// Matches analyzePosition's own game-over guard: a checkmate/stalemate
	// position has no "next move" to evaluate, and asking the tablebase
	// about one anyway produces a misleading result — verified live: Lichess
	// itself reports the terminal position's own dtz as -1 (a sentinel, not
	// "1 more ply needed"), but tablebaseAnalysis doesn't special-case
	// Checkmate/Stalemate, so a real checkmate FEN came back as
	// `"tablebaseDtz":1` — implying more play was still needed in a game
	// that already ended. Short-circuiting here (same as AnalyzeGame already
	// does) avoids the external call entirely for a position this engine
	// already fully understands.
	if probe, perr := chess.NewGameFromFEN("", fen); perr == nil && probe.IsGameOver() {
		respondJSON(w, http.StatusOK, EvalFENResponse{})
		return
	}

	tablebaseEligible := pos.PieceCount() <= lichess.MaxTablebasePieces
	if tablebaseEligible {
		if tb, terr := lichess.FetchTablebase(fen); terr == nil && tb != nil {
			result := tablebaseAnalysis(pos, tb)
			respondJSON(w, http.StatusOK, EvalFENResponse{
				Score:             result.Score,
				Mate:              result.Mate,
				TablebaseCategory: result.TablebaseCategory,
				TablebaseDTZ:      result.TablebaseDTZ,
			})
			return
		}
	}

	// Same reasoning as analyzePosition: skip the cloud-eval attempt after a
	// tablebase miss on an eligible (≤7-piece) position — that cache is
	// populated from real games' opening/middlegame analysis, so a sparse
	// synthetic endgame FEN is essentially never going to hit it, and trying
	// anyway would stack a second multi-second timeout on top of the first.
	if !tablebaseEligible {
		if cloud, cerr := lichess.Fetch(fen, 1); cerr == nil && cloud != nil && len(cloud.PVs) > 0 {
			pv := cloud.PVs[0]
			out := EvalFENResponse{Depth: cloud.Depth}
			if pv.CP != nil {
				out.Score = *pv.CP
			}
			if pv.Mate != nil {
				out.Mate = *pv.Mate
			}
			respondJSON(w, http.StatusOK, out)
			return
		}
	}

	if h.engine == nil {
		http.Error(w, "engine not configured", http.StatusServiceUnavailable)
		return
	}
	raw, aerr := h.engine.Analyze(fen, 1, 16)
	if aerr != nil || len(raw.Lines) == 0 {
		http.Error(w, "analysis failed", http.StatusInternalServerError)
		return
	}
	score, mate := raw.Lines[0].Score, raw.Lines[0].Mate
	if flipScore {
		score, mate = -score, -mate
	}
	respondJSON(w, http.StatusOK, EvalFENResponse{Score: score, Mate: mate, Depth: raw.Lines[0].Depth})
}

func (h *Handler) Explorer(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}

	fen := r.URL.Query().Get("fen")
	if fen == "" {
		g.RLock()
		fen = chess.FEN(g.Pos)
		g.RUnlock()
	}
	if _, err := chess.ParseFEN(fen); err != nil {
		http.Error(w, "invalid fen", http.StatusBadRequest)
		return
	}

	resp, err := lichess.FetchExplorer(fen)
	if err != nil {
		http.Error(w, "explorer unavailable: "+err.Error(), http.StatusServiceUnavailable)
		return
	}

	total := resp.White + resp.Draws + resp.Black
	out := ExplorerJSON{TotalGames: total}
	if resp.Opening != nil {
		out.OpeningName = resp.Opening.Name
		out.OpeningECO = resp.Opening.ECO
	}
	for _, m := range resp.Moves {
		games := m.White + m.Draws + m.Black
		mv := ExplorerMoveJSON{SAN: m.SAN, UCI: m.UCI, Games: games}
		if games > 0 {
			mv.WhitePct = float64(m.White) / float64(games) * 100
			mv.DrawPct = float64(m.Draws) / float64(games) * 100
			mv.BlackPct = float64(m.Black) / float64(games) * 100
		}
		if total > 0 {
			mv.SharePct = float64(games) / float64(total) * 100
		}
		if m.Opening != nil {
			mv.OpeningName = m.Opening.Name
			mv.OpeningECO = m.Opening.ECO
		}
		out.Moves = append(out.Moves, mv)
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *Handler) GotoNode(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}
	var req GotoNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	g.Lock()
	defer g.Unlock()
	if err := g.GotoNode(req.NodeID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	h.store.Save(g)
	respondJSON(w, http.StatusOK, toGameStateLocked(g))
}

func toGameState(g *chess.Game) GameStateJSON {
	g.RLock()
	defer g.RUnlock()
	return toGameStateLocked(g)
}

func toGameStateLocked(g *chess.Game) GameStateJSON {
	pieces := map[string]PieceJSON{}
	for sq := chess.Square(0); sq <= 63; sq++ {
		p := g.Pos.Board[sq]
		if p != nil {
			pieces[sq.String()] = PieceJSON{Type: p.Type.String(), Color: p.Color.String()}
		}
	}

	lms := g.LegalMoves()
	legalMoves := make([]MoveJSON, 0, len(lms))
	for _, m := range lms {
		legalMoves = append(legalMoves, toMoveJSON(m))
	}

	var lastMove *MoveJSON
	if g.LastMove != nil {
		mj := toMoveJSON(*g.LastMove)
		lastMove = &mj
	}
	isCheck := chess.InCheck(g.Pos, g.Pos.Turn)
	hasLegalMoves := len(lms) > 0
	isCheckmate := isCheck && !hasLegalMoves
	isStalemate := !isCheck && !hasLegalMoves
	is50MoveRule := g.Is50MoveRule()
	isInsufficientMaterial := g.IsInsufficientMaterial()
	isDraw := isStalemate || is50MoveRule || isInsufficientMaterial
	gameOverReason := ""
	switch {
	case isCheckmate:
		gameOverReason = "checkmate"
	case isStalemate:
		gameOverReason = "stalemate"
	case is50MoveRule:
		gameOverReason = "50-move rule"
	case isInsufficientMaterial:
		gameOverReason = "insufficient material"
	}

	return GameStateJSON{
		ID:             g.ID,
		FEN:            chess.FEN(g.Pos),
		Turn:           g.Pos.Turn.String(),
		FullMove:       g.Pos.FullMove,
		Pieces:         pieces,
		LegalMoves:     legalMoves,
		LastMove:       lastMove,
		IsCheck:        isCheck,
		IsCheckmate:    isCheckmate,
		IsStalemate:    isStalemate,
		IsDraw:         isDraw,
		IsGameOver:     isCheckmate || isDraw,
		GameOverReason: gameOverReason,
		MoveTree:       toMoveNode(g.Root, rootPly(g.Root.Pos)),
		CurrentNodeID:  g.Current.ID,
	}
}

// rootPly is the game-wide ply of a tree's root position, so a node's Ply
// always has White's moves odd and Black's even, whatever the start. Move lists
// number and pair moves from ply parity. Counting from 0 at every root put a
// Black-to-move start's first move (e.g. a book puzzle or an "Analyze this line"
// from a Black repertoire) in the White column.
func rootPly(pos *chess.Position) int {
	ply := (pos.FullMove - 1) * 2
	if pos.Turn == chess.Black {
		ply++
	}
	if ply < 0 {
		return 0
	}
	return ply
}

func toMoveNode(n *chess.Node, ply int) MoveNodeJSON {
	mj := MoveNodeJSON{ID: n.ID, SAN: n.SAN, FEN: chess.FEN(n.Pos), Ply: ply}
	if n.Parent != nil {
		mj.From = n.Move.From.String()
		mj.To = n.Move.To.String()
		if n.Move.IsPromotion() {
			mj.Promotion = n.Move.PromotionPiece().String()
		}
	}
	for _, ch := range n.Children {
		mj.Children = append(mj.Children, toMoveNode(ch, ply+1))
	}
	return mj
}

func toMoveJSON(m chess.Move) MoveJSON {
	mj := MoveJSON{From: m.From.String(), To: m.To.String()}
	if m.IsPromotion() {
		mj.Promotion = m.PromotionPiece().String()
	}
	switch m.Flag {
	case chess.EnPassant:
		mj.Flag = "en_passant"
	case chess.CastleKS:
		mj.Flag = "castle_ks"
	case chess.CastleQS:
		mj.Flag = "castle_qs"
	case chess.DoublePush:
		mj.Flag = "double_push"
	}
	return mj
}

func respondJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
