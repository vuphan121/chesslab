package lichess

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// MaxTablebasePieces is the largest total piece count (both sides, including
// kings) Lichess's public Syzygy tablebase server has full coverage for.
const MaxTablebasePieces = 7

// TablebaseMove is one legal reply, with category/DTZ/DTM describing the
// resulting position from the perspective of whoever is to move after it
// (i.e. the opponent of whoever plays this move) — verified against the live
// API: e.g. in a King+Pawn win, the winning king move returns category
// "loss" (bad for the side who'd be moving next), not "win".
type TablebaseMove struct {
	UCI      string `json:"uci"`
	SAN      string `json:"san"`
	Category string `json:"category"`
	Zeroing  bool   `json:"zeroing"`
	DTZ      *int   `json:"dtz"`
	DTM      *int   `json:"dtm"`
}

// TablebaseResult is a Syzygy lookup for one position — exact (not a search
// estimate) whenever the position is covered. Category/DTZ/DTM are relative
// to whoever is to move in the queried position: positive DTZ/DTM and
// category "win" mean the side to move is winning. DTM (plies to mate) is
// only populated up to 6-man positions on Lichess's server — verified live:
// a 7-man position returns "dtm": null even when "category": "win".
type TablebaseResult struct {
	Category  string          `json:"category"`
	Checkmate bool            `json:"checkmate"`
	Stalemate bool            `json:"stalemate"`
	DTZ       *int            `json:"dtz"`
	DTM       *int            `json:"dtm"`
	Moves     []TablebaseMove `json:"moves"`
}

// FetchTablebase queries Lichess's public Syzygy tablebase API (no auth
// required, unlike the opening explorer) with the package's default timeout.
// Returns (nil, nil) for a position the server has no data for (e.g. too
// many pieces), mirroring Fetch's not-found handling.
func FetchTablebase(fen string) (*TablebaseResult, error) {
	return FetchTablebaseWithTimeout(fen, httpClient.Timeout)
}

// FetchTablebaseWithTimeout is FetchTablebase with an explicit timeout, so a
// caller on a tight latency budget (the "quick" analysis pass — see
// analyzePosition) doesn't have this lookup silently borrow the package's
// full default timeout instead of its own, defeating the point of "quick".
func FetchTablebaseWithTimeout(fen string, timeout time.Duration) (*TablebaseResult, error) {
	u := fmt.Sprintf("https://tablebase.lichess.ovh/standard?fen=%s", url.QueryEscape(fen))

	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "chesslab/1.0 github.com/chesslab")

	client := httpClient
	if timeout != httpClient.Timeout {
		client = &http.Client{Timeout: timeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lichess tablebase: status %d", resp.StatusCode)
	}

	var result TablebaseResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if result.Category == "" {
		return nil, nil
	}
	return &result, nil
}
