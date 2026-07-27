package db

import (
	"context"
	"log"
	"time"
)

// StartCleanupLoop prunes line_attempts older than retention — runs once
// immediately (so a long-lived deploy doesn't wait a full interval before
// its first sweep) and then on the given interval, in the background.
// card_progress is never touched here; only the raw attempt log decays.
func (s *Store) StartCleanupLoop(retention, interval time.Duration) {
	sweep := func() {
		cutoff := time.Now().Add(-retention)
		ct, err := s.pool.Exec(context.Background(), "DELETE FROM line_attempts WHERE played_at < $1", cutoff)
		if err != nil {
			log.Printf("db: line_attempts cleanup failed: %v", err)
			return
		}
		if n := ct.RowsAffected(); n > 0 {
			log.Printf("db: pruned %d line_attempts row(s) older than %s", n, retention)
		}
	}

	sweep()
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			sweep()
		}
	}()
}
