package repertoire

import (
	"encoding/json"
	"os"
)

type ExclusionRule struct {
	Chapter string   `json:"chapter"`
	Path    []string `json:"path"`
	Reason  string   `json:"reason"`
}

type Config struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Side        string          `json:"side"`
	Source      string          `json:"source"`
	Description string          `json:"description"`
	Excluded    []ExclusionRule `json:"excluded"`
}

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
