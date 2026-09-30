package lichess

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var puzzleClient = &http.Client{Timeout: 2 * time.Minute}

type PuzzleActivity struct {
	PlayedAt time.Time
	PuzzleID string
	Rating   int
	Themes   []string
	Win      bool
}

type RatingPoint struct {
	Day    time.Time
	Rating int
}

func FetchPuzzleActivity(ctx context.Context, token string, since time.Time, max int) ([]PuzzleActivity, error) {
	q := url.Values{}
	q.Set("max", fmt.Sprint(max))
	q.Set("since", fmt.Sprint(since.UnixMilli()))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://lichess.org/api/puzzle/activity?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/x-ndjson")
	req.Header.Set("User-Agent", "chesslab/1.0 github.com/chesslab")
	resp, err := puzzleClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("lichess puzzle activity: status %d (token needs the puzzle:read scope)", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lichess puzzle activity: status %d", resp.StatusCode)
	}

	var out []PuzzleActivity
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var row struct {
			Date   int64 `json:"date"`
			Win    bool  `json:"win"`
			Puzzle struct {
				ID     string   `json:"id"`
				Rating int      `json:"rating"`
				Themes []string `json:"themes"`
			} `json:"puzzle"`
		}
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			return nil, fmt.Errorf("decode puzzle activity: %w", err)
		}
		out = append(out, PuzzleActivity{
			PlayedAt: time.UnixMilli(row.Date).UTC(),
			PuzzleID: row.Puzzle.ID,
			Rating:   row.Puzzle.Rating,
			Themes:   row.Puzzle.Themes,
			Win:      row.Win,
		})
	}
	return out, sc.Err()
}

func FetchPuzzleRatingHistory(ctx context.Context, lichessUsername string) ([]RatingPoint, error) {
	u := fmt.Sprintf("https://lichess.org/api/user/%s/rating-history", url.PathEscape(lichessUsername))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "chesslab/1.0 github.com/chesslab")
	resp, err := puzzleClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lichess rating history: status %d", resp.StatusCode)
	}
	var series []struct {
		Name   string  `json:"name"`
		Points [][]int `json:"points"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&series); err != nil {
		return nil, fmt.Errorf("decode rating history: %w", err)
	}
	var out []RatingPoint
	for _, s := range series {
		if s.Name != "Puzzles" {
			continue
		}
		for _, p := range s.Points {
			if len(p) != 4 {
				continue
			}
			out = append(out, RatingPoint{Day: time.Date(p[0], time.Month(p[1]+1), p[2], 0, 0, 0, 0, time.UTC), Rating: p[3]})
		}
	}
	return out, nil
}
