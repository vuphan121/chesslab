package puzzle

import (
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
)

const (
	StartRating   = 2000.0
	newPlayerK    = 32.0
	settledK      = 24.0
	settledAfter  = 30
	MinMixedCount = 20
)

type Category struct {
	Key     string
	Themes  []string
	InMixed bool
}

var categories = []Category{
	{"phases", []string{"opening", "middlegame", "endgame", "rookEndgame", "bishopEndgame", "pawnEndgame", "knightEndgame", "queenEndgame", "queenRookEndgame"}, true},
	{"motifs", []string{"advancedPawn", "attackingF2F7", "capturingDefender", "discoveredAttack", "doubleCheck", "exposedKing", "fork", "hangingPiece", "kingsideAttack", "pin", "queensideAttack", "sacrifice", "skewer", "trappedPiece"}, true},
	{"advanced", []string{"attraction", "clearance", "collinearMove", "discoveredCheck", "defensiveMove", "deflection", "interference", "intermezzo", "quietMove", "xRayAttack", "zugzwang"}, true},
	{"mates", []string{"mate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5"}, true},
	{"mateThemes", []string{"anastasiaMate", "arabianMate", "backRankMate", "balestraMate", "blindSwineMate", "bodenMate", "cornerMate", "doubleBishopMate", "dovetailMate", "epauletteMate", "hookMate", "killBoxMate", "pillsburysMate", "morphysMate", "operaMate", "swallowstailMate", "triangleMate", "vukovicMate", "smotheredMate"}, true},
	{"specialMoves", []string{"castling", "enPassant", "promotion", "underPromotion"}, true},
	{"goals", []string{"equality", "advantage", "crushing"}, false},
	{"lengths", []string{"oneMove", "short", "long", "veryLong"}, false},
}

var themeKeys, themeCategory, themeInMixed = func() ([]string, map[string]string, map[string]bool) {
	var keys []string
	cat := map[string]string{}
	mixed := map[string]bool{}
	for _, c := range categories {
		for _, t := range c.Themes {
			keys = append(keys, t)
			cat[t] = c.Key
			mixed[t] = c.InMixed
		}
	}
	return keys, cat, mixed
}()

var themeSet = func() map[string]bool {
	m := make(map[string]bool, len(themeKeys))
	for _, k := range themeKeys {
		m[k] = true
	}
	return m
}()

func Categories() []Category { return append([]Category(nil), categories...) }

func CategoryOf(key string) string { return themeCategory[key] }

func InMixed(key string) bool { return themeInMixed[key] }

func ThemeKeys() []string { return append([]string(nil), themeKeys...) }

func IsTheme(key string) bool { return themeSet[key] }

func Expected(rating, puzzleRating float64) float64 {
	return 1 / (1 + math.Pow(10, (puzzleRating-rating)/400))
}

func NextRating(rating, puzzleRating float64, solved bool, attempts int) float64 {
	k := newPlayerK
	if attempts >= settledAfter {
		k = settledK
	}
	score := 0.0
	if solved {
		score = 1
	}
	return rating + k*(score-Expected(rating, puzzleRating))
}

type Row struct {
	ID         string
	FEN        string
	Moves      string
	Rating     int
	Popularity int
	NbPlays    int
	Themes     []string
}

func ParseRow(rec []string) (Row, error) {
	if len(rec) < 8 {
		return Row{}, fmt.Errorf("expected at least 8 fields, got %d", len(rec))
	}
	rating, err := strconv.Atoi(rec[3])
	if err != nil {
		return Row{}, fmt.Errorf("rating %q: %w", rec[3], err)
	}
	pop, err := strconv.Atoi(rec[5])
	if err != nil {
		return Row{}, fmt.Errorf("popularity %q: %w", rec[5], err)
	}
	plays, err := strconv.Atoi(rec[6])
	if err != nil {
		return Row{}, fmt.Errorf("plays %q: %w", rec[6], err)
	}
	return Row{ID: rec[0], FEN: rec[1], Moves: rec[2], Rating: rating, Popularity: pop, NbPlays: plays, Themes: strings.Fields(rec[7])}, nil
}

type SampleOptions struct {
	PerBand       int
	BandWidth     int
	MinRating     int
	MaxRating     int
	MinPopularity int
	MinPlays      int
	Seed          int64
}

type Sampler struct {
	opt    SampleOptions
	rnd    *rand.Rand
	slots  map[string][]*Row
	counts map[string]int
	Seen   int
}

func NewSampler(opt SampleOptions) *Sampler {
	return &Sampler{opt: opt, rnd: rand.New(rand.NewSource(opt.Seed)), slots: map[string][]*Row{}, counts: map[string]int{}}
}

func (s *Sampler) Add(r Row) {
	s.Seen++
	if r.Rating < s.opt.MinRating || r.Rating > s.opt.MaxRating || r.Popularity < s.opt.MinPopularity || r.NbPlays < s.opt.MinPlays {
		return
	}
	var row *Row
	band := r.Rating / s.opt.BandWidth
	for _, t := range r.Themes {
		if !themeSet[t] {
			continue
		}
		key := t + "|" + strconv.Itoa(band)
		s.counts[key]++
		if row == nil {
			cp := r
			row = &cp
		}
		slot := s.slots[key]
		if len(slot) < s.opt.PerBand {
			s.slots[key] = append(slot, row)
			continue
		}
		if j := s.rnd.Intn(s.counts[key]); j < s.opt.PerBand {
			slot[j] = row
		}
	}
}

func (s *Sampler) Result() []Row { return s.ResultLimited(0) }

func (s *Sampler) ResultLimited(target int) []Row {
	keys := make([]string, 0, len(s.slots))
	deepest := 0
	for k, slot := range s.slots {
		keys = append(keys, k)
		deepest = max(deepest, len(slot))
	}
	sort.Strings(keys)
	seen := map[string]bool{}
	var out []Row
	for round := 0; round < deepest; round++ {
		for _, k := range keys {
			slot := s.slots[k]
			if round >= len(slot) || seen[slot[round].ID] {
				continue
			}
			if target > 0 && len(out) >= target {
				return out
			}
			seen[slot[round].ID] = true
			out = append(out, *slot[round])
		}
	}
	return out
}

func ReadCSV(r io.Reader, each func(Row)) (bad int, err error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.ReuseRecord = true
	first := true
	for {
		rec, rerr := cr.Read()
		if rerr == io.EOF {
			return bad, nil
		}
		if rerr != nil {
			return bad, rerr
		}
		if first {
			first = false
			if len(rec) > 0 && rec[0] == "PuzzleId" {
				continue
			}
		}
		row, perr := ParseRow(rec)
		if perr != nil {
			bad++
			continue
		}
		each(row)
	}
}
