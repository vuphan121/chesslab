package woodpecker

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed book1.json
var book1JSON []byte

type Alternative struct {
	At  int      `json:"at"`
	UCI []string `json:"uci"`
}

type Puzzle struct {
	Number       int           `json:"n"`
	FEN          string        `json:"fen"`
	SolutionUCI  []string      `json:"solutionUci"`
	SolutionSAN  []string      `json:"solutionSan"`
	Source       string        `json:"source"`
	SolutionFrom string        `json:"solutionSource,omitempty"`
	Alternatives []Alternative `json:"alternatives,omitempty"`
}

var puzzles = mustLoad()

func mustLoad() []Puzzle {
	var list []Puzzle
	if err := json.Unmarshal(book1JSON, &list); err != nil {
		panic(fmt.Sprintf("woodpecker: bad book1.json: %v", err))
	}
	for i := range list {
		list[i].FEN = assumeCastling(list[i].FEN)
	}
	for i, p := range list {
		if p.Number != i+1 || len(p.SolutionUCI) == 0 {
			panic(fmt.Sprintf("woodpecker: puzzle %d is out of order or has no solution", i+1))
		}
	}
	return list
}

func Total() int { return len(puzzles) }

func Get(number int) (Puzzle, bool) {
	if number < 1 || number > len(puzzles) {
		return Puzzle{}, false
	}
	return puzzles[number-1], true
}

func assumeCastling(fen string) string {
	parts := strings.Fields(fen)
	if len(parts) < 4 {
		return fen
	}
	rows := strings.Split(parts[0], "/")
	if len(rows) != 8 {
		return fen
	}
	expand := func(row string) string {
		var b strings.Builder
		for _, c := range row {
			if c >= '1' && c <= '8' {
				b.WriteString(strings.Repeat(".", int(c-'0')))
			} else {
				b.WriteRune(c)
			}
		}
		return b.String()
	}
	black, white := expand(rows[0]), expand(rows[7])
	if len(black) != 8 || len(white) != 8 {
		return fen
	}
	rights := ""
	if white[4] == 'K' {
		if white[7] == 'R' {
			rights += "K"
		}
		if white[0] == 'R' {
			rights += "Q"
		}
	}
	if black[4] == 'k' {
		if black[7] == 'r' {
			rights += "k"
		}
		if black[0] == 'r' {
			rights += "q"
		}
	}
	if rights == "" {
		rights = "-"
	}
	parts[2] = rights
	return strings.Join(parts, " ")
}
