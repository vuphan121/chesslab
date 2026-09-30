package puzzle

import (
	"fmt"
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

func TestSampler(t *testing.T) {
	csv := "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags\n" +
		"a,f,m1 m2,1500,80,90,900,fork short,u,\n" +
		"b,f,m1 m2,1510,80,90,900,fork pin,u,\n" +
		"c,f,m1 m2,1520,80,90,900,fork,u,\n" +
		"d,f,m1 m2,1530,80,20,900,fork,u,\n" +
		"e,f,m1 m2,1540,80,90,10,fork,u,\n" +
		"f,f,m1 m2,300,80,90,900,fork,u,\n" +
		"g,f,m1 m2,1800,80,90,900,notATheme,u,\n" +
		"bad,row\n"
	s := NewSampler(SampleOptions{PerBand: 2, BandWidth: 50, MinRating: 400, MaxRating: 3500, MinPopularity: 50, MinPlays: 100, Seed: 1})
	bad, err := ReadCSV(strings.NewReader(csv), s.Add)
	if err != nil || bad != 1 {
		t.Fatalf("bad=%d err=%v", bad, err)
	}
	got := map[string]bool{}
	for _, r := range s.Result() {
		got[r.ID] = true
	}
	for _, id := range []string{"d", "e", "f", "g"} {
		if got[id] {
			t.Errorf("%s should have been filtered out", id)
		}
	}
	if !got["b"] {
		t.Errorf("b is the only pin puzzle in its band and must be kept: got %v", got)
	}
	perFork := 0
	for _, r := range s.Result() {
		for _, th := range r.Themes {
			if th == "fork" && r.Rating/50 == 30 {
				perFork++
			}
		}
	}
	if perFork != 2 {
		t.Errorf("fork band 30 should hold at most 2 puzzles, got %d", perFork)
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

func TestResultLimitedSpreadsAcrossSlots(t *testing.T) {
	s := NewSampler(SampleOptions{PerBand: 5, BandWidth: 100, MinRating: 400, MaxRating: 3500, MinPopularity: 0, MinPlays: 0, Seed: 1})
	id := 0
	add := func(theme string, rating, n int) {
		for i := 0; i < n; i++ {
			id++
			s.Add(Row{ID: fmt.Sprintf("p%d", id), Rating: rating, Themes: []string{theme}})
		}
	}
	add("fork", 1500, 50)
	add("pin", 1500, 50)
	add("skewer", 2500, 50)
	got := s.ResultLimited(3)
	themes := map[string]bool{}
	for _, r := range got {
		themes[r.Themes[0]] = true
	}
	if len(got) != 3 || len(themes) != 3 {
		t.Fatalf("3 slots, target 3: want one puzzle from each theme, got %v", got)
	}
	if n := len(s.ResultLimited(0)); n != 15 {
		t.Fatalf("no target keeps every sampled puzzle: got %d, want 15", n)
	}
}
