package api

import (
	"net/http"

	"github.com/chesslab/backend/internal/repertoire"
	"github.com/go-chi/chi/v5"
)

type RepertoireChapterSummaryJSON struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CardCount int    `json:"cardCount"`
}

type RepertoireSummaryJSON struct {
	ID          string                         `json:"id"`
	Name        string                         `json:"name"`
	Side        string                         `json:"side"`
	Source      string                         `json:"source"`
	Description string                         `json:"description"`
	Chapters    []RepertoireChapterSummaryJSON `json:"chapters"`
	CardCount   int                            `json:"cardCount"`
}

type RepNodeJSON struct {
	SAN             string        `json:"san"`
	UCI             string        `json:"uci"`
	FEN             string        `json:"fen"`
	Ply             int           `json:"ply"`
	Comment         string        `json:"comment,omitempty"`
	NAGs            []int         `json:"nags,omitempty"`
	Excluded        bool          `json:"excluded"`
	ExcludedReason  string        `json:"excludedReason,omitempty"`
	ExcludedSubtree bool          `json:"excludedSubtree"`
	Children        []RepNodeJSON `json:"children"`
}

type RepChapterJSON struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	URL      string      `json:"url"`
	StartFEN string      `json:"startFen"`
	Tree     RepNodeJSON `json:"tree"`
}

type RepAnswerJSON struct {
	SAN        string   `json:"san"`
	UCI        string   `json:"uci"`
	FEN        string   `json:"fen"`
	Primary    bool     `json:"primary"`
	Comment    string   `json:"comment,omitempty"`
	ChapterIDs []string `json:"chapterIds"`
}

type RepExcludedAnswerJSON struct {
	SAN    string `json:"san"`
	UCI    string `json:"uci"`
	Reason string `json:"reason,omitempty"`
}

type RepCardJSON struct {
	ID              string                  `json:"id"`
	FEN             string                  `json:"fen"`
	Side            string                  `json:"side"`
	Ply             int                     `json:"ply"`
	ChapterIDs      []string                `json:"chapterIds"`
	PathSAN         []string                `json:"pathSan"`
	Answers         []RepAnswerJSON         `json:"answers"`
	ExcludedAnswers []RepExcludedAnswerJSON `json:"excludedAnswers,omitempty"`
}

type RepReplyJSON struct {
	SAN        string   `json:"san"`
	UCI        string   `json:"uci"`
	FEN        string   `json:"fen"`
	ChapterIDs []string `json:"chapterIds"`
}

type RepertoireJSON struct {
	ID          string                    `json:"id"`
	Name        string                    `json:"name"`
	Side        string                    `json:"side"`
	Source      string                    `json:"source"`
	Description string                    `json:"description"`
	Chapters    []RepChapterJSON          `json:"chapters"`
	Cards       []RepCardJSON             `json:"cards"`
	Replies     map[string][]RepReplyJSON `json:"replies"`
}

func (h *Handler) ListRepertoires(w http.ResponseWriter, r *http.Request) {
	reps := h.repertoires.List()
	out := make([]RepertoireSummaryJSON, 0, len(reps))
	for _, rep := range reps {
		out = append(out, toRepertoireSummary(rep))
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *Handler) GetRepertoire(w http.ResponseWriter, r *http.Request) {
	rep, ok := h.repertoires.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "repertoire not found", http.StatusNotFound)
		return
	}
	respondJSON(w, http.StatusOK, toRepertoireJSON(rep))
}

func toRepertoireSummary(rep *repertoire.Repertoire) RepertoireSummaryJSON {
	chapters := make([]RepertoireChapterSummaryJSON, 0, len(rep.Chapters))
	for _, ch := range rep.Chapters {
		count := 0
		for _, c := range rep.Cards {
			if containsID(c.ChapterIDs, ch.ID) {
				count++
			}
		}
		chapters = append(chapters, RepertoireChapterSummaryJSON{ID: ch.ID, Name: ch.Name, CardCount: count})
	}
	return RepertoireSummaryJSON{
		ID:          rep.ID,
		Name:        rep.Name,
		Side:        rep.Side.String(),
		Source:      rep.Source,
		Description: rep.Description,
		Chapters:    chapters,
		CardCount:   len(rep.Cards),
	}
}

func toRepertoireJSON(rep *repertoire.Repertoire) RepertoireJSON {
	chapters := make([]RepChapterJSON, 0, len(rep.Chapters))
	for _, ch := range rep.Chapters {
		chapters = append(chapters, RepChapterJSON{
			ID: ch.ID, Name: ch.Name, URL: ch.URL, StartFEN: ch.StartFEN,
			Tree: toRepNodeJSON(ch.Root),
		})
	}

	cards := make([]RepCardJSON, 0, len(rep.Cards))
	for _, c := range rep.Cards {
		answers := make([]RepAnswerJSON, 0, len(c.Answers))
		for _, a := range c.Answers {
			answers = append(answers, RepAnswerJSON{
				SAN: a.SAN, UCI: a.UCI, FEN: a.FEN, Primary: a.Primary,
				Comment: a.Comment, ChapterIDs: a.ChapterIDs,
			})
		}
		excluded := make([]RepExcludedAnswerJSON, 0, len(c.ExcludedAnswers))
		for _, e := range c.ExcludedAnswers {
			excluded = append(excluded, RepExcludedAnswerJSON{SAN: e.SAN, UCI: e.UCI, Reason: e.Reason})
		}
		cards = append(cards, RepCardJSON{
			ID: c.ID, FEN: c.FEN, Side: c.Side.String(), Ply: c.Ply,
			ChapterIDs: c.ChapterIDs, PathSAN: c.PathSAN,
			Answers: answers, ExcludedAnswers: excluded,
		})
	}

	replies := make(map[string][]RepReplyJSON, len(rep.Replies))
	for key, list := range rep.Replies {
		out := make([]RepReplyJSON, 0, len(list))
		for _, r := range list {
			out = append(out, RepReplyJSON{SAN: r.SAN, UCI: r.UCI, FEN: r.FEN, ChapterIDs: r.ChapterIDs})
		}
		replies[key] = out
	}

	return RepertoireJSON{
		ID: rep.ID, Name: rep.Name, Side: rep.Side.String(),
		Source: rep.Source, Description: rep.Description,
		Chapters: chapters, Cards: cards, Replies: replies,
	}
}

func toRepNodeJSON(n *repertoire.Node) RepNodeJSON {
	var children []RepNodeJSON
	if len(n.Children) > 0 {
		children = make([]RepNodeJSON, 0, len(n.Children))
		for _, c := range n.Children {
			children = append(children, toRepNodeJSON(c))
		}
	}
	return RepNodeJSON{
		SAN: n.SAN, UCI: n.UCI, FEN: n.FEN, Ply: n.Ply,
		Comment: n.Comment, NAGs: n.NAGs,
		Excluded: n.Excluded, ExcludedReason: n.ExcludedReason, ExcludedSubtree: n.ExcludedSubtree,
		Children: children,
	}
}

func containsID(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}
