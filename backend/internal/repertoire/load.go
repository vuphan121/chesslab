package repertoire

import (
	"log"
	"os"
	"path/filepath"
	"strings"
)

// LoadDir globs every *.pgn in dir, pairs it with a same-basename
// .config.json sidecar if present, and returns whatever parsed. A single
// repertoire's parse failure is logged and skipped, not fatal — same policy
// as the coach's optional corpora.
func LoadDir(dir string) []*Repertoire {
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("repertoire: data dir %q unavailable (%v) — no repertoires loaded", dir, err)
		return nil
	}

	var reps []*Repertoire
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".pgn") {
			continue
		}
		base := strings.TrimSuffix(e.Name(), ".pgn")
		pgnPath := filepath.Join(dir, e.Name())
		cfgPath := filepath.Join(dir, base+".config.json")

		rep, err := loadOne(pgnPath, cfgPath, base)
		if err != nil {
			log.Printf("repertoire: skipping %s: %v", e.Name(), err)
			continue
		}
		reps = append(reps, rep)
		log.Printf("repertoire: loaded %q (%s, %d cards)", rep.ID, rep.Name, len(rep.Cards))
	}
	return reps
}

func loadOne(pgnPath, cfgPath, fallbackID string) (*Repertoire, error) {
	data, err := os.ReadFile(pgnPath)
	if err != nil {
		return nil, err
	}
	chapters, err := ParsePGN(string(data))
	if err != nil {
		return nil, err
	}

	var cfg *Config
	if _, err := os.Stat(cfgPath); err == nil {
		cfg, err = LoadConfig(cfgPath)
		if err != nil {
			return nil, err
		}
	}

	rep, err := BuildRepertoire(chapters, cfg)
	if err != nil {
		return nil, err
	}
	if rep.ID == "" {
		rep.ID = fallbackID
	}
	if rep.Name == "" {
		rep.Name = fallbackID
	}
	return rep, nil
}
