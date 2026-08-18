package repertoire

import "github.com/chesslab/backend/internal/chess"

type Node struct {
	SAN             string
	UCI             string
	FEN             string
	Ply             int
	Comment         string
	NAGs            []int
	Excluded        bool
	ExcludedReason  string
	ExcludedSubtree bool

	Pos      *chess.Position `json:"-"`
	Parent   *Node           `json:"-"`
	Children []*Node
}

type Chapter struct {
	ID       string
	Name     string
	URL      string
	StartFEN string
	Root     *Node
}

type Answer struct {
	SAN        string
	UCI        string
	FEN        string
	Primary    bool
	Comment    string
	ChapterIDs []string
}

type ExcludedAnswer struct {
	SAN    string
	UCI    string
	Reason string
}

type Card struct {
	ID              string
	FEN             string
	Side            chess.Color
	Ply             int
	ChapterIDs      []string
	PathSAN         []string
	Answers         []Answer
	ExcludedAnswers []ExcludedAnswer
}

type Reply struct {
	SAN        string
	UCI        string
	FEN        string
	ChapterIDs []string
}

type Repertoire struct {
	ID          string
	Name        string
	Side        chess.Color
	Source      string
	Description string
	Config      *Config
	Chapters    []*Chapter
	Cards       []*Card
	Replies     map[string][]Reply
}
