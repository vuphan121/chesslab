package coach

import (
	"context"
	"log"
)

// Service is the per-move explanation path (design doc "Path 1"): look up
// theory chunks for the position, classify the move that was just played
// (book-aware, so gambits aren't scolded), fold in engine/explorer grounding
// already supplied by the caller, and ask the LLM to write the explanation.
type Service struct {
	Tools *Tools
	LLM   LLMClient
}

func NewService(tools *Tools, llm LLMClient) *Service {
	return &Service{Tools: tools, LLM: llm}
}

func (s *Service) ExplainMove(ctx context.Context, req ExplainRequest) (string, error) {
	var chunks []Chunk
	if s.Tools != nil && s.Tools.Index != nil {
		chunks = s.Tools.Index.Lookup(req.FEN)
	}

	// Classify the move that was just played, when we know the prior position —
	// gives the explanation a book-aware quality verdict (a gambit reads as
	// "Book", not "Mistake"). Best-effort: on failure we just explain without it.
	var quality *MoveQuality
	if s.Tools != nil && req.PrevFEN != "" && req.FEN != "" {
		if q, err := s.Tools.ClassifyMove(req.PrevFEN, req.FEN); err != nil {
			log.Printf("coach: per-move classification failed (%v) — explaining without it", err)
		} else {
			quality = &q
		}
	}

	system, user := BuildExplainPrompt(req, chunks, quality)
	return s.LLM.Chat(ctx, system, user)
}
