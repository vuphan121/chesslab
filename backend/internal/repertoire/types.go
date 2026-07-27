// Package repertoire parses a Lichess study PGN (one chapter per game, each
// rooted at its own [FEN]/[SetUp] start position, variations preserved) into
// a tree per chapter, then derives the drillable Cards and opponent Reply
// pools used by the opening trainer. See docs/opening-trainer/data-format.md.
package repertoire

import "github.com/chesslab/backend/internal/chess"

// Node is one position in a chapter's move tree. The root has an empty SAN
// and represents the chapter's start FEN (not necessarily the initial
// position); every other node holds the move that reached it.
type Node struct {
	SAN             string
	UCI             string
	FEN             string
	Ply             int
	Comment         string
	NAGs            []int
	Excluded        bool // this move itself is marked out of the repertoire
	ExcludedReason  string
	ExcludedSubtree bool // this move or an ancestor is excluded — no cards
	// are generated at or below this node
	Pos      *chess.Position `json:"-"`
	Parent   *Node           `json:"-"`
	Children []*Node
}

// Chapter is one game inside the study.
type Chapter struct {
	ID       string
	Name     string
	URL      string
	StartFEN string
	Root     *Node
}

// Answer is one accepted continuation recorded for a Card.
type Answer struct {
	SAN        string
	UCI        string
	FEN        string
	Primary    bool
	Comment    string
	ChapterIDs []string
}

// ExcludedAnswer is a recorded but out-of-repertoire continuation — shown to
// the user if they play it, but never accepted as correct.
type ExcludedAnswer struct {
	SAN    string
	UCI    string
	Reason string
}

// Card is one drillable position: the trainer's side to move, with at least
// one non-excluded recorded answer. Keyed by CardKey(FEN) so the same
// position reached via different chapters or move orders is one card.
type Card struct {
	ID              string // CardKey(FEN) — clock-stripped FEN
	FEN             string
	Side            chess.Color
	Ply             int
	ChapterIDs      []string
	PathSAN         []string // SAN path from the first contributing chapter's root
	Answers         []Answer
	ExcludedAnswers []ExcludedAnswer
}

// Reply is one recorded opponent continuation from a position where the
// non-trainer side is to move.
type Reply struct {
	SAN        string
	UCI        string
	FEN        string
	ChapterIDs []string
}

// Repertoire is one parsed study plus its derived cards and reply pools.
type Repertoire struct {
	ID          string
	Name        string
	Side        chess.Color
	Source      string
	Description string
	Chapters    []*Chapter
	Cards       []*Card
	Replies     map[string][]Reply // keyed by CardKey(fen) of the opponent-to-move position
}
