package db

import (
	"context"
	"fmt"
)

type BookStudyActivity struct {
	BookID      string
	BookTitle   string
	ChapterID   string
	ChapterName string
	ItemID      string
	ItemType    string
}

func (s *Store) RecordBookStudyActivity(ctx context.Context, username string, activity BookStudyActivity) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO book_study_activity
			(username, book_id, book_title, chapter_id, chapter_name, item_id, item_type, activity_hour)
		VALUES ($1, $2, $3, $4, $5, $6, $7, date_trunc('hour', now()))
		ON CONFLICT (username, book_id, chapter_id, item_id, activity_hour) DO NOTHING`,
		username, activity.BookID, activity.BookTitle, activity.ChapterID, activity.ChapterName, activity.ItemID, activity.ItemType)
	if err != nil {
		return fmt.Errorf("insert book_study_activity: %w", err)
	}
	return nil
}
