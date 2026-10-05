package puzzle

import (
	"math"
	"math/rand"
	"strings"
	"testing"
)

func TestNextRating(t *testing.T) {
	if got := Expected(2000, 2000); math.Abs(got-0.5) > 1e-9 {
		t.Fatalf("even match expected 0.5, got %v", got)
	}
	if got := NextRating(2000, 2000, true, 0); math.Abs(got-2006) > 1e-9 {
		t.Fatalf("solve even puzzle: got %v, want 2006", got)
	}
	if got := NextRating(2000, 2000, false, 0); math.Abs(got-1994) > 1e-9 {
		t.Fatalf("fail even puzzle: got %v, want 1994", got)
	}
	easy := NextRating(2000, 1600, false, 0)
	hard := NextRating(2000, 2400, false, 0)
	if !(easy < hard) || !(easy < 1994) {
		t.Fatalf("failing an easy puzzle should cost more: easy=%v hard=%v", easy, hard)
	}
	if got := NextRating(2000, 2000, true, 50); math.Abs(got-2005) > 1e-9 {
		t.Fatalf("settled K: got %v, want 2005", got)
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

func TestPickMixedThemeSpreadsAcrossFamilies(t *testing.T) {
	var candidates []string
	for _, c := range categories {
		if c.InMixed {
			candidates = append(candidates, c.Themes...)
		}
	}
	rng := rand.New(rand.NewSource(1))
	counts := map[string]int{}
	avoid := ""
	const draws = 20000
	repeats := 0
	for i := 0; i < draws; i++ {
		key := PickMixedTheme(candidates, avoid, rng.Intn)
		if key == "" || key == avoid {
			t.Fatalf("bad pick %q after %q", key, avoid)
		}
		if avoid != "" && mixedFamily(key) == mixedFamily(avoid) {
			repeats++
		}
		counts[mixedFamily(key)]++
		avoid = key
	}
	if repeats > 0 {
		t.Errorf("same family back to back %d times with other families available", repeats)
	}
	for family, weight := range mixedFamilyWeights {
		want := float64(weight) / 100 * draws
		got := float64(counts[family])
		if got < want*0.7 || got > want*1.3 {
			t.Errorf("family %s drawn %v times, want about %v", family, got, want)
		}
	}
	if counts["mate"] > draws/4 {
		t.Errorf("mate share too high: %d of %d", counts["mate"], draws)
	}
}

func TestPickMixedThemeFallsBackToSameFamily(t *testing.T) {
	rng := rand.New(rand.NewSource(2))
	key := PickMixedTheme([]string{"mateIn1", "mateIn2"}, "mateIn1", rng.Intn)
	if key != "mateIn2" {
		t.Errorf("got %q, want mateIn2", key)
	}
	if got := PickMixedTheme([]string{"mateIn1"}, "mateIn1", rng.Intn); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}
