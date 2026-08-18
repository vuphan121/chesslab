package book

type Item struct {
	ID         string   `json:"id"`
	ChapterID  string   `json:"chapterId"`
	Type       string   `json:"type"`
	FEN        string   `json:"fen"`
	SideToMove string   `json:"sideToMove"`
	Prompt     string   `json:"prompt"`
	Solution   []string `json:"solution,omitempty"`

	SolutionUCI []string `json:"solutionUci,omitempty"`
	Note        string   `json:"note,omitempty"`

	SourcePage    int `json:"sourcePage,omitempty"`
	BookPage      int `json:"bookPage,omitempty"`
	MasterPDFPage int `json:"masterPDFPage,omitempty"`
}

type Chapter struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
	Name   string `json:"name"`
	Items  []Item `json:"items"`
}

type Book struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Author   string    `json:"author"`
	Chapters []Chapter `json:"chapters"`
}
