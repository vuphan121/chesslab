package api

import (
	"encoding/json"
	"net/http"

	"github.com/chesslab/backend/internal/chess"
	"github.com/chesslab/backend/internal/storage"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	store storage.Store
}

func NewHandler(store storage.Store) *Handler {
	return &Handler{store: store}
}

// --- request / response types ---

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

type GameStateJSON struct {
	ID             string               `json:"id"`
	FEN            string               `json:"fen"`
	Turn           string               `json:"turn"`
	Pieces         map[string]PieceJSON `json:"pieces"`
	LegalMoves     []MoveJSON           `json:"legalMoves"`
	LastMove       *MoveJSON            `json:"lastMove"`
	IsCheck        bool                 `json:"isCheck"`
	IsCheckmate    bool                 `json:"isCheckmate"`
	IsStalemate    bool                 `json:"isStalemate"`
	IsDraw         bool                 `json:"isDraw"`
	IsGameOver     bool                 `json:"isGameOver"`
	GameOverReason string               `json:"gameOverReason"`
}

type MakeMoveRequest struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Promotion string `json:"promotion"` // "q"|"r"|"b"|"n" — empty defaults to queen
}

// --- handlers ---

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

// --- helpers ---

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
		Pieces:         pieces,
		LegalMoves:     legalMoves,
		LastMove:       lastMove,
		IsCheck:        g.IsCheck(),
		IsCheckmate:    g.IsCheckmate(),
		IsStalemate:    g.IsStalemate(),
		IsDraw:         g.IsDraw(),
		IsGameOver:     g.IsGameOver(),
		GameOverReason: g.GameOverReason(),
	}
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
