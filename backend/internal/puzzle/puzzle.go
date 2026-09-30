package puzzle

import (
	"encoding/csv"
	"fmt"
	"hash/fnv"
	"io"
	"math"
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

type Puzzle struct {
	ID     string   `json:"id"`
	FEN    string   `json:"fen"`
	Moves  string   `json:"moves"`
	Rating int      `json:"rating"`
	Themes []string `json:"themes"`
}

const KeyScale = 1_000_000

func RatingKey(rating int, salt int64) int64 {
	return int64(rating)*KeyScale + salt%KeyScale
}

func KeyRating(key int64) int { return int(key / KeyScale) }

func Salt(id string) int64 {
	h := fnv.New64a()
	h.Write([]byte(id))
	return int64(h.Sum64() % KeyScale)
}

func (r Row) SelectableThemes() []string {
	out := make([]string, 0, len(r.Themes))
	for _, t := range r.Themes {
		if themeSet[t] {
			out = append(out, t)
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
