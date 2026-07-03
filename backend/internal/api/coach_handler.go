package api

import (
	"encoding/json"
	"net/http"

	"github.com/chesslab/backend/internal/chess"
	"github.com/chesslab/backend/internal/coach"
	"github.com/go-chi/chi/v5"
)

// ExplainMoveRequest carries the FEN/move plus whatever analysis/explorer
// data the frontend already fetched via refreshInsights — no extra
// Stockfish/Lichess round trip needed for the per-move explanation path.
type ExplainMoveRequest struct {
	FEN         string        `json:"fen"`
	PrevFEN     string        `json:"prevFen"` // position before the move, for move classification
	LastMoveSAN string        `json:"lastMoveSan"`
	Analysis    *AnalysisJSON `json:"analysis"`
	Explorer    *ExplorerJSON `json:"explorer"`
}

type ExplainMoveResponse struct {
	Explanation string `json:"explanation"`
}

func (h *Handler) ExplainMove(w http.ResponseWriter, r *http.Request) {
	if h.coach == nil {
		http.Error(w, "coach not configured", http.StatusServiceUnavailable)
		return
	}

	var req ExplainMoveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.FEN == "" {
		http.Error(w, "fen is required", http.StatusBadRequest)
		return
	}

	explainReq := coach.ExplainRequest{
		FEN:         req.FEN,
		PrevFEN:     req.PrevFEN,
		LastMoveSAN: req.LastMoveSAN,
		Analysis:    toAnalysisInput(req.Analysis),
		Explorer:    toExplorerInput(req.Explorer),
	}

	explanation, err := h.coach.ExplainMove(r.Context(), explainReq)
	if err != nil {
		http.Error(w, "coach explanation failed: "+err.Error(), http.StatusBadGateway)
		return
	}

	respondJSON(w, http.StatusOK, ExplainMoveResponse{Explanation: explanation})
}

// ChatTurnJSON is one message in the conversation history the frontend
// maintains and resends — the coach agent is stateless between requests.
type ChatTurnJSON struct {
	Role    string `json:"role"` // "user" or "assistant"
	Content string `json:"content"`
}

type CoachChatRequest struct {
	Message string         `json:"message"`
	History []ChatTurnJSON `json:"history"`
}

type CoachChatResponse struct {
	Reply string `json:"reply"`
}

func (h *Handler) CoachChat(w http.ResponseWriter, r *http.Request) {
	if h.coachAgent == nil {
		http.Error(w, "coach chat not configured", http.StatusServiceUnavailable)
		return
	}

	g, ok := h.store.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}

	var req CoachChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Message == "" {
		http.Error(w, "message is required", http.StatusBadRequest)
		return
	}

	history := make([]coach.ChatTurn, 0, len(req.History))
	for _, t := range req.History {
		history = append(history, coach.ChatTurn{Role: t.Role, Content: t.Content})
	}

	posCtx := coach.PositionContext{
		FEN:         chess.FEN(g.Current.Pos),
		LastMoveSAN: g.Current.SAN,
	}
	if g.Current.Parent != nil {
		posCtx.PrevFEN = chess.FEN(g.Current.Parent.Pos)
	}

	reply, err := h.coachAgent.Chat(r.Context(), posCtx, history, req.Message)
	if err != nil {
		http.Error(w, "coach chat failed: "+err.Error(), http.StatusBadGateway)
		return
	}

	respondJSON(w, http.StatusOK, CoachChatResponse{Reply: reply})
}

func toAnalysisInput(a *AnalysisJSON) *coach.AnalysisInput {
	if a == nil {
		return nil
	}
	lines := make([]coach.LineInput, 0, len(a.Lines))
	for _, l := range a.Lines {
		lines = append(lines, coach.LineInput{Score: l.Score, Mate: l.Mate, Moves: l.Moves})
	}
	return &coach.AnalysisInput{
		EngineName: a.EngineName,
		Depth:      a.Depth,
		Score:      a.Score,
		Mate:       a.Mate,
		Lines:      lines,
	}
}

func toExplorerInput(e *ExplorerJSON) *coach.ExplorerInput {
	if e == nil {
		return nil
	}
	moves := make([]coach.ExplorerMoveInput, 0, len(e.Moves))
	for _, m := range e.Moves {
		moves = append(moves, coach.ExplorerMoveInput{
			SAN:      m.SAN,
			Games:    m.Games,
			SharePct: m.SharePct,
			WhitePct: m.WhitePct,
			DrawPct:  m.DrawPct,
			BlackPct: m.BlackPct,
		})
	}
	return &coach.ExplorerInput{
		TotalGames:  e.TotalGames,
		OpeningName: e.OpeningName,
		OpeningECO:  e.OpeningECO,
		Moves:       moves,
	}
}
