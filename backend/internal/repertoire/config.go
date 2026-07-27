package repertoire

import (
	"encoding/json"
	"os"
)

// ExclusionRule marks one move as recorded-but-not-part-of-the-repertoire.
// Path is the SAN sequence from the named chapter's root to the move being
// excluded — unambiguous even when the same SAN recurs at different points
// in the tree.
type ExclusionRule struct {
	Chapter string   `json:"chapter"`
	Path    []string `json:"path"`
	Reason  string   `json:"reason"`
}

// Config is the sidecar <repertoire>.config.json read alongside a PGN file.
type Config struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Side        string          `json:"side"` // "w" or "b"
	Source      string          `json:"source"`
	Description string          `json:"description"`
	Excluded    []ExclusionRule `json:"excluded"`
}

// LoadConfig reads and parses a sidecar config file.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
