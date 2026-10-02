package db

import (
	"context"
	"log"
	"time"
)

func (s *Store) StartCleanupLoop(retention, puzzlePlaysRetention, interval time.Duration) {
	sweep := func() {
		cutoff := time.Now().Add(-retention)
		ct, err := s.pool.Exec(context.Background(), "DELETE FROM puzzle_plays WHERE played_at < $1", time.Now().Add(-puzzlePlaysRetention))
		if err != nil {
			log.Printf("db: puzzle_plays cleanup failed: %v", err)
		} else if n := ct.RowsAffected(); n > 0 {
			log.Printf("db: pruned %d puzzle_plays row(s) older than %s", n, puzzlePlaysRetention)
		}
		for _, table := range []struct{ name, column string }{{"puzzle_attempts", "played_at"}, {"book_study_activity", "first_moved_at"}} {
			ct, err = s.pool.Exec(context.Background(), "DELETE FROM "+table.name+" WHERE "+table.column+" < $1", cutoff)
			if err != nil {
				log.Printf("db: %s cleanup failed: %v", table.name, err)
				continue
			}
			if n := ct.RowsAffected(); n > 0 {
				log.Printf("db: pruned %d %s row(s) older than %s", n, table.name, retention)
			}
		}
		ct, err = s.pool.Exec(context.Background(), "DELETE FROM line_attempts WHERE played_at < $1", cutoff)
		if err != nil {
			log.Printf("db: line_attempts cleanup failed: %v", err)
			return
		}
		if n := ct.RowsAffected(); n > 0 {
			log.Printf("db: pruned %d line_attempts row(s) older than %s", n, retention)
		}
		ct, err = s.pool.Exec(context.Background(), "DELETE FROM progress_operations WHERE created_at < $1", cutoff)
		if err != nil {
			log.Printf("db: progress_operations cleanup failed: %v", err)
			return
		}
		if n := ct.RowsAffected(); n > 0 {
			log.Printf("db: pruned %d progress operation(s) older than %s", n, retention)
		}
		ct, err = s.pool.Exec(context.Background(), "DELETE FROM today_training_operations WHERE created_at < $1", cutoff)
		if err != nil {
			log.Printf("db: today_training_operations cleanup failed: %v", err)
			return
		}
		if n := ct.RowsAffected(); n > 0 {
			log.Printf("db: pruned %d today training operation(s) older than %s", n, retention)
		}
		ct, err = s.pool.Exec(context.Background(), "DELETE FROM today_training_queue WHERE queue_date < $1::date", cutoff.UTC().Format("2006-01-02"))
		if err != nil {
			log.Printf("db: today_training_queue cleanup failed: %v", err)
			return
		}
		if n := ct.RowsAffected(); n > 0 {
			log.Printf("db: pruned %d old today training queue row(s) older than %s", n, retention)
		}
		ct, err = s.pool.Exec(context.Background(), "DELETE FROM precompute_runs WHERE started_at < $1", cutoff)
		if err != nil {
			log.Printf("db: precompute_runs cleanup failed: %v", err)
			return
		}
		if n := ct.RowsAffected(); n > 0 {
			log.Printf("db: pruned %d precompute run(s) older than %s", n, retention)
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
