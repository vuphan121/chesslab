package repertoire

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var lichessStudyID = regexp.MustCompile(`^[A-Za-z0-9]{8}$`)

func ParseAndBuild(pgn string, cfg *Config) (*Repertoire, error) {
	chapters, err := ParsePGN(pgn)
	if err != nil {
		return nil, err
	}
	return BuildRepertoire(chapters, cfg)
}

func FetchStudyPGN(ctx context.Context, sourceURL, token string) (string, string, error) {
	studyID, err := StudyID(sourceURL)
	if err != nil {
		return "", "", err
	}
	canonical := "https://lichess.org/study/" + studyID
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://lichess.org/api/study/"+studyID+".pgn", nil)
	if err != nil {
		return "", "", fmt.Errorf("build study request: %w", err)
	}
	req.Header.Set("Accept", "application/x-chess-pgn")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("fetch study: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", "", fmt.Errorf("fetch study: lichess returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return "", "", fmt.Errorf("read study: %w", err)
	}
	if len(data) == 10<<20 {
		return "", "", fmt.Errorf("study export exceeds 10 MB")
	}
	return string(data), canonical, nil
}

func StudyID(sourceURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil || u.Hostname() != "lichess.org" {
		return "", fmt.Errorf("enter a lichess.org study URL")
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || parts[0] != "study" || !lichessStudyID.MatchString(parts[1]) {
		return "", fmt.Errorf("enter a valid Lichess study URL")
	}
	return parts[1], nil
}
