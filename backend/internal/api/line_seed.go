package api

import (
	"context"
	"log"

	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/repertoire"
)

func estimateLineHistory(cardIDs []string, cards map[string]db.CardBox) (bits, n int, ok bool) {
	if len(cardIDs) == 0 {
		return 0, 0, false
	}
	streak := db.RecentWindow
	for _, id := range cardIDs {
		c, seen := cards[id]
		if !seen {
			streak = 0
			continue
		}
		if c.Seen > n {
			n = c.Seen
		}
		s := c.Box
		if s > c.Seen {
			s = c.Seen
		}
		if s < streak {
			streak = s
		}
		ok = true
	}
	if !ok {
		return 0, 0, false
	}
	if n > db.RecentWindow {
		n = db.RecentWindow
	}
	if streak > n {
		streak = n
	}
	if streak < 0 {
		streak = 0
	}
	return 1<<streak - 1, n, true
}

func SeedLineHistories(ctx context.Context, store *db.Store, repos *repertoire.Store) {
	pairs, err := store.CardProgressRepertoires(ctx)
	if err != nil {
		log.Printf("line history seed skipped: %v", err)
		return
	}
	seeded := 0
	for _, pair := range pairs {
		rep, ok := repos.Get(pair[1])
		if !ok {
			continue
		}
		cards, err := store.CardBoxes(ctx, pair[0], pair[1])
		if err != nil {
			log.Printf("line history seed skipped for %s/%s: %v", pair[0], pair[1], err)
			continue
		}
		for _, line := range repertoire.Lines(rep) {
			bits, n, ok := estimateLineHistory(line.CardIDs, cards)
			if !ok {
				continue
			}
			inserted, err := store.SeedLineHistory(ctx, pair[0], pair[1], line.ID, bits, n)
			if err != nil {
				log.Printf("line history seed failed: %v", err)
				break
			}
			if inserted {
				seeded++
			}
		}
	}
	if seeded > 0 {
		log.Printf("line history: seeded %d line(s) from card progress", seeded)
	}
}
