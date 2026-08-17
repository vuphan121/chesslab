// Package book loads pre-extracted chess-book study material ("Study from
// Book") into chapters of lesson positions and puzzles, served read-only over
// the API. Unlike internal/repertoire, there's no PGN to parse at boot — the
// extraction (rendering book pages, reading diagrams, writing prompts) is a
// one-off offline step; this package only loads and validates the finished
// JSON. See docs/study-from-book/data-format.md.
package book

// Item is one drillable position: either an instructional "lesson" (freely
// explorable, no right/wrong) or a "puzzle" (has a Solution to find).
type Item struct {
	ID         string   `json:"id"`
	ChapterID  string   `json:"chapterId"`
	Type       string   `json:"type"` // "lesson" | "puzzle"
	FEN        string   `json:"fen"`
	SideToMove string   `json:"sideToMove"` // "w" | "b" — must match FEN's own side to move
	Prompt     string   `json:"prompt"`     // shown before the answer, e.g. "White to move — find the tactic"
	Solution   []string `json:"solution,omitempty"`
	// SolutionUCI is derived at load time (validateBook), not read from the
	// source JSON — one UCI move per Solution ply, resolved by replaying
	// Solution's SAN through the engine. The frontend needs UCI (from/to
	// squares) to auto-play a solution move via the same makeMove endpoint
	// normal play uses; SAN alone isn't enough for that.
	SolutionUCI []string `json:"solutionUci,omitempty"`
	Note        string   `json:"note,omitempty"`
	// SourcePage is the 1-based PDF page containing this position. It is
	// optional because a book can still be used without its local source PDF.
	SourcePage int `json:"sourcePage,omitempty"`
}

// Chapter is one numbered chapter of the book.
type Chapter struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
	Name   string `json:"name"`
	Items  []Item `json:"items"`
}

// Book is one parsed book plus its chapters.
type Book struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Author   string    `json:"author"`
	Chapters []Chapter `json:"chapters"`
}
