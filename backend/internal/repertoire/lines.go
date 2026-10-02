package repertoire

import "strings"

type Line struct {
	ID        string
	ChapterID string
	CardIDs   []string
}

func Lines(rep *Repertoire) []Line {
	cards := make(map[string]bool, len(rep.Cards))
	for _, c := range rep.Cards {
		cards[c.ID] = true
	}
	var out []Line
	for _, ch := range rep.Chapters {
		if ch.Root == nil {
			continue
		}
		var walk func(n *Node, sans []string, excluded bool, keys []string)
		walk = func(n *Node, sans []string, excluded bool, keys []string) {
			if len(n.Children) == 0 {
				if len(sans) > 0 && !excluded {
					ids := make([]string, 0, len(keys))
					for _, k := range keys {
						if cards[k] {
							ids = append(ids, k)
						}
					}
					out = append(out, Line{ID: ch.ID + ":" + strings.Join(sans, " "), ChapterID: ch.ID, CardIDs: ids})
				}
				return
			}
			for _, child := range n.Children {
				walk(child, append(append([]string(nil), sans...), child.SAN), excluded || child.Excluded, append(append([]string(nil), keys...), CardKey(child.FEN)))
			}
		}
		walk(ch.Root, nil, false, []string{CardKey(ch.Root.FEN)})
	}
	return out
}
