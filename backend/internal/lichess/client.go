package lichess

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

var httpClient = &http.Client{Timeout: 3 * time.Second}

type PV struct {
	Moves string `json:"moves"` // space-separated UCI moves
	// CP/Mate are White-relative (positive = White better / White mates),
	// regardless of whose turn it is — NOT side-to-move relative. Verified
	// against the live API. Callers that want side-to-move must negate on Black.
	CP   *int `json:"cp"`   // centipawns, White's perspective
	Mate *int `json:"mate"` // mate in N (positive = White mates)
}

type CloudEval struct {
	Depth int  `json:"depth"`
	PVs   []PV `json:"pvs"`
}

// Fetch returns precomputed Stockfish analysis from Lichess for the given FEN.
// Returns nil, nil when the position is not cached (404) or on transient errors.
func Fetch(fen string, multiPV int) (*CloudEval, error) {
	u := fmt.Sprintf("https://lichess.org/api/cloud-eval?fen=%s&multiPv=%d",
		url.QueryEscape(fen), multiPV)

	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "chesslab/1.0 github.com/chesslab")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lichess: status %d", resp.StatusCode)
	}

	var result CloudEval
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}
