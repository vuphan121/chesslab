package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/chesslab/backend/internal/chess"
	"github.com/chesslab/backend/internal/engine"
	"github.com/chesslab/backend/internal/lichess"
	"github.com/chesslab/backend/internal/storage"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	store  storage.Store
	engine *engine.Engine
}

func NewHandler(store storage.Store, eng *engine.Engine) *Handler {
	return &Handler{store: store, engine: eng}
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

// MoveNodeJSON is one node of the game's move tree. The root has an empty SAN
// and represents the starting position; children[0] is the main line and any
// further children are sidelines.
type MoveNodeJSON struct {
	ID       string         `json:"id"`
	SAN      string         `json:"san"`
	FEN      string         `json:"fen"`
	Ply      int            `json:"ply"`
	Children []MoveNodeJSON `json:"children"`
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
	Score int      `json:"score"` // centipawns, white perspective
	Mate  int      `json:"mate"`  // >0 = white mates in N; <0 = black mates in N
	Depth int      `json:"depth"`
	Moves []string `json:"moves"` // SAN
	FENs  []string `json:"fens"`  // FEN after each move
}

type AnalysisJSON struct {
	BestMove   string     `json:"bestMove"`
	Score      int        `json:"score"`
	Mate       int        `json:"mate"`
	Depth      int        `json:"depth"`
	EngineName string     `json:"engineName"`
	Lines      []LineJSON `json:"lines"`
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

func (h *Handler) CreateGame(w http.ResponseWriter, r *http.Request) {
	id := uuid.New().String()
	g := chess.NewGame(id)
	h.store.Save(g)
	respondJSON(w, http.StatusCreated, toGameState(g))
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

	if err := g.ApplyMove(chess.Move{From: from, To: to, Flag: flag}); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.store.Save(g)
	respondJSON(w, http.StatusOK, toGameState(g))
}

func (h *Handler) DeleteGame(w http.ResponseWriter, r *http.Request) {
	h.store.Delete(chi.URLParam(r, "id"))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) AnalyzeGame(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}
	if g.IsGameOver() {
		name := "Stockfish"
		if h.engine != nil {
			name = h.engine.Name
		}
		respondJSON(w, http.StatusOK, AnalysisJSON{EngineName: name})
		return
	}

	fen := chess.FEN(g.Pos)
	flipScore := g.Pos.Turn == chess.Black

	// Try Lichess cloud eval first (deep precomputed analysis, free).
	if cloud, err := lichess.Fetch(fen, 3); err == nil && cloud != nil {
		result := AnalysisJSON{EngineName: "Lichess Cloud", Depth: cloud.Depth}
		for i, pv := range cloud.PVs {
			score, mate := 0, 0
			if pv.CP != nil {
				score = *pv.CP
			}
			if pv.Mate != nil {
				mate = *pv.Mate
			}
			if flipScore {
				score, mate = -score, -mate
			}
			moves := strings.Fields(pv.Moves)
			sans, fens := chess.MovesToSANAndFENs(g.Pos, moves)
			if i == 0 {
				result.Score = score
				result.Mate = mate
				if len(moves) > 0 {
					result.BestMove = moves[0]
				}
			}
			result.Lines = append(result.Lines, LineJSON{
				Score: score,
				Mate:  mate,
				Depth: cloud.Depth,
				Moves: sans,
				FENs:  fens,
			})
		}
		respondJSON(w, http.StatusOK, result)
		return
	} else if err != nil {
		log.Printf("lichess cloud eval: %v", err)
	}

	// Fall back to local Stockfish.
	if h.engine == nil {
		http.Error(w, "engine not configured", http.StatusServiceUnavailable)
		return
	}
	raw, err := h.engine.Analyze(fen, 3, 20)
	if err != nil {
		http.Error(w, "analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
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
		sans, fens := chess.MovesToSANAndFENs(g.Pos, l.Moves)
		result.Lines = append(result.Lines, LineJSON{
			Score: score,
			Mate:  mate,
			Depth: l.Depth,
			Moves: sans,
			FENs:  fens,
		})
	}
	respondJSON(w, http.StatusOK, result)
}

func (h *Handler) Explorer(w http.ResponseWriter, r *http.Request) {
	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}

	resp, err := lichess.FetchExplorer(chess.FEN(g.Pos))
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
	if err := g.GotoNode(req.NodeID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	h.store.Save(g)
	respondJSON(w, http.StatusOK, toGameState(g))
}

func toGameState(g *chess.Game) GameStateJSON {
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

	return GameStateJSON{
		ID:             g.ID,
		FEN:            chess.FEN(g.Pos),
		Turn:           g.Pos.Turn.String(),
		FullMove:       g.Pos.FullMove,
		Pieces:         pieces,
		LegalMoves:     legalMoves,
		LastMove:       lastMove,
		IsCheck:        g.IsCheck(),
		IsCheckmate:    g.IsCheckmate(),
		IsStalemate:    g.IsStalemate(),
		IsDraw:         g.IsDraw(),
		IsGameOver:     g.IsGameOver(),
		MoveTree:       toMoveNode(g.Root, 0),
		CurrentNodeID:  g.Current.ID,
	}
}

// toMoveNode recursively serializes the move tree. ply is the half-move depth
// (root = 0, first move = 1, ...).
func toMoveNode(n *chess.Node, ply int) MoveNodeJSON {
	mj := MoveNodeJSON{ID: n.ID, SAN: n.SAN, FEN: chess.FEN(n.Pos), Ply: ply}
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
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}
