package repertoire

import "testing"

func TestStudyID(t *testing.T) {
	for _, raw := range []string{
		"https://lichess.org/study/pYmWdR27",
		"https://lichess.org/study/pYmWdR27/KXWPZNBT",
	} {
		id, err := StudyID(raw)
		if err != nil || id != "pYmWdR27" {
			t.Fatalf("StudyID(%q) = %q, %v", raw, id, err)
		}
	}
}

func TestStudyIDRejectsNonStudyURLs(t *testing.T) {
	for _, raw := range []string{"https://example.com/study/pYmWdR27", "https://lichess.org/game/export/pYmWdR27", "https://lichess.org/study/nope"} {
		if _, err := StudyID(raw); err == nil {
			t.Fatalf("StudyID(%q) unexpectedly succeeded", raw)
		}
	}
}
