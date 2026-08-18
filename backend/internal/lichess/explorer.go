package lichess

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
)

type ExplorerOpening struct {
	ECO  string `json:"eco"`
	Name string `json:"name"`
}

type ExplorerMove struct {
	UCI     string           `json:"uci"`
	SAN     string           `json:"san"`
	White   int              `json:"white"`
	Draws   int              `json:"draws"`
	Black   int              `json:"black"`
	Opening *ExplorerOpening `json:"opening"`
}

type ExplorerResponse struct {
	White   int              `json:"white"`
	Draws   int              `json:"draws"`
	Black   int              `json:"black"`
	Moves   []ExplorerMove   `json:"moves"`
	Opening *ExplorerOpening `json:"opening"`
}

func FetchExplorer(fen string) (*ExplorerResponse, error) {
	token := os.Getenv("LICHESS_TOKEN")
	if token == "" {
		return nil, fmt.Errorf("lichess explorer: LICHESS_TOKEN not configured")
	}

	u := fmt.Sprintf("https://explorer.lichess.ovh/lichess?fen=%s&moves=12&topGames=0&recentGames=0&ratings=2000,2200,2500,2900&speeds=blitz,rapid,classical",
		url.QueryEscape(fen))

	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "chesslab/1.0 github.com/chesslab")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lichess explorer: status %d", resp.StatusCode)
	}

	var result ExplorerResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}
