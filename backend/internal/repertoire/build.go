package repertoire

import (
	"fmt"
	"strings"

	"github.com/chesslab/backend/internal/chess"
)

func CardKey(fen string) string {
	fields := strings.Fields(fen)
	if len(fields) < 4 {
		return fen
	}
	return strings.Join(fields[:4], " ")
}

func BuildRepertoire(chapters []*Chapter, cfg *Config) (*Repertoire, error) {
	if err := applyExclusions(chapters, cfg); err != nil {
		return nil, err
	}
	for _, ch := range chapters {
		applyNAGExclusions(ch.Root)
		markExcludedSubtree(ch.Root, false)
	}

	side := chess.White
	switch {
	case cfg != nil && cfg.Side == "b":
		side = chess.Black
	case cfg != nil && cfg.Side == "w":
		side = chess.White
	case len(chapters) > 0:
		side = chapters[0].Root.Pos.Turn
	}

	rep := &Repertoire{
		Side:     side,
		Config:   cfg,
		Chapters: chapters,
		Cards:    deriveCards(chapters, side),
		Replies:  deriveReplies(chapters, side),
	}
	if cfg != nil {
		rep.ID = cfg.ID
		rep.Name = cfg.Name
		rep.Source = cfg.Source
		rep.Description = cfg.Description
	}
	return rep, nil
}

func applyExclusions(chapters []*Chapter, cfg *Config) error {
	if cfg == nil {
		return nil
	}
	for _, rule := range cfg.Excluded {
		var ch *Chapter
		for _, c := range chapters {
			if c.Name == rule.Chapter {
				ch = c
				break
			}
		}
		if ch == nil {
			return fmt.Errorf("exclusion rule references unknown chapter %q", rule.Chapter)
		}

		node := ch.Root
		for _, san := range rule.Path {
			var next *Node
			for _, child := range node.Children {
				if child.SAN == san {
					next = child
					break
				}
			}
			if next == nil {
				return fmt.Errorf("exclusion rule for chapter %q: move %q not found in path %v", rule.Chapter, san, rule.Path)
			}
			node = next
		}
		node.Excluded = true
		if node.ExcludedReason == "" {
			node.ExcludedReason = rule.Reason
		}
	}
	return nil
}

func applyNAGExclusions(n *Node) {
	for _, nag := range n.NAGs {
		if nag == 2 || nag == 4 || nag == 6 {
			n.Excluded = true
			if n.ExcludedReason == "" {
				n.ExcludedReason = "annotated ?/??/?! in the study"
			}
		}
	}
	for _, c := range n.Children {
		applyNAGExclusions(c)
	}
}

func markExcludedSubtree(n *Node, inherited bool) {
	n.ExcludedSubtree = inherited || n.Excluded
	for _, c := range n.Children {
		markExcludedSubtree(c, n.ExcludedSubtree)
	}
}

func deriveCards(chapters []*Chapter, side chess.Color) []*Card {
	byID := map[string]*Card{}
	var order []string
	for _, ch := range chapters {
		walkCards(ch, ch.Root, side, byID, &order)
	}
	cards := make([]*Card, 0, len(order))
	for _, id := range order {
		cards = append(cards, byID[id])
	}
	return cards
}

func walkCards(ch *Chapter, n *Node, side chess.Color, byID map[string]*Card, order *[]string) {
	if !n.ExcludedSubtree && n.Pos.Turn == side && len(n.Children) > 0 {
		id := CardKey(n.FEN)
		card, ok := byID[id]
		if !ok {
			card = &Card{ID: id, FEN: n.FEN, Side: side, Ply: n.Ply, PathSAN: pathSAN(n)}
			byID[id] = card
			*order = append(*order, id)
		}
		if !containsStr(card.ChapterIDs, ch.ID) {
			card.ChapterIDs = append(card.ChapterIDs, ch.ID)
		}
		for _, child := range n.Children {
			mergeAnswer(card, ch.ID, child)
		}
	}
	for _, c := range n.Children {
		walkCards(ch, c, side, byID, order)
	}
}

func mergeAnswer(card *Card, chapterID string, child *Node) {
	if child.Excluded {
		for i := range card.ExcludedAnswers {
			if card.ExcludedAnswers[i].SAN == child.SAN {
				return
			}
		}
		card.ExcludedAnswers = append(card.ExcludedAnswers, ExcludedAnswer{
			SAN: child.SAN, UCI: child.UCI, Reason: child.ExcludedReason,
		})
		return
	}
	for i := range card.Answers {
		if card.Answers[i].SAN == child.SAN {
			if !containsStr(card.Answers[i].ChapterIDs, chapterID) {
				card.Answers[i].ChapterIDs = append(card.Answers[i].ChapterIDs, chapterID)
			}
			return
		}
	}
	card.Answers = append(card.Answers, Answer{
		SAN:        child.SAN,
		UCI:        child.UCI,
		FEN:        child.FEN,
		Primary:    len(card.Answers) == 0,
		Comment:    child.Comment,
		ChapterIDs: []string{chapterID},
	})
}

func deriveReplies(chapters []*Chapter, side chess.Color) map[string][]Reply {
	replies := map[string][]Reply{}
	for _, ch := range chapters {
		walkReplies(ch, ch.Root, side, replies)
	}
	return replies
}

func walkReplies(ch *Chapter, n *Node, side chess.Color, replies map[string][]Reply) {
	if !n.ExcludedSubtree && n.Pos.Turn != side && len(n.Children) > 0 {
		key := CardKey(n.FEN)
		list := replies[key]
		for _, child := range n.Children {
			if child.Excluded {
				continue
			}
			found := false
			for i := range list {
				if list[i].SAN == child.SAN {
					if !containsStr(list[i].ChapterIDs, ch.ID) {
						list[i].ChapterIDs = append(list[i].ChapterIDs, ch.ID)
					}
					found = true
					break
				}
			}
			if !found {
				list = append(list, Reply{SAN: child.SAN, UCI: child.UCI, FEN: child.FEN, ChapterIDs: []string{ch.ID}})
			}
		}
		replies[key] = list
	}
	for _, c := range n.Children {
		walkReplies(ch, c, side, replies)
	}
}

func pathSAN(n *Node) []string {
	rev := []string{}
	for cur := n; cur.Parent != nil; cur = cur.Parent {
		rev = append(rev, cur.SAN)
	}
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	return rev
}

func containsStr(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}
