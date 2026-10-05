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

func TestPickMixedThemeMatchesFamilyWeights(t *testing.T) {
	var candidates []string
	for _, c := range categories {
		if c.InMixed {
			candidates = append(candidates, c.Themes...)
		}
	}
	rng := rand.New(rand.NewSource(1))
	counts := map[string]int{}
	const draws = 40000
	for i := 0; i < draws; i++ {
		key := PickMixedTheme(candidates, "", rng.Intn)
		if key == "" {
			t.Fatal("empty pick")
		}
		counts[mixedFamily(key)]++
	}
	for family, weight := range mixedFamilyWeights {
		want := float64(weight) / 100 * draws
		got := float64(counts[family])
		if got < want*0.95 || got > want*1.05 {
			t.Errorf("family %s drawn %v times, want about %v", family, got, want)
		}
	}
}

func TestPickMixedThemeSplitsPhasesEvenly(t *testing.T) {
	var candidates []string
	for _, c := range categories {
		if c.InMixed {
			candidates = append(candidates, c.Themes...)
		}
	}
	rng := rand.New(rand.NewSource(5))
	buckets := map[string]int{}
	endgameTypes := map[string]int{}
	phaseDraws := 0
	for i := 0; i < 200000; i++ {
		key := PickMixedTheme(candidates, "", rng.Intn)
		if mixedFamily(key) != "phases" {
			continue
		}
		phaseDraws++
		bucket := phaseBucket(key)
		buckets[bucket]++
		if bucket == "endgame" {
			endgameTypes[key]++
		}
	}
	for _, bucket := range []string{"opening", "middlegame", "endgame"} {
		want := float64(phaseDraws) / 3
		got := float64(buckets[bucket])
		if got < want*0.93 || got > want*1.07 {
			t.Errorf("bucket %s drawn %v times, want about %v", bucket, got, want)
		}
	}
	if len(endgameTypes) != 7 {
		t.Fatalf("expected 7 endgame types, saw %d", len(endgameTypes))
	}
	want := float64(buckets["endgame"]) / 7
	for key, n := range endgameTypes {
		if float64(n) < want*0.9 || float64(n) > want*1.1 {
			t.Errorf("endgame type %s drawn %d times, want about %v", key, n, want)
		}
	}
}

func TestPickMixedThemeSkipsEmptyPhaseBuckets(t *testing.T) {
	rng := rand.New(rand.NewSource(6))
	for i := 0; i < 500; i++ {
		key := PickMixedTheme([]string{"rookEndgame", "pawnEndgame"}, "", rng.Intn)
		if key != "rookEndgame" && key != "pawnEndgame" {
			t.Fatalf("got %q", key)
		}
	}
}

func TestPickMixedThemeNeverRepeatsTheAvoidedTheme(t *testing.T) {
	rng := rand.New(rand.NewSource(3))
	for i := 0; i < 2000; i++ {
		if key := PickMixedTheme([]string{"fork", "pin", "mateIn1"}, "fork", rng.Intn); key == "fork" || key == "" {
			t.Fatalf("got %q", key)
		}
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
