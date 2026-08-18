package coach

import (
	"context"
	"log"
)

type Service struct {
	Tools *Tools
	LLM   LLMClient
}

func NewService(tools *Tools, llm LLMClient) *Service {
	return &Service{Tools: tools, LLM: llm}
}

func (s *Service) ExplainMove(ctx context.Context, req ExplainRequest) (string, error) {
	var theory LookupResult
	if s.Tools != nil && s.Tools.Index != nil {
		theory = s.Tools.Index.Lookup(req.FEN)
	}

	var quality *MoveQuality
	if s.Tools != nil && req.PrevFEN != "" && req.FEN != "" {
		if q, err := s.Tools.ClassifyMove(req.PrevFEN, req.FEN); err != nil {
			log.Printf("coach: per-move classification failed (%v) — explaining without it", err)
		} else {
			quality = &q
		}
	}

	system, user := BuildExplainPrompt(req, theory, quality)
	return s.LLM.Chat(ctx, system, user)
}
