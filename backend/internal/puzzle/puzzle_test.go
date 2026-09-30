package puzzle

import (
	"math"
	"strings"
	"testing"
)

func TestNextRating(t *testing.T) {
	if got := Expected(2000, 2000); math.Abs(got-0.5) > 1e-9 {
		t.Fatalf("even match expected 0.5, got %v", got)
	}
	if got := NextRating(2000, 2000, true, 0); math.Abs(got-2016) > 1e-9 {
		t.Fatalf("solve even puzzle: got %v, want 2016", got)
	}
	if got := NextRating(2000, 2000, false, 0); math.Abs(got-1984) > 1e-9 {
		t.Fatalf("fail even puzzle: got %v, want 1984", got)
	}
	easy := NextRating(2000, 1600, false, 0)
	hard := NextRating(2000, 2400, false, 0)
	if !(easy < hard) || !(easy < 1984) {
		t.Fatalf("failing an easy puzzle should cost more: easy=%v hard=%v", easy, hard)
	}
	if got := NextRating(2000, 2000, true, 50); math.Abs(got-2012) > 1e-9 {
		t.Fatalf("settled K: got %v, want 2012", got)
	}
}

func TestThemeCatalog(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range Categories() {
		if len(c.Themes) == 0 {
			t.Errorf("category %s is empty", c.Key)
		}
		for _, th := range c.Themes {
			if seen[th] {
				t.Errorf("theme %s appears twice", th)
			}
			seen[th] = true
			if CategoryOf(th) != c.Key || InMixed(th) != c.InMixed || !IsTheme(th) {
				t.Errorf("theme %s is not indexed under %s", th, c.Key)
			}
		}
	}
	for _, th := range []string{"rookEndgame", "fork", "mateIn5", "vukovicMate", "castling"} {
		if !seen[th] {
			t.Errorf("missing Lichess theme %s", th)
		}
	}
	if InMixed("short") || InMixed("crushing") || !InMixed("fork") {
		t.Error("mixed pool should contain tactical themes only")
	}
}

func TestRatingKey(t *testing.T) {
	k := RatingKey(2034, 123456)
	if KeyRating(k) != 2034 {
		t.Fatalf("round trip: got %d", KeyRating(k))
	}
	if RatingKey(2034, 999999) >= RatingKey(2035, 0) {
		t.Fatal("keys of one rating must sort below the next rating")
	}
}

func TestReadCSVAndSelectableThemes(t *testing.T) {
	data := strings.Join([]string{
		"PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags",
		"a,f,m1 m2,1900,80,90,900,fork notATheme short,u,",
		"bad,row",
	}, "\n")
	var rows []Row
	bad, err := ReadCSV(strings.NewReader(data), func(r Row) { rows = append(rows, r) })
	if err != nil || bad != 1 || len(rows) != 1 {
		t.Fatalf("rows=%d bad=%d err=%v", len(rows), bad, err)
	}
	got := rows[0].SelectableThemes()
	if len(got) != 2 || got[0] != "fork" || got[1] != "short" {
		t.Fatalf("selectable themes: %v", got)
	}
}
