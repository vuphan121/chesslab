package db

import (
	"strings"
	"testing"
)

func TestRelationshipMigrationsMatchSchema(t *testing.T) {
	want := map[string]string{
		"card_progress_user_fk":            "card_progress",
		"line_attempts_user_fk":            "line_attempts",
		"progress_operations_user_fk":      "progress_operations",
		"book_item_progress_user_fk":       "book_item_progress",
		"book_study_activity_user_fk":      "book_study_activity",
		"book_saved_lines_user_fk":         "book_saved_lines",
		"today_training_settings_user_fk":  "today_training_settings",
		"today_training_queue_settings_fk": "today_training_queue",
		"saved_puzzles_user_fk":            "saved_puzzles",
	}

	if len(relationshipMigrations) != len(want) {
		t.Fatalf("got %d relationship migrations, want %d", len(relationshipMigrations), len(want))
	}
	for _, fk := range relationshipMigrations {
		table, ok := want[fk.name]
		if !ok {
			t.Errorf("unexpected relationship migration %q", fk.name)
			continue
		}
		if fk.table != table {
			t.Errorf("constraint %q targets table %q, want %q", fk.name, fk.table, table)
		}
		if !strings.Contains(schemaSQL, "CONSTRAINT "+fk.name) {
			t.Errorf("schema.sql does not declare %q for fresh databases", fk.name)
		}
		if !strings.Contains(fk.definition, "ON DELETE CASCADE NOT VALID") {
			t.Errorf("existing-database migration %q is not production-safe", fk.name)
		}
	}
}

func TestSameTodayTrainingSettingsRequiresExactSnapshot(t *testing.T) {
	base := TodayTrainingSettings{RepertoireIDs: []string{"white", "black"}, LinesPerDay: 1}
	if !sameTodayTrainingSettings(base, TodayTrainingSettings{RepertoireIDs: []string{"white", "black"}, LinesPerDay: 1}) {
		t.Fatal("identical settings should match")
	}
	if sameTodayTrainingSettings(base, TodayTrainingSettings{RepertoireIDs: []string{"black", "white"}, LinesPerDay: 1}) {
		t.Fatal("reordered settings are a different saved snapshot")
	}
	if sameTodayTrainingSettings(base, TodayTrainingSettings{RepertoireIDs: []string{"white", "black"}, LinesPerDay: 2}) {
		t.Fatal("different legacy line limit should not match")
	}
}
