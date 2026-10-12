package woodpecker

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed book1.json
var book1JSON []byte

type Puzzle struct {
	Number       int      `json:"n"`
	FEN          string   `json:"fen"`
	SolutionUCI  []string `json:"solutionUci"`
	SolutionSAN  []string `json:"solutionSan"`
	Source       string   `json:"source"`
	SolutionFrom string   `json:"solutionSource,omitempty"`
}

var puzzles = mustLoad()

func mustLoad() []Puzzle {
	var list []Puzzle
	if err := json.Unmarshal(book1JSON, &list); err != nil {
		panic(fmt.Sprintf("woodpecker: bad book1.json: %v", err))
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
