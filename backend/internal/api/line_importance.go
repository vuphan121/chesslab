package api

import (
	"context"
	"math"
	"time"

	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/lichess"
	"github.com/chesslab/backend/internal/repertoire"
)

func (h *Handler) ensureLineImportance(ctx context.Context, rep *repertoire.Repertoire) map[string]float64 {
	cached, err := h.db.GetLineImportance(ctx, rep.ID)
	if err == nil && len(cached) == len(rep.Cards) {
		return importanceValues(cached)
	}
	return h.refreshLineImportance(ctx, rep)
}

func (h *Handler) refreshLineImportance(ctx context.Context, rep *repertoire.Repertoire) map[string]float64 {
	countsByFEN := map[string]int64{}
	entries := make([]db.LineImportance, 0, len(rep.Cards))
	fetchEnabled := true
	fetchFailed := false
	for _, card := range rep.Cards {
		fen := popularityFEN(rep, card)
		count, exists := countsByFEN[fen]
		if !exists {
			if fetchEnabled {
				response, err := lichess.FetchExplorer(fen)
				if err == nil {
					count = int64(response.White + response.Draws + response.Black)
				} else {
					fetchEnabled = false
					fetchFailed = true
				}
				if fetchEnabled {
					time.Sleep(125 * time.Millisecond)
				}
			}
			countsByFEN[fen] = count
		}
		entries = append(entries, db.LineImportance{CardID: card.ID, PlayCount: count})
	}
	if fetchFailed {
		return neutralImportance(rep)
	}

	minimum, maximum := int64(0), int64(0)
	for index, entry := range entries {
		if index == 0 || entry.PlayCount < minimum {
			minimum = entry.PlayCount
		}
		if index == 0 || entry.PlayCount > maximum {
			maximum = entry.PlayCount
		}
	}
	minLog, maxLog := math.Log1p(float64(minimum)), math.Log1p(float64(maximum))
	for index := range entries {
		if maxLog == minLog {
			entries[index].Importance = 0.5
		} else {
			entries[index].Importance = (math.Log1p(float64(entries[index].PlayCount)) - minLog) / (maxLog - minLog)
		}
	}
	if err := h.db.ReplaceLineImportance(ctx, rep.ID, entries); err != nil {
		return neutralImportance(rep)
	}
	values := map[string]float64{}
	for _, entry := range entries {
		values[entry.CardID] = entry.Importance
	}
	return values
}

func importanceValues(entries map[string]db.LineImportance) map[string]float64 {
	values := map[string]float64{}
	for cardID, entry := range entries {
		values[cardID] = entry.Importance
	}
	return values
}

func neutralImportance(rep *repertoire.Repertoire) map[string]float64 {
	values := map[string]float64{}
	for _, card := range rep.Cards {
		values[card.ID] = 0.5
	}
	return values
}

func popularityFEN(rep *repertoire.Repertoire, card *repertoire.Card) string {
	for _, chapterID := range card.ChapterIDs {
		for _, chapter := range rep.Chapters {
			if chapter.ID != chapterID {
				continue
			}
			node := findCardNode(chapter.Root, card.ID)
			if node == nil {
				continue
			}
			path := []*repertoire.Node{}
			for current := node; current != nil; current = current.Parent {
				path = append([]*repertoire.Node{current}, path...)
			}
			moves := path[1:]
			if len(moves) < 3 {
				for _, answer := range card.Answers {
					if !answer.Primary {
						continue
					}
					for _, child := range node.Children {
						if child.UCI == answer.UCI {
							moves = append(moves, child)
							break
						}
					}
					break
				}
			}
			if len(moves) > 0 {
				limit := len(moves)
				if limit > 3 {
					limit = 3
				}
				return moves[limit-1].FEN
			}
			return node.FEN
		}
	}
	return card.FEN
}

func findCardNode(node *repertoire.Node, cardID string) *repertoire.Node {
	if repertoire.CardKey(node.FEN) == cardID {
		return node
	}
	for _, child := range node.Children {
		if found := findCardNode(child, cardID); found != nil {
			return found
		}
	}
	return nil
}
