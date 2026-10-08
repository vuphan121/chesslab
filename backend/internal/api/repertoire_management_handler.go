package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/evalprecompute"
	"github.com/chesslab/backend/internal/repertoire"
	"github.com/go-chi/chi/v5"
)

type ImportRepertoireRequest struct {
	SourceURL   string `json:"sourceUrl"`
	Name        string `json:"name"`
	Side        string `json:"side"`
	Description string `json:"description"`
}

func (h *Handler) ImportRepertoire(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "repertoire management requires database sync", http.StatusServiceUnavailable)
		return
	}
	var req ImportRepertoireRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	studyID, err := repertoire.StudyID(req.SourceURL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	id := "study-" + strings.ToLower(studyID)
	if _, exists := h.repertoires.Get(id); exists {
		http.Error(w, "this study is already in your repertoire list", http.StatusConflict)
		return
	}
	cfg, err := managementConfig(id, req.Name, req.Side, req.Description, "https://lichess.org/study/"+studyID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	rep, err := h.fetchAndSaveRepertoire(r, cfg)
	if err != nil {
		http.Error(w, "could not import repertoire: "+err.Error(), http.StatusBadRequest)
		return
	}
	respondJSON(w, http.StatusCreated, toRepertoireSummary(rep))
}

func (h *Handler) RefreshRepertoire(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "repertoire management requires database sync", http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "id")
	cfg, ok, err := h.managedConfig(r, id)
	if err != nil {
		http.Error(w, "could not refresh repertoire: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "this repertoire cannot be refreshed because it has no saved Lichess study source", http.StatusBadRequest)
		return
	}
	rep, err := h.fetchAndSaveRepertoire(r, cfg)
	if err != nil {
		http.Error(w, "could not refresh repertoire: "+err.Error(), http.StatusBadRequest)
		return
	}
	respondJSON(w, http.StatusOK, toRepertoireSummary(rep))
}

func (h *Handler) managedConfig(r *http.Request, id string) (repertoire.Config, bool, error) {
	source, found, err := h.db.GetRepertoireSource(r.Context(), id)
	if err != nil {
		return repertoire.Config{}, false, err
	}
	if found {
		var cfg repertoire.Config
		if err := json.Unmarshal(source.Config, &cfg); err != nil {
			return repertoire.Config{}, false, fmt.Errorf("decode saved configuration: %w", err)
		}
		return cfg, true, nil
	}
	rep, found := h.repertoires.Get(id)
	if !found {
		return repertoire.Config{}, false, nil
	}
	if _, err := repertoire.StudyID(rep.Source); err != nil {
		return repertoire.Config{}, false, nil
	}
	if rep.Config != nil {
		return *rep.Config, true, nil
	}
	return repertoire.Config{ID: rep.ID, Name: rep.Name, Side: rep.Side.String(), Source: rep.Source, Description: rep.Description}, true, nil
}

func (h *Handler) fetchAndSaveRepertoire(r *http.Request, cfg repertoire.Config) (*repertoire.Repertoire, error) {
	pgn, canonicalSource, err := repertoire.FetchStudyPGN(r.Context(), cfg.Source, os.Getenv("LICHESS_TOKEN"))
	if err != nil {
		return nil, err
	}
	cfg.Source = canonicalSource
	rep, err := repertoire.ParseAndBuild(pgn, &cfg)
	if err != nil {
		return nil, fmt.Errorf("parse study: %w", err)
	}
	if len(rep.Chapters) == 0 || len(rep.Cards) == 0 {
		return nil, fmt.Errorf("the study has no drillable repertoire lines for the selected side")
	}
	rawConfig, err := json.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("encode configuration: %w", err)
	}
	if err := h.db.SaveRepertoireSource(r.Context(), db.RepertoireSource{ID: cfg.ID, SourceURL: canonicalSource, PGN: pgn, Config: rawConfig}); err != nil {
		return nil, err
	}
	if err := h.db.DeleteLineImportance(r.Context(), cfg.ID); err != nil {
		return nil, err
	}
	h.repertoires.Upsert(rep)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		h.refreshLineImportance(ctx, rep)
	}()
	go h.pruneOrphanEvals()
	return rep, nil
}

func (h *Handler) pruneOrphanEvals() {
	h.evalPruneMu.Lock()
	if h.evalPruneRunning {
		h.evalPruneAgain = true
		h.evalPruneMu.Unlock()
		return
	}
	h.evalPruneRunning = true
	h.evalPruneMu.Unlock()

	for {
		h.pruneOrphanEvalsOnce()
		h.evalPruneMu.Lock()
		if !h.evalPruneAgain {
			h.evalPruneRunning = false
			h.evalPruneMu.Unlock()
			return
		}
		h.evalPruneAgain = false
		h.evalPruneMu.Unlock()
	}
}

func (h *Handler) pruneOrphanEvalsOnce() {
	if h.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	sources, err := h.db.LoadRepertoireSources(ctx)
	if err != nil {
		log.Printf("eval prune: skipped, could not load repertoire sources: %v", err)
		return
	}
	byID := map[string]*repertoire.Repertoire{}
	for _, rep := range h.repertoires.List() {
		byID[rep.ID] = rep
	}
	for _, source := range sources {
		if source.PGN == "" {
			continue
		}
		var cfg repertoire.Config
		if err := json.Unmarshal(source.Config, &cfg); err != nil {
			log.Printf("eval prune: skipped, invalid config for %q: %v", source.ID, err)
			return
		}
		rep, err := repertoire.ParseAndBuild(source.PGN, &cfg)
		if err != nil {
			log.Printf("eval prune: skipped, could not build %q: %v", source.ID, err)
			return
		}
		byID[rep.ID] = rep
	}
	all := make([]*repertoire.Repertoire, 0, len(byID))
	for _, rep := range byID {
		all = append(all, rep)
	}
	live := evalprecompute.EnumeratePositions(all)
	if len(live) == 0 {
		return
	}

	existing, err := h.db.AllPositionEvalKeys(ctx)
	if err != nil {
		log.Printf("eval prune: skipped, could not list cached evals: %v", err)
		return
	}
	orphans := evalprecompute.OrphanKeys(existing, live)
	if len(orphans) == 0 {
		return
	}
	deleted, err := h.db.DeletePositionEvals(ctx, orphans)
	if err != nil {
		log.Printf("eval prune: deleted %d of %d orphaned evals before failing: %v", deleted, len(orphans), err)
		return
	}
	log.Printf("eval prune: deleted %d orphaned position eval(s)", deleted)
}

func managementConfig(id, name, side, description, source string) (repertoire.Config, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return repertoire.Config{}, fmt.Errorf("give the repertoire a name")
	}
	if side != "w" && side != "b" {
		return repertoire.Config{}, fmt.Errorf("choose White or Black")
	}
	return repertoire.Config{ID: id, Name: name, Side: side, Source: source, Description: strings.TrimSpace(description)}, nil
}
