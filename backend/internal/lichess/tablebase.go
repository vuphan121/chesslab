package lichess

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const MaxTablebasePieces = 7

type TablebaseMove struct {
	UCI      string `json:"uci"`
	SAN      string `json:"san"`
	Category string `json:"category"`
	Zeroing  bool   `json:"zeroing"`
	DTZ      *int   `json:"dtz"`
	DTM      *int   `json:"dtm"`
}

type TablebaseResult struct {
	Category  string          `json:"category"`
	Checkmate bool            `json:"checkmate"`
	Stalemate bool            `json:"stalemate"`
	DTZ       *int            `json:"dtz"`
	DTM       *int            `json:"dtm"`
	Moves     []TablebaseMove `json:"moves"`
}

func FetchTablebase(fen string) (*TablebaseResult, error) {
	return FetchTablebaseWithTimeout(fen, httpClient.Timeout)
}

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
